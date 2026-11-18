const assert = require("assert");
const I = require("../assets/js/itsm-core.js");
const MIN = 60000;
// priority matrix
assert.equal(I.priority("high","high"), "P1"); assert.equal(I.priority("medium","medium"), "P3"); assert.equal(I.priority("low","low"), "P4");
// flows
assert.ok(I.canMove("incident","new","doing")); assert.ok(!I.canMove("incident","new","closed")); assert.ok(I.canMove("incident","resolved","doing"));
assert.ok(!I.canMove("change","draft","implemented"));
// 24x7
assert.equal(I.bizBetween(0, 90*MIN), 90);
// business hours, Brasília (UTC-3): Mon 2026-11-16 08:00 BRT = 11:00Z
const cal = { mode: "business" };
const mon8 = Date.UTC(2026,10,16,11,0); 
assert.equal(I.bizBetween(mon8, mon8 + 10*3600000, cal), 600); // 08–18
assert.equal(I.bizBetween(mon8, mon8 + 24*3600000, cal), 600); // overnight not counted
const fri17 = Date.UTC(2026,10,20,20,0); // Fri 17:00 BRT
const due = I.bizAdd(fri17, 120, cal); // 1h Fri + 1h Mon → Mon 09:00 BRT = 12:00Z
assert.equal(new Date(due).toISOString(), "2026-11-23T12:00:00.000Z");
assert.equal(I.bizBetween(fri17, due, cal), 120);
// SLA clock with pause
const t0 = Date.UTC(2026,10,16,12,0);
let rec = { kind: "incident", status: "new", priority: "P2", sla: { start: t0, resp: 30, res: 480 } };
let k = I.clock(rec, t0 + 20*MIN); assert.equal(k.resp.color, "green");
k = I.clock(rec, t0 + 25*MIN); assert.equal(k.resp.color, "amber");
k = I.clock(rec, t0 + 40*MIN); assert.equal(k.resp.color, "red"); assert.ok(k.resp.breached);
let p = I.slaOnStatus(rec, "doing", t0 + 10*MIN); assert.equal(p.respAt, t0 + 10*MIN); Object.assign(rec.sla, p); rec.status="doing";
p = I.slaOnStatus(rec, "waiting", t0 + 60*MIN); assert.equal(p.pausedAt, t0+60*MIN); Object.assign(rec.sla, p); rec.status="waiting";
k = I.clock(rec, t0 + 600*MIN); assert.ok(k.paused); assert.equal(Math.round(k.res.left), 420); // paused after 60 min
p = I.slaOnStatus(rec, "doing", t0 + 600*MIN); assert.equal(Math.round(p.pausedMs), 540); Object.assign(rec.sla, p); rec.status="doing";
k = I.clock(rec, t0 + 660*MIN); assert.equal(Math.round(k.res.left), 360); assert.equal(k.resp.finished, true); assert.equal(k.resp.breached, false);
p = I.slaOnStatus(rec, "resolved", t0 + 700*MIN); Object.assign(rec.sla, p); rec.status="resolved";
k = I.clock(rec, t0 + 5000*MIN); assert.ok(k.res.finished); assert.equal(Math.round(k.res.left), 320);
// targets with policy
assert.deepEqual(I.targets({priority:"P1"}, null), { resp: 15, res: 240, policy: "" });
assert.equal(I.targets({priority:"P1", service:"s1"}, { policies: { a: { priority: "P1", resp: 5, res: 60, name:"Ouro", service:"s1" } } }).res, 60);
// risk
assert.equal(I.risk({users:3,crit:3,done:3,back:2,down:3}).level, "high");
assert.equal(I.risk({users:1,crit:1,done:1,back:1,down:1}).level, "low");
// trends
const now = Date.now(); const recs = {};
for (let i=0;i<3;i++) recs["i"+i] = { kind:"incident", service:"email", created: now - i*3600000 };
recs.x = { kind:"incident", service:"email", created: now - 20*86400000 };
const tr = I.trends(recs, { n:3, days:7 }, now); assert.equal(tr.length, 1); assert.equal(tr[0].ids.length, 3);
// value chain
assert.equal(I.valueChain({kind:"change", status:"scheduled"}).n5, "Transicionar");
assert.equal(I.valueChain({kind:"incident", status:"new"}).n4, "Engajar");
// metrics
const m = I.metrics({ a: Object.assign({}, rec, { created: t0, resolvedAt: t0 + 700*MIN, csat: { score: 5 } }) }, t0 + 5000*MIN);
assert.equal(m.sla, 1); assert.equal(m.csat, 5);
console.log("itsm-core: all tests passed");
// ---- SOC, areas, LGPD (18/11)
{
  const t0 = Date.UTC(2026,10,16,12,0);
  const r = { kind: "security", status: "new", priority: "P1", area: "soc" };
  const tg = I.targets(r, null); assert.equal(tg.contain, 60); assert.equal(tg.resp, 15);
  r.sla = { start: t0, resp: tg.resp, contain: tg.contain, res: tg.res };
  let p = I.slaOnStatus(r, "triage", t0 + 5*MIN); Object.assign(r.sla, p); r.status = "triage";
  p = I.slaOnStatus(r, "contain", t0 + 20*MIN); Object.assign(r.sla, p); r.status = "contain";
  let k = I.clock(r, t0 + 50*MIN); assert.equal(k.contain.color, "amber");
  p = I.slaOnStatus(r, "eradicate", t0 + 55*MIN); assert.equal(p.containAt, t0 + 55*MIN); Object.assign(r.sla, p);
  k = I.clock(r, t0 + 500*MIN); assert.ok(k.contain.finished && !k.contain.breached);
  assert.ok(!I.canMove("security", "new", "closed"));
  // area policy precedence
  const sla = { policies: { a: { priority: "P1", resp: 99, res: 999, area: "rh" }, b: { priority: "P1", resp: 5, res: 50, soc: true, area: "soc" } } };
  assert.equal(I.targets({ kind: "incident", priority: "P1", area: "rh" }, sla).resp, 99);
  assert.equal(I.targets({ kind: "incident", priority: "P1", area: "ti" }, sla).resp, 15);
  assert.equal(I.targets({ kind: "security", priority: "P1", area: "soc" }, sla).resp, 5);
  // LGPD: Friday 2026-11-20 → +3 business days = Wednesday 2026-11-25
  const fri = Date.UTC(2026,10,20,12,0), due = I.lgpdDue(fri);
  assert.equal(new Date(due.notify).toISOString().slice(0,10), "2026-11-25");
  assert.ok(I.AREA_TEMPLATES.soc.soc && Object.keys(I.AREA_TEMPLATES).length >= 6);
  console.log("itsm-core SOC/areas/LGPD: ok");
}
