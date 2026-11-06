# CM Collaborator – e-mail notifier (free)

Automatic welcome e-mails sent **by the platform** (sender name "CM Collaborator"), not from a personal mailbox.
It is a Google Apps Script web app that runs under a dedicated Google account of the platform. Free quota: about 100 e-mails per day.

## Setup (once, about 5 minutes)
1. Create (or use) a dedicated Google account for the platform, e.g. `cm.collaborator.app@gmail.com`.
2. Signed in with that account, open https://script.google.com → **New project** → name it `CM Collaborator notifier`.
3. Replace the contents of `Code.gs` with this folder's `Code.gs` → **Save**.
4. Select the function `testToMe` → **Run** → authorise. You receive a sample welcome e-mail in that account.
5. **Deploy → New deployment → type: Web app**. Execute as: **Me**. Who has access: **Anyone**. Then click **Deploy**.
6. Copy the URL ending in `/exec` and set it in `assets/js/config.js`:
   `window.CMCOLLAB_MAILER = "https://script.google.com/macros/s/…/exec";`

## What triggers an e-mail
- **Grant access** in Admin: a person, a sign-up request or "give access to all" sends a welcome e-mail automatically. The Firebase sign-in link is also sent, as before.
- **✉ Welcome** on a member, or **Send welcome to all** on a workspace, sends it again by hand. Members who already received it show "✓ Welcome".

## Security
- The script checks the caller's Firebase ID token.
- It confirms that the caller is an admin or the workspace owner.
- It sends only to people who really are members of that workspace.
- The e-mail text is built in the script, so the endpoint cannot be used to send arbitrary messages.
