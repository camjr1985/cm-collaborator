/* CM Collaborator – Business Game: market & accounting engine (pure, deterministic).
 *
 * Same input → same output. No Date, no Math.random, no DOM. Runs in the browser (window.CMGameEngine)
 * and in Node (require) so the professor's browser computes the round in v1 and a server can take over later.
 *
 *   SCENARIOS                 ready-made scenarios (industria, varejo, servicos, startup): params + initial state
 *   DECISIONS / EVENTS        catalogs (ids only – labels live in the UI dictionaries)
 *   params(scenarioId, over)  scenario params merged with overrides (deep for .init)
 *   convert(params, factor)   multiply every monetary parameter (currency change keeping the scale)
 *   initState(params)         state of a company at the start of the game
 *   clampDecision(d, st, p)   decision limited to what the rules allow → { d, warn: [codes] }
 *   defaultDecision(p, st, n) a "median" decision (form prefill, teams that did not submit in v1 repeat the last one)
 *   runRound(p, states, decs, round, events) → { market, teams: { id: result } }   (teams processed in id order)
 *   simulate(p, teamIds, rounds) → [{ market, teams }] replaying rounds 1..n from the initial state
 *   score(teamsRes, weights)  → { id: 0..100 } weighted min-max ranking
 *   surprise(seed)            deterministic pick of an event for "surprise event" (seed = gameId + ":" + round)
 *
 * Money is kept in whole currency units (integers) so the balance sheet closes exactly: assets = liabilities + equity.
 */
