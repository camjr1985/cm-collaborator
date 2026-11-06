/**
 * CM Collaborator – automatic e-mail notifier (free, Google Apps Script).
 *
 * Runs under the company's DEDICATED Google account (Digital Agile Technology), so e-mails go out
 * with the product name as sender – never from a personal mailbox. The product name comes from the
 * site (window.CMCOLLAB_BRAND), so renaming the product needs no change here.
 * Free quota: ~100 recipients/day on a consumer Google account.
 *
 * Security: the site sends the signed-in user's Firebase ID token. This script
 *  1) validates the token with Firebase Auth,
 *  2) checks in the Realtime Database (with the user's own token) that the caller is an admin
 *     or the workspace owner, and that the recipient really is a member of that workspace.
 * The e-mail content is built here, so the endpoint cannot be used to send arbitrary messages.
 *
 * Deploy: Deploy → New deployment → Web app → Execute as: Me · Who has access: Anyone.
 * Copy the /exec URL into assets/js/config.js → window.CMCOLLAB_MAILER.
 */
var CFG = {
  brand: "CM Collaborator",          // fallback only – the site sends its current product name
  company: "Digital Agile Technology",
  apiKey: "AIzaSyCd46gn1BXzMEq1JNbjcQ9WTCUa7fvjcNg",
  db: "https://cm-collaborator-default-rtdb.europe-west1.firebasedatabase.app",
  site: "https://camjr1985.github.io/cm-collaborator/",
  replyTo: "",            // optional: address that receives replies (leave empty to keep this account)
  maxPerCall: 25
};

