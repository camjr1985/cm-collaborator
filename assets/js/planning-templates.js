/* CM Collaborator – Planning methodologies: workflow, default views and starter structure.
 * Shared by the hub (create dialog) and the planning page. Dates are "YYYY-MM-DD". */
(function () {
  "use strict";
  const PT = window.MB_LANG === "pt";
  const L = function (en, pt) { return PT ? pt : en; };
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
      views: ["timeline", "list", "board"], label: { timeline: L("Schedule", "Cronograma") },
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
  function initialData(method, title) {
    const m = METHODS[method] || METHODS.hybrid, s = seed(m.id);
    Object.keys(s.items).forEach(function (id, i) { s.items[id].key = keyPrefix(title) + "-" + (i + 1); });
    return { settings: { statuses: m.statuses, prefix: keyPrefix(title), seq: s.seq }, items: s.items, sprints: s.sprints };
  }
  window.PLAN_METHODS = METHODS;
  window.PLAN_ORDER = ["hybrid", "waterfall", "scrum", "kanban"];
  window.PLAN_INITIAL = initialData;
})();
