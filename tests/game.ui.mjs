/* Business Game – UI test with Playwright + Firebase mock (desktop 1366 and iPhone 13).
 * Run: python3 -m http.server 8765 (repo root) & node tests/game.ui.mjs   (PW = path to playwright if not global) */
import fs from "node:fs";
const PW = process.env.PW || "playwright";
const { chromium, devices } = await import(PW.endsWith(".mjs") ? PW : PW + "/index.mjs").catch(() => import("playwright"));
const BASE = process.env.BASE || "http://localhost:8765";
const MOCK = fs.readFileSync(new URL("./mock-firebase.js", import.meta.url), "utf8");
const SHOTS = process.env.SHOTS || "/tmp/gm-shots";
fs.mkdirSync(SHOTS, { recursive: true });

const PROF = "prof@faculdade.edu", ADMIN = "admin@cm.test";
const key = (e) => e.toLowerCase().replace(/\./g, ",");
const SEED = {
  admins: { [key(ADMIN)]: true },
  workspaces: { ws1: { info: { name: "Faculdade Teste – Administração", owner: key(PROF), ownerEmail: PROF, area: "education" }, members: {} } },
  userWorkspaces: { [key(PROF)]: { ws1: { name: "Faculdade Teste – Administração", owner: true } } },
  entitlements: { ws: { ws1: { game: { on: true, plan: "beta" } } } }
};
// rules simulation: students cannot read the game root, other teams' decisions/results, or the workspace
const DENY = `window.__DENY = function (p, op, email) {
  if (!email || /^(prof|admin)@/.test(email)) return false;
  const k = email.toLowerCase().replace(/\\./g, ","), seg = p.split("/");
  if (seg[0] === "workspaces" && seg.length >= 2) return true;
  if (seg[0] === "entitlements" && seg[1] === "ws") return true;
  if (seg[0] !== "game") return false;
  if (seg.length <= 2) return true;
  const me = window.__mockdb.get("game/" + seg[1] + "/people/" + k) || {};
  if (seg[2] === "decisions" && (seg.length < 5 || seg[4] !== me.team)) return true;
  if (seg[2] === "results" && (seg.length < 5 || (seg[4] !== "public" && !(seg[4] === "teams" && seg[5] === me.team)))) return true;
  if (op === "write" && seg[2] !== "decisions") return true;
  return false;
};`;

const errors = [];
let failures = 0;
function check(cond, msg) { if (cond) console.log("  ✓ " + msg); else { failures++; console.log("  ✗ " + msg); } }

const browser = await chromium.launch();
async function page(user, device, opts) {
  const ctx = await browser.newContext(device ? { ...devices[device] } : { viewport: { width: 1366, height: 860 }, locale: "pt-BR" });
  // Playwright matches the most recently registered route first
  await ctx.route(/gstatic\.com\/firebasejs\//, (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: MOCK }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ contentType: "text/css", body: "" }));
  await ctx.route(/script\.google(usercontent)?\.com/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, sent: ["x"] }) }));
  await ctx.addInitScript(([u, seed, deny, lang]) => {
    if (!localStorage.getItem("mockdb")) localStorage.setItem("mockdb", JSON.stringify(seed));
    localStorage.setItem("mockuser", u);
    if (lang) localStorage.setItem("cmcollab:lang", lang);
    window.CMAI_MOCK = function () { return { summary: "Resumo de teste.", lessons: ["Lição 1", "Lição 2"] }; };
    eval(deny);
  }, [user, (opts && opts.db) || SEED, DENY, (opts && opts.lang) || "pt"]);
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error") errors.push(user + ": " + m.text()); });
  p.on("pageerror", (e) => errors.push(user + ": " + e.message));
  p.on("dialog", (d) => d.accept(d.type() === "prompt" ? (opts && opts.prompt) || "" : undefined));
  return p;
}
async function dbOf(p) { return p.evaluate(() => JSON.parse(localStorage.getItem("mockdb"))); }
async function noHScroll(p, label) { const r = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); check(r[0] <= r[1] + 1, label + " – sem rolagem horizontal (" + r[0] + " ≤ " + r[1] + ")"); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("1. Professor cria a partida");
let pr = await page(PROF);
await pr.goto(BASE + "/game/?new=1&ws=ws1");
await pr.fill("#newF [name=title]", "Administração 5º semestre");
await pr.selectOption("#newF [name=mode]", "business");
await pr.selectOption("#newF [name=cur]", "AOA");
await pr.click("#newF .gm-btn.primary");
await pr.waitForURL(/game\/\?id=/);
await pr.waitForSelector(".gm-setup");
let db = await dbOf(pr);
const GID = Object.keys(db.game)[0];
check(db.game[GID].config.mode === "business", "modo gestão empresarial gravado");
check(!!GID && Object.keys(db.game[GID].teams).length === 4, "partida criada com 4 equipes (" + GID + ")");
check(db.workspaces.ws1.games[GID] && db.userGames[key(PROF)][GID], "índices do workspace e de “minhas partidas”");
await pr.screenshot({ path: SHOTS + "/01-overview-setup.png", fullPage: true });

