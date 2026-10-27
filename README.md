# CM Collaborator

Collaborative whiteboard for mentoring, bilingual **EN / PT**, hosted on GitHub Pages,
with **private boards**: only people the administrator invites can open a board.

```
index.html                 Landing page
mentoring/                 "My boards" – sign in + the boards you were invited to
admin/                     Administration – create boards, invite / remove people (admins only)
board/?id=<board-id>       Any board (e.g. board/?id=joaquim-ventura)
database.rules.json        Security rules (THE thing that enforces access)
assets/js/config.js        Firebase config
assets/js/auth.js          Sign-in (Google or passwordless e-mail link)
assets/js/admin.js, hub.js Administration and My boards pages
assets/js/board.js         Whiteboard engine; sync.js live sync; i18n.js EN/PT
```

## Turn on private access (one-time, ~10 minutes)
Without this the site runs in **demo mode** (no sign-in, boards saved only in the browser).

1. **Create the project** – https://console.firebase.google.com → *Add project* (Analytics not needed).
2. **Sign-in** – *Build → Authentication → Get started → Sign-in method*:
   enable **Google** and **Email/Password → Email link (passwordless sign-in)**.
   Then *Settings → Authorized domains → Add domain*: `camjr1985.github.io`.
3. **Database** – *Build → Realtime Database → Create database* (location europe-west1, start in **locked mode**).
   *Rules* tab: replace everything with the content of `database.rules.json` → **Publish**.
4. **Make yourself admin** – Realtime Database → *Data* tab → `+` on the root:
   key `admins`, then inside it a child whose key is **your e-mail with every `.` replaced by `,`**
   (e.g. `john.doe@gmail.com` → `john,doe@gmail,com`) and value `true`.
   Admins can only be added here – nobody can promote themselves from the website.
5. **Connect the site** – *Project settings → Your apps → Web (`</>`)* → register app → copy `firebaseConfig`
   into `assets/js/config.js` as `window.CMCOLLAB_FIREBASE = { ... }` (must include `databaseURL`) and push.

The Firebase web config is public by design; protection comes from the rules in step 3.

## Daily use
- **Administration** (`/admin/`): *New board* → mentee name + e-mail → **Create board & grant access**.
  An invitation message opens: copy it or open it in your e-mail app.
- Add more people to a board (e.g. a co-mentor) with **Can edit** or **View only**; remove access at any time.
- The mentee opens the link, signs in **with the invited e-mail** (Google or e-mail link) and sees only their boards.
- A board filled in demo mode can be moved: on the old board use *Export* (toolbar), then *Import* on the private board.

## Next steps (planned)
Mobile app and billing / licences build on the same model (`admins`, `boards/*/members`, `userBoards`).
