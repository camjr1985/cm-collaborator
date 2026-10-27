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

  function completeEmailLink() {
    const a = window.firebase.auth();
    if (!a.isSignInWithEmailLink(location.href)) return Promise.resolve();
    let email = null;
    try { email = localStorage.getItem(EMAIL_KEY); } catch (e) { /* ignore */ }
    if (!email) email = window.prompt((window.MBt || String)("Confirm your e-mail to finish signing in"));
    if (!email) return Promise.resolve();
    return a.signInWithEmailLink(email, location.href).then(function () {
      try { localStorage.removeItem(EMAIL_KEY); } catch (e) { /* ignore */ }
      const u = new URL(location.href);
      ["apiKey", "oobCode", "mode", "lang", "continueUrl", "tenantId"].forEach(function (p) { u.searchParams.delete(p); });
      history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
    });
  }

  function ready() {
    if (!cfg || !cfg.databaseURL) return Promise.resolve(null);
    if (readyP) return readyP;
    readyP = load(base("app"))
      .then(function () { return Promise.all([load(base("auth")), load(base("database"))]); })
      .then(function () {
        if (!window.firebase.apps.length) window.firebase.initializeApp(cfg);
        return completeEmailLink().catch(function (e) { console.warn(e); alert(e.message); });
      })
      .then(function () {
        return new Promise(function (res) {
          const off = window.firebase.auth().onAuthStateChanged(function (u) { off(); current = u; res(u); });
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
