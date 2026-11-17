/* CM Collaborator – Administration: workspaces, boards and people (admins only; enforced by database.rules.json) */
(function () {
  "use strict";
  const A = window.CMAuth;
  const el = document.getElementById("admin");
  const t = function (s) { return (window.MBt || String)(s); };
  const PT = window.MB_LANG === "pt";
  const TEMPLATES = (window.MBTemplateList ? window.MBTemplateList() : [{ id: "persona", name: "Persona Map + Priority Map" }, { id: "blank", name: "Blank board" }]).map(function (x) { return [x.id, x.name]; });
  let db, me, ws = {}, ent = { ws: {}, users: {} }, modReq = {}, feedback = {}, signups = {}, signupWs = null, signupDays = null, plans = {}, announcement = null, OWNER = false, PLAN = null, MEK = null;
  const DAY = 86400000;
  function daysLeft(exp) { return Math.ceil((exp - Date.now()) / DAY); }
  function fmtDate(ts) { return new Date(ts).toLocaleDateString(window.MB_LOCALE || (PT ? "pt-BR" : "en-GB"), { day: "2-digit", month: "short", year: "numeric" }); }
  function expiryBadge(m) {
    if (!m.expires) return '<span class="xp none">' + t("Full access") + "</span>";
    const d = daysLeft(m.expires);
    if (d <= 0) return '<span class="xp off">' + t("Expired") + " · " + fmtDate(m.expires) + "</span>";
    return '<span class="xp' + (d <= 2 ? " soon" : "") + '">' + (PT ? d + (d === 1 ? " dia" : " dias") + " · até " : d + (d === 1 ? " day" : " days") + " left · until ") + fmtDate(m.expires) + "</span>";
  }
  function daysSelect(name, val) {
    return '<select name="' + name + '" aria-label="' + esc(t("Access period")) + '">' + [[7, "Temporary · 7 days"], [14, "Temporary · 14 days"], [30, "Temporary · 30 days"], [0, "Full access (no time limit)"]].map(function (o) {
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
    if (OWNER) {
      return Promise.all([
        db.ref("userWorkspaces/" + MEK).once("value"),
        db.ref("plans/" + MEK).once("value").catch(function () { return { val: function () { return null; } }; })
      ]).then(function (r) {
        PLAN = window.CMPlan(r[1].val());
        const raw = r[0].val() || {}, ids = Object.keys(raw).filter(function (k) { return raw[k] && raw[k].owner; });
        return Promise.all(ids.map(function (id) { return db.ref("workspaces/" + id).once("value").then(function (x) { return [id, x.val()]; }, function () { return [id, null]; }); }));
      }).then(function (rows) { ws = {}; rows.forEach(function (x) { if (x[1]) ws[x[0]] = x[1]; }); render(); });
    }
    return Promise.all([
      db.ref("announcement").once("value").catch(function () { return { val: function () { return null; } }; }),
      db.ref("plans").once("value").catch(function () { return { val: function () { return {}; } }; }),
      db.ref("workspaces").once("value"),
      db.ref("feedback").once("value").catch(function () { return { val: function () { return {}; } }; }),
      db.ref("signups").once("value").catch(function () { return { val: function () { return {}; } }; }),
      db.ref("entitlements").once("value").catch(function () { return { val: function () { return null; } }; }),
      db.ref("moduleRequests").once("value").catch(function () { return { val: function () { return null; } }; })
    ]).then(function (r) { announcement = r[0].val(); plans = r[1].val() || {}; ws = r[2].val() || {}; feedback = r[3].val() || {}; signups = r[4].val() || {}; ent = Object.assign({ ws: {}, users: {} }, r[5].val() || {}); modReq = r[6].val() || {}; render(); });
  }
  function update(u, okMsg) {
    return db.ref().update(u).then(function () { if (okMsg) toast(okMsg); return load(); }).catch(fail);
  }
  /* area of work (healthcare, retail, consulting, education, service management…) – drives the ready-made plannings */
  function areaSelect(name, cur, attrs) {
    const AR = window.PLAN_AREAS || {}, AO = window.PLAN_AREA_ORDER || [];
    if (!AO.length) return "";
    return '<select ' + (name ? 'name="' + name + '" ' : "") + (attrs || "") + ' class="no-i18n" title="' + esc(window.MB_LANG === "pt" ? "Área de atuação" : "Area of work") + '"><option value="">' + esc(window.MB_LANG === "pt" ? "Área de atuação…" : "Area of work…") + "</option>" + AO.map(function (k) { return '<option value="' + k + '"' + (k === cur ? " selected" : "") + ">" + esc(AR[k].name) + "</option>"; }).join("") + "</select>";
  }
  function createWorkspace(f) {
    const name = f.wsname.value.trim();
    if (!name) return toast("Give the workspace a name");
    if (OWNER && Object.keys(ws).length >= PLAN.workspaces) return limit(t("Your plan allows") + " " + PLAN.workspaces + " " + t(PLAN.workspaces === 1 ? "workspace" : "workspaces") + ".");
    const id = (slug(name) || "workspace") + "-" + rnd(), u = {};
    const pros = !!(f.prospect && f.prospect.checked);
    const info = { name: name, created: TS(), createdBy: me.email, accessDays: Number(f.days.value) || (pros ? 14 : 0) };
    if (pros) info.prospect = true;
    if (f.area && f.area.value) info.area = f.area.value;
    if (OWNER) { info.owner = MEK; info.ownerEmail = me.email; u["userWorkspaces/" + MEK + "/" + id] = { name: name, owner: true }; }
    u["workspaces/" + id + "/info"] = info;
    f.reset();
    update(u, "Workspace created").then(function () { const x = document.getElementById("ws-" + id); if (x) x.scrollIntoView({ behavior: "smooth" }); });
  }
  function createBoard(wsId, f) {
    const title = f.title.value.trim(), template = f.template.value;
    let id = slug(f.bid.value);
    if (!title) return toast("Give the board a name");
    if (!id) id = (slug(title) || "board") + "-" + rnd();
    if (!/^[a-z0-9-]{2,60}$/.test(id)) return toast("Board id: use lowercase letters, numbers and dashes");
    if (OWNER && Object.keys(ws[wsId].boards || {}).length >= PLAN.boards) return limit(t("Your plan allows") + " " + PLAN.boards + " " + t("boards per workspace") + ".");
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
    if (OWNER && k !== MEK) {
      const people = {}; Object.keys(ws).forEach(function (w) { Object.keys(ws[w].members || {}).forEach(function (m) { if (m !== MEK) people[m] = 1; }); });
      if (!people[k] && Object.keys(people).length >= PLAN.seats) return limit(t("Your plan includes") + " " + PLAN.seats + " " + t("invited people") + ".");
    }
    const expires = days ? Date.now() + days * DAY : null;
    u["workspaces/" + wsId + "/members/" + k] = { email: email, name: name || email.split("@")[0], role: role, invitedAt: TS(), invitedBy: me.email, expires: expires };
    u["userWorkspaces/" + k + "/" + wsId] = { name: ws[wsId].info.name, expires: expires };
    const kind = f.mailType ? f.mailType.value : "welcome";
    f.reset();
    update(u).then(function () {
      if (kind !== "prospect") return inviteAndTell([email], wsId);
      // access is now real in the database → only then the prospecting e-mail (after explicit confirmation)
      if (window.confirm(t("Access created. Send the sales prospecting e-mail now to") + " " + email + "?")) sendProspect(wsId, [email]);
      else toast("Access created – the prospecting e-mail was not sent");
    });
  }
  function extendMember(wsId, k, days) {
    const m = ws[wsId].members[k], u = {};
    const expires = days ? Math.max(Date.now(), m.expires || Date.now()) + days * DAY : null;
    u["workspaces/" + wsId + "/members/" + k + "/expires"] = expires;
    u["userWorkspaces/" + k + "/" + wsId] = { name: ws[wsId].info.name, expires: expires };
    update(u, days ? "Access extended" : "Full access granted");
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
  function planList(wsId, w) {
    const pl = w.plannings || {}, ids = Object.keys(pl).sort(function (a, b) { return (pl[b].created || 0) - (pl[a].created || 0); }), M = window.PLAN_METHODS || {};
    const ic = function (n) { return window.CMIcon ? window.CMIcon(n, 15) : ""; };
    return '<h3 class="pl-adm-h">' + ic("planning") + " " + t("Plannings") + ' <span class="count">' + ids.length + "</span>" + (window.CMNewBadge ? window.CMNewBadge("planning") : "") + "</h3>" +
      '<ul class="members">' + (ids.map(function (pid) {
        const p = pl[pid], m = M[p.method] || {};
        return '<li class="brow"><span class="b-ic plan" aria-hidden="true">' + ic(m.icon || "planning") + '</span><span class="m-who"><b class="no-i18n">' + esc(p.title || pid) + '</b><span class="muted">' + esc(m.name || "") + ' · <span class="no-i18n">' + esc(pid) + "</span></span></span>" +
          '<a class="btn sm primary" href="../planning/?id=' + encodeURIComponent(pid) + '">Open</a>' +
          '<button class="btn sm" data-copyp="' + pid + '">Copy link</button>' +
          '<button class="btn sm ghost" data-renp="' + wsId + "|" + pid + '">Rename</button>' +
          '<button class="btn sm ghost danger-t" data-delp="' + wsId + "|" + pid + '">Delete</button></li>';
      }).join("") || '<li class="muted small">' + t("No plannings yet – create one in “My boards” → Planning.") + "</li>") + "</ul>";
  }
  /* Business Game (add-on module "game"): same pattern as plannings – list, open, rename, delete */
  function gameList(wsId, w) {
    const gl = w.games || {}, ids = Object.keys(gl).sort(function (a, b) { return (gl[b].created || 0) - (gl[a].created || 0); });
    if (!ids.length) return "";
    const ic = function (n) { return window.CMIcon ? window.CMIcon(n, 15) : ""; };
    return '<h3 class="pl-adm-h">' + ic("game") + " Business Game" + ' <span class="count">' + ids.length + "</span>" + (window.CMNewBadge ? window.CMNewBadge("game") : "") + "</h3>" +
      '<ul class="members">' + ids.map(function (gid) {
        const g = gl[gid];
        return '<li class="brow"><span class="b-ic plan" aria-hidden="true">' + ic("game") + '</span><span class="m-who"><b class="no-i18n">' + esc(g.title || gid) + '</b><span class="muted">' + esc(LL("Business simulation", "Simulação empresarial")) + ' · <span class="no-i18n">' + esc(gid) + "</span></span></span>" +
          '<a class="btn sm primary" href="../game/?id=' + encodeURIComponent(gid) + '">Open</a>' +
          '<button class="btn sm ghost" data-reng="' + wsId + "|" + gid + '">Rename</button>' +
          '<button class="btn sm ghost danger-t" data-delg="' + wsId + "|" + gid + '">Delete</button></li>';
      }).join("") + "</ul>";
  }
  function renameGame(wsId, id) {
    const cur = ((ws[wsId] || {}).games || {})[id] || {};
    const v = window.prompt(LL("New name for the game", "Novo nome da partida"), cur.title || "");
    if (!v || !v.trim()) return;
    const u = {}; u["game/" + id + "/info/title"] = v.trim(); u["workspaces/" + wsId + "/games/" + id + "/title"] = v.trim();
    update(u, LL("Game renamed", "Partida renomeada"));
  }
  function deleteGameAdm(wsId, id) {
    const typed = window.prompt(LL("This permanently deletes the game, its decisions and results. Type the game id to confirm:", "Isto apaga a partida, as decisões e os resultados. Digite o id da partida para confirmar:") + " " + id);
    if (typed !== id) return;
    db.ref("game/" + id + "/people").once("value").then(function (s) {
      const u = {}; Object.keys(s.val() || {}).forEach(function (k) { u["userGames/" + k + "/" + id] = null; });
      u["game/" + id] = null; u["workspaces/" + wsId + "/games/" + id] = null;
      update(u, LL("Game deleted", "Partida excluída"));
    }, fail);
  }
  function renamePlanning(wsId, id) {
    const cur = ((ws[wsId] || {}).plannings || {})[id] || {};
    const v = window.prompt(t("New name for the planning"), cur.title || "");
    if (!v || !v.trim()) return;
    const u = {}; u["planning/" + id + "/info/title"] = v.trim(); u["workspaces/" + wsId + "/plannings/" + id + "/title"] = v.trim();
    update(u, "Planning renamed");
  }
  function deletePlanningAdm(wsId, id) {
    const typed = window.prompt(t("This permanently deletes the planning, its items, sprints and OKRs. Type the planning id to confirm:") + " " + id);
    if (typed !== id) return;
    const u = {}; u["planning/" + id] = null; u["workspaces/" + wsId + "/plannings/" + id] = null;
    update(u, "Planning deleted");
  }
  function deleteWorkspace(wsId) {
    const w = ws[wsId];
    const typed = window.prompt(t("This permanently deletes the workspace, all its boards and removes everyone's access. Type the workspace name to confirm:") + " " + w.info.name);
    if (typed !== w.info.name) return;
    const u = {};
    Object.keys(w.boards || {}).forEach(function (id) { u["boards/" + id] = null; });
    Object.keys(w.plannings || {}).forEach(function (id) { u["planning/" + id] = null; });
    Object.keys(w.games || {}).forEach(function (id) { u["game/" + id] = null; });
    Object.keys(w.members || {}).forEach(function (k) { u["userWorkspaces/" + k + "/" + wsId] = null; });
    if (OWNER) u["userWorkspaces/" + MEK + "/" + wsId] = null;
    u["workspaces/" + wsId] = null;
    update(u, "Workspace deleted");
  }

  function limit(msg) {
    document.body.insertAdjacentHTML("beforeend", '<div class="modal-lite" id="limDlg"><div class="card"><h2>' + esc(t("Plan limit reached")) + '</h2><p class="muted">' + esc(msg) + " " + esc(t("Upgrade to create more and invite your team.")) + '</p><div class="row-end"><button class="btn" id="limX">' + esc(t("Close")) + '</button><a class="btn primary" href="../pricing/">' + esc(t("See plans")) + "</a></div></div></div>");
    const d = document.getElementById("limDlg"); document.getElementById("limX").onclick = function () { d.remove(); };
  }
  /* ---------------- announcement to all users (admin) ---------------- */
  function annSection() {
    const a = announcement || {};
    return '<section class="card fb-report" id="announce"><div class="br-head"><div><span class="eyebrow sm">' + t("Communication") + "</span><h2>" + t("Announcement to users") + '</h2><p class="muted small">' + t("Shown at the top of “My workspaces” for everyone signed in, until they click “Got it”. Saving a new text shows it again to everyone.") + "</p></div></div>" +
      '<form id="annForm" class="ann-form"><input name="title" maxlength="120" placeholder="' + esc(t("Title")) + '" value="' + esc(a.title || "") + '"><textarea name="text" rows="4" maxlength="1500" placeholder="' + esc(t("Message")) + '">' + esc(a.text || "") + '</textarea><label class="consent"><input type="checkbox" name="on"' + (a.on ? " checked" : "") + "><span>" + t("Show to users") + '</span></label><div class="row-end"><button class="btn primary">' + t("Save announcement") + "</button></div></form></section>";
  }

  /* ---------------- plans & licences (admin) ---------------- */
  function plansSection() {
    const P = window.CM_PLANS || {}, keys = Object.keys(plans).sort();
    const opts = function (v) { return Object.keys(P).map(function (id) { return '<option value="' + id + '"' + (id === v ? " selected" : "") + ">" + esc(P[id].name) + "</option>"; }).join(""); };
    let h = '<section class="card fb-report" id="plans"><div class="br-head"><div><span class="eyebrow sm">' + t("Licences") + "</span><h2>" + t("Plans & licences") + '</h2><p class="muted small">' + t("Give a customer a plan and number of seats (people they can invite). Payments will update this automatically later.") + "</p></div></div>";
    h += '<form class="form-grid3" id="planForm"><input name="email" type="email" required placeholder="cliente@email.com"><select name="plan">' + opts("pro") + '</select><input name="seats" type="number" min="1" max="999" value="5" aria-label="' + esc(t("Seats")) + '"><select name="months" aria-label="' + esc(t("Period")) + '"><option value="1">1 ' + t("month") + '</option><option value="12" selected>12 ' + t("months") + '</option><option value="0">' + t("No end date") + '</option></select><button class="btn primary">' + t("Save plan") + "</button></form>";
    if (keys.length) {
      h += '<div class="su-table-wrap"><table class="su-table"><thead><tr><th>E-mail</th><th>' + t("Plan") + "</th><th>" + t("Seats") + "</th><th>" + t("Until") + "</th><th></th></tr></thead><tbody>" + keys.map(function (k) {
        const x = plans[k] || {};
        return '<tr><td class="no-i18n">' + esc(x.email || k.replace(/,/g, ".")) + "</td><td><b>" + esc((P[x.plan] || {}).name || x.plan) + "</b></td><td>" + esc(x.seats || "") + '</td><td class="no-i18n">' + (x.until ? fmtDate(x.until) : "–") + '</td><td class="su-act"><div><button class="link" data-delplan="' + esc(k) + '">' + t("remove") + "</button></div></td></tr>";
      }).join("") + "</tbody></table></div>";
    } else h += '<p class="muted small">' + t("No paid plans yet – everyone starts on Free.") + "</p>";
    return h + "</section>";
  }
  function savePlan(f) {
    const email = f.email.value.trim().toLowerCase(); if (!validEmail(email)) return toast("Enter a valid e-mail");
    const months = Number(f.months.value) || 0;
    const rec = { email: email, plan: f.plan.value, seats: Math.max(1, Number(f.seats.value) || 1), until: months ? Date.now() + months * 30 * DAY : null, by: me.email, at: TS(), source: "admin" };
    const u = {}; u["plans/" + A.key(email)] = rec;
    update(u, "Plan saved");
  }

  /* ---------------- invitation ---------------- */
  function inviteText(wsId, m) {
    const w = ws[wsId], link = abs("../workspaces/"), fb = abs("../feedback/");
    if (PT) {
      return "Olá " + (m.name || "") + ",\n\nVocê foi convidado(a) para o workspace \"" + w.info.name + "\" no CM Collaborator.\n\n" +
        "1. Abra: " + link + "\n2. Entre com este e-mail: " + m.email + " (botão Google ou link de acesso por e-mail).\n3. Seus quadros aparecem em \"Meus quadros\"." +
        (m.expires ? "\n\nSeu acesso de teste é válido até " + fmtDate(m.expires) + ". Explore à vontade e, no fim, deixe sua opinião (5 perguntas, 3 minutos): " + fb : "") +
        "\n\nObrigado!";
    }
    return "Hi " + (m.name || "") + ",\n\nYou've been invited to the workspace \"" + w.info.name + "\" on CM Collaborator.\n\n" +
      "1. Open: " + link + "\n2. Sign in with this e-mail: " + m.email + " (Google button or e-mail sign-in link).\n3. Your boards appear under \"My boards\"." +
      (m.expires ? "\n\nYour test access is valid until " + fmtDate(m.expires) + ". Explore freely and, at the end, share your opinion (5 questions, 3 minutes): " + fb : "") +
      "\n\nThank you!";
  }
  /* Sends the invitation e-mail straight away: a passwordless sign-in link from Firebase Auth. */
  function sendInviteEmail(email) {
    try {
      const auth = window.firebase.auth();
      auth.languageCode = PT ? "pt" : "en";
      return auth.sendSignInLinkToEmail(email, { url: abs("../workspaces/?invite=1"), handleCodeInApp: true })
        .then(function () { return true; }, function (e) { console.warn(e); return false; });
    } catch (e) { return Promise.resolve(false); }
  }
  /* Automatic welcome e-mail sent by the platform notifier (Apps Script under the platform's own account). */
  function mailWelcome(wsId, emails) {
    const url = window.CMCOLLAB_MAILER;
    if (!url || !wsId || !emails.length) return Promise.resolve(null);
    return window.firebase.auth().currentUser.getIdToken().then(function (tok) {
      return fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ idToken: tok, ws: wsId, to: emails, lang: PT ? "pt" : "en", brand: window.CMCOLLAB_BRAND || "" }) });
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) throw new Error(j.error || "notifier error");
      const st = {}; (j.sent || []).forEach(function (em) { st["workspaces/" + wsId + "/members/" + A.key(em) + "/welcomed"] = TS(); });
      if (Object.keys(st).length) db.ref().update(st).catch(function () { /* ignore */ });
      return j;
    }).catch(function (e) { console.warn("welcome mail", e); return { ok: false, error: String(e.message || e) }; });
  }
  function sendWelcome(wsId, emails) {
    if (!window.CMCOLLAB_MAILER) return toast(t("The e-mail notifier is not configured yet."));
    mailWelcome(wsId, emails).then(function (j) {
      if (j && j.ok) { toast(t("Welcome e-mail sent to") + " " + j.sent.length + " " + t("people")); load(); }
      else toast(t("Could not send the welcome e-mail") + (j && j.error ? " – " + j.error : ""));
    });
  }
  /* Commercial prospecting e-mail ("convite de teste para lideranças"), sent by the platform notifier
     from the platform account. Only to people who already are members of the workspace. */
  function sendProspect(wsId, emails) {
    const url = window.CMCOLLAB_MAILER;
    if (!url) return toast(t("The e-mail notifier is not configured yet."));
    if (!wsId || !emails.length) return;
    return window.firebase.auth().currentUser.getIdToken().then(function (tok) {
      return fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ idToken: tok, kind: "prospect", ws: wsId, to: emails, lang: "pt", brand: window.CMCOLLAB_BRAND || "" }) });
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) throw new Error(j.error || "notifier error");
      const st = {}; (j.sent || []).forEach(function (em) { st["workspaces/" + wsId + "/members/" + A.key(em) + "/prospected"] = TS(); });
      return (Object.keys(st).length ? db.ref().update(st) : Promise.resolve()).then(function () {
        toast(j.sent.length ? t("Prospecting e-mail sent to") + " " + j.sent.join(", ") : t("Not sent – the person is not an active member of this workspace"));
        load();
        return j;
      });
    }).catch(function (e) { console.warn("prospect mail", e); toast(t("Could not send the prospecting e-mail") + " – " + String(e.message || e)); });
  }
  function inviteAndTell(emails, wsId) {
    let ok = 0;
    mailWelcome(wsId, emails);
    return emails.reduce(function (p, em) { return p.then(function () { return sendInviteEmail(em).then(function (r) { if (r) ok++; }); }); }, Promise.resolve())
      .then(function () {
        if (ok === emails.length) toast(emails.length === 1 ? t("Invitation e-mailed to") + " " + emails[0] : ok + " " + t("invitations e-mailed"));
        else toast(t("Access granted, but some e-mails could not be sent – use “Resend invite”."));
        return ok;
      });
  }
  function openInvite(wsId, k) {
    const m = ((ws[wsId] || {}).members || {})[k]; if (!m) return;
    const txt = inviteText(wsId, m);
    const subject = PT ? "Convite: CM Collaborator – " + ws[wsId].info.name : "Invitation: CM Collaborator – " + ws[wsId].info.name;
    const dlg = document.getElementById("inviteDlg");
    dlg.querySelector("h2").textContent = t("Invitation sent to") + " " + (m.name || m.email);
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
  function suDays(wsId) { return signupDays !== null ? signupDays : (Number((ws[wsId].info || {}).accessDays) || 0); }
  function grantUpdates(wsId, x, u) {
    const days = suDays(wsId), k = A.key(x.email);
    const expires = days ? Date.now() + days * DAY : null;
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
    update(u).then(function () { inviteAndTell([x.email], wsId); });
  }
  function grantAllPending() {
    const wsId = betaWsDefault(); if (!wsId) return toast("Create a workspace first");
    const pend = suList().filter(function (x) { return x.status !== "invited"; });
    if (!pend.length) return toast("No pending requests");
    const dd = suDays(wsId);
    if (!window.confirm(t("Give access to all pending requests?") + " (" + pend.length + ") – " + (dd ? t("Temporary") + " · " + dd + " " + t("days") : t("Full access")))) return;
    const u = {};
    pend.forEach(function (x) { grantUpdates(wsId, x, u); });
    update(u).then(function () { inviteAndTell(pend.map(function (x) { return x.email; }), wsId); });
  }
  function openBulkInvite(wsId, emails) {
    const w = ws[wsId], days = suDays(wsId), until = days ? fmtDate(Date.now() + days * DAY) : "";
    const link = abs("../workspaces/"), fb = abs("../feedback/");
    const txt = PT
      ? "Olá,\n\nObrigado por se inscrever no beta do CM Collaborator! Seu acesso de teste já está ativo.\n\n1. Abra: " + link + "\n2. Entre com o e-mail com que se inscreveu (botão Google ou link de acesso por e-mail).\n3. O workspace \"" + w.info.name + "\" aparece em \"Meus quadros\"." + (until ? "\n\nO acesso é válido até " + until + "." : "") + "\n\nQuando puder, deixe sua opinião (5 perguntas, 3 minutos): " + fb + "\n\nObrigado!"
      : "Hi,\n\nThank you for joining the CM Collaborator beta! Your test access is now active.\n\n1. Open: " + link + "\n2. Sign in with the e-mail you signed up with (Google button or e-mail sign-in link).\n3. The workspace \"" + w.info.name + "\" appears under \"My boards\"." + (until ? "\n\nAccess is valid until " + until + "." : "") + "\n\nWhen you can, share your opinion (5 questions, 3 minutes): " + fb + "\n\nThank you!";
    const subject = PT ? "Seu acesso ao beta do CM Collaborator" : "Your CM Collaborator beta access";
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
    let h = '<section class="card fb-report su-report" id="signups"><div class="br-head"><div><span class="eyebrow sm">Beta</span><h2>' + t("Beta sign-ups") + '</h2><p class="muted small">' + t("Requests from the beta launch page. Choose the workspace and the access type (temporary or full), then give access in one click.") + "</p></div>" +
      '<div class="br-actions"><button class="btn sm" data-copy-beta>' + t("Copy beta page link") + "</button>" + (list.length ? '<button class="btn sm" id="suCsv">' + t("Export CSV") + "</button>" : "") + (pend ? '<button class="btn sm primary" id="suAll">' + t("Invite all pending") + " (" + pend + ")</button>" : "") + "</div></div>";
    h += '<div class="copy-row"><input readonly value="' + esc(abs("../beta/")) + '" class="no-i18n"></div>';
    h += '<div class="fb-kpis"><div><b>' + list.length + "</b><span>" + t("Sign-ups") + "</span></div><div><b>" + pend + "</b><span>" + t("Pending") + "</span></div><div><b>" + (list.length - pend) + "</b><span>" + t("Invited") + "</span></div></div>";
    if (Object.keys(ws).length) {
      h += '<label class="su-target">' + t("Give access to workspace") + ' <select id="suWs">' + Object.keys(ws).map(function (id) {
        return '<option value="' + esc(id) + '"' + (id === wsId ? " selected" : "") + ' class="no-i18n">' + esc(ws[id].info.name) + (ws[id].info.accessDays ? " · " + ws[id].info.accessDays + "d" : "") + "</option>";
      }).join("") + "</select></label>" + '<label class="su-target">' + t("Access type") + " " + daysSelect("suDays", wsId ? suDays(wsId) : 7).replace("<select ", '<select id="suDays" ') + "</label>";
    }
    if (!list.length) return h + '<div class="empty-big"><p class="muted">' + t("No sign-ups yet. Share the beta page link.") + "</p></div></section>";
    h += '<div class="su-table-wrap"><table class="su-table"><thead><tr><th>' + t("Name") + "</th><th>E-mail</th><th>" + t("Role") + "</th><th>" + t("Date") + "</th><th>" + t("Source") + "</th><th>" + t("Status") + "</th><th></th></tr></thead><tbody>" +
      list.map(function (x) {
        const inv = x.status === "invited";
        return "<tr><td class=\"no-i18n\"><b>" + esc(x.name) + '</b></td><td class="no-i18n">' + esc(x.email) + "</td><td>" + esc(label(SROLES, x.role)) + '</td><td class="no-i18n">' + (x.t ? fmtDate(x.t) : "") + '</td><td class="no-i18n muted">' + esc(x.src || "") + "</td>" +
          "<td>" + (inv ? '<span class="xp">' + t("Invited") + "</span>" : '<span class="xp soon">' + t("Pending") + "</span>") + "</td>" +
          '<td class="su-act"><div>' + (inv ? "" : '<button class="btn sm primary" data-grant="' + esc(x.k) + '">' + t("Give access") + "</button>") + '<button class="link" data-delsu="' + esc(x.k) + '">' + t("delete") + "</button></div></td></tr>";
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
  function wsCard(id) {
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
          '<button class="btn sm" data-invite="' + id + "|" + k + '">Resend invite</button><button class="btn sm" data-welcome="' + id + "|" + k + '" title="' + esc(m.welcomed ? t("Welcome e-mail sent on") + " " + fmtDate(m.welcomed) : t("Welcome e-mail not sent yet")) + '">' + (m.welcomed ? "✓ " : "✉ ") + t("Welcome") + '</button><button class="btn sm" data-prospect="' + id + "|" + k + '" title="' + esc(m.prospected ? t("Prospecting e-mail sent on") + " " + fmtDate(m.prospected) : t("Prospecting e-mail not sent yet")) + '">' + (m.prospected ? "✓ " : "✉ ") + t("Prospecting") + '</button><button class="btn sm ghost danger-t" data-remove="' + id + "|" + k + '">Remove</button>' +
          (m.prospected ? '<span class="xp prospected">' + esc(t("Prospecting sent")) + " · " + fmtDate(m.prospected) + "</span>" : "") +
          '<span class="m-exp">' + expiryBadge(m) + '<button class="link" data-ext="' + id + "|" + k + '|7">' + t("+7 days") + "</button>" + (m.expires ? '<button class="link" data-ext="' + id + "|" + k + '|0">' + t("Make full access") + "</button>" : "") + "</span></li>";
      }).join("");
      return '<section class="card ws-card" id="ws-' + id + '"><div class="br-head"><div><span class="eyebrow sm">Workspace</span><h2 class="no-i18n">' + esc(w.info.name) + "</h2>" + (w.info.accessDays ? '<span class="xp">' + esc(t("Default access")) + ": " + w.info.accessDays + " " + esc(t("days")) + "</span>" : "") + (w.info.prospect ? ' <span class="xp">' + esc(t("Prospecting workspace")) + "</span>" : "") + "</div>" +
        areaSelect("", w.info.area || "", 'data-wsarea="' + id + '"') +
        '<button class="btn sm ghost danger-t" data-delws="' + id + '">Delete workspace</button></div>' +
        '<div class="ws-cols"><div><h3>Boards <span class="count">' + bIds.length + "</span></h3>" +
        '<ul class="members">' + (bl || '<li class="muted small">No boards yet.</li>') + "</ul>" +
        '<form class="form-grid3" data-newboard="' + id + '"><input name="title" required placeholder="' + esc(t("Board name, e.g. Project kickoff")) + '" autocomplete="off">' +
        '<select name="template" aria-label="Template">' + templateOptions() + '</select>' +
        '<input name="bid" placeholder="' + esc(t("Link id (optional)")) + '" autocomplete="off" pattern="[a-z0-9-]{2,60}">' +
        '<button class="btn primary">New board</button></form>' + planList(id, w) + gameList(id, w) + "</div>" +
        '<div><h3>People with access <span class="count">' + mIds.length + "</span>" + (mIds.length ? ' <button class="btn sm" data-welcomeall="' + id + '">✉ ' + t("Send welcome to all") + "</button>" : "") + "</h3>" +
        '<ul class="members">' + (ml || '<li class="muted small">No one has access yet.</li>') + "</ul>" +
        '<form class="form-grid3" data-add="' + id + '"><input name="name" placeholder="' + esc(t("Name")) + '" autocomplete="off"><input name="email" type="email" required placeholder="name@email.com" autocomplete="off">' +
        roleSelect("role", "editor") + daysSelect("days", w.info.accessDays || (w.info.prospect ? 14 : 0)) +
        '<label class="mail-type">' + esc(t("E-mail type")) + ' <select name="mailType" aria-label="' + esc(t("E-mail type")) + '"><option value="welcome"' + (w.info.prospect ? "" : " selected") + ">" + esc(t("Welcome (beta)")) + '</option><option value="prospect"' + (w.info.prospect ? " selected" : "") + ">" + esc(t("Sales prospecting")) + "</option></select></label>" +
        '<button class="btn primary">Grant access</button></form><p class="muted small">' + esc(t("Prospecting: access is created first, then the e-mail is sent from the platform account. Tip: one workspace per company, with a test period (14 days).")) + "</p></div></div></section>";
  }

  /* ---------- add-on modules (ITSM, Business Game): licences per company/workspace or per person ---------- */
  function MODS() { return (window.CMModules && window.CMModules.LIST) || []; }
  function PKGS() { return (window.CMModules && window.CMModules.PACKAGES) || []; }
  function gActive(g) { return !!(g && g.on && (!g.until || g.until > Date.now())); }
  function wsMods(id) { return (ent.ws || {})[id] || {}; }
  function userMods(k) { return (ent.users || {})[k] || {}; }
  function effMods(u) { // what a person can use, and why
    const out = {};
    MODS().forEach(function (m) {
      const via = [];
      if (gActive(userMods(u.k)[m.id])) via.push(LL("individual", "individual"));
      u.acc.forEach(function (a) { if (a.st !== "off" && gActive(wsMods(a.id)[m.id])) via.push(a.ws); });
      if (via.length) out[m.id] = via;
    });
    return out;
  }
  function pkgOf(id) { const on = MODS().filter(function (m) { return gActive(wsMods(id)[m.id]); }).map(function (m) { return m.id; }).sort().join(","); const p = PKGS().find(function (x) { return x.mods.slice().sort().join(",") === on; }); return p ? p.id : "custom"; }
  function grantTxt(g) { if (!g || !g.on) return LL("Off", "Desligado"); if (!gActive(g)) return LL("Expired ", "Expirou em ") + fmtShort(g.until); return (g.plan === "beta" ? "Beta" : g.plan === "trial" ? LL("Trial", "Teste") : LL("Paid", "Contratado")) + (g.until ? LL(" · until ", " · até ") + fmtShort(g.until) : LL(" · no limit", " · sem prazo")); }
  function periodSel(attr) { return '<select ' + attr + ' aria-label="' + esc(LL("Period", "Período")) + '"><option value="30|beta">Beta · 30 ' + LL("days", "dias") + '</option><option value="14|trial">' + LL("Trial · 14 days", "Teste · 14 dias") + '</option><option value="90|beta">Beta · 90 ' + LL("days", "dias") + '</option><option value="365|paid">' + LL("Paid · 12 months", "Contratado · 12 meses") + '</option><option value="0|paid">' + LL("Paid · no limit", "Contratado · sem prazo") + "</option></select>"; }
  function grantObj(per) { const p = String(per || "30|beta").split("|"), d = Number(p[0]) || 0; return { on: true, until: d ? Date.now() + d * DAY : null, plan: p[1] || "beta", by: me.email, at: TS() }; }
  function modChip(id, g) { const m = MODS().find(function (x) { return x.id === id; }) || { name: id }; return '<span class="lic ' + (gActive(g) ? "ok" : g && g.on ? "off" : "none") + '" title="' + esc(grantTxt(g)) + '">' + esc(m.name) + "</span>"; }
  function modulesPane(ids) {
    const reqs = Object.keys(modReq || {}).map(function (k) { return Object.assign({ k: k }, modReq[k]); }).sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
    let h = '<section class="card adm-sec"><div class="sec-head"><div><h2>' + LL("Modules & packages", "Módulos e pacotes") + '</h2><p class="muted small">' + LL("Boards and Planning are always included. ITSM and Business Game are add-on licences: grant them to a whole company (workspace package) or to one person. Use Beta to let a company try them.", "Quadros e Planning estão sempre incluídos. ITSM e Business Game são licenças adicionais: conceda para uma empresa inteira (pacote do workspace) ou para uma pessoa. Use Beta para deixar uma empresa experimentar.") + "</p></div></div>";
    h += '<div class="pk-legend">' + PKGS().map(function (p) { return '<span><b>' + esc(p.name) + "</b> " + esc(p.desc) + "</span>"; }).join("") + "</div>";
    if (reqs.length) h += "<h3>" + LL("Access requests", "Pedidos de acesso") + ' <span class="count warn">' + reqs.length + '</span></h3><div class="tbl-wrap"><table class="adm-tbl"><thead><tr><th>' + LL("Person", "Pessoa") + "</th><th>" + LL("Module", "Módulo") + "</th><th>Workspace</th><th>" + LL("Date", "Data") + "</th><th></th></tr></thead><tbody>" + reqs.map(function (r) {
      const wn = r.ws && ws[r.ws] ? ws[r.ws].info.name : "—";
      return '<tr><td class="no-i18n"><b>' + esc(r.name || r.email) + '</b> <span class="muted">' + esc(r.email) + "</span></td><td>" + modChip(r.mod, null) + '</td><td class="no-i18n">' + esc(wn) + '</td><td class="tnum">' + (r.t ? fmtShort(r.t) : "") + '</td><td class="acts">' + periodSel('data-rqper="' + r.k + '"') + '<button class="btn sm" data-rqu="' + r.k + '">' + LL("Grant to person", "Conceder à pessoa") + "</button>" + (r.ws && ws[r.ws] ? '<button class="btn sm" data-rqw="' + r.k + '">' + LL("Grant to workspace", "Conceder ao workspace") + "</button>" : "") + '<button class="link" data-rqx="' + r.k + '">' + LL("dismiss", "descartar") + "</button></td></tr>";
    }).join("") + "</tbody></table></div>";
    h += "<h3>" + LL("Companies / workspaces", "Empresas / workspaces") + '</h3><div class="tbl-wrap"><table class="adm-tbl"><thead><tr><th>Workspace</th><th>' + LL("Package", "Pacote") + "</th>" + MODS().map(function (m) { return "<th>" + esc(m.name) + "</th>"; }).join("") + "<th>" + LL("Period for new grants", "Período ao conceder") + "</th></tr></thead><tbody>" +
      ids.map(function (id) {
        const pk = pkgOf(id);
        return '<tr><td class="no-i18n"><b>' + esc(ws[id].info.name) + '</b><span class="muted small"> · ' + plural(Object.keys(ws[id].members || {}).length, LL("person", "pessoa"), LL("people", "pessoas")) + '</span></td><td><select data-pkg="' + id + '">' + PKGS().map(function (p) { return '<option value="' + p.id + '"' + (p.id === pk ? " selected" : "") + ">" + esc(p.name) + "</option>"; }).join("") + (pk === "custom" ? '<option value="custom" selected>' + LL("Custom", "Personalizado") + "</option>" : "") + "</select></td>" +
          MODS().map(function (m) { const g = wsMods(id)[m.id]; return '<td><label class="mtog"><input type="checkbox" data-wmod="' + id + "|" + m.id + '"' + (gActive(g) ? " checked" : "") + "> <span>" + esc(grantTxt(g)) + "</span></label></td>"; }).join("") +
          "<td>" + periodSel('data-wper="' + id + '"') + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    const uk = Object.keys(ent.users || {}).filter(function (k) { return Object.keys(ent.users[k] || {}).length; });
    h += "<h3>" + LL("Individual licences", "Licenças individuais") + ' <span class="count">' + uk.length + "</span></h3>" +
      (uk.length ? '<div class="tbl-wrap"><table class="adm-tbl"><thead><tr><th>' + LL("Person", "Pessoa") + "</th>" + MODS().map(function (m) { return "<th>" + esc(m.name) + "</th>"; }).join("") + "</tr></thead><tbody>" + uk.map(function (k) {
        return '<tr><td class="no-i18n"><b>' + esc(k.replace(/,/g, ".")) + "</b></td>" + MODS().map(function (m) { const g = userMods(k)[m.id]; return '<td><label class="mtog"><input type="checkbox" data-umod="' + esc(k) + "|" + m.id + '"' + (gActive(g) ? " checked" : "") + "> <span>" + esc(grantTxt(g)) + "</span></label></td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table></div>" : '<p class="muted small">' + LL("None yet – grant from here or from a person's panel in Users & licences.", "Nenhuma ainda – conceda aqui ou no painel da pessoa em Usuários e licenças.") + "</p>") +
      '<form id="umForm" class="fbar f2 um-form"><input name="email" type="email" required placeholder="' + esc(LL("Person's e-mail", "E-mail da pessoa")) + '"><select name="mod">' + MODS().map(function (m) { return '<option value="' + m.id + '">' + esc(m.name) + "</option>"; }).join("") + "</select>" + periodSel('name="per"') + '<button class="btn sm primary">' + LL("Grant module", "Conceder módulo") + "</button></form>";
    return h + "</section>";
  }
  function bindModules() {
    const ref = function (path, val, msg) { const u = {}; u[path] = val; update(u, msg); };
    el.querySelectorAll("[data-pkg]").forEach(function (sel) { sel.onchange = function () {
      const id = sel.dataset.pkg, p = PKGS().find(function (x) { return x.id === sel.value; }); if (!p) return;
      const per = (el.querySelector('[data-wper="' + id + '"]') || {}).value, u = {};
      MODS().forEach(function (m) { const cur = wsMods(id)[m.id], want = p.mods.indexOf(m.id) >= 0; if (want && !gActive(cur)) u["entitlements/ws/" + id + "/" + m.id] = Object.assign(grantObj(per), { pkg: p.id }); else if (!want && cur) u["entitlements/ws/" + id + "/" + m.id] = null; else if (want && cur) u["entitlements/ws/" + id + "/" + m.id + "/pkg"] = p.id; });
      if (Object.keys(u).some(function (k) { return u[k] === null; }) && !window.confirm(LL("Remove modules from this company? People lose access to them.", "Remover módulos desta empresa? As pessoas perdem o acesso a eles."))) { sel.value = pkgOf(id); return; }
      update(u, LL("Package updated", "Pacote atualizado"));
    }; });
    el.querySelectorAll("[data-wmod]").forEach(function (c) { c.onchange = function () {
      const q = c.dataset.wmod.split("|"), per = (el.querySelector('[data-wper="' + q[0] + '"]') || {}).value;
      if (!c.checked && !window.confirm(LL("Turn this module off for the whole company?", "Desligar este módulo para a empresa inteira?"))) { c.checked = true; return; }
      ref("entitlements/ws/" + q[0] + "/" + q[1], c.checked ? grantObj(per) : null, c.checked ? LL("Module granted", "Módulo concedido") : LL("Module turned off", "Módulo desligado"));
    }; });
    el.querySelectorAll("[data-umod]").forEach(function (c) { c.onchange = function () {
      const q = c.dataset.umod.split("|"); ref("entitlements/users/" + q[0] + "/" + q[1], c.checked ? grantObj("30|beta") : null, c.checked ? LL("Module granted", "Módulo concedido") : LL("Module turned off", "Módulo desligado"));
    }; });
    el.querySelectorAll("[data-umod2]").forEach(function (c) { c.onchange = function () {
      const q = c.dataset.umod2.split("|"), per = (el.querySelector('[data-uper="' + q[0] + '"]') || {}).value;
      ref("entitlements/users/" + q[0] + "/" + q[1], c.checked ? grantObj(per) : null, c.checked ? LL("Module granted", "Módulo concedido") : LL("Module turned off", "Módulo desligado"));
    }; });
    const uf = document.getElementById("umForm"); if (uf) uf.onsubmit = function (e) {
      e.preventDefault(); const em = uf.email.value.trim().toLowerCase(); if (!validEmail(em)) return toast(LL("Enter a valid e-mail", "Informe um e-mail válido"));
      ref("entitlements/users/" + A.key(em) + "/" + uf.mod.value, grantObj(uf.per.value), LL("Module granted", "Módulo concedido"));
    };
    el.querySelectorAll("[data-rqu],[data-rqw]").forEach(function (b) { b.onclick = function () {
      const k = b.dataset.rqu || b.dataset.rqw, r = modReq[k]; if (!r) return;
      const per = (el.querySelector('[data-rqper="' + k + '"]') || {}).value, u = {};
      if (b.dataset.rqu) u["entitlements/users/" + A.key(r.email) + "/" + r.mod] = grantObj(per); else u["entitlements/ws/" + r.ws + "/" + r.mod] = grantObj(per);
      u["moduleRequests/" + k] = null; update(u, LL("Module granted", "Módulo concedido"));
    }; });
    el.querySelectorAll("[data-rqx]").forEach(function (b) { b.onclick = function () { const u = {}; u["moduleRequests/" + b.dataset.rqx] = null; update(u); }; });
  }

  /* ---------- administration shell (Jira-like side menu) ---------- */
  const LL = function (en, pt) { return window.MBL ? window.MBL(en, pt) : (window.MB_LANG === "pt" ? pt : en); };
  const SEL = {}; let drawerK = null;
  const UF = (function () { try { return JSON.parse(localStorage.getItem("cmcollab:admuf") || "{}"); } catch (e) { return {}; } })();
  function saveUF() { try { localStorage.setItem("cmcollab:admuf", JSON.stringify(UF)); } catch (e) { /* ignore */ } }
  function accSt(m) { if (!m.expires) return "none"; const d = daysLeft(m.expires); return d <= 0 ? "off" : d <= 7 ? "soon" : "ok"; }
  function fmtShort(ts) { return new Date(ts).toLocaleDateString(window.MB_LOCALE || (PT ? "pt-BR" : "en-GB"), { day: "2-digit", month: "2-digit", year: "numeric" }); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function buildUsers() {
    const map = {};
    Object.keys(ws).forEach(function (id) {
      const w = ws[id], mm = w.members || {};
      Object.keys(mm).forEach(function (k) {
        const m = mm[k]; if (!m) return;
        const u = map[k] || (map[k] = { k: k, name: "", email: m.email || k.replace(/,/g, "."), acc: [] });
        if (m.name && !u.name) u.name = m.name;
        u.acc.push({ id: id, k: k, ws: (w.info || {}).name || id, m: m, st: accSt(m), boards: Object.keys(w.boards || {}).length, plans: Object.keys(w.plannings || {}).length, games: Object.keys(w.games || {}).length });
      });
    });
    Object.keys(map).forEach(function (k) {
      const u = map[k], act = u.acc.filter(function (a) { return a.st !== "off"; });
      const lim = act.filter(function (a) { return a.st !== "none"; }).map(function (a) { return a.m.expires; });
      u.next = lim.length ? Math.min.apply(null, lim) : null;
      u.st = act.some(function (a) { return a.st === "soon"; }) ? "soon" : !act.length ? "off" : act.some(function (a) { return a.st === "ok"; }) ? "ok" : "none";
      if (u.st === "off") u.next = Math.max.apply(null, u.acc.map(function (a) { return a.m.expires || 0; }));
      u.off = u.acc.length - act.length;
      u.boards = u.acc.reduce(function (s, a) { return s + a.boards; }, 0);
      u.plans = u.acc.reduce(function (s, a) { return s + a.plans; }, 0);
      u.games = u.acc.reduce(function (s, a) { return s + (a.games || 0); }, 0);
      u.noRenew = u.acc.some(function (a) { return a.m.noRenew; });
      const roles = {}; u.acc.forEach(function (a) { roles[a.m.role === "viewer" ? "viewer" : "editor"] = 1; });
      u.role = Object.keys(roles).length > 1 ? "mixed" : Object.keys(roles)[0];
    });
    return map;
  }
  function stLabel(u) {
    if (u.st === "none") return '<span class="lic none">' + LL("No time limit", "Sem prazo") + "</span>";
    if (u.st === "off") return '<span class="lic off">' + LL("Expired", "Expirado") + "</span>";
    const d = daysLeft(u.next);
    return '<span class="lic ' + u.st + '">' + (u.st === "soon" ? LL("Expires in ", "Vence em ") + plural(d, LL("day", "dia"), LL("days", "dias")) : LL("Active", "Ativo")) + "</span>";
  }
  function roleLabel(r) { return r === "mixed" ? LL("Mixed", "Misto") : r === "viewer" ? LL("Viewer", "Leitor") : LL("Editor", "Editor"); }
  function accSel(u) { // accesses the bulk/row actions apply to (respects the workspace filter)
    return u.acc.filter(function (a) { return !UF.ws || a.id === UF.ws; });
  }
  function expUpdates(list, mode, val) {
    const u = {}, now = Date.now();
    list.forEach(function (a) {
      const base = "workspaces/" + a.id + "/members/" + a.k;
      if (mode === "norenew") { u[base + "/noRenew"] = val ? true : null; return; }
      if (mode === "add" && !a.m.expires) return; // "no time limit" stays unlimited when extending
      let e = null;
      if (mode === "add") e = Math.max(now, a.m.expires) + val * DAY;
      else if (mode === "date") e = val;
      else if (mode === "end") e = now - 1000;
      u[base + "/expires"] = e;
      if (mode !== "end") u[base + "/noRenew"] = null;
      u["userWorkspaces/" + a.k + "/" + a.id] = { name: ws[a.id].info.name, expires: e };
    });
    return u;
  }
  const MSG = { add: ["Access extended", "Acesso prorrogado"], date: ["Expiry date updated", "Validade atualizada"], full: ["Full access granted", "Acesso sem prazo concedido"], end: ["Access ended", "Acesso encerrado"], norenew: ["Renewal preference saved", "Preferência de renovação salva"] };
  function applyExp(list, mode, val) {
    if (!list.length) return false;
    if (mode === "end" && !window.confirm(LL("End access now for ", "Encerrar agora o acesso de ") + plural(list.length, LL("access", "acesso"), LL("accesses", "acessos")) + "?\n\n" + list.map(function (a) { return a.m.email + " · " + a.ws; }).join("\n"))) return false;
    update(expUpdates(list, mode, val), LL(MSG[mode][0], MSG[mode][1]));
    return true;
  }
  function usersFiltered(map) {
    const q = (UF.q || "").toLowerCase();
    return Object.keys(map).map(function (k) { return map[k]; }).filter(function (u) {
      if (UF.ws && !u.acc.some(function (a) { return a.id === UF.ws; })) return false;
      if (UF.st && UF.st !== "all") { if (UF.st === "norenew" ? !u.noRenew : u.st !== UF.st) return false; }
      if (q && (u.name + " " + u.email + " " + u.acc.map(function (a) { return a.ws; }).join(" ")).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) {
      if (UF.sort === "exp") { const x = a.st === "none" ? 9e15 : a.next || 0, y = b.st === "none" ? 9e15 : b.next || 0; if (x !== y) return x - y; }
      return (a.name || a.email).localeCompare(b.name || b.email);
    });
  }
  function overviewPane(ids, map) {
    const users = Object.keys(map).map(function (k) { return map[k]; });
    const nB = ids.reduce(function (a, id) { return a + Object.keys(ws[id].boards || {}).length; }, 0);
    const nP = ids.reduce(function (a, id) { return a + Object.keys(ws[id].plannings || {}).length; }, 0);
    const cnt = function (st) { return users.filter(function (u) { return u.st === st; }).length; };
    const att = [];
    users.forEach(function (u) { u.acc.forEach(function (a) { if (a.st === "soon" || (a.st === "off" && daysLeft(a.m.expires) > -30)) att.push({ u: u, a: a }); }); });
    att.sort(function (x, y) { return x.a.m.expires - y.a.m.expires; });
    const tile = function (n, l, go, cls) { return '<button class="ov-tile' + (cls ? " " + cls : "") + '"' + (go ? ' data-go="' + go + '"' : "") + "><b>" + n + "</b><span>" + l + "</span></button>"; };
    let h = '<section class="card adm-sec"><div class="sec-head"><div><h2>' + LL("Overview", "Visão geral") + '</h2><p class="muted small">' + LL("Everything that needs a decision first: accesses about to expire and recently expired.", "Primeiro, o que pede decisão: acessos vencendo e expirados recentemente.") + "</p></div></div>" +
      '<div class="ov-grid">' + tile(users.length, LL("People", "Pessoas"), "users:all") + tile(cnt("ok") + cnt("none"), LL("Active", "Ativos"), "users:ok") + tile(cnt("soon"), LL("Expiring ≤ 7 days", "Vencendo em até 7 dias"), "users:soon", cnt("soon") ? "warn" : "") + tile(cnt("off"), LL("Expired", "Expirados"), "users:off", cnt("off") ? "bad" : "") +
      tile(ids.length, "Workspaces", "ws") + tile(nB, LL("Boards", "Quadros"), "ws") + tile(nP, LL("Plannings & dashboards", "Planejamentos e painéis"), "ws") +
      (!OWNER ? tile(Object.keys(signups).filter(function (k) { return (signups[k] || {}).status !== "invited"; }).length, LL("Pending sign-ups", "Inscrições pendentes"), "signups") : "") + "</div>";
    h += "<h3>" + LL("Needs attention", "Requer atenção") + ' <span class="count">' + att.length + "</span></h3>";
    h += att.length ? '<div class="tbl-wrap"><table class="adm-tbl"><thead><tr><th>' + LL("Person", "Pessoa") + "</th><th>Workspace</th><th>" + LL("Valid until", "Validade") + "</th><th>" + LL("Status", "Situação") + "</th><th>" + LL("Decision", "Decisão") + "</th></tr></thead><tbody>" + att.map(function (x) {
      const a = x.a, ref = a.id + "|" + a.k;
      return '<tr><td><button class="lnk-u" data-user="' + esc(x.u.k) + '"><b class="no-i18n">' + esc(x.u.name || x.u.email) + '</b><span class="muted no-i18n">' + esc(x.u.email) + '</span></button></td><td class="no-i18n">' + esc(a.ws) + "</td><td class=\"tnum\">" + fmtShort(a.m.expires) + "</td><td>" + stLabel({ st: a.st, next: a.m.expires }) + (a.m.noRenew ? ' <span class="lic nr">' + LL("Won't renew", "Não renovar") + "</span>" : "") + '</td><td class="acts"><button class="btn sm" data-aexp="' + ref + '|add|7">+7</button><button class="btn sm" data-aexp="' + ref + '|add|30">+30</button><button class="btn sm ghost" data-aexp="' + ref + '|norenew|' + (a.m.noRenew ? 0 : 1) + '">' + (a.m.noRenew ? LL("Renew", "Renovar") : LL("Don't renew", "Não renovar")) + "</button></td></tr>";
    }).join("") + "</tbody></table></div>" : '<p class="muted small">' + LL("Nothing expiring in the next 7 days.", "Nenhum acesso vencendo nos próximos 7 dias.") + "</p>";
    return h + "</section>";
  }
  function usersPane(ids, map) {
    const all = Object.keys(map).map(function (k) { return map[k]; }), list = usersFiltered(map);
    const n = function (st) { return all.filter(function (u) { return st === "all" ? true : st === "norenew" ? u.noRenew : u.st === st; }).length; };
    const chip = function (st, l) { return '<button class="fchip' + ((UF.st || "all") === st ? " on" : "") + '" data-ust="' + st + '">' + l + ' <span class="count">' + n(st) + "</span></button>"; };
    const nsel = Object.keys(SEL).filter(function (k) { return map[k]; }).length;
    let h = '<section class="card adm-sec"><div class="sec-head"><div><h2>' + LL("Users & licences", "Usuários e licenças") + '</h2><p class="muted small">' + LL("One row per person: what they can open, until when, and the decision to extend or not. Select people to act in bulk; click a person for the details.", "Uma linha por pessoa: o que ela acessa, até quando, e a decisão de prorrogar ou não. Selecione pessoas para agir em lote; clique na pessoa para ver os detalhes.") + '</p></div><div class="sec-acts"><button class="btn sm" id="uCsv">' + LL("Export CSV", "Exportar CSV") + "</button></div></div>";
    h += '<div class="fbar">' + chip("all", LL("All", "Todos")) + chip("soon", LL("Expiring ≤ 7d", "Vencendo ≤ 7 dias")) + chip("off", LL("Expired", "Expirados")) + chip("ok", LL("Active", "Ativos")) + chip("none", LL("No limit", "Sem prazo")) + chip("norenew", LL("Won't renew", "Não renovar")) + "</div>";
    h += '<div class="fbar f2"><input id="uQ" type="search" value="' + esc(UF.q || "") + '" placeholder="' + esc(LL("Search name, e-mail or workspace", "Buscar nome, e-mail ou workspace")) + '"><select id="uWs" class="no-i18n"><option value="">' + LL("All workspaces", "Todos os workspaces") + "</option>" + ids.map(function (id) { return '<option value="' + esc(id) + '"' + (UF.ws === id ? " selected" : "") + ">" + esc(ws[id].info.name) + "</option>"; }).join("") + '</select><select id="uSort"><option value="name">' + LL("Sort: name", "Ordenar: nome") + '</option><option value="exp"' + (UF.sort === "exp" ? " selected" : "") + ">" + LL("Sort: nearest expiry", "Ordenar: validade mais próxima") + "</option></select></div>";
    h += '<div class="bulk"' + (nsel ? "" : " hidden") + '><b>' + plural(nsel, LL("selected", "selecionado"), LL("selected", "selecionados")) + '</b><span class="muted small">' + (UF.ws ? LL("in workspace ", "no workspace ") + esc((ws[UF.ws] && ws[UF.ws].info.name) || "") : LL("in all their workspaces", "em todos os workspaces deles")) + '</span><span class="sp"></span>' +
      '<span class="bl">' + LL("Extend", "Prorrogar") + '</span><button class="btn sm" data-bulk="add|7">+7</button><button class="btn sm" data-bulk="add|14">+14</button><button class="btn sm" data-bulk="add|30">+30</button><input type="date" id="bDate" aria-label="' + esc(LL("Until date", "Até a data")) + '"><button class="btn sm" data-bulk="date">' + LL("Set date", "Definir data") + '</button>' +
      '<button class="btn sm ghost" data-bulk="norenew|1">' + LL("Don't renew", "Não renovar") + '</button><button class="btn sm ghost danger-t" data-bulk="end">' + LL("End now", "Encerrar agora") + '</button><button class="btn sm ghost" data-bulk="welcome">✉ ' + LL("Welcome", "Boas-vindas") + '</button><button class="link" data-bulk="clear">' + LL("Clear", "Limpar") + "</button></div>";
    if (!all.length) return h + '<p class="muted small">' + t("No one has access yet.") + "</p></section>";
    h += '<div class="tbl-wrap"><table class="adm-tbl utbl"><thead><tr><th class="ck"><input type="checkbox" id="uAll" aria-label="' + esc(LL("Select all", "Selecionar todos")) + '"' + (list.length && list.every(function (u) { return SEL[u.k]; }) ? " checked" : "") + "></th><th>" + LL("Person", "Pessoa") + "</th><th>Workspaces</th><th>" + LL("Access", "Acessos") + "</th><th>" + LL("Role", "Papel") + "</th><th>" + LL("Valid until", "Validade") + "</th><th>" + LL("Status", "Situação") + "</th>" + (OWNER ? "" : "<th>" + LL("Modules", "Módulos") + "</th>") + "<th>E-mails</th><th></th></tr></thead><tbody>" +
      list.map(function (u) {
        const em = effMods(u);
        const wsn = u.acc.map(function (a) { return a.ws; });
        return '<tr data-row="' + esc(u.k) + '"' + (SEL[u.k] ? ' class="sel"' : "") + '><td class="ck"><input type="checkbox" data-sel="' + esc(u.k) + '"' + (SEL[u.k] ? " checked" : "") + ' aria-label="' + esc(u.email) + '"></td>' +
          '<td data-l="' + esc(LL("Person", "Pessoa")) + '"><button class="lnk-u" data-user="' + esc(u.k) + '"><span class="av sm no-i18n">' + esc((u.name || u.email)[0].toUpperCase()) + '</span><span><b class="no-i18n">' + esc(u.name || "—") + '</b><span class="muted no-i18n">' + esc(u.email) + "</span></span></button></td>" +
          '<td data-l="Workspaces" class="no-i18n wsn" title="' + esc(wsn.join(" · ")) + '">' + esc(wsn[0]) + (wsn.length > 1 ? "<small>+ " + esc(wsn.slice(1, 3).join(", ")) + (wsn.length > 3 ? " +" + (wsn.length - 3) : "") + "</small>" : "") + "</td>" +
          '<td data-l="' + esc(LL("Access", "Acessos")) + '">' + plural(u.boards, LL("board", "quadro"), LL("boards", "quadros")) + " · " + plural(u.plans, LL("planning", "planejamento"), LL("plannings", "planejamentos")) + (u.games ? " · " + plural(u.games, LL("game", "partida"), LL("games", "partidas")) : "") + "</td>" +
          '<td data-l="' + esc(LL("Role", "Papel")) + '">' + roleLabel(u.role) + "</td>" +
          '<td data-l="' + esc(LL("Valid until", "Validade")) + '" class="tnum">' + (u.st === "none" ? "—" : fmtShort(u.next)) + (u.off && u.st !== "off" ? '<span class="muted small"> · ' + plural(u.off, LL("expired", "expirado"), LL("expired", "expirados")) + "</span>" : "") + "</td>" +
          '<td data-l="' + esc(LL("Status", "Situação")) + '">' + stLabel(u) + (u.noRenew ? ' <span class="lic nr">' + LL("Won't renew", "Não renovar") + "</span>" : "") + "</td>" +
          (OWNER ? "" : '<td data-l="' + esc(LL("Modules", "Módulos")) + '">' + (Object.keys(em).length ? Object.keys(em).map(function (id) { return '<span class="lic ok" title="' + esc(LL("Via: ", "Por: ") + em[id].join(", ")) + '">' + esc((MODS().find(function (m) { return m.id === id; }) || {}).name || id) + "</span>"; }).join(" ") : '<span class="muted small">' + LL("Core", "Base") + "</span>") + "</td>") +
          '<td data-l="E-mails" class="mails">' + (u.acc.some(function (a) { return a.m.welcomed; }) ? '<span title="' + esc(LL("Welcome sent", "Boas-vindas enviado")) + '">✓ ✉</span>' : '<span class="muted" title="' + esc(LL("Welcome not sent", "Boas-vindas não enviado")) + '">✉</span>') + (u.acc.some(function (a) { return a.m.prospected; }) ? ' <span class="xp prospected">' + LL("Prosp.", "Prosp.") + "</span>" : "") + "</td>" +
          '<td class="go"><button class="btn sm" data-user="' + esc(u.k) + '">' + LL("Manage", "Gerenciar") + " ›</button></td></tr>";
      }).join("") + "</tbody></table></div>" + (list.length ? "" : '<p class="muted small">' + LL("No one matches the filters.", "Ninguém corresponde aos filtros.") + "</p>");
    return h + "</section>";
  }
  function drawerHtml(u) {
    if (!u) return "";
    const ic = function (n) { return window.CMIcon ? window.CMIcon(n, 14) : ""; };
    return '<div class="adm-drawer-bg" data-dclose></div><aside class="adm-drawer" role="dialog" aria-label="' + esc(u.name || u.email) + '"><header><span class="av no-i18n">' + esc((u.name || u.email)[0].toUpperCase()) + '</span><div><h2 class="no-i18n">' + esc(u.name || u.email) + '</h2><span class="muted no-i18n">' + esc(u.email) + '</span></div><button class="btn sm ghost" data-dclose aria-label="' + esc(LL("Close", "Fechar")) + '">✕</button></header>' +
      '<div class="d-sum">' + stLabel(u) + (u.noRenew ? ' <span class="lic nr">' + LL("Won't renew", "Não renovar") + "</span>" : "") + '<span class="muted small">' + plural(u.acc.length, "workspace", "workspaces") + " · " + plural(u.boards, LL("board", "quadro"), LL("boards", "quadros")) + " · " + plural(u.plans, LL("planning", "planejamento"), LL("plannings", "planejamentos")) + (u.games ? " · " + plural(u.games, LL("game", "partida"), LL("games", "partidas")) : "") + "</span></div>" +
      (OWNER ? "" : (function () { const em = effMods(u); return '<section class="d-acc d-mods"><div class="d-acc-h"><b>' + LL("Add-on modules", "Módulos adicionais") + "</b>" + periodSel('data-uper="' + esc(u.k) + '"') + "</div>" + MODS().map(function (m) { const g = userMods(u.k)[m.id], via = (em[m.id] || []).filter(function (x) { return x !== LL("individual", "individual"); }); return '<label class="mtog"><input type="checkbox" data-umod2="' + esc(u.k) + "|" + m.id + '"' + (gActive(g) ? " checked" : "") + "> <b>" + esc(m.name) + "</b> <span>" + esc(LL("individual: ", "individual: ") + grantTxt(g)) + (via.length ? " · " + esc(LL("company package: ", "pacote da empresa: ") + via.join(", ")) : "") + "</span></label>"; }).join("") + '<p class="muted small">' + LL("Company packages are set in Modules & packages.", "Pacotes de empresa ficam em Módulos e pacotes.") + "</p></section>"; })()) +
      u.acc.map(function (a) {
        const w = ws[a.id], ref = a.id + "|" + a.k, bl = w.boards || {}, pl = w.plannings || {};
        return '<section class="d-acc"><div class="d-acc-h"><b class="no-i18n">' + esc(a.ws) + "</b>" + roleSelect("", a.m.role, 'data-role="' + ref + '"') + "</div>" +
          '<div class="d-line">' + expiryBadge(a.m) + (a.m.noRenew ? ' <span class="lic nr">' + LL("Won't renew", "Não renovar") + "</span>" : "") + "</div>" +
          '<div class="d-acts"><span class="bl">' + LL("Extend", "Prorrogar") + '</span><button class="btn sm" data-aexp="' + ref + '|add|7">+7</button><button class="btn sm" data-aexp="' + ref + '|add|14">+14</button><button class="btn sm" data-aexp="' + ref + '|add|30">+30</button><input type="date" data-adate="' + ref + '" aria-label="' + esc(LL("Until date", "Até a data")) + '"' + (a.m.expires ? ' value="' + new Date(a.m.expires).toISOString().slice(0, 10) + '"' : "") + "></div>" +
          '<div class="d-acts">' + (a.m.expires ? '<button class="btn sm ghost" data-aexp="' + ref + '|full|0">' + LL("No time limit", "Sem prazo") + "</button>" : "") + '<button class="btn sm ghost" data-aexp="' + ref + "|norenew|" + (a.m.noRenew ? 0 : 1) + '">' + (a.m.noRenew ? LL("Renew", "Renovar") : LL("Don't renew", "Não renovar")) + "</button>" + (a.st !== "off" ? '<button class="btn sm ghost danger-t" data-aexp="' + ref + '|end|0">' + LL("End now", "Encerrar agora") + "</button>" : "") + '<button class="btn sm ghost danger-t" data-remove="' + ref + '">' + LL("Remove", "Remover") + "</button></div>" +
          '<details class="d-list"><summary>' + plural(Object.keys(bl).length, LL("board", "quadro"), LL("boards", "quadros")) + " · " + plural(Object.keys(pl).length, LL("planning (with dashboards)", "planejamento (com painéis)"), LL("plannings (with dashboards)", "planejamentos (com painéis)")) + "</summary><ul>" +
          Object.keys(bl).map(function (b) { return '<li>' + ic("board") + ' <a class="no-i18n" href="../board/?id=' + encodeURIComponent(b) + '">' + esc(bl[b].title || b) + "</a></li>"; }).join("") +
          Object.keys(pl).map(function (p) { return '<li>' + ic("planning") + ' <a class="no-i18n" href="../planning/?id=' + encodeURIComponent(p) + '">' + esc(pl[p].title || p) + '</a> <a class="muted small" href="../planning/?id=' + encodeURIComponent(p) + '#reports">' + LL("dashboard", "painel") + "</a></li>"; }).join("") + "</ul></details>" +
          '<div class="d-mail"><button class="link" data-welcome="' + ref + '">' + (a.m.welcomed ? "✓ " + LL("Welcome sent ", "Boas-vindas enviado em ") + fmtDate(a.m.welcomed) : "✉ " + LL("Send welcome", "Enviar boas-vindas")) + '</button><button class="link" data-prospect="' + ref + '">' + (a.m.prospected ? "✓ " + LL("Prospecting sent ", "Prospecção enviada em ") + fmtDate(a.m.prospected) : "✉ " + LL("Send prospecting", "Enviar prospecção")) + "</button></div></section>";
      }).join("") + "</aside>";
  }
  function wsPane(ids) {
    let h = '<section class="card adm-sec"><div class="sec-head"><div><h2>' + LL("New workspace", "Novo workspace") + '</h2><p class="muted small">' + t('A workspace groups boards and people – e.g. "Mentoring 2026", "Consulting – Company X". People invited to a workspace see all its boards.') + "</p></div></div>" +
      '<form id="newWs" class="form-inline ws-form"><input name="wsname" required placeholder="' + esc(t("Workspace name")) + '" autocomplete="off">' + areaSelect("area", "") + daysSelect("days", 0) + '<button class="btn primary">' + t("Create workspace") + '</button><label class="consent"><input type="checkbox" name="prospect"><span>' + esc(t("Prospecting: one workspace per company (test access, 14 days by default)")) + "</span></label></form></section>";
    h += '<section class="card adm-sec"><div class="sec-head"><div><h2>Workspaces <span class="count">' + ids.length + '</span></h2><p class="muted small">' + LL("Click a workspace to manage its boards, plannings and people.", "Clique num workspace para gerenciar quadros, planejamentos e pessoas.") + "</p></div></div>";
    if (!ids.length) return h + '<p class="muted">' + t("No workspaces yet") + "</p></section>";
    const AR = window.PLAN_AREAS || {};
    h += '<div class="ws-list"><div class="ws-row ws-hd"><span>Workspace</span><span>' + LL("Area", "Área") + "</span><span>" + LL("Boards", "Quadros") + "</span><span>" + LL("Plannings", "Planejamentos") + "</span><span>" + LL("People", "Pessoas") + "</span><span>" + LL("Default access", "Acesso padrão") + "</span></div>" +
      ids.map(function (id) {
        const w = ws[id], i = w.info || {}, ar = AR[i.area] || {};
        return '<details class="ws-det" id="wsd-' + id + '"' + (UF.open === id ? " open" : "") + '><summary class="ws-row"><span><b class="no-i18n">' + esc(i.name) + "</b>" + (i.prospect ? ' <span class="xp prospected">' + esc(t("Prospecting workspace")) + "</span>" : "") + '</span><span data-l="' + esc(LL("Area", "Área")) + '">' + esc(ar.name || "—") + '</span><span data-l="' + esc(LL("Boards", "Quadros")) + '">' + Object.keys(w.boards || {}).length + '</span><span data-l="' + esc(LL("Plannings", "Planejamentos")) + '">' + Object.keys(w.plannings || {}).length + '</span><span data-l="' + esc(LL("People", "Pessoas")) + '">' + Object.keys(w.members || {}).length + '</span><span data-l="' + esc(LL("Default access", "Acesso padrão")) + '">' + (i.accessDays ? i.accessDays + " " + LL("days", "dias") : LL("No limit", "Sem prazo")) + "</span></summary>" + wsCard(id) + "</details>";
      }).join("") + "</div>";
    return h + "</section>";
  }
  function render() {
    const ids = sortByCreated(Object.keys(ws).reduce(function (o, k) { o[k] = (ws[k] || {}).info || {}; return o; }, {}));
    const map = buildUsers(), users = Object.keys(map).map(function (k) { return map[k]; });
    let h = OWNER ? '<div class="userbar"><span class="muted"><span>Signed in as</span> <b class="no-i18n">' + esc(me.email) + '</b></span><span class="plan-badge">' + esc(t("Plan")) + ": <b>" + esc(PLAN.name) + "</b> · " + PLAN.seats + " " + esc(t("seats")) + '</span><a class="btn sm primary" href="../pricing/">' + esc(t("Upgrade")) + '</a><a class="btn" href="../workspaces/">My boards</a><button class="btn" id="soBtn">Sign out</button></div>'
      : '<div class="userbar"><span class="muted"><span>Administrator</span>: <b class="no-i18n">' + esc(me.email) + '</b></span><a class="btn" href="../workspaces/">My boards</a><button class="btn" id="soBtn">Sign out</button></div>';
    const SECS = [["overview", LL("Overview", "Visão geral"), "visao-geral", "", "chart"], ["users", LL("Users & licences", "Usuários e licenças"), "usuarios", users.filter(function (u) { return u.st === "soon"; }).length || users.length, "users"], ["ws", "Workspaces", "workspaces", ids.length, "folder"]]
      .concat(OWNER ? [] : [["modules", LL("Modules & packages", "Módulos e pacotes"), "modulos", Object.keys(modReq || {}).length || "", "grid"], ["signups", LL("Beta sign-ups", "Inscrições no beta"), "inscricoes", Object.keys(signups).length, "inbox"], ["plans", LL("Plans", "Planos"), "planos", Object.keys(plans).length, "card"], ["comms", LL("Announcement", "Comunicação"), "comunicacao", "", "bell"], ["feedback", "Feedback", "feedback", Object.keys(feedback).length, "chat"]]);
    const hash = (location.hash || "").slice(1);
    let sec = (SECS.find(function (s) { return s[2] === hash || s[0] === hash; }) || [])[0];
    if (!sec) { try { sec = localStorage.getItem("cmcollab:admsec"); } catch (e) { /* ignore */ } }
    if (!SECS.some(function (s) { return s[0] === sec; })) sec = "overview";
    const soon = users.filter(function (u) { return u.st === "soon"; }).length;
    h += '<div class="adm-shell"><nav class="adm-nav no-i18n" aria-label="' + esc(LL("Administration", "Administração")) + '">' + SECS.map(function (s) {
      const badge = s[0] === "users" && soon ? '<span class="count warn" title="' + esc(LL("Expiring in 7 days", "Vencendo em 7 dias")) + '">' + soon + "</span>" : s[3] !== "" ? '<span class="count">' + s[3] + "</span>" : "";
      return '<button data-sec="' + s[0] + '"' + (s[0] === sec ? ' class="on" aria-current="page"' : "") + "><span>" + s[1] + "</span>" + badge + "</button>";
    }).join("") + '</nav><div class="adm-main no-i18n-wrap">';
    const pane = function (k, html) { return '<div class="adm-pane" data-pane="' + k + '"' + (k === sec ? "" : " hidden") + ">" + html + "</div>"; };
    h += pane("overview", overviewPane(ids, map)) + pane("users", usersPane(ids, map)) + pane("ws", wsPane(ids));
    if (!OWNER) h += pane("modules", modulesPane(ids)) + pane("signups", signupsSection()) + pane("plans", plansSection()) + pane("comms", annSection()) + pane("feedback", feedbackSection());
    h += "</div></div>" + '<div id="admDrawer">' + (drawerK && map[drawerK] ? drawerHtml(map[drawerK]) : "") + "</div>";
    h += '<div class="modal-lite" id="inviteDlg" hidden><div class="card"><h2></h2><p class="muted small">' + t("The sign-in link was e-mailed automatically. If you like, also send this personal message (e.g. by WhatsApp).") + '</p>' +
      '<textarea rows="10" readonly></textarea><div class="row-end"><button class="btn" id="dlgClose">Close</button><button class="btn" id="copyInv">Copy message</button><a class="btn primary" id="mailBtn" href="#">Open in e-mail</a></div></div></div>';
    el.innerHTML = h;
    const SLUG = {}; SECS.forEach(function (x) { SLUG[x[0]] = x[2]; });
    function go(k, st) {
      if (st) { UF.st = st; saveUF(); return render(), go(k); }
      el.querySelectorAll("[data-sec]").forEach(function (x) { const on = x.dataset.sec === k; x.classList.toggle("on", on); if (on) x.setAttribute("aria-current", "page"); else x.removeAttribute("aria-current"); });
      el.querySelectorAll("[data-pane]").forEach(function (p) { p.hidden = p.dataset.pane !== k; });
      try { localStorage.setItem("cmcollab:admsec", k); history.replaceState(null, "", "#" + SLUG[k]); } catch (e) { /* ignore */ }
      window.scrollTo({ top: 0 });
    }
    el.querySelectorAll("[data-sec]").forEach(function (b) { b.onclick = function () { go(b.dataset.sec); }; });
    el.querySelectorAll("[data-go]").forEach(function (b) { b.onclick = function () { const g = b.dataset.go.split(":"); if (g[1]) { UF.st = g[1]; saveUF(); render(); } go(g[0] === "users" ? "users" : g[0]); }; });
    function rr(focusId) { render(); const f = focusId && document.getElementById(focusId); if (f) { f.focus(); if (f.setSelectionRange && f.type === "search") { const n = f.value.length; f.setSelectionRange(n, n); } } }
    el.querySelectorAll("[data-ust]").forEach(function (b) { b.onclick = function () { UF.st = b.dataset.ust; saveUF(); rr(); }; });
    const uQ = document.getElementById("uQ"); if (uQ) uQ.oninput = function () { UF.q = uQ.value; saveUF(); rr("uQ"); };
    const uWs = document.getElementById("uWs"); if (uWs) uWs.onchange = function () { UF.ws = uWs.value; saveUF(); rr(); };
    const uSort = document.getElementById("uSort"); if (uSort) uSort.onchange = function () { UF.sort = uSort.value; saveUF(); rr(); };
    el.querySelectorAll("[data-sel]").forEach(function (c) { c.onchange = function () { if (c.checked) SEL[c.dataset.sel] = 1; else delete SEL[c.dataset.sel]; rr(); }; });
    const uAll = document.getElementById("uAll"); if (uAll) uAll.onchange = function () { usersFiltered(map).forEach(function (u) { if (uAll.checked) SEL[u.k] = 1; else delete SEL[u.k]; }); rr(); };
    const selAcc = function () { return Object.keys(SEL).filter(function (k) { return map[k]; }).reduce(function (l, k) { return l.concat(accSel(map[k])); }, []); };
    el.querySelectorAll("[data-bulk]").forEach(function (b) { b.onclick = function () {
      const q = b.dataset.bulk.split("|"), list = selAcc();
      if (q[0] === "clear") { Object.keys(SEL).forEach(function (k) { delete SEL[k]; }); return rr(); }
      if (q[0] === "welcome") {
        const byWs = {}; list.filter(function (a) { return a.st !== "off"; }).forEach(function (a) { (byWs[a.id] = byWs[a.id] || []).push(a.m.email); });
        const n = Object.keys(byWs).reduce(function (s, k) { return s + byWs[k].length; }, 0);
        if (!n) return toast(LL("No active access selected", "Nenhum acesso ativo selecionado"));
        if (window.confirm(t("Send the welcome e-mail to") + " " + n + " " + t("people") + "?")) Object.keys(byWs).forEach(function (w) { sendWelcome(w, byWs[w]); });
        return;
      }
      if (q[0] === "date") { const v = document.getElementById("bDate").value; if (!v) return toast(LL("Choose a date", "Escolha uma data")); if (applyExp(list, "date", new Date(v + "T23:59:00").getTime())) Object.keys(SEL).forEach(function (k) { delete SEL[k]; }); return; }
      if (applyExp(list, q[0], Number(q[1] || 0))) Object.keys(SEL).forEach(function (k) { delete SEL[k]; });
    }; });
    el.querySelectorAll("[data-aexp]").forEach(function (b) { b.onclick = function () {
      const q = b.dataset.aexp.split("|"), m = ((ws[q[0]] || {}).members || {})[q[1]]; if (!m) return;
      applyExp([{ id: q[0], k: q[1], m: m, ws: ws[q[0]].info.name }], q[2], Number(q[3]));
    }; });
    el.querySelectorAll("[data-adate]").forEach(function (i) { i.onchange = function () {
      const q = i.dataset.adate.split("|"), m = ((ws[q[0]] || {}).members || {})[q[1]]; if (!m || !i.value) return;
      applyExp([{ id: q[0], k: q[1], m: m, ws: ws[q[0]].info.name }], "date", new Date(i.value + "T23:59:00").getTime());
    }; });
    el.querySelectorAll("[data-user]").forEach(function (b) { b.onclick = function () { drawerK = b.dataset.user; rr(); }; });
    el.querySelectorAll("[data-dclose]").forEach(function (b) { b.onclick = function () { drawerK = null; const d = document.getElementById("admDrawer"); if (d) d.innerHTML = ""; }; });
    if (drawerK) document.onkeydown = function (e) { if (e.key === "Escape" && drawerK) { drawerK = null; const d = document.getElementById("admDrawer"); if (d) d.innerHTML = ""; } };
    el.querySelectorAll(".ws-det").forEach(function (d) { d.ontoggle = function () { if (d.open) { UF.open = d.id.slice(4); saveUF(); } else if (UF.open === d.id.slice(4)) { UF.open = ""; saveUF(); } }; });
    if (!OWNER) bindModules();
    const uCsv = document.getElementById("uCsv"); if (uCsv) uCsv.onclick = function () {
      const q = function (v) { v = v == null ? "" : String(v); return '"' + v.replace(/"/g, '""') + '"'; };
      const rows = []; usersFiltered(map).forEach(function (u) { u.acc.forEach(function (a) { rows.push([u.name, u.email, a.ws, a.m.role || "editor", a.m.expires ? new Date(a.m.expires).toISOString().slice(0, 10) : "", a.st === "none" ? "sem prazo" : a.st === "off" ? "expirado" : a.st === "soon" ? "vence em 7 dias" : "ativo", a.m.noRenew ? "sim" : "", a.boards, a.plans, a.m.welcomed ? new Date(a.m.welcomed).toISOString().slice(0, 10) : "", a.m.prospected ? new Date(a.m.prospected).toISOString().slice(0, 10) : ""].map(q).join(",")); }); });
      const blob = new Blob(["﻿" + ["nome", "email", "workspace", "papel", "validade", "situacao", "nao_renovar", "quadros", "planejamentos", "boas_vindas", "prospeccao"].join(",") + "\n" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
      const x = document.createElement("a"); x.href = URL.createObjectURL(blob); x.download = "cm-collaborator-usuarios-licencas-" + new Date().toISOString().slice(0, 10) + ".csv"; document.body.appendChild(x); x.click(); x.remove();
    };

    document.getElementById("newWs").onsubmit = function (e) { e.preventDefault(); createWorkspace(e.target); };
    const af = document.getElementById("annForm");
    if (af) af.onsubmit = function (e) { e.preventDefault(); db.ref("announcement").set({ title: af.title.value.trim(), text: af.text.value.trim(), on: af.on.checked, t: TS(), by: me.email }).then(function () { toast("Announcement saved"); load(); }, fail); };
    const pf = document.getElementById("planForm"); if (pf) pf.onsubmit = function (e) { e.preventDefault(); savePlan(pf); };
    el.querySelectorAll("[data-delplan]").forEach(function (b) { b.onclick = function () { if (window.confirm(t("Remove this plan? The customer goes back to Free."))) db.ref("plans/" + b.dataset.delplan).remove().then(load, fail); }; });
    document.getElementById("soBtn").onclick = A.signOut;
    el.querySelectorAll("form[data-newboard]").forEach(function (f) { f.onsubmit = function (e) { e.preventDefault(); createBoard(f.dataset.newboard, f); }; });
    el.querySelectorAll("form[data-add]").forEach(function (f) { f.onsubmit = function (e) { e.preventDefault(); addMember(f.dataset.add, f); }; });
    function pair(s) { return s.split("|"); }
    el.querySelectorAll("[data-role]").forEach(function (s) { s.onchange = function () { const p = pair(s.dataset.role); setRole(p[0], p[1], s.value); }; });
    el.querySelectorAll("[data-invite]").forEach(function (b) { b.onclick = function () { const p = pair(b.dataset.invite); const m = ((ws[p[0]] || {}).members || {})[p[1]]; if (m) inviteAndTell([m.email], p[0]); openInvite(p[0], p[1]); }; });
    el.querySelectorAll("[data-welcome]").forEach(function (b) { b.onclick = function () { const p = pair(b.dataset.welcome); const m = ((ws[p[0]] || {}).members || {})[p[1]]; if (m) sendWelcome(p[0], [m.email]); }; });
    el.querySelectorAll("[data-welcomeall]").forEach(function (b) { b.onclick = function () {
      const id = b.dataset.welcomeall, mm = (ws[id] || {}).members || {};
      const list = Object.keys(mm).map(function (k) { return mm[k]; }).filter(function (m) { return m.email !== me.email && (!m.expires || m.expires > Date.now()); });
      const pend = list.filter(function (m) { return !m.welcomed; });
      const use = pend.length ? pend : list;
      if (!use.length) return toast("No one has access yet.");
      if (window.confirm(t("Send the welcome e-mail to") + " " + use.length + " " + t("people") + "?\n\n" + use.map(function (m) { return m.email; }).join("\n"))) sendWelcome(id, use.map(function (m) { return m.email; }));
    }; });
    el.querySelectorAll("[data-prospect]").forEach(function (b) { b.onclick = function () {
      const p = pair(b.dataset.prospect), m = ((ws[p[0]] || {}).members || {})[p[1]]; if (!m) return;
      if (m.expires && m.expires < Date.now()) return toast("This person's access has expired – extend it before sending");
      const again = m.prospected ? "\n\n" + t("Already sent on") + " " + fmtDate(m.prospected) + "." : "";
      if (window.confirm(t("Send the sales prospecting e-mail to") + " " + m.email + "?" + again)) sendProspect(p[0], [m.email]);
    }; });
    el.querySelectorAll("form[data-add] select[name=mailType]").forEach(function (s) { s.onchange = function () {
      const d = s.form.days; if (s.value === "prospect" && d && Number(d.value) === 0) d.value = "14";
    }; });
    el.querySelectorAll("[data-remove]").forEach(function (b) { b.onclick = function () { const p = pair(b.dataset.remove); removeMember(p[0], p[1]); }; });
    el.querySelectorAll("[data-delp]").forEach(function (b) { b.onclick = function () { const p = pair(b.dataset.delp); deletePlanningAdm(p[0], p[1]); }; });
    el.querySelectorAll("[data-renp]").forEach(function (b) { b.onclick = function () { const p = pair(b.dataset.renp); renamePlanning(p[0], p[1]); }; });
    el.querySelectorAll("[data-reng]").forEach(function (b) { b.onclick = function () { const p = pair(b.dataset.reng); renameGame(p[0], p[1]); }; });
    el.querySelectorAll("[data-delg]").forEach(function (b) { b.onclick = function () { const p = pair(b.dataset.delg); deleteGameAdm(p[0], p[1]); }; });
    el.querySelectorAll("[data-copyp]").forEach(function (b) { b.onclick = function () { const u = abs("../planning/?id=" + encodeURIComponent(b.dataset.copyp)); (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { toast("Link copied"); }, function () { window.prompt("Link", u); }); }; });
    el.querySelectorAll("[data-delb]").forEach(function (b) { b.onclick = function () { const p = pair(b.dataset.delb); deleteBoard(p[0], p[1]); }; });
    el.querySelectorAll("[data-ren]").forEach(function (b) { b.onclick = function () { const p = pair(b.dataset.ren); renameBoard(p[0], p[1]); }; });
    el.querySelectorAll("[data-wsarea]").forEach(function (sel) { sel.onchange = function () { db.ref("workspaces/" + sel.dataset.wsarea + "/info/area").set(sel.value || null).then(function () { toast(window.MB_LANG === "pt" ? "Área atualizada" : "Area updated"); }, fail); }; });
    el.querySelectorAll("[data-delws]").forEach(function (b) { b.onclick = function () { deleteWorkspace(b.dataset.delws); }; });
    el.querySelectorAll("[data-ext]").forEach(function (b) { b.onclick = function () { const p = pair(b.dataset.ext); extendMember(p[0], p[1], Number(p[2])); }; });
    const suWs = document.getElementById("suWs"); if (suWs) suWs.onchange = function () { signupWs = suWs.value; signupDays = null; render(); };
    const suD = document.getElementById("suDays"); if (suD) suD.onchange = function () { signupDays = Number(suD.value) || 0; };
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
      if (!user) return screen("Sign in required", t("Administration is only for the account owner."), '<a class="btn primary" href="../workspaces/?next=' + encodeURIComponent(location.pathname) + '">' + t("Sign in") + "</a>");
      me = user; db = A.db();
      return A.isAdmin().then(function (ok) {
        MEK = A.key(user.email);
        if (!ok) { OWNER = true; document.title = t("Manage workspaces") + " · CM Collaborator"; const h1 = document.querySelector("main h1"); if (h1) h1.textContent = t("My workspaces, boards & people"); return load(); }
        const na = document.getElementById("navAdmin"); if (na) na.hidden = false;
        return load();
      });
    }).catch(function (e) { screen("Error", esc(e.message)); });
  }
  start();
})();
