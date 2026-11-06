/*
 * CM Collaborator configuration
 * -------------------------------------------------------------
 * Real-time multi-user collaboration (live sync, live cursors,
 * presence) needs a backend, because GitHub Pages only serves
 * static files. CM Collaborator uses Firebase Realtime Database
 * (free "Spark" plan is enough to start).
 *
 * 1. Create a project at https://console.firebase.google.com
 * 2. Build > Realtime Database > Create database
 * 3. Project settings > Your apps > Web app > copy the config
 * 4. Paste it below (replace null with the object).
 *
 * While this stays null, boards run in LOCAL mode: everything is
 * saved in the browser and syncs live between tabs of the same
 * browser. Export / Import JSON lets you exchange boards.
 */
window.CMCOLLAB_FIREBASE = {
  apiKey: "AIzaSyCd46gn1BXzMEq1JNbjcQ9WTCUa7fvjcNg",
  authDomain: "cm-collaborator.firebaseapp.com",
  databaseURL: "https://cm-collaborator-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "cm-collaborator",
  storageBucket: "cm-collaborator.firebasestorage.app",
  messagingSenderId: "527728682427",
  appId: "1:527728682427:web:ba9b9781aa4c6b6021d09e"
};
/* This web config is public by design. Access is enforced by database.rules.json in the Firebase console. */

/* Example:
window.CMCOLLAB_FIREBASE = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "your-project",
  appId: "1:123:web:abc"
};
*/

/* Dot-voting: how many votes each participant gets per board */
window.CMCOLLAB_VOTES_PER_USER = 5;
/* E-mail that receives an alert for each new beta sign-up (via formsubmit.co). Empty string = no alerts. */
window.CMCOLLAB_NOTIFY = "carlosalexandrejunior@gmail.com";
/* Product name shown in the interface – change here when the system is renamed. */
/* Platform e-mail notifier (Google Apps Script web app under the platform account – see notifier/README.md). Empty = off. */
window.CMCOLLAB_MAILER = "https://script.google.com/macros/s/AKfycbzwjTYTJqWeThRA-2guI4E_uNTIF6eKv-0qc_-WikxwbBIYaxlZ3ygh4ZDLczIRmNI/exec";
window.CMCOLLAB_BRAND = "CM Collaborator";
/* Embedded AI (Firebase AI Logic · Gemini Developer API, protected by App Check / reCAPTCHA Enterprise). */
window.CMCOLLAB_AI = {
  sdk: "12.19.0",
  models: ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"],
  recaptchaKey: "6Ld0ghAuAAAAAJWR24GvK5vExkmQPAg184s0obUr",
  dailyLimit: { free: 10, pro: 100, team: 300, enterprise: 1000, admin: 1000 }
};

/* "NEW" badges for recently launched features.
 * To announce a new module, add one line: id: "YYYY-MM-DD" (launch date).
 * The badge shows for NEW_DAYS after launch and disappears for each person as soon as they use the feature. */
window.CMCOLLAB_NEW_DAYS = 30;
window.CMCOLLAB_NEW = {
  planning: "2026-11-06",      // Planning module (roadmap, Waterfall, Scrum, Kanban, OKRs, alerts)
  okr: "2026-11-06",           // OKRs inside Planning
  alerts: "2026-11-06",        // e-mail alerts for milestones and key activities
  integrations: "2026-11-06",  // Jira, Azure DevOps and Kanbanize integrations
  ai: "2026-11-05"             // ✨ AI assistant on boards
};
(function () {
  function seenKey(id) { return "cmcollab:seen:" + id; }
  window.CMIsNew = function (id) {
    const d = (window.CMCOLLAB_NEW || {})[id]; if (!d) return false;
    const age = (Date.now() - Date.parse(d + "T00:00:00Z")) / 86400000;
    if (age < 0 || age > (window.CMCOLLAB_NEW_DAYS || 30)) return false;
    try { return !localStorage.getItem(seenKey(id)); } catch (e) { return true; }
  };
  window.CMNewBadge = function (id, extra) {
    if (!window.CMIsNew(id)) return "";
    const pt = (function () { try { return (localStorage.getItem("cmcollab:lang") || navigator.language || "").toLowerCase().indexOf("pt") === 0; } catch (e) { return false; } })();
    return '<span class="new-badge' + (extra ? " " + extra : "") + '" data-new-id="' + id + '">' + (pt ? "NOVO" : "NEW") + "</span>";
  };
  window.CMMarkSeen = function (id) {
    try { localStorage.setItem(seenKey(id), String(Date.now())); } catch (e) { /* ignore */ }
    document.querySelectorAll('.new-badge[data-new-id="' + id + '"]').forEach(function (b) { b.remove(); });
  };
})();
