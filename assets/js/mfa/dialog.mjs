// Native TOTP sign-in challenge only. Enrollment belongs to the account page.
// OTPs/resolver sessions stay in memory; none are logged or put in web storage.
const words = {
  pt: ['Confirmar entrada', 'Abra o autenticador no seu telemóvel e introduza o código atual de 6 dígitos.', 'Autenticador', 'Código do autenticador', 'Confirmar', 'Cancelar', 'Introduza o código atual de 6 dígitos.', 'A confirmar…', 'Código inválido ou expirado. Tente o código atual.', 'Não foi possível confirmar. Tente novamente ou cancele.', 'A encerrar esta tentativa…'],
  en: ['Confirm sign-in', 'Open the authenticator on your phone and enter its current 6-digit code.', 'Authenticator', 'Authenticator code', 'Confirm', 'Cancel', 'Enter the current 6-digit code.', 'Confirming…', 'Invalid or expired code. Try the current code.', 'Could not confirm. Try again or cancel.', 'Closing this attempt…'],
  es: ['Confirmar acceso', 'Abra el autenticador en su móvil e introduzca el código actual de 6 dígitos.', 'Autenticador', 'Código del autenticador', 'Confirmar', 'Cancelar', 'Introduzca el código actual de 6 dígitos.', 'Confirmando…', 'Código incorrecto o caducado. Pruebe el código actual.', 'No se pudo confirmar. Reintente o cancele.', 'Cerrando este intento…']
};
function problem(code, message) { const error = new Error(message); error.code = code; return error; }
let active = false;
export async function resolveTotpChallenge({ auth, sdk, error }) {
  if (active) throw problem('auth/operation-in-progress', 'Another authenticator confirmation is active');
  if (!auth || !sdk?.TotpMultiFactorGenerator || typeof sdk.TotpMultiFactorGenerator.assertionForSignIn !== 'function' || typeof sdk.getMultiFactorResolver !== 'function' || error?.code !== 'auth/multi-factor-auth-required') throw problem('auth/mfa-session-invalid', 'Authenticator confirmation is unavailable');
  let resolver = sdk.getMultiFactorResolver(auth, error);
  if (!resolver || !Array.isArray(resolver.hints) || resolver.hints.length > 10 || resolver.hints.some(h => !h || typeof h !== 'object') || typeof resolver.resolveSignIn !== 'function') throw problem('auth/mfa-session-invalid', 'Authenticator confirmation is unavailable');
  let hints = resolver.hints.filter(h => h.factorId === sdk.TotpMultiFactorGenerator.FACTOR_ID);
  if (!hints.length || hints.some(h => typeof h.uid !== 'string' || !h.uid || h.uid.length > 128 || /[\u0000-\u001f\u007f]/.test(h.uid))) throw problem('auth/mfa-unsupported-factor', 'This account needs its configured authenticator');
  const lang = String(document.documentElement.lang || 'pt').slice(0, 2), copy = words[lang] || words.en;
  const previous = document.activeElement, dialog = document.createElement('dialog');
  if (typeof dialog.showModal !== 'function') throw problem('auth/mfa-ui-unavailable', 'This browser cannot open authenticator confirmation');
  if (!document.getElementById('cm-mfa-dialog-css')) {
    const css = document.createElement('link'); css.id = 'cm-mfa-dialog-css'; css.rel = 'stylesheet'; css.href = new URL('../../css/mfa-dialog.css', import.meta.url).href; document.head.appendChild(css);
  }
  active = true; dialog.className = 'cm-mfa-dialog'; dialog.setAttribute('aria-labelledby', 'cm-mfa-title');
  const form = document.createElement('form'), title = document.createElement('h2'), description = document.createElement('p');
  title.id = 'cm-mfa-title'; title.textContent = copy[0]; description.textContent = copy[1];
  const selectLabel = document.createElement('label'), select = document.createElement('select'); selectLabel.textContent = copy[2];
  hints.forEach((hint, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = typeof hint.displayName === 'string' && hint.displayName.trim() ? hint.displayName.slice(0, 100) : `${copy[2]} ${index + 1}`; select.appendChild(option); });
  select.value = '0'; selectLabel.appendChild(select); selectLabel.hidden = hints.length === 1;
  const inputLabel = document.createElement('label'), input = document.createElement('input');
  inputLabel.textContent = copy[3]; input.type = 'text'; input.inputMode = 'numeric'; input.autocomplete = 'one-time-code'; input.maxLength = 6; input.pattern = '[0-9]{6}'; input.required = true; input.setAttribute('aria-describedby', 'cm-mfa-status'); inputLabel.appendChild(input);
  const status = document.createElement('p'); status.id = 'cm-mfa-status'; status.className = 'cm-mfa-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const buttons = document.createElement('div'), confirm = document.createElement('button'), cancel = document.createElement('button');
  buttons.className = 'cm-mfa-buttons'; confirm.type = 'submit'; confirm.textContent = copy[4]; cancel.type = 'button'; cancel.textContent = copy[5];
  buttons.append(confirm, cancel); form.append(title, description, selectLabel, inputLabel, status, buttons); dialog.appendChild(form); document.body.appendChild(dialog);
  return new Promise((resolve, reject) => {
    let busy = false, settled = false, cancelRequested = false;
    const lifecycle = document.defaultView || (typeof window === 'undefined' ? null : window);
    const cancelled = () => problem('auth/mfa-cancelled', 'Authenticator confirmation was cancelled');
    function finish(value, failure) {
      if (settled) return; settled = true; input.value = ''; resolver = null; hints = []; active = false;
      lifecycle?.removeEventListener('pagehide', onPageHide);
      lifecycle?.removeEventListener('pageshow', onPageShow);
      dialog.close(); dialog.remove(); if (previous?.isConnected !== false && typeof previous?.focus === 'function') previous.focus();
      if (failure) reject(failure); else resolve(value);
    }
    function cancelAttempt() {
      input.value = '';
      if (busy) {
        // The SDK request cannot be undone. Release our session reference and
        // wait for settlement so the caller can clear a late partial sign-in.
        cancelRequested = true; resolver = null; hints = []; status.textContent = copy[10]; return;
      }
      finish(null, cancelled());
    }
    function onPageHide() { cancelAttempt(); }
    function onPageShow(event) { if (event.persisted) cancelAttempt(); }
    lifecycle?.addEventListener('pagehide', onPageHide);
    lifecycle?.addEventListener('pageshow', onPageShow);
    cancel.addEventListener('click', cancelAttempt);
    dialog.addEventListener('cancel', event => { event.preventDefault(); cancelAttempt(); });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const focusable = [...(hints.length > 1 ? [select] : []), input, confirm, cancel].filter(element => !element.disabled);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (busy || settled) return;
      let otp = input.value.trim(); input.value = '';
      if (!/^[0-9]{6}$/.test(otp)) { status.textContent = copy[6]; input.focus(); return; }
      const hint = hints[Number(select.value)]; if (!hint) { finish(null, problem('auth/mfa-session-invalid', 'Authenticator selection is unavailable')); return; }
      busy = true; input.disabled = true; select.disabled = true; confirm.disabled = true; status.textContent = copy[7];
      try {
        const assertion = sdk.TotpMultiFactorGenerator.assertionForSignIn(hint.uid, otp); otp = '';
        const result = await resolver.resolveSignIn(assertion);
        finish(cancelRequested ? null : result, cancelRequested ? cancelled() : null);
      } catch (cause) {
        otp = '';
        if (cancelRequested) { finish(null, cancelled()); return; }
        if (['auth/invalid-multi-factor-session', 'auth/multi-factor-info-not-found', 'auth/session-expired'].includes(cause?.code)) { finish(null, problem('auth/mfa-session-expired', 'Start sign-in again to confirm your authenticator')); return; }
        status.textContent = ['auth/invalid-verification-code', 'auth/code-expired', 'auth/invalid-totp-code'].includes(cause?.code) ? copy[8] : copy[9];
        input.disabled = false; select.disabled = false; confirm.disabled = false; busy = false; input.focus();
      }
    });
    try { dialog.showModal(); input.focus(); } catch { finish(null, problem('auth/mfa-ui-unavailable', 'Authenticator confirmation could not open')); }
  });
}