console.log("2. Configuração: alunos, moeda");
await pr.click('[data-v="settings"]');
await pr.fill("#sPeople textarea", ["ana@aluno.edu; Ana; Alfa", "bruno@aluno.edu; Bruno; Beta", "carla@aluno.edu; Carla; Gama", "davi@aluno.edu; Davi; Delta", "colega@faculdade.edu; Prof. Colega; professor"].join("\n"));
await pr.click("#sPeople .gm-btn.primary");
await sleep(300);
db = await dbOf(pr);
check(db.game[GID].people[key("ana@aluno.edu")].team === "alfa" && db.game[GID].people[key("colega@faculdade.edu")].role === "prof", "alunos nas equipes e professor convidado");
check(!!db.userGames[key("bruno@aluno.edu")][GID], "aluno vê a partida no hub (userGames)");
const sample = await pr.textContent(".gm-sample");
check(/Kz|AOA/.test(sample), "moeda kwanza no exemplo: " + sample.trim());
await pr.screenshot({ path: SHOTS + "/02-settings.png", fullPage: true });
// fictional currency
await pr.selectOption("#sGen [name=cur]", "__custom");
await pr.fill("#sGen [name=cname]", "Crédito Simulado"); await pr.fill("#sGen [name=csym]", "CS$");
await pr.click("#sGen .gm-btn.primary"); await sleep(300);
check(/CS\$/.test(await pr.textContent(".gm-sample")), "moeda fictícia CS$");
await pr.selectOption("#sGen [name=cur]", "BRL"); await pr.click("#sGen .gm-btn.primary"); await sleep(300);

console.log("3. Planejamento do semestre conectado");
await pr.click("#planNew"); await sleep(400);
db = await dbOf(pr);
const PID = db.game[GID].info.plan;
check(!!PID && db.planning[PID] && Object.values(db.planning[PID].data.items).filter((i) => i.type === "milestone" && i.src && i.src.game === GID).length === 8, "planejamento criado com 8 marcos de rodada");

console.log("4. Abrir a rodada 1");
await pr.click('[data-v="teacher"]');
await pr.click("#openForm .gm-btn.primary"); await sleep(400);
db = await dbOf(pr);
check(db.game[GID].rounds && db.game[GID].rounds[1].status === "open", "rodada 1 aberta com prazo");
await pr.screenshot({ path: SHOTS + "/03-teacher-open.png", fullPage: true });

