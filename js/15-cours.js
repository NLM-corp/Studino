"use strict";

  function lessonHtml(course) {
    var loc = locateCourse(course.id);
    return lessonPageHtml(course.transcription, course.figures, course.title, loc ? loc.subject.name + " · " + loc.chapter.name : "");
  }
  function lessonPageHtml(md, figures, title, sub) {
    Promise.resolve().then(lessonEnhanceAll);
    return '<div class="prose nb nb-lesson"><div class="nbl-top">' + esc(sub || "") + '</div><h1 class="nbl-title"><span>' + esc(title) + '</span></h1>' + mdToHtml(md, figures) + '</div>';
  }
  var LESSON_SUB = /^(donn[ée]es?|document|doc\.?\s*\d*|annexe|questions?|[ée]nonc[ée]|consignes?|aide|coup de pouce|indices?|rappels?|analyse|pour bien r[ée]pondre|solution|correction|corrig[ée]|r[ée]ponses?|mise en application|bar[èe]me|d[ée]tails? du bar[èe]me|crit[èe]res|sch[ée]ma|figure|tableau|graphique|photo|partie\s+[a-z0-9]|[ée]tude|application|m[ée]thode|conseils?|to do|à faire|résultats?|exp[ée]rience|protocole|mat[ée]riel)\b/i;
  var LESSON_EXO = /^(\d{1,3}\s*[).:-]?\s+\S|exercices?\s*(n[°o]\s*)?\d|ex\.?\s*\d|probl[èe]me\s*\d|activit[ée]\s*\d)/i;
  var LESSON_LEADS = [
    [/^(d[ée]finitions?|propri[ée]t[ée]s?|th[ée]or[èe]mes?|r[èe]gles?|lois?|formules?|principes?|vocabulaire|notions?)\b/i, "nbl-def"],
    [/^(exemples?|ex\.?|illustration|application|cas)\b/i, "nbl-ex"],
    [/^(attention|pi[èe]ges?|erreurs?|ne pas confondre|important|danger)\b/i, "nbl-att"],
    [/^([àa] retenir|retenir|bilan|conclusion|r[ée]sum[ée]|essentiel|cons[ée]quences?)\b/i, "nbl-ret"],
    [/^(remarques?|rappels?|pr[ée]requis|notes?|nb|m[ée]thodes?|m[ée]thodologie|astuces?|objectifs?)\b/i, "nbl-rem"]
  ];
  function lessonEnhance(el) {
    if (!el._done) {
      el._done = true;
      var exo = null;
      Array.prototype.slice.call(el.children).forEach(function (c) {
        var head = c.tagName === "H3" || c.tagName === "H4", t = head ? c.textContent.trim() : "";
        if (head && LESSON_EXO.test(t)) { exo = document.createElement("div"); exo.className = "nbl-exo"; c.parentNode.insertBefore(exo, c); c.classList.add("nbl-exo-h"); exo.appendChild(c); return; }
        if (head && c.tagName === "H3" && !LESSON_SUB.test(t)) { exo = null; return; }
        if (exo) { if (head) c.classList.add("nbl-sub"); exo.appendChild(c); }
      });
      var n = 0;
      Array.prototype.forEach.call(el.querySelectorAll(":scope > *, :scope > .nbl-exo > *"), function (c) {
        if (c.classList.contains("nbl-exo")) return;
        if (c.tagName === "H3") n++;
        c.classList.add("nbl-s" + (n % 5));
        if (c.tagName === "H3" || c.tagName === "H4") { var s = document.createElement("span"); s.className = "nbl-u"; while (c.firstChild) s.appendChild(c.firstChild); c.appendChild(s); }
        if (c.tagName === "TABLE") { var w = document.createElement("div"); w.className = "nbl-table nbl-s" + (n % 5); c.parentNode.insertBefore(w, c); w.appendChild(c); }
      });
      el.querySelectorAll("p, li").forEach(function (p) {
        if (p.closest("table")) return;
        if (p.tagName === "P" && /^\s*(\d{1,2}|[a-z])\s?[.)°]\s/i.test(p.textContent)) p.classList.add("nbl-num");
        var t = p.textContent.trim(), hit = LESSON_LEADS.find(function (l) { return l[0].test(t); });
        if (!hit) return;
        var colon = t.indexOf(":"); if (colon < 2 || colon > 60) { if (t.length < 50) p.classList.add(hit[1]); return; }
        var left = p.textContent.indexOf(":") + 1, span = document.createElement("span"); span.className = hit[1];
        var r = document.createRange(), walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT), node, acc = 0;
        while ((node = walk.nextNode())) { if (acc + node.data.length >= left) { if (node.parentElement.closest(".math-chip")) return; r.setStart(p, 0); r.setEnd(node, left - acc); break; } acc += node.data.length; }
        try { var f = r.extractContents(); span.appendChild(f); p.insertBefore(span, p.firstChild); p.querySelectorAll("strong, em").forEach(function (x) { if (!x.textContent.trim()) x.remove(); }); } catch (e) {}
      });
      el.querySelectorAll("img").forEach(function (im) { if (!im.complete) im.addEventListener("load", function () { lessonSnap(el); }); });
    }
    lessonSnap(el);
  }
  function lessonBase(host, tag, cls) {
    var b = document.createElement(tag); b.className = cls || ""; b.style.cssText = "visibility:hidden;margin:0;padding:0;top:0;position:relative";
    b.innerHTML = '<span class="' + (tag === "h3" || tag === "h4" ? "nbl-u" : "") + '">x<i style="display:inline-block;width:0;height:0"></i></span>'; host.appendChild(b);
    var y = b.querySelector("i").getBoundingClientRect().bottom - b.getBoundingClientRect().top; b.remove(); return y;
  }
  function lessonAscent(host, tag) {
    var b = document.createElement(tag); b.style.cssText = "visibility:hidden;margin:0;padding:0;top:0;position:relative";
    b.innerHTML = '<span>x<i style="display:inline-block;width:0;height:0"></i></span>'; host.appendChild(b);
    var y = b.querySelector("i").getBoundingClientRect().bottom - b.querySelector("span").getClientRects()[0].top; b.remove(); return y;
  }
  function lessonSnap(el) {
    if (!el.isConnected) return;
    var probe = document.createElement("div"); probe.style.cssText = "height:var(--g);visibility:hidden"; el.appendChild(probe);
    var g = probe.getBoundingClientRect().height; probe.remove(); if (!(g > 8)) return;
    var base = lessonBase(el, "p");
    ["p", "h3", "h4"].forEach(function (t) { el.style.setProperty("--uy-" + t, (lessonAscent(el, t) + g * 0.045) + "px"); });
    ["h3", "h4"].forEach(function (t) { el.style.setProperty("--shift-" + t, (base - lessonBase(el, t)) + "px"); });
    var h1 = el.querySelector(".nbl-title"), top = el.getBoundingClientRect().top;
    el.style.setProperty("--base", (parseFloat(getComputedStyle(el).paddingTop) + base + g * 0.045) + "px");
    var parts = ["p", "ul > li", "ol > li", "h3", "h4", "figure", "pre", ".nbl-table", ".prose-callout", ".prose-figure-removed", ".fiche-frise", ".fiche-cols", ".fc-box", "hr", ".nbl-top", ".nbl-title"];
    var items = el.querySelectorAll(parts.map(function (p) { return ":scope > " + p + ", :scope > .nbl-exo > " + p; }).join(", "));
    Array.prototype.forEach.call(items, function (b) { b.style.marginBottom = ""; });
    Array.prototype.forEach.call(items, function (b) {
      var h = b.getBoundingClientRect().height, gap = Math.ceil((h - 1) / g) * g - h, mb = parseFloat(getComputedStyle(b).marginBottom) || 0;
      if (Math.abs(gap) > 0.2) b.style.marginBottom = (mb + gap) + "px";
    });
  }
  function lessonEnhanceAll() { document.querySelectorAll(".nb-lesson").forEach(lessonEnhance); }
  var lessonTimer = 0;
  window.addEventListener("resize", function () { clearTimeout(lessonTimer); lessonTimer = setTimeout(lessonEnhanceAll, 120); });
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", lessonEnhanceAll);

  var courseMediaJobs = {};
  function courseTabRefresh(id) { var p = parseHash(); if (p[0] === "course" && p[1] === id && (p[2] === "videos" || p[2] === "flashcards")) render(); }
  function youtubeId(u) { var m = /(?:youtube\.com\/(?:watch\?(?:[^\s"'<>)]*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(u || ""); return m ? m[1] : ""; }
  function youtubeCheck(id, said) {
    return new Promise(function (ok) {
      var im = new Image(), t = setTimeout(function () { ok(false); }, 6000);
      im.onload = function () { clearTimeout(t); ok(im.naturalWidth > 130); }; im.onerror = function () { clearTimeout(t); ok(false); };
      im.src = "https://i.ytimg.com/vi/" + id + "/mqdefault.jpg";
    }).then(function (exists) {
      if (!exists) return null;
      return fetchWithTimeout("https://noembed.com/embed?url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id), {}, 8000).then(function (r) { return r.json(); }).then(function (d) {
        if (!d || d.error || !d.title) return null;
        var norm = function (s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(function (w) { return w.length > 3; }); };
        var a = norm(d.title), b = norm(said);
        return a.some(function (w) { return b.indexOf(w) >= 0; }) ? { title: d.title, sub: d.author_name || "YouTube", id: id, url: "https://www.youtube.com/watch?v=" + id } : null;
      }).catch(function () { return null; });
    });
  }
  function courseVideoQueries(course, loc) { return [course.title + " " + loc.chapter.name, loc.chapter.name + " cours " + loc.subject.name, loc.chapter.name + " exercices corrigés " + loc.subject.name].map(function (q) { return q.replace(/\s+/g, " ").trim(); }); }
  function findCourseVideos(course) {
    var loc = locateCourse(course.id); if (!loc || courseMediaJobs["v" + course.id] || !getApiKey()) return Promise.resolve();
    courseMediaJobs["v" + course.id] = 1; course.videoTried = Date.now();
    var text = "Cherche sur internet 6 vraies vidéos YouTube en français qui expliquent bien ce cours à un élève (chaînes de professeurs, niveau adapté). Matière : " + loc.subject.name + ". Chapitre : " + loc.chapter.name + ". Cours : " + course.title + ".\nContenu :\n" + stripFigureMarkdown(course.transcription || "").slice(0, 2500) + "\n\nRéponds une vidéo par ligne, rien d'autre, au format : titre exact | adresse complète https://www.youtube.com/watch?v=... N'écris que des adresses réellement trouvées ; sinon, n'écris rien.";
    return callGeminiSearch([{ text: text }]).then(function (res) {
      var seen = {}, list = [];
      String(res.text || "").split("\n").concat((res.sources || []).map(function (s) { return s.title + " | " + s.uri; })).forEach(function (l) { var id = youtubeId(l); if (id && !seen[id]) { seen[id] = 1; list.push({ id: id, said: l.replace(/https?:\S+/g, "") + " " + course.title + " " + loc.chapter.name }); } });
      return Promise.all(list.slice(0, 10).map(function (x) { return youtubeCheck(x.id, x.said); }));
    }).then(function (ok) { ok = ok.filter(Boolean).slice(0, 5); if (ok.length) course.videos = ok; }).catch(function () {}).then(function () { delete courseMediaJobs["v" + course.id]; saveDB(); courseTabRefresh(course.id); });
  }
  App.findCourseVideos = function (id) { var loc = locateCourse(id); if (!loc) return; if (!getApiKey()) { App.openApiKeyModal(); return; } findCourseVideos(loc.course); render(); };
  function courseVideosHtml(course) {
    var loc = locateCourse(course.id), vids = (course.videos || []).filter(function (v) { return youtubeId(v.url); }), busy = !!courseMediaJobs["v" + course.id];
    if (!vids.length && !busy && !course.videoTried && getApiKey()) { busy = true; Promise.resolve().then(function () { findCourseVideos(course); }); }
    return (busy ? '<div class="processing-box">' + genLogo() + '<span>Recherche de vidéos qui expliquent ce cours…</span></div>' : "") +
      (vids.length ? '<div class="vid-grid">' + vids.map(function (v) { var id = youtubeId(v.url); return '<a class="vid-card" href="https://www.youtube.com/watch?v=' + id + '" target="_blank" rel="noopener noreferrer"><img src="https://i.ytimg.com/vi/' + id + '/mqdefault.jpg" alt="" loading="lazy"><b>' + esc(v.title) + '</b><span>' + esc(v.sub || "YouTube") + '</span></a>'; }).join("") + '</div>'
        : !busy ? '<p class="dp-empty-note">Je n\'ai pas trouvé de vidéo sûre pour ce cours. Voici des recherches toutes prêtes :</p>' : "") +
      '<div class="vid-search">' + courseVideoQueries(course, loc).map(function (q) { return '<a class="btn btn-ghost btn-sm" style="width:auto" target="_blank" rel="noopener noreferrer" href="https://www.youtube.com/results?search_query=' + encodeURIComponent(q) + '">🔎 ' + esc(q) + '</a>'; }).join("") +
      '<button class="btn btn-ghost btn-sm" style="width:auto"' + (busy ? " disabled" : "") + ' onclick="App.findCourseVideos(\'' + course.id + '\')">🔄 Chercher d\'autres vidéos</button></div>';
  }

  var FLASH_SCHEMA = { type: "object", properties: { flashcards: { type: "array", items: { type: "object", properties: { q: { type: "string" }, a: { type: "string" } }, required: ["q", "a"] } } }, required: ["flashcards"] };
  function makeFlashcards(course) {
    var loc = locateCourse(course.id); if (!loc || courseMediaJobs["f" + course.id]) return Promise.resolve();
    courseMediaJobs["f" + course.id] = 1;
    var role = exoRole(course.title), source = stripFigureMarkdown(course.transcription || "");
    var prompt = "Crée les flashcards de révision d'un élève. Matière : " + loc.subject.name + ", chapitre : " + loc.chapter.name + ", document : « " + course.title + " ».\n\n" + COURSE_LANGUAGE_RULE +
      "Couvre TOUT ce qu'il faut savoir sans regarder le cours : chaque définition, date, personne, formule (avec ses unités et quand s'en servir), propriété, règle et ses exceptions, méthode (étapes), cause et conséquence, différence entre deux notions qu'on confond. Une idée par carte, de 15 cartes pour un document court à 50 pour un long.\n" +
      "\"q\" : une vraie question précise qui se comprend seule et fait réfléchir (varie : définir, expliquer pourquoi, distinguer, donner la condition, reconnaître l'erreur, compléter, appliquer à un mini-cas). Jamais « que dit le cours », jamais la réponse dans la question, jamais un détail d'exemple.\n" +
      "\"a\" : la réponse complète et courte. Pour une définition, une formule ou une date : exactement celle du cours.\n" +
      (role === "cours" || role === "methode" ? "" : "Ce document n'est pas une leçon : les cartes portent sur les méthodes, réflexes et pièges qu'il fait travailler, pas sur ses énoncés.\n") +
      "Formules en LaTeX entre $...$, jamais de commande de couleur.\n\nDOCUMENT :\n" + source;
    return callGemini([{ text: prompt }], FLASH_SCHEMA, 32768, 150000, { lite: true }).then(function (d) {
      var old = {}; (course.flashcards || []).forEach(function (f) { old[String(f.q).toLowerCase().trim()] = f.status; });
      var cards = (d.flashcards || []).filter(function (f) { return f && String(f.q || "").trim() && String(f.a || "").trim(); }).map(function (f) { return { id: uid(), q: f.q, a: f.a, status: old[f.q.toLowerCase().trim()] || "new" }; });
      if (cards.length < 3) throw new Error("pas assez de cartes, réessaie");
      course.flashcards = cards; delete fcState[course.id]; toast("🃏 " + cards.length + " flashcards prêtes");
    }).catch(function (e) { toast("Flashcards non créées : " + (e && e.message || "erreur"), { status: e && e.status, detail: e && e.detail }); }).then(function () { delete courseMediaJobs["f" + course.id]; saveDB(); courseTabRefresh(course.id); });
  }
  App.makeFlashcards = function (id) {
    var loc = locateCourse(id); if (!loc) return;
    if (!getApiKey()) { App.openApiKeyModal(); return; }
    if ((loc.course.flashcards || []).some(function (f) { return f.status === "known"; }) && !confirm("Refaire toutes les flashcards ? Ta progression sur les cartes actuelles sera perdue.")) return;
    makeFlashcards(loc.course); render();
  };
  function courseFlashHtml(course) {
    var busy = !!courseMediaJobs["f" + course.id];
    return '<div class="fc-tools"><button class="btn btn-ghost btn-sm" style="width:auto"' + (busy ? " disabled" : "") + ' onclick="App.makeFlashcards(\'' + course.id + '\')">' + (busy ? "⏳ Création des cartes…" : (course.flashcards || []).length ? "✨ Refaire des flashcards plus complètes" : "✨ Créer les flashcards") + '</button></div>' + renderFlashcards(course);
  }

  function buildLessonPrintHtml(course, subjectName, chapterName, includeExplanation) {
    var fs = (13 * getPrintScale()).toFixed(2), sub = (subjectName || "") + (chapterName ? " · " + chapterName : "");
    return '<style>.print-lesson .nb.nb-lesson{--fs:' + fs + 'px}</style><div class="content print-lesson">' + lessonPageHtml(course.transcription, course.figures, course.title, sub) +
      (includeExplanation && course.explanation ? '<div class="print-lesson-break"></div>' + lessonPageHtml(course.explanation, course.figures, "Explication — " + course.title, sub) : "") + "</div>";
  }
  function lessonPrepareForPrint(area) {
    if (!area.querySelector(".nb-lesson")) return;
    var keep = area.getAttribute("style") || "";
    area.setAttribute("style", "display:block;position:absolute;left:-20000px;top:0;width:720px");
    area.querySelectorAll(".nb-lesson").forEach(function (el) { el._done = false; lessonEnhance(el); });
    area.setAttribute("style", keep);
  }
