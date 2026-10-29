/*
 * CM Collaborator – collaborative whiteboard engine (Miro-style)
 *
 * Objects live in data/stickies/{id} with a `type`:
 *   sticky | text | image | frame | shape | arrow | icon
 * Image pixels / links live in data/images/{id} so moving an image never re-sends it.
 *
 *   click            select (and drag straight away)        shift+click  add / remove from selection
 *   click again      edit text                              type         start editing the selected item
 *   drag on empty    selection box                         space+drag / middle / right drag / H: pan
 *   alt+drag         duplicate                             double-click empty: new post-it
 *   ctrl+c / x / v   copy / cut / paste (images, GIFs and plain text from other apps too)
 *   V select · H hand · N post-it · T text · R shape · L connector · F frame · I image · Shift+1 fit
 */
(function () {
  "use strict";

  const CFG = window.BOARD_CONFIG || {};
  let T = null, W = 1600, H = 1000;
  const VOTES = window.CMCOLLAB_VOTES_PER_USER || 5;
  const ROOT = CFG.root || "./";
  const PALETTE = ["#FFF59D", "#FFCF8A", "#F7A8B0", "#F6C1E4", "#CDBDF6", "#A9D1F7", "#9FE3D3", "#C8EBA1", "#E6E6E6"];
  const TEXT_COLORS = ["#1c2033", "#e5484d", "#f76b15", "#12a594", "#4262ff", "#8e4ec6", "#ffffff"];
  const FRAME_COLORS = ["#ffffff", "#f4f5f8", "#fff8d6", "#eaf7dc", "#e3f0fd", "#fde7e9", "#f4eefe", "#1c2033"];
  const FILL_COLORS = ["#ffffff", "#FFF59D", "#FFCF8A", "#F7A8B0", "#CDBDF6", "#A9D1F7", "#9FE3D3", "#C8EBA1", "#1c2033"];
  const SHAPES = ["rect", "round", "pill", "ellipse", "diamond", "triangle", "hexagon"];
  const PEOPLE_COLORS = ["#4262FF", "#E5484D", "#12A594", "#F76B15", "#8E4EC6", "#D6409F", "#0090FF", "#3E9B4F"];
  const t = function (s) { return window.MBt ? window.MBt(s) : s; };
  const ICONS = window.MB_ICONS || {};

  const S = { stickies: {}, fields: {}, photos: {}, images: {}, meta: {} };
  const els = { objs: {} };
  let sync;
  let view = { x: 0, y: 0, s: 1 };
  const sel = new Set();
  let editing = null, gesture = null, tool = "select", placeColor = PALETTE[0], placeShape = "round", spaceDown = false;
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
  function hasText(type) { return type === "sticky" || type === "text" || type === "shape" || type === "frame"; }
  function textField(o) { return typeOf(o) === "frame" ? "title" : "text"; }
  function darkCanvas() { return S.meta && S.meta.bg === "dark"; }

  /* ================= icons ================= */
  const I = {
    select: '<path d="M5 3l14 8-6 1.5L10 19z"/>',
    hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7-2.5 0-4-1-5.5-3L3 14.5a1.6 1.6 0 0 1 2.5-2L8 15"/>',
    template: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/>',
    sticky: '<path d="M4 4h16v11l-5 5H4z"/><path d="M15 20v-5h5"/>',
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    shape: '<rect x="3" y="11" width="10" height="10" rx="1.5"/><circle cx="16" cy="8" r="5"/>',
    arrow: '<path d="M4 20L19 5M11 5h8v8"/>',
    frame: '<path d="M7 3v18M17 3v18M3 7h18M3 17h18"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14c1 1.5 2.4 2 4 2s3-.5 4-2"/><path d="M9 9.5v.01M15 9.5v.01"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
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
    back: '<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M20 8v12H8"/>',
    head: '<path d="M4 12h14M13 7l5 5-5 5"/>',
    megaphone: '<path d="M3 10v4h3l7 5V5L6 10z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>'
  };
  function ico(n) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + I[n] + "</svg>"; }
  function shapeIco(k) {
    const m = { rect: '<rect x="4" y="6" width="16" height="12"/>', round: '<rect x="4" y="6" width="16" height="12" rx="3"/>', pill: '<rect x="3" y="7" width="18" height="10" rx="5"/>', ellipse: '<ellipse cx="12" cy="12" rx="9" ry="6.5"/>', diamond: '<path d="M12 3l9 9-9 9-9-9z"/>', triangle: '<path d="M12 4l9 16H3z"/>', hexagon: '<path d="M7 4h10l5 8-5 8H7l-5-8z"/>' };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">' + m[k] + "</svg>";
  }

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
      (window.MBFeedback ? '<button id="btnFeedback" class="btn fb-top" title="Give feedback">' + ico("megaphone") + "<span>Feedback</span></button>" : "") +
      '<button id="btnShare" class="btn primary">' + ico("share") + "<span>Share</span></button>" +
      '<button id="btnPanel" class="icon-btn" title="Ranking & comments">' + ico("panel") + "</button>" +
      (CFG.isAdmin ? '<a class="icon-btn" href="' + ROOT + 'admin/" title="Administration">' + ico("lock") + "</a>" : "") +
      (CFG.signedIn ? '<button id="btnSignOut" class="icon-btn" title="Sign out">' + ico("logout") + "</button>" : "") +
      "</header>" +
      '<main id="viewport" tabindex="-1"><div id="world"><div id="tpl"></div><div id="objs"></div><div id="marquee" hidden></div><div id="cursors"></div></div>' +
      '<div id="dropHint" hidden><div>' + ico("image") + "<span>Drop images or GIFs to add them to the board</span></div></div></main>" +
      '<aside id="toolbar" aria-label="Tools">' +
      '<button class="tb" data-tool="select" title="Select (V)">' + ico("select") + "</button>" +
      '<button class="tb" data-tool="hand" title="Hand – move the board (H or hold Space)">' + ico("hand") + "</button>" +
      '<button class="tb accent" id="tbTemplates" title="Templates">' + ico("template") + "</button>" +
      '<span class="sep"></span>' +
      '<div class="tool-fly"><button class="tb" data-tool="sticky" id="tbSticky" title="Post-it (N) – click on the board to place">' + ico("sticky") + '</button><div class="fly swatches" id="addSwatches"></div></div>' +
      '<button class="tb" data-tool="text" title="Text (T)">' + ico("text") + "</button>" +
      '<div class="tool-fly"><button class="tb" data-tool="shape" id="tbShape" title="Shape (R)">' + ico("shape") + '</button><div class="fly shapes" id="shapeFly"></div></div>' +
      '<button class="tb" data-tool="arrow" title="Connector / arrow (L) – drag from one item to another">' + ico("arrow") + "</button>" +
      '<button class="tb" data-tool="frame" title="Frame (F) – drag to draw a white area">' + ico("frame") + "</button>" +
      '<button class="tb" id="tbIcons" title="Icons & emoji">' + ico("smile") + "</button>" +
      '<div class="tool-fly"><button class="tb" id="tbImage" title="Image or GIF (I)">' + ico("image") + '</button><div class="fly menu" id="imgFly">' +
      '<button data-img="upload">' + ico("upload") + '<span>Upload image / GIF</span></button><button data-img="link">' + ico("link") + "<span>Image / GIF from a link</span></button></div></div>" +
      '<span class="sep"></span>' +
      '<button class="tb" id="tbUndo" title="Undo (Ctrl+Z)">' + ico("undo") + "</button>" +
      '<button class="tb" id="tbRedo" title="Redo (Ctrl+Shift+Z)">' + ico("redo") + "</button>" +
      '<div class="tool-fly"><button class="tb" id="tbMore" title="More">' + ico("more") + '</button><div class="fly menu" id="moreFly">' +
      '<button id="tbExport">' + ico("download") + "<span>Export board (JSON)</span></button>" +
      '<button id="tbImport">' + ico("upload") + "<span>Import board (JSON)</span></button>" +
      '<button id="tbPrint">' + ico("print") + "<span>Print / save as PDF</span></button>" +
      ((CFG.isAdmin || !CFG.signedIn) ? '<button id="tbReset">' + ico("reset") + "<span>Reset board</span></button>" : "") +
      '<button id="tbHelp">' + ico("help") + "<span>How to use</span></button></div></div>" +
      "</aside>" +
      '<div id="zoombar"><button class="tb" id="zBg" title="Board background: light / dark">' + ico("sun") + '</button><span class="sep v"></span>' +
      '<button class="tb" id="zOut" title="Zoom out">' + ico("minus") + '</button><button id="zPct" title="Reset to 100%">100%</button>' +
      '<button class="tb" id="zIn" title="Zoom in">' + ico("plus") + '</button><button class="tb" id="zFit" title="Fit board (Shift+1)">' + ico("fit") + "</button></div>" +
      '<div id="ctx" hidden></div>' +
      '<aside id="panel" hidden><div class="panel-head"><div class="tabs" role="tablist">' +
      '<button data-tab="ranking" role="tab">Ranking</button><button data-tab="comments" role="tab">Comments</button><button data-tab="votes" role="tab">Votes</button></div>' +
      '<button class="icon-btn" id="panelClose" title="Close">' + ico("close") + '</button></div><div id="panelBody"></div></aside>' +
      '<div id="toast" role="status"></div>' +
      '<input type="file" id="fileImport" accept="application/json" hidden><input type="file" id="filePhoto" accept="image/*" hidden><input type="file" id="fileImage" accept="image/*" multiple hidden>' +
      '<div class="modal" id="modal" hidden><div class="modal-card" role="dialog" aria-modal="true"><div id="modalBody"></div></div></div>';

    ["viewport", "world", "tpl", "marquee", "cursors", "toolbar", "ctx", "panel", "panelBody", "toast", "modal", "modalBody", "people", "saveState", "zPct", "timerTxt", "timerBtn", "dropHint"].forEach(function (id) { els[id] = document.getElementById(id); });
    els.layer = document.getElementById("objs");
    els.tpl.innerHTML = T.html;
    els.world.style.width = W + "px";
    els.world.style.height = H + "px";
    $("#addSwatches").innerHTML = PALETTE.map(function (c) { return '<button style="background:' + c + '" data-c="' + c + '" title="Add post-it"></button>'; }).join("");
    $("#shapeFly").innerHTML = SHAPES.map(function (k) { return '<button data-shape="' + k + '" title="' + esc(t("Shape")) + '">' + shapeIco(k) + "</button>"; }).join("");
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
    els.world.style.setProperty("--inv", 1 / view.s);
    positionCtx();
  }
  function contentBox() {
    let x0 = 0, y0 = 0, x1 = W, y1 = H;
    if (!T.html) { x0 = Infinity; y0 = Infinity; x1 = -Infinity; y1 = -Infinity; }
    Object.keys(S.stickies).forEach(function (k) {
      const r = rectOf(S.stickies[k]);
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    });
    if (!isFinite(x0)) return { x: 0, y: 0, w: W, h: H, empty: true };
    return { x: x0 - 40, y: y0 - 40, w: x1 - x0 + 80, h: y1 - y0 + 80 };
  }
  function focusBox(b, maxS) {
    const r = els.viewport.getBoundingClientRect();
    const s = Math.min(maxS || 1.2, Math.min(r.width / b.w, r.height / b.h) * 0.92);
    view = { s: s, x: (r.width - b.w * s) / 2 - b.x * s, y: (r.height - b.h * s) / 2 - b.y * s };
    applyView();
  }
  function fit() { focusBox(contentBox(), 1.2); }
  function zoomAt(px, py, ns) {
    ns = Math.max(0.08, Math.min(4, ns));
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
    if (!changes.length) return true;
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
  const liveTimers = {};
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
      refreshArrows([key]);
      if (sel.has(key)) updateCtx();
      schedulePanel();
    } else if (col === "images") {
      if (key && S.stickies[key]) renderObj(S.stickies[key]);
      else if (!key) renderAll();
    } else if (col === "fields") { if (key) renderField(key); else renderAll(); }
    else if (col === "photos") { if (key) renderPhoto(key); else renderAll(); }
    else if (col === "meta") { renderTimer(); applyBg(); }
  }

  /* ================= objects ================= */
  function maxZ() { let z = 1; Object.keys(S.stickies).forEach(function (k) { z = Math.max(z, S.stickies[k].z || 1); }); return z; }
  function minZ() { let z = 1; Object.keys(S.stickies).forEach(function (k) { z = Math.min(z, S.stickies[k].z || 1); }); return z; }
  function rectOf(o) {
    const type = typeOf(o);
    if (type === "arrow") {
      const p = arrowPts(o);
      return { x: Math.min(p.a.x, p.b.x), y: Math.min(p.a.y, p.b.y), w: Math.max(1, Math.abs(p.a.x - p.b.x)), h: Math.max(1, Math.abs(p.a.y - p.b.y)) };
    }
    let h = o.h || 120;
    if (type === "text") { const el = els.objs[o.id]; h = el ? el.offsetHeight : (o.fs || 24) * 1.5; }
    return { x: o.x, y: o.y, w: o.w || 120, h: h };
  }
  function zFor(o) { return typeOf(o) === "frame" ? Math.max(1, 50000 + (o.z || 1)) : 100000 + (o.z || 1); }

  function clipToRect(r, c, target, gap) {
    const dx = target.x - c.x, dy = target.y - c.y;
    const len = Math.hypot(dx, dy);
    if (!len) return { x: c.x, y: c.y };
    const tx = dx > 0 ? (r.x + r.w - c.x) / dx : dx < 0 ? (r.x - c.x) / dx : Infinity;
    const ty = dy > 0 ? (r.y + r.h - c.y) / dy : dy < 0 ? (r.y - c.y) / dy : Infinity;
    const k = Math.min(tx, ty);
    return { x: c.x + dx * k + dx / len * (gap || 6), y: c.y + dy * k + dy / len * (gap || 6) };
  }
  function boundRect(id) {
    const o = id && S.stickies[id];
    if (!o || typeOf(o) === "arrow" || typeOf(o) === "frame") return null;
    return rectOf(o);
  }
  function arrowPts(o) {
    const ra = boundRect(o.from), rb = boundRect(o.to);
    const ca = ra ? { x: ra.x + ra.w / 2, y: ra.y + ra.h / 2 } : { x: o.x1 || 0, y: o.y1 || 0 };
    const cb = rb ? { x: rb.x + rb.w / 2, y: rb.y + rb.h / 2 } : { x: o.x2 || 0, y: o.y2 || 0 };
    return { a: ra ? clipToRect(ra, ca, cb) : ca, b: rb ? clipToRect(rb, cb, ca) : cb };
  }
  function renderArrow(o, el) {
    const p = arrowPts(o), pad = 30;
    const x0 = Math.min(p.a.x, p.b.x) - pad, y0 = Math.min(p.a.y, p.b.y) - pad;
    const w = Math.abs(p.a.x - p.b.x) + pad * 2, h = Math.abs(p.a.y - p.b.y) + pad * 2;
    el.style.left = x0 + "px"; el.style.top = y0 + "px"; el.style.width = w + "px"; el.style.height = h + "px";
    const ax = p.a.x - x0, ay = p.a.y - y0, bx = p.b.x - x0, by = p.b.y - y0;
    const svg = el.querySelector("svg");
    svg.setAttribute("width", w); svg.setAttribute("height", h); svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    const ang = Math.atan2(by - ay, bx - ax), hl = 14, hw = 7;
    const head = o.head !== false && Math.hypot(bx - ax, by - ay) > hl;
    const ex = head ? bx - Math.cos(ang) * hl * 0.8 : bx, ey = head ? by - Math.sin(ang) * hl * 0.8 : by;
    svg.querySelector(".hit").setAttribute("d", "M" + ax + " " + ay + " L" + bx + " " + by);
    const ln = svg.querySelector(".ln");
    ln.setAttribute("d", "M" + ax + " " + ay + " L" + ex + " " + ey);
    ln.setAttribute("stroke", o.color || "#1c2033");
    ln.setAttribute("stroke-width", o.sw || 2.5);
    if (o.dash) ln.setAttribute("stroke-dasharray", "8 6"); else ln.removeAttribute("stroke-dasharray");
    const hd = svg.querySelector(".hd");
    if (head) {
      const lx = bx - Math.cos(ang) * hl + Math.sin(ang) * hw, ly = by - Math.sin(ang) * hl - Math.cos(ang) * hw;
      const rx = bx - Math.cos(ang) * hl - Math.sin(ang) * hw, ry = by - Math.sin(ang) * hl + Math.cos(ang) * hw;
      hd.setAttribute("points", bx + "," + by + " " + lx + "," + ly + " " + rx + "," + ry);
      hd.setAttribute("fill", o.color || "#1c2033");
      hd.style.display = "";
    } else hd.style.display = "none";
    const hs = el.querySelectorAll(".ah");
    hs[0].style.left = ax + "px"; hs[0].style.top = ay + "px";
    hs[1].style.left = bx + "px"; hs[1].style.top = by + "px";
  }
  function refreshArrows(ids) {
    const set = {}; ids.forEach(function (k) { set[k] = 1; });
    Object.keys(S.stickies).forEach(function (k) {
      const o = S.stickies[k];
      if (typeOf(o) === "arrow" && (set[o.from] || set[o.to]) && els.objs[k]) renderArrow(o, els.objs[k]);
    });
  }
  function shapeSvg(kind) {
    const pts = { diamond: "50,1 99,50 50,99 1,50", triangle: "50,2 98,98 2,98", hexagon: "25,2 75,2 98,50 75,98 25,98 2,50" }[kind];
    return pts ? '<polygon points="' + pts + '" vector-effect="non-scaling-stroke"/>' : "";
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
      el.className = "obj " + ({ sticky: "sticky", text: "textobj", image: "imgobj", frame: "frameobj", shape: "shapeobj", arrow: "arrowobj", icon: "iconobj" }[type] || "sticky");
      const rz = '<span class="rz" title="Resize"></span>';
      if (type === "image") el.innerHTML = '<img alt="" draggable="false"><div class="badges"></div>' + rz;
      else if (type === "frame") el.innerHTML = '<div class="ftitle"><div class="txt" spellcheck="false" data-ph="' + esc(t("Frame")) + '"></div></div>' + rz;
      else if (type === "shape") el.innerHTML = '<svg class="shp" viewBox="0 0 100 100" preserveAspectRatio="none"></svg><div class="txt" spellcheck="true" data-ph=""></div><div class="badges"></div>' + rz;
      else if (type === "arrow") el.innerHTML = '<svg class="arw"><path class="hit"/><path class="ln" fill="none" stroke-linecap="round"/><polygon class="hd"/></svg><span class="ah" data-end="1"></span><span class="ah" data-end="2"></span>';
      else if (type === "icon") el.innerHTML = '<div class="ic-in"></div>' + rz;
      else el.innerHTML = '<div class="txt" spellcheck="true" data-ph="' + esc(t(type === "text" ? "Type something" : "Click to write")) + '"></div>' + (type === "sticky" ? '<div class="badges"></div>' : "") + rz;
      els.layer.appendChild(el);
      els.objs[o.id] = el;
    }
    el.style.zIndex = zFor(o);
    el.classList.toggle("sel", sel.has(o.id));
    el.title = o.byName ? t("Added by " + o.byName) : "";
    if (type === "arrow") { renderArrow(o, el); return; }
    el.style.left = o.x + "px";
    el.style.top = o.y + "px";
    el.style.width = (o.w || 120) + "px";
    if (type === "text") {
      el.style.height = "";
      el.style.color = o.color || "#1c2033";
      el.style.fontSize = (o.fs || 24) + "px";
    } else el.style.height = (o.h || 120) + "px";
    if (type === "sticky") el.style.background = o.color || PALETTE[0];
    else if (type === "frame") {
      el.style.background = o.color || "#ffffff";
      el.classList.toggle("darkframe", (o.color || "").toLowerCase() === "#1c2033");
      el.classList.toggle("notitle", !o.title);
    } else if (type === "shape") {
      const k = o.shape || "rect", poly = ["diamond", "triangle", "hexagon"].indexOf(k) >= 0;
      el.dataset.shape = k;
      const svg = el.querySelector(".shp");
      svg.innerHTML = shapeSvg(k);
      svg.style.display = poly ? "" : "none";
      svg.style.fill = o.color || "#ffffff";
      el.style.background = poly ? "transparent" : (o.color || "#ffffff");
      el.style.color = o.tcolor || ((o.color || "").toLowerCase() === "#1c2033" ? "#ffffff" : "#1c2033");
      el.style.fontSize = (o.fs || 16) + "px";
    } else if (type === "icon") {
      const inner = el.querySelector(".ic-in");
      const key = o.emoji ? "e:" + o.emoji : "i:" + o.name;
      if (inner.dataset.k !== key) {
        inner.dataset.k = key;
        inner.innerHTML = o.emoji ? '<span class="emo">' + esc(o.emoji) + "</span>"
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[o.name] || ICONS.star || "") + "</svg>";
      }
      el.style.color = o.color || "#1c2033";
      const emo = inner.querySelector(".emo"); if (emo) emo.style.fontSize = Math.round((o.h || 80) * 0.8) + "px";
    } else if (type === "image") {
      const img = el.querySelector("img");
      const src = S.images[o.id] || "";
      if (img.getAttribute("src") !== src) { if (src) img.src = src; else img.removeAttribute("src"); }
      el.classList.toggle("loading", !src);
    }
    if (hasText(type) && editing !== o.id) {
      const tx = el.querySelector(".txt"), v = o[textField(o)] || "";
      if (tx.textContent !== v) tx.textContent = v;
      el.classList.toggle("empty", !v);
    }
    updateBadges(o);
    if (type === "sticky" || type === "shape") fitText(el);
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
    const base = el.dataset.type === "shape" ? parseFloat(el.style.fontSize) || 16 : 15;
    let size = base, guard = 0;
    tx.style.fontSize = size + "px";
    while ((tx.scrollHeight > el.clientHeight - 10 || tx.scrollWidth > el.clientWidth - 10) && size > 8 && guard++ < 16) { size -= 1; tx.style.fontSize = size + "px"; }
  }
  function removeObjEl(id) {
    const el = els.objs[id];
    if (el) el.remove();
    delete els.objs[id];
    if (sel.has(id)) { sel.delete(id); updateCtx(); }
    if (editing === id) editing = null;
  }
  function inkAt(cx, cy) {
    if (!darkCanvas()) return "#1c2033";
    const onLight = document.elementsFromPoint(cx, cy).some(function (n) { return n.closest && n.closest(".frame,.quad,.zone,.frameobj:not(.darkframe),.sticky,.shapeobj"); });
    return onLight ? "#1c2033" : "#ffffff";
  }
  function newObj(type, x, y, extra) {
    const base = { id: uid(), type: type, x: Math.round(x), y: Math.round(y), z: maxZ() + 1, by: me.id, byName: me.name, t: Date.now() };
    if (type === "sticky") Object.assign(base, { w: 120, h: 120, color: placeColor || PALETTE[0], text: "" });
    if (type === "text") Object.assign(base, { w: 260, fs: 24, color: "#1c2033", text: "" });
    if (type === "frame") Object.assign(base, { w: 800, h: 560, color: "#ffffff", title: t("Frame"), z: minZ() - 1 });
    if (type === "shape") Object.assign(base, { w: 180, h: 100, shape: placeShape, color: "#ffffff", text: "" });
    if (type === "icon") Object.assign(base, { w: 80, h: 80 });
    if (type === "arrow") Object.assign(base, { head: true, color: "#1c2033" });
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
  function objAtPoint(cx, cy, exclude) {
    const hits = document.elementsFromPoint(cx, cy);
    for (let i = 0; i < hits.length; i++) {
      const el = hits[i].closest && hits[i].closest(".obj");
      if (!el || el.dataset.id === exclude) continue;
      const tp = el.dataset.type;
      if (tp === "arrow" || tp === "frame") continue;
      return el.dataset.id;
    }
    return null;
  }
  function inside(r, f) { return r.x >= f.x - 1 && r.y >= f.y - 1 && r.x + r.w <= f.x + f.w + 1 && r.y + r.h <= f.y + f.h + 1; }
  function frameChildren(frameIds) {
    const out = [];
    frameIds.forEach(function (fid) {
      const f = S.stickies[fid]; if (!f) return;
      const fr = rectOf(f);
      Object.keys(S.stickies).forEach(function (k) {
        if (k === fid || out.indexOf(k) >= 0 || frameIds.indexOf(k) >= 0) return;
        const o = S.stickies[k];
        if (typeOf(o) === "frame" && (o.z || 1) < (f.z || 1)) return;
        if (inside(rectOf(o), fr)) out.push(k);
      });
    });
    return out;
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
  function swatches(act, colors, cur) {
    return '<div class="ctx-colors">' + colors.map(function (c) { return '<button data-act="' + act + '" data-c="' + c + '" style="background:' + c + '"' + (cur && cur.toLowerCase() === c.toLowerCase() ? ' class="on"' : "") + ' title="Change colour"></button>'; }).join("") + '</div><span class="sep v"></span>';
  }
  function updateCtx() {
    const list = selObjs();
    if (!list.length || !canEdit() || (gesture && gesture.moved)) { els.ctx.hidden = true; return; }
    const types = {}; list.forEach(function (o) { types[typeOf(o)] = 1; });
    const only = function (tp) { return Object.keys(types).length === 1 && types[tp]; };
    const one = list.length === 1 ? list[0] : null;
    let h = "";
    if (only("sticky")) h += swatches("color", PALETTE, one && one.color);
    if (only("frame")) h += swatches("color", FRAME_COLORS, one && one.color);
    if (only("shape")) {
      h += swatches("color", FILL_COLORS, one && one.color);
      h += '<div class="ctx-shapes">' + SHAPES.map(function (k) { return '<button class="cb sh' + (one && one.shape === k ? " on" : "") + '" data-act="shape" data-c="' + k + '" title="' + esc(t("Shape")) + '">' + shapeIco(k) + "</button>"; }).join("") + '</div><span class="sep v"></span>';
      h += '<button class="cb txt" data-act="fs-" title="Smaller text">A−</button><button class="cb txt" data-act="fs+" title="Bigger text">A+</button><span class="sep v"></span>';
    }
    if (only("text")) h += swatches("color", TEXT_COLORS, one && (one.color || "#1c2033")) + '<button class="cb txt" data-act="fs-" title="Smaller text">A−</button><button class="cb txt" data-act="fs+" title="Bigger text">A+</button><span class="sep v"></span>';
    if (only("arrow")) h += swatches("color", TEXT_COLORS, one && one.color) + '<button class="cb' + (one && one.head !== false ? " on" : "") + '" data-act="head" title="Arrow head">' + ico("head") + '</button><button class="cb txt' + (one && one.dash ? " on" : "") + '" data-act="dash" title="Dashed line">- -</button><span class="sep v"></span>';
    if (only("icon") && !list.some(function (o) { return o.emoji; })) h += swatches("color", TEXT_COLORS.concat(["#e8c468"]), one && one.color);
    if (one && ["sticky", "image", "shape"].indexOf(typeOf(one)) >= 0) {
      const mine = one.votes && one.votes[me.id] ? one.votes[me.id] : 0;
      h += '<button class="cb vote" data-act="vote" title="Vote (dot voting)">' + ico("vote") + "<span>" + (totalVotes(one) || "") + "</span></button>" +
        (mine ? '<button class="cb" data-act="unvote" title="Remove my vote">−</button>' : "") +
        '<button class="cb" data-act="comment" title="Comments">' + ico("comment") + "</button>" +
        '<button class="cb txt" data-act="rice" title="RICE score">RICE</button><span class="sep v"></span>';
    } else if (!one) {
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
    const titleGap = selObjs().some(function (o) { return typeOf(o) === "frame"; }) ? 30 : 0;
    let left = vr.left + view.x + (b.x + b.w / 2) * view.s - cw / 2;
    let top = vr.top + view.y + b.y * view.s - ch - 16 - titleGap;
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
    if (act === "color") return commit(list.map(function (o) { return { path: "stickies/" + o.id + "/color", value: c }; }));
    if (act === "shape") return commit(list.map(function (o) { return { path: "stickies/" + o.id + "/shape", value: c }; }));
    if (act === "head") return commit(list.map(function (o) { return { path: "stickies/" + o.id + "/head", value: o.head === false }; }));
    if (act === "dash") return commit(list.map(function (o) { return { path: "stickies/" + o.id + "/dash", value: !o.dash }; }));
    if (act === "fs+" || act === "fs-") {
      return commit(list.map(function (o) {
        const steps = [10, 12, 14, 16, 18, 24, 32, 44, 60, 80, 110];
        const cur = o.fs || (typeOf(o) === "shape" ? 16 : 24);
        let i = steps.findIndex(function (s) { return s >= cur; }); if (i < 0) i = steps.length - 1;
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
    const ids = {}; list.forEach(function (o) { ids[o.id] = 1; });
    Object.keys(S.stickies).forEach(function (k) { const o = S.stickies[k]; if (typeOf(o) === "arrow" && (ids[o.from] || ids[o.to])) ids[k] = 1; });
    const ch = [];
    Object.keys(ids).forEach(function (k) {
      const o = S.stickies[k]; if (!o) return;
      ch.push({ path: "stickies/" + k, value: null });
      if (typeOf(o) === "image") ch.push({ path: "images/" + k, value: null });
    });
    if (editing) stopEdit();
    setSel([]);
    commit(ch);
  }
  /* copy a set of objects (with arrow re-binding) – returns commit changes and new ids */
  function cloneSet(list, dx, dy, images) {
    let z = maxZ();
    const map = {}, ch = [], ids = [];
    list.forEach(function (o) { map[o.id] = uid(); });
    list.slice().sort(function (a, b) { return (a.z || 0) - (b.z || 0); }).forEach(function (o) {
      const n = clone(o);
      n.id = map[o.id];
      if (typeOf(o) === "arrow") {
        const p = S.stickies[o.id] ? arrowPts(o) : { a: { x: o.x1, y: o.y1 }, b: { x: o.x2, y: o.y2 } };
        n.x1 = Math.round(p.a.x + dx); n.y1 = Math.round(p.a.y + dy); n.x2 = Math.round(p.b.x + dx); n.y2 = Math.round(p.b.y + dy);
        n.from = map[o.from] || null; n.to = map[o.to] || null;
      } else { n.x = Math.round(o.x + dx); n.y = Math.round(o.y + dy); }
      n.z = typeOf(o) === "frame" ? (o.z || 1) : ++z;
      delete n.votes; delete n.comments; n.by = me.id; n.byName = me.name; n.t = Date.now();
      ch.push({ path: "stickies/" + n.id, value: n, before: null });
      const src = (images || S.images)[o.id];
      if (typeOf(o) === "image" && src) ch.push({ path: "images/" + n.id, value: src, before: null });
      ids.push(n.id);
    });
    return { ch: ch, ids: ids, map: map };
  }
  function withChildren(list) {
    const frames = list.filter(function (o) { return typeOf(o) === "frame"; }).map(function (o) { return o.id; });
    return list.concat(frameChildren(frames).filter(function (k) { return !sel.has(k); }).map(function (k) { return S.stickies[k]; }));
  }
  function duplicate() {
    const list = selObjs(); if (!list.length || !canEdit()) return;
    const r = cloneSet(withChildren(list), 30, 30);
    if (commit(r.ch)) setSel(r.ids);
  }

  /* ================= text editing ================= */
  let editBefore = null, typingTimer = null;
  function startEdit(id, opts) {
    opts = opts || {};
    const o = S.stickies[id], el = els.objs[id];
    if (!o || !el || !hasText(typeOf(o)) || !canEdit()) return;
    if (editing && editing !== id) stopEdit();
    if (!sel.has(id) || sel.size > 1) selectOnly(id);
    editing = id;
    editBefore = o[textField(o)] || "";
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
    const o = S.stickies[id], f = textField(o);
    let text = tx.innerText.replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "").replace(/^\s+/, "");
    if (typeOf(o) === "frame") text = text.replace(/\s+/g, " ");
    if (typeOf(o) === "text" && !text) {
      commit([{ path: "stickies/" + id, value: null, before: Object.assign(clone(o), { text: editBefore }) }]);
      return;
    }
    if (text !== editBefore) write("stickies/" + id + "/" + f, text, { before: editBefore });
    el.classList.toggle("empty", !text);
    if (typeOf(o) === "frame") el.classList.toggle("notitle", !text);
    if (typeOf(o) === "sticky" || typeOf(o) === "shape") fitText(el);
    refreshArrows([id]);
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
  function fileToDataURL(file) {
    return new Promise(function (res, rej) { const fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(file); });
  }
  function imageSize(src) {
    return new Promise(function (res) {
      const img = new Image();
      img.onload = function () { res({ w: img.naturalWidth || 400, h: img.naturalHeight || 300, ok: true }); };
      img.onerror = function () { res({ w: 400, h: 300, ok: false }); };
      img.src = src;
    });
  }
  function readImage(file, max, q) {
    return fileToDataURL(file).then(function (url) {
      return new Promise(function (res, rej) {
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
        img.src = url;
      });
    });
  }

  /* ================= images & GIFs on the board ================= */
  const GIF_MAX = 1.5 * 1024 * 1024;
  function placeImage(src, size, p, i) {
    const w = Math.min(420, size.w), h = Math.round(w * size.h / size.w);
    const o = newObj("image", p.x - w / 2 + (i || 0) * 30, p.y - h / 2 + (i || 0) * 30, { w: w, h: h });
    return createObj(o, [{ path: "images/" + o.id, value: src, before: null }]) ? o.id : null;
  }
  function addImageFiles(files, at) {
    if (!canEdit()) return toast("View only – you can read this board but not edit it");
    const list = Array.from(files || []).filter(function (f) { return /^image\//.test(f.type); });
    if (!list.length) return;
    const p = at || lastWorld || viewCenterWorld();
    toast("Adding image…");
    const ids = [];
    list.reduce(function (chain, f, i) {
      return chain.then(function () {
        let prep;
        if (f.type === "image/gif" && f.size <= GIF_MAX) {
          prep = fileToDataURL(f).then(function (url) { return imageSize(url).then(function (s) { return { url: url, w: s.w, h: s.h }; }); });
        } else {
          if (f.type === "image/gif") toast("GIF larger than 1.5 MB – added as a still image");
          prep = readImage(f, 1400, 0.82).then(function (r) { return r.url.length > 700000 ? readImage(f, 1000, 0.7) : r; });
        }
        return prep.then(function (r) { const id = placeImage(r.url, r, p, i); if (id) ids.push(id); });
      });
    }, Promise.resolve()).then(function () { if (ids.length) { setSel(ids); setTool("select"); } }, function () { toast("Could not read that image"); });
  }
  function imageLinkModal() {
    if (!canEdit()) return toast("View only – you can read this board but not edit it");
    modal('<h2>Image or GIF from a link</h2><p class="muted">Paste the address of an image or GIF (for example from Giphy: right-click the GIF → Copy image address).</p>' +
      '<form id="linkForm"><label>Link<input id="imgUrl" type="url" required placeholder="https://…/image.gif"></label><div class="link-pv" id="linkPv"></div>' +
      '<div class="modal-actions"><button type="button" class="btn ghost" id="lkCancel">Cancel</button><button class="btn primary">Add to board</button></div></form>', function (root) {
      const inp = root.querySelector("#imgUrl"), pv = root.querySelector("#linkPv");
      inp.oninput = function () { const v = inp.value.trim(); pv.innerHTML = /^https?:\/\//.test(v) ? '<img alt="" src="' + esc(v) + '">' : ""; };
      root.querySelector("#lkCancel").onclick = closeModal;
      root.querySelector("#linkForm").onsubmit = function (e) {
        e.preventDefault();
        const url = inp.value.trim();
        if (!/^https?:\/\/\S+$/.test(url)) return toast("Enter a valid link (https://…)");
        imageSize(url).then(function (s) {
          if (!s.ok) toast("Could not preview the image – check that the link points to an image");
          closeModal();
          const id = placeImage(url, s, viewCenterWorld(), 0);
          if (id) selectOnly(id);
        });
      };
    });
  }

  /* ================= icons & emoji ================= */
  function iconModal() {
    if (!canEdit()) return toast("View only – you can read this board but not edit it");
    const icons = Object.keys(ICONS);
    const emoji = window.MB_EMOJI || [];
    modal('<h2>Icons & emoji</h2><div class="tabs ic-tabs"><button class="on" data-pick="icons">Icons</button><button data-pick="emoji">Emoji</button></div>' +
      '<div class="pick-wrap"><div class="pick-grid" id="pickIcons">' + icons.map(function (n) { return '<button data-icon="' + n + '" title="' + n + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS[n] + "</svg></button>"; }).join("") + "</div>" +
      '<div class="pick-grid emo" id="pickEmoji" hidden>' + emoji.map(function (e) { return '<button data-emoji="' + e + '">' + e + "</button>"; }).join("") + "</div></div>" +
      '<div class="modal-actions"><button class="btn ghost" id="icClose">Close</button></div>', function (root) {
      els.modal.classList.add("wide");
      root.querySelectorAll("[data-pick]").forEach(function (b) {
        b.onclick = function () {
          root.querySelectorAll("[data-pick]").forEach(function (x) { x.classList.toggle("on", x === b); });
          root.querySelector("#pickIcons").hidden = b.dataset.pick !== "icons";
          root.querySelector("#pickEmoji").hidden = b.dataset.pick !== "emoji";
        };
      });
      root.querySelector("#icClose").onclick = closeModal;
      root.querySelector(".pick-wrap").onclick = function (e) {
        const b = e.target.closest("[data-icon],[data-emoji]"); if (!b) return;
        const p = viewCenterWorld();
        const o = b.dataset.icon ? newObj("icon", p.x - 40, p.y - 40, { name: b.dataset.icon, color: darkCanvas() ? "#ffffff" : "#1c2033" }) : newObj("icon", p.x - 45, p.y - 45, { emoji: b.dataset.emoji, w: 90, h: 90 });
        closeModal();
        if (createObj(o)) selectOnly(o.id);
      };
    });
  }

  /* ================= templates ================= */
  function instantiate(objs, ox, oy) {
    const fake = objs.map(function (o) { return Object.assign({}, o); });
    const byId = {}; fake.forEach(function (o) { byId[o.id] = o; });
    fake.forEach(function (o) {
      if (o.type !== "arrow") return;
      const a = byId[o.from], b = byId[o.to];
      if (a) { o.x1 = a.x + a.w / 2; o.y1 = a.y + a.h / 2; }
      if (b) { o.x2 = b.x + b.w / 2; o.y2 = b.y + b.h / 2; }
    });
    let z = maxZ();
    const fz = minZ() - fake.length;
    const map = {}, out = [];
    fake.forEach(function (o) { map[o.id] = uid(); });
    fake.forEach(function (o, i) {
      const n = Object.assign({}, o, { id: map[o.id], by: me.id, byName: me.name, t: Date.now() });
      if (o.type === "arrow") { n.x1 += ox; n.y1 += oy; n.x2 += ox; n.y2 += oy; n.from = map[o.from] || null; n.to = map[o.to] || null; }
      else { n.x = o.x + ox; n.y = o.y + oy; }
      n.z = o.type === "frame" ? fz + i : ++z;
      out.push(n);
    });
    return out;
  }
  function insertKit(id) {
    const kit = window.MB_KITS && window.MB_KITS[id]; if (!kit || !canEdit()) return;
    const b = contentBox();
    const ox = b.empty ? 0 : Math.round(b.x + b.w + 200), oy = b.empty ? 0 : Math.round(b.y + 40);
    const objs = instantiate(kit.build(), ox, oy);
    if (!commit(objs.map(function (o) { return { path: "stickies/" + o.id, value: o, before: null }; }))) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    objs.forEach(function (o) { if (o.type === "arrow") return; x0 = Math.min(x0, o.x); y0 = Math.min(y0, o.y); x1 = Math.max(x1, o.x + o.w); y1 = Math.max(y1, o.y + (o.h || 40)); });
    setSel([]);
    focusBox({ x: x0 - 60, y: y0 - 80, w: x1 - x0 + 120, h: y1 - y0 + 140 }, 1);
    toast("Template added – everything is editable");
  }
  function templatesModal() {
    if (!canEdit()) return toast("View only – you can read this board but not edit it");
    const list = window.MBTemplateList ? window.MBTemplateList().filter(function (x) { return x.kind === "kit"; }) : [];
    const cats = window.MB_KIT_CATS || {};
    let h = '<div class="tpl-head"><h2>Templates</h2><button class="icon-btn" id="tplClose" title="Close">' + ico("close") + '</button></div><p class="muted">Insert a ready-made template into this board. Everything stays editable – move, recolour, add post-its.</p>';
    ["feedback", "agile", "diagram", "strategy"].forEach(function (c) {
      const items = list.filter(function (x) { return x.cat === c; });
      if (!items.length) return;
      h += '<h3 class="tpl-cat no-i18n">' + esc(cats[c] || c) + '</h3><div class="tpl-grid">' + items.map(function (x) {
        return '<button class="tpl-card" data-kit="' + x.id + '"><span class="tpl-pv">' + window.MBTemplatePreview(x.id) + '</span><b class="no-i18n">' + esc(x.name) + '</b><small class="no-i18n">' + esc(x.desc) + "</small></button>";
      }).join("") + "</div>";
    });
    modal(h, function (root) {
      els.modal.classList.add("wide");
      root.querySelector("#tplClose").onclick = closeModal;
      root.querySelectorAll("[data-kit]").forEach(function (b) { b.onclick = function () { closeModal(); insertKit(b.dataset.kit); }; });
    });
  }

  /* ================= background ================= */
  function applyBg() {
    const dark = darkCanvas();
    document.body.classList.toggle("canvas-dark", dark);
    const b = $("#zBg"); if (b) b.innerHTML = ico(dark ? "moon" : "sun");
  }

  /* ================= clipboard ================= */
  function copySel(e) {
    const list = selObjs(); if (!list.length) return false;
    const all = withChildren(list);
    const imgs = {};
    const objs = all.map(function (o) {
      const n = clone(o);
      if (typeOf(o) === "arrow") { const p = arrowPts(o); n.x1 = p.a.x; n.y1 = p.a.y; n.x2 = p.b.x; n.y2 = p.b.y; }
      if (typeOf(o) === "image" && S.images[o.id]) imgs[o.id] = S.images[o.id];
      return n;
    });
    clipboard = { objs: objs, images: imgs };
    const plain = all.map(function (o) { return o.text || o.title || ""; }).filter(Boolean).join("\n");
    if (e && e.clipboardData) {
      e.clipboardData.setData("text/plain", plain || " ");
      try { e.clipboardData.setData("application/x-cmcollab", JSON.stringify(clipboard)); } catch (x) { /* ignore */ }
      e.preventDefault();
    }
    return true;
  }
  function rawBox(o) {
    if (o.type === "arrow") return { x: Math.min(o.x1, o.x2), y: Math.min(o.y1, o.y2), w: Math.abs(o.x1 - o.x2), h: Math.abs(o.y1 - o.y2) };
    return { x: o.x, y: o.y, w: o.w || 120, h: o.type === "text" ? (o.fs || 24) * 1.4 : (o.h || 120) };
  }
  function pasteObjs(data, at) {
    if (!data || !data.objs || !data.objs.length || !canEdit()) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    data.objs.forEach(function (o) { const r = rawBox(o); x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); });
    const p = at || viewCenterWorld();
    const r = cloneSet(data.objs.map(function (o) { return Object.assign({}, o, { _paste: true }); }).map(function (o) { delete o._paste; return o; }), p.x - (x0 + x1) / 2, p.y - (y0 + y1) / 2, data.images || {});
    if (commit(r.ch)) setSel(r.ids);
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
    const list = Object.keys(S.stickies).map(function (k) { return S.stickies[k]; }).filter(function (o) { return ["sticky", "image", "shape"].indexOf(typeOf(o)) >= 0; });
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
      if (o && ["sticky", "image", "shape"].indexOf(typeOf(o)) >= 0) {
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
    els.modal.classList.remove("wide");
    els.modalBody.innerHTML = html;
    els.modal.hidden = false;
    if (onMount) onMount(els.modalBody);
    const f = els.modalBody.querySelector("input,textarea,select");
    if (f) setTimeout(function () { f.focus(); }, 30);
  }
  function closeModal() { els.modal.hidden = true; els.modalBody.innerHTML = ""; els.modal.classList.remove("wide", "fbm"); }
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
        if (!lsGet("cmcollab:onboarded3")) showHelp();
      };
    });
  }
  function showHelp() {
    lsSet("cmcollab:onboarded3", "1");
    modal('<h2>How to use this board</h2><ul class="help">' +
      "<li><b>Templates:</b> the grid button on the left inserts Kanban, Retrospective, PI Planning, process flows, mind maps and more.</li>" +
      "<li><b>Post-it:</b> double-click an empty spot, or pick the post-it tool (N) and click on the board.</li>" +
      "<li><b>Write:</b> click a post-it to select it and just start typing – or click it again.</li>" +
      "<li><b>Frames:</b> the frame tool (F) draws white areas to organise post-its. Moving a frame moves what is inside.</li>" +
      "<li><b>Shapes & connectors:</b> shape tool (R) and connector (L): drag from one item to another to link them.</li>" +
      "<li><b>Icons, emoji, images & GIFs:</b> use the toolbar, paste (Ctrl+V) or drag files from your computer.</li>" +
      "<li><b>Select several:</b> drag a box on the empty board, or Shift+click. Alt+drag duplicates.</li>" +
      "<li><b>Navigate:</b> scroll or hold Space and drag to move, Ctrl+scroll or pinch to zoom, Shift+1 to fit.</li>" +
      "<li><b>Prioritise:</b> dot voting, comments and RICE on post-its; the Ranking panel orders everything.</li></ul>" +
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
  function feedbackModal() {
    modal('<h2>Share your feedback</h2><p class="muted">5 quick questions + your suggestions. About 3 minutes.</p><div id="fbBox"></div>', function (root) {
      els.modal.classList.add("wide", "fbm");
      window.MBFeedback.render(root.querySelector("#fbBox"), { board: CFG.id, onDone: function () { setTimeout(closeModal, 2200); } });
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
    if (T.kit && window.MB_KITS[T.kit]) instantiate(window.MB_KITS[T.kit].build(), 0, 0).forEach(function (o) { st[o.id] = o; });
    return { stickies: st, fields: Object.assign({}, CFG.defaults || {}), photos: {}, images: {}, meta: { template: T.version, created: Date.now(), bg: "light" } };
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
      closeFlyouts();
      const w = toWorld(e.clientX, e.clientY);
      lastWorld = w;

      const panning = tool === "hand" || spaceDown || e.button === 1 || e.button === 2 || (e.pointerType === "touch" && !objEl && tool === "select");
      if (panning) {
        gesture = { type: "pan", x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        vp.classList.add("panning");
        vp.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;

      if (canEdit() && (tool === "sticky" || tool === "text" || tool === "shape")) {
        let o;
        if (tool === "sticky") o = newObj("sticky", w.x - 60, w.y - 60, { color: placeColor });
        else if (tool === "shape") o = newObj("shape", w.x - 90, w.y - 50, { shape: placeShape });
        else o = newObj("text", w.x - 10, w.y - 18, { color: inkAt(e.clientX, e.clientY) });
        if (createObj(o)) { setTool("select"); selectOnly(o.id); setTimeout(function () { startEdit(o.id); }, 0); }
        e.preventDefault();
        return;
      }
      if (canEdit() && tool === "frame") {
        gesture = { type: "frameNew", sx: w.x, sy: w.y, cx: e.clientX, cy: e.clientY, moved: false };
        vp.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      if (canEdit() && tool === "arrow") {
        const from = objAtPoint(e.clientX, e.clientY);
        const o = newObj("arrow", 0, 0, { x1: Math.round(w.x), y1: Math.round(w.y), x2: Math.round(w.x), y2: Math.round(w.y), from: from || null, to: null, color: inkAt(e.clientX, e.clientY) });
        apply("stickies/" + o.id, o);
        gesture = { type: "arrowNew", id: o.id, ids: [o.id], moved: true, cx: e.clientX, cy: e.clientY };
        vp.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }

      if (objEl && e.target.classList.contains("ah") && canEdit()) {
        const id = objEl.dataset.id;
        gesture = { type: "arrowEnd", id: id, ids: [id], end: e.target.dataset.end, before: clone(S.stickies[id]), moved: false };
        vp.setPointerCapture(e.pointerId);
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
        let ids = resizing ? [id] : Array.from(sel);
        if (!resizing) {
          const frames = ids.filter(function (k) { return typeOf(S.stickies[k]) === "frame"; });
          if (frames.length) ids = ids.concat(frameChildren(frames).filter(function (k) { return ids.indexOf(k) < 0; }));
        }
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

    function showBox(x, y, mw, mh, dashed) {
      const m = els.marquee;
      m.hidden = false;
      m.classList.toggle("framing", !!dashed);
      m.style.left = x + "px"; m.style.top = y + "px"; m.style.width = mw + "px"; m.style.height = mh + "px";
      m.style.borderWidth = (1.5 / view.s) + "px";
    }

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
      if (gesture.type === "arrowNew" || gesture.type === "arrowEnd") {
        const o = S.stickies[gesture.id]; if (!o) return;
        gesture.moved = true;
        if (gesture.type === "arrowNew" || gesture.end === "2") { o.x2 = Math.round(w.x); o.y2 = Math.round(w.y); o.to = null; }
        else { o.x1 = Math.round(w.x); o.y1 = Math.round(w.y); o.from = null; }
        renderArrow(o, els.objs[o.id]);
        const hit = objAtPoint(e.clientX, e.clientY, o.id);
        Object.keys(els.objs).forEach(function (k) { els.objs[k].classList.toggle("target", k === hit); });
        return;
      }
      const dx = w.x - gesture.sx, dy = w.y - gesture.sy;
      if (gesture.type === "frameNew") {
        if (!gesture.moved && Math.hypot(e.clientX - gesture.cx, e.clientY - gesture.cy) < 4) return;
        gesture.moved = true;
        showBox(Math.min(gesture.sx, w.x), Math.min(gesture.sy, w.y), Math.abs(dx), Math.abs(dy), true);
        return;
      }
      if (gesture.type === "marquee") {
        if (!gesture.moved && Math.hypot(e.clientX - gesture.cx, e.clientY - gesture.cy) < 4) return;
        gesture.moved = true;
        const x = Math.min(gesture.sx, w.x), y = Math.min(gesture.sy, w.y), mw = Math.abs(dx), mh = Math.abs(dy);
        showBox(x, y, mw, mh);
        const box = { x: x, y: y, w: mw, h: mh };
        const hit = Object.keys(S.stickies).filter(function (k) {
          const o = S.stickies[k], r = rectOf(o);
          if (typeOf(o) === "frame") return inside(r, box);
          return r.x < x + mw && r.x + r.w > x && r.y < y + mh && r.y + r.h > y;
        });
        setSel(Array.from(new Set(gesture.base.concat(hit))));
        return;
      }
      if (gesture.type === "drag" || gesture.type === "resize") {
        if (!gesture.moved && Math.hypot(dx, dy) * view.s < 3) return;
        if (!gesture.moved) {
          gesture.moved = true;
          els.ctx.hidden = true;
          if (gesture.type === "drag" && gesture.alt) {
            const r = cloneSet(gesture.ids.map(function (k) { return gesture.orig[k]; }), 0, 0);
            r.ch.forEach(function (c) { apply(c.path, clone(c.value)); });
            gesture.created = r.ch;
            gesture.ids = r.ids;
            gesture.orig = {};
            r.ids.forEach(function (k) { gesture.orig[k] = clone(S.stickies[k]); });
            setSel(r.ids);
            els.ctx.hidden = true;
          } else if (gesture.type === "drag") {
            let z = maxZ();
            gesture.ids.forEach(function (k) { if (typeOf(S.stickies[k]) !== "frame") S.stickies[k].z = ++z; });
          }
          gesture.ids.forEach(function (k) { if (els.objs[k]) els.objs[k].classList.add("lifting"); });
        }
        gesture.ids.forEach(function (k) {
          const o = S.stickies[k], o0 = gesture.orig[k], el = els.objs[k];
          if (!o || !el) return;
          const tp = typeOf(o);
          if (gesture.type === "drag") {
            if (tp === "arrow") {
              if (!o.from) { o.x1 = Math.round(o0.x1 + dx); o.y1 = Math.round(o0.y1 + dy); }
              if (!o.to) { o.x2 = Math.round(o0.x2 + dx); o.y2 = Math.round(o0.y2 + dy); }
              renderArrow(o, el);
            } else {
              o.x = Math.round(o0.x + dx); o.y = Math.round(o0.y + dy);
              el.style.left = o.x + "px"; el.style.top = o.y + "px"; el.style.zIndex = zFor(o);
            }
          } else {
            o.w = Math.max(tp === "text" ? 60 : tp === "frame" ? 160 : 40, Math.round(o0.w + dx));
            if ((tp === "image" && !e.shiftKey) || tp === "icon") o.h = Math.round(o.w * gesture.ar);
            else if (tp !== "text") o.h = Math.max(tp === "frame" ? 100 : 30, Math.round(o0.h + dy));
            el.style.width = o.w + "px";
            if (tp !== "text") el.style.height = o.h + "px";
            if (tp === "sticky" || tp === "shape") fitText(el);
            if (tp === "icon") renderObj(o);
          }
          if (!gesture.created) livePut(k);
        });
        refreshArrows(gesture.ids);
      }
    });

    function endGesture(e) {
      const g = gesture; gesture = null;
      if (!g) return;
      Object.keys(els.objs).forEach(function (k) { els.objs[k].classList.remove("target"); });
      if (g.type === "pan") { vp.classList.remove("panning"); return; }
      if (g.type === "marquee") { els.marquee.hidden = true; updateCtx(); return; }
      if (g.type === "frameNew") {
        els.marquee.hidden = true;
        const w = e ? toWorld(e.clientX, e.clientY) : { x: g.sx, y: g.sy };
        let r = { x: Math.min(g.sx, w.x), y: Math.min(g.sy, w.y), w: Math.abs(w.x - g.sx), h: Math.abs(w.y - g.sy) };
        if (!g.moved || r.w < 40 || r.h < 40) r = { x: g.sx - 400, y: g.sy - 280, w: 800, h: 560 };
        const o = newObj("frame", r.x, r.y, { w: Math.round(r.w), h: Math.round(r.h) });
        setTool("select");
        if (createObj(o)) selectOnly(o.id);
        return;
      }
      if (g.type === "arrowNew") {
        const o = S.stickies[g.id]; if (!o) return;
        o.to = e ? objAtPoint(e.clientX, e.clientY, o.id) : null;
        if (o.to === o.from) o.to = null;
        const p = arrowPts(o);
        setTool("select");
        const v = clone(o);
        apply("stickies/" + o.id, null);
        if (!v.to && Math.hypot(p.a.x - p.b.x, p.a.y - p.b.y) < 12) return;
        if (createObj(v)) selectOnly(v.id);
        return;
      }
      if (g.type === "arrowEnd") {
        const o = S.stickies[g.id]; if (!o) return;
        if (g.moved) {
          const hit = e ? objAtPoint(e.clientX, e.clientY, o.id) : null;
          if (g.end === "2") o.to = hit && hit !== o.from ? hit : null; else o.from = hit && hit !== o.to ? hit : null;
          commit([{ path: "stickies/" + o.id, value: clone(o), before: g.before }]);
        }
        return;
      }
      if (g.type === "drag" || g.type === "resize") {
        g.ids.forEach(function (k) { if (els.objs[k]) els.objs[k].classList.remove("lifting"); });
        if (g.moved) {
          const ch = [];
          if (g.created) {
            g.created.forEach(function (c) { if (c.path.indexOf("images/") === 0) ch.push({ path: c.path, value: c.value, before: null }); });
            g.ids.forEach(function (k) { ch.push({ path: "stickies/" + k, value: clone(S.stickies[k]), before: null }); });
          } else {
            g.ids.forEach(function (k) { if (S.stickies[k]) ch.push({ path: "stickies/" + k, value: clone(S.stickies[k]), before: g.orig[k] }); });
          }
          commit(ch);
          updateCtx();
        } else if (g.wasOnly && e && !e.shiftKey && g.type === "drag") {
          const o = S.stickies[g.clickId];
          if (o && hasText(typeOf(o))) startEdit(g.clickId);
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
      if (objEl) { const o = S.stickies[objEl.dataset.id]; if (o && hasText(typeOf(o))) startEdit(o.id); return; }
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

    // typing inside objects
    els.layer.addEventListener("input", function (e) {
      const el = e.target.closest(".obj"); if (!el) return;
      if (el.dataset.type === "sticky" || el.dataset.type === "shape") fitText(el);
      el.classList.toggle("empty", !e.target.innerText.trim());
      clearTimeout(typingTimer);
      const id = el.dataset.id;
      typingTimer = setTimeout(function () {
        const o = S.stickies[id];
        if (editing === id && o) {
          const f = textField(o);
          o[f] = e.target.innerText.trim();
          sync.put("stickies/" + id + "/" + f, o[f]).catch(function () { /* reported on stop */ });
        }
      }, 400);
      if (el.dataset.type === "text") refreshArrows([id]);
    });
    els.layer.addEventListener("keydown", function (e) {
      const el = e.target.closest(".obj");
      if (el && el.dataset.type === "frame" && e.key === "Enter") { e.preventDefault(); stopEdit(); }
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
      else if (e.dataTransfer) {
        const u = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain") || "").trim();
        if (/^https?:\/\/\S+\.(gif|png|jpe?g|webp|svg)(\?\S*)?$/i.test(u) && canEdit()) imageSize(u).then(function (s) { const id = placeImage(u, s, toWorld(e.clientX, e.clientY), 0); if (id) selectOnly(id); });
      }
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
      if (clipboard && (!txt || txt === clipboard.objs.map(function (o) { return o.text || o.title || ""; }).filter(Boolean).join("\n").trim())) { e.preventDefault(); return pasteObjs(clipboard, lastWorld); }
      if (/^https?:\/\/\S+\.(gif|png|jpe?g|webp)(\?\S*)?$/i.test(txt)) {
        e.preventDefault();
        return imageSize(txt).then(function (s) { const id = placeImage(txt, s, lastWorld || viewCenterWorld(), 0); if (id) selectOnly(id); });
      }
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
    function viewerBlock() { toast("View only – you can read this board but not edit it"); }
    els.toolbar.addEventListener("click", function (e) {
      const b = e.target.closest("[data-tool]");
      if (b) {
        if (!canEdit() && b.dataset.tool !== "select" && b.dataset.tool !== "hand") return viewerBlock();
        setTool(b.dataset.tool);
        if (b.dataset.tool === "arrow") toast("Drag from one item to another to connect them");
        if (b.dataset.tool === "frame") toast("Drag on the board to draw a frame");
      }
      const fly = e.target.closest(".tool-fly");
      if (fly && e.target.closest(".tb") && fly.querySelector(".menu") && e.target.closest("#tbMore")) fly.classList.toggle("open");
    });
    $("#addSwatches").onclick = function (e) { const b = e.target.closest("button"); if (b) { placeColor = b.dataset.c; setTool("sticky"); toast("Click on the board to place the post-it"); } };
    $("#shapeFly").onclick = function (e) { const b = e.target.closest("button"); if (b) { placeShape = b.dataset.shape; setTool("shape"); toast("Click on the board to place the shape"); } };
    $("#tbTemplates").onclick = templatesModal;
    $("#tbIcons").onclick = iconModal;
    $("#tbImage").onclick = function () { if (!canEdit()) return viewerBlock(); $("#fileImage").click(); };
    $("#imgFly").onclick = function (e) {
      const b = e.target.closest("[data-img]"); if (!b) return;
      closeFlyouts();
      if (b.dataset.img === "link") imageLinkModal(); else if (canEdit()) $("#fileImage").click(); else viewerBlock();
    };
    $("#fileImage").onchange = function (e) { const f = e.target.files; addImageFiles(f, viewCenterWorld()); e.target.value = ""; };
    $("#tbUndo").onclick = undo;
    $("#tbRedo").onclick = redo;
    $("#tbExport").onclick = function () { closeFlyouts(); exportBoard(); };
    $("#tbImport").onclick = function () { closeFlyouts(); $("#fileImport").click(); };
    $("#fileImport").onchange = function (e) { const f = e.target.files[0]; e.target.value = ""; if (f) importBoard(f); };
    $("#tbPrint").onclick = function () { closeFlyouts(); deselect(); fit(); setTimeout(function () { window.print(); }, 150); };
    const rs = $("#tbReset");
    if (rs) rs.onclick = function () {
      closeFlyouts();
      confirmModal(t("Reset board?"), t("All post-its, fields and photos will be replaced by the empty template. Export first if you want a backup."), t("Reset"), function () {
        const d = seedData(); track(sync.replaceAll(d)); apply("*", d); undoStack.length = 0; redoStack.length = 0; setTimeout(fit, 50); toast("Board reset");
      });
    };
    $("#tbHelp").onclick = function () { closeFlyouts(); showHelp(); };
    $("#zBg").onclick = function () { if (!canEdit()) return viewerBlock(); write("meta/bg", darkCanvas() ? "light" : "dark", { noHistory: true }); };
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
    const fbb = $("#btnFeedback");
    if (fbb) fbb.onclick = feedbackModal;
    els.timerBtn.onclick = timerModal;
    const so = $("#btnSignOut");
    if (so) so.onclick = function () { confirmModal(t("Sign out?"), t("You will need to sign in again to open this board."), t("Sign out"), function () { window.CMAuth.signOut(); }); };
    els.modal.addEventListener("pointerdown", function (e) { if (e.target === els.modal && !$("#nameForm")) closeModal(); });

    // keyboard
    document.addEventListener("keydown", function (e) {
      const typing = isTyping(e.target);
      if (e.key === "Escape") {
        closeFlyouts();
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
      if (e.shiftKey && e.code === "Digit1") { e.preventDefault(); return fit(); }
      if ((e.key === "Delete" || e.key === "Backspace") && sel.size) { e.preventDefault(); return canEdit() ? deleteSel() : null; }
      if (e.key === "Enter" && sel.size === 1) { e.preventDefault(); return startEdit(Array.from(sel)[0]); }
      if (e.key.indexOf("Arrow") === 0 && sel.size && canEdit()) {
        e.preventDefault();
        const st = e.shiftKey ? 20 : 2;
        const dx = e.key === "ArrowLeft" ? -st : e.key === "ArrowRight" ? st : 0, dy = e.key === "ArrowUp" ? -st : e.key === "ArrowDown" ? st : 0;
        return commit(selObjs().filter(function (o) { return typeOf(o) !== "arrow"; }).map(function (o) { return { path: "stickies/" + o.id, value: Object.assign(clone(o), { x: o.x + dx, y: o.y + dy }) }; }));
      }
      const one = single();
      if (one && ["sticky", "text", "shape"].indexOf(typeOf(one)) >= 0 && e.key.length === 1 && !e.altKey && canEdit()) { startEdit(one.id); return; }
      if (sel.size) return;
      if (k === "v") return setTool("select");
      if (k === "h") return setTool("hand");
      if (!canEdit()) return;
      if (k === "n") return setTool("sticky");
      if (k === "t") return setTool("text");
      if (k === "r") return setTool("shape");
      if (k === "l") return setTool("arrow");
      if (k === "f") return setTool("frame");
      if (k === "i") return $("#fileImage").click();
      if (e.key === "+" || e.key === "=") return zoomCenter(1.2);
      if (e.key === "-") return zoomCenter(1 / 1.2);
    });
    document.addEventListener("keyup", function (e) { if (e.key === " ") { spaceDown = false; els.viewport.classList.remove("space"); } });
    document.addEventListener("pointerdown", function (e) { if (!e.target.closest(".tool-fly")) closeFlyouts(); });
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
  function closeFlyouts() { document.querySelectorAll(".tool-fly.open").forEach(function (f) { f.classList.remove("open"); }); }
  function isTyping(el) { return !!(el && (el.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(el.tagName))); }

  function renderAll() {
    Object.keys(els.objs).forEach(function (id) { if (!S.stickies[id]) removeObjEl(id); });
    const keys = Object.keys(S.stickies);
    keys.forEach(function (k) { const o = S.stickies[k]; if (!o) return; if (!o.id) o.id = k; if (typeOf(o) !== "arrow") renderObj(o); });
    keys.forEach(function (k) { const o = S.stickies[k]; if (o && typeOf(o) === "arrow") renderObj(o); });
    els.tpl.querySelectorAll("[data-field]").forEach(function (f) { renderField(f.dataset.field); });
    els.tpl.querySelectorAll("[data-photo]").forEach(function (p) { renderPhoto(p.dataset.photo); });
    renderTimer();
    applyBg();
    schedulePanel();
  }

  function rememberRecent() {
    let r = [];
    try { r = JSON.parse(lsGet("cmcollab:recent")) || []; } catch (e) { r = []; }
    r = r.filter(function (x) { return x.id !== CFG.id; });
    r.unshift({ id: CFG.id, title: CFG.title, template: CFG.template, t: Date.now() });
    lsSet("cmcollab:recent", JSON.stringify(r.slice(0, 12)));
  }

  /* ================= boot ================= */
  function boot() {
    const kitId = window.MB_KITS && window.MB_KITS[CFG.template] ? CFG.template : null;
    T = kitId ? Object.assign({}, window.MB_TEMPLATES.blank, { version: kitId + "-v1", kit: kitId }) : (window.MB_TEMPLATES[CFG.template] || window.MB_TEMPLATES.persona);
    W = T.world.w; H = T.world.h;
    buildShell();
    els.objs = {};
    sync = window.MBSync.create(CFG.id || "board");
    showSave();
    bind();
    setTool("select");
    fit();
    rememberRecent();
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
      if (!me.name) askName(); else { sendPresence(); if (!lsGet("cmcollab:onboarded3")) showHelp(); }
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
        return db.ref("userWorkspaces/" + key).once("value").then(function (s) {
          const v = s.val() || {}, now = Date.now();
          const ended = Object.keys(v).map(function (k) { return v[k]; }).filter(function (e) { return e && e.expires && e.expires <= now; });
          if (!ended.length) throw err;
          gateScreen("Your test access has ended", t("Thank you for testing CM Collaborator! If you haven't yet, please share your feedback – it takes about 3 minutes."),
            '<a class="btn primary" href="' + ROOT + 'feedback/">' + t("Give feedback") + '</a><a class="btn" href="' + ROOT + 'mentoring/">' + t("My boards") + "</a>");
        });
      }).catch(function () {
        gateScreen("No access", t("Your account (" + esc(user.email) + ") doesn't have access to this board. Ask the mentor for an invitation."),
          '<a class="btn primary" href="' + ROOT + 'mentoring/">' + t("My boards") + '</a><button class="btn" id="gateSignOut">' + t("Use another account") + "</button>");
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
