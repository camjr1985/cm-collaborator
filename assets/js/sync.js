/*
 * CM Collaborator sync layer.
 * Two adapters with the same API:
 *   init(onRemote)        -> Promise<data|null>   initial board data
 *   put(path, value)      -> write (value null = delete). path like "stickies/abc"
 *   presence(me)          -> publish my presence/cursor ({id,name,color,x,y})
 *   onPresence(cb)        -> cb({id: {name,color,x,y,t}})
 *   mode                  -> "local" | "live"
 */
(function () {
  "use strict";

  function setPath(obj, path, val) {
    const parts = path.split("/");
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!o[parts[i]] || typeof o[parts[i]] !== "object") o[parts[i]] = {};
      o = o[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (val === null || val === undefined) delete o[last];
    else o[last] = val;
  }

  /* ---------------- Local adapter (localStorage + BroadcastChannel) ---------------- */
  function createLocal(boardId) {
    const KEY = "cmcollab:" + boardId;
    const ch = "BroadcastChannel" in window ? new BroadcastChannel("cmcollab:" + boardId) : null;
    let data = {};
    let onRemote = function () {};
    let presenceCb = function () {};
    const peers = {};
    let saveOk = true;

    function read() {
      try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
    }
    function persist() {
      try { localStorage.setItem(KEY, JSON.stringify(data)); saveOk = true; }
      catch (e) { saveOk = false; }
    }
    if (ch) {
      ch.onmessage = function (ev) {
        const m = ev.data || {};
        if (m.type === "put") { setPath(data, m.path, m.value); onRemote(m.path, m.value); }
        else if (m.type === "presence") { peers[m.me.id] = Object.assign({}, m.me, { t: Date.now() }); emitPresence(); }
        else if (m.type === "leave") { delete peers[m.id]; emitPresence(); }
        else if (m.type === "reload") { data = read() || {}; onRemote("*", data); }
      };
    }
    function emitPresence() {
      const now = Date.now();
      Object.keys(peers).forEach(function (k) { if (now - peers[k].t > 12000) delete peers[k]; });
      presenceCb(Object.assign({}, peers));
    }
    setInterval(emitPresence, 4000);

    return {
      mode: "local",
      get saveOk() { return saveOk; },
      init: function (cb) { onRemote = cb; data = read() || {}; return Promise.resolve(data); },
      put: function (path, value) {
        setPath(data, path, value);
        persist();
        if (ch) ch.postMessage({ type: "put", path: path, value: value === undefined ? null : value });
        return Promise.resolve();
      },
      replaceAll: function (newData) {
        data = newData || {};
        persist();
        if (ch) ch.postMessage({ type: "reload" });
        return Promise.resolve();
      },
      presence: function (me) { if (ch) ch.postMessage({ type: "presence", me: me }); },
      leave: function (id) { if (ch) ch.postMessage({ type: "leave", id: id }); },
      onPresence: function (cb) { presenceCb = cb; }
    };
  }

  /* ---------------- Firebase Realtime Database adapter (needs auth.js) ---------------- */
  function createFirebase(boardId) {
    let ref, presRef, myPresRef;
    let presenceCb = function () {};
    function boot() {
      return window.CMAuth.ready().then(function () {
        const db = window.CMAuth.db();
        ref = db.ref("boards/" + boardId + "/data");
        presRef = db.ref("boards/" + boardId + "/presence");
      });
    }
    let booted = null;
    function b() { return booted || (booted = boot()); }

    return {
      mode: "live",
      saveOk: true,
      init: function (onRemote) {
        return b().then(function () {
          return ref.once("value").then(function (snap) {
            const data = snap.val() || {};
            ["stickies", "fields", "photos", "images", "meta"].forEach(function (col) {
              const c = ref.child(col);
              c.on("child_added", function (s) { onRemote(col + "/" + s.key, s.val()); });
              c.on("child_changed", function (s) { onRemote(col + "/" + s.key, s.val()); });
              c.on("child_removed", function (s) { onRemote(col + "/" + s.key, null); });
            });
            presRef.on("value", function (s) { presenceCb(s.val() || {}); });
            return data;
          });
        });
      },
      put: function (path, value) {
        return b().then(function () { return ref.child(path).set(value === undefined ? null : value); });
      },
      replaceAll: function (newData) {
        return b().then(function () { return ref.set(newData || {}); });
      },
      presence: function (me) {
        if (!presRef) return;
        if (!myPresRef) {
          myPresRef = presRef.child(me.id);
          myPresRef.onDisconnect().remove();
        }
        myPresRef.set(Object.assign({}, me, { t: Date.now() })).catch(function () { /* viewers may not publish */ });
      },
      leave: function () { if (myPresRef) myPresRef.remove(); },
      onPresence: function (cb) { presenceCb = cb; }
    };
  }

  window.MBSync = {
    create: function (boardId) {
      if (window.CMAuth && window.CMAuth.enabled) return createFirebase(boardId);
      return createLocal(boardId);
    },
    setPath: setPath
  };
})();
