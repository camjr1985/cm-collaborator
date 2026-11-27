/* Saúde – absenteísmo, IA e notificações (27/11) – UI test with Playwright + Firebase mock.
 * Run: python3 -m http.server 8765 (repo root) & PW=/opt/npm-tools/node_modules/playwright node tests/sst.ui.mjs */
import fs from "node:fs";
const PW = process.env.PW || "playwright";
const { chromium, devices } = await import(PW.endsWith(".mjs") ? PW : PW + "/index.mjs").catch(() => import("playwright"));
const BASE = process.env.BASE || "http://localhost:8765";
const MOCK = fs.readFileSync(new URL("./mock-firebase.js", import.meta.url), "utf8");
const SHOTS = process.env.SHOTS || "/tmp/sst-shots"; fs.mkdirSync(SHOTS, { recursive: true });
const ADM = "admin@cm.test", DA = "da@cm.test";
const key = (e) => e.toLowerCase().replace(/\./g, ",");
const d = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const SEED = {
  admins: { [key(ADM)]: true },
  userWorkspaces: { [key(ADM)]: { ws1: { name: "AZ" } }, [key(DA)]: { ws1: { name: "AZ" } } },
  entitlements: { ws: { ws1: { sst: { on: true, plan: "beta", until: Date.now() + 30 * 864e5 } } } },
  workspaces: { ws1: { info: { name: "AstraZeneca – Saúde (Beta)", area: "ohs", modules: ["collab", "planning", "sst"] }, members: { [key(DA)]: { email: DA, name: "Digital Agile", role: "editor" }, [key(ADM)]: { email: ADM, name: "Carlos", role: "editor" } } } },
  sst: { ws1: { counter: 2, settings: { places: ["Produção", "Laboratório"], absHeadcount: 100, absTarget: 2.5, absDayCost: 450 },
    people: { p1: { name: "Ana", reg: "1", sector: "Produção", active: true, exams: { e: { kind: "periodic", date: d(-360), months: 12 } } }, p2: { name: "Bruno", reg: "2", sector: "Laboratório", active: true, trainings: { t: { nr: "NR-20", course: "Inflamáveis", date: d(-400), months: 12 } } } },
    records: { r1: { key: "SST-0001", type: "leave", title: "Afastamento", status: "new", personId: "p1", person: "Ana", absKind: "inss", absStart: d(-20), absEnd: d(5), daysLost: 26, when: Date.now() - 20 * 864e5 },
      r2: { key: "SST-0002", type: "acc", title: "Queda no laboratório", status: "analysis", severity: "med", leave: true, daysLost: 3, absStart: d(-40), when: Date.now() - 40 * 864e5, desc: "Piso molhado" } } } }
};
const errors = []; let failures = 0, mails = [];
function check(c, m) { if (c) console.log("  ✓ " + m); else { failures++; console.log("  ✗ " + m); } }
const browser = await chromium.launch();
async function page(user, device) {
  const ctx = await browser.newContext(device ? { ...devices[device], locale: "pt-BR" } : { viewport: { width: 1366, height: 860 }, locale: "pt-BR" });
  await ctx.route(/gstatic\.com\/firebasejs\//, (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: MOCK }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ contentType: "text/css", body: "" }));
  await ctx.route(/script\.google\.com/, (r) => { const b = JSON.parse(r.request().postData() || "{}"); mails.push(b.kind); r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, sent: ["da@cm.test"] }) }); });
  await ctx.addInitScript(([u, seed]) => {
    if (!localStorage.getItem("mockdb")) localStorage.setItem("mockdb", JSON.stringify(seed)); localStorage.setItem("mockuser", u); localStorage.setItem("cmcollab:lang", "pt");
    window.CMAI_MOCK = function (kind) {
      if (kind === "sst-record") return { causa: "Piso molhado sem sinalização", fatores: ["limpeza no turno"], acoes: [{ t: "Sinalizar piso", prazoDias: 3, tipo: "administrativa" }, { t: "Piso antiderrapante", prazoDias: 30, tipo: "engenharia" }], nrs: ["NR-01"], recorrencia: "média", comunicacao: "Atenção ao piso" };
      if (kind === "sst-panel") return { titulo: "Atenção aos vencimentos", resumo: "Resumo.", prioridades: [{ t: "Convocar ASO", porque: "S-2220" }], riscos: ["Autuação"], ganhos: ["Menos faltas"] };
      if (kind === "sst-abs") return { diagnostico: "INSS concentra os dias.", acoes: [{ t: "Entrevista de retorno", prazoDias: 15, indicador: "% entrevistas" }, { t: "Ginástica laboral", prazoDias: 30, indicador: "adesão" }], meta: "2% em 6 meses", ganho: "120 dias" };
      return {};
    };
  }, [user, SEED]);
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error") errors.push(user + ": " + m.text()); });
  p.on("pageerror", (e) => errors.push(user + ": " + e.message));
  return p;
}
const dbOf = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("mockdb")));
async function noH(p, l) { const r = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); check(r[0] <= r[1] + 1, l + " – sem rolagem horizontal (" + r[0] + " ≤ " + r[1] + ")"); }

