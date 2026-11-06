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
  let ME = null, PLAN = null, OWNED = {};
  function isOwner(id, w) { return !!(w && w.info && ME && w.info.owner === ME); }
  function wsSection(id, w, adminAll) {
    const admin = adminAll || isOwner(id, w);
    const boards = w.boards || {};
    const ids = Object.keys(boards).sort(function (a, b) { return (boards[b].created || 0) - (boards[a].created || 0); });
    const name = (w.info || {}).name || id;
    return '<section class="hub-sec ws-sec"><div class="hub-sec-head"><h2 class="no-i18n">' + esc(name) + '</h2><span class="muted small">' + ids.length + " " + t(ids.length === 1 ? "board" : "boards") + "</span>" +
      (admin ? '<button class="btn sm ghost" data-newin="' + id + '">+ <span>New board</span></button><a class="btn sm ghost" href="../admin/#ws-' + id + '">👥 <span>Manage people</span></a>' : "") +
      (isOwner(id, w) ? '<span class="own-tag">' + t("Owner") + "</span>" : "") + "</div>" +
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
    const canIn = function (id) { return PLAN === "admin" || isOwner(id, wss[id]); };
    const wsIds = Object.keys(wss || {}).filter(canIn).sort(function (a, b) { return ((wss[a].info || {}).name || "").localeCompare((wss[b].info || {}).name || ""); });
    const live = A && A.enabled;
    let h = '<div class="modal-lite" id="newDlg"><div class="card new-card"><div class="new-pv">' + pv(tplId) + '</div><div class="new-form"><h2>New board</h2><p class="muted small no-i18n">' + esc(tplName(tplId)) + "</p>" +
      '<form id="newForm"><label class="lbl-f">' + t("Board name") + '<input name="title" required placeholder="' + esc(t("e.g. Sprint 12 retrospective")) + '" autocomplete="off"></label>';
    if (live) {
      h += '<label class="lbl-f">Workspace<select name="ws">' + wsIds.map(function (id) { return '<option value="' + id + '"' + (id === presetWs ? " selected" : "") + ">" + esc(wss[id].info.name) + "</option>"; }).join("") +
        '<option value="__new">' + t("+ New workspace…") + '</option></select></label><label class="lbl-f" id="newWsRow"' + (wsIds.length ? " hidden" : "") + ">" + t("New workspace name") + '<input name="wsname" placeholder="' + esc(t("e.g. Mentoring 2026")) + '" autocomplete="off"></label>';
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
      const lim = PLAN && PLAN !== "admin" ? PLAN : null;
      if (ws === "__new") {
        const wn = (f.wsname.value || "").trim();
        if (!wn) return toast("Give the workspace a name");
        if (lim && Object.keys(OWNED).length >= lim.workspaces) return planLimit(t("Your plan allows") + " " + lim.workspaces + " " + t(lim.workspaces === 1 ? "workspace" : "workspaces") + ".");
        ws = (slug(wn) || "workspace") + "-" + rnd();
        const info = { name: wn, created: TS, createdBy: me.email };
        if (lim) { info.owner = ME; info.ownerEmail = me.email; u["userWorkspaces/" + ME + "/" + ws] = { name: wn, owner: true }; }
        u["workspaces/" + ws + "/info"] = info;
      } else if (lim && Object.keys((wss[ws] || {}).boards || {}).length >= lim.boards) {
        return planLimit(t("Your plan allows") + " " + lim.boards + " " + t("boards per workspace") + ".");
      }
      u["boards/" + id + "/info"] = { title: title, ws: ws, template: tplId, created: TS, createdBy: me.email };
      u["workspaces/" + ws + "/boards/" + id] = { title: title, template: tplId, created: TS };
      f.querySelector(".btn.primary").disabled = true;
      db.ref().update(u).then(function () { location.href = boardUrl(id); }, function (err) { f.querySelector(".btn.primary").disabled = false; toast(err.message); });
    };
  }

  function planLimit(msg) {
    document.querySelectorAll("#newDlg").forEach(function (d) { d.remove(); });
    document.body.insertAdjacentHTML("beforeend", '<div class="modal-lite" id="limDlg"><div class="card"><h2>' + esc(t("Plan limit reached")) + '</h2><p class="muted">' + esc(msg) + " " + esc(t("Upgrade to create more and invite your team.")) + '</p><div class="row-end"><button class="btn" id="limX">' + esc(t("Close")) + '</button><a class="btn primary" href="../pricing/">' + esc(t("See plans")) + "</a></div></div></div>");
    const d = document.getElementById("limDlg"); document.getElementById("limX").onclick = function () { d.remove(); }; d.onclick = function (e) { if (e.target === d) d.remove(); };
  }
  function planBadge() {
    if (!PLAN) return "";
    if (PLAN === "admin") return '<span class="plan-badge adm">' + esc(t("Administrator")) + "</span>";
    return '<span class="plan-badge">' + esc(t("Plan")) + ": <b>" + esc(PLAN.name) + "</b></span>" + (PLAN.id === "free" || PLAN.id === "pro" ? '<a class="btn sm primary" href="../pricing/">' + esc(t("Upgrade")) + "</a>" : "");
  }

  /* ---------------- screens ---------------- */
  function demo() {
    el.innerHTML = '<div class="notice"><b>Demo mode.</b> <span>Sign-in and private access switch on as soon as Firebase is configured (see README). Until then, boards are saved only in your browser.</span></div>' +
      searchBar() + startStrip(true) + recentRows(null);
    el.querySelectorAll("[data-new]").forEach(function (b) { b.onclick = function () { createDialog(b.dataset.new, {}); }; });
    bindSearch();
  }
  function login() {
    el.innerHTML = '<div class="card auth-card"><h2>Sign in</h2><p class="muted">Sign in to open your workspaces or create a free account. Boards are private: only people you invite can open them.</p>' +
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
    return '<div class="userbar"><span class="muted"><span>Signed in as</span> <b class="no-i18n">' + esc(user.email) + "</b></span>" + planBadge() +
      '<button class="btn" data-howto>❓ <span>' + esc(LL("How to start", "Como começar")) + "</span></button>" +
      '<button class="btn" data-feedback>💬 <span>Give feedback</span></button>' +
      (admin ? '<a class="btn" href="../admin/">Administration</a>' : "") + '<button class="btn" id="soBtn">Sign out</button></div>';
  }
  function fmtDate(ts) { return new Date(ts).toLocaleDateString(window.MB_LANG === "pt" ? "pt-PT" : "en-GB", { day: "2-digit", month: "short" }); }
  function accessBanner(entries) {
    const now = Date.now();
    const active = entries.filter(function (e) { return e.expires && e.expires > now; });
    const ended = entries.filter(function (e) { return e.expires && e.expires <= now; });
    let h = "";
    active.forEach(function (e) {
      const d = Math.ceil((e.expires - now) / 86400000);
      h += '<div class="beta-banner"><span class="bb-ic">🧪</span><div><b class="no-i18n">' + esc(e.name || "") + '</b><span> · ' + esc(t("Test access")) + ": " + d + " " + esc(t(d === 1 ? "day left" : "days left")) + " (" + esc(t("until")) + " " + fmtDate(e.expires) + ')</span><p class="muted small">' + esc(t("Explore the boards freely. Before the end, please share your opinion – 5 quick questions.")) + '</p></div><button class="btn primary" data-feedback>' + esc(t("Give feedback")) + "</button></div>";
    });
    ended.forEach(function (e) {
      h += '<div class="beta-banner ended"><span class="bb-ic">⏳</span><div><b class="no-i18n">' + esc(e.name || "") + '</b><span> · ' + esc(t("Your test access ended on")) + " " + fmtDate(e.expires) + '.</span><p class="muted small">' + esc(t("Thank you for testing! If you haven't yet, please share your feedback.")) + '</p></div><button class="btn primary" data-feedback>' + esc(t("Give feedback")) + "</button></div>";
    });
    return h;
  }
  function feedbackDialog() {
    if (document.getElementById("fbDlg")) return;
    document.body.insertAdjacentHTML("beforeend", '<div class="modal-lite" id="fbDlg"><div class="card fb-card"><div class="br-head"><div><h2>' + esc(t("Share your feedback")) + '</h2><p class="muted small">' + esc(t("5 quick questions + your suggestions. About 3 minutes.")) + '</p></div><button class="btn sm ghost" id="fbX">✕</button></div><div id="fbBox"></div></div></div>');
    const dlg = document.getElementById("fbDlg");
    function close() { dlg.remove(); }
    document.getElementById("fbX").onclick = close;
    dlg.onclick = function (e) { if (e.target === dlg) close(); };
    window.MBFeedback.render(document.getElementById("fbBox"), { board: "hub" });
  }
  /* ---------------- welcome / how-to and announcements ---------------- */
  function LL(en, pt) { return window.MB_LANG === "pt" ? pt : en; }
  let FIRST_BOARD = null, WELCOME_ENTRY = null;
  function welcomeDialog(user) {
    if (document.getElementById("welDlg")) return;
    const brand = window.CMCOLLAB_BRAND || "CM Collaborator";
    const first = (user.displayName || "").split(" ")[0];
    const e = WELCOME_ENTRY, days = e && e.expires ? Math.max(0, Math.ceil((e.expires - Date.now()) / 86400000)) : null;
    const steps = [
      ["🚀", LL("Open your first board", "Abra o seu primeiro quadro"), LL("Start with “1 · Start here – missions & feedback wall”: it has 5 short missions to explore everything.", "Comece pelo “1 · Comece aqui – missões e mural de feedback”: tem 5 missões curtas para explorar tudo.")],
      ["🧩", LL("Use the templates", "Use os templates"), LL("Templates button (left bar): Kanban, retrospective, PI Planning, PDCA executive meeting, architecture, cloud, data…", "Botão Templates (barra da esquerda): Kanban, retrospetiva, PI Planning, reunião executiva PDCA, arquitetura, cloud, dados…")],
      ["🟨", LL("Add and organise post-its", "Crie e organize post-its"), LL("N = post-it, T = text, F = frame, L = arrow. Drag to move; the “Tidy up” button aligns everything.", "N = post-it, T = texto, F = frame, L = seta. Arraste para mover; o botão “Organizar” alinha tudo.")],
      ["✨", LL("Try the AI assistant", "Experimente o Assistente IA"), LL("The ✨ button builds a board from your goal, suggests dynamics and analyses the results.", "O botão ✨ monta um quadro a partir do seu objetivo, sugere dinâmicas e analisa os resultados.")],
      ["👥", LL("Collaborate in real time", "Colabore em tempo real"), LL("Everyone invited sees the same board live: cursors, comments, votes and timer.", "Todos os convidados veem o mesmo quadro ao vivo: cursores, comentários, votos e cronómetro.")],
      ["💬", LL("Share your feedback", "Dê a sua opinião"), LL("Before your access ends: 5 quick questions (3 minutes) with the “Give feedback” button.", "Antes de o acesso terminar: 5 perguntas rápidas (3 minutos) no botão “Dar feedback”.")]
    ];
    document.body.insertAdjacentHTML("beforeend", '<div class="modal-lite" id="welDlg"><div class="card wel-card"><div class="br-head"><div><span class="eyebrow sm">' + esc(LL("Welcome", "Boas-vindas")) + "</span><h2>" + esc(LL("Welcome to the " + brand + " beta", "Bem-vindo(a) ao beta do " + brand)) + (first ? ", <span class=\"no-i18n\">" + esc(first) + "</span>" : "") + "! 🎉</h2>" +
      '<p class="muted">' + esc(LL("Thank you for helping us test. Here is how to get the most out of it", "Obrigado por nos ajudar a testar. Veja como tirar o máximo partido")) + (days !== null ? " – " + esc(LL("your access is active for", "o seu acesso está ativo durante")) + " <b>" + days + " " + esc(LL(days === 1 ? "day" : "days", days === 1 ? "dia" : "dias")) + "</b>" : "") + '.</p></div><button class="btn sm ghost" id="welX">✕</button></div>' +
      '<ol class="wel-steps">' + steps.map(function (x) { return '<li><span class="wi">' + x[0] + "</span><div><b>" + esc(x[1]) + "</b><p>" + esc(x[2]) + "</p></div></li>"; }).join("") + "</ol>" +
      '<p class="muted small">' + esc(LL("Tip: install it on your phone – browser menu → “Add to Home screen”. Questions? Reply to the invitation e-mail.", "Dica: instale no telemóvel – menu do navegador → “Adicionar ao ecrã principal”. Dúvidas? Responda ao e-mail do convite.")) + "</p>" +
      '<div class="row-end"><button class="btn" id="welLater">' + esc(LL("Later", "Mais tarde")) + "</button>" + (FIRST_BOARD ? '<a class="btn primary" href="../board/?id=' + encodeURIComponent(FIRST_BOARD) + '">' + esc(LL("Start now", "Começar agora")) + " →</a>" : '<button class="btn primary" id="welOk">' + esc(LL("Let's go", "Vamos lá")) + "</button>") + "</div></div></div>");
    const d = document.getElementById("welDlg");
    function close() { d.remove(); try { localStorage.setItem("cmcollab:welcome:" + A.key(user.email), "1"); } catch (x) { /* ignore */ } }
    ["welX", "welLater", "welOk"].forEach(function (id) { const b = document.getElementById(id); if (b) b.onclick = close; });
    d.querySelectorAll("a.btn.primary").forEach(function (a) { a.addEventListener("click", close); });
    d.onclick = function (ev) { if (ev.target === d) close(); };
  }
  function announcementBanner(a, key) {
    if (!a || !a.on || !(a.title || a.text)) return "";
    let seen = null; try { seen = localStorage.getItem("cmcollab:ann:" + key); } catch (x) { /* ignore */ }
    if (seen && Number(seen) >= Number(a.t || 0)) return "";
    return '<div class="ann-banner"><span class="bb-ic">📣</span><div><b>' + esc(a.title || LL("Announcement", "Comunicado")) + '</b><p class="muted small ann-text">' + esc(a.text || "").replace(/\n/g, "<br>") + '</p></div><button class="btn sm ghost" id="annX" data-t="' + esc(a.t || 0) + '">' + esc(LL("Got it", "Entendi")) + "</button></div>";
  }
  function bindFeedback() { el.querySelectorAll("[data-feedback]").forEach(function (b) { b.onclick = feedbackDialog; }); }
  function list(user) {
    const db = A.db();
    let entries = [];
    ME = A.key(user.email);
    A.isAdmin().then(function (admin) {
      const navAdmin = document.getElementById("navAdmin");
      if (admin && navAdmin) navAdmin.hidden = false;
      const planP = admin ? Promise.resolve("admin") : db.ref("plans/" + ME).once("value").then(function (s) { return window.CMPlan(s.val()); }, function () { return window.CMPlan(null); });
      return planP.then(function (pl) { PLAN = pl; return admin; });
    }).then(function (admin) {
      const p = admin
        ? db.ref("workspaces").once("value").then(function (s) { return s.val() || {}; })
        : db.ref("userWorkspaces/" + A.key(user.email)).once("value").then(function (s) {
          const raw = s.val() || {}, now = Date.now();
          entries = Object.keys(raw).map(function (k) { const v = raw[k]; return { id: k, name: v && v.name, expires: v && v.expires, owner: !!(v && v.owner) }; });
          OWNED = {}; entries.forEach(function (e) { if (e.owner) OWNED[e.id] = 1; });
          const ids = entries.filter(function (e) { return !e.expires || e.expires > now; }).map(function (e) { return e.id; });
          return Promise.all(ids.map(function (id) {
            return db.ref("workspaces/" + id).once("value").then(function (x) { return [id, x.val()]; }, function () { return [id, null]; });
          })).then(function (rows) { const o = {}; rows.forEach(function (r) { if (r[1]) o[r[0]] = r[1]; }); return o; });
        });
      return p.then(function (wss) {
        const ids = Object.keys(wss).sort(function (a, b) { return ((wss[a].info || {}).name || "").localeCompare((wss[b].info || {}).name || ""); });
        const allowed = {};
        ids.forEach(function (w) { const bs = wss[w].boards || {}; Object.keys(bs).forEach(function (b) { allowed[b] = { title: bs[b].title, template: bs[b].template, ws: (wss[w].info || {}).name }; }); });
        const firstBeta = entries.filter(function (e) { return e.expires && e.expires > Date.now(); })[0];
        WELCOME_ENTRY = firstBeta || null;
        if (firstBeta && wss[firstBeta.id]) {
          const bs = Object.keys(wss[firstBeta.id].boards || {}).sort();
          FIRST_BOARD = bs.filter(function (b) { return /comece|start|^1-/.test(b); })[0] || bs[0] || null;
        }
        el.innerHTML = '<div id="annSlot"></div>' + userBar(user, admin) + accessBanner(entries) + searchBar() + startStrip(true) + recentRows(allowed) +
          (ids.length ? ids.map(function (id) { return wsSection(id, wss[id], admin); }).join("")
            : (entries.length ? "" : '<div class="card empty-big"><h3>No boards yet</h3><p class="muted">' + t("Pick a template above to create your first workspace and board – or ask someone to invite this e-mail address.") + "</p></div>"));
        bindFeedback();
        el.querySelectorAll("[data-howto]").forEach(function (b) { b.onclick = function () { welcomeDialog(user); }; });
        db.ref("announcement").once("value").then(function (s) {
          const slot = document.getElementById("annSlot"); if (!slot) return;
          slot.innerHTML = announcementBanner(s.val(), A.key(user.email));
          const x = document.getElementById("annX");
          if (x) x.onclick = function () { try { localStorage.setItem("cmcollab:ann:" + A.key(user.email), x.dataset.t); } catch (e) { /* ignore */ } slot.innerHTML = ""; };
        }, function () { /* no announcement */ });
        let welcomed = null; try { welcomed = localStorage.getItem("cmcollab:welcome:" + A.key(user.email)); } catch (x) { /* ignore */ }
        if (!admin && firstBeta && !welcomed) setTimeout(function () { welcomeDialog(user); }, 400);
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
