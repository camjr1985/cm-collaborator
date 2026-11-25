/* Planning · Portfolio (one page by island, drill-down, GLPI import, ITSM classification) – UI test with Playwright + Firebase mock.
 * Run: python3 -m http.server 8765 (repo root) & XLSX=/path/glpi.xlsx node tests/portfolio.ui.mjs   (PW = path to playwright if not global) */
import fs from "node:fs";
const PW = process.env.PW || "playwright";
const { chromium, devices } = await import(PW.endsWith(".mjs") ? PW : PW + "/index.mjs").catch(() => import("playwright"));
const BASE = process.env.BASE || "http://localhost:8765";
const MOCK = fs.readFileSync(new URL("./mock-firebase.js", import.meta.url), "utf8");
const XLSX = process.env.XLSX || "/tmp/glpi.xlsx";
const SHOTS = process.env.SHOTS || "/tmp/pf-shots"; fs.mkdirSync(SHOTS, { recursive: true });
const OWNER = "admin@cm.test", DANIEL = "daniel@fuabc.test", READER = "leitor@fuabc.test";
const key = (e) => e.toLowerCase().replace(/\./g, ",");
const SEED = {
  admins: { [key(OWNER)]: true },
  workspaces: { ws1: { info: { name: "FUABC – Teste Daniel", owner: key(OWNER), ownerEmail: OWNER, area: "health" }, members: { [key(DANIEL)]: { email: DANIEL, name: "Daniel Bastos", role: "editor" }, [key(READER)]: { email: READER, name: "Leitor", role: "viewer" } } } },
  planning: { p1: { info: { ws: "ws1", title: "Portfólio de TI – FUABC", method: "hybrid" }, data: { settings: { prefix: "FUABC", seq: 0, portfolio: { on: true, org: "FUABC" } } } } }
};
const errors = []; let failures = 0;
function check(c, m) { if (c) console.log("  ✓ " + m); else { failures++; console.log("  ✗ " + m); } }
const browser = await chromium.launch();
async function page(user, device, db) {
  const ctx = await browser.newContext(device ? { ...devices[device], locale: "pt-BR" } : { viewport: { width: 1366, height: 860 }, locale: "pt-BR" });
  await ctx.route(/gstatic\.com\/firebasejs\//, (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: MOCK }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ contentType: "text/css", body: "" }));
  await ctx.addInitScript(([u, seed]) => { if (!localStorage.getItem("mockdb")) localStorage.setItem("mockdb", JSON.stringify(seed)); localStorage.setItem("mockuser", u); localStorage.setItem("cmcollab:lang", "pt"); }, [user, db || SEED]);
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error") errors.push(user + ": " + m.text()); });
  p.on("pageerror", (e) => errors.push(user + ": " + e.message));
  return p;
}
const dbOf = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("mockdb")));
const tileVal = (p, label) => p.evaluate((l) => { const t = [...document.querySelectorAll(".pf-tiles:not(.small) .pf-tile")].find((x) => x.querySelector(".pf-tl").textContent.trim() === l); return t ? Number(t.querySelector("b").textContent) : null; }, label);
async function noH(p, l) { const r = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); check(r[0] <= r[1] + 1, l + " – sem rolagem horizontal (" + r[0] + " ≤ " + r[1] + ")"); }

