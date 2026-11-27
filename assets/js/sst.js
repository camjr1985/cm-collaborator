/* CM Collaborator – "Saúde" module (Work health & safety centre + Work safety and SHE templates).
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

  let db, me, MEK, isAdm = false, WS = "", wss = {}, data = {}, plans = [], kpiCache = {}, view = "panel", filter = { q: "", type: "", status: "open" }, openRec = null, openPerson = null, ref0 = null;

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
  const GROUPS = function () { return { health: L("Occupational health", "Saúde ocupacional"), safety: L("Work safety", "Segurança do trabalho"), she: "SHE" }; };
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
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { const m = document.querySelectorAll(".pl-modal"); if (m.length) m[m.length - 1].remove(); else { closeDrawer(); closePerson(); } } });
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
    if (!w) return gate(L("No workspace", "Nenhum workspace"), L("You are not a member of a workspace with the Health module yet.", "Você ainda não participa de um workspace com o módulo Saúde."));
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
    const T = { panel: L("Panel", "Painel"), list: L("Occurrences", "Ocorrências"), board: L("Board", "Quadro"), people: L("Employees", "Colaboradores"), due: L("Due dates", "Vencimentos"), abs: L("Absenteeism", "Absenteísmo"), plans: L("Plannings", "Planejamentos"), kpi: L("Indicators", "Indicadores"), cfg: L("Settings", "Configurações") };
    const list = wsList();
    if (!document.getElementById("sstView")) {
      app.innerHTML = '<header class="pl-top st-top"><a class="pl-back" href="../workspaces/" title="' + esc(L("My boards", "Meus quadros")) + '">←</a><span class="pl-logo">CM</span>' +
        '<div class="pl-title"><span class="pl-ws">' + (window.CMIcon3D ? window.CMIcon3D("sst", 16, "sst") : "") + " " + esc(L("Health · Work health & safety centre", "Saúde · Central de Saúde e Segurança do Trabalho")) + '</span><h1 id="stTitle"></h1></div>' +
        '<nav class="pl-tabs" id="stTabs"></nav><div class="pl-actions"><button class="pl-btn" id="stJg" title="' + esc(L("Step-by-step guide to structure health and safety", "Passo a passo para estruturar a saúde e segurança")) + '">' + IC("initiative", 16) + ' <span class="st-jgl">' + esc(L("Guided journey", "Jornada guiada")) + '</span> <span class="st-jgn" id="stJgN"></span></button><select id="stWs" class="st-ws" aria-label="Workspace"></select><button class="pl-btn primary" id="stNew">' + IC("plus", 16) + " " + esc(L("Register", "Registrar")) + "</button></div></header>" +
        '<div class="st-note">' + IC("lock", 14) + " " + esc(L("Health data is sensitive (LGPD): record only what the management needs – no diagnosis, ICD code or medical records here.", "Dados de saúde são sensíveis (LGPD): registre só o necessário para a gestão – sem diagnóstico, CID ou prontuário aqui.")) + '</div><main id="sstView" class="pl-view st-view"></main>';
      document.getElementById("stNew").onclick = function () { newDialog(); };
      document.getElementById("stJg").onclick = function () { const j = journeyTick(); if (j) j.show(); };
      document.getElementById("stWs").onchange = function (e) { closeDrawer(); openWs(e.target.value); };
    }
    document.getElementById("stTitle").textContent = (wss[WS] && wss[WS].info && wss[WS].info.name) || WS;
    document.getElementById("stWs").innerHTML = list.map(function (k) { return opt(k, (wss[k].info || {}).name || k, WS); }).join("");
    document.getElementById("stWs").hidden = list.length < 2;
    const tabs = document.getElementById("stTabs");
    tabs.innerHTML = Object.keys(T).map(function (k) { return '<button data-v="' + k + '" class="' + (k === view ? "on" : "") + '">' + esc(T[k]) + "</button>"; }).join("");
    tabs.querySelectorAll("[data-v]").forEach(function (b) { b.onclick = function () { view = b.dataset.v; render(); }; });
    seenView(view);
    renderView();
    journeyTick();
    if (openRec && data.records && data.records[openRec]) drawer(openRec);
    if (openPerson && data.people && data.people[openPerson]) personDrawer(openPerson);
    const qr = Q.get("rec"); if (qr && !render._rec && data.records && data.records[qr]) { render._rec = 1; drawer(qr); }
  }
  function renderView() {
    const v = document.getElementById("sstView"); if (!v) return;
    ({ panel: panel, list: listView, board: boardView, people: peopleView, due: dueView, abs: absView, plans: plansView, kpi: kpiView, cfg: cfgView })[view](v);
  }

  /* ---------------- guided journey (Jornada guiada) ---------------- */
  let jg = null, jgWs = "";
  function seenView(v) { try { const k = "cm:jg:sstv:" + WS, o = JSON.parse(localStorage.getItem(k) || "{}"); if (!o[v]) { o[v] = 1; localStorage.setItem(k, JSON.stringify(o)); } } catch (e) { /* ignore */ } }
  function seen(v) { try { return !!JSON.parse(localStorage.getItem("cm:jg:sstv:" + WS) || "{}")[v]; } catch (e) { return false; } }
  function go(v) { return function () { if (view !== v) { view = v; render(); } }; }
  const tab = function (v) { return "#stTabs [data-v=" + v + "]"; };
  function journeyItems() {
    const S0 = S(), P = people(), R = recs();
    const hasFile = P.some(function (p) { return Object.keys(p.exams || {}).length || Object.keys(p.trainings || {}).length; });
    return [
      { id: "base", t: L("Set up the base: sectors and man-hours", "Monte a base: setores e horas-homem"), d: L("List the places/sectors of the company and the man-hours worked per month. They feed the forms and the FR/SR rates.", "Liste os locais/setores da empresa e as horas-homem trabalhadas por mês. Eles alimentam os formulários e as taxas TF e TG."),
        done: !!((S0.places || []).length && Object.keys(S0.hht || {}).length),
        steps: [{ el: tab("cfg"), t: L("Open Settings", "Abra Configurações"), d: L("Click here – this is where the module is prepared.", "Clique aqui – é aqui que o módulo é preparado."), click: true },
          { before: go("cfg"), el: "#cfF textarea[name=places]", t: L("Places / sectors", "Locais / setores"), d: L("Type one per line: e.g. Production line 2, Maintenance, Warehouse.", "Digite um por linha: ex. Produção – linha 2, Manutenção, Almoxarifado.") },
          { before: go("cfg"), el: "#cfF .st-hht", t: L("Man-hours per month", "Horas-homem por mês"), d: L("Fill in the hours worked each month (from HR/payroll). The panel calculates FR and SR with them.", "Preencha as horas trabalhadas de cada mês (do RH/folha). O painel calcula TF e TG com elas.") },
          { before: go("cfg"), el: "#cfF .pl-row-end .primary", t: L("Save", "Salve"), d: L("Click Save. Step 1 is done.", "Clique em Salvar. O passo 1 fica concluído."), click: true }] },
      { id: "people", t: L("Register the employees", "Cadastre os colaboradores"), d: L("Paste the employee list from Excel (name; registration; job; sector; admission) or register one by one.", "Cole a lista de funcionários do Excel (nome; matrícula; função; setor; admissão) ou cadastre um a um."),
        done: P.length > 0,
        steps: [{ el: tab("people"), t: L("Open Employees", "Abra Colaboradores"), d: L("Click here.", "Clique aqui."), click: true },
          { before: go("people"), el: "#pImp", t: L("Paste the list", "Cole a lista"), d: L("Copy the columns from Excel and paste here – the system updates by registration number.", "Copie as colunas do Excel e cole aqui – o sistema atualiza pela matrícula."), click: true }] },
      { id: "file", t: L("Fill in exams, NR training and PPE", "Lance exames, treinamentos NR e EPI"), d: L("Open each employee's file and record the last ASO, the NR courses and the PPE delivered. The due dates are calculated automatically.", "Abra a ficha de cada colaborador e registre o último ASO, os cursos de NR e os EPIs entregues. Os vencimentos são calculados sozinhos."),
        done: hasFile,
        steps: [{ before: go("people"), el: "[data-person]", t: L("Open an employee", "Abra um colaborador"), d: L("Click on the name to open the file.", "Clique no nome para abrir a ficha."), click: true },
          { el: "#fEx", t: L("Occupational exam (ASO)", "Exame ocupacional (ASO)"), d: L("Choose the type, date and result. Tick S-2220 when sent to eSocial.", "Escolha o tipo, a data e o resultado. Marque S-2220 quando enviar ao eSocial.") },
          { el: "#fTr", t: L("NR training", "Treinamentos NR"), d: L("Pick the NR – the refresher period is filled in (e.g. NR-35 every 24 months).", "Escolha a NR – a reciclagem já vem preenchida (ex.: NR-35 a cada 24 meses).") },
          { el: "#fPp", t: "EPI", d: L("Record the PPE with its CA and the replacement period.", "Registre o EPI com o CA e o prazo de troca.") }] },
      { id: "plan", t: L("Create the annual planning", "Crie o planejamento anual"), d: L("Start with a template – PCMSO, Prevention and CIPA, Emergency and fire brigade, or SHE. It creates phases, tasks and indicators.", "Comece por um template – PCMSO, Prevenção e CIPA, Emergência e brigada, ou SHE. Ele cria fases, tarefas e indicadores."),
        done: plans.length > 0,
        steps: [{ el: tab("plans"), t: L("Open Plannings", "Abra Planejamentos"), d: L("Click here.", "Clique aqui."), click: true },
          { before: go("plans"), el: ".st-tpl", t: L("Choose a template", "Escolha um template"), d: L("Recommended start: Occupational health programme (PCMSO) or Prevention and CIPA. Click to create.", "Comece pelo Programa de saúde ocupacional (PCMSO) ou Prevenção e CIPA. Clique para criar.") }] },
      { id: "rec", t: L("Register the occurrences", "Registre as ocorrências"), d: L("Accidents, near misses, unsafe acts, exams, PPE requests and inspections – everything goes through Register.", "Acidentes, quase-acidentes, atos inseguros, exames, pedidos de EPI e inspeções – tudo entra por Registrar."),
        done: R.length > 0,
        steps: [{ el: "#stNew", t: L("Register", "Registrar"), d: L("Click here and choose what happened. For an accident, fill in the CAT – the legal deadline is the next working day.", "Clique aqui e escolha o que aconteceu. Em acidente, preencha a CAT – o prazo legal é o 1º dia útil seguinte."), click: true }] },
      { id: "treat", t: L("Investigate and treat", "Investigue e trate"), d: L("In each occurrence, record the root cause and an action plan. Follow it on the Board.", "Em cada ocorrência, registre a causa raiz e o plano de ação. Acompanhe pelo Quadro."),
        done: R.some(function (r) { return Object.keys(r.actions || {}).length; }),
        steps: [{ el: tab("list"), t: L("Open Occurrences", "Abra Ocorrências"), d: L("Click here.", "Clique aqui."), click: true },
          { before: go("list"), el: "[data-open]", t: L("Open an occurrence", "Abra uma ocorrência"), d: L("Fill in the root cause and add actions with owner and deadline. 'Take to a planning' sends the action to the annual plan.", "Preencha a causa raiz e adicione ações com responsável e prazo. 'Levar para um planejamento' manda a ação para o plano anual.") },
          { el: tab("board"), t: L("Board", "Quadro"), d: L("Drag the cards between the stages: Registered → Investigation → Action plan → Execution → Done.", "Arraste os cards entre as etapas: Registrada → Em investigação → Plano de ação → Em execução → Concluída.") }] },
      { id: "due", t: L("Call in what is due", "Convoque os vencimentos"), d: L("Every month, check the overdue and next-30-day exams, NR and PPE and export the call list.", "Todo mês, veja os exames, NRs e EPIs vencidos e dos próximos 30 dias e exporte a lista de convocação."),
        done: seen("due"),
        steps: [{ el: tab("due"), t: L("Open Due dates", "Abra Vencimentos"), d: L("Click here.", "Clique aqui."), click: true },
          { before: go("due"), el: "#dK", t: L("Filter", "Filtre"), d: L("Choose exams, training or PPE.", "Escolha exames, treinamentos ou EPI.") },
          { before: go("due"), el: "#dCsv", t: L("Call list", "Lista de convocação"), d: L("Export the CSV and send it to the leaders/clinic.", "Exporte o CSV e envie para as lideranças/clínica.") }] },
      { id: "kpi", t: L("Follow the panel and indicators", "Acompanhe o painel e os indicadores"), d: L("Days without accidents, FR/SR, CAT, overdue items and the KPIs of the plannings – the monthly SST meeting starts here.", "Dias sem acidente, TF/TG, CAT, itens vencidos e os KPIs dos planejamentos – a reunião mensal de SST começa aqui."),
        done: seen("kpi"),
        steps: [{ before: go("panel"), el: ".st-tiles", t: L("Panel", "Painel"), d: L("The red tiles need attention today.", "Os blocos em vermelho precisam de atenção hoje.") },
          { el: tab("kpi"), t: L("Indicators", "Indicadores"), d: L("Click here to see the KPIs created in the plannings.", "Clique aqui para ver os KPIs criados nos planejamentos."), click: true }] }
    ];
  }
  function journeyTick() {
    if (!window.CMTour || !WS) return null;
    const items = journeyItems(), n = items.filter(function (x) { return x.done; }).length;
    if (!jg || jgWs !== WS) {
      if (jg) jg.hide();
      jgWs = WS;
      const fresh = !people().length && !recs().length;
      jg = window.CMTour.journey({ key: "sst:" + WS + ":" + (MEK || ""), title: L("Guided journey · Health", "Jornada guiada · Saúde"), intro: L("Follow the steps to structure health and safety in the platform. Click a step and then 'Show me where'.", "Siga os passos para estruturar a saúde e segurança na plataforma. Clique num passo e depois em 'Mostrar onde'."), items: items, autoOpen: fresh || n < items.length, refresh: journeyItems });
    } else jg.update(items);
    const b = document.getElementById("stJgN"); if (b) b.textContent = n + "/" + items.length;
    return jg;
  }

  /* ---------------- panel ---------------- */
  function bars(rows, series) {
    const raw = Math.max.apply(null, rows.map(function (r) { return Math.max.apply(null, series.map(function (s) { return r[s.k] || 0; })); })), max = Math.max(2, Math.ceil(raw / 2) * 2);
    const step = Math.max(series.length * 14 + 18, 58), W = Math.max(340, rows.length * step + 50), H = 190, top = 18, base = H - 28;
    let o = '<svg viewBox="0 0 ' + W + " " + H + '" class="st-bars" role="img" style="width:100%;min-width:' + Math.min(W, 560) + 'px;height:auto">';
    [0, .5, 1].forEach(function (t) { const y = base - (base - top) * t; o += '<line x1="34" x2="' + (W - 4) + '" y1="' + y + '" y2="' + y + '" class="g"/><text x="30" y="' + (y + 4) + '" text-anchor="end" class="ax">' + nf(max * t) + "</text>"; });
    rows.forEach(function (r, i) {
      const gx = 44 + i * step + (step - series.length * 14 - 18) / 2;
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
    const nt = NT(), A0 = absStats();
    v.innerHTML = '<div class="st-wrap"><div class="st-aihead"><button class="pl-btn primary" id="pnAi">' + IC("spark", 16) + " " + esc(L("Executive summary with AI", "Resumo executivo com IA")) + '</button><span class="st-chip ' + ((nt.to || []).length ? "good" : "") + '" data-goto="cfg" role="button">' + IC("bell", 13) + " " + esc((nt.to || []).length ? L("E-mail alerts on · ", "Alertas por e-mail ligados · ") + nt.to.length + L(" recipient(s)", " destinatário(s)") + (nt.daily !== false ? L(" · daily 08:00", " · diário 08:00") : "") : L("E-mail alerts off – turn on in Settings", "Alertas por e-mail desligados – ligue em Configurações")) + "</span>" +
      (A0.rateMonth != null ? '<span class="st-chip ' + (A0.target != null && A0.rateMonth > A0.target ? "bad" : "good") + '" data-goto="abs" role="button">' + esc(L("Absenteeism ", "Absenteísmo ")) + nf(A0.rateMonth, 2) + "%" + (A0.target != null ? " · " + L("target ", "meta ") + nf(A0.target, 1) + "%" : "") + "</span>" : "") + "</div><div class=\"st-tiles\">" +
      tile("clock", since == null ? "–" : nf(since), L("days without lost-time accident", "dias sem acidente com afastamento"), since != null && since < 30 ? "bad" : "good") +
      tile("alert", nf(accL.length), L("lost-time accidents (year)", "acidentes com afastamento (ano)"), accL.length ? "bad" : "", nf(accN.length) + L(" without lost time", " sem afastamento")) +
      tile("calendar", nf(days), L("days lost (year)", "dias perdidos (ano)")) +
      tile("trend", tf == null ? "–" : nf(tf, 2), L("frequency rate (FR)", "taxa de frequência (TF)"), "", tg == null ? L("enter the man-hours in Settings", "informe as horas-homem em Configurações") : "TG " + nf(tg, 0)) +
      tile("bell", nf(yr.filter(function (r) { return r.type === "near" || r.type === "unsafe"; }).length), L("near misses and unsafe acts (year)", "quase-acidentes e atos inseguros (ano)")) +
      tile("kb", nf(open.length), L("open records", "registros abertos"), late.length ? "warn" : "", late.length ? nf(late.length) + L(" past the deadline", " fora do prazo") : "") +
      tile("send", nf(catP.length), L("CAT overdue", "CAT em atraso"), catP.length ? "bad" : "", L("work accident report (Law 8.213/91)", "comunicação de acidente (Lei 8.213/91)")) +
      (function () { const dd = dues(), ex = dd.filter(function (x) { return x.kind === "exam" && x.st === "late"; }).length, tr = dd.filter(function (x) { return x.kind === "training" && x.st === "late"; }).length, sn = dd.filter(function (x) { return x.st === "soon"; }).length;
        return tile("calendar", nf(ex), L("ASO exams overdue", "exames (ASO) vencidos"), ex ? "bad" : "", sn ? nf(sn) + L(" items due in 30 days", " itens vencem em 30 dias") : "") + tile("kb", nf(tr), L("NR training overdue", "treinamentos NR vencidos"), tr ? "bad" : "", nf(people().filter(function (p) { return p.active !== false; }).length) + L(" active employees", " colaboradores ativos")); })() +
      tile("task", nf(acts.length), L("open actions", "ações abertas"), actLate.length ? "warn" : "", actLate.length ? nf(actLate.length) + L(" late", " atrasadas") : "") + "</div>" +
      '<div class="st-grid2"><section class="st-card"><h3>' + esc(L("Last 12 months", "Últimos 12 meses")) + '</h3><div class="st-scroll">' + bars(rows, [{ k: "a", n: L("Accidents and diseases", "Acidentes e doenças"), c: "#e34948" }, { k: "q", n: L("Near misses / unsafe", "Quase-acidentes / inseguros"), c: "#eda100" }, { k: "e", n: L("Environmental", "Ambientais"), c: "#1baf7a" }]) + "</div></section>" +
      '<section class="st-card"><h3>' + esc(L("Open by type", "Abertos por tipo")) + "</h3>" + (Object.keys(byType).length ? '<div class="st-hbars">' + Object.keys(byType).sort(function (a, b) { return byType[b] - byType[a]; }).map(function (k) { const T = TY[k] || {}, mx = Math.max.apply(null, Object.keys(byType).map(function (x) { return byType[x]; })); return '<div><span>' + esc(T.n || k) + '</span><i style="width:' + Math.max(4, byType[k] / mx * 100) + "%;background:" + (T.c || "#8a94a6") + '"></i><b>' + byType[k] + "</b></div>"; }).join("") + "</div>" : '<p class="muted small">' + esc(L("Nothing open.", "Nada em aberto.")) + "</p>") +
      (catP.length || late.length ? '<h3 class="st-h3">' + esc(L("Needs attention", "Requer atenção")) + '</h3><ul class="st-att">' + catP.map(function (r) { return '<li data-open="' + r.id + '"><b>' + esc(r.key || "") + "</b> " + esc(r.title) + ' <span class="st-chip bad">' + esc(L("CAT overdue", "CAT em atraso")) + "</span></li>"; }).join("") + late.filter(function (r) { return catP.indexOf(r) < 0; }).map(function (r) { return '<li data-open="' + r.id + '"><b>' + esc(r.key || "") + "</b> " + esc(r.title) + ' <span class="st-chip warn">' + esc(L("past the deadline", "fora do prazo")) + "</span></li>"; }).join("") + "</ul>" : "") + "</section></div>" +
      kpiStrip() + "</div>";
    bindOpen(v);
    v.querySelector("#pnAi").onclick = function (e) { aiPanel(e.currentTarget); };
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
      (TYPES()[r.type] && TYPES()[r.type].cat && r.status !== "cancel" && !(r.cat && r.cat.s2210) ? '<span class="st-chip warn">' + esc(L("eSocial S-2210 pending", "eSocial S-2210 pendente")) + "</span>" : "") +
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
      (r.type === "improve" || r.type === "inspection" || r.type === "env" ? "" : '<div class="pl-2"><label>' + esc(L("Person involved", "Pessoa envolvida")) + '<input name="person" list="stPeople" maxlength="80" value="' + esc(r.person || "") + '" placeholder="' + esc(L("Pick an employee or type a name", "Escolha um colaborador ou digite um nome")) + '"><datalist id="stPeople">' + people().map(function (x) { return '<option value="' + esc(x.name) + '">' + esc([x.reg, x.role, x.sector].filter(Boolean).join(" · ")) + "</option>"; }).join("") + "</datalist>" + '</label><label>' + esc(L("Job / role", "Função")) + '<input name="personRole" maxlength="60" value="' + esc(r.personRole || "") + '"></label></div>') +
      (sevSel ? '<div class="pl-2">' + sevSel + (T.cat ? '<label class="chk st-leave"><input type="checkbox" name="leave"' + (r.leave ? " checked" : "") + "> " + esc(L("With lost time (absence)", "Com afastamento")) + "</label>" : "<span></span>") + "</div>" : "") +
      (T.cat || r.type === "leave" ? '<div class="pl-2"><label>' + esc(L("Days lost / away", "Dias perdidos / afastado")) + '<input type="number" min="0" name="daysLost" value="' + esc(r.daysLost == null ? "" : r.daysLost) + '"></label>' + (r.type === "leave" || T.cat ? "<label>" + esc(L("Reason (no diagnosis)", "Motivo (sem diagnóstico)")) + '<select name="absKind"><option value="">—</option>' + ABSK().map(function (x) { return opt(x[0], x[1], r.absKind || (r.type === "leave" ? "short" : "")); }).join("") + "</select></label>" : "<span></span>") + "</div>" +
        '<div class="pl-2"><label>' + esc(L("Away from", "Afastado desde")) + '<input type="date" name="absStart" value="' + esc(r.absStart || "") + '"></label><label>' + esc(L("Expected return", "Retorno previsto")) + '<input type="date" name="absEnd" value="' + esc(r.absEnd || "") + '"></label></div>' : "") +
      (T.cat ? '<fieldset class="st-fs"><legend>CAT – ' + esc(L("work accident report", "comunicação de acidente de trabalho")) + '</legend><div class="pl-3"><label>' + esc(L("CAT number", "Número da CAT")) + '<input name="catNum" maxlength="40" value="' + esc((r.cat || {}).num || "") + '"></label><label class="chk st-leave"><input type="checkbox" name="s2210"' + ((r.cat || {}).s2210 ? " checked" : "") + "> " + esc(L("Sent to eSocial (S-2210)", "Enviada ao eSocial (S-2210)")) + "</label>" + '<label>' + esc(L("Issued on", "Emitida em")) + '<input type="date" name="catDate" value="' + esc((r.cat || {}).date || "") + '"></label></div><p class="muted small">' + esc(L("Legal deadline: first business day after the accident; immediately in case of death (Law 8.213/91, art. 22). Also report it to eSocial (S-2210).", "Prazo legal: até o 1º dia útil seguinte ao acidente; imediato em caso de óbito (Lei 8.213/91, art. 22). Informar também ao eSocial (S-2210).")) + "</p></fieldset>" : "") +
      (r.type === "exam" ? '<div class="pl-3"><label>' + esc(L("Exam", "Exame")) + '<select name="examKind">' + EXAMS().map(function (x) { return opt(x[0], x[1], (r.exam || {}).kind || "periodic"); }).join("") + "</select></label><label>" + esc(L("Scheduled for", "Agendado para")) + '<input type="date" name="examDate" value="' + esc((r.exam || {}).date || "") + '"></label><label>' + esc(L("Result (ASO)", "Resultado (ASO)")) + '<select name="examResult"><option value="">—</option>' + RESULTS().map(function (x) { return opt(x[0], x[1], (r.exam || {}).result || ""); }).join("") + "</select></label></div>" : "") +
      (r.type === "epi" ? '<div class="pl-3"><label>' + esc(L("Equipment", "Equipamento")) + '<input name="epiItem" maxlength="80" value="' + esc((r.epi || {}).item || "") + '" placeholder="' + esc(L("e.g. safety boots, gloves, harness", "ex.: botina, luvas, cinto paraquedista")) + '"></label><label>' + esc(L("Quantity", "Quantidade")) + '<input type="number" min="1" name="epiQty" value="' + esc((r.epi || {}).qty || 1) + '"></label><label>' + esc(L("Size / CA", "Tamanho / CA")) + '<input name="epiSize" maxlength="30" value="' + esc((r.epi || {}).size || "") + '"></label></div>' : "") +
      "<label>" + esc(L("Description", "Descrição")) + '<textarea name="desc" rows="3" maxlength="2000">' + esc(r.desc || "") + "</textarea></label>" +
      '<div class="pl-2"><label>' + esc(L("Responsible", "Responsável")) + '<select name="owner"><option value="">—</option>' + Object.keys(ppl).map(function (k) { return opt(ppl[k].email, ppl[k].name || ppl[k].email, r.owner || ""); }).join("") + "</select></label><label>" + esc(L("Deadline", "Prazo")) + '<input type="date" name="due" value="' + esc(r.due ? new Date(r.due - new Date(r.due).getTimezoneOffset() * 60000).toISOString().slice(0, 10) : "") + '"></label></div>';
    return h;
  }
  function readFields(f, r) {
    const T = TYPES()[r.type] || {}, o = { title: f.title.value.trim(), when: f.when.value ? new Date(f.when.value).getTime() : Date.now(), place: f.place.value.trim() || null, desc: f.desc.value.trim() || null, owner: f.owner.value || null, due: f.due.value ? new Date(f.due.value + "T23:59:00").getTime() : null };
    if (f.person) {
      o.person = f.person.value.trim() || null; o.personRole = f.personRole.value.trim() || null;
      const pm = o.person && people().find(function (x) { return x.name.toLowerCase() === o.person.toLowerCase(); });
      o.personId = pm ? pm.id : null; if (pm && !o.personRole && pm.role) o.personRole = pm.role;
    }
    if (f.severity) o.severity = f.severity.value;
    if (f.leave) o.leave = f.leave.checked || null;
    if (f.daysLost) o.daysLost = f.daysLost.value === "" ? null : Number(f.daysLost.value);
    if (f.absKind) { o.absKind = f.absKind.value || null; o.absStart = f.absStart.value || null; o.absEnd = f.absEnd.value || null; if (o.absStart && o.absEnd && o.absEnd >= o.absStart && o.daysLost == null) o.daysLost = dayN(o.absEnd) - dayN(o.absStart) + 1; }
    if (T.cat) o.cat = f.catNum.value.trim() || f.catDate.value || f.s2210.checked ? { num: f.catNum.value.trim() || null, date: f.catDate.value || null, s2210: f.s2210.checked || null } : null;
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
          return sref("records/" + rid).set(rec).then(function () { if (NT().instant !== false && (NT().to || []).length && (TY[type].cat || type === "leave" || rec.severity === "high" || rec.severity === "fatal")) notify("sst-record", { rec: rid }); close(); toast(rec.key + " " + L("registered", "registrado") + (TY[type].cat ? " · " + L("CAT due ", "CAT até ") + fmtD(catDue(rec)) : "")); drawer(rid); });
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
      '<div class="st-aibar"><button type="button" class="pl-btn sm" id="sdAi">' + IC("spark", 14) + " " + esc(L("Analyse with AI: root cause and actions", "Analisar com IA: causa raiz e ações")) + '</button></div><div id="sdAiOut"></div>' +
      '<div class="st-acts" id="sdActs"></div>' +
      '<p class="muted small">' + esc(L("Registered by ", "Registrado por ")) + esc(who(r.by)) + " · " + esc(fmtDT(r.created)) + (r.closedAt ? " · " + esc(L("closed ", "encerrado ")) + esc(fmtDT(r.closedAt)) : "") + '</p><button class="pl-btn ghost danger sm" id="sdDel">' + esc(L("Delete record", "Excluir registro")) + "</button>";
    d.querySelector("#sdX").onclick = closeDrawer;
    d.querySelector("#sdAi").onclick = function () { aiRecord(Object.assign({ id: id }, data.records[id] || r), d); };
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
    aiShow(r, d);
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


  /* ---------------- employees (Colaboradores): ASO exams, NR training, PPE record ----------------
     sst/<ws>/people/<pid> = { name, reg, role, sector, admission, active, created, by,
       exams/<id>{kind, date, months, result, s2220}, trainings/<id>{nr, course, date, months, hours}, ppe/<id>{item, ca, qty, date, months} } */
  function NRS() {
    return [["NR-01", L("Safety induction / risk management (PGR)", "Integração e gerenciamento de riscos (PGR)"), 0], ["NR-05", L("Accident prevention committee (CIPA)", "CIPA"), 12], ["NR-06", L("Use of PPE", "Uso de EPI"), 12],
      ["NR-10", L("Electrical safety", "Segurança em eletricidade"), 24], ["NR-11", L("Forklift / material handling", "Empilhadeira / movimentação de cargas"), 12], ["NR-12", L("Machinery safety", "Segurança em máquinas"), 24],
      ["NR-13", L("Boilers and pressure vessels", "Caldeiras e vasos de pressão"), 24], ["NR-18", L("Construction", "Construção civil"), 24], ["NR-20", L("Flammables and fuels", "Inflamáveis e combustíveis"), 24],
      ["NR-23", L("Fire brigade", "Brigada de incêndio"), 12], ["NR-33", L("Confined spaces", "Espaço confinado"), 12], ["NR-35", L("Work at height", "Trabalho em altura"), 24], ["", L("Other training", "Outro treinamento"), 12]];
  }
  const EXAM_MONTHS = { admission: 12, periodic: 12, return: 0, change: 12, dismissal: 0 };
  function people() { const p = data.people || {}; return Object.keys(p).map(function (k) { return Object.assign({ id: k }, p[k]); }).sort(function (a, b) { return String(a.name || "").localeCompare(String(b.name || "")); }); }
  function addMonths(d, m) { const x = new Date(d + "T12:00:00"); x.setMonth(x.getMonth() + Number(m)); return x.toISOString().slice(0, 10); }
  function todayS() { return new Date().toISOString().slice(0, 10); }
  function dueSt(next) { if (!next) return ""; const t = todayS(), soon = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10); return next < t ? "late" : next <= soon ? "soon" : "ok"; }
  function fmtS(s) { return s ? s.split("-").reverse().join("/") : "–"; }
  /* everything that expires: last periodic exam, each NR training, each PPE delivery (replacement) */
  function dues() {
    const out = [];
    people().filter(function (p) { return p.active !== false; }).forEach(function (p) {
      const ex = Object.keys(p.exams || {}).map(function (k) { return Object.assign({ id: k }, p.exams[k]); }).filter(function (e) { return e.date && e.kind !== "dismissal"; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0];
      if (ex && Number(ex.months)) out.push({ p: p, kind: "exam", what: L("Periodic exam (ASO)", "Exame periódico (ASO)"), last: ex.date, next: addMonths(ex.date, ex.months) });
      else if (!ex) out.push({ p: p, kind: "exam", what: L("No ASO registered", "Sem ASO registrado"), last: "", next: p.admission || todayS() });
      const byNr = {};
      Object.keys(p.trainings || {}).forEach(function (k) { const t = p.trainings[k], key2 = (t.nr || "") + "|" + (t.course || ""); if (t.date && (!byNr[key2] || byNr[key2].date < t.date)) byNr[key2] = t; });
      Object.keys(byNr).forEach(function (k) { const t = byNr[k]; if (Number(t.months)) out.push({ p: p, kind: "training", what: [t.nr, t.course].filter(Boolean).join(" – "), last: t.date, next: addMonths(t.date, t.months) }); });
      Object.keys(p.ppe || {}).forEach(function (k) { const e = p.ppe[k]; if (e.date && Number(e.months)) out.push({ p: p, kind: "ppe", what: e.item + (e.ca ? " · CA " + e.ca : ""), last: e.date, next: addMonths(e.date, e.months) }); });
    });
    return out.map(function (d) { d.st = dueSt(d.next); return d; }).sort(function (a, b) { return a.next < b.next ? -1 : 1; });
  }
  function personChips(p) {
    const ds = dues().filter(function (d) { return d.p.id === p.id; }), late = ds.filter(function (d) { return d.st === "late"; }).length, soon = ds.filter(function (d) { return d.st === "soon"; }).length;
    return (p.active === false ? '<span class="st-chip">' + esc(L("Inactive", "Inativo")) + "</span>" : "") + (late ? '<span class="st-chip bad">' + late + " " + esc(L("overdue", "vencido(s)")) + "</span>" : "") + (soon ? '<span class="st-chip warn">' + soon + " " + esc(L("due in 30 days", "vence(m) em 30 dias")) + "</span>" : "") + (!late && !soon && ds.length ? '<span class="st-chip good">' + esc(L("Up to date", "Em dia")) + "</span>" : "");
  }
  function peopleView(v) {
    const sectors = {}; people().forEach(function (p) { if (p.sector) sectors[p.sector] = 1; });
    const draw = function (keep) {
      const q = (filter.pq || "").toLowerCase(), ps = people().filter(function (p) { return (!filter.ps || p.sector === filter.ps) && (!q || (p.name + " " + (p.reg || "") + " " + (p.role || "")).toLowerCase().indexOf(q) >= 0); });
      const body = ps.length ? '<div class="st-list">' + ps.map(function (p) { return '<button class="st-row st-prow2" data-person="' + p.id + '"><span class="st-av">' + esc((p.name || "?")[0].toUpperCase()) + '</span><span class="st-main"><b>' + esc(p.name) + '</b><span class="st-chips"><span class="muted small">' + esc([p.reg ? L("Reg. ", "Matr. ") + p.reg : "", p.role, p.sector].filter(Boolean).join(" · ")) + "</span>" + personChips(p) + '</span></span><span class="st-meta">' + Object.keys(p.exams || {}).length + " ASO · " + Object.keys(p.trainings || {}).length + " " + esc(L("trainings", "treinam.")) + " · " + Object.keys(p.ppe || {}).length + " EPI</span></button>"; }).join("") + "</div>"
        : '<div class="st-empty">' + IC("people", 26) + "<p>" + esc(L("No employees yet. Add them one by one or paste a list.", "Nenhum colaborador ainda. Cadastre um a um ou cole uma lista.")) + "</p></div>";
      if (keep && v.querySelector(".st-body")) v.querySelector(".st-body").innerHTML = body;
      else {
        v.innerHTML = '<div class="st-wrap"><div class="st-bar"><input type="search" id="pQ" placeholder="' + esc(L("Search name, registration or job", "Pesquisar nome, matrícula ou função")) + '" value="' + esc(filter.pq || "") + '"><select id="pS"><option value="">' + esc(L("All sectors", "Todos os setores")) + "</option>" + Object.keys(sectors).sort().map(function (x) { return opt(x, x, filter.ps || ""); }).join("") + '</select><button class="pl-btn" id="pImp">' + IC("export", 15) + " " + esc(L("Paste a list", "Colar lista")) + '</button><button class="pl-btn primary" id="pNew">' + IC("plus", 15) + " " + esc(L("New employee", "Novo colaborador")) + '</button></div><div class="st-body">' + body + "</div></div>";
        v.querySelector("#pQ").oninput = function (e) { filter.pq = e.target.value; draw(true); };
        v.querySelector("#pS").onchange = function (e) { filter.ps = e.target.value; draw(true); };
        v.querySelector("#pNew").onclick = function () { personDialog(null); };
        v.querySelector("#pImp").onclick = importPeople;
      }
      v.querySelectorAll("[data-person]").forEach(function (b) { b.onclick = function () { personDrawer(b.dataset.person); }; });
    };
    draw();
  }
  function personDialog(pid) {
    const p = pid ? Object.assign({}, data.people[pid]) : { active: true };
    modal("<h2>" + esc(pid ? L("Edit employee", "Editar colaborador") : L("New employee", "Novo colaborador")) + '</h2><form class="pl-form" id="pF"><label>' + esc(L("Name", "Nome")) + '<input name="name" required maxlength="80" value="' + esc(p.name || "") + '"></label>' +
      '<div class="pl-2"><label>' + esc(L("Registration", "Matrícula")) + '<input name="reg" maxlength="30" value="' + esc(p.reg || "") + '"></label><label>' + esc(L("Admission date", "Data de admissão")) + '<input type="date" name="admission" value="' + esc(p.admission || "") + '"></label></div>' +
      '<div class="pl-2"><label>' + esc(L("Job / role", "Função")) + '<input name="role" maxlength="60" value="' + esc(p.role || "") + '"></label><label>' + esc(L("Sector", "Setor")) + '<input name="sector" list="stPlaces2" maxlength="60" value="' + esc(p.sector || "") + '"><datalist id="stPlaces2">' + (S().places || []).map(function (x) { return '<option value="' + esc(x) + '">'; }).join("") + "</datalist></label></div>" +
      '<label class="chk"><input type="checkbox" name="active"' + (p.active !== false ? " checked" : "") + "> " + esc(L("Active employee", "Colaborador ativo")) + "</label>" +
      '<div class="pl-row-end"><button type="button" class="pl-btn" data-close>' + esc(L("Cancel", "Cancelar")) + '</button><button class="pl-btn primary">' + esc(L("Save", "Salvar")) + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#pF");
      f.onsubmit = function (e) {
        e.preventDefault();
        const o = { name: f.name.value.trim(), reg: f.reg.value.trim() || null, admission: f.admission.value || null, role: f.role.value.trim() || null, sector: f.sector.value.trim() || null, active: f.active.checked };
        if (!o.name) return;
        const id = pid || db.ref().push().key;
        if (!pid) Object.keys(o).forEach(function (k) { if (o[k] === null) delete o[k]; });
        (pid ? sref("people/" + id).update(o) : sref("people/" + id).set(Object.assign(o, { created: TS(), by: me.email }))).then(function () { close(); toast(L("Saved", "Salvo")); if (!pid) setTimeout(function () { personDrawer(id); }, 200); }, fail);
      };
    });
  }
  function importPeople() {
    modal("<h2>" + esc(L("Paste a list of employees", "Colar lista de colaboradores")) + '</h2><p class="muted small">' + esc(L("One per line: name; registration; job; sector; admission (dd/mm/yyyy). Copy from Excel works (tabs are accepted).", "Um por linha: nome; matrícula; função; setor; admissão (dd/mm/aaaa). Pode copiar do Excel (tabulação também vale).")) + '</p><form class="pl-form" id="ipF"><textarea name="t" rows="8" placeholder="Maria Souza; 1023; Operadora; Produção; 03/02/2024"></textarea><div class="pl-row-end"><button type="button" class="pl-btn" data-close>' + esc(L("Cancel", "Cancelar")) + '</button><button class="pl-btn primary">' + esc(L("Import", "Importar")) + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#ipF");
      f.onsubmit = function (e) {
        e.preventDefault(); const u = {}, have = {}; let n = 0;
        people().forEach(function (p) { have[(p.reg || p.name || "").toLowerCase()] = p.id; });
        f.t.value.split("\n").map(function (l) { return l.split(/;|\t/).map(function (x) { return x.trim(); }); }).filter(function (c) { return c[0] && !/^nome$|^name$/i.test(c[0]); }).forEach(function (c) {
          const dt = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(c[4] || ""), o = { name: c[0], reg: c[1] || null, role: c[2] || null, sector: c[3] || null, admission: dt ? dt[3] + "-" + dt[2] + "-" + dt[1] : (/^\d{4}-\d{2}-\d{2}$/.test(c[4] || "") ? c[4] : null), active: true };
          const ex = have[(o.reg || o.name).toLowerCase()];
          Object.keys(o).forEach(function (k) { if (o[k] === null) delete o[k]; });
          if (ex) Object.keys(o).forEach(function (k) { u["people/" + ex + "/" + k] = o[k]; });
          else u["people/" + db.ref().push().key] = Object.assign(o, { created: Date.now(), by: me.email });
          n++;
        });
        if (!n) return toast(L("Nothing to import", "Nada para importar"));
        sref().update(u).then(function () { close(); toast(n + " " + L("employees imported", "colaboradores importados")); }, fail);
      };
    });
  }
  function closePerson() { const d = document.getElementById("stPerson"); if (d) d.remove(); openPerson = null; }
  function personDrawer(pid) {
    const p0 = data.people && data.people[pid]; if (!p0) return;
    openPerson = pid; closeDrawer();
    const p = Object.assign({ id: pid }, p0), list = function (o) { return Object.keys(o || {}).map(function (k) { return Object.assign({ id: k }, o[k]); }).sort(function (a, b) { return String(b.date || "").localeCompare(String(a.date || "")); }); };
    const EX = {}; EXAMS().forEach(function (x) { EX[x[0]] = x[1]; }); const RS = {}; RESULTS().forEach(function (x) { RS[x[0]] = x[1]; });
    const ds = dues().filter(function (x) { return x.p.id === pid; }), recsP = recs().filter(function (r) { return r.personId === pid; });
    let d = document.getElementById("stPerson");
    if (!d) { d = document.createElement("aside"); d.id = "stPerson"; d.className = "pl-drawer st-drawer"; document.body.appendChild(d); }
    const sec = function (title, ic, rows, form) { return '<section class="st-psec"><div class="st-head2"><b>' + IC(ic, 15) + " " + esc(title) + "</b></div>" + (rows || '<p class="muted small">' + esc(L("Nothing yet.", "Nada ainda.")) + "</p>") + form + "</section>"; };
    d.innerHTML = '<header><span class="st-av">' + esc((p.name || "?")[0].toUpperCase()) + '</span><span class="tk"><b>' + esc(p.name) + "</b><br>" + esc([p.reg ? L("Reg. ", "Matr. ") + p.reg : "", p.role, p.sector, p.admission ? L("since ", "desde ") + fmtS(p.admission) : ""].filter(Boolean).join(" · ")) + '</span><span class="sp"></span><button class="pl-btn sm" id="ppEd">' + esc(L("Edit", "Editar")) + '</button><button class="pl-btn icon" id="ppX">✕</button></header>' +
      '<div class="st-pbody">' + (ds.length ? '<div class="st-chips">' + ds.map(function (x) { return '<span class="st-chip ' + (x.st === "late" ? "bad" : x.st === "soon" ? "warn" : "good") + '">' + esc(x.what) + " · " + fmtS(x.next) + "</span>"; }).join("") + "</div>" : "") +
      sec(L("Occupational exams (ASO)", "Exames ocupacionais (ASO)"), "calendar", list(p.exams).map(function (e) { return '<div class="st-li"><span><b>' + esc(EX[e.kind] || e.kind) + "</b> · " + fmtS(e.date) + (e.result ? " · " + esc(RS[e.result] || e.result) : "") + (Number(e.months) ? ' <span class="muted small">' + esc(L("next ", "próximo ")) + fmtS(addMonths(e.date, e.months)) + "</span>" : "") + '</span><label class="chk small"><input type="checkbox" data-s2220="' + e.id + '"' + (e.s2220 ? " checked" : "") + '> eSocial S-2220</label><button class="link sm danger" data-pdel="exams/' + e.id + '">✕</button></div>'; }).join(""),
        '<form class="st-addact st-add4" id="fEx"><select name="kind">' + EXAMS().map(function (x) { return opt(x[0], x[1], "periodic"); }).join("") + '</select><input type="date" name="date" required value="' + todayS() + '"><select name="result"><option value="">' + esc(L("Result", "Resultado")) + "</option>" + RESULTS().map(function (x) { return opt(x[0], x[1], ""); }).join("") + '</select><input type="number" name="months" min="0" max="60" value="12" title="' + esc(L("Periodicity (months)", "Periodicidade (meses)")) + '"><button class="pl-btn sm primary">' + esc(L("Add", "Adicionar")) + "</button></form>") +
      sec(L("Training (NR)", "Treinamentos (NR)"), "kb", list(p.trainings).map(function (t) { return '<div class="st-li"><span><b>' + esc([t.nr, t.course].filter(Boolean).join(" – ")) + "</b> · " + fmtS(t.date) + (t.hours ? " · " + t.hours + "h" : "") + (Number(t.months) ? ' <span class="muted small">' + esc(L("valid until ", "válido até ")) + fmtS(addMonths(t.date, t.months)) + "</span>" : "") + '</span><button class="link sm danger" data-pdel="trainings/' + t.id + '">✕</button></div>'; }).join(""),
        '<form class="st-addact st-add4" id="fTr"><select name="nr">' + NRS().map(function (x, i) { return '<option value="' + i + '">' + esc((x[0] ? x[0] + " – " : "") + x[1]) + "</option>"; }).join("") + '</select><input type="date" name="date" required value="' + todayS() + '"><input type="number" name="hours" min="0" step="0.5" placeholder="h"><input type="number" name="months" min="0" max="60" value="12" title="' + esc(L("Valid for (months)", "Validade (meses)")) + '"><button class="pl-btn sm primary">' + esc(L("Add", "Adicionar")) + "</button></form>") +
      sec(L("PPE record (deliveries)", "Ficha de EPI (entregas)"), "request", list(p.ppe).map(function (e) { return '<div class="st-li"><span><b>' + esc(e.item) + "</b>" + (e.ca ? " · CA " + esc(e.ca) : "") + " · " + (e.qty || 1) + " · " + fmtS(e.date) + (Number(e.months) ? ' <span class="muted small">' + esc(L("replace on ", "trocar em ")) + fmtS(addMonths(e.date, e.months)) + "</span>" : "") + '</span><button class="link sm danger" data-pdel="ppe/' + e.id + '">✕</button></div>'; }).join(""),
        '<form class="st-addact st-add4" id="fPp"><input name="item" required maxlength="60" placeholder="' + esc(L("Item – e.g. safety boots", "Item – ex.: botina")) + '"><input name="ca" maxlength="12" placeholder="CA"><input type="date" name="date" required value="' + todayS() + '"><input type="number" name="months" min="0" max="60" value="6" title="' + esc(L("Replace after (months)", "Trocar após (meses)")) + '"><button class="pl-btn sm primary">' + esc(L("Add", "Adicionar")) + "</button></form>") +
      sec(L("Occurrences of this employee", "Ocorrências do colaborador"), "alert", recsP.map(function (r) { return '<button class="st-li link-row" data-open="' + r.id + '"><span><b>' + esc(r.key) + "</b> " + esc(r.title) + '</span><span class="muted small">' + fmtD(r.when) + "</span></button>"; }).join(""), "") + "</div>";
    d.querySelector("#ppX").onclick = closePerson;
    d.querySelector("#ppEd").onclick = function () { personDialog(pid); };
    d.querySelectorAll("[data-open]").forEach(function (b) { b.onclick = function () { closePerson(); drawer(b.dataset.open); }; });
    d.querySelectorAll("[data-pdel]").forEach(function (b) { b.onclick = function () { sref("people/" + pid + "/" + b.dataset.pdel).remove().catch(fail); }; });
    d.querySelectorAll("[data-s2220]").forEach(function (c) { c.onchange = function () { sref("people/" + pid + "/exams/" + c.dataset.s2220 + "/s2220").set(c.checked || null).catch(fail); }; });
    const add = function (fid, path, build) { const f = d.querySelector(fid); f.onsubmit = function (e) { e.preventDefault(); const o = build(f); Object.keys(o).forEach(function (k) { if (o[k] === null || o[k] === "") delete o[k]; }); sref("people/" + pid + "/" + path + "/" + db.ref().push().key).set(o).catch(fail); }; };
    const fx = d.querySelector("#fEx"); fx.kind.onchange = function () { fx.months.value = EXAM_MONTHS[fx.kind.value] || 0; };
    const ft = d.querySelector("#fTr"); ft.nr.onchange = function () { ft.months.value = NRS()[ft.nr.value][2]; }; ft.nr.value = "11"; ft.nr.onchange();
    add("#fEx", "exams", function (f) { return { kind: f.kind.value, date: f.date.value, result: f.result.value, months: Number(f.months.value) || 0, by: me.email }; });
    add("#fTr", "trainings", function (f) { const n = NRS()[f.nr.value]; return { nr: n[0] || null, course: n[0] ? n[1] : L("Training", "Treinamento"), date: f.date.value, hours: Number(f.hours.value) || null, months: Number(f.months.value) || 0, by: me.email }; });
    add("#fPp", "ppe", function (f) { return { item: f.item.value.trim(), ca: f.ca.value.trim(), qty: 1, date: f.date.value, months: Number(f.months.value) || 0, by: me.email }; });
  }
  function dueView(v) {
    const K = { exam: L("Exams (ASO)", "Exames (ASO)"), training: L("Training (NR)", "Treinamentos (NR)"), ppe: "EPI" };
    const all = dues(), f = filter.dk || "", st = filter.ds || "pending";
    const rows = all.filter(function (x) { return (!f || x.kind === f) && (st === "all" || (st === "pending" ? x.st !== "ok" : x.st === st)); });
    const cnt = function (k, s) { return all.filter(function (x) { return (!k || x.kind === k) && x.st === s; }).length; };
    v.innerHTML = '<div class="st-wrap"><div class="st-tiles st-t3">' + Object.keys(K).map(function (k) { return '<div class="st-tile' + (cnt(k, "late") ? " bad" : "") + '"><b>' + cnt(k, "late") + "</b><span>" + esc(K[k]) + " · " + esc(L("overdue", "vencidos")) + "</span><small>" + cnt(k, "soon") + " " + esc(L("due in 30 days", "vencem em 30 dias")) + "</small></div>"; }).join("") + "</div>" +
      '<div class="st-bar"><select id="dK"><option value="">' + esc(L("Everything", "Tudo")) + "</option>" + Object.keys(K).map(function (k) { return opt(k, K[k], f); }).join("") + '</select><select id="dS">' + opt("pending", L("Overdue + next 30 days", "Vencidos + próximos 30 dias"), st) + opt("late", L("Overdue", "Vencidos"), st) + opt("soon", L("Next 30 days", "Próximos 30 dias"), st) + opt("all", L("All", "Todos"), st) + '</select><button class="pl-btn" id="dCsv">' + IC("export", 15) + " " + esc(L("Call-up list (CSV)", "Lista de convocação (CSV)")) + "</button></div>" +
      (rows.length ? '<div class="st-card"><div class="st-scroll"><table class="st-tbl"><thead><tr><th>' + esc(L("Employee", "Colaborador")) + "</th><th>" + esc(L("Sector", "Setor")) + "</th><th>" + esc(L("Item", "Item")) + "</th><th>" + esc(L("Last", "Último")) + "</th><th>" + esc(L("Due", "Vence")) + "</th><th></th></tr></thead><tbody>" +
        rows.map(function (x) { return '<tr data-person="' + x.p.id + '"><td><b>' + esc(x.p.name) + "</b>" + (x.p.reg ? ' <span class="muted small">' + esc(x.p.reg) + "</span>" : "") + "</td><td>" + esc(x.p.sector || "") + "</td><td>" + esc(K[x.kind]) + " · " + esc(x.what) + "</td><td>" + fmtS(x.last) + "</td><td>" + fmtS(x.next) + '</td><td><span class="st-chip ' + (x.st === "late" ? "bad" : x.st === "soon" ? "warn" : "good") + '">' + esc(x.st === "late" ? L("Overdue", "Vencido") : x.st === "soon" ? L("Due soon", "A vencer") : L("OK", "Em dia")) + "</span></td></tr>"; }).join("") + "</tbody></table></div></div>"
        : '<div class="st-empty">' + IC("calendar", 26) + "<p>" + esc(people().length ? L("Nothing due in this filter.", "Nada vencendo neste filtro.") : L("Register the employees with their exams, training and PPE to see the due dates here.", "Cadastre os colaboradores com exames, treinamentos e EPI para ver os vencimentos aqui.")) + "</p></div>") + "</div>";
    v.querySelector("#dK").onchange = function (e) { filter.dk = e.target.value; dueView(v); };
    v.querySelector("#dS").onchange = function (e) { filter.ds = e.target.value; dueView(v); };
    v.querySelectorAll("[data-person]").forEach(function (r) { r.onclick = function () { personDrawer(r.dataset.person); }; });
    v.querySelector("#dCsv").onclick = function () {
      const q = function (s) { s = String(s == null ? "" : s); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const lines = [[L("Employee", "Colaborador"), L("Registration", "Matrícula"), L("Job", "Função"), L("Sector", "Setor"), L("Type", "Tipo"), L("Item", "Item"), L("Last", "Último"), L("Due", "Vencimento"), L("Status", "Situação")]].concat(rows.map(function (x) { return [x.p.name, x.p.reg, x.p.role, x.p.sector, K[x.kind], x.what, fmtS(x.last), fmtS(x.next), x.st === "late" ? L("Overdue", "Vencido") : x.st === "soon" ? L("Due soon", "A vencer") : L("OK", "Em dia")]; }));
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + lines.map(function (r) { return r.map(q).join(";"); }).join("\n")], { type: "text/csv" })); a.download = "convocacao-" + todayS() + ".csv"; a.click();
    };
  }

  /* ---------------- plannings & indicators ---------------- */
  function plansView(v) {
    const ORD = ["o-pcmso", "o-wellbeing", "o-return", "x-safety", "o-cipa", "x-emergency", "x-env", "x-goals"], APL = (window.PLAN_AREA_PLANS || []).filter(function (p) { return p.area === "ohs" || p.area === "she"; }).sort(function (a, b) { return (ORD.indexOf(a.id) + 99) % 99 - (ORD.indexOf(b.id) + 99) % 99; }), G = GROUPS(), M = window.PLAN_METHODS || {};
    v.innerHTML = '<div class="st-wrap"><section class="st-card"><h3>' + esc(L("Plannings of the module", "Planejamentos do módulo")) + " (" + plans.length + ")</h3>" +
      (plans.length ? '<div class="st-plist">' + plans.map(function (p) { const c = kpiCache[p.id] || {}; return '<a class="st-prow" href="../planning/?id=' + encodeURIComponent(p.id) + '">' + (window.CMIcon3D ? window.CMIcon3D((M[p.method] || {}).icon || "planning", 30, p.method) : "") + "<span><b>" + esc(p.title) + "</b><small>" + esc((M[p.method] || {}).name || "") + " · " + (c.n || 0) + " " + esc(L("items", "itens")) + " · " + Object.keys(c.kpis || {}).length + " " + esc(L("indicators", "indicadores")) + "</small></span><span>→</span></a>"; }).join("") + "</div>" : '<p class="muted small">' + esc(L("No planning yet. Start from a template below.", "Nenhum planejamento ainda. Comece por um template abaixo.")) + "</p>") + "</section>" +
      '<section class="st-card"><h3>' + esc(L("Templates", "Templates")) + '</h3><p class="muted small">' + esc(L("Each template creates a planning with phases, tasks and the Indicators tab (own KPIs).", "Cada template cria um planejamento com fases, tarefas e a aba Indicadores (KPIs próprios).")) + "</p>" +
      Object.keys(G).filter(function (g) { return g !== "health"; }).map(function (g) { const ts = APL.filter(function (p) { const sb = p.sub || (p.area === "she" ? "she" : "health"); return (sb === "she" ? "she" : "safety") === g; }); return ts.length ? '<h3 class="st-h3">' + esc(G[g]) + '</h3><div class="st-tpls">' + ts.map(function (p) { return '<a class="st-tpl" href="../workspaces/?newplan=' + encodeURIComponent(p.id) + "&ws=" + encodeURIComponent(WS) + '"><span class="tpl-pv">' + (window.CMPlanPreview ? window.CMPlanPreview(p.method) : "") + "</span><b>" + esc(p.name) + "</b><small>" + esc(p.desc || "") + "</small></a>"; }).join("") + "</div>" : ""; }).join("") + "</section></div>";
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

  /* ---------------- notifications (platform notifier – Digital Agile account) ----------------
     settings.notify = { to: [e-mails], daily: bool, days: 7|15|30, instant: bool }  – recipients must be members of the workspace (checked by the notifier). */
  function NT() { return S().notify || {}; }
  function notify(kind, extra) {
    const url = window.CMCOLLAB_MAILER; if (!url) return Promise.resolve({ ok: false, error: L("Notifier not configured", "Notificador não configurado") });
    return window.firebase.auth().currentUser.getIdToken().then(function (tok) {
      return fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ idToken: tok, kind: kind, ws: WS, lang: "pt", brand: window.CMCOLLAB_BRAND || "" }, extra || {})) });
    }).then(function (r) { return r.json(); }).then(function (j) { if (j && !j.ok) console.info("notifier:", kind, j.error); return j; }).catch(function (e) { console.info("notifier:", e.message); return { ok: false, error: e.message }; });
  }

  /* ---------------- AI (same provider and daily limit as the rest of the platform; no names are sent) ---------------- */
  function aiOn() { if (S().ai === false) { toast(L("AI is off in this module (Settings).", "A IA está desligada neste módulo (Configurações).")); return false; } if (!window.CMAI || !window.CMAI.generate) { toast(L("AI unavailable right now.", "IA indisponível neste momento.")); return false; } return true; }
  function aiBusy(b, on) { if (!b) return; b.disabled = on; if (on) { b.dataset.t = b.innerHTML; b.innerHTML = IC("spark", 14) + " " + esc(L("Thinking…", "Analisando…")); } else if (b.dataset.t) b.innerHTML = b.dataset.t; }
  function aiLog(what, n) { sref("settings/aiLog/" + db.ref().push().key).set({ what: what, n: n || 0, at: Date.now(), by: me.email }).catch(function () { /* optional */ }); }
  function aiNote() { return '<p class="muted small st-ainote">' + IC("lock", 12) + " " + esc(L("Only aggregated numbers and the description go to the AI – no names, registration or diagnosis. AI can make mistakes: review before deciding.", "Só números agregados e a descrição vão para a IA – sem nomes, matrícula ou diagnóstico. A IA pode errar: revise antes de decidir.")) + "</p>"; }
  function aiRecord(r, d) {
    if (!aiOn()) return; const b = d.querySelector("#sdAi"); aiBusy(b, true);
    const T = TYPES()[r.type] || {};
    const prompt = "Você é especialista em Saúde e Segurança do Trabalho no Brasil (NRs, PGR/NR-01, PCMSO/NR-07, eSocial). Analise a ocorrência e responda SOMENTE em JSON: " +
      '{"causa":"análise de causa raiz em 5 porquês, texto curto","fatores":["fator contribuinte"],"acoes":[{"t":"ação objetiva","prazoDias":7,"tipo":"eliminar|substituir|engenharia|administrativa|EPI"}],"nrs":["NR-xx – motivo"],"recorrencia":"baixa|média|alta","comunicacao":"mensagem curta para o DDS"}. ' +
      "Siga a hierarquia de controles (eliminar antes de EPI). Máximo 5 ações. Não invente diagnóstico médico. Dados: tipo=" + (T.n || r.type) + "; título=" + (r.title || "") + "; gravidade=" + (r.severity || "-") + "; local=" + (r.place || "-") + "; com afastamento=" + (r.leave ? "sim" : "não") + "; descrição=" + String(r.desc || "").slice(0, 1200);
    window.CMAI.generate("sst-record", prompt).then(function (x) {
      aiBusy(b, false); if (!x || (!x.causa && !(x.acoes || []).length)) return toast(L("The AI returned nothing useful.", "A IA não devolveu sugestões."));
      aiCache[r.id] = x; aiShow(r, document.getElementById("stDrawer") || d);
    }, function (e) { aiBusy(b, false); fail(e); });
  }
  const aiCache = {};
  function aiShow(r, d) {
    const x = aiCache[r.id], box = d && d.querySelector("#sdAiOut"); if (!x || !box) return;
    { const acts = (x.acoes || []).slice(0, 5);
      box.innerHTML = '<div class="st-aibox"><div class="st-head2"><b>' + IC("spark", 15) + " " + esc(L("AI suggestion", "Sugestão da IA")) + '</b><span class="st-chip ' + (x.recorrencia === "alta" ? "bad" : x.recorrencia === "média" ? "warn" : "good") + '">' + esc(L("Recurrence risk: ", "Risco de recorrência: ")) + esc(x.recorrencia || "–") + "</span></div>" +
        (x.causa ? "<p><b>" + esc(L("Root cause", "Causa raiz")) + ":</b> " + esc(x.causa) + '</p><button class="pl-btn sm" id="aiUseCause">' + esc(L("Use as root cause", "Usar como causa raiz")) + "</button>" : "") +
        ((x.fatores || []).length ? '<p class="small"><b>' + esc(L("Contributing factors", "Fatores contribuintes")) + ":</b> " + esc(x.fatores.join(" · ")) + "</p>" : "") +
        (acts.length ? '<div class="st-ailist">' + acts.map(function (a, i) { return '<div class="st-li"><span><b>' + esc(a.t) + '</b> <span class="muted small">' + esc((a.tipo ? a.tipo + " · " : "") + L("in ", "em ") + (a.prazoDias || 7) + L(" days", " dias")) + '</span></span><button class="pl-btn sm primary" data-aiadd="' + i + '">' + esc(L("Add action", "Adicionar ação")) + "</button></div>"; }).join("") + '</div><button class="pl-btn sm" id="aiAddAll">' + esc(L("Add all actions", "Adicionar todas as ações")) + "</button>" : "") +
        ((x.nrs || []).length ? '<p class="small"><b>NRs:</b> ' + esc(x.nrs.join(" · ")) + "</p>" : "") + (x.comunicacao ? '<p class="small"><b>DDS:</b> ' + esc(x.comunicacao) + "</p>" : "") + aiNote() + "</div>";
      const add = function (a) { const due = new Date(Date.now() + (Number(a.prazoDias) || 7) * DAY).toISOString().slice(0, 10); return sref("records/" + r.id + "/actions/" + db.ref().push().key).set({ t: String(a.t).slice(0, 200), due: due, at: Date.now(), by: me.email, ai: true }); };
      const uc = box.querySelector("#aiUseCause"); if (uc) uc.onclick = function () { const f = d.querySelector("#sdF"); if (f && f.rootCause) { f.rootCause.value = x.causa; f.rootCause.dispatchEvent(new Event("input", { bubbles: true })); toast(L("Filled in – click Save", "Preenchido – clique em Salvar")); } };
      box.querySelectorAll("[data-aiadd]").forEach(function (bt) { bt.onclick = function () { bt.disabled = true; x.added = x.added || {}; x.added[bt.dataset.aiadd] = 1; add(acts[bt.dataset.aiadd]).then(function () { aiLog("record-action", 1); toast(L("Action added", "Ação adicionada")); }, fail); }; });
      const aa = box.querySelector("#aiAddAll"); if (aa) aa.onclick = function () { aa.disabled = true; const todo = acts.filter(function (a0, i) { return !(x.added || {})[i]; }); x.added = {}; acts.forEach(function (a0, i) { x.added[i] = 1; }); Promise.all(todo.map(add)).then(function () { aiLog("record-action", todo.length); toast(todo.length + " " + L("actions added", "ações adicionadas")); }, fail); };
      box.querySelectorAll("[data-aiadd]").forEach(function (bt) { if ((x.added || {})[bt.dataset.aiadd]) bt.disabled = true; });
    }
  }
  function panelFacts() {
    const R = recs(), y0 = new Date(new Date().getFullYear(), 0, 1).getTime(), yr = R.filter(function (r) { return (r.when || r.created) >= y0 && r.status !== "cancel"; }), dd = dues(), A0 = absStats();
    return { acidentesComAfastamentoAno: yr.filter(function (r) { return isAcc(r) && r.leave; }).length, acidentesSemAfastamentoAno: yr.filter(function (r) { return isAcc(r) && !r.leave; }).length, quaseAcidentesAno: yr.filter(function (r) { return r.type === "near" || r.type === "unsafe"; }).length,
      catEmAtraso: R.filter(catLate).length, registrosAbertos: R.filter(isOpen).length, asoVencidos: dd.filter(function (x) { return x.kind === "exam" && x.st === "late"; }).length, asoVencem30d: dd.filter(function (x) { return x.kind === "exam" && x.st === "soon"; }).length,
      nrVencidos: dd.filter(function (x) { return x.kind === "training" && x.st === "late"; }).length, nrVencem30d: dd.filter(function (x) { return x.kind === "training" && x.st === "soon"; }).length, epiVencidos: dd.filter(function (x) { return x.kind === "ppe" && x.st === "late"; }).length,
      absenteismoMesPct: A0.rateMonth == null ? null : Number(A0.rateMonth.toFixed(2)), metaAbsenteismoPct: A0.target, diasPerdidos12m: A0.days12, custoEstimado12m: A0.cost, afastadosAgora: A0.away.length, retornosEm7dias: A0.back7.length, reincidentes: A0.repeat.length,
      absPorMotivo: A0.byKind.map(function (x) { return x.n + ": " + x.v + " dias"; }), absPorSetor: A0.bySector.slice(0, 5).map(function (x) { return x.n + ": " + x.v + " dias"; }) };
  }
  function aiPanel(b) {
    if (!aiOn()) return; aiBusy(b, true);
    const prompt = "Você é diretor(a) de Saúde e Segurança do Trabalho de uma indústria no Brasil. Com os números abaixo (dados agregados, sem nomes), escreva um resumo executivo para a liderança. Responda SOMENTE em JSON: " +
      '{"titulo":"frase curta","resumo":"3 a 4 frases","prioridades":[{"t":"o que fazer esta semana","porque":"impacto"}],"riscos":["risco legal ou operacional"],"ganhos":["ganho esperado ao agir"]}. Máximo 4 prioridades. Cite eSocial (S-2210/S-2220) e NR-07 quando fizer sentido. Números: ' + JSON.stringify(panelFacts());
    window.CMAI.generate("sst-panel", prompt).then(function (x) {
      aiBusy(b, false); if (!x || !x.resumo) return toast(L("The AI returned nothing useful.", "A IA não devolveu sugestões.")); aiLog("panel", 1);
      const txt = (x.titulo || "") + "\n\n" + x.resumo + "\n\n" + L("Priorities", "Prioridades") + ":\n" + (x.prioridades || []).map(function (p) { return "• " + p.t + (p.porque ? " – " + p.porque : ""); }).join("\n") + ((x.riscos || []).length ? "\n\n" + L("Risks", "Riscos") + ":\n• " + x.riscos.join("\n• ") : "") + ((x.ganhos || []).length ? "\n\n" + L("Gains", "Ganhos") + ":\n• " + x.ganhos.join("\n• ") : "");
      modal("<h2>" + IC("spark", 18) + " " + esc(x.titulo || L("Executive summary", "Resumo executivo")) + '</h2><p>' + esc(x.resumo) + "</p>" +
        ((x.prioridades || []).length ? '<h3 class="st-h3">' + esc(L("Priorities this week", "Prioridades da semana")) + '</h3><ol class="st-aiol">' + x.prioridades.map(function (p) { return "<li><b>" + esc(p.t) + "</b>" + (p.porque ? ' <span class="muted small">' + esc(p.porque) + "</span>" : "") + "</li>"; }).join("") + "</ol>" : "") +
        ((x.riscos || []).length ? '<h3 class="st-h3">' + esc(L("Risks", "Riscos")) + "</h3><ul>" + x.riscos.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" : "") +
        ((x.ganhos || []).length ? '<h3 class="st-h3">' + esc(L("Expected gains", "Ganhos esperados")) + "</h3><ul>" + x.ganhos.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" : "") + aiNote() +
        '<div class="pl-row-end"><button class="pl-btn" id="aiCopy">' + esc(L("Copy", "Copiar")) + '</button><button class="pl-btn primary" data-close>' + esc(L("Close", "Fechar")) + "</button></div>", function (box) {
        box.querySelector(".pl-card").classList.add("wide");
        box.querySelector("#aiCopy").onclick = function () { (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast(L("Copied", "Copiado")); }, function () { toast(L("Copy not allowed here", "Cópia não permitida aqui")); }); };
      });
    }, function (e) { aiBusy(b, false); fail(e); });
  }

  /* ---------------- absenteeism (Absenteísmo) ----------------
     Absence = record type "leave" (+ accidents/diseases "with lost time"). Fields: absKind, absStart (YYYY-MM-DD), absEnd (expected return), returned, daysLost.
     settings: absHeadcount (workforce; default = active employees), absTarget (% goal), absDayCost (average cost of one day away),
     absPlan/<id>{t, owner, due, done, ind, ai, plan?{pid,item}} = control actions of the absenteeism programme. */
  function ABSK() { return [["short", L("Medical certificate (up to 15 days)", "Atestado médico (até 15 dias)")], ["inss", L("Social security leave (over 15 days)", "Afastamento previdenciário – INSS (mais de 15 dias)")], ["work", L("Work accident / occupational disease", "Acidente / doença do trabalho")], ["family", L("Family care / legal leaves", "Acompanhamento familiar / licenças legais")], ["unjust", L("Unjustified absence", "Falta não justificada")], ["other", L("Other", "Outro")]]; }
  function absKindName(k) { const x = ABSK().find(function (a) { return a[0] === k; }); return x ? x[1] : L("Not informed", "Não informado"); }
  function dS(t) { const d = new Date(t); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function dayN(s) { return Math.round(Date.parse(s + "T12:00:00Z") / DAY); }
  function absList() {
    return recs().filter(function (r) { return r.status !== "cancel" && (r.type === "leave" || (isAcc(r) && r.leave)); }).map(function (r) {
      const start = r.absStart || dS(r.when || r.created || Date.now()), n = Number(r.daysLost) || 0;
      const end = r.absEnd || (n ? dS(Date.parse(start + "T12:00:00") + (n - 1) * DAY) : start), p = r.personId && data.people && data.people[r.personId];
      return { r: r, start: start, end: end, days: n || Math.max(1, dayN(end) - dayN(start) + 1), kind: r.absKind || (isAcc(r) ? "work" : ""), sector: (p && p.sector) || r.place || L("Not informed", "Não informado"), who: r.personId || (r.person || "").toLowerCase() };
    });
  }
  function absStats() {
    const s = S(), list = absList(), today = todayS(), tN = dayN(today), headA = people().filter(function (p) { return p.active !== false; }).length, head = Number(s.absHeadcount) || headA;
    const months = []; for (let i = 11; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); months.push(ym(d.getTime())); }
    const rows = months.map(function (m) {
      const a = dayN(m + "-01"), dim = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate(), b = a + dim - 1, cut = m === ym(Date.now()) ? Math.min(b, tN) : b;
      let days = 0; list.forEach(function (x) { const s0 = Math.max(a, dayN(x.start)), e0 = Math.min(cut, dayN(x.end)); if (e0 >= s0) days += e0 - s0 + 1; });
      const span = cut - a + 1; return { m: m, n: monLabel(m), days: days, rate: head && span > 0 ? days / (head * span) * 100 : null };
    });
    const y0 = dayN(months[0] + "-01"), in12 = list.filter(function (x) { return dayN(x.end) >= y0; }), days12 = rows.reduce(function (t, r) { return t + r.days; }, 0);
    const agg = function (f) { const o = {}; in12.forEach(function (x) { const k = f(x); const s0 = Math.max(y0, dayN(x.start)), e0 = Math.min(tN, dayN(x.end)); o[k] = (o[k] || 0) + Math.max(0, e0 - s0 + 1); }); return Object.keys(o).map(function (k) { return { n: k, v: o[k] }; }).filter(function (x) { return x.v > 0; }).sort(function (a, b) { return b.v - a.v; }); };
    const cnt = {}; in12.forEach(function (x) { if (x.who) cnt[x.who] = (cnt[x.who] || 0) + 1; });
    const cur = rows[rows.length - 1];
    return { head: head, headA: headA, rows: rows, list: list, rateMonth: cur.rate, target: Number(s.absTarget) || null, days12: days12, cost: Number(s.absDayCost) ? days12 * Number(s.absDayCost) : null,
      away: list.filter(function (x) { return !x.r.returned && dayN(x.start) <= tN && dayN(x.end) >= tN; }), back7: list.filter(function (x) { return !x.r.returned && dayN(x.end) >= tN && dayN(x.end) <= tN + 7; }),
      repeat: Object.keys(cnt).filter(function (k) { return cnt[k] >= 3; }), byKind: agg(function (x) { return absKindName(x.kind); }), bySector: agg(function (x) { return x.sector; }) };
  }
  function money(v) { return v == null ? "–" : v.toLocaleString(LOC, { style: "currency", currency: S().absCurrency || "BRL", maximumFractionDigits: 0 }); }
  function absView(v) {
    const A0 = absStats(), s = S(), plan = Object.keys(s.absPlan || {}).map(function (k) { return Object.assign({ id: k }, s.absPlan[k]); }).sort(function (a, b) { return (a.done ? 1 : 0) - (b.done ? 1 : 0) || String(a.due || "9").localeCompare(String(b.due || "9")); });
    const tile = function (ic, val, lbl, cls, sub) { return '<div class="st-tile' + (cls ? " " + cls : "") + '"><span class="st-ti">' + IC(ic, 18) + "</span><b>" + val + "</b><span>" + esc(lbl) + "</span>" + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</div>"; };
    const over = A0.rateMonth != null && A0.target != null && A0.rateMonth > A0.target, ppl = members(), today = todayS();
    const hb = function (arr) { if (!arr.length) return '<p class="muted small">' + esc(L("No absences in the period.", "Sem ausências no período.")) + "</p>"; const mx = arr[0].v; return '<div class="st-hbars">' + arr.slice(0, 7).map(function (x) { return "<div><span>" + esc(x.n) + '</span><i style="width:' + Math.max(4, x.v / mx * 100) + '%;background:#5c6b80"></i><b>' + x.v + "</b></div>"; }).join("") + "</div>"; };
    const rateRows = A0.rows.map(function (r) { return { n: r.n, a: r.rate == null ? 0 : Math.round(r.rate * 100) / 100 }; });
    v.innerHTML = '<div class="st-wrap"><div class="st-tiles">' +
      tile("trend", A0.rateMonth == null ? "–" : nf(A0.rateMonth, 2) + "%", L("absenteeism this month", "absenteísmo no mês"), over ? "bad" : A0.rateMonth != null ? "good" : "", A0.target != null ? L("target ≤ ", "meta ≤ ") + nf(A0.target, 1) + "% · " + L("workforce ", "efetivo ") + nf(A0.head) : L("set the target in Settings", "defina a meta em Configurações")) +
      tile("calendar", nf(A0.days12), L("days lost (12 months)", "dias perdidos (12 meses)"), "", A0.cost != null ? money(A0.cost) + L(" estimated cost", " de custo estimado") : L("set the cost per day in Settings", "informe o custo/dia em Configurações")) +
      tile("people", nf(A0.away.length), L("away today", "afastados hoje"), A0.away.length ? "warn" : "") +
      tile("clock", nf(A0.back7.length), L("returns in 7 days", "retornos em 7 dias"), A0.back7.length ? "warn" : "", L("schedule the return-to-work exam", "agende o ASO de retorno")) +
      tile("alert", nf(A0.repeat.length), L("recurring (3+ absences in 12 months)", "reincidentes (3+ ausências em 12 meses)"), A0.repeat.length ? "bad" : "") +
      tile("task", nf(plan.filter(function (a) { return !a.done; }).length), L("control actions open", "ações de controle abertas"), plan.some(function (a) { return !a.done && a.due && a.due < today; }) ? "warn" : "") + "</div>" +
      '<div class="st-grid2"><section class="st-card"><div class="st-head2"><h3>' + esc(L("Absenteeism rate – 12 months (%)", "Taxa de absenteísmo – 12 meses (%)")) + '</h3></div><div class="st-scroll">' + bars(rateRows, [{ k: "a", n: L("% of scheduled days lost", "% dos dias previstos perdidos"), c: "#5c6b80" }]) + '</div><p class="muted small">' + esc(L("Rate = days away ÷ (workforce × days of the month) × 100. Workforce and target in Settings.", "Taxa = dias de ausência ÷ (efetivo × dias do mês) × 100. Efetivo e meta em Configurações.")) + "</p></section>" +
      '<section class="st-card"><h3>' + esc(L("Days lost by reason", "Dias perdidos por motivo")) + "</h3>" + hb(A0.byKind) + '<h3 class="st-h3">' + esc(L("By sector", "Por setor")) + "</h3>" + hb(A0.bySector) + "</section></div>" +
      '<section class="st-card"><div class="st-head2"><h3>' + esc(L("Away and returning", "Afastados e retornos")) + '</h3><button class="pl-btn sm" id="abNew">' + IC("plus", 14) + " " + esc(L("Register absence", "Registrar afastamento")) + "</button></div>" +
      (A0.away.length || A0.back7.length ? '<div class="st-scroll"><table class="st-tbl"><thead><tr><th>' + esc(L("Record", "Registro")) + "</th><th>" + esc(L("Sector", "Setor")) + "</th><th>" + esc(L("Reason", "Motivo")) + "</th><th>" + esc(L("Since", "Desde")) + "</th><th>" + esc(L("Expected return", "Retorno previsto")) + "</th><th></th></tr></thead><tbody>" +
        A0.away.concat(A0.back7.filter(function (x) { return A0.away.indexOf(x) < 0; })).map(function (x) { const need = x.days >= 30; return '<tr><td><button class="link" data-open="' + x.r.id + '"><b>' + esc(x.r.key) + "</b> " + esc(x.r.person || x.r.title) + "</button></td><td>" + esc(x.sector) + "</td><td>" + esc(absKindName(x.kind)) + "</td><td>" + fmtS(x.start) + "</td><td>" + fmtS(x.end) + (need ? ' <span class="st-chip warn">' + esc(L("Return ASO (NR-07)", "ASO de retorno (NR-07)")) + "</span>" : "") + '</td><td><button class="pl-btn sm" data-back="' + x.r.id + '">' + esc(L("Returned", "Retornou")) + "</button></td></tr>"; }).join("") + "</tbody></table></div>"
        : '<p class="muted small">' + esc(L("Nobody away right now.", "Ninguém afastado agora.")) + "</p>") + "</section>" +
      '<section class="st-card"><div class="st-head2"><h3>' + IC("task", 16) + " " + esc(L("Absenteeism control programme", "Programa de controle do absenteísmo")) + '</h3><button class="pl-btn sm primary" id="abAi">' + IC("spark", 14) + " " + esc(L("Build the plan with AI", "Montar plano com IA")) + "</button></div>" +
      '<div id="abAiOut"></div>' +
      (plan.length ? plan.map(function (a) { const p = a.plan && plans.find(function (x) { return x.id === a.plan.pid; }); return '<div class="st-act' + (a.done ? " done" : "") + (!a.done && a.due && a.due < today ? " late" : "") + '"><label class="chk"><input type="checkbox" data-abdone="' + a.id + '"' + (a.done ? " checked" : "") + "> <span>" + esc(a.t) + (a.ai ? ' <span class="st-chip">IA</span>' : "") + '</span></label><small class="muted">' + esc([a.owner ? who(a.owner) : "", a.due ? L("until ", "até ") + fmtS(a.due) : "", a.ind ? L("indicator: ", "indicador: ") + a.ind : ""].filter(Boolean).join(" · ")) + "</small>" +
        (a.plan ? '<a class="st-plink" href="../planning/?id=' + encodeURIComponent(a.plan.pid) + "&item=" + encodeURIComponent(a.plan.item) + '">' + IC("planning", 13) + " " + esc(p ? p.title : L("planning", "planejamento")) + "</a>" : (plans.length ? '<button class="link sm" data-abplan="' + a.id + '">' + IC("planning", 13) + " " + esc(L("Take to a planning", "Levar para um planejamento")) + "</button>" : "")) + '<button class="link sm danger" data-abdel="' + a.id + '">' + esc(L("remove", "remover")) + "</button></div>"; }).join("") : '<p class="muted small">' + esc(L("No control actions yet. Add one or let the AI suggest a plan from your numbers.", "Nenhuma ação de controle ainda. Adicione ou deixe a IA sugerir um plano a partir dos seus números.")) + "</p>") +
      '<form class="st-addact" id="abAct"><input name="t" maxlength="200" required placeholder="' + esc(L("New action – e.g. return-to-work interview by the leader", "Nova ação – ex.: entrevista de retorno com a liderança")) + '"><select name="owner"><option value="">' + esc(L("Owner", "Responsável")) + "</option>" + Object.keys(ppl).map(function (k) { return opt(ppl[k].email, ppl[k].name || ppl[k].email, ""); }).join("") + '</select><input type="date" name="due"><button class="pl-btn sm primary">' + esc(L("Add", "Adicionar")) + "</button></form></section></div>";
    bindOpen(v);
    v.querySelector("#abNew").onclick = function () { recDialog(null, "leave"); };
    v.querySelectorAll("[data-back]").forEach(function (b) { b.onclick = function () { const id = b.dataset.back, r = data.records[id]; sref("records/" + id).update({ returned: true, absEnd: todayS() < (r.absEnd || "") ? todayS() : (r.absEnd || todayS()), status: r.type === "leave" ? "done" : r.status, closedAt: r.type === "leave" ? TS() : (r.closedAt || null), updated: TS() }).then(function () { toast(L("Return registered", "Retorno registrado")); }, fail); }; });
    v.querySelectorAll("[data-abdone]").forEach(function (c) { c.onchange = function () { sref("settings/absPlan/" + c.dataset.abdone + "/done").set(c.checked || null).catch(fail); }; });
    v.querySelectorAll("[data-abdel]").forEach(function (c) { c.onclick = function () { sref("settings/absPlan/" + c.dataset.abdel).remove().catch(fail); }; });
    v.querySelectorAll("[data-abplan]").forEach(function (c) { c.onclick = function () { absToPlanning(c.dataset.abplan); }; });
    const f = v.querySelector("#abAct");
    f.onsubmit = function (e) { e.preventDefault(); const a = { t: f.t.value.trim(), owner: f.owner.value || null, due: f.due.value || null, at: Date.now(), by: me.email }; if (!a.t) return; Object.keys(a).forEach(function (k) { if (a[k] === null) delete a[k]; }); sref("settings/absPlan/" + db.ref().push().key).set(a).catch(fail); };
    v.querySelector("#abAi").onclick = function (e) { aiAbs(e.currentTarget, v.querySelector("#abAiOut")); };
  }
  function aiAbs(b, out) {
    if (!aiOn()) return; aiBusy(b, true);
    const prompt = "Você é especialista em gestão de absenteísmo e saúde ocupacional no Brasil (NR-07/PCMSO, NR-01/PGR riscos psicossociais, eSocial S-2230). Com os números agregados abaixo (sem nomes), monte um programa de controle do absenteísmo. Responda SOMENTE em JSON: " +
      '{"diagnostico":"3 frases","acoes":[{"t":"ação concreta","prazoDias":30,"indicador":"como medir"}],"meta":"meta sugerida em % e prazo","ganho":"ganho estimado em dias/custo se a meta for atingida"}. Máximo 6 ações, práticas e respeitando a LGPD (sem expor pessoas). Números: ' + JSON.stringify(panelFacts());
    window.CMAI.generate("sst-abs", prompt).then(function (x) {
      aiBusy(b, false); const acts = ((x && x.acoes) || []).slice(0, 6); if (!acts.length) return toast(L("The AI returned nothing useful.", "A IA não devolveu sugestões."));
      out.innerHTML = '<div class="st-aibox"><p><b>' + esc(L("Diagnosis", "Diagnóstico")) + ":</b> " + esc(x.diagnostico || "") + "</p>" + (x.meta ? '<p class="small"><b>' + esc(L("Target", "Meta")) + ":</b> " + esc(x.meta) + "</p>" : "") + (x.ganho ? '<p class="small"><b>' + esc(L("Gain", "Ganho")) + ":</b> " + esc(x.ganho) + "</p>" : "") +
        '<div class="st-ailist">' + acts.map(function (a, i) { return '<div class="st-li"><span><b>' + esc(a.t) + '</b> <span class="muted small">' + esc((a.indicador ? a.indicador + " · " : "") + L("in ", "em ") + (a.prazoDias || 30) + L(" days", " dias")) + '</span></span><button class="pl-btn sm primary" data-aiab="' + i + '">' + esc(L("Add", "Adicionar")) + "</button></div>"; }).join("") + '</div><button class="pl-btn sm" id="aiAbAll">' + esc(L("Add all to the programme", "Adicionar todas ao programa")) + "</button>" + aiNote() + "</div>";
      const add = function (a) { return sref("settings/absPlan/" + db.ref().push().key).set({ t: String(a.t).slice(0, 200), due: new Date(Date.now() + (Number(a.prazoDias) || 30) * DAY).toISOString().slice(0, 10), ind: a.indicador ? String(a.indicador).slice(0, 120) : null, ai: true, at: Date.now(), by: me.email }); };
      out.querySelectorAll("[data-aiab]").forEach(function (bt) { bt.onclick = function () { bt.disabled = true; add(acts[bt.dataset.aiab]).then(function () { aiLog("abs-action", 1); }, fail); }; });
      out.querySelector("#aiAbAll").onclick = function () { Promise.all(acts.map(add)).then(function () { aiLog("abs-action", acts.length); toast(acts.length + " " + L("actions added", "ações adicionadas")); }, fail); };
    }, function (e) { aiBusy(b, false); fail(e); });
  }
  function absToPlanning(aid) {
    const a = (S().absPlan || {})[aid]; if (!a) return;
    modal("<h2>" + esc(L("Take the action to a planning", "Levar a ação para um planejamento")) + '</h2><form class="pl-form" id="tpA"><label>' + esc(L("Planning", "Planejamento")) + '<select name="p">' + plans.map(function (p) { return opt(p.id, p.title, ""); }).join("") + '</select></label><div class="pl-row-end"><button type="button" class="pl-btn" data-close>' + esc(L("Cancel", "Cancelar")) + '</button><button class="pl-btn primary">' + esc(L("Create task", "Criar tarefa")) + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#tpA");
      f.onsubmit = function (e) {
        e.preventDefault(); const pid = f.p.value, P = plans.find(function (x) { return x.id === pid; }) || {};
        const st = ((kpiCache[pid] || {}).settings || {}).statuses || ((window.PLAN_METHODS || {})[P.method] || {}).statuses || [{ id: "todo" }];
        const first = (st.find(function (s) { return s.cat === "todo" && s.stage !== "up"; }) || st[0]).id, prefix = ((kpiCache[pid] || {}).settings || {}).prefix || "PLN";
        db.ref("planning/" + pid + "/data/settings/seq").transaction(function (n) { return (n || 0) + 1; }).then(function (res) {
          const iid = db.ref().push().key, it = { type: "task", title: a.t, status: first, order: Date.now(), created: TS(), by: me.email, key: prefix + "-" + res.snapshot.val(), desc: L("Absenteeism control programme", "Programa de controle do absenteísmo") + (a.ind ? " · " + L("indicator: ", "indicador: ") + a.ind : ""), src: { sst: WS, abs: aid } };
          if (a.owner) it.assignee = a.owner; if (a.due) it.end = a.due;
          return db.ref("planning/" + pid + "/data/items/" + iid).set(it).then(function () { return sref("settings/absPlan/" + aid + "/plan").set({ pid: pid, item: iid }); });
        }).then(function () { close(); toast(L("Task created in the planning", "Tarefa criada no planejamento")); }, fail);
      };
    });
  }

  /* ---------------- settings ---------------- */
  function cfgView(v) {
    const s = S(), hht = s.hht || {}, months = [], nt = s.notify || {}, ppl = members(), owner = ((wss[WS] || {}).info || {}).owner;
    for (let i = 11; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); months.push(ym(d.getTime())); }
    const emails = Object.keys(ppl).map(function (k) { return ppl[k].email; }).filter(Boolean), log = s.aiLog || {}, aiN = Object.keys(log).reduce(function (t, k) { return t + (Number(log[k].n) || 1); }, 0);
    v.innerHTML = '<div class="st-wrap"><form class="st-card pl-form" id="cfF"><h3>' + esc(L("Settings of the module", "Configurações do módulo")) + "</h3>" +
      "<label>" + esc(L("Places / sectors (one per line)", "Locais / setores (um por linha)")) + '<textarea name="places" rows="4">' + esc((s.places || []).join("\n")) + "</textarea></label>" +
      '<div class="pl-2"><label>' + esc(L("Investigation deadline (days)", "Prazo de investigação (dias)")) + '<input type="number" min="1" name="invDays" value="' + esc(s.invDays || 7) + '"></label><label>' + esc(L("Deadline for requests – PPE, exams, suggestions (days)", "Prazo das solicitações – EPI, exames, sugestões (dias)")) + '<input type="number" min="1" name="reqDays" value="' + esc(s.reqDays || 5) + '"></label></div>' +
      '<fieldset class="st-fs"><legend>' + esc(L("Man-hours worked per month (for FR and SR)", "Horas-homem trabalhadas por mês (para TF e TG)")) + '</legend><div class="st-hht">' + months.map(function (m) { return "<label>" + esc(monLabel(m)) + '<input type="number" min="0" step="any" name="h_' + m + '" value="' + esc(hht[m] == null ? "" : hht[m]) + '"></label>'; }).join("") + "</div></fieldset>" +
      '<fieldset class="st-fs"><legend>' + esc(L("Absenteeism", "Absenteísmo")) + '</legend><div class="pl-3"><label>' + esc(L("Workforce (headcount)", "Efetivo (headcount)")) + '<input type="number" min="0" name="absHeadcount" value="' + esc(s.absHeadcount || "") + '" placeholder="' + people().filter(function (p) { return p.active !== false; }).length + '"></label><label>' + esc(L("Target – maximum rate (%)", "Meta – taxa máxima (%)")) + '<input type="number" min="0" step="0.1" name="absTarget" value="' + esc(s.absTarget || "") + '" placeholder="2,5"></label><label>' + esc(L("Average cost of one day away", "Custo médio de um dia de ausência")) + '<input type="number" min="0" step="any" name="absDayCost" value="' + esc(s.absDayCost || "") + '" placeholder="R$"></label></div></fieldset>' +
      '<fieldset class="st-fs"><legend>' + IC("bell", 14) + " " + esc(L("E-mail notifications", "Notificações por e-mail")) + '</legend><p class="muted small">' + esc(L("Sent by the platform (Digital Agile Technology account) only to members of this workspace.", "Enviadas pela plataforma (conta Digital Agile Technology) somente para membros deste workspace.")) + "</p>" +
        '<div class="st-ntto">' + emails.map(function (e) { return '<label class="chk"><input type="checkbox" name="nto" value="' + esc(e) + '"' + ((nt.to || []).indexOf(e) >= 0 ? " checked" : "") + "> " + esc(e) + "</label>"; }).join("") + (emails.length ? "" : '<p class="muted small">' + esc(L("Invite people to the workspace first.", "Convide pessoas para o workspace primeiro.")) + "</p>") + "</div>" +
        '<label class="chk"><input type="checkbox" name="ndaily"' + (nt.daily !== false ? " checked" : "") + "> " + esc(L("Daily summary at 08:00 (only when something needs attention)", "Resumo diário às 08:00 (só quando houver algo pendente)")) + "</label>" +
        '<label>' + esc(L("Warn about exams, NR and PPE due within", "Avisar exames, NR e EPI que vencem em até")) + '<select name="ndays">' + [7, 15, 30, 60].map(function (n) { return opt(n, n + L(" days", " dias"), nt.days || 30); }).join("") + "</select></label>" +
        '<label class="chk"><input type="checkbox" name="ninstant"' + (nt.instant !== false ? " checked" : "") + "> " + esc(L("Immediate alert for accidents, diseases, absences and serious occurrences", "Alerta imediato de acidentes, doenças, afastamentos e ocorrências graves")) + "</label>" +
        '<div class="pl-row"><button type="button" class="pl-btn" id="ntNow">' + IC("send", 14) + " " + esc(L("Send the alert summary now", "Enviar o resumo de alertas agora")) + '</button><span class="muted small" id="ntMsg"></span></div></fieldset>' +
      '<fieldset class="st-fs"><legend>' + IC("spark", 14) + " " + esc(L("Artificial intelligence", "Inteligência artificial")) + '</legend><label class="chk"><input type="checkbox" name="ai"' + (s.ai !== false ? " checked" : "") + "> " + esc(L("Enable AI (root cause, action plans, executive summary, absenteeism programme)", "Ligar a IA (causa raiz, planos de ação, resumo executivo, programa de absenteísmo)")) + '</label><p class="muted small">' + esc(L("Governance: ", "Governança: ")) + aiN + esc(L(" AI suggestions accepted in this module so far.", " sugestões da IA aceitas neste módulo até agora.")) + "</p></fieldset>" +
      '<div class="pl-row-end"><button class="pl-btn primary">' + esc(L("Save", "Salvar")) + "</button></div></form></div>";
    const f = v.querySelector("#cfF");
    f.onsubmit = function (e) {
      e.preventDefault();
      const u = { places: f.places.value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean), invDays: Number(f.invDays.value) || 7, reqDays: Number(f.reqDays.value) || 5, hht: Object.assign({}, hht),
        absHeadcount: Number(f.absHeadcount.value) || null, absTarget: f.absTarget.value === "" ? null : Number(String(f.absTarget.value).replace(",", ".")), absDayCost: Number(f.absDayCost.value) || null, ai: f.ai.checked,
        notify: { to: [].slice.call(f.querySelectorAll("[name=nto]:checked")).map(function (x) { return x.value; }), daily: f.ndaily.checked, days: Number(f.ndays.value) || 30, instant: f.ninstant.checked } };
      months.forEach(function (m) { const x = f["h_" + m].value; if (x === "") delete u.hht[m]; else u.hht[m] = Number(x); });
      sref("settings").update(u).then(function () { toast(L("Settings saved", "Configurações salvas")); }, fail);
    };
    v.querySelector("#ntNow").onclick = function (e) {
      const b = e.currentTarget, m = v.querySelector("#ntMsg"); if (!(NT().to || []).length) { m.textContent = L("Choose the recipients and save first.", "Escolha os destinatários e salve primeiro."); return; }
      b.disabled = true; m.textContent = L("Sending…", "Enviando…");
      notify("sst-digest", { days: NT().days || 30 }).then(function (j) { b.disabled = false; m.textContent = j && j.ok ? (j.empty ? L("Nothing pending – no e-mail needed.", "Nada pendente – nenhum e-mail necessário.") : L("Sent to ", "Enviado para ") + (j.sent || []).join(", ")) : L("Could not send: ", "Não foi possível enviar: ") + ((j && j.error) || ""); });
    };
    void owner;
  }

  start();
})();
