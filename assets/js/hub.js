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
  /* "Start something new": one picker for every module – module tabs, then area, then the area's templates */
  const MODTAB = [["collab", "Collaboration", "Colaboração"], ["planning", "Planning", "Planejamento"], ["itsm", "ITSM", "ITSM"], ["game", "Business Game", "Business Game"]];
  function startStrip(canCreate, opts) {
    if (!canCreate) return "";
    const o = opts || {}, mods = MODTAB.filter(function (m) { return m[0] === "collab" || (m[0] === "planning" ? o.plan : m[0] === "itsm" ? o.itsm && window.ITSM : o.game && window.CMGameEngine); });
    let cur = ""; try { cur = localStorage.getItem("cm:startMod") || ""; } catch (e) {}
    if (!mods.some(function (m) { return m[0] === cur; })) cur = "collab";
    return '<section class="hub-sec start-sec"><div class="hub-sec-head"><h2>Start something new</h2><span class="muted small">' + esc(LL("Choose the module and the area, then the template – everything stays editable.", "Escolha o módulo e a área, depois o template – tudo continua editável.")) + "</span></div>" +
      (mods.length > 1 ? '<div class="st-mods no-i18n" role="tablist">' + mods.map(function (m) { return '<button role="tab" data-smod="' + m[0] + '"' + (m[0] === cur ? ' class="on" aria-selected="true"' : ' aria-selected="false"') + ">" + (window.CMIcon3D ? window.CMIcon3D(m[0] === "collab" ? "board" : m[0], 26, m[0]) : "") + "<span>" + esc(LL(m[1], m[2])) + "</span></button>"; }).join("") + "</div>" : "") +
      mods.map(function (m) { return '<div class="st-pane" data-spane="' + m[0] + '"' + (m[0] === cur ? "" : " hidden") + ">" + (m[0] === "collab" ? collabPick() : m[0] === "planning" ? planPick() : m[0] === "itsm" ? itsmPick() : gamePick()) + "</div>"; }).join("") + "</section>";
  }
  function areaList(key, ar, cur) {
    return '<div class="tpl-areas no-i18n" role="tablist" aria-label="' + esc(LL("Areas", "Áreas")) + '">' + ar.map(function (a) {
      return '<button role="tab" data-' + key + '="' + a.id + '" aria-selected="' + (a.id === cur) + '"' + (a.id === cur ? ' class="on"' : "") + "><span>" + esc(a.name) + "</span><small>" + a.n + "</small></button>";
    }).join("") + "</div>";
  }
  function storedArea(k, ar, dflt) { let v = ""; try { v = localStorage.getItem(k) || ""; } catch (e) {} return ar.some(function (a) { return a.id === v; }) ? v : (ar.some(function (a) { return a.id === dflt; }) ? dflt : (ar[0] || {}).id); }
  function collabPick() {
    const ar = tplAreas(), cur = tplArea(ar);
    return '<div class="tpl-pick">' + areaList("tcat", ar, cur) +
      '<div class="tpl-strip" id="tplStrip">' + TPL.map(function (x) {
        const c = x.cat || "basic";
        return '<button class="tpl-tile' + (x.id === "blank" ? " blank" : "") + '" data-new="' + x.id + '" data-cat="' + esc(c) + '"' + (x.id === "blank" || c === cur ? "" : " hidden") + '><span class="tpl-pv">' + pv(x.id) + '</span><b class="no-i18n">' + esc(x.name) + "</b></button>";
      }).join("") + "</div></div>";
  }
  function planPick() {
    const M = window.PLAN_METHODS || {}, AR = window.PLAN_AREAS || {}, AP = window.PLAN_AREA_PLANS || [], W = window.PLAN_WORKFLOWS ? window.PLAN_WORKFLOWS() : {};
    const ar = (window.PLAN_AREA_ORDER || []).map(function (k) { return { id: k, name: (AR[k] || {}).name || k, n: AP.filter(function (p) { return p.area === k; }).length }; }).filter(function (a) { return a.n; })
      .concat([{ id: "_methods", name: LL("Free methods", "Métodos livres"), n: (window.PLAN_ORDER || []).length }]);
    const cur = storedArea("cm:planArea", ar, "ohs");
    return '<div class="tpl-pick">' + areaList("parea", ar, cur) + '<div class="tpl-strip">' +
      AP.map(function (p) { const m = M[p.method] || {}; return '<button class="tpl-tile plan-tile" data-newplant="' + p.id + '" data-cat="' + p.area + '"' + (p.area === cur ? "" : " hidden") + '><span class="tpl-pv">' + (window.CMPlanPreview ? window.CMPlanPreview(p.method) : "") + '</span><b class="no-i18n">' + esc(p.name) + '</b><small class="muted no-i18n">' + esc(m.name || "") + (W[p.workflow] ? " · " + esc(W[p.workflow].name) : "") + "</small></button>"; }).join("") +
      (window.PLAN_ORDER || []).map(function (k) { const m = M[k]; return '<button class="tpl-tile plan-tile" data-newplanm="' + k + '" data-cat="_methods"' + (cur === "_methods" ? "" : " hidden") + '><span class="tpl-pv">' + (window.CMPlanPreview ? window.CMPlanPreview(k) : "") + '</span><b class="no-i18n">' + (window.CMIcon3D ? window.CMIcon3D(m.icon, 24, k) : "") + " " + esc(m.name) + "</b></button>"; }).join("") +
      "</div></div>";
  }
  function itsmPick() {
    const T = window.ITSM.AREA_TEMPLATES, ks = Object.keys(T);
    const ar = ks.map(function (k) { return { id: k, name: T[k].name, n: T[k].offerings.length }; }), cur = storedArea("cm:itsmArea", ar, "ti");
    const KIND = { incident: LL("Incident", "Incidente"), request: LL("Request", "Requisição"), security: LL("Security", "Segurança") };
    return '<div class="tpl-pick">' + areaList("iarea", ar, cur) + "<div>" + ks.map(function (k) {
      const t = T[k];
      return '<div class="mp-pane" data-cat="' + k + '"' + (k === cur ? "" : " hidden") + '><div class="mp-head">' + (window.CMIcon3D ? window.CMIcon3D(t.icon || "itsm", 40, "violet") : "") + '<div><b class="no-i18n">' + esc(LL("Service centre – ", "Central de serviços – ") + t.name) + '</b><span class="muted small no-i18n">' + Object.keys(t.groups).length + " " + esc(LL("support groups", "grupos de suporte")) + " · " + t.services.length + " " + esc(LL("services", "serviços")) + " · " + t.offerings.length + " " + esc(LL("catalogue offerings", "ofertas no catálogo")) + (t.soc ? " · SLA 24×7" : "") + '</span></div><button class="btn primary sm" data-newitsma="' + k + '">' + esc(LL("Create with this area", "Criar com esta área")) + "</button></div>" +
        '<div class="mp-grid">' + t.offerings.map(function (o) { return '<div class="mp-item"><span class="mp-k" data-k="' + esc(o[1]) + '">' + esc(KIND[o[1]] || o[1]) + '</span><b class="no-i18n">' + esc(o[0]) + '</b><span class="muted small no-i18n">' + esc(o[3] || "") + "</span></div>"; }).join("") + "</div></div>";
    }).join("") + "</div></div>";
  }
  /* Business Game: the area is the market case; the institution then parametrises the project/game (rounds, rules, currency, brand) */
  const GAME_AREA_TXT = {
    industria: ["Manufacturing", "Indústria", "Production, capacity and costs – plan the operation and its investments.", "Produção, capacidade e custos – planejar a operação e os investimentos."],
    varejo: ["Retail", "Varejo", "Price, stock and marketing in a competitive market.", "Preço, estoque e marketing num mercado competitivo."],
    servicos: ["Services", "Serviços", "Team capacity, quality and client satisfaction.", "Capacidade da equipe, qualidade e satisfação do cliente."],
    startup: ["Tech startup", "Startup de tecnologia", "Fast growth, R&D and funding decisions.", "Crescimento acelerado, P&D e decisões de financiamento."]
  };
  function gamePick() {
    const E = window.CMGameEngine, X = window.CMGameAreas || {}, ks = Object.keys(E.SCENARIOS || {});
    const nm = function (k) { const a = X[k] || {}, t = GAME_AREA_TXT[k]; return a.name || (t ? LL(t[0], t[1]) : k); }, ds = function (k) { const a = X[k] || {}, t = GAME_AREA_TXT[k]; return a.desc || (t ? LL(t[2], t[3]) : ""); };
    const ar = ks.map(function (k) { return { id: k, name: nm(k), n: 1 }; }), cur = storedArea("cm:gameArea", ar, ks[0]);
    return '<div class="tpl-pick">' + areaList("garea", ar, cur).replace(/<small>1<\/small>/g, "") + "<div>" + ks.map(function (k) {
      return '<div class="mp-pane" data-cat="' + k + '"' + (k === cur ? "" : " hidden") + '><div class="mp-game"><span class="tpl-pv">' + gamePreview() + '</span><div><b class="no-i18n">' + esc(nm(k)) + '</b><p class="muted small no-i18n">' + esc(ds(k)) + "</p>" +
        '<ol class="mp-steps"><li>' + esc(LL("Choose the area (market case)", "Escolha a área (caso de mercado)")) + "</li><li>" + esc(LL("The institution parametrises the project: rounds, rules, decisions, currency and brand", "A instituição parametriza o projeto: rodadas, regras, decisões, moeda e marca")) + "</li><li>" + esc(LL("Invite the teams and open round 1", "Convide as equipes e abra a rodada 1")) + '</li></ol><button class="btn primary sm" data-newgamea="' + k + '">' + esc(LL("Create game in this area", "Criar partida nesta área")) + "</button></div></div></div>";
    }).join("") + "</div></div>";
  }
  /* template areas (Agile, Estratégia, Design e UX…): pick the area first, then see only its templates */
  function tplAreas() {
    const cats = window.MB_KIT_CATS || {}, seen = {};
    const order = ["agile", "strategy", "product"].concat(window.MB_KIT_CAT_ORDER || [], ["mentoring", "basic"]).filter(function (c) { if (seen[c]) return false; seen[c] = 1; return true; });
    return order.map(function (c) { return { id: c, name: c === "mentoring" ? LL("Mentoring", "Mentoria") : c === "basic" ? LL("Basic", "Básico") : cats[c] || c, n: TPL.filter(function (x) { return (x.cat || "basic") === c; }).length }; })
      .filter(function (a) { return a.n && !(a.id === "basic" && a.n === 1); });
  }
  function tplArea(ar) { let v = ""; try { v = localStorage.getItem("cm:tplArea") || ""; } catch (e) {} return ar.some(function (a) { return a.id === v; }) ? v : (ar[0] || {}).id; }
  function bindChips(wss) {
    const pick = function (attr, store, sel) {
      el.querySelectorAll("[data-" + attr + "]").forEach(function (b) {
        b.onclick = function () {
          const box = b.closest(".tpl-pick"), c = b.dataset[attr.replace(/-([a-z])/g, function (m, x) { return x.toUpperCase(); })];
          box.querySelectorAll("[data-" + attr + "]").forEach(function (x) { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", x === b); });
          try { localStorage.setItem(store, c); } catch (e) {}
          box.querySelectorAll(sel).forEach(function (t) { t.hidden = t.dataset.cat !== c && t.dataset.new !== "blank"; });
        };
      });
    };
    pick("tcat", "cm:tplArea", ".tpl-tile"); pick("parea", "cm:planArea", ".tpl-tile"); pick("iarea", "cm:itsmArea", ".mp-pane"); pick("garea", "cm:gameArea", ".mp-pane");
    el.querySelectorAll("[data-smod]").forEach(function (b) {
      b.onclick = function () {
        el.querySelectorAll("[data-smod]").forEach(function (x) { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", x === b); });
        el.querySelectorAll("[data-spane]").forEach(function (p) { p.hidden = p.dataset.spane !== b.dataset.smod; });
        try { localStorage.setItem("cm:startMod", b.dataset.smod); } catch (e) {}
      };
    });
    const own = Object.keys(wss || {}).filter(function (w) { return PLAN === "admin" || isOwner(w, wss[w]); });
    const wsFor = function (mod) { return own.filter(function (w) { const m = ((wss[w] || {}).info || {}).modules; return !Array.isArray(m) || m.indexOf(mod) >= 0; })[0] || own[0] || ""; };
    el.querySelectorAll("[data-newplant]").forEach(function (b) { b.onclick = function () { planDialog(wss, wsFor("planning"), null, b.dataset.newplant); }; });
    el.querySelectorAll("[data-newitsma]").forEach(function (b) { b.onclick = function () { location.href = "../itsm/?new=" + encodeURIComponent(wsFor("itsm")) + "&area=" + encodeURIComponent(b.dataset.newitsma); }; });
    el.querySelectorAll("[data-newgamea]").forEach(function (b) { b.onclick = function () { location.href = "../game/?new=1&ws=" + encodeURIComponent(wsFor("game")) + "&scenario=" + encodeURIComponent(b.dataset.newgamea); }; });
  }
  function planStrip(canCreate) {
    if (true) return ""; // merged into "Start something new" (module tabs)
    const M = window.PLAN_METHODS;
    return '<section class="hub-sec plan-sec"><div class="hub-sec-head"><h2>' + (window.CMModules && window.CMModules.icon ? '<span class="mod-tile-ic" data-m="planning">' + window.CMModules.icon("planning", 18) + "</span>" : (window.CMIcon ? window.CMIcon("planning", 20) : "")) + " " + esc(LL("Planning", "Planejamento")) + (window.CMNewBadge ? window.CMNewBadge("planning") : "") + '</h2><span class="muted small">' + esc(LL("Roadmaps, schedules, sprints and Kanban – with OKRs, e-mail alerts and Jira, Azure DevOps and Kanbanize integration.", "Roadmaps, cronogramas, sprints e Kanban – com OKRs, alertas por e-mail e integração com Jira, Azure DevOps e Kanbanize.")) + "</span></div>" +
      '<div class="tpl-strip">' + window.PLAN_ORDER.map(function (k) {
        const m = M[k];
        return '<button class="tpl-tile plan-tile" data-newplanm="' + k + '"><span class="tpl-pv">' + (window.CMPlanPreview ? window.CMPlanPreview(k) : "") + '</span><b class="no-i18n">' + (window.CMIcon3D ? window.CMIcon3D(m.icon, 28, k) : "") + " " + esc(m.name) + "</b></button>";
      }).join("") + "</div></section>";
  }
  /* module views reached from the top-bar "Módulos" switcher: #colaboracao · #planejamento · #business-game */
  const VIEWS = { colaboracao: "boards", planejamento: "plans", "business-game": "games" };
  function applyView(el) {
    const v = VIEWS[(location.hash || "").slice(1)] || "";
    el.dataset.view = v;
    const mt = el.querySelector('[data-smod="' + ({ boards: "collab", plans: "planning", games: "game" })[v] + '"]'); if (mt) mt.click();
    el.querySelectorAll(".ws-sec").forEach(function (sec) {
      if (!v) { sec.classList.remove("vf-empty"); return; }
      const sel = v === "plans" ? ".is-plan" : v === "games" ? ".is-game" : ".board-card:not(.is-plan):not(.is-game):not(.is-itsm)";
      sec.classList.toggle("vf-empty", !sec.querySelector(sel) && !(v === "games" && sec.querySelector("[data-newgame]:not(.locked)")) && !(v === "plans" && sec.querySelector("[data-newplan]")));
    });
    let bar = el.querySelector(".view-bar");
    if (!v) { if (bar) bar.remove(); return; }
    const T = { boards: [LL("Collaboration", "Colaboração"), LL("Your boards, by workspace. Start a new one from a template.", "Seus quadros, por workspace. Comece um novo a partir de um template.")],
      plans: [LL("Planning", "Planejamento"), LL("Your plannings, by workspace. Create a new one with the methods below.", "Seus planejamentos, por workspace. Crie um novo com os métodos abaixo.")],
      games: ["Business Game", LL("Your games, by workspace. Professors create a new game with “New game”.", "Suas partidas, por workspace. Professores criam uma nova partida em “Nova partida”.")] }[v];
    const mid = v === "plans" ? "planning" : v === "games" ? "game" : "collab", mic = window.CMModules && window.CMModules.icon ? '<span class="mod-tile-ic" data-m="' + mid + '">' + window.CMModules.icon(mid, 18) + "</span> " : "";
    const html = '<div class="view-bar"><div><span class="eyebrow">' + esc(LL("Module", "Módulo")) + '</span><h2>' + mic + esc(T[0]) + '</h2><p class="muted small">' + esc(T[1]) + '</p></div><a class="btn sm" href="#">' + esc(LL("Show everything", "Ver tudo")) + "</a></div>";
    if (bar) bar.outerHTML = html; else { const ub = el.querySelector(".userbar"); if (ub) ub.insertAdjacentHTML("afterend", html); }
    el.querySelector(".view-bar a").onclick = function (e) { e.preventDefault(); history.replaceState(null, "", location.pathname + location.search); applyView(el); };
    window.scrollTo({ top: 0 });
  }
  function planCard(id, p, wsName) {
    const m = (window.PLAN_METHODS || {})[p.method] || {};
    return '<a class="board-card is-plan" href="../planning/?id=' + encodeURIComponent(id) + '" data-title="' + esc((p.title || "").toLowerCase()) + '"><span class="tpl-pv">' + (window.CMPlanPreview ? window.CMPlanPreview(p.method) : "") + '<span class="pv-tag">' + (window.CMIcon3D ? window.CMIcon3D("planning", 22) : "") + "<span>Planning</span></span></span>" +
      '<span class="bc-t"><b class="no-i18n">' + esc(p.title || id) + '</b><span class="muted small no-i18n">' + esc(wsName ? wsName + " · " : "") + esc(m.name || "Planning") + "</span></span></a>";
  }
  /* Business Game (add-on module) cards */
  // a workspace can restrict which modules make sense in it (e.g. Occupational health / SHE: Planning + Indicators + ITSM, no Business Game)
  function wsMods(w) { const m = w && w.info && w.info.modules; return Array.isArray(m) ? m : (m && typeof m === "object" ? Object.keys(m).map(function (k) { return m[k]; }) : ["collab", "planning", "itsm", "game"]); }
  function gamePreview() {
    return '<svg viewBox="0 0 160 100" aria-hidden="true"><rect width="160" height="100" fill="#0e1a33"/><g fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M16 78 L46 64 L76 70 L106 44 L144 30" stroke="#2cc4b3"/><path d="M16 84 L46 76 L76 58 L106 62 L144 52" stroke="#e8c468"/><path d="M16 88 L46 86 L76 80 L106 76 L144 70" stroke="#eb6834"/></g>' +
      '<g fill="#c9d2e3"><rect x="16" y="14" width="40" height="6" rx="3"/><rect x="16" y="24" width="26" height="5" rx="2.5" opacity=".6"/></g><circle cx="144" cy="30" r="5" fill="#2cc4b3"/></svg>';
  }
  function gameCard(id, g, sub) {
    return '<a class="board-card is-game" href="../game/?id=' + encodeURIComponent(id) + '" data-title="' + esc((g.title || "").toLowerCase()) + '"><span class="tpl-pv">' + gamePreview() + '<span class="pv-tag">' + (window.CMIcon3D ? window.CMIcon3D("game", 22) : "") + "<span>Business Game</span></span></span>" +
      '<span class="bc-t"><b class="no-i18n">' + esc(g.title || id) + '</b><span class="muted small no-i18n">' + esc(sub || LL("Business simulation", "Simulação empresarial")) + "</span></span></a>";
  }
  /* ITSM (add-on module) – service-centre cards */
  function itsmPreview() {
    return '<svg viewBox="0 0 160 100" aria-hidden="true"><rect width="160" height="100" fill="#0e1a33"/><g fill="#16325c"><rect x="14" y="16" width="40" height="70" rx="6"/><rect x="60" y="16" width="40" height="70" rx="6"/><rect x="106" y="16" width="40" height="70" rx="6"/></g>' +
      '<rect x="19" y="24" width="30" height="14" rx="3" fill="#e5484d"/><rect x="19" y="42" width="30" height="14" rx="3" fill="#c9d2e3"/><rect x="65" y="24" width="30" height="14" rx="3" fill="#2cc4b3"/><rect x="111" y="24" width="30" height="14" rx="3" fill="#e8c468"/><rect x="111" y="42" width="30" height="14" rx="3" fill="#2cc4b3"/></svg>';
  }
  function itsmCard(id, x) {
    return '<a class="board-card is-itsm" href="../itsm/?id=' + encodeURIComponent(id) + '" data-title="' + esc((x.title || "").toLowerCase()) + '"><span class="tpl-pv">' + itsmPreview() + '<span class="pv-tag">' + (window.CMIcon3D ? window.CMIcon3D("itsm", 22) : "") + "<span>ITSM</span></span></span>" +
      '<span class="bc-t"><b class="no-i18n">' + esc(x.title || id) + '</b><span class="muted small no-i18n">' + esc(LL("Service centre", "Central de serviços")) + (x.home === false ? " · " + esc(LL("connected", "conectada")) : "") + "</span></span></a>";
  }
  function myGamesSlot(user, wss) {
    const slot = document.getElementById("gameSlot"); if (!slot) return;
    A.db().ref("userGames/" + A.key(user.email)).once("value").then(function (s) {
      const g = s.val() || {}, inWs = {};
      Object.keys(wss || {}).forEach(function (w) { Object.keys((wss[w] || {}).games || {}).forEach(function (k) { inWs[k] = 1; }); });
      const ids = Object.keys(g).filter(function (k) { return !inWs[k]; });
      if (!ids.length) return;
      slot.innerHTML = '<section class="hub-sec ws-sec"><div class="hub-sec-head"><h2>' + (window.CMIcon ? window.CMIcon("game", 20) : "") + " " + esc(LL("My games", "Minhas partidas")) + " · Business Game</h2></div><div class=\"board-grid\">" +
        ids.map(function (k) { const x = g[k] || {}; return gameCard(k, x, x.role === "prof" ? LL("Professor", "Professor") : LL("Student", "Aluno")); }).join("") + "</div></section>";
    }, function () { /* ignore */ });
  }
  function recentRows(allowed) {
    const r = recents().filter(function (x) { return !allowed || allowed[x.id]; }).slice(0, 6);
    if (!r.length) return "";
    return '<section class="hub-sec recent-sec"><div class="hub-sec-head"><h2>Jump back to recents</h2></div><div class="recent-list">' + r.map(function (x) {
      const info = allowed ? allowed[x.id] : x;
      if (x.kind === "itsm" || (info && info.kind === "itsm")) {
        return '<a class="recent-row" href="../itsm/?id=' + encodeURIComponent(x.id) + '"><span class="rr-pv">' + itsmPreview() + '</span><span class="rr-t"><b class="no-i18n">' + esc((info && info.title) || x.title) + '</b><span class="muted small no-i18n">ITSM · ' + esc((info && info.ws) || "") + '</span></span><span class="muted small">' + ago(x.t) + "</span></a>";
      }
      if (x.kind === "planning" || (info && info.kind === "planning")) {
        const m = (window.PLAN_METHODS || {})[(info && info.method) || x.method] || {};
        return '<a class="recent-row" href="../planning/?id=' + encodeURIComponent(x.id) + '"><span class="rr-pv">' + (window.CMPlanPreview ? window.CMPlanPreview((info && info.method) || x.method) : "") + '</span><span class="rr-t"><b class="no-i18n">' + esc((info && info.title) || x.title) + '</b><span class="muted small no-i18n">Planning · ' + esc((info && info.ws) || m.name || "") + '</span></span><span class="muted small">' + ago(x.t) + "</span></a>";
      }
      return '<a class="recent-row" href="' + boardUrl(x.id, x.template) + '"><span class="rr-pv">' + pv((info && info.template) || x.template) + '</span><span class="rr-t"><b class="no-i18n">' + esc((info && info.title) || x.title) + '</b><span class="muted small no-i18n">' + esc((info && info.ws) || tplName(x.template)) + '</span></span><span class="muted small">' + ago(x.t) + "</span></a>";
    }).join("") + "</div></section>";
  }
  function boardCard(id, b, wsName) {
    return '<a class="board-card" href="' + boardUrl(id, b.template) + '" data-title="' + esc((b.title || "").toLowerCase()) + '"><span class="tpl-pv">' + pv(b.template) + '</span>' +
      '<span class="bc-t"><b class="no-i18n">' + esc(b.title || id) + '</b><span class="muted small no-i18n">' + esc(wsName || tplName(b.template)) + "</span></span></a>";
  }
  let ME = null, PLAN = null, OWNED = {};
  function planDialog(wss, presetWs, presetMethod, presetTpl) {
    const canIn = function (id) { return PLAN === "admin" || isOwner(id, wss[id]); };
    const wsIds = Object.keys(wss || {}).filter(canIn);
    const M = window.PLAN_METHODS, order = window.PLAN_ORDER, AR = window.PLAN_AREAS || {}, AO = window.PLAN_AREA_ORDER || [], AP = window.PLAN_AREA_PLANS || [], W = window.PLAN_WORKFLOWS ? window.PLAN_WORKFLOWS() : {};
    const ic = function (n, z) { return window.CMIcon ? window.CMIcon(n, z || 22) : ""; };
    const wsArea = function (id) { return ((wss[id] || {}).info || {}).area || "general"; };
    let area = wsArea(presetWs || wsIds[0]);
    document.body.insertAdjacentHTML("beforeend", '<div class="modal-lite" id="planDlg"><div class="card plan-new"><h2>' + esc(LL("New planning", "Novo planejamento")) + '</h2><p class="muted small">' + esc(LL("Choose your area and a ready-made model – or a free method. Columns and workflow can be changed later.", "Escolha a sua área e um modelo pronto – ou um método livre. Colunas e fluxo podem mudar depois.")) + '</p><form id="planForm">' +
      '<div class="pn-cols"><div class="pa-chips pa-list no-i18n" role="radiogroup" aria-label="' + esc(LL("Area", "Área")) + '">' + AO.map(function (k) { return '<button type="button" data-area="' + k + '">' + esc(AR[k].name) + "</button>"; }).join("") + "</div>" +
      '<div class="pn-right"><div id="paTpl"></div>' +
      '<h3 class="pm-h no-i18n">' + esc(LL("Or start from a method", "Ou comece por um método")) + "</h3>" +
      '<div class="pm-grid pm-list">' + order.map(function (k, i) { const m = M[k]; return '<label class="pm-opt"><input type="radio" name="start" value="m:' + k + '"' + ((presetMethod ? k === presetMethod : i === 0) ? " checked" : "") + '><span class="pm-ic">' + (window.CMIcon3D ? window.CMIcon3D(m.icon, 26, k) : ic(m.icon)) + '</span><b class="no-i18n">' + esc(m.name) + '</b><span class="muted small no-i18n">' + esc(m.desc) + "</span></label>"; }).join("") + "</div></div></div>" +
      '<div class="pl-2"><label class="lbl-f">' + esc(LL("Name", "Nome")) + '<input name="title" required autocomplete="off" placeholder="' + esc(LL("e.g. Product roadmap 2027", "ex.: Roadmap do produto 2027")) + '"></label>' +
      '<label class="lbl-f">Workspace<select name="ws">' + wsIds.map(function (id) { return '<option value="' + id + '"' + (id === presetWs ? " selected" : "") + ">" + esc(wss[id].info.name) + "</option>"; }).join("") + "</select></label></div>" +
      '<label class="lbl-f">' + esc(LL("Kanban board workflow", "Fluxo do quadro Kanban")) + '<select name="wf"><option value="">' + esc(LL("Model default", "Padrão do modelo")) + "</option>" + Object.keys(W).map(function (k) { return '<option value="' + k + '">' + esc(W[k].name) + "</option>"; }).join("") + "</select></label>" +
      '<div class="row-end"><button type="button" class="btn" id="planX">' + esc(LL("Cancel", "Cancelar")) + '</button><button class="btn primary">' + esc(LL("Create planning", "Criar planejamento")) + "</button></div></form></div></div>");
    const d = document.getElementById("planDlg"), f = document.getElementById("planForm");
    function close() { d.remove(); }
    function drawArea() {
      d.querySelectorAll("[data-area]").forEach(function (b) { b.classList.toggle("on", b.dataset.area === area); });
      const list = AP.filter(function (p) { return p.area === area; });
      d.querySelector("#paTpl").innerHTML = list.length ? '<h3 class="pm-h no-i18n">' + esc(LL("Ready-made models for ", "Modelos prontos para ") + AR[area].name) + '</h3><div class="pm-grid pm-list pa-grid">' + list.map(function (p) {
        const m = M[p.method] || {}; return '<label class="pm-opt pa-opt"><input type="radio" name="start" value="t:' + p.id + '"><span class="pm-ic">' + (window.CMIcon3D ? window.CMIcon3D(m.icon, 26, p.method) : ic(m.icon)) + '</span><b class="no-i18n">' + esc(p.name) + '</b><span class="muted small no-i18n">' + esc(p.desc) + '</span><span class="pa-tag no-i18n">' + esc(m.name || "") + (W[p.workflow] ? " · " + esc(W[p.workflow].name) : "") + "</span></label>";
      }).join("") + "</div>" : "";
      if (!f.querySelector('[name=start]:checked')) { const fst = f.querySelector('[name=start]'); if (fst) fst.checked = true; }
    }
    d.querySelectorAll("[data-area]").forEach(function (b) { b.onclick = function () { area = b.dataset.area; drawArea(); const t = d.querySelector('#paTpl input'); if (t) t.checked = true; }; });
    f.ws.onchange = function () { area = wsArea(f.ws.value); drawArea(); };
    drawArea();
    if (!presetMethod) { const t = d.querySelector("#paTpl input"); if (t && area !== "general") t.checked = true; }
    const ptp = presetTpl && AP.find(function (p) { return p.id === presetTpl; });
    if (ptp) { area = ptp.area; drawArea(); const r = f.querySelector('[name=start][value="t:' + ptp.id + '"]'); if (r) r.checked = true; }
    document.getElementById("planX").onclick = close; d.onclick = function (e) { if (e.target === d) close(); };
    setTimeout(function () { f.title.focus(); }, 30);
    f.onsubmit = function (e) {
      e.preventDefault();
      const title = f.title.value.trim(), ws = f.ws.value, st = (f.querySelector("[name=start]:checked") || {}).value || "m:hybrid"; if (!title || !ws) return;
      const tpl = st.indexOf("t:") === 0 ? AP.find(function (p) { return p.id === st.slice(2); }) : null, method = tpl ? tpl.method : st.slice(2);
      const lim = PLAN && PLAN !== "admin" ? PLAN : null;
      if (lim && Object.keys((wss[ws] || {}).boards || {}).length + Object.keys((wss[ws] || {}).plannings || {}).length >= lim.boards) return planLimit(t("Your plan allows") + " " + lim.boards + " " + t("boards per workspace") + ".");
      const id = (slug(title) || "planning") + "-" + rnd(), TS = window.firebase.database.ServerValue.TIMESTAMP, me = A.user(), u = {};
      const inf = { title: title, ws: ws, method: method, created: TS, createdBy: me.email, area: area };
      if (tpl) inf.tpl = tpl.id;
      u["planning/" + id + "/info"] = inf;
      u["planning/" + id + "/data"] = window.PLAN_INITIAL(method, title, { tpl: tpl && tpl.id, workflow: f.wf.value || undefined });
      u["workspaces/" + ws + "/plannings/" + id] = { title: title, method: method, created: TS };
      f.querySelector(".btn.primary").disabled = true;
      A.db().ref().update(u).then(function () { location.href = "../planning/?id=" + encodeURIComponent(id); }, function (err) { f.querySelector(".btn.primary").disabled = false; toast(err.message); });
    };
  }
  function isOwner(id, w) { return !!(w && w.info && ME && w.info.owner === ME); }
  function wsSection(id, w, adminAll) {
    const admin = adminAll || isOwner(id, w);
    const boards = w.boards || {}, pls = w.plannings || {};
    const ids = Object.keys(boards).sort(function (a, b) { return (boards[b].created || 0) - (boards[a].created || 0); });
    const gms = w.games || {}, its = w.itsm || {};
    const all = ids.map(function (b) { return { k: "b", id: b, c: boards[b].created || 0 }; }).concat(Object.keys(pls).map(function (pid) { return { k: "p", id: pid, c: pls[pid].created || 0 }; })).concat(Object.keys(gms).map(function (gid) { return { k: "g", id: gid, c: gms[gid].created || 0 }; })).concat(Object.keys(its).map(function (x) { return { k: "i", id: x, c: its[x].created || 0 }; })).sort(function (a, b) { return b.c - a.c; });
    const ng = Object.keys(gms).length;
    const np = Object.keys(pls).length;
    const name = (w.info || {}).name || id;
    return '<section class="hub-sec ws-sec"><div class="hub-sec-head"><h2 class="no-i18n">' + esc(name) + '</h2><span class="muted small">' + ids.length + " " + t(ids.length === 1 ? "board" : "boards") + (np ? " · " + np + " " + esc(LL(np === 1 ? "planning" : "plannings", np === 1 ? "planejamento" : "planejamentos")) : "") + (ng ? " · " + ng + " " + esc(LL(ng === 1 ? "game" : "games", ng === 1 ? "partida" : "partidas")) : "") + "</span>" +
      (admin ? '<button class="btn sm ghost" data-newin="' + id + '">+ <span>New board</span></button><button class="btn sm ghost" data-newplan="' + id + '">' + (window.CMIcon ? window.CMIcon("planning", 14) : "") + " " + esc(LL("New planning", "Novo planejamento")) + (window.CMNewBadge ? window.CMNewBadge("planning") : "") + '</button>' + (wsMods(w).indexOf("game") < 0 ? "" : '<a class="btn sm ghost" data-newgame="' + id + '" href="../game/?new=1&ws=' + encodeURIComponent(id) + '">' + (window.CMIcon ? window.CMIcon("game", 14) : "") + " " + esc(LL("New game", "Nova partida")) + (window.CMNewBadge ? window.CMNewBadge("game") : "") + '</a>') + '<a class="btn sm ghost" data-newitsm="' + id + '" href="../itsm/?new=' + encodeURIComponent(id) + '">' + (window.CMIcon ? window.CMIcon("itsm", 14) : "") + " " + esc(LL("New service centre", "Nova central ITSM")) + (window.CMNewBadge ? window.CMNewBadge("itsm") : "") + '</a><a class="btn sm ghost" href="../admin/#ws-' + id + '">' + (window.CMIcon ? window.CMIcon("people", 14) : "") + ' <span>Manage people</span></a>' : "") +
      (isOwner(id, w) ? '<span class="own-tag">' + t("Owner") + "</span>" : "") + ((w.info || {}).area && window.PLAN_AREAS && window.PLAN_AREAS[w.info.area] && w.info.area !== "general" ? '<span class="area-tag no-i18n">' + esc(window.PLAN_AREAS[w.info.area].name) + "</span>" : "") + "</div>" +
      (all.length ? '<div class="board-grid">' + all.map(function (x) { return x.k === "b" ? boardCard(x.id, boards[x.id], tplName(boards[x.id].template)) : x.k === "g" ? gameCard(x.id, gms[x.id]) : x.k === "i" ? itsmCard(x.id, its[x.id]) : planCard(x.id, pls[x.id]); }).join("") + "</div>"
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
    bindChips();
    bindSearch();
  }
  function login() {
    el.innerHTML = '<div class="card auth-card"><h2>Sign in</h2><p class="muted">Sign in to open your workspaces or create a free account. Boards are private: only people you invite can open them.</p>' +
      '<button class="btn primary full" id="gBtn"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"/><path fill="currentColor" opacity=".75" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="currentColor" opacity=".55" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z"/><path fill="currentColor" opacity=".9" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6z"/></svg><span>Continue with Google</span></button>' +
      (window.CMCOLLAB_MS_LOGIN ? '<button class="btn full ms-btn" id="msBtn"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#f25022" d="M2 2h9.5v9.5H2z"/><path fill="#7fba00" d="M12.5 2H22v9.5h-9.5z"/><path fill="#00a4ef" d="M2 12.5h9.5V22H2z"/><path fill="#ffb900" d="M12.5 12.5H22V22h-9.5z"/></svg> ' + t("Continue with Microsoft (Office 365)") + "</button>" : "") +
      '<div class="or"><span>or</span></div>' +
      '<form id="linkForm"><label class="lbl-f">E-mail<input type="email" id="linkEmail" required placeholder="name@email.com" autocomplete="email"></label>' +
      '<button class="btn full">Send me a sign-in link</button></form><p class="muted small" id="authMsg" role="status"></p></div>';
    const msB = document.getElementById("msBtn");
    if (msB) msB.onclick = function () {
      A.signInMicrosoft().catch(function (e) {
        document.getElementById("authMsg").textContent = e.message === "NEEDS_VERIFICATION" ? t("We sent a verification link to") + " " + e.email + ". " + t("Open it once and come back to sign in.") : e.message;
      });
    };
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
      '<button class="btn" data-howto><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.9.7c0 1.7-2.4 2.1-2.4 3.8M12 17h.01"/></svg> <span>' + esc(LL("How to start", "Como começar")) + "</span></button>" +
      '<button class="btn" data-feedback><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg> <span>Give feedback</span></button>' +
      (admin ? '<a class="btn" href="../admin/">Administration</a>' : "") + '<button class="btn" id="soBtn">Sign out</button></div>';
  }
  function fmtDate(ts) { return new Date(ts).toLocaleDateString(window.MB_LOCALE || (window.MB_LANG === "pt" ? "pt-BR" : "en-GB"), { day: "2-digit", month: "short" }); }
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
  function LL(en, pt) { return window.MBL ? window.MBL(en, pt) : (window.MB_LANG === "pt" ? pt : en); }
  let FIRST_BOARD = null, WELCOME_ENTRY = null;
  function welcomeDialog(user) {
    if (document.getElementById("welDlg")) return;
    const brand = window.CMCOLLAB_BRAND || "CM Collaborator";
    const first = (user.displayName || "").split(" ")[0];
    const e = WELCOME_ENTRY, days = e && e.expires ? Math.max(0, Math.ceil((e.expires - Date.now()) / 86400000)) : null;
    const steps = [
      ["🚀", LL("Open your first board", "Abra seu primeiro quadro"), LL("Start with “1 · Start here – missions & feedback wall”: it has 5 short missions to explore everything.", "Comece pelo “1 · Comece aqui – missões e mural de feedback”: tem 5 missões curtas para explorar tudo.")],
      ["🧩", LL("Use the templates", "Use os templates"), LL("Templates button (left bar): Kanban, retrospective, PI Planning, PDCA executive meeting, architecture, cloud, data…", "Botão Templates (barra da esquerda): Kanban, retrospectiva, PI Planning, reunião executiva PDCA, arquitetura, cloud, dados…")],
      ["🟨", LL("Add and organise post-its", "Crie e organize post-its"), LL("N = post-it, T = text, F = frame, L = arrow. Drag to move; the “Tidy up” button aligns everything.", "N = post-it, T = texto, F = frame, L = seta. Arraste para mover; o botão “Organizar” alinha tudo.")],
      ["✨", LL("Try the AI assistant", "Experimente o Assistente IA"), LL("The ✨ button builds a board from your goal, suggests dynamics and analyses the results.", "O botão ✨ monta um quadro a partir do seu objetivo, sugere dinâmicas e analisa os resultados.")],
      ["👥", LL("Collaborate in real time", "Colabore em tempo real"), LL("Everyone invited sees the same board live: cursors, comments, votes and timer.", "Todos os convidados veem o mesmo quadro ao vivo: cursores, comentários, votos e cronômetro.")],
      ["💬", LL("Share your feedback", "Dê sua opinião"), LL("Before your access ends: 5 quick questions (3 minutes) with the “Give feedback” button.", "Antes de o acesso terminar: 5 perguntas rápidas (3 minutos) no botão “Dar feedback”.")]
    ];
    document.body.insertAdjacentHTML("beforeend", '<div class="modal-lite" id="welDlg"><div class="card wel-card"><div class="br-head"><div><span class="eyebrow sm">' + esc(LL("Welcome", "Boas-vindas")) + "</span><h2>" + esc(LL("Welcome to the " + brand + " beta", "Bem-vindo(a) ao beta do " + brand)) + (first ? ", <span class=\"no-i18n\">" + esc(first) + "</span>" : "") + "! 🎉</h2>" +
      '<p class="muted">' + esc(LL("Thank you for helping us test. Here is how to get the most out of it", "Obrigado por nos ajudar a testar. Veja como aproveitar ao máximo")) + (days !== null ? " – " + esc(LL("your access is active for", "seu acesso está ativo durante")) + " <b>" + days + " " + esc(LL(days === 1 ? "day" : "days", days === 1 ? "dia" : "dias")) + "</b>" : "") + '.</p></div><button class="btn sm ghost" id="welX">✕</button></div>' +
      '<ol class="wel-steps">' + steps.map(function (x) { return '<li><span class="wi">' + x[0] + "</span><div><b>" + esc(x[1]) + "</b><p>" + esc(x[2]) + "</p></div></li>"; }).join("") + "</ol>" +
      '<p class="muted small">' + esc(LL("Tip: install it on your phone – browser menu → “Add to Home screen”. Questions? Reply to the invitation e-mail.", "Dica: instale no celular – menu do navegador → “Adicionar ao tela inicial”. Dúvidas? Responda ao e-mail do convite.")) + "</p>" +
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
        ids.forEach(function (w) { const bs = wss[w].boards || {}; Object.keys(bs).forEach(function (b) { allowed[b] = { title: bs[b].title, template: bs[b].template, ws: (wss[w].info || {}).name }; }); const ps = wss[w].plannings || {}; Object.keys(ps).forEach(function (pid) { allowed[pid] = { title: ps[pid].title, method: ps[pid].method, kind: "planning", ws: (wss[w].info || {}).name }; }); const is = wss[w].itsm || {}; Object.keys(is).forEach(function (x) { allowed[x] = { title: is[x].title, kind: "itsm", ws: (wss[w].info || {}).name }; }); });
        const firstBeta = entries.filter(function (e) { return e.expires && e.expires > Date.now(); })[0];
        WELCOME_ENTRY = firstBeta || null;
        if (firstBeta && wss[firstBeta.id]) {
          const bs = Object.keys(wss[firstBeta.id].boards || {}).sort();
          FIRST_BOARD = bs.filter(function (b) { return /comece|start|^1-/.test(b); })[0] || bs[0] || null;
        }
        el.innerHTML = '<div id="annSlot"></div>' + userBar(user, admin) + accessBanner(entries) + searchBar() + startStrip(true, (function () { const own = Object.keys(wss).some(function (w) { return admin || isOwner(w, wss[w]); }); return { plan: own || !entries.length, itsm: own, game: own }; })()) + recentRows(allowed) + '<div id="gameSlot"></div>' +
          (ids.length ? ids.map(function (id) { return wsSection(id, wss[id], admin); }).join("")
            : (entries.length ? "" : '<div class="card empty-big"><h3>No boards yet</h3><p class="muted">' + t("Pick a template above to create your first workspace and board – or ask someone to invite this e-mail address.") + "</p></div>"));
        bindFeedback();
        applyView(el); window.addEventListener("hashchange", function () { applyView(el); });
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
        bindChips(wss);
        el.querySelectorAll("[data-newplan]").forEach(function (b) { b.onclick = function () { planDialog(wss, b.dataset.newplan); }; });
        el.querySelectorAll("[data-newplanm]").forEach(function (b) { b.onclick = function () { const strip = el.querySelector(".tpl-strip"); planDialog(wss, strip && strip.dataset.ws, b.dataset.newplanm); }; });
        el.querySelectorAll("[data-newin]").forEach(function (b) {
          b.onclick = function () {
            const strip = el.querySelector(".tpl-strip");
            if (strip) { strip.scrollIntoView({ behavior: "smooth", block: "center" }); strip.dataset.ws = b.dataset.newin; strip.classList.add("pulse"); setTimeout(function () { strip.classList.remove("pulse"); }, 1200); }
            el.querySelectorAll("[data-new]").forEach(function (x) { x.onclick = function () { createDialog(x.dataset.new, wss, b.dataset.newin); }; });
          };
        });
        bindSearch();
        myGamesSlot(user, wss);
        /* add-on module not licensed for that workspace: keep the button visible as a showcase ("Módulo adicional") */
        el.querySelectorAll("[data-newitsm]").forEach(function (b) {
          if (!window.CMModules) return;
          window.CMModules.has("itsm", b.dataset.newitsm).then(function (ok) { if (!ok) { b.title = LL("Add-on module – request access", "Módulo adicional – solicitar acesso"); b.classList.add("addon"); } });
        });
        el.querySelectorAll("[data-newgame]").forEach(function (b) {
          if (!window.CMModules) return;
          window.CMModules.has("game", b.dataset.newgame).then(function (ok) { if (!ok) { b.title = LL("Add-on module – request access", "Módulo adicional – solicitar acesso"); b.classList.add("addon"); } });
        });
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
