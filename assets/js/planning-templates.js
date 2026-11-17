/* CM Collaborator – Planning methodologies: workflow, default views and starter structure.
 * Shared by the hub (create dialog) and the planning page. Dates are "YYYY-MM-DD". */
(function () {
  "use strict";
  const PT = window.MB_LANG === "pt";
  const L = function (en, pt) { return window.MBL ? window.MBL(en, pt) : (PT ? pt : en); };
  function day(offset) { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); }
  function monday(offset) { const d = new Date(); d.setUTCHours(0, 0, 0, 0); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd + offset); return d.toISOString().slice(0, 10); }
  function st(id, en, pt, cat, wip) { const s = { id: id, name: L(en, pt), cat: cat }; if (wip) s.wip = wip; return s; }

  const METHODS = {
    hybrid: {
      id: "hybrid", icon: "roadmap", name: L("Roadmap (Jira-style)", "Roadmap (estilo Jira)"),
      desc: L("Epics on a timeline, stories and tasks on a board. Best for product and programme roadmaps.", "Épicos em uma linha do tempo, histórias e tarefas em um quadro. Ideal para roadmaps de produto e programas."),
      views: ["timeline", "board", "list"], label: { timeline: L("Roadmap", "Roadmap") },
      statuses: [st("todo", "To do", "A fazer", "todo"), st("doing", "In progress", "Em andamento", "doing"), st("review", "In review", "Em revisão", "doing"), st("done", "Done", "Concluído", "done")],
      types: ["initiative", "epic", "story", "task", "bug", "milestone"]
    },
    waterfall: {
      id: "waterfall", icon: "gantt", name: L("Waterfall schedule", "Cronograma Waterfall"),
      desc: L("Phases, tasks, dependencies and milestones on a Gantt chart. Best for projects with a fixed scope and dates.", "Fases, tarefas, dependências e marcos em um Gantt. Ideal para projetos com escopo e datas definidos."),
      views: ["timeline", "board", "list"], label: { timeline: L("Schedule", "Cronograma") },
      statuses: [st("todo", "Not started", "Não iniciado", "todo"), st("doing", "In progress", "Em andamento", "doing"), st("late", "At risk", "Em risco", "doing"), st("done", "Done", "Concluído", "done")],
      types: ["initiative", "phase", "task", "milestone"]
    },
    scrum: {
      id: "scrum", icon: "sprint", name: "Scrum",
      desc: L("Backlog, sprints and a sprint board. Best for teams working in iterations.", "Backlog, sprints e quadro da sprint. Ideal para equipes que trabalham em iterações."),
      views: ["backlog", "board", "timeline", "list"], label: { timeline: L("Roadmap", "Roadmap") },
      statuses: [st("todo", "To do", "A fazer", "todo"), st("doing", "In progress", "Em andamento", "doing"), st("review", "In review", "Em revisão", "doing"), st("done", "Done", "Concluído", "done")],
      types: ["initiative", "epic", "story", "task", "bug"]
    },
    kanban: {
      id: "kanban", icon: "kanban", name: "Kanban",
      desc: L("Continuous flow with your own columns and WIP limits. Best for operations and support.", "Fluxo contínuo com colunas próprias e limites de WIP. Ideal para operações e suporte."),
      views: ["board", "list", "timeline"], label: { timeline: L("Timeline", "Linha do tempo") },
      statuses: [st("backlog", "Backlog", "Backlog", "todo"), st("todo", "Ready", "Pronto para fazer", "todo"), st("doing", "In progress", "Em andamento", "doing", 3), st("review", "Review", "Revisão", "doing", 2), st("done", "Done", "Concluído", "done")],
      types: ["initiative", "epic", "story", "task", "bug"]
    }
  };

  function workflows() {
    const st = function (id, en, pt, c, extra) { return Object.assign({ id: id, name: L(en, pt), cat: c }, extra || {}); };
    return {
      simple: { name: L("Simple", "Simples"), ss: [st("todo", "To do", "A fazer", "todo"), st("doing", "In progress", "Em andamento", "doing"), st("done", "Done", "Concluído", "done")] },
      scrum: { name: "Scrum", ss: [st("todo", "To do", "A fazer", "todo"), st("doing", "In progress", "Em andamento", "doing"), st("review", "In review", "Em revisão", "doing"), st("done", "Done", "Concluído", "done")] },
      waterfall: { name: L("Waterfall / project", "Waterfall / projeto"), ss: [st("todo", "Not started", "Não iniciado", "todo"), st("doing", "In progress", "Em andamento", "doing"), st("late", "At risk", "Em risco", "doing"), st("blocked", "Blocked", "Bloqueado", "doing"), st("done", "Done", "Concluído", "done")] },
      down: { name: L("Kanban – downstream (delivery)", "Kanban – downstream (entrega)"), ss: [st("todo", "Ready to start", "Pronto para iniciar", "todo", { stage: "down" }), st("doing", "In development", "Em desenvolvimento", "doing", { stage: "down", wip: 3 }), st("review", "Code review", "Code review", "doing", { stage: "down", wip: 2 }), st("test", "Testing / QA", "Teste / QA", "doing", { stage: "down", wip: 2 }), st("deploy", "Ready to deploy", "Pronto para deploy", "doing", { stage: "down" }), st("done", "Delivered", "Entregue", "done", { stage: "down" })] },
      up: { name: L("Kanban – upstream (discovery)", "Kanban – upstream (descoberta)"), ss: [st("idea", "Ideas", "Ideias", "todo", { stage: "up" }), st("analysis", "In analysis", "Em análise", "doing", { stage: "up", wip: 4 }), st("validate", "Validation / experiment", "Validação / experimento", "doing", { stage: "up", wip: 3 }), st("ready", "Ready for development", "Pronto para desenvolver", "done", { stage: "up" })] },
      updown: { name: L("Upstream + downstream (Kanbanize style)", "Upstream + downstream (estilo Kanbanize)"), ss: [st("idea", "Ideas / requests", "Ideias / demandas", "todo", { stage: "up" }), st("analysis", "Analysis", "Análise", "doing", { stage: "up", wip: 4 }), st("ready", "Ready to commit", "Pronto para compromisso", "todo", { stage: "up" }), st("todo", "Committed", "Comprometido", "todo", { stage: "down" }), st("doing", "In progress", "Em andamento", "doing", { stage: "down", wip: 3 }), st("review", "Review / test", "Revisão / teste", "doing", { stage: "down", wip: 2 }), st("done", "Delivered", "Entregue", "done", { stage: "down" })] },
      itsm: { name: L("Service desk (ITSM)", "Atendimento (ITSM)"), ss: [st("new", "New", "Novo", "todo"), st("doing", "In progress", "Em atendimento", "doing"), st("waiting", "Waiting for customer", "Aguardando cliente", "doing"), st("resolved", "Resolved", "Resolvido", "done"), st("closed", "Closed", "Fechado", "done")] }
    };
  }

  /* ===== areas of work (verticals): each brings ready-made plannings with their own structure and workflow ===== */
  const AREAS = {
    general: { name: L("General / technology", "Geral / tecnologia"), icon: "roadmap", desc: L("Product, IT and project teams.", "Times de produto, TI e projetos.") },
    health: { name: L("Healthcare", "Saúde"), icon: "objective", desc: L("Hospitals, clinics, health operators.", "Hospitais, clínicas e operadoras de saúde.") },
    retail: { name: L("Retail", "Varejo"), icon: "kanban", desc: L("Stores, e-commerce and campaigns.", "Lojas, e-commerce e campanhas.") },
    consulting: { name: L("Consulting", "Consultoria"), icon: "people", desc: L("Client projects and portfolio.", "Projetos de clientes e portfólio.") },
    education: { name: L("Education", "Educação"), icon: "story", desc: L("Schools, universities and courses.", "Escolas, faculdades e cursos.") },
    service: { name: L("Service management", "Service management"), icon: "settings", desc: L("Service desk, operations and IT services.", "Central de serviços, operações e serviços de TI.") },
    ohs: { name: L("Occupational health", "Saúde ocupacional"), icon: "people", desc: L("Medical exams, ergonomics, absences and well-being programmes.", "Exames ocupacionais, ergonomia, afastamentos e programas de bem-estar.") },
    she: { name: L("SHE – safety, health & environment", "SHE – segurança, saúde e meio ambiente"), icon: "milestone", desc: L("Workplace safety, environmental licences and emergency plans.", "Segurança do trabalho, licenças ambientais e planos de emergência.") }
  };
  /* tree rows: [type, title, startDay, endDay, children?] – dates are offsets from today */
  const T = function (type, en, pt, s, e, kids) { return [type, L(en, pt), s, e, kids || []]; };
  const AREA_PLANS = [
    { id: "h-protocol", area: "health", method: "waterfall", workflow: "waterfall", name: L("Clinical protocol roll-out", "Implantação de protocolo clínico"), desc: L("Diagnosis, protocol design, training, pilot and expansion, with approval milestones.", "Diagnóstico, desenho do protocolo, treinamento, piloto e expansão, com marcos de aprovação."),
      tree: [T("phase", "Diagnosis", "Diagnóstico", 0, 20, [T("task", "Current-state assessment", "Levantamento da situação atual", 0, 10), T("task", "Indicators baseline", "Linha de base dos indicadores", 11, 20)]),
        T("phase", "Protocol design", "Desenho do protocolo", 21, 50, [T("task", "Draft with the clinical team", "Rascunho com a equipe clínica", 21, 40), T("milestone", "Approved by the committee", "Aprovado pela comissão", 50, 50)]),
        T("phase", "Training", "Treinamento das equipes", 51, 75, [T("task", "Multipliers training", "Treinar multiplicadores", 51, 62), T("task", "Shift training", "Treinamento por turno", 63, 75)]),
        T("phase", "Pilot", "Piloto", 76, 105, [T("task", "Pilot in one unit", "Piloto em uma unidade", 76, 100), T("milestone", "Pilot evaluated", "Piloto avaliado", 105, 105)]),
        T("phase", "Expansion", "Expansão", 106, 150, [T("task", "Roll-out to all units", "Implantação em todas as unidades", 106, 140), T("milestone", "Protocol live", "Protocolo implantado", 150, 150)])] },
    { id: "h-accred", area: "health", method: "waterfall", workflow: "waterfall", name: L("Hospital accreditation (ONA / JCI)", "Acreditação hospitalar (ONA / JCI)"), desc: L("Gap analysis, action plans by standard, internal audits and the certification visit.", "Análise de lacunas, planos de ação por padrão, auditorias internas e visita de certificação."),
      tree: [T("phase", "Gap analysis", "Análise de lacunas", 0, 30, [T("task", "Self-assessment by standard", "Autoavaliação por padrão", 0, 30)]), T("phase", "Action plans", "Planos de ação", 31, 120, [T("task", "Patient safety", "Segurança do paciente", 31, 90), T("task", "Document management", "Gestão de documentos", 31, 100), T("task", "Infection control", "Controle de infecção", 40, 120)]), T("phase", "Internal audits", "Auditorias internas", 121, 160, [T("task", "Audit round 1", "Rodada de auditoria 1", 121, 140), T("task", "Corrections", "Correções", 141, 160)]), T("milestone", "Certification visit", "Visita de certificação", 175, 175)] },
    { id: "h-journey", area: "health", method: "kanban", workflow: "updown", name: L("Patient journey improvements", "Melhorias na jornada do paciente"), desc: L("Upstream: ideas from patients and staff; downstream: delivery of the improvements.", "Upstream: ideias de pacientes e equipe; downstream: entrega das melhorias."),
      tree: [T("task", "Reduce waiting time at reception", "Reduzir o tempo de espera na recepção"), T("task", "Discharge instructions by WhatsApp", "Orientações de alta por WhatsApp"), T("bug", "Scheduling system out of sync", "Agenda fora de sincronia")] },
    { id: "r-campaigns", area: "retail", method: "hybrid", workflow: "scrum", name: L("Campaign calendar", "Calendário de campanhas"), desc: L("Seasonal campaigns as initiatives, with marketing, stock and store actions.", "Campanhas sazonais como iniciativas, com ações de marketing, estoque e lojas."),
      tree: [T("initiative", "Black Friday", "Black Friday", 0, 30, [T("epic", "Offers and pricing", "Ofertas e preços", 0, 18, [T("story", "Define the hero products", "Definir produtos-âncora", 0, 7)]), T("epic", "Stock and logistics", "Estoque e logística", 5, 25), T("epic", "Media and CRM", "Mídia e CRM", 10, 30)]),
        T("initiative", "Christmas", "Natal", 31, 70, [T("epic", "Store decoration", "Decoração das lojas", 31, 45), T("epic", "Gift guide", "Guia de presentes", 35, 60)]), T("milestone", "Campaign review", "Revisão das campanhas", 75, 75)] },
    { id: "r-store", area: "retail", method: "waterfall", workflow: "waterfall", name: L("New store opening", "Abertura de loja"), desc: L("From the point to the inauguration: works, licences, team, stock and launch.", "Do ponto à inauguração: obras, licenças, equipe, estoque e lançamento."),
      tree: [T("phase", "Point and contract", "Ponto e contrato", 0, 25), T("phase", "Works and licences", "Obras e licenças", 26, 90, [T("task", "Architecture project", "Projeto de arquitetura", 26, 45), T("task", "Works", "Obra", 46, 85), T("task", "Fire department / permits", "Bombeiros / alvarás", 60, 90)]), T("phase", "Team and stock", "Equipe e estoque", 70, 105, [T("task", "Hire and train the team", "Contratar e treinar a equipe", 70, 100), T("task", "Initial stock", "Estoque inicial", 90, 105)]), T("milestone", "Opening day", "Inauguração", 110, 110)] },
    { id: "c-project", area: "consulting", method: "waterfall", workflow: "waterfall", name: L("Consulting project", "Projeto de consultoria"), desc: L("Kick-off, diagnosis, recommendations, implementation and closure with client sign-offs.", "Kick-off, diagnóstico, recomendações, implementação e encerramento com aceites do cliente."),
      tree: [T("phase", "Kick-off", "Kick-off", 0, 7, [T("milestone", "Kick-off meeting", "Reunião de kick-off", 3, 3)]), T("phase", "Diagnosis", "Diagnóstico", 8, 35, [T("task", "Interviews", "Entrevistas", 8, 22), T("task", "Data analysis", "Análise de dados", 15, 35)]), T("phase", "Recommendations", "Recomendações", 36, 55, [T("task", "Future-state design", "Desenho do estado futuro", 36, 50), T("milestone", "Steering committee sign-off", "Aceite do comitê", 55, 55)]), T("phase", "Implementation", "Implementação", 56, 120), T("phase", "Closure", "Encerramento", 121, 130, [T("task", "Lessons learned", "Lições aprendidas", 121, 128), T("milestone", "Final acceptance", "Aceite final", 130, 130)])] },
    { id: "c-portfolio", area: "consulting", method: "kanban", workflow: "updown", name: L("Client portfolio (pipeline + delivery)", "Portfólio de clientes (funil + entrega)"), desc: L("Upstream: opportunities and proposals; downstream: projects being delivered.", "Upstream: oportunidades e propostas; downstream: projetos em entrega."),
      tree: [T("task", "Client A – diagnosis proposal", "Cliente A – proposta de diagnóstico"), T("task", "Client B – agile transformation", "Cliente B – transformação ágil"), T("task", "Client C – PMO as a service", "Cliente C – PMO as a service")] },
    { id: "e-semester", area: "education", method: "hybrid", workflow: "simple", name: L("Semester plan", "Planejamento do semestre"), desc: L("Units as epics, classes and assessments as items, with the academic calendar.", "Unidades como épicos, aulas e avaliações como itens, seguindo o calendário acadêmico."),
      tree: [T("epic", "Unit 1 – Fundamentals", "Unidade 1 – Fundamentos", 0, 28, [T("task", "Class 1", "Aula 1", 0, 0), T("task", "Class 2", "Aula 2", 7, 7), T("milestone", "Quiz 1", "Avaliação 1", 28, 28)]), T("epic", "Unit 2 – Applications", "Unidade 2 – Aplicações", 29, 63, [T("task", "Case study", "Estudo de caso", 35, 42), T("milestone", "Assignment due", "Entrega do trabalho", 63, 63)]), T("epic", "Unit 3 – Project", "Unidade 3 – Projeto", 64, 105, [T("task", "Team project", "Projeto em equipe", 64, 98), T("milestone", "Final presentation", "Apresentação final", 105, 105)])] },
    { id: "e-course", area: "education", method: "waterfall", workflow: "waterfall", name: L("New course launch", "Lançamento de curso"), desc: L("Curriculum, content production, approvals, enrolment campaign and first class.", "Currículo, produção de conteúdo, aprovações, campanha de matrícula e primeira aula."),
      tree: [T("phase", "Curriculum design", "Desenho curricular", 0, 30), T("phase", "Content production", "Produção de conteúdo", 31, 90, [T("task", "Videos and slides", "Vídeos e slides", 31, 80), T("task", "Activities and assessments", "Atividades e avaliações", 50, 90)]), T("milestone", "Approved by the board", "Aprovado pelo colegiado", 95, 95), T("phase", "Enrolment campaign", "Campanha de matrícula", 96, 130), T("milestone", "First class", "Primeira aula", 140, 140)] },
    { id: "s-desk", area: "service", method: "kanban", workflow: "itsm", name: L("Service desk board", "Quadro de atendimento"), desc: L("Requests and incidents flowing New → In progress → Waiting → Resolved → Closed.", "Requisições e incidentes fluindo Novo → Em atendimento → Aguardando → Resolvido → Fechado."),
      tree: [T("bug", "Incident – e-mail unavailable", "Incidente – e-mail indisponível"), T("task", "Request – new user access", "Requisição – acesso para novo usuário"), T("task", "Request – laptop replacement", "Requisição – troca de notebook")] },
    { id: "s-csi", area: "service", method: "hybrid", workflow: "updown", name: L("Continual service improvement", "Melhoria contínua de serviços"), desc: L("Improvement initiatives from incident trends and SLA results, upstream to downstream.", "Iniciativas de melhoria a partir de tendências de incidentes e SLA, do upstream ao downstream."),
      tree: [T("initiative", "Reduce repeat incidents", "Reduzir incidentes recorrentes", 0, 90, [T("epic", "Problem management", "Gestão de problemas", 0, 45), T("epic", "Knowledge base", "Base de conhecimento", 20, 90)]), T("initiative", "Meet the SLA", "Cumprir o SLA", 0, 120, [T("epic", "Queue and shift review", "Revisão de filas e turnos", 0, 60)])] },
    { id: "s-transition", area: "service", method: "waterfall", workflow: "waterfall", name: L("New service transition", "Transição de novo serviço"), desc: L("Service design, readiness, go-live and hypercare.", "Desenho do serviço, prontidão, entrada em produção e operação assistida."),
      tree: [T("phase", "Service design", "Desenho do serviço", 0, 30, [T("task", "Catalogue and SLAs", "Catálogo e SLAs", 0, 20)]), T("phase", "Readiness", "Prontidão operacional", 31, 60, [T("task", "Runbooks and training", "Runbooks e treinamento", 31, 55)]), T("milestone", "Go-live", "Entrada em produção", 62, 62), T("phase", "Hypercare", "Operação assistida", 63, 90)] },
    { id: "o-pcmso", area: "ohs", method: "waterfall", workflow: "waterfall", name: L("Occupational health programme", "Programa de saúde ocupacional (PCMSO)"), desc: L("Risk inventory, medical exams by role, ergonomics and annual report.", "Inventário de riscos, exames por função, ergonomia e relatório anual."),
      tree: [T("phase", "Diagnosis", "Diagnóstico", 0, 25, [T("task", "Risk inventory", "Inventário de riscos (PGR)", 0, 15), T("task", "Exposure map by role", "Mapa de exposição por função", 10, 25)]), T("phase", "Medical exams", "Exames ocupacionais", 26, 120, [T("task", "Periodic exams by role", "Exames periódicos por função", 26, 110), T("task", "Return-to-work exams", "Exames de retorno ao trabalho", 26, 120)]), T("phase", "Ergonomics", "Ergonomia", 40, 100, [T("task", "Ergonomic work analysis", "Análise ergonômica do trabalho (AET)", 40, 80)]), T("milestone", "Annual report", "Relatório anual", 125, 125)] },
    { id: "o-wellbeing", area: "ohs", method: "hybrid", workflow: "simple", name: L("Mental health and well-being", "Saúde mental e bem-estar"), desc: L("Psychosocial risks, support programme and campaigns.", "Riscos psicossociais, programa de apoio e campanhas."),
      tree: [T("initiative", "Well-being programme", "Programa de bem-estar", 0, 120, [T("epic", "Psychosocial risks", "Riscos psicossociais", 0, 45, [T("task", "Survey", "Pesquisa de riscos psicossociais", 0, 20)]), T("epic", "Support programme", "Apoio psicológico", 30, 90), T("epic", "Campaigns", "Campanhas", 60, 120)])] },
    { id: "x-env", area: "she", method: "waterfall", workflow: "waterfall", name: L("Environmental management (ISO 14001)", "Gestão ambiental (ISO 14001)"), desc: L("Aspects and impacts, licences, waste and the certification audit.", "Aspectos e impactos, licenças, resíduos e auditoria de certificação."),
      tree: [T("phase", "Aspects and impacts", "Aspectos e impactos", 0, 30), T("phase", "Licences", "Licenças ambientais", 20, 80, [T("task", "Operating licence renewal", "Renovação da licença de operação", 20, 80)]), T("phase", "Waste", "Resíduos", 40, 110, [T("task", "Waste management plan", "Plano de gerenciamento de resíduos", 40, 90)]), T("milestone", "ISO 14001 audit", "Auditoria ISO 14001", 130, 130)] },
    { id: "x-safety", area: "she", method: "kanban", workflow: "simple", name: L("Safety inspections and permits", "Inspeções e permissões de trabalho"), desc: L("Work permits, inspections, lockout/tagout and emergency drills.", "Permissões de trabalho, inspeções, bloqueio e etiquetagem e simulados."),
      tree: [T("task", "Work permit – maintenance at height", "Permissão de trabalho – manutenção em altura"), T("task", "Monthly fire extinguisher inspection", "Inspeção mensal de extintores"), T("task", "Lockout/tagout procedure", "Procedimento de bloqueio e etiquetagem"), T("task", "Evacuation drill", "Simulado de evacuação")] },
  ];
  function seedTree(tree, method) {
    const items = {}; let n = 0, prevLeaf = null;
    function walk(rows, parent) {
      rows.forEach(function (r) {
        n++; const id = "i" + n, o = { type: r[0], title: r[1], status: "todo", order: n };
        if (parent) o.parent = parent;
        if (r[2] != null) { o.start = day(r[2]); o.end = day(r[3] != null ? r[3] : r[2]); }
        if (method === "waterfall" && (r[0] === "task" || r[0] === "milestone") && prevLeaf && o.start) { o.deps = {}; o.deps[prevLeaf] = true; }
        items[id] = o;
        if (r[0] === "task" || r[0] === "milestone") prevLeaf = id;
        walk(r[4] || [], id);
      });
    }
    walk(tree, null);
    return { items: items, sprints: {}, seq: n };
  }

  /* Starter structure: generic, no fake people. Returns { items, sprints }. */
  function seed(method) {
    const items = {}, sprints = {};
    let n = 0;
    function add(o) { n++; const id = "i" + n; o.order = n; items[id] = o; return id; }
    if (method === "waterfall") {
      const phases = [
        [L("Initiation", "Iniciação"), 0, 13, [L("Project charter", "Termo de abertura"), L("Stakeholder map", "Mapa de stakeholders")], L("Kick-off", "Kick-off")],
        [L("Planning", "Planejamento"), 14, 34, [L("Scope and WBS", "Escopo e EAP"), L("Schedule and budget", "Cronograma e orçamento"), L("Risk plan", "Plano de riscos")], L("Plan approved", "Plano aprovado")],
        [L("Execution", "Execução"), 35, 90, [L("Build", "Construção"), L("Testing", "Testes"), L("Training", "Treinamento")], null],
        [L("Go-live and closure", "Go-live e encerramento"), 91, 111, [L("Go-live", "Go-live"), L("Lessons learned", "Lições aprendidas")], L("Project closed", "Projeto encerrado")]
      ];
      let prevLast = null;
      phases.forEach(function (p) {
        const pid = add({ type: "phase", title: p[0], status: "todo", start: day(p[1]), end: day(p[2]) });
        const len = Math.max(3, Math.floor((p[2] - p[1] + 1) / p[3].length));
        p[3].forEach(function (t, i) {
          const s = p[1] + i * len, e = Math.min(p[2], s + len - 1);
          const o = { type: "task", title: t, parent: pid, status: "todo", start: day(s), end: day(e) };
          if (prevLast) { o.deps = {}; o.deps[prevLast] = true; }
          prevLast = add(o);
        });
        if (p[4]) { const m = add({ type: "milestone", title: p[4], parent: pid, status: "todo", start: day(p[2]), end: day(p[2]) }); const mo = items[m]; mo.deps = {}; mo.deps[prevLast] = true; prevLast = m; }
      });
    } else if (method === "scrum") {
      const e1 = add({ type: "epic", title: L("Epic 1 – first increment", "Épico 1 – primeiro incremento"), status: "todo", start: monday(0), end: monday(27) });
      add({ type: "epic", title: L("Epic 2 – next increment", "Épico 2 – próximo incremento"), status: "todo", start: monday(28), end: monday(55) });
      sprints.s1 = { name: "Sprint 1", start: monday(0), end: monday(11), state: "planned", goal: "", order: 1 };
      sprints.s2 = { name: "Sprint 2", start: monday(14), end: monday(25), state: "planned", goal: "", order: 2 };
      add({ type: "story", title: L("As a user, I want … so that …", "Como usuário, quero … para …"), parent: e1, status: "todo", sprint: "s1", points: 3 });
      add({ type: "task", title: L("Set up the team working agreement", "Definir o acordo de trabalho da equipe"), status: "todo", sprint: "s1", points: 1 });
      add({ type: "story", title: L("Refine the next backlog items", "Refinar os próximos itens do backlog"), parent: e1, status: "todo", points: 2 });
    } else if (method === "kanban") {
      add({ type: "task", title: L("Example card – drag me across the columns", "Cartão de exemplo – arraste-me pelas colunas"), status: "todo" });
      add({ type: "bug", title: L("Example bug", "Bug de exemplo"), status: "backlog" });
    } else {
      const q = [[0, 41], [42, 83], [84, 125]];
      const ini = add({ type: "initiative", title: L("Strategic initiative", "Iniciativa estratégica"), status: "todo" });
      [L("Discovery", "Descoberta"), L("MVP", "MVP"), L("Scale-up", "Escala")].forEach(function (t, i) {
        const e = add({ type: "epic", title: t, parent: ini, status: "todo", start: day(q[i][0]), end: day(q[i][1]) });
        add({ type: "story", title: L("First story of ", "Primeira história de ") + t, parent: e, status: "todo", start: day(q[i][0]), end: day(q[i][0] + 13) });
      });
      add({ type: "milestone", title: L("Launch", "Lançamento"), status: "todo", start: day(125), end: day(125) });
    }
    return { items: items, sprints: sprints, seq: n };
  }
  function keyPrefix(title) {
    const w = String(title || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
    let k = w.length > 1 ? w.map(function (x) { return x[0]; }).join("") : (w[0] || "PLN");
    return k.slice(0, 4).padEnd(2, "X");
  }
  /* opts: { workflow: preset id, tpl: area planning id } */
  function initialData(method, title, opts) {
    opts = opts || {};
    const tpl = opts.tpl && AREA_PLANS.find(function (p) { return p.id === opts.tpl; });
    if (tpl) method = tpl.method;
    const m = METHODS[method] || METHODS.hybrid, s = tpl ? seedTree(tpl.tree, tpl.method) : seed(m.id);
    const wfId = opts.workflow || (tpl && tpl.workflow);
    const W = workflows(), statuses = wfId && W[wfId] ? W[wfId].ss : m.statuses;
    /* starter items use "todo": map to the first to-do status of the delivery side of the chosen workflow */
    const ids = {}; statuses.forEach(function (x) { ids[x.id] = 1; });
    const first = (statuses.find(function (x) { return x.cat === "todo" && x.stage !== "up"; }) || statuses[0]).id;
    Object.keys(s.items).forEach(function (id, i) { s.items[id].key = keyPrefix(title) + "-" + (i + 1); if (!ids[s.items[id].status]) s.items[id].status = first; });
    return { settings: { statuses: statuses, prefix: keyPrefix(title), seq: s.seq }, items: s.items, sprints: s.sprints };
  }
  window.PLAN_METHODS = METHODS;
  window.PLAN_WORKFLOWS = workflows;
  window.PLAN_AREAS = AREAS;
  window.PLAN_AREA_ORDER = ["general", "health", "ohs", "she", "retail", "consulting", "education", "service"];
  window.PLAN_AREA_PLANS = AREA_PLANS;
  window.PLAN_ORDER = ["hybrid", "waterfall", "scrum", "kanban"];
  window.PLAN_INITIAL = initialData;
})();
