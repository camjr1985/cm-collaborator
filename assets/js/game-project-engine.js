/* CM Collaborator – Business Game, "project management" mode: pure, deterministic project simulation engine.
 *
 * Every team runs the SAME project (same scope, budget, deadline and team at the start). Each round is a period of the project.
 * The engine computes progress, earned value (PV, EV, AC, CPI, SPI), quality (defects, rework), risk exposure, team morale,
 * stakeholder satisfaction and the business value the project is expected to deliver. Same input → same output.
 *
 *   SCENARIOS                lancamento (product launch) · erp (ERP roll-out) · obra (plant / DC expansion) · pmo (project portfolio)
 *   DECISIONS / EVENTS       catalogs (ids only – labels live in the UI)
 *   params(id, over)         scenario params merged with overrides (deep for .init)
 *   convert(p, factor)       multiply every monetary parameter (currency change keeping the scale)
 *   initState(p)             state of a project at the start
 *   clampDecision(d, s, p, round) → { d, warn }   decisions in UI units (ot, qa, accept in %)
 *   capacityOf(s, p, d, round, k) work units the team can deliver this round
 *   defaultDecision(p, s)    "median" decision (form prefill / teams that did not submit repeat the last one)
 *   runRound(p, states, decs, round, events) → { market, teams }   (teams processed in id order)
 *   simulate(p, teamIds, rounds) · score(teams, weights) · surprise(seed, types)
 */
