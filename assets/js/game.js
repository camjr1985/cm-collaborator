/* CM Collaborator – Business Game (add-on module "game", page /game/?id=<id>; new game: /game/?new=1&ws=<ws>).
 *
 * Data (Realtime Database):
 *   game/<id>/info                 { title, ws, plan?, status: setup|running|finished, created, createdBy }
 *   game/<id>/config               { scenario, params, rounds, deadlineH, weights, decisions{id:false}, currency{code}|{custom,name,symbol,decimals},
 *                                    country, lang, brand{name,logo,color}, planTeams{teamId:itemId}, attachWs }
 *   game/<id>/teams/<t>            { name, color, order, boards{swot,leancanvas,okr} }
 *   game/<id>/people/<emailKey>    { email, name, role: prof|student, team }
 *   game/<id>/rounds/<n>           { status: open|done, opened, deadline, events[{type,k}], processed }
 *   game/<id>/decisions/<n>/<t>    { price, qty, mkt, rd, hire, train, invest, loan, amort, strategic{k:{title,type,item?}}, by, at, auto? }
 *   game/<id>/results/<n>/public   { market, ranking{t:{score,cumNI,value,sat,share,avgShare,sales,price,ni}}, at, version }
 *   game/<id>/results/<n>/teams/<t> full result of the team (DRE, balance sheet, cash flow, next state) – own team + professors only
 *   game/<id>/debrief              { auto, ai, board, at }
 *   workspaces/<ws>/games/<id>     index { title, scenario, created }
 *   userGames/<emailKey>/<id>      index for "My games" { title, role, team }
 *   workspaces/<ws>/gameTemplates/<tplId>  institution model { name, scenario, params, decisions, weights, currency, country, lang, brand, rounds }
 *
 * Results are computed in the professor's browser with the pure engine (game-engine.js) when the round is closed.
 * Access is enforced by database.rules.json (professors: admin / workspace owner / invited professor with the "game" licence;
 * students: only their team's decisions while the round is open).
 */