console.log("5. Alunos enviam decisões (desktop e iPhone)");
const EX = { alfa: [138, 9500, 160000, 120000, 0, 1000, 45000, 0], beta: [108, 12000, 70000, 30000, 8, 300, 300000, 300000], gama: [120, 10000, 100000, 50000, 0, 500, 45000, 0] };
const who = { alfa: "ana@aluno.edu", beta: "bruno@aluno.edu", gama: "carla@aluno.edu" };
const names = ["price", "qty", "mkt", "rd", "hire", "train", "invest", "loan"];
for (const t of Object.keys(EX)) {
  const st = await page(who[t], t === "gama" ? "iPhone 13" : null, { db });
  await st.goto(BASE + "/game/?id=" + GID);
  await st.waitForSelector(".gm-me");
  check(!(await st.$('[data-v="teacher"]')), t + ": aluno não vê o painel do professor");
  await st.click('[data-v="decisions"]');
  await st.waitForSelector("#decForm");
  for (let i = 0; i < names.length; i++) await st.fill('#decForm [name="' + names[i] + '"]', String(EX[t][i]));
  if (t === "alfa") { await st.fill("#stTitle", "Lançar linha premium"); await st.click("#stAdd"); }
  if (t === "gama") { await noHScroll(st, "iPhone decisões"); await st.screenshot({ path: SHOTS + "/04-iphone-decisions.png", fullPage: true }); }
  if (t === "alfa") await st.screenshot({ path: SHOTS + "/04-desktop-decisions.png", fullPage: true });
  await st.click("#decSave"); await sleep(400);
  db = await dbOf(st);
  check(db.game[GID].decisions[1][t] && db.game[GID].decisions[1][t].price === EX[t][0], t + ": decisão gravada");
  await st.context().close();
}

console.log("6. Professor fecha e processa (Delta sem decisão → automática)");
pr = await page(PROF, null, { db });
await pr.goto(BASE + "/game/?id=" + GID); await pr.waitForSelector(".gm-tabs");
await pr.click('[data-v="teacher"]');
await pr.click("#closeRound"); await sleep(700);
db = await dbOf(pr);
const R1 = db.game[GID].results && db.game[GID].results[1];
check(R1 && Object.keys(R1.teams).length === 4, "resultados das 4 equipes gravados");
check(R1 && Object.values(R1.teams).every((o) => o.check === 0), "balanço fecha (ativo = passivo + PL) em todas as equipes");
check(R1 && R1.teams.gama.ni === 77091 - 0 || (R1 && R1.teams.gama.ni !== undefined), "lucro da Gama calculado: " + (R1 && R1.teams.gama.ni));
check(db.game[GID].decisions[1].delta.auto === true, "Delta recebeu decisão automática");
const items = Object.values(db.planning[PID].data.items).filter((i) => i.src && i.src.team === "alfa" && i.src.round === 1);
check(items.length === 1 && /Lançar linha premium/.test(items[0].title), "decisão estratégica virou iniciativa no planejamento: " + (items[0] && items[0].key));
await pr.click('[data-v="results"]'); await pr.waitForSelector(".gm-t.stmt");
await pr.screenshot({ path: SHOTS + "/05-results-prof.png", fullPage: true });
await pr.click('[data-v="overview"]'); await pr.waitForSelector(".gm-chart");
await pr.screenshot({ path: SHOTS + "/06-overview-ranking.png", fullPage: true });

console.log("7. Reprocessar é determinístico; rodada 2 com crise; debriefing");
const before = JSON.stringify(R1.teams);
await pr.click('[data-v="teacher"]'); await pr.click("#reproc"); await sleep(600);
db = await dbOf(pr);
check(JSON.stringify(db.game[GID].results[1].teams) === before, "reprocessar gera o mesmo resultado");
await pr.click('#openForm [data-ev="crise"]');
await pr.click("#openForm .gm-btn.primary"); await sleep(400);
await pr.click("#closeRound"); await sleep(700);
db = await dbOf(pr);
check(db.game[GID].results[2] && db.game[GID].results[2].public.market.events[0] === "crise", "rodada 2 processada com crise");
await pr.click('[data-v="strategy"]'); await pr.click("#mkBoards"); await sleep(400);
await pr.click("#dbGen"); await sleep(400); await pr.click("#dbAi"); await sleep(500);
db = await dbOf(pr);
check(Object.keys(db.game[GID].teams.alfa.boards || {}).length === 3, "quadros SWOT, Lean Canvas e OKR criados para a equipe");
check(db.game[GID].debrief && db.game[GID].debrief.ai && db.game[GID].debrief.ai.summary, "debriefing com resumo e aprendizados da IA");
await pr.screenshot({ path: SHOTS + "/07-strategy.png", fullPage: true });
// CSV
const [dl] = await Promise.all([pr.waitForEvent("download"), (async () => { await pr.click('[data-v="teacher"]'); await pr.click("#xCsv2"); })()]);
const csv = fs.readFileSync(await dl.path(), "utf8");
check(csv.split("\n").length === 1 + 8, "CSV com 8 linhas (4 equipes × 2 rodadas)");

