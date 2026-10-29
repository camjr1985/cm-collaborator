/* CM Collaborator – Administration: workspaces, boards and people (admins only; enforced by database.rules.json) */
(function () {
  "use strict";
  const A = window.CMAuth;
  const el = document.getElementById("admin");
  const t = function (s) { return (window.MBt || String)(s); };
  const PT = window.MB_LANG === "pt";
  const TEMPLATES = (window.MBTemplateList ? window.MBTemplateList() : [{ id: "persona", name: "Persona Map + Priority Map" }, { id: "blank", name: "Blank board" }]).map(function (x) { return [x.id, x.name]; });
  let db, me, ws = {}, feedback = {}, signups = {}, signupWs = null;
  const DAY = 86400000;
  function daysLeft(exp) { return Math.ceil((exp - Date.now()) / DAY); }
  function fmtDate(ts) { return new Date(ts).toLocaleDateString(PT ? "pt-PT" : "en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  function expiryBadge(m) {
    if (!m.expires) return '<span class="xp none">' + t("No time limit") + "</span>";
    const d = daysLeft(m.expires);
    if (d <= 0) return '<span class="xp off">' + t("Expired") + " · " + fmtDate(m.expires) + "</span>";
    return '<span class="xp' + (d <= 2 ? " soon" : "") + '">' + (PT ? d + (d === 1 ? " dia" : " dias") + " · até " : d + (d === 1 ? " day" : " days") + " left · until ") + fmtDate(m.expires) + "</span>";
  }
  function daysSelect(name, val) {
    return '<select name="' + name + '" aria-label="' + esc(t("Access period")) + '">' + [[0, "No time limit"], [7, "7 days"], [14, "14 days"], [30, "30 days"]].map(function (o) {
      return '<option value="' + o[0] + '"' + (Number(val || 0) === o[0] ? " selected" : "") + ">" + esc(t(o[1])) + "</option>";
    }).join("") + "</select>";
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function slug(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48); }
  function rnd() { return Math.random().toString(36).slice(2, 6); }
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
  function abs(rel) { return new URL(rel, location.href).href; }
  function TS() { return window.firebase.database.ServerValue.TIMESTAMP; }
  function sortByCreated(o) { return Object.keys(o || {}).sort(function (a, b) { return ((o[b] || {}).created || 0) - ((o[a] || {}).created || 0); }); }
  function tplName(k) { const x = TEMPLATES.find(function (p) { return p[0] === k; }); return x ? t(x[1]) : k; }
  function toast(msg) {
    let n = document.getElementById("toast");
    if (!n) { n = document.createElement("div"); n.id = "toast"; n.className = "site-toast"; n.setAttribute("role", "status"); document.body.appendChild(n); }
    n.textContent = t(msg); n.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { n.classList.remove("show"); }, 2600);
  }
  function fail(e) { console.warn(e); toast(e && e.message ? e.message : "Error"); }
  function screen(title, text, actions) {
    el.innerHTML = '<div class="card auth-card"><h2>' + t(title) + '</h2><p class="muted">' + text + "</p>" + (actions || "") + "</div>";
  }
  function setup() {
    screen("Setup required", t("Private access needs Firebase. Follow these steps once:"),
      '<ol class="setup"><li>Create a free project at <a href="https://console.firebase.google.com" target="_blank" rel="noopener">console.firebase.google.com</a>.</li>' +
      "<li>Authentication → Sign-in method: enable <b>Google</b> and <b>Email link (passwordless)</b>. In Settings → Authorized domains add <code>camjr1985.github.io</code>.</li>" +
      "<li>Realtime Database → Create database → Rules: paste the content of <code>database.rules.json</code> → Publish.</li>" +
      "<li>Realtime Database → Data: add <code>admins</code> → your e-mail with dots replaced by commas → <code>true</code>.</li>" +
      "<li>Project settings → Your apps → Web: copy the config into <code>assets/js/config.js</code> and push.</li></ol>");
  }

  /* ---------------- data ---------------- */
  function load() {
    return Promise.all([
      db.ref("workspaces").once("value"),
      db.ref("feedback").once("value").catch(function () { return { val: function () { return {}; } }; }),
      db.ref("signups").once("value").catch(function () { return { val: function () { return {}; } }; })
    ]).then(function (r) { ws = r[0].val() || {}; feedback = r[1].val() || {}; signups = r[2].val() || {}; render(); });
  }
  function update(u, okMsg) {
    return db.ref().update(u).then(function () { if (okMsg) toast(okMsg); return load(); }).catch(fail);
  }
  function createWorkspace(f) {
    const name = f.wsname.value.trim();
    if (!name) return toast("Give the workspace a name");
    const id = (slug(name) || "workspace") + "-" + rnd(), u = {};
    u["workspaces/" + id + "/info"] = { name: name, created: TS(), createdBy: me.email, accessDays: Number(f.days.value) || 0 };
    f.reset();
    update(u, "Workspace created").then(function () { const x = document.getElementById("ws-" + id); if (x) x.scrollIntoView({ behavior: "smooth" }); });
  }
  function createBoard(wsId, f) {
    const title = f.title.value.trim(), template = f.template.value;
    let id = slug(f.bid.value);
    if (!title) return toast("Give the board a name");
    if (!id) id = (slug(title) || "board") + "-" + rnd();
    if (!/^[a-z0-9-]{2,60}$/.test(id)) return toast("Board id: use lowercase letters, numbers and dashes");
    db.ref("boards/" + id + "/info").once("value").then(function (s) {
      if (s.exists()) return toast("A board with this id already exists");
      const u = {};
      u["boards/" + id + "/info"] = { title: title, ws: wsId, template: template, created: TS(), createdBy: me.email };
      u["workspaces/" + wsId + "/boards/" + id] = { title: title, template: template, created: TS() };
      f.reset();
      return update(u, "Board created");
    }).catch(fail);
  }
  function addMember(wsId, f) {
    const email = f.email.value.trim().toLowerCase(), name = f.name.value.trim(), role = f.role.value;
    if (!validEmail(email)) return toast("Enter a valid e-mail");
    const k = A.key(email), u = {}, days = Number(f.days.value) || 0;
    const expires = days ? Date.now() + days * DAY : null;
    u["workspaces/" + wsId + "/members/" + k] = { email: email, name: name || email.split("@")[0], role: role, invitedAt: TS(), invitedBy: me.email, expires: expires };
    u["userWorkspaces/" + k + "/" + wsId] = { name: ws[wsId].info.name, expires: expires };
    f.reset();
    update(u, "Access granted").then(function () { openInvite(wsId, k); });
  }
  function extendMember(wsId, k, days) {
    const m = ws[wsId].members[k], u = {};
    const expires = days ? Math.max(Date.now(), m.expires || Date.now()) + days * DAY : null;
    u["workspaces/" + wsId + "/members/" + k + "/expires"] = expires;
    u["userWorkspaces/" + k + "/" + wsId] = { name: ws[wsId].info.name, expires: expires };
    update(u, days ? "Access extended" : "Access without time limit");
  }
  function removeMember(wsId, k) {
    const m = ws[wsId].members[k];
    if (!window.confirm(t("Remove access for") + " " + m.email + "?")) return;
    const u = {};
    u["workspaces/" + wsId + "/members/" + k] = null;
    u["userWorkspaces/" + k + "/" + wsId] = null;
    update(u, "Access removed");
  }
  function setRole(wsId, k, role) {
    db.ref("workspaces/" + wsId + "/members/" + k + "/role").set(role).then(function () { ws[wsId].members[k].role = role; toast("Role updated"); }).catch(fail);
  }
  function renameBoard(wsId, id) {
    const cur = ws[wsId].boards[id].title;
    const v = window.prompt(t("New name for the board"), cur);
    if (!v || !v.trim() || v.trim() === cur) return;
    const u = {};
    u["boards/" + id + "/info/title"] = v.trim();
    u["workspaces/" + wsId + "/boards/" + id + "/title"] = v.trim();
    update(u, "Board renamed");
  }
  function deleteBoard(wsId, id) {
    const typed = window.prompt(t("This permanently deletes the board and its content. Type the board id to confirm:") + " " + id);
    if (typed !== id) return;
    const u = {};
    u["boards/" + id] = null;
    u["workspaces/" + wsId + "/boards/" + id] = null;
    update(u, "Board deleted");
  }
  function deleteWorkspace(wsId) {
    const w = ws[wsId];
    const typed = window.prompt(t("This permanently deletes the workspace, all its boards and removes everyone's access. Type the workspace name to confirm:") + " " + w.info.name);
    if (typed !== w.info.name) return;
    const u = {};
    Object.keys(w.boards || {}).forEach(function (id) { u["boards/" + id] = null; });
    Object.keys(w.members || {}).forEach(function (k) { u["userWorkspaces/" + k + "/" + wsId] = null; });
    u["workspaces/" + wsId] = null;
    update(u, "Workspace deleted");
  }

  /* ---------------- invitation ---------------- */
  function inviteText(wsId, m) {
    const w = ws[wsId], link = abs("../mentoring/"), fb = abs("../feedback/");
    if (PT) {
      return "Olá " + (m.name || "") + ",\n\nVocê foi convidado(a) para o workspace \"" + w.info.name + "\" no CM Collaborator.\n\n" +
        "1. Abra: " + link + "\n2. Entre com este e-mail: " + m.email + " (botão Google ou link de acesso por e-mail).\n3. Os seus quadros aparecem em \"Os meus quadros\"." +
        (m.expires ? "\n\nO seu acesso de teste é válido até " + fmtDate(m.expires) + ". Explore à vontade e, no fim, deixe a sua opinião (5 perguntas, 3 minutos): " + fb : "") +
        "\n\nObrigado!";
    }
    return "Hi " + (m.name || "") + ",\n\nYou've been invited to the workspace \"" + w.info.name + "\" on CM Collaborator.\n\n" +
      "1. Open: " + link + "\n2. Sign in with this e-mail: " + m.email + " (Google button or e-mail sign-in link).\n3. Your boards appear under \"My boards\"." +
      (m.expires ? "\n\nYour test access is valid until " + fmtDate(m.expires) + ". Explore freely and, at the end, share your opinion (5 questions, 3 minutes): " + fb : "") +
      "\n\nThank you!";
  }
  function openInvite(wsId, k) {
    const m = ((ws[wsId] || {}).members || {})[k]; if (!m) return;
    const txt = inviteText(wsId, m);
    const subject = PT ? "Convite: CM Collaborator – " + ws[wsId].info.name : "Invitation: CM Collaborator – " + ws[wsId].info.name;
    const dlg = document.getElementById("inviteDlg");
    dlg.querySelector("h2").textContent = t("Invite") + " " + (m.name || m.email);
    dlg.querySelector("textarea").value = txt;
    dlg.querySelector("#mailBtn").href = "mailto:" + encodeURIComponent(m.email) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(txt);
    dlg.hidden = false;
  }

  /* ---------------- beta sign-ups ---------------- */
  const SROLES = [["ux", "UX"], ["ui", "UI"], ["designer", "Designer"], ["architect", "Architect"], ["pm", "Project manager (GP)"], ["process", "Process analyst"], ["other", "Other"]];
  function suList() { return Object.keys(signups).map(function (k) { return Object.assign({ k: k }, signups[k]); }).sort(function (a, b) { return (b.t || 0) - (a.t || 0); }); }
  function betaWsDefault() {
    const ids = Object.keys(ws);
    if (signupWs && ws[signupWs]) return signupWs;
    const timed = ids.filter(function (id) { return ws[id].info && ws[id].info.accessDays; })
      .sort(function (a, b) { return (ws[b].info.created || 0) - (ws[a].info.created || 0); });
    const beta = timed.find(function (id) { return /beta/i.test(ws[id].info.name || ""); });
    return beta || timed[0] || ids[0] || null;
  }
  function grantUpdates(wsId, x, u) {
    const days = Number((ws[wsId].info || {}).accessDays) || 7, k = A.key(x.email);
    const expires = Date.now() + days * DAY;
    const m = { email: x.email, name: x.name || x.email.split("@")[0], role: "editor", invitedAt: TS(), invitedBy: me.email, expires: expires };
    u["workspaces/" + wsId + "/members/" + k] = m;
    u["userWorkspaces/" + k + "/" + wsId] = { name: ws[wsId].info.name, expires: expires };
    u["signups/" + x.k + "/status"] = "invited";
    u["signups/" + x.k + "/ws"] = wsId;
    u["signups/" + x.k + "/at"] = TS();
    return k;
  }
  function grantSignup(k) {
    const wsId = betaWsDefault(); if (!wsId) return toast("Create a workspace first");
    const x = Object.assign({ k: k }, signups[k]), u = {};
    const mk = grantUpdates(wsId, x, u);
    update(u, "Access granted").then(function () { openInvite(wsId, mk); });
  }
  function grantAllPending() {
    const wsId = betaWsDefault(); if (!wsId) return toast("Create a workspace first");
    const pend = suList().filter(function (x) { return x.status !== "invited"; });
    if (!pend.length) return toast("No pending requests");
    if (!window.confirm(t("Give 7-day access to all pending requests?") + " (" + pend.length + ")")) return;
    const u = {};
    pend.forEach(function (x) { grantUpdates(wsId, x, u); });
    update(u, "Access granted").then(function () { openBulkInvite(wsId, pend.map(function (x) { return x.email; })); });
  }
  function openBulkInvite(wsId, emails) {
    const w = ws[wsId], days = Number(w.info.accessDays) || 7, until = fmtDate(Date.now() + days * DAY);
    const link = abs("../mentoring/"), fb = abs("../feedback/");
    const txt = PT
      ? "Olá,\n\nObrigado por se inscrever no beta do CM Collaborator! O seu acesso de teste já está ativo.\n\n1. Abra: " + link + "\n2. Entre com o e-mail com que se inscreveu (botão Google ou link de acesso por e-mail).\n3. O workspace \"" + w.info.name + "\" aparece em \"Os meus quadros\".\n\nO acesso é válido até " + until + ". No fim, deixe a sua opinião (5 perguntas, 3 minutos): " + fb + "\n\nObrigado!"
      : "Hi,\n\nThank you for joining the CM Collaborator beta! Your test access is now active.\n\n1. Open: " + link + "\n2. Sign in with the e-mail you signed up with (Google button or e-mail sign-in link).\n3. The workspace \"" + w.info.name + "\" appears under \"My boards\".\n\nAccess is valid until " + until + ". At the end, share your opinion (5 questions, 3 minutes): " + fb + "\n\nThank you!";
    const subject = PT ? "O seu acesso ao beta do CM Collaborator" : "Your CM Collaborator beta access";
    const dlg = document.getElementById("inviteDlg");
    dlg.querySelector("h2").textContent = t("Invite") + " " + emails.length + " " + t("people");
    dlg.querySelector("textarea").value = txt + "\n\n---\nBCC: " + emails.join(", ");
    dlg.querySelector("#mailBtn").href = "mailto:?bcc=" + encodeURIComponent(emails.join(",")) + "&subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(txt);
    dlg.hidden = false;
  }
  function exportSignups() {
    const cols = ["date", "name", "email", "role", "language", "source", "status", "workspace"];
    const q = function (v) { v = v == null ? "" : String(v); return '"' + v.replace(/"/g, '""') + '"'; };
    const rows = suList().map(function (x) { return [x.t ? new Date(x.t).toISOString() : "", x.name, x.email, label(SROLES, x.role), x.lang, x.src, x.status || "pending", x.ws ? ((ws[x.ws] || {}).info || {}).name || x.ws : ""].map(q).join(","); });
    const blob = new Blob(["\ufeff" + cols.join(",") + "\n" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "cm-collaborator-beta-signups-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
  }
  function signupsSection() {
    const list = suList(), pend = list.filter(function (x) { return x.status !== "invited"; }).length, wsId = betaWsDefault();
    let h = '<section class="card fb-report su-report" id="signups"><div class="br-head"><div><span class="eyebrow sm">Beta</span><h2>' + t("Beta sign-ups") + '</h2><p class="muted small">' + t("Requests from the beta launch page. One click gives 7-day access to the selected workspace.") + "</p></div>" +
      '<div class="br-actions"><button class="btn sm" data-copy-beta>' + t("Copy beta page link") + "</button>" + (list.length ? '<button class="btn sm" id="suCsv">' + t("Export CSV") + "</button>" : "") + (pend ? '<button class="btn sm primary" id="suAll">' + t("Invite all pending") + " (" + pend + ")</button>" : "") + "</div></div>";
    h += '<div class="copy-row"><input readonly value="' + esc(abs("../beta/")) + '" class="no-i18n"></div>';
    h += '<div class="fb-kpis"><div><b>' + list.length + "</b><span>" + t("Sign-ups") + "</span></div><div><b>" + pend + "</b><span>" + t("Pending") + "</span></div><div><b>" + (list.length - pend) + "</b><span>" + t("Invited") + "</span></div></div>";
    if (Object.keys(ws).length) {
      h += '<label class="su-target">' + t("Give access to workspace") + ' <select id="suWs">' + Object.keys(ws).map(function (id) {
        return '<option value="' + esc(id) + '"' + (id === wsId ? " selected" : "") + ' class="no-i18n">' + esc(ws[id].info.name) + (ws[id].info.accessDays ? " · " + ws[id].info.accessDays + "d" : "") + "</option>";
      }).join("") + "</select></label>";
    }
    if (!list.length) return h + '<div class="empty-big"><p class="muted">' + t("No sign-ups yet. Share the beta page link.") + "</p></div></section>";
    h += '<div class="su-table-wrap"><table class="su-table"><thead><tr><th>' + t("Name") + "</th><th>E-mail</th><th>" + t("Role") + "</th><th>" + t("Date") + "</th><th>" + t("Source") + "</th><th>" + t("Status") + "</th><th></th></tr></thead><tbody>" +
      list.map(function (x) {
        const inv = x.status === "invited";
        return "<tr><td class=\"no-i18n\"><b>" + esc(x.name) + '</b></td><td class="no-i18n">' + esc(x.email) + "</td><td>" + esc(label(SROLES, x.role)) + '</td><td class="no-i18n">' + (x.t ? fmtDate(x.t) : "") + '</td><td class="no-i18n muted">' + esc(x.src || "") + "</td>" +
          "<td>" + (inv ? '<span class="xp">' + t("Invited") + "</span>" : '<span class="xp soon">' + t("Pending") + "</span>") + "</td>" +
          '<td class="su-act"><div>' + (inv ? "" : '<button class="btn sm primary" data-grant="' + esc(x.k) + '">' + t("Give 7-day access") + "</button>") + '<button class="link" data-delsu="' + esc(x.k) + '">' + t("delete") + "</button></div></td></tr>";
      }).join("") + "</tbody></table></div></section>";
    return h;
  }

  /* ---------------- feedback report ---------------- */
  function fbList() { return Object.keys(feedback).map(function (k) { return Object.assign({ id: k }, feedback[k]); }).sort(function (a, b) { return (b.t || 0) - (a.t || 0); }); }
  function avg(list, f) { const v = list.map(function (x) { return x[f]; }).filter(function (x) { return typeof x === "number"; }); return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null; }
  function nps(list) {
    const v = list.map(function (x) { return x.nps; }).filter(function (x) { return typeof x === "number"; });
    if (!v.length) return null;
    const pro = v.filter(function (x) { return x >= 9; }).length, det = v.filter(function (x) { return x <= 6; }).length;
    return Math.round((pro - det) / v.length * 100);
  }
  function label(list, key) { const x = (list || []).find(function (p) { return p[0] === key; }); return x ? t(x[1]) : key; }
  function bars(counts, total, labels) {
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).map(function (k) {
      const pct = total ? Math.round(counts[k] / total * 100) : 0;
      return '<div class="fb-bar"><span class="fb-bl">' + esc(label(labels, k)) + '</span><span class="fb-bt"><i style="width:' + pct + '%"></i></span><span class="fb-bn">' + counts[k] + "</span></div>";
    }).join("");
  }
  function feedbackSection() {
    const list = fbList(), F = window.MBFeedback || { ROLES: [], FEATURES: [] };
    let h = '<section class="card fb-report" id="feedback"><div class="br-head"><div><span class="eyebrow sm">Feedback</span><h2>' + t("Tester feedback") + '</h2><p class="muted small">' + t("Answers from the feedback form (inside the boards and at the link below).") + '</p></div>' +
      '<div class="br-actions"><button class="btn sm" data-copy-fb>' + t("Copy form link") + "</button>" + (list.length ? '<button class="btn sm primary" id="fbCsv">' + t("Export CSV") + "</button>" : "") + "</div></div>";
    h += '<div class="copy-row"><input readonly value="' + esc(abs("../feedback/")) + '" class="no-i18n"></div>';
    if (!list.length) return h + '<div class="empty-big"><p class="muted">' + t("No feedback yet. Share the form link with your testers.") + "</p></div></section>";
    const a1 = avg(list, "sat"), a2 = avg(list, "ease"), n = nps(list);
    const roles = {}, feats = {};
    list.forEach(function (x) { if (x.role) roles[x.role] = (roles[x.role] || 0) + 1; Object.keys(x.features || {}).forEach(function (f) { feats[f] = (feats[f] || 0) + 1; }); });
    h += '<div class="fb-kpis"><div><b>' + list.length + "</b><span>" + t("Responses") + "</span></div>" +
      "<div><b>" + (a1 === null ? "–" : a1.toFixed(1)) + "<small>/5</small></b><span>" + t("Satisfaction") + "</span></div>" +
      "<div><b>" + (a2 === null ? "–" : a2.toFixed(1)) + "<small>/5</small></b><span>" + t("Ease of use") + "</span></div>" +
      "<div><b>" + (n === null ? "–" : (n > 0 ? "+" : "") + n) + "</b><span>NPS</span></div></div>";
    h += '<div class="fb-cols"><div><h3>' + t("Roles") + "</h3>" + bars(roles, list.length, F.ROLES) + "</div><div><h3>" + t("Features tried") + "</h3>" + bars(feats, list.length, F.FEATURES) + "</div></div>";
    h += "<h3>" + t("Responses") + '</h3><div class="fb-resp">' + list.map(function (x) {
      return '<article class="fb-item"><header><b class="no-i18n">' + esc(x.name || x.email || "") + '</b> <span class="muted small no-i18n">' + esc(x.email || "") + " · " + (x.t ? fmtDate(x.t) : "") + "</span>" +
        '<span class="fb-tags"><span>' + esc(label(F.ROLES, x.role)) + "</span><span>★ " + (x.sat || "–") + "</span><span>" + t("Ease") + " " + (x.ease || "–") + "</span><span>NPS " + (x.nps === undefined ? "–" : x.nps) + "</span></span>" +
        '<button class="link" data-delfb="' + x.id + '">' + t("delete") + "</button></header>" +
        (x.pain ? '<p><b>' + t("Difficulty / bug:") + '</b> <span class="no-i18n">' + esc(x.pain) + "</span></p>" : "") +
        (x.ideas ? '<p><b>' + t("Suggestions:") + '</b> <span class="no-i18n">' + esc(x.ideas) + "</span></p>" : "") + "</article>";
    }).join("") + "</div></section>";
    return h;
  }
  function exportCsv() {
    const F = window.MBFeedback || { FEATURES: [] };
    const cols = ["date", "name", "email", "role", "satisfaction_1_5", "ease_1_5", "nps_0_10", "features", "difficulty_bug", "suggestions", "board"];
    const q = function (v) { v = v == null ? "" : String(v); return '"' + v.replace(/"/g, '""') + '"'; };
    const rows = fbList().map(function (x) {
      return [x.t ? new Date(x.t).toISOString() : "", x.name, x.email, x.role, x.sat, x.ease, x.nps, Object.keys(x.features || {}).map(function (f) { return label(F.FEATURES, f); }).join("; "), x.pain, x.ideas, x.board].map(q).join(",");
    });
    const blob = new Blob(["\ufeff" + cols.join(",") + "\n" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "cm-collaborator-feedback-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------------- UI ---------------- */
  function templateOptions() { return TEMPLATES.map(function (p) { return '<option value="' + p[0] + '">' + t(p[1]) + "</option>"; }).join(""); }
  function roleSelect(name, val, attr) {
    return '<select ' + (name ? 'name="' + name + '" ' : "") + (attr || "") + ' aria-label="' + t("Access") + '"><option value="editor"' + (val !== "viewer" ? " selected" : "") + ">" + t("Can edit") + '</option><option value="viewer"' + (val === "viewer" ? " selected" : "") + ">" + t("View only") + "</option></select>";
  }
  function render() {
    const ids = sortByCreated(Object.keys(ws).reduce(function (o, k) { o[k] = (ws[k] || {}).info || {}; return o; }, {}));
    const nBoards = ids.reduce(function (a, id) { return a + Object.keys(ws[id].boards || {}).length; }, 0);
    const people = {};
    ids.forEach(function (id) { Object.keys(ws[id].members || {}).forEach(function (k) { people[k] = 1; }); });

    let h = '<div class="userbar"><span class="muted"><span>Administrator</span>: <b class="no-i18n">' + esc(me.email) + '</b></span><a class="btn" href="../mentoring/">My boards</a><button class="btn" id="soBtn">Sign out</button></div>';
    h += '<div class="admin-grid"><section class="card"><h2>New workspace</h2><p class="muted small">A workspace groups boards and people – e.g. "Mentoring 2026", "Consulting – Company X". People invited to a workspace see all its boards.</p>' +
      '<form id="newWs" class="form-inline ws-form"><input name="wsname" required placeholder="' + esc(t("Workspace name")) + '" autocomplete="off">' + daysSelect("days", 0) + '<button class="btn primary">Create workspace</button></form>' +
      '<p class="muted small">' + t("Access period: choose 7 days for beta testers – access closes automatically.") + "</p></section>" +
      '<section class="card stats"><h2>Overview</h2><div class="stat-row"><div class="stat"><b>' + ids.length + "</b><span>Workspaces</span></div><div class=\"stat\"><b>" + nBoards + "</b><span>Boards</span></div><div class=\"stat\"><b>" + Object.keys(people).length + "</b><span>People</span></div><a class=\"stat\" href=\"#signups\"><b>" + Object.keys(signups).length + "</b><span>Sign-ups</span></a><a class=\"stat\" href=\"#feedback\"><b>" + Object.keys(feedback).length + "</b><span>Feedback</span></a></div>" +
      '<p class="muted small">Only invited e-mails can open a workspace. Admins are managed in the Firebase console.</p></section></div>';

    h += signupsSection();
    if (!ids.length) h += '<div class="card empty-big" style="margin-top:24px"><h3>No workspaces yet</h3><p class="muted">Create the first one above – for example "Mentoring".</p></div>';

    h += ids.map(function (id) {
      const w = ws[id], boards = w.boards || {}, members = w.members || {};
      const bIds = sortByCreated(boards), mIds = Object.keys(members).sort(function (a, b) { return (members[a].name || "").localeCompare(members[b].name || ""); });
      const bl = bIds.map(function (b) {
        const x = boards[b];
        return '<li class="brow"><span class="b-ic" aria-hidden="true"></span><span class="m-who"><b class="no-i18n">' + esc(x.title) + '</b><span class="muted">' + esc(tplName(x.template)) + ' · <span class="no-i18n">' + esc(b) + "</span></span></span>" +
          '<a class="btn sm primary" href="../board/?id=' + encodeURIComponent(b) + '">Open</a>' +
          '<button class="btn sm" data-copy="' + b + '">Copy link</button>' +
          '<button class="btn sm ghost" data-ren="' + id + "|" + b + '">Rename</button>' +
          '<button class="btn sm ghost danger-t" data-delb="' + id + "|" + b + '">Delete</button></li>';
      }).join("");
      const ml = mIds.map(function (k) {
        const m = members[k];
        return '<li class="member"><span class="av sm no-i18n">' + esc((m.name || m.email)[0].toUpperCase()) + '</span><span class="m-who"><b class="no-i18n">' + esc(m.name || "") + '</b><span class="muted no-i18n">' + esc(m.email) + "</span></span>" +
          roleSelect("", m.role, 'data-role="' + id + "|" + k + '"') +
          '<button class="btn sm" data-invite="' + id + "|" + k + '">Invite</button><button class="btn sm ghost danger-t" data-remove="' + id + "|" + k + '">Remove</button>' +
          '<span class="m-exp">' + expiryBadge(m) + '<button class="link" data-ext="' + id + "|" + k + '|7">' + t("+7 days") + "</button>" + (m.expires ? '<button class="link" data-ext="' + id + "|" + k + '|0">' + t("Remove limit") + "</button>" : "") + "</span></li>";
      }).join("");
      return '<section class="card ws-card" id="ws-' + id + '"><div class="br-head"><div><span class="eyebrow sm">Workspace</span><h2 class="no-i18n">' + esc(w.info.name) + "</h2>" + (w.info.accessDays ? '<span class="xp">' + esc(t("Default access")) + ": " + w.info.accessDays + " " + esc(t("days")) + "</span>" : "") + "</div>" +
        '<button class="btn sm ghost danger-t" data-delws="' + id + '">Delete workspace</button></div>' +
        '<div class="ws-cols"><div><h3>Boards <span class="count">' + bIds.length + "</span></h3>" +
        '<ul class="members">' + (bl || '<li class="muted small">No boards yet.</li>') + "</ul>" +
        '<form class="form-grid3" data-newboard="' + id + '"><input name="title" required placeholder="' + esc(t("Board name, e.g. Joaquim Ventura")) + '" autocomplete="off">' +
        '<select name="template" aria-label="Template">' + templateOptions() + '</select>' +
        '<input name="bid" placeholder="' + esc(t("Link id (optional)")) + '" autocomplete="off" pattern="[a-z0-9-]{2,60}">' +
        '<button class="btn primary">New board</button></form></div>' +
        '<div><h3>People with access <span class="count">' + mIds.length + "</span></h3>" +
        '<ul class="members">' + (ml || '<li class="muted small">No one has access yet.</li>') + "</ul>" +
        '<form class="form-grid3" data-add="' + id + '"><input name="name" placeholder="' + esc(t("Name")) + '" autocomplete="off"><input name="email" type="email" required placeholder="name@email.com" autocomplete="off">' +
        roleSelect("role", "editor") + daysSelect("days", w.info.accessDays) + '<button class="btn primary">Grant access</button></form></div></div></section>';
    }).join("");

    h += feedbackSection();
    h += '<div class="modal-lite" id="inviteDlg" hidden><div class="card"><h2></h2><p class="muted small">Send this message to the person. They sign in with the invited e-mail and see the workspace boards.</p>' +
      '<textarea rows="10" readonly></textarea><div class="row-end"><button class="btn" id="dlgClose">Close</button><button class="btn" id="copyInv">Copy message</button><a class="btn primary" id="mailBtn" href="#">Open in e-mail</a></div></div></div>';
    el.innerHTML = h;

    document.getElementById("newWs").onsubmit = function (e) { e.preventDefault(); createWorkspace(e.target); };
    document.getElementById("soBtn").onclick = A.signOut;
    el.querySelectorAll("form[data-newboard]").forEach(function (f) { f.onsubmit = function (e) { e.preventDefault(); createBoard(f.dataset.newboard, f); }; });
    el.querySelectorAll("form[data-add]").forEach(function (f) { f.onsubmit = function (e) { e.preventDefault(); addMember(f.dataset.add, f); }; });
    function pair(s) { return s.split("|"); }
    el.querySelectorAll("[data-role]").forEach(function (s) { s.onchange = function () { const p = pair(s.dataset.role); setRole(p[0], p[1], s.value); }; });
    el.querySelectorAll("[data-invite]").forEach(function (b) { b.onclick = function () { const p = pair(b.dataset.invite); openInvite(p[0], p[1]); }; });
    el.querySelectorAll("[data-remove]").forEach(function (b) { b.onclick = function () { const p = pair(b.dataset.remove); removeMember(p[0], p[1]); }; });
    el.querySelectorAll("[data-delb]").forEach(function (b) { b.onclick = function () { const p = pair(b.dataset.delb); deleteBoard(p[0], p[1]); }; });
    el.querySelectorAll("[data-ren]").forEach(function (b) { b.onclick = function () { const p = pair(b.dataset.ren); renameBoard(p[0], p[1]); }; });
    el.querySelectorAll("[data-delws]").forEach(function (b) { b.onclick = function () { deleteWorkspace(b.dataset.delws); }; });
    el.querySelectorAll("[data-ext]").forEach(function (b) { b.onclick = function () { const p = pair(b.dataset.ext); extendMember(p[0], p[1], Number(p[2])); }; });
    const suWs = document.getElementById("suWs"); if (suWs) suWs.onchange = function () { signupWs = suWs.value; };
    const suAll = document.getElementById("suAll"); if (suAll) suAll.onclick = grantAllPending;
    const suCsv = document.getElementById("suCsv"); if (suCsv) suCsv.onclick = exportSignups;
    el.querySelectorAll("[data-grant]").forEach(function (b) { b.onclick = function () { grantSignup(b.dataset.grant); }; });
    el.querySelectorAll("[data-delsu]").forEach(function (b) { b.onclick = function () { if (window.confirm(t("Delete this sign-up?"))) db.ref("signups/" + b.dataset.delsu).remove().then(load, fail); }; });
    el.querySelectorAll("[data-copy-beta]").forEach(function (b) { b.onclick = function () { navigator.clipboard.writeText(abs("../beta/")).then(function () { toast("Link copied"); }); }; });
    const csv = document.getElementById("fbCsv"); if (csv) csv.onclick = exportCsv;
    el.querySelectorAll("[data-delfb]").forEach(function (b) { b.onclick = function () { if (window.confirm(t("Delete this response?"))) db.ref("feedback/" + b.dataset.delfb).remove().then(load, fail); }; });
    el.querySelectorAll("[data-copy-fb]").forEach(function (b) { b.onclick = function () { navigator.clipboard.writeText(abs("../feedback/")).then(function () { toast("Link copied"); }); }; });
    el.querySelectorAll("[data-copy]").forEach(function (b) {
      b.onclick = function () { navigator.clipboard.writeText(abs("../board/?id=" + encodeURIComponent(b.dataset.copy))).then(function () { toast("Link copied"); }); };
    });
    const dlg = document.getElementById("inviteDlg");
    document.getElementById("dlgClose").onclick = function () { dlg.hidden = true; };
    dlg.onclick = function (e) { if (e.target === dlg) dlg.hidden = true; };
    document.getElementById("copyInv").onclick = function () { navigator.clipboard.writeText(dlg.querySelector("textarea").value).then(function () { toast("Message copied"); }); };
  }

  function start() {
    if (!A || !A.enabled) return setup();
    el.innerHTML = '<p class="muted">' + t("Loading…") + "</p>";
    A.ready().then(function (user) {
      if (!user) return screen("Sign in required", t("Administration is only for the account owner."), '<a class="btn primary" href="../mentoring/?next=' + encodeURIComponent(location.pathname) + '">' + t("Sign in") + "</a>");
      me = user; db = A.db();
      return A.isAdmin().then(function (ok) {
        if (!ok) {
          screen("Admins only", t("Your account (" + esc(user.email) + ") is not an administrator."), '<a class="btn primary" href="../mentoring/">' + t("My boards") + '</a> <button class="btn" id="so2">' + t("Sign out") + "</button>");
          const so = document.getElementById("so2"); if (so) so.onclick = A.signOut;
          return;
        }
        const na = document.getElementById("navAdmin"); if (na) na.hidden = false;
        return load();
      });
    }).catch(function (e) { screen("Error", esc(e.message)); });
  }
  start();
})();