(function (root) {
  "use strict";
  const VERSION = "1.0.0";
  const R = Math.round;

  /* ---------------- scenarios ---------------- */
  const BASE = {
    D0: 40000, g: 0.02, Pref: 120, em: 0.5,          // market: base demand, growth/round, reference price, market price elasticity
    e: 2.0, a: 0.35, gq: 0.30, ls: 0.20,              // share: price elasticity, marketing, quality, satisfaction exponents
    cv: 35, sal: 8000, prod: 250, tau: 0.15, trRef: 1000, // unit cost, salary/round, units per worker, training uplift, training ref per worker
    hire: 3000, fire: 6000, capCost: 150, dep: 0.025, stor: 4, adm: 120000,
    r: 0.03, rE: 0.06, tax: 0.34, dB: 0.5, dQ: 0.2, spill: 0.5, perish: false, mult: 2, debtMax: 0.6,
    pMin: 0.5, pMax: 2.0,
    init: { cash: 500000, stockU: 1000, imob: 1800000, debt: 800000, W: 40, B: 200000, Q: 250000, S: 60 }
  };
  function scen(over, init) { const p = Object.assign({}, BASE, over); p.init = Object.assign({}, BASE.init, init || {}); return p; }
  const SCENARIOS = {
    industria: scen({ unit: "unit" }),
    varejo: scen({ unit: "unit", D0: 60000, g: 0.015, Pref: 90, cv: 52, e: 2.5, a: 0.45, gq: 0.15, sal: 6000, prod: 400, capCost: 90, stor: 3, adm: 100000, dB: 0.6 },
      { cash: 600000, stockU: 2000, imob: 1350000, debt: 700000, W: 38, B: 150000, Q: 120000 }),
    servicos: scen({ unit: "hour", D0: 30000, g: 0.015, Pref: 150, cv: 20, e: 1.5, a: 0.30, gq: 0.25, ls: 0.35, sal: 9000, prod: 150, tau: 0.25, capCost: 120, stor: 0, adm: 260000, perish: true },
      { cash: 450000, stockU: 0, imob: 1000000, debt: 500000, W: 50, B: 180000, Q: 220000 }),
    startup: scen({ unit: "subscription", D0: 8000, g: 0.08, Pref: 300, cv: 30, e: 1.2, a: 0.40, gq: 0.50, sal: 18000, prod: 120, tau: 0.15, capCost: 220, stor: 0, adm: 120000, perish: true, mult: 4, r: 0.04, rE: 0.08 },
      { cash: 2000000, stockU: 0, imob: 550000, debt: 0, W: 18, B: 200000, Q: 400000 })
  };
  const MONEY = ["Pref", "cv", "sal", "trRef", "hire", "fire", "capCost", "stor", "adm"];
  const MONEY_INIT = ["cash", "imob", "debt", "B", "Q"];

  const DECISIONS = ["price", "qty", "mkt", "rd", "hire", "train", "invest", "loan", "amort"];
  const EVENTS = {
    crise: { k: 0.75 },        // total demand × k
    boom: { k: 1.2 },          // total demand × k
    concorrente: { k: 1 },     // virtual competitor with k × average attractiveness
    insumos: { k: 1.25 },      // unit cost × k
    juros: { k: 0.045 },       // interest rate per round = k
    greve: { k: 0.8 }          // productivity × k
  };

  function params(id, over) {
    const b = SCENARIOS[id] || SCENARIOS.industria, o = over || {};
    const p = Object.assign({}, b, o); p.init = Object.assign({}, b.init, o.init || {});
    return p;
  }
  function convert(p, f) {
    const q = Object.assign({}, p); q.init = Object.assign({}, p.init);
    MONEY.forEach(function (k) { q[k] = +(p[k] * f).toFixed(4); });
    MONEY_INIT.forEach(function (k) { q.init[k] = R(p.init[k] * f); });
    return q;
  }

  /* ---------------- state ---------------- */
  function initState(p) {
    const i = p.init, stockU = p.perish ? 0 : (i.stockU || 0), stockV = R(stockU * p.cv);
    return { cash: i.cash, stockU: stockU, stockV: stockV, imob: i.imob, debt: i.debt, emerg: 0, W: i.W, B: i.B, Q: i.Q, S: i.S,
      capital: i.cash + stockV + i.imob - i.debt, retained: 0, cumNI: 0, ni: [], share: [] };
  }
  function num(v) { v = Number(v); return isFinite(v) ? v : 0; }
  function assetsOf(s) { return s.cash + s.stockV + s.imob; }

  function clampDecision(d0, s, p) {
    const d = {}, w = [];
    DECISIONS.forEach(function (k) { d[k] = num((d0 || {})[k]); });
    const lo = R(p.Pref * p.pMin), hi = R(p.Pref * p.pMax);
    if (!d.price) d.price = p.Pref;
    if (d.price < lo) { d.price = lo; w.push("price-min"); } if (d.price > hi) { d.price = hi; w.push("price-max"); }
    ["qty", "mkt", "rd", "train", "invest", "loan", "amort"].forEach(function (k) { if (d[k] < 0) { d[k] = 0; w.push(k + "-neg"); } });
    d.hire = Math.trunc(d.hire); d.qty = Math.floor(d.qty); d.price = Math.round(d.price * 100) / 100;
    ["mkt", "rd", "invest", "loan", "amort"].forEach(function (k) { d[k] = R(d[k]); }); d.train = Math.round(d.train * 100) / 100;
    if (d.hire < -s.W) { d.hire = -s.W; w.push("hire-max"); }
    const room = Math.max(0, R(p.debtMax * assetsOf(s)) - s.debt - s.emerg);
    if (d.loan > room) { d.loan = room; w.push("loan-max"); }
    if (d.amort > s.debt + s.emerg) { d.amort = s.debt + s.emerg; w.push("amort-max"); }
    const cashForInv = Math.max(0, s.cash + d.loan);
    if (d.invest > cashForInv) { d.invest = cashForInv; w.push("invest-max"); }
    return { d: d, warn: w };
  }
  function capacityOf(s, p, d, prodK) {
    const W = Math.max(0, s.W + Math.trunc(num(d && d.hire)));
    const tr = Math.min(1, num(d && d.train) / p.trRef);
    const per = p.prod * (1 + p.tau * tr) * (prodK || 1);
    const cap = Math.floor(s.imob / p.capCost);
    return { W: W, trIdx: tr, per: per, cap: cap, max: Math.floor(Math.min(cap, W * per)) };
  }
  function defaultDecision(p, s, n) {
    const share = (p.D0 / Math.max(1, n || 4));
    const c = capacityOf(s, p, { hire: 0, train: 500 });
    return { price: p.Pref, qty: Math.min(c.max, R(share / 100) * 100), mkt: R(p.init.B * p.dB), rd: R(p.init.Q * p.dQ), hire: 0, train: R(p.trRef / 2),
      invest: R(p.init.imob * p.dep), loan: 0, amort: 0 };
  }

  /* ---------------- one round ---------------- */
  function runRound(p0, states, decs, t, events) {
    const p = Object.assign({}, p0); let Dk = 1, phantom = 0, prodK = 1;
    (events || []).forEach(function (ev) {
      const k = ev.k != null ? +ev.k : (EVENTS[ev.type] || {}).k;
      if (ev.type === "crise" || ev.type === "boom") Dk *= k;
      else if (ev.type === "insumos") p.cv = p.cv * k;
      else if (ev.type === "juros") p.r = k;
      else if (ev.type === "concorrente") phantom += k;
      else if (ev.type === "greve") prodK *= k;
    });
    const ids = Object.keys(states).sort(), n = ids.length, T = {};
    if (!n) return { market: null, teams: {} };
    ids.forEach(function (id) {
      const s = states[id], cd = clampDecision(decs[id], s, p), d = cd.d, x = { d: d, warn: cd.warn.slice() };
      x.amort = d.amort; const amE = Math.min(d.amort, s.emerg);
      x.emerg = s.emerg - amE; x.debt = s.debt - (d.amort - amE) + d.loan;
      const c = capacityOf(s, p, d, prodK); x.c = c;
      x.prodU = Math.min(d.qty, c.max); if (d.qty > c.max) x.warn.push("qty-cut");
      x.hireCost = Math.max(0, d.hire) * p.hire + Math.max(0, -d.hire) * p.fire;
      x.B = s.B * (1 - p.dB) + d.mkt; x.Q = s.Q * (1 - p.dQ) + d.rd;
      x.avail = s.stockU + x.prodU; T[id] = x;
    });
    function mean(f) { return ids.reduce(function (a, id) { return a + f(T[id], states[id]); }, 0) / n; }
    const Pm = mean(function (x) { return x.d.price; }), Bm = mean(function (x) { return x.B; }) || 1, Qm = mean(function (x) { return x.Q; }) || 1;
    const Sm = mean(function (x, s) { return s.S; }) || 1;
    const D = p.D0 * Math.pow(1 + p.g, t - 1) * Dk * Math.pow(Pm / p.Pref, -p.em);
    let sumA = 0;
    ids.forEach(function (id) {
      const x = T[id];
      x.A = Math.pow(x.d.price / Pm, -p.e) * Math.pow(Math.max(x.B, 1) / Bm, p.a) * Math.pow(Math.max(x.Q, 1) / Qm, p.gq) * Math.pow(Math.max(states[id].S, 1) / Sm, p.ls);
      sumA += x.A;
    });
    const total = sumA + phantom * sumA / n;
    ids.forEach(function (id) { const x = T[id]; x.dem = D * x.A / total; x.sales = Math.min(x.dem, x.avail); x.spillIn = 0; });
    const unmet = ids.reduce(function (a, id) { return a + (T[id].dem - T[id].sales); }, 0) * p.spill;
    const open = ids.filter(function (id) { return T[id].avail - T[id].sales > 1e-9; });
    const sA = open.reduce(function (a, id) { return a + T[id].A; }, 0);
    if (unmet > 0 && sA > 0) open.forEach(function (id) { const x = T[id]; x.spillIn = Math.min(unmet * x.A / sA, x.avail - x.sales); x.sales += x.spillIn; });
    ids.forEach(function (id) { T[id].sales = Math.floor(T[id].sales + 1e-9); });
    const totSales = ids.reduce(function (a, id) { return a + T[id].sales; }, 0);

    const out = {};
    ids.forEach(function (id) {
      const s = states[id], x = T[id], d = x.d, o = { decision: d, warn: x.warn };
      o.demand = R(x.dem); o.sales = x.sales; o.spillIn = Math.floor(x.spillIn); o.prod = x.prodU; o.cap = x.c.cap; o.maxProd = x.c.max; o.W = x.c.W; o.price = d.price;
      const prodCost = R(x.prodU * p.cv), valAvail = s.stockV + prodCost;
      o.revenue = R(x.sales * d.price);
      o.cogs = x.avail ? R(valAvail * x.sales / x.avail) : 0;
      let leftU = x.avail - x.sales, leftV = valAvail - o.cogs, lost = 0;
      if (p.perish) { lost = leftV; leftU = 0; leftV = 0; }
      o.gross = o.revenue - o.cogs;
      o.salaries = x.c.W * p.sal; o.hiring = x.hireCost; o.training = R(d.train * x.c.W); o.mkt = d.mkt; o.rd = d.rd;
      o.storage = R(leftU * p.stor); o.adm = p.adm; o.depr = R(s.imob * p.dep); o.idle = lost;
      const paid = o.salaries + o.hiring + o.training + o.mkt + o.rd + o.storage + o.adm;
      o.opex = paid + o.depr + o.idle;
      o.ebit = o.gross - o.opex;
      o.interest = R(x.debt * p.r + x.emerg * p.rE);
      o.ebt = o.ebit - o.interest; o.tax = o.ebt > 0 ? R(o.ebt * p.tax) : 0; o.ni = o.ebt - o.tax;
      let cash = s.cash + o.revenue - prodCost - paid - o.interest - o.tax - d.invest + d.loan - d.amort;
      let emerg = x.emerg, newE = 0;
      if (cash < 0) { newE = -cash; emerg += newE; cash = 0; o.warn.push("emergency"); }
      o.cf = { start: s.cash, receipts: o.revenue, production: -prodCost, expenses: -paid, interest: -o.interest, tax: -o.tax, invest: -d.invest, loan: d.loan, amort: -d.amort, emergency: newE, end: cash };
      const share = totSales ? x.sales / totSales : 0;
      const fill = x.dem > 0 ? Math.min(1, x.sales / x.dem) : 1;
      const Sraw = 100 * (0.35 * fill + 0.25 * Math.min(1, 0.5 * x.Q / Qm) + 0.25 * Math.min(1, 0.5 * Pm / d.price) + 0.15 * x.c.trIdx);
      const ns = { cash: cash, stockU: leftU, stockV: leftV, imob: s.imob - o.depr + d.invest, debt: x.debt, emerg: emerg, W: x.c.W, B: x.B, Q: x.Q,
        S: Math.round((0.5 * Sraw + 0.5 * s.S) * 10) / 10, capital: s.capital, retained: s.retained + o.ni, cumNI: s.cumNI + o.ni,
        ni: (s.ni || []).concat([o.ni]), share: (s.share || []).concat([share]) };
      o.bs = { cash: ns.cash, stock: ns.stockV, stockU: ns.stockU, fixed: ns.imob, assets: assetsOf(ns), debt: ns.debt, emergency: ns.emerg, liabilities: ns.debt + ns.emerg,
        capital: ns.capital, retained: ns.retained, equity: ns.capital + ns.retained };
      o.check = o.bs.assets - o.bs.liabilities - o.bs.equity;
      o.share = share; o.fill = fill; o.sat = ns.S; o.cumNI = ns.cumNI;
      o.avgShare = ns.share.reduce(function (a, b) { return a + b; }, 0) / ns.share.length;
      const last = ns.ni.slice(-2), avg = last.reduce(function (a, b) { return a + b; }, 0) / last.length;
      o.value = R(o.bs.equity + p.mult * 4 * avg);
      o.nextCap = Math.floor(ns.imob / p0.capCost);
      o.state = ns; out[id] = o;
    });
    return { market: { round: t, demand: R(D), avgPrice: Math.round(Pm * 100) / 100, sales: totSales, events: (events || []).map(function (e) { return e.type; }), version: VERSION }, teams: out };
  }

  /* ---------------- replay & ranking ---------------- */
  // rounds: [{ decisions: {teamId: d}, events: [...] }] in order (round 1 first)
  function simulate(p, teamIds, rounds) {
    let st = {}; teamIds.slice().sort().forEach(function (id) { st[id] = initState(p); });
    const res = [];
    (rounds || []).forEach(function (rd, i) {
      const r = runRound(p, st, (rd && rd.decisions) || {}, i + 1, (rd && rd.events) || []);
      res.push(r); const ns = {}; Object.keys(r.teams).forEach(function (id) { ns[id] = r.teams[id].state; }); st = ns;
    });
    return res;
  }
  const WEIGHTS = { profit: 40, value: 30, sat: 20, share: 10 };
  function score(teams, w) {
    w = w || WEIGHTS; const ids = Object.keys(teams).sort(), out = {};
    const tot = Object.keys(w).reduce(function (a, k) { return a + (+w[k] || 0); }, 0) || 1;
    const get = { profit: function (r) { return r.cumNI; }, value: function (r) { return r.value; }, sat: function (r) { return r.sat; }, share: function (r) { return r.avgShare; } };
    ids.forEach(function (id) { out[id] = 0; });
    Object.keys(get).forEach(function (k) {
      const wk = +w[k] || 0; if (!wk) return;
      const v = ids.map(function (id) { return get[k](teams[id]); }), mn = Math.min.apply(null, v), mx = Math.max.apply(null, v);
      ids.forEach(function (id, i) { out[id] += wk * (mx > mn ? 100 * (v[i] - mn) / (mx - mn) : 100); });
    });
    ids.forEach(function (id) { out[id] = Math.round(out[id] / tot * 10) / 10; });
    return out;
  }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function surprise(seed) { const keys = Object.keys(EVENTS); return keys[hash(String(seed)) % keys.length]; }

  const API = { VERSION: VERSION, SCENARIOS: SCENARIOS, DECISIONS: DECISIONS, EVENTS: EVENTS, WEIGHTS: WEIGHTS, MONEY: MONEY,
    params: params, convert: convert, initState: initState, clampDecision: clampDecision, capacityOf: capacityOf, defaultDecision: defaultDecision,
    runRound: runRound, simulate: simulate, score: score, surprise: surprise };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.CMGameEngine = API;
})(typeof window !== "undefined" ? window : this);
