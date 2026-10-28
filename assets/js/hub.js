/* CM Collaborator – "My boards" hub (sign-in + list of boards the person was invited to) */
(function () {
  "use strict";
  const A = window.CMAuth;
  const el = document.getElementById("hub");
  const t = function (s) { return (window.MBt || String)(s); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function initials(n) { return String(n || "?").trim().split(/\s+/).slice(0, 2).map(function (p) { return p[0]; }).join("").toUpperCase(); }

  function boardCard(id, info, badge) {
    return '<a class="card mentee" href="../board/?id=' + encodeURIComponent(id) + '">' +
      '<div class="mentee-top"><span class="av">' + esc(initials(info.mentee || info.title)) + '</span><div style="flex:1;min-width:0">' +
      '<h3 style="margin:0" class="no-i18n">' + esc(info.title || id) + '</h3><div class="muted" style="font-size:14px">' + t("Open the board") + '</div></div>' +
      (badge ? '<span class="status">' + esc(badge) + "</span>" : "") + "</div>" + thumb() +
      '<span class="btn primary" style="align-self:flex-start">Open board</span></a>';
  }
  function thumb() {
    return '<div class="thumb" aria-hidden="true"><i style="left:14px;top:14px;background:#c8eba1"></i><i style="left:42px;top:14px;background:#c8eba1"></i>' +
      '<i style="left:14px;top:46px;background:#f7a8b0"></i><i style="left:14px;top:78px;background:#a9d1f7"></i>' +
      '<span style="position:absolute;left:110px;top:16px;width:70px;height:70px;border-radius:50%;border:6px solid #8cc63f"></span>' +
      '<span style="position:absolute;left:126px;top:32px;width:38px;height:38px;border-radius:50%;border:6px solid #ec4d3c"></span>' +
      '<span style="position:absolute;right:12px;top:12px;width:44px;height:44px;border:1px solid #dcdfe8;background:#fff"></span>' +
      '<span style="position:absolute;right:62px;top:12px;width:44px;height:44px;border:1px solid #dcdfe8;background:#fff"></span>' +
      '<span style="position:absolute;right:12px;top:62px;width:44px;height:44px;border:1px solid #dcdfe8;background:#fff"></span>' +
      '<span style="position:absolute;right:62px;top:62px;width:44px;height:44px;border:1px solid #dcdfe8;background:#fff"></span></div>';
  }

  function demo() {
    el.innerHTML = '<div class="notice"><b>Demo mode.</b> <span>Sign-in and private access switch on as soon as Firebase is configured (see README). Until then, boards are saved only in your browser.</span></div>' +
      '<div class="mentees">' + boardCard("joaquim-ventura", { title: "Joaquim Ventura", mentee: "Joaquim Ventura" }, "Demo") + "</div>";
  }

  function login() {
    el.innerHTML = '<div class="card auth-card"><h2>Sign in</h2><p class="muted">Boards are private. Only people invited by the mentor can open them.</p>' +
      '<button class="btn primary full" id="gBtn"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"/><path fill="currentColor" opacity=".75" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="currentColor" opacity=".55" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z"/><path fill="currentColor" opacity=".9" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6z"/></svg><span>Continue with Google</span></button>' +
      '<div class="or"><span>or</span></div>' +
      '<form id="linkForm"><label class="lbl-f">E-mail<input type="email" id="linkEmail" required placeholder="name@email.com" autocomplete="email"></label>' +
      '<button class="btn full">Send me a sign-in link</button></form><p class="muted small" id="authMsg" role="status"></p></div>';
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
    return '<div class="userbar"><span class="muted"><span>Signed in as</span> <b>' + esc(user.email) + "</b></span>" +
      (admin ? '<a class="btn primary" href="../admin/">Administration</a>' : "") + '<button class="btn" id="soBtn">Sign out</button></div>';
  }

  function wsSection(id, w, admin) {
    const boards = w.boards || {};
    const ids = Object.keys(boards).sort(function (a, b) { return (boards[b].created || 0) - (boards[a].created || 0); });
    return '<section class="ws-sec"><div class="ws-sec-head"><h2 class="no-i18n">' + esc((w.info || {}).name || id) + '</h2><span class="muted small">' + ids.length + " " + t(ids.length === 1 ? "board" : "boards") + "</span></div>" +
      (ids.length ? '<div class="mentees">' + ids.map(function (b) { return boardCard(b, { title: boards[b].title, mentee: boards[b].title }, null); }).join("") + "</div>"
        : '<div class="card empty-big"><p class="muted">' + t(admin ? "No boards in this workspace yet. Create one in Administration." : "No boards in this workspace yet.") + "</p></div>") + "</section>";
  }

  function list(user) {
    const db = A.db();
    A.isAdmin().then(function (admin) {
      const navAdmin = document.getElementById("navAdmin");
      if (admin && navAdmin) navAdmin.hidden = false;
      const p = admin
        ? db.ref("workspaces").once("value").then(function (s) { return s.val() || {}; })
        : db.ref("userWorkspaces/" + A.key(user.email)).once("value").then(function (s) {
          const ids = Object.keys(s.val() || {});
          return Promise.all(ids.map(function (id) {
            return db.ref("workspaces/" + id).once("value").then(function (x) { return [id, x.val()]; }, function () { return [id, null]; });
          })).then(function (rows) { const o = {}; rows.forEach(function (r) { if (r[1]) o[r[0]] = r[1]; }); return o; });
        });
      return p.then(function (wss) {
        const ids = Object.keys(wss).sort(function (a, b) { return ((wss[a].info || {}).name || "").localeCompare((wss[b].info || {}).name || ""); });
        el.innerHTML = userBar(user, admin) + (ids.length
          ? ids.map(function (id) { return wsSection(id, wss[id], admin); }).join("")
          : '<div class="card empty-big"><h3>No boards yet</h3><p class="muted">' + (admin ? t("Create a workspace and its first board in Administration.") : t("Ask your mentor to invite this e-mail address.")) + "</p></div>");
        document.getElementById("soBtn").onclick = A.signOut;
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
