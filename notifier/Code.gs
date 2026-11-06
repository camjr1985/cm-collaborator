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
    if (req.kind === "assign" || req.kind === "due") return json(planNotify(req, who, brand));
    if (/^jira-/.test(String(req.kind || ""))) return json(jiraHandle(req, who));
    if (/^azure-/.test(String(req.kind || ""))) return json(azureHandle(req, who));
    if (/^kanbanize-/.test(String(req.kind || ""))) return json(kbHandle(req, who));
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
    s3: sb ? "Abra o workspace e comece pelo quadro <b>“" + esc(sb.t) + "”</b>" + (tour ? ": missões curtas que mostram tudo." : ".") : "Abra o workspace <b>“" + esc(wsName) + "”</b> para ver os quadros compartilhados com você.",
    aiT: "Novidade ✨ – Assistente IA nos quadros",
    ai: ["<b>Construir um quadro</b> a partir do seu objetivo (frames, instruções e agenda);", "<b>Sugerir dinâmicas</b> para o grupo, com passos e tempos;", "<b>Analisar os resultados</b> depois da sessão: temas, prioridades e plano de ações."],
    aiH: "Clique no botão ✨ da barra de ferramentas do quadro.",
    guide: "One-page de boas-vindas – passo a passo, atalhos e dicas (PDF)",
    fb: "Antes de o acesso terminar, pedimos só <b>3 minutos de feedback</b>: <a href=\"" + fb + "\">dar feedback</a>.",
    cta: "Abrir meus quadros",
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

