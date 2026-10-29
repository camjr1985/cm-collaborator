/* CM Collaborator – "My boards" dashboard (Miro-style): start something new, recents, workspaces */
(function () {
  "use strict";
  const A = window.CMAuth;
  const el = document.getElementById("hub");
  const t = function (s) { return (window.MBt || String)(s); };
  const TPL = window.MBTemplateList ? window.MBTemplateList() : [];
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function slug(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48); }
  function rnd() { return Math.random().toString(36).slice(2, 6); }
  function pv(tpl) { return window.MBTemplatePreview ? window.MBTemplatePreview(tpl || "persona") : ""; }
  function tplName(id) { const x = TPL.find(function (p) { return p.id === id; }); return x ? x.name : ""; }
  function boardUrl(id, tpl) { return "../board/?id=" + encodeURIComponent(id) + (tpl && !(A && A.enabled) ? "&tpl=" + encodeURIComponent(tpl) : ""); }
  function recents() { try { return JSON.parse(localStorage.getItem("cmcollab:recent")) || []; } catch (e) { return []; } }
  function ago(ts) {
    const d = (Date.now() - ts) / 1000;
    if (d < 3600) return t("Opened") + " " + Math.max(1, Math.round(d / 60)) + " min";
    if (d < 86400) return t("Opened") + " " + Math.round(d / 3600) + " h";
    return t("Opened") + " " + new Date(ts).toLocaleDateString();
  }
  function toast(msg) {
    let n = document.getElementById("toast");
    if (!n) { n = document.createElement("div"); n.id = "toast"; n.className = "site-toast"; n.setAttribute("role", "status"); document.body.appendChild(n); }
    n.textContent = t(msg); n.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { n.classList.remove("show"); }, 2600);
  }

  /* ---------------- pieces ---------------- */
  function startStrip(canCreate) {
    if (!canCreate) return "";
    return '<section class="hub-sec"><div class="hub-sec-head"><h2>Start something new</h2><span class="muted small">' + t("Pick a template – everything stays editable.") + "</span></div>" +
      '<div class="tpl-strip">' + TPL.map(function (x) {
        return '<button class="tpl-tile' + (x.id === "blank" ? " blank" : "") + '" data-new="' + x.id + '"><span class="tpl-pv">' + pv(x.id) + '</span><b class="no-i18n">' + esc(x.name) + "</b></button>";
      }).join("") + "</div></section>";
  }
  function recentRows(allowed) {
    const r = recents().filter(function (x) { return !allowed || allowed[x.id]; }).slice(0, 6);
    if (!r.length) return "";
    return '<section class="hub-sec"><div class="hub-sec-head"><h2>Jump back to recents</h2></div><div class="recent-list">' + r.map(function (x) {
      const info = allowed ? allowed[x.id] : x;
      return '<a class="recent-row" href="' + boardUrl(x.id, x.template) + '"><span class="rr-pv">' + pv((info && info.template) || x.template) + '</span><span class="rr-t"><b class="no-i18n">' + esc((info && info.title) || x.title) + '</b><span class="muted small no-i18n">' + esc((info && info.ws) || tplName(x.template)) + '</span></span><span class="muted small">' + ago(x.t) + "</span></a>";
    }).join("") + "</div></section>";
  }
  function boardCard(id, b, wsName) {
    return '<a class="board-card" href="' + boardUrl(id, b.template) + '" data-title="' + esc((b.title || "").toLowerCase()) + '"><span class="tpl-pv">' + pv(b.template) + '</span>' +
      '<span class="bc-t"><b class="no-i18n">' + esc(b.title || id) + '</b><span class="muted small no-i18n">' + esc(wsName || tplName(b.template)) + "</span></span></a>";
  }
  function wsSection(id, w, admin) {
    const boards = w.boards || {};
    const ids = Object.keys(boards).sort(function (a, b) { return (boards[b].created || 0) - (boards[a].created || 0); });
    const name = (w.info || {}).name || id;
    return '<section class="hub-sec ws-sec"><div class="hub-sec-head"><h2 class="no-i18n">' + esc(name) + '</h2><span class="muted small">' + ids.length + " " + t(ids.length === 1 ? "board" : "boards") + "</span>" +
      (admin ? '<button class="btn sm ghost" data-newin="' + id + '">+ <span>New board</span></button>' : "") + "</div>" +
      (ids.length ? '<div class="board-grid">' + ids.map(function (b) { return boardCard(b, boards[b], tplName(boards[b].template)); }).join("") + "</div>"
        : '<div class="card empty-big"><p class="muted">' + t(admin ? "No boards in this workspace yet. Create one with “New board”." : "No boards in this workspace yet.") + "</p></div>") + "</section>";
  }
  function searchBar() {
    return '<div class="hub-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="hubSearch" type="search" placeholder="' + esc(t("Search boards")) + '"></div>';
  }
  function bindSearch() {
    const s = document.getElementById("hubSearch"); if (!s) return;
    s.oninput = function () {
      const q = s.value.trim().toLowerCase();
      document.querySelectorAll(".board-card").forEach(function (c) { c.hidden = q && c.dataset.title.indexOf(q) < 0; });
      document.querySelectorAll(".ws-sec").forEach(function (sec) { sec.hidden = q && !sec.querySelector(".board-card:not([hidden])"); });
    };
  }

  /* ---------------- create board dialog ---------------- */
  function createDialog(tplId, wss, presetWs) {
    const wsIds = Object.keys(wss || {}).sort(function (a, b) { return ((wss[a].info || {}).name || "").localeCompare((wss[b].info || {}).name || ""); });
    const live = A && A.enabled;
    let h = '<div class="modal-lite" id="newDlg"><div class="card new-card"><div class="new-pv">' + pv(tplId) + '</div><div class="new-form"><h2>New board</h2><p class="muted small no-i18n">' + esc(tplName(tplId)) + "</p>" +
      '<form id="newForm"><label class="lbl-f">' + t("Board name") + '<input name="title" required placeholder="' + esc(t("e.g. Sprint 12 retrospective")) + '" autocomplete="off"></label>';
    if (live) {
      h += '<label class="lbl-f">Workspace<select name="ws">' + wsIds.map(function (id) { return '<option value="' + id + '"' + (id === presetWs ? " selected" : "") + ">" + esc(wss[id].info.name) + "</option>"; }).join("") +
        '<option value="__new">' + t("+ New workspace…") + '</option></select></label><label class="lbl-f" id="newWsRow"' + (wsIds.length ? " hidden" : "") + ">" + t("New workspace name") + '<input name="wsname" placeholder="' + esc(t("e.g. Mentoring – Joaquim")) + '" autocomplete="off"></label>';
    }
    h += '<div class="row-end"><button type="button" class="btn" id="newCancel">Cancel</button><button class="btn primary">Create board</button></div></form></div></div></div>';
    document.body.insertAdjacentHTML("beforeend", h);
    const dlg = document.getElementById("newDlg"), f = document.getElementById("newForm");
    if (live && !wsIds.length) f.ws.value = "__new";
    function close() { dlg.remove(); }
    document.getElementById("newCancel").onclick = close;
    dlg.onclick = function (e) { if (e.target === dlg) close(); };
    if (live) f.ws.onchange = function () { document.getElementById("newWsRow").hidden = f.ws.value !== "__new"; };
    setTimeout(function () { f.title.focus(); }, 30);
    f.onsubmit = function (e) {
      e.preventDefault();
      const title = f.title.value.trim(); if (!title) return;
      const id = (slug(title) || "board") + "-" + rnd();
      if (!live) { location.href = boardUrl(id, tplId); return; }
      const db = A.db(), TS = window.firebase.database.ServerValue.TIMESTAMP, me = A.user(), u = {};
      let ws = f.ws.value;
      if (ws === "__new") {
        const wn = (f.wsname.value || "").trim();
        if (!wn) return toast("Give the workspace a name");
        ws = (slug(wn) || "workspace") + "-" + rnd();
        u["workspaces/" + ws + "/info"] = { name: wn, created: TS, createdBy: me.email };
      }
      u["boards/" + id + "/info"] = { title: title, ws: ws, template: tplId, created: TS, createdBy: me.email };
      u["workspaces/" + ws + "/boards/" + id] = { title: title, template: tplId, created: TS };
      f.querySelector(".btn.primary").disabled = true;
      db.ref().update(u).then(function () { location.href = boardUrl(id); }, function (err) { f.querySelector(".btn.primary").disabled = false; toast(err.message); });
    };
  }

  /* ---------------- screens ---------------- */
  function demo() {
    el.innerHTML = '<div class="notice"><b>Demo mode.</b> <span>Sign-in and private access switch on as soon as Firebase is configured (see README). Until then, boards are saved only in your browser.</span></div>' +
      searchBar() + startStrip(true) + recentRows(null);
    el.querySelectorAll("[data-new]").forEach(function (b) { b.onclick = function () { createDialog(b.dataset.new, {}); }; });
    bindSearch();
  }
  function login() {
    el.innerHTML = '<div class="card auth-card"><h2>Sign in</h2><p class="muted">Boards are private. Only people invited by the mentor can open them.</p>' +
      '<button class="btn primary full" id="gBtn"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"/><path fill="currentColor" opacity=".75" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="currentColor" opacity=".55" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z"/><path fill="currentColor" opacity=".9" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6z"/></svg><span>Continue with Google</span></button>' +
      '<div class="or"><span>or</span></div>' +
      '<form id="linkForm"><label class="lbl-f">E-mail<input type="email" id="linkEmail" required placeholder="name@email.com" autocomplete="email"></label>' +
      '<button class="btn full">Send me a sign-in link</button></form><p class="muted small" id="authMsg" role="status"></p></div>';
    document.getElementById("gBtn").onclick = function () {
      A.signInGoogle().catch(function (e) { document.getElementById("authMsg").textContent = e.message; });
    };
    document.getElementById("linkForm").onsubmit = function (e) {
      e.preventDefault();
      const email = document.getElementById("linkEmail").value.trim();
      const msg = document.getElementById("authMsg");
      msg.textContent = t("Sending…");
      A.sendLink(email).then(function () { msg.textContent = t("Check your inbox: we sent you a sign-in link. Open it on this device."); },
        function (err) { msg.textContent = err.message; });
    };
  }
  function userBar(user, admin) {
    return '<div class="userbar"><span class="muted"><span>Signed in as</span> <b class="no-i18n">' + esc(user.email) + "</b></span>" +
      (admin ? '<a class="btn" href="../admin/">Administration</a>' : "") + '<button class="btn" id="soBtn">Sign out</button></div>';
  }
  function list(user) {
    const db = A.db();
    A.isAdmin().then(function (admin) {
      const navAdmin = document.getElementById("navAdmin");
      if (admin && navAdmin) navAdmin.hidden = false;
      const p = admin
        ? db.ref("workspaces").once("value").then(function (s) { return s.val() || {}; })
        : db.ref("userWorkspaces/" + A.key(user.email)).once("value").then(function (s) {
          const ids = Object.keys(s.val() || {});
          return Promise.all(ids.map(function (id) {
            return db.ref("workspaces/" + id).once("value").then(function (x) { return [id, x.val()]; }, function () { return [id, null]; });
          })).then(function (rows) { const o = {}; rows.forEach(function (r) { if (r[1]) o[r[0]] = r[1]; }); return o; });
        });
      return p.then(function (wss) {
        const ids = Object.keys(wss).sort(function (a, b) { return ((wss[a].info || {}).name || "").localeCompare((wss[b].info || {}).name || ""); });
        const allowed = {};
        ids.forEach(function (w) { const bs = wss[w].boards || {}; Object.keys(bs).forEach(function (b) { allowed[b] = { title: bs[b].title, template: bs[b].template, ws: (wss[w].info || {}).name }; }); });
        el.innerHTML = userBar(user, admin) + searchBar() + startStrip(admin) + recentRows(allowed) +
          (ids.length ? ids.map(function (id) { return wsSection(id, wss[id], admin); }).join("")
            : '<div class="card empty-big"><h3>No boards yet</h3><p class="muted">' + (admin ? t("Pick a template above to create your first board.") : t("Ask your mentor to invite this e-mail address.")) + "</p></div>");
        document.getElementById("soBtn").onclick = A.signOut;
        el.querySelectorAll("[data-new]").forEach(function (b) { b.onclick = function () { createDialog(b.dataset.new, wss); }; });
        el.querySelectorAll("[data-newin]").forEach(function (b) {
          b.onclick = function () {
            const strip = el.querySelector(".tpl-strip");
            if (strip) { strip.scrollIntoView({ behavior: "smooth", block: "center" }); strip.dataset.ws = b.dataset.newin; strip.classList.add("pulse"); setTimeout(function () { strip.classList.remove("pulse"); }, 1200); }
            el.querySelectorAll("[data-new]").forEach(function (x) { x.onclick = function () { createDialog(x.dataset.new, wss, b.dataset.newin); }; });
          };
        });
        bindSearch();
      });
    }).catch(function (e) { el.innerHTML = '<div class="notice">' + esc(e.message) + "</div>"; });
  }
  function start() {
    if (!A || !A.enabled) return demo();
    el.innerHTML = '<p class="muted">' + t("Loading…") + "</p>";
    A.ready().then(function (user) {
      if (!user) return login();
      const next = new URLSearchParams(location.search).get("next");
      if (next && /^\/[^/]/.test(next)) { location.replace(next); return; }
      list(user);
    }).catch(function (e) { el.innerHTML = '<div class="notice">' + esc(e.message) + "</div>"; });
  }
  start();
})();
