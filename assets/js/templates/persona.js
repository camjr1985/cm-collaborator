/*
 * Template: Persona Map + Priority Map (MoSCoW + RICE)
 * All coordinates are in board ("world") pixels.
 */
(function () {
  "use strict";

  const C = {
    yellow: "#FFF59D", green: "#C8EBA1", blue: "#A9D1F7", red: "#F7A8B0",
    purple: "#CDBDF6", pink: "#F6C1E4", orange: "#FFCF8A", gray: "#E6E6E6", teal: "#9FE3D3"
  };

  function zone(x, y, w, h, color, tint, hint) {
    return '<div class="zone" data-color="' + color + '" style="left:' + x + "px;top:" + y + "px;width:" + w + "px;height:" + h +
      "px;--tint:" + tint + '">' + (hint ? '<span class="zone-hint">' + hint + "</span>" : "") + "</div>";
  }
  function label(x, y, text, cls, w) {
    return '<div class="lbl ' + (cls || "") + '" style="left:' + x + "px;top:" + y + "px;" + (w ? "width:" + w + "px;" : "") + '">' + text + "</div>";
  }
  function icon(name) {
    const p = {
      family: '<circle cx="8" cy="7" r="3"/><circle cx="16" cy="7" r="3"/><path d="M2 20c0-3.5 2.7-6 6-6s6 2.5 6 6M12 20c0-3 1.8-5.5 4-5.5s6 2 6 5.5"/>',
      grad: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5"/>',
      work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 12h18"/>',
      home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
      like: '<path d="M7 11v9H3v-9zM7 11l4-8c1.5 0 2.5 1 2.5 2.5V9H19a2 2 0 0 1 2 2.3l-1.3 6.8A2 2 0 0 1 17.7 20H7"/>',
      dislike: '<path d="M7 13V4H3v9zM7 13l4 8c1.5 0 2.5-1 2.5-2.5V15H19a2 2 0 0 0 2-2.3l-1.3-6.8A2 2 0 0 0 17.7 4H7"/>',
      happy: '<circle cx="12" cy="12" r="9"/><path d="M8 14c1 1.5 2.4 2 4 2s3-.5 4-2"/><circle cx="9" cy="10" r=".8"/><circle cx="15" cy="10" r=".8"/>',
      food: '<path d="M6 3v8M4 3v5a2 2 0 0 0 4 0V3M6 11v10M17 3c-2 2-3 4-3 7h3v11"/>',
      plane: '<path d="M10 14l-6 6M3 11l6 1 6-6c1.5-1.5 4-2 5-1s.5 3.5-1 5l-6 6 1 6-3-3-1-4-4-1z"/>',
      game: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 10v5M4.5 12.5h5"/><circle cx="16" cy="11" r=".9"/><circle cx="18" cy="14" r=".9"/>',
      target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
      sprout: '<path d="M12 21v-9M12 12c0-4-3-6-7-6 0 4 3 6 7 6zM12 14c0-4 3-6 7-6 0 4-3 6-7 6z"/>'
    }[name];
    return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + p + "</svg>";
  }
  function field(x, y, w, key, k, ph) {
    return '<div class="field-row" style="left:' + x + "px;top:" + y + "px;width:" + w + 'px"><span class="k">' + k +
      '</span><span class="v" data-field="' + key + '" data-ph="' + (window.MBt ? window.MBt(ph) : ph) + '"></span></div>';
  }
  function photo(x, y, w, h, key, text, round) {
    return '<div class="photo' + (round ? " round" : "") + '" data-photo="' + key + '" style="left:' + x + "px;top:" + y + "px;width:" + w + "px;height:" + h +
      'px"><div class="photo-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3.5"/><path d="M8 5l1.5-2h5L16 5"/></svg><span>' +
      text + '</span></div><img alt=""><button class="photo-x" title="Remove photo" aria-label="Remove photo">&times;</button></div>';
  }

  let html = "";

  /* ================= PROFILE STUDY ================= */
  html += label(50, 22, "Profile Study", "board-title");
  html += '<div class="frame" style="left:40px;top:100px;width:1520px;height:1100px"></div>';

  // Left column: mentoring questions
  html += label(70, 128, "What motivated you to seek mentoring?", "q", 490);
  html += zone(70, 162, 490, 175, C.green, "#eaf7dc", "Double-click to add a post-it");
  html += label(70, 358, "Which challenges do you want to overcome with this mentoring?", "q", 490);
  html += zone(70, 412, 490, 175, C.red, "#fde7e9");
  html += label(70, 608, "What are your goals for this mentoring?", "q", 490);
  html += zone(70, 642, 490, 175, C.blue, "#e3f0fd");
  html += label(70, 850, "Knowledge to be applied", "q strong", 490);
  html += zone(70, 884, 490, 175, C.pink, "#fdeef8");
  html += '<div class="divider" style="left:590px;top:125px;height:1050px"></div>';

  // Header: photo + identity
  html += photo(630, 128, 96, 96, "avatar", "Photo", true);
  html += field(742, 132, 330, "name", "Name:", "Joaquim Ventura");
  html += field(742, 164, 330, "role", "Role:", "Your current role");
  html += field(742, 196, 330, "city", "City:", "City - Country");

  // Family
  html += label(630, 250, icon("family") + "My family", "sec");
  html += photo(630, 284, 250, 165, "family", "Add a family photo");

  // Graduation / Work / Home
  html += label(630, 510, icon("grad") + "I graduated in…", "sec");
  html += zone(630, 542, 270, 92, C.blue, "#eef6fe");
  html += label(630, 652, icon("work") + "I work at…", "sec");
  html += zone(630, 684, 270, 92, C.blue, "#eef6fe");
  html += label(630, 794, icon("home") + "I live in…", "sec");
  html += zone(630, 826, 270, 92, C.yellow, "#fffbe0");

  // Skills profile rings
  html += label(930, 128, icon("target") + "Skills Profile", "sec center", 340);
  html += '<div class="rings" style="left:930px;top:168px;width:340px;height:340px">' +
    '<div class="ring r1"></div><div class="ring r2"></div><div class="ring r3"></div>' +
    '<span class="ring-tag t1">Want to develop</span><span class="ring-tag t2">Practising</span><span class="ring-tag t3">Mastered</span></div>';
  html += '<div class="ring-legend" style="left:930px;top:516px;width:340px">Place each skill post-it on the ring that fits: centre = mastered</div>';

  // Likes / dislikes
  html += label(1300, 128, icon("like") + "I like…", "sec");
  html += zone(1300, 160, 235, 200, C.blue, "#e3f0fd");
  html += label(1300, 380, icon("dislike") + "I don't like…", "sec");
  html += zone(1300, 412, 235, 190, C.red, "#fde7e9");

  // Happiness / Food / Holidays / Hobbies
  html += label(930, 566, icon("happy") + "What makes me happy", "sec");
  html += zone(930, 598, 170, 140, C.green, "#eaf7dc");
  html += label(1120, 566, icon("food") + "Favourite food", "sec");
  html += zone(1120, 598, 150, 140, C.teal, "#e3f8f2");
  html += label(930, 756, icon("plane") + "Holidays · dream trip", "sec");
  html += zone(930, 788, 340, 130, C.orange, "#fff3e0");
  html += label(1300, 622, icon("game") + "Hobbies · favourite games", "sec");
  html += zone(1300, 654, 235, 264, C.red, "#fde7e9");

  // Personal improvement
  html += label(630, 948, icon("sprout") + "Personal improvement opportunities", "sec big", 905);
  html += zone(630, 996, 905, 180, C.green, "#eaf7dc");

  /* ================= PRIORITY MAP ================= */
  html += label(1650, 22, "Priority Map", "board-title");
  const quads = [
    ["Must Have", "Must be done no matter what. Top priority.", 1650, 110, "must"],
    ["Should Have", "Should be prioritised.", 2130, 110, "should"],
    ["Could Have", "Could be done if there is time (capacity).", 1650, 580, "could"],
    ["Won't Have", "No need to do it now.", 2130, 580, "wont"]
  ];
  quads.forEach(function (q) {
    html += label(q[2], q[3], q[0], "quad-title " + q[4]);
    html += '<div class="quad ' + q[4] + '" data-bucket="' + q[0] + '" style="left:' + q[2] + "px;top:" + (q[3] + 46) + 'px;width:450px;height:400px">' +
      '<div class="quad-desc">' + q[1] + '</div></div>';
  });

  const seeds = [
    { x: 84, y: 192, color: C.green }, { x: 84, y: 442, color: C.red }, { x: 84, y: 672, color: C.blue },
    { x: 84, y: 914, color: C.pink }, { x: 642, y: 556, w: 140, h: 66, color: C.blue },
    { x: 642, y: 698, w: 140, h: 66, color: C.blue }, { x: 642, y: 840, w: 140, h: 66, color: C.yellow },
    { x: 1315, y: 200, color: C.blue }, { x: 1315, y: 450, color: C.red }, { x: 960, y: 620, color: C.green },
    { x: 1140, y: 620, color: C.teal }, { x: 950, y: 800, color: C.orange }, { x: 1315, y: 690, color: C.red },
    { x: 1046, y: 284, w: 100, h: 100, color: C.yellow }, { x: 660, y: 1030, w: 130, h: 120, color: C.green }
  ];

  window.MB_TEMPLATES = window.MB_TEMPLATES || {};
  window.MB_TEMPLATES.persona = {
    version: "persona-v1",
    label: "Persona Map + Priority Map",
    world: { w: 2620, h: 1080 },
    colors: C,
    html: html,
    seeds: seeds,
    quadrants: quads.map(function (q) { return { name: q[0], x: q[2], y: q[3] + 46, w: 450, h: 400 }; })
  };
})();
