# CM Collaborator

Collaborative whiteboard for mentoring (Miro-style), bilingual **EN / PT**, hosted on GitHub Pages,
with content saved online in **Firebase** (project `cm-collaborator`) and **private workspaces**:
only people the administrator invites can open them.

```
index.html                 Landing page
workspaces/                "My workspaces" – sign in, see your workspaces and boards (mentoring/ redirects here)
admin/                     Administration – workspaces, boards, people (admins only)
board/?id=<board-id>       Any board (e.g. board/?id=persona-ana)
feedback/                  Feedback form for testers (answers visible only to admins)
database.rules.json        Security rules (published in the Firebase console – this is what enforces access)
assets/js/config.js        Firebase web config (public by design)
assets/js/auth.js          Sign-in (Google or passwordless e-mail link)
assets/js/admin.js         Administration
assets/js/hub.js           My boards
assets/js/board.js         Whiteboard engine; sync.js live sync; i18n.js EN/PT
assets/js/templates/       persona.js (Persona Map + Priority Map), basic.js (MoSCoW, Blank)
```

## Data model (Realtime Database)
```
admins/<email,with,commas>: true                 who is administrator (edit only in the Firebase console)
workspaces/<ws>/info {name}                      a workspace
workspaces/<ws>/members/<email> {role}           people with access: editor | viewer
workspaces/<ws>/boards/<board> {title,template}  boards in the workspace
userWorkspaces/<email>/<ws>: true                index for "My boards"
boards/<board>/info {title, ws, template}
boards/<board>/data/{stickies, images, fields, photos, meta}   board content (auto-saved)
```

## Daily use
1. **Administration → New workspace** (e.g. "Mentoring 2026").
2. In the workspace: **New board** (name + template: Persona Map, MoSCoW or Blank).
3. **Grant access**: name + e-mail + *Can edit* / *View only* + *Temporary* or *Full access* → the sign-in link is e-mailed automatically (Firebase Auth). "Resend invite" sends it again and shows a personal message to copy.
4. The person opens the site, signs in **with the invited e-mail** and sees only their workspaces.

Tip: one workspace per mentee keeps each mentee's boards private from the others.

## Board – Miro-style
Click to select and drag · type to edit (or click again) · drag on empty board = selection box · Shift+click ·
Space/H to pan · Ctrl+scroll / pinch to zoom · Alt+drag duplicate · Ctrl+C / Ctrl+V (also images and text from
other apps) · drag & drop images · text tool (T) · post-it tool (N) · comments · dot voting · RICE · timer ·
live cursors · undo / redo · export / import · print to PDF.

## Add another administrator
Firebase console → Realtime Database → Data → `admins` → add child `<e-mail with , instead of .>` = `true`.

## Beta testers (7-day access) and feedback
- Administration → New workspace → access period **7 days**. Everyone invited to it gets access that
  closes automatically after 7 days (enforced by the security rules). Use **+7 days** to extend or **Remove limit**.
- The invitation message includes the end date and the feedback link (`/feedback/`).
- Testers can answer the form from the **📣 Feedback** button on any board, from "My boards" or at `/feedback/`.
- Results: Administration → **Tester feedback** (responses, satisfaction, ease of use, NPS, roles, features) → **Export CSV**.

## Beta launch page (hidden)
- `beta/` is a one-page launch site with a sign-up form (full name, e-mail, role). It is **not linked** in the
  navigation – share the link directly: `https://camjr1985.github.io/cm-collaborator/beta/` (`?lang=pt` for Portuguese).
- Sign-ups are stored in `signups/<e-mail>` (one per e-mail; anyone can create, only admins can read).
- Administration → **Beta sign-ups**: choose the workspace, **Give 7-day access** per person or **Invite all pending**
  (opens an e-mail with everyone in BCC), **Export CSV**.

## Plans, customers and the app
- **Anyone can sign in** (Google or e-mail link) and gets the **Free** plan: 1 own workspace, 3 boards, 2 invited people.
  They create workspaces from "My workspaces" and manage people at `admin/` (owner view – only their own workspaces).
- **Administrator → Plans & licences**: give a customer `Pro`, `Team` or `Enterprise`, number of seats and end date
  (stored in `plans/<e-mail>`; only admins can write it). Limits live in `assets/js/plans.js`.
- **Pricing page**: `pricing/` (USD). Checkout buttons currently e-mail the request; they will open Paddle / app-store checkout.
- **Installable app (PWA)**: `manifest.webmanifest` + `sw.js` – "Add to Home screen" on Android/iPhone.
