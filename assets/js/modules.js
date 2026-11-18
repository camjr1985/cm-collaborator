/* CM Collaborator – add-on modules and licensing (entitlements).
 *
 * Core (always included): whiteboards + Planning.
 * Add-on modules (sold separately, granted by the platform admin in Administração → Módulos e pacotes):
 *   itsm  – ITSM (ITIL 4 and 5) page /itsm/ (list) and /itsm/?id=
 *   game  – Business Game       page /game/?id=
 *   sst   – Occupational health (Saúde Ocupacional, with SHE as a template area) page /sst/?ws=
 *
 * Data (only platform admins write – see database.rules.json):
 *   entitlements/ws/<wsId>/<mod>      = { on: true, until: ts|null, plan: "beta"|"paid"|"trial", pkg?: "empresarial"…, by, at }
 *       → company / workspace licence: every active member of that workspace may use the module there.
 *   entitlements/users/<emailKey>/<mod> = { on: true, until: ts|null, plan, by, at }
 *       → individual licence: that person may use the module in any workspace where they are a member.
 *   moduleRequests/<pushId>            = { email, name, ws, mod, t }   (anyone signed in can ask; admins read)
 *
 * API (all promise-based, safe to call on any page that loads config.js + auth.js):
 *   CMModules.LIST / CMModules.get(id)        catalog
 *   CMModules.PACKAGES                        presets used by the admin
 *   CMModules.has(mod, wsId)   → Promise<bool>   admin/owner-of-entitlement aware
 *   CMModules.forWorkspace(wsId) → Promise<{itsm:bool, game:bool}>
 *   CMModules.gate(mod, wsId, el) → Promise<bool>  renders the "module not licensed" screen into el when false
 *   CMModules.request(mod, wsId) → Promise         records an access request for the admin
 *   CMModules.active(grant)    → bool          grant on and not expired
 */
