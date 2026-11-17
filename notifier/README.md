# CM Collaborator – e-mail notifier (free)

Automatic welcome e-mails sent **by the platform** (the sender name is the product name in `window.CMCOLLAB_BRAND`, so a rename needs no change here), not from a personal mailbox.
It is a Google Apps Script web app that runs under a dedicated Google account of the platform. Free quota: about 100 e-mails per day.

## Setup (once, about 5 minutes)
1. Use the company's dedicated Google account (Digital Agile Technology), not a personal one.
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

## Prospecting e-mail (commercial test invitation, pt-BR)
- Request `kind: "prospect"` – same security as the welcome e-mail (Firebase token, admin or workspace owner, recipient must be a member). Expired members are skipped.
- Content is built in `prospect()` from the database only: member name and e-mail, workspace name and `expires` (validity date). The product name comes from `window.CMCOLLAB_BRAND`. Optional `variant: "b"` uses the alternative subject (A/B test).
- Includes the LGPD opt-out line ("responder remover"). Replies go to the platform account.
- Admin flow: create one workspace per company (option "Prospecção" in New workspace, 14 days by default) → **Grant access** with "Tipo de e-mail: Prospecção comercial" → the access is saved first, then a confirmation, then the e-mail. **✉ Prospecção** on a member sends it by hand. Members get `prospected: timestamp`.
- `testProspectToMe()` in the editor sends a sample to the platform account itself.
