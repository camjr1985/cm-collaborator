/* Business Game engine – unit tests. Run: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../assets/js/game-engine.js");

const IDS = ["alfa", "beta", "delta", "gama"];
const EXAMPLE = { // the worked example in the game design doc (Indústria, round 1)
  alfa: { price: 138, qty: 9500, mkt: 160000, rd: 120000, hire: 0, train: 1000, invest: 45000, loan: 0, amort: 0 },
  beta: { price: 108, qty: 12000, mkt: 70000, rd: 30000, hire: 8, train: 300, invest: 300000, loan: 300000, amort: 0 },
  gama: { price: 120, qty: 10000, mkt: 100000, rd: 50000, hire: 0, train: 500, invest: 45000, loan: 0, amort: 0 },
  delta: { price: 122, qty: 11000, mkt: 260000, rd: 40000, hire: 4, train: 500, invest: 45000, loan: 200000, amort: 0 }
};
function states(p) { const s = {}; IDS.forEach(function (id) { s[id] = E.initState(p); }); return s; }
function next(r) { const s = {}; Object.keys(r.teams).forEach(function (id) { s[id] = r.teams[id].state; }); return s; }

test("worked example matches the design doc (Gama)", function () {
  const p = E.params("industria"), r = E.runRound(p, states(p), EXAMPLE, 1, []);
  const g = r.teams.gama;
  assert.equal(r.market.avgPrice, 122);
  assert.equal(g.sales, 9436); assert.equal(g.revenue, 1132320); assert.equal(g.cogs, 330260);
  assert.equal(g.ebit, 140804); assert.equal(g.interest, 24000); assert.equal(g.tax, 39713); assert.equal(g.ni, 77091);
  assert.equal(g.bs.cash, 557351); assert.equal(g.bs.stockU, 1564); assert.equal(g.bs.equity, 1612091);
  assert.equal(r.teams.beta.nextCap, 13700);
});

test("balance sheet closes for every team, every round, every scenario and event", function () {
  Object.keys(E.SCENARIOS).forEach(function (sc) {
    const p = E.params(sc); let s = states(p);
    const evs = [[], [{ type: "crise" }], [{ type: "insumos" }, { type: "concorrente" }], [{ type: "juros" }, { type: "greve" }], [{ type: "boom" }], [], [], []];
    for (let t = 1; t <= 8; t++) {
      const d = {}; IDS.forEach(function (id, i) { d[id] = Object.assign({}, EXAMPLE[id] || EXAMPLE.gama, { price: p.Pref * (0.8 + 0.15 * i), qty: (p.D0 / 4) * (0.7 + 0.2 * i) }); });
      const r = E.runRound(p, s, d, t, evs[t - 1]);
      IDS.forEach(function (id) {
        const o = r.teams[id];
        assert.equal(o.check, 0, sc + " r" + t + " " + id);
        assert.ok(o.bs.cash >= 0, "cash never negative (emergency loan)");
        assert.equal(o.ni, o.revenue - o.cogs - o.opex - o.interest - o.tax);
        assert.equal(o.cf.end, o.cf.start + o.cf.receipts + o.cf.production + o.cf.expenses + o.cf.interest + o.cf.tax + o.cf.invest + o.cf.loan + o.cf.amort + o.cf.emergency);
      });
      s = next(r);
    }
  });
});

test("deterministic: same input gives the same output; replay equals step by step", function () {
  const p = E.params("industria");
  const a = E.runRound(p, states(p), EXAMPLE, 1, [{ type: "crise" }]);
  const b = E.runRound(p, states(p), EXAMPLE, 1, [{ type: "crise" }]);
  assert.deepEqual(a, b);
  const rounds = [{ decisions: EXAMPLE }, { decisions: EXAMPLE, events: [{ type: "crise" }] }];
  const sim = E.simulate(p, IDS, rounds);
  const r1 = E.runRound(p, states(p), EXAMPLE, 1, []), r2 = E.runRound(p, next(r1), EXAMPLE, 2, [{ type: "crise" }]);
  assert.deepEqual(sim[1], r2);
  // team order in the input object does not matter
  const s = states(p), rev = {}; IDS.slice().reverse().forEach(function (id) { rev[id] = s[id]; });
  assert.deepEqual(E.runRound(p, rev, EXAMPLE, 1, []), r1);
});

test("market: shares sum to 1, lower price and more marketing win share", function () {
  const p = E.params("industria"), r = E.runRound(p, states(p), EXAMPLE, 1, []);
  const tot = IDS.reduce(function (a, id) { return a + r.teams[id].share; }, 0);
  assert.ok(Math.abs(tot - 1) < 1e-9);
  const base = Object.assign({}, EXAMPLE.gama), d = {}; IDS.forEach(function (id) { d[id] = Object.assign({}, base); });
  d.alfa = Object.assign({}, base, { price: 110 }); d.beta = Object.assign({}, base, { mkt: 200000 });
  const q = E.runRound(p, states(p), d, 1, []);
  assert.ok(q.teams.alfa.demand > q.teams.gama.demand); assert.ok(q.teams.beta.demand > q.teams.gama.demand);
});

test("events change the market as specified", function () {
  const p = E.params("industria"), base = E.runRound(p, states(p), EXAMPLE, 1, []).market.demand;
  assert.equal(E.runRound(p, states(p), EXAMPLE, 1, [{ type: "crise" }]).market.demand, Math.round(base * 0.75));
  const ins = E.runRound(p, states(p), EXAMPLE, 1, [{ type: "insumos" }]).teams.gama;
  assert.ok(ins.cogs > 330260);
  const comp = E.runRound(p, states(p), EXAMPLE, 1, [{ type: "concorrente" }]);
  assert.ok(comp.market.sales < E.runRound(p, states(p), EXAMPLE, 1, []).market.sales);
  const st = E.runRound(p, states(p), EXAMPLE, 1, [{ type: "greve" }]).teams.beta;
  assert.ok(st.maxProd < 12000 && st.warn.indexOf("qty-cut") >= 0);
  assert.equal(E.runRound(p, states(p), EXAMPLE, 1, [{ type: "juros", k: 0.05 }]).teams.gama.interest, 40000);
});

test("stock-out spills demand to competitors; perishable scenarios keep no stock", function () {
  const p = E.params("industria"), d = {}; IDS.forEach(function (id) { d[id] = Object.assign({}, EXAMPLE.gama); });
  d.alfa = Object.assign({}, EXAMPLE.gama, { qty: 2000 });
  const r = E.runRound(p, states(p), d, 1, []);
  assert.ok(r.teams.alfa.fill < 1); assert.ok(r.teams.gama.spillIn > 0);
  const s = E.params("servicos"), rs = E.runRound(s, states(s), d, 1, []);
  IDS.forEach(function (id) { assert.equal(rs.teams[id].bs.stockU, 0); });
});

test("limits: price band, debt ceiling, firing, production capacity, emergency loan", function () {
  const p = E.params("industria"), s = E.initState(p);
  const c = E.clampDecision({ price: 10, loan: 9e9, hire: -999, qty: -5 }, s, p);
  assert.equal(c.d.price, 60); assert.equal(c.d.hire, -40); assert.equal(c.d.qty, 0);
  assert.equal(c.d.loan, Math.round(0.6 * (s.cash + s.stockV + s.imob)) - s.debt);
  assert.ok(c.warn.indexOf("loan-max") >= 0);
  const d = {}; IDS.forEach(function (id) { d[id] = Object.assign({}, EXAMPLE.gama); });
  d.alfa = Object.assign({}, EXAMPLE.gama, { mkt: 2000000 });
  const r = E.runRound(p, states(p), d, 1, []);
  assert.ok(r.teams.alfa.state.emerg > 0 && r.teams.alfa.bs.cash === 0 && r.teams.alfa.warn.indexOf("emergency") >= 0);
});

test("ranking: weighted min-max, best gets 100 on a criterion", function () {
  const p = E.params("industria"), r = E.runRound(p, states(p), EXAMPLE, 1, []);
  const sc = E.score(r.teams);
  assert.equal(sc.gama, 78.2); assert.equal(sc.alfa, 20);
  const only = E.score(r.teams, { profit: 1 });
  assert.equal(only.gama, 100); assert.equal(only.alfa, 0);
});

test("currency conversion keeps the economics (same units, profit scaled)", function () {
  const p = E.params("industria"), q = E.convert(p, 2);
  const a = E.runRound(p, states(p), EXAMPLE, 1, []);
  const d2 = {}; IDS.forEach(function (id) { const x = Object.assign({}, EXAMPLE[id]); ["price", "mkt", "rd", "train", "invest", "loan", "amort"].forEach(function (k) { x[k] *= 2; }); d2[id] = x; });
  const b = E.runRound(q, states(q), d2, 1, []);
  IDS.forEach(function (id) { assert.equal(b.teams[id].sales, a.teams[id].sales); assert.ok(Math.abs(b.teams[id].ni - 2 * a.teams[id].ni) <= 4); });
});

test("ready-made scenarios: median decisions give a sane first round", function () {
  Object.keys(E.SCENARIOS).forEach(function (sc) {
    const p = E.params(sc), s = states(p), d = {};
    IDS.forEach(function (id) { d[id] = E.defaultDecision(p, s[id], 4); });
    const r = E.runRound(p, s, d, 1, []), o = r.teams.alfa;
    if (sc === "startup") assert.ok(o.ni < 0 && o.bs.cash > 0, "startup burns cash but survives");
    else assert.ok(o.ni > 0, sc + " should be profitable with median decisions, got " + o.ni);
  });
});

test("surprise event is deterministic", function () {
  assert.equal(E.surprise("g1:3"), E.surprise("g1:3"));
  assert.ok(Object.keys(E.EVENTS).indexOf(E.surprise("x")) >= 0);
});
