/* CM Collaborator – one icon set for the whole product (24×24 line icons, stroke 1.8, currentColor)
 * Usage: window.CMIcon("epic", 16) → <svg …>. window.CMPlanPreview(method) → thumbnail SVG for planning cards. */
(function () {
  "use strict";
  const P = {
    planning: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 10h18M7.5 14h4M7.5 17.2h8"/>',
    board: '<rect x="3" y="3" width="18" height="18" rx="3"/><rect x="7" y="7" width="4" height="4" rx="1"/><rect x="13" y="13" width="4" height="4" rx="1"/>',
    roadmap: '<path d="M4 3.5v17"/><rect x="7" y="5" width="9" height="3.2" rx="1.2"/><rect x="10" y="10.4" width="10" height="3.2" rx="1.2"/><rect x="7" y="15.8" width="6" height="3.2" rx="1.2"/>',
    gantt: '<rect x="3" y="3.5" width="18" height="17" rx="2.5"/><path d="M3 8.5h18"/><path d="M6.5 12h5M9.5 15h6M13 18h4"/>',
    sprint: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4.5h-4.5"/><path d="M12 8v4l2.5 2"/>',
    kanban: '<rect x="3" y="3.5" width="5" height="17" rx="1.5"/><rect x="9.5" y="3.5" width="5" height="11" rx="1.5"/><rect x="16" y="3.5" width="5" height="14" rx="1.5"/>',
    initiative: '<path d="M5 21V3.5"/><path d="M5 4h12l-2.5 4.5L17 13H5"/>',
    epic: '<path d="M13 2.5 4.5 13.5h6.5l-1 8 8.5-11h-6.5z"/>',
    phase: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 16.5 9 5 9-5"/>',
    story: '<path d="M6.5 3h11a1 1 0 0 1 1 1v17l-6.5-4.2L5.5 21V4a1 1 0 0 1 1-1z"/>',
    task: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="m8 12.2 2.8 2.8 5.2-6"/>',
    bug: '<rect x="7" y="7.5" width="10" height="13" rx="5"/><path d="M12 7.5v13M9 4.5l1.6 2.4M15 4.5l-1.6 2.4M3.5 12.5H7M17 12.5h3.5M4 18.5l3-1.8M20 18.5l-3-1.8M4 7.5l3 1.8M20 7.5l-3 1.8"/>',
    milestone: '<path d="M12 3 21 12l-9 9-9-9z"/>',
    objective: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
    kr: '<path d="M4 20h16"/><path d="m5.5 15.5 4.5-4.5 3 3 5.5-6.5"/><path d="M15 7.5h3.5V11"/>',
    settings: '<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17.5" r="2"/>',
    bell: '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.8 2H4.2z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    import: '<path d="M12 3.5v11.5M7.5 10.5 12 15l4.5-4.5"/><path d="M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    export: '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    print: '<path d="M6.5 9V3.5h11V9"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>',
    integration: '<path d="M9 7V3M15 7V3"/><path d="M6.5 7h11v3.5a5.5 5.5 0 0 1-11 0z"/><path d="M12 16v5"/>',
    pencil: '<path d="M4 20h4.2L19.5 8.7l-4.2-4.2L4 15.8z"/><path d="m13.5 6.3 4.2 4.2"/>',
    trash: '<path d="M4 7h16M9.5 7V4h5v3M6.5 7l1 13.5h9l1-13.5"/><path d="M10 11v6M14 11v6"/>',
    sync: '<path d="M20 11.5A8 8 0 0 0 5.4 7.6M4 12.5a8 8 0 0 0 14.6 3.9"/><path d="M5 3.5v4.4h4.4M19 20.5v-4.4h-4.4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
    people: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18.5 14.5a6.5 6.5 0 0 1 3 5.5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    back: '<path d="M15 5 8 12l7 7"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>',
    list: '<path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20"/><circle cx="4.5" cy="6.5" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="17.5" r="1"/>',
    send: '<path d="M21 3 10 14"/><path d="M21 3 14.5 21l-4.5-7-7-4.5z"/>'
  };
  window.CMIcon = function (name, size, cls) {
    const s = size || 18;
    return '<svg class="cm-ic' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || P.task) + "</svg>";
  };
  /* card thumbnails for planning methods (same 16:10 box as board template previews) */
  window.CMPlanPreview = function (m) {
    const bg = '<rect width="160" height="100" rx="6" fill="#f7f8fb"/>';
    let g = "";
    if (m === "waterfall") {
      g = '<rect x="8" y="10" width="144" height="8" rx="2" fill="#e3e7ef"/>' +
        [[12, 26, 36, "#0e1a33"], [44, 38, 30, "#2f80ed"], [70, 50, 34, "#2f80ed"], [98, 62, 28, "#2f80ed"], [120, 74, 30, "#2f80ed"]].map(function (b) { return '<rect x="' + b[0] + '" y="' + b[1] + '" width="' + b[2] + '" height="7" rx="2" fill="' + b[3] + '" opacity=".85"/>'; }).join("") +
        '<path d="M48 33v5M74 45v5M102 57v5M124 69v5" stroke="#8a94a6" stroke-width="1.2"/><path d="M150 84l5 5-5 5-5-5z" fill="#e8a400"/>';
    } else if (m === "scrum") {
      g = '<rect x="8" y="10" width="144" height="22" rx="4" fill="#fff" stroke="#e3e7ef"/><text x="14" y="24" font-size="8" font-family="Inter,sans-serif" font-weight="700" fill="#4a5468">Sprint 1</text><rect x="118" y="15" width="28" height="10" rx="5" fill="#e8c468"/>' +
        [40, 54, 68, 82].map(function (y, i) { return '<rect x="8" y="' + y + '" width="144" height="10" rx="3" fill="#fff" stroke="#e3e7ef"/><rect x="13" y="' + (y + 3) + '" width="' + (60 + i * 12) + '" height="4" rx="2" fill="#c9d1e0"/><circle cx="144" cy="' + (y + 5) + '" r="3" fill="' + ["#36b37e", "#2f80ed", "#8a94a6", "#2f80ed"][i] + '"/>'; }).join("");
    } else if (m === "kanban") {
      g = [8, 46, 84, 122].map(function (x, i) { return '<rect x="' + x + '" y="10" width="32" height="80" rx="4" fill="#eef1f6"/>' + [0, 1, 2].slice(0, [3, 2, 1, 2][i]).map(function (k) { return '<rect x="' + (x + 3) + '" y="' + (18 + k * 18) + '" width="26" height="14" rx="2.5" fill="#fff"/><rect x="' + (x + 6) + '" y="' + (22 + k * 18) + '" width="16" height="3" rx="1.5" fill="#c9d1e0"/>'; }).join(""); }).join("");
    } else {
      g = '<path d="M14 8v84" stroke="#e3e7ef" stroke-width="1.5"/>' +
        [[18, 14, 70, "#c2410c"], [22, 30, 56, "#7c5cff"], [62, 46, 70, "#7c5cff"], [30, 62, 34, "#36b37e"], [70, 76, 40, "#2f80ed"]].map(function (b) { return '<rect x="' + b[0] + '" y="' + b[1] + '" width="' + b[2] + '" height="9" rx="3" fill="' + b[3] + '" opacity=".8"/>'; }).join("") +
        '<path d="M140 10l5 5-5 5-5-5z" fill="#e8a400"/><path d="M58 8v84" stroke="#e8c468" stroke-width="1.5"/>';
    }
    return '<svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' + bg + g + "</svg>";
  };
})();
