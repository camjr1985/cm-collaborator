// Native Firebase MFA management. No application-owned TOTP verification or secret persistence.
const INTENT_KEY = 'cmcollab:mfa:reauth-intent';
const FRESH_MS = 5 * 60 * 1000, INTENT_MS = 10 * 60 * 1000;
export class AccountSecurityError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new AccountSecurityError(code); };
const emailOf = user => String(user?.email || '').trim().toLowerCase();
const safeOrigin = route => route.protocol === 'https:' || route.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(route.hostname);

export class AccountSecurity {
  constructor({ auth, sdk, runMfa, storage, returnUrl, now = () => Date.now(), nonce = () => crypto.randomUUID(), cleanLink = () => {}, changed = () => {} }) {
    const route = new URL(returnUrl);
    if (!safeOrigin(route) || route.search || route.hash || route.username || route.password) fail('INVALID_RETURN_URL');
    this.auth = auth; this.sdk = sdk; this.runMfa = runMfa; this.storage = storage;
    this.returnUrl = route.href; this.now = now; this.nonce = nonce; this.cleanLink = cleanLink; this.changed = changed;
    this.phase = 'idle'; this.busy = false; this.secret = null; this.enrollmentUid = null; this.generation = 0;
  }
  user() { return this.auth.currentUser || fail('SIGN_IN_REQUIRED'); }
  factors() { return this.sdk.multiFactor(this.user()).enrolledFactors || []; }
  snapshot() {
    const user = this.auth.currentUser;
    return { phase: this.phase, busy: this.busy, email: user?.email || '', verified: user?.emailVerified === true,
      providers: (user?.providerData || []).map(provider => provider.providerId),
      factors: user ? this.factors().map(factor => ({ uid: factor.uid, factorId: factor.factorId, name: factor.displayName || '' })) : [] };
  }
  emit() { this.changed(this.snapshot()); }
  sameUser(uid) { if (this.auth.currentUser?.uid !== uid) { this.cancel(); fail('USER_MISMATCH'); } return this.auth.currentUser; }
  async operation(fn) {
    if (this.busy) fail('BUSY');
    this.busy = true; this.emit();
    try { return await fn(); }
    catch (error) { if (['generating','confirming'].includes(this.phase)) this.cancel(); throw error; }
    finally { this.busy = false; this.emit(); }
  }
  cancel() {
    if (['confirming','uncertain'].includes(this.phase)) return false;
    this.generation++; this.secret = null; this.enrollmentUid = null; this.phase = 'idle'; this.emit(); return true;
  }
  clearSensitive() {
    this.secret = null; this.enrollmentUid = null;
    if (['confirming','uncertain'].includes(this.phase)) { this.emit(); return; }
    this.cancel();
  }
  key() { return this.phase === 'awaiting-code' && this.secret && this.auth.currentUser?.uid === this.enrollmentUid ? this.secret.secretKey : ''; }
  async fresh(user) {
    const token = await this.sdk.getIdTokenResult(user, true), at = Date.parse(token.authTime);
    if (!Number.isFinite(at) || this.now() - at < 0 || this.now() - at > FRESH_MS) fail('REAUTH_REQUIRED');
  }
  async refresh() { return this.operation(async () => {
    const user = this.user(); await this.sdk.reload(user); this.sameUser(user.uid);
    if (['uncertain','enrolled'].includes(this.phase) || this.factors().length) {
      this.secret = null; this.enrollmentUid = null; this.phase = this.factors().length ? 'enrolled' : 'idle';
    }
    return this.snapshot();
  }); }
  async verifyEmail() { return this.operation(async () => { const user = this.user(); if (user.emailVerified) return; await this.sdk.sendEmailVerification(user, { url: this.returnUrl }); this.sameUser(user.uid); }); }
  async reauthenticate(providerId) {
    return this.operation(async () => {
      this.cancel(); const user = this.user(), uid = user.uid;
      if (!(user.providerData || []).some(provider => provider.providerId === providerId)) fail('PROVIDER_UNAVAILABLE');
      const provider = providerId === 'google.com' ? new this.sdk.GoogleAuthProvider() : providerId === 'microsoft.com' ? new this.sdk.OAuthProvider('microsoft.com') : fail('PROVIDER_UNAVAILABLE');
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await this.runMfa(() => this.sdk.reauthenticateWithPopup(user, provider));
      this.sameUser(uid); if (result?.user?.uid !== uid) fail('USER_MISMATCH');
      await this.fresh(user); this.sameUser(uid);
    });
  }
  async emailReauthentication() {
    return this.operation(async () => {
      this.cancel(); const user = this.user(), nonce = this.nonce();
      if (!emailOf(user)) fail('SIGN_IN_REQUIRED');
      if (!/^[A-Za-z0-9_-]{16,96}$/.test(nonce)) fail('INVALID_INTENT');
      const intent = { uid: user.uid, email: emailOf(user), nonce, at: this.now() };
      try { this.storage.setItem(INTENT_KEY, JSON.stringify(intent)); } catch { fail('STORAGE_UNAVAILABLE'); }
      const url = new URL(this.returnUrl); url.searchParams.set('mfaReauth', '1'); url.searchParams.set('nonce', nonce);
      try {
        await this.sdk.sendSignInLinkToEmail(this.auth, user.email, { url: url.href, handleCodeInApp: true });
        this.sameUser(user.uid);
      } catch (error) { this.storage.removeItem(INTENT_KEY); throw error; }
    });
  }
  async completeEmailReauthentication(href) {
    // Capture the one-time link in memory, then remove it from browser history before SDK/network work.
    this.cleanLink(this.returnUrl);
    return this.operation(async () => {
      let intent;
      try {
        const url = new URL(href), route = new URL(this.returnUrl), raw = this.storage.getItem(INTENT_KEY);
        if (url.origin !== route.origin || url.pathname !== route.pathname || url.searchParams.get('mfaReauth') !== '1' || !raw || raw.length > 2048) fail('INVALID_INTENT');
        try { intent = JSON.parse(raw); } catch { fail('INVALID_INTENT'); }
        if (!intent || typeof intent.uid !== 'string' || typeof intent.email !== 'string' || typeof intent.nonce !== 'string' ||
            !Number.isFinite(intent.at) || this.now() - intent.at < 0 || this.now() - intent.at > INTENT_MS ||
            url.searchParams.get('nonce') !== intent.nonce || !/^[A-Za-z0-9_-]{16,96}$/.test(intent.nonce)) fail('INVALID_INTENT');
        const user = this.user();
        if (user.uid !== intent.uid || emailOf(user) !== intent.email) fail('USER_MISMATCH');
        if (!this.sdk.isSignInWithEmailLink(this.auth, href)) fail('INVALID_INTENT');
        const credential = this.sdk.EmailAuthProvider.credentialWithLink(intent.email, href);
        const result = await this.runMfa(() => this.sdk.reauthenticateWithCredential(user, credential));
        this.sameUser(intent.uid); if (result?.user?.uid !== intent.uid) fail('USER_MISMATCH');
        await this.fresh(user); this.sameUser(intent.uid);
      } finally { this.storage.removeItem(INTENT_KEY); }
    });
  }
  async beginEnrollment() {
    return this.operation(async () => {
      if (this.phase === 'uncertain') fail('RESULT_UNCERTAIN');
      this.cancel(); const generation = this.generation, user = this.user(), uid = user.uid;
      if (!user.emailVerified) fail('EMAIL_NOT_VERIFIED');
      await this.sdk.reload(user); this.sameUser(uid);
      if (generation !== this.generation) return false;
      if (this.factors().length) fail('ALREADY_ENROLLED');
      await this.fresh(user); this.sameUser(uid);
      if (generation !== this.generation) return false;
      this.phase = 'generating'; this.emit();
      const session = await this.sdk.multiFactor(user).getSession();
      if (generation !== this.generation) return false;
      const secret = await this.sdk.TotpMultiFactorGenerator.generateSecret(session);
      this.sameUser(uid); if (generation !== this.generation) return false;
      if (secret.codeLength !== 6 || secret.codeIntervalSeconds !== 30 || String(secret.hashingAlgorithm).toUpperCase().replaceAll('-', '') !== 'SHA1' ||
          typeof secret.secretKey !== 'string' || !/^[A-Z2-7]{16,128}$/.test(secret.secretKey)) fail('UNSUPPORTED_TOTP_PROFILE');
      this.secret = secret; this.enrollmentUid = uid; this.phase = 'awaiting-code'; this.emit(); return true;
    });
  }
  async confirmEnrollment(value) {
    if (typeof value !== 'string' || !/^\d{6}$/.test(value.trim())) fail('INVALID_CODE');
    return this.operation(async () => {
      const user = this.user(), uid = user.uid, generation = this.generation;
      if (!this.secret || this.phase !== 'awaiting-code') fail('ENROLLMENT_REQUIRED');
      if (uid !== this.enrollmentUid) { this.cancel(); fail('USER_MISMATCH'); }
      if (!user.emailVerified) { this.cancel(); fail('EMAIL_NOT_VERIFIED'); }
      if (this.factors().length) { this.cancel(); fail('ALREADY_ENROLLED'); }
      try { await this.fresh(user); this.sameUser(uid); } catch (error) { this.cancel(); throw error; }
      if (generation !== this.generation) return false;
      this.phase = 'confirming'; this.emit();
      let dispatched = false;
      try {
        const assertion = this.sdk.TotpMultiFactorGenerator.assertionForEnrollment(this.secret, value.trim());
        dispatched = true;
        await this.sdk.multiFactor(user).enroll(assertion, 'CM Collaborator');
        if (this.auth.currentUser?.uid !== uid) fail('USER_MISMATCH');
        this.secret = null; this.enrollmentUid = null; this.phase = 'enrolled'; this.emit(); return true;
      } catch (error) {
        if (!dispatched) { this.phase = 'idle'; this.clearSensitive(); throw error; }
        if (error?.code === 'auth/invalid-verification-code' && this.auth.currentUser?.uid === uid) {
          this.phase = this.secret ? 'awaiting-code' : 'idle'; this.emit(); throw error;
        }
        // An interrupted response does not undo a server enrollment. Clear local
        // material, reconcile once and require an explicit refresh before retry.
        this.secret = null; this.enrollmentUid = null; this.phase = 'uncertain'; this.emit();
        if (this.auth.currentUser?.uid === uid) {
          try {
            await this.sdk.reload(user);
            if (this.auth.currentUser?.uid === uid && this.factors().length) { this.phase = 'enrolled'; this.emit(); return true; }
          } catch { /* Remain blocked until an explicit successful refresh. */ }
        }
        fail(error?.code === 'USER_MISMATCH' ? 'USER_MISMATCH' : 'RESULT_UNCERTAIN');
      }
    });
  }
}

