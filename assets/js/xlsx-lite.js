/* CM Collaborator – minimal .xlsx reader (no dependencies).
   Reads the zip with DecompressionStream("deflate-raw") and the sheet XML with DOMParser.
   API: XLSXLite.read(arrayBuffer) -> Promise<{ SheetNames: [...], rows(name) -> [{header: value}] }>
   Values: numbers as numbers, everything else as trimmed strings. Dates come as Excel serial numbers. */
(function () {
  "use strict";
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216; }
  function inflate(bytes) {
    if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("Este navegador não lê arquivos Excel. Atualize o navegador."));
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }
  function unzip(buf) {
    const b = new Uint8Array(buf);
    let eo = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) { if (u32(b, i) === 0x06054b50) { eo = i; break; } }
    if (eo < 0) throw new Error("O arquivo não é uma planilha .xlsx válida.");
    const n = u16(b, eo + 10); let p = u32(b, eo + 16); const files = {};
    for (let i = 0; i < n; i++) {
      if (u32(b, p) !== 0x02014b50) break;
      const method = u16(b, p + 10), csize = u32(b, p + 20), nl = u16(b, p + 28), xl = u16(b, p + 30), cl = u16(b, p + 32), lo = u32(b, p + 42);
      const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl));
      files[name] = { method: method, csize: csize, lo: lo };
      p += 46 + nl + xl + cl;
    }
    return {
      has: function (name) { return !!files[name]; },
      text: function (name) {
        const f = files[name]; if (!f) return Promise.resolve(null);
        const ds = f.lo + 30 + u16(b, f.lo + 26) + u16(b, f.lo + 28), raw = b.subarray(ds, ds + f.csize);
        if (f.csize > 30 * 1024 * 1024) return Promise.reject(new Error("Planilha grande demais."));
        return (f.method === 0 ? Promise.resolve(raw) : f.method === 8 ? inflate(raw) : Promise.reject(new Error("Compressão não suportada.")))
          .then(function (x) { return new TextDecoder().decode(x); });
      }
    };
  }
  function xml(t) { return new DOMParser().parseFromString(t, "application/xml"); }
  function els(node, tag) { return Array.prototype.filter.call(node.getElementsByTagName("*"), function (e) { return e.localName === tag; }); }
  function kids(node, tag) { return Array.prototype.filter.call(node.childNodes, function (e) { return e.nodeType === 1 && e.localName === tag; }); }
  function colIdx(ref) { const m = /^([A-Z]+)/.exec(ref || ""); if (!m) return -1; let n = 0; for (let i = 0; i < m[1].length; i++) n = n * 26 + m[1].charCodeAt(i) - 64; return n - 1; }
  function read(buf) {
    let z;
    try { z = unzip(buf); } catch (e) { return Promise.reject(e); }
    return Promise.all([z.text("xl/workbook.xml"), z.text("xl/_rels/workbook.xml.rels"), z.text("xl/sharedStrings.xml")]).then(function (r) {
      if (!r[0]) throw new Error("O arquivo não é uma planilha .xlsx válida.");
      const rel = {}; if (r[1]) els(xml(r[1]), "Relationship").forEach(function (e) { rel[e.getAttribute("Id")] = e.getAttribute("Target"); });
      const ss = r[2] ? els(xml(r[2]), "si").map(function (si) { return els(si, "t").map(function (t) { return t.textContent; }).join(""); }) : [];
      const sheets = els(xml(r[0]), "sheet").map(function (s) {
        const rid = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
        let t = rel[rid] || ""; t = t.charAt(0) === "/" ? t.slice(1) : "xl/" + t.replace(/^\.\//, "");
        return { name: s.getAttribute("name"), path: t };
      });
      return Promise.all(sheets.map(function (s) { return z.text(s.path); })).then(function (txts) {
        const grids = {};
        sheets.forEach(function (s, i) {
          const g = []; if (!txts[i]) { grids[s.name] = g; return; }
          els(xml(txts[i]), "row").forEach(function (row) {
            const line = []; let next = 0;
            kids(row, "c").forEach(function (c) {
              let ci = colIdx(c.getAttribute("r")); if (ci < 0) ci = next; next = ci + 1;
              if (ci > 200) return;
              const t = c.getAttribute("t"), v = kids(c, "v")[0], is = kids(c, "is")[0];
              let val = "";
              if (t === "s" && v) val = ss[Number(v.textContent)] || "";
              else if (t === "inlineStr" && is) val = els(is, "t").map(function (x) { return x.textContent; }).join("");
              else if (t === "b" && v) val = v.textContent === "1";
              else if (v) { const n = Number(v.textContent); val = t === "str" || t === "e" || !isFinite(n) ? v.textContent : n; }
              line[ci] = typeof val === "string" ? val.trim() : val;
            });
            g.push(line);
            if (g.length > 5000) return;
          });
          grids[s.name] = g;
        });
        return {
          SheetNames: sheets.map(function (s) { return s.name; }),
          rows: function (name) {
            const g = grids[name] || []; let h = 0;
            while (h < g.length && !(g[h] || []).some(function (x) { return x !== "" && x != null; })) h++;
            const head = (g[h] || []).map(function (x) { return x == null ? "" : String(x); });
            const out = [];
            for (let i = h + 1; i < g.length; i++) {
              const o = {}; let any = false;
              head.forEach(function (k, j) { if (!k) return; const v = (g[i] || [])[j]; o[k] = v == null ? "" : v; if (o[k] !== "") any = true; });
              o.__line = i + 1;
              if (any) out.push(o);
            }
            return out;
          }
        };
      });
    });
  }
  window.XLSXLite = { read: read };
})();
