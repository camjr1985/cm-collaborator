/*
 * CM Collaborator – feedback form (shared by the board, "My boards" and /feedback/).
 * Answers are stored in Firebase at feedback/{pushId} (only admins can read them).
 * In demo mode (no Firebase) answers stay in this browser.
 *
 * MBFeedback.render(container, { board, onDone })
 * MBFeedback.QUESTIONS – used by the admin report
 */
(function () {
  "use strict";
  const t = function (s) { return (window.MBt || String)(s); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  const ROLES = [["designer", "Designer"], ["ux", "UX"], ["ui", "UI"], ["architect", "Architect"], ["pm", "Product / Project manager"], ["other", "Other"]];
  const FEATURES = [["templates", "Templates"], ["sticky", "Post-its"], ["frames", "Frames"], ["shapes", "Shapes & connectors"], ["media", "Images, GIFs & icons"], ["comments", "Comments & voting"], ["timer", "Timer"], ["collab", "Real-time collaboration"]];

  function scale(name, from, to, low, high) {
    let h = '<div class="fb-scale" role="radiogroup">';
    for (let i = from; i <= to; i++) h += '<label><input type="radio" name="' + name + '" value="' + i + '" required><span>' + i + "</span></label>";
    return h + '</div><div class="fb-ends"><span>' + esc(t(low)) + "</span><span>" + esc(t(high)) + "</span></div>";
  }

  function html() {
    return '<form class="fb-form" novalidate>' +
      '<div class="fb-q"><div class="fb-l">' + esc(t("What best describes your role?")) + '</div><div class="fb-chips">' +
      ROLES.map(function (r) { return '<label class="chip"><input type="radio" name="role" value="' + r[0] + '" required><span>' + esc(t(r[1])) + "</span></label>"; }).join("") + "</div></div>" +
      '<div class="fb-q"><div class="fb-l"><b>1.</b> ' + esc(t("Overall, how satisfied are you with CM Collaborator?")) + "</div>" + scale("sat", 1, 5, "Not satisfied", "Very satisfied") + "</div>" +
      '<div class="fb-q"><div class="fb-l"><b>2.</b> ' + esc(t("How easy was it to create and organise content on the board?")) + "</div>" + scale("ease", 1, 5, "Very hard", "Very easy") + "</div>" +
      '<div class="fb-q"><div class="fb-l"><b>3.</b> ' + esc(t("How likely are you to recommend CM Collaborator to a colleague?")) + "</div>" + scale("nps", 0, 10, "Not at all likely", "Extremely likely") + "</div>" +
      '<div class="fb-q"><div class="fb-l"><b>4.</b> ' + esc(t("Which features did you try?")) + '</div><div class="fb-chips">' +
      FEATURES.map(function (f) { return '<label class="chip"><input type="checkbox" name="feat" value="' + f[0] + '"><span>' + esc(t(f[1])) + "</span></label>"; }).join("") + "</div></div>" +
      '<div class="fb-q"><label class="fb-l" for="fbPain"><b>5.</b> ' + esc(t("What was the biggest difficulty, bug or missing feature?")) + '</label><textarea id="fbPain" name="pain" rows="3" maxlength="4000"></textarea></div>' +
      '<div class="fb-q"><label class="fb-l" for="fbIdeas">💡 ' + esc(t("Suggestions for improvement")) + '</label><textarea id="fbIdeas" name="ideas" rows="3" maxlength="4000" placeholder="' + esc(t("What would make CM Collaborator better for your work?")) + '"></textarea></div>' +
      '<p class="fb-err" role="alert" hidden></p>' +
      '<div class="fb-actions"><button class="btn primary" type="submit">' + esc(t("Send feedback")) + "</button></div></form>";
  }

  function collect(f) {
    const val = function (n) { const x = f.querySelector('input[name="' + n + '"]:checked'); return x ? x.value : null; };
    const feats = {};
    f.querySelectorAll('input[name="feat"]:checked').forEach(function (x) { feats[x.value] = true; });
    return { role: val("role"), sat: val("sat") && Number(val("sat")), ease: val("ease") && Number(val("ease")), nps: val("nps") !== null ? Number(val("nps")) : null, features: feats, pain: f.pain.value.trim(), ideas: f.ideas.value.trim() };
  }

  function save(data) {
    const A = window.CMAuth;
    if (A && A.enabled) {
      return A.ready().then(function (user) {
        if (!user) throw new Error(t("Please sign in to send feedback."));
        data.uid = user.uid; data.email = user.email; data.name = user.displayName || "";
        data.t = window.firebase.database.ServerValue.TIMESTAMP;
        return A.db().ref("feedback").push(data);
      });
    }
    data.t = Date.now(); data.uid = "demo";
    let list = [];
    try { list = JSON.parse(localStorage.getItem("cmcollab:feedback")) || []; } catch (e) { list = []; }
    list.push(data);
    try { localStorage.setItem("cmcollab:feedback", JSON.stringify(list)); } catch (e) { /* ignore */ }
    return Promise.resolve();
  }

  function render(container, opts) {
    opts = opts || {};
    container.innerHTML = html();
    const f = container.querySelector("form"), err = f.querySelector(".fb-err");
    f.onsubmit = function (e) {
      e.preventDefault();
      const d = collect(f);
      const missing = !d.role ? "What best describes your role?" : !d.sat ? "Question 1" : !d.ease ? "Question 2" : d.nps === null ? "Question 3" : null;
      if (missing) { err.textContent = t("Please answer:") + " " + t(missing); err.hidden = false; return; }
      err.hidden = true;
      d.board = opts.board || null;
      d.lang = window.MB_LANG || "en";
      const btn = f.querySelector("button[type=submit]");
      btn.disabled = true; btn.textContent = t("Sending…");
      save(d).then(function () {
        try { localStorage.setItem("cmcollab:feedbackSent", String(Date.now())); } catch (x) { /* ignore */ }
        container.innerHTML = '<div class="fb-done"><div class="fb-ok">✓</div><h3>' + esc(t("Thank you for your feedback!")) + "</h3><p>" + esc(t("Your answers help shape the next version of CM Collaborator.")) + "</p></div>";
        if (opts.onDone) opts.onDone();
      }, function (e2) {
        btn.disabled = false; btn.textContent = t("Send feedback");
        err.textContent = (e2 && e2.message) || t("Could not send – please try again."); err.hidden = false;
      });
    };
  }

  window.MBFeedback = { render: render, ROLES: ROLES, FEATURES: FEATURES };
})();
