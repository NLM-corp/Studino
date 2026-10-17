"use strict";
// Studino — fenêtres (modales)
// Fichier chargé dans l'ordre par index.html : les fichiers partagent les mêmes variables globales.

  /* ---------------- Modals ---------------- */
  function renderModal() {
    document.querySelectorAll(".modal-overlay").forEach(function (el) { el.remove(); });
    var LIGHT_MODAL_TYPES = { companion: 1, latex: 1, periodic: 1, table: 1 };
    // Ces 3 outils s'ouvrent le plus souvent PENDANT qu'on répond à un exercice, juste au-dessus de
    // l'énoncé : au centre de l'écran sans autre traitement, ils le cachent complètement. Le fond reste
    // transparent (l'énoncé est visible tout autour) et la boîte elle-même devient semi-transparente
    // dès que la souris n'est pas dessus (ni le focus clavier dedans), pour voir à travers sans avoir à
    // la déplacer ou la fermer.
    var TOOL_MODAL_TYPES = { latex: 1, periodic: 1, table: 1 };
    var isTool = !!TOOL_MODAL_TYPES[modal.type];
    var overlay = document.createElement("div");
    overlay.className = "modal-overlay" + (isTool ? " modal-overlay-tool" : "") + (modal.type === "latex" ? " modal-overlay-top" : "");
    overlay.onclick = function (e) { if (e.target === overlay) { LIGHT_MODAL_TYPES[modal.type] ? App.closeLightModal() : App.closeModal(); } };
    var inner = "";
    if (modal.type === "subject") {
      inner = '<h3>Nouvelle matière</h3><form onsubmit="App.createSubject(event)">' +
        '<div class="field"><label>Nom</label><input name="name" placeholder="Ex. Mathématiques" required autofocus></div>' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button><button type="submit" class="btn btn-primary">Créer</button></div>' +
        '</form>';
    } else if (modal.type === "theme") {
      inner = '<h3>Nouveau thème</h3><form onsubmit="App.createTheme(event)">' +
        '<div class="field"><label>Nom</label><input name="name" placeholder="Ex. Algèbre" required autofocus></div>' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button><button type="submit" class="btn btn-primary">Créer</button></div>' +
        '</form>';
    } else if (modal.type === "chapter") {
      inner = '<h3>Nouveau chapitre</h3><form onsubmit="App.createChapter(event)">' +
        '<div class="field"><label>Nom</label><input name="name" placeholder="Ex. Les fractions" required autofocus></div>' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button><button type="submit" class="btn btn-primary">Créer</button></div>' +
        '</form>';
    } else if (modal.type === "course") {
      var subs = userData().subjects;
      var subjectOptions = subs.map(function (s) { return '<option value="' + s.id + '" ' + (s.id === modal.subjectId ? "selected" : "") + '>' + esc(s.name) + '</option>'; }).join("");
      var currentSubj = findSubject(modal.subjectId) || subs[0];
      var themeOptions = (currentSubj ? currentSubj.themes : []).map(function (t) { return '<option value="' + t.id + '" ' + (t.id === modal.themeId ? "selected" : "") + '>' + esc(t.name) + '</option>'; }).join("");
      var currentTheme = currentSubj ? (findTheme(currentSubj, modal.themeId) || currentSubj.themes[0]) : null;
      var chapterOptions = (currentTheme ? currentTheme.chapters : []).map(function (c) { return '<option value="' + c.id + '" ' + (c.id === modal.chapterId ? "selected" : "") + '>' + esc(c.name) + '</option>'; }).join("");
      inner = '<h3>Importer un cours</h3><form onsubmit="App.createCourse(event)">' +
        '<div class="field"><label>Photos ou PDF du cours (une ou plusieurs pages)</label>' +
        '<div class="file-thumbs">' +
        modal.imagePreviews.map(fileThumbHtml).join("") +
        '<div class="file-drop' + (modal.imagePreviews.length ? " file-drop-add" : "") + '" onclick="document.getElementById(\'courseFileInput\').click()" ondragover="App.handleDragOver(event)" ondragleave="App.handleDragLeave(event)" ondrop="App.handleFileDrop(event)">' + icon("camera") + '<div style="margin-top:6px">' + (modal.imagePreviews.length ? "Ajouter" : "Cliquer ou glisser des images/PDF ici") + '</div></div>' +
        '</div>' +
        '<input id="courseFileInput" type="file" accept="image/*,.heic,.heif,.tiff,.tif,.pdf,application/pdf" capture="environment" multiple style="display:none" onchange="App.handleFile(event)"></div>' +
        '<div class="field"><label>Titre du cours</label><input name="title" placeholder="Ex. Le théorème de Pythagore" required autofocus></div>' +
        '<div class="field"><label>Matière</label><select name="subjectId" onchange="App.changeModalSubject(this.value)">' + subjectOptions + '</select></div>' +
        (currentSubj && currentSubj.themes.length ? '<div class="field"><label>Thème</label><select name="themeId" onchange="App.changeModalTheme(this.value)">' + themeOptions + '</select></div>' +
          '<div class="field"><label>Chapitre</label><select name="chapterId">' + chapterOptions + '</select></div>'
          : '<p class="modal-warn">Cette matière n\'a aucun thème — crée-en un d\'abord.</p>') +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button><button type="submit" class="btn btn-primary" ' + (currentSubj && currentSubj.themes.length ? "" : "disabled") + '>Générer le cours</button></div>' +
        '</form>';
    } else if (modal.type === "methodologie") {
      inner = '<h3>Ajouter une méthodologie</h3>' +
        '<p class="modal-warn" style="margin-bottom:14px">La méthode que ton prof t\'a donnée pour un type d\'épreuve (dissertation, commentaire, étude de document...) — pas un cours. Studino ne te fera pas réviser la méthode par cœur : elle générera des sujets d\'entraînement à rédiger, notés comme une vraie copie. Pas besoin de choisir une matière ici : la même méthode sert souvent pour plusieurs matières (ex. la dissertation en français ET en histoire) — tu choisiras la matière et le chapitre au moment de t\'entraîner.</p>' +
        '<form onsubmit="App.createMethodology(event)">' +
        '<div class="field"><label>Photos ou PDF de la méthodologie <span style="font-weight:400;color:var(--text-muted)">(optionnel)</span></label>' +
        '<div class="file-thumbs">' +
        modal.imagePreviews.map(fileThumbHtml).join("") +
        '<div class="file-drop' + (modal.imagePreviews.length ? " file-drop-add" : "") + '" onclick="document.getElementById(\'methodoFileInput\').click()" ondragover="App.handleDragOver(event)" ondragleave="App.handleDragLeave(event)" ondrop="App.handleFileDrop(event)">' + icon("camera") + '<div style="margin-top:6px">' + (modal.imagePreviews.length ? "Ajouter" : "Cliquer ou glisser des images/PDF ici") + '</div></div>' +
        '</div>' +
        '<input id="methodoFileInput" type="file" accept="image/*,.heic,.heif,.tiff,.tif,.pdf,application/pdf" capture="environment" multiple style="display:none" onchange="App.handleFile(event)"></div>' +
        (modal.imagePreviews.length ? "" : '<p class="modal-warn" style="margin:-6px 0 14px">Pas de méthode donnée par ton prof ? Laisse vide et écris juste le type d\'épreuve ci-dessous (ex. « Commentaire de texte », « Question problématisée d\'histoire ») — l\'IA rédigera une méthodologie standard à ta place.</p>') +
        '<div class="field"><label>Titre' + (modal.imagePreviews.length ? "" : ' — le type d\'épreuve') + '</label><input name="title" placeholder="Ex. Méthode de la dissertation" required autofocus></div>' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button><button type="submit" class="btn btn-primary">Analyser</button></div>' +
        '</form>';
    } else if (modal.type === "podcastGen") {
      var ppSubs = userData().subjects;
      var ppSubj = findSubject(modal.subjectId) || ppSubs[0];
      if (ppSubj) modal.subjectId = ppSubj.id;
      var ppLevel = modal.level || "chapter";
      // Sélection en cascade (thème → chapitre → cours) plutôt qu'une seule liste de TOUS les chapitres
      // de tous les thèmes mélangés : on choisit d'abord le thème, puis on ne voit que ses chapitres, etc.
      var ppThemes = ppSubj ? dpThemesWithContent(ppSubj) : [];
      var ppTheme = ppThemes.find(function (t) { return t.id === modal.themeId; }) || ppThemes[0];
      modal.themeId = ppTheme ? ppTheme.id : "";
      var ppChapters = ppTheme ? dpChaptersWithContent(ppTheme) : [];
      var ppChap = ppChapters.find(function (c) { return c.id === modal.chapterId; }) || ppChapters[0];
      modal.chapterId = ppChap ? ppChap.id : "";
      var ppCourses = ppChap ? dpCoursesWithContent(ppChap) : [];
      var ppCourse = ppCourses.find(function (co) { return co.id === modal.courseId; }) || ppCourses[0];
      modal.courseId = ppCourse ? ppCourse.id : "";
      var ppOptions = function (items, selectedId, labelKey) {
        return items.map(function (x) { return '<option value="' + x.id + '" ' + (x.id === selectedId ? "selected" : "") + '>' + esc(x[labelKey]) + '</option>'; }).join("");
      };
      var ppSubjOptions = ppOptions(ppSubs, modal.subjectId, "name");
      var ppLevelBtn = function (level, label) {
        return '<button type="button" class="btn btn-sm ' + (ppLevel === level ? "btn-primary" : "btn-ghost") + '" style="width:auto" onclick="App.setPodcastLevel(\'' + level + '\')">' + label + '</button>';
      };
      var ppHasAny = ppThemes.length > 0;
      inner = '<h3>🎙️ Nouveau podcast</h3>' +
        '<p class="modal-warn" style="margin-bottom:14px">Le vieux conteur raconte la portée choisie, fidèlement et en entier — pas une récitation, un vrai récit.</p>' +
        (ppSubs.length ? (
          '<div class="field"><label>Matière</label><select onchange="App.changePodcastSubject(this.value)">' + ppSubjOptions + '</select></div>' +
          '<div class="field"><label>Portée</label><div style="display:flex;gap:8px;flex-wrap:wrap">' +
          ppLevelBtn("theme", "Tout un thème") + ppLevelBtn("chapter", "Un chapitre") + ppLevelBtn("course", "Un seul cours") +
          '</div></div>' +
          '<div class="field"><label>Langue du podcast</label><select onchange="App.setPodcastLangMode(this.value)">' +
          PODCAST_LANG_MODES.map(function (lm) { return '<option value="' + lm[0] + '" ' + ((modal.langMode || "auto") === lm[0] ? "selected" : "") + '>' + lm[1] + '</option>'; }).join("") +
          '</select><p style="font-size:12px;color:var(--text-muted);margin:6px 0 0">' + PODCAST_LANG_HINTS[modal.langMode || "auto"] + '</p></div>' +
          (ppHasAny ? (
            '<div class="field"><label>Thème</label><select onchange="App.changePodcastTheme(this.value)">' + ppOptions(ppThemes, modal.themeId, "name") + '</select></div>' +
            (ppLevel !== "theme" ? '<div class="field"><label>Chapitre</label><select onchange="App.changePodcastChapter(this.value)">' + ppOptions(ppChapters, modal.chapterId, "name") + '</select></div>' : "") +
            (ppLevel === "course" ? '<div class="field"><label>Cours</label><select onchange="App.changePodcastCourse(this.value)">' + ppOptions(ppCourses, modal.courseId, "title") + '</select></div>' : "") +
            '<p style="font-size:12px;color:var(--text-muted);margin:-4px 0 14px">Le vieux conteur décide lui-même s\'il faut une ou plusieurs parties, selon la quantité réelle de contenu à couvrir.</p>' +
            '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button><button type="button" class="btn btn-primary" onclick="App.createPodcast()">Générer</button></div>'
          ) : '<p class="modal-warn">Cette matière n\'a encore aucun cours généré — génère au moins un cours avant de créer un podcast.</p>')
        ) : '<p class="modal-warn">Crée d\'abord une matière avec au moins un cours généré.</p>');
    } else if (modal.type === "addCourseDocs") {
      inner = '<h3>Ajouter des documents</h3>' +
        '<p class="modal-warn" style="margin-bottom:14px">Seul ce qui est <b>nouveau</b> dans ces documents est ajouté au cours : ce qui y est déjà n\'est pas recopié. Rien de ce qui existe ne change (retranscription, explication, schémas, flashcards et ta progression, contrôle, exercices) ; le nouveau contenu arrive à la suite, avec ses propres explications, flashcards, questions et exercices.</p>' +
        '<form onsubmit="App.addCourseDocs(event)">' +
        '<div class="field"><label>Nouvelles photos ou PDF</label>' +
        '<div class="file-thumbs">' +
        modal.imagePreviews.map(fileThumbHtml).join("") +
        '<div class="file-drop' + (modal.imagePreviews.length ? " file-drop-add" : "") + '" onclick="document.getElementById(\'addDocsFileInput\').click()" ondragover="App.handleDragOver(event)" ondragleave="App.handleDragLeave(event)" ondrop="App.handleFileDrop(event)">' + icon("camera") + '<div style="margin-top:6px">' + (modal.imagePreviews.length ? "Ajouter" : "Cliquer ou glisser des images/PDF ici") + '</div></div>' +
        '</div>' +
        '<input id="addDocsFileInput" type="file" accept="image/*,.heic,.heif,.tiff,.tif,.pdf,application/pdf" capture="environment" multiple style="display:none" onchange="App.handleFile(event)"></div>' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button><button type="submit" class="btn btn-primary">Ajouter et régénérer</button></div>' +
        '</form>';
    } else if (modal.type === "revisionSheetGen") {
      var rsSubs = userData().subjects;
      if (!rsSubs.length) {
        inner = '<h3>Générer une fiche de révision</h3>' +
          '<p class="modal-warn">Crée d\'abord une matière avec au moins un cours généré.</p>' +
          '<div class="modal-actions"><button type="button" class="btn btn-ghost" style="width:100%" onclick="App.closeModal()">Fermer</button></div>';
      } else {
        var rsSubjectOptions = rsSubs.map(function (s) { return '<option value="' + s.id + '" ' + (s.id === modal.subjectId ? "selected" : "") + '>' + esc(s.name) + '</option>'; }).join("");
        var rsSubj = findSubject(modal.subjectId) || rsSubs[0];
        var rsThemes = dpThemesWithContent(rsSubj);
        var rsThemeOptions = rsThemes.map(function (t) { return '<option value="' + t.id + '" ' + (t.id === modal.themeId ? "selected" : "") + '>' + esc(t.name) + '</option>'; }).join("");
        var rsTheme = findTheme(rsSubj, modal.themeId) || rsThemes[0];
        var rsChapters = rsTheme ? dpChaptersWithContent(rsTheme) : [];
        var rsChapterOptions = rsChapters.map(function (c) { return '<option value="' + c.id + '" ' + (c.id === modal.chapterId ? "selected" : "") + '>' + esc(c.name) + '</option>'; }).join("");
        var rsChap = (rsTheme && findChapter(rsTheme, modal.chapterId)) || rsChapters[0];
        var rsCourses = rsChap ? dpCoursesWithContent(rsChap) : [];
        var rsCourseOptions = rsCourses.map(function (co) { return '<option value="' + co.id + '" ' + (co.id === modal.courseId ? "selected" : "") + '>' + esc(co.title) + '</option>'; }).join("");
        inner = '<h3>Générer une fiche de révision</h3>' +
          '<div class="field"><label>Matière</label><select onchange="App.changeRevisionSheetSubject(this.value)">' + rsSubjectOptions + '</select></div>' +
          (rsThemes.length ? (
            '<div class="field"><label>Thème</label><select onchange="App.changeRevisionSheetTheme(this.value)">' + rsThemeOptions + '</select></div>' +
            (rsChapters.length ? (
              '<div class="field"><label>Portée</label><div class="modal-actions" style="margin:0 0 4px">' +
              '<button type="button" class="btn btn-sm ' + (modal.scope === "theme" ? "btn-primary" : "btn-ghost") + '" onclick="App.changeRevisionSheetScope(\'theme\')">Thème entier</button>' +
              '<button type="button" class="btn btn-sm ' + (modal.scope === "chapter" ? "btn-primary" : "btn-ghost") + '" onclick="App.changeRevisionSheetScope(\'chapter\')">Chapitre entier</button>' +
              '<button type="button" class="btn btn-sm ' + (modal.scope === "course" ? "btn-primary" : "btn-ghost") + '" onclick="App.changeRevisionSheetScope(\'course\')">Un seul cours</button>' +
              '</div></div>' +
              (modal.scope === "theme" ? "" : '<div class="field"><label>Chapitre</label><select onchange="App.changeRevisionSheetChapter(this.value)">' + rsChapterOptions + '</select></div>') +
              (modal.scope === "course" ? '<div class="field"><label>Cours</label><select onchange="App.changeRevisionSheetCourse(this.value)">' + rsCourseOptions + '</select></div>' : "") +
              '<p class="modal-warn" style="margin-top:4px">Fiche ULTRA COMPLÈTE : reprend absolument tout ce qu\'il y a à savoir, sans rien couper.</p>'
            ) : '<p class="modal-warn">Ce thème n\'a aucun cours généré pour l\'instant.</p>')
          ) : '<p class="modal-warn">Cette matière n\'a aucun cours généré pour l\'instant.</p>') +
          '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>' +
          (rsChapters.length ? '<button type="button" class="btn btn-primary" onclick="App.generateRevisionSheet()">Générer</button>' : "") +
          '</div>';
      }
    } else if (modal.type === "examPrepGen") {
      var epSubs = userData().subjects;
      if (!epSubs.length) {
        inner = '<h3>Nouvelle prépa d\'examen</h3>' +
          '<p class="modal-warn">Crée d\'abord une matière avec au moins un cours généré.</p>' +
          '<div class="modal-actions"><button type="button" class="btn btn-ghost" style="width:100%" onclick="App.closeModal()">Fermer</button></div>';
      } else {
        var epmSubjectOptions = epSubs.map(function (s) { return '<option value="' + s.id + '" ' + (s.id === modal.subjectId ? "selected" : "") + '>' + esc(s.name) + '</option>'; }).join("");
        var epmSubj = findSubject(modal.subjectId) || epSubs[0];
        var epmThemes = dpThemesWithContent(epmSubj);
        var epmThemeOptions = epmThemes.map(function (t) { return '<option value="' + t.id + '" ' + (t.id === modal.themeId ? "selected" : "") + '>' + esc(t.name) + '</option>'; }).join("");
        var epmTheme = findTheme(epmSubj, modal.themeId) || epmThemes[0];
        var epmChapters = epmTheme ? dpChaptersWithContent(epmTheme) : [];
        var epmChapterOptions = epmChapters.map(function (c) { return '<option value="' + c.id + '" ' + (c.id === modal.chapterId ? "selected" : "") + '>' + esc(c.name) + '</option>'; }).join("");
        var epmChap = (epmTheme && findChapter(epmTheme, modal.chapterId)) || epmChapters[0];
        var epmCourses = epmChap ? dpCoursesWithContent(epmChap) : [];
        var epmCourseOptions = epmCourses.map(function (co) { return '<option value="' + co.id + '" ' + (co.id === modal.courseId ? "selected" : "") + '>' + esc(co.title) + '</option>'; }).join("");
        var epmLevelBtn = function (level, label) { return '<button type="button" class="btn btn-sm ' + (modal.level === level ? "btn-primary" : "btn-ghost") + '" onclick="App.changeExamPrepLevel(\'' + level + '\')">' + label + '</button>'; };
        var epmReady = modal.level === "subject" ? !!epmThemes.length
          : modal.level === "theme" ? !!epmChapters.length
          : modal.level === "chapter" ? !!epmChapters.length
          : !!epmCourses.length;
        inner = '<h3>Nouvelle prépa d\'examen</h3>' +
          '<div class="field"><label>Titre (optionnel)</label><input name="title" value="' + esc(modal.title || "") + '" oninput="App.setExamPrepField(\'title\',this.value)" placeholder="Ex. Contrôle de maths"></div>' +
          '<div class="field"><label>Date de l\'examen</label><input name="examDate" type="date" value="' + esc(modal.examDate || "") + '" min="' + epTodayStr() + '" oninput="App.setExamPrepField(\'examDate\',this.value)" required></div>' +
          '<div class="field"><label>Matière</label><select onchange="App.changeExamPrepSubject(this.value)">' + epmSubjectOptions + '</select></div>' +
          (epmThemes.length ? (
            '<div class="field"><label>Portée</label><div class="modal-actions" style="margin:0 0 4px;flex-wrap:wrap">' +
            epmLevelBtn("subject", "Matière entière") + epmLevelBtn("theme", "Thème entier") + epmLevelBtn("chapter", "Chapitre entier") + epmLevelBtn("course", "Un seul cours") +
            '</div></div>' +
            (modal.level !== "subject" ? '<div class="field"><label>Thème</label><select onchange="App.changeExamPrepTheme(this.value)">' + epmThemeOptions + '</select></div>' : "") +
            ((modal.level === "chapter" || modal.level === "course") && epmTheme ? (
              epmChapters.length ? '<div class="field"><label>Chapitre</label><select onchange="App.changeExamPrepChapter(this.value)">' + epmChapterOptions + '</select></div>'
                : '<p class="modal-warn">Ce thème n\'a aucun chapitre avec un cours généré.</p>'
            ) : "") +
            (modal.level === "course" && epmChap ? (
              epmCourses.length ? '<div class="field"><label>Cours</label><select onchange="App.changeExamPrepCourse(this.value)">' + epmCourseOptions + '</select></div>'
                : '<p class="modal-warn">Ce chapitre n\'a aucun cours généré.</p>'
            ) : "")
          ) : '<p class="modal-warn">Cette matière n\'a aucun cours généré pour l\'instant.</p>') +
          '<div class="field"><label>Type de révision</label><select onchange="App.setExamPrepField(\'revisionMode\',this.value);App.refreshModal()">' +
          EP_REVISION_MODES.map(function (rm) { return '<option value="' + rm[0] + '" ' + ((modal.revisionMode || "auto") === rm[0] ? "selected" : "") + '>' + rm[1] + '</option>'; }).join("") +
          '</select><p style="font-size:12px;color:var(--text-muted);margin:6px 0 0">' + epRevisionModeHint(modal.revisionMode || "auto") + '</p></div>' +
          (function () {
            // Pas de filtre par matière ici : une méthodologie n'est plus liée à une seule matière
            // (elle peut servir en français comme en histoire), donc toutes celles prêtes sont proposées.
            var epmMethodos = methodoData().filter(function (mm) { return mm.status === "ready"; });
            if (!epmMethodos.length) return "";
            if (epmMethodos.length === 1) {
              return '<div class="field"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600"><input type="checkbox" ' + (modal.methodologyId === epmMethodos[0].id ? "checked" : "") + ' onchange="App.setExamPrepField(\'methodologyId\', this.checked ? \'' + epmMethodos[0].id + '\' : null)"> Inclure un sujet de « ' + esc(epmMethodos[0].genre || epmMethodos[0].title) + ' » à chaque séance</label></div>';
            }
            var epmMethodoOptions = '<option value="">Aucune</option>' + epmMethodos.map(function (mm) { return '<option value="' + mm.id + '" ' + (mm.id === modal.methodologyId ? "selected" : "") + '>' + esc(mm.genre || mm.title) + '</option>'; }).join("");
            return '<div class="field"><label>Inclure un sujet de méthodologie à chaque séance</label><select onchange="App.setExamPrepField(\'methodologyId\', this.value || null)">' + epmMethodoOptions + '</select></div>';
          })() +
          '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>' +
          (epmThemes.length && epmReady ? '<button type="button" class="btn btn-metal" onclick="App.createExamPrep()">Générer le planning</button>' : "") +
          '</div>';
      }
    } else if (modal.type === "examPrepEditDate") {
      inner = '<h3>Changer la date de l\'examen</h3>' +
        '<div class="field"><label>Nouvelle date de l\'examen</label><input name="examDate" type="date" value="' + esc(modal.examDate || "") + '" min="' + epTodayStr() + '" oninput="App.setExamPrepField(\'examDate\',this.value)" required></div>' +
        '<p class="modal-warn">Le planning sera régénéré à partir d\'aujourd\'hui : les jours déjà passés ou déjà faits ne sont jamais modifiés.</p>' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>' +
        '<button type="button" class="btn btn-metal" onclick="App.saveExamPrepEditDate()">Enregistrer et régénérer</button>' +
        '</div>';
    } else if (modal.type === "moveChapter") {
      var mcSubs = userData().subjects;
      var mcSubj = findSubject(modal.destSubjectId) || mcSubs[0];
      var mcSubjectOptions = mcSubs.map(function (s) { return '<option value="' + s.id + '" ' + (s.id === modal.destSubjectId ? "selected" : "") + '>' + esc(s.name) + '</option>'; }).join("");
      var mcThemes = mcSubj ? mcSubj.themes : [];
      var mcThemeOptions = mcThemes.map(function (t) { return '<option value="' + t.id + '" ' + (t.id === modal.destThemeId ? "selected" : "") + '>' + esc(t.name) + '</option>'; }).join("");
      inner = '<h3>Déplacer le chapitre</h3>' +
        '<div class="field"><label>Matière de destination</label><select onchange="App.changeMoveChapterSubject(this.value)">' + mcSubjectOptions + '</select></div>' +
        (mcThemes.length ? '<div class="field"><label>Thème de destination</label><select onchange="App.changeMoveChapterTheme(this.value)">' + mcThemeOptions + '</select></div>'
          : '<p class="modal-warn">Cette matière n\'a aucun thème — crée-en un d\'abord.</p>') +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>' +
        (mcThemes.length ? '<button type="button" class="btn btn-primary" onclick="App.confirmMoveChapter()">Déplacer</button>' : "") +
        '</div>';
    } else if (modal.type === "moveCourse") {
      var mvSubs = userData().subjects;
      var mvSubj = findSubject(modal.destSubjectId) || mvSubs[0];
      var mvSubjectOptions = mvSubs.map(function (s) { return '<option value="' + s.id + '" ' + (s.id === modal.destSubjectId ? "selected" : "") + '>' + esc(s.name) + '</option>'; }).join("");
      var mvThemes = mvSubj ? mvSubj.themes : [];
      var mvThemeOptions = mvThemes.map(function (t) { return '<option value="' + t.id + '" ' + (t.id === modal.destThemeId ? "selected" : "") + '>' + esc(t.name) + '</option>'; }).join("");
      var mvTheme = findTheme(mvSubj, modal.destThemeId) || mvThemes[0];
      var mvChapters = mvTheme ? mvTheme.chapters : [];
      var mvChapterOptions = mvChapters.map(function (c) { return '<option value="' + c.id + '" ' + (c.id === modal.destChapterId ? "selected" : "") + '>' + esc(c.name) + '</option>'; }).join("");
      inner = '<h3>Déplacer le cours</h3>' +
        '<div class="field"><label>Matière de destination</label><select onchange="App.changeMoveCourseSubject(this.value)">' + mvSubjectOptions + '</select></div>' +
        (mvThemes.length ? '<div class="field"><label>Thème de destination</label><select onchange="App.changeMoveCourseTheme(this.value)">' + mvThemeOptions + '</select></div>' +
          (mvChapters.length ? '<div class="field"><label>Chapitre de destination</label><select onchange="App.changeMoveCourseChapter(this.value)">' + mvChapterOptions + '</select></div>'
            : '<p class="modal-warn">Ce thème n\'a aucun chapitre — crée-en un d\'abord.</p>')
          : '<p class="modal-warn">Cette matière n\'a aucun thème — crée-en un d\'abord.</p>') +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>' +
        (mvChapters.length ? '<button type="button" class="btn btn-primary" onclick="App.confirmMoveCourse()">Déplacer</button>' : "") +
        '</div>';
    } else if (modal.type === "exercice") {
      inner = '<h3>Importer un exercice</h3>' +
        '<p class="modal-warn" style="margin-bottom:14px">Ton propre exercice, dans n\'importe quelle matière — corrigé par l\'IA, mais ne rapporte pas de points Dino Park.</p>' +
        '<form onsubmit="App.createImportedExercise(event)">' +
        '<div class="field"><label>Photos ou PDF de l\'exercice</label>' +
        '<div class="file-thumbs">' +
        modal.imagePreviews.map(fileThumbHtml).join("") +
        '<div class="file-drop' + (modal.imagePreviews.length ? " file-drop-add" : "") + '" onclick="document.getElementById(\'exerciseFileInput\').click()" ondragover="App.handleDragOver(event)" ondragleave="App.handleDragLeave(event)" ondrop="App.handleFileDrop(event)">' + icon("camera") + '<div style="margin-top:6px">' + (modal.imagePreviews.length ? "Ajouter" : "Cliquer ou glisser des images/PDF ici") + '</div></div>' +
        '</div>' +
        '<input id="exerciseFileInput" type="file" accept="image/*,.heic,.heif,.tiff,.tif,.pdf,application/pdf" capture="environment" multiple style="display:none" onchange="App.handleFile(event)"></div>' +
        '<div class="field"><label>Titre (optionnel)</label><input name="title" placeholder="Ex. Exercice de géométrie" autofocus></div>' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button><button type="submit" class="btn btn-primary">Importer</button></div>' +
        '</form>';
    } else if (modal.type === "confirmDelete") {
      var name = "", warn = "";
      if (modal.kind === "subject") {
        var ds = findSubject(modal.subjectId);
        name = ds ? ds.name : "";
        warn = "Tous ses thèmes, chapitres et cours seront supprimés avec elle.";
      } else if (modal.kind === "theme") {
        var dsu = findSubject(modal.subjectId);
        var dth = findTheme(dsu, modal.themeId);
        name = dth ? dth.name : "";
        warn = "Tous ses chapitres et tous les cours qu'ils contiennent seront supprimés avec lui.";
      } else if (modal.kind === "chapter") {
        var dsub = findSubject(modal.subjectId);
        var dthe = findTheme(dsub, modal.themeId);
        var dch = findChapter(dthe, modal.chapterId);
        name = dch ? dch.name : "";
        warn = "Tous les cours qu'il contient seront supprimés avec lui.";
      } else if (modal.kind === "course") {
        var dsub2 = findSubject(modal.subjectId);
        var dthe2 = findTheme(dsub2, modal.themeId);
        var dch2 = findChapter(dthe2, modal.chapterId);
        var dco = findCourse(dch2, modal.courseId);
        name = dco ? dco.title : "";
        warn = "Sa retranscription, ses flashcards et son contrôle seront perdus.";
      } else if (modal.kind === "importedExercise") {
        var die = userData().importedExercises.find(function (x) { return x.id === modal.courseId; });
        name = die ? die.title : "";
        warn = "Son énoncé, ta réponse et sa correction seront perdus.";
      } else if (modal.kind === "revisionSheet") {
        var drs = userData().revisionSheets.find(function (x) { return x.id === modal.courseId; });
        name = drs ? drs.title : "";
        warn = "Cette fiche de révision sera définitivement perdue.";
      } else if (modal.kind === "examPrep") {
        var dep = epFind(modal.courseId);
        name = dep ? dep.title : "";
        warn = "Son planning et ta progression seront définitivement perdus.";
      } else if (modal.kind === "methodology") {
        var dmt = methodoFind(modal.courseId);
        name = dmt ? dmt.title : "";
        warn = "Tous les sujets générés et leurs corrections seront définitivement perdus.";
      } else if (modal.kind === "podcast") {
        var dpod = podcastFind(modal.courseId);
        name = dpod ? dpod.title : "";
        warn = "Cet épisode audio sera définitivement perdu.";
      } else if (modal.kind === "podcastGroup") {
        var dgrp = podcastData().filter(function (x) { return x.groupId === modal.courseId; });
        name = dgrp.length ? (dgrp[0].scopeName || dgrp[0].title) : "";
        warn = "Les " + dgrp.length + " parties de ce podcast seront définitivement perdues.";
      }
      inner = '<h3>Supprimer « ' + esc(name) + ' » ?</h3>' +
        '<p class="modal-warn">' + warn + ' <strong>Cette action est définitive.</strong></p>' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button><button type="button" class="btn btn-danger" onclick="App.executeDelete()">Supprimer</button></div>';
    } else if (modal.type === "confirmImportBackup") {
      inner = '<h3>Importer cette sauvegarde ?</h3>' +
        '<p class="modal-warn">Ce fichier contient ' + modal.userCount + ' compte' + (modal.userCount > 1 ? "s" : "") + '.</p>' +
        '<p class="modal-warn"><strong>🔀 Fusionner</strong> (recommandé) : garde tout ce que tu as déjà sur cet appareil et rajoute simplement ce qui n\'existe QUE dans le fichier importé (nouveaux cours, exercices, prépas...) — rien n\'est perdu d\'un côté ni de l\'autre.</p>' +
        '<p class="modal-warn"><strong>♻️ Remplacer</strong> : efface tout ce qui est sur cet appareil et le remplace entièrement par le contenu du fichier — <strong>définitif</strong>, à utiliser seulement si cet appareil ne contient que des tests à jeter.</p>' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button><button type="button" class="btn btn-danger" onclick="App.executeImportBackup()">Remplacer</button><button type="button" class="btn btn-primary" onclick="App.executeMergeBackup()">Fusionner</button></div>';
    } else if (modal.type === "renameItem") {
      inner = '<h3>Renommer</h3><form onsubmit="App.confirmRename(event)">' +
        '<div class="field"><label>Nom</label><input name="name" value="' + esc(modal.currentName) + '" required autofocus></div>' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button><button type="submit" class="btn btn-primary">Enregistrer</button></div>' +
        '</form>';
    } else if (modal.type === "calEvent") {
      inner = calEventModalHtml();
    } else if (modal.type === "calSettings") {
      inner = calSettingsModalHtml();
    } else if (modal.type === "apiKey") {
      inner = '<h3>Clé API Gemini</h3>' +
        '<p class="modal-warn" style="margin-bottom:14px">Stockée uniquement dans le stockage local de ce navigateur, envoyée uniquement à l\'API Google Gemini pour générer tes cours.</p>' +
        '<form onsubmit="App.saveApiKey(event)">' +
        '<div class="field"><label>Clé API</label><input name="apiKey" type="password" placeholder="AIzaSy..." value="' + esc(getApiKey()) + '" autocomplete="off" autofocus></div>' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button><button type="submit" class="btn btn-primary">Enregistrer</button></div>' +
        '</form>';
    } else if (modal.type === "apiKeyGuide") {
      inner = '<h3>🔑 Bienvenue sur Studino !</h3>' +
        '<p class="modal-warn" style="margin-bottom:16px">Pour générer tes cours, questions et exercices, Studino a besoin d\'une clé API Gemini (Google). C\'est <strong>gratuit</strong> et ça prend 2 minutes — voici comment faire :</p>' +
        '<ol class="apikey-guide-steps">' +
        '<li>Va sur <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com/apikey</a> (Google AI Studio) et connecte-toi avec un compte Google (ou crées-en un gratuitement si tu n\'en as pas) — assure-toi qu\'aucun AUTRE compte Google n\'est connecté en même temps dans ce navigateur, sinon Google peut mélanger les permissions et bloquer.</li>' +
        '<li>Clique sur le bouton <strong>« Create API key »</strong> (« Créer une clé API »), en haut de la page.</li>' +
        '<li>Si ça te propose direct de créer la clé, choisis <strong>« Create API key in new project »</strong> — aucune carte bancaire n\'est demandée. Si à la place ça affiche une erreur du genre <em>« Failed to list imported projects »</em> (fréquent sur un compte tout neuf), pas de panique : choisis <strong>« Créer un projet »</strong>, donne-lui un nom (n\'importe lequel), puis reviens sur aistudio.google.com/apikey et relance « Create API key » — cette fois choisis <strong>« Importer un projet »</strong> et sélectionne celui que tu viens de créer.</li>' +
        '<li>Ta clé s\'affiche à l\'écran : une suite de caractères qui commence par <code>AIzaSy…</code>. Clique sur l\'icône de copie à côté pour la copier.</li>' +
        '<li>Reviens sur cette page, colle ta clé dans le champ juste en dessous, puis clique sur <strong>Enregistrer</strong>. C\'est tout !</li>' +
        '</ol>' +
        '<p style="font-size:12px;color:var(--text-muted);margin:12px 0 16px">La version gratuite a une limite d\'utilisation par jour (largement suffisante pour réviser normalement). Ta clé est stockée uniquement dans ce navigateur et envoyée uniquement à l\'API Google — ne la partage jamais publiquement (capture d\'écran, message, etc.).</p>' +
        '<form onsubmit="App.saveApiKey(event)">' +
        '<div class="field"><label>Colle ta clé API ici</label><input name="apiKey" type="password" placeholder="AIzaSy..." autocomplete="off" autofocus></div>' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Plus tard</button><button type="submit" class="btn btn-primary">Enregistrer</button></div>' +
        '</form>' +
        '<p class="modal-warn" style="margin-top:16px">💡 Conseil : une fois cette clé enregistrée, pense aussi à créer une <strong>clé de secours</strong> avec un second compte Google (dans Paramètres → Clé API de secours) — si celle-ci atteint sa limite gratuite quotidienne, Studino bascule automatiquement dessus au lieu de te bloquer.</p>';
    } else if (modal.type === "backupApiKeyGuide") {
      inner = '<h3>🔑 Clé API de secours</h3>' +
        '<p class="modal-warn" style="margin-bottom:16px">Optionnel : une deuxième clé, créée avec un <strong>autre compte Google</strong> que ta clé principale. Si ta clé principale atteint sa limite gratuite quotidienne sur tous ses modèles, Studino bascule automatiquement sur celle-ci — un compte Google différent a un quota totalement indépendant. Même méthode que pour la première :</p>' +
        '<p class="modal-warn" style="margin-bottom:16px">⚠️ Utilise une <strong>fenêtre de navigation privée</strong> pour tout ce qui suit, avec <strong>uniquement</strong> le nouveau compte connecté dedans (pas ton compte principal en même temps) — sinon Google mélange les permissions des deux comptes et bloque la création.</p>' +
        '<ol class="apikey-guide-steps">' +
        '<li>En navigation privée, connecté avec le nouveau compte, va sur <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com/apikey</a> et clique sur <strong>« Create API key »</strong> (« Créer une clé API »).</li>' +
        '<li>Dans la fenêtre qui s\'ouvre, choisis <strong>« Créer un projet »</strong> (pas « Importer un projet », c\'est souvent cette étape qui échoue sur un compte tout neuf) et donne-lui un nom, n\'importe lequel.</li>' +
        '<li>Une fois le projet créé, reviens sur la page <strong>aistudio.google.com/apikey</strong> et relance « Create API key » : cette fois, choisis <strong>« Importer un projet »</strong> et sélectionne le projet que tu viens de créer.</li>' +
        '<li>Ta clé s\'affiche à l\'écran (<code>AIzaSy…</code>). Copie-la.</li>' +
        '<li>Colle-la dans le champ ci-dessous, puis clique sur <strong>Enregistrer</strong>.</li>' +
        '</ol>' +
        '<p style="font-size:12px;color:var(--text-muted);margin:12px 0 16px">Si malgré tout ça bloque encore sur une erreur de permission, va d\'abord sur console.cloud.google.com avec ce compte pour accepter les conditions d\'utilisation, puis réessaie. Ta clé est stockée uniquement dans ce navigateur, envoyée uniquement à l\'API Google, et seulement utilisée si la clé principale est complètement à quota.</p>' +
        '<form onsubmit="App.saveBackupApiKey(event)">' +
        '<div class="field"><label>Colle ta clé API de secours ici</label><input name="apiKey" type="password" placeholder="AIzaSy..." value="' + esc(getBackupApiKey()) + '" autocomplete="off" autofocus></div>' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button><button type="submit" class="btn btn-primary">Enregistrer</button></div>' +
        '</form>';
    } else if (modal.type === "settings") {
      var storageInfo = storageUsageInfo();
      var storageBarHtml;
      if (storageInfo.estimating) {
        storageBarHtml = '<div class="storage-bar-label">Calcul de l\'espace utilisé…</div>';
      } else {
        var storageTier = storageInfo.pct < 60 ? "ok" : storageInfo.pct < 85 ? "warn" : "danger";
        storageBarHtml = '<div class="storage-bar"><div class="storage-bar-fill storage-bar-' + storageTier + '" style="width:' + storageInfo.pct + '%"></div></div>' +
          '<div class="storage-bar-label">' + formatBytes(storageInfo.usedBytes) + ' utilisés sur ' + formatBytes(storageInfo.quotaBytes) + ' disponibles (' + storageInfo.pct + '%)</div>';
      }
      inner = '<h3>Paramètres</h3>' +
        '<p style="font-size:11.5px;color:var(--text-muted);margin:-10px 0 16px">Version ' + APP_VERSION + '</p>' +
        '<div class="field"><label>Clé API Gemini</label>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
        '<span style="flex:1;font-size:12.5px;color:var(--text-muted)">' + (getApiKey() ? "Clé enregistrée" : "Aucune clé enregistrée") + '</span>' +
        '<button type="button" class="btn btn-sm btn-ghost" style="width:auto" onclick="App.closeModal();App.openApiKeyModal()">🔑 ' + (getApiKey() ? "Modifier" : "Ajouter") + '</button>' +
        '</div></div>' +
        '<div class="field"><label>Clé API de secours (optionnel)</label>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
        '<span style="flex:1;font-size:12.5px;color:var(--text-muted)">' + (getBackupApiKey() ? "Clé enregistrée" : "Aucune clé enregistrée") + '</span>' +
        '<button type="button" class="btn btn-sm btn-ghost" style="width:auto" onclick="App.closeModal();App.openBackupApiKeyModal()">🔑 ' + (getBackupApiKey() ? "Modifier" : "Ajouter") + '</button>' +
        '</div>' +
        '<p class="modal-warn" style="margin:6px 0 0">Utilisée automatiquement si ta clé principale atteint sa limite gratuite quotidienne — crée-la avec un autre compte Google.</p>' +
        '</div>' +
        '<div class="field"><label>Stockage utilisé</label>' + storageBarHtml + '</div>' +
        '<div class="field"><label>Sauvegarde de tes données</label>' +
        '<div style="display:flex;gap:8px">' +
        '<button type="button" class="btn btn-sm btn-ghost" style="width:auto" onclick="App.exportBackup()">⬇️ Exporter</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" style="width:auto" onclick="document.getElementById(\'import-backup-input\').click()">⬆️ Importer</button>' +
        '<input type="file" id="import-backup-input" accept="application/json" style="display:none" onchange="App.importBackupFile(event)">' +
        '</div>' +
        '<p class="modal-warn" style="margin:6px 0 0">Exporte un fichier pour récupérer tes comptes et données sur une autre adresse ou un autre appareil. Importer un fichier remplace toutes les données de ce navigateur.</p>' +
        '</div>' +
        '<div class="theme-row" style="margin-bottom:16px"><span class="theme-label">Mode sombre</span><button class="switch" onclick="App.toggleTheme()" aria-label="Basculer le thème"></button></div>' +
        (function () {
          var swatchHex = { vert: "#4C8C4A", bleu: "#2F7FC1", jaune: "#D9A51B", rose: "#D44C80", violet: "#7A4FC4", rouge: "#D14B35", orange: "#E8862B" };
          var current = document.documentElement.getAttribute("data-app-color") || "vert";
          return '<div class="field"><label>Couleur du site</label><div class="color-swatches">' +
            APP_COLORS.map(function (c) {
              return '<button type="button" class="color-swatch' + (c === current ? " selected" : "") + '" style="background:' + swatchHex[c] + '" title="' + APP_COLOR_LABELS[c] + '" aria-label="' + APP_COLOR_LABELS[c] + '" onclick="App.setAppColor(\'' + c + '\')"></button>';
            }).join("") + '</div></div>';
        })() +
        '<div class="field"><label>Ton genre</label><select onchange="App.setUserGender(this.value)">' +
        '<option value="" ' + (getUserGender() === "" ? "selected" : "") + '>Non précisé</option>' +
        '<option value="m" ' + (getUserGender() === "m" ? "selected" : "") + '>Masculin</option>' +
        '<option value="f" ' + (getUserGender() === "f" ? "selected" : "") + '>Féminin</option>' +
        '<option value="autre" ' + (getUserGender() === "autre" ? "selected" : "") + '>Autre</option>' +
        '</select>' +
        '<p class="modal-warn" style="margin:6px 0 0">Utilisé par le vieux conteur du Podcast pour s\'adresser à toi naturellement ("mon petit"/"ma petite").</p></div>' +
        '<div class="theme-row" style="margin-bottom:6px"><span class="theme-label">Rappel de révision</span><button class="switch ' + (getReminderEnabled() ? "switch-on" : "") + '" onclick="App.toggleReminder()" aria-label="Activer le rappel"></button></div>' +
        '<p class="modal-warn" style="margin:0 0 16px">Notification du navigateur s\'il te reste une session Mission Contrôle à faire aujourd\'hui — seulement quand Studino est ouvert (pas de vraie notification en arrière-plan sans appli).</p>' +
        '<div class="field"><label>Volume musique — <span id="vol-music-val">' + getVolumeMusic() + '</span>%</label>' +
        '<input type="range" min="0" max="100" value="' + getVolumeMusic() + '" oninput="document.getElementById(\'vol-music-val\').textContent=this.value;App.setVolumeMusic(this.value)"></div>' +
        '<div class="field"><label>Volume effets sonores — <span id="vol-sfx-val">' + getVolumeSfx() + '</span>%</label>' +
        '<input type="range" min="0" max="100" value="' + getVolumeSfx() + '" oninput="document.getElementById(\'vol-sfx-val\').textContent=this.value;App.setVolumeSfx(this.value)" onchange="App.previewSfxVolume()"></div>' +
        '<p class="modal-warn" style="margin-top:2px">Aucune musique de fond n\'est disponible pour l\'instant — ce réglage s\'appliquera dès qu\'une musique sera ajoutée.</p>' +
        '<div class="modal-actions"><button type="button" class="btn btn-primary" style="width:100%" onclick="App.closeModal()">Fermer</button></div>';
    } else if (modal.type === "dinoFiche") {
      var fd = dpDinosaurById(modal.dinoId);
      if (fd) {
        dpTick(fd);
        var fsp = dpSpecies(fd.speciesId);
        var frarity = DP_RARITY[fsp.rarity];
        var fhunger = dpHunger(fd), fhealth = dpHealth(fd), fhappy = dpHappiness(fd);
        var fneed = fhealth < DP_HEALTH_ALERT && fhunger < DP_HUNGER_ALERT ? "both" : fhealth < DP_HEALTH_ALERT ? "sick" : fhunger < DP_HUNGER_ALERT ? "hungry" : null;
        var fneedBanner = fneed ? '<p style="text-align:center;color:var(--danger);font-weight:700;font-size:12.5px;margin:-4px 0 14px">' + (fneed === "both" ? "⚠️ A faim et malade !" : fneed === "sick" ? "🤒 Ce dino est malade !" : "🍖 Ce dino a faim !") + '</p>' : '';
        var freeEncs = fd.enclosureId ? [] : dpEnclosuresAvailableFor(fd);
        var fdp = dpData();
        var portionsNeeded = dpFoodPortionsNeeded(fsp.weightKg);
        var inventoryPanel = '<div class="dp-care-shop"><div class="dp-care-title">🎒 Inventaire</div>' +
          '<div class="dp-care-group"><div class="dp-care-group-label">Nourriture — ' + portionsNeeded + ' portions par repas</div><div class="dp-care-row">' +
          DP_FOOD_ITEMS.map(function (it) {
            var have = fdp.inventory[it.id] || 0;
            var can = have >= portionsNeeded;
            var matches = fsp.diet === "omnivore" || fsp.diet === it.diet;
            return '<button type="button" class="dp-care-item' + (matches ? " dp-care-match" : "") + '" ' + (can ? "" : "disabled") + ' onclick="App.dpFeedDino(\'' + fd.id + '\',\'' + it.id + '\')" title="' + (matches ? "Convient à ce régime" : "Ne convient pas à ce régime — risque de maladie") + '"><span class="dp-care-emoji">' + (it.unitImg ? '<img src="' + it.unitImg + '" alt="">' : it.emoji) + '</span><span>' + esc(it.name) + '</span><span class="dp-care-price mono">' + have + ' en stock</span></button>';
          }).join("") + '</div></div>' +
          '<div class="dp-care-group"><div class="dp-care-group-label">Soins</div><div class="dp-care-row">' +
          DP_MEDICINE_ITEMS.map(function (it) {
            var have = fdp.inventory[it.id] || 0;
            var can = have >= 1;
            return '<button type="button" class="dp-care-item" ' + (can ? "" : "disabled") + ' onclick="App.dpUseCare(\'' + fd.id + '\',\'' + it.id + '\')"><span class="dp-care-emoji">' + (it.unitImg ? '<img src="' + it.unitImg + '" alt="">' : it.emoji) + '</span><span>' + esc(it.name) + '</span><span class="dp-care-price mono">' + have + ' en stock</span></button>';
          }).join("") + '</div></div>' +
          '<p class="modal-warn" style="margin-top:10px">Achète des caisses chez le marchand d\'objets pour remplir ton inventaire.</p></div>';
        inner = dpSquareHtml(fsp.id, { kind: "face", style: "width:96px;height:96px;margin:0 auto 14px;display:block" }) +
          '<h3 style="text-align:center">' + esc(fd.name) + '</h3>' +
          '<p style="text-align:center;color:var(--text-muted);font-size:12.5px;margin:-10px 0 18px">' + esc(fsp.name) + ' · ' + frarity.label + ' · ' + (fd.sex === "M" ? "Mâle" : "Femelle") + ' · ' + dpAgeLabel(fd) + '</p>' +
          fneedBanner +
          '<div class="dp-stat"><span>Santé</span><div class="dp-bar"><div class="dp-bar-fill" style="width:' + fhealth + '%;background:var(--success)"></div></div><span class="mono">' + fhealth + '%</span></div>' +
          '<div class="dp-stat"><span>Faim</span><div class="dp-bar"><div class="dp-bar-fill" style="width:' + fhunger + '%;background:var(--accent)"></div></div><span class="mono">' + fhunger + '%</span></div>' +
          '<div class="dp-stat"><span>Bonheur</span><div class="dp-bar"><div class="dp-bar-fill" style="width:' + fhappy + '%;background:var(--leaf)"></div></div><span class="mono">' + fhappy + '%</span></div>' +
          '<p style="font-size:12.5px;color:var(--text-muted);margin:14px 0">Régime : ' + esc(fsp.diet) + ' · Poids adulte : ' + dpWeightLabel(fsp.weightKg) + ' · Habitat : ' + esc(dpZone(fsp.zone).name) + '</p>' +
          (fd.enclosureId
            ? inventoryPanel
            : '<p style="text-align:center;color:var(--danger);font-weight:700;font-size:12.5px;margin:-4px 0 14px">⏳ Il mourra dans ' + dpFormatCountdown(DP_HATCH_PLACEMENT_LIMIT - (Date.now() - fd.bornAt)) + ' s\'il n\'est pas placé dans un enclos</p>' +
              '<div class="field"><label>Placer dans un enclos</label><select onchange="App.dpPlaceDino(\'' + fd.id + '\', this.value)"><option value="">Choisir un enclos…</option>' + freeEncs.map(function (e) { return '<option value="' + e.id + '">' + esc(dpEnclosureDisplayName(e)) + '</option>'; }).join("") + '</select>' + (freeEncs.length ? "" : '<p class="modal-warn" style="margin-top:8px">Construis un enclos (ou trouve-en un avec la même espèce et de la place) dans la zone ' + esc(dpZone(fsp.zone).name) + ' pour l\'installer.</p>') + '</div>') +
          '<div class="modal-actions"><button type="button" class="btn btn-ghost" style="width:100%" onclick="App.closeModal()">Fermer</button></div>';
      }
    } else if (modal.type === "companion") {
      var dp2 = dpData();
      var seenSpecies = {};
      var speciesOwned = [];
      dp2.dinosaurs.forEach(function (d) {
        if (seenSpecies[d.speciesId]) { seenSpecies[d.speciesId].count++; return; }
        var entry = { speciesId: d.speciesId, count: 1 };
        seenSpecies[d.speciesId] = entry;
        speciesOwned.push(entry);
      });
      inner = '<h3>Choisis ton compagnon d\'étude</h3>' +
        '<p class="modal-warn" style="margin-bottom:14px">Un compagnon par espèce — il t\'accompagnera pendant les quiz et exercices.</p>' +
        '<div class="dp-subject-grid">' +
        '<div class="dp-subject-card' + (dp2.companionSpeciesId ? "" : " dp-subject-card-active") + '" style="cursor:pointer;text-align:center" onclick="App.setCompanion(null)">Aucun</div>' +
        speciesOwned.map(function (row) {
          var dsp = dpSpecies(row.speciesId);
          return '<div class="dp-subject-card' + (dp2.companionSpeciesId === row.speciesId ? " dp-subject-card-active" : "") + '" style="cursor:pointer;text-align:center" onclick="App.setCompanion(\'' + row.speciesId + '\')">' +
            dpSquareHtml(row.speciesId, { kind: "face", style: "width:56px;height:56px;margin:0 auto 6px;display:block" }) +
            '<div style="font-weight:700;font-size:12.5px">' + esc(dsp ? dsp.name : "") + '</div>' +
            (row.count > 1 ? '<div style="font-size:10px;color:var(--text-muted)">×' + row.count + '</div>' : '') +
            '</div>';
        }).join("") +
        '</div>' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" style="width:100%" onclick="App.closeLightModal()">Fermer</button></div>';
    } else if (modal.type === "errorDetail") {
      inner = '<h3>Détail de l\'erreur</h3>' +
        (modal.status ? '<p class="modal-warn" style="margin-bottom:10px">Code HTTP : <strong>' + esc(String(modal.status)) + '</strong></p>' : '') +
        '<pre class="error-detail-pre">' + esc(modal.detail || "Aucun détail disponible.") + '</pre>' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Fermer</button></div>';
    } else if (modal.type === "downloadCourse") {
      inner = '<h3>Télécharger ce cours en PDF</h3>' +
        '<div class="field"><label>Taille du texte</label><div class="print-scale-ctrl" title="Taille de la police à l\'impression"><button type="button" class="btn btn-ghost btn-sm" style="width:auto;padding:4px 10px" onclick="App.adjustPrintScale(-0.1)">−</button><span class="mono" style="min-width:42px;text-align:center;display:inline-block">' + Math.round(getPrintScale() * 100) + '%</span><button type="button" class="btn btn-ghost btn-sm" style="width:auto;padding:4px 10px" onclick="App.adjustPrintScale(0.1)">+</button></div></div>' +
        '<p class="modal-warn" style="margin-bottom:10px">Inclure aussi l\'explication en plus de la retranscription ?</p>' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>' +
        '<button type="button" class="btn btn-ghost" onclick="App.confirmDownloadCoursePdf(\'' + modal.courseId + '\', false)">Juste la retranscription</button>' +
        '<button type="button" class="btn btn-primary" onclick="App.confirmDownloadCoursePdf(\'' + modal.courseId + '\', true)">+ l\'explication</button></div>';
    } else if (modal.type === "revisionSheetRaw") {
      inner = '<h3>Texte brut de la fiche (Markdown généré par l\'IA)</h3>' +
        '<p class="modal-warn" style="margin-bottom:10px">Vue de debug : exactement ce que l\'IA a renvoyé, avant mise en forme.</p>' +
        '<pre class="error-detail-pre">' + esc(modal.content || "(vide)") + '</pre>' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Fermer</button></div>';
    } else if (modal.type === "latex") {
      var latexNavBtn = function (dir, label, title) {
        return '<button type="button" class="rte-btn latex-nav-btn" title="' + title + '" onmousedown="event.preventDefault()" onclick="App.latexMove(\'' + dir + '\')">' + label + '</button>';
      };
      inner = '<h3>Insérer une formule</h3>' +
        '<p class="modal-warn" style="margin-bottom:10px">Compose ta formule avec le clavier ci-dessous — pas besoin de connaître de code.</p>' +
        '<math-field id="latex-mathfield" class="latex-mathfield"></math-field>' +
        '<div class="latex-nav-row">' +
        latexNavBtn("left", "←", "Aller à gauche") +
        latexNavBtn("up", "↑", "Monter (ex. sortir d'un exposant, aller au numérateur)") +
        latexNavBtn("down", "↓", "Descendre (ex. aller au dénominateur)") +
        latexNavBtn("right", "→", "Aller à droite") +
        latexNavBtn("backspace", "⌫", "Effacer") +
        '</div>' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeLightModal()">Annuler</button><button type="button" class="btn btn-primary" onclick="App.insertLatexFormula()">Insérer</button></div>';
    } else if (modal.type === "periodic") {
      inner = '<h3>Tableau périodique</h3>' +
        periodicGridHtml() +
        periodicLegendHtml() +
        (modal.selected ? periodicDetailHtml(modal.selected) : '<p class="modal-warn" style="margin:10px 0 0">Clique sur un élément pour voir ses infos.</p>') +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" style="width:100%" onclick="App.closeLightModal()">Fermer</button></div>';
    } else if (modal.type === "table") {
      inner = '<h3>Insérer un tableau</h3>' +
        '<form onsubmit="App.insertTable(event)">' +
        '<div class="field"><label>Nombre de lignes</label><input type="number" name="rows" min="1" max="20" value="3" required autofocus></div>' +
        '<div class="field"><label>Nombre de colonnes</label><input type="number" name="cols" min="1" max="12" value="3" required></div>' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeLightModal()">Annuler</button><button type="submit" class="btn btn-primary">Insérer</button></div>' +
        '</form>';
    }
    overlay.innerHTML = '<div class="modal' + (isTool ? " modal-tool" : "") + (modal.type === "latex" || modal.type === "calEvent" || modal.type === "periodic" || modal.type === "apiKeyGuide" || modal.type === "backupApiKeyGuide" || modal.type === "confirmImportBackup" ? " modal-wide" : "") + (modal.type === "periodic" ? " modal-periodic" : "") + '">' + inner + '</div>';
    document.body.appendChild(overlay);
  }

  // Duplication de thème/chapitre : copie profonde avec de nouveaux id pour tout ce qui est référencé
  // par id ailleurs (cours, flashcards, questions, exercices), sinon le doublon et l'original
  // partageraient le même id et deviendraient indiscernables/introuvables individuellement. Les id des
  // figures restent INCHANGÉS exprès : ils sont référencés par des jetons "![légende](figure:ID)" DANS
  // le texte de transcription/explication copié avec le reste — les régénérer casserait ces références.
  function cloneCourseWithNewIds(co) {
    var clone = JSON.parse(JSON.stringify(co));
    clone.id = uid();
    (clone.flashcards || []).forEach(function (f) { f.id = uid(); });
    (clone.quizQuestions || []).forEach(function (q) { q.id = uid(); });
    (clone.exercises || []).forEach(function (e) { e.id = uid(); });
    return clone;
  }
  function cloneChapterWithNewIds(c) {
    var clone = JSON.parse(JSON.stringify(c));
    clone.id = uid();
    clone.courses = (c.courses || []).map(cloneCourseWithNewIds);
    return clone;
  }
  function cloneThemeWithNewIds(t) {
    var clone = JSON.parse(JSON.stringify(t));
    clone.id = uid();
    clone.chapters = (t.chapters || []).map(cloneChapterWithNewIds);
    return clone;
  }

