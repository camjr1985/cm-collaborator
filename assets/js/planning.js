/* CM Collaborator – Planning module: roadmap / schedule (Gantt), board (Kanban), backlog & sprints (Scrum), list.
 * Data: planning/<id>/{info{title,ws,method,created,createdBy}, data{settings{statuses,prefix,seq}, items, sprints}}
 * Access is enforced by database.rules.json (same model as boards: admin, workspace owner, active members; editors write data). */
(function () {
  "use strict";
  const A = window.CMAuth;
  const PT = window.MB_LANG === "pt";
  const L = function (en, pt) { return window.MBL ? window.MBL(en, pt) : (PT ? pt : en); };
  const app = document.getElementById("app");
  const ID = (new URLSearchParams(location.search).get("id") || "").toLowerCase();
  const DAY = 86400000;
  const IC = function (n, sz, c) { return window.CMIcon ? window.CMIcon(n, sz || 15, c) : ""; };
  const TYPES = {
    initiative: { ic: "initiative", name: L("Initiative", "Iniciativa"), color: "#c2410c", level: 2, desc: L("Groups epics around a business outcome.", "Agrupa épicos em torno de um resultado de negócio.") },
    epic: { ic: "epic", name: L("Epic", "Épico"), color: "#7c5cff", level: 1, desc: L("A large body of work split into stories.", "Um grande bloco de trabalho dividido em histórias.") },
    phase: { ic: "phase", name: L("Phase", "Fase"), color: "#0e1a33", level: 1, desc: L("A stage of the schedule with its tasks.", "Uma etapa do cronograma com suas tarefas.") },
    story: { ic: "story", name: L("Story", "História"), color: "#36b37e", level: 0, desc: L("A user need – “As a…, I want…, so that…”.", "Uma necessidade do usuário – “Como…, quero…, para…”.") },
    task: { ic: "task", name: L("Task", "Tarefa"), color: "#2f80ed", level: 0, desc: L("A piece of work to be done.", "Um trabalho a ser feito.") },
    bug: { ic: "bug", name: "Bug", color: "#e5484d", level: 0, desc: L("Something that is not working.", "Algo que não está funcionando.") },
    milestone: { ic: "milestone", name: L("Milestone", "Marco"), color: "#e8a400", level: 0, desc: L("A key date or delivery.", "Uma data ou entrega importante.") }
  };
  Object.keys(TYPES).forEach(function (k) { TYPES[k].icon = IC(TYPES[k].ic); });
  const CATC = { todo: "#8a94a6", doing: "#2f80ed", done: "#36b37e" };
  /* each status has its own colour: custom (workflow dialog) or derived – "at risk / blocked" turns red, "review / test" purple */
  function stColor(s) {
    if (!s) return CATC.todo;
    if (s.color) return s.color;
    const n = String((s.id || "") + " " + (s.name || "")).toLowerCase();
    if (/late|risk|risco|bloq|block|imped|atras/.test(n)) return "#e5484d";
    if (s.cat === "doing" && /review|revis|test|qa|valid|homolog/.test(n)) return "#8e4ec6";
    if (s.cat === "doing" && /aguard|wait|espera|pend/.test(n)) return "#e8a400";
    return CATC[s.cat] || CATC.todo;
  }
  /* money (budget vs actual) */
  function cur() { return (data.settings && data.settings.currency) || (PT ? "BRL" : "EUR"); }
  function money(v) { try { return new Intl.NumberFormat(window.MB_LOCALE || (PT ? "pt-BR" : "en-GB"), { style: "currency", currency: cur(), maximumFractionDigits: 0 }).format(v || 0); } catch (e) { return String(Math.round(v || 0)); } }
  function moneyOf(it) { /* own + all descendants */
    let b = Number(it.budget) || 0, a = Number(it.actual) || 0;
    if (isContainer(it)) descendants(it.id).forEach(function (k) { b += Number(k.budget) || 0; a += Number(k.actual) || 0; });
    return { b: b, a: a };
  }
  const VIEWN = { timeline: L("Timeline", "Linha do tempo"), board: L("Boards", "Quadros"), backlog: "Backlog", list: L("List", "Lista"), reports: L("Reports", "Relatórios"), okr: "OKRs", kpi: L("Indicators", "Indicadores"), budget: L("Budget", "Orçamento") };

  let db, me, info, data = { settings: {}, items: {}, sprints: {} }, members = {}, wsInfo = {}, wsInteg = {}, canEdit = false, isAdm = false;
  const pushT = {};
  let view = null, scale = "month", collapsed = {}, filter = { q: "", who: "" }, dragging = false, pending = false, openItem = null, drawerDirty = false;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function TS() { return window.firebase.database.ServerValue.TIMESTAMP; }
  function toast(msg) {
    let n = document.getElementById("toast");
    if (!n) { n = document.createElement("div"); n.id = "toast"; n.className = "pl-toast"; n.setAttribute("role", "status"); document.body.appendChild(n); }
    n.textContent = msg; n.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { n.classList.remove("show"); }, 2800);
  }
  function fail(e) { console.warn(e); toast((e && e.message) || L("Something went wrong", "Algo deu errado")); }
  function d2n(s) { return s ? Date.parse(s + "T00:00:00Z") : NaN; }
  function n2d(n) { return new Date(n).toISOString().slice(0, 10); }
  function today() { const d = new Date(); return n2d(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); }
  function fmt(s) { if (!s) return ""; const d = new Date(d2n(s)); return d.toLocaleDateString(window.MB_LOCALE || (PT ? "pt-BR" : "en-GB"), { day: "2-digit", month: "short", timeZone: "UTC" }); }
  function method() { return (window.PLAN_METHODS || {})[info.method] || window.PLAN_METHODS.hybrid; }
  function statuses() { return (data.settings && data.settings.statuses) || method().statuses; }
  function statusOf(it) { const ss = statuses(); return ss.find(function (s) { return s.id === it.status; }) || ss[0]; }
  function cat(it) { return statusOf(it).cat; }
  function items() { return Object.keys(data.items || {}).map(function (k) { return Object.assign({ id: k }, data.items[k]); }); }
  function byOrder(a, b) { return (a.order || 0) - (b.order || 0) || String(a.key || "").localeCompare(String(b.key || ""), undefined, { numeric: true }); }
  function children(pid) { return items().filter(function (i) { return i.parent === pid; }).sort(byOrder); }
  function isContainer(it) { return it.type === "epic" || it.type === "phase" || it.type === "initiative"; }
  function lvl(t) { return (TYPES[t] || TYPES.task).level; }
  function parentChoices(type, selfId) { const l = lvl(type); return items().filter(function (i) { return i.id !== selfId && isContainer(i) && lvl(i.type) > l; }).sort(byOrder); }
  function childType(p) { if (p.type === "initiative") return method().types.indexOf("epic") >= 0 ? "epic" : "phase"; if (p.type === "phase") return "task"; return method().types.indexOf("story") >= 0 ? "story" : "task"; }
  function memberName(email) {
    if (!email) return "";
    const m = members[A.key(email)];
    return (m && m.name) || email.split("@")[0];
  }
  function initials(email) { return memberName(email).split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(function (x) { return x[0].toUpperCase(); }).join("") || "?"; }
  function matches(it) {
    if (filter.who && (it.assignee || "") !== (filter.who === "_none" ? "" : filter.who)) return false;
    if (filter.q) { const q = filter.q.toLowerCase(); if ((it.title || "").toLowerCase().indexOf(q) < 0 && (it.key || "").toLowerCase().indexOf(q) < 0) return false; }
    return true;
  }
  function overdue(it) { return it.end && cat(it) !== "done" && it.end < today(); }
  function ref(p) { return db.ref("planning/" + ID + "/data/" + p); }
  function save(path, val) { if (!canEdit) return Promise.resolve(); return ref(path).set(val).catch(fail); }
  function patch(id, obj) {
    if (!canEdit) return Promise.resolve();
    const u = {}; Object.keys(obj).forEach(function (k) { u["items/" + id + "/" + k] = obj[k] === undefined ? null : obj[k]; });
    if ("status" in obj && data.items[id]) { const nd = (statuses().find(function (x) { return x.id === obj.status; }) || {}).cat === "done", wasDone = cat(data.items[id]) === "done"; if (nd && !wasDone) u["items/" + id + "/doneAt"] = TS(); else if (!nd && wasDone) u["items/" + id + "/doneAt"] = null; }
    if ("status" in obj && data.items[id] && !data.items[id].startedAt) { const ns = statuses().find(function (x) { return x.id === obj.status; }) || {}; if (ns.cat === "doing") u["items/" + id + "/startedAt"] = TS(); }
    u["items/" + id + "/updated"] = TS();
    const prevSt = data.items[id] ? data.items[id].status : null, w = data.items[id] && data.items[id].watch;
    const tellW = "status" in obj && obj.status !== prevSt && w && Object.keys(w).some(function (k) { return w[k] && w[k].status !== false && String(w[k].email).toLowerCase() !== String(me.email).toLowerCase(); });
    return db.ref("planning/" + ID + "/data").update(u).then(function () { jiraPushLater(id, obj); if (tellW) notify("watch", { item: id, from: prevSt }).then(function (j) { if (j && j.ok && (j.sent || []).length) toast(L("Card followers notified", "Quem acompanha o card foi avisado")); }); }).catch(fail);
  }
  /* changes to items that came from Jira / Azure DevOps / Kanbanize go back to the source tool */
  function jiraPushLater(id, obj) {
    const it = data.items[id]; if (!it || !it.ext || !PROV[it.ext.source]) return;
    const src = it.ext.source, S = data.settings && data.settings[src];
    if (!S || S.push === false) return;
    if (!["title", "status", "start", "end"].some(function (k) { return k in obj; })) return;
    clearTimeout(pushT[id]);
    pushT[id] = setTimeout(function () {
      notify(src + "-push", { item: id }).then(function (j) {
        if (j && j.ok) toast(L("Updated in ", "Atualizado no ") + PROV[src].name + ": " + it.ext.key);
        else toast(PROV[src].name + L(" did not accept the change: ", " não aceitou a alteração: ") + ((j && j.error) || ""));
      });
    }, 1200);
  }
  function nextKey() {
    return db.ref("planning/" + ID + "/data/settings/seq").transaction(function (n) { return (n || 0) + 1; }).then(function (r) {
      return ((data.settings && data.settings.prefix) || "PLN") + "-" + r.snapshot.val();
    });
  }
  function createItem(o) {
    if (!canEdit) return Promise.resolve(null);
    const id = db.ref().push().key;
    return nextKey().then(function (k) {
      const it = Object.assign({ type: "task", title: L("New item", "Novo item"), status: statuses()[0].id, order: Date.now(), created: TS(), by: me.email, key: k }, o);
      Object.keys(it).forEach(function (x) { if (it[x] === undefined || it[x] === "") delete it[x]; });
      return ref("items/" + id).set(it).then(function () {
        if (it.assignee && it.assignee !== me.email) notify("assign", { item: id });
        Object.keys(PROV).forEach(function (k) { const S = data.settings && data.settings[k]; if (S && S.autoCreate) setTimeout(function () { createInTool(k, id, true); }, 300); });
        return id;
      });
    }).catch(fail);
  }

  /* ---------------- e-mail notifications through the platform notifier ---------------- */
  function notify(kind, extra) {
    const url = window.CMCOLLAB_MAILER; if (!url) return Promise.resolve(null);
    return window.firebase.auth().currentUser.getIdToken().then(function (tok) {
      return fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ idToken: tok, kind: kind, plan: ID, ws: info.ws, lang: PT ? "pt" : "en", brand: window.CMCOLLAB_BRAND || "" }, extra || {})) });
    }).then(function (r) { return r.json(); }).catch(function (e) { console.warn(e); return { ok: false, error: e.message }; });
  }
  function sendReminders() {
    const due = items().filter(function (i) { return i.assignee && i.end && cat(i) !== "done" && d2n(i.end) - d2n(today()) <= 3 * DAY; });
    if (!due.length) return toast(L("No assigned items are overdue or due in the next 3 days.", "Não há itens atribuídos atrasados ou a vencer nos próximos 3 dias."));
    const people = {}; due.forEach(function (i) { people[i.assignee] = 1; });
    modal('<h2>' + L("Send deadline reminders", "Enviar lembretes de prazo") + '</h2><p class="muted">' + L("An e-mail goes to each person with their items that are overdue or due in the next 3 days:", "Cada pessoa recebe um e-mail com seus itens atrasados ou a vencer nos próximos 3 dias:") + "</p><ul class=\"pl-ul\">" +
      Object.keys(people).map(function (e) { return "<li><b>" + esc(memberName(e)) + "</b> · " + esc(e) + " – " + due.filter(function (i) { return i.assignee === e; }).length + " " + L("item(s)", "item(ns)") + "</li>"; }).join("") + "</ul>" +
      '<div class="pl-row-end"><button class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary" id="remGo">' + L("Send e-mails", "Enviar e-mails") + "</button></div>", function (box, close) {
      box.querySelector("#remGo").onclick = function () {
        this.disabled = true;
        notify("due", {}).then(function (j) {
          close();
          if (j && j.ok) toast(L("Reminders sent to ", "Lembretes enviados a ") + (j.sent || []).length + L(" people", " pessoas"));
          else toast(L("Could not send: ", "Não foi possível enviar: ") + ((j && j.error) || ""));
        });
      };
    });
  }

  /* ---------------- shell ---------------- */
  function shell() {
    const m = method();
    let views = m.views.slice();
    if (views.indexOf("backlog") < 0 && boardsList().some(function (b) { return b.kind === "scrum"; })) views.splice(views.indexOf("board") + 1, 0, "backlog");
    views = ["okr"].concat(views, ["reports"]); /* OKR → initiative → epic → story: objectives come first */
    if (budgetOn()) views.push("budget");
    if (kpiOn()) views.push("kpi");
    if (!view) { try { view = localStorage.getItem("cmcollab:plview:" + ID); } catch (e) { /* ignore */ } }
    if (views.indexOf(view) < 0) view = okrs().length ? "okr" : views[1];
    document.body.classList.toggle("no-sp", !spOn());
    const who = {}; items().forEach(function (i) { if (i.assignee) who[i.assignee] = 1; }); Object.keys(members).forEach(function (k) { who[members[k].email] = 1; });
    app.innerHTML =
      '<header class="pl-top"><a class="pl-back" href="' + (info.board ? "../board/?id=" + encodeURIComponent(info.board) : "../workspaces/") + '" title="' + (info.board ? L("Back to the board", "Voltar ao quadro") : L("My boards", "Meus quadros")) + '">←</a><span class="pl-logo">CM</span>' +
      '<div class="pl-title"><span class="pl-ws">' + esc(wsInfo.name || info.ws) + " · " + IC(m.icon, 13) + " " + esc(m.name) + '</span><h1>' + esc(info.title) + "</h1></div>" +
      '<nav class="pl-tabs">' + views.map(function (v) { return '<button data-view="' + v + '" class="' + (v === view ? "on" : "") + '">' + esc((m.label && m.label[v]) || VIEWN[v]) + (v === "okr" && window.CMNewBadge ? window.CMNewBadge("okr") : "") + "</button>"; }).join("") + "</nav>" +
      '<div class="pl-actions">' + (canEdit ? '<button class="pl-btn primary" id="newBtn">' + IC("plus", 16) + " " + L("Create", "Criar") + " ▾</button>" : '<span class="pl-ro">' + L("View only", "Só leitura") + "</span>") +
      (canEdit ? '<button class="pl-btn icon" id="alertBtn" title="' + L("E-mail alerts", "Alertas por e-mail") + '">' + IC("bell", 17) + (data.settings && data.settings.notify && data.settings.notify.enabled ? '<span class="on-dot"></span>' : (window.CMIsNew && window.CMIsNew("alerts") ? '<span class="new-dot" data-new-id="alerts"></span>' : "")) + "</button>" : "") +
      '<button class="pl-btn icon" id="moreBtn" title="' + L("More", "Mais") + '">⋯' + (window.CMIsNew && window.CMIsNew("integrations") ? '<span class="new-dot" data-new-id="integrations"></span>' : "") + '</button></div></header>' +
      '<div class="pl-bar"><input id="q" type="search" placeholder="' + L("Search items", "Pesquisar itens") + '" value="' + esc(filter.q) + '">' +
      '<select id="who"><option value="">' + L("Everyone", "Todas as pessoas") + '</option><option value="_none"' + (filter.who === "_none" ? " selected" : "") + ">" + L("Unassigned", "Sem responsável") + "</option>" +
      Object.keys(who).sort().map(function (e) { return '<option value="' + esc(e) + '"' + (filter.who === e ? " selected" : "") + ">" + esc(memberName(e)) + "</option>"; }).join("") + "</select>" +
      (view === "timeline" ? tlToolbar() : "") +
      (canEdit ? Object.keys(PROV).filter(function (k) { return data.settings && data.settings[k]; }).map(function (k) { return '<button class="pl-btn sm" data-sync="' + k + '" title="' + L("Pull the latest from ", "Trazer as últimas alterações do ") + PROV[k].name + '">' + IC("sync", 14) + " " + PROV[k].short + "</button>"; }).join("") : "") +
      '<span class="pl-sum" id="sum"></span></div>' +
      hintBar() +
      '<main id="view" class="pl-view"></main>';
    app.querySelectorAll("[data-view]").forEach(function (b) { b.onclick = function () { view = b.dataset.view; try { localStorage.setItem("cmcollab:plview:" + ID, view); } catch (e) { /* ignore */ } shell(); }; });
    const q = document.getElementById("q"); q.oninput = function () { filter.q = q.value; renderView(); };
    document.getElementById("who").onchange = function (e) { filter.who = e.target.value; renderView(); };
    bindToolbar();
    const nb = document.getElementById("newBtn"); if (nb) nb.onclick = function (e) { e.stopPropagation(); createMenu(nb); };
    const hc = document.getElementById("hintGo"); if (hc) hc.onclick = function () { integrationsDialog(); };
    const hx = document.getElementById("hintX"); if (hx) hx.onclick = function () { try { localStorage.setItem("cmcollab:inthint:" + ID, "1"); } catch (x) { /* ignore */ } const h = document.getElementById("intHint"); if (h) h.remove(); };
    document.getElementById("moreBtn").onclick = moreMenu;
    const ab = document.getElementById("alertBtn"); if (ab) ab.onclick = alertsDialog;
    app.querySelectorAll("[data-sync]").forEach(function (b) { b.onclick = function () { const k = b.dataset.sync, S = data.settings[k]; b.disabled = true; extRun(k, { project: S.project, query: S.query || S.jql }, S.push !== false).then(function () { b.disabled = false; }); }; });
    renderView();
  }
  function renderView() {
    if (dragging) { pending = true; return; }
    const v = document.getElementById("view"); if (!v) return;
    const all = items();
    const done = all.filter(function (i) { return i.type !== "milestone" && cat(i) === "done"; }).length, tot = all.filter(function (i) { return i.type !== "milestone"; }).length;
    const late = all.filter(overdue).length;
    let mb = 0, ma = 0; all.forEach(function (i) { mb += Number(i.budget) || 0; ma += Number(i.actual) || 0; });
    document.getElementById("sum").innerHTML = tot + " " + L("items", "itens") + " · " + (tot ? Math.round(done / tot * 100) : 0) + "% " + L("done", "concluído") + (late ? ' · <b class="late">' + late + " " + L("overdue", "em atraso") + "</b>" : "") + (mb || ma ? ' · <span class="money" title="' + L("Budget vs actual", "Orçado x realizado") + '">' + L("Budget ", "Orçado ") + money(mb) + " · " + L("Actual ", "Realizado ") + '<b class="' + (ma > mb && mb ? "late" : "") + '">' + money(ma) + "</b></span>" : "");
    if (view === "okr" && window.CMMarkSeen) window.CMMarkSeen("okr");
    if (view === "timeline") timeline(v); else if (view === "board") board(v); else if (view === "backlog") backlog(v); else if (view === "okr") okrView(v); else if (view === "reports") reportsView(v); else if (view === "kpi") kpiView(v); else if (view === "budget") budgetView(v); else list(v);
    if (openItem && !document.getElementById("drawer")) openDrawer(openItem);
  }

  /* ---------------- timeline / roadmap / Gantt (v3 – zoom levels, density, markers, rollups) ----------------
   * Inspired by Jira Cloud timeline (weeks/months/quarters, progress, dependencies, releases row),
   * Jira Plans (3M / 1Y / Fit) and Businessmap initiatives timeline (sticky titles, delay indicator). */
  const ZBASE = { day: 44, week: 20, month: 8, quarter: 3, year: 1.15 };
  const ZORDER = ["day", "week", "month", "quarter", "year"];
  const ZN = { day: L("Days", "Dias"), week: L("Weeks", "Semanas"), month: L("Months", "Meses"), quarter: L("Quarters", "Trimestres"), year: L("Year", "Ano") };
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  let zoom = (function () { try { return JSON.parse(lsGet("cmcollab:plzoom")) || null; } catch (e) { return null; } })() || { unit: window.innerWidth < 760 ? "week" : "month", k: 1 };
  let density = lsGet("cmcollab:pldensity") || "comfort";
  let levelShow = lsGet("cmcollab:pllevel") || "all";
  let leftW = Number(lsGet("cmcollab:plleft")) || 360;
  let tlAnchor = null;
  function pxDay() { return Math.max(0.5, Math.min(120, ZBASE[zoom.unit] * (zoom.k || 1))); }
  function gran(px) { return px >= 30 ? "day" : px >= 12 ? "week" : px >= 4.5 ? "month" : px >= 1.8 ? "quarter" : "year"; }
  function setZoom(z, anchorDate) { const r = document.getElementById("tlRight"); tlAnchor = anchorDate || (r ? centerDate(r) : null); zoom = z; lsSet("cmcollab:plzoom", JSON.stringify(zoom)); shell(); }
  function centerDate(r) { const R = timeline._R; return R ? R.lo + (r.scrollLeft + r.clientWidth / 2) / R.px * DAY : null; }
  function tlToolbar() {
    return '<div class="pl-seg" id="zoomSeg">' + ZORDER.map(function (u) { return '<button data-z="' + u + '" class="' + (zoom.unit === u && Math.abs((zoom.k || 1) - 1) < 0.01 ? "on" : "") + '">' + ZN[u] + "</button>"; }).join("") + "</div>" +
      '<div class="pl-seg zk"><button id="zOut" title="' + L("Zoom out", "Diminuir zoom") + '">−</button><button id="zIn" title="' + L("Zoom in (Ctrl + mouse wheel)", "Aumentar zoom (Ctrl + roda do mouse)") + '">+</button></div>' +
      '<button class="pl-btn sm" id="zFit" title="' + L("Fit everything on screen", "Ajustar tudo na tela") + '">' + L("Fit", "Ajustar") + "</button>" +
      '<button class="pl-btn sm" id="todayBtn">' + L("Today", "Hoje") + "</button>" +
      '<select id="lvlSel" title="' + L("Levels shown", "Níveis exibidos") + '"><option value="all"' + (levelShow === "all" ? " selected" : "") + ">" + L("All levels", "Todos os níveis") + '</option><option value="epic"' + (levelShow === "epic" ? " selected" : "") + ">" + L("Initiatives and epics", "Iniciativas e épicos") + '</option><option value="initiative"' + (levelShow === "initiative" ? " selected" : "") + ">" + L("Initiatives only", "Só iniciativas") + "</option></select>" +
      '<div class="pl-seg"><button id="expAll" title="' + L("Expand all", "Expandir tudo") + '">⊞</button><button id="colAll" title="' + L("Collapse all", "Recolher tudo") + '">⊟</button></div>' +
      '<div class="pl-seg" id="densSeg"><button data-d="comfort" class="' + (density === "comfort" ? "on" : "") + '" title="' + L("Comfortable rows", "Linhas confortáveis") + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button><button data-d="compact" class="' + (density === "compact" ? "on" : "") + '" title="' + L("Compact rows", "Linhas compactas") + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 5h16M4 9.5h16M4 14h16M4 18.5h16"/></svg></button></div>';
  }
  function bindToolbar() {
    const zs = document.getElementById("zoomSeg"); if (!zs) return;
    zs.onclick = function (e) { const b = e.target.closest("[data-z]"); if (b) setZoom({ unit: b.dataset.z, k: 1 }); };
    document.getElementById("zIn").onclick = function () { stepZoom(1); };
    document.getElementById("zOut").onclick = function () { stepZoom(-1); };
    document.getElementById("zFit").onclick = fitZoom;
    document.getElementById("todayBtn").onclick = function () { scrollToday(true); };
    document.getElementById("lvlSel").onchange = function (e) { levelShow = e.target.value; lsSet("cmcollab:pllevel", levelShow); renderView(); };
    document.getElementById("expAll").onclick = function () { collapsed = {}; renderView(); };
    document.getElementById("colAll").onclick = function () { items().forEach(function (i) { if (isContainer(i)) collapsed[i.id] = true; }); renderView(); };
    document.getElementById("densSeg").onclick = function (e) { const b = e.target.closest("[data-d]"); if (b) { density = b.dataset.d; lsSet("cmcollab:pldensity", density); shell(); } };
  }
  function stepZoom(dir) {
    const px = pxDay() * (dir > 0 ? 1.35 : 1 / 1.35), u = gran(px);
    setZoom({ unit: u, k: px / ZBASE[u] });
  }
  function fitZoom() {
    let lo = Infinity, hi = -Infinity;
    rows().forEach(function (r) { const sp = span(r.it); if (sp) { lo = Math.min(lo, sp.s); hi = Math.max(hi, sp.e + DAY); } });
    if (!isFinite(lo)) return toast(L("Nothing scheduled yet.", "Ainda não há nada agendado."));
    const r = document.getElementById("tlRight"), w = (r ? r.clientWidth : 900) - 40, px = w / Math.max(7, (hi - lo) / DAY + 4), u = gran(px);
    setZoom({ unit: u, k: px / ZBASE[u] }, lo + (hi - lo) / 2);
  }
  function minLevel() { return levelShow === "initiative" ? 2 : levelShow === "epic" ? 1 : -1; }
  function rows() {
    const out = [], ml = minLevel();
    const all = items().filter(function (i) { return !i.parent || !data.items[i.parent]; }).sort(function (a, b) { return byOrder(a, b); });
    function visibleType(it) { return it.type === "milestone" || lvl(it.type) >= ml; }
    function walk(it, depth) {
      if (!visibleType(it)) return;
      const kids = children(it.id).filter(visibleType);
      const show = matches(it) || kids.some(matches);
      if (!show) return;
      out.push({ it: it, depth: depth, kids: kids.length });
      if (kids.length && !collapsed[it.id]) kids.forEach(function (k) { walk(k, depth + 1); });
    }
    all.forEach(function (i) { walk(i, 0); });
    return out;
  }
  function descendants(id) { const out = []; children(id).forEach(function (k) { out.push(k); out.push.apply(out, descendants(k.id)); }); return out; }
  function rollup(it) { // share of done / doing / todo among leaf descendants (Jira-style progress on parents)
    const leaves = descendants(it.id).filter(function (k) { return !isContainer(k) && k.type !== "milestone"; });
    if (!leaves.length) return null;
    const n = leaves.length, d = leaves.filter(function (k) { return cat(k) === "done"; }).length, g = leaves.filter(function (k) { return cat(k) === "doing"; }).length;
    return { done: d / n * 100, doing: g / n * 100, n: n, d: d };
  }
  function span(it) {
    let s = d2n(it.start), e = d2n(it.end || it.start);
    if (isNaN(s) && isContainer(it)) {
      const ks = descendants(it.id).filter(function (k) { return k.start || k.end; });
      if (ks.length) { s = Math.min.apply(null, ks.map(function (k) { return d2n(k.start || k.end); })); e = Math.max.apply(null, ks.map(function (k) { return d2n(k.end || k.start); })); return { s: s, e: e, rolled: true }; }
    }
    if (isNaN(s) && !isNaN(e)) s = e;
    if (isNaN(s)) return null;
    if (isNaN(e) || e < s) e = s;
    return { s: s, e: e };
  }
  function range(px, g, viewW) {
    let lo = d2n(today()) - 30 * DAY, hi = d2n(today()) + 120 * DAY;
    items().forEach(function (i) { const sp = span(i); if (sp) { lo = Math.min(lo, sp.s - 21 * DAY); hi = Math.max(hi, sp.e + 45 * DAY); } });
    Object.keys(data.sprints || {}).forEach(function (k) { const S = data.sprints[k]; if (S.start) lo = Math.min(lo, d2n(S.start) - 7 * DAY); if (S.end) hi = Math.max(hi, d2n(S.end) + 14 * DAY); });
    const a = new Date(lo);
    if (g === "year" || g === "quarter") lo = Date.UTC(a.getUTCFullYear(), g === "year" ? 0 : Math.floor(a.getUTCMonth() / 3) * 3, 1);
    else lo = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1);
    if (g === "day" || g === "week") { const wd = (new Date(lo).getUTCDay() + 6) % 7; lo -= wd * DAY; }
    hi = Math.max(hi, lo + Math.ceil((viewW + 200) / px) * DAY);
    return { lo: lo, hi: hi, px: px, g: g };
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function mLabel(d, long) { return cap(d.toLocaleDateString(window.MB_LOCALE || (PT ? "pt-BR" : "en-GB"), { month: long ? "long" : "short", timeZone: "UTC" }).replace(".", "")); }
  function isoWeek(n) { const d = new Date(n); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 3); const y = d.getUTCFullYear(), f = new Date(Date.UTC(y, 0, 4)); return 1 + Math.round(((d - f) / DAY - 3 + ((f.getUTCDay() + 6) % 7)) / 7); }
  function headers(R, x) {
    let h1 = "", h2 = "", grid = "";
    const cell = function (cls, a, b, txt) { const w = x(Math.min(b, R.hi)) - x(a); return w > 1 ? '<div class="' + cls + '" style="left:' + x(a) + "px;width:" + w + 'px"><span>' + txt + "</span></div>" : ""; };
    const months = function (fn) { for (let d = new Date(R.lo); d.getTime() < R.hi; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) fn(d, d.getTime(), Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); };
    if (R.g === "year") {
      for (let y = new Date(R.lo).getUTCFullYear(); Date.UTC(y, 0, 1) < R.hi; y++) {
        h1 += cell("th1", Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1), String(y));
        for (let q = 0; q < 4; q++) { const a = Date.UTC(y, q * 3, 1); h2 += cell("th2", a, Date.UTC(y, q * 3 + 3, 1), (PT ? "T" : "Q") + (q + 1)); grid += '<div class="gl' + (q === 0 ? " m" : "") + '" style="left:' + x(a) + 'px"></div>'; }
      }
    } else if (R.g === "quarter") {
      months(function (d, a, b) {
        if (d.getUTCMonth() % 3 === 0) h1 += cell("th1", a, Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1), (PT ? "T" : "Q") + (Math.floor(d.getUTCMonth() / 3) + 1) + " " + d.getUTCFullYear());
        h2 += cell("th2", a, b, mLabel(d, false)); grid += '<div class="gl' + (d.getUTCMonth() % 3 === 0 ? " m" : "") + '" style="left:' + x(a) + 'px"></div>';
      });
    } else {
      months(function (d, a, b) { h1 += cell("th1", a, b, mLabel(d, true) + " " + d.getUTCFullYear()); grid += '<div class="gl m" style="left:' + x(a) + 'px"></div>'; });
      const wd0 = (new Date(R.lo).getUTCDay() + 6) % 7;
      if (R.g === "month" || R.g === "week") {
        for (let n = R.lo + ((7 - wd0) % 7) * DAY; n < R.hi; n += 7 * DAY) {
          const dd = new Date(n), lab = R.g === "week" ? (PT ? "S" : "W") + isoWeek(n) + " · " + dd.getUTCDate() + " " + mLabel(dd, false).toLowerCase() : String(dd.getUTCDate());
          h2 += cell("th2", n, n + 7 * DAY, lab); grid += '<div class="gl w" style="left:' + x(n) + 'px"></div>';
        }
      }
      if (R.g === "week" || R.g === "day") {
        const wk = PT ? ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        for (let n = R.lo; n < R.hi; n += DAY) {
          const dw = (new Date(n).getUTCDay() + 6) % 7;
          if (dw >= 5) grid += '<div class="we" style="left:' + x(n) + "px;width:" + R.px + 'px"></div>';
          if (R.g === "day") { h2 += cell("th2 day" + (n2d(n) === today() ? " now" : ""), n, n + DAY, wk[dw] + " " + new Date(n).getUTCDate()); grid += '<div class="gl' + (dw === 0 ? " w" : " d") + '" style="left:' + x(n) + 'px"></div>'; }
        }
      }
    }
    return { h1: h1, h2: h2, grid: grid };
  }
  function markersRow(R, x) {
    let h = "";
    Object.keys(data.sprints || {}).forEach(function (k) {
      const S = data.sprints[k]; if (!S.start || !S.end) return;
      const a = x(d2n(S.start)), w = Math.max(8, x(d2n(S.end) + DAY) - a);
      h += '<div class="mk-sprint ' + (S.state || "") + '" style="left:' + a + "px;width:" + w + 'px" title="' + esc(S.name + " · " + fmt(S.start) + " → " + fmt(S.end)) + '"><span>' + esc(S.name) + "</span></div>";
    });
    items().filter(function (i) { return i.type === "milestone" && (i.end || i.start); }).forEach(function (i) {
      const n = d2n(i.end || i.start), c = cat(i) === "done" ? "done" : overdue(i) ? "late" : "";
      h += '<div class="mk-ms ' + c + '" style="left:' + (x(n) + R.px / 2) + 'px" data-open="' + i.id + '" title="' + esc(i.title + " · " + fmt(i.end || i.start)) + '"><i></i><span>' + esc(i.title) + "</span></div>";
    });
    return h;
  }
  function timeline(v) {
    const prev = document.getElementById("tlRight"), keep = prev ? { l: prev.scrollLeft, t: prev.scrollTop, c: centerDate(prev) } : null;
    const comfy = density === "comfort", RH = comfy ? 44 : 32, BH = comfy ? 28 : 20, MOB = window.innerWidth < 760;
    const lw = MOB ? Math.round(window.innerWidth * 0.44) : Math.max(220, Math.min(620, leftW));
    const viewW = Math.max(300, (v.clientWidth || 1200) - lw);
    const px = pxDay(), R = range(px, gran(px), viewW), rs = rows();
    timeline._R = R;
    const W = Math.ceil((R.hi - R.lo) / DAY) * R.px, x = function (n) { return (n - R.lo) / DAY * R.px; };
    const H$ = headers(R, x), mk = markersRow(R, x), hasMk = !!mk;
    const tx = x(d2n(today()));
    let left = "", bars = "";
    rs.forEach(function (r, i) {
      const it = r.it, T = TYPES[it.type] || TYPES.task, s = statusOf(it), sp = span(it), top = i * RH, ru = isContainer(it) ? rollup(it) : null;
      left += '<div class="tl-row' + (openItem === it.id ? " sel" : "") + (isContainer(it) ? " cont lv" + lvl(it.type) : "") + '" style="height:' + RH + 'px" data-open="' + it.id + '"><span class="ind" style="width:' + r.depth * (MOB ? 10 : 18) + 'px"></span>' +
        (r.kids ? '<button class="tw" data-tw="' + it.id + '">' + (collapsed[it.id] ? "▸" : "▾") + "</button>" : '<span class="tw"></span>') +
        '<span class="ti" style="color:' + T.color + '" title="' + esc(T.name) + '">' + T.icon + '</span><span class="tk">' + esc(it.key || "") + '</span><span class="tt">' + (it.prio ? '<span class="star" title="' + L("Key activity", "Atividade principal") + '">★</span>' : "") + esc(it.title) + "</span>" +
        (ru ? '<span class="rp" title="' + ru.d + "/" + ru.n + L(" done", " concluídos") + '"><i style="width:' + ru.done + '%"></i></span>' : '<span class="sd" style="background:' + stColor(s) + '" title="' + esc(s.name) + '"></span>') +
        (it.assignee ? '<span class="av" title="' + esc(memberName(it.assignee)) + '">' + esc(initials(it.assignee)) + "</span>" : "") +
        (isContainer(it) && !MOB ? '<button class="addc kbo" data-kbo="' + it.id + '" title="' + L("Open its cards on the board", "Abrir os cartões no quadro") + '">' + IC("kanban", 14) + "</button>" : "") +
        (canEdit && isContainer(it) ? '<button class="addc" data-addc="' + it.id + '" title="' + L("Add child item", "Adicionar item filho") + '">' + IC("plus", 14) + "</button>" : "") + "</div>";
      if (sp) {
        const bx = x(sp.s), bw = Math.max(Math.max(R.px, 6), x(sp.e + DAY) - bx), col = isContainer(it) ? T.color : stColor(s), late = overdue(it);
        const lateDays = late ? Math.round((d2n(today()) - d2n(it.end)) / DAY) : 0;
        const tipTxt = it.title + "\n" + T.name + " · " + s.name + "\n" + fmt(n2d(sp.s)) + " → " + fmt(n2d(sp.e)) + " (" + (Math.round((sp.e - sp.s) / DAY) + 1) + L(" days)", " dias)") + (ru ? "\n" + Math.round(ru.done) + "% " + L("done", "concluído") + " (" + ru.d + "/" + ru.n + ")" : "") + (it.assignee ? "\n" + memberName(it.assignee) : "") + (late ? "\n⚠ " + lateDays + L(" day(s) late", " dia(s) de atraso") : "");
        if (it.type === "milestone") {
          bars += '<div class="ms' + (cat(it) === "done" ? " done" : "") + (late ? " late" : "") + '" data-bar="' + it.id + '" data-tip="' + esc(tipTxt) + '" style="left:' + (x(sp.s) + R.px / 2 - BH * 0.36) + "px;top:" + (top + (RH - BH * 0.72) / 2) + "px;width:" + BH * 0.72 + "px;height:" + BH * 0.72 + 'px"></div><div class="ms-l" style="left:' + (x(sp.s) + R.px / 2 + BH * 0.6) + "px;top:" + top + "px;line-height:" + RH + 'px">' + esc(it.title) + (late ? ' <b class="late-b">+' + lateDays + "d</b>" : "") + "</div>";
        } else {
          const inside = bw >= 96;
          const prog = ru ? null : (s.cat === "done" ? 100 : Number(it.progress) || 0);
          bars += '<div class="bar' + (sp.rolled ? " rolled" : "") + (isContainer(it) ? " cont" : "") + (late ? " late" : "") + '" data-bar="' + it.id + '" data-tip="' + esc(tipTxt) + '" style="left:' + bx + "px;width:" + bw + "px;top:" + (top + (RH - BH) / 2) + "px;height:" + BH + "px;--c:" + col + '">' +
            '<span class="bfill">' + (ru ? '<i class="rd" style="width:' + ru.done + '%"></i><i class="rg" style="left:' + ru.done + "%;width:" + ru.doing + '%"></i>' : '<i class="pf" style="width:' + prog + '%"></i>') + "</span>" +
            (inside ? '<span class="bl">' + esc(it.title) + (ru ? ' <em>' + Math.round(ru.done) + "%</em>" : "") + "</span>" : "") +
            (canEdit && !sp.rolled ? '<span class="h l" data-h="l"></span><span class="h r" data-h="r"></span>' : "") + "</div>" +
            (!inside ? '<div class="ms-l" style="left:' + (bx + bw + 6) + "px;top:" + top + "px;line-height:" + RH + 'px">' + esc(it.title) + "</div>" : "") +
            (late ? '<div class="late-b abs" style="left:' + (bx + bw + (inside ? 6 : 6)) + "px;top:" + (top + RH / 2 - 9) + 'px;' + (inside ? "" : "margin-top:-14px;") + '">+' + lateDays + "d</div>" : "");
        }
      } else if (canEdit) bars += '<div class="nodate" style="top:' + top + "px;line-height:" + RH + 'px">' + L("Click on this line to schedule", "Clique nesta linha para agendar") + "</div>";
    });
    let deps = "";
    const idx = {}; rs.forEach(function (r, i) { idx[r.it.id] = i; });
    rs.forEach(function (r, i) {
      Object.keys(r.it.deps || {}).forEach(function (pid) {
        if (idx[pid] === undefined) return;
        const p = data.items[pid], sa = span(Object.assign({ id: pid }, p)), sb = span(r.it); if (!sa || !sb) return;
        const x1 = x(sa.e + DAY), y1 = idx[pid] * RH + RH / 2, x2 = x(sb.s), y2 = i * RH + RH / 2, mid = x1 + 10;
        const bad = r.it.type === "milestone" ? sb.s < sa.e : sb.s < sa.e + DAY;
        deps += '<path class="dep' + (bad ? " bad" : "") + '" d="M' + x1 + " " + y1 + " H" + mid + " V" + y2 + " H" + (x2 - 2) + '" marker-end="url(#arr' + (bad ? "b" : "") + ')"/>';
      });
    });
    const H = Math.max(rs.length * RH + 120, 260), HH = hasMk ? 84 : 58;
    const addBtns = canEdit ? '<span class="tl-add">' + (method().types.indexOf("initiative") >= 0 ? '<button class="pl-btn sm" data-addtop="initiative" title="' + esc(TYPES.initiative.desc) + '">' + TYPES.initiative.icon + " <span>" + esc(TYPES.initiative.name) + "</span></button>" : "") + '<button class="pl-btn sm" data-addtop="' + (method().types.indexOf("epic") >= 0 ? "epic" : "phase") + '">' + (method().types.indexOf("epic") >= 0 ? TYPES.epic.icon + " <span>" + esc(TYPES.epic.name) + "</span>" : TYPES.phase.icon + " <span>" + esc(TYPES.phase.name) + "</span>") + "</button></span>" : "";
    v.innerHTML = '<div class="tl ' + density + '"><div class="tl-left" style="width:' + lw + 'px"><div class="tl-lh" style="height:' + HH + 'px"><b>' + L("Items", "Itens") + " <small>" + rs.length + "</small></b>" + addBtns + '</div><div class="tl-lb" id="tlLeft">' + left +
      (rs.length ? "" : '<div class="pl-empty">' + L("Nothing here yet.", "Ainda não há nada aqui.") + "</div>") + '<div style="height:120px"></div></div><div class="tl-split" id="tlSplit" title="' + L("Drag to resize", "Arraste para ajustar") + '"></div></div>' +
      '<div class="tl-right" id="tlRight"><div class="tl-head" style="width:' + W + "px;height:" + HH + 'px"><div class="h1">' + H$.h1 + '</div><div class="h2">' + H$.h2 + "</div>" + (hasMk ? '<div class="h3">' + mk + "</div>" : "") + "</div>" +
      '<div class="tl-body" id="tlBody" style="width:' + W + "px;height:" + H + 'px">' + H$.grid +
      rs.map(function (r, i) { return '<div class="tl-band' + (i % 2 ? " odd" : "") + (isContainer(r.it) ? " cont" : "") + '" data-band="' + r.it.id + '" style="top:' + i * RH + "px;height:" + RH + 'px"></div>'; }).join("") +
      '<svg class="deps" width="' + W + '" height="' + H + '"><defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8z" fill="#8a94a6"/></marker><marker id="arrb" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8z" fill="#e5484d"/></marker></defs>' + deps + "</svg>" +
      bars + '<div class="today" style="left:' + tx + 'px"></div></div><div class="today-tag" style="left:' + tx + 'px;top:' + (HH - 18) + 'px">' + L("Today", "Hoje") + "</div></div></div>";
    const left$ = document.getElementById("tlLeft"), right$ = document.getElementById("tlRight");
    right$.onscroll = function () { left$.scrollTop = right$.scrollTop; };
    left$.onwheel = function (e) { right$.scrollTop += e.deltaY; e.preventDefault(); };
    right$.addEventListener("wheel", function (e) {
      if (!e.ctrlKey && !e.metaKey) return; e.preventDefault();
      const rect = right$.getBoundingClientRect(), at = R.lo + (right$.scrollLeft + e.clientX - rect.left) / R.px * DAY;
      const npx = Math.max(0.5, Math.min(120, pxDay() * (e.deltaY < 0 ? 1.15 : 1 / 1.15))), u = gran(npx);
      tlAnchor = at; tlAnchorX = e.clientX - rect.left; zoom = { unit: u, k: npx / ZBASE[u] }; lsSet("cmcollab:plzoom", JSON.stringify(zoom)); clearTimeout(timeline._zt); timeline._zt = setTimeout(shell, 60);
    }, { passive: false });
    v.querySelectorAll("[data-tw]").forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); collapsed[b.dataset.tw] = !collapsed[b.dataset.tw]; renderView(); }; });
    v.querySelectorAll("[data-kbo]").forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); const o = kbOpt(); o.epic = b.dataset.kbo; kbSave(o); if (method().views.indexOf("board") < 0) return; view = "board"; shell(); }; });
    v.querySelectorAll("[data-addc]").forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); const p = data.items[b.dataset.addc]; collapsed[b.dataset.addc] = false; const ct = childType(p); createItem({ type: ct, parent: b.dataset.addc, title: TYPES[ct].name }).then(function (id) { if (id) openDrawer(id, true); }); }; });
    v.querySelectorAll(".tl-row").forEach(function (r) { r.onclick = function () { openDrawer(r.dataset.open); }; });
    v.querySelectorAll(".mk-ms").forEach(function (m) { m.onclick = function () { openDrawer(m.dataset.open); }; });
    v.querySelectorAll("[data-addtop]").forEach(function (b) { b.onclick = function () { quickCreate(b.dataset.addtop); }; });
    const sp$ = document.getElementById("tlSplit");
    if (sp$ && !MOB) sp$.onpointerdown = function (e) {
      const x0 = e.clientX, w0 = lw, lp = v.querySelector(".tl-left"); sp$.setPointerCapture(e.pointerId);
      sp$.onpointermove = function (ev) { leftW = Math.max(220, Math.min(620, w0 + ev.clientX - x0)); lp.style.width = leftW + "px"; };
      sp$.onpointerup = function () { sp$.onpointermove = null; lsSet("cmcollab:plleft", leftW); };
    };
    const body = document.getElementById("tlBody");
    body.addEventListener("mousemove", function (e) { const t = e.target.closest("[data-tip]"); if (t && !dragging) tip(e, t.dataset.tip, true); else if (!dragging) tip(null); });
    body.addEventListener("mouseleave", function () { if (!dragging) tip(null); });
    if (canEdit) bindBars(v, R, RH);
    v.querySelectorAll("[data-bar]").forEach(function (b) { b.addEventListener("dblclick", function () { openDrawer(b.dataset.bar); }); });
    if (tlAnchor) { right$.scrollLeft = Math.max(0, x(tlAnchor) - (tlAnchorX != null ? tlAnchorX : right$.clientWidth / 2)); if (keep) right$.scrollTop = keep.t; tlAnchor = null; tlAnchorX = null; }
    else if (keep) { right$.scrollLeft = keep.l; right$.scrollTop = keep.t; }
    else scrollToday(false);
  }
  let tlAnchorX = null;
  function scrollToday(smooth) {
    const r = document.getElementById("tlRight"), R = timeline._R; if (!r || !R) return;
    r.scrollTo({ left: Math.max(0, (d2n(today()) - R.lo) / DAY * R.px - r.clientWidth * 0.25), behavior: smooth ? "smooth" : "auto" });
  }
  function bindBars(v, R, RH) {
    const body = document.getElementById("tlBody");
    body.addEventListener("pointerdown", function (e) {
      const bar = e.target.closest("[data-bar]");
      if (!bar) {
        const band = e.target.closest("[data-band]"); if (!band) return;
        const it = data.items[band.dataset.band]; if (!it || it.start) return;
        const rect = body.getBoundingClientRect(), d = R.lo + Math.floor((e.clientX - rect.left) / R.px) * DAY;
        const len = it.type === "milestone" ? 0 : (isContainer(it) ? 27 : 6);
        patch(band.dataset.band, { start: n2d(d), end: n2d(d + len * DAY) });
        return;
      }
      const id = bar.dataset.bar, it = data.items[id]; if (!it || !it.start) { openDrawer(id); return; }
      const mode = e.target.dataset.h || "move", x0 = e.clientX, s0 = d2n(it.start), e0 = d2n(it.end || it.start);
      const left0 = bar.offsetLeft, w0 = bar.offsetWidth;
      let dd = 0, moved = false;
      dragging = true; bar.setPointerCapture(e.pointerId); bar.classList.add("drag");
      function mv(ev) {
        dd = Math.round((ev.clientX - x0) / R.px); if (Math.abs(ev.clientX - x0) > 3) moved = true;
        if (mode === "move") bar.style.left = left0 + dd * R.px + "px";
        else if (mode === "l") { const k = Math.min(dd, (e0 - s0) / DAY); bar.style.left = left0 + k * R.px + "px"; bar.style.width = w0 - k * R.px + "px"; }
        else { const k = Math.max(dd, -(e0 - s0) / DAY); bar.style.width = w0 + k * R.px + "px"; }
        if (bar.classList.contains("ms")) bar.style.left = left0 + dd * R.px + "px";
        tip(ev, mode === "r" ? fmt(n2d(e0 + dd * DAY)) : fmt(n2d(s0 + (mode === "l" ? Math.min(dd, (e0 - s0) / DAY) : dd) * DAY)) + (mode === "move" ? " → " + fmt(n2d(e0 + dd * DAY)) : ""));
      }
      function up() {
        bar.removeEventListener("pointermove", mv); bar.removeEventListener("pointerup", up); bar.removeEventListener("pointercancel", up);
        dragging = false; tip(null); bar.classList.remove("drag");
        if (!moved) { openDrawer(id); if (pending) { pending = false; renderView(); } return; }
        let ns = s0, ne = e0;
        if (mode === "move") { ns += dd * DAY; ne += dd * DAY; } else if (mode === "l") ns = Math.min(s0 + dd * DAY, e0); else ne = Math.max(e0 + dd * DAY, s0);
        pending = false;
        patch(id, { start: n2d(ns), end: n2d(ne) });
      }
      bar.addEventListener("pointermove", mv); bar.addEventListener("pointerup", up); bar.addEventListener("pointercancel", up);
      e.preventDefault();
    });
  }
  function tip(ev, txt, below) {
    let t = document.getElementById("pltip");
    if (!ev) { if (t) t.remove(); return; }
    if (!t) { t = document.createElement("div"); t.id = "pltip"; t.className = "pl-tip"; document.body.appendChild(t); }
    t.textContent = txt;
    const w = t.offsetWidth || 200;
    t.style.left = Math.min(window.innerWidth - w - 8, ev.clientX + 14) + "px"; t.style.top = (below ? ev.clientY + 18 : ev.clientY - 30) + "px";
  }

  /* ---------------- board (Kanban / sprint board) ---------------- */
  function activeSprint() { const ss = data.sprints || {}; return Object.keys(ss).find(function (k) { return ss[k].state === "active"; }); }
  /* ---------------- boards: several boards per planning, each a view of the same work and the same roadmap ----------------
   kinds: basic (fixed To do / In progress / Done), flow (the whole workflow – Kanbanize style when it has upstream +
   downstream), up (discovery only, hands over to delivery), down (delivery only, pulls what is ready upstream),
   scrum (active sprint). */
  const BK = {
    basic: { icon: "list", name: L("Basic board", "Quadro básico"), tag: L("Fixed · To do → In progress → Done", "Fixo · A fazer → Em andamento → Concluído") },
    flow: { icon: "kanban", name: L("Workflow board", "Quadro do fluxo"), tag: L("All workflow columns", "Todas as colunas do fluxo") },
    up: { icon: "objective", name: L("Upstream board", "Quadro upstream"), tag: L("Discovery · hands over to delivery", "Descoberta · entrega para o downstream") },
    down: { icon: "send", name: L("Downstream board", "Quadro downstream"), tag: L("Delivery · pulls what is ready upstream", "Entrega · puxa o que está pronto no upstream") },
    scrum: { icon: "sprint", name: L("Sprint board (Scrum)", "Quadro da sprint (Scrum)"), tag: L("Active sprint · delivery columns", "Sprint ativa · colunas de entrega") },
    custom: { icon: "settings", name: L("Custom flow", "Fluxo personalizado"), tag: L("Your own columns and WIP limits", "Suas colunas e limites de WIP") }
  };
  function staged() { return statuses().some(function (s) { return s.stage === "up"; }) && statuses().some(function (s) { return s.stage !== "up"; }); }
  function boardsList() {
    const b = data.settings && data.settings.boards;
    if (b && b.length) return b;
    const out = [];
    if (info.method === "scrum") out.push({ id: "scrum", kind: "scrum" });
    if (staged()) out.push({ id: "flow", kind: "flow" }, { id: "up", kind: "up" }, { id: "down", kind: "down" });
    else if (info.method !== "scrum") out.push({ id: "flow", kind: "flow" });
    out.push({ id: "basic", kind: "basic" });
    return out;
  }
  function boardName(b) { return b.name || (b.kind === "flow" && staged() ? L("Upstream + downstream (Kanbanize)", "Upstream + downstream (Kanbanize)") : (BK[b.kind] || BK.flow).name); }
  function boardTag(b) {
    if (b.kind === "flow") return staged() ? L("Discovery → delivery, connected", "Descoberta → entrega, conectados") : statuses().map(function (x) { return x.name; }).slice(0, 4).join(" → ") + (statuses().length > 4 ? " …" : "");
    return (BK[b.kind] || BK.flow).tag;
  }
  function upSS() { return statuses().filter(function (x) { return x.stage === "up"; }); }
  function downSS() { const st = staged(); return statuses().filter(function (x) { return !st || x.stage !== "up"; }); }
  function firstOfCat(c) { const d = downSS(); return (d.find(function (x) { return x.cat === c; }) || d[0] || statuses()[0]).id; }
  function colSpecs(kind, B) {
    const spec = function (x) { return { key: x.id, name: x.name, color: stColor(x), wip: x.wip, stage: x.stage, target: x.id, match: function (i) { return statusOf(i).id === x.id; } }; };
    if (kind === "custom") {
      const SS = {}; statuses().forEach(function (x) { SS[x.id] = x; });
      const cols = ((B && B.cols) || []).filter(function (c) { return SS[c.st]; });
      return cols.length ? cols.map(function (c) { const o = spec(SS[c.st]); o.key = "c_" + c.st; if (c.name) o.name = c.name; o.wip = Number(c.wip) || null; return o; }) : null;
    }
    if (kind === "basic") {
      const up = {}; upSS().forEach(function (x) { up[x.id] = 1; });
      return [["todo", L("To do", "A fazer")], ["doing", L("In progress", "Em andamento")], ["done", L("Done", "Concluído")]].map(function (c) {
        return { key: "_" + c[0], name: c[1], color: CATC[c[0]], target: firstOfCat(c[0]), match: function (i) { return !up[statusOf(i).id] && cat(i) === c[0]; } };
      });
    }
    if (kind === "up") {
      const u = upSS(), d = downSS();
      if (!u.length) return null;
      return u.map(spec).concat(d.length ? [{ key: "_handoff", name: L("→ Delivery (downstream)", "→ Entrega (downstream)"), cls: "handoff", color: "#2CC4B3", target: d[0].id, match: function () { return false; }, note: L("Drop here when the idea is committed: it enters the downstream board.", "Solte aqui quando a ideia for comprometida: ela entra no quadro downstream.") }] : []);
    }
    if (kind === "down" || kind === "scrum") {
      const u = upSS(), d = downSS().map(spec);
      if (kind === "down" && u.length) { const last = u[u.length - 1]; d.unshift({ key: "_pull", name: L("Ready upstream", "Pronto no upstream") + " · " + last.name, cls: "pull", color: "#E8C468", target: last.id, match: function (i) { return statusOf(i).id === last.id; }, note: L("Pull into delivery when there is capacity.", "Puxe para a entrega quando houver capacidade.") }); }
      return d;
    }
    return statuses().map(spec);
  }
  /* custom flow: the team chooses the columns (existing workflow statuses or new ones) and the WIP limit of each */
  function colEditor(host, cols) {
    let rows = (cols && cols.length ? cols : downSS().map(function (x) { return { st: x.id, wip: x.wip || "" }; })).map(function (c) { return Object.assign({}, c); });
    const CATS = [["todo", L("To do", "A fazer")], ["doing", L("In progress", "Em andamento")], ["done", L("Done", "Concluído")]];
    function draw() {
      host.innerHTML = '<div class="ce-head"><span>' + L("Column", "Coluna") + "</span><span>" + L("Status / type", "Status / tipo") + "</span><span>WIP</span><span></span></div>" + rows.map(function (r, i) {
        const SS = statuses();
        return '<div class="ce-row" data-i="' + i + '"><input data-k="name" maxlength="40" placeholder="' + esc((SS.find(function (x) { return x.id === r.st; }) || {}).name || L("New column", "Nova coluna")) + '" value="' + esc(r.name || "") + '">' +
          '<select data-k="st">' + SS.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === r.st ? " selected" : "") + ">" + esc(x.name) + "</option>"; }).join("") + CATS.map(function (c) { return '<option value="new:' + c[0] + '"' + (r.st === "new:" + c[0] ? " selected" : "") + ">＋ " + L("new · ", "nova · ") + esc(c[1]) + "</option>"; }).join("") + "</select>" +
          '<input data-k="wip" type="number" min="0" placeholder="–" value="' + esc(r.wip || "") + '"><span class="ce-b"><button type="button" data-mv="-1" title="' + L("Move up", "Subir") + '">↑</button><button type="button" data-mv="1" title="' + L("Move down", "Descer") + '">↓</button><button type="button" data-rm title="' + L("Remove", "Remover") + '">✕</button></span></div>';
      }).join("") + '<button type="button" class="pl-btn sm" data-addc>＋ ' + L("Add column", "Adicionar coluna") + "</button>";
      host.querySelectorAll(".ce-row").forEach(function (row) {
        const i = Number(row.dataset.i);
        row.querySelectorAll("[data-k]").forEach(function (inp) { inp.oninput = inp.onchange = function () { rows[i][inp.dataset.k] = inp.value; }; });
        row.querySelector("[data-rm]").onclick = function () { rows.splice(i, 1); draw(); };
        row.querySelectorAll("[data-mv]").forEach(function (b) { b.onclick = function () { const j = i + Number(b.dataset.mv); if (j < 0 || j >= rows.length) return; const t = rows[i]; rows[i] = rows[j]; rows[j] = t; draw(); }; });
      });
      host.querySelector("[data-addc]").onclick = function () { rows.push({ st: "new:doing", name: "", wip: "" }); draw(); };
    }
    draw();
    return function () { /* → { cols, newStatuses } */
      const ns = [], cols = [];
      rows.forEach(function (r) {
        let st = r.st;
        if (/^new:/.test(st)) { const nm = (r.name || "").trim() || L("New column", "Nova coluna"); st = nm.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20) + "-" + Math.random().toString(36).slice(2, 5); ns.push({ id: st, name: nm, cat: r.st.slice(4) }); }
        const c = { st: st }; if ((r.name || "").trim()) c.name = r.name.trim(); if (Number(r.wip) > 0) c.wip = Number(r.wip); cols.push(c);
      });
      return { cols: cols, newStatuses: ns };
    };
  }
  function packBoards(list) { return list.map(function (x) { const o = { id: x.id, kind: x.kind }; if (x.name) o.name = x.name; if (x.cols) o.cols = x.cols; return o; }); }
  function addBoardDialog() {
    const kinds = ["down", "up", "flow", "custom", "scrum", "basic"];
    modal("<h2>" + L("Add board", "Adicionar quadro") + '</h2><p class="muted small">' + L("All boards show the same items and stay connected to the roadmap – each one is a different view of the workflow.", "Todos os quadros mostram os mesmos itens e ficam conectados ao roadmap – cada um é uma visão diferente do fluxo.") + '</p><form class="pl-form" id="abF"><div class="ab-kinds">' + kinds.map(function (k, n) { return '<label class="ab-k"><input type="radio" name="kind" value="' + k + '"' + (n === 0 ? " checked" : "") + "><span>" + (window.CMIcon3D ? window.CMIcon3D(BK[k].icon, 24, ["teal", "blue", "violet", "coral", "gold"][n % 5]) : IC(BK[k].icon, 18)) + "</span><b>" + esc(BK[k].name) + "</b><small>" + esc(BK[k].tag) + "</small></label>"; }).join("") + "</div>" +
      '<div class="ce" id="abCols" hidden></div>' +
      "<label>" + L("Name (optional)", "Nome (opcional)") + '<input name="name" maxlength="60" autocomplete="off"></label><p class="muted small" id="abNote"></p><div class="pl-row-end"><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + L("Add board", "Adicionar quadro") + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#abF"), note = box.querySelector("#abNote"), ceHost = box.querySelector("#abCols"); let ceGet = null;
      function upd() { const k = f.kind.value; ceHost.hidden = k !== "custom"; if (k === "custom" && !ceGet) ceGet = colEditor(ceHost); note.textContent = (k === "up" || k === "down") && !staged() ? L("Your workflow has no upstream/downstream stages yet: the upstream columns (Ideas, Analysis, Ready to commit) will be added before your current columns.", "Seu fluxo ainda não tem etapas upstream/downstream: as colunas de upstream (Ideias, Análise, Pronto para compromisso) serão incluídas antes das colunas atuais.") : ""; }
      f.querySelectorAll("[name=kind]").forEach(function (r) { r.onchange = upd; }); upd();
      f.onsubmit = function (e) {
        e.preventDefault();
        const k = f.kind.value, list = boardsList().slice(), b = { id: k + "-" + Date.now().toString(36), kind: k };
        if (f.name.value.trim()) b.name = f.name.value.trim();
        const u = {};
        if (k === "custom") { const r = ceGet(); if (!r.cols.length) { toast(L("Add at least one column.", "Adicione ao menos uma coluna.")); return; } b.cols = r.cols; if (r.newStatuses.length) u["settings/statuses"] = statuses().concat(r.newStatuses); }
        list.push(b);
        u["settings/boards"] = packBoards(list);
        if ((k === "up" || k === "down") && !staged()) {
          const W = window.PLAN_WORKFLOWS ? window.PLAN_WORKFLOWS() : {}, ups = ((W.updown || {}).ss || []).filter(function (x) { return x.stage === "up"; });
          const ids = {}; statuses().forEach(function (x) { ids[x.id] = 1; });
          u["settings/statuses"] = ups.filter(function (x) { return !ids[x.id]; }).concat(statuses().map(function (x) { return Object.assign({}, x, { stage: "down" }); }));
        }
        db.ref("planning/" + ID + "/data").update(u).then(function () { close(); const o = kbOpt(); o.board = b.id; kbSave(o); setTimeout(shell, 50); toast(L("Board added", "Quadro adicionado")); }, fail);
      };
    });
  }
  function boardMenu(b) {
    modal("<h2>" + esc(boardName(b)) + '</h2><form class="pl-form" id="bmF"><label>' + L("Name", "Nome") + '<input name="name" maxlength="60" value="' + esc(b.name || "") + '" placeholder="' + esc(boardName(Object.assign({}, b, { name: "" }))) + '"></label>' + (b.kind === "custom" ? "<b>" + L("Columns and WIP", "Colunas e WIP") + '</b><div class="ce" id="bmCols"></div>' : "") + '<div class="pl-row-end">' + (boardsList().length > 1 ? '<button type="button" class="pl-btn danger" id="bmDel">' + L("Remove board", "Remover quadro") + "</button>" : "") + '<span class="sp"></span><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + L("Save", "Salvar") + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#bmF"), ch = box.querySelector("#bmCols"), ceGet = ch ? colEditor(ch, b.cols) : null;
      f.onsubmit = function (e) {
        e.preventDefault(); const u = {}, r = ceGet ? ceGet() : null;
        if (r && !r.cols.length) { toast(L("Add at least one column.", "Adicione ao menos uma coluna.")); return; }
        const list = boardsList().map(function (x) { return x.id === b.id ? Object.assign({}, x, { name: f.name.value.trim() || null }, r ? { cols: r.cols } : {}) : x; });
        if (r && r.newStatuses.length) u["settings/statuses"] = statuses().concat(r.newStatuses);
        u["settings/boards"] = packBoards(list);
        db.ref("planning/" + ID + "/data").update(u).then(function () { close(); setTimeout(shell, 50); }, fail);
      };
      const del = box.querySelector("#bmDel"); if (del) del.onclick = function () { const list = boardsList().filter(function (x) { return x.id !== b.id; }); list.splice(0, list.length, ...packBoards(list)); db.ref("planning/" + ID + "/data/settings/boards").set(list).then(function () { close(); setTimeout(shell, 50); }, fail); };
    });
  }
  function board(v) {
    const kb = kbOpt(), boards = boardsList();
    let B = boards.find(function (b) { return b.id === kb.board; }) || boards[0];
    const side = '<aside class="kb-side"><div class="kb-side-h">' + L("Boards", "Quadros") + "</div>" + boards.map(function (b) {
      return '<button class="kb-bd' + (b.id === B.id ? " on" : "") + '" data-bd="' + esc(b.id) + '"><span class="ic">' + IC((BK[b.kind] || BK.flow).icon, 16) + '</span><span class="t"><b>' + esc(boardName(b)) + "</b><small>" + esc(boardTag(b)) + "</small></span>" + (canEdit ? '<span class="ed" data-bdm="' + esc(b.id) + '" title="' + L("Rename / remove", "Renomear / remover") + '">⋯</span>' : "") + "</button>";
    }).join("") + (canEdit ? '<button class="kb-bd add" id="bdAdd">' + IC("plus", 16) + " " + L("Add board", "Adicionar quadro") + "</button>" : "") +
      '<div class="kb-side-f">' + IC("roadmap", 14) + " " + L("All boards share the same items and roadmap.", "Todos os quadros compartilham os mesmos itens e o roadmap.") + "</div></aside>";
    const sp = activeSprint(), isScrum = B.kind === "scrum";
    let pool = items().filter(function (i) { return !isContainer(i) && i.type !== "milestone" && matches(i); });
    let headNote = "", inner = "";
    if (isScrum) {
      if (!sp) inner = '<div class="pl-empty big"><h2>' + L("No active sprint", "Nenhuma sprint ativa") + "</h2><p>" + L("Start a sprint in the Backlog to see its board.", "Inicie uma sprint no Backlog para ver o quadro dela.") + '</p><button class="pl-btn primary" id="goBl">' + L("Go to Backlog", "Ir para o Backlog") + "</button></div>";
      else {
        const S = data.sprints[sp];
        pool = pool.filter(function (i) { return i.sprint === sp; });
        headNote = '<div class="sp-head"><b>' + esc(S.name) + "</b> · " + fmt(S.start) + " → " + fmt(S.end) + (S.goal ? " · " + esc(S.goal) : "") + (canEdit ? ' <button class="pl-btn sm" id="endSp">' + L("Complete sprint", "Concluir sprint") + "</button>" : "") + "</div>";
      }
    }
    const specs = colSpecs(B.kind, B);
    if (!specs) inner = '<div class="pl-empty big"><h2>' + L("No upstream columns", "Sem colunas de upstream") + "</h2><p>" + L("Choose an upstream workflow in “Workflow”.", "Escolha um fluxo com upstream em “Fluxo”.") + "</p></div>";
    if (specs && !inner) {
      const inBoard = function (i) { return specs.some(function (c) { return c.match(i); }); };
      pool = pool.filter(inBoard);
      /* Jira-style options: swimlanes (none / epic / assignee) and an epic filter */
      const conts = items().filter(function (i) { return i.type === "epic" || i.type === "phase" || i.type === "initiative"; }).sort(byOrder);
      if (kb.epic && !data.items[kb.epic]) kb.epic = "";
      if (kb.epic) pool = pool.filter(function (i) { return underOf(i, kb.epic); });
      const showStages = B.kind === "flow" && staged() && !kb.swim;
      const bar = '<div class="kb-bar">' +
        "<label>" + L("Swimlanes", "Raias") + '<select id="kbSwim"><option value="">' + L("None", "Nenhuma") + '</option><option value="epic"' + (kb.swim === "epic" ? " selected" : "") + ">" + L("By epic / phase", "Por épico / fase") + '</option><option value="who"' + (kb.swim === "who" ? " selected" : "") + ">" + L("By assignee", "Por responsável") + "</option></select></label>" +
        (conts.length ? "<label>" + L("Epic / initiative", "Épico / iniciativa") + '<select id="kbEpic"><option value="">' + L("All", "Todos") + "</option>" + conts.map(function (c) { return '<option value="' + c.id + '"' + (kb.epic === c.id ? " selected" : "") + ">" + esc((TYPES[c.type] || TYPES.epic).name + " · " + (c.key ? c.key + " " : "") + c.title) + "</option>"; }).join("") + "</select></label>" : "") +
        '<span class="muted small">' + pool.length + " " + (pool.length === 1 ? L("card", "cartão") : L("cards", "cartões")) + '</span><span class="sp"></span>' +
        (canEdit && B.kind !== "basic" ? '<button class="pl-btn sm" id="kbFlow">' + IC("settings", 14) + " " + L("Workflow", "Fluxo") + "</button>" : "") +
        '<button class="pl-btn sm ghost" id="kbRoad">' + IC("roadmap", 14) + " " + L("See on the roadmap", "Ver no roadmap") + "</button></div>";
      const cols = function (list, lane, withHead) {
        let lastStage = null, out = "";
        specs.forEach(function (c, si) {
          if (showStages && (c.stage || "") !== lastStage) { out += (lastStage !== null ? "</div></div>" : "") + '<div class="kb-stage st-' + (c.stage || "none") + '"><div class="kb-stage-h">' + (c.stage === "up" ? L("Upstream · discovery", "Upstream · descoberta") : c.stage === "down" ? L("Downstream · delivery", "Downstream · entrega") : "") + '</div><div class="kb-stage-cols">'; lastStage = c.stage || ""; }
          const col = list.filter(c.match).sort(byOrder);
          const all = pool.filter(c.match).length, over = c.wip && all > c.wip;
          out += '<section class="kb-col' + (over ? " over" : "") + (c.cls ? " " + c.cls : "") + (c.stage ? " stg-" + c.stage : "") + '" data-col="' + esc(c.target) + '"' + (lane != null ? ' data-lane="' + esc(lane) + '"' : "") + ">" +
            (withHead ? '<header><span class="dot" style="background:' + c.color + '"></span><b>' + esc(c.name) + "</b>" + (staged() && kb.swim && c.stage && B.kind === "flow" ? '<span class="stg">' + (c.stage === "up" ? "UP" : "DOWN") + "</span>" : "") + '<span class="cnt">' + all + (c.wip ? " / " + c.wip : "") + "</span></header>" + (c.note ? '<p class="kb-note">' + esc(c.note) + "</p>" : "") : "") +
            '<div class="kb-list">' + col.map(card).join("") + "</div>" + (canEdit && si === 0 && !c.cls && (withHead || lane != null) ? '<button class="kb-add" data-add="' + esc(c.target) + '"' + (lane != null ? ' data-lane="' + esc(lane) + '"' : "") + ">+ " + L("Create", "Criar") + "</button>" : "") + "</section>";
        });
        return out + (showStages ? "</div></div>" : "");
      };
      let html;
      if (!kb.swim) html = '<div class="kb' + (showStages ? " staged" : "") + '">' + cols(pool, null, true) + "</div>";
      else {
        const lanes = [];
        if (kb.swim === "epic") {
          conts.filter(function (c) { return c.type !== "initiative" || !conts.some(function (e) { return e.parent === c.id; }); }).forEach(function (c) { lanes.push({ k: c.id, name: (c.key ? c.key + " · " : "") + c.title, color: (TYPES[c.type] || TYPES.epic).color, list: pool.filter(function (i) { return laneOf(i) === c.id; }) }); });
          lanes.push({ k: "", name: L("No epic", "Sem épico"), color: "#8a94a6", list: pool.filter(function (i) { return !laneOf(i); }) });
        } else {
          const who = {}; pool.forEach(function (i) { who[i.assignee || ""] = 1; }); Object.keys(members).forEach(function (k) { who[members[k].email] = who[members[k].email] || 0; });
          Object.keys(who).filter(function (e) { return e; }).sort(function (a, b) { return memberName(a).localeCompare(memberName(b)); }).forEach(function (e) { lanes.push({ k: e, name: memberName(e), color: "#2CC4B3", list: pool.filter(function (i) { return i.assignee === e; }) }); });
          lanes.push({ k: "", name: L("Unassigned", "Sem responsável"), color: "#8a94a6", list: pool.filter(function (i) { return !i.assignee; }) });
        }
        html = '<div class="kb lanes"><div class="kb-row kb-heads">' + cols([], null, true).replace(/<div class="kb-list"><\/div>(<button[^>]*>[^<]*<\/button>)?/g, "") + "</div>" +
          lanes.filter(function (l) { return l.list.length || kb.swim === "epic" && l.k; }).map(function (l) {
            const closed = kb.closed && kb.closed[l.k || "_"];
            return '<div class="kb-lane' + (closed ? " closed" : "") + '"><button class="kb-lane-h" data-lanet="' + esc(l.k || "_") + '" style="--c:' + l.color + '"><span class="tw">' + (closed ? "▸" : "▾") + "</span><b>" + esc(l.name) + '</b><span class="cnt">' + l.list.length + "</span></button>" + (closed ? "" : '<div class="kb-row">' + cols(l.list, l.k, false) + "</div>") + "</div>";
          }).join("") + "</div>";
      }
      inner = bar + html;
    }
    v.innerHTML = '<div class="kb-wrap">' + side + '<div class="kb-main">' + headNote + inner + "</div></div>";
    v.querySelectorAll("[data-bd]").forEach(function (b) { b.onclick = function (e) { if (e.target.closest("[data-bdm]")) return; kb.board = b.dataset.bd; kbSave(kb); renderView(); }; });
    v.querySelectorAll("[data-bdm]").forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); boardMenu(boards.find(function (x) { return x.id === b.dataset.bdm; })); }; });
    const ba = document.getElementById("bdAdd"); if (ba) ba.onclick = addBoardDialog;
    const gb = document.getElementById("goBl"); if (gb) gb.onclick = function () { view = "backlog"; shell(); };
    v.querySelectorAll(".kb-card").forEach(function (c) { c.onclick = function () { openDrawer(c.dataset.id); }; });
    v.querySelectorAll("[data-add]").forEach(function (b) {
      b.onclick = function () {
        const base = { status: b.dataset.add, sprint: isScrum ? sp : undefined };
        if (b.dataset.lane != null) { if (kb.swim === "epic") base.parent = b.dataset.lane || undefined; else if (kb.swim === "who") base.assignee = b.dataset.lane || undefined; }
        else if (kb.epic) base.parent = kb.epic;
        inlineAdd(b, base);
      };
    });
    v.querySelectorAll("[data-lanet]").forEach(function (b) { b.onclick = function () { const k = b.dataset.lanet; kb.closed = kb.closed || {}; kb.closed[k] = !kb.closed[k]; kbSave(kb); renderView(); }; });
    const sw = document.getElementById("kbSwim"); if (sw) sw.onchange = function () { kb.swim = sw.value; kbSave(kb); renderView(); };
    const ep = document.getElementById("kbEpic"); if (ep) ep.onchange = function () { kb.epic = ep.value; kbSave(kb); renderView(); };
    const fl = document.getElementById("kbFlow"); if (fl) fl.onclick = workflowDialog;
    const rd = document.getElementById("kbRoad"); if (rd) rd.onclick = function () { view = "timeline"; if (kb.epic) collapsed[kb.epic] = false; shell(); };
    const es = document.getElementById("endSp"); if (es) es.onclick = function () { completeSprint(sp); };
    if (canEdit && specs) dnd(v, ".kb-card", ".kb-col", function (id, col, beforeId) {
      const list = items().filter(function (i) { return statusOf(i).id === col.dataset.col && i.id !== id; }).sort(byOrder);
      const o = { order: orderAt(list, beforeId) };
      if ((data.items[id] || {}).status !== col.dataset.col) o.status = col.dataset.col;
      const st = statuses().find(function (x) { return x.id === col.dataset.col; });
      if (st && st.cat === "done") o.progress = 100;
      if (isScrum && sp) o.sprint = sp;
      const it = data.items[id] || {};
      if (col.dataset.lane != null) {
        if (kb.swim === "epic" && col.dataset.lane !== (laneOf(Object.assign({ id: id }, it)) || "")) o.parent = col.dataset.lane || null;
        if (kb.swim === "who" && col.dataset.lane !== (it.assignee || "")) o.assignee = col.dataset.lane || null;
      }
      patch(id, o);
      if (col.classList.contains("handoff")) toast(L("Committed: it is now on the downstream board", "Comprometido: agora está no quadro downstream"));
    });
  }
  /* ---------------- reports & indicators (Jira overview + sprint / capacity dashboard) ---------------- */
  const RPAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
  let rpt = { sprint: "", type: "", status: "", who: "", epic: "", unit: "sp" };
  function nf(n, d) { return (Number(n) || 0).toLocaleString(window.MB_LOCALE || (PT ? "pt-BR" : "en-GB"), { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 }); }
  function cnum(n) { n = Number(n) || 0; if (Math.abs(n) < 10000) return nf(n); try { return new Intl.NumberFormat(window.MB_LOCALE || (PT ? "pt-BR" : "en-GB"), { notation: "compact", maximumFractionDigits: 1 }).format(n); } catch (e) { return nf(n); } }
  function pct(a, b) { return b ? nf(a / b * 100, 1) + "%" : "–"; }
  function donut(rows, total, label) {
    const R = 54, C = 2 * Math.PI * R; let off = 0;
    const segs = rows.filter(function (r) { return r.v > 0; }).map(function (r) {
      const len = total ? r.v / total * C : 0, gap = rows.length > 1 ? Math.min(2, len / 3) : 0;
      const el = '<circle r="' + R + '" cx="70" cy="70" fill="none" stroke="' + r.c + '" stroke-width="18" stroke-dasharray="' + Math.max(0, len - gap) + " " + (C - Math.max(0, len - gap)) + '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 70 70)"><title>' + esc(r.n) + ": " + r.v + " (" + pct(r.v, total) + ")</title></circle>";
      off += len; return el;
    }).join("");
    return '<div class="rp-donut"><svg viewBox="0 0 140 140" role="img" aria-label="' + esc(label) + '"><circle r="' + R + '" cx="70" cy="70" fill="none" stroke="#eef1f6" stroke-width="18"/>' + segs + '<text x="70" y="68" text-anchor="middle" class="rp-big">' + total + '</text><text x="70" y="86" text-anchor="middle" class="rp-sm">' + esc(L("items", "itens")) + "</text></svg>" +
      '<ul class="rp-leg">' + rows.filter(function (r) { return r.v > 0; }).map(function (r) { return '<li><i style="background:' + r.c + '"></i><span>' + esc(r.n) + "</span><b>" + r.v + "</b></li>"; }).join("") + "</ul></div>";
  }
  function bars(groups, series, unitLbl) { /* grouped vertical bars, one axis */
    const max = Math.max(1, Math.max.apply(null, groups.map(function (g) { return Math.max.apply(null, series.map(function (s) { return g[s.k] || 0; })); })));
    const W = Math.max(320, groups.length * (series.length * 16 + 26) + 56), H = 210, bw = 14, top = 24, base = H - 30;
    let out = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" class="rp-bars" role="img" aria-label="' + esc(unitLbl) + '">';
    [0, .5, 1].forEach(function (t) { const y = base - (base - top) * t; out += '<line x1="46" x2="' + (W - 6) + '" y1="' + y + '" y2="' + y + '" class="rp-grid"/><text x="42" y="' + (y + 4) + '" text-anchor="end" class="rp-ax">' + cnum(max * t) + "</text>"; });
    groups.forEach(function (g, gi) {
      const gx = 56 + gi * (series.length * 16 + 26);
      series.forEach(function (s, si) {
        const v = g[s.k] || 0, h = (base - top) * v / max, x = gx + si * 16, y = base - h;
        out += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(h, 0) + '" rx="3" fill="' + s.c + '"><title>' + esc(g.n + " · " + s.n + ": " + nf(v, 0)) + "</title></rect>";
        if (h > 14) out += '<text x="' + (x + bw / 2) + '" y="' + (y - 3) + '" text-anchor="middle" class="rp-val">' + cnum(v) + "</text>";
      });
      out += '<text x="' + (gx + series.length * 8) + '" y="' + (H - 12) + '" text-anchor="middle" class="rp-ax">' + esc(g.n.length > 12 ? g.n.slice(0, 11) + "…" : g.n) + "</text>";
    });
    return out + '</svg><div class="rp-leg row">' + series.map(function (s) { return '<span><i style="background:' + s.c + '"></i>' + esc(s.n) + "</span>"; }).join("") + "</div>";
  }
  function hstack(rows, a, b, la, lb) { /* horizontal stacked: delivered + remaining */
    const max = Math.max(1, Math.max.apply(null, rows.map(function (r) { return r[a] + r[b]; })));
    return '<div class="rp-hs">' + rows.map(function (r) {
      const wa = r[a] / max * 100, wb = r[b] / max * 100;
      return '<div class="rp-hr"><span class="n" title="' + esc(r.n) + '">' + esc(r.n) + '</span><span class="tr"><i class="a" style="width:' + wa + '%" title="' + esc(la + ": " + nf(r[a])) + '">' + (wa > 8 ? nf(r[a]) : "") + '</i><i class="b" style="width:' + wb + '%" title="' + esc(lb + ": " + nf(r[b])) + '">' + (wb > 8 ? nf(r[b]) : "") + "</i></span></div>";
    }).join("") + '<div class="rp-leg row"><span><i class="a"></i>' + esc(la) + '</span><span><i class="b"></i>' + esc(lb) + "</span></div></div>";
  }

  /* ---------------- Indicators (own KPIs) – parametrisable per planning; default tab for Occupational health and SHE ----------------
     data.kpis/<k>  = { name, unit, kind: value|percent|rate, a, b, factor, dir: up|down, target, dec, desc, order }
     data.kpiv/<k>/<YYYY-MM> = { a, b }     value = a · percent = a / b × 100 · rate = a × factor / b */
  function kpiOn() {
    const st = data.settings || {};
    if (st.kpiTab === false) return false;
    return st.kpiTab === true || info.area === "ohs" || info.area === "she" || Object.keys(data.kpis || {}).length > 0;
  }
  function KPI_LIB() {
    const HHT = L("Hours worked (man-hours)", "Horas-homem trabalhadas (HHT)");
    return [
      { id: "tf", g: "sst", name: L("Accident frequency rate (FR)", "Taxa de frequência de acidentes (TF)"), kind: "rate", a: L("Lost-time accidents", "Acidentes com afastamento"), b: HHT, factor: 1000000, unit: "", dir: "down", target: 1.5, dec: 2, desc: L("Lost-time accidents × 1,000,000 ÷ man-hours worked.", "Acidentes com afastamento × 1.000.000 ÷ horas-homem trabalhadas.") },
      { id: "tg", g: "sst", name: L("Accident severity rate (SR)", "Taxa de gravidade (TG)"), kind: "rate", a: L("Days lost and charged", "Dias perdidos e debitados"), b: HHT, factor: 1000000, unit: "", dir: "down", target: 50, dec: 0, desc: L("Days lost × 1,000,000 ÷ man-hours worked.", "Dias perdidos × 1.000.000 ÷ horas-homem trabalhadas.") },
      { id: "abs", g: "ohs", name: L("Absenteeism", "Absenteísmo"), kind: "percent", a: L("Hours absent", "Horas de ausência"), b: L("Scheduled hours", "Horas previstas"), unit: "%", dir: "down", target: 2.5, dec: 1, desc: L("Hours absent ÷ scheduled hours × 100.", "Horas de ausência ÷ horas previstas × 100.") },
      { id: "exam", g: "ohs", name: L("Periodic exams up to date", "Exames periódicos em dia"), kind: "percent", a: L("Exams up to date", "Exames em dia"), b: L("Exams due", "Exames previstos"), unit: "%", dir: "up", target: 95, dec: 1 },
      { id: "mental", g: "ohs", name: L("Absences for mental health", "Afastamentos por saúde mental"), kind: "value", a: L("Absences", "Afastamentos"), unit: "", dir: "down", target: 3, dec: 0 },
      { id: "train", g: "sst", name: L("Mandatory safety training done", "Treinamentos obrigatórios (NR) realizados"), kind: "percent", a: L("People trained", "Pessoas treinadas"), b: L("People who must be trained", "Pessoas que precisam do treinamento"), unit: "%", dir: "up", target: 90, dec: 1 },
      { id: "near", g: "sst", name: L("Near misses reported", "Quase-acidentes reportados"), kind: "value", a: L("Reports", "Relatos"), unit: "", dir: "up", target: 20, dec: 0, desc: L("More reports mean a stronger safety culture.", "Mais relatos indicam uma cultura de segurança mais forte.") },
      { id: "days", g: "sst", name: L("Days without lost-time accidents", "Dias sem acidente com afastamento"), kind: "value", a: L("Days", "Dias"), unit: L("days", "dias"), dir: "up", target: 365, dec: 0 },
      { id: "recy", g: "env", name: L("Waste recycled", "Resíduos reciclados"), kind: "percent", a: L("Recycled waste (t)", "Resíduos reciclados (t)"), b: L("Total waste (t)", "Resíduos totais (t)"), unit: "%", dir: "up", target: 70, dec: 1 },
      { id: "water", g: "env", name: L("Water consumption", "Consumo de água"), kind: "value", a: "m³", unit: "m³", dir: "down", target: 1200, dec: 0 },
      { id: "co2", g: "env", name: L("Emissions (CO₂e)", "Emissões (CO₂e)"), kind: "value", a: L("Tonnes of CO₂e", "Toneladas de CO₂e"), unit: "t", dir: "down", target: 80, dec: 1 }
    ];
  }
  function kpis() { const o = data.kpis || {}; return Object.keys(o).map(function (k) { return Object.assign({ id: k }, o[k]); }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); }); }
  function kpiVal(k, v) {
    if (!v || v.a === undefined || v.a === null || v.a === "") return null;
    const a = Number(v.a), b = Number(v.b);
    if (k.kind === "percent") return b ? a / b * 100 : null;
    if (k.kind === "rate") return b ? a * (Number(k.factor) || 1) / b : null;
    return a;
  }
  function kpiSeries(k) { const vv = (data.kpiv || {})[k.id] || {}; return Object.keys(vv).sort().map(function (p) { return { p: p, v: kpiVal(k, vv[p]), raw: vv[p] }; }).filter(function (x) { return x.v !== null && isFinite(x.v); }); }
  function kpiOk(k, v) { if (v === null || k.target === undefined || k.target === null || k.target === "") return null; return k.dir === "down" ? v <= Number(k.target) : v >= Number(k.target); }
  function perLabel(p) { const d = new Date(p + "-01T12:00:00Z"); return d.toLocaleDateString(window.MB_LOCALE || (PT ? "pt-BR" : "en-GB"), { month: "short", year: "2-digit", timeZone: "UTC" }); }
  function kpiChart(k, ser) {
    const pts = ser.slice(-12); if (!pts.length) return '<div class="kp-empty">' + L("No values yet – use “Enter values”.", "Ainda sem valores – use “Lançar valores”.") + "</div>";
    const W = 300, H = 110, l = 34, r = 8, t = 12, b = 22, tg = Number(k.target);
    const vals = pts.map(function (x) { return x.v; }).concat(isFinite(tg) && k.target !== "" && k.target !== undefined ? [tg] : []);
    let mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals); if (mn === mx) { mn -= 1; mx += 1; } const pad = (mx - mn) * .12; mn = Math.max(k.kind === "percent" || mn >= 0 ? 0 : mn - pad, mn - pad); mx += pad;
    const X = function (i) { return l + (pts.length === 1 ? (W - l - r) / 2 : i * (W - l - r) / (pts.length - 1)); }, Y = function (v) { return t + (H - t - b) * (1 - (v - mn) / (mx - mn)); };
    let o = '<svg viewBox="0 0 ' + W + " " + H + '" class="kp-chart" role="img" aria-label="' + esc(k.name) + '">';
    [mn, (mn + mx) / 2, mx].forEach(function (g) { o += '<line x1="' + l + '" x2="' + (W - r) + '" y1="' + Y(g) + '" y2="' + Y(g) + '" class="kp-grid"/><text x="' + (l - 4) + '" y="' + (Y(g) + 3) + '" text-anchor="end" class="kp-ax">' + nf(g, g < 10 && k.dec ? 1 : 0) + "</text>"; });
    if (isFinite(tg) && k.target !== "" && k.target !== undefined) o += '<line x1="' + l + '" x2="' + (W - r) + '" y1="' + Y(tg) + '" y2="' + Y(tg) + '" class="kp-target"/><text x="' + (W - r) + '" y="' + (Y(tg) - 3) + '" text-anchor="end" class="kp-tl">' + esc(L("target ", "meta ") + nf(tg, k.dec || 0)) + "</text>";
    o += '<polyline fill="none" class="kp-line" points="' + pts.map(function (x, i) { return X(i) + "," + Y(x.v); }).join(" ") + '"/>';
    pts.forEach(function (x, i) { const ok = kpiOk(k, x.v); o += '<circle cx="' + X(i) + '" cy="' + Y(x.v) + '" r="4" class="kp-dot' + (ok === false ? " off" : "") + '"><title>' + esc(perLabel(x.p) + ": " + nf(x.v, k.dec || 0) + (k.unit ? " " + k.unit : "")) + "</title></circle>"; });
    [0, pts.length - 1].filter(function (i, j, a) { return a.indexOf(i) === j; }).forEach(function (i) { o += '<text x="' + X(i) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 && pts.length > 1 ? "start" : "end") + '" class="kp-ax">' + esc(perLabel(pts[i].p)) + "</text>"; });
    return o + "</svg>";
  }
  function kpiView(v) {
    const list = kpis();
    let h = '<div class="kp-head"><div><h2>' + L("Indicators", "Indicadores") + '</h2><p class="muted small">' + L("Create your own indicators – value, percentage or rate with a multiplier (e.g. accidents × 1,000,000 ÷ man-hours) – set the target and enter the values each month.", "Crie os seus próprios indicadores – valor, percentual ou taxa com multiplicador (ex.: acidentes × 1.000.000 ÷ horas-homem) – defina a meta e lance os valores a cada mês.") + "</p></div>" +
      (canEdit ? '<button class="pl-btn primary" id="kpNew">' + IC("plus", 16) + " " + L("New indicator", "Novo indicador") + "</button>" : "") + "</div>";
    if (!list.length) h += '<div class="kp-zero"><p>' + L("No indicators yet.", "Ainda não há indicadores.") + "</p>" + (canEdit ? '<p class="muted small">' + L("Start from the library (frequency and severity rates, absenteeism, exams up to date, recycled waste…) or build your own formula.", "Comece pela biblioteca (taxas de frequência e gravidade, absenteísmo, exames em dia, resíduos reciclados…) ou monte a sua própria fórmula.") + "</p>" : "") + "</div>";
    h += '<div class="kp-grid">' + list.map(function (k) {
      const ser = kpiSeries(k), last = ser[ser.length - 1], prev = ser[ser.length - 2], ok = last ? kpiOk(k, last.v) : null;
      const delta = last && prev ? last.v - prev.v : null;
      return '<article class="kp-card"><header><div><b>' + esc(k.name) + '</b><small class="muted">' + esc(k.kind === "rate" ? k.a + " × " + nf(k.factor || 1) + " ÷ " + k.b : k.kind === "percent" ? k.a + " ÷ " + k.b + " × 100" : k.a || "") + "</small></div>" +
        (canEdit ? '<button class="pl-btn icon sm" data-kped="' + k.id + '" title="' + L("Edit indicator", "Editar indicador") + '">' + IC("pencil", 14) + "</button>" : "") + "</header>" +
        '<div class="kp-big"><span class="kp-num">' + (last ? nf(last.v, k.dec || 0) : "–") + '</span><span class="kp-unit">' + esc(k.unit || "") + "</span>" +
        (ok === null ? "" : '<span class="kp-st ' + (ok ? "ok" : "off") + '">' + (ok ? "✓ " + L("On target", "Na meta") : "! " + L("Off target", "Fora da meta")) + "</span>") + "</div>" +
        '<div class="kp-meta">' + L("Target", "Meta") + ": <b>" + (k.target !== undefined && k.target !== "" ? (k.dir === "down" ? "≤ " : "≥ ") + nf(k.target, k.dec || 0) + (k.unit ? " " + esc(k.unit) : "") : "–") + "</b>" + (last ? " · " + esc(perLabel(last.p)) : "") + (delta !== null ? ' · <span class="' + ((k.dir === "down" ? delta <= 0 : delta >= 0) ? "kp-good" : "kp-bad") + '">' + (delta > 0 ? "▲ " : delta < 0 ? "▼ " : "") + nf(Math.abs(delta), k.dec || 0) + "</span> " + L("vs previous", "vs anterior") : "") + "</div>" +
        kpiChart(k, ser) + (canEdit ? '<button class="pl-btn sm" data-kpval="' + k.id + '">' + L("Enter values", "Lançar valores") + "</button>" : "") + "</article>";
    }).join("") + "</div>";
    v.innerHTML = '<div class="kp-wrap">' + h + "</div>";
    const nb = document.getElementById("kpNew"); if (nb) nb.onclick = function () { kpiDialog(null); };
    v.querySelectorAll("[data-kped]").forEach(function (b) { b.onclick = function () { kpiDialog(b.dataset.kped); }; });
    v.querySelectorAll("[data-kpval]").forEach(function (b) { b.onclick = function () { kpiValues(b.dataset.kpval); }; });
  }
  function kpiDialog(id) {
    const k = id ? Object.assign({ id: id }, data.kpis[id]) : { kind: "percent", dir: "up", factor: 1000000, dec: 0 };
    const lib = KPI_LIB(), G = { sst: L("Safety", "Segurança do trabalho"), ohs: L("Occupational health", "Saúde ocupacional"), env: L("Environment", "Meio ambiente") };
    modal("<h2>" + (id ? L("Edit indicator", "Editar indicador") : L("New indicator", "Novo indicador")) + '</h2><form class="pl-form kp-form" id="kpF">' +
      (id ? "" : "<label>" + L("Start from the library (optional)", "Partir da biblioteca (opcional)") + '<select name="lib"><option value="">' + L("— my own indicator —", "— meu próprio indicador —") + "</option>" + Object.keys(G).map(function (g) { return '<optgroup label="' + esc(G[g]) + '">' + lib.filter(function (x) { return x.g === g; }).map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + "</option>"; }).join("") + "</optgroup>"; }).join("") + "</select></label>") +
      "<label>" + L("Name", "Nome") + '<input name="name" required maxlength="80" value="' + esc(k.name || "") + '"></label>' +
      "<label>" + L("Calculation", "Cálculo") + '<select name="kind"><option value="value">' + L("Value entered (e.g. number of near misses)", "Valor lançado (ex.: nº de quase-acidentes)") + '</option><option value="percent">' + L("Percentage: A ÷ B × 100", "Percentual: A ÷ B × 100") + '</option><option value="rate">' + L("Rate: A × multiplier ÷ B", "Taxa: A × multiplicador ÷ B") + "</option></select></label>" +
      '<div class="pl-2"><label>' + L("Variable A", "Variável A") + '<input name="a" maxlength="60" value="' + esc(k.a || "") + '" placeholder="' + esc(L("e.g. Lost-time accidents", "ex.: Acidentes com afastamento")) + '"></label><label class="kp-b">' + L("Variable B", "Variável B") + '<input name="b" maxlength="60" value="' + esc(k.b || "") + '" placeholder="' + esc(L("e.g. Man-hours worked", "ex.: Horas-homem trabalhadas")) + '"></label></div>' +
      '<div class="pl-2"><label class="kp-f">' + L("Multiplier", "Multiplicador") + '<input name="factor" type="number" min="1" step="any" value="' + esc(k.factor || 1000000) + '"></label><label>' + L("Unit", "Unidade") + '<input name="unit" maxlength="12" value="' + esc(k.unit || "") + '" placeholder="%, t, m³, dias…"></label></div>' +
      '<div class="pl-2"><label>' + L("Better when", "Melhor quando") + '<select name="dir"><option value="up">' + L("Higher (≥ target)", "Maior (≥ meta)") + '</option><option value="down">' + L("Lower (≤ target)", "Menor (≤ meta)") + "</option></select></label><label>" + L("Target", "Meta") + '<input name="target" type="number" step="any" value="' + esc(k.target === undefined ? "" : k.target) + '"></label></div>' +
      "<label>" + L("Decimal places", "Casas decimais") + '<select name="dec">' + [0, 1, 2].map(function (n) { return '<option value="' + n + '"' + (Number(k.dec || 0) === n ? " selected" : "") + ">" + n + "</option>"; }).join("") + "</select></label>" +
      "<label>" + L("How it is measured (optional)", "Como é medido (opcional)") + '<textarea name="desc" rows="2" maxlength="300">' + esc(k.desc || "") + "</textarea></label>" +
      '<p class="muted small" id="kpPrev"></p>' +
      '<div class="pl-row-end">' + (id ? '<button type="button" class="pl-btn ghost danger" id="kpDel">' + L("Delete", "Excluir") + "</button>" : "") + '<span class="sp"></span><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + L("Save", "Salvar") + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#kpF");
      f.kind.value = k.kind || "value"; f.dir.value = k.dir || "up";
      function upd() {
        const kd = f.kind.value;
        box.querySelector(".kp-b").style.display = kd === "value" ? "none" : ""; box.querySelector(".kp-f").style.display = kd === "rate" ? "" : "none";
        const A = f.a.value || "A", B = f.b.value || "B";
        box.querySelector("#kpPrev").textContent = L("Formula: ", "Fórmula: ") + (kd === "rate" ? A + " × " + nf(Number(f.factor.value) || 1) + " ÷ " + B : kd === "percent" ? A + " ÷ " + B + " × 100" : A);
      }
      ["kind", "a", "b", "factor"].forEach(function (n) { f[n].oninput = upd; f[n].onchange = upd; }); upd();
      if (f.lib) f.lib.onchange = function () {
        const x = lib.find(function (y) { return y.id === f.lib.value; }); if (!x) return;
        f.name.value = x.name; f.kind.value = x.kind; f.a.value = x.a || ""; f.b.value = x.b || ""; f.factor.value = x.factor || 1000000; f.unit.value = x.unit || ""; f.dir.value = x.dir; f.target.value = x.target; f.dec.value = String(x.dec || 0); f.desc.value = x.desc || ""; upd();
      };
      f.onsubmit = function (e) {
        e.preventDefault();
        const o = { name: f.name.value.trim(), kind: f.kind.value, a: f.a.value.trim() || L("Value", "Valor"), unit: f.unit.value.trim(), dir: f.dir.value, dec: Number(f.dec.value) || 0, desc: f.desc.value.trim(), order: k.order || Date.now() };
        if (o.kind !== "value") { o.b = f.b.value.trim(); if (!o.b) return toast(L("Name variable B", "Dê um nome à variável B")); }
        if (o.kind === "rate") o.factor = Number(f.factor.value) || 1;
        if (f.target.value !== "") o.target = Number(f.target.value);
        if (o.kind === "percent" && !o.unit) o.unit = "%";
        const kid = id || "k" + Date.now().toString(36);
        save("kpis/" + kid, o).then(function () { close(); toast(L("Indicator saved", "Indicador salvo")); if (!id) setTimeout(function () { kpiValues(kid, o); }, 60); });
      };
      const del = box.querySelector("#kpDel"); if (del) del.onclick = function () {
        if (!window.confirm(L("Delete this indicator and all its values?", "Excluir este indicador e todos os seus valores?"))) return;
        const u = {}; u["kpis/" + id] = null; u["kpiv/" + id] = null; ref("").update(u).then(function () { close(); toast(L("Indicator deleted", "Indicador excluído")); });
      };
    });
  }
  function kpiValues(id, fresh) {
    const k = Object.assign({ id: id }, fresh || (data.kpis || {})[id]); if (!k.name) return;
    const vv = (data.kpiv || {})[id] || {}, per = [];
    const d0 = new Date(); for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - i, 1)); per.push(d.toISOString().slice(0, 7)); }
    Object.keys(vv).forEach(function (p) { if (per.indexOf(p) < 0) per.unshift(p); }); per.sort();
    const two = k.kind !== "value";
    modal("<h2>" + L("Enter values", "Lançar valores") + '</h2><p class="muted small">' + esc(k.name) + " · " + esc(k.kind === "rate" ? k.a + " × " + nf(k.factor || 1) + " ÷ " + k.b : k.kind === "percent" ? k.a + " ÷ " + k.b + " × 100" : k.a) + '</p><form class="pl-form" id="kvF"><div class="kv-wrap"><table class="kv-tbl"><thead><tr><th>' + L("Month", "Mês") + "</th><th>" + esc(k.a) + "</th>" + (two ? "<th>" + esc(k.b) + "</th>" : "") + "<th>" + esc(k.name.length > 18 ? L("Result", "Resultado") : k.name) + "</th></tr></thead><tbody>" +
      per.slice().reverse().map(function (p) { const x = vv[p] || {}; return '<tr data-p="' + p + '"><td>' + esc(perLabel(p)) + '</td><td><input type="number" step="any" name="a_' + p + '" value="' + esc(x.a === undefined ? "" : x.a) + '"></td>' + (two ? '<td><input type="number" step="any" name="b_' + p + '" value="' + esc(x.b === undefined ? "" : x.b) + '"></td>' : "") + '<td class="kv-r"></td></tr>'; }).join("") +
      '</tbody></table></div><div class="pl-row-end"><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + L("Save values", "Salvar valores") + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#kvF");
      function calc() { box.querySelectorAll("tr[data-p]").forEach(function (tr) { const p = tr.dataset.p, a = f["a_" + p].value, b = two ? f["b_" + p].value : ""; const r = kpiVal(k, { a: a, b: b }); const ok = kpiOk(k, r); tr.querySelector(".kv-r").innerHTML = r === null || !isFinite(r) ? "–" : '<span class="' + (ok === false ? "kp-bad" : ok ? "kp-good" : "") + '">' + nf(r, k.dec || 0) + (k.unit ? " " + esc(k.unit) : "") + "</span>"; }); }
      f.oninput = calc; calc();
      f.onsubmit = function (e) {
        e.preventDefault(); const u = {};
        per.forEach(function (p) { const a = f["a_" + p].value, b = two ? f["b_" + p].value : ""; u["kpiv/" + id + "/" + p] = a === "" ? null : (two ? { a: Number(a), b: b === "" ? null : Number(b) } : { a: Number(a) }); });
        ref("").update(u).then(function () { close(); toast(L("Values saved", "Valores salvos")); });
      };
    });
  }

  /* ================= Impediments (blocks) and flow metrics =================
     items/<id>/blocks/<bid> = { type, desc, since, until?, by, deps?{itemId:true}, party?, contact?, owner?, eta?, resolution? }
     items/<id>/startedAt = first time the item entered a "doing" status (set in patch)
     Lead time = created → done · upstream = created → started · downstream = started → done.
     While a block is open the clock of the stage it is in stops: blocked time is subtracted from each stage and counted apart. */
  function BLOCKT() {
    return {
      internal: { ic: "link", c: "#6250d6", name: L("Internal dependency", "Dependência interna"), desc: L("Waiting for another task, story or epic of this planning.", "Aguardando outra tarefa, história ou épico deste planejamento.") },
      external: { ic: "people", c: "#c2410c", name: L("External dependency", "Dependência externa"), desc: L("Supplier, client, partner or another company.", "Fornecedor, cliente, parceiro ou outra empresa.") },
      team: { ic: "people", c: "#2a78d6", name: L("Another team / area", "Outra equipe / área"), desc: L("Another team of the company that is not in this planning.", "Outra equipe da empresa que não está neste planejamento.") },
      approval: { ic: "objective", c: "#b7791f", name: L("Approval / decision", "Aprovação / decisão"), desc: L("Waiting for a sign-off, budget or management decision.", "Aguardando aprovação, verba ou decisão da gestão.") },
      info: { ic: "help", c: "#0f766e", name: L("Missing information", "Falta de informação"), desc: L("Requirements, data or answers that have not arrived.", "Requisitos, dados ou respostas que não chegaram.") },
      environment: { ic: "integration", c: "#8e4ec6", name: L("Environment / infrastructure", "Ambiente / infraestrutura"), desc: L("Environment, access, licence or tool unavailable.", "Ambiente, acesso, licença ou ferramenta indisponível.") },
      technical: { ic: "bug", c: "#e34948", name: L("Technical problem", "Problema técnico"), desc: L("Defect, technical debt or unknown to investigate.", "Defeito, dívida técnica ou incerteza a investigar.") },
      resource: { ic: "people", c: "#5c6b80", name: L("People unavailable", "Pessoa indisponível"), desc: L("Absence, overload or missing skill.", "Ausência, sobrecarga ou falta de competência.") },
      other: { ic: "more", c: "#5c6b80", name: L("Other", "Outro"), desc: L("Anything else that stops the work.", "Qualquer outra coisa que pare o trabalho.") }
    };
  }
  function blocksOf(it) { const b = it.blocks || {}; return Object.keys(b).map(function (k) { return Object.assign({ id: k }, b[k]); }).filter(function (x) { return x.since; }).sort(function (a, c) { return (c.since || 0) - (a.since || 0); }); }
  function openBlock(it) { return blocksOf(it).filter(function (b) { return !b.until; })[0] || null; }
  function blockedMs(it, a, b) { /* union of the block intervals inside [a, b] */
    const iv = blocksOf(it).map(function (x) { return [Math.max(a, x.since), Math.min(b, x.until || Date.now())]; }).filter(function (x) { return x[1] > x[0]; }).sort(function (x, y) { return x[0] - y[0]; });
    let tot = 0, cs = null, ce = null;
    iv.forEach(function (x) { if (cs === null || x[0] > ce) { if (cs !== null) tot += ce - cs; cs = x[0]; ce = x[1]; } else ce = Math.max(ce, x[1]); });
    if (cs !== null) tot += ce - cs;
    return tot;
  }
  function flowOf(it) {
    const now = Date.now(), c = Number(it.created) || null; if (!c) return null;
    const dn = Number(it.doneAt) || null, st = Number(it.startedAt) || null, end = dn || now, mid = st || end;
    const up = Math.max(0, mid - c), down = st ? Math.max(0, end - st) : 0;
    const bu = blockedMs(it, c, mid), bd = st ? blockedMs(it, st, end) : 0;
    return { done: !!dn, started: !!st, gross: up + down, up: up, down: down, upNet: Math.max(0, up - bu), downNet: Math.max(0, down - bd), blocked: bu + bd, net: Math.max(0, up + down - bu - bd) };
  }
  function dur(ms) {
    if (ms == null) return "–";
    const m = Math.round(ms / 60000); if (m < 60) return m + " min";
    const h = Math.round(ms / 3600000); if (h < 48) return h + " h";
    const d = ms / DAY; return nf(d, d < 10 ? 1 : 0) + " d";
  }
  function knownSuppliers() { /* suppliers already used in impediments and in the project budget */
    const o = {}; items().forEach(function (i) { blocksOf(i).forEach(function (b) { if (b.supplier) o[b.supplier] = 1; }); });
    bLines().forEach(function (x) { if (x.supplier) o[x.supplier] = 1; });
    return Object.keys(o).sort(function (a, b) { return a.localeCompare(b); });
  }
  function blockers(id) { /* items whose open internal dependency points at this one */
    return items().filter(function (i) { const b = openBlock(i); return b && b.type === "internal" && b.deps && b.deps[id]; });
  }
  function blockBadge(it) {
    const b = openBlock(it); if (!b) return "";
    const T = BLOCKT()[b.type] || BLOCKT().other;
    const lim = Number(((data.settings || {}).notify || {}).blockedDays == null ? 7 : data.settings.notify.blockedDays) || 7, long = Date.now() - b.since > lim * DAY;
    return '<span class="blk-badge' + (long ? " long" : "") + '" title="' + esc(T.name + ": " + (b.desc || "") + (long ? " · " + L("blocked for more than ", "bloqueado há mais de ") + lim + L(" days – alert sent by e-mail", " dias – alerta enviado por e-mail") : "")) + '">' + (long ? "⚠ " : "") + IC("lock", 12) + " " + L("Blocked", "Bloqueado") + " · " + dur(Date.now() - b.since) + "</span>";
  }
  function blockBlock(it) {
    const BT = BLOCKT(), fl = flowOf(it), ob = openBlock(it), past = blocksOf(it).filter(function (b) { return b.until; }), bl = blockers(it.id);
    const chip = function (x) { const o = data.items[x]; if (!o) return ""; return '<button type="button" class="dep-chip' + (cat(Object.assign({ id: x }, o)) === "done" ? " ok" : "") + '" data-open-it="' + x + '">' + (TYPES[o.type] || TYPES.task).icon + " " + esc((o.key ? o.key + " · " : "") + o.title) + " <i>" + esc(statusOf(o).name) + "</i></button>"; };
    const one = function (b, open) {
      const T = BT[b.type] || BT.other, deps = Object.keys(b.deps || {});
      const allDone = open && b.type === "internal" && deps.length && deps.every(function (x) { const o = data.items[x]; return !o || cat(Object.assign({ id: x }, o)) === "done"; });
      return '<div class="blk' + (open ? " open" : "") + '" style="--c:' + T.c + '"><div class="blk-h"><b>' + IC(T.ic, 14) + " " + esc(T.name) + '</b><span class="muted small">' + (open ? L("blocked for ", "bloqueado há ") + dur(Date.now() - b.since) : dur(b.until - b.since) + " · " + fmtTs(b.since) + " → " + fmtTs(b.until)) + "</span></div>" +
        (b.desc ? '<p class="small">' + esc(b.desc) + "</p>" : "") +
        (deps.length ? '<div class="dep-list">' + deps.map(chip).join("") + "</div>" : "") +
        (b.supplier ? '<p class="small"><b>' + L("Supplier: ", "Fornecedor: ") + "</b>" + esc(b.supplier) + "</p>" : "") +
        ((b.party && !b.supplier) || b.contact || b.owner || b.eta ? '<p class="muted small">' + [b.supplier ? "" : b.party, b.contact, b.owner ? L("resolving: ", "resolvendo: ") + memberName(b.owner) : "", b.eta ? L("expected ", "previsão ") + fmt(b.eta) : ""].filter(Boolean).map(esc).join(" · ") + "</p>" : "") +
        (b.resolution ? '<p class="muted small">✓ ' + esc(b.resolution) + "</p>" : "") +
        (allDone ? '<p class="blk-ok small">' + L("All the dependencies are done – you can resolve this impediment.", "Todas as dependências foram concluídas – você já pode resolver este impedimento.") + "</p>" : "") +
        (open && canEdit ? '<div class="dw-a"><button type="button" class="pl-btn sm primary" data-blk-res="' + b.id + '">' + L("Resolve", "Resolver") + '</button><button type="button" class="pl-btn sm ghost" data-blk-ed="' + b.id + '">' + L("Edit", "Editar") + "</button></div>" : "") + "</div>";
    };
    return '<div class="d-blocks"><div class="dw-h">' + IC("lock", 15) + " <b>" + L("Impediments and flow", "Impedimentos e fluxo") + "</b></div>" +
      (fl ? '<div class="flow-m"><div><span>' + L("Lead time", "Lead time") + "</span><b>" + dur(fl.net) + "</b><small>" + (fl.done ? L("delivered", "entregue") : L("running", "em curso")) + "</small></div><div><span>Upstream</span><b>" + dur(fl.upNet) + "</b><small>" + L("before starting", "antes de iniciar") + "</small></div><div><span>Downstream</span><b>" + (fl.started ? dur(fl.downNet) : "–") + "</b><small>" + L("in progress → done", "em andamento → concluído") + '</small></div><div class="bl"><span>' + L("Blocked", "Bloqueado") + "</span><b>" + dur(fl.blocked) + "</b><small>" + L("not counted above", "fora das contagens") + "</small></div></div>" : "") +
      (ob ? one(ob, true) : '<p class="muted small">' + L("No open impediment. When the work stops, register the impediment: the lead time clock pauses and the blocked time is counted apart.", "Nenhum impedimento aberto. Quando o trabalho parar, registre o impedimento: o relógio do lead time pausa e o tempo bloqueado é contado à parte.") + "</p>") +
      (bl.length ? '<p class="small"><b>' + L("This item is blocking:", "Este item está bloqueando:") + '</b></p><div class="dep-list">' + bl.map(function (x) { return chip(x.id); }).join("") + "</div>" : "") +
      (canEdit && !ob ? '<div class="dw-a"><button type="button" class="pl-btn sm" id="blkNew">' + IC("lock", 13) + " " + L("Register impediment", "Registrar impedimento") + "</button></div>" : "") +
      (past.length ? "<details><summary class=\"small\">" + L("History", "Histórico") + " (" + past.length + ")</summary>" + past.map(function (b) { return one(b, false); }).join("") + "</details>" : "") + "</div>";
  }
  function fmtTs(t) { return t ? new Date(t).toLocaleString(window.MB_LOCALE || (PT ? "pt-BR" : "en-GB"), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""; }
  function bindBlocks(id) {
    const d = document.getElementById("drawer"); if (!d) return;
    d.querySelectorAll("[data-open-it]").forEach(function (b) { b.onclick = function () { openDrawer(b.dataset.openIt); }; });
    const n = document.getElementById("blkNew"); if (n) n.onclick = function () { blockDialog(id, null); };
    d.querySelectorAll("[data-blk-ed]").forEach(function (b) { b.onclick = function () { blockDialog(id, b.dataset.blkEd); }; });
    d.querySelectorAll("[data-blk-res]").forEach(function (b) { b.onclick = function () { resolveBlock(id, b.dataset.blkRes); }; });
  }
  function refreshBlocks(id) {
    setTimeout(function () { const b = document.querySelector("#drawer .d-blocks"); if (!b || openItem !== id || !data.items[id]) return; b.outerHTML = blockBlock(Object.assign({ id: id }, data.items[id])); bindBlocks(id); }, 150);
  }
  function blockDialog(id, bid) {
    const it = Object.assign({ id: id }, data.items[id] || {}), BT = BLOCKT(), b = bid ? Object.assign({}, (it.blocks || {})[bid]) : { type: "internal" };
    const cand = items().filter(function (i) { return i.id !== id; }).sort(byOrder), sel = Object.assign({}, b.deps || {});
    const ppl = Object.keys(members).map(function (k) { return members[k]; });
    const local = function (t) { const x = new Date(t - new Date(t).getTimezoneOffset() * 60000); return x.toISOString().slice(0, 16); };
    modal("<h2>" + IC("lock", 18) + " " + (bid ? L("Edit impediment", "Editar impedimento") : L("Register impediment", "Registrar impedimento")) + '</h2><p class="muted small">' + esc((it.key ? it.key + " · " : "") + it.title) + " — " + L("while it is open, the lead time (upstream or downstream) stops and the blocked time is counted apart.", "enquanto estiver aberto, o lead time (upstream ou downstream) para e o tempo bloqueado é contado à parte.") + "</p>" +
      '<form class="pl-form blk-form" id="bkF"><fieldset class="blk-types"><legend>' + L("Type of impediment", "Tipo de impedimento") + "</legend>" + Object.keys(BT).map(function (k) {
        return '<label class="blk-t" style="--c:' + BT[k].c + '"><input type="radio" name="type" value="' + k + '"' + (b.type === k ? " checked" : "") + "><span>" + IC(BT[k].ic, 16) + "</span><b>" + esc(BT[k].name) + "</b><small>" + esc(BT[k].desc) + "</small></label>";
      }).join("") + "</fieldset>" +
      "<label>" + L("What is blocking?", "O que está bloqueando?") + '<textarea name="desc" rows="2" maxlength="400" required placeholder="' + esc(L("e.g. waiting for the payments API from the platform team", "ex.: aguardando a API de pagamentos do time de plataforma")) + '">' + esc(b.desc || "") + "</textarea></label>" +
      '<div class="bk-internal"><label>' + L("Depends on (tasks, stories, epics of this planning)", "Depende de (tarefas, histórias, épicos deste planejamento)") + '<input type="search" id="bkQ" placeholder="' + esc(L("Search by key or title", "Pesquisar por chave ou título")) + '"></label><div class="bk-pick" id="bkPick"></div><div class="dep-list" id="bkSel"></div></div>' +
      '<div class="bk-supplier"><label>' + L("Supplier", "Fornecedor") + ' <span class="req">*</span><input name="supplier" list="bkSup" maxlength="80" value="' + esc(b.supplier || (b.type === "external" ? b.party || "" : "")) + '" placeholder="' + esc(L("e.g. TOTVS, AWS, Accenture", "ex.: TOTVS, AWS, Accenture")) + '"></label><datalist id="bkSup">' + knownSuppliers().map(function (x) { return '<option value="' + esc(x) + '">'; }).join("") + "</datalist></div>" +
      '<div class="bk-external pl-2"><label class="bk-party">' + L("Who (team, area, person)", "Quem (equipe, área, pessoa)") + '<input name="party" maxlength="80" value="' + esc(b.type === "external" ? "" : b.party || "") + '"></label><label>' + L("Contact / reference (ticket, e-mail)", "Contato / referência (chamado, e-mail)") + '<input name="contact" maxlength="120" value="' + esc(b.contact || "") + '"></label></div>' +
      '<div class="pl-2"><label>' + L("Who is resolving", "Quem está resolvendo") + '<select name="owner"><option value="">—</option>' + ppl.map(function (m) { return '<option value="' + esc(m.email) + '"' + (m.email === b.owner ? " selected" : "") + ">" + esc(m.name || m.email) + "</option>"; }).join("") + "</select></label><label>" + L("Expected resolution", "Previsão de solução") + '<input type="date" name="eta" value="' + esc(b.eta || "") + '"></label></div>' +
      "<label>" + L("Blocked since", "Bloqueado desde") + '<input type="datetime-local" name="since" value="' + local(b.since || Date.now()) + '" max="' + local(Date.now()) + '"></label>' +
      '<div class="pl-row-end">' + (bid ? '<button type="button" class="pl-btn ghost danger" id="bkDel">' + L("Delete", "Excluir") + "</button>" : "") + '<span class="sp"></span><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + (bid ? L("Save", "Salvar") : L("Block item", "Bloquear item")) + "</button></div></form>", function (box, close) {
      box.querySelector(".pl-card").classList.add("wide");
      const f = box.querySelector("#bkF"), q = box.querySelector("#bkQ");
      function kind() { const t = f.type.value; box.querySelector(".bk-internal").hidden = t !== "internal"; box.querySelector(".bk-supplier").hidden = ["external", "environment"].indexOf(t) < 0; box.querySelector(".bk-external").hidden = ["external", "team", "approval", "info", "environment"].indexOf(t) < 0; box.querySelector(".bk-party").hidden = t === "external" || t === "environment"; f.supplier.required = t === "external"; }
      function drawSel() { box.querySelector("#bkSel").innerHTML = Object.keys(sel).map(function (x) { const o = data.items[x]; return o ? '<button type="button" class="dep-chip on" data-un="' + x + '">' + (TYPES[o.type] || TYPES.task).icon + " " + esc((o.key ? o.key + " · " : "") + o.title) + " ✕</button>" : ""; }).join(""); box.querySelectorAll("[data-un]").forEach(function (c) { c.onclick = function () { delete sel[c.dataset.un]; drawSel(); drawPick(); }; }); }
      function drawPick() {
        const s = (q.value || "").toLowerCase();
        const list = cand.filter(function (i) { return !sel[i.id] && (!s || (i.title || "").toLowerCase().indexOf(s) >= 0 || (i.key || "").toLowerCase().indexOf(s) >= 0); }).slice(0, 30);
        box.querySelector("#bkPick").innerHTML = list.length ? list.map(function (i) { return '<button type="button" data-pk="' + i.id + '"><span class="ti" style="color:' + (TYPES[i.type] || TYPES.task).color + '">' + (TYPES[i.type] || TYPES.task).icon + '</span><span class="tk">' + esc(i.key || "") + "</span><span class=\"tt\">" + esc(i.title) + '</span><i>' + esc(statusOf(i).name) + "</i></button>"; }).join("") : '<p class="muted small">' + L("No items found.", "Nenhum item encontrado.") + "</p>";
        box.querySelectorAll("[data-pk]").forEach(function (c) { c.onclick = function () { sel[c.dataset.pk] = true; drawSel(); drawPick(); }; });
      }
      f.querySelectorAll("[name=type]").forEach(function (r) { r.onchange = kind; });
      q.oninput = drawPick; kind(); drawSel(); drawPick();
      f.onsubmit = function (e) {
        e.preventDefault();
        const t = f.type.value, o = { type: t, desc: f.desc.value.trim(), since: f.since.value ? Math.min(Date.now(), new Date(f.since.value).getTime()) : Date.now(), by: b.by || me.email };
        if (t === "internal") { if (!Object.keys(sel).length) return toast(L("Choose at least one item it depends on", "Escolha pelo menos um item do qual ele depende")); o.deps = sel; }
        if (t === "external" || t === "environment") { const sp = f.supplier.value.trim(); if (t === "external" && !sp) return toast(L("Inform the supplier", "Informe o fornecedor")); if (sp) { o.supplier = sp; o.party = sp; } }
        else if (["team", "approval", "info"].indexOf(t) >= 0 && f.party.value.trim()) o.party = f.party.value.trim();
        if (["external", "team", "approval", "info", "environment"].indexOf(t) >= 0 && f.contact.value.trim()) o.contact = f.contact.value.trim();
        if (f.owner.value) o.owner = f.owner.value; if (f.eta.value) o.eta = f.eta.value;
        if (b.until) o.until = b.until; if (b.resolution) o.resolution = b.resolution;
        const k = bid || "b" + Date.now().toString(36);
        ref("items/" + id + "/blocks/" + k).set(o).then(function () { close(); toast(bid ? L("Impediment updated", "Impedimento atualizado") : L("Item blocked – lead time paused", "Item bloqueado – lead time pausado")); refreshBlocks(id); });
      };
      const del = box.querySelector("#bkDel"); if (del) del.onclick = function () { ref("items/" + id + "/blocks/" + bid).remove().then(function () { close(); refreshBlocks(id); }); };
    });
  }
  function resolveBlock(id, bid) {
    modal("<h2>" + L("Resolve impediment", "Resolver impedimento") + '</h2><form class="pl-form" id="rsF"><label>' + L("How was it resolved? (optional)", "Como foi resolvido? (opcional)") + '<textarea name="r" rows="2" maxlength="300"></textarea></label><div class="pl-row-end"><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + L("Resolve – resume the clock", "Resolver – retomar o relógio") + "</button></div></form>", function (box, close) {
      box.querySelector("#rsF").onsubmit = function (e) {
        e.preventDefault(); const u = {}, r = box.querySelector("[name=r]").value.trim();
        u["items/" + id + "/blocks/" + bid + "/until"] = Date.now(); if (r) u["items/" + id + "/blocks/" + bid + "/resolution"] = r;
        db.ref("planning/" + ID + "/data").update(u).then(function () { close(); toast(L("Impediment resolved – lead time running again", "Impedimento resolvido – lead time voltou a contar")); refreshBlocks(id); });
      };
    });
  }
  function flowSection(W) {
    const BT = BLOCKT(), done = W.map(function (i) { return { i: i, f: flowOf(i) }; }).filter(function (x) { return x.f && x.f.done; });
    const avg = function (k) { return done.length ? done.reduce(function (s, x) { return s + x.f[k]; }, 0) / done.length : null; };
    const byType = {}, bySup = {}; let blTot = 0;
    W.forEach(function (i) { blocksOf(i).forEach(function (b) { const ms = Math.max(0, (b.until || Date.now()) - b.since); byType[b.type] = (byType[b.type] || 0) + ms; blTot += ms; if (b.supplier) { const x = bySup[b.supplier] = bySup[b.supplier] || { ms: 0, n: 0, open: 0 }; x.ms += ms; x.n++; if (!b.until) x.open++; } }); });
    const sups = Object.keys(bySup).sort(function (a, b) { return bySup[b].ms - bySup[a].ms; });
    const open = W.map(function (i) { return { i: i, b: openBlock(i) }; }).filter(function (x) { return x.b; }).sort(function (a, b) { return a.b.since - b.b.since; });
    const gAvg = avg("gross"), nAvg = avg("net");
    const rows = Object.keys(byType).sort(function (a, b) { return byType[b] - byType[a]; }), mx = Math.max(1, Math.max.apply(null, rows.map(function (k) { return byType[k]; }).concat([1])));
    return '<div class="rp-grid2"><section class="rp-card"><h3>' + L("Flow · lead time and cycle time (without impediments)", "Fluxo · lead time e cycle time (sem impedimentos)") + '</h3><div class="flow-m big">' +
      "<div><span>" + L("Lead time (avg)", "Lead time (média)") + "</span><b>" + dur(nAvg) + "</b><small>" + done.length + " " + L("delivered items", "itens entregues") + "</small></div>" +
      "<div><span>Upstream</span><b>" + dur(avg("upNet")) + "</b><small>" + L("created → started", "criado → iniciado") + "</small></div>" +
      "<div><span>Cycle time</span><b>" + dur(avg("downNet")) + "</b><small>" + L("started → done (downstream)", "iniciado → concluído (downstream)") + "</small></div>" +
      '<div class="bl"><span>' + L("Blocked (avg)", "Bloqueado (média)") + "</span><b>" + dur(avg("blocked")) + "</b><small>" + (gAvg ? nf((gAvg - nAvg) / gAvg * 100, 0) + "% " + L("of the gross lead time", "do lead time bruto") : "–") + "</small></div></div>" +
      '<p class="muted small">' + L("Blocked time is not counted in the lead time: it is shown apart, by type of impediment.", "O tempo bloqueado não entra no lead time: ele aparece à parte, por tipo de impedimento.") + "</p></section>" +
      '<section class="rp-card"><h3>' + L("Blocked time by type", "Tempo bloqueado por tipo") + "</h3>" + (rows.length ? '<div class="blk-bars">' + rows.map(function (k) { const T = BT[k] || BT.other; return '<div title="' + esc(T.name + ": " + dur(byType[k])) + '"><span>' + esc(T.name) + '</span><i style="width:' + Math.max(2, byType[k] / mx * 100) + '%"></i><b>' + dur(byType[k]) + "</b></div>"; }).join("") + "</div>" : '<p class="muted small">' + L("No impediments registered yet.", "Nenhum impedimento registrado ainda.") + "</p>") +
      (sups.length ? '<h3 class="bd-h3">' + L("Blocked time by supplier", "Tempo bloqueado por fornecedor") + '</h3><table class="rp-t"><thead><tr><th>' + L("Supplier", "Fornecedor") + "</th><th>" + L("Impediments", "Impedimentos") + "</th><th>" + L("Open", "Abertos") + "</th><th>" + L("Blocked time", "Tempo bloqueado") + "</th></tr></thead><tbody>" + sups.map(function (k) { const x = bySup[k]; return "<tr><td><b>" + esc(k) + "</b></td><td>" + x.n + '</td><td class="' + (x.open ? "late" : "") + '">' + x.open + "</td><td>" + dur(x.ms) + "</td></tr>"; }).join("") + "</tbody></table>" : "") + "</section></div>" +
      (open.length ? '<section class="rp-card"><h3>' + L("Open impediments", "Impedimentos abertos") + " (" + open.length + ')</h3><div class="rp-scroll"><table class="rp-t"><thead><tr><th>' + L("Item", "Item") + "</th><th>" + L("Type", "Tipo") + "</th><th>" + L("What", "O quê") + "</th><th>" + L("Depends on", "Depende de") + "</th><th>" + L("Blocked for", "Bloqueado há") + "</th></tr></thead><tbody>" +
        open.map(function (x) { const T = BT[x.b.type] || BT.other; return '<tr data-open="' + x.i.id + '"><td><b>' + esc(x.i.key || "") + "</b> " + esc(x.i.title) + "</td><td>" + esc(T.name) + "</td><td>" + esc(x.b.desc || "") + "</td><td>" + esc(Object.keys(x.b.deps || {}).map(function (d) { const o = data.items[d]; return o ? o.key || o.title : ""; }).concat(x.b.party ? [x.b.party] : []).join(", ")) + "</td><td>" + dur(Date.now() - x.b.since) + "</td></tr>"; }).join("") + "</tbody></table></div></section>" : "");
  }

  /* ================= AI: generate epics and user stories ================= */
  function loadAIjs() {
    if (window.CMAI) return Promise.resolve(window.CMAI);
    return new Promise(function (res, rej) { const s = document.createElement("script"); s.src = "../assets/js/ai.js"; s.onload = function () { res(window.CMAI); }; s.onerror = rej; document.head.appendChild(s); });
  }
  function storyDesc(s) {
    const lines = [];
    if (s.as || s.want) lines.push(L("As ", "Como ") + (s.as || "…") + L(", I want ", ", quero ") + (s.want || "…") + (s.so ? L(", so that ", ", para ") + s.so : "") + ".");
    if (s.description) lines.push("", s.description);
    const ac = (s.criteria || []).filter(Boolean);
    if (ac.length) { lines.push("", L("Acceptance criteria:", "Critérios de aceite:")); ac.forEach(function (c, i) { lines.push((i + 1) + ". " + (typeof c === "string" ? c : [c.given && L("Given ", "Dado ") + c.given, c.when && L("when ", "quando ") + c.when, c.then && L("then ", "então ") + c.then].filter(Boolean).join(", "))); }); }
    return lines.join("\n");
  }
  function critText(c) { return typeof c === "string" ? c : [c.given && L("Given ", "Dado ") + c.given, c.when && L("when ", "quando ") + c.when, c.then && L("then ", "então ") + c.then].filter(Boolean).join(", "); }
  function aiStoryDialog(preParent, preMode) {
    const hasEpic = method().types.indexOf("epic") >= 0, hasStory = method().types.indexOf("story") >= 0;
    const conts = items().filter(isContainer).sort(byOrder);
    let mode = preMode || (hasStory ? "story" : "epic"), parent = preParent || "", res = null;
    const P = function () { return parent && data.items[parent] ? Object.assign({ id: parent }, data.items[parent]) : null; };
    const LANGN = window.MB_LANG === "es" ? "Español" : window.MB_LANG === "pt" ? (window.MB_VARIANT === "pt-pt" ? "Português de Portugal" : "Português do Brasil") : "English";
    modal('<div class="ai-st"><header class="ai-st-h"><div><h2>' + IC("spark", 18) + " " + L("Generate with AI", "Gerar com IA") + '</h2><p>' + L("AI drafts epics and user stories with acceptance criteria from your description and the context it reads. You review before anything is created.", "A IA rascunha épicos e histórias de usuário com critérios de aceite a partir da sua descrição e do contexto que ela lê. Você revisa antes de criar.") + '</p></div><div class="ai-tabs"><span class="on" data-st="1"><i>1</i> ' + L("Description", "Descrição") + '</span><span data-st="2"><i>2</i> ' + L("Review", "Revisão") + '</span></div></header><div class="ai-st-b" id="aiB"></div></div>', function (box, close) {
      box.querySelector(".pl-card").classList.add("wide", "ai-card");
      const B = box.querySelector("#aiB");
      function tab(n) { box.querySelectorAll("[data-st]").forEach(function (t) { t.classList.toggle("on", t.dataset.st === String(n)); t.classList.toggle("ok", Number(t.dataset.st) < n); }); }
      function step1(txt) {
        tab(1);
        const p = P();
        B.innerHTML = '<form class="pl-form" id="aiF"><div class="ai-modes">' +
          (hasStory ? '<label><input type="radio" name="m" value="story"' + (mode === "story" ? " checked" : "") + "><b>" + L("User story", "História de usuário") + "</b><small>" + L("One story with acceptance criteria", "Uma história com critérios de aceite") + "</small></label>" : "") +
          (hasEpic ? '<label><input type="radio" name="m" value="epic"' + (mode === "epic" ? " checked" : "") + "><b>" + L("Epic with stories", "Épico com histórias") + "</b><small>" + L("An epic split into 3–8 stories", "Um épico dividido em 3 a 8 histórias") + "</small></label>" : "") +
          (hasStory ? '<label><input type="radio" name="m" value="split"' + (mode === "split" ? " checked" : "") + "><b>" + L("Stories for an epic", "Histórias para um épico") + "</b><small>" + L("Break the chosen epic into stories", "Quebrar o épico escolhido em histórias") + "</small></label>" : "") + "</div>" +
          "<label>" + L("Describe the need", "Descreva a necessidade") + ' <span class="muted small">“' + L("As a [role], I want [action], so that [benefit].", "Como [perfil], quero [ação], para [benefício].") + "” " + L("or free text", "ou texto livre") + ' · <span id="aiN">0</span>/800 (min. 50)</span><textarea name="t" rows="5" maxlength="800">' + esc(txt || "") + "</textarea></label>" +
          "<label>" + L("Link to (parent)", "Vincular a (pai)") + '<select name="p"><option value="">— ' + L("none", "nenhum") + " —</option>" + conts.map(function (c) { return '<option value="' + c.id + '"' + (c.id === parent ? " selected" : "") + ">" + esc((TYPES[c.type] || TYPES.epic).name + " · " + (c.key ? c.key + " · " : "") + c.title) + "</option>"; }).join("") + "</select></label>" +
          '<div class="ai-src-h">' + L("Information sources", "Fontes de informação") + '</div><div class="ai-srcs" id="aiSrc"></div>' +
          '<div class="ai-steps" id="aiSteps" hidden><div class="ok"><i>✓</i>' + L("Read context", "Ler contexto") + '</div><div class="run"><i></i>' + L("Draft story & criteria", "Rascunhar história e critérios") + "</div><div><i>3</i>" + L("Ready for review", "Pronto para revisão") + "</div></div>" +
          '<p class="d-err" id="aiErr" hidden></p><div class="pl-row-end"><span class="sp"></span><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary" id="aiGo">' + IC("spark", 14) + " " + L("Generate", "Gerar") + "</button></div></form>";
        const f = B.querySelector("#aiF");
        B.querySelector("[data-close]").onclick = close;
        function src() {
          const p2 = P(), sib = p2 ? children(p2.id) : [], gp = p2 && p2.parent && data.items[p2.parent];
          B.querySelector("#aiSrc").innerHTML =
            (p2 ? '<div class="ai-src"><small style="--c:' + (TYPES[p2.type] || TYPES.epic).color + '">● ' + esc((TYPES[p2.type] || TYPES.epic).name) + "</small><b>" + esc(p2.title) + "</b><span>" + esc(p2.key || "") + " · " + esc(statusOf(p2).name) + "</span></div>" : "") +
            (gp ? '<div class="ai-src"><small style="--c:' + (TYPES[gp.type] || TYPES.initiative).color + '">● ' + esc((TYPES[gp.type] || TYPES.initiative).name) + "</small><b>" + esc(gp.title) + "</b><span>" + esc(gp.key || "") + "</span></div>" : "") +
            '<div class="ai-src"><small style="--c:#1baf7a">● ' + L("Planning", "Planejamento") + "</small><b>" + esc(info.title) + "</b><span>" + esc(method().name) + (wsInfo.name ? " · " + esc(wsInfo.name) : "") + "</span></div>" +
            (sib.length ? '<div class="ai-src"><small style="--c:#2a78d6">● ' + L("Existing items", "Itens existentes") + "</small><b>" + sib.length + " " + L("child items", "itens filhos") + "</b><span>" + L("avoids duplicates", "evita duplicados") + "</span></div>" : "");
        }
        const cnt = function () { B.querySelector("#aiN").textContent = f.t.value.length; };
        f.t.oninput = cnt; cnt();
        f.p.onchange = function () { parent = f.p.value; src(); }; src();
        f.querySelectorAll("[name=m]").forEach(function (r) { r.onchange = function () { mode = r.value; }; });
        f.onsubmit = function (e) {
          e.preventDefault();
          const t = f.t.value.trim(), er = B.querySelector("#aiErr");
          if (mode === "split" && !P()) { er.hidden = false; er.textContent = L("Choose the epic to split.", "Escolha o épico a ser quebrado."); return; }
          if (t.length < 50 && mode !== "split") { er.hidden = false; er.textContent = L("Describe the need with at least 50 characters.", "Descreva a necessidade com pelo menos 50 caracteres."); return; }
          er.hidden = true; B.querySelector("#aiSteps").hidden = false; const go = B.querySelector("#aiGo"); go.disabled = true; go.textContent = L("Generating…", "Gerando…");
          const p2 = P(), gp = p2 && p2.parent && data.items[p2.parent], sib = p2 ? children(p2.id).map(function (x) { return "- " + x.title; }).join("\n") : "";
          const STORY = '{"title":"short title","as":"role","want":"action","so":"benefit","description":"2-4 sentences","criteria":[{"given":"","when":"","then":""}],"points":3}';
          const shape = mode === "story" ? STORY : '{"epic":{"title":"","description":"","outcome":"measurable business outcome","criteria":[{"given":"","when":"","then":""}]},"stories":[' + STORY + "]}";
          const prompt = "You are a senior product owner and agile coach. Write in " + LANGN + ".\n" +
            (mode === "story" ? "Write ONE INVEST user story with 3-6 testable acceptance criteria in Given/When/Then and a Fibonacci story point estimate (1,2,3,5,8,13)." : mode === "epic" ? "Write ONE epic and split it into 3-8 INVEST user stories (vertical slices, each delivering value), each with 2-5 acceptance criteria in Given/When/Then and Fibonacci story points." : "Split the given epic into 3-8 INVEST user stories (vertical slices), each with 2-5 acceptance criteria in Given/When/Then and Fibonacci story points. Do not repeat existing child items. Return the epic object with the epic's current title.") +
            " Be specific to the context; no generic filler.\nReturn ONLY JSON in this shape: " + shape + "\n\nCONTEXT\nPlanning: " + info.title + " (" + method().name + ")" + (wsInfo.name ? " · workspace " + wsInfo.name : "") +
            (gp ? "\nInitiative: " + gp.title + (gp.desc ? " – " + String(gp.desc).slice(0, 600) : "") : "") +
            (p2 ? "\nParent " + (TYPES[p2.type] || TYPES.epic).name + ": " + p2.title + (p2.desc ? " – " + String(p2.desc).slice(0, 1200) : "") : "") +
            (sib ? "\nExisting child items:\n" + sib.slice(0, 1500) : "") + "\n\nNEED\n" + (t || "(split the parent epic)");
          loadAIjs().then(function (AI) { return AI.generate("story", prompt); }).then(function (r) {
            if (mode === "story") r = { stories: [r.stories ? r.stories[0] : r] };
            if (!r || !(r.stories || []).length) throw new Error(L("The AI did not return stories. Try again with more detail.", "A IA não retornou histórias. Tente de novo com mais detalhes."));
            res = r; step2(t);
          }).catch(function (err) { go.disabled = false; go.innerHTML = IC("spark", 14) + " " + L("Generate", "Gerar"); B.querySelector("#aiSteps").hidden = true; er.hidden = false; er.textContent = (err && err.message) || String(err); });
        };
      }
      function step2(txt) {
        tab(2);
        const ep = mode === "epic" ? res.epic || {} : null, PTS = [1, 2, 3, 5, 8, 13];
        const sCard = function (s, i) { return '<article class="ai-story"><header><label class="chk"><input type="checkbox" data-inc="' + i + '" checked> <b>' + L("Story", "História") + " " + (i + 1) + '</b></label><select data-f="points" data-i="' + i + '">' + PTS.map(function (n) { return '<option' + (Number(s.points) === n ? " selected" : "") + ">" + n + "</option>"; }).join("") + '</select><span class="muted small">SP</span></header>' +
          '<input data-f="title" data-i="' + i + '" value="' + esc(s.title || "") + '" maxlength="140">' +
          '<div class="ai-asw"><label>' + L("As", "Como") + '<input data-f="as" data-i="' + i + '" value="' + esc(s.as || "") + '"></label><label>' + L("I want", "quero") + '<input data-f="want" data-i="' + i + '" value="' + esc(s.want || "") + '"></label><label>' + L("so that", "para") + '<input data-f="so" data-i="' + i + '" value="' + esc(s.so || "") + '"></label></div>' +
          "<label>" + L("Description", "Descrição") + '<textarea rows="2" data-f="description" data-i="' + i + '">' + esc(s.description || "") + "</textarea></label>" +
          "<label>" + L("Acceptance criteria (one per line)", "Critérios de aceite (um por linha)") + '<textarea rows="' + Math.min(6, (s.criteria || []).length + 1) + '" data-f="criteria" data-i="' + i + '">' + esc((s.criteria || []).map(critText).join("\n")) + "</textarea></label></article>"; };
        B.innerHTML = '<form class="pl-form" id="aiR">' + (ep ? '<article class="ai-story ai-epic"><header><b>' + (TYPES.epic.icon || "") + " " + L("Epic", "Épico") + '</b></header><input name="et" value="' + esc(ep.title || "") + '" maxlength="140"><label>' + L("Description and outcome", "Descrição e resultado esperado") + '<textarea name="ed" rows="3">' + esc([ep.description, ep.outcome ? L("Outcome: ", "Resultado esperado: ") + ep.outcome : ""].filter(Boolean).join("\n\n")) + "</textarea></label>" + ((ep.criteria || []).length ? "<label>" + L("Acceptance criteria", "Critérios de aceite") + '<textarea name="ec" rows="3">' + esc(ep.criteria.map(critText).join("\n")) + "</textarea></label>" : "") + "</article>" : "") +
          '<p class="muted small">' + (mode === "story" ? "" : res.stories.length + " " + L("stories – untick the ones you do not want.", "histórias – desmarque as que não quiser.")) + (P() && mode !== "epic" ? " " + L("They will be created under ", "Serão criadas em ") + esc(P().title) + "." : "") + "</p>" +
          res.stories.map(sCard).join("") +
          '<div class="pl-row-end"><button type="button" class="pl-btn" id="aiBack">← ' + L("Back", "Voltar") + '</button><button type="button" class="pl-btn" id="aiAgain">' + IC("sync", 14) + " " + L("Generate again", "Gerar de novo") + '</button><span class="sp"></span><button class="pl-btn primary" id="aiMk">' + L("Create items", "Criar itens") + "</button></div></form>";
        const f = B.querySelector("#aiR");
        f.querySelectorAll("[data-f]").forEach(function (inp) { inp.oninput = inp.onchange = function () { const s = res.stories[inp.dataset.i], k = inp.dataset.f; s[k] = k === "criteria" ? inp.value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean) : k === "points" ? Number(inp.value) : inp.value; }; });
        B.querySelector("#aiBack").onclick = function () { step1(txt); };
        B.querySelector("#aiAgain").onclick = function () { step1(txt); setTimeout(function () { const g = B.querySelector("#aiGo"); if (g) g.click(); }, 30); };
        f.onsubmit = function (e) {
          e.preventDefault();
          const mk = B.querySelector("#aiMk"); mk.disabled = true; mk.textContent = L("Creating…", "Criando…");
          const st = res.stories.filter(function (s, i) { const c = f.querySelector('[data-inc="' + i + '"]'); return !c || c.checked; });
          const sType = hasStory ? "story" : "task";
          let first = null;
          const epicP = ep ? createItem({ type: "epic", title: f.et.value.trim() || ep.title, desc: [f.ed.value, f.ec && f.ec.value ? L("Acceptance criteria:", "Critérios de aceite:") + "\n" + f.ec.value : ""].filter(Boolean).join("\n\n"), parent: parent && data.items[parent] && data.items[parent].type === "initiative" ? parent : undefined, ai: true }) : Promise.resolve(parent || null);
          epicP.then(function (pid) {
            first = ep ? pid : null;
            return st.reduce(function (pr, s) { return pr.then(function () { return createItem({ type: sType, title: s.title, desc: storyDesc(s), points: Number(s.points) || undefined, parent: pid || undefined, ai: true }).then(function (nid) { if (!first) first = nid; }); }); }, Promise.resolve());
          }).then(function () { close(); toast((ep ? 1 : 0) + st.length + " " + L("items created with AI", "itens criados com IA")); if (first) setTimeout(function () { openDrawer(first); }, 400); }, function (err) { mk.disabled = false; mk.textContent = L("Create items", "Criar itens"); toast((err && err.message) || String(err)); });
        };
      }
      step1("");
    });
  }

  /* ================= Project budget =================
     data.budget = { approved, contingency (%), owner, notes, lines/<id> = { cat: capex|opex, group, desc, item?, supplier?, month 'YYYY-MM', planned, committed, actual, note? } } */
  function BGROUPS() {
    return { people: L("Internal people", "Pessoas internas"), services: L("Third parties / services", "Terceiros / serviços"), software: L("Licences and software", "Licenças e software"), cloud: L("Infrastructure and cloud", "Infraestrutura e nuvem"), hardware: L("Hardware and equipment", "Hardware e equipamentos"), training: L("Training", "Treinamento"), travel: L("Travel", "Viagens"), contingency: L("Contingency", "Contingência"), other: L("Other", "Outros") };
  }
  function bLines() { const b = (data.budget || {}).lines || {}; return Object.keys(b).map(function (k) { return Object.assign({ id: k }, b[k]); }).sort(function (a, c) { return String(a.month || "").localeCompare(String(c.month || "")) || (a.created || 0) - (c.created || 0); }); }
  function budgetView(v) {
    const B = data.budget || {}, ls = bLines(), G = BGROUPS(), approved = Number(B.approved) || 0, cont = approved * (Number(B.contingency) || 0) / 100;
    const sum = function (arr, k) { return arr.reduce(function (s, x) { return s + (Number(x[k]) || 0); }, 0); };
    const pl = sum(ls, "planned"), cm = sum(ls, "committed"), ac = sum(ls, "actual"), fc = ls.reduce(function (s, x) { return s + Math.max(Number(x.planned) || 0, (Number(x.actual) || 0) + (Number(x.committed) || 0)); }, 0);
    const bal = approved - ac - cm, its = items(), ib = its.reduce(function (s, i) { return s + (Number(i.budget) || 0); }, 0), ia = its.reduce(function (s, i) { return s + (Number(i.actual) || 0); }, 0);
    const months = {}; ls.forEach(function (x) { const m = x.month || "—"; months[m] = months[m] || { n: m === "—" ? L("No month", "Sem mês") : perLabel(m), p: 0, a: 0 }; months[m].p += Number(x.planned) || 0; months[m].a += Number(x.actual) || 0; });
    const mk = Object.keys(months).sort();
    const split = ["capex", "opex"].map(function (c) { const a = ls.filter(function (x) { return (x.cat || "opex") === c; }); return { c: c, p: sum(a, "planned"), cm: sum(a, "committed"), a: sum(a, "actual") }; });
    const byItem = {}; ls.forEach(function (x) { if (!x.item || !data.items[x.item]) return; byItem[x.item] = byItem[x.item] || { p: 0, a: 0, cm: 0 }; byItem[x.item].p += Number(x.planned) || 0; byItem[x.item].a += Number(x.actual) || 0; byItem[x.item].cm += Number(x.committed) || 0; });
    const tile = function (lbl, val, sub, cls) { return '<div class="bd-tile' + (cls ? " " + cls : "") + '"><span>' + lbl + "</span><b>" + val + "</b>" + (sub ? "<small>" + sub + "</small>" : "") + "</div>"; };
    let h = '<div class="rp bd-wrap"><div class="kp-head"><div><h2>' + L("Project budget", "Orçamento do projeto") + '</h2><p class="muted small">' + L("Approved budget, CAPEX and OPEX lines by month, committed and actual – with balance and forecast.", "Orçamento aprovado, linhas de CAPEX e OPEX por mês, comprometido e realizado – com saldo e projeção.") + "</p></div>" +
      '<div class="bd-acts">' + (canEdit ? '<button class="pl-btn" id="bdSet">' + IC("settings", 15) + " " + L("Approved budget", "Orçamento aprovado") + '</button><button class="pl-btn primary" id="bdNew">' + IC("plus", 15) + " " + L("New line", "Nova linha") + "</button>" : "") + '<button class="pl-btn" id="bdCsv">' + IC("export", 15) + " CSV</button></div></div>" +
      '<div class="bd-tiles">' + tile(L("Approved", "Aprovado"), approved ? money(approved) : "–", B.contingency ? L("incl. contingency ", "inclui contingência ") + nf(B.contingency, 0) + "% (" + money(cont) + ")" : (canEdit ? L("set it in “Approved budget”", "defina em “Orçamento aprovado”") : "")) +
      tile(L("Planned", "Planejado"), money(pl), approved ? pct(pl, approved) + L(" of approved", " do aprovado") : "") + tile(L("Committed", "Comprometido"), money(cm), L("orders and contracts", "pedidos e contratos")) +
      tile(L("Actual", "Realizado"), money(ac), approved ? pct(ac, approved) + L(" used", " consumido") : "", ac > approved && approved ? "bad" : "") +
      tile(L("Balance", "Saldo"), approved ? money(bal) : "–", L("approved − actual − committed", "aprovado − realizado − comprometido"), approved && bal < 0 ? "bad" : approved ? "good" : "") +
      tile(L("Forecast", "Projeção"), money(fc), approved ? (fc > approved ? "⚠ " + L("above approved by ", "acima do aprovado em ") + money(fc - approved) : "✓ " + L("within approved", "dentro do aprovado")) : "", approved && fc > approved ? "bad" : "") + "</div>" +
      (approved ? '<div class="bd-bar" title="' + esc(L("Actual ", "Realizado ") + money(ac) + " · " + L("Committed ", "Comprometido ") + money(cm)) + '"><i class="a" style="width:' + Math.min(100, ac / approved * 100) + '%"></i><i class="c" style="width:' + Math.max(0, Math.min(100 - Math.min(100, ac / approved * 100), cm / approved * 100)) + '%"></i></div><div class="rp-leg row"><span><i style="background:' + RPAL[1] + '"></i>' + L("Actual", "Realizado") + '</span><span><i style="background:' + RPAL[3] + '"></i>' + L("Committed", "Comprometido") + "</span><span>" + L("bar = approved budget", "barra = orçamento aprovado") + "</span></div>" : "") +
      '<div class="rp-grid2"><section class="rp-card"><h3>' + L("Planned × actual by month", "Planejado × realizado por mês") + "</h3>" + (mk.length ? '<div class="rp-scroll">' + bars(mk.map(function (m) { return months[m]; }), [{ k: "p", n: L("Planned", "Planejado"), c: RPAL[0] }, { k: "a", n: L("Actual", "Realizado"), c: RPAL[1] }], cur()) + "</div>" : '<p class="muted small">' + L("Add budget lines to see the months.", "Adicione linhas de orçamento para ver os meses.") + "</p>") + "</section>" +
      '<section class="rp-card"><h3>CAPEX × OPEX</h3><table class="rp-t"><thead><tr><th></th><th>' + L("Planned", "Planejado") + "</th><th>" + L("Committed", "Comprometido") + "</th><th>" + L("Actual", "Realizado") + "</th><th>%</th></tr></thead><tbody>" + split.map(function (s) { return "<tr><td><b>" + s.c.toUpperCase() + "</b></td><td>" + money(s.p) + "</td><td>" + money(s.cm) + "</td><td>" + money(s.a) + "</td><td>" + pct(s.a, s.p) + "</td></tr>"; }).join("") + "</tbody></table>" +
      (Object.keys(byItem).length ? '<h3 class="bd-h3">' + L("By initiative / epic", "Por iniciativa / épico") + '</h3><table class="rp-t"><tbody>' + Object.keys(byItem).map(function (k) { const o = data.items[k], x = byItem[k]; return '<tr data-open="' + k + '"><td>' + esc((o.key ? o.key + " · " : "") + o.title) + "</td><td>" + money(x.p) + '</td><td class="' + (x.a > x.p && x.p ? "late" : "") + '">' + money(x.a) + "</td></tr>"; }).join("") + "</tbody></table>" : "") +
      (ib || ia ? '<p class="muted small">' + L("Also filled in on the planning items: budget ", "Também preenchido nos itens do planejamento: orçado ") + money(ib) + " · " + L("actual ", "realizado ") + money(ia) + L(" (not added to the lines above).", " (não somado às linhas acima).") + "</p>" : "") + "</section></div>" +
      '<section class="rp-card"><h3>' + L("Budget lines", "Linhas do orçamento") + " (" + ls.length + ")</h3>" + (ls.length ? '<div class="rp-scroll"><table class="rp-t bd-tbl"><thead><tr><th>' + L("Month", "Mês") + "</th><th>" + L("Type", "Tipo") + "</th><th>" + L("Group", "Grupo") + "</th><th>" + L("Description", "Descrição") + "</th><th>" + L("Linked to", "Vinculado a") + "</th><th>" + L("Supplier", "Fornecedor") + "</th><th>" + L("Planned", "Planejado") + "</th><th>" + L("Committed", "Comprometido") + "</th><th>" + L("Actual", "Realizado") + "</th><th>" + L("Variance", "Variação") + "</th></tr></thead><tbody>" +
        ls.map(function (x) { const vr = (Number(x.planned) || 0) - (Number(x.actual) || 0), o = x.item && data.items[x.item]; return '<tr data-bl="' + x.id + '"><td>' + esc(x.month ? perLabel(x.month) : "–") + '</td><td><span class="bd-cat ' + (x.cat || "opex") + '">' + (x.cat || "opex").toUpperCase() + "</span></td><td>" + esc(G[x.group] || G.other) + "</td><td>" + esc(x.desc || "") + "</td><td>" + esc(o ? (o.key || o.title) : "") + "</td><td>" + esc(x.supplier || "") + "</td><td>" + money(x.planned) + "</td><td>" + money(x.committed) + "</td><td>" + money(x.actual) + '</td><td class="' + (vr < 0 ? "late" : "") + '">' + money(vr) + "</td></tr>"; }).join("") +
        '</tbody><tfoot><tr><td colspan="6"><b>Total</b></td><td><b>' + money(pl) + "</b></td><td><b>" + money(cm) + "</b></td><td><b>" + money(ac) + "</b></td><td><b>" + money(pl - ac) + "</b></td></tr></tfoot></table></div>" : '<p class="muted small">' + L("No lines yet. Add the planned costs (people, services, licences, infrastructure…) by month and mark CAPEX or OPEX.", "Ainda não há linhas. Adicione os custos planejados (pessoas, serviços, licenças, infraestrutura…) por mês e marque CAPEX ou OPEX.") + "</p>") + "</section></div>";
    v.innerHTML = h;
    const nb = document.getElementById("bdNew"); if (nb) nb.onclick = function () { budgetLine(null); };
    const sb = document.getElementById("bdSet"); if (sb) sb.onclick = budgetSettings;
    document.getElementById("bdCsv").onclick = function () {
      const q = function (s) { s = String(s == null ? "" : s); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const rows = [["Month", "Type", "Group", "Description", "Linked item", "Supplier", "Planned", "Committed", "Actual", "Note"]].concat(ls.map(function (x) { const o = x.item && data.items[x.item]; return [x.month, (x.cat || "opex").toUpperCase(), G[x.group] || "", x.desc, o ? o.key || o.title : "", x.supplier, x.planned, x.committed, x.actual, x.note]; }));
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + rows.map(function (r) { return r.map(q).join(","); }).join("\n")], { type: "text/csv" })); a.download = (info.title || "planning") + " - budget.csv"; a.click();
    };
    v.querySelectorAll("[data-bl]").forEach(function (r) { r.onclick = function () { if (canEdit) budgetLine(r.dataset.bl); }; });
    v.querySelectorAll("[data-open]").forEach(function (r) { r.onclick = function () { openDrawer(r.dataset.open); }; });
  }
  function budgetSettings() {
    const B = data.budget || {}, ppl = Object.keys(members).map(function (k) { return members[k]; });
    modal("<h2>" + L("Approved budget", "Orçamento aprovado") + '</h2><form class="pl-form" id="bsF"><div class="pl-2"><label>' + L("Approved amount", "Valor aprovado") + " (" + cur() + ')<input type="number" min="0" step="any" name="approved" value="' + esc(B.approved == null ? "" : B.approved) + '"></label><label>' + L("Contingency included (%)", "Contingência incluída (%)") + '<input type="number" min="0" max="100" step="any" name="contingency" value="' + esc(B.contingency == null ? "" : B.contingency) + '"></label></div>' +
      "<label>" + L("Budget owner", "Responsável pelo orçamento") + '<select name="owner"><option value="">—</option>' + ppl.map(function (m) { return '<option value="' + esc(m.email) + '"' + (m.email === B.owner ? " selected" : "") + ">" + esc(m.name || m.email) + "</option>"; }).join("") + "</select></label>" +
      "<label>" + L("Notes (approval, cost centre, PO…)", "Observações (aprovação, centro de custo, PO…)") + '<textarea name="notes" rows="2" maxlength="400">' + esc(B.notes || "") + "</textarea></label>" +
      '<div class="pl-row-end"><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + L("Save", "Salvar") + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#bsF");
      f.onsubmit = function (e) { e.preventDefault(); const u = {}; u["budget/approved"] = f.approved.value === "" ? null : Number(f.approved.value); u["budget/contingency"] = f.contingency.value === "" ? null : Number(f.contingency.value); u["budget/owner"] = f.owner.value || null; u["budget/notes"] = f.notes.value.trim() || null; db.ref("planning/" + ID + "/data").update(u).then(function () { close(); toast(L("Saved", "Salvo")); }, fail); };
    });
  }
  function budgetLine(lid) {
    const x = lid ? Object.assign({}, ((data.budget || {}).lines || {})[lid]) : { cat: "opex", group: "services", month: today().slice(0, 7) }, G = BGROUPS();
    const conts = items().filter(isContainer).sort(byOrder);
    const num = function (n, v) { return '<input type="number" min="0" step="any" name="' + n + '" value="' + esc(v == null ? "" : v) + '">'; };
    modal("<h2>" + (lid ? L("Edit budget line", "Editar linha do orçamento") : L("New budget line", "Nova linha do orçamento")) + '</h2><form class="pl-form" id="blF"><div class="pl-2"><label>' + L("Type", "Tipo") + '<select name="cat"><option value="capex">CAPEX – ' + L("investment", "investimento") + '</option><option value="opex">OPEX – ' + L("operating cost", "custo operacional") + "</option></select></label><label>" + L("Group", "Grupo") + '<select name="group">' + Object.keys(G).map(function (k) { return '<option value="' + k + '">' + esc(G[k]) + "</option>"; }).join("") + "</select></label></div>" +
      "<label>" + L("Description", "Descrição") + '<input name="desc" required maxlength="120" value="' + esc(x.desc || "") + '" placeholder="' + esc(L("e.g. Integration consulting – sprint 1-4", "ex.: Consultoria de integração – sprints 1 a 4")) + '"></label>' +
      '<div class="pl-2"><label>' + L("Month", "Mês") + '<input type="month" name="month" value="' + esc(x.month || "") + '"></label><label>' + L("Supplier", "Fornecedor") + '<input name="supplier" list="blSup" maxlength="80" value="' + esc(x.supplier || "") + '"><datalist id="blSup">' + knownSuppliers().map(function (v) { return '<option value="' + esc(v) + '">'; }).join("") + "</datalist></label></div>" +
      "<label>" + L("Linked to (initiative / epic / phase)", "Vinculado a (iniciativa / épico / fase)") + '<select name="item"><option value="">—</option>' + conts.map(function (c) { return '<option value="' + c.id + '"' + (c.id === x.item ? " selected" : "") + ">" + esc((TYPES[c.type] || TYPES.epic).name + " · " + (c.key ? c.key + " · " : "") + c.title) + "</option>"; }).join("") + "</select></label>" +
      '<div class="pl-3"><label>' + L("Planned", "Planejado") + num("planned", x.planned) + "</label><label>" + L("Committed", "Comprometido") + num("committed", x.committed) + "</label><label>" + L("Actual", "Realizado") + num("actual", x.actual) + "</label></div>" +
      "<label>" + L("Note", "Observação") + '<input name="note" maxlength="200" value="' + esc(x.note || "") + '"></label>' +
      '<div class="pl-row-end">' + (lid ? '<button type="button" class="pl-btn ghost danger" id="blDel">' + L("Delete", "Excluir") + "</button>" : "") + '<span class="sp"></span><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + L("Save", "Salvar") + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#blF"); f.cat.value = x.cat || "opex"; f.group.value = x.group || "other";
      f.onsubmit = function (e) {
        e.preventDefault();
        const o = { cat: f.cat.value, group: f.group.value, desc: f.desc.value.trim(), month: f.month.value || null, supplier: f.supplier.value.trim() || null, item: f.item.value || null, note: f.note.value.trim() || null, created: x.created || Date.now(), by: x.by || me.email };
        ["planned", "committed", "actual"].forEach(function (k) { o[k] = f[k].value === "" ? null : Number(f[k].value); });
        Object.keys(o).forEach(function (k) { if (o[k] === null) delete o[k]; });
        save("budget/lines/" + (lid || "l" + Date.now().toString(36)), o).then(function () { close(); toast(L("Budget line saved", "Linha do orçamento salva")); });
      };
      const del = box.querySelector("#blDel"); if (del) del.onclick = function () { save("budget/lines/" + lid, null).then(close); };
    });
  }
  /* ---------------- Reports – behave according to the methodology ----------------
     story points only when the planning estimates in SP (Scrum, or Roadmap + Scrum); lead time and cycle time for every method;
     CFD for Roadmap, Scrum, Kanban and hybrid; burndown/burnup when there are sprints; planned × actual (S-curve) for schedules;
     big numbers are parametrisable (settings/rpHide) and the report exports to CSV, PDF and a one-page summary. */
  function spOn() { const s = data.settings || {}; if (s.useSP === true || s.useSP === false) return s.useSP; return info.method === "scrum" || (info.method === "hybrid" && boardsList().some(function (b) { return b.kind === "scrum"; })); }
  function budgetOn() { const s = data.settings || {}; if (s.useBudget === true || s.useBudget === false) return s.useBudget; return info.method === "waterfall" || items().some(function (i) { return Number(i.budget) || Number(i.actual); }); }
  function cfdOn() { return info.method !== "waterfall"; }
  function scheduleOn() { return info.method === "waterfall" || info.method === "hybrid"; }
  function rpStats(W) {
    const now = Date.now(), D7 = 7 * DAY, td = today(), in7 = n2d(d2n(td) + 7 * DAY);
    const sp = function (l) { return l.reduce(function (n, i) { return n + (Number(i.points) || 0); }, 0); };
    const done = W.filter(function (i) { return cat(i) === "done"; }), fl = W.map(flowOf).filter(function (f) { return f && f.done; });
    const avg = function (k) { return fl.length ? fl.reduce(function (s, f) { return s + f[k]; }, 0) / fl.length : null; };
    let mb = 0, ma = 0; W.forEach(function (i) { mb += Number(i.budget) || 0; ma += Number(i.actual) || 0; });
    const planned = W.filter(function (i) { return i.end && i.end <= td; }).length;
    return {
      sp: sp, done: done, spPl: sp(W), spDn: sp(done), noSp: W.filter(function (i) { return !i.points; }).length,
      lead: avg("net"), cycle: avg("downNet"), thr30: W.filter(function (i) { return i.doneAt && now - i.doneAt <= 30 * DAY; }).length,
      wip: W.filter(function (i) { return cat(i) === "doing"; }).length, blocked: W.filter(function (i) { return openBlock(i); }).length,
      done7: W.filter(function (i) { return i.doneAt && now - i.doneAt <= D7; }).length, upd7: W.filter(function (i) { return i.updated && now - i.updated <= D7; }).length,
      new7: W.filter(function (i) { return i.created && now - i.created <= D7; }).length, due7: W.filter(function (i) { return i.end && i.end >= td && i.end <= in7 && cat(i) !== "done"; }).length,
      overdue: W.filter(overdue).length, mb: mb, ma: ma, plannedPct: W.length ? planned / W.length * 100 : 0, donePct: W.length ? done.length / W.length * 100 : 0
    };
  }
  function rpTiles(W, X) { /* catalogue of big numbers: id, icon, value, label, class, when it applies */
    const S = spOn(), B = budgetOn();
    return [
      { id: "items", ic: "list", v: nf(W.length), l: L("Items", "Itens") },
      { id: "pct", ic: "kr", v: pct(X.done.length, W.length), l: L("% done (items)", "% concluído (itens)"), c: "good" },
      { id: "spPl", ic: "objective", v: nf(X.spPl), l: L("SP planned", "SP planejados"), on: S },
      { id: "spDn", ic: "task", v: nf(X.spDn), l: L("SP delivered", "SP entregues"), c: "good", on: S },
      { id: "spRm", ic: "calendar", v: nf(X.spPl - X.spDn), l: L("SP remaining", "SP restantes"), on: S },
      { id: "spPct", ic: "kr", v: pct(X.spDn, X.spPl), l: L("% delivered (SP)", "% entregue (SP)"), on: S },
      { id: "noSp", ic: "bell", v: nf(X.noSp), l: L("Items without SP", "Itens sem SP"), c: X.noSp ? "warn" : "", on: S },
      { id: "lead", ic: "clock", v: dur(X.lead), l: L("Lead time (avg)", "Lead time (média)") },
      { id: "cycle", ic: "sprint", v: dur(X.cycle), l: L("Cycle time (avg)", "Cycle time (média)") },
      { id: "thr", ic: "trend", v: nf(X.thr30), l: L("Throughput · 30 days", "Vazão · 30 dias") },
      { id: "wip", ic: "kanban", v: nf(X.wip), l: L("Work in progress", "Em andamento (WIP)") },
      { id: "blocked", ic: "lock", v: nf(X.blocked), l: L("Blocked now", "Bloqueados agora"), c: X.blocked ? "bad" : "" },
      { id: "sched", ic: "gantt", v: nf(X.donePct, 0) + "% / " + nf(X.plannedPct, 0) + "%", l: L("Done / planned until today", "Concluído / planejado até hoje"), c: X.donePct + 5 < X.plannedPct ? "warn" : "good", on: scheduleOn() },
      { id: "budget", ic: "kr", v: pct(X.ma, X.mb), l: L("Budget used", "Orçamento consumido"), c: X.ma > X.mb && X.mb ? "bad" : "", on: B },
      { id: "done7", ic: "task", v: nf(X.done7), l: L("completed in the last 7 days", "concluídos nos últimos 7 dias"), sm: 1 },
      { id: "upd7", ic: "pencil", v: nf(X.upd7), l: L("updated in the last 7 days", "atualizados nos últimos 7 dias"), sm: 1 },
      { id: "new7", ic: "plus", v: nf(X.new7), l: L("created in the last 7 days", "criados nos últimos 7 dias"), sm: 1 },
      { id: "due7", ic: "calendar", v: nf(X.due7), l: L("due in the next 7 days", "vencem nos próximos 7 dias"), sm: 1 },
      { id: "overdue", ic: "bell", v: nf(X.overdue), l: L("overdue", "em atraso"), c: X.overdue ? "bad" : "", sm: 1 }
    ].filter(function (t) { return t.on !== false; });
  }
  function rpHidden() { return (data.settings && data.settings.rpHide) || {}; }
  function tilesDialog(all) {
    const hid = rpHidden();
    modal("<h2>" + IC("settings", 18) + " " + L("Big numbers of the report", "Números do relatório") + '</h2><p class="muted small">' + L("Untick what your team does not use. It applies to everyone in this planning.", "Desmarque o que sua equipe não usa. Vale para todos neste planejamento.") + '</p><form class="pl-form" id="tlF"><div class="rp-chk">' +
      all.map(function (t) { return '<label class="chk"><input type="checkbox" name="' + t.id + '"' + (hid[t.id] ? "" : " checked") + "> " + esc(t.l) + "</label>"; }).join("") +
      '</div><div class="pl-row-end"><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + L("Save", "Salvar") + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#tlF");
      f.onsubmit = function (e) { e.preventDefault(); const h = {}; all.forEach(function (t) { if (!f[t.id].checked) h[t.id] = true; }); save("settings/rpHide", Object.keys(h).length ? h : null).then(close); };
    });
  }
  function cfdChart(W, from, to) { /* cumulative flow: to do / in progress / done per day */
    const days = Math.max(1, Math.round((to - from) / DAY)), step = days > 60 ? Math.ceil(days / 60) : 1, pts = [];
    for (let d = 0; d <= days; d += step) {
      const t = from + d * DAY + DAY - 1; let a = 0, b = 0, c = 0;
      W.forEach(function (i) { const cr = Number(i.created) || 0; if (cr > t) return; const dn = Number(i.doneAt) || 0, st = Number(i.startedAt) || 0; if (dn && dn <= t) c++; else if (st && st <= t) b++; else a++; });
      pts.push({ t: from + d * DAY, a: a, b: b, c: c });
    }
    const max = Math.max(1, Math.max.apply(null, pts.map(function (p) { return p.a + p.b + p.c; })));
    const Wd = 560, Hd = 200, x0 = 40, x1 = Wd - 12, y0 = 12, y1 = Hd - 28;
    const X = function (k) { return x0 + (pts.length > 1 ? k / (pts.length - 1) : 0) * (x1 - x0); }, Y = function (v) { return y1 - v / max * (y1 - y0); };
    const band = function (lo, hi, col, name) {
      const top = pts.map(function (p, k) { return X(k) + "," + Y(hi(p)); }), bot = pts.map(function (p, k) { return X(k) + "," + Y(lo(p)); }).reverse();
      return '<polygon points="' + top.concat(bot).join(" ") + '" fill="' + col + '" fill-opacity=".85" stroke="#fff" stroke-width="1"><title>' + esc(name) + "</title></polygon>";
    };
    const C = { c: "#1baf7a", b: "#2a78d6", a: "#eda100" };
    let o = '<svg viewBox="0 0 ' + Wd + " " + Hd + '" class="rp-cfd" role="img" aria-label="CFD">';
    [0, .5, 1].forEach(function (f) { o += '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + Y(max * f) + '" y2="' + Y(max * f) + '" class="rp-grid"/><text x="' + (x0 - 6) + '" y="' + (Y(max * f) + 4) + '" text-anchor="end" class="rp-ax">' + cnum(max * f) + "</text>"; });
    o += band(function () { return 0; }, function (p) { return p.c; }, C.c, L("Done", "Concluído")) + band(function (p) { return p.c; }, function (p) { return p.c + p.b; }, C.b, L("In progress", "Em andamento")) + band(function (p) { return p.c + p.b; }, function (p) { return p.c + p.b + p.a; }, C.a, L("To do", "A fazer"));
    pts.forEach(function (p, k) { const w = (x1 - x0) / Math.max(1, pts.length - 1); o += '<rect x="' + (X(k) - w / 2) + '" y="' + y0 + '" width="' + w + '" height="' + (y1 - y0) + '" fill="transparent"><title>' + esc(fmt(n2d(p.t)) + " · " + L("To do", "A fazer") + " " + p.a + " · " + L("In progress", "Em andamento") + " " + p.b + " · " + L("Done", "Concluído") + " " + p.c) + "</title></rect>"; });
    o += '<text x="' + x0 + '" y="' + (Hd - 8) + '" class="rp-ax">' + fmt(n2d(from)) + '</text><text x="' + x1 + '" y="' + (Hd - 8) + '" text-anchor="end" class="rp-ax">' + fmt(n2d(to)) + "</text></svg>";
    return o + '<div class="rp-leg row"><span><i style="background:' + C.a + '"></i>' + L("To do", "A fazer") + '</span><span><i style="background:' + C.b + '"></i>' + L("In progress", "Em andamento") + '</span><span><i style="background:' + C.c + '"></i>' + L("Done", "Concluído") + "</span></div>";
  }
  function lineChart(series, from, to, maxV, unit, label) { /* simple multi-line chart on one axis */
    const Wd = 520, Hd = 190, x0 = 40, x1 = Wd - 14, y0 = 12, y1 = Hd - 28, span = Math.max(DAY, to - from), max = Math.max(1, maxV);
    const X = function (t) { return x0 + (t - from) / span * (x1 - x0); }, Y = function (v) { return y1 - v / max * (y1 - y0); };
    let o = '<svg viewBox="0 0 ' + Wd + " " + Hd + '" class="rp-burn" role="img" aria-label="' + esc(label) + '">';
    [0, .5, 1].forEach(function (f) { o += '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + Y(max * f) + '" y2="' + Y(max * f) + '" class="rp-grid"/><text x="' + (x0 - 6) + '" y="' + (Y(max * f) + 4) + '" text-anchor="end" class="rp-ax">' + cnum(max * f) + "</text>"; });
    series.forEach(function (s) {
      if (!s.pts.length) return;
      o += '<polyline fill="none" stroke="' + s.c + '" stroke-width="2"' + (s.dash ? ' stroke-dasharray="5 5"' : "") + ' points="' + s.pts.map(function (p) { return X(p[0]) + "," + Y(p[1]); }).join(" ") + '"/>';
      if (!s.dash) o += s.pts.map(function (p) { return '<circle cx="' + X(p[0]) + '" cy="' + Y(p[1]) + '" r="3.5" fill="' + s.c + '" stroke="#fff" stroke-width="2"><title>' + esc(s.n + " · " + fmt(n2d(p[0])) + ": " + nf(p[1], 1) + (unit ? " " + unit : "")) + "</title></circle>"; }).join("");
    });
    o += '<text x="' + x0 + '" y="' + (Hd - 8) + '" class="rp-ax">' + fmt(n2d(from)) + '</text><text x="' + x1 + '" y="' + (Hd - 8) + '" text-anchor="end" class="rp-ax">' + fmt(n2d(to)) + "</text></svg>";
    return o + '<div class="rp-leg row">' + series.map(function (s) { return '<span><i' + (s.dash ? ' class="dash"' : ' style="background:' + s.c + '"') + "></i>" + esc(s.n) + "</span>"; }).join("") + "</div>";
  }
  function reportsView(v) {
    const SP = spOn(), BG = budgetOn();
    const sps = Object.keys(data.sprints || {}).map(function (k) { return Object.assign({ id: k }, data.sprints[k]); }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    const conts = items().filter(isContainer).sort(byOrder);
    const ppl = Object.keys(members).map(function (k) { return members[k]; }).sort(function (a, b) { return (a.name || a.email).localeCompare(b.name || b.email); });
    const sel = function (id, cur, opts) { return '<select data-rp="' + id + '"><option value="">' + L("All", "Tudo") + "</option>" + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>"; };
    const base = items().filter(function (i) { return !isContainer(i) && i.type !== "milestone"; });
    const W = base.filter(function (i) {
      if (rpt.sprint && i.sprint !== rpt.sprint) return false;
      if (rpt.type && i.type !== rpt.type) return false;
      if (rpt.status && statusOf(i).id !== rpt.status) return false;
      if (rpt.who && (i.assignee || "_") !== rpt.who) return false;
      if (rpt.epic && !underOf(i, rpt.epic)) return false;
      return true;
    });
    const X = rpStats(W), sp = X.sp, unitSp = SP && rpt.unit !== "items", td = today();
    const allT = rpTiles(W, X), hid = rpHidden(), showT = allT.filter(function (t) { return !hid[t.id]; });
    const tile = function (t) { return '<div class="rp-tile' + (t.c ? " " + t.c : "") + '"><span class="ic">' + IC(t.ic, 18) + "</span><b>" + t.v + "</b><span>" + t.l + "</span></div>"; };
    const statusRows = statuses().map(function (x) { return { n: x.name, c: stColor(x), v: W.filter(function (i) { return statusOf(i).id === x.id; }).length }; });
    const typeRows = Object.keys(TYPES).filter(function (t) { return !isContainer({ type: t }) && t !== "milestone"; }).map(function (t) { return { n: TYPES[t].name, c: TYPES[t].color, v: W.filter(function (i) { return i.type === t; }).length }; });
    const whoAll = ppl.map(function (m) { return m.email; });
    const whoRows = whoAll.slice(0, 7).map(function (e, k) { return { n: memberName(e), c: RPAL[k], v: W.filter(function (i) { return i.assignee === e; }).length }; });
    const others = W.filter(function (i) { return i.assignee && whoAll.slice(0, 7).indexOf(i.assignee) < 0; }).length;
    if (others) whoRows.push({ n: L("Others", "Outros"), c: "#8a94a6", v: others });
    whoRows.push({ n: L("Unassigned", "Sem responsável"), c: "#c9d1e0", v: W.filter(function (i) { return !i.assignee; }).length });
    /* sprints (closed sprints use the snapshot taken when they were completed) */
    const sprRows = sps.map(function (S) {
      const its = W.filter(function (i) { return i.sprint === S.id; }), dn = its.filter(function (i) { return cat(i) === "done"; });
      const live = { items: its.length, done: dn.length, sp: sp(its), spDone: sp(dn), noSp: its.filter(function (i) { return !i.points; }).length };
      const r = S.state === "closed" && S.report && !rpt.type && !rpt.status && !rpt.who && !rpt.epic ? S.report : live;
      return { id: S.id, n: S.name + (S.state === "active" ? L(" (in progress)", " (em andamento)") : ""), sp: r.sp, dn: r.spDone, rm: Math.max(0, r.sp - r.spDone), noSp: r.noSp, items: r.items, idone: r.done };
    });
    const epRows = conts.filter(function (c) { return c.type !== "initiative" || !conts.some(function (e) { return e.parent === c.id; }); }).map(function (c) {
      const its = W.filter(function (i) { return laneOf(i) === c.id; }), dn = its.filter(function (i) { return cat(i) === "done"; });
      const a = unitSp ? sp(dn) : dn.length, t = unitSp ? sp(its) : its.length;
      return { n: (c.key ? c.key + " " : "") + c.title, a: a, b: Math.max(0, t - a) };
    }).filter(function (r) { return r.a + r.b > 0; }).sort(function (x, y) { return (y.a + y.b) - (x.a + x.b); });
    /* burndown + burnup of the selected (or active) sprint */
    const bs = data.sprints && (data.sprints[rpt.sprint] ? Object.assign({ id: rpt.sprint }, data.sprints[rpt.sprint]) : sps.find(function (S) { return S.state === "active"; }) || sps.filter(function (S) { return S.state === "closed"; }).slice(-1)[0]);
    let burn = "", bup = "", sprintRep = "";
    if (bs && bs.start && bs.end) {
      const its = base.filter(function (i) { return i.sprint === bs.id; }), meas = function (l) { return unitSp ? sp(l) : l.length; }, tot = meas(its);
      const s0 = d2n(bs.start), e0 = d2n(bs.end), lim = Math.min(e0, d2n(td)), rem = [], up = [];
      for (let t = s0; t <= lim; t += DAY) { const dn = its.filter(function (i) { return cat(i) === "done" && i.doneAt && i.doneAt <= t + DAY; }); rem.push([t, tot - meas(dn)]); up.push([t, meas(dn)]); }
      const u = unitSp ? "SP" : L("items", "itens");
      burn = lineChart([{ n: L("Ideal", "Ideal"), c: "#8a94a6", dash: 1, pts: [[s0, tot], [e0, 0]] }, { n: L("Remaining", "Restante"), c: "#2a78d6", pts: rem }], s0, e0, tot, u, "Burndown");
      bup = lineChart([{ n: L("Scope", "Escopo"), c: "#8a94a6", dash: 1, pts: [[s0, tot], [e0, tot]] }, { n: L("Done", "Concluído"), c: "#1baf7a", pts: up }], s0, e0, tot, u, "Burnup");
      const dn = its.filter(function (i) { return cat(i) === "done"; }), left = its.filter(function (i) { return cat(i) !== "done"; });
      const blk = its.filter(function (i) { return blocksOf(i).some(function (b) { return b.since >= s0 && b.since <= e0 + DAY; }); });
      sprintRep = '<section class="rp-card rp-sprint"><h3>' + IC("sprint", 16) + " " + L("Sprint report", "Relatório da sprint") + " · " + esc(bs.name) + '</h3><p class="muted small">' + fmt(bs.start) + " – " + fmt(bs.end) + (bs.goal ? " · " + L("Goal: ", "Objetivo: ") + esc(bs.goal) : "") + "</p>" +
        '<div class="flow-m"><div><span>' + L("Committed", "Comprometido") + "</span><b>" + nf(tot) + "</b><small>" + u + "</small></div><div><span>" + L("Delivered", "Entregue") + "</span><b>" + nf(meas(dn)) + "</b><small>" + pct(meas(dn), tot) + "</small></div><div><span>" + L("Not finished", "Não concluído") + "</span><b>" + nf(meas(left)) + "</b><small>" + left.length + " " + L("items", "itens") + '</small></div><div class="bl"><span>' + L("Impediments", "Impedimentos") + "</span><b>" + blk.length + "</b><small>" + L("in the sprint", "na sprint") + "</small></div></div>" +
        (left.length ? '<h3 class="bd-h3">' + L("Carried over / still open", "Fica para a próxima / em aberto") + '</h3><table class="rp-t"><tbody>' + left.slice(0, 12).map(function (i) { return '<tr data-open="' + i.id + '"><td><b>' + esc(i.key || "") + "</b> " + esc(i.title) + "</td><td>" + esc(statusOf(i).name) + '</td><td class="n">' + (SP ? nf(Number(i.points) || 0) + " SP" : "") + "</td></tr>"; }).join("") + "</tbody></table>" : "") + "</section>";
    }
    /* planned × actual (S-curve) for schedules */
    let scurve = "";
    if (scheduleOn()) {
      const sch = W.filter(function (i) { return i.end; });
      if (sch.length) {
        const st0 = Math.min.apply(null, sch.map(function (i) { return d2n(i.start || i.end); })), en0 = Math.max.apply(null, sch.map(function (i) { return d2n(i.end); }));
        const span = Math.max(DAY, en0 - st0), step = Math.max(DAY, Math.ceil(span / 40 / DAY) * DAY), pl = [], ac = [], nowN = Date.now();
        for (let t = st0; t <= en0 + step; t += step) { const tt = Math.min(t, en0); pl.push([tt, sch.filter(function (i) { return d2n(i.end) <= tt; }).length / sch.length * 100]); if (tt <= nowN) ac.push([tt, sch.filter(function (i) { return i.doneAt && i.doneAt <= tt + DAY; }).length / sch.length * 100]); if (tt === en0) break; }
        scurve = '<section class="rp-card"><h3>' + L("Planned × actual (schedule)", "Planejado × realizado (cronograma)") + "</h3>" + lineChart([{ n: L("Planned", "Planejado"), c: "#8a94a6", dash: 1, pts: pl }, { n: L("Actual", "Realizado"), c: "#2a78d6", pts: ac }], st0, en0, 100, "%", L("Planned × actual", "Planejado × realizado")) + "</section>";
      }
    }
    let cfd = "";
    if (cfdOn() && W.length) {
      const sp0 = rpt.sprint && bs && bs.start ? d2n(bs.start) : d2n(td) - 30 * DAY, sp1 = rpt.sprint && bs && bs.end ? Math.min(d2n(bs.end), d2n(td)) : d2n(td);
      cfd = '<section class="rp-card"><h3>CFD · ' + L("cumulative flow", "fluxo cumulativo") + ' <small class="muted">(' + (rpt.sprint ? esc(bs ? bs.name : "") : L("last 30 days", "últimos 30 dias")) + ")</small></h3>" + cfdChart(W, sp0, sp1) + "</section>";
    }
    const tbl = function (head, rows, tot) { return '<div class="rp-tw"><table class="rp-t"><thead><tr>' + head.map(function (h, k) { return "<th" + (k ? ' class="n"' : "") + ">" + h + "</th>"; }).join("") + "</tr></thead><tbody>" + rows.map(function (r) { return "<tr>" + r.map(function (c, k) { return "<td" + (k ? ' class="n"' : "") + ">" + c + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody>" + (tot ? "<tfoot><tr>" + tot.map(function (c, k) { return "<td" + (k ? ' class="n"' : "") + ">" + c + "</td>"; }).join("") + "</tr></tfoot>" : "") + "</table></div>"; };
    const sum = function (k) { return sprRows.reduce(function (n, r) { return n + (r[k] || 0); }, 0); };
    const MN = method().name;
    v.innerHTML = '<div class="rp">' +
      '<div class="rp-filters">' +
      (sps.length ? "<label>" + L("Sprint / cycle", "Sprint / ciclo") + sel("sprint", rpt.sprint, sps.map(function (S) { return [S.id, S.name]; })) + "</label>" : "") +
      "<label>" + L("Type", "Tipo") + sel("type", rpt.type, Object.keys(TYPES).filter(function (t) { return !isContainer({ type: t }) && t !== "milestone"; }).map(function (t) { return [t, TYPES[t].name]; })) + "</label>" +
      "<label>Status" + sel("status", rpt.status, statuses().map(function (x) { return [x.id, x.name]; })) + "</label>" +
      "<label>" + L("Assignee", "Responsável") + sel("who", rpt.who, ppl.map(function (m) { return [m.email, m.name || m.email]; }).concat([["_", L("Unassigned", "Sem responsável")]])) + "</label>" +
      "<label>" + L("Epic / initiative", "Épico / iniciativa") + sel("epic", rpt.epic, conts.map(function (c) { return [c.id, (c.key ? c.key + " " : "") + c.title]; })) + "</label>" +
      (SP ? '<label>' + L("Measure", "Medida") + '<select data-rp="unit"><option value="sp"' + (unitSp ? " selected" : "") + '>Story points</option><option value="items"' + (!unitSp ? " selected" : "") + ">" + L("Items", "Itens") + "</option></select></label>" : "") +
      '<span class="rp-acts">' + (canEdit ? '<button class="pl-btn sm ghost" id="rpTiles" title="' + L("Choose the big numbers", "Escolher os números") + '">' + IC("settings", 14) + " " + L("Numbers", "Números") + "</button>" : "") +
      '<button class="pl-btn sm ghost" id="rpCsv">' + IC("export", 14) + ' CSV</button><button class="pl-btn sm ghost" id="rpPdf">' + IC("print", 14) + ' PDF</button><button class="pl-btn sm" id="rpOne">' + IC("dashboard", 14) + " One page</button></span></div>" +
      '<p class="rp-mode muted small">' + IC(method().icon, 13) + " " + esc(MN) + " · " + (SP ? L("estimated in story points", "estimado em story points") : L("measured in items (no story points)", "medido em itens (sem story points)")) + (canEdit ? ' · <a href="#" id="rpCfg">' + L("change", "alterar") + "</a>" : "") + "</p>" +
      (showT.filter(function (t) { return !t.sm; }).length ? '<div class="rp-tiles">' + showT.filter(function (t) { return !t.sm; }).map(tile).join("") + "</div>" : "") +
      (showT.filter(function (t) { return t.sm; }).length ? '<div class="rp-tiles sm">' + showT.filter(function (t) { return t.sm; }).map(tile).join("") + "</div>" : "") +
      '<div class="rp-grid3">' +
      '<section class="rp-card"><h3>' + L("Items by status", "Itens por status") + "</h3>" + donut(statusRows, W.length, L("Items by status", "Itens por status")) + "</section>" +
      '<section class="rp-card"><h3>' + L("Items by type", "Itens por tipo") + "</h3>" + donut(typeRows, W.length, L("Items by type", "Itens por tipo")) + "</section>" +
      '<section class="rp-card"><h3>' + L("Items by assignee", "Itens por responsável") + "</h3>" + donut(whoRows, W.length, L("Items by assignee", "Itens por responsável")) + "</section></div>" +
      (cfd || scurve ? '<div class="rp-grid2">' + cfd + scurve + "</div>" : "") +
      flowSection(W) +
      (sprRows.length ? (sprintRep ? '<div class="rp-grid2">' + sprintRep + '<section class="rp-card"><h3>Burndown · ' + esc(bs.name) + "</h3>" + burn + '<h3 class="bd-h3">Burnup · ' + esc(bs.name) + "</h3>" + bup + "</section></div>" : "") +
        (SP ? '<div class="rp-grid2"><section class="rp-card"><h3>' + L("Sprint delivery · story points", "Entrega por sprint · story points") + "</h3>" + tbl(["Sprint", L("SP planned", "SP planejados"), L("SP delivered", "SP entregues"), L("SP remaining", "SP restantes"), L("No SP (items)", "Sem SP (itens)"), L("% delivered", "% entregue")], sprRows.map(function (r) { return [esc(r.n), nf(r.sp), nf(r.dn), nf(r.rm), nf(r.noSp), pct(r.dn, r.sp)]; }), ["Total", nf(sum("sp")), nf(sum("dn")), nf(sum("rm")), nf(sum("noSp")), pct(sum("dn"), sum("sp"))]) + "</section>" +
          '<section class="rp-card"><h3>' + L("Velocity · planned × delivered (SP)", "Velocidade · planejado × entregue (SP)") + '</h3><div class="rp-scroll">' + bars(sprRows, [{ k: "sp", n: L("SP planned", "SP planejados"), c: "#2a78d6" }, { k: "dn", n: L("SP delivered", "SP entregues"), c: "#1baf7a" }, { k: "rm", n: L("SP remaining", "SP restantes"), c: "#6250d6" }], "SP") + "</div></section></div>" : "") +
        '<div class="rp-grid2"><section class="rp-card"><h3>' + L("Sprint delivery · items", "Entrega por sprint · itens") + "</h3>" + tbl(["Sprint", L("Items", "Itens"), L("Items done", "Itens concluídos"), L("Items remaining", "Itens restantes"), L("% done", "% concluído")], sprRows.map(function (r) { return [esc(r.n), nf(r.items), nf(r.idone), nf(r.items - r.idone), pct(r.idone, r.items)]; }), ["Total", nf(sum("items")), nf(sum("idone")), nf(sum("items") - sum("idone")), pct(sum("idone"), sum("items"))]) + "</section>" +
        (SP ? "" : '<section class="rp-card"><h3>' + L("Items per sprint", "Itens por sprint") + '</h3><div class="rp-scroll">' + bars(sprRows, [{ k: "items", n: L("Items", "Itens"), c: "#2a78d6" }, { k: "idone", n: L("Done", "Concluídos"), c: "#1baf7a" }], L("items", "itens")) + "</div></section>") + "</div>"
        : (info.method === "scrum" || SP ? '<section class="rp-card rp-hint"><p class="muted small">' + L("Sprint reports (sprint report, burndown, burnup and velocity) appear when the planning has sprints.", "Os relatórios de sprint (relatório da sprint, burndown, burnup e velocidade) aparecem quando o planejamento tem sprints.") + "</p></section>" : "")) +
      '<div class="rp-grid2"><section class="rp-card"><h3>' + (info.method === "waterfall" ? L("Phases · delivered and remaining", "Fases · entregue e restante") : L("Epics · delivered and remaining", "Épicos · entregue e restante")) + " (" + (unitSp ? "SP" : L("items", "itens")) + ")</h3>" + (epRows.length ? hstack(epRows, "a", "b", L("Delivered", "Entregue"), L("Remaining", "Restante")) : '<p class="muted small">' + L("No items linked to epics yet.", "Ainda não há itens ligados a épicos.") + "</p>") + "</section>" +
      (BG ? '<section class="rp-card"><h3>' + L("Budget × actual", "Orçado × realizado") + "</h3>" + (X.mb || X.ma ? '<div class="rp-money"><div><span>' + L("Budget", "Orçado") + "</span><b>" + money(X.mb) + "</b></div><div><span>" + L("Actual", "Realizado") + '</span><b class="' + (X.ma > X.mb && X.mb ? "late" : "") + '">' + money(X.ma) + "</b></div><div><span>" + L("Used", "Consumido") + "</span><b>" + pct(X.ma, X.mb) + '</b></div></div><span class="pbar big"><i style="width:' + Math.min(100, X.mb ? X.ma / X.mb * 100 : 0) + "%;background:" + (X.ma > X.mb ? "#e5484d" : "#1baf7a") + '"></i></span>' : '<p class="muted small">' + L("Fill in budget and actual on the items to follow the costs.", "Preencha orçado e realizado nos itens para acompanhar os custos.") + "</p>") + "</section>" : "") + "</div>" +
      '<p class="muted small rp-foot">' + L("Updated live from this planning", "Atualizado ao vivo a partir deste planejamento") + " · " + new Date().toLocaleString(window.MB_LOCALE || (PT ? "pt-BR" : "en-GB"), { dateStyle: "short", timeStyle: "short" }) + "</p></div>";
    v.querySelectorAll("[data-rp]").forEach(function (sl) { sl.onchange = function () { rpt[sl.dataset.rp] = sl.value; reportsView(v); }; });
    v.querySelectorAll(".rp-t tr[data-open]").forEach(function (r) { r.onclick = function () { openDrawer(r.dataset.open); }; });
    const tb = document.getElementById("rpTiles"); if (tb) tb.onclick = function () { tilesDialog(allT); };
    const cf = document.getElementById("rpCfg"); if (cf) cf.onclick = function (e) { e.preventDefault(); planSettingsDialog(); };
    document.getElementById("rpPdf").onclick = function () { document.body.classList.add("print-rp"); setTimeout(function () { window.print(); document.body.classList.remove("print-rp"); }, 50); };
    document.getElementById("rpOne").onclick = function () { onePage(W, X, showT); };
    document.getElementById("rpCsv").onclick = function () {
      const q = function (x) { x = x == null ? "" : String(x); return /[",;\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
      const lines = [[L("Report", "Relatório"), info.title].map(q).join(";"), [L("Method", "Método"), MN].map(q).join(";"), [L("Generated", "Gerado em"), new Date().toLocaleString(window.MB_LOCALE || "pt-BR")].map(q).join(";"), "", [L("Indicator", "Indicador"), L("Value", "Valor")].map(q).join(";")]
        .concat(showT.map(function (t) { return [t.l, t.v].map(q).join(";"); }));
      if (sprRows.length) { lines.push("", ["Sprint"].concat(SP ? [L("SP planned", "SP planejados"), L("SP delivered", "SP entregues"), L("SP remaining", "SP restantes")] : []).concat([L("Items", "Itens"), L("Items done", "Itens concluídos")]).map(q).join(";")); sprRows.forEach(function (r) { lines.push([r.n].concat(SP ? [r.sp, r.dn, r.rm] : []).concat([r.items, r.idone]).map(q).join(";")); }); }
      lines.push("", [L("Key", "Chave"), L("Title", "Título"), L("Type", "Tipo"), "Status", L("Assignee", "Responsável"), L("Start", "Início"), L("End", "Fim")].concat(SP ? ["Story points"] : []).concat(["Lead time (d)", "Cycle time (d)"]).map(q).join(";"));
      W.forEach(function (i) { const f = flowOf(i) || {}; lines.push([i.key, i.title, (TYPES[i.type] || TYPES.task).name, statusOf(i).name, i.assignee ? memberName(i.assignee) : "", i.start, i.end].concat(SP ? [i.points] : []).concat([f.done ? nf(f.net / DAY, 1) : "", f.done ? nf(f.downNet / DAY, 1) : ""]).map(q).join(";")); });
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv" })); a.download = (info.title || "planning") + "-relatorio.csv"; a.click();
    };
  }
  /* one-page status report (print / save as PDF) */
  function onePage(W, X, showT) {
    const td = today(), in14 = n2d(d2n(td) + 14 * DAY), all = items();
    const ms = all.filter(function (i) { return i.type === "milestone" && i.end; }).sort(function (a, b) { return a.end < b.end ? -1 : 1; });
    const msLate = ms.filter(function (i) { return cat(i) !== "done" && i.end < td; }), msNext = ms.filter(function (i) { return cat(i) !== "done" && i.end >= td; }).slice(0, 5);
    const next = W.filter(function (i) { return cat(i) !== "done" && i.end && i.end >= td && i.end <= in14; }).sort(function (a, b) { return a.end < b.end ? -1 : 1; }).slice(0, 8);
    const risks = W.filter(overdue).slice(0, 6), blk = W.map(function (i) { return { i: i, b: openBlock(i) }; }).filter(function (x) { return x.b; }).slice(0, 6);
    const os = okrs();
    const health = X.overdue || blk.length ? (X.overdue > 5 || msLate.length ? ["bad", L("Off track", "Fora do plano")] : ["warn", L("Attention", "Atenção")]) : ["good", L("On track", "No plano")];
    const li = function (i, extra) { return "<li><b>" + esc(i.key || "") + "</b> " + esc(i.title) + (extra ? ' <span class="m">' + extra + "</span>" : "") + "</li>"; };
    const box = function (t, body) { return "<section><h2>" + t + "</h2>" + body + "</section>"; };
    const none = '<p class="m">' + L("Nothing to report.", "Nada a reportar.") + "</p>";
    const html = '<!doctype html><html lang="' + (PT ? "pt-BR" : "en") + '"><head><meta charset="utf-8"><title>One page · ' + esc(info.title) + "</title><style>" +
      "@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font:12px/1.45 Inter,Arial,sans-serif;color:#172036;margin:0;padding:18px}header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0e1a33;padding-bottom:10px;margin-bottom:12px}" +
      "h1{font:700 20px Poppins,Arial,sans-serif;margin:0}h2{font:700 13px Poppins,Arial,sans-serif;margin:0 0 6px;color:#1f4fa3;text-transform:uppercase;letter-spacing:.03em}.m{color:#626a80}" +
      ".st{padding:6px 12px;border-radius:99px;font-weight:700}.st.good{background:#e3f6ec;color:#1b7f4b}.st.warn{background:#fff5c8;color:#8a6400}.st.bad{background:#fde7e9;color:#b42318}" +
      ".t{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}.t div{border:1px solid #e3e7ef;border-radius:8px;padding:8px}.t b{display:block;font:700 18px Poppins,Arial,sans-serif}.t span{color:#4a5468;font-size:11px}" +
      ".g{display:grid;grid-template-columns:1fr 1fr;gap:12px}section{border:1px solid #e3e7ef;border-radius:8px;padding:10px}ul{margin:0;padding-left:16px}li{margin:2px 0}.bar{height:8px;background:#eef1f6;border-radius:6px;overflow:hidden;margin:3px 0 6px}.bar i{display:block;height:100%;background:#1baf7a}" +
      ".pb{position:fixed;bottom:14px;right:14px;padding:8px 14px;border:0;border-radius:8px;background:#2f80ed;color:#fff;font-weight:700;cursor:pointer}@media print{.pb{display:none}}</style></head><body>" +
      '<button class="pb" onclick="print()">' + L("Print / save PDF", "Imprimir / salvar PDF") + "</button>" +
      "<header><div><h1>" + esc(info.title) + '</h1><div class="m">' + esc(wsInfo.name || "") + " · " + esc(method().name) + " · " + new Date().toLocaleDateString(window.MB_LOCALE || "pt-BR") + '</div></div><span class="st ' + health[0] + '">' + health[1] + "</span></header>" +
      '<div class="t">' + showT.filter(function (t) { return !t.sm; }).slice(0, 8).map(function (t) { return "<div><b>" + t.v + "</b><span>" + t.l + "</span></div>"; }).join("") + "</div>" +
      '<div class="g">' +
      box(L("Milestones", "Marcos"), (msLate.length || msNext.length ? "<ul>" + msLate.map(function (i) { return li(i, "⚠ " + fmt(i.end)); }).join("") + msNext.map(function (i) { return li(i, fmt(i.end)); }).join("") + "</ul>" : none)) +
      box("OKRs", os.length ? os.slice(0, 5).map(function (o) { const p = objProgress(o); return "<div><b>" + esc(o.title) + '</b> <span class="m">' + p + '%</span><div class="bar"><i style="width:' + p + '%"></i></div></div>'; }).join("") : none) +
      box(L("Risks and impediments", "Riscos e impedimentos"), risks.length || blk.length ? "<ul>" + blk.map(function (x) { return li(x.i, L("blocked: ", "bloqueado: ") + esc(x.b.desc || (BLOCKT()[x.b.type] || {}).name || "")); }).join("") + risks.map(function (i) { return li(i, L("overdue since ", "atrasado desde ") + fmt(i.end)); }).join("") + "</ul>" : none) +
      box(L("Next steps (14 days)", "Próximos passos (14 dias)"), next.length ? "<ul>" + next.map(function (i) { return li(i, fmt(i.end) + (i.assignee ? " · " + esc(memberName(i.assignee)) : "")); }).join("") + "</ul>" : none) +
      (budgetOn() && (X.mb || X.ma) ? box(L("Budget", "Orçamento"), "<div>" + L("Budget", "Orçado") + ": <b>" + money(X.mb) + "</b> · " + L("Actual", "Realizado") + ": <b>" + money(X.ma) + "</b> (" + pct(X.ma, X.mb) + ')</div><div class="bar"><i style="width:' + Math.min(100, X.mb ? X.ma / X.mb * 100 : 0) + "%;background:" + (X.ma > X.mb ? "#e5484d" : "#1baf7a") + '"></i></div>') : "") +
      "</div><p class=\"m\" style=\"margin-top:10px\">CM Collaborator · " + L("generated from the planning", "gerado a partir do planejamento") + "</p></body></html>";
    const w = window.open("", "_blank"); if (!w) { toast(L("Allow pop-ups to open the one page.", "Permita pop-ups para abrir o one page.")); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }
  /* planning settings: estimation, budget, indicators tab */
  function planSettingsDialog() {
    const s = data.settings || {};
    const tri = function (name, val, auto) { return '<select name="' + name + '"><option value="auto"' + (val !== true && val !== false ? " selected" : "") + ">" + L("Automatic", "Automático") + " (" + (auto ? L("on", "ligado") : L("off", "desligado")) + ')</option><option value="on"' + (val === true ? " selected" : "") + ">" + L("On", "Ligado") + '</option><option value="off"' + (val === false ? " selected" : "") + ">" + L("Off", "Desligado") + "</option></select>"; };
    const autoSP = info.method === "scrum" || (info.method === "hybrid" && boardsList().some(function (b) { return b.kind === "scrum"; })), autoB = info.method === "waterfall" || items().some(function (i) { return Number(i.budget) || Number(i.actual); });
    modal("<h2>" + IC("settings", 18) + " " + L("Planning settings", "Configurações do planejamento") + '</h2><p class="muted small">' + esc(method().name) + " · " + L("the reports follow these choices.", "os relatórios seguem estas escolhas.") + '</p><form class="pl-form" id="psF">' +
      "<label>" + L("Story points (Scrum estimation)", "Story points (estimativa Scrum)") + tri("sp", s.useSP, autoSP) + '<small class="muted">' + L("Roadmap and Waterfall measure in items, % done and lead/cycle time. Turn on for a Roadmap + Scrum (hybrid) planning.", "Roadmap e Cascata medem em itens, % concluído e lead/cycle time. Ligue para um planejamento Roadmap + Scrum (híbrido).") + "</small></label>" +
      "<label>" + L("Budget", "Orçamento") + tri("bg", s.useBudget, autoB) + '<small class="muted">' + L("Off hides the Budget tab and the costs in the reports.", "Desligado esconde a aba Orçamento e os custos nos relatórios.") + "</small></label>" +
      '<label class="chk"><input type="checkbox" name="kpi"' + (kpiOn() ? " checked" : "") + "> " + L("Show the Indicators tab (own KPIs)", "Mostrar a aba Indicadores (KPIs próprios)") + "</label>" +
      '<div class="pl-row-end"><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + L("Save", "Salvar") + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#psF"), tv = function (x) { return x === "on" ? true : x === "off" ? false : null; };
      f.onsubmit = function (e) { e.preventDefault(); const u = {}; u["settings/useSP"] = tv(f.sp.value); u["settings/useBudget"] = tv(f.bg.value); u["settings/kpiTab"] = f.kpi.checked; db.ref("planning/" + ID + "/data").update(u).then(function () { close(); toast(L("Settings saved", "Configurações salvas")); }, function (er) { toast(er.message); }); };
    });
  }
  /* board options per planning (kept in this browser) */
  function kbOpt() { try { return JSON.parse(localStorage.getItem("cmcollab:kb:" + ID) || "{}"); } catch (e) { return {}; } }
  function kbSave(o) { try { localStorage.setItem("cmcollab:kb:" + ID, JSON.stringify(o)); } catch (e) { /* ignore */ } }
  function underOf(it, cid) { let p = it.parent, g = 0; while (p && g++ < 12) { if (p === cid) return true; p = (data.items[p] || {}).parent; } return false; }
  function laneOf(it) { /* nearest epic/phase above the card (or its initiative when there is no epic) */
    let p = it.parent, g = 0, ini = "";
    while (p && g++ < 12) { const x = data.items[p] || {}; if (x.type === "epic" || x.type === "phase") return p; if (x.type === "initiative" && !ini) ini = p; p = x.parent; }
    return ini;
  }
  function orderAt(list, beforeId) {
    const i = beforeId ? list.findIndex(function (x) { return x.id === beforeId; }) : -1;
    if (i < 0) return (list.length ? (list[list.length - 1].order || 0) : 0) + 1000;
    const prev = i > 0 ? (list[i - 1].order || 0) : (list[i].order || 0) - 2000;
    return (prev + (list[i].order || 0)) / 2;
  }
  /* ITSM link: item created from a problem / change / improvement of a service centre (module /itsm/) */
  function itsmBadge(it, link) {
    const x = it.src; if (!x || !x.itsm) return "";
    const inner = IC("itsm", 13) + " " + esc(x.key || "ITSM") + (x.status ? " · " + esc(x.status) : "");
    return link ? '<a class="pl-itsm" href="../itsm/?id=' + encodeURIComponent(x.itsm) + "&rec=" + encodeURIComponent(x.rec || "") + '" title="' + esc(L("Open in ITSM", "Abrir no ITSM") + (x.title ? " · " + x.title : "")) + '">' + inner + " ↗</a>" : '<span class="pl-itsm" title="' + esc(L("From ITSM", "Origem: ITSM") + (x.title ? " · " + x.title : "")) + '">' + inner + "</span>";
  }
  function card(it) {
    const T = TYPES[it.type] || TYPES.task, par = it.parent && data.items[it.parent];
    return '<article class="kb-card' + (overdue(it) ? " late" : "") + (openBlock(it) ? " blocked" : "") + '" draggable="' + canEdit + '" data-id="' + it.id + '"><div class="kt">' + esc(it.title) + "</div>" + blockBadge(it) + itsmBadge(it, false) +
      (par ? '<span class="ep" style="--c:' + (TYPES[par.type] || TYPES.epic).color + '">' + esc(par.title) + "</span>" : "") +
      '<div class="km"><span class="ti" style="color:' + T.color + '">' + T.icon + '</span><span class="tk">' + esc(it.key || "") + "</span>" + (it.points ? '<span class="pts">' + esc(it.points) + "</span>" : "") +
      (it.end ? '<span class="due">' + fmt(it.end) + "</span>" : "") + (it.watch && Object.keys(it.watch).length ? '<span class="kw" title="' + esc(L("Alerts on: ", "Alertas ativos: ") + Object.keys(it.watch).map(function (k) { return memberName(it.watch[k].email); }).join(", ")) + '">' + IC("bell", 13) + "</span>" : "") + '<span class="sp"></span>' + (it.assignee ? '<span class="av" title="' + esc(memberName(it.assignee)) + '">' + esc(initials(it.assignee)) + "</span>" : "") + "</div></article>";
  }
  function dnd(root, itemSel, zoneSel, onDrop) {
    let dragId = null;
    root.querySelectorAll(itemSel).forEach(function (c) {
      c.addEventListener("dragstart", function (e) { dragId = c.dataset.id; dragging = true; c.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", dragId); } catch (x) { /* ignore */ } });
      c.addEventListener("dragend", function () { c.classList.remove("dragging"); dragging = false; root.querySelectorAll(".drop").forEach(function (z) { z.classList.remove("drop"); }); if (pending) { pending = false; renderView(); } });      /* touch (Android / iOS): long-press, then drag the card to another column */
      c.addEventListener("pointerdown", function (e) {
        if (e.pointerType !== "touch") return;
        const sx = e.clientX, sy = e.clientY; let started = false, ghost = null, zone = null, last = e;
        const timer = setTimeout(function () {
          started = true; dragging = true; c.classList.add("dragging");
          const r = c.getBoundingClientRect();
          ghost = c.cloneNode(true); ghost.classList.add("kb-ghost"); ghost.style.width = r.width + "px"; ghost.style.left = r.left + "px"; ghost.style.top = r.top + "px"; document.body.appendChild(ghost);
          if (navigator.vibrate) navigator.vibrate(12);
        }, 280);
        function at(ev) { const el = document.elementFromPoint(ev.clientX, ev.clientY); return el && el.closest(zoneSel); }
        function mv(ev) {
          last = ev;
          if (!started) { if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 10) end(false); return; }
          ghost.style.transform = "translate(" + (ev.clientX - sx) + "px," + (ev.clientY - sy) + "px) rotate(2deg)";
          const z = at(ev); if (z !== zone) { if (zone) zone.classList.remove("drop"); zone = z; if (zone) zone.classList.add("drop"); }
          const sc = c.closest(".kb"); if (sc) { const rr = sc.getBoundingClientRect(); if (ev.clientX > rr.right - 40) sc.scrollLeft += 12; else if (ev.clientX < rr.left + 40) sc.scrollLeft -= 12; }
        }
        function tm(ev) { if (started) ev.preventDefault(); }
        function end(drop) {
          clearTimeout(timer);
          document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", upH); document.removeEventListener("pointercancel", cancelH); document.removeEventListener("touchmove", tm);
          if (!started) return;
          if (ghost) ghost.remove(); c.classList.remove("dragging"); dragging = false; if (zone) zone.classList.remove("drop");
          c.addEventListener("click", function stop(ev) { ev.stopPropagation(); ev.preventDefault(); c.removeEventListener("click", stop, true); }, true);
          if (drop && zone) {
            const ev = last, after = Array.prototype.slice.call(zone.querySelectorAll(itemSel)).filter(function (x) { return x !== c; }).find(function (x) { const r = x.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
            pending = false; onDrop(c.dataset.id, zone, after ? after.dataset.id : null);
          } else if (pending) { pending = false; renderView(); }
        }
        function upH() { end(true); }
        function cancelH() { end(false); }
        document.addEventListener("pointermove", mv); document.addEventListener("pointerup", upH); document.addEventListener("pointercancel", cancelH);
        document.addEventListener("touchmove", tm, { passive: false });
      });
    });
    if (!root._autoscroll) { root._autoscroll = 1; root.addEventListener("dragover", function (e) { if (!dragging) return; const sc = e.target.closest && e.target.closest(".kb"); if (!sc) return; const rr = sc.getBoundingClientRect(); if (e.clientX > rr.right - 60) sc.scrollLeft += 18; else if (e.clientX < rr.left + 60) sc.scrollLeft -= 18; const ls = e.target.closest(".kb-list"); if (ls) { const lr = ls.getBoundingClientRect(); if (e.clientY > lr.bottom - 40) ls.scrollTop += 14; else if (e.clientY < lr.top + 40) ls.scrollTop -= 14; } }); }
    root.querySelectorAll(zoneSel).forEach(function (z) {
      z.addEventListener("dragover", function (e) { e.preventDefault(); e.dataTransfer && (e.dataTransfer.dropEffect = "move"); z.classList.add("drop"); });
      z.addEventListener("dragleave", function (e) { if (!z.contains(e.relatedTarget)) z.classList.remove("drop"); });
      z.addEventListener("drop", function (e) {
        e.preventDefault(); z.classList.remove("drop"); if (!dragId) return;
        const after = Array.prototype.slice.call(z.querySelectorAll(itemSel)).filter(function (c) { return c.dataset.id !== dragId; }).find(function (c) { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
        const id = dragId; dragId = null; dragging = false; pending = false;
        onDrop(id, z, after ? after.dataset.id : null);
      });
    });
  }
  function inlineAdd(btn, base) {
    const box = document.createElement("form"); box.className = "kb-new";
    box.innerHTML = '<textarea rows="2" placeholder="' + L("What needs to be done?", "O que é preciso fazer?") + '"></textarea><div class="pl-row-end"><select>' + method().types.filter(function (t) { return t !== "epic" && t !== "phase" && t !== "milestone"; }).map(function (t) { return '<option value="' + t + '">' + TYPES[t].name + "</option>"; }).join("") + '</select><button class="pl-btn primary sm">' + L("Create", "Criar") + "</button></div>";
    btn.replaceWith(box);
    const ta = box.querySelector("textarea"); ta.focus();
    ta.onkeydown = function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); box.requestSubmit(); } if (e.key === "Escape") renderView(); };
    box.onsubmit = function (e) { e.preventDefault(); const v = ta.value.trim(); if (!v) return renderView(); createItem(Object.assign({ title: v, type: box.querySelector("select").value }, base)); };
  }

  /* ---------------- backlog & sprints (Scrum) ---------------- */
  function backlog(v) {
    const ss = data.sprints || {};
    const open = Object.keys(ss).filter(function (k) { return ss[k].state !== "closed"; }).sort(function (a, b) { return (ss[a].order || 0) - (ss[b].order || 0); });
    const work = items().filter(function (i) { return !isContainer(i) && i.type !== "milestone" && matches(i); });
    function zone(id, title, sub, list, actions) {
      const pts = list.reduce(function (n, i) { return n + (Number(i.points) || 0); }, 0);
      return '<section class="bl-zone" data-zone="' + id + '"><header><b>' + title + "</b><span class=\"muted\">" + sub + " · " + list.length + " " + L("items", "itens") + (pts ? " · " + pts + " pts" : "") + "</span>" + (actions || "") + "</header>" +
        '<div class="bl-list">' + (list.length ? list.sort(byOrder).map(blRow).join("") : '<div class="bl-empty">' + L("Drag items here", "Arraste itens para aqui") + "</div>") + "</div>" +
        (canEdit ? '<button class="kb-add" data-bladd="' + id + '">+ ' + L("Create", "Criar") + "</button>" : "") + "</section>";
    }
    let h = "";
    open.forEach(function (k) {
      const S = ss[k], act = S.state === "active";
      const actions = canEdit ? '<span class="sp"></span>' + (act ? '<span class="tag on">' + L("Active", "Ativa") + '</span><button class="pl-btn sm" data-complete="' + k + '">' + L("Complete sprint", "Concluir sprint") + "</button>" : (!activeSprint() ? '<button class="pl-btn sm primary" data-startsp="' + k + '">' + L("Start sprint", "Iniciar sprint") + "</button>" : "")) + '<button class="pl-btn sm ghost" data-editsp="' + k + '">' + L("Edit", "Editar") + "</button>" : "";
      h += zone(k, esc(S.name), fmt(S.start) + " → " + fmt(S.end) + (S.goal ? " · " + esc(S.goal) : ""), work.filter(function (i) { return i.sprint === k; }), actions);
    });
    h += zone("_backlog", "Backlog", L("not planned yet", "ainda não planeado"), work.filter(function (i) { return !i.sprint || !ss[i.sprint] || ss[i.sprint].state === "closed"; }).filter(function (i) { return cat(i) !== "done" || !i.sprint; }), canEdit ? '<span class="sp"></span><button class="pl-btn sm" id="newSp">+ ' + L("Create sprint", "Criar sprint") + "</button>" : "");
    v.innerHTML = '<div class="bl">' + h + "</div>";
    v.querySelectorAll(".bl-row").forEach(function (r) { r.onclick = function (e) { if (e.target.closest("select")) return; openDrawer(r.dataset.id); }; });
    v.querySelectorAll(".bl-row select").forEach(function (s) { s.onchange = function () { patch(s.closest(".bl-row").dataset.id, { status: s.value }); }; s.onclick = function (e) { e.stopPropagation(); }; });
    v.querySelectorAll("[data-bladd]").forEach(function (b) { b.onclick = function () { inlineAdd(b, { sprint: b.dataset.bladd === "_backlog" ? undefined : b.dataset.bladd }); }; });
    v.querySelectorAll("[data-startsp]").forEach(function (b) { b.onclick = function () { sprintDialog(b.dataset.startsp, true); }; });
    v.querySelectorAll("[data-editsp]").forEach(function (b) { b.onclick = function () { sprintDialog(b.dataset.editsp, false); }; });
    v.querySelectorAll("[data-complete]").forEach(function (b) { b.onclick = function () { completeSprint(b.dataset.complete); }; });
    const ns = document.getElementById("newSp"); if (ns) ns.onclick = newSprint;
    if (canEdit) dnd(v, ".bl-row", ".bl-zone", function (id, zone, beforeId) {
      const z = zone.dataset.zone, list = work.filter(function (i) { return (z === "_backlog" ? !i.sprint : i.sprint === z) && i.id !== id; }).sort(byOrder);
      patch(id, { sprint: z === "_backlog" ? null : z, order: orderAt(list, beforeId) });
    });
  }
  function blRow(it) {
    const T = TYPES[it.type] || TYPES.task, par = it.parent && data.items[it.parent];
    return '<div class="bl-row" draggable="' + canEdit + '" data-id="' + it.id + '"><span class="ti" style="color:' + T.color + '">' + T.icon + '</span><span class="tk">' + esc(it.key || "") + '</span><span class="tt">' + esc(it.title) + "</span>" +
      (par ? '<span class="ep" style="--c:' + (TYPES[par.type] || TYPES.epic).color + '">' + esc(par.title) + "</span>" : "") +
      (canEdit ? "<select>" + statuses().map(function (s) { return '<option value="' + s.id + '"' + (statusOf(it).id === s.id ? " selected" : "") + ">" + esc(s.name) + "</option>"; }).join("") + "</select>" : '<span class="st">' + esc(statusOf(it).name) + "</span>") +
      '<span class="pts">' + (it.points ? esc(it.points) : "–") + "</span>" + (it.assignee ? '<span class="av" title="' + esc(memberName(it.assignee)) + '">' + esc(initials(it.assignee)) + "</span>" : '<span class="av empty"></span>') + "</div>";
  }
  function newSprint() {
    const ss = data.sprints || {}, ks = Object.keys(ss);
    const last = ks.map(function (k) { return ss[k]; }).sort(function (a, b) { return (b.order || 0) - (a.order || 0); })[0];
    const start = last && last.end ? n2d(d2n(last.end) + 3 * DAY) : today();
    const id = db.ref().push().key, n = ks.length + 1;
    save("sprints/" + id, { name: "Sprint " + n, start: start, end: n2d(d2n(start) + 11 * DAY), state: "planned", goal: "", order: n });
  }
  function sprintDialog(id, starting) {
    const S = data.sprints[id];
    modal("<h2>" + (starting ? L("Start sprint", "Iniciar sprint") : L("Edit sprint", "Editar sprint")) + "</h2>" +
      '<form id="spF" class="pl-form"><label>' + L("Name", "Nome") + '<input name="name" required value="' + esc(S.name) + '"></label><div class="g2"><label>' + L("Start", "Início") + '<input type="date" name="start" required value="' + esc(S.start || today()) + '"></label><label>' + L("End", "Fim") + '<input type="date" name="end" required value="' + esc(S.end || "") + '"></label></div>' +
      '<label>' + L("Sprint goal", "Objetivo da sprint") + '<textarea name="goal" rows="2">' + esc(S.goal || "") + "</textarea></label>" +
      '<div class="pl-row-end">' + (!starting ? '<button type="button" class="pl-btn ghost danger" id="spDel">' + L("Delete sprint", "Excluir sprint") + "</button><span class=\"sp\"></span>" : "") + '<button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + (starting ? L("Start", "Iniciar") : L("Save", "Salvar")) + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#spF");
      f.onsubmit = function (e) { e.preventDefault(); const o = Object.assign({}, S, { name: f.name.value.trim(), start: f.start.value, end: f.end.value, goal: f.goal.value.trim() }); if (starting) o.state = "active"; save("sprints/" + id, o).then(close); };
      const del = box.querySelector("#spDel");
      if (del) del.onclick = function () {
        const u = {}; u["sprints/" + id] = null;
        items().forEach(function (i) { if (i.sprint === id) u["items/" + i.id + "/sprint"] = null; });
        db.ref("planning/" + ID + "/data").update(u).then(close, fail);
      };
    });
  }
  function completeSprint(id) {
    const S = data.sprints[id], open = items().filter(function (i) { return i.sprint === id && cat(i) !== "done"; });
    const next = Object.keys(data.sprints || {}).filter(function (k) { return k !== id && data.sprints[k].state === "planned"; }).sort(function (a, b) { return (data.sprints[a].order || 0) - (data.sprints[b].order || 0); })[0];
    modal("<h2>" + L("Complete ", "Concluir ") + esc(S.name) + "</h2><p>" + (items().filter(function (i) { return i.sprint === id; }).length - open.length) + " " + L("items done", "itens concluídos") + " · " + open.length + " " + L("open", "em aberto") + ".</p>" +
      (open.length ? '<label class="pl-form">' + L("Move open items to", "Mover itens em aberto para") + '<select id="mvTo"><option value="">Backlog</option>' + (next ? '<option value="' + next + '" selected>' + esc(data.sprints[next].name) + "</option>" : "") + "</select></label>" : "") +
      '<div class="pl-row-end"><button class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary" id="cpGo">' + L("Complete sprint", "Concluir sprint") + "</button></div>", function (box, close) {
      box.querySelector("#cpGo").onclick = function () {
        const to = (box.querySelector("#mvTo") || {}).value || null, u = {};
        u["sprints/" + id + "/state"] = "closed"; u["sprints/" + id + "/closedAt"] = TS();
        const all = items().filter(function (i) { return i.sprint === id && !isContainer(i) && i.type !== "milestone"; }), dn = all.filter(function (i) { return cat(i) === "done"; });
        u["sprints/" + id + "/report"] = { items: all.length, done: dn.length, sp: all.reduce(function (n, i) { return n + (Number(i.points) || 0); }, 0), spDone: dn.reduce(function (n, i) { return n + (Number(i.points) || 0); }, 0), noSp: all.filter(function (i) { return !i.points; }).length };
        open.forEach(function (i) { u["items/" + i.id + "/sprint"] = to; });
        db.ref("planning/" + ID + "/data").update(u).then(function () { close(); toast(L("Sprint completed", "Sprint concluída")); }, fail);
      };
    });
  }

  /* ---------------- list ---------------- */
  function list(v) {
    const rs = rows();
    const opt = function (arr, val) { return arr.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === (val || "") ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join(""); };
    const ppl = [["", "—"]].concat(Object.keys(members).map(function (k) { return [members[k].email, members[k].name || members[k].email]; }));
    const dis = canEdit ? "" : " disabled";
    v.innerHTML = '<div class="ls-wrap"><table class="ls"><thead><tr><th>' + L("Key", "Chave") + "</th><th>" + L("Title", "Título") + "</th><th>" + L("Type", "Tipo") + "</th><th>" + L("Status", "Estado") + "</th><th>" + L("Assignee", "Responsável") + "</th><th>" + L("Start", "Início") + "</th><th>" + L("End", "Fim") + "</th><th>%</th><th class='sp-c'>" + L("Points", "Pontos") + "</th></tr></thead><tbody>" +
      rs.map(function (r) {
        const it = r.it, T = TYPES[it.type] || TYPES.task;
        return '<tr data-id="' + it.id + '"' + (overdue(it) ? ' class="late"' : "") + '><td class="tk">' + esc(it.key || "") + '</td><td><span style="padding-left:' + r.depth * 16 + 'px"></span><span class="ti" style="color:' + T.color + '">' + T.icon + '</span> <a href="#" data-open="' + it.id + '">' + esc(it.title) + "</a></td>" +
          '<td>' + esc(T.name) + '</td><td><select data-f="status"' + dis + ">" + opt(statuses().map(function (s) { return [s.id, s.name]; }), statusOf(it).id) + '</select></td><td><select data-f="assignee"' + dis + ">" + opt(ppl, it.assignee) + "</select></td>" +
          '<td><input type="date" data-f="start" value="' + esc(it.start || "") + '"' + dis + '></td><td><input type="date" data-f="end" value="' + esc(it.end || "") + '"' + dis + "></td>" +
          '<td><input type="number" min="0" max="100" step="5" data-f="progress" value="' + esc(it.progress == null ? "" : it.progress) + '"' + dis + '></td><td class="sp-c"><input type="number" min="0" step="1" data-f="points" value="' + esc(it.points == null ? "" : it.points) + '"' + dis + "></td></tr>";
      }).join("") + "</tbody></table>" + (rs.length ? "" : '<div class="pl-empty">' + L("Nothing here yet.", "Ainda não há nada aqui.") + "</div>") + "</div>";
    v.querySelectorAll("[data-open]").forEach(function (a) { a.onclick = function (e) { e.preventDefault(); openDrawer(a.dataset.open); }; });
    v.querySelectorAll("[data-f]").forEach(function (inp) {
      inp.onchange = function () {
        const id = inp.closest("tr").dataset.id, f = inp.dataset.f, o = {};
        o[f] = inp.type === "number" ? (inp.value === "" ? null : Number(inp.value)) : (inp.value || null);
        if (f === "assignee" && inp.value && inp.value !== me.email && inp.value !== data.items[id].assignee) patch(id, o).then(function () { notify("assign", { item: id }); });
        else patch(id, o);
      };
    });
  }

  /* ---------------- item drawer ---------------- */
  /* ---------------- per-card alerts (followers) ----------------
     items/<id>/watch/<emailKey> = { email, status, before: [days], late, by, at }
     status → e-mail right away when the card changes status; before/late → in the daily alert (08:00 Lisbon) */
  const WDAYS = [7, 3, 1, 0];
  function wKey(e) { return String(e || "").toLowerCase().replace(/\./g, ","); }
  function watchBlock(it) {
    const w = it.watch || {}, ks = Object.keys(w), mine = w[wKey(me.email)];
    const who = ks.map(function (k) { return wKey(me.email) === k ? L("you", "você") : memberName(w[k].email); });
    const desc = function (x) { const p = []; if (x.status !== false) p.push(L("status change", "mudança de status")); if ((x.before || []).length) p.push(L("due: ", "prazo: ") + x.before.slice().sort(function (a, b) { return b - a; }).map(function (d) { return d === 0 ? L("on the day", "no dia") : d + "d"; }).join(", ")); if (x.late) p.push(L("when late", "quando atrasar")); return p.join(" · "); };
    return '<div class="d-watch"><div class="dw-h">' + IC("bell", 15) + " <b>" + L("Alerts for this card", "Alertas deste card") + "</b></div>" +
      (ks.length ? '<p class="small">' + L("Following: ", "Acompanham: ") + esc(who.join(", ")) + (mine ? '<br><span class="muted">' + L("Your alerts: ", "Seus alertas: ") + esc(desc(mine)) + "</span>" : "") + "</p>" : '<p class="muted small">' + L("No one is following this card yet.", "Ninguém acompanha este card ainda.") + "</p>") +
      (canEdit ? '<div class="dw-a"><button type="button" class="pl-btn sm" id="wQuick">' + (mine ? L("Stop following", "Deixar de acompanhar") : IC("bell", 13) + " " + L("Follow this card", "Acompanhar este card")) + '</button><button type="button" class="pl-btn sm ghost" id="wCfg">' + L("Configure alerts…", "Configurar alertas…") + "</button></div>" : '<p class="muted small">' + L("Only editors can set alerts.", "Somente editores configuram alertas.") + "</p>") +
      (!it.end ? '<p class="muted small">' + L("Tip: set a due date to get deadline alerts.", "Dica: defina um prazo para receber avisos de vencimento.") + "</p>" : "") + "</div>";
  }
  function bindWatch(id) {
    const wq = document.getElementById("wQuick"); if (wq) wq.onclick = function () { quickWatch(id); };
    const wc = document.getElementById("wCfg"); if (wc) wc.onclick = function () { watchDialog(id); };
  }
  function refreshWatch(id) { // the drawer may have unsaved edits, so only the alerts block is redrawn
    setTimeout(function () { const b = document.querySelector("#drawer .d-watch"); if (!b || openItem !== id || !data.items[id]) return; b.outerHTML = watchBlock(Object.assign({ id: id }, data.items[id])); bindWatch(id); }, 120);
  }
  function quickWatch(id) {
    const it = data.items[id], k = wKey(me.email);
    if (it && it.watch && it.watch[k]) return save("items/" + id + "/watch/" + k, null).then(function () { refreshWatch(id); toast(L("You no longer follow this card", "Você deixou de acompanhar este card")); });
    save("items/" + id + "/watch/" + k, { email: me.email, status: true, before: [1], late: true, by: me.email, at: Date.now() }).then(function () { refreshWatch(id); toast(L("Following: status changes, 1 day before the due date and when late", "Acompanhando: mudança de status, 1 dia antes do prazo e quando atrasar")); });
  }
  function watchDialog(id) {
    const it = data.items[id]; if (!it) return;
    const w = it.watch || {}, base = w[wKey(me.email)] || w[Object.keys(w)[0]] || { status: true, before: [1], late: true };
    const ppl = Object.keys(members).map(function (k) { return members[k]; }).filter(function (m) { return m && m.email && (!m.expires || m.expires > Date.now()); });
    if (!ppl.some(function (m) { return String(m.email).toLowerCase() === String(me.email).toLowerCase(); })) ppl.unshift({ email: me.email, name: me.displayName || me.email });
    modal("<h2>" + IC("bell", 20) + " " + L("Alerts for ", "Alertas de ") + esc(it.key || it.title) + '</h2><p class="muted small">' + L("Choose who follows this card and what they are warned about. E-mails go out from the platform account.", "Escolha quem acompanha este card e sobre o que será avisado. Os e-mails saem pela conta da plataforma.") + "</p>" +
      '<form class="pl-form" id="wF"><fieldset><legend>' + L("Warn about", "Avisar quando") + '</legend><label class="chk"><input type="checkbox" name="st"' + (base.status !== false ? " checked" : "") + "> " + L("The status changes (right away)", "O status mudar (na hora)") + '</label><div class="day-chips">' + WDAYS.map(function (d) { return '<label><input type="checkbox" name="b' + d + '"' + ((base.before || []).indexOf(d) >= 0 ? " checked" : "") + "><span>" + (d === 0 ? L("On the due date", "No dia do prazo") : d + " " + L(d === 1 ? "day before" : "days before", d === 1 ? "dia antes" : "dias antes")) + "</span></label>"; }).join("") + '</div><label class="chk"><input type="checkbox" name="late"' + (base.late ? " checked" : "") + "> " + L("It is late (every morning until done)", "Atrasar (todas as manhãs até concluir)") + "</label>" + (!it.end ? '<p class="muted small">' + L("This card has no due date yet – deadline alerts start when one is set.", "Este card ainda não tem prazo – os avisos de vencimento começam quando houver um.") + "</p>" : "") + "</fieldset>" +
      "<fieldset><legend>" + L("Who follows", "Quem acompanha") + '</legend><div class="w-ppl">' + ppl.map(function (m) { const k = wKey(m.email); return '<label class="chk"><input type="checkbox" name="p" value="' + esc(m.email) + '"' + (w[k] || (!Object.keys(w).length && k === wKey(me.email)) ? " checked" : "") + "> " + esc(m.name || m.email) + ' <span class="muted">' + esc(m.email) + (k === wKey(me.email) ? " · " + L("you", "você") : "") + "</span></label>"; }).join("") + "</div></fieldset>" +
      '<div class="pl-row-end">' + (Object.keys(w).length ? '<button type="button" class="pl-btn ghost danger" id="wOff">' + L("Turn off all", "Desligar todos") + "</button>" : "") + '<span class="sp"></span><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + L("Save alerts", "Salvar alertas") + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#wF");
      f.onsubmit = function (e) {
        e.preventDefault();
        const cfg = { status: f.st.checked, before: WDAYS.filter(function (d) { return f["b" + d].checked; }), late: f.late.checked };
        if (!cfg.status && !cfg.before.length && !cfg.late) return toast(L("Choose at least one kind of alert", "Escolha pelo menos um tipo de alerta"));
        const out = {}; Array.prototype.forEach.call(f.querySelectorAll("input[name=p]:checked"), function (c) { const k = wKey(c.value), prev = w[k] || {}; out[k] = Object.assign({ email: c.value, by: prev.by || me.email, at: prev.at || Date.now() }, cfg); });
        save("items/" + id + "/watch", Object.keys(out).length ? out : null).then(function () { refreshWatch(id); toast(Object.keys(out).length ? L("Alerts saved for ", "Alertas salvos para ") + Object.keys(out).length + L(" people", " pessoa(s)") : L("Alerts turned off", "Alertas desligados")); close(); });
      };
      const off = box.querySelector("#wOff"); if (off) off.onclick = function () { save("items/" + id + "/watch", null).then(function () { refreshWatch(id); toast(L("Alerts turned off", "Alertas desligados")); close(); }); };
    });
  }
  function openDrawer(id, focusTitle) {
    if (drawerDirty && id !== openItem) { return confirmDiscard(function () { drawerDirty = false; openDrawer(id, focusTitle); }); }
    drawerDirty = false;
    const it0 = data.items[id]; if (!it0) { openItem = null; closeDrawer(); return; }
    openItem = id;
    const it = Object.assign({ id: id }, it0), T = TYPES[it.type] || TYPES.task, dis = canEdit ? "" : " disabled";
    const parents = parentChoices(it0.type, id);
    const others = items().filter(function (i) { return i.id !== id && !isContainer(i); }).sort(byOrder);
    const ppl = Object.keys(members).map(function (k) { return members[k]; });
    const sps = Object.keys(data.sprints || {}).filter(function (k) { return data.sprints[k].state !== "closed"; });
    let d = document.getElementById("drawer");
    if (!d) { d = document.createElement("aside"); d.id = "drawer"; d.className = "pl-drawer"; document.body.appendChild(d); }
    d.innerHTML = '<header><span class="ti" style="color:' + T.color + '">' + T.icon + '</span><span class="tk">' + esc(it.key || "") + '</span><span class="sp"></span>' + (canEdit ? '<button class="pl-btn icon" id="dUp" title="' + L("Move up (before the previous one)", "Mover para cima (antes do anterior)") + '">↑</button><button class="pl-btn icon" id="dDn" title="' + L("Move down (after the next one)", "Mover para baixo (depois do próximo)") + '">↓</button>' : "") + (canEdit ? '<button class="pl-btn sm ghost danger" id="dDel">' + L("Delete", "Excluir") + "</button>" : "") + '<button class="pl-btn icon" id="dX">' + IC("close", 16) + "</button></header>" +
      '<form class="pl-form" id="dF"><textarea name="title" class="d-title" rows="2"' + dis + ">" + esc(it.title) + "</textarea>" +
      '<div class="g2"><label>' + L("Type", "Tipo") + '<select name="type"' + dis + ">" + Object.keys(TYPES).filter(function (t) { return method().types.indexOf(t) >= 0 || t === it.type; }).map(function (t) { return '<option value="' + t + '"' + (t === it.type ? " selected" : "") + ">" + TYPES[t].name + "</option>"; }).join("") + "</select></label>" +
      "<label>" + L("Status", "Status") + '<select name="status"' + dis + ">" + statuses().map(function (s) { return '<option value="' + s.id + '"' + (statusOf(it).id === s.id ? " selected" : "") + ">" + esc(s.name) + "</option>"; }).join("") + "</select></label></div>" +
      "<label>" + L("Assignee", "Responsável") + '<select name="assignee"' + dis + '><option value="">' + L("Unassigned", "Sem responsável") + "</option>" + ppl.map(function (m) { return '<option value="' + esc(m.email) + '"' + (m.email === it.assignee ? " selected" : "") + ">" + esc(m.name || m.email) + " · " + esc(m.email) + "</option>"; }).join("") + "</select></label>" +
      '<div class="g2"><label>' + L("Start", "Início") + '<input type="date" name="start" value="' + esc(it.start || "") + '"' + dis + "></label><label>" + L("Due / end", "Prazo / fim") + '<input type="date" name="end" value="' + esc(it.end || "") + '"' + dis + "></label></div>" +
      '<div class="g2"><label>' + L("Progress %", "Progresso %") + '<input type="number" min="0" max="100" step="5" name="progress" value="' + esc(it.progress == null ? "" : it.progress) + '"' + dis + "></label><label class='sp-f'>" + L("Story points", "Story points") + '<input type="number" min="0" step="1" name="points" value="' + esc(it.points == null ? "" : it.points) + '"' + dis + "></label></div>" +
      '<div class="g2"><label>' + L("Budget", "Orçado") + " (" + cur() + ')<input type="number" min="0" step="any" name="budget" value="' + esc(it.budget == null ? "" : it.budget) + '"' + dis + "></label><label>" + L("Actual", "Realizado") + " (" + cur() + ')<input type="number" min="0" step="any" name="actual" value="' + esc(it.actual == null ? "" : it.actual) + '"' + dis + "></label></div>" +
      (isContainer(it) ? (function () { const m = moneyOf(it); return m.b || m.a ? '<p class="d-money">' + IC("kr", 14) + " " + L("Total with child items: budget ", "Total com os itens filhos: orçado ") + money(m.b) + " · " + L("actual ", "realizado ") + "<b" + (m.a > m.b && m.b ? ' class="late"' : "") + ">" + money(m.a) + "</b>" + (m.b ? " (" + Math.round(m.a / m.b * 100) + "%)" : "") + "</p>" : ""; })() : "") +
      (it.type === "initiative" ? "" : "<label>" + (lvl(it.type) === 1 ? L("Initiative", "Iniciativa") : L("Parent (initiative / epic / phase)", "Pai (iniciativa / épico / fase)")) + '<select name="parent"' + dis + '><option value="">—</option>' + parents.map(function (p) { return '<option value="' + p.id + '"' + (p.id === it.parent ? " selected" : "") + ">" + esc((p.key ? p.key + " · " : "") + p.title) + "</option>"; }).join("") + "</select></label>") +
      (sps.length && !isContainer(it) ? "<label>Sprint<select name=\"sprint\"" + dis + '><option value="">Backlog</option>' + sps.map(function (k) { return '<option value="' + k + '"' + (k === it.sprint ? " selected" : "") + ">" + esc(data.sprints[k].name) + "</option>"; }).join("") + "</select></label>" : "") +
      "<label>" + L("Depends on (finish → start)", "Depende de (fim → início)") + '<select name="deps" multiple size="4"' + dis + ">" + others.map(function (o) { return '<option value="' + o.id + '"' + ((it.deps || {})[o.id] ? " selected" : "") + ">" + esc((o.key ? o.key + " · " : "") + o.title) + "</option>"; }).join("") + "</select></label>" +
      '<label class="chk prio"><input type="checkbox" name="prio"' + (it.prio ? " checked" : "") + dis + "> ★ " + L("Key activity – include in the e-mail alerts", "Atividade principal – incluir nos alertas por e-mail") + "</label>" +
      watchBlock(it) + blockBlock(it) +
      (canEdit && (it.type === "epic" || it.type === "initiative") ? '<button type="button" class="pl-btn sm ai-btn" id="dAi">' + IC("spark", 14) + " " + (it.type === "epic" ? L("Generate stories with AI", "Gerar histórias com IA") : L("Generate epic with AI", "Gerar épico com IA")) + "</button>" : "") +
      (allKrs().length ? "<label>" + L("Contributes to (OKR)", "Contribui para (OKR)") + '<select name="krs" multiple size="' + Math.min(5, allKrs().length) + '"' + dis + ">" + allKrs().map(function (k) { return '<option value="' + k.ref + '"' + ((it.krs || {})[k.ref] ? " selected" : "") + ">" + esc(k.label) + "</option>"; }).join("") + "</select></label>" : "") +
      itsmBadge(it, true) +
      (it.src && it.src.board ? '<a class="pl-src" href="../board/?id=' + encodeURIComponent(it.src.board) + '">' + IC("board", 15) + " " + L("Open the source board (process step)", "Abrir o quadro de origem (passo do processo)") + "</a>" : "") +
      (it.src && it.src.game ? '<a class="pl-src" href="../game/?id=' + encodeURIComponent(it.src.game) + '">' + IC("game", 15) + " Business Game" + (it.src.round ? " · " + L("round ", "rodada ") + esc(it.src.round) : "") + " – " + L("open the game", "abrir a partida") + "</a>" : "") +
      "<label>" + L("Description", "Descrição") + '<textarea name="desc" rows="5"' + dis + ">" + esc(it.desc || "") + "</textarea></label>" +
      (canEdit && !it.ext ? Object.keys(PROV).filter(function (k) { return data.settings && data.settings[k]; }).map(function (k) { return '<button type="button" class="pl-btn sm" data-mk="' + k + '">' + IC("send", 14) + " " + L("Create in ", "Criar no ") + PROV[k].short + "</button>"; }).join(" ") : "") +
      '<p class="muted small">' + (it.by ? L("Created by ", "Criado por ") + esc(memberName(it.by)) : "") + (it.ext ? " · " + (it.ext.url ? '<a href="' + esc(it.ext.url) + '" target="_blank" rel="noopener">' + esc((PROV[it.ext.source] ? PROV[it.ext.source].short : it.ext.source) + " ") + esc(it.ext.key || "") + " ↗</a>" : esc(it.ext.source) + " " + esc(it.ext.key || "")) : "") + (it.ext && it.ext.assigneeName && !it.assignee ? " · " + L("Assignee in ", "Responsável no ") + (PROV[it.ext.source] ? PROV[it.ext.source].short : "") + ": " + esc(it.ext.assigneeName) : "") + "</p>" +
      (canEdit ? '<p class="d-err" id="dErr" hidden></p><div class="d-actions"><button type="button" class="pl-btn" id="dCancel" disabled>' + L("Cancel changes", "Cancelar alterações") + '</button><button type="button" class="pl-btn primary" id="dSave" disabled>' + L("Save", "Salvar") + "</button></div>" : "") + "</form>";
    document.getElementById("dX").onclick = closeDrawer;
    bindBlocks(id);
    const dai = document.getElementById("dAi"); if (dai) dai.onclick = function () { aiStoryDialog(id, it.type === "epic" ? "split" : "epic"); };
    document.querySelectorAll(".tl-row.sel").forEach(function (r) { r.classList.remove("sel"); });
    const row = document.querySelector('.tl-row[data-open="' + id + '"]'); if (row) row.classList.add("sel");
    if (!canEdit) return;
    const f = document.getElementById("dF");
    /* explicit Save / Cancel: changes stay pending until “Save” (nothing is lost by a wrong click) */
    const pend = {};
    const sv = document.getElementById("dSave"), cc = document.getElementById("dCancel"), er = document.getElementById("dErr");
    function setDirty() { const dirty = Object.keys(pend).length > 0; drawerDirty = dirty; sv.disabled = !dirty; cc.disabled = !dirty; d.classList.toggle("dirty", dirty); }
    function readField(inp) {
      const n = inp.name, o = {};
      if (n === "deps" || n === "krs") { const dd = {}; Array.prototype.forEach.call(inp.selectedOptions, function (op) { dd[op.value] = true; }); o[n] = Object.keys(dd).length ? dd : null; }
      else if (inp.type === "checkbox") o[n] = inp.checked || null;
      else if (inp.type === "number") o[n] = inp.value === "" ? null : Number(inp.value);
      else o[n] = n === "title" ? (inp.value.trim() || it.title) : (inp.value || null);
      if (n === "status") { const st = statuses().find(function (x) { return x.id === inp.value; }); if (st && st.cat === "done") o.progress = 100; }
      if (n === "type" && inp.value === "milestone") o.end = f.start.value || f.end.value || null;
      return o;
    }
    function checkDates() {
      const a = f.start && f.start.value, b = f.end && f.end.value;
      if (f.end && a) f.end.min = a;
      const bad = a && b && b < a;
      er.hidden = !bad; er.textContent = bad ? L("The end date cannot be before the start date.", "A data final não pode ser anterior à data de início.") : "";
      if (f.end) f.end.classList.toggle("bad", !!bad);
      return !bad;
    }
    f.querySelectorAll("input,select,textarea").forEach(function (inp) {
      if (!inp.name) return;
      const h = function () { Object.assign(pend, readField(inp)); if (inp.name === "start" || inp.name === "end") checkDates(); setDirty(); };
      inp.addEventListener("change", h);
      if (inp.tagName === "TEXTAREA" || inp.type === "text" || inp.type === "number" || inp.type === "date") inp.addEventListener("input", h);
    });
    checkDates();
    function doSave() {
      if (!Object.keys(pend).length) return;
      if (!checkDates()) { f.end.focus(); return; }
      const o = Object.assign({}, pend), prevA = (data.items[id] || {}).assignee;
      sv.disabled = true;
      patch(id, o).then(function () {
        Object.keys(pend).forEach(function (k) { delete pend[k]; }); setDirty();
        toast(L("Saved", "Salvo"));
        if ("assignee" in o && o.assignee && o.assignee !== me.email && o.assignee !== prevA) notify("assign", { item: id }).then(function (j) { if (j && j.ok && (j.sent || []).length) toast(L("Assignee notified by e-mail", "Responsável avisado por e-mail")); });
        openDrawer(id);
      });
    }
    sv.onclick = doSave;
    cc.onclick = function () { Object.keys(pend).forEach(function (k) { delete pend[k]; }); drawerDirty = false; openDrawer(id); };
    f.addEventListener("keydown", function (e) { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); doSave(); } });
    document.getElementById("dUp").onclick = function () { moveItem(id, -1); };
    document.getElementById("dDn").onclick = function () { moveItem(id, 1); };
    f.title.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); f.title.blur(); } };
    f.querySelectorAll("[data-mk]").forEach(function (b) { b.onclick = function () { b.disabled = true; createInTool(b.dataset.mk, id).then(function () { b.disabled = false; }); }; });
    bindWatch(id);
    if (focusTitle) { f.title.focus(); f.title.select(); }
    document.getElementById("dDel").onclick = function () {
      const kids = children(id);
      modal("<h2>" + L("Delete ", "Excluir ") + esc(it.key || it.title) + "?</h2><p>" + (kids.length ? kids.length + " " + L("child items will be moved to the top level.", "itens filhos passam para o nível de topo.") : L("This cannot be undone.", "Não é possível desfazer.")) + '</p><div class="pl-row-end"><button class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary danger" id="delGo">' + L("Delete", "Excluir") + "</button></div>", function (box, close) {
        box.querySelector("#delGo").onclick = function () {
          const u = {}; u["items/" + id] = null;
          kids.forEach(function (k) { u["items/" + k.id + "/parent"] = null; });
          items().forEach(function (i) { if ((i.deps || {})[id]) u["items/" + i.id + "/deps/" + id] = null; });
          db.ref("planning/" + ID + "/data").update(u).then(function () { close(); drawerDirty = false; closeDrawer(); }, fail);
        };
      });
    };
  }
  function confirmDiscard(go) {
    modal("<h2>" + L("Discard changes?", "Descartar alterações?") + "</h2><p>" + L("You have unsaved changes in this item.", "Você tem alterações não salvas neste item.") + '</p><div class="pl-row-end"><button class="pl-btn" data-close>' + L("Keep editing", "Continuar editando") + '</button><button class="pl-btn danger" id="dcGo">' + L("Discard", "Descartar") + "</button></div>", function (box, close) {
      box.querySelector("#dcGo").onclick = function () { close(); go(); };
    });
  }
  /* reorder among siblings (same parent): ↑ / ↓ in the item panel */
  function siblingsOf(it) { return items().filter(function (i) { return (i.parent || "") === (it.parent || "") && isContainer(i) === isContainer(it); }).sort(byOrder); }
  function moveItem(id, dir) {
    const it = Object.assign({ id: id }, data.items[id]), sib = siblingsOf(it), i = sib.findIndex(function (x) { return x.id === id; }), j = i + dir;
    if (i < 0 || j < 0 || j >= sib.length) return toast(dir < 0 ? L("Already the first one", "Já é o primeiro") : L("Already the last one", "Já é o último"));
    const u = {};
    sib.forEach(function (x, k) { x._o = (k + 1) * 1000; });
    const a = sib[i]._o; sib[i]._o = sib[j]._o; sib[j]._o = a;
    sib.forEach(function (x) { if (x.order !== x._o) u["items/" + x.id + "/order"] = x._o; });
    db.ref("planning/" + ID + "/data").update(u).then(function () { toast(L("Moved", "Posição alterada")); }, fail);
  }
  function closeDrawer() {
    if (drawerDirty) return confirmDiscard(function () { drawerDirty = false; closeDrawer(); });
    openItem = null; const d = document.getElementById("drawer"); if (d) d.remove(); document.querySelectorAll(".tl-row.sel").forEach(function (r) { r.classList.remove("sel"); }); }

  /* ---------------- dialogs ---------------- */
  function modal(html, bind) {
    const w = document.createElement("div"); w.className = "pl-modal"; w.innerHTML = '<div class="pl-card">' + html + "</div>";
    document.body.appendChild(w);
    function close() { w.remove(); }
    w.onclick = function (e) { if (e.target === w) close(); };
    w.querySelectorAll("[data-close]").forEach(function (b) { b.onclick = close; });
    if (bind) bind(w, close);
    const f = w.querySelector("input,textarea,select"); if (f) setTimeout(function () { f.focus(); }, 30);
  }
  function createMenu(anchor) {
    const old = document.getElementById("crMenu"); if (old) { old.remove(); return; }
    const types = method().types;
    const m = document.createElement("div"); m.id = "crMenu"; m.className = "cr-menu";
    m.innerHTML = '<div class="cr-h">' + L("Create", "Criar") + "</div>" + types.map(function (t) { const T = TYPES[t]; return '<button data-ct="' + t + '"><span class="ti" style="color:' + T.color + '">' + T.icon + "</span><span><b>" + esc(T.name) + "</b><small>" + esc(T.desc) + "</small></span></button>"; }).join("") +
      '<div class="cr-sep"></div><button data-ct="_ai"><span class="ti" style="color:#8e4ec6">' + IC("spark") + "</span><span><b>" + L("Generate with AI", "Gerar com IA") + "</b><small>" + L("Epics and user stories with acceptance criteria.", "Épicos e histórias de usuário com critérios de aceite.") + "</small></span></button>" +
      '<button data-ct="_okr"><span class="ti" style="color:#0f766e">' + IC("objective") + "</span><span><b>" + L("Objective (OKR)", "Objetivo (OKR)") + "</b><small>" + L("A goal with measurable key results.", "Uma meta com resultados-chave mensuráveis.") + "</small></span></button>";
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect(); m.style.top = r.bottom + 6 + "px"; m.style.left = Math.max(8, Math.min(window.innerWidth - 300, r.right - 290)) + "px";
    m.onclick = function (e) { const b = e.target.closest("[data-ct]"); if (!b) return; m.remove(); if (b.dataset.ct === "_okr") objDialog(); else if (b.dataset.ct === "_ai") aiStoryDialog(null); else quickCreate(b.dataset.ct); };
    setTimeout(function () { document.addEventListener("click", function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener("click", off); } }); }, 0);
  }
  function quickCreate(preType) {
    const types = method().types;
    let type = preType && types.indexOf(preType) >= 0 ? preType : (types.indexOf("story") >= 0 ? "story" : "task");
    modal("<h2>" + L("Create item", "Criar item") + '</h2><form class="pl-form" id="qcF"><div class="type-chips">' + types.map(function (t) { const T = TYPES[t]; return '<button type="button" data-tc="' + t + '" class="' + (t === type ? "on" : "") + '" style="--c:' + T.color + '">' + T.icon + " " + esc(T.name) + "</button>"; }).join("") + '</div><p class="muted small" id="tcDesc"></p>' +
      '<label id="parL">' + L("Parent", "Pai") + '<select name="parent"></select></label>' +
      "<label>" + L("Title", "Título") + '<input name="title" required autocomplete="off"></label>' +
      '<label id="posL">' + L("Position", "Posição") + '<select name="pos"></select></label>' +
      (allKrs().length ? '<label id="krL">' + IC("objective", 14) + " " + L("Contributes to (OKR key result)", "Contribui para (resultado-chave do OKR)") + '<select name="kr"><option value="">—</option>' + allKrs().map(function (k) { return '<option value="' + esc(k.ref) + '">' + esc(k.label) + "</option>"; }).join("") + "</select></label>" : "") +
      "<label>" + L("Assignee", "Responsável") + '<select name="assignee"><option value="">' + L("Unassigned", "Sem responsável") + "</option>" + Object.keys(members).map(function (k) { return '<option value="' + esc(members[k].email) + '">' + esc(members[k].name || members[k].email) + "</option>"; }).join("") + "</select></label>" +
      '<div class="g2"><label>' + L("Start", "Início") + '<input type="date" name="start"></label><label>' + L("Due / end", "Prazo / fim") + '<input type="date" name="end"></label></div>' +
      '<div class="pl-row-end"><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + L("Create", "Criar") + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#qcF");
      function sync() {
        box.querySelectorAll("[data-tc]").forEach(function (b) { b.classList.toggle("on", b.dataset.tc === type); });
        box.querySelector("#tcDesc").textContent = TYPES[type].desc;
        const ps = parentChoices(type);
        box.querySelector("#parL").hidden = type === "initiative" || !ps.length;
        const krl = box.querySelector("#krL"); if (krl) krl.hidden = !(type === "initiative" || ((type === "epic" || type === "phase") && !parentChoices(type).some(function (p) { return p.type === "initiative"; })));
        f.parent.innerHTML = '<option value="">—</option>' + ps.map(function (p) { return '<option value="' + p.id + '">' + esc(TYPES[p.type].name + " · " + (p.key ? p.key + " " : "") + p.title) + "</option>"; }).join("");
      }
      function sibs() { const par = f.parent.value || ""; const cont = isContainer({ type: type }); return items().filter(function (i) { return (i.parent || "") === par && isContainer(i) === cont; }).sort(byOrder); }
      function fillPos() {
        const list = sibs();
        box.querySelector("#posL").hidden = !list.length;
        f.pos.innerHTML = '<option value="">' + L("At the end", "No fim") + "</option>" + list.map(function (p) { return '<option value="' + p.id + '">' + L("Before ", "Antes de ") + esc((p.key ? p.key + " · " : "") + p.title) + "</option>"; }).join("");
      }
      f.parent.addEventListener("change", fillPos);
      const _sync = sync; sync = function () { _sync(); fillPos(); };
      f.start.addEventListener("change", function () { f.end.min = f.start.value; });
      box.querySelectorAll("[data-tc]").forEach(function (b) { b.onclick = function () { type = b.dataset.tc; sync(); }; });
      sync();
      setTimeout(function () { f.querySelector("[name=title]").focus(); }, 40);
      f.onsubmit = function (e) {
        e.preventDefault();
        const o = { type: type, title: f.title.value.trim(), parent: f.parent.value || undefined, assignee: f.assignee.value || undefined, start: f.start.value || undefined, end: f.end.value || f.start.value || undefined };
        if (f.kr && f.kr.value && !box.querySelector("#krL").hidden) { o.krs = {}; o.krs[f.kr.value] = true; }
        if (o.type === "milestone") o.end = o.start = o.end || o.start;
        if (o.start && o.end && o.end < o.start) { toast(L("The end date cannot be before the start date.", "A data final não pode ser anterior à data de início.")); f.end.focus(); return; }
        const sl = sibs(); if (sl.length) o.order = orderAt(sl, f.pos.value || null);
        if (info.method === "scrum" && !isContainer(o) && activeSprint() && view === "board") o.sprint = activeSprint();
        createItem(o).then(function (nid) { close(); if (nid && o.parent) collapsed[o.parent] = false; });
      };
    });
  }
  function moreMenu() {
    const owner = isAdm || (wsInfo.owner && wsInfo.owner === A.key(me.email));
    modal("<h2>" + L("Planning options", "Opções do planejamento") + '</h2><div class="pl-menu">' +
      (canEdit ? '<button data-act="psettings">' + IC("settings") + " " + L("Planning settings (story points, budget, indicators)", "Configurações do planejamento (story points, orçamento, indicadores)") + "</button>" : "") +
      (canEdit ? '<button data-act="workflow">' + IC("settings") + " " + L("Workflow and columns", "Fluxo e colunas") + "</button>" : "") +
      (canEdit ? '<button data-act="alerts">' + IC("bell") + " " + L("E-mail alerts (milestones, key activities, delays)", "Alertas por e-mail (marcos, atividades principais, atrasos)") + "</button>" : "") +
      (canEdit ? '<button data-act="remind">' + IC("send") + " " + L("Send deadline reminders now", "Enviar lembretes de prazo agora") + "</button>" : "") +
      (canEdit ? '<button data-act="import">' + IC("import") + " " + L("Import CSV (Jira, Azure DevOps, Kanbanize, Excel)", "Importar CSV (Jira, Azure DevOps, Kanbanize, Excel)") + "</button>" : "") +
      (canEdit ? '<button data-act="kpitab">' + IC("objective") + " " + (kpiOn() ? L("Hide the Indicators tab", "Ocultar a aba Indicadores") : L("Show the Indicators tab (own KPIs)", "Mostrar a aba Indicadores (KPIs próprios)")) + "</button>" : "") +
      '<button data-act="export">' + IC("export") + " " + L("Export CSV", "Exportar CSV") + "</button>" +
      '<button data-act="print">' + IC("print") + " " + L("Print / PDF", "Imprimir / PDF") + "</button>" +
      '<button data-act="integrations">' + IC("integration") + " " + L("Integrations (Jira, Azure DevOps, Kanbanize)", "Integrações (Jira, Azure DevOps, Kanbanize)") + (window.CMNewBadge ? window.CMNewBadge("integrations") : "") + "</button>" +
      (canEdit ? Object.keys(PROV).filter(function (k) { return data.settings && data.settings[k]; }).map(function (k) { return '<button data-act="bulk" data-p="' + k + '">' + IC("send") + " " + L("Create in ", "Criar no ") + PROV[k].short + L(" the items created here", " os itens criados aqui") + "</button>"; }).join("") : "") +
      (owner ? '<button data-act="rename">' + IC("pencil") + " " + L("Rename", "Renomear") + "</button>" : "") +
      (owner ? '<button data-act="delete" class="danger">' + IC("trash") + " " + L("Delete planning", "Excluir planejamento") + "</button>" : "") +
      '</div><div class="pl-row-end"><button class="pl-btn" data-close>' + L("Close", "Fechar") + "</button></div>", function (box, close) {
      box.querySelectorAll("[data-act]").forEach(function (b) {
        b.onclick = function () {
          close();
          ({ psettings: planSettingsDialog, kpitab: function () { save("settings/kpiTab", !kpiOn()).then(function () { if (kpiOn()) view = "kpi"; }); }, workflow: workflowDialog, remind: sendReminders, import: importDialog, export: exportCsv, print: function () { window.print(); }, integrations: integrationsDialog, rename: renameDialog, delete: deletePlanning, alerts: alertsDialog, bulk: function () { bulkCreate(b.dataset.p); } })[b.dataset.act]();
        };
      });
    });
  }
  function renameDialog() {
    modal("<h2>" + L("Rename planning", "Renomear planejamento") + '</h2><form class="pl-form" id="rnF"><input name="t" required value="' + esc(info.title) + '"><div class="pl-row-end"><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + L("Save", "Salvar") + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#rnF");
      f.onsubmit = function (e) { e.preventDefault(); const v = f.t.value.trim(); const u = {}; u["planning/" + ID + "/info/title"] = v; u["workspaces/" + info.ws + "/plannings/" + ID + "/title"] = v; db.ref().update(u).then(function () { info.title = v; close(); shell(); }, fail); };
    });
  }
  /* ready-made workflows (Jira / Azure DevOps / Kanbanize style), incl. upstream (discovery) and downstream (delivery) */
  function wfPresets() { return window.PLAN_WORKFLOWS(); }
  function workflowDialog() {
    let ss = JSON.parse(JSON.stringify(statuses()));
    const P = wfPresets();
    const catOpts = [["todo", L("To do", "A fazer")], ["doing", L("In progress", "Em andamento")], ["done", L("Done", "Concluído")]];
    const stageOpts = [["", "—"], ["up", "Upstream"], ["down", "Downstream"]];
    function rowsH() {
      return ss.map(function (s, i) {
        return '<div class="wf-row" data-i="' + i + '"><input type="color" data-k="color" value="' + esc(stColor(s)) + '" title="' + L("Colour", "Cor") + '"><input data-k="name" value="' + esc(s.name) + '"><select data-k="cat" title="' + L("Category", "Categoria") + '">' + catOpts.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === s.cat ? " selected" : "") + ">" + c[1] + "</option>"; }).join("") + "</select>" +
          '<select data-k="stage" title="' + L("Stage", "Etapa") + '">' + stageOpts.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === (s.stage || "") ? " selected" : "") + ">" + c[1] + "</option>"; }).join("") + "</select>" +
          '<input data-k="wip" type="number" min="0" placeholder="WIP" value="' + esc(s.wip || "") + '"><button type="button" data-up="' + i + '" title="' + L("Move up", "Subir") + '">↑</button><button type="button" data-rm="' + i + '" title="' + L("Remove", "Remover") + '">✕</button></div>';
      }).join("");
    }
    modal("<h2>" + L("Workflow and columns", "Fluxo e colunas") + '</h2><p class="muted small">' + L("Each status is a board column – drag cards between them like in Jira, Azure DevOps or Kanbanize. The category tells reports what counts as done; WIP limits the cards per column; the stage groups columns into upstream (discovery) and downstream (delivery).", "Cada status é uma coluna do quadro – arraste os cartões entre elas como no Jira, Azure DevOps ou Kanbanize. A categoria diz o que conta como concluído; o WIP limita os cartões por coluna; a etapa agrupa as colunas em upstream (descoberta) e downstream (entrega).") + "</p>" +
      '<label class="wf-pre">' + L("Start from a ready-made workflow", "Começar de um fluxo pronto") + '<select id="wfPre"><option value="">' + L("— keep the current workflow —", "— manter o fluxo atual —") + "</option>" + Object.keys(P).map(function (k) { return '<option value="' + k + '">' + esc(P[k].name) + "</option>"; }).join("") + "</select></label>" +
      '<div class="wf-head"><span></span><span>' + L("Status", "Status") + "</span><span>" + L("Category", "Categoria") + "</span><span>" + L("Stage", "Etapa") + '</span><span>WIP</span><span></span><span></span></div><div id="wfRows"></div><button type="button" class="pl-btn sm" id="wfAdd">+ ' + L("Add status", "Adicionar status") + '</button><div class="pl-row-end"><button class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary" id="wfSave">' + L("Save", "Salvar") + "</button></div>", function (box, close) {
      const R = box.querySelector("#wfRows");
      function draw() {
        R.innerHTML = rowsH();
        R.querySelectorAll("[data-k]").forEach(function (inp) { inp.onchange = function () { const i = Number(inp.closest(".wf-row").dataset.i), k = inp.dataset.k; ss[i][k] = k === "wip" ? (Number(inp.value) || null) : inp.value; }; });
        R.querySelectorAll("[data-up]").forEach(function (b) { b.onclick = function () { const i = Number(b.dataset.up); if (i > 0) { const t = ss[i - 1]; ss[i - 1] = ss[i]; ss[i] = t; draw(); } }; });
        R.querySelectorAll("[data-rm]").forEach(function (b) { b.onclick = function () { if (ss.length > 2) { ss.splice(Number(b.dataset.rm), 1); draw(); } }; });
      }
      draw();
      box.querySelector("#wfPre").onchange = function () { const p = P[this.value]; if (p) { ss = JSON.parse(JSON.stringify(p.ss)); draw(); } };
      box.querySelector("#wfAdd").onclick = function () { ss.splice(ss.length - 1, 0, { id: "s" + Date.now().toString(36), name: L("New status", "Novo status"), cat: "doing" }); draw(); };
      box.querySelector("#wfSave").onclick = function () {
        const old = statuses();
        ss = ss.map(function (s) { const o = { id: s.id, name: (s.name || "").trim() || s.id, cat: s.cat }; if (s.wip) o.wip = s.wip; if (s.stage) o.stage = s.stage; if (s.color && s.color.toLowerCase() !== stColor({ id: o.id, name: o.name, cat: o.cat }).toLowerCase()) o.color = s.color; return o; });
        const ids = {}; ss.forEach(function (s) { ids[s.id] = 1; });
        const u = { "settings/statuses": ss };
        /* items in a status that no longer exists move to the first status of the same category */
        items().forEach(function (i) {
          if (ids[i.status]) return;
          const oc = (old.find(function (s) { return s.id === i.status; }) || old[0] || {}).cat || "todo";
          const tgt = ss.find(function (s) { return s.cat === oc && s.stage !== "up"; }) || ss.find(function (s) { return s.cat === oc; }) || ss[0];
          u["items/" + i.id + "/status"] = tgt.id;
        });
        db.ref("planning/" + ID + "/data").update(u).then(close, fail);
      };
    });
  }
  /* ---------------- integrations: Jira Cloud, Azure DevOps Boards, Kanbanize ----------------
   * Credentials go only to the platform server (Apps Script), never to the browser storage or the database. */
  const PROV = {
    jira: { name: "Jira Cloud", short: "Jira", item: L("issue", "issue"),
      desc: L("Epics, stories, tasks and bugs by project or JQL.", "Épicos, histórias, tarefas e bugs por projeto ou JQL."),
      fields: [["site", L("Jira site", "Site do Jira"), "https://sua-empresa.atlassian.net", "url"], ["email", L("Atlassian account e-mail", "E-mail da conta Atlassian"), "", "email"], ["token", L("API token", "Token de API"), "", "password"]],
      help: ["https://id.atlassian.com/manage-profile/security/api-tokens", L("Create an API token in your Atlassian account ↗", "Criar um token de API na sua conta Atlassian ↗")],
      pick: L("Project", "Projeto"), query: "JQL", queryPh: 'project = ABC ORDER BY Rank ASC', queryNote: L("Optional when a project is chosen.", "Opcional quando um projeto é escolhido.") },
    azure: { name: "Azure DevOps Boards", short: "Azure", item: "work item",
      desc: L("Epics, features, user stories / PBIs, tasks and bugs with start and target dates.", "Epics, features, user stories / PBIs, tasks e bugs com datas de início e alvo."),
      fields: [["org", L("Organisation URL", "URL da organização"), "https://dev.azure.com/sua-organizacao", "url"], ["pat", L("Personal Access Token (Work Items: read & write)", "Personal Access Token (Work Items: leitura e escrita)"), "", "password"]],
      help: ["https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate", L("How to create a Personal Access Token ↗", "Como criar um Personal Access Token ↗")],
      pick: L("Project", "Projeto"), query: "WIQL", queryPh: "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.State] <> 'Removed'", queryNote: L("Optional – by default every work item of the project (except Removed).", "Opcional – por padrão, todos os work items do projeto (exceto Removed).") },
    kanbanize: { name: "Kanbanize (Businessmap)", short: "Kanbanize", item: L("card", "cartão"),
      desc: L("Cards, columns, owners, deadlines and size from a board.", "Cartões, colunas, responsáveis, prazos e tamanho de um quadro."),
      fields: [["url", L("Account URL", "URL da conta"), "https://sua-conta.kanbanize.com", "url"], ["key", L("API key (your profile → API)", "Chave de API (seu perfil → API)"), "", "password"]],
      help: ["https://businessmap.io/", L("Where to find the API key: Businessmap → your profile → API ↗", "Onde fica a chave de API: Businessmap → seu perfil → API ↗")],
      pick: L("Board", "Quadro"), query: null }
  };
  function integrationsDialog() {
    if (window.CMMarkSeen) { window.CMMarkSeen("integrations"); document.querySelectorAll('.new-dot[data-new-id="integrations"]').forEach(function (d) { d.remove(); }); }
    const owner = isAdm || (wsInfo.owner && wsInfo.owner === A.key(me.email));
    const card = function (k) {
      const P = PROV[k], C = wsInteg[k], S = data.settings && data.settings[k];
      if (C) return '<div class="int-card on"><b>' + P.name + '</b><p class="small">✅ ' + L("Connected to ", "Conectado a ") + "<b>" + esc(String(C.site).replace("https://", "")) + "</b>" + (C.account ? " · " + esc(C.account) : "") + "</p>" +
        (S ? '<p class="muted small">' + L("This planning syncs with ", "Este planning sincroniza com ") + "<b>" + esc(S.projectName || S.project || "") + "</b>" + (S.query ? " · <code>" + esc(S.query) + "</code>" : "") + (S.lastSync ? " · " + L("last sync ", "última sincronização ") + new Date(S.lastSync).toLocaleString(window.MB_LOCALE || (window.MB_LOCALE || (PT ? "pt-BR" : "en-GB"))) : "") + "</p>" : "") +
        '<div class="pl-row-end" style="justify-content:flex-start">' + (canEdit ? '<button class="pl-btn primary sm" data-imp="' + k + '">' + (S ? L("Change import / sync", "Alterar importação / sincronizar") : L("Import from ", "Importar do ") + P.short) + "</button>" : "") + (owner ? '<button class="pl-btn ghost danger sm" data-off="' + k + '">' + L("Disconnect", "Desconectar") + "</button>" : "") + "</div></div>";
      if (!owner) return '<div class="int-card"><b>' + P.name + '</b><p class="muted small">' + P.desc + '</p><p class="muted small">' + L("Ask the workspace owner or an admin to connect it.", "Peça ao dono do workspace ou a um administrador para conectar.") + "</p></div>";
      return '<div class="int-card"><b>' + P.name + '</b><p class="muted small">' + P.desc + '</p><button class="pl-btn sm" data-con="' + k + '">' + L("Connect", "Conectar") + "</button></div>";
    };
    modal("<h2>" + L("Integrations", "Integrações") + '</h2><div class="int-grid">' + Object.keys(PROV).map(card).join("") + '</div><p class="muted small">' + L("Credentials stay on the platform server – never in the browser or the database. Any other tool: More → Import CSV.", "As credenciais ficam no servidor da plataforma – nunca no navegador nem no banco de dados. Outras ferramentas: Mais → Importar CSV.") + '</p><div class="pl-row-end"><button class="pl-btn" data-close>' + L("Close", "Fechar") + "</button></div>", function (box, close) {
      box.querySelectorAll("[data-con]").forEach(function (b) { b.onclick = function () { close(); connectDialog(b.dataset.con); }; });
      box.querySelectorAll("[data-imp]").forEach(function (b) { b.onclick = function () { close(); importExtDialog(b.dataset.imp); }; });
      box.querySelectorAll("[data-off]").forEach(function (b) {
        b.onclick = function () {
          const k = b.dataset.off;
          notify(k + "-disconnect", {}).then(function (j) {
            if (!j || !j.ok) return toast((j && j.error) || "");
            wsInteg[k] = null; db.ref("workspaces/" + info.ws + "/integrations/" + k).remove().catch(function () { /* ignore */ });
            toast(PROV[k].name + L(" disconnected", " desconectado")); close();
          });
        };
      });
    });
  }
  function connectDialog(k) {
    const P = PROV[k];
    modal("<h2>" + L("Connect ", "Conectar ") + P.name + '</h2><form class="pl-form" id="cnF"><p class="muted small">' + L("Connect once per workspace. The credential stays on the platform server – it is never saved in the browser or in the database.", "Conecte uma vez por workspace. A credencial fica no servidor da plataforma – nunca é salva no navegador nem no banco de dados.") + "</p>" +
      P.fields.map(function (f) { return "<label>" + f[1] + '<input name="' + f[0] + '" type="' + (f[3] === "password" ? "password" : f[3] === "email" ? "email" : "text") + '" required placeholder="' + esc(f[2]) + '" autocomplete="' + (f[3] === "password" ? "new-password" : "off") + '"></label>'; }).join("") +
      '<p class="muted small"><a href="' + P.help[0] + '" target="_blank" rel="noopener">' + P.help[1] + "</a></p>" +
      '<div class="pl-row-end"><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + L("Connect", "Conectar") + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#cnF");
      f.onsubmit = function (e) {
        e.preventDefault(); const b = f.querySelector(".pl-btn.primary"); b.disabled = true; b.textContent = L("Connecting…", "Conectando…");
        const body = {}; P.fields.forEach(function (x) { body[x[0]] = f[x[0]].value.trim(); });
        notify(k + "-connect", body).then(function (j) {
          P.fields.forEach(function (x) { if (x[3] === "password") f[x[0]].value = ""; });
          if (!j || !j.ok) { b.disabled = false; b.textContent = L("Connect", "Conectar"); return toast(L("Could not connect: ", "Não foi possível conectar: ") + ((j && j.error) || "")); }
          wsInteg[k] = { site: j.site, account: j.account || "", by: me.email, at: Date.now() };
          db.ref("workspaces/" + info.ws + "/integrations/" + k).set(wsInteg[k]).catch(function () { /* marker only */ });
          toast(P.name + L(" connected", " conectado")); close(); importExtDialog(k);
        });
      };
    });
  }
  function importExtDialog(k) {
    const P = PROV[k], S = (data.settings && data.settings[k]) || {};
    modal("<h2>" + L("Import from ", "Importar do ") + P.name + '</h2><form class="pl-form" id="exF"><label>' + P.pick + '<select name="proj"><option value="">' + L("Loading…", "Carregando…") + "</option></select></label>" +
      (P.query ? "<label>" + P.query + '<textarea name="query" rows="3" placeholder="' + esc(P.queryPh) + '">' + esc(S.query || "") + '</textarea><span class="muted small" style="font-weight:400">' + P.queryNote + "</span></label>" : "") +
      '<label class="chk"><input type="checkbox" name="push"' + (S.push === false ? "" : " checked") + "> " + L("Send changes made here back to ", "Enviar para o ") + P.short + L(" (title, status, dates)", " as alterações feitas aqui (título, status, datas)") + "</label>" +
      '<label class="chk"><input type="checkbox" name="auto"' + (S.autoCreate ? " checked" : "") + "> " + L("Automatically create in ", "Criar automaticamente no ") + P.short + L(" the initiatives, epics and stories created here", " as iniciativas, épicos e histórias criados aqui") + "</label>" +
      '<p class="muted small">' + L("Epics become epics/phases and children keep their parent. Items already imported are updated – nothing is duplicated.", "Épicos viram épicos/fases e os filhos mantêm o pai. Itens já importados são atualizados – nada é duplicado.") + "</p>" +
      '<div class="pl-row-end"><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + L("Import", "Importar") + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#exF");
      notify(k + "-projects", {}).then(function (j) {
        if (!j || !j.ok) { f.proj.innerHTML = '<option value="">' + esc((j && j.error) || "error") + "</option>"; return; }
        f.proj.innerHTML = '<option value="">' + L("— choose —", "— escolha —") + "</option>" + j.projects.map(function (p) { return '<option value="' + esc(p.key) + '"' + (String(S.project) === String(p.key) ? " selected" : "") + ">" + esc(p.name) + (p.name !== p.key && !/^\d+$/.test(p.key) ? " (" + esc(p.key) + ")" : "") + "</option>"; }).join("");
      });
      if (k === "jira") f.proj.onchange = function () { if (f.proj.value && !f.query.value.trim()) f.query.value = 'project = "' + f.proj.value + '" ORDER BY Rank ASC'; };
      f.onsubmit = function (e) {
        e.preventDefault();
        const q = f.query ? f.query.value.trim() : "", pr = f.proj.value;
        if (!pr && !q) return toast(L("Choose a ", "Escolha um ") + P.pick.toLowerCase());
        if (k !== "jira" && !pr) return toast(L("Choose a ", "Escolha um ") + P.pick.toLowerCase());
        const params = { project: pr, projectName: pr ? f.proj.selectedOptions[0].textContent : "", query: k === "jira" ? (q || 'project = "' + pr + '" ORDER BY Rank ASC') : q };
        const b = f.querySelector(".pl-btn.primary"); b.disabled = true; b.textContent = L("Importing…", "Importando…");
        params.autoCreate = f.auto.checked;
        extRun(k, params, f.push.checked).then(function (ok) { if (ok) close(); else { b.disabled = false; b.textContent = L("Import", "Importar"); } });
      };
    });
  }
  function extRun(k, params, push) {
    const P = PROV[k];
    toast(L("Talking to ", "Conversando com o ") + P.short + "…");
    return notify(k + "-import", { project: params.project, query: params.query, jql: params.query }).then(function (j) {
      if (!j || !j.ok) { toast(P.short + ": " + ((j && j.error) || "error")); return false; }
      return mergeExt(k, j.issues).then(function (n) {
        const S = { project: params.project || "", query: params.query || "", push: !!push, lastSync: Date.now(), site: j.site || "", autoCreate: params.autoCreate === undefined ? !!(data.settings[k] || {}).autoCreate : !!params.autoCreate };
        if (params.projectName || (data.settings[k] || {}).projectName) S.projectName = params.projectName || data.settings[k].projectName;
        if (k === "jira") S.jql = S.query;
        return save("settings/" + k, S).then(function () {
          toast(n.created + L(" new, ", " novos, ") + n.updated + L(" updated from ", " atualizados do ") + P.short); return true;
        });
      });
    });
  }
  function mergeExt(src, issues) {
    const ss = statuses(), types = method().types, byKey = {}, u = {}, res = { created: 0, updated: 0 };
    items().forEach(function (i) { if (i.ext && i.ext.source === src && i.ext.key) byKey[i.ext.key] = i.id; });
    const emails = {}; Object.keys(members).forEach(function (k) { emails[members[k].email.toLowerCase()] = members[k].email; });
    function tp(x) {
      const n = (x.type || "").toLowerCase();
      if ((x.level >= 2 || /initiative|iniciativa/.test(n)) && types.indexOf("initiative") >= 0) return "initiative";
      if (x.level >= 1 || /epic|épico|feature/.test(n)) return types.indexOf("epic") >= 0 ? "epic" : "phase";
      if (/bug|defeito|defect/.test(n)) return types.indexOf("bug") >= 0 ? "bug" : "task";
      if (/story|história|historia|backlog item|requirement|requisito/.test(n)) return types.indexOf("story") >= 0 ? "story" : "task";
      if (/milestone|marco/.test(n)) return "milestone";
      return "task";
    }
    function st(x) {
      const exact = ss.find(function (s) { return s.name.toLowerCase() === (x.status || "").toLowerCase(); }); if (exact) return exact.id;
      const c = { new: "todo", indeterminate: "doing", done: "done" }[x.cat] || "todo";
      return (ss.find(function (s) { return s.cat === c; }) || ss[0]).id;
    }
    issues.forEach(function (x) { if (!byKey[x.key]) { byKey[x.key] = db.ref().push().key; x._new = true; } });
    issues.forEach(function (x, i) {
      const id = byKey[x.key], Pp = "items/" + id + "/", sid = st(x), o = {
        title: x.title, type: tp(x), status: sid, key: x.key,
        start: x.start || x.due || null, end: x.due || x.start || null,
        assignee: x.assignee && emails[x.assignee.toLowerCase()] ? emails[x.assignee.toLowerCase()] : (x._new ? null : undefined),
        points: x.points == null || x.points === "" ? null : Number(x.points),
        parent: x.parent && byKey[x.parent] ? byKey[x.parent] : null,
        ext: { source: src, key: x.key, url: x.url || null, assigneeName: x.assigneeName || null, ref: x.ref || null, project: x.project || null, wtype: x.wtype || null, board: x.board || null, workflow: x.workflow || null }
      };
      if (ss.find(function (s) { return s.id === sid && s.cat === "done"; })) o.progress = 100;
      if (x._new) { o.order = Date.now() + i; o.created = TS(); o.by = me.email; res.created++; } else res.updated++;
      Object.keys(o).forEach(function (kk) { if (o[kk] !== undefined) u[Pp + kk] = o[kk]; });
    });
    return db.ref("planning/" + ID + "/data").update(u).then(function () { return res; });
  }

  /* ---------------- integration hint ---------------- */
  function hintBar() {
    if (!canEdit) return "";
    const linked = Object.keys(PROV).some(function (k) { return data.settings && data.settings[k]; });
    let off = null; try { off = localStorage.getItem("cmcollab:inthint:" + ID); } catch (e) { /* ignore */ }
    if (linked || off) return "";
    return '<div class="pl-hint" id="intHint">' + IC("integration", 18) + '<div><b>' + L("Connect this planning to Jira, Azure DevOps or Kanbanize", "Integre este planejamento com Jira, Azure DevOps ou Kanbanize") + "</b>" + (window.CMNewBadge ? window.CMNewBadge("integrations") : "") +
      '<span>' + L("Import initiatives, epics and stories, keep status and dates in sync both ways and create there the items you create here.", "Importe iniciativas, épicos e histórias, sincronize status e datas nos dois sentidos e crie lá os itens que criar aqui.") + '</span></div><button class="pl-btn sm primary" id="hintGo">' + L("Connect", "Conectar") + '</button><button class="pl-btn icon ghost" id="hintX" title="' + L("Hide", "Ocultar") + '">' + IC("close", 14) + "</button></div>";
  }

  /* ---------------- OKRs: objectives with key results, linked to items ---------------- */
  function okrs() { const o = data.okrs || {}; return Object.keys(o).map(function (k) { return Object.assign({ id: k }, o[k]); }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); }); }
  function krList(o) { const k = o.krs || {}; return Object.keys(k).map(function (id) { return Object.assign({ id: id }, k[id]); }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); }); }
  function allKrs() { const out = []; okrs().forEach(function (o) { krList(o).forEach(function (k) { out.push({ ref: o.id + "|" + k.id, label: o.title + " › " + k.title }); }); }); return out; }
  function linkedItems(oid, kid) { return items().filter(function (i) { return i.krs && i.krs[oid + "|" + kid]; }); }
  /* OKR → initiative → epic → story: an item contributes to a KR if it or any ancestor is linked to it */
  function linksKr(it, ref) { let cur = it, guard = 0; while (cur && guard++ < 12) { if (cur.krs && cur.krs[ref]) return true; cur = cur.parent ? data.items[cur.parent] && Object.assign({ id: cur.parent }, data.items[cur.parent]) : null; } return false; }
  function krLeaves(oid, kid) { const ref = oid + "|" + kid; return items().filter(function (i) { return !isContainer(i) && i.type !== "milestone" && linksKr(i, ref); }); }
  function itemPct(it) { if (!isContainer(it)) return cat(it) === "done" ? 100 : cat(it) === "doing" ? 50 : 0; const r = rollup(it); return r ? Math.round(r.done) : 0; }
  function krProgress(o, kr) {
    if (kr.auto) { const lv = krLeaves(o.id, kr.id); return lv.length ? Math.round(lv.filter(function (i) { return cat(i) === "done"; }).length / lv.length * 100) : 0; }
    const s0 = Number(kr.start) || 0, t = Number(kr.target), c = Number(kr.current);
    if (isNaN(t) || t === s0 || isNaN(c)) return 0;
    return Math.max(0, Math.min(100, Math.round((c - s0) / (t - s0) * 100)));
  }
  function objProgress(o) { const ks = krList(o); return ks.length ? Math.round(ks.reduce(function (n, k) { return n + krProgress(o, k); }, 0) / ks.length) : 0; }
  function pcol(p) { return p >= 70 ? "#36b37e" : p >= 40 ? "#e8a400" : "#e5484d"; }
  function quarters() { const d = new Date(), y = d.getFullYear(), q = Math.floor(d.getMonth() / 3) + 1, out = []; for (let i = -1; i < 6; i++) { const qq = ((q - 1 + i) % 4 + 4) % 4 + 1, yy = y + Math.floor((q - 1 + i) / 4); out.push(yy + "-Q" + qq); } out.push(String(y), String(y + 1)); return out; }
  function okrView(v) {
    const os = okrs();
    v.innerHTML = '<div class="okr"><div class="okr-head"><div><h2>' + IC("objective", 20) + " OKRs</h2><p class=\"muted\">" + L("Objectives and key results for this planning. Link initiatives, epics and stories to the key results they move.", "Objetivos e resultados-chave deste planejamento. Ligue iniciativas, épicos e histórias aos resultados-chave que eles movem.") + "</p></div>" +
      (canEdit ? '<button class="pl-btn primary" id="okrNew">' + IC("plus", 16) + " " + L("Objective", "Objetivo") + "</button>" : "") + "</div>" +
      okrGaps() +
      (os.length ? os.map(objCard).join("") : '<div class="pl-empty big">' + IC("objective", 40, "big") + "<h2>" + L("No objectives yet", "Ainda não há objetivos") + "</h2><p>" + L("Example: “Delight our customers” – KR: NPS from 30 to 50.", "Exemplo: “Encantar nossos clientes” – KR: NPS de 30 para 50.") + "</p></div>") + "</div>";
    const nb = document.getElementById("okrNew"); if (nb) nb.onclick = function () { objDialog(); };
    v.querySelectorAll("[data-obj]").forEach(function (b) { b.onclick = function () { objDialog(b.dataset.obj); }; });
    v.querySelectorAll("[data-addkr]").forEach(function (b) { b.onclick = function () { krDialog(b.dataset.addkr); }; });
    v.querySelectorAll("[data-kr]").forEach(function (b) { b.onclick = function (e) { if (e.target.closest("[data-open]")) return; const p = b.dataset.kr.split("|"); krDialog(p[0], p[1]); }; });
    v.querySelectorAll("[data-open]").forEach(function (a) { a.onclick = function (e) { e.preventDefault(); openDrawer(a.dataset.open); }; });
  }
  function krNode(i, depth) {
    const T = TYPES[i.type] || TYPES.task, p = itemPct(i);
    const kids = depth < 1 && isContainer(i) ? children(i.id).filter(isContainer) : [];
    return '<span class="kr-node" style="--d:' + depth + '"><a href="#" data-open="' + i.id + '" style="--c:' + T.color + '">' + T.icon + " " + esc((i.key ? i.key + " · " : "") + i.title) + '</a><span class="kn-pr"><span class="pbar"><i style="width:' + p + "%;background:" + pcol(p) + '"></i></span>' + p + "%</span></span>" +
      kids.slice(0, 6).map(function (c) { return krNode(c, depth + 1); }).join("");
  }
  /* gaps in the chain: initiatives with no OKR, epics with no initiative */
  function okrGaps() {
    const all = items(), hasIni = all.some(function (i) { return i.type === "initiative"; }), hasKr = allKrs().length > 0;
    const noOkr = hasKr ? all.filter(function (i) { return i.type === "initiative" && !(i.krs && Object.keys(i.krs).length); }) : [];
    const noIni = hasIni ? all.filter(function (i) { return (i.type === "epic" || i.type === "phase") && !(i.parent && data.items[i.parent] && data.items[i.parent].type === "initiative"); }) : [];
    if (!noOkr.length && !noIni.length) return hasKr && hasIni ? '<div class="okr-ok">' + IC("task", 16) + " " + L("Everything is connected: every initiative serves an OKR and every epic belongs to an initiative.", "Tudo conectado: toda iniciativa atende a um OKR e todo épico pertence a uma iniciativa.") + "</div>" : "";
    const chip = function (i) { const T = TYPES[i.type] || TYPES.task; return '<a href="#" data-open="' + i.id + '" style="--c:' + T.color + '">' + T.icon + " " + esc((i.key ? i.key + " · " : "") + i.title) + "</a>"; };
    return '<div class="okr-gaps">' +
      (noOkr.length ? "<div><b>" + noOkr.length + " " + L("initiative(s) not linked to an OKR", "iniciativa(s) sem OKR") + '</b><span class="kr-items">' + noOkr.slice(0, 6).map(chip).join("") + "</span></div>" : "") +
      (noIni.length ? "<div><b>" + noIni.length + " " + L("epic(s) without an initiative", "épico(s) sem iniciativa") + '</b><span class="kr-items">' + noIni.slice(0, 6).map(chip).join("") + "</span></div>" : "") +
      '<span class="muted small">' + L("Open the item and choose its OKR or parent initiative.", "Abra o item e escolha o OKR ou a iniciativa pai.") + "</span></div>";
  }
  function objCard(o) {
    const pr = objProgress(o), ks = krList(o);
    return '<section class="okr-card"><header>' + '<span class="ti" style="color:#0f766e">' + IC("objective", 18) + '</span><div class="okr-t"><b>' + esc(o.title) + "</b><span class=\"muted small\">" + esc(o.period || "") + (o.owner ? " · " + esc(memberName(o.owner)) : "") + "</span></div>" +
      '<div class="okr-pr"><span class="pbar"><i style="width:' + pr + "%;background:" + pcol(pr) + '"></i></span><b>' + pr + "%</b></div>" + (canEdit ? '<button class="pl-btn sm ghost" data-obj="' + o.id + '">' + IC("pencil", 14) + "</button>" : "") + "</header>" +
      ks.map(function (k) {
        const p = krProgress(o, k), li = linkedItems(o.id, k.id);
        return '<div class="kr-row" data-kr="' + o.id + "|" + k.id + '"><span class="ti" style="color:#0f766e">' + IC("kr", 16) + '</span><div class="kr-t"><span>' + esc(k.title) + '</span><span class="muted small">' +
          (k.auto ? (function () { const lv = krLeaves(o.id, k.id); return L("measured by linked work: ", "medido pelo trabalho ligado: ") + lv.filter(function (i) { return cat(i) === "done"; }).length + "/" + lv.length + L(" items done", " itens concluídos"); })() : esc(String(k.current == null ? (k.start || 0) : k.current)) + " / " + esc(String(k.target)) + " " + esc(k.unit || "") + L(" (from ", " (de ") + esc(String(k.start || 0)) + ")") + "</span>" +
          (li.length ? '<span class="kr-tree">' + li.slice(0, 8).map(function (i) { return krNode(i, 0); }).join("") + (li.length > 8 ? '<span class="muted small">+' + (li.length - 8) + "</span>" : "") + "</span>" : "") + "</div>" +
          '<div class="okr-pr sm"><span class="pbar"><i style="width:' + p + "%;background:" + pcol(p) + '"></i></span><b>' + p + "%</b></div></div>";
      }).join("") + (canEdit ? '<button class="kb-add" data-addkr="' + o.id + '">' + IC("plus", 14) + " " + L("Key result", "Resultado-chave") + "</button>" : "") + "</section>";
  }
  function objDialog(oid) {
    const o = oid ? (data.okrs || {})[oid] || {} : {}, qs = quarters();
    if (!o.period) o.period = qs[1];
    modal("<h2>" + (oid ? L("Edit objective", "Editar objetivo") : L("New objective", "Novo objetivo")) + '</h2><form class="pl-form" id="obF"><label>' + L("Objective", "Objetivo") + '<input name="title" required value="' + esc(o.title || "") + '" placeholder="' + L("e.g. Delight our customers", "ex.: Encantar nossos clientes") + '"></label>' +
      '<div class="g2"><label>' + L("Period", "Período") + '<select name="period">' + qs.map(function (q) { return "<option" + (q === o.period ? " selected" : "") + ">" + q + "</option>"; }).join("") + "</select></label><label>" + L("Owner", "Responsável") + '<select name="owner"><option value="">—</option>' + Object.keys(members).map(function (k) { return '<option value="' + esc(members[k].email) + '"' + (members[k].email === o.owner ? " selected" : "") + ">" + esc(members[k].name || members[k].email) + "</option>"; }).join("") + "</select></label></div>" +
      (oid ? "" : '<label>' + L("First key result (optional)", "Primeiro resultado-chave (opcional)") + '<input name="kr" placeholder="' + L("e.g. NPS from 30 to 50", "ex.: NPS de 30 para 50") + '"></label>') +
      '<div class="pl-row-end">' + (oid ? '<button type="button" class="pl-btn ghost danger" id="obDel">' + L("Delete", "Excluir") + '</button><span class="sp"></span>' : "") + '<button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + L("Save", "Salvar") + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#obF");
      f.onsubmit = function (e) {
        e.preventDefault();
        const id = oid || db.ref().push().key, u = {};
        u["okrs/" + id + "/title"] = f.title.value.trim(); u["okrs/" + id + "/period"] = f.period.value; u["okrs/" + id + "/owner"] = f.owner.value || null;
        if (!oid) { u["okrs/" + id + "/order"] = Date.now(); u["okrs/" + id + "/created"] = TS(); u["okrs/" + id + "/by"] = me.email; }
        if (!oid && f.kr.value.trim()) { const m = f.kr.value.match(/(-?[\d.,]+)\D+(-?[\d.,]+)\s*(%|\w+)?\s*$/); const k = db.ref().push().key; u["okrs/" + id + "/krs/" + k] = { title: f.kr.value.trim(), start: m ? Number(m[1].replace(",", ".")) : 0, target: m ? Number(m[2].replace(",", ".")) : 100, current: m ? Number(m[1].replace(",", ".")) : 0, unit: m && m[3] ? m[3] : (m ? "" : "%"), order: Date.now() }; }
        db.ref("planning/" + ID + "/data").update(u).then(function () { close(); if (view !== "okr") { view = "okr"; shell(); } }, fail);
      };
      const del = box.querySelector("#obDel");
      if (del) del.onclick = function () {
        const u = {}; u["okrs/" + oid] = null;
        items().forEach(function (i) { Object.keys(i.krs || {}).forEach(function (r) { if (r.indexOf(oid + "|") === 0) u["items/" + i.id + "/krs/" + r] = null; }); });
        db.ref("planning/" + ID + "/data").update(u).then(close, fail);
      };
    });
  }
  function krDialog(oid, kid) {
    const k = kid ? ((data.okrs[oid].krs || {})[kid] || {}) : { start: 0, target: 100, current: 0, unit: "%" };
    const li = kid ? linkedItems(oid, kid) : [];
    modal("<h2>" + (kid ? L("Key result", "Resultado-chave") : L("New key result", "Novo resultado-chave")) + '</h2><p class="muted small">' + esc(data.okrs[oid].title) + '</p><form class="pl-form" id="krF"><label>' + L("Key result", "Resultado-chave") + '<input name="title" required value="' + esc(k.title || "") + '" placeholder="' + L("e.g. Raise NPS", "ex.: Aumentar o NPS") + '"></label>' +
      '<label class="chk"><input type="checkbox" name="auto"' + (k.auto ? " checked" : "") + "> " + L("Measure by the progress of the linked items", "Medir pelo progresso dos itens ligados") + "</label>" +
      '<div class="g2" id="krNums"><label>' + L("Start value", "Valor inicial") + '<input type="number" step="any" name="start" value="' + esc(k.start == null ? 0 : k.start) + '"></label><label>' + L("Target", "Meta") + '<input type="number" step="any" name="target" value="' + esc(k.target == null ? 100 : k.target) + '"></label><label>' + L("Current value", "Valor atual") + '<input type="number" step="any" name="current" value="' + esc(k.current == null ? (k.start || 0) : k.current) + '"></label><label>' + L("Unit", "Unidade") + '<input name="unit" value="' + esc(k.unit || "") + '" placeholder="%, R$, pts, NPS…"></label></div>' +
      (li.length ? '<p class="small"><b>' + L("Linked items", "Itens ligados") + ":</b> " + li.map(function (i) { return esc((i.key ? i.key + " " : "") + i.title); }).join(" · ") + "</p>" : '<p class="muted small">' + L("Link items to this key result in each item's panel (field “Contributes to (OKR)”).", "Ligue itens a este resultado-chave no painel de cada item (campo “Contribui para (OKR)”).") + "</p>") +
      '<div class="pl-row-end">' + (kid ? '<button type="button" class="pl-btn ghost danger" id="krDel">' + L("Delete", "Excluir") + '</button><span class="sp"></span>' : "") + '<button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary"' + (canEdit ? "" : " disabled") + ">" + L("Save", "Salvar") + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#krF"), nums = box.querySelector("#krNums");
      function tg() { nums.style.opacity = f.auto.checked ? ".45" : "1"; }
      f.auto.onchange = tg; tg();
      f.onsubmit = function (e) {
        e.preventDefault(); const id = kid || db.ref().push().key;
        const o = { title: f.title.value.trim(), auto: f.auto.checked || null, start: Number(f.start.value) || 0, target: Number(f.target.value), current: f.current.value === "" ? null : Number(f.current.value), unit: f.unit.value.trim(), order: k.order || Date.now() };
        save("okrs/" + oid + "/krs/" + id, o).then(close);
      };
      const del = box.querySelector("#krDel");
      if (del) del.onclick = function () {
        const u = {}; u["okrs/" + oid + "/krs/" + kid] = null;
        items().forEach(function (i) { if ((i.krs || {})[oid + "|" + kid]) u["items/" + i.id + "/krs/" + oid + "|" + kid] = null; });
        db.ref("planning/" + ID + "/data").update(u).then(close, fail);
      };
    });
  }

  /* ---------------- e-mail alerts settings ---------------- */
  function alertsDialog() {
    if (window.CMMarkSeen) window.CMMarkSeen("alerts");
    const N = Object.assign({ enabled: false, before: [7, 1], scope: { milestones: true, key: true, all: false }, overdue: "daily", to: { assignee: true, owner: true, watchers: [] } }, (data.settings && data.settings.notify) || {});
    const ppl = Object.keys(members).map(function (k) { return members[k]; });
    const nMs = items().filter(function (i) { return i.type === "milestone"; }).length, nKey = items().filter(function (i) { return i.prio; }).length;
    modal("<h2>" + IC("bell", 20) + " " + L("E-mail alerts", "Alertas por e-mail") + '</h2><p class="muted small">' + L("Get warned in advance about milestones and key activities, and when something is late. Sent every morning (08:00, Lisbon time) by the platform.", "Seja avisado com antecedência dos marcos e atividades principais, e quando algo atrasar. Enviado todas as manhãs (08h, horário de Lisboa) pela plataforma.") + "</p>" +
      '<form class="pl-form" id="alF"><label class="chk big"><input type="checkbox" name="enabled"' + (N.enabled ? " checked" : "") + "> <b>" + L("Alerts on for this planning", "Alertas ativos neste planejamento") + "</b></label>" +
      '<fieldset><legend>' + L("What to watch", "O que acompanhar") + '</legend><label class="chk"><input type="checkbox" name="ms"' + (N.scope.milestones ? " checked" : "") + "> ◆ " + L("Milestones", "Marcos") + ' <span class="muted">(' + nMs + ')</span></label><label class="chk"><input type="checkbox" name="key"' + (N.scope.key ? " checked" : "") + "> ★ " + L("Key activities (mark ★ in the item)", "Atividades principais (marque ★ no item)") + ' <span class="muted">(' + nKey + ')</span></label><label class="chk"><input type="checkbox" name="all"' + (N.scope.all ? " checked" : "") + "> " + L("All items with a due date", "Todos os itens com prazo") + "</label></fieldset>" +
      '<fieldset><legend>' + L("Warn in advance", "Avisar com antecedência") + '</legend><div class="day-chips">' + [14, 7, 5, 3, 2, 1].map(function (d) { return '<label><input type="checkbox" name="b' + d + '"' + (N.before.indexOf(d) >= 0 ? " checked" : "") + "><span>" + d + " " + L(d === 1 ? "day" : "days", d === 1 ? "dia" : "dias") + "</span></label>"; }).join("") + '</div><p class="muted small">' + L("Plus a warning on the due date itself.", "Mais um aviso no próprio dia do prazo.") + "</p></fieldset>" +
      '<fieldset><legend>' + L("When something is late", "Quando algo atrasar") + '</legend><select name="overdue">' + [["daily", L("Warn every day until it is done", "Avisar todos os dias até concluir")], ["every3", L("Warn every 3 days", "Avisar a cada 3 dias")], ["weekly", L("Warn once a week", "Avisar uma vez por semana")], ["off", L("Don't warn about delays", "Não avisar atrasos")]].map(function (o) { return '<option value="' + o[0] + '"' + (N.overdue === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></fieldset>" +
      '<fieldset><legend>' + IC("lock", 14) + " " + L("Long impediments", "Impedimentos longos") + '</legend><label>' + L("Warn when an item stays blocked for", "Avisar quando um item ficar bloqueado por") + '<select name="blk">' + [[7, L("more than 7 days (recommended)", "mais de 7 dias (recomendado)")], [3, L("more than 3 days", "mais de 3 dias")], [5, L("more than 5 days", "mais de 5 dias")], [14, L("more than 14 days", "mais de 14 dias")], [0, L("do not warn", "não avisar")]].map(function (o) { return '<option value="' + o[0] + '"' + (Number(N.blockedDays == null ? 7 : N.blockedDays) === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + '</select></label><p class="muted small">' + L("Goes to the item's responsible, who is resolving the impediment, the card followers and the planning owner – and repeats every 7 days while it stays blocked. Works even with the alerts above turned off.", "Vai para o responsável do item, quem está resolvendo o impedimento, quem acompanha o card e o dono do planejamento – e repete a cada 7 dias enquanto continuar bloqueado. Funciona mesmo com os alertas acima desligados.") + "</p></fieldset>" +
      '<fieldset><legend>' + L("Who receives", "Quem recebe") + '</legend><label class="chk"><input type="checkbox" name="toA"' + (N.to.assignee !== false ? " checked" : "") + "> " + L("The person responsible for each item", "O responsável de cada item") + '</label><label class="chk"><input type="checkbox" name="toO"' + (N.to.owner ? " checked" : "") + "> " + L("The planning owner", "O dono do planejamento") + "</label>" +
      '<label>' + L("Also notify (e.g. PMO, sponsor)", "Avisar também (ex.: PMO, sponsor)") + '<select name="watchers" multiple size="' + Math.min(5, Math.max(2, ppl.length)) + '">' + ppl.map(function (m) { return '<option value="' + esc(m.email) + '"' + ((N.to.watchers || []).indexOf(m.email) >= 0 ? " selected" : "") + ">" + esc((m.name || m.email) + " · " + m.email) + "</option>"; }).join("") + "</select></label></fieldset>" +
      '<p class="muted small" id="alStatus"></p>' +
      '<div class="pl-row-end"><button type="button" class="pl-btn" id="alTest">' + IC("send", 14) + " " + L("Send now (test)", "Enviar agora (teste)") + '</button><span class="sp"></span><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + L("Save", "Salvar") + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#alF");
      function read() {
        return { enabled: f.enabled.checked, before: [14, 7, 5, 3, 2, 1].filter(function (d) { return f["b" + d].checked; }), scope: { milestones: f.ms.checked, key: f.key.checked, all: f.all.checked }, overdue: f.overdue.value, blockedDays: Number(f.blk.value),
          to: { assignee: f.toA.checked, owner: f.toO.checked, watchers: Array.prototype.map.call(f.watchers.selectedOptions, function (o) { return o.value; }) }, by: me.email, at: Date.now() };
      }
      notify("digest-status", {}).then(function (j) { const st = box.querySelector("#alStatus"); if (!st) return; st.innerHTML = j && j.ok && j.daily ? "✅ " + L("Automatic daily sending is active.", "Envio diário automático ativo.") : "⏳ " + L("Automatic daily sending is being activated by the administrator – meanwhile use “Send now”.", "O envio diário automático está sendo ativado pelo administrador – enquanto isso, use “Enviar agora”."); });
      f.onsubmit = function (e) { e.preventDefault(); save("settings/notify", read()).then(function () { toast(L("Alerts saved", "Alertas salvos")); close(); shell(); }); };
      box.querySelector("#alTest").onclick = function () {
        const b = this; b.disabled = true;
        save("settings/notify", Object.assign(read(), { enabled: true })).then(function () { return notify("digest", {}); }).then(function (j) {
          b.disabled = false;
          if (j && j.ok) toast(j.empty ? L("Nothing to warn about right now (no milestone/key activity due soon or late).", "Nada para avisar agora (nenhum marco/atividade principal a vencer ou atrasado).") : L("Alert sent to ", "Alerta enviado para ") + j.sent.length + L(" people", " pessoas"));
          else toast(L("Could not send: ", "Não foi possível enviar: ") + ((j && j.error) || ""));
        });
      };
    });
  }

  /* ---------------- delete planning ---------------- */
  function deletePlanning() {
    modal("<h2>" + L("Delete planning", "Excluir planejamento") + "</h2><p>" + L("This permanently deletes the planning, its items, sprints and OKRs. Type the name to confirm:", "Isto exclui definitivamente o planejamento, os itens, sprints e OKRs. Digite o nome para confirmar:") + " <b>" + esc(info.title) + '</b></p><form class="pl-form" id="dpF"><input name="t" autocomplete="off"><div class="pl-row-end"><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary danger">' + L("Delete", "Excluir") + "</button></div></form>", function (box) {
      const f = box.querySelector("#dpF");
      f.onsubmit = function (e) {
        e.preventDefault(); if (f.t.value.trim() !== info.title) return toast(L("The name does not match", "O nome não confere"));
        db.ref("planning/" + ID + "/data").off();
        const u = {}; u["planning/" + ID] = null; u["workspaces/" + info.ws + "/plannings/" + ID] = null;
        db.ref().update(u).then(function () { location.href = "../workspaces/"; }, fail);
      };
    });
  }

  /* ---------------- create in Jira / Azure DevOps / Kanbanize the items created here ---------------- */
  function createInTool(k, id, quiet) {
    const it = data.items[id]; if (!it || it.ext) return Promise.resolve(false);
    if (it.parent && data.items[it.parent] && !data.items[it.parent].ext) return createInTool(k, it.parent, true).then(function () { return createInTool(k, id, quiet); });
    return notify(k + "-create", { item: id }).then(function (j) {
      if (!j || !j.ok) { toast(PROV[k].short + ": " + ((j && j.error) || "error")); return false; }
      const u = {}; u["items/" + id + "/ext"] = { source: k, key: j.key, ref: j.ref || null, url: j.url || null, project: j.project || null, wtype: j.wtype || null, board: j.board || null, workflow: j.workflow || null }; u["items/" + id + "/key"] = j.key;
      return db.ref("planning/" + ID + "/data").update(u).then(function () { if (!quiet) toast(L("Created in ", "Criado no ") + PROV[k].short + ": " + j.key); return true; });
    });
  }
  function bulkCreate(k) {
    const todo = items().filter(function (i) { return !i.ext; }).sort(function (a, b) { return lvl(b.type) - lvl(a.type) || byOrder(a, b); });
    if (!todo.length) return toast(L("Every item is already linked.", "Todos os itens já estão ligados."));
    modal("<h2>" + L("Create in ", "Criar no ") + PROV[k].name + "</h2><p>" + todo.length + L(" items created here will be created in ", " itens criados aqui serão criados no ") + PROV[k].short + L(", keeping the hierarchy (initiative → epic → story).", ", mantendo a hierarquia (iniciativa → épico → história).") + '</p><div class="pl-row-end"><button class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary" id="bkGo">' + L("Create", "Criar") + "</button></div>", function (box, close) {
      box.querySelector("#bkGo").onclick = function () {
        this.disabled = true; let ok = 0;
        todo.reduce(function (p, i) { return p.then(function () { return createInTool(k, i.id, true).then(function (r) { if (r) ok++; }); }); }, Promise.resolve())
          .then(function () { close(); toast(ok + L(" items created in ", " itens criados no ") + PROV[k].short); });
      };
    });
  }

  /* ---------------- CSV import / export ---------------- */
  function parseCsv(text) {
    const out = []; let row = [], cell = "", q = false;
    const sep = (text.split("\n")[0].split(";").length > text.split("\n")[0].split(",").length) ? ";" : ",";
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === sep) { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); out.push(row); row = []; cell = ""; }
      else if (c !== "\r") cell += c;
    }
    if (cell || row.length) { row.push(cell); out.push(row); }
    return out.filter(function (r) { return r.some(function (c) { return c.trim(); }); });
  }
  function normDate(v) {
    if (!v) return null; v = v.trim();
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + "-" + m[2] + "-" + m[3];
    m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/); if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return y + "-" + String(m[2]).padStart(2, "0") + "-" + String(m[1]).padStart(2, "0"); }
    m = v.match(/^(\d{1,2})\/(\w{3})\/(\d{2,4})/); if (m) { const d = Date.parse(m[1] + " " + m[2] + " " + (m[3].length === 2 ? "20" + m[3] : m[3]) + " UTC"); if (!isNaN(d)) return n2d(d); }
    const d = Date.parse(v); return isNaN(d) ? null : n2d(d);
  }
  const COLS = {
    title: ["summary", "title", "título", "titulo", "name", "nome", "card title"],
    type: ["issue type", "work item type", "type", "tipo", "card type"],
    status: ["status", "state", "estado", "column", "coluna", "workflow"],
    assignee: ["assignee", "assigned to", "responsável", "responsavel", "owner", "owner email"],
    start: ["start date", "start", "início", "inicio", "data de início", "microsoft.vsts.scheduling.startdate", "start date (wd)"],
    end: ["due date", "due", "target date", "end date", "finish date", "end", "fim", "prazo", "deadline", "microsoft.vsts.scheduling.targetdate"],
    key: ["issue key", "key", "id", "card id"],
    parent: ["parent", "parent summary", "epic link", "epic name", "parent id", "épico", "epico", "fase", "phase"],
    points: ["story points", "story point estimate", "effort", "points", "pontos", "size"],
    desc: ["description", "descrição", "descricao"]
  };
  function importDialog() {
    modal("<h2>" + L("Import CSV", "Importar CSV") + '</h2><p class="muted small">' + L("Works with CSV exports from Jira, Azure DevOps, Kanbanize/Businessmap or any spreadsheet. Recognised columns: Summary/Title, Issue Type, Status, Assignee, Start date, Due date, Story Points, Parent/Epic Link, Description.", "Funciona com CSV exportado do Jira, Azure DevOps, Kanbanize/Businessmap ou de qualquer folha de cálculo. Colunas reconhecidas: Summary/Título, Issue Type/Tipo, Status/Estado, Assignee/Responsável, Start date/Início, Due date/Prazo, Story Points, Parent/Epic Link, Description.") + '</p><input type="file" id="csvF" accept=".csv,text/csv"><div id="csvPv"></div><div class="pl-row-end"><button class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary" id="csvGo" disabled>' + L("Import", "Importar") + "</button></div>", function (box, close) {
      let parsed = null;
      box.querySelector("#csvF").onchange = function (e) {
        const file = e.target.files[0]; if (!file) return;
        file.text().then(function (txt) {
          const rowsA = parseCsv(txt.replace(/^﻿/, "")); if (rowsA.length < 2) return toast(L("Empty file", "Arquivo vazio"));
          const hdr = rowsA[0].map(function (h) { return h.trim().toLowerCase(); }), map = {};
          Object.keys(COLS).forEach(function (f) { const i = hdr.findIndex(function (h) { return COLS[f].indexOf(h) >= 0; }); if (i >= 0) map[f] = i; });
          if (map.title === undefined) return toast(L("No Summary/Title column found", "Não encontrei a coluna Summary/Título"));
          parsed = { rows: rowsA.slice(1), map: map };
          box.querySelector("#csvPv").innerHTML = '<p class="small"><b>' + parsed.rows.length + " " + L("rows", "linhas") + "</b> · " + L("columns found: ", "colunas encontradas: ") + Object.keys(map).join(", ") + "</p>";
          box.querySelector("#csvGo").disabled = false;
        });
      };
      box.querySelector("#csvGo").onclick = function () {
        if (!parsed) return; this.disabled = true;
        importRows(parsed).then(function (n) { close(); toast(n + " " + L("items imported", "itens importados")); });
      };
    });
  }
  function mapType(v) {
    v = (v || "").toLowerCase();
    if (/epic|épico|epico|feature/.test(v)) return method().types.indexOf("epic") >= 0 ? "epic" : "phase";
    if (/phase|fase/.test(v)) return "phase";
    if (/bug|defect|defeito/.test(v)) return "bug";
    if (/story|história|historia|user story|requirement|product backlog item|pbi/.test(v)) return method().types.indexOf("story") >= 0 ? "story" : "task";
    if (/milestone|marco/.test(v)) return "milestone";
    return "task";
  }
  function mapStatus(v) {
    const ss = statuses(); v = (v || "").trim().toLowerCase();
    const exact = ss.find(function (s) { return s.name.toLowerCase() === v || s.id === v; }); if (exact) return exact.id;
    let c = "todo";
    if (/done|closed|resolved|conclu|fechad|feito|complete|finished|archive/.test(v)) c = "done";
    else if (/progress|doing|active|curso|andamento|review|revis|test|committed|development/.test(v)) c = "doing";
    return (ss.find(function (s) { return s.cat === c; }) || ss[0]).id;
  }
  function importRows(p) {
    const M = p.map, get = function (r, f) { return M[f] === undefined ? "" : (r[M[f]] || "").trim(); };
    const emails = {}; Object.keys(members).forEach(function (k) { const m = members[k]; emails[(m.name || "").toLowerCase()] = m.email; emails[m.email.toLowerCase()] = m.email; });
    const u = {}, byKey = {}, byTitle = {}, created = [];
    items().forEach(function (i) { if (i.ext && i.ext.key) byKey[i.ext.key] = i.id; if (isContainer(i)) byTitle[i.title.toLowerCase()] = i.id; });
    return db.ref("planning/" + ID + "/data/settings/seq").transaction(function (n) { return (n || 0) + p.rows.length; }).then(function (r) {
      let seq = r.snapshot.val() - p.rows.length;
      const pre = (data.settings && data.settings.prefix) || "PLN";
      p.rows.forEach(function (row, idx) {
        const title = get(row, "title"); if (!title) return;
        const ek = get(row, "key"), id = (ek && byKey[ek]) || db.ref().push().key;
        const type = mapType(get(row, "type")), a = get(row, "assignee").toLowerCase();
        const o = { title: title, type: type, status: mapStatus(get(row, "status")), order: Date.now() + idx, by: me.email, created: TS() };
        if (!(ek && byKey[ek])) { seq++; o.key = pre + "-" + seq; }
        const s = normDate(get(row, "start")), e = normDate(get(row, "end"));
        if (s) o.start = s; if (e) o.end = e; if (!s && e && type !== "milestone") o.start = e;
        if (type === "milestone" && (s || e)) o.start = o.end = e || s;
        if (emails[a]) o.assignee = emails[a];
        const pts = parseFloat(get(row, "points")); if (!isNaN(pts)) o.points = pts;
        const ds = get(row, "desc"); if (ds) o.desc = ds.slice(0, 4000);
        if (ek) o.ext = { source: "csv", key: ek };
        if (ek) byKey[ek] = id;
        if (isContainer(o)) byTitle[title.toLowerCase()] = id;
        created.push([id, o, get(row, "parent")]);
      });
      created.forEach(function (c) {
        const pv = (c[2] || "").toLowerCase(), pid = byKey[c[2]] || byTitle[pv];
        if (pid && pid !== c[0]) c[1].parent = pid;
        Object.keys(c[1]).forEach(function (k) { u["items/" + c[0] + "/" + k] = c[1][k]; });
      });
      return db.ref("planning/" + ID + "/data").update(u).then(function () { return created.length; });
    }).catch(function (e) { fail(e); return 0; });
  }
  function exportCsv() {
    const q = function (v) { v = v == null ? "" : String(v); return /[",;\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const head = ["Issue key", "Summary", "Issue Type", "Status", "Assignee", "Start date", "Due date", "Progress", "Story Points", "Parent", "Sprint", "Description", "Budget", "Actual"];
    const lines = [head.join(",")].concat(rows().map(function (r) {
      const i = r.it, p = i.parent && data.items[i.parent], sp = i.sprint && data.sprints && data.sprints[i.sprint];
      return [i.key, i.title, (TYPES[i.type] || TYPES.task).name, statusOf(i).name, i.assignee, i.start, i.end, i.progress, i.points, p ? p.key || p.title : "", sp ? sp.name : "", i.desc, i.budget, i.actual].map(q).join(",");
    }));
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = (info.title || "planning").replace(/[^\w-]+/g, "-") + ".csv"; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  /* ---------------- boot ---------------- */
  function gate(title, text) {
    app.innerHTML = '<div class="pl-gate"><span class="pl-logo">CM</span><h1>' + esc(title) + "</h1><p>" + esc(text) + '</p><a class="pl-btn primary" href="../workspaces/">' + L("Go to my boards", "Ir para meus quadros") + "</a></div>";
  }
  function start() {
    if (!ID) return gate(L("Planning not found", "Planejamento não encontrado"), L("The link is incomplete.", "O link está incompleto."));
    if (!A || !A.enabled) return gate(L("Sign-in required", "É preciso fazer login"), L("Planning needs the online workspace.", "O planejamento precisa do workspace online."));
    A.ready().then(function (user) {
      if (!user) return gate(L("Sign in to continue", "Faça login para continuar"), L("Open “My boards”, sign in with the invited e-mail and come back to this link.", "Abra “Meus quadros”, entre com o e-mail convidado e volte a este link."));
      me = user; db = A.db();
      return Promise.all([A.isAdmin(), db.ref("planning/" + ID + "/info").once("value")]).then(function (r) {
        isAdm = r[0]; info = r[1].val();
        if (!info) return gate(L("Planning not found", "Planejamento não encontrado"), L("It may have been deleted, or you don't have access.", "Pode ter sido excluído, ou não tem acesso."));
        return db.ref("workspaces/" + info.ws).once("value").then(function (s) {
          const w = s.val() || {}; wsInfo = w.info || {}; members = w.members || {}; wsInteg = w.integrations || {};
          const mk = A.key(user.email), m = members[mk];
          if (!members[mk] && (isAdm || wsInfo.owner === mk)) members[mk] = { email: user.email, name: user.displayName || user.email.split("@")[0], role: "editor" };
          canEdit = isAdm || wsInfo.owner === mk || !!(m && m.role === "editor" && (!m.expires || m.expires > Date.now()));
          document.title = info.title + " · " + (window.CMCOLLAB_BRAND || "CM Collaborator");
          if (window.CMMarkSeen) window.CMMarkSeen("planning");
          try { let r = JSON.parse(localStorage.getItem("cmcollab:recent")) || []; r = r.filter(function (x) { return x.id !== ID; }); r.unshift({ id: ID, title: info.title, t: Date.now(), kind: "planning", method: info.method }); localStorage.setItem("cmcollab:recent", JSON.stringify(r.slice(0, 12))); } catch (e) { /* ignore */ }
          db.ref("planning/" + ID + "/data").on("value", function (snap) {
            data = snap.val() || { settings: {}, items: {}, sprints: {} };
            if (!data.items) data.items = {}; if (!data.settings) data.settings = {};
            const linked = Object.keys(PROV).filter(function (k) { return data.settings[k]; }).join(",");
            if (!document.getElementById("view") || (canEdit && linked !== shell._linked)) { shell._linked = linked; shell(); } else renderView();
            const want = new URLSearchParams(location.search).get("item");
            if (want && !start._opened && data.items[want]) { start._opened = 1; setTimeout(function () { openDrawer(want); }, 60); }
          }, function (e) { gate(L("No access", "Sem acesso"), e.message); });
        }, function () { gate(L("No access", "Sem acesso"), L("Your access to this workspace may have ended.", "Seu acesso a este workspace pode ter terminado.")); });
      }, function () { gate(L("No access", "Sem acesso"), L("Your access to this workspace may have ended.", "Seu acesso a este workspace pode ter terminado.")); });
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { const m = document.querySelector(".pl-modal"); if (m) m.remove(); else closeDrawer(); } });
  }
  start();
})();
