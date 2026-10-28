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
