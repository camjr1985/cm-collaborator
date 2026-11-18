/* Business Game – project management engine tests. Run: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../assets/js/game-project-engine.js");

function play(sc, decide, rounds, eventsAt) {
  const p = E.params(sc); let st = { a: E.initState(p) }, last = null; const all = [];
  for (let t = 1; t <= (rounds || 10); t++) {
    const d = Object.assign({}, E.defaultDecision(p, st.a), decide ? decide(t, st.a, p) : {});
    const r = E.runRound(p, st, { a: d }, t, (eventsAt && eventsAt[t]) || []);
    last = r.teams.a; all.push(last); st = { a: last.state };
  }
  return { p: p, last: last, all: all };
}

test("deterministic and independent of team order", function () {
  const p = E.params("erp"), s = { b: E.initState(p), a: E.initState(p) }, s2 = { a: E.initState(p), b: E.initState(p) };
  const d = { a: { approach: "agil", qa: 20, hire: 2 }, b: { approach: "pred", ot: 10 } };
  const ev = [{ type: "mudanca_escopo" }, { type: "atraso" }];
  assert.deepEqual(E.runRound(p, s, d, 1, ev), E.runRound(p, s2, d, 1, ev));
  const sim = E.simulate(p, ["a", "b"], [{ decisions: d }, { decisions: d, events: ev }]);
  assert.deepEqual(sim[1], E.runRound(p, { a: sim[0].teams.a.state, b: sim[0].teams.b.state }, d, 2, ev));
});

test("earned value is consistent: EV = BAC × % complete, CPI = EV/AC, SPI = EV/PV", function () {
  const r = play("lancamento", null, 4).last;
  assert.equal(r.EV, Math.round(r.BAC * r.done / r.scope));
  assert.ok(Math.abs(r.CPI - r.EV / r.AC) < 0.001);
  assert.ok(Math.abs(r.SPI - r.EV / r.PV) < 0.001);
  assert.equal(r.PV, Math.round(r.BAC * 4 / 6));
  assert.equal(r.cost.total, r.cost.payroll + r.cost.people + r.cost.material + r.cost.outsourcing + r.cost.training + r.cost.mitigation + r.cost.comms);
});

test("median decisions: product launch, ERP and construction land close to plan; the PMO needs descoping", function () {
  ["lancamento", "erp", "obra"].forEach(function (sc) {
    const g = play(sc, null, 12);
    assert.ok(g.last.finished > 0 && g.last.finished <= g.p.N + 2, sc + " finishes near plan (" + g.last.finished + ")");
    assert.ok(g.last.AC < g.last.BAC * 1.15, sc + " cost within 15% of budget");
  });
  const pmo = play("pmo", null, 12), cut = play("pmo", function (t) { return t === 1 ? { descope: 450 } : {}; }, 12);
  assert.ok(pmo.last.finished > pmo.p.N + 2, "PMO without cuts is very late");
  assert.ok(cut.last.finished < pmo.last.finished && cut.last.AC < pmo.last.AC, "cutting scope saves time and money");
  assert.ok(cut.all[0].stake < pmo.all[0].stake, "…but stakeholders feel the cut");
});

test("quality effort reduces defects and helps finish on time", function () {
  const low = play("lancamento", function () { return { qa: 0 }; }, 12), high = play("lancamento", function () { return { qa: 30, hire: 0 }; }, 12);
  assert.ok(high.last.quality > low.last.quality + 5);
  const base = play("lancamento", null, 12), more = play("lancamento", function (t) { return t === 1 ? { hire: 2, qa: 25 } : { qa: 25 }; }, 12);
  assert.ok(more.last.finished <= base.last.finished);
});

test("overtime raises capacity but erodes morale; training raises morale", function () {
  const p = E.params("lancamento"), s = E.initState(p);
  const a = E.runRound(p, { a: s }, { a: { ot: 0 } }, 1, []).teams.a, b = E.runRound(p, { a: s }, { a: { ot: 30 } }, 1, []).teams.a;
  assert.ok(b.work > a.work && b.morale < a.morale && b.cost.payroll > a.cost.payroll);
  const t = E.runRound(p, { a: s }, { a: { train: p.init.W * p.trRef } }, 1, []).teams.a;
  assert.ok(t.morale > a.morale);
});

test("change requests: accepting grows scope, budget and stakeholder satisfaction; predictive makes changes more expensive", function () {
  const p = E.params("erp"), s = E.initState(p), ev = [{ type: "mudanca_escopo" }];
  const acc = E.runRound(p, { a: s }, { a: { accept: 100, approach: "agil" } }, 1, ev).teams.a;
  const rej = E.runRound(p, { a: s }, { a: { accept: 0, approach: "agil" } }, 1, ev).teams.a;
  const pred = E.runRound(p, { a: s }, { a: { accept: 100, approach: "pred" } }, 1, ev).teams.a;
  assert.equal(acc.crUnits, 150); assert.equal(acc.crAccepted, 150); assert.equal(rej.crRejected, 150);
  assert.ok(acc.scope > rej.scope && acc.BAC > rej.BAC && acc.stake > rej.stake);
  assert.ok(pred.scope > acc.scope, "predictive absorbs changes with more work");
});

test("risk mitigation lowers exposure and softens the impact of events", function () {
  const ev = { 3: [{ type: "atraso", k: 0.4 }, { type: "saida_chave", k: 3 }] };
  const none = play("obra", function () { return { mitigation: 0 }; }, 3, ev), mit = play("obra", function (t, s, p) { return { mitigation: p.E0 * 0.6 / p.mitEff }; }, 3, ev);
  assert.ok(mit.all[1].risk < none.all[1].risk);
  assert.ok(mit.last.work > none.last.work, "lower exposure → smaller delay");
  assert.ok(mit.last.lost <= none.last.lost);
});

test("events: cost rise, budget cut, rework and competitor", function () {
  const p = E.params("lancamento"), s = E.initState(p), base = E.runRound(p, { a: s }, {}, 1, []).teams.a;
  assert.ok(E.runRound(p, { a: s }, {}, 1, [{ type: "alta_custos" }]).teams.a.cost.material > base.cost.material);
  assert.equal(E.runRound(p, { a: s }, {}, 1, [{ type: "corte_orcamento" }]).teams.a.BAC, Math.round(p.BAC * 0.9));
  const g = play("lancamento", null, 3, { 3: [{ type: "retrabalho" }] }), h = play("lancamento", null, 3);
  assert.ok(g.last.done < h.last.done, "rework consumes capacity");
  const c = play("lancamento", null, 2, { 2: [{ type: "concorrente" }] }), d = play("lancamento", null, 2);
  assert.ok(c.last.value < d.last.value);
});

test("limits are enforced", function () {
  const p = E.params("lancamento"), s = E.initState(p);
  const c = E.clampDecision({ hire: -99, ot: 80, qa: -5, outsource: 9999, descope: 99999, approach: "xyz", accept: 300 }, s, p, 1);
  assert.equal(c.d.hire, 1 - s.W); assert.equal(c.d.ot, 30); assert.equal(c.d.qa, 0); assert.equal(c.d.outsource, p.outMax);
  assert.equal(c.d.descope, Math.floor(p.S0 * 0.5)); assert.equal(c.d.approach, "hib"); assert.equal(c.d.accept, 100);
  const s2 = Object.assign({}, s, { approach: "agil" });
  assert.equal(E.clampDecision({ approach: "pred" }, s2, p, 2).d.approach, "agil", "approach is chosen once");
});

test("finished projects stop spending", function () {
  const g = play("lancamento", null, 12);
  const i = g.all.findIndex(function (o) { return o.finished; });
  assert.ok(i >= 0); assert.equal(g.all[g.all.length - 1].cost.total, 0);
});

test("ranking: weighted min-max; currency conversion scales money only", function () {
  const p = E.params("erp"), s = { a: E.initState(p), b: E.initState(p) };
  const r = E.runRound(p, s, { a: { qa: 30, comms: 40000 }, b: { qa: 0, comms: 0 } }, 1, []);
  const sc = E.score(r.teams, { quality: 1 });
  assert.equal(sc.a, 100); assert.equal(sc.b, 0);
  const q = E.convert(p, 2);
  assert.equal(q.BAC, p.BAC * 2); assert.equal(q.S0, p.S0); assert.equal(q.init.W, p.init.W);
});

test("surprise event is deterministic and respects the allowed list", function () {
  assert.equal(E.surprise("g:2"), E.surprise("g:2"));
  assert.equal(E.surprise("x", ["atraso"]), "atraso");
});