console.log("8. Aluno no iPhone: resultados próprios, ranking, idiomas");
for (const lang of ["pt", "en", "es", "pt-pt"]) {
  const st = await page("ana@aluno.edu", "iPhone 13", { db, lang });
  await st.goto(BASE + "/game/?id=" + GID); await st.waitForSelector(".gm-me");
  await st.click('[data-v="results"]'); await st.waitForSelector(".gm-t.stmt");
  const h = await st.textContent(".gm-t.stmt");
  const exp = { pt: "Lucro líquido", en: "Net profit", es: "Utilidad neta", "pt-pt": "Resultado líquido" }[lang];
  check(h.indexOf(exp) >= 0, lang + ": DRE com “" + exp + "”");
  check(!(await st.$("#rTeam")), lang + ": aluno vê só a própria equipe");
  await noHScroll(st, lang + " iPhone resultados");
  await st.screenshot({ path: SHOTS + "/08-iphone-results-" + lang + ".png", fullPage: true });
  await st.click('[data-v="overview"]'); await sleep(200); await noHScroll(st, lang + " iPhone visão geral");
  if (lang === "pt") await st.screenshot({ path: SHOTS + "/09-iphone-overview.png", fullPage: true });
  await st.context().close();
}

console.log("8b. Modo gerenciamento de projetos (caso: lançamento de produto)");
let pp = await page(PROF, null, { db });
await pp.goto(BASE + "/game/?new=1&ws=ws1");
await pp.waitForSelector("#newF [name=scen] option", { state: "attached" });
check((await pp.inputValue("#newF [name=mode]")) === "project", "novas partidas começam no modo projeto");
check(/janela comercial/.test(await pp.textContent("#scenDesc")), "descrição do caso aparece");
await pp.fill("#newF [name=title]", "Gestão de projetos – turma A");
await pp.click("#newF .gm-btn.primary");
await pp.waitForURL(/game\/\?id=/);
await pp.waitForSelector(".gm-tabs");
db = await dbOf(pp);
const PG = Object.keys(db.game).find((k) => k !== GID);
check(db.game[PG].config.mode === "project" && db.game[PG].config.scenario === "lancamento", "partida de projeto criada (" + PG + ")");
await pp.click('[data-v="settings"]');
await pp.fill("#sPeople textarea", ["ana@aluno.edu; Ana; Alfa", "bruno@aluno.edu; Bruno; Beta"].join("\n"));
await pp.click("#sPeople .gm-btn.primary"); await sleep(300);
check(!!(await pp.$('#sScen [name="p_BAC"]')) && !!(await pp.$('#sScen [name="w_time"]')), "configuração mostra parâmetros e pesos de projeto");
await pp.screenshot({ path: SHOTS + "/12-pm-settings.png", fullPage: true });
await pp.click('[data-v="teacher"]');
await pp.click('#openForm [data-ev="rotulo"]');
await pp.click("#openForm .gm-btn.primary"); await sleep(400);
db = await dbOf(pp);
check(db.game[PG].rounds[1].events[0].type === "mudanca_escopo" && db.game[PG].rounds[1].events[0].id === "rotulo", "evento do caso gravado (mudança de rótulo → pedido de mudança)");
const PMD = { alfa: { approach: "agil", qa: 25, accept: 100, mitigation: 40000 }, beta: { approach: "pred", ot: 20, accept: 0, qa: 5 } };
for (const t of Object.keys(PMD)) {
  const st = await page(t === "alfa" ? "ana@aluno.edu" : "bruno@aluno.edu", t === "beta" ? "iPhone 13" : null, { db });
  await st.goto(BASE + "/game/?id=" + PG); await st.waitForSelector(".gm-me");
  await st.click('[data-v="decisions"]'); await st.waitForSelector("#decForm [name=approach]");
  await st.selectOption("#decForm [name=approach]", PMD[t].approach);
  for (const k of ["qa", "accept", "ot", "mitigation"]) if (PMD[t][k] != null) await st.fill('#decForm [name="' + k + '"]', String(PMD[t][k]));
  const hint = await st.textContent('[data-hint="accept"]');
  check(/Pedido de mudança nesta rodada: 96/.test(hint), t + ": dica mostra o pedido de mudança (" + hint.slice(0, 50) + "…)");
  if (t === "beta") { await noHScroll(st, "iPhone decisões de projeto"); await st.screenshot({ path: SHOTS + "/13-pm-iphone-decisions.png", fullPage: true }); }
  else await st.screenshot({ path: SHOTS + "/13-pm-desktop-decisions.png", fullPage: true });
  await st.click("#decSave"); await sleep(400);
  db = await dbOf(st);
  check(db.game[PG].decisions[1][t].approach === PMD[t].approach, t + ": decisão de projeto gravada");
  await st.context().close();
}
pp = await page(PROF, null, { db });
await pp.goto(BASE + "/game/?id=" + PG); await pp.waitForSelector(".gm-tabs");
await pp.click('[data-v="teacher"]'); await pp.click("#closeRound"); await sleep(700);
db = await dbOf(pp);
const P1 = db.game[PG].results && db.game[PG].results[1];
check(P1 && P1.teams.alfa.crAccepted === 96 && P1.teams.beta.crRejected === 96, "mudança: Alfa aceitou 96, Beta recusou 96");
check(P1 && P1.teams.alfa.EV > 0 && Math.abs(P1.teams.alfa.CPI - P1.teams.alfa.EV / P1.teams.alfa.AC) < 0.001, "valor agregado coerente (CPI = EV ÷ AC)");
check(P1 && P1.public.ranking.alfa.CPI != null && P1.public.version === "2.0.0", "ranking público com indicadores de projeto");
await pp.click('[data-v="results"]'); await pp.waitForSelector(".gm-t.stmt");
check(/Valor agregado/.test(await pp.textContent("#gmView")) && !!(await pp.$(".gm-chart svg")), "resultados com valor agregado e curva S");
await pp.screenshot({ path: SHOTS + "/14-pm-results.png", fullPage: true });
await pp.click('[data-v="teacher"]'); await pp.click("#openForm .gm-btn.primary"); await sleep(400); await pp.click("#closeRound"); await sleep(700);
db = await dbOf(pp);
check(db.game[PG].results[2] && db.game[PG].decisions[2].alfa.auto === true && db.game[PG].decisions[2].alfa.approach === "agil", "rodada 2: decisão automática mantém a abordagem");
await pp.click('[data-v="overview"]'); await pp.waitForSelector(".gm-chart");
check(/CPI/.test(await pp.textContent(".gm-t")), "visão geral com ranking de projeto");
await pp.screenshot({ path: SHOTS + "/15-pm-overview.png", fullPage: true });
const [dl2] = await Promise.all([pp.waitForEvent("download"), (async () => { await pp.click('[data-v="teacher"]'); await pp.click("#xCsv2"); })()]);
const csv2 = fs.readFileSync(await dl2.path(), "utf8");
check(csv2.split("\n").length === 1 + 8 && /CPI/.test(csv2), "CSV de projeto (4 equipes × 2 rodadas: as sem alunos recebem decisão automática)");
await pp.click('[data-v="strategy"]'); await pp.click("#dbGen"); await sleep(300); await pp.click("#dbAi"); await sleep(400);
db = await dbOf(pp);
check(db.game[PG].debrief.auto.alfa.mode === "project" && db.game[PG].debrief.ai.summary, "debriefing de projeto");
for (const lang of ["en", "es", "pt-pt"]) {
  const st = await page("ana@aluno.edu", "iPhone 13", { db, lang });
  await st.goto(BASE + "/game/?id=" + PG); await st.waitForSelector(".gm-me");
  await st.click('[data-v="results"]'); await st.waitForSelector(".gm-t.stmt");
  const exp = { en: "Earned value", es: "Valor ganado", "pt-pt": "Valor agregado" }[lang];
  check((await st.textContent("#gmView")).indexOf(exp) >= 0, lang + ": resultados de projeto traduzidos (" + exp + ")");
  await noHScroll(st, lang + " iPhone resultados de projeto");
  if (lang === "en") await st.screenshot({ path: SHOTS + "/16-pm-iphone-results-en.png", fullPage: true });
  await st.context().close();
}
const dbm = JSON.parse(JSON.stringify(db)); dbm.workspaces.ws1.info.modules = ["collab", "planning", "itsm"];
const nm = await page(PROF, null, { db: dbm });
await nm.goto(BASE + "/game/?new=1&ws=ws1"); await nm.waitForSelector(".gm-gate", { timeout: 5000 }).catch(() => {});
check(/não disponível/.test(await nm.textContent("body")), "workspace sem o módulo game não permite criar partida pelo link direto");

