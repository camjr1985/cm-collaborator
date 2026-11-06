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
  const TYPES = {
    epic: { icon: "⚡", name: L("Epic", "Épico"), color: "#7c5cff" },
    phase: { icon: "▣", name: L("Phase", "Fase"), color: "#0e1a33" },
    story: { icon: "📗", name: L("Story", "História"), color: "#36b37e" },
    task: { icon: "✔", name: L("Task", "Tarefa"), color: "#2f80ed" },
    bug: { icon: "🐞", name: "Bug", color: "#e5484d" },
    milestone: { icon: "◆", name: L("Milestone", "Marco"), color: "#e8a400" }
  };
  const CATC = { todo: "#8a94a6", doing: "#2f80ed", done: "#36b37e" };
  const VIEWN = { timeline: L("Timeline", "Linha do tempo"), board: L("Board", "Quadro"), backlog: "Backlog", list: L("List", "Lista") };

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
  function isContainer(it) { return it.type === "epic" || it.type === "phase"; }
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
  /* changes to items that came from Jira go back to Jira (summary, status, start, due) */
  function jiraPushLater(id, obj) {
    const it = data.items[id], J = data.settings && data.settings.jira;
    if (!it || !it.ext || it.ext.source !== "jira" || !J || J.push === false) return;
    if (!["title", "status", "start", "end"].some(function (k) { return k in obj; })) return;
    clearTimeout(pushT[id]);
    pushT[id] = setTimeout(function () {
      notify("jira-push", { item: id }).then(function (j) {
        if (j && j.ok) toast(L("Updated in Jira: ", "Atualizado no Jira: ") + it.ext.key);
        else toast(L("Jira did not accept the change: ", "O Jira não aceitou a alteração: ") + ((j && j.error) || ""));
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
      return ref("items/" + id).set(it).then(function () { if (it.assignee && it.assignee !== me.email) notify("assign", { item: id }); return id; });
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
    const views = m.views;
    if (!view) { try { view = localStorage.getItem("cmcollab:plview:" + ID); } catch (e) { /* ignore */ } }
    if (views.indexOf(view) < 0) view = views[0];
    const who = {}; items().forEach(function (i) { if (i.assignee) who[i.assignee] = 1; }); Object.keys(members).forEach(function (k) { who[members[k].email] = 1; });
    app.innerHTML =
      '<header class="pl-top"><a class="pl-back" href="../workspaces/" title="' + L("My boards", "Meus quadros") + '">←</a><span class="pl-logo">CM</span>' +
      '<div class="pl-title"><span class="pl-ws">' + esc(wsInfo.name || info.ws) + " · " + m.icon + " " + esc(m.name) + '</span><h1>' + esc(info.title) + "</h1></div>" +
      '<nav class="pl-tabs">' + views.map(function (v) { return '<button data-view="' + v + '" class="' + (v === view ? "on" : "") + '">' + esc((m.label && m.label[v]) || VIEWN[v]) + "</button>"; }).join("") + "</nav>" +
      '<div class="pl-actions">' + (canEdit ? '<button class="pl-btn primary" id="newBtn">+ ' + L("Create", "Criar") + "</button>" : '<span class="pl-ro">' + L("View only", "Só leitura") + "</span>") +
      '<button class="pl-btn icon" id="moreBtn" title="' + L("More", "Mais") + '">⋯</button></div></header>' +
      '<div class="pl-bar"><input id="q" type="search" placeholder="' + L("Search items", "Pesquisar itens") + '" value="' + esc(filter.q) + '">' +
      '<select id="who"><option value="">' + L("Everyone", "Todas as pessoas") + '</option><option value="_none"' + (filter.who === "_none" ? " selected" : "") + ">" + L("Unassigned", "Sem responsável") + "</option>" +
      Object.keys(who).sort().map(function (e) { return '<option value="' + esc(e) + '"' + (filter.who === e ? " selected" : "") + ">" + esc(memberName(e)) + "</option>"; }).join("") + "</select>" +
      (view === "timeline" ? '<div class="pl-seg" id="scale">' + [["week", L("Weeks", "Semanas")], ["month", L("Months", "Meses")], ["quarter", L("Quarters", "Trimestres")]].map(function (s) { return '<button data-s="' + s[0] + '" class="' + (scale === s[0] ? "on" : "") + '">' + s[1] + "</button>"; }).join("") + '</div><button class="pl-btn sm" id="todayBtn">' + L("Today", "Hoje") + "</button>" : "") +
      (data.settings && data.settings.jira && canEdit ? '<button class="pl-btn sm" id="jiraSync" title="' + L("Pull the latest from Jira", "Trazer as últimas alterações do Jira") + '">↻ Jira</button>' : "") +
      '<span class="pl-sum" id="sum"></span></div>' +
      '<main id="view" class="pl-view"></main>';
    app.querySelectorAll("[data-view]").forEach(function (b) { b.onclick = function () { view = b.dataset.view; try { localStorage.setItem("cmcollab:plview:" + ID, view); } catch (e) { /* ignore */ } shell(); }; });
    const q = document.getElementById("q"); q.oninput = function () { filter.q = q.value; renderView(); };
    document.getElementById("who").onchange = function (e) { filter.who = e.target.value; renderView(); };
    const sc = document.getElementById("scale"); if (sc) sc.onclick = function (e) { const b = e.target.closest("button"); if (b) { scale = b.dataset.s; shell(); } };
    const tb = document.getElementById("todayBtn"); if (tb) tb.onclick = function () { scrollToday(true); };
    const nb = document.getElementById("newBtn"); if (nb) nb.onclick = function () { quickCreate(); };
    document.getElementById("moreBtn").onclick = moreMenu;
    const js = document.getElementById("jiraSync"); if (js) js.onclick = function () { js.disabled = true; jiraRun(data.settings.jira.jql, data.settings.jira.push !== false).then(function () { js.disabled = false; }); };
    renderView();
  }
  function renderView() {
    if (dragging) { pending = true; return; }
    const v = document.getElementById("view"); if (!v) return;
    const all = items();
    const done = all.filter(function (i) { return i.type !== "milestone" && cat(i) === "done"; }).length, tot = all.filter(function (i) { return i.type !== "milestone"; }).length;
    const late = all.filter(overdue).length;
    document.getElementById("sum").innerHTML = tot + " " + L("items", "itens") + " · " + (tot ? Math.round(done / tot * 100) : 0) + "% " + L("done", "concluído") + (late ? ' · <b class="late">' + late + " " + L("overdue", "em atraso") + "</b>" : "");
    if (view === "timeline") timeline(v); else if (view === "board") board(v); else if (view === "backlog") backlog(v); else list(v);
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
        '<span class="ti" style="color:' + T.color + '" title="' + esc(T.name) + '">' + T.icon + '</span><span class="tk">' + esc(it.key || "") + '</span><span class="tt">' + esc(it.title) + "</span>" +
        (it.assignee ? '<span class="av" title="' + esc(memberName(it.assignee)) + '">' + esc(initials(it.assignee)) + "</span>" : "") +
        (canEdit && isContainer(it) ? '<button class="addc" data-addc="' + it.id + '" title="' + L("Add child item", "Adicionar item filho") + '">+</button>' : "") + "</div>";
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
    v.innerHTML = '<div class="tl"><div class="tl-left"><div class="tl-lh">' + L("Items", "Itens") + (canEdit ? '<button class="pl-btn sm" id="addTop">+ ' + esc(method().types.indexOf("epic") >= 0 ? TYPES.epic.name : TYPES.phase.name) + "</button>" : "") + '</div><div class="tl-lb" id="tlLeft">' + left +
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
    v.querySelectorAll("[data-addc]").forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); const p = data.items[b.dataset.addc]; collapsed[b.dataset.addc] = false; createItem({ type: p.type === "phase" ? "task" : "story", parent: b.dataset.addc, title: L("New item", "Novo item") }).then(function (id) { if (id) openDrawer(id, true); }); }; });
    v.querySelectorAll(".tl-row").forEach(function (r) { r.onclick = function () { openDrawer(r.dataset.open); }; });
    const at = document.getElementById("addTop"); if (at) at.onclick = function () { const ty = method().types.indexOf("epic") >= 0 ? "epic" : "phase"; createItem({ type: ty, title: TYPES[ty].name + " " + (items().filter(function (i) { return i.type === ty; }).length + 1), start: today(), end: n2d(d2n(today()) + 27 * DAY) }).then(function (id) { if (id) openDrawer(id, true); }); };
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
    box.innerHTML = '<textarea rows="2" placeholder="' + L("What needs to be done?", "O que é preciso fazer?") + '"></textarea><div class="pl-row-end"><select>' + method().types.filter(function (t) { return t !== "epic" && t !== "phase" && t !== "milestone"; }).map(function (t) { return '<option value="' + t + '">' + TYPES[t].icon + " " + TYPES[t].name + "</option>"; }).join("") + '</select><button class="pl-btn primary sm">' + L("Create", "Criar") + "</button></div>";
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
    const parents = items().filter(function (i) { return isContainer(i) && i.id !== id; });
    const others = items().filter(function (i) { return i.id !== id && !isContainer(i); }).sort(byOrder);
    const ppl = Object.keys(members).map(function (k) { return members[k]; });
    const sps = Object.keys(data.sprints || {}).filter(function (k) { return data.sprints[k].state !== "closed"; });
    let d = document.getElementById("drawer");
    if (!d) { d = document.createElement("aside"); d.id = "drawer"; d.className = "pl-drawer"; document.body.appendChild(d); }
    d.innerHTML = '<header><span class="ti" style="color:' + T.color + '">' + T.icon + '</span><span class="tk">' + esc(it.key || "") + '</span><span class="sp"></span>' + (canEdit ? '<button class="pl-btn sm ghost danger" id="dDel">' + L("Delete", "Excluir") + "</button>" : "") + '<button class="pl-btn icon" id="dX">✕</button></header>' +
      '<form class="pl-form" id="dF"><textarea name="title" class="d-title" rows="2"' + dis + ">" + esc(it.title) + "</textarea>" +
      '<div class="g2"><label>' + L("Type", "Tipo") + '<select name="type"' + dis + ">" + Object.keys(TYPES).filter(function (t) { return method().types.indexOf(t) >= 0 || t === it.type; }).map(function (t) { return '<option value="' + t + '"' + (t === it.type ? " selected" : "") + ">" + TYPES[t].icon + " " + TYPES[t].name + "</option>"; }).join("") + "</select></label>" +
      "<label>" + L("Status", "Estado") + '<select name="status"' + dis + ">" + statuses().map(function (s) { return '<option value="' + s.id + '"' + (statusOf(it).id === s.id ? " selected" : "") + ">" + esc(s.name) + "</option>"; }).join("") + "</select></label></div>" +
      "<label>" + L("Assignee", "Responsável") + '<select name="assignee"' + dis + '><option value="">' + L("Unassigned", "Sem responsável") + "</option>" + ppl.map(function (m) { return '<option value="' + esc(m.email) + '"' + (m.email === it.assignee ? " selected" : "") + ">" + esc(m.name || m.email) + " · " + esc(m.email) + "</option>"; }).join("") + "</select></label>" +
      '<div class="g2"><label>' + L("Start", "Início") + '<input type="date" name="start" value="' + esc(it.start || "") + '"' + dis + "></label><label>" + L("Due / end", "Prazo / fim") + '<input type="date" name="end" value="' + esc(it.end || "") + '"' + dis + "></label></div>" +
      '<div class="g2"><label>' + L("Progress %", "Progresso %") + '<input type="number" min="0" max="100" step="5" name="progress" value="' + esc(it.progress == null ? "" : it.progress) + '"' + dis + "></label><label>" + L("Story points", "Story points") + '<input type="number" min="0" step="1" name="points" value="' + esc(it.points == null ? "" : it.points) + '"' + dis + "></label></div>" +
      (isContainer(it) ? "" : "<label>" + L("Parent (epic / phase)", "Pai (épico / fase)") + '<select name="parent"' + dis + '><option value="">—</option>' + parents.map(function (p) { return '<option value="' + p.id + '"' + (p.id === it.parent ? " selected" : "") + ">" + esc((p.key ? p.key + " · " : "") + p.title) + "</option>"; }).join("") + "</select></label>") +
      (sps.length && !isContainer(it) ? "<label>Sprint<select name=\"sprint\"" + dis + '><option value="">Backlog</option>' + sps.map(function (k) { return '<option value="' + k + '"' + (k === it.sprint ? " selected" : "") + ">" + esc(data.sprints[k].name) + "</option>"; }).join("") + "</select></label>" : "") +
      "<label>" + L("Depends on (finish → start)", "Depende de (fim → início)") + '<select name="deps" multiple size="4"' + dis + ">" + others.map(function (o) { return '<option value="' + o.id + '"' + ((it.deps || {})[o.id] ? " selected" : "") + ">" + esc((o.key ? o.key + " · " : "") + o.title) + "</option>"; }).join("") + "</select></label>" +
      "<label>" + L("Description", "Descrição") + '<textarea name="desc" rows="5"' + dis + ">" + esc(it.desc || "") + "</textarea></label>" +
      '<p class="muted small">' + (it.by ? L("Created by ", "Criado por ") + esc(memberName(it.by)) : "") + (it.ext ? " · " + (it.ext.url ? '<a href="' + esc(it.ext.url) + '" target="_blank" rel="noopener">' + esc(it.ext.source === "jira" ? "Jira " : it.ext.source + " ") + esc(it.ext.key || "") + " ↗</a>" : esc(it.ext.source) + " " + esc(it.ext.key || "")) : "") + (it.ext && it.ext.assigneeName && !it.assignee ? " · " + L("Jira assignee: ", "Responsável no Jira: ") + esc(it.ext.assigneeName) : "") + "</p></form>";
    document.getElementById("dX").onclick = closeDrawer;
    document.querySelectorAll(".tl-row.sel").forEach(function (r) { r.classList.remove("sel"); });
    const row = document.querySelector('.tl-row[data-open="' + id + '"]'); if (row) row.classList.add("sel");
    if (!canEdit) return;
    const f = document.getElementById("dF");
    f.querySelectorAll("input,select,textarea").forEach(function (inp) {
      inp.onchange = function () {
        const n = inp.name, o = {};
        if (n === "deps") { const dd = {}; Array.prototype.forEach.call(inp.selectedOptions, function (op) { dd[op.value] = true; }); o.deps = Object.keys(dd).length ? dd : null; }
        else if (inp.type === "number") o[n] = inp.value === "" ? null : Number(inp.value);
        else o[n] = n === "title" ? (inp.value.trim() || it.title) : (inp.value || null);
        if (n === "status") { const st = statuses().find(function (s) { return s.id === inp.value; }); if (st && st.cat === "done") o.progress = 100; }
        if (n === "type" && inp.value === "milestone") o.end = f.start.value || f.end.value || null;
        const prevA = (data.items[id] || {}).assignee;
        patch(id, o).then(function () { if (n === "assignee" && inp.value && inp.value !== me.email && inp.value !== prevA) notify("assign", { item: id }).then(function (j) { if (j && j.ok && (j.sent || []).length) toast(L("Assignee notified by e-mail", "Responsável avisado por e-mail")); }); });
      };
    });
    f.title.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); f.title.blur(); } };
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
  function quickCreate() {
    const types = method().types;
    const parents = items().filter(isContainer);
    modal("<h2>" + L("Create item", "Criar item") + '</h2><form class="pl-form" id="qcF"><div class="g2"><label>' + L("Type", "Tipo") + '<select name="type">' + types.map(function (t) { return '<option value="' + t + '">' + TYPES[t].icon + " " + TYPES[t].name + "</option>"; }).join("") + "</select></label>" +
      "<label>" + L("Parent", "Pai") + '<select name="parent"><option value="">—</option>' + parents.map(function (p) { return '<option value="' + p.id + '">' + esc(p.title) + "</option>"; }).join("") + "</select></label></div>" +
      "<label>" + L("Title", "Título") + '<input name="title" required autocomplete="off"></label>' +
      "<label>" + L("Assignee", "Responsável") + '<select name="assignee"><option value="">' + L("Unassigned", "Sem responsável") + "</option>" + Object.keys(members).map(function (k) { return '<option value="' + esc(members[k].email) + '">' + esc(members[k].name || members[k].email) + "</option>"; }).join("") + "</select></label>" +
      '<div class="g2"><label>' + L("Start", "Início") + '<input type="date" name="start"></label><label>' + L("Due / end", "Prazo / fim") + '<input type="date" name="end"></label></div>' +
      '<div class="pl-row-end"><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + L("Create", "Criar") + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#qcF");
      f.querySelector("[name=title]").focus();
      f.onsubmit = function (e) {
        e.preventDefault();
        const o = { type: f.type.value, title: f.title.value.trim(), parent: f.parent.value || undefined, assignee: f.assignee.value || undefined, start: f.start.value || undefined, end: f.end.value || f.start.value || undefined };
        if (o.type === "milestone") o.end = o.start = o.end || o.start;
        if (info.method === "scrum" && !isContainer(o) && activeSprint() && view === "board") o.sprint = activeSprint();
        createItem(o).then(close);
      };
    });
  }
  function moreMenu() {
    const owner = isAdm || (wsInfo.owner && wsInfo.owner === A.key(me.email));
    modal("<h2>" + L("Planning options", "Opções do planejamento") + '</h2><div class="pl-menu">' +
      (canEdit ? '<button data-act="workflow">⚙️ ' + L("Workflow and columns", "Fluxo e colunas") + "</button>" : "") +
      (canEdit ? '<button data-act="remind">🔔 ' + L("Send deadline reminders by e-mail", "Enviar lembretes de prazo por e-mail") + "</button>" : "") +
      (canEdit ? '<button data-act="import">📥 ' + L("Import CSV (Jira, Azure DevOps, Kanbanize, Excel)", "Importar CSV (Jira, Azure DevOps, Kanbanize, Excel)") + "</button>" : "") +
      '<button data-act="export">📤 ' + L("Export CSV", "Exportar CSV") + "</button>" +
      '<button data-act="print">🖨️ ' + L("Print / PDF", "Imprimir / PDF") + "</button>" +
      '<button data-act="integrations">🔗 ' + L("Integrations (Jira, Azure DevOps, Kanbanize)", "Integrações (Jira, Azure DevOps, Kanbanize)") + "</button>" +
      (owner ? '<button data-act="rename">✏️ ' + L("Rename", "Renomear") + "</button>" : "") +
      '</div><div class="pl-row-end"><button class="pl-btn" data-close>' + L("Close", "Fechar") + "</button></div>", function (box, close) {
      box.querySelectorAll("[data-act]").forEach(function (b) {
        b.onclick = function () {
          close();
          ({ workflow: workflowDialog, remind: sendReminders, import: importDialog, export: exportCsv, print: function () { window.print(); }, integrations: integrationsDialog, rename: renameDialog })[b.dataset.act]();
        };
      });
    });
  }
  function renameDialog() {
    modal("<h2>" + L("Rename planning", "Renomear do planejamento") + '</h2><form class="pl-form" id="rnF"><input name="t" required value="' + esc(info.title) + '"><div class="pl-row-end"><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + L("Save", "Salvar") + "</button></div></form>", function (box, close) {
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
  function integrationsDialog() {
    const J = wsInteg.jira, owner = isAdm || (wsInfo.owner && wsInfo.owner === A.key(me.email)), PJ = data.settings && data.settings.jira;
    const jiraCard = '<div class="int-card on"><b>Jira Cloud</b>' + (J
      ? '<p class="small">✅ ' + L("Connected to ", "Conectado a ") + "<b>" + esc(J.site.replace("https://", "")) + "</b>" + (J.account ? " · " + esc(J.account) : "") + "</p>" +
        (PJ ? '<p class="muted small">' + L("This planning syncs with: ", "Este planning sincroniza com: ") + "<code>" + esc(PJ.jql) + "</code>" + (PJ.lastSync ? " · " + L("last sync ", "última sincronização ") + new Date(PJ.lastSync).toLocaleString(PT ? "pt-BR" : "en-GB") : "") + "</p>" : "") +
        '<div class="pl-row-end" style="justify-content:flex-start">' + (canEdit ? '<button class="pl-btn primary sm" id="jImp">' + (PJ ? L("Change import / sync", "Alterar importação / sincronizar") : L("Import from Jira", "Importar do Jira")) + "</button>" : "") + (owner ? '<button class="pl-btn ghost danger sm" id="jOff">' + L("Disconnect", "Desconectar") + "</button>" : "") + "</div>"
      : (owner ? '<form class="pl-form" id="jForm"><p class="muted small">' + L("Connect once per workspace. The API token stays on the platform server – it is never saved in the browser or in the database.", "Conecte uma vez por workspace. O token de API fica no servidor da plataforma – nunca é salvo no navegador nem no banco de dados.") + "</p>" +
        '<label>' + L("Jira site", "Site do Jira") + '<input name="site" required placeholder="https://sua-empresa.atlassian.net" autocomplete="off"></label>' +
        '<label>' + L("Atlassian account e-mail", "E-mail da conta Atlassian") + '<input name="email" type="email" required autocomplete="off"></label>' +
        '<label>' + L("API token", "Token de API") + '<input name="token" type="password" required autocomplete="new-password"></label>' +
        '<p class="muted small"><a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener">' + L("Create an API token in your Atlassian account ↗", "Criar um token de API na sua conta Atlassian ↗") + "</a></p>" +
        '<div class="pl-row-end"><button class="pl-btn primary">' + L("Connect Jira", "Conectar o Jira") + "</button></div></form>"
        : '<p class="muted small">' + L("Ask the workspace owner or an admin to connect Jira.", "Peça ao dono do workspace ou a um administrador para conectar o Jira.") + "</p>")) + "</div>";
    modal("<h2>" + L("Integrations", "Integrações") + '</h2><div class="int-grid">' + jiraCard +
      [["Azure DevOps Boards", L("Work items by WIQL with start and target dates.", "Work items por WIQL com datas de início e alvo.")], ["Kanbanize (Businessmap)", L("Cards, columns and deadlines from your boards.", "Cartões, colunas e prazos dos seus quadros.")]].map(function (x) {
        return '<div class="int-card"><b>' + x[0] + '</b><p class="muted small">' + x[1] + '</p><span class="tag">' + L("Coming soon", "Em breve") + "</span></div>";
      }).join("") + '</div><p class="muted small">' + L("Any tool: More → Import CSV.", "Qualquer ferramenta: Mais → Importar CSV.") + '</p><div class="pl-row-end"><button class="pl-btn" data-close>' + L("Close", "Fechar") + "</button></div>", function (box, close) {
      const f = box.querySelector("#jForm");
      if (f) f.onsubmit = function (e) {
        e.preventDefault(); const b = f.querySelector("button"); b.disabled = true; b.textContent = L("Connecting…", "Conectando…");
        notify("jira-connect", { site: f.site.value.trim(), email: f.email.value.trim(), token: f.token.value.trim() }).then(function (j) {
          f.token.value = "";
          if (!j || !j.ok) { b.disabled = false; b.textContent = L("Connect Jira", "Conectar o Jira"); return toast(L("Could not connect: ", "Não foi possível conectar: ") + ((j && j.error) || "")); }
          wsInteg.jira = { site: j.site, account: j.account, by: me.email, at: Date.now() };
          db.ref("workspaces/" + info.ws + "/integrations/jira").set(wsInteg.jira).catch(function () { /* marker only */ });
          toast(L("Jira connected", "Jira conectado")); close(); jiraImportDialog();
        });
      };
      const imp = box.querySelector("#jImp"); if (imp) imp.onclick = function () { close(); jiraImportDialog(); };
      const off = box.querySelector("#jOff"); if (off) off.onclick = function () {
        notify("jira-disconnect", {}).then(function (j) {
          if (!j || !j.ok) return toast((j && j.error) || "");
          wsInteg.jira = null; db.ref("workspaces/" + info.ws + "/integrations/jira").remove().catch(function () { /* ignore */ });
          toast(L("Jira disconnected", "Jira desconectado")); close();
        });
      };
    });
  }
  function jiraImportDialog() {
    const PJ = (data.settings && data.settings.jira) || {};
    modal("<h2>" + L("Import from Jira", "Importar do Jira") + '</h2><form class="pl-form" id="jiF"><label>' + L("Project", "Projeto") + '<select name="proj"><option value="">' + L("Loading projects…", "Carregando projetos…") + "</option></select></label>" +
      '<label>JQL<textarea name="jql" rows="3" placeholder="project = ABC ORDER BY Rank ASC">' + esc(PJ.jql || "") + "</textarea></label>" +
      '<label class="chk"><input type="checkbox" name="push"' + (PJ.push === false ? "" : " checked") + "> " + L("Send changes made here back to Jira (title, status, start and due dates)", "Enviar para o Jira as alterações feitas aqui (título, status, datas de início e prazo)") + "</label>" +
      '<p class="muted small">' + L("Epics become epics/phases, sub-tasks keep their parent. Items already imported are updated, nothing is duplicated.", "Épicos viram épicos/fases e subtarefas mantêm o pai. Itens já importados são atualizados, nada é duplicado.") + "</p>" +
      '<div class="pl-row-end"><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary">' + L("Import", "Importar") + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#jiF");
      notify("jira-projects", {}).then(function (j) {
        if (!j || !j.ok) { f.proj.innerHTML = '<option value="">' + esc((j && j.error) || "error") + "</option>"; return; }
        f.proj.innerHTML = '<option value="">' + L("— choose a project or write JQL —", "— escolha um projeto ou escreva o JQL —") + "</option>" + j.projects.map(function (p) { return '<option value="' + esc(p.key) + '">' + esc(p.name) + " (" + esc(p.key) + ")</option>"; }).join("");
      });
      f.proj.onchange = function () { if (f.proj.value) f.jql.value = 'project = "' + f.proj.value + '" ORDER BY Rank ASC'; };
      f.onsubmit = function (e) {
        e.preventDefault(); const jql = f.jql.value.trim(); if (!jql) return toast(L("Choose a project or write the JQL", "Escolha um projeto ou escreva o JQL"));
        const b = f.querySelector(".pl-btn.primary"); b.disabled = true; b.textContent = L("Importing…", "Importando…");
        jiraRun(jql, f.push.checked).then(function (ok) { if (ok) close(); else { b.disabled = false; b.textContent = L("Import", "Importar"); } });
      };
    });
  }
  function jiraRun(jql, push) {
    toast(L("Talking to Jira…", "Conversando com o Jira…"));
    return notify("jira-import", { jql: jql }).then(function (j) {
      if (!j || !j.ok) { toast(L("Jira: ", "Jira: ") + ((j && j.error) || "error")); return false; }
      return mergeJira(j.issues).then(function (n) {
        return save("settings/jira", { jql: jql, push: !!push, lastSync: Date.now(), site: j.site }).then(function () {
          toast(n.created + L(" new, ", " novos, ") + n.updated + L(" updated from Jira", " atualizados do Jira")); return true;
        });
      });
    });
  }
  function mergeJira(issues) {
    const ss = statuses(), types = method().types, byKey = {}, u = {}, res = { created: 0, updated: 0 };
    items().forEach(function (i) { if (i.ext && i.ext.source === "jira" && i.ext.key) byKey[i.ext.key] = i.id; });
    const emails = {}; Object.keys(members).forEach(function (k) { emails[members[k].email.toLowerCase()] = members[k].email; });
    function tp(x) {
      const n = (x.type || "").toLowerCase();
      if (x.level >= 1 || /epic|épico/.test(n)) return types.indexOf("epic") >= 0 ? "epic" : "phase";
      if (/bug|defeito/.test(n)) return types.indexOf("bug") >= 0 ? "bug" : "task";
      if (/story|história|historia/.test(n)) return types.indexOf("story") >= 0 ? "story" : "task";
      if (/milestone|marco/.test(n)) return "milestone";
      return "task";
    }
    function st(x) {
      const exact = ss.find(function (s) { return s.name.toLowerCase() === (x.status || "").toLowerCase(); }); if (exact) return exact.id;
      const c = { new: "todo", indeterminate: "doing", done: "done" }[x.cat] || "todo";
      return (ss.find(function (s) { return s.cat === c; }) || ss[0]).id;
    }
    issues.forEach(function (x, i) { if (!byKey[x.key]) { byKey[x.key] = db.ref().push().key; x._new = true; } });
    issues.forEach(function (x, i) {
      const id = byKey[x.key], P = "items/" + id + "/", o = {
        title: x.title, type: tp(x), status: st(x), key: x.key,
        start: x.start || x.due || null, end: x.due || x.start || null,
        assignee: x.assignee && emails[x.assignee.toLowerCase()] ? emails[x.assignee.toLowerCase()] : (x._new ? null : undefined),
        points: x.points == null ? null : Number(x.points),
        parent: x.parent && byKey[x.parent] ? byKey[x.parent] : null,
        ext: { source: "jira", key: x.key, url: x.url, assigneeName: x.assigneeName || null }
      };
      if (st(x) && ss.find(function (s) { return s.id === o.status && s.cat === "done"; })) o.progress = 100;
      if (x._new) { o.order = Date.now() + i; o.created = TS(); o.by = me.email; res.created++; } else res.updated++;
      Object.keys(o).forEach(function (k) { if (o[k] !== undefined) u[P + k] = o[k]; });
    });
    return db.ref("planning/" + ID + "/data").update(u).then(function () { return res; });
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
          db.ref("planning/" + ID + "/data").on("value", function (snap) {
            data = snap.val() || { settings: {}, items: {}, sprints: {} };
            if (!data.items) data.items = {}; if (!data.settings) data.settings = {};
            const hasJ = !!(data.settings.jira);
            if (!document.getElementById("view") || hasJ !== !!document.getElementById("jiraSync") && canEdit) shell(); else renderView();
          }, function (e) { gate(L("No access", "Sem acesso"), e.message); });
        }, function () { gate(L("No access", "Sem acesso"), L("Your access to this workspace may have ended.", "O seu acesso a este workspace pode ter terminado.")); });
      }, function () { gate(L("No access", "Sem acesso"), L("Your access to this workspace may have ended.", "O seu acesso a este workspace pode ter terminado.")); });
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { const m = document.querySelector(".pl-modal"); if (m) m.remove(); else closeDrawer(); } });
  }
  start();
})();