function doGet() { return json({ ok: true, service: CFG.brand + " notifier", quota: MailApp.getRemainingDailyQuota() }); }

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents || "{}");
    var brand = String(req.brand || "").replace(/[^\w À-ÿ&.·-]/g, "").trim().slice(0, 40) || CFG.brand;
    var who = verify(req.idToken);
    var wsId = String(req.ws || "");
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(wsId)) throw new Error("bad workspace");
    var info = get("workspaces/" + wsId + "/info", req.idToken) || {};
    info.boards = get("workspaces/" + wsId + "/boards", req.idToken) || {};
    var isAdmin = get("admins/" + key(who.email), req.idToken) === true;
    if (!isAdmin && info.owner !== key(who.email)) throw new Error("not allowed");
    var list = [].concat(req.to || []).slice(0, CFG.maxPerCall);
    var sent = [], skipped = [];
    list.forEach(function (to) {
      to = String(to).toLowerCase();
      var m = get("workspaces/" + wsId + "/members/" + key(to), req.idToken);
      if (!m) { skipped.push(to); return; }
      var mail = welcome(m, info, req.lang === "en" ? "en" : "pt", brand);
      var opt = { name: brand, htmlBody: mail.html };
      if (CFG.replyTo) opt.replyTo = CFG.replyTo;
      MailApp.sendEmail(m.email, mail.subject, mail.text, opt);
      sent.push(to);
    });
    return json({ ok: true, sent: sent, skipped: skipped, quota: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function verify(idToken) {
  if (!idToken) throw new Error("no token");
  var r = UrlFetchApp.fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + CFG.apiKey,
    { method: "post", contentType: "application/json", payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true });
  var u = (JSON.parse(r.getContentText()).users || [])[0];
  if (!u || !u.email || !u.emailVerified) throw new Error("invalid token");
  return u;
}
function get(path, idToken) {
  var r = UrlFetchApp.fetch(CFG.db + "/" + path + ".json?auth=" + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return null;
  return JSON.parse(r.getContentText());
}
function key(email) { return String(email).toLowerCase().replace(/\./g, ","); }
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

function welcome(m, info, lang, brand) {
  brand = brand || CFG.brand;
  var w0 = brand.split(/\s+/)[0], mark = (w0.length <= 3 ? w0 : brand.split(/\s+/).map(function (w) { return w[0]; }).join("").slice(0, 2)).toUpperCase();
  var pt = lang === "pt", first = String(m.name || "").split(" ")[0] || "";
  var hub = CFG.site + "workspaces/", fb = CFG.site + "feedback/", guide = CFG.site + "beta/CM-Collaborator-Boas-vindas.pdf";
  var until = m.expires ? Utilities.formatDate(new Date(m.expires), "Europe/Lisbon", "dd/MM/yyyy") : "";
  var wsName = info.name || "";
  var bl = Object.keys(info.boards || {}).sort().map(function (k) { return { k: k, t: (info.boards[k] && info.boards[k].title) || k }; });
  var sb = bl.filter(function (b) { return /comece|start here|^1[-\s·]/i.test(b.k + " " + b.t); })[0] || bl[0];
  var tour = sb && /comece|start here/i.test(sb.k + " " + sb.t);
  var L = pt ? {
    subject: "Bem-vindo(a) ao " + brand + " – o seu acesso está ativo ✨",
    hi: "Olá" + (first ? " " + first : "") + ",",
    intro: "O seu acesso ao workspace <b>“" + esc(wsName) + "”</b> no " + brand + " já está ativo! 🎉",
    until: until ? "O seu acesso de teste é válido até <b>" + until + "</b>." : "O seu acesso não tem prazo de validade.",
    how: "Como entrar",
    s1: "Abra <a href=\"" + hub + "\">" + hub.replace("https://", "") + "</a>",
    s2: "Entre com <b>este mesmo e-mail</b> (" + esc(m.email) + ") – botão Google ou link de acesso por e-mail.",
    s3: sb ? "Abra o workspace e comece pelo quadro <b>“" + esc(sb.t) + "”</b>" + (tour ? ": missões curtas que mostram tudo." : ".") : "Abra o workspace <b>“" + esc(wsName) + "”</b> para ver os quadros partilhados consigo.",
    aiT: "Novidade ✨ – Assistente IA nos quadros",
    ai: ["<b>Construir um quadro</b> a partir do seu objetivo (frames, instruções e agenda);", "<b>Sugerir dinâmicas</b> para o grupo, com passos e tempos;", "<b>Analisar os resultados</b> depois da sessão: temas, prioridades e plano de ações."],
    aiH: "Clique no botão ✨ da barra de ferramentas do quadro.",
    guide: "One-page de boas-vindas – passo a passo, atalhos e dicas (PDF)",
    fb: "Antes de o acesso terminar, pedimos só <b>3 minutos de feedback</b>: <a href=\"" + fb + "\">dar feedback</a>.",
    cta: "Abrir os meus quadros",
    bye: "Atenciosamente,<br><b>Carlos Alexandre</b><br>CEO · " + CFG.company,
    auto: "Mensagem automática do " + brand + " · " + CFG.company + ". Recebeu este e-mail porque foi convidado(a) para um workspace."
  } : {
    subject: "Welcome to " + brand + " – your access is active ✨",
    hi: "Hi" + (first ? " " + first : "") + ",",
    intro: "Your access to the workspace <b>“" + esc(wsName) + "”</b> on " + brand + " is now active! 🎉",
    until: until ? "Your test access is valid until <b>" + until + "</b>." : "Your access has no end date.",
    how: "How to sign in",
    s1: "Open <a href=\"" + hub + "\">" + hub.replace("https://", "") + "</a>",
    s2: "Sign in with <b>this same e-mail</b> (" + esc(m.email) + ") – Google button or e-mail sign-in link.",
    s3: sb ? "Open the workspace and start with the board <b>“" + esc(sb.t) + "”</b>" + (tour ? ": short missions that show everything." : ".") : "Open the workspace <b>“" + esc(wsName) + "”</b> to see the boards shared with you.",
    aiT: "New ✨ – AI assistant on the boards",
    ai: ["<b>Build a board</b> from your goal (frames, instructions and agenda);", "<b>Suggest dynamics</b> for your group, with steps and timings;", "<b>Analyse the results</b> after the session: themes, priorities and action plan."],
    aiH: "Click the ✨ button on the board toolbar.",
    guide: "Welcome one-page – step by step, shortcuts and tips (PDF)",
    fb: "Before your access ends, please give us <b>3 minutes of feedback</b>: <a href=\"" + fb + "\">give feedback</a>.",
    cta: "Open my boards",
    bye: "Kind regards,<br><b>Carlos Alexandre</b><br>CEO · " + CFG.company,
    auto: "Automatic message from " + brand + " · " + CFG.company + ". You received it because you were invited to a workspace."
  };
  var html =
    '<div style="background:#f3f5f9;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e7ef">' +
    '<div style="background:#0e1a33;padding:22px 24px;color:#ffffff"><span style="display:inline-block;background:#2cc4b3;color:#0e1a33;font-weight:bold;border-radius:8px;padding:6px 8px;font-size:13px">' + esc(mark) + '</span>' +
    ' <span style="font-size:18px;font-weight:bold;vertical-align:middle">' + esc(brand) + '</span></div>' +
    '<div style="padding:24px;color:#1d2433;font-size:15px;line-height:1.55">' +
    "<p>" + L.hi + "</p><p>" + L.intro + "</p><p>" + L.until + "</p>" +
    '<h3 style="margin:18px 0 6px;font-size:16px">' + L.how + "</h3><ol style=\"padding-left:20px;margin:0\"><li>" + L.s1 + "</li><li>" + L.s2 + "</li><li>" + L.s3 + "</li></ol>" +
    '<p style="text-align:center;margin:22px 0"><a href="' + hub + '" style="background:#e8c468;color:#0e1a33;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px;display:inline-block">' + L.cta + " →</a></p>" +
    '<div style="background:#fff8e6;border:1px solid #f0dca4;border-radius:12px;padding:14px 16px"><b>' + L.aiT + '</b><ul style="padding-left:18px;margin:8px 0">' + L.ai.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul>" + L.aiH + "</div>" +
    '<p style="background:#eef6ff;border:1px solid #cfe0f5;border-radius:12px;padding:12px 16px">📄 <a href="' + guide + '" style="font-weight:bold">' + L.guide + "</a></p><p>" + L.fb + "</p><p>" + L.bye + "</p></div>" +
    '<div style="padding:14px 24px;background:#f7f8fb;color:#7a8499;font-size:12px">' + L.auto + "</div></div></div>";
  var text = html.replace(/<li>/g, "\n- ").replace(/<br>|<\/p>|<\/h3>|<\/div>|<\/ol>|<\/ul>/g, "\n").replace(/<a href="([^"]+)"[^>]*>([^<]*)<\/a>/g, "$2 ($1)").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();
  return { subject: L.subject, html: html, text: text };
}

/* Run once from the editor to authorise MailApp/UrlFetch and test the template. */
function testToMe() {
  var me = Session.getActiveUser().getEmail();
  var mail = welcome({ email: me, name: "Teste", expires: Date.now() + 7 * 864e5 }, { name: "Design & UX – Beta test" }, "pt");
  MailApp.sendEmail(me, mail.subject, mail.text, { name: CFG.brand, htmlBody: mail.html });
}