/* ---------------- Planning notifications (assignment, deadlines) ---------------- */
function planNotify(req, who, brand) {
  var tok = req.idToken, plan = String(req.plan || "");
  if (!/^[A-Za-z0-9_-]{1,90}$/.test(plan)) throw new Error("bad planning");
  var pinfo = get("planning/" + plan + "/info", tok);
  if (!pinfo || !pinfo.ws) throw new Error("planning not found");
  var wsId = pinfo.ws, winfo = get("workspaces/" + wsId + "/info", tok) || {}, members = get("workspaces/" + wsId + "/members", tok) || {};
  var me = key(who.email), isAdmin = get("admins/" + me, tok) === true, mm = members[me];
  var canEdit = isAdmin || winfo.owner === me || (mm && mm.role === "editor" && (!mm.expires || mm.expires > Date.now()));
  if (!canEdit) throw new Error("not allowed");
  var data = get("planning/" + plan + "/data", tok) || {}, items = data.items || {}, sts = (data.settings || {}).statuses || [];
  var stName = function (id) { for (var i = 0; i < sts.length; i++) if (sts[i].id === id) return sts[i].name; return id || ""; };
  var stCat = function (id) { for (var i = 0; i < sts.length; i++) if (sts[i].id === id) return sts[i].cat; return "todo"; };
  var isMember = function (email) { var m = members[key(email)]; return (m && (!m.expires || m.expires > Date.now())) || key(email) === winfo.owner || (winfo.ownerEmail && winfo.ownerEmail.toLowerCase() === String(email).toLowerCase()); };
  var nameOf = function (email) { var m = members[key(email)]; return (m && m.name) || String(email).split("@")[0]; };
  var pt = req.lang !== "en", link = CFG.site + "planning/?id=" + encodeURIComponent(plan);
  var byName = (members[me] && members[me].name) || who.displayName || String(who.email).split("@")[0];
  var fd = function (s) { return s ? s.split("-").reverse().join("/") : "–"; };
  var sent = [];
  function send(to, subject, introHtml, rows) {
    var table = '<table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">' +
      '<tr style="background:#f3f5f9;text-align:left"><th style="padding:8px">' + (pt ? "Item" : "Item") + '</th><th style="padding:8px">' + (pt ? "Estado" : "Status") + '</th><th style="padding:8px">' + (pt ? "Início" : "Start") + '</th><th style="padding:8px">' + (pt ? "Prazo" : "Due") + "</th></tr>" +
      rows.map(function (r) { return '<tr style="border-top:1px solid #e3e7ef"><td style="padding:8px"><b>' + esc(r.key || "") + "</b> " + esc(r.title) + '</td><td style="padding:8px">' + esc(stName(r.status)) + '</td><td style="padding:8px">' + fd(r.start) + '</td><td style="padding:8px;' + (r.late ? "color:#e5484d;font-weight:bold" : "") + '">' + fd(r.end) + "</td></tr>"; }).join("") + "</table>";
    var html = '<div style="background:#f3f5f9;padding:24px 12px;font-family:Arial,Helvetica,sans-serif"><div style="max-width:620px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e3e7ef">' +
      '<div style="background:#0e1a33;padding:18px 24px;color:#fff;font-size:17px;font-weight:bold">' + esc(brand) + ' · Planning</div><div style="padding:22px 24px;color:#1d2433;font-size:15px;line-height:1.55">' +
      "<p>" + (pt ? "Olá " : "Hi ") + esc(nameOf(to).split(" ")[0]) + ",</p><p>" + introHtml + "</p>" + table +
      '<p style="text-align:center;margin:20px 0"><a href="' + link + '" style="background:#e8c468;color:#0e1a33;text-decoration:none;font-weight:bold;padding:11px 20px;border-radius:10px;display:inline-block">' + (pt ? "Abrir o planejamento" : "Open the planning") + " →</a></p></div>" +
      '<div style="padding:12px 24px;background:#f7f8fb;color:#7a8499;font-size:12px">' + (pt ? "Notificação automática do " : "Automatic notification from ") + esc(brand) + " · " + CFG.company + "</div></div></div>";
    var text = html.replace(/<\/tr>|<\/p>|<br>|<\/div>/g, "\n").replace(/<\/td>|<\/th>/g, "  ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();
    var opt = { name: brand, htmlBody: html }; if (CFG.replyTo) opt.replyTo = CFG.replyTo;
    MailApp.sendEmail(to, subject, text, opt); sent.push(to);
  }
  if (req.kind === "assign") {
    var it = items[String(req.item || "")];
    if (!it || !it.assignee || !isMember(it.assignee)) return { ok: true, sent: [], skipped: ["not a member"] };
    if (String(it.assignee).toLowerCase() === String(who.email).toLowerCase()) return { ok: true, sent: [] };
    send(it.assignee, (pt ? "Atribuído a você: " : "Assigned to you: ") + (it.key ? it.key + " · " : "") + it.title,
      esc(byName) + (pt ? " atribuiu um item a você no planejamento <b>“" : " assigned you an item in the planning <b>“") + esc(pinfo.title) + "”</b>.", [it]);
  } else {
    var today = Utilities.formatDate(new Date(), "Europe/Lisbon", "yyyy-MM-dd"), lim = Utilities.formatDate(new Date(Date.now() + 3 * 864e5), "Europe/Lisbon", "yyyy-MM-dd");
    var per = {};
    Object.keys(items).forEach(function (k) {
      var x = items[k]; if (!x.assignee || !x.end || stCat(x.status) === "done" || x.end > lim) return;
      if (!isMember(x.assignee)) return;
      x.late = x.end < today; (per[x.assignee] = per[x.assignee] || []).push(x);
    });
    Object.keys(per).slice(0, CFG.maxPerCall).forEach(function (to) {
      var list = per[to].sort(function (a, b) { return a.end < b.end ? -1 : 1; }), late = list.filter(function (x) { return x.late; }).length;
      send(to, (pt ? "Prazos no planejamento “" : "Deadlines in the planning “") + pinfo.title + "”" + (late ? (pt ? " – " + late + " em atraso" : " – " + late + " overdue") : ""),
        (pt ? "Estes itens atribuídos a você estão atrasados ou vencem nos próximos 3 dias no planejamento <b>“" : "These items assigned to you are overdue or due in the next 3 days in the planning <b>“") + esc(pinfo.title) + "”</b>.", list);
    });
  }
  return { ok: true, sent: sent, quota: MailApp.getRemainingDailyQuota() };
}

/* ---------------- Jira Cloud integration ----------------
 * The API token is stored only in this script's properties (per workspace), never in the browser or Firebase.
 * Admins / workspace owners connect; editors import and push changes. */
function jiraHandle(req, who) {
  var tok = req.idToken, me = key(who.email), isAdmin = get("admins/" + me, tok) === true, wsId;
  if (req.plan) {
    if (!/^[A-Za-z0-9_-]{1,90}$/.test(String(req.plan))) throw new Error("bad planning");
    var pinfo = get("planning/" + req.plan + "/info", tok); if (!pinfo) throw new Error("planning not found"); wsId = pinfo.ws;
  } else wsId = String(req.ws || "");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(wsId)) throw new Error("bad workspace");
  var winfo = get("workspaces/" + wsId + "/info", tok) || {}, mm = get("workspaces/" + wsId + "/members/" + me, tok);
  var isOwner = isAdmin || winfo.owner === me;
  var isEditor = isOwner || !!(mm && mm.role === "editor" && (!mm.expires || mm.expires > Date.now()));
  var P = PropertiesService.getScriptProperties(), pk = "jira:" + wsId, conn;
  if (req.kind === "jira-connect") {
    if (!isOwner) throw new Error("only the workspace owner or an admin can connect Jira");
    var site = String(req.site || "").trim().replace(/\/+$/, "").toLowerCase();
    if (!/^https:\/\/[a-z0-9-]+\.atlassian\.net$/.test(site)) throw new Error("the site must look like https://your-company.atlassian.net");
    conn = { site: site, email: String(req.email || "").trim(), token: String(req.token || "").trim() };
    if (!conn.email || !conn.token) throw new Error("e-mail and API token are required");
    var acc = jira(conn, "GET", "/rest/api/3/myself");
    conn.by = who.email; conn.at = Date.now();
    P.setProperty(pk, JSON.stringify(conn));
    return { ok: true, site: site, account: acc.displayName || conn.email };
  }
  if (req.kind === "jira-disconnect") {
    if (!isOwner) throw new Error("not allowed");
    P.deleteProperty(pk); return { ok: true };
  }
  var raw = P.getProperty(pk); if (!raw) throw new Error("Jira is not connected for this workspace");
  conn = JSON.parse(raw);
  if (!isEditor) throw new Error("not allowed");
  if (req.kind === "jira-projects") {
    var pr = jira(conn, "GET", "/rest/api/3/project/search?maxResults=100&orderBy=name");
    return { ok: true, site: conn.site, projects: (pr.values || []).map(function (x) { return { key: x.key, name: x.name }; }) };
  }
  var F = jiraFields(conn);
  if (req.kind === "jira-import") {
    var jql = String(req.jql || "").slice(0, 3000); if (!jql) throw new Error("JQL is empty");
    var fields = ["summary", "issuetype", "status", "assignee", "duedate", "parent"];
    if (F.start) fields.push(F.start); if (F.points) fields.push(F.points);
    var out = [], next = null, n = 0, r;
    do {
      var body = { jql: jql, maxResults: 100, fields: fields }; if (next) body.nextPageToken = next;
      r = jira(conn, "POST", "/rest/api/3/search/jql", body);
      (r.issues || []).forEach(function (i) {
        var f = i.fields || {}, it = f.issuetype || {}, st = f.status || {};
        out.push({ key: i.key, title: f.summary || i.key, type: it.name || "", level: it.hierarchyLevel, subtask: !!it.subtask,
          status: st.name || "", cat: (st.statusCategory || {}).key || "new",
          assignee: f.assignee ? (f.assignee.emailAddress || "") : "", assigneeName: f.assignee ? (f.assignee.displayName || "") : "",
          start: F.start ? (f[F.start] || null) : null, due: f.duedate || null, points: F.points ? (f[F.points] == null ? null : f[F.points]) : null,
          parent: f.parent ? f.parent.key : null, url: conn.site + "/browse/" + i.key });
      });
      next = r.nextPageToken; n++;
    } while (next && !r.isLast && n < 10);
    return { ok: true, site: conn.site, issues: out, startField: !!F.start, pointsField: !!F.points };
  }
  if (req.kind === "jira-push") {
    var item = get("planning/" + req.plan + "/data/items/" + String(req.item || ""), tok);
    if (!item || !item.ext || item.ext.source !== "jira" || !item.ext.key) throw new Error("not a Jira item");
    var sts = get("planning/" + req.plan + "/data/settings/statuses", tok) || [], cat = "todo", stName = "";
    sts.forEach(function (x) { if (x.id === item.status) { cat = x.cat; stName = x.name; } });
    var k = encodeURIComponent(item.ext.key), upd = { summary: item.title, duedate: item.end || null };
    if (F.start) upd[F.start] = item.start || null;
    jira(conn, "PUT", "/rest/api/3/issue/" + k, { fields: upd });
    var want = { todo: "new", doing: "indeterminate", done: "done" }[cat] || "new", moved = false;
    var cur = jira(conn, "GET", "/rest/api/3/issue/" + k + "?fields=status").fields.status;
    if ((cur.statusCategory || {}).key !== want || (stName && cur.name.toLowerCase() !== stName.toLowerCase() && (cur.statusCategory || {}).key !== want)) {
      var trs = jira(conn, "GET", "/rest/api/3/issue/" + k + "/transitions").transitions || [], pick = null;
      trs.forEach(function (t) { if (!pick && t.to && stName && t.to.name.toLowerCase() === stName.toLowerCase()) pick = t; });
      trs.forEach(function (t) { if (!pick && t.to && (t.to.statusCategory || {}).key === want) pick = t; });
      if (pick) { jira(conn, "POST", "/rest/api/3/issue/" + k + "/transitions", { transition: { id: pick.id } }); moved = true; }
    }
    return { ok: true, moved: moved };
  }
  throw new Error("unknown action");
}
function jira(conn, method, path, body) {
  var o = { method: method.toLowerCase(), muteHttpExceptions: true, headers: { Authorization: "Basic " + Utilities.base64Encode(conn.email + ":" + conn.token), Accept: "application/json" } };
  if (body) { o.contentType = "application/json"; o.payload = JSON.stringify(body); }
  var r = UrlFetchApp.fetch(conn.site + path, o), c = r.getResponseCode(), t = r.getContentText();
  if (c >= 300) {
    var m = t;
    try { var j = JSON.parse(t); var errs = (j.errorMessages || []).concat(Object.keys(j.errors || {}).map(function (x) { return x + ": " + j.errors[x]; })); if (errs.length) m = errs.join("; "); } catch (e) { /* not JSON */ }
    if (c === 401) m = "invalid e-mail or API token";
    throw new Error("Jira " + c + ": " + String(m).slice(0, 300));
  }
  return t ? JSON.parse(t) : {};
}
function jiraFields(conn) {
  var cache = CacheService.getScriptCache(), ck = "jf:" + conn.site, v = cache.get(ck);
  if (v) return JSON.parse(v);
  var F = {};
  (jira(conn, "GET", "/rest/api/3/field") || []).forEach(function (f) {
    var n = String(f.name || "").toLowerCase();
    if (!F.start && (n === "start date" || n === "data de início" || n === "data de inicio" || n === "data inicial")) F.start = f.id;
    if (!F.points && (n === "story point estimate" || n === "story points" || n === "estimativa de story points" || n === "pontos da história")) F.points = f.id;
  });
  cache.put(ck, JSON.stringify(F), 21600);
  return F;
}