(function () {
  "use strict";
  const A = window.CMAuth, E = window.CMGameEngine;
  const app = document.getElementById("app");
  const QS = new URLSearchParams(location.search);
  const ID = (QS.get("id") || "").toLowerCase();
  const NEW_WS = QS.get("new") ? (QS.get("ws") || "") : "";
  const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#6250d6"];
  const LANGS = { pt: "Português (Brasil)", "pt-pt": "Português (Portugal)", en: "English", es: "Español" };
  const LOCALE = { pt: "pt-BR", "pt-pt": "pt-PT", en: "en-GB", es: "es-ES" };
  const COUNTRIES = { "": "", BR: "pt-BR", PT: "pt-PT", AO: "pt-AO", MZ: "pt-MZ", CV: "pt-CV", US: "en-US", GB: "en-GB", ES: "es-ES", MX: "es-MX", AR: "es-AR", CO: "es-CO", CL: "es-CL", PE: "es-PE", UY: "es-UY", FR: "fr-FR", DE: "de-DE" };
  const DAY = 86400000;

  /* ---------------- language ---------------- */
  /* same language as the rest of the platform (i18n.js: en · pt · pt-pt · es, saved in cmcollab:lang);
     without a saved choice, the game's default language (config.lang) wins over the browser language */
  let langFromUser = (function () { try { return !!localStorage.getItem("cmcollab:lang"); } catch (e) { return false; } })();
  let LANG = LANGS[window.MB_VARIANT] ? window.MB_VARIANT : (window.MB_LANG === "pt" ? "pt" : "en");
  function X(pt, en, es, pp) { return LANG === "en" ? en : LANG === "es" ? (es || en) : LANG === "pt-pt" ? (pp || (window.MBptpt ? window.MBptpt(pt) : pt)) : pt; }

  /* ---------------- state ---------------- */
  let db, me, ME, isAdm = false, role = null, myTeam = null;
  let info = {}, cfg = {}, teams = {}, people = {}, rounds = {}, decisions = {}, results = {}, debrief = null;
  let wsInfo = {}, wsPlans = {}, wsTemplates = {};
  let view = "overview", selTeam = null, selRound = null, cdTimer = null, booted = false;
  const subs = {};

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function TS() { return window.firebase.database.ServerValue.TIMESTAMP; }
  function IC(n, s) { return window.CMIcon ? window.CMIcon(n, s || 15) : ""; }
  function rnd() { return Math.random().toString(36).slice(2, 6); }
  function slug(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40); }
  function toast(msg) {
    let n = document.getElementById("toast");
    if (!n) { n = document.createElement("div"); n.id = "toast"; n.className = "gm-toast"; n.setAttribute("role", "status"); document.body.appendChild(n); }
    n.textContent = msg; n.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { n.classList.remove("show"); }, 3200);
  }
  function fail(e) { console.warn(e); toast((e && e.message) || X("Algo deu errado", "Something went wrong", "Algo salió mal")); }
  function isProf() { return role === "prof"; }

  /* ---------------- money & numbers ---------------- */
  function locale() {
    if (cfg.country && COUNTRIES[cfg.country]) return COUNTRIES[cfg.country];
    const c = (cfg.currency || {}).code, byCur = { AOA: "pt-AO", MZN: "pt-MZ", CVE: "pt-CV", BRL: "pt-BR" };
    if ((LANG === "pt" || LANG === "pt-pt") && byCur[c]) return byCur[c];
    if (LANG === "pt" && c === "EUR") return "pt-PT";
    return LOCALE[LANG] || "pt-BR";
  }
  function curr() { return cfg.currency || { code: "BRL" }; }
  function money(v, dec) {
    const c = curr(), d = dec == null ? 0 : dec;
    v = Number(v) || 0;
    if (c.custom) {
      const n = new Intl.NumberFormat(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
      return (c.symbol || "¤") + " " + n;
    }
    try { return new Intl.NumberFormat(locale(), { style: "currency", currency: c.code || "BRL", minimumFractionDigits: d, maximumFractionDigits: d }).format(v); }
    catch (e) { return (c.code || "") + " " + Math.round(v); }
  }
  function cdec() { const c = curr(); if (c.custom) return +c.decimals || 0; try { return new Intl.NumberFormat("en", { style: "currency", currency: c.code }).resolvedOptions().maximumFractionDigits; } catch (e) { return 2; } }
  function num(v, d) { return new Intl.NumberFormat(locale(), { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }).format(Number(v) || 0); }
  function pct(v) { return new Intl.NumberFormat(locale(), { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(v) || 0); }
  function dt(t) { return t ? new Date(t).toLocaleString(LOCALE[LANG], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "–"; }
  function curName(code) { try { return new Intl.DisplayNames([LOCALE[LANG]], { type: "currency" }).of(code); } catch (e) { return code; } }
  function allCurrencies() {
    let list = [];
    try { list = Intl.supportedValuesOf("currency"); } catch (e) { list = ["BRL", "EUR", "AOA", "USD", "GBP", "MZN", "CVE", "MXN", "ARS", "COP", "CLP", "PEN", "UYU"]; }
    const top = ["BRL", "EUR", "AOA", "USD", "MZN", "CVE", "GBP"];
    return top.concat(list.filter(function (c) { return top.indexOf(c) < 0; }));
  }

  /* ---------------- vocabulary (accounting terms per language) ---------------- */
  function W(k) {
    const D = {
      team: [X("Equipe", "Team", "Equipo", "Equipa")], teams: [X("Equipes", "Teams", "Equipos", "Equipas")],
      dre: [X("DRE", "Income statement", "Estado de resultados", "Demonstração de resultados")],
      revenue: [X("Receita de vendas", "Revenue", "Ingresos por ventas", "Volume de negócios")],
      cogs: [X("(−) Custo dos produtos vendidos", "(−) Cost of goods sold", "(−) Costo de ventas", "(−) Custo das mercadorias vendidas")],
      gross: [X("= Lucro bruto", "= Gross profit", "= Utilidad bruta", "= Margem bruta")],
      ebit: [X("= Lucro operacional (EBIT)", "= Operating profit (EBIT)", "= Utilidad operativa (EBIT)", "= Resultado operacional (EBIT)")],
      ebt: [X("= Lucro antes do IR", "= Profit before tax", "= Utilidad antes de impuestos", "= Resultado antes de impostos")],
      tax: [X("(−) IR/CSLL", "(−) Income tax", "(−) Impuesto a la renta", "(−) IRC")],
      ni: [X("= Lucro líquido", "= Net profit", "= Utilidad neta", "= Resultado líquido")],
      niShort: [X("Lucro líquido", "Net profit", "Utilidad neta", "Resultado líquido")],
      cumNI: [X("Lucro acumulado", "Cumulative profit", "Utilidad acumulada", "Resultado acumulado")],
      bs: [X("Balanço patrimonial", "Balance sheet", "Balance general", "Balanço")],
      cf: [X("Fluxo de caixa", "Cash flow", "Flujo de caja", "Fluxos de caixa")],
      cash: [X("Caixa", "Cash", "Caja", "Caixa e depósitos")],
      stock: [X("Estoque", "Inventory", "Inventario", "Inventários")],
      fixed: [X("Imobilizado", "Fixed assets", "Activo fijo", "Ativos fixos tangíveis")],
      debt: [X("Empréstimos", "Loans", "Préstamos", "Financiamentos obtidos")],
      emerg: [X("Empréstimo emergencial", "Emergency loan", "Préstamo de emergencia", "Financiamento de emergência")],
      equity: [X("Patrimônio líquido", "Equity", "Patrimonio neto", "Capital próprio")],
      staff: [X("Funcionários", "Employees", "Empleados", "Colaboradores")],
      share: [X("Market share", "Market share", "Cuota de mercado", "Quota de mercado")],
      sat: [X("Satisfação do cliente", "Customer satisfaction", "Satisfacción del cliente", "Satisfação do cliente")],
      value: [X("Valor da empresa", "Company value", "Valor de la empresa", "Valor da empresa")],
      score: [X("Pontuação", "Score", "Puntuación", "Pontuação")],
      round: [X("Rodada", "Round", "Ronda", "Ronda")]
    };
    return (D[k] || [k])[0];
  }
  function decLabel(k) {
    return {
      price: X("Preço", "Price", "Precio"), qty: X("Produção", "Production", "Producción"), mkt: "Marketing", rd: X("P&D", "R&D", "I+D", "I&D"),
      hire: X("Contratação (+) / demissão (−)", "Hiring (+) / layoffs (−)", "Contratación (+) / despidos (−)", "Contratação (+) / despedimento (−)"),
      train: X("Treinamento por funcionário", "Training per employee", "Capacitación por empleado", "Formação por colaborador"),
      invest: X("Investimento em capacidade", "Capacity investment", "Inversión en capacidad"),
      loan: X("Novo empréstimo", "New loan", "Nuevo préstamo", "Novo financiamento"), amort: X("Amortização de dívida", "Debt repayment", "Amortización de deuda")
    }[k] || k;
  }
  function unitLabel() {
    const u = (cfg.params || {}).unit || "unit";
    return { unit: X("unidades", "units", "unidades"), hour: X("horas", "hours", "horas"), subscription: X("assinaturas", "subscriptions", "suscripciones") }[u] || u;
  }
  function scenName(id) {
    return { industria: X("Indústria", "Manufacturing", "Industria"), varejo: X("Varejo", "Retail", "Comercio minorista", "Retalho"), servicos: X("Serviços", "Services", "Servicios"), startup: X("Startup de tecnologia", "Tech startup", "Startup tecnológica") }[id] || id;
  }
  function eventInfo(t) {
    return {
      crise: { n: X("Crise econômica", "Economic crisis", "Crisis económica", "Crise económica"), d: X("A demanda total cai.", "Total demand falls.", "La demanda total cae."), unit: "×" },
      boom: { n: X("Aquecimento da economia", "Economic boom", "Auge económico", "Aquecimento da economia"), d: X("A demanda total sobe.", "Total demand rises.", "La demanda total sube."), unit: "×" },
      concorrente: { n: X("Novo concorrente", "New competitor", "Nuevo competidor"), d: X("Um concorrente virtual disputa o mercado.", "A virtual competitor enters the market.", "Un competidor virtual entra al mercado."), unit: "×" },
      insumos: { n: X("Alta de insumos", "Input costs rise", "Suben los insumos", "Subida das matérias-primas"), d: X("O custo unitário sobe.", "The unit cost rises.", "El costo unitario sube."), unit: "×" },
      juros: { n: X("Alta de juros", "Interest rates rise", "Suben las tasas de interés", "Subida das taxas de juro"), d: X("Nova taxa de juros por rodada.", "New interest rate per round.", "Nueva tasa de interés por ronda."), unit: "%" },
      greve: { n: X("Greve", "Strike", "Huelga"), d: X("A produtividade cai nesta rodada.", "Productivity falls this round.", "La productividad cae en esta ronda."), unit: "×" }
    }[t] || { n: t, d: "", unit: "×" };
  }
  function warnText(w) {
    return {
      "price-min": X("Preço abaixo do mínimo permitido – ajustado.", "Price below the minimum – adjusted.", "Precio por debajo del mínimo – ajustado."),
      "price-max": X("Preço acima do máximo permitido – ajustado.", "Price above the maximum – adjusted.", "Precio por encima del máximo – ajustado."),
      "loan-max": X("Empréstimo limitado ao teto de dívida (60% do ativo).", "Loan capped at the debt ceiling.", "Préstamo limitado al tope de deuda."),
      "amort-max": X("Amortização limitada à dívida existente.", "Repayment limited to the existing debt.", "Amortización limitada a la deuda."),
      "invest-max": X("Investimento limitado ao caixa disponível.", "Investment limited to available cash.", "Inversión limitada a la caja disponible."),
      "hire-max": X("Demissões limitadas ao quadro atual.", "Layoffs limited to current staff.", "Despidos limitados al personal actual."),
      "qty-cut": X("Produção cortada pela capacidade (fábrica ou pessoas).", "Production cut by capacity (plant or people).", "Producción recortada por la capacidad."),
      emergency: X("Caixa negativo: o sistema tomou um empréstimo emergencial.", "Negative cash: an emergency loan was taken.", "Caja negativa: se tomó un préstamo de emergencia.")
    }[w] || (/-neg$/.test(w) ? X("Valor negativo ignorado.", "Negative value ignored.", "Valor negativo ignorado.") : w);
  }

  /* ---------------- helpers on game data ---------------- */
  function P() { return cfg.params || E.params(cfg.scenario || "industria"); }
  function teamIds() { return Object.keys(teams || {}).sort(function (a, b) { return ((teams[a].order || 0) - (teams[b].order || 0)) || a.localeCompare(b); }); }
  function tName(t) { return (teams[t] && teams[t].name) || t; }
  function tColor(t) { const i = teamIds().indexOf(t); return (teams[t] && teams[t].color) || COLORS[(i < 0 ? 0 : i) % COLORS.length]; }
  function roundNos() { return Object.keys(rounds || {}).map(Number).filter(function (n) { return n > 0; }).sort(function (a, b) { return a - b; }); }
  function curRound() { const r = roundNos(); return r.length ? r[r.length - 1] : 0; }
  function doneRounds() { return roundNos().filter(function (n) { return rounds[n].status === "done"; }); }
  function lastDone() { const d = doneRounds(); return d.length ? d[d.length - 1] : 0; }
  function totalRounds() { return +cfg.rounds || 8; }
  function decOn(k) { return k === "price" || k === "qty" || !(cfg.decisions && cfg.decisions[k] === false); }
  function stateBefore(n, t) {
    const prev = results[n - 1] && results[n - 1].teams && results[n - 1].teams[t];
    return prev && prev.state ? fixState(prev.state) : E.initState(P());
  }
  function fixState(s) { const o = Object.assign({}, s); o.ni = o.ni || []; o.share = o.share || []; ["emerg", "stockU", "stockV", "debt", "retained", "cumNI"].forEach(function (k) { o[k] = o[k] || 0; }); return o; }
  function decisionFor(n, t) { return (decisions[n] && decisions[n][t]) || null; }
  function prevDecision(n, t) { for (let k = n - 1; k > 0; k--) { const d = decisionFor(k, t); if (d) return d; } return null; }
  function deadlinePassed(n) { const r = rounds[n]; return !!(r && r.deadline && Date.now() > r.deadline); }
  function membersOf(t) { return Object.keys(people || {}).map(function (k) { return people[k]; }).filter(function (p) { return p && p.role === "student" && p.team === t; }); }

  /* ================= boot ================= */
  function gate(title, text, extra) {
    app.innerHTML = '<div class="gm-gate"><span class="gm-logo">CM</span><h1>' + esc(title) + "</h1><p>" + esc(text) + "</p>" + (extra || "") + '<a class="gm-btn primary" href="../workspaces/">' + X("Ir para Meus quadros", "Go to My boards", "Ir a Mis tableros") + "</a></div>";
  }
  function start() {
    if (!A || !A.enabled) return gate(X("É preciso fazer login", "Sign-in required", "Es necesario iniciar sesión"), X("O Business Game precisa do ambiente online.", "The Business Game needs the online workspace.", "El Business Game necesita el entorno en línea."));
    if (!ID && !NEW_WS) return gate(X("Partida não encontrada", "Game not found", "Partida no encontrada"), X("O link está incompleto.", "The link is incomplete.", "El enlace está incompleto."));
    A.ready().then(function (user) {
      if (!user) return gate(X("Entre para continuar", "Sign in to continue", "Inicia sesión para continuar"), X("Abra “Meus quadros”, entre com o e-mail convidado e volte a este link.", "Open “My boards”, sign in with the invited e-mail and come back to this link.", "Abre “Mis tableros”, inicia sesión con el e-mail invitado y vuelve a este enlace."));
      me = user; ME = A.key(user.email); db = A.db();
      return A.isAdmin().then(function (a) {
        isAdm = a;
        if (NEW_WS) return newGame(NEW_WS);
        return db.ref("game/" + ID).once("value").then(function (s) {
          if (!s.exists()) return gate(X("Partida não encontrada", "Game not found", "Partida no encontrada"), X("Pode ter sido excluída.", "It may have been deleted.", "Puede haber sido eliminada."));
          role = "prof"; applyAll(s.val());
          db.ref("game/" + ID).on("value", function (sn) { applyAll(sn.val() || {}); render(); }, function (e) { gate(X("Sem acesso", "No access", "Sin acceso"), e.message); });
          loadWs();
        }, function () { return asStudent(); });
      });
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { const m = document.querySelector(".gm-modal"); if (m) m.remove(); } });
  }
  function applyAll(g) {
    info = g.info || {}; cfg = g.config || {}; teams = g.teams || {}; people = g.people || {}; rounds = g.rounds || {};
    decisions = g.decisions || {}; results = g.results || {}; debrief = g.debrief || null;
    if (!langFromUser && cfg.lang && LANGS[cfg.lang]) LANG = cfg.lang;
    if (!selTeam || !teams[selTeam]) selTeam = teamIds()[0] || null;
  }
  function loadWs() {
    if (!info.ws) return;
    db.ref("workspaces/" + info.ws).once("value").then(function (s) {
      const w = s.val() || {}; wsInfo = w.info || {}; wsPlans = w.plannings || {}; wsTemplates = w.gameTemplates || {};
      if (booted) render();
    }, function () { /* not a workspace member (invited professor): fine */ });
  }
  function asStudent() {
    return Promise.all([db.ref("game/" + ID + "/info").once("value"), db.ref("game/" + ID + "/people/" + ME).once("value")]).then(function (r) {
      info = r[0].val() || {}; const p = r[1].val();
      if (p && p.role === "student" && p.team) {
        role = "student"; myTeam = p.team; selTeam = p.team;
        ["config", "teams", "people", "rounds", "debrief"].forEach(function (k) {
          db.ref("game/" + ID + "/" + k).on("value", function (s) {
            const v = s.val();
            if (k === "config") { cfg = v || {}; if (!langFromUser && cfg.lang && LANGS[cfg.lang]) LANG = cfg.lang; }
            else if (k === "teams") teams = v || {}; else if (k === "people") people = v || {}; else if (k === "debrief") debrief = v;
            else { rounds = v || {}; roundSubs(); }
            render();
          }, function () { /* ignore */ });
        });
        db.ref("game/" + ID + "/info").on("value", function (s) { info = s.val() || info; render(); });
        return;
      }
      // a professor without the module licence, or someone not invited
      if (info.ws) return window.CMModules.gate("game", info.ws, app).then(function (ok) {
        if (ok) gate(X("Sem acesso a esta partida", "No access to this game", "Sin acceso a esta partida"), X("Peça ao professor responsável um convite.", "Ask the professor in charge for an invitation.", "Pide una invitación al profesor responsable."));
      });
      gate(X("Sem acesso", "No access", "Sin acceso"), X("Peça um convite ao professor.", "Ask the professor for an invitation.", "Pide una invitación al profesor."));
    }, function () { gate(X("Sem acesso", "No access", "Sin acceso"), X("Peça um convite ao professor.", "Ask the professor for an invitation.", "Pide una invitación al profesor.")); });
  }
  function roundSubs() {
    roundNos().forEach(function (n) {
      [["decisions/" + n + "/" + myTeam, function (v) { decisions[n] = decisions[n] || {}; decisions[n][myTeam] = v; }],
        ["results/" + n + "/public", function (v) { results[n] = results[n] || {}; results[n].public = v; }],
        ["results/" + n + "/teams/" + myTeam, function (v) { results[n] = results[n] || {}; results[n].teams = results[n].teams || {}; results[n].teams[myTeam] = v; }]].forEach(function (x) {
        if (subs[x[0]]) return; subs[x[0]] = 1;
        db.ref("game/" + ID + "/" + x[0]).on("value", function (s) { x[1](s.val()); render(); }, function () { /* not yet readable */ });
      });
    });
  }

  /* ================= shell ================= */
  function tabs() {
    const t = [["overview", X("Visão geral", "Overview", "Resumen")], ["decisions", X("Decisões", "Decisions", "Decisiones")], ["results", X("Resultados", "Results", "Resultados")], ["strategy", X("Estratégia", "Strategy", "Estrategia")]];
    if (isProf()) t.push(["teacher", X("Painel do professor", "Professor panel", "Panel del profesor")], ["settings", X("Configuração", "Settings", "Configuración")]);
    return t;
  }
  function render() {
    if (!role) return;
    booted = true;
    if (!tabs().some(function (t) { return t[0] === view; })) view = "overview";
    const b = cfg.brand || {}, cr = curRound(), r = rounds[cr];
    const keepY = (document.getElementById("gmView") || {}).scrollTop || 0;
    const focus = document.activeElement && document.activeElement.id;
    if (document.querySelector(".gm-modal") || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && document.activeElement.closest("#gmView form.live"))) { renderSoft(); return; }
    document.title = (info.title || "Business Game") + " · " + (window.CMCOLLAB_BRAND || "CM Collaborator");
    document.documentElement.lang = LOCALE[LANG];
    if (b.color) document.documentElement.style.setProperty("--inst", b.color); else document.documentElement.style.removeProperty("--inst");
    app.innerHTML = '<header class="gm-top"><a class="gm-back" href="../workspaces/" title="' + X("Meus quadros", "My boards", "Mis tableros") + '">' + IC("back", 18) + "</a>" +
      (b.logo ? '<img class="gm-inst-logo" src="' + esc(b.logo) + '" alt="">' : '<span class="gm-logo">CM</span>') +
      '<div class="gm-title"><h1>' + esc(info.title || "Business Game") + '</h1><span class="gm-sub">' + esc((b.name ? b.name + " · " : "") + "Business Game · " + scenName(cfg.scenario)) + "</span></div>" +
      '<span class="gm-chip ' + (r && r.status === "open" ? "open" : "") + '">' + (cr ? W("round") + " " + cr + "/" + totalRounds() + " · " + roundStatus(cr) : X("Em preparação", "Setting up", "En preparación")) + "</span>" +
      (r && r.status === "open" && r.deadline ? '<span class="gm-cd" data-cd="' + r.deadline + '"></span>' : "") +
      '<span class="sp"></span><label class="gm-lang"><span class="sr">' + X("Idioma", "Language", "Idioma") + '</span><select id="gmLang">' + Object.keys(LANGS).map(function (k) { return '<option value="' + k + '"' + (k === LANG ? " selected" : "") + ">" + LANGS[k] + "</option>"; }).join("") + "</select></label>" +
      (role === "student" ? '<span class="gm-me" style="--c:' + tColor(myTeam) + '">' + esc(tName(myTeam)) + "</span>" : '<span class="gm-me prof">' + X("Professor", "Professor", "Profesor") + "</span>") +
      '</header><nav class="gm-tabs" role="tablist">' + tabs().map(function (t) { return '<button role="tab" data-v="' + t[0] + '" class="' + (t[0] === view ? "on" : "") + '">' + esc(t[1]) + "</button>"; }).join("") + "</nav>" +
      '<main class="gm-view" id="gmView"></main>';
    app.querySelectorAll("[data-v]").forEach(function (x) { x.onclick = function () { view = x.dataset.v; render(); }; });
    app.querySelector("#gmLang").onchange = function (e) { LANG = e.target.value; langFromUser = true; try { localStorage.setItem("cmcollab:lang", LANG); } catch (er) { /* ignore */ } render(); };
    renderView();
    const v = document.getElementById("gmView"); if (v) v.scrollTop = keepY;
    if (focus && document.getElementById(focus)) document.getElementById(focus).focus();
    tick(); clearInterval(cdTimer); cdTimer = setInterval(tick, 1000);
    if (window.CMMarkSeen) window.CMMarkSeen("game");
  }
  function renderSoft() { /* a form is being edited: refresh only passive bits */ tick(); }
  function roundStatus(n) { const r = rounds[n] || {}; return r.status === "open" ? (deadlinePassed(n) ? X("prazo encerrado", "deadline passed", "plazo vencido") : X("aberta", "open", "abierta")) : r.status === "done" ? X("processada", "processed", "procesada") : X("fechada", "closed", "cerrada"); }
  function tick() {
    document.querySelectorAll("[data-cd]").forEach(function (el) {
      const left = +el.dataset.cd - Date.now();
      if (left <= 0) { el.textContent = X("Prazo encerrado", "Deadline passed", "Plazo vencido"); el.classList.add("over"); return; }
      const d = Math.floor(left / DAY), h = Math.floor(left % DAY / 3600000), m = Math.floor(left % 3600000 / 60000), s = Math.floor(left % 60000 / 1000);
      el.textContent = "⏱ " + (d ? d + "d " : "") + String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    });
  }
  function renderView() {
    const v = document.getElementById("gmView"); if (!v) return;
    try {
      ({ overview: viewOverview, decisions: viewDecisions, results: viewResults, strategy: viewStrategy, teacher: viewTeacher, settings: viewSettings })[view](v);
    } catch (e) { console.error(e); v.innerHTML = '<p class="gm-empty">' + esc(e.message) + "</p>"; }
  }
  function modal(html, after) {
    document.querySelectorAll(".gm-modal").forEach(function (m) { m.remove(); });
    const m = document.createElement("div"); m.className = "gm-modal"; m.innerHTML = '<div class="gm-dlg" role="dialog" aria-modal="true">' + html + "</div>";
    m.addEventListener("click", function (e) { if (e.target === m || e.target.closest("[data-close]")) { m.remove(); render(); } });
    document.body.appendChild(m); if (after) after(m.querySelector(".gm-dlg")); return m;
  }
  function closeModal() { document.querySelectorAll(".gm-modal").forEach(function (m) { m.remove(); }); render(); }

  /* ================= overview ================= */
  function viewOverview(v) {
    const cr = curRound(), r = rounds[cr] || {}, ld = lastDone(), pub = ld && results[ld] && results[ld].public;
    let h = "";
    if (isProf() && (!teamIds().length || !Object.keys(people).some(function (k) { return people[k].role === "student"; }) || !cr)) h += setupChecklist();
    h += '<section class="gm-cards">' +
      card(W("round"), cr ? cr + " / " + totalRounds() : "–", cr ? roundStatus(cr) + (r.deadline ? " · " + X("prazo ", "due ", "plazo ") + dt(r.deadline) : "") : X("Nenhuma rodada aberta", "No round opened yet", "Ninguna ronda abierta")) +
      (pub ? card(X("Demanda do mercado", "Market demand", "Demanda del mercado"), num(pub.market.demand), unitLabel() + " · " + X("rodada ", "round ", "ronda ") + ld) +
        card(X("Preço médio", "Average price", "Precio medio"), money(pub.market.avgPrice, 2), X("vendas totais ", "total sales ", "ventas totales ") + num(pub.market.sales)) : "") +
      (role === "student" && pub && pub.ranking && pub.ranking[myTeam] ? card(X("Sua posição", "Your position", "Tu posición"), rankPos(pub.ranking, myTeam) + "º", W("score") + " " + num(pub.ranking[myTeam].score, 1)) : "") +
      "</section>";
    if (r.status === "open") h += eventsBox(r.events, X("Eventos desta rodada", "Events this round", "Eventos de esta ronda"));
    if (pub) {
      h += '<section class="gm-panel"><div class="gm-ph"><h2>' + X("Ranking", "Ranking", "Clasificación") + ' <span class="muted">· ' + W("round") + " " + ld + "</span></h2></div>" + rankingTable(pub.ranking) + weightsNote() + "</section>";
      h += '<div class="gm-grid2"><section class="gm-panel"><h2>' + W("cumNI") + "</h2>" + lineChart("cumNI") + '</section><section class="gm-panel"><h2>' + W("share") + ' <span class="muted">· ' + W("round") + " " + ld + "</span></h2>" + shareBars(pub.ranking) + "</section></div>";
    } else if (!isProf() || teamIds().length) {
      h += '<p class="gm-empty">' + X("Os resultados aparecem aqui quando o professor processar a primeira rodada.", "Results appear here once the professor processes the first round.", "Los resultados aparecen aquí cuando el profesor procese la primera ronda.") + "</p>";
    }
    v.innerHTML = h; bindTips(v);
    v.querySelectorAll("[data-go]").forEach(function (b) { b.onclick = function () { view = b.dataset.go; render(); }; });
  }
  function card(t, big, small) { return '<div class="gm-card"><span class="gm-k">' + esc(t) + '</span><b class="kpi">' + esc(big) + '</b><span class="gm-s">' + esc(small || "") + "</span></div>"; }
  function rankPos(rk, t) { const ids = Object.keys(rk).sort(function (a, b) { return rk[b].score - rk[a].score; }); return ids.indexOf(t) + 1; }
  function weightsNote() { const w = cfg.weights || E.WEIGHTS; return '<p class="muted small">' + W("score") + ": " + W("cumNI").toLowerCase() + " " + (w.profit || 0) + "% · " + W("value").toLowerCase() + " " + (w.value || 0) + "% · " + W("sat").toLowerCase() + " " + (w.sat || 0) + "% · " + W("share").toLowerCase() + " " + (w.share || 0) + "%</p>"; }
  function setupChecklist() {
    const hasStud = Object.keys(people).some(function (k) { return people[k].role === "student"; });
    const steps = [[!!cfg.scenario, X("Escolha o cenário, a moeda e as regras", "Choose the scenario, currency and rules", "Elige el escenario, la moneda y las reglas"), "settings"],
      [teamIds().length >= 2, X("Crie de 4 a 6 equipes", "Create 4 to 6 teams", "Crea de 4 a 6 equipos", "Crie de 4 a 6 equipas"), "settings"],
      [hasStud, X("Convide os alunos e distribua nas equipes", "Invite students and assign them to teams", "Invita a los alumnos y asígnalos a equipos"), "settings"],
      [curRound() > 0, X("Abra a rodada 1 com um prazo", "Open round 1 with a deadline", "Abre la ronda 1 con un plazo"), "teacher"]];
    return '<section class="gm-panel gm-setup"><h2>' + X("Preparar a partida", "Set up the game", "Preparar la partida") + "</h2><ol>" + steps.map(function (s) { return '<li class="' + (s[0] ? "ok" : "") + '"><span>' + (s[0] ? "✓" : "") + "</span>" + esc(s[1]) + (s[0] ? "" : ' <button class="gm-btn sm" data-go="' + s[2] + '">' + X("Fazer", "Do it", "Hacer") + "</button>") + "</li>"; }).join("") + "</ol></section>";
  }
  function eventsBox(evs, title) {
    if (!evs || !evs.length) return "";
    return '<section class="gm-panel gm-events"><h2>' + esc(title) + "</h2><ul>" + evs.map(function (e) { const i = eventInfo(e.type); return "<li><b>" + esc(i.n) + "</b> – " + esc(i.d) + "</li>"; }).join("") + "</ul></section>";
  }
  function rankingTable(rk) {
    if (!rk) return "";
    const ids = Object.keys(rk).sort(function (a, b) { return rk[b].score - rk[a].score; });
    return '<div class="gm-tw"><table class="gm-t"><thead><tr><th>#</th><th>' + W("team") + '</th><th class="r">' + W("score") + '</th><th class="r">' + W("cumNI") + '</th><th class="r">' + W("value") + '</th><th class="r">' + W("sat") + '</th><th class="r">' + W("share") + "</th></tr></thead><tbody>" +
      ids.map(function (t, i) { const x = rk[t]; return '<tr class="' + (t === myTeam ? "mine" : "") + '"><td>' + (i + 1) + '</td><td class="nw"><span class="dot" style="background:' + tColor(t) + '"></span>' + esc(tName(t)) + '</td><td class="r"><b>' + num(x.score, 1) + '</b></td><td class="r">' + money(x.cumNI) + '</td><td class="r">' + money(x.value) + '</td><td class="r">' + num(x.sat, 1) + '</td><td class="r">' + pct(x.avgShare != null ? x.avgShare : x.share) + "</td></tr>"; }).join("") + "</tbody></table></div>";
  }

  /* ---------------- charts (SVG, hover tooltips, legend + table elsewhere) ---------------- */
  function lineChart(metric) {
    const ds = doneRounds(); if (!ds.length) return "";
    const ids = teamIds().filter(function (t) { return ds.some(function (n) { return results[n].public && results[n].public.ranking && results[n].public.ranking[t]; }); });
    const series = ids.map(function (t) { return { t: t, pts: ds.map(function (n) { const x = results[n].public.ranking[t]; return x ? x[metric] : null; }) }; });
    const vals = [0]; series.forEach(function (s) { s.pts.forEach(function (p) { if (p != null) vals.push(p); }); });
    let mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals); if (mx === mn) mx = mn + 1;
    const Wd = 560, H = 220, L = 74, Rp = 12, T = 12, B = 28, iw = Wd - L - Rp, ih = H - T - B;
    const x = function (i) { return L + (ds.length === 1 ? iw / 2 : i * iw / (ds.length - 1)); }, y = function (v) { return T + ih - (v - mn) / (mx - mn) * ih; };
    let g = "";
    [0, 0.5, 1].forEach(function (f) { const v = mn + (mx - mn) * f; g += '<line x1="' + L + '" x2="' + (Wd - Rp) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="grid"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" class="ax" text-anchor="end">' + esc(compact(v)) + "</text>"; });
    if (mn < 0) g += '<line x1="' + L + '" x2="' + (Wd - Rp) + '" y1="' + y(0) + '" y2="' + y(0) + '" class="zero"/>';
    ds.forEach(function (n, i) { g += '<text x="' + x(i) + '" y="' + (H - 8) + '" class="ax" text-anchor="middle">' + W("round").charAt(0) + n + "</text>"; });
    series.forEach(function (s) {
      const d = s.pts.map(function (p, i) { return p == null ? "" : (i ? "L" : "M") + x(i) + " " + y(p); }).join(" ");
      g += '<path d="' + d + '" fill="none" stroke="' + tColor(s.t) + '" stroke-width="2" stroke-linejoin="round"/>';
      s.pts.forEach(function (p, i) { if (p == null) return; g += '<circle cx="' + x(i) + '" cy="' + y(p) + '" r="4" fill="' + tColor(s.t) + '" stroke="#fff" stroke-width="2" data-tip="' + esc(tName(s.t) + " · " + W("round") + " " + ds[i] + ": " + money(p)) + '"/>'; });
    });
    return '<div class="gm-chart"><svg viewBox="0 0 ' + Wd + " " + H + '" role="img" aria-label="' + esc(W("cumNI")) + '">' + g + "</svg>" + legend(ids) + '<div class="gm-tip" hidden></div></div>';
  }
  function compact(v) { try { return new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(v); } catch (e) { return String(Math.round(v)); } }
  function legend(ids) { return '<div class="gm-legend">' + ids.map(function (t) { return '<span><i style="background:' + tColor(t) + '"></i>' + esc(tName(t)) + "</span>"; }).join("") + "</div>"; }
  function shareBars(rk) {
    if (!rk) return "";
    const ids = teamIds().filter(function (t) { return rk[t]; }), mx = Math.max.apply(null, ids.map(function (t) { return rk[t].share; }).concat([0.0001]));
    return '<div class="gm-bars">' + ids.map(function (t) { const s = rk[t].share; return '<div class="gm-bar" data-tip="' + esc(tName(t) + ": " + pct(s) + " · " + num(rk[t].sales) + " " + unitLabel()) + '"><span class="bl">' + esc(tName(t)) + '</span><span class="bt"><i style="width:' + (s / mx * 100).toFixed(1) + "%;background:" + tColor(t) + '"></i></span><span class="bv">' + pct(s) + "</span></div>"; }).join("") + '</div><div class="gm-tip" hidden></div>';
  }
  function bindTips(root) {
    root.querySelectorAll("[data-tip]").forEach(function (el) {
      const box = el.closest(".gm-panel") && el.closest(".gm-panel").querySelector(".gm-tip"); if (!box) return;
      el.addEventListener("mouseenter", function () { box.textContent = el.dataset.tip; box.hidden = false; });
      el.addEventListener("mousemove", function (e) { const r = box.parentElement.getBoundingClientRect(); box.style.left = Math.min(e.clientX - r.left + 12, r.width - 180) + "px"; box.style.top = (e.clientY - r.top + 12) + "px"; });
      el.addEventListener("mouseleave", function () { box.hidden = true; });
      el.addEventListener("click", function () { box.textContent = el.dataset.tip; box.hidden = false; });
    });
  }

  /* ================= decisions ================= */
  function teamPicker(id) {
    if (role === "student") return "";
    const ids = teamIds(); if (!ids.length) return "";
    return '<label class="gm-inl">' + W("team") + ' <select id="' + id + '">' + ids.map(function (t) { return '<option value="' + t + '"' + (t === selTeam ? " selected" : "") + ">" + esc(tName(t)) + "</option>"; }).join("") + "</select></label>";
  }
  function viewDecisions(v) {
    const t = selTeam, cr = curRound();
    if (!t) { v.innerHTML = '<p class="gm-empty">' + X("Crie as equipes em Configuração.", "Create the teams in Settings.", "Crea los equipos en Configuración.") + "</p>"; return; }
    if (!cr) { v.innerHTML = '<div class="gm-bar-top">' + teamPicker("dTeam") + '</div><p class="gm-empty">' + X("A rodada 1 ainda não foi aberta pelo professor.", "Round 1 has not been opened yet.", "La ronda 1 aún no fue abierta.") + "</p>"; bindPick(v); return; }
    const n = cr, r = rounds[n] || {}, open = r.status === "open";
    const canWrite = open && (isProf() || (role === "student" && t === myTeam && !deadlinePassed(n)));
    const st = stateBefore(n, t), p = P(), saved = decisionFor(n, t);
    const d0 = Object.assign({}, E.defaultDecision(p, st, teamIds().length), prevDecision(n, t) || {}, saved || {});
    const strat = Object.assign({}, (saved && saved.strategic) || {});
    let h = '<div class="gm-bar-top">' + teamPicker("dTeam") + '<span class="gm-pill">' + W("round") + " " + n + " · " + roundStatus(n) + "</span>" +
      (r.deadline ? '<span class="gm-cd" data-cd="' + r.deadline + '"></span>' : "") +
      (saved && saved.at ? '<span class="muted small">' + (saved.auto ? X("Decisão automática (repetiu a anterior)", "Automatic decision (repeated the previous one)", "Decisión automática") : X("Enviada por ", "Sent by ", "Enviada por ") + esc(nameOf(saved.by)) + " · " + dt(saved.at)) + "</span>" : (open ? '<span class="gm-warn small">' + X("Ainda não enviada", "Not sent yet", "Aún no enviada") + "</span>" : "")) + "</div>";
    if (!open) h += '<p class="gm-note">' + X("A rodada está fechada. Você vê as decisões enviadas.", "The round is closed. You are seeing the decisions that were sent.", "La ronda está cerrada. Ves las decisiones enviadas.") + "</p>";
    else if (!canWrite && role === "student") h += '<p class="gm-note">' + X("O prazo desta rodada terminou. Aguarde o processamento.", "This round's deadline has passed. Wait for processing.", "El plazo terminó. Espera el procesamiento.") + "</p>";
    h += eventsBox(r.events, X("Eventos desta rodada", "Events this round", "Eventos de esta ronda"));
    const dis = canWrite ? "" : " disabled";
    h += '<div class="gm-dec"><form class="gm-panel gm-form live" id="decForm"><h2>' + X("Decisões da rodada", "Round decisions", "Decisiones de la ronda") + " " + n + "</h2>";
    E.DECISIONS.forEach(function (k) {
      if (!decOn(k)) return;
      const isMoney = ["price", "mkt", "rd", "train", "invest", "loan", "amort"].indexOf(k) >= 0;
      const step = k === "price" || k === "train" ? "0.01" : "1";
      h += '<label class="gm-f"><span>' + esc(decLabel(k)) + (isMoney ? ' <em class="muted">(' + esc(curr().custom ? (curr().symbol || "") : curr().code) + ")</em>" : k === "qty" ? ' <em class="muted">(' + unitLabel() + ")</em>" : "") + "</span>" +
        '<input type="number" inputmode="decimal" name="' + k + '" step="' + step + '" value="' + esc(d0[k] != null ? d0[k] : 0) + '"' + dis + '><small class="muted" data-hint="' + k + '"></small></label>';
    });
    h += '<h3>' + X("Decisões estratégicas", "Strategic decisions", "Decisiones estratégicas") + ' <span class="muted small">' + X("(opcional – viram iniciativas/épicos no planejamento conectado)", "(optional – become initiatives/epics in the connected planning)", "(opcional – se vuelven iniciativas/épicas en la planificación)") + "</span></h3>" +
      '<ul class="gm-strat" id="stratList">' + Object.keys(strat).map(function (k) { const s = strat[k]; return '<li data-k="' + k + '"><span class="gm-pill">' + (s.type === "epic" ? X("Épico", "Epic", "Épica") : X("Iniciativa", "Initiative", "Iniciativa")) + "</span> " + esc(s.title) + (s.item ? ' <span class="muted small">→ ' + esc(s.item) + "</span>" : "") + (canWrite && !s.item ? ' <button type="button" class="gm-btn sm ghost" data-rm="' + k + '">✕</button>' : "") + "</li>"; }).join("") + "</ul>" +
      (canWrite ? '<div class="gm-row"><input id="stTitle" placeholder="' + esc(X("Ex.: Lançar linha premium", "E.g. Launch a premium line", "Ej.: Lanzar línea premium")) + '" maxlength="120"><select id="stType"><option value="initiative">' + X("Iniciativa", "Initiative", "Iniciativa") + '</option><option value="epic">' + X("Épico", "Epic", "Épica") + '</option></select><button type="button" class="gm-btn sm" id="stAdd">+ ' + X("Adicionar", "Add", "Añadir") + "</button></div>" : "") +
      (canWrite ? '<div class="gm-actions"><button class="gm-btn primary" id="decSave">' + X("Enviar decisões", "Submit decisions", "Enviar decisiones") + "</button></div>" : "") +
      '</form><aside class="gm-panel gm-preview" id="decPrev"></aside></div>';
    v.innerHTML = h; bindPick(v);
    const f = v.querySelector("#decForm");
    function read() { const d = {}; E.DECISIONS.forEach(function (k) { d[k] = f[k] ? Number(f[k].value) || 0 : (d0[k] || 0); if (!decOn(k)) d[k] = 0; }); return d; }
    function preview() { v.querySelector("#decPrev").innerHTML = previewHtml(read(), st, p, n); hints(read(), st, p); }
    function hints(d, s, pp) {
      const c = E.capacityOf(s, pp, d), set = function (k, txt) { const el = v.querySelector('[data-hint="' + k + '"]'); if (el) el.textContent = txt; };
      set("price", X("Faixa: ", "Range: ", "Rango: ") + money(pp.Pref * pp.pMin, 2) + " – " + money(pp.Pref * pp.pMax, 2) + " · " + X("referência ", "reference ", "referencia ") + money(pp.Pref, 2));
      set("qty", X("Máximo nesta rodada: ", "Maximum this round: ", "Máximo en esta ronda: ") + num(c.max) + " (" + X("fábrica ", "plant ", "planta ") + num(c.cap) + " · " + X("pessoas ", "people ", "personas ") + num(Math.floor(c.W * c.per)) + ")");
      set("hire", W("staff") + ": " + num(s.W) + " → " + num(c.W));
      set("loan", X("Disponível até ", "Available up to ", "Disponible hasta ") + money(Math.max(0, Math.round(pp.debtMax * (s.cash + s.stockV + s.imob)) - s.debt - s.emerg)));
      set("amort", X("Dívida atual ", "Current debt ", "Deuda actual ") + money(s.debt + s.emerg));
      set("invest", X("Vira capacidade na próxima rodada: +", "Becomes capacity next round: +", "Se vuelve capacidad la próxima ronda: +") + num(Math.floor(d.invest / pp.capCost)) + " " + unitLabel());
      set("train", X("Referência: ", "Reference: ", "Referencia: ") + money(pp.trRef) + X(" por funcionário = +", " per employee = +", " por empleado = +") + Math.round(pp.tau * 100) + "% " + X("de produtividade", "productivity", "de productividad"));
      set("mkt", X("Marca acumulada perde ", "Accumulated brand loses ", "La marca acumulada pierde ") + Math.round(pp.dB * 100) + "% " + X("por rodada", "per round", "por ronda"));
      set("rd", X("Qualidade acumulada perde ", "Accumulated quality loses ", "La calidad acumulada pierde ") + Math.round(pp.dQ * 100) + "% " + X("por rodada", "per round", "por ronda"));
    }
    preview();
    f.addEventListener("input", preview);
    v.querySelectorAll("[data-rm]").forEach(function (b) { b.onclick = function () { delete strat[b.dataset.rm]; b.closest("li").remove(); }; });
    const add = v.querySelector("#stAdd");
    if (add) add.onclick = function () {
      const ti = v.querySelector("#stTitle"), title = ti.value.trim(); if (!title) return;
      const k = "s" + Date.now().toString(36) + rnd(); strat[k] = { title: title, type: v.querySelector("#stType").value };
      const li = document.createElement("li"); li.dataset.k = k; li.innerHTML = '<span class="gm-pill">' + (strat[k].type === "epic" ? X("Épico", "Epic", "Épica") : X("Iniciativa", "Initiative", "Iniciativa")) + "</span> " + esc(title) + ' <button type="button" class="gm-btn sm ghost">✕</button>';
      li.querySelector("button").onclick = function () { delete strat[k]; li.remove(); };
      v.querySelector("#stratList").appendChild(li); ti.value = "";
    };
    f.onsubmit = function (e) {
      e.preventDefault(); if (!canWrite) return;
      const d = E.clampDecision(read(), st, p).d;
      const rec = Object.assign({}, d, { strategic: Object.keys(strat).length ? strat : null, by: me.email, at: TS() });
      const btn = v.querySelector("#decSave"); btn.disabled = true;
      db.ref("game/" + ID + "/decisions/" + n + "/" + t).set(rec).then(function () { btn.disabled = false; toast(X("Decisões enviadas ✓ Você pode alterar até o prazo.", "Decisions sent ✓ You can change them until the deadline.", "Decisiones enviadas ✓ Puedes cambiarlas hasta el plazo.")); if (document.activeElement) document.activeElement.blur(); render(); }, function (er) { btn.disabled = false; fail(er); });
    };
  }
  function bindPick(v) { const s = v.querySelector("#dTeam, #rTeam"); if (s) s.onchange = function () { selTeam = s.value; render(); }; }
  function nameOf(email) { if (!email) return ""; const p = people[A.key(email)]; return (p && p.name) || String(email).split("@")[0]; }
  function previewHtml(d0, s, p, n) {
    const cd = E.clampDecision(d0, s, p), d = cd.d, c = E.capacityOf(s, p, d), warn = cd.warn.slice();
    const prod = Math.min(d.qty, c.max); if (d.qty > c.max) warn.push("qty-cut");
    const out = Math.round(prod * p.cv) + c.W * p.sal + Math.max(0, d.hire) * p.hire + Math.max(0, -d.hire) * p.fire + Math.round(d.train * c.W) + d.mkt + d.rd + p.adm + d.invest + d.amort;
    const before = s.cash + d.loan - out, potential = Math.round((Math.min(d.qty, c.max) + s.stockU) * d.price);
    const rows = [[W("cash") + X(" no início", " at start", " al inicio"), money(s.cash)], [X("Capacidade da fábrica", "Plant capacity", "Capacidad de la planta"), num(c.cap) + " " + unitLabel()], [W("staff"), num(c.W)], [X("Produção efetiva", "Effective production", "Producción efectiva"), num(prod) + " " + unitLabel()],
      [W("stock") + X(" inicial", " at start", " inicial"), num(s.stockU) + " " + unitLabel()], [X("Saídas de caixa previstas (antes das vendas)", "Expected cash out (before sales)", "Salidas de caja previstas (antes de ventas)"), money(out)],
      [X("Caixa antes das vendas", "Cash before sales", "Caja antes de ventas"), money(before)], [X("Receita se vender todo o estoque e a produção", "Revenue if all stock and production sell", "Ingresos si se vende todo"), money(potential)], [X("Dívida após a decisão", "Debt after the decision", "Deuda tras la decisión"), money(s.debt + s.emerg + d.loan - d.amort)]];
    return "<h2>" + X("Prévia", "Preview", "Vista previa") + '</h2><table class="gm-t mini"><tbody>' + rows.map(function (r) { return "<tr><td>" + esc(r[0]) + '</td><td class="r">' + esc(r[1]) + "</td></tr>"; }).join("") + "</tbody></table>" +
      (before + potential < 0 ? '<p class="gm-warn">' + X("Atenção: mesmo vendendo tudo, o caixa fica negativo – o sistema tomará um empréstimo emergencial a juros mais altos.", "Careful: even selling everything, cash goes negative – an emergency loan at a higher rate will be taken.", "Atención: aun vendiendo todo, la caja queda negativa – se tomará un préstamo de emergencia.") + "</p>" : before < 0 ? '<p class="muted small">' + X("A produção e as despesas são pagas antes das vendas: as vendas da rodada precisam cobrir ", "Production and expenses are paid before sales: this round's sales must cover ", "La producción y los gastos se pagan antes de las ventas: las ventas deben cubrir ") + money(-before) + X(" para não precisar de empréstimo emergencial.", " to avoid an emergency loan.", " para evitar un préstamo de emergencia.") + "</p>" : "") +
      (warn.length ? '<ul class="gm-warns">' + warn.map(function (w) { return "<li>" + esc(warnText(w)) + "</li>"; }).join("") + "</ul>" : "") +
      '<p class="muted small">' + X("As vendas dependem das decisões de todas as equipes: o resultado só sai quando o professor processar a rodada.", "Sales depend on every team's decisions: results come out when the professor processes the round.", "Las ventas dependen de las decisiones de todos los equipos.") + "</p>";
  }

  /* ================= results ================= */
  function viewResults(v) {
    const ds = doneRounds();
    if (!ds.length) { v.innerHTML = '<p class="gm-empty">' + X("Nenhuma rodada processada ainda.", "No round processed yet.", "Ninguna ronda procesada todavía.") + "</p>"; return; }
    if (!selRound || ds.indexOf(selRound) < 0) selRound = ds[ds.length - 1];
    const n = selRound, t = selTeam, pub = results[n].public || {}, o = results[n].teams && results[n].teams[t];
    let h = '<div class="gm-bar-top">' + teamPicker("rTeam") + '<label class="gm-inl">' + W("round") + ' <select id="rRound">' + ds.map(function (k) { return '<option value="' + k + '"' + (k === n ? " selected" : "") + ">" + k + "</option>"; }).join("") + "</select></label>" +
      (isProf() ? '<span class="sp"></span><button class="gm-btn sm" id="xCsv">' + IC("export", 14) + " CSV</button><button class=\"gm-btn sm\" id=\"xPdf\">" + IC("print", 14) + " PDF</button>" : "") + "</div>";
    h += eventsBox((rounds[n] || {}).events, X("Eventos da rodada", "Round events", "Eventos de la ronda"));
    if (!o) { h += '<p class="gm-empty">' + X("Sem resultados desta equipe nesta rodada.", "No results for this team in this round.", "Sin resultados de este equipo.") + "</p>"; v.innerHTML = h; bindResBar(v); return; }
    h += '<section class="gm-cards">' + card(W("niShort"), money(o.ni), W("cumNI") + " " + money(o.cumNI)) + card(W("revenue"), money(o.revenue), num(o.sales) + " " + unitLabel() + " × " + money(o.price, 2)) +
      card(W("share"), pct(o.share), X("média ", "average ", "media ") + pct(o.avgShare)) + card(W("sat"), num(o.sat, 1), "0–100") + card(W("cash"), money(o.bs.cash), W("debt") + " " + money(o.bs.liabilities)) +
      (pub.ranking && pub.ranking[t] ? card(W("score"), num(pub.ranking[t].score, 1), rankPos(pub.ranking, t) + "º " + X("lugar", "place", "lugar")) : "") + "</section>";
    if (o.warn && o.warn.length) h += '<ul class="gm-warns panel">' + o.warn.map(function (w) { return "<li>" + esc(warnText(w)) + "</li>"; }).join("") + "</ul>";
    h += '<div class="gm-grid2">' + stmt(W("dre"), [[W("revenue"), o.revenue, 1], [W("cogs"), -o.cogs], [W("gross"), o.gross, 1], ["(−) " + X("Salários", "Salaries", "Salarios"), -o.salaries], ["(−) " + X("Contratações e demissões", "Hiring and layoffs", "Contrataciones y despidos"), -o.hiring], ["(−) " + X("Treinamento", "Training", "Capacitación", "Formação"), -o.training], ["(−) Marketing", -o.mkt], ["(−) " + decLabel("rd"), -o.rd], ["(−) " + X("Estocagem", "Storage", "Almacenaje", "Armazenagem"), -o.storage], ["(−) " + X("Administrativo fixo", "Fixed overheads", "Gastos fijos"), -o.adm], ["(−) " + X("Depreciação", "Depreciation", "Depreciación", "Depreciações"), -o.depr]].concat(o.idle ? [["(−) " + X("Capacidade não vendida", "Unsold capacity", "Capacidad no vendida"), -o.idle]] : []).concat([[W("ebit"), o.ebit, 1], ["(−) " + X("Juros", "Interest", "Intereses"), -o.interest], [W("ebt"), o.ebt, 1], [W("tax"), -o.tax], [W("ni"), o.ni, 2]])) +
      "<div>" + stmt(W("bs"), [[W("cash"), o.bs.cash], [W("stock") + " (" + num(o.bs.stockU) + " " + unitLabel() + ")", o.bs.stock], [W("fixed"), o.bs.fixed], [X("= Ativo total", "= Total assets", "= Activo total"), o.bs.assets, 2], [W("debt"), o.bs.debt], [W("emerg"), o.bs.emergency], [X("Capital social", "Share capital", "Capital social"), o.bs.capital], [X("Lucros acumulados", "Retained earnings", "Utilidades retenidas", "Resultados transitados"), o.bs.retained], [X("= Passivo + PL", "= Liabilities + equity", "= Pasivo + patrimonio", "= Passivo + capital próprio"), o.bs.liabilities + o.bs.equity, 2]]) +
      stmt(W("cf"), [[W("cash") + X(" inicial", " at start", " inicial"), o.cf.start, 1], ["(+) " + X("Recebimentos de vendas", "Sales receipts", "Cobros de ventas"), o.cf.receipts], ["(−) " + X("Produção", "Production", "Producción"), o.cf.production], ["(−) " + X("Despesas pagas", "Expenses paid", "Gastos pagados"), o.cf.expenses], ["(−) " + X("Juros", "Interest", "Intereses"), o.cf.interest], ["(−) " + X("Impostos", "Taxes", "Impuestos"), o.cf.tax], ["(−) " + X("Investimento", "Investment", "Inversión"), o.cf.invest], ["(+) " + decLabel("loan"), o.cf.loan], ["(−) " + decLabel("amort"), o.cf.amort], ["(+) " + W("emerg"), o.cf.emergency], [W("cash") + X(" final", " at end", " final"), o.cf.end, 2]]) + "</div></div>";
    h += '<section class="gm-panel"><h2>' + X("Operação", "Operations", "Operación", "Operação") + '</h2><div class="gm-tw"><table class="gm-t"><tbody>' +
      [[X("Demanda da equipe", "Team demand", "Demanda del equipo"), num(o.demand)], [X("Vendas", "Sales", "Ventas"), num(o.sales) + (o.spillIn ? " (" + X("inclui ", "includes ", "incluye ") + num(o.spillIn) + X(" de clientes de concorrentes sem produto", " from competitors' customers left without product", " de clientes de competidores sin producto") + ")" : "")], [X("Atendimento da demanda", "Demand served", "Demanda atendida"), pct(o.fill)],
        [X("Produção", "Production", "Producción"), num(o.prod) + " / " + X("máx. ", "max ", "máx. ") + num(o.maxProd)], [X("Capacidade da fábrica na próxima rodada", "Plant capacity next round", "Capacidad de la planta próxima ronda"), num(o.nextCap)], [W("staff"), num(o.W)], [W("value"), money(o.value)]].map(function (r) { return "<tr><td>" + esc(r[0]) + '</td><td class="r">' + esc(r[1]) + "</td></tr>"; }).join("") +
      "</tbody></table></div></section>";
    h += '<section class="gm-panel"><h2>' + X("Evolução", "Evolution", "Evolución") + "</h2>" + evolution(t) + "</section>";
    if (pub.ranking) h += '<section class="gm-panel"><h2>' + X("Mercado", "Market", "Mercado") + ' <span class="muted">· ' + W("round") + " " + n + "</span></h2>" + shareBars(pub.ranking) + "</section>";
    v.innerHTML = h; bindResBar(v); bindTips(v);
  }
  function bindResBar(v) {
    bindPick(v);
    const r = v.querySelector("#rRound"); if (r) r.onchange = function () { selRound = +r.value; render(); };
    const c = v.querySelector("#xCsv"); if (c) c.onclick = exportCsv;
    const p = v.querySelector("#xPdf"); if (p) p.onclick = exportPdf;
  }
  function stmt(title, rows) {
    return '<section class="gm-panel"><h2>' + esc(title) + '</h2><table class="gm-t stmt"><tbody>' + rows.map(function (r) { return '<tr class="' + (r[2] === 2 ? "tot" : r[2] ? "sub" : "") + '"><td>' + esc(r[0]) + '</td><td class="r' + (r[1] < 0 ? " neg" : "") + '">' + money(r[1]) + "</td></tr>"; }).join("") + "</tbody></table></section>";
  }
  function evolution(t) {
    const ds = doneRounds().filter(function (n) { return results[n].teams && results[n].teams[t]; });
    return '<div class="gm-tw"><table class="gm-t"><thead><tr><th>' + W("round") + '</th><th class="r">' + X("Preço", "Price", "Precio") + '</th><th class="r">' + X("Vendas", "Sales", "Ventas") + '</th><th class="r">' + W("revenue") + '</th><th class="r">' + W("niShort") + '</th><th class="r">' + W("cash") + '</th><th class="r">' + W("share") + '</th><th class="r">' + W("sat") + "</th></tr></thead><tbody>" +
      ds.map(function (n) { const o = results[n].teams[t]; return "<tr><td>" + n + '</td><td class="r">' + money(o.price, 2) + '</td><td class="r">' + num(o.sales) + '</td><td class="r">' + money(o.revenue) + '</td><td class="r' + (o.ni < 0 ? " neg" : "") + '">' + money(o.ni) + '</td><td class="r">' + money(o.bs.cash) + '</td><td class="r">' + pct(o.share) + '</td><td class="r">' + num(o.sat, 1) + "</td></tr>"; }).join("") + "</tbody></table></div>";
  }

  /* ================= export ================= */
  function exportCsv() {
    const rows = [[W("round"), W("team"), X("Preço", "Price", "Precio"), X("Produção", "Production", "Producción"), "Marketing", decLabel("rd"), decLabel("hire"), decLabel("train"), decLabel("invest"), decLabel("loan"), decLabel("amort"),
      X("Demanda", "Demand", "Demanda"), X("Vendas", "Sales", "Ventas"), W("revenue"), W("niShort"), W("cumNI"), W("cash"), W("debt"), W("equity"), W("value"), W("share"), W("sat"), W("score"), X("Posição", "Position", "Posición")]];
    doneRounds().forEach(function (n) {
      const pub = results[n].public || {}, rk = pub.ranking || {};
      teamIds().forEach(function (t) {
        const o = results[n].teams && results[n].teams[t]; if (!o) return; const d = o.decision || {};
        rows.push([n, tName(t), d.price, d.qty, d.mkt, d.rd, d.hire, d.train, d.invest, d.loan, d.amort, o.demand, o.sales, o.revenue, o.ni, o.cumNI, o.bs.cash, o.bs.liabilities, o.bs.equity, o.value, (o.share * 100).toFixed(2), o.sat, rk[t] ? rk[t].score : "", rk[t] ? rankPos(rk, t) : ""]);
      });
    });
    const sep = /^(pt|es|pt-pt)$/.test(LANG) ? ";" : ",";
    const csv = "﻿" + rows.map(function (r) { return r.map(function (c) { c = c == null ? "" : String(c); if (sep === ";" && /^-?\d+\.\d+$/.test(c)) c = c.replace(".", ","); return /[";,\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(sep); }).join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = slug(info.title || "business-game") + "-resultados.csv"; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function exportPdf() {
    const n = selRound || lastDone(); if (!n) return;
    const pub = results[n].public || {}, b = cfg.brand || {};
    let h = '<div class="gm-print"><header>' + (b.logo ? '<img src="' + esc(b.logo) + '" alt="">' : "") + "<div><h1>" + esc(info.title || "Business Game") + "</h1><p>" + esc((b.name ? b.name + " · " : "") + scenName(cfg.scenario) + " · " + W("round") + " " + n + " · " + new Date().toLocaleDateString(LOCALE[LANG])) + "</p></div></header>";
    h += "<h2>" + X("Ranking", "Ranking", "Clasificación") + "</h2>" + rankingTable(pub.ranking) + weightsNote();
    teamIds().forEach(function (t) {
      const o = results[n].teams && results[n].teams[t]; if (!o) return;
      const ms = membersOf(t).map(function (p) { return p.name || p.email; }).join(", ");
      h += '<section class="pg"><h2><span class="dot" style="background:' + tColor(t) + '"></span>' + esc(tName(t)) + "</h2>" + (ms ? '<p class="muted">' + esc(ms) + "</p>" : "") +
        '<table class="gm-t"><tbody>' + [[W("revenue"), money(o.revenue)], [W("niShort"), money(o.ni)], [W("cumNI"), money(o.cumNI)], [W("cash"), money(o.bs.cash)], [W("equity"), money(o.bs.equity)], [W("value"), money(o.value)], [W("share"), pct(o.share)], [W("sat"), num(o.sat, 1)]].map(function (r) { return "<tr><td>" + esc(r[0]) + '</td><td class="r">' + esc(r[1]) + "</td></tr>"; }).join("") + "</tbody></table>" + evolution(t) + "</section>";
    });
    h += "</div>";
    let box = document.getElementById("gmPrint"); if (!box) { box = document.createElement("div"); box.id = "gmPrint"; document.body.appendChild(box); }
    box.innerHTML = h; document.body.classList.add("printing");
    setTimeout(function () { window.print(); }, 50);
    window.addEventListener("afterprint", function f() { document.body.classList.remove("printing"); window.removeEventListener("afterprint", f); });
  }

  /* ================= strategy & debrief ================= */
  const BOARDS = [["swot", "SWOT"], ["leancanvas", "Lean Canvas"], ["okr", "OKR"]];
  function viewStrategy(v) {
    const ids = role === "student" ? [myTeam] : teamIds();
    const planId = info.plan;
    let h = '<section class="gm-panel"><div class="gm-ph"><h2>' + X("Quadros de estratégia das equipes", "Teams' strategy boards", "Tableros de estrategia de los equipos", "Quadros de estratégia das equipas") + "</h2>" +
      (isProf() && ids.length ? '<button class="gm-btn sm" id="mkBoards">' + IC("plus", 14) + " " + X("Criar quadros que faltam", "Create missing boards", "Crear tableros faltantes") + "</button>" : "") + "</div>" +
      '<p class="muted small">' + X("Cada equipe trabalha a estratégia em quadros colaborativos (SWOT, Lean Canvas e OKR) ligados à partida.", "Each team works its strategy on collaborative boards (SWOT, Lean Canvas and OKR) linked to the game.", "Cada equipo trabaja su estrategia en tableros colaborativos (SWOT, Lean Canvas y OKR).") + "</p>" +
      '<div class="gm-teams">' + ids.map(function (t) {
        const bs = (teams[t] && teams[t].boards) || {};
        return '<div class="gm-team" style="--c:' + tColor(t) + '"><b>' + esc(tName(t)) + "</b><div>" + BOARDS.map(function (b) { return bs[b[0]] ? '<a class="gm-btn sm" href="../board/?id=' + encodeURIComponent(bs[b[0]]) + '">' + IC("board", 14) + " " + b[1] + "</a>" : '<span class="gm-btn sm off">' + b[1] + "</span>"; }).join("") + "</div></div>";
      }).join("") + "</div>" +
      (role === "student" ? '<p class="muted small">' + X("Se o quadro não abrir, peça ao professor acesso ao workspace da turma.", "If a board does not open, ask the professor for access to the class workspace.", "Si el tablero no abre, pide acceso al profesor.") + "</p>" : "") + "</section>";
    h += '<section class="gm-panel"><h2>' + X("Planejamento conectado", "Connected planning", "Planificación conectada") + "</h2>" +
      (planId ? '<p><a class="gm-btn" href="../planning/?id=' + encodeURIComponent(planId) + '">' + IC("planning", 15) + " " + esc((wsPlans[planId] && wsPlans[planId].title) || X("Abrir o planejamento", "Open the planning", "Abrir la planificación")) + "</a></p><p class=\"muted small\">" + X("As decisões estratégicas de cada rodada viram iniciativas/épicos no planejamento quando o professor processa a rodada.", "Each round's strategic decisions become initiatives/epics in the planning when the professor processes the round.", "Las decisiones estratégicas se vuelven iniciativas/épicas al procesar la ronda.") + "</p>"
        : '<p class="muted">' + X("Nenhum planejamento conectado.", "No planning connected.", "Ninguna planificación conectada.") + (isProf() ? " " + X("Conecte em Configuração.", "Connect one in Settings.", "Conéctala en Configuración.") : "") + "</p>") + "</section>";
    h += debriefPanel();
    v.innerHTML = h;
    const mk = v.querySelector("#mkBoards"); if (mk) mk.onclick = createBoards;
    const g = v.querySelector("#dbGen"); if (g) g.onclick = genDebrief;
    const ai = v.querySelector("#dbAi"); if (ai) ai.onclick = aiDebrief;
    const bd = v.querySelector("#dbBoard"); if (bd) bd.onclick = debriefBoard;
  }
  function debriefPanel() {
    const d = debrief || {};
    let h = '<section class="gm-panel"><div class="gm-ph"><h2>' + X("Debriefing", "Debriefing", "Debriefing") + "</h2>" +
      (isProf() ? '<div class="gm-row"><button class="gm-btn sm" id="dbGen"' + (doneRounds().length ? "" : " disabled") + ">" + X("Gerar resumo", "Generate summary", "Generar resumen") + '</button><button class="gm-btn sm" id="dbAi"' + (d.auto ? "" : " disabled") + ">✨ " + X("Aprendizados com IA", "Learnings with AI", "Aprendizajes con IA") + '</button><button class="gm-btn sm" id="dbBoard">' + IC("board", 14) + " " + (d.board ? X("Abrir quadro", "Open board", "Abrir tablero") : X("Criar quadro de debriefing", "Create debriefing board", "Crear tablero de debriefing")) + "</button></div>" : (d.board ? '<a class="gm-btn sm" href="../board/?id=' + encodeURIComponent(d.board) + '">' + IC("board", 14) + " " + X("Abrir quadro", "Open board", "Abrir tablero") + "</a>" : "")) + "</div>";
    if (!d.auto) return h + '<p class="muted">' + X("O resumo fica disponível depois das rodadas processadas.", "The summary is available after rounds are processed.", "El resumen está disponible tras procesar las rondas.") + "</p></section>";
    h += '<div class="gm-teams">' + Object.keys(d.auto).sort().map(function (t) {
      const a = d.auto[t];
      return '<div class="gm-team" style="--c:' + tColor(t) + '"><b>' + esc(tName(t)) + "</b><ul>" +
        "<li>" + W("cumNI") + ": " + money(a.cumNI) + "</li><li>" + X("Melhor rodada: ", "Best round: ", "Mejor ronda: ") + a.best + " (" + money(a.bestNI) + ")</li><li>" + X("Preço médio: ", "Average price: ", "Precio medio: ") + money(a.avgPrice, 2) + "</li>" +
        "<li>Marketing + " + decLabel("rd") + ": " + money(a.mktRd) + "</li><li>" + W("share") + X(" médio: ", " average: ", " media: ") + pct(a.avgShare) + "</li>" + (a.emergency ? "<li>" + X("Rodadas com empréstimo emergencial: ", "Rounds with an emergency loan: ", "Rondas con préstamo de emergencia: ") + a.emergency + "</li>" : "") + "</ul></div>";
    }).join("") + "</div>";
    if (d.ai && d.ai.summary) h += '<div class="gm-ai"><h3>✨ ' + X("Aprendizados", "Learnings", "Aprendizajes") + "</h3><p>" + esc(d.ai.summary) + "</p>" + (d.ai.lessons && d.ai.lessons.length ? "<ul>" + d.ai.lessons.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul>" : "") + '<p class="muted small">' + X("Gerado por IA – revise antes de usar na avaliação.", "AI-generated – review before using it for assessment.", "Generado por IA – revisa antes de usarlo.") + "</p></div>";
    return h + "</section>";
  }
  function genDebrief() {
    const auto = {};
    teamIds().forEach(function (t) {
      const ds = doneRounds().filter(function (n) { return results[n].teams && results[n].teams[t]; }); if (!ds.length) return;
      let best = ds[0], sumP = 0, mr = 0, em = 0;
      ds.forEach(function (n) { const o = results[n].teams[t]; if (o.ni > results[best].teams[t].ni) best = n; sumP += o.price; mr += (o.decision.mkt || 0) + (o.decision.rd || 0); if ((o.warn || []).indexOf("emergency") >= 0) em++; });
      const last = results[ds[ds.length - 1]].teams[t];
      auto[t] = { cumNI: last.cumNI, best: best, bestNI: results[best].teams[t].ni, avgPrice: Math.round(sumP / ds.length * 100) / 100, mktRd: mr, avgShare: last.avgShare, emergency: em, value: last.value };
    });
    db.ref("game/" + ID + "/debrief").update({ auto: auto, at: TS() }).then(function () { toast(X("Resumo gerado", "Summary generated", "Resumen generado")); }, fail);
  }
  function aiDebrief() {
    const d = debrief || {}; if (!d.auto) return;
    if (!window.CMAI || !window.CMAI.generate) return toast(X("A IA não está disponível nesta página.", "AI is not available on this page.", "La IA no está disponible."));
    const lname = { pt: "português do Brasil", "pt-pt": "português de Portugal", en: "English", es: "español" }[LANG];
    const facts = Object.keys(d.auto).map(function (t) { const a = d.auto[t]; return tName(t) + ": cumulative profit " + a.cumNI + ", best round " + a.best + ", average price " + a.avgPrice + ", marketing+R&D " + a.mktRd + ", average share " + (a.avgShare * 100).toFixed(1) + "%, emergency loans " + a.emergency; }).join("\n");
    const prompt = "You are a business school professor running the debrief of a business simulation game (scenario: " + scenName(cfg.scenario) + ", " + doneRounds().length + " rounds). Teams' facts:\n" + facts +
      "\nWrite in " + lname + ". Return JSON {\"summary\": \"one paragraph comparing the strategies and what explains the ranking\", \"lessons\": [\"4 to 6 short management lessons for the class\"]}.";
    const b = document.getElementById("dbAi"); if (b) b.disabled = true;
    window.CMAI.generate("debrief", prompt).then(function (r) {
      return db.ref("game/" + ID + "/debrief/ai").set({ summary: String((r && r.summary) || "").slice(0, 3000), lessons: ((r && r.lessons) || []).slice(0, 8).map(function (x) { return String(x).slice(0, 300); }), at: TS() });
    }).then(function () { toast(X("Aprendizados gerados", "Learnings generated", "Aprendizajes generados")); }, function (e) { if (b) b.disabled = false; fail(e); });
  }
  function boardRec(title, tpl) { return { title: title, ws: info.ws, template: tpl, created: TS(), createdBy: me.email, game: ID }; }
  function debriefBoard() {
    const d = debrief || {};
    if (d.board) { location.href = "../board/?id=" + encodeURIComponent(d.board); return; }
    const id = slug("debriefing " + (info.title || "")) + "-" + rnd(), title = "Debriefing – " + (info.title || "Business Game"), u = {};
    u["boards/" + id + "/info"] = boardRec(title, "retro"); u["workspaces/" + info.ws + "/boards/" + id] = { title: title, template: "retro", created: TS() };
    u["game/" + ID + "/debrief/board"] = id;
    db.ref().update(u).then(function () { toast(X("Quadro de debriefing criado", "Debriefing board created", "Tablero de debriefing creado")); }, fail);
  }
  function createBoards() {
    const u = {}; let c = 0;
    teamIds().forEach(function (t) {
      BOARDS.forEach(function (b) {
        if (teams[t].boards && teams[t].boards[b[0]]) return;
        const id = slug(b[1] + " " + tName(t)) + "-" + rnd(), title = b[1] + " – " + tName(t) + " · " + (info.title || "");
        u["boards/" + id + "/info"] = boardRec(title, b[0]); u["workspaces/" + info.ws + "/boards/" + id] = { title: title, template: b[0], created: TS() };
        u["game/" + ID + "/teams/" + t + "/boards/" + b[0]] = id; c++;
      });
    });
    if (!c) return toast(X("Todas as equipes já têm os quadros.", "Every team already has its boards.", "Todos los equipos ya tienen sus tableros."));
    db.ref().update(u).then(function () { toast(c + X(" quadros criados", " boards created", " tableros creados")); }, fail);
  }

  /* ================= professor panel ================= */
  function viewTeacher(v) {
    const cr = curRound(), r = rounds[cr] || {}, ids = teamIds();
    let h = '<section class="gm-panel"><div class="gm-ph"><h2>' + (cr ? W("round") + " " + cr + " · " + roundStatus(cr) : X("Nenhuma rodada aberta", "No round opened", "Ninguna ronda abierta")) + "</h2>" + (r.status === "open" && r.deadline ? '<span class="gm-cd" data-cd="' + r.deadline + '"></span>' : "") + "</div>";
    if (!ids.length) h += '<p class="gm-warn">' + X("Crie as equipes em Configuração antes de abrir a rodada.", "Create the teams in Settings before opening a round.", "Crea los equipos antes de abrir la ronda.") + "</p>";
    if (r.status === "open") {
      h += '<div class="gm-tw"><table class="gm-t"><thead><tr><th>' + W("team") + "</th><th>" + X("Situação", "Status", "Estado") + "</th><th>" + X("Por", "By", "Por") + "</th><th>" + X("Quando", "When", "Cuándo") + "</th><th></th></tr></thead><tbody>" +
        ids.map(function (t) { const d = decisionFor(cr, t); return '<tr><td><span class="dot" style="background:' + tColor(t) + '"></span>' + esc(tName(t)) + "</td><td>" + (d ? '<span class="gm-ok">✓ ' + X("Enviada", "Sent", "Enviada") + "</span>" : '<span class="gm-warn">' + X("Pendente", "Pending", "Pendiente") + "</span>") + "</td><td>" + esc(d ? nameOf(d.by) : "") + "</td><td>" + (d ? dt(d.at) : "") + '</td><td><button class="gm-btn sm" data-seet="' + t + '">' + X("Ver / editar", "View / edit", "Ver / editar") + "</button></td></tr>"; }).join("") + "</tbody></table></div>" +
        '<p class="muted small">' + X("Equipes sem decisão repetem a decisão da rodada anterior (ou a decisão padrão na rodada 1).", "Teams without a decision repeat their previous decision (or the default one in round 1).", "Los equipos sin decisión repiten la anterior.") + "</p>" +
        '<h3>' + X("Eventos desta rodada", "Events this round", "Eventos de esta ronda") + "</h3>" + eventsEditor(r.events || []) +
        '<div class="gm-actions"><button class="gm-btn" data-ext="3600000">+1 h</button><button class="gm-btn" data-ext="86400000">+24 h</button><span class="sp"></span><label class="gm-chk"><input type="checkbox" id="mailRes" checked> ' + X("Avisar alunos por e-mail", "E-mail students", "Avisar a los alumnos por e-mail") + '</label><button class="gm-btn primary" id="closeRound">' + X("Fechar e processar", "Close and process", "Cerrar y procesar") + "</button></div>";
    } else if (cr < totalRounds() && info.status !== "finished") {
      const nx = cr + 1, dl = new Date(Date.now() + (+cfg.deadlineH || 48) * 3600000);
      h += '<form id="openForm" class="gm-form"><h3>' + X("Abrir a rodada ", "Open round ", "Abrir la ronda ") + nx + '</h3><label class="gm-f"><span>' + X("Prazo para as equipes", "Deadline for the teams", "Plazo para los equipos") + '</span><input type="datetime-local" name="deadline" value="' + localDT(dl) + '"></label>' +
        "<h3>" + X("Eventos (opcional)", "Events (optional)", "Eventos (opcional)") + "</h3>" + eventsEditor([]) +
        '<div class="gm-actions"><label class="gm-chk"><input type="checkbox" name="mail" checked> ' + X("Avisar alunos por e-mail", "E-mail students", "Avisar a los alumnos por e-mail") + '</label><button class="gm-btn primary"' + (ids.length ? "" : " disabled") + ">" + X("Abrir rodada ", "Open round ", "Abrir ronda ") + nx + "</button></div></form>";
    } else h += '<p class="gm-ok">' + X("Todas as rodadas foram jogadas.", "All rounds have been played.", "Todas las rondas se jugaron.") + "</p>";
    h += "</section>";
    h += '<section class="gm-panel"><h2>' + X("Ferramentas", "Tools", "Herramientas") + '</h2><div class="gm-row wrap">' +
      '<button class="gm-btn" id="reproc"' + (doneRounds().length ? "" : " disabled") + ">" + IC("sync", 14) + " " + X("Reprocessar todas as rodadas", "Reprocess all rounds", "Reprocesar todas las rondas") + "</button>" +
      '<button class="gm-btn" id="xCsv2"' + (doneRounds().length ? "" : " disabled") + ">" + IC("export", 14) + " " + X("Exportar CSV", "Export CSV", "Exportar CSV") + "</button>" +
      '<button class="gm-btn" id="xPdf2"' + (doneRounds().length ? "" : " disabled") + ">" + IC("print", 14) + " " + X("Relatório PDF", "PDF report", "Informe PDF") + "</button>" +
      (info.status !== "finished" ? '<button class="gm-btn" id="finish"' + (doneRounds().length ? "" : " disabled") + ">" + X("Encerrar partida", "Finish game", "Terminar partida") + "</button>" : '<button class="gm-btn" id="reopen">' + X("Reabrir partida", "Reopen game", "Reabrir partida") + "</button>") +
      '</div><p class="muted small">' + X("Reprocessar recalcula tudo a partir da rodada 1 com as decisões e eventos guardados (útil depois de corrigir uma decisão ou um parâmetro). O resultado é sempre o mesmo para o mesmo input.", "Reprocessing recalculates everything from round 1 with the stored decisions and events (useful after fixing a decision or a parameter). Same input, same output.", "Reprocesar recalcula todo desde la ronda 1 con las decisiones y eventos guardados.") + "</p></section>";
    v.innerHTML = h;
    v.querySelectorAll("[data-seet]").forEach(function (b) { b.onclick = function () { selTeam = b.dataset.seet; view = "decisions"; render(); }; });
    v.querySelectorAll("[data-ext]").forEach(function (b) { b.onclick = function () { db.ref("game/" + ID + "/rounds/" + cr + "/deadline").set(Math.max(Date.now(), r.deadline || Date.now()) + +b.dataset.ext).then(function () { toast(X("Prazo prorrogado", "Deadline extended", "Plazo prorrogado")); }, fail); }; });
    bindEvents(v, function (evs) { if (r.status === "open") db.ref("game/" + ID + "/rounds/" + cr + "/events").set(evs.length ? evs : null).catch(fail); }, cr || curRound() + 1);
    const cl = v.querySelector("#closeRound"); if (cl) cl.onclick = function () { if (window.confirm(X("Fechar a rodada e calcular os resultados agora?", "Close the round and compute the results now?", "¿Cerrar la ronda y calcular los resultados ahora?"))) processRound(cr, v.querySelector("#mailRes").checked); };
    const of = v.querySelector("#openForm"); if (of) of.onsubmit = function (e) { e.preventDefault(); openRound(cr + 1, of.deadline.value ? Date.parse(of.deadline.value) : null, readEvents(of), of.mail.checked); };
    const rp = v.querySelector("#reproc"); if (rp) rp.onclick = function () { if (window.confirm(X("Recalcular todas as rodadas processadas?", "Recalculate every processed round?", "¿Recalcular todas las rondas procesadas?"))) reprocessAll(); };
    const c2 = v.querySelector("#xCsv2"); if (c2) c2.onclick = exportCsv;
    const p2 = v.querySelector("#xPdf2"); if (p2) p2.onclick = exportPdf;
    const fi = v.querySelector("#finish"); if (fi) fi.onclick = function () { if (window.confirm(X("Encerrar a partida? Os alunos continuam vendo os resultados.", "Finish the game? Students keep seeing the results.", "¿Terminar la partida?"))) db.ref("game/" + ID + "/info/status").set("finished").then(function () { if (!(debrief && debrief.auto)) genDebrief(); }, fail); };
    const ro = v.querySelector("#reopen"); if (ro) ro.onclick = function () { db.ref("game/" + ID + "/info/status").set("running").catch(fail); };
  }
  function localDT(d) { const z = function (x) { return String(x).padStart(2, "0"); }; return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "T" + z(d.getHours()) + ":" + z(d.getMinutes()); }
  function eventsEditor(evs) {
    const on = {}; evs.forEach(function (e) { on[e.type] = e; });
    return '<div class="gm-evs">' + Object.keys(E.EVENTS).map(function (k) {
      const i = eventInfo(k), e = on[k], val = e && e.k != null ? e.k : E.EVENTS[k].k;
      const shown = i.unit === "%" ? +(val * 100).toFixed(2) : val;
      return '<label class="gm-ev' + (e ? " on" : "") + '"><input type="checkbox" data-ev="' + k + '"' + (e ? " checked" : "") + "><span><b>" + esc(i.n) + "</b><small>" + esc(i.d) + '</small></span><span class="gm-evk">' + (i.unit === "%" ? "" : "×") + '<input type="number" step="0.01" data-evk="' + k + '" value="' + shown + '">' + (i.unit === "%" ? "%" : "") + "</span></label>";
    }).join("") + '<button type="button" class="gm-btn sm" data-surprise>🎲 ' + X("Evento surpresa", "Surprise event", "Evento sorpresa") + "</button></div>";
  }
  function readEvents(root) {
    const out = [];
    root.querySelectorAll("[data-ev]").forEach(function (c) {
      if (!c.checked) return; const k = c.dataset.ev, inp = root.querySelector('[data-evk="' + k + '"]');
      let val = Number(inp && inp.value); if (!isFinite(val) || val <= 0) val = E.EVENTS[k].k; if (eventInfo(k).unit === "%") val = val / 100;
      out.push({ type: k, k: val });
    });
    return out;
  }
  function bindEvents(root, onChange, n) {
    root.querySelectorAll("[data-ev], [data-evk]").forEach(function (c) { c.onchange = function () { const l = c.closest(".gm-ev"); if (l) l.classList.toggle("on", !!l.querySelector("[data-ev]").checked); onChange(readEvents(root)); }; });
    const s = root.querySelector("[data-surprise]");
    if (s) s.onclick = function () { const k = E.surprise(ID + ":" + n), c = root.querySelector('[data-ev="' + k + '"]'); if (c && !c.checked) { c.checked = true; c.onchange(); } toast("🎲 " + eventInfo(k).n); };
  }

  function openRound(n, deadline, evs, mail) {
    const u = {};
    u["game/" + ID + "/rounds/" + n] = { status: "open", opened: TS(), deadline: deadline || null, events: evs.length ? evs : null };
    if (info.status !== "running") u["game/" + ID + "/info/status"] = "running";
    db.ref().update(u).then(function () { toast(X("Rodada ", "Round ", "Ronda ") + n + X(" aberta", " opened", " abierta")); if (mail) notify("game-round", { round: n }); }, fail);
  }
  function fullDecisions(n) {
    const p = P(), out = {}, auto = {};
    teamIds().forEach(function (t) {
      let d = decisionFor(n, t);
      if (!d) { d = Object.assign({}, prevDecision(n, t) || E.defaultDecision(p, stateBefore(n, t), teamIds().length)); delete d.strategic; delete d.by; delete d.at; auto[t] = true; }
      out[t] = d;
    });
    return { d: out, auto: auto };
  }
  function computeRound(n, prevTeams) {
    const p = P(), st = {};
    teamIds().forEach(function (t) { st[t] = prevTeams && prevTeams[t] ? fixState(prevTeams[t].state) : E.initState(p); });
    const fd = fullDecisions(n), dec = {};
    Object.keys(fd.d).forEach(function (t) { const x = {}; E.DECISIONS.forEach(function (k) { x[k] = decOn(k) ? (Number(fd.d[t][k]) || 0) : 0; }); dec[t] = x; });
    const r = E.runRound(p, st, dec, n, (rounds[n] || {}).events || []);
    const sc = E.score(r.teams, cfg.weights || E.WEIGHTS), ranking = {};
    Object.keys(r.teams).forEach(function (t) { const o = r.teams[t]; ranking[t] = { score: sc[t], cumNI: o.cumNI, value: o.value, sat: o.sat, share: o.share, avgShare: o.avgShare, sales: o.sales, price: o.price, ni: o.ni }; });
    return { r: r, ranking: ranking, fd: fd };
  }
  function resultWrites(n, c, u) {
    u["game/" + ID + "/results/" + n] = { public: { market: c.r.market, ranking: c.ranking, at: TS(), version: E.VERSION }, teams: c.r.teams };
    Object.keys(c.fd.auto).forEach(function (t) { u["game/" + ID + "/decisions/" + n + "/" + t] = Object.assign({}, c.fd.d[t], { auto: true, at: TS(), by: me.email }); });
  }
  function processRound(n, mail) {
    const btn = document.getElementById("closeRound"); if (btn) btn.disabled = true;
    try {
      const c = computeRound(n, results[n - 1] && results[n - 1].teams), u = {};
      resultWrites(n, c, u);
      u["game/" + ID + "/rounds/" + n + "/status"] = "done"; u["game/" + ID + "/rounds/" + n + "/processed"] = TS();
      if (n >= totalRounds()) u["game/" + ID + "/info/status"] = "finished";
      db.ref().update(u).then(function () {
        toast(X("Rodada processada ✓", "Round processed ✓", "Ronda procesada ✓"));
        pushStrategic(n);
        if (mail) notify("game-results", { round: n });
      }, function (e) { if (btn) btn.disabled = false; fail(e); });
    } catch (e) { if (btn) btn.disabled = false; fail(e); }
  }
  function reprocessAll() {
    const ds = doneRounds(), u = {}; let prev = null;
    const keep = results; results = {};
    try {
      ds.forEach(function (n) { const c = computeRound(n, prev); resultWrites(n, c, u); results[n] = { teams: c.r.teams }; prev = c.r.teams; });
    } catch (e) { results = keep; return fail(e); }
    results = keep;
    db.ref().update(u).then(function () { toast(X("Rodadas reprocessadas ✓", "Rounds reprocessed ✓", "Rondas reprocesadas ✓")); }, fail);
  }

  /* strategic decisions → connected planning (initiatives / epics), written by the professor */
  function pushStrategic(n) {
    const plan = info.plan; if (!plan) return;
    const todo = [];
    teamIds().forEach(function (t) { const d = decisionFor(n, t), s = (d && d.strategic) || {}; Object.keys(s).forEach(function (k) { if (!s[k].item) todo.push({ t: t, k: k, s: s[k] }); }); });
    if (!todo.length) return;
    const base = db.ref("planning/" + plan + "/data");
    base.child("settings").once("value").then(function (sn) {
      const st = sn.val() || {}, sts = st.statuses || [], stt = (sts.find(function (x) { return x.cat === "todo" && x.stage !== "up"; }) || sts[0] || { id: "todo" }).id;
      return base.child("settings/seq").transaction(function (v) { return (v || 0) + todo.length; }).then(function (r) {
        let seq = r.snapshot.val() - todo.length; const u = {};
        todo.forEach(function (x) {
          seq++; const key = (st.prefix || "PLN") + "-" + seq, iid = "g" + Date.now().toString(36) + rnd();
          const parent = (cfg.planTeams || {})[x.t];
          u["planning/" + plan + "/data/items/" + iid] = { type: x.s.type === "epic" ? "epic" : "initiative", title: "[" + W("round").charAt(0) + n + " · " + tName(x.t) + "] " + x.s.title, status: stt, key: key, order: seq, created: TS(), by: me.email,
            parent: x.s.type === "epic" && parent ? parent : null, src: { game: ID, round: n, team: x.t } };
          u["game/" + ID + "/decisions/" + n + "/" + x.t + "/strategic/" + x.k + "/item"] = key;
        });
        return db.ref().update(u).then(function () { toast(X("Decisões estratégicas levadas ao planejamento: ", "Strategic decisions sent to the planning: ", "Decisiones estratégicas enviadas a la planificación: ") + todo.length); });
      });
    }).catch(function (e) { fail({ message: X("Não foi possível gravar no planejamento: ", "Could not write to the planning: ", "No se pudo escribir en la planificación: ") + ((e && e.message) || "") }); });
  }

  function notify(kind, extra) {
    const url = window.CMCOLLAB_MAILER; if (!url || !me) return Promise.resolve(null);
    return me.getIdToken().then(function (tok) {
      return fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ kind: kind, idToken: tok, game: ID, lang: LANG, brand: window.CMCOLLAB_BRAND || "", tz: (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ""; } })() }, extra || {})) }).then(function (r) { return r.json(); });
    }).then(function (j) { if (j && j.ok && j.sent && j.sent.length) toast(X("E-mails enviados: ", "E-mails sent: ", "E-mails enviados: ") + j.sent.length); else if (j && !j.ok) console.warn("notifier", j.error); return j; }, function (e) { console.warn(e); return null; });
  }

  /* ================= settings ================= */
  function viewSettings(v) {
    const p = P(), started = doneRounds().length > 0 || curRound() > 0, c = curr(), b = cfg.brand || {};
    let h = '<form class="gm-panel gm-form live" id="sGen"><h2>' + X("Partida", "Game", "Partida") + "</h2>" +
      '<div class="gm-fg"><label class="gm-f"><span>' + X("Nome da partida", "Game name", "Nombre de la partida") + '</span><input name="title" value="' + esc(info.title || "") + '" maxlength="80"></label>' +
      '<label class="gm-f"><span>' + X("Número de rodadas", "Number of rounds", "Número de rondas") + '</span><input type="number" name="rounds" min="1" max="16" value="' + totalRounds() + '"></label>' +
      '<label class="gm-f"><span>' + X("Prazo padrão por rodada (horas)", "Default deadline per round (hours)", "Plazo por ronda (horas)") + '</span><input type="number" name="deadlineH" min="1" value="' + (+cfg.deadlineH || 48) + '"></label>' +
      '<label class="gm-f"><span>' + X("Idioma padrão da partida", "Default game language", "Idioma predeterminado") + '</span><select name="lang">' + Object.keys(LANGS).map(function (k) { return '<option value="' + k + '"' + ((cfg.lang || "pt") === k ? " selected" : "") + ">" + LANGS[k] + "</option>"; }).join("") + "</select></label></div>" +
      "<h3>" + X("Instituição (marca)", "Institution (brand)", "Institución (marca)") + '</h3><div class="gm-fg"><label class="gm-f"><span>' + X("Nome", "Name", "Nombre") + '</span><input name="bname" value="' + esc(b.name || "") + '" maxlength="80"></label>' +
      '<label class="gm-f"><span>' + X("Logo (URL da imagem)", "Logo (image URL)", "Logo (URL de la imagen)") + '</span><input name="blogo" type="url" value="' + esc(b.logo || "") + '" placeholder="https://"></label>' +
      '<label class="gm-f"><span>' + X("Cor", "Colour", "Color", "Cor") + '</span><input name="bcolor" type="color" value="' + esc(b.color || "#2cc4b3") + '"></label></div>' +
      "<h3>" + X("Moeda e formato", "Currency and format", "Moneda y formato") + '</h3><div class="gm-fg"><label class="gm-f"><span>' + X("Moeda", "Currency", "Moneda") + '</span><select name="cur"><option value="__custom"' + (c.custom ? " selected" : "") + ">" + X("Moeda fictícia…", "Fictional currency…", "Moneda ficticia…") + "</option>" + allCurrencies().map(function (k) { return '<option value="' + k + '"' + (!c.custom && c.code === k ? " selected" : "") + ">" + k + " – " + esc(curName(k)) + "</option>"; }).join("") + "</select></label>" +
      '<label class="gm-f cc"' + (c.custom ? "" : " hidden") + "><span>" + X("Nome da moeda fictícia", "Fictional currency name", "Nombre de la moneda ficticia") + '</span><input name="cname" value="' + esc(c.name || "") + '" placeholder="' + esc(X("Crédito Simulado", "Simulated Credit", "Crédito Simulado")) + '"></label>' +
      '<label class="gm-f cc"' + (c.custom ? "" : " hidden") + "><span>" + X("Símbolo", "Symbol", "Símbolo") + '</span><input name="csym" value="' + esc(c.symbol || "") + '" maxlength="6" placeholder="CS$"></label>' +
      '<label class="gm-f cc"' + (c.custom ? "" : " hidden") + "><span>" + X("Casas decimais", "Decimals", "Decimales") + '</span><input name="cdec" type="number" min="0" max="3" value="' + (c.decimals != null ? c.decimals : 2) + '"></label>' +
      '<label class="gm-f"><span>' + X("Formato dos números (país)", "Number format (country)", "Formato de números (país)") + '</span><select name="country">' + Object.keys(COUNTRIES).map(function (k) { return '<option value="' + k + '"' + ((cfg.country || "") === k ? " selected" : "") + ">" + (k ? k + " – " + esc(regionName(k)) : X("Automático (pelo idioma)", "Automatic (by language)", "Automático (por idioma)")) + "</option>"; }).join("") + "</select></label>" +
      '<p class="muted small gm-sample">' + X("Exemplo: ", "Example: ", "Ejemplo: ") + esc(money(1162236.5, cdec())) + "</p></div>" +
      '<div class="gm-actions"><button class="gm-btn primary">' + X("Salvar", "Save", "Guardar") + "</button></div></form>";
    // scenario & parameters
    h += '<form class="gm-panel gm-form live" id="sScen"><h2>' + X("Cenário e regras", "Scenario and rules", "Escenario y reglas") + "</h2>" +
      (started ? '<p class="gm-note">' + X("A partida já começou: mudar parâmetros só vale ao reprocessar as rodadas.", "The game has started: parameter changes only apply when rounds are reprocessed.", "La partida ya empezó: los cambios valen al reprocesar.") + "</p>" : "") +
      '<div class="gm-fg"><label class="gm-f"><span>' + X("Cenário de partida", "Starting scenario", "Escenario") + '</span><select name="scenario">' + Object.keys(E.SCENARIOS).map(function (k) { return '<option value="' + k + '"' + (cfg.scenario === k ? " selected" : "") + ">" + esc(scenName(k)) + "</option>"; }).join("") +
      Object.keys(wsTemplates).map(function (k) { return '<option value="tpl:' + k + '">' + X("Modelo da instituição: ", "Institution model: ", "Modelo de la institución: ") + esc(wsTemplates[k].name) + "</option>"; }).join("") + '</select></label><button type="button" class="gm-btn sm" id="applyScen">' + X("Aplicar cenário", "Apply scenario", "Aplicar escenario") + "</button>" +
      '<label class="gm-f"><span>' + X("Converter valores monetários ×", "Convert money values ×", "Convertir valores ×") + '</span><input type="number" step="0.0001" min="0.0001" name="factor" placeholder="' + esc(X("ex.: 0,18 de real para euro", "e.g. 0.18", "ej.: 0,18")) + '"></label><button type="button" class="gm-btn sm" id="applyConv">' + X("Converter", "Convert", "Convertir") + "</button></div>" +
      paramsTable(p) +
      "<h3>" + X("Decisões disponíveis para as equipes", "Decisions available to the teams", "Decisiones disponibles") + '</h3><div class="gm-chks">' + E.DECISIONS.map(function (k) { const fixed = k === "price" || k === "qty"; return '<label class="gm-chk"><input type="checkbox" name="dec_' + k + '"' + (decOn(k) ? " checked" : "") + (fixed ? " disabled" : "") + "> " + esc(decLabel(k)) + "</label>"; }).join("") + "</div>" +
      "<h3>" + X("Pesos da pontuação (%)", "Score weights (%)", "Pesos de la puntuación (%)") + '</h3><div class="gm-fg">' + ["profit", "value", "sat", "share"].map(function (k) { const w = cfg.weights || E.WEIGHTS; return '<label class="gm-f"><span>' + esc({ profit: W("cumNI"), value: W("value"), sat: W("sat"), share: W("share") }[k]) + '</span><input type="number" min="0" max="100" name="w_' + k + '" value="' + (w[k] != null ? w[k] : 0) + '"></label>'; }).join("") + "</div>" +
      '<div class="gm-actions"><button type="button" class="gm-btn" id="saveTpl">' + X("Salvar como modelo da instituição", "Save as institution model", "Guardar como modelo de la institución") + '</button><button class="gm-btn primary">' + X("Salvar regras", "Save rules", "Guardar reglas") + "</button></div></form>";
    // teams & people
    h += '<section class="gm-panel"><div class="gm-ph"><h2>' + W("teams") + " (" + teamIds().length + ")</h2><span class=\"muted small\">" + X("recomendado: 4 a 6", "recommended: 4 to 6", "recomendado: 4 a 6") + '</span></div><div class="gm-teams">' + teamIds().map(function (t) {
      return '<div class="gm-team" style="--c:' + tColor(t) + '"><div class="gm-row"><b>' + esc(tName(t)) + '</b><span class="sp"></span><button class="gm-btn sm ghost" data-ren="' + t + '">' + IC("pencil", 14) + '</button><button class="gm-btn sm ghost danger" data-delt="' + t + '"' + (started ? " disabled" : "") + ">" + IC("trash", 14) + "</button></div><ul>" +
        membersOf(t).map(function (p) { return "<li>" + esc(p.name || p.email) + ' <span class="muted small">' + esc(p.email) + '</span> <button class="gm-btn sm ghost" data-rmp="' + esc(A.key(p.email)) + '">✕</button></li>'; }).join("") + "</ul></div>";
    }).join("") + '</div><div class="gm-row"><input id="newTeam" placeholder="' + esc(X("Nome da equipe (ex.: Alfa)", "Team name (e.g. Alpha)", "Nombre del equipo", "Nome da equipa")) + '" maxlength="40"><button class="gm-btn sm" id="addTeam"' + (teamIds().length >= 6 ? " disabled" : "") + ">+ " + W("team") + "</button></div></section>";
    h += '<form class="gm-panel gm-form" id="sPeople"><h2>' + X("Alunos e professores", "Students and professors", "Alumnos y profesores") + "</h2>" +
      '<p class="muted small">' + X("Uma pessoa por linha: e-mail; nome; equipe. Para professor convidado, use “professor” no lugar da equipe.", "One person per line: e-mail; name; team. For a guest professor write “professor” instead of the team.", "Una persona por línea: e-mail; nombre; equipo. Para profesor, escribe “profesor”.") + "</p>" +
      '<textarea name="list" rows="5" placeholder="ana@faculdade.edu; Ana Souza; ' + esc(tName(teamIds()[0] || "Alfa")) + '"></textarea>' +
      '<div class="gm-actions"><label class="gm-chk"><input type="checkbox" name="mail" checked> ' + X("Enviar convite por e-mail", "Send invitation by e-mail", "Enviar invitación por e-mail") + '</label><label class="gm-chk"><input type="checkbox" name="ws"> ' + X("Dar acesso aos quadros do workspace (editor)", "Give access to the workspace boards (editor)", "Dar acceso a los tableros del workspace") + '</label><button class="gm-btn primary">' + X("Adicionar", "Add", "Añadir") + "</button></div>" +
      '<ul class="gm-people">' + Object.keys(people).filter(function (k) { return people[k].role === "prof"; }).map(function (k) { return "<li>" + X("Professor: ", "Professor: ", "Profesor: ") + esc(people[k].name || people[k].email) + ' <span class="muted small">' + esc(people[k].email) + "</span>" + (k !== ME ? ' <button type="button" class="gm-btn sm ghost" data-rmp="' + k + '">✕</button>' : "") + "</li>"; }).join("") + "</ul></form>";
    // planning
    const plans = Object.keys(wsPlans);
    h += '<section class="gm-panel"><h2>' + X("Planejamento conectado", "Connected planning", "Planificación conectada") + '</h2><div class="gm-row wrap"><select id="planSel"><option value="">' + X("— nenhum —", "— none —", "— ninguna —") + "</option>" + plans.map(function (k) { return '<option value="' + k + '"' + (info.plan === k ? " selected" : "") + ">" + esc(wsPlans[k].title || k) + "</option>"; }).join("") + '</select><button class="gm-btn sm" id="planSave">' + X("Conectar", "Connect", "Conectar") + '</button><span class="muted">' + X("ou", "or", "o") + '</span><button class="gm-btn sm" id="planNew">' + IC("planning", 14) + " " + X("Criar planejamento do semestre", "Create semester planning", "Crear planificación del semestre") + "</button></div>" +
      '<p class="muted small">' + X("O planejamento do semestre já vem com uma iniciativa por equipe e um marco por rodada. As decisões estratégicas viram itens nele quando a rodada é processada.", "The semester planning comes with one initiative per team and one milestone per round. Strategic decisions become items in it when the round is processed.", "La planificación del semestre trae una iniciativa por equipo y un hito por ronda.") + "</p></section>";
    if (isAdm || wsInfo.owner === ME) h += '<section class="gm-panel danger-zone"><h2>' + X("Excluir partida", "Delete game", "Eliminar partida") + '</h2><button class="gm-btn danger" id="delGame">' + IC("trash", 14) + " " + X("Excluir esta partida", "Delete this game", "Eliminar esta partida") + "</button></section>";
    v.innerHTML = h;
    bindSettings(v);
  }
  function regionName(k) { try { return new Intl.DisplayNames([LOCALE[LANG]], { type: "region" }).of(k); } catch (e) { return k; } }
  const PARAM_GROUPS = [
    [X("Mercado", "Market", "Mercado"), [["D0", X("Demanda base por rodada", "Base demand per round", "Demanda base por ronda")], ["g", X("Crescimento por rodada", "Growth per round", "Crecimiento por ronda"), "%"], ["Pref", X("Preço de referência", "Reference price", "Precio de referencia"), "$"], ["em", X("Elasticidade do mercado ao preço médio", "Market elasticity to average price", "Elasticidad del mercado")], ["e", X("Elasticidade da fatia ao preço", "Share elasticity to price", "Elasticidad de la cuota al precio")], ["a", X("Efeito do marketing", "Marketing effect", "Efecto del marketing")], ["gq", X("Efeito da qualidade (P&D)", "Quality (R&D) effect", "Efecto de la calidad")], ["ls", X("Efeito da satisfação", "Satisfaction effect", "Efecto de la satisfacción")], ["spill", X("Transbordo da demanda não atendida", "Spill-over of unmet demand", "Traspaso de demanda no atendida"), "%"]]],
    [X("Custos e operação", "Costs and operations", "Costos y operación"), [["cv", X("Custo unitário (insumos)", "Unit cost (inputs)", "Costo unitario"), "$"], ["sal", X("Salário por funcionário por rodada", "Salary per employee per round", "Salario por empleado por ronda"), "$"], ["prod", X("Produtividade (unidades por funcionário)", "Productivity (units per employee)", "Productividad")], ["tau", X("Ganho máximo do treinamento", "Max training gain", "Ganancia máx. de capacitación"), "%"], ["trRef", X("Treinamento de referência por funcionário", "Reference training per employee", "Capacitación de referencia"), "$"], ["hire", X("Custo por contratação", "Cost per hire", "Costo por contratación"), "$"], ["fire", X("Custo por demissão", "Cost per layoff", "Costo por despido"), "$"], ["capCost", X("Investimento por unidade de capacidade", "Investment per unit of capacity", "Inversión por unidad de capacidad"), "$"], ["dep", X("Depreciação por rodada", "Depreciation per round", "Depreciación por ronda"), "%"], ["stor", X("Estocagem por unidade", "Storage per unit", "Almacenaje por unidad"), "$"], ["adm", X("Despesa administrativa fixa", "Fixed overheads", "Gastos fijos"), "$"], ["dB", X("Desgaste da marca por rodada", "Brand decay per round", "Desgaste de la marca"), "%"], ["dQ", X("Desgaste da qualidade por rodada", "Quality decay per round", "Desgaste de la calidad"), "%"]]],
    [X("Finanças", "Finance", "Finanzas"), [["r", X("Juros por rodada", "Interest per round", "Interés por ronda"), "%"], ["rE", X("Juros do empréstimo emergencial", "Emergency loan interest", "Interés de emergencia"), "%"], ["tax", X("Imposto sobre o lucro", "Income tax rate", "Impuesto a la renta"), "%"], ["debtMax", X("Teto de dívida (% do ativo)", "Debt ceiling (% of assets)", "Tope de deuda (% del activo)"), "%"], ["mult", X("Múltiplo do lucro anual no valor da empresa", "Annual profit multiple in company value", "Múltiplo de utilidad anual")]]],
    [X("Estado inicial de cada empresa", "Initial state of each company", "Estado inicial de cada empresa"), [["init.cash", W("cash"), "$"], ["init.stockU", W("stock") + " (" + X("unidades", "units", "unidades") + ")"], ["init.imob", W("fixed"), "$"], ["init.debt", W("debt"), "$"], ["init.W", W("staff")], ["init.B", X("Marca acumulada", "Accumulated brand", "Marca acumulada"), "$"], ["init.Q", X("Qualidade acumulada", "Accumulated quality", "Calidad acumulada"), "$"], ["init.S", W("sat")]]]
  ];
  function pget(p, k) { return k.indexOf("init.") === 0 ? p.init[k.slice(5)] : p[k]; }
  function paramsTable(p) {
    return PARAM_GROUPS.map(function (g) {
      return "<h3>" + esc(g[0]) + '</h3><div class="gm-fg">' + g[1].map(function (f) {
        const v = pget(p, f[0]), isPct = f[2] === "%";
        return '<label class="gm-f"><span>' + esc(f[1]) + (f[2] === "$" ? ' <em class="muted">(' + esc(curr().custom ? curr().symbol || "" : curr().code) + ")</em>" : isPct ? " <em class=\"muted\">(%)</em>" : "") + '</span><input type="number" step="any" name="p_' + f[0] + '" value="' + (isPct ? +(v * 100).toFixed(4) : v) + '"></label>';
      }).join("") + "</div>";
    }).join("");
  }
  function readParams(f) {
    const p = JSON.parse(JSON.stringify(P()));
    PARAM_GROUPS.forEach(function (g) { g[1].forEach(function (x) {
      const inp = f["p_" + x[0]]; if (!inp) return; let v = Number(inp.value); if (!isFinite(v)) return; if (x[2] === "%") v = v / 100;
      if (x[0].indexOf("init.") === 0) p.init[x[0].slice(5)] = v; else p[x[0]] = v;
    }); });
    return p;
  }
  function bindSettings(v) {
    const g = v.querySelector("#sGen");
    g.cur.onchange = function () { g.querySelectorAll(".cc").forEach(function (x) { x.hidden = g.cur.value !== "__custom"; }); };
    g.onsubmit = function (e) {
      e.preventDefault();
      const title = g.title.value.trim() || info.title, cur = g.cur.value === "__custom" ? { custom: true, name: g.cname.value.trim() || X("Crédito Simulado", "Simulated Credit", "Crédito Simulado"), symbol: g.csym.value.trim() || "CS$", decimals: Math.max(0, Math.min(3, +g.cdec.value || 0)) } : { code: g.cur.value };
      const u = {};
      u["game/" + ID + "/info/title"] = title; if (isAdm || wsInfo.owner === ME) u["workspaces/" + info.ws + "/games/" + ID + "/title"] = title;
      u["game/" + ID + "/config/rounds"] = Math.max(Math.max(1, curRound()), Math.min(16, +g.rounds.value || 8));
      u["game/" + ID + "/config/deadlineH"] = Math.max(1, +g.deadlineH.value || 48);
      u["game/" + ID + "/config/lang"] = g.lang.value; u["game/" + ID + "/config/currency"] = cur; u["game/" + ID + "/config/country"] = g.country.value || null;
      u["game/" + ID + "/config/brand"] = { name: g.bname.value.trim() || null, logo: /^https:\/\//.test(g.blogo.value.trim()) ? g.blogo.value.trim() : null, color: g.bcolor.value || null };
      document.activeElement && document.activeElement.blur();
      db.ref().update(u).then(function () { if (!langFromUser) LANG = g.lang.value; toast(X("Salvo ✓", "Saved ✓", "Guardado ✓")); }, fail);
    };
    const s = v.querySelector("#sScen");
    v.querySelector("#applyScen").onclick = function () {
      const val = s.scenario.value; let upd;
      if (val.indexOf("tpl:") === 0) { const t = wsTemplates[val.slice(4)] || {}; upd = { scenario: t.scenario || "industria", params: t.params || E.params(t.scenario || "industria"), decisions: t.decisions || null, weights: t.weights || null, currency: t.currency || cfg.currency || null, country: t.country || null, lang: t.lang || cfg.lang || null, brand: t.brand || cfg.brand || null, rounds: t.rounds || cfg.rounds || 8 }; }
      else upd = { scenario: val, params: E.params(val) };
      if (!window.confirm(X("Substituir os parâmetros atuais pelos do cenário escolhido?", "Replace the current parameters with the chosen scenario's?", "¿Reemplazar los parámetros actuales?"))) return;
      db.ref("game/" + ID + "/config").update(upd).then(function () { toast(X("Cenário aplicado", "Scenario applied", "Escenario aplicado")); }, fail);
    };
    v.querySelector("#applyConv").onclick = function () {
      const f = Number(String(s.factor.value).replace(",", ".")); if (!(f > 0)) return toast(X("Informe um fator maior que zero.", "Enter a factor above zero.", "Indica un factor mayor que cero."));
      db.ref("game/" + ID + "/config/params").set(E.convert(P(), f)).then(function () { toast(X("Valores convertidos ×", "Values converted ×", "Valores convertidos ×") + f); }, fail);
    };
    s.onsubmit = function (e) {
      e.preventDefault();
      const dec = {}; E.DECISIONS.forEach(function (k) { if (k !== "price" && k !== "qty" && s["dec_" + k] && !s["dec_" + k].checked) dec[k] = false; });
      const w = {}; ["profit", "value", "sat", "share"].forEach(function (k) { w[k] = Math.max(0, +s["w_" + k].value || 0); });
      if (!(w.profit + w.value + w.sat + w.share)) return toast(X("Defina ao menos um peso.", "Set at least one weight.", "Define al menos un peso."));
      document.activeElement && document.activeElement.blur();
      db.ref("game/" + ID + "/config").update({ params: readParams(s), decisions: Object.keys(dec).length ? dec : null, weights: w }).then(function () { toast(X("Regras salvas ✓", "Rules saved ✓", "Reglas guardadas ✓")); }, fail);
    };
    v.querySelector("#saveTpl").onclick = function () {
      const name = window.prompt(X("Nome do modelo (ex.: Business Game – Administração 5º semestre)", "Model name", "Nombre del modelo"), info.title || ""); if (!name) return;
      const id = slug(name) + "-" + rnd();
      db.ref("workspaces/" + info.ws + "/gameTemplates/" + id).set({ name: name.trim(), scenario: cfg.scenario || "industria", params: readParams(s), decisions: cfg.decisions || null, weights: cfg.weights || null, currency: cfg.currency || null, country: cfg.country || null, lang: cfg.lang || null, brand: cfg.brand || null, rounds: totalRounds(), created: TS(), by: me.email })
        .then(function () { toast(X("Modelo salvo para a instituição", "Model saved for the institution", "Modelo guardado")); loadWs(); }, function (e2) { fail({ message: X("Só o dono do workspace pode salvar modelos: ", "Only the workspace owner can save models: ", "Solo el dueño puede guardar modelos: ") + e2.message }); });
    };
    v.querySelector("#addTeam").onclick = function () {
      const inp = v.querySelector("#newTeam"), name = inp.value.trim() || W("team") + " " + (teamIds().length + 1); if (teamIds().length >= 6) return;
      const id = slug(name) || "t" + rnd(); if (teams[id]) return toast(X("Já existe uma equipe com esse nome.", "A team with this name already exists.", "Ya existe un equipo con ese nombre."));
      db.ref("game/" + ID + "/teams/" + id).set({ name: name, order: teamIds().length + 1, color: COLORS[teamIds().length % COLORS.length] }).catch(fail);
    };
    v.querySelectorAll("[data-ren]").forEach(function (b) { b.onclick = function () { const n = window.prompt(X("Novo nome da equipe", "New team name", "Nuevo nombre del equipo"), tName(b.dataset.ren)); if (n && n.trim()) db.ref("game/" + ID + "/teams/" + b.dataset.ren + "/name").set(n.trim()).catch(fail); }; });
    v.querySelectorAll("[data-delt]").forEach(function (b) { b.onclick = function () { if (membersOf(b.dataset.delt).length) return toast(X("Tire os alunos da equipe antes.", "Remove the students from the team first.", "Quita primero a los alumnos.")); if (window.confirm(X("Excluir a equipe?", "Delete the team?", "¿Eliminar el equipo?"))) db.ref("game/" + ID + "/teams/" + b.dataset.delt).remove().catch(fail); }; });
    v.querySelectorAll("[data-rmp]").forEach(function (b) { b.onclick = function () { const k = b.dataset.rmp, p = people[k]; if (!p || !window.confirm(X("Remover ", "Remove ", "Quitar ") + (p.name || p.email) + "?")) return; const u = {}; u["game/" + ID + "/people/" + k] = null; u["userGames/" + k + "/" + ID] = null; db.ref().update(u).catch(fail); }; });
    const pf = v.querySelector("#sPeople");
    pf.onsubmit = function (e) {
      e.preventDefault();
      const lines = pf.list.value.split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean), u = {}, added = [], bad = [];
      const byName = {}; teamIds().forEach(function (t) { byName[tName(t).toLowerCase()] = t; byName[t] = t; });
      lines.forEach(function (l) {
        const parts = l.split(/[;,\t]/).map(function (x) { return x.trim(); }), email = (parts[0] || "").toLowerCase(), name = parts[1] || email.split("@")[0], tm = (parts[2] || "").toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { bad.push(l); return; }
        const isP = /^prof/.test(tm), team = isP ? null : byName[tm];
        if (!isP && !team) { bad.push(l); return; }
        const k = A.key(email);
        u["game/" + ID + "/people/" + k] = { email: email, name: name, role: isP ? "prof" : "student", team: team || null, added: TS() };
        u["userGames/" + k + "/" + ID] = { title: info.title || "Business Game", role: isP ? "prof" : "student", team: team || null };
        if (pf.ws.checked && !isP) u["workspaces/" + info.ws + "/members/" + k] = { email: email, name: name, role: "editor", added: TS(), via: "game" };
        added.push(email);
      });
      if (bad.length) return toast(X("Linhas com erro (e-mail ou equipe): ", "Lines with errors (e-mail or team): ", "Líneas con error: ") + bad.slice(0, 3).join(" | "));
      if (!added.length) return;
      db.ref().update(u).then(function () { toast(added.length + X(" pessoa(s) adicionada(s)", " person(s) added", " persona(s) añadida(s)")); if (pf.mail.checked) notify("game-invite", { to: added }); pf.list.value = ""; }, function (er) { fail({ message: (pf.ws.checked ? X("Só o dono do workspace pode dar acesso aos quadros. ", "Only the workspace owner can give board access. ", "Solo el dueño puede dar acceso. ") : "") + er.message }); });
    };
    v.querySelector("#planSave").onclick = function () { const pid = v.querySelector("#planSel").value || null; db.ref("game/" + ID + "/info/plan").set(pid).then(function () { toast(pid ? X("Planejamento conectado", "Planning connected", "Planificación conectada") : X("Desconectado", "Disconnected", "Desconectada")); }, fail); };
    v.querySelector("#planNew").onclick = createSemesterPlan;
    const dg = v.querySelector("#delGame"); if (dg) dg.onclick = function () {
      const typed = window.prompt(X("Isto apaga a partida, as decisões e os resultados. Digite o nome da partida para confirmar:", "This deletes the game, its decisions and results. Type the game name to confirm:", "Esto elimina la partida. Escribe su nombre para confirmar:") + " " + info.title);
      if (typed !== info.title) return;
      const u = {}; Object.keys(people).forEach(function (k) { u["userGames/" + k + "/" + ID] = null; }); if (isAdm || wsInfo.owner === ME) u["workspaces/" + info.ws + "/games/" + ID] = null;
      db.ref().update(u).then(function () { return db.ref("game/" + ID).remove(); }).then(function () { location.href = "../workspaces/"; }, fail);
    };
  }
  function createSemesterPlan() {
    if (!window.PLAN_INITIAL) return toast("Planning");
    const title = X("Semestre – ", "Semester – ", "Semestre – ") + (info.title || "Business Game"), pid = slug(title) + "-" + rnd();
    const data = window.PLAN_INITIAL("hybrid", title, { tpl: "e-semester" });
    const sts = data.settings.statuses || [], stt = (sts.find(function (x) { return x.cat === "todo" && x.stage !== "up"; }) || sts[0] || { id: "todo" }).id;
    let seq = data.settings.seq || Object.keys(data.items).length; const prefix = data.settings.prefix || "PLN";
    const iso = function (t) { return new Date(t).toISOString().slice(0, 10); }, now = Date.now(), planTeams = {};
    const gameEpic = "gb" + rnd() + rnd();
    seq++; data.items[gameEpic] = { type: "initiative", title: "Business Game – " + (info.title || ""), status: stt, key: prefix + "-" + seq, order: seq, start: iso(now), end: iso(now + totalRounds() * 7 * DAY), src: { game: ID } };
    for (let n = 1; n <= totalRounds(); n++) {
      seq++; const r = rounds[n] || {}, when = r.deadline || now + n * 7 * DAY;
      data.items["gr" + n + rnd()] = { type: "milestone", title: W("round") + " " + n + X(" – fechamento", " – closing", " – cierre"), status: stt, key: prefix + "-" + seq, order: seq, start: iso(when), end: iso(when), parent: null, src: { game: ID, round: n } };
    }
    teamIds().forEach(function (t) {
      seq++; const iid = "gt" + rnd() + rnd(); planTeams[t] = iid;
      data.items[iid] = { type: "initiative", title: W("team") + " " + tName(t), status: stt, key: prefix + "-" + seq, order: seq, src: { game: ID, team: t } };
    });
    data.settings.seq = seq;
    const u = {};
    u["planning/" + pid + "/info"] = { title: title, ws: info.ws, method: "hybrid", area: "education", created: TS(), createdBy: me.email, game: ID };
    u["planning/" + pid + "/data"] = data;
    u["workspaces/" + info.ws + "/plannings/" + pid] = { title: title, method: "hybrid", created: TS() };
    u["game/" + ID + "/info/plan"] = pid; u["game/" + ID + "/config/planTeams"] = planTeams;
    db.ref().update(u).then(function () { toast(X("Planejamento do semestre criado e conectado", "Semester planning created and connected", "Planificación creada y conectada")); loadWs(); }, function (e) { fail({ message: X("Só o dono do workspace ou um admin cria planejamentos: ", "Only the workspace owner or an admin can create plannings: ", "Solo el dueño o un admin crea planificaciones: ") + e.message }); });
  }

  /* ================= new game ================= */
  function newGame(wsId) {
    return Promise.all([db.ref("workspaces/" + wsId).once("value").then(function (s) { return s.val() || {}; }, function () { return {}; }), window.CMModules ? window.CMModules.has("game", wsId) : Promise.resolve(true)]).then(function (r) {
      const w = r[0]; wsInfo = w.info || {}; wsTemplates = w.gameTemplates || {};
      if (!r[1]) return window.CMModules.gate("game", wsId, app);
      if (!isAdm && wsInfo.owner !== ME) return gate(X("Sem permissão", "Not allowed", "Sin permiso"), X("Só o dono do workspace ou um admin cria partidas.", "Only the workspace owner or an admin can create games.", "Solo el dueño del workspace o un admin crea partidas."));
      const c0 = LANG === "en" ? "USD" : LANG === "pt-pt" || LANG === "es" ? "EUR" : "BRL";
      app.innerHTML = '<header class="gm-top"><a class="gm-back" href="../workspaces/">' + IC("back", 18) + '</a><span class="gm-logo">CM</span><div class="gm-title"><h1>' + X("Nova partida", "New game", "Nueva partida") + '</h1><span class="gm-sub">Business Game · ' + esc(wsInfo.name || wsId) + "</span></div></header>" +
        '<main class="gm-view"><form class="gm-panel gm-form gm-new" id="newF"><h2>' + X("Criar partida", "Create game", "Crear partida") + "</h2>" +
        '<label class="gm-f"><span>' + X("Nome da partida (turma)", "Game name (class)", "Nombre de la partida (curso)") + '</span><input name="title" required maxlength="80" placeholder="' + esc(X("Ex.: Administração 5º semestre – 2026/2", "E.g. Business 101 – Fall 2026", "Ej.: Administración 5º semestre")) + '"></label>' +
        '<label class="gm-f"><span>' + X("Cenário ou modelo da instituição", "Scenario or institution model", "Escenario o modelo de la institución") + '</span><select name="scen">' + Object.keys(E.SCENARIOS).map(function (k) { return '<option value="' + k + '">' + esc(scenName(k)) + "</option>"; }).join("") + Object.keys(wsTemplates).map(function (k) { return '<option value="tpl:' + k + '">' + X("Modelo: ", "Model: ", "Modelo: ") + esc(wsTemplates[k].name) + "</option>"; }).join("") + "</select></label>" +
        '<div class="gm-fg"><label class="gm-f"><span>' + X("Moeda", "Currency", "Moneda") + '</span><select name="cur">' + allCurrencies().map(function (k) { return '<option value="' + k + '"' + (k === c0 ? " selected" : "") + ">" + k + " – " + esc(curName(k)) + "</option>"; }).join("") + "</select></label>" +
        '<label class="gm-f"><span>' + X("Idioma", "Language", "Idioma") + '</span><select name="lang">' + Object.keys(LANGS).map(function (k) { return '<option value="' + k + '"' + (k === LANG ? " selected" : "") + ">" + LANGS[k] + "</option>"; }).join("") + "</select></label>" +
        '<label class="gm-f"><span>' + X("Rodadas", "Rounds", "Rondas") + '</span><input type="number" name="rounds" min="1" max="16" value="8"></label>' +
        '<label class="gm-f"><span>' + X("Equipes", "Teams", "Equipos", "Equipas") + '</span><input type="number" name="teams" min="2" max="6" value="4"></label></div>' +
        '<p class="muted small">' + X("Você pode ajustar tudo depois em Configuração (moeda fictícia, parâmetros, marca, pesos).", "You can adjust everything later in Settings (fictional currency, parameters, brand, weights).", "Puedes ajustar todo después en Configuración.") + "</p>" +
        '<div class="gm-actions"><a class="gm-btn" href="../workspaces/">' + X("Cancelar", "Cancel", "Cancelar") + '</a><button class="gm-btn primary">' + X("Criar partida", "Create game", "Crear partida") + "</button></div></form></main>";
      const f = document.getElementById("newF");
      const qsc = QS.get("scenario"); if (qsc && f.scen && [].some.call(f.scen.options, function (o) { return o.value === qsc; })) f.scen.value = qsc; // area chosen on My boards
      f.onsubmit = function (e) {
        e.preventDefault();
        const title = f.title.value.trim(); if (!title) return;
        const id = slug(title) + "-" + rnd(), sv = f.scen.value, u = {};
        let conf;
        if (sv.indexOf("tpl:") === 0) { const t = wsTemplates[sv.slice(4)] || {}; conf = { scenario: t.scenario || "industria", params: t.params || E.params(t.scenario || "industria"), decisions: t.decisions || null, weights: t.weights || E.WEIGHTS, currency: t.currency || { code: f.cur.value }, country: t.country || null, lang: t.lang || f.lang.value, brand: t.brand || null, rounds: +f.rounds.value || t.rounds || 8 }; }
        else conf = { scenario: sv, params: E.params(sv), weights: E.WEIGHTS, currency: { code: f.cur.value }, lang: f.lang.value, rounds: +f.rounds.value || 8, brand: wsInfo.name ? { name: wsInfo.name } : null };
        conf.deadlineH = 48;
        u["game/" + id + "/info"] = { title: title, ws: wsId, status: "setup", created: TS(), createdBy: me.email };
        u["game/" + id + "/config"] = conf;
        const nt = Math.max(2, Math.min(6, +f.teams.value || 4)), names = ["Alfa", "Beta", "Gama", "Delta", "Épsilon", "Zeta"];
        for (let i = 0; i < nt; i++) u["game/" + id + "/teams/" + slug(names[i])] = { name: names[i], order: i + 1, color: COLORS[i] };
        u["game/" + id + "/people/" + ME] = { email: me.email, name: me.displayName || me.email.split("@")[0], role: "prof", added: TS() };
        u["workspaces/" + wsId + "/games/" + id] = { title: title, scenario: conf.scenario, created: TS() };
        u["userGames/" + ME + "/" + id] = { title: title, role: "prof" };
        f.querySelector(".gm-btn.primary").disabled = true;
        db.ref().update(u).then(function () { if (window.CMMarkSeen) window.CMMarkSeen("game"); location.href = "./?id=" + encodeURIComponent(id); }, function (er) { f.querySelector(".gm-btn.primary").disabled = false; fail(er); });
      };
    });
  }

  window.CMGame = { _X: X, _money: function (v, d) { return money(v, d); } };
  start();
})();