console.log("Dono: importar o GLPI e conferir o one page");
const a = await page(OWNER);
await a.goto(BASE + "/planning/?id=p1"); await a.waitForSelector(".pf");
check(await a.locator('.pl-tabs [data-view="portfolio"]').count() === 1, "aba Portfólio aparece");
await a.click('[data-act="import"]'); await a.setInputFiles('#pfImp input[type=file]', XLSX);
await a.waitForSelector(".pf-prev"); const pv = await a.textContent(".pf-prev");
check(/94 projetos/.test(pv) && /94 novos/.test(pv), "pré-visualização: 94 projetos novos");
check(await a.inputValue('#pfImp [name=ref]') === "2026-11-24", "data-base lida da aba Configuração (24/11/2026)");
await a.click("#pfGo"); await a.waitForSelector(".pf-tiles"); await a.waitForTimeout(300);
const exp = { Total: 94, Processando: 32, Bloqueado: 31, Backlog: 31, "Estratégico": 13, "Tático": 24, Operacional: 57 };
for (const k of Object.keys(exp)) check(await tileVal(a, k) === exp[k], "cartão " + k + " = " + exp[k]);
const isl = await a.$$eval(".pf-t tbody tr[data-island]", (rs) => rs.map((r) => [...r.cells].slice(0, 5).map((c) => c.textContent.trim()).join("|")));
const want = ["Sistemas|24|9|13|2", "Desenvolvimento|10|1|6|3", "Indicadores|23|3|7|13", "Infraestrutura|20|6|1|13", "Assistencial|9|9|0|0", "Projetos - PMO|8|4|4|0"];
check(JSON.stringify(isl) === JSON.stringify(want), "carteira por ilha igual ao PDF (" + isl.join(" ; ") + ")");
await a.screenshot({ path: SHOTS + "/1-macro.png", fullPage: true });
await noH(a, "macro desktop");
// cross filter by clicking a segment
await a.click('.pf-seg[data-f="island=Sistemas&sit=blocked"]'); await a.waitForTimeout(150);
check(await tileVal(a, "Total") === 13 && /Sistemas/.test(await a.textContent(".pf-crumbs")), "clicar no vermelho de Sistemas filtra: 13 bloqueados");
await a.click('[data-go="root"]'); await a.click("[data-clear]").catch(() => {});
// drill into Sistemas
await a.click('.pf-t tr[data-island="Sistemas"]'); await a.waitForTimeout(150);
const sum = await a.textContent(".pf-sum");
check(/em discussão: 22/.test(sum) && /Prazo vencido: 3/.test(sum) && /sem prazo: 4/.test(sum), "Sistemas: 22 em discussão, 3 vencidos, 4 sem prazo");
check(await a.locator(".pf-t tbody tr[data-open]").count() === 22, "tabela de Sistemas sem o backlog (22)");
await a.screenshot({ path: SHOTS + "/2-ilha.png", fullPage: true });
// drill into a project
await a.click('.pf-t tr[data-open]:has-text("INTEGRAÇÃO SALUTEM - ERP (278)")'); await a.waitForSelector(".pf-kv");
check(/278/.test(await a.textContent(".pf-kv")), "detalhe do projeto 278");
await a.click('[data-svc="service"]'); await a.waitForTimeout(200);
await a.fill("#pfNote", "Decisão: priorizar integração. Resp.: Daniel. Prazo: 15/12."); await a.click("#pfNoteSave"); await a.waitForTimeout(200);
let db = await dbOf(a); const it278 = Object.values(db.planning.p1.data.items).find((i) => i.pf && i.pf.id === "278");
check(it278.pfSvc === "service" && /priorizar/.test(it278.pfNote), "classificação Serviço e encaminhamento gravados");
check(/central ITSM/.test(await a.textContent(".pf-note-box")), "sem central ligada: orienta a ligar em Configurações");
await a.screenshot({ path: SHOTS + "/3-projeto.png", fullPage: true });
// re-import keeps classification and note, updates nothing new
await a.click('[data-act="import"]'); await a.setInputFiles('#pfImp input[type=file]', XLSX); await a.waitForSelector(".pf-prev");
check(/0 novos/.test(await a.textContent(".pf-prev")) && /94 para atualizar/.test(await a.textContent(".pf-prev")), "reimportação: 0 novos, 94 para atualizar");
await a.click("#pfGo"); await a.waitForTimeout(500);
db = await dbOf(a); const items = Object.values(db.planning.p1.data.items); const again = items.find((i) => i.pf && i.pf.id === "278");
check(again.pfSvc === "service" && /priorizar/.test(again.pfNote), "reimportação mantém classificação e encaminhamento");
check(items.filter((i) => i.pf).length === 94 && items.filter((i) => i.pfIsland).length === 6, "94 projetos e 6 ilhas (épicos), sem duplicar");
// link an ITSM centre with a ticket for the project
await a.evaluate(() => { const d = JSON.parse(localStorage.getItem("mockdb")); const k = Object.keys(d.planning.p1.data.items).find((x) => (d.planning.p1.data.items[x].pf || {}).id === "278");
  d.itsm = { c1: { info: { title: "Central FUABC", ws: "ws1" }, data: { records: { r1: { kind: "incident", key: "INC-0001", title: "Falha na integração (278)", status: "new", created: Date.now() }, r2: { kind: "request", key: "REQ-0001", title: "Acesso", status: "new", planLinks: { p1: k } } } } } };
  d.planning.p1.data.settings.itsm = "c1"; localStorage.setItem("mockdb", JSON.stringify(d)); });
