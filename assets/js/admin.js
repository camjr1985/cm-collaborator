/* CM Collaborator – Administration: workspaces, boards and people (admins only; enforced by database.rules.json) */
(function () {
  "use strict";
  const A = window.CMAuth;
  const el = document.getElementById("admin");
  const t = function (s) { return (window.MBt || String)(s); };
  const PT = window.MB_LANG === "pt";
  const TEMPLATES = [["persona", "Persona Map + Priority Map"], ["moscow", "MoSCoW priority map"], ["blank", "Blank board"]];
  let db, me, ws = {};

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
    return db.ref("workspaces").once("value").then(function (s) { ws = s.val() || {}; render(); });
  }
  function update(u, okMsg) {
    return db.ref().update(u).then(function () { if (okMsg) toast(okMsg); return load(); }).catch(fail);
  }
  function createWorkspace(f) {
    const name = f.wsname.value.trim();
    if (!name) return toast("Give the workspace a name");
    const id = (slug(name) || "workspace") + "-" + rnd(), u = {};
    u["workspaces/" + id + "/info"] = { name: name, created: TS(), createdBy: me.email };
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
    const k = A.key(email), u = {};
    u["workspaces/" + wsId + "/members/" + k] = { email: email, name: name || email.split("@")[0], role: role, invitedAt: TS(), invitedBy: me.email };
    u["userWorkspaces/" + k + "/" + wsId] = true;
    f.reset();
    update(u, "Access granted").then(function () { openInvite(wsId, k); });
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
    const w = ws[wsId], link = abs("../mentoring/");
    if (PT) {
      return "Olá " + (m.name || "") + ",\n\nVocê foi convidado(a) para o workspace \"" + w.info.name + "\" no CM Collaborator.\n\n" +
        "1. Abra: " + link + "\n2. Entre com este e-mail: " + m.email + " (botão Google ou link de acesso por e-mail).\n3. Os seus quadros aparecem em \"Os meus quadros\".\n\nAté já!";
    }
    return "Hi " + (m.name || "") + ",\n\nYou've been invited to the workspace \"" + w.info.name + "\" on CM Collaborator.\n\n" +
      "1. Open: " + link + "\n2. Sign in with this e-mail: " + m.email + " (Google button or e-mail sign-in link).\n3. Your boards appear under \"My boards\".\n\nSee you there!";
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
      '<form id="newWs" class="form-inline ws-form"><input name="wsname" required placeholder="' + esc(t("Workspace name")) + '" autocomplete="off"><button class="btn primary">Create workspace</button></form></section>' +
      '<section class="card stats"><h2>Overview</h2><div class="stat-row"><div class="stat"><b>' + ids.length + "</b><span>Workspaces</span></div><div class=\"stat\"><b>" + nBoards + "</b><span>Boards</span></div><div class=\"stat\"><b>" + Object.keys(people).length + "</b><span>People</span></div></div>" +
      '<p class="muted small">Only invited e-mails can open a workspace. Admins are managed in the Firebase console.</p></section></div>';

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
          '<button class="btn sm" data-invite="' + id + "|" + k + '">Invite</button><button class="btn sm ghost danger-t" data-remove="' + id + "|" + k + '">Remove</button></li>';
      }).join("");
      return '<section class="card ws-card" id="ws-' + id + '"><div class="br-head"><div><span class="eyebrow sm">Workspace</span><h2 class="no-i18n">' + esc(w.info.name) + "</h2></div>" +
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
        roleSelect("role", "editor") + '<button class="btn primary">Grant access</button></form></div></div></section>';
    }).join("");

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
