/* CM Collaborator: optional native TOTP, preserving the existing compat API.
 * Security remains enforced by Firebase/RTDB. This client creates no bypass,
 * administrative reset, password login or mandatory-enrollment policy.
 */
(function () {
  "use strict";
  const cfg = window.CMCOLLAB_FIREBASE;
  const EMAIL_KEY = "cmcollab:emailForSignIn";
  const source = document.currentScript && document.currentScript.src;
  let readyP = null, current = null, adminP = null, interactiveAuth = false, authFault = false;
  let compat = null, modular = null, sdk = null, sdkModule = null;
  const t = function (message) { return (window.MBt || String)(message); };
  const problem = function (code, message) { const error = new Error(message); error.code = code; return error; };
  const loadModule = function (src) { return import(src); };
  function moduleUrl(path) {
    if (!source) throw problem("auth/sdk-unavailable", "Authentication script URL is unavailable");
    return new URL(path, source).href;
  }
  function key(email) { return String(email || "").trim().toLowerCase().replace(/\./g, ","); }
  function continuationUrl() {
    const u = new URL(location.href);
    ["apiKey", "oobCode", "mode", "continueUrl", "tenantId", "mfaReauth"].forEach(function (p) { u.searchParams.delete(p); });
    u.hash = ""; return u.href;
  }
  function cleanLinkUrl() {
    const u = new URL(location.href);
    ["apiKey", "oobCode", "mode", "lang", "continueUrl", "tenantId"].forEach(function (p) { u.searchParams.delete(p); });
    history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
  }
  // Account-security reauthentication owns its nonce/UID-bound link and cleanup.
  // Ordinary sign-in credentials leave history before any asynchronous exchange.
  let bootLink = null;
  if (cfg && cfg.databaseURL) {
    const incoming = new URL(location.href);
    if (incoming.searchParams.get("mfaReauth") !== "1" && incoming.searchParams.get("mode") === "signIn" && incoming.searchParams.has("oobCode")) {
      bootLink = incoming.href; cleanLinkUrl();
    }
  }
  function syncCurrent() { current = authFault ? null : compat.currentUser || null; adminP = null; return current; }
  function safeResult(result) {
    if (!result || !result.user) return result;
    const user = compat.currentUser;
    if (!user || user.uid !== result.user.uid) throw problem("auth/user-mismatch", "The signed-in account changed");
    // Keep SDK credentials/tokens out of a custom return DTO. Consumers receive
    // the same compat User surface they already use, including getIdToken().
    return { user: user, ...(result.providerId ? { providerId: result.providerId } : {}), ...(result.operationType ? { operationType: result.operationType } : {}) };
  }
  async function challenge(error) {
    const ui = await loadModule(moduleUrl("mfa/dialog.mjs"));
    if (typeof ui.resolveTotpChallenge !== "function") throw problem("auth/mfa-ui-unavailable", "Authenticator confirmation is unavailable");
    return ui.resolveTotpChallenge({ auth: modular, sdk: sdk, error: error });
  }
  async function withInteractive(operation, after) {
    if (typeof operation !== "function") throw new TypeError("A local authentication operation is required");
    if (authFault) throw problem("auth/sign-out-required", "Sign out before trying again");
    if (interactiveAuth) throw problem("auth/operation-in-progress", "Another authentication operation is active");
    const before = current && current.uid, startingUid = compat.currentUser && compat.currentUser.uid;
    interactiveAuth = true;
    try {
      let result;
      try { result = await operation(); }
      catch (error) {
        if (!error || error.code !== "auth/multi-factor-auth-required") throw error;
        result = await challenge(error); // Never retry the first factor or fall back.
      }
      const normalized = safeResult(result); syncCurrent();
      return after ? await after(normalized) : normalized;
    } catch (error) {
      const needsVerification = error && error.message === "NEEDS_VERIFICATION" && compat.currentUser && !compat.currentUser.emailVerified;
      // A cancelled in-flight MFA request may have settled with a new identity.
      // Clear that partial sign-in before releasing observer suppression.
      if (!needsVerification && compat.currentUser && compat.currentUser.uid !== startingUid) {
        try { await compat.signOut(); }
        catch { authFault = true; current = null; adminP = null; throw problem("auth/sign-out-required", "Sign out before trying again"); }
      }
      syncCurrent();
      if (!needsVerification && before !== (current && current.uid)) location.reload();
      throw error;
    } finally { syncCurrent(); interactiveAuth = false; }
  }
  function trackUsage(u) {
    if (!u || !u.email || !u.emailVerified) return;
    const p = location.pathname, mod = /\/board\//.test(p) ? "collab" : /\/planning\//.test(p) ? "planning" : /\/itsm\//.test(p) ? "itsm" : /\/game\//.test(p) ? "game" : /\/sst\//.test(p) ? "sst" : /\/workspaces\//.test(p) ? "hub" : "";
    const day = new Date().toISOString().slice(0, 10), mark = "cm:use:" + day + ":" + mod;
    try { if (sessionStorage.getItem(mark)) return; } catch (e) { /* optional usage marker */ }
    const o = { email: u.email.toLowerCase(), last: window.firebase.database.ServerValue.TIMESTAMP };
    o["days/" + day] = true; if (mod) o["mods/" + mod] = window.firebase.database.ServerValue.TIMESTAMP;
    window.firebase.database().ref("users/" + key(u.email)).update(o).then(function () {
      try { sessionStorage.setItem(mark, "1"); } catch (e) { /* optional usage marker */ }
    }, function () { /* database rules govern access */ });
  }
  function registerAccount(u) {
    if (!u || !u.email || !u.emailVerified) return;
    setTimeout(function () { if (current && current.uid === u.uid && !interactiveAuth) trackUsage(u); }, 1500);
    try { if (sessionStorage.getItem("cm:acct") === u.uid) return; } catch (e) { /* optional account marker */ }
    const r = window.firebase.database().ref("users/" + key(u.email)), prov = ((u.providerData || [])[0] || {}).providerId || "password";
    r.update({ email: u.email.toLowerCase(), name: u.displayName || null, provider: prov, verified: !!u.emailVerified, last: window.firebase.database.ServerValue.TIMESTAMP }).then(function () {
      return r.child("first").transaction(function (v) { return v || Date.now(); });
    }).then(function () { try { sessionStorage.setItem("cm:acct", u.uid); } catch (e) { /* optional account marker */ } }, function () { /* database rules govern access */ });
  }
  function observe() {
    return new Promise(function (resolve, reject) {
      let initialized = false;
      compat.onAuthStateChanged(function (user) {
        if (interactiveAuth || authFault) return; // No registration/reload before MFA/verification.
        const previous = current && current.uid;
        current = user || null; adminP = null;
        if (initialized && previous !== (current && current.uid)) { location.reload(); return; }
        initialized = true; registerAccount(current); resolve(current);
      }, reject);
    });
  }
  async function completeEmailLink() {
    let link = bootLink; bootLink = null;
    const url = new URL(location.href);
    if (url.searchParams.get("mfaReauth") === "1") return;
    if (!link && sdk.isSignInWithEmailLink(modular, location.href)) { link = location.href; cleanLinkUrl(); }
    if (!link || !sdk.isSignInWithEmailLink(modular, link) || compat.currentUser) return;
    let email = null;
    try { email = localStorage.getItem(EMAIL_KEY); } catch (e) { /* ask in this tab */ }
    if (!email) email = window.prompt(t("Confirm your e-mail to finish signing in"));
    if (!email || !email.trim()) return;
    try {
      await withInteractive(function () { return sdk.signInWithEmailLink(modular, email.trim(), link); }, function (result) {
        try { localStorage.removeItem(EMAIL_KEY); } catch (e) { /* optional email hint */ }
        registerAccount(result && result.user); return result;
      });
    } finally { link = null; }
  }
  function ready() {
    if (!cfg || !cfg.databaseURL) return Promise.resolve(null);
    if (readyP) return readyP.then(function () { return current; });
    readyP = Promise.resolve().then(function () { return loadModule(moduleUrl("mfa/sdk.mjs")); }).then(async function (module) {
      if (!module.firebase || module.firebase.SDK_VERSION !== "13.4.0" || !module.sdk || typeof module.getApp !== "function") throw problem("auth/sdk-unavailable", "The reviewed authentication SDK is unavailable");
      if (window.firebase && window.firebase !== module.firebase) throw problem("auth/sdk-conflict", "Reload to use one authentication SDK");
      sdkModule = module; window.firebase = module.firebase; sdk = module.sdk;
      const app = window.firebase.apps.find(function (a) { return a.name === "[DEFAULT]"; }) || window.firebase.initializeApp(cfg);
      if (app.options && ["projectId", "databaseURL", "apiKey"].some(function (k) { return cfg[k] && app.options[k] !== cfg[k]; })) throw problem("auth/app-mismatch", "The authentication project does not match this site");
      compat = app.auth(); modular = sdk.getAuth(module.getApp(app.name));
      await observe();
      try { await completeEmailLink(); }
      catch (error) {
        if (error && error.code === "auth/sign-out-required") throw error;
        // No credential or provider error object is logged. A cancelled challenge
        // leaves an anonymous page; it never becomes a successful sign-in.
        if (!error || error.code !== "auth/mfa-cancelled") window.alert(t("Could not finish signing in. Request a new link or try again."));
      }
      return syncCurrent();
    });
    return readyP;
  }
  window.CMAuth = {
    enabled: !!(cfg && cfg.databaseURL), ready: ready, key: key,
    user: function () { return current; },
    db: function () { return window.firebase.database(); },
    isAdmin: function () {
      if (!current || !current.email || !current.emailVerified) return Promise.resolve(false);
      if (!adminP) adminP = window.firebase.database().ref("admins/" + key(current.email)).once("value").then(function (s) { return s.val() === true; }, function () { return false; });
      return adminP;
    },
    security: function () {
      return ready().then(function () {
        if (authFault) throw problem("auth/sign-out-required", "Sign out before trying again");
        if (!modular || !sdkModule) throw problem("auth/sdk-unavailable", "Authentication is not configured");
        return { auth: modular, sdk: sdk, compat: compat, runMfa: function (operation) { return withInteractive(operation); } };
      });
    },
    signInGoogle: function () {
      return ready().then(function () {
        return withInteractive(function () {
          const provider = new sdk.GoogleAuthProvider(); provider.setCustomParameters({ prompt: "select_account" });
          return sdk.signInWithPopup(modular, provider);
        }, function (result) { registerAccount(result && result.user); location.reload(); });
      });
    },
    signInMicrosoft: function () {
      return ready().then(function () {
        return withInteractive(function () {
          const provider = new sdk.OAuthProvider("microsoft.com"), params = { prompt: "select_account" };
          if (window.CMCOLLAB_MS_TENANT) params.tenant = window.CMCOLLAB_MS_TENANT;
          provider.setCustomParameters(params); return sdk.signInWithPopup(modular, provider);
        }, async function (result) {
          const user = result && result.user;
          if (user && !user.emailVerified) {
            await user.sendEmailVerification({ url: continuationUrl() });
            const error = new Error("NEEDS_VERIFICATION"); error.email = user.email; throw error;
          }
          registerAccount(user); location.reload();
        });
      });
    },
    sendLink: function (email) {
      return ready().then(function () {
        try { localStorage.setItem(EMAIL_KEY, email); } catch (e) { /* optional email hint */ }
        return compat.sendSignInLinkToEmail(email, { url: continuationUrl(), handleCodeInApp: true });
      });
    },
    signOut: function () {
      if (authFault && compat) return compat.signOut().then(function () { authFault = false; syncCurrent(); location.reload(); });
      return ready().then(function () { return withInteractive(function () { return compat.signOut(); }, function () { location.reload(); }); });
    }
  };
})();
