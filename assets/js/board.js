/*
 * CM Collaborator – collaborative whiteboard engine (Miro-style interactions)
 *
 * Objects live in data/stickies/{id} with a `type`: "sticky" | "text" | "image".
 * Image pixels live separately in data/images/{id} so moving an image never re-sends it.
 *
 * Interactions
 *   click            select (and drag straight away)        shift+click  add / remove from selection
 *   click again      edit text (sticky / text)              type         start editing the selected item
 *   drag on empty    selection box                         space+drag / middle / right drag / H tool: pan
 *   alt+drag         duplicate                             double-click empty: new post-it
 *   ctrl+c / x / v   copy / cut / paste (also images and plain text from other apps)
 *   ctrl+d           duplicate   ctrl+a select all   del delete   arrows nudge   ctrl+z / ctrl+shift+z undo / redo
 *   V select · H hand · N post-it · T text · I image · F fit
 */
(function () {
  "use strict";

  const CFG = window.BOARD_CONFIG || {};
  let T = null, W = 1600, H = 1000;
  const VOTES = window.CMCOLLAB_VOTES_PER_USER || 5;
  const ROOT = CFG.root || "./";
  const PALETTE = ["#FFF59D", "#FFCF8A", "#F7A8B0", "#F6C1E4", "#CDBDF6", "#A9D1F7", "#9FE3D3", "#C8EBA1", "#E6E6E6"];
  const TEXT_COLORS = ["#1c2033", "#e5484d", "#f76b15", "#12a594", "#4262ff", "#8e4ec6", "#ffffff"];
  const PEOPLE_COLORS = ["#4262FF", "#E5484D", "#12A594", "#F76B15", "#8E4EC6", "#D6409F", "#0090FF", "#3E9B4F"];
  const t = function (s) { return window.MBt ? window.MBt(s) : s; };

  const S = { stickies: {}, fields: {}, photos: {}, images: {}, meta: {} };
  const els = { objs: {} };
  let sync;
  let view = { x: 0, y: 0, s: 1 };
  const sel = new Set();
  let editing = null, gesture = null, tool = "select", placeColor = PALETTE[0], spaceDown = false;
  const undoStack = [], redoStack = [];
  let peers = {}, panelTab = "ranking", clipboard = null;
  let lastWorld = null;
  let me = loadMe();

  /* ================= helpers ================= */
  const $ = function (q, r) { return (r || document).querySelector(q); };
  function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3); }
  function clone(v) { return v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function getPath(path) { return path.split("/").reduce(function (o, k) { return o == null ? undefined : o[k]; }, S); }
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
    els.toast.textContent = t(msg);
    els.toast.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { els.toast.classList.remove("show"); }, 2400);
  }
  function timeAgo(ts) {
    const d = (Date.now() - ts) / 1000;
    if (d < 60) return t("just now");
    if (d < 3600) return t(Math.floor(d / 60) + "m ago");
    if (d < 86400) return t(Math.floor(d / 3600) + "h ago");
    return new Date(ts).toLocaleDateString();
  }
  function typeOf(o) { return (o && o.type) || "sticky"; }
  function canEdit() { return !CFG.readOnly; }

  /* ================= icons ================= */
  const I = {
    select: '<path d="M5 3l14 8-6 1.5L10 19z"/>',
    hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7-2.5 0-4-1-5.5-3L3 14.5a1.6 1.6 0 0 1 2.5-2L8 15"/>',
    sticky: '<path d="M4 4h16v11l-5 5H4z"/><path d="M15 20v-5h5"/>',
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
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
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
    front: '<rect x="8" y="8" width="12" height="12" rx="2" fill="currentColor" fill-opacity=".25"/><path d="M4 16V4h12"/>',
    back: '<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M20 8v12H8" />',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'
  };
  function ico(n) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + I[n] + "</svg>"; }

  /* ================= shell ================= */
  function buildShell() {
    const crumbs = (CFG.crumbs || []).map(function (c) { return c.href ? '<a href="' + c.href + '">' + esc(c.label) + "</a>" : '<span class="no-i18n">' + esc(c.label) + "</span>"; }).join("<i>/</i>");
    document.body.className = "board-page";
    document.body.innerHTML =
      '<header class="topbar">' +
      '<a class="brand" href="' + ROOT + '"><span class="logo">CM</span><span>CM Collaborator</span></a>' +
      '<nav class="crumbs" aria-label="Breadcrumb">' + crumbs + "</nav>" +
      '<div class="spacer"></div>' +
      '<span id="saveState" class="save-state" role="status"></span>' +
      '<button id="timerBtn" class="timer" title="Session timer">' + ico("timer") + '<span id="timerTxt">Timer</span></button>' +
      '<div id="people" class="people" aria-label="People on this board"></div>' +
      '<div class="lang" data-lang-switch></div>' +
      '<button id="btnShare" class="btn primary">' + ico("share") + "<span>Share</span></button>" +
      '<button id="btnPanel" class="icon-btn" title="Ranking & comments">' + ico("panel") + "</button>" +
      (CFG.isAdmin ? '<a class="icon-btn" href="' + ROOT + 'admin/" title="Administration">' + ico("lock") + "</a>" : "") +
      (CFG.signedIn ? '<button id="btnSignOut" class="icon-btn" title="Sign out">' + ico("logout") + "</button>" : "") +
      "</header>" +
      '<main id="viewport" tabindex="-1"><div id="world"><div id="tpl"></div><div id="objs"></div><div id="marquee" hidden></div><div id="cursors"></div></div>' +
      '<div id="dropHint" hidden><div>' + ico("image") + "<span>Drop images to add them to the board</span></div></div></main>" +
      '<aside id="toolbar" aria-label="Tools">' +
      '<button class="tb" data-tool="select" title="Select (V)">' + ico("select") + "</button>" +
      '<button class="tb" data-tool="hand" title="Hand – move the board (H or hold Space)">' + ico("hand") + "</button>" +
      '<div class="tool-sticky"><button class="tb" data-tool="sticky" id="tbSticky" title="Post-it (N) – click on the board to place">' + ico("sticky") + "</button>" +
      '<div class="swatches" id="addSwatches"></div></div>' +
      '<button class="tb" data-tool="text" title="Text (T)">' + ico("text") + "</button>" +
      '<button class="tb" id="tbImage" title="Image (I) – or paste / drag an image onto the board">' + ico("image") + "</button>" +
      '<span class="sep"></span>' +
      '<button class="tb" id="tbUndo" title="Undo (Ctrl+Z)">' + ico("undo") + "</button>" +
      '<button class="tb" id="tbRedo" title="Redo (Ctrl+Shift+Z)">' + ico("redo") + "</button>" +
      '<span class="sep"></span>' +
      '<button class="tb" id="tbExport" title="Export board (JSON)">' + ico("download") + "</button>" +
      '<button class="tb" id="tbImport" title="Import board (JSON)">' + ico("upload") + "</button>" +
      '<button class="tb" id="tbPrint" title="Print / save as PDF">' + ico("print") + "</button>" +
      ((CFG.isAdmin || !CFG.signedIn) ? '<button class="tb" id="tbReset" title="Reset board">' + ico("reset") + "</button>" : "") +
      '<span class="sep"></span>' +
      '<button class="tb" id="tbHelp" title="How to use">' + ico("help") + "</button>" +
      "</aside>" +
      '<div id="zoombar"><button class="tb" id="zOut" title="Zoom out">' + ico("minus") + '</button><button id="zPct" title="Reset to 100%">100%</button>' +
      '<button class="tb" id="zIn" title="Zoom in">' + ico("plus") + '</button><button class="tb" id="zFit" title="Fit board (F)">' + ico("fit") + "</button></div>" +
      '<div id="ctx" hidden></div>' +
      '<aside id="panel" hidden><div class="panel-head"><div class="tabs" role="tablist">' +
      '<button data-tab="ranking" role="tab">Ranking</button><button data-tab="comments" role="tab">Comments</button><button data-tab="votes" role="tab">Votes</button></div>' +
      '<button class="icon-btn" id="panelClose" title="Close">' + ico("close") + '</button></div><div id="panelBody"></div></aside>' +
      '<div id="toast" role="status"></div>' +
      '<input type="file" id="fileImport" accept="application/json" hidden><input type="file" id="filePhoto" accept="image/*" hidden><input type="file" id="fileImage" accept="image/*" multiple hidden>' +
      '<div class="modal" id="modal" hidden><div class="modal-card" role="dialog" aria-modal="true"><div id="modalBody"></div></div></div>';

    ["viewport", "world", "tpl", "marquee", "cursors", "toolbar", "ctx", "panel", "panelBody", "toast", "modal", "modalBody", "people", "saveState", "zPct", "timerTxt", "timerBtn", "dropHint"].forEach(function (id) { els[id] = document.getElementById(id); });
    els.tpl.innerHTML = T.html;
    els.world.style.width = W + "px";
    els.world.style.height = H + "px";
    $("#addSwatches").innerHTML = PALETTE.map(function (c) { return '<button style="background:' + c + '" data-c="' + c + '" title="Add post-it"></button>'; }).join("");
    document.title = (CFG.title || "Board") + " · CM Collaborator";
  }

  /* ================= view ================= */
  function applyView() {
    els.world.style.transform = "translate(" + view.x + "px," + view.y + "px) scale(" + view.s + ")";
    const g = 24 * view.s;
    els.viewport.style.backgroundSize = g + "px " + g + "px";
    els.viewport.style.backgroundPosition = view.x + "px " + view.y + "px";
    els.zPct.textContent = Math.round(view.s * 100) + "%";
    els.world.classList.toggle("far", view.s < 0.45);
    els.cursors.querySelectorAll(".cursor").forEach(function (c) { c.style.setProperty("--inv", 1 / view.s); });
    positionCtx();
  }
  function contentBox() {
    let x0 = 0, y0 = 0, x1 = W, y1 = H;
    if (!T.html) { x0 = Infinity; y0 = Infinity; x1 = -Infinity; y1 = -Infinity; }
    Object.keys(S.stickies).forEach(function (k) {
      const r = rectOf(S.stickies[k]);
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    });
    if (!isFinite(x0)) return { x: 0, y: 0, w: W, h: H };
    return { x: x0 - 40, y: y0 - 40, w: x1 - x0 + 80, h: y1 - y0 + 80 };
  }
  function fit() {
    const r = els.viewport.getBoundingClientRect();
    const b = contentBox();
    const s = Math.min(1.2, Math.min(r.width / b.w, r.height / b.h) * 0.94);
    view = { s: s, x: (r.width - b.w * s) / 2 - b.x * s, y: (r.height - b.h * s) / 2 - b.y * s };
    applyView();
  }
  function zoomAt(px, py, ns) {
    ns = Math.max(0.1, Math.min(4, ns));
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
  function viewCenterWorld() {
    const r = els.viewport.getBoundingClientRect();
    return toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }
  function focusObj(id) {
    const o = S.stickies[id]; if (!o) return;
    const r = els.viewport.getBoundingClientRect(), b = rectOf(o);
    view.s = Math.max(view.s, 0.9);
    view.x = r.width / 2 - (b.x + b.w / 2) * view.s;
    view.y = r.height / 2 - (b.y + b.h / 2) * view.s;
    applyView();
    selectOnly(id);
    const el = els.objs[id];
    if (el) { el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); }
  }

  /* ================= saving (history + sync + status) ================= */
  let pending = 0, failed = false;
  function track(p) {
    pending++; showSave();
    Promise.resolve(p).then(function () { pending--; showSave(); }, function (e) {
      pending--; failed = true; showSave(); console.warn(e);
      toast(CFG.readOnly ? "View only – you can read this board but not edit it" : "Not saved – check your connection or permissions");
    });
  }
  function showSave() {
    const st = els.saveState; if (!st) return;
    const live = sync && sync.mode === "live";
    let cls, txt;
    if (failed) { cls = "err"; txt = "Not saved"; }
    else if (pending > 0) { cls = "busy"; txt = "Saving…"; }
    else if (live) { cls = "ok"; txt = "All changes saved"; }
    else { cls = "local"; txt = "Saved in this browser only"; }
    st.className = "save-state " + cls;
    st.innerHTML = "<i></i><span>" + t(txt) + "</span>";
    st.title = live ? "" : t("Demo mode: content stays in this browser. Configure Firebase to save online.");
    if (failed && pending === 0) setTimeout(function () { failed = false; showSave(); }, 6000);
  }
  function commit(changes, opts) {
    opts = opts || {};
    if (!canEdit() && !opts.allowViewer) { toast("View only – you can read this board but not edit it"); return false; }
    const entry = changes.map(function (c) {
      return { path: c.path, before: c.before !== undefined ? clone(c.before) : clone(getPath(c.path)), after: clone(c.value) };
    });
    if (!opts.noHistory) {
      undoStack.push(entry);
      if (undoStack.length > 150) undoStack.shift();
      redoStack.length = 0;
    }
    entry.forEach(function (c) { apply(c.path, clone(c.after)); track(sync.put(c.path, clone(c.after))); });
    return true;
  }
  function write(path, value, opts) {
    opts = opts || {};
    return commit([{ path: path, value: value, before: opts.before }], opts);
  }
  function undo() {
    const e = undoStack.pop(); if (!e) return toast("Nothing to undo");
    redoStack.push(e);
    e.slice().reverse().forEach(function (c) { apply(c.path, clone(c.before)); track(sync.put(c.path, clone(c.before))); });
  }
  function redo() {
    const e = redoStack.pop(); if (!e) return toast("Nothing to redo");
    undoStack.push(e);
    e.forEach(function (c) { apply(c.path, clone(c.after)); track(sync.put(c.path, clone(c.after))); });
  }
  let liveTimers = {};
  function livePut(id) {
    if (liveTimers[id]) return;
    liveTimers[id] = setTimeout(function () {
      liveTimers[id] = null;
      const o = S.stickies[id];
      if (o) sync.put("stickies/" + id, clone(o)).catch(function () { /* final commit reports errors */ });
    }, 80);
  }

  /* apply a change (local or remote) to state + DOM */
  function apply(path, value) {
    if (path === "*") {
      Object.assign(S, { stickies: {}, fields: {}, photos: {}, images: {}, meta: {} }, value || {});
      renderAll(); return;
    }
    window.MBSync.setPath(S, path, value);
    const parts = path.split("/"), col = parts[0], key = parts[1];
    if (col === "stickies") {
      if (!key) { renderAll(); return; }
      if (!S.stickies[key]) removeObjEl(key);
      else if (gesture && gesture.ids && gesture.ids.indexOf(key) >= 0 && gesture.moved) { /* local gesture owns it */ }
      else if (editing === key) updateBadges(S.stickies[key]);
      else renderObj(S.stickies[key]);
      if (sel.has(key)) updateCtx();
      schedulePanel();
    } else if (col === "images") {
      if (key && S.stickies[key]) renderObj(S.stickies[key]);
      else if (!key) renderAll();
    } else if (col === "fields") { if (key) renderField(key); else renderAll(); }
    else if (col === "photos") { if (key) renderPhoto(key); else renderAll(); }
    else if (col === "meta") renderTimer();
  }

  /* ================= objects ================= */
  function maxZ() { let z = 1; Object.keys(S.stickies).forEach(function (k) { z = Math.max(z, S.stickies[k].z || 1); }); return z; }
  function minZ() { let z = 1; Object.keys(S.stickies).forEach(function (k) { z = Math.min(z, S.stickies[k].z || 1); }); return z; }
  function rectOf(o) {
    let h = o.h || 120;
    if (typeOf(o) === "text") { const el = els.objs[o.id]; h = el ? el.offsetHeight : (o.fs || 24) * 1.5; }
    return { x: o.x, y: o.y, w: o.w || 120, h: h };
  }
  function renderObj(o) {
    if (!o || !o.id) return;
    const type = typeOf(o);
    let el = els.objs[o.id];
    if (el && el.dataset.type !== type) { el.remove(); el = null; }
    if (!el) {
      el = document.createElement("div");
      el.dataset.id = o.id;
      el.dataset.type = type;
      el.className = "obj " + (type === "sticky" ? "sticky" : type === "text" ? "textobj" : "imgobj");
      if (type === "image") el.innerHTML = '<img alt="" draggable="false"><div class="badges"></div><span class="rz" title="Resize"></span>';
      else el.innerHTML = '<div class="txt" spellcheck="true" data-ph="' + esc(t(type === "text" ? "Type something" : "Click to write")) + '"></div>' + (type === "sticky" ? '<div class="badges"></div>' : "") + '<span class="rz" title="Resize"></span>';
      els.layer.appendChild(el);
      els.objs[o.id] = el;
    }
    el.style.left = o.x + "px";
    el.style.top = o.y + "px";
    el.style.width = (o.w || 120) + "px";
    el.style.zIndex = o.z || 1;
    el.title = o.byName ? t("Added by " + o.byName) : "";
    if (type === "sticky") {
      el.style.height = (o.h || 120) + "px";
      el.style.background = o.color || PALETTE[0];
    } else if (type === "text") {
      el.style.height = "";
      el.style.color = o.color || "#1c2033";
      el.style.fontSize = (o.fs || 24) + "px";
    } else {
      el.style.height = (o.h || 120) + "px";
      const img = el.querySelector("img");
      const src = S.images[o.id] || "";
      if (img.getAttribute("src") !== src) { if (src) img.src = src; else img.removeAttribute("src"); }
      el.classList.toggle("loading", !src);
    }
    if (type !== "image" && editing !== o.id) {
      const tx = el.querySelector(".txt");
      if (tx.textContent !== (o.text || "")) tx.textContent = o.text || "";
      el.classList.toggle("empty", !o.text);
    }
    el.classList.toggle("sel", sel.has(o.id));
    updateBadges(o);
    if (type === "sticky") fitText(el);
  }
  function updateBadges(o) {
    const el = els.objs[o.id]; if (!el) return;
    const b = el.querySelector(".badges"); if (!b) return;
    const votes = totalVotes(o), nC = o.comments ? Object.keys(o.comments).length : 0, r = riceScore(o);
    let h = "";
    if (votes) h += '<span class="bd vote" title="' + esc(t(votes + " vote(s)")) + '">' + votes + "</span>";
    if (nC) h += '<span class="bd com" title="' + esc(t(nC + " comment(s)")) + '">' + ico("comment") + nC + "</span>";
    if (r !== null) h += '<span class="bd rice" title="RICE">' + fmt(r) + "</span>";
    b.innerHTML = h;
  }
  function fitText(el) {
    const tx = el.querySelector(".txt"); if (!tx) return;
    let size = 15, guard = 0;
    tx.style.fontSize = size + "px";
    while ((tx.scrollHeight > el.clientHeight - 14 || tx.scrollWidth > el.clientWidth - 12) && size > 8 && guard++ < 12) { size -= 1; tx.style.fontSize = size + "px"; }
  }
  function removeObjEl(id) {
    const el = els.objs[id];
    if (el) el.remove();
    delete els.objs[id];
    if (sel.has(id)) { sel.delete(id); updateCtx(); }
    if (editing === id) editing = null;
  }
  function newObj(type, x, y, extra) {
    const base = { id: uid(), type: type, x: Math.round(x), y: Math.round(y), z: maxZ() + 1, by: me.id, byName: me.name, t: Date.now() };
    if (type === "sticky") Object.assign(base, { w: 120, h: 120, color: placeColor || PALETTE[0], text: "" });
    if (type === "text") Object.assign(base, { w: 260, fs: 24, color: "#1c2033", text: "" });
    return Object.assign(base, extra || {});
  }
  function createObj(o, extraChanges) {
    const ch = [{ path: "stickies/" + o.id, value: o, before: null }].concat(extraChanges || []);
    return commit(ch) ? o : null;
  }
  function totalVotes(o) { if (!o.votes) return 0; return Object.keys(o.votes).reduce(function (a, k) { return a + (o.votes[k] || 0); }, 0); }
  function myVotesUsed() { return Object.keys(S.stickies).reduce(function (a, k) { const v = S.stickies[k].votes; return a + (v && v[me.id] ? v[me.id] : 0); }, 0); }
  function riceScore(o) {
    const r = o.rice; if (!r || !r.effort) return null;
    return (Number(r.reach) || 0) * (Number(r.impact) || 0) * ((Number(r.confidence) || 0) / 100) / Number(r.effort);
  }
  function fmt(n) { return n >= 100 ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString(); }
  function bucketOf(o) {
    const r = rectOf(o), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const q = (T.quadrants || []).find(function (q) { return cx >= q.x && cx <= q.x + q.w && cy >= q.y && cy <= q.y + q.h; });
    return q ? q.name : null;
  }
  function zoneColorAt(cx, cy) {
    const hit = document.elementsFromPoint(cx, cy).map(function (n) { return n.closest && n.closest(".zone,.quad"); }).find(Boolean);
    if (!hit) return null;
    return hit.dataset.color || (hit.classList.contains("quad") ? "#E6E6E6" : null);
  }

  /* ================= selection & context bar ================= */
  function setSel(ids) {
    sel.forEach(function (id) { if (els.objs[id]) els.objs[id].classList.remove("sel"); });
    sel.clear();
    ids.forEach(function (id) { if (S.stickies[id]) { sel.add(id); if (els.objs[id]) els.objs[id].classList.add("sel"); } });
    updateCtx();
    if (!els.panel.hidden && panelTab === "comments") renderPanel();
  }
  function selectOnly(id) { setSel(id ? [id] : []); }
  function toggleSel(id) { const a = Array.from(sel); const i = a.indexOf(id); if (i >= 0) a.splice(i, 1); else a.push(id); setSel(a); }
  function deselect() { if (editing) stopEdit(); setSel([]); }
  function selObjs() { return Array.from(sel).map(function (id) { return S.stickies[id]; }).filter(Boolean); }
  function single() { return sel.size === 1 ? S.stickies[Array.from(sel)[0]] : null; }

  function updateCtx() {
    const list = selObjs();
    if (!list.length || !canEdit() || (gesture && gesture.moved)) { els.ctx.hidden = true; return; }
    const types = {}; list.forEach(function (o) { types[typeOf(o)] = 1; });
    const one = list.length === 1 ? list[0] : null;
    let h = "";
    if (types.sticky && !types.text && !types.image) {
      h += '<div class="ctx-colors">' + PALETTE.map(function (c) { return '<button data-act="color" data-c="' + c + '" style="background:' + c + '"' + (one && one.color === c ? ' class="on"' : "") + ' title="Change colour"></button>'; }).join("") + '</div><span class="sep v"></span>';
    }
    if (types.text && !types.sticky && !types.image) {
      h += '<div class="ctx-colors">' + TEXT_COLORS.map(function (c) { return '<button data-act="tcolor" data-c="' + c + '" style="background:' + c + '"' + (one && (one.color || "#1c2033") === c ? ' class="on"' : "") + ' title="Text colour"></button>'; }).join("") + "</div>" +
        '<button class="cb txt" data-act="fs-" title="Smaller text">A−</button><button class="cb txt" data-act="fs+" title="Bigger text">A+</button><span class="sep v"></span>';
    }
    if (one) {
      const mine = one.votes && one.votes[me.id] ? one.votes[me.id] : 0;
      h += '<button class="cb vote" data-act="vote" title="Vote (dot voting)">' + ico("vote") + "<span>" + (totalVotes(one) || "") + "</span></button>" +
        (mine ? '<button class="cb" data-act="unvote" title="Remove my vote">−</button>' : "") +
        '<button class="cb" data-act="comment" title="Comments">' + ico("comment") + "</button>" +
        (typeOf(one) !== "text" ? '<button class="cb txt" data-act="rice" title="RICE score">RICE</button>' : "") +
        '<span class="sep v"></span>';
    } else {
      h += '<span class="ctx-count">' + esc(t(list.length + " selected")) + '</span><span class="sep v"></span>';
    }
    h += '<button class="cb" data-act="front" title="Bring to front">' + ico("front") + "</button>" +
      '<button class="cb" data-act="back" title="Send to back">' + ico("back") + "</button>" +
      '<button class="cb" data-act="dup" title="Duplicate (Ctrl+D)">' + ico("copy") + "</button>" +
      '<button class="cb danger" data-act="del" title="Delete (Del)">' + ico("trash") + "</button>";
    els.ctx.innerHTML = h;
    els.ctx.hidden = false;
    positionCtx();
  }
  function selBox() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    selObjs().forEach(function (o) { const r = rectOf(o); x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); });
    return isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }
  function positionCtx() {
    if (els.ctx.hidden) return;
    const b = selBox(); if (!b) { els.ctx.hidden = true; return; }
    const vr = els.viewport.getBoundingClientRect();
    const cw = els.ctx.offsetWidth, ch = els.ctx.offsetHeight;
    let left = vr.left + view.x + (b.x + b.w / 2) * view.s - cw / 2;
    let top = vr.top + view.y + b.y * view.s - ch - 16;
    if (top < vr.top + 8) top = vr.top + view.y + (b.y + b.h) * view.s + 16;
    const maxRight = els.panel.hidden ? window.innerWidth : els.panel.getBoundingClientRect().left;
    left = Math.max(70, Math.min(maxRight - cw - 8, left));
    top = Math.max(vr.top + 8, Math.min(window.innerHeight - ch - 8, top));
    els.ctx.style.left = left + "px";
    els.ctx.style.top = top + "px";
  }
  function ctxAction(act, c) {
    const list = selObjs(); if (!list.length) return;
    const one = list.length === 1 ? list[0] : null;
    if (act === "color") return commit(list.filter(function (o) { return typeOf(o) === "sticky"; }).map(function (o) { return { path: "stickies/" + o.id + "/color", value: c }; }));
    if (act === "tcolor") return commit(list.map(function (o) { return { path: "stickies/" + o.id + "/color", value: c }; }));
    if (act === "fs+" || act === "fs-") {
      return commit(list.map(function (o) {
        const steps = [14, 18, 24, 32, 44, 60, 80, 110];
        const cur = o.fs || 24; let i = steps.findIndex(function (s) { return s >= cur; }); if (i < 0) i = steps.length - 1;
        i = Math.max(0, Math.min(steps.length - 1, i + (act === "fs+" ? 1 : -1)));
        return { path: "stickies/" + o.id + "/fs", value: steps[i] };
      }));
    }
    if (act === "vote") {
      if (myVotesUsed() >= VOTES) return toast("You have used all " + VOTES + " votes");
      const cur = (one.votes || {})[me.id] || 0;
      write("stickies/" + one.id + "/votes/" + me.id, cur + 1, { noHistory: true });
      return toast((VOTES - myVotesUsed()) + " vote(s) left");
    }
    if (act === "unvote") { const cur = (one.votes || {})[me.id] || 0; return write("stickies/" + one.id + "/votes/" + me.id, cur > 1 ? cur - 1 : null, { noHistory: true }); }
    if (act === "comment") { openPanel("comments"); return setTimeout(function () { const x = $("#cmtText"); if (x) x.focus(); }, 30); }
    if (act === "rice") return riceModal(one.id);
    if (act === "front") { let z = maxZ(); return commit(list.sort(function (a, b) { return (a.z || 1) - (b.z || 1); }).map(function (o) { return { path: "stickies/" + o.id + "/z", value: ++z }; })); }
    if (act === "back") { let z = minZ() - list.length; return commit(list.sort(function (a, b) { return (a.z || 1) - (b.z || 1); }).map(function (o) { return { path: "stickies/" + o.id + "/z", value: z++ }; })); }
    if (act === "dup") return duplicate();
    if (act === "del") return deleteSel();
  }
  function deleteSel() {
    const list = selObjs(); if (!list.length) return;
    const ch = [];
    list.forEach(function (o) {
      ch.push({ path: "stickies/" + o.id, value: null });
      if (typeOf(o) === "image") ch.push({ path: "images/" + o.id, value: null });
    });
    if (editing) stopEdit();
    setSel([]);
    commit(ch);
  }
  function cloneObjs(list, dx, dy) {
    let z = maxZ();
    const ch = [], ids = [];
    list.forEach(function (o) {
      const n = clone(o);
      n.id = uid(); n.x = Math.round(o.x + dx); n.y = Math.round(o.y + dy); n.z = ++z;
      delete n.votes; delete n.comments; n.by = me.id; n.byName = me.name; n.t = Date.now();
      ch.push({ path: "stickies/" + n.id, value: n, before: null });
      if (typeOf(o) === "image" && S.images[o.id]) ch.push({ path: "images/" + n.id, value: S.images[o.id], before: null });
      ids.push(n.id);
    });
    return { ch: ch, ids: ids };
  }
  function duplicate() {
    const list = selObjs(); if (!list.length || !canEdit()) return;
    const r = cloneObjs(list, 30, 30);
    if (commit(r.ch)) setSel(r.ids);
  }

  /* ================= text editing ================= */
  let editBefore = null, typingTimer = null;
  function startEdit(id, opts) {
    opts = opts || {};
    const o = S.stickies[id], el = els.objs[id];
    if (!o || !el || typeOf(o) === "image" || !canEdit()) return;
    if (editing && editing !== id) stopEdit();
    if (!sel.has(id) || sel.size > 1) selectOnly(id);
    editing = id;
    editBefore = o.text || "";
    const tx = el.querySelector(".txt");
    tx.contentEditable = "true";
    el.classList.add("editing");
    els.ctx.hidden = true;
    tx.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(tx);
    if (!opts.selectAll) range.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
  }
  function stopEdit() {
    if (!editing) return;
    const id = editing, el = els.objs[id];
    editing = null;
    clearTimeout(typingTimer);
    if (!el || !S.stickies[id]) return;
    const tx = el.querySelector(".txt");
    tx.contentEditable = "false";
    el.classList.remove("editing");
    const text = tx.innerText.replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "").replace(/^\s+/, "");
    const o = S.stickies[id];
    if (typeOf(o) === "text" && !text) {
      commit([{ path: "stickies/" + id, value: null, before: Object.assign(clone(o), { text: editBefore }) }]);
      return;
    }
    if (text !== editBefore) write("stickies/" + id + "/text", text, { before: editBefore });
    el.classList.toggle("empty", !text);
    if (typeOf(o) === "sticky") fitText(el);
    updateCtx();
  }

  /* ================= fields & photos (template) ================= */
  function renderField(k) {
    const el = els.tpl.querySelector('[data-field="' + k + '"]'); if (!el) return;
    if (document.activeElement === el) return;
    el.textContent = S.fields[k] || "";
  }
  function renderPhoto(k) {
    const el = els.tpl.querySelector('[data-photo="' + k + '"]'); if (!el) return;
    const src = S.photos[k], img = el.querySelector("img");
    el.classList.toggle("has", !!src);
    if (src) img.src = src; else img.removeAttribute("src");
  }
  function readImage(file, max, q) {
    return new Promise(function (res, rej) {
      const fr = new FileReader();
      fr.onload = function () {
        const img = new Image();
        img.onload = function () {
          const k = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
          const g = c.getContext("2d");
          g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0, c.width, c.height);
          res({ url: c.toDataURL("image/jpeg", q || 0.82), w: c.width, h: c.height });
        };
        img.onerror = function () { rej(new Error("bad image")); };
        img.src = fr.result;
      };
      fr.onerror = rej; fr.readAsDataURL(file);
    });
  }

  /* ================= images on the board ================= */
  function addImageFiles(files, at) {
    if (!canEdit()) return toast("View only – you can read this board but not edit it");
    const list = Array.from(files || []).filter(function (f) { return /^image\//.test(f.type); });
    if (!list.length) return;
    const p = at || lastWorld || viewCenterWorld();
    toast("Adding image…");
    const ids = [];
    list.reduce(function (chain, f, i) {
      return chain.then(function () {
        return readImage(f, 1400, 0.82).then(function (r) {
          if (r.url.length > 700000) return readImage(f, 1000, 0.7);
          return r;
        }).then(function (r) {
          const w = Math.min(420, r.w), h = Math.round(w * r.h / r.w);
          const o = newObj("image", p.x - w / 2 + i * 30, p.y - h / 2 + i * 30, { w: w, h: h });
          if (createObj(o, [{ path: "images/" + o.id, value: r.url, before: null }])) ids.push(o.id);
        });
      });
    }, Promise.resolve()).then(function () { if (ids.length) { setSel(ids); setTool("select"); } }, function () { toast("Could not read that image"); });
  }

  /* ================= clipboard ================= */
  function copySel(e) {
    const list = selObjs(); if (!list.length) return false;
    const imgs = {};
    list.forEach(function (o) { if (typeOf(o) === "image" && S.images[o.id]) imgs[o.id] = S.images[o.id]; });
    clipboard = { objs: clone(list), images: imgs };
    const plain = list.map(function (o) { return o.text || ""; }).filter(Boolean).join("\n");
    if (e && e.clipboardData) {
      e.clipboardData.setData("text/plain", plain || " ");
      try { e.clipboardData.setData("application/x-cmcollab", JSON.stringify(clipboard)); } catch (x) { /* ignore */ }
      e.preventDefault();
    }
    return true;
  }
  function pasteObjs(data, at) {
    if (!data || !data.objs || !data.objs.length || !canEdit()) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    data.objs.forEach(function (o) { x0 = Math.min(x0, o.x); y0 = Math.min(y0, o.y); x1 = Math.max(x1, o.x + (o.w || 120)); y1 = Math.max(y1, o.y + (o.h || 60)); });
    const p = at || viewCenterWorld();
    const dx = p.x - (x0 + x1) / 2, dy = p.y - (y0 + y1) / 2;
    let z = maxZ();
    const ch = [], ids = [];
    data.objs.forEach(function (o) {
      const n = clone(o);
      n.id = uid(); n.x = Math.round(o.x + dx); n.y = Math.round(o.y + dy); n.z = ++z;
      delete n.votes; delete n.comments; n.by = me.id; n.byName = me.name; n.t = Date.now();
      ch.push({ path: "stickies/" + n.id, value: n, before: null });
      if (typeOf(o) === "image" && data.images && data.images[o.id]) ch.push({ path: "images/" + n.id, value: data.images[o.id], before: null });
      ids.push(n.id);
    });
    if (commit(ch)) setSel(ids);
  }

  /* ================= tools ================= */
  function setTool(name) {
    tool = name;
    els.toolbar.querySelectorAll("[data-tool]").forEach(function (b) { b.classList.toggle("on", b.dataset.tool === name); });
    els.viewport.dataset.tool = name;
  }

  /* ================= panel ================= */
  function schedulePanel() { clearTimeout(schedulePanel._t); schedulePanel._t = setTimeout(function () { if (!els.panel.hidden) renderPanel(); }, 120); }
  function label(o) { return esc((typeOf(o) === "image" ? t("(image)") : (o.text || t("(empty post-it)"))).slice(0, 90)); }
  function renderPanel() {
    els.panel.querySelectorAll(".tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === panelTab); b.setAttribute("aria-selected", b.dataset.tab === panelTab); });
    const list = Object.keys(S.stickies).map(function (k) { return S.stickies[k]; }).filter(function (o) { return typeOf(o) !== "text"; });
    let h = "";
    if (panelTab === "ranking") {
      const order = ["Must Have", "Should Have", "Could Have", "Won't Have"];
      const items = list.filter(function (o) { return bucketOf(o) || riceScore(o) !== null; });
      items.sort(function (a, b) {
        const ra = riceScore(a), rb = riceScore(b);
        if ((rb === null ? -1 : rb) !== (ra === null ? -1 : ra)) return (rb === null ? -1 : rb) - (ra === null ? -1 : ra);
        const ba = order.indexOf(bucketOf(a)), bb = order.indexOf(bucketOf(b));
        return (ba < 0 ? 9 : ba) - (bb < 0 ? 9 : bb);
      });
      h += '<p class="panel-hint">' + t("Post-its placed in the Priority Map or scored with RICE, ordered by RICE score.") + "</p>";
      if (!items.length) h += '<div class="empty-state">' + t("Drag post-its into the Must / Should / Could / Won't boxes and score them with RICE.") + "</div>";
      h += items.map(function (o, i) {
        const r = riceScore(o), b = bucketOf(o);
        return '<button class="rank-row" data-go="' + o.id + '"><span class="rank-n">' + (i + 1) + '</span><span class="sw" style="background:' + (o.color || "#eee") + '"></span>' +
          '<span class="rank-t">' + label(o) + (b ? '<em class="bucket ' + b.split(" ")[0].toLowerCase().replace("'", "") + '">' + b + "</em>" : "") + "</span>" +
          '<span class="rank-s">' + (r !== null ? fmt(r) : "–") + "</span></button>";
      }).join("");
    } else if (panelTab === "votes") {
      const used = myVotesUsed();
      h += '<p class="panel-hint">' + t("Dot voting: everyone has " + VOTES + " votes. You have ") + "<b>" + Math.max(0, VOTES - used) + "</b>" + t(" left. Select a post-it and press the dot to vote.") + "</p>";
      const items = list.filter(function (o) { return totalVotes(o) > 0; }).sort(function (a, b) { return totalVotes(b) - totalVotes(a); });
      if (!items.length) h += '<div class="empty-state">' + t("No votes yet.") + "</div>";
      h += items.map(function (o) {
        return '<button class="rank-row" data-go="' + o.id + '"><span class="sw" style="background:' + (o.color || "#eee") + '"></span><span class="rank-t">' + label(o) + '</span><span class="rank-s dots">' + "●".repeat(Math.min(10, totalVotes(o))) + " " + totalVotes(o) + "</span></button>";
      }).join("");
      if (used) h += '<button class="btn ghost full" id="clearMyVotes">' + t("Clear my votes") + "</button>";
    } else {
      const o = single();
      if (o) {
        h += '<div class="thread-head"><span class="sw" style="background:' + (o.color || "#eee") + '"></span><span>' + label(o) + "</span></div>";
        const cs = o.comments ? Object.keys(o.comments).map(function (k) { return Object.assign({ id: k }, o.comments[k]); }).sort(function (a, b) { return a.t - b.t; }) : [];
        if (!cs.length) h += '<div class="empty-state small">' + t("No comments yet. Start the conversation.") + "</div>";
        h += cs.map(function (c) {
          return '<div class="cmt"><span class="av" style="background:' + (c.color || "#888") + '">' + esc(initials(c.name)) + '</span><div><div class="cmt-meta"><b class="no-i18n">' + esc(c.name || "Guest") + "</b> · " + timeAgo(c.t) +
            (c.by === me.id ? ' <button class="link" data-delc="' + c.id + '">' + t("delete") + "</button>" : "") + '</div><div class="cmt-text">' + esc(c.text) + "</div></div></div>";
        }).join("");
        if (canEdit()) h += '<form class="cmt-form" id="cmtForm"><textarea id="cmtText" rows="2" placeholder="' + esc(t("Write a comment… (Enter to send)")) + '" required></textarea><button class="btn primary">' + t("Send") + "</button></form>";
      } else {
        const withC = list.filter(function (x) { return x.comments && Object.keys(x.comments).length; });
        h += '<p class="panel-hint">' + t("Select a post-it to read or add comments.") + "</p>";
        if (!withC.length) h += '<div class="empty-state">' + t("No comments on this board yet.") + "</div>";
        h += withC.map(function (x) {
          return '<button class="rank-row" data-go="' + x.id + '"><span class="sw" style="background:' + (x.color || "#eee") + '"></span><span class="rank-t">' + label(x) + '</span><span class="rank-s">' + Object.keys(x.comments).length + " 💬</span></button>";
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
  function closePanel() { els.panel.hidden = true; document.body.classList.remove("panel-open"); }

  /* ================= modals ================= */
  function modal(html, onMount) {
    els.modalBody.innerHTML = html;
    els.modal.hidden = false;
    if (onMount) onMount(els.modalBody);
    const f = els.modalBody.querySelector("input,textarea,select,button");
    if (f) setTimeout(function () { f.focus(); }, 30);
  }
  function closeModal() { els.modal.hidden = true; els.modalBody.innerHTML = ""; }
  function askName() {
    if (me.name) return;
    modal('<h2>Welcome to the board 👋</h2><p class="muted">Your name appears on your cursor, post-its and comments.</p>' +
      '<form id="nameForm"><label>Your name<input id="nameIn" maxlength="40" required placeholder="e.g. Joaquim Ventura"></label>' +
      '<div class="colors">' + PEOPLE_COLORS.map(function (c) { return '<button type="button" class="pc' + (c === me.color ? " on" : "") + '" data-pc="' + c + '" style="background:' + c + '" aria-label="Colour"></button>'; }).join("") + "</div>" +
      '<div class="modal-actions"><button class="btn primary">Enter board</button></div></form>', function (root) {
      root.querySelectorAll(".pc").forEach(function (b) { b.onclick = function () { me.color = b.dataset.pc; root.querySelectorAll(".pc").forEach(function (x) { x.classList.toggle("on", x === b); }); }; });
      root.querySelector("#nameForm").onsubmit = function (e) {
        e.preventDefault();
        me.name = root.querySelector("#nameIn").value.trim() || "Guest";
        saveMe(); closeModal(); renderPeople(); sendPresence();
        if (!lsGet("cmcollab:onboarded2")) showHelp();
      };
    });
  }
  function showHelp() {
    lsSet("cmcollab:onboarded2", "1");
    modal('<h2>How to use this board</h2><ul class="help">' +
      "<li><b>Post-it:</b> double-click an empty spot, or pick the post-it tool (N) and click on the board.</li>" +
      "<li><b>Write:</b> click a post-it to select it and just start typing – or click it again.</li>" +
      "<li><b>Move:</b> drag. <b>Select several:</b> drag a box on the empty board, or Shift+click.</li>" +
      "<li><b>Images:</b> image tool (I), paste (Ctrl+V) or drag a picture from your computer onto the board.</li>" +
      "<li><b>Text:</b> text tool (T) and click where you want to write.</li>" +
      "<li><b>Navigate:</b> scroll or hold Space and drag to move, Ctrl+scroll or pinch to zoom, F to fit.</li>" +
      "<li><b>Prioritise:</b> drag post-its into Must / Should / Could / Won't, use RICE and dot voting. The Ranking panel orders everything.</li>" +
      "<li><b>Shortcuts:</b> Ctrl+C / Ctrl+V copy and paste · Alt+drag duplicate · Ctrl+D duplicate · Del delete · Ctrl+Z undo.</li></ul>" +
      '<div class="modal-actions"><button class="btn primary" id="okHelp">Got it</button></div>', function (root) { root.querySelector("#okHelp").onclick = closeModal; });
  }
  function riceModal(id) {
    const o = S.stickies[id]; if (!o) return;
    const r = o.rice || { reach: "", impact: 1, confidence: 80, effort: "" };
    modal('<h2>RICE score</h2><p class="muted no-i18n">' + label(o) + "</p>" +
      '<form id="riceForm" class="rice-form">' +
      '<label>Reach<small>How many people / times per period?</small><input type="number" min="0" step="any" id="rR" value="' + esc(r.reach) + '" required></label>' +
      '<label>Impact<small>How much will it move the needle?</small><select id="rI">' +
      [[3, "3 · Massive"], [2, "2 · High"], [1, "1 · Medium"], [0.5, "0.5 · Low"], [0.25, "0.25 · Minimal"]].map(function (x) { return '<option value="' + x[0] + '"' + (Number(r.impact) === x[0] ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") +
      '</select></label><label>Confidence<small>How sure are you about these estimates?</small><select id="rC">' +
      [[100, "100% · High"], [80, "80% · Medium"], [50, "50% · Low"], [20, "20% · Moonshot"]].map(function (x) { return '<option value="' + x[0] + '"' + (Number(r.confidence) === x[0] ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") +
      '</select></label><label>Effort<small>Person-weeks (or any consistent unit)</small><input type="number" min="0.1" step="any" id="rE" value="' + esc(r.effort) + '" required></label>' +
      '<div class="rice-live"><span>Score: </span><b id="rOut">–</b><small class="rice-formula">Reach × Impact × Confidence ÷ Effort</small></div>' +
      '<div class="modal-actions">' + (o.rice ? '<button type="button" class="btn ghost" id="rClear">Remove score</button>' : "") + '<button type="button" class="btn ghost" id="rCancel">Cancel</button><button class="btn primary">Save</button></div></form>', function (root) {
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
      (live ? '<p class="muted">Only people with access to this workspace can open the link. Manage access in Administration.</p>'
        : '<p class="muted">Demo mode: changes are saved in this browser only. Configure Firebase to save online and collaborate.</p>') +
      '<div class="copy-row"><input readonly id="shareUrl" value="' + esc(location.href) + '"><button class="btn primary" id="copyUrl">Copy link</button></div>' +
      '<div class="modal-actions">' + (CFG.isAdmin ? '<a class="btn ghost" href="' + ROOT + 'admin/">Administration</a>' : "") + '<button class="btn ghost" id="shClose">Close</button></div>', function (root) {
      root.querySelector("#copyUrl").onclick = function () {
        const inp = root.querySelector("#shareUrl"); inp.select();
        (navigator.clipboard ? navigator.clipboard.writeText(inp.value) : Promise.reject()).then(function () { toast("Link copied"); }, function () { document.execCommand("copy"); toast("Link copied"); });
      };
      root.querySelector("#shClose").onclick = closeModal;
    });
  }
  function confirmModal(title, text, okLabel, onOk) {
    modal("<h2>" + title + '</h2><p class="muted">' + text + '</p><div class="modal-actions"><button class="btn ghost" id="cNo">Cancel</button><button class="btn danger" id="cYes">' + okLabel + "</button></div>", function (root) {
      root.querySelector("#cNo").onclick = closeModal;
      root.querySelector("#cYes").onclick = function () { closeModal(); onOk(); };
    });
  }

  /* ================= timer ================= */
  function renderTimer() {
    const tm = S.meta.timer;
    clearInterval(renderTimer._i);
    if (!tm || !tm.end) { els.timerTxt.textContent = t("Timer"); els.timerBtn.classList.remove("on", "done"); return; }
    function tick() {
      const left = Math.max(0, tm.end - Date.now());
      const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      els.timerTxt.textContent = m + ":" + String(s).padStart(2, "0");
      els.timerBtn.classList.add("on");
      els.timerBtn.classList.toggle("done", left === 0);
      if (left === 0) { clearInterval(renderTimer._i); if (renderTimer._done !== tm.end) { renderTimer._done = tm.end; toast("⏰ Time's up!"); } }
    }
    tick();
    renderTimer._i = setInterval(tick, 500);
  }

  /* ================= presence & cursors ================= */
  let cursor = { x: null, y: null }, lastSend = 0;
  function sendPresence() {
    if (!me.name) return;
    sync.presence({ id: me.id, name: me.name, color: me.color, x: cursor.x, y: cursor.y });
  }
  function trackCursor(e) {
    const w = toWorld(e.clientX, e.clientY);
    lastWorld = w;
    cursor = { x: Math.round(w.x), y: Math.round(w.y) };
    const now = Date.now();
    if (now - lastSend > 60) { lastSend = now; sendPresence(); }
  }
  function renderPeople() {
    const list = Object.keys(peers).filter(function (k) { return k !== me.id && peers[k] && peers[k].name && Date.now() - (peers[k].t || 0) < 60000; }).map(function (k) { return Object.assign({ id: k }, peers[k]); });
    const all = [{ id: me.id, name: (me.name || "You") + " (you)", ini: initials(me.name || "You"), color: me.color }].concat(list);
    els.people.innerHTML = all.slice(0, 6).map(function (p) {
      return '<span class="av no-i18n" style="background:' + p.color + '" title="' + esc(p.name) + '">' + esc(p.ini || initials(p.name)) + "</span>";
    }).join("") + (all.length > 6 ? '<span class="av more">+' + (all.length - 6) + "</span>" : "");
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
      c.style.left = p.x + "px"; c.style.top = p.y + "px";
      c.style.setProperty("--inv", 1 / view.s);
    });
    els.cursors.querySelectorAll(".cursor").forEach(function (c) { if (!seen[c.dataset.p]) c.remove(); });
  }

  /* ================= import / export ================= */
  function exportBoard() {
    const data = { app: "CM Collaborator", template: T.version, board: CFG.id, exportedAt: new Date().toISOString(), data: S };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (CFG.id || "board") + "-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast("Board exported");
  }
  function importBoard(file) {
    if (!canEdit()) return toast("View only – you can read this board but not edit it");
    const fr = new FileReader();
    fr.onload = function () {
      try {
        const j = JSON.parse(fr.result);
        const d = j.data || j;
        if (!d || typeof d !== "object" || !d.stickies) throw new Error("bad");
        confirmModal(t("Import board?"), t("This replaces the current content of the board for everyone."), t("Replace board"), function () {
          const nd = { stickies: d.stickies || {}, fields: d.fields || {}, photos: d.photos || {}, images: d.images || {}, meta: Object.assign({}, d.meta || {}, { template: T.version }) };
          Object.keys(nd.stickies).forEach(function (k) { if (!nd.stickies[k].id) nd.stickies[k].id = k; });
          track(sync.replaceAll(nd));
          apply("*", nd);
          undoStack.length = 0; redoStack.length = 0;
          setTimeout(fit, 50);
          toast("Board imported");
        });
      } catch (e) { toast("That file is not a CM Collaborator export"); }
    };
    fr.readAsText(file);
  }
  function seedData() {
    const st = {};
    (T.seeds || []).forEach(function (s, i) {
      const id = "seed" + i;
      st[id] = { id: id, type: "sticky", x: s.x, y: s.y, w: s.w || 120, h: s.h || 120, color: s.color, text: "", z: i + 1, t: Date.now() };
    });
    return { stickies: st, fields: Object.assign({}, CFG.defaults || {}), photos: {}, images: {}, meta: { template: T.version, created: Date.now() } };
  }

  /* ================= pointer & keyboard ================= */
  function bind() {
    const vp = els.viewport;
    const pointers = new Map();
    let pinch = null;

    vp.addEventListener("contextmenu", function (e) { if (!e.target.closest(".txt[contenteditable=true]")) e.preventDefault(); });

    vp.addEventListener("pointerdown", function (e) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const p = Array.from(pointers.values());
        pinch = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), s: view.s };
        if (gesture && gesture.type === "drag") endGesture(e);
        gesture = { type: "pinch" };
        return;
      }
      const objEl = e.target.closest(".obj");
      if (objEl && editing === objEl.dataset.id && e.target.closest(".txt")) return;
      if (e.target.closest("[data-field]") || (e.target.closest(".photo") && canEdit())) { if (editing) stopEdit(); return; }
      if (editing) stopEdit();
      const w = toWorld(e.clientX, e.clientY);
      lastWorld = w;

      const panning = tool === "hand" || spaceDown || e.button === 1 || e.button === 2 || (e.pointerType === "touch" && !objEl);
      if (panning) {
        gesture = { type: "pan", x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        vp.classList.add("panning");
        vp.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;

      if ((tool === "sticky" || tool === "text") && canEdit()) {
        let o;
        if (tool === "sticky") o = newObj("sticky", w.x - 60, w.y - 60, { color: placeColor });
        else {
          const onLight = document.elementsFromPoint(e.clientX, e.clientY).some(function (n) { return n.closest && n.closest(".frame,.quad,.zone,.obj"); });
          o = newObj("text", w.x - 10, w.y - 18, { color: onLight ? "#1c2033" : "#ffffff" });
        }
        if (createObj(o)) { setTool("select"); selectOnly(o.id); setTimeout(function () { startEdit(o.id); }, 0); }
        e.preventDefault();
        return;
      }

      if (objEl) {
        const id = objEl.dataset.id, o = S.stickies[id];
        if (!o) return;
        const wasOnly = sel.size === 1 && sel.has(id);
        if (e.shiftKey) { toggleSel(id); if (!sel.has(id)) return; }
        else if (!sel.has(id)) selectOnly(id);
        if (!canEdit()) return;
        const resizing = e.target.classList.contains("rz") && sel.size === 1;
        const ids = resizing ? [id] : Array.from(sel);
        const orig = {};
        ids.forEach(function (k) { orig[k] = clone(S.stickies[k]); });
        gesture = { type: resizing ? "resize" : "drag", ids: ids, orig: orig, sx: w.x, sy: w.y, moved: false, clickId: id, wasOnly: wasOnly, alt: e.altKey, ar: (o.h || 120) / (o.w || 120) };
        vp.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      // empty board → selection box
      gesture = { type: "marquee", sx: w.x, sy: w.y, base: e.shiftKey ? Array.from(sel) : [], moved: false, cx: e.clientX, cy: e.clientY };
      if (!e.shiftKey) setSel([]);
      vp.setPointerCapture(e.pointerId);
    });

    vp.addEventListener("pointermove", function (e) {
      trackCursor(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!gesture) return;
      if (gesture.type === "pinch" && pinch && pointers.size === 2) {
        const p = Array.from(pointers.values());
        const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        const r = vp.getBoundingClientRect();
        zoomAt((p[0].x + p[1].x) / 2 - r.left, (p[0].y + p[1].y) / 2 - r.top, pinch.s * d / pinch.d);
        pinch.s = view.s; pinch.d = d;
        return;
      }
      if (gesture.type === "pan") {
        view.x = gesture.vx + e.clientX - gesture.x;
        view.y = gesture.vy + e.clientY - gesture.y;
        applyView();
        return;
      }
      const w = toWorld(e.clientX, e.clientY);
      const dx = w.x - gesture.sx, dy = w.y - gesture.sy;
      if (gesture.type === "marquee") {
        if (!gesture.moved && Math.hypot(e.clientX - gesture.cx, e.clientY - gesture.cy) < 4) return;
        gesture.moved = true;
        const x = Math.min(gesture.sx, w.x), y = Math.min(gesture.sy, w.y), mw = Math.abs(dx), mh = Math.abs(dy);
        const m = els.marquee;
        m.hidden = false;
        m.style.left = x + "px"; m.style.top = y + "px"; m.style.width = mw + "px"; m.style.height = mh + "px";
        m.style.borderWidth = (1.5 / view.s) + "px";
        const hit = Object.keys(S.stickies).filter(function (k) {
          const r = rectOf(S.stickies[k]);
          return r.x < x + mw && r.x + r.w > x && r.y < y + mh && r.y + r.h > y;
        });
        const set = new Set(gesture.base.concat(hit));
        setSel(Array.from(set));
        return;
      }
      if (gesture.type === "drag" || gesture.type === "resize") {
        if (!gesture.moved && Math.hypot(dx, dy) * view.s < 3) return;
        if (!gesture.moved) {
          gesture.moved = true;
          els.ctx.hidden = true;
          if (gesture.type === "drag" && gesture.alt) {
            // Alt+drag: leave originals in place, drag fresh copies
            const r = cloneObjs(gesture.ids.map(function (k) { return gesture.orig[k]; }), 0, 0);
            r.ch.forEach(function (c) { apply(c.path, clone(c.value)); });
            gesture.created = r.ch;
            gesture.ids = r.ids;
            gesture.orig = {};
            r.ids.forEach(function (k) { gesture.orig[k] = clone(S.stickies[k]); });
            setSel(r.ids);
            els.ctx.hidden = true;
          } else if (gesture.type === "drag") {
            let z = maxZ();
            gesture.ids.forEach(function (k) { S.stickies[k].z = ++z; });
          }
          gesture.ids.forEach(function (k) { if (els.objs[k]) els.objs[k].classList.add("lifting"); });
        }
        gesture.ids.forEach(function (k) {
          const o = S.stickies[k], o0 = gesture.orig[k], el = els.objs[k];
          if (!o || !el) return;
          if (gesture.type === "drag") {
            o.x = Math.round(o0.x + dx); o.y = Math.round(o0.y + dy);
            el.style.left = o.x + "px"; el.style.top = o.y + "px"; el.style.zIndex = o.z;
          } else {
            const tp = typeOf(o);
            o.w = Math.max(tp === "text" ? 60 : 50, Math.round(o0.w + dx));
            if (tp === "image" && !e.shiftKey) o.h = Math.round(o.w * gesture.ar);
            else if (tp !== "text") o.h = Math.max(40, Math.round(o0.h + dy));
            el.style.width = o.w + "px";
            if (tp !== "text") el.style.height = o.h + "px";
            if (tp === "sticky") fitText(el);
          }
          if (!gesture.created) livePut(k);
        });
      }
    });

    function endGesture(e) {
      const g = gesture; gesture = null;
      if (!g) return;
      if (g.type === "pan") { vp.classList.remove("panning"); return; }
      if (g.type === "marquee") { els.marquee.hidden = true; updateCtx(); return; }
      if (g.type === "drag" || g.type === "resize") {
        g.ids.forEach(function (k) { if (els.objs[k]) els.objs[k].classList.remove("lifting"); });
        if (g.moved) {
          const ch = [];
          if (g.created) {
            g.created.forEach(function (c) {
              if (c.path.indexOf("images/") === 0) ch.push({ path: c.path, value: c.value, before: null });
            });
            g.ids.forEach(function (k) { ch.push({ path: "stickies/" + k, value: clone(S.stickies[k]), before: null }); });
          } else {
            g.ids.forEach(function (k) { if (S.stickies[k]) ch.push({ path: "stickies/" + k, value: clone(S.stickies[k]), before: g.orig[k] }); });
          }
          commit(ch);
          updateCtx();
        } else if (g.wasOnly && e && !e.shiftKey && g.type === "drag") {
          const o = S.stickies[g.clickId];
          if (o && typeOf(o) !== "image") startEdit(g.clickId);
        }
      }
    }
    function up(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (gesture && gesture.type === "pinch") { if (pointers.size === 0) gesture = null; return; }
      endGesture(e);
    }
    vp.addEventListener("pointerup", up);
    vp.addEventListener("pointercancel", up);
    vp.addEventListener("pointerleave", function () { cursor = { x: null, y: null }; sendPresence(); });

    vp.addEventListener("dblclick", function (e) {
      if (!canEdit()) return;
      const objEl = e.target.closest(".obj");
      if (objEl) { const o = S.stickies[objEl.dataset.id]; if (o && typeOf(o) !== "image") startEdit(o.id, { selectAll: false }); return; }
      if (e.target.closest("[data-field],.photo")) return;
      const w = toWorld(e.clientX, e.clientY);
      const color = zoneColorAt(e.clientX, e.clientY) || placeColor || PALETTE[0];
      const o = newObj("sticky", w.x - 60, w.y - 60, { color: color });
      if (createObj(o)) { selectOnly(o.id); startEdit(o.id); }
      e.preventDefault();
    });

    vp.addEventListener("wheel", function (e) {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      const mouseWheel = e.deltaMode === 1 || (Math.abs(e.deltaY) >= 50 && !e.deltaX && Number.isInteger(e.deltaY));
      if (e.ctrlKey || e.metaKey || mouseWheel) {
        zoomAt(e.clientX - r.left, e.clientY - r.top, view.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
      } else {
        view.x -= e.deltaX; view.y -= e.deltaY; applyView();
      }
    }, { passive: false });

    // typing inside a post-it / text
    els.layer.addEventListener("input", function (e) {
      const el = e.target.closest(".obj"); if (!el) return;
      if (el.dataset.type === "sticky") fitText(el);
      el.classList.toggle("empty", !e.target.innerText.trim());
      clearTimeout(typingTimer);
      const id = el.dataset.id;
      typingTimer = setTimeout(function () {
        if (editing === id && S.stickies[id]) {
          S.stickies[id].text = e.target.innerText.trim();
          sync.put("stickies/" + id + "/text", S.stickies[id].text).catch(function () { /* reported on stop */ });
        }
      }, 400);
    });
    els.layer.addEventListener("focusout", function (e) {
      if (e.target.classList && e.target.classList.contains("txt")) setTimeout(function () { if (editing && document.activeElement !== (els.objs[editing] && els.objs[editing].querySelector(".txt"))) stopEdit(); }, 0);
    });

    // template fields
    els.tpl.querySelectorAll("[data-field]").forEach(function (f) {
      f.contentEditable = canEdit() ? "true" : "false";
      f.spellcheck = false;
      let before = "";
      f.addEventListener("focus", function () { before = S.fields[f.dataset.field] || ""; });
      f.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); f.blur(); } });
      f.addEventListener("paste", function (e) { e.preventDefault(); e.stopPropagation(); document.execCommand("insertText", false, (e.clipboardData || window.clipboardData).getData("text").replace(/\s+/g, " ")); });
      f.addEventListener("blur", function () {
        const v = f.innerText.replace(/\s+/g, " ").trim();
        f.textContent = v;
        if (v !== before) write("fields/" + f.dataset.field, v || null, { before: before || null });
      });
    });
    let photoKey = null;
    els.tpl.querySelectorAll(".photo").forEach(function (p) {
      p.addEventListener("click", function (e) {
        if (!canEdit()) return;
        if (e.target.closest(".photo-x")) { write("photos/" + p.dataset.photo, null); return; }
        photoKey = p.dataset.photo; $("#filePhoto").click();
      });
    });
    $("#filePhoto").addEventListener("change", function (e) {
      const f = e.target.files[0]; e.target.value = "";
      if (!f || !photoKey) return;
      readImage(f, photoKey === "avatar" ? 320 : 900, 0.82).then(function (r) { write("photos/" + photoKey, r.url); }, function () { toast("Could not read that image"); });
    });

    // drag & drop images
    let dragDepth = 0;
    vp.addEventListener("dragenter", function (e) { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf("Files") >= 0) { dragDepth++; els.dropHint.hidden = false; } });
    vp.addEventListener("dragleave", function () { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) els.dropHint.hidden = true; });
    vp.addEventListener("dragover", function (e) { e.preventDefault(); });
    vp.addEventListener("drop", function (e) {
      e.preventDefault(); dragDepth = 0; els.dropHint.hidden = true;
      if (e.dataTransfer && e.dataTransfer.files.length) addImageFiles(e.dataTransfer.files, toWorld(e.clientX, e.clientY));
    });

    // clipboard
    document.addEventListener("copy", function (e) { if (isTyping(e.target)) return; copySel(e); });
    document.addEventListener("cut", function (e) { if (isTyping(e.target) || !canEdit()) return; if (copySel(e)) deleteSel(); });
    document.addEventListener("paste", function (e) {
      const cd = e.clipboardData || window.clipboardData;
      if (editing && e.target.closest && e.target.closest(".txt")) { e.preventDefault(); document.execCommand("insertText", false, cd.getData("text")); return; }
      if (isTyping(e.target) || !els.modal.hidden) return;
      if (!canEdit()) return;
      const files = Array.from(cd.files || []).filter(function (f) { return /^image\//.test(f.type); });
      if (files.length) { e.preventDefault(); return addImageFiles(files, lastWorld); }
      const own = cd.getData("application/x-cmcollab");
      if (own) { e.preventDefault(); try { return pasteObjs(JSON.parse(own), lastWorld); } catch (x) { /* fall through */ } }
      const txt = (cd.getData("text") || "").trim();
      if (clipboard && (!txt || txt === clipboard.objs.map(function (o) { return o.text || ""; }).filter(Boolean).join("\n").trim())) { e.preventDefault(); return pasteObjs(clipboard, lastWorld); }
      if (txt) {
        e.preventDefault();
        const p = lastWorld || viewCenterWorld();
        const lines = txt.split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean).slice(0, 30);
        const ch = [], ids = [];
        lines.forEach(function (l, i) {
          const o = newObj("sticky", p.x - 60 + (i % 5) * 135, p.y - 60 + Math.floor(i / 5) * 135, { text: l.slice(0, 500) });
          ch.push({ path: "stickies/" + o.id, value: o, before: null }); ids.push(o.id);
        });
        if (commit(ch)) setSel(ids);
      }
    });

    // toolbar
    els.toolbar.addEventListener("click", function (e) {
      const b = e.target.closest("[data-tool]");
      if (b) { if (!canEdit() && b.dataset.tool !== "select" && b.dataset.tool !== "hand") return toast("View only – you can read this board but not edit it"); setTool(b.dataset.tool); }
    });
    $("#addSwatches").onclick = function (e) { const b = e.target.closest("button"); if (b) { placeColor = b.dataset.c; setTool("sticky"); toast("Click on the board to place the post-it"); } };
    $("#tbImage").onclick = function () { if (!canEdit()) return toast("View only – you can read this board but not edit it"); $("#fileImage").click(); };
    $("#fileImage").onchange = function (e) { const f = e.target.files; addImageFiles(f, viewCenterWorld()); e.target.value = ""; };
    $("#tbUndo").onclick = undo;
    $("#tbRedo").onclick = redo;
    $("#tbExport").onclick = exportBoard;
    $("#tbImport").onclick = function () { $("#fileImport").click(); };
    $("#fileImport").onchange = function (e) { const f = e.target.files[0]; e.target.value = ""; if (f) importBoard(f); };
    $("#tbPrint").onclick = function () { deselect(); fit(); setTimeout(function () { window.print(); }, 150); };
    const rs = $("#tbReset");
    if (rs) rs.onclick = function () {
      confirmModal(t("Reset board?"), t("All post-its, fields and photos will be replaced by the empty template. Export first if you want a backup."), t("Reset"), function () {
        const d = seedData(); track(sync.replaceAll(d)); apply("*", d); undoStack.length = 0; redoStack.length = 0; toast("Board reset");
      });
    };
    $("#tbHelp").onclick = showHelp;
    $("#zIn").onclick = function () { zoomCenter(1.2); };
    $("#zOut").onclick = function () { zoomCenter(1 / 1.2); };
    $("#zPct").onclick = function () { const r = vp.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1); };
    $("#zFit").onclick = fit;

    els.ctx.addEventListener("pointerdown", function (e) { e.preventDefault(); });
    els.ctx.addEventListener("click", function (e) { const b = e.target.closest("[data-act]"); if (b) ctxAction(b.dataset.act, b.dataset.c); });

    // panel
    $("#btnPanel").onclick = function () { if (els.panel.hidden) openPanel(); else closePanel(); };
    $("#panelClose").onclick = closePanel;
    els.panel.querySelector(".tabs").onclick = function (e) { const b = e.target.closest("button"); if (b) { panelTab = b.dataset.tab; renderPanel(); } };
    els.panelBody.addEventListener("click", function (e) {
      const go = e.target.closest("[data-go]");
      if (go) { focusObj(go.dataset.go); return; }
      const dc = e.target.closest("[data-delc]");
      const one = single();
      if (dc && one) { write("stickies/" + one.id + "/comments/" + dc.dataset.delc, null, { noHistory: true }); return; }
      if (e.target.id === "clearMyVotes") {
        commit(Object.keys(S.stickies).filter(function (k) { const v = S.stickies[k].votes; return v && v[me.id]; }).map(function (k) { return { path: "stickies/" + k + "/votes/" + me.id, value: null }; }), { noHistory: true });
      }
    });
    els.panelBody.addEventListener("submit", function (e) {
      if (e.target.id !== "cmtForm") return;
      e.preventDefault();
      const ta = $("#cmtText"), v = ta.value.trim(), one = single();
      if (!v || !one) return;
      write("stickies/" + one.id + "/comments/" + uid(), { by: me.id, name: me.name, color: me.color, text: v, t: Date.now() }, { noHistory: true });
      setTimeout(function () { const x = $("#cmtText"); if (x) x.focus(); }, 160);
    });
    els.panelBody.addEventListener("keydown", function (e) {
      if (e.target.id === "cmtText" && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.target.form.requestSubmit(); }
    });

    $("#btnShare").onclick = shareModal;
    els.timerBtn.onclick = timerModal;
    const so = $("#btnSignOut");
    if (so) so.onclick = function () { confirmModal(t("Sign out?"), t("You will need to sign in again to open this board."), t("Sign out"), function () { window.CMAuth.signOut(); }); };
    els.modal.addEventListener("pointerdown", function (e) { if (e.target === els.modal && !$("#nameForm")) closeModal(); });

    // keyboard
    document.addEventListener("keydown", function (e) {
      const typing = isTyping(e.target);
      if (e.key === "Escape") {
        if (!els.modal.hidden && !$("#nameForm")) return closeModal();
        if (editing) { stopEdit(); return; }
        setTool("select");
        return deselect();
      }
      if (typing || !els.modal.hidden) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (e.key === " " && !spaceDown) { spaceDown = true; els.viewport.classList.add("space"); e.preventDefault(); return; }
      if (mod && k === "z") { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
      if (mod && k === "y") { e.preventDefault(); return redo(); }
      if (mod && k === "d") { e.preventDefault(); return duplicate(); }
      if (mod && k === "a") { e.preventDefault(); return setSel(Object.keys(S.stickies)); }
      if (mod) return;
      if ((e.key === "Delete" || e.key === "Backspace") && sel.size) { e.preventDefault(); return canEdit() ? deleteSel() : null; }
      if (e.key === "Enter" && sel.size === 1) { e.preventDefault(); return startEdit(Array.from(sel)[0]); }
      if (e.key.indexOf("Arrow") === 0 && sel.size && canEdit()) {
        e.preventDefault();
        const st = e.shiftKey ? 20 : 2;
        const dx = e.key === "ArrowLeft" ? -st : e.key === "ArrowRight" ? st : 0, dy = e.key === "ArrowUp" ? -st : e.key === "ArrowDown" ? st : 0;
        return commit(selObjs().map(function (o) { return { path: "stickies/" + o.id, value: Object.assign(clone(o), { x: o.x + dx, y: o.y + dy }) }; }));
      }
      // start typing on a selected post-it / text (Miro behaviour)
      const one = single();
      if (one && typeOf(one) !== "image" && e.key.length === 1 && !e.altKey && canEdit()) { startEdit(one.id); return; }
      if (sel.size) return;
      if (k === "v") return setTool("select");
      if (k === "h") return setTool("hand");
      if (k === "n" && canEdit()) return setTool("sticky");
      if (k === "t" && canEdit()) return setTool("text");
      if (k === "i" && canEdit()) return $("#fileImage").click();
      if (k === "f") return fit();
      if (e.key === "+" || e.key === "=") return zoomCenter(1.2);
      if (e.key === "-") return zoomCenter(1 / 1.2);
    });
    document.addEventListener("keyup", function (e) { if (e.key === " ") { spaceDown = false; els.viewport.classList.remove("space"); } });
    window.addEventListener("blur", function () { spaceDown = false; els.viewport.classList.remove("space"); });
    window.addEventListener("resize", positionCtx);
    window.addEventListener("beforeunload", function (e) {
      if (editing) stopEdit();
      sync.leave(me.id);
      if (pending > 0) { e.preventDefault(); e.returnValue = ""; }
    });
    setInterval(sendPresence, 5000);
    setInterval(renderPeople, 15000);
  }
  function isTyping(el) { return !!(el && (el.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(el.tagName))); }

  function renderAll() {
    Object.keys(els.objs).forEach(function (id) { if (!S.stickies[id]) removeObjEl(id); });
    Object.keys(S.stickies).forEach(function (k) { const o = S.stickies[k]; if (!o) return; if (!o.id) o.id = k; renderObj(o); });
    els.tpl.querySelectorAll("[data-field]").forEach(function (f) { renderField(f.dataset.field); });
    els.tpl.querySelectorAll("[data-photo]").forEach(function (p) { renderPhoto(p.dataset.photo); });
    renderTimer();
    schedulePanel();
  }

  /* ================= boot ================= */
  function boot() {
    T = window.MB_TEMPLATES[CFG.template] || window.MB_TEMPLATES.persona;
    W = T.world.w; H = T.world.h;
    buildShell();
    els.layer = document.getElementById("objs");
    els.objs = {};
    sync = window.MBSync.create(CFG.id || "board");
    showSave();
    bind();
    setTool("select");
    fit();
    sync.onPresence(function (p) { peers = p || {}; renderPeople(); });
    sync.init(function (path, value) { apply(path, value); }).then(function (data) {
      if (!data || !data.meta || !data.stickies) {
        const d = seedData();
        Object.assign(d.fields, (data && data.fields) || {});
        if (canEdit()) track(sync.replaceAll(d));
        data = d;
      }
      apply("*", data);
      setTimeout(fit, 30);
      renderPeople();
      if (!me.name) askName(); else { sendPresence(); if (!lsGet("cmcollab:onboarded2")) showHelp(); }
    }).catch(function (err) {
      console.error(err);
      toast("Could not load the board – check your connection");
    });
    document.body.classList.add("ready");
    if (CFG.readOnly) { document.body.classList.add("readonly"); setTimeout(function () { toast("View only – you can read this board but not edit it"); }, 800); }
  }

  /* ================= access gate ================= */
  function prettify(id) { return String(id || "Board").split("-").map(function (w) { return w ? w[0].toUpperCase() + w.slice(1) : w; }).join(" "); }
  function gateScreen(title, text, actions) {
    document.body.className = "gate-page";
    document.body.innerHTML = '<main class="gate"><a class="brand" href="' + ROOT + '"><span class="logo">CM</span><span>CM Collaborator</span></a>' +
      "<h1>" + t(title) + "</h1><p>" + text + '</p><div class="gate-actions">' + (actions || "") + '</div><div class="lang" data-lang-switch></div></main>';
    const so = document.getElementById("gateSignOut");
    if (so) so.onclick = function () { window.CMAuth.signOut(); };
  }
  function start() {
    if (!CFG.id || !/^[a-z0-9-]{2,60}$/.test(CFG.id)) {
      return gateScreen("Board not found", t("This link is incomplete. Open your boards from the Mentoring page."), '<a class="btn primary" href="' + ROOT + 'mentoring/">' + t("My boards") + "</a>");
    }
    if (!window.CMAuth || !window.CMAuth.enabled) {
      CFG.title = CFG.title || prettify(CFG.id);
      CFG.template = CFG.template || "persona";
      CFG.defaults = CFG.defaults || { name: CFG.title };
      CFG.crumbs = [{ label: t("Home"), href: ROOT }, { label: t("My boards"), href: ROOT + "mentoring/" }, { label: CFG.title }];
      return boot();
    }
    gateScreen("Loading…", t("Checking your access to this board."));
    window.CMAuth.ready().then(function (user) {
      if (!user) {
        return gateScreen("Sign in required", t("This board is private. Sign in with the e-mail address the mentor invited."),
          '<a class="btn primary" href="' + ROOT + "mentoring/?next=" + encodeURIComponent(location.pathname + location.search) + '">' + t("Sign in") + "</a>");
      }
      const db = window.CMAuth.db(), key = window.CMAuth.key(user.email);
      return Promise.all([window.CMAuth.isAdmin(), db.ref("boards/" + CFG.id + "/info").once("value")]).then(function (r) {
        const admin = r[0], info = r[1].val();
        if (!info) return gateScreen("Board not found", t("This board does not exist or was removed."), '<a class="btn primary" href="' + ROOT + 'mentoring/">' + t("My boards") + "</a>");
        const wsP = info.ws ? db.ref("workspaces/" + info.ws + "/info/name").once("value").then(function (s) { return s.val(); }, function () { return null; }) : Promise.resolve(null);
        const roleP = admin ? Promise.resolve("editor") : db.ref("workspaces/" + info.ws + "/members/" + key + "/role").once("value").then(function (s) { return s.val() || "viewer"; });
        return Promise.all([wsP, roleP]).then(function (x) {
          const wsName = x[0], role = x[1];
          CFG.title = info.title || prettify(CFG.id);
          CFG.template = info.template || "persona";
          CFG.defaults = CFG.template === "persona" ? { name: info.title } : {};
          CFG.readOnly = role === "viewer";
          CFG.isAdmin = admin;
          CFG.signedIn = true;
          CFG.crumbs = [{ label: t("My boards"), href: ROOT + "mentoring/" }].concat(wsName ? [{ label: wsName }] : []).concat([{ label: CFG.title }]);
          me.id = user.uid;
          if (!me.name) me.name = user.displayName || user.email.split("@")[0];
          saveMe();
          boot();
        });
      }).catch(function (err) {
        console.warn(err);
        gateScreen("No access", t("Your account (" + esc(user.email) + ") doesn't have access to this board. Ask the mentor for an invitation."),
          '<a class="btn primary" href="' + ROOT + 'mentoring/">' + t("My boards") + '</a><button class="btn" id="gateSignOut">' + t("Use another account") + "</button>");
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
