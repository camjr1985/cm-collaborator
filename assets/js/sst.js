/* CM Collaborator – Occupational health module ("Saúde Ocupacional", with SHE as a template area).
 * Add-on module, licensed separately (CMModules "sst"). Not connected to the IT service desk (ITSM): it reuses the same ideas
 * (records, workflow, deadlines, board, panel) but keeps everything centred on occupational health and safety.
 * Page /sst/?ws=<workspaceId>  (&rec=<recordId> opens a record)
 * Data: sst/<ws>/{ settings{places[], invDays, reqDays, hht{YYYY-MM:hours}}, counter, records/<id>{...} }
 *   record = { key, type, title, desc, when, place, person, personRole, severity, leave, daysLost, cat{num,date}, exam{kind,date,result},
 *              epi{item,qty,size}, status, owner, due, rootCause, actions/<aid>{t, owner, due, done, plan?{pid,item}}, created, by, updated, closedAt }
 * Plannings of the module: workspace plannings whose info.area is "ohs" or "she" (templates in planning-templates.js, field sub = health|safety|she).
 * Access: database.rules.json node "sst" (licence "sst" on the workspace or individual + active member of the workspace). */
(function () {
  "use strict";
  const A = window.CMAuth;
  const app = document.getElementById("app");
  const Q = new URLSearchParams(location.search);
  const DAY = 86400000;
  const PT = window.MB_LANG !== "en";
  const L = function (en, pt) { return window.MBL ? window.MBL(en, pt) : (PT ? pt : en); };
  const IC = function (n, sz) { return window.CMIcon ? window.CMIcon(n, sz || 16) : ""; };
  const LOC = window.MB_LOCALE || (PT ? "pt-BR" : "en-GB");

  let db, me, MEK, isAdm = false, WS = "", wss = {}, data = {}, plans = [], kpiCache = {}, view = "panel", filter = { q: "", type: "", status: "open" }, openRec = null, ref0 = null;

  /* ---------------- catalog ---------------- */
  function TYPES() {
    return {
      acc: { g: "safety", ic: "alert", c: "#e34948", cat: true, sev: true, n: L("Work accident", "Acidente de trabalho"), d: L("Typical accident at the workplace.", "Acidente típico no local de trabalho.") },
      commute: { g: "safety", ic: "alert", c: "#c2410c", cat: true, sev: true, n: L("Commuting accident", "Acidente de trajeto"), d: L("Between home and work.", "No trajeto entre casa e trabalho.") },
      near: { g: "safety", ic: "bell", c: "#eda100", sev: true, n: L("Near miss", "Quase-acidente"), d: L("Could have caused injury – nobody was hurt.", "Poderia ter causado lesão – ninguém se feriu.") },
      unsafe: { g: "safety", ic: "search", c: "#b7791f", sev: true, n: L("Unsafe act or condition", "Ato ou condição insegura"), d: L("Observation to be corrected before it becomes an accident.", "Observação a corrigir antes que vire acidente.") },
      disease: { g: "health", ic: "people", c: "#8e4ec6", cat: true, n: L("Occupational disease", "Doença ocupacional"), d: L("Illness related to the work (no diagnosis details here).", "Doença relacionada ao trabalho (sem detalhes de diagnóstico aqui).") },
      exam: { g: "health", ic: "calendar", c: "#2a78d6", req: true, n: L("Occupational exam", "Exame ocupacional"), d: L("Admission, periodic, return to work, change of risk or dismissal.", "Admissional, periódico, retorno ao trabalho, mudança de risco ou demissional.") },
      leave: { g: "health", ic: "clock", c: "#5c6b80", n: L("Absence / return to work", "Afastamento / retorno ao trabalho"), d: L("Follow the absence and the return with restrictions.", "Acompanhar o afastamento e o retorno com restrições.") },
      epi: { g: "safety", ic: "request", c: "#1baf7a", req: true, n: L("PPE request", "Solicitação de EPI"), d: L("Personal protective equipment for a person or team.", "Equipamento de proteção individual para uma pessoa ou equipe.") },
      inspection: { g: "safety", ic: "kb", c: "#0f766e", n: L("Inspection / non-conformity", "Inspeção / não conformidade"), d: L("Finding of an inspection, audit or legal requirement (NR).", "Achado de inspeção, auditoria ou requisito legal (NR).") },
      env: { g: "she", ic: "spark", c: "#008300", sev: true, n: L("Environmental incident", "Incidente ambiental"), d: L("Spill, leak, emission or waste out of standard.", "Derramamento, vazamento, emissão ou resíduo fora do padrão.") },
      improve: { g: "she", ic: "improvement", c: "#6250d6", req: true, n: L("Improvement suggestion", "Sugestão de melhoria"), d: L("Idea to make the work safer or healthier.", "Ideia para deixar o trabalho mais seguro ou saudável.") }
    };
  }
  const GROUPS = function () { return { health: L("Occupational health", "Saúde ocupacional"), safety: L("Work safety", "Segurança do trabalho"), she: L("SHE – environment", "SHE – meio ambiente") }; };
  function STATUSES() {
    return [{ id: "new", n: L("Registered", "Registrada"), c: "#8a94a6" }, { id: "analysis", n: L("Investigating", "Em investigação"), c: "#2a78d6" }, { id: "action", n: L("Action plan", "Plano de ação"), c: "#8e4ec6" },
      { id: "doing", n: L("In execution", "Em execução"), c: "#eda100" }, { id: "done", n: L("Closed", "Concluída"), c: "#1baf7a" }, { id: "cancel", n: L("Cancelled", "Cancelada"), c: "#5c6b80" }];
  }
  const SEV = function () { return [["low", L("Minor", "Leve")], ["med", L("Moderate", "Moderada")], ["high", L("Serious", "Grave")], ["fatal", L("Fatal", "Fatal")]]; };
  const EXAMS = function () { return [["admission", L("Admission", "Admissional")], ["periodic", L("Periodic", "Periódico")], ["return", L("Return to work", "Retorno ao trabalho")], ["change", L("Change of risk", "Mudança de risco")], ["dismissal", L("Dismissal", "Demissional")]]; };
  const RESULTS = function () { return [["fit", L("Fit", "Apto")], ["fitr", L("Fit with restrictions", "Apto com restrições")], ["unfit", L("Unfit", "Inapto")]]; };

  /* ---------------- helpers ---------------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function TS() { return window.firebase.database.ServerValue.TIMESTAMP; }
  function toast(msg) {
    let n = document.getElementById("toast");
    if (!n) { n = document.createElement("div"); n.id = "toast"; n.className = "pl-toast"; n.setAttribute("role", "status"); document.body.appendChild(n); }
    n.textContent = msg; n.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(function () { n.classList.remove("show"); }, 3000);
  }
  function fail(e) { console.warn(e); toast((e && e.message) || L("Something went wrong", "Algo deu errado")); }
  function nf(n, d) { return (Number(n) || 0).toLocaleString(LOC, { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 }); }
  function fmtD(t) { return t ? new Date(t).toLocaleDateString(LOC, { day: "2-digit", month: "short", year: "2-digit" }) : "–"; }
  function fmtDT(t) { return t ? new Date(t).toLocaleString(LOC, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "–"; }
  function toLocal(t) { if (!t) return ""; const d = new Date(t - new Date(t).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); }
  function ym(t) { const d = new Date(t); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
  function monLabel(k) { return new Date(k + "-01T12:00:00").toLocaleDateString(LOC, { month: "short", year: "2-digit" }); }
  function opt(v, label, sel) { return '<option value="' + esc(v) + '"' + (String(sel) === String(v) ? " selected" : "") + ">" + esc(label) + "</option>"; }
  function S() { return data.settings || {}; }
  function recs() { return Object.keys(data.records || {}).map(function (k) { return Object.assign({ id: k }, data.records[k]); }).sort(function (a, b) { return (b.when || b.created || 0) - (a.when || a.created || 0); }); }
  function isOpen(r) { return r.status !== "done" && r.status !== "cancel"; }
  function isAcc(r) { return r.type === "acc" || r.type === "commute" || r.type === "disease"; }
  function members() { const w = wss[WS] || {}, m = w.members || {}, out = {}; Object.keys(m).forEach(function (k) { const x = m[k]; if (x && (!x.expires || x.expires > Date.now())) out[k] = x; }); return out; }
  function who(e) { if (!e) return ""; const m = members()[A.key(e)]; return (m && m.name) || String(e).split("@")[0]; }
  function sref(p) { return db.ref("sst/" + WS + (p ? "/" + p : "")); }
  function nextBizDay(t) { const d = new Date(t); d.setHours(23, 59, 0, 0); do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); return d.getTime(); }
  function catDue(r) { if (!TYPES()[r.type] || !TYPES()[r.type].cat || !r.when) return null; return r.severity === "fatal" ? r.when + DAY / 24 : nextBizDay(r.when); }
  function catLate(r) { const d = catDue(r); return d && !(r.cat && r.cat.num) && Date.now() > d; }
  function dueState(r) { if (!isOpen(r) || !r.due) return ""; const left = r.due - Date.now(); return left < 0 ? "late" : left < 2 * DAY ? "soon" : "ok"; }
  function modal(html, bind) {
    const w = document.createElement("div"); w.className = "pl-modal"; w.innerHTML = '<div class="pl-card" role="dialog" aria-modal="true">' + html + "</div>";
    document.body.appendChild(w);
    function close() { w.remove(); }
    w.onclick = function (e) { if (e.target === w) close(); };
    w.querySelectorAll("[data-close]").forEach(function (b) { b.onclick = close; });
    if (bind) bind(w, close);
    return w;
  }
  function gate(title, text) { app.innerHTML = '<div class="mod-gate"><div class="mod-gate-card"><h1>' + esc(title) + "</h1><p>" + esc(text) + '</p><div class="mod-gate-acts"><a class="btn" href="../workspaces/">' + esc(L("My boards", "Meus quadros")) + "</a></div></div></div>"; }

  /* ---------------- start ---------------- */
  function start() {
    if (!A || !A.enabled) return gate(L("Sign in required", "É preciso fazer login"), L("The module needs the online environment.", "O módulo precisa do ambiente online."));
    A.ready().then(function (user) {
      if (!user) return gate(L("Sign in to continue", "Faça login para continuar"), L("Open “My boards”, sign in with the invited e-mail and come back to this link.", "Abra “Meus quadros”, entre com o e-mail convidado e volte a este link."));
      me = user; db = A.db(); MEK = A.key(user.email);
      return A.isAdmin().then(function (adm) { isAdm = adm; return loadWorkspaces(); }).then(chooseWs);
    }).catch(fail);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { const m = document.querySelectorAll(".pl-modal"); if (m.length) m[m.length - 1].remove(); else closeDrawer(); } });
  }
  function loadWorkspaces() {
    return db.ref("userWorkspaces/" + MEK).once("value").then(function (s) {
      const ids = Object.keys(s.val() || {});
      return Promise.all(ids.map(function (w) { return db.ref("workspaces/" + w).once("value").then(function (x) { return [w, x.val()]; }, function () { return [w, null]; }); }));
    }).then(function (rows) {
      rows.forEach(function (r) { if (r[1]) wss[r[0]] = r[1]; });
      const want = Q.get("ws");
      if (isAdm && want && !wss[want]) return db.ref("workspaces/" + want).once("value").then(function (x) { if (x.val()) wss[want] = x.val(); });
    });
  }
  function wsList() {
    const mods = function (w) { const m = (w.info || {}).modules; return Array.isArray(m) ? m : null; };
    return Object.keys(wss).filter(function (k) { const m = mods(wss[k]); return !m || m.indexOf("sst") >= 0; }).sort(function (a, b) {
      const sa = /ohs|she/.test((wss[a].info || {}).area || "") ? 0 : 1, sb = /ohs|she/.test((wss[b].info || {}).area || "") ? 0 : 1;
      return sa - sb || String((wss[a].info || {}).name || a).localeCompare(String((wss[b].info || {}).name || b));
    });
  }
  function chooseWs() {
    const list = wsList(); let w = Q.get("ws") || "";
    if (!w || list.indexOf(w) < 0) { try { w = localStorage.getItem("cm:sst:ws") || ""; } catch (e) { /* ignore */ } }
    if (list.indexOf(w) < 0) w = list[0] || "";
    if (!w) return gate(L("No workspace", "Nenhum workspace"), L("You are not a member of a workspace with the Occupational health module yet.", "Você ainda não participa de um workspace com o módulo Saúde Ocupacional."));
    openWs(w);
  }
  function openWs(w) {
    WS = w; try { localStorage.setItem("cm:sst:ws", w); } catch (e) { /* ignore */ }
    if (history.replaceState) { const u = new URL(location.href); u.searchParams.set("ws", w); history.replaceState(null, "", u); }
    if (ref0) ref0.off();
    app.innerHTML = '<div class="pl-loading">…</div>';
    (window.CMModules ? window.CMModules.gate("sst", w, app) : Promise.resolve(true)).then(function (ok) {
      if (!ok) return;
      ref0 = sref(); ref0.on("value", function (s) { data = s.val() || {}; render(); }, function (e) { gate(L("No access", "Sem acesso"), (e && e.message) || ""); });
      loadPlans();
    });
  }
  function loadPlans() {
    const idx = (wss[WS] || {}).plannings || {};
    Promise.all(Object.keys(idx).map(function (pid) { return db.ref("planning/" + pid + "/info").once("value").then(function (s) { return Object.assign({ id: pid }, s.val() || {}, { title: (s.val() || {}).title || idx[pid].title }); }, function () { return null; }); })).then(function (rows) {
      plans = rows.filter(function (p) { return p && (p.area === "ohs" || p.area === "she"); });
      return Promise.all(plans.map(function (p) { return db.ref("planning/" + p.id + "/data").once("value").then(function (s) { const d = s.val() || {}; kpiCache[p.id] = { kpis: d.kpis || {}, kpiv: d.kpiv || {}, n: Object.keys(d.items || {}).length, settings: d.settings || {} }; }, function () { kpiCache[p.id] = { kpis: {}, kpiv: {}, n: 0 }; }); }));
    }).then(function () { if (view === "plans" || view === "kpi" || view === "panel") renderView(); });
  }

  /* ---------------- shell ---------------- */
  function render() {
    const T = { panel: L("Panel", "Painel"), list: L("Occurrences", "Ocorrências"), board: L("Board", "Quadro"), plans: L("Plannings", "Planejamentos"), kpi: L("Indicators", "Indicadores"), cfg: L("Settings", "Configurações") };
    const list = wsList();
    if (!document.getElementById("sstView")) {
      app.innerHTML = '<header class="pl-top st-top"><a class="pl-back" href="../workspaces/" title="' + esc(L("My boards", "Meus quadros")) + '">←</a><span class="pl-logo">CM</span>' +
        '<div class="pl-title"><span class="pl-ws">' + (window.CMIcon3D ? window.CMIcon3D("sst", 16, "sst") : "") + " " + esc(L("Occupational health · SHE", "Saúde Ocupacional · SHE")) + '</span><h1 id="stTitle"></h1></div>' +
        '<nav class="pl-tabs" id="stTabs"></nav><div class="pl-actions"><select id="stWs" class="st-ws" aria-label="Workspace"></select><button class="pl-btn primary" id="stNew">' + IC("plus", 16) + " " + esc(L("Register", "Registrar")) + "</button></div></header>" +
        '<div class="st-note">' + IC("lock", 14) + " " + esc(L("Health data is sensitive (LGPD): record only what the management needs – no diagnosis, ICD code or medical records here.", "Dados de saúde são sensíveis (LGPD): registre só o necessário para a gestão – sem diagnóstico, CID ou prontuário aqui.")) + '</div><main id="sstView" class="pl-view st-view"></main>';
      document.getElementById("stNew").onclick = function () { newDialog(); };
      document.getElementById("stWs").onchange = function (e) { closeDrawer(); openWs(e.target.value); };
    }
    document.getElementById("stTitle").textContent = (wss[WS] && wss[WS].info && wss[WS].info.name) || WS;
    document.getElementById("stWs").innerHTML = list.map(function (k) { return opt(k, (wss[k].info || {}).name || k, WS); }).join("");
    document.getElementById("stWs").hidden = list.length < 2;
    const tabs = document.getElementById("stTabs");
    tabs.innerHTML = Object.keys(T).map(function (k) { return '<button data-v="' + k + '" class="' + (k === view ? "on" : "") + '">' + esc(T[k]) + "</button>"; }).join("");
    tabs.querySelectorAll("[data-v]").forEach(function (b) { b.onclick = function () { view = b.dataset.v; render(); }; });
    renderView();
    if (openRec && data.records && data.records[openRec]) drawer(openRec);
    const qr = Q.get("rec"); if (qr && !render._rec && data.records && data.records[qr]) { render._rec = 1; drawer(qr); }
  }
  function renderView() {
    const v = document.getElementById("sstView"); if (!v) return;
    ({ panel: panel, list: listView, board: boardView, plans: plansView, kpi: kpiView, cfg: cfgView })[view](v);
  }

  /* ---------------- panel ---------------- */
  function bars(rows, series) {
    const raw = Math.max.apply(null, rows.map(function (r) { return Math.max.apply(null, series.map(function (s) { return r[s.k] || 0; })); })), max = Math.max(2, Math.ceil(raw / 2) * 2);
    const W = Math.max(340, rows.length * (series.length * 14 + 18) + 50), H = 190, top = 18, base = H - 28;
    let o = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" class="st-bars" role="img">';
    [0, .5, 1].forEach(function (t) { const y = base - (base - top) * t; o += '<line x1="34" x2="' + (W - 4) + '" y1="' + y + '" y2="' + y + '" class="g"/><text x="30" y="' + (y + 4) + '" text-anchor="end" class="ax">' + nf(max * t) + "</text>"; });
    rows.forEach(function (r, i) {
      const gx = 44 + i * (series.length * 14 + 18);
      series.forEach(function (s, j) { const v = r[s.k] || 0, h = (base - top) * v / max; o += '<rect x="' + (gx + j * 14) + '" y="' + (base - h) + '" width="12" height="' + Math.max(0, h) + '" rx="3" fill="' + s.c + '"><title>' + esc(r.n + " · " + s.n + ": " + v) + "</title></rect>"; });
      o += '<text x="' + (gx + series.length * 7) + '" y="' + (H - 10) + '" text-anchor="middle" class="ax">' + esc(r.n) + "</text>";
    });
    return o + '</svg><div class="st-leg">' + series.map(function (s) { return '<span><i style="background:' + s.c + '"></i>' + esc(s.n) + "</span>"; }).join("") + "</div>";
  }
  function panel(v) {
    const R = recs(), TY = TYPES(), y0 = new Date(new Date().getFullYear(), 0, 1).getTime();
    const yr = R.filter(function (r) { return (r.when || r.created) >= y0 && r.status !== "cancel"; });
    const accL = yr.filter(function (r) { return isAcc(r) && r.leave; }), accN = yr.filter(function (r) { return isAcc(r) && !r.leave; });
    const days = yr.reduce(function (s, r) { return s + (isAcc(r) ? Number(r.daysLost) || 0 : 0); }, 0);
    const lastLeave = R.filter(function (r) { return isAcc(r) && r.leave && r.status !== "cancel"; }).map(function (r) { return r.when || r.created; }).sort(function (a, b) { return b - a; })[0];
    const since = lastLeave ? Math.floor((Date.now() - lastLeave) / DAY) : null;
    const hht = S().hht || {}, hY = Object.keys(hht).filter(function (k) { return k >= ym(y0); }).reduce(function (s, k) { return s + (Number(hht[k]) || 0); }, 0);
    const tf = hY ? accL.length * 1e6 / hY : null, tg = hY ? days * 1e6 / hY : null;
    const open = R.filter(isOpen), late = open.filter(function (r) { return dueState(r) === "late"; }), catP = R.filter(catLate);
    const acts = []; R.forEach(function (r) { Object.keys(r.actions || {}).forEach(function (k) { const a = r.actions[k]; if (!a.done) acts.push({ r: r, a: a }); }); });
    const actLate = acts.filter(function (x) { return x.a.due && x.a.due < new Date().toISOString().slice(0, 10); });
    const months = []; for (let i = 11; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); months.push(ym(d.getTime())); }
    const rows = months.map(function (m) { const rs = R.filter(function (r) { return ym(r.when || r.created || 0) === m && r.status !== "cancel"; }); return { n: monLabel(m), a: rs.filter(isAcc).length, q: rs.filter(function (r) { return r.type === "near" || r.type === "unsafe"; }).length, e: rs.filter(function (r) { return r.type === "env"; }).length }; });
    const tile = function (ic, val, lbl, cls, sub) { return '<div class="st-tile' + (cls ? " " + cls : "") + '"><span class="st-ti">' + IC(ic, 18) + "</span><b>" + val + "</b><span>" + esc(lbl) + "</span>" + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</div>"; };
    const byType = {}; open.forEach(function (r) { byType[r.type] = (byType[r.type] || 0) + 1; });
    v.innerHTML = '<div class="st-wrap"><div class="st-tiles">' +
      tile("clock", since == null ? "–" : nf(since), L("days without lost-time accident", "dias sem acidente com afastamento"), since != null && since < 30 ? "bad" : "good") +
      tile("alert", nf(accL.length), L("lost-time accidents (year)", "acidentes com afastamento (ano)"), accL.length ? "bad" : "", nf(accN.length) + L(" without lost time", " sem afastamento")) +
      tile("calendar", nf(days), L("days lost (year)", "dias perdidos (ano)")) +
      tile("trend", tf == null ? "–" : nf(tf, 2), L("frequency rate (FR)", "taxa de frequência (TF)"), "", tg == null ? L("enter the man-hours in Settings", "informe as horas-homem em Configurações") : "TG " + nf(tg, 0)) +
      tile("bell", nf(yr.filter(function (r) { return r.type === "near" || r.type === "unsafe"; }).length), L("near misses and unsafe acts (year)", "quase-acidentes e atos inseguros (ano)")) +
      tile("kb", nf(open.length), L("open records", "registros abertos"), late.length ? "warn" : "", late.length ? nf(late.length) + L(" past the deadline", " fora do prazo") : "") +
      tile("send", nf(catP.length), L("CAT overdue", "CAT em atraso"), catP.length ? "bad" : "", L("work accident report (Law 8.213/91)", "comunicação de acidente (Lei 8.213/91)")) +
      tile("task", nf(acts.length), L("open actions", "ações abertas"), actLate.length ? "warn" : "", actLate.length ? nf(actLate.length) + L(" late", " atrasadas") : "") + "</div>" +
      '<div class="st-grid2"><section class="st-card"><h3>' + esc(L("Last 12 months", "Últimos 12 meses")) + '</h3><div class="st-scroll">' + bars(rows, [{ k: "a", n: L("Accidents and diseases", "Acidentes e doenças"), c: "#e34948" }, { k: "q", n: L("Near misses / unsafe", "Quase-acidentes / inseguros"), c: "#eda100" }, { k: "e", n: L("Environmental", "Ambientais"), c: "#1baf7a" }]) + "</div></section>" +
      '<section class="st-card"><h3>' + esc(L("Open by type", "Abertos por tipo")) + "</h3>" + (Object.keys(byType).length ? '<div class="st-hbars">' + Object.keys(byType).sort(function (a, b) { return byType[b] - byType[a]; }).map(function (k) { const T = TY[k] || {}, mx = Math.max.apply(null, Object.keys(byType).map(function (x) { return byType[x]; })); return '<div><span>' + esc(T.n || k) + '</span><i style="width:' + Math.max(4, byType[k] / mx * 100) + "%;background:" + (T.c || "#8a94a6") + '"></i><b>' + byType[k] + "</b></div>"; }).join("") + "</div>" : '<p class="muted small">' + esc(L("Nothing open.", "Nada em aberto.")) + "</p>") +
      (catP.length || late.length ? '<h3 class="st-h3">' + esc(L("Needs attention", "Requer atenção")) + '</h3><ul class="st-att">' + catP.map(function (r) { return '<li data-open="' + r.id + '"><b>' + esc(r.key || "") + "</b> " + esc(r.title) + ' <span class="st-chip bad">' + esc(L("CAT overdue", "CAT em atraso")) + "</span></li>"; }).join("") + late.filter(function (r) { return catP.indexOf(r) < 0; }).map(function (r) { return '<li data-open="' + r.id + '"><b>' + esc(r.key || "") + "</b> " + esc(r.title) + ' <span class="st-chip warn">' + esc(L("past the deadline", "fora do prazo")) + "</span></li>"; }).join("") + "</ul>" : "") + "</section></div>" +
      kpiStrip() + "</div>";
    bindOpen(v);
  }
  function kpiStrip() {
    const cards = allKpis().slice(0, 6); if (!cards.length) return "";
    return '<section class="st-card"><div class="st-head2"><h3>' + esc(L("Indicators of the plannings", "Indicadores dos planejamentos")) + '</h3><button class="pl-btn sm" data-goto="kpi">' + esc(L("See all", "Ver todos")) + '</button></div><div class="st-kpis">' + cards.map(kpiCard).join("") + "</div></section>";
  }
  function bindOpen(v) {
    v.querySelectorAll("[data-open]").forEach(function (x) { x.onclick = function () { drawer(x.dataset.open); }; });
    v.querySelectorAll("[data-goto]").forEach(function (x) { x.onclick = function () { view = x.dataset.goto; render(); }; });
  }

  /* ---------------- list & board ---------------- */
  function filtered() {
    const q = filter.q.toLowerCase();
    return recs().filter(function (r) {
      if (filter.type && r.type !== filter.type) return false;
      if (filter.status === "open" && !isOpen(r)) return false;
      if (filter.status && filter.status !== "open" && r.status !== filter.status) return false;
      if (q && (r.title || "").toLowerCase().indexOf(q) < 0 && (r.key || "").toLowerCase().indexOf(q) < 0 && (r.person || "").toLowerCase().indexOf(q) < 0 && (r.place || "").toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function bar() {
    const TY = TYPES(), G = GROUPS();
    return '<div class="st-bar"><input type="search" id="stQ" placeholder="' + esc(L("Search key, title, person or place", "Pesquisar chave, título, pessoa ou local")) + '" value="' + esc(filter.q) + '"><select id="stT"><option value="">' + esc(L("All types", "Todos os tipos")) + "</option>" +
      Object.keys(G).map(function (g) { return '<optgroup label="' + esc(G[g]) + '">' + Object.keys(TY).filter(function (k) { return TY[k].g === g; }).map(function (k) { return opt(k, TY[k].n, filter.type); }).join("") + "</optgroup>"; }).join("") + "</select>" +
      '<select id="stS">' + opt("open", L("Open", "Abertos"), filter.status) + opt("", L("All", "Todos"), filter.status) + STATUSES().map(function (s) { return opt(s.id, s.n, filter.status); }).join("") + "</select></div>";
  }
  function bindBar(v, redraw) {
    const q = v.querySelector("#stQ"); q.oninput = function () { filter.q = q.value; redraw(true); };
    v.querySelector("#stT").onchange = function (e) { filter.type = e.target.value; redraw(); };
    v.querySelector("#stS").onchange = function (e) { filter.status = e.target.value; redraw(); };
  }
  function chips(r) {
    const T = TYPES()[r.type] || {}, st = STATUSES().find(function (s) { return s.id === r.status; }) || STATUSES()[0], ds = dueState(r);
    return '<span class="st-type" style="--c:' + (T.c || "#8a94a6") + '">' + IC(T.ic || "kb", 13) + " " + esc(T.n || r.type) + "</span>" +
      '<span class="st-chip" style="--c:' + st.c + '">' + esc(st.n) + "</span>" +
      (r.severity && T.sev ? '<span class="st-chip sev-' + r.severity + '">' + esc((SEV().find(function (x) { return x[0] === r.severity; }) || ["", ""])[1]) + "</span>" : "") +
      (r.leave ? '<span class="st-chip bad">' + esc(L("lost time", "com afastamento")) + (r.daysLost ? " · " + r.daysLost + "d" : "") + "</span>" : "") +
      (catLate(r) ? '<span class="st-chip bad">' + esc(L("CAT overdue", "CAT em atraso")) + "</span>" : (catDue(r) && !(r.cat && r.cat.num) ? '<span class="st-chip warn">CAT ' + esc(L("until ", "até ")) + fmtD(catDue(r)) + "</span>" : "")) +
      (ds === "late" ? '<span class="st-chip bad">' + esc(L("past the deadline", "fora do prazo")) + "</span>" : ds === "soon" ? '<span class="st-chip warn">' + esc(L("due ", "prazo ")) + fmtD(r.due) + "</span>" : "");
  }
  function listView(v) {
    const draw = function (keep) {
      const rs = filtered();
      const body = rs.length ? '<div class="st-list">' + rs.map(function (r) {
        return '<button class="st-row" data-open="' + r.id + '"><span class="st-key">' + esc(r.key || "") + '</span><span class="st-main"><b>' + esc(r.title) + '</b><span class="st-chips">' + chips(r) + '</span></span><span class="st-meta">' + esc(fmtDT(r.when || r.created)) + (r.place ? "<br>" + esc(r.place) : "") + (r.owner ? "<br>" + esc(who(r.owner)) : "") + "</span></button>";
      }).join("") + "</div>" : '<div class="st-empty">' + IC("kb", 26) + "<p>" + esc(L("No records with these filters.", "Nenhum registro com esses filtros.")) + '</p><button class="pl-btn primary" id="stNew2">' + esc(L("Register the first one", "Registrar o primeiro")) + "</button></div>";
      if (keep && v.querySelector(".st-body")) { v.querySelector(".st-body").innerHTML = body; } else { v.innerHTML = '<div class="st-wrap">' + bar() + '<div class="st-body">' + body + "</div></div>"; bindBar(v, draw); }
      bindOpen(v); const n2 = v.querySelector("#stNew2"); if (n2) n2.onclick = function () { newDialog(); };
    };
    draw();
  }
  function boardView(v) {
    const draw = function (keep) {
      const rs = filtered().concat(filter.status === "open" ? [] : []), cols = STATUSES().filter(function (s) { return s.id !== "cancel"; });
      const all = filter.status === "open" ? recs().filter(function (r) { return (!filter.type || r.type === filter.type) && r.status !== "cancel" && (r.status !== "done" || (r.closedAt || 0) > Date.now() - 30 * DAY); }) : rs;
      const body = '<div class="st-kb">' + cols.map(function (c) {
        const its = all.filter(function (r) { return (r.status || "new") === c.id && (!filter.q || (r.title || "").toLowerCase().indexOf(filter.q.toLowerCase()) >= 0); });
        return '<section class="st-col" data-st="' + c.id + '"><header style="--c:' + c.c + '"><b>' + esc(c.n) + "</b><span>" + its.length + '</span></header><div class="st-cards">' + its.map(function (r) { const T = TYPES()[r.type] || {}; return '<article class="st-kc" draggable="true" data-id="' + r.id + '" data-open="' + r.id + '" style="--c:' + (T.c || "#8a94a6") + '"><span class="st-key">' + esc(r.key || "") + "</span><b>" + esc(r.title) + '</b><span class="st-chips">' + chips(r).replace(/<span class="st-chip" style[^>]*>[^<]*<\/span>/, "") + "</span>" + (r.owner ? '<small class="muted">' + esc(who(r.owner)) + "</small>" : "") + "</article>"; }).join("") + "</div></section>";
      }).join("") + "</div>" + (filter.status === "open" ? '<p class="muted small">' + esc(L("“Closed” shows the last 30 days.", "“Concluída” mostra os últimos 30 dias.")) + "</p>" : "");
      if (keep && v.querySelector(".st-body")) v.querySelector(".st-body").innerHTML = body; else { v.innerHTML = '<div class="st-wrap">' + bar() + '<div class="st-body">' + body + "</div></div>"; bindBar(v, draw); }
      bindOpen(v);
      let drag = null;
      v.querySelectorAll(".st-kc").forEach(function (c) { c.ondragstart = function (e) { drag = c.dataset.id; e.dataTransfer.setData("text/plain", drag); }; });
      v.querySelectorAll(".st-col").forEach(function (col) {
        col.ondragover = function (e) { e.preventDefault(); col.classList.add("over"); };
        col.ondragleave = function () { col.classList.remove("over"); };
        col.ondrop = function (e) { e.preventDefault(); col.classList.remove("over"); const id = drag || e.dataTransfer.getData("text/plain"); if (id) setStatus(id, col.dataset.st); };
      });
    };
    draw();
  }
  function setStatus(id, st) {
    const r = data.records[id]; if (!r || r.status === st) return;
    const u = { status: st, updated: TS() };
    if (st === "done" || st === "cancel") u.closedAt = TS(); else if (r.closedAt) u.closedAt = null;
    if (st === "done" && TYPES()[r.type] && TYPES()[r.type].cat && !(r.cat && r.cat.num)) toast(L("Remember: the CAT number is still empty.", "Atenção: o número da CAT ainda está vazio."));
    return sref("records/" + id).update(u).catch(fail);
  }

  /* ---------------- create & edit ---------------- */
  function newDialog(preType) {
    const TY = TYPES(), G = GROUPS();
    modal("<h2>" + IC("plus", 18) + " " + esc(L("Register", "Registrar")) + '</h2><p class="muted small">' + esc(L("Choose what happened or what is needed.", "Escolha o que aconteceu ou o que é necessário.")) + "</p>" +
      Object.keys(G).map(function (g) { return '<h3 class="st-h3">' + esc(G[g]) + '</h3><div class="st-types">' + Object.keys(TY).filter(function (k) { return TY[k].g === g; }).map(function (k) { return '<button class="st-tpick" data-t="' + k + '" style="--c:' + TY[k].c + '"><span>' + IC(TY[k].ic, 18) + "</span><b>" + esc(TY[k].n) + "</b><small>" + esc(TY[k].d) + "</small></button>"; }).join("") + "</div>"; }).join("") +
      '<div class="pl-row-end"><button class="pl-btn" data-close>' + esc(L("Cancel", "Cancelar")) + "</button></div>", function (box, close) {
      box.querySelector(".pl-card").classList.add("wide");
      box.querySelectorAll("[data-t]").forEach(function (b) { b.onclick = function () { close(); recDialog(null, b.dataset.t); }; });
    });
    if (preType) { document.querySelector(".pl-modal:last-child").remove(); recDialog(null, preType); }
  }
  function fieldsHtml(r) {
    const T = TYPES()[r.type] || {}, places = S().places || [], ppl = members();
    const sevSel = T.sev ? "<label>" + esc(L("Severity", "Gravidade")) + '<select name="severity">' + SEV().map(function (x) { return opt(x[0], x[1], r.severity || "low"); }).join("") + "</select></label>" : "";
    let h = '<label>' + esc(L("Title", "Título")) + '<input name="title" required maxlength="120" value="' + esc(r.title || "") + '"></label>' +
      '<div class="pl-2"><label>' + esc(r.type === "exam" || r.type === "epi" || r.type === "improve" ? L("Date", "Data") : L("When it happened", "Quando aconteceu")) + '<input type="datetime-local" name="when" value="' + toLocal(r.when || Date.now()) + '"></label>' +
      "<label>" + esc(L("Place / sector", "Local / setor")) + '<input name="place" list="stPlaces" maxlength="80" value="' + esc(r.place || "") + '"><datalist id="stPlaces">' + places.map(function (p) { return '<option value="' + esc(p) + '">'; }).join("") + "</datalist></label></div>" +
      (r.type === "improve" || r.type === "inspection" || r.type === "env" ? "" : '<div class="pl-2"><label>' + esc(L("Person involved", "Pessoa envolvida")) + '<input name="person" maxlength="80" value="' + esc(r.person || "") + '"></label><label>' + esc(L("Job / role", "Função")) + '<input name="personRole" maxlength="60" value="' + esc(r.personRole || "") + '"></label></div>') +
      (sevSel ? '<div class="pl-2">' + sevSel + (T.cat ? '<label class="chk st-leave"><input type="checkbox" name="leave"' + (r.leave ? " checked" : "") + "> " + esc(L("With lost time (absence)", "Com afastamento")) + "</label>" : "<span></span>") + "</div>" : "") +
      (T.cat || r.type === "leave" ? '<div class="pl-2"><label>' + esc(L("Days lost / away", "Dias perdidos / afastado")) + '<input type="number" min="0" name="daysLost" value="' + esc(r.daysLost == null ? "" : r.daysLost) + '"></label><span></span></div>' : "") +
      (T.cat ? '<fieldset class="st-fs"><legend>CAT – ' + esc(L("work accident report", "comunicação de acidente de trabalho")) + '</legend><div class="pl-2"><label>' + esc(L("CAT number", "Número da CAT")) + '<input name="catNum" maxlength="40" value="' + esc((r.cat || {}).num || "") + '"></label><label>' + esc(L("Issued on", "Emitida em")) + '<input type="date" name="catDate" value="' + esc((r.cat || {}).date || "") + '"></label></div><p class="muted small">' + esc(L("Legal deadline: first business day after the accident; immediately in case of death (Law 8.213/91, art. 22). Also report it to eSocial (S-2210).", "Prazo legal: até o 1º dia útil seguinte ao acidente; imediato em caso de óbito (Lei 8.213/91, art. 22). Informar também ao eSocial (S-2210).")) + "</p></fieldset>" : "") +
      (r.type === "exam" ? '<div class="pl-3"><label>' + esc(L("Exam", "Exame")) + '<select name="examKind">' + EXAMS().map(function (x) { return opt(x[0], x[1], (r.exam || {}).kind || "periodic"); }).join("") + "</select></label><label>" + esc(L("Scheduled for", "Agendado para")) + '<input type="date" name="examDate" value="' + esc((r.exam || {}).date || "") + '"></label><label>' + esc(L("Result (ASO)", "Resultado (ASO)")) + '<select name="examResult"><option value="">—</option>' + RESULTS().map(function (x) { return opt(x[0], x[1], (r.exam || {}).result || ""); }).join("") + "</select></label></div>" : "") +
      (r.type === "epi" ? '<div class="pl-3"><label>' + esc(L("Equipment", "Equipamento")) + '<input name="epiItem" maxlength="80" value="' + esc((r.epi || {}).item || "") + '" placeholder="' + esc(L("e.g. safety boots, gloves, harness", "ex.: botina, luvas, cinto paraquedista")) + '"></label><label>' + esc(L("Quantity", "Quantidade")) + '<input type="number" min="1" name="epiQty" value="' + esc((r.epi || {}).qty || 1) + '"></label><label>' + esc(L("Size / CA", "Tamanho / CA")) + '<input name="epiSize" maxlength="30" value="' + esc((r.epi || {}).size || "") + '"></label></div>' : "") +
      "<label>" + esc(L("Description", "Descrição")) + '<textarea name="desc" rows="3" maxlength="2000">' + esc(r.desc || "") + "</textarea></label>" +
      '<div class="pl-2"><label>' + esc(L("Responsible", "Responsável")) + '<select name="owner"><option value="">—</option>' + Object.keys(ppl).map(function (k) { return opt(ppl[k].email, ppl[k].name || ppl[k].email, r.owner || ""); }).join("") + "</select></label><label>" + esc(L("Deadline", "Prazo")) + '<input type="date" name="due" value="' + esc(r.due ? new Date(r.due - new Date(r.due).getTimezoneOffset() * 60000).toISOString().slice(0, 10) : "") + '"></label></div>';
    return h;
  }
  function readFields(f, r) {
    const T = TYPES()[r.type] || {}, o = { title: f.title.value.trim(), when: f.when.value ? new Date(f.when.value).getTime() : Date.now(), place: f.place.value.trim() || null, desc: f.desc.value.trim() || null, owner: f.owner.value || null, due: f.due.value ? new Date(f.due.value + "T23:59:00").getTime() : null };
    if (f.person) { o.person = f.person.value.trim() || null; o.personRole = f.personRole.value.trim() || null; }
    if (f.severity) o.severity = f.severity.value;
    if (f.leave) o.leave = f.leave.checked || null;
    if (f.daysLost) o.daysLost = f.daysLost.value === "" ? null : Number(f.daysLost.value);
    if (T.cat) o.cat = f.catNum.value.trim() || f.catDate.value ? { num: f.catNum.value.trim() || null, date: f.catDate.value || null } : null;
    if (r.type === "exam") o.exam = { kind: f.examKind.value, date: f.examDate.value || null, result: f.examResult.value || null };
    if (r.type === "epi") o.epi = { item: f.epiItem.value.trim() || null, qty: Number(f.epiQty.value) || 1, size: f.epiSize.value.trim() || null };
    return o;
  }
  function recDialog(id, type) {
    const TY = TYPES(), T = TY[type];
    const r = { type: type, when: Date.now() };
    modal("<h2>" + '<span class="st-type big" style="--c:' + T.c + '">' + IC(T.ic, 16) + "</span> " + esc(T.n) + '</h2><form class="pl-form" id="rcF">' + fieldsHtml(r) +
      '<div class="pl-row-end"><button type="button" class="pl-btn" data-close>' + esc(L("Cancel", "Cancelar")) + '</button><button class="pl-btn primary">' + esc(L("Register", "Registrar")) + "</button></div></form>", function (box, close) {
      box.querySelector(".pl-card").classList.add("wide");
      const f = box.querySelector("#rcF");
      f.onsubmit = function (e) {
        e.preventDefault();
        const o = readFields(f, r); if (!o.title) return;
        if (!o.due) o.due = o.when + (T.req ? Number(S().reqDays) || 5 : Number(S().invDays) || 7) * DAY;
        const btn = f.querySelector(".primary"); btn.disabled = true;
        sref("counter").transaction(function (n) { return (n || 0) + 1; }).then(function (res) {
          const rid = db.ref().push().key, rec = Object.assign({ type: type, status: "new", key: "SST-" + String(res.snapshot.val()).padStart(4, "0"), created: TS(), by: me.email, updated: TS() }, o);
          Object.keys(rec).forEach(function (k) { if (rec[k] === null || rec[k] === undefined) delete rec[k]; });
          openRec = rid;
          return sref("records/" + rid).set(rec).then(function () { close(); toast(rec.key + " " + L("registered", "registrado") + (TY[type].cat ? " · " + L("CAT due ", "CAT até ") + fmtD(catDue(rec)) : "")); drawer(rid); });
        }).catch(function (e2) { btn.disabled = false; fail(e2); });
      };
    });
  }

  /* ---------------- drawer ---------------- */
  function closeDrawer() { const d = document.getElementById("stDrawer"); if (d) d.remove(); openRec = null; }
  function drawer(id) {
    const r0 = data.records && data.records[id]; if (!r0) { openRec = id; return; }
    openRec = id;
    const r = Object.assign({ id: id }, r0), T = TYPES()[r.type] || {}, acts = Object.keys(r.actions || {}).map(function (k) { return Object.assign({ id: k }, r.actions[k]); }).sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
    let d = document.getElementById("stDrawer");
    const keep = d && d.dataset.id === id && d.querySelector("form.dirty");
    if (keep) { drawActions(d, r, acts); return; }
    if (!d) { d = document.createElement("aside"); d.id = "stDrawer"; d.className = "pl-drawer st-drawer"; document.body.appendChild(d); }
    d.dataset.id = id;
    d.innerHTML = '<header><span class="st-type" style="--c:' + (T.c || "#8a94a6") + '">' + IC(T.ic || "kb", 14) + " " + esc(T.n || r.type) + '</span><span class="tk">' + esc(r.key || "") + '</span><span class="sp"></span><button class="pl-btn icon" id="sdX" title="' + esc(L("Close", "Fechar")) + '">✕</button></header>' +
      '<div class="st-status">' + STATUSES().map(function (s) { return '<button data-st="' + s.id + '" class="' + ((r.status || "new") === s.id ? "on" : "") + '" style="--c:' + s.c + '">' + esc(s.n) + "</button>"; }).join("") + "</div>" +
      '<div class="st-chips">' + chips(r) + "</div>" +
      '<form class="pl-form" id="sdF">' + fieldsHtml(r) +
      (r.type === "acc" || r.type === "commute" || r.type === "near" || r.type === "disease" || r.type === "env" || r.type === "inspection" || r.type === "unsafe" ? "<label>" + esc(L("Root cause analysis (5 whys, Ishikawa)", "Análise de causa raiz (5 porquês, Ishikawa)")) + '<textarea name="rootCause" rows="3" maxlength="2000">' + esc(r.rootCause || "") + "</textarea></label>" : "") +
      '<div class="d-actions"><button type="button" class="pl-btn" id="sdCancel" disabled>' + esc(L("Cancel changes", "Cancelar alterações")) + '</button><button class="pl-btn primary" id="sdSave" disabled>' + esc(L("Save", "Salvar")) + "</button></div></form>" +
      '<div class="st-acts" id="sdActs"></div>' +
      '<p class="muted small">' + esc(L("Registered by ", "Registrado por ")) + esc(who(r.by)) + " · " + esc(fmtDT(r.created)) + (r.closedAt ? " · " + esc(L("closed ", "encerrado ")) + esc(fmtDT(r.closedAt)) : "") + '</p><button class="pl-btn ghost danger sm" id="sdDel">' + esc(L("Delete record", "Excluir registro")) + "</button>";
    d.querySelector("#sdX").onclick = closeDrawer;
    d.querySelectorAll(".st-status [data-st]").forEach(function (b) { b.onclick = function () { setStatus(id, b.dataset.st); }; });
    const f = d.querySelector("#sdF"), sv = d.querySelector("#sdSave"), cc = d.querySelector("#sdCancel");
    f.addEventListener("input", function () { f.classList.add("dirty"); sv.disabled = cc.disabled = false; });
    f.addEventListener("change", function () { f.classList.add("dirty"); sv.disabled = cc.disabled = false; });
    cc.onclick = function () { f.classList.remove("dirty"); d.dataset.id = ""; drawer(id); };
    f.onsubmit = function (e) {
      e.preventDefault(); const o = readFields(f, r); if (!o.title) return;
      if (f.rootCause) o.rootCause = f.rootCause.value.trim() || null;
      o.updated = TS(); sv.disabled = true;
      sref("records/" + id).update(o).then(function () { f.classList.remove("dirty"); d.dataset.id = ""; toast(L("Saved", "Salvo")); drawer(id); }, fail);
    };
    d.querySelector("#sdDel").onclick = function () {
      modal("<h2>" + esc(L("Delete ", "Excluir ")) + esc(r.key || "") + '?</h2><p class="muted">' + esc(L("This cannot be undone.", "Isso não pode ser desfeito.")) + '</p><div class="pl-row-end"><button class="pl-btn" data-close>' + esc(L("Cancel", "Cancelar")) + '</button><button class="pl-btn primary danger" id="dlOk">' + esc(L("Delete", "Excluir")) + "</button></div>", function (box, close) {
        box.querySelector("#dlOk").onclick = function () { sref("records/" + id).remove().then(function () { close(); closeDrawer(); toast(L("Deleted", "Excluído")); }, fail); };
      });
    };
    drawActions(d, r, acts);
  }
  function drawActions(d, r, acts) {
    const box = d.querySelector("#sdActs"), ppl = members(), today = new Date().toISOString().slice(0, 10);
    box.innerHTML = '<div class="st-head2"><b>' + IC("task", 15) + " " + esc(L("Action plan", "Plano de ação")) + " (" + acts.filter(function (a) { return a.done; }).length + "/" + acts.length + ")</b></div>" +
      (acts.length ? acts.map(function (a) {
        const p = a.plan && plans.find(function (x) { return x.id === a.plan.pid; });
        return '<div class="st-act' + (a.done ? " done" : "") + (!a.done && a.due && a.due < today ? " late" : "") + '"><label class="chk"><input type="checkbox" data-done="' + a.id + '"' + (a.done ? " checked" : "") + "> <span>" + esc(a.t) + '</span></label><small class="muted">' + esc([a.owner ? who(a.owner) : "", a.due ? L("until ", "até ") + a.due.split("-").reverse().join("/") : ""].filter(Boolean).join(" · ")) + "</small>" +
          (a.plan ? '<a class="st-plink" href="../planning/?id=' + encodeURIComponent(a.plan.pid) + "&item=" + encodeURIComponent(a.plan.item) + '">' + IC("planning", 13) + " " + esc(p ? p.title : L("planning", "planejamento")) + "</a>" : (plans.length ? '<button class="link sm" data-toplan="' + a.id + '">' + IC("planning", 13) + " " + esc(L("Take to a planning", "Levar para um planejamento")) + "</button>" : "")) +
          '<button class="link sm danger" data-adel="' + a.id + '">' + esc(L("remove", "remover")) + "</button></div>";
      }).join("") : '<p class="muted small">' + esc(L("No actions yet. Add what will be done to avoid it happening again.", "Nenhuma ação ainda. Adicione o que será feito para que não aconteça de novo.")) + "</p>") +
      '<form class="st-addact" id="sdAct"><input name="t" maxlength="200" required placeholder="' + esc(L("New action – e.g. install guard on the press", "Nova ação – ex.: instalar proteção na prensa")) + '"><select name="owner"><option value="">' + esc(L("Owner", "Responsável")) + "</option>" + Object.keys(ppl).map(function (k) { return opt(ppl[k].email, ppl[k].name || ppl[k].email, ""); }).join("") + '</select><input type="date" name="due"><button class="pl-btn sm primary">' + esc(L("Add", "Adicionar")) + "</button></form>";
    const id = r.id;
    box.querySelectorAll("[data-done]").forEach(function (c) { c.onchange = function () { sref("records/" + id + "/actions/" + c.dataset.done + "/done").set(c.checked || null).catch(fail); }; });
    box.querySelectorAll("[data-adel]").forEach(function (c) { c.onclick = function () { sref("records/" + id + "/actions/" + c.dataset.adel).remove().catch(fail); }; });
    box.querySelectorAll("[data-toplan]").forEach(function (c) { c.onclick = function () { toPlanning(r, c.dataset.toplan); }; });
    const f = box.querySelector("#sdAct");
    f.onsubmit = function (e) { e.preventDefault(); const a = { t: f.t.value.trim(), owner: f.owner.value || null, due: f.due.value || null, at: Date.now(), by: me.email }; if (!a.t) return; Object.keys(a).forEach(function (k) { if (a[k] === null) delete a[k]; }); sref("records/" + id + "/actions/" + db.ref().push().key).set(a).catch(fail); };
  }
  function toPlanning(r, aid) {
    const a = (r.actions || {})[aid]; if (!a) return;
    modal("<h2>" + esc(L("Take the action to a planning", "Levar a ação para um planejamento")) + '</h2><form class="pl-form" id="tpF"><label>' + esc(L("Planning", "Planejamento")) + '<select name="p">' + plans.map(function (p) { return opt(p.id, p.title, ""); }).join("") + '</select></label><p class="muted small">' + esc(L("Creates a task in the planning with a link back to ", "Cria uma tarefa no planejamento com link de volta para ")) + esc(r.key) + '.</p><div class="pl-row-end"><button type="button" class="pl-btn" data-close>' + esc(L("Cancel", "Cancelar")) + '</button><button class="pl-btn primary">' + esc(L("Create task", "Criar tarefa")) + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#tpF");
      f.onsubmit = function (e) {
        e.preventDefault(); const pid = f.p.value, P = plans.find(function (x) { return x.id === pid; }) || {};
        const st = ((kpiCache[pid] || {}).settings || {}).statuses || ((window.PLAN_METHODS || {})[P.method] || {}).statuses || [{ id: "todo" }];
        const first = (st.find(function (s) { return s.cat === "todo" && s.stage !== "up"; }) || st[0]).id, prefix = ((kpiCache[pid] || {}).settings || {}).prefix || "PLN";
        db.ref("planning/" + pid + "/data/settings/seq").transaction(function (n) { return (n || 0) + 1; }).then(function (res) {
          const iid = db.ref().push().key, it = { type: "task", title: a.t, status: first, order: Date.now(), created: TS(), by: me.email, key: prefix + "-" + res.snapshot.val(), desc: L("Action of ", "Ação de ") + r.key + " – " + r.title, src: { sst: WS, rec: r.id, key: r.key } };
          if (a.owner) it.assignee = a.owner; if (a.due) it.end = a.due;
          return db.ref("planning/" + pid + "/data/items/" + iid).set(it).then(function () { return sref("records/" + r.id + "/actions/" + aid + "/plan").set({ pid: pid, item: iid }); });
        }).then(function () { close(); toast(L("Task created in the planning", "Tarefa criada no planejamento")); }, fail);
      };
    });
  }

  /* ---------------- plannings & indicators ---------------- */
  function plansView(v) {
    const APL = (window.PLAN_AREA_PLANS || []).filter(function (p) { return p.area === "ohs" || p.area === "she"; }), G = GROUPS(), M = window.PLAN_METHODS || {};
    v.innerHTML = '<div class="st-wrap"><section class="st-card"><h3>' + esc(L("Plannings of the module", "Planejamentos do módulo")) + " (" + plans.length + ")</h3>" +
      (plans.length ? '<div class="st-plist">' + plans.map(function (p) { const c = kpiCache[p.id] || {}; return '<a class="st-prow" href="../planning/?id=' + encodeURIComponent(p.id) + '">' + (window.CMIcon3D ? window.CMIcon3D((M[p.method] || {}).icon || "planning", 30, p.method) : "") + "<span><b>" + esc(p.title) + "</b><small>" + esc((M[p.method] || {}).name || "") + " · " + (c.n || 0) + " " + esc(L("items", "itens")) + " · " + Object.keys(c.kpis || {}).length + " " + esc(L("indicators", "indicadores")) + "</small></span><span>→</span></a>"; }).join("") + "</div>" : '<p class="muted small">' + esc(L("No planning yet. Start from a template below.", "Nenhum planejamento ainda. Comece por um template abaixo.")) + "</p>") + "</section>" +
      '<section class="st-card"><h3>' + esc(L("Templates", "Templates")) + '</h3><p class="muted small">' + esc(L("Each template creates a planning with phases, tasks and the Indicators tab (own KPIs).", "Cada template cria um planejamento com fases, tarefas e a aba Indicadores (KPIs próprios).")) + "</p>" +
      Object.keys(G).map(function (g) { const ts = APL.filter(function (p) { return (p.sub || (p.area === "she" ? "she" : "health")) === g; }); return ts.length ? '<h3 class="st-h3">' + esc(G[g]) + '</h3><div class="st-tpls">' + ts.map(function (p) { return '<a class="st-tpl" href="../workspaces/?newplan=' + encodeURIComponent(p.id) + "&ws=" + encodeURIComponent(WS) + '"><span class="tpl-pv">' + (window.CMPlanPreview ? window.CMPlanPreview(p.method) : "") + "</span><b>" + esc(p.name) + "</b><small>" + esc(p.desc || "") + "</small></a>"; }).join("") + "</div>" : ""; }).join("") + "</section></div>";
  }
  function kVal(k, v) { if (!v || v.a === undefined || v.a === null || v.a === "") return null; const a = Number(v.a), b = Number(v.b); if (k.kind === "percent") return b ? a / b * 100 : null; if (k.kind === "rate") return b ? a * (Number(k.factor) || 1) / b : null; return a; }
  function allKpis() {
    const out = [];
    plans.forEach(function (p) { const c = kpiCache[p.id] || {}; Object.keys(c.kpis || {}).forEach(function (k) { const K = c.kpis[k], vv = (c.kpiv || {})[k] || {}, ks = Object.keys(vv).sort(); let last = null, per = null; for (let i = ks.length - 1; i >= 0; i--) { const x = kVal(K, vv[ks[i]]); if (x !== null && isFinite(x)) { last = x; per = ks[i]; break; } } out.push({ p: p, k: K, last: last, per: per }); }); });
    return out;
  }
  function kpiCard(x) {
    const K = x.k, ok = x.last === null || K.target === undefined || K.target === "" ? null : K.dir === "down" ? x.last <= Number(K.target) : x.last >= Number(K.target);
    return '<a class="st-kpi" href="../planning/?id=' + encodeURIComponent(x.p.id) + '"><small>' + esc(x.p.title) + "</small><b>" + esc(K.name) + '</b><span class="st-kv">' + (x.last === null ? "–" : nf(x.last, K.dec || 0)) + " <i>" + esc(K.unit || "") + "</i></span>" +
      (ok === null ? "" : '<span class="st-chip ' + (ok ? "good" : "bad") + '">' + (ok ? "✓ " + esc(L("On target", "Na meta")) : "! " + esc(L("Off target", "Fora da meta"))) + "</span>") + '<small class="muted">' + esc(L("Target ", "Meta ")) + (K.target !== undefined && K.target !== "" ? (K.dir === "down" ? "≤ " : "≥ ") + nf(K.target, K.dec || 0) : "–") + (x.per ? " · " + monLabel(x.per) : "") + "</small></a>";
  }
  function kpiView(v) {
    const ks = allKpis();
    v.innerHTML = '<div class="st-wrap"><section class="st-card"><h3>' + esc(L("Indicators", "Indicadores")) + '</h3><p class="muted small">' + esc(L("Own indicators created in the plannings of the module (Indicators tab). The panel calculates FR and SR from the records and the man-hours in Settings.", "Indicadores próprios criados nos planejamentos do módulo (aba Indicadores). O painel calcula TF e TG pelos registros e pelas horas-homem de Configurações.")) + "</p>" +
      (ks.length ? '<div class="st-kpis">' + ks.map(kpiCard).join("") + "</div>" : '<p class="muted small">' + esc(L("No indicators yet. Open a planning of the module → Indicators → New indicator.", "Ainda não há indicadores. Abra um planejamento do módulo → Indicadores → Novo indicador.")) + "</p>") + "</section></div>";
  }

  /* ---------------- settings ---------------- */
  function cfgView(v) {
    const s = S(), hht = s.hht || {}, months = [];
    for (let i = 11; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); months.push(ym(d.getTime())); }
    v.innerHTML = '<div class="st-wrap"><form class="st-card pl-form" id="cfF"><h3>' + esc(L("Settings of the module", "Configurações do módulo")) + "</h3>" +
      "<label>" + esc(L("Places / sectors (one per line)", "Locais / setores (um por linha)")) + '<textarea name="places" rows="4">' + esc((s.places || []).join("\n")) + "</textarea></label>" +
      '<div class="pl-2"><label>' + esc(L("Investigation deadline (days)", "Prazo de investigação (dias)")) + '<input type="number" min="1" name="invDays" value="' + esc(s.invDays || 7) + '"></label><label>' + esc(L("Deadline for requests – PPE, exams, suggestions (days)", "Prazo das solicitações – EPI, exames, sugestões (dias)")) + '<input type="number" min="1" name="reqDays" value="' + esc(s.reqDays || 5) + '"></label></div>' +
      '<fieldset class="st-fs"><legend>' + esc(L("Man-hours worked per month (for FR and SR)", "Horas-homem trabalhadas por mês (para TF e TG)")) + '</legend><div class="st-hht">' + months.map(function (m) { return "<label>" + esc(monLabel(m)) + '<input type="number" min="0" step="any" name="h_' + m + '" value="' + esc(hht[m] == null ? "" : hht[m]) + '"></label>'; }).join("") + "</div></fieldset>" +
      '<div class="pl-row-end"><button class="pl-btn primary">' + esc(L("Save", "Salvar")) + "</button></div></form></div>";
    const f = v.querySelector("#cfF");
    f.onsubmit = function (e) {
      e.preventDefault();
      const u = { places: f.places.value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean), invDays: Number(f.invDays.value) || 7, reqDays: Number(f.reqDays.value) || 5, hht: Object.assign({}, hht) };
      months.forEach(function (m) { const x = f["h_" + m].value; if (x === "") delete u.hht[m]; else u.hht[m] = Number(x); });
      sref("settings").set(u).then(function () { toast(L("Settings saved", "Configurações salvas")); }, fail);
    };
  }

  start();
})();