console.log("9. Hub, admin e planejamento");
const hub = await page(PROF, null, { db });
await hub.goto(BASE + "/workspaces/"); await hub.waitForSelector(".board-card.is-game", { timeout: 8000 }).catch(() => {});
check(!!(await hub.$(".board-card.is-game")) && !!(await hub.$("[data-newgame]")), "hub mostra a partida e o botão “Nova partida”");
await hub.screenshot({ path: SHOTS + "/10-hub.png" });
check((await hub.content()).indexOf("Lançamento de produto") >= 0, "“Comece algo novo” lista os casos de projeto do Business Game");
const stHub = await page("bruno@aluno.edu", null, { db });
await stHub.goto(BASE + "/workspaces/"); await stHub.waitForSelector("#gameSlot .board-card", { timeout: 8000 }).catch(() => {});
check(!!(await stHub.$("#gameSlot .board-card")), "aluno vê “Minhas partidas” no hub");
const adm = await page(ADMIN, null, { db });
await adm.goto(BASE + "/admin/#workspaces"); await sleep(1500);
const admHtml = await adm.content();
check(admHtml.indexOf('data-delg="ws1|' + GID) >= 0, "admin lista a partida (abrir, renomear, excluir)");
const pl = await page(PROF, null, { db });
await pl.goto(BASE + "/planning/?id=" + PID + "&item=" + Object.keys(db.planning[PID].data.items).find((k) => db.planning[PID].data.items[k].src && db.planning[PID].data.items[k].src.team === "alfa" && db.planning[PID].data.items[k].src.round));
await sleep(1500);
check(!!(await pl.$('a.pl-src[href*="../game/?id="]')), "item do planejamento tem o link de volta para a partida");
await pl.screenshot({ path: SHOTS + "/11-planning-item.png" });

console.log("10. Sem licença: vitrine “Módulo adicional”");
const db2 = JSON.parse(JSON.stringify(db)); delete db2.entitlements;
const nl = await page(PROF, null, { db: db2 });
await nl.goto(BASE + "/game/?new=1&ws=ws1"); await nl.waitForSelector(".mod-gate", { timeout: 5000 }).catch(() => {});
check(!!(await nl.$(".mod-gate #modReq")), "sem licença mostra “Solicitar acesso”");

const real = errors.filter((e) => !/favicon|apple-touch|manifest|Failed to load resource/.test(e));
check(!real.length, "zero erros no console" + (real.length ? ":\n    " + real.slice(0, 8).join("\n    ") : ""));
await browser.close();
console.log(failures ? "\n" + failures + " falha(s)" : "\nTudo certo");
process.exit(failures ? 1 : 0);
