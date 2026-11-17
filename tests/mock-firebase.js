/* Minimal Firebase compat mock for UI tests (Playwright). In-memory Realtime Database persisted in localStorage ("mockdb"),
 * signed-in user from localStorage ("mockuser" = e-mail). Optional window.__DENY(path, op) simulates security rules. */
(function () {
  "use strict";
  if (window.firebase && window.firebase.__mock) return;
  const LS = window.localStorage;
  let root = {};
  try { root = JSON.parse(LS.getItem("mockdb") || "{}"); } catch (e) { root = {}; }
  const listeners = [];
  function save() { try { LS.setItem("mockdb", JSON.stringify(root)); } catch (e) { /* ignore */ } }
  function parts(p) { return String(p || "").split("/").filter(Boolean); }
  function get(p) { let n = root; for (const k of parts(p)) { if (n == null || typeof n !== "object") return null; n = n[k]; } return n === undefined ? null : n; }
  function clone(v) { return v == null ? null : JSON.parse(JSON.stringify(v)); }
  function resolve(v) {
    if (v && typeof v === "object") {
      if (v[".sv"] === "timestamp") return Date.now();
      const o = Array.isArray(v) ? [] : {};
      Object.keys(v).forEach(function (k) { if (v[k] === undefined) throw new Error("Mock: undefined value at " + k); const r = resolve(v[k]); if (r !== null) o[k] = r; });
      return Object.keys(o).length ? o : null;
    }
    if (typeof v === "number" && !isFinite(v)) throw new Error("Mock: invalid number");
    return v === undefined ? null : v;
  }
  function put(p, v) {
    const ks = parts(p); v = resolve(v);
    if (!ks.length) { root = v || {}; return; }
    let n = root;
    for (let i = 0; i < ks.length - 1; i++) { if (n[ks[i]] == null || typeof n[ks[i]] !== "object") n[ks[i]] = {}; n = n[ks[i]]; }
    if (v === null) delete n[ks[ks.length - 1]]; else n[ks[ks.length - 1]] = v;
    prune(root);
  }
  function prune(n) { if (!n || typeof n !== "object") return; Object.keys(n).forEach(function (k) { if (n[k] && typeof n[k] === "object") { prune(n[k]); if (!Object.keys(n[k]).length) delete n[k]; } }); }
  function deny(p, op) { return typeof window.__DENY === "function" && window.__DENY(p, op, user && user.email); }
  function related(a, b) { a = parts(a).join("/"); b = parts(b).join("/"); return !a || !b || a === b || a.indexOf(b + "/") === 0 || b.indexOf(a + "/") === 0; }
  function fire(paths) {
    save();
    setTimeout(function () {
      listeners.slice().forEach(function (l) { if (paths.some(function (p) { return related(p, l.path); })) { const s = JSON.stringify(get(l.path)); if (s !== l.last) { l.last = s; l.cb(snap(l.path)); } } });
    }, 0);
  }
  function snap(p) {
    const v = clone(get(p)), ks = parts(p);
    return { key: ks[ks.length - 1] || null, val: function () { return clone(v); }, exists: function () { return v !== null; }, child: function (c) { return snap(ks.concat(parts(c)).join("/")); },
      forEach: function (f) { Object.keys(v || {}).forEach(function (k) { f(snap(ks.concat([k]).join("/"))); }); } };
  }
  function err(p) { const e = new Error("permission_denied at /" + p + ": Client doesn't have permission to access the desired data."); e.code = "PERMISSION_DENIED"; return e; }
  function ref(p) {
    p = parts(p).join("/");
    const r = {
      key: parts(p).slice(-1)[0] || null, path: p,
      child: function (c) { return ref(p + "/" + c); },
      once: function () { return new Promise(function (res, rej) { setTimeout(function () { deny(p, "read") ? rej(err(p)) : res(snap(p)); }, 1); }); },
      on: function (ev, cb, ecb) {
        setTimeout(function () {
          if (deny(p, "read")) { if (ecb) ecb(err(p)); return; }
          const l = { path: p, cb: cb, last: JSON.stringify(get(p)) }; listeners.push(l); cb(snap(p));
        }, 1);
        return cb;
      },
      off: function () { for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i].path === p) listeners.splice(i, 1); },
      set: function (v) { return new Promise(function (res, rej) { setTimeout(function () { if (deny(p, "write")) return rej(err(p)); try { put(p, v); } catch (e) { return rej(e); } fire([p]); res(); }, 1); }); },
      update: function (o) {
        return new Promise(function (res, rej) {
          setTimeout(function () {
            const ks = Object.keys(o);
            for (const k of ks) if (deny(p ? p + "/" + k : k, "write")) return rej(err(p ? p + "/" + k : k));
            try { ks.forEach(function (k) { put(p ? p + "/" + k : k, o[k]); }); } catch (e) { return rej(e); }
            fire(ks.map(function (k) { return p ? p + "/" + k : k; })); res();
          }, 1);
        });
      },
      remove: function () { return r.set(null); },
      push: function (v) { const k = "-m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), c = ref(p + "/" + k); if (v !== undefined) { const pr = c.set(v); c.then = pr.then.bind(pr); } return c; },
      transaction: function (fn) { return new Promise(function (res) { setTimeout(function () { const nv = fn(clone(get(p))); put(p, nv); fire([p]); res({ committed: true, snapshot: snap(p) }); }, 1); }); },
      onDisconnect: function () { return { remove: function () {}, set: function () {} }; }
    };
    return r;
  }
  let user = null;
  const email = LS.getItem("mockuser");
  if (email) user = { email: email, displayName: LS.getItem("mockname") || email.split("@")[0], emailVerified: true, uid: email, getIdToken: function () { return Promise.resolve("mock-token"); } };
  const db = { ref: ref };
  const auth = { currentUser: user, onAuthStateChanged: function (cb) { setTimeout(function () { cb(user); }, 1); return function () {}; },
    isSignInWithEmailLink: function () { return false; }, signOut: function () { LS.removeItem("mockuser"); return Promise.resolve(); } };
  const fb = { __mock: true, apps: [], initializeApp: function () { fb.apps.push({}); }, auth: function () { return auth; }, database: function () { return db; } };
  fb.database.ServerValue = { TIMESTAMP: { ".sv": "timestamp" } };
  fb.auth.GoogleAuthProvider = function () { this.setCustomParameters = function () {}; };
  window.firebase = fb;
  window.__mockdb = { get: get, put: function (p, v) { put(p, v); fire([p]); } };
})();
