/* CM Collaborator – dashboard appearance per planning: colour theme (presets + custom) and logos
 * (company, project, client, supplier). Used by the Portfolio, Reports, Service and Indicators views and the A4 PDF.
 * Stored in planning/<id>/data/settings/brand = { theme, colors{bg,card,ink,ink2,line,head,doing,blocked,backlog,l1,l2,l3}, eyebrow, logos{company|project|client|vendor: {img,label}} } */
(function () {
  "use strict";
  const PT = window.MB_LANG === "pt";
  const L = function (en, pt) { return window.MBL ? window.MBL(en, pt) : (PT ? pt : en); };
  const IC = function (n, sz) { return window.CMIcon ? window.CMIcon(n, sz || 15) : ""; };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  /* status palettes checked with the dataviz validator on each theme's card surface */
  const PRESETS = {
    light: { name: function () { return L("Light (default)", "Claro (padrão)"); }, dark: false, bg: "#f6f7fb", card: "#ffffff", ink: "#172036", ink2: "#4a5468", line: "#e3e7ef", head: "#16335c", tile: "#eef3fa", doing: "#2563eb", blocked: "#d1344a", backlog: "#e8a020", l1: "#1e3a6e", l2: "#4f7fc0", l3: "#a9bfdf" },
    dark: { name: function () { return L("Dark executive", "Escuro executivo"); }, dark: true, bg: "#151b26", card: "#1f2735", ink: "#f1f5f9", ink2: "#a7b1c2", line: "#334155", head: "#0f1622", tile: "#1a2230", doing: "#3b82f6", blocked: "#ef4444", backlog: "#d98a0b", l1: "#1d4ed8", l2: "#4f8fe8", l3: "#93c5fd" },
    navy: { name: function () { return L("Navy (CM brand)", "Marinho (marca CM)"); }, dark: true, bg: "#0e1a33", card: "#16264a", ink: "#f4f6fb", ink2: "#b4c0d6", line: "#2a3d66", head: "#0b1530", tile: "#122042", doing: "#1fa89a", blocked: "#e5484d", backlog: "#bf8f24", l1: "#2cc4b3", l2: "#7fd9cf", l3: "#c9efea" },
    green: { name: function () { return L("Light green", "Verde claro"); }, dark: false, bg: "#f4f8f6", card: "#ffffff", ink: "#13261d", ink2: "#46594f", line: "#dfe8e3", head: "#14532d", tile: "#e9f3ee", doing: "#2563eb", blocked: "#d1344a", backlog: "#e8a020", l1: "#14532d", l2: "#2f855a", l3: "#9ad3b3" }
  };
  const SLOTS = [["company", L("Company", "Empresa")], ["project", L("Project", "Projeto")], ["client", L("Client", "Cliente")], ["vendor", L("Supplier", "Fornecedor")]];
  const KEYS = [["bg", L("Background", "Fundo")], ["card", L("Cards", "Cartões")], ["ink", L("Text", "Texto")], ["ink2", L("Secondary text", "Texto secundário")], ["line", L("Lines", "Linhas")], ["head", L("Table header", "Cabeçalho das tabelas")],
    ["doing", L("In progress", "Processando")], ["blocked", L("Blocked", "Bloqueado")], ["backlog", "Backlog"], ["l1", L("Strategic", "Estratégico")], ["l2", L("Tactical", "Tático")], ["l3", L("Operational", "Operacional")]];

  function lum(hex) { const h = String(hex || "#000").replace("#", ""); const v = [0, 2, 4].map(function (i) { const c = parseInt(h.substr(i, 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; }
  function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function inkOn(bg) { return contrast(bg, "#ffffff") >= contrast(bg, "#111827") ? "#ffffff" : "#111827"; }
  function get(settings) {
    const b = (settings && settings.brand) || {}, p = PRESETS[b.theme] || PRESETS.light, c = Object.assign({}, p, b.theme === "custom" ? {} : {}, b.colors || {});
    if (b.theme === "custom" && b.base && PRESETS[b.base]) Object.keys(PRESETS[b.base]).forEach(function (k) { if (!(b.colors || {})[k]) c[k] = PRESETS[b.base][k]; });
    c.dark = lum(c.bg) < 0.2; c.headInk = inkOn(c.head);
    return { c: c, logos: b.logos || {}, eyebrow: b.eyebrow || "", theme: b.theme || "light", set: !!(settings && settings.brand) };
  }
  function vars(B) {
    const c = B.c;
    return "--br-bg:" + c.bg + ";--br-card:" + c.card + ";--br-ink:" + c.ink + ";--br-ink2:" + c.ink2 + ";--br-line:" + c.line + ";--br-head:" + c.head + ";--br-head-ink:" + c.headInk + ";--br-tile:" + c.tile + ";--br-doing:" + c.doing + ";--br-blocked:" + c.blocked + ";--br-backlog:" + c.backlog;
  }
  function logosHtml(B, cls) {
    const ls = SLOTS.filter(function (s) { return B.logos[s[0]] && B.logos[s[0]].img; });
    if (!ls.length && !B.eyebrow) return "";
    return '<div class="' + (cls || "br-strip") + '">' + (B.eyebrow ? '<span class="br-eyebrow">' + esc(B.eyebrow) + "</span>" : "<span></span>") + '<span class="br-logos">' + ls.map(function (s) { const l = B.logos[s[0]]; return '<img src="' + esc(l.img) + '" alt="' + esc(l.label || s[1]) + '" title="' + esc((l.label || s[1])) + '">'; }).join("") + "</span></div>";
  }
  /* applies the theme to an analytic view container and adds the logo strip */
  function apply(v, settings, view) {
    const B = get(settings), on = B.set && ["portfolio", "reports", "service", "kpi", "budget"].indexOf(view) >= 0;
    v.classList.toggle("br-on", on); v.classList.toggle("br-dark", on && B.c.dark);
    if (!on) { v.removeAttribute("style"); return; }
    v.setAttribute("style", vars(B));
    const strip = function () { if (view === "portfolio" || !v.classList.contains("br-on")) return; const r = v.querySelector(".rp"); if (r && !r.querySelector(":scope > .br-strip")) { const h = logosHtml(B); if (h) r.insertAdjacentHTML("afterbegin", h); } };
    strip();
    if (v._brObs) v._brObs.disconnect();
    if (window.MutationObserver) { v._brObs = new MutationObserver(function () { v._brObs.disconnect(); strip(); v._brObs.observe(v, { childList: true }); }); v._brObs.observe(v, { childList: true }); }
  }
  function shrink(file) { /* logo → PNG data URL, at most 480×160 */
    return new Promise(function (res, rej) {
      if (file.size > 2 * 1024 * 1024) return rej(new Error(L("Image too large (max. 2 MB).", "Imagem grande demais (máx. 2 MB).")));
      const r = new FileReader();
      r.onload = function () {
        if (/svg/.test(file.type)) return r.result.length < 160000 ? res(r.result) : rej(new Error(L("SVG too large.", "SVG grande demais.")));
        const im = new Image(); im.onload = function () {
          const k = Math.min(1, 480 / im.width, 160 / im.height), cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(im.width * k)); cv.height = Math.max(1, Math.round(im.height * k));
          cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height); res(cv.toDataURL("image/png"));
        }; im.onerror = function () { rej(new Error(L("Could not read the image.", "Não foi possível ler a imagem."))); }; im.src = r.result;
      };
      r.readAsDataURL(file);
    });
  }
  function dialog(api) {
    const s = api.data().settings || {}, cur = s.brand || {}, ed = api.canEdit();
    const st = { theme: cur.theme || "light", colors: Object.assign({}, cur.colors || {}), logos: JSON.parse(JSON.stringify(cur.logos || {})), eyebrow: cur.eyebrow || "" };
    function eff() { const p = PRESETS[st.theme] || PRESETS[st.base || "light"] || PRESETS.light; return Object.assign({}, p, st.colors); }
    api.modal("<h2>" + IC("settings", 18) + " " + L("Dashboard appearance", "Aparência dos painéis") + '</h2><p class="muted small">' + L("Colour theme and logos for the Portfolio, Reports and Service dashboards and the A4 PDF of this planning.", "Tema de cores e logos dos painéis Portfólio, Relatórios e Serviço e do PDF A4 deste planejamento.") + "</p>" +
      '<form class="pl-form br-form" id="brF"><label>' + L("Theme", "Tema") + '<select name="theme"' + (ed ? "" : " disabled") + ">" + Object.keys(PRESETS).map(function (k) { return '<option value="' + k + '"' + (st.theme === k ? " selected" : "") + ">" + esc(PRESETS[k].name()) + "</option>"; }).join("") + '<option value="custom"' + (st.theme === "custom" ? " selected" : "") + ">" + L("Custom", "Personalizado") + "</option></select></label>" +
      '<div class="br-colors" id="brC"></div><p class="d-err" id="brWarn" hidden></p>' +
      "<label>" + L("Line above the title (project / client name)", "Linha acima do título (nome do projeto / cliente)") + '<input name="eyebrow" maxlength="80" value="' + esc(st.eyebrow) + '" placeholder="' + L("e.g. DHR · Datahub Renewables Maintenance", "ex.: DHR · Datahub Renewables Maintenance") + '"' + (ed ? "" : " disabled") + "></label>" +
      "<h3>" + L("Logos", "Logos") + '</h3><div class="br-slots">' + SLOTS.map(function (sl) { const l = st.logos[sl[0]] || {}; return '<div class="br-slot" data-slot="' + sl[0] + '"><b>' + esc(sl[1]) + '</b><div class="br-img">' + (l.img ? '<img src="' + esc(l.img) + '" alt="">' : '<span class="muted small">' + L("No logo", "Sem logo") + "</span>") + "</div>" +
        '<input name="lb_' + sl[0] + '" placeholder="' + L("Name (optional)", "Nome (opcional)") + '" value="' + esc(l.label || "") + '"' + (ed ? "" : " disabled") + ">" + (ed ? '<div class="br-acts"><label class="pl-btn sm">' + IC("upload", 13) + " " + L("Choose", "Escolher") + '<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden data-up="' + sl[0] + '"></label><button type="button" class="pl-btn sm" data-rm="' + sl[0] + '">' + L("Remove", "Remover") + "</button></div>" : "") + "</div>"; }).join("") + "</div>" +
      '<h3>' + L("Preview", "Prévia") + '</h3><div id="brPrev" class="br-prev"></div>' +
      '<div class="pl-row-end">' + (ed && cur.theme ? '<button type="button" class="pl-btn" id="brReset">' + L("Back to default", "Voltar ao padrão") + "</button>" : "") + '<button type="button" class="pl-btn" data-close>' + L("Cancel", "Cancelar") + "</button>" + (ed ? '<button class="pl-btn primary">' + L("Save", "Salvar") + "</button>" : "") + "</div></form>", function (box, close) {
      const f = box.querySelector("#brF");
      function paint() {
        const c = eff();
        box.querySelector("#brC").innerHTML = KEYS.map(function (k) { return '<label class="br-c"><input type="color" data-k="' + k[0] + '" value="' + c[k[0]] + '"' + (ed ? "" : " disabled") + "><span>" + esc(k[1]) + "</span></label>"; }).join("");
        box.querySelectorAll("[data-k]").forEach(function (i) { i.oninput = function () { if (st.theme !== "custom") { st.base = st.theme; st.colors = Object.assign({}, PRESETS[st.theme] || {}, st.colors); delete st.colors.name; delete st.colors.dark; st.theme = "custom"; f.theme.value = "custom"; } st.colors[i.dataset.k] = i.value; prev(); }; });
        prev();
      }
      function prev() {
        const c = eff(), B = { c: Object.assign({}, c, { headInk: inkOn(c.head) }), logos: st.logos, eyebrow: f.eyebrow.value };
        const seg = function (col, n, w) { return '<span style="width:' + w + "%;background:" + col + ";color:" + inkOn(col) + '">' + n + "</span>"; };
        box.querySelector("#brPrev").innerHTML = '<div class="br-pv" style="background:' + c.bg + ";color:" + c.ink + '">' + logosHtml(B) + '<b style="font-size:var(--fs-16)">' + L("Executive portfolio", "Portfólio executivo") + '</b><div class="br-pvt" style="background:' + c.tile + '"><span style="color:' + c.doing + '">32</span><span style="color:' + c.blocked + '">31</span><span style="color:' + c.backlog + '">31</span></div>' +
          '<div class="br-pvc" style="background:' + c.card + ";border-color:" + c.line + '"><div class="br-pvb">' + seg(c.doing, 9, 38) + seg(c.blocked, 13, 54) + seg(c.backlog, 2, 8) + '</div><div class="br-pvb">' + seg(c.l1, 5, 21) + seg(c.l2, 4, 17) + seg(c.l3, 15, 62) + '</div><div class="br-pvh" style="background:' + c.head + ";color:" + inkOn(c.head) + '">' + L("Island", "Ilha") + " · Total</div><div style=\"color:" + c.ink2 + ';font-size:var(--fs-12)">Sistemas · 24</div></div></div>';
        const w = [], cr = contrast(c.ink, c.card), cr2 = contrast(c.ink2, c.card);
        if (cr < 4.5) w.push(L("Text on cards has low contrast (", "O texto sobre os cartões tem pouco contraste (") + cr.toFixed(1) + ":1)");
        if (cr2 < 3) w.push(L("Secondary text has low contrast (", "O texto secundário tem pouco contraste (") + cr2.toFixed(1) + ":1)");
        ["doing", "blocked", "backlog"].forEach(function (k, i, a) { if (i && contrast(c[k], c[a[i - 1]]) < 1.15 && Math.abs(parseInt(c[k].slice(1), 16) - parseInt(c[a[i - 1]].slice(1), 16)) < 0x202020) w.push(L("Two situation colours are too similar.", "Duas cores de situação estão parecidas demais.")); });
        const wb = box.querySelector("#brWarn"); wb.hidden = !w.length; wb.textContent = w.join(" · ");
      }
      f.theme.onchange = function () { st.theme = f.theme.value; if (st.theme !== "custom") { st.colors = {}; delete st.base; } paint(); };
      f.eyebrow.oninput = prev;
      box.querySelectorAll("[data-up]").forEach(function (inp) { inp.onchange = function () { const fl = inp.files[0]; if (!fl) return; const k = inp.dataset.up; shrink(fl).then(function (url) { st.logos[k] = Object.assign({}, st.logos[k] || {}, { img: url }); box.querySelector('[data-slot="' + k + '"] .br-img').innerHTML = '<img src="' + esc(url) + '" alt="">'; prev(); }, function (e) { api.toast(e.message); }); }; });
      box.querySelectorAll("[data-rm]").forEach(function (b) { b.onclick = function () { const k = b.dataset.rm; delete st.logos[k]; box.querySelector('[data-slot="' + k + '"] .br-img').innerHTML = '<span class="muted small">' + L("No logo", "Sem logo") + "</span>"; prev(); }; });
      const rs = box.querySelector("#brReset"); if (rs) rs.onclick = function () { api.db.ref("planning/" + api.ID + "/data/settings/brand").remove().then(function () { close(); api.toast(L("Default appearance restored", "Aparência padrão restaurada")); }, api.fail); };
      f.onsubmit = function (e) {
        e.preventDefault(); if (!ed) return;
        const logos = {}; SLOTS.forEach(function (sl) { const l = st.logos[sl[0]], lb = f["lb_" + sl[0]].value.trim(); if (l && l.img) logos[sl[0]] = { img: l.img, label: lb || null }; });
        const colors = {}; if (st.theme === "custom") { const c = eff(); KEYS.forEach(function (k) { colors[k[0]] = c[k[0]]; }); colors.tile = c.tile; }
        const val = { theme: st.theme, colors: st.theme === "custom" ? colors : null, logos: Object.keys(logos).length ? logos : null, eyebrow: f.eyebrow.value.trim() || null, at: Date.now(), by: api.me.email };
        api.db.ref("planning/" + api.ID + "/data/settings/brand").set(val).then(function () { close(); api.toast(L("Appearance saved", "Aparência salva")); }, api.fail);
      };
      paint();
    });
  }
  window.CMBrand = { get: get, apply: apply, dialog: dialog, logosHtml: logosHtml, inkOn: inkOn, contrast: contrast, PRESETS: PRESETS };
})();
