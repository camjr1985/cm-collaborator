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
    improvement: { prefix: "IMP", name: "Melhoria", plural: "Melhorias", icon: "improvement", color: "#1f9d8f", practice: "Melhoria contínua" },
    security: { prefix: "SEC", name: "Incidente de segurança", plural: "Incidentes de segurança (SOC)", icon: "shield", color: "#b42318", practice: "Gerenciamento de segurança da informação" }
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
    /* SOC – incident response lifecycle (NIST SP 800-61 / ISO 27035): triage, containment, eradication, recovery, lessons learned */
    security: [
      st("new", "Novo", "todo", "engage", "support", ["triage", "false"]),
      st("triage", "Triagem", "doing", "deliver", "support", ["contain", "false", "eradicate"]),
      st("contain", "Contenção", "doing", "deliver", "support", ["eradicate"]),
      st("eradicate", "Erradicação", "doing", "deliver", "operate", ["recover", "contain"]),
      st("recover", "Recuperação", "doing", "deliver", "operate", ["lessons", "contain"]),
      st("lessons", "Lições aprendidas", "done", "improve", "operate", ["closed"]),
      st("closed", "Fechado", "done", "improve", "operate", []),
      st("false", "Falso positivo", "done", "engage", "support", ["triage"])
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
  /* SOC: severity names and default SLA (24x7): triage (1st response), containment, resolution – minutes */
  const SEV = { P1: "Crítica", P2: "Alta", P3: "Média", P4: "Baixa" };
  const SOC_SLA_DEFAULT = { P1: { resp: 15, contain: 60, res: 1440 }, P2: { resp: 30, contain: 240, res: 4320 }, P3: { resp: 120, contain: 1440, res: 7200 }, P4: { resp: 480, contain: 4320, res: 21600 } };
  const SOC_CATS = { phishing: "Phishing", malware: "Malware", ransomware: "Ransomware", access: "Acesso indevido", leak: "Vazamento de dados", ddos: "Negação de serviço (DDoS)", vuln: "Vulnerabilidade explorada", insider: "Ameaça interna", other: "Outro" };
  const MITRE = ["Reconhecimento", "Desenvolvimento de recursos", "Acesso inicial", "Execução", "Persistência", "Escalonamento de privilégios", "Evasão de defesa", "Acesso a credenciais", "Descoberta", "Movimentação lateral", "Coleta", "Comando e controle", "Exfiltração", "Impacto"];
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
  /* policy precedence: service > area > general; the record kind decides the table (incidents/requests or SOC) */
  function targets(rec, sla) {
    const soc = rec.kind === "security", pol = (sla && sla.policies) || {}, p = rec.priority || "P3";
    let best = null, rank = 0;
    Object.keys(pol).forEach(function (k) {
      const x = pol[k]; if (!x || x.priority !== p || (!!x.soc) !== soc) return;
      if (x.area && x.area !== rec.area) return;
      if (x.service && x.service !== rec.service) return;
      const r = x.service ? 3 : x.area ? 2 : 1;
      if (r > rank) { best = x; rank = r; }
    });
    const tbl = soc ? (sla && sla.soc) || SOC_SLA_DEFAULT : (sla && sla.defaults) || SLA_DEFAULT;
    const d = tbl[p] || (soc ? SOC_SLA_DEFAULT : SLA_DEFAULT)[p] || SLA_DEFAULT.P3;
    const o = { resp: Number(best ? best.resp : d.resp) || 0, res: Number(best ? best.res : d.res) || 0, policy: best ? best.name || "" : "" };
    if (soc) o.contain = Number(best && best.contain ? best.contain : d.contain) || 0;
    return o;
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
    const contUsed = s.containAt ? Math.max(0, bizBetween(s.start, s.containAt, c)) : used;
    return {
      paused: !!(s.pausedAt && !s.stopAt),
      contain: st(contUsed, s.contain, !!s.containAt),
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
    /* SOC: containment is achieved when the incident moves past "Contenção" */
    if (rec.kind === "security" && s.contain && !s.containAt && ["eradicate", "recover", "lessons", "closed", "false"].indexOf(to) >= 0) p.containAt = now;
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
    const all = Object.keys(records || {}).map(function (id) { return Object.assign({ id: id }, records[id]); }).filter(function (r) { return r.kind === "incident" || r.kind === "request" || r.kind === "security"; });
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

  /* LGPD (Resolução CD/ANPD nº 15/2024): communicate ANPD and data subjects within 3 business days of knowledge (6 for small agents);
     complementary information within 20 business days of the first communication. Weekends skipped; holidays not considered (v1). */
  function addBizDays(t, n) {
    const d = new Date(t); let left = n;
    while (left > 0) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) left--; }
    return d.getTime();
  }
  function lgpdDue(knownAt, small) { if (!knownAt) return null; return { notify: addBizDays(knownAt, small ? 6 : 3), complement: addBizDays(knownAt, (small ? 6 : 3) + 20) }; }

  /* ---------- service areas as configurable templates ---------- */
  const AREA_TEMPLATES = {
    ti: { name: "TI", icon: "itsm", color: "#2f80ed", calendar: "business",
      groups: { sd: "Central de serviço (N1)", n2: "Suporte técnico (N2)", infra: "Infraestrutura" },
      categories: ["Hardware", "Software", "Rede e internet", "Acesso e senha", "E-mail"],
      services: [["E-mail e colaboração", "Correio, agenda e reuniões on-line.", "n2"], ["Acesso e identidade", "Contas, senhas e permissões.", "sd"], ["Estações de trabalho", "Notebooks, monitores e softwares.", "sd"]],
      offerings: [["Relatar um problema de TI", "incident", "", "Algo parou de funcionar ou está com erro.", false, "", ""], ["Redefinir senha", "request", 1, "Nova senha para um sistema.", false, "", "sd: Redefinir a senha e avisar o solicitante"], ["Novo acesso a sistema", "request", 1, "Permissão para usar um sistema.", true, "Sistema|text|1\nPerfil de acesso|text|1\nJustificativa|textarea|1", "sd: Validar o perfil\nn2: Conceder o acesso"], ["Novo equipamento", "request", 2, "Notebook, monitor ou periférico.", true, "Equipamento|text|1\nMotivo|textarea|0", "infra: Separar o equipamento\nsd: Configurar e entregar"]] },
    soc: { name: "SOC – Cibersegurança", icon: "shield", color: "#b42318", calendar: "24x7", soc: true,
      groups: { soc1: "SOC N1 – Monitoramento e triagem", soc2: "SOC N2 – Resposta a incidentes", csirt: "CSIRT / Forense" },
      categories: ["Phishing", "Malware", "Acesso indevido", "Vazamento de dados", "Vulnerabilidade"],
      services: [["Monitoramento de segurança (SOC)", "Detecção e resposta a incidentes 24×7.", "soc1"], ["Gestão de vulnerabilidades", "Varreduras, correções e exceções.", "soc2"]],
      offerings: [["Reportar e-mail suspeito (phishing)", "security", 0, "Recebeu um e-mail estranho? Encaminhe para análise.", false, "Remetente do e-mail|text|1\nVocê clicou em algum link ou abriu anexo?|text|1", ""], ["Reportar incidente de segurança", "security", 0, "Suspeita de vírus, invasão, vazamento ou acesso indevido.", false, "O que aconteceu?|textarea|1", ""], ["Solicitar exceção de segurança", "request", 1, "Liberação de site, porta ou software bloqueado.", true, "O que precisa ser liberado|text|1\nJustificativa|textarea|1\nPrazo|date|0", "soc2: Avaliar o risco\nsoc2: Aplicar a exceção"]] },
    infra: { name: "Infraestrutura (NOC)", icon: "cmdb", color: "#0b7285", calendar: "24x7",
      groups: { noc: "NOC – Monitoramento 24×7", srv: "Servidores e nuvem", rede: "Redes e telecom" },
      categories: ["Servidores", "Rede", "Datacenter", "Backup", "Nuvem", "Banco de dados"],
      services: [["Datacenter e servidores", "Servidores físicos e virtuais, armazenamento.", "srv"], ["Rede e telecom", "LAN, Wi-Fi, links, VPN e firewall.", "rede"], ["Backup e recuperação", "Rotinas de backup e restauração.", "srv"], ["Nuvem", "Contas, assinaturas e recursos em nuvem.", "srv"]],
      offerings: [["Relatar indisponibilidade de sistema ou rede", "incident", "", "Servidor, link, VPN ou sistema fora do ar.", false, "Sistema ou equipamento afetado|text|1", ""], ["Solicitar servidor ou máquina virtual", "request", 0, "Novo servidor, VM ou ambiente.", true, "Finalidade|text|1\nCPU / memória / disco|text|1\nAmbiente (produção, homologação)|text|1", "srv: Provisionar a máquina\nnoc: Incluir no monitoramento"], ["Liberar regra de firewall", "request", 1, "Abertura de porta ou acesso entre redes.", true, "Origem|text|1\nDestino e porta|text|1\nJustificativa|textarea|1", "rede: Analisar o risco\nrede: Aplicar a regra"], ["Restaurar arquivo ou sistema do backup", "request", 2, "Recuperar dados de uma data anterior.", false, "O que restaurar|text|1\nData desejada|date|1", "srv: Restaurar e conferir"]] },
    rh: { name: "RH", icon: "people", color: "#7c5cff", calendar: "business",
      groups: { rh1: "Atendimento de RH", dp: "Departamento pessoal" },
      categories: ["Folha e benefícios", "Férias", "Admissão e desligamento", "Documentos"],
      services: [["Folha e benefícios", "Holerite, vale, plano de saúde.", "dp"], ["Admissão e desligamento", "Entrada e saída de colaboradores.", "rh1"]],
      offerings: [["Dúvida sobre folha ou benefícios", "incident", 0, "Erro ou dúvida no holerite ou benefício.", false, "", ""], ["Solicitar férias", "request", 0, "Agendamento de férias.", true, "Início|date|1\nDias|text|1", "dp: Registrar as férias"], ["Declaração ou documento", "request", 0, "Declaração de vínculo, informe de rendimentos.", false, "Documento|text|1", "rh1: Emitir e enviar"], ["Admissão de colaborador", "request", 1, "Preparar a entrada de uma pessoa.", true, "Nome|text|1\nCargo|text|1\nData de início|date|1", "rh1: Documentação\ndp: Cadastro na folha"]] },
    facilities: { name: "Facilities", icon: "portal", color: "#c27c00", calendar: "business",
      groups: { manut: "Manutenção predial", serv: "Serviços gerais" },
      categories: ["Elétrica", "Hidráulica", "Ar-condicionado", "Limpeza", "Mobiliário"],
      services: [["Manutenção predial", "Elétrica, hidráulica e climatização.", "manut"], ["Serviços gerais", "Limpeza, copa e mobiliário.", "serv"]],
      offerings: [["Relatar problema no prédio", "incident", 0, "Luz, vazamento, ar-condicionado.", false, "Local (andar/sala)|text|1", ""], ["Reservar sala ou espaço", "request", 0, "Sala de reunião ou auditório.", false, "Espaço|text|1\nData|date|1", "serv: Confirmar a reserva"], ["Mudança de layout", "request", 1, "Mover estações ou mobiliário.", true, "Local|text|1\nDescrição|textarea|1", "serv: Planejar\nmanut: Executar"]] },
    financeiro: { name: "Financeiro", icon: "dashboard", color: "#1f9d8f", calendar: "business",
      groups: { cp: "Contas a pagar", cr: "Contas a receber" },
      categories: ["Pagamentos", "Reembolsos", "Notas fiscais", "Cadastro de fornecedor"],
      services: [["Contas a pagar", "Pagamentos e reembolsos.", "cp"], ["Contas a receber", "Faturamento e cobrança.", "cr"]],
      offerings: [["Solicitar reembolso", "request", 0, "Despesas de viagem e outras.", true, "Valor|text|1\nCentro de custo|text|1", "cp: Conferir comprovantes\ncp: Programar pagamento"], ["Cadastrar fornecedor", "request", 1, "Novo fornecedor para pagamento.", true, "Razão social|text|1\nCNPJ|text|1", "cp: Validar documentos"], ["Problema com pagamento", "incident", 0, "Pagamento atrasado ou divergente.", false, "", ""]] },
    juridico: { name: "Jurídico", icon: "kb", color: "#626a80", calendar: "business",
      groups: { jur: "Jurídico" },
      categories: ["Contratos", "Consultas", "LGPD"],
      services: [["Contratos", "Elaboração e revisão de contratos.", "jur"]],
      offerings: [["Revisão de contrato", "request", 0, "Contrato com cliente ou fornecedor.", false, "Contraparte|text|1\nPrazo|date|0", "jur: Revisar o contrato"], ["Consulta jurídica", "request", 0, "Dúvida jurídica da área de negócio.", false, "", "jur: Responder a consulta"]] }
  };

  /* ready-made service centres: which area templates each one starts with ([] = from scratch) */
  const CENTRAL_TEMPLATES = {
    blank: { name: "Central do zero", desc: "Sem áreas nem catálogo: você monta tudo na Administração ou pelo Excel/CSV.", icon: "plus", areas: [], seed: false },
    ti: { name: "Service desk de TI", desc: "Portal, incidentes, requisições de acesso, senha e equipamentos.", icon: "itsm", areas: ["ti"], seed: true },
    infra: { name: "Infraestrutura (NOC)", desc: "Servidores, redes, backup e nuvem, atendimento 24×7.", icon: "cmdb", areas: ["infra"], seed: true },
    soc: { name: "SOC – Cibersegurança", desc: "Incidentes de segurança, contenção, MITRE ATT&CK e prazos LGPD.", icon: "shield", areas: ["soc"], seed: false },
    tisoc: { name: "TI, Infraestrutura e SOC", desc: "Central completa de tecnologia com segurança integrada.", icon: "layers", areas: ["ti", "infra", "soc"], seed: true },
    csc: { name: "Serviços compartilhados", desc: "RH, Facilities, Financeiro e Jurídico no mesmo portal.", icon: "people", areas: ["rh", "facilities", "financeiro", "juridico"], seed: false }
  };

  const API = { CENTRAL_TEMPLATES: CENTRAL_TEMPLATES, KINDS: KINDS, FLOWS: FLOWS, VC4: VC4, VC5: VC5, PRINCIPLES: PRINCIPLES, LEVELS: LEVELS, LEVELN: LEVELN, URGN: URGN, MATRIX: MATRIX, PRIO: PRIO, SLA_DEFAULT: SLA_DEFAULT, CAL_DEFAULT: CAL_DEFAULT,
    RISK_Q: RISK_Q, RISKN: RISKN, CHANGE_TYPES: CHANGE_TYPES, SEV: SEV, SOC_SLA_DEFAULT: SOC_SLA_DEFAULT, SOC_CATS: SOC_CATS, MITRE: MITRE, AREA_TEMPLATES: AREA_TEMPLATES, addBizDays: addBizDays, lgpdDue: lgpdDue,
    flow: flow, status: status, canMove: canMove, isDone: isDone, valueChain: valueChain, priority: priority,
    bizBetween: bizBetween, bizAdd: bizAdd, targets: targets, clock: clock, slaOnStatus: slaOnStatus, fmtLeft: fmtLeft, risk: risk, trends: trends, metrics: metrics };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.ITSM = API;
})(typeof window !== "undefined" ? window : globalThis);