/* ---------------- shared access check for integrations ---------------- */
function integAccess(req, who) {
  var tok = req.idToken, me = key(who.email), isAdmin = get("admins/" + me, tok) === true, wsId;
  if (req.plan) {
    if (!/^[A-Za-z0-9_-]{1,90}$/.test(String(req.plan))) throw new Error("bad planning");
    var pinfo = get("planning/" + req.plan + "/info", tok); if (!pinfo) throw new Error("planning not found"); wsId = pinfo.ws;
  } else wsId = String(req.ws || "");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(wsId)) throw new Error("bad workspace");
  var winfo = get("workspaces/" + wsId + "/info", tok) || {}, mm = get("workspaces/" + wsId + "/members/" + me, tok);
  var isOwner = isAdmin || winfo.owner === me;
  return { tok: tok, wsId: wsId, isOwner: isOwner, isEditor: isOwner || !!(mm && mm.role === "editor" && (!mm.expires || mm.expires > Date.now())) };
}
function integItem(req, acc, source) {
  var item = get("planning/" + req.plan + "/data/items/" + String(req.item || ""), acc.tok);
  if (!item || !item.ext || item.ext.source !== source) throw new Error("not an item from " + source);
  var sts = get("planning/" + req.plan + "/data/settings/statuses", acc.tok) || [], cat = "todo", stName = "";
  sts.forEach(function (x) { if (x.id === item.status) { cat = x.cat; stName = x.name; } });
  return { item: item, cat: cat, stName: stName };
}
function httpJson(url, method, headers, body, ctype) {
  var o = { method: method.toLowerCase(), muteHttpExceptions: true, headers: headers };
  if (body !== undefined) { o.contentType = ctype || "application/json"; o.payload = JSON.stringify(body); }
  var r = UrlFetchApp.fetch(url, o), c = r.getResponseCode(), t = r.getContentText();
  if (c >= 300) {
    var m = t; try { var j = JSON.parse(t); m = j.message || (j.error && (j.error.message || j.error)) || j.errorMessage || t; } catch (e) { /* not JSON */ }
    if (c === 401 || c === 203) m = "invalid credentials";
    throw new Error(c + ": " + String(m).replace(/<[^>]+>/g, " ").slice(0, 300));
  }
  if (c === 203) throw new Error("invalid credentials");
  try { return t ? JSON.parse(t) : {}; } catch (e) { throw new Error("unexpected response (check the URL and credentials)"); }
}

