# CM Collaborator

Collaborative whiteboard for mentoring (Miro-style), bilingual **EN / PT**, hosted on GitHub Pages,
with content saved online in **Firebase** (project `cm-collaborator`) and **private workspaces**:
only people the administrator invites can open them.

```
index.html                 Landing page
mentoring/                 "My boards" – sign in, see your workspaces and boards
admin/                     Administration – workspaces, boards, people (admins only)
board/?id=<board-id>       Any board (e.g. board/?id=joaquim-ventura)
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
1. **Administration → New workspace** (e.g. "Mentoring – Joaquim").
2. In the workspace: **New board** (name + template: Persona Map, MoSCoW or Blank).
3. **Grant access**: name + e-mail + *Can edit* / *View only* → an invitation message opens (copy or e-mail).
4. The person opens the site, signs in **with the invited e-mail** and sees only their workspaces.

Tip: one workspace per mentee keeps each mentee's boards private from the others.

## Board – Miro-style
Click to select and drag · type to edit (or click again) · drag on empty board = selection box · Shift+click ·
Space/H to pan · Ctrl+scroll / pinch to zoom · Alt+drag duplicate · Ctrl+C / Ctrl+V (also images and text from
other apps) · drag & drop images · text tool (T) · post-it tool (N) · comments · dot voting · RICE · timer ·
live cursors · undo / redo · export / import · print to PDF.

## Add another administrator
Firebase console → Realtime Database → Data → `admins` → add child `<e-mail with , instead of .>` = `true`.
