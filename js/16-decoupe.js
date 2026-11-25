"use strict";

  var FIG_CLEAN_SCHEMA = { type: "object", properties: {
    foreign: { type: "array", description: "Zones à effacer. Vide si l'image ne contient que le visuel.", items: { type: "object", properties: {
      what: { type: "string", description: "Le texte ou l'élément exact, recopié." }, box: { type: "array", items: { type: "integer" }, description: "[ymin, xmin, ymax, xmax] sur 0-1000 : serré autour de cet élément seulement." }
    }, required: ["what", "box"] } }
  }, required: ["foreign"] };
  var FIG_CLEAN_CHECK_SCHEMA = { type: "object", properties: { lost: { type: "string", description: "Ce qui appartient au visuel et a disparu ou a été abîmé dans la 2e image. Vide si rien." }, ok: { type: "boolean" } }, required: ["lost", "ok"] };
  function buildFigureCleanPrompt(caption) {
    return "Cette image est la découpe rectangulaire d'un visuel de document scolaire : « " + caption + " ». Un visuel n'est pas toujours rectangulaire : du texte voisin peut être resté dans un coin, une marge ou une encoche.\n" +
      FIGURE_SCOPE_RULE + "\n" +
      "Liste dans \"foreign\" CHAQUE morceau étranger : questions, consignes, lignes ou fins de mots du texte voisin (même deux lettres, une virgule ou une ligne coupée par le bord), bout d'un autre schéma, trait d'un cadre voisin. Une zone par bloc, serrée.\n" +
      "Ne liste JAMAIS ce qui appartient au visuel : dessin, points, noms, lettres et valeurs des points, flèches, axes, graduations, légende, titre propre, cadre propre, et le texte du document situé DANS le cadre du visuel (données, description) quand il en fait partie. Dans le doute, ne liste pas.\n\nRéponds uniquement en respectant le schéma JSON.";
  }
  function figCanvasInk(canvas) {
    var w = canvas.width, h = canvas.height, data = canvas.getContext("2d").getImageData(0, 0, w, h), d = data.data, hist = {}, n = 0, i, k;
    for (i = 0; i < d.length; i += 4 * 7) { k = (d[i] >> 3) + "," + (d[i + 1] >> 3) + "," + (d[i + 2] >> 3); hist[k] = (hist[k] || 0) + 1; n++; }
    var top = Object.keys(hist).sort(function (a, b) { return hist[b] - hist[a]; })[0], p = top.split(",").map(Number), sum = [0, 0, 0], c = 0;
    for (i = 0; i < d.length; i += 4 * 7) if (Math.abs((d[i] >> 3) - p[0]) <= 1 && Math.abs((d[i + 1] >> 3) - p[1]) <= 1 && Math.abs((d[i + 2] >> 3) - p[2]) <= 1) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; c++; }
    var bg = sum.map(function (s) { return Math.round(s / Math.max(1, c)); }), ink = new Uint8Array(w * h);
    for (i = 0; i < w * h; i++) ink[i] = Math.max(Math.abs(d[i * 4] - bg[0]), Math.abs(d[i * 4 + 1] - bg[1]), Math.abs(d[i * 4 + 2] - bg[2])) > 42 ? 1 : 0;
    return { w: w, h: h, data: data, bg: bg, share: c / Math.max(1, n), ink: ink };
  }
  function figComponents(I) {
    var w = I.w, h = I.h, lab = new Int32Array(w * h), comps = [null], st = new Int32Array(w * h), n = 0;
    for (var s = 0; s < w * h; s++) {
      if (!I.ink[s] || lab[s]) continue;
      var id = ++n, sp = 0, c = { n: 0, x0: w, x1: 0, y0: h, y1: 0 }; st[sp++] = s; lab[s] = id;
      while (sp) {
        var q = st[--sp], x = q % w, y = (q - x) / w; c.n++;
        if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; var r = Y * w + X; if (I.ink[r] && !lab[r]) { lab[r] = id; st[sp++] = r; } }
      }
      comps.push(c);
    }
    return { lab: lab, comps: comps };
  }
  function figErase(canvas, boxes) {
    var I = figCanvasInk(canvas), w = I.w, h = I.h;
    if (I.share < 0.3 || w * h > 12e6) return null;
    var C = figComponents(I), inside = new Float64Array(C.comps.length), m = new Uint8Array(w * h), pad = Math.max(3, Math.min(w, h) * 0.012);
    boxes.forEach(function (b) {
      var x0 = Math.max(0, Math.floor(b[1] / 1000 * w - pad)), x1 = Math.min(w - 1, Math.ceil(b[3] / 1000 * w + pad)), y0 = Math.max(0, Math.floor(b[0] / 1000 * h - pad)), y1 = Math.min(h - 1, Math.ceil(b[2] / 1000 * h + pad));
      for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) m[y * w + x] = 1;
    });
    for (var i = 0; i < w * h; i++) if (C.lab[i] && m[i]) inside[C.lab[i]]++;
    var kill = C.comps.map(function (c, k) { return !!c && inside[k] >= 0.85 * c.n && (c.x1 - c.x0) * (c.y1 - c.y0) < 0.5 * w * h; }), inkN = 0, killN = 0;
    C.comps.forEach(function (c, k) { if (c) { inkN += c.n; if (kill[k]) killN += c.n; } });
    if (!killN || killN > 0.75 * inkN) return null;
    var dirty = new Uint8Array(w * h), R = 6, d = I.data.data;
    for (i = 0; i < w * h; i++) if (kill[C.lab[i]] && C.lab[i]) { var x = i % w, y = (i - x) / w; for (var dy = -R; dy <= R; dy++) for (var dx = -R; dx <= R; dx++) { var X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h) dirty[Y * w + X] = 1; } }
    for (i = 0; i < w * h; i++) if (dirty[i] && !(C.lab[i] && !kill[C.lab[i]])) { d[i * 4] = I.bg[0]; d[i * 4 + 1] = I.bg[1]; d[i * 4 + 2] = I.bg[2]; }
    var bx0 = w, bx1 = 0, by0 = h, by1 = 0;
    C.comps.forEach(function (c, k) { if (!c || kill[k] || c.n < 6) return; bx0 = Math.min(bx0, c.x0); bx1 = Math.max(bx1, c.x1); by0 = Math.min(by0, c.y0); by1 = Math.max(by1, c.y1); });
    if (bx1 <= bx0 || by1 <= by0) return null;
    var full = document.createElement("canvas"); full.width = w; full.height = h; full.getContext("2d").putImageData(I.data, 0, 0);
    var mg = Math.max(8, Math.round(Math.min(w, h) * 0.02)); bx0 = Math.max(0, bx0 - mg); by0 = Math.max(0, by0 - mg); bx1 = Math.min(w, bx1 + mg); by1 = Math.min(h, by1 + mg);
    var out = document.createElement("canvas"); out.width = bx1 - bx0; out.height = by1 - by0;
    var g = out.getContext("2d"); g.drawImage(full, -bx0, -by0);
    return { canvas: out, full: full, x: bx0, y: by0 };
  }
  async function figureCleanCanvas(canvas, caption) {
    var before = canvas.toDataURL("image/jpeg", 0.9), cur = canvas, off = { x: 0, y: 0 }, changed = false;
    for (var round = 0; round < 2; round++) {
      var r = null;
      try { r = await callGemini(geminiImageParts([cur.toDataURL("image/jpeg", 0.9)]).concat([{ text: buildFigureCleanPrompt(caption) }]), FIG_CLEAN_SCHEMA); } catch (e) { break; }
      var boxes = (r && r.foreign || []).map(function (f) { return f && f.box; }).filter(isValidFigureBox);
      if (!boxes.length) break;
      var res = figErase(cur, boxes); if (!res) break;
      cur = res.canvas; off.x += res.x; off.y += res.y; changed = true;
    }
    if (!changed) return null;
    try {
      var v = await callGemini([{ text: "Image 1 : avant nettoyage." }].concat(geminiImageParts([before]), [{ text: "Image 2 : après nettoyage." }], geminiImageParts([cur.toDataURL("image/jpeg", 0.9)]), [{ text: "On a voulu retirer de la découpe le texte voisin qui n'appartient pas au visuel « " + caption + " ».\n" + FIGURE_SCOPE_RULE + "\nCompare : est-ce qu'une partie du visuel lui-même (trait, point, nom, valeur, flèche, légende, cadre, données du document) a disparu ou a été abîmée ? Retirer des questions ou du texte voisin est voulu et n'est pas une perte. ok = true si rien du visuel n'est perdu." }]), FIG_CLEAN_CHECK_SCHEMA);
      if (!v || !v.ok) return null;
    } catch (e) { return null; }
    return { canvas: cur, x: off.x, y: off.y };
  }
  function figEdgeHits(canvas) {
    var I = figCanvasInk(canvas), w = I.w, h = I.h, e = { top: 0, bottom: 0, left: 0, right: 0 }, i;
    if (I.share < 0.3) return null;
    var B = Math.max(4, Math.round(Math.min(w, h) * 0.015)), b, hit;
    for (i = 0; i < w; i++) { for (b = 0, hit = 0; b < B; b++) if (I.ink[b * w + i]) hit = 1; e.top += hit; for (b = 1, hit = 0; b <= B; b++) if (I.ink[(h - b) * w + i]) hit = 1; e.bottom += hit; }
    for (i = 0; i < h; i++) { for (b = 0, hit = 0; b < B; b++) if (I.ink[i * w + b]) hit = 1; e.left += hit; for (b = 1, hit = 0; b <= B; b++) if (I.ink[i * w + w - b]) hit = 1; e.right += hit; }
    return { top: e.top / w, bottom: e.bottom / w, left: e.left / h, right: e.right / h };
  }
  async function figureFinish(source, res, caption) {
    if (!res) return res;
    try {
      var box = { x: res.box.x, y: res.box.y, w: res.box.w, h: res.box.h }, o = res.box, canvas = await source.renderCanvas(box.x, box.y, box.w, box.h), lim = 0.12;
      for (var k = 0; k < 8; k++) {
        var e = figEdgeHits(canvas); if (!e) break;
        var sx = Math.max(6, o.w * 0.015), sy = Math.max(6, o.h * 0.015), g = { x: box.x, y: box.y, w: box.w, h: box.h }, moved = false, cut = function (v) { return v > 0 && v < 0.5; };
        if (cut(e.left) && box.x > 0 && o.x - box.x < lim * o.w) { g.x -= sx; g.w += sx; moved = true; }
        if (cut(e.right) && box.x + box.w < source.w && box.x + box.w - o.x - o.w < lim * o.w) { g.w += sx; moved = true; }
        if (cut(e.top) && box.y > 0 && o.y - box.y < lim * o.h) { g.y -= sy; g.h += sy; moved = true; }
        if (cut(e.bottom) && box.y + box.h < source.h && box.y + box.h - o.y - o.h < lim * o.h) { g.h += sy; moved = true; }
        if (!moved) break;
        var nx = Math.max(0, g.x), ny = Math.max(0, g.y);
        box = { x: nx, y: ny, w: Math.min(source.w, g.x + g.w) - nx, h: Math.min(source.h, g.y + g.h) - ny };
        canvas = await source.renderCanvas(box.x, box.y, box.w, box.h);
      }
      var c = await figureCleanCanvas(canvas, caption);
      return { url: (c ? c.canvas : canvas).toDataURL("image/jpeg", 0.92), box: box };
    } catch (err) { return res; }
  }
  var figCleanJobs = {};
  function cleanStoredFigure(f) {
    return fetch(figureSrc(f)).then(function (r) { return r.blob(); }).then(function (b) { return createImageBitmap(b); }).then(function (bm) {
      var c = document.createElement("canvas"); c.width = bm.width; c.height = bm.height; c.getContext("2d").drawImage(bm, 0, 0);
      return figureCleanCanvas(c, f.caption || "schéma du cours");
    }).then(function (res) {
      if (!res) return false;
      if (figureUrlCache[f.id]) { URL.revokeObjectURL(figureUrlCache[f.id]); delete figureUrlCache[f.id]; }
      f.image = res.canvas.toDataURL("image/jpeg", 0.92); delete f.stored;
      return true;
    });
  }
  App.cleanCourseFigures = function (courseId) {
    var loc = locateCourse(courseId); if (!loc || figCleanJobs[courseId]) return;
    if (!getApiKey()) { App.openApiKeyModal(); return; }
    var figs = (loc.course.figures || []).filter(function (f) { return figureSrc(f); }), done = 0; if (!figs.length) return;
    figCleanJobs[courseId] = true; toast("✂️ Nettoyage des schémas en cours…"); render();
    runWithConcurrency(figs.map(function (f) { return function () { return cleanStoredFigure(f).then(function (ok) { if (ok) done++; }).catch(function () {}); }; }), 2).catch(function () {}).then(function () {
      delete figCleanJobs[courseId]; saveDB(); storeFigureImages();
      toast(done ? "✂️ " + done + (done > 1 ? " schémas nettoyés" : " schéma nettoyé") : "Aucun schéma à nettoyer");
      var p = parseHash(); if (p[0] === "course" && p[1] === courseId) render();
    });
  };
  function figureCleanButton(course) {
    if (!(course.figures || []).length) return "";
    var busy = !!figCleanJobs[course.id];
    return '<button class="btn btn-ghost btn-sm" style="width:auto;margin:14px 0 0 10px"' + (busy ? " disabled" : "") + ' onclick="App.cleanCourseFigures(\'' + course.id + '\')" title="Retire les bouts de texte restés autour des schémas">' + (busy ? "⏳ Nettoyage…" : "✂️ Nettoyer les schémas") + '</button>';
  }