const a = await page(ADM);
await a.goto(BASE + "/sst/?ws=ws1"); await a.waitForSelector(".st-tiles");
await a.evaluate(() => { const st = document.createElement("style"); st.textContent = "#cmJg{display:none!important}"; document.head.appendChild(st); });
check(await a.locator('#stTabs [data-v="abs"]').count() === 1, "aba Absenteísmo existe");
check(await a.locator("#pnAi").count() === 1, "botão Resumo executivo com IA no painel");
await a.click("#pnAi"); await a.waitForSelector(".st-aiol");
check(/Convocar ASO/.test(await a.textContent(".pl-modal")), "resumo executivo da IA aparece");
await a.screenshot({ path: SHOTS + "/1-panel-ai.png" });
await a.click(".pl-modal [data-close]");
await a.click('#stTabs [data-v="abs"]'); await a.waitForSelector("#abAi");
const absTxt = await a.textContent("#sstView");
check(/afastados hoje/.test(absTxt) && /Retorno previsto/.test(absTxt), "absenteísmo: afastados e retornos");
check(/reincidentes/.test(absTxt) && /Previdenciário|previdenciário/i.test(absTxt), "absenteísmo: motivo e reincidência");
await a.click("#abAi"); await a.waitForSelector("#aiAbAll"); await a.click("#aiAbAll"); await a.waitForTimeout(300);
check(Object.keys((await dbOf(a)).sst.ws1.settings.absPlan || {}).length === 2, "IA: 2 ações de controle gravadas");
await a.screenshot({ path: SHOTS + "/2-abs.png", fullPage: true });
await noH(a, "absenteísmo desktop");
// record AI
await a.click('#stTabs [data-v="list"]'); await a.selectOption("#stS", ""); await a.click('[data-open="r2"]'); await a.waitForSelector("#sdAi");
await a.click("#sdAi"); await a.waitForSelector("#aiAddAll"); await a.click("#aiUseCause");
check(/Piso molhado sem sinalização/.test(await a.inputValue("#sdF [name=rootCause]")), "IA preenche a causa raiz");
await a.click("#aiAddAll"); await a.waitForTimeout(300);
check(Object.keys((await dbOf(a)).sst.ws1.records.r2.actions || {}).length === 2, "IA: 2 ações no registro");
await a.click("#sdSave"); await a.waitForTimeout(200);
await a.click("#sdX");
// settings: notifications
await a.click('#stTabs [data-v="cfg"]'); await a.waitForSelector("#ntNow");
await a.check('[name=nto][value="da@cm.test"]'); await a.click("#cfF .pl-row-end .primary"); await a.waitForTimeout(300);
const st = (await dbOf(a)).sst.ws1.settings;
check(st.notify && st.notify.to[0] === "da@cm.test" && st.places.length === 2 && st.absTarget === 2.5 && Object.keys(st.absPlan || {}).length === 2, "configurações salvas sem apagar o plano de absenteísmo");
await a.click("#ntNow"); await a.waitForTimeout(400);
check(mails.includes("sst-digest") && /Enviado para/.test(await a.textContent("#ntMsg")), "Enviar resumo agora chama o notificador");
// register an absence → instant alert
await a.click("#stNew"); await a.click('[data-t="leave"]'); await a.fill("#rcF [name=title]", "Atestado"); await a.fill("#rcF [name=absStart]", d(0)); await a.fill("#rcF [name=absEnd]", d(2)); await a.click("#rcF .primary"); await a.waitForTimeout(500);
const r3 = Object.values((await dbOf(a)).sst.ws1.records).find((r) => r.title === "Atestado");
check(r3 && r3.daysLost === 3 && r3.absKind === "short", "afastamento: dias calculados (3) e motivo padrão");
check(mails.includes("sst-record"), "alerta imediato enviado ao registrar afastamento");
await a.click("#sdX").catch(() => {});
// mobile
const m = await page(ADM, "iPhone 13");
await m.goto(BASE + "/sst/?ws=ws1"); await m.waitForSelector(".st-tiles"); await m.evaluate(() => { const st = document.createElement("style"); st.textContent = "#cmJg{display:none!important}"; document.head.appendChild(st); });
await noH(m, "painel celular");
await m.click('#stTabs [data-v="abs"]'); await m.waitForSelector("#abAi"); await noH(m, "absenteísmo celular");
await m.screenshot({ path: SHOTS + "/3-mobile.png", fullPage: true });
check(!errors.length, "zero erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
console.log(failures ? failures + " falha(s)" : "tudo certo"); process.exit(failures ? 1 : 0);
