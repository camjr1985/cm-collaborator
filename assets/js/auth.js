/*
 * CM Collaborator – authentication & access layer (Firebase Auth + Realtime Database).
 * Security is enforced by database.rules.json on the server, not by this file.
 * This file only signs people in and reads what the rules allow them to read.
 *
 * window.CMAuth API
 *   enabled                     true when config.js has a Firebase config
 *   ready()                     Promise<user|null> (also completes e-mail sign-in links)
 *   user()                      current Firebase user or null
 *   key(email)                  database key for an e-mail ("a.b@x.com" -> "a,b@x,com")
 *   isAdmin()                   Promise<boolean>
 *   signInGoogle()              Promise
 *   signInMicrosoft()           Promise (Office 365; rejects with NEEDS_VERIFICATION after sending the verification e-mail)
 *   sendLink(email)             Promise – sends a passwordless sign-in link
 *   signOut()                   Promise
 *   db()                        firebase.database()
 */
(function () {
  "use strict";
  const cfg = window.CMCOLLAB_FIREBASE;
  const V = "10.12.2";
  const EMAIL_KEY = "cmcollab:emailForSignIn";
  let readyP = null, current = null, adminP = null;

  function key(email) { return String(email || "").trim().toLowerCase().replace(/\./g, ","); }
  function load(src) {
    return new Promise(function (res, rej) {
      if (document.querySelector('script[src="' + src + '"]')) return res();
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = function () { rej(new Error("Could not load " + src)); };
      document.head.appendChild(s);
    });
  }
  function base(name) { return "https://www.gstatic.com/firebasejs/" + V + "/firebase-" + name + "-compat.js"; }

  function cleanLinkUrl() {
    const u = new URL(location.href);
    ["apiKey", "oobCode", "mode", "lang", "continueUrl", "tenantId"].forEach(function (p) { u.searchParams.delete(p); });
    history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
  }
  function firstUser() { return new Promise(function (res) { const off = window.firebase.auth().onAuthStateChanged(function (u) { off(); res(u); }); }); }
  function completeEmailLink() {
    const a = window.firebase.auth();
    if (!a.isSignInWithEmailLink(location.href)) return Promise.resolve();
    /* already signed in (e.g. with Google, or the link was opened again): do not ask for the e-mail – just clean the address */
    return firstUser().then(function (cur) {
      if (cur) { cleanLinkUrl(); return; }
      let email = null;
      try { email = localStorage.getItem(EMAIL_KEY); } catch (e) { /* ignore */ }
      if (!email) email = window.prompt((window.MBt || String)("Confirm your e-mail to finish signing in"));
      if (!email) { cleanLinkUrl(); return; }
      return a.signInWithEmailLink(email.trim(), location.href).then(function () {
        try { localStorage.removeItem(EMAIL_KEY); } catch (e) { /* ignore */ }
        cleanLinkUrl();
      }, function (e) { cleanLinkUrl(); throw e; });
    });
  }
  /* every signed-in account is listed for the admins (Admin → Users), even before it gets any access */
  /* usage & adoption: one mark per day and per module (users/<key>/days/<YYYY-MM-DD>, users/<key>/mods/<module>) – read by Administration → Usage */
  function trackUsage(u) {
    if (!u || !u.email) return;
    const p = location.pathname, mod = /\/board\//.test(p) ? "collab" : /\/planning\//.test(p) ? "planning" : /\/itsm\//.test(p) ? "itsm" : /\/game\//.test(p) ? "game" : /\/sst\//.test(p) ? "sst" : /\/workspaces\//.test(p) ? "hub" : "";
    const day = new Date().toISOString().slice(0, 10), mark = "cm:use:" + day + ":" + mod;
    try { if (sessionStorage.getItem(mark)) return; } catch (e) { /* ignore */ }
    const o = { email: u.email.toLowerCase(), last: window.firebase.database.ServerValue.TIMESTAMP }; o["days/" + day] = true; if (mod) o["mods/" + mod] = window.firebase.database.ServerValue.TIMESTAMP;
    window.firebase.database().ref("users/" + key(u.email)).update(o).then(function () { try { sessionStorage.setItem(mark, "1"); } catch (e) { /* ignore */ } }, function () { /* rules not published yet */ });
  }
  function registerAccount(u) {
    if (!u || !u.email) return;
    setTimeout(function () { trackUsage(u); }, 1500);
    try { if (sessionStorage.getItem("cm:acct") === u.uid) return; } catch (e) { /* ignore */ }
    const r = window.firebase.database().ref("users/" + key(u.email)), prov = ((u.providerData || [])[0] || {}).providerId || "password";
    r.update({ email: u.email.toLowerCase(), name: u.displayName || null, provider: prov, verified: !!u.emailVerified, last: window.firebase.database.ServerValue.TIMESTAMP }).then(function () {
      return r.child("first").transaction(function (v) { return v || Date.now(); });
    }).then(function () { try { sessionStorage.setItem("cm:acct", u.uid); } catch (e) { /* ignore */ } }, function () { /* rules not published yet */ });
  }

  function ready() {
    if (!cfg || !cfg.databaseURL) return Promise.resolve(null);
    if (readyP) return readyP;
    readyP = load(base("app"))
      .then(function () { return Promise.all([load(base("auth")), load(base("database"))]); })
      .then(function () {
        if (!window.firebase.apps.length) window.firebase.initializeApp(cfg);
        return completeEmailLink().catch(function (e) { console.warn(e); if (e && e.code !== "auth/invalid-action-code" && e.code !== "auth/expired-action-code") alert(e.message); });
      })
      .then(function () {
        return new Promise(function (res) {
          const off = window.firebase.auth().onAuthStateChanged(function (u) { off(); current = u; registerAccount(u); res(u); });
        });
      });
    return readyP;
  }

  window.CMAuth = {
    enabled: !!(cfg && cfg.databaseURL),
    ready: ready,
    key: key,
    user: function () { return current; },
    db: function () { return window.firebase.database(); },
    isAdmin: function () {
      if (!current || !current.email) return Promise.resolve(false);
      if (!adminP) {
        adminP = window.firebase.database().ref("admins/" + key(current.email)).once("value")
          .then(function (s) { return s.val() === true; }, function () { return false; });
      }
      return adminP;
    },
    signInGoogle: function () {
      return ready().then(function () {
        const p = new window.firebase.auth.GoogleAuthProvider();
        p.setCustomParameters({ prompt: "select_account" });
        return window.firebase.auth().signInWithPopup(p);
      }).then(function () { location.reload(); });
    },
    /* Microsoft (Office 365 / Entra ID). Needs the Microsoft provider enabled in Firebase Auth (CMCOLLAB_MS_LOGIN = true).
       Firebase marks Microsoft e-mails as unverified: on the first sign-in we send a verification link, because the database
       rules only accept verified e-mails. Optional CMCOLLAB_MS_TENANT restricts sign-in to one company's tenant. */
    signInMicrosoft: function () {
      return ready().then(function () {
        const p = new window.firebase.auth.OAuthProvider("microsoft.com");
        const prm = { prompt: "select_account" }; if (window.CMCOLLAB_MS_TENANT) prm.tenant = window.CMCOLLAB_MS_TENANT;
        p.setCustomParameters(prm);
        return window.firebase.auth().signInWithPopup(p);
      }).then(function (res) {
        const u = res && res.user;
        if (u && !u.emailVerified) {
          return u.sendEmailVerification({ url: location.href.split("#")[0] }).then(function () {
            const e = new Error("NEEDS_VERIFICATION"); e.email = u.email; throw e;
          });
        }
        location.reload();
      });
    },
    sendLink: function (email) {
      return ready().then(function () {
        const url = location.href.split("#")[0];
        try { localStorage.setItem(EMAIL_KEY, email); } catch (e) { /* ignore */ }
        return window.firebase.auth().sendSignInLinkToEmail(email, { url: url, handleCodeInApp: true });
      });
    },
    signOut: function () {
      return ready().then(function () { return window.firebase.auth().signOut(); }).then(function () { location.reload(); });
    }
  };
})();