/* ---------------- Azure DevOps Boards ----------------
 * Connection: organisation URL (https://dev.azure.com/<org>) + Personal Access Token (Work Items read & write). */
function azureHandle(req, who) {
  var acc = integAccess(req, who), P = PropertiesService.getScriptProperties(), pk = "azure:" + acc.wsId, conn;
  function az(method, path, body, ctype) {
    return httpJson(conn.org + path, method, { Authorization: "Basic " + Utilities.base64Encode(":" + conn.pat), Accept: "application/json" }, body, ctype);
  }
  if (req.kind === "azure-connect") {
    if (!acc.isOwner) throw new Error("only the workspace owner or an admin can connect Azure DevOps");
    var org = String(req.org || "").trim().replace(/\/+$/, "");
    var m = org.match(/^https:\/\/dev\.azure\.com\/([A-Za-z0-9._-]+)$/i) || org.match(/^https:\/\/([A-Za-z0-9-]+)\.visualstudio\.com$/i);
    if (!m) throw new Error("the organisation URL must look like https://dev.azure.com/your-org");
    conn = { org: org, pat: String(req.pat || "").trim() };
    if (!conn.pat) throw new Error("the Personal Access Token is required");
    var pr = az("GET", "/_apis/projects?api-version=7.1&$top=1");
    conn.by = who.email; conn.at = Date.now(); P.setProperty(pk, JSON.stringify(conn));
    return { ok: true, site: org, account: m[1], projects: pr.count };
  }
  if (req.kind === "azure-disconnect") { if (!acc.isOwner) throw new Error("not allowed"); P.deleteProperty(pk); return { ok: true }; }
  var raw = P.getProperty(pk); if (!raw) throw new Error("Azure DevOps is not connected for this workspace");
  conn = JSON.parse(raw);
  if (!acc.isEditor) throw new Error("not allowed");
  var stCache = {};
  function states(project, type) {
    var k = project + "|" + type; if (stCache[k]) return stCache[k];
    stCache[k] = (az("GET", "/" + encodeURIComponent(project) + "/_apis/wit/workitemtypes/" + encodeURIComponent(type) + "/states?api-version=7.1").value || []);
    return stCache[k];
  }
  var CAT = { Proposed: "new", InProgress: "indeterminate", Resolved: "indeterminate", Completed: "done", Removed: "removed" };
  if (req.kind === "azure-projects") {
    var ps = az("GET", "/_apis/projects?api-version=7.1&$top=200").value || [];
    return { ok: true, site: conn.org, projects: ps.map(function (x) { return { key: x.name, name: x.name }; }).sort(function (a, b) { return a.name.localeCompare(b.name); }) };
  }
  if (req.kind === "azure-import") {
    var project = String(req.project || "").trim(); if (!project) throw new Error("choose a project");
    var wiql = String(req.query || "").trim() || "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.State] <> 'Removed' ORDER BY [System.Id]";
    var q = az("POST", "/" + encodeURIComponent(project) + "/_apis/wit/wiql?api-version=7.1&$top=1000", { query: wiql });
    var ids = (q.workItems || []).map(function (w) { return w.id; }).slice(0, 1000), out = [];
    for (var i = 0; i < ids.length; i += 200) {
      var b = az("POST", "/" + encodeURIComponent(project) + "/_apis/wit/workitemsbatch?api-version=7.1", { ids: ids.slice(i, i + 200), $expand: "None", errorPolicy: "Omit" });
      (b.value || []).forEach(function (w) {
        if (!w || !w.fields) return;
        var f = w.fields, type = f["System.WorkItemType"] || "", st = f["System.State"] || "", cat = "new";
        states(f["System.TeamProject"] || project, type).forEach(function (s) { if (s.name === st) cat = CAT[s.category] || "new"; });
        if (cat === "removed") return;
        var a = f["System.AssignedTo"], d = function (v) { return v ? String(v).slice(0, 10) : null; };
        out.push({ key: "#" + w.id, ref: w.id, title: f["System.Title"] || ("#" + w.id), type: type, level: /^(epic|feature)$/i.test(type) ? 1 : 0,
          status: st, cat: cat, assignee: a ? (a.uniqueName || "") : "", assigneeName: a ? (a.displayName || "") : "",
          start: d(f["Microsoft.VSTS.Scheduling.StartDate"]), due: d(f["Microsoft.VSTS.Scheduling.TargetDate"] || f["Microsoft.VSTS.Scheduling.DueDate"] || f["Microsoft.VSTS.Scheduling.FinishDate"]),
          points: f["Microsoft.VSTS.Scheduling.StoryPoints"] != null ? f["Microsoft.VSTS.Scheduling.StoryPoints"] : (f["Microsoft.VSTS.Scheduling.Effort"] != null ? f["Microsoft.VSTS.Scheduling.Effort"] : null),
          parent: f["System.Parent"] ? "#" + f["System.Parent"] : null, project: f["System.TeamProject"] || project, wtype: type,
          url: conn.org + "/" + encodeURIComponent(f["System.TeamProject"] || project) + "/_workitems/edit/" + w.id });
      });
    }
    return { ok: true, site: conn.org, issues: out };
  }
  if (req.kind === "azure-push") {
    var x = integItem(req, acc, "azure"), it = x.item, id = Number(it.ext.ref || String(it.ext.key).replace("#", ""));
    var ops = [{ op: "add", path: "/fields/System.Title", value: it.title }];
    if (it.start) ops.push({ op: "add", path: "/fields/Microsoft.VSTS.Scheduling.StartDate", value: it.start + "T00:00:00Z" });
    if (it.end) ops.push({ op: "add", path: "/fields/Microsoft.VSTS.Scheduling.TargetDate", value: it.end + "T00:00:00Z" });
    var want = { todo: "Proposed", doing: "InProgress", done: "Completed" }[x.cat], pick = null;
    var sts = it.ext.project && it.ext.wtype ? states(it.ext.project, it.ext.wtype) : [];
    sts.forEach(function (s) { if (!pick && x.stName && s.name.toLowerCase() === x.stName.toLowerCase()) pick = s.name; });
    sts.forEach(function (s) { if (!pick && s.category === want) pick = s.name; });
    if (pick) ops.push({ op: "add", path: "/fields/System.State", value: pick });
    try { az("PATCH", "/_apis/wit/workitems/" + id + "?api-version=7.1", ops, "application/json-patch+json"); }
    catch (e) { // some processes have no StartDate/TargetDate on this type: retry with title + state only
      az("PATCH", "/_apis/wit/workitems/" + id + "?api-version=7.1", ops.filter(function (o) { return !/Scheduling/.test(o.path); }), "application/json-patch+json");
    }
    return { ok: true, moved: !!pick };
  }
  throw new Error("unknown action");
}

