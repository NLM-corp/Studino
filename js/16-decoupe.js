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
  var FIG_QUICK_MODELS = ["gemini-3.5-flash", "gemini-3.6-flash"];
  async function callGeminiQuick(parts, schema, timeoutMs) {
    var key = getApiKey();
    if (key) for (var i = 0; i < FIG_QUICK_MODELS.length; i++) {
      var r = await tryGeminiModel(key, FIG_QUICK_MODELS[i], parts, schema, 0, 16384, timeoutMs || 45000);
      if (r.ok) return r.value;
      if (!r.retryable) break;
    }
    return callGemini(parts, schema, 16384, 90000);
  }
  var FIG_BATCH_CHECK_SCHEMA = { type: "object", properties: { results: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, lost: { type: "string" }, ok: { type: "boolean" } }, required: ["index", "lost", "ok"] } } }, required: ["results"] };
  var FIG_BATCH_SCHEMA = { type: "object", properties: { results: { type: "array", items: { type: "object", properties: {
    index: { type: "integer" },
    clean: { type: "boolean", description: "true si l'image ne contient QUE le visuel (rien à retirer)." },
    visual: { type: "array", description: "1 à 4 rectangles dont la réunion couvre EXACTEMENT tout le visuel. Un seul rectangle s'il est rectangulaire ; plusieurs s'il a une autre forme (en L, en escalier...).", items: { type: "array", items: { type: "integer" } } }
  }, required: ["index", "clean", "visual"] } } }, required: ["results"] };
  function buildFigureKeepPrompt() {
    return "Chaque image ci-dessus est la découpe rectangulaire d'un visuel de document scolaire (sa légende est donnée avant elle). Un visuel n'est pas toujours rectangulaire : un encadré en forme de L, un schéma avec une encoche... Du texte qui ne lui appartient pas peut alors rester dans un coin ou une marge.\n" +
      FIGURE_SCOPE_RULE + "\n" +
      "Pour chaque image, donne dans \"visual\" 1 à 4 rectangles [ymin, xmin, ymax, xmax] (0-1000, relatifs à CETTE image) dont la réunion couvre TOUT le visuel et rien d'autre : tout son dessin, tous ses points, noms, valeurs, flèches, légendes, son titre, son cadre, et tout le texte écrit À L'INTÉRIEUR de son cadre (données, description), qui fait partie du visuel. Suis le contour de son cadre quand il en a un. Ce qui reste hors de ces rectangles sera effacé : dans le doute, inclus.\n" +
      "Mets clean = true si l'image ne contient que le visuel.\nRéponds avec une entrée par image (index = numéro de l'image).";
  }
  function figKeep(canvas, rects) {
    var I = figCanvasInk(canvas), w = I.w, h = I.h;
    if (I.share < 0.3 || w * h > 12e6) return null;
    var keep = new Uint8Array(w * h), pad = Math.max(4, Math.min(w, h) * 0.012), area = 0, i;
    rects.forEach(function (b) {
      var x0 = Math.max(0, Math.floor(b[1] / 1000 * w - pad)), x1 = Math.min(w - 1, Math.ceil(b[3] / 1000 * w + pad)), y0 = Math.max(0, Math.floor(b[0] / 1000 * h - pad)), y1 = Math.min(h - 1, Math.ceil(b[2] / 1000 * h + pad));
      for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) keep[y * w + x] = 1;
    });
    for (i = 0; i < w * h; i++) area += keep[i];
    if (area < 0.15 * w * h || area > 0.985 * w * h) return null;
    var C = figComponents(I), inside = new Float64Array(C.comps.length);
    for (i = 0; i < w * h; i++) if (C.lab[i] && keep[i]) inside[C.lab[i]]++;
    var kill = C.comps.map(function (c, k) { return !!c && inside[k] < 0.25 * c.n; }), inkN = 0, killN = 0;
    C.comps.forEach(function (c, k) { if (c) { inkN += c.n; if (kill[k]) killN += c.n; } });
    if (!killN || killN > 0.6 * inkN) return null;
    var d = I.data.data, bx0 = w, bx1 = 0, by0 = h, by1 = 0;
    for (i = 0; i < w * h; i++) {
      var l = C.lab[i];
      if (l ? kill[l] : !keep[i]) { d[i * 4] = I.bg[0]; d[i * 4 + 1] = I.bg[1]; d[i * 4 + 2] = I.bg[2]; }
    }
    C.comps.forEach(function (c, k) { if (!c || kill[k] || c.n < 6) return; bx0 = Math.min(bx0, c.x0); bx1 = Math.max(bx1, c.x1); by0 = Math.min(by0, c.y0); by1 = Math.max(by1, c.y1); });
    if (bx1 <= bx0 || by1 <= by0) return null;
    var full = document.createElement("canvas"); full.width = w; full.height = h; full.getContext("2d").putImageData(I.data, 0, 0);
    var mg = Math.max(8, Math.round(Math.min(w, h) * 0.02)); bx0 = Math.max(0, bx0 - mg); by0 = Math.max(0, by0 - mg); bx1 = Math.min(w, bx1 + mg); by1 = Math.min(h, by1 + mg);
    var out = document.createElement("canvas"); out.width = bx1 - bx0; out.height = by1 - by0; out.getContext("2d").drawImage(full, -bx0, -by0);
    return { canvas: out, x: bx0, y: by0 };
  }
  async function figureCleanBatch(items) {
    var parts = [];
    items.forEach(function (it, k) { parts.push({ text: "Image " + k + " — visuel « " + (it.caption || "schéma") + " » :" }); parts = parts.concat(geminiImageParts([it.canvas.toDataURL("image/jpeg", 0.85)])); });
    parts.push({ text: buildFigureKeepPrompt() });
    var d = await callGeminiQuick(parts, FIG_BATCH_SCHEMA, 60000), by = {};
    (d && d.results || []).forEach(function (r) { if (r) by[r.index] = r; });
    var changed = [];
    items.forEach(function (it, k) {
      var r = by[k]; if (!r || r.clean) return;
      var rects = (r.visual || []).filter(isValidFigureBox).slice(0, 4);
      var res = rects.length ? figKeep(it.canvas, rects) : null;
      if (res) changed.push({ it: it, after: res.canvas });
    });
    if (!changed.length) return [];
    var cp = [];
    changed.forEach(function (c, k) { cp.push({ text: "Paire " + k + " — « " + (c.it.caption || "schéma") + " », AVANT :" }); cp = cp.concat(geminiImageParts([c.it.canvas.toDataURL("image/jpeg", 0.85)])); cp.push({ text: "Paire " + k + ", APRÈS :" }); cp = cp.concat(geminiImageParts([c.after.toDataURL("image/jpeg", 0.85)])); });
    cp.push({ text: "Pour chaque paire, on a voulu retirer le texte voisin qui n'appartient pas au visuel.\n" + FIGURE_SCOPE_RULE + "\nUne partie du visuel lui-même (trait, point, nom, valeur, flèche, légende, cadre, données du document) a-t-elle disparu ou été abîmée dans APRÈS ? Retirer des questions ou du texte voisin est voulu. Une entrée par paire (index = numéro de paire), ok = true seulement si rien du visuel n'est perdu ET qu'il ne reste aucun morceau étranger." });
    var v = await callGeminiQuick(cp, FIG_BATCH_CHECK_SCHEMA, 60000), okBy = {};
    (v && v.results || []).forEach(function (r) { if (r) okBy[r.index] = !!r.ok; });
    return changed.filter(function (c, k) { return okBy[k] === true; });
  }
  async function figureCleanCanvas(canvas, caption) {
    var r = await figureCleanBatch([{ canvas: canvas, caption: caption }]).catch(function () { return []; });
    return r.length ? { canvas: r[0].after, x: 0, y: 0 } : null;
  }
  function figToCanvas(f) {
    return fetch(figureSrc(f)).then(function (r) { return r.blob(); }).then(function (b) { return createImageBitmap(b); }).then(function (bm) {
      var c = document.createElement("canvas"), k = Math.min(1, 1600 / Math.max(bm.width, bm.height)); c.width = Math.round(bm.width * k); c.height = Math.round(bm.height * k); c.getContext("2d").drawImage(bm, 0, 0, c.width, c.height); return c;
    });
  }
  var figCleanJobs = {}, figCleanUndo = {};
  App.cleanCourseFigures = async function (courseId) {
    var loc = locateCourse(courseId); if (!loc || figCleanJobs[courseId]) return;
    if (!getApiKey()) { App.openApiKeyModal(); return; }
    var course = loc.course, figs = (course.figures || []).filter(function (f) { return figureSrc(f); });
    if (!figs.length) { toast("Aucun schéma dans ce cours"); return; }
    var job = figCleanJobs[courseId] = { done: 0, total: figs.length }, results = [], errors = 0, refresh = function () { var p = parseHash(); if (p[0] === "course" && p[1] === courseId) render(); };
    refresh();
    var items = [];
    for (var i = 0; i < figs.length; i++) { try { items.push({ f: figs[i], caption: figs[i].caption, canvas: await figToCanvas(figs[i]) }); } catch (e) { job.done++; } }
    var batches = []; for (var b = 0; b < items.length; b += 5) batches.push(items.slice(b, b + 5));
    await runWithConcurrency(batches.map(function (batch) { return function () {
      return figureCleanBatch(batch).then(function (ch) { results = results.concat(ch); }).catch(function () { errors++; }).then(function () { job.done += batch.length; refresh(); });
    }; }), 2);
    figCleanUndo[courseId] = results.map(function (c) {
      var f = c.it.f, before = figureSrc(f);
      if (figureUrlCache[f.id] && !/^blob:/.test(before)) { URL.revokeObjectURL(figureUrlCache[f.id]); delete figureUrlCache[f.id]; }
      f.image = c.after.toDataURL("image/jpeg", 0.92); delete f.stored;
      return { f: f, before: c.it.canvas.toDataURL("image/jpeg", 0.92), after: f.image };
    });
    delete figCleanJobs[courseId];
    if (results.length) { saveDB(); storeFigureImages(); }
    refresh();
    figCleanReport(courseId, items.length, errors);
  };
  function figCleanReport(courseId, total, errors) {
    var list = figCleanUndo[courseId] || [], old = document.getElementById("fig-clean-report"); if (old) old.remove();
    var box = document.createElement("div"); box.id = "fig-clean-report"; box.className = "modal-overlay"; box.style.zIndex = 300;
    box.innerHTML = '<div class="modal modal-wide"><h3>✂️ Nettoyage des schémas</h3>' +
      '<p class="modal-warn">' + (list.length ? list.length + " schéma" + (list.length > 1 ? "s nettoyés" : " nettoyé") + " sur " + total + ". Les autres étaient déjà propres." : errors ? "Le nettoyage n'a pas pu se faire (serveurs de Google saturés ou quota atteint). Réessaie dans quelques minutes." : "Tes " + total + " schémas sont déjà propres : il n'y avait rien à enlever.") + (list.length && errors ? " Une partie n'a pas pu être analysée : relance plus tard pour les autres." : "") + '</p>' +
      list.map(function (u, k) { return '<div class="fcr-row"><div class="fcr-cap">' + esc(u.f.caption || "Schéma") + '</div><div class="fcr-pair"><figure><img src="' + u.before + '" alt=""><figcaption>Avant</figcaption></figure><figure><img src="' + u.after + '" alt=""><figcaption>Après</figcaption></figure></div><button class="btn btn-ghost btn-sm" style="width:auto" data-undo="' + k + '">↶ Remettre comme avant</button></div>'; }).join("") +
      '<div class="modal-actions"><button class="btn btn-primary" data-close>Fermer</button></div></div>';
    box.onclick = function (e) {
      if (e.target === box || e.target.hasAttribute("data-close")) { box.remove(); return; }
      var k = e.target.getAttribute("data-undo"); if (k == null) return;
      var u = list[+k]; u.f.image = u.before; delete u.f.stored; saveDB(); storeFigureImages();
      e.target.textContent = "Remis comme avant ✓"; e.target.disabled = true;
      var p = parseHash(); if (p[0] === "course" && p[1] === courseId) { render(); document.body.appendChild(box); }
    };
    document.body.appendChild(box);
  }
  function figureCleanButton(course) {
    if (!(course.figures || []).length) return "";
    var job = figCleanJobs[course.id];
    return '<button class="btn btn-ghost btn-sm" style="width:auto;margin:14px 0 0 10px"' + (job ? " disabled" : "") + ' onclick="App.cleanCourseFigures(\'' + course.id + '\')" title="Retire les bouts de texte restés autour des schémas">' + (job ? "⏳ Nettoyage… " + job.done + " / " + job.total : "✂️ Nettoyer les schémas") + '</button>';
  }
