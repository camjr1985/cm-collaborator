/* CM Collaborator – Planning · Portfolio (one page, BI-style, drill-down)
 * Macro → island (ilha) → project → ITSM tickets. Cross-filters by clicking tiles, bars and rows.
 * Data: planning items with `pf` (imported from a GLPI export: id, unit, prio, gtype, group, level, approach, imp, urg, island)
 *       plus `pfSvc` (operation | maintenance | service – links the project to the ITSM centre) and `pfNote` (encaminhamento).
 * Settings: data.settings.portfolio = { on, org, source, ref, map{group: island}, order[], at, by, file }.
 * The planning page calls CMPortfolio.render(view, api); api comes from planning.js. */
(function () {
  "use strict";
  const PT = window.MB_LANG === "pt";
  const L = function (en, pt) { return window.MBL ? window.MBL(en, pt) : (PT ? pt : en); };
  const IC = function (n, sz) { return window.CMIcon ? window.CMIcon(n, sz || 15) : ""; };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* palette validated with the dataviz checker (light surface): situation = categorical, level = one-hue sequential */
  const SIT = {
    doing: { c: "#2563eb", ink: "#fff", n: function () { return L("In progress", "Processando"); } },
    blocked: { c: "#d1344a", ink: "#fff", n: function () { return L("Blocked", "Bloqueado"); } },
    backlog: { c: "#e8a020", ink: "#3b2a00", n: function () { return "Backlog"; } },
    done: { c: "#1b7f4b", ink: "#fff", n: function () { return L("Done", "Concluído"); } }
  };
  const SIT_ORDER = ["doing", "blocked", "backlog", "done"];
  const LEVEL = {
    "Estratégico": { c: "#1e3a6e", ink: "#fff", n: function () { return L("Strategic", "Estratégico"); } },
    "Tático": { c: "#4f7fc0", ink: "#fff", n: function () { return L("Tactical", "Tático"); } },
    "Operacional": { c: "#a9bfdf", ink: "#172036", n: function () { return L("Operational", "Operacional"); } }
  };
  const LEVEL_ORDER = ["Estratégico", "Tático", "Operacional"];
  const SVC = {
    operation: { ic: "settings", n: function () { return L("Operation", "Operação"); } },
    maintenance: { ic: "sync", n: function () { return L("Maintenance", "Manutenção"); } },
    service: { ic: "itsm", n: function () { return L("Service", "Serviço"); } }
  };
  const ATT = {
    late: { cls: "bad", n: function () { return L("Overdue", "Prazo vencido"); } },
    nodate: { cls: "warn", n: function () { return L("No due date", "Sem prazo"); } },
    blocked: { cls: "bad", n: function () { return L("Blocked", "Bloqueado"); } }
  };
  /* the GLPI groups of the first customer; any other group is mapped in the import */
  const DEFAULT_MAP = { "1 - INFRAESTRUTURA": "Infraestrutura", "2 - PROTHEUS ERP": "Sistemas", "3 - PROTHEUS RH": "Sistemas", "5 - DESENVOLVIMENTO": "Desenvolvimento", "8 - DATA ANALITICS": "Indicadores", "22 - ASSISTENCIAL": "Assistencial", "4 - PROJETOS": "Projetos / PMO", "9 - SEGURANÇA": "Infraestrutura" };
  const DEFAULT_ORDER = ["Sistemas", "Desenvolvimento", "Indicadores", "Infraestrutura", "Assistencial", "Projetos / PMO"];
  const UNMAPPED = "Não mapeado";

  let A = null; /* api from planning.js */
  const st = { island: null, item: null, f: {}, withBacklog: false };

  function S() { return (A.data().settings || {}).portfolio || {}; }
  function today() { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10); }
  function fmtD(s) { return s ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(2, 4) : "—"; }
  function fmtLong(s) { return s ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : "—"; }

  /* ---------- model ---------- */
  function sitOf(it) {
    const s = A.statusOf(it) || {};
    if (s.cat === "done") return "done";
    if (s.id === "blocked" || /bloque|block|imped/i.test(s.name || "")) return "blocked";
    if (s.cat === "todo") return "backlog";
    return "doing";
  }
  function islandOf(it) {
    if (it.pf && it.pf.island) return it.pf.island;
    const p = it.parent && A.data().items[it.parent];
    return (p && (p.pfIsland || p.title)) || UNMAPPED;
  }
  function attOf(it, sit) {
    if ((sit === "doing" || sit === "blocked") && it.end && it.end < today()) return "late";
    if (sit === "blocked") return "blocked";
    if (sit === "doing" && !it.end) return "nodate";
    return "";
  }
  function projects() {
    const D = A.data().items || {};
    return A.items().filter(function (i) {
      if (i.type === "epic" || i.type === "initiative" || i.type === "phase" || i.type === "milestone") return false;
      if (i.pf) return true;
      const p = i.parent && D[i.parent]; return !!(p && p.pfIsland);
    }).map(function (i) {
      const sit = sitOf(i);
      return { it: i, id: i.id, title: i.title, island: islandOf(i), sit: sit, level: (i.pf && i.pf.level) || "Operacional", unit: (i.pf && i.pf.unit) || "—", prio: (i.pf && i.pf.prio) || "—", svc: i.pfSvc || "", att: attOf(i, sit), progress: Number(i.progress) || 0, end: i.end || "", start: i.start || "", gid: i.pf && i.pf.id };
    });
  }
  function islands(list) {
    const ord = (S().order || DEFAULT_ORDER).slice();
    list.forEach(function (p) { if (ord.indexOf(p.island) < 0) ord.push(p.island); });
    return ord.filter(function (n) { return list.some(function (p) { return p.island === n; }); });
  }
  function pass(p, skip) {
    const f = st.f;
    if (st.island && p.island !== st.island) return false;
    return Object.keys(f).every(function (k) {
      if (k === skip || f[k] == null || f[k] === "") return true;
      if (k === "q") return (p.title + " " + p.unit + " " + (p.gid || "")).toLowerCase().indexOf(String(f.q).toLowerCase()) >= 0;
      if (k === "svc") return f.svc === "_none" ? !p.svc : p.svc === f.svc;
      if (k === "att") return f.att === "_any" ? !!p.att : p.att === f.att;
      return p[k] === f[k];
    });
  }
  function count(list, key, val) { return list.filter(function (p) { return p[key] === val; }).length; }

  /* ---------- small renderers ---------- */
  function tile(label, val, color, filt, on) {
    return '<button class="pf-tile' + (on ? " on" : "") + '"' + (filt ? ' data-f="' + esc(filt) + '"' : "") + ' title="' + esc(filt ? L("Filter by ", "Filtrar por ") + label : label) + '"><span class="pf-tl" style="color:' + (color || "var(--ink)") + '">' + esc(label) + '</span><b style="color:' + (color || "var(--ink)") + '">' + val + "</b></button>";
  }
  function seg(parts, total, extraAttr) { /* 100% stacked bar with direct labels; parts: [{k, n, c, ink, label, f}] */
    if (!total) return '<div class="pf-bar empty"><span>' + L("No projects", "Nenhum projeto") + "</span></div>";
    return '<div class="pf-bar"' + (extraAttr || "") + ">" + parts.filter(function (x) { return x.n; }).map(function (x) {
      const w = x.n / total * 100;
      return '<span class="pf-seg" style="width:' + w + "%;background:" + x.c + ";color:" + x.ink + '"' + (x.f ? ' data-f="' + esc(x.f) + '"' : "") + ' data-tip="' + esc(x.label + ": " + x.n + " (" + Math.round(w) + "%)") + '">' + (w >= 6 ? x.n : "") + "</span>";
    }).join("") + "</div>";
  }
  function legend(order, MAP) { return '<div class="pf-leg">' + order.map(function (k) { return '<span><i style="background:' + MAP[k].c + '"></i>' + esc(MAP[k].n()) + "</span>"; }).join("") + "</div>"; }
  function sitParts(list, extraF) { return SIT_ORDER.map(function (k) { return { n: count(list, "sit", k), c: SIT[k].c, ink: SIT[k].ink, label: SIT[k].n(), f: (extraF || "") + "sit=" + k }; }); }
  function lvlParts(list) { return LEVEL_ORDER.map(function (k) { return { n: count(list, "level", k), c: LEVEL[k].c, ink: LEVEL[k].ink, label: LEVEL[k].n(), f: "level=" + k }; }); }
  function hbars(rows, max, fkey) { /* simple horizontal bars (count by a dimension) */
    return '<div class="pf-hb">' + rows.map(function (r) {
      return '<button class="pf-hbr" data-f="' + esc(fkey + "=" + r.k) + '" data-tip="' + esc(r.k + ": " + r.n) + '"><span class="l">' + esc(r.label || r.k) + '</span><span class="t"><i style="width:' + Math.max(2, r.n / max * 100) + '%"></i></span><b>' + r.n + "</b></button>";
    }).join("") + "</div>";
  }
  function attCell(a) { return a ? '<span class="pf-att ' + ATT[a].cls + '">' + esc(ATT[a].n()) + "</span>" : ""; }
  function sitCell(s) { return '<span class="pf-sit" style="color:' + (s === "backlog" ? "#9a6400" : SIT[s].c) + '">' + esc(SIT[s].n()) + "</span>"; }
  function svcCell(s) { return s && SVC[s] ? '<span class="pf-svc">' + IC(SVC[s].ic, 13) + " " + esc(SVC[s].n()) + "</span>" : ""; }
  function head(title, sub, actions) {
    return '<div class="pf-head"><div><h2>' + title + '</h2><p class="muted small">' + sub + '</p></div><div class="pf-acts">' + actions + "</div></div>";
  }
  function crumbs() {
    const org = S().org || "Portfolio";
    let h = '<nav class="pf-crumbs"><button data-go="root">' + esc(org) + " · " + L("Portfolio", "Portfólio") + "</button>";
    if (st.island) h += ' › <button data-go="island">' + esc(st.island) + "</button>";
    if (st.item) { const it = A.data().items[st.item]; h += " › <span>" + esc(it ? it.title : "") + "</span>"; }
    return h + "</nav>";
  }
  function subline() {
    const s = S();
    return "PMO | " + L("Reference date: ", "Data-base: ") + fmtLong(s.ref) + " | " + L("Source: ", "Fonte: ") + esc(s.source || "GLPI") + (s.file ? " · " + esc(s.file) : "");
  }
  function filterBar(all) {
    const f = st.f, opt = function (key, label, vals) {
      return '<label><span>' + label + '</span><select data-sel="' + key + '"><option value="">' + L("All", "Todos") + "</option>" + vals.map(function (v) { return '<option value="' + esc(v[0]) + '"' + (f[key] === v[0] ? " selected" : "") + ">" + esc(v[1]) + "</option>"; }).join("") + "</select></label>";
    };
    const uniq = function (k) { const o = {}; all.forEach(function (p) { o[p[k]] = 1; }); return Object.keys(o).sort().map(function (x) { return [x, x]; }); };
    const any = Object.keys(f).some(function (k) { return f[k]; });
    return '<div class="pf-filters">' +
      '<label class="q"><span>' + L("Search", "Pesquisar") + '</span><input type="search" data-sel="q" value="' + esc(f.q || "") + '" placeholder="' + L("Project, unit or GLPI ID", "Projeto, unidade ou ID do GLPI") + '"></label>' +
      opt("sit", L("Situation", "Situação"), SIT_ORDER.map(function (k) { return [k, SIT[k].n()]; })) +
      opt("level", L("Level", "Nível"), LEVEL_ORDER.map(function (k) { return [k, LEVEL[k].n()]; })) +
      opt("unit", L("Unit", "Unidade"), uniq("unit")) +
      opt("prio", L("Priority", "Prioridade"), uniq("prio")) +
      opt("svc", L("Classification", "Classificação"), Object.keys(SVC).map(function (k) { return [k, SVC[k].n()]; }).concat([["_none", L("Project only", "Só projeto")]])) +
      opt("att", L("Attention", "Atenção"), [["_any", L("Any alert", "Qualquer alerta")]].concat(Object.keys(ATT).map(function (k) { return [k, ATT[k].n()]; }))) +
      (any ? '<button class="pl-btn sm" data-clear>' + L("Clear filters", "Limpar filtros") + "</button>" : "") + "</div>";
  }
  function projTable(list, opts) {
    opts = opts || {};
    if (!list.length) return '<p class="muted small">' + L("No projects for these filters.", "Nenhum projeto para estes filtros.") + "</p>";
    const lo = { "Estratégico": 0, "Tático": 1, "Operacional": 2 }, so = { doing: 0, blocked: 1, backlog: 2, done: 3 };
    list = list.slice().sort(function (a, b) { return (lo[a.level] - lo[b.level]) || (so[a.sit] - so[b.sit]) || a.title.localeCompare(b.title); });
    return '<div class="rp-tw"><table class="rp-t pf-t"><thead><tr><th>' + L("Project", "Projeto") + " (GLPI)</th>" + (opts.island ? "<th>" + L("Island", "Ilha") + "</th>" : "") + "<th>" + L("Level", "Nível") + "</th><th>" + L("Situation", "Estado") + "</th><th>" + L("Progress", "Avanço") + "</th><th>" + L("Due", "Prazo") + "</th><th>" + L("Attention", "Atenção") + "</th><th>" + L("Classification", "Classificação") + "</th><th>" + L("Next step", "Encaminhamento") + "</th></tr></thead><tbody>" +
      list.map(function (p) {
        return '<tr data-open="' + esc(p.id) + '" tabindex="0"><td class="pf-name">' + esc(p.title) + '<small>' + esc(p.unit) + "</small></td>" + (opts.island ? "<td>" + esc(p.island) + "</td>" : "") + '<td><span class="pf-lvl">' + esc((LEVEL[p.level] || { n: function () { return p.level; } }).n()) + "</span></td><td>" + sitCell(p.sit) + '</td><td class="num"><span class="pf-prog"><i style="width:' + p.progress + '%"></i></span>' + p.progress + "%</td><td class=\"num\">" + fmtD(p.end) + "</td><td>" + attCell(p.att) + "</td><td>" + svcCell(p.svc) + '</td><td class="pf-note">' + esc(p.it.pfNote || "") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  /* ---------- views ---------- */
  function actions() {
    return (A.canEdit() ? '<button class="pl-btn sm" data-act="import">' + IC("upload", 14) + " " + L("Import GLPI export", "Importar exportação do GLPI") + "</button>" : "") +
      '<button class="pl-btn sm" data-act="csv">' + IC("export", 14) + " CSV</button>" +
      '<button class="pl-btn sm primary" data-act="pdf">' + IC("export", 14) + " " + L("One page (PDF)", "One page (PDF)") + "</button>";
  }
  function macro(all) {
    const org = S().org || "";
    const list = all.filter(function (p) { return pass(p); });
    const f = st.f, isl = islands(all);
    const tiles = '<div class="pf-tiles">' +
      tile(L("Total", "Total"), list.length, "var(--ink)", "", false) +
      SIT_ORDER.filter(function (k) { return k !== "done" || count(list, "sit", "done"); }).map(function (k) { return tile(SIT[k].n(), count(list, "sit", k), k === "backlog" ? "#b26f00" : SIT[k].c, "sit=" + k, f.sit === k); }).join("") +
      LEVEL_ORDER.map(function (k) { return tile(LEVEL[k].n(), count(list, "level", k), k === "Operacional" ? "#5d6b85" : LEVEL[k].c, "level=" + k, f.level === k); }).join("") + "</div>";
    const att = '<div class="pf-tiles small">' + Object.keys(ATT).filter(function (k) { return k !== "blocked"; }).map(function (k) { return tile(ATT[k].n(), count(list, "att", k), ATT[k].cls === "bad" ? "#b42318" : "#8a6400", "att=" + k, f.att === k); }).join("") +
      Object.keys(SVC).map(function (k) { return tile(SVC[k].n(), count(list, "svc", k), "#0f766e", "svc=" + k, f.svc === k); }).join("") + "</div>";
    const maxI = Math.max.apply(null, isl.map(function (n) { return list.filter(function (p) { return p.island === n; }).length; }).concat([1]));
    const bars = '<div class="pf-ib">' + isl.map(function (n) {
      const sub = list.filter(function (p) { return p.island === n; });
      return '<div class="pf-ibr"><button class="l" data-island="' + esc(n) + '" title="' + esc(L("Open ", "Abrir ") + n) + '">' + esc(n) + '</button><div class="pf-ibt" style="width:' + Math.max(8, sub.length / maxI * 100) + '%">' + seg(sitParts(sub, "island=" + n + "&"), sub.length) + "</div><b>" + sub.length + "</b></div>";
    }).join("") + "</div>";
    const units = {}; list.forEach(function (p) { units[p.unit] = (units[p.unit] || 0) + 1; });
    const ur = Object.keys(units).map(function (k) { return { k: k, n: units[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 10);
    const table = '<div class="rp-tw"><table class="rp-t pf-t"><thead><tr><th>' + L("Island", "Ilha") + "</th><th>Total</th><th>" + SIT.doing.n() + "</th><th>" + L("Blocked", "Bloqueados") + "</th><th>Backlog</th><th>" + L("Strategic", "Estratégicos") + "</th><th>" + L("Tactical", "Táticos") + "</th><th>" + L("Operational", "Operacionais") + "</th><th>" + L("Overdue", "Prazo vencido") + "</th></tr></thead><tbody>" +
      isl.map(function (n) { const s = list.filter(function (p) { return p.island === n; }); return '<tr data-island="' + esc(n) + '" tabindex="0"><td class="pf-name">' + esc(n) + "</td>" + [s.length, count(s, "sit", "doing"), count(s, "sit", "blocked"), count(s, "sit", "backlog"), count(s, "level", "Estratégico"), count(s, "level", "Tático"), count(s, "level", "Operacional"), count(s, "att", "late")].map(function (x) { return '<td class="num">' + x + "</td>"; }).join("") + "</tr>"; }).join("") +
      '<tr class="tot"><td>TOTAL</td>' + [list.length, count(list, "sit", "doing"), count(list, "sit", "blocked"), count(list, "sit", "backlog"), count(list, "level", "Estratégico"), count(list, "level", "Tático"), count(list, "level", "Operacional"), count(list, "att", "late")].map(function (x) { return '<td class="num">' + x + "</td>"; }).join("") + "</tr></tbody></table></div>";
    const filtered = Object.keys(f).some(function (k) { return f[k]; });
    return head(esc(org ? org + " / " : "") + L("Executive portfolio", "Portfólio executivo"), subline(), actions()) + filterBar(all) + tiles + att +
      '<div class="pf-grid"><section class="rp-card"><h3>' + L("By island and situation", "Distribuição por ilha e situação") + '</h3><p class="muted small">' + L("Click an island to drill down; click a colour to filter.", "Clique na ilha para detalhar; clique numa cor para filtrar.") + "</p>" + bars + legend(SIT_ORDER.filter(function (k) { return k !== "done" || count(list, "sit", "done"); }), SIT) + "</section>" +
      '<section class="rp-card"><h3>' + L("By level", "Distribuição por nível") + "</h3>" + seg(lvlParts(list), list.length) + legend(LEVEL_ORDER, LEVEL) +
      "<h3 class=\"mt\">" + L("Projects by unit (top 10)", "Projetos por unidade (top 10)") + "</h3>" + (ur.length ? hbars(ur, ur[0].n, "unit") : "") + "</section></div>" +
      '<section class="rp-card"><h3>' + L("Portfolio by island", "Carteira por ilha") + "</h3>" + table + "</section>" +
      (filtered ? '<section class="rp-card"><h3>' + L("Projects in the filter", "Projetos no filtro") + " · " + list.length + "</h3>" + projTable(list, { island: true }) + "</section>" : "") +
      '<p class="pf-foot">' + L("Executive agenda: blockers, deadlines, capacity and decisions. Backlog is counted in the indicators; the detail by island leaves it out.", "Pauta executiva: bloqueios, prazos, capacidade e decisões. O backlog entra nos indicadores; o detalhe por ilha não inclui o backlog.") + "</p>";
  }
  function islandView(all) {
    const org = S().org || "";
    const sub = all.filter(function (p) { return p.island === st.island; }), list = sub.filter(function (p) { return pass(p); }), f = st.f;
    const disc = list.filter(function (p) { return st.withBacklog || p.sit !== "backlog"; });
    const tiles = '<div class="pf-tiles">' + tile("Total", list.length, "var(--ink)", "", false) +
      SIT_ORDER.filter(function (k) { return k !== "done" || count(list, "sit", "done"); }).map(function (k) { return tile(SIT[k].n(), count(list, "sit", k), k === "backlog" ? "#b26f00" : SIT[k].c, "sit=" + k, f.sit === k); }).join("") +
      LEVEL_ORDER.map(function (k) { return tile(LEVEL[k].n(), count(list, "level", k), k === "Operacional" ? "#5d6b85" : LEVEL[k].c, "level=" + k, f.level === k); }).join("") + "</div>";
    return head(esc((org ? org + " / " : "") + st.island), subline(), actions()) + filterBar(sub) + tiles +
      '<div class="pf-grid"><section class="rp-card"><h3>' + L("Situation", "Situação da carteira") + "</h3>" + seg(sitParts(list), list.length) + legend(SIT_ORDER.filter(function (k) { return k !== "done" || count(list, "sit", "done"); }), SIT) + "</section>" +
      '<section class="rp-card"><h3>' + L("By level", "Distribuição por nível") + "</h3>" + seg(lvlParts(list), list.length) + legend(LEVEL_ORDER, LEVEL) + "</section></div>" +
      '<section class="rp-card"><div class="pf-sum"><b>' + L("Under discussion: ", "Carteira em discussão: ") + list.filter(function (p) { return p.sit !== "backlog"; }).length + "</b> · " + L("Overdue: ", "Prazo vencido: ") + count(list, "att", "late") + " · " + L("In progress without a due date: ", "Em execução sem prazo: ") + count(list, "att", "nodate") +
      '<label class="chk"><input type="checkbox" id="pfBl"' + (st.withBacklog ? " checked" : "") + "> " + L("Include the backlog", "Incluir o backlog") + "</label></div>" + projTable(disc) + '<p class="pf-foot">' + L("Next step: record the decision, owner and date. The GLPI state is not the project's health.", "Encaminhamento: registrar decisão, responsável e prazo. Estado cadastrado não equivale à saúde do projeto.") + "</p></section>";
  }
  function itsmPanel(p) {
    const sid = (A.data().settings || {}).itsm;
    if (!p.svc) return '<p class="muted small">' + L("Mark the project as Operation, Maintenance or Service to manage its tickets in the ITSM centre.", "Marque o projeto como Operação, Manutenção ou Serviço para gerir os chamados dele na central ITSM.") + "</p>";
    if (!sid) return '<div class="pf-note-box">' + IC("itsm", 16) + " " + L("No ITSM centre is linked to this planning yet. When the centre is ready, link it in ⋯ → Planning settings → Projects + Service; the tickets of this project will show here.", "Ainda não há central ITSM ligada a este planejamento. Quando a central estiver pronta, ligue em ⋯ → Configurações do planejamento → Projetos + Serviço; os chamados deste projeto aparecem aqui.") + "</div>";
    A.svcLoad(sid);
    const sv = A.svc(), I = window.ITSM, link = "../itsm/?id=" + encodeURIComponent(sid);
    if (sv.err) return '<p class="muted small">' + L("You don't have access to the linked ITSM centre.", "Você não tem acesso à central ITSM ligada.") + "</p>";
    if (!sv.recs || !I) return '<p class="muted small">' + L("Loading…", "Carregando…") + "</p>";
    const recs = Object.keys(sv.recs).map(function (k) { return Object.assign({ id: k }, sv.recs[k]); }).filter(function (r) {
      return (r.planLinks && r.planLinks[A.ID] === p.id) || r.pfItem === p.id || (p.gid && (r.pfGlpi === p.gid || String(r.title || "").indexOf("(" + p.gid + ")") >= 0));
    });
    const open = recs.filter(function (r) { return !I.isDone(r); });
    return '<div class="pf-tiles small">' + tile(L("Open tickets", "Chamados abertos"), open.length, open.length ? "#b42318" : "var(--ink)", "", false) + tile(L("Resolved / closed", "Resolvidos / fechados"), recs.length - open.length, "#1b7f4b", "", false) + "</div>" +
      (recs.length ? '<div class="rp-tw"><table class="rp-t"><thead><tr><th>' + L("Ticket", "Chamado") + "</th><th>" + L("Title", "Título") + "</th><th>Status</th></tr></thead><tbody>" + recs.map(function (r) { const s = I.status(r.kind, r.status); return "<tr><td>" + esc(r.key || "") + '</td><td><a href="' + link + "&rec=" + encodeURIComponent(r.id) + '">' + esc(r.title || "") + "</a></td><td>" + esc(s ? s.name : r.status || "") + "</td></tr>"; }).join("") + "</tbody></table></div>" : '<p class="muted small">' + L("No tickets linked to this project yet.", "Nenhum chamado ligado a este projeto ainda.") + "</p>") +
      '<a class="pl-btn sm" href="' + link + '">' + IC("itsm", 14) + " " + L("Open the ITSM centre", "Abrir a central ITSM") + "</a>";
  }
  function projectView(all) {
    const p = all.find(function (x) { return x.id === st.item; });
    if (!p) { st.item = null; return st.island ? islandView(all) : macro(all); }
    const it = p.it, pf = it.pf || {}, ed = A.canEdit();
    const kv = function (k, v) { return "<div><span>" + k + "</span><b>" + (v || "—") + "</b></div>"; };
    return head(esc(p.title), subline(), '<button class="pl-btn sm" data-act="drawer">' + IC("edit", 14) + " " + L("Open the item", "Abrir o item") + "</button>" + actions()) +
      '<div class="pf-grid"><section class="rp-card"><h3>' + L("Project", "Projeto") + '</h3><div class="pf-kv">' +
      kv("ID GLPI", esc(pf.id || "")) + kv(L("Island", "Ilha"), esc(p.island)) + kv(L("Unit", "Unidade"), esc(p.unit)) + kv(L("Level", "Nível"), esc((LEVEL[p.level] || { n: function () { return p.level; } }).n())) +
      kv(L("Situation", "Estado"), sitCell(p.sit)) + kv(L("Attention", "Atenção"), attCell(p.att) || "—") + kv(L("Priority", "Prioridade"), esc(p.prio)) + kv(L("Type", "Tipo"), esc(pf.gtype || "")) +
      kv(L("Manager group", "Grupo gerente"), esc(pf.group || "")) + kv(L("Approach", "Abordagem"), esc(pf.approach || "")) + kv(L("Important / urgent", "Importante / urgente"), esc((pf.imp || "—") + " / " + (pf.urg || "—"))) +
      kv(L("Planned start", "Início planejado"), fmtLong(it.start)) + kv(L("Planned end", "Fim planejado"), fmtLong(it.end)) + kv(L("Actual start", "Início real"), fmtLong(pf.realStart)) + kv(L("Actual end", "Fim real"), fmtLong(pf.realEnd)) +
      '</div><div class="pf-progress"><span>' + L("Progress", "Avanço") + " · " + p.progress + '%</span><span class="pf-prog big"><i style="width:' + p.progress + '%"></i></span></div></section>' +
      '<section class="rp-card"><h3>' + L("Classification and ITSM", "Classificação e ITSM") + '</h3><div class="pf-svcpick" role="group">' +
      Object.keys(SVC).map(function (k) { return '<button class="' + (p.svc === k ? "on" : "") + '" data-svc="' + k + '"' + (ed ? "" : " disabled") + ">" + IC(SVC[k].ic, 15) + " " + esc(SVC[k].n()) + "</button>"; }).join("") +
      '<button class="' + (!p.svc ? "on" : "") + '" data-svc=""' + (ed ? "" : " disabled") + ">" + L("Project only", "Só projeto") + "</button></div>" + itsmPanel(p) +
      "<h3 class=\"mt\">" + L("Next step", "Encaminhamento") + '</h3><textarea id="pfNote" rows="4"' + (ed ? "" : " disabled") + ' placeholder="' + L("Decision, owner and date", "Decisão, responsável e prazo") + '">' + esc(it.pfNote || "") + "</textarea>" + (ed ? '<div class="pl-row-end"><button class="pl-btn sm primary" id="pfNoteSave">' + L("Save", "Salvar") + "</button></div>" : "") + "</section></div>";
  }

  /* ---------- render + events ---------- */
  let tip = null;
  function render(v, api) {
    A = api;
    if (tip) tip.hidden = true;
    const all = projects();
    if (!all.length) {
      v.innerHTML = '<div class="rp pf">' + head(L("Portfolio", "Portfólio"), L("One page by island, BI-style, with drill-down down to the project and its ITSM tickets.", "One page por ilhas, no estilo BI, com drill-down até o projeto e os chamados do ITSM."), "") +
        '<div class="pl-empty"><p>' + L("No projects yet. Import the GLPI project export (.xlsx or .csv) to build the portfolio.", "Ainda não há projetos. Importe a exportação de projetos do GLPI (.xlsx ou .csv) para montar o portfólio.") + "</p>" + (A.canEdit() ? '<button class="pl-btn primary" data-act="import">' + IC("upload", 15) + " " + L("Import GLPI export", "Importar exportação do GLPI") + "</button>" : "") + "</div></div>";
      bind(v); return;
    }
    if (st.island && !all.some(function (p) { return p.island === st.island; })) st.island = null;
    v.innerHTML = '<div class="rp pf">' + crumbs() + (st.item ? projectView(all) : st.island ? islandView(all) : macro(all)) + "</div>";
    bind(v);
  }
  function rerender() { A.renderView(); }
  function applyF(spec) {
    spec.split("&").forEach(function (kv) {
      const i = kv.indexOf("="), k = kv.slice(0, i), val = kv.slice(i + 1);
      if (k === "island") { st.island = val; st.item = null; return; }
      st.f[k] = st.f[k] === val ? "" : val;
    });
  }
  function bind(v) {
    v.querySelectorAll("[data-f]").forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); applyF(b.dataset.f); rerender(); }; });
    v.querySelectorAll("[data-island]").forEach(function (b) { const go = function () { st.island = b.dataset.island; st.item = null; rerender(); v.scrollTop = 0; }; b.onclick = go; b.onkeydown = function (e) { if (e.key === "Enter") go(); }; });
    v.querySelectorAll("tr[data-open]").forEach(function (r) { const go = function () { st.item = r.dataset.open; const p = projects().find(function (x) { return x.id === st.item; }); if (p) st.island = p.island; rerender(); v.scrollTop = 0; }; r.onclick = go; r.onkeydown = function (e) { if (e.key === "Enter") go(); }; });
    v.querySelectorAll("[data-go]").forEach(function (b) { b.onclick = function () { if (b.dataset.go === "root") { st.island = null; st.item = null; } else st.item = null; rerender(); }; });
    v.querySelectorAll("[data-sel]").forEach(function (s) {
      const fn = function () { st.f[s.dataset.sel] = s.value; if (s.dataset.sel === "q") { clearTimeout(bind._t); bind._t = setTimeout(function () { rerender(); const q = document.querySelector('[data-sel="q"]'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 250); } else rerender(); };
      s.oninput = s.dataset.sel === "q" ? fn : null; s.onchange = s.dataset.sel === "q" ? null : fn;
    });
    const cl = v.querySelector("[data-clear]"); if (cl) cl.onclick = function () { st.f = {}; rerender(); };
    const bl = v.querySelector("#pfBl"); if (bl) bl.onchange = function () { st.withBacklog = bl.checked; rerender(); };
    v.querySelectorAll("[data-act]").forEach(function (b) { b.onclick = function () { const a = b.dataset.act; if (a === "import") importDialog(); else if (a === "csv") csv(); else if (a === "pdf") printOnePage(); else if (a === "drawer") A.openDrawer(st.item); }; });
    v.querySelectorAll("[data-svc]").forEach(function (b) { b.onclick = function () { const val = b.dataset.svc || null; A.patch(st.item, { pfSvc: val }).then(function () { A.toast(val ? L("Classified as ", "Classificado como ") + SVC[val].n() : L("Back to project only", "Voltou a ser só projeto")); }); }; });
    const ns = v.querySelector("#pfNoteSave"); if (ns) ns.onclick = function () { A.patch(st.item, { pfNote: (document.getElementById("pfNote").value || "").trim() || null }).then(function () { A.toast(L("Next step saved", "Encaminhamento salvo")); }); };
    /* hover tooltip for bars */
    if (!tip) { tip = document.createElement("div"); tip.className = "pf-tip"; tip.hidden = true; document.body.appendChild(tip); }
    v.querySelectorAll("[data-tip]").forEach(function (el) {
      el.onmouseenter = function () { tip.textContent = el.dataset.tip; tip.hidden = false; };
      el.onmousemove = function (e) { tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 12) + "px"; tip.style.top = (e.clientY + 14) + "px"; };
      el.onmouseleave = function () { tip.hidden = true; };
    });
  }

  /* ---------- exports ---------- */
  function visible() { const all = projects(); return all.filter(function (p) { return pass(p); }); }
  function csv() {
    const q = function (x) { x = x == null ? "" : String(x); return /[",;\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    const rows = [["ID GLPI", L("Project", "Projeto"), L("Island", "Ilha"), L("Unit", "Unidade"), L("Level", "Nível"), L("Situation", "Estado"), L("Progress %", "Avanço %"), L("Start", "Início"), L("Due", "Prazo"), L("Attention", "Atenção"), L("Priority", "Prioridade"), L("Classification", "Classificação"), L("Next step", "Encaminhamento")]];
    visible().forEach(function (p) { rows.push([p.gid || "", p.title, p.island, p.unit, p.level, SIT[p.sit].n(), p.progress, p.start, p.end, p.att ? ATT[p.att].n() : "", p.prio, p.svc ? SVC[p.svc].n() : "", p.it.pfNote || ""]); });
    const blob = new Blob(["﻿" + rows.map(function (r) { return r.map(q).join(";"); }).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "portfolio-" + (S().org || "projetos").replace(/[^\w-]+/g, "-") + "-" + today() + ".csv"; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function printOnePage() {
    document.body.classList.add("pf-printing");
    const off = function () { document.body.classList.remove("pf-printing"); window.removeEventListener("afterprint", off); };
    window.addEventListener("afterprint", off);
    setTimeout(function () { window.print(); setTimeout(off, 1500); }, 50);
  }

  /* ---------- GLPI import ---------- */
  function norm(s) { return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); }
  function pick(row, names) { const ks = Object.keys(row); for (let i = 0; i < names.length; i++) { const k = ks.find(function (x) { return norm(x) === norm(names[i]); }); if (k != null && row[k] !== "" && row[k] != null) return row[k]; } return ""; }
  function toISO(v) {
    if (v == null || v === "") return "";
    if (typeof v === "number") { if (v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10); return ""; }
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + "-" + m[2] + "-" + m[3];
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return y + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2); }
    return "";
  }
  function pct(v) { if (v === "" || v == null) return 0; let n = typeof v === "number" ? v : parseFloat(String(v).replace("%", "").replace(",", ".")); if (isNaN(n)) return 0; if (n <= 1 && !/%/.test(String(v))) n = n * 100; return Math.max(0, Math.min(100, Math.round(n))); }
  function levelOf(v) { const n = norm(v); return n.indexOf("estrat") === 0 ? "Estratégico" : n.indexOf("tat") === 0 ? "Tático" : "Operacional"; }
  function sitFromState(v) { const n = norm(v); if (/bloq|block|pend|suspen/.test(n)) return "blocked"; if (/backlog|novo|aguard|planej/.test(n)) return "backlog"; if (/conclu|fechad|finaliz|encerr|cancel/.test(n)) return "done"; return "doing"; }
  /* rows: [{Nome, Localização, Prioridade, Estado, Tipo, Percentual finalizado, Grupo gerente, Data planejada para começo, ...}] */
  function parse(rows, map) {
    const out = [], skipped = [];
    rows.forEach(function (r) {
      const name = String(pick(r, ["Nome", "Name", "Projeto"]) || "").trim(); if (!name) return;
      const m = name.match(/\((\d+)\)\s*$/), id = m ? m[1] : String(pick(r, ["ID"]) || "").trim();
      if (!id) { skipped.push(name); return; }
      const group = String(pick(r, ["Grupo gerente", "Grupo", "Manager group"]) || "").trim();
      out.push({
        id: id, title: name, group: group, island: map[group] || (pick(r, ["Ilha"]) || "") || UNMAPPED,
        unit: String(pick(r, ["Localização", "Localizacao", "Location", "Unidade"]) || "").trim(), prio: String(pick(r, ["Prioridade", "Priority"]) || "").trim(),
        state: String(pick(r, ["Estado", "Status", "State"]) || "").trim(), gtype: String(pick(r, ["Tipo", "Type"]) || "").trim(),
        progress: pct(pick(r, ["Percentual finalizado", "Avanço", "% concluído", "Percent done"])),
        start: toISO(pick(r, ["Data planejada para começo", "Data planejada para comeco", "Início planejado", "Planned start"])), end: toISO(pick(r, ["Data planejada para fim", "Fim planejado", "Planned end"])),
        realStart: toISO(pick(r, ["Data real do começo", "Data real do comeco", "Início real"])), realEnd: toISO(pick(r, ["Data real de fim", "Fim real"])),
        level: levelOf(pick(r, ["Nível", "Nivel", "Level"])), approach: String(pick(r, ["Abordagem", "Approach"]) || "").trim(),
        imp: String(pick(r, ["Importante"]) || "").trim(), urg: String(pick(r, ["Urgente"]) || "").trim(), note: String(pick(r, ["Encaminhamento"]) || "").trim()
      });
    });
    return { rows: out, skipped: skipped };
  }
  const PF_STATUSES = function () { return [{ id: "backlog", name: "Backlog", cat: "todo" }, { id: "doing", name: L("In progress", "Processando"), cat: "doing" }, { id: "blocked", name: L("Blocked", "Bloqueado"), cat: "doing" }, { id: "done", name: L("Done", "Concluído"), cat: "done" }]; };
  /* writes everything in one multi-path update; keeps pfSvc / pfNote that people typed in the platform */
  function apply(parsed, meta) {
    const D = A.data(), items = D.items || {}, s = D.settings || {}, u = {}, now = Date.now();
    const byGid = {}; Object.keys(items).forEach(function (k) { const it = items[k]; if (it.pf && it.pf.id) byGid[it.pf.id] = k; });
    const epics = {}; Object.keys(items).forEach(function (k) { if (items[k].pfIsland) epics[items[k].pfIsland] = k; });
    const ss = s.statuses || [], has = function (id) { return ss.some(function (x) { return x.id === id; }); };
    if (!(has("backlog") && has("doing") && has("blocked") && has("done"))) u["settings/statuses"] = PF_STATUSES();
    const stId = function (sit) { return sit; };
    const order = (s.portfolio && s.portfolio.order) || DEFAULT_ORDER.slice();
    parsed.rows.forEach(function (r) { if (order.indexOf(r.island) < 0) order.push(r.island); });
    const needEpics = order.filter(function (n) { return !epics[n] && parsed.rows.some(function (r) { return r.island === n; }); });
    const newItems = parsed.rows.filter(function (r) { return !byGid[r.id]; });
    const n = needEpics.length + newItems.length;
    return A.db.ref("planning/" + A.ID + "/data/settings/seq").transaction(function (x) { return (x || 0) + n; }).then(function (res) {
      let seq = res.snapshot.val() - n; const pre = s.prefix || "PLN";
      needEpics.forEach(function (name) { const id = A.db.ref().push().key; epics[name] = id; u["items/" + id] = { type: "epic", title: name, pfIsland: name, status: "doing", order: 1000 * (order.indexOf(name) + 1), created: now, by: A.me.email, key: pre + "-" + (++seq) }; });
      let created = 0, updated = 0;
      parsed.rows.forEach(function (r, i) {
        const pf = { id: r.id, unit: r.unit, prio: r.prio, gtype: r.gtype, group: r.group, level: r.level, approach: r.approach, imp: r.imp, urg: r.urg, island: r.island, state: r.state, realStart: r.realStart || null, realEnd: r.realEnd || null, at: now };
        Object.keys(pf).forEach(function (k) { if (pf[k] === "" || pf[k] == null) delete pf[k]; });
        const k = byGid[r.id];
        if (k) {
          const p = "items/" + k + "/";
          u[p + "title"] = r.title; u[p + "status"] = stId(sitFromState(r.state)); u[p + "progress"] = r.progress; u[p + "start"] = r.start || null; u[p + "end"] = r.end || null; u[p + "parent"] = epics[r.island]; u[p + "pf"] = pf;
          if (r.note && !items[k].pfNote) u[p + "pfNote"] = r.note;
          updated++;
        } else {
          const id = A.db.ref().push().key, it = { type: "task", title: r.title, status: stId(sitFromState(r.state)), progress: r.progress, parent: epics[r.island], order: 10000 + i, created: now, by: A.me.email, key: pre + "-" + (++seq), pf: pf };
          if (r.start) it.start = r.start; if (r.end) it.end = r.end; if (r.note) it.pfNote = r.note;
          u["items/" + id] = it; created++;
        }
      });
      const P = Object.assign({}, s.portfolio || {}, { on: true, org: meta.org || (s.portfolio || {}).org || "", source: "GLPI", ref: meta.ref || today(), map: meta.map, order: order, at: now, by: A.me.email, file: meta.file || "" });
      u["settings/portfolio"] = P;
      return A.db.ref("planning/" + A.ID + "/data").update(u).then(function () { return { created: created, updated: updated, epics: needEpics.length, missing: Object.keys(byGid).filter(function (g) { return !parsed.rows.some(function (r) { return r.id === g; }); }).length }; });
    });
  }
  function readFile(file) {
    if (/\.csv$/i.test(file.name)) return file.text().then(function (t) { return { base: csvRows(t), cfg: null }; });
    const lib = window.XLSXLite ? Promise.resolve(window.XLSXLite) : new Promise(function (res, rej) { const sc = document.createElement("script"); sc.src = "../assets/js/xlsx-lite.js"; sc.onload = function () { res(window.XLSXLite); }; sc.onerror = function () { rej(new Error(L("Could not load the Excel reader", "Não foi possível carregar o leitor de Excel"))); }; document.head.appendChild(sc); });
    return lib.then(function (X) { return file.arrayBuffer().then(X.read); }).then(function (wb) {
      const name = wb.SheetNames.find(function (n) { return /glpi|base|projet/i.test(n); }) || wb.SheetNames.find(function (n) { return wb.rows(n).some(function (r) { return "Nome" in r || "Name" in r; }); }) || wb.SheetNames[0];
      const cfgN = wb.SheetNames.find(function (n) { return /config/i.test(n); });
      let cfg = null; if (cfgN) { cfg = {}; wb.rows(cfgN).forEach(function (r) { const g = pick(r, ["Grupo gerente"]), i = pick(r, ["Ilha"]); if (g && i) cfg[String(g).trim()] = String(i).trim(); }); }
      let ref = ""; if (cfgN) wb.rows(cfgN).forEach(function (r) { const d = pick(r, ["Data de referência", "Data de referencia"]); if (d && !ref) ref = toISO(d); });
      return { base: wb.rows(name), cfg: cfg, ref: ref };
    });
  }
  function csvRows(t) {
    const lines = t.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean); if (!lines.length) return [];
    const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ";" : ",";
    const split = function (l) { const o = []; let cur = "", q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === sep) { o.push(cur); cur = ""; } else cur += c; } o.push(cur); return o; };
    const h = split(lines[0]); return lines.slice(1).map(function (l) { const v = split(l), r = {}; h.forEach(function (k, i) { r[k.trim()] = (v[i] || "").trim(); }); return r; });
  }
  function importDialog() {
    const s = S();
    A.modal("<h2>" + IC("upload", 18) + " " + L("Import the GLPI project export", "Importar a exportação de projetos do GLPI") + '</h2><p class="muted small">' + L("Same columns as the GLPI export (Name with the ID in brackets, Location, Priority, State, Type, Percent done, Manager group, dates, Level, Approach…). Projects are matched by the GLPI ID: new ones are created, existing ones are updated, and the next steps and classifications typed here are kept.", "Mesmas colunas da exportação do GLPI (Nome com o ID entre parênteses, Localização, Prioridade, Estado, Tipo, Percentual finalizado, Grupo gerente, datas, Nível, Abordagem…). Os projetos são casados pelo ID do GLPI: os novos são criados, os existentes são atualizados e os encaminhamentos e classificações feitos aqui são mantidos.") + "</p>" +
      '<form class="pl-form" id="pfImp"><div class="g2"><label>' + L("Organisation", "Organização") + '<input name="org" value="' + esc(s.org || "") + '" placeholder="FUABC"></label><label>' + L("Reference date", "Data-base") + '<input type="date" name="ref" value="' + esc(today()) + '"></label></div>' +
      "<label>" + L("File (.xlsx or .csv)", "Arquivo (.xlsx ou .csv)") + '<input type="file" name="file" accept=".xlsx,.csv" required></label><div id="pfPrev"></div>' +
      '<div class="pl-row-end"><button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + '</button><button class="pl-btn primary" id="pfGo" disabled>' + L("Import", "Importar") + "</button></div></form>", function (box, close) {
      const f = box.querySelector("#pfImp"), prev = box.querySelector("#pfPrev"), go = box.querySelector("#pfGo");
      let parsed = null, map = Object.assign({}, DEFAULT_MAP, s.map || {}), file = "";
      f.file.onchange = function () {
        const fl = f.file.files[0]; if (!fl) return; file = fl.name; prev.innerHTML = '<p class="muted small">' + L("Reading…", "Lendo…") + "</p>";
        readFile(fl).then(function (r) {
          if (r.cfg) map = Object.assign(map, r.cfg); if (r.ref) f.ref.value = r.ref;
          parsed = parse(r.base, map);
          const ex = {}; Object.keys(A.data().items || {}).forEach(function (k) { const it = A.data().items[k]; if (it.pf && it.pf.id) ex[it.pf.id] = 1; });
          const nNew = parsed.rows.filter(function (x) { return !ex[x.id]; }).length, groups = {};
          parsed.rows.forEach(function (x) { groups[x.group || "—"] = x.island; });
          const isl = {}; parsed.rows.forEach(function (x) { isl[x.island] = (isl[x.island] || 0) + 1; });
          prev.innerHTML = '<div class="pf-prev"><p><b>' + parsed.rows.length + "</b> " + L("projects", "projetos") + " · <b>" + nNew + "</b> " + L("new", "novos") + " · <b>" + (parsed.rows.length - nNew) + "</b> " + L("to update", "para atualizar") + (parsed.skipped.length ? " · " + parsed.skipped.length + " " + L("without an ID (ignored)", "sem ID (ignorados)") : "") + "</p>" +
            '<table class="rp-t"><thead><tr><th>' + L("Manager group", "Grupo gerente") + "</th><th>" + L("Island", "Ilha") + "</th></tr></thead><tbody>" + Object.keys(groups).sort().map(function (g) { return "<tr><td>" + esc(g) + '</td><td><input data-g="' + esc(g) + '" value="' + esc(groups[g] === UNMAPPED ? "" : groups[g]) + '" placeholder="' + UNMAPPED + '"></td></tr>'; }).join("") + "</tbody></table>" +
            '<p class="muted small">' + Object.keys(isl).map(function (k) { return esc(k) + ": " + isl[k]; }).join(" · ") + "</p></div>";
          go.disabled = !parsed.rows.length;
        }, function (e) { prev.innerHTML = '<p class="d-err">' + esc(e.message) + "</p>"; });
      };
      f.onsubmit = function (e) {
        e.preventDefault(); if (!parsed) return;
        prev.querySelectorAll("[data-g]").forEach(function (i) { map[i.dataset.g] = i.value.trim() || UNMAPPED; });
        parsed.rows.forEach(function (r) { r.island = map[r.group || "—"] || r.island; });
        go.disabled = true; go.textContent = L("Importing…", "Importando…");
        apply(parsed, { org: f.org.value.trim(), ref: f.ref.value, map: map, file: file }).then(function (r) {
          close(); A.toast(L("Imported: ", "Importado: ") + r.created + L(" new, ", " novos, ") + r.updated + L(" updated", " atualizados") + (r.missing ? " · " + r.missing + L(" not in this export", " não vieram nesta exportação") : ""));
          st.island = null; st.item = null;
        }, function (er) { go.disabled = false; go.textContent = L("Import", "Importar"); A.fail(er); });
      };
    });
  }
  /* programmatic import (same rules as the dialog) – rows as in the GLPI export */
  function importRows(rows, meta) {
    meta = meta || {}; const map = Object.assign({}, DEFAULT_MAP, (S().map || {}), meta.map || {});
    return apply(parse(rows, map), { org: meta.org, ref: meta.ref, map: map, file: meta.file });
  }
  window.CMPortfolio = { render: render, importDialog: function (api) { A = api || A; importDialog(); }, importRows: function (rows, meta, api) { A = api || A; return importRows(rows, meta); }, _parse: parse, _sitFromState: sitFromState, reset: function () { st.island = null; st.item = null; st.f = {}; } };
})();
