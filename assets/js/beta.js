/* CM Collaborator – beta sign-up page. Requests go to Firebase signups/{email-key} (admins read them). */
(function () {
  "use strict";
  const t = function (s) { return (window.MBt || String)(s); };
  const A = window.CMAuth;
  const box = document.getElementById("joinBox"), f = document.getElementById("joinForm"), err = f.querySelector(".fb-err");
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function done(email, again) {
    box.innerHTML = '<div class="fb-done"><div class="fb-ok">' + (again ? "✓" : "🎉") + "</div><h3>" + esc(t(again ? "You're already on the list" : "You're on the list!")) + "</h3><p>" +
      esc(t(again ? "This e-mail is already registered – we'll be in touch soon." : "We'll send your invitation to")) + (again ? "" : " <b class=\"no-i18n\">" + esc(email) + "</b>. " + esc(t("Check your spam folder too."))) + "</p></div>";
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function fail(msg) { err.textContent = t(msg); err.hidden = false; }
  /* E-mail alert to the admin for each new sign-up (FormSubmit; address set in config.js). Fire-and-forget. */
  const ROLE_NAMES = { ux: "UX", ui: "UI", designer: "Designer", architect: "Arquiteto(a)", pm: "Gestor(a) de projeto (GP)", process: "Analista de processos", other: "Outro" };
  function notify(d) {
    const to = window.CMCOLLAB_NOTIFY;
    if (!to || !(A && A.enabled)) return;
    try {
      fetch("https://formsubmit.co/ajax/" + to, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          _subject: "Nova inscrição no beta CM Collaborator: " + d.name,
          _template: "table", _captcha: "false",
          "Nome": d.name, "E-mail": d.email, "Função": ROLE_NAMES[d.role] || d.role,
          "Origem": d.src, "Idioma": d.lang,
          "Dar acesso": new URL("../admin/#signups", location.href).href
        })
      }).catch(function () { /* ignore */ });
    } catch (x) { /* ignore */ }
  }
  f.onsubmit = function (e) {
    e.preventDefault();
    err.hidden = true;
    const name = f.name.value.trim(), email = f.email.value.trim().toLowerCase();
    const roleEl = f.querySelector('input[name="role"]:checked');
    if (f.website.value) return done(email || "", false); // bot trap
    if (name.length < 2) return fail("Please enter your full name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("Please enter a valid e-mail.");
    if (!roleEl) return fail("Please choose your role.");
    if (!f.consent.checked) return fail("Please accept to be contacted about the beta.");
    const q = new URLSearchParams(location.search);
    const data = { name: name, email: email, role: roleEl.value, consent: true, lang: window.MB_LANG || "en", src: (q.get("utm_source") || q.get("src") || document.referrer.split("/")[2] || "direct").slice(0, 60) };
    const btn = f.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = t("Sending…");
    let p;
    if (A && A.enabled) {
      p = A.ready().then(function () {
        data.t = window.firebase.database.ServerValue.TIMESTAMP;
        return A.db().ref("signups/" + A.key(email)).set(data);
      });
    } else {
      data.t = Date.now();
      let list = [];
      try { list = JSON.parse(localStorage.getItem("cmcollab:signups")) || []; } catch (x) { list = []; }
      if (list.some(function (s) { return s.email === email; })) p = Promise.reject({ code: "PERMISSION_DENIED" });
      else { list.push(data); try { localStorage.setItem("cmcollab:signups", JSON.stringify(list)); } catch (x) { /* ignore */ } p = Promise.resolve(); }
    }
    p.then(function () { notify(data); done(email, false); }, function (x) {
      const denied = x && (x.code === "PERMISSION_DENIED" || /permission/i.test(x.message || ""));
      if (denied) return done(email, true);
      btn.disabled = false; btn.textContent = t("Request my access");
      fail("Could not send – please try again.");
    });
  };
})();
