/* CM Collaborator – Jornada guiada (reusable in every module)
   CMTour.journey({ key, title, intro, items: [{ id, t, d, done, steps:[{ el, t, d, before, click }] }] })
   CMTour.run(steps) – coach marks: dims the page, highlights the element, "click here / do this". */
(function () {
  "use strict";
  const PT = window.MB_LANG !== "en";
  const L = function (en, pt) { return window.MBL ? window.MBL(en, pt) : (PT ? pt : en); };
  const esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  const get = function (k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
  const put = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };

  const css = "" +
    "#cmJg{position:fixed;right:16px;bottom:16px;z-index:900;width:340px;max-width:calc(100vw - 32px);background:#fff;color:#172036;border:1px solid #e3e7ef;border-radius:14px;box-shadow:0 18px 50px rgba(14,26,51,.22);font:var(--fs-13,13px)/1.45 Inter,system-ui,sans-serif;display:flex;flex-direction:column;max-height:calc(100vh - 90px)}" +
    "#cmJg header{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #e3e7ef;background:linear-gradient(135deg,#0e1a33,#1f4fa3);color:#fff;border-radius:14px 14px 0 0}" +
    "#cmJg header b{font-family:Poppins,sans-serif;font-size:var(--fs-14,14px);display:block}#cmJg header small{opacity:.85}" +
    "#cmJg header button{margin-left:auto;background:rgba(255,255,255,.14);border:0;color:#fff;border-radius:8px;width:28px;height:28px;cursor:pointer;font-size:var(--fs-14,14px)}" +
    "#cmJg .jg-prog{height:6px;background:#e3e7ef;border-radius:6px;margin:10px 14px 4px;overflow:hidden}#cmJg .jg-prog i{display:block;height:100%;background:#1baf7a;border-radius:6px;transition:width .3s}" +
    "#cmJg .jg-intro{padding:4px 14px 6px;color:#4a5468;font-size:var(--fs-12,12px)}" +
    "#cmJg ol{list-style:none;margin:0;padding:4px 8px 10px;overflow:auto}" +
    "#cmJg li{display:flex;gap:10px;padding:8px 6px;border-radius:10px;cursor:pointer;align-items:flex-start}#cmJg li:hover{background:#f0f3f9}" +
    "#cmJg li .n{flex:none;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:var(--fs-12,12px);background:#eef2fa;color:#1f4fa3;border:1px solid #cfd9ee}" +
    "#cmJg li.ok .n{background:#1baf7a;border-color:#1baf7a;color:#fff}#cmJg li.ok .t{color:#626a80;text-decoration:line-through}" +
    "#cmJg li .t{font-weight:600}#cmJg li p{margin:4px 0 6px;color:#4a5468;font-size:var(--fs-12,12px)}" +
    "#cmJg li.cur{background:#f3f7ff;outline:1px solid #cfd9ee}#cmJg li.cur .n{background:#2f80ed;border-color:#2f80ed;color:#fff}" +
    "#cmJg .jg-go{border:0;background:#2f80ed;color:#fff;border-radius:8px;padding:6px 12px;font-weight:600;cursor:pointer;font-size:var(--fs-12,12px)}" +
    "#cmJg .jg-done{padding:10px 14px 14px;color:#1b7a55;font-weight:600}" +
    "#cmJg.min ol,#cmJg.min .jg-intro,#cmJg.min .jg-done{display:none}" +
    "#cmTourHole{position:fixed;z-index:950;border-radius:10px;box-shadow:0 0 0 9999px rgba(14,26,51,.55),0 0 0 3px #2f80ed;pointer-events:none;transition:all .25s}" +
    "#cmTourHole.pulse{animation:cmTp 1.4s infinite}@keyframes cmTp{0%,100%{box-shadow:0 0 0 9999px rgba(14,26,51,.55),0 0 0 3px #2f80ed}50%{box-shadow:0 0 0 9999px rgba(14,26,51,.55),0 0 0 7px rgba(47,128,237,.45)}}" +
    "#cmTourTip{position:fixed;z-index:960;width:300px;max-width:calc(100vw - 24px);background:#fff;color:#172036;border-radius:12px;padding:14px;box-shadow:0 14px 40px rgba(0,0,0,.28);font:var(--fs-13,13px)/1.45 Inter,system-ui,sans-serif}" +
    "#cmTourTip small{color:#2f80ed;font-weight:700;text-transform:uppercase;letter-spacing:.04em;font-size:var(--fs-11,11px)}#cmTourTip b{display:block;font-family:Poppins,sans-serif;font-size:var(--fs-14,14px);margin:2px 0 4px}" +
    "#cmTourTip p{margin:0 0 10px;color:#4a5468}#cmTourTip .r{display:flex;gap:6px;justify-content:flex-end;align-items:center}#cmTourTip .r .x{margin-right:auto;background:none;border:0;color:#626a80;cursor:pointer;padding:0}" +
    "#cmTourTip button.b{border:1px solid #e3e7ef;background:#fff;border-radius:8px;padding:6px 12px;font-weight:600;cursor:pointer}#cmTourTip button.p{background:#2f80ed;border-color:#2f80ed;color:#fff}" +
    "body.cm-touring #cmJg{display:none}" +
    "@media (max-width:640px){#cmJg{right:8px;left:8px;width:auto;bottom:8px;max-height:58vh}}";
  function style() { if (document.getElementById("cmTourCss")) return; const s = document.createElement("style"); s.id = "cmTourCss"; s.textContent = css; document.head.appendChild(s); }

  /* ---------- coach marks ---------- */
  let cur = null;
  function stop() {
    if (!cur) return;
    ["cmTourHole", "cmTourTip"].forEach(function (id) { const n = document.getElementById(id); if (n) n.remove(); });
    window.removeEventListener("resize", cur.place, true); window.removeEventListener("scroll", cur.place, true);
    if (cur.unclick) cur.unclick();
    document.body.classList.remove("cm-touring");
    const done = cur.onEnd; cur = null; if (done) done();
  }
  function find(sel) { try { return typeof sel === "function" ? sel() : document.querySelector(sel); } catch (e) { return null; } }
  function waitEl(sel, ms) {
    return new Promise(function (res) { const t0 = Date.now(); (function loop() { const e = find(sel); if (e && e.getClientRects().length) return res(e); if (Date.now() - t0 > ms) return res(null); setTimeout(loop, 120); })(); });
  }
  function run(steps, onEnd) {
    stop(); style();
    cur = { i: 0, steps: steps, onEnd: onEnd }; document.body.classList.add("cm-touring");
    const me = cur;
    const hole = document.createElement("div"); hole.id = "cmTourHole"; hole.className = "pulse"; document.body.appendChild(hole);
    const tip = document.createElement("div"); tip.id = "cmTourTip"; tip.setAttribute("role", "dialog"); document.body.appendChild(tip);
    let el = null;
    me.place = function () {
      if (cur !== me) return;
      const W = innerWidth, H = innerHeight;
      if (!el) { hole.style.cssText = "left:50%;top:40%;width:0;height:0"; tip.style.left = Math.max(12, (W - tip.offsetWidth) / 2) + "px"; tip.style.top = Math.max(12, H * .4 - tip.offsetHeight / 2) + "px"; return; }
      const r = el.getBoundingClientRect(), pad = 6;
      hole.style.cssText = "left:" + (r.left - pad) + "px;top:" + (r.top - pad) + "px;width:" + (r.width + pad * 2) + "px;height:" + (r.height + pad * 2) + "px";
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let top = r.bottom + 14; if (top + th > H - 8) top = r.top - th - 14; if (top < 8) top = Math.min(H - th - 8, Math.max(8, r.top + 10));
      let left = r.left + r.width / 2 - tw / 2; left = Math.max(12, Math.min(W - tw - 12, left));
      tip.style.top = top + "px"; tip.style.left = left + "px";
    };
    window.addEventListener("resize", me.place, true); window.addEventListener("scroll", me.place, true);
    function show(i) {
      if (cur !== me) return;
      if (me.unclick) { me.unclick(); me.unclick = null; }
      if (i >= steps.length) return stop();
      me.i = i; const s = steps[i];
      Promise.resolve(s.before ? s.before() : null).then(function () { return s.el ? waitEl(s.el, 3000) : null; }).then(function (e) {
        if (cur !== me) return;
        el = e; if (el && el.scrollIntoView) { const sx = scrollX, ex = document.documentElement.scrollLeft; el.scrollIntoView({ block: "center", inline: "nearest" }); if (scrollX !== sx || document.documentElement.scrollLeft !== ex) scrollTo(sx, scrollY); document.body.scrollLeft = 0; };
        tip.innerHTML = "<small>" + esc(L("Step ", "Passo ")) + (i + 1) + " / " + steps.length + "</small><b>" + esc(s.t) + "</b><p>" + esc(s.d || "") + "</p>" +
          '<div class="r"><button class="x" data-x>' + esc(L("Exit", "Sair")) + "</button>" + (i ? '<button class="b" data-b>' + esc(L("Back", "Voltar")) + "</button>" : "") +
          '<button class="b p" data-n>' + esc(i === steps.length - 1 ? L("Done", "Concluir") : s.click && el ? L("Or next", "Ou avance") : L("Next", "Próximo")) + "</button></div>";
        tip.querySelector("[data-x]").onclick = stop;
        if (tip.querySelector("[data-b]")) tip.querySelector("[data-b]").onclick = function () { show(i - 1); };
        tip.querySelector("[data-n]").onclick = function () { show(i + 1); };
        if (s.click && el) { const h = function () { setTimeout(function () { show(i + 1); }, 250); }; el.addEventListener("click", h, { once: true }); me.unclick = function () { el.removeEventListener("click", h); }; }
        setTimeout(me.place, 30); setTimeout(me.place, 400);
      });
    }
    document.addEventListener("keydown", function k(e) { if (cur !== me) return document.removeEventListener("keydown", k); if (e.key === "Escape") stop(); });
    show(0);
  }

  /* ---------- checklist panel ---------- */
  function journey(cfg) {
    style();
    const K = "cm:jg:" + cfg.key, st = get(K) || {};
    let box = document.getElementById("cmJg"), items = cfg.items || [], open = null;
    function draw() {
      const n = items.filter(function (x) { return x.done; }).length, first = items.findIndex(function (x) { return !x.done; });
      if (open == null || (items[open] && items[open].done && open !== first)) open = first;
      if (!box) { box = document.createElement("section"); box.id = "cmJg"; box.setAttribute("aria-label", L("Guided journey", "Jornada guiada")); document.body.appendChild(box); }
      box.className = st.min ? "min" : "";
      box.innerHTML = "<header><span><b>" + esc(cfg.title || L("Guided journey", "Jornada guiada")) + "</b><small>" + n + " " + esc(L("of", "de")) + " " + items.length + " " + esc(L("steps done", "passos concluídos")) + '</small></span><button data-min title="' + esc(st.min ? L("Expand", "Expandir") : L("Minimise", "Minimizar")) + '">' + (st.min ? "▴" : "▾") + '</button><button data-close style="margin-left:4px" title="' + esc(L("Close", "Fechar")) + '">✕</button></header>' +
        '<div class="jg-prog"><i style="width:' + (items.length ? n / items.length * 100 : 0) + '%"></i></div>' +
        (cfg.intro && n < items.length ? '<div class="jg-intro">' + esc(cfg.intro) + "</div>" : "") +
        (n === items.length ? '<div class="jg-done">✓ ' + esc(cfg.doneText || L("All set! The structure is ready – keep the routine.", "Tudo pronto! A estrutura está montada – agora é manter a rotina.")) + "</div>" : "") +
        "<ol>" + items.map(function (x, i) {
          return '<li data-i="' + i + '" class="' + (x.done ? "ok" : "") + (i === open ? " cur" : "") + '"><span class="n">' + (x.done ? "✓" : i + 1) + '</span><span><span class="t">' + esc(x.t) + "</span>" +
            (i === open ? "<p>" + esc(x.d || "") + '</p><button class="jg-go" data-go="' + i + '">' + esc(x.done ? L("Show again", "Mostrar de novo") : L("Show me where ▸", "Mostrar onde ▸")) + "</button>" : "") + "</span></li>";
        }).join("") + "</ol>";
      box.querySelector("[data-min]").onclick = function () { st.min = !st.min; put(K, st); draw(); };
      box.querySelector("[data-close]").onclick = function () { st.hidden = 1; put(K, st); hide(); if (cfg.onClose) cfg.onClose(); };
      box.querySelectorAll("li[data-i]").forEach(function (li) { li.onclick = function (e) { if (e.target.closest("[data-go]")) return; open = Number(li.dataset.i); draw(); }; });
      box.querySelectorAll("[data-go]").forEach(function (b) { b.onclick = function () { const it = items[Number(b.dataset.go)]; st.min = 1; put(K, st); draw(); run(it.steps || [], function () { st.min = 0; put(K, st); if (cfg.refresh) items = cfg.refresh() || items; draw(); }); }; });
    }
    function hide() { if (box) { box.remove(); box = null; } }
    const api = {
      show: function () { st.hidden = 0; put(K, st); draw(); },
      hide: hide,
      update: function (list) { items = list; if (box) draw(); },
      progress: function () { return { done: items.filter(function (x) { return x.done; }).length, total: items.length }; },
      hidden: function () { return !!st.hidden; },
      seen: function () { return !!st.seen; },
      markSeen: function () { st.seen = 1; put(K, st); }
    };
    if (!st.hidden && (cfg.autoOpen || st.seen)) draw();
    return api;
  }

  window.CMTour = { run: run, stop: stop, journey: journey };
})();
