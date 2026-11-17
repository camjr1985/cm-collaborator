/* CM Collaborator – ITSM core (pure functions, no DOM, no Firebase). ITIL 4 and ITIL (Version 5).
 * Loaded by itsm/index.html before itsm.js; also runs in Node for unit tests (module.exports).
 * Workflows per practice, priority matrix (impact × urgency), SLA clock with business hours and pause,
 * value-chain activity (ITIL 4) and product & service lifecycle activity (ITIL 5) per record. */
(function (root) {
  "use strict";
  const MIN = 60000;

  /* ---------- record kinds (ITIL practices) ---------- */
  const KINDS = {
    incident: { prefix: "INC", name: "Incidente", plural: "Incidentes", icon: "incident", color: "#e5484d", practice: "Gerenciamento de incidente" },
    request: { prefix: "REQ", name: "Requisição", plural: "Requisições", icon: "request", color: "#2f80ed", practice: "Gerenciamento de requisição de serviço" },
    task: { prefix: "TSK", name: "Tarefa", plural: "Tarefas", icon: "task", color: "#626a80", practice: "Cumprimento de requisição" },
    problem: { prefix: "PRB", name: "Problema", plural: "Problemas", icon: "problem", color: "#c2410c", practice: "Gerenciamento de problema" },
    change: { prefix: "CHG", name: "Mudança", plural: "Mudanças", icon: "change", color: "#7c5cff", practice: "Habilitação de mudança" },
    improvement: { prefix: "IMP", name: "Melhoria", plural: "Melhorias", icon: "improvement", color: "#1f9d8f", practice: "Melhoria contínua" }
  };

  /* ---------- workflows: cat = todo | doing | wait | done ; vc4 = ITIL 4 value chain ; vc5 = ITIL 5 lifecycle ; next = allowed moves ---------- */
  function st(id, name, cat, vc4, vc5, next) { return { id: id, name: name, cat: cat, vc4: vc4, vc5: vc5, next: next }; }
  const FLOWS = {
    incident: [
      st("new", "Novo", "todo", "engage", "support", ["doing", "waiting", "resolved", "cancelled"]),
      st("doing", "Em atendimento", "doing", "deliver", "support", ["waiting", "resolved", "cancelled"]),
      st("waiting", "Aguardando cliente", "wait", "engage", "support", ["doing", "resolved", "cancelled"]),
      st("resolved", "Resolvido", "done", "deliver", "support", ["closed", "doing"]),
      st("closed", "Fechado", "done", "deliver", "support", []),
      st("cancelled", "Cancelado", "done", "engage", "support", [])
    ],
    request: [
      st("new", "Nova", "todo", "engage", "deliver", ["approval", "doing", "rejected", "cancelled"]),
      st("approval", "Aguardando aprovação", "wait", "engage", "deliver", ["doing", "rejected", "cancelled"]),
      st("doing", "Em cumprimento", "doing", "deliver", "deliver", ["waiting", "resolved", "cancelled"]),
      st("waiting", "Aguardando cliente", "wait", "engage", "deliver", ["doing", "resolved", "cancelled"]),
      st("resolved", "Concluída", "done", "deliver", "deliver", ["closed", "doing"]),
      st("closed", "Fechada", "done", "deliver", "deliver", []),
      st("rejected", "Rejeitada", "done", "engage", "deliver", []),
      st("cancelled", "Cancelada", "done", "engage", "deliver", [])
    ],
    task: [
      st("todo", "A fazer", "todo", "deliver", "deliver", ["doing", "done"]),
      st("doing", "Em andamento", "doing", "deliver", "deliver", ["todo", "done"]),
      st("done", "Concluída", "done", "deliver", "deliver", ["doing"])
    ],
    problem: [
      st("new", "Novo", "todo", "deliver", "operate", ["analysis", "cancelled"]),
      st("analysis", "Em análise", "doing", "deliver", "operate", ["known", "resolved", "cancelled"]),
      st("known", "Erro conhecido", "doing", "improve", "operate", ["analysis", "resolved"]),
      st("resolved", "Resolvido", "done", "improve", "operate", ["closed", "analysis"]),
      st("closed", "Fechado", "done", "improve", "operate", []),
      st("cancelled", "Cancelado", "done", "deliver", "operate", [])
    ],
    change: [
      st("draft", "Rascunho", "todo", "plan", "design", ["assess", "scheduled", "cancelled"]),
      st("assess", "Em avaliação", "doing", "plan", "design", ["approved", "rejected", "draft", "cancelled"]),
      st("approved", "Aprovada", "doing", "plan", "design", ["scheduled", "cancelled"]),
      st("scheduled", "Agendada", "doing", "transition", "transition", ["implemented", "failed", "cancelled"]),
      st("implemented", "Implementada", "doing", "transition", "transition", ["reviewed", "failed"]),
      st("failed", "Falhou / retornada", "doing", "transition", "transition", ["reviewed", "scheduled"]),
      st("reviewed", "Revisada", "done", "improve", "operate", ["closed"]),
      st("closed", "Fechada", "done", "improve", "operate", []),
      st("rejected", "Rejeitada", "done", "plan", "design", []),
      st("cancelled", "Cancelada", "done", "plan", "design", [])
    ],
    improvement: [
      st("identified", "Identificada", "todo", "improve", "discover", ["assessed", "discarded"]),
      st("assessed", "Avaliada", "doing", "improve", "discover", ["approved", "discarded"]),
      st("approved", "Aprovada", "doing", "plan", "design", ["doing", "discarded"]),
      st("doing", "Em execução", "doing", "obtain", "build", ["done", "approved"]),
      st("done", "Concluída", "done", "improve", "operate", []),
      st("discarded", "Descartada", "done", "improve", "discover", [])
    ]
  };
  /* ITIL 4 service value chain (6) and ITIL (Version 5) product & service lifecycle (8) – PT-BR */
  const VC4 = { plan: "Planejar", improve: "Melhorar", engage: "Engajar", transition: "Desenho e transição", obtain: "Obter/construir", deliver: "Entregar e suportar" };
  const VC5 = { discover: "Descobrir", design: "Desenhar", acquire: "Adquirir", build: "Construir", transition: "Transicionar", operate: "Operar", deliver: "Entregar", support: "Suportar" };
  const PRINCIPLES = [
    ["Foco no valor", "Tudo o que a central faz deve gerar valor para quem usa o serviço."],
    ["Comece de onde está", "Aproveite o que já funciona antes de criar do zero."],
    ["Progrida iterativamente com feedback", "Entregue em pequenos passos e ajuste com o retorno de quem usa."],
    ["Colabore e promova visibilidade", "Trabalho visível, decisões compartilhadas."],
    ["Pense e trabalhe de forma holística", "Serviço, pessoas, processos e tecnologia juntos."],
    ["Mantenha simples e prático", "Elimine etapas que não geram valor."],
    ["Otimize e automatize", "Primeiro otimize, depois automatize o que se repete."]
  ];

  function flow(kind) { return FLOWS[kind] || FLOWS.incident; }
  function status(kind, id) { const f = flow(kind); return f.find(function (s) { return s.id === id; }) || f[0]; }
  function canMove(kind, from, to) { if (from === to) return true; return status(kind, from).next.indexOf(to) >= 0; }
  function isDone(rec) { return status(rec.kind, rec.status).cat === "done"; }
  function valueChain(rec) {
    const s = status(rec.kind, rec.status);
    let v4 = s.vc4, v5 = s.vc5;
    if (rec.kind === "change" && rec.devLinked && (s.id === "approved" || s.id === "scheduled")) { v4 = "obtain"; v5 = rec.acquire ? "acquire" : "build"; }
    return { v4: v4, v5: v5, n4: VC4[v4], n5: VC5[v5] };
  }

  /* ---------- priority: impact × urgency → P1..P4 (configurable) ---------- */
  const LEVELS = ["high", "medium", "low"];
  const LEVELN = { high: "Alto", medium: "Médio", low: "Baixo" };
  const URGN = { high: "Alta", medium: "Média", low: "Baixa" };
  const MATRIX = { "high|high": "P1", "high|medium": "P2", "high|low": "P3", "medium|high": "P2", "medium|medium": "P3", "medium|low": "P4", "low|high": "P3", "low|medium": "P4", "low|low": "P4" };
  const PRIO = { P1: { name: "P1 · Crítica", color: "#e5484d" }, P2: { name: "P2 · Alta", color: "#e8a400" }, P3: { name: "P3 · Média", color: "#2f80ed" }, P4: { name: "P4 · Baixa", color: "#8a94a6" } };
  function priority(impact, urgency, matrix) { return ((matrix || MATRIX)[(impact || "medium") + "|" + (urgency || "medium")]) || "P3"; }

  /* ---------- SLA: minutes per priority (first response / resolution) ---------- */
  const SLA_DEFAULT = { P1: { resp: 15, res: 240 }, P2: { resp: 30, res: 480 }, P3: { resp: 240, res: 1440 }, P4: { resp: 480, res: 4320 } };
  /* calendar: { mode: "24x7" | "business", days: [1..5] (0 = Sunday), start: "08:00", end: "18:00", tz: -180 (minutes from UTC; Brasília) } */
  const CAL_DEFAULT = { mode: "24x7", days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00", tz: -180 };
  function hm(s) { const p = String(s || "0:0").split(":"); return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0); }
  function cal(c) { return Object.assign({}, CAL_DEFAULT, c || {}); }
  /* business minutes between two instants */
  function bizBetween(a, b, c) {
    c = cal(c); if (!(b > a)) return 0;
    if (c.mode !== "business") return (b - a) / MIN;
    const off = c.tz * MIN, s = hm(c.start), e = hm(c.end);
    let total = 0;
    let day = Math.floor((a + off) / 86400000) * 86400000; // local midnight (as UTC ms shifted)
    const endL = b + off, startL = a + off;
    for (let guard = 0; day < endL && guard < 4000; day += 86400000, guard++) {
      const dow = new Date(day).getUTCDay();
      if (c.days.indexOf(dow) < 0) continue;
      const w0 = day + s * MIN, w1 = day + e * MIN;
      const x0 = Math.max(w0, startL), x1 = Math.min(w1, endL);
      if (x1 > x0) total += (x1 - x0) / MIN;
    }
    return total;
  }
  /* instant when `mins` business minutes have passed since `a` */
  function bizAdd(a, mins, c) {
    c = cal(c); if (c.mode !== "business") return a + mins * MIN;
    const off = c.tz * MIN, s = hm(c.start), e = hm(c.end);
    let left = mins, t = a + off;
    for (let guard = 0; guard < 4000; guard++) {
      const day = Math.floor(t / 86400000) * 86400000, dow = new Date(day).getUTCDay();
      const w0 = day + s * MIN, w1 = day + e * MIN;
      if (c.days.indexOf(dow) >= 0 && t < w1) {
        const from = Math.max(t, w0), avail = (w1 - from) / MIN;
        if (avail >= left) return from + left * MIN - off;
        left -= avail;
      }
      t = day + 86400000;
    }
    return t - off;
  }
  /* SLA targets for a record: policy for service+priority, else per priority, else default */
  function targets(rec, sla) {
    const pol = (sla && sla.policies) || {}, p = rec.priority || "P3";
    let best = null;
    Object.keys(pol).forEach(function (k) {
      const x = pol[k]; if (!x || x.priority !== p) return;
      if (x.service && x.service === rec.service) best = x;
      else if (!x.service && !best) best = x;
    });
    const d = (sla && sla.defaults && sla.defaults[p]) || SLA_DEFAULT[p] || SLA_DEFAULT.P3;
    return { resp: Number(best ? best.resp : d.resp) || 0, res: Number(best ? best.res : d.res) || 0, policy: best ? best.name || "" : "" };
  }
  /* state of the clocks at `now`. rec.sla = { start, resp, res, pausedMs (business minutes), pausedAt, respAt, stopAt } */
  function clock(rec, now, c) {
    const s = rec.sla || {}; if (!s.start) return null;
    const end = s.stopAt || now;
    const paused = (Number(s.pausedMs) || 0) + (s.pausedAt && !s.stopAt ? bizBetween(s.pausedAt, end, c) : 0);
    const used = Math.max(0, bizBetween(s.start, end, c) - paused);
    const respUsed = s.respAt ? Math.max(0, bizBetween(s.start, s.respAt, c)) : used;
    function st(usedM, target, finished) {
      if (!target) return null;
      const pct = usedM / target, color = pct >= 1 ? "red" : pct >= 0.75 ? "amber" : "green";
      return { pct: pct, color: color, left: target - usedM, breached: pct >= 1, finished: !!finished };
    }
    return {
      paused: !!(s.pausedAt && !s.stopAt),
      resp: st(respUsed, s.resp, !!s.respAt),
      res: st(used, s.res, !!s.stopAt),
      respDue: s.resp ? bizAdd(s.start, s.resp, c) : null,
      resDue: s.res ? bizAdd(s.start, s.res + paused, c) : null
    };
  }
  /* patch to apply to rec.sla when the status changes (pause on "wait", stop on "done", restart on reopen) */
  function slaOnStatus(rec, to, now, c) {
    const s = rec.sla || {}; if (!s.start) return null;
    const cat = status(rec.kind, to).cat, p = {};
    if (s.pausedAt && cat !== "wait") { p.pausedMs = (Number(s.pausedMs) || 0) + bizBetween(s.pausedAt, now, c); p.pausedAt = null; }
    if (cat === "wait" && !s.pausedAt) p.pausedAt = now;
    if (cat === "done" && !s.stopAt) { p.stopAt = now; if (s.pausedAt) { p.pausedMs = (Number(s.pausedMs) || 0) + bizBetween(s.pausedAt, now, c); p.pausedAt = null; } }
    if (cat !== "done" && s.stopAt) p.stopAt = null;
    if (!s.respAt && (cat === "doing" || cat === "done")) p.respAt = now;
    return p;
  }
  function fmtLeft(mins) {
    const neg = mins < 0, m = Math.abs(Math.round(mins));
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    const s = d ? d + "d " + h + "h" : h ? h + "h " + String(mm).padStart(2, "0") + "min" : mm + "min";
    return neg ? "há " + s : s;
  }

  /* ---------- change risk (questionnaire → score → level) ---------- */
  const RISK_Q = [
    { id: "users", q: "Quantos usuários podem ser afetados?", opts: [["Poucos (equipe)", 1], ["Uma área", 2], ["Toda a empresa ou clientes", 3]] },
    { id: "crit", q: "Qual a criticidade do serviço afetado?", opts: [["Baixa", 1], ["Média", 2], ["Alta (serviço essencial)", 3]] },
    { id: "done", q: "Já foi feita antes com sucesso?", opts: [["Sim, várias vezes", 1], ["Uma vez ou parecida", 2], ["Nunca", 3]] },
    { id: "back", q: "Existe plano de retorno (backout) testado?", opts: [["Sim, testado", 1], ["Sim, não testado", 2], ["Não", 3]] },
    { id: "down", q: "Exige indisponibilidade?", opts: [["Não", 1], ["Sim, curta e fora do horário", 2], ["Sim, no horário de uso", 3]] }
  ];
  function risk(answers) {
    const a = answers || {}; let sc = 0, n = 0;
    RISK_Q.forEach(function (q) { const v = Number(a[q.id]); if (v) { sc += v; n++; } });
    if (!n) return { score: 0, level: "" };
    const avg = sc / n;
    return { score: sc, level: avg >= 2.4 ? "high" : avg >= 1.7 ? "medium" : "low" };
  }
  const RISKN = { low: "Baixo", medium: "Médio", high: "Alto" };
  const CHANGE_TYPES = { standard: "Padrão (pré-aprovada)", normal: "Normal", emergency: "Emergencial" };

  /* ---------- problem identification by trend: ≥ n incidents with the same service/category/CI in `days` days, no problem linked ---------- */
  function trends(records, opt, now) {
    opt = Object.assign({ n: 3, days: 7 }, opt || {});
    const since = now - opt.days * 86400000, groups = {};
    Object.keys(records || {}).forEach(function (id) {
      const r = records[id]; if (!r || r.kind !== "incident" || r.problem || !(r.created >= since)) return;
      const keys = [];
      if (r.service) keys.push("service|" + r.service);
      if (r.category) keys.push("category|" + r.category);
      Object.keys(r.cis || {}).forEach(function (c) { keys.push("ci|" + c); });
      keys.forEach(function (k) { (groups[k] = groups[k] || []).push(id); });
    });
    return Object.keys(groups).filter(function (k) { return groups[k].length >= opt.n; }).map(function (k) {
      const p = k.split("|"); return { by: p[0], value: p.slice(1).join("|"), ids: groups[k] };
    }).sort(function (a, b) { return b.ids.length - a.ids.length; });
  }

  /* ---------- dashboard metrics ---------- */
  function metrics(records, now, c) {
    const all = Object.keys(records || {}).map(function (id) { return Object.assign({ id: id }, records[id]); }).filter(function (r) { return r.kind === "incident" || r.kind === "request"; });
    const open = all.filter(function (r) { return !isDone(r); });
    const resolved = all.filter(function (r) { return r.resolvedAt && r.created; });
    let slaN = 0, slaOk = 0, respN = 0, respOk = 0;
    all.forEach(function (r) {
      const k = clock(r, now, c); if (!k) return;
      if (k.res && (k.res.finished || k.res.breached)) { slaN++; if (!k.res.breached) slaOk++; }
      if (k.resp && (k.resp.finished || k.resp.breached)) { respN++; if (!k.resp.breached) respOk++; }
    });
    const mttr = resolved.length ? resolved.filter(function (r) { return r.kind === "incident"; }).reduce(function (a, r) { return a + (r.resolvedAt - r.created); }, 0) / Math.max(1, resolved.filter(function (r) { return r.kind === "incident"; }).length) : 0;
    const ages = { "0–2 dias": 0, "3–7 dias": 0, "8–30 dias": 0, "30+ dias": 0 };
    open.forEach(function (r) { const d = (now - (r.created || now)) / 86400000; ages[d <= 2 ? "0–2 dias" : d <= 7 ? "3–7 dias" : d <= 30 ? "8–30 dias" : "30+ dias"]++; });
    const csat = all.filter(function (r) { return r.csat && r.csat.score; });
    return {
      total: all.length, open: open.length,
      sla: slaN ? slaOk / slaN : null, resp: respN ? respOk / respN : null,
      mttrH: mttr / 3600000, ages: ages,
      csat: csat.length ? csat.reduce(function (a, r) { return a + Number(r.csat.score); }, 0) / csat.length : null, csatN: csat.length
    };
  }

  const API = { KINDS: KINDS, FLOWS: FLOWS, VC4: VC4, VC5: VC5, PRINCIPLES: PRINCIPLES, LEVELS: LEVELS, LEVELN: LEVELN, URGN: URGN, MATRIX: MATRIX, PRIO: PRIO, SLA_DEFAULT: SLA_DEFAULT, CAL_DEFAULT: CAL_DEFAULT,
    RISK_Q: RISK_Q, RISKN: RISKN, CHANGE_TYPES: CHANGE_TYPES,
    flow: flow, status: status, canMove: canMove, isDone: isDone, valueChain: valueChain, priority: priority,
    bizBetween: bizBetween, bizAdd: bizAdd, targets: targets, clock: clock, slaOnStatus: slaOnStatus, fmtLeft: fmtLeft, risk: risk, trends: trends, metrics: metrics };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.ITSM = API;
})(typeof window !== "undefined" ? window : globalThis);
