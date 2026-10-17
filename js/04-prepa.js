"use strict";
// Studino — prépa contrôle (génération et séances)
// Fichier chargé dans l'ordre par index.html : les fichiers partagent les mêmes variables globales.

  /* ---------------- Prépa examens ---------------- */
  function epData() { return userData().examPreps; }
  function epFind(id) { return epData().find(function (p) { return p.id === id; }); }
  function epScopeCourses(scope) {
    var subj = findSubject(scope.subjectId);
    if (!subj) return [];
    if (scope.level === "subject") {
      var all = [];
      subj.themes.forEach(function (t) { t.chapters.forEach(function (c) { c.courses.forEach(function (co) { if (dpCourseHasContent(co)) all.push(co); }); }); });
      return all;
    }
    var theme = findTheme(subj, scope.themeId);
    if (!theme) return [];
    if (scope.level === "theme") {
      var all2 = [];
      theme.chapters.forEach(function (c) { c.courses.forEach(function (co) { if (dpCourseHasContent(co)) all2.push(co); }); });
      return all2;
    }
    var chap = findChapter(theme, scope.chapterId);
    if (!chap) return [];
    if (scope.level === "chapter") return chap.courses.filter(dpCourseHasContent);
    var course = findCourse(chap, scope.courseId);
    return course && dpCourseHasContent(course) ? [course] : [];
  }
  function epScopeLabel(scope) {
    var subj = findSubject(scope.subjectId);
    if (!subj) return "";
    if (scope.level === "subject") return subj.name;
    var theme = findTheme(subj, scope.themeId);
    if (!theme) return subj.name;
    if (scope.level === "theme") return subj.name + " · " + theme.name;
    var chap = findChapter(theme, scope.chapterId);
    if (!chap) return subj.name + " · " + theme.name;
    if (scope.level === "chapter") return subj.name + " · " + theme.name + " · " + chap.name;
    var course = findCourse(chap, scope.courseId);
    return subj.name + " · " + theme.name + " · " + chap.name + (course ? " · " + course.title : "");
  }
  function epPad2(n) { return String(n).padStart(2, "0"); }
  function epTodayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + epPad2(d.getMonth() + 1) + "-" + epPad2(d.getDate());
  }
  function epDateFromStr(s) {
    var p = s.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function epDaysBetween(fromStr, toStr) {
    return Math.round((epDateFromStr(toStr) - epDateFromStr(fromStr)) / 86400000);
  }
  function epAddDays(dateStr, n) {
    var d = epDateFromStr(dateStr);
    d.setDate(d.getDate() + n);
    return d.getFullYear() + "-" + epPad2(d.getMonth() + 1) + "-" + epPad2(d.getDate());
  }
  function epFormatDateFr(dateStr) {
    return epDateFromStr(dateStr).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  }
  // Décalages (en jours depuis aujourd'hui) auxquels une séance doit être prévue : tant qu'il reste
  // plus de 16 jours avant l'examen, une séance tous les 2 jours ; dans les 16 derniers jours, tous les jours.
  function epScheduleOffsets(dayCount) {
    var offsets = [];
    if (dayCount <= 16) {
      for (var o = 0; o < dayCount; o++) offsets.push(o);
      return offsets;
    }
    var farCount = dayCount - 16;
    for (var o1 = 0; o1 < farCount; o1 += 2) offsets.push(o1);
    for (var o2 = farCount; o2 < dayCount; o2++) offsets.push(o2);
    return offsets;
  }

  var EXAM_PLAN_SCHEMA = {
    type: "object",
    properties: {
      overview: { type: "string", description: "Stratégie de révision globale en 2-3 phrases motivantes, en français." },
      practiceShare: { type: "integer", description: "Part (0 à 100) des exercices d'application dans les séances, le reste étant de la connaissance du cours à restituer." },
      modeReason: { type: "string", description: "Une phrase qui explique à l'élève pourquoi cette répartition cours/exercices (vide si le type de révision a été imposé)." },
      days: {
        type: "array",
        description: "Un élément par jour de révision disponible avant l'examen.",
        items: {
          type: "object",
          properties: {
            offsetDays: { type: "integer", description: "Nombre de jours après aujourd'hui (0 = aujourd'hui)." },
            minutes: { type: "integer", description: "Minutes de travail conseillées ce jour-là, à titre indicatif seulement (typiquement 20 à 60, davantage si le jour couvre beaucoup de par cœur ou des exercices poussés) — la séance réelle peut dépasser cette estimation, ce n'est jamais un problème." },
            focus: { type: "string", description: "Objectif du jour en une phrase courte." },
            topics: { type: "array", items: { type: "string" }, description: "Notions précises à réviser ce jour-là (2 à 6)." }
          },
          required: ["offsetDays", "minutes", "focus", "topics"]
        }
      }
    },
    required: ["overview", "practiceShare", "modeReason", "days"]
  };
  // Type de révision d'une prépa : « auto » = l'IA choisit la part d'exercices selon la matière et le
  // contenu (affichée à l'élève), sinon imposé par l'élève (lui seul sait ce que le prof a annoncé).
  var EP_REVISION_MODES = [["auto", "Auto (recommandé)"], ["cours", "Apprendre le cours"], ["exos", "Exercices d'application"]];
  function epRevisionModeHint(mode) {
    if (mode === "cours") return "Uniquement le par cœur : définitions, dates, formules et notions à savoir restituer.";
    if (mode === "exos") return "Uniquement de la pratique : appliquer les méthodes et formules sur des exercices.";
    return "L'IA choisit le dosage cours / exercices selon la matière et ton contenu (ex. surtout des exercices en maths, surtout du cours en histoire), et t'explique son choix.";
  }
  function epRevisionModeRule(mode) {
    if (mode === "cours") return "TYPE DE RÉVISION imposé par l'élève : APPRENDRE LE COURS. Les séances portent sur la mémorisation et la restitution (définitions, dates, formules, notions, raisonnements à savoir expliquer), PAS sur des exercices d'application. \"practiceShare\" = 0 et \"modeReason\" vide.\n";
    if (mode === "exos") return "TYPE DE RÉVISION imposé par l'élève : EXERCICES D'APPLICATION. Les séances portent sur la pratique : appliquer les méthodes, formules et raisonnements du cours sur des exercices, de plus en plus difficiles ; presque pas de récitation. \"practiceShare\" = 100 et \"modeReason\" vide.\n";
    return "TYPE DE RÉVISION : c'est à toi de choisir la bonne répartition entre connaissance du cours et exercices d'application, d'après la matière et le contenu ci-dessus. \"practiceShare\" (0-100) = part des exercices d'application : élevée (70 à 90) pour un contenu surtout fait de méthodes, calculs, démonstrations ou savoir-faire (maths, physique-chimie, informatique...) ; faible (10 à 30) pour un contenu surtout à mémoriser (dates, définitions, faits, vocabulaire : histoire, géographie, SVT descriptive...) ; intermédiaire si c'est mixte. \"modeReason\" : une phrase claire pour l'élève qui explique ce choix (ex. « Ce chapitre est surtout fait de méthodes de calcul : la prépa est orientée exercices. »). Les \"focus\" et \"topics\" des jours suivent cette répartition.\n";
  }
  function buildExamPlanPrompt(title, examDateStr, todayStr, dayCount, courses, priorTopics, offsets, mode) {
    var sourceBlocks = courses.map(function (co) {
      return "### " + co.title + "\n" + stripFigureMarkdown(co.transcription || "");
    }).join("\n\n");
    var continuityBlock = "";
    if (priorTopics && priorTopics.length) {
      continuityBlock = "\nATTENTION, ceci est une RÉGÉNÉRATION d'un planning déjà existant (l'élève a ajouté du contenu à ses cours et redemande un planning à jour) : l'élève a déjà une progression enregistrée sur certaines notions, identifiées par leur nom EXACT ci-dessous. Pour toute notion déjà présente dans cette liste qui reste pertinente pour l'examen, réutilise EXACTEMENT le même intitulé (mot pour mot) dans \"topics\" afin de ne pas perdre sa progression. N'invente un nouvel intitulé que pour une notion réellement nouvelle ou absente de cette liste.\nNotions déjà suivies : " + priorTopics.join(" | ") + "\n";
    }
    return "Tu es un coach de révision pour un élève francophone qui prépare : « " + title + " ».\n" +
      "Aujourd'hui : " + todayStr + ". Date de l'examen : " + examDateStr + ". Il reste exactement " + dayCount + " jour(s) avant l'examen (le jour de l'examen lui-même n'est pas un jour de révision).\n" +
      continuityBlock + "\n" +
      epRevisionModeRule(mode) + "\n" +
      "Voici le contenu à réviser :\n\n" + sourceBlocks + "\n\n" +
      "Certains jours parmi ces " + dayCount + " sont des jours de repos SANS séance (pour ne pas surcharger l'élève quand l'examen est encore loin). Voici la liste EXACTE des décalages en jours depuis aujourd'hui (offsetDays, 0 = aujourd'hui) pour lesquels une séance est prévue : " + offsets.join(", ") + ". Produis EXACTEMENT une entrée par offsetDays listé ici, ni plus ni moins (n'en ajoute aucun pour les jours de repos, n'en oublie aucun de la liste), en respectant ces principes :\n" +
      "- Chaque séance dure 30 minutes, ni plus ni moins (\"minutes\" = 30) : le principe est de travailler PEU mais SOUVENT, avec de la répétition. Choisis donc pour chaque jour 2 à 4 notions précises qui tiennent dans 30 minutes, plutôt que d'en entasser beaucoup.\n" +
      "- Couvre l'intégralité du contenu ci-dessus au moins une fois d'ici la fin du planning.\n" +
      "- Plus on se rapproche de l'examen, plus les jours prévus doivent revenir sur les notions déjà vues plus tôt (en plus des notions nouvelles du jour), façon répétition espacée, pour consolider — ce n'est pas qu'un simple découpage linéaire du programme.\n" +
      "- Pour chaque jour prévu, \"focus\" résume l'objectif du jour en une phrase, et \"topics\" liste 2 à 6 notions précises concernées.\n\n" +
      "\"overview\" résume ta stratégie globale en 2-3 phrases motivantes, en français.\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni, en français.";
  }
  function generateExamPlan(title, examDateStr, todayStr, dayCount, courses, priorTopics, offsets, mode) {
    var parts = [{ text: buildExamPlanPrompt(title, examDateStr, todayStr, dayCount, courses, priorTopics, offsets, mode) }];
    return callGemini(parts, EXAM_PLAN_SCHEMA);
  }
  function runExamPlanGeneration(prep) {
    prep.planStatus = "processing";
    prep.planError = null;
    genStart(prep.id, [{ label: "Préparation du planning", weight: 100, type: "examPlan" }]);
    saveDB(); render();
    var courses = epScopeCourses(prep.scope);
    if (!courses.length) {
      prep.planStatus = "error";
      prep.planError = "Aucun cours généré dans cette sélection.";
      saveDB(); render();
      return;
    }
    var today = epTodayStr();
    var dayCount = Math.max(1, epDaysBetween(today, prep.examDate));
    var oldDays = prep.days || [];
    // Les jours déjà passés ne sont jamais retouchés, quel que soit le résultat (fait ou manqué).
    var pastDays = oldDays.filter(function (d) { return d.date < today; });
    // Les jours (aujourd'hui ou futurs) dont la séance est déjà terminée sont figés aussi : on ne les redemande pas à l'IA.
    var doneFutureDays = oldDays.filter(function (d) {
      return d.date >= today && prep.sessions && prep.sessions[d.date] && prep.sessions[d.date].status === "done";
    });
    var lockedDates = {};
    pastDays.concat(doneFutureDays).forEach(function (d) { lockedDates[d.date] = true; });
    var scheduleOffsets = epScheduleOffsets(dayCount).filter(function (o) { return !lockedDates[epAddDays(today, o)]; });
    var finishPlan = function (newDays) {
      prep.days = pastDays.concat(doneFutureDays).concat(newDays).sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
      var allTopics = [];
      prep.days.forEach(function (d) { (d.topics || []).forEach(function (t) { if (allTopics.indexOf(t) === -1) allTopics.push(t); }); });
      prep.topics = allTopics;
      // On garde la progression (score/streak) des notions toujours présentes dans le nouveau planning, on jette le reste.
      var oldMastery = prep.topicMastery || {};
      var newMastery = {};
      allTopics.forEach(function (t) { if (oldMastery[t]) newMastery[t] = oldMastery[t]; });
      prep.topicMastery = newMastery;
      genEnd(prep.id, true);
      prep.planStatus = "ready";
      saveDB();
      toast("Planning de révision prêt · " + prep.title);
      render();
    };
    if (!scheduleOffsets.length) {
      // Tout ce qui reste à planifier est déjà figé (passé ou déjà fait) : rien à régénérer.
      finishPlan([]);
      return;
    }
    var priorTopics = (prep.topics || []).slice();
    generateExamPlan(prep.title, prep.examDate, today, dayCount, courses, priorTopics, scheduleOffsets, prep.revisionMode || "auto").then(function (data) {
      prep.overview = data.overview || prep.overview || "";
      var mode = prep.revisionMode || "auto";
      var share = Math.round(Number(data.practiceShare));
      prep.practiceShare = mode === "cours" ? 0 : mode === "exos" ? 100 : (isFinite(share) ? Math.max(0, Math.min(100, share)) : 50);
      prep.modeReason = mode === "auto" ? String(data.modeReason || "") : "";
      var offsetSet = {};
      scheduleOffsets.forEach(function (o) { offsetSet[o] = true; });
      var newDays = (data.days || [])
        .filter(function (d) { return offsetSet[Math.max(0, d.offsetDays || 0)]; })
        .map(function (d) {
          return { date: epAddDays(today, Math.max(0, d.offsetDays || 0)), minutes: EP_SESSION_MINUTES, focus: d.focus || "", topics: d.topics || [] };
        });
      finishPlan(newDays);
    }).catch(function (err) {
      genEnd(prep.id, false);
      prep.planStatus = "error";
      prep.planError = err.message || "Erreur inconnue";
      prep.planErrorStatus = err.status || null;
      prep.planErrorDetail = err.detail || null;
      saveDB();
      toast("Échec du planning : " + prep.planError, { status: prep.planErrorStatus, detail: prep.planErrorDetail });
      render();
    });
  }
  function epQuestionPool(courses) {
    // Trois "kinds" uniformisés : qcm/open reprennent les questions du contrôle du cours, exercise
    // reprend les VRAIS exercices multi-étapes du cours (mêmes objets que dans l'onglet Exercices).
    var pool = [];
    courses.forEach(function (co) {
      (co.quizQuestions || []).forEach(function (q) {
        if (q.type === "qcm") pool.push({ id: q.id, kind: "qcm", category: q.category || "", prompt: q.prompt, choices: q.choices, correctIndex: q.correctIndex, explanation: q.explanation, figureSvg: q.figureSvg || "", courseId: co.id, courseTitle: co.title });
        else pool.push({ id: q.id, kind: "open", category: q.category || "", prompt: q.prompt, answer: q.answer, explanation: q.explanation, figureSvg: q.figureSvg || "", courseId: co.id, courseTitle: co.title });
      });
      (co.exercises || []).forEach(function (ex) {
        pool.push({ id: ex.id, kind: "exercise", category: "", prompt: ex.prompt, solution: ex.solution, figureSvg: ex.figureSvg || "", courseId: co.id, courseTitle: co.title });
      });
    });
    return pool;
  }
  /* ---------------- Séances de 30 minutes ----------------
     La prépa repose sur « peu, mais souvent » : une séance dure 30 minutes, imposées. Chaque élément a
     un temps estimé, et la séance est remplie jusqu'à 30 minutes, pas au-delà (avant, une séance pouvait
     dépasser 1 h). Pas de QCM (trop faciles, ils ne préparent pas à un vrai contrôle) : des questions à
     rédiger et des exercices. Le sujet de méthodologie (long) ne revient qu'une séance sur trois. */
  var EP_SESSION_MINUTES = 30;
  var EP_FRESH_EXERCISE_MINUTES = 10;
  var EP_METHODO_MINUTES = 20;
  function epItemMinutes(it) {
    if (!it) return 0;
    if (it.kind === "methodo") return EP_METHODO_MINUTES;
    if (it.kind === "exercise") return it.fresh ? EP_FRESH_EXERCISE_MINUTES : 8;
    if (it.kind === "qcm") return 1;
    if (it.parts) return it.parts.length * 2; // question de cours regroupée : 2 min par partie
    return it.category === "application" ? 3 : 2;
  }
  // Composition d'une séance selon le type de révision et la méthodologie éventuelle.
  function epSessionPlan(prep) {
    var mode = prep.revisionMode || "auto";
    var share = typeof prep.practiceShare === "number" ? prep.practiceShare : 50;
    var doneCount = Object.keys(prep.sessions || {}).filter(function (k) { return prep.sessions[k] && prep.sessions[k].status === "done"; }).length;
    var methodo = !!prep.methodologyId && doneCount % 3 === 0;
    var minutes = EP_SESSION_MINUTES - (methodo ? EP_METHODO_MINUTES : 0);
    var fresh;
    if (methodo) fresh = 0;
    else if (mode === "cours") fresh = 1;            // un exercice de restitution, le reste en questions de cours
    else if (mode === "exos") fresh = 2;             // pratique : deux exercices
    else fresh = share >= 60 ? 2 : share >= 25 ? 1 : 0;
    return { methodo: methodo, fresh: fresh, questionMinutes: Math.max(0, minutes - fresh * EP_FRESH_EXERCISE_MINUTES) };
  }
  function epPoolMinutes(pool) { return pool.reduce(function (s, it) { return s + epItemMinutes(it); }, 0); }
  function epPickDayQuestions(pool, dayEntry, prep, plan) {
    if (!pool.length) return [];
    plan = plan || epSessionPlan(prep);
    // Pas de QCM, sauf s'il n'y a vraiment rien d'autre dans les cours.
    var noQcm = pool.filter(function (it) { return it.kind !== "qcm"; });
    if (noQcm.length) pool = noQcm;
    var topicsLower = (dayEntry.topics || []).map(function (t) { return t.toLowerCase(); });
    var scored = pool.map(function (item) {
      var score = Math.random() * 2;
      var hay = (item.prompt + " " + item.courseTitle).toLowerCase();
      (prep.topics || []).forEach(function (topic) {
        if (hay.indexOf(topic.toLowerCase()) === -1) return;
        var t = prep.topicMastery && prep.topicMastery[topic];
        var mastery = t ? t.score : 0;
        score += ((100 - mastery) / 100) * 14; // faible maîtrise = forte priorité
        if (t && t.streak <= -2) score += 6; // erreurs répétées = encore plus prioritaire
      });
      topicsLower.forEach(function (t) { if (t && hay.indexOf(t) !== -1) score += 5; });
      var isMemo = item.category === "definition" || item.category === "formule";
      var matchesToday = topicsLower.some(function (t) { return t && hay.indexOf(t) !== -1; });
      return { item: item, score: score, isMemo: isMemo, matchesToday: matchesToday };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    var picked = [], pickedIds = {}, used = 0;
    var add = function (it) { if (it && !pickedIds[it.id]) { pickedIds[it.id] = true; picked.push(it); used += epItemMinutes(it); } };
    // 1. Exercices : autant de places que d'exercices prévus (ils seront remplacés par des exercices
    //    inédits ; ceux du cours servent de secours si la création échoue).
    var exercises = scored.filter(function (s) { return s.item.kind === "exercise"; });
    var exUsed = 0;
    for (var e = 0; e < exercises.length && exUsed < plan.fresh; e++) { add(exercises[e].item); exUsed++; }
    var exerciseMinutes = used;
    // 2. Questions à rédiger jusqu'à la durée prévue : d'abord le par cœur des notions du jour, puis selon
    //    la part cours / application voulue, par priorité (notions faibles et pas revues depuis longtemps).
    var questions = scored.filter(function (s) { return s.item.kind !== "exercise"; });
    var share = typeof prep.practiceShare === "number" ? prep.practiceShare / 100 : 0.5;
    var budget = plan.questionMinutes;
    var appBudget = Math.round(budget * share), knowBudget = budget - appBudget;
    var qUsed = function (filter) { return picked.filter(function (p) { return p.kind !== "exercise" && filter(p); }).reduce(function (s, p) { return s + epItemMinutes(p); }, 0); };
    var isApp = function (it) { return it.category === "application"; };
    questions.forEach(function (s) {
      if (s.isMemo && s.matchesToday && qUsed(function (p) { return !isApp(p); }) + epItemMinutes(s.item) <= knowBudget) add(s.item);
    });
    questions.forEach(function (s) {
      var app = isApp(s.item);
      var cap = app ? appBudget : knowBudget;
      if (qUsed(function (p) { return isApp(p) === app; }) + epItemMinutes(s.item) <= cap) add(s.item);
    });
    // Reste du temps (un type manquait) : complété avec ce qu'il reste, sans dépasser la durée.
    questions.forEach(function (s) { if (used - exerciseMinutes + epItemMinutes(s.item) <= budget) add(s.item); });
    if (!picked.length && scored.length) add(scored[0].item);
    picked = epGroupCourseQuestions(picked);
    for (var j = picked.length - 1; j > 0; j--) { var k = Math.floor(Math.random() * (j + 1)); var t = picked[j]; picked[j] = picked[k]; picked[k] = t; }
    return picked;
  }
  // Questions de cours développées : au lieu d'une notion par question (« donne la définition de X »),
  // les questions de cours d'un même cours sont regroupées par 2 ou 3 en UNE question à plusieurs parties
  // (« 1. définis X  2. définis Y  3. définis Z »), corrigée d'un bloc. Le temps total ne change pas.
  function epGroupCourseQuestions(items) {
    var isCourseQ = function (it) { return it.kind === "open" && it.category !== "application" && !it.parts; };
    var byCourse = {}, order = [];
    items.forEach(function (it) {
      if (!isCourseQ(it)) return;
      var key = it.courseId || "?";
      if (!byCourse[key]) { byCourse[key] = []; order.push(key); }
      byCourse[key].push(it);
    });
    var grouped = {}, out = [];
    order.forEach(function (key) {
      var list = byCourse[key];
      // Paquets de 3 (ou 2 pour finir), jamais une question seule si on peut l'éviter.
      for (var i = 0; i < list.length; ) {
        var left = list.length - i;
        var size = left === 4 ? 2 : Math.min(3, left);
        var chunk = list.slice(i, i + size);
        i += size;
        if (chunk.length === 1) { out.push(chunk[0]); grouped[chunk[0].id] = true; continue; }
        chunk.forEach(function (c) { grouped[c.id] = true; });
        out.push({
          id: "grp-" + chunk.map(function (c) { return c.id; }).join("-"),
          kind: "open", category: "definition", parts: chunk.map(function (c) { return c.id; }),
          courseId: chunk[0].courseId, courseTitle: chunk[0].courseTitle,
          prompt: "Questions de cours (réponds à chaque partie) :\n\n" + chunk.map(function (c, n) { return (n + 1) + ". " + c.prompt; }).join("\n\n"),
          answer: chunk.map(function (c, n) { return (n + 1) + ". " + (c.answer || ""); }).join("\n\n"),
          explanation: chunk.map(function (c, n) { return c.explanation ? (n + 1) + ". " + c.explanation : ""; }).filter(Boolean).join("\n\n"),
          figureSvg: (chunk.find(function (c) { return c.figureSvg; }) || {}).figureSvg || ""
        });
      }
    });
    return items.filter(function (it) { return !grouped[it.id]; }).concat(out);
  }
  function epFinishSessionAnswer(s, item, yourAnswerText, correctAnswerText, level, mistakes) {
    var wasCorrect = gradeLevelIsSuccess(level);
    s.wasCorrect = wasCorrect;
    s.level = level;
    if (wasCorrect) s.correct++; else s.wrong++;
    s.history.push({ prompt: item.prompt, yourAnswer: yourAnswerText, correctAnswer: correctAnswerText, explanation: item.explanation || "", wasCorrect: wasCorrect, level: level, mistakes: mistakes || [], figureSvg: item.figureSvg || "" });
    epSaveActiveSession(s);
  }
  // Sauvegarde la séance en cours après CHAQUE exercice répondu (pas seulement à la fin) : un refresh,
  // un crash ou une sortie volontaire en plein milieu ne doit jamais faire perdre les exercices déjà
  // faits ni forcer à recommencer le pool du jour depuis zéro.
  function epSaveActiveSession(s) {
    var prep = epFind(s.prepId);
    if (!prep) return;
    prep.activeSession = s;
    saveDB();
  }

  /* --- Baromètre de préparation : un score de maîtrise 0-100 par notion, mis à jour uniquement par
     des réponses vérifiées (jamais par du simple temps passé), avec rendements décroissants près de
     100 et pénalité plus lourde en cas d'erreurs répétées ou de fausse confiance (score déjà haut). --- */
  var EP_MASTERY_WEIGHT = { qcm: 1, open: 1.4, exercise: 2.2 };
  // Points Dino Park gagnés par bonne réponse pendant une séance de prépa — un cran sous les montants
  // équivalents du quiz/exercice dédiés de Dino Park (25 / 150), puisqu'une prépa se rejoue "Refaire la
  // séance" à volonté ; ça reste une vraie récompense quotidienne sans permettre de exploser l'économie.
  var EP_SESSION_POINTS_PER_CORRECT = { qcm: 12, open: 16, exercise: 40 };
  function epSessionPointsEarned(s) {
    var total = 0;
    s.history.forEach(function (h, i) {
      var level = h.level || (h.wasCorrect ? "correct" : "wrong");
      var factor = (GRADE_LEVELS[level] || GRADE_LEVELS.wrong).pointsFactor;
      if (!factor) return;
      var kind = s.pool[i] ? s.pool[i].kind : "qcm";
      total += Math.round((EP_SESSION_POINTS_PER_CORRECT[kind] || EP_SESSION_POINTS_PER_CORRECT.qcm) * factor);
    });
    return total;
  }
  function epNormTopic(t) { return String(t || "").trim().toLowerCase().replace(/\s+/g, " "); }
  function epEnsureTopics(prep) {
    // Filet de sécurité pour les prépas créées avant l'ajout du baromètre (ou dont le champ topics
    // s'est vidé pour une raison quelconque) : reconstruit la liste canonique à partir du planning
    // déjà généré, sans avoir besoin de relancer un appel Gemini ni de tout régénérer.
    if (!prep.topics || !prep.topics.length) {
      var allTopics = [];
      (prep.days || []).forEach(function (d) { (d.topics || []).forEach(function (t) { if (allTopics.indexOf(t) === -1) allTopics.push(t); }); });
      prep.topics = allTopics;
    }
    if (!prep.topicMastery) prep.topicMastery = {};
  }
  function epTopicMastery(prep, topic) {
    var t = prep.topicMastery && prep.topicMastery[topic];
    return t ? t.score : 0;
  }
  function epApplyMasteryUpdate(prep, topic, kind, level) {
    prep.topicMastery = prep.topicMastery || {};
    var t = prep.topicMastery[topic] || { score: 0, streak: 0 };
    var weight = EP_MASTERY_WEIGHT[kind] || 1;
    // factor < 1 fait "monter un peu ou pas" le baromètre selon la réussite réelle de l'exo (1 erreur
    // isolée fait quand même progresser, 2 erreurs pèsent bien moins qu'un vrai "Faux") plutôt que de
    // traiter toute imperfection comme un échec complet ou une réussite totale.
    var factor = (GRADE_LEVELS[level] || GRADE_LEVELS.wrong).masteryFactor;
    if (gradeLevelIsSuccess(level)) {
      t.streak = t.streak > 0 ? t.streak + 1 : 1;
      var room = (100 - t.score) / 100; // rendements décroissants : un sujet déjà solide progresse peu
      // Une notion n'est réellement retestée que quelques fois sur toute la durée d'une prépa (pas à
      // l'infini) : le gain doit donc converger vite pour qu'enchaîner les bonnes réponses comme prévu
      // amène réellement à ~100%, au lieu de plafonner bien avant même avec un sans-faute complet.
      t.score = Math.min(100, t.score + 30 * weight * room * factor);
    } else {
      t.streak = t.streak < 0 ? t.streak - 1 : -1;
      var confidencePenalty = 8 + (t.score / 100) * 12; // casser un score déjà haut fait plus mal (fausse confiance)
      var repeatMultiplier = Math.min(2.2, 1 + (Math.abs(t.streak) - 1) * 0.35); // erreurs répétées = pénalité qui s'aggrave
      t.score = Math.max(0, t.score - confidencePenalty * weight * repeatMultiplier * factor);
    }
    prep.topicMastery[topic] = t;
  }
  function epReadinessPercent(prep) {
    epEnsureTopics(prep);
    var topics = prep.topics || [];
    if (!topics.length) return 0;
    var total = 0;
    topics.forEach(function (t) { total += epTopicMastery(prep, t); });
    return Math.round(total / topics.length);
  }
  function epReadinessLabel(pct) {
    if (pct < 30) return "Pas encore prêt";
    if (pct < 60) return "En cours d'apprentissage";
    if (pct < 80) return "Plutôt bien préparé, encore des lacunes";
    if (pct < 95) return "Presque prêt";
    return "Prêt pour le contrôle";
  }
  var EXAM_TOPIC_MAP_SCHEMA = {
    type: "object",
    properties: {
      mapping: {
        type: "array",
        description: "Une entrée par question de la séance qui correspond clairement à une notion de la liste fournie.",
        items: {
          type: "object",
          properties: {
            index: { type: "integer", description: "Index de la question dans la liste fournie (à partir de 0)." },
            topic: { type: "string", description: "Notion concernée, reprise EXACTEMENT telle qu'elle apparaît dans la liste de notions fournie (aucune reformulation, aucune notion inventée)." }
          },
          required: ["index", "topic"]
        }
      }
    },
    required: ["mapping"]
  };
  function buildExamTopicMapPrompt(topics, history) {
    var topicsList = topics.map(function (t, i) { return (i + 1) + ". " + t; }).join("\n");
    var qList = history.map(function (h, i) { return i + ". [" + (h.wasCorrect ? "Réussi" : "Raté") + "] " + h.prompt; }).join("\n");
    return "Voici la liste des notions prévues pour cette préparation d'examen :\n" + topicsList + "\n\n" +
      "Voici les questions posées lors de la séance de révision d'aujourd'hui, avec le résultat de l'élève :\n" + qList + "\n\n" +
      "Pour CHAQUE question ci-dessus qui correspond clairement à l'une des notions listées, indique dans \"mapping\" son index (celui donné devant la question) et le nom de la notion concernée, repris EXACTEMENT tel qu'il apparaît dans la liste (ne reformule jamais, n'invente jamais de notion absente de la liste). Si une question ne correspond clairement à aucune notion de la liste, ne l'inclus pas.\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni.";
  }
  function generateExamTopicMap(topics, history) {
    var parts = [{ text: buildExamTopicMapPrompt(topics, history) }];
    return callGemini(parts, EXAM_TOPIC_MAP_SCHEMA);
  }
  var EXAM_GAP_FLASHCARDS_SCHEMA = {
    type: "object",
    properties: {
      flashcards: {
        type: "array",
        items: {
          type: "object",
          properties: { q: { type: "string" }, a: { type: "string" } },
          required: ["q", "a"]
        }
      }
    },
    required: ["flashcards"]
  };
  function buildGapFlashcardsPrompt(wrongItems) {
    var lines = wrongItems.map(function (h, i) {
      return (i + 1) + ". Question posée : " + h.prompt + "\nBonne réponse : " + h.correctAnswer + (h.explanation ? "\nExplication : " + h.explanation : "") + (h.mistakes && h.mistakes.length ? "\nErreur(s) précise(s) commise(s) par l'élève : " + h.mistakes.join(" ; ") : "");
    }).join("\n\n");
    return "Un élève francophone a fait les erreurs suivantes pendant une séance de révision :\n\n" + lines + "\n\n" +
      "Pour CHAQUE erreur ci-dessus, crée exactement UNE flashcard de révision (une question courte au recto dans \"q\", une réponse courte et précise au verso dans \"a\") qui cible précisément la notion à l'origine de CETTE erreur. Il y a " + wrongItems.length + " erreur(s) : renvoie EXACTEMENT " + wrongItems.length + " flashcard(s), dans l'ordre des erreurs listées (la 1re pour l'erreur 1, la 2e pour l'erreur 2, etc.).\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni, en français — mais si les éléments ci-dessus sont dans une langue étrangère (cours de langue), garde la même langue que ces éléments.";
  }
  function generateGapFlashcards(wrongItems) {
    var parts = [{ text: buildGapFlashcardsPrompt(wrongItems) }];
    return callGemini(parts, EXAM_GAP_FLASHCARDS_SCHEMA);
  }
  // Rejouer plusieurs fois la même prépa fait retomber sur les mêmes exercices/questions ouvertes mot
  // pour mot (mêmes valeurs, même contexte) — lassant à force. On ne touche pas au QCM (la correction
  // dépend d'un index fixe, trop risqué à faire varier de façon fiable), seulement aux formats à
  // réponse tapée où la correction est déjà faite par l'IA en comparant au sens, pas au texte exact.
  var EXAM_PREP_VARIANT_SCHEMA = {
    type: "object",
    properties: {
      variants: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Reprend EXACTEMENT l'id fourni pour cet item." },
            prompt: { type: "string", description: "Nouvel énoncé, mêmes notions et même difficulté, mais valeurs et contexte différents." },
            answer: { type: "string", description: "Nouvelle réponse attendue, uniquement si l'item d'origine était une question ouverte courte." },
            solution: { type: "string", description: "Nouvelle solution de référence complète, uniquement si l'item d'origine était un exercice complet." },
            figureSvg: { type: "string", description: "UNIQUEMENT si l'item d'origine avait déjà un support visuel : nouveau SVG complet de ce même support, redessiné avec les nouvelles valeurs/le nouveau contexte de cet énoncé (mêmes règles qu'à la génération initiale : autonome, fond blanc, lisible seul). Laisse vide si l'item d'origine n'avait pas de support visuel." }
          },
          required: ["id", "prompt"]
        }
      }
    },
    required: ["variants"]
  };
  function buildExamPrepVariantPrompt(items) {
    var lines = items.map(function (it) {
      return "ID : " + it.id + "\nType : " + (it.kind === "exercise" ? "exercice complet" : "question ouverte courte") + "\nÉnoncé actuel : " + it.prompt + "\n" + (it.kind === "exercise" ? "Solution actuelle : " + it.solution : "Réponse actuelle : " + it.answer) + (it.figureSvg ? "\nSupport visuel actuel (SVG) : " + it.figureSvg : "");
    }).join("\n\n");
    return "Un élève francophone révise pour un examen et va retomber sur les questions/exercices suivants, déjà rencontrés lors d'une séance PRÉCÉDENTE de cette même préparation. Pour éviter qu'il ne fasse que réciter par cœur une réponse déjà mémorisée, réécris CHACUN avec un énoncé DIFFÉRENT — mais la façon de varier dépend ENTIÈREMENT de la nature de la question, distingue bien les deux cas :\n" +
      "- SI c'est une question de calcul ou de méthode (maths, physique, chimie...) où la compétence testée est une PROCÉDURE qui marche avec n'importe quelles données : change les valeurs numériques ET le contexte/scénario concret (autre produit, autre situation, autres grandeurs, autres noms...).\n" +
      "- SI c'est une question factuelle, conceptuelle ou de connaissance (histoire, géographie, littérature, SVT, définition, date, événement, personnage, œuvre...) où le contenu EST la notion à connaître par cœur : NE CHANGE JAMAIS le fait, l'événement, la date, le personnage, l'œuvre ou la notion en question — remplacer par exemple « la Révolution française » par « la révolution russe » n'est PAS une variante, ça transforme la question en une question sur un sujet totalement différent que l'élève n'est même pas censé réviser. Dans ce cas, varie UNIQUEMENT la formulation (angle de la question, ordre, tournure de phrase) en gardant EXACTEMENT le même sujet/fait/événement/œuvre/date que l'énoncé d'origine.\n" +
      "- Dans tous les cas, garde EXACTEMENT la même notion/compétence testée et le même niveau de difficulté et la même structure (même nombre de sous-questions pour un exercice).\n" +
      "- pour un exercice complet, fournis une nouvelle \"solution\" complète et détaillée (avec le résultat final), cohérente avec le nouvel énoncé ;\n" +
      "- pour une question ouverte courte, fournis la nouvelle \"answer\" attendue, cohérente avec le nouvel énoncé.\n\n" +
      "- si un item a un \"Support visuel actuel (SVG)\" ci-dessous, il DOIT garder un support visuel : redessine-le dans \"figureSvg\" pour qu'il corresponde exactement au nouvel énoncé (nouvelles valeurs, nouvelles mesures, nouveau contexte) — ne le laisse jamais vide dans ce cas, et ne réutilise jamais tel quel l'ancien SVG s'il ne correspond plus aux nouvelles valeurs.\n\n" +
      "Items à varier :\n\n" + lines + "\n\n" +
      "Renvoie un tableau \"variants\", une entrée par item, en reprenant EXACTEMENT le même \"id\" que celui fourni pour chacun.\n\n" +
      "Pour toute formule ou notation mathématique/scientifique, utilise du LaTeX délimité par $...$ ou $$...$$ — jamais de commande de couleur LaTeX.\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni, en français — mais si les éléments ci-dessus sont dans une langue étrangère (cours de langue), garde la même langue que ces éléments.";
  }
  /* ---------------- Exercices inédits de la prépa ----------------
     Avant, la prépa reprenait les exercices générés avec le cours (souvent courts) et se contentait de
     les reformuler quand on retombait dessus : changer quelques mots ne change pas l'exercice. Chaque
     séance fait maintenant écrire des exercices NOUVEAUX, de vrais exercices de contrôle (un support
     riche + plusieurs questions), différents de ceux du cours et des séances précédentes. */
  var EXAM_PREP_FRESH_SCHEMA = {
    type: "object",
    properties: {
      exercises: {
        type: "array",
        items: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "Énoncé complet en Markdown : le support (texte, extrait, données, situation, document...) puis les questions numérotées." },
            solution: { type: "string", description: "Corrigé complet et détaillé, question par question, avec toutes les réponses attendues." },
            topic: { type: "string", description: "La notion du jour principalement travaillée, recopiée telle quelle depuis la liste fournie." }
          },
          required: ["prompt", "solution", "topic"]
        }
      }
    },
    required: ["exercises"]
  };
  function buildExamPrepFreshPrompt(prep, dayEntry, courses, count, avoid) {
    var mode = prep.revisionMode || "auto";
    var share = typeof prep.practiceShare === "number" ? prep.practiceShare : 50;
    var kindRule = mode === "cours" || share <= 20
      ? "Ce sont des exercices de RESTITUTION du cours (l'élève révise surtout du par cœur) : chacun enchaîne plusieurs questions qui demandent de définir, expliquer, illustrer par un exemple, comparer, situer, justifier... sur un même thème, comme une vraie partie « questions de cours » d'un contrôle."
      : "Ce sont des exercices d'APPLICATION : l'élève doit mettre en œuvre les notions, méthodes et savoir-faire du cours sur un support NOUVEAU.";
    var source = courses.map(function (co) { return "### " + co.title + "\n" + stripFigureMarkdown(co.transcription || ""); }).join("\n\n");
    return "Tu es un professeur qui prépare la séance de révision du jour d'un élève pour « " + prep.title + " ».\n" +
      "Notions du jour : " + (dayEntry.topics || []).join(" ; ") + ". Objectif du jour : " + (dayEntry.focus || "") + "\n\n" +
      COURSE_LANGUAGE_RULE +
      "Crée EXACTEMENT " + count + " exercice(s) NOUVEAU(X), centrés sur les notions du jour. " + kindRule + "\n\n" +
      "Règles :\n" +
      "- Chaque exercice est un VRAI exercice de contrôle, substantiel (environ 8 à 12 minutes de travail : la séance entière ne dure que 30 minutes) : un support riche mais court, suivi de 3 ou 4 questions numérotées qui vont à l'essentiel. JAMAIS une question unique et courte. Exemples : en français, pour des procédés stylistiques, un extrait de 6 à 12 lignes (écrit par toi dans l'esprit des textes du cours, ou une citation exacte du cours) qui contient PLUSIEURS procédés différents, avec des questions pour les repérer, les nommer, citer le passage et analyser l'effet de chacun ; en maths/physique-chimie, un problème à plusieurs étapes avec des données nouvelles ; en histoire-géographie, un document ou une situation à analyser avec plusieurs questions ; en langues, un texte avec compréhension et production.\n" +
      "- VARIÉTÉ : les exercices de cette séance ont des formes et des supports DIFFÉRENTS entre eux (repérage + analyse, problème, étude de document, rédaction courte, vrai/faux justifié, mise en relation...). Ils ne doivent PAS être une simple reformulation des exercices déjà existants ou déjà donnés listés plus bas : autre support, autre situation, autres questions.\n" +
      "- FIDÉLITÉ : uniquement des notions qui figurent dans le cours ci-dessous, au niveau de l'élève. N'invente aucun fait, aucune date, aucune définition qui n'y soit pas.\n" +
      "- MISE EN PAGE de \"prompt\" (en Markdown, jamais tout sur une seule ligne) : une courte consigne, puis le support (un texte ou extrait cité en bloc de citation, chaque ligne commençant par « > »), puis une ligne vide, puis CHAQUE question sur sa propre ligne, numérotée « 1. », « 2. », « 3. »..., avec une ligne vide entre deux questions.\n" +
      "- \"solution\" : corrigé complet question par question, avec toutes les réponses attendues (pour un repérage : chaque élément à trouver, sa citation et son analyse), une partie par question commençant par son numéro sur une nouvelle ligne, et à l'intérieur, CHAQUE étape ou élément (ex. chaque lettre d'une méthode, chaque procédé trouvé) sur sa propre ligne, en liste « - ».\n" +
      "- Formules en LaTeX entre $...$, jamais de commande de couleur.\n" +
      COURSE_POSED_OPERATION_RULE +
      DRAWING_QUESTION_RULE +
      (avoid.length ? "Exercices déjà existants ou déjà donnés lors des séances précédentes (NE PAS refaire, même reformulés) :\n" + avoid.map(function (a) { return "- " + a; }).join("\n") + "\n\n" : "") +
      "Voici le cours :\n\n" + source + "\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni, en français (sauf ce que la RÈGLE DE LANGUE impose).";
  }
  // Énoncé écrit d'une traite (« ... Réponds aux questions : 1. ... 2. ... 3. ... ») : on remet chaque question
  // numérotée sur sa propre ligne. Ne touche qu'à une vraie suite 1., 2., 3.... (pas à un nombre décimal ni à
  // un « 1. » isolé), et seulement si elle n'est pas déjà en début de ligne.
  function splitInlineNumberedQuestions(text) {
    var out = String(text || "");
    var pos = 0, n = 1, cuts = [];
    for (;;) {
      var re = new RegExp("(^|[\\s:;.!?»)])(" + n + ")[.)]\\s+(?=\\S)", "g");
      re.lastIndex = pos;
      var m = re.exec(out);
      if (!m) break;
      var at = m.index + m[1].length;
      cuts.push(at);
      pos = at + 2;
      n++;
    }
    if (cuts.length >= 2) {
      for (var i = cuts.length - 1; i >= 0; i--) {
        var before = out.slice(0, cuts[i]);
        if (/\n\s*$/.test(before) || cuts[i] === 0) continue; // déjà en début de ligne
        out = before.replace(/[ \t]+$/, "") + "\n\n" + out.slice(cuts[i]);
      }
    }
    // Étapes écrites en ligne avec des tirets (« méthode : -L (...). -G (...). -S (...) ») : une étape par
    // ligne, en vraie liste. Seulement un tiret qui suit une ponctuation (jamais un mot composé comme
    // « c'est-à-dire »), et seulement s'il y en a au moins deux sur la même ligne.
    var dashRe = /([:.;!?»)])[ \t]*[-–][ \t]*(?=[A-Za-zÀ-ÖØ-öø-ÿ«(])/g;
    out = out.split("\n").map(function (line) {
      var hits = line.match(dashRe);
      if (!hits || hits.length < 2) return line;
      return line.replace(dashRe, "$1\n- ");
    }).join("\n");
    return out;
  }
  // Remplace les exercices tirés du cours par des exercices inédits (même nombre, avec un minimum selon le
  // type de révision). Ne bloque jamais la séance : en cas d'échec ou de lenteur, on garde le pool d'origine.
  function addFreshExercises(prep, dayEntry, pool, progressKey, wanted) {
    if (!getApiKey() || wanted === 0) return Promise.resolve(pool);
    var courses = epScopeCourses(prep.scope);
    if (!courses.length) return Promise.resolve(pool);
    var mode = prep.revisionMode || "auto";
    var share = typeof prep.practiceShare === "number" ? prep.practiceShare : 50;
    var fromCourse = pool.filter(function (it) { return it.kind === "exercise"; }).length;
    var minimum = mode === "exos" ? 4 : mode === "cours" ? 2 : Math.max(1, Math.round(share / 100 * 4));
    // Nombre fixé par la composition de la séance de 30 min (epSessionPlan) ; ancien calcul en secours.
    var count = typeof wanted === "number" ? wanted : Math.min(6, Math.max(fromCourse, minimum));
    var avoid = [];
    courses.forEach(function (co) { (co.exercises || []).forEach(function (ex) { avoid.push(String(ex.prompt || "").replace(/\s+/g, " ").slice(0, 160)); }); });
    (prep.freshHistory || []).forEach(function (h) { avoid.push(h); });
    avoid = avoid.slice(-40);
    genStart(progressKey, [{ label: "Création d'exercices inédits pour ta séance", weight: 100, type: "prepExercises", scale: Math.max(1, count / 3) }]);
    var task = callGemini([{ text: buildExamPrepFreshPrompt(prep, dayEntry, courses, count, avoid) }], EXAM_PREP_FRESH_SCHEMA, 32768, 150000);
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 120000); });
    return Promise.race([task, timeout]).then(function (data) {
      var fresh = (data && data.exercises || []).filter(function (ex) { return ex && ex.prompt && ex.solution; });
      genEnd(progressKey, !!fresh.length);
      if (!fresh.length) return pool;
      prep.freshHistory = (prep.freshHistory || []).concat(fresh.map(function (ex) { return String(ex.prompt).replace(/\s+/g, " ").slice(0, 160); })).slice(-30);
      var first = courses[0];
      var freshItems = fresh.map(function (ex) {
        var co = courses.find(function (c) { return String(ex.topic || "") && (c.title || "").toLowerCase().indexOf(String(ex.topic).toLowerCase()) !== -1; }) || first;
        return { id: uid(), kind: "exercise", category: "", prompt: ex.prompt + (ex.topic ? "\n\n*Notion : " + ex.topic + "*" : ""), solution: ex.solution, figureSvg: "", courseId: co.id, courseTitle: co.title, fresh: true };
      });
      var rest = pool.filter(function (it) { return it.kind !== "exercise"; });
      var merged = rest.concat(freshItems);
      for (var j = merged.length - 1; j > 0; j--) { var k = Math.floor(Math.random() * (j + 1)); var t = merged[j]; merged[j] = merged[k]; merged[k] = t; }
      saveDB();
      return merged;
    }).catch(function () { genEnd(progressKey, false); return pool; });
  }
  function generateExamPrepVariants(items) {
    var parts = [{ text: buildExamPrepVariantPrompt(items) }];
    return callGemini(parts, EXAM_PREP_VARIANT_SCHEMA);
  }
  function epFinalizeSession(prep, s, mapping, gapFlashcardsFlat, wrongIdx) {
    var review = { mastered: [], unclear: [], weak: [] };
    var readinessBefore = prep ? epReadinessPercent(prep) : 0;
    if (prep) {
      epEnsureTopics(prep);
      prep.topicMastery = prep.topicMastery || {};
      // Comparaison normalisée (espaces/casse) : l'IA recopie presque toujours la notion telle
      // quelle, mais une différence mineure de formatage ne doit pas faire échouer le rattachement
      // et empêcher tout mouvement du baromètre.
      var topicByNorm = {};
      (prep.topics || []).forEach(function (t) { topicByNorm[epNormTopic(t)] = t; });
      var topicByHistoryIdx = {};
      (mapping || []).forEach(function (m) {
        var canon = topicByNorm[epNormTopic(m.topic)];
        if (s.history[m.index] && canon) topicByHistoryIdx[m.index] = canon;
      });
      var touchedTopics = {};
      var mistakesByTopic = {};
      Object.keys(topicByHistoryIdx).forEach(function (idxStr) {
        var idx = +idxStr;
        var topic = topicByHistoryIdx[idx];
        var kind = s.pool[idx] ? s.pool[idx].kind : "qcm";
        var h = s.history[idx];
        var level = h.level || (h.wasCorrect ? "correct" : "wrong");
        epApplyMasteryUpdate(prep, topic, kind, level);
        touchedTopics[topic] = true;
        // On garde le détail précis de chaque erreur (pas juste le nom de la notion) pour pouvoir dire
        // ensuite exactement SUR QUOI l'élève s'est trompé dans cette notion, pas juste QUE c'est raté.
        if (h.mistakes && h.mistakes.length) {
          mistakesByTopic[topic] = mistakesByTopic[topic] || [];
          h.mistakes.forEach(function (m) { if (mistakesByTopic[topic].indexOf(m) === -1) mistakesByTopic[topic].push(m); });
        }
      });
      Object.keys(touchedTopics).forEach(function (topic) {
        var score = epTopicMastery(prep, topic);
        var entry = { topic: topic, mistakes: mistakesByTopic[topic] || [] };
        if (score >= 70) review.mastered.push(entry);
        else if (score <= 35) review.weak.push(entry);
        else review.unclear.push(entry);
      });
      prep.gapFlashcards = prep.gapFlashcards || [];
      // s.date est le jour où l'entraînement a démarré (fixé au clic sur "Commencer"), jamais la date
      // du moment où l'IA termine son analyse — une séance commencée juste avant minuit et finie
      // après doit quand même rattacher ses flashcards au jour d'entraînement, pas au lendemain.
      if (gapFlashcardsFlat && wrongIdx) {
        wrongIdx.forEach(function (histIdx, wi) {
          var topic = topicByHistoryIdx[histIdx] || null;
          // Une erreur = UNE flashcard.
          [gapFlashcardsFlat[wi]].forEach(function (f) {
            if (f) prep.gapFlashcards.push({ id: uid(), day: s.date, topic: topic, q: f.q, a: f.a, status: "new" });
          });
        });
      }
      var readinessAfter = epReadinessPercent(prep);
      var pointsEarned = epSessionPointsEarned(s);
      if (pointsEarned > 0) dpData().points += pointsEarned;
      prep.sessions = prep.sessions || {};
      prep.sessions[s.date] = { status: "done", correct: s.correct, wrong: s.wrong, total: s.pool.length, history: s.history, review: review, readinessBefore: readinessBefore, readinessAfter: readinessAfter, newFlashcards: (gapFlashcardsFlat || []).length, pointsEarned: pointsEarned, durationMs: s.durationMs || 0, completedAt: Date.now() };
      prep.activeSession = null; // la séance est allée au bout : plus rien à reprendre pour ce jour.
      saveDB();
      s.readinessAfter = readinessAfter;
      s.pointsEarned = pointsEarned;
      if (pointsEarned > 0) toast("+" + pointsEarned + " pts Dino Park !");
    }
    s.readinessBefore = readinessBefore;
    s.review = review;
    s.newFlashcardsCount = (gapFlashcardsFlat || []).length;
    s.status = "done";
    s.done = true;
    render();
  }
  var epSession = null; // { prepId, date, pool:[{q,courseId,courseTitle}], idx, answer, answerHtml, status, aiFeedback, revealed, wasCorrect, level, mistakes, correct, wrong, history, done }
  var epFcState = {}; // per prepId: { idx, flipped } — état du flip-card des "Flashcards des lacunes"
  var epGapFcOpen = {}; // per prepId: bool — le deck de flashcards des lacunes est replié par défaut
  var epStartingSessionFor = null; // "prepId::date" pendant la génération des variantes d'exercices déjà vus, avant que la séance ne s'ouvre

  var EXERCISE_GRADE_SCHEMA = {
    type: "object",
    properties: {
      mistakes: { type: "array", items: { type: "string" }, description: "UNE entrée par erreur RÉELLEMENT commise (tableau vide seulement si la réponse est irréprochable sur le fond). Chaque entrée nomme précisément la notion ou l'étape du raisonnement en cause, en quelques mots (ex: \"confond vitesse moyenne et instantanée (-2 pt)\", \"oublie de convertir en mètres (-1 pt)\"), jamais une formule vague comme \"erreur de calcul\", et se termine TOUJOURS par le nombre de points retirés pour cette erreur précise entre parenthèses au format \"(-X pt)\". Ne fusionne jamais deux erreurs distinctes en une seule entrée, et ne minimise rien : toute imprécision, approximation ou maladresse compte comme une erreur à part entière (sauf l'orthographe/grammaire, presque jamais sanctionnée — voir consigne). N'invente en revanche aucune erreur qui n'existe pas : une formulation différente mais juste sur le fond n'est pas une erreur." },
      scoreMax: { type: "integer", description: "Barème choisi pour CET exercice précis selon son ampleur et ses points clés (ex. 5 pour une question courte, 10 ou 20 pour un exercice à plusieurs étapes)." },
      score: { type: "number", description: "Note obtenue sur scoreMax, décimale autorisée (ex. 3.5) = scoreMax moins la somme des points retirés listés dans mistakes. Jamais gonflée pour rassurer l'élève : une réponse avec des erreurs de fond reste loin du score maximal." },
      feedback: { type: "string" }
    },
    required: ["mistakes", "scoreMax", "score", "feedback"]
  };
  // Baromètre + affichage à 5 niveaux (pas juste vrai/faux) : le niveau réel est déduit du NOMBRE
  // d'erreurs listées par l'IA (voir gradeLevelFromMistakeCount), jamais choisi librement par elle —
  // ça évite qu'un prompt de correction sévère ne fasse basculer trop vite sur "Faux" dès la moindre
  // imperfection, en étalant la sanction sur plusieurs paliers intermédiaires.
  var GRADE_LEVELS = {
    correct: { label: "Correct", cls: "correct", masteryFactor: 1, pointsFactor: 1 },
    minor: { label: "1 erreur", cls: "minor", masteryFactor: 0.6, pointsFactor: 0.8 },
    moderate: { label: "Partiellement maîtrisé", cls: "moderate", masteryFactor: 0.45, pointsFactor: 0.45 },
    major: { label: "Insuffisamment maîtrisé", cls: "major", masteryFactor: 0.6, pointsFactor: 0.15 },
    wrong: { label: "Faux", cls: "wrong", masteryFactor: 1, pointsFactor: 0 }
  };
  function gradeLevelFromMistakeCount(n) {
    n = n || 0;
    if (n <= 0) return "correct";
    if (n === 1) return "minor";
    if (n <= 3) return "moderate";
    if (n <= 5) return "major";
    return "wrong";
  }
  function gradeLevelFromGrade20(g) {
    g = typeof g === "number" ? g : 0;
    if (g >= 16) return "correct";
    if (g >= 13) return "minor";
    if (g >= 9) return "moderate";
    if (g >= 5) return "major";
    return "wrong";
  }
  function normalizeGradeLevel(result) {
    var lvl = result && result.level;
    if (GRADE_LEVELS[lvl]) return lvl;
    return (result && result.correct) ? "correct" : "wrong"; // filet de sécurité si le niveau n'a pas pu être calculé
  }
  function gradeLevelIsSuccess(level) { return level === "correct" || level === "minor"; }
  function gradeLevelLabel(level) { return (GRADE_LEVELS[level] || GRADE_LEVELS.wrong).label; }
  function gradeLevelCls(level) { return (GRADE_LEVELS[level] || GRADE_LEVELS.wrong).cls; }
  function gradeMistakesHtml(mistakes) {
    if (!mistakes || !mistakes.length) return "";
    return '<ul class="grade-mistakes">' + mistakes.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join("") + '</ul>';
  }
  function gradeScoreBadge(score, scoreMax) {
    if (score == null || !scoreMax) return "";
    var display = (Math.round(score * 10) / 10).toString().replace(".", ",");
    return '<span class="mono" style="font-size:16px;flex:none">' + display + '/' + scoreMax + '</span>';
  }
  function buildExerciseGradePrompt(exercisePrompt, referenceSolution, studentAnswer) {
    return "Tu es un correcteur d'examen EXTRÊMEMENT EXIGEANT pour un élève francophone. Ta mission n'est pas de rassurer l'élève : c'est de lui dire précisément où il en est réellement, même si c'est désagréable à entendre. Voici un exercice, sa solution de référence, et la réponse fournie par l'élève.\n\n" +
      "Exercice : " + exercisePrompt + "\n\n" +
      "Solution de référence : " + referenceSolution + "\n\n" +
      "Réponse de l'élève : " + (studentAnswer && studentAnswer.trim() ? studentAnswer : "(aucune réponse fournie)") + "\n\n" +
      "Règles de correction :\n" +
      "- Liste dans \"mistakes\" CHAQUE erreur, imprécision, approximation ou maladresse réellement présente par rapport à la solution de référence, une entrée par erreur distincte. Pour CHAQUE entrée, termine par le nombre de points retirés pour CETTE erreur précise entre parenthèses, au format \"(-X pt)\" ou \"(-X,X pt)\" (ex. \"confond vitesse moyenne et instantanée (-2 pt)\") — le barème complet (score/scoreMax) doit être la conséquence transparente et vérifiable de cette liste, jamais un chiffre sorti de nulle part. Ne limite pas leur nombre et ne les minimise pas : si la réponse est mauvaise, dis-le clairement et liste tout ce qui ne va pas. À l'inverse, n'invente aucune erreur qui n'existe pas juste pour paraître sévère : une réponse formulée différemment mais juste sur le fond ne compte pour aucune erreur.\n" +
      "- Orthographe et grammaire : ne retire PRESQUE JAMAIS de points pour ça. Au grand maximum 1 point sur l'ensemble du barème, et seulement si le sujet n'est ni scientifique ni technique. Deux seules exceptions où une faute d'orthographe compte comme une erreur normale : (1) un terme scientifique/technique précis mal orthographié (ex. un nom d'unité, une notion, un nom propre scientifique) dans une matière où ce terme est justement ce qui est évalué, (2) une faute dans la conjugaison du verbe quand l'exercice porte spécifiquement sur la conjugaison. En dehors de ces deux cas (donc pour la quasi-totalité des exercices de maths, sciences, et de la rédaction générale dans les autres matières), l'orthographe ne doit JAMAIS faire perdre plus d'un point : c'est le fond — le raisonnement, le résultat, la compréhension de la notion — qui est évalué, pas la forme.\n" +
      "- Choisis un \"scoreMax\" adapté à l'ampleur réelle de l'exercice (5 pour une question courte, 10 ou 20 pour un exercice à plusieurs étapes), puis donne un \"score\" sur ce barème, décimale si besoin (ex. 3.5), qui reflète fidèlement la gravité et le nombre des erreurs listées (score = scoreMax moins la somme des points retirés listés dans \"mistakes\"). N'arrondis jamais à la hausse par gentillesse : une réponse avec des erreurs de fond ne doit jamais approcher le score maximal.\n" +
      "- Le \"feedback\" doit être factuel et sans complaisance : dis explicitement ce qui est faux, incomplet ou hors sujet, sans formules vagues type \"pas tout à fait\" ou \"presque\" qui adoucissent le constat. Explique aussi ce qui est juste, le cas échéant, mais sans laisser croire que la réponse est meilleure qu'elle ne l'est.\n\n" +
      "Pour toute formule mathématique dans ton feedback, utilise du LaTeX ($...$ ou $$...$$).\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni, en français — mais si l'exercice est dans une langue étrangère (cours de langue), évalue la réponse dans cette langue (sens, vocabulaire, grammaire attendus), et cite les corrections dans cette langue.";
  }
  async function gradeExerciseAnswer(exercisePrompt, referenceSolution, studentAnswer) {
    // Dessins de l'élève (outil Dessin) : joints en images, et la consigne de correction les mentionne.
    var drawn = drawingsForAnswer(studentAnswer);
    var promptText = buildExerciseGradePrompt(stripFigureMarkdown(exercisePrompt), stripFigureMarkdown(referenceSolution), drawn.text);
    if (drawn.images.length) promptText = promptText.replace("Règles de correction :\n", "Règles de correction :\n" + DRAWING_GRADE_RULE);
    var parts = drawingParts(drawn.images).concat([{ text: promptText }]);
    var result = await callGemini(parts, EXERCISE_GRADE_SCHEMA);
    result.mistakes = result.mistakes || [];
    result.level = gradeLevelFromMistakeCount(result.mistakes.length);
    return result;
  }

  var IMPORTED_EXERCISE_SCHEMA = {
    type: "object",
    properties: {
      subjectGuess: { type: "string", description: "Matière probable des exercices, en un ou deux mots (ex. \"Mathématiques\", \"Histoire\")." },
      exercises: {
        type: "array",
        description: "Un élément par exercice distinct trouvé dans le document, dans l'ordre où ils apparaissent.",
        items: {
          type: "object",
          properties: {
            statement: { type: "string", description: "Retranscription fidèle de l'énoncé de cet exercice, en Markdown." },
            solution: { type: "string", description: "Solution de référence complète et détaillée de cet exercice, rédigée par toi, avec le résultat final." }
          },
          required: ["statement", "solution"]
        }
      },
      figures: {
        type: "array",
        description: "Schémas, graphiques ou images des photos sources indispensables à la compréhension d'un exercice, à réinsérer dans son énoncé.",
        items: {
          type: "object",
          properties: {
            imageIndex: { type: "integer", description: "Index (à partir de 0) du fichier source (photo ou PDF) où se trouve ce schéma." },
            pageIndex: { type: "integer", description: "Si ce fichier est un PDF : numéro de la page (à partir de 1) où se trouve ce schéma. Pour une photo : 1." },
            box: { type: "array", items: { type: "integer" }, description: "Zone [ymin, xmin, ymax, xmax] du schéma dans cette photo (ou dans cette page du PDF), sur une échelle 0-1000, qui contient TOUT le schéma avec ses propres annotations (lettres, valeurs, axes, graduations, légende) mais pas le texte de l'énoncé autour." },
            caption: { type: "string", description: "Légende courte et DISTINCTIVE : à quel exercice/partie il appartient (ex. \"Exercice 3 — triangle ABC rectangle en B\") et ce qu'il montre, pour ne jamais le confondre avec un autre schéma de la même page." },
            placeholder: { type: "string", description: "Jeton unique au format [[figure:N]] (N = index de cette figure) à insérer tel quel dans le \"statement\" de l'exercice concerné, à l'endroit exact où ce schéma doit apparaître." }
          },
          required: ["imageIndex", "box", "caption", "placeholder"]
        }
      }
    },
    required: ["subjectGuess", "exercises", "figures"]
  };
  function buildImportedExercisePrompt(imageCount, pre) {
    var step1 = imageCount === 1
      ? "Voici la photo ou le document d'un ou plusieurs exercices pris par un élève."
      : "Voici " + imageCount + " photos/pages qui font partie du même document d'exercices, dans l'ordre.";
    return step1 + " Ne réponds pas encore aux exercices ici : \n" +
      preFiguresPromptText(pre, "dans le \"statement\" du BON exercice") +
      "Règle importante : si un énoncé correspond mot pour mot à un exercice déjà public sur internet (banque d'exercices en ligne, manuel, site de révision, etc.), REFORMULE légèrement sa formulation en gardant strictement le même sens, les mêmes données et la même difficulté, plutôt que de le recopier tel quel — sinon la génération est bloquée automatiquement.\n" +
      "1. Repère CHAQUE exercice distinct présent dans le document (généralement numéroté \"Exercice 1\", \"Exercice 2\"... ou séparé visuellement) et crée une entrée dans \"exercises\" pour chacun, dans l'ordre d'apparition. S'il n'y a qu'un seul exercice, renvoie un tableau \"exercises\" avec un seul élément. S'il y en a 7 exercices distincts, renvoie exactement 7 éléments — ne fusionne jamais deux exercices ensemble et n'en invente aucun.\n" +
      "   ATTENTION, très important : les sous-questions ou étapes À L'INTÉRIEUR d'un même exercice (numérotées a, b, c, d... ou 1, 2, 3... ou 1), 2), 3)...) NE SONT PAS des exercices séparés — ce sont des questions qui font partie d'un seul et même exercice. Un exercice avec 5 sous-questions ou 5 étapes reste UN SEUL élément dans \"exercises\", avec toutes ses sous-questions rassemblées dans le même \"statement\" et une seule \"solution\" qui traite les 5. Ne crée une nouvelle entrée dans \"exercises\" QUE quand le document passe à un exercice numéroté différent (Exercice 1 → Exercice 2), jamais entre deux sous-questions du même exercice.\n" +
      "2. Pour chaque exercice, retranscris fidèlement son énoncé complet dans \"statement\", en gardant toutes ses sous-questions (a, b, c... ou 1, 2, 3...) ensemble dans ce même \"statement\", chacune sur sa propre ligne (une ligne \"- \" par sous-question si elles sont nombreuses, sinon une ligne par ligne du document source). N'ajoute JAMAIS de titre du type \"## Exercice N\" ou \"### Énoncé\" en tête du \"statement\" : l'application affiche déjà le numéro de l'exercice ailleurs, ce serait redondant. Utilise ** pour le gras et $...$/$$...$$ pour les formules, mais pas de ## ni ### ici. Corrige les fautes évidentes mais garde le sens exact.\n" +
      "3. Devine la matière probable de l'ensemble des exercices (un seul \"subjectGuess\" pour tout le document).\n" +
      "4. Pour chaque exercice, rédige toi-même une solution de référence complète, détaillée et rigoureuse (avec le résultat final) dans \"solution\" — en traitant TOUTES les sous-questions de cet exercice (a, b, c... ou 1, 2, 3...) dans cette même solution. C'est cette solution qui servira ensuite à corriger la réponse de l'élève sur CET exercice précis (l'élève répond en une seule fois à toutes ses sous-questions).\n" +
      "5. Si un exercice s'appuie sur un schéma, graphique, figure géométrique ou dessin VISUEL réellement NÉCESSAIRE pour le résoudre (pas une simple décoration), repère-le dans les photos sources et ajoute une entrée dans \"figures\" avec : \"imageIndex\" (index du fichier, à partir de 0), \"pageIndex\" (pour un PDF : numéro de la page où est le schéma, à partir de 1 ; pour une photo : 1), \"box\" (zone rectangulaire exacte du schéma dans cette photo, format [ymin, xmin, ymax, xmax] sur une échelle 0-1000, en excluant le texte autour), \"caption\" (légende courte et DISTINCTIVE : numéro de l'exercice ou de la partie + ce que montre le schéma, ex. \"Exercice 2 — circuit avec deux lampes en série\") et \"placeholder\" (jeton unique \"[[figure:N]]\"). Insère ce jeton tel quel, seul sur sa ligne, exactement à l'endroit du \"statement\" de cet exercice où le schéma doit apparaître — ne le décris jamais en mots à la place. Signal à prendre TRÈS au sérieux : dès qu'un énoncé contient les mots \"ci-contre\", \"ci-dessous\", \"ci-joint\" ou \"ci-après\" à propos d'une représentation graphique/d'un schéma/d'une figure, c'est qu'un visuel est physiquement présent dans la photo à cet endroit — cherche-le activement et capture-le, ne le laisse JAMAIS de côté même si le document contient beaucoup d'exercices et que tu dois rester attentif jusqu'au dernier. Une même page contient souvent PLUSIEURS exercices avec chacun son schéma : crée une entrée séparée par schéma (jamais deux schémas dans une même zone, jamais un schéma oublié parce qu'un autre a déjà été pris sur la page), avec une zone qui ne déborde pas sur l'exercice voisin, et place chaque jeton dans l'énoncé du BON exercice. INTERDIT : ne crée JAMAIS de figure pour du texte, même encadré ou stylisé (citation, définition, énoncé) — ce texte doit TOUJOURS être retranscrit normalement dans \"statement\", jamais capturé comme une image. \"figures\" est réservé exclusivement à du contenu qui ne peut PAS être retranscrit en texte. S'il n'y a aucun schéma nécessaire, renvoie un tableau \"figures\" vide.\n\n" +
      "Pour toute formule ou notation mathématique/scientifique, utilise du LaTeX délimité par $...$ en ligne ou $$...$$ pour une formule isolée. N'utilise jamais de commande de couleur LaTeX (\\textcolor, \\colorbox, \\color, etc.) pour surligner un terme : le texte doit toujours rester dans la couleur par défaut, utilise le gras (**) si tu veux mettre quelque chose en valeur.\n\n" +
      "Si un énoncé comporte un tableau de données, reproduis-le comme un vrai tableau Markdown (| Colonne 1 | Colonne 2 |, puis une ligne |---|---|, puis les lignes de données) plutôt qu'une liste à puces : le site sait afficher de vrais tableaux.\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni, en français — sauf si le document/cours source est rédigé dans une langue étrangère (cours de langue) : énoncés, sujets et solutions restent alors dans cette langue (entièrement s'il est entièrement dans cette langue ; s'il mélange français et langue étrangère, consignes en français et textes/expressions dans la langue étrangère). Ne traduis ni ne reformule jamais un texte en langue étrangère à étudier (la règle de reformulation ne s'applique pas à lui).";
  }
  async function generateImportedExercise(imageDataUrls, pre) {
    var images = (imageDataUrls || []).map(function (url) {
      var m = /^data:(image\/[a-zA-Z+]+|application\/pdf);base64,(.+)$/.exec(url || "");
      return m ? { inline_data: { mime_type: m[1], data: m[2] } } : null;
    }).filter(Boolean);
    var parts = images.concat([{ text: buildImportedExercisePrompt(images.length, pre) }]);
    return callGemini(parts, IMPORTED_EXERCISE_SCHEMA);
  }
  function geminiImageParts(dataUrls) {
    return (dataUrls || []).map(function (url) {
      var m = /^data:(image\/[a-zA-Z+]+|application\/pdf);base64,(.+)$/.exec(url || "");
      return m ? { inline_data: { mime_type: m[1], data: m[2] } } : null;
    }).filter(Boolean);
  }
  // Filet de sécurité final quand même la passe de découpage-depuis-la-photo échoue deux fois : au lieu
  // de laisser l'élève sans rien avec juste un avertissement, on redemande à l'IA de regarder la même
  // photo et de RECONSTRUIRE elle-même le schéma en SVG (au lieu d'essayer de le découper au pixel
  // près). C'est un mode de récupération différent du découpage, donc ça rattrape des cas où le
  // découpage précis échoue mais où l'IA "voit" très bien de quoi il s'agit.
  var FIGURE_RECONSTRUCTION_SCHEMA = {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Reprend EXACTEMENT l'id fourni pour cet élément." },
            figureType: { type: "string", description: "'diagram' si le schéma observé sur la photo est constitué de boîtes de texte reliées par des flèches (cycle, processus, classification, relations entre notions — LE CAS LE PLUS FRÉQUENT, à choisir PAR DÉFAUT) : résultat garanti sans chevauchement. 'svg' UNIQUEMENT si c'est vraiment un dessin libre impossible à représenter avec des boîtes/flèches (courbe, figure géométrique avec mesures, carte, coupe détaillée). 'aucun' si tu ne retrouves vraiment aucun schéma correspondant dans les photos fournies." },
            diagramNodes: { type: "array", description: "Si figureType = 'diagram' : les boîtes du schéma observé, fidèles à ce qui est réellement sur la photo. Tableau vide sinon.", items: DIAGRAM_NODE_SCHEMA },
            diagramEdges: { type: "array", description: "Si figureType = 'diagram' : les flèches entre boîtes, fidèles à ce qui est réellement sur la photo. Tableau vide sinon.", items: DIAGRAM_EDGE_SCHEMA },
            figureSvg: { type: "string", description: "Si figureType = 'svg' UNIQUEMENT : SVG autonome reconstruisant fidèlement le schéma/graphique observé (mêmes proportions, mêmes valeurs/graduations visibles). Chaîne vide sinon." }
          },
          required: ["id", "figureType", "diagramNodes", "diagramEdges", "figureSvg"]
        }
      }
    },
    required: ["results"]
  };
  function buildFigureReconstructionPrompt(items) {
    var lines = items.map(function (it) { return "ID : " + it.id + "\nTexte : " + it.text; }).join("\n\n");
    return "Voici la ou les photos originales d'un document. Les énoncés suivants, extraits de ce document, font référence à un schéma ou un graphique (« ci-contre », « ci-dessous »...) qu'une première tentative de découpage automatique n'a pas réussi à récupérer dans la photo.\n\n" +
      "Pour CHAQUE élément ci-dessous : regarde attentivement la ou les photos, retrouve toi-même le schéma/graphique qui correspond à cet énoncé précis, et reconstruis-le fidèlement (mêmes proportions, mêmes valeurs/graduations visibles) — pas une illustration générique.\n\n" +
      "Éléments :\n\n" + lines + "\n\n" +
      "Renvoie un tableau \"results\", une entrée par élément, en reprenant EXACTEMENT le même \"id\" que celui fourni pour chacun.\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni, en français.";
  }
  function generateFigureReconstructions(imageDataUrls, items) {
    var parts = geminiImageParts(imageDataUrls).concat([{ text: buildFigureReconstructionPrompt(items) }]);
    return callGemini(parts, FIGURE_RECONSTRUCTION_SCHEMA);
  }
  // Tente de reconstruire en SVG les schémas manqués d'une liste d'éléments — mute chaque élément en
  // place (setSvg) et renvoie une promesse résolue avec un booléen : reste-t-il au moins un élément
  // toujours sans figure une fois la reconstruction tentée ?
  function reconstructMissingFigures(imageDataUrls, items, getText, getSvg, setSvg) {
    var stillMissing = function () { return items.some(function (it) { return statementMissesFigure(getText(it)) && !getSvg(it); }); };
    var missing = [];
    items.forEach(function (it, i) { if (statementMissesFigure(getText(it)) && !getSvg(it)) missing.push({ id: String(i), it: it }); });
    if (!missing.length || !imageDataUrls || !imageDataUrls.length) return Promise.resolve(stillMissing());
    return generateFigureReconstructions(imageDataUrls, missing.map(function (m) { return { id: m.id, text: getText(m.it) }; }))
      .then(function (data) {
        var byId = {};
        (data.results || []).forEach(function (r) { byId[r.id] = r; });
        missing.forEach(function (m) {
          var r = byId[m.id];
          if (!r) return;
          var svg = r.figureType === "svg" && r.figureSvg ? r.figureSvg : renderDiagramSvg(r.diagramNodes, r.diagramEdges);
          if (svg) setSvg(m.it, svg);
        });
        return stillMissing();
      })
      .catch(function () { return true; });
  }
  function runImportedExerciseGeneration(entry, attempt) {
    attempt = attempt || 1;
    entry.status = "processing";
    entry.error = null;
    var genImgs = (entry.images || []).length;
    genStart(entry.id, [
      { label: "Repérage et découpe des schémas", weight: genImgs ? 35 : 0, type: "figures", learn: false },
      { label: "Analyse des exercices", weight: 55, type: "exerciseImport", scale: Math.max(1, genImgs * 0.5) },
      { label: "Finitions", weight: 10, type: "finish" }
    ]);
    saveDB(); render();
    var pre = null;
    prepareDocumentFigures(entry.images, function (b, s, t) { genSub(entry.id, b, s, t); }).then(function (p) {
      pre = p;
      genPhase(entry.id, "Analyse des exercices");
      return generateImportedExercise(entry.images, p);
    }).then(function (data) {
      entry.subjectGuess = data.subjectGuess || "";
      genPhase(entry.id, "Finitions");
      // Repérage dédié réussi : les découpes approximatives de la génération elle-même sont ignorées.
      return resolveFigures(pre.ok ? [] : data.figures, entry.images).then(function (resolved) {
        var allSubs = pre.subs.concat(resolved.subs);
        var rawStatements = (data.exercises || []).map(function (ex) { return ex.statement || ""; });
        // Schémas déjà découpés que la génération a oublié de placer : rangés dans l'exercice dont le
        // numéro apparaît dans leur légende (ex. « Exercice 26 — ... »), sinon dans le dernier exercice.
        unplacedPreFigures(pre, rawStatements).forEach(function (s) {
          var f = pre.list.find(function (x) { return x.placeholder === s.placeholder; });
          var num = f && /(\d+)/.exec(f.caption);
          var target = -1;
          if (num) rawStatements.forEach(function (st, k) { if (target < 0 && new RegExp("(^|\\D)" + num[1] + "(\\D|$)").test(st.slice(0, 80))) target = k; });
          if (target < 0) target = rawStatements.length - 1;
          if (target >= 0) rawStatements[target] += "\n\n" + s.placeholder;
        });
        var exercises = (data.exercises || []).map(function (ex, k) {
          return { statement: substituteFigures(rawStatements[k], allSubs), solution: ex.solution || "", figureSvg: "", answerHtml: "", answerText: "", answerStatus: "unanswered", correct: null, feedback: "" };
        });
        var missedFigure = exercises.some(function (ex) { return statementMissesFigure(ex.statement); });
        // Un schéma manqué est souvent un raté ponctuel de cette passe précise plutôt qu'un problème
        // systématique : retenter une fois EN SILENCE (tant que les photos sont là) rattrape la
        // plupart des cas sans forcer l'élève à cliquer lui-même sur "Régénérer".
        if (missedFigure && attempt < 2 && entry.images && entry.images.length) {
          runImportedExerciseGeneration(entry, attempt + 1);
          return;
        }
        // Si le découpage a échoué même après ce nouvel essai, dernier recours : demander à l'IA de
        // RECONSTRUIRE elle-même le schéma en SVG à partir de la photo, plutôt que de le découper.
        return reconstructMissingFigures(
          entry.images, exercises,
          function (ex) { return ex.statement; },
          function (ex) { return ex.figureSvg; },
          function (ex, svg) { ex.figureSvg = svg; }
        ).then(function (stillMissing) {
          entry.exercises = exercises;
          entry.figures = pre.figures.concat(resolved.figures);
          entry.status = "ready";
          // Tout ce qui a été détecté est déjà découpé/reconstruit et stocké à part : la photo complète
          // ne sert donc plus à rien dans le cas normal, et on la jette (coûteuse en stockage, comme
          // pour les cours). On ne la garde QUE s'il reste un énoncé sans aucune figure malgré tout ça
          // — c'est alors le seul moyen de pouvoir corriger le tir avec "Régénérer" plus tard.
          if (!stillMissing) entry.images = [];
          saveDB();
          genEnd(entry.id, true);
          if (pre && pre.warning) toast("⚠️ " + pre.warning);
          storeFigureImages();
          toast((entry.exercises.length > 1 ? entry.exercises.length + " exercices importés · " : "Exercice importé · ") + entry.title);
          render();
        });
      });
    }).catch(function (err) {
      genEnd(entry.id, false);
      entry.status = "error";
      entry.error = err.message || "Erreur inconnue";
      entry.errorStatus = err.status || null;
      entry.errorDetail = err.detail || null;
      saveDB();
      toast("Échec de l'import : " + entry.error, { status: entry.errorStatus, detail: entry.errorDetail });
      render();
    });
  }

  // Avant, l'IA se contentait de proposer des requêtes de recherche ("un label + une requête") et le
  // site construisait un simple lien "youtube.com/results?search_query=..." — pas une vraie vidéo, juste
  // une suggestion de recherche. On cherche maintenant réellement sur internet (grounding Google Search)
  // de vraies vidéos existantes et on ne garde que les liens youtube.com/youtu.be effectivement trouvés,
  // sans jamais inventer de vidéo ou d'URL.
  function buildCourseVideoSearchPrompt(title, subjectName, chapterName, content) {
    return "Cherche sur internet 3 vraies vidéos YouTube pédagogiques de qualité (de préférence en français, adaptées à un élève) qui expliquent bien le sujet du cours suivant.\n\n" +
      "Matière : " + subjectName + ", chapitre : " + chapterName + ", titre du cours : " + title + "\n\n" +
      "Résumé du contenu du cours (pour bien cibler les vidéos) :\n\n" + String(content || "").slice(0, 2500) + "\n\n" +
      "Pour chacune des vidéos que tu trouves réellement en cherchant, donne son titre exact et explique en une phrase pourquoi elle est pertinente. N'invente JAMAIS une vidéo ou un lien qui n'existe pas : si tu ne trouves vraiment aucune vidéo pertinente, dis-le simplement plutôt que d'en inventer une.";
  }
  function generateCourseVideoLinks(title, subjectName, chapterName, content) {
    return callGeminiSearch([{ text: buildCourseVideoSearchPrompt(title, subjectName, chapterName, content) }])
      .then(function (res) {
        var seen = {};
        return (res.sources || []).filter(function (s) {
          return s.uri && /(?:youtube\.com\/watch\?v=|youtu\.be\/)/i.test(s.uri);
        }).filter(function (s) {
          if (seen[s.uri]) return false;
          seen[s.uri] = true;
          return true;
        }).slice(0, 3).map(function (s) { return { title: s.title || "Vidéo YouTube", sub: subjectName, url: s.uri }; });
      })
      .catch(function () { return []; });
  }

  function runCourseGeneration(course, subjectName, chapterName, imagesOverride, priorTranscription, attempt) {
    attempt = attempt || 1;
    course.status = "processing";
    course.error = null;
    var genImgs = (imagesOverride || course.images || []).length;
    genStart(course.id, [
      { label: "Repérage et découpe des schémas", weight: genImgs ? 25 : 0, type: "figures", learn: false },
      { label: "Retranscription page par page", weight: genImgs ? 30 : 0, type: "pageTranscript", learn: false },
      { label: "Rédaction du cours", weight: genImgs ? 35 : 90, type: "course", scale: Math.max(1, genImgs * 0.3 + (priorTranscription ? 0.5 : 0)) },
      { label: "Finitions", weight: 10, type: "finish" }
    ]);
    saveDB(); render();
    var images = imagesOverride || course.images;
    // Ce qui existe déjà (texte AVEC ses schémas, et les schémas eux-mêmes) : avant, « Ajouter des documents »
    // et « Régénérer » repartaient d'un texte sans images et vidaient la liste des schémas, qui disparaissaient.
    var keepTranscription = course.transcription || "";
    var keepFigures = (course.figures || []).slice();
    // « Ajouter des documents » : seul le NOUVEAU contenu est ajouté. L'explication, les flashcards (avec
    // ta progression), les questions et les exercices déjà là ne bougent pas ; ceux du nouveau contenu
    // s'ajoutent à la suite.
    var addMode = !!(priorTranscription && images && images.length);
    var keepExplanation = course.explanation || "";
    var keepFlashcards = (course.flashcards || []).slice();
    var keepQuiz = (course.quizQuestions || []).slice();
    var keepExercises = (course.exercises || []).slice();
    var freshFromImages = !priorTranscription && images && images.length; // tout refait depuis les photos : les anciens schémas sont remplacés
    var pre = null;
    var pagesText = null; // retranscription faite à part, page par page (null = ancienne méthode)
    prepareDocumentFigures(images, function (b, s, t) { genSub(course.id, b, s, t); }).then(function (p) {
      pre = p;
      if (!images || !images.length) {
        genPhase(course.id, "Rédaction du cours");
        return generateCourseContent(images, course.title, subjectName, chapterName, priorTranscription, p);
      }
      genPhase(course.id, "Retranscription page par page");
      return transcribeDocumentPages(images, p, addMode ? keepTranscription : null, course.title, subjectName, function (b, s, t) { genSub(course.id, b, s, t); }).then(function (tr) {
        genPhase(course.id, "Rédaction du cours");
        if (!tr.ok) return generateCourseContent(images, course.title, subjectName, chapterName, priorTranscription, p); // ancienne méthode en secours
        pagesText = tr.text;
        if (addMode && !pagesText.trim()) return { transcription: "" }; // rien de nouveau : le cours reste tel quel
        return generateCourseContent(images, course.title, subjectName, chapterName, priorTranscription, p, pagesText, addMode);
      });
    }).then(function (data) {
      if (pagesText !== null) data.transcription = pagesText;
      genPhase(course.id, "Finitions");
      // Ajout de documents qui ne contiennent rien de nouveau : le cours reste exactement tel quel.
      if (addMode && !String(data.transcription || "").trim()) {
        genEnd(course.id, true);
        course.status = "ready";
        course.images = [];
        saveDB();
        toast("Rien de nouveau dans ces documents : le cours n'a pas changé.");
        render();
        return;
      }
      // Repérage dédié réussi : les découpes approximatives de la génération elle-même sont ignorées.
      return resolveFigures(pre.ok ? [] : data.figures, images).then(function (resolved) {
        // Schémas déjà découpés que la génération a oublié de placer : ajoutés à la fin, jamais perdus.
        var lostPre = unplacedPreFigures(pre, [data.transcription, data.explanation]);
        var allSubs = pre.subs.concat(resolved.subs);
        // Régénération sans photo : les schémas existants voyagent sous forme de jetons [[keep:id]], remis ici.
        var transcription = substituteFigures(restoreFigureRefs(data.transcription, keepFigures), allSubs);
        if (lostPre.length) transcription += "\n\n## Schémas du document\n\n" + lostPre.map(function (s) { return s.replacement; }).join("\n\n");
        // Ajout de nouvelles photos à un cours existant : l'IA n'a retranscrit QUE le nouveau contenu
        // (voir buildCoursePrompt) — on recolle l'ancien texte tel quel (AVEC ses schémas), jamais retouché
        // par l'IA, pour garantir qu'aucun détail déjà transcrit ne puisse être perdu lors de l'ajout.
        if (priorTranscription && images && images.length) transcription = (keepTranscription || priorTranscription) + "\n\n" + transcription;
        var explanation = substituteFigures(restoreFigureRefs(data.explanation, keepFigures), allSubs);
        var missedFigure = [transcription, explanation].some(statementMissesFigure);
        // Un schéma manqué est souvent un raté ponctuel de cette passe précise plutôt qu'un problème
        // systématique : retenter une fois EN SILENCE (tant que les photos sont là) rattrape la
        // plupart des cas sans forcer l'élève à cliquer lui-même sur "Régénérer".
        if (missedFigure && attempt < 2 && images && images.length) {
          runCourseGeneration(course, subjectName, chapterName, imagesOverride, priorTranscription, attempt + 1);
          return;
        }
        var quizQuestions = (data.quizQuestions || []).map(function (q) {
          return { id: uid(), type: q.type === "ouverte" ? "ouverte" : "qcm", category: q.category, prompt: q.prompt, choices: q.choices || [], correctIndex: q.correctIndex, answer: q.answer || "", explanation: q.explanation, figureSvg: q.figureSvg || "" };
        });
        var exercises = (data.exercises || []).map(function (ex) { return { id: uid(), prompt: ex.prompt, solution: ex.solution, figureSvg: ex.figureSvg || "" }; });
        // Transcription/explication n'ont pas de "figureSvg" dédié comme les exercices/questions : on
        // les enveloppe dans le même format {prompt, figureSvg} pour pouvoir les passer avec eux à la
        // même passe de reconstruction (un seul appel, plutôt que d'en refaire un par catégorie).
        var textBlocks = [
          { prompt: transcription, figureSvg: "" },
          { prompt: explanation, figureSvg: "" }
        ];
        var allItems = textBlocks.concat(exercises, quizQuestions);
        // Si le découpage a échoué même après ce nouvel essai, dernier recours : demander à l'IA de
        // RECONSTRUIRE elle-même le(s) schéma(s) manquant(s) en SVG à partir de la photo, plutôt que
        // de le(s) découper.
        return reconstructMissingFigures(
          images, allItems,
          function (it) { return it.prompt; },
          function (it) { return it.figureSvg; },
          function (it, svg) { it.figureSvg = svg; }
        ).then(function (stillMissing) {
          course.transcription = transcription;
          course.explanation = addMode ? (keepExplanation + (explanation.trim() ? "\n\n" + explanation : "")) : explanation;
          course.transcriptionFigureSvg = textBlocks[0].figureSvg;
          course.explanationFigureSvg = addMode ? (course.explanationFigureSvg || textBlocks[1].figureSvg) : textBlocks[1].figureSvg;
          // Remplacé (pas accumulé) : les figures d'un ancien contenu ne sont de toute façon plus
          // référencées dans le texte fraîchement régénéré (le contexte envoyé à l'IA est nettoyé de
          // ses anciennes images), les garder ne ferait que gonfler le stockage pour rien.
          course.figures = (freshFromImages ? [] : keepFigures).concat(pre.figures, resolved.figures);
          course.videos = course.videos || [];
          var newFlashcards = (data.flashcards || []).map(function (f) { return { id: uid(), q: f.q, a: f.a, status: "new" }; });
          course.flashcards = addMode ? keepFlashcards.concat(newFlashcards) : newFlashcards;
          course.quizQuestions = addMode ? keepQuiz.concat(quizQuestions) : quizQuestions;
          course.exercises = addMode ? keepExercises.concat(exercises) : exercises;
          course.status = "ready";
          // Les photos/PDF source ne sont plus utiles une fois le cours généré : la retranscription
          // sert désormais de mémoire pour "Régénérer"/"Ajouter des documents", donc plus la peine
          // d'accumuler les images dans le stockage local (c'est automatique, pas besoin de bouton).
          // Exception : s'il reste un schéma introuvable malgré la reconstruction, on garde les photos
          // — sans elles, "Régénérer" ne pourrait plus jamais retenter, il faudrait tout réimporter.
          if (!stillMissing) course.images = [];
          saveDB();
          genEnd(course.id, true);
          toast("Cours généré · " + course.title);
          if (pre && pre.warning) toast("⚠️ " + pre.warning);
          storeFigureImages();
          render();
          // Recherche de vraies vidéos en arrière-plan, après coup : le cours reste utilisable tout de
          // suite sans attendre cette passe, et si aucune vidéo pertinente n'est trouvée, on laisse
          // simplement la liste vide plutôt que d'inventer un lien.
          generateCourseVideoLinks(course.title, subjectName, chapterName, transcription).then(function (videos) {
            if (videos.length) { course.videos = videos; saveDB(); render(); }
          });
        });
      });
    }).catch(function (err) {
      genEnd(course.id, false);
      course.status = "error";
      course.error = err.message || "Erreur inconnue";
      course.errorStatus = err.status || null;
      course.errorDetail = err.detail || null;
      saveDB();
      toast("Échec de la génération : " + course.error, { status: course.errorStatus, detail: course.errorDetail });
      render();
    });
  }


