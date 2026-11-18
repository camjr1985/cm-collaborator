/* CM Collaborator – ITSM module (ITIL 4 and ITIL Version 5). Add-on module, licensed separately (CMModules "itsm").
 * Page /itsm/ lists the service centres; /itsm/?id=<id> opens one (&rec=<recordId> opens a record).
 * Data: itsm/<id>/{ info{title, ws, area, owner, created, createdBy, framework, members{<k>:{email,name,role,via?,expires?}}, workspaces{}, plans{}},
 *                   data{settings, counters, records, comments, notes, history, catalog, kb, cmdb, sla},
 *                   mine/<emailKey>/<recordId> }
 *       userItsm/<emailKey>/<id> = {title, role}   ·   workspaces/<ws>/itsm/<id> = {title, created, home?}
 * Roles: manager (platform admin, owner of the home workspace, creator, members with role manager) ·
 *        agent (editors of the home workspace, members with role agent) · requester (other members, people from connected workspaces).
 * Access is enforced by database.rules.json (licence on the home workspace + role). Pure logic lives in itsm-core.js (window.ITSM). */
(function () {
  "use strict";
  const A = window.CMAuth, I = window.ITSM;
  const app = document.getElementById("app");
  const Q = new URLSearchParams(location.search);
  const ID = (Q.get("id") || "").toLowerCase();
  const DAY = 86400000;
  const IC = function (n, sz) { return window.CMIcon ? window.CMIcon(n, sz || 16) : ""; };
  const KN = I.KINDS;

  let db, me, MEK, isAdm = false, info = null, wsInfo = {}, wsMembers = {}, role = "requester";
  let data = { settings: {}, records: {}, comments: {}, notes: {}, history: {}, catalog: {}, kb: {}, cmdb: {}, sla: {}, counters: {} };
  let view = null, openRec = null, filter = { q: "", queue: "mine" }, dragging = false, pendingRender = false, licensed = true;
  let mineIds = {}, mineRecs = {}, mineComments = {}, createdKeys = {};

  /* ---------------- helpers ---------------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function TS() { return window.firebase.database.ServerValue.TIMESTAMP; }
  function now() { return Date.now(); }
  function toast(msg) {
    let n = document.getElementById("toast");
    if (!n) { n = document.createElement("div"); n.id = "toast"; n.className = "pl-toast no-i18n"; n.setAttribute("role", "status"); document.body.appendChild(n); }
    n.textContent = msg; n.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { n.classList.remove("show"); }, 3000);
  }
  function fail(e) { console.warn(e); toast((e && e.message) || "Algo deu errado"); }
  function slug(s) { return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40); }
  function rnd() { return Math.random().toString(36).slice(2, 6); }
  function pushId() { return db.ref().push().key; }
  function fmtDT(t) { if (!t) return ""; return new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  function fmtD(t) { if (!t) return ""; return new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }); }
  function ago(t) {
    if (!t) return ""; const m = Math.round((now() - t) / 60000);
    if (m < 1) return "agora"; if (m < 60) return "há " + m + " min"; const h = Math.round(m / 60); if (h < 24) return "há " + h + " h"; const d = Math.round(h / 24); return "há " + d + (d === 1 ? " dia" : " dias");
  }
  function toLocalInput(t) { if (!t) return ""; const d = new Date(t - new Date(t).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); }
  function fromLocalInput(v) { return v ? new Date(v).getTime() : null; }
  function S() { return data.settings || {}; }
  function cal() { return S().calendar || I.CAL_DEFAULT; }
  function fw() { return (info && info.framework) || "both"; }
  function recs() { return Object.keys(data.records || {}).map(function (k) { return Object.assign({ id: k }, data.records[k]); }); }
  function rec(id) { return id && data.records && data.records[id] ? Object.assign({ id: id }, data.records[id]) : (mineRecs[id] ? Object.assign({ id: id }, mineRecs[id]) : null); }
  function isAgent() { return role === "agent" || role === "manager"; }
  function isMgr() { return role === "manager"; }
  function list(obj) { return Object.keys(obj || {}).map(function (k) { return Object.assign({ id: k }, obj[k]); }); }
  function byName(a, b) { return String(a.name || a.title || "").localeCompare(String(b.name || b.title || ""), "pt-BR"); }
  function active(m) { return !!m && (!m.expires || m.expires > now()); }
  function modal(html, bind, wide) {
    const w = document.createElement("div"); w.className = "pl-modal it-modal no-i18n"; w.innerHTML = '<div class="pl-card' + (wide ? " it-wide" : "") + '" role="dialog" aria-modal="true">' + html + "</div>";
    document.body.appendChild(w);
    function close() { w.remove(); }
    w.onclick = function (e) { if (e.target === w) close(); };
    w.querySelectorAll("[data-close]").forEach(function (b) { b.onclick = close; });
    if (bind) bind(w, close);
    const f = w.querySelector("input:not([type=checkbox]):not([type=radio]),textarea,select"); if (f && !("ontouchstart" in window)) setTimeout(function () { f.focus(); }, 30);
    return w;
  }
  function confirmBox(title, text, okLabel, danger) {
    return new Promise(function (res) {
      modal("<h2>" + esc(title) + "</h2><p>" + esc(text) + '</p><div class="pl-row-end"><button class="pl-btn" data-close>Cancelar</button><button class="pl-btn primary' + (danger ? " danger" : "") + '" id="cbOk">' + esc(okLabel || "Confirmar") + "</button></div>", function (w, close) {
        w.querySelector("#cbOk").onclick = function () { close(); res(true); };
        w.querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", function () { res(false); }); });
      });
    });
  }
  function opt(v, label, sel) { return '<option value="' + esc(v) + '"' + (String(sel) === String(v) ? " selected" : "") + ">" + esc(label) + "</option>"; }

  /* people */
  function people() {
    const out = {};
    Object.keys(wsMembers || {}).forEach(function (k) { const m = wsMembers[k]; if (active(m)) out[k] = { k: k, email: m.email, name: m.name || (m.email || "").split("@")[0], agent: m.role === "editor", via: "" }; });
    if (wsInfo.owner && !out[wsInfo.owner]) out[wsInfo.owner] = { k: wsInfo.owner, email: wsInfo.owner.replace(/,/g, "."), name: wsInfo.ownerName || wsInfo.owner.replace(/,/g, ".").split("@")[0], agent: true };
    if (wsInfo.owner && out[wsInfo.owner]) { out[wsInfo.owner].agent = true; out[wsInfo.owner].mgr = true; }
    const im = (info && info.members) || {};
    Object.keys(im).forEach(function (k) {
      const m = im[k]; if (!active(m)) return;
      const p = out[k] || (out[k] = { k: k, email: m.email, name: m.name || (m.email || "").split("@")[0], via: m.via || "" });
      if (m.role === "agent" || m.role === "manager") p.agent = true;
      if (m.role === "manager") p.mgr = true;
    });
    if (info && info.owner && out[info.owner]) { out[info.owner].agent = true; out[info.owner].mgr = true; }
    if (out[MEK] && me.displayName && out[MEK].name === (me.email || "").split("@")[0]) out[MEK].name = me.displayName;
    return out;
  }
  function agents() { const p = people(); return Object.keys(p).filter(function (k) { return p[k].agent; }).map(function (k) { return p[k]; }).sort(byName); }
  function nameOf(emailOrKey) {
    if (!emailOrKey) return ""; const k = A.key(emailOrKey), p = people()[k];
    return (p && p.name) || String(emailOrKey).replace(/,/g, ".").split("@")[0];
  }
  function initials(e) { return nameOf(e).split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(function (x) { return x[0].toUpperCase(); }).join("") || "?"; }
  function avatar(e) { return e ? '<span class="it-av" title="' + esc(nameOf(e)) + '">' + esc(initials(e)) + "</span>" : '<span class="it-av none" title="Sem responsável">–</span>'; }
  function groups() { return list(S().groups).sort(byName); }
  function groupName(g) { return ((S().groups || {})[g] || {}).name || ""; }
  /* service areas (TI, SOC, RH, Facilities…) created from templates (ITSM.AREA_TEMPLATES) – data/areas/<id> */
  function areas() { return list(data.areas).sort(function (a, b) { return (a.order || 0) - (b.order || 0) || byName(a, b); }); }
  function areaName(a) { const x = (data.areas || {})[a]; return x ? x.name : ""; }
  function inArea(r) { return !filter.area || (r.area || "") === filter.area; }
  function areaCal(a) { const x = (data.areas || {})[a]; return x && x.calendar ? x.calendar : cal(); }
  function isTicket(r) { return r.kind === "incident" || r.kind === "request" || r.kind === "security"; }
  function areaSelect(name, cur, withAll) {
    const as = areas(); if (!as.length) return "";
    return '<select name="' + name + '">' + (withAll ? opt("", "Todas as áreas", cur || "") : opt("", "Geral", cur || "")) + as.map(function (a) { return opt(a.id, a.name, cur || ""); }).join("") + "</select>";
  }
  /* build the database update that adds an area from a template (groups, categories, services, offerings, calendar) */
  function areaFromTemplate(tid, aid, settingsNow, catalogNow) {
    const T = I.AREA_TEMPLATES[tid]; if (!T) return {};
    const u = {}, G = (settingsNow && settingsNow.groups) || {}, gmap = {};
    aid = aid || tid;
    Object.keys(T.groups).forEach(function (g) { const gid = G[g] && G[g].area !== aid ? aid + "_" + g : g; gmap[g] = gid; u["data/settings/groups/" + gid] = { name: T.groups[g], area: aid }; });
    const fixTasks = function (t) { return String(t || "").split("\n").map(function (l) { const m = l.match(/^([\w-]+)\s*:\s*(.+)$/); return m && gmap[m[1]] ? gmap[m[1]] + ": " + m[2] : l; }).join("\n"); };
    T.categories.forEach(function (c, i) { u["data/catalog/categories/" + aid + "_c" + i] = { name: c, area: aid }; });
    const svcIds = [];
    T.services.forEach(function (x, i) { const sid = aid + "_s" + i; svcIds.push(sid); u["data/catalog/services/" + sid] = { name: x[0], desc: x[1], group: gmap[x[2]] || null, status: "live", kind: "service", area: aid }; });
    T.offerings.forEach(function (x, i) {
      const o = { name: x[0], kind: x[1], service: x[2] === "" ? null : svcIds[x[2]] || null, desc: x[3], approval: !!x[4], form: x[5] || null, tasks: fixTasks(x[6]) || null, area: aid, order: (i + 1) * 10 };
      u["data/catalog/offerings/" + aid + "_o" + i] = o;
    });
    const calObj = T.calendar === "24x7" ? { mode: "24x7", days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59", tz: -180 } : { mode: "business", days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00", tz: -180 };
    u["data/areas/" + aid] = { name: T.name, template: tid, icon: T.icon, color: T.color, calendar: calObj, soc: !!T.soc, order: Date.now() % 100000 };
    void catalogNow;
    return u;
  }
  function svcName(s) { const x = ((data.catalog || {}).services || {})[s] || ((data.catalog || {}).products || {})[s]; return x ? x.name : ""; }
  function ciName(c) { const x = ((data.cmdb || {}).cis || {})[c]; return x ? x.name : ""; }

  /* e-mail notifications through the platform notifier (Apps Script, Digital Agile account) */
  function notify(kind, extra) {
    const url = window.CMCOLLAB_MAILER; if (!url || S().emails === false) return Promise.resolve(null);
    return window.firebase.auth().currentUser.getIdToken().then(function (tok) {
      return fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ idToken: tok, kind: kind, itsm: ID, ws: info && info.ws, lang: "pt", brand: window.CMCOLLAB_BRAND || "" }, extra || {})) });
    }).then(function (r) { return r.json(); }).then(function (j) { if (j && !j.ok) console.info("notifier:", kind, j.error); return j; }).catch(function (e) { console.info("notifier:", e.message); return null; });
  }

  /* chips */
  function prioChip(p) { const x = I.PRIO[p] || I.PRIO.P3; return p ? '<span class="it-prio" style="--c:' + x.color + '">' + esc(p) + "</span>" : ""; }
  function kindChip(k) { const x = KN[k] || KN.incident; return '<span class="it-kind" style="--c:' + x.color + '">' + IC(x.icon, 13) + " " + esc(x.name) + "</span>"; }
  function stChip(r) { const s = I.status(r.kind, r.status); return '<span class="it-st c-' + s.cat + '">' + esc(s.name) + "</span>"; }
  function vcChips(r) {
    const v = I.valueChain(r), f = fw(), out = [];
    if (f !== "itil5") out.push('<span class="it-vc" title="Cadeia de valor de serviço (ITIL 4)">ITIL 4 · ' + esc(v.n4) + "</span>");
    if (f !== "itil4") out.push('<span class="it-vc v5" title="Ciclo de vida de produtos e serviços (ITIL 5)">ITIL 5 · ' + esc(v.n5) + "</span>");
    return out.join("");
  }
  function slaChip(r, which) {
    const k = I.clock(r, now(), areaCal(r.area)); if (!k) return "";
    const x = k[which]; if (!x) return "";
    const lbl = which === "resp" ? (r.kind === "security" ? "Triagem" : "1ª resposta") : which === "contain" ? "Contenção" : "Resolução";
    let txt;
    if (x.finished) txt = x.breached ? "violado" : "cumprido";
    else if (k.paused && which === "res") txt = "pausado";
    else txt = x.breached ? "violado " + I.fmtLeft(x.left) : I.fmtLeft(x.left);
    return '<span class="it-sla s-' + (k.paused && !x.finished && which === "res" ? "pause" : x.color) + '" title="SLA de ' + lbl + '">' + IC("clock", 12) + " " + esc(lbl) + ": " + esc(txt) + "</span>";
  }
  function slaDot(r) {
    if (!isTicket(r)) return "";
    const k = I.clock(r, now(), areaCal(r.area)); if (!k || !k.res) return "";
    const c = k.res.finished ? (k.res.breached ? "red" : "green") : k.paused ? "pause" : k.res.color;
    return '<span class="it-dot s-' + c + '" title="SLA: ' + (k.res.finished ? (k.res.breached ? "violado" : "cumprido") : k.paused ? "pausado" : I.fmtLeft(k.res.left)) + '"></span>';
  }

  /* ---------------- boot ---------------- */
  function gate(title, text, extra) {
    app.innerHTML = '<div class="pl-gate"><span class="pl-logo">CM</span><h1>' + esc(title) + "</h1><p>" + esc(text) + "</p>" + (extra || '<a class="pl-btn primary" href="../workspaces/">Ir para Meus quadros</a>') + "</div>";
  }
  function start() {
    if (!A || !A.enabled) return gate("É preciso fazer login", "O ITSM precisa do ambiente online.");
    A.ready().then(function (user) {
      if (!user) return gate("Faça login para continuar", "Abra “Meus quadros”, entre com o e-mail convidado e volte a este link.");
      me = user; db = A.db(); MEK = A.key(user.email);
      return A.isAdmin().then(function (adm) { isAdm = adm; return ID ? openCentral() : centralsPage(); });
    }).catch(fail);
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      const m = document.querySelectorAll(".pl-modal"); if (m.length) { m[m.length - 1].remove(); return; }
      closeDrawer();
    });
  }

  /* ---------------- /itsm/ : my service centres ---------------- */
  function myWorkspaces() {
    if (isAdm) return db.ref("workspaces").once("value").then(function (s) { return s.val() || {}; });
    return db.ref("userWorkspaces/" + MEK).once("value").then(function (s) {
      const raw = s.val() || {}, ids = Object.keys(raw).filter(function (k) { const v = raw[k]; return !(v && v.expires && v.expires < now()); });
      return Promise.all(ids.map(function (id) { return db.ref("workspaces/" + id).once("value").then(function (x) { return [id, x.val()]; }, function () { return [id, null]; }); }))
        .then(function (rows) { const o = {}; rows.forEach(function (r) { if (r[1]) o[r[0]] = r[1]; }); return o; });
    });
  }
  function centralsPage() {
    if (window.CMMarkSeen) window.CMMarkSeen("itsm");
    document.title = "Gestão de serviços (ITSM) · " + (window.CMCOLLAB_BRAND || "CM Collaborator");
    Promise.all([myWorkspaces(), db.ref("userItsm/" + MEK).once("value").then(function (s) { return s.val() || {}; }, function () { return {}; })]).then(function (r) {
      const wss = r[0], extra = r[1], cards = {}, owned = [];
      Object.keys(wss).forEach(function (w) {
        const x = wss[w] || {}, nm = (x.info || {}).name || w;
        if (isAdm || (x.info || {}).owner === MEK) owned.push({ id: w, name: nm });
        Object.keys(x.itsm || {}).forEach(function (c) { cards[c] = Object.assign({ ws: nm }, x.itsm[c]); });
      });
      Object.keys(extra).forEach(function (c) { if (!cards[c]) cards[c] = Object.assign({ ws: "Conectada" }, extra[c]); });
      return Promise.all(owned.map(function (o) { return window.CMModules ? window.CMModules.has("itsm", o.id).then(function (ok) { o.lic = ok; return o; }) : Promise.resolve(Object.assign(o, { lic: isAdm })); }))
        .then(function (own) { renderCentrals(cards, own.sort(byName)); });
    }).catch(fail);
  }
  function renderCentrals(cards, owned) {
    const ids = Object.keys(cards).sort(function (a, b) { return (cards[b].created || 0) - (cards[a].created || 0); });
    const canCreate = owned.filter(function (o) { return o.lic; });
    const pre = Q.get("new");
    app.innerHTML = '<header class="pl-top it-top"><a class="pl-back" href="../workspaces/" aria-label="Voltar">' + IC("back", 18) + '</a><span class="pl-logo">CM</span><div class="pl-title"><h1>Gestão de serviços</h1><span class="pl-ws">ITSM · ITIL 4 e ITIL 5 · módulo adicional</span></div><div class="pl-actions">' +
      (canCreate.length ? '<button class="pl-btn primary" id="newC">' + IC("plus", 15) + " Nova central de serviços</button>" : "") + "</div></header>" +
      '<main class="it-main it-home">' +
      '<section class="it-hero"><div><span class="it-eyebrow">' + IC("itsm", 15) + " Módulo adicional " + (window.CMNewBadge ? window.CMNewBadge("itsm") : "") + "</span><h2>Central de serviços com ITIL 4 e ITIL 5</h2>" +
      "<p>Portal do solicitante, incidentes, requisições, problemas, mudanças, SLAs, catálogo, base de conhecimento e CMDB, conectados aos seus workspaces e planejamentos.</p></div>" +
      '<button class="pl-btn" id="itHelp">' + IC("help", 15) + " Como funciona</button></section>" +
      (ids.length ? '<h3 class="it-h3">Minhas centrais <span class="it-count">' + ids.length + '</span></h3><div class="it-cgrid">' + ids.map(function (c) {
        const x = cards[c];
        return '<a class="it-ccard" href="./?id=' + encodeURIComponent(c) + '"><span class="it-cic">' + IC("itsm", 22) + '</span><b class="no-i18n">' + esc(x.title || c) + '</b><span class="muted small">' + esc(x.ws || "") + (x.home === false ? " · conectada" : "") + "</span></a>";
      }).join("") + "</div>" : '<div class="it-empty">' + IC("itsm", 28) + "<p>" + (canCreate.length ? "Nenhuma central ainda. Crie a primeira e comece pelo catálogo de serviços de exemplo." : "Você ainda não participa de nenhuma central de serviços.") + "</p></div>") +
      (owned.length && !canCreate.length ? '<div class="it-upsell"><b>O ITSM é um módulo adicional.</b><p>Ele não está incluído na licença dos seus workspaces. Solicite o acesso e a equipe da Digital Agile Technology entra em contato (há acesso de teste).</p><button class="pl-btn primary" id="itReq">Solicitar acesso</button></div>' : "") +
      (owned.length && canCreate.length < owned.length && canCreate.length ? '<p class="muted small">Alguns dos seus workspaces não têm o módulo ITSM na licença: ' + esc(owned.filter(function (o) { return !o.lic; }).map(function (o) { return o.name; }).join(", ")) + ".</p>" : "") +
      "</main>";
    const nb = document.getElementById("newC"); if (nb) nb.onclick = function () { createCentral(canCreate); };
    document.getElementById("itHelp").onclick = helpDialog;
    const rq = document.getElementById("itReq"); if (rq) rq.onclick = function () { rq.disabled = true; window.CMModules.request("itsm", owned[0].id).then(function () { rq.textContent = "Pedido enviado ✓"; }, function (e) { rq.disabled = false; fail(e); }); };
    const wsPre = Q.get("ws"); /* from "Add-on modules" on My boards: open the create dialog only when there is nothing yet */
    if (pre && canCreate.some(function (o) { return o.id === pre; })) createCentral(canCreate, pre);
    else if (wsPre && !ids.length && canCreate.some(function (o) { return o.id === wsPre; })) createCentral(canCreate, wsPre);
  }
  function createCentral(owned, preWs) {
    modal('<h2>' + IC("itsm", 20) + ' Nova central de serviços</h2><p class="muted small">A central pertence a um workspace (licença do módulo) e pode ser conectada depois a outros workspaces e planejamentos.</p>' +
      '<form class="pl-form" id="ncF"><label>Nome<input name="title" required maxlength="80" placeholder="ex.: Central de serviços de TI" autocomplete="off"></label>' +
      "<label>Workspace (dono da licença)<select name=\"ws\">" + owned.map(function (o) { return opt(o.id, o.name, preWs || owned[0].id); }).join("") + "</select></label>" +
      '<label>Referência ITIL exibida<select name="fw">' + opt("both", "ITIL 4 e ITIL 5 (recomendado)", "both") + opt("itil4", "Só ITIL 4", "") + opt("itil5", "Só ITIL 5", "") + "</select></label>" +
      '<fieldset class="it-areasel"><legend>Áreas de atendimento (modelos – dá para mudar depois em Administração)</legend>' + Object.keys(I.AREA_TEMPLATES).map(function (k) { const T = I.AREA_TEMPLATES[k]; return '<label class="chk"><input type="checkbox" name="ar_' + k + '"' + (k === "ti" ? " checked" : "") + "> " + esc(T.name) + ' <span class="muted small">' + T.offerings.length + " ofertas · " + Object.keys(T.groups).length + " grupos" + (T.soc ? " · SLA 24×7" : "") + "</span></label>"; }).join("") + "</fieldset>" +
      '<label class="chk"><input type="checkbox" name="seed" checked> Incluir exemplos: um artigo de conhecimento e itens de configuração (CMDB)</label>' +
      '<div class="pl-row-end"><button type="button" class="pl-btn" data-close>Cancelar</button><button class="pl-btn primary">Criar central</button></div></form>', function (w, close) {
      const f = w.querySelector("#ncF");
      const qa = Q.get("area"); if (qa && f["ar_" + qa]) { Object.keys(I.AREA_TEMPLATES).forEach(function (k) { if (f["ar_" + k]) f["ar_" + k].checked = k === qa; }); if (!f.title.value) f.title.value = "Central de serviços – " + I.AREA_TEMPLATES[qa].name; } // area chosen on My boards
      f.onsubmit = function (e) {
        e.preventDefault();
        const title = f.title.value.trim(), ws = f.ws.value; if (!title) return;
        const id = (slug(title) || "itsm") + "-" + rnd(), u = {};
        const chosen = Object.keys(I.AREA_TEMPLATES).filter(function (k) { return f["ar_" + k].checked; });
        u["itsm/" + id] = { info: { title: title, ws: ws, area: "service", owner: MEK, created: TS(), createdBy: me.email, framework: f.fw.value }, data: initialData(f.seed.checked, chosen) };
        u["workspaces/" + ws + "/itsm/" + id] = { title: title, created: TS(), home: true };
        f.querySelector(".primary").disabled = true;
        db.ref().update(u).then(function () { location.href = "./?id=" + encodeURIComponent(id); }, function (err) { f.querySelector(".primary").disabled = false; fail(err); });
      };
    });
  }
  function initialData(seed, chosen) {
    const settings = {
      prefixes: { incident: "INC", request: "REQ", task: "TSK", problem: "PRB", change: "CHG", improvement: "IMP", security: "SEC" },
      matrix: I.MATRIX, calendar: { mode: "business", days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00", tz: -180 },
      autoCloseDays: 3, trend: { n: 3, days: 7 }, ai: true, emails: true, approvalRule: "all", groups: {},
      mailIn: { accept: "members", autoReply: true },
      boards: [{ id: "b1", kind: "incident", name: "Incidentes", lane: "group" }, { id: "b2", kind: "request", name: "Requisições", lane: "" }, { id: "b3", kind: "change", name: "Mudanças", lane: "" }, { id: "b4", kind: "problem", name: "Problemas", lane: "" }]
    };
    if ((chosen || []).indexOf("soc") >= 0) settings.boards.push({ id: "b5", kind: "security", name: "SOC", lane: "group" });
    const out = { settings: settings, counters: { INC: 0, REQ: 0, TSK: 0, PRB: 0, CHG: 0, IMP: 0, SEC: 0 }, sla: { defaults: I.SLA_DEFAULT, soc: I.SOC_SLA_DEFAULT }, catalog: {} };
    /* apply each chosen area template into this object */
    (chosen && chosen.length ? chosen : ["ti"]).forEach(function (k, i) {
      const u = areaFromTemplate(k, k, out.settings, out.catalog);
      Object.keys(u).forEach(function (path) {
        const ps = path.split("/").slice(1); let n = out;
        for (let x = 0; x < ps.length - 1; x++) { n[ps[x]] = n[ps[x]] || {}; n = n[ps[x]]; }
        n[ps[ps.length - 1]] = u[path];
      });
      out.areas[k].order = i;
    });
    if (seed) {
      const acc = Object.keys(out.catalog.services || {}).find(function (k) { return /acesso/i.test(out.catalog.services[k].name); });
      out.kb = { a1: { title: "Como redefinir sua senha", body: "1. Acesse o portal de senhas.\n2. Informe o seu e-mail corporativo.\n3. Siga o link recebido e crie uma senha com 12 caracteres ou mais.\n\nSe não receber o e-mail em 5 minutos, abra uma requisição “Redefinir senha”.", service: acc || null, area: acc ? "ti" : null, status: "published", created: now(), by: me.email } };
      out.cmdb = {
        cis: { ci1: { name: "Servidor de e-mail", type: "server", status: "live" }, ci2: { name: "Diretório de usuários (SSO)", type: "application", status: "live" }, ci3: { name: "Rede Wi-Fi do escritório", type: "network", status: "live" }, ci4: { name: "Firewall de borda", type: "network", status: "live" } },
        rels: { r1: { from: "ci1", type: "depends", to: "ci2" }, r2: { from: "ci3", type: "connects", to: "ci4" } }
      };
    }
    return out;
  }

  /* ---------------- open one central ---------------- */
  function openCentral() {
    /* agents read the whole info; requesters only the public parts (rules hide the member list) */
    const readInfo = db.ref("itsm/" + ID + "/info").once("value").then(function (s) { return s.val(); }, function () {
      const one = function (k) { return db.ref("itsm/" + ID + "/info/" + k).once("value").then(function (x) { return x.val(); }, function () { return null; }); };
      return Promise.all([one("title"), one("ws"), one("framework"), one("members/" + MEK)]).then(function (v) {
        if (!v[0]) return null; const o = { title: v[0], ws: v[1], framework: v[2], members: {} }; if (v[3]) o.members[MEK] = v[3]; return o;
      });
    });
    return readInfo.then(function (val) {
      info = val;
      if (!info || !info.title) return domainJoin();
      return db.ref("workspaces/" + info.ws).once("value").then(function (x) { const w = x.val() || {}; wsInfo = w.info || {}; wsMembers = w.members || {}; }, function () { wsInfo = {}; wsMembers = {}; }).then(function () {
        const wm = wsMembers[MEK], im = (info.members || {})[MEK];
        if (isAdm || wsInfo.owner === MEK || info.owner === MEK || (active(im) && im.role === "manager")) role = "manager";
        else if ((active(wm) && wm.role === "editor") || (active(im) && im.role === "agent")) role = "agent";
        else if (active(wm) || active(im)) role = "requester";
        else return domainJoin();
        const homeMember = isAdm || wsInfo.owner === MEK || active(wm);
        const lic = homeMember && window.CMModules ? window.CMModules.gate("itsm", info.ws, app) : Promise.resolve(true);
        return lic.then(function (ok) { if (!ok) return; boot(); });
      });
    }, function () { gate("Sem acesso", "Seu acesso a esta central de serviços pode ter terminado, ou a licença do módulo ITSM expirou.", '<a class="pl-btn primary" href="./">Ver minhas centrais</a>'); });
  }
  /* people from a company domain registered by the managers can join as requesters by themselves */
  function domainJoin() {
    const none = function () { gate("Sem acesso", "Seu e-mail não participa desta central de serviços, ou o acesso terminou.", '<a class="pl-btn primary" href="./">Ver minhas centrais</a>'); };
    const em = String(me.email || "").toLowerCase(), dom = em.split("@")[1] || "", dk = dom.replace(/\./g, ",");
    if (!dom || !me.emailVerified) return none();
    return db.ref("itsm/" + ID + "/info/domains/" + dk).once("value").then(function (s) {
      if (s.val() !== true) return none();
      gate("Central de serviços da sua empresa", "O seu domínio @" + dom + " está liberado nesta central. Entre como solicitante para abrir e acompanhar chamados.", '<button class="pl-btn primary" id="djoin">Entrar na central</button>');
      const b = document.getElementById("djoin"); if (!b) return;
      b.onclick = function () {
        b.disabled = true;
        const m = { email: em, name: me.displayName || em.split("@")[0], role: "requester", domain: dk, joinedAt: now() };
        db.ref("itsm/" + ID + "/info/members/" + MEK).set(m).then(function () {
          return db.ref("itsm/" + ID + "/info/title").once("value");
        }).then(function (t) {
          return db.ref("userItsm/" + MEK + "/" + ID).set({ title: t.val() || "Central de serviços", role: "requester" });
        }).then(function () { location.reload(); }, function (e) { b.disabled = false; fail(e); });
      };
    }, none);
  }
  function boot() {
    document.title = info.title + " · ITSM · " + (window.CMCOLLAB_BRAND || "CM Collaborator");
    if (window.CMMarkSeen) window.CMMarkSeen("itsm");
    try { let r = JSON.parse(localStorage.getItem("cmcollab:recent")) || []; r = r.filter(function (x) { return x.id !== ID; }); r.unshift({ id: ID, title: info.title, t: now(), kind: "itsm" }); localStorage.setItem("cmcollab:recent", JSON.stringify(r.slice(0, 12))); } catch (e) { /* ignore */ }
    try { filter.area = localStorage.getItem("cmcollab:itsm:area:" + ID) || ""; } catch (e) { /* ignore */ }
    view = (location.hash || "").slice(1) || (isAgent() ? "queue" : "portal");
    if (!isAgent() && view !== "portal") view = "portal";
    const noAccess = function (e) { console.warn(e); gate("Sem acesso", "Não foi possível ler a central. A licença do módulo ITSM pode ter expirado ou seu acesso terminou.", '<a class="pl-btn primary" href="./">Ver minhas centrais</a>'); };
    if (isAgent()) {
      db.ref("itsm/" + ID + "/info").on("value", function (s) { if (s.val()) { info = s.val(); } }, function () { /* ignore */ });
      db.ref("itsm/" + ID + "/data").on("value", function (snap) {
        data = Object.assign({ settings: {}, records: {}, comments: {}, notes: {}, history: {}, catalog: {}, kb: {}, cmdb: {}, sla: {}, counters: {} }, snap.val() || {});
        const sig = tabs().map(function (t) { return t[0]; }).join() + "|" + areas().length;
        if (!document.getElementById("view") || (sig !== boot._sig && !dragging && !document.querySelector(".pl-modal"))) { boot._sig = sig; shell(); } else if (dragging) pendingRender = true; else renderView();
        refreshDrawer();
        const want = Q.get("rec"); if (want && !boot._opened && data.records[want]) { boot._opened = 1; setTimeout(function () { openDrawer(want); }, 60); }
        autoClose();
      }, noAccess);
    } else {
      Promise.all(["settings", "catalog", "kb", "sla"].map(function (k) { return db.ref("itsm/" + ID + "/data/" + k).once("value").then(function (s) { data[k] = s.val() || {}; }); })).then(function () {
        shell();
        db.ref("itsm/" + ID + "/mine/" + MEK).on("value", function (s) {
          const ids = s.val() || {};
          Object.keys(ids).forEach(function (rid) {
            if (mineIds[rid]) return; mineIds[rid] = 1;
            db.ref("itsm/" + ID + "/data/records/" + rid).on("value", function (x) { if (x.val()) mineRecs[rid] = x.val(); else delete mineRecs[rid]; renderView(); refreshDrawer(); }, function () { /* ignore */ });
            db.ref("itsm/" + ID + "/data/comments/" + rid).on("value", function (x) { mineComments[rid] = x.val() || {}; refreshDrawer(); }, function () { /* ignore */ });
          });
          renderView();
          const want = Q.get("rec"); if (want && !boot._opened && ids[want]) { boot._opened = 1; setTimeout(function () { openDrawer(want); }, 300); }
        }, noAccess);
      }, noAccess);
    }
    window.addEventListener("hashchange", function () { const v = location.hash.slice(1); if (v && v !== view && (isAgent() || v === "portal")) { view = v; shell(); } });
    setInterval(function () { if (!dragging && !document.querySelector(".pl-modal") && !document.activeElement.matches("input,textarea,select")) renderView(); }, 60000);
    try { if (!localStorage.getItem("cmcollab:itsm:help")) { localStorage.setItem("cmcollab:itsm:help", "1"); if (isAgent()) setTimeout(helpDialog, 400); } } catch (e) { /* ignore */ }
  }
  /* incidents/requests resolved for N days close by themselves (ITIL: closure after confirmation window) */
  function autoClose() {
    if (!isAgent() || autoClose._done) return; autoClose._done = 1;
    const days = Number(S().autoCloseDays) || 0; if (!days) return;
    const u = {};
    recs().forEach(function (r) {
      if ((r.kind === "incident" || r.kind === "request") && r.status === "resolved" && r.resolvedAt && now() - r.resolvedAt > days * DAY) {
        u["records/" + r.id + "/status"] = "closed"; u["records/" + r.id + "/closedAt"] = now(); u["records/" + r.id + "/updated"] = now();
        u["history/" + r.id + "/" + pushId()] = { by: "sistema", t: now(), field: "status", from: "resolved", to: "closed", note: "Fechamento automático após " + days + " dias" };
      }
    });
    if (Object.keys(u).length) db.ref("itsm/" + ID + "/data").update(u).catch(function () { /* ignore */ });
  }

  /* ---------------- shell ---------------- */
  const TABS = [
    ["portal", "Portal", "portal"], ["queue", "Fila", "list"], ["boards", "Quadros", "kanban"], ["incident", "Incidentes", "incident"], ["request", "Requisições", "request"],
    ["problem", "Problemas", "problem"], ["change", "Mudanças", "change"], ["improvement", "Melhorias", "improvement"], ["security", "SOC", "shield"], ["catalog", "Catálogo", "catalog"],
    ["kb", "Conhecimento", "kb"], ["cmdb", "CMDB", "cmdb"], ["dash", "Painel", "dashboard"], ["settings", "Administração", "settings"]
  ];
  function hasSoc() { return areas().some(function (a) { return a.soc; }) || recs().some(function (r) { return r.kind === "security"; }); }
  function tabs() { return TABS.filter(function (t) { if (!isAgent()) return t[0] === "portal"; if (t[0] === "settings") return isMgr(); if (t[0] === "security") return hasSoc(); return true; }); }
  function shell() {
    const roleN = { manager: "Gestor", agent: "Agente", requester: "Solicitante" }[role];
    app.innerHTML = '<header class="pl-top it-top"><a class="pl-back" href="./" aria-label="Minhas centrais">' + IC("back", 18) + '</a><span class="pl-logo">CM</span><div class="pl-title"><h1 class="no-i18n">' + esc(info.title) + '</h1><span class="pl-ws">ITSM · ' + esc(wsInfo.name || "") + " · " + roleN + "</span></div>" +
      '<div class="pl-actions">' + (isAgent() && areas().length > 1 ? '<label class="it-areaf" title="Filtrar por área">' + IC("layers", 15) + areaSelect("af", filter.area, true) + "</label>" : "") + (isAgent() ? '<button class="pl-btn primary" id="itNew">' + IC("plus", 15) + '<span class="hide-s"> Novo</span></button>' : "") + '<button class="pl-btn icon" id="itHelp" aria-label="Ajuda">' + IC("help", 16) + "</button></div></header>" +
      (tabs().length > 1 ? '<nav class="it-tabs" aria-label="Seções">' + tabs().map(function (t) { return '<button data-v="' + t[0] + '"' + (t[0] === view ? ' class="on" aria-current="page"' : "") + ">" + IC(t[2], 15) + "<span>" + t[1] + "</span></button>"; }).join("") + "</nav>" : "") +
      '<main id="view" class="it-main"></main>';
    app.querySelectorAll(".it-tabs [data-v]").forEach(function (b) { b.onclick = function () { view = b.dataset.v; history.replaceState(null, "", "#" + view); shell(); }; });
    const on = app.querySelector(".it-tabs .on"); if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "center" });
    document.getElementById("itHelp").onclick = helpDialog;
    const nb = document.getElementById("itNew"); if (nb) nb.onclick = function () { newMenu(nb); };
    const af = app.querySelector(".it-areaf select"); if (af) af.onchange = function () { filter.area = af.value; try { localStorage.setItem("cmcollab:itsm:area:" + ID, af.value); } catch (e) { /* ignore */ } renderView(); };
    renderView();
  }
  function renderView() {
    const el = document.getElementById("view"); if (!el) return;
    const keep = el.scrollTop;
    const V = { portal: portalView, queue: queueView, boards: boardsView, incident: kindView, request: kindView, problem: kindView, change: kindView, improvement: kindView, security: kindView, catalog: catalogView, kb: kbView, cmdb: cmdbView, dash: dashView, settings: settingsView };
    (V[view] || (isAgent() ? queueView : portalView))(el);
    el.scrollTop = keep;
  }
  function newMenu(anchor) {
    const old = document.getElementById("itMenu"); if (old) { old.remove(); return; }
    const m = document.createElement("div"); m.id = "itMenu"; m.className = "cr-menu it-menu no-i18n";
    m.innerHTML = '<div class="cr-h">Criar</div>' + ["incident", "request", "problem", "change", "improvement"].concat(hasSoc() ? ["security"] : []).map(function (k) {
      const x = KN[k]; return '<button data-k="' + k + '"><span class="ti" style="color:' + x.color + '">' + IC(x.icon, 18) + "</span><span><b>" + esc(x.name) + "</b><small>" + esc(x.practice) + "</small></span></button>";
    }).join("") + '<div class="cr-sep"></div><button data-k="_kb"><span class="ti">' + IC("kb", 18) + "</span><span><b>Artigo de conhecimento</b><small>Gerenciamento do conhecimento</small></span></button>";
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect(); m.style.top = (r.bottom + 6) + "px"; m.style.right = Math.max(8, window.innerWidth - r.right) + "px";
    m.querySelectorAll("[data-k]").forEach(function (b) { b.onclick = function () { m.remove(); if (b.dataset.k === "_kb") editArticle(null); else newRecord(b.dataset.k); }; });
    setTimeout(function () { document.addEventListener("click", function h(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener("click", h); } }); }, 0);
  }

  /* ---------------- portal (service desk – requester side) ---------------- */
  function offerings() { return list((data.catalog || {}).offerings).sort(function (a, b) { return (a.order || 99) - (b.order || 99) || byName(a, b); }); }
  function kbPublished() { return list(data.kb).filter(function (a) { return a.status === "published"; }); }
  function kbSearch(q, limit) {
    const words = String(q || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/\W+/).filter(function (w) { return w.length > 2; });
    if (!words.length) return [];
    return kbPublished().map(function (a) {
      const t = ((a.title || "") + " " + (a.body || "")).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
      let sc = 0; words.forEach(function (w) { if (t.indexOf(w) >= 0) sc += (a.title || "").toLowerCase().indexOf(w) >= 0 ? 3 : 1; });
      return { a: a, sc: sc };
    }).filter(function (x) { return x.sc > 0; }).sort(function (a, b) { return b.sc - a.sc; }).slice(0, limit || 4).map(function (x) { return x.a; });
  }
  function myRecords() {
    const src = isAgent() ? recs().filter(function (r) { return r.requester && r.requester.k === MEK; }) : Object.keys(mineRecs).map(function (k) { return Object.assign({ id: k }, mineRecs[k]); });
    return src.sort(function (a, b) { return (b.created || 0) - (a.created || 0); });
  }
  function portalView(el) {
    const offs = offerings(), svc = Object.assign({}, (data.catalog || {}).services || {}, (data.catalog || {}).products || {});
    const bySvc = {}; offs.forEach(function (o) { const k = (o.area || "") + "|" + (o.service || "_"); (bySvc[k] = bySvc[k] || []).push(o); });
    const svcOf = function (k) { return k.split("|")[1]; }, areaOf = function (k) { return k.split("|")[0]; };
    const mine = myRecords();
    el.innerHTML = '<div class="it-portal"><section class="it-phero"><h2>Como podemos ajudar?</h2><div class="it-search">' + IC("search", 18) + '<input id="pq" type="search" placeholder="Descreva o que você precisa ou o que aconteceu" autocomplete="off"></div><div id="pqr" class="it-kbres"></div></section>' +
      '<div class="it-pgrid"><section class="it-psec"><h3 class="it-h3">Catálogo de serviços</h3>' +
      (offs.length ? Object.keys(bySvc).sort(function (a, b) {
        const ao = ((data.areas || {})[areaOf(a)] || {}).order || 0, bo = ((data.areas || {})[areaOf(b)] || {}).order || 0;
        if (areaOf(a) !== areaOf(b)) return ao - bo;
        return svcOf(a) === "_" ? -1 : svcOf(b) === "_" ? 1 : String((svc[svcOf(a)] || {}).name).localeCompare(String((svc[svcOf(b)] || {}).name));
      }).map(function (k, i, arr) {
        const sk = svcOf(k), ak = areaOf(k), newArea = areas().length > 1 && (i === 0 || areaOf(arr[i - 1]) !== ak);
        return (newArea ? '<h3 class="it-parea" style="--c:' + esc(((data.areas || {})[ak] || {}).color || "#0e1a33") + '">' + IC(((data.areas || {})[ak] || {}).icon || "layers", 16) + " " + esc(areaName(ak) || "Geral") + "</h3>" : "") +
          '<div class="it-svc"><h4>' + esc(sk === "_" ? "Atendimento" : (svc[sk] || {}).name || "Serviço") + (svc[sk] && svc[sk].kind === "product" ? ' <span class="it-tag">produto digital</span>' : "") + '</h4><div class="it-offs">' + bySvc[k].map(function (o) {
          const ok = o.kind === "security" ? "security" : o.kind === "incident" ? "incident" : "request";
          return '<button class="it-off" data-off="' + esc(o.id) + '"><span class="it-oic" style="--c:' + KN[ok].color + '">' + IC(KN[ok].icon, 18) + '</span><span><b>' + esc(o.name) + "</b><small>" + esc(o.desc || "") + (o.approval ? " · exige aprovação" : "") + "</small></span></button>";
        }).join("") + "</div></div>";
      }).join("") : '<p class="muted">O catálogo ainda está vazio.' + (isAgent() ? " Cadastre serviços e ofertas na aba Catálogo." : "") + "</p>") +
      '</section><section class="it-psec"><h3 class="it-h3">Meus chamados <span class="it-count">' + mine.length + "</span></h3>" +
      (mine.length ? '<ul class="it-mylist">' + mine.map(function (r) {
        return '<li><button data-open="' + esc(r.id) + '"><span class="it-mk">' + esc(r.key || "") + "</span><b>" + esc(r.title) + '</b><span class="it-mmeta">' + stChip(r) + slaDot(r) + '<span class="muted small">' + esc(ago(r.updated || r.created)) + "</span>" + (r.status === "resolved" ? '<span class="it-need">Confirme a solução</span>' : r.status === "waiting" ? '<span class="it-need">Aguardando você</span>' : "") + "</span></button></li>";
      }).join("") + "</ul>" : '<p class="muted small">Você ainda não abriu chamados. Escolha um item do catálogo ao lado.</p>') +
      "</section></div></div>";
    const pq = el.querySelector("#pq"), pqr = el.querySelector("#pqr");
    pq.oninput = function () {
      const hits = kbSearch(pq.value, 4);
      pqr.innerHTML = hits.length ? '<p class="muted small">Talvez isto resolva:</p>' + hits.map(function (a) { return '<button class="it-kbhit" data-kb="' + esc(a.id) + '">' + IC("kb", 15) + " " + esc(a.title) + "</button>"; }).join("") : (pq.value.trim().length > 3 ? '<p class="muted small">Nenhum artigo encontrado. Escolha “Relatar um problema” ou um item do catálogo.</p>' : "");
      pqr.querySelectorAll("[data-kb]").forEach(function (b) { b.onclick = function () { viewArticle(b.dataset.kb, true); }; });
    };
    el.querySelectorAll("[data-off]").forEach(function (b) { b.onclick = function () { openOffering(b.dataset.off, pq.value); }; });
    el.querySelectorAll("[data-open]").forEach(function (b) { b.onclick = function () { openDrawer(b.dataset.open); }; });
  }
  function parseForm(spec) { return String(spec || "").split("\n").map(function (l) { const p = l.split("|"); return { label: (p[0] || "").trim(), type: (p[1] || "text").trim(), req: (p[2] || "0").trim() === "1" }; }).filter(function (f) { return f.label; }); }
  function openOffering(oid, preText) {
    const o = ((data.catalog || {}).offerings || {})[oid]; if (!o) return;
    const sec = o.kind === "security", inc = o.kind === "incident" || sec, fields = parseForm(o.form), cats = list((data.catalog || {}).categories).filter(function (c) { return !c.area || !o.area || c.area === o.area; }).sort(byName);
    const svcs = list(Object.assign({}, (data.catalog || {}).services || {}, (data.catalog || {}).products || {})).sort(byName);
    modal("<h2>" + IC(sec ? "shield" : inc ? "incident" : "request", 20) + " " + esc(o.name) + '</h2><p class="muted small">' + esc(o.desc || "") + "</p>" +
      '<form class="pl-form" id="ofF"><label>' + (inc ? "O que aconteceu?" : "Resumo do pedido") + '<input name="title" required maxlength="140" value="' + esc(preText || (inc ? "" : o.name)) + '" autocomplete="off"></label><div id="ofKb" class="it-kbres"></div>' +
      "<label>Detalhes<textarea name=\"desc\" rows=\"4\" maxlength=\"4000\" placeholder=\"" + (inc ? "Desde quando, o que você tentou, mensagem de erro…" : "Informações que ajudam a atender") + '"></textarea></label>' +
      fields.map(function (f, i) { return "<label>" + esc(f.label) + (f.req ? " *" : "") + (f.type === "textarea" ? '<textarea name="f' + i + '" rows="2"' + (f.req ? " required" : "") + "></textarea>" : '<input name="f' + i + '" type="' + (f.type === "date" ? "date" : "text") + '"' + (f.req ? " required" : "") + ">") + "</label>"; }).join("") +
      (sec ? '<p class="it-banner small">' + IC("shield", 14) + " Não apague o e-mail ou arquivo suspeito e não clique em mais nada. A equipe de segurança vai analisar.</p>" : "") +
      (inc && !sec ? '<div class="pl-2"><label>Quanto isso afeta o trabalho?<select name="impact">' + opt("low", "Só a mim", "medium") + opt("medium", "Minha equipe ou área", "medium") + opt("high", "Muitas pessoas ou clientes", "medium") + "</select></label>" +
        '<label>Qual a urgência?<select name="urgency">' + opt("low", "Posso esperar", "medium") + opt("medium", "Atrapalha, mas consigo trabalhar", "medium") + opt("high", "Estou parado(a)", "medium") + "</select></label></div>" +
        (!o.service && svcs.length ? '<label>Serviço ou produto afetado<select name="service">' + opt("", "Não sei", "") + svcs.map(function (s) { return opt(s.id, s.name, ""); }).join("") + "</select></label>" : "") +
        (cats.length ? '<label>Categoria<select name="category">' + opt("", "Não sei", "") + cats.map(function (c) { return opt(c.id, c.name, ""); }).join("") + "</select></label>" : "") : "") +
      '<div class="pl-row-end"><button type="button" class="pl-btn" data-close>Cancelar</button><button class="pl-btn primary">' + (inc ? "Abrir chamado" : "Enviar pedido") + "</button></div></form>", function (w, close) {
      const f = w.querySelector("#ofF"), kb = w.querySelector("#ofKb");
      function sug() { const hits = kbSearch(f.title.value + " " + f.desc.value, 3); kb.innerHTML = hits.length ? '<p class="muted small">Artigos que podem resolver:</p>' + hits.map(function (a) { return '<button type="button" class="it-kbhit" data-kb="' + esc(a.id) + '">' + IC("kb", 15) + " " + esc(a.title) + "</button>"; }).join("") : ""; kb.querySelectorAll("[data-kb]").forEach(function (b) { b.onclick = function () { viewArticle(b.dataset.kb, true, close); }; }); }
      f.title.oninput = sug; f.desc.oninput = sug; sug();
      f.onsubmit = function (e) {
        e.preventDefault();
        const answers = {}; fields.forEach(function (x, i) { const v = (f["f" + i].value || "").trim(); if (v) answers[x.label.replace(/[.#$\/\[\]]/g, " ").slice(0, 60)] = v.slice(0, 1000); });
        const r = { kind: sec ? "security" : inc ? "incident" : "request", area: o.area || "", title: f.title.value.trim().slice(0, 140), desc: f.desc.value.trim().slice(0, 4000), offering: oid, service: o.service || (f.service ? f.service.value : "") || "", category: f.category ? f.category.value : "", form: answers };
        if (sec) { r.priority = "P3"; } else if (inc) { r.impact = f.impact.value; r.urgency = f.urgency.value; } else { r.impact = "low"; r.urgency = "medium"; }
        f.querySelector(".primary").disabled = true;
        createRecord(r, true).then(function (rid) { close(); toast("Chamado registrado: " + (createdKeys[rid] || "")); openDrawer(rid); }, function (err) { f.querySelector(".primary").disabled = false; fail(err); });
      };
    });
  }
  /* create a record (requester or agent). Counter via transaction (+1 only – rules). */
  function createRecord(r, fromPortal) {
    const pre = (S().prefixes || {})[r.kind] || KN[r.kind].prefix, rid = pushId(), t = now();
    return db.ref("itsm/" + ID + "/data/counters/" + pre).transaction(function (n) { return (n || 0) + 1; }).then(function (res) {
      const n = res.snapshot.val();
      const o = Object.assign({ status: I.flow(r.kind)[0].id, created: t, updated: t, by: me.email, key: pre + "-" + String(n).padStart(4, "0") }, r);
      if (!o.requester) o.requester = { k: MEK, email: me.email, name: me.displayName || me.email.split("@")[0], ws: info.ws };
      const off0 = ((data.catalog || {}).offerings || {})[o.offering], sv0 = ((data.catalog || {}).services || {})[o.service] || ((data.catalog || {}).products || {})[o.service];
      if (!o.area) o.area = (off0 && off0.area) || (sv0 && sv0.area) || (o.kind === "security" ? (areas().find(function (a) { return a.soc; }) || {}).id : "") || "";
      if (o.kind === "security") {
        o.priority = o.priority || "P3";
        const tg = I.targets(o, data.sla); o.sla = { start: t, resp: tg.resp, contain: tg.contain, res: tg.res, policy: tg.policy || null };
        if (!o.group) { o.group = (sv0 && sv0.group) || (groups().find(function (g) { return g.area === o.area; }) || {}).id || ""; }
        o.detectedAt = o.detectedAt || t;
      } else if (o.kind === "incident" || o.kind === "request") {
        o.priority = I.priority(o.impact, o.urgency, S().matrix);
        const tg = I.targets(o, data.sla); o.sla = { start: t, resp: tg.resp, res: tg.res, policy: tg.policy || null };
        const off = ((data.catalog || {}).offerings || {})[o.offering];
        if (!o.group) { o.group = (sv0 && sv0.group) || (groups().find(function (g) { return o.area && g.area === o.area; }) || {}).id || (S().groups && S().groups.sd ? "sd" : "") || ""; }
        if (o.kind === "request" && off && off.approval) o.status = "approval";
      } else if (r.kind !== "task") o.priority = o.priority || I.priority(o.impact || "medium", o.urgency || "medium", S().matrix);
      Object.keys(o).forEach(function (k) { if (o[k] === undefined || o[k] === "") delete o[k]; });
      const u = {};
      u["data/records/" + rid] = o;
      u["data/history/" + rid + "/" + pushId()] = { by: me.email, t: t, field: "created", to: o.status };
      if (o.requester.k && (o.requester.k === MEK || isAgent())) u["mine/" + o.requester.k + "/" + rid] = true;
      createdKeys[rid] = o.key;
      if (!isAgent()) mineRecs[rid] = o;
      return db.ref("itsm/" + ID).update(u).then(function () {
        if (o.kind === "request" && o.status !== "approval") spawnTasks(rid, o);
        if (isTicket(o)) notify("itsm-opened", { rec: rid });
        if (o.kind === "change" && o.approvers) notify("itsm-change-approval", { rec: rid });
        return rid;
      });
    });
  }
  /* request fulfilment: tasks from the offering template ("group: title" per line) */
  function spawnTasks(rid, r) {
    if (!isAgent()) return Promise.resolve();
    const off = ((data.catalog || {}).offerings || {})[r.offering]; if (!off || !off.tasks) return Promise.resolve();
    const lines = String(off.tasks).split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    return lines.reduce(function (p, l) {
      const m = l.match(/^([\w-]+)\s*:\s*(.+)$/), g = m && S().groups && S().groups[m[1]] ? m[1] : "", title = m && g ? m[2] : l;
      return p.then(function () { return createRecord({ kind: "task", title: title, parent: rid, group: g, requester: r.requester }); });
    }, Promise.resolve());
  }

  /* ---------------- agent console: queue & lists ---------------- */
  function myGroups() { return groups().filter(function (g) { return (g.members || {})[MEK]; }).map(function (g) { return g.id; }); }
  function recRow(r) {
    return '<tr data-open="' + esc(r.id) + '" tabindex="0"><td class="it-key" data-l="Chave">' + esc(r.key || "") + '</td><td class="it-ttl" data-l="Título"><b>' + esc(r.title) + "</b>" + (r.major ? ' <span class="it-major">Incidente grave</span>' : "") + "</td>" +
      '<td data-l="Tipo">' + kindChip(r.kind) + '</td><td data-l="Prioridade">' + prioChip(r.priority) + '</td><td data-l="Status">' + stChip(r) + "</td>" +
      '<td data-l="Grupo">' + esc(groupName(r.group)) + '</td><td data-l="Responsável">' + avatar(r.assignee) + ' <span class="hide-s">' + esc(r.assignee ? nameOf(r.assignee) : "") + '</span></td><td data-l="SLA">' + slaDot(r) + " " + (isTicket(r) ? esc(slaText(r)) : "") + '</td><td data-l="Atualizado" class="muted small">' + esc(ago(r.updated || r.created)) + "</td></tr>";
  }
  function slaText(r) { const k = I.clock(r, now(), areaCal(r.area)); if (!k || !k.res) return ""; if (k.res.finished) return k.res.breached ? "violado" : "cumprido"; if (k.paused) return "pausado"; return I.fmtLeft(k.res.left); }
  function table(rows, empty) {
    return rows.length ? '<div class="it-tablewrap"><table class="it-table"><thead><tr><th>Chave</th><th>Título</th><th>Tipo</th><th>Prior.</th><th>Status</th><th>Grupo</th><th>Responsável</th><th>SLA</th><th>Atualizado</th></tr></thead><tbody>' + rows.map(recRow).join("") + "</tbody></table></div>" : '<div class="it-empty">' + IC("list", 26) + "<p>" + esc(empty) + "</p></div>";
  }
  function bindRows(el) { el.querySelectorAll("[data-open]").forEach(function (t) { t.onclick = function () { openDrawer(t.dataset.open); }; t.onkeydown = function (e) { if (e.key === "Enter") openDrawer(t.dataset.open); }; }); }
  function matchQ(r) { if (!filter.q) return true; const q = filter.q.toLowerCase(); return (r.title || "").toLowerCase().indexOf(q) >= 0 || (r.key || "").toLowerCase().indexOf(q) >= 0 || ((r.requester || {}).name || "").toLowerCase().indexOf(q) >= 0; }
  function prioRank(p) { return { P1: 1, P2: 2, P3: 3, P4: 4 }[p] || 5; }
  function sortQueue(a, b) {
    const ka = I.clock(a, now(), areaCal(a.area)), kb = I.clock(b, now(), areaCal(b.area));
    return prioRank(a.priority) - prioRank(b.priority) || ((ka && ka.res ? ka.res.left : 1e9) - (kb && kb.res ? kb.res.left : 1e9)) || (b.created || 0) - (a.created || 0);
  }
  function queueView(el) {
    const mg = myGroups(), open = recs().filter(function (r) { return !I.isDone(r) && r.kind !== "improvement" && inArea(r); });
    const Qs = {
      mine: ["Atribuídos a mim", function (r) { return r.assignee === me.email; }],
      groups: ["Meus grupos", function (r) { return mg.indexOf(r.group) >= 0; }],
      none: ["Sem responsável", function (r) { return !r.assignee && r.kind !== "change"; }],
      sla: ["SLA em risco ou violado", function (r) { const k = I.clock(r, now(), areaCal(r.area)); return k && k.res && !k.paused && k.res.color !== "green"; }],
      approval: ["Aguardando minha aprovação", function (r) { return (r.approvers || {})[MEK] && !((r.approvals || {})[MEK]) && (r.status === "approval" || r.status === "assess"); }],
      major: ["Incidentes graves", function (r) { return r.major; }],
      all: ["Todos abertos", function () { return true; }]
    };
    const cur = Qs[filter.queue] ? filter.queue : "mine";
    const rows = open.filter(Qs[cur][1]).filter(matchQ).sort(sortQueue);
    const majors = open.filter(function (r) { return r.major; });
    el.innerHTML = (majors.length ? '<div class="it-banner red">' + IC("alert", 16) + " <b>" + majors.length + (majors.length === 1 ? " incidente grave em andamento" : " incidentes graves em andamento") + ":</b> " + majors.map(function (r) { return '<button class="link" data-open="' + esc(r.id) + '">' + esc(r.key + " " + r.title) + "</button>"; }).join(" · ") + "</div>" : "") +
      '<div class="it-bar"><div class="it-chips" role="tablist">' + Object.keys(Qs).map(function (k) { const n = open.filter(Qs[k][1]).length; return '<button class="it-chipf' + (k === cur ? " on" : "") + '" data-q="' + k + '">' + esc(Qs[k][0]) + ' <span class="it-count">' + n + "</span></button>"; }).join("") + "</div>" +
      '<input class="it-q" type="search" placeholder="Buscar por chave, título ou solicitante" value="' + esc(filter.q) + '"></div>' + table(rows, "Nada nesta fila.");
    el.querySelectorAll("[data-q]").forEach(function (b) { b.onclick = function () { filter.queue = b.dataset.q; renderView(); }; });
    const q = el.querySelector(".it-q"); q.oninput = function () { filter.q = q.value; const p = q.selectionStart; renderView(); const n = document.querySelector(".it-q"); n.focus(); n.setSelectionRange(p, p); };
    bindRows(el);
  }
  function kindView(el) {
    const k = view, x = KN[k], all = recs().filter(function (r) { return r.kind === k && inArea(r); });
    const st = filter["st_" + k] || "open";
    const rows = all.filter(function (r) { return st === "all" || (st === "open" ? !I.isDone(r) : I.isDone(r)); }).filter(matchQ).sort(sortQueue);
    const sub = filter["sub_" + k] || "list";
    let extra = "";
    if (k === "problem") extra = trendPanel();
    el.innerHTML = '<div class="it-bar"><h2 class="it-h2">' + IC(x.icon, 20) + " " + esc(x.plural) + ' <span class="muted small">' + esc(x.practice) + "</span></h2>" +
      (k === "change" ? '<div class="it-seg"><button data-sub="list"' + (sub === "list" ? ' class="on"' : "") + ">Lista</button><button data-sub=\"cal\"" + (sub === "cal" ? ' class="on"' : "") + ">Calendário</button></div>" : "") +
      '<div class="it-seg">' + [["open", "Abertos"], ["done", "Encerrados"], ["all", "Todos"]].map(function (s) { return '<button data-st="' + s[0] + '"' + (st === s[0] ? ' class="on"' : "") + ">" + s[1] + "</button>"; }).join("") + "</div>" +
      '<input class="it-q" type="search" placeholder="Buscar" value="' + esc(filter.q) + '"><button class="pl-btn primary" id="kNew">' + IC("plus", 15) + " " + esc(x.name) + "</button></div>" + extra +
      (k === "change" && sub === "cal" ? changeCalendar() : table(rows, "Nenhum registro aqui."));
    el.querySelectorAll("[data-st]").forEach(function (b) { b.onclick = function () { filter["st_" + k] = b.dataset.st; renderView(); }; });
    el.querySelectorAll("[data-sub]").forEach(function (b) { b.onclick = function () { filter["sub_" + k] = b.dataset.sub; renderView(); }; });
    const q = el.querySelector(".it-q"); q.oninput = function () { filter.q = q.value; const p = q.selectionStart; renderView(); const n = document.querySelector(".it-q"); n.focus(); n.setSelectionRange(p, p); };
    el.querySelector("#kNew").onclick = function () { newRecord(k); };
    el.querySelectorAll("[data-trend]").forEach(function (b) { b.onclick = function () { const tr = trendList()[Number(b.dataset.trend)]; problemFromTrend(tr); }; });
    el.querySelectorAll("[data-calm]").forEach(function (b) { b.onclick = function () { filter.calMonth = (filter.calMonth || 0) + Number(b.dataset.calm); renderView(); }; });
    bindRows(el);
  }
  function trendList() { const t = S().trend || {}; return I.trends(data.records, { n: Number(t.n) || 3, days: Number(t.days) || 7 }, now()); }
  function trendLabel(tr) { return tr.by === "service" ? "Serviço: " + (svcName(tr.value) || tr.value) : tr.by === "category" ? "Categoria: " + ((((data.catalog || {}).categories || {})[tr.value]) || {}).name : "IC: " + ciName(tr.value); }
  function trendPanel() {
    const tr = trendList(), t = S().trend || {};
    if (!tr.length) return '<p class="muted small it-note">' + IC("trend", 14) + " Identificação por tendência: nenhum grupo com " + (t.n || 3) + " ou mais incidentes sem problema ligado nos últimos " + (t.days || 7) + " dias.</p>";
    return '<div class="it-banner amber">' + IC("trend", 16) + " <b>Tendência de incidentes recorrentes</b> (≥ " + (t.n || 3) + " em " + (t.days || 7) + " dias, sem problema ligado):<ul>" + tr.slice(0, 5).map(function (x, i) {
      return "<li>" + esc(trendLabel(x)) + " – " + x.ids.length + ' incidentes <button class="pl-btn sm" data-trend="' + i + '">Abrir problema</button></li>';
    }).join("") + "</ul></div>";
  }
  function problemFromTrend(tr) {
    if (!tr) return;
    createRecord({ kind: "problem", title: "Incidentes recorrentes – " + trendLabel(tr), desc: "Identificado por tendência: " + tr.ids.length + " incidentes.", impact: "medium", urgency: "medium", service: tr.by === "service" ? tr.value : "", category: tr.by === "category" ? tr.value : "", incidents: tr.ids.reduce(function (o, i) { o[i] = true; return o; }, {}), source: "trend" }).then(function (pid) {
      const u = {}; tr.ids.forEach(function (i) { u["records/" + i + "/problem"] = pid; });
      return db.ref("itsm/" + ID + "/data").update(u).then(function () { openDrawer(pid); });
    }).catch(fail);
  }
  function changeCalendar() {
    const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + (filter.calMonth || 0));
    const y = base.getFullYear(), m = base.getMonth(), first = new Date(y, m, 1), startDow = (first.getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
    const ch = recs().filter(function (r) { return r.kind === "change" && r.window && r.window.start && ["cancelled", "rejected"].indexOf(r.status) < 0; });
    const byDay = {};
    ch.forEach(function (r) { const s = new Date(r.window.start), e = new Date(r.window.end || r.window.start); for (let d = new Date(s.getFullYear(), s.getMonth(), s.getDate()); d <= e; d.setDate(d.getDate() + 1)) { if (d.getFullYear() === y && d.getMonth() === m) (byDay[d.getDate()] = byDay[d.getDate()] || []).push(r); } });
    let cells = "";
    for (let i = 0; i < startDow; i++) cells += '<div class="it-cday off"></div>';
    for (let d = 1; d <= days; d++) {
      const L = byDay[d] || [], cis = {}; let conflict = false;
      L.forEach(function (r) { Object.keys(r.cis || {}).forEach(function (c) { if (cis[c]) conflict = true; cis[c] = 1; }); });
      cells += '<div class="it-cday' + (conflict ? " conflict" : "") + '"><span class="it-dn">' + d + "</span>" + L.map(function (r) { return '<button class="it-cev t-' + esc(r.changeType || "normal") + '" data-open="' + esc(r.id) + '" title="' + esc(r.key + " · " + r.title) + '">' + esc(r.key) + " " + esc(r.title) + "</button>"; }).join("") + (conflict ? '<span class="it-cfl">Conflito de IC</span>' : "") + "</div>";
    }
    return '<div class="it-cal"><div class="it-calh"><button class="pl-btn sm" data-calm="-1" aria-label="Mês anterior">‹</button><b>' + esc(base.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })) + '</b><button class="pl-btn sm" data-calm="1" aria-label="Próximo mês">›</button><span class="muted small">Janelas das mudanças · vermelho = mesmo IC no mesmo dia</span></div>' +
      '<div class="it-cgridm">' + ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map(function (d) { return '<div class="it-cdow">' + d + "</div>"; }).join("") + cells + "</div></div>";
  }

  /* ---------------- boards (Kanban by practice, drag with mouse and touch) ---------------- */
  function boardsList() { const b = S().boards; return Array.isArray(b) && b.length ? b : [{ id: "b1", kind: "incident", name: "Incidentes", lane: "group" }]; }
  function boardsView(el) {
    const bs = boardsList(), cur = bs.find(function (b) { return b.id === filter.board; }) || bs[0];
    filter.board = cur.id;
    const fl = I.flow(cur.kind), items = recs().filter(function (r) { return r.kind === cur.kind && inArea(r); }).filter(matchQ).filter(function (r) { const s = I.status(r.kind, r.status); return s.cat !== "done" || !r.closedAt || now() - (r.closedAt || r.updated || 0) < 14 * DAY; });
    const lanesBy = cur.lane || "";
    let lanes = [{ id: "_all", name: "" }];
    if (lanesBy === "group") lanes = groups().map(function (g) { return { id: g.id, name: g.name }; }).concat([{ id: "", name: "Sem grupo" }]);
    if (lanesBy === "assignee") lanes = agents().map(function (a) { return { id: a.email, name: a.name }; }).concat([{ id: "", name: "Sem responsável" }]);
    if (lanesBy === "priority") lanes = ["P1", "P2", "P3", "P4"].map(function (p) { return { id: p, name: I.PRIO[p].name }; });
    const laneOf = function (r) { return lanesBy === "group" ? r.group || "" : lanesBy === "assignee" ? r.assignee || "" : lanesBy === "priority" ? r.priority || "P3" : "_all"; };
    lanes = lanes.filter(function (l) { return lanesBy === "" || items.some(function (r) { return laneOf(r) === l.id; }) || l.id === ""; });
    el.innerHTML = '<div class="it-boards"><aside class="it-blist"><b class="it-bl-h">Quadros</b>' + bs.map(function (b) { return '<button data-b="' + esc(b.id) + '"' + (b.id === cur.id ? ' class="on"' : "") + ">" + IC(KN[b.kind].icon, 15) + "<span>" + esc(b.name || KN[b.kind].plural) + "</span></button>"; }).join("") +
      (isMgr() ? '<button class="it-badd" id="bAdd">' + IC("plus", 14) + " Adicionar quadro</button>" : "") + "</aside>" +
      '<section class="it-bmain"><div class="it-bar"><h2 class="it-h2">' + esc(cur.name || KN[cur.kind].plural) + '</h2><label class="it-inl">Raias<select id="bLane">' + opt("", "Nenhuma", lanesBy) + opt("group", "Grupo", lanesBy) + opt("assignee", "Responsável", lanesBy) + opt("priority", "Prioridade", lanesBy) + "</select></label>" +
      '<input class="it-q" type="search" placeholder="Buscar" value="' + esc(filter.q) + '">' + (isMgr() ? '<button class="pl-btn sm ghost" id="bMore" aria-label="Opções do quadro">' + IC("more", 16) + "</button>" : "") + "</div>" +
      '<div class="it-kb">' + lanes.map(function (l) {
        const li = items.filter(function (r) { return laneOf(r) === l.id || lanesBy === ""; });
        return (l.name ? '<div class="it-lane-h">' + esc(l.name) + ' <span class="it-count">' + li.length + "</span></div>" : "") + '<div class="it-lane">' + fl.map(function (s) {
          const cs = li.filter(function (r) { return r.status === s.id; }).sort(sortQueue);
          return '<div class="kb-col it-col" data-st="' + s.id + '" data-lane="' + esc(l.id) + '"><header><span class="dot c-' + s.cat + '"></span>' + esc(s.name) + '<span class="cnt">' + cs.length + '</span></header><div class="kb-list">' + cs.map(kbCard).join("") + "</div></div>";
        }).join("") + "</div>";
      }).join("") + "</div></section></div>";
    el.querySelectorAll("[data-b]").forEach(function (b) { b.onclick = function () { filter.board = b.dataset.b; renderView(); }; });
    el.querySelector("#bLane").onchange = function () { const v = this.value; saveBoards(bs.map(function (b) { return b.id === cur.id ? Object.assign({}, b, { lane: v }) : b; })); };
    const q = el.querySelector(".it-q"); q.oninput = function () { filter.q = q.value; const p = q.selectionStart; renderView(); const n = document.querySelector(".it-q"); n.focus(); n.setSelectionRange(p, p); };
    const ba = el.querySelector("#bAdd"); if (ba) ba.onclick = function () { boardDialog(null); };
    const bm = el.querySelector("#bMore"); if (bm) bm.onclick = function () { boardDialog(cur); };
    bindDrag(el, cur, laneOf, lanesBy);
  }
  function kbCard(r) {
    return '<div class="kb-card it-kcard" draggable="true" data-id="' + esc(r.id) + '" tabindex="0"><div class="it-kc-top"><span class="it-key">' + esc(r.key) + "</span>" + prioChip(r.priority) + slaDot(r) + (r.major ? '<span class="it-major">grave</span>' : "") + '</div><div class="kt">' + esc(r.title) + '</div><div class="km">' + (r.group ? '<span class="muted small">' + esc(groupName(r.group)) + "</span>" : "") + '<span class="sp"></span>' + avatar(r.assignee) + "</div></div>";
  }
  function saveBoards(bs) { return db.ref("itsm/" + ID + "/data/settings/boards").set(bs).catch(fail); }
  function boardDialog(b) {
    modal("<h2>" + (b ? "Quadro" : "Novo quadro") + '</h2><form class="pl-form" id="bdF"><label>Nome<input name="name" maxlength="40" value="' + esc(b ? b.name : "") + '" placeholder="ex.: Incidentes de rede"></label>' +
      '<label>Prática (fluxo de status)<select name="kind"' + (b ? " disabled" : "") + ">" + Object.keys(KN).map(function (k) { return opt(k, KN[k].plural + " – " + I.flow(k).map(function (s) { return s.name; }).join(" → "), b ? b.kind : "incident"); }).join("") + "</select></label>" +
      '<div class="pl-row-end">' + (b && boardsList().length > 1 ? '<button type="button" class="pl-btn danger" id="bdDel">Remover quadro</button><span class="sp"></span>' : "") + '<button type="button" class="pl-btn" data-close>Cancelar</button><button class="pl-btn primary">Salvar</button></div></form>', function (w, close) {
      const f = w.querySelector("#bdF");
      f.onsubmit = function (e) {
        e.preventDefault(); const bs = boardsList().slice();
        if (b) bs.forEach(function (x, i) { if (x.id === b.id) bs[i] = Object.assign({}, x, { name: f.name.value.trim() }); });
        else { const nb = { id: "b" + Date.now().toString(36), kind: f.kind.value, name: f.name.value.trim() || KN[f.kind.value].plural, lane: "" }; bs.push(nb); filter.board = nb.id; }
        saveBoards(bs).then(close);
      };
      const d = w.querySelector("#bdDel"); if (d) d.onclick = function () { saveBoards(boardsList().filter(function (x) { return x.id !== b.id; })).then(close); };
    });
  }
  function bindDrag(root, board, laneOf, lanesBy) {
    function drop(id, col) {
      const r = rec(id); if (!r) return;
      const to = col.dataset.st, lane = col.dataset.lane, u = {};
      if (to !== r.status) {
        if (!I.canMove(r.kind, r.status, to)) { toast("Transição não permitida: " + I.status(r.kind, r.status).name + " → " + I.status(r.kind, to).name); return; }
        return changeStatus(r, to).then(function () { return moveLane(r, lane); });
      }
      return moveLane(r, lane);
      function moveLane(r2, ln) {
        if (lanesBy === "" || ln === "_all" || laneOf(r2) === ln) return;
        if (lanesBy === "group") return updateRec(r2.id, { group: ln || null }, "group");
        if (lanesBy === "assignee") return assign(r2, ln || null);
        if (lanesBy === "priority") return updateRec(r2.id, { priority: ln }, "priority");
      }
    }
    root.querySelectorAll(".it-kcard").forEach(function (c) {
      c.onclick = function () { if (!c._moved) openDrawer(c.dataset.id); };
      c.onkeydown = function (e) { if (e.key === "Enter") openDrawer(c.dataset.id); };
      c.addEventListener("dragstart", function (e) { dragging = true; c.classList.add("dragging"); e.dataTransfer.setData("text/plain", c.dataset.id); e.dataTransfer.effectAllowed = "move"; });
      c.addEventListener("dragend", function () { c.classList.remove("dragging"); dragging = false; root.querySelectorAll(".drop").forEach(function (z) { z.classList.remove("drop"); }); if (pendingRender) { pendingRender = false; renderView(); } });
      /* touch (Android / iOS): long-press, then drag to another column */
      c.addEventListener("pointerdown", function (e) {
        if (e.pointerType !== "touch") return;
        let timer = null, ghost = null, over = null, sx = e.clientX, sy = e.clientY;
        c._moved = false;
        timer = setTimeout(function () {
          dragging = true; c._moved = true; c.classList.add("dragging");
          ghost = c.cloneNode(true); ghost.className = "kb-card it-kcard it-ghost"; ghost.style.width = c.offsetWidth + "px"; document.body.appendChild(ghost);
          place(sx, sy); if (navigator.vibrate) navigator.vibrate(15);
        }, 350);
        function place(x, y) { if (!ghost) return; ghost.style.left = (x - 20) + "px"; ghost.style.top = (y - 20) + "px"; const t = document.elementFromPoint(x, y), col = t && t.closest ? t.closest(".it-col") : null; if (over && over !== col) over.classList.remove("drop"); over = col; if (col) col.classList.add("drop"); }
        function mv(ev) { if (!ghost) { if (Math.abs(ev.clientX - sx) > 8 || Math.abs(ev.clientY - sy) > 8) { clearTimeout(timer); cleanup(); } return; } place(ev.clientX, ev.clientY); }
        function tm(ev) { if (ghost) ev.preventDefault(); }
        function upH() { clearTimeout(timer); const col = over; const was = !!ghost; cleanup(); if (was && col) drop(c.dataset.id, col); if (was) setTimeout(function () { c._moved = false; }, 50); }
        function cleanup() { if (ghost) ghost.remove(); ghost = null; if (over) over.classList.remove("drop"); c.classList.remove("dragging"); dragging = false; document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", upH); document.removeEventListener("pointercancel", cleanup); document.removeEventListener("touchmove", tm); if (pendingRender) { pendingRender = false; renderView(); } }
        document.addEventListener("pointermove", mv); document.addEventListener("pointerup", upH); document.addEventListener("pointercancel", cleanup);
        document.addEventListener("touchmove", tm, { passive: false });
      });
    });
    root.querySelectorAll(".it-col").forEach(function (col) {
      col.addEventListener("dragover", function (e) { e.preventDefault(); col.classList.add("drop"); });
      col.addEventListener("dragleave", function () { col.classList.remove("drop"); });
      col.addEventListener("drop", function (e) { e.preventDefault(); col.classList.remove("drop"); dragging = false; drop(e.dataTransfer.getData("text/plain"), col); });
    });
  }

  /* ---------------- service catalogue (services, digital products, offerings, categories) ---------------- */
  function catalogView(el) {
    const c = data.catalog || {}, svcs = list(c.services).sort(byName), prods = list(c.products).sort(byName), offs = offerings(), cats = list(c.categories).sort(byName);
    const all = svcs.concat(prods).concat(list(c.services).filter(function () { return false; }));
    const svcCard = function (s, kind) {
      const so = offs.filter(function (o) { return o.service === s.id; }), cis = list((data.cmdb || {}).cis).filter(function (x) { return x.service === s.id; });
      return '<div class="it-svccard"><div class="it-sc-h"><b>' + esc(s.name) + "</b>" + (kind === "product" ? '<span class="it-tag">produto digital</span>' : '<span class="it-tag svc">serviço</span>') + (s.status && s.status !== "live" ? '<span class="it-tag gray">' + esc({ pipeline: "em desenho", retired: "desativado" }[s.status] || s.status) + "</span>" : "") +
        '<span class="sp"></span>' + (isMgr() ? '<button class="pl-btn sm ghost" data-esvc="' + kind + "|" + esc(s.id) + '">Editar</button>' : "") + "</div>" +
        '<p class="muted small">' + esc(s.desc || "") + "</p>" +
        '<div class="it-sc-m"><span>' + IC("people", 13) + " Suporte: " + esc(groupName(s.group) || "–") + "</span><span>Dono: " + esc(s.owner ? nameOf(s.owner) : "–") + "</span><span>" + IC("cmdb", 13) + " ICs: " + cis.length + "</span><span>Consumidores: " + esc([wsInfo.name].concat(Object.keys(info.workspaces || {}).length ? [Object.keys(info.workspaces).length + " workspace(s) conectado(s)"] : []).join(" + ")) + "</span></div>" +
        (so.length ? '<ul class="it-offl">' + so.map(function (o) { return '<li><button class="link" data-eoff="' + esc(o.id) + '">' + esc(o.name) + "</button> " + kindChip(o.kind === "incident" ? "incident" : "request") + (o.approval ? ' <span class="it-tag gray">aprovação</span>' : "") + "</li>"; }).join("") + "</ul>" : "") + "</div>";
    };
    el.innerHTML = '<div class="it-bar"><h2 class="it-h2">' + IC("catalog", 20) + ' Catálogo de serviços <span class="muted small">Gerenciamento de catálogo de serviço</span></h2>' +
      (isMgr() ? '<button class="pl-btn" data-new="service">' + IC("plus", 14) + ' Serviço</button><button class="pl-btn" data-new="product">' + IC("plus", 14) + ' Produto digital</button><button class="pl-btn primary" data-new="offering">' + IC("plus", 14) + " Oferta</button>" : "") + "</div>" +
      '<p class="muted small it-note">Serviços e produtos digitais (ITIL 5) com suas ofertas: o que o solicitante pode pedir ou relatar no portal, com formulário, aprovação, tarefas de cumprimento e grupo de suporte.</p>' +
      '<div class="it-svcgrid">' + svcs.map(function (s) { return svcCard(s, "service"); }).join("") + prods.map(function (s) { return svcCard(s, "product"); }).join("") + "</div>" +
      (offs.filter(function (o) { return !o.service; }).length ? '<h3 class="it-h3">Ofertas gerais</h3><ul class="it-offl">' + offs.filter(function (o) { return !o.service; }).map(function (o) { return '<li><button class="link" data-eoff="' + esc(o.id) + '">' + esc(o.name) + "</button> " + kindChip(o.kind === "incident" ? "incident" : "request") + "</li>"; }).join("") + "</ul>" : "") +
      '<h3 class="it-h3">Categorias</h3><div class="it-cats">' + cats.map(function (x) { return '<span class="it-tag gray">' + esc(x.name) + (isMgr() ? ' <button class="link" data-dcat="' + esc(x.id) + '" aria-label="Remover categoria">✕</button>' : "") + "</span>"; }).join("") +
      (isMgr() ? '<form id="catF" class="it-inlf"><input name="n" maxlength="40" placeholder="Nova categoria"><button class="pl-btn sm">Adicionar</button></form>' : "") + "</div>";
    void all;
    el.querySelectorAll("[data-new]").forEach(function (b) { b.onclick = function () { if (b.dataset.new === "offering") editOffering(null); else editService(b.dataset.new, null); }; });
    el.querySelectorAll("[data-esvc]").forEach(function (b) { const p = b.dataset.esvc.split("|"); b.onclick = function () { editService(p[0], p[1]); }; });
    el.querySelectorAll("[data-eoff]").forEach(function (b) { b.onclick = function () { if (isMgr()) editOffering(b.dataset.eoff); else openOffering(b.dataset.eoff); }; });
    el.querySelectorAll("[data-dcat]").forEach(function (b) { b.onclick = function () { db.ref("itsm/" + ID + "/data/catalog/categories/" + b.dataset.dcat).remove().catch(fail); }; });
    const cf = el.querySelector("#catF"); if (cf) cf.onsubmit = function (e) { e.preventDefault(); const n = cf.n.value.trim(); if (!n) return; db.ref("itsm/" + ID + "/data/catalog/categories").push({ name: n.slice(0, 40) }).catch(fail); };
  }
  function editService(kind, id) {
    const node = kind === "product" ? "products" : "services", s = id ? (((data.catalog || {})[node] || {})[id] || {}) : {};
    modal("<h2>" + (kind === "product" ? "Produto digital" : "Serviço") + '</h2><form class="pl-form" id="svF"><label>Nome<input name="name" required maxlength="80" value="' + esc(s.name || "") + '"></label><label>Descrição<textarea name="desc" rows="2" maxlength="500">' + esc(s.desc || "") + "</textarea></label>" +
      '<div class="pl-2"><label>Grupo de suporte<select name="group">' + opt("", "–", s.group || "") + groups().map(function (g) { return opt(g.id, g.name, s.group || ""); }).join("") + "</select></label>" +
      '<label>Dono<select name="owner">' + opt("", "–", s.owner || "") + agents().map(function (a) { return opt(a.email, a.name, s.owner || ""); }).join("") + "</select></label></div>" +
      '<label>Situação<select name="status">' + opt("pipeline", "Em desenho (pipeline)", s.status || "live") + opt("live", "Em operação", s.status || "live") + opt("retired", "Desativado", s.status || "live") + "</select></label>" +
      '<div class="pl-row-end">' + (id ? '<button type="button" class="pl-btn danger" id="svDel">Excluir</button><span class="sp"></span>' : "") + '<button type="button" class="pl-btn" data-close>Cancelar</button><button class="pl-btn primary">Salvar</button></div></form>', function (w, close) {
      const f = w.querySelector("#svF");
      f.onsubmit = function (e) { e.preventDefault(); const v = { name: f.name.value.trim(), desc: f.desc.value.trim(), group: f.group.value || null, owner: f.owner.value || null, status: f.status.value, kind: kind }; const ref = db.ref("itsm/" + ID + "/data/catalog/" + node); (id ? ref.child(id).update(v) : ref.push(v)).then(close, fail); };
      const d = w.querySelector("#svDel"); if (d) d.onclick = function () { confirmBox("Excluir " + (kind === "product" ? "produto" : "serviço"), "As ofertas ligadas continuam e passam para “Ofertas gerais”.", "Excluir", true).then(function (ok) { if (ok) db.ref("itsm/" + ID + "/data/catalog/" + node + "/" + id).remove().then(close, fail); }); };
    });
  }
  function editOffering(id) {
    const o = id ? (((data.catalog || {}).offerings || {})[id] || {}) : { kind: "request" }, svcs = list(Object.assign({}, (data.catalog || {}).services || {}, (data.catalog || {}).products || {})).sort(byName);
    modal("<h2>Oferta do catálogo</h2>" + '<form class="pl-form" id="ofE"><label>Nome<input name="name" required maxlength="80" value="' + esc(o.name || "") + '"></label><label>Descrição<input name="desc" maxlength="200" value="' + esc(o.desc || "") + '"></label>' +
      '<div class="pl-2"><label>Tipo<select name="kind">' + opt("request", "Requisição de serviço", o.kind) + opt("incident", "Incidente (relatar problema)", o.kind) + "</select></label>" +
      '<label>Serviço ou produto<select name="service">' + opt("", "Geral", o.service || "") + svcs.map(function (s) { return opt(s.id, s.name, o.service || ""); }).join("") + "</select></label></div>" +
      '<label class="chk"><input type="checkbox" name="approval"' + (o.approval ? " checked" : "") + "> Exige aprovação antes do cumprimento</label>" +
      '<label>Aprovadores<select name="approvers" multiple size="4">' + Object.keys(people()).map(function (k) { const p = people()[k]; return '<option value="' + esc(k) + '"' + ((o.approvers || {})[k] ? " selected" : "") + ">" + esc(p.name) + "</option>"; }).join("") + '</select><span class="muted small">Sem aprovadores, aprova quem for gestor da central.</span></label>' +
      '<label>Campos do formulário <span class="muted small">(um por linha: Rótulo|text, textarea ou date|1 = obrigatório)</span><textarea name="form" rows="3" placeholder="Sistema|text|1">' + esc(o.form || "") + "</textarea></label>" +
      '<label>Tarefas de cumprimento <span class="muted small">(uma por linha: id-do-grupo: título · grupos: ' + esc(groups().map(function (g) { return g.id; }).join(", ")) + ')</span><textarea name="tasks" rows="3" placeholder="sd: Configurar e entregar">' + esc(o.tasks || "") + "</textarea></label>" +
      '<label>Ordem no portal<input name="order" type="number" min="1" max="99" value="' + esc(o.order || 10) + '"></label>' +
      '<div class="pl-row-end">' + (id ? '<button type="button" class="pl-btn danger" id="ofDel">Excluir</button><span class="sp"></span>' : "") + '<button type="button" class="pl-btn" data-close>Cancelar</button><button class="pl-btn primary">Salvar</button></div></form>', function (w, close) {
      const f = w.querySelector("#ofE");
      f.onsubmit = function (e) {
        e.preventDefault();
        const ap = {}; Array.prototype.forEach.call(f.approvers.selectedOptions, function (x) { ap[x.value] = true; });
        const v = { name: f.name.value.trim(), desc: f.desc.value.trim(), kind: f.kind.value, service: f.service.value || null, approval: f.approval.checked, approvers: Object.keys(ap).length ? ap : null, form: f.form.value.trim() || null, tasks: f.tasks.value.trim() || null, order: Number(f.order.value) || 10 };
        const ref = db.ref("itsm/" + ID + "/data/catalog/offerings"); (id ? ref.child(id).update(v) : ref.push(v)).then(close, fail);
      };
      const d = w.querySelector("#ofDel"); if (d) d.onclick = function () { db.ref("itsm/" + ID + "/data/catalog/offerings/" + id).remove().then(close, fail); };
    }, true);
  }

  /* ---------------- knowledge ---------------- */
  function kbView(el) {
    const q = (filter.kbq || "").toLowerCase(), arts = list(data.kb).filter(function (a) { return !q || (a.title + " " + a.body).toLowerCase().indexOf(q) >= 0; }).sort(function (a, b) { return (b.updated || b.created || 0) - (a.updated || a.created || 0); });
    const stN = { draft: "Rascunho", published: "Publicado", archived: "Arquivado" };
    el.innerHTML = '<div class="it-bar"><h2 class="it-h2">' + IC("kb", 20) + ' Base de conhecimento <span class="muted small">Gerenciamento do conhecimento</span></h2><input class="it-q" id="kbq" type="search" placeholder="Buscar artigos" value="' + esc(filter.kbq || "") + '"><button class="pl-btn primary" id="kbNew">' + IC("plus", 14) + " Artigo</button></div>" +
      (arts.length ? '<ul class="it-kblist">' + arts.map(function (a) {
        const prb = a.problem && data.records[a.problem];
        return '<li><button data-art="' + esc(a.id) + '"><b>' + esc(a.title) + '</b><span class="muted small">' + esc(stN[a.status] || a.status) + " · " + esc(((((data.catalog || {}).categories || {})[a.category]) || {}).name || "sem categoria") + (a.service ? " · " + esc(svcName(a.service)) : "") + (prb ? " · erro conhecido " + esc(prb.key) : "") + " · " + (a.views || 0) + " visualizações · " + (a.helpful || 0) + " resolveram</span></button></li>";
      }).join("") + "</ul>" : '<div class="it-empty">' + IC("kb", 26) + "<p>Nenhum artigo. Publique soluções de contorno e respostas frequentes para o portal sugerir ao abrir chamado.</p></div>");
    const k = el.querySelector("#kbq"); k.oninput = function () { filter.kbq = k.value; const p = k.selectionStart; renderView(); const n = document.getElementById("kbq"); n.focus(); n.setSelectionRange(p, p); };
    el.querySelector("#kbNew").onclick = function () { editArticle(null); };
    el.querySelectorAll("[data-art]").forEach(function (b) { b.onclick = function () { viewArticle(b.dataset.art, false); }; });
  }
  function viewArticle(aid, portal, closeParent) {
    const a = (data.kb || {})[aid]; if (!a) return;
    db.ref("itsm/" + ID + "/data/kb/" + aid + "/views").transaction(function (n) { return (n || 0) + 1; }).catch(function () { /* requesters cannot count */ });
    modal("<h2>" + IC("kb", 20) + " " + esc(a.title) + '</h2><div class="it-art">' + esc(a.body || "").replace(/\n/g, "<br>") + "</div>" +
      '<div class="pl-row-end">' + (portal ? '<button class="pl-btn" data-close>Não resolveu</button><button class="pl-btn primary" id="kbOk">Resolveu meu problema</button>' : '<button class="pl-btn" data-close>Fechar</button><button class="pl-btn primary" id="kbEd">Editar</button>') + "</div>", function (w, close) {
      const ok = w.querySelector("#kbOk"); if (ok) ok.onclick = function () { db.ref("itsm/" + ID + "/data/kb/" + aid + "/helpful").transaction(function (n) { return (n || 0) + 1; }).catch(function () { /* ignore */ }); close(); if (closeParent) closeParent(); toast("Que bom! Nenhum chamado foi aberto."); };
      const ed = w.querySelector("#kbEd"); if (ed) ed.onclick = function () { close(); editArticle(aid); };
    }, true);
  }
  function editArticle(aid, preset) {
    const a = aid ? (data.kb || {})[aid] : Object.assign({ status: "draft" }, preset || {}), cats = list((data.catalog || {}).categories).sort(byName), svcs = list(Object.assign({}, (data.catalog || {}).services || {}, (data.catalog || {}).products || {})).sort(byName);
    const prbs = recs().filter(function (r) { return r.kind === "problem"; });
    modal("<h2>" + (aid ? "Editar artigo" : "Novo artigo") + '</h2><form class="pl-form" id="arF"><label>Título<input name="title" required maxlength="140" value="' + esc(a.title || "") + '"></label><label>Conteúdo<textarea name="body" rows="9" maxlength="8000">' + esc(a.body || "") + "</textarea></label>" +
      '<div class="pl-2"><label>Categoria<select name="category">' + opt("", "–", a.category || "") + cats.map(function (c) { return opt(c.id, c.name, a.category || ""); }).join("") + "</select></label>" +
      '<label>Serviço/produto<select name="service">' + opt("", "–", a.service || "") + svcs.map(function (s) { return opt(s.id, s.name, a.service || ""); }).join("") + "</select></label></div>" +
      '<div class="pl-2"><label>Erro conhecido (problema)<select name="problem">' + opt("", "–", a.problem || "") + prbs.map(function (p) { return opt(p.id, p.key + " " + p.title, a.problem || ""); }).join("") + "</select></label>" +
      '<label>Situação<select name="status">' + opt("draft", "Rascunho", a.status) + opt("published", "Publicado (aparece no portal)", a.status) + opt("archived", "Arquivado", a.status) + "</select></label></div>" +
      '<div class="pl-row-end">' + (aid ? '<button type="button" class="pl-btn danger" id="arDel">Excluir</button><span class="sp"></span>' : "") + '<button type="button" class="pl-btn" data-close>Cancelar</button><button class="pl-btn primary">Salvar</button></div></form>', function (w, close) {
      const f = w.querySelector("#arF");
      f.onsubmit = function (e) {
        e.preventDefault();
        const v = { title: f.title.value.trim(), body: f.body.value.trim(), category: f.category.value || null, service: f.service.value || null, problem: f.problem.value || null, status: f.status.value, updated: now(), by: me.email };
        const ref = db.ref("itsm/" + ID + "/data/kb");
        (aid ? ref.child(aid).update(v) : (function () { const nr = ref.push(); return nr.set(Object.assign({ created: now() }, v)).then(function () { if (v.problem) return db.ref("itsm/" + ID + "/data/records/" + v.problem + "/kb").set(nr.key); }); })()).then(function () { close(); toast("Artigo salvo"); }, fail);
      };
      const d = w.querySelector("#arDel"); if (d) d.onclick = function () { db.ref("itsm/" + ID + "/data/kb/" + aid).remove().then(close, fail); };
    }, true);
  }

  /* ---------------- CMDB (service configuration management) ---------------- */
  const CIT = { service: "Serviço", application: "Aplicação", server: "Servidor", database: "Banco de dados", network: "Rede", equipment: "Equipamento", cloud: "Nuvem", other: "Outro" };
  const RELT = { depends: "depende de", runs: "roda em", connects: "conecta com" };
  function cmdbView(el) {
    const cis = list((data.cmdb || {}).cis).sort(byName), rels = list((data.cmdb || {}).rels);
    const used = function (c) { return recs().filter(function (r) { return (r.cis || {})[c] && !I.isDone(r); }).length; };
    el.innerHTML = '<div class="it-bar"><h2 class="it-h2">' + IC("cmdb", 20) + ' CMDB <span class="muted small">Gerenciamento de configuração de serviço</span></h2><button class="pl-btn" id="relNew">' + IC("link", 14) + ' Relacionamento</button><button class="pl-btn primary" id="ciNew">' + IC("plus", 14) + " Item de configuração</button></div>" +
      (cis.length ? '<div class="it-tablewrap"><table class="it-table"><thead><tr><th>Nome</th><th>Tipo</th><th>Serviço</th><th>Dono</th><th>Fornecedor</th><th>Situação</th><th>Relacionamentos</th><th>Registros abertos</th></tr></thead><tbody>' + cis.map(function (c) {
        const out = rels.filter(function (r) { return r.from === c.id; }).map(function (r) { return RELT[r.type] + " " + ciName(r.to); }), inn = rels.filter(function (r) { return r.to === c.id; }).length;
        return '<tr data-ci="' + esc(c.id) + '" tabindex="0"><td data-l="Nome"><b>' + esc(c.name) + '</b></td><td data-l="Tipo">' + esc(CIT[c.type] || c.type || "") + '</td><td data-l="Serviço">' + esc(svcName(c.service)) + '</td><td data-l="Dono">' + esc(c.owner ? nameOf(c.owner) : "") + '</td><td data-l="Fornecedor">' + esc(c.supplier || "") + '</td><td data-l="Situação">' + esc({ live: "Em operação", planned: "Planejado", retired: "Desativado" }[c.status] || "") + '</td><td data-l="Relacionamentos" class="small">' + esc(out.join(" · ")) + (inn ? ' <span class="muted">(' + inn + " dependem dele)</span>" : "") + '</td><td data-l="Abertos">' + used(c.id) + "</td></tr>";
      }).join("") + "</tbody></table></div>" : '<div class="it-empty">' + IC("cmdb", 26) + "<p>Cadastre os itens de configuração (sistemas, servidores, equipamentos) e ligue-os a incidentes, problemas e mudanças.</p></div>");
    el.querySelector("#ciNew").onclick = function () { editCI(null); };
    el.querySelector("#relNew").onclick = relDialog;
    el.querySelectorAll("[data-ci]").forEach(function (t) { t.onclick = function () { editCI(t.dataset.ci); }; });
  }
  function impactOf(ci) { /* everything that (transitively) depends on / runs on this CI */
    const rels = list((data.cmdb || {}).rels), seen = {}, out = [];
    (function walk(c) { rels.forEach(function (r) { if (r.to === c && !seen[r.from]) { seen[r.from] = 1; out.push(r.from); walk(r.from); } }); })(ci);
    return out;
  }
  function editCI(id) {
    const c = id ? ((data.cmdb || {}).cis || {})[id] : { type: "application", status: "live" }, svcs = list(Object.assign({}, (data.catalog || {}).services || {}, (data.catalog || {}).products || {})).sort(byName);
    const rels = list((data.cmdb || {}).rels).filter(function (r) { return id && (r.from === id || r.to === id); }), imp = id ? impactOf(id) : [];
    const recsCI = id ? recs().filter(function (r) { return (r.cis || {})[id]; }).sort(function (a, b) { return (b.created || 0) - (a.created || 0); }).slice(0, 8) : [];
    modal("<h2>" + IC("cmdb", 20) + " " + (id ? esc(c.name) : "Novo item de configuração") + '</h2><form class="pl-form" id="ciF"><label>Nome<input name="name" required maxlength="80" value="' + esc(c.name || "") + '"></label>' +
      '<div class="pl-2"><label>Tipo<select name="type">' + Object.keys(CIT).map(function (k) { return opt(k, CIT[k], c.type); }).join("") + "</select></label>" +
      '<label>Situação<select name="status">' + opt("planned", "Planejado", c.status) + opt("live", "Em operação", c.status) + opt("retired", "Desativado", c.status) + "</select></label></div>" +
      '<div class="pl-2"><label>Serviço/produto<select name="service">' + opt("", "–", c.service || "") + svcs.map(function (s) { return opt(s.id, s.name, c.service || ""); }).join("") + "</select></label>" +
      '<label>Dono<select name="owner">' + opt("", "–", c.owner || "") + agents().map(function (a) { return opt(a.email, a.name, c.owner || ""); }).join("") + "</select></label></div>" +
      '<label>Fornecedor (terceiro)<input name="supplier" maxlength="80" value="' + esc(c.supplier || "") + '"></label>' +
      '<label>Observações<textarea name="notes" rows="2" maxlength="1000">' + esc(c.notes || "") + "</textarea></label>" +
      (id ? '<div class="it-sub"><b>Relacionamentos</b><ul>' + (rels.map(function (r) { return "<li>" + esc(ciName(r.from)) + " " + esc(RELT[r.type]) + " " + esc(ciName(r.to)) + ' <button type="button" class="link" data-drel="' + esc(r.id) + '">remover</button></li>'; }).join("") || '<li class="muted small">Nenhum</li>') + "</ul>" +
        "<b>Impacto</b><p class=\"small\">" + (imp.length ? "Se este item parar, afeta: " + esc(imp.map(ciName).join(", ")) : "Nenhum item depende dele.") + "</p>" +
        "<b>Registros ligados</b><ul>" + (recsCI.map(function (r) { return '<li><button type="button" class="link" data-open="' + esc(r.id) + '">' + esc(r.key + " " + r.title) + "</button> " + stChip(r) + "</li>"; }).join("") || '<li class="muted small">Nenhum</li>') + "</ul></div>" : "") +
      '<div class="pl-row-end">' + (id ? '<button type="button" class="pl-btn danger" id="ciDel">Excluir</button><span class="sp"></span>' : "") + '<button type="button" class="pl-btn" data-close>Cancelar</button><button class="pl-btn primary">Salvar</button></div></form>', function (w, close) {
      const f = w.querySelector("#ciF");
      f.onsubmit = function (e) { e.preventDefault(); const v = { name: f.name.value.trim(), type: f.type.value, status: f.status.value, service: f.service.value || null, owner: f.owner.value || null, supplier: f.supplier.value.trim() || null, notes: f.notes.value.trim() || null }; const ref = db.ref("itsm/" + ID + "/data/cmdb/cis"); (id ? ref.child(id).update(v) : ref.push(v)).then(close, fail); };
      w.querySelectorAll("[data-drel]").forEach(function (b) { b.onclick = function () { db.ref("itsm/" + ID + "/data/cmdb/rels/" + b.dataset.drel).remove().then(close, fail); }; });
      w.querySelectorAll("[data-open]").forEach(function (b) { b.onclick = function () { close(); openDrawer(b.dataset.open); }; });
      const d = w.querySelector("#ciDel"); if (d) d.onclick = function () { const u = {}; u["cmdb/cis/" + id] = null; list((data.cmdb || {}).rels).forEach(function (r) { if (r.from === id || r.to === id) u["cmdb/rels/" + r.id] = null; }); db.ref("itsm/" + ID + "/data").update(u).then(close, fail); };
    }, true);
  }
  function relDialog() {
    const cis = list((data.cmdb || {}).cis).sort(byName);
    if (cis.length < 2) return toast("Cadastre pelo menos dois itens de configuração.");
    modal('<h2>Novo relacionamento</h2><form class="pl-form" id="rlF"><label>Item<select name="from">' + cis.map(function (c) { return opt(c.id, c.name, ""); }).join("") + "</select></label>" +
      '<label>Relação<select name="type">' + Object.keys(RELT).map(function (k) { return opt(k, RELT[k], "depends"); }).join("") + "</select></label>" +
      '<label>Item<select name="to">' + cis.map(function (c, i) { return opt(c.id, c.name, i === 1 ? c.id : ""); }).join("") + "</select></label>" +
      '<div class="pl-row-end"><button type="button" class="pl-btn" data-close>Cancelar</button><button class="pl-btn primary">Salvar</button></div></form>', function (w, close) {
      const f = w.querySelector("#rlF");
      f.onsubmit = function (e) { e.preventDefault(); if (f.from.value === f.to.value) return toast("Escolha itens diferentes."); db.ref("itsm/" + ID + "/data/cmdb/rels").push({ from: f.from.value, type: f.type.value, to: f.to.value }).then(close, fail); };
    });
  }

  /* ---------------- dashboard ---------------- */
  function bars(rows, total) {
    const max = Math.max(1, Math.max.apply(null, rows.map(function (r) { return r.v; })));
    return '<div class="it-bars">' + rows.map(function (r) { return '<div class="it-barrow"><span class="it-bl">' + esc(r.n) + '</span><span class="it-bt"><span style="width:' + Math.round(r.v / max * 100) + "%;background:" + (r.c || "var(--blue)") + '"></span></span><b class="tnum">' + r.v + (total ? ' <span class="muted small">' + Math.round(r.v / Math.max(1, total) * 100) + "%</span>" : "") + "</b></div>"; }).join("") + "</div>";
  }
  function dashView(el) {
    const days = filter.dashDays || 30, since = now() - days * DAY;
    const R = {}; recs().forEach(function (r) { if (inArea(r) && ((r.created || 0) >= since || !I.isDone(r))) R[r.id] = data.records[r.id]; });
    const m = I.metrics(R, now(), cal()), all = list(R), tickets = all.filter(isTicket);
    const byStatus = {}, byPrio = {}, bySvc = {};
    tickets.forEach(function (r) { const s = I.status(r.kind, r.status); byStatus[s.name] = (byStatus[s.name] || 0) + 1; byPrio[r.priority || "–"] = (byPrio[r.priority || "–"] || 0) + 1; const sv = svcName(r.service) || "Sem serviço"; bySvc[sv] = (bySvc[sv] || 0) + 1; });
    const topP = recs().filter(function (r) { return r.kind === "problem"; }).map(function (p) { return { p: p, n: Object.keys(p.incidents || {}).length }; }).filter(function (x) { return x.n; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 5);
    const kb = list(data.kb), deflect = kb.reduce(function (a, x) { return a + (x.helpful || 0); }, 0);
    const ai = { a: 0, n: 0 }; recs().forEach(function (r) { Object.keys(r.ai || {}).forEach(function (k) { ai.n++; if (r.ai[k] !== "rejected") ai.a++; }); });
    const pct = function (v) { return v == null ? "–" : Math.round(v * 100) + "%"; };
    const tile = function (n, v, sub, cls) { return '<div class="it-kpi' + (cls ? " " + cls : "") + '"><span class="muted small">' + esc(n) + '</span><b class="kpi">' + esc(v) + "</b>" + (sub ? '<span class="muted small">' + esc(sub) + "</span>" : "") + "</div>"; };
    el.innerHTML = '<div class="it-bar"><h2 class="it-h2">' + IC("dashboard", 20) + ' Painel</h2><div class="it-seg">' + [7, 30, 90].map(function (d) { return '<button data-dd="' + d + '"' + (d === days ? ' class="on"' : "") + ">" + d + " dias</button>"; }).join("") + '</div><button class="pl-btn" id="dCsv">' + IC("export", 14) + " CSV</button></div>" +
      '<div class="it-kpis">' + tile("Chamados no período", m.total, m.open + " abertos") + tile("SLA de resolução cumprido", pct(m.sla), "", m.sla != null && m.sla < 0.9 ? "warn" : "") + tile("SLA de 1ª resposta cumprido", pct(m.resp)) +
      tile("MTTR (incidentes)", m.mttrH ? (m.mttrH < 24 ? m.mttrH.toFixed(1) + " h" : (m.mttrH / 24).toFixed(1) + " dias") : "–", "tempo médio de resolução") + tile("Satisfação (experiência)", m.csat ? m.csat.toFixed(1) + " / 5" : "–", m.csatN + " respostas") +
      tile("Resolvidos pela base", deflect, "desvios do portal") + tile("Sugestões da IA aceitas", ai.n ? Math.round(ai.a / ai.n * 100) + "%" : "–", ai.n + " sugestões") + "</div>" +
      '<div class="it-dgrid"><section class="it-dcard"><h3>Por status</h3>' + bars(Object.keys(byStatus).map(function (k) { return { n: k, v: byStatus[k] }; }), tickets.length) + "</section>" +
      '<section class="it-dcard"><h3>Por prioridade</h3>' + bars(["P1", "P2", "P3", "P4"].filter(function (p) { return byPrio[p]; }).map(function (p) { return { n: I.PRIO[p].name, v: byPrio[p], c: I.PRIO[p].color }; }), tickets.length) + "</section>" +
      '<section class="it-dcard"><h3>Por serviço</h3>' + bars(Object.keys(bySvc).sort(function (a, b) { return bySvc[b] - bySvc[a]; }).slice(0, 8).map(function (k) { return { n: k, v: bySvc[k], c: "var(--teal)" }; }), tickets.length) + "</section>" +
      '<section class="it-dcard"><h3>Backlog envelhecido (abertos)</h3>' + bars(Object.keys(m.ages).map(function (k, i) { return { n: k, v: m.ages[k], c: ["#36b37e", "#2f80ed", "#e8a400", "#e5484d"][i] }; })) + "</section>" +
      '<section class="it-dcard"><h3>Top problemas</h3>' + (topP.length ? '<ol class="it-toplist">' + topP.map(function (x) { return '<li><button class="link" data-open="' + esc(x.p.id) + '">' + esc(x.p.key + " " + x.p.title) + "</button> – " + x.n + " incidentes " + stChip(x.p) + "</li>"; }).join("") + "</ol>" : '<p class="muted small">Nenhum problema com incidentes ligados.</p>') + "</section>" +
      '<section class="it-dcard"><h3>Mudanças</h3>' + bars(["draft", "assess", "approved", "scheduled", "implemented", "failed", "reviewed"].map(function (s) { return { n: I.status("change", s).name, v: recs().filter(function (r) { return r.kind === "change" && r.status === s; }).length, c: "#7c5cff" }; }).filter(function (x) { return x.v; })) + "</section></div>";
    el.querySelectorAll("[data-dd]").forEach(function (b) { b.onclick = function () { filter.dashDays = Number(b.dataset.dd); renderView(); }; });
    bindRows(el);
    el.querySelector("#dCsv").onclick = function () {
      const q = function (v) { v = v == null ? "" : String(v); return /[",;\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const head = ["Chave", "Tipo", "Título", "Status", "Prioridade", "Serviço", "Grupo", "Responsável", "Solicitante", "Aberto em", "Resolvido em", "SLA resolução", "Satisfação", "ITIL 4", "ITIL 5"];
      const lines = [head.join(",")].concat(recs().sort(function (a, b) { return (a.created || 0) - (b.created || 0); }).map(function (r) { const v = I.valueChain(r); return [r.key, KN[r.kind].name, r.title, I.status(r.kind, r.status).name, r.priority, svcName(r.service), groupName(r.group), r.assignee, (r.requester || {}).email, fmtDT(r.created), fmtDT(r.resolvedAt), slaText(r), (r.csat || {}).score, v.n4, v.n5].map(q).join(","); }));
      const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }), a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = slug(info.title) + "-itsm.csv"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    };
  }

  /* ---------------- record changes ---------------- */
  function hist(rid, field, from, to, note) { const o = { by: me.email, t: now(), field: field }; if (from != null) o.from = String(from); if (to != null) o.to = String(to); if (note) o.note = String(note).slice(0, 300); return ["history/" + rid + "/" + pushId(), o]; }
  function updateRec(id, patch, field) {
    const r = rec(id); if (!r) return Promise.resolve();
    const u = {};
    Object.keys(patch).forEach(function (k) { u["records/" + id + "/" + k] = patch[k] === undefined ? null : patch[k]; });
    if (("impact" in patch || "urgency" in patch) && r.kind !== "task" && r.kind !== "security") {
      const p = I.priority(patch.impact || r.impact, patch.urgency || r.urgency, S().matrix);
      if (p !== r.priority) { u["records/" + id + "/priority"] = p; const h = hist(id, "priority", r.priority, p); u[h[0]] = h[1]; patch.priority = p; }
    }
    if (("priority" in patch || "area" in patch) && r.sla && r.sla.start && isTicket(r)) {
      const tg = I.targets(Object.assign({}, r, { priority: patch.priority || r.priority, service: patch.service || r.service, area: "area" in patch ? patch.area : r.area }), data.sla);
      u["records/" + id + "/sla/resp"] = tg.resp; u["records/" + id + "/sla/res"] = tg.res; if (tg.contain) u["records/" + id + "/sla/contain"] = tg.contain;
    }
    u["records/" + id + "/updated"] = now();
    if (field) { const h = hist(id, field, r[field], patch[field]); u[h[0]] = h[1]; }
    return db.ref("itsm/" + ID + "/data").update(u).catch(fail);
  }
  function assign(r, email) {
    return updateRec(r.id, { assignee: email || null }, "assignee").then(function () { if (email && email !== me.email) notify("itsm-assigned", { rec: r.id, to: email }); });
  }
  function resolveDialog(r) {
    return new Promise(function (res) {
      modal("<h2>Resolver " + esc(r.key) + '</h2><form class="pl-form" id="rsF"><label>Código de encerramento<select name="code">' + ["Resolvido com solução definitiva", "Resolvido com solução de contorno", "Atendido conforme solicitado", "Resolvido pelo próprio solicitante", "Sem reprodução / não confirmado", "Duplicado"].map(function (c, i) { return opt(c, c, r.kind === "request" ? "Atendido conforme solicitado" : i === 0 ? c : ""); }).join("") + "</select></label>" +
        '<label>Solução (o solicitante recebe este texto)<textarea name="sol" rows="4" required maxlength="2000">' + esc(r.resolution || "") + "</textarea></label>" +
        '<div class="pl-row-end"><button type="button" class="pl-btn" data-close>Cancelar</button><button class="pl-btn primary">Resolver</button></div></form>', function (w, close) {
        const f = w.querySelector("#rsF");
        f.onsubmit = function (e) { e.preventDefault(); close(); res({ resolution: f.sol.value.trim(), closeCode: f.code.value }); };
        w.querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", function () { res(null); }); });
      });
    });
  }
  function knownErrorDialog(r) {
    return new Promise(function (res) {
      const ke = r.knownError || {};
      modal("<h2>Registrar erro conhecido</h2><p class=\"muted small\">ITIL: um erro conhecido é um problema com causa identificada e solução de contorno documentada.</p><form class=\"pl-form\" id=\"keF\"><label>Causa raiz<textarea name=\"cause\" rows=\"3\" required maxlength=\"2000\">" + esc(ke.cause || "") + "</textarea></label>" +
        '<label>Solução de contorno<textarea name="wa" rows="3" required maxlength="2000">' + esc(ke.workaround || "") + "</textarea></label>" +
        '<div class="pl-row-end"><button type="button" class="pl-btn" data-close>Cancelar</button><button class="pl-btn primary">Salvar</button></div></form>', function (w, close) {
        const f = w.querySelector("#keF");
        f.onsubmit = function (e) { e.preventDefault(); close(); res({ cause: f.cause.value.trim(), workaround: f.wa.value.trim() }); };
        w.querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", function () { res(null); }); });
      });
    });
  }
  function approvalState(r) {
    const ap = r.approvers || {}, got = r.approvals || {}, keys = Object.keys(ap);
    if (!keys.length) return { need: false, done: true, rejected: false, n: 0, ok: 0 };
    let ok = 0, rej = false; keys.forEach(function (k) { if (got[k] && got[k].d === "approve") ok++; if (got[k] && got[k].d === "reject") rej = true; });
    const rule = r.changeType === "emergency" ? "any" : S().approvalRule || "all";
    const done = rule === "any" ? ok >= 1 : rule === "majority" ? ok > keys.length / 2 : ok === keys.length;
    return { need: true, done: done, rejected: rej, n: keys.length, ok: ok, rule: rule };
  }
  function changeStatus(r, to, extra) {
    extra = extra || {};
    if (r.status === to) return Promise.resolve();
    if (!I.canMove(r.kind, r.status, to)) { toast("Transição não permitida"); return Promise.resolve(); }
    /* gates required by the practices */
    if ((r.kind === "incident" || r.kind === "request") && to === "resolved" && !extra.resolution) return resolveDialog(r).then(function (x) { return x ? changeStatus(r, to, x) : null; });
    if (r.kind === "problem" && to === "known" && !extra.knownError && !(r.knownError && r.knownError.workaround)) return knownErrorDialog(r).then(function (x) { return x ? changeStatus(r, to, { knownError: x }) : null; });
    if (r.kind === "change" && to === "approved" && r.changeType !== "standard") { const a = approvalState(r); if (a.need && !a.done) { toast("Faltam aprovações da autoridade de mudança (" + a.ok + "/" + a.n + ")."); return Promise.resolve(); } if (!a.need && !isMgr()) { toast("Defina os aprovadores (CAB) ou peça a um gestor."); return Promise.resolve(); } }
    if (r.kind === "change" && to === "scheduled" && !(r.window && r.window.start)) { toast("Defina a janela de implementação antes de agendar."); return Promise.resolve(); }
    if (r.kind === "change" && to === "reviewed" && !(r.pir && r.pir.result)) { toast("Preencha a revisão pós-implementação (PIR) na ficha."); openDrawer(r.id); return Promise.resolve(); }
    if (r.kind === "change" && to === "assess" && r.changeType === "standard") { toast("Mudança padrão é pré-aprovada: vá direto para Agendada."); return Promise.resolve(); }
    const t = now(), u = {}, P = "records/" + r.id + "/";
    u[P + "status"] = to; u[P + "updated"] = t;
    const cat = I.status(r.kind, to).cat;
    if (r.sla && r.sla.start) { const sp = I.slaOnStatus(r, to, t, areaCal(r.area)); Object.keys(sp || {}).forEach(function (k) { u[P + "sla/" + k] = sp[k]; }); }
    if (cat === "done" && ["resolved", "done", "reviewed", "lessons", "false"].indexOf(to) >= 0 && !r.resolvedAt) u[P + "resolvedAt"] = t;
    if (to === "closed") u[P + "closedAt"] = t;
    if (cat !== "done") { u[P + "resolvedAt"] = null; u[P + "closedAt"] = null; if (I.status(r.kind, r.status).cat === "done") u[P + "reopened"] = (r.reopened || 0) + 1; }
    if (extra.resolution) { u[P + "resolution"] = extra.resolution; u[P + "closeCode"] = extra.closeCode; }
    if (extra.knownError) u[P + "knownError"] = extra.knownError;
    if (!r.assignee && cat === "doing" && isAgent() && (r.kind === "incident" || r.kind === "request" || r.kind === "task")) u[P + "assignee"] = me.email;
    const h = hist(r.id, "status", r.status, to, extra.resolution || extra.note); u[h[0]] = h[1];
    if (extra.resolution) u["comments/" + r.id + "/" + pushId()] = { by: me.email, name: me.displayName || nameOf(me.email), t: t, text: "Solução: " + extra.resolution, sys: true };
    return db.ref("itsm/" + ID + "/data").update(u).then(function () {
      const nr = Object.assign({}, r, { status: to });
      if (r.kind === "request" && to === "doing" && !recs().some(function (x) { return x.parent === r.id; })) spawnTasks(r.id, nr);
      if ((r.kind === "incident" || r.kind === "request") && to === "resolved") notify("itsm-resolved", { rec: r.id });
      if (r.kind === "task" && to === "done" && r.parent) {
        const par = rec(r.parent), sib = recs().filter(function (x) { return x.parent === r.parent && x.id !== r.id; });
        if (par && par.status === "doing" && sib.every(function (x) { return I.isDone(x); })) changeStatus(par, "resolved", { resolution: "Todas as tarefas de cumprimento foram concluídas.", closeCode: "Atendido conforme solicitado" });
      }
      if (r.kind === "problem" && to === "resolved") {
        const inc = Object.keys(r.incidents || {}).map(rec).filter(function (x) { return x && !I.isDone(x); });
        if (inc.length) confirmBox("Resolver incidentes ligados?", inc.length + " incidente(s) ligado(s) a este problema ainda estão abertos. Resolver todos com a solução definitiva?", "Resolver " + inc.length).then(function (ok) {
          if (ok) inc.reduce(function (p, x) { return p.then(function () { return changeStatus(x, x.status === "new" ? "resolved" : "resolved", { resolution: "Resolvido pela solução definitiva do problema " + r.key + ".", closeCode: "Resolvido com solução definitiva" }); }); }, Promise.resolve());
        });
      }
      syncPlans(nr);
    }).catch(fail);
  }
  function addComment(rid, text, internal) {
    const t = now(), u = {}, r = rec(rid); if (!r || !text.trim()) return Promise.resolve();
    const c = { by: me.email, name: me.displayName || nameOf(me.email), t: t, text: text.trim().slice(0, 4000) };
    if (internal) u["notes/" + rid + "/" + pushId()] = c; else u["comments/" + rid + "/" + pushId()] = c;
    u["records/" + rid + "/updated"] = t;
    if (!internal && isAgent() && r.sla && r.sla.start && !r.sla.respAt && r.requester && r.requester.k !== MEK) u["records/" + rid + "/sla/respAt"] = t;
    /* requester answering while "waiting for customer" puts the ticket back in progress (clock restarts) */
    if (!isAgent() && r.status === "waiting") {
      u["records/" + rid + "/status"] = "doing";
      const sp = I.slaOnStatus(r, "doing", t, areaCal(r.area)) || {};
      if ("pausedMs" in sp) u["records/" + rid + "/sla/pausedMs"] = sp.pausedMs;
      if ("pausedAt" in sp) u["records/" + rid + "/sla/pausedAt"] = null;
      const h = hist(rid, "status", "waiting", "doing", "Resposta do solicitante"); u[h[0]] = h[1];
    }
    return db.ref("itsm/" + ID + "/data").update(u).then(function () { if (!internal) notify("itsm-comment", { rec: rid }); }).catch(fail);
  }

  /* ---------------- new record (agent) ---------------- */
  function newRecord(kind) {
    const x = KN[kind], ppl = Object.keys(people()).map(function (k) { return people()[k]; }).sort(byName);
    const svcs = list(Object.assign({}, (data.catalog || {}).services || {}, (data.catalog || {}).products || {})).sort(byName), cats = list((data.catalog || {}).categories).sort(byName);
    const ticket = kind === "incident" || kind === "request" || kind === "security";
    modal("<h2>" + IC(x.icon, 20) + " Novo " + esc(x.name.toLowerCase()) + '</h2><p class="muted small">' + esc(x.practice) + '</p><form class="pl-form" id="nrF"><label>Título<input name="title" required maxlength="140" autocomplete="off"></label><label>Descrição<textarea name="desc" rows="3" maxlength="4000"></textarea></label>' +
      (ticket ? '<label>Solicitante<select name="req">' + ppl.map(function (p) { return opt(p.k, p.name + " · " + p.email, MEK); }).join("") + "</select></label>" : "") +
      (kind === "request" ? '<label>Oferta do catálogo<select name="offering">' + offerings().filter(function (o) { return o.kind !== "incident"; }).map(function (o) { return opt(o.id, o.name, ""); }).join("") + "</select></label>" : "") +
      (areas().length ? "<label>Área" + areaSelect("area", kind === "security" ? (areas().find(function (a) { return a.soc; }) || {}).id : filter.area) + "</label>" : "") +
      (kind === "security" ? '<div class="pl-2"><label>Severidade<select name="sev">' + ["P1", "P2", "P3", "P4"].map(function (p) { return opt(p, p + " · " + I.SEV[p], "P3"); }).join("") + '</select></label><label>Categoria<select name="socCat">' + opt("", "–", "") + Object.keys(I.SOC_CATS).map(function (k) { return opt(k, I.SOC_CATS[k], ""); }).join("") + "</select></label></div>" : "") +
      (kind === "change" ? '<label>Tipo de mudança<select name="ctype">' + Object.keys(I.CHANGE_TYPES).map(function (k) { return opt(k, I.CHANGE_TYPES[k], "normal"); }).join("") + "</select></label>" : "") +
      (kind !== "improvement" && kind !== "security" ? '<div class="pl-2"><label>Impacto<select name="impact">' + I.LEVELS.map(function (l) { return opt(l, I.LEVELN[l], "medium"); }).join("") + '</select></label><label>Urgência<select name="urgency">' + I.LEVELS.map(function (l) { return opt(l, I.URGN[l], "medium"); }).join("") + "</select></label></div>" : "") +
      '<div class="pl-2"><label>Serviço ou produto<select name="service">' + opt("", "–", "") + svcs.map(function (s) { return opt(s.id, s.name, ""); }).join("") + "</select></label>" +
      (kind !== "change" && kind !== "improvement" ? '<label>Categoria<select name="category">' + opt("", "–", "") + cats.map(function (c) { return opt(c.id, c.name, ""); }).join("") + "</select></label>" : "<span></span>") + "</div>" +
      (kind === "improvement" ? '<label>Origem<select name="origin">' + opt("idea", "Ideia ou sugestão", "idea") + opt("problem", "Problema", "") + opt("sla", "Resultado de SLA", "") + opt("dashboard", "Indicador do painel", "") + opt("csat", "Pesquisa de satisfação", "") + "</select></label>" : "") +
      '<div class="pl-row-end"><button type="button" class="pl-btn" data-close>Cancelar</button><button class="pl-btn primary">Criar</button></div></form>', function (w, close) {
      const f = w.querySelector("#nrF");
      f.onsubmit = function (e) {
        e.preventDefault();
        const r = { kind: kind, title: f.title.value.trim(), desc: f.desc.value.trim(), service: f.service.value, impact: f.impact ? f.impact.value : "medium", urgency: f.urgency ? f.urgency.value : "medium" };
        if (f.category) r.category = f.category.value;
        if (f.req) { const p = people()[f.req.value]; r.requester = { k: p.k, email: p.email, name: p.name, ws: info.ws }; }
        if (f.offering) r.offering = f.offering.value;
        if (f.ctype) { r.changeType = f.ctype.value; const cab = (S().cab || {})[f.ctype.value === "emergency" ? "emergency" : "normal"]; if (cab && f.ctype.value !== "standard") r.approvers = cab; }
        if (f.origin) r.origin = f.origin.value;
        if (f.area) r.area = f.area.value;
        if (f.sev) { r.priority = f.sev.value; r.socCat = f.socCat.value || null; }
        f.querySelector(".primary").disabled = true;
        createRecord(r).then(function (rid) { close(); openDrawer(rid); }, function (err) { f.querySelector(".primary").disabled = false; fail(err); });
      };
    });
  }

  /* ---------------- record drawer ---------------- */
  function closeDrawer() { const d = document.getElementById("itDrawer"); if (d) d.remove(); openRec = null; const u = new URL(location.href); if (u.searchParams.get("rec")) { u.searchParams.delete("rec"); history.replaceState(null, "", u.pathname + u.search + u.hash); } }
  function openDrawer(id, tries) {
    if (!rec(id) && (tries || 0) < 25) { setTimeout(function () { openDrawer(id, (tries || 0) + 1); }, 120); return; } /* just created: wait for the listener */
    openRec = id; drawDrawer(true);
  }
  function refreshDrawer() {
    if (!openRec) return;
    const d = document.getElementById("itDrawer"); if (!d) return;
    const ae = document.activeElement; /* keep what the user is typing: redraw later only if the focused field has unsaved text */
    if (d.contains(ae) && ae.matches("input:not([type=checkbox]):not([type=radio]),textarea") && ae.value !== ae.defaultValue) { d.dataset.stale = "1"; return; }
    drawDrawer(false);
  }
  function drawDrawer(fresh) {
    const r = rec(openRec); if (!r) { closeDrawer(); return; }
    let d = document.getElementById("itDrawer"); const keep = d ? d.querySelector(".it-dbody").scrollTop : 0, draft = d && d.querySelector("#cmTxt") ? d.querySelector("#cmTxt").value : "";
    if (!d) {
      d = document.createElement("aside"); d.id = "itDrawer"; d.className = "pl-drawer it-drawer no-i18n"; d.setAttribute("role", "dialog"); d.setAttribute("aria-label", r.key); document.body.appendChild(d);
      d.addEventListener("change", function (e) { if (e.target && "defaultValue" in e.target) e.target.defaultValue = e.target.value; }, true);
    }
    d.innerHTML = isAgent() ? agentDrawer(r) : requesterDrawer(r);
    d.dataset.stale = "";
    const body = d.querySelector(".it-dbody"); if (!fresh) body.scrollTop = keep;
    const cm = d.querySelector("#cmTxt"); if (cm && draft) cm.value = draft;
    d.querySelector("#dClose").onclick = closeDrawer;
    if (isAgent()) bindAgentDrawer(d, r); else bindRequesterDrawer(d, r);
    d.querySelectorAll("[data-open]").forEach(function (b) { b.onclick = function () { openDrawer(b.dataset.open); }; });
    d.querySelectorAll("input,textarea,select").forEach(function (x) { x.addEventListener("blur", function () { setTimeout(function () { const dd = document.getElementById("itDrawer"); if (dd && dd.dataset.stale === "1" && !dd.contains(document.activeElement)) drawDrawer(false); }, 120); }); });
    if (fresh) { const u = new URL(location.href); u.searchParams.set("rec", r.id); history.replaceState(null, "", u.pathname + u.search + u.hash); }
  }
  function thread(rid, withNotes) {
    const cs = isAgent() ? (data.comments || {})[rid] || {} : mineComments[rid] || {}, ns = withNotes ? (data.notes || {})[rid] || {} : {};
    const all = Object.keys(cs).map(function (k) { return Object.assign({ id: k, pub: true }, cs[k]); }).concat(Object.keys(ns).map(function (k) { return Object.assign({ id: k, pub: false }, ns[k]); })).sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
    return all.length ? '<ul class="it-thread">' + all.map(function (c) { return '<li class="' + (c.pub ? "" : "note") + (c.sys ? " sys" : "") + '">' + avatar(c.by) + '<div><span class="it-th-h"><b>' + esc(c.name || nameOf(c.by)) + '</b> <span class="muted small">' + esc(fmtDT(c.t)) + (c.pub ? "" : " · nota interna") + "</span></span><p>" + esc(c.text).replace(/\n/g, "<br>") + "</p></div></li>"; }).join("") + "</ul>" : '<p class="muted small">Sem mensagens ainda.</p>';
  }
  function requesterDrawer(r) {
    const s = I.status(r.kind, r.status), off = ((data.catalog || {}).offerings || {})[r.offering];
    return '<header><span class="it-key">' + esc(r.key) + "</span>" + kindChip(r.kind) + '<span class="sp"></span><button class="pl-btn icon ghost" id="dClose" aria-label="Fechar">' + IC("close", 16) + '</button></header><div class="it-dbody">' +
      "<h2 class=\"it-dt\">" + esc(r.title) + '</h2><div class="it-chips">' + stChip(r) + prioChip(r.priority) + slaChip(r, "res") + "</div>" +
      (r.status === "waiting" ? '<div class="it-banner amber">' + IC("alert", 15) + " A equipe precisa de uma informação sua. Responda abaixo para o atendimento continuar.</div>" : "") +
      (r.status === "approval" ? '<div class="it-banner">' + IC("clock", 15) + " Seu pedido está aguardando aprovação.</div>" : "") +
      (r.status === "resolved" ? '<div class="it-banner green"><b>Resolvido.</b> ' + esc(r.resolution || "") + '<div class="it-acts"><button class="pl-btn primary" id="rqOk">Confirmar solução</button><button class="pl-btn" id="rqReopen">Ainda não resolveu</button></div></div>' : "") +
      ((r.status === "closed" || r.status === "resolved") && !(r.csat && r.csat.score) ? '<div class="it-csat"><b>Como foi o atendimento?</b><div class="it-stars">' + [1, 2, 3, 4, 5].map(function (n) { return '<button data-star="' + n + '" aria-label="' + n + ' de 5">★</button>'; }).join("") + "</div></div>" : r.csat && r.csat.score ? '<p class="muted small">Sua avaliação: ' + "★".repeat(r.csat.score) + "</p>" : "") +
      '<dl class="it-dl"><dt>Aberto em</dt><dd>' + esc(fmtDT(r.created)) + "</dd>" + (off ? "<dt>Item do catálogo</dt><dd>" + esc(off.name) + "</dd>" : "") + (r.assignee ? "<dt>Responsável</dt><dd>" + esc(nameOf(r.assignee)) + "</dd>" : "") + "</dl>" +
      (r.desc ? '<p class="it-desc">' + esc(r.desc).replace(/\n/g, "<br>") + "</p>" : "") +
      (r.form && Object.keys(r.form).length ? '<dl class="it-dl">' + Object.keys(r.form).map(function (k) { return "<dt>" + esc(k) + "</dt><dd>" + esc(r.form[k]) + "</dd>"; }).join("") + "</dl>" : "") +
      '<h3 class="it-h3">Conversa</h3>' + thread(r.id, false) +
      (s.cat !== "done" || r.status === "resolved" ? '<div class="it-compose"><textarea id="cmTxt" rows="3" maxlength="4000" placeholder="Escreva uma mensagem para a equipe"></textarea><div class="pl-row-end"><button class="pl-btn primary" id="cmSend">' + IC("send", 14) + " Enviar</button></div></div>" : "") + "</div>";
  }
  function bindRequesterDrawer(d, r) {
    const send = d.querySelector("#cmSend"); if (send) send.onclick = function () { const t = d.querySelector("#cmTxt"); if (!t.value.trim()) return; send.disabled = true; addComment(r.id, t.value, false).then(function () { t.value = ""; send.disabled = false; toast("Mensagem enviada"); }); };
    const ok = d.querySelector("#rqOk"); if (ok) ok.onclick = function () { reqStatus(r, "closed", "Solicitante confirmou a solução"); };
    const ro = d.querySelector("#rqReopen"); if (ro) ro.onclick = function () { const t = d.querySelector("#cmTxt"); if (!t.value.trim()) { t.focus(); return toast("Conte o que ainda não funciona e clique de novo."); } addComment(r.id, t.value, false).then(function () { return reqStatus(r, "doing", "Reaberto pelo solicitante"); }); };
    d.querySelectorAll("[data-star]").forEach(function (b) { b.onclick = function () { const u = {}; u["records/" + r.id + "/csat"] = { score: Number(b.dataset.star), t: now() }; db.ref("itsm/" + ID + "/data").update(u).then(function () { toast("Obrigado pela avaliação!"); }, fail); }; });
  }
  function reqStatus(r, to, note) {
    const t = now(), u = {}, P = "records/" + r.id + "/";
    u[P + "status"] = to; u[P + "updated"] = t;
    if (to === "closed") u[P + "closedAt"] = t;
    if (to === "doing") { u[P + "resolvedAt"] = null; u[P + "reopened"] = (r.reopened || 0) + 1; u[P + "sla/stopAt"] = null; }
    const h = hist(r.id, "status", r.status, to, note); u[h[0]] = h[1];
    return db.ref("itsm/" + ID + "/data").update(u).then(function () { toast(to === "closed" ? "Chamado encerrado. Obrigado!" : "Chamado reaberto"); if (to === "doing") notify("itsm-comment", { rec: r.id }); }, fail);
  }
  function sel(name, options, cur, attrs) { return '<select name="' + name + '"' + (attrs || "") + ">" + options.map(function (o) { return opt(o[0], o[1], cur == null ? "" : cur); }).join("") + "</select>"; }
  function agentDrawer(r) {
    const s = I.status(r.kind, r.status), fl = I.flow(r.kind), svcs = list(Object.assign({}, (data.catalog || {}).services || {}, (data.catalog || {}).products || {})).sort(byName), cats = list((data.catalog || {}).categories).sort(byName);
    const ticket = isTicket(r), soc = r.kind === "security", cis = list((data.cmdb || {}).cis).sort(byName), ag = agents(), grp = groups();
    const moves = [[r.status, s.name + " (atual)"]].concat(s.next.map(function (n) { return [n, "→ " + I.status(r.kind, n).name]; }));
    const groupAgents = r.group && (S().groups || {})[r.group] && Object.keys((S().groups[r.group].members) || {}).length ? ag.filter(function (a) { return (S().groups[r.group].members || {})[a.k]; }) : ag;
    let h = '<header><span class="it-key">' + esc(r.key) + "</span>" + kindChip(r.kind) + (r.major ? '<span class="it-major">Incidente grave</span>' : "") + '<span class="sp"></span><button class="pl-btn icon ghost" id="dCopy" aria-label="Copiar link">' + IC("link", 16) + '</button><button class="pl-btn icon ghost" id="dClose" aria-label="Fechar">' + IC("close", 16) + '</button></header><div class="it-dbody">' +
      '<input class="it-dtitle" name="title" maxlength="140" value="' + esc(r.title) + '" aria-label="Título">' +
      '<div class="it-chips">' + stChip(r) + prioChip(r.priority) + vcChips(r) + (ticket ? slaChip(r, "resp") + (soc ? slaChip(r, "contain") : "") + slaChip(r, "res") : "") + (r.area ? '<span class="it-tag gray">' + IC("layers", 12) + " " + esc(areaName(r.area)) + "</span>" : "") + (r.viaMail ? '<span class="it-tag gray">' + IC("mail", 12) + " por e-mail</span>" : "") + "</div>" +
      '<div class="pl-form it-df"><div class="pl-2"><label>Status' + sel("status", moves, r.status) + "</label>" +
      (soc ? "<label>Severidade" + sel("severity", ["P1", "P2", "P3", "P4"].map(function (p) { return [p, p + " · " + I.SEV[p]]; }), r.priority || "P3") + "</label>" : r.kind !== "improvement" && r.kind !== "task" ? '<label>Impacto × urgência<span class="it-iu">' + sel("impact", I.LEVELS.map(function (l) { return [l, "Impacto " + I.LEVELN[l].toLowerCase()]; }), r.impact || "medium") + sel("urgency", I.LEVELS.map(function (l) { return [l, "Urgência " + I.URGN[l].toLowerCase()]; }), r.urgency || "medium") + "</span></label>" : "<span></span>") + "</div>" +
      (areas().length ? "<label>Área" + areaSelect("area", r.area) + "</label>" : "") +
      '<div class="pl-2"><label>Grupo' + sel("group", [["", "–"]].concat(grp.map(function (g) { return [g.id, g.name]; })), r.group || "") + "</label>" +
      "<label>Responsável" + sel("assignee", [["", "Sem responsável"]].concat(groupAgents.map(function (a) { return [a.email, a.name]; })), r.assignee || "") + "</label></div>" +
      '<div class="pl-2"><label>Serviço ou produto' + sel("service", [["", "–"]].concat(svcs.map(function (x) { return [x.id, x.name]; })), r.service || "") + "</label>" +
      (r.kind !== "change" && r.kind !== "improvement" ? "<label>Categoria" + sel("category", [["", "–"]].concat(cats.filter(function (c) { return !c.area || !r.area || c.area === r.area; }).map(function (c) { return [c.id, c.name]; })), r.category || "") + "</label>" : "<span></span>") + "</div>" +
      (r.kind !== "improvement" ? '<label>Itens de configuração (CMDB)<select name="cis" multiple size="' + Math.min(4, Math.max(2, cis.length)) + '">' + cis.map(function (c) { return '<option value="' + esc(c.id) + '"' + ((r.cis || {})[c.id] ? " selected" : "") + ">" + esc(c.name) + "</option>"; }).join("") + "</select></label>" : "") +
      '<label>Descrição<textarea name="desc" rows="4" maxlength="4000">' + esc(r.desc || "") + "</textarea></label></div>";
    if (r.requester) h += '<p class="small it-req">' + IC("people", 14) + " Solicitante: <b>" + esc(r.requester.name || r.requester.email) + "</b> · " + esc(r.requester.email || "") + " · aberto " + esc(fmtDT(r.created)) + "</p>";
    if (r.form && Object.keys(r.form).length) h += '<dl class="it-dl">' + Object.keys(r.form).map(function (k) { return "<dt>" + esc(k) + "</dt><dd>" + esc(r.form[k]) + "</dd>"; }).join("") + "</dl>";
    if (r.resolution) h += '<div class="it-banner green small"><b>' + esc(r.closeCode || "Solução") + ":</b> " + esc(r.resolution) + "</div>";
    if (r.parent) { const p = rec(r.parent); if (p) h += '<p class="small">Tarefa de <button class="link" data-open="' + esc(p.id) + '">' + esc(p.key + " " + p.title) + "</button></p>"; }
    h += kindSection(r);
    if (["problem", "change", "improvement"].indexOf(r.kind) >= 0) h += planSection(r);
    h += '<div class="it-acts it-aiacts">' + (r.kind === "incident" || r.kind === "request" || r.kind === "security" ? '<button class="pl-btn sm" id="aiTriage">' + IC("spark", 14) + " IA: sugerir categoria e prioridade</button>" : "") + "</div>";
    h += '<h3 class="it-h3">Atividade</h3>' + thread(r.id, true) +
      '<div class="it-compose"><textarea id="cmTxt" rows="3" maxlength="4000" placeholder="Responder ao solicitante ou registrar uma nota interna"></textarea><div class="pl-row-end"><label class="chk small"><input type="checkbox" id="cmInt"' + (r.requester && r.requester.k !== MEK ? "" : " checked") + "> Nota interna</label>" +
      (ticket ? '<button class="pl-btn sm" id="aiReply">' + IC("spark", 14) + " IA: sugerir resposta</button>" : "") + '<span class="sp"></span><button class="pl-btn primary" id="cmSend">' + IC("send", 14) + " Enviar</button></div></div>" +
      '<details class="it-hist"><summary>Histórico</summary><ul>' + Object.keys((data.history || {})[r.id] || {}).map(function (k) { return data.history[r.id][k]; }).sort(function (a, b) { return (b.t || 0) - (a.t || 0); }).map(function (x) { return "<li><span class=\"muted small\">" + esc(fmtDT(x.t)) + "</span> " + esc(x.by === "sistema" ? "Sistema" : nameOf(x.by)) + ": " + esc(histText(r, x)) + "</li>"; }).join("") + "</ul></details>" +
      (isMgr() ? '<div class="it-acts"><button class="pl-btn sm ghost danger" id="dDel">' + IC("trash", 14) + " Excluir registro</button></div>" : "") + "</div>";
    void fl;
    return h;
  }
  function histText(r, x) {
    const F = { status: "status", assignee: "responsável", group: "grupo", priority: "prioridade", created: "registro criado", approval: "aprovação", escalation: "escalonamento", link: "vínculo", major: "incidente grave" };
    if (x.field === "created") return "registro criado" + (x.to ? " (" + I.status(r.kind, x.to).name + ")" : "");
    let from = x.from, to = x.to;
    if (x.field === "status") { from = from && I.status(r.kind, from).name; to = to && I.status(r.kind, to).name; }
    if (x.field === "assignee") { from = from && nameOf(from); to = to && nameOf(to); }
    if (x.field === "group") { from = groupName(from); to = groupName(to); }
    return (F[x.field] || x.field) + (from || to ? ": " + (from || "–") + " → " + (to || "–") : "") + (x.note ? " · " + x.note : "");
  }
  function kindSection(r) {
    let h = "";
    if (r.kind === "incident") {
      const prb = r.problem && rec(r.problem);
      h += '<section class="it-sec"><h3>Gerenciamento de incidente</h3><div class="it-acts">' +
        '<label class="chk"><input type="checkbox" id="majT"' + (r.major ? " checked" : "") + "> Incidente grave (major incident)</label>" +
        '<button class="pl-btn sm" id="escF">' + IC("people", 14) + ' Escalonar (funcional)</button><button class="pl-btn sm" id="escH">' + IC("alert", 14) + " Escalonar (hierárquico)</button></div>" +
        (r.escalated ? '<p class="small muted">Escalonado hierarquicamente ' + esc(ago(r.escalated.t)) + " por " + esc(nameOf(r.escalated.by)) + "</p>" : "") +
        '<p class="small">Problema: ' + (prb ? '<button class="link" data-open="' + esc(prb.id) + '">' + esc(prb.key + " " + prb.title) + "</button> " + stChip(prb) + (prb.knownError && prb.knownError.workaround ? '<span class="it-ke"><b>Solução de contorno:</b> ' + esc(prb.knownError.workaround) + "</span>" : "") : '<button class="pl-btn sm" id="lnkPrb">Ligar a um problema</button> <button class="pl-btn sm" id="newPrb">Criar problema</button>') + "</p>";
      if (r.major) {
        const comms = list(r.comms).sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
        h += '<div class="it-major-box"><b>' + IC("alert", 15) + " Comunicação do incidente grave</b><p class=\"muted small\">Atualizações para partes interessadas (mostradas ao solicitante e enviadas por e-mail).</p>" +
          '<div class="it-acts"><button class="pl-btn sm" id="comAdd">' + IC("plus", 14) + ' Nova atualização</button><button class="pl-btn sm" id="aiSum">' + IC("spark", 14) + " IA: resumir para comunicação</button></div>" +
          (comms.length ? '<ul class="it-comms">' + comms.map(function (c) { return '<li><span class="muted small">' + esc(fmtDT(c.t)) + " · " + esc(nameOf(c.by)) + "</span><p>" + esc(c.text).replace(/\n/g, "<br>") + "</p></li>"; }).join("") + "</ul>" : "") + "</div>";
      }
      h += "</section>";
    }
    if (r.kind === "request") {
      const tasks = recs().filter(function (x) { return x.parent === r.id; }).sort(function (a, b) { return (a.created || 0) - (b.created || 0); });
      h += '<section class="it-sec"><h3>Cumprimento da requisição</h3>' + approvalBlock(r) +
        "<b class=\"small\">Tarefas</b>" + (tasks.length ? '<ul class="it-tasks">' + tasks.map(function (t) { return '<li><button class="link" data-open="' + esc(t.id) + '">' + esc(t.key + " " + t.title) + "</button> " + stChip(t) + ' <span class="muted small">' + esc(groupName(t.group)) + (t.assignee ? " · " + esc(nameOf(t.assignee)) : "") + "</span></li>"; }).join("") + "</ul>" : '<p class="muted small">Sem tarefas. Elas são criadas a partir da oferta quando o cumprimento começa.</p>') +
        '<form class="it-inlf" id="tkF"><input name="t" maxlength="140" placeholder="Nova tarefa"><select name="g">' + groups().map(function (g) { return opt(g.id, g.name, r.group || ""); }).join("") + '</select><button class="pl-btn sm">Adicionar</button></form></section>';
    }
    if (r.kind === "problem") {
      const inc = Object.keys(r.incidents || {}).map(rec).filter(Boolean), ch = Object.keys(r.changes || {}).map(rec).filter(Boolean), ke = r.knownError || {}, art = r.kb && (data.kb || {})[r.kb];
      h += '<section class="it-sec"><h3>Controle de problema</h3>' + (r.source === "trend" ? '<p class="small muted">' + IC("trend", 13) + " Identificado por tendência de incidentes.</p>" : "") +
        '<div class="pl-form"><label>Causa raiz<textarea name="ke_cause" rows="2" maxlength="2000">' + esc(ke.cause || "") + "</textarea></label><label>Solução de contorno<textarea name=\"ke_workaround\" rows=\"2\" maxlength=\"2000\">" + esc(ke.workaround || "") + "</textarea></label></div>" +
        '<div class="it-acts">' + (art ? '<button class="pl-btn sm" id="kbOpen">' + IC("kb", 14) + " Artigo: " + esc(art.title) + "</button>" : '<button class="pl-btn sm" id="kbPub"' + (ke.workaround ? "" : " disabled") + ">" + IC("kb", 14) + " Publicar erro conhecido na base</button>") + "</div>" +
        "<b class=\"small\">Incidentes ligados (" + inc.length + ")</b><ul class=\"it-tasks\">" + inc.map(function (x) { return '<li><button class="link" data-open="' + esc(x.id) + '">' + esc(x.key + " " + x.title) + "</button> " + stChip(x) + ' <button class="link small" data-unlinc="' + esc(x.id) + '">desligar</button></li>'; }).join("") + "</ul>" +
        '<div class="it-acts"><button class="pl-btn sm" id="incAdd">' + IC("link", 14) + " Ligar incidentes</button></div>" +
        "<b class=\"small\">Mudanças para a solução definitiva</b><ul class=\"it-tasks\">" + ch.map(function (x) { return '<li><button class="link" data-open="' + esc(x.id) + '">' + esc(x.key + " " + x.title) + "</button> " + stChip(x) + "</li>"; }).join("") + "</ul>" +
        '<div class="it-acts"><button class="pl-btn sm" id="chgNew">' + IC("change", 14) + " Criar mudança</button><button class=\"pl-btn sm\" id=\"impNew\">" + IC("improvement", 14) + " Registrar melhoria</button></div></section>";
    }
    if (r.kind === "change") {
      const rk = I.risk((r.risk || {}).answers), w = r.window || {}, pl = r.plan || {}, pir = r.pir || {};
      h += '<section class="it-sec"><h3>Habilitação de mudança</h3><div class="pl-form"><div class="pl-2"><label>Tipo' + sel("changeType", Object.keys(I.CHANGE_TYPES).map(function (k) { return [k, I.CHANGE_TYPES[k]]; }), r.changeType || "normal") + "</label>" +
        '<label>Risco<span class="it-risk r-' + (rk.level || "none") + '">' + (rk.level ? I.RISKN[rk.level] + " (" + rk.score + " pts)" : "Responda a avaliação") + "</span></label></div>" +
        '<details class="it-riskq"' + (I.RISK_Q.every(function (q) { return ((r.risk || {}).answers || {})[q.id]; }) ? "" : " open") + "><summary>Avaliação de risco</summary>" + I.RISK_Q.map(function (q) { return "<label>" + esc(q.q) + sel("risk_" + q.id, [["", "–"]].concat(q.opts.map(function (o) { return [o[1], o[0]]; })), ((r.risk || {}).answers || {})[q.id] || "") + "</label>"; }).join("") + "</details>" +
        '<div class="pl-2"><label>Início da janela<input type="datetime-local" name="w_start" value="' + esc(toLocalInput(w.start)) + '"></label><label>Fim da janela<input type="datetime-local" name="w_end" value="' + esc(toLocalInput(w.end)) + '"></label></div>' +
        '<label>Plano de implementação<textarea name="p_impl" rows="2" maxlength="2000">' + esc(pl.impl || "") + '</textarea></label><label>Plano de teste<textarea name="p_test" rows="2" maxlength="2000">' + esc(pl.test || "") + '</textarea></label><label>Plano de retorno (backout)<textarea name="p_backout" rows="2" maxlength="2000">' + esc(pl.backout || "") + "</textarea></label>" +
        '<label class="chk"><input type="checkbox" name="devLinked"' + (r.devLinked ? " checked" : "") + "> Envolve desenvolvimento (Obter/construir · Construir)</label>" +
        '<label class="chk"><input type="checkbox" name="acquire"' + (r.acquire ? " checked" : "") + "> Envolve compra ou fornecedor (ITIL 5 · Adquirir)</label>" +
        '<label class="chk"><input type="checkbox" name="onRoadmap"' + (r.onRoadmap ? " checked" : "") + "> Mostrar como marco no roadmap dos planejamentos conectados (quando aprovada)</label></div>" +
        approvalBlock(r) +
        (["implemented", "failed", "reviewed", "closed"].indexOf(r.status) >= 0 ? '<div class="pl-form it-pir"><b>Revisão pós-implementação (PIR)</b><label>Resultado' + sel("pir_result", [["", "–"], ["success", "Bem-sucedida"], ["partial", "Parcial"], ["failed", "Falhou (retornada)"]], pir.result || "") + '</label><label>Lições aprendidas<textarea name="pir_notes" rows="2" maxlength="2000">' + esc(pir.notes || "") + "</textarea></label></div>" : "") +
        (r.problem ? '<p class="small">Problema: <button class="link" data-open="' + esc(r.problem) + '">' + esc((rec(r.problem) || {}).key || "") + "</button></p>" : "") + "</section>";
    }
    if (r.kind === "security") {
      const lg = r.lgpd || {}, due = lg.personal && lg.knownAt ? I.lgpdDue(lg.knownAt, lg.small) : null;
      const dueChip = function (t, done, label) { if (!t) return ""; const left = Math.ceil((t - now()) / DAY); const cls = done ? "c-done" : left < 0 ? "c-red" : left <= 1 ? "c-wait" : "c-doing"; return '<span class="it-st ' + cls + '">' + esc(label) + ": " + esc(fmtD(t)) + (done ? " ✓" : left < 0 ? " (vencido)" : " (" + left + (left === 1 ? " dia)" : " dias)")) + "</span>"; };
      h += '<section class="it-sec it-soc"><h3>' + IC("shield", 16) + ' Resposta a incidente de segurança (SOC)</h3><div class="pl-form">' +
        '<div class="pl-2"><label>Categoria' + sel("soc_cat", [["", "–"]].concat(Object.keys(I.SOC_CATS).map(function (k) { return [k, I.SOC_CATS[k]]; })), r.socCat || "") + "</label>" +
        "<label>Tática (MITRE ATT&CK)" + sel("soc_mitre", [["", "–"]].concat(I.MITRE.map(function (m) { return [m, m]; })), r.mitre || "") + "</label></div>" +
        '<div class="pl-2"><label>Origem da detecção' + sel("soc_src", [["", "–"], ["siem", "SIEM / alerta"], ["edr", "EDR / antivírus"], ["user", "Usuário"], ["mail", "Gateway de e-mail"], ["third", "Terceiro / fornecedor"], ["threat", "Inteligência de ameaças"]], r.detection || "") + "</label>" +
        '<label>Detectado em<input type="datetime-local" name="soc_detected" value="' + esc(toLocalInput(r.detectedAt || r.created)) + '"></label></div>' +
        '<label>Indicadores de comprometimento (IoCs)<textarea name="soc_iocs" rows="3" maxlength="4000" placeholder="IPs, domínios, hashes, remetentes…">' + esc(r.iocs || "") + "</textarea></label>" +
        '<label>Ações de contenção e erradicação<textarea name="soc_actions" rows="3" maxlength="4000">' + esc(r.actions || "") + "</textarea></label></div>" +
        '<div class="it-lgpd"><label class="chk"><input type="checkbox" name="lg_personal"' + (lg.personal ? " checked" : "") + "> Envolve dados pessoais com risco ou dano relevante aos titulares (LGPD)</label>" +
        (lg.personal ? '<div class="pl-form"><div class="pl-2"><label>Ciência do incidente com dados pessoais<input type="datetime-local" name="lg_known" value="' + esc(toLocalInput(lg.knownAt || r.created)) + '"></label>' +
          '<label class="chk it-chkpad"><input type="checkbox" name="lg_small"' + (lg.small ? " checked" : "") + "> Agente de pequeno porte (prazo em dobro)</label></div>" +
          '<div class="it-chips">' + dueChip(due && due.notify, lg.anpdAt && lg.subjectsAt, "Comunicar ANPD e titulares") + dueChip(due && due.complement, lg.complementAt, "Complemento") + "</div>" +
          '<div class="it-pick it-lgck">' + [["anpdAt", "Comunicação à ANPD enviada"], ["subjectsAt", "Titulares comunicados"], ["complementAt", "Complemento enviado à ANPD"]].map(function (x) { return '<label class="chk"><input type="checkbox" data-lg="' + x[0] + '"' + (lg[x[0]] ? " checked" : "") + "> " + esc(x[1]) + (lg[x[0]] ? ' <span class="muted small">' + esc(fmtDT(lg[x[0]])) + "</span>" : "") + "</label>"; }).join("") + "</div>" +
          '<p class="muted small">Resolução CD/ANPD nº 15/2024: 3 dias úteis a partir da ciência (6 para agente de pequeno porte); complemento em até 20 dias úteis. Feriados não são descontados.</p></div>' : "") + "</div>" +
        (r.problem ? '<p class="small">Problema: <button class="link" data-open="' + esc(r.problem) + '">' + esc((rec(r.problem) || {}).key || "") + "</button></p>" : '<div class="it-acts"><button class="pl-btn sm" id="newPrb">Criar problema (causa raiz)</button></div>') + "</section>";
    }
    if (r.kind === "improvement") {
      h += '<section class="it-sec"><h3>Registro de melhoria (melhoria contínua)</h3><div class="pl-form"><label>Origem' + sel("origin", [["idea", "Ideia ou sugestão"], ["problem", "Problema"], ["sla", "Resultado de SLA"], ["dashboard", "Indicador do painel"], ["csat", "Pesquisa de satisfação"]], r.origin || "idea") + "</label>" +
        '<label>Benefício esperado<textarea name="benefit" rows="2" maxlength="1000">' + esc(r.benefit || "") + '</textarea></label><div class="pl-2"><label>Medida de sucesso (indicador)<input name="measure" maxlength="140" value="' + esc(r.measure || "") + '"></label><label>Meta<input name="target" maxlength="80" value="' + esc(r.target || "") + '"></label></div>' +
        '<label>Resultado medido<input name="result" maxlength="200" value="' + esc(r.result || "") + '"></label></div>' + (r.problem ? '<p class="small">Problema de origem: <button class="link" data-open="' + esc(r.problem) + '">' + esc((rec(r.problem) || {}).key || "") + "</button></p>" : "") + "</section>";
    }
    return h;
  }
  function approvalBlock(r) {
    if (r.kind === "change" && r.changeType === "standard") return '<p class="small muted">Mudança padrão: pré-aprovada pelo modelo, não passa pela autoridade de mudança.</p>';
    const ap = r.approvers || {}, got = r.approvals || {}, st = approvalState(r), ppl = people();
    const waiting = (r.kind === "request" && r.status === "approval") || (r.kind === "change" && r.status === "assess");
    const mine = ap[MEK] && !got[MEK] && waiting;
    return '<div class="it-appr"><b class="small">' + (r.kind === "change" ? (r.changeType === "emergency" ? "Autoridade de mudança emergencial" : "Autoridade de mudança (CAB)") : "Aprovação") + "</b>" +
      (Object.keys(ap).length ? '<ul class="it-tasks">' + Object.keys(ap).map(function (k) { const g = got[k]; return "<li>" + avatar((ppl[k] || {}).email || k) + " " + esc((ppl[k] || {}).name || k.replace(/,/g, ".")) + " – " + (g ? (g.d === "approve" ? '<span class="it-st c-done">aprovou</span>' : '<span class="it-st c-red">rejeitou</span>') + (g.note ? ' <span class="muted small">“' + esc(g.note) + "”</span>" : "") : '<span class="muted small">pendente</span>') + "</li>"; }).join("") + "</ul>" + '<p class="muted small">Regra: ' + esc({ all: "todos aprovam", majority: "maioria aprova", any: "basta uma aprovação" }[st.rule]) + " · " + st.ok + "/" + st.n + "</p>" : '<p class="muted small">Nenhum aprovador definido.</p>') +
      (isMgr() ? '<button class="pl-btn sm" id="apEdit">' + IC("people", 14) + " Definir aprovadores</button>" : "") +
      (mine || (waiting && !Object.keys(ap).length && isMgr()) ? '<div class="it-acts"><input id="apNote" maxlength="200" placeholder="Comentário (opcional)"><button class="pl-btn primary sm" id="apYes">Aprovar</button><button class="pl-btn sm danger" id="apNo">Rejeitar</button></div>' : "") + "</div>";
  }
  function decide(r, d, note) {
    const u = {}; u["records/" + r.id + "/approvals/" + MEK] = { d: d, t: now(), note: note || null }; u["records/" + r.id + "/updated"] = now();
    const h = hist(r.id, "approval", null, d === "approve" ? "aprovou" : "rejeitou", note); u[h[0]] = h[1];
    return db.ref("itsm/" + ID + "/data").update(u).then(function () {
      const nr = rec(r.id); nr.approvals = Object.assign({}, nr.approvals || {}); nr.approvals[MEK] = { d: d };
      if (!Object.keys(nr.approvers || {}).length) nr.approvers = {}, nr.approvers[MEK] = true;
      const st = approvalState(nr);
      if (st.rejected || d === "reject") return changeStatus(nr, "rejected", { note: "Rejeitado na aprovação" });
      if (st.done) return changeStatus(nr, r.kind === "change" ? "approved" : "doing");
    }).catch(fail);
  }
  function planSection(r) {
    const links = r.planLinks || {}, ms = r.milestones || {}, plans = Object.keys((info && info.plans) || {});
    return '<section class="it-sec"><h3>' + IC("planning", 16) + " Planejamento</h3>" +
      (Object.keys(links).length || Object.keys(ms).length ? '<ul class="it-tasks" id="plLinks">' + Object.keys(links).map(function (p) { return '<li data-pl="' + esc(p) + "|" + esc(links[p]) + '"><a href="../planning/?id=' + encodeURIComponent(p) + "&item=" + encodeURIComponent(links[p]) + '">' + IC("planning", 13) + " <span class=\"pl-n\">" + esc(p) + '</span></a> <span class="muted small pl-s">…</span></li>'; }).join("") +
        Object.keys(ms).map(function (p) { return '<li><a href="../planning/?id=' + encodeURIComponent(p) + "&item=" + encodeURIComponent(ms[p]) + '">' + IC("milestone", 13) + " Marco no roadmap · " + esc(p) + "</a></li>"; }).join("") + "</ul>" : '<p class="muted small">' + (plans.length ? "Ainda não está em nenhum planejamento." : "Nenhum planejamento conectado. Um gestor conecta em Configurações.") + "</p>") +
      (plans.length ? '<button class="pl-btn sm" id="toPlan">' + IC("link", 14) + " Levar para o planejamento</button>" : "") + "</section>";
  }
  function bindAgentDrawer(d, r) {
    const P = "records/" + r.id + "/";
    const save = function (patch, field) { return updateRec(r.id, patch, field); };
    d.querySelector("#dCopy").onclick = function () { const u = location.origin + location.pathname + "?id=" + encodeURIComponent(ID) + "&rec=" + encodeURIComponent(r.id); (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { toast("Link copiado"); }, function () { window.prompt("Link", u); }); };
    const ti = d.querySelector(".it-dtitle"); ti.onchange = function () { if (ti.value.trim()) save({ title: ti.value.trim() }); };
    const f = d.querySelector(".it-df");
    f.querySelector("[name=status]").onchange = function () { const v = this.value; this.value = r.status; changeStatus(r, v); };
    const sevSel = f.querySelector("[name=severity]"); if (sevSel) sevSel.onchange = function () { save({ priority: sevSel.value }, "priority"); };
    const arSel = f.querySelector("[name=area]"); if (arSel) arSel.onchange = function () { save({ area: arSel.value || null }, "area"); };
    const im = f.querySelector("[name=impact]"); if (im) { im.onchange = function () { save({ impact: im.value }); }; f.querySelector("[name=urgency]").onchange = function () { save({ urgency: this.value }); }; }
    f.querySelector("[name=group]").onchange = function () { save({ group: this.value || null }, "group"); };
    f.querySelector("[name=assignee]").onchange = function () { assign(r, this.value || null); };
    f.querySelector("[name=service]").onchange = function () { save({ service: this.value || null }); };
    const ca = f.querySelector("[name=category]"); if (ca) ca.onchange = function () { save({ category: ca.value || null }); };
    const ci = f.querySelector("[name=cis]"); if (ci) ci.onchange = function () { const o = {}; Array.prototype.forEach.call(ci.selectedOptions, function (x) { o[x.value] = true; }); save({ cis: Object.keys(o).length ? o : null }); };
    f.querySelector("[name=desc]").onchange = function () { save({ desc: this.value.trim() }); };
    /* incident */
    const mj = d.querySelector("#majT"); if (mj) mj.onchange = function () { const u = {}; u[P + "major"] = mj.checked || null; const h = hist(r.id, "major", null, mj.checked ? "sim" : "não"); u[h[0]] = h[1]; if (mj.checked && r.priority !== "P1") { u[P + "priority"] = "P1"; u[P + "impact"] = "high"; u[P + "urgency"] = "high"; } db.ref("itsm/" + ID + "/data").update(u).then(function () { if (mj.checked) notify("itsm-major", { rec: r.id }); }, fail); };
    const ef = d.querySelector("#escF"); if (ef) ef.onclick = function () { escalateFunctional(r); };
    const eh = d.querySelector("#escH"); if (eh) eh.onclick = function () { escalateHier(r); };
    const lp = d.querySelector("#lnkPrb"); if (lp) lp.onclick = function () { pickRecords("problem", false, function (ids) { if (!ids[0]) return; const u = {}; u[P + "problem"] = ids[0]; u["records/" + ids[0] + "/incidents/" + r.id] = true; db.ref("itsm/" + ID + "/data").update(u).catch(fail); }); };
    const np = d.querySelector("#newPrb"); if (np) np.onclick = function () { createRecord({ kind: "problem", title: r.title, desc: "Aberto a partir de " + r.key + ".\n" + (r.desc || ""), service: r.service, category: r.category, cis: r.cis, impact: r.impact, urgency: r.urgency, incidents: (function () { const o = {}; o[r.id] = true; return o; })() }).then(function (pid) { return db.ref("itsm/" + ID + "/data/" + P + "problem").set(pid).then(function () { openDrawer(pid); }); }).catch(fail); };
    const ca2 = d.querySelector("#comAdd"); if (ca2) ca2.onclick = function () { commDialog(r, ""); };
    const as = d.querySelector("#aiSum"); if (as) as.onclick = function () { aiMajorSummary(r); };
    /* request */
    const tk = d.querySelector("#tkF"); if (tk) tk.onsubmit = function (e) { e.preventDefault(); const t = tk.t.value.trim(); if (!t) return; createRecord({ kind: "task", title: t, parent: r.id, group: tk.g.value, requester: r.requester }).then(function () { tk.t.value = ""; }, fail); };
    const ae = d.querySelector("#apEdit"); if (ae) ae.onclick = function () { approversDialog(r); };
    const ay = d.querySelector("#apYes"); if (ay) ay.onclick = function () { decide(r, "approve", (d.querySelector("#apNote") || {}).value); };
    const an = d.querySelector("#apNo"); if (an) an.onclick = function () { decide(r, "reject", (d.querySelector("#apNote") || {}).value); };
    /* problem */
    d.querySelectorAll("[name=ke_cause],[name=ke_workaround]").forEach(function (x) { x.onchange = function () { const u = {}; u[P + "knownError/" + x.name.slice(3)] = x.value.trim() || null; u[P + "updated"] = now(); db.ref("itsm/" + ID + "/data").update(u).catch(fail); }; });
    const kp = d.querySelector("#kbPub"); if (kp) kp.onclick = function () { const ke = r.knownError || {}; editArticle(null, { title: "Erro conhecido: " + r.title, body: "Sintoma\n" + (r.desc || "") + "\n\nCausa\n" + (ke.cause || "") + "\n\nSolução de contorno\n" + (ke.workaround || ""), problem: r.id, service: r.service, category: r.category, status: "published" }); };
    const ko = d.querySelector("#kbOpen"); if (ko) ko.onclick = function () { viewArticle(r.kb, false); };
    const ia = d.querySelector("#incAdd"); if (ia) ia.onclick = function () { pickRecords("incident", true, function (ids) { const u = {}; ids.forEach(function (i) { u[P + "incidents/" + i] = true; u["records/" + i + "/problem"] = r.id; }); if (ids.length) db.ref("itsm/" + ID + "/data").update(u).catch(fail); }, function (x) { return !x.problem; }); };
    d.querySelectorAll("[data-unlinc]").forEach(function (b) { b.onclick = function () { const u = {}; u[P + "incidents/" + b.dataset.unlinc] = null; u["records/" + b.dataset.unlinc + "/problem"] = null; db.ref("itsm/" + ID + "/data").update(u).catch(fail); }; });
    const cn = d.querySelector("#chgNew"); if (cn) cn.onclick = function () { const cab = (S().cab || {}).normal; createRecord({ kind: "change", changeType: "normal", title: "Solução definitiva – " + r.title, desc: "Mudança para eliminar a causa do problema " + r.key + ".", service: r.service, cis: r.cis, problem: r.id, impact: r.impact, urgency: r.urgency, approvers: cab || null }).then(function (cid) { return db.ref("itsm/" + ID + "/data/" + P + "changes/" + cid).set(true).then(function () { openDrawer(cid); }); }).catch(fail); };
    const inw = d.querySelector("#impNew"); if (inw) inw.onclick = function () { createRecord({ kind: "improvement", title: "Melhoria – " + r.title, origin: "problem", problem: r.id, service: r.service }).then(openDrawer, fail); };
    /* change */
    const ct = d.querySelector("[name=changeType]"); if (ct) ct.onchange = function () { const p = { changeType: ct.value }; if (ct.value !== "standard" && !Object.keys(r.approvers || {}).length) { const cab = (S().cab || {})[ct.value === "emergency" ? "emergency" : "normal"]; if (cab) p.approvers = cab; } save(p); };
    d.querySelectorAll("[name^=risk_]").forEach(function (x) { x.onchange = function () { const ans = Object.assign({}, (r.risk || {}).answers || {}); ans[x.name.slice(5)] = x.value ? Number(x.value) : null; const rk = I.risk(ans); save({ risk: { answers: ans, score: rk.score, level: rk.level } }); }; });
    d.querySelectorAll("[name=w_start],[name=w_end]").forEach(function (x) { x.onchange = function () { const w = Object.assign({}, r.window || {}); w[x.name.slice(2)] = fromLocalInput(x.value); if (w.end && w.start && w.end < w.start) return toast("O fim da janela não pode ser antes do início."); save({ window: w }).then(function () { syncPlans(rec(r.id)); }); }; });
    d.querySelectorAll("[name^=p_]").forEach(function (x) { x.onchange = function () { const u = {}; u[P + "plan/" + x.name.slice(2)] = x.value.trim() || null; db.ref("itsm/" + ID + "/data").update(u).catch(fail); }; });
    ["devLinked", "acquire", "onRoadmap"].forEach(function (n) { const x = d.querySelector("[name=" + n + "]"); if (x) x.onchange = function () { const p = {}; p[n] = x.checked || null; save(p).then(function () { if (n === "onRoadmap") syncPlans(rec(r.id)); }); }; });
    d.querySelectorAll("[name^=pir_]").forEach(function (x) { x.onchange = function () { const u = {}; u[P + "pir/" + x.name.slice(4)] = x.value.trim() || null; db.ref("itsm/" + ID + "/data").update(u).catch(fail); }; });
    /* SOC */
    [["soc_cat", "socCat"], ["soc_mitre", "mitre"], ["soc_src", "detection"], ["soc_iocs", "iocs"], ["soc_actions", "actions"]].forEach(function (x) { const e = d.querySelector("[name=" + x[0] + "]"); if (e) e.onchange = function () { const p = {}; p[x[1]] = e.value.trim() || null; save(p); }; });
    const sd = d.querySelector("[name=soc_detected]"); if (sd) sd.onchange = function () { save({ detectedAt: fromLocalInput(sd.value) }); };
    const lgp = d.querySelector("[name=lg_personal]"); if (lgp) lgp.onchange = function () { const lg = Object.assign({}, r.lgpd || {}, { personal: lgp.checked }); if (lgp.checked && !lg.knownAt) lg.knownAt = now(); save({ lgpd: lg }); };
    const lk = d.querySelector("[name=lg_known]"); if (lk) lk.onchange = function () { save({ lgpd: Object.assign({}, r.lgpd || {}, { knownAt: fromLocalInput(lk.value) }) }); };
    const ls = d.querySelector("[name=lg_small]"); if (ls) ls.onchange = function () { save({ lgpd: Object.assign({}, r.lgpd || {}, { small: ls.checked }) }); };
    d.querySelectorAll("[data-lg]").forEach(function (c) { c.onchange = function () { const lg = Object.assign({}, r.lgpd || {}); lg[c.dataset.lg] = c.checked ? now() : null; save({ lgpd: lg }); }; });
    /* improvement */
    ["origin", "benefit", "measure", "target", "result"].forEach(function (n) { const x = d.querySelector(".it-sec [name=" + n + "]"); if (x) x.onchange = function () { const p = {}; p[n] = x.value.trim() || null; save(p); }; });
    /* planning */
    const tp = d.querySelector("#toPlan"); if (tp) tp.onclick = function () { linkToPlan(r); };
    loadPlanStatus(d, r);
    /* AI */
    const at = d.querySelector("#aiTriage"); if (at) at.onclick = function () { aiTriage(r); };
    const ar = d.querySelector("#aiReply"); if (ar) ar.onclick = function () { aiReply(r, d); };
    /* conversation */
    const send = d.querySelector("#cmSend"); send.onclick = function () {
      const t = d.querySelector("#cmTxt"), internal = d.querySelector("#cmInt").checked; if (!t.value.trim()) return;
      const sug = d.dataset.aiReply; send.disabled = true;
      addComment(r.id, t.value, internal).then(function () {
        if (sug) { const u = {}; u[P + "ai/reply"] = t.value.trim() === sug.trim() ? "accepted" : "edited"; db.ref("itsm/" + ID + "/data").update(u); d.dataset.aiReply = ""; }
        t.value = ""; send.disabled = false;
      });
    };
    d.querySelector("#cmTxt").onkeydown = function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send.click(); };
    const dl = d.querySelector("#dDel"); if (dl) dl.onclick = function () { confirmBox("Excluir " + r.key, "O registro, a conversa e o histórico serão apagados. Prefira encerrar ou cancelar para manter o histórico.", "Excluir", true).then(function (ok) { if (!ok) return; const u = {}; ["records", "comments", "notes", "history"].forEach(function (n) { u[n + "/" + r.id] = null; }); db.ref("itsm/" + ID + "/data").update(u).then(function () { if (r.requester) db.ref("itsm/" + ID + "/mine/" + r.requester.k + "/" + r.id).remove(); closeDrawer(); }, fail); }); };
  }
  function pickRecords(kind, multi, cb, filt) {
    const rs = recs().filter(function (x) { return x.kind === kind && !I.isDone(x) && (!filt || filt(x)); }).sort(function (a, b) { return (b.created || 0) - (a.created || 0); });
    if (!rs.length) return toast("Nenhum " + KN[kind].name.toLowerCase() + " aberto disponível.");
    modal("<h2>Escolher " + esc(KN[kind].plural.toLowerCase()) + '</h2><form class="pl-form" id="pkF"><div class="it-pick">' + rs.map(function (x) { return '<label class="chk"><input type="' + (multi ? "checkbox" : "radio") + '" name="r" value="' + esc(x.id) + '"> <span><b>' + esc(x.key) + "</b> " + esc(x.title) + ' <span class="muted small">' + esc(svcName(x.service)) + "</span></span></label>"; }).join("") + "</div>" +
      '<div class="pl-row-end"><button type="button" class="pl-btn" data-close>Cancelar</button><button class="pl-btn primary">Ligar</button></div></form>', function (w, close) {
      const f = w.querySelector("#pkF"); f.onsubmit = function (e) { e.preventDefault(); const ids = Array.prototype.map.call(f.querySelectorAll("[name=r]:checked"), function (x) { return x.value; }); close(); cb(ids); };
    });
  }
  function escalateFunctional(r) {
    modal("<h2>Escalonamento funcional</h2><p class=\"muted small\">Passa o registro para um grupo com mais conhecimento técnico.</p><form class=\"pl-form\" id=\"efF\"><label>Novo grupo" + sel("g", groups().filter(function (g) { return g.id !== r.group; }).map(function (g) { return [g.id, g.name]; }), "") + '</label><label>Motivo<textarea name="why" rows="2" required maxlength="500"></textarea></label><div class="pl-row-end"><button type="button" class="pl-btn" data-close>Cancelar</button><button class="pl-btn primary">Escalonar</button></div></form>', function (w, close) {
      const f = w.querySelector("#efF"); f.onsubmit = function (e) {
        e.preventDefault(); const u = {}, P = "records/" + r.id + "/";
        u[P + "group"] = f.g.value; u[P + "assignee"] = null; u[P + "updated"] = now();
        const h = hist(r.id, "escalation", groupName(r.group), groupName(f.g.value), "Funcional: " + f.why.value.trim()); u[h[0]] = h[1];
        u["notes/" + r.id + "/" + pushId()] = { by: me.email, name: nameOf(me.email), t: now(), text: "Escalonamento funcional para " + groupName(f.g.value) + ": " + f.why.value.trim() };
        db.ref("itsm/" + ID + "/data").update(u).then(function () { close(); toast("Escalonado para " + groupName(f.g.value)); notify("itsm-escalated", { rec: r.id, mode: "functional" }); }, fail);
      };
    });
  }
  function escalateHier(r) {
    const lead = ((S().groups || {})[r.group] || {}).lead;
    modal("<h2>Escalonamento hierárquico</h2><p class=\"muted small\">Avisa a gestão (líder do grupo" + (lead ? ": " + esc(nameOf(lead)) : "") + " e gestores da central) para decidir prioridade, recursos ou comunicação.</p><form class=\"pl-form\" id=\"ehF\"><label>Motivo<textarea name=\"why\" rows=\"3\" required maxlength=\"500\"></textarea></label><div class=\"pl-row-end\"><button type=\"button\" class=\"pl-btn\" data-close>Cancelar</button><button class=\"pl-btn primary\">Escalonar</button></div></form>", function (w, close) {
      const f = w.querySelector("#ehF"); f.onsubmit = function (e) {
        e.preventDefault(); const u = {}, P = "records/" + r.id + "/";
        u[P + "escalated"] = { by: me.email, t: now(), why: f.why.value.trim(), level: ((r.escalated || {}).level || 0) + 1 };
        const h = hist(r.id, "escalation", null, "gestão", "Hierárquico: " + f.why.value.trim()); u[h[0]] = h[1];
        u["notes/" + r.id + "/" + pushId()] = { by: me.email, name: nameOf(me.email), t: now(), text: "Escalonamento hierárquico: " + f.why.value.trim() };
        db.ref("itsm/" + ID + "/data").update(u).then(function () { close(); toast("Gestão avisada"); notify("itsm-escalated", { rec: r.id, mode: "hierarchical" }); }, fail);
      };
    });
  }
  function commDialog(r, text) {
    modal('<h2>Atualização do incidente grave</h2><form class="pl-form" id="cmF"><label>Texto para as partes interessadas<textarea name="t" rows="6" required maxlength="3000">' + esc(text || "") + '</textarea></label><label class="chk"><input type="checkbox" name="pub" checked> Mostrar também na conversa com o solicitante</label><div class="pl-row-end"><button type="button" class="pl-btn" data-close>Cancelar</button><button class="pl-btn primary">Publicar</button></div></form>', function (w, close) {
      const f = w.querySelector("#cmF"); f.onsubmit = function (e) {
        e.preventDefault(); const u = {}, t = now(), txt = f.t.value.trim();
        u["records/" + r.id + "/comms/" + pushId()] = { by: me.email, t: t, text: txt };
        if (f.pub.checked) u["comments/" + r.id + "/" + pushId()] = { by: me.email, name: nameOf(me.email), t: t, text: "Atualização: " + txt, sys: true };
        u["records/" + r.id + "/updated"] = t;
        db.ref("itsm/" + ID + "/data").update(u).then(function () { close(); notify("itsm-major", { rec: r.id, update: true }); }, fail);
      };
    }, true);
  }
  function approversDialog(r) {
    const ppl = Object.keys(people()).map(function (k) { return people()[k]; }).sort(byName), ap = r.approvers || {};
    modal('<h2>Aprovadores</h2><form class="pl-form" id="apF"><div class="it-pick">' + ppl.map(function (p) { return '<label class="chk"><input type="checkbox" name="a" value="' + esc(p.k) + '"' + (ap[p.k] ? " checked" : "") + "> " + esc(p.name) + ' <span class="muted small">' + esc(p.email) + "</span></label>"; }).join("") + '</div><div class="pl-row-end"><button type="button" class="pl-btn" data-close>Cancelar</button><button class="pl-btn primary">Salvar</button></div></form>', function (w, close) {
      const f = w.querySelector("#apF"); f.onsubmit = function (e) { e.preventDefault(); const o = {}; f.querySelectorAll("[name=a]:checked").forEach(function (x) { o[x.value] = true; }); updateRec(r.id, { approvers: Object.keys(o).length ? o : null }).then(function () { close(); if (Object.keys(o).length) notify("itsm-change-approval", { rec: r.id }); }); };
    });
  }

  /* ---------------- connection with Planning ---------------- */
  function planTitle(pid) { return db.ref("planning/" + pid + "/info").once("value").then(function (s) { return s.val() || null; }, function () { return null; }); }
  function loadPlanStatus(d, r) {
    d.querySelectorAll("[data-pl]").forEach(function (li) {
      const p = li.dataset.pl.split("|");
      Promise.all([planTitle(p[0]), db.ref("planning/" + p[0] + "/data/items/" + p[1]).once("value").then(function (s) { return s.val(); }, function () { return null; }), db.ref("planning/" + p[0] + "/data/settings/statuses").once("value").then(function (s) { return s.val(); }, function () { return null; })]).then(function (x) {
        const inf = x[0], it = x[1], sts = x[2] || ((window.PLAN_METHODS || {})[(inf || {}).method] || {}).statuses || [];
        const n = li.querySelector(".pl-n"), s = li.querySelector(".pl-s");
        if (n && inf) n.textContent = inf.title;
        if (s) { if (!it) s.textContent = "item removido ou sem acesso"; else { const st = sts.find(function (q) { return q.id === it.status; }); s.textContent = (it.key || "") + " · " + (st ? st.name : it.status) + (it.doneAt ? " · concluído no planejamento" : ""); } }
      });
    });
  }
  function linkToPlan(r) {
    const plans = Object.keys(info.plans || {});
    Promise.all(plans.map(function (p) { return planTitle(p).then(function (x) { return { id: p, info: x }; }); })).then(function (ps) {
      ps = ps.filter(function (p) { return p.info; });
      if (!ps.length) return toast("Sem acesso aos planejamentos conectados.");
      const defT = r.kind === "improvement" ? "initiative" : r.kind === "change" ? "epic" : "task";
      modal("<h2>Levar " + esc(r.key) + ' para o planejamento</h2><form class="pl-form" id="lpF"><label>Planejamento' + sel("p", ps.map(function (p) { return [p.id, p.info.title]; }), ps[0].id) + "</label>" +
        "<label>Tipo de item" + sel("t", [["initiative", "Iniciativa"], ["epic", "Épico"], ["task", "Tarefa"], ["story", "História"], ["milestone", "Marco"]], defT) + "</label>" +
        '<label>Dentro de (opcional)<select name="parent"><option value="">–</option></select></label>' +
        '<p class="muted small">O item leva o selo ' + esc(r.key) + " com o status do ITSM e um link de volta para este registro.</p>" +
        '<div class="pl-row-end"><button type="button" class="pl-btn" data-close>Cancelar</button><button class="pl-btn primary">Criar item</button></div></form>', function (w, close) {
        const f = w.querySelector("#lpF");
        function loadParents() {
          db.ref("planning/" + f.p.value + "/data/items").once("value").then(function (s) {
            const it = s.val() || {}; f.parent.innerHTML = '<option value="">–</option>' + Object.keys(it).filter(function (k) { return ["initiative", "epic", "phase"].indexOf(it[k].type) >= 0; }).map(function (k) { return opt(k, (it[k].key ? it[k].key + " " : "") + it[k].title, ""); }).join("");
          }, function () { /* ignore */ });
        }
        f.p.onchange = loadParents; loadParents();
        f.onsubmit = function (e) {
          e.preventDefault(); f.querySelector(".primary").disabled = true;
          createPlanItem(f.p.value, r, f.t.value, f.parent.value).then(function (iid) {
            const u = {}; u["records/" + r.id + "/planLinks/" + f.p.value] = iid; const h = hist(r.id, "link", null, "planejamento " + f.p.value); u[h[0]] = h[1];
            return db.ref("itsm/" + ID + "/data").update(u).then(function () { close(); toast("Item criado no planejamento"); });
          }).catch(function (err) { f.querySelector(".primary").disabled = false; fail(err); });
        };
      });
    });
  }
  function createPlanItem(pid, r, type, parent) {
    return Promise.all([planTitle(pid), db.ref("planning/" + pid + "/data/settings").once("value").then(function (s) { return s.val() || {}; })]).then(function (x) {
      const inf = x[0] || {}, st = x[1], sts = st.statuses || ((window.PLAN_METHODS || {})[inf.method] || (window.PLAN_METHODS || {}).hybrid || {}).statuses || [{ id: "todo" }];
      return db.ref("planning/" + pid + "/data/settings/seq").transaction(function (n) { return (n || 0) + 1; }).then(function (res) {
        const iid = pushId(), t = now(), day = new Date(t).toISOString().slice(0, 10);
        const it = { type: type, title: "[" + r.key + "] " + r.title, status: sts[0].id, order: t, created: TS(), by: me.email, key: (st.prefix || "PLN") + "-" + res.snapshot.val(),
          desc: (r.desc || "").slice(0, 3000), src: { itsm: ID, rec: r.id, key: r.key, kind: r.kind, status: I.status(r.kind, r.status).name, title: info.title } };
        if (parent) it.parent = parent;
        if (type === "milestone") { const d0 = r.window && r.window.start ? new Date(r.window.start).toISOString().slice(0, 10) : day; it.start = d0; it.end = d0; }
        return db.ref("planning/" + pid + "/data/items/" + iid).set(it).then(function () { return iid; });
      });
    });
  }
  /* keep the ITSM badge in Planning up to date, and approved changes as milestones on the roadmap */
  function syncPlans(r) {
    if (!r || !isAgent()) return;
    const stName = I.status(r.kind, r.status).name, u = {};
    Object.keys(r.planLinks || {}).forEach(function (p) { db.ref("planning/" + p + "/data/items/" + r.planLinks[p] + "/src/status").set(stName).catch(function () { /* no access */ }); });
    if (r.kind !== "change") return;
    const on = r.onRoadmap && ["approved", "scheduled", "implemented", "reviewed", "closed"].indexOf(r.status) >= 0, ms = r.milestones || {};
    const date = r.window && r.window.start ? new Date(r.window.start).toISOString().slice(0, 10) : null;
    Object.keys(info.plans || {}).forEach(function (p) {
      if (on && !ms[p]) createPlanItem(p, r, "milestone", "").then(function (iid) { u["records/" + r.id + "/milestones/" + p] = iid; return db.ref("itsm/" + ID + "/data/records/" + r.id + "/milestones/" + p).set(iid); }).catch(function () { /* no access */ });
      else if (on && ms[p]) { const v = { "src/status": stName }; if (date) { v.start = date; v.end = date; } db.ref("planning/" + p + "/data/items/" + ms[p]).update(v).catch(function () { /* ignore */ }); }
      else if (!on && ms[p]) db.ref("planning/" + p + "/data/items/" + ms[p]).remove().then(function () { return db.ref("itsm/" + ID + "/data/records/" + r.id + "/milestones/" + p).remove(); }).catch(function () { /* ignore */ });
    });
  }

  /* ---------------- AI (same provider as the boards' AI) ---------------- */
  function aiOn() { if (S().ai === false) { toast("A IA está desligada nesta central (Configurações)."); return false; } if (!window.CMAI || !window.CMAI.generate) { toast("IA indisponível neste momento."); return false; } return true; }
  function aiBusy(btn, on) { if (btn) { btn.disabled = on; btn.classList.toggle("busy", on); } }
  function aiTriage(r) {
    if (!aiOn()) return;
    const cats = list((data.catalog || {}).categories), svcs = list(Object.assign({}, (data.catalog || {}).services || {}, (data.catalog || {}).products || {})), arts = kbPublished().slice(0, 40);
    const prompt = "Você é um analista de central de serviços (ITIL 4 e ITIL 5). Classifique o chamado abaixo. Responda só JSON: {\"category\": id ou \"\", \"service\": id ou \"\", \"impact\": \"high|medium|low\", \"urgency\": \"high|medium|low\", \"articles\": [ids de artigos úteis], \"reason\": \"uma frase em português do Brasil\"}.\n" +
      "Categorias: " + JSON.stringify(cats.map(function (c) { return { id: c.id, name: c.name }; })) + "\nServiços: " + JSON.stringify(svcs.map(function (s) { return { id: s.id, name: s.name, desc: s.desc }; })) + "\nArtigos: " + JSON.stringify(arts.map(function (a) { return { id: a.id, title: a.title }; })) +
      "\nChamado: " + JSON.stringify({ tipo: KN[r.kind].name, titulo: r.title, descricao: (r.desc || "").slice(0, 2000), formulario: r.form || {} });
    const b = document.getElementById("aiTriage"); aiBusy(b, true);
    window.CMAI.generate("itsm-triage", prompt).then(function (x) {
      aiBusy(b, false); x = x || {};
      const cat = ((data.catalog || {}).categories || {})[x.category], sv = svcName(x.service), p = I.priority(x.impact, x.urgency, S().matrix);
      modal("<h2>" + IC("spark", 20) + ' Sugestão da IA</h2><p class="muted small">Sugerido por IA – a decisão é sua e fica registrada.</p><dl class="it-dl"><dt>Categoria</dt><dd>' + esc(cat ? cat.name : "–") + "</dd><dt>Serviço</dt><dd>" + esc(sv || "–") + "</dd><dt>Impacto × urgência</dt><dd>" + esc((I.LEVELN[x.impact] || "–") + " × " + (I.URGN[x.urgency] || "–")) + " → " + prioChip(p) + "</dd><dt>Por quê</dt><dd>" + esc(x.reason || "") + "</dd>" +
        ((x.articles || []).length ? "<dt>Artigos</dt><dd>" + (x.articles || []).map(function (a) { return (data.kb || {})[a] ? '<button class="link" data-kb="' + esc(a) + '">' + esc(data.kb[a].title) + "</button>" : ""; }).join(" · ") + "</dd>" : "") + "</dl>" +
        '<div class="pl-row-end"><button class="pl-btn" id="aiNo">Descartar</button><button class="pl-btn primary" id="aiYes">Aplicar</button></div>', function (w, close) {
        w.querySelectorAll("[data-kb]").forEach(function (k) { k.onclick = function () { viewArticle(k.dataset.kb, false); }; });
        w.querySelector("#aiNo").onclick = function () { updateRec(r.id, { ai: Object.assign({}, r.ai || {}, { triage: "rejected" }) }); close(); };
        w.querySelector("#aiYes").onclick = function () {
          const pt = { ai: Object.assign({}, r.ai || {}, { triage: "accepted" }) };
          if (cat) pt.category = x.category; if (sv) pt.service = x.service; if (I.LEVELN[x.impact]) pt.impact = x.impact; if (I.URGN[x.urgency]) pt.urgency = x.urgency;
          updateRec(r.id, pt).then(close);
        };
      });
    }, function (e) { aiBusy(b, false); fail(e); });
  }
  function aiReply(r, d) {
    if (!aiOn()) return;
    const ke = r.problem && rec(r.problem) ? (rec(r.problem).knownError || {}) : {}, arts = kbSearch(r.title + " " + (r.desc || ""), 3);
    const conv = thread ? Object.keys((data.comments || {})[r.id] || {}).map(function (k) { return data.comments[r.id][k]; }).sort(function (a, b) { return a.t - b.t; }).slice(-6).map(function (c) { return (c.name || c.by) + ": " + c.text; }) : [];
    const prompt = "Você é um agente de central de serviços. Escreva uma resposta curta, cordial e objetiva em português do Brasil para o solicitante, usando a base de conhecimento quando servir. Não invente procedimentos. Responda só JSON: {\"reply\": \"texto\"}.\n" +
      "Chamado: " + JSON.stringify({ titulo: r.title, descricao: (r.desc || "").slice(0, 1500), status: I.status(r.kind, r.status).name, solicitante: (r.requester || {}).name }) + "\nConversa: " + JSON.stringify(conv) +
      "\nSolução de contorno conhecida: " + JSON.stringify(ke.workaround || "") + "\nArtigos: " + JSON.stringify(arts.map(function (a) { return { titulo: a.title, texto: (a.body || "").slice(0, 1200) }; }));
    const b = d.querySelector("#aiReply"); aiBusy(b, true);
    window.CMAI.generate("itsm-reply", prompt).then(function (x) {
      aiBusy(b, false); const t = d.querySelector("#cmTxt"); if (!t || !x || !x.reply) return toast("A IA não devolveu sugestão.");
      t.value = x.reply; d.querySelector("#cmInt").checked = false; d.dataset.aiReply = x.reply; t.focus(); toast("Sugerido por IA – revise antes de enviar");
    }, function (e) { aiBusy(b, false); fail(e); });
  }
  function aiMajorSummary(r) {
    if (!aiOn()) return;
    const tl = list(r.comms).concat(Object.keys((data.notes || {})[r.id] || {}).map(function (k) { return data.notes[r.id][k]; })).concat(Object.keys((data.comments || {})[r.id] || {}).map(function (k) { return data.comments[r.id][k]; })).sort(function (a, b) { return a.t - b.t; }).map(function (c) { return fmtDT(c.t) + " – " + c.text; }).slice(-30);
    const prompt = "Resuma este incidente grave para comunicação executiva em português do Brasil, em até 120 palavras: situação atual, impacto, o que está sendo feito e próxima atualização. Responda só JSON: {\"summary\": \"texto\"}.\nIncidente: " + JSON.stringify({ chave: r.key, titulo: r.title, descricao: (r.desc || "").slice(0, 1500), servico: svcName(r.service), status: I.status(r.kind, r.status).name, aberto: fmtDT(r.created) }) + "\nLinha do tempo: " + JSON.stringify(tl);
    const b = document.getElementById("aiSum"); aiBusy(b, true);
    window.CMAI.generate("itsm-major", prompt).then(function (x) { aiBusy(b, false); if (!x || !x.summary) return toast("A IA não devolveu resumo."); updateRec(r.id, { ai: Object.assign({}, r.ai || {}, { summary: "accepted" }) }); commDialog(r, x.summary); }, function (e) { aiBusy(b, false); fail(e); });
  }

  /* ---------------- settings (managers) ---------------- */
  /* ---------- Administração: SOC SLA, Excel, areas, domains / Office 365, e-mail intake ---------- */
  function minTxt(m) { m = Number(m) || 0; return m >= 1440 && m % 1440 === 0 ? m / 1440 + " d" : m >= 60 && m % 60 === 0 ? m / 60 + " h" : m + " min"; }
  function socSlaSection() {
    if (!hasSoc()) return "";
    const t = (data.sla || {}).soc || I.SOC_SLA_DEFAULT;
    return '<section class="it-scard" data-sec="sla"><h3>' + IC("shield", 16) + ' SLAs do SOC – incidentes de segurança</h3><p class="muted small">Por severidade, em minutos. A área SOC usa calendário 24×7 por padrão.</p><form id="socF" class="pl-form"><div class="it-tablewrap"><table class="it-mx"><thead><tr><th>Severidade</th><th>Triagem (min)</th><th>Contenção (min)</th><th>Resolução (min)</th></tr></thead><tbody>' +
      ["P1", "P2", "P3", "P4"].map(function (p) { const x = t[p] || I.SOC_SLA_DEFAULT[p]; return "<tr><th>" + p + " · " + esc(I.SEV[p]) + '</th><td><input type="number" min="1" name="sr_' + p + '" value="' + esc(x.resp) + '"></td><td><input type="number" min="1" name="sc_' + p + '" value="' + esc(x.contain) + '"></td><td><input type="number" min="1" name="ss_' + p + '" value="' + esc(x.res) + '"></td></tr>'; }).join("") +
      '</tbody></table></div><div class="pl-row-end"><button class="pl-btn primary sm">Salvar SLAs do SOC</button></div></form></section>';
  }
  function excelSection() {
    return '<section class="it-scard" data-sec="excel"><h3>' + IC("upload", 16) + ' Carregar parametrização pelo Excel</h3>' +
      '<p class="muted small">Baixe o nosso modelo, preencha as abas que quiser e importe. Abas lidas: <b>Áreas</b>, <b>SLA Incidentes</b>, <b>SLA SOC</b>, <b>Calendários</b> e <b>Usuários</b>. Antes de gravar, mostramos o que vai mudar.</p>' +
      '<div class="it-acts"><a class="pl-btn" href="./modelo-itsm.xlsx" download>' + IC("export", 14) + ' Baixar modelo (Excel)</a><label class="pl-btn primary it-file">' + IC("upload", 14) + ' Importar planilha<input type="file" id="xlsIn" accept=".xlsx,.xls" hidden></label></div><div id="xlsOut"></div></section>';
  }
  function areasSection() {
    const as = areas(), used = function (a) { return recs().filter(function (r) { return r.area === a; }).length; };
    return '<section class="it-scard" data-sec="areas"><h3>' + IC("layers", 16) + ' Áreas de atendimento</h3><p class="muted small">Cada área vem de um modelo com grupos, categorias, serviços, ofertas do portal, calendário e SLAs. Depois de criada, tudo pode ser editado no Catálogo, em Grupos e em SLAs.</p>' +
      (as.length ? '<div class="it-tablewrap"><table class="it-table"><thead><tr><th>Área</th><th>Modelo</th><th>Calendário</th><th>E-mail para abrir chamados</th><th>Registros</th><th></th></tr></thead><tbody>' + as.map(function (a) {
        return '<tr><td data-l="Área"><span class="it-adot" style="--c:' + esc(a.color || "#0e1a33") + '"></span><input class="it-inln" data-arn="' + esc(a.id) + '" value="' + esc(a.name) + '" maxlength="40" aria-label="Nome da área"></td><td data-l="Modelo">' + esc((I.AREA_TEMPLATES[a.template] || {}).name || "Personalizada") + '</td><td data-l="Calendário">' + sel("cal_" + a.id, [["business", "Horário comercial"], ["24x7", "24 × 7"]], (a.calendar || {}).mode || "business", ' data-arc="' + esc(a.id) + '"') + '</td><td data-l="E-mail" class="small"><code>' + esc(mailAddr(a.id)) + '</code></td><td data-l="Registros">' + used(a.id) + '</td><td data-l=""><button class="link" data-ardel="' + esc(a.id) + '">remover</button></td></tr>';
      }).join("") + "</tbody></table></div>" : '<p class="muted small">Nenhuma área ainda: os registros ficam em “Geral”.</p>') +
      '<form class="it-inlf" id="arF"><select name="t">' + Object.keys(I.AREA_TEMPLATES).map(function (k) { return opt(k, I.AREA_TEMPLATES[k].name, ""); }).join("") + '</select><input name="n" maxlength="40" placeholder="Nome (opcional, ex.: TI – Filial Sul)"><button class="pl-btn sm primary">Adicionar área</button></form></section>';
  }
  function domainsSection() {
    const dm = Object.keys(info.domains || {}).map(function (k) { return k.replace(/,/g, "."); });
    return '<section class="it-scard" data-sec="users"><h3>' + IC("lock", 16) + ' Domínios da empresa e Office 365</h3>' +
      '<p class="muted small">Quem entrar com e-mail de um domínio cadastrado pode se juntar à central como solicitante, sem convite individual. Combine com o login da Microsoft para os usuários do Office 365.</p>' +
      '<div class="it-cats">' + dm.map(function (d) { return '<span class="it-tag gray">@' + esc(d) + ' <button class="link" data-dmdel="' + esc(d) + '" aria-label="Remover domínio">✕</button></span>'; }).join("") +
      '<form class="it-inlf" id="dmF"><input name="d" maxlength="80" placeholder="empresa.com.br"><button class="pl-btn sm">Adicionar domínio</button></form></div>' +
      '<div class="it-banner small">' + (window.CMCOLLAB_MS_LOGIN ? "<b>Login com Microsoft ativo.</b> Os usuários do Office 365 entram com “Entrar com Microsoft” e confirmam o e-mail uma única vez." : "<b>Login com Microsoft (Office 365): aguardando configuração.</b> Passos: 1) registrar o aplicativo no Microsoft Entra (portal.azure.com) com a URL de retorno do Firebase; 2) ativar o provedor Microsoft no Firebase Authentication com o ID e o segredo do aplicativo; 3) ligar <code>CMCOLLAB_MS_LOGIN</code> em config.js (e, se quiser só uma empresa, o tenant em <code>CMCOLLAB_MS_TENANT</code>).") + "</div></section>";
  }
  function mailAddr(area) { return "digitalagiletechnology+itsm_" + ID + (area ? "_" + area : "") + "@gmail.com"; }
  function mailSection() {
    const m = S().mailIn || {}, last = m.lastRun;
    return '<section class="it-scard" data-sec="mail"><h3>' + IC("mail", 16) + ' Receber chamados por e-mail</h3>' +
      '<p class="muted small">Cada e-mail novo vira um chamado (na área SOC, incidente de segurança) e recebe uma confirmação com o número. Respostas com [INC-0001] no assunto viram comentários. No Office 365, crie uma regra que redireciona a caixa de suporte (ex.: suporte@empresa.com.br) para o endereço da área.</p>' +
      '<ul class="it-tasks"><li><b>Geral:</b> <code>' + esc(mailAddr("")) + "</code></li>" + areas().map(function (a) { return "<li><b>" + esc(a.name) + ":</b> <code>" + esc(mailAddr(a.id)) + "</code></li>"; }).join("") + "</ul>" +
      '<form class="pl-form" id="miF"><label>Quem pode abrir chamado por e-mail' + sel("accept", [["members", "Só pessoas da central"], ["domains", "Pessoas da central e dos domínios cadastrados"], ["any", "Qualquer remetente (fica marcado como externo)"]], m.accept || "members") + "</label>" +
      '<label class="chk"><input type="checkbox" name="auto"' + (m.autoReply !== false ? " checked" : "") + '> Responder ao remetente com o número do chamado</label><label class="chk"><input type="checkbox" name="on"' + (m.enabled !== false ? " checked" : "") + "> Receber e-mails nesta central</label>" +
      '<div class="pl-row-end"><button class="pl-btn primary sm">Salvar</button></div></form>' +
      '<p class="muted small">Última leitura da caixa: ' + (last ? esc(fmtDT(last)) + (m.lastCount != null ? " · " + m.lastCount + " e-mail(s) processado(s)" : "") : "ainda não houve (o leitor de e-mails precisa ser ativado no notificador da plataforma)") + "</p></section>";
  }
  function bindAdminExtras(el) {
    const sf = el.querySelector("#socF"); if (sf) sf.onsubmit = function (e) {
      e.preventDefault(); const t = {}; ["P1", "P2", "P3", "P4"].forEach(function (p) { const d = I.SOC_SLA_DEFAULT[p]; t[p] = { resp: Number(sf["sr_" + p].value) || d.resp, contain: Number(sf["sc_" + p].value) || d.contain, res: Number(sf["ss_" + p].value) || d.res }; });
      db.ref("itsm/" + ID + "/data/sla/soc").set(t).then(function () { toast("SLAs do SOC salvos"); }, fail);
    };
    const af = el.querySelector("#arF"); if (af) af.onsubmit = function (e) {
      e.preventDefault(); const t = af.t.value; let aid = t, n = 2; while ((data.areas || {})[aid]) aid = t + n++;
      const u = areaFromTemplate(t, aid, S(), data.catalog); const nm = af.n.value.trim(); if (nm) u["data/areas/" + aid].name = nm.slice(0, 40);
      if (I.AREA_TEMPLATES[t].soc && !(data.sla || {}).soc) u["data/sla/soc"] = I.SOC_SLA_DEFAULT;
      if (I.AREA_TEMPLATES[t].soc && !boardsList().some(function (b) { return b.kind === "security"; })) u["data/settings/boards"] = boardsList().concat([{ id: "b" + Date.now().toString(36), kind: "security", name: "SOC", lane: "group" }]);
      db.ref("itsm/" + ID).update(u).then(function () { data.areas = Object.assign({}, data.areas || {}); data.areas[aid] = u["data/areas/" + aid]; toast("Área criada com grupos, catálogo e calendário do modelo"); shell(); }, fail);
    };
    el.querySelectorAll("[data-arn]").forEach(function (i) { i.onchange = function () { if (i.value.trim()) db.ref("itsm/" + ID + "/data/areas/" + i.dataset.arn + "/name").set(i.value.trim().slice(0, 40)).catch(fail); }; });
    el.querySelectorAll("[data-arc]").forEach(function (c) { c.onchange = function () { const v = c.value === "24x7" ? { mode: "24x7", days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59", tz: -180 } : { mode: "business", days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00", tz: -180 }; db.ref("itsm/" + ID + "/data/areas/" + c.dataset.arc + "/calendar").set(v).then(function () { toast("Calendário da área atualizado"); }, fail); }; });
    el.querySelectorAll("[data-ardel]").forEach(function (b) { b.onclick = function () {
      const a = b.dataset.ardel, n = recs().filter(function (r) { return r.area === a; }).length;
      confirmBox("Remover área", "A área sai da lista e das ofertas do portal. " + (n ? n + " registro(s) continuam guardados e passam a aparecer em “Geral”." : "") + " Grupos, serviços e categorias da área são mantidos.", "Remover", true).then(function (ok) {
        if (!ok) return; const u = {}; u["areas/" + a] = null; list((data.catalog || {}).offerings).forEach(function (o) { if (o.area === a) u["catalog/offerings/" + o.id] = null; });
        db.ref("itsm/" + ID + "/data").update(u).then(function () { shell(); }, fail);
      });
    }; });
    const dmf = el.querySelector("#dmF"); if (dmf) dmf.onsubmit = function (e) {
      e.preventDefault(); const d = dmf.d.value.trim().toLowerCase().replace(/^@/, "");
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return toast("Domínio inválido");
      if (/^(gmail|outlook|hotmail|yahoo|live|icloud|bol|uol)\./.test(d)) return toast("Use o domínio da empresa, não um provedor de e-mail público.");
      db.ref("itsm/" + ID + "/info/domains/" + d.replace(/\./g, ",")).set(true).then(function () { info.domains = Object.assign({}, info.domains || {}); info.domains[d.replace(/\./g, ",")] = true; renderView(); }, fail);
    };
    el.querySelectorAll("[data-dmdel]").forEach(function (b) { b.onclick = function () { const k = b.dataset.dmdel.replace(/\./g, ","); db.ref("itsm/" + ID + "/info/domains/" + k).remove().then(function () { delete (info.domains || {})[k]; renderView(); }, fail); }; });
    const mf = el.querySelector("#miF"); if (mf) mf.onsubmit = function (e) {
      e.preventDefault(); const u = {}; u["settings/mailIn/accept"] = mf.accept.value; u["settings/mailIn/autoReply"] = mf.auto.checked; u["settings/mailIn/enabled"] = mf.on.checked;
      db.ref("itsm/" + ID + "/data").update(u).then(function () { toast("Recebimento por e-mail salvo"); }, fail);
    };
    const xi = el.querySelector("#xlsIn"); if (xi) xi.onchange = function () { const f = xi.files && xi.files[0]; if (f) importExcel(f, el.querySelector("#xlsOut")); xi.value = ""; };
  }

  /* ---------- Excel import (SheetJS, loaded on demand from /assets/vendor) ---------- */
  function loadXLSX() {
    if (window.XLSXLite) return Promise.resolve(window.XLSXLite);
    return new Promise(function (res, rej) { const sc = document.createElement("script"); sc.src = "../assets/js/xlsx-lite.js"; sc.onload = function () { res(window.XLSXLite); }; sc.onerror = function () { rej(new Error("Não foi possível carregar o leitor de Excel")); }; document.head.appendChild(sc); });
  }
  function normKey(s) { return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
  function toMin(v, unit) {
    if (v == null || v === "") return null;
    const n = Number(String(v).replace(",", ".")); if (!isFinite(n) || n <= 0) return NaN;
    const u = normKey(unit || "minutos");
    return Math.round(n * (u.indexOf("dia") === 0 ? 1440 : u.indexOf("hora") === 0 || u === "h" ? 60 : 1));
  }
  function sheetRows(wb, names) {
    const nm = wb.SheetNames.find(function (n) { return names.indexOf(normKey(n)) >= 0; }); if (!nm) return null;
    return wb.rows(nm).map(function (r) { const o = {}; Object.keys(r).forEach(function (k) { o[k === "__line" ? k : normKey(k)] = r[k]; }); return o; });
  }
  function prioOf(v) { const t = normKey(v); const m = t.match(/^p?([1-4])/); if (m) return "P" + m[1]; return { critica: "P1", alta: "P2", media: "P3", baixa: "P4" }[t.split(" ")[0]] || null; }
  function importExcel(file, out) {
    out.innerHTML = '<p class="muted small">Lendo a planilha…</p>';
    if (file.size > 5 * 1024 * 1024) { out.innerHTML = '<p class="it-banner red small">Planilha maior que 5 MB. Use o modelo sem dados extras.</p>'; return; }
    Promise.all([loadXLSX(), file.arrayBuffer()]).then(function (x) { return x[0].read(x[1]); }).then(function (wb) {
      const errs = [], u = {}, sum = [];
      const areaByName = {}; areas().forEach(function (a) { areaByName[normKey(a.name)] = a.id; areaByName[normKey(a.id)] = a.id; });
      const newAreas = {};
      /* Áreas */
      const ar = sheetRows(wb, ["areas"]);
      if (ar) ar.forEach(function (r, i) {
        const nm = r["area"] || r["nome"], tpl = normKey(r["modelo"] || "");
        if (!nm) return;
        const tid = Object.keys(I.AREA_TEMPLATES).find(function (k) { return normKey(I.AREA_TEMPLATES[k].name) === tpl || k === tpl || normKey(I.AREA_TEMPLATES[k].name).indexOf(tpl) === 0; });
        if (areaByName[normKey(nm)]) return;
        if (!tid) { errs.push("Áreas, linha " + (r.__line || i + 2) + ": modelo “" + (r["modelo"] || "") + "” não existe (use TI, SOC, RH, Facilities, Financeiro ou Jurídico)."); return; }
        let aid = tid, n = 2; while ((data.areas || {})[aid] || newAreas[aid]) aid = tid + n++;
        newAreas[aid] = 1; areaByName[normKey(nm)] = aid;
        Object.assign(u, areaFromTemplate(tid, aid, S(), data.catalog)); u["data/areas/" + aid].name = String(nm).slice(0, 40);
        const cm = normKey(r["calendario"] || ""); if (cm.indexOf("24") === 0) u["data/areas/" + aid].calendar = { mode: "24x7", days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59", tz: -180 };
        sum.push("Nova área: " + nm + " (modelo " + I.AREA_TEMPLATES[tid].name + ")");
      });
      const areaId = function (v, line, sheet) { if (!v || normKey(v) === "todas" || normKey(v) === "geral") return null; const a = areaByName[normKey(v)]; if (!a) errs.push(sheet + ", linha " + line + ": área “" + v + "” não encontrada (cadastre na aba Áreas)."); return a || undefined; };
      const svcByName = {}; list(Object.assign({}, (data.catalog || {}).services || {}, (data.catalog || {}).products || {})).forEach(function (x) { svcByName[normKey(x.name)] = x.id; });
      /* SLA Incidentes / SLA SOC */
      [["sla incidentes", false], ["sla soc", true]].forEach(function (cfg) {
        const rows = sheetRows(wb, [cfg[0]]); if (!rows) return;
        const unit = function (r) { return r["unidade"] || "minutos"; };
        let nDef = 0, nPol = 0; const defs = {};
        rows.forEach(function (r, i) {
          const line = r.__line || i + 2, p = prioOf(r["prioridade"] || r["severidade"]);
          if (!p) { errs.push((cfg[1] ? "SLA SOC" : "SLA Incidentes") + ", linha " + line + ": prioridade/severidade inválida."); return; }
          const resp = toMin(r["1a resposta"] || r["primeira resposta"] || r["triagem"], unit(r)), res = toMin(r["resolucao"], unit(r)), cont = cfg[1] ? toMin(r["contencao"], unit(r)) : null;
          if (!resp || !res || isNaN(resp) || isNaN(res) || (cfg[1] && (!cont || isNaN(cont)))) { errs.push((cfg[1] ? "SLA SOC" : "SLA Incidentes") + ", linha " + line + ": prazos precisam ser números maiores que zero."); return; }
          if (resp > res) { errs.push((cfg[1] ? "SLA SOC" : "SLA Incidentes") + ", linha " + line + ": 1ª resposta maior que a resolução."); return; }
          const a = areaId(r["area"], line, cfg[1] ? "SLA SOC" : "SLA Incidentes"); if (a === undefined) return;
          const sv = r["servico"] ? svcByName[normKey(r["servico"])] : null;
          if (r["servico"] && !sv) { errs.push((cfg[1] ? "SLA SOC" : "SLA Incidentes") + ", linha " + line + ": serviço “" + r["servico"] + "” não está no catálogo."); return; }
          if (!a && !sv) { defs[p] = cfg[1] ? { resp: resp, contain: cont, res: res } : { resp: resp, res: res }; nDef++; }
          else { const pid = "x" + (cfg[1] ? "s" : "i") + "_" + (a || "all") + "_" + (sv || "all") + "_" + p; const pol = { name: String(r["nome"] || r["politica"] || (areaName(a) || "Área") + " " + p).slice(0, 40), priority: p, resp: resp, res: res, area: a || null, service: sv || null }; if (cfg[1]) { pol.soc = true; pol.contain = cont; } u["data/sla/policies/" + pid] = pol; nPol++; }
        });
        if (Object.keys(defs).length) { const base = Object.assign({}, cfg[1] ? (data.sla || {}).soc || I.SOC_SLA_DEFAULT : (data.sla || {}).defaults || I.SLA_DEFAULT, defs); u["data/sla/" + (cfg[1] ? "soc" : "defaults")] = base; }
        if (nDef || nPol) sum.push((cfg[1] ? "SLA do SOC" : "SLA de incidentes e requisições") + ": " + nDef + " padrão(ões) e " + nPol + " política(s) por área ou serviço");
      });
      /* Calendários */
      const cr = sheetRows(wb, ["calendarios"]);
      if (cr) cr.forEach(function (r, i) {
        const line = r.__line || i + 2, a = areaId(r["area"], line, "Calendários"); if (a === undefined) return;
        const mode = normKey(r["modo"] || r["tipo"]).indexOf("24") === 0 ? "24x7" : "business";
        const hm = function (v) { if (typeof v === "number") { const m = Math.round(v * 1440); return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); } return /^\d{1,2}:\d{2}$/.test(String(v)) ? String(v).padStart(5, "0") : null; };
        const DN = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
        const days = String(r["dias"] || "seg,ter,qua,qui,sex").split(/[,;/ ]+/).map(function (d) { return DN[normKey(d).slice(0, 3)]; }).filter(function (d) { return d != null; });
        const c = mode === "24x7" ? { mode: "24x7", days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59", tz: -180 } : { mode: "business", days: days.length ? days : [1, 2, 3, 4, 5], start: hm(r["inicio"]) || "08:00", end: hm(r["fim"]) || "18:00", tz: -180 };
        if (a) u["data/areas/" + a + "/calendar"] = c; else u["data/settings/calendar"] = c;
        sum.push("Calendário " + (a ? areaName(a) || r["area"] : "geral") + ": " + (mode === "24x7" ? "24×7" : c.start + "–" + c.end));
      });
      /* Usuários */
      const ur = sheetRows(wb, ["usuarios"]);
      if (ur) { let n = 0; const ROLE = { gestor: "manager", agente: "agent", solicitante: "requester" };
        ur.forEach(function (r, i) {
          const em = String(r["e mail"] || r["email"] || "").toLowerCase().trim(), line = r.__line || i + 2; if (!em) return;
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { errs.push("Usuários, linha " + line + ": e-mail inválido."); return; }
          const role = ROLE[normKey(r["papel"]).split(" ")[0]] || "requester", k = A.key(em);
          if (k === wsInfo.owner || k === info.owner) return;
          u["info/members/" + k] = Object.assign({}, (info.members || {})[k] || {}, { email: em, name: String(r["nome"] || em.split("@")[0]).slice(0, 60), role: role, invitedBy: me.email, invitedAt: now() });
          u["userItsm/" + k + "/" + ID] = { title: info.title, role: role };
          String(r["grupos"] || "").split(/[,;]+/).map(function (g) { return g.trim(); }).filter(Boolean).forEach(function (g) {
            const gid = groups().find(function (x) { return normKey(x.name) === normKey(g) || x.id === g; }); if (gid && role !== "requester") u["data/settings/groups/" + gid.id + "/members/" + k] = true; else if (!gid) errs.push("Usuários, linha " + line + ": grupo “" + g + "” não existe.");
          });
          n++;
        });
        if (n) sum.push(n + " usuário(s) cadastrados ou atualizados");
      }
      if (!Object.keys(u).length && !errs.length) { out.innerHTML = '<p class="it-banner amber small">Nenhuma aba reconhecida. Use o modelo (abas Áreas, SLA Incidentes, SLA SOC, Calendários, Usuários).</p>'; return; }
      out.innerHTML = '<div class="it-xprev">' + (sum.length ? "<b>O que vai mudar</b><ul>" + sum.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
        (errs.length ? '<div class="it-banner red small"><b>' + errs.length + " problema(s) – essas linhas serão ignoradas:</b><ul>" + errs.slice(0, 30).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" : "") +
        (Object.keys(u).length ? '<div class="pl-row-end"><button class="pl-btn" id="xlsNo">Cancelar</button><button class="pl-btn primary" id="xlsYes">Aplicar</button></div>' : "") + "</div>";
      const no = out.querySelector("#xlsNo"); if (no) no.onclick = function () { out.innerHTML = ""; };
      const yes = out.querySelector("#xlsYes"); if (yes) yes.onclick = function () {
        yes.disabled = true;
        const root = {}, itsmU = {};
        Object.keys(u).forEach(function (k) { if (k.indexOf("userItsm/") === 0) root[k] = u[k]; else itsmU[k] = u[k]; });
        db.ref("itsm/" + ID).update(itsmU).then(function () { return Object.keys(root).length ? db.ref().update(root) : null; }).then(function () {
          return db.ref("itsm/" + ID + "/info").once("value").then(function (s2) { if (s2.val()) info = s2.val(); });
        }).then(function () { out.innerHTML = '<p class="it-banner green small">Parametrização aplicada.</p>'; toast("Planilha importada"); setTimeout(shell, 600); }, function (e2) { yes.disabled = false; fail(e2); });
      };
    }).catch(function (e) { out.innerHTML = '<p class="it-banner red small">' + esc(e.message) + "</p>"; });
  }
  function settingsView(el) {
    if (!isMgr()) { el.innerHTML = '<p class="muted">Só gestores da central alteram as configurações.</p>'; return; }
    const s = S(), ppl = people(), pk = Object.keys(ppl).map(function (k) { return ppl[k]; }).sort(byName), im = info.members || {}, mx = s.matrix || I.MATRIX, cl = cal(), dft = (data.sla || {}).defaults || I.SLA_DEFAULT, cab = s.cab || {};
    const svcs = list(Object.assign({}, (data.catalog || {}).services || {}, (data.catalog || {}).products || {})).sort(byName);
    const roleOf = function (p) { const m = im[p.k]; if (m && m.role) return m.role; if (p.k === wsInfo.owner || p.k === info.owner) return "manager"; return p.agent ? "agent" : "requester"; };
    const srcOf = function (p) { if (p.k === wsInfo.owner) return "dono do workspace"; const wm = wsMembers[p.k]; if (wm) return wm.role === "editor" ? "editor do workspace" : "leitor do workspace"; if (p.via) return "workspace conectado"; return "convidado na central"; };
    const multi = function (name, cur) { return '<select name="' + name + '" multiple size="' + Math.min(6, Math.max(3, pk.length)) + '">' + pk.map(function (p) { return '<option value="' + esc(p.k) + '"' + ((cur || {})[p.k] ? " selected" : "") + ">" + esc(p.name) + "</option>"; }).join("") + "</select>"; };
    const SECS = [["geral", "Geral", "settings"], ["areas", "Áreas", "layers"], ["users", "Usuários e acesso", "people"], ["groups", "Grupos", "people"], ["sla", "SLAs e calendários", "clock"], ["excel", "Importar Excel", "upload"], ["prio", "Prioridade", "alert"], ["change", "Mudanças (CAB)", "change"], ["mail", "E-mail de entrada", "mail"], ["conn", "Conexões", "link"]];
    const cur = SECS.some(function (x) { return x[0] === filter.adm; }) ? filter.adm : "geral";
    el.innerHTML = '<div class="it-adm"><nav class="it-admnav" aria-label="Administração">' + SECS.map(function (x) { return '<button data-adm="' + x[0] + '"' + (x[0] === cur ? ' class="on" aria-current="page"' : "") + ">" + IC(x[2], 15) + "<span>" + x[1] + "</span></button>"; }).join("") + "</nav>" +
      '<div class="it-set" data-cur="' + cur + '">' +
      '<section class="it-scard" data-sec="geral"><h3>Geral</h3><form class="pl-form" id="sgF"><label>Nome da central<input name="title" maxlength="80" value="' + esc(info.title) + '"></label>' +
      '<label>Referência ITIL exibida' + sel("fw", [["both", "ITIL 4 e ITIL 5"], ["itil4", "Só ITIL 4 (cadeia de valor de serviço)"], ["itil5", "Só ITIL 5 (ciclo de vida de produtos e serviços)"]], fw()) + "</label>" +
      '<div class="pl-2"><label>Fechar resolvidos após (dias)<input name="ac" type="number" min="0" max="30" value="' + esc(s.autoCloseDays == null ? 3 : s.autoCloseDays) + '"></label><label>Regra de aprovação' + sel("ar", [["all", "Todos os aprovadores"], ["majority", "Maioria"], ["any", "Basta um"]], s.approvalRule || "all") + "</label></div>" +
      '<div class="pl-2"><label>Tendência: nº de incidentes<input name="tn" type="number" min="2" max="50" value="' + esc((s.trend || {}).n || 3) + '"></label><label>em quantos dias<input name="td" type="number" min="1" max="90" value="' + esc((s.trend || {}).days || 7) + '"></label></div>' +
      '<label class="chk"><input type="checkbox" name="ai"' + (s.ai !== false ? " checked" : "") + "> IA ligada (sugestões de categoria, prioridade, resposta e resumo de incidente grave)</label>" +
      '<label class="chk"><input type="checkbox" name="em"' + (s.emails !== false ? " checked" : "") + "> E-mails automáticos pela conta Digital Agile (chamado aberto, atribuído, comentário, resolvido, SLA, aprovação)</label>" +
      '<div class="pl-row-end"><button class="pl-btn primary">Salvar</button></div></form></section>' +

      '<section class="it-scard" data-sec="users"><h3>Pessoas e papéis</h3><p class="muted small">Agentes atendem e veem tudo; solicitantes só abrem e acompanham os próprios chamados. Membros dos workspaces conectados entram como solicitantes.</p>' +
      '<div class="it-tablewrap"><table class="it-table"><thead><tr><th>Pessoa</th><th>Origem</th><th>Papel</th><th></th></tr></thead><tbody>' + pk.map(function (p) {
        const fixed = p.k === wsInfo.owner || p.k === info.owner;
        return '<tr><td data-l="Pessoa"><b>' + esc(p.name) + '</b><br><span class="muted small">' + esc(p.email) + '</span></td><td data-l="Origem" class="small">' + esc(srcOf(p)) + '</td><td data-l="Papel">' + (fixed ? "Gestor" : sel("role", [["manager", "Gestor"], ["agent", "Agente"], ["requester", "Solicitante"]], roleOf(p), ' data-pk="' + esc(p.k) + '"')) + '</td><td data-l="">' + (im[p.k] && !im[p.k].via && !wsMembers[p.k] ? '<button class="link" data-rmp="' + esc(p.k) + '">remover</button>' : "") + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<form class="it-inlf" id="addP"><input name="email" type="email" required placeholder="e-mail"><input name="name" maxlength="60" placeholder="nome"><select name="role">' + opt("requester", "Solicitante", "requester") + opt("agent", "Agente", "") + opt("manager", "Gestor", "") + '</select><button class="pl-btn sm">Adicionar</button></form></section>' +

      '<section class="it-scard" data-sec="groups"><h3>Grupos de suporte</h3><p class="muted small">Usados na atribuição, nas raias do quadro, no escalonamento funcional e nos OLAs (prazos internos por grupo).</p>' +
      groups().map(function (g) {
        return '<form class="pl-form it-grp" data-g="' + esc(g.id) + '"><div class="pl-2"><label>Nome<input name="name" maxlength="60" value="' + esc(g.name) + '"></label><label>Líder' + sel("lead", [["", "–"]].concat(agents().map(function (a) { return [a.email, a.name]; })), g.lead || "") + "</label></div>" +
          '<div class="pl-2"><label>Agentes do grupo<select name="members" multiple size="3">' + agents().map(function (a) { return '<option value="' + esc(a.k) + '"' + ((g.members || {})[a.k] ? " selected" : "") + ">" + esc(a.name) + "</option>"; }).join("") + '</select></label><label>OLA de resolução do grupo (horas)<input name="ola" type="number" min="0" max="720" value="' + esc(g.ola || "") + '" placeholder="sem OLA"></label></div>' +
          '<div class="pl-row-end"><span class="muted small">id: ' + esc(g.id) + '</span><span class="sp"></span><button type="button" class="pl-btn sm ghost danger" data-delg="' + esc(g.id) + '">Remover</button><button class="pl-btn sm primary">Salvar</button></div></form>';
      }).join("") + '<form class="it-inlf" id="addG"><input name="name" maxlength="60" required placeholder="Novo grupo (ex.: Redes)"><button class="pl-btn sm">Adicionar grupo</button></form></section>' +

      '<section class="it-scard" data-sec="prio"><h3>Prioridade: impacto × urgência</h3><form id="mxF"><div class="it-tablewrap"><table class="it-mx"><thead><tr><th>Impacto ↓ / Urgência →</th>' + I.LEVELS.map(function (u) { return "<th>" + I.URGN[u] + "</th>"; }).join("") + "</tr></thead><tbody>" +
      I.LEVELS.map(function (i) { return "<tr><th>" + I.LEVELN[i] + "</th>" + I.LEVELS.map(function (u) { return "<td>" + sel(i + "|" + u, ["P1", "P2", "P3", "P4"].map(function (p) { return [p, p]; }), mx[i + "|" + u]) + "</td>"; }).join("") + "</tr>"; }).join("") + '</tbody></table></div><div class="pl-row-end"><button class="pl-btn primary sm">Salvar matriz</button></div></form></section>' +

      '<section class="it-scard" data-sec="sla"><h3>Níveis de serviço (SLA) – incidentes e requisições</h3><form id="slF" class="pl-form"><div class="it-tablewrap"><table class="it-mx"><thead><tr><th>Prioridade</th><th>1ª resposta (min)</th><th>Resolução (min)</th></tr></thead><tbody>' + ["P1", "P2", "P3", "P4"].map(function (p) { const x = dft[p] || I.SLA_DEFAULT[p]; return "<tr><th>" + esc(I.PRIO[p].name) + '</th><td><input type="number" min="1" name="r_' + p + '" value="' + esc(x.resp) + '"></td><td><input type="number" min="1" name="s_' + p + '" value="' + esc(x.res) + '"></td></tr>'; }).join("") + "</tbody></table></div>" +
      '<div class="pl-2"><label>Calendário' + sel("mode", [["business", "Horário comercial"], ["24x7", "24 × 7"]], cl.mode) + '</label><span class="it-iu"><label>Início<input type="time" name="start" value="' + esc(cl.start) + '"></label><label>Fim<input type="time" name="end" value="' + esc(cl.end) + '"></label></span></div>' +
      '<div class="day-chips it-days">' + [[1, "seg"], [2, "ter"], [3, "qua"], [4, "qui"], [5, "sex"], [6, "sáb"], [0, "dom"]].map(function (d) { return '<label><input type="checkbox" name="d' + d[0] + '"' + (cl.days.indexOf(d[0]) >= 0 ? " checked" : "") + "> " + d[1] + "</label>"; }).join("") + '</div><p class="muted small">Fuso: Brasília (UTC−3). O relógio pausa em “Aguardando cliente” e “Aguardando aprovação”.</p>' +
      '<div class="pl-row-end"><button class="pl-btn primary sm">Salvar SLAs</button></div></form>' +
      "<b class=\"small\">Políticas por serviço</b><ul class=\"it-tasks\">" + list((data.sla || {}).policies).map(function (p) { return "<li><b>" + esc(p.name || "Política") + "</b> · " + esc(svcName(p.service) || "todos os serviços") + (p.area ? " · área " + esc(areaName(p.area) || p.area) : "") + (p.soc ? " · SOC" : "") + " · " + esc(p.priority) + " · resposta " + esc(p.resp) + " min · resolução " + esc(p.res) + ' min <button class="link" data-delpol="' + esc(p.id) + '">remover</button></li>'; }).join("") + "</ul>" +
      '<form class="it-inlf" id="polF"><input name="name" maxlength="40" placeholder="Nome (ex.: Ouro)" required>' + areaSelect("area", "", false) + '<select name="service">' + opt("", "Todos", "") + svcs.map(function (x) { return opt(x.id, x.name, ""); }).join("") + '</select><select name="priority">' + ["P1", "P2", "P3", "P4"].map(function (p) { return opt(p, p, "P1"); }).join("") + '</select><input name="resp" type="number" min="1" placeholder="resp. (min)" required><input name="res" type="number" min="1" placeholder="resol. (min)" required><button class="pl-btn sm">Adicionar</button></form></section>' +

      '<section class="it-scard" data-sec="change"><h3>Autoridade de mudança</h3><form class="pl-form" id="cabF"><div class="pl-2"><label>CAB (mudanças normais)' + multi("normal", cab.normal) + "</label><label>Autoridade emergencial (ECAB)" + multi("emergency", cab.emergency) + '</label></div><div class="pl-row-end"><button class="pl-btn primary sm">Salvar</button></div></form></section>' +

      socSlaSection() + excelSection() + areasSection() + domainsSection() + mailSection() +
      '<section class="it-scard" data-sec="conn"><h3>Workspaces conectados</h3><p class="muted small">Membros dos workspaces conectados podem abrir chamados como solicitantes, e a central aparece como atalho no workspace. Conectar exige ser dono do workspace.</p><div id="wsConn" class="it-pick"><p class="muted small">Carregando…</p></div></section>' +
      '<section class="it-scard" data-sec="conn"><h3>Planejamentos conectados</h3><p class="muted small">Problemas, mudanças e melhorias podem virar itens destes planejamentos; mudanças aprovadas aparecem como marcos no roadmap.</p><div id="plConn" class="it-pick"><p class="muted small">Carregando…</p></div></section>' +
      (isAdm || wsInfo.owner === MEK ? '<section class="it-scard danger" data-sec="geral"><h3>Excluir central</h3><p class="muted small">Apaga todos os registros, catálogo, base de conhecimento e CMDB desta central.</p><button class="pl-btn danger" id="delC">' + IC("trash", 14) + " Excluir central</button></section>" : "") +
      "</div></div>";
    el.querySelectorAll(".it-set > section").forEach(function (x) { x.hidden = x.dataset.sec !== cur; });
    el.querySelectorAll("[data-adm]").forEach(function (b) { b.onclick = function () { filter.adm = b.dataset.adm; renderView(); }; });
    const onb = el.querySelector(".it-admnav .on"); if (onb && window.innerWidth <= 760 && onb.scrollIntoView) onb.scrollIntoView({ block: "nearest", inline: "center" });
    bindAdminExtras(el);

    const sg = el.querySelector("#sgF"); sg.onsubmit = function (e) {
      e.preventDefault(); const u = {};
      u["info/title"] = sg.title.value.trim() || info.title; u["info/framework"] = sg.fw.value;
      u["data/settings/autoCloseDays"] = Number(sg.ac.value) || 0; u["data/settings/approvalRule"] = sg.ar.value; u["data/settings/trend"] = { n: Number(sg.tn.value) || 3, days: Number(sg.td.value) || 7 };
      u["data/settings/ai"] = sg.ai.checked; u["data/settings/emails"] = sg.em.checked;
      db.ref("itsm/" + ID).update(u).then(function () {
        info.title = u["info/title"]; info.framework = sg.fw.value;
        db.ref("workspaces/" + info.ws + "/itsm/" + ID + "/title").set(info.title).catch(function () { /* only the owner writes the index */ });
        toast("Configurações salvas"); shell();
      }, fail);
    };
    el.querySelectorAll("select[data-pk]").forEach(function (s2) { s2.onchange = function () { const p = ppl[s2.dataset.pk], u = {}; u["itsm/" + ID + "/info/members/" + p.k] = Object.assign({}, im[p.k] || {}, { email: p.email, name: p.name, role: s2.value }); u["userItsm/" + p.k + "/" + ID] = { title: info.title, role: s2.value }; db.ref().update(u).then(function () { toast("Papel atualizado"); }, fail); }; });
    el.querySelectorAll("[data-rmp]").forEach(function (b) { b.onclick = function () { const u = {}; u["itsm/" + ID + "/info/members/" + b.dataset.rmp] = null; u["userItsm/" + b.dataset.rmp + "/" + ID] = null; db.ref().update(u).then(function () { delete im[b.dataset.rmp]; renderView(); }, fail); }; });
    const ap = el.querySelector("#addP"); ap.onsubmit = function (e) {
      e.preventDefault(); const em = ap.email.value.trim().toLowerCase(), k = A.key(em), u = {};
      u["itsm/" + ID + "/info/members/" + k] = { email: em, name: ap.name.value.trim() || em.split("@")[0], role: ap.role.value, invitedBy: me.email, invitedAt: now() };
      u["userItsm/" + k + "/" + ID] = { title: info.title, role: ap.role.value };
      db.ref().update(u).then(function () { info.members = Object.assign({}, info.members || {}); info.members[k] = u["itsm/" + ID + "/info/members/" + k]; toast("Pessoa adicionada. Ela entra pelo link da central com este e-mail."); renderView(); }, fail);
    };
    el.querySelectorAll(".it-grp").forEach(function (gf) {
      gf.onsubmit = function (e) { e.preventDefault(); const m = {}; Array.prototype.forEach.call(gf.members.selectedOptions, function (x) { m[x.value] = true; }); db.ref("itsm/" + ID + "/data/settings/groups/" + gf.dataset.g).update({ name: gf.name.value.trim(), lead: gf.lead.value || null, members: Object.keys(m).length ? m : null, ola: Number(gf.ola.value) || null }).then(function () { toast("Grupo salvo"); }, fail); };
    });
    el.querySelectorAll("[data-delg]").forEach(function (b) { b.onclick = function () { db.ref("itsm/" + ID + "/data/settings/groups/" + b.dataset.delg).remove().catch(fail); }; });
    const ag = el.querySelector("#addG"); ag.onsubmit = function (e) { e.preventDefault(); const n = ag.name.value.trim(), gid = slug(n).replace(/-/g, "").slice(0, 12) || "g" + rnd(); db.ref("itsm/" + ID + "/data/settings/groups/" + gid).set({ name: n }).catch(fail); };
    const mf = el.querySelector("#mxF"); mf.onsubmit = function (e) { e.preventDefault(); const m = {}; I.LEVELS.forEach(function (i) { I.LEVELS.forEach(function (u) { m[i + "|" + u] = mf[i + "|" + u].value; }); }); db.ref("itsm/" + ID + "/data/settings/matrix").set(m).then(function () { toast("Matriz salva"); }, fail); };
    const sf = el.querySelector("#slF"); sf.onsubmit = function (e) {
      e.preventDefault(); const d = {}; ["P1", "P2", "P3", "P4"].forEach(function (p) { d[p] = { resp: Number(sf["r_" + p].value) || I.SLA_DEFAULT[p].resp, res: Number(sf["s_" + p].value) || I.SLA_DEFAULT[p].res }; });
      const days = [0, 1, 2, 3, 4, 5, 6].filter(function (x) { return sf["d" + x].checked; });
      const u = {}; u["sla/defaults"] = d; u["settings/calendar"] = { mode: sf.mode.value, start: sf.start.value || "08:00", end: sf.end.value || "18:00", days: days.length ? days : [1, 2, 3, 4, 5], tz: -180 };
      db.ref("itsm/" + ID + "/data").update(u).then(function () { toast("SLAs salvos (valem para os novos chamados e mudanças de prioridade)"); }, fail);
    };
    const pf = el.querySelector("#polF"); pf.onsubmit = function (e) { e.preventDefault(); db.ref("itsm/" + ID + "/data/sla/policies").push({ name: pf.name.value.trim(), service: pf.service.value || null, area: pf.area ? pf.area.value || null : null, priority: pf.priority.value, resp: Number(pf.resp.value), res: Number(pf.res.value) }).catch(fail); };
    el.querySelectorAll("[data-delpol]").forEach(function (b) { b.onclick = function () { db.ref("itsm/" + ID + "/data/sla/policies/" + b.dataset.delpol).remove().catch(fail); }; });
    const cf = el.querySelector("#cabF"); cf.onsubmit = function (e) { e.preventDefault(); const pick = function (s3) { const o = {}; Array.prototype.forEach.call(s3.selectedOptions, function (x) { o[x.value] = true; }); return Object.keys(o).length ? o : null; }; db.ref("itsm/" + ID + "/data/settings/cab").set({ normal: pick(cf.normal), emergency: pick(cf.emergency) }).then(function () { toast("Autoridade de mudança salva"); }, fail); };
    const dc = el.querySelector("#delC"); if (dc) dc.onclick = deleteCentral;
    connections(el);
  }
  function connections(el) {
    myWorkspaces().then(function (wss) {
      const own = Object.keys(wss).filter(function (w) { return w !== info.ws && (isAdm || ((wss[w] || {}).info || {}).owner === MEK); });
      const conn = info.workspaces || {}, box = el.querySelector("#wsConn");
      if (box) {
        box.innerHTML = '<label class="chk"><input type="checkbox" checked disabled> <b>' + esc(wsInfo.name || info.ws) + "</b> <span class=\"muted small\">workspace da licença</span></label>" +
          own.map(function (w) { return '<label class="chk"><input type="checkbox" data-wsc="' + esc(w) + '"' + (conn[w] ? " checked" : "") + "> " + esc(((wss[w] || {}).info || {}).name || w) + ' <span class="muted small">' + Object.keys((wss[w] || {}).members || {}).length + " pessoas</span></label>"; }).join("") +
          Object.keys(conn).filter(function (w) { return own.indexOf(w) < 0; }).map(function (w) { return '<label class="chk"><input type="checkbox" checked disabled> ' + esc(w) + ' <span class="muted small">conectado por outro dono</span></label>'; }).join("") +
          (Object.keys(conn).length ? '<button class="pl-btn sm" id="wsSync">' + IC("sync", 14) + " Sincronizar pessoas dos workspaces conectados</button>" : "");
        box.querySelectorAll("[data-wsc]").forEach(function (c) { c.onchange = function () { connectWs(c.dataset.wsc, c.checked, wss[c.dataset.wsc]); }; });
        const sy = box.querySelector("#wsSync"); if (sy) sy.onclick = function () { syncWsMembers(true); };
      }
      /* plannings of the home workspace and of the connected ones */
      const srcWs = [info.ws].concat(Object.keys(conn));
      return Promise.all(srcWs.map(function (w) { return (wss[w] ? Promise.resolve(wss[w]) : db.ref("workspaces/" + w).once("value").then(function (s) { return s.val(); }, function () { return null; })).then(function (x) { return [w, x]; }); })).then(function (rows) {
        const pb = el.querySelector("#plConn"); if (!pb) return;
        const plans = info.plans || {}; let h = "";
        rows.forEach(function (r) { const pls = ((r[1] || {}).plannings) || {}; Object.keys(pls).forEach(function (p) { h += '<label class="chk"><input type="checkbox" data-plc="' + esc(p) + '"' + (plans[p] ? " checked" : "") + "> " + esc(pls[p].title || p) + ' <span class="muted small">' + esc(((r[1] || {}).info || {}).name || r[0]) + "</span></label>"; }); });
        pb.innerHTML = h || '<p class="muted small">Nenhum planejamento nos workspaces da central. Crie um em Meus quadros → Novo planejamento (há modelos de Service management).</p>';
        pb.querySelectorAll("[data-plc]").forEach(function (c) { c.onchange = function () { db.ref("itsm/" + ID + "/info/plans/" + c.dataset.plc).set(c.checked || null).then(function () { info.plans = Object.assign({}, info.plans || {}); if (c.checked) info.plans[c.dataset.plc] = true; else delete info.plans[c.dataset.plc]; toast(c.checked ? "Planejamento conectado" : "Planejamento desconectado"); }, fail); }; });
      });
    }).catch(fail);
  }
  function connectWs(w, on, wsObj) {
    const u = {};
    u["itsm/" + ID + "/info/workspaces/" + w] = on || null;
    u["workspaces/" + w + "/itsm/" + ID] = on ? { title: info.title, created: TS(), home: false } : null;
    db.ref().update(u).then(function () {
      info.workspaces = Object.assign({}, info.workspaces || {}); if (on) info.workspaces[w] = true; else delete info.workspaces[w];
      return syncWsMembers(false, w, on ? wsObj : null);
    }).then(function () { toast(on ? "Workspace conectado" : "Workspace desconectado"); renderView(); }, fail);
  }
  /* copy the members of connected workspaces into the central as requesters (rules cannot walk a list of workspaces) */
  function syncWsMembers(loud) {
    const conn = Object.keys(info.workspaces || {}), im = info.members || {};
    return Promise.all(conn.map(function (w) { return db.ref("workspaces/" + w + "/members").once("value").then(function (s) { return [w, s.val() || {}]; }, function () { return [w, null]; }); })).then(function (rows) {
      const u = {}, keep = {};
      rows.forEach(function (r) {
        if (!r[1]) return;
        Object.keys(r[1]).forEach(function (k) {
          const m = r[1][k]; keep[k] = 1;
          if (!m || k === wsInfo.owner || wsMembers[k]) return;
          const cur = im[k];
          if (cur && !cur.via) return; /* invited directly: keep their role */
          const v = { email: m.email, name: m.name || (m.email || "").split("@")[0], role: (cur && cur.role) || "requester", via: r[0] };
          if (m.expires) v.expires = m.expires;
          u["itsm/" + ID + "/info/members/" + k] = v; u["userItsm/" + k + "/" + ID] = { title: info.title, role: v.role };
        });
      });
      Object.keys(im).forEach(function (k) { if (im[k].via && !keep[k]) { u["itsm/" + ID + "/info/members/" + k] = null; u["userItsm/" + k + "/" + ID] = null; } });
      if (!Object.keys(u).length) { if (loud) toast("Nada para sincronizar"); return; }
      return db.ref().update(u).then(function () { return db.ref("itsm/" + ID + "/info").once("value"); }).then(function (s) { info = s.val() || info; if (loud) { toast("Pessoas sincronizadas"); renderView(); } });
    });
  }
  function deleteCentral() {
    modal("<h2>Excluir central de serviços</h2><p>Digite o nome da central para confirmar: <b>" + esc(info.title) + '</b></p><form class="pl-form" id="dcF"><input name="t" autocomplete="off"><div class="pl-row-end"><button type="button" class="pl-btn" data-close>Cancelar</button><button class="pl-btn primary danger">Excluir definitivamente</button></div></form>', function (w, close) {
      const f = w.querySelector("#dcF"); f.onsubmit = function (e) {
        e.preventDefault(); if (f.t.value.trim() !== info.title) return toast("O nome não confere");
        db.ref("itsm/" + ID + "/data").off();
        const u = {}; u["itsm/" + ID] = null; u["workspaces/" + info.ws + "/itsm/" + ID] = null;
        Object.keys(info.members || {}).forEach(function (k) { u["userItsm/" + k + "/" + ID] = null; });
        db.ref().update(u).then(function () { Object.keys(info.workspaces || {}).forEach(function (wsx) { db.ref("workspaces/" + wsx + "/itsm/" + ID).remove().catch(function () { /* ignore */ }); }); close(); location.href = "./"; }, fail);
      };
    });
  }

  /* ---------------- help / onboarding: guiding principles, ITIL 4 and ITIL 5 ---------------- */
  function helpDialog() {
    modal("<h2>" + IC("itsm", 20) + ' Como funciona a central de serviços</h2><div class="it-help">' +
      "<p>O módulo segue o <b>ITIL 4</b> e o <b>ITIL (Versão 5)</b>, lançado pela PeopleCert em 2026. As 34 práticas e os princípios orientadores continuam os mesmos; o ITIL 5 troca a cadeia de valor de serviço (6 atividades) pelo ciclo de vida de produtos e serviços (8 atividades), amplia o escopo para produtos digitais e dá peso à experiência e à governança de IA. Cada registro mostra em que etapa está nos dois modelos.</p>" +
      '<div class="it-vcgrid"><div><b>ITIL 4 · cadeia de valor</b><p>' + Object.keys(I.VC4).map(function (k) { return esc(I.VC4[k]); }).join(" · ") + '</p></div><div><b>ITIL 5 · ciclo de vida</b><p>' + Object.keys(I.VC5).map(function (k) { return esc(I.VC5[k]); }).join(" · ") + "</p></div></div>" +
      "<h3>Princípios orientadores</h3><ol>" + I.PRINCIPLES.map(function (p) { return "<li><b>" + esc(p[0]) + ".</b> " + esc(p[1]) + "</li>"; }).join("") + "</ol>" +
      "<h3>Práticas nesta versão</h3><ul>" +
      "<li><b>Central de serviço:</b> portal do solicitante (catálogo, “Meus chamados”) e console do agente (filas, quadros).</li>" +
      "<li><b>Incidente:</b> prioridade por impacto × urgência (P1–P4), grupos, escalonamento funcional e hierárquico, incidente grave com comunicação.</li>" +
      "<li><b>Requisição de serviço:</b> ofertas do catálogo com formulário, aprovação e tarefas de cumprimento.</li>" +
      "<li><b>Problema:</b> abertura manual ou por tendência, controle de problema, erro conhecido e solução de contorno.</li>" +
      "<li><b>Habilitação de mudança:</b> padrão, normal e emergencial; avaliação de risco, CAB, calendário e revisão pós-implementação.</li>" +
      "<li><b>Nível de serviço:</b> SLAs de 1ª resposta e resolução, pausa em “Aguardando cliente”, verde/amarelo/vermelho e OLAs por grupo.</li>" +
      "<li><b>Catálogo, conhecimento e CMDB:</b> serviços e produtos digitais, artigos sugeridos ao abrir chamado, itens de configuração e impacto.</li>" +
      "<li><b>Melhoria contínua:</b> registro de melhorias ligado aos planejamentos conectados.</li></ul>" +
      "<h3>Primeiros passos</h3><ol><li>Revise o catálogo e os grupos de suporte.</li><li>Ajuste matriz de prioridade, SLAs e calendário em Configurações.</li><li>Conecte workspaces (solicitantes) e planejamentos (problemas, mudanças e melhorias viram itens).</li><li>Compartilhe o link da central: quem não é agente vê o portal.</li></ol></div>" +
      '<div class="pl-row-end"><button class="pl-btn primary" data-close>Entendi</button></div>', null, true);
  }

  start();
})();