await a.reload(); await a.waitForSelector(".pf");
await a.click('.pf-t tr[data-island="Sistemas"]'); await a.click('.pf-t tr[data-open]:has-text("(278)")'); await a.waitForTimeout(400);
check(/INC-0001/.test(await a.textContent(".pf")) && /REQ-0001/.test(await a.textContent(".pf")), "chamados do ITSM ligados ao projeto aparecem no drill-down");
// drawer block
await a.click('[data-act="drawer"]'); await a.waitForSelector("#drawer [name=pfSvc]");
check(await a.inputValue("#drawer [name=pfSvc]") === "service", "painel do item mostra a classificação");
// A4 PDF with watermark
await a.keyboard.press("Escape"); await a.waitForTimeout(150);
await a.click('[data-go="root"]'); await a.waitForTimeout(150);
await a.click('[data-act="pdf"]'); await a.waitForSelector("#pfPdf");
await a.fill("#pfPdf [name=wmText]", "Confidencial"); await a.evaluate(() => { window.print = () => { window.__printed = 1; }; });
await a.setInputFiles("#pfPdf [name=wmImg]", { name: "logo.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64") });
await a.waitForSelector(".pf-wmprev img");
await a.click("#pdfGo"); await a.waitForTimeout(800);
const fr = await a.evaluate(() => { const f = document.getElementById("pfPrintFrame"); return f ? f.contentDocument.querySelectorAll(".pg").length + "|" + f.contentDocument.querySelectorAll(".wm").length : ""; });
check(fr === "7|7", "PDF montado: 7 páginas A4 (one page + 6 ilhas), cada uma com marca d'água (" + fr + ")");
db = await dbOf(a);
check(db.planning.p1.data.settings.portfolio.wm && db.planning.p1.data.settings.portfolio.wm.text === "Confidencial", "marca d'água salva para os próximos PDFs");
for (const [orient, pos] of [["landscape", "diag"], ["portrait", "tile"]]) {
  const html = await a.evaluate(([o, p]) => window.CMPortfolio.pdfHtml({ orient: o, pages: "all", wm: { text: "Confidencial", op: 0.12, pos: p } }), [orient, pos]);
  const pp = await a.context().newPage(); await pp.setContent(html); await pp.emulateMedia({ media: "print" });
  const pdf = await pp.pdf({ preferCSSPageSize: true, printBackground: true }); fs.writeFileSync(SHOTS + "/exec-" + orient + ".pdf", pdf);
  const n = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  const box = (pdf.toString("latin1").match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/) || []).slice(1).map(Number);
  const a4 = orient === "landscape" ? [841.92, 595.92] : [595.92, 841.92];
  check(n === 7 && Math.abs(box[0] - a4[0]) < 2 && Math.abs(box[1] - a4[1]) < 2, "PDF " + orient + ": 7 páginas A4 (" + n + " pág., " + box.join("×") + " pt)");
  await pp.close();
}
await a.close();

console.log("Daniel (editor) e leitor");
const d = await page(DANIEL, null, db);
await d.goto(BASE + "/planning/?id=p1"); await d.waitForSelector(".pf-tiles");
check(await tileVal(d, "Total") === 94, "Daniel vê o portfólio (94)");
check(await d.locator('[data-act="import"]').count() === 1, "Daniel (editor) pode importar");
await d.close();
const r = await page(READER, null, db);
await r.goto(BASE + "/planning/?id=p1"); await r.waitForSelector(".pf-tiles");
check(await r.locator('[data-act="import"]').count() === 0, "leitor não vê Importar");
await r.close();

console.log("iPhone 13");
const m = await page(OWNER, "iPhone 13", db);
await m.goto(BASE + "/planning/?id=p1"); await m.waitForSelector(".pf-tiles");
await noH(m, "macro iPhone"); await m.screenshot({ path: SHOTS + "/4-iphone.png", fullPage: true });
await m.click('.pf-t tr[data-island="Indicadores"]'); await m.waitForTimeout(150); await noH(m, "ilha iPhone");
await m.click(".pf-t tr[data-open]"); await m.waitForSelector(".pf-kv"); await noH(m, "projeto iPhone");
await m.close();

await browser.close();
const errs = errors.filter((e) => !/favicon|net::ERR/.test(e));
check(!errs.length, "zero erro no console" + (errs.length ? ": " + errs.slice(0, 5).join(" | ") : ""));
console.log(failures ? "\n" + failures + " falha(s)" : "\nTudo certo"); process.exit(failures ? 1 : 0);