(function () {
  "use strict";
  const PT = function () { return window.MB_LANG !== "en"; };
  const L = function (en, pt) { return window.MBL ? window.MBL(en, pt) : (PT() ? pt : en); };
  const LIST = [
    { id: "itsm", name: "ITSM", full: L("ITSM – service management (ITIL 4 and ITIL 5)", "ITSM – gestão de serviços (ITIL 4 e ITIL 5)"), icon: "itsm", path: "itsm/", area: "service",
      desc: L("Service desk, incidents, requests, problems, changes, SLAs and CMDB – connectable to Planning.", "Central de serviço, incidentes, requisições, problemas, mudanças, SLAs e CMDB – conectável ao Planning.") },
    { id: "game", name: "Business Game", full: L("Business Game – business simulation for education", "Business Game – simulação empresarial para educação"), icon: "game", path: "game/", area: "education",
      desc: L("Round-based business simulation for classes, customizable per institution – connectable to Planning.", "Simulação empresarial por rodadas para turmas, customizável por instituição – conectável ao Planning.") },
    { id: "sst", name: L("Occupational health", "Saúde Ocupacional"), full: L("Occupational health and SHE", "Saúde Ocupacional e SHE"), icon: "sst", path: "sst/", area: "ohs",
      desc: L("Accidents, CAT, near misses, PPE, occupational exams, absences, environmental incidents, action plans, FR/SR indicators and SST/SHE planning templates – separate from the IT service desk.", "Acidentes, CAT, quase-acidentes, EPI, exames ocupacionais, afastamentos, incidentes ambientais, planos de ação, indicadores TF/TG e templates de planejamento de SST/SHE – separado da central de TI.") }
  ];
  const PACKAGES = [
    { id: "essencial", name: L("Essential", "Essencial"), mods: [], desc: L("Boards + Planning (core)", "Quadros + Planning (base)") },
    { id: "service", name: L("Service", "Serviços"), mods: ["itsm"], desc: L("Core + ITSM", "Base + ITSM") },
    { id: "educacao", name: L("Education", "Educação"), mods: ["game"], desc: L("Core + Business Game", "Base + Business Game") },
    { id: "sst", name: L("Health and safety", "Saúde e segurança"), mods: ["sst"], desc: L("Core + Occupational health", "Base + Saúde Ocupacional") },
    { id: "empresarial", name: L("Enterprise", "Empresarial"), mods: ["itsm", "game", "sst"], desc: L("Core + all add-on modules", "Base + todos os módulos adicionais") }
  ];
  function get(id) { return LIST.find(function (m) { return m.id === id; }) || null; }
  function active(g) { return !!(g && g.on && (!g.until || g.until > Date.now())); }
  function key(e) { return String(e || "").trim().toLowerCase().replace(/\./g, ","); }
  function db() { return window.firebase && window.firebase.database ? window.firebase.database() : null; }
  function user() { return window.firebase && window.firebase.auth ? window.firebase.auth().currentUser : null; }
  function once(path) { const d = db(); if (!d) return Promise.resolve(null); return d.ref(path).once("value").then(function (s) { return s.val(); }, function () { return null; }); }
  let cacheAdmin = null;
  function isAdmin() {
    if (cacheAdmin) return cacheAdmin;
    const A = window.CMAuth;
    cacheAdmin = A && A.isAdmin ? A.isAdmin().catch(function () { return false; }) : Promise.resolve(false);
    return cacheAdmin;
  }
  function mine() { const u = user(); return u ? once("entitlements/users/" + key(u.email)) : Promise.resolve(null); }
  function forWorkspace(wsId) {
    return Promise.all([isAdmin(), mine(), wsId ? once("entitlements/ws/" + wsId) : Promise.resolve(null)]).then(function (r) {
      const out = {};
      LIST.forEach(function (m) { out[m.id] = !!r[0] || active((r[1] || {})[m.id]) || active((r[2] || {})[m.id]); });
      return out;
    });
  }
  function has(mod, wsId) { return forWorkspace(wsId).then(function (o) { return !!o[mod]; }); }
  function request(mod, wsId) {
    const u = user(), d = db(); if (!u || !d) return Promise.reject(new Error("sign in"));
    return d.ref("moduleRequests").push({ email: u.email, name: u.displayName || "", ws: wsId || "", mod: mod, t: window.firebase.database.ServerValue.TIMESTAMP });
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function gate(mod, wsId, el) {
    return has(mod, wsId).then(function (ok) {
      if (ok || !el) return ok;
      const m = get(mod) || { name: mod, full: mod, desc: "" };
      el.innerHTML = '<div class="mod-gate"><div class="mod-gate-card"><span class="mod-gate-tag">' + esc(L("Add-on module", "Módulo adicional")) + "</span><h1>" + esc(m.full) + "</h1><p>" + esc(m.desc) + "</p><p>" +
        esc(L("This module is not part of your licence yet. Contact the CM Collaborator administration to purchase it.", "Este módulo ainda não faz parte da sua licença. Entre em contato com a administração do CM Collaborator para fazer a aquisição.")) +
        '</p><div class="mod-gate-acts"><button class="btn primary" id="modReq">' + esc(L("Contact the administration", "Falar com a administração")) + '</button><a class="btn" href="' + esc((window.CMCOLLAB_BASE || "../") + "workspaces/") + '">' + esc(L("Back to my boards", "Voltar para Meus quadros")) + "</a></div></div></div>";
      const b = el.querySelector("#modReq");
      if (b) b.onclick = function () { b.disabled = true; request(mod, wsId).then(function () { b.textContent = L("Request sent ✓", "Pedido enviado ✓"); }, function () { b.disabled = false; }); };
      return false;
    });
  }
  /* ---------- "Módulos" switcher in the top bar (like the Jira / Google app switcher) ----------
     Colaboração and Planejamento are always included; ITSM and Business Game open when licensed,
     otherwise they show the "contact the CM Collaborator administration" dialog. */
  const BASE = (function () { const sc = document.currentScript && document.currentScript.src; return sc ? sc.replace(/assets\/js\/modules\.js.*$/, "") : "../"; })();
  const EMO = { collab: "🧩", planning: "🗺️", itsm: "🛠️", game: "🎲", sst: "⛑️" };
  function apps() {
    return [
      { id: "collab", name: L("Collaboration", "Colaboração"), desc: L("AI whiteboards, templates and live workshops", "Quadros colaborativos com IA, templates e dinâmicas ao vivo"), core: true, icon: "board", href: "workspaces/#colaboracao" },
      { id: "planning", name: L("Planning", "Planejamento"), desc: L("Roadmap, Waterfall, Scrum, Kanban, OKRs and reports", "Roadmap, Waterfall, Scrum, Kanban, OKRs e relatórios"), core: true, icon: "planning", href: "workspaces/#planejamento" },
      { id: "itsm", name: "ITSM", desc: L("Service management (ITIL 4)", "Gestão de serviços (ITIL 4)"), icon: "itsm", href: "itsm/" },
      { id: "game", name: "Business Game", desc: L("Business simulation for education", "Simulação empresarial para educação"), icon: "game", href: "workspaces/#business-game" },
      { id: "sst", name: L("Occupational health", "Saúde Ocupacional"), desc: L("Health, safety and SHE (environment)", "Saúde, segurança e SHE (meio ambiente)"), icon: "sst", href: "sst/" }
    ];
  }
  const pageOk = {};
  function pageExists(path) {
    if (pageOk[path] === undefined) pageOk[path] = fetch(BASE + path, { method: "HEAD", cache: "no-store" }).then(function (r) { return r.ok; }, function () { return false; });
    return pageOk[path];
  }
  let accessP = null;
  function access() { // → { admin, itsm: {ok, ws: []}, game: {ok, ws: []} }
    if (accessP) return accessP;
    const u = user();
    if (!u) return Promise.resolve({ admin: false });
    accessP = Promise.all([isAdmin(), mine(), once("userWorkspaces/" + key(u.email))]).then(function (r) {
      const wsIds = Object.keys(r[2] || {}).filter(function (w) { const x = r[2][w] || {}; return !x.expires || x.expires > Date.now(); });
      return Promise.all(wsIds.map(function (w) { return once("entitlements/ws/" + w).then(function (e) { return [w, e || {}]; }); })).then(function (rows) {
        const out = { admin: !!r[0] };
        LIST.forEach(function (m) {
          const ws = rows.filter(function (x) { return active(x[1][m.id]); }).map(function (x) { return x[0]; });
          out[m.id] = { ok: !!r[0] || active((r[1] || {})[m.id]) || ws.length > 0, ws: ws.length ? ws : wsIds };
        });
        return out;
      });
    });
    return accessP;
  }
  /* professional line icons for the modules (24px grid, 1.8 stroke, currentColor) */
  const MOD_SVG = {
    collab: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><rect x="6" y="7" width="4" height="4" rx=".8"/><rect x="12" y="7" width="6" height="2" rx=".8"/><path d="M12 12h4"/>',
    planning: '<path d="M4 4v16h16"/><rect x="7" y="6" width="8" height="3" rx="1"/><rect x="10" y="11" width="8" height="3" rx="1"/><path d="M15.5 17.5l1.5-1.5 1.5 1.5-1.5 1.5z"/>',
    itsm: '<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M19 19c0 1.5-2 2.5-5 2.5"/>',
    sst: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="M12 8.5v6M9 11.5h6"/>',
    game: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8.5 20h7M10 17h4v3h-4z"/>'
  };
  function modIcon(id, size) { const p = MOD_SVG[id]; if (!p) return ""; const z = size || 18; return '<svg viewBox="0 0 24 24" width="' + z + '" height="' + z + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + "</svg>"; }
  function icon(a) { return modIcon(a.id, 20) || EMO[a.id]; }
  function contact(mod, wsId) {
    const m = get(mod) || { id: mod, full: mod, desc: "" };
    const d = document.createElement("div"); d.className = "modsw-dlg"; d.setAttribute("role", "dialog");
    d.innerHTML = '<div class="modsw-dlg-card"><span class="mod-gate-tag">' + esc(L("Add-on module", "Módulo adicional")) + "</span><h2><span class=\"modsw-hic\" data-m=\"" + mod + "\">" + modIcon(mod, 20) + "</span> " + esc(m.full) + "</h2><p>" +
      esc(L("This module is not part of your licence yet. Contact the CM Collaborator administration to purchase it.", "Este módulo ainda não faz parte da sua licença. Entre em contato com a administração do CM Collaborator para fazer a aquisição.")) +
      '</p><p class="modsw-muted">' + esc(m.desc) + '</p><div class="mod-gate-acts"><button class="modsw-b primary" data-req>' + esc(L("Contact the administration", "Falar com a administração")) + '</button><button class="modsw-b" data-x>' + esc(L("Close", "Fechar")) + "</button></div></div>";
    document.body.appendChild(d);
    const close = function () { d.remove(); };
    d.addEventListener("click", function (e) { if (e.target === d) close(); });
    d.querySelector("[data-x]").onclick = close;
    const r = d.querySelector("[data-req]");
    r.onclick = function () { r.disabled = true; request(mod, wsId || "").then(function () { r.textContent = L("Request sent ✓ – we will contact you", "Pedido enviado ✓ – vamos entrar em contato"); }, function () { r.disabled = false; }); };
  }
  function soon(name) {
    const d = document.createElement("div"); d.className = "modsw-dlg";
    d.innerHTML = '<div class="modsw-dlg-card"><h2>' + esc(name) + "</h2><p>" + esc(L("Your licence is active. The module is being finished and opens here as soon as it is published.", "Sua licença está ativa. O módulo está em finalização e abre aqui assim que for publicado.")) + '</p><div class="mod-gate-acts"><button class="modsw-b primary" data-x>OK</button></div></div>';
    document.body.appendChild(d);
    d.addEventListener("click", function (e) { if (e.target === d || e.target.hasAttribute("data-x")) d.remove(); });
  }
  function rows(acc, avail) {
    return apps().map(function (a) {
      let chip, cls = "", ok = true;
      if (a.core) chip = L("Included", "Incluído");
      else if (acc.admin) chip = L("Administrator", "Administrador");
      else if (acc[a.id] && acc[a.id].ok) chip = L("Licensed", "Licenciado");
      else { chip = "🔒 " + L("Add-on", "Adicional"); cls = " locked"; ok = false; }
      if (a.id === "itsm" && ok && !avail.itsm) chip += " · " + L("soon", "em breve");
      return '<button type="button" role="menuitem" class="modsw-row' + cls + '" data-app="' + a.id + '"><span class="modsw-ic" data-m="' + a.id + '">' + icon(a) + '</span><span class="modsw-t"><b>' + esc(a.name) + "</b><small>" + esc(a.desc) + '</small></span><span class="modsw-chip' + (ok ? "" : " no") + '">' + esc(chip) + "</span></button>";
    }).join("");
  }
  function mountInto(host, after) {
    if (!host || host.querySelector(".modsw")) return;
    const w = document.createElement("div"); w.className = "modsw no-i18n";
    w.innerHTML = '<button type="button" class="modsw-btn" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><g fill="currentColor"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></g></svg><span>' + esc(L("Modules", "Módulos")) + '</span><span class="modsw-car" aria-hidden="true">▾</span></button><div class="modsw-pop" role="menu" hidden></div>';
    if (after && after.parentNode === host) host.insertBefore(w, after.nextSibling); else host.insertBefore(w, host.firstChild);
    const btn = w.querySelector(".modsw-btn"), pop = w.querySelector(".modsw-pop");
    function close() { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); }
    btn.onclick = function (e) {
      e.stopPropagation();
      if (!pop.hidden) return close();
      pop.hidden = false; btn.setAttribute("aria-expanded", "true");
      pop.innerHTML = '<div class="modsw-h">' + esc(L("Modules", "Módulos")) + '</div><div class="modsw-load">' + esc(L("Loading…", "Carregando…")) + "</div>";
      Promise.all([access(), pageExists("itsm/")]).then(function (r) {
        const acc = r[0], avail = { itsm: r[1] };
        pop.innerHTML = '<div class="modsw-h">' + esc(L("Modules", "Módulos")) + "<small>" + esc(acc.admin ? L("Main administrator · full access", "Administrador principal · acesso total") : L("What your licence includes", "O que a sua licença inclui")) + "</small></div>" + rows(acc, avail) +
          (acc.admin ? '<a class="modsw-foot" href="' + BASE + 'admin/#modulos">' + esc(L("Manage licences", "Gerenciar licenças")) + " →</a>" : "");
        pop.querySelectorAll("[data-app]").forEach(function (b) { b.onclick = function () {
          const a = apps().find(function (x) { return x.id === b.dataset.app; }); close();
          if (!a.core && !acc.admin && !(acc[a.id] && acc[a.id].ok)) return contact(a.id, ((acc[a.id] || {}).ws || [])[0]);
          if (a.id === "itsm" && !avail.itsm) return soon(a.name);
          const ws = ((acc[a.id] || {}).ws || [])[0];
          const url = BASE + a.href + ((a.id === "itsm" || a.id === "sst") && ws ? "?ws=" + encodeURIComponent(ws) : "");
          if (location.href.split("#")[0] === url.split("#")[0] && url.indexOf("#") > 0) { location.hash = url.split("#")[1]; return; }
          location.href = url;
        }; });
      });
    };
    document.addEventListener("click", function (e) { if (!w.contains(e.target)) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }
  function mount() {
    if (!user()) return;
    const nav = document.querySelector("header.nav .nav-in");
    if (nav) mountInto(nav, nav.querySelector(".nav-links"));
    const pl = document.querySelector(".pl-top"); if (pl) mountInto(pl, pl.querySelector(".pl-back"));
    const gm = document.querySelector(".gm-top"); if (gm) mountInto(gm, gm.querySelector(".gm-back"));
  }
  function start() {
    const A = window.CMAuth; if (!A || !A.enabled) return;
    A.ready().then(function () { listen(); }, function () { /* offline */ });
  }
  function listen() {
    try { window.firebase.auth().onAuthStateChanged(function (u) { accessP = null; if (u) mount(); else document.querySelectorAll(".modsw").forEach(function (x) { x.remove(); }); }); } catch (e) { return; }
    // planning and game pages redraw their top bar: re-attach the switcher when it disappears
    new MutationObserver(function () { if (user() && ((document.querySelector(".pl-top") && !document.querySelector(".pl-top .modsw")) || (document.querySelector(".gm-top") && !document.querySelector(".gm-top .modsw")))) mount(); }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else setTimeout(start, 0);

  window.CMModules = { LIST: LIST, PACKAGES: PACKAGES, get: get, active: active, has: has, forWorkspace: forWorkspace, gate: gate, request: request, key: key, access: access, contact: contact, apps: apps, icon: modIcon };
})();
