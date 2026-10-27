/*
 * CM Collaborator – collaborative whiteboard engine
 * Pages only need to define window.BOARD_CONFIG and load:
 *   config.js, sync.js, templates/<template>.js, board.js
 */
(function () {
  "use strict";

  const CFG = window.BOARD_CONFIG || {};
  const T = window.MB_TEMPLATES[CFG.template || "persona"];
  const W = T.world.w, H = T.world.h;
  const VOTES = window.CMCOLLAB_VOTES_PER_USER || 5;
  const ROOT = CFG.root || "./";
  const PALETTE = ["#FFF59D", "#FFCF8A", "#F7A8B0", "#F6C1E4", "#CDBDF6", "#A9D1F7", "#9FE3D3", "#C8EBA1", "#E6E6E6"];
  const PEOPLE_COLORS = ["#4262FF", "#E5484D", "#12A594", "#F76B15", "#8E4EC6", "#D6409F", "#0090FF", "#3E9B4F"];

  const S = { stickies: {}, fields: {}, photos: {}, meta: {} };
  const els = {};
  let sync;
  let view = { x: 0, y: 0, s: 1 };
  let selected = null, editing = null, dragging = null;
  const undoStack = [], redoStack = [];
  let peers = {};
  let panelTab = "ranking";
  let me = loadMe();

  /* ---------------- helpers ---------------- */
  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3); }
  function clone(v) { return v === undefined ? null : JSON.parse(JSON.stringify(v)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function getPath(path) {
    return path.split("/").reduce(function (o, k) { return o == null ? undefined : o[k]; }, S);
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function loadMe() {
    let m = null;
    try { m = JSON.parse(lsGet("cmcollab:user")); } catch (e) { m = null; }
    if (!m || !m.id) m = { id: uid(), name: "", color: PEOPLE_COLORS[Math.floor(Math.random() * PEOPLE_COLORS.length)] };
    return m;
  }
  function saveMe() { lsSet("cmcollab:user", JSON.stringify(me)); }
  function initials(n) { return (n || "?").trim().split(/\s+/).slice(0, 2).map(function (p) { return p[0]; }).join("").toUpperCase(); }
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { els.toast.classList.remove("show"); }, 2200);
  }
  function timeAgo(t) {
    const d = (Date.now() - t) / 1000;
    if (d < 60) return "just now";
    if (d < 3600) return Math.floor(d / 60) + "m ago";
    if (d < 86400) return Math.floor(d / 3600) + "h ago";
    return new Date(t).toLocaleDateString();
  }

  /* ---------------- icons ---------------- */
  const I = {
    sticky: '<path d="M4 4h16v11l-5 5H4z"/><path d="M15 20v-5h5"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
    upload: '<path d="M12 20V9M7 14l5-5 5 5M4 4h16"/>',
    print: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
    comment: '<path d="M4 5h16v11H9l-5 4z"/>',
    vote: '<circle cx="12" cy="12" r="5" fill="currentColor"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'
  };
  function ico(n) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + I[n] + "</svg>"; }

  /* ---------------- shell ---------------- */
  function buildShell() {
    const crumbs = (CFG.crumbs || []).map(function (c) { return c.href ? '<a href="' + c.href + '">' + esc(c.label) + "</a>" : "<span>" + esc(c.label) + "</span>"; }).join('<i>/</i>');
    document.body.className = "board-page";
    document.body.innerHTML =
      '<header class="topbar">' +
      '<a class="brand" href="' + ROOT + '"><span class="logo">CM</span><span>CM Collaborator</span></a>' +
      '<nav class="crumbs" aria-label="Breadcrumb">' + crumbs + "</nav>" +
      '<div class="spacer"></div>' +
      '<button id="timerBtn" class="timer" title="Session timer">' + ico("timer") + '<span id="timerTxt">Timer</span></button>' +
      '<div id="people" class="people" aria-label="People on this board"></div>' +
      '<span id="syncPill" class="pill"></span>' +
      '<div class="lang" data-lang-switch></div>' +
      '<button id="btnShare" class="btn primary">' + ico("share") + "<span>Share</span></button>" +
      '<button id="btnPanel" class="icon-btn" title="Ranking & comments">' + ico("panel") + "</button>" +
      (CFG.isAdmin ? '<a class="icon-btn" href="' + ROOT + 'admin/" title="Administration">' + ico("lock") + "</a>" : "") +
      (CFG.signedIn ? '<button id="btnSignOut" class="icon-btn" title="Sign out">' + ico("logout") + "</button>" : "") +
      "</header>" +
      '<main id="viewport" tabindex="-1"><div id="world"><div id="tpl"></div><div id="stickies"></div><div id="cursors"></div></div></main>' +
      '<aside id="toolbar" aria-label="Tools">' +
      '<div class="tool-sticky"><button class="tb" id="tbSticky" title="Add post-it (N)">' + ico("sticky") + "</button>" +
      '<div class="swatches" id="addSwatches"></div></div>' +
      '<span class="sep"></span>' +
      '<button class="tb" id="tbUndo" title="Undo (Ctrl+Z)">' + ico("undo") + "</button>" +
      '<button class="tb" id="tbRedo" title="Redo (Ctrl+Shift+Z)">' + ico("redo") + "</button>" +
      '<span class="sep"></span>' +
      '<button class="tb" id="tbExport" title="Export board (JSON)">' + ico("download") + "</button>" +
      '<button class="tb" id="tbImport" title="Import board (JSON)">' + ico("upload") + "</button>" +
      '<button class="tb" id="tbPrint" title="Print / save as PDF">' + ico("print") + "</button>" +
      '<button class="tb" id="tbReset" title="Reset board">' + ico("reset") + "</button>" +
      '<span class="sep"></span>' +
      '<button class="tb" id="tbHelp" title="How to use">' + ico("help") + "</button>" +
      "</aside>" +
      '<div id="zoombar"><button class="tb" id="zOut" title="Zoom out">' + ico("minus") + '</button><button id="zPct" title="Reset to 100%">100%</button>' +
      '<button class="tb" id="zIn" title="Zoom in">' + ico("plus") + '</button><button class="tb" id="zFit" title="Fit board (F)">' + ico("fit") + "</button></div>" +
      '<div id="ctx" hidden><div class="ctx-colors" id="ctxColors"></div><span class="sep v"></span>' +
      '<button class="cb" id="cVote" title="Vote (dot voting)">' + ico("vote") + '<span id="cVoteN"></span></button>' +
      '<button class="cb" id="cUnvote" title="Remove my vote">−</button>' +
      '<button class="cb" id="cComment" title="Comments">' + ico("comment") + "</button>" +
      '<button class="cb txt" id="cRice" title="RICE score">RICE</button>' +
      '<button class="cb" id="cDup" title="Duplicate (Ctrl+D)">' + ico("copy") + "</button>" +
      '<button class="cb danger" id="cDel" title="Delete (Del)">' + ico("trash") + "</button></div>" +
      '<aside id="panel" hidden><div class="panel-head"><div class="tabs" role="tablist">' +
      '<button data-tab="ranking" role="tab">Ranking</button><button data-tab="comments" role="tab">Comments</button><button data-tab="votes" role="tab">Votes</button></div>' +
      '<button class="icon-btn" id="panelClose" title="Close">' + ico("close") + '</button></div><div id="panelBody"></div></aside>' +
      '<div id="toast" role="status"></div>' +
      '<input type="file" id="fileImport" accept="application/json" hidden><input type="file" id="filePhoto" accept="image/*" hidden>' +
      '<div class="modal" id="modal" hidden><div class="modal-card" role="dialog" aria-modal="true"><div id="modalBody"></div></div></div>' +
      '<div class="onboard" id="onboard" hidden></div>';

    ["viewport", "world", "tpl", "stickies", "cursors", "toolbar", "ctx", "panel", "panelBody", "toast", "modal", "modalBody", "people", "syncPill", "zPct", "timerTxt", "timerBtn"].forEach(function (id) { els[id] = document.getElementById(id); });
    els.tpl.innerHTML = T.html;
    els.world.style.width = W + "px";
    els.world.style.height = H + "px";

    $("#addSwatches").innerHTML = PALETTE.map(function (c) { return '<button style="background:' + c + '" data-c="' + c + '" title="Add post-it"></button>'; }).join("");
    $("#ctxColors").innerHTML = PALETTE.map(function (c) { return '<button style="background:' + c + '" data-c="' + c + '" title="Change colour"></button>'; }).join("");
    document.title = (CFG.title || "Board") + " · CM Collaborator";
  }

  /* ---------------- view (pan / zoom) ---------------- */
  function applyView() {
    els.world.style.transform = "translate(" + view.x + "px," + view.y + "px) scale(" + view.s + ")";
    const g = 24 * view.s;
    els.viewport.style.backgroundSize = g + "px " + g + "px";
    els.viewport.style.backgroundPosition = view.x + "px " + view.y + "px";
    els.zPct.textContent = Math.round(view.s * 100) + "%";
    els.world.classList.toggle("far", view.s < 0.45);
    positionCtx();
  }
  function fit() {
    const r = els.viewport.getBoundingClientRect();
    const s = Math.min(r.width / W, r.height / H) * 0.94;
    view = { s: s, x: (r.width - W * s) / 2, y: (r.height - H * s) / 2 };
    applyView();
  }
  function zoomAt(px, py, ns) {
    ns = Math.max(0.12, Math.min(3, ns));
    view.x = px - (px - view.x) * (ns / view.s);
    view.y = py - (py - view.y) * (ns / view.s);
    view.s = ns;
    applyView();
  }
  function zoomCenter(f) { const r = els.viewport.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, view.s * f); }
  function toWorld(cx, cy) {
    const r = els.viewport.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.s, y: (cy - r.top - view.y) / view.s };
  }
  function focusSticky(id) {
    const s = S.stickies[id]; if (!s) return;
    const r = els.viewport.getBoundingClientRect();
    const ns = Math.max(view.s, 0.9);
    view.s = ns;
    view.x = r.width / 2 - (s.x + (s.w || 120) / 2) * ns;
    view.y = r.height / 2 - (s.y + (s.h || 120) / 2) * ns;
    applyView();
    select(id);
    const el = els.stickyEls[id];
    if (el) { el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); }
  }

  /* ---------------- data writes ---------------- */
  function write(path, value, opts) {
    if (CFG.readOnly) { toast("View only – you can read this board but not edit it"); return; }
    opts = opts || {};
    const before = clone(getPath(path));
    if (!opts.noHistory) {
      undoStack.push({ path: path, before: opts.before !== undefined ? opts.before : before, after: clone(value) });
      if (undoStack.length > 100) undoStack.shift();
      redoStack.length = 0;
    }
    apply(path, clone(value));
    sync.put(path, clone(value));
    markSaved();
  }
  function undo() {
    const op = undoStack.pop(); if (!op) return toast("Nothing to undo");
    redoStack.push(op);
    apply(op.path, clone(op.before)); sync.put(op.path, clone(op.before)); markSaved();
  }
  function redo() {
    const op = redoStack.pop(); if (!op) return toast("Nothing to redo");
    undoStack.push(op);
    apply(op.path, clone(op.after)); sync.put(op.path, clone(op.after)); markSaved();
  }
  function markSaved() {
    clearTimeout(markSaved._t);
    els.syncPill.classList.add("saving");
    markSaved._t = setTimeout(function () {
      els.syncPill.classList.remove("saving");
      if (sync.mode === "local" && sync.saveOk === false) toast("Browser storage is full – export the board to keep a copy");
    }, 500);
  }

  /* apply a change (local or remote) to state + DOM */
  function apply(path, value) {
    if (path === "*") { Object.assign(S, { stickies: {}, fields: {}, photos: {}, meta: {} }, value || {}); renderAll(); return; }
    window.MBSync.setPath(S, path, value);
    const parts = path.split("/");
    const col = parts[0], key = parts[1];
    if (col === "stickies") {
      if (!S.stickies[key]) removeStickyEl(key);
      else if (!(dragging && dragging.id === key) && editing !== key) renderSticky(S.stickies[key]);
      else if (editing === key) updateBadges(S.stickies[key]);
      if (selected === key) updateCtx();
      schedulePanel();
    } else if (col === "fields") renderField(key);
    else if (col === "photos") renderPhoto(key);
    else if (col === "meta") renderTimer();
  }

  /* ---------------- stickies ---------------- */
  els.stickyEls = {};
  function maxZ() { let z = 1; Object.keys(S.stickies).forEach(function (k) { z = Math.max(z, S.stickies[k].z || 1); }); return z; }

  function renderSticky(s) {
    let el = els.stickyEls[s.id];
    if (!el) {
      el = document.createElement("div");
      el.className = "sticky";
      el.dataset.id = s.id;
      el.innerHTML = '<div class="txt" spellcheck="true" data-ph="' + esc(window.MBt("Double-click to write")) + '"></div><div class="badges"></div><span class="rz" title="Resize"></span>';
      els.stickies.appendChild(el);
      els.stickyEls[s.id] = el;
    }
    el.style.left = s.x + "px";
    el.style.top = s.y + "px";
    el.style.width = (s.w || 120) + "px";
    el.style.height = (s.h || 120) + "px";
    el.style.background = s.color || PALETTE[0];
    el.style.zIndex = s.z || 1;
    el.title = s.byName ? "Added by " + s.byName : "";
    const txt = el.firstChild;
    if (txt.textContent !== (s.text || "")) txt.textContent = s.text || "";
    el.classList.toggle("empty", !s.text);
    el.classList.toggle("sel", selected === s.id);
    updateBadges(s);
    fitText(el);
  }
  function updateBadges(s) {
    const el = els.stickyEls[s.id]; if (!el) return;
    const votes = totalVotes(s);
    const nC = s.comments ? Object.keys(s.comments).length : 0;
    const r = riceScore(s);
    let b = "";
    if (votes) b += '<span class="bd vote" title="' + votes + ' vote(s)">' + votes + "</span>";
    if (nC) b += '<span class="bd com" title="' + nC + ' comment(s)">' + ico("comment") + nC + "</span>";
    if (r !== null) b += '<span class="bd rice" title="RICE score">' + fmt(r) + "</span>";
    el.querySelector(".badges").innerHTML = b;
  }
  function fitText(el) {
    const t = el.firstChild;
    let size = 15;
    t.style.fontSize = size + "px";
    let guard = 0;
    while ((t.scrollHeight > el.clientHeight - 14 || t.scrollWidth > el.clientWidth - 12) && size > 8 && guard++ < 12) {
      size -= 1; t.style.fontSize = size + "px";
    }
  }
  function removeStickyEl(id) {
    const el = els.stickyEls[id];
    if (el) el.remove();
    delete els.stickyEls[id];
    if (selected === id) deselect();
  }
  function createSticky(x, y, color, extra) {
    const s = Object.assign({ id: uid(), x: Math.round(x), y: Math.round(y), w: 120, h: 120, color: color || PALETTE[0], text: "", z: maxZ() + 1, by: me.id, byName: me.name, t: Date.now() }, extra || {});
    write("stickies/" + s.id, s);
    return s;
  }
  function totalVotes(s) { if (!s.votes) return 0; return Object.keys(s.votes).reduce(function (a, k) { return a + (s.votes[k] || 0); }, 0); }
  function myVotesUsed() { return Object.keys(S.stickies).reduce(function (a, k) { const v = S.stickies[k].votes; return a + (v && v[me.id] ? v[me.id] : 0); }, 0); }
  function riceScore(s) {
    const r = s.rice; if (!r || !r.effort) return null;
    return (Number(r.reach) || 0) * (Number(r.impact) || 0) * ((Number(r.confidence) || 0) / 100) / Number(r.effort);
  }
  function fmt(n) { return n >= 100 ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString(); }
  function bucketOf(s) {
    const cx = s.x + (s.w || 120) / 2, cy = s.y + (s.h || 120) / 2;
    const q = T.quadrants.find(function (q) { return cx >= q.x && cx <= q.x + q.w && cy >= q.y && cy <= q.y + q.h; });
    return q ? q.name : null;
  }

  /* ---------------- selection & context bar ---------------- */
  function select(id) {
    if (selected && els.stickyEls[selected]) els.stickyEls[selected].classList.remove("sel");
    selected = id;
    if (id && els.stickyEls[id]) els.stickyEls[id].classList.add("sel");
    updateCtx();
    if (!els.panel.hidden && panelTab === "comments") renderPanel();
  }
  function deselect() { if (editing) stopEdit(); select(null); }
  function updateCtx() {
    const s = selected && S.stickies[selected];
    els.ctx.hidden = !s || !!CFG.readOnly;
    if (!s) return;
    const mine = s.votes && s.votes[me.id] ? s.votes[me.id] : 0;
    $("#cVoteN").textContent = totalVotes(s) || "";
    $("#cUnvote").hidden = !mine;
    els.ctx.querySelectorAll(".ctx-colors button").forEach(function (b) { b.classList.toggle("on", b.dataset.c === s.color); });
    positionCtx();
  }
  function positionCtx() {
    const s = selected && S.stickies[selected];
    if (!s || els.ctx.hidden) return;
    const vr = els.viewport.getBoundingClientRect();
    const cw = els.ctx.offsetWidth, ch = els.ctx.offsetHeight;
    let left = vr.left + view.x + (s.x + (s.w || 120) / 2) * view.s - cw / 2;
    let top = vr.top + view.y + s.y * view.s - ch - 14;
    if (top < vr.top + 8) top = vr.top + view.y + (s.y + (s.h || 120)) * view.s + 14;
    const maxRight = els.panel.hidden ? window.innerWidth : els.panel.getBoundingClientRect().left;
    left = Math.max(8, Math.min(maxRight - cw - 8, left));
    top = Math.max(vr.top + 8, Math.min(window.innerHeight - ch - 8, top));
    els.ctx.style.left = left + "px";
    els.ctx.style.top = top + "px";
  }

  /* ---------------- editing ---------------- */
  let editBefore = null, typingTimer = null;
  function startEdit(id) {
    const el = els.stickyEls[id]; if (!el) return;
    select(id);
    editing = id;
    editBefore = clone(S.stickies[id].text || "");
    const t = el.firstChild;
    t.contentEditable = "true";
    el.classList.add("editing");
    t.focus();
    const range = document.createRange(); range.selectNodeContents(t);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  }
  function stopEdit() {
    if (!editing) return;
    const id = editing;
    const el = els.stickyEls[id];
    editing = null;
    clearTimeout(typingTimer);
    if (!el || !S.stickies[id]) return;
    const t = el.firstChild;
    t.contentEditable = "false";
    el.classList.remove("editing");
    const text = t.innerText.replace(/\n{3,}/g, "\n\n").trim();
    if (text !== editBefore) {
      write("stickies/" + id + "/text", text, { before: editBefore });
    }
    el.classList.toggle("empty", !text);
    fitText(el);
  }

  /* ---------------- fields & photos ---------------- */
  function renderField(k) {
    const el = els.tpl.querySelector('[data-field="' + k + '"]'); if (!el) return;
    if (document.activeElement === el) return;
    el.textContent = S.fields[k] || "";
  }
  function renderPhoto(k) {
    const el = els.tpl.querySelector('[data-photo="' + k + '"]'); if (!el) return;
    const src = S.photos[k];
    const img = el.querySelector("img");
    el.classList.toggle("has", !!src);
    if (src) img.src = src; else img.removeAttribute("src");
  }
  function resizeImage(file, max) {
    return new Promise(function (res, rej) {
      const fr = new FileReader();
      fr.onload = function () {
        const img = new Image();
        img.onload = function () {
          const k = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement("canvas");
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          res(c.toDataURL("image/jpeg", 0.82));
        };
        img.onerror = rej; img.src = fr.result;
      };
      fr.onerror = rej; fr.readAsDataURL(file);
    });
  }

  /* ---------------- panel: ranking / comments / votes ---------------- */
  function schedulePanel() { clearTimeout(schedulePanel._t); schedulePanel._t = setTimeout(function () { if (!els.panel.hidden) renderPanel(); }, 120); }
  function label(s) { return esc((s.text || window.MBt("(empty post-it)")).slice(0, 90)); }
  function renderPanel() {
    els.panel.querySelectorAll(".tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === panelTab); b.setAttribute("aria-selected", b.dataset.tab === panelTab); });
    const list = Object.keys(S.stickies).map(function (k) { return S.stickies[k]; });
    let h = "";
    if (panelTab === "ranking") {
      const order = ["Must Have", "Should Have", "Could Have", "Won't Have"];
      const items = list.filter(function (s) { return bucketOf(s) || riceScore(s) !== null; });
      items.sort(function (a, b) {
        const ra = riceScore(a), rb = riceScore(b);
        if ((rb || -1) !== (ra || -1)) return (rb === null ? -1 : rb) - (ra === null ? -1 : ra);
        const ba = order.indexOf(bucketOf(a)), bb = order.indexOf(bucketOf(b));
        return (ba < 0 ? 9 : ba) - (bb < 0 ? 9 : bb);
      });
      h += '<p class="panel-hint">Post-its placed in the Priority Map or scored with RICE, ordered by RICE score.</p>';
      if (!items.length) h += '<div class="empty-state">Drag post-its into the Must / Should / Could / Won\'t boxes and score them with RICE.</div>';
      h += items.map(function (s, i) {
        const r = riceScore(s), b = bucketOf(s);
        return '<button class="rank-row" data-go="' + s.id + '"><span class="rank-n">' + (i + 1) + '</span><span class="sw" style="background:' + s.color + '"></span>' +
          '<span class="rank-t">' + label(s) + (b ? '<em class="bucket ' + b.split(" ")[0].toLowerCase().replace("'", "") + '">' + b + "</em>" : "") + "</span>" +
          '<span class="rank-s">' + (r !== null ? fmt(r) : "–") + "</span></button>";
      }).join("");
    } else if (panelTab === "votes") {
      const used = myVotesUsed();
      h += '<p class="panel-hint">Dot voting: everyone has ' + VOTES + ' votes. You have <b>' + Math.max(0, VOTES - used) + "</b> left. Select a post-it and press the dot to vote.</p>";
      const items = list.filter(function (s) { return totalVotes(s) > 0; }).sort(function (a, b) { return totalVotes(b) - totalVotes(a); });
      if (!items.length) h += '<div class="empty-state">No votes yet.</div>';
      h += items.map(function (s) {
        return '<button class="rank-row" data-go="' + s.id + '"><span class="sw" style="background:' + s.color + '"></span><span class="rank-t">' + label(s) + '</span><span class="rank-s dots">' + "●".repeat(Math.min(10, totalVotes(s))) + " " + totalVotes(s) + "</span></button>";
      }).join("");
      if (used) h += '<button class="btn ghost full" id="clearMyVotes">Clear my votes</button>';
    } else {
      const s = selected && S.stickies[selected];
      if (s) {
        h += '<div class="thread-head"><span class="sw" style="background:' + s.color + '"></span><span>' + label(s) + "</span></div>";
        const cs = s.comments ? Object.keys(s.comments).map(function (k) { return Object.assign({ id: k }, s.comments[k]); }).sort(function (a, b) { return a.t - b.t; }) : [];
        if (!cs.length) h += '<div class="empty-state small">No comments yet. Start the conversation.</div>';
        h += cs.map(function (c) {
          return '<div class="cmt"><span class="av" style="background:' + (c.color || "#888") + '">' + esc(initials(c.name)) + '</span><div><div class="cmt-meta"><b>' + esc(c.name || "Guest") + "</b> · " + timeAgo(c.t) +
            (c.by === me.id ? ' <button class="link" data-delc="' + c.id + '">delete</button>' : "") + '</div><div class="cmt-text">' + esc(c.text) + "</div></div></div>";
        }).join("");
        if (!CFG.readOnly) h += '<form class="cmt-form" id="cmtForm"><textarea id="cmtText" rows="2" placeholder="Write a comment… (Enter to send)" required></textarea><button class="btn primary">Send</button></form>';
      } else {
        const withC = list.filter(function (s) { return s.comments && Object.keys(s.comments).length; });
        h += '<p class="panel-hint">Select a post-it to read or add comments.</p>';
        if (!withC.length) h += '<div class="empty-state">No comments on this board yet.</div>';
        h += withC.map(function (s) {
          const n = Object.keys(s.comments).length;
          return '<button class="rank-row" data-go="' + s.id + '"><span class="sw" style="background:' + s.color + '"></span><span class="rank-t">' + label(s) + '</span><span class="rank-s">' + n + " 💬</span></button>";
        }).join("");
      }
    }
    els.panelBody.innerHTML = h;
  }
  function openPanel(tab) {
    if (tab) panelTab = tab;
    els.panel.hidden = false;
    document.body.classList.add("panel-open");
    renderPanel();
  }

  /* ---------------- modals ---------------- */
  function modal(html, onMount) {
    els.modalBody.innerHTML = html;
    els.modal.hidden = false;
    const f = els.modalBody.querySelector("input,textarea,select,button");
    if (onMount) onMount(els.modalBody);
    if (f) setTimeout(function () { f.focus(); }, 30);
  }
  function closeModal() { els.modal.hidden = true; els.modalBody.innerHTML = ""; }

  function askName(force) {
    if (me.name && !force) return;
    modal('<h2>Welcome to the board 👋</h2><p class="muted">Your name appears on your cursor, post-its and comments.</p>' +
      '<form id="nameForm"><label>Your name<input id="nameIn" maxlength="40" required value="' + esc(me.name) + '" placeholder="e.g. Joaquim Ventura"></label>' +
      '<div class="colors">' + PEOPLE_COLORS.map(function (c) { return '<button type="button" class="pc' + (c === me.color ? " on" : "") + '" data-pc="' + c + '" style="background:' + c + '" aria-label="Colour"></button>'; }).join("") + "</div>" +
      '<div class="modal-actions"><button class="btn primary">Enter board</button></div></form>', function (root) {
      root.querySelectorAll(".pc").forEach(function (b) { b.onclick = function () { me.color = b.dataset.pc; root.querySelectorAll(".pc").forEach(function (x) { x.classList.toggle("on", x === b); }); }; });
      root.querySelector("#nameForm").onsubmit = function (e) {
        e.preventDefault();
        me.name = root.querySelector("#nameIn").value.trim() || "Guest";
        saveMe(); closeModal(); renderPeople(); sendPresence();
        if (!lsGet("cmcollab:onboarded")) showHelp();
      };
    });
  }
  function showHelp() {
    lsSet("cmcollab:onboarded", "1");
    modal('<h2>How to use this board</h2><ul class="help">' +
      "<li><b>Add a post-it:</b> double-click any empty spot, or use the post-it tool on the left (N). It takes the colour of the area you click.</li>" +
      "<li><b>Write:</b> double-click a post-it. Click outside to finish.</li>" +
      "<li><b>Move / resize:</b> drag the post-it, or its bottom-right corner.</li>" +
      "<li><b>Navigate:</b> drag the background to pan, scroll or pinch to zoom, F to fit.</li>" +
      "<li><b>Photos & profile:</b> click the photo frames and the Name / Role / City fields.</li>" +
      "<li><b>Prioritise:</b> drag post-its into Must / Should / Could / Won't, score them with <b>RICE</b> and use <b>dot voting</b>. The Ranking panel orders everything.</li>" +
      "<li><b>Collaborate:</b> comments on any post-it, live cursors, shared timer and Share link.</li>" +
      "<li><b>Shortcuts:</b> Del delete · Ctrl+D duplicate · Ctrl+Z / Ctrl+Shift+Z undo / redo · Esc deselect.</li></ul>" +
      '<div class="modal-actions"><button class="btn primary" id="okHelp">Got it</button></div>', function (root) { root.querySelector("#okHelp").onclick = closeModal; });
  }
  function riceModal(id) {
    const s = S.stickies[id]; if (!s) return;
    const r = s.rice || { reach: "", impact: 1, confidence: 80, effort: "" };
    modal('<h2>RICE score</h2><p class="muted">' + label(s) + "</p>" +
      '<form id="riceForm" class="rice-form">' +
      '<label>Reach<small>How many people / times per period?</small><input type="number" min="0" step="any" id="rR" value="' + esc(r.reach) + '" required></label>' +
      '<label>Impact<small>How much will it move the needle?</small><select id="rI">' +
      [[3, "3 · Massive"], [2, "2 · High"], [1, "1 · Medium"], [0.5, "0.5 · Low"], [0.25, "0.25 · Minimal"]].map(function (o) { return '<option value="' + o[0] + '"' + (Number(r.impact) === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") +
      '</select></label><label>Confidence<small>How sure are you about these estimates?</small><select id="rC">' +
      [[100, "100% · High"], [80, "80% · Medium"], [50, "50% · Low"], [20, "20% · Moonshot"]].map(function (o) { return '<option value="' + o[0] + '"' + (Number(r.confidence) === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") +
      '</select></label><label>Effort<small>Person-weeks (or any consistent unit)</small><input type="number" min="0.1" step="any" id="rE" value="' + esc(r.effort) + '" required></label>' +
      '<div class="rice-live">Score: <b id="rOut">–</b></div>' +
      '<div class="modal-actions">' + (s.rice ? '<button type="button" class="btn ghost" id="rClear">Remove score</button>' : "") + '<button type="button" class="btn ghost" id="rCancel">Cancel</button><button class="btn primary">Save</button></div></form>', function (root) {
      function calc() {
        const v = { reach: root.querySelector("#rR").value, impact: root.querySelector("#rI").value, confidence: root.querySelector("#rC").value, effort: root.querySelector("#rE").value };
        const sc = riceScore({ rice: v });
        root.querySelector("#rOut").textContent = sc === null || !isFinite(sc) ? "–" : fmt(sc);
        return v;
      }
      root.querySelectorAll("input,select").forEach(function (x) { x.oninput = calc; });
      calc();
      root.querySelector("#rCancel").onclick = closeModal;
      const cl = root.querySelector("#rClear");
      if (cl) cl.onclick = function () { write("stickies/" + id + "/rice", null); closeModal(); };
      root.querySelector("#riceForm").onsubmit = function (e) {
        e.preventDefault();
        const v = calc();
        write("stickies/" + id + "/rice", { reach: Number(v.reach), impact: Number(v.impact), confidence: Number(v.confidence), effort: Number(v.effort) });
        closeModal(); toast("RICE score saved");
      };
    });
  }
  function timerModal() {
    const running = S.meta.timer && S.meta.timer.end > Date.now();
    modal('<h2>Session timer</h2><p class="muted">Shared with everyone on the board.</p><div class="timer-opts">' +
      [3, 5, 10, 15, 25, 45].map(function (m) { return '<button class="btn ghost" data-m="' + m + '">' + m + " min</button>"; }).join("") +
      '</div><div class="modal-actions">' + (running ? '<button class="btn ghost" id="tStop">Stop timer</button>' : "") + '<button class="btn ghost" id="tClose">Close</button></div>', function (root) {
      root.querySelectorAll("[data-m]").forEach(function (b) { b.onclick = function () { write("meta/timer", { end: Date.now() + Number(b.dataset.m) * 60000, dur: Number(b.dataset.m), by: me.name }, { noHistory: true }); closeModal(); }; });
      root.querySelector("#tClose").onclick = closeModal;
      const st = root.querySelector("#tStop");
      if (st) st.onclick = function () { write("meta/timer", null, { noHistory: true }); closeModal(); };
    });
  }
  function shareModal() {
    const live = sync.mode === "live";
    modal('<h2>Share this board</h2>' +
      (live ? '<p class="muted">Anyone with this link can view and edit in real time.</p>'
        : '<p class="muted">This board is in <b>local mode</b>: changes are saved in this browser only. To collaborate in real time across devices, add your Firebase config to <code>assets/js/config.js</code> (see README). Meanwhile you can exchange the board as a file.</p>') +
      '<div class="copy-row"><input readonly id="shareUrl" value="' + esc(location.href) + '"><button class="btn primary" id="copyUrl">Copy link</button></div>' +
      (live ? "" : '<div class="modal-actions left"><button class="btn ghost" id="shExp">Export board file</button><button class="btn ghost" id="shImp">Import board file</button></div>') +
      '<div class="modal-actions"><button class="btn ghost" id="shClose">Close</button></div>', function (root) {
      root.querySelector("#copyUrl").onclick = function () {
        const inp = root.querySelector("#shareUrl"); inp.select();
        (navigator.clipboard ? navigator.clipboard.writeText(inp.value) : Promise.reject()).then(function () { toast("Link copied"); }, function () { document.execCommand("copy"); toast("Link copied"); });
      };
      root.querySelector("#shClose").onclick = closeModal;
      if (!live) { root.querySelector("#shExp").onclick = exportBoard; root.querySelector("#shImp").onclick = function () { $("#fileImport").click(); }; }
    });
  }
  function confirmModal(title, text, okLabel, onOk) {
    modal("<h2>" + title + '</h2><p class="muted">' + text + '</p><div class="modal-actions"><button class="btn ghost" id="cNo">Cancel</button><button class="btn danger" id="cYes">' + okLabel + "</button></div>", function (root) {
      root.querySelector("#cNo").onclick = closeModal;
      root.querySelector("#cYes").onclick = function () { closeModal(); onOk(); };
    });
  }

  /* ---------------- timer ---------------- */
  function renderTimer() {
    const t = S.meta.timer;
    clearInterval(renderTimer._i);
    if (!t || !t.end) { els.timerTxt.textContent = "Timer"; els.timerBtn.classList.remove("on", "done"); return; }
    function tick() {
      const left = Math.max(0, t.end - Date.now());
      const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      els.timerTxt.textContent = m + ":" + String(s).padStart(2, "0");
      els.timerBtn.classList.add("on");
      els.timerBtn.classList.toggle("done", left === 0);
      if (left === 0) { clearInterval(renderTimer._i); if (!renderTimer._done) { renderTimer._done = t.end; toast("⏰ Time's up!"); } }
    }
    renderTimer._done = null;
    tick();
    renderTimer._i = setInterval(tick, 500);
  }

  /* ---------------- presence & cursors ---------------- */
  let cursor = { x: null, y: null };
  function sendPresence() {
    if (!me.name) return;
    sync.presence({ id: me.id, name: me.name, color: me.color, x: cursor.x, y: cursor.y, sel: selected || null });
  }
  let lastSend = 0;
  function trackCursor(e) {
    const w = toWorld(e.clientX, e.clientY);
    cursor = { x: Math.round(w.x), y: Math.round(w.y) };
    const now = Date.now();
    if (now - lastSend > 60) { lastSend = now; sendPresence(); }
  }
  function renderPeople() {
    const list = Object.keys(peers).filter(function (k) { return k !== me.id && peers[k] && peers[k].name; }).map(function (k) { return Object.assign({ id: k }, peers[k]); });
    const all = [{ id: me.id, name: (me.name || "You") + " (you)", ini: initials(me.name || "You"), color: me.color }].concat(list);
    els.people.innerHTML = all.slice(0, 6).map(function (p) {
      return '<span class="av" style="background:' + p.color + '" title="' + esc(p.name) + '">' + esc(p.ini || initials(p.name)) + "</span>";
    }).join("") + (all.length > 6 ? '<span class="av more">+' + (all.length - 6) + "</span>" : "");
    // cursors
    const seen = {};
    list.forEach(function (p) {
      if (p.x == null) return;
      seen[p.id] = 1;
      let c = els.cursors.querySelector('[data-p="' + p.id + '"]');
      if (!c) {
        c = document.createElement("div"); c.className = "cursor"; c.dataset.p = p.id;
        c.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 3l7 18 2.5-7.5L21 11z"/></svg><span></span>';
        els.cursors.appendChild(c);
      }
      c.style.color = p.color;
      c.querySelector("span").textContent = p.name;
      c.querySelector("span").style.background = p.color;
      c.style.transform = "translate(" + p.x + "px," + p.y + "px) scale(" + (1 / view.s) + ")";
    });
    els.cursors.querySelectorAll(".cursor").forEach(function (c) { if (!seen[c.dataset.p]) c.remove(); });
  }

  /* ---------------- import / export ---------------- */
  function exportBoard() {
    const data = { app: "CM Collaborator", template: T.version, board: CFG.id, exportedAt: new Date().toISOString(), data: S };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (CFG.id || "board") + "-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast("Board exported");
  }
  function importBoard(file) {
    const fr = new FileReader();
    fr.onload = function () {
      try {
        const j = JSON.parse(fr.result);
        const d = j.data || j;
        if (!d || typeof d !== "object" || !d.stickies) throw new Error("bad");
        confirmModal("Import board?", "This replaces the current content of the board for everyone.", "Replace board", function () {
          const nd = { stickies: d.stickies || {}, fields: d.fields || {}, photos: d.photos || {}, meta: Object.assign({}, d.meta || {}, { template: T.version }) };
          sync.replaceAll(nd);
          apply("*", nd);
          undoStack.length = 0; redoStack.length = 0;
          toast("Board imported");
        });
      } catch (e) { toast("That file is not a CM Collaborator export"); }
    };
    fr.readAsText(file);
  }
  function seedData() {
    const st = {};
    T.seeds.forEach(function (s, i) {
      const id = "seed" + i;
      st[id] = { id: id, x: s.x, y: s.y, w: s.w || 120, h: s.h || 120, color: s.color, text: "", z: i + 1, t: Date.now() };
    });
    return { stickies: st, fields: Object.assign({}, CFG.defaults || {}), photos: {}, meta: { template: T.version, created: Date.now() } };
  }

  /* ---------------- events ---------------- */
  function bind() {
    const vp = els.viewport;
    const pointers = new Map();
    let pinch = null, pan = null, downInfo = null;

    vp.addEventListener("pointerdown", function (e) {
      if (e.button === 2) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const p = Array.from(pointers.values());
        pinch = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), s: view.s };
        dragging = null; pan = null; return;
      }
      const stEl = e.target.closest(".sticky");
      if (stEl && editing === stEl.dataset.id) return;
      if (e.target.closest("[data-field],.photo")) return;
      if (editing) stopEdit();
      if (stEl) {
        const id = stEl.dataset.id, s = S.stickies[id];
        if (!s) return;
        select(id);
        const w = toWorld(e.clientX, e.clientY);
        if (CFG.readOnly) return;
        dragging = { id: id, mode: e.target.classList.contains("rz") ? "resize" : "move", sx: w.x, sy: w.y, o: clone(s), moved: false };
        vp.setPointerCapture(e.pointerId);
        e.preventDefault();
      } else {
        select(null);
        pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        downInfo = { x: e.clientX, y: e.clientY, t: Date.now() };
        vp.classList.add("panning");
        vp.setPointerCapture(e.pointerId);
      }
    });
    vp.addEventListener("pointermove", function (e) {
      trackCursor(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const p = Array.from(pointers.values());
        const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        const r = vp.getBoundingClientRect();
        zoomAt((p[0].x + p[1].x) / 2 - r.left, (p[0].y + p[1].y) / 2 - r.top, pinch.s * d / pinch.d);
        pinch.s = view.s; pinch.d = d;
        return;
      }
      if (dragging) {
        const w = toWorld(e.clientX, e.clientY);
        const s = S.stickies[dragging.id]; if (!s) { dragging = null; return; }
        const dx = w.x - dragging.sx, dy = w.y - dragging.sy;
        if (!dragging.moved && Math.hypot(dx, dy) * view.s < 3) return;
        if (!dragging.moved) {
          dragging.moved = true;
          s.z = maxZ() + 1;
          els.stickyEls[s.id].classList.add("lifting");
        }
        if (dragging.mode === "move") { s.x = Math.round(dragging.o.x + dx); s.y = Math.round(dragging.o.y + dy); }
        else { s.w = Math.max(60, Math.round(dragging.o.w + dx)); s.h = Math.max(50, Math.round(dragging.o.h + dy)); }
        const el = els.stickyEls[s.id];
        el.style.left = s.x + "px"; el.style.top = s.y + "px"; el.style.width = s.w + "px"; el.style.height = s.h + "px"; el.style.zIndex = s.z;
        if (dragging.mode === "resize") fitText(el);
        positionCtx();
        // live-share movement without filling the undo stack
        const now = Date.now();
        if (!dragging.last || now - dragging.last > 90) { dragging.last = now; sync.put("stickies/" + s.id, clone(s)); }
      } else if (pan) {
        view.x = pan.vx + e.clientX - pan.x;
        view.y = pan.vy + e.clientY - pan.y;
        applyView();
      }
    });
    function end(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (dragging) {
        const d = dragging; dragging = null;
        const s = S.stickies[d.id];
        if (s && els.stickyEls[d.id]) els.stickyEls[d.id].classList.remove("lifting");
        if (s && d.moved) write("stickies/" + d.id, clone(s), { before: d.o });
      }
      if (pan) { pan = null; vp.classList.remove("panning"); }
    }
    vp.addEventListener("pointerup", end);
    vp.addEventListener("pointercancel", end);
    vp.addEventListener("pointerleave", function () { cursor = { x: null, y: null }; sendPresence(); });

    vp.addEventListener("dblclick", function (e) {
      if (CFG.readOnly) return;
      const stEl = e.target.closest(".sticky");
      if (stEl) { startEdit(stEl.dataset.id); return; }
      if (e.target.closest("[data-field],.photo")) return;
      const w = toWorld(e.clientX, e.clientY);
      const zone = document.elementsFromPoint(e.clientX, e.clientY).map(function (n) { return n.closest && n.closest(".zone,.quad"); }).find(Boolean);
      e.preventDefault();
      const color = zone && zone.dataset.color ? zone.dataset.color : (zone && zone.classList.contains("quad") ? "#E6E6E6" : PALETTE[0]);
      const s = createSticky(w.x - 60, w.y - 60, color);
      startEdit(s.id);
    });

    vp.addEventListener("wheel", function (e) {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= 40 && e.deltaMode === 0 && !e.deltaX) {
        zoomAt(e.clientX - r.left, e.clientY - r.top, view.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
      } else {
        view.x -= e.deltaX; view.y -= e.deltaY; applyView();
      }
    }, { passive: false });

    // live typing
    els.stickies.addEventListener("input", function (e) {
      const el = e.target.closest(".sticky"); if (!el) return;
      fitText(el);
      el.classList.toggle("empty", !e.target.innerText.trim());
      clearTimeout(typingTimer);
      const id = el.dataset.id;
      typingTimer = setTimeout(function () {
        if (editing === id && S.stickies[id]) { S.stickies[id].text = e.target.innerText.trim(); sync.put("stickies/" + id + "/text", S.stickies[id].text); }
      }, 350);
    });
    els.stickies.addEventListener("focusout", function (e) { if (e.target.classList.contains("txt")) setTimeout(stopEdit, 0); });
    els.stickies.addEventListener("paste", function (e) {
      e.preventDefault();
      document.execCommand("insertText", false, (e.clipboardData || window.clipboardData).getData("text"));
    });

    // template fields
    els.tpl.querySelectorAll("[data-field]").forEach(function (f) {
      f.contentEditable = CFG.readOnly ? "false" : "true";
      f.spellcheck = false;
      let before = "";
      f.addEventListener("focus", function () { before = S.fields[f.dataset.field] || ""; });
      f.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); f.blur(); } });
      f.addEventListener("paste", function (e) { e.preventDefault(); document.execCommand("insertText", false, (e.clipboardData || window.clipboardData).getData("text").replace(/\s+/g, " ")); });
      f.addEventListener("blur", function () {
        const v = f.innerText.replace(/\s+/g, " ").trim();
        f.textContent = v;
        if (v !== before) write("fields/" + f.dataset.field, v || null, { before: before || null });
      });
    });
    // photos
    let photoKey = null;
    els.tpl.querySelectorAll(".photo").forEach(function (p) {
      p.addEventListener("click", function (e) {
        if (CFG.readOnly) return;
        if (e.target.closest(".photo-x")) { write("photos/" + p.dataset.photo, null); return; }
        photoKey = p.dataset.photo; $("#filePhoto").click();
      });
    });
    $("#filePhoto").addEventListener("change", function (e) {
      const f = e.target.files[0]; e.target.value = "";
      if (!f || !photoKey) return;
      resizeImage(f, photoKey === "avatar" ? 320 : 900).then(function (url) { write("photos/" + photoKey, url); }, function () { toast("Could not read that image"); });
    });

    // toolbar
    function addAtCenter(color) {
      const r = vp.getBoundingClientRect();
      const w = toWorld(r.left + r.width / 2, r.top + r.height / 2);
      const n = Object.keys(S.stickies).length % 6;
      const s = createSticky(w.x - 60 + n * 12, w.y - 60 + n * 12, color);
      startEdit(s.id);
    }
    $("#tbSticky").onclick = function () { addAtCenter(PALETTE[0]); };
    $("#addSwatches").onclick = function (e) { const b = e.target.closest("button"); if (b) addAtCenter(b.dataset.c); };
    $("#tbUndo").onclick = undo;
    $("#tbRedo").onclick = redo;
    $("#tbExport").onclick = exportBoard;
    $("#tbImport").onclick = function () { $("#fileImport").click(); };
    $("#fileImport").onchange = function (e) { const f = e.target.files[0]; e.target.value = ""; if (f) importBoard(f); };
    $("#tbPrint").onclick = function () { deselect(); fit(); setTimeout(function () { window.print(); }, 150); };
    $("#tbReset").onclick = function () {
      confirmModal("Reset board?", "All post-its, fields and photos will be replaced by the empty template. Export first if you want a backup.", "Reset", function () {
        const d = seedData(); sync.replaceAll(d); apply("*", d); undoStack.length = 0; redoStack.length = 0; toast("Board reset");
      });
    };
    $("#tbHelp").onclick = showHelp;
    $("#zIn").onclick = function () { zoomCenter(1.2); };
    $("#zOut").onclick = function () { zoomCenter(1 / 1.2); };
    $("#zPct").onclick = function () { const r = vp.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1); };
    $("#zFit").onclick = fit;

    // context bar
    $("#ctxColors").onclick = function (e) { const b = e.target.closest("button"); if (b && selected) write("stickies/" + selected + "/color", b.dataset.c); };
    $("#cDel").onclick = function () { if (selected) { const id = selected; deselect(); write("stickies/" + id, null); } };
    $("#cDup").onclick = duplicate;
    $("#cRice").onclick = function () { if (selected) riceModal(selected); };
    $("#cComment").onclick = function () { openPanel("comments"); setTimeout(function () { const t = $("#cmtText"); if (t) t.focus(); }, 30); };
    $("#cVote").onclick = function () {
      if (!selected) return;
      if (myVotesUsed() >= VOTES) return toast("You have used all " + VOTES + " votes");
      const cur = (S.stickies[selected].votes || {})[me.id] || 0;
      write("stickies/" + selected + "/votes/" + me.id, cur + 1, { noHistory: true });
      toast((VOTES - myVotesUsed()) + " vote(s) left");
    };
    $("#cUnvote").onclick = function () {
      if (!selected) return;
      const cur = (S.stickies[selected].votes || {})[me.id] || 0;
      write("stickies/" + selected + "/votes/" + me.id, cur > 1 ? cur - 1 : null, { noHistory: true });
    };

    // panel
    $("#btnPanel").onclick = function () { if (els.panel.hidden) openPanel(); else { els.panel.hidden = true; document.body.classList.remove("panel-open"); } };
    $("#panelClose").onclick = function () { els.panel.hidden = true; document.body.classList.remove("panel-open"); };
    els.panel.querySelector(".tabs").onclick = function (e) { const b = e.target.closest("button"); if (b) { panelTab = b.dataset.tab; renderPanel(); } };
    els.panelBody.addEventListener("click", function (e) {
      const go = e.target.closest("[data-go]");
      if (go) { focusSticky(go.dataset.go); return; }
      const dc = e.target.closest("[data-delc]");
      if (dc && selected) { write("stickies/" + selected + "/comments/" + dc.dataset.delc, null, { noHistory: true }); return; }
      if (e.target.id === "clearMyVotes") {
        Object.keys(S.stickies).forEach(function (k) { const v = S.stickies[k].votes; if (v && v[me.id]) write("stickies/" + k + "/votes/" + me.id, null, { noHistory: true }); });
      }
    });
    els.panelBody.addEventListener("submit", function (e) {
      if (e.target.id !== "cmtForm") return;
      e.preventDefault();
      const t = $("#cmtText"), v = t.value.trim();
      if (!v || !selected) return;
      write("stickies/" + selected + "/comments/" + uid(), { by: me.id, name: me.name, color: me.color, text: v, t: Date.now() }, { noHistory: true });
      setTimeout(function () { const tt = $("#cmtText"); if (tt) tt.focus(); }, 160);
    });
    els.panelBody.addEventListener("keydown", function (e) {
      if (e.target.id === "cmtText" && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.target.form.requestSubmit(); }
    });

    $("#btnShare").onclick = shareModal;
    const so = $("#btnSignOut");
    if (so) so.onclick = function () { confirmModal("Sign out?", "You will need to sign in again to open this board.", "Sign out", function () { window.CMAuth.signOut(); }); };
    els.timerBtn.onclick = timerModal;
    els.syncPill.onclick = shareModal;
    els.modal.addEventListener("pointerdown", function (e) { if (e.target === els.modal && !$("#nameForm")) closeModal(); });

    // keyboard
    document.addEventListener("keydown", function (e) {
      const typing = e.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
      if (e.key === "Escape") {
        if (!els.modal.hidden && !$("#nameForm")) return closeModal();
        if (editing) { stopEdit(); return; }
        return deselect();
      }
      if (typing) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); return redo(); }
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); return duplicate(); }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) { e.preventDefault(); return $("#cDel").click(); }
      if (e.key === "Enter" && selected) { e.preventDefault(); return startEdit(selected); }
      if (!mod && e.key.toLowerCase() === "n" && !CFG.readOnly) return addAtCenter(PALETTE[0]);
      if (!mod && e.key.toLowerCase() === "f") return fit();
      if (!mod && (e.key === "+" || e.key === "=")) return zoomCenter(1.2);
      if (!mod && e.key === "-") return zoomCenter(1 / 1.2);
      if (selected && e.key.indexOf("Arrow") === 0) {
        e.preventDefault();
        const s = S.stickies[selected], st = e.shiftKey ? 20 : 4;
        const o = clone(s);
        if (e.key === "ArrowLeft") s.x -= st; if (e.key === "ArrowRight") s.x += st; if (e.key === "ArrowUp") s.y -= st; if (e.key === "ArrowDown") s.y += st;
        write("stickies/" + s.id, clone(s), { before: o });
      }
    });
    window.addEventListener("resize", positionCtx);
    window.addEventListener("beforeunload", function () { if (editing) stopEdit(); sync.leave(me.id); });
    setInterval(sendPresence, 5000);
  }
  function duplicate() {
    if (!selected) return;
    const o = S.stickies[selected];
    const s = createSticky(o.x + 24, o.y + 24, o.color, { w: o.w, h: o.h, text: o.text || "" });
    select(s.id);
  }

  function renderAll() {
    Object.keys(els.stickyEls).forEach(function (id) { if (!S.stickies[id]) removeStickyEl(id); });
    Object.keys(S.stickies).forEach(function (k) { const s = S.stickies[k]; if (!s.id) s.id = k; renderSticky(s); });
    els.tpl.querySelectorAll("[data-field]").forEach(function (f) { renderField(f.dataset.field); });
    els.tpl.querySelectorAll("[data-photo]").forEach(function (p) { renderPhoto(p.dataset.photo); });
    renderTimer();
    schedulePanel();
  }

  function setPill() {
    const live = sync.mode === "live";
    els.syncPill.className = "pill " + (live ? "live" : "local");
    els.syncPill.innerHTML = '<i></i>' + (live ? "Live" : "Local");
    els.syncPill.title = live ? "Real-time collaboration on" : "Saved in this browser. Click for collaboration options.";
  }

  /* ---------------- boot ---------------- */
  function boot() {
    buildShell();
    sync = window.MBSync.create(CFG.id || "board");
    setPill();
    bind();
    fit();
    sync.onPresence(function (p) { peers = p || {}; renderPeople(); });
    sync.init(function (path, value) { apply(path, value); }).then(function (data) {
      if (!data || !data.meta || !data.stickies) {
        const d = seedData();
        Object.assign(d.fields, (data && data.fields) || {});
        if (!CFG.readOnly) sync.replaceAll(d);
        data = d;
      }
      apply("*", data);
      renderPeople();
      if (!me.name) askName(); else { sendPresence(); if (!lsGet("cmcollab:onboarded")) showHelp(); }
    }).catch(function (err) {
      console.error(err);
      toast("Could not connect to the live server – check config.js");
    });
    document.body.classList.add("ready");
    if (CFG.readOnly) { document.body.classList.add("readonly"); setTimeout(function () { toast("View only – you can read this board but not edit it"); }, 800); }
  }

  /* ---------------- access gate (runs before the board) ---------------- */
  function prettify(id) { return String(id || "Board").split("-").map(function (w) { return w ? w[0].toUpperCase() + w.slice(1) : w; }).join(" "); }
  function gateScreen(title, text, actions) {
    document.body.className = "gate-page";
    document.body.innerHTML = '<main class="gate"><a class="brand" href="' + ROOT + '"><span class="logo">CM</span><span>CM Collaborator</span></a>' +
      "<h1>" + title + '</h1><p>' + text + '</p><div class="gate-actions">' + (actions || "") + '</div><div class="lang" data-lang-switch></div></main>';
    const so = document.getElementById("gateSignOut");
    if (so) so.onclick = function () { window.CMAuth.signOut(); };
  }
  function setCrumbs() {
    CFG.crumbs = CFG.crumbs || [{ label: "Home", href: ROOT }, { label: "Mentoring", href: ROOT + "mentoring/" }, { label: CFG.title }];
  }
  function start() {
    if (!CFG.id || !/^[a-z0-9-]{2,60}$/.test(CFG.id)) {
      return gateScreen("Board not found", "This link is incomplete. Open your boards from the Mentoring page.", '<a class="btn primary" href="' + ROOT + 'mentoring/">Mentoring</a>');
    }
    if (!window.CMAuth || !window.CMAuth.enabled) {
      CFG.title = CFG.title || prettify(CFG.id);
      CFG.defaults = CFG.defaults || { name: CFG.title };
      setCrumbs();
      return boot();
    }
    gateScreen("Loading…", "Checking your access to this board.");
    window.CMAuth.ready().then(function (user) {
      if (!user) {
        return gateScreen("Sign in required", "This board is private. Sign in with the e-mail address the mentor invited.",
          '<a class="btn primary" href="' + ROOT + "mentoring/?next=" + encodeURIComponent(location.pathname + location.search) + '">Sign in</a>');
      }
      const db = window.CMAuth.db();
      return Promise.all([window.CMAuth.isAdmin(), db.ref("boards/" + CFG.id + "/info").once("value")]).then(function (r) {
        const admin = r[0], info = r[1].val();
        if (!info) return gateScreen("Board not found", "This board does not exist or was removed.", '<a class="btn primary" href="' + ROOT + 'mentoring/">My boards</a>');
        const memberP = admin ? Promise.resolve({ role: "editor" }) : db.ref("boards/" + CFG.id + "/members/" + window.CMAuth.key(user.email)).once("value").then(function (s) { return s.val() || {}; });
        return memberP.then(function (m) {
          CFG.title = info.title || prettify(CFG.id);
          CFG.defaults = { name: info.mentee || CFG.title };
          CFG.readOnly = !admin && m.role === "viewer";
          CFG.isAdmin = admin;
          CFG.signedIn = true;
          me.id = user.uid;
          if (!me.name) me.name = user.displayName || user.email.split("@")[0];
          saveMe();
          setCrumbs();
          window.CMSyncError = function (e) { console.warn(e); toast("Not saved – you don't have permission to edit"); };
          boot();
        });
      }).catch(function (err) {
        console.warn(err);
        gateScreen("No access", "Your account (" + esc(user.email) + ") doesn't have access to this board. Ask the mentor for an invitation.",
          '<a class="btn primary" href="' + ROOT + 'mentoring/">My boards</a><button class="btn" id="gateSignOut">Use another account</button>');
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
