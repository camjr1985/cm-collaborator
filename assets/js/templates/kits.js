/*
 * CM Collaborator – template library ("kits") made of editable board objects,
 * plus the icon set and automatic SVG thumbnails.
 *
 * window.MB_KITS[id] = { name, desc, cat, build() -> [objects with temp ids] }
 * window.MB_KIT_ORDER = [...ids in gallery order]
 * window.MB_ICONS = { name: svgPathMarkup }
 * window.MB_EMOJI = [...]
 * window.MBKitPreview(objects|"persona"|"moscow"|"blank") -> SVG markup
 */
(function () {
  "use strict";
  const PT = window.MB_LANG === "pt";
  function L(en, pt) { return PT ? pt : en; }

  const C = { yellow: "#FFF59D", orange: "#FFCF8A", red: "#F7A8B0", pink: "#F6C1E4", purple: "#CDBDF6", blue: "#A9D1F7", teal: "#9FE3D3", green: "#C8EBA1", gray: "#E6E6E6" };
  const BG = { white: "#ffffff", gray: "#f4f5f8", green: "#eaf7dc", red: "#fde7e9", blue: "#e3f0fd", yellow: "#fff8d6", purple: "#f4eefe", orange: "#fff3e0", teal: "#e3f8f2" };

  /* ---------- builders ---------- */
  function kit() {
    let n = 0;
    const out = [];
    const api = {
      out: out,
      F: function (x, y, w, h, title, color) { const o = { id: "t" + (++n), type: "frame", x: x, y: y, w: w, h: h, title: title || "", color: color || BG.white }; out.push(o); return o.id; },
      S: function (x, y, text, color, w, h) { const o = { id: "t" + (++n), type: "sticky", x: x, y: y, w: w || 130, h: h || 110, text: text || "", color: color || C.yellow }; out.push(o); return o.id; },
      T: function (x, y, text, fs, w, color) { const o = { id: "t" + (++n), type: "text", x: x, y: y, w: w || 600, fs: fs || 24, text: text, color: color || "#1c2033" }; out.push(o); return o.id; },
      Sh: function (x, y, w, h, shape, text, color, tcolor) { const o = { id: "t" + (++n), type: "shape", shape: shape || "rect", x: x, y: y, w: w, h: h, text: text || "", color: color || "#ffffff", tcolor: tcolor || "#1c2033" }; out.push(o); return o.id; },
      A: function (from, to, head) { const o = { id: "t" + (++n), type: "arrow", from: from, to: to, x1: 0, y1: 0, x2: 0, y2: 0, color: "#1c2033", head: head !== false }; out.push(o); return o.id; },
      I: function (x, y, size, name, color) { const o = { id: "t" + (++n), type: "icon", x: x, y: y, w: size, h: size, name: name, color: color || "#1c2033" }; out.push(o); return o.id; },
      SL: function (x, y, w, h, text, color, fs) { const o = { id: "t" + (++n), type: "shape", shape: "rect", align: "left", x: x, y: y, w: w, h: h, text: text || "", color: color || "#ffffff", tcolor: "#1c2033" }; if (fs) o.fs = fs; out.push(o); return o.id; },
      E: function (x, y, size, emoji) { const o = { id: "t" + (++n), type: "icon", x: x, y: y, w: size, h: size, emoji: emoji }; out.push(o); return o.id; }
    };
    return api;
  }

  const KITS = {
    kanban: {
      name: "Kanban board", desc: L("Visualise the flow of work from backlog to done.", "Visualize o fluxo de trabalho do backlog até concluído."), cat: "agile",
      build: function () {
        const k = kit();
        k.F(0, 0, 1460, 860, L("Kanban", "Kanban"));
        const cols = [[L("Backlog", "Backlog"), BG.gray], [L("To do", "A fazer"), BG.blue], [L("In progress · WIP 3", "Em andamento · WIP 3"), BG.yellow], [L("Review", "Revisão"), BG.purple], [L("Done", "Concluído"), BG.green]];
        cols.forEach(function (c, i) { k.F(30 + i * 284, 60, 264, 770, c[0], c[1]); });
        k.S(60, 90, L("User story A", "História A"), C.yellow); k.S(60, 220, L("User story B", "História B"), C.yellow); k.S(60, 350, L("Bug fix", "Correção de bug"), C.red);
        k.S(344, 90, L("Task 1", "Tarefa 1"), C.blue); k.S(344, 220, L("Task 2", "Tarefa 2"), C.blue);
        k.S(628, 90, L("Task 3", "Tarefa 3"), C.orange);
        k.S(912, 90, L("Task 4", "Tarefa 4"), C.purple);
        k.S(1196, 90, L("Task 5 ✓", "Tarefa 5 ✓"), C.green);
        return k.out;
      }
    },
    retro: {
      name: "Retrospective", desc: L("What went well, what didn't, ideas and actions.", "O que correu bem, o que não correu, ideias e ações."), cat: "agile",
      build: function () {
        const k = kit();
        k.F(0, 0, 1500, 900, L("Sprint retrospective", "Retrospetiva da sprint"));
        k.T(40, 30, L("Sprint retrospective", "Retrospetiva da sprint"), 36, 900);
        k.T(40, 84, L("Add your post-its, group similar ideas and vote (dot voting) on what matters most.", "Adicione os seus post-its, agrupe ideias semelhantes e vote (dot voting) no que mais importa."), 18, 1100, "#4a5068");
        const cols = [[L("😀 What went well", "😀 O que correu bem"), BG.green, C.green], [L("😕 What didn't go well", "😕 O que não correu bem"), BG.red, C.red], [L("💡 Ideas to try", "💡 Ideias para testar"), BG.blue, C.blue], [L("✅ Action items", "✅ Ações"), BG.yellow, C.yellow]];
        cols.forEach(function (c, i) { k.F(40 + i * 360, 160, 340, 700, c[0], c[1]); k.S(60 + i * 360, 190, "", c[2]); });
        return k.out;
      }
    },
    planning: {
      name: "Sprint planning", desc: L("Sprint goal, backlog, capacity, risks and DoD.", "Objetivo da sprint, backlog, capacidade, riscos e DoD."), cat: "agile",
      build: function () {
        const k = kit();
        k.F(0, 0, 1600, 980, L("Sprint planning", "Sprint planning"));
        k.T(40, 26, L("Sprint planning – Sprint 1", "Sprint planning – Sprint 1"), 36, 900);
        k.F(40, 120, 1520, 160, L("🎯 Sprint goal", "🎯 Objetivo da sprint"), BG.yellow);
        k.S(60, 145, L("What value will we deliver?", "Que valor vamos entregar?"), C.yellow, 300, 110);
        k.F(40, 340, 420, 600, L("Product backlog (prioritised)", "Product backlog (priorizado)"), BG.gray);
        k.S(60, 370, L("Story 1 · 5 pts", "História 1 · 5 pts"), C.blue); k.S(210, 370, L("Story 2 · 3 pts", "História 2 · 3 pts"), C.blue); k.S(60, 500, L("Story 3 · 8 pts", "História 3 · 8 pts"), C.blue);
        k.F(480, 340, 420, 600, L("Sprint backlog (committed)", "Sprint backlog (compromisso)"), BG.green);
        k.F(920, 340, 300, 600, L("👥 Capacity", "👥 Capacidade"), BG.blue);
        k.S(940, 370, L("Ana · 8 days", "Ana · 8 dias"), C.teal, 120, 90); k.S(1080, 370, L("Rui · 10 days", "Rui · 10 dias"), C.teal, 120, 90); k.S(940, 480, L("Velocity: 30 pts", "Velocidade: 30 pts"), C.orange, 260, 80);
        k.F(1240, 340, 320, 280, L("⚠️ Risks & dependencies", "⚠️ Riscos e dependências"), BG.red);
        k.F(1240, 660, 320, 280, L("✔ Definition of Done", "✔ Definition of Done"), BG.purple);
        k.T(1260, 690, L("☐ Code reviewed\n☐ Tests passing\n☐ Documented\n☐ Accepted by PO", "☐ Código revisto\n☐ Testes a passar\n☐ Documentado\n☐ Aceite pelo PO"), 18, 280);
        return k.out;
      }
    },
    piplanning: {
      name: "PI Planning", desc: L("SAFe program board: iterations × teams, objectives and ROAM.", "Program board SAFe: iterações × equipas, objetivos e ROAM."), cat: "agile",
      build: function () {
        const k = kit();
        const gx = 40, gy = 110, lw = 200, cw = 300, hh = 60;
        const iters = [L("Iteration 1", "Iteração 1"), L("Iteration 2", "Iteração 2"), L("Iteration 3", "Iteração 3"), L("Iteration 4", "Iteração 4"), L("IP Iteration", "Iteração IP")];
        const rows = [[L("Milestones / Events", "Marcos / Eventos"), 160, BG.yellow], ["Team Alpha", 220, BG.gray], ["Team Beta", 220, BG.white], ["Team Gamma", 220, BG.gray]];
        const gridH = hh + rows.reduce(function (a, r) { return a + r[1]; }, 0);
        const W = gx * 2 + lw + cw * iters.length;
        const yObj = gy + gridH + 60;
        k.F(0, 0, W, yObj + 340, L("PI Planning – Program board", "PI Planning – Program board"));
        k.T(gx, 30, L("PI Planning · PI 1", "PI Planning · PI 1"), 36, 900);
        iters.forEach(function (it, i) { k.Sh(gx + lw + i * cw + 4, gy, cw - 8, hh - 8, "round", it, "#1c2033", "#ffffff"); });
        let y = gy + hh;
        const cells = [];
        rows.forEach(function (r) {
          k.Sh(gx, y + 4, lw - 8, r[1] - 8, "rect", r[0], "#e3f0fd");
          const rowCells = [];
          iters.forEach(function (it, i) { rowCells.push(k.F(gx + lw + i * cw, y, cw, r[1], "", r[2])); });
          cells.push({ y: y, h: r[1] });
          y += r[1];
        });
        const cx = function (i) { return gx + lw + i * cw + 20; };
        k.S(cx(1), cells[0].y + 20, L("🚀 Release 1", "🚀 Release 1"), C.orange, 130, 100);
        k.S(cx(4), cells[0].y + 20, L("PI demo", "Demo do PI"), C.orange, 130, 100);
        const f1 = k.S(cx(0), cells[1].y + 20, L("Feature: login", "Feature: login"), C.blue);
        const f2 = k.S(cx(2), cells[2].y + 20, L("Feature: payments", "Feature: pagamentos"), C.blue);
        k.S(cx(1), cells[2].y + 20, L("Enabler: API", "Enabler: API"), C.purple);
        k.S(cx(3), cells[3].y + 20, L("Feature: reports", "Feature: relatórios"), C.blue);
        const d1 = k.S(cx(1), cells[3].y + 20, L("Dependency", "Dependência"), C.red);
        k.A(f1, f2); k.A(d1, f2);
        k.F(gx, yObj, 900, 280, L("🎯 PI objectives (team · objective · business value)", "🎯 Objetivos do PI (equipa · objetivo · valor de negócio)"), BG.green);
        k.S(gx + 20, yObj + 30, L("Alpha · Launch login · BV 8", "Alpha · Lançar login · BV 8"), C.green, 200, 100);
        const roam = [[L("Resolved", "Resolvido"), BG.green], [L("Owned", "Assumido"), BG.blue], [L("Accepted", "Aceite"), BG.yellow], [L("Mitigated", "Mitigado"), BG.purple]];
        const rx = gx + 940, rw = (W - gx - rx) / 4;
        roam.forEach(function (r, i) { k.F(rx + i * rw, yObj, rw - 10, 280, "ROAM · " + r[0], r[1]); });
        return k.out;
      }
    },
    sysdemo: {
      name: "System demo", desc: L("Agenda, features shown, metrics, feedback and next steps.", "Agenda, funcionalidades, métricas, feedback e próximos passos."), cat: "agile",
      build: function () {
        const k = kit();
        k.F(0, 0, 1500, 920, L("System demo", "System demo"));
        k.T(40, 26, L("System demo – PI 1 · Iteration 2", "System demo – PI 1 · Iteração 2"), 36, 1000);
        k.F(40, 130, 340, 750, L("🗓 Agenda", "🗓 Agenda"), BG.gray);
        k.T(60, 160, L("1. Welcome & context (5')\n2. Feature demos (30')\n3. Metrics (10')\n4. Feedback & Q&A (15')", "1. Boas-vindas e contexto (5')\n2. Demo das funcionalidades (30')\n3. Métricas (10')\n4. Feedback e perguntas (15')"), 18, 300);
        k.F(400, 130, 520, 360, L("🖥 Features demonstrated", "🖥 Funcionalidades demonstradas"), BG.blue);
        k.S(420, 160, L("Feature 1", "Funcionalidade 1"), C.blue); k.S(570, 160, L("Feature 2", "Funcionalidade 2"), C.blue);
        k.F(940, 130, 520, 360, L("📈 Metrics / KPIs", "📈 Métricas / KPIs"), BG.purple);
        k.S(960, 160, L("Velocity", "Velocidade"), C.purple); k.S(1110, 160, L("Defects", "Defeitos"), C.purple);
        k.F(400, 520, 520, 360, L("💬 Stakeholder feedback", "💬 Feedback dos stakeholders"), BG.green);
        k.F(940, 520, 520, 360, L("➡️ Next steps & actions", "➡️ Próximos passos e ações"), BG.yellow);
        return k.out;
      }
    },
    process: {
      name: "Process flow", desc: L("Flowchart with swimlanes, decisions and connectors.", "Fluxograma com raias, decisões e conectores."), cat: "diagram",
      build: function () {
        const k = kit();
        k.F(0, 0, 1320, 720, L("Process flow", "Fluxo de processo"));
        k.F(40, 70, 1240, 280, L("Customer", "Cliente"), BG.gray);
        k.F(40, 400, 1240, 280, L("Team", "Equipa"), BG.blue);
        const start = k.Sh(80, 175, 140, 70, "pill", L("Start", "Início"), "#C8EBA1");
        const submit = k.Sh(280, 165, 180, 90, "round", L("Submit request", "Enviar pedido"), "#ffffff");
        const adjust = k.Sh(540, 165, 180, 90, "round", L("Adjust request", "Ajustar pedido"), "#ffffff");
        const receive = k.Sh(820, 165, 180, 90, "round", L("Receive result", "Receber resultado"), "#ffffff");
        const end = k.Sh(1080, 175, 140, 70, "pill", L("End", "Fim"), "#F7A8B0");
        const review = k.Sh(280, 495, 180, 90, "round", L("Review request", "Analisar pedido"), "#ffffff");
        const decision = k.Sh(540, 480, 180, 120, "diamond", L("Approved?", "Aprovado?"), "#FFF59D");
        const deliver = k.Sh(820, 495, 180, 90, "round", L("Deliver", "Entregar"), "#ffffff");
        k.A(start, submit); k.A(submit, review); k.A(review, decision); k.A(decision, deliver); k.A(decision, adjust); k.A(adjust, submit); k.A(deliver, receive); k.A(receive, end);
        k.T(740, 500, L("Yes", "Sim"), 18, 60); k.T(640, 380, L("No", "Não"), 18, 60);
        return k.out;
      }
    },
    mindmap: {
      name: "Mind map", desc: L("Central idea with branches to explore topics.", "Ideia central com ramos para explorar temas."), cat: "diagram",
      build: function () {
        const k = kit();
        k.F(0, 0, 1400, 860, L("Mind map", "Mapa mental"));
        const c = k.Sh(590, 370, 220, 120, "ellipse", L("Main idea", "Ideia principal"), "#FFCF8A");
        const pos = [[150, 150], [150, 390], [150, 630], [1050, 150], [1050, 390], [1050, 630]];
        const cols = ["#A9D1F7", "#C8EBA1", "#F6C1E4", "#CDBDF6", "#9FE3D3", "#F7A8B0"];
        pos.forEach(function (p, i) {
          const b = k.Sh(p[0], p[1], 200, 80, "round", L("Topic ", "Tema ") + (i + 1), cols[i]);
          k.A(c, b, false);
        });
        return k.out;
      }
    },
    journey: {
      name: "Customer journey", desc: L("Stages × actions, touchpoints, emotions, pains and opportunities.", "Etapas × ações, pontos de contacto, emoções, dores e oportunidades."), cat: "diagram",
      build: function () {
        const k = kit();
        const gx = 40, gy = 100, lw = 200, cw = 280, hh = 60, rh = 160;
        const stages = [L("Awareness", "Descoberta"), L("Consideration", "Consideração"), L("Purchase", "Compra"), L("Retention", "Retenção"), L("Advocacy", "Recomendação")];
        const rows = [L("Actions", "Ações"), L("Touchpoints", "Pontos de contacto"), L("Emotions", "Emoções"), L("Pain points", "Dores"), L("Opportunities", "Oportunidades")];
        k.F(0, 0, gx * 2 + lw + cw * 5, gy + hh + rh * rows.length + 40, L("Customer journey map", "Mapa da jornada do cliente"));
        k.T(gx, 26, L("Customer journey map", "Mapa da jornada do cliente"), 34, 900);
        stages.forEach(function (s, i) { k.Sh(gx + lw + i * cw + 4, gy, cw - 8, hh - 8, "round", s, "#1c2033", "#ffffff"); });
        rows.forEach(function (r, j) {
          const y = gy + hh + j * rh;
          k.Sh(gx, y + 4, lw - 8, rh - 8, "rect", r, "#e3f0fd");
          stages.forEach(function (s, i) { k.F(gx + lw + i * cw, y, cw, rh, "", j % 2 ? BG.white : BG.gray); });
        });
        k.E(gx + lw + 20, gy + hh + 2 * rh + 30, 70, "🙂"); k.E(gx + lw + cw * 2 + 20, gy + hh + 2 * rh + 30, 70, "😟"); k.E(gx + lw + cw * 4 + 20, gy + hh + 2 * rh + 30, 70, "🤩");
        return k.out;
      }
    },
    empathy: {
      name: "Empathy map", desc: L("Says, thinks, does, feels – plus pains and gains.", "Diz, pensa, faz, sente – e dores e ganhos."), cat: "diagram",
      build: function () {
        const k = kit();
        k.F(0, 0, 1200, 1120, L("Empathy map", "Mapa de empatia"));
        k.F(40, 60, 540, 380, L("💬 Says", "💬 Diz"), BG.blue); k.F(620, 60, 540, 380, L("💭 Thinks", "💭 Pensa"), BG.purple);
        k.F(40, 470, 540, 380, L("🏃 Does", "🏃 Faz"), BG.green); k.F(620, 470, 540, 380, L("❤️ Feels", "❤️ Sente"), BG.red);
        k.Sh(500, 395, 200, 120, "ellipse", L("Persona", "Persona"), "#FFCF8A");
        k.F(40, 880, 540, 200, L("😣 Pains", "😣 Dores"), BG.orange); k.F(620, 880, 540, 200, L("🎁 Gains", "🎁 Ganhos"), BG.teal);
        return k.out;
      }
    },
    swot: {
      name: "SWOT analysis", desc: L("Strengths, weaknesses, opportunities and threats.", "Forças, fraquezas, oportunidades e ameaças."), cat: "strategy",
      build: function () {
        const k = kit();
        k.F(0, 0, 1100, 920, L("SWOT analysis", "Análise SWOT"));
        k.F(40, 60, 500, 400, L("💪 Strengths", "💪 Forças"), BG.green); k.F(560, 60, 500, 400, L("⚠️ Weaknesses", "⚠️ Fraquezas"), BG.red);
        k.F(40, 490, 500, 400, L("🚀 Opportunities", "🚀 Oportunidades"), BG.blue); k.F(560, 490, 500, 400, L("⛈ Threats", "⛈ Ameaças"), BG.orange);
        return k.out;
      }
    },
    eisenhower: {
      name: "Eisenhower matrix", desc: L("Do, schedule, delegate or eliminate.", "Fazer, agendar, delegar ou eliminar."), cat: "strategy",
      build: function () {
        const k = kit();
        k.F(0, 0, 1180, 960, L("Eisenhower matrix", "Matriz de Eisenhower"));
        k.T(180, 40, L("URGENT", "URGENTE"), 20, 300, "#e5484d"); k.T(700, 40, L("NOT URGENT", "NÃO URGENTE"), 20, 300, "#4a5068");
        k.T(30, 260, L("IMPORTANT", "IMPORTANTE"), 18, 120, "#e5484d"); k.T(30, 680, L("NOT\nIMPORTANT", "NÃO\nIMPORTANTE"), 18, 120, "#4a5068");
        k.F(150, 100, 500, 400, L("🔥 Do now", "🔥 Fazer já"), BG.red); k.F(670, 100, 480, 400, L("📅 Schedule", "📅 Agendar"), BG.blue);
        k.F(150, 530, 500, 400, L("🤝 Delegate", "🤝 Delegar"), BG.orange); k.F(670, 530, 480, 400, L("🗑 Eliminate", "🗑 Eliminar"), BG.gray);
        return k.out;
      }
    },
    okr: {
      name: "OKRs", desc: L("One objective, measurable key results and initiatives.", "Um objetivo, resultados-chave mensuráveis e iniciativas."), cat: "strategy",
      build: function () {
        const k = kit();
        k.F(0, 0, 1300, 800, "OKRs");
        k.F(40, 60, 1220, 160, L("🎯 Objective", "🎯 Objetivo"), BG.yellow);
        k.S(60, 85, L("Inspiring, qualitative goal", "Objetivo inspirador e qualitativo"), C.yellow, 360, 110);
        for (let i = 0; i < 3; i++) {
          k.F(40 + i * 413, 270, 393, 500, "KR" + (i + 1) + L(" · key result", " · resultado-chave"), BG.blue);
          k.S(60 + i * 413, 300, L("From X to Y by date", "De X para Y até data"), C.blue, 170, 100);
          k.S(60 + i * 413, 430, L("Initiative", "Iniciativa"), C.green, 130, 100);
        }
        return k.out;
      }
    },
    betatest: {
      name: "Beta test kit", desc: L("Test missions for testers plus a feedback wall by theme.", "Missões de teste para os testadores e um mural de feedback por tema."), cat: "feedback",
      build: function () {
        const k = kit();
        k.F(0, 0, 2000, 1100, L("Beta test – start here", "Beta test – comece aqui"));
        k.T(40, 24, L("Welcome to the CM Collaborator beta 👋", "Bem-vindo ao beta do CM Collaborator 👋"), 40, 1300);
        k.T(40, 92, L("Explore freely for 7 days. Try the missions, leave post-its on the feedback wall and answer the short form (📣 Feedback button at the top).", "Explore à vontade durante 7 dias. Faça as missões, deixe post-its no mural de feedback e responda ao formulário curto (botão 📣 Feedback no topo)."), 20, 1700, "#4a5068");
        k.F(40, 180, 560, 880, L("🧭 Test missions", "🧭 Missões de teste"), BG.blue);
        k.T(64, 210, L("☐ 1. Draw a frame (F) and add post-its inside\n☐ 2. Build a small process with shapes (R) and connectors (L)\n☐ 3. Insert a template (grid button on the left)\n☐ 4. Paste or drop an image or GIF\n☐ 5. Add icons and emoji\n☐ 6. Comment and vote on a post-it\n☐ 7. Select several items, copy and paste them\n☐ 8. Switch the canvas to dark mode and back",
          "☐ 1. Desenhe um frame (F) e coloque post-its dentro\n☐ 2. Monte um pequeno processo com formas (R) e conectores (L)\n☐ 3. Insira um template (botão de grelha à esquerda)\n☐ 4. Cole ou arraste uma imagem ou GIF\n☐ 5. Adicione ícones e emoji\n☐ 6. Comente e vote num post-it\n☐ 7. Selecione vários itens, copie e cole\n☐ 8. Mude o quadro para modo escuro e volte"), 20, 510);
        k.E(470, 950, 80, "🧪");
        const wall = [[L("👍 What works well", "👍 O que funciona bem"), BG.green, C.green], [L("😕 Confusing / friction", "😕 Confuso / atrito"), BG.orange, C.orange], [L("🐞 Bugs", "🐞 Bugs"), BG.red, C.red], [L("💡 Ideas & features", "💡 Ideias e funcionalidades"), BG.blue, C.blue], [L("🎨 UI / visual", "🎨 UI / visual"), BG.purple, C.purple]];
        wall.forEach(function (c, i) { k.F(640 + i * 266, 180, 250, 880, c[0], c[1]); k.S(660 + i * 266, 210, L("Add yours…", "Adicione o seu…"), c[2]); });
        return k.out;
      }
    },
    pdca: {
      name: "PDCA executive meeting", desc: L("Plan-Do-Check-Act review with KPIs, decision required, options and decision log for directors.", "Revisão Plan-Do-Check-Act com KPIs, decisão necessária, opções e registo de decisões para diretores."), cat: "executive",
      build: function () {
        const k = kit();
        k.F(0, 0, 1960, 1240, L("PDCA – Executive decision meeting", "PDCA – Reunião executiva de decisão"));
        k.T(40, 24, L("PDCA – Executive decision meeting", "PDCA – Reunião executiva de decisão"), 38, 1200);
        k.T(40, 82, L("Programme / initiative: ________   ·   Date: __/__/____   ·   Sponsor: ________   ·   Participants: Directors / Executive committee", "Programa / iniciativa: ________   ·   Data: __/__/____   ·   Sponsor: ________   ·   Participantes: Diretores / Comité executivo"), 17, 1500, "#4a5068");
        // KPI strip
        k.F(40, 140, 1880, 150, L("📊 Key indicators vs target", "📊 Indicadores-chave vs meta"), BG.gray);
        const kpis = [[L("Budget\n92% of plan ●", "Orçamento\n92% do plano ●"), "#C8EBA1"], [L("Schedule\n+2 weeks ●", "Prazo\n+2 semanas ●"), "#FFF59D"], [L("Scope\n85% delivered ●", "Âmbito\n85% entregue ●"), "#C8EBA1"], [L("Quality\n3 critical defects ●", "Qualidade\n3 defeitos críticos ●"), "#F7A8B0"], [L("Risk level\nMedium ●", "Nível de risco\nMédio ●"), "#FFF59D"], [L("Benefits\nROI 1.8x ●", "Benefícios\nROI 1,8x ●"), "#C8EBA1"]];
        kpis.forEach(function (q, i) { k.Sh(64 + i * 308, 168, 288, 100, "round", q[0], q[1]); });
        // PDCA quadrants
        const qx = 40, qy = 330, qw = 600, qh = 340;
        const Q = [
          [L("P · PLAN – What did we plan?", "P · PLAN – O que planeámos?"), BG.blue, C.blue, L("Objective, targets and expected outcome", "Objetivo, metas e resultado esperado")],
          [L("D · DO – What was executed?", "D · DO – O que foi executado?"), BG.green, C.green, L("Deliveries and actions done this period", "Entregas e ações realizadas no período")],
          [L("C · CHECK – Results vs plan", "C · CHECK – Resultados vs plano"), BG.yellow, C.yellow, L("Gaps, root causes and lessons learned", "Desvios, causas-raiz e lições aprendidas")],
          [L("A · ACT – What do we adjust?", "A · ACT – O que ajustamos?"), BG.purple, C.purple, L("Corrective actions and standardisation", "Ações corretivas e padronização")]
        ];
        Q.forEach(function (q, i) {
          const x = qx + (i % 2) * (qw + 20), y = qy + Math.floor(i / 2) * (qh + 20);
          k.F(x, y, qw, qh, q[0], q[1]);
          k.T(x + 20, y + 20, q[3], 16, qw - 40, "#4a5068");
          k.S(x + 20, y + 60, "", q[2], 150, 120); k.S(x + 190, y + 60, "", q[2], 150, 120);
        });
        // cycle in the middle
        const cx = 1800, cy = 72;
        const p1 = k.Sh(cx - 62, cy - 58, 52, 52, "ellipse", "P", "#1c2033", "#ffffff");
        const p2 = k.Sh(cx + 10, cy - 58, 52, 52, "ellipse", "D", "#12a594", "#ffffff");
        const p3 = k.Sh(cx + 10, cy + 6, 52, 52, "ellipse", "C", "#e8c468");
        const p4 = k.Sh(cx - 62, cy + 6, 52, 52, "ellipse", "A", "#8b5cf6", "#ffffff");
        k.A(p1, p2); k.A(p2, p3); k.A(p3, p4); k.A(p4, p1);
        // decision area
        const dx = 1280;
        k.F(dx, qy, 640, 700, L("⚖️ Decision required today", "⚖️ Decisão necessária hoje"), BG.red);
        k.T(dx + 20, qy + 20, L("What do we need from the committee?", "O que precisamos do comité?"), 20, 600);
        k.S(dx + 20, qy + 60, L("Decision question", "Pergunta de decisão"), C.red, 600, 90);
        const opts = [[L("Option A\nCost · Time · Risk · Impact", "Opção A\nCusto · Prazo · Risco · Impacto"), "#ffffff"], [L("Option B\nCost · Time · Risk · Impact", "Opção B\nCusto · Prazo · Risco · Impacto"), "#ffffff"], [L("Option C\nCost · Time · Risk · Impact", "Opção C\nCusto · Prazo · Risco · Impacto"), "#ffffff"]];
        opts.forEach(function (o, i) { k.Sh(dx + 20 + i * 205, qy + 180, 190, 150, "round", o[0], o[1]); });
        k.S(dx + 20, qy + 360, L("✅ Recommendation and rationale", "✅ Recomendação e justificação"), C.green, 600, 120);
        k.S(dx + 20, qy + 500, L("Impact if we don't decide", "Impacto se não decidirmos"), C.orange, 290, 110);
        k.S(dx + 330, qy + 500, L("Support / budget needed", "Apoio / orçamento necessário"), C.orange, 290, 110);
        // decision log + risks + next steps
        const ly = 1060;
        k.F(40, ly, 1220, 160, L("📝 Decision log", "📝 Registo de decisões"), BG.white);
        const cols = [[L("Decision", "Decisão"), 520], [L("Owner", "Responsável"), 220], [L("Due date", "Prazo"), 200], [L("Status", "Estado"), 220]];
        let x = 60;
        cols.forEach(function (c) { k.Sh(x, ly + 20, c[1] - 6, 40, "rect", c[0], "#1c2033", "#ffffff"); k.Sh(x, ly + 64, c[1] - 6, 40, "rect", "", "#ffffff"); x += c[1]; });
        k.F(1280, ly, 310, 160, L("🚩 Risks & escalations", "🚩 Riscos e escalações"), BG.orange);
        k.F(1610, ly, 310, 160, L("➡️ Next steps & next meeting", "➡️ Próximos passos e próxima reunião"), BG.teal);
        return k.out;
      }
    },
    swarch: {
      name: "Software architecture", desc: L("Container view: clients, API gateway, services, data, messaging and external systems.", "Vista de contentores: clientes, API gateway, serviços, dados, mensageria e sistemas externos."), cat: "tech",
      build: function () {
        const k = kit();
        k.F(0, 0, 1900, 1080, L("Software architecture – container view", "Arquitetura de software – vista de contentores"));
        k.T(40, 24, L("Software architecture – container view (C4 level 2)", "Arquitetura de software – vista de contentores (C4 nível 2)"), 34, 1400);
        k.F(40, 100, 300, 860, L("👤 Users & clients", "👤 Utilizadores e clientes"), BG.gray);
        const user = k.Sh(90, 150, 200, 80, "pill", L("Customer", "Cliente"), "#ffffff");
        const admin = k.Sh(90, 260, 200, 80, "pill", L("Back-office user", "Utilizador back-office"), "#ffffff");
        const web = k.Sh(80, 430, 220, 110, "round", L("Web app\n[React / SPA]", "Aplicação web\n[React / SPA]"), "#A9D1F7");
        const mob = k.Sh(80, 580, 220, 110, "round", L("Mobile app\n[iOS / Android]", "App móvel\n[iOS / Android]"), "#A9D1F7");
        k.F(380, 100, 300, 860, L("🛡 Edge & security", "🛡 Edge e segurança"), BG.purple);
        const cdn = k.Sh(410, 170, 240, 90, "round", L("CDN / WAF", "CDN / WAF"), "#CDBDF6");
        const gw = k.Sh(410, 470, 240, 110, "round", L("API Gateway\nauth · rate limit · routing", "API Gateway\nauth · rate limit · routing"), "#CDBDF6");
        const idp = k.Sh(410, 700, 240, 100, "round", L("Identity provider\n[OAuth2 / OIDC]", "Fornecedor de identidade\n[OAuth2 / OIDC]"), "#CDBDF6");
        k.F(720, 100, 520, 860, L("⚙️ Services (domain)", "⚙️ Serviços (domínio)"), BG.blue);
        const s1 = k.Sh(750, 160, 220, 110, "round", L("Accounts service\n[Java / Spring]", "Serviço de contas\n[Java / Spring]"), "#ffffff");
        const s2 = k.Sh(990, 160, 220, 110, "round", L("Orders service\n[Node.js]", "Serviço de pedidos\n[Node.js]"), "#ffffff");
        const s3 = k.Sh(750, 400, 220, 110, "round", L("Payments service\n[.NET]", "Serviço de pagamentos\n[.NET]"), "#ffffff");
        const s4 = k.Sh(990, 400, 220, 110, "round", L("Notifications service\n[Python]", "Serviço de notificações\n[Python]"), "#ffffff");
        const mq = k.Sh(800, 650, 360, 90, "pill", L("Message broker / event bus\n[Kafka / RabbitMQ]", "Message broker / barramento de eventos\n[Kafka / RabbitMQ]"), "#FFCF8A");
        k.F(1280, 100, 300, 860, L("🗄 Data", "🗄 Dados"), BG.yellow);
        const db1 = k.Sh(1310, 160, 240, 120, "ellipse", L("Relational DB\n[PostgreSQL]", "Base relacional\n[PostgreSQL]"), "#FFF59D");
        const cache = k.Sh(1310, 330, 240, 100, "round", L("Cache\n[Redis]", "Cache\n[Redis]"), "#FFF59D");
        const db2 = k.Sh(1310, 480, 240, 120, "ellipse", L("Document DB\n[MongoDB]", "Base documental\n[MongoDB]"), "#FFF59D");
        const obj = k.Sh(1310, 660, 240, 100, "round", L("Object storage\n[files / backups]", "Object storage\n[ficheiros / backups]"), "#FFF59D");
        k.F(1620, 100, 260, 860, L("🌐 External systems", "🌐 Sistemas externos"), BG.red);
        const psp = k.Sh(1640, 400, 220, 100, "round", L("Payment provider", "Fornecedor de pagamentos"), "#F7A8B0");
        const mail = k.Sh(1640, 560, 220, 100, "round", L("E-mail / SMS service", "Serviço de e-mail / SMS"), "#F7A8B0");
        k.A(user, web); k.A(admin, web); k.A(user, mob); k.A(web, cdn); k.A(mob, gw); k.A(cdn, gw); k.A(gw, idp);
        k.A(gw, s1); k.A(gw, s2); k.A(gw, s3); k.A(s1, db1); k.A(s2, db1); k.A(s2, cache); k.A(s3, psp); k.A(s2, mq); k.A(s3, mq); k.A(mq, s4); k.A(s4, mail); k.A(s4, db2);
        k.F(40, 980, 1840, 80, L("🔭 Cross-cutting: observability (logs · metrics · traces) · CI/CD · secrets management · backup & DR", "🔭 Transversal: observabilidade (logs · métricas · traces) · CI/CD · gestão de segredos · backup e DR"), BG.teal);
        return k.out;
      }
    },
    lakehouse: {
      name: "Data lakehouse (medallion)", desc: L("Databricks-style lakehouse: sources, ingestion, bronze, silver, gold, consumers and governance.", "Lakehouse ao estilo Databricks: fontes, ingestão, bronze, silver, gold, consumo e governança."), cat: "data",
      build: function () {
        const k = kit();
        k.F(0, 0, 2000, 1000, L("Data lakehouse – medallion architecture", "Data lakehouse – arquitetura medalhão"));
        k.T(40, 24, L("Data lakehouse – medallion architecture (Bronze · Silver · Gold)", "Data lakehouse – arquitetura medalhão (Bronze · Silver · Gold)"), 34, 1500);
        const cols = [
          [L("📥 Sources", "📥 Fontes"), BG.gray, "#ffffff", [L("ERP / core systems", "ERP / sistemas core"), L("CRM / SaaS apps", "CRM / apps SaaS"), L("APIs & events", "APIs e eventos"), L("IoT / streaming", "IoT / streaming"), L("Files (CSV, JSON)", "Ficheiros (CSV, JSON)")]],
          [L("🔄 Ingestion", "🔄 Ingestão"), BG.blue, "#A9D1F7", [L("Batch loads\n(Auto Loader / COPY)", "Cargas batch\n(Auto Loader / COPY)"), L("Streaming\n(Kafka / Event Hubs)", "Streaming\n(Kafka / Event Hubs)"), L("CDC\n(change data capture)", "CDC\n(captura de alterações)")]],
          [L("🥉 Bronze – raw", "🥉 Bronze – bruto"), "#f6e3d1", "#E7B98A", [L("Raw Delta tables\nappend-only", "Tabelas Delta brutas\nappend-only"), L("Full history\n& audit", "Histórico completo\ne auditoria"), L("Schema on read", "Schema on read")]],
          [L("🥈 Silver – cleaned", "🥈 Silver – tratado"), "#eceff3", "#D5DAE3", [L("Cleaned & deduplicated", "Limpo e sem duplicados"), L("Conformed entities\n(customer, product…)", "Entidades conformadas\n(cliente, produto…)"), L("Data quality checks", "Verificações de qualidade")]],
          [L("🥇 Gold – business", "🥇 Gold – negócio"), "#fbf1cc", "#F3D36B", [L("Business aggregates\n& KPIs", "Agregados de negócio\ne KPIs"), L("Data marts\n(star schema)", "Data marts\n(modelo em estrela)"), L("Feature tables (ML)", "Tabelas de features (ML)")]],
          [L("📊 Consumers", "📊 Consumo"), BG.green, "#C8EBA1", [L("BI dashboards\n(Power BI, Tableau)", "Dashboards BI\n(Power BI, Tableau)"), L("SQL analytics", "Análise SQL"), L("ML / AI models", "Modelos ML / IA"), L("Data apps & APIs", "Data apps e APIs")]]
        ];
        const cw = 300, gap = 20, top = 100, h = 720;
        const firsts = [];
        cols.forEach(function (c, i) {
          const x = 40 + i * (cw + gap);
          k.F(x, top, cw, h, c[0], c[1]);
          c[3].forEach(function (t, j) { const id = k.Sh(x + 25, top + 40 + j * 130, cw - 50, 100, "round", t, c[2]); if (j === 0) firsts.push(id); });
        });
        for (let i = 0; i < firsts.length - 1; i++) k.A(firsts[i], firsts[i + 1]);
        k.F(40, 850, 940, 120, L("🔐 Governance – catalogue, lineage, access control, PII masking (e.g. Unity Catalog)", "🔐 Governança – catálogo, linhagem, controlo de acessos, mascaramento de PII (ex.: Unity Catalog)"), BG.purple);
        k.F(1000, 850, 940, 120, L("⏱ Orchestration & ops – jobs/workflows, monitoring, cost (FinOps), CI/CD for data", "⏱ Orquestração e operação – jobs/workflows, monitorização, custos (FinOps), CI/CD de dados"), BG.teal);
        return k.out;
      }
    },
    datamodel: {
      name: "Database model (ER)", desc: L("Entity-relationship diagram with keys and 1:N relationships.", "Diagrama entidade-relação com chaves e relações 1:N."), cat: "data",
      build: function () {
        const k = kit();
        k.F(0, 0, 1500, 900, L("Database model – entity relationship", "Modelo de dados – entidade-relação"));
        k.T(40, 24, L("Database model – entity relationship (ER)", "Modelo de dados – entidade-relação (ER)"), 34, 1200);
        k.T(40, 76, L("🔑 PK = primary key · 🔗 FK = foreign key · 1 : N = one-to-many", "🔑 PK = chave primária · 🔗 FK = chave estrangeira · 1 : N = um-para-muitos"), 16, 1200, "#4a5068");
        const ent = function (x, y, title, fields, color) { return k.SL(x, y, 280, 60 + fields.length * 26, title.toUpperCase() + "\n────────────\n" + fields.join("\n"), color, 15); };
        const cust = ent(60, 160, L("customer", "cliente"), ["🔑 customer_id  INT", "name  VARCHAR", "email  VARCHAR", "created_at  TIMESTAMP"], "#e3f0fd");
        const ord = ent(560, 160, L("order", "pedido"), ["🔑 order_id  INT", "🔗 customer_id  INT", "order_date  DATE", "status  VARCHAR", "total  DECIMAL"], "#fff8d6");
        const item = ent(560, 520, L("order_item", "item_pedido"), ["🔑 item_id  INT", "🔗 order_id  INT", "🔗 product_id  INT", "quantity  INT", "unit_price  DECIMAL"], "#fff8d6");
        const prod = ent(1080, 520, L("product", "produto"), ["🔑 product_id  INT", "name  VARCHAR", "category  VARCHAR", "price  DECIMAL"], "#eaf7dc");
        const pay = ent(1080, 160, L("payment", "pagamento"), ["🔑 payment_id  INT", "🔗 order_id  INT", "method  VARCHAR", "paid_at  TIMESTAMP"], "#fde7e9");
        k.A(cust, ord); k.A(ord, item); k.A(prod, item); k.A(ord, pay);
        k.T(400, 230, "1 : N", 18, 80); k.T(640, 440, "1 : N", 18, 80); k.T(900, 600, "1 : N", 18, 80); k.T(920, 230, "1 : N", 18, 80);
        return k.out;
      }
    },
    cloud: {
      name: "Cloud architecture & definitions", desc: L("Service and deployment models, landing zone and AWS · Azure · GCP equivalents.", "Modelos de serviço e de implementação, landing zone e equivalências AWS · Azure · GCP."), cat: "tech",
      build: function () {
        const k = kit();
        k.F(0, 0, 2000, 1160, L("Cloud architecture & definitions", "Arquitetura e definições de cloud"));
        k.T(40, 24, L("Cloud architecture & definitions", "Arquitetura e definições de cloud"), 36, 1200);
        // service models
        k.F(40, 100, 560, 460, L("☁️ Service models – who manages what", "☁️ Modelos de serviço – quem gere o quê"), BG.blue);
        [[L("IaaS\nYou: OS, runtime, apps, data\nProvider: servers, network, storage", "IaaS\nVocê: SO, runtime, apps, dados\nFornecedor: servidores, rede, storage"), "#A9D1F7"],
         [L("PaaS\nYou: apps and data\nProvider: OS, runtime, scaling", "PaaS\nVocê: apps e dados\nFornecedor: SO, runtime, escala"), "#9FE3D3"],
         [L("SaaS\nYou: users and configuration\nProvider: everything else", "SaaS\nVocê: utilizadores e configuração\nFornecedor: todo o resto"), "#C8EBA1"]].forEach(function (m, i) { k.SL(60, 140 + i * 135, 520, 120, m[0], m[1], 16); });
        k.F(40, 590, 560, 250, L("🏗 Deployment models", "🏗 Modelos de implementação"), BG.gray);
        [[L("Public cloud", "Cloud pública"), "#ffffff"], [L("Private cloud", "Cloud privada"), "#ffffff"], [L("Hybrid", "Híbrida"), "#ffffff"], [L("Multi-cloud", "Multi-cloud"), "#ffffff"]].forEach(function (m, i) { k.Sh(60 + (i % 2) * 265, 630 + Math.floor(i / 2) * 100, 250, 80, "round", m[0], m[1]); });
        // landing zone
        k.F(640, 100, 700, 740, L("🏢 Reference landing zone", "🏢 Landing zone de referência"), BG.white);
        const users = k.Sh(890, 130, 200, 60, "pill", L("Users", "Utilizadores"), "#ffffff");
        k.F(670, 220, 640, 600, L("Region · 2+ availability zones", "Região · 2+ zonas de disponibilidade"), "#f4f5f8");
        k.F(690, 270, 600, 530, L("Virtual network (VPC / VNet)", "Rede virtual (VPC / VNet)"), "#eaf2fb");
        k.F(710, 310, 560, 120, L("Public subnet", "Subnet pública"), "#e3f8f2");
        const cdn = k.Sh(730, 345, 240, 70, "round", L("CDN + WAF", "CDN + WAF"), "#9FE3D3");
        const lb = k.Sh(1010, 345, 240, 70, "round", L("Load balancer", "Load balancer"), "#9FE3D3");
        k.F(710, 450, 560, 160, L("Private subnet – application", "Subnet privada – aplicação"), "#e3f0fd");
        const app = k.Sh(730, 490, 250, 100, "round", L("Containers\n(Kubernetes)", "Contentores\n(Kubernetes)"), "#A9D1F7");
        const fn = k.Sh(1000, 490, 250, 100, "round", L("Serverless functions", "Funções serverless"), "#A9D1F7");
        k.F(710, 630, 560, 150, L("Private subnet – data", "Subnet privada – dados"), "#fff8d6");
        const dbm = k.Sh(730, 665, 250, 100, "ellipse", L("Managed database", "Base de dados gerida"), "#FFF59D");
        const st = k.Sh(1000, 665, 250, 100, "round", L("Object storage", "Object storage"), "#FFF59D");
        k.A(users, cdn); k.A(cdn, lb); k.A(lb, app); k.A(app, dbm); k.A(fn, st); k.A(app, fn);
        k.F(40, 870, 1300, 260, L("🛡 Shared services", "🛡 Serviços partilhados"), BG.purple);
        [L("Identity & access (IAM, SSO, MFA)", "Identidade e acessos (IAM, SSO, MFA)"), L("Security (keys, secrets, policies)", "Segurança (chaves, segredos, políticas)"), L("Monitoring & logging", "Monitorização e logs"), L("CI/CD & infrastructure as code", "CI/CD e infraestrutura como código"), L("Backup & disaster recovery", "Backup e recuperação de desastres"), L("Cost management (FinOps)", "Gestão de custos (FinOps)")].forEach(function (t, i) { k.Sh(60 + (i % 3) * 425, 910 + Math.floor(i / 3) * 105, 405, 85, "round", t, "#ffffff"); });
        // equivalence table
        k.F(1380, 100, 590, 1030, L("🔁 Equivalent services", "🔁 Serviços equivalentes"), BG.white);
        const rows = [
          [L("Service", "Serviço"), "AWS", "Azure", "GCP"],
          [L("Virtual machines", "Máquinas virtuais"), "EC2", "Virtual Machines", "Compute Engine"],
          ["Kubernetes", "EKS", "AKS", "GKE"],
          ["Serverless", "Lambda", "Functions", "Cloud Run / Functions"],
          [L("Object storage", "Object storage"), "S3", "Blob Storage", "Cloud Storage"],
          [L("Relational DB", "BD relacional"), "RDS / Aurora", "Azure SQL", "Cloud SQL"],
          [L("NoSQL", "NoSQL"), "DynamoDB", "Cosmos DB", "Firestore / Bigtable"],
          [L("Data warehouse", "Data warehouse"), "Redshift", "Synapse / Fabric", "BigQuery"],
          [L("Messaging", "Mensageria"), "SQS / SNS", "Service Bus", "Pub/Sub"],
          [L("Identity", "Identidade"), "IAM", "Entra ID", "Cloud IAM"],
          [L("Monitoring", "Monitorização"), "CloudWatch", "Monitor", "Cloud Monitoring"]
        ];
        const cws = [150, 130, 140, 140];
        rows.forEach(function (r, i) {
          let x = 1400;
          r.forEach(function (cell, j) {
            const hdr = i === 0, first = j === 0;
            k.Sh(x, 140 + i * 88, cws[j] - 6, 80, "rect", cell, hdr ? "#1c2033" : (first ? "#e3f0fd" : "#ffffff"), hdr ? "#ffffff" : "#1c2033");
            x += cws[j];
          });
        });
        return k.out;
      }
    },
    roadmap: {
      name: "Roadmap", desc: L("Now, next and later.", "Agora, a seguir e mais tarde."), cat: "strategy",
      build: function () {
        const k = kit();
        k.F(0, 0, 1300, 760, L("Roadmap", "Roadmap"));
        [[L("Now", "Agora"), BG.green, C.green], [L("Next", "A seguir"), BG.blue, C.blue], [L("Later", "Mais tarde"), BG.purple, C.purple]].forEach(function (c, i) {
          k.F(40 + i * 413, 60, 393, 660, c[0], c[1]); k.S(60 + i * 413, 90, "", c[2]);
        });
        return k.out;
      }
    }
  };

  window.MB_KITS = KITS;
  window.MB_KIT_ORDER = ["betatest", "pdca", "kanban", "retro", "planning", "piplanning", "sysdemo", "swarch", "cloud", "lakehouse", "datamodel", "process", "mindmap", "journey", "empathy", "swot", "eisenhower", "okr", "roadmap"];
  window.MB_KIT_CATS = { executive: L("Executive & governance", "Executivo e governança"), tech: L("Architecture & cloud", "Arquitetura e cloud"), data: L("Data & databases", "Dados e bases de dados"), agile: "Agile", diagram: L("Maps & diagrams", "Mapas e diagramas"), strategy: L("Strategy", "Estratégia"), feedback: L("Feedback & testing", "Feedback e testes"), mentoring: L("Mentoring", "Mentoria"), basic: L("Basic", "Básico") };

  /* ---------- icons (24×24 stroke) ---------- */
  window.MB_ICONS = {
    star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
    heart: '<path d="M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z"/>',
    check: '<path d="M4 12.5l5 5L20 6.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
    question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    rocket: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M14 4c3-1 6-1 6-1s0 3-1 6l-7 7-5-5z"/><circle cx="15" cy="9" r="1.5"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4a3 3 0 0 0 4 4M16 6h4a3 3 0 0 1-4 4M12 13v4M8 21h8M9 17h6v4H9z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2.4.6 4 2.9 4 6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    like: '<path d="M7 11v9H3v-9zM7 11l4-8c1.5 0 2.5 1 2.5 2.5V9H19a2 2 0 0 1 2 2.3l-1.3 6.8A2 2 0 0 1 17.7 20H7"/>',
    dislike: '<path d="M7 13V4H3v9zM7 13l4 8c1.5 0 2.5-1 2.5-2.5V15H19a2 2 0 0 0 2-2.3l-1.3-6.8A2 2 0 0 0 17.7 4H7"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14c1 1.5 2.4 2 4 2s3-.5 4-2"/><path d="M9 9.5v.01M15 9.5v.01"/>',
    sad: '<circle cx="12" cy="12" r="9"/><path d="M8 16c1-1.5 2.4-2 4-2s3 .5 4 2"/><path d="M9 9.5v.01M15 9.5v.01"/>',
    fire: '<path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-1.5-2-1.5-3C7 10 6 12.5 6 15a6 6 0 0 0 6 6z"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    pie: '<path d="M12 3v9h9A9 9 0 1 1 12 3z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
    money: '<circle cx="12" cy="12" r="9"/><path d="M15 9c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2.2 0 3 6 1.6 6 4.6 0 1.3-1.3 2.2-3 2.2-1.4 0-2.6-.6-3-1.6M12 6v1.5M12 16.5V18"/>',
    cart: '<path d="M3 4h2l2.5 11h11L21 7H6.2"/><circle cx="9" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/>',
    cloud: '<path d="M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 8a4.5 4.5 0 0 1-.5 10z"/>',
    code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
    book: '<path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6M20 4v14h-6"/>',
    graduation: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 12h18"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    arrowRight: '<path d="M4 12h15M13 6l6 6-6 6"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>',
    puzzle: '<path d="M9 4h4v2a2 2 0 1 0 4 0V4h3v6h-2a2 2 0 1 0 0 4h2v6h-6v-2a2 2 0 1 0-4 0v2H4v-6h2a2 2 0 1 0 0-4H4V4z"/>'
  };
  window.MB_EMOJI = ["😀", "😃", "😊", "😍", "🤩", "😎", "🤔", "😐", "😕", "😟", "😢", "😡", "🥳", "😴", "👍", "👎", "👏", "🙌", "💪", "🙏", "✅", "❌", "⚠️", "❓", "❗", "💡", "🎯", "🚀", "🔥", "⭐", "❤️", "💯", "🏆", "🎉", "📌", "📅", "⏰", "📈", "📉", "💰", "🧩", "🛠️", "🔒", "🐛", "📝", "💬", "👀", "🤝"];

  /* ---------- thumbnails ---------- */
  function bbox(objs) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    objs.forEach(function (o) { if (o.type === "arrow") return; const h = o.type === "text" ? (o.fs || 24) * 1.4 : o.h; x0 = Math.min(x0, o.x); y0 = Math.min(y0, o.y); x1 = Math.max(x1, o.x + o.w); y1 = Math.max(y1, o.y + h); });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function center(o) { return { x: o.x + o.w / 2, y: o.y + o.h / 2 }; }
  window.MBKitPreview = function (what) {
    const VW = 240, VH = 150;
    if (typeof what === "string") {
      if (what === "blank") return '<svg viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg"><rect width="240" height="150" fill="#fff"/><path d="M120 55v40M100 75h40" stroke="#4a5068" stroke-width="3" stroke-linecap="round"/></svg>';
      if (what === "moscow") return '<svg viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg"><rect width="240" height="150" fill="#f7f7f9"/>' +
        [[20, 12, "#e5484d"], [124, 12, "#f76b15"], [20, 80, "#4262ff"], [124, 80, "#8b90a5"]].map(function (q) { return '<rect x="' + q[0] + '" y="' + q[1] + '" width="96" height="58" fill="#fff" stroke="#dfe2ea"/><rect x="' + q[0] + '" y="' + q[1] + '" width="3" height="58" fill="' + q[2] + '"/>'; }).join("") +
        '<rect x="34" y="26" width="16" height="16" fill="#FFF59D"/><rect x="138" y="26" width="16" height="16" fill="#A9D1F7"/></svg>';
      if (what === "persona") return '<svg viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg"><rect width="240" height="150" fill="#f7f7f9"/><rect x="8" y="14" width="140" height="122" fill="#fff" stroke="#dfe2ea"/>' +
        '<rect x="14" y="22" width="44" height="22" fill="#eaf7dc"/><rect x="14" y="50" width="44" height="22" fill="#fde7e9"/><rect x="14" y="78" width="44" height="22" fill="#e3f0fd"/><rect x="14" y="106" width="44" height="22" fill="#fdeef8"/>' +
        '<circle cx="104" cy="66" r="24" fill="none" stroke="#8cc63f" stroke-width="5"/><circle cx="104" cy="66" r="11" fill="none" stroke="#ec4d3c" stroke-width="5"/>' +
        [[156, 14], [198, 14], [156, 78], [198, 78]].map(function (q) { return '<rect x="' + q[0] + '" y="' + q[1] + '" width="38" height="58" fill="#fff" stroke="#dfe2ea"/>'; }).join("") + "</svg>";
      return "";
    }
    const objs = what;
    const b = bbox(objs);
    const s = Math.min((VW - 16) / b.w, (VH - 16) / b.h);
    const ox = (VW - b.w * s) / 2 - b.x * s, oy = (VH - b.h * s) / 2 - b.y * s;
    const byId = {}; objs.forEach(function (o) { byId[o.id] = o; });
    let h = '<svg viewBox="0 0 ' + VW + " " + VH + '" xmlns="http://www.w3.org/2000/svg"><rect width="' + VW + '" height="' + VH + '" fill="#f7f7f9"/>';
    objs.forEach(function (o) {
      const x = ox + o.x * s, y = oy + o.y * s, w = o.w * s, hh = (o.type === "text" ? (o.fs || 24) * 1.2 : o.h) * s;
      if (o.type === "frame") h += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + hh + '" fill="' + o.color + '" stroke="#dfe2ea" stroke-width=".6"/>';
      else if (o.type === "sticky") h += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + hh + '" fill="' + o.color + '"/>';
      else if (o.type === "text") h += '<rect x="' + x + '" y="' + (y + hh * 0.25) + '" width="' + Math.min(w, 60 * s * 10) * 0.5 + '" height="' + Math.max(1.5, hh * 0.5) + '" rx="1" fill="#c3c7d4"/>';
      else if (o.type === "shape") {
        if (o.shape === "ellipse") h += '<ellipse cx="' + (x + w / 2) + '" cy="' + (y + hh / 2) + '" rx="' + w / 2 + '" ry="' + hh / 2 + '" fill="' + o.color + '" stroke="#1c2033" stroke-width=".6"/>';
        else if (o.shape === "diamond") h += '<polygon points="' + (x + w / 2) + "," + y + " " + (x + w) + "," + (y + hh / 2) + " " + (x + w / 2) + "," + (y + hh) + " " + x + "," + (y + hh / 2) + '" fill="' + o.color + '" stroke="#1c2033" stroke-width=".6"/>';
        else h += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + hh + '" rx="' + (o.shape === "pill" ? hh / 2 : o.shape === "round" ? 3 : 0) + '" fill="' + o.color + '" stroke="#1c2033" stroke-width=".6"/>';
      } else if (o.type === "icon") h += '<circle cx="' + (x + w / 2) + '" cy="' + (y + hh / 2) + '" r="' + w / 2.5 + '" fill="#FFCF8A"/>';
    });
    objs.forEach(function (o) {
      if (o.type !== "arrow" || !byId[o.from] || !byId[o.to]) return;
      const a = center(byId[o.from]), c = center(byId[o.to]);
      h += '<line x1="' + (ox + a.x * s) + '" y1="' + (oy + a.y * s) + '" x2="' + (ox + c.x * s) + '" y2="' + (oy + c.y * s) + '" stroke="#1c2033" stroke-width=".8"/>';
    });
    return h + "</svg>";
  };

  /* gallery list used by the hub, admin and the board */
  window.MBTemplateList = function () {
    const list = [
      { id: "blank", name: L("Blank board", "Quadro em branco"), desc: L("Start from an empty canvas.", "Comece de um quadro vazio."), cat: "basic", kind: "static" },
      { id: "persona", name: L("Persona Map + Priority Map", "Mapa da Persona + Mapa de Prioridades"), desc: L("Mentee profile study and MoSCoW prioritisation.", "Estudo de perfil do mentorado e priorização MoSCoW."), cat: "mentoring", kind: "static" },
      { id: "moscow", name: L("MoSCoW priority map", "Mapa de prioridades MoSCoW"), desc: L("Must, should, could and won't have.", "Must, should, could e won't have."), cat: "mentoring", kind: "static" }
    ];
    window.MB_KIT_ORDER.forEach(function (id) { const k = KITS[id]; list.push({ id: id, name: PT ? (k.namePT || k.name) : k.name, desc: k.desc, cat: k.cat, kind: "kit" }); });
    return list;
  };
  // Portuguese names
  const NPT = { betatest: "Kit de beta test", kanban: "Quadro Kanban", retro: "Retrospetiva", planning: "Sprint planning", piplanning: "PI Planning", sysdemo: "System demo", process: "Fluxo de processo", mindmap: "Mapa mental", journey: "Jornada do cliente", empathy: "Mapa de empatia", swot: "Análise SWOT", eisenhower: "Matriz de Eisenhower", okr: "OKRs", roadmap: "Roadmap", pdca: "Reunião executiva PDCA", swarch: "Arquitetura de software", lakehouse: "Data lakehouse (medalhão)", datamodel: "Modelo de base de dados (ER)", cloud: "Arquitetura e definições de cloud" };
  Object.keys(NPT).forEach(function (k) { KITS[k].namePT = NPT[k]; });
  window.MBTemplatePreview = function (id) {
    if (KITS[id]) { if (!KITS[id]._pv) KITS[id]._pv = window.MBKitPreview(KITS[id].build()); return KITS[id]._pv; }
    return window.MBKitPreview(id);
  };
})();
