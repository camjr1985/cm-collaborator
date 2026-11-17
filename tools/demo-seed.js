/* CM Collaborator – demo data for tests (Planning in many areas + ITSM service centres).
 * Run on /admin/ signed in as a platform administrator:
 *   const s = document.createElement("script"); s.src = "../tools/demo-seed.js"; document.body.appendChild(s);
 *   then: await CMDemoSeed({ testEmail: "someone@example.com" })
 * Creates (or recreates) the workspace "demo-areas" with ~22 plannings (one per area) and ~12 ITSM centres,
 * gives the test e-mail editor access (agent in ITSM) and licenses both add-on modules for the workspace.
 * Everything is fictional sample data. */
(function () {
  "use strict";
  const DAY = 86400000;
  const WS = "demo-areas";
  function key(e) { return String(e || "").trim().toLowerCase().replace(/\./g, ","); }
  function iso(d) { const x = new Date(Date.now() + d * DAY); return x.toISOString().slice(0, 10); }
  function load(src) { return new Promise(function (res, rej) { if (window.ITSM) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }

  /* ---------- Planning: one per area ---------- */
  // e: [epic title, [[type, title, points?], ...]]
  const AREAS = [
    { id: "software", area: "general", method: "scrum", title: "Tecnologia · App mobile 2.0", ini: "Nova experiência mobile", okr: ["Aumentar a retenção do app", "Retenção D30 de 25 para 40%", "Nota na loja de 3,9 para 4,5"],
      epics: [["Onboarding", [["story", "Cadastro com login social", 5], ["story", "Tutorial interativo", 3], ["bug", "Crash ao abrir a câmera no Android 14", 2]]], ["Pagamentos no app", [["story", "Salvar cartão com tokenização", 8], ["story", "Pagamento com Pix", 5], ["task", "Revisão de segurança (pentest)", 3]]], ["Notificações", [["story", "Central de notificações", 5], ["story", "Preferências por canal", 3]]]] },
    { id: "health", area: "health", tpl: "h-accred", title: "Saúde · Acreditação hospitalar 2027" },
    { id: "retail", area: "retail", tpl: "r-campaigns", title: "Varejo · Calendário de campanhas 2027" },
    { id: "consulting", area: "consulting", tpl: "c-portfolio", title: "Consultoria · Portfólio de clientes" },
    { id: "education", area: "education", tpl: "e-semester", title: "Educação · Planejamento do semestre 2027.1" },
    { id: "service", area: "service", tpl: "s-csi", title: "Serviços · Melhoria contínua da central" },
    { id: "marketing", area: "general", method: "kanban", workflow: "updown", title: "Marketing · Lançamento de produto Q1", ini: "Lançamento do produto",
      epics: [["Pesquisa e posicionamento", [["task", "Pesquisa com 20 clientes"], ["task", "Mensagem principal e proposta de valor"]]], ["Conteúdo", [["task", "Landing page"], ["task", "Vídeo de 60 segundos"], ["task", "Série de posts no LinkedIn"]]], ["Mídia e eventos", [["task", "Campanha de mídia paga"], ["task", "Webinar de lançamento"]]]] },
    { id: "finance", area: "general", method: "waterfall", workflow: "waterfall", title: "Finanças · Orçamento 2027 e fechamento anual", budget: true,
      epics: [["Fechamento contábil", [["task", "Conciliações bancárias"], ["task", "Provisões e ajustes"], ["milestone", "Balanço aprovado"]]], ["Orçamento 2027", [["task", "Premissas macroeconômicas"], ["task", "Orçamento por área"], ["task", "Consolidação e revisão"], ["milestone", "Orçamento aprovado pelo conselho"]]]] },
    { id: "hr", area: "general", method: "hybrid", workflow: "simple", title: "RH · Onboarding e avaliação de desempenho", ini: "Experiência do colaborador", okr: ["Melhorar a experiência de quem entra", "eNPS de onboarding de 20 para 50", "Tempo até a produtividade de 90 para 60 dias"],
      epics: [["Onboarding", [["story", "Trilha de boas-vindas"], ["task", "Kit de equipamentos no 1º dia"], ["task", "Padrinho/madrinha por área"]]], ["Avaliação de desempenho", [["story", "Competências por cargo"], ["task", "Calibração com gestores"], ["task", "Feedback 1:1 trimestral"]]]] },
    { id: "legal", area: "general", method: "kanban", workflow: "simple", title: "Jurídico · Adequação à LGPD", ini: "Programa de privacidade",
      epics: [["Mapeamento de dados", [["task", "Inventário de dados pessoais"], ["task", "Bases legais por tratamento"]]], ["Governança", [["task", "Nomear o encarregado (DPO)"], ["task", "Política de privacidade"], ["task", "Treinamento das equipes"]]], ["Direitos dos titulares", [["task", "Canal de atendimento ao titular"], ["task", "Procedimento de incidentes"]]]] },
    { id: "construction", area: "general", method: "waterfall", workflow: "waterfall", title: "Construção · Obra da sede administrativa", budget: true,
      epics: [["Projetos e licenças", [["task", "Projeto executivo"], ["task", "Alvará de construção"], ["milestone", "Licenças aprovadas"]]], ["Estrutura", [["task", "Fundações"], ["task", "Estrutura e lajes"]]], ["Acabamento", [["task", "Instalações elétricas e hidráulicas"], ["task", "Revestimentos e pintura"], ["milestone", "Entrega das chaves"]]]] },
    { id: "industry", area: "general", method: "hybrid", workflow: "simple", title: "Indústria · Lean na linha de montagem", ini: "Eficiência operacional", okr: ["Aumentar a eficiência da linha", "OEE de 62 para 75%", "Refugo de 4 para 2%"],
      epics: [["Mapeamento (VSM)", [["task", "Mapa do estado atual"], ["task", "Mapa do estado futuro"]]], ["5S e padronização", [["task", "5S na célula 3"], ["task", "Trabalho padrão"]]], ["Manutenção (TPM)", [["task", "Plano de manutenção preventiva"], ["task", "Indicadores MTBF/MTTR"]]]] },
    { id: "logistics", area: "general", method: "kanban", workflow: "simple", title: "Logística · Rotas e armazém", ini: "Custo logístico",
      epics: [["Transporte", [["task", "Roteirização dinâmica"], ["task", "Renegociar fretes"]]], ["Armazém", [["task", "Endereçamento por curva ABC"], ["task", "Inventário cíclico"]]], ["Rastreamento", [["task", "Integração com transportadoras"], ["task", "Painel de entregas"]]]] },
    { id: "payments", area: "general", method: "scrum", title: "Bancos e pagamentos · Pix e Open Finance", ini: "Pagamentos instantâneos", okr: ["Crescer em pagamentos instantâneos", "Transações Pix/mês de 1 mi para 2 mi", "Taxa de fraude abaixo de 0,02%"],
      epics: [["Pix por aproximação", [["story", "Fluxo NFC no app", 8], ["story", "Limites e autenticação", 5]]], ["Open Finance", [["story", "Consentimento de dados", 5], ["story", "Iniciação de pagamento", 8]]], ["Antifraude", [["story", "Regras por dispositivo", 5], ["task", "Monitoramento em tempo real", 3]]]] },
    { id: "public", area: "general", method: "waterfall", workflow: "waterfall", title: "Setor público · Portal de serviços ao cidadão", budget: true,
      epics: [["Diagnóstico", [["task", "Levantamento dos 50 serviços mais buscados"], ["task", "Pesquisa com cidadãos"]]], ["Desenvolvimento", [["task", "Login único (gov.br)"], ["task", "Carta de serviços digital"], ["task", "Acessibilidade (eMAG)"]]], ["Implantação", [["task", "Piloto em 3 secretarias"], ["milestone", "Portal no ar"]]]] },
    { id: "ngo", area: "general", method: "hybrid", workflow: "simple", title: "ONG · Captação de recursos 2027", ini: "Sustentabilidade financeira", okr: ["Diversificar a receita", "Doadores recorrentes de 300 para 800", "3 novos editais aprovados"],
      epics: [["Doação recorrente", [["task", "Campanha de fim de ano"], ["task", "Régua de relacionamento"]]], ["Editais e parcerias", [["task", "Calendário de editais"], ["task", "Propostas para 5 empresas"]]]] },
    { id: "agro", area: "general", method: "waterfall", workflow: "waterfall", title: "Agronegócio · Safra 2027", budget: true,
      epics: [["Preparação", [["task", "Análise de solo"], ["task", "Compra de insumos"]]], ["Plantio", [["task", "Plantio da soja"], ["task", "Monitoramento de pragas"]]], ["Colheita", [["task", "Colheita e transporte"], ["milestone", "Safra entregue"]]]] },
    { id: "energy", area: "general", method: "hybrid", workflow: "simple", title: "Energia · Expansão de usinas solares", ini: "Geração distribuída", budget: true,
      epics: [["Usina Norte", [["task", "Licenciamento ambiental"], ["task", "Montagem dos painéis"]]], ["Usina Sul", [["task", "Conexão com a distribuidora"], ["task", "Comissionamento"]]]] },
    { id: "hospitality", area: "general", method: "kanban", workflow: "updown", title: "Hotelaria · Experiência do hóspede", ini: "NPS do hóspede",
      epics: [["Check-in", [["task", "Check-in digital"], ["task", "Chave no celular"]]], ["Serviços", [["task", "Cardápio por QR code"], ["task", "Pesquisa pós-estadia"]]]] },
    { id: "telecom", area: "general", method: "scrum", title: "Telecom · Migração para rede 5G", ini: "Rede 5G",
      epics: [["Rádio", [["story", "Ativar 120 sites 5G", 13], ["task", "Testes de cobertura", 5]]], ["Core", [["story", "Core 5G standalone", 13], ["task", "Plano de rollback", 3]]], ["Clientes", [["story", "Troca de chip em loja e online", 8]]]] },
    { id: "realestate", area: "general", method: "kanban", workflow: "simple", title: "Imobiliário · Lançamento residencial", ini: "Lançamento Jardins",
      epics: [["Produto", [["task", "Definir tipologias"], ["task", "Maquete e decorado"]]], ["Vendas", [["task", "Treinamento dos corretores"], ["task", "Evento de lançamento"]]]] },
    { id: "events", area: "general", method: "waterfall", workflow: "waterfall", title: "Eventos · Congresso anual 2027", budget: true,
      epics: [["Planejamento", [["task", "Local e datas"], ["task", "Patrocinadores"]]], ["Programação", [["task", "Chamada de palestras"], ["task", "Grade final"]]], ["Execução", [["task", "Credenciamento"], ["milestone", "Congresso"]]]] }
  ];

  function statusOf(statuses, cat, stage) {
    const fit = statuses.filter(function (s) { return s.cat === cat && (stage ? s.stage === stage : s.stage !== "up"); });
    return (fit[0] || statuses.find(function (s) { return s.cat === cat; }) || statuses[0]).id;
  }
  function buildPlanning(a, people, nowTs) {
    const PI = window.PLAN_INITIAL;
    const data = PI(a.tpl ? "hybrid" : a.method, a.title, { tpl: a.tpl, workflow: a.workflow });
    const st = data.settings.statuses, hasUp = st.some(function (s) { return s.stage === "up"; });
    let items = data.items, n = data.settings.seq || Object.keys(items).length;
    const pre = data.settings.prefix;
    function add(o) { n++; const id = "i" + n; o.order = n; o.key = pre + "-" + n; items[id] = o; return id; }
    if (!a.tpl) {
      items = {}; n = 0; data.sprints = {};
      const ini = a.ini ? add({ type: "initiative", title: a.ini, status: "todo" }) : null;
      const span = 120, per = Math.floor(span / a.epics.length);
      a.epics.forEach(function (e, ei) {
        const s0 = -40 + ei * per, e0 = s0 + per - 1;
        const ep = add({ type: a.method === "waterfall" ? "phase" : "epic", title: e[0], parent: ini || undefined, status: "todo", start: iso(s0), end: iso(e0) });
        if (a.budget) { items[ep].budget = 40000 + ei * 25000; items[ep].actual = ei === 0 ? 43500 : ei === 1 ? 18000 : 0; }
        const len = Math.max(1, Math.floor(per / e[1].length));
        e[1].forEach(function (c, ci) {
          const s = s0 + ci * len, en = c[0] === "milestone" ? e0 : s + len - 1;
          const o = { type: c[0], title: c[1], parent: ep, status: "todo", start: iso(c[0] === "milestone" ? e0 : s), end: iso(en) };
          if (c[2]) o.points = c[2];
          add(o);
        });
      });
      if (a.method === "scrum") {
        data.sprints = {
          s1: { name: "Sprint 1", start: iso(-28), end: iso(-15), state: "closed", goal: "Primeiro incremento", order: 1, closedAt: nowTs - 14 * DAY },
          s2: { name: "Sprint 2", start: iso(-14), end: iso(-1 + 14), state: "active", goal: "Entregar o fluxo principal", order: 2 },
          s3: { name: "Sprint 3", start: iso(14), end: iso(27), state: "planned", goal: "", order: 3 }
        };
      }
    } else {
      // template items: shift dates 35 days back so part of the plan is in the past
      Object.keys(items).forEach(function (k) { const it = items[k]; ["start", "end"].forEach(function (f) { if (it[f]) { it[f] = new Date(new Date(it[f]).getTime() - 35 * DAY).toISOString().slice(0, 10); } }); });
    }
    // progress: past items done, current in progress (some late), future to do; upstream ideas when the workflow has discovery
    const today = new Date().toISOString().slice(0, 10), keys = Object.keys(items), sps = Object.keys(data.sprints || {});
    keys.forEach(function (k, i) {
      const it = items[k], leaf = ["story", "task", "bug", "milestone"].indexOf(it.type) >= 0;
      let cat = "todo";
      if (it.end && it.end < today) cat = i % 5 === 0 ? "doing" : "done"; // one in five past items is late
      else if (it.start && it.start <= today) cat = "doing";
      it.status = statusOf(st, cat);
      if (hasUp && leaf && cat === "todo" && i % 2 === 0) it.status = statusOf(st, "todo", "up");
      if (cat === "done") { it.progress = 100; it.doneAt = new Date(it.end).getTime() + DAY / 2; }
      else if (cat === "doing") it.progress = 30 + (i * 7) % 50;
      if (leaf) { const p = people[i % (people.length + 1)]; if (p) it.assignee = p; }
      if (leaf && i % 4 === 1) it.prio = true;
      if (sps.length && leaf && it.type !== "milestone") { it.sprint = cat === "done" ? "s1" : cat === "doing" ? "s2" : (i % 2 ? "s3" : undefined); if (!it.points) it.points = [1, 2, 3, 5, 8][i % 5]; if (!it.sprint) delete it.sprint; }
      it.created = nowTs - (60 - i) * DAY; it.updated = nowTs - (i % 9) * DAY;
      Object.keys(it).forEach(function (f) { if (it[f] === undefined) delete it[f]; });
    });
    if (sps.length) {
      const s1 = keys.filter(function (k) { return items[k].sprint === "s1"; });
      const sp = s1.reduce(function (t, k) { return t + (items[k].points || 0); }, 0);
      data.sprints.s1.report = { items: s1.length, done: s1.length, sp: sp + 8, spDone: sp, noSp: 0 };
    }
    if (a.okr) {
      const ini = keys.find(function (k) { return items[k].type === "initiative"; });
      data.okrs = { o1: { title: a.okr[0], period: "2027-Q1", owner: people[0], order: 1, created: nowTs, by: people[0], krs: {
        k1: { title: a.okr[1], start: 0, target: 100, current: 45, unit: "%", order: 1, auto: true },
        k2: { title: a.okr[2], start: 0, target: 100, current: 30, unit: "%", order: 2 } } } };
      if (ini) { items[ini].krs = { "o1|k1": true }; }
    }
    data.items = items; data.settings.seq = n || data.settings.seq;
    if (!data.settings.seq) data.settings.seq = keys.length;
    return data;
  }

  /* ---------- ITSM: one service centre per area ---------- */
  // svc: [name, desc, group]; off: [service index, name, kind, approval?]; recs: [kind, title, impact, urgency, status, ageHours, serviceIdx]
  const CENTRES = [
    { id: "ti", title: "TI corporativa · Central de serviços", groups: ["Central de serviço (N1)", "Suporte técnico (N2)", "Infraestrutura"],
      svc: [["E-mail e colaboração", "Correio, agenda e reuniões on-line.", 1], ["Acesso e identidade", "Contas, senhas e permissões.", 0], ["Estações de trabalho", "Notebooks, monitores e periféricos.", 0], ["ERP", "Sistema de gestão da empresa.", 1]],
      off: [[1, "Redefinir senha", "request"], [1, "Novo acesso a sistema", "request", true], [2, "Novo equipamento", "request", true], [-1, "Relatar um problema", "incident"]],
      recs: [["incident", "E-mail fora do ar para a filial Recife", "high", "high", "doing", 3, 0], ["incident", "Notebook não liga após atualização", "low", "medium", "new", 5, 2], ["request", "Acesso ao ERP – módulo financeiro", "medium", "medium", "approval", 20, 3], ["request", "Redefinir senha da VPN", "low", "high", "resolved", 30, 1], ["incident", "Lentidão no ERP no fechamento", "high", "medium", "waiting", 26, 3], ["problem", "Quedas recorrentes do e-mail", "high", "medium", "analysis", 72, 0], ["change", "Atualizar o servidor de e-mail", "medium", "medium", "approved", 48, 0], ["improvement", "Autoatendimento de senha", "medium", "low", "identified", 200, 1]] },
    { id: "saude", title: "Saúde · Central administrativa do hospital", groups: ["Recepção e agendamento", "Engenharia clínica", "Faturamento"],
      svc: [["Agendamento e recepção", "Marcação de consultas e exames.", 0], ["Acesso ao prontuário eletrônico", "Perfis de acesso ao sistema clínico.", 0], ["Manutenção de equipamentos", "Equipamentos médicos e predial.", 1], ["Faturamento de convênios", "Guias, glosas e cobranças.", 2]],
      off: [[1, "Solicitar acesso ao prontuário", "request", true], [2, "Manutenção de equipamento", "request"], [0, "Problema no agendamento", "incident"]],
      recs: [["incident", "Sistema de agendamento indisponível no ambulatório", "high", "high", "doing", 2, 0], ["request", "Acesso ao prontuário para nova médica residente", "medium", "high", "approval", 10, 1], ["request", "Manutenção da autoclave do centro cirúrgico", "high", "medium", "doing", 18, 2], ["incident", "Guias de convênio rejeitadas em lote", "medium", "medium", "waiting", 40, 3], ["problem", "Glosas recorrentes por código de procedimento", "medium", "medium", "analysis", 120, 3], ["change", "Atualização do sistema de faturamento", "medium", "low", "scheduled", 60, 3]] },
    { id: "varejo", title: "Varejo · Suporte às lojas", groups: ["Suporte às lojas", "E-commerce", "Logística"],
      svc: [["PDV e caixa", "Frente de caixa e TEF.", 0], ["Estoque e reposição", "Pedidos e transferências.", 2], ["E-commerce", "Loja on-line.", 1], ["Promoções e preços", "Cadastro de ofertas.", 0]],
      off: [[0, "Caixa travado", "incident"], [1, "Pedido de reposição urgente", "request"], [3, "Cadastrar promoção", "request", true]],
      recs: [["incident", "TEF fora do ar na loja 12", "high", "high", "doing", 1, 0], ["incident", "Preço divergente na gôndola", "low", "medium", "new", 6, 3], ["request", "Reposição de estoque – Black Friday", "high", "high", "doing", 12, 1], ["request", "Cadastro da promoção de verão", "medium", "medium", "approval", 30, 3], ["problem", "Quedas de TEF às sextas-feiras", "high", "medium", "known", 150, 0], ["change", "Nova versão do PDV em 40 lojas", "high", "medium", "assess", 50, 0]] },
    { id: "educacao", title: "Educação · Secretaria acadêmica", groups: ["Secretaria", "Plataforma EAD", "Laboratórios"],
      svc: [["Matrícula", "Matrícula e rematrícula.", 0], ["Documentos acadêmicos", "Histórico, declarações e diplomas.", 0], ["Plataforma EAD", "Ambiente virtual de aprendizagem.", 1], ["Laboratórios", "Reservas e equipamentos.", 2]],
      off: [[1, "Solicitar declaração de matrícula", "request"], [1, "Solicitar histórico escolar", "request"], [2, "Problema na plataforma EAD", "incident"]],
      recs: [["incident", "Provas on-line não carregam", "high", "high", "doing", 2, 2], ["request", "Declaração de matrícula para estágio", "low", "medium", "resolved", 30, 1], ["request", "Histórico escolar para transferência", "medium", "medium", "doing", 20, 1], ["request", "Reserva do laboratório de química", "low", "low", "new", 8, 3], ["problem", "Lentidão da plataforma em semana de provas", "high", "medium", "analysis", 100, 2]] },
    { id: "rh", title: "RH · Central de pessoas", groups: ["Atendimento RH", "Folha de pagamento", "Benefícios"],
      svc: [["Folha de pagamento", "Holerites e descontos.", 1], ["Benefícios", "Plano de saúde, VR e VA.", 2], ["Admissão e desligamento", "Documentação e acessos.", 0], ["Férias", "Programação e pagamento.", 0]],
      off: [[0, "Dúvida sobre o holerite", "request"], [1, "Incluir dependente no plano de saúde", "request", true], [3, "Programar férias", "request", true]],
      recs: [["request", "Incluir dependente no plano de saúde", "low", "medium", "approval", 14, 1], ["request", "Dúvida sobre desconto no holerite", "low", "low", "resolved", 50, 0], ["incident", "Holerites de novembro não liberados", "high", "high", "doing", 4, 0], ["request", "Admissão – 5 analistas em janeiro", "medium", "medium", "doing", 30, 2], ["improvement", "Portal de autoatendimento de férias", "medium", "low", "assessed", 300, 3]] },
    { id: "facilities", title: "Facilities · Manutenção predial", groups: ["Manutenção", "Limpeza", "Segurança"],
      svc: [["Manutenção predial", "Elétrica, hidráulica e ar-condicionado.", 0], ["Limpeza", "Rotinas e chamados.", 1], ["Segurança patrimonial", "Portaria e acessos.", 2], ["Salas e reservas", "Reservas de salas e auditório.", 0]],
      off: [[0, "Ar-condicionado com defeito", "incident"], [3, "Reservar auditório", "request"], [2, "Cadastrar visitante", "request"]],
      recs: [["incident", "Ar-condicionado parado no 5º andar", "medium", "high", "doing", 3, 0], ["incident", "Vazamento no banheiro do térreo", "medium", "high", "new", 1, 0], ["request", "Reserva do auditório para evento", "low", "medium", "resolved", 48, 3], ["request", "Cadastro de visitantes da auditoria", "low", "medium", "doing", 6, 2], ["change", "Troca do quadro elétrico", "high", "medium", "scheduled", 90, 0]] },
    { id: "financeiro", title: "Financeiro · Centro de serviços compartilhados", groups: ["Contas a pagar", "Contas a receber", "Fiscal"],
      svc: [["Contas a pagar", "Pagamento de fornecedores.", 0], ["Reembolso de despesas", "Viagens e despesas.", 0], ["Notas fiscais", "Emissão e escrituração.", 2], ["Cadastro de fornecedores", "Inclusão e alteração.", 0]],
      off: [[1, "Pedir reembolso", "request", true], [3, "Cadastrar fornecedor", "request", true], [0, "Pagamento em atraso", "incident"]],
      recs: [["request", "Reembolso de viagem a São Paulo", "low", "medium", "approval", 20, 1], ["incident", "Pagamento de fornecedor crítico em atraso", "high", "high", "doing", 6, 0], ["request", "Cadastro de novo fornecedor de TI", "medium", "medium", "doing", 26, 3], ["problem", "Notas fiscais com retenção incorreta", "medium", "medium", "analysis", 90, 2]] },
    { id: "juridico", title: "Jurídico · Contratos e compliance", groups: ["Contratos", "Consultivo", "Privacidade (LGPD)"],
      svc: [["Contratos", "Elaboração e revisão.", 0], ["Consultas jurídicas", "Pareceres e orientações.", 1], ["Privacidade (LGPD)", "Direitos dos titulares e incidentes.", 2]],
      off: [[0, "Revisar contrato", "request", true], [1, "Consulta jurídica", "request"], [2, "Pedido de titular (LGPD)", "request"]],
      recs: [["request", "Revisão de contrato com cliente estratégico", "high", "medium", "doing", 30, 0], ["request", "Pedido de exclusão de dados (titular)", "medium", "high", "doing", 10, 2], ["incident", "Possível vazamento de planilha com dados pessoais", "high", "high", "doing", 4, 2], ["request", "Parecer sobre home office internacional", "low", "low", "new", 50, 1]] },
    { id: "pagamentos", title: "Bancos e pagamentos · Operações", groups: ["Operações Pix", "Cartões", "Antifraude"],
      svc: [["Pix", "Pagamentos instantâneos.", 0], ["Cartões", "Autorizações e chargebacks.", 1], ["Conciliação", "Conciliação diária.", 0], ["Antifraude", "Regras e alertas.", 2]],
      off: [[0, "Pix não creditado", "incident"], [1, "Contestação de compra", "request"], [3, "Ajustar regra antifraude", "request", true]],
      recs: [["incident", "Pix com atraso de liquidação", "high", "high", "doing", 1, 0], ["request", "Contestação de compra não reconhecida", "medium", "medium", "waiting", 40, 1], ["incident", "Diferença na conciliação de ontem", "medium", "high", "new", 5, 2], ["problem", "Falsos positivos no antifraude", "medium", "medium", "known", 140, 3], ["change", "Janela de manutenção do autorizador", "high", "medium", "approved", 70, 1]] },
    { id: "publico", title: "Setor público · Atendimento ao cidadão", groups: ["Atendimento", "Obras e serviços urbanos", "Ouvidoria"],
      svc: [["Tributos (IPTU)", "Segunda via e parcelamento.", 0], ["Iluminação pública", "Lâmpadas apagadas.", 1], ["Coleta de lixo", "Coleta e entulho.", 1], ["Ouvidoria", "Reclamações e sugestões.", 2]],
      off: [[0, "Segunda via do IPTU", "request"], [1, "Poste apagado", "incident"], [2, "Coleta de entulho", "request"]],
      recs: [["incident", "Rua inteira sem iluminação – Bairro Centro", "medium", "high", "doing", 12, 1], ["request", "Coleta de entulho – Rua das Flores", "low", "medium", "new", 20, 2], ["request", "Parcelamento do IPTU", "low", "low", "resolved", 70, 0], ["improvement", "Agendamento on-line da coleta", "medium", "low", "approved", 400, 2]] },
    { id: "telecom", title: "Telecom · NOC e suporte ao cliente", groups: ["Suporte N1", "NOC", "Campo"],
      svc: [["Internet fibra", "Banda larga residencial.", 1], ["Telefonia móvel", "Planos e chips.", 0], ["Instalação", "Agenda de técnicos.", 2]],
      off: [[0, "Internet lenta ou caindo", "incident"], [2, "Agendar instalação", "request"], [1, "Portabilidade", "request"]],
      recs: [["incident", "Rompimento de fibra – região Norte", "high", "high", "doing", 2, 0], ["incident", "Cliente sem sinal após troca de chip", "low", "medium", "waiting", 16, 1], ["request", "Instalação em condomínio novo", "medium", "medium", "doing", 30, 2], ["problem", "Quedas por superaquecimento de OLT", "high", "medium", "analysis", 96, 0], ["change", "Upgrade de firmware das OLTs", "high", "medium", "assess", 40, 0]] },
    { id: "logistica", title: "Logística · Torre de controle", groups: ["Transporte", "Armazém", "Atendimento"],
      svc: [["Transporte", "Coletas e entregas.", 0], ["Armazém", "Recebimento e expedição.", 1], ["Rastreamento", "Status das entregas.", 2]],
      off: [[0, "Entrega atrasada", "incident"], [1, "Agendar recebimento", "request"]],
      recs: [["incident", "Carga parada na rodovia – pedido 4521", "high", "medium", "doing", 5, 0], ["request", "Agendar recebimento de 3 carretas", "medium", "medium", "resolved", 30, 1], ["incident", "Rastreamento sem atualização desde ontem", "medium", "high", "new", 20, 2], ["improvement", "Roteirização com janela de entrega", "medium", "low", "doing", 250, 0]] }
  ];
  function buildCentre(c, owner, test, nowTs, wsId) {
    wsId = wsId || WS;
    const I = window.ITSM, G = {}, gk = ["g1", "g2", "g3"];
    c.groups.forEach(function (n, i) { G[gk[i]] = { name: n }; });
    const settings = {
      prefixes: { incident: "INC", request: "REQ", task: "TSK", problem: "PRB", change: "CHG", improvement: "IMP" },
      matrix: I.MATRIX, calendar: { mode: "business", days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00", tz: -180 },
      autoCloseDays: 3, trend: { n: 3, days: 7 }, ai: true, emails: true, approvalRule: "all", groups: G,
      boards: [{ id: "b1", kind: "incident", name: "Incidentes", lane: "group" }, { id: "b2", kind: "request", name: "Requisições", lane: "" }, { id: "b3", kind: "change", name: "Mudanças", lane: "" }, { id: "b4", kind: "problem", name: "Problemas", lane: "" }]
    };
    const services = {}, offerings = {};
    c.svc.forEach(function (s, i) { services["s" + (i + 1)] = { name: s[0], desc: s[1], group: gk[s[2]], status: "live", kind: "service" }; });
    c.off.forEach(function (o, i) { offerings["o" + (i + 1)] = { service: o[0] >= 0 ? "s" + (o[0] + 1) : "", name: o[1], kind: o[2], approval: !!o[3], desc: "", order: i + 1 }; });
    const counters = { INC: 0, REQ: 0, TSK: 0, PRB: 0, CHG: 0, IMP: 0 }, records = {}, history = {}, mine = {};
    const reqs = [{ k: key(owner), email: owner, name: "Carlos Alexandre" }, { k: key(test), email: test, name: "Usuário de teste" }];
    c.recs.forEach(function (r, i) {
      const pre = settings.prefixes[r[0]], t = nowTs - r[5] * 3600000;
      counters[pre]++;
      const o = { kind: r[0], title: r[1], desc: "Registro de exemplo para testes.", impact: r[2], urgency: r[3], status: r[4], created: t, updated: t + 1800000, by: owner,
        key: pre + "-" + String(counters[pre]).padStart(4, "0"), service: "s" + (r[6] + 1), group: services["s" + (r[6] + 1)].group };
      o.priority = I.priority(o.impact, o.urgency, settings.matrix);
      if (r[0] === "incident" || r[0] === "request") {
        const rq = reqs[i % 2]; o.requester = { k: rq.k, email: rq.email, name: rq.name, ws: wsId };
        const tg = I.targets(o, { defaults: I.SLA_DEFAULT }); o.sla = { start: t, resp: tg.resp, res: tg.res };
        if (r[4] !== "new") o.sla.respAt = t + 600000;
        if (r[4] === "resolved") o.sla.stopAt = t + 3 * 3600000;
        mine[rq.k] = mine[rq.k] || {}; mine[rq.k]["r" + i] = true;
      }
      if (r[4] !== "new" && r[4] !== "identified" && r[4] !== "draft") o.assignee = i % 2 ? test : owner;
      records["r" + i] = o;
      history["r" + i] = { h1: { by: owner, t: t, field: "created", to: o.status } };
    });
    const kb = { a1: { title: "Perguntas frequentes – " + c.svc[0][0], body: "Artigo de exemplo da base de conhecimento.\n\n1. Verifique se o problema já está registrado.\n2. Use o portal para abrir uma solicitação.\n3. Acompanhe o andamento em “Meus chamados”.", service: "s1", status: "published", created: nowTs, by: owner } };
    const cmdb = { cis: { ci1: { name: c.svc[0][0] + " – sistema", type: "application", status: "live", service: "s1" }, ci2: { name: c.svc[1][0] + " – sistema", type: "application", status: "live", service: "s2" } }, rels: { r1: { from: "ci1", type: "depends", to: "ci2" } } };
    const members = {}; members[key(test)] = { email: test, name: "Usuário de teste", role: "agent" };
    return {
      info: { title: c.title, ws: wsId, area: c.area || "service", owner: key(owner), created: nowTs, createdBy: owner, framework: "both", members: members },
      data: { settings: settings, counters: counters, records: records, history: history, catalog: { categories: { c1: { name: "Geral" } }, services: services, offerings: offerings }, kb: kb, cmdb: cmdb, sla: { defaults: I.SLA_DEFAULT } },
      mine: mine
    };
  }


  /* ---------- extra demo spaces owned by a customer account (full management inside them) ---------- */
  const SPACES = [
    { id: "demo-saude-ocupacional", name: "Demonstração – Saúde ocupacional", area: "health",
      plans: [
        { id: "sst-pcmso", area: "health", method: "waterfall", workflow: "waterfall", title: "SST · Programa de saúde ocupacional (PCMSO) 2027", budget: true,
          epics: [["Diagnóstico", [["task", "Inventário de riscos (PGR)"], ["task", "Mapa de exposição por função"]]], ["Exames ocupacionais", [["task", "Exames admissionais"], ["task", "Exames periódicos por função"], ["task", "Retorno ao trabalho"], ["task", "Exames demissionais"]]], ["Ergonomia", [["task", "Análise ergonômica do trabalho (AET)"], ["task", "Ginástica laboral"]]], ["Indicadores e eSocial", [["task", "Envio dos eventos S-2220 e S-2240"], ["task", "Indicadores de absenteísmo"], ["milestone", "Relatório anual do PCMSO"]]]] },
        { id: "sst-cipa", area: "health", method: "kanban", workflow: "simple", title: "SST · Prevenção de acidentes e CIPA", ini: "Zero acidente com afastamento",
          epics: [["Treinamentos NR", [["task", "NR-35 – trabalho em altura"], ["task", "NR-10 – eletricidade"], ["task", "NR-06 – entrega e uso de EPIs"]]], ["CIPA", [["task", "Eleição da CIPA"], ["task", "Mapa de riscos por setor"], ["task", "SIPAT"]]], ["Investigação de acidentes", [["task", "Investigação – acidente no almoxarifado"], ["task", "Plano de ação 5W2H"]]]] },
        { id: "sst-mental", area: "health", method: "hybrid", workflow: "simple", title: "SST · Saúde mental e bem-estar", ini: "Programa de bem-estar", okr: ["Reduzir afastamentos por saúde mental", "Afastamentos de 18 para 10 por trimestre", "Adesão ao programa de 30 para 60%"],
          epics: [["Riscos psicossociais (NR-1)", [["task", "Pesquisa de riscos psicossociais"], ["task", "Plano de ação por área"]]], ["Apoio psicológico", [["task", "Contratar programa de apoio"], ["task", "Divulgar o canal de acolhimento"]]], ["Campanhas", [["task", "Setembro Amarelo"], ["task", "Semana de qualidade de vida"]]]] }
      ],
      centres: [
        { id: "sst", title: "Saúde ocupacional · Central de atendimento SST", area: "health", groups: ["Medicina do trabalho", "Segurança do trabalho", "Ergonomia"],
          svc: [["Exames ocupacionais", "Agendamento e resultados (ASO).", 0], ["Atestados e afastamentos", "Envio e homologação de atestados.", 0], ["EPIs", "Solicitação e troca de equipamentos de proteção.", 1], ["Ergonomia do posto de trabalho", "Avaliação e ajustes.", 2]],
          off: [[0, "Agendar exame periódico", "request"], [1, "Enviar atestado médico", "request"], [2, "Solicitar EPI", "request", true], [-1, "Relatar acidente ou incidente de trabalho", "incident"], [3, "Pedir avaliação ergonômica", "request"]],
          recs: [["incident", "Queda de escada no almoxarifado (sem afastamento)", "high", "high", "doing", 3, 2], ["request", "Agendar exame periódico – equipe de produção", "medium", "medium", "doing", 20, 0], ["request", "Homologar atestado de 3 dias", "low", "medium", "resolved", 30, 1], ["request", "Troca de protetor auricular – linha 2", "medium", "high", "approval", 6, 2], ["request", "Avaliação ergonômica – atendimento", "low", "low", "new", 40, 3], ["problem", "Aumento de queixas de dor lombar no setor de expedição", "medium", "medium", "analysis", 120, 3], ["improvement", "Agendamento on-line dos exames periódicos", "medium", "low", "approved", 300, 0]] }
      ] },
    { id: "demo-she", name: "Demonstração – SHE (segurança, saúde e meio ambiente)", area: "she",
      plans: [
        { id: "she-iso14001", area: "she", method: "waterfall", workflow: "waterfall", title: "SHE · Gestão ambiental (ISO 14001)", budget: true,
          epics: [["Aspectos e impactos", [["task", "Levantamento de aspectos ambientais"], ["task", "Matriz de significância"]]], ["Licenças ambientais", [["task", "Renovação da licença de operação"], ["task", "Condicionantes da licença"]]], ["Resíduos e efluentes", [["task", "Plano de gerenciamento de resíduos"], ["task", "Monitoramento de efluentes"]]], ["Certificação", [["task", "Auditoria interna"], ["milestone", "Auditoria de certificação ISO 14001"]]]] },
        { id: "she-safety", area: "she", method: "kanban", workflow: "simple", title: "SHE · Inspeções e permissões de trabalho", ini: "Segurança operacional",
          epics: [["Permissões de trabalho", [["task", "PT – manutenção em altura na torre 2"], ["task", "PT – trabalho a quente na caldeira"]]], ["Inspeções", [["task", "Inspeção mensal de extintores"], ["task", "Inspeção de andaimes"], ["task", "Checklist de empilhadeiras"]]], ["Emergências", [["task", "Simulado de evacuação"], ["task", "Treinamento da brigada"], ["task", "Plano de atendimento a emergências"]]]] },
        { id: "she-metas", area: "she", method: "hybrid", workflow: "simple", title: "SHE · Metas SSMA 2027", ini: "Zero acidente grave", okr: ["Zero acidente grave em 2027", "Taxa de frequência de 3,2 para 1,5", "Resíduos reciclados de 40 para 70%"],
          epics: [["Cultura de segurança", [["task", "DDS diário em todas as áreas"], ["task", "Observação comportamental"]]], ["Meio ambiente", [["task", "Coleta seletiva nas unidades"], ["task", "Redução do consumo de água"]]], ["Saúde", [["task", "Campanha de vacinação"], ["task", "Programa de conservação auditiva"]]]] }
      ],
      centres: [
        { id: "she", title: "SHE · Central SSMA (ocorrências e solicitações)", area: "she", groups: ["Segurança do trabalho", "Meio ambiente", "Emergências"],
          svc: [["Permissão de trabalho", "Emissão e liberação de PTs.", 0], ["Ocorrências e quase-acidentes", "Registro e investigação.", 0], ["Resíduos e licenças", "Coletas e condicionantes.", 1], ["Inspeções", "Extintores, andaimes e equipamentos.", 0]],
          off: [[-1, "Relatar quase-acidente ou condição insegura", "incident"], [0, "Pedir permissão de trabalho", "request", true], [2, "Coleta de resíduo perigoso", "request"], [-1, "Relatar vazamento ou impacto ambiental", "incident"]],
          recs: [["incident", "Vazamento de óleo na área de tancagem", "high", "high", "doing", 2, 2], ["incident", "Quase-acidente: empilhadeira sem sinal sonoro", "medium", "high", "new", 4, 1], ["request", "PT para solda na caldeira – sábado", "high", "medium", "approval", 10, 0], ["request", "Coleta de lâmpadas fluorescentes", "low", "low", "resolved", 60, 2], ["request", "Inspeção dos extintores do galpão B", "medium", "medium", "doing", 20, 3], ["problem", "Quase-acidentes recorrentes no carregamento", "medium", "medium", "analysis", 150, 1], ["change", "Novo procedimento de bloqueio e etiquetagem", "medium", "medium", "approved", 90, 0]] }
      ] }
  ];
  window.CMDemoSpaces = function (opt) {
    opt = opt || {};
    const db = window.firebase.database(), me = window.firebase.auth().currentUser, admin = me.email, cust = (opt.email || "").toLowerCase(), nowTs = Date.now();
    if (!cust) return Promise.reject(new Error("email required"));
    const people = [cust, admin], log = [];
    // customer validation account: every add-on licensed individually + Enterprise plan (not a platform admin)
    const base = {};
    base["entitlements/users/" + key(cust) + "/itsm"] = { on: true, until: null, plan: "paid", by: admin, at: nowTs };
    base["entitlements/users/" + key(cust) + "/game"] = { on: true, until: null, plan: "paid", by: admin, at: nowTs };
    base["plans/" + key(cust)] = { email: cust, plan: "enterprise", seats: 200, until: null, by: admin, at: nowTs, source: "admin" };
    SPACES.forEach(function (sp) {
      base["workspaces/" + sp.id + "/info"] = { name: sp.name, owner: key(cust), created: nowTs, area: sp.area, demo: true };
      base["workspaces/" + sp.id + "/members/" + key(admin)] = { email: admin, name: "Carlos Alexandre", role: "editor", added: nowTs };
      base["userWorkspaces/" + key(cust) + "/" + sp.id] = { name: sp.name, expires: null };
      base["userWorkspaces/" + key(admin) + "/" + sp.id] = { name: sp.name, expires: null };
      base["entitlements/ws/" + sp.id + "/itsm"] = { on: true, until: null, plan: "paid", pkg: "empresarial", by: admin, at: nowTs };
      base["entitlements/ws/" + sp.id + "/game"] = { on: true, until: null, plan: "paid", pkg: "empresarial", by: admin, at: nowTs };
    });
    return db.ref().update(base).then(function () {
      log.push("licences, plan, spaces");
      return load("../assets/js/itsm-core.js");
    }).then(function () {
      const jobs = [];
      SPACES.forEach(function (sp) {
        sp.plans.forEach(function (a) { jobs.push(function () {
          const id = "demo-" + a.id, u = {}, method = a.tpl ? (window.PLAN_AREA_PLANS.find(function (x) { return x.id === a.tpl; }) || {}).method : a.method;
          u["planning/" + id + "/info"] = { title: a.title, ws: sp.id, method: method, created: nowTs, createdBy: cust, area: a.area, demo: true };
          u["planning/" + id + "/data"] = buildPlanning(a, people, nowTs);
          u["workspaces/" + sp.id + "/plannings/" + id] = { title: a.title, method: method, created: nowTs };
          return db.ref().update(u).then(function () { log.push("planning " + id); }, function (e) { log.push("planning " + id + " FAILED: " + e.message); });
        }); });
        sp.centres.forEach(function (c0) { jobs.push(function () {
          const c = c0.base ? Object.assign({}, CENTRES.find(function (x) { return x.id === c0.base; }), { id: c0.id, title: "TI · Central de serviços" }) : c0;
          const id = "demo-" + c.id, u = {}, cen = buildCentre(c, cust, admin, nowTs, sp.id);
          cen.info.owner = key(cust); cen.info.members = {}; cen.info.members[key(cust)] = { email: cust, name: "Digital Agile", role: "manager" };
          u["itsm/" + id] = cen;
          u["workspaces/" + sp.id + "/itsm/" + id] = { title: c.title, created: nowTs, home: true };
          u["userItsm/" + key(cust) + "/" + id] = { title: c.title, role: "manager" };
          return db.ref().update(u).then(function () { log.push("itsm " + id); }, function (e) { log.push("itsm " + id + " FAILED: " + e.message); });
        }); });
      });
      return jobs.reduce(function (p, j) { return p.then(j); }, Promise.resolve());
    }).then(function () { return log; });
  };

  window.CMDemoSeed = function (opt) {
    opt = opt || {};
    const db = window.firebase.database(), me = window.firebase.auth().currentUser, owner = me.email, test = (opt.testEmail || "").toLowerCase(), nowTs = Date.now();
    if (!test) return Promise.reject(new Error("testEmail required"));
    const people = [owner, test];
    const log = [];
    const base = {};
    base["workspaces/" + WS + "/info"] = { name: "Demonstração – todas as áreas", owner: key(owner), created: nowTs, area: "general", demo: true };
    base["workspaces/" + WS + "/members/" + key(test)] = { email: test, name: "Usuário de teste (Digital Agile)", role: "editor", added: nowTs };
    base["userWorkspaces/" + key(test) + "/" + WS] = { name: "Demonstração – todas as áreas", expires: null };
    base["entitlements/ws/" + WS + "/itsm"] = { on: true, until: null, plan: "beta", pkg: "empresarial", by: owner, at: nowTs };
    base["entitlements/ws/" + WS + "/game"] = { on: true, until: null, plan: "beta", pkg: "empresarial", by: owner, at: nowTs };
    return db.ref().update(base).then(function () {
      log.push("workspace + access + licences");
      return AREAS.reduce(function (p, a) {
        return p.then(function () {
          const id = "demo-" + a.id, u = {};
          u["planning/" + id + "/info"] = { title: a.title, ws: WS, method: a.tpl ? (window.PLAN_AREA_PLANS.find(function (x) { return x.id === a.tpl; }) || {}).method : a.method, created: nowTs, createdBy: owner, area: a.area, demo: true };
          if (a.tpl) u["planning/" + id + "/info"].tpl = a.tpl;
          u["planning/" + id + "/data"] = buildPlanning(a, people, nowTs);
          u["workspaces/" + WS + "/plannings/" + id] = { title: a.title, method: u["planning/" + id + "/info"].method, created: nowTs };
          return db.ref().update(u).then(function () { log.push("planning " + id); });
        });
      }, Promise.resolve());
    }).then(function () { return load("../assets/js/itsm-core.js"); }).then(function () {
      return CENTRES.reduce(function (p, c) {
        return p.then(function () {
          const id = "demo-" + c.id, u = {};
          u["itsm/" + id] = buildCentre(c, owner, test, nowTs);
          u["workspaces/" + WS + "/itsm/" + id] = { title: c.title, created: nowTs, home: true };
          u["userItsm/" + key(test) + "/" + id] = { title: c.title, role: "agent" };
          return db.ref().update(u).then(function () { log.push("itsm " + id); }, function (e) { log.push("itsm " + id + " FAILED: " + e.message); });
        });
      }, Promise.resolve());
    }).then(function () { return log; });
  };
})();
