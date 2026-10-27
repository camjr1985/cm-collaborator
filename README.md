# CM Collaborator

Collaborative whiteboard for mentoring (Miro-style), bilingual **EN / PT**, ready for GitHub Pages.

```
index.html                         Landing page (features, journey, licensing)
mentoring/index.html               Mentees list
mentoring/joaquim-ventura/         Joaquim Ventura's board (Persona Map + Priority Map)
assets/css/                        site.css, board.css
assets/js/config.js                Firebase config (real-time collaboration) + votes per user
assets/js/i18n.js                  EN/PT translations
assets/js/sync.js                  Local / Firebase sync
assets/js/board.js                 Whiteboard engine
assets/js/templates/persona.js     Persona Map + Priority Map template
```

## Publish on GitHub Pages
1. Create a repository (e.g. `cmcollab`) and upload all files in this folder (including `.nojekyll`).
2. Settings → Pages → Source: *Deploy from a branch* → `main` / root → Save.
3. After ~1 minute the site is at `https://<your-user>.github.io/cmcollab/`.

## Turn on real-time collaboration (live sync, cursors, presence)
GitHub Pages only serves static files, so multi-user sync uses Firebase Realtime Database (free plan).
1. https://console.firebase.google.com → Add project.
2. Build → Realtime Database → Create database (choose europe-west1).
3. Project settings → Your apps → Web (`</>`) → copy `firebaseConfig`.
4. Paste it into `assets/js/config.js` (`window.CMCOLLAB_FIREBASE = {...}`) and push.
5. Rules (Realtime Database → Rules) – starting point:
   ```json
   { "rules": { "boards": { "$board": { ".read": true, ".write": true } } } }
   ```
   This lets anyone with the link edit. Before charging licences, add Firebase Authentication
   and restrict each board to its mentor and mentee.

Without Firebase the board runs in **Local** mode: saved in the browser, synced live between tabs,
and boards can be exchanged with Export / Import (JSON).

## Add a mentee
1. Copy `mentoring/joaquim-ventura/` to e.g. `mentoring/maria-silva/`.
2. In its `index.html` change `id`, `title`, `defaults.name` and the last breadcrumb.
3. Add a card for them in `mentoring/index.html`.

## Board features
Post-its (double-click to add, colour by area), drag / resize, inline editing, photos (avatar and family),
editable Name / Role / City, Skills Profile rings, MoSCoW quadrants, RICE scoring with automatic ranking,
dot voting, comments per post-it, shared timer, live cursors and presence, undo / redo,
export / import JSON, print to PDF, keyboard shortcuts, touch pinch-zoom, EN / PT switch.