/* ---------------- Kanbanize / Businessmap ----------------
 * Connection: account URL (https://<account>.kanbanize.com or .businessmap.io) + API key (profile → API). */
function kbHandle(req, who) {
  var acc = integAccess(req, who), P = PropertiesService.getScriptProperties(), pk = "kanbanize:" + acc.wsId, conn;
  function kb(method, path, body) { return httpJson(conn.url + "/api/v2" + path, method, { apikey: conn.key, Accept: "application/json" }, body); }
  function arr(r) { var d = r && r.data; if (Array.isArray(d)) return d; if (d && Array.isArray(d.data)) return d.data; return []; }
  if (req.kind === "kanbanize-connect") {
    if (!acc.isOwner) throw new Error("only the workspace owner or an admin can connect Kanbanize");
    var u = String(req.url || "").trim().replace(/\/+$/, "").replace(/\/api\/v2$/, "").toLowerCase();
    if (/^[a-z0-9-]+$/.test(u)) u = "https://" + u + ".kanbanize.com";
    if (!/^https:\/\/[a-z0-9-]+\.(kanbanize\.com|businessmap\.io)$/.test(u)) throw new Error("the account URL must look like https://your-account.kanbanize.com");
    conn = { url: u, key: String(req.key || "").trim() };
    if (!conn.key) throw new Error("the API key is required");
    var md = {};
    try { md = (kb("GET", "/me") || {}).data || {}; } catch (e) { if (/credentials|401|403/.test(e.message)) throw e; kb("GET", "/boards?fields=board_id"); }
    conn.by = who.email; conn.at = Date.now(); P.setProperty(pk, JSON.stringify(conn));
    return { ok: true, site: u, account: md.realname || md.username || md.email || u.replace("https://", "") };
  }
  if (req.kind === "kanbanize-disconnect") { if (!acc.isOwner) throw new Error("not allowed"); P.deleteProperty(pk); return { ok: true }; }
  var raw = P.getProperty(pk); if (!raw) throw new Error("Kanbanize is not connected for this workspace");
  conn = JSON.parse(raw);
  if (!acc.isEditor) throw new Error("not allowed");
  var SEC = { 1: "new", 2: "new", 3: "indeterminate", 4: "done", 5: "done" };
  if (req.kind === "kanbanize-projects") {
    var bs = arr(kb("GET", "/boards?is_archived=0&fields=board_id,name"));
    return { ok: true, site: conn.url, projects: bs.map(function (b) { return { key: String(b.board_id), name: b.name }; }) };
  }
  if (req.kind === "kanbanize-import") {
    var board = String(req.project || "").replace(/\D/g, ""); if (!board) throw new Error("choose a board");
    var cols = {}, users = {}, types = {};
    arr(kb("GET", "/boards/" + board + "/columns")).forEach(function (c) { cols[c.column_id] = c; });
    try { arr(kb("GET", "/users?fields=user_id,email,realname,username")).forEach(function (x) { users[x.user_id] = x; }); } catch (e) { /* user list may need admin rights */ }
    try { arr(kb("GET", "/cardTypes")).forEach(function (x) { types[x.type_id] = x.name; }); } catch (e) { /* optional */ }
    var out = [], page = 1, pages = 1;
    do {
      var r = kb("GET", "/cards?board_ids=" + board + "&per_page=200&page=" + page);
      arr(r).forEach(function (c) {
        var col = cols[c.column_id] || {}, sec = c.section || col.section, cat = SEC[sec] || "new";
        if (sec === 5) return; // archive
        var o = users[c.owner_user_id] || {}, tn = types[c.type_id] || "";
        out.push({ key: (c.custom_id ? String(c.custom_id) : "KB-" + c.card_id), ref: c.card_id, title: c.title || ("#" + c.card_id), type: tn, level: /initiative|epic/i.test(tn) ? 1 : 0,
          status: col.name || "", cat: cat, assignee: o.email || "", assigneeName: o.realname || o.username || "",
          start: c.planned_start_date ? String(c.planned_start_date).slice(0, 10) : null, due: c.deadline ? String(c.deadline).slice(0, 10) : (c.planned_end_date ? String(c.planned_end_date).slice(0, 10) : null),
          points: c.size != null ? c.size : null, parent: null, board: Number(board), workflow: c.workflow_id || col.workflow_id || null,
          url: conn.url + "/ctrl_board/" + board + "/cards/" + c.card_id + "/details/" });
      });
      var pg = r && r.data && r.data.pagination; pages = pg ? (pg.all_pages || 1) : 1; page++;
    } while (page <= pages && page <= 10);
    return { ok: true, site: conn.url, issues: out };
  }
  if (req.kind === "kanbanize-push") {
    var x = integItem(req, acc, "kanbanize"), it = x.item, body = { title: it.title };
    if (it.end) body.deadline = it.end;
    var want = { todo: [2, 1], doing: [3], done: [4] }[x.cat] || [2, 1], pick = null;
    if (it.ext.board) {
      var cs = arr(kb("GET", "/boards/" + it.ext.board + "/columns")).filter(function (c) { return !it.ext.workflow || c.workflow_id === it.ext.workflow; });
      cs.forEach(function (c) { if (!pick && x.stName && String(c.name).toLowerCase() === x.stName.toLowerCase()) pick = c; });
      want.forEach(function (s) { cs.forEach(function (c) { if (!pick && c.section === s && !c.parent_column_id) pick = c; }); });
      if (pick) body.column_id = pick.column_id;
    }
    kb("PATCH", "/cards/" + Number(it.ext.ref), body);
    return { ok: true, moved: !!pick };
  }
  throw new Error("unknown action");
}