const PT = {
  back:'Meus quadros',account:'Sua conta',title:'Segurança da conta',intro:'Adicione, se quiser, uma segunda etapa para proteger sua conta.',loading:'Carregando sua conta…',identity:'Conta conectada',refresh:'Atualizar status',verify:'Verificar e-mail',mfa:'Aplicativo autenticador',optional:'Ativação opcional. Depois de confirmar, os próximos logins nesta conta também pedirão o código do aplicativo autenticador. Isso vale para os métodos de entrada vinculados à conta.',start:'Ativar autenticação em duas etapas',reauthTitle:'Confirme sua identidade',reauthText:'Por segurança, confirme novamente sua conta antes de ativar a proteção.',google:'Confirmar com Google',microsoft:'Confirmar com Microsoft',emailReauth:'Receber link de confirmação por e-mail',sameDevice:'Abra o link neste navegador, com a mesma conta conectada. Ele serve somente para confirmar sua identidade.',addApp:'Adicione a conta no autenticador',manual:'No aplicativo autenticador, escolha adicionar uma conta manualmente. Use seu e-mail como nome, a chave abaixo e código baseado em tempo (TOTP).',secretWarning:'Esta chave é privada. Não envie por e-mail, mensagens ou suporte. Digite-a somente no seu aplicativo autenticador.',key:'Chave de configuração',profile:'Configuração: código de 6 dígitos, 30 segundos, SHA-1.',code:'Código de 6 dígitos do aplicativo',confirm:'Confirmar e ativar',cancel:'Cancelar',guideTitle:'Como configurar pelo celular',guide1:'No Android ou iPhone, instale um aplicativo autenticador gratuito que suporte TOTP, como Google Authenticator ou Microsoft Authenticator.',guide2:'Volte a esta página, toque em ativar e confirme sua identidade, se solicitado.',guide3:'No autenticador, adicione uma conta usando uma chave de configuração. No Microsoft Authenticator, escolha “Outra conta”. Use a opção de inserir a chave manualmente.',guide4:'Digite a chave exibida nesta página. Selecione “baseado em tempo”, quando houver essa opção. Não use código baseado em contador.',guide5:'Volte para esta página e digite o código de 6 dígitos que o aplicativo está mostrando. Toque em “Confirmar e ativar”.',guide6:'Aguarde a confirmação “Proteção ativada”. Nos próximos logins, mantenha o autenticador disponível para informar o código.',samePhone:'Está usando o mesmo celular? Alterne entre o navegador e o autenticador para inserir a chave manualmente. Não é preciso fotografar a tela.',lostTitle:'Se perder acesso ao autenticador',lost:'Fale com o administrador para avaliar a recuperação pelos canais do provedor. Esta página não oferece códigos de reserva nem remoção da proteção sem acesso à conta. Mantenha seu celular protegido e planeje como recuperar seu aplicativo autenticador.',verified:'E-mail verificado.',notVerified:'Verifique seu e-mail antes de ativar esta proteção.',noFactor:'A autenticação em duas etapas ainda não está ativada.',hasFactor:'Esta conta já tem um segundo fator. Nenhum fator adicional será cadastrado aqui.',factorCount:'Fatores cadastrados:',ready:'Você pode escolher ativar a proteção.',activated:'Proteção ativada. Nos próximos logins, use também o código do autenticador.',cancelled:'Configuração cancelada. A chave foi apagada desta página.',verificationSent:'Enviamos a verificação por e-mail. Abra o link e atualize o status.',reauthSent:'Enviamos o link de confirmação. Abra-o neste navegador e volte a ativar a proteção.',reauthDone:'Identidade confirmada. Você pode ativar a proteção.',enterCode:'Adicione a chave no seu autenticador e informe o código.',busy:'Aguarde a operação atual.',signIn:'Entre em Meus quadros com a sua conta para gerenciar a segurança.',invalidCode:'Digite os 6 dígitos exibidos no aplicativo. Se o código venceu, aguarde o próximo.',reauthRequired:'Confirme novamente sua identidade para continuar.',intentError:'Este link não pode confirmar a conta neste navegador. Solicite um novo link com a mesma conta conectada.',mismatch:'A conta não corresponde à confirmação solicitada. Continue com a mesma conta.',storageError:'Este navegador precisa permitir armazenamento de sessão para confirmar por e-mail. Você também pode confirmar com seu provedor.',profileError:'O provedor retornou uma configuração de autenticador não suportada. A proteção não foi ativada.',closed:'A confirmação foi cancelada. Você pode tentar novamente.',genericError:'Não foi possível concluir. Tente novamente; a proteção só é ativada após a confirmação.'
};
const EN = {
  back:'My boards',account:'Your account',title:'Account security',intro:'Choose to add a second step to protect your account.',loading:'Loading your account…',identity:'Signed-in account',refresh:'Refresh status',verify:'Verify email',mfa:'Authenticator app',optional:'Optional setup. Once confirmed, future sign-ins to this account will also ask for the code from your authenticator app. This applies to the sign-in methods linked to the account.',start:'Enable two-step authentication',reauthTitle:'Confirm your identity',reauthText:'For security, confirm your account again before enabling protection.',google:'Confirm with Google',microsoft:'Confirm with Microsoft',emailReauth:'Send an email confirmation link',sameDevice:'Open the link in this browser, signed in to the same account. It only confirms your identity.',addApp:'Add the account to your authenticator',manual:'In your authenticator app, choose to add an account manually. Use your email as the name, the key below, and time-based codes (TOTP).',secretWarning:'This key is private. Do not send it by email, messages or support. Enter it only in your authenticator app.',key:'Setup key',profile:'Configuration: 6-digit code, 30 seconds, SHA-1.',code:'6-digit code from the app',confirm:'Confirm and enable',cancel:'Cancel',guideTitle:'Set up on your phone',guide1:'On Android or iPhone, install a free authenticator app that supports TOTP, such as Google Authenticator or Microsoft Authenticator.',guide2:'Return to this page, tap enable and confirm your identity if asked.',guide3:'In the authenticator, add an account using a setup key. In Microsoft Authenticator, choose “Other account”. Use the option to enter the key manually.',guide4:'Enter the key shown on this page. Select “time based” if offered. Do not use counter-based codes.',guide5:'Return here and enter the 6-digit code currently shown in the app. Tap “Confirm and enable”.',guide6:'Wait for “Protection enabled”. Keep the authenticator available for future sign-ins.',samePhone:'Using the same phone? Switch between the browser and authenticator to enter the key manually. You do not need to photograph the screen.',lostTitle:'If you lose access to the authenticator',lost:'Contact the administrator to assess recovery through the provider’s channels. This page offers no backup codes or removal without account access. Protect your phone and plan how to recover your authenticator app.',verified:'Email verified.',notVerified:'Verify your email before enabling protection.',noFactor:'Two-step authentication is not enabled yet.',hasFactor:'This account already has a second factor. No additional factor will be enrolled here.',factorCount:'Enrolled factors:',ready:'You can choose to enable protection.',activated:'Protection enabled. Use your authenticator code at future sign-ins.',cancelled:'Setup cancelled. The key has been cleared from this page.',verificationSent:'Verification email sent. Open the link and refresh the status.',reauthSent:'Confirmation link sent. Open it in this browser, then enable protection.',reauthDone:'Identity confirmed. You can enable protection.',enterCode:'Add the key in your authenticator and enter its code.',busy:'Wait for the current operation.',signIn:'Sign in to My boards to manage account security.',invalidCode:'Enter the 6 digits shown in the app. If the code expired, wait for the next one.',reauthRequired:'Confirm your identity again to continue.',intentError:'This link cannot confirm the account in this browser. Request a new link while signed in to the same account.',mismatch:'The account does not match the requested confirmation. Continue with the same account.',storageError:'This browser must allow session storage to confirm by email. You can also confirm with your provider.',profileError:'The provider returned an unsupported authenticator configuration. Protection was not enabled.',closed:'Confirmation cancelled. You can try again.',genericError:'Unable to finish. Try again; protection is enabled only after confirmation.'
};
const ES = {
  back:'Mis tableros',account:'Tu cuenta',title:'Seguridad de la cuenta',intro:'Si lo deseas, añade un segundo paso para proteger tu cuenta.',loading:'Cargando tu cuenta…',identity:'Cuenta conectada',refresh:'Actualizar estado',verify:'Verificar correo',mfa:'Aplicación autenticadora',optional:'Activación opcional. Tras confirmar, los próximos inicios de sesión también pedirán el código de la aplicación autenticadora. Se aplica a los métodos vinculados a esta cuenta.',start:'Activar autenticación en dos pasos',reauthTitle:'Confirma tu identidad',reauthText:'Por seguridad, confirma de nuevo tu cuenta antes de activar la protección.',google:'Confirmar con Google',microsoft:'Confirmar con Microsoft',emailReauth:'Recibir enlace de confirmación por correo',sameDevice:'Abre el enlace en este navegador con la misma cuenta conectada. Solo confirma tu identidad.',addApp:'Añade la cuenta al autenticador',manual:'En la aplicación autenticadora, añade una cuenta manualmente. Usa tu correo como nombre, la clave siguiente y códigos basados en tiempo (TOTP).',secretWarning:'Esta clave es privada. No la envíes por correo, mensajes ni soporte. Introdúcela solo en tu aplicación autenticadora.',key:'Clave de configuración',profile:'Configuración: código de 6 dígitos, 30 segundos, SHA-1.',code:'Código de 6 dígitos de la aplicación',confirm:'Confirmar y activar',cancel:'Cancelar',guideTitle:'Cómo configurar desde el móvil',guide1:'En Android o iPhone, instala una aplicación autenticadora gratuita compatible con TOTP, como Google Authenticator o Microsoft Authenticator.',guide2:'Vuelve a esta página, pulsa activar y confirma tu identidad si se solicita.',guide3:'En el autenticador, añade una cuenta mediante una clave de configuración. En Microsoft Authenticator, elige “Otra cuenta”. Usa la opción de introducir la clave manualmente.',guide4:'Introduce la clave mostrada en esta página. Selecciona “basado en tiempo” si se ofrece. No uses códigos basados en contador.',guide5:'Vuelve aquí e introduce el código de 6 dígitos que muestra la aplicación. Pulsa “Confirmar y activar”.',guide6:'Espera la confirmación “Protección activada”. Ten el autenticador disponible en los próximos inicios de sesión.',samePhone:'¿Usas el mismo móvil? Alterna entre el navegador y el autenticador para introducir la clave manualmente. No hace falta fotografiar la pantalla.',lostTitle:'Si pierdes acceso al autenticador',lost:'Contacta con el administrador para evaluar la recuperación mediante los canales del proveedor. Esta página no ofrece códigos de reserva ni eliminación sin acceso a la cuenta. Protege tu móvil y planifica cómo recuperar tu aplicación autenticadora.',verified:'Correo verificado.',notVerified:'Verifica tu correo antes de activar la protección.',noFactor:'La autenticación en dos pasos aún no está activada.',hasFactor:'Esta cuenta ya tiene un segundo factor. Aquí no se añadirá otro.',factorCount:'Factores registrados:',ready:'Puedes elegir activar la protección.',activated:'Protección activada. Usa también el código del autenticador en los próximos inicios de sesión.',cancelled:'Configuración cancelada. Se ha borrado la clave de esta página.',verificationSent:'Enviamos la verificación por correo. Abre el enlace y actualiza el estado.',reauthSent:'Enlace enviado. Ábrelo en este navegador y activa la protección.',reauthDone:'Identidad confirmada. Puedes activar la protección.',enterCode:'Añade la clave al autenticador e introduce el código.',busy:'Espera a que termine la operación actual.',signIn:'Inicia sesión en Mis tableros para gestionar la seguridad.',invalidCode:'Introduce los 6 dígitos de la aplicación. Si han caducado, espera al siguiente código.',reauthRequired:'Confirma de nuevo tu identidad para continuar.',intentError:'Este enlace no puede confirmar la cuenta en este navegador. Solicita otro con la misma cuenta conectada.',mismatch:'La cuenta no corresponde a la confirmación solicitada. Continúa con la misma cuenta.',storageError:'Permite el almacenamiento de sesión para confirmar por correo, o confirma con tu proveedor.',profileError:'El proveedor devolvió una configuración no compatible. La protección no se activó.',closed:'Confirmación cancelada. Puedes volver a intentarlo.',genericError:'No se pudo completar. Inténtalo de nuevo; la protección solo se activa tras confirmar.'
};
const PP = { ...PT, back:'Os meus quadros',account:'A sua conta',intro:'Se pretender, adicione uma segunda etapa para proteger a sua conta.',loading:'A carregar a sua conta…',identity:'Conta com sessão iniciada',verify:'Verificar e-mail',mfa:'Aplicação autenticadora',optional:'Ativação opcional. Depois de confirmar, os próximos inícios de sessão nesta conta também pedirão o código da aplicação autenticadora. Aplica-se aos métodos de entrada associados à conta.',sameDevice:'Abra a ligação neste navegador, com a mesma conta com sessão iniciada. Serve apenas para confirmar a sua identidade.',manual:'Na aplicação autenticadora, escolha adicionar uma conta manualmente. Use o seu e-mail como nome, a chave abaixo e código baseado no tempo (TOTP).',secretWarning:'Esta chave é privada. Não a envie por e-mail, mensagens ou ao suporte. Introduza-a apenas na sua aplicação autenticadora.',code:'Código de 6 algarismos da aplicação',guideTitle:'Como configurar no telemóvel',guide1:'No Android ou iPhone, instale uma aplicação autenticadora gratuita que suporte TOTP, como Google Authenticator ou Microsoft Authenticator.',guide2:'Volte a esta página, toque em ativar e confirme a sua identidade, se solicitado.',guide3:'Na aplicação autenticadora, adicione uma conta através de uma chave de configuração. No Microsoft Authenticator, escolha «Outra conta». Use a opção para introduzir a chave manualmente.',guide4:'Introduza a chave apresentada nesta página. Selecione «baseado no tempo», quando existir essa opção. Não use código baseado num contador.',guide5:'Volte a esta página e introduza o código de 6 algarismos apresentado na aplicação. Toque em «Confirmar e ativar».',guide6:'Aguarde a confirmação «Proteção ativada». Nos próximos inícios de sessão, tenha a aplicação autenticadora disponível.',samePhone:'Está a usar o mesmo telemóvel? Alterne entre o navegador e a aplicação autenticadora para introduzir a chave manualmente. Não precisa de fotografar o ecrã.',lostTitle:'Se perder o acesso à aplicação autenticadora',lost:'Fale com o administrador para avaliar a recuperação através dos canais do fornecedor. Esta página não disponibiliza códigos de reserva nem a remoção da proteção sem acesso à conta. Proteja o seu telemóvel e planeie como recuperar a aplicação autenticadora.',activated:'Proteção ativada. Nos próximos inícios de sessão, use também o código da aplicação autenticadora.',invalidCode:'Introduza os 6 algarismos apresentados na aplicação. Se o código expirou, aguarde o próximo.',signIn:'Inicie sessão em Os meus quadros para gerir a segurança da conta.' };
Object.assign(PT, { uncertain:'Não foi possível confirmar o resultado. Atualize o status antes de tentar novamente.',confirming:'Aguarde a confirmação da ativação.' });
Object.assign(PP, { uncertain:'Não foi possível confirmar o resultado. Atualize o estado antes de tentar novamente.',confirming:'Aguarde a confirmação da ativação.' });
Object.assign(EN, { uncertain:'We could not confirm the result. Refresh the status before trying again.',confirming:'Wait for activation to be confirmed.' });
Object.assign(ES, { uncertain:'No se pudo confirmar el resultado. Actualiza el estado antes de intentarlo de nuevo.',confirming:'Espera la confirmación de la activación.' });
export const ACCOUNT_COPY = Object.freeze({ pt: PT, 'pt-pt': PP, en: EN, es: ES });

