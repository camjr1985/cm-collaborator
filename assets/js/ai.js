/* Embedded AI assistant for boards – build structures, suggest dynamics, analyse results.
 * Engine: Firebase AI Logic (Gemini Developer API), protected by App Check (reCAPTCHA Enterprise).
 * Settings in config.js → window.CMCOLLAB_AI. For local tests set window.CMAI_MOCK = function (kind, prompt) { return {...} }.
 */
(function () {
  "use strict";
  const PT = window.MB_LANG === "pt";
  const L = function (en, pt) { return PT ? pt : en; };
  const CFG = window.CMCOLLAB_AI || {};
  const API = function () { return window.CMBoardAPI; };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* ---------------- engine ---------------- */
  let aiPromise = null;
  function loadAI() {
    if (aiPromise) return aiPromise;
    const v = CFG.sdk || "12.19.0", base = "https://www.gstatic.com/firebasejs/" + v + "/";
    aiPromise = Promise.all([import(base + "firebase-app.js"), import(base + "firebase-app-check.js"), import(base + "firebase-ai.js")]).then(function (m) {
      const appMod = m[0], ac = m[1], aiMod = m[2];
      const existing = appMod.getApps().find(function (a) { return a.name === "cm-ai"; });
      const app = existing || appMod.initializeApp(window.CMCOLLAB_FIREBASE, "cm-ai");
      if (!existing && CFG.recaptchaKey) ac.initializeAppCheck(app, { provider: new ac.ReCaptchaEnterpriseProvider(CFG.recaptchaKey), isTokenAutoRefreshEnabled: true });
      return { mod: aiMod, ai: aiMod.getAI(app, { backend: new aiMod.GoogleAIBackend() }) };
    });
    aiPromise.catch(function () { aiPromise = null; });
    return aiPromise;
  }
  function parseJSON(txt) {
    let s = String(txt || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    return JSON.parse(s);
  }
  function generate(kind, prompt) {
    if (typeof window.CMAI_MOCK === "function") return Promise.resolve(window.CMAI_MOCK(kind, prompt));
    let models = (CFG.models || ["gemini-2.5-flash"]).slice();
    let saved = null; try { saved = localStorage.getItem("cmcollab:aimodel"); } catch (e) { /* ignore */ }
    if (saved && models.indexOf(saved) > 0) { models.splice(models.indexOf(saved), 1); models.unshift(saved); }
    return loadAI().then(function (x) {
      function tryModel(i) {
        if (i >= models.length) return Promise.reject(new Error(L("No AI model is available right now.", "Nenhum modelo de IA está disponível neste momento.")));
        const model = x.mod.getGenerativeModel(x.ai, { model: models[i], generationConfig: { responseMimeType: "application/json" } });
        return model.generateContent(prompt).then(function (r) {
          try { localStorage.setItem("cmcollab:aimodel", models[i]); } catch (e) { /* ignore */ }
          return parseJSON(r.response.text());
        }, function (err) {
          const m = String((err && err.message) || err);
          if (!/app.?check|\[401|\[403|quota|429/i.test(m) && /not found|\[404|not supported|unknown model|does not exist/i.test(m)) return tryModel(i + 1);
          throw err;
        });
      }
      return tryModel(0);
    });
  }

  /* ---------------- daily usage per plan ---------------- */
  let planId = null;
  function today() { const d = new Date(); return d.getFullYear() + "" + (d.getMonth() + 1) + "" + d.getDate(); }
  function usedToday() { try { return Number(localStorage.getItem("cmcollab:ai:" + today())) || 0; } catch (e) { return 0; } }
  function countUse() { try { localStorage.setItem("cmcollab:ai:" + today(), String(usedToday() + 1)); } catch (e) { /* ignore */ } }
  function resolvePlan() {
    if (planId) return Promise.resolve(planId);
    const A = window.CMAuth;
    if (API().isAdmin()) return Promise.resolve(planId = "admin");
    if (!A || !A.enabled || !A.user()) return Promise.resolve(planId = "free");
    return A.db().ref("plans/" + A.key(A.user().email)).once("value").then(function (s) {
      planId = window.CMPlan ? window.CMPlan(s.val()).id : ((s.val() || {}).plan || "free"); return planId;
    }, function () { return (planId = "free"); });
  }
  function limit() { return (CFG.dailyLimit || {})[planId || "free"] || 10; }

  /* ---------------- prompts ---------------- */
  const LANG = PT ? "Português (de Portugal/Brasil, neutro)" : "English";
  const BUILD_SHAPE = '{"title":"","intro":"one sentence","frames":[{"title":"emoji + short area title","color":"yellow|green|blue|red|purple|orange|teal|gray","notes":["short starter post-it", "..."]}],"steps":[{"name":"","minutes":10,"how":"one short sentence"}]}';
  function context(f) {
    return "Board name: " + (API().snapshot(false).title || "-") + "\nGoal: " + f.goal + "\nAudience: " + f.audience + "\nParticipants: " + f.people + "\nDuration (minutes): " + f.minutes;
  }
  function promptBuild(f) {
    return "You are an expert facilitator and PMO coach designing a visual collaboration board (like Miro).\n" + context(f) +
      "\nDesign the board structure for this goal: 3 to 6 areas (frames) in a logical left-to-right order, each with 1 to 4 short starter post-its (max 8 words each) or guiding questions, and a facilitation script of 3 to 6 timed steps that fits the duration." +
      "\nWrite all text in " + LANG + ". Reply ONLY with JSON exactly in this shape: " + BUILD_SHAPE;
  }
  function promptDynamics(f) {
    return "You are an expert facilitator (agile, executive governance, mentoring, UX and architecture workshops).\n" + context(f) +
      "\nSuggest 3 different, well-known facilitation dynamics that best fit this goal and audience (e.g. Start/Stop/Continue, 5 Whys, Lean Coffee, pre-mortem, PDCA review, Fishbone, Impact/Effort matrix, Crazy 8s, Six Thinking Hats, SWOT, decision matrix). For each give why it fits, total minutes, timed steps and the board areas to build." +
      "\nWrite all text in " + LANG + '. Reply ONLY with JSON in this shape: {"options":[{"name":"","why":"one sentence","minutes":45,"steps":[{"name":"","minutes":10,"how":""}],"frames":[{"title":"","color":"yellow|green|blue|red|purple|orange|teal|gray","notes":["…"]}]}]}';
  }
  function promptAnalyse(snap, question) {
    return "You are a senior PMO and facilitation analyst. Analyse the result of a collaborative session on a visual board.\n" +
      "Board: " + snap.title + "\nAreas: " + JSON.stringify(snap.areas) + "\nItems (text, area, votes, comments): " + JSON.stringify(snap.items) +
      (question ? "\nThe facilitator wants to know: " + question : "") +
      "\nGroup the content into 3 to 6 themes, highlight priorities (consider votes), risks or blockers, and propose concrete next actions with a suggested owner role and timeframe. Be factual and only use what is on the board. Keep texts short (max 15 words per item)." +
      "\nWrite all text in " + LANG + '. Reply ONLY with JSON in this shape: {"summary":"2-3 sentences","themes":[{"name":"","insight":"one sentence","items":["post-it text"],"votes":0}],"priorities":[""],"risks":[""],"actions":[{"what":"","owner":"role","when":"e.g. 2 weeks"}]}';
  }

  /* ---------------- board objects from AI output ---------------- */
  const NOTE = { yellow: "#FFF59D", green: "#C8EBA1", blue: "#A9D1F7", red: "#F7A8B0", purple: "#CDBDF6", orange: "#FFCF8A", teal: "#9FE3D3", gray: "#E6E6E6", pink: "#F6C1E4" };
  const AREA = { yellow: "#fff8d6", green: "#eaf7dc", blue: "#e3f0fd", red: "#fde7e9", purple: "#f4eefe", orange: "#fff3e0", teal: "#e3f8f2", gray: "#f4f5f8", pink: "#fdeef8" };
  const ORDER = ["blue", "green", "yellow", "purple", "orange", "teal", "red", "gray"];
  function kit() {
    let n = 0; const out = [];
    return {
      out: out,
      F: function (x, y, w, h, title, color) { out.push({ id: "a" + (++n), type: "frame", x: x, y: y, w: w, h: h, title: title || "", color: color || "#ffffff" }); },
      S: function (x, y, text, color, w, h) { out.push({ id: "a" + (++n), type: "sticky", x: x, y: y, w: w || 140, h: h || 110, text: String(text || "").slice(0, 160), color: color || NOTE.yellow }); },
      T: function (x, y, text, fs, w, color) { out.push({ id: "a" + (++n), type: "text", x: x, y: y, w: w || 600, fs: fs || 18, text: String(text || ""), color: color || "#1c2033" }); },
      R: function (x, y, w, h, text, fill, tc) { out.push({ id: "a" + (++n), type: "shape", shape: "rect", x: x, y: y, w: w, h: h, text: String(text || ""), color: fill || "#ffffff", tcolor: tc || "#1c2033" }); }
    };
  }
  function colorOf(c, i) { c = String(c || "").toLowerCase(); return NOTE[c] ? c : ORDER[i % ORDER.length]; }
  function buildBoard(spec) {
    const k = kit();
    const frames = (spec.frames || []).slice(0, 8), steps = (spec.steps || []).slice(0, 8);
    const colW = 340, gap = 20, top = 150;
    let rowsMax = 1;
    frames.forEach(function (f) { rowsMax = Math.max(rowsMax, Math.ceil(Math.min((f.notes || []).length, 6) / 2)); });
    const fh = Math.max(420, 70 + rowsMax * 130 + 60);
    const stepsW = steps.length ? 380 : 0;
    const W = 40 + frames.length * (colW + gap) + (stepsW ? stepsW + gap : 0) + 20;
    k.F(0, 0, Math.max(W, 900), top + fh + 50, "✨ " + (spec.title || L("AI board", "Quadro da IA")), "#ffffff");
    k.T(40, 26, spec.title || "", 34, Math.max(W, 900) - 80);
    if (spec.intro) k.T(40, 80, spec.intro, 17, Math.max(W, 900) - 80, "#4a5068");
    frames.forEach(function (f, i) {
      const x = 40 + i * (colW + gap), c = colorOf(f.color, i);
      k.F(x, top, colW, fh, f.title || "", AREA[c]);
      (f.notes || []).slice(0, 6).forEach(function (t, j) { k.S(x + 18 + (j % 2) * 158, top + 30 + Math.floor(j / 2) * 130, t, NOTE[c]); });
    });
    if (steps.length) {
      const x = 40 + frames.length * (colW + gap);
      k.F(x, top, stepsW, fh, L("🧭 Facilitation script", "🧭 Roteiro da dinâmica"), "#f4f5f8");
      k.T(x + 20, top + 24, steps.map(function (s, i) { return (i + 1) + ". " + (s.name || "") + (s.minutes ? " (" + s.minutes + "')" : "") + (s.how ? "\n   " + s.how : ""); }).join("\n"), 15, stepsW - 40);
    }
    return k.out;
  }
  function buildAnalysis(a) {
    const k = kit();
    const themes = (a.themes || []).slice(0, 6);
    const tw = 330, gap = 20;
    const W = Math.max(1100, 40 + themes.length * (tw + gap) + 20);
    const date = new Date().toLocaleDateString(PT ? "pt-PT" : "en-GB");
    const tH = 70 + 2 * 125 + 30;
    const yT = 150, yP = yT + tH + 40, pH = 300, yA = yP + pH + 40;
    const actions = (a.actions || []).slice(0, 8), aH = 70 + (actions.length + 1) * 48;
    k.F(0, 0, W, yA + aH + 40, "✨ " + L("AI analysis", "Análise da IA") + " · " + date, "#ffffff");
    k.T(40, 26, L("AI analysis of the session", "Análise da IA da sessão"), 32, W - 80);
    if (a.summary) k.T(40, 76, a.summary, 16, W - 80, "#4a5068");
    themes.forEach(function (t, i) {
      const x = 40 + i * (tw + gap), c = ORDER[i % ORDER.length];
      k.F(x, yT, tw, tH, "🏷 " + (t.name || "") + (t.votes ? " · " + t.votes + " " + L("votes", "votos") : ""), AREA[c]);
      if (t.insight) k.T(x + 16, yT + 16, t.insight, 14, tw - 32, "#3c4159");
      (t.items || []).slice(0, 4).forEach(function (s, j) { k.S(x + 16 + (j % 2) * 152, yT + 70 + Math.floor(j / 2) * 125, s, NOTE[c], 140, 110); });
    });
    const half = (W - 100) / 2;
    k.F(40, yP, half, pH, L("🎯 Priorities", "🎯 Prioridades"), AREA.green);
    (a.priorities || []).slice(0, 6).forEach(function (s, j) { k.S(56 + (j % 3) * 158, yP + 30 + Math.floor(j / 3) * 130, s, NOTE.green, 145, 110); });
    k.F(60 + half, yP, half, pH, L("⚠️ Risks & blockers", "⚠️ Riscos e bloqueios"), AREA.red);
    (a.risks || []).slice(0, 6).forEach(function (s, j) { k.S(76 + half + (j % 3) * 158, yP + 30 + Math.floor(j / 3) * 130, s, NOTE.red, 145, 110); });
    k.F(40, yA, W - 80, aH, L("➡️ Next actions", "➡️ Próximas ações"), "#f4f5f8");
    const cols = [[L("Action", "Ação"), 0.6], [L("Owner", "Responsável"), 0.22], [L("When", "Prazo"), 0.18]];
    let x = 60; const tw2 = W - 120;
    cols.forEach(function (c) {
      const w = Math.floor(tw2 * c[1]) - 6;
      k.R(x, yA + 24, w, 40, c[0], "#1c2033", "#ffffff");
      actions.forEach(function (ac, r) { k.R(x, yA + 70 + r * 48, w, 42, [ac.what, ac.owner, ac.when][cols.indexOf(c)] || "", "#ffffff"); });
      x += w + 6;
    });
    return k.out;
  }

  /* ---------------- UI ---------------- */
  const AUD = [["team", L("Agile team", "Equipe ágil")], ["exec", L("Directors / executives", "Diretores / executivos")], ["mentor", L("Mentoring", "Mentoria")], ["ux", L("Customers / UX", "Clientes / UX")], ["tech", L("Architecture / IT", "Arquitetura / TI")]];
  const EX = PT ? ["Retrospetiva da sprint 12 com 8 pessoas", "Decisão de investimento com diretores (PDCA)", "Mapear o processo de onboarding de clientes", "Plano de desenvolvimento do mentorado", "Revisão da arquitetura de migração para cloud"]
    : ["Sprint 12 retrospective with 8 people", "Investment decision with directors (PDCA)", "Map the customer onboarding process", "Mentee development plan", "Cloud migration architecture review"];
  let tab = "build", last = null;
  function form(btnLabel) {
    return '<form class="ai-form" id="aiForm"><label>' + L("What is the goal of this session?", "Qual é o objetivo desta sessão?") + '<textarea name="goal" rows="2" required placeholder="' + esc(EX[0]) + '"></textarea></label>' +
      '<div class="ai-chips">' + EX.map(function (e) { return '<button type="button" data-ex="' + esc(e) + '">' + esc(e) + "</button>"; }).join("") + "</div>" +
      '<div class="ai-row"><label>' + L("Audience", "Público") + '<select name="audience">' + AUD.map(function (a) { return '<option value="' + esc(a[1]) + '">' + esc(a[1]) + "</option>"; }).join("") + "</select></label>" +
      "<label>" + L("Participants", "Participantes") + '<input name="people" type="number" min="1" max="500" value="8"></label>' +
      "<label>" + L("Duration", "Duração") + '<select name="minutes"><option>30</option><option selected>60</option><option>90</option><option>120</option><option>240</option></select></label></div>' +
      '<div class="modal-actions"><button class="btn primary">' + btnLabel + "</button></div></form>";
  }
  function body() {
    if (tab === "analyse") {
      return '<form class="ai-form" id="aiForm"><label>' + L("What should the analysis focus on? (optional)", "Em que deve focar a análise? (opcional)") + '<input name="question" placeholder="' + esc(L("e.g. main blockers and quick wins", "ex.: principais bloqueios e ganhos rápidos")) + '"></label>' +
        '<label><input type="checkbox" name="onlySel" style="width:auto;margin-right:6px"' + (API().hasSelection() ? "" : " disabled") + ">" + L("Only the selected items", "Só os elementos selecionados") + "</label>" +
        '<div class="modal-actions"><button class="btn primary">' + L("Analyse the board", "Analisar o quadro") + "</button></div></form>";
    }
    return form(tab === "build" ? L("Generate structure", "Gerar estrutura") : L("Suggest dynamics", "Sugerir dinâmicas"));
  }
  function render(root) {
    const used = usedToday(), lim = limit();
    root.innerHTML = '<div class="ai-card"><div class="tpl-head"><h2>✨ ' + L("AI assistant", "Assistente IA") + '</h2><button class="icon-btn" id="aiX" title="Close">✕</button></div>' +
      '<div class="ai-tabs">' + [["build", L("Build board", "Construir quadro")], ["dyn", L("Suggest dynamics", "Sugerir dinâmicas")], ["analyse", L("Analyse results", "Analisar resultados")]].map(function (t) { return '<button data-tab="' + t[0] + '" class="' + (tab === t[0] ? "on" : "") + '">' + esc(t[1]) + "</button>"; }).join("") + "</div>" +
      body() + '<div class="ai-out" id="aiOut"></div>' +
      '<p class="ai-note">' + L("The board content is sent to Google Gemini to generate suggestions. AI can make mistakes – review before deciding.", "O conteúdo do quadro é enviado ao Google Gemini para gerar as sugestões. A IA pode errar – reveja antes de decidir.") + " · " + L("Requests today", "Pedidos hoje") + ": " + used + "/" + lim + "</p></div>";
    root.querySelector("#aiX").onclick = API().closeModal;
    root.querySelectorAll("[data-tab]").forEach(function (b) { b.onclick = function () { tab = b.dataset.tab; render(root); }; });
    root.querySelectorAll("[data-ex]").forEach(function (b) { b.onclick = function () { root.querySelector("[name=goal]").value = b.dataset.ex; }; });
    root.querySelector("#aiForm").onsubmit = function (e) { e.preventDefault(); run(root, e.target); };
  }
  function busy(out, on) { out.innerHTML = on ? '<div class="ai-busy"><i></i>' + L("The AI is thinking…", "A IA está pensando…") + "</div>" : ""; }
  function fail(out, err) {
    console.warn(err);
    const m = String((err && err.message) || err);
    let msg = L("The AI could not answer. Please try again in a moment.", "A IA não conseguiu responder. Tente novamente daqui a pouco.");
    if (/quota|429|resource.?exhausted|rate limit/i.test(m)) msg = L("The free AI quota was reached for now. Try again later.", "A quota gratuita da IA foi atingida por agora. Tente mais tarde.");
    if (/app.?check|recaptcha|attestation|\[401|\[403/i.test(m)) msg = L("The AI is protected and could not verify this browser (App Check). Reload the page and try again.", "A IA está protegida e não conseguiu validar este navegador (App Check). Recarregue a página e tente de novo.");
    out.innerHTML = '<p class="ai-err">' + esc(msg) + '</p><p class="ai-meta">' + esc(m.slice(0, 160)) + "</p>";
  }
  function frameList(frames) {
    return (frames || []).map(function (f) { return "<li><b>" + esc(f.title) + "</b>" + ((f.notes || []).length ? " – " + esc((f.notes || []).slice(0, 4).join(" · ")) : "") + "</li>"; }).join("");
  }
  function run(root, f) {
    const out = root.querySelector("#aiOut"), btn = f.querySelector(".btn.primary");
    if (usedToday() >= limit()) { out.innerHTML = '<p class="ai-err">' + esc(L("You reached today's AI limit for your plan.", "Atingiu o limite diário de IA do seu plano.")) + ' <a href="../pricing/">' + esc(L("See plans", "Ver planos")) + "</a></p>"; return; }
    const data = { goal: (f.goal && f.goal.value.trim()) || "", audience: f.audience ? f.audience.value : "", people: f.people ? f.people.value : "", minutes: f.minutes ? f.minutes.value : "" };
    let prompt, kind = tab;
    if (tab === "analyse") {
      const snap = API().snapshot(!!(f.onlySel && f.onlySel.checked));
      if (!snap.items.length) { out.innerHTML = '<p class="ai-err">' + esc(L("There is nothing to analyse yet – add post-its first.", "Ainda não há nada para analisar – adicione post-its primeiro.")) + "</p>"; return; }
      prompt = promptAnalyse(snap, f.question.value.trim());
    } else {
      if (!data.goal) return;
      prompt = tab === "build" ? promptBuild(data) : promptDynamics(data);
    }
    btn.disabled = true; busy(out, true);
    generate(kind, prompt).then(function (res) {
      countUse(); btn.disabled = false; last = res;
      const canEdit = API().canEdit();
      const ins = function (label) { return canEdit ? '<button class="btn primary" data-ins>' + label + "</button>" : '<span class="ai-meta">' + esc(L("View only – you cannot add to this board.", "Só leitura – não pode adicionar a este quadro.")) + "</span>"; };
      if (kind === "build") {
        out.innerHTML = '<div class="ai-opt"><h4>' + esc(res.title || "") + "</h4><p>" + esc(res.intro || "") + "</p><ol>" + frameList(res.frames) + "</ol>" +
          ((res.steps || []).length ? '<p class="ai-meta">' + esc((res.steps || []).map(function (s) { return s.name + " (" + s.minutes + "')"; }).join(" → ")) + "</p>" : "") +
          '<div class="modal-actions">' + ins(L("Add to the board", "Inserir no quadro")) + "</div></div>";
        const b = out.querySelector("[data-ins]"); if (b) b.onclick = function () { if (API().insert(buildBoard(res), L("AI structure added – everything is editable", "Estrutura da IA inserida – tudo é editável"))) API().closeModal(); };
      } else if (kind === "dyn") {
        const opts = (res.options || []).slice(0, 3);
        out.innerHTML = opts.map(function (o, i) {
          return '<div class="ai-opt"><h4>' + esc(o.name) + ' <span class="ai-meta">· ' + esc(o.minutes || "") + " min</span></h4><p>" + esc(o.why || "") + "</p><ol>" +
            (o.steps || []).map(function (s) { return "<li>" + esc(s.name) + (s.minutes ? " (" + esc(s.minutes) + "')" : "") + (s.how ? " – " + esc(s.how) : "") + "</li>"; }).join("") + "</ol>" +
            '<div class="modal-actions">' + (canEdit ? '<button class="btn primary" data-dyn="' + i + '">' + esc(L("Build on the board", "Montar no quadro")) + "</button>" : "") + "</div></div>";
        }).join("") || '<p class="ai-err">' + esc(L("No suggestions returned.", "A IA não devolveu sugestões.")) + "</p>";
        out.querySelectorAll("[data-dyn]").forEach(function (b) {
          b.onclick = function () { const o = opts[Number(b.dataset.dyn)]; if (API().insert(buildBoard({ title: o.name, intro: o.why, frames: o.frames, steps: o.steps }), L("Dynamic added to the board", "Dinâmica montada no quadro"))) API().closeModal(); };
        });
      } else {
        out.innerHTML = '<div class="ai-opt"><h4>' + esc(L("Summary", "Resumo")) + "</h4><p>" + esc(res.summary || "") + "</p><ol>" +
          (res.themes || []).map(function (t) { return "<li><b>" + esc(t.name) + "</b> – " + esc(t.insight || "") + "</li>"; }).join("") + "</ol>" +
          ((res.actions || []).length ? '<p class="ai-meta">' + esc(L("Actions", "Ações")) + ": " + esc((res.actions || []).map(function (a) { return a.what; }).join(" · ")) + "</p>" : "") +
          '<div class="modal-actions">' + ins(L("Add analysis to the board", "Inserir análise no quadro")) + "</div></div>";
        const b = out.querySelector("[data-ins]"); if (b) b.onclick = function () { if (API().insert(buildAnalysis(res), L("AI analysis added to the board", "Análise da IA inserida no quadro"))) API().closeModal(); };
      }
      const n = root.querySelector(".ai-note"); if (n) n.textContent = n.textContent.replace(/\d+\/(\d+)$/, usedToday() + "/$1");
    }, function (err) { btn.disabled = false; fail(out, err); });
  }

  window.CMAI = {
    open: function () {
      resolvePlan().then(function () { API().modal('<div id="aiRoot"></div>', function (m) { const md = document.getElementById("modal"); if (md) md.classList.add("wide"); render(m.querySelector("#aiRoot")); }); });
    },
    _buildBoard: buildBoard, _buildAnalysis: buildAnalysis
  };
})();
