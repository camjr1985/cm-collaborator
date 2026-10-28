/* Templates: MoSCoW priority map, and Blank board */
(function () {
  "use strict";
  window.MB_TEMPLATES = window.MB_TEMPLATES || {};
  function label(x, y, text, cls) { return '<div class="lbl ' + (cls || "") + '" style="left:' + x + "px;top:" + y + 'px">' + text + "</div>"; }

  let html = label(40, 22, "Priority Map", "board-title");
  const quads = [
    ["Must Have", "Must be done no matter what. Top priority.", 40, 110, "must"],
    ["Should Have", "Should be prioritised.", 620, 110, "should"],
    ["Could Have", "Could be done if there is time (capacity).", 40, 640, "could"],
    ["Won't Have", "No need to do it now.", 620, 640, "wont"]
  ];
  quads.forEach(function (q) {
    html += label(q[2], q[3], q[0], "quad-title " + q[4]);
    html += '<div class="quad ' + q[4] + '" data-bucket="' + q[0] + '" style="left:' + q[2] + "px;top:" + (q[3] + 46) + 'px;width:550px;height:460px"><div class="quad-desc">' + q[1] + "</div></div>";
  });
  window.MB_TEMPLATES.moscow = {
    version: "moscow-v1", label: "MoSCoW priority map", world: { w: 1210, h: 1150 }, html: html, seeds: [],
    quadrants: quads.map(function (q) { return { name: q[0], x: q[2], y: q[3] + 46, w: 550, h: 460 }; })
  };
  window.MB_TEMPLATES.blank = {
    version: "blank-v1", label: "Blank board", world: { w: 1600, h: 1000 }, html: "", seeds: [], quadrants: []
  };
})();
