/* CM Collaborator – Administration (admins only; enforced by database.rules.json) */
(function () {
  "use strict";
  const A = window.CMAuth;
  const el = document.getElementById("admin");
  const t = function (s) { return (window.MBt || String)(s); };
  const PT = window.MB_LANG === "pt";
  let db, me, boards = {}, members = {};

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function slug(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60); }
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
  function boardUrl(id) { return new URL("../board/?id=" + encodeURIComponent(id), location.href).href; }
  function TS() { return window.firebase.database.ServerValue.TIMESTAMP; }
  function toast(msg) {
    let n = document.getElementById("toast");
    if (!n) { n = document.createElement("div"); n.id = "toast"; n.className = "site-toast"; n.setAttribute("role", "status"); document.body.appendChild(n); }
    n.textContent = t(msg); n.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { n.classList.remove("show"); }, 2600);
  }
  function inviteText(id, m) {
    const b = boards[id] || {};
    if (PT) {
      return "Olá " + (m.name || "") + ",\n\nVocê foi convidado(a) para o quadro \"" + (b.title || id) + "\" no CM Collaborator.\n\n" +
        "1. Abra: " + boardUrl(id) + "\n2. Entre com este e-mail: " + m.email + " (Google ou link de acesso por e-mail).\n\nAté já!";
    }
    return "Hi " + (m.name || "") + ",\n\nYou've been invited to the board \"" + (b.title || id) + "\" on CM Collaborator.\n\n" +
      "1. Open: " + boardUrl(id) + "\n2. Sign in with this e-mail: " + m.email + " (Google or e-mail sign-in link).\n\nSee you there!";
  }

  function screen(title, text, actions) {
    el.innerHTML = '<div class="card auth-card"><h2>' + title + '</h2><p class="muted">' + text + "</p>" + (actions || "") + "</div>";
  }

  function setup() {
    screen("Setup required", "Private access needs Firebase. Follow these steps once:",
      '<ol class="setup"><li>Create a free project at <a href="https://console.firebase.google.com" target="_blank" rel="noopener">console.firebase.google.com</a>.</li>' +
      "<li>Authentication → Sign-in method: enable <b>Google</b> and <b>Email link (passwordless)</b>. In Settings → Authorized domains add <code>camjr1985.github.io</code>.</li>" +
      "<li>Realtime Database → Create database → Rules: paste the content of <code>database.rules.json</code> → Publish.</li>" +
      "<li>Realtime Database → Data: add <code>admins</code> → your e-mail with dots replaced by commas → <code>true</code>.</li>" +
      "<li>Project settings → Your apps → Web: copy the config into <code>assets/js/config.js</code> and push.</li></ol>");
  }

  /* ---------------- data ---------------- */
  function load() {
    return db.ref("boardIndex").once("value").then(function (s) {
      boards = s.val() || {};
      const ids = Object.keys(boards);
      return Promise.all(ids.map(function (id) {
        return db.ref("boards/" + id + "/members").once("value").then(function (m) { members[id] = m.val() || {}; });
      }));
    }).then(render);
  }

  function createBoard(f) {
    const name = f.name.value.trim(), email = f.email.value.trim().toLowerCase(), id = slug(f.id.value || name), role = f.role.value;
    if (!name || !id) return toast("Fill in the mentee name");
    if (!validEmail(email)) return toast("Enter a valid e-mail");
    return db.ref("boards/" + id + "/info").once("value").then(function (s) {
      if (s.exists()) { toast("A board with this id already exists"); return; }
      const k = A.key(email), u = {};
      u["boards/" + id + "/info"] = { title: name, mentee: name, template: "persona", created: TS(), createdBy: me.email };
      u["boards/" + id + "/members/" + k] = { email: email, name: name, role: role, invitedAt: TS(), invitedBy: me.email };
      u["boardIndex/" + id] = { title: name, mentee: name, created: TS() };
      u["userBoards/" + k + "/" + id] = true;
      return db.ref().update(u).then(function () { f.reset(); toast("Board created and access granted"); return load(); }).then(function () { openInvite(id, k); });
    }).catch(function (e) { toast(e.message); });
  }

  function addMember(id, f) {
    const email = f.email.value.trim().toLowerCase(), name = f.name.value.trim(), role = f.role.value;
    if (!validEmail(email)) return toast("Enter a valid e-mail");
    const k = A.key(email), u = {};
    u["boards/" + id + "/members/" + k] = { email: email, name: name || email.split("@")[0], role: role, invitedAt: TS(), invitedBy: me.email };
    u["userBoards/" + k + "/" + id] = true;
    db.ref().update(u).then(function () { toast("Access granted"); return load(); }).then(function () { openInvite(id, k); }).catch(function (e) { toast(e.message); });
  }

  function removeMember(id, k) {
    const m = members[id][k];
    if (!window.confirm(t("Remove access for") + " " + m.email + "?")) return;
    const u = {};
    u["boards/" + id + "/members/" + k] = null;
    u["userBoards/" + k + "/" + id] = null;
    db.ref().update(u).then(function () { toast("Access removed"); return load(); }).catch(function (e) { toast(e.message); });
  }

  function setRole(id, k, role) {
    db.ref("boards/" + id + "/members/" + k + "/role").set(role).then(function () { members[id][k].role = role; toast("Role updated"); }).catch(function (e) { toast(e.message); });
  }

  function deleteBoard(id) {
    const typed = window.prompt(t("This permanently deletes the board and its content. Type the board id to confirm:") + " " + id);
    if (typed !== id) return;
    const u = {};
    u["boards/" + id] = null;
    u["boardIndex/" + id] = null;
    Object.keys(members[id] || {}).forEach(function (k) { u["userBoards/" + k + "/" + id] = null; });
    db.ref().update(u).then(function () { toast("Board deleted"); return load(); }).catch(function (e) { toast(e.message); });
  }

  /* ---------------- UI ---------------- */
  function openInvite(id, k) {
    const m = (members[id] || {})[k]; if (!m) return;
    const txt = inviteText(id, m);
    const subject = PT ? "Convite: quadro de mentoria no CM Collaborator" : "Invitation: your mentoring board on CM Collaborator";
    const dlg = document.getElementById("inviteDlg");
    dlg.querySelector("h2").textContent = t("Invite") + " " + (m.name || m.email);
    dlg.querySelector("textarea").value = txt;
    dlg.querySelector("#mailBtn").href = "mailto:" + encodeURIComponent(m.email) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(txt);
    dlg.hidden = false;
  }

  function render() {
    const ids = Object.keys(boards).sort(function (a, b) { return (boards[b].created || 0) - (boards[a].created || 0); });
    let h = '<div class="userbar"><span class="muted"><span>Administrator</span>: <b>' + esc(me.email) + '</b></span><a class="btn" href="../mentoring/">My boards</a><button class="btn" id="soBtn">Sign out</button></div>';
    h += '<div class="admin-grid"><section class="card"><h2>New board</h2><p class="muted small">Creates a private board and gives access to the mentee.</p>' +
      '<form id="newBoard" class="form-grid">' +
      '<label class="lbl-f">Mentee name<input name="name" required placeholder="Daniel Bastos" autocomplete="off"></label>' +
      '<label class="lbl-f">Mentee e-mail<input name="email" type="email" required placeholder="name@email.com" autocomplete="off"></label>' +
      '<label class="lbl-f">Board id (link)<input name="id" placeholder="daniel-bastos" pattern="[a-z0-9-]{2,60}" autocomplete="off"></label>' +
      '<label class="lbl-f">Access<select name="role"><option value="editor">Can edit</option><option value="viewer">View only</option></select></label>' +
      '<button class="btn primary">Create board &amp; grant access</button></form></section>' +
      '<section class="card stats"><h2>Overview</h2><div class="stat"><b>' + ids.length + '</b><span>Boards</span></div><div class="stat"><b>' +
      ids.reduce(function (a, id) { return a + Object.keys(members[id] || {}).length; }, 0) + '</b><span>People with access</span></div>' +
      '<p class="muted small">Only e-mails listed on a board can open it. Admins are managed in the Firebase console.</p></section></div>';

    h += "<h2 style=\"margin-top:40px\">Boards</h2>";
    if (!ids.length) h += '<div class="card empty-big"><p class="muted">No boards yet. Create the first one above.</p></div>';
    h += ids.map(function (id) {
      const b = boards[id], ms = members[id] || {};
      const rows = Object.keys(ms).map(function (k) {
        const m = ms[k];
        return '<li class="member"><span class="av sm">' + esc((m.name || m.email)[0].toUpperCase()) + '</span><span class="m-who"><b>' + esc(m.name || "") + '</b><span class="muted">' + esc(m.email) + "</span></span>" +
          '<select data-role="' + id + "|" + k + '" aria-label="Access"><option value="editor"' + (m.role === "editor" ? " selected" : "") + '>Can edit</option><option value="viewer"' + (m.role === "viewer" ? " selected" : "") + ">View only</option></select>" +
          '<button class="btn sm" data-invite="' + id + "|" + k + '">Invite</button><button class="btn sm ghost danger-t" data-remove="' + id + "|" + k + '">Remove</button></li>';
      }).join("");
      return '<section class="card board-row"><div class="br-head"><div><h3>' + esc(b.title || id) + '</h3><span class="muted small no-i18n">board/?id=' + esc(id) + '</span></div>' +
        '<div class="br-actions"><a class="btn primary sm" href="../board/?id=' + encodeURIComponent(id) + '">Open board</a><button class="btn sm" data-copy="' + id + '">Copy link</button><button class="btn sm ghost danger-t" data-del="' + id + '">Delete</button></div></div>' +
        '<ul class="members">' + (rows || '<li class="muted small">No one has access yet.</li>') + "</ul>" +
        '<form class="add-member form-inline" data-add="' + id + '"><input name="name" placeholder="Name" autocomplete="off"><input name="email" type="email" required placeholder="name@email.com" autocomplete="off">' +
        '<select name="role"><option value="editor">Can edit</option><option value="viewer">View only</option></select><button class="btn sm">Grant access</button></form></section>';
    }).join("");

    h += '<div class="modal-lite" id="inviteDlg" hidden><div class="card"><h2></h2><p class="muted small">Send this message to the person. They sign in with the invited e-mail and the board opens.</p>' +
      '<textarea rows="9" readonly></textarea><div class="row-end"><button class="btn" id="dlgClose">Close</button><button class="btn" id="copyInv">Copy message</button><a class="btn primary" id="mailBtn" href="#">Open in e-mail</a></div></div></div>';
    el.innerHTML = h;

    const nb = document.getElementById("newBoard");
    nb.name.addEventListener("input", function () { if (!nb.id.dataset.touched) nb.id.value = slug(nb.name.value); });
    nb.id.addEventListener("input", function () { nb.id.dataset.touched = "1"; });
    nb.onsubmit = function (e) { e.preventDefault(); createBoard(nb); };
    document.getElementById("soBtn").onclick = A.signOut;
    el.querySelectorAll("form[data-add]").forEach(function (f) { f.onsubmit = function (e) { e.preventDefault(); addMember(f.dataset.add, f); }; });
    el.querySelectorAll("[data-role]").forEach(function (s) { s.onchange = function () { const p = s.dataset.role.split("|"); setRole(p[0], p[1], s.value); }; });
    el.querySelectorAll("[data-invite]").forEach(function (b) { b.onclick = function () { const p = b.dataset.invite.split("|"); openInvite(p[0], p[1]); }; });
    el.querySelectorAll("[data-remove]").forEach(function (b) { b.onclick = function () { const p = b.dataset.remove.split("|"); removeMember(p[0], p[1]); }; });
    el.querySelectorAll("[data-del]").forEach(function (b) { b.onclick = function () { deleteBoard(b.dataset.del); }; });
    el.querySelectorAll("[data-copy]").forEach(function (b) {
      b.onclick = function () { navigator.clipboard.writeText(boardUrl(b.dataset.copy)).then(function () { toast("Link copied"); }); };
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
      if (!user) return screen("Sign in required", "Administration is only for the account owner.", '<a class="btn primary" href="../mentoring/?next=' + encodeURIComponent(location.pathname) + '">Sign in</a>');
      me = user; db = A.db();
      return A.isAdmin().then(function (ok) {
        if (!ok) { screen("Admins only", "Your account (" + esc(user.email) + ") is not an administrator.", '<a class="btn primary" href="../mentoring/">My boards</a> <button class="btn" id="so2">Sign out</button>'); return; }
        const na = document.getElementById("navAdmin"); if (na) na.hidden = false;
        return load();
      }).then(function () { const so = document.getElementById("so2"); if (so) so.onclick = A.signOut; });
    }).catch(function (e) { screen("Error", esc(e.message)); });
  }
  start();
})();
