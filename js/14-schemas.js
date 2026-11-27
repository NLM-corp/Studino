"use strict";

  function exoExpr(src) {
    var s = String(src || "").replace(/^\s*(y|f\(x\))\s*=/i, "").replace(/,/g, ".").replace(/\s+/g, "").replace(/\*\*/g, "^").replace(/[−–]/g, "-"), p = 0, FN = { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, ln: Math.log, log: Math.log10, sqrt: Math.sqrt, abs: Math.abs };
    if (!s || s.length > 120) return null;
    function fail() { throw new Error("expr"); }
    function sum() { var a = mul(); for (;;) { if (s[p] === "+") { p++; a = bin(a, mul(), 0); } else if (s[p] === "-") { p++; a = bin(a, mul(), 1); } else return a; } }
    function bin(a, b, k) { return k === 0 ? function (x) { return a(x) + b(x); } : k === 1 ? function (x) { return a(x) - b(x); } : k === 2 ? function (x) { return a(x) * b(x); } : k === 3 ? function (x) { return a(x) / b(x); } : function (x) { return Math.pow(a(x), b(x)); }; }
    function mul() { var a = un(); for (;;) { var c = s[p]; if (c === "*") { p++; a = bin(a, un(), 2); } else if (c === "/") { p++; a = bin(a, un(), 3); } else if (c && /[a-z(]/i.test(c)) a = bin(a, pow(), 2); else return a; } }
    function un() { if (s[p] === "-") { p++; var a = un(); return function (x) { return -a(x); }; } if (s[p] === "+") { p++; return un(); } return pow(); }
    function pow() { var a = atom(); if (s[p] === "^") { p++; return bin(a, un(), 4); } return a; }
    function atom() {
      var m = /^\d+(\.\d+)?/.exec(s.slice(p)); if (m) { p += m[0].length; var v = parseFloat(m[0]); return function () { return v; }; }
      if (s[p] === "(") { p++; var a = sum(); if (s[p] !== ")") fail(); p++; return a; }
      m = /^(sin|cos|tan|exp|ln|log|sqrt|abs)\(/.exec(s.slice(p)); if (m) { p += m[1].length; var f = FN[m[1]], b = atom(); return function (x) { return f(b(x)); }; }
      if (s.slice(p, p + 2) === "pi") { p += 2; return function () { return Math.PI; }; }
      if (s[p] === "x") { p++; return function (x) { return x; }; }
      if (s[p] === "e") { p++; return function () { return Math.E; }; }
      fail();
    }
    try { var r = sum(); return p === s.length ? r : null; } catch (e) { return null; }
  }
  var EXO_TYPES = ["point", "croix", "segment", "fleche", "ligne", "courbe", "fonction", "polygone", "cercle", "barres", "texte", "angle", "angle_droit", "codage"];
  function exoElements(f) {
    var rep = f && f.kind === "repere";
    return (Array.isArray(f && f.elements) ? f.elements : []).map(function (e) {
      var xs = (e && e.xs || []).map(Number), ys = (e && e.ys || []).map(Number), n = Math.min(xs.length, ys.length), pts = [], t = String(e && e.type || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "_");
      for (var i = 0; i < n; i++) if (isFinite(xs[i]) && isFinite(ys[i])) pts.push([xs[i], ys[i]]);
      var el = { type: t, pts: pts, r: exoNum(e && e.r, 0), label: String(e && e.label || "").replace(/[$\\{}]/g, "").slice(0, 60), color: exoColor(e && e.color), dashed: !!(e && e.dashed), bad: xs.length !== ys.length && t !== "fonction" };
      if (t === "fonction") {
        var fn = exoExpr(e.expr), a = xs.length > 1 ? Math.min.apply(0, xs) : exoNum(f.xMin, 0), b = xs.length > 1 ? Math.max.apply(0, xs) : exoNum(f.xMax, 10), lo = rep ? exoNum(f.yMin, -1e9) : 0, hi = rep ? exoNum(f.yMax, 1e9) : exoNum(f.height, 8), run = [];
        el.runs = []; el.bad = !fn || !(b > a);
        if (!el.bad) for (i = 0; i <= 240; i++) { var x = a + (b - a) * i / 240, y = fn(x), prev = run[run.length - 1]; if (isFinite(y) && y >= lo && y <= hi && !(prev && Math.abs(y - prev[1]) > (hi - lo) * 0.6)) run.push([x, y]); else { if (run.length > 1) el.runs.push(run); run = []; } }
        if (run.length > 1) el.runs.push(run);
        el.pts = [].concat.apply([], el.runs); if (!el.pts.length) el.bad = true;
      }
      return el;
    });
  }
  function exoFigureSvg(f) {
    if (!f || !f.kind || f.kind === "aucune") return "";
    if (f.kind === "libre") return sanitizeSvg(f.svg || "");
    var els = exoElements(f).filter(function (e) { return e.pts.length && EXO_TYPES.indexOf(e.type) >= 0; }); if (!els.length) return "";
    var rep = f.kind === "repere", U = EXO_U, i, W = Math.max(3, Math.min(16, exoNum(f.width, 12))), H = Math.max(2.5, Math.min(12, exoNum(f.height, 8))), x0 = 0, x1 = W, y0 = 0, y1 = H;
    if (rep) { x0 = exoNum(f.xMin, 0); x1 = exoNum(f.xMax, 10); y0 = exoNum(f.yMin, 0); y1 = exoNum(f.yMax, 10); if (!(x1 > x0) || !(y1 > y0)) return ""; }
    var L = rep ? 1.8 : 0.6, R = rep ? 1.1 : 0.6, T = rep ? 1 : 0.6, B = rep ? 1.5 : 1.4, vw = (W + L + R) * U, vh = (H + T + B) * U, r1 = function (n) { return Math.round(n * 100) / 100; };
    var X = function (x) { return r1((L + (x - x0) / (x1 - x0) * W) * U); }, Y = function (y) { return r1((T + (y1 - y) / (y1 - y0) * H) * U); };
    var o = [], labs = [], boxes = [], obs = [];
    var txt = function (x, y, s, anchor, size, col) { var w = String(s).length * (size || 16) * 0.56; boxes.push([anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2, y - (size || 16) * 0.8, w, (size || 16)]); return '<text x="' + r1(x) + '" y="' + r1(y) + '" font-family="Arial, sans-serif" font-size="' + (size || 16) + '" text-anchor="' + (anchor || "middle") + '" fill="' + (col || "#1d1d1f") + '" stroke="#ffffff" stroke-width="4" paint-order="stroke" stroke-linejoin="round">' + esc(s) + '</text>'; };
    var line = function (a, b, c, d, col, w, dash) { return '<line x1="' + r1(a) + '" y1="' + r1(b) + '" x2="' + r1(c) + '" y2="' + r1(d) + '" stroke="' + col + '" stroke-width="' + w + '"' + (dash ? ' stroke-dasharray="7 6"' : '') + '/>'; };
    var track = function (a, b) { var n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 7)); for (var k = 0; k <= n; k++) obs.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); };
    o.push('<rect x="0" y="0" width="' + r1(vw) + '" height="' + r1(vh) + '" fill="#ffffff"/>');
    if (rep) {
      var step = function (s, a, b) { s = exoNum(s, 0); if (!(s > 0) || (b - a) / s > 25 || (b - a) / s < 2) { var raw = (b - a) / 8, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)); s = [1, 2, 5, 10].map(function (k) { return k * p; }).find(function (k) { return k >= raw; }); } return s; };
      var sx = step(f.xStep, x0, x1), sy = step(f.yStep, y0, y1), oy = y0 <= 0 && y1 >= 0 ? 0 : y0, ox = x0 <= 0 && x1 >= 0 ? 0 : x0, v;
      for (i = Math.ceil(x0 / sx - 1e-9); i * sx <= x1 + sx * 1e-6; i++) { v = i * sx; o.push(line(X(v), Y(y0), X(v), Y(y1), "#d9d9e0", 1)); o.push(txt(X(v), Y(y0) + 20, exoFmt(v), "middle", 14)); }
      for (i = Math.ceil(y0 / sy - 1e-9); i * sy <= y1 + sy * 1e-6; i++) { v = i * sy; o.push(line(X(x0), Y(v), X(x1), Y(v), "#d9d9e0", 1)); o.push(txt(X(x0) - 8, Y(v) + 5, exoFmt(v), "end", 14)); }
      o.push(line(X(x0), Y(oy), X(x1) + 14, Y(oy), "#1d1d1f", 2), line(X(ox), Y(y0), X(ox), Y(y1) - 10, "#1d1d1f", 2));
      o.push('<path d="M' + (X(x1) + 22) + ' ' + Y(oy) + 'l-10 -5v10z" fill="#1d1d1f"/><path d="M' + X(ox) + ' ' + r1(Y(y1) - 18) + 'l-5 10h10z" fill="#1d1d1f"/>');
      o.push(txt(vw - 6, Y(y0) + 44, f.xLabel || "x", "end", 15), txt(8, 16, f.yLabel || "y", "start", 15));
    } else if (f.grid) { for (i = 0; i <= W; i++) o.push(line(X(i), Y(0), X(i), Y(H), "#e4e4ea", 1)); for (i = 0; i <= H; i++) o.push(line(X(0), Y(i), X(W), Y(i), "#e4e4ea", 1)); }
    els.forEach(function (e) {
      var P = e.pts.map(function (p) { return [X(p[0]), Y(p[1])]; }), st = 'fill="none" stroke="' + e.color + '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"' + (e.dashed ? ' stroke-dasharray="7 6"' : ''), a = P[0], z = P[P.length - 1], t = e.type, k;
      var lab = function (x, y, d) { if (e.label) labs.push([x, y, e.label, e.color, d]); };
      if (t === "point") { P.forEach(function (p) { o.push('<circle cx="' + p[0] + '" cy="' + p[1] + '" r="4.2" fill="' + e.color + '"/>'); obs.push(p); }); lab(a[0], a[1], 17); return; }
      if (t === "croix") { P.forEach(function (p) { o.push(line(p[0] - 6, p[1], p[0] + 6, p[1], e.color, 2), line(p[0], p[1] - 6, p[0], p[1] + 6, e.color, 2)); obs.push(p); }); lab(a[0], a[1], 19); return; }
      if (t === "texte") { labs.push([a[0], a[1], e.label, e.color, 0]); return; }
      if (t === "cercle") { var rx = Math.abs(X(e.pts[0][0] + e.r) - a[0]), ry = Math.abs(Y(e.pts[0][1] + e.r) - a[1]); o.push('<ellipse cx="' + a[0] + '" cy="' + a[1] + '" rx="' + r1(rx) + '" ry="' + r1(ry) + '" ' + st + '/>'); for (k = 0; k < 360; k += 4) obs.push([a[0] + rx * Math.cos(k * Math.PI / 180), a[1] + ry * Math.sin(k * Math.PI / 180)]); lab(a[0] + rx * 0.72, a[1] - ry * 0.72, 18); return; }
      if (t === "barres") { var bw = Math.max(8, Math.min(40, W * U / (P.length * 2))); P.forEach(function (p) { var b0 = Y(Math.max(y0, Math.min(y1, 0))); o.push('<rect x="' + r1(p[0] - bw / 2) + '" y="' + r1(Math.min(p[1], b0)) + '" width="' + r1(bw) + '" height="' + r1(Math.abs(b0 - p[1])) + '" fill="' + e.color + '" fill-opacity="0.75"/>'); }); return; }
      if (t === "fonction") { e.runs.forEach(function (run) { var Q = run.map(function (p) { return [X(p[0]), Y(p[1])]; }); o.push('<path d="' + Q.map(function (p, n) { return (n ? "L" : "M") + p[0] + " " + p[1]; }).join("") + '" ' + st + '/>'); Q.forEach(function (p) { obs.push(p); }); }); var m = P[Math.floor(P.length * 0.75)]; lab(m[0], m[1], 18); return; }
      if (P.length < 2) return;
      if (t === "angle_droit" || t === "angle") {
        if (P.length < 3) return;
        var B0 = P[1], u1 = Math.atan2(P[0][1] - B0[1], P[0][0] - B0[0]), u2 = Math.atan2(P[2][1] - B0[1], P[2][0] - B0[0]), c = t === "angle" ? 26 : 13, pt = function (an, d) { return [r1(B0[0] + d * Math.cos(an)), r1(B0[1] + d * Math.sin(an))]; }, s1 = pt(u1, c), s2 = pt(u2, c), df = ((u2 - u1) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
        for (k = 4; k <= c; k += 4) { var m1 = pt(u1, k), m2 = pt(u2, k); track([m1[0] + s2[0] - B0[0], m1[1] + s2[1] - B0[1]], m1); track([m2[0] + s1[0] - B0[0], m2[1] + s1[1] - B0[1]], m2); }
        if (t === "angle_droit") o.push('<path d="M' + s1.join(" ") + "L" + r1(s1[0] + s2[0] - B0[0]) + " " + r1(s1[1] + s2[1] - B0[1]) + "L" + s2.join(" ") + '" fill="none" stroke="' + e.color + '" stroke-width="1.8"/>');
        else { o.push('<path d="M' + s1.join(" ") + "A" + c + " " + c + " 0 0 " + (df > 0 ? 1 : 0) + " " + s2.join(" ") + '" fill="none" stroke="' + e.color + '" stroke-width="1.8"/>'); if (e.label) { var q0 = pt(u1 + df / 2, 46); labs.push([q0[0], q0[1], e.label, e.color, 0]); } }
        return;
      }
      if (t === "codage") { var n0 = Math.max(1, Math.min(3, parseInt(e.label, 10) || 1)), al = Math.atan2(z[1] - a[1], z[0] - a[0]); for (k = 0; k < n0; k++) { var off = (k - (n0 - 1) / 2) * 6, cx = (a[0] + z[0]) / 2 + off * Math.cos(al), cy = (a[1] + z[1]) / 2 + off * Math.sin(al); o.push(line(cx - 7 * Math.sin(al + 0.3), cy + 7 * Math.cos(al + 0.3), cx + 7 * Math.sin(al + 0.3), cy - 7 * Math.cos(al + 0.3), e.color, 1.8)); } return; }
      var d = P.map(function (p, n) { return (n ? "L" : "M") + p[0] + " " + p[1]; }).join("") + (t === "polygone" ? "Z" : ""), mid = [(a[0] + z[0]) / 2, (a[1] + z[1]) / 2];
      if (t === "courbe" && P.length > 2) {
        d = "M" + P[0].join(" ");
        for (k = 0; k < P.length - 1; k++) { var p0 = P[k - 1] || P[k], p1 = P[k], p2 = P[k + 1], p3 = P[k + 2] || p2; d += "C" + r1(p1[0] + (p2[0] - p0[0]) / 6) + " " + r1(p1[1] + (p2[1] - p0[1]) / 6) + " " + r1(p2[0] - (p3[0] - p1[0]) / 6) + " " + r1(p2[1] - (p3[1] - p1[1]) / 6) + " " + p2[0] + " " + p2[1]; }
      }
      if (t === "courbe" || t === "ligne") mid = P[Math.floor(P.length / 2)];
      for (k = 1; k < P.length; k++) track(P[k - 1], P[k]);
      if (t === "polygone") { track(z, a); mid = [P.reduce(function (s, p) { return s + p[0]; }, 0) / P.length, P.reduce(function (s, p) { return s + p[1]; }, 0) / P.length]; }
      if (t === "fleche") { var q = P[P.length - 2], an = Math.atan2(z[1] - q[1], z[0] - q[0]), hd = function (s) { return r1(z[0] - 13 * Math.cos(an + s)) + " " + r1(z[1] - 13 * Math.sin(an + s)); }; d = P.slice(0, -1).concat([[r1(z[0] - 8 * Math.cos(an)), r1(z[1] - 8 * Math.sin(an))]]).map(function (p, n) { return (n ? "L" : "M") + p[0] + " " + p[1]; }).join(""); o.push('<path d="' + d + '" ' + st + '/><path d="M' + z.join(" ") + "L" + hd(0.4) + "L" + hd(-0.4) + 'Z" fill="' + e.color + '"/>'); }
      else o.push('<path d="' + d + '" ' + st + '/>');
      lab(mid[0], mid[1], t === "polygone" ? 0 : 17);
    });
    if (rep) { if (f.note) o.push(txt(vw - 6, 16, f.note, "end", 13)); }
    else { var by = vh - 22; o.push(line(24, by, 24 + U, by, "#1d1d1f", 2), line(24, by - 5, 24, by + 5, "#1d1d1f", 2), line(24 + U, by - 5, 24 + U, by + 5, "#1d1d1f", 2), txt(24 + U + 10, by + 5, "1 cm" + (f.note ? "  —  " + f.note : ""), "start", 14)); }
    labs.sort(function (a, b) { return a[4] - b[4]; }).forEach(function (l) {
      var w = l[2].length * 9 + 4, h = 18, best = null;
      (l[4] ? [-45, 45, -135, 135, -90, 90, 0, 180, -20, 20, -160, 160] : [null, -90, 90, 0, 180]).forEach(function (deg, k) {
        [1, 1.5].forEach(function (mult, mi) {
          var rd = deg === null ? 0 : (l[4] || 14) * mult, an = (deg || 0) * Math.PI / 180, cx = l[0] + rd * Math.cos(an) + (rd ? Math.cos(an) * (w / 2 - 6) : 0), cy = l[1] + rd * Math.sin(an), b = [cx - w / 2, cy - h / 2, w, h], cost = k * 0.4 + mi * 2;
          boxes.forEach(function (c) { if (b[0] < c[0] + c[2] && c[0] < b[0] + w && b[1] < c[1] + c[3] && c[1] < b[1] + h) cost += 40; });
          obs.forEach(function (p) { if (p[0] > b[0] && p[0] < b[0] + w && p[1] > b[1] && p[1] < b[1] + h) cost += 6; });
          if (b[0] < 2 || b[1] < 2 || b[0] + w > vw - 2 || b[1] + h > vh - 2) cost += 60;
          if (!best || cost < best.cost) best = { cost: cost, x: cx, y: cy };
        });
      });
      boxes.push([best.x - w / 2, best.y - h / 2, w, h]);
      var s = txt(best.x, best.y + 5.5, l[2], "middle", 16, l[3]); boxes.pop(); o.push(s);
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + r1(vw) + ' ' + r1(vh) + '" data-upcm="' + U + '" style="width:' + r1(vw / U) + 'cm;max-width:100%;height:auto">' + o.join("") + '</svg>';
  }

  function exoFigureFaults(f, svg) {
    var out = [], bad = function (s) { if (out.length < 12) out.push(s); };
    if (!svg) return ["la figure n'a pas pu être dessinée (données vides ou invalides)"];
    if (f.kind === "echelle" || f.kind === "repere") {
      var rep = f.kind === "repere", W = exoNum(f.width, 12), H = exoNum(f.height, 8), P = {}, els = exoElements(f);
      var x0 = rep ? exoNum(f.xMin, NaN) : 0, x1 = rep ? exoNum(f.xMax, NaN) : W, y0 = rep ? exoNum(f.yMin, NaN) : 0, y1 = rep ? exoNum(f.yMax, NaN) : H;
      if (W > 16 || H > 12 || W < 3 || H < 2.5) bad("dimensions hors limites : width de 3 à 16, height de 2,5 à 12");
      if (!(x1 > x0) || !(y1 > y0)) bad("xMin, xMax, yMin, yMax manquants ou incohérents");
      var tx = (x1 - x0) * 0.005, ty = (y1 - y0) * 0.005;
      els.forEach(function (e, k) {
        var nm = e.type + " " + (e.label || "n°" + (k + 1));
        if (EXO_TYPES.indexOf(e.type) < 0) { bad(nm + " : type inconnu"); return; }
        if (e.bad) bad(nm + (e.type === "fonction" ? " : expression illisible ou hors du cadre" : " : xs et ys n'ont pas la même longueur"));
        if (!e.pts.length) { bad(nm + " : aucun point"); return; }
        e.pts.forEach(function (p) { if (p[0] < x0 - tx || p[0] > x1 + tx || p[1] < y0 - ty || p[1] > y1 + ty) bad(nm + " : le point (" + exoFmt(p[0]) + " ; " + exoFmt(p[1]) + ") sort du cadre"); });
        if (e.type === "cercle") { if (!(e.r > 0)) bad(nm + " : rayon manquant"); else { var c = e.pts[0]; if (c[0] - e.r < x0 - tx || c[0] + e.r > x1 + tx || c[1] - e.r < y0 - ty || c[1] + e.r > y1 + ty) bad(nm + " : le cercle sort du cadre"); } }
        var need = { segment: 2, fleche: 2, ligne: 2, courbe: 3, polygone: 3, angle: 3, angle_droit: 3, codage: 2 }[e.type] || 1;
        if (e.pts.length < need) bad(nm + " : il faut au moins " + need + " points");
        if ((e.type === "segment" || e.type === "fleche") && e.pts.length > 1 && !rep && Math.hypot(e.pts[1][0] - e.pts[0][0], e.pts[1][1] - e.pts[0][1]) < 0.3) bad(nm + " : trop court pour être lu");
        if (e.type === "angle_droit" && e.pts.length > 2) { var g = exoAngle(e.pts[0], e.pts[1], e.pts[2]); if (Math.abs(g - 90) > 0.6) bad(nm + " : l'angle vaut " + exoFmt(g) + "°, pas 90°"); }
        if ((e.type === "point" || e.type === "croix") && e.label) { if (P[e.label] && Math.hypot(P[e.label][0] - e.pts[0][0], P[e.label][1] - e.pts[0][1]) > 1e-6) bad("le nom " + e.label + " est donné à deux points différents"); P[e.label] = e.pts[0]; }
      });
      var names = Object.keys(P);
      if (!rep) names.forEach(function (a, i) { names.slice(i + 1).forEach(function (b) { var d = Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1]); if (d < 0.4 && d > 1e-6) bad("les points " + a + " et " + b + " sont presque confondus (" + exoFmt(d) + " cm)"); }); });
      (Array.isArray(f.checks) ? f.checks : []).forEach(function (c) {
        var n = (c && c.points || []).map(String), q = n.map(function (k) { return P[k]; }), t = String(c && c.type || "").toLowerCase(), v = Number(c && c.value), nm = t + "(" + n.join(", ") + ")";
        if (q.some(function (x) { return !x; })) { bad(nm + " : un des points n'est pas placé sur la figure"); return; }
        var len = function (a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }, dir = function (a, b) { return Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; }, mod = function (x) { x = Math.abs(x) % 180; return Math.min(x, 180 - x); }, S = Math.max(0.03, Math.hypot(x1 - x0, y1 - y0) * 0.002);
        if (t === "angle_droit" && q.length > 2) { var a = exoAngle(q[0], q[1], q[2]); if (Math.abs(a - 90) > 0.6) bad(nm + " : vaut " + exoFmt(a) + "°"); }
        else if (t === "angle" && q.length > 2) { var a2 = exoAngle(q[0], q[1], q[2]); if (!(Math.abs(a2 - v) <= 0.8)) bad(nm + " : vaut " + exoFmt(a2) + "° au lieu de " + v); }
        else if (t === "longueur" && q.length > 1) { var l = len(q[0], q[1]); if (!(Math.abs(l - v) <= Math.max(S, Math.abs(v) * 0.005))) bad(nm + " : vaut " + exoFmt(l) + " au lieu de " + v); }
        else if (t === "egal" && q.length > 3) { var d1 = len(q[0], q[1]), d2 = len(q[2], q[3]); if (Math.abs(d1 - d2) > S) bad(nm + " : " + exoFmt(d1) + " et " + exoFmt(d2) + " ne sont pas égaux"); }
        else if (t === "parallele" && q.length > 3) { var p1 = mod(dir(q[0], q[1]) - dir(q[2], q[3])); if (p1 > 0.6) bad(nm + " : écart de " + exoFmt(p1) + "°"); }
        else if (t === "perpendiculaire" && q.length > 3) { var p2 = Math.abs(90 - mod(dir(q[0], q[1]) - dir(q[2], q[3]))); if (p2 > 0.6) bad(nm + " : écart de " + exoFmt(p2) + "°"); }
        else if (t === "aligne" && q.length > 2) { for (var k = 2; k < q.length; k++) { var h = Math.abs((q[1][0] - q[0][0]) * (q[k][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[k][0] - q[0][0])) / (len(q[0], q[1]) || 1); if (h > S) bad(nm + " : " + n[k] + " est à " + exoFmt(h) + " de la droite"); } }
        else if (t === "sur_cercle" && q.length > 1) { for (var m = 1; m < q.length; m++) { var r = len(q[0], q[m]); if (!(Math.abs(r - v) <= S)) bad(nm + " : " + n[m] + " est à " + exoFmt(r) + " du centre au lieu de " + v); } }
        else if (t === "milieu" && q.length > 2) { if (len(q[0], [(q[1][0] + q[2][0]) / 2, (q[1][1] + q[2][1]) / 2]) > S) bad(nm + " : pas au milieu"); }
        else bad(nm + " : contrôle inconnu ou incomplet");
      });
    }
    try {
      var host = document.createElement("div"), vb = /viewBox="([^"]+)"/.exec(svg), n2 = vb ? vb[1].trim().split(/[\s,]+/).map(Number) : [];
      if (!(n2[2] > 0) || !(n2[3] > 0)) bad("viewBox manquant");
      else {
        host.style.cssText = "position:fixed;left:-5000px;top:0;visibility:hidden;width:" + n2[2] + "px";
        host.innerHTML = svg; document.body.appendChild(host);
        var sv = host.querySelector("svg"); sv.style.cssText = "width:" + n2[2] + "px;height:" + n2[3] + "px;max-width:none;max-height:none";
        var R0 = sv.getBoundingClientRect(), T = Array.prototype.filter.call(sv.querySelectorAll("text"), function (t) { return t.textContent.trim(); }).map(function (t) { return { s: t.textContent.trim().slice(0, 30), r: t.getBoundingClientRect() }; });
        T.forEach(function (a, i) {
          if (a.r.left < R0.left - 2 || a.r.right > R0.right + 2 || a.r.top < R0.top - 3 || a.r.bottom > R0.bottom + 3) bad("le texte « " + a.s + " » sort du cadre");
          if (f.kind === "libre" && a.r.height < Math.max(n2[2], n2[3]) / 75) bad("le texte « " + a.s + " » est trop petit");
          T.slice(i + 1).forEach(function (b) { var w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top); if (w > 2 && h > 4 && w * h > 0.18 * Math.min(a.r.width * a.r.height, b.r.width * b.r.height)) bad("les textes « " + a.s + " » et « " + b.s + " » se chevauchent"); });
        });
        host.remove();
      }
    } catch (e) { if (host && host.remove) host.remove(); }
    return out;
  }
  function exoAngle(a, b, c) { var d = Math.abs(Math.atan2(a[1] - b[1], a[0] - b[0]) - Math.atan2(c[1] - b[1], c[0] - b[0])) * 180 / Math.PI; return d > 180 ? 360 - d : d; }

  var EXO_LOOK_SCHEMA = { type: "object", properties: { results: { type: "array", items: { type: "object", properties: {
    index: { type: "integer" }, seen: { type: "string", description: "À remplir D'ABORD, en regardant seulement l'image : tout ce qui est réellement dessiné (formes, nombre de côtés, angles, tracés, textes, axes, positions)." },
    problems: { type: "array", items: { type: "string" }, description: "Chaque défaut précis. Vide si irréprochable." }, ok: { type: "boolean" }
  }, required: ["index", "seen", "problems", "ok"] } } }, required: ["results"] };
  function exoLookPrompt(second) {
    return "Tu contrôles des figures d'exercices AVANT qu'un élève les voie. Une figure fausse ou ambiguë lui ferait apprendre une erreur : au moindre doute, ok = false.\n" +
      (second ? "Ces figures ont déjà été acceptées une fois : cherche activement l'erreur que le premier contrôle a laissé passer.\n" : "") +
      "Pour chaque figure : 1) décris l'image dans \"seen\" SANS te servir de l'énoncé ; 2) compare à l'énoncé, mot par mot : chaque objet cité est-il présent, de la bonne nature (un triangle a 3 côtés, un angle droit est droit, un courant a le bon sens...), au bon endroit, avec le bon nom ? Y a-t-il quelque chose en trop ou en contradiction ? 3) exactitude selon la discipline : conventions, symboles, sens des flèches, proportions, ordre, échelles, unités, géographie, anatomie, logique ; 4) netteté : traits droits et lisses, éléments qui se touchent quand ils le doivent, rien de superposé, coupé, illisible ou laid ; 5) l'élève peut-il faire tout ce qu'on lui demande avec elle, et ne donne-t-elle PAS la réponse ? (une figure marquée CORRIGÉ doit au contraire montrer la bonne réponse, complète et exacte) ; 6) une image réelle ou complexe approximative (carte, organe, appareil, œuvre) qui ne ressemble pas vraiment à ce qu'elle prétend est refusée.\nLes valeurs géométriques listées sont exactes (calculées par le site).";
  }
  function exoLook(list, second, timeoutMs) {
    if (!list.length) return Promise.resolve({});
    return Promise.all(list.map(function (n) { return svgToPng(n.svg); })).then(function (pngs) {
      var parts = [{ text: exoLookPrompt(second) }];
      list.forEach(function (n, k) {
        parts.push({ text: "\n===== FIGURE index " + k + (n.sol ? " (figure du CORRIGÉ)" : " (figure de l'ÉNONCÉ)") + " =====\nÉNONCÉ :\n" + n.it.prompt + "\n\nCORRIGÉ :\n" + (n.it.solution || n.it.answer) + (exoGeometry(n.spec) ? "\n\nVALEURS EXACTES :\n" + exoGeometry(n.spec) : "") + "\nImage :" });
        parts = parts.concat(pngs[k] ? geminiImageParts([pngs[k]]) : [{ text: "(image impossible à produire : ok = false)" }]);
      });
      return Promise.race([callGemini(parts, EXO_LOOK_SCHEMA, 32768, timeoutMs, { high: true }), new Promise(function (ok) { setTimeout(function () { ok(null); }, timeoutMs); })]);
    }).then(function (d) {
      if (!d) return null;
      var by = {}; (d.results || []).forEach(function (r) { if (r) by[r.index] = r; });
      return by;
    }).catch(function () { return null; });
  }
  function exoRepair(list, timeoutMs) {
    var schema = { type: "object", properties: { results: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, figure: EXO_FIGURE_SCHEMA }, required: ["index", "figure"] } } }, required: ["results"] };
    return Promise.all(list.map(function (n) { return n.svg ? svgToPng(n.svg) : ""; })).then(function (pngs) {
      var parts = [{ text: "Des figures d'exercices ont été refusées. Refais chacune ENTIÈREMENT pour qu'elle soit exacte, propre et conforme à l'énoncé. Reprends les calculs de coordonnées à zéro, et déclare dans \"checks\" les propriétés qu'elle doit vérifier. Si « libre » pose problème, préfère « echelle » ou « repere » quand c'est possible.\n\n" + EXO_FIGURE_RULES }];
      list.forEach(function (n, k) {
        parts.push({ text: "\n===== index " + k + (n.sol ? " (figure du CORRIGÉ : elle montre la réponse)" : "") + " =====\nÉNONCÉ :\n" + n.it.prompt + "\n\nCORRIGÉ :\n" + (n.it.solution || n.it.answer) + "\n\nFIGURE REFUSÉE :\n" + JSON.stringify(n.spec).slice(0, 5000) + "\n\nDÉFAUTS :\n- " + n.problems.join("\n- ") });
        if (pngs[k]) parts = parts.concat(geminiImageParts([pngs[k]]));
      });
      return Promise.race([callGemini(parts, schema, 32768, timeoutMs, { high: true }), new Promise(function (ok) { setTimeout(function () { ok(null); }, timeoutMs); })]);
    }).then(function (d) { var by = {}; (d && d.results || []).forEach(function (r) { if (r && r.figure) by[r.index] = r.figure; }); return by; }).catch(function () { return {}; });
  }
  async function exoVerifyFigures(items, rounds, deadlineMs) {
    var end = Date.now() + deadlineMs, list = [], left = function () { return Math.max(1000, end - Date.now()); };
    items.forEach(function (it) {
      if (it.figureSpec) list.push({ it: it, spec: it.figureSpec, sol: false });
      if (it.solutionSpec) list.push({ it: it, spec: it.solutionSpec, sol: true });
    });
    var pending = list.slice();
    for (var r = 0; r <= rounds && pending.length && Date.now() < end; r++) {
      pending.forEach(function (n) { n.svg = exoFigureSvg(n.spec); n.problems = exoFigureFaults(n.spec, n.svg); });
      var clean = pending.filter(function (n) { return !n.problems.length; });
      if (r === 0) { clean.forEach(function (n) { var lk = n.it[n.sol ? "solLook" : "figLook"]; if (lk) { if (lk.ok) n.ok = true; else n.problems = lk.problems.length ? lk.problems : ["refusée à la relecture"]; } }); clean = clean.filter(function (n) { return !n.ok && !n.problems.length; }); }
      var by = clean.length ? await exoLook(clean, false, Math.min(120000, left())) : {};
      if (!by) break;
      clean.forEach(function (n, k) { var v = by[k]; if (v && v.ok && !(v.problems || []).length) n.ok = true; else n.problems = v && v.problems && v.problems.length ? v.problems : ["refusée au contrôle visuel" + (v && v.seen ? " : on y voit " + v.seen : "")]; });
      pending = pending.filter(function (n) { return !n.ok; });
      if (!pending.length || r === rounds || Date.now() >= end) break;
      var fix = await exoRepair(pending, Math.min(120000, left())), got = 0;
      pending.forEach(function (n, k) { if (fix[k] && fix[k].kind && fix[k].kind !== "aucune") { n.spec = fix[k]; got++; } });
      if (!got) break;
    }
    var out = items.filter(function (it) { return !list.some(function (n) { return n.it === it && !n.sol && !n.ok; }); });
    out.forEach(function (it) {
      it.figureSvg = ""; it.solutionSvg = "";
      list.forEach(function (n) { if (n.it === it && n.ok) it[n.sol ? "solutionSvg" : "figureSvg"] = n.svg; });
      delete it.figureSpec; delete it.solutionSpec; delete it.geo; delete it.figLook; delete it.solLook;
    });
    return out;
  }
  function exoVisual(course) {
    var docs = exoChapterDocs(course).map(function (d) { return d.course; }).concat([course]);
    return docs.some(function (c) { return (c.figures || []).length || /sch[ée]ma|graphique|courbe|figure|diagramme|\bcartes?\b|croquis|rep[èe]re|trac(er|ez|é)|constru(ire|is)|l[ée]gend|\baxes?\b|dessin|\bplan\b|frise|repr[ée]sent(er|ez) /i.test(String(c.transcription || "")); });
  }
  function exoSolutionFigureHtml(item) { var s = sanitizeSvg(item && item.solutionSvg || ""); return s ? '<div class="exercise-figure">' + s + '</div>' : ""; }