export function accountError(error, copy) {
  const code = error?.code;
  if (code === 'BUSY') return copy.busy;
  if (code === 'RESULT_UNCERTAIN') return copy.uncertain;
  if (code === 'SIGN_IN_REQUIRED') return copy.signIn;
  if (['INVALID_CODE','auth/invalid-verification-code'].includes(code)) return copy.invalidCode;
  if (['REAUTH_REQUIRED','auth/requires-recent-login','auth/user-token-expired'].includes(code)) return copy.reauthRequired;
  if (code === 'EMAIL_NOT_VERIFIED') return copy.notVerified;
  if (code === 'ALREADY_ENROLLED') return copy.hasFactor;
  if (code === 'INVALID_INTENT') return copy.intentError;
  if (['USER_MISMATCH','auth/user-mismatch'].includes(code)) return copy.mismatch;
  if (code === 'STORAGE_UNAVAILABLE') return copy.storageError;
  if (code === 'UNSUPPORTED_TOTP_PROFILE') return copy.profileError;
  if (['MFA_CANCELLED','CANCELLED','auth/mfa-cancelled','auth/popup-closed-by-user','auth/cancelled-popup-request'].includes(code)) return copy.closed;
  return copy.genericError;
}

export async function mountAccount({ win = window, doc = document, assetUrl = import.meta.url } = {}) {
  const locale = Object.hasOwn(ACCOUNT_COPY, win.MB_VARIANT) ? win.MB_VARIANT : 'pt', copy = ACCOUNT_COPY[locale];
  doc.documentElement.lang = { pt:'pt-BR','pt-pt':'pt-PT',en:'en',es:'es' }[locale];
  doc.title = copy.title + ' · CM Collaborator';
  for (const node of doc.querySelectorAll('[data-copy]')) if (copy[node.dataset.copy]) node.textContent = copy[node.dataset.copy];
  const el = id => doc.getElementById(id), status = (text, error = false) => { el('accountStatus').textContent = text; el('accountStatus').dataset.error = String(error); };
  const route = new URL('../../../conta/seguranca/', assetUrl);
  if (route.origin !== win.location.origin || !safeOrigin(route)) { status(copy.genericError, true); return; }
  const incoming = win.location.href, continuation = new URL(incoming).searchParams.get('mfaReauth') === '1';
  if (continuation) win.history.replaceState(null, '', route.pathname);
  const clearOutput = () => { el('accountSecret').textContent = ''; el('accountCode').value = ''; };
  let controller;
  const show = state => {
    el('accountEmail').textContent = state.email;
    el('accountVerified').textContent = state.verified ? copy.verified : copy.notVerified;
    el('accountFactors').textContent = copy.factorCount + ' ' + state.factors.length;
    el('accountVerify').hidden = state.verified;
    el('accountEnrollmentStatus').textContent = state.phase === 'uncertain' ? copy.uncertain : state.factors.length ? copy.hasFactor : copy.noFactor;
    if (state.phase === 'confirming') status(copy.confirming);
    el('accountStart').disabled = state.busy || !state.verified || state.factors.length > 0 || ['confirming','uncertain'].includes(state.phase);
    el('accountCancel').disabled = ['confirming','uncertain'].includes(state.phase);
    el('accountGoogle').hidden = !state.providers.includes('google.com');
    el('accountMicrosoft').hidden = !state.providers.includes('microsoft.com');
    el('accountEnroll').hidden = !['awaiting-code','confirming'].includes(state.phase);
    for (const id of ['accountRefresh','accountVerify','accountGoogle','accountMicrosoft','accountEmailReauth','accountConfirm']) el(id).disabled = state.busy;
    if (!['awaiting-code','confirming'].includes(state.phase)) clearOutput();
  };
  try {
    const user = await win.CMAuth.ready();
    if (!user) { status(copy.signIn); return; }
    const environment = await win.CMAuth.security();
    controller = new AccountSecurity({ ...environment, storage: win.sessionStorage, returnUrl: route.href, cleanLink: () => win.history.replaceState(null, '', route.pathname), changed: show });
    controller.emit(); status(copy.ready);
    const act = (operation, success) => async () => {
      try { await operation(); if (success) status(success); }
      catch (error) { status(accountError(error, copy), true); if (['REAUTH_REQUIRED','auth/requires-recent-login'].includes(error?.code)) el('accountReauth').hidden = false; }
    };
    el('accountRefresh').onclick = act(async () => { await controller.refresh(); status(controller.factors().length ? copy.activated : copy.ready); });
    el('accountVerify').onclick = act(() => controller.verifyEmail(), copy.verificationSent);
    el('accountGoogle').onclick = act(() => controller.reauthenticate('google.com'), copy.reauthDone);
    el('accountMicrosoft').onclick = act(() => controller.reauthenticate('microsoft.com'), copy.reauthDone);
    el('accountEmailReauth').onclick = act(() => controller.emailReauthentication(), copy.reauthSent);
    el('accountStart').onclick = act(async () => {
      clearOutput();
      if (await controller.beginEnrollment()) { el('accountSecret').textContent = controller.key(); el('accountReauth').hidden = true; status(copy.enterCode); el('accountCode').focus(); }
    });
    el('accountEnroll').onsubmit = async event => {
      event.preventDefault(); const value = el('accountCode').value; clearOutput();
      await act(async () => { if (await controller.confirmEnrollment(value)) status(copy.activated); })();
    };
    el('accountCancel').onclick = () => { clearOutput(); if (controller.cancel()) status(copy.cancelled); };
    win.addEventListener('pagehide', () => { clearOutput(); controller.clearSensitive(); });
    win.addEventListener('pageshow', event => { if (event.persisted) { clearOutput(); controller.clearSensitive(); } });
    win.addEventListener('keydown', event => { if (event.key === 'Escape') { clearOutput(); if (controller.cancel()) status(copy.cancelled); } });
    if (continuation) await act(() => controller.completeEmailReauthentication(incoming), copy.reauthDone)();
    return controller;
  } catch (error) { clearOutput(); controller?.cancel(); status(accountError(error, copy), true); }
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') mountAccount();
