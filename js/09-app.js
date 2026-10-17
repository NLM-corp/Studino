"use strict";
// Studino — contrôleur App (actions des boutons)
// Fichier chargé dans l'ordre par index.html : les fichiers partagent les mêmes variables globales.

  /* ---------------- App controller ---------------- */
  window.App = {
    switchAuth: function (mode) { authError = ""; navigate("#/" + mode); },
    submitAuth: async function (e, mode) {
      e.preventDefault();
      var f = e.target;
      var username = f.username.value.trim();
      var password = f.password.value;
      if (!username || !password) return;
      var hash = await sha256(password);
      if (mode === "signup") {
        if (DB.users[username]) { authError = "Ce nom d'utilisateur existe déjà."; renderAuth("signup"); return; }
        DB.users[username] = { passwordHash: hash };
        DB.data[username] = { subjects: [] };
        DB.currentUser = username;
        authError = "";
        saveDB();
        toast("Bienvenue, " + username + " !");
        navigate("#/");
      } else {
        var u = DB.users[username];
        if (!u || u.passwordHash !== hash) { authError = "Identifiants incorrects."; renderAuth("login"); return; }
        DB.currentUser = username;
        authError = "";
        saveDB();
        navigate("#/");
      }
    },
    logout: function () { DB.currentUser = null; saveDB(); navigate("#/"); },
    toggleMobileNav: function () { mobileNavOpen = !mobileNavOpen; render(); },
    closeMobileNav: function () { mobileNavOpen = false; },
    toggleTheme: function () {
      var html = document.documentElement;
      var cur = html.getAttribute("data-app-theme");
      var next = cur === "dark" ? "light" : "dark";
      html.setAttribute("data-app-theme", next);
      localStorage.setItem("recto_theme", next);
    },
    setAppColor: function (color) {
      if (APP_COLORS.indexOf(color) === -1) return;
      document.documentElement.setAttribute("data-app-color", color);
      localStorage.setItem("recto_color", color);
      render();
    },
    setUserGender: function (g) {
      setUserGender(g);
      render();
    },
    toggleReminder: function () {
      if (getReminderEnabled()) { setReminderEnabled(false); render(); return; }
      if (typeof Notification === "undefined") { toast("Les notifications ne sont pas supportées par ce navigateur."); return; }
      Notification.requestPermission().then(function (perm) {
        if (perm === "granted") { setReminderEnabled(true); toast("Rappel activé"); checkRevisionReminder(); }
        else toast("Autorisation refusée — active les notifications pour ce site dans les réglages de ton navigateur.");
        render();
      });
    },
    openModal: function (type, subjectId, themeId, chapterId) {
      modal = { type: type, subjectId: subjectId || (userData().subjects[0] && userData().subjects[0].id), themeId: themeId, chapterId: chapterId, imagePreviews: [] };
      render();
    },
    closeModal: function () { modal = null; render(); },
    changeModalSubject: function (subjectId) {
      modal.subjectId = subjectId;
      var subj = findSubject(subjectId);
      modal.themeId = subj && subj.themes[0] ? subj.themes[0].id : null;
      modal.chapterId = null;
      render();
    },
    changeModalTheme: function (themeId) { modal.themeId = themeId; modal.chapterId = null; render(); },
    handleFile: function (e) {
      App.processDroppedFiles(Array.prototype.slice.call(e.target.files || []));
      e.target.value = "";
    },
    processDroppedFiles: function (files) {
      if (!files || !files.length) return;
      files.forEach(function (file) {
        processImageFile(file).then(function (dataUrl) {
          modal.imagePreviews.push(dataUrl);
          render();
        }).catch(function (err) {
          toast((err && err.message) || ("Impossible de lire " + file.name));
        });
      });
    },
    handleDragOver: function (e) {
      e.preventDefault();
      e.currentTarget.classList.add("file-drop-over");
    },
    handleDragLeave: function (e) {
      e.currentTarget.classList.remove("file-drop-over");
    },
    handleFileDrop: function (e) {
      e.preventDefault();
      e.currentTarget.classList.remove("file-drop-over");
      var files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
      App.processDroppedFiles(files);
    },
    removeCourseImage: function (index) {
      modal.imagePreviews.splice(index, 1);
      render();
    },

    rteCmd: function (id, cmd, value) {
      var el = document.getElementById(id);
      if (!el) return;
      el.focus();
      try { document.execCommand("styleWithCSS", false, true); } catch (e) {}
      document.execCommand(cmd, false, value);
    },

    closeLightModal: function () {
      var ov = document.querySelector(".modal-overlay");
      if (ov) ov.remove();
      if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.hide();
      modal = null;
    },

    openFigureLightbox: function (src) {
      var ov = document.createElement("div");
      ov.className = "figure-lightbox";
      var img = document.createElement("img");
      img.src = src;
      ov.appendChild(img);
      var close = function () { ov.remove(); document.removeEventListener("keydown", onKey); };
      var onKey = function (e) { if (e.key === "Escape") close(); };
      ov.addEventListener("click", close);
      document.addEventListener("keydown", onKey);
      document.body.appendChild(ov);
    },
    openCompanionModal: function () { modal = { type: "companion" }; renderModal(); },
    setCompanion: function (speciesId) {
      dpData().companionSpeciesId = speciesId || null;
      saveDB();
      App.closeLightModal();
      var slot = document.getElementById("dino-companion-panel-slot");
      if (slot) slot.outerHTML = dinoCompanionHtml();
    },

    openDrawing: function (editorId) { openDrawing(editorId); },
    openGraph: function (editorId) { openGraph(editorId); },
    openLatexPicker: function (editorId) {
      var el = document.getElementById(editorId);
      var savedRange = null;
      if (el) {
        var sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          var r = sel.getRangeAt(0);
          if (el.contains(r.commonAncestorContainer)) savedRange = r.cloneRange();
        }
      }
      modal = { type: "latex", editorId: editorId, savedRange: savedRange, editingChip: null };
      renderModal();
      var mf = document.getElementById("latex-mathfield");
      if (mf) {
        mf.focus();
        if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.show();
      }
    },
    editLatexChip: function (chipEl) {
      var editorEl = chipEl.closest(".rte-editor");
      if (!editorEl) return; // read-only display (already submitted) — not editable
      modal = { type: "latex", editorId: editorEl.id, savedRange: null, editingChip: chipEl };
      renderModal();
      var mf = document.getElementById("latex-mathfield");
      if (mf) {
        mf.value = chipEl.getAttribute("data-latex") || "";
        mf.focus();
        if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.show();
      }
    },
    latexMove: function (dir) {
      var mf = document.getElementById("latex-mathfield");
      if (!mf) return;
      var cmd = { left: "moveToPreviousChar", right: "moveToNextChar", up: "moveUp", down: "moveDown", backspace: "deleteBackward" }[dir];
      if (cmd && mf.executeCommand) mf.executeCommand(cmd);
      mf.focus();
    },
    insertLatexFormula: function () {
      var mf = document.getElementById("latex-mathfield");
      var formula = mf && mf.value ? mf.value.trim() : "";
      var m = modal;
      App.closeLightModal();
      if (m.editingChip) {
        if (!formula) { m.editingChip.remove(); return; }
        m.editingChip.setAttribute("data-latex", formula);
        m.editingChip.innerHTML = katexRenderSafe(formula);
        return;
      }
      if (!formula) return;
      var el = m && m.editorId ? document.getElementById(m.editorId) : null;
      if (!el) return;
      el.focus();
      var range = null;
      if (m.savedRange && el.contains(m.savedRange.startContainer)) range = m.savedRange;
      if (!range) {
        range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
      }
      var tpl = document.createElement("template");
      tpl.innerHTML = mathChipHtml(formula);
      var lastNode = tpl.content.lastChild;
      range.deleteContents();
      range.insertNode(tpl.content);
      var sel = window.getSelection();
      sel.removeAllRanges();
      if (lastNode) {
        var after = document.createRange();
        after.setStartAfter(lastNode);
        after.collapse(true);
        sel.addRange(after);
      }
    },

    openPeriodicTable: function (editorId) {
      var el = document.getElementById(editorId);
      var savedRange = null;
      if (el) {
        var sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          var r = sel.getRangeAt(0);
          if (el.contains(r.commonAncestorContainer)) savedRange = r.cloneRange();
        }
      }
      modal = { type: "periodic", editorId: editorId, savedRange: savedRange, selected: null };
      renderModal();
    },
    selectPeriodicElement: function (sym) {
      modal.selected = sym;
      renderModal();
    },
    insertPeriodicElement: function () {
      var m = modal;
      var e = m && m.selected ? PERIODIC_BY_SYM[m.selected] : null;
      if (!e) return;
      var el = m.editorId ? document.getElementById(m.editorId) : null;
      App.closeLightModal();
      if (!el) return;
      el.focus();
      var range = null;
      if (m.savedRange && el.contains(m.savedRange.startContainer)) range = m.savedRange;
      if (!range) {
        range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
      }
      var node = document.createTextNode(e.sym);
      range.deleteContents();
      range.insertNode(node);
      var sel = window.getSelection();
      sel.removeAllRanges();
      var after = document.createRange();
      after.setStartAfter(node);
      after.collapse(true);
      sel.addRange(after);
    },

    openTablePicker: function (editorId) {
      var el = document.getElementById(editorId);
      var savedRange = null;
      if (el) {
        var sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          var r = sel.getRangeAt(0);
          if (el.contains(r.commonAncestorContainer)) savedRange = r.cloneRange();
        }
      }
      modal = { type: "table", editorId: editorId, savedRange: savedRange };
      renderModal();
    },
    insertTable: function (e) {
      e.preventDefault();
      var rows = Math.max(1, Math.min(20, parseInt(e.target.rows.value, 10) || 3));
      var cols = Math.max(1, Math.min(12, parseInt(e.target.cols.value, 10) || 3));
      var m = modal;
      App.closeLightModal();
      var el = m && m.editorId ? document.getElementById(m.editorId) : null;
      if (!el) return;
      el.focus();
      var range = null;
      if (m.savedRange && el.contains(m.savedRange.startContainer)) range = m.savedRange;
      if (!range) {
        range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
      }
      var frag = rteBuildTableFragment(rows, cols);
      var lastNode = frag.lastChild;
      range.deleteContents();
      range.insertNode(frag);
      var sel = window.getSelection();
      sel.removeAllRanges();
      if (lastNode) {
        var after = document.createRange();
        after.selectNodeContents(lastNode);
        after.collapse(true);
        sel.addRange(after);
      }
    },

    createSubject: function (e) {
      e.preventDefault();
      var name = e.target.name.value.trim();
      if (!name) return;
      var s = { id: uid(), name: name, themes: [] };
      userData().subjects.push(s);
      saveDB();
      modal = null;
      toast("Matière créée");
      navigate("#/subject/" + s.id);
    },
    createTheme: function (e) {
      e.preventDefault();
      var name = e.target.name.value.trim();
      if (!name) return;
      var s = findSubject(modal.subjectId);
      var t = { id: uid(), name: name, chapters: [] };
      s.themes.push(t);
      saveDB();
      modal = null;
      toast("Thème créé");
      navigate("#/subject/" + s.id + "/theme/" + t.id);
    },
    createChapter: function (e) {
      e.preventDefault();
      var name = e.target.name.value.trim();
      if (!name) return;
      var s = findSubject(modal.subjectId);
      var th = findTheme(s, modal.themeId);
      var c = { id: uid(), name: name, courses: [] };
      th.chapters.push(c);
      saveDB();
      modal = null;
      toast("Chapitre créé");
      navigate("#/subject/" + s.id + "/theme/" + th.id + "/chapter/" + c.id);
    },
    openMoveChapterModal: function (subjectId, themeId, chapterId) {
      modal = { type: "moveChapter", subjectId: subjectId, themeId: themeId, chapterId: chapterId, destSubjectId: subjectId, destThemeId: null };
      render();
    },
    changeMoveChapterSubject: function (subjectId) {
      modal.destSubjectId = subjectId;
      var subj = findSubject(subjectId);
      modal.destThemeId = subj && subj.themes[0] ? subj.themes[0].id : null;
      render();
    },
    changeMoveChapterTheme: function (themeId) { modal.destThemeId = themeId; render(); },
    confirmMoveChapter: function () {
      var m = modal;
      var srcSubj = findSubject(m.subjectId);
      var srcTheme = findTheme(srcSubj, m.themeId);
      var chap = findChapter(srcTheme, m.chapterId);
      var destSubj = findSubject(m.destSubjectId);
      var destTheme = findTheme(destSubj, m.destThemeId);
      if (!chap || !destTheme) { toast("Choisis une destination valide"); return; }
      if (destTheme.id === srcTheme.id) { toast("Le chapitre est déjà dans ce thème"); App.closeModal(); return; }
      srcTheme.chapters = srcTheme.chapters.filter(function (c) { return c.id !== chap.id; });
      destTheme.chapters.push(chap);
      saveDB();
      modal = null;
      toast("Chapitre déplacé dans « " + destTheme.name + " »");
      navigate("#/subject/" + destSubj.id + "/theme/" + destTheme.id);
    },
    openMoveCourseModal: function (subjectId, themeId, chapterId, courseId) {
      modal = { type: "moveCourse", subjectId: subjectId, themeId: themeId, chapterId: chapterId, courseId: courseId, destSubjectId: subjectId, destThemeId: themeId, destChapterId: null };
      render();
    },
    changeMoveCourseSubject: function (subjectId) {
      modal.destSubjectId = subjectId;
      var subj = findSubject(subjectId);
      var firstTheme = subj && subj.themes[0];
      modal.destThemeId = firstTheme ? firstTheme.id : null;
      var firstChap = firstTheme && firstTheme.chapters[0];
      modal.destChapterId = firstChap ? firstChap.id : null;
      render();
    },
    changeMoveCourseTheme: function (themeId) {
      modal.destThemeId = themeId;
      var theme = findTheme(findSubject(modal.destSubjectId), themeId);
      var firstChap = theme && theme.chapters[0];
      modal.destChapterId = firstChap ? firstChap.id : null;
      render();
    },
    changeMoveCourseChapter: function (chapterId) { modal.destChapterId = chapterId; render(); },
    confirmMoveCourse: function () {
      var m = modal;
      var srcSubj = findSubject(m.subjectId);
      var srcTheme = findTheme(srcSubj, m.themeId);
      var srcChap = findChapter(srcTheme, m.chapterId);
      var co = findCourse(srcChap, m.courseId);
      var destSubj = findSubject(m.destSubjectId);
      var destTheme = findTheme(destSubj, m.destThemeId);
      var destChap = findChapter(destTheme, m.destChapterId);
      if (!co || !destChap) { toast("Choisis une destination valide"); return; }
      if (destChap.id === srcChap.id) { toast("Le cours est déjà dans ce chapitre"); App.closeModal(); return; }
      srcChap.courses = srcChap.courses.filter(function (c) { return c.id !== co.id; });
      destChap.courses.push(co);
      saveDB();
      modal = null;
      toast("Cours déplacé dans « " + destChap.name + " »");
      navigate("#/course/" + co.id);
    },
    createCourse: function (e) {
      e.preventDefault();
      var f = e.target;
      var title = f.title.value.trim();
      var subjectId = f.subjectId.value;
      var themeId = f.themeId ? f.themeId.value : null;
      var chapterId = f.chapterId ? f.chapterId.value : null;
      if (!title || !subjectId || !themeId || !chapterId) return;
      if (!getApiKey()) { toast("Ajoute d'abord ta clé API dans les paramètres"); App.openApiKeyModal(); return; }
      var s = findSubject(subjectId);
      var th = findTheme(s, themeId);
      var c = findChapter(th, chapterId);
      var course = {
        id: uid(), title: title, images: modal.imagePreviews.slice(), status: "processing",
        transcription: "", explanation: "", videos: [], flashcards: [], quizQuestions: [], exercises: [], attempts: [], error: null
      };
      c.courses.push(course);
      saveDB();
      modal = null;
      navigate("#/course/" + course.id);
      runCourseGeneration(course, s.name, c.name);
    },
    createMethodology: function (e) {
      e.preventDefault();
      var f = e.target;
      var title = f.title.value.trim();
      if (!title) return;
      if (!getApiKey()) { toast("Ajoute d'abord ta clé API dans les paramètres"); App.openApiKeyModal(); return; }
      var methodo = {
        // Volontairement sans matière : la même méthode (dissertation, question problématisée...) sert
        // souvent pour plusieurs matières — matière et chapitre se choisissent au moment de s'entraîner.
        id: uid(), title: title, images: modal.imagePreviews.slice(), status: "processing",
        genre: "", mechanics: [], structure: "", transcription: "", practiceItems: [], error: null, createdAt: Date.now()
      };
      methodoData().push(methodo);
      saveDB();
      modal = null;
      navigate("#/methodologies/" + methodo.id);
      runMethodologyGeneration(methodo);
    },
    retryMethodologyGeneration: function (id) {
      var methodo = methodoFind(id);
      if (!methodo) return;
      runMethodologyGeneration(methodo);
    },
    togglePodcastFolder: function (gid) { podcastFolderOpen[gid] = !podcastFolderOpen[gid]; render(); },
    openPodcastModal: function () {
      var firstSubj = userData().subjects[0];
      modal = { type: "podcastGen", subjectId: firstSubj && firstSubj.id, level: "chapter", themeId: null, chapterId: null, courseId: null };
      render();
    },
    changePodcastSubject: function (subjectId) { modal.subjectId = subjectId; modal.themeId = null; modal.chapterId = null; modal.courseId = null; render(); },
    setPodcastLevel: function (level) { modal.level = level; render(); },
    setPodcastLangMode: function (mode) { modal.langMode = mode; render(); },
    changePodcastTheme: function (themeId) { modal.themeId = themeId; modal.chapterId = null; modal.courseId = null; render(); },
    changePodcastChapter: function (chapterId) { modal.chapterId = chapterId; modal.courseId = null; render(); },
    changePodcastCourse: function (courseId) { modal.courseId = courseId; render(); },
    createPodcast: function () {
      var m = modal;
      var subj = findSubject(m.subjectId);
      if (!subj) { toast("Choisis une matière"); return; }
      var level = m.level || "chapter";
      var scopeName, scopeId;
      if (level === "theme") {
        var theme = findTheme(subj, m.themeId);
        if (!theme) { toast("Choisis un thème"); return; }
        scopeName = theme.name;
        scopeId = theme.id;
      } else if (level === "course") {
        var loc = locateCourse(m.courseId);
        if (!loc || loc.subject.id !== subj.id) { toast("Choisis un cours"); return; }
        scopeName = loc.course.title;
        scopeId = loc.course.id;
      } else {
        var chap = findChapterAnywhere(subj, m.chapterId);
        if (!chap) { toast("Choisis un chapitre"); return; }
        scopeName = chap.name;
        scopeId = chap.id;
      }
      var content = podcastScopeContentText(subj, level, scopeId);
      if (!getApiKey()) { toast("Ajoute d'abord ta clé API dans les paramètres"); App.openApiKeyModal(); return; }
      if (!content) { toast(level === "course" ? "Ce cours n'a pas encore été généré" : "Ce " + podcastScopeLabel(level) + " n'a aucun cours généré"); return; }
      // Le nombre de parties n'est PAS choisi ici : c'est l'IA qui décide selon la richesse réelle du
      // contenu (voir runPodcastGeneration). On crée une seule entrée pour l'instant, les parties
      // suivantes (s'il y en a) seront ajoutées dynamiquement une fois la réponse connue.
      var pod = {
        id: uid(), groupId: uid(), title: scopeName,
        subjectId: subj.id, subjectName: subj.name, scopeLevel: level, scopeId: scopeId, scopeName: scopeName,
        langMode: m.langMode || "auto",
        partIndex: 1, partCount: 1,
        status: "processing", error: null, errorStatus: null, errorDetail: null,
        script: "", segments: [], audioUrl: "", durationSec: 0, createdAt: Date.now(), processingStartedAt: Date.now()
      };
      podcastData().push(pod);
      saveDB();
      modal = null;
      navigate("#/podcasts/" + pod.id);
      runPodcastGeneration(pod, subj.name, scopeName, content);
    },
    retryPodcastGeneration: function (id) {
      var pod = podcastFind(id);
      if (!pod) return;
      if (!getApiKey()) { toast("Ajoute d'abord ta clé API dans les paramètres"); App.openApiKeyModal(); return; }
      // Le script de cette partie a déjà été généré avec succès (seule la voix a échoué) : on ne
      // relance que l'audio, jamais tout le podcast — sinon l'IA redécoupe le script à neuf avec un
      // nombre de parties potentiellement différent, créant des doublons avec les parties déjà prêtes.
      if (pod.script) {
        // Puis, si ça marche, les autres parties du même podcast restées sans voix (ex. génération
        // interrompue par un rechargement de page), une par une, en s'arrêtant au premier échec.
        var retryChain = function (p) {
          return retryPodcastPartAudio(p).then(function () {
            if (p.status !== "ready") return;
            var next = podcastData().filter(function (x) { return podcastGroupKey(x) === podcastGroupKey(p) && x.status === "error" && x.script; })
              .sort(function (a, b) { return a.partIndex - b.partIndex; })[0];
            if (next) return retryChain(next);
          });
        };
        retryChain(pod);
        return;
      }
      var subj = findSubject(pod.subjectId);
      if (!subj) return;
      var content = podcastScopeContentText(subj, pod.scopeLevel, pod.scopeId);
      runPodcastGeneration(pod, subj.name, pod.scopeName, content);
    },
    // Actualiser = refaire TOUT le podcast à partir des cours actuels (pas ajouter des parties à la
    // fin), en silence : le nouveau reste caché jusqu'à ce que TOUTES ses parties aient leur voix, puis
    // remplace l'ancien d'un coup (voir finalizePodcastReplacement).
    refreshPodcast: function (gid) {
      var parts = podcastGroupParts(gid).filter(function (p) { return !p.pendingReplace; });
      if (!parts.length) return;
      if (parts.some(function (p) { return p.status === "processing"; })) { toast("Attends que la génération en cours de ce podcast soit terminée."); return; }
      if (podcastPendingFor(gid).length) { toast("Une actualisation de ce podcast est déjà en cours."); return; }
      if (!getApiKey()) { toast("Ajoute d'abord ta clé API dans les paramètres"); App.openApiKeyModal(); return; }
      var ch = podcastGroupChanges(parts);
      if (ch.known && !ch.added.length && !ch.modified.length) { toast("Aucun cours ajouté ou modifié depuis ce podcast — il est déjà à jour."); return; }
      var first = parts[0];
      var subj = findSubject(first.subjectId);
      if (!subj) { toast("La matière de ce podcast n'existe plus."); return; }
      var content = podcastScopeContentText(subj, first.scopeLevel, first.scopeId);
      if (!content) { toast(first.scopeLevel === "course" ? "Ce cours n'existe plus ou n'est plus généré." : "Ce " + podcastScopeLabel(first.scopeLevel) + " n'a plus aucun cours généré."); return; }
      var pod = {
        id: uid(), groupId: uid(), title: first.scopeName, pendingReplace: gid, groupName: first.groupName,
        subjectId: first.subjectId, subjectName: first.subjectName,
        scopeLevel: first.scopeLevel, scopeId: first.scopeId, scopeName: first.scopeName,
        langMode: first.langMode || "auto",
        partIndex: 1, partCount: 1,
        status: "processing", error: null, errorStatus: null, errorDetail: null,
        script: "", segments: [], audioUrl: "", durationSec: 0, createdAt: Date.now(), processingStartedAt: Date.now()
      };
      podcastData().push(pod);
      saveDB();
      toast("Actualisation lancée — tu peux continuer à écouter l'ancien podcast, il sera remplacé une fois le nouveau entièrement prêt.");
      runPodcastGeneration(pod, subj.name, first.scopeName, content);
    },
    // Reprend une actualisation interrompue : voix manquantes (texte déjà là) une par une, ou texte
    // entier s'il n'avait pas pu être écrit. Les voix sont refaites à la suite, pas en parallèle,
    // pour ne pas épuiser le quota d'un coup.
    retryPodcastRefresh: function (oldGid) {
      var pending = podcastPendingFor(oldGid);
      if (!pending.length) return;
      if (!getApiKey()) { toast("Ajoute d'abord ta clé API dans les paramètres"); App.openApiKeyModal(); return; }
      var first = pending[0];
      if (!first.script) {
        var subj = findSubject(first.subjectId);
        if (!subj) { toast("La matière de ce podcast n'existe plus."); return; }
        var content = podcastScopeContentText(subj, first.scopeLevel, first.scopeId);
        runPodcastGeneration(first, subj.name, first.scopeName, content);
        return;
      }
      var failed = pending.filter(function (p) { return p.status === "error"; });
      failed.reduce(function (chain, p) {
        return chain.then(function () { return retryPodcastPartAudio(p); });
      }, Promise.resolve());
    },
    cancelPodcastRefresh: function (oldGid) {
      var d = userData();
      d.podcasts = d.podcasts.filter(function (p) { return p.pendingReplace !== oldGid; });
      saveDB();
      toast("Actualisation annulée — ton podcast actuel est conservé.");
      render();
    },
    // Fin de l'audio d'une partie : si une partie suivante existe déjà et est prête, enchaîne
    // directement dessus (lecture automatique) plutôt que de laisser l'élève devoir la chercher.
    podcastOnEnded: function () {
      var icon = document.getElementById("podcast-play-icon");
      if (icon) icon.textContent = "▶";
      var parts = location.hash.replace(/^#\//, "").split("/");
      var pod = parts[0] === "podcasts" && parts[1] ? podcastFind(parts[1]) : null;
      if (!pod || !pod.partCount || pod.partIndex >= pod.partCount) return;
      var next = podcastData().find(function (p) { return p.groupId === pod.groupId && p.partIndex === pod.partIndex + 1; });
      if (next && next.status === "ready") {
        podcastAutoPlayNext = true;
        location.hash = "#/podcasts/" + next.id;
      }
    },
    openPodcastErrorDetail: function (id) {
      var pod = podcastFind(id);
      if (!pod) return;
      modal = { type: "errorDetail", status: pod.errorStatus, detail: pod.errorDetail };
      render();
    },
    downloadPodcastMp3: function (id) {
      var pod = podcastFind(id);
      if (!pod || pod.status !== "ready" || !pod.audioUrl) return;
      var filename = String(pod.title || "podcast").replace(/[\\/:*?"<>|]/g, "_") + ".mp3";
      runMp3Job("p:" + id, function (onProgress) {
        return parseWavPcm16(pod.audioUrl).then(function (wav) {
          return pcm16ToMp3Blob(wav.samples, wav.sampleRate, wav.numChannels, onProgress);
        });
      }, filename);
    },
    downloadPodcastGroupMp3: function (groupId) {
      var parts = podcastData().filter(function (p) { return p.groupId === groupId && p.status === "ready" && p.audioUrl; })
        .sort(function (a, b) { return a.partIndex - b.partIndex; });
      if (!parts.length) return;
      var filename = String(podcastGroupDisplayName(parts) || "podcast").replace(/[\\/:*?"<>|]/g, "_") + ".mp3";
      runMp3Job("g:" + groupId, function (onProgress) { return mergePodcastPartsToMp3Blob(parts, onProgress); }, filename);
    },
    podcastToggleAudio: function () {
      var a = document.getElementById("podcast-audio");
      if (!a) return;
      if (a.paused) a.play(); else a.pause();
    },
    podcastSeek: function (val) {
      var a = document.getElementById("podcast-audio");
      if (!a || !a.duration) return;
      a.currentTime = (val / 1000) * a.duration;
    },
    setPodcastRate: function (r) {
      podcastRate = r;
      try { localStorage.setItem("studino-podcast-rate", String(r)); } catch (e) {}
      var a = document.getElementById("podcast-audio");
      if (a) { a.defaultPlaybackRate = r; a.playbackRate = r; }
      document.querySelectorAll(".podcast-rate-btn").forEach(function (b) { b.classList.toggle("active", parseFloat(b.getAttribute("data-rate")) === r); });
    },
    podcastSkip: function (sec) {
      var a = document.getElementById("podcast-audio");
      if (!a) return;
      a.currentTime = Math.max(0, Math.min(a.duration || 0, a.currentTime + sec));
    },
    setMethodoTrainSubject: function (id, subjectId) {
      var st = methodoTrainState[id] || (methodoTrainState[id] = {});
      st.subjectId = subjectId;
      st.chapterId = ""; // redéterminé au rendu suivant à partir des chapitres de la nouvelle matière
      render();
    },
    setMethodoTrainChapter: function (id, chapterId) { (methodoTrainState[id] || (methodoTrainState[id] = {})).chapterId = chapterId; render(); },
    setMethodoTrainMechanic: function (id, mechanic) { (methodoTrainState[id] || (methodoTrainState[id] = {})).mechanic = mechanic; render(); },
    setMethodoTrainCustom: function (id, text) { (methodoTrainState[id] || (methodoTrainState[id] = {})).customMechanic = text; },
    generateMethodoSubject: function (id) {
      var methodo = methodoFind(id);
      if (!methodo || methodo.generatingPractice) return;
      var st = methodoTrainState[id];
      if (!st || !st.subjectId) { toast("Choisis une matière"); return; }
      var subj = findSubject(st.subjectId);
      if (!subj) return;
      if (!st.chapterId) { toast("Choisis un chapitre"); return; }
      if (st.mechanic === METHODOLOGY_MECHANIC_CUSTOM && !(st.customMechanic || "").trim()) { toast("Précise ce que tu veux comme entraînement"); return; }
      if (!getApiKey()) { toast("Ajoute d'abord ta clé API dans les paramètres"); App.openApiKeyModal(); return; }
      var chap = findChapterAnywhere(subj, st.chapterId);
      if (!chap) return;
      var content = chapterContentText(subj, st.chapterId);
      var customInstruction = st.mechanic === METHODOLOGY_MECHANIC_CUSTOM ? st.customMechanic.trim() : "";
      runMethodologyPracticeGeneration(methodo, chap.id, chap.name, content, st.mechanic, subj.name, customInstruction).catch(function () {});
    },
    submitMethodoAnswer: function (methodoId, itemId) {
      var methodo = methodoFind(methodoId);
      if (!methodo) return;
      var item = (methodo.practiceItems || []).find(function (x) { return x.id === itemId; });
      if (!item) return;
      if (!getApiKey()) { toast("Ajoute d'abord ta clé API dans les paramètres"); App.openApiKeyModal(); return; }
      var answerHtml = rteValue("methodo-answer-" + item.id);
      var answerText = rteText("methodo-answer-" + item.id);
      if (!answerText.trim()) { toast("Écris une réponse avant de valider"); return; }
      submitMethodologyAnswer(methodo, item, answerHtml, answerText);
    },
    toggleMethodoItem: function (itemId) { methodoItemOpen[itemId] = !methodoItemOpen[itemId]; render(); },
    toggleMethodoTranscription: function (id) { methodoTranscriptionOpen[id] = !methodoTranscriptionOpen[id]; render(); },
    deleteMethodoItem: function (methodoId, itemId) {
      var methodo = methodoFind(methodoId);
      if (!methodo) return;
      methodo.practiceItems = (methodo.practiceItems || []).filter(function (x) { return x.id !== itemId; });
      saveDB();
      toast("Sujet supprimé");
      render();
    },
    retryGeneration: function (courseId) {
      var loc = locateCourse(courseId);
      if (!loc) return;
      if (loc.course.images && loc.course.images.length) {
        runCourseGeneration(loc.course, loc.subject.name, loc.chapter.name);
      } else {
        // Plus de photos/PDF conservés (espace libéré) : on régénère explication/flashcards/contrôle/
        // exercices à partir de la retranscription déjà connue, plutôt que d'échouer ou de repartir de rien.
        runCourseGeneration(loc.course, loc.subject.name, loc.chapter.name, [], protectFigureRefs(loc.course.transcription));
      }
    },
    openCourseChat: function (courseId) { courseChatOpen[courseId] = true; courseChatScrollIntoView = true; render(); },
    closeCourseChat: function (courseId) { courseChatOpen[courseId] = false; render(); },
    toggleCourseChatSize: function () {
      courseChatBig = !courseChatBig;
      try { localStorage.setItem("studino-chat-big", courseChatBig ? "1" : "0"); } catch (e) {}
      var box = document.getElementById("course-chat");
      if (box) box.classList.toggle("course-chat-big", courseChatBig);
      var btn = box && box.querySelector("[data-chat-size]");
      if (btn) { btn.textContent = courseChatBig ? "⤡ Réduire" : "⤢ Agrandir"; btn.title = courseChatBig ? "Réduire la fenêtre" : "Agrandir la fenêtre"; }
    },
    setCourseChatDraft: function (courseId, value) { courseChatDraft[courseId] = value; },
    resetCourseChat: function (courseId) {
      var loc = locateCourse(courseId);
      if (!loc || courseChatPending[courseId]) return;
      loc.course.chat = [];
      saveDB();
      courseChatScrollIntoView = true;
      render();
    },
    sendCourseChat: function (courseId) {
      var loc = locateCourse(courseId);
      if (!loc || courseChatPending[courseId]) return;
      // Texte envoyé à l'IA : formules en $...$, tableaux en lignes/colonnes (comme pour « Mes exos ») ;
      // le HTML sert juste à réafficher le message tel que l'élève l'a écrit.
      var text = rteText("course-chat-input");
      if (!text) return;
      if (!getApiKey()) { toast("Ajoute d'abord ta clé API dans les paramètres"); App.openApiKeyModal(); return; }
      var course = loc.course;
      course.chat = course.chat || [];
      var msg = { role: "user", text: text, html: rteValue("course-chat-input"), at: Date.now() };
      courseChatDraft[courseId] = "";
      var ed = document.getElementById("course-chat-input");
      if (ed) ed.innerHTML = "";
      course.chat.push(msg);
      courseChatPending[courseId] = true;
      courseChatScrollIntoView = true;
      saveDB(); render();
      // Les 20 derniers messages suffisent comme contexte (le cours, lui, part en entier à chaque fois).
      var history = course.chat.slice(-20);
      courseChatStream[courseId] = "";
      // La réponse s'affiche au fur et à mesure qu'elle s'écrit (mise à jour directe de la bulle, sans
      // redessiner toute la page), au plus une fois par image pour rester fluide.
      var frameQueued = false;
      var onText = function (soFar) {
        courseChatStream[courseId] = soFar;
        if (frameQueued) return;
        frameQueued = true;
        requestAnimationFrame(function () {
          frameQueued = false;
          var bubble = document.getElementById("course-chat-stream");
          var list = document.getElementById("course-chat-list");
          if (!bubble || !list) return;
          var nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
          bubble.className = "chat-msg-body prose";
          bubble.innerHTML = mdToHtml(courseChatStream[courseId] || "", course.figures);
          if (nearBottom) list.scrollTop = list.scrollHeight;
        });
      };
      // Dessins envoyés dans la conversation : joints en images, avec un repère à leur place dans le texte.
      var chatDrawn = drawingsForAnswer(buildCourseChatPrompt(course, loc, history));
      var chatParts = chatDrawn.images.length ? drawingParts(chatDrawn.images).concat([{ text: chatDrawn.text }]) : chatDrawn.text;
      streamCourseChatReply(chatParts, onText).then(function (reply) {
        reply = String(reply || "").trim();
        course.chat.push({ role: "model", text: reply || "Hmm… je n'ai pas su quoi répondre, repose-moi ta question autrement.", at: Date.now() });
      }).catch(function (err) {
        // Coupure en plein milieu : on garde ce qui a déjà été écrit plutôt que de tout perdre.
        var partial = String(courseChatStream[courseId] || "").trim();
        course.chat.push(partial
          ? { role: "model", text: partial + "\n\n*(réponse coupée, repose ta question si besoin)*", at: Date.now() }
          : { role: "model", text: "⚠️ Je n'ai pas pu te répondre (" + (err && err.message || "erreur inconnue") + "). Réessaie dans un instant.", at: Date.now(), error: true });
      }).then(function () {
        courseChatStream[courseId] = "";
        courseChatPending[courseId] = false;
        courseChatScrollIntoView = true;
        saveDB();
        var parts = parseHash();
        if (parts[0] === "course" && parts[1] === courseId) render();
      });
    },
    openAddCourseDocsModal: function (courseId) {
      var loc = locateCourse(courseId);
      if (!loc) return;
      modal = { type: "addCourseDocs", courseId: courseId, imagePreviews: [] };
      render();
    },
    addCourseDocs: function (e) {
      e.preventDefault();
      if (!modal.imagePreviews.length) { toast("Ajoute au moins une nouvelle photo"); return; }
      if (!getApiKey()) { toast("Ajoute d'abord ta clé API dans les paramètres"); App.openApiKeyModal(); return; }
      var loc = locateCourse(modal.courseId);
      if (!loc) { App.closeModal(); return; }
      var newImages = modal.imagePreviews.slice();
      var priorTranscription = stripFigureMarkdown(loc.course.transcription);
      // On ne garde que ce dernier lot de photos (pas la peine d'accumuler les anciennes : leur
      // contenu est déjà fusionné dans la transcription, qui sert de mémoire du cours à la place).
      loc.course.images = newImages;
      saveDB();
      modal = null;
      navigate("#/course/" + loc.course.id);
      runCourseGeneration(loc.course, loc.subject.name, loc.chapter.name, newImages, priorTranscription);
    },
    openCourseErrorDetail: function (courseId) {
      var loc = locateCourse(courseId);
      if (!loc) return;
      modal = { type: "errorDetail", status: loc.course.errorStatus, detail: loc.course.errorDetail };
      render();
    },

    openRevisionSheetModal: function () {
      var subs = userData().subjects;
      var firstSubj = subs[0];
      var firstTheme = firstSubj && dpThemesWithContent(firstSubj)[0];
      var firstChap = firstTheme && dpChaptersWithContent(firstTheme)[0];
      modal = { type: "revisionSheetGen", subjectId: firstSubj && firstSubj.id, themeId: firstTheme && firstTheme.id, chapterId: firstChap && firstChap.id, scope: "chapter", courseId: null };
      render();
    },
    changeRevisionSheetSubject: function (subjectId) {
      modal.subjectId = subjectId;
      var subj = findSubject(subjectId);
      var firstTheme = subj && dpThemesWithContent(subj)[0];
      modal.themeId = firstTheme ? firstTheme.id : null;
      var firstChap = firstTheme ? dpChaptersWithContent(firstTheme)[0] : null;
      modal.chapterId = firstChap ? firstChap.id : null;
      var firstCourses = firstChap ? dpCoursesWithContent(firstChap) : [];
      modal.courseId = modal.scope === "course" && firstCourses[0] ? firstCourses[0].id : null;
      render();
    },
    changeRevisionSheetTheme: function (themeId) {
      modal.themeId = themeId;
      var theme = findTheme(findSubject(modal.subjectId), themeId);
      var firstChap = theme ? dpChaptersWithContent(theme)[0] : null;
      modal.chapterId = firstChap ? firstChap.id : null;
      var courses = firstChap ? dpCoursesWithContent(firstChap) : [];
      modal.courseId = modal.scope === "course" && courses[0] ? courses[0].id : null;
      render();
    },
    changeRevisionSheetScope: function (scope) {
      modal.scope = scope;
      var theme = findTheme(findSubject(modal.subjectId), modal.themeId);
      var chap = findChapter(theme, modal.chapterId);
      var courses = chap ? dpCoursesWithContent(chap) : [];
      modal.courseId = scope === "course" && courses[0] ? courses[0].id : null;
      render();
    },
    changeRevisionSheetChapter: function (chapterId) {
      modal.chapterId = chapterId;
      var theme = findTheme(findSubject(modal.subjectId), modal.themeId);
      var chap = findChapter(theme, chapterId);
      var courses = chap ? dpCoursesWithContent(chap) : [];
      modal.courseId = modal.scope === "course" && courses[0] ? courses[0].id : null;
      render();
    },
    changeRevisionSheetCourse: function (courseId) { modal.courseId = courseId; render(); },
    generateRevisionSheet: function () {
      var m = modal;
      var subj = findSubject(m.subjectId);
      if (!subj) return;
      var theme = findTheme(subj, m.themeId);
      if (!theme) { toast("Choisis un thème"); return; }
      if (!getApiKey()) { toast("Ajoute d'abord ta clé API dans les paramètres"); App.openApiKeyModal(); return; }
      var courses, title, chap = null;
      if (m.scope === "theme") {
        courses = [];
        theme.chapters.forEach(function (c) { c.courses.forEach(function (co) { if (dpCourseHasContent(co)) courses.push(co); }); });
        if (!courses.length) { toast("Ce thème n'a aucun cours généré"); return; }
        title = theme.name;
      } else {
        chap = findChapter(theme, m.chapterId);
        if (!chap) { toast("Choisis un chapitre"); return; }
        if (m.scope === "course") {
          var co = findCourse(chap, m.courseId);
          if (!co || !dpCourseHasContent(co)) { toast("Choisis un cours"); return; }
          courses = [co];
          title = co.title;
        } else {
          courses = chap.courses.filter(dpCourseHasContent);
          if (!courses.length) { toast("Ce chapitre n'a aucun cours généré"); return; }
          title = chap.name;
        }
      }
      var sheet = {
        id: uid(), title: title, scope: m.scope, subjectId: subj.id, themeId: theme.id, chapterId: chap ? chap.id : null, courseId: m.scope === "course" ? m.courseId : null,
        content: "", schemas: [], status: "processing", error: null, errorStatus: null, errorDetail: null, createdAt: Date.now()
      };
      userData().revisionSheets.push(sheet);
      saveDB();
      modal = null;
      navigate("#/revision/" + sheet.id);
      runRevisionSheetGeneration(sheet, courses, subj.name, chap ? chap.name : theme.name);
    },
    retryRevisionSheetGeneration: function (sheetId) {
      var sheet = userData().revisionSheets.find(function (x) { return x.id === sheetId; });
      if (!sheet) return;
      var subj = findSubject(sheet.subjectId);
      var theme = subj && findTheme(subj, sheet.themeId);
      if (!subj || !theme) { toast("Matière ou thème introuvable"); return; }
      var courses, scopeName;
      if (sheet.scope === "theme") {
        courses = [];
        theme.chapters.forEach(function (c) { c.courses.forEach(function (co) { if (dpCourseHasContent(co)) courses.push(co); }); });
        scopeName = theme.name;
      } else {
        var chap = findChapter(theme, sheet.chapterId);
        if (!chap) { toast("Chapitre introuvable"); return; }
        courses = sheet.scope === "course"
          ? [findCourse(chap, sheet.courseId)].filter(Boolean)
          : chap.courses.filter(dpCourseHasContent);
        scopeName = chap.name;
      }
      if (!courses.length) { toast("Plus aucun cours source disponible"); return; }
      runRevisionSheetGeneration(sheet, courses, subj.name, scopeName);
    },
    openRevisionSheetErrorDetail: function (sheetId) {
      var sheet = userData().revisionSheets.find(function (x) { return x.id === sheetId; });
      if (!sheet) return;
      modal = { type: "errorDetail", status: sheet.errorStatus, detail: sheet.errorDetail };
      render();
    },
    downloadRevisionSheetPdf: function (sheetId) {
      var sheet = userData().revisionSheets.find(function (x) { return x.id === sheetId; });
      if (!sheet || sheet.status !== "ready") return;
      var subj = findSubject(sheet.subjectId);
      var theme = subj && findTheme(subj, sheet.themeId);
      var chap = theme && findChapter(theme, sheet.chapterId);
      printAndDownload(buildRevisionSheetPrintHtml(sheet, subj ? subj.name : "", chap ? chap.name : ""), sheet.title);
    },
    downloadMethodologyPdf: function (id) {
      var methodo = methodoFind(id);
      if (!methodo || methodo.status !== "ready") return;
      printAndDownload(buildMethodologyPrintHtml(methodo), methodo.title);
    },
    openDownloadCourseModal: function (courseId) {
      var loc = locateCourse(courseId);
      if (!loc) return;
      modal = { type: "downloadCourse", courseId: courseId };
      render();
    },
    confirmDownloadCoursePdf: function (courseId, includeExplanation) {
      var loc = locateCourse(courseId);
      if (!loc) return;
      printAndDownload(buildCoursePrintHtml(loc.course, loc.subject.name, loc.chapter.name, includeExplanation), loc.course.title);
      modal = null;
      render();
    },
    viewRevisionSheetRaw: function (sheetId) {
      var sheet = userData().revisionSheets.find(function (x) { return x.id === sheetId; });
      if (!sheet) return;
      modal = { type: "revisionSheetRaw", content: sheet.content };
      render();
    },
    adjustPrintScale: function (delta) {
      setPrintScale(getPrintScale() + delta);
      render();
    },

    openExamPrepModal: function () {
      var subs = userData().subjects;
      var firstSubj = subs[0];
      var firstTheme = firstSubj && dpThemesWithContent(firstSubj)[0];
      var firstChap = firstTheme && dpChaptersWithContent(firstTheme)[0];
      modal = { type: "examPrepGen", title: "", examDate: "", level: "chapter", subjectId: firstSubj && firstSubj.id, themeId: firstTheme && firstTheme.id, chapterId: firstChap && firstChap.id, courseId: null, methodologyId: null };
      render();
    },
    setExamPrepField: function (field, value) { modal[field] = value; },
    refreshModal: function () { if (modal) renderModal(); },
    // Changer le type de révision d'une prépa existante : le planning des jours restants est refait
    // (les jours passés et les séances déjà faites, ainsi que la maîtrise des notions, sont gardés).
    setExamPrepRevisionMode: function (prepId, mode) {
      var prep = userData().examPreps.find(function (p) { return p.id === prepId; });
      if (!prep || prep.planStatus === "processing") return;
      if (!getApiKey()) { toast("Ajoute d'abord ta clé API dans les paramètres"); App.openApiKeyModal(); return; }
      prep.revisionMode = mode;
      runExamPlanGeneration(prep);
    },
    changeExamPrepLevel: function (level) {
      modal.level = level;
      var theme = findTheme(findSubject(modal.subjectId), modal.themeId);
      var chap = findChapter(theme, modal.chapterId);
      var courses = chap ? dpCoursesWithContent(chap) : [];
      modal.courseId = level === "course" && courses[0] ? courses[0].id : null;
      render();
    },
    changeExamPrepSubject: function (subjectId) {
      modal.subjectId = subjectId;
      modal.methodologyId = null;
      var subj = findSubject(subjectId);
      var firstTheme = subj && dpThemesWithContent(subj)[0];
      modal.themeId = firstTheme ? firstTheme.id : null;
      var firstChap = firstTheme ? dpChaptersWithContent(firstTheme)[0] : null;
      modal.chapterId = firstChap ? firstChap.id : null;
      var firstCourses = firstChap ? dpCoursesWithContent(firstChap) : [];
      modal.courseId = modal.level === "course" && firstCourses[0] ? firstCourses[0].id : null;
      render();
    },
    changeExamPrepTheme: function (themeId) {
      modal.themeId = themeId;
      var theme = findTheme(findSubject(modal.subjectId), themeId);
      var firstChap = theme ? dpChaptersWithContent(theme)[0] : null;
      modal.chapterId = firstChap ? firstChap.id : null;
      var courses = firstChap ? dpCoursesWithContent(firstChap) : [];
      modal.courseId = modal.level === "course" && courses[0] ? courses[0].id : null;
      render();
    },
    changeExamPrepChapter: function (chapterId) {
      modal.chapterId = chapterId;
      var theme = findTheme(findSubject(modal.subjectId), modal.themeId);
      var chap = findChapter(theme, chapterId);
      var courses = chap ? dpCoursesWithContent(chap) : [];
      modal.courseId = modal.level === "course" && courses[0] ? courses[0].id : null;
      render();
    },
    changeExamPrepCourse: function (courseId) { modal.courseId = courseId; render(); },
    createExamPrep: function () {
      var m = modal;
      if (!m.examDate) { toast("Choisis une date d'examen"); return; }
      if (m.examDate < epTodayStr()) { toast("La date de l'examen doit être dans le futur"); return; }
      var subj = findSubject(m.subjectId);
      if (!subj) return;
      var scope = { level: m.level, subjectId: subj.id, themeId: null, chapterId: null, courseId: null };
      var label;
      if (m.level === "subject") {
        label = subj.name;
      } else {
        var theme = findTheme(subj, m.themeId);
        if (!theme) { toast("Choisis un thème"); return; }
        scope.themeId = theme.id;
        if (m.level === "theme") {
          label = subj.name + " · " + theme.name;
        } else {
          var chap = findChapter(theme, m.chapterId);
          if (!chap) { toast("Choisis un chapitre"); return; }
          scope.chapterId = chap.id;
          if (m.level === "chapter") {
            label = chap.name;
          } else {
            var co = findCourse(chap, m.courseId);
            if (!co || !dpCourseHasContent(co)) { toast("Choisis un cours"); return; }
            scope.courseId = co.id;
            label = co.title;
          }
        }
      }
      if (!epScopeCourses(scope).length) { toast("Aucun cours généré dans cette sélection"); return; }
      if (!getApiKey()) { toast("Ajoute d'abord ta clé API dans les paramètres"); App.openApiKeyModal(); return; }
      var prep = {
        id: uid(), title: (m.title || "").trim() || label, examDate: m.examDate, scope: scope, createdAt: Date.now(),
        methodologyId: m.methodologyId || null,
        revisionMode: m.revisionMode || "auto",
        planStatus: "processing", planError: null, planErrorStatus: null, planErrorDetail: null,
        overview: "", days: [], topicStatus: {}, sessions: {}, gapFlashcards: [], activeSession: null
      };
      userData().examPreps.push(prep);
      saveDB();
      modal = null;
      navigate("#/examprep/" + prep.id);
      runExamPlanGeneration(prep);
    },
    retryExamPlanGeneration: function (prepId) {
      var prep = epFind(prepId);
      if (!prep) return;
      runExamPlanGeneration(prep);
    },
    openExamPrepEditDate: function (prepId) {
      var prep = epFind(prepId);
      if (!prep) return;
      modal = { type: "examPrepEditDate", prepId: prepId, examDate: prep.examDate };
      render();
    },
    saveExamPrepEditDate: function () {
      var m = modal;
      var prep = epFind(m.prepId);
      if (!prep) return;
      if (!m.examDate) { toast("Choisis une date d'examen"); return; }
      if (m.examDate < epTodayStr()) { toast("La date de l'examen doit être dans le futur"); return; }
      prep.examDate = m.examDate;
      saveDB();
      modal = null;
      runExamPlanGeneration(prep);
    },
    openExamPrepErrorDetail: function (prepId) {
      var prep = epFind(prepId);
      if (!prep) return;
      modal = { type: "errorDetail", status: prep.planErrorStatus, detail: prep.planErrorDetail };
      render();
    },
    startExamPrepDay: function (prepId, dateOverride) {
      var prep = epFind(prepId);
      if (!prep) return;
      epEnsureTopics(prep);
      var date = dateOverride || epTodayStr();
      var dayEntry = prep.days.find(function (d) { return d.date === date; });
      if (!dayEntry) { toast("Pas de séance prévue ce jour-là pour cette prépa"); return; }
      var pool = epQuestionPool(epScopeCourses(prep.scope));
      if (!pool.length) { toast("Aucune question disponible pour cette sélection"); return; }
      var plan = epSessionPlan(prep);
      var picked = epPickDayQuestions(pool, dayEntry, prep, plan);
      if (!picked.length) { toast("Aucune question disponible pour cette sélection"); return; }
      var launch = function (finalPool) {
        epStartingSessionFor = null;
        epSession = { prepId: prepId, date: date, pool: finalPool, idx: 0, answer: null, answerHtml: "", status: "answering", aiFeedback: "", revealed: false, wasCorrect: null, correct: 0, wrong: 0, history: [], review: null, readinessBefore: epReadinessPercent(prep), startedAt: Date.now(), done: false };
        epSaveActiveSession(epSession); // capture le pool tiré dès le départ, pour ne jamais le retirer au hasard si l'élève quitte avant même la 1re réponse
        render();
      };
      // Si cette prépa a une méthodologie liée, chaque séance inclut EN PLUS un sujet à rédiger dessus
      // (généré à la volée, jamais pré-stocké — c'est justement l'effet de surprise recherché) : on
      // l'ajoute au pool juste avant de lancer la séance, sous le même sablier que la réécriture des
      // exercices déjà vus, pour étaler l'entraînement à l'écrit long sur toute la durée de la prépa.
      // Sujet de méthodologie (environ 20 min) : une séance sur trois seulement (voir epSessionPlan).
      var methodo = plan.methodo && prep.methodologyId ? methodoFind(prep.methodologyId) : null;
      var finalizeLaunchBase = function (finalPool) {
        if (!methodo || methodo.status !== "ready" || !getApiKey()) { launch(finalPool); return; }
        // La méthodologie n'est plus liée à une seule matière : ici on utilise la matière de LA PRÉPA
        // elle-même (celle dont le scope a été choisi à la création), puisque c'est elle qui détermine
        // quels chapitres sont réellement en cours de révision dans cette prépa précise.
        var subj = findSubject(prep.scope.subjectId);
        var chapters = subj ? subjectChaptersWithContent(subj) : [];
        if (!chapters.length) { launch(finalPool); return; }
        epStartingSessionFor = prepId + "::" + date;
        render();
        var chap = chapters.find(function (c) { return (dayEntry.topics || []).some(function (t) { return epNormTopic(t) === epNormTopic(c.name); }); }) || chapters[0];
        var content = chapterContentText(subj, chap.id);
        generateMethodologyPracticeItem(methodo, chap.id, chap.name, content, methodo.mechanics[0] || "redaction", subj.name).then(function (item) {
          item.kind = "methodo";
          item.methodologyId = methodo.id;
          item.prompt = item.subject; // alias pour rester compatible avec le pipeline historique/thèmes commun à tous les items
          finalPool.push(item);
          launch(finalPool);
        }).catch(function () {
          // Pas grave si ça échoue : on démarre quand même la séance sans le sujet de méthodologie
          // plutôt que de bloquer tout le reste de la révision du jour.
          launch(finalPool);
        });
      };
      // Exercices inédits de la séance (voir addFreshExercises), puis méthodologie éventuelle, puis lancement.
      var finalizeLaunch = function (finalPool) {
        epStartingSessionFor = prepId + "::" + date;
        render();
        addFreshExercises(prep, dayEntry, finalPool, prepId + "::" + date, plan.fresh).then(finalizeLaunchBase);
      };
      prep.itemUseCount = prep.itemUseCount || {};
      // Un item déjà rencontré lors d'une séance précédente de cette même prépa est réécrit (valeurs et
      // contexte différents, même notion) avant de démarrer, pour éviter de retomber mot pour mot sur le
      // même exercice à chaque répétition.
      // (Les exercices, eux, sont remplacés par des exercices inédits : inutile de les reformuler.)
      var repeats = picked.filter(function (it) { return it.kind === "open" && prep.itemUseCount[it.id]; });
      picked.forEach(function (it) { (it.parts || [it.id]).forEach(function (pid) { prep.itemUseCount[pid] = (prep.itemUseCount[pid] || 0) + 1; }); });
      saveDB();
      if (!repeats.length || !getApiKey()) { finalizeLaunch(picked); return; }
      epStartingSessionFor = prepId + "::" + date;
      render();
      // Timeout dédié : si Gemini traîne ou que la requête reste bloquée, on ne doit JAMAIS laisser
      // l'élève planté indéfiniment sur le sablier — au pire on démarre avec les énoncés d'origine.
      var settled = false;
      var timeoutId = setTimeout(function () {
        if (settled) return;
        settled = true;
        finalizeLaunch(picked);
      }, 25000);
      generateExamPrepVariants(repeats).then(function (data) {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        var byId = {};
        (data.variants || []).forEach(function (v) { byId[v.id] = v; });
        var finalPool = picked.map(function (it) {
          var v = byId[it.id];
          if (!v || !v.prompt) return it;
          var updated = { id: it.id, kind: it.kind, prompt: v.prompt, courseId: it.courseId, courseTitle: it.courseTitle, choices: it.choices, correctIndex: it.correctIndex, explanation: it.explanation, answer: it.answer, solution: it.solution, figureSvg: it.figureSvg || "" };
          if (it.kind === "exercise" && v.solution) updated.solution = v.solution;
          if (it.kind === "open" && v.answer) updated.answer = v.answer;
          // Si l'énoncé d'origine avait un support visuel, il doit rester cohérent avec les nouvelles
          // valeurs/le nouveau contexte : on ne garde jamais l'ancien SVG tel quel dans ce cas.
          if (it.figureSvg) updated.figureSvg = v.figureSvg || "";
          return updated;
        });
        finalizeLaunch(finalPool);
      }).catch(function () {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        // Pas grave si la variation échoue : on démarre quand même avec les énoncés d'origine plutôt que de bloquer l'élève.
        finalizeLaunch(picked);
      });
    },
    examPrepAnswerQcm: function (i) {
      var s = epSession;
      if (!s || s.revealed) return;
      var item = s.pool[s.idx];
      s.answer = i;
      s.revealed = true;
      var wasCorrect = i === item.correctIndex;
      s.score = wasCorrect ? 1 : 0; s.scoreMax = 1;
      epFinishSessionAnswer(s, item, item.choices[i], item.choices[item.correctIndex], wasCorrect ? "correct" : "wrong", []);
      render();
      dinoReact(wasCorrect);
    },
    examPrepSubmitOpenAnswer: function () {
      var s = epSession;
      if (!s) return;
      var item = s.pool[s.idx];
      if (!getApiKey()) { toast("Ajoute d'abord ta clé API dans les paramètres"); App.openApiKeyModal(); return; }
      s.answerHtml = rteValue("ep-open-answer");
      var answerText = rteText("ep-open-answer");
      s.answer = answerText;
      s.status = "grading";
      render();
      var referenceAnswer = item.kind === "exercise" ? item.solution : item.answer;
      gradeExerciseAnswer(item.prompt, referenceAnswer, answerText).then(function (result) {
        s.status = "graded";
        s.revealed = true;
        s.aiFeedback = result.feedback || "";
        var level = normalizeGradeLevel(result);
        s.mistakes = result.mistakes || [];
        s.score = result.score; s.scoreMax = result.scoreMax;
        epFinishSessionAnswer(s, item, answerText, referenceAnswer, level, s.mistakes);
        render();
        dinoReact(gradeLevelIsSuccess(level));
      }).catch(function (err) {
        s.status = "answering";
        toast("Échec de la correction : " + (err.message || "erreur inconnue"), { status: err.status, detail: err.detail });
        render();
      });
    },
    examPrepSubmitMethodoAnswer: function () {
      var s = epSession;
      if (!s) return;
      var item = s.pool[s.idx];
      if (!item || item.kind !== "methodo") return;
      if (!getApiKey()) { toast("Ajoute d'abord ta clé API dans les paramètres"); App.openApiKeyModal(); return; }
      var methodo = methodoFind(item.methodologyId);
      if (!methodo) return;
      var answerHtml = rteValue("ep-methodo-answer");
      var answerText = rteText("ep-methodo-answer");
      if (!answerText.trim()) { toast("Écris une réponse avant de valider"); return; }
      item.status = "grading";
      render();
      gradeMethodologyAnswer(methodo, item, answerText).then(function (g) {
        item.answerHtml = answerHtml;
        item.answerText = answerText;
        item.status = "graded";
        item.grade20 = typeof g.grade20 === "number" ? Math.max(0, Math.min(20, g.grade20)) : 0;
        item.verdict = g.verdict || "";
        item.strengths = g.strengths || [];
        item.weaknesses = g.weaknesses || [];
        item.detailedFeedback = g.detailedFeedback || "";
        // Contribue au baromètre/points/flashcards de lacunes comme n'importe quel autre item de la
        // séance, en convertissant la note sur 20 vers le barème commun à 4 niveaux (GRADE_LEVELS) —
        // un sujet de méthodologie compte donc réellement dans la préparation, pas juste à côté.
        var level = gradeLevelFromGrade20(item.grade20);
        epFinishSessionAnswer(s, item, answerText, item.referencePlan || "", level, item.weaknesses || []);
        render();
        dinoReact(gradeLevelIsSuccess(level));
      }).catch(function (err) {
        item.status = "unanswered";
        toast("Échec de la correction : " + (err.message || "erreur inconnue"), { status: err.status, detail: err.detail });
        render();
      });
    },
    examPrepNext: function () {
      var s = epSession;
      if (!s) return;
      if (s.idx === s.pool.length - 1) { App.examPrepFinish(); return; }
      s.idx++; s.answer = null; s.answerHtml = ""; s.status = "answering"; s.aiFeedback = ""; s.revealed = false; s.wasCorrect = null; s.level = null; s.mistakes = null; s.score = null; s.scoreMax = null;
      epSaveActiveSession(s);
      render();
    },
    examPrepFinish: function () {
      var s = epSession;
      if (!s) return;
      var prep = epFind(s.prepId);
      if (prep) epEnsureTopics(prep);
      s.durationMs = Date.now() - s.startedAt;
      s.status = "reviewing";
      render();
      // Flashcards de lacunes dès la moindre imperfection (level !== "correct"), pas seulement à partir
      // de 2 erreurs : même une seule petite erreur isolée ("minor") mérite sa carte de révision.
      var wrongIdx = [];
      s.history.forEach(function (h, i) { var level = h.level || (h.wasCorrect ? "correct" : "wrong"); if (level !== "correct") wrongIdx.push(i); });
      if (!getApiKey() || !prep) { epFinalizeSession(prep, s, null, null, wrongIdx); return; }
      Promise.all([
        (prep.topics && prep.topics.length) ? generateExamTopicMap(prep.topics, s.history).then(function (r) { return r.mapping || []; }).catch(function () { return []; }) : Promise.resolve([]),
        wrongIdx.length ? generateGapFlashcards(wrongIdx.map(function (i) { return s.history[i]; })).then(function (r) { return r.flashcards || []; }).catch(function () { return null; }) : Promise.resolve(null)
      ]).then(function (results) {
        epFinalizeSession(prep, s, results[0], results[1], wrongIdx);
      });
    },
    examPrepExitSession: function () { epSession = null; render(); },
    resumeExamPrepSession: function (prepId) {
      var prep = epFind(prepId);
      if (!prep || !prep.activeSession) return;
      epSession = prep.activeSession;
      render();
    },

    createImportedExercise: function (e) {
      e.preventDefault();
      if (!modal.imagePreviews.length) { toast("Ajoute au moins une photo de ton exercice"); return; }
      if (!getApiKey()) { toast("Ajoute d'abord ta clé API dans les paramètres"); App.openApiKeyModal(); return; }
      var title = e.target.title.value.trim() || ("Exercice du " + new Date().toLocaleDateString("fr-FR"));
      var entry = {
        id: uid(), title: title, images: modal.imagePreviews.slice(), status: "processing", error: null,
        subjectGuess: "", exercises: [],
        createdAt: Date.now()
      };
      userData().importedExercises.push(entry);
      saveDB();
      modal = null;
      navigate("#/exercices/" + entry.id);
      runImportedExerciseGeneration(entry);
    },
    retryImportedExerciseGeneration: function (exId) {
      var entry = userData().importedExercises.find(function (x) { return x.id === exId; });
      if (!entry) return;
      runImportedExerciseGeneration(entry);
    },
    openImportedExerciseErrorDetail: function (exId) {
      var entry = userData().importedExercises.find(function (x) { return x.id === exId; });
      if (!entry) return;
      modal = { type: "errorDetail", status: entry.errorStatus, detail: entry.errorDetail };
      render();
    },
    showErrorDetailRaw: function (tid) {
      var d = toastErrorDetails[tid];
      if (!d) return;
      modal = { type: "errorDetail", status: d.status, detail: d.detail };
      render();
    },
    submitImportedExerciseAnswer: function (exId, idx) {
      var entry = userData().importedExercises.find(function (x) { return x.id === exId; });
      if (!entry) return;
      var ex = entry.exercises[idx];
      if (!ex) return;
      ex.answerHtml = rteValue("ie-answer-" + idx);
      var answerText = rteText("ie-answer-" + idx);
      if (!answerText) { toast("Écris une réponse avant de valider"); return; }
      if (!getApiKey()) { toast("Ajoute d'abord ta clé API dans les paramètres"); App.openApiKeyModal(); return; }
      ex.answerText = answerText;
      ex.answerStatus = "grading";
      saveDB(); render();
      gradeExerciseAnswer(ex.statement, ex.solution, answerText).then(function (result) {
        ex.answerStatus = "graded";
        var level = normalizeGradeLevel(result);
        ex.level = level;
        ex.correct = gradeLevelIsSuccess(level);
        ex.mistakes = result.mistakes || [];
        ex.feedback = result.feedback || "";
        ex.score = result.score; ex.scoreMax = result.scoreMax;
        saveDB();
        render();
        dinoReact(ex.correct);
      }).catch(function (err) {
        ex.answerStatus = "unanswered";
        toast("Échec de la correction : " + (err.message || "erreur inconnue"), { status: err.status, detail: err.detail });
        render();
      });
    },
    retryImportedExerciseAnswer: function (exId, idx) {
      var entry = userData().importedExercises.find(function (x) { return x.id === exId; });
      if (!entry) return;
      var ex = entry.exercises[idx];
      if (!ex) return;
      ex.answerStatus = "unanswered";
      ex.answerHtml = ""; ex.answerText = ""; ex.correct = null; ex.level = null; ex.mistakes = null; ex.feedback = "";
      saveDB();
      render();
    },
    downloadImportedExercisePdf: function (exId) {
      var entry = userData().importedExercises.find(function (x) { return x.id === exId; });
      if (!entry || !entry.exercises.length || !entry.exercises.every(function (ex) { return ex.answerStatus === "graded"; })) return;
      var html = entry.exercises.map(function (ex, i) {
        return buildExercisePrintHtml(entry.title + (entry.exercises.length > 1 ? " — Exercice " + (i + 1) : ""), entry.subjectGuess, mdToHtml(ex.statement, entry.figures), ex.answerHtml, ex.level || (ex.correct ? "correct" : "wrong"), ex.feedback, mdToHtml(splitInlineNumberedQuestions(ex.solution)), ex.mistakes);
      }).join("");
      printAndDownload(html, entry.title);
    },
    openApiKeyModal: function () { modal = { type: "apiKey" }; render(); },
    calSelect: function (ds) { calEnsureView().date = ds; render(); },
    calSetMode: function (mode, ds) {
      var v = calEnsureView();
      v.mode = mode;
      if (ds) v.date = ds;
      try { localStorage.setItem("studino-cal-mode", mode); } catch (e) {}
      render();
    },
    calMove: function (delta) {
      var v = calEnsureView();
      if (v.mode === "month") { var d = calParse(v.date); v.date = calDateStr(new Date(d.getFullYear(), d.getMonth() + delta, 1)); }
      else v.date = calAddDays(v.date, delta * (v.mode === "week" ? 7 : 1));
      render();
    },
    calToday: function () { calEnsureView().date = calDateStr(new Date()); render(); },
    calNewEvent: function (ds, startMin) {
      var v = calEnsureView();
      var date = ds || v.date;
      var s = typeof startMin === "number" ? startMin : 18 * 60;
      modal = { type: "calEvent", editId: null, ev: { title: "", startDate: date, endDate: date, startTime: calFromMin(s), endTime: calFromMin(Math.min(s + 60, 23 * 60 + 59)), allDay: false, repeat: "none", location: "", notify: null, notifyValue: 30, notifyUnit: "min", color: CAL_COLORS[1], busy: true, description: "" } };
      render();
    },
    // Clic sur un créneau vide (vue Semaine / Jour) : nouvel événement à cette heure (arrondie à la demi-heure).
    calSlotClick: function (e, ds) {
      var col = e.currentTarget;
      if (!col || e.target !== col) return;
      var y = e.clientY - col.getBoundingClientRect().top;
      var min = CAL_HOUR_START * 60 + Math.floor((y / CAL_HOUR_PX) * 2) * 30;
      App.calNewEvent(ds, Math.max(0, Math.min(23 * 60, min)));
    },
    calEditEvent: function (id) {
      var ev = calEvents().find(function (x) { return x.id === id; });
      if (!ev) return;
      modal = { type: "calEvent", editId: id, ev: JSON.parse(JSON.stringify(ev)) };
      render();
    },
    calEvField: function (field, value, silent) {
      if (!modal || modal.type !== "calEvent") return;
      var e = modal.ev;
      var desc = document.getElementById("cal-ev-desc");
      if (desc) e.description = rteValue("cal-ev-desc");
      if (field === "notify") {
        if (value === null) e.notify = null;
        else {
          e.notify = true;
          e.notifyValue = e.notifyValue || 30;
          try { if (window.Notification && Notification.permission === "default") Notification.requestPermission(); } catch (er) {}
        }
      } else if (field === "startDate") {
        var span = Math.max(0, Math.round((calParse(e.endDate) - calParse(e.startDate)) / 86400000));
        e.startDate = value;
        e.endDate = calAddDays(value, span);
      } else if (field === "startTime") {
        var dur = calToMin(e.endTime) - calToMin(e.startTime);
        e.startTime = value;
        if (e.startDate === e.endDate) e.endTime = calFromMin(Math.min(23 * 60 + 59, calToMin(value) + Math.max(15, dur)));
      } else if (field === "endDate") {
        e.endDate = value < e.startDate ? e.startDate : value;
      } else {
        e[field] = value;
      }
      // Champs de fin recalculés : on met juste à jour leur valeur affichée, sans toucher au champ en cours de saisie.
      var setVal = function (id, val) { var el = document.getElementById(id); if (el && el !== document.activeElement && el.value !== val) el.value = val; };
      if (field === "startDate") setVal("cal-ev-ed", e.endDate);
      if (field === "startTime") setVal("cal-ev-et", e.endTime);
      if (field === "endDate") setVal("cal-ev-ed", e.endDate);
      if (!silent) renderModal();
    },
    calSaveEvent: function () {
      if (!modal || modal.type !== "calEvent") return;
      var e = modal.ev;
      if (document.getElementById("cal-ev-desc")) e.description = rteValue("cal-ev-desc");
      e.title = String(e.title || "").trim();
      if (!e.title) { toast("Donne un titre à l'événement"); return; }
      if (e.endDate < e.startDate) e.endDate = e.startDate;
      if (!e.allDay && e.startDate === e.endDate && calToMin(e.endTime) <= calToMin(e.startTime)) e.endTime = calFromMin(Math.min(23 * 60 + 59, calToMin(e.startTime) + 60));
      var list = calEvents();
      if (modal.editId) {
        var idx = list.findIndex(function (x) { return x.id === modal.editId; });
        if (idx !== -1) { e.id = modal.editId; list[idx] = e; }
      } else {
        e.id = uid();
        list.push(e);
      }
      saveDB();
      modal = null;
      toast("📅 Événement enregistré" + (e.busy !== false ? " · les révisions se replacent autour" : ""));
      render();
    },
    calDeleteEvent: function () {
      if (!modal || !modal.editId) return;
      var d = userData();
      d.calendarEvents = calEvents().filter(function (x) { return x.id !== modal.editId; });
      saveDB();
      modal = null;
      toast("Événement supprimé");
      render();
    },
    calOpenSettings: function () { modal = { type: "calSettings" }; render(); },
    calSaveSettings: function () {
      var a = document.getElementById("cal-st-start"), b = document.getElementById("cal-st-end");
      var s = a && a.value, en = b && b.value;
      if (!s || !en || calToMin(en) <= calToMin(s)) { toast("L'heure de fin doit être après l'heure de début"); return; }
      var st = calSettings();
      st.studyStart = s; st.studyEnd = en;
      saveDB();
      modal = null;
      render();
    },
    openSettingsModal: function () { modal = { type: "settings" }; refreshStorageEstimate(); render(); },
    setVolumeMusic: function (v) { localStorage.setItem(VOLUME_MUSIC_STORAGE, String(v)); },
    setVolumeSfx: function (v) { localStorage.setItem(VOLUME_SFX_STORAGE, String(v)); },
    previewSfxVolume: function () { dpPlayMerchantSound("welcome"); },
    saveApiKey: function (e) {
      e.preventDefault();
      var key = e.target.apiKey.value.trim();
      setApiKey(key);
      modal = null;
      toast(key ? "Clé API enregistrée" : "Clé API effacée");
      render();
    },
    openBackupApiKeyModal: function () { modal = { type: "backupApiKeyGuide" }; render(); },
    saveBackupApiKey: function (e) {
      e.preventDefault();
      var key = e.target.apiKey.value.trim();
      setBackupApiKey(key);
      modal = null;
      toast(key ? "Clé API de secours enregistrée" : "Clé API de secours effacée");
      render();
    },

    // Toutes les données de l'appli vivent dans IndexedDB, propre à chaque adresse (domaine/protocole)
    // — passer d'un test en local au site en ligne, ou changer de navigateur/appareil, ne transfère
    // donc rien automatiquement. Ce fichier de sauvegarde (le DB entier : comptes + données) permet de
    // le faire manuellement.
    exportBackup: function () {
      toast("Préparation de la sauvegarde…");
      exportCopyWithFigures(JSON.parse(JSON.stringify(dbWithoutPodcastAudio()))).then(function (copy) {
      var json = JSON.stringify(copy, null, 2);
      var blob = new Blob([json], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "studino-sauvegarde-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      try { localStorage.setItem(LAST_EXPORT_KEY, String(Date.now())); } catch (e) {}
      toast("Sauvegarde téléchargée");
      });
    },
    importBackupFile: function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var parsed;
        try { parsed = JSON.parse(reader.result); } catch (err) { toast("Fichier invalide — ce n'est pas une sauvegarde Studino."); return; }
        if (!parsed || typeof parsed !== "object" || typeof parsed.users !== "object" || typeof parsed.data !== "object") {
          toast("Fichier invalide — ce n'est pas une sauvegarde Studino.");
          return;
        }
        // Remplacer DB tout de suite écraserait les données actuelles sans confirmation si l'import
        // échoue ou si l'élève s'est trompé de fichier : on passe par une confirmation explicite,
        // comme pour toute autre suppression/écrasement dans l'appli.
        modal = { type: "confirmImportBackup", data: parsed, userCount: Object.keys(parsed.users).length };
        render();
      };
      reader.onerror = function () { toast("Impossible de lire ce fichier."); };
      reader.readAsText(file);
    },
    executeImportBackup: function () {
      var data = modal.data;
      DB = data;
      if (!DB.currentUser || !DB.users[DB.currentUser]) DB.currentUser = null;
      modal = null;
      saveDB();
      hydratePodcastAudio().then(hydrateFigureImages).then(function () { render(); });
      toast("Sauvegarde importée !");
      navigate("#/");
    },
    executeMergeBackup: function () {
      var imported = modal.data;
      // currentUser reste celui déjà connecté sur CET appareil (jamais celui du fichier importé) —
      // fusionner ne doit pas déconnecter quelqu'un déjà en session ici pour le rebasculer ailleurs.
      DB = mergeDB(DB, imported);
      modal = null;
      saveDB();
      hydratePodcastAudio().then(hydrateFigureImages).then(function () { render(); });
      toast("Sauvegardes fusionnées !");
      navigate("#/");
    },

    askDelete: function (kind, subjectId, themeId, chapterId, courseId) {
      modal = { type: "confirmDelete", kind: kind, subjectId: subjectId, themeId: themeId, chapterId: chapterId, courseId: courseId };
      render();
    },
    openRenameModal: function (kind, subjectId, themeId, chapterId, courseId) {
      var item = null;
      if (kind === "subject") item = findSubject(subjectId);
      else if (kind === "theme") item = findTheme(findSubject(subjectId), themeId);
      else if (kind === "chapter") item = findChapter(findTheme(findSubject(subjectId), themeId), chapterId);
      else if (kind === "course") item = findCourse(findChapter(findTheme(findSubject(subjectId), themeId), chapterId), courseId);
      else if (kind === "podcast") item = podcastFind(courseId);
      else if (kind === "podcastGroup") {
        var gp = podcastGroupParts(courseId);
        item = gp.length ? { title: podcastGroupDisplayName(gp) } : null;
      }
      if (!item) return;
      var usesTitle = kind === "course" || kind === "podcast" || kind === "podcastGroup";
      modal = { type: "renameItem", kind: kind, subjectId: subjectId, themeId: themeId, chapterId: chapterId, courseId: courseId, currentName: usesTitle ? item.title : item.name };
      render();
    },
    duplicateTheme: function (subjectId, themeId) {
      var s = findSubject(subjectId);
      var t = findTheme(s, themeId);
      if (!s || !t) return;
      var clone = cloneThemeWithNewIds(t);
      clone.name = t.name + " (copie)";
      var idx = s.themes.indexOf(t);
      s.themes.splice(idx + 1, 0, clone);
      saveDB();
      toast("Thème dupliqué");
      render();
    },
    duplicateChapter: function (subjectId, themeId, chapterId) {
      var s = findSubject(subjectId);
      var t = findTheme(s, themeId);
      var c = findChapter(t, chapterId);
      if (!s || !t || !c) return;
      var clone = cloneChapterWithNewIds(c);
      clone.name = c.name + " (copie)";
      var idx = t.chapters.indexOf(c);
      t.chapters.splice(idx + 1, 0, clone);
      saveDB();
      toast("Chapitre dupliqué");
      render();
    },
    confirmRename: function (e) {
      e.preventDefault();
      var name = e.target.name.value.trim();
      if (!name) return;
      var m = modal;
      if (m.kind === "podcast" || m.kind === "podcastGroup") {
        if (m.kind === "podcast") {
          var rp = podcastFind(m.courseId);
          if (!rp) { App.closeModal(); return; }
          rp.title = name;
          if ((rp.partCount || 1) <= 1) rp.groupName = name; // podcast en une seule partie : son nom EST le nom du podcast
        } else {
          podcastGroupParts(m.courseId).forEach(function (p) { p.groupName = name; });
        }
        saveDB();
        modal = null;
        toast("Nom modifié");
        render();
        return;
      }
      var item = null;
      if (m.kind === "subject") item = findSubject(m.subjectId);
      else if (m.kind === "theme") item = findTheme(findSubject(m.subjectId), m.themeId);
      else if (m.kind === "chapter") item = findChapter(findTheme(findSubject(m.subjectId), m.themeId), m.chapterId);
      else if (m.kind === "course") item = findCourse(findChapter(findTheme(findSubject(m.subjectId), m.themeId), m.chapterId), m.courseId);
      if (!item) { App.closeModal(); return; }
      if (m.kind === "course") item.title = name; else item.name = name;
      saveDB();
      modal = null;
      toast("Nom modifié");
      render();
    },
    executeDelete: function () {
      var m = modal;
      if (m.kind === "subject") {
        var d = userData();
        d.subjects = d.subjects.filter(function (s) { return s.id !== m.subjectId; });
        toast("Matière supprimée");
      } else if (m.kind === "theme") {
        var st = findSubject(m.subjectId);
        st.themes = st.themes.filter(function (t) { return t.id !== m.themeId; });
        toast("Thème supprimé");
      } else if (m.kind === "chapter") {
        var s = findSubject(m.subjectId);
        var th = findTheme(s, m.themeId);
        th.chapters = th.chapters.filter(function (c) { return c.id !== m.chapterId; });
        toast("Chapitre supprimé");
      } else if (m.kind === "course") {
        var s2 = findSubject(m.subjectId);
        var th2 = findTheme(s2, m.themeId);
        var c2 = findChapter(th2, m.chapterId);
        c2.courses = c2.courses.filter(function (co) { return co.id !== m.courseId; });
        toast("Cours supprimé");
      } else if (m.kind === "importedExercise") {
        var d2 = userData();
        d2.importedExercises = d2.importedExercises.filter(function (x) { return x.id !== m.courseId; });
        toast("Exercice supprimé");
      } else if (m.kind === "revisionSheet") {
        var d3 = userData();
        d3.revisionSheets = d3.revisionSheets.filter(function (x) { return x.id !== m.courseId; });
        toast("Fiche supprimée");
      } else if (m.kind === "examPrep") {
        var d4 = userData();
        d4.examPreps = d4.examPreps.filter(function (x) { return x.id !== m.courseId; });
        if (epSession && epSession.prepId === m.courseId) epSession = null;
        toast("Prépa supprimée");
      } else if (m.kind === "methodology") {
        var d5 = userData();
        d5.methodologies = d5.methodologies.filter(function (x) { return x.id !== m.courseId; });
        toast("Méthodologie supprimée");
      } else if (m.kind === "podcast") {
        var d6 = userData();
        d6.podcasts = d6.podcasts.filter(function (x) { return x.id !== m.courseId; });
        setTimeout(gcPodcastAudio, 0);
        toast("Podcast supprimé");
      } else if (m.kind === "podcastGroup") {
        var d7 = userData();
        d7.podcasts = d7.podcasts.filter(function (x) { return x.groupId !== m.courseId; });
        setTimeout(gcPodcastAudio, 0);
        toast("Podcast supprimé");
      }
      saveDB();
      modal = null;
      render();
    },

    dtGoDinoTime: function () { dtState.mode = "setup"; navigate("#/dinotime"); render(); },
    dtSetTab: function (tab) { dtState.tab = tab; render(); },
    dtSetDuration: function (min) {
      min = parseInt(min, 10);
      if (!min || min < 1) return;
      dtState.durationMin = Math.min(240, min);
      render();
    },
    dtSelectEnclosure: function (encId) { dtState.enclosureId = encId; render(); },
    dtSetPomoField: function (field, val) {
      var caps = { pomoWork: 180, pomoBreak: 60, pomoCycles: 12 };
      var n = Math.max(1, Math.min(caps[field] || 999, parseInt(val, 10) || 1));
      dtState[field] = n;
      render();
    },
    dtSetPomoDino: function (dinoId) { dtState.pomoDinoId = (dtState.pomoDinoId === dinoId ? null : dinoId); render(); },
    dtStart: function () {
      var enc = dtAllEnclosures().find(function (e) { return e.id === dtState.enclosureId; });
      if (!enc) { toast("Choisis un enclos"); return; }
      var dinos = dtEnclosureDinos(enc.id).map(dtInitDinoState);
      var durSec = dtState.durationMin * 60;
      dtPomoRunning = null;
      dtRunning = { enclosureId: enc.id, remainingSec: durSec, endsAt: Date.now() + durSec * 1000, dinos: dinos, paused: false };
      dtState.mode = "running";
      render();
    },
    dtStartPomodoro: function () {
      var workSec = dtState.pomoWork * 60;
      dtRunning = null;
      dtPomoRunning = {
        dinoId: dtState.pomoDinoId,
        workMin: dtState.pomoWork, breakMin: dtState.pomoBreak, cycles: dtState.pomoCycles,
        phase: "work", cycleIndex: 1,
        remainingSec: workSec, endsAt: Date.now() + workSec * 1000, paused: false
      };
      dtState.mode = "running";
      render();
    },
    dtTogglePausePomo: function () {
      if (!dtPomoRunning) return;
      dtPomoRunning.paused = !dtPomoRunning.paused;
      if (dtPomoRunning.paused) {
        dtPomoRunning.remainingSec = Math.max(0, Math.round((dtPomoRunning.endsAt - Date.now()) / 1000));
      } else {
        dtPomoRunning.endsAt = Date.now() + dtPomoRunning.remainingSec * 1000;
      }
      var btn = document.getElementById("dt-pause-btn");
      if (btn) btn.textContent = dtPomoRunning.paused ? "▶" : "⏸";
      var scene = document.querySelector(".dt-scene");
      if (scene) scene.classList.toggle("paused", dtPomoRunning.paused);
    },
    dtStopPomodoro: function () {
      dtStopTimerInterval();
      dtPomoRunning = null;
      dtState.mode = "setup";
      render();
    },
    dtPomoPhaseComplete: function () {
      var p = dtPomoRunning;
      if (!p) return;
      if (p.phase === "work") {
        p.phase = "break";
      } else {
        p.cycleIndex = p.cycleIndex >= p.cycles ? 1 : p.cycleIndex + 1;
        p.phase = "work";
      }
      var durMin = p.phase === "work" ? p.workMin : p.breakMin;
      p.remainingSec = durMin * 60;
      p.endsAt = Date.now() + p.remainingSec * 1000;
      toast(DT_POMO_PHASE_LABEL[p.phase] + " !");
      render();
    },
    dtTogglePause: function () {
      if (!dtRunning) return;
      dtRunning.paused = !dtRunning.paused;
      if (dtRunning.paused) {
        dtRunning.remainingSec = Math.max(0, Math.round((dtRunning.endsAt - Date.now()) / 1000));
      } else {
        dtRunning.endsAt = Date.now() + dtRunning.remainingSec * 1000;
      }
      var btn = document.getElementById("dt-pause-btn");
      if (btn) btn.textContent = dtRunning.paused ? "▶" : "⏸";
      var scene = document.querySelector(".dt-scene");
      if (scene) scene.classList.toggle("paused", dtRunning.paused);
    },
    dtStop: function () {
      dtStopTimerInterval();
      dtStopWalkLoop();
      dtRunning = null;
      dtState.mode = "setup";
      render();
    },
    dtComplete: function () {
      dtStopTimerInterval();
      dtStopWalkLoop();
      dtRunning = null;
      dtState.mode = "setup";
      dpPlayMerchantSound("thankyou");
      toast("🎉 Séance terminée !");
      render();
    },
    dpGoHub: function () { dpView = { mode: "hub" }; navigate("#/dinopark"); render(); },
    dpGoZone: function (zoneId) { dpView = { mode: "zone", zoneId: zoneId }; render(); },
    dpGoLab: function () { dpView = { mode: "lab" }; render(); },
    dpGoEncyclopedia: function () { dpView = { mode: "encyclopedia" }; render(); },
    dpGoQuiz: function () { dpView = { mode: "quiz", quizNav: { level: "subjects" } }; render(); },
    dpQuizGoSubjects: function () { dpView.quizNav = { level: "subjects" }; render(); },
    dpQuizGoSubject: function (subjectId) { dpView.quizNav = { level: "themes", subjectId: subjectId }; render(); },
    dpQuizGoThemes: function (subjectId) { dpView.quizNav = { level: "themes", subjectId: subjectId }; render(); },
    dpQuizGoTheme: function (themeId) { dpView.quizNav.level = "chapters"; dpView.quizNav.themeId = themeId; render(); },
    dpQuizGoChapters: function (subjectId, themeId) { dpView.quizNav = { level: "chapters", subjectId: subjectId, themeId: themeId }; render(); },
    dpQuizGoChapter: function (chapterId) { dpView.quizNav.level = "courses"; dpView.quizNav.chapterId = chapterId; render(); },
    dpUnlockZone: function (zoneId) {
      var dp = dpData(); var z = dpZone(zoneId);
      if (!dpZoneFullyStocked(zoneId)) { toast("Cette zone n'est pas encore disponible"); return; }
      if (dp.points < z.cost) { toast("Pas assez de points"); return; }
      dp.points -= z.cost; dp.unlockedZones.push(zoneId);
      saveDB(); toast("Zone " + z.name + " débloquée !"); render();
    },
    dpBuyEgg: function (zoneId, speciesId) {
      var dp = dpData(); var sp = dpSpecies(speciesId); var rarity = DP_RARITY[sp.rarity];
      if (!dpEnclosuresInZone(zoneId).length) { toast("Construis d'abord un enclos dans cette zone"); return; }
      if (dp.points < rarity.price) { dpPlayMerchantSound("noCash"); toast("Pas assez de points"); return; }
      dp.points -= rarity.price; dp.eggs.push({ id: uid(), speciesId: speciesId });
      saveDB(); dpPlayMerchantSound("thankyou"); toast("Œuf de " + sp.name + " acheté"); render();
    },
    dpBuildEnclosure: function (zoneId) {
      var dp = dpData(); var cost = dpZoneEnclosureCost(zoneId);
      if (dp.points < cost) { dpPlayMerchantSound("noCash"); toast("Pas assez de points"); return; }
      var count = dpEnclosuresInZone(zoneId).length;
      dp.points -= cost;
      dp.enclosures.push({ id: uid(), zone: zoneId, name: "Enclos " + (count + 1), capacity: 2, level: 1, variant: dpRandomEnclosureVariant(zoneId) });
      saveDB(); dpPlayMerchantSound("thankyou"); toast("Nouvel enclos construit"); render();
    },
    dpUpgradeEnclosure: function (encId) {
      var dp = dpData(); var enc = dp.enclosures.find(function (e) { return e.id === encId; });
      var cost = DP_ENCLOSURE_UPGRADE_COST[enc.level];
      if (cost == null) { toast("Enclos déjà au niveau maximum"); return; }
      if (dp.points < cost) { toast("Pas assez de points"); return; }
      dp.points -= cost; enc.level += 1; enc.variant = dpRandomEnclosureVariant(enc.zone);
      saveDB(); toast("Enclos amélioré au niveau " + enc.level); render();
    },
    dpOpenMerchant: function (zoneId) { dpMerchantZone = zoneId; dpMerchantMode = "eggs"; dpSellMode = false; dpSellSelectedDinoId = null; dpPlayMerchantSound("welcome"); render(); },
    dpOpenObjectMerchant: function (zoneId) { dpMerchantZone = zoneId; dpMerchantMode = "objects"; dpSellMode = false; dpSellSelectedDinoId = null; dpPlayMerchantSound("welcome"); render(); },
    dpCloseMerchant: function () { dpMerchantZone = null; dpSellMode = false; dpSellSelectedDinoId = null; render(); },
    dpStartSellDino: function () {
      dpSellMode = true; dpSellSelectedDinoId = null;
      dpPlayMerchantSound("whatAreYouSelling");
      render();
    },
    dpCancelSellDino: function () {
      dpSellMode = false; dpSellSelectedDinoId = null;
      render();
    },
    dpSelectSellDino: function (dinoId) {
      dpSellSelectedDinoId = dinoId;
      dpPlayMerchantSound("interesting");
      render();
    },
    dpConfirmSellDino: function () {
      var dp = dpData();
      var idx = dp.dinosaurs.findIndex(function (d) { return d.id === dpSellSelectedDinoId; });
      if (idx === -1) return;
      var d = dp.dinosaurs[idx];
      var sp = dpSpecies(d.speciesId);
      var sellPrice = Math.round(DP_RARITY[sp.rarity].price / 2);
      dp.dinosaurs.splice(idx, 1);
      dp.points += sellPrice;
      dpSellSelectedDinoId = null;
      saveDB();
      dpPlayMerchantSound("thankyou");
      toast(d.name + " vendu · +" + sellPrice + " pts");
      render();
    },
    dpRefreshShop: function (zoneId) {
      var dp = dpData();
      if (dp.points < DP_SHOP_REFRESH_COST) { toast("Pas assez de points"); return; }
      dp.points -= DP_SHOP_REFRESH_COST;
      dp.shops[zoneId] = { items: dpGenerateShopItems(zoneId, 0), luck: 0, expiresAt: Date.now() + DP_SHOP_DURATION };
      saveDB(); toast("Le vendeur a été rafraîchi (chance remise à " + dpLuckPercent(0) + " %)"); render();
    },
    // Un œuf de plus chez le vendeur de CE biome (2 → 3 → 4 → 5). Le nouvel œuf apparaît tout de suite,
    // tiré avec la chance actuelle de la boutique.
    dpUpgradeShopSlots: function (zoneId) {
      var dp = dpData();
      var cur = dpShopSlots(zoneId);
      if (cur >= DP_SHOP_SLOTS_MAX) { toast("Le vendeur propose déjà le maximum d'œufs"); return; }
      var cost = DP_SHOP_SLOT_UPGRADE_COST[cur + 1];
      if (dp.points < cost) { dpPlayMerchantSound("noCash"); toast("Pas assez de points"); return; }
      dp.points -= cost;
      dp.shopSlots = dp.shopSlots || {};
      dp.shopSlots[zoneId] = cur + 1;
      var shop = dpShop(zoneId);
      shop.items = shop.items.concat(dpGenerateShopItems(zoneId, dpLuckLevel(shop), 1));
      saveDB(); dpPlayMerchantSound("thankyou"); toast("🥚 Le vendeur propose maintenant " + (cur + 1) + " œufs dans ce biome"); render();
    },
    // Chaque Chance+ monte d'un niveau (jusqu'au max) et refait la boutique avec les nouvelles chances.
    // Le niveau dure tant que cette boutique est là : il retombe à 0 quand elle expire ou avec « Rafraîchir ».
    dpLuckShop: function (zoneId) {
      var dp = dpData();
      var level = dpLuckLevel(dpShop(zoneId));
      if (level >= DP_LUCK_MAX) { toast("Chance déjà au maximum pour cette boutique"); return; }
      if (dp.points < DP_SHOP_LUCK_COST) { dpPlayMerchantSound("noCash"); toast("Pas assez de points"); return; }
      dp.points -= DP_SHOP_LUCK_COST;
      level++;
      dp.shops[zoneId] = { items: dpGenerateShopItems(zoneId, level), luck: level, expiresAt: Date.now() + DP_SHOP_DURATION };
      saveDB(); toast("🍀 Chance " + dpLuckPercent(level) + " % · légendaire " + DP_LUCK_ODDS[level].legendaire + " % par case"); render();
    },
    dpStartIncubation: function (slot, eggIndex) {
      if (eggIndex === "") return;
      var dp = dpData(); var egg = dp.eggs[eggIndex];
      dp.eggs.splice(eggIndex, 1);
      dp.incubators[slot] = { speciesId: egg.speciesId, startedAt: Date.now() };
      saveDB(); render();
    },
    dpCollectHatched: function (slot) {
      var dp = dpData(); var inc = dp.incubators[slot]; var sp = dpSpecies(inc.speciesId);
      var dino = { id: uid(), speciesId: sp.id, name: sp.name, sex: Math.random() < 0.5 ? "M" : "F", bornAt: Date.now(), lastFedAt: dp.virtualNow, health: 100, enclosureId: null };
      dp.dinosaurs.push(dino);
      dp.discovered[sp.id] = true;
      dp.incubators[slot] = null;
      saveDB(); toast(sp.name + " a éclos !"); render();
    },
    dpSelectDino: function (dinoId) { modal = { type: "dinoFiche", dinoId: dinoId }; render(); },
    dpPlaceDino: function (dinoId, encId) {
      if (!encId) return;
      var d = dpDinosaurById(dinoId);
      d.enclosureId = encId;
      saveDB(); toast(d.name + " installé dans son enclos"); modal = null; render();
    },
    dpBuyFoodCrate: function (itemId) {
      var dp = dpData(); var item = dpFoodItem(itemId);
      if (dp.points < item.price) { dpPlayMerchantSound("noCash"); toast("Pas assez de points"); return; }
      dp.points -= item.price;
      dp.inventory[itemId] = (dp.inventory[itemId] || 0) + DP_PORTIONS_PER_CRATE;
      saveDB(); dpPlayMerchantSound("thankyou"); toast("+" + DP_PORTIONS_PER_CRATE + " " + item.name.toLowerCase() + " achetées (" + item.price + " pts)"); dpSyncPointsDisplay();
    },
    dpBuyCareCrate: function (itemId) {
      var dp = dpData(); var item = dpMedicineItem(itemId);
      if (dp.points < item.price) { dpPlayMerchantSound("noCash"); toast("Pas assez de points"); return; }
      dp.points -= item.price;
      dp.inventory[itemId] = (dp.inventory[itemId] || 0) + DP_DOSES_PER_CRATE;
      saveDB(); dpPlayMerchantSound("thankyou"); toast("+" + DP_DOSES_PER_CRATE + " " + item.name.toLowerCase() + " achetés (" + item.price + " pts)"); dpSyncPointsDisplay();
    },
    dpFeedDino: function (dinoId, itemId) {
      var dp = dpData(); var item = dpFoodItem(itemId);
      var d = dpDinosaurById(dinoId); var sp = dpSpecies(d.speciesId);
      var needed = dpFoodPortionsNeeded(sp.weightKg);
      if ((dp.inventory[itemId] || 0) < needed) { toast("Pas assez de " + item.name.toLowerCase() + " en stock (" + needed + " nécessaires)"); return; }
      dpTick(d, dp.virtualNow);
      dp.inventory[itemId] -= needed;
      var matches = sp.diet === "omnivore" || sp.diet === item.diet;
      if (matches) {
        d.lastFedAt = dp.virtualNow;
        saveDB(); toast(d.name + " a mangé : " + item.name); render();
      } else {
        d.health = Math.max(0, dpHealth(d) - 25);
        saveDB(); toast("⚠️ " + d.name + " (" + sp.diet + ") ne digère pas " + item.name.toLowerCase() + " et tombe malade !"); render();
      }
    },
    dpUseCare: function (dinoId, itemId) {
      var dp = dpData(); var item = dpMedicineItem(itemId);
      if ((dp.inventory[itemId] || 0) < 1) { toast("Plus de " + item.name.toLowerCase() + " en stock"); return; }
      var d = dpDinosaurById(dinoId);
      dpTick(d, dp.virtualNow);
      dp.inventory[itemId] -= 1;
      d.health = 100;
      saveDB(); toast(d.name + " a reçu : " + item.name); render();
    },
    dpStartCourseQuiz: function (courseId) {
      var loc = locateCourse(courseId);
      if (!loc) return;
      var pool = (loc.course.quizQuestions || []).slice();
      for (var i = pool.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
      dpView.quiz = { mode: "questions", courseId: courseId, questions: pool, idx: 0, answer: null, answerHtml: "", status: "answering", aiFeedback: "", revealed: false, wasCorrect: null, correct: 0, wrong: 0, totalEarned: 0, answeredCount: 0, history: [], done: false };
      render();
    },
    dpAnswerQcm: function (i) {
      var qz = dpView.quiz;
      if (qz.revealed) return;
      var q = qz.questions[qz.idx];
      qz.answer = i;
      qz.revealed = true;
      var wasCorrect = i === q.correctIndex;
      qz.score = wasCorrect ? 1 : 0; qz.scoreMax = 1;
      dpFinishAnswer(qz, q, q.choices[i], q.choices[q.correctIndex], wasCorrect ? "correct" : "wrong", []);
      render();
      dinoReact(wasCorrect);
    },
    dpSubmitOpenAnswer: function () {
      var qz = dpView.quiz;
      var q = qz.questions[qz.idx];
      if (!getApiKey()) { toast("Ajoute d'abord ta clé API dans les paramètres"); App.openApiKeyModal(); return; }
      qz.answerHtml = rteValue("dp-open-answer");
      var answerText = rteText("dp-open-answer");
      qz.answer = answerText;
      qz.status = "grading";
      render();
      gradeExerciseAnswer(q.prompt, q.answer, answerText).then(function (result) {
        qz.status = "graded";
        qz.revealed = true;
        qz.aiFeedback = result.feedback || "";
        var level = normalizeGradeLevel(result);
        qz.mistakes = result.mistakes || [];
        qz.score = result.score; qz.scoreMax = result.scoreMax;
        dpFinishAnswer(qz, q, answerText, q.answer, level, qz.mistakes);
        render();
        dinoReact(gradeLevelIsSuccess(level));
      }).catch(function (err) {
        qz.status = "answering";
        toast("Échec de la correction : " + (err.message || "erreur inconnue"), { status: err.status, detail: err.detail });
        render();
      });
    },
    dpNextQuizQuestion: function () {
      var qz = dpView.quiz;
      var isLast = qz.idx === qz.questions.length - 1;
      if (isLast) {
        qz.done = true;
      } else {
        qz.idx++; qz.answer = null; qz.answerHtml = ""; qz.status = "answering"; qz.aiFeedback = ""; qz.revealed = false; qz.wasCorrect = null; qz.level = null; qz.mistakes = null; qz.score = null; qz.scoreMax = null;
      }
      render();
    },
    dpStartCourseExercise: function (courseId) {
      var loc = locateCourse(courseId);
      if (!loc || !loc.course.exercises.length) return;
      var ex = loc.course.exercises[Math.floor(Math.random() * loc.course.exercises.length)];
      dpView.quiz = { mode: "exercise", courseId: courseId, exercise: ex, answer: "", answerHtml: "", status: "answering", correct: null, level: null, mistakes: null, feedback: "" };
      render();
    },
    dpSubmitExerciseAnswer: function () {
      var qz = dpView.quiz;
      qz.answerHtml = rteValue("dp-exercise-answer");
      var answer = rteText("dp-exercise-answer");
      if (!answer) { toast("Écris une réponse avant de valider"); return; }
      if (!getApiKey()) { toast("Ajoute d'abord ta clé API dans les paramètres"); App.openApiKeyModal(); return; }
      qz.answer = answer;
      qz.status = "grading";
      render();
      gradeExerciseAnswer(qz.exercise.prompt, qz.exercise.solution, qz.answer).then(function (result) {
        qz.status = "graded";
        var level = normalizeGradeLevel(result);
        qz.level = level;
        qz.correct = gradeLevelIsSuccess(level);
        qz.mistakes = result.mistakes || [];
        qz.feedback = result.feedback || "";
        qz.score = result.score; qz.scoreMax = result.scoreMax;
        var earned = Math.round(DP_EXERCISE_POINTS * (GRADE_LEVELS[level] || GRADE_LEVELS.wrong).pointsFactor);
        if (earned > 0) { var dp = dpData(); dp.points += earned; saveDB(); }
        qz.pointsEarned = earned;
        render();
        dinoReact(qz.correct);
      }).catch(function (err) {
        qz.status = "answering";
        toast("Échec de la correction : " + (err.message || "erreur inconnue"), { status: err.status, detail: err.detail });
        render();
      });
    },
    downloadDpExercisePdf: function () {
      var qz = dpView.quiz;
      if (!qz || qz.mode !== "exercise" || qz.status !== "graded") return;
      var ex = qz.exercise;
      var loc = locateCourse(qz.courseId);
      var title = loc ? loc.course.title : "Exercice";
      var html = buildExercisePrintHtml(title, "", mdToHtml(splitInlineNumberedQuestions(ex.prompt)), qz.answerHtml, qz.level || (qz.correct ? "correct" : "wrong"), qz.feedback, mdToHtml(splitInlineNumberedQuestions(ex.solution)), qz.mistakes);
      printAndDownload(html, title);
    },

    startEditCourseField: function (courseId, field) {
      courseEditState = { courseId: courseId, field: field };
      render();
    },
    cancelEditCourseField: function () {
      courseEditState = null;
      render();
    },
    saveEditCourseField: function (courseId, field) {
      var loc = locateCourse(courseId);
      if (!loc) { courseEditState = null; render(); return; }
      var ta = document.getElementById("course-field-textarea");
      loc.course[field] = ta ? ta.value : loc.course[field];
      saveDB();
      courseEditState = null;
      toast("Modifications enregistrées");
      render();
    },
    toggleCourseFigures: function (courseId) { courseFiguresOpen[courseId] = !courseFiguresOpen[courseId]; render(); },
    deleteCourseFigure: function (courseId, figureId) {
      var loc = locateCourse(courseId);
      if (!loc) return;
      loc.course.figures = (loc.course.figures || []).filter(function (f) { return f.id !== figureId; });
      saveDB();
      toast("Image supprimée");
      render();
    },
    toggleEntryFigures: function (entryId) { entryFiguresOpen[entryId] = !entryFiguresOpen[entryId]; render(); },
    deleteEntryFigure: function (entryId, figureId) {
      var entry = userData().importedExercises.find(function (x) { return x.id === entryId; });
      if (!entry) return;
      entry.figures = (entry.figures || []).filter(function (f) { return f.id !== figureId; });
      saveDB();
      toast("Image supprimée");
      render();
    },
    flipCard: function (courseId) {
      var st = fcState[courseId] || { idx: 0, flipped: false };
      st.flipped = !st.flipped; fcState[courseId] = st; render();
    },
    navCard: function (courseId, dir) {
      var st = fcState[courseId] || { idx: 0, flipped: false };
      st.idx += dir; st.flipped = false; fcState[courseId] = st; render();
    },
    srsStart: function () { srsSession = null; navigate("#/review"); },
    srsFlip: function () { if (srsSession) { srsSession.flipped = !srsSession.flipped; render(); } },
    srsAnswer: function (ok) {
      var s = srsSession;
      if (!s) return;
      var hit = srsFindCard(s.ids[s.idx]);
      if (hit) { srsGrade(hit.card, ok); saveDB(); }
      if (ok) s.ok++; else s.ko++;
      s.idx++; s.flipped = false;
      render();
    },
    srsFinish: function () { srsSession = null; navigate("#/today"); },
    markCard: function (courseId, status) {
      var loc = locateCourse(courseId);
      var st = fcState[courseId] || { idx: 0, flipped: false };
      var card = loc.course.flashcards[st.idx];
      srsGrade(card, status === "known"); // compte aussi pour la répétition espacée
      saveDB();
      if (st.idx < loc.course.flashcards.length - 1) { st.idx += 1; st.flipped = false; }
      fcState[courseId] = st;
      render();
    },

    toggleExamPrepFlashcards: function (key) { epGapFcOpen[key] = !epGapFcOpen[key]; render(); },
    toggleExamPrepTopicDetail: function (prepId) { epTopicDetailOpen[prepId] = !epTopicDetailOpen[prepId]; render(); },
    epFlipCard: function (key) {
      var st = epFcState[key] || { idx: 0, flipped: false };
      st.flipped = !st.flipped; epFcState[key] = st; render();
    },
    epNavCard: function (key, dir) {
      var st = epFcState[key] || { idx: 0, flipped: false };
      st.idx += dir; st.flipped = false; epFcState[key] = st; render();
    },
    epMarkCard: function (key, status) {
      var sep = key.indexOf("::");
      var prep = epFind(sep === -1 ? key : key.slice(0, sep));
      if (!prep) return;
      var day = sep === -1 ? null : key.slice(sep + 2);
      var cards = (prep.gapFlashcards || []).filter(function (f) { return f.day === day; });
      var st = epFcState[key] || { idx: 0, flipped: false };
      var card = cards[st.idx];
      if (!card) return;
      // Auto-évaluation non vérifiée (l'élève juge lui-même s'il "sait" la carte) : ça n'influence
      // jamais le baromètre, sans quoi il suffirait de re-marquer "Je la sais" en boucle pour le
      // faire grimper artificiellement sans avoir vraiment répondu à une question notée.
      srsGrade(card, status === "known"); // compte aussi pour la répétition espacée
      saveDB();
      if (st.idx < cards.length - 1) { st.idx += 1; st.flipped = false; }
      epFcState[key] = st;
      render();
    },

    answerQuiz: function (courseId, choiceIdx) {
      var st = quizState[courseId];
      st.answers[st.idx] = choiceIdx;
      var loc = locateCourse(courseId);
      var q = courseQcmQuestions(loc.course)[st.idx];
      render();
      dinoReact(choiceIdx === q.correctIndex);
    },
    quizNav: function (courseId, dir) {
      var st = quizState[courseId];
      st.idx += dir; render();
    },
    submitQuiz: function (courseId) {
      var loc = locateCourse(courseId);
      var st = quizState[courseId];
      st.submitted = true;
      var questions = courseQcmQuestions(loc.course);
      var correct = 0;
      questions.forEach(function (q, i) { if (st.answers[i] === q.correctIndex) correct++; });
      loc.course.attempts.push({ id: uid(), score: correct, total: questions.length, date: new Date().toISOString() });
      saveDB();
      render();
    },
    retryQuiz: function (courseId) {
      var loc = locateCourse(courseId);
      quizState[courseId] = { idx: 0, answers: new Array(courseQcmQuestions(loc.course).length).fill(null), submitted: false };
      render();
    }
  };

