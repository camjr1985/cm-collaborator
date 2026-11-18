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
  const A = window.CMAuth, E = window.CMGameEngine, PM = window.CMProjectEngine;
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
    if (isPM()) return {
      approach: X("Abordagem do projeto (escolhida na 1ª rodada)", "Project approach (chosen in round 1)", "Enfoque del proyecto (se elige en la 1.ª ronda)"),
      hire: X("Contratar (+) / dispensar (−) pessoas", "Hire (+) / release (−) people", "Contratar (+) / liberar (−) personas", "Contratar (+) / dispensar (−) pessoas"),
      ot: X("Hora extra", "Overtime", "Horas extra"), outsource: X("Terceirizar entregas", "Outsource deliverables", "Tercerizar entregas", "Subcontratar entregas"),
      qa: X("Esforço em qualidade e testes", "Quality and testing effort", "Esfuerzo en calidad y pruebas"), train: X("Treinamento da equipe", "Team training", "Capacitación del equipo", "Formação da equipa"),
      mitigation: X("Mitigação de riscos", "Risk mitigation", "Mitigación de riesgos"), comms: X("Comunicação com stakeholders", "Stakeholder communication", "Comunicación con stakeholders"),
      accept: X("Aceitar mudanças pedidas", "Accept requested changes", "Aceptar cambios solicitados"), descope: X("Cortar escopo", "Cut scope", "Recortar alcance", "Cortar âmbito")
    }[k] || k;
    return {
      price: X("Preço", "Price", "Precio"), qty: X("Produção", "Production", "Producción"), mkt: "Marketing", rd: X("P&D", "R&D", "I+D", "I&D"),
      hire: X("Contratação (+) / demissão (−)", "Hiring (+) / layoffs (−)", "Contratación (+) / despidos (−)", "Contratação (+) / despedimento (−)"),
      train: X("Treinamento por funcionário", "Training per employee", "Capacitación por empleado", "Formação por colaborador"),
      invest: X("Investimento em capacidade", "Capacity investment", "Inversión en capacidad"),
      loan: X("Novo empréstimo", "New loan", "Nuevo préstamo", "Novo financiamento"), amort: X("Amortização de dívida", "Debt repayment", "Amortización de deuda")
    }[k] || k;
  }
  function unitLabel() {
    const u = (cfg.params || {}).unit || (isPM() ? "points" : "unit");
    return { points: X("pontos de entrega", "delivery points", "puntos de entrega"), packages: X("pacotes de obra", "work packages", "paquetes de obra"), unit: X("unidades", "units", "unidades"), hour: X("horas", "hours", "horas"), subscription: X("assinaturas", "subscriptions", "suscripciones") }[u] || u;
  }
  function scenName(id) {
    if (isPM() || PM.SCENARIOS[id]) return pmScenName(id);
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
    if (isPM()) { const t = {
      "hire-max": X("Dispensas limitadas: a equipe precisa de pelo menos 1 pessoa.", "Releases limited: the team needs at least 1 person.", "Liberaciones limitadas: el equipo necesita al menos 1 persona."),
      "ot-range": X("Hora extra limitada a 30%.", "Overtime limited to 30%.", "Horas extra limitadas al 30%."), "qa-range": X("Esforço em qualidade limitado a 40%.", "Quality effort limited to 40%.", "Esfuerzo en calidad limitado al 40%."),
      "out-max": X("Terceirização limitada ao máximo por rodada.", "Outsourcing limited to the maximum per round.", "Tercerización limitada al máximo por ronda."), "out-unused": X("Parte da terceirização não foi usada: faltou trabalho.", "Part of the outsourcing was not used: not enough work left.", "Parte de la tercerización no se usó."),
      "descope-max": X("Corte de escopo limitado a 50% do que falta.", "Scope cut limited to 50% of what is left.", "Recorte limitado al 50% de lo que falta.")
    }[w]; if (t) return t; }
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

  /* ---------------- modes: "project" (project management, default for new games) · "business" (company & market) ---------------- */
  function isPM() { return cfg.mode === "project"; }
  function ENG() { return isPM() ? PM : E; }
  function defScen() { return isPM() ? "lancamento" : "industria"; }
  function pmScenName(id) {
    return { lancamento: X("Lançamento de produto", "Product launch", "Lanzamiento de producto"), erp: X("Implantação de ERP", "ERP implementation", "Implantación de ERP", "Implementação de ERP"),
      obra: X("Obra / expansão de unidade", "Construction / site expansion", "Obra / ampliación de planta"), pmo: X("Portfólio de projetos (PMO)", "Project portfolio (PMO)", "Portafolio de proyectos (PMO)") }[id] || id;
  }
  function pmScenDesc(id) {
    return { lancamento: X("Uma fabricante de bens de consumo lança uma nova linha de produtos dentro da janela comercial.", "A consumer goods maker launches a new product line within the commercial window.", "Un fabricante de bienes de consumo lanza una nueva línea dentro de la ventana comercial."),
      erp: X("Uma distribuidora troca o sistema de gestão (finanças, estoque e faturamento) até o go-live.", "A distributor replaces its management system (finance, inventory, billing) by go-live.", "Una distribuidora cambia su sistema de gestión (finanzas, inventario, facturación) hasta el go-live."),
      obra: X("Construção de um centro de distribuição, com cronograma físico-financeiro, licenças e empreiteiras.", "Building a distribution centre, with a physical-financial schedule, permits and contractors.", "Construcción de un centro de distribución, con cronograma físico-financiero, licencias y contratistas."),
      pmo: X("O PMO tem um portfólio de projetos maior que o orçamento e a equipe disponíveis: é preciso priorizar e cortar.", "The PMO has a portfolio bigger than the available budget and team: prioritise and cut.", "La PMO tiene un portafolio mayor que el presupuesto y el equipo disponibles: hay que priorizar y recortar.") }[id] || "";
  }
  /* events per case: id (what the professor picks) → engine type + default strength */
  function pmEvents() {
    const L = function (pt, en, es) { return X(pt, en, es); };
    const C = {
      lancamento: [["concorrente", "concorrente", 0.15, L("Concorrente lança antes", "Competitor launches first", "Un competidor lanza antes")], ["fornecedor", "atraso", 0.3, L("Atraso do fornecedor de embalagem", "Packaging supplier delay", "Retraso del proveedor de envases")],
        ["rotulo", "mudanca_escopo", 0.08, L("Mudança de rótulo exigida pela regulação", "Label change required by the regulator", "Cambio de etiqueta exigido por el regulador")], ["insumos", "alta_custos", 1.2, L("Alta de insumos", "Input costs rise", "Suben los insumos")],
        ["gerente", "saida_chave", 1, L("Saída do gerente de marca", "Brand manager leaves", "Sale el gerente de marca")], ["teste", "retrabalho", 0.08, L("Falha no teste de mercado", "Market test fails", "Falla la prueba de mercado")], ["verba", "corte_orcamento", 0.9, L("Corte da verba de marketing", "Marketing budget cut", "Recorte del presupuesto de marketing")]],
      erp: [["usuario", "saida_chave", 2, L("Saída do usuário-chave", "Key user leaves", "Sale el usuario clave")], ["migracao", "retrabalho", 0.1, L("Retrabalho na migração de dados", "Data migration rework", "Retrabajo en la migración de datos")],
        ["custom", "mudanca_escopo", 0.1, L("Pedido de customização da diretoria", "Customisation request from the board", "Pedido de personalización de la dirección")], ["fornecedor", "atraso", 0.3, L("Atraso do fornecedor do sistema", "Software vendor delay", "Retraso del proveedor del sistema")],
        ["licencas", "alta_custos", 1.15, L("Reajuste das licenças", "Licence price increase", "Aumento de las licencias")], ["orcamento", "corte_orcamento", 0.9, L("Corte no orçamento de TI", "IT budget cut", "Recorte del presupuesto de TI")], ["fiscal", "concorrente", 0.15, L("Nova obrigação fiscal com prazo", "New tax obligation with a deadline", "Nueva obligación fiscal con plazo")]],
      obra: [["chuva", "atraso", 0.3, L("Chuvas fortes", "Heavy rain", "Lluvias fuertes")], ["licenca", "atraso", 0.5, L("Atraso de licença", "Permit delay", "Retraso de licencia")], ["aco", "alta_custos", 1.25, L("Alta do aço e do cimento", "Steel and cement prices rise", "Suben el acero y el cemento")],
        ["acidente", "atraso", 0.8, L("Acidente paralisa a obra", "Accident stops the site", "Un accidente paraliza la obra")], ["docas", "mudanca_escopo", 0.08, L("Cliente pede mais docas", "Client asks for more docks", "El cliente pide más andenes")],
        ["engenheiro", "saida_chave", 3, L("Saída do engenheiro responsável e de parte da equipe", "Site engineer and part of the crew leave", "Sale el ingeniero responsable y parte del equipo")], ["investimento", "corte_orcamento", 0.9, L("Corte de investimento", "Investment cut", "Recorte de inversión")]],
      pmo: [["corte", "corte_orcamento", 0.85, L("Corte de orçamento", "Budget cut", "Recorte de presupuesto")], ["novo", "mudanca_escopo", 0.15, L("Projeto estratégico novo da diretoria", "New strategic project from the board", "Nuevo proyecto estratégico de la dirección")],
        ["conflito", "saida_chave", 3, L("Conflito de recursos com a operação", "Resource conflict with operations", "Conflicto de recursos con la operación")], ["fornecedor", "atraso", 0.25, L("Fornecedor crítico atrasa", "Critical supplier delays", "Proveedor crítico se retrasa")],
        ["cambio", "alta_custos", 1.15, L("Câmbio encarece contratos", "Exchange rate makes contracts dearer", "El tipo de cambio encarece los contratos")], ["auditoria", "retrabalho", 0.08, L("Auditoria reprova entregas", "Audit rejects deliverables", "La auditoría rechaza entregas")]]
    };
    return (C[cfg.scenario] || C.lancamento).map(function (e) { return { id: e[0], type: e[1], k: e[2], n: e[3] }; });
  }
  function pmTypeInfo(type) {
    return {
      mudanca_escopo: { d: X("Pedido de mudança no escopo: cada equipe decide quanto aceitar (campo “Aceitar mudanças”).", "Scope change request: each team decides how much to accept (“Accept changes”).", "Pedido de cambio de alcance: cada equipo decide cuánto aceptar."), unit: "%", what: X("do escopo inicial", "of the initial scope", "del alcance inicial") },
      atraso: { d: X("Parte da capacidade da equipe se perde nesta rodada. Exposição a risco alta piora o efeito.", "Part of the team's capacity is lost this round. High risk exposure makes it worse.", "Parte de la capacidad se pierde en esta ronda."), unit: "%", what: X("da capacidade", "of capacity", "de la capacidad") },
      saida_chave: { d: X("Pessoas-chave deixam o projeto e a moral cai.", "Key people leave the project and morale drops.", "Personas clave dejan el proyecto y la moral cae."), unit: "n", what: X("pessoas", "people", "personas") },
      alta_custos: { d: X("Materiais, licenças e terceiros ficam mais caros daqui em diante.", "Materials, licences and contractors cost more from now on.", "Materiales, licencias y terceros cuestan más desde ahora."), unit: "×", what: "" },
      retrabalho: { d: X("Parte do que já foi entregue precisa ser refeita.", "Part of what was delivered must be redone.", "Parte de lo entregado debe rehacerse."), unit: "%", what: X("do entregue", "of delivered work", "de lo entregado") },
      corte_orcamento: { d: X("O orçamento aprovado (BAC) é reduzido.", "The approved budget (BAC) is reduced.", "Se reduce el presupuesto aprobado (BAC)."), unit: "×", what: "" },
      concorrente: { d: X("Se o projeto não for entregue até o prazo planejado, o valor para o negócio cai.", "If the project is not delivered by the planned round, business value drops.", "Si el proyecto no se entrega en el plazo, cae el valor para el negocio."), unit: "%", what: X("do valor", "of value", "del valor") }
    }[type] || { d: "", unit: "×", what: "" };
  }
  /* catalog used by the professor panel: [{id, type, k, n, d, unit}] */
  function evCatalog() {
    if (isPM()) return pmEvents().map(function (e) { const i = pmTypeInfo(e.type); return { id: e.id, type: e.type, k: e.k, n: e.n, d: i.d, unit: i.unit, what: i.what }; });
    return Object.keys(E.EVENTS).map(function (k) { const i = eventInfo(k); return { id: k, type: k, k: E.EVENTS[k].k, n: i.n, d: i.d, unit: i.unit, what: "" }; });
  }
  function evInfo(e) { const c = evCatalog().find(function (x) { return x.id === (e.id || e.type); }) || evCatalog().find(function (x) { return x.type === e.type; }); return c || { n: e.type, d: "" }; }

  /* ---------------- helpers on game data ---------------- */
  function P() { return cfg.params || ENG().params(cfg.scenario || defScen()); }
  function teamIds() { return Object.keys(teams || {}).sort(function (a, b) { return ((teams[a].order || 0) - (teams[b].order || 0)) || a.localeCompare(b); }); }
  function tName(t) { return (teams[t] && teams[t].name) || t; }
  function tColor(t) { const i = teamIds().indexOf(t); return (teams[t] && teams[t].color) || COLORS[(i < 0 ? 0 : i) % COLORS.length]; }
  function roundNos() { return Object.keys(rounds || {}).map(Number).filter(function (n) { return n > 0; }).sort(function (a, b) { return a - b; }); }
  function curRound() { const r = roundNos(); return r.length ? r[r.length - 1] : 0; }
  function doneRounds() { return roundNos().filter(function (n) { return rounds[n].status === "done"; }); }
  function lastDone() { const d = doneRounds(); return d.length ? d[d.length - 1] : 0; }
  function totalRounds() { return +cfg.rounds || 8; }
  function decFixed(k) { return isPM() ? (k === "approach" || k === "hire" || k === "qa") : (k === "price" || k === "qty"); }
  function decOn(k) { return decFixed(k) || !(cfg.decisions && cfg.decisions[k] === false); }
  function stateBefore(n, t) {
    const prev = results[n - 1] && results[n - 1].teams && results[n - 1].teams[t];
    return prev && prev.state ? fixState(prev.state) : ENG().initState(P());
  }
  function fixState(s) {
    const o = Object.assign({}, s);
    if (isPM()) { o.hist = o.hist || []; ["rework", "latent", "escaped", "done", "AC", "finished", "accepted", "descoped"].forEach(function (k) { o[k] = o[k] || 0; }); o.approach = o.approach || null; return o; }
    o.ni = o.ni || []; o.share = o.share || []; ["emerg", "stockU", "stockV", "debt", "retained", "cumNI"].forEach(function (k) { o[k] = o[k] || 0; }); return o; }
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
      (isPM() ? card(scenName(cfg.scenario), num(P().S0), unitLabel() + " · " + X("prazo: ", "deadline: ", "plazo: ") + P().N + X(" rodadas · orçamento ", " rounds · budget ", " rondas · presupuesto ") + money(P().BAC)) :
      pub ? card(X("Demanda do mercado", "Market demand", "Demanda del mercado"), num(pub.market.demand), unitLabel() + " · " + X("rodada ", "round ", "ronda ") + ld) +
        card(X("Preço médio", "Average price", "Precio medio"), money(pub.market.avgPrice, 2), X("vendas totais ", "total sales ", "ventas totales ") + num(pub.market.sales)) : "") +
      (role === "student" && pub && pub.ranking && pub.ranking[myTeam] ? card(X("Sua posição", "Your position", "Tu posición"), rankPos(pub.ranking, myTeam) + "º", W("score") + " " + num(pub.ranking[myTeam].score, 1)) : "") +
      "</section>";
    if (isPM() && pmScenDesc(cfg.scenario)) h += '<p class="gm-note">' + esc(pmScenDesc(cfg.scenario)) + " " + X("Todas as equipes começam com o mesmo escopo, prazo, orçamento e equipe.", "Every team starts with the same scope, deadline, budget and team.", "Todos los equipos empiezan con el mismo alcance, plazo, presupuesto y equipo.", "Todas as equipas começam com o mesmo âmbito, prazo, orçamento e equipa.") + "</p>";
    if (r.status === "open") h += eventsBox(r.events, X("Eventos desta rodada", "Events this round", "Eventos de esta ronda"));
    if (pub && isPM()) {
      h += '<section class="gm-panel"><div class="gm-ph"><h2>' + X("Ranking", "Ranking", "Clasificación") + ' <span class="muted">· ' + W("round") + " " + ld + "</span></h2></div>" + rankingTable(pub.ranking) + weightsNote() + "</section>";
      h += '<div class="gm-grid2"><section class="gm-panel"><h2>' + X("Escopo concluído", "Scope complete", "Alcance completado") + "</h2>" + lineChart("pct", pct) + '</section><section class="gm-panel"><h2>' + X("Valor previsto para o negócio", "Expected business value", "Valor previsto para el negocio") + ' <span class="muted">· ' + W("round") + " " + ld + "</span></h2>" + bars(pub.ranking, "value", money) + "</section></div>";
    } else if (pub) {
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
  function weightsNote() {
    if (isPM()) { const w = cfg.weights || PM.WEIGHTS; return '<p class="muted small">' + W("score") + ": " + X("prazo (SPI) ", "schedule (SPI) ", "plazo (SPI) ") + (w.time || 0) + "% · " + X("custo (CPI) ", "cost (CPI) ", "costo (CPI) ") + (w.cost || 0) + "% · " + X("escopo entregue ", "scope delivered ", "alcance entregado ") + (w.scope || 0) + "% · " + X("qualidade ", "quality ", "calidad ") + (w.quality || 0) + "% · stakeholders " + (w.stake || 0) + "%</p>"; }
    const w = cfg.weights || E.WEIGHTS; return '<p class="muted small">' + W("score") + ": " + W("cumNI").toLowerCase() + " " + (w.profit || 0) + "% · " + W("value").toLowerCase() + " " + (w.value || 0) + "% · " + W("sat").toLowerCase() + " " + (w.sat || 0) + "% · " + W("share").toLowerCase() + " " + (w.share || 0) + "%</p>"; }
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
    return '<section class="gm-panel gm-events"><h2>' + esc(title) + "</h2><ul>" + evs.map(function (e) { const i = evInfo(e); return "<li><b>" + esc(i.n) + "</b> – " + esc(i.d) + "</li>"; }).join("") + "</ul></section>";
  }
  function rankingTable(rk) {
    if (!rk) return "";
    const ids = Object.keys(rk).sort(function (a, b) { return rk[b].score - rk[a].score; });
    if (isPM()) return '<div class="gm-tw"><table class="gm-t"><thead><tr><th>#</th><th>' + W("team") + '</th><th class="r">' + W("score") + '</th><th class="r">' + X("Concluído", "Complete", "Completado") + '</th><th class="r">CPI</th><th class="r">SPI</th><th class="r">' + X("Qualidade", "Quality", "Calidad") + '</th><th class="r">Stakeholders</th><th class="r">' + X("Término", "Finish", "Término") + '</th><th class="r">' + X("Valor", "Value", "Valor") + "</th></tr></thead><tbody>" +
      ids.map(function (t, i) { const x = rk[t]; return '<tr class="' + (t === myTeam ? "mine" : "") + '"><td>' + (i + 1) + '</td><td class="nw"><span class="dot" style="background:' + tColor(t) + '"></span>' + esc(tName(t)) + '</td><td class="r"><b>' + num(x.score, 1) + '</b></td><td class="r">' + pct(x.pct) + '</td><td class="r' + (x.CPI < 1 ? " neg" : "") + '">' + num(x.CPI, 2) + '</td><td class="r' + (x.SPI < 1 ? " neg" : "") + '">' + num(x.SPI, 2) + '</td><td class="r">' + num(x.quality, 1) + '</td><td class="r">' + num(x.stake, 1) + '</td><td class="r">' + (x.finished ? "✓ " + W("round").charAt(0) + x.finished : "≈ " + W("round").charAt(0) + x.forecast) + '</td><td class="r">' + money(x.value) + "</td></tr>"; }).join("") + "</tbody></table></div>";
    return '<div class="gm-tw"><table class="gm-t"><thead><tr><th>#</th><th>' + W("team") + '</th><th class="r">' + W("score") + '</th><th class="r">' + W("cumNI") + '</th><th class="r">' + W("value") + '</th><th class="r">' + W("sat") + '</th><th class="r">' + W("share") + "</th></tr></thead><tbody>" +
      ids.map(function (t, i) { const x = rk[t]; return '<tr class="' + (t === myTeam ? "mine" : "") + '"><td>' + (i + 1) + '</td><td class="nw"><span class="dot" style="background:' + tColor(t) + '"></span>' + esc(tName(t)) + '</td><td class="r"><b>' + num(x.score, 1) + '</b></td><td class="r">' + money(x.cumNI) + '</td><td class="r">' + money(x.value) + '</td><td class="r">' + num(x.sat, 1) + '</td><td class="r">' + pct(x.avgShare != null ? x.avgShare : x.share) + "</td></tr>"; }).join("") + "</tbody></table></div>";
  }

  /* ---------------- charts (SVG, hover tooltips, legend + table elsewhere) ---------------- */
  function lineChart(metric, fmt) {
    fmt = fmt || money;
    const ds = doneRounds(); if (!ds.length) return "";
    const ids = teamIds().filter(function (t) { return ds.some(function (n) { return results[n].public && results[n].public.ranking && results[n].public.ranking[t]; }); });
    const series = ids.map(function (t) { return { t: t, pts: ds.map(function (n) { const x = results[n].public.ranking[t]; return x ? x[metric] : null; }) }; });
    const vals = [0]; series.forEach(function (s) { s.pts.forEach(function (p) { if (p != null) vals.push(p); }); });
    let mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals); if (mx === mn) mx = mn + 1;
    const Wd = 560, H = 220, L = 74, Rp = 12, T = 12, B = 28, iw = Wd - L - Rp, ih = H - T - B;
    const x = function (i) { return L + (ds.length === 1 ? iw / 2 : i * iw / (ds.length - 1)); }, y = function (v) { return T + ih - (v - mn) / (mx - mn) * ih; };
    let g = "";
    [0, 0.5, 1].forEach(function (f) { const v = mn + (mx - mn) * f; g += '<line x1="' + L + '" x2="' + (Wd - Rp) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="grid"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" class="ax" text-anchor="end">' + esc(fmt === pct ? pct(v) : compact(v)) + "</text>"; });
    if (mn < 0) g += '<line x1="' + L + '" x2="' + (Wd - Rp) + '" y1="' + y(0) + '" y2="' + y(0) + '" class="zero"/>';
    ds.forEach(function (n, i) { g += '<text x="' + x(i) + '" y="' + (H - 8) + '" class="ax" text-anchor="middle">' + W("round").charAt(0) + n + "</text>"; });
    series.forEach(function (s) {
      const d = s.pts.map(function (p, i) { return p == null ? "" : (i ? "L" : "M") + x(i) + " " + y(p); }).join(" ");
      g += '<path d="' + d + '" fill="none" stroke="' + tColor(s.t) + '" stroke-width="2" stroke-linejoin="round"/>';
      s.pts.forEach(function (p, i) { if (p == null) return; g += '<circle cx="' + x(i) + '" cy="' + y(p) + '" r="4" fill="' + tColor(s.t) + '" stroke="#fff" stroke-width="2" data-tip="' + esc(tName(s.t) + " · " + W("round") + " " + ds[i] + ": " + fmt(p)) + '"/>'; });
    });
    return '<div class="gm-chart"><svg viewBox="0 0 ' + Wd + " " + H + '" role="img" aria-label="' + esc(metric) + '">' + g + "</svg>" + legend(ids) + '<div class="gm-tip" hidden></div></div>';
  }
  function compact(v) { try { return new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(v); } catch (e) { return String(Math.round(v)); } }
  function legend(ids) { return '<div class="gm-legend">' + ids.map(function (t) { return '<span><i style="background:' + tColor(t) + '"></i>' + esc(tName(t)) + "</span>"; }).join("") + "</div>"; }
  function bars(rk, metric, fmt, what) {
    if (!rk) return "";
    const ids = teamIds().filter(function (t) { return rk[t]; }), mx = Math.max.apply(null, ids.map(function (t) { return Math.abs(rk[t][metric] || 0); }).concat([0.0001]));
    return '<div class="gm-bars">' + ids.map(function (t) { const s = rk[t][metric] || 0; return '<div class="gm-bar" data-tip="' + esc(tName(t) + ": " + fmt(s) + (what ? " " + what : "")) + '"><span class="bl">' + esc(tName(t)) + '</span><span class="bt"><i style="width:' + Math.max(0, s / mx * 100).toFixed(1) + "%;background:" + tColor(t) + '"></i></span><span class="bv">' + esc(fmt === money ? compact(s) : fmt(s)) + "</span></div>"; }).join("") + '</div><div class="gm-tip" hidden></div>';
  }
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
    const d0 = Object.assign({}, ENG().defaultDecision(p, st, teamIds().length), prevDecision(n, t) || {}, saved || {});
    const strat = Object.assign({}, (saved && saved.strategic) || {});
    let h = '<div class="gm-bar-top">' + teamPicker("dTeam") + '<span class="gm-pill">' + W("round") + " " + n + " · " + roundStatus(n) + "</span>" +
      (r.deadline ? '<span class="gm-cd" data-cd="' + r.deadline + '"></span>' : "") +
      (saved && saved.at ? '<span class="muted small">' + (saved.auto ? X("Decisão automática (repetiu a anterior)", "Automatic decision (repeated the previous one)", "Decisión automática") : X("Enviada por ", "Sent by ", "Enviada por ") + esc(nameOf(saved.by)) + " · " + dt(saved.at)) + "</span>" : (open ? '<span class="gm-warn small">' + X("Ainda não enviada", "Not sent yet", "Aún no enviada") + "</span>" : "")) + "</div>";
    if (!open) h += '<p class="gm-note">' + X("A rodada está fechada. Você vê as decisões enviadas.", "The round is closed. You are seeing the decisions that were sent.", "La ronda está cerrada. Ves las decisiones enviadas.") + "</p>";
    else if (!canWrite && role === "student") h += '<p class="gm-note">' + X("O prazo desta rodada terminou. Aguarde o processamento.", "This round's deadline has passed. Wait for processing.", "El plazo terminó. Espera el procesamiento.") + "</p>";
    h += eventsBox(r.events, X("Eventos desta rodada", "Events this round", "Eventos de esta ronda"));
    const dis = canWrite ? "" : " disabled";
    h += '<div class="gm-dec"><form class="gm-panel gm-form live" id="decForm"><h2>' + X("Decisões da rodada", "Round decisions", "Decisiones de la ronda") + " " + n + "</h2>";
    if (isPM() && st.finished) h += '<p class="gm-note">' + X("O projeto da equipe já foi concluído. As próximas rodadas não geram custos.", "The team's project is finished. The next rounds have no costs.", "El proyecto del equipo ya terminó.") + "</p>";
    if (isPM()) ENG().DECISIONS.forEach(function (k) { if (decOn(k)) h += pmField(k, d0, dis, st); });
    else E.DECISIONS.forEach(function (k) {
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
    function read() {
      const d = {};
      ENG().DECISIONS.forEach(function (k) {
        if (k === "approach") { d[k] = f[k] ? f[k].value : (d0[k] || "hib"); return; }
        d[k] = f[k] ? Number(f[k].value) || 0 : (Number(d0[k]) || 0); if (!decOn(k)) d[k] = 0;
      });
      return d;
    }
    function preview() {
      if (isPM()) { v.querySelector("#decPrev").innerHTML = pmPreview(read(), st, p, n); pmHints(v, read(), st, p, n); return; }
      v.querySelector("#decPrev").innerHTML = previewHtml(read(), st, p, n); hints(read(), st, p);
    }
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
      const d = ENG().clampDecision(read(), st, p, n).d;
      const rec = Object.assign({}, d, { strategic: Object.keys(strat).length ? strat : null, by: me.email, at: TS() });
      const btn = v.querySelector("#decSave"); btn.disabled = true;
      db.ref("game/" + ID + "/decisions/" + n + "/" + t).set(rec).then(function () { btn.disabled = false; toast(X("Decisões enviadas ✓ Você pode alterar até o prazo.", "Decisions sent ✓ You can change them until the deadline.", "Decisiones enviadas ✓ Puedes cambiarlas hasta el plazo.")); if (document.activeElement) document.activeElement.blur(); render(); }, function (er) { btn.disabled = false; fail(er); });
    };
  }
  /* ---- project mode: decision fields, hints and preview ---- */
  function crUnitsOf(n) { const p = P(); return ((rounds[n] || {}).events || []).filter(function (e) { return e.type === "mudanca_escopo"; }).reduce(function (a, e) { return a + Math.round((e.k != null ? +e.k : 0.1) * p.S0); }, 0); }
  function apName(a) { return { pred: X("Preditiva (cascata)", "Predictive (waterfall)", "Predictivo (cascada)"), agil: X("Ágil", "Agile", "Ágil"), hib: X("Híbrida", "Hybrid", "Híbrido") }[a] || a; }
  function pmField(k, d0, dis, st) {
    const lab = '<span>' + esc(decLabel(k));
    if (k === "approach") {
      const locked = !!st.approach;
      return '<label class="gm-f"><span>' + esc(decLabel(k)) + '</span><select name="approach"' + (locked ? " disabled" : dis) + ">" + ["pred", "agil", "hib"].map(function (a) { return '<option value="' + a + '"' + ((st.approach || d0.approach || "hib") === a ? " selected" : "") + ">" + esc(apName(a)) + "</option>"; }).join("") + '</select><small class="muted" data-hint="approach"></small></label>';
    }
    const money_ = ["train", "mitigation", "comms"].indexOf(k) >= 0, pctF = ["ot", "qa", "accept"].indexOf(k) >= 0, units = k === "outsource" || k === "descope";
    const suf = money_ ? ' <em class="muted">(' + esc(curr().custom ? (curr().symbol || "") : curr().code) + ")</em>" : pctF ? ' <em class="muted">(%)</em>' : units ? ' <em class="muted">(' + esc(unitLabel()) + ")</em>" : "";
    const max = k === "ot" ? ' max="30"' : k === "qa" ? ' max="40"' : k === "accept" ? ' max="100"' : "";
    return '<label class="gm-f">' + lab + suf + '</span><input type="number" inputmode="decimal" name="' + k + '" step="1" min="' + (k === "hire" ? "-999" : "0") + '"' + max + ' value="' + esc(d0[k] != null ? d0[k] : 0) + '"' + dis + '><small class="muted" data-hint="' + k + '"></small></label>';
  }
  function pmHints(v, d0, s, p, n) {
    const d = PM.clampDecision(d0, s, p, n).d, set = function (k, txt) { const el = v.querySelector('[data-hint="' + k + '"]'); if (el) el.textContent = txt; };
    const a = PM.APPROACH[d.approach] || PM.APPROACH.hib;
    set("approach", s.approach ? X("Definida na rodada 1.", "Set in round 1.", "Definido en la ronda 1.") : { pred: X("Mudanças custam mais trabalho; um pouco menos de defeitos.", "Changes cost more work; slightly fewer defects.", "Los cambios cuestan más; algo menos de defectos."), agil: X("Começo mais lento, ritmo maior depois; mudanças baratas; stakeholders mais próximos.", "Slower start, faster later; cheap changes; closer stakeholders.", "Inicio más lento, luego más rápido; cambios baratos."), hib: X("Meio-termo entre as duas.", "A middle ground.", "Un punto intermedio.") }[d.approach]);
    set("hire", X("Equipe: ", "Team: ", "Equipo: ") + num(s.W) + " → " + num(Math.max(1, s.W + d.hire)) + " · " + X("contratar custa ", "hiring costs ", "contratar cuesta ") + money(p.hire) + X(", dispensar ", ", releasing ", ", liberar ") + money(p.fire) + X("; quem chega rende metade na 1ª rodada", "; newcomers deliver half in their first round", "; los nuevos rinden la mitad en su 1.ª ronda"));
    set("ot", X("+", "+", "+") + num(d.ot) + "% " + X("de capacidade, pago a 1,5× e reduz a moral", "capacity, paid at 1.5× and lowers morale", "de capacidad, pagado a 1,5× y baja la moral"));
    set("outsource", X("Até ", "Up to ", "Hasta ") + num(p.outMax) + " " + unitLabel() + X(" por rodada, a ", " per round, at ", " por ronda, a ") + money(p.cOut * (s.cmatK || 1)) + X(" cada; gera mais defeitos", " each; more defects", " cada una; más defectos"));
    set("qa", X("Defeitos estimados: ", "Estimated defects: ", "Defectos estimados: ") + num(p.d0 * (1 - Math.min(d.qa, 40) / 40 * 0.8) * a.def * 100, 1) + X(" a cada 100 entregas; reduz a capacidade em ", " per 100 deliverables; reduces capacity by ", " por cada 100 entregas; reduce la capacidad en ") + num(d.qa) + "%");
    set("train", X("Referência: ", "Reference: ", "Referencia: ") + money(p.trRef) + X(" por pessoa melhora a moral", " per person improves morale", " por persona mejora la moral"));
    set("mitigation", X("Exposição a risco: ", "Risk exposure: ", "Exposición al riesgo: ") + money(s.E) + " → " + money(Math.max(0, s.E + p.eGrow - d.mitigation * p.mitEff)) + X(" (cada 1 investido reduz ", " (each 1 spent removes ", " (cada 1 invertido reduce ") + num(p.mitEff, 1) + ")");
    set("comms", X("Referência: ", "Reference: ", "Referencia: ") + money(p.commRef) + X(" por rodada", " per round", " por ronda"));
    const cr = crUnitsOf(n);
    set("accept", cr ? X("Pedido de mudança nesta rodada: ", "Change request this round: ", "Pedido de cambio en esta ronda: ") + num(cr) + " " + unitLabel() + X(" – aceitar ", " – accepting ", " – aceptar ") + num(Math.round(cr * d.accept / 100)) + X(" aumenta escopo, prazo e orçamento", " adds scope, time and budget", " aumenta alcance, plazo y presupuesto") : X("Sem pedido de mudança nesta rodada.", "No change request this round.", "Sin pedido de cambio en esta ronda."));
    set("descope", X("Até ", "Up to ", "Hasta ") + num(Math.floor((s.scope - s.done) * 0.5)) + " " + unitLabel() + X("; reduz orçamento, valor entregue e a satisfação dos stakeholders", "; lowers budget, delivered value and stakeholder satisfaction", "; reduce presupuesto, valor entregado y satisfacción"));
  }
  function pmPreview(d0, s, p, n) {
    const cd = PM.clampDecision(d0, s, p, n), d = cd.d, warn = cd.warn.slice();
    const st = Object.assign({}, s, { approach: s.approach || d.approach }), c = PM.capacityOf(st, p, d, n);
    const rem = PM.remaining(s) + (s.latent || 0) - d.descope, cr = Math.round(crUnitsOf(n) * d.accept / 100);
    const work = Math.min(c.total, Math.max(0, rem + cr));
    const W = c.W, cost = Math.round(W * p.sal * (1 + d.ot / 100 * 1.5)) + Math.max(0, d.hire) * p.hire + Math.max(0, -d.hire) * p.fire + Math.round(Math.max(0, work - Math.min(d.outsource, work)) * p.cmat * (s.cmatK || 1)) + Math.round(Math.min(d.outsource, work) * p.cOut * (s.cmatK || 1)) + d.train + d.mitigation + d.comms;
    const prev = n > 1 && results[n - 1] && results[n - 1].teams && results[n - 1].teams[selTeam];
    const finish = (n - 1) + Math.ceil(Math.max(0, rem + cr) / Math.max(1, c.total));
    const rows = [[X("Escopo atual", "Current scope", "Alcance actual"), num(s.scope) + " " + unitLabel()], [X("Entregue até agora", "Delivered so far", "Entregado hasta ahora"), num(s.done)], [X("Falta (com retrabalho)", "Left (incl. rework)", "Falta (con retrabajo)"), num(Math.max(0, rem + cr))],
      [X("Capacidade nesta rodada", "Capacity this round", "Capacidad en esta ronda"), num(c.total) + " (" + X("equipe ", "team ", "equipo ") + num(c.internal) + (d.outsource ? " + " + X("terceiros ", "contractors ", "terceros ") + num(Math.min(d.outsource, p.outMax)) : "") + ")"],
      [X("Custo previsto da rodada", "Expected cost this round", "Costo previsto de la ronda"), money(cost)], [X("Orçamento (BAC) · gasto até agora", "Budget (BAC) · spent so far", "Presupuesto (BAC) · gastado"), money(s.BAC) + " · " + money(s.AC)],
      [X("Término previsto", "Forecast finish", "Término previsto"), W ? X("rodada ", "round ", "ronda ") + finish + X(" (plano: ", " (plan: ", " (plan: ") + p.N + ")" : "–"]];
    if (prev) rows.push(["CPI · SPI", num(prev.CPI, 2) + " · " + num(prev.SPI, 2)]);
    return "<h2>" + X("Prévia", "Preview", "Vista previa") + '</h2><table class="gm-t mini"><tbody>' + rows.map(function (r) { return "<tr><td>" + esc(r[0]) + '</td><td class="r">' + esc(r[1]) + "</td></tr>"; }).join("") + "</tbody></table>" +
      (finish > p.N ? '<p class="gm-warn">' + X("No ritmo atual, o projeto termina depois do prazo planejado.", "At the current pace the project ends after the planned deadline.", "Al ritmo actual el proyecto termina después del plazo.") + "</p>" : "") +
      (warn.length ? '<ul class="gm-warns">' + warn.map(function (w) { return "<li>" + esc(warnText(w)) + "</li>"; }).join("") + "</ul>" : "") +
      '<p class="muted small">' + X("A prévia é uma estimativa: defeitos, retrabalho e eventos só aparecem quando o professor processar a rodada.", "The preview is an estimate: defects, rework and events only show when the professor processes the round.", "La vista previa es una estimación.") + "</p>";
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
    if (isPM()) { v.innerHTML = h + pmResults(o, pub, t, n); bindResBar(v); bindTips(v); return; }
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
  /* ---- project mode: results ---- */
  function f2(x) { return num(x, 2); }
  function pmResults(o, pub, t, n) {
    const p = P(), rk = pub.ranking || {};
    let h = '<section class="gm-cards">' + card(X("Concluído", "Complete", "Completado"), pct(o.pct), num(o.done) + " / " + num(o.scope) + " " + unitLabel()) +
      card("CPI", f2(o.CPI), X("custo: ", "cost: ", "costo: ") + (o.CPI >= 1 ? X("dentro do orçamento", "on budget", "dentro del presupuesto") : X("acima do orçamento", "over budget", "por encima del presupuesto"))) +
      card("SPI", f2(o.SPI), X("prazo: ", "schedule: ", "plazo: ") + (o.SPI >= 1 ? X("em dia", "on track", "al día") : X("atrasado", "behind", "atrasado"))) +
      card(X("Término", "Finish", "Término"), (o.finished ? "✓ " : "≈ ") + X("rodada ", "round ", "ronda ") + (o.finished || o.forecast), (o.finished ? X("concluído", "finished", "terminado") : X("previsão", "forecast", "previsión")) + " · " + X("plano: rodada ", "plan: round ", "plan: ronda ") + p.N + (o.late ? " · " + num(o.late) + X(" de atraso", " late", " de atraso") : "")) +
      card(X("Qualidade", "Quality", "Calidad"), num(o.quality, 1), "0–100") + card("Stakeholders", num(o.stake, 1), "0–100") +
      card(X("Valor para o negócio", "Business value", "Valor para el negocio"), money(o.value), X("retorno ", "return ", "retorno ") + pct(o.roi)) +
      (rk[t] ? card(W("score"), num(rk[t].score, 1), rankPos(rk, t) + "º " + X("lugar", "place", "lugar")) : "") + "</section>";
    if (o.warn && o.warn.length) h += '<ul class="gm-warns panel">' + o.warn.map(function (w) { return "<li>" + esc(warnText(w)) + "</li>"; }).join("") + "</ul>";
    const evm = [[X("Valor planejado (PV)", "Planned value (PV)", "Valor planificado (PV)"), money(o.PV)], [X("Valor agregado (EV)", "Earned value (EV)", "Valor ganado (EV)"), money(o.EV)], [X("Custo real (AC)", "Actual cost (AC)", "Costo real (AC)"), money(o.AC)],
      [X("Variação de custo (CV = EV − AC)", "Cost variance (CV = EV − AC)", "Variación de costo (CV)"), money(o.CV)], [X("Variação de prazo (SV = EV − PV)", "Schedule variance (SV = EV − PV)", "Variación de plazo (SV)"), money(o.SV)],
      ["CPI (EV ÷ AC)", f2(o.CPI)], ["SPI (EV ÷ PV)", f2(o.SPI)], [X("Orçamento (BAC)", "Budget (BAC)", "Presupuesto (BAC)"), money(o.BAC)], [X("Estimativa no término (EAC)", "Estimate at completion (EAC)", "Estimación a la conclusión (EAC)"), money(o.EAC)], [X("Variação no término (VAC)", "Variance at completion (VAC)", "Variación a la conclusión (VAC)"), money(o.VAC)]];
    h += '<div class="gm-grid2"><section class="gm-panel"><h2>' + X("Valor agregado", "Earned value", "Valor ganado") + '</h2><table class="gm-t stmt"><tbody>' + evm.map(function (r) { return "<tr><td>" + esc(r[0]) + '</td><td class="r">' + esc(r[1]) + "</td></tr>"; }).join("") + "</tbody></table></section>" +
      stmt(X("Custos da rodada", "Costs this round", "Costos de la ronda"), [[X("Equipe (inclui hora extra)", "Team (incl. overtime)", "Equipo (incl. horas extra)"), o.cost.payroll], [X("Contratações e dispensas", "Hiring and releases", "Contrataciones y liberaciones"), o.cost.people], [X("Materiais e licenças", "Materials and licences", "Materiales y licencias"), o.cost.material], [X("Terceirização", "Outsourcing", "Tercerización", "Subcontratação"), o.cost.outsourcing], [decLabel("train"), o.cost.training], [decLabel("mitigation"), o.cost.mitigation], [decLabel("comms"), o.cost.comms], [X("= Total da rodada", "= Round total", "= Total de la ronda"), o.cost.total, 2]]) + "</div>";
    h += '<section class="gm-panel"><h2>' + X("Curva S (PV, EV e AC)", "S-curve (PV, EV and AC)", "Curva S (PV, EV y AC)") + "</h2>" + sCurve(o) + "</section>";
    const ops = [[X("Abordagem", "Approach", "Enfoque"), apName(o.approach)], [X("Capacidade da rodada", "Capacity this round", "Capacidad de la ronda"), num(o.capacity)], [X("Trabalho feito", "Work done", "Trabajo hecho"), num(o.work) + " (" + X("retrabalho ", "rework ", "retrabajo ") + num(o.reworkDone) + (o.outsourced ? " · " + X("terceiros ", "contractors ", "terceros ") + num(o.outsourced) : "") + ")"],
      [X("Defeitos encontrados (viram retrabalho)", "Defects found (become rework)", "Defectos encontrados (retrabajo)"), num(o.defects)], [X("Falta entregar", "Left to deliver", "Falta entregar"), num(o.remaining)],
      [X("Mudanças pedidas · aceitas · recusadas", "Changes requested · accepted · refused", "Cambios pedidos · aceptados · rechazados"), num(o.crUnits) + " · " + num(o.crAccepted) + " · " + num(o.crRejected)], [X("Escopo cortado nesta rodada", "Scope cut this round", "Alcance recortado en esta ronda"), num(o.descope)],
      [X("Equipe", "Team", "Equipo", "Equipa"), num(o.W) + (o.hired ? " · +" + num(o.hired) : "") + (o.fired ? " · −" + num(o.fired) : "") + (o.lost ? " · " + X("saíram ", "left ", "salieron ") + num(o.lost) : "")], [X("Moral da equipe", "Team morale", "Moral del equipo"), num(o.morale, 1)], [X("Exposição a risco", "Risk exposure", "Exposición al riesgo"), money(o.risk)]];
    h += '<section class="gm-panel"><h2>' + X("Andamento", "Progress", "Avance") + '</h2><div class="gm-tw"><table class="gm-t"><tbody>' + ops.map(function (r) { return "<tr><td>" + esc(r[0]) + '</td><td class="r">' + esc(r[1]) + "</td></tr>"; }).join("") + "</tbody></table></div></section>";
    h += '<section class="gm-panel"><h2>' + X("Evolução", "Evolution", "Evolución") + "</h2>" + evolutionPM(t) + "</section>";
    if (pub.ranking) h += '<section class="gm-panel"><h2>' + X("Comparação entre as equipes", "Team comparison", "Comparación entre equipos", "Comparação entre as equipas") + ' <span class="muted">· ' + W("round") + " " + n + "</span></h2>" + bars(pub.ranking, "pct", pct, X("concluído", "complete", "completado")) + "</section>";
    return h;
  }
  function sCurve(o) {
    const hist = (o.state && o.state.hist) || []; if (!hist.length) return "";
    const p = P(), N = Math.max(p.N, hist.length), BAC = o.BAC;
    const Wd = 560, H = 220, L = 74, Rp = 12, T = 12, B = 28, iw = Wd - L - Rp, ih = H - T - B;
    const mx = Math.max(BAC, o.EAC || 0, hist.reduce(function (a, h) { return Math.max(a, h.AC, h.PV, h.EV); }, 1));
    const x = function (r) { return L + r / N * iw; }, y = function (v) { return T + ih - v / mx * ih; };
    let g = "";
    [0, 0.5, 1].forEach(function (f) { const v = mx * f; g += '<line x1="' + L + '" x2="' + (Wd - Rp) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="grid"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" class="ax" text-anchor="end">' + esc(compact(v)) + "</text>"; });
    for (let r = 1; r <= N; r++) g += '<text x="' + x(r) + '" y="' + (H - 8) + '" class="ax" text-anchor="middle">' + W("round").charAt(0) + r + "</text>";
    g += '<line x1="' + x(p.N) + '" x2="' + x(p.N) + '" y1="' + T + '" y2="' + (T + ih) + '" class="zero"/>';
    const plan = []; for (let r = 0; r <= p.N; r++) plan.push([r, BAC * r / p.N]);
    const S = [["PV", "#8a93a6", plan], ["EV", "#1baf7a", [[0, 0]].concat(hist.map(function (h) { return [h.t, h.EV]; }))], ["AC", "#eb6834", [[0, 0]].concat(hist.map(function (h) { return [h.t, h.AC]; }))]];
    S.forEach(function (sr) {
      g += '<path d="' + sr[2].map(function (pt, i) { return (i ? "L" : "M") + x(pt[0]) + " " + y(pt[1]); }).join(" ") + '" fill="none" stroke="' + sr[1] + '" stroke-width="2"' + (sr[0] === "PV" ? ' stroke-dasharray="5 4"' : "") + "/>";
      if (sr[0] !== "PV") sr[2].slice(1).forEach(function (pt) { g += '<circle cx="' + x(pt[0]) + '" cy="' + y(pt[1]) + '" r="4" fill="' + sr[1] + '" stroke="#fff" stroke-width="2" data-tip="' + esc(sr[0] + " · " + W("round") + " " + pt[0] + ": " + money(pt[1])) + '"/>'; });
    });
    return '<div class="gm-chart"><svg viewBox="0 0 ' + Wd + " " + H + '" role="img" aria-label="S-curve">' + g + '</svg><div class="gm-legend"><span><i style="background:#8a93a6"></i>' + X("PV – planejado", "PV – planned", "PV – planificado") + '</span><span><i style="background:#1baf7a"></i>' + X("EV – agregado", "EV – earned", "EV – ganado") + '</span><span><i style="background:#eb6834"></i>' + X("AC – custo real", "AC – actual cost", "AC – costo real") + "</span></div>" + '<div class="gm-tip" hidden></div></div>';
  }
  function evolutionPM(t) {
    const ds = doneRounds().filter(function (n) { return results[n].teams && results[n].teams[t]; });
    return '<div class="gm-tw"><table class="gm-t"><thead><tr><th>' + W("round") + '</th><th class="r">' + X("Concluído", "Complete", "Completado") + '</th><th class="r">PV</th><th class="r">EV</th><th class="r">AC</th><th class="r">CPI</th><th class="r">SPI</th><th class="r">' + X("Qualidade", "Quality", "Calidad") + '</th><th class="r">Stakeholders</th></tr></thead><tbody>' +
      ds.map(function (n) { const o = results[n].teams[t]; return "<tr><td>" + n + '</td><td class="r">' + pct(o.pct) + '</td><td class="r">' + money(o.PV) + '</td><td class="r">' + money(o.EV) + '</td><td class="r">' + money(o.AC) + '</td><td class="r' + (o.CPI < 1 ? " neg" : "") + '">' + f2(o.CPI) + '</td><td class="r' + (o.SPI < 1 ? " neg" : "") + '">' + f2(o.SPI) + '</td><td class="r">' + num(o.quality, 1) + '</td><td class="r">' + num(o.stake, 1) + "</td></tr>"; }).join("") + "</tbody></table></div>";
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
    if (isPM()) return exportCsvPM();
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
  function downloadCsv(rows) {
    const sep = /^(pt|es|pt-pt)$/.test(LANG) ? ";" : ",";
    const csv = "\ufeff" + rows.map(function (r) { return r.map(function (c) { c = c == null ? "" : String(c); if (sep === ";" && /^-?\d+\.\d+$/.test(c)) c = c.replace(".", ","); return /[";,\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(sep); }).join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = slug(info.title || "business-game") + "-resultados.csv"; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function exportCsvPM() {
    const ks = PM.DECISIONS, rows = [[W("round"), W("team")].concat(ks.map(decLabel)).concat([X("Escopo", "Scope", "Alcance"), X("Entregue", "Delivered", "Entregado"), X("Concluído (%)", "Complete (%)", "Completado (%)"), "PV", "EV", "AC", "CPI", "SPI", "BAC", "EAC",
      X("Qualidade", "Quality", "Calidad"), X("Risco", "Risk", "Riesgo"), X("Moral", "Morale", "Moral"), "Stakeholders", X("Término previsto", "Forecast finish", "Término previsto"), X("Concluído na rodada", "Finished in round", "Terminado en ronda"), X("Valor", "Value", "Valor"), W("score"), X("Posição", "Position", "Posición")])];
    doneRounds().forEach(function (n) {
      const rk = (results[n].public || {}).ranking || {};
      teamIds().forEach(function (t) {
        const o = results[n].teams && results[n].teams[t]; if (!o) return; const d = o.decision || {};
        rows.push([n, tName(t)].concat(ks.map(function (k) { return k === "approach" ? apName(d[k]) : d[k]; })).concat([o.scope, o.done, (o.pct * 100).toFixed(1), o.PV, o.EV, o.AC, o.CPI, o.SPI, o.BAC, o.EAC, o.quality, o.risk, o.morale, o.stake, o.forecast, o.finished || "", o.value, rk[t] ? rk[t].score : "", rk[t] ? rankPos(rk, t) : ""]));
      });
    });
    downloadCsv(rows);
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
        '<table class="gm-t"><tbody>' + (isPM() ? [[X("Concluído", "Complete", "Completado"), pct(o.pct)], ["CPI · SPI", num(o.CPI, 2) + " · " + num(o.SPI, 2)], ["AC · BAC", money(o.AC) + " · " + money(o.BAC)], ["EAC", money(o.EAC)], [X("Qualidade", "Quality", "Calidad"), num(o.quality, 1)], ["Stakeholders", num(o.stake, 1)], [X("Término", "Finish", "Término"), o.finished ? X("rodada ", "round ", "ronda ") + o.finished : "≈ " + o.forecast], [X("Valor para o negócio", "Business value", "Valor para el negocio"), money(o.value)]]
          : [[W("revenue"), money(o.revenue)], [W("niShort"), money(o.ni)], [W("cumNI"), money(o.cumNI)], [W("cash"), money(o.bs.cash)], [W("equity"), money(o.bs.equity)], [W("value"), money(o.value)], [W("share"), pct(o.share)], [W("sat"), num(o.sat, 1)]]).map(function (r) { return "<tr><td>" + esc(r[0]) + '</td><td class="r">' + esc(r[1]) + "</td></tr>"; }).join("") + "</tbody></table>" + (isPM() ? evolutionPM(t) : evolution(t)) + "</section>";
    });
    h += "</div>";
    let box = document.getElementById("gmPrint"); if (!box) { box = document.createElement("div"); box.id = "gmPrint"; document.body.appendChild(box); }
    box.innerHTML = h; document.body.classList.add("printing");
    setTimeout(function () { window.print(); }, 50);
    window.addEventListener("afterprint", function f() { document.body.classList.remove("printing"); window.removeEventListener("afterprint", f); });
  }

  /* ================= strategy & debrief ================= */
  function boardsList() { return isPM() ? [["riskmatrix", X("Matriz de riscos", "Risk matrix", "Matriz de riesgos")], ["storymap", X("Mapa de entregas", "Delivery map", "Mapa de entregas")], ["okr", "OKR"]] : [["swot", "SWOT"], ["leancanvas", "Lean Canvas"], ["okr", "OKR"]]; }
  function viewStrategy(v) {
    const ids = role === "student" ? [myTeam] : teamIds();
    const planId = info.plan;
    let h = '<section class="gm-panel"><div class="gm-ph"><h2>' + X("Quadros de estratégia das equipes", "Teams' strategy boards", "Tableros de estrategia de los equipos", "Quadros de estratégia das equipas") + "</h2>" +
      (isProf() && ids.length ? '<button class="gm-btn sm" id="mkBoards">' + IC("plus", 14) + " " + X("Criar quadros que faltam", "Create missing boards", "Crear tableros faltantes") + "</button>" : "") + "</div>" +
      '<p class="muted small">' + (isPM() ? X("Cada equipe planeja o projeto em quadros colaborativos ligados à partida: riscos, entregas e objetivos (OKR).", "Each team plans its project on collaborative boards linked to the game: risks, deliverables and objectives (OKR).", "Cada equipo planifica su proyecto en tableros colaborativos: riesgos, entregas y objetivos (OKR).") : X("Cada equipe trabalha a estratégia em quadros colaborativos (SWOT, Lean Canvas e OKR) ligados à partida.", "Each team works its strategy on collaborative boards (SWOT, Lean Canvas and OKR) linked to the game.", "Cada equipo trabaja su estrategia en tableros colaborativos (SWOT, Lean Canvas y OKR).")) + "</p>" +
      '<div class="gm-teams">' + ids.map(function (t) {
        const bs = (teams[t] && teams[t].boards) || {};
        return '<div class="gm-team" style="--c:' + tColor(t) + '"><b>' + esc(tName(t)) + "</b><div>" + boardsList().map(function (b) { return bs[b[0]] ? '<a class="gm-btn sm" href="../board/?id=' + encodeURIComponent(bs[b[0]]) + '">' + IC("board", 14) + " " + b[1] + "</a>" : '<span class="gm-btn sm off">' + b[1] + "</span>"; }).join("") + "</div></div>";
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
      if (a.mode === "project") return '<div class="gm-team" style="--c:' + tColor(t) + '"><b>' + esc(tName(t)) + "</b><ul><li>" + X("Abordagem: ", "Approach: ", "Enfoque: ") + esc(apName(a.approach)) + "</li><li>" + X("Concluído: ", "Complete: ", "Completado: ") + pct(a.pct) + " · " + (a.finished ? X("terminou na rodada ", "finished in round ", "terminó en la ronda ") + a.finished : X("término previsto: rodada ", "forecast finish: round ", "término previsto: ronda ") + a.forecast) + "</li><li>CPI " + num(a.CPI, 2) + " · SPI " + num(a.SPI, 2) + "</li><li>" + X("Qualidade ", "Quality ", "Calidad ") + num(a.quality, 1) + " · stakeholders " + num(a.stake, 1) + "</li><li>" + X("Mudanças aceitas: ", "Changes accepted: ", "Cambios aceptados: ") + num(a.accepted) + " · " + X("escopo cortado: ", "scope cut: ", "alcance recortado: ") + num(a.descoped) + "</li><li>" + X("Valor para o negócio: ", "Business value: ", "Valor para el negocio: ") + money(a.value) + "</li></ul></div>";
      return '<div class="gm-team" style="--c:' + tColor(t) + '"><b>' + esc(tName(t)) + "</b><ul>" +
        "<li>" + W("cumNI") + ": " + money(a.cumNI) + "</li><li>" + X("Melhor rodada: ", "Best round: ", "Mejor ronda: ") + a.best + " (" + money(a.bestNI) + ")</li><li>" + X("Preço médio: ", "Average price: ", "Precio medio: ") + money(a.avgPrice, 2) + "</li>" +
        "<li>Marketing + " + decLabel("rd") + ": " + money(a.mktRd) + "</li><li>" + W("share") + X(" médio: ", " average: ", " media: ") + pct(a.avgShare) + "</li>" + (a.emergency ? "<li>" + X("Rodadas com empréstimo emergencial: ", "Rounds with an emergency loan: ", "Rondas con préstamo de emergencia: ") + a.emergency + "</li>" : "") + "</ul></div>";
    }).join("") + "</div>";
    if (d.ai && d.ai.summary) h += '<div class="gm-ai"><h3>✨ ' + X("Aprendizados", "Learnings", "Aprendizajes") + "</h3><p>" + esc(d.ai.summary) + "</p>" + (d.ai.lessons && d.ai.lessons.length ? "<ul>" + d.ai.lessons.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul>" : "") + '<p class="muted small">' + X("Gerado por IA – revise antes de usar na avaliação.", "AI-generated – review before using it for assessment.", "Generado por IA – revisa antes de usarlo.") + "</p></div>";
    return h + "</section>";
  }
  function genDebrief() {
    const auto = {};
    if (isPM()) {
      teamIds().forEach(function (t) {
        const ds = doneRounds().filter(function (n) { return results[n].teams && results[n].teams[t]; }); if (!ds.length) return;
        const o = results[ds[ds.length - 1]].teams[t], s = o.state || {};
        auto[t] = { mode: "project", approach: o.approach, pct: o.pct, CPI: o.CPI, SPI: o.SPI, quality: o.quality, stake: o.stake, finished: o.finished || 0, forecast: o.forecast, accepted: s.accepted || 0, descoped: s.descoped || 0, value: o.value, AC: o.AC, BAC: o.BAC };
      });
      return db.ref("game/" + ID + "/debrief").update({ auto: auto, at: TS() }).then(function () { toast(X("Resumo gerado", "Summary generated", "Resumen generado")); }, fail);
    }
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
    const facts = Object.keys(d.auto).map(function (t) { const a = d.auto[t]; return a.mode === "project"
      ? tName(t) + ": approach " + a.approach + ", " + (a.pct * 100).toFixed(0) + "% complete, " + (a.finished ? "finished in round " + a.finished : "forecast finish round " + a.forecast) + " (planned " + P().N + "), CPI " + a.CPI + ", SPI " + a.SPI + ", quality " + a.quality + ", stakeholder satisfaction " + a.stake + ", changes accepted " + a.accepted + ", scope cut " + a.descoped + ", actual cost " + a.AC + " vs budget " + a.BAC + ", business value " + a.value
      : tName(t) + ": cumulative profit " + a.cumNI + ", best round " + a.best + ", average price " + a.avgPrice + ", marketing+R&D " + a.mktRd + ", average share " + (a.avgShare * 100).toFixed(1) + "%, emergency loans " + a.emergency; }).join("\n");
    const kind = isPM() ? "a project management simulation game (case: " + scenName(cfg.scenario) + ", all teams ran the same project)" : "a business simulation game (scenario: " + scenName(cfg.scenario) + ")";
    const prompt = "You are a business school professor running the debrief of " + kind + ", " + doneRounds().length + " rounds. Teams' facts:\n" + facts +
      "\nWrite in " + lname + ". Return JSON {\"summary\": \"one paragraph comparing the strategies and what explains the ranking\", \"lessons\": [\"4 to 6 short " + (isPM() ? "project management" : "management") + " lessons for the class\"]}.";
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
      boardsList().forEach(function (b) {
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
    const on = {}; evs.forEach(function (e) { on[e.id || e.type] = e; });
    return '<div class="gm-evs">' + evCatalog().map(function (i) {
      const k = i.id, e = on[k], val = e && e.k != null ? e.k : i.k;
      const shown = i.unit === "%" ? +(val * 100).toFixed(2) : val;
      return '<label class="gm-ev' + (e ? " on" : "") + '"><input type="checkbox" data-ev="' + k + '"' + (e ? " checked" : "") + "><span><b>" + esc(i.n) + "</b><small>" + esc(i.d) + '</small></span><span class="gm-evk">' + (i.unit === "×" ? "×" : "") + '<input type="number" step="' + (i.unit === "n" ? "1" : "0.01") + '" data-evk="' + k + '" value="' + shown + '" title="' + esc(i.what || "") + '">' + (i.unit === "%" ? "%" : i.unit === "n" ? " " + esc(i.what) : "") + "</span></label>";
    }).join("") + '<button type="button" class="gm-btn sm" data-surprise>🎲 ' + X("Evento surpresa", "Surprise event", "Evento sorpresa") + "</button></div>";
  }
  function readEvents(root) {
    const out = [];
    root.querySelectorAll("[data-ev]").forEach(function (c) {
      if (!c.checked) return; const k = c.dataset.ev, inp = root.querySelector('[data-evk="' + k + '"]'), i = evCatalog().find(function (x) { return x.id === k; }); if (!i) return;
      let val = Number(inp && inp.value); if (!isFinite(val) || val <= 0) val = i.k; else if (i.unit === "%") val = val / 100;
      out.push(i.id === i.type ? { type: i.type, k: val } : { id: i.id, type: i.type, k: val });
    });
    return out;
  }
  function bindEvents(root, onChange, n) {
    root.querySelectorAll("[data-ev], [data-evk]").forEach(function (c) { c.onchange = function () { const l = c.closest(".gm-ev"); if (l) l.classList.toggle("on", !!l.querySelector("[data-ev]").checked); onChange(readEvents(root)); }; });
    const s = root.querySelector("[data-surprise]");
    if (s) s.onclick = function () {
      const ids = evCatalog().map(function (x) { return x.id; }), k = isPM() ? PM.surprise(ID + ":" + n, ids) : E.surprise(ID + ":" + n), c = root.querySelector('[data-ev="' + k + '"]');
      if (c && !c.checked) { c.checked = true; c.onchange(); } toast("🎲 " + evInfo({ id: k, type: k }).n);
    };
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
      if (!d) { d = Object.assign({}, prevDecision(n, t) || ENG().defaultDecision(p, stateBefore(n, t), teamIds().length)); delete d.strategic; delete d.by; delete d.at; auto[t] = true; if (isPM()) { d.descope = 0; d.hire = 0; } }
      out[t] = d;
    });
    return { d: out, auto: auto };
  }
  function computeRound(n, prevTeams) {
    const p = P(), st = {};
    const G = ENG();
    teamIds().forEach(function (t) { st[t] = prevTeams && prevTeams[t] ? fixState(prevTeams[t].state) : G.initState(p); });
    const fd = fullDecisions(n), dec = {};
    Object.keys(fd.d).forEach(function (t) { const x = {}; G.DECISIONS.forEach(function (k) { x[k] = k === "approach" ? fd.d[t][k] : decOn(k) ? (Number(fd.d[t][k]) || 0) : 0; }); dec[t] = x; });
    const r = G.runRound(p, st, dec, n, (rounds[n] || {}).events || []);
    const sc = G.score(r.teams, cfg.weights || G.WEIGHTS), ranking = {};
    Object.keys(r.teams).forEach(function (t) {
      const o = r.teams[t];
      ranking[t] = isPM() ? { score: sc[t], pct: o.pct, CPI: o.CPI, SPI: o.SPI, quality: o.quality, stake: o.stake, value: o.value, finished: o.finished, forecast: o.forecast, late: o.late, AC: o.AC, EAC: o.EAC }
        : { score: sc[t], cumNI: o.cumNI, value: o.value, sat: o.sat, share: o.share, avgShare: o.avgShare, sales: o.sales, price: o.price, ni: o.ni };
    });
    return { r: r, ranking: ranking, fd: fd };
  }
  function resultWrites(n, c, u) {
    u["game/" + ID + "/results/" + n] = { public: { market: c.r.market, ranking: c.ranking, at: TS(), version: ENG().VERSION }, teams: c.r.teams };
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
      '<div class="gm-fg"><label class="gm-f"><span>' + X("Modo do jogo", "Game mode", "Modo de juego") + '</span><select name="mode"' + (started ? " disabled" : "") + '>' + modeOptions(cfg.mode || "business") + "</select></label>" +
      '<label class="gm-f"><span>' + (isPM() ? X("Caso (projeto)", "Case (project)", "Caso (proyecto)") : X("Cenário de partida", "Starting scenario", "Escenario")) + '</span><select name="scenario">' + scenOptions(cfg.mode || "business", cfg.scenario) +
      Object.keys(wsTemplates).filter(function (k) { return (wsTemplates[k].mode || "business") === (cfg.mode || "business"); }).map(function (k) { return '<option value="tpl:' + k + '">' + X("Modelo da instituição: ", "Institution model: ", "Modelo de la institución: ") + esc(wsTemplates[k].name) + "</option>"; }).join("") + '</select></label><button type="button" class="gm-btn sm" id="applyScen">' + X("Aplicar cenário", "Apply scenario", "Aplicar escenario") + "</button>" +
      '<label class="gm-f"><span>' + X("Converter valores monetários ×", "Convert money values ×", "Convertir valores ×") + '</span><input type="number" step="0.0001" min="0.0001" name="factor" placeholder="' + esc(X("ex.: 0,18 de real para euro", "e.g. 0.18", "ej.: 0,18")) + '"></label><button type="button" class="gm-btn sm" id="applyConv">' + X("Converter", "Convert", "Convertir") + "</button></div>" +
      paramsTable(p) +
      "<h3>" + X("Decisões disponíveis para as equipes", "Decisions available to the teams", "Decisiones disponibles") + '</h3><div class="gm-chks">' + ENG().DECISIONS.map(function (k) { const fixed = decFixed(k); return '<label class="gm-chk"><input type="checkbox" name="dec_' + k + '"' + (decOn(k) ? " checked" : "") + (fixed ? " disabled" : "") + "> " + esc(decLabel(k)) + "</label>"; }).join("") + "</div>" +
      "<h3>" + X("Pesos da pontuação (%)", "Score weights (%)", "Pesos de la puntuación (%)") + '</h3><div class="gm-fg">' + weightKeys().map(function (k) { const w = cfg.weights || ENG().WEIGHTS; return '<label class="gm-f"><span>' + esc(weightLabel(k)) + '</span><input type="number" min="0" max="100" name="w_' + k + '" value="' + (w[k] != null ? w[k] : 0) + '"></label>'; }).join("") + "</div>" +
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
  function modeOptions(sel) { return [["project", X("Gerenciamento de projetos", "Project management", "Gestión de proyectos")], ["business", X("Gestão empresarial (empresa e mercado)", "Business management (company and market)", "Gestión empresarial (empresa y mercado)")]].map(function (m) { return '<option value="' + m[0] + '"' + (sel === m[0] ? " selected" : "") + ">" + esc(m[1]) + "</option>"; }).join(""); }
  function scenOptions(mode, sel) { const S = mode === "project" ? PM.SCENARIOS : E.SCENARIOS; return Object.keys(S).map(function (k) { return '<option value="' + k + '"' + (sel === k ? " selected" : "") + ">" + esc(mode === "project" ? pmScenName(k) : scenName(k)) + "</option>"; }).join(""); }
  function weightKeys() { return isPM() ? ["time", "cost", "scope", "quality", "stake"] : ["profit", "value", "sat", "share"]; }
  function weightLabel(k) { return { profit: W("cumNI"), value: W("value"), sat: W("sat"), share: W("share"), time: X("Prazo (SPI)", "Schedule (SPI)", "Plazo (SPI)"), cost: X("Custo (CPI)", "Cost (CPI)", "Costo (CPI)"), scope: X("Escopo entregue", "Scope delivered", "Alcance entregado", "Âmbito entregue"), quality: X("Qualidade", "Quality", "Calidad"), stake: "Stakeholders" }[k] || k; }
  function regionName(k) { try { return new Intl.DisplayNames([LOCALE[LANG]], { type: "region" }).of(k); } catch (e) { return k; } }
  const PM_PARAM_GROUPS = [
    [X("Projeto", "Project", "Proyecto"), [["S0", X("Escopo inicial", "Initial scope", "Alcance inicial", "Âmbito inicial")], ["N", X("Prazo planejado (rodadas)", "Planned duration (rounds)", "Plazo planificado (rondas)")], ["BAC", X("Orçamento aprovado (BAC)", "Approved budget (BAC)", "Presupuesto aprobado (BAC)"), "$"], ["benefit", X("Valor para o negócio se entregue no prazo", "Business value if delivered on time", "Valor para el negocio si se entrega a tiempo"), "$"], ["lateLoss", X("Perda de valor por rodada de atraso", "Value lost per round late", "Pérdida de valor por ronda de atraso"), "%"], ["crCost", X("Custo das mudanças aprovadas (× custo unitário)", "Cost of approved changes (× unit cost)", "Costo de los cambios aprobados (×)")]]],
    [X("Equipe e custos", "Team and costs", "Equipo y costos", "Equipa e custos"), [["init.W", X("Pessoas na equipe", "People on the team", "Personas en el equipo")], ["sal", X("Custo por pessoa por rodada", "Cost per person per round", "Costo por persona por ronda"), "$"], ["prod", X("Entregas por pessoa por rodada", "Deliverables per person per round", "Entregas por persona por ronda")], ["hire", X("Custo por contratação", "Cost per hire", "Costo por contratación"), "$"], ["fire", X("Custo por dispensa", "Cost per release", "Costo por liberación"), "$"], ["trRef", X("Treinamento de referência por pessoa", "Reference training per person", "Capacitación de referencia por persona"), "$"], ["cmat", X("Materiais e licenças por entrega", "Materials and licences per deliverable", "Materiales y licencias por entrega"), "$"], ["cOut", X("Terceirização por entrega", "Outsourcing per deliverable", "Tercerización por entrega"), "$"], ["outMax", X("Terceirização máxima por rodada", "Max outsourcing per round", "Tercerización máxima por ronda")]]],
    [X("Qualidade, riscos e stakeholders", "Quality, risks and stakeholders", "Calidad, riesgos y stakeholders"), [["d0", X("Defeitos por entrega sem testes", "Defects per deliverable without testing", "Defectos por entrega sin pruebas"), "%"], ["escape", X("Defeitos que escapam para o cliente", "Defects that reach the client", "Defectos que llegan al cliente"), "%"], ["E0", X("Exposição a risco inicial", "Initial risk exposure", "Exposición al riesgo inicial"), "$"], ["eGrow", X("Aumento da exposição por rodada", "Exposure growth per round", "Aumento de la exposición por ronda"), "$"], ["mitEff", X("Redução de exposição por 1 investido", "Exposure removed per 1 spent", "Exposición reducida por 1 invertido")], ["commRef", X("Comunicação de referência por rodada", "Reference communication per round", "Comunicación de referencia por ronda"), "$"], ["init.M", X("Moral inicial (0–100)", "Initial morale (0–100)", "Moral inicial (0–100)")], ["init.St", X("Satisfação inicial dos stakeholders (0–100)", "Initial stakeholder satisfaction (0–100)", "Satisfacción inicial (0–100)")]]]
  ];
  const BIZ_PARAM_GROUPS = [
    [X("Mercado", "Market", "Mercado"), [["D0", X("Demanda base por rodada", "Base demand per round", "Demanda base por ronda")], ["g", X("Crescimento por rodada", "Growth per round", "Crecimiento por ronda"), "%"], ["Pref", X("Preço de referência", "Reference price", "Precio de referencia"), "$"], ["em", X("Elasticidade do mercado ao preço médio", "Market elasticity to average price", "Elasticidad del mercado")], ["e", X("Elasticidade da fatia ao preço", "Share elasticity to price", "Elasticidad de la cuota al precio")], ["a", X("Efeito do marketing", "Marketing effect", "Efecto del marketing")], ["gq", X("Efeito da qualidade (P&D)", "Quality (R&D) effect", "Efecto de la calidad")], ["ls", X("Efeito da satisfação", "Satisfaction effect", "Efecto de la satisfacción")], ["spill", X("Transbordo da demanda não atendida", "Spill-over of unmet demand", "Traspaso de demanda no atendida"), "%"]]],
    [X("Custos e operação", "Costs and operations", "Costos y operación"), [["cv", X("Custo unitário (insumos)", "Unit cost (inputs)", "Costo unitario"), "$"], ["sal", X("Salário por funcionário por rodada", "Salary per employee per round", "Salario por empleado por ronda"), "$"], ["prod", X("Produtividade (unidades por funcionário)", "Productivity (units per employee)", "Productividad")], ["tau", X("Ganho máximo do treinamento", "Max training gain", "Ganancia máx. de capacitación"), "%"], ["trRef", X("Treinamento de referência por funcionário", "Reference training per employee", "Capacitación de referencia"), "$"], ["hire", X("Custo por contratação", "Cost per hire", "Costo por contratación"), "$"], ["fire", X("Custo por demissão", "Cost per layoff", "Costo por despido"), "$"], ["capCost", X("Investimento por unidade de capacidade", "Investment per unit of capacity", "Inversión por unidad de capacidad"), "$"], ["dep", X("Depreciação por rodada", "Depreciation per round", "Depreciación por ronda"), "%"], ["stor", X("Estocagem por unidade", "Storage per unit", "Almacenaje por unidad"), "$"], ["adm", X("Despesa administrativa fixa", "Fixed overheads", "Gastos fijos"), "$"], ["dB", X("Desgaste da marca por rodada", "Brand decay per round", "Desgaste de la marca"), "%"], ["dQ", X("Desgaste da qualidade por rodada", "Quality decay per round", "Desgaste de la calidad"), "%"]]],
    [X("Finanças", "Finance", "Finanzas"), [["r", X("Juros por rodada", "Interest per round", "Interés por ronda"), "%"], ["rE", X("Juros do empréstimo emergencial", "Emergency loan interest", "Interés de emergencia"), "%"], ["tax", X("Imposto sobre o lucro", "Income tax rate", "Impuesto a la renta"), "%"], ["debtMax", X("Teto de dívida (% do ativo)", "Debt ceiling (% of assets)", "Tope de deuda (% del activo)"), "%"], ["mult", X("Múltiplo do lucro anual no valor da empresa", "Annual profit multiple in company value", "Múltiplo de utilidad anual")]]],
    [X("Estado inicial de cada empresa", "Initial state of each company", "Estado inicial de cada empresa"), [["init.cash", W("cash"), "$"], ["init.stockU", W("stock") + " (" + X("unidades", "units", "unidades") + ")"], ["init.imob", W("fixed"), "$"], ["init.debt", W("debt"), "$"], ["init.W", W("staff")], ["init.B", X("Marca acumulada", "Accumulated brand", "Marca acumulada"), "$"], ["init.Q", X("Qualidade acumulada", "Accumulated quality", "Calidad acumulada"), "$"], ["init.S", W("sat")]]]
  ];
  function pget(p, k) { return k.indexOf("init.") === 0 ? p.init[k.slice(5)] : p[k]; }
  function paramsTable(p) {
    return (isPM() ? PM_PARAM_GROUPS : BIZ_PARAM_GROUPS).map(function (g) {
      return "<h3>" + esc(g[0]) + '</h3><div class="gm-fg">' + g[1].map(function (f) {
        const v = pget(p, f[0]), isPct = f[2] === "%";
        return '<label class="gm-f"><span>' + esc(f[1]) + (f[2] === "$" ? ' <em class="muted">(' + esc(curr().custom ? curr().symbol || "" : curr().code) + ")</em>" : isPct ? " <em class=\"muted\">(%)</em>" : "") + '</span><input type="number" step="any" name="p_' + f[0] + '" value="' + (isPct ? +(v * 100).toFixed(4) : v) + '"></label>';
      }).join("") + "</div>";
    }).join("");
  }
  function readParams(f) {
    const p = JSON.parse(JSON.stringify(P()));
    (isPM() ? PM_PARAM_GROUPS : BIZ_PARAM_GROUPS).forEach(function (g) { g[1].forEach(function (x) {
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
    s.mode.onchange = function () { s.scenario.innerHTML = scenOptions(s.mode.value, "") + Object.keys(wsTemplates).filter(function (k) { return (wsTemplates[k].mode || "business") === s.mode.value; }).map(function (k) { return '<option value="tpl:' + k + '">' + esc(wsTemplates[k].name) + "</option>"; }).join(""); };
    v.querySelector("#applyScen").onclick = function () {
      const val = s.scenario.value, mode = s.mode.value, G = mode === "project" ? PM : E, same = mode === (cfg.mode || "business"); let upd;
      if (val.indexOf("tpl:") === 0) { const t = wsTemplates[val.slice(4)] || {}, tm = t.mode || "business", TG = tm === "project" ? PM : E, sc = t.scenario || (tm === "project" ? "lancamento" : "industria"); upd = { mode: tm, scenario: sc, params: t.params || TG.params(sc), decisions: t.decisions || null, weights: t.weights || TG.WEIGHTS, currency: t.currency || cfg.currency || null, country: t.country || null, lang: t.lang || cfg.lang || null, brand: t.brand || cfg.brand || null, rounds: t.rounds || cfg.rounds || 8 }; }
      else { upd = { mode: mode, scenario: val, params: G.params(val), decisions: same ? (cfg.decisions || null) : null, weights: same ? (cfg.weights || G.WEIGHTS) : G.WEIGHTS }; if (mode === "project") upd.rounds = Math.max(totalRounds(), G.params(val).N + 2); }
      if (!window.confirm(X("Substituir os parâmetros atuais pelos do cenário escolhido?", "Replace the current parameters with the chosen scenario's?", "¿Reemplazar los parámetros actuales?"))) return;
      db.ref("game/" + ID + "/config").update(upd).then(function () { toast(X("Cenário aplicado", "Scenario applied", "Escenario aplicado")); }, fail);
    };
    v.querySelector("#applyConv").onclick = function () {
      const f = Number(String(s.factor.value).replace(",", ".")); if (!(f > 0)) return toast(X("Informe um fator maior que zero.", "Enter a factor above zero.", "Indica un factor mayor que cero."));
      db.ref("game/" + ID + "/config/params").set(ENG().convert(P(), f)).then(function () { toast(X("Valores convertidos ×", "Values converted ×", "Valores convertidos ×") + f); }, fail);
    };
    s.onsubmit = function (e) {
      e.preventDefault();
      const dec = {}; ENG().DECISIONS.forEach(function (k) { if (!decFixed(k) && s["dec_" + k] && !s["dec_" + k].checked) dec[k] = false; });
      const w = {}; weightKeys().forEach(function (k) { w[k] = Math.max(0, +s["w_" + k].value || 0); });
      if (!Object.keys(w).reduce(function (a, k) { return a + w[k]; }, 0)) return toast(X("Defina ao menos um peso.", "Set at least one weight.", "Define al menos un peso."));
      document.activeElement && document.activeElement.blur();
      db.ref("game/" + ID + "/config").update({ params: readParams(s), decisions: Object.keys(dec).length ? dec : null, weights: w }).then(function () { toast(X("Regras salvas ✓", "Rules saved ✓", "Reglas guardadas ✓")); }, fail);
    };
    v.querySelector("#saveTpl").onclick = function () {
      const name = window.prompt(X("Nome do modelo (ex.: Business Game – Administração 5º semestre)", "Model name", "Nombre del modelo"), info.title || ""); if (!name) return;
      const id = slug(name) + "-" + rnd();
      db.ref("workspaces/" + info.ws + "/gameTemplates/" + id).set({ name: name.trim(), mode: cfg.mode || "business", scenario: cfg.scenario || defScen(), params: readParams(s), decisions: cfg.decisions || null, weights: cfg.weights || null, currency: cfg.currency || null, country: cfg.country || null, lang: cfg.lang || null, brand: cfg.brand || null, rounds: totalRounds(), created: TS(), by: me.email })
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
      // the workspace may restrict its modules (workspaces/<ws>/info/modules); without "game" there is no Business Game there
      const mods = wsInfo.modules, list = Array.isArray(mods) ? mods : (mods && typeof mods === "object" ? Object.keys(mods).map(function (k) { return mods[k] === true ? k : mods[k]; }) : null);
      if (list && list.indexOf("game") < 0) return gate(X("Business Game não disponível neste workspace", "Business Game is not available in this workspace", "Business Game no disponible en este workspace"), X("Este workspace não inclui o módulo Business Game. Escolha outro workspace ou peça ao administrador para incluir o módulo.", "This workspace does not include the Business Game module. Pick another workspace or ask the administrator to add it.", "Este workspace no incluye el módulo Business Game."));
      const c0 = LANG === "en" ? "USD" : LANG === "pt-pt" || LANG === "es" ? "EUR" : "BRL";
      app.innerHTML = '<header class="gm-top"><a class="gm-back" href="../workspaces/">' + IC("back", 18) + '</a><span class="gm-logo">CM</span><div class="gm-title"><h1>' + X("Nova partida", "New game", "Nueva partida") + '</h1><span class="gm-sub">Business Game · ' + esc(wsInfo.name || wsId) + "</span></div></header>" +
        '<main class="gm-view"><form class="gm-panel gm-form gm-new" id="newF"><h2>' + X("Criar partida", "Create game", "Crear partida") + "</h2>" +
        '<label class="gm-f"><span>' + X("Nome da partida (turma)", "Game name (class)", "Nombre de la partida (curso)") + '</span><input name="title" required maxlength="80" placeholder="' + esc(X("Ex.: Administração 5º semestre – 2026/2", "E.g. Business 101 – Fall 2026", "Ej.: Administración 5º semestre")) + '"></label>' +
        '<div class="gm-fg"><label class="gm-f"><span>' + X("Modo do jogo", "Game mode", "Modo de juego") + '</span><select name="mode">' + modeOptions("project") + "</select></label>" +
        '<label class="gm-f"><span>' + X("Caso, cenário ou modelo da instituição", "Case, scenario or institution model", "Caso, escenario o modelo de la institución") + '</span><select name="scen"></select></label></div>' +
        '<p class="muted small" id="scenDesc"></p>' +
        '<div class="gm-fg"><label class="gm-f"><span>' + X("Moeda", "Currency", "Moneda") + '</span><select name="cur">' + allCurrencies().map(function (k) { return '<option value="' + k + '"' + (k === c0 ? " selected" : "") + ">" + k + " – " + esc(curName(k)) + "</option>"; }).join("") + "</select></label>" +
        '<label class="gm-f"><span>' + X("Idioma", "Language", "Idioma") + '</span><select name="lang">' + Object.keys(LANGS).map(function (k) { return '<option value="' + k + '"' + (k === LANG ? " selected" : "") + ">" + LANGS[k] + "</option>"; }).join("") + "</select></label>" +
        '<label class="gm-f"><span>' + X("Rodadas", "Rounds", "Rondas") + '</span><input type="number" name="rounds" min="1" max="16" value="8"></label>' +
        '<label class="gm-f"><span>' + X("Equipes", "Teams", "Equipos", "Equipas") + '</span><input type="number" name="teams" min="2" max="6" value="4"></label></div>' +
        '<p class="muted small">' + X("Você pode ajustar tudo depois em Configuração (moeda fictícia, parâmetros, marca, pesos).", "You can adjust everything later in Settings (fictional currency, parameters, brand, weights).", "Puedes ajustar todo después en Configuración.") + "</p>" +
        '<div class="gm-actions"><a class="gm-btn" href="../workspaces/">' + X("Cancelar", "Cancel", "Cancelar") + '</a><button class="gm-btn primary">' + X("Criar partida", "Create game", "Crear partida") + "</button></div></form></main>";
      const f = document.getElementById("newF");
      function fillScen() {
        const m = f.mode.value;
        f.scen.innerHTML = scenOptions(m, m === "project" ? "lancamento" : "industria") + Object.keys(wsTemplates).filter(function (k) { return (wsTemplates[k].mode || "business") === m; }).map(function (k) { return '<option value="tpl:' + k + '">' + X("Modelo: ", "Model: ", "Modelo: ") + esc(wsTemplates[k].name) + "</option>"; }).join("");
        descScen();
      }
      function descScen() {
        const m = f.mode.value, sv = f.scen.value, d = document.getElementById("scenDesc");
        if (m === "project" && PM.SCENARIOS[sv]) { const p = PM.params(sv); d.textContent = pmScenDesc(sv) + " " + X("Plano: ", "Plan: ", "Plan: ") + p.N + X(" rodadas.", " rounds.", " rondas."); f.rounds.value = p.N + 2; }
        else d.textContent = m === "business" ? X("Cada equipe dirige uma empresa que disputa o mesmo mercado (DRE, balanço e fluxo de caixa).", "Each team runs a company competing in the same market (income statement, balance sheet, cash flow).", "Cada equipo dirige una empresa que compite en el mismo mercado.") : "";
      }
      f.mode.onchange = fillScen; f.scen.onchange = descScen; fillScen();
      // case chosen on My boards (?scenario=): project cases open in project mode, company scenarios in business mode
      const qsc = QS.get("scenario");
      if (qsc && (PM.SCENARIOS[qsc] || E.SCENARIOS[qsc])) { f.mode.value = PM.SCENARIOS[qsc] ? "project" : "business"; fillScen(); f.scen.value = qsc; descScen(); }
      f.onsubmit = function (e) {
        e.preventDefault();
        const title = f.title.value.trim(); if (!title) return;
        const id = slug(title) + "-" + rnd(), sv = f.scen.value, u = {};
        let conf;
        const mode = f.mode.value, G = mode === "project" ? PM : E;
        if (sv.indexOf("tpl:") === 0) { const t = wsTemplates[sv.slice(4)] || {}, tm = t.mode || "business", TG = tm === "project" ? PM : E, sc = t.scenario || (tm === "project" ? "lancamento" : "industria"); conf = { mode: tm, scenario: sc, params: t.params || TG.params(sc), decisions: t.decisions || null, weights: t.weights || TG.WEIGHTS, currency: t.currency || { code: f.cur.value }, country: t.country || null, lang: t.lang || f.lang.value, brand: t.brand || null, rounds: +f.rounds.value || t.rounds || 8 }; }
        else conf = { mode: mode, scenario: sv, params: G.params(sv), weights: G.WEIGHTS, currency: { code: f.cur.value }, lang: f.lang.value, rounds: +f.rounds.value || 8, brand: wsInfo.name ? { name: wsInfo.name } : null };
        conf.deadlineH = 48;
        u["game/" + id + "/info"] = { title: title, ws: wsId, status: "setup", created: TS(), createdBy: me.email };
        u["game/" + id + "/config"] = conf;
        const nt = Math.max(2, Math.min(6, +f.teams.value || 4)), names = ["Alfa", "Beta", "Gama", "Delta", "Épsilon", "Zeta"];
        for (let i = 0; i < nt; i++) u["game/" + id + "/teams/" + slug(names[i])] = { name: names[i], order: i + 1, color: COLORS[i] };
        u["game/" + id + "/people/" + ME] = { email: me.email, name: me.displayName || me.email.split("@")[0], role: "prof", added: TS() };
        u["workspaces/" + wsId + "/games/" + id] = { title: title, scenario: conf.scenario, mode: conf.mode, created: TS() };
        u["userGames/" + ME + "/" + id] = { title: title, role: "prof" };
        f.querySelector(".gm-btn.primary").disabled = true;
        db.ref().update(u).then(function () { if (window.CMMarkSeen) window.CMMarkSeen("game"); location.href = "./?id=" + encodeURIComponent(id); }, function (er) { f.querySelector(".gm-btn.primary").disabled = false; fail(er); });
      };
    });
  }

  window.CMGame = { _X: X, _money: function (v, d) { return money(v, d); } };
  start();
})();