(function (root) {
  "use strict";
  const VERSION = "2.0.0";
  const R = Math.round, clamp = function (x, a, b) { return Math.max(a, Math.min(b, x)); };

  /* ---------------- scenarios ----------------
   * S0 scope (work units) · N planned rounds · BAC budget · W people · sal pay per person per round · prod units per person per round
   * cmat material/licence cost per unit · cOut outsourcing cost per unit · outMax max outsourced units per round
   * d0 defect rate per unit without QA · E0 initial risk exposure (expected cost) · eGrow exposure growth per open round · mitEff exposure removed per 1 spent
   * commRef / trRef reference spend for stakeholder engagement / training (per person) · benefit business value when fully delivered on time
   * lateLoss benefit lost per round late · hire / fire cost per person */
  const BASE = {
    unit: "points", S0: 1200, N: 6, BAC: 2400000, sal: 20000, prod: 20, cmat: 500, cOut: 2400, outMax: 120,
    hire: 8000, fire: 15000, d0: 0.18, escape: 0.3, E0: 300000, eGrow: 30000, mitEff: 2.5, commRef: 20000, trRef: 2000,
    benefit: 4800000, lateLoss: 0.1, crCost: 1.2,
    init: { W: 12, M: 70, St: 65 }
  };
  function scen(over, init) { const p = Object.assign({}, BASE, over); p.init = Object.assign({}, BASE.init, init || {}); return p; }
  const SCENARIOS = {
    lancamento: scen({ unit: "points", prod: 22 }),
    erp: scen({ unit: "points", S0: 1500, N: 7, BAC: 3800000, sal: 26000, prod: 18, cmat: 300, cOut: 2600, outMax: 150, d0: 0.22, E0: 450000, eGrow: 40000, benefit: 7000000, lateLoss: 0.08 },
      { W: 15, M: 68, St: 60 }),
    obra: scen({ unit: "packages", S0: 1000, N: 8, BAC: 6000000, sal: 12000, prod: 5.6, cmat: 2600, cOut: 5800, outMax: 60, hire: 3000, fire: 6000, d0: 0.12, E0: 700000, eGrow: 60000, benefit: 9500000, lateLoss: 0.07, crCost: 1.3 },
      { W: 26, M: 70, St: 65 }),
    pmo: scen({ unit: "points", S0: 2000, N: 6, BAC: 3300000, sal: 22000, prod: 19, cmat: 350, cOut: 2500, outMax: 160, d0: 0.18, E0: 500000, eGrow: 45000, benefit: 8000000, lateLoss: 0.12 },
      { W: 15, M: 66, St: 60 })
  };
  const MONEY = ["BAC", "sal", "cmat", "cOut", "hire", "fire", "E0", "eGrow", "commRef", "trRef", "benefit"];

  const DECISIONS = ["approach", "hire", "ot", "outsource", "qa", "train", "mitigation", "comms", "accept", "descope"];
  const APPROACH = {
    pred: { early: 1.0, late: 1.0, cr: 1.4, def: 0.9, st: 0 },      // predictive: changes are expensive, a bit fewer defects
    agil: { early: 0.94, late: 1.08, cr: 1.0, def: 1.0, st: 5 },    // agile: slow start, faster later, cheap changes, closer stakeholders
    hib: { early: 1.0, late: 1.03, cr: 1.2, def: 0.95, st: 2 }      // hybrid
  };
  const EVENTS = {
    mudanca_escopo: { k: 0.1 },     // change request = k × initial scope (teams decide how much to accept)
    atraso: { k: 0.3 },             // supplier delay / rain / licence: capacity lost this round
    saida_chave: { k: 2 },          // k key people leave (and morale drops)
    alta_custos: { k: 1.2 },        // material / licence cost × k from this round on
    retrabalho: { k: 0.08 },        // rework = k × delivered work
    corte_orcamento: { k: 0.9 },    // budget (BAC) × k
    concorrente: { k: 0.15 }        // competitor: business value − k if the project is not delivered by the planned round
  };
  const WEIGHTS = { time: 25, cost: 25, scope: 20, quality: 15, stake: 15 };

  function params(id, over) { const b = SCENARIOS[id] || SCENARIOS.lancamento, o = over || {}; const p = Object.assign({}, b, o); p.init = Object.assign({}, b.init, o.init || {}); return p; }
  function convert(p, f) { const q = Object.assign({}, p); q.init = Object.assign({}, p.init); MONEY.forEach(function (k) { q[k] = R(p[k] * f); }); return q; }
  function num(v) { v = Number(v); return isFinite(v) ? v : 0; }

  function initState(p) {
    return { W: p.init.W, M: p.init.M, St: p.init.St, E: p.E0, scope: p.S0, base: p.S0, done: 0, rework: 0, latent: 0, escaped: 0, AC: 0, BAC: p.BAC, chg: [],
      approach: null, finished: 0, cmatK: 1, benefitK: 1, accepted: 0, descoped: 0, hist: [] };
  }
  function remaining(s) { return Math.max(0, s.scope - s.done) + s.rework; }

  /* decisions arrive in UI units: ot, qa and accept in %, the rest in currency / people / work units */
  function clampDecision(d0, s, p, t) {
    const d = {}, w = [];
    DECISIONS.forEach(function (k) { d[k] = k === "approach" ? (d0 || {})[k] : num((d0 || {})[k]); });
    if (s.approach) d.approach = s.approach;
    else if (!APPROACH[d.approach]) d.approach = "hib";
    d.hire = Math.trunc(d.hire); if (d.hire < 1 - s.W) { d.hire = 1 - s.W; w.push("hire-max"); }
    if (d.ot < 0 || d.ot > 30) { d.ot = clamp(d.ot, 0, 30); w.push("ot-range"); }
    if (d.qa < 0 || d.qa > 40) { d.qa = clamp(d.qa, 0, 40); w.push("qa-range"); }
    if (d.accept < 0 || d.accept > 100) { d.accept = clamp(d.accept, 0, 100); }
    d.outsource = Math.floor(d.outsource); if (d.outsource < 0) d.outsource = 0; if (d.outsource > p.outMax) { d.outsource = p.outMax; w.push("out-max"); }
    ["train", "mitigation", "comms"].forEach(function (k) { d[k] = R(d[k]); if (d[k] < 0) d[k] = 0; });
    d.descope = Math.floor(d.descope); if (d.descope < 0) d.descope = 0;
    const maxCut = Math.max(0, Math.floor((s.scope - s.done) * 0.5)); if (d.descope > maxCut) { d.descope = maxCut; w.push("descope-max"); }
    if (s.finished) { ["hire", "ot", "outsource", "train", "mitigation", "comms", "descope"].forEach(function (k) { d[k] = 0; }); }
    return { d: d, warn: w };
  }
  function moraleF(M) { return (0.8 + 0.4 * M / 100) / 1.08; }
  function capacityOf(s, p, d, t, k) {
    const a = APPROACH[(s.approach || (d && d.approach)) || "hib"] || APPROACH.hib, hire = Math.trunc(num(d && d.hire));
    const W = Math.max(1, s.W + hire), fresh = Math.max(0, hire);
    const eff = (W - fresh * 0.5) * p.prod * (1 + num(d && d.ot) / 100) * moraleF(s.M) * (t <= 2 ? a.early : a.late) * (1 - num(d && d.qa) / 100) * (k || 1);
    return { W: W, internal: Math.max(0, Math.floor(eff)), total: Math.max(0, Math.floor(eff)) + Math.min(p.outMax, Math.max(0, Math.floor(num(d && d.outsource)))) };
  }
  function defaultDecision(p, s) {
    return { approach: s.approach || "hib", hire: 0, ot: 0, outsource: 0, qa: 15, train: R(p.init.W * p.trRef * 0.5), mitigation: R(p.eGrow / p.mitEff), comms: R(p.commRef * 0.5), accept: 50, descope: 0 };
  }

  /* ---------------- one round ---------------- */
  function runRound(p0, states, decs, t, events) {
    const p = Object.assign({}, p0); let capK = 1, crUnits = 0, rwK = 0, leave = 0, costK = 1, bacK = 1, comp = 0;
    (events || []).forEach(function (ev) {
      const k = ev.k != null ? +ev.k : (EVENTS[ev.type] || {}).k;
      if (ev.type === "mudanca_escopo") crUnits += Math.round(k * p.S0);
      else if (ev.type === "atraso") capK *= (1 - k);
      else if (ev.type === "saida_chave") leave += Math.round(k);
      else if (ev.type === "alta_custos") costK *= k;
      else if (ev.type === "retrabalho") rwK += k;
      else if (ev.type === "corte_orcamento") bacK *= k;
      else if (ev.type === "concorrente") comp += k;
    });
    const ids = Object.keys(states).sort(), out = {};
    ids.forEach(function (id) {
      const s0 = states[id], cd = clampDecision(decs[id], s0, p, t), d = cd.d, warn = cd.warn.slice();
      const s = JSON.parse(JSON.stringify(s0)); s.hist = s.hist || [];
      if (!s.approach) s.approach = d.approach;
      const a = APPROACH[s.approach];
      // risk exposure scales the impact of the events: mitigation pays off
      const riskF = clamp(0.5 + 0.5 * s.E / p.E0, 0.5, 1.5);
      s.chg = (s.chg || []).map(function (c) { return { r: c.r, b: Math.round(c.b * bacK) }; });
      s.cmatK *= costK; s.BAC = Math.round(s.BAC * bacK);
      if (comp && !s.finished) s.benefitK = Math.max(0.3, s.benefitK - comp);
      const o = { decision: d, warn: warn, round: t, approach: s.approach };
      // people: decisions, then key people leaving (event)
      const fired = Math.max(0, -d.hire), hired = Math.max(0, d.hire);
      const lost = s.finished ? 0 : Math.min(Math.max(0, s.W + d.hire - 1), Math.round(leave * riskF));
      // scope: change requests (accept %), descoping
      let crAcc = 0, crRej = 0;
      if (crUnits && !s.finished) { crAcc = Math.round(crUnits * d.accept / 100); crRej = crUnits - crAcc; s.scope += Math.round(crAcc * a.cr); s.accepted += crAcc; const cb = Math.round(crAcc * (p.sal / p.prod + p.cmat) * p.crCost); s.BAC += cb; if (cb) s.chg = s.chg.concat([{ r: t, b: cb }]); }
      if (d.descope) { s.BAC = Math.round(s.BAC * (1 - d.descope / Math.max(1, s.scope))); s.scope -= d.descope; s.base -= d.descope; s.descoped += d.descope; } // cut scope → cut budget (EVM)
      // rework found from last round's latent defects (+ rework event)
      s.rework += s.latent; s.latent = 0;
      if (rwK && !s.finished) s.rework += Math.round(s.done * rwK * riskF);
      // capacity
      const capState = Object.assign({}, s, { W: s.W - lost });
      const c = s.finished ? { W: s.W, internal: 0, total: 0 } : capacityOf(capState, p, d, t, Math.max(0, 1 - (1 - capK) * riskF)); // delays hit harder with high risk exposure
      const need = remaining(s);
      const outU = s.finished ? 0 : Math.min(d.outsource, need);
      const inU = Math.min(c.internal, Math.max(0, need - outU));
      const work = inU + outU;
      if (d.outsource > outU) warn.push("out-unused");
      // rework is done first, then new scope
      const rw = Math.min(s.rework, work); s.rework -= rw;
      const newWork = work - rw; s.done += newWork;
      // quality: defects created on new work
      const dr = p.d0 * (1 - Math.min(d.qa, 40) / 40 * 0.8) * a.def;
      const defects = newWork * dr * (outU > 0 ? (inU + outU * 1.5) / Math.max(1, work) : 1);
      s.latent = Math.round(defects * (1 - p.escape)); s.escaped += defects * p.escape;
      // costs (actual cost of the round)
      const W = s.finished ? 0 : c.W, payroll = R(W * p.sal * (1 + d.ot / 100 * 1.5));
      const people = hired * p.hire + fired * p.fire;
      const material = R(newWork * p.cmat * s.cmatK), outsourcing = R(outU * p.cOut * s.cmatK);
      const ac = payroll + people + material + outsourcing + d.train + d.mitigation + d.comms;
      s.AC += ac;
      s.W = Math.max(1, s.W + d.hire - lost);
      // risk exposure
      if (!s.finished) s.E = Math.max(0, R(s.E + p.eGrow - d.mitigation * p.mitEff));
      // earned value
      const pct = s.scope > 0 ? Math.min(1, s.done / s.scope) : 1;
      // PV: original baseline over the plan; each approved change is planned from the round it was accepted to the planned end (re-baselining)
      const chgB = s.chg.reduce(function (a, c) { return a + c.b; }, 0);
      const PV = R((s.BAC - chgB) * Math.min(1, t / p.N) + s.chg.reduce(function (a, c) { return a + c.b * Math.min(1, (t - c.r + 1) / Math.max(1, p.N - c.r + 1)); }, 0));
      const EV = R(s.BAC * pct), AC = s.AC;
      const CPI = AC > 0 ? EV / AC : 1, SPI = PV > 0 ? EV / PV : 1;
      if (!s.finished && remaining(s) <= 0 && s.latent === 0) s.finished = t;
      // morale
      const trIdx = Math.min(1, d.train / Math.max(1, W * p.trRef));
      const mT = 70 + 15 * trIdx - 60 * d.ot / 100 - (fired || lost ? 10 : 0) + (SPI >= 1 ? 8 : SPI < 0.9 ? -8 : 0);
      s.M = Math.round((s.M + 0.35 * (mT - s.M)) * 10) / 10;
      // stakeholders
      const commIdx = Math.min(1, d.comms / p.commRef);
      const quality = qualityOf(s);
      const stT = 60 + 40 * clamp(SPI - 1, -0.5, 0.25) + 30 * clamp(CPI - 1, -0.5, 0.25) + 15 * commIdx + (quality - 85) * 0.4 + a.st
        - (crUnits ? 35 * crRej / crUnits - 8 * crAcc / crUnits : 0) - 60 * d.descope / p.S0 - 20 * s.descoped / p.S0;
      s.St = Math.round(clamp(0.6 * s.St + 0.4 * stT, 0, 100) * 10) / 10;
      // forecasts and business value
      const rem = remaining(s) + s.latent, capNext = Math.max(1, capacityOf(s, p, { hire: 0, ot: 0, qa: d.qa, outsource: 0 }, t + 1).total);
      const finishF = s.finished || (t + Math.ceil(rem / capNext));
      const late = Math.max(0, finishF - p.N);
      const delivered = Math.min(1, s.base / p.S0); // descoping lowers the value delivered
      const valueF = Math.round(p.benefit * s.benefitK * clamp(delivered + 0.5 * s.accepted / p.S0, 0, 1.3) * (quality / 100) * Math.max(0.3, 1 - p.lateLoss * late));
      const EAC = CPI > 0 ? R(AC + (s.BAC - EV) / CPI) : AC;
      s.hist = s.hist.concat([{ t: t, PV: PV, EV: EV, AC: AC }]);
      Object.assign(o, {
        work: work, internal: inU, outsourced: outU, reworkDone: rw, newWork: newWork, defects: Math.round(defects), capacity: c.total, W: s.W, lost: lost, hired: hired, fired: fired,
        crUnits: crUnits, crAccepted: crAcc, crRejected: crRej, descope: d.descope,
        cost: { payroll: payroll, people: people, material: material, outsourcing: outsourcing, training: d.train, mitigation: d.mitigation, comms: d.comms, total: ac },
        PV: PV, EV: EV, AC: AC, BAC: s.BAC, CV: EV - AC, SV: EV - PV, CPI: Math.round(CPI * 1000) / 1000, SPI: Math.round(SPI * 1000) / 1000, EAC: EAC, VAC: s.BAC - EAC,
        pct: Math.round(pct * 1000) / 1000, scope: s.scope, done: s.done, remaining: rem, rework: s.rework + s.latent, quality: quality, risk: s.E, morale: s.M, stake: s.St,
        finished: s.finished, forecast: finishF, late: late, value: valueF, roi: AC > 0 ? Math.round((valueF - EAC) / Math.max(1, EAC) * 1000) / 1000 : 0
      });
      o.state = s; out[id] = o;
    });
    return { market: { round: t, events: (events || []).map(function (e) { return e.type; }), crUnits: crUnits, version: VERSION, mode: "project" }, teams: out };
  }
  function qualityOf(s) { return Math.round(clamp(100 - 400 * s.escaped / Math.max(1, s.done), 0, 100) * 10) / 10; }

  function simulate(p, teamIds, rounds) {
    let st = {}; teamIds.slice().sort().forEach(function (id) { st[id] = initState(p); });
    const res = [];
    (rounds || []).forEach(function (rd, i) {
      const r = runRound(p, st, (rd && rd.decisions) || {}, i + 1, (rd && rd.events) || []);
      res.push(r); const ns = {}; Object.keys(r.teams).forEach(function (id) { ns[id] = r.teams[id].state; }); st = ns;
    });
    return res;
  }
  /* time: SPI (or on-time delivery once finished) · cost: CPI · scope: % of the current scope delivered · quality · stakeholders */
  function score(teams, w) {
    w = w || WEIGHTS; const ids = Object.keys(teams).sort(), out = {};
    const tot = Object.keys(w).reduce(function (a, k) { return a + (+w[k] || 0); }, 0) || 1;
    const get = { time: function (r) { return Math.min(1.2, r.SPI) - 0.1 * r.late + (r.finished && !r.late ? 0.05 : 0); },
      cost: function (r) { return Math.min(1.3, r.CPI); }, scope: function (r) { return r.pct; }, quality: function (r) { return r.quality; }, stake: function (r) { return r.stake; } };
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
  function surprise(seed, types) { const keys = types && types.length ? types : Object.keys(EVENTS); return keys[hash(String(seed)) % keys.length]; }

  const API = { VERSION: VERSION, SCENARIOS: SCENARIOS, DECISIONS: DECISIONS, APPROACH: APPROACH, EVENTS: EVENTS, WEIGHTS: WEIGHTS, MONEY: MONEY,
    params: params, convert: convert, initState: initState, clampDecision: clampDecision, capacityOf: capacityOf, defaultDecision: defaultDecision,
    runRound: runRound, simulate: simulate, score: score, surprise: surprise, remaining: remaining };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.CMProjectEngine = API;
})(typeof window !== "undefined" ? window : this);
