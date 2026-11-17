/* CM Collaborator – add-on modules and licensing (entitlements).
 *
 * Core (always included): whiteboards + Planning.
 * Add-on modules (sold separately, granted by the platform admin in Administração → Módulos e pacotes):
 *   itsm  – ITSM (ITIL 4)      page /itsm/?id=
 *   game  – Business Game       page /game/?id=
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
  const L = function (en, pt) { return PT() ? pt : en; };
  const LIST = [
    { id: "itsm", name: "ITSM", full: L("ITSM – service management (ITIL 4)", "ITSM – gestão de serviços (ITIL 4)"), icon: "itsm", path: "itsm/", area: "service",
      desc: L("Service desk, incidents, requests, problems, changes, SLAs and CMDB – connectable to Planning.", "Central de serviço, incidentes, requisições, problemas, mudanças, SLAs e CMDB – conectável ao Planning.") },
    { id: "game", name: "Business Game", full: L("Business Game – business simulation for education", "Business Game – simulação empresarial para educação"), icon: "game", path: "game/", area: "education",
      desc: L("Round-based business simulation for classes, customizable per institution – connectable to Planning.", "Simulação empresarial por rodadas para turmas, customizável por instituição – conectável ao Planning.") }
  ];
  const PACKAGES = [
    { id: "essencial", name: L("Essential", "Essencial"), mods: [], desc: L("Boards + Planning (core)", "Quadros + Planning (base)") },
    { id: "service", name: L("Service", "Serviços"), mods: ["itsm"], desc: L("Core + ITSM", "Base + ITSM") },
    { id: "educacao", name: L("Education", "Educação"), mods: ["game"], desc: L("Core + Business Game", "Base + Business Game") },
    { id: "empresarial", name: L("Enterprise", "Empresarial"), mods: ["itsm", "game"], desc: L("Core + all add-on modules", "Base + todos os módulos adicionais") }
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
        esc(L("This module is not included in your licence yet. Ask for access and the Digital Agile Technology team will get in touch (beta access available).", "Este módulo ainda não está incluído na sua licença. Solicite o acesso e a equipe da Digital Agile Technology entra em contato (há acesso beta disponível).")) +
        '</p><div class="mod-gate-acts"><button class="btn primary" id="modReq">' + esc(L("Request access", "Solicitar acesso")) + '</button><a class="btn" href="' + esc((window.CMCOLLAB_BASE || "../") + "workspaces/") + '">' + esc(L("Back to my boards", "Voltar para Meus quadros")) + "</a></div></div></div>";
      const b = el.querySelector("#modReq");
      if (b) b.onclick = function () { b.disabled = true; request(mod, wsId).then(function () { b.textContent = L("Request sent ✓", "Pedido enviado ✓"); }, function () { b.disabled = false; }); };
      return false;
    });
  }
  window.CMModules = { LIST: LIST, PACKAGES: PACKAGES, get: get, active: active, has: has, forWorkspace: forWorkspace, gate: gate, request: request, key: key };
})();
