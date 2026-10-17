"use strict";
// Studino — routeur et démarrage
// Fichier chargé dans l'ordre par index.html : les fichiers partagent les mêmes variables globales.

  /* ---------------- Root render / router ---------------- */
  function render() {
    // Le nettoyage des overlays passe AVANT tout le reste (et hors du try/catch) : même si une erreur
    // survient plus loin dans le rendu de la page, une modale ouverte ne doit jamais rester bloquée à
    // l'écran alors que l'action a déjà eu lieu (ex. génération d'un cours démarrée en arrière-plan).
    document.querySelectorAll(".modal-overlay").forEach(function (el) { el.remove(); });
    document.querySelectorAll(".dp-merchant-overlay").forEach(function (el) { el.remove(); });
    try {
      dtStopWalkLoop();
      if (!DB.currentUser) { renderAuth(parseHash()[0] === "signup" ? "signup" : "login"); return; }
      // L'appli est un simple site statique sans clé partagée : chaque visiteur doit fournir la sienne
      // (gratuite) pour que la génération fonctionne chez lui. Sans ce guide, quelqu'un qui découvre
      // Studino sans savoir ce qu'est une "clé API Gemini" se retrouve juste avec des boutons qui ne
      // font rien. Ne se déclenche qu'une fois par chargement de page (pas à chaque render), pour ne
      // pas rouvrir la modale en boucle si l'utilisateur la ferme sans ajouter de clé.
      if (!getApiKey() && !apiKeyGuideShown) {
        apiKeyGuideShown = true;
        if (!modal) modal = { type: "apiKeyGuide" };
      }
      var parts = parseHash();
      if (parts.length === 0) { renderDashboard(); return; }
      if (parts[0] === "subject" && parts[1] && parts[2] === "theme" && parts[3] && parts[4] === "chapter" && parts[5]) { renderChapterPage(parts[1], parts[3], parts[5]); return; }
      if (parts[0] === "subject" && parts[1] && parts[2] === "theme" && parts[3]) { renderThemePage(parts[1], parts[3]); return; }
      if (parts[0] === "subject" && parts[1]) { renderSubjectPage(parts[1]); return; }
      if (parts[0] === "course" && parts[1]) { renderCoursePage(parts[1], parts[2]); return; }
      if (parts[0] === "exercices" && parts[1]) { renderImportedExercisePage(parts[1]); return; }
      if (parts[0] === "exercices") { renderImportedExercisesPage(); return; }
      if (parts[0] === "dinopark") { renderDinoParkPage(); return; }
      if (parts[0] === "dinotime") { renderDinoTimePage(); return; }
      if (parts[0] === "revision" && parts[1]) { renderRevisionSheetPage(parts[1]); return; }
      if (parts[0] === "examprep" && parts[1]) { renderExamPrepDetailPage(parts[1]); return; }
      if (parts[0] === "examprep") { renderExamPrepListPage(); return; }
      if (parts[0] === "methodologies" && parts[1]) { renderMethodologyDetailPage(parts[1]); return; }
      if (parts[0] === "methodologies") { renderMethodologyListPage(); return; }
      if (parts[0] === "today") { renderTodayPage(); return; }
      if (parts[0] === "review") { renderReviewPage(); return; }
      if (parts[0] === "calendar") { renderCalendarPage(); return; }
      if (parts[0] === "podcasts" && parts[1] === "lib") { renderPodcastLibraryPage(parts[2], parts[3], parts[4]); return; }
      if (parts[0] === "podcasts" && parts[1]) { renderPodcastDetailPage(parts[1]); return; }
      if (parts[0] === "podcasts") { renderPodcastListPage(); return; }
      renderDashboard();
    } catch (err) {
      console.error("Erreur de rendu :", err);
      toast("Un problème d'affichage est survenu — réessaie ou recharge la page.");
    }
  }

  var APP_COLORS = ["vert", "bleu", "jaune", "rose", "violet", "rouge", "orange"];
  var APP_COLOR_LABELS = { vert: "Vert", bleu: "Bleu", jaune: "Jaune", rose: "Rose", violet: "Violet", rouge: "Rouge", orange: "Orange" };
  (function initTheme() {
    var saved = localStorage.getItem("recto_theme");
    var theme = saved || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-app-theme", theme);
    var savedColor = localStorage.getItem("recto_color");
    document.documentElement.setAttribute("data-app-color", APP_COLORS.indexOf(savedColor) !== -1 ? savedColor : "vert");
  })();

  // Le chargement de la base (IndexedDB, potentiellement avec migration depuis l'ancien localStorage
  // au tout premier lancement) est asynchrone : on affiche un écran d'attente le temps que ça charge,
  // puis on démarre le routeur/rendu normalement — aucune interaction n'est possible avant coup.
  // Appli installable sur l'écran d'accueil (téléphone / ordinateur).
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function (err) { console.warn("Service worker :", err); }); });
  }
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); installPromptEvent = e; });
  window.addEventListener("appinstalled", function () { installPromptEvent = null; toast("📲 Studino est installé sur ton écran d'accueil !"); });

  var appEl = document.getElementById("app");
  if (appEl) appEl.innerHTML = '<div class="processing-box" style="min-height:100vh;justify-content:center">' + genLogo() + '<span>Chargement…</span></div>';
  initDB().then(function () { markInterruptedPodcasts(); return hydratePodcastAudio().catch(function (err) { console.error("Audio des podcasts :", err); }).then(function () { return hydrateFigureImages().catch(function (err) { console.error("Images des schémas :", err); }); }); }).then(function () {
    window.addEventListener("hashchange", render);
    window.addEventListener("resize", syncTopbarHeightVar);
    // À l'ouverture de l'appli, on arrive sur « Aujourd'hui » (le Menu reste à un clic).
    if (DB.currentUser && (!location.hash || location.hash === "#" || location.hash === "#/")) history.replaceState(null, "", "#/today");
    // Demande au navigateur de ne pas effacer nos données en cas de manque de place.
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    render();
    if (DB.currentUser && backupNeeded()) setTimeout(function () { toast("💾 Pense à sauvegarder tes données (page Aujourd'hui)"); }, 2500);
    if (DB.currentUser) checkRevisionReminder();

    setInterval(function () {
      if (!DB.currentUser) return;
      ["dp-shop-timer", "dp-shop-timer-mini"].forEach(function (elId) {
        var el = document.getElementById(elId);
        if (!el) return;
        var zoneId = el.getAttribute("data-zone");
        var shop = dpData().shops[zoneId];
        if (!shop) return;
        var remain = shop.expiresAt - Date.now();
        if (remain <= 0) { render(); return; }
        el.textContent = "⏳ " + dpFormatCountdown(remain);
      });
      document.querySelectorAll(".dp-inc-timer").forEach(function (el) {
        var i = +el.getAttribute("data-slot");
        var inc = dpData().incubators[i];
        if (!inc) { render(); return; }
        var sp = dpSpecies(inc.speciesId);
        if (!sp) return;
        var rarity = DP_RARITY[sp.rarity];
        var remain = rarity.hatch * 1000 - (Date.now() - inc.startedAt);
        if (remain <= 0) { render(); return; }
        el.textContent = "⏳ " + dpFormatCountdown(remain);
      });
      if (epSession && epSession.startedAt && !epSession.done) {
        var epTimerEl = document.getElementById("ep-session-timer");
        if (epTimerEl) epTimerEl.textContent = "⏱️ " + dpFormatCountdown(Date.now() - epSession.startedAt);
      }
    }, 1000);
  });
