/*
 * CM Collaborator – template library, part 2 (Design & UX, Design Thinking, Processes,
 * Product management, Architecture, Software architecture, Security architecture).
 * Uses the builders exposed by kits.js (window.MBKit). Brand: navy #0E1A33 · teal #2CC4B3 · gold #E8C468.
 */
(function () {
  "use strict";
  if (!window.MBKit || !window.MB_KITS) return;
  const PT = window.MB_LANG === "pt";
  const L = function (en, pt) { return PT ? pt : en; };
  const C = window.MB_KC, BG = window.MB_KBG, kit = window.MBKit;
  const NAVY = "#0E1A33", TEAL = "#2CC4B3", GOLD = "#E8C468", INK = "#0E1A33", MUTED = "#4a5068";
  const TEALL = "#D6F5EF", NAVYL = "#E6ECF7", GOLDL = "#FBF3DA", WHITE = "#ffffff", GRAY = "#F2F4F8";

  /* shared: outer frame + brand header, returns { k, y } where y is the first free line */
  function start(w, h, title, sub) { const k = kit(); k.F(0, 0, w, h, title); const y = k.H(0, 0, w, title, sub); return { k: k, y: y + 50 }; }
  function note(k, x, y, w, text) { return k.T(x, y, text, 15, w, MUTED); }

  const K = {};

  /* ======================= DESIGN & UX ======================= */
  K.userflow = { cat: "design", name: L("User flow", "Fluxo do usuário"), desc: L("Screens, decisions and paths a user takes to reach a goal.", "Telas, decisões e caminhos que o usuário percorre até o objetivo."),
    build: function () {
      const s = start(1900, 820, L("User flow", "Fluxo do usuário"), L("Goal: … · Persona: … · Entry point: …", "Objetivo: … · Persona: … · Ponto de entrada: …")), k = s.k, y = s.y + 120;
      const a = k.Sh(40, y + 25, 150, 70, "pill", L("Start", "Início"), TEAL, INK);
      const b = k.Sh(240, y + 10, 200, 100, "round", L("Home page", "Página inicial"), WHITE);
      const c = k.Sh(500, y, 180, 120, "diamond", L("Signed in?", "Está logado?"), GOLDL);
      const d = k.Sh(760, y + 10, 200, 100, "round", "Dashboard", WHITE);
      const e = k.Sh(1020, y + 10, 220, 100, "round", L("Main action", "Ação principal"), WHITE);
      const f = k.Sh(1300, y + 10, 220, 100, "round", L("Confirmation", "Confirmação"), WHITE);
      const g = k.Sh(1580, y + 25, 150, 70, "pill", L("Goal reached", "Objetivo atingido"), NAVY, "#ffffff");
      const h = k.Sh(490, y + 220, 200, 100, "round", L("Sign in / sign up", "Login / cadastro"), NAVYL);
      [[a, b], [b, c], [c, d], [d, e], [e, f], [f, g], [c, h], [h, d]].forEach(function (p) { k.A(p[0], p[1]); });
      k.T(700, y + 40, L("yes", "sim"), 14, 60, MUTED); k.T(600, y + 150, L("no", "não"), 14, 60, MUTED);
      k.F(40, y + 380, 820, 200, L("Pain points and questions", "Dores e dúvidas"), BG.red); k.S(60, y + 410, "", C.red); k.S(210, y + 410, "", C.red);
      k.F(900, y + 380, 960, 200, L("Opportunities", "Oportunidades"), BG.green); k.S(920, y + 410, "", C.green); k.S(1070, y + 410, "", C.green);
      return k.out;
    } };
  K.wireframe = { cat: "design", name: L("Wireframes – web and mobile", "Wireframes – web e celular"), desc: L("Low-fidelity layout of a web page and a mobile screen with notes.", "Layout de baixa fidelidade de uma página web e de uma tela de celular, com anotações."),
    build: function () {
      const s = start(1800, 1060, L("Wireframes", "Wireframes"), L("Low fidelity: structure and hierarchy first, visual design later.", "Baixa fidelidade: primeiro estrutura e hierarquia, depois o visual.")), k = s.k, y = s.y;
      k.F(40, y, 1060, 820, L("Web · 1440 px", "Web · 1440 px"), WHITE);
      k.SL(60, y + 20, 1020, 56, "  Logo        " + L("Menu · Products · Pricing", "Menu · Produtos · Preços") + "                               " + L("Sign in", "Entrar"), NAVYL, 16);
      k.Sh(60, y + 96, 1020, 260, "rect", L("Hero: headline + subtitle\n[ Call to action ]", "Destaque: título + subtítulo\n[ Botão de ação ]"), GRAY);
      [0, 1, 2].forEach(function (i) { k.Sh(60 + i * 346, y + 376, 328, 220, "round", L("Card ", "Cartão ") + (i + 1) + L("\nimage · title · text", "\nimagem · título · texto"), WHITE); });
      k.Sh(60, y + 616, 1020, 120, "rect", L("Social proof / logos / testimonials", "Prova social / logos / depoimentos"), GRAY);
      k.SL(60, y + 752, 1020, 50, "  " + L("Footer · links · contact", "Rodapé · links · contato"), NAVYL, 14);
      k.F(1140, y, 400, 820, L("Mobile · 390 px", "Celular · 390 px"), WHITE);
      k.Sh(1170, y + 20, 340, 50, "rect", "☰  Logo        🔍", NAVYL);
      k.Sh(1170, y + 86, 340, 200, "rect", L("Headline\n[ Call to action ]", "Título\n[ Botão de ação ]"), GRAY);
      k.Sh(1170, y + 302, 340, 120, "round", L("Card 1", "Cartão 1"), WHITE); k.Sh(1170, y + 436, 340, 120, "round", L("Card 2", "Cartão 2"), WHITE);
      k.Sh(1170, y + 730, 340, 64, "rect", "🏠    🔍    ➕    👤", NAVYL);
      k.F(1580, y, 180, 820, L("Notes", "Anotações"), GOLDL); k.S(1595, y + 30, L("Rule / behaviour", "Regra / comportamento"), C.gold, 150, 110); k.S(1595, y + 160, L("Open question", "Dúvida em aberto"), C.mint, 150, 110);
      return k.out;
    } };
  K.usability = { cat: "design", name: L("Usability test", "Teste de usabilidade"), desc: L("Script, tasks, results per participant, findings by severity and next steps.", "Roteiro, tarefas, resultados por participante, achados por severidade e próximos passos."),
    build: function () {
      const s = start(1900, 1080, L("Usability test", "Teste de usabilidade"), L("Product: … · Prototype: … · Date: … · Moderator: …", "Produto: … · Protótipo: … · Data: … · Moderador: …")), k = s.k, y = s.y;
      k.F(40, y, 420, 860, L("Script and tasks", "Roteiro e tarefas"), NAVYL);
      [L("Task 1 – find …", "Tarefa 1 – encontrar …"), L("Task 2 – complete …", "Tarefa 2 – concluir …"), L("Task 3 – change …", "Tarefa 3 – alterar …"), L("Task 4 – share …", "Tarefa 4 – compartilhar …")].forEach(function (t, i) { k.S(60, y + 30 + i * 140, t, C.navyL, 380, 110); });
      k.F(500, y, 820, 520, L("Results per participant", "Resultados por participante"), WHITE);
      ["P1", "P2", "P3", "P4"].forEach(function (p, i) { k.Sh(680 + i * 155, y + 30, 140, 50, "round", p, NAVY, "#ffffff"); });
      [1, 2, 3, 4].forEach(function (t, r) {
        k.Sh(520, y + 100 + r * 100, 145, 80, "round", L("Task ", "Tarefa ") + t, GRAY);
        [0, 1, 2, 3].forEach(function (c) { const v = (r + c) % 3; k.Sh(680 + c * 155, y + 100 + r * 100, 140, 80, "round", v === 0 ? "✔ " + L("success", "sucesso") : v === 1 ? "⚠ " + L("with help", "com ajuda") : "✖ " + L("failed", "falhou"), v === 0 ? BG.green : v === 1 ? BG.yellow : BG.red); });
      });
      const sev = [[L("Critical", "Crítico"), BG.red, C.red], [L("High", "Alto"), BG.orange, C.orange], [L("Medium / low", "Médio / baixo"), BG.yellow, C.gold]];
      sev.forEach(function (v, i) { k.F(1360, y + i * 290, 500, 270, L("Findings · ", "Achados · ") + v[0], v[1]); k.S(1380, y + 30 + i * 290, "", v[2]); });
      k.F(500, y + 560, 820, 300, L("Next steps", "Próximos passos"), BG.green); k.S(520, y + 590, L("Change …", "Ajustar …"), C.green); k.S(670, y + 590, L("Retest …", "Testar de novo …"), C.green);
      return k.out;
    } };
  K.cardsort = { cat: "design", name: L("Card sorting", "Card sorting"), desc: L("Ask users to group content into categories to shape the information architecture.", "Peça aos usuários para agrupar conteúdos em categorias e definir a arquitetura de informação."),
    build: function () {
      const s = start(1700, 980, L("Card sorting", "Card sorting"), L("Open sort: participants create and name the categories. Closed sort: the categories are given.", "Aberto: os participantes criam e nomeiam as categorias. Fechado: as categorias já vêm definidas.")), k = s.k, y = s.y;
      k.F(40, y, 460, 760, L("Cards to sort", "Cartões para organizar"), GRAY);
      for (let i = 0; i < 12; i++) k.S(60 + (i % 3) * 145, y + 30 + Math.floor(i / 3) * 120, L("Content ", "Conteúdo ") + (i + 1), C.gold, 130, 100);
      [[L("Category A", "Categoria A"), BG.mint], [L("Category B", "Categoria B"), BG.navy], [L("Category C", "Categoria C"), BG.gold], [L("Category D", "Categoria D"), BG.purple]].forEach(function (c, i) { k.F(540 + (i % 2) * 560, y + Math.floor(i / 2) * 390, 540, 370, c[0], c[1]); });
      return k.out;
    } };

  /* ======================= DESIGN THINKING ======================= */
  K.dt5 = { cat: "dthinking", name: L("Design Thinking – 5 stages", "Design Thinking – 5 etapas"), desc: L("Empathise, define, ideate, prototype and test – with guiding questions for each stage.", "Empatizar, definir, idear, prototipar e testar – com perguntas-guia em cada etapa."),
    build: function () {
      const s = start(2000, 1000, "Design Thinking", L("Challenge: …  ·  Team: …  ·  Date: …", "Desafio: …  ·  Equipe: …  ·  Data: …")), k = s.k, y = s.y;
      const st = [[L("1 · Empathise", "1 · Empatizar"), L("Who are the users? What do they do, think and feel?", "Quem são os usuários? O que fazem, pensam e sentem?"), C.mint, BG.mint],
        [L("2 · Define", "2 · Definir"), L("What is the real problem? Write it as a point of view.", "Qual é o problema real? Escreva como ponto de vista."), C.navyL, BG.navy],
        [L("3 · Ideate", "3 · Idear"), L("How might we…? Quantity first, then cluster and vote.", "Como poderíamos…? Primeiro quantidade, depois agrupar e votar."), C.gold, BG.gold],
        [L("4 · Prototype", "4 · Prototipar"), L("What is the cheapest way to make the idea tangible?", "Qual é o jeito mais barato de tornar a ideia tangível?"), C.orange, BG.orange],
        [L("5 · Test", "5 · Testar"), L("What did we learn? What do we keep, change or drop?", "O que aprendemos? O que mantemos, mudamos ou descartamos?"), C.green, BG.green]];
      const heads = [];
      st.forEach(function (v, i) {
        const x = 40 + i * 390;
        heads.push(k.Sh(x, y, 360, 70, "round", v[0], i % 2 ? NAVY : TEAL, i % 2 ? "#ffffff" : INK));
        k.F(x, y + 110, 360, 700, "", v[3]); k.T(x + 20, y + 130, v[1], 16, 320, MUTED);
        k.S(x + 20, y + 220, "", v[2]); k.S(x + 170, y + 220, "", v[2]);
      });
      for (let i = 0; i < 4; i++) k.A(heads[i], heads[i + 1]);
      return k.out;
    } };
  K.hmw = { cat: "dthinking", name: L("How might we…?", "Como poderíamos…?"), desc: L("Turn problems into opportunity questions, cluster them and vote.", "Transforme problemas em perguntas de oportunidade, agrupe e vote."),
    build: function () {
      const s = start(1700, 960, L("How might we…?", "Como poderíamos…?"), L("Each post-it starts with “How might we…”. 10 minutes in silence, then cluster and dot-vote.", "Cada post-it começa com “Como poderíamos…”. 10 minutos em silêncio, depois agrupar e votar.")), k = s.k, y = s.y;
      k.F(40, y, 1620, 150, L("Problem statement", "Declaração do problema"), NAVYL);
      k.S(60, y + 25, L("[User] needs [need] because [insight].", "[Usuário] precisa de [necessidade] porque [insight]."), C.navyL, 700, 100);
      k.F(40, y + 190, 520, 560, L("Questions (diverge)", "Perguntas (divergir)"), GOLDL);
      for (let i = 0; i < 6; i++) k.S(60 + (i % 3) * 160, y + 220 + Math.floor(i / 3) * 130, L("How might we …?", "Como poderíamos …?"), C.gold, 145, 110);
      [L("Theme 1", "Tema 1"), L("Theme 2", "Tema 2"), L("Theme 3", "Tema 3")].forEach(function (t, i) { k.F(600 + i * 360, y + 190, 340, 560, t, [BG.mint, BG.purple, BG.orange][i]); });
      return k.out;
    } };
  K.crazy8 = { cat: "dthinking", name: "Crazy 8s", desc: L("Eight ideas in eight minutes – one minute per sketch.", "Oito ideias em oito minutos – um minuto por esboço."),
    build: function () {
      const s = start(1700, 920, "Crazy 8s", L("8 minutes · 1 minute per idea · quantity over quality · then each person presents their top 2.", "8 minutos · 1 minuto por ideia · quantidade antes de qualidade · depois cada um apresenta as 2 melhores.")), k = s.k, y = s.y;
      for (let i = 0; i < 8; i++) k.F(40 + (i % 4) * 410, y + Math.floor(i / 4) * 350, 390, 330, L("Idea ", "Ideia ") + (i + 1), i % 2 ? WHITE : GRAY);
      return k.out;
    } };
  K.impacteffort = { cat: "dthinking", name: L("Impact × effort matrix", "Matriz impacto × esforço"), desc: L("Place ideas by impact and effort to find the quick wins.", "Posicione as ideias por impacto e esforço para achar os ganhos rápidos."),
    build: function () {
      const s = start(1240, 1080, L("Impact × effort", "Impacto × esforço"), L("Drag each idea to the right quadrant. Start with the quick wins.", "Arraste cada ideia para o quadrante certo. Comece pelos ganhos rápidos.")), k = s.k, y = s.y + 30;
      const q = [[L("✅ Quick wins · high impact, low effort", "✅ Ganhos rápidos · alto impacto, baixo esforço"), BG.green, C.green], [L("🏗 Big projects · high impact, high effort", "🏗 Grandes projetos · alto impacto, alto esforço"), BG.navy, C.navyL], [L("🧩 Fill-ins · low impact, low effort", "🧩 Tarefas menores · baixo impacto, baixo esforço"), BG.gold, C.gold], [L("⛔ Avoid · low impact, high effort", "⛔ Evitar · baixo impacto, alto esforço"), BG.red, C.red]];
      q.forEach(function (v, i) { const x = 40 + (i % 2) * 600, yy = y + Math.floor(i / 2) * 400; k.F(x, yy, 580, 380, v[0], v[1]); k.S(x + 20, yy + 30, "", v[2]); });
      return k.out;
    } };

  /* ======================= PROCESSES ======================= */
  K.bpmn = { cat: "process", name: L("BPMN process with swimlanes", "Processo BPMN com raias"), desc: L("Start, tasks, gateway and end across lanes – connectors stay attached when you move shapes.", "Início, tarefas, decisão e fim entre raias – os conectores acompanham as formas."),
    build: function () {
      const s = start(2000, 960, L("Process – swimlanes (BPMN)", "Processo – raias (BPMN)"), L("Process: … · Owner: … · Version: … · Trigger: …", "Processo: … · Dono: … · Versão: … · Gatilho: …")), k = s.k, y = s.y;
      const lanes = [L("Customer", "Cliente"), L("Service desk", "Atendimento"), L("Finance", "Financeiro")];
      lanes.forEach(function (l, i) { k.F(40, y + i * 230, 1920, 210, l, [BG.mint, WHITE, BG.navy][i]); });
      const r = function (i) { return y + i * 230 + 65; };
      const st = k.Sh(90, r(0), 80, 80, "ellipse", L("Start", "Início"), TEAL, INK);
      const t1 = k.Sh(230, r(0) - 10, 200, 100, "round", L("Open request", "Abrir solicitação"), WHITE);
      const t2 = k.Sh(500, r(1) - 10, 200, 100, "round", L("Analyse request", "Analisar solicitação"), WHITE);
      const g1 = k.Sh(780, r(1) - 20, 140, 120, "diamond", L("Approved?", "Aprovado?"), GOLDL);
      const t3 = k.Sh(1000, r(2) - 10, 200, 100, "round", L("Issue invoice", "Emitir cobrança"), WHITE);
      const t4 = k.Sh(1000, r(0) - 10, 200, 100, "round", L("Notify refusal", "Avisar recusa"), WHITE);
      const t5 = k.Sh(1290, r(2) - 10, 200, 100, "round", L("Confirm payment", "Confirmar pagamento"), WHITE);
      const t6 = k.Sh(1560, r(1) - 10, 200, 100, "round", L("Deliver service", "Entregar serviço"), WHITE);
      const en = k.Sh(1830, r(1), 80, 80, "ellipse", L("End", "Fim"), NAVY, "#ffffff");
      [[st, t1], [t1, t2], [t2, g1], [g1, t3], [g1, t4], [t3, t5], [t5, t6], [t6, en]].forEach(function (p) { k.A(p[0], p[1]); });
      k.T(930, r(1) + 70, L("yes", "sim"), 14, 60, MUTED); k.T(850, r(1) - 70, L("no", "não"), 14, 60, MUTED);
      note(k, 40, y + 700, 1400, L("Legend: ● start / end · ▭ task · ◇ decision (gateway) · → sequence flow. Double-click a task to rename it; drag shapes and the arrows follow.", "Legenda: ● início / fim · ▭ tarefa · ◇ decisão (gateway) · → fluxo. Dê duplo clique numa tarefa para renomear; arraste as formas e as setas acompanham."));
      return k.out;
    } };
  K.sipoc = { cat: "process", name: "SIPOC", desc: L("Suppliers, inputs, process, outputs and customers on one page.", "Fornecedores, entradas, processo, saídas e clientes numa só página."),
    build: function () {
      const s = start(1900, 980, "SIPOC", L("Process: … · Scope from … to …", "Processo: … · Escopo de … até …")), k = s.k, y = s.y;
      const cols = [["S", L("Suppliers", "Fornecedores"), BG.navy, C.navyL], ["I", L("Inputs", "Entradas"), BG.mint, C.mint], ["P", L("Process", "Processo"), GOLDL, null], ["O", L("Outputs", "Saídas"), BG.mint, C.mint], ["C", L("Customers", "Clientes"), BG.navy, C.navyL]];
      cols.forEach(function (c, i) {
        const x = 40 + i * 370;
        k.Sh(x, y, 350, 64, "round", c[0] + " · " + c[1], i === 2 ? NAVY : TEAL, i === 2 ? "#ffffff" : INK);
        k.F(x, y + 90, 350, 660, "", c[2]);
        if (c[3]) { k.S(x + 20, y + 115, "", c[3]); k.S(x + 180, y + 115, "", c[3]); }
      });
      let prev = null;
      [L("1 · Receive", "1 · Receber"), L("2 · Check", "2 · Verificar"), L("3 · Execute", "3 · Executar"), L("4 · Review", "4 · Revisar"), L("5 · Deliver", "5 · Entregar")].forEach(function (t, i) {
        const id = k.Sh(800, y + 115 + i * 125, 290, 90, "round", t, WHITE); if (prev) k.A(prev, id); prev = id;
      });
      return k.out;
    } };
  K.vsm = { cat: "process", name: L("Value stream map", "Mapa de fluxo de valor (VSM)"), desc: L("Process steps with cycle time, waiting time and lead time to find waste.", "Etapas com tempo de ciclo, espera e lead time para encontrar desperdícios."),
    build: function () {
      const s = start(2000, 1000, L("Value stream map", "Mapa de fluxo de valor"), L("Family of products/services: … · Demand: … per day", "Família de produtos/serviços: … · Demanda: … por dia")), k = s.k, y = s.y;
      const sup = k.Sh(40, y, 220, 90, "hexagon", L("Supplier", "Fornecedor"), NAVYL);
      const cus = k.Sh(1740, y, 220, 90, "hexagon", L("Customer", "Cliente"), NAVYL);
      k.Sh(840, y, 320, 90, "round", L("Planning / control", "Planejamento / controle"), GOLDL);
      let prev = sup;
      for (let i = 0; i < 5; i++) {
        const x = 40 + i * 390;
        const p = k.Sh(x, y + 180, 260, 90, "rect", L("Step ", "Etapa ") + (i + 1), NAVY, "#ffffff");
        k.SL(x, y + 280, 260, 120, L("C/T: … min\nC/O: … min\nUptime: … %\nPeople: …", "T/C: … min\nT/R: … min\nDisp.: … %\nPessoas: …"), WHITE, 14);
        if (i < 4) k.Sh(x + 290, y + 190, 70, 70, "triangle", "I", GOLD);
        k.A(prev, p); prev = p;
      }
      k.A(prev, cus);
      k.F(40, y + 450, 1920, 170, L("Timeline", "Linha do tempo"), WHITE);
      k.SL(60, y + 480, 1500, 50, L("  Waiting time: … d   ·   … d   ·   … d   ·   … d", "  Tempo de espera: … d   ·   … d   ·   … d   ·   … d"), GOLDL, 15);
      k.SL(60, y + 545, 1500, 50, L("  Value-adding time: … min · … min · … min · … min · … min", "  Tempo que agrega valor: … min · … min · … min · … min · … min"), BG.mint, 15);
      k.Sh(1600, y + 480, 340, 115, "round", L("Lead time: … d\nValue time: … min", "Lead time: … d\nTempo de valor: … min"), NAVY, "#ffffff");
      k.F(40, y + 650, 1920, 190, L("Waste and kaizen ideas", "Desperdícios e ideias de kaizen"), BG.red); k.S(60, y + 680, "", C.red); k.S(210, y + 680, "", C.gold);
      return k.out;
    } };
  K.asistobe = { cat: "process", name: L("Process as-is × to-be", "Processo atual × futuro"), desc: L("Map today's process with its pains, design the future one and list the gains.", "Mapeie o processo de hoje com as dores, desenhe o futuro e liste os ganhos."),
    build: function () {
      const s = start(1900, 1000, L("Process: as-is × to-be", "Processo: atual × futuro"), L("Process: … · Owner: … · KPI: …", "Processo: … · Dono: … · KPI: …")), k = s.k, y = s.y;
      k.F(40, y, 1820, 360, L("AS-IS – today", "AS-IS – como é hoje"), BG.red);
      let prev = null;
      for (let i = 0; i < 5; i++) { const id = k.Sh(70 + i * 350, y + 40, 250, 90, "round", L("Step ", "Etapa ") + (i + 1), WHITE); if (prev) k.A(prev, id); prev = id; }
      k.S(70, y + 180, L("Pain: …", "Dor: …"), C.red); k.S(420, y + 180, L("Rework …", "Retrabalho …"), C.red); k.S(770, y + 180, L("Waiting …", "Espera …"), C.red);
      k.F(40, y + 400, 1820, 360, L("TO-BE – future", "TO-BE – como será"), BG.green);
      prev = null;
      for (let i = 0; i < 4; i++) { const id = k.Sh(70 + i * 440, y + 440, 280, 90, "round", L("New step ", "Nova etapa ") + (i + 1), WHITE); if (prev) k.A(prev, id); prev = id; }
      k.S(70, y + 580, L("Automate …", "Automatizar …"), C.green); k.S(510, y + 580, L("Remove …", "Eliminar …"), C.green);
      k.F(40, y + 800, 1820, 130, L("Expected gains", "Ganhos esperados"), GOLDL);
      k.SL(60, y + 830, 560, 70, L("  ⏱ Lead time: from … to …", "  ⏱ Lead time: de … para …"), WHITE, 15); k.SL(640, y + 830, 560, 70, L("  💰 Cost: …", "  💰 Custo: …"), WHITE, 15); k.SL(1220, y + 830, 600, 70, L("  😀 Customer: …", "  😀 Cliente: …"), WHITE, 15);
      return k.out;
    } };

  /* ======================= PRODUCT MANAGEMENT ======================= */
  K.visionboard = { cat: "product", name: L("Product vision board", "Visão de produto (canvas)"), desc: L("Vision, target group, needs, product and business goals on one canvas.", "Visão, público-alvo, necessidades, produto e objetivos de negócio num só canvas."),
    build: function () {
      const s = start(1700, 960, L("Product vision board", "Visão de produto"), L("Product: … · Owner: … · Horizon: …", "Produto: … · Responsável: … · Horizonte: …")), k = s.k, y = s.y;
      k.F(40, y, 1620, 150, L("Vision – why does the product exist?", "Visão – por que o produto existe?"), NAVYL); k.S(60, y + 25, "", C.navyL, 700, 100);
      [[L("Target group", "Público-alvo"), BG.mint, C.mint], [L("Needs", "Necessidades"), BG.gold, C.gold], [L("Product – top 3–5 features", "Produto – 3 a 5 funcionalidades"), BG.navy, C.navyL], [L("Business goals", "Objetivos de negócio"), BG.green, C.green]].forEach(function (c, i) {
        const x = 40 + i * 410; k.F(x, y + 190, 390, 560, c[0], c[1]); k.S(x + 20, y + 220, "", c[2]);
      });
      return k.out;
    } };
  K.leancanvas = { cat: "product", name: "Lean Canvas", desc: L("Problem, solution, unique value, channels, customers, costs and revenue.", "Problema, solução, proposta de valor, canais, clientes, custos e receitas."),
    build: function () {
      const s = start(1900, 1020, "Lean Canvas", L("Product / idea: … · Version: … · Date: …", "Produto / ideia: … · Versão: … · Data: …")), k = s.k, y = s.y, W = 352, Hh = 540;
      const cell = function (x, yy, w, h, t, bg, st) { k.F(x, yy, w, h, t, bg); k.S(x + 18, yy + 30, "", st, 130, 100); };
      cell(40, y, W, Hh, L("1 · Problem", "1 · Problema"), BG.red, C.red);
      cell(40 + (W + 20), y, W, Hh / 2 - 10, L("4 · Solution", "4 · Solução"), BG.green, C.green);
      cell(40 + (W + 20), y + Hh / 2 + 10, W, Hh / 2 - 10, L("8 · Key metrics", "8 · Métricas-chave"), BG.navy, C.navyL);
      cell(40 + 2 * (W + 20), y, W, Hh, L("3 · Unique value proposition", "3 · Proposta única de valor"), GOLDL, C.gold);
      cell(40 + 3 * (W + 20), y, W, Hh / 2 - 10, L("9 · Unfair advantage", "9 · Vantagem injusta"), BG.purple, C.purple);
      cell(40 + 3 * (W + 20), y + Hh / 2 + 10, W, Hh / 2 - 10, L("5 · Channels", "5 · Canais"), BG.mint, C.mint);
      cell(40 + 4 * (W + 20), y, W, Hh, L("2 · Customer segments", "2 · Segmentos de clientes"), BG.navy, C.navyL);
      cell(40, y + Hh + 20, 900, 230, L("7 · Cost structure", "7 · Estrutura de custos"), GRAY, C.navyL);
      cell(960, y + Hh + 20, 900, 230, L("6 · Revenue streams", "6 · Fontes de receita"), BG.green, C.green);
      return k.out;
    } };
  K.ost = { cat: "product", name: L("Opportunity solution tree", "Árvore de oportunidades"), desc: L("Desired outcome → opportunities → solutions → experiments (continuous discovery).", "Resultado desejado → oportunidades → soluções → experimentos (discovery contínuo)."),
    build: function () {
      const s = start(1900, 1000, L("Opportunity solution tree", "Árvore de oportunidades e soluções"), L("Start from one measurable outcome. Opportunities come from customer interviews.", "Comece por um resultado mensurável. As oportunidades vêm de entrevistas com clientes.")), k = s.k, y = s.y;
      const out = k.Sh(750, y, 400, 100, "round", L("🎯 Desired outcome\n(e.g. +20% activation)", "🎯 Resultado desejado\n(ex.: +20% de ativação)"), NAVY, "#ffffff");
      for (let i = 0; i < 3; i++) {
        const ox = 120 + i * 600;
        const op = k.Sh(ox, y + 190, 360, 90, "round", L("Opportunity ", "Oportunidade ") + (i + 1), TEAL, INK); k.A(out, op);
        for (let j = 0; j < 2; j++) {
          const sx = ox - 70 + j * 260;
          const so = k.Sh(sx, y + 370, 240, 80, "round", L("Solution ", "Solução ") + (i + 1) + "." + (j + 1), GOLDL); k.A(op, so);
          const ex = k.S(sx + 40, y + 520, L("Experiment / test", "Experimento / teste"), C.mint, 160, 100); k.A(so, ex);
        }
      }
      return k.out;
    } };
  K.rice = { cat: "product", name: L("RICE prioritisation", "Priorização RICE"), desc: L("Score = reach × impact × confidence ÷ effort. Each post-it calculates its own score.", "Score = alcance × impacto × confiança ÷ esforço. Cada post-it calcula o próprio score."),
    build: function () {
      const s = start(1700, 900, L("RICE prioritisation", "Priorização RICE"), L("Select a post-it and click RICE in the bar to fill reach, impact (0.25–3), confidence (%) and effort (person-months).", "Selecione um post-it e clique em RICE na barra para preencher alcance, impacto (0,25–3), confiança (%) e esforço (pessoa-mês).")), k = s.k, y = s.y;
      k.F(40, y, 1000, 640, L("Backlog to prioritise", "Backlog para priorizar"), WHITE);
      const items = [[L("Feature A", "Funcionalidade A"), 5000, 2, 80, 3], [L("Feature B", "Funcionalidade B"), 1200, 3, 50, 2], [L("Feature C", "Funcionalidade C"), 8000, 1, 100, 5], [L("Improvement D", "Melhoria D"), 600, 0.5, 80, 1], [L("Feature E", "Funcionalidade E"), 3000, 1, 50, 4], [L("Experiment F", "Experimento F"), 900, 2, 30, 1]];
      items.forEach(function (it, i) { const id = k.S(60 + (i % 3) * 320, y + 40 + Math.floor(i / 3) * 280, it[0], [C.gold, C.mint, C.navyL][i % 3], 290, 200); const o = k.out[k.out.length - 1]; o.rice = { reach: it[1], impact: it[2], confidence: it[3], effort: it[4] }; return id; });
      k.F(1080, y, 580, 640, L("How to score", "Como pontuar"), GOLDL);
      k.T(1100, y + 30, L("Reach – people per quarter\nImpact – 3 massive · 2 high · 1 medium · 0.5 low · 0.25 minimal\nConfidence – 100% high · 80% medium · 50% low\nEffort – person-months\n\nThe score appears on each post-it – highest first.", "Alcance – pessoas por trimestre\nImpacto – 3 enorme · 2 alto · 1 médio · 0,5 baixo · 0,25 mínimo\nConfiança – 100% alta · 80% média · 50% baixa\nEsforço – pessoa-mês\n\nO score aparece em cada post-it – comece pelo maior."), 16, 540, INK);
      return k.out;
    } };
  K.nnl = { cat: "product", name: L("Roadmap now / next / later", "Roadmap agora / próximo / depois"), desc: L("Outcome-based roadmap by horizon, with themes and goals.", "Roadmap por horizonte e resultados, com temas e objetivos."),
    build: function () {
      const s = start(1700, 980, L("Roadmap – now · next · later", "Roadmap – agora · próximo · depois"), L("Product: … · Updated: … · Linked OKR: …", "Produto: … · Atualizado em: … · OKR ligado: …")), k = s.k, y = s.y;
      [[L("NOW · committed", "AGORA · comprometido"), BG.green, C.green, TEAL], [L("NEXT · planned", "PRÓXIMO · planejado"), BG.gold, C.gold, GOLD], [L("LATER · exploring", "DEPOIS · explorando"), BG.navy, C.navyL, "#AFC3EA"]].forEach(function (c, i) {
        const x = 40 + i * 545;
        k.Sh(x, y, 525, 60, "round", c[0], c[3], INK);
        k.F(x, y + 80, 525, 680, "", c[1]);
        k.S(x + 20, y + 100, L("Theme / outcome", "Tema / resultado"), c[2], 230, 110); k.S(x + 270, y + 100, "", c[2], 230, 110);
      });
      return k.out;
    } };
  K.storymap = { cat: "product", name: L("User story map", "Story mapping"), desc: L("User activities, steps and stories sliced into releases (MVP first).", "Atividades do usuário, passos e histórias fatiadas em releases (MVP primeiro)."),
    build: function () {
      const s = start(1900, 1000, L("User story map", "Story mapping"), L("Read left to right (the journey) and top to bottom (priority).", "Leia da esquerda para a direita (a jornada) e de cima para baixo (prioridade).")), k = s.k, y = s.y;
      const acts = [L("Discover", "Descobrir"), L("Sign up", "Cadastrar"), L("Use", "Usar"), L("Pay", "Pagar"), L("Get support", "Obter suporte")];
      acts.forEach(function (a, i) {
        const x = 220 + i * 330;
        k.Sh(x, y, 300, 70, "round", a, NAVY, "#ffffff");
        k.S(x, y + 90, L("Step", "Passo"), C.mint, 140, 90); k.S(x + 160, y + 90, L("Step", "Passo"), C.mint, 140, 90);
      });
      k.T(40, y + 20, L("Activities", "Atividades"), 16, 160, MUTED); k.T(40, y + 115, L("Steps", "Passos"), 16, 160, MUTED);
      [[L("MVP", "MVP"), BG.green, C.gold], [L("Release 2", "Release 2"), BG.gold, C.gold], [L("Later", "Depois"), GRAY, C.navyL]].forEach(function (r, i) {
        const yy = y + 220 + i * 230; k.F(40, yy, 1840, 210, r[0], r[1]);
        for (let j = 0; j < 5; j++) k.S(220 + j * 330, yy + 30, "", r[2], 140, 100);
      });
      return k.out;
    } };

  /* ======================= ARCHITECTURE ======================= */
  K.c4context = { cat: "arch", name: L("C4 – system context", "C4 – contexto do sistema"), desc: L("The system, its users and the external systems it talks to.", "O sistema, seus usuários e os sistemas externos com que conversa."),
    build: function () {
      const s = start(1700, 980, L("C4 · Level 1 – system context", "C4 · Nível 1 – contexto do sistema"), L("Audience: everyone (business and tech). No technology details at this level.", "Público: todos (negócio e TI). Sem detalhes de tecnologia neste nível.")), k = s.k, y = s.y;
      const u1 = k.Sh(140, y + 20, 220, 120, "ellipse", L("👤 Customer\n[person]", "👤 Cliente\n[pessoa]"), NAVYL);
      const u2 = k.Sh(1340, y + 20, 220, 120, "ellipse", L("👤 Back-office user\n[person]", "👤 Operador interno\n[pessoa]"), NAVYL);
      const sys = k.Sh(640, y + 260, 420, 170, "round", L("Our system\n[software system]\nWhat it does in one line", "Nosso sistema\n[sistema de software]\nO que faz em uma linha"), NAVY, "#ffffff");
      const e1 = k.Sh(100, y + 560, 320, 120, "round", L("Payment provider\n[external system]", "Provedor de pagamentos\n[sistema externo]"), GRAY);
      const e2 = k.Sh(690, y + 560, 320, 120, "round", L("E-mail service\n[external system]", "Serviço de e-mail\n[sistema externo]"), GRAY);
      const e3 = k.Sh(1280, y + 560, 320, 120, "round", L("ERP\n[external system]", "ERP\n[sistema externo]"), GRAY);
      [[u1, sys], [u2, sys], [sys, e1], [sys, e2], [sys, e3]].forEach(function (p) { k.A(p[0], p[1]); });
      note(k, 40, y + 730, 1500, L("Label each arrow with the intent and protocol, e.g. “sends invoices [HTTPS/JSON]”.", "Escreva em cada seta a intenção e o protocolo, ex.: “envia faturas [HTTPS/JSON]”."));
      return k.out;
    } };
  K.c4container = { cat: "arch", name: L("C4 – containers", "C4 – contêineres"), desc: L("Apps, APIs, databases and queues inside the system boundary.", "Aplicações, APIs, bancos de dados e filas dentro da fronteira do sistema."),
    build: function () {
      const s = start(1900, 1060, L("C4 · Level 2 – containers", "C4 · Nível 2 – contêineres"), L("Each box: name, [technology] and responsibility.", "Cada caixa: nome, [tecnologia] e responsabilidade.")), k = s.k, y = s.y;
      const u = k.Sh(80, y + 30, 220, 110, "ellipse", L("👤 User", "👤 Usuário"), NAVYL);
      k.F(380, y, 1100, 800, L("System boundary", "Fronteira do sistema"), "#F7FAFD");
      const web = k.Sh(420, y + 50, 300, 120, "round", L("Web app\n[React]", "Aplicação web\n[React]"), TEALL);
      const mob = k.Sh(780, y + 50, 300, 120, "round", L("Mobile app\n[Flutter]", "App celular\n[Flutter]"), TEALL);
      const api = k.Sh(600, y + 260, 320, 130, "round", L("API\n[Node / Java]\nbusiness rules", "API\n[Node / Java]\nregras de negócio"), NAVY, "#ffffff");
      const wk = k.Sh(1120, y + 270, 300, 110, "round", L("Worker\n[jobs]", "Worker\n[processos]"), WHITE);
      const db = k.Sh(470, y + 520, 300, 130, "round", L("🗄 Database\n[PostgreSQL]", "🗄 Banco de dados\n[PostgreSQL]"), GOLDL);
      const q = k.Sh(870, y + 520, 300, 130, "round", L("📨 Queue / events\n[Kafka / RabbitMQ]", "📨 Fila / eventos\n[Kafka / RabbitMQ]"), GOLDL);
      const ext = k.Sh(1560, y + 280, 300, 110, "round", L("External API\n[partner]", "API externa\n[parceiro]"), GRAY);
      [[u, web], [u, mob], [web, api], [mob, api], [api, db], [api, q], [q, wk], [wk, ext]].forEach(function (p) { k.A(p[0], p[1]); });
      return k.out;
    } };
  K.integration = { cat: "arch", name: L("Systems integration map", "Mapa de integração entre sistemas"), desc: L("Source systems, integration layer and consumers, with protocols and volumes.", "Sistemas de origem, camada de integração e consumidores, com protocolos e volumes."),
    build: function () {
      const s = start(1900, 1000, L("Systems integration", "Integração entre sistemas"), L("Pattern: API-led / event-driven / batch · Owner: …", "Padrão: API / eventos / batch · Dono: …")), k = s.k, y = s.y;
      const src = [L("CRM", "CRM"), "ERP", L("E-commerce", "E-commerce")].map(function (t, i) { return k.Sh(60, y + 30 + i * 170, 300, 120, "round", t, NAVYL); });
      const mid = k.Sh(640, y + 120, 520, 300, "round", L("Integration layer\nAPI gateway · iPaaS / ESB · event broker", "Camada de integração\nAPI gateway · iPaaS / ESB · broker de eventos"), NAVY, "#ffffff");
      const dst = [L("Data lake / BI", "Data lake / BI"), L("Partners", "Parceiros"), L("Mobile app", "App celular")].map(function (t, i) { return k.Sh(1480, y + 30 + i * 170, 300, 120, "round", t, TEALL); });
      src.forEach(function (a) { k.A(a, mid); }); dst.forEach(function (b) { k.A(mid, b); });
      k.F(60, y + 560, 880, 260, L("Interfaces (name · protocol · frequency)", "Interfaces (nome · protocolo · frequência)"), WHITE);
      k.SL(80, y + 600, 840, 50, L("  CRM → Gateway · REST/JSON · real time", "  CRM → Gateway · REST/JSON · tempo real"), GRAY, 15);
      k.SL(80, y + 660, 840, 50, L("  ERP → Broker · events · on change", "  ERP → Broker · eventos · a cada alteração"), GRAY, 15);
      k.SL(80, y + 720, 840, 50, L("  Broker → Data lake · batch · daily", "  Broker → Data lake · batch · diário"), GRAY, 15);
      k.F(980, y + 560, 880, 260, L("Non-functional: SLA, volumes, security", "Não funcionais: SLA, volumes, segurança"), GOLDL); k.S(1000, y + 590, "", C.gold); k.S(1150, y + 590, "", C.gold);
      return k.out;
    } };

  /* ======================= SOFTWARE ARCHITECTURE ======================= */
  K.layers = { cat: "software", name: L("Layered / clean architecture", "Arquitetura em camadas (clean)"), desc: L("Presentation, application, domain and infrastructure, with the dependency rule.", "Apresentação, aplicação, domínio e infraestrutura, com a regra de dependência."),
    build: function () {
      const s = start(1700, 960, L("Layered architecture", "Arquitetura em camadas"), L("Dependency rule: outer layers depend on inner ones – the domain depends on nothing.", "Regra de dependência: camadas externas dependem das internas – o domínio não depende de ninguém.")), k = s.k, y = s.y;
      const ly = [[L("Presentation – UI, controllers, API endpoints", "Apresentação – UI, controllers, endpoints da API"), TEALL], [L("Application – use cases, orchestration, DTOs", "Aplicação – casos de uso, orquestração, DTOs"), NAVYL], [L("Domain – entities, rules, domain events", "Domínio – entidades, regras, eventos de domínio"), NAVY], [L("Infrastructure – database, messaging, external APIs", "Infraestrutura – banco de dados, mensageria, APIs externas"), GOLDL]];
      let prev = null;
      ly.forEach(function (l, i) { const id = k.Sh(40, y + i * 170, 1000, 130, "round", l[0], l[1], i === 2 ? "#ffffff" : INK); if (prev) k.A(prev, id); prev = id; });
      k.F(1080, y, 580, 640, L("Responsibilities and rules", "Responsabilidades e regras"), WHITE);
      k.S(1100, y + 30, L("Ports & adapters for I/O", "Portas e adaptadores para I/O"), C.mint, 250, 110); k.S(1370, y + 30, L("No framework in the domain", "Sem framework no domínio"), C.gold, 250, 110);
      k.S(1100, y + 160, L("Tests per layer", "Testes por camada"), C.navyL, 250, 110);
      return k.out;
    } };
  K.microservices = { cat: "software", name: L("Microservices and events", "Microsserviços e eventos"), desc: L("API gateway, services with their own databases, event broker and observability.", "API gateway, serviços com bancos próprios, broker de eventos e observabilidade."),
    build: function () {
      const s = start(1900, 1040, L("Microservices", "Microsserviços"), L("One service = one business capability, its own data and its own deploy.", "Um serviço = uma capacidade de negócio, dados próprios e deploy próprio.")), k = s.k, y = s.y;
      const cl = k.Sh(700, y, 400, 90, "round", L("Clients – web · mobile · partners", "Clientes – web · celular · parceiros"), NAVYL);
      const gw = k.Sh(700, y + 150, 400, 90, "round", "API Gateway · auth · rate limit", NAVY, "#ffffff"); k.A(cl, gw);
      const names = [L("Orders service", "Serviço de pedidos"), L("Payments service", "Serviço de pagamentos"), L("Catalogue service", "Serviço de catálogo"), L("Users service", "Serviço de usuários")];
      k.Sh(120, y + 640, 1560, 80, "round", L("Event broker – services publish and consume events: OrderCreated · PaymentApproved · …", "Broker de eventos – os serviços publicam e consomem eventos: PedidoCriado · PagamentoAprovado · …"), GOLD, INK);
      names.forEach(function (n, i) {
        const x = 120 + i * 400;
        const sv = k.Sh(x, y + 320, 360, 110, "round", n, TEALL); k.A(gw, sv);
        const db = k.Sh(x + 60, y + 480, 240, 90, "round", "🗄 " + L("own DB", "banco próprio"), WHITE); k.A(sv, db);
      });
      k.F(1740, y, 140, 720, L("Observability", "Observabilidade"), GRAY); k.T(1755, y + 40, "logs\nmetrics\ntraces\nalerts", 15, 110, MUTED);
      return k.out;
    } };
  K.adr = { cat: "software", name: L("Architecture decision record (ADR)", "Registro de decisão de arquitetura (ADR)"), desc: L("Context, decision, alternatives and consequences – one decision per board area.", "Contexto, decisão, alternativas e consequências – uma decisão por área do quadro."),
    build: function () {
      const s = start(1700, 980, "ADR-001 · " + L("title of the decision", "título da decisão"), L("Date: … · Deciders: … · Related: …", "Data: … · Decisores: … · Relacionado: …")), k = s.k, y = s.y;
      k.Sh(1440, y, 220, 56, "pill", L("Status: proposed", "Status: proposta"), GOLD, INK);
      k.F(40, y + 80, 800, 300, L("Context – forces and constraints", "Contexto – forças e restrições"), NAVYL); k.S(60, y + 110, "", C.navyL, 240, 120);
      k.F(880, y + 80, 780, 300, L("Decision", "Decisão"), BG.mint); k.S(900, y + 110, L("We will …", "Vamos …"), C.mint, 300, 120);
      k.F(40, y + 420, 1620, 220, L("Alternatives considered", "Alternativas consideradas"), WHITE);
      ["A", "B", "C"].forEach(function (a, i) { k.S(60 + i * 330, y + 450, L("Option ", "Opção ") + a + L(" – pros / cons", " – prós / contras"), C.gold, 300, 140); });
      k.F(40, y + 680, 800, 200, L("Consequences ✚", "Consequências ✚"), BG.green); k.S(60, y + 710, "", C.green);
      k.F(880, y + 680, 780, 200, L("Consequences ✖ / risks", "Consequências ✖ / riscos"), BG.red); k.S(900, y + 710, "", C.red);
      return k.out;
    } };

  /* ======================= SECURITY ARCHITECTURE ======================= */
  K.stride = { cat: "security", name: L("Threat modelling – STRIDE", "Modelagem de ameaças – STRIDE"), desc: L("Data-flow diagram with trust boundary and threats per STRIDE category, each with a mitigation.", "Diagrama de fluxo de dados com fronteira de confiança e ameaças por categoria STRIDE, cada uma com mitigação."),
    build: function () {
      const s = start(2000, 1100, L("Threat model – STRIDE", "Modelo de ameaças – STRIDE"), L("System: … · Scope: … · Reviewed by: …", "Sistema: … · Escopo: … · Revisado por: …")), k = s.k, y = s.y;
      k.F(40, y, 820, 420, L("Data flow diagram", "Diagrama de fluxo de dados"), WHITE);
      const u = k.Sh(70, y + 160, 150, 90, "ellipse", L("User", "Usuário"), NAVYL);
      k.F(270, y + 60, 560, 330, L("Trust boundary", "Fronteira de confiança"), BG.red);
      const w = k.Sh(300, y + 160, 160, 90, "round", "Web / API", WHITE);
      const p = k.Sh(520, y + 110, 160, 80, "round", L("Service", "Serviço"), WHITE);
      const d = k.Sh(520, y + 250, 160, 80, "round", L("🗄 Data", "🗄 Dados"), GOLDL);
      [[u, w], [w, p], [p, d]].forEach(function (a) { k.A(a[0], a[1]); });
      const cats = [["S", L("Spoofing", "Falsificação de identidade"), L("MFA, strong auth", "MFA, autenticação forte")], ["T", L("Tampering", "Adulteração"), L("Signatures, integrity checks", "Assinaturas, verificação de integridade")], ["R", L("Repudiation", "Repúdio"), L("Audit logs", "Logs de auditoria")], ["I", L("Information disclosure", "Vazamento de informação"), L("Encryption, least privilege", "Criptografia, privilégio mínimo")], ["D", L("Denial of service", "Negação de serviço"), L("Rate limit, WAF, autoscale", "Rate limit, WAF, autoscale")], ["E", L("Elevation of privilege", "Elevação de privilégio"), L("RBAC, input validation", "RBAC, validação de entrada")]];
      cats.forEach(function (c, i) {
        const x = 900 + (i % 3) * 360, yy = y + Math.floor(i / 3) * 450;
        k.Sh(x, yy, 340, 60, "round", c[0] + " · " + c[1], i % 2 ? NAVY : TEAL, i % 2 ? "#ffffff" : INK);
        k.F(x, yy + 80, 340, 340, "", GRAY);
        k.S(x + 15, yy + 100, L("Threat: …", "Ameaça: …"), C.red, 150, 110); k.S(x + 175, yy + 100, c[2], C.green, 150, 110);
      });
      k.F(40, y + 460, 820, 420, L("Risk ranking and owners", "Priorização dos riscos e responsáveis"), GOLDL); k.S(60, y + 490, "", C.gold); k.S(210, y + 490, "", C.gold);
      return k.out;
    } };
  K.trustzones = { cat: "security", name: L("Network and trust zones", "Zonas de rede e confiança"), desc: L("Internet, DMZ, application, data and management zones with the controls between them.", "Internet, DMZ, aplicação, dados e gestão, com os controles entre as zonas."),
    build: function () {
      const s = start(2000, 960, L("Network and trust zones", "Zonas de rede e confiança"), L("Traffic only flows through the controls shown – default deny between zones.", "O tráfego só passa pelos controles indicados – bloqueio por padrão entre zonas.")), k = s.k, y = s.y;
      const z = [[L("Internet", "Internet"), BG.red], ["DMZ", BG.orange], [L("Application zone", "Zona de aplicação"), BG.navy], [L("Data zone", "Zona de dados"), BG.purple]];
      z.forEach(function (v, i) { k.F(40 + i * 490, y, 440, 560, v[0], v[1]); });
      const us = k.Sh(110, y + 200, 300, 110, "ellipse", L("Users / partners", "Usuários / parceiros"), WHITE);
      const waf = k.Sh(560, y + 120, 340, 100, "hexagon", "WAF · CDN · DDoS", GOLD, INK);
      const lb = k.Sh(560, y + 300, 340, 100, "round", L("Load balancer / reverse proxy", "Balanceador / proxy reverso"), WHITE);
      const app = k.Sh(1050, y + 200, 340, 110, "round", L("App servers / containers", "Servidores de aplicação / contêineres"), WHITE);
      const db = k.Sh(1540, y + 120, 340, 100, "round", L("🗄 Databases (encrypted)", "🗄 Bancos de dados (criptografados)"), WHITE);
      const vt = k.Sh(1540, y + 300, 340, 100, "round", L("🔑 Secrets vault / KMS", "🔑 Cofre de segredos / KMS"), WHITE);
      [[us, waf], [waf, lb], [lb, app], [app, db], [app, vt]].forEach(function (a) { k.A(a[0], a[1]); });
      k.F(40, y + 600, 1910, 230, L("Management zone – SIEM · bastion · backups · monitoring", "Zona de gestão – SIEM · bastion · backups · monitoramento"), GRAY);
      k.S(60, y + 630, L("Firewall rule: …", "Regra de firewall: …"), C.gold, 220, 110); k.S(300, y + 630, L("Logging: …", "Logs: …"), C.mint, 220, 110);
      return k.out;
    } };
  K.iam = { cat: "security", name: L("Identity and access flow", "Fluxo de identidade e acesso"), desc: L("Sign-in with SSO/OIDC, MFA, tokens and authorisation down to the resource.", "Login com SSO/OIDC, MFA, tokens e autorização até o recurso."),
    build: function () {
      const s = start(2000, 900, L("Identity and access (IAM)", "Identidade e acesso (IAM)"), L("Protocol: OIDC / OAuth 2.0 / SAML · IdP: … · Session: …", "Protocolo: OIDC / OAuth 2.0 / SAML · IdP: … · Sessão: …")), k = s.k, y = s.y;
      const st = [[L("1 · User", "1 · Usuário"), NAVYL], [L("2 · App (client)", "2 · Aplicação (cliente)"), WHITE], [L("3 · Identity provider (SSO)", "3 · Provedor de identidade (SSO)"), NAVY], [L("4 · MFA", "4 · MFA"), GOLD], [L("5 · Token (JWT)\nscopes · expiry", "5 · Token (JWT)\nescopos · validade"), TEALL], [L("6 · API – authorisation\nRBAC / ABAC", "6 · API – autorização\nRBAC / ABAC"), WHITE], [L("7 · Resource", "7 · Recurso"), GOLDL]];
      let prev = null;
      st.forEach(function (v, i) { const id = k.Sh(40 + i * 280, y + 40, 250, 130, "round", v[0], v[1], v[1] === NAVY ? "#ffffff" : INK); if (prev) k.A(prev, id); prev = id; });
      k.F(40, y + 260, 940, 420, L("Controls", "Controles"), BG.green);
      [L("MFA for everyone", "MFA para todos"), L("Least privilege", "Privilégio mínimo"), L("Quarterly access review", "Revisão de acessos trimestral"), L("Joiner / mover / leaver", "Entrada / mudança / saída"), L("Short-lived tokens", "Tokens de curta duração"), L("Audit trail", "Trilha de auditoria")].forEach(function (t, i) { k.S(60 + (i % 3) * 300, y + 290 + Math.floor(i / 3) * 170, t, C.green, 280, 140); });
      k.F(1020, y + 260, 940, 420, L("Roles and permissions", "Papéis e permissões"), NAVYL);
      [L("Admin", "Admin"), L("Editor", "Editor"), L("Viewer", "Leitor")].forEach(function (r, i) { k.SL(1040, y + 300 + i * 110, 900, 90, "  " + r + L(" – can …", " – pode …"), WHITE, 16); });
      return k.out;
    } };
  K.riskmatrix = { cat: "security", name: L("Risk matrix and controls", "Matriz de riscos e controles"), desc: L("5×5 probability × impact heat map, risk register and controls.", "Mapa de calor 5×5 de probabilidade × impacto, registro de riscos e controles."),
    build: function () {
      const s = start(1900, 1000, L("Risk matrix", "Matriz de riscos"), L("Score = probability × impact. Red risks need an owner and a control this quarter.", "Score = probabilidade × impacto. Riscos vermelhos precisam de dono e controle neste trimestre.")), k = s.k, y = s.y + 20;
      const heat = function (p, i) { const v = p * i; return v >= 15 ? "#FF8577" : v >= 8 ? "#FFAE45" : v >= 4 ? "#F2D585" : "#9BDD5C"; };
      for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) { const p = 5 - r, im = c + 1; k.Sh(150 + c * 150, y + r * 130, 140, 120, "rect", String(p * im), heat(p, im), INK); }
      k.T(40, y + 280, L("PROBA-\nBILITY", "PROBABI-\nLIDADE"), 15, 100, MUTED); k.T(420, y + 660, L("IMPACT →", "IMPACTO →"), 15, 200, MUTED);
      k.F(940, y - 20, 920, 400, L("Risk register", "Registro de riscos"), WHITE);
      k.S(960, y + 10, L("R1 · description · P×I", "R1 · descrição · P×I"), C.red, 270, 110); k.S(1250, y + 10, L("R2 · …", "R2 · …"), C.orange, 270, 110); k.S(1540, y + 10, L("R3 · …", "R3 · …"), C.gold, 270, 110);
      k.F(940, y + 410, 920, 330, L("Controls and owners", "Controles e responsáveis"), BG.green); k.S(960, y + 440, L("Control · owner · date", "Controle · dono · prazo"), C.green, 270, 110);
      return k.out;
    } };

  /* register */
  const ORDER = { design: ["userflow", "wireframe", "usability", "cardsort"], dthinking: ["dt5", "hmw", "crazy8", "impacteffort"], process: ["bpmn", "sipoc", "vsm", "asistobe"], product: ["visionboard", "leancanvas", "ost", "rice", "nnl", "storymap"], arch: ["c4context", "c4container", "integration"], software: ["layers", "microservices", "adr"], security: ["stride", "trustzones", "iam", "riskmatrix"] };
  Object.keys(K).forEach(function (id) {
    const t = K[id], b = t.build;
    window.MB_KITS[id] = { name: t.name, namePT: t.name, desc: t.desc, cat: t.cat, build: function () { return window.MBKitBrand(b(), t); } };
  });
  const cur = window.MB_KIT_ORDER.slice(), out = [];
  /* gallery order follows the category order; existing kits keep their relative order */
  (window.MB_KIT_CAT_ORDER || []).forEach(function (c) {
    cur.forEach(function (id) { if (window.MB_KITS[id] && window.MB_KITS[id].cat === c && out.indexOf(id) < 0) out.push(id); });
    (ORDER[c] || []).forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); });
  });
  cur.forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); });
  window.MB_KIT_ORDER = out;
})();
