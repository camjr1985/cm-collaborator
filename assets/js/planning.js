/* CM Collaborator – Planning module: roadmap / schedule (Gantt), board (Kanban), backlog & sprints (Scrum), list.
 * Data: planning/<id>/{info{title,ws,method,created,createdBy}, data{settings{statuses,prefix,seq}, items, sprints}}
 * Access is enforced by database.rules.json (same model as boards: admin, workspace owner, active members; editors write data). */
(function () {
  "use strict";
  const A = window.CMAuth;
  const PT = window.MB_LANG === "pt";
  const L = function (en, pt) { return PT ? pt : en; };
  const app = document.getElementById("app");
  const ID = (new URLSearchParams(location.search).get("id") || "").toLowerCase();
  const DAY = 86400000;
  const IC = function (n, sz, c) { return window.CMIcon ? window.CMIcon(n, sz || 15, c) : ""; };
  const TYPES = {
    initiative: { ic: "initiative", name: L("Initiative", "Iniciativa"), color: "#c2410c", level: 2, desc: L("Groups epics around a business outcome.", "Agrupa épicos em torno de um resultado de negócio.") },
    epic: { ic: "epic", name: L("Epic", "Épico"), color: "#7c5cff", level: 1, desc: L("A large body of work split into stories.", "Um grande bloco de trabalho dividido em histórias.") },
    phase: { ic: "phase", name: L("Phase", "Fase"), color: "#0e1a33", level: 1, desc: L("A stage of the schedule with its tasks.", "Uma etapa do cronograma com as suas tarefas.") },
    story: { ic: "story", name: L("Story", "História"), color: "#36b37e", level: 0, desc: L("A user need – “As a…, I want…, so that…”.", "Uma necessidade do usuário – “Como…, quero…, para…”.") },
    task: { ic: "task", name: L("Task", "Tarefa"), color: "#2f80ed", level: 0, desc: L("A piece of work to be done.", "Um trabalho a ser feito.") },
    bug: { ic: "bug", name: "Bug", color: "#e5484d", level: 0, desc: L("Something that is not working.", "Algo que não está funcionando.") },
    milestone: { ic: "milestone", name: L("Milestone", "Marco"), color: "#e8a400", level: 0, desc: L("A key date or delivery.", "Uma data ou entrega importante.") }
  };
  Object.keys(TYPES).forEach(function (k) { TYPES[k].icon = IC(TYPES[k].ic); });
  const CATC = { todo: "#8a94a6", doing: "#2f80ed", done: "#36b37e" };
  const VIEWN = { timeline: L("Timeline", "Linha do tempo"), board: L("Board", "Quadro"), backlog: "Backlog", list: L("List", "Lista"), okr: "OKRs" };

  let db, me, info, data = { settings: {}, items: {}, sprints: {} }, members = {}, wsInfo = {}, wsInteg = {}, canEdit = false, isAdm = false;
  const pushT = {};
  let view = null, scale = "month", collapsed = {}, filter = { q: "", who: "" }, dragging = false, pending = false, openItem = null;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function TS() { return window.firebase.database.ServerValue.TIMESTAMP; }
  function toast(msg) {
    let n = document.getElementById("toast");
    if (!n) { n = document.createElement("div"); n.id = "toast"; n.className = "pl-toast"; n.setAttribute("role", "status"); document.body.appendChild(n); }
    n.textContent = msg; n.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { n.classList.remove("show"); }, 2800);
  }
  function fail(e) { console.warn(e); toast((e && e.message) || L("Something went wrong", "Algo correu mal")); }
  function d2n(s) { return s ? Date.parse(s + "T00:00:00Z") : NaN; }
  function n2d(n) { return new Date(n).toISOString().slice(0, 10); }
  function today() { const d = new Date(); return n2d(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); }
  function fmt(s) { if (!s) return ""; const d = new Date(d2n(s)); return d.toLocaleDateString(PT ? "pt-PT" : "en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }); }
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
    u["items/" + id + "/updated"] = TS();
    return db.ref("planning/" + ID + "/data").update(u).then(function () { jiraPushLater(id, obj); }).catch(fail);
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
    modal('<h2>' + L("Send deadline reminders", "Enviar lembretes de prazo") + '</h2><p class="muted">' + L("An e-mail goes to each person with their items that are overdue or due in the next 3 days:", "Cada pessoa recebe um e-mail com os seus itens atrasados ou a vencer nos próximos 3 dias:") + "</p><ul class=\"pl-ul\">" +
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
    const views = m.views.concat(["okr"]);
    if (!view) { try { view = localStorage.getItem("cmcollab:plview:" + ID); } catch (e) { /* ignore */ } }
    if (views.indexOf(view) < 0) view = views[0];
    const who = {}; items().forEach(function (i) { if (i.assignee) who[i.assignee] = 1; }); Object.keys(members).forEach(function (k) { who[members[k].email] = 1; });
    app.innerHTML =
      '<header class="pl-top"><a class="pl-back" href="../workspaces/" title="' + L("My boards", "Meus quadros") + '">←</a><span class="pl-logo">CM</span>' +
      '<div class="pl-title"><span class="pl-ws">' + esc(wsInfo.name || info.ws) + " · " + IC(m.icon, 13) + " " + esc(m.name) + '</span><h1>' + esc(info.title) + "</h1></div>" +
      '<nav class="pl-tabs">' + views.map(function (v) { return '<button data-view="' + v + '" class="' + (v === view ? "on" : "") + '">' + esc((m.label && m.label[v]) || VIEWN[v]) + (v === "okr" && window.CMNewBadge ? window.CMNewBadge("okr") : "") + "</button>"; }).join("") + "</nav>" +
      '<div class="pl-actions">' + (canEdit ? '<button class="pl-btn primary" id="newBtn">' + IC("plus", 16) + " " + L("Create", "Criar") + " ▾</button>" : '<span class="pl-ro">' + L("View only", "Só leitura") + "</span>") +
      (canEdit ? '<button class="pl-btn icon" id="alertBtn" title="' + L("E-mail alerts", "Alertas por e-mail") + '">' + IC("bell", 17) + (data.settings && data.settings.notify && data.settings.notify.enabled ? '<span class="on-dot"></span>' : (window.CMIsNew && window.CMIsNew("alerts") ? '<span class="new-dot" data-new-id="alerts"></span>' : "")) + "</button>" : "") +
      '<button class="pl-btn icon" id="moreBtn" title="' + L("More", "Mais") + '">⋯' + (window.CMIsNew && window.CMIsNew("integrations") ? '<span class="new-dot" data-new-id="integrations"></span>' : "") + '</button></div></header>' +
      '<div class="pl-bar"><input id="q" type="search" placeholder="' + L("Search items", "Pesquisar itens") + '" value="' + esc(filter.q) + '">' +
      '<select id="who"><option value="">' + L("Everyone", "Todas as pessoas") + '</option><option value="_none"' + (filter.who === "_none" ? " selected" : "") + ">" + L("Unassigned", "Sem responsável") + "</option>" +
      Object.keys(who).sort().map(function (e) { return '<option value="' + esc(e) + '"' + (filter.who === e ? " selected" : "") + ">" + esc(memberName(e)) + "</option>"; }).join("") + "</select>" +
      (view === "timeline" ? '<div class="pl-seg" id="scale">' + [["week", L("Weeks", "Semanas")], ["month", L("Months", "Meses")], ["quarter", L("Quarters", "Trimestres")]].map(function (s) { return '<button data-s="' + s[0] + '" class="' + (scale === s[0] ? "on" : "") + '">' + s[1] + "</button>"; }).join("") + '</div><button class="pl-btn sm" id="todayBtn">' + L("Today", "Hoje") + "</button>" : "") +
      (canEdit ? Object.keys(PROV).filter(function (k) { return data.settings && data.settings[k]; }).map(function (k) { return '<button class="pl-btn sm" data-sync="' + k + '" title="' + L("Pull the latest from ", "Trazer as últimas alterações do ") + PROV[k].name + '">' + IC("sync", 14) + " " + PROV[k].short + "</button>"; }).join("") : "") +
      '<span class="pl-sum" id="sum"></span></div>' +
      hintBar() +
      '<main id="view" class="pl-view"></main>';
    app.querySelectorAll("[data-view]").forEach(function (b) { b.onclick = function () { view = b.dataset.view; try { localStorage.setItem("cmcollab:plview:" + ID, view); } catch (e) { /* ignore */ } shell(); }; });
    const q = document.getElementById("q"); q.oninput = function () { filter.q = q.value; renderView(); };
    document.getElementById("who").onchange = function (e) { filter.who = e.target.value; renderView(); };
    const sc = document.getElementById("scale"); if (sc) sc.onclick = function (e) { const b = e.target.closest("button"); if (b) { scale = b.dataset.s; shell(); } };
    const tb = document.getElementById("todayBtn"); if (tb) tb.onclick = function () { scrollToday(true); };
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
    document.getElementById("sum").innerHTML = tot + " " + L("items", "itens") + " · " + (tot ? Math.round(done / tot * 100) : 0) + "% " + L("done", "concluído") + (late ? ' · <b class="late">' + late + " " + L("overdue", "em atraso") + "</b>" : "");
    if (view === "okr" && window.CMMarkSeen) window.CMMarkSeen("okr");
    if (view === "timeline") timeline(v); else if (view === "board") board(v); else if (view === "backlog") backlog(v); else if (view === "okr") okrView(v); else list(v);
    if (openItem && !document.getElementById("drawer")) openDrawer(openItem);
  }

  /* ---------------- timeline / roadmap / Gantt ---------------- */
  const PX = { week: 30, month: 9, quarter: 3.2 };
  function rows() {
    const out = [];
    const all = items().filter(function (i) { return !i.parent || !data.items[i.parent]; }).sort(function (a, b) { return byOrder(a, b); });
    function walk(it, depth) {
      const kids = children(it.id);
      const show = matches(it) || kids.some(matches);
      if (!show) return;
      out.push({ it: it, depth: depth, kids: kids.length });
      if (kids.length && !collapsed[it.id]) kids.forEach(function (k) { walk(k, depth + 1); });
    }
    all.forEach(function (i) { walk(i, 0); });
    return out;
  }
  function span(it) {
    let s = d2n(it.start), e = d2n(it.end || it.start);
    if (isNaN(s) && isContainer(it)) {
      const ks = children(it.id).filter(function (k) { return k.start; });
      if (ks.length) { s = Math.min.apply(null, ks.map(function (k) { return d2n(k.start); })); e = Math.max.apply(null, ks.map(function (k) { return d2n(k.end || k.start); })); return { s: s, e: e, rolled: true }; }
    }
    if (isNaN(s)) return null;
    if (isNaN(e) || e < s) e = s;
    return { s: s, e: e };
  }
  function range() {
    let lo = d2n(today()) - 14 * DAY, hi = d2n(today()) + 120 * DAY;
    items().forEach(function (i) { const sp = span(i); if (sp) { lo = Math.min(lo, sp.s - 14 * DAY); hi = Math.max(hi, sp.e + 30 * DAY); } });
    const a = new Date(lo); lo = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1);
    if (scale === "week") { const wd = (new Date(lo).getUTCDay() + 6) % 7; lo -= wd * DAY; }
    const vw = ((document.getElementById("view") || {}).clientWidth || 1200) - 340;
    hi = Math.max(hi, lo + Math.ceil(vw / PX[scale]) * DAY);
    return { lo: lo, hi: hi, px: PX[scale] };
  }
  function timeline(v) {
    const R = range(), rs = rows(), W = Math.ceil((R.hi - R.lo) / DAY) * R.px, RH = 38;
    const x = function (n) { return (n - R.lo) / DAY * R.px; };
    let head1 = "", head2 = "", grid = "";
    for (let d = new Date(R.lo); d.getTime() < R.hi; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
      const st = d.getTime(), en = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      let label = d.toLocaleDateString(PT ? "pt-PT" : "en-GB", { month: scale === "quarter" ? "short" : "long", year: "numeric", timeZone: "UTC" }).replace(" de ", " ").replace(".", "");
      label = label.charAt(0).toUpperCase() + label.slice(1);
      if (scale !== "quarter" || d.getUTCMonth() % 3 === 0) {
        const qEnd = scale === "quarter" ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1) : en;
        head1 += '<div class="th1" style="left:' + x(st) + "px;width:" + (x(Math.min(qEnd, R.hi)) - x(st)) + 'px">' + (scale === "quarter" ? "Q" + (Math.floor(d.getUTCMonth() / 3) + 1) + " " + d.getUTCFullYear() : esc(label)) + "</div>";
      }
      if (scale === "quarter") head2 += '<div class="th2" style="left:' + x(st) + "px;width:" + (x(en) - x(st)) + 'px">' + esc(d.toLocaleDateString(PT ? "pt-PT" : "en-GB", { month: "short", timeZone: "UTC" }).replace(".", "")) + "</div>";
      grid += '<div class="gl m" style="left:' + x(st) + 'px"></div>';
    }
    if (scale === "week") for (let n = R.lo; n < R.hi; n += 7 * DAY) { head2 += '<div class="th2" style="left:' + x(n) + 'px;width:' + 7 * R.px + 'px">' + new Date(n).getUTCDate() + "</div>"; grid += '<div class="gl" style="left:' + x(n) + 'px"></div>'; }
    if (scale === "month") { const wd0 = (new Date(R.lo).getUTCDay() + 6) % 7; for (let n = R.lo + ((7 - wd0) % 7) * DAY; n < R.hi; n += 7 * DAY) { grid += '<div class="gl w" style="left:' + x(n) + 'px"></div>'; head2 += '<div class="th2" style="left:' + x(n) + "px;width:" + 7 * R.px + 'px">' + new Date(n).getUTCDate() + "</div>"; } }
    const tx = x(d2n(today()));
    let left = "", bars = "";
    rs.forEach(function (r, i) {
      const it = r.it, T = TYPES[it.type] || TYPES.task, s = statusOf(it), sp = span(it), top = i * RH;
      left += '<div class="tl-row' + (openItem === it.id ? " sel" : "") + '" style="height:' + RH + 'px" data-open="' + it.id + '"><span class="ind" style="width:' + r.depth * 18 + 'px"></span>' +
        (r.kids ? '<button class="tw" data-tw="' + it.id + '">' + (collapsed[it.id] ? "▸" : "▾") + "</button>" : '<span class="tw"></span>') +
        '<span class="ti" style="color:' + T.color + '" title="' + esc(T.name) + '">' + T.icon + '</span><span class="tk">' + esc(it.key || "") + '</span><span class="tt">' + (it.prio ? '<span class="star" title="' + L("Key activity", "Atividade principal") + '">★</span>' : "") + esc(it.title) + "</span>" +
        (it.assignee ? '<span class="av" title="' + esc(memberName(it.assignee)) + '">' + esc(initials(it.assignee)) + "</span>" : "") +
        (canEdit && isContainer(it) ? '<button class="addc" data-addc="' + it.id + '" title="' + L("Add child item", "Adicionar item filho") + '">' + IC("plus", 14) + "</button>" : "") + "</div>";
      if (sp) {
        const bx = x(sp.s), bw = Math.max(R.px, x(sp.e + DAY) - bx), col = isContainer(it) ? T.color : CATC[s.cat];
        const prog = s.cat === "done" ? 100 : Number(it.progress) || (s.cat === "doing" ? 0 : 0);
        if (it.type === "milestone") bars += '<div class="ms' + (cat(it) === "done" ? " done" : "") + (overdue(it) ? " late" : "") + '" data-bar="' + it.id + '" style="left:' + (x(sp.s) + R.px / 2 - 9) + "px;top:" + (top + 10) + 'px" title="' + esc(it.title + " · " + fmt(it.end || it.start)) + '"></div><div class="ms-l" style="left:' + (x(sp.s) + R.px / 2 + 14) + "px;top:" + (top + 10) + 'px">' + esc(it.title) + "</div>";
        else bars += '<div class="bar' + (sp.rolled ? " rolled" : "") + (isContainer(it) ? " cont" : "") + (overdue(it) ? " late" : "") + '" data-bar="' + it.id + '" style="left:' + bx + "px;width:" + bw + "px;top:" + (top + 8) + "px;--c:" + col + '" title="' + esc(it.title + " · " + fmt(it.start) + " → " + fmt(it.end)) + '">' +
          '<span class="pf" style="width:' + prog + '%"></span>' + (bw >= 110 ? '<span class="bl">' + esc(it.title) + "</span>" : "") + (canEdit && !sp.rolled ? '<span class="h l" data-h="l"></span><span class="h r" data-h="r"></span>' : "") + "</div>" +
          (bw < 110 ? '<div class="ms-l" style="left:' + (bx + bw + 6) + "px;top:" + (top + 10) + 'px">' + esc(it.title) + "</div>" : "");
      } else if (canEdit) bars += '<div class="nodate" style="top:' + (top + 9) + 'px" data-nodate="' + it.id + '">' + L("Click on the timeline to schedule", "Clique na linha do tempo para agendar") + "</div>";
    });
    /* dependencies (finish → start) */
    let deps = "";
    const idx = {}; rs.forEach(function (r, i) { idx[r.it.id] = i; });
    rs.forEach(function (r, i) {
      Object.keys(r.it.deps || {}).forEach(function (pid) {
        if (idx[pid] === undefined) return;
        const p = data.items[pid], sa = span(Object.assign({ id: pid }, p)), sb = span(r.it); if (!sa || !sb) return;
        const x1 = x(sa.e + DAY), y1 = idx[pid] * RH + RH / 2, x2 = x(sb.s), y2 = i * RH + RH / 2, mid = Math.max(x1 + 10, Math.min(x2 - 10, x1 + 10));
        const bad = r.it.type === "milestone" ? sb.s < sa.e : sb.s < sa.e + DAY;
        deps += '<path class="dep' + (bad ? " bad" : "") + '" d="M' + x1 + " " + y1 + " H" + mid + " V" + y2 + " H" + (x2 - 2) + '" marker-end="url(#arr' + (bad ? "b" : "") + ')"/>';
      });
    });
    const H = Math.max(rs.length * RH, 200);
    v.innerHTML = '<div class="tl"><div class="tl-left"><div class="tl-lh">' + L("Items", "Itens") + (canEdit ? '<span class="tl-add">' + (method().types.indexOf("initiative") >= 0 ? '<button class="pl-btn sm" data-addtop="initiative" title="' + esc(TYPES.initiative.desc) + '">' + TYPES.initiative.icon + " " + esc(TYPES.initiative.name) + "</button>" : "") + '<button class="pl-btn sm" data-addtop="' + (method().types.indexOf("epic") >= 0 ? "epic" : "phase") + '">' + (method().types.indexOf("epic") >= 0 ? TYPES.epic.icon + " " + esc(TYPES.epic.name) : TYPES.phase.icon + " " + esc(TYPES.phase.name)) + "</button></span>" : "") + '</div><div class="tl-lb" id="tlLeft">' + left +
      (rs.length ? "" : '<div class="pl-empty">' + L("Nothing here yet.", "Ainda não há nada aqui.") + "</div>") + "</div></div>" +
      '<div class="tl-right" id="tlRight"><div class="tl-head" style="width:' + W + 'px"><div class="h1">' + head1 + '</div><div class="h2">' + head2 + "</div></div>" +
      '<div class="tl-body" id="tlBody" style="width:' + W + "px;height:" + H + 'px">' + grid +
      rs.map(function (r, i) { return '<div class="tl-band' + (i % 2 ? " odd" : "") + '" data-band="' + r.it.id + '" style="top:' + i * RH + "px;height:" + RH + 'px"></div>'; }).join("") +
      '<svg class="deps" width="' + W + '" height="' + H + '"><defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8z" fill="#8a94a6"/></marker><marker id="arrb" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8z" fill="#e5484d"/></marker></defs>' + deps + "</svg>" +
      bars + '<div class="today" style="left:' + tx + 'px"><span>' + L("Today", "Hoje") + "</span></div></div></div></div>";
    const left$ = document.getElementById("tlLeft"), right$ = document.getElementById("tlRight");
    right$.onscroll = function () { left$.scrollTop = right$.scrollTop; };
    left$.onwheel = function (e) { right$.scrollTop += e.deltaY; e.preventDefault(); };
    v.querySelectorAll("[data-tw]").forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); collapsed[b.dataset.tw] = !collapsed[b.dataset.tw]; renderView(); }; });
    v.querySelectorAll("[data-addc]").forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); const p = data.items[b.dataset.addc]; collapsed[b.dataset.addc] = false; const ct = childType(p); createItem({ type: ct, parent: b.dataset.addc, title: TYPES[ct].name }).then(function (id) { if (id) openDrawer(id, true); }); }; });
    v.querySelectorAll(".tl-row").forEach(function (r) { r.onclick = function () { openDrawer(r.dataset.open); }; });
    v.querySelectorAll("[data-addtop]").forEach(function (b) { b.onclick = function () { quickCreate(b.dataset.addtop); }; });
    if (canEdit) bindBars(v, R, RH);
    v.querySelectorAll("[data-bar]").forEach(function (b) { b.addEventListener("dblclick", function () { openDrawer(b.dataset.bar); }); });
    if (!timeline._scrolled) { timeline._scrolled = 1; scrollToday(false); }
  }
  function scrollToday(smooth) {
    const r = document.getElementById("tlRight"), t = document.querySelector(".today"); if (!r || !t) return;
    r.scrollTo({ left: Math.max(0, t.offsetLeft - r.clientWidth * 0.3), behavior: smooth ? "smooth" : "auto" });
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
  function tip(ev, txt) {
    let t = document.getElementById("pltip");
    if (!ev) { if (t) t.remove(); return; }
    if (!t) { t = document.createElement("div"); t.id = "pltip"; t.className = "pl-tip"; document.body.appendChild(t); }
    t.textContent = txt; t.style.left = ev.clientX + 12 + "px"; t.style.top = ev.clientY - 30 + "px";
  }

  /* ---------------- board (Kanban / sprint board) ---------------- */
  function activeSprint() { const ss = data.sprints || {}; return Object.keys(ss).find(function (k) { return ss[k].state === "active"; }); }
  function board(v) {
    const ss = statuses(), scrum = info.method === "scrum";
    const sp = activeSprint();
    let pool = items().filter(function (i) { return !isContainer(i) && i.type !== "milestone" && matches(i); });
    let headNote = "";
    if (scrum) {
      if (!sp) { v.innerHTML = '<div class="pl-empty big"><h2>' + L("No active sprint", "Nenhuma sprint ativa") + "</h2><p>" + L("Start a sprint in the Backlog to see its board.", "Inicie uma sprint no Backlog para ver o quadro dela.") + '</p><button class="pl-btn primary" id="goBl">' + L("Go to Backlog", "Ir para o Backlog") + "</button></div>"; document.getElementById("goBl").onclick = function () { view = "backlog"; shell(); }; return; }
      const S = data.sprints[sp];
      pool = pool.filter(function (i) { return i.sprint === sp; });
      headNote = '<div class="sp-head"><b>' + esc(S.name) + "</b> · " + fmt(S.start) + " → " + fmt(S.end) + (S.goal ? " · " + esc(S.goal) : "") + (canEdit ? ' <button class="pl-btn sm" id="endSp">' + L("Complete sprint", "Concluir sprint") + "</button>" : "") + "</div>";
    }
    v.innerHTML = headNote + '<div class="kb">' + ss.map(function (s, si) {
      const col = pool.filter(function (i) { return (statusOf(i).id) === s.id; }).sort(byOrder);
      const over = s.wip && col.length > s.wip;
      return '<section class="kb-col' + (over ? " over" : "") + '" data-col="' + s.id + '"><header><span class="dot" style="background:' + CATC[s.cat] + '"></span><b>' + esc(s.name) + '</b><span class="cnt">' + col.length + (s.wip ? " / " + s.wip : "") + "</span></header>" +
        '<div class="kb-list">' + col.map(card).join("") + "</div>" + (canEdit && si === 0 ? '<button class="kb-add" data-add="' + s.id + '">+ ' + L("Create", "Criar") + "</button>" : "") + "</section>";
    }).join("") + "</div>";
    v.querySelectorAll(".kb-card").forEach(function (c) { c.onclick = function () { openDrawer(c.dataset.id); }; });
    v.querySelectorAll("[data-add]").forEach(function (b) { b.onclick = function () { inlineAdd(b, { status: b.dataset.add, sprint: scrum ? sp : undefined }); }; });
    const es = document.getElementById("endSp"); if (es) es.onclick = function () { completeSprint(sp); };
    if (canEdit) dnd(v, ".kb-card", ".kb-col", function (id, col, beforeId) {
      const list = items().filter(function (i) { return statusOf(i).id === col.dataset.col && i.id !== id; }).sort(byOrder);
      const o = { status: col.dataset.col, order: orderAt(list, beforeId) };
      const st = statuses().find(function (s) { return s.id === col.dataset.col; });
      if (st && st.cat === "done") o.progress = 100;
      patch(id, o);
    });
  }
  function orderAt(list, beforeId) {
    const i = beforeId ? list.findIndex(function (x) { return x.id === beforeId; }) : -1;
    if (i < 0) return (list.length ? (list[list.length - 1].order || 0) : 0) + 1000;
    const prev = i > 0 ? (list[i - 1].order || 0) : (list[i].order || 0) - 2000;
    return (prev + (list[i].order || 0)) / 2;
  }
  function card(it) {
    const T = TYPES[it.type] || TYPES.task, par = it.parent && data.items[it.parent];
    return '<article class="kb-card' + (overdue(it) ? " late" : "") + '" draggable="' + canEdit + '" data-id="' + it.id + '"><div class="kt">' + esc(it.title) + "</div>" +
      (par ? '<span class="ep" style="--c:' + (TYPES[par.type] || TYPES.epic).color + '">' + esc(par.title) + "</span>" : "") +
      '<div class="km"><span class="ti" style="color:' + T.color + '">' + T.icon + '</span><span class="tk">' + esc(it.key || "") + "</span>" + (it.points ? '<span class="pts">' + esc(it.points) + "</span>" : "") +
      (it.end ? '<span class="due">' + fmt(it.end) + "</span>" : "") + '<span class="sp"></span>' + (it.assignee ? '<span class="av" title="' + esc(memberName(it.assignee)) + '">' + esc(initials(it.assignee)) + "</span>" : "") + "</div></article>";
  }
  function dnd(root, itemSel, zoneSel, onDrop) {
    let dragId = null;
    root.querySelectorAll(itemSel).forEach(function (c) {
      c.addEventListener("dragstart", function (e) { dragId = c.dataset.id; dragging = true; c.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", dragId); } catch (x) { /* ignore */ } });
      c.addEventListener("dragend", function () { c.classList.remove("dragging"); dragging = false; root.querySelectorAll(".drop").forEach(function (z) { z.classList.remove("drop"); }); if (pending) { pending = false; renderView(); } });
    });
    root.querySelectorAll(zoneSel).forEach(function (z) {
      z.addEventListener("dragover", function (e) { e.preventDefault(); z.classList.add("drop"); });
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
    v.innerHTML = '<div class="ls-wrap"><table class="ls"><thead><tr><th>' + L("Key", "Chave") + "</th><th>" + L("Title", "Título") + "</th><th>" + L("Type", "Tipo") + "</th><th>" + L("Status", "Estado") + "</th><th>" + L("Assignee", "Responsável") + "</th><th>" + L("Start", "Início") + "</th><th>" + L("End", "Fim") + "</th><th>%</th><th>" + L("Points", "Pontos") + "</th></tr></thead><tbody>" +
      rs.map(function (r) {
        const it = r.it, T = TYPES[it.type] || TYPES.task;
        return '<tr data-id="' + it.id + '"' + (overdue(it) ? ' class="late"' : "") + '><td class="tk">' + esc(it.key || "") + '</td><td><span style="padding-left:' + r.depth * 16 + 'px"></span><span class="ti" style="color:' + T.color + '">' + T.icon + '</span> <a href="#" data-open="' + it.id + '">' + esc(it.title) + "</a></td>" +
          '<td>' + esc(T.name) + '</td><td><select data-f="status"' + dis + ">" + opt(statuses().map(function (s) { return [s.id, s.name]; }), statusOf(it).id) + '</select></td><td><select data-f="assignee"' + dis + ">" + opt(ppl, it.assignee) + "</select></td>" +
          '<td><input type="date" data-f="start" value="' + esc(it.start || "") + '"' + dis + '></td><td><input type="date" data-f="end" value="' + esc(it.end || "") + '"' + dis + "></td>" +
          '<td><input type="number" min="0" max="100" step="5" data-f="progress" value="' + esc(it.progress == null ? "" : it.progress) + '"' + dis + '></td><td><input type="number" min="0" step="1" data-f="points" value="' + esc(it.points == null ? "" : it.points) + '"' + dis + "></td></tr>";
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
  function openDrawer(id, focusTitle) {
    const it0 = data.items[id]; if (!it0) { openItem = null; closeDrawer(); return; }
    openItem = id;
    const it = Object.assign({ id: id }, it0), T = TYPES[it.type] || TYPES.task, dis = canEdit ? "" : " disabled";
    const parents = parentChoices(it0.type, id);
    const others = items().filter(function (i) { return i.id !== id && !isContainer(i); }).sort(byOrder);
    const ppl = Object.keys(members).map(function (k) { return members[k]; });
    const sps = Object.keys(data.sprints || {}).filter(function (k) { return data.sprints[k].state !== "closed"; });
    let d = document.getElementById("drawer");
    if (!d) { d = document.createElement("aside"); d.id = "drawer"; d.className = "pl-drawer"; document.body.appendChild(d); }
    d.innerHTML = '<header><span class="ti" style="color:' + T.color + '">' + T.icon + '</span><span class="tk">' + esc(it.key || "") + '</span><span class="sp"></span>' + (canEdit ? '<button class="pl-btn sm ghost danger" id="dDel">' + L("Delete", "Excluir") + "</button>" : "") + '<button class="pl-btn icon" id="dX">' + IC("close", 16) + "</button></header>" +
      '<form class="pl-form" id="dF"><textarea name="title" class="d-title" rows="2"' + dis + ">" + esc(it.title) + "</textarea>" +
      '<div class="g2"><label>' + L("Type", "Tipo") + '<select name="type"' + dis + ">" + Object.keys(TYPES).filter(function (t) { return method().types.indexOf(t) >= 0 || t === it.type; }).map(function (t) { return '<option value="' + t + '"' + (t === it.type ? " selected" : "") + ">" + TYPES[t].name + "</option>"; }).join("") + "</select></label>" +
      "<label>" + L("Status", "Estado") + '<select name="status"' + dis + ">" + statuses().map(function (s) { return '<option value="' + s.id + '"' + (statusOf(it).id === s.id ? " selected" : "") + ">" + esc(s.name) + "</option>"; }).join("") + "</select></label></div>" +
      "<label>" + L("Assignee", "Responsável") + '<select name="assignee"' + dis + '><option value="">' + L("Unassigned", "Sem responsável") + "</option>" + ppl.map(function (m) { return '<option value="' + esc(m.email) + '"' + (m.email === it.assignee ? " selected" : "") + ">" + esc(m.name || m.email) + " · " + esc(m.email) + "</option>"; }).join("") + "</select></label>" +
      '<div class="g2"><label>' + L("Start", "Início") + '<input type="date" name="start" value="' + esc(it.start || "") + '"' + dis + "></label><label>" + L("Due / end", "Prazo / fim") + '<input type="date" name="end" value="' + esc(it.end || "") + '"' + dis + "></label></div>" +
      '<div class="g2"><label>' + L("Progress %", "Progresso %") + '<input type="number" min="0" max="100" step="5" name="progress" value="' + esc(it.progress == null ? "" : it.progress) + '"' + dis + "></label><label>" + L("Story points", "Story points") + '<input type="number" min="0" step="1" name="points" value="' + esc(it.points == null ? "" : it.points) + '"' + dis + "></label></div>" +
      (it.type === "initiative" ? "" : "<label>" + (lvl(it.type) === 1 ? L("Initiative", "Iniciativa") : L("Parent (initiative / epic / phase)", "Pai (iniciativa / épico / fase)")) + '<select name="parent"' + dis + '><option value="">—</option>' + parents.map(function (p) { return '<option value="' + p.id + '"' + (p.id === it.parent ? " selected" : "") + ">" + esc((p.key ? p.key + " · " : "") + p.title) + "</option>"; }).join("") + "</select></label>") +
      (sps.length && !isContainer(it) ? "<label>Sprint<select name=\"sprint\"" + dis + '><option value="">Backlog</option>' + sps.map(function (k) { return '<option value="' + k + '"' + (k === it.sprint ? " selected" : "") + ">" + esc(data.sprints[k].name) + "</option>"; }).join("") + "</select></label>" : "") +
      "<label>" + L("Depends on (finish → start)", "Depende de (fim → início)") + '<select name="deps" multiple size="4"' + dis + ">" + others.map(function (o) { return '<option value="' + o.id + '"' + ((it.deps || {})[o.id] ? " selected" : "") + ">" + esc((o.key ? o.key + " · " : "") + o.title) + "</option>"; }).join("") + "</select></label>" +
      '<label class="chk prio"><input type="checkbox" name="prio"' + (it.prio ? " checked" : "") + dis + "> ★ " + L("Key activity – include in the e-mail alerts", "Atividade principal – incluir nos alertas por e-mail") + "</label>" +
      (allKrs().length ? "<label>" + L("Contributes to (OKR)", "Contribui para (OKR)") + '<select name="krs" multiple size="' + Math.min(5, allKrs().length) + '"' + dis + ">" + allKrs().map(function (k) { return '<option value="' + k.ref + '"' + ((it.krs || {})[k.ref] ? " selected" : "") + ">" + esc(k.label) + "</option>"; }).join("") + "</select></label>" : "") +
      "<label>" + L("Description", "Descrição") + '<textarea name="desc" rows="5"' + dis + ">" + esc(it.desc || "") + "</textarea></label>" +
      (canEdit && !it.ext ? Object.keys(PROV).filter(function (k) { return data.settings && data.settings[k]; }).map(function (k) { return '<button type="button" class="pl-btn sm" data-mk="' + k + '">' + IC("send", 14) + " " + L("Create in ", "Criar no ") + PROV[k].short + "</button>"; }).join(" ") : "") +
      '<p class="muted small">' + (it.by ? L("Created by ", "Criado por ") + esc(memberName(it.by)) : "") + (it.ext ? " · " + (it.ext.url ? '<a href="' + esc(it.ext.url) + '" target="_blank" rel="noopener">' + esc((PROV[it.ext.source] ? PROV[it.ext.source].short : it.ext.source) + " ") + esc(it.ext.key || "") + " ↗</a>" : esc(it.ext.source) + " " + esc(it.ext.key || "")) : "") + (it.ext && it.ext.assigneeName && !it.assignee ? " · " + L("Assignee in ", "Responsável no ") + (PROV[it.ext.source] ? PROV[it.ext.source].short : "") + ": " + esc(it.ext.assigneeName) : "") + "</p></form>";
    document.getElementById("dX").onclick = closeDrawer;
    document.querySelectorAll(".tl-row.sel").forEach(function (r) { r.classList.remove("sel"); });
    const row = document.querySelector('.tl-row[data-open="' + id + '"]'); if (row) row.classList.add("sel");
    if (!canEdit) return;
    const f = document.getElementById("dF");
    f.querySelectorAll("input,select,textarea").forEach(function (inp) {
      inp.onchange = function () {
        const n = inp.name, o = {};
        if (n === "deps" || n === "krs") { const dd = {}; Array.prototype.forEach.call(inp.selectedOptions, function (op) { dd[op.value] = true; }); o[n] = Object.keys(dd).length ? dd : null; }
        else if (inp.type === "checkbox") o[n] = inp.checked || null;
        else if (inp.type === "number") o[n] = inp.value === "" ? null : Number(inp.value);
        else o[n] = n === "title" ? (inp.value.trim() || it.title) : (inp.value || null);
        if (n === "status") { const st = statuses().find(function (s) { return s.id === inp.value; }); if (st && st.cat === "done") o.progress = 100; }
        if (n === "type" && inp.value === "milestone") o.end = f.start.value || f.end.value || null;
        const prevA = (data.items[id] || {}).assignee;
        patch(id, o).then(function () { if (n === "assignee" && inp.value && inp.value !== me.email && inp.value !== prevA) notify("assign", { item: id }).then(function (j) { if (j && j.ok && (j.sent || []).length) toast(L("Assignee notified by e-mail", "Responsável avisado por e-mail")); }); });
      };
    });
    f.title.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); f.title.blur(); } };
    f.querySelectorAll("[data-mk]").forEach(function (b) { b.onclick = function () { b.disabled = true; createInTool(b.dataset.mk, id).then(function () { b.disabled = false; }); }; });
    if (focusTitle) { f.title.focus(); f.title.select(); }
    document.getElementById("dDel").onclick = function () {
      const kids = children(id);
      modal("<h2>" + L("Delete ", "Excluir ") + esc(it.key || it.title) + "?</h2><p>" + (kids.length ? kids.length + " " + L("child items will be moved to the top level.", "itens filhos passam para o nível de topo.") : L("This cannot be undone.", "Não é possível desfazer.")) + '</p><div class="pl-row-end"><button class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary danger" id="delGo">' + L("Delete", "Excluir") + "</button></div>", function (box, close) {
        box.querySelector("#delGo").onclick = function () {
          const u = {}; u["items/" + id] = null;
          kids.forEach(function (k) { u["items/" + k.id + "/parent"] = null; });
          items().forEach(function (i) { if ((i.deps || {})[id]) u["items/" + i.id + "/deps/" + id] = null; });
          db.ref("planning/" + ID + "/data").update(u).then(function () { close(); closeDrawer(); }, fail);
        };
      });
    };
  }
  function closeDrawer() { openItem = null; const d = document.getElementById("drawer"); if (d) d.remove(); document.querySelectorAll(".tl-row.sel").forEach(function (r) { r.classList.remove("sel"); }); }

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
      '<div class="cr-sep"></div><button data-ct="_okr"><span class="ti" style="color:#0f766e">' + IC("objective") + "</span><span><b>" + L("Objective (OKR)", "Objetivo (OKR)") + "</b><small>" + L("A goal with measurable key results.", "Uma meta com resultados-chave mensuráveis.") + "</small></span></button>";
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect(); m.style.top = r.bottom + 6 + "px"; m.style.left = Math.max(8, Math.min(window.innerWidth - 300, r.right - 290)) + "px";
    m.onclick = function (e) { const b = e.target.closest("[data-ct]"); if (!b) return; m.remove(); if (b.dataset.ct === "_okr") objDialog(); else quickCreate(b.dataset.ct); };
    setTimeout(function () { document.addEventListener("click", function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener("click", off); } }); }, 0);
  }
  function quickCreate(preType) {
    const types = method().types;
    let type = preType && types.indexOf(preType) >= 0 ? preType : (types.indexOf("story") >= 0 ? "story" : "task");
    modal("<h2>" + L("Create item", "Criar item") + '</h2><form class="pl-form" id="qcF"><div class="type-chips">' + types.map(function (t) { const T = TYPES[t]; return '<button type="button" data-tc="' + t + '" class="' + (t === type ? "on" : "") + '" style="--c:' + T.color + '">' + T.icon + " " + esc(T.name) + "</button>"; }).join("") + '</div><p class="muted small" id="tcDesc"></p>' +
      '<label id="parL">' + L("Parent", "Pai") + '<select name="parent"></select></label>' +
      "<label>" + L("Title", "Título") + '<input name="title" required autocomplete="off"></label>' +
      "<label>" + L("Assignee", "Responsável") + '<select name="assignee"><option value="">' + L("Unassigned", "Sem responsável") + "</option>" + Object.keys(members).map(function (k) { return '<option value="' + esc(members[k].email) + '">' + esc(members[k].name || members[k].email) + "</option>"; }).join("") + "</select></label>" +
      '<div class="g2"><label>' + L("Start", "Início") + '<input type="date" name="start"></label><label>' + L("Due / end", "Prazo / fim") + '<input type="date" name="end"></label></div>' +
      '<div class="pl-row-end"><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + L("Create", "Criar") + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#qcF");
      function sync() {
        box.querySelectorAll("[data-tc]").forEach(function (b) { b.classList.toggle("on", b.dataset.tc === type); });
        box.querySelector("#tcDesc").textContent = TYPES[type].desc;
        const ps = parentChoices(type);
        box.querySelector("#parL").hidden = type === "initiative" || !ps.length;
        f.parent.innerHTML = '<option value="">—</option>' + ps.map(function (p) { return '<option value="' + p.id + '">' + esc(TYPES[p.type].name + " · " + (p.key ? p.key + " " : "") + p.title) + "</option>"; }).join("");
      }
      box.querySelectorAll("[data-tc]").forEach(function (b) { b.onclick = function () { type = b.dataset.tc; sync(); }; });
      sync();
      setTimeout(function () { f.querySelector("[name=title]").focus(); }, 40);
      f.onsubmit = function (e) {
        e.preventDefault();
        const o = { type: type, title: f.title.value.trim(), parent: f.parent.value || undefined, assignee: f.assignee.value || undefined, start: f.start.value || undefined, end: f.end.value || f.start.value || undefined };
        if (o.type === "milestone") o.end = o.start = o.end || o.start;
        if (info.method === "scrum" && !isContainer(o) && activeSprint() && view === "board") o.sprint = activeSprint();
        createItem(o).then(function (nid) { close(); if (nid && o.parent) collapsed[o.parent] = false; });
      };
    });
  }
  function moreMenu() {
    const owner = isAdm || (wsInfo.owner && wsInfo.owner === A.key(me.email));
    modal("<h2>" + L("Planning options", "Opções do planejamento") + '</h2><div class="pl-menu">' +
      (canEdit ? '<button data-act="workflow">' + IC("settings") + " " + L("Workflow and columns", "Fluxo e colunas") + "</button>" : "") +
      (canEdit ? '<button data-act="alerts">' + IC("bell") + " " + L("E-mail alerts (milestones, key activities, delays)", "Alertas por e-mail (marcos, atividades principais, atrasos)") + "</button>" : "") +
      (canEdit ? '<button data-act="remind">' + IC("send") + " " + L("Send deadline reminders now", "Enviar lembretes de prazo agora") + "</button>" : "") +
      (canEdit ? '<button data-act="import">' + IC("import") + " " + L("Import CSV (Jira, Azure DevOps, Kanbanize, Excel)", "Importar CSV (Jira, Azure DevOps, Kanbanize, Excel)") + "</button>" : "") +
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
          ({ workflow: workflowDialog, remind: sendReminders, import: importDialog, export: exportCsv, print: function () { window.print(); }, integrations: integrationsDialog, rename: renameDialog, delete: deletePlanning, alerts: alertsDialog, bulk: function () { bulkCreate(b.dataset.p); } })[b.dataset.act]();
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
  function workflowDialog() {
    let ss = JSON.parse(JSON.stringify(statuses()));
    function rowsH() {
      return ss.map(function (s, i) {
        return '<div class="wf-row" data-i="' + i + '"><input data-k="name" value="' + esc(s.name) + '"><select data-k="cat">' + [["todo", L("To do", "Por fazer")], ["doing", L("In progress", "Em andamento")], ["done", L("Done", "Concluído")]].map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === s.cat ? " selected" : "") + ">" + c[1] + "</option>"; }).join("") + "</select>" +
          '<input data-k="wip" type="number" min="0" placeholder="WIP" value="' + esc(s.wip || "") + '"><button type="button" data-up="' + i + '">↑</button><button type="button" data-rm="' + i + '">✕</button></div>';
      }).join("");
    }
    modal("<h2>" + L("Workflow and columns", "Fluxo e colunas") + '</h2><p class="muted small">' + L("Each status is a board column. The category tells reports what counts as done. WIP limits the number of cards in a column.", "Cada estado é uma coluna do quadro. A categoria diz aos relatórios o que conta como concluído. O WIP limita os cartões numa coluna.") + '</p><div id="wfRows"></div><button type="button" class="pl-btn sm" id="wfAdd">+ ' + L("Add status", "Adicionar estado") + '</button><div class="pl-row-end"><button class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary" id="wfSave">' + L("Save", "Salvar") + "</button></div>", function (box, close) {
      const R = box.querySelector("#wfRows");
      function draw() {
        R.innerHTML = rowsH();
        R.querySelectorAll("[data-k]").forEach(function (inp) { inp.onchange = function () { const i = Number(inp.closest(".wf-row").dataset.i); ss[i][inp.dataset.k] = inp.dataset.k === "wip" ? (Number(inp.value) || null) : inp.value; }; });
        R.querySelectorAll("[data-up]").forEach(function (b) { b.onclick = function () { const i = Number(b.dataset.up); if (i > 0) { const t = ss[i - 1]; ss[i - 1] = ss[i]; ss[i] = t; draw(); } }; });
        R.querySelectorAll("[data-rm]").forEach(function (b) { b.onclick = function () { if (ss.length > 2) { ss.splice(Number(b.dataset.rm), 1); draw(); } }; });
      }
      draw();
      box.querySelector("#wfAdd").onclick = function () { ss.splice(ss.length - 1, 0, { id: "s" + Date.now().toString(36), name: L("New status", "Novo estado"), cat: "doing" }); draw(); };
      box.querySelector("#wfSave").onclick = function () {
        ss = ss.map(function (s) { const o = { id: s.id, name: (s.name || "").trim() || s.id, cat: s.cat }; if (s.wip) o.wip = s.wip; return o; });
        const ids = {}; ss.forEach(function (s) { ids[s.id] = 1; });
        const u = { "settings/statuses": ss };
        items().forEach(function (i) { if (!ids[i.status]) u["items/" + i.id + "/status"] = ss[0].id; });
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
        (S ? '<p class="muted small">' + L("This planning syncs with ", "Este planning sincroniza com ") + "<b>" + esc(S.projectName || S.project || "") + "</b>" + (S.query ? " · <code>" + esc(S.query) + "</code>" : "") + (S.lastSync ? " · " + L("last sync ", "última sincronização ") + new Date(S.lastSync).toLocaleString(PT ? "pt-BR" : "en-GB") : "") + "</p>" : "") +
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
  function krProgress(o, kr) {
    if (kr.auto) { const li = linkedItems(o.id, kr.id).filter(function (i) { return i.type !== "milestone"; }); return li.length ? Math.round(li.filter(function (i) { return cat(i) === "done"; }).length / li.length * 100) : 0; }
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
      (os.length ? os.map(objCard).join("") : '<div class="pl-empty big">' + IC("objective", 40, "big") + "<h2>" + L("No objectives yet", "Ainda não há objetivos") + "</h2><p>" + L("Example: “Delight our customers” – KR: NPS from 30 to 50.", "Exemplo: “Encantar nossos clientes” – KR: NPS de 30 para 50.") + "</p></div>") + "</div>";
    const nb = document.getElementById("okrNew"); if (nb) nb.onclick = function () { objDialog(); };
    v.querySelectorAll("[data-obj]").forEach(function (b) { b.onclick = function () { objDialog(b.dataset.obj); }; });
    v.querySelectorAll("[data-addkr]").forEach(function (b) { b.onclick = function () { krDialog(b.dataset.addkr); }; });
    v.querySelectorAll("[data-kr]").forEach(function (b) { b.onclick = function (e) { if (e.target.closest("[data-open]")) return; const p = b.dataset.kr.split("|"); krDialog(p[0], p[1]); }; });
    v.querySelectorAll("[data-open]").forEach(function (a) { a.onclick = function (e) { e.preventDefault(); openDrawer(a.dataset.open); }; });
  }
  function objCard(o) {
    const pr = objProgress(o), ks = krList(o);
    return '<section class="okr-card"><header>' + '<span class="ti" style="color:#0f766e">' + IC("objective", 18) + '</span><div class="okr-t"><b>' + esc(o.title) + "</b><span class=\"muted small\">" + esc(o.period || "") + (o.owner ? " · " + esc(memberName(o.owner)) : "") + "</span></div>" +
      '<div class="okr-pr"><span class="pbar"><i style="width:' + pr + "%;background:" + pcol(pr) + '"></i></span><b>' + pr + "%</b></div>" + (canEdit ? '<button class="pl-btn sm ghost" data-obj="' + o.id + '">' + IC("pencil", 14) + "</button>" : "") + "</header>" +
      ks.map(function (k) {
        const p = krProgress(o, k), li = linkedItems(o.id, k.id);
        return '<div class="kr-row" data-kr="' + o.id + "|" + k.id + '"><span class="ti" style="color:#0f766e">' + IC("kr", 16) + '</span><div class="kr-t"><span>' + esc(k.title) + '</span><span class="muted small">' +
          (k.auto ? L("measured by linked items: ", "medido pelos itens ligados: ") + li.filter(function (i) { return cat(i) === "done"; }).length + "/" + li.length + L(" done", " concluídos") : esc(String(k.current == null ? (k.start || 0) : k.current)) + " / " + esc(String(k.target)) + " " + esc(k.unit || "") + L(" (from ", " (de ") + esc(String(k.start || 0)) + ")") + "</span>" +
          (li.length ? '<span class="kr-items">' + li.slice(0, 6).map(function (i) { const T = TYPES[i.type] || TYPES.task; return '<a href="#" data-open="' + i.id + '" style="--c:' + T.color + '">' + T.icon + " " + esc(i.key || "") + "</a>"; }).join("") + (li.length > 6 ? "<span>+" + (li.length - 6) + "</span>" : "") + "</span>" : "") + "</div>" +
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
      '<fieldset><legend>' + L("Who receives", "Quem recebe") + '</legend><label class="chk"><input type="checkbox" name="toA"' + (N.to.assignee !== false ? " checked" : "") + "> " + L("The person responsible for each item", "O responsável de cada item") + '</label><label class="chk"><input type="checkbox" name="toO"' + (N.to.owner ? " checked" : "") + "> " + L("The planning owner", "O dono do planejamento") + "</label>" +
      '<label>' + L("Also notify (e.g. PMO, sponsor)", "Avisar também (ex.: PMO, sponsor)") + '<select name="watchers" multiple size="' + Math.min(5, Math.max(2, ppl.length)) + '">' + ppl.map(function (m) { return '<option value="' + esc(m.email) + '"' + ((N.to.watchers || []).indexOf(m.email) >= 0 ? " selected" : "") + ">" + esc((m.name || m.email) + " · " + m.email) + "</option>"; }).join("") + "</select></label></fieldset>" +
      '<p class="muted small" id="alStatus"></p>' +
      '<div class="pl-row-end"><button type="button" class="pl-btn" id="alTest">' + IC("send", 14) + " " + L("Send now (test)", "Enviar agora (teste)") + '</button><span class="sp"></span><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + L("Save", "Salvar") + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#alF");
      function read() {
        return { enabled: f.enabled.checked, before: [14, 7, 5, 3, 2, 1].filter(function (d) { return f["b" + d].checked; }), scope: { milestones: f.ms.checked, key: f.key.checked, all: f.all.checked }, overdue: f.overdue.value,
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
    const head = ["Issue key", "Summary", "Issue Type", "Status", "Assignee", "Start date", "Due date", "Progress", "Story Points", "Parent", "Sprint", "Description"];
    const lines = [head.join(",")].concat(rows().map(function (r) {
      const i = r.it, p = i.parent && data.items[i.parent], sp = i.sprint && data.sprints && data.sprints[i.sprint];
      return [i.key, i.title, (TYPES[i.type] || TYPES.task).name, statusOf(i).name, i.assignee, i.start, i.end, i.progress, i.points, p ? p.key || p.title : "", sp ? sp.name : "", i.desc].map(q).join(",");
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
          }, function (e) { gate(L("No access", "Sem acesso"), e.message); });
        }, function () { gate(L("No access", "Sem acesso"), L("Your access to this workspace may have ended.", "O seu acesso a este workspace pode ter terminado.")); });
      }, function () { gate(L("No access", "Sem acesso"), L("Your access to this workspace may have ended.", "O seu acesso a este workspace pode ter terminado.")); });
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { const m = document.querySelector(".pl-modal"); if (m) m.remove(); else closeDrawer(); } });
  }
  start();
})();
