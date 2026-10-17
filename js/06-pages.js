"use strict";
// Studino — barre latérale et pages
// Fichier chargé dans l'ordre par index.html : les fichiers partagent les mêmes variables globales.

  /* ---------------- Sidebar / Shell ---------------- */
  function breadcrumbTrail(parts) {
    var trail = [{ label: "Menu", hash: "#/" }];
    if (parts[0] === "subject" && parts[1]) {
      var s = findSubject(parts[1]);
      if (s) trail.push({ label: s.name, hash: "#/subject/" + s.id });
      if (parts[2] === "theme" && parts[3]) {
        var th = findTheme(s, parts[3]);
        if (th) trail.push({ label: th.name, hash: "#/subject/" + s.id + "/theme/" + th.id });
        if (parts[4] === "chapter" && parts[5]) {
          var c = findChapter(th, parts[5]);
          if (c) trail.push({ label: c.name, hash: "#/subject/" + s.id + "/theme/" + th.id + "/chapter/" + c.id });
        }
      }
    } else if (parts[0] === "course" && parts[1]) {
      var loc = locateCourse(parts[1]);
      if (loc) {
        trail.push({ label: loc.subject.name, hash: "#/subject/" + loc.subject.id });
        trail.push({ label: loc.theme.name, hash: "#/subject/" + loc.subject.id + "/theme/" + loc.theme.id });
        trail.push({ label: loc.chapter.name, hash: "#/subject/" + loc.subject.id + "/theme/" + loc.theme.id + "/chapter/" + loc.chapter.id });
        trail.push({ label: loc.course.title, hash: "#/course/" + loc.course.id });
        var tabNames = { transcription: "Retranscription", explication: "Explication", videos: "Vidéos", flashcards: "Flashcards", quiz: "Contrôle" };
        var tab = parts[3] || "transcription";
        trail.push({ label: tabNames[tab] || tab });
      }
    } else if (parts[0] === "exercices") {
      trail.push({ label: "Mes exercices", hash: "#/exercices" });
      if (parts[1]) {
        var ie = userData().importedExercises.find(function (x) { return x.id === parts[1]; });
        if (ie) trail.push({ label: ie.title });
      }
    } else if (parts[0] === "dinopark") {
      trail.push({ label: "Dino Park", action: "App.dpGoHub()" });
      if (dpView.mode === "zone") { var z = dpZone(dpView.zoneId); if (z) trail.push({ label: z.name }); }
      else if (dpView.mode === "lab") trail.push({ label: "Laboratoire" });
      else if (dpView.mode === "encyclopedia") trail.push({ label: "Encyclopédie" });
      else if (dpView.mode === "quiz") trail.push({ label: "Questions" });
    } else if (parts[0] === "dinotime") {
      trail.push({ label: "DinoTime" });
    } else if (parts[0] === "revision" && parts[1]) {
      var rs = userData().revisionSheets.find(function (x) { return x.id === parts[1]; });
      if (rs) trail.push({ label: rs.title });
    } else if (parts[0] === "examprep") {
      trail.push({ label: "Mission Contrôle", hash: "#/examprep" });
      if (parts[1]) {
        var ep = epFind(parts[1]);
        if (ep) trail.push({ label: ep.title });
      }
    } else if (parts[0] === "methodologies") {
      trail.push({ label: "Méthodologie", hash: "#/methodologies" });
      if (parts[1]) {
        var meth = methodoFind(parts[1]);
        if (meth) trail.push({ label: meth.title });
      }
    } else if (parts[0] === "today") {
      trail.push({ label: "Aujourd'hui" });
    } else if (parts[0] === "review") {
      trail.push({ label: "Aujourd'hui", hash: "#/today" });
      trail.push({ label: "Flashcards" });
    } else if (parts[0] === "calendar") {
      trail.push({ label: "Calendrier" });
    } else if (parts[0] === "podcasts") {
      trail.push({ label: "Podcast", hash: "#/podcasts" });
      if (parts[1] === "lib") {
        trail.push({ label: "Mes podcasts", hash: "#/podcasts/lib" });
        var ps = parts[2] ? findSubject(parts[2]) : null;
        if (ps) trail.push({ label: ps.name, hash: "#/podcasts/lib/" + ps.id });
        var pt = ps && parts[3] ? findTheme(ps, parts[3]) : null;
        if (pt) trail.push({ label: pt.name, hash: "#/podcasts/lib/" + ps.id + "/" + pt.id });
        var pc = pt && parts[4] ? findChapter(pt, parts[4]) : null;
        if (pc) trail.push({ label: pc.name });
      } else if (parts[1]) {
        var pod = podcastFind(parts[1]);
        if (pod) trail.push({ label: pod.title });
      }
    }
    return trail;
  }

  function renderBreadcrumb(parts) {
    var trail = breadcrumbTrail(parts);
    var out = "";
    trail.forEach(function (t, i) {
      if (i > 0) out += '<span class="sep">/</span>';
      if (i < trail.length - 1 && (t.hash || t.action)) out += '<button onclick="' + (t.action || ("location.hash='" + t.hash + "'")) + '">' + esc(t.label) + '</button>';
      else out += '<span class="current">' + esc(t.label) + '</span>';
    });
    return out;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderShell(parts, contentHtml, opts) {
    opts = opts || {};
    var user = DB.currentUser;
    var theme = document.documentElement.getAttribute("data-app-theme") || "light";
    var html = '<div class="shell">' +
      '<aside class="sidebar' + (mobileNavOpen ? " sidebar-open" : "") + '">' +
      '<div class="sidebar-top"><div class="wordmark" style="font-size:13px"><img src="assets/objects/ui/DinoPark.png" alt="" style="width:20px;height:20px;object-fit:contain;margin-right:4px;vertical-align:-4px;">Studino<span class="dot">.</span></div>' +
      '<button class="icon-btn" title="Nouvelle matière" onclick="App.closeMobileNav();App.openModal(\'subject\')" style="background:none;border:1px solid var(--border);border-radius:7px;padding:5px;cursor:pointer;color:var(--text)">' + icon("plus") + '</button>' +
      '<button class="mobile-nav-close" onclick="App.toggleMobileNav()" aria-label="Fermer le menu">✕</button>' +
      '</div>' +
      '<button class="nav-item ' + (parts[0] === "today" || parts[0] === "review" ? "active" : "") + '" onclick="App.closeMobileNav();location.hash=\'#/today\'"><span class="nav-icon-img nav-icon-emoji" aria-hidden="true">☀️</span> Aujourd\'hui</button>' +
      '<button class="nav-item ' + (parts.length === 0 ? "active" : "") + '" onclick="App.closeMobileNav();location.hash=\'#/\'"><img class="nav-icon-img" src="assets/objects/ui/Menu.png" alt=""> Menu</button>' +
      '<button class="nav-item ' + (parts[0] === "exercices" ? "active" : "") + '" onclick="App.closeMobileNav();location.hash=\'#/exercices\'"><img class="nav-icon-img" src="assets/objects/ui/MesExos.png" alt=""> Mes exercices</button>' +
      '<button class="nav-item ' + (parts[0] === "dinopark" ? "active" : "") + '" onclick="App.closeMobileNav();App.dpGoHub()"><img class="nav-icon-img" src="assets/objects/ui/DinoPark.png" alt=""> Dino Park' + (dpAttentionList().length ? '<span class="nav-alert-dot" title="Des dinos ont besoin d\'attention"></span>' : '') + '</button>' +
      '<button class="nav-item ' + (parts[0] === "dinotime" ? "active" : "") + '" onclick="App.closeMobileNav();App.dtGoDinoTime()"><img class="nav-icon-img" src="assets/objects/ui/DinoTime.png" alt=""> DinoTime</button>' +
      '<button class="nav-item ' + (parts[0] === "examprep" ? "active" : "") + '" onclick="App.closeMobileNav();location.hash=\'#/examprep\'"><img class="nav-icon-img" src="assets/objects/ui/MissionControle.png" alt=""> Mission Contrôle</button>' +
      '<button class="nav-item ' + (parts[0] === "methodologies" ? "active" : "") + '" onclick="App.closeMobileNav();location.hash=\'#/methodologies\'"><img class="nav-icon-img" src="assets/objects/ui/Méthodologie.png" alt=""> Méthodologie</button>' +
      '<button class="nav-item ' + (parts[0] === "podcasts" ? "active" : "") + '" onclick="App.closeMobileNav();location.hash=\'#/podcasts\'"><img class="nav-icon-img" src="assets/objects/ui/Podcast.png" alt=""> Podcast</button>' +
      '<button class="nav-item ' + (parts[0] === "calendar" ? "active" : "") + '" onclick="App.closeMobileNav();location.hash=\'#/calendar\'"><img class="nav-icon-img" src="assets/objects/ui/Calendrier.png" alt=""> Calendrier</button>' +
      '<div class="sidebar-bottom">' +
      '<div class="theme-row"><span class="theme-label">Paramètres</span><button class="btn btn-sm btn-ghost" style="width:auto" onclick="App.closeMobileNav();App.openSettingsModal()">⚙️ Ouvrir</button></div>' +
      '<div class="user-row"><div class="avatar">' + esc(user.slice(0, 1).toUpperCase()) + '</div><div><div class="user-name">' + esc(user) + '</div><button class="logout-link" onclick="App.logout()">Se déconnecter</button></div></div>' +
      '</div>' +
      '</aside>' +
      (mobileNavOpen ? '<div class="sidebar-backdrop" onclick="App.toggleMobileNav()"></div>' : '') +
      '<div class="main">' +
      '<div class="topbar"><button class="mobile-nav-toggle" onclick="App.toggleMobileNav()" aria-label="Menu">☰</button><div class="breadcrumb">' + renderBreadcrumb(parts) + '</div>' + (parts[0] === "dinopark" ? '<div class="topbar-points mono">🪙 <span class="dp-points-value">' + dpData().points + '</span></div>' : '') + '</div>' +
      '<div class="content' + (opts.narrow ? " content-narrow" : "") + '">' + contentHtml + '</div>' +
      '</div></div>';
    document.getElementById("app").innerHTML = html;
    syncTopbarHeightVar();
    if (modal) renderModal();
    if (dpMerchantZone) renderMerchantOverlay();
    renderMath();
  }
  function syncTopbarHeightVar() {
    var tb = document.querySelector(".topbar");
    if (tb) document.documentElement.style.setProperty("--topbar-h", tb.offsetHeight + "px");
  }

  function renderMerchantOverlay() {
    var zoneId = dpMerchantZone;
    var zone = dpZone(zoneId);
    if (!zone) { dpMerchantZone = null; return; }
    var dp = dpData();
    var bgPath = dpMerchantArtPath(zoneId);
    var overlay = document.createElement("div");
    overlay.className = "dp-merchant-overlay";
    overlay.onclick = function (e) { if (e.target === overlay) App.dpCloseMerchant(); };

    var toolsHtml, tableHtml;
    if (dpMerchantMode === "objects") {
      toolsHtml = '<div class="dp-merchant-tools"><span class="dp-shop-timer mono">🪙 <span class="dp-points-value">' + dp.points + '</span></span></div>';
      tableHtml = renderObjectMerchantTable(dp);
    } else if (dpSellMode) {
      var zoneDinos = dp.dinosaurs.filter(function (d) { var dsp = dpSpecies(d.speciesId); return dsp && dsp.zone === zoneId; });
      toolsHtml = '<div class="dp-merchant-tools">' +
        '<span class="dp-shop-timer mono">🪙 <span class="dp-points-value">' + dp.points + '</span></span>' +
        '<button class="btn btn-sm btn-ghost" onclick="App.dpCancelSellDino()">← Retour aux œufs</button>' +
        '</div>';
      tableHtml = !zoneDinos.length
        ? '<div class="dp-merchant-table"><p class="dp-empty-note">Tu n\'as aucun dino de cette zone à vendre.</p></div>'
        : '<div class="dp-merchant-table">' + zoneDinos.map(function (d) {
          var sp = dpSpecies(d.speciesId);
          var rarity = DP_RARITY[sp.rarity];
          var sellPrice = Math.round(rarity.price / 2);
          var selected = dpSellSelectedDinoId === d.id;
          return '<div class="dp-merchant-card' + (selected ? " dp-merchant-card-selected" : "") + '" onclick="App.dpSelectSellDino(\'' + d.id + '\')">' +
            dpSquareHtml(sp.id, { className: "dp-egg-img" }) +
            '<div class="dp-egg-name">' + esc(d.name) + '</div>' +
            '<div class="dp-rarity dp-rarity-' + sp.rarity + '">' + rarity.label + '</div>' +
            '<div class="dp-egg-price mono">' + sellPrice + ' pts</div>' +
            (selected ? '<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();App.dpConfirmSellDino()">Vendre</button>' : '') +
            '</div>';
        }).join("") + '</div>';
    } else {
      var hasEnclosure = dpEnclosuresInZone(zoneId).length > 0;
      var shopState = dpShop(zoneId);
      var shopItems = shopState.items.map(function (id) { return dpSpecies(id); });
      var canRefresh = dp.points >= DP_SHOP_REFRESH_COST;
      var curSlots = dpShopSlots(zoneId);
      var slotsMaxed = curSlots >= DP_SHOP_SLOTS_MAX;
      var slotCost = slotsMaxed ? 0 : DP_SHOP_SLOT_UPGRADE_COST[curSlots + 1];
      var luckLevel = dpLuckLevel(shopState);
      var luckMaxed = luckLevel >= DP_LUCK_MAX;
      var canLuck = !luckMaxed && dp.points >= DP_SHOP_LUCK_COST;
      var odds = DP_LUCK_ODDS[luckLevel];
      var luckHtml = '<div class="dp-luck-line">' +
        '<span class="dp-luck-main mono">🍀 Chance ' + dpLuckPercent(luckLevel) + ' %</span>' +
        '<span class="dp-luck-pips" aria-label="Niveau ' + luckLevel + ' sur ' + DP_LUCK_MAX + '">' + DP_LUCK_ODDS.slice(1).map(function (_, i) { return '<span class="' + (i < luckLevel ? "on" : "") + '"></span>'; }).join("") + '</span>' +
        ["commun", "rare", "epique", "legendaire"].map(function (r) {
          return '<span class="dp-rarity dp-rarity-' + r + '">' + DP_RARITY[r].label + ' ' + odds[r] + ' %</span>';
        }).join("") +
        '<span class="dp-luck-hint">par case</span>' +
        '</div>';
      toolsHtml = '<div class="dp-merchant-tools">' +
        '<span class="dp-shop-timer mono">🪙 <span class="dp-points-value">' + dp.points + '</span></span>' +
        '<span class="dp-shop-timer mono" id="dp-shop-timer" data-zone="' + zoneId + '">⏳ ' + dpFormatCountdown(shopState.expiresAt - Date.now()) + '</span>' +
        '<button class="btn btn-sm btn-ghost" ' + (canRefresh ? "" : "disabled") + ' onclick="App.dpRefreshShop(\'' + zoneId + '\')">🔄 Rafraîchir (' + DP_SHOP_REFRESH_COST + ' pts)</button>' +
        '<button class="btn btn-sm btn-ghost" ' + (canLuck ? "" : "disabled") + ' onclick="App.dpLuckShop(\'' + zoneId + '\')">' +
        (luckMaxed ? "🍀 Chance max" : "🍀 Chance+ → " + dpLuckPercent(luckLevel + 1) + " % (" + DP_SHOP_LUCK_COST + " pts)") + '</button>' +
        (slotsMaxed
          ? '<button class="btn btn-sm btn-ghost" disabled>🥚 ' + DP_SHOP_SLOTS_MAX + ' œufs (max)</button>'
          : '<button class="btn btn-sm btn-ghost" ' + (dp.points >= slotCost ? "" : "disabled") + ' onclick="App.dpUpgradeShopSlots(\'' + zoneId + '\')">🥚 ' + curSlots + ' → ' + (curSlots + 1) + ' œufs (' + slotCost + ' pts)</button>') +
        '<button class="btn btn-sm btn-ghost" onclick="App.dpStartSellDino()">💰 Vendre des dinos</button>' +
        luckHtml + '</div>';
      tableHtml = '<div class="dp-merchant-table">' +
        shopItems.map(function (sp) {
          var rarity = DP_RARITY[sp.rarity];
          var canBuy = hasEnclosure && dp.points >= rarity.price;
          return '<div class="dp-merchant-card">' +
            dpSquareHtml(sp.id, { className: "dp-egg-img", egg: { zone: zoneId, rarity: sp.rarity } }) +
            '<div class="dp-egg-name">' + esc(sp.name) + '</div>' +
            '<div class="dp-rarity dp-rarity-' + sp.rarity + '">' + rarity.label + '</div>' +
            '<div class="dp-egg-price mono">' + rarity.price + ' pts</div>' +
            '<button class="btn btn-sm ' + (canBuy ? "btn-primary" : "btn-ghost") + '" onclick="App.dpBuyEgg(\'' + zoneId + '\',\'' + sp.id + '\')">Acheter</button>' +
            (hasEnclosure ? "" : '<div class="dp-egg-warn">Enclos requis</div>') +
            '</div>';
        }).join("") +
        '</div>';
    }

    overlay.innerHTML =
      '<div class="dp-merchant-bg" style="background:linear-gradient(180deg,' + zone.color + ',#1a1a1a)">' +
      '<img src="' + bgPath + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
      '<div class="dp-merchant-bg-fallback">' + zone.emoji + '</div>' +
      '</div>' +
      '<button class="dp-merchant-close" onclick="App.dpCloseMerchant()">✕</button>' +
      toolsHtml + tableHtml;
    document.body.appendChild(overlay);
  }

  function renderObjectMerchantTable(dp) {
    function crateCard(it, buyFn, dietLine, qty, qtyLabel) {
      var can = dp.points >= it.price;
      return '<div class="dp-crate-card">' +
        (it.img ? '<img class="dp-crate-img" src="' + it.img + '" alt="' + esc(it.name) + '">' : '<div class="dp-object-icon">' + it.emoji + '</div>') +
        '<div class="dp-crate-tooltip">' +
        '<div class="dp-egg-name">' + esc(it.name) + '</div>' +
        (dietLine ? '<div class="dp-crate-diet">' + dietLine + '</div>' : '') +
        '<div class="dp-crate-qty">Contient ' + qty + ' ' + qtyLabel + '</div>' +
        '<div class="dp-egg-price mono">' + it.price + ' pts</div>' +
        '<button class="btn btn-sm ' + (can ? "btn-primary" : "btn-ghost") + '" onclick="App.' + buyFn + '(\'' + it.id + '\')">Acheter</button>' +
        '</div>' +
        '</div>';
    }

    var foodCards = DP_FOOD_ITEMS.map(function (it) { return crateCard(it, "dpBuyFoodCrate", "🍽️ Pour les " + it.dietLabel.toLowerCase(), DP_PORTIONS_PER_CRATE, "portions"); }).join("");
    var medCards = DP_MEDICINE_ITEMS.map(function (it) { return crateCard(it, "dpBuyCareCrate", null, DP_DOSES_PER_CRATE, "doses"); }).join("");

    return '<div class="dp-merchant-table dp-merchant-table-objects">' + foodCards + medCards + '</div>';
  }

  // Gemini insère parfois \textcolor{...}{...} ou \colorbox{...}{...} dans une formule pour "surligner"
  // un terme — ça rend en vrai fond/texte coloré (souvent un vert foncé peu lisible) qui persiste même
  // en copiant-collant le texte ailleurs. On neutralise ces commandes : elles gardent leur contenu mais
  // perdent tout effet de couleur, dans les deux points d'entrée KaTeX de l'app.
  var KATEX_NO_COLOR_MACROS = {
    "\\textcolor": "#2",
    "\\colorbox": "#2",
    "\\fcolorbox": "#3"
  };
  function renderMath() {
    if (typeof window.renderMathInElement !== "function") return;
    window.renderMathInElement(document.body, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false }
      ],
      throwOnError: false,
      macros: KATEX_NO_COLOR_MACROS,
      preProcess: repairLatexForKatex
    });
  }

  /* ---------------- Dashboard ---------------- */
  function allCourses() {
    var out = [];
    userData().subjects.forEach(function (s) { s.themes.forEach(function (t) { t.chapters.forEach(function (c) { c.courses.forEach(function (co) { out.push(co); }); }); }); });
    return out;
  }
  function computeStats() {
    var courses = allCourses();
    var attempts = [];
    courses.forEach(function (c) { (c.attempts || []).forEach(function (a) { attempts.push(a); }); });
    var avgScore = attempts.length ? Math.round(attempts.reduce(function (s, a) { return s + (a.score / a.total) * 20; }, 0) / attempts.length * 10) / 10 : null;
    var allFc = [];
    courses.forEach(function (c) { (c.flashcards || []).forEach(function (f) { allFc.push(f); }); });
    var known = allFc.filter(function (f) { return f.status === "known"; }).length;
    return { total: courses.length, avgScore: avgScore, fcKnown: known, fcTotal: allFc.length };
  }

  function renderDashboard() {
    var subs = userData().subjects;
    var stats = computeStats();
    var head = '<div class="page-head"><div><div class="page-title-row"><img class="page-title-logo" src="assets/objects/ui/Menu.png" alt=""><h1 class="page-title">Menu</h1></div><p class="page-sub">Toutes tes matières, rangées et prêtes à réviser.</p></div>' +
      '<div style="display:flex;gap:10px">' +
      '<button class="btn btn-metal" style="width:auto" onclick="App.openRevisionSheetModal()">' + icon("doc") + ' Générer une fiche de révision</button>' +
      '<button class="btn btn-primary" style="width:auto" onclick="App.openModal(\'subject\')">' + icon("plus") + ' Nouvelle matière</button>' +
      '</div></div>';
    var statsHtml = '<div class="stat-row">' +
      '<div class="stat-card"><div class="stat-num mono">' + stats.total + '</div><div class="stat-lbl">Cours importés</div></div>' +
      '<div class="stat-card"><div class="stat-num mono">' + (stats.avgScore == null ? "—" : stats.avgScore + "/20") + '</div><div class="stat-lbl">Moyenne aux contrôles</div></div>' +
      '<div class="stat-card"><div class="stat-num mono">' + stats.fcKnown + '/' + stats.fcTotal + '</div><div class="stat-lbl">Flashcards maîtrisées</div></div>' +
      '</div>';
    var grid;
    if (!subs.length) {
      grid = '<div class="empty-state">' + sprite("dinoBig", 5, { bob: true }) + '<h3>Le camp est encore vide</h3><p>Crée ta première matière pour commencer à organiser tes cours.</p>' +
        '<button class="btn btn-primary" style="width:auto;margin-top:14px" onclick="App.openModal(\'subject\')">' + icon("plus") + ' Nouvelle matière</button></div>';
    } else {
      grid = '<div class="card-grid-signs-short">' + subs.map(function (s) {
        var courseCount = s.themes.reduce(function (n, t) { return n + t.chapters.reduce(function (n2, c) { return n2 + c.courses.length; }, 0); }, 0);
        return '<div class="tile tile-sign tile-sign-short" onclick="location.hash=\'#/subject/' + s.id + '\'">' +
          '<button class="tile-rename" style="right:40px" title="Renommer" onclick="event.stopPropagation();App.openRenameModal(\'subject\',\'' + s.id + '\')">✏️</button>' +
          '<button class="tile-del" title="Supprimer" onclick="event.stopPropagation();App.askDelete(\'subject\',\'' + s.id + '\')">' + icon("trash") + '</button>' +
          '<div class="tile-icon">' + icon("book") + '</div>' +
          '<div class="tile-title">' + esc(s.name) + '</div>' +
          '<div class="tile-meta">' + s.themes.length + ' thème' + (s.themes.length !== 1 ? "s" : "") + ' · ' + courseCount + ' cours</div>' +
          '</div>';
      }).join("") + '<button class="add-tile" onclick="App.openModal(\'subject\')">' + icon("plus") + ' Nouvelle matière</button></div>';
    }
    var sheets = userData().revisionSheets;
    var sheetsHtml = "";
    if (sheets.length) {
      sheetsHtml = '<div class="page-head" style="margin-top:34px"><h2 class="page-title" style="font-size:17px">Fiches de révision</h2></div>' +
        '<div class="card-grid-signs-short">' + sheets.slice().reverse().map(function (sheet) {
          var subj = findSubject(sheet.subjectId);
          var statusHtml = sheet.status === "processing"
            ? '<span class="status-pill status-processing"><span class="dotpulse"></span>Génération…' + genPillPct(sheet.id) + '</span>'
            : sheet.status === "error" ? '<span class="status-pill status-processing">⚠️ Erreur</span>'
            : '<span class="status-pill status-ready">Prêt</span>';
          return '<div class="tile tile-sign tile-sign-metal" onclick="location.hash=\'#/revision/' + sheet.id + '\'">' +
            '<button class="tile-del" title="Supprimer" onclick="event.stopPropagation();App.askDelete(\'revisionSheet\',null,null,null,\'' + sheet.id + '\')">' + icon("trash") + '</button>' +
            '<div class="tile-icon">' + icon("doc") + '</div>' +
            '<div class="tile-title">' + esc(sheet.title) + '</div>' +
            '<div class="tile-meta">' + (subj ? esc(subj.name) : "") + '</div>' +
            statusHtml +
            '</div>';
        }).join("") + '</div>';
    }
    renderShell([], head + statsHtml + grid + sheetsHtml);
  }

  function renderSubjectPage(subjectId) {
    var s = findSubject(subjectId);
    if (!s) { navigate("#/"); return; }
    var head = '<div class="page-head"><div><div class="page-title-row">' + sprite("footprint", 4) + '<h1 class="page-title">' + esc(s.name) + '</h1></div><p class="page-sub">' + s.themes.length + ' thème' + (s.themes.length !== 1 ? "s" : "") + '</p></div>' +
      '<button class="btn btn-primary" style="width:auto" onclick="App.openModal(\'theme\', \'' + s.id + '\')">' + icon("plus") + ' Nouveau thème</button></div>';
    var grid;
    if (!s.themes.length) {
      grid = '<div class="empty-state">' + sprite("dinoBig", 5, { bob: true }) + '<h3>Aucun thème encore</h3><p>Ajoute un thème pour commencer à y ranger des chapitres.</p>' +
        '<button class="btn btn-primary" style="width:auto;margin-top:14px" onclick="App.openModal(\'theme\', \'' + s.id + '\')">' + icon("plus") + ' Nouveau thème</button></div>';
    } else {
      grid = '<div class="card-grid-signs-short">' + s.themes.map(function (t) {
        var courseCount = t.chapters.reduce(function (n, c) { return n + c.courses.length; }, 0);
        return '<div class="tile tile-sign tile-sign-short" onclick="location.hash=\'#/subject/' + s.id + '/theme/' + t.id + '\'">' +
          '<button class="tile-rename" title="Renommer" onclick="event.stopPropagation();App.openRenameModal(\'theme\',\'' + s.id + '\',\'' + t.id + '\')">✏️</button>' +
          '<button class="tile-move" title="Dupliquer" onclick="event.stopPropagation();App.duplicateTheme(\'' + s.id + '\',\'' + t.id + '\')">📋</button>' +
          '<button class="tile-del" title="Supprimer" onclick="event.stopPropagation();App.askDelete(\'theme\',\'' + s.id + '\',\'' + t.id + '\')">' + icon("trash") + '</button>' +
          '<div class="tile-icon">' + icon("book") + '</div>' +
          '<div class="tile-title">' + esc(t.name) + '</div>' +
          '<div class="tile-meta">' + t.chapters.length + ' chapitre' + (t.chapters.length !== 1 ? "s" : "") + ' · ' + courseCount + ' cours</div>' +
          '</div>';
      }).join("") + '<button class="add-tile" onclick="App.openModal(\'theme\', \'' + s.id + '\')">' + icon("plus") + ' Nouveau thème</button></div>';
    }
    renderShell(["subject", subjectId], head + grid);
  }

  function renderThemePage(subjectId, themeId) {
    var s = findSubject(subjectId);
    var th = findTheme(s, themeId);
    if (!s || !th) { navigate("#/"); return; }
    var head = '<div class="page-head"><div><div class="page-title-row">' + sprite("footprint", 4) + '<h1 class="page-title">' + esc(th.name) + '</h1></div><p class="page-sub">' + esc(s.name) + ' · ' + th.chapters.length + ' chapitre' + (th.chapters.length !== 1 ? "s" : "") + '</p></div>' +
      '<button class="btn btn-primary" style="width:auto" onclick="App.openModal(\'chapter\', \'' + s.id + '\', \'' + th.id + '\')">' + icon("plus") + ' Nouveau chapitre</button></div>';
    var grid;
    if (!th.chapters.length) {
      grid = '<div class="empty-state">' + sprite("dinoBig", 5, { bob: true }) + '<h3>Aucun chapitre encore</h3><p>Ajoute un chapitre pour commencer à y importer des cours.</p>' +
        '<button class="btn btn-primary" style="width:auto;margin-top:14px" onclick="App.openModal(\'chapter\', \'' + s.id + '\', \'' + th.id + '\')">' + icon("plus") + ' Nouveau chapitre</button></div>';
    } else {
      grid = '<div class="card-grid-signs-short">' + th.chapters.map(function (c) {
        return '<div class="tile tile-sign tile-sign-short" onclick="location.hash=\'#/subject/' + s.id + '/theme/' + th.id + '/chapter/' + c.id + '\'">' +
          '<button class="tile-dup" title="Dupliquer" onclick="event.stopPropagation();App.duplicateChapter(\'' + s.id + '\',\'' + th.id + '\',\'' + c.id + '\')">📋</button>' +
          '<button class="tile-rename" title="Renommer" onclick="event.stopPropagation();App.openRenameModal(\'chapter\',\'' + s.id + '\',\'' + th.id + '\',\'' + c.id + '\')">✏️</button>' +
          '<button class="tile-move" title="Déplacer" onclick="event.stopPropagation();App.openMoveChapterModal(\'' + s.id + '\',\'' + th.id + '\',\'' + c.id + '\')">🔀</button>' +
          '<button class="tile-del" title="Supprimer" onclick="event.stopPropagation();App.askDelete(\'chapter\',\'' + s.id + '\',\'' + th.id + '\',\'' + c.id + '\')">' + icon("trash") + '</button>' +
          '<div class="tile-icon">' + icon("folder") + '</div>' +
          '<div class="tile-title">' + esc(c.name) + '</div>' +
          '<div class="tile-meta">' + c.courses.length + ' cours</div>' +
          '</div>';
      }).join("") + '<button class="add-tile" onclick="App.openModal(\'chapter\', \'' + s.id + '\', \'' + th.id + '\')">' + icon("plus") + ' Nouveau chapitre</button></div>';
    }
    renderShell(["subject", subjectId, "theme", themeId], head + grid);
  }

  function renderChapterPage(subjectId, themeId, chapterId) {
    var s = findSubject(subjectId);
    var th = findTheme(s, themeId);
    var c = findChapter(th, chapterId);
    if (!s || !th || !c) { navigate("#/"); return; }
    var head = '<div class="page-head"><div><div class="page-title-row">' + sprite("footprint", 4) + '<h1 class="page-title">' + esc(c.name) + '</h1></div><p class="page-sub">' + esc(s.name) + ' · ' + esc(th.name) + ' · ' + c.courses.length + ' cours importé' + (c.courses.length !== 1 ? "s" : "") + '</p></div>' +
      '<button class="btn btn-primary" style="width:auto" onclick="App.openModal(\'course\', \'' + s.id + '\', \'' + th.id + '\', \'' + c.id + '\')">' + icon("camera") + ' Importer un cours</button></div>';
    var grid;
    if (!c.courses.length) {
      grid = '<div class="empty-state">' + sprite("dinoBig", 5, { bob: true }) + '<h3>Aucun cours encore</h3><p>Importe une photo de cours pour générer automatiquement retranscription, explication, flashcards et contrôle.</p>' +
        '<button class="btn btn-primary" style="width:auto;margin-top:14px" onclick="App.openModal(\'course\', \'' + s.id + '\', \'' + th.id + '\', \'' + c.id + '\')">' + icon("camera") + ' Importer un cours</button></div>';
    } else {
      grid = '<div class="card-grid-signs-short">' + c.courses.map(function (co) {
        var statusHtml = co.status === "processing"
          ? '<span class="status-pill status-processing"><span class="dotpulse"></span>Génération…' + genPillPct(co.id) + '</span>'
          : '<span class="status-pill status-ready">Prêt</span>';
        return '<div class="tile tile-sign tile-sign-short" onclick="location.hash=\'#/course/' + co.id + '\'">' +
          '<button class="tile-rename" title="Renommer" onclick="event.stopPropagation();App.openRenameModal(\'course\',\'' + s.id + '\',\'' + th.id + '\',\'' + c.id + '\',\'' + co.id + '\')">✏️</button>' +
          '<button class="tile-move" title="Déplacer" onclick="event.stopPropagation();App.openMoveCourseModal(\'' + s.id + '\',\'' + th.id + '\',\'' + c.id + '\',\'' + co.id + '\')">🔀</button>' +
          '<button class="tile-del" title="Supprimer" onclick="event.stopPropagation();App.askDelete(\'course\',\'' + s.id + '\',\'' + th.id + '\',\'' + c.id + '\',\'' + co.id + '\')">' + icon("trash") + '</button>' +
          '<div class="tile-icon">' + icon("doc") + '</div>' +
          '<div class="tile-title">' + esc(co.title) + '</div>' +
          statusHtml +
          '</div>';
      }).join("") + '<button class="add-tile" onclick="App.openModal(\'course\', \'' + s.id + '\', \'' + th.id + '\', \'' + c.id + '\')">' + icon("camera") + ' Importer un cours</button></div>';
    }
    renderShell(["subject", subjectId, "theme", themeId, "chapter", chapterId], head + grid);
  }

  /* ---------------- Importer un exercice ---------------- */
  function renderImportedExercisesPage() {
    var list = userData().importedExercises.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    var head = '<div class="page-head"><div><div class="page-title-row"><img class="page-title-logo" src="assets/objects/ui/MesExos.png" alt=""><h1 class="page-title">Mes exercices</h1></div><p class="page-sub">Importe tes propres exercices (n\'importe quelle matière) et fais-les corriger par l\'IA.</p></div>' +
      '<button class="btn btn-primary" style="width:auto" onclick="App.openModal(\'exercice\')">' + icon("camera") + ' Importer un exercice</button></div>';
    var grid;
    if (!list.length) {
      grid = '<div class="empty-state">' + sprite("dinoBig", 5, { bob: true }) + '<h3>Aucun exercice importé</h3><p>Prends en photo un exercice de ton choix pour t\'entraîner et être corrigé.</p>' +
        '<button class="btn btn-primary" style="width:auto;margin-top:14px" onclick="App.openModal(\'exercice\')">' + icon("camera") + ' Importer un exercice</button></div>';
    } else {
      grid = '<div class="card-grid">' + list.map(function (en) {
        var gradedCount = en.status === "ready" ? en.exercises.filter(function (ex) { return ex.answerStatus === "graded"; }).length : 0;
        var totalCount = en.status === "ready" ? en.exercises.length : 0;
        var statusHtml = en.status === "processing"
          ? '<span class="status-pill status-processing"><span class="dotpulse"></span>Analyse…' + genPillPct(en.id) + '</span>'
          : en.status === "error"
          ? '<span class="status-pill status-processing">⚠️ Erreur</span>'
          : gradedCount === 0
          ? '<span class="status-pill status-ready">' + (totalCount > 1 ? totalCount + " exercices prêts" : "Prêt") + '</span>'
          : gradedCount === totalCount
          ? '<span class="status-pill status-ready">' + (totalCount > 1 ? "✅ " + gradedCount + "/" + totalCount + " corrigés" : gradeLevelLabel(en.exercises[0].level || (en.exercises[0].correct ? "correct" : "wrong"))) + '</span>'
          : '<span class="status-pill status-ready">' + gradedCount + "/" + totalCount + ' corrigés</span>';
        return '<div class="tile" onclick="location.hash=\'#/exercices/' + en.id + '\'">' +
          '<button class="tile-del" title="Supprimer" onclick="event.stopPropagation();App.askDelete(\'importedExercise\',null,null,null,\'' + en.id + '\')">' + icon("trash") + '</button>' +
          '<div class="tile-icon">' + icon("doc") + '</div>' +
          '<div class="tile-title">' + esc(en.title) + '</div>' +
          (en.subjectGuess ? '<span class="demo-badge">' + esc(en.subjectGuess) + '</span>' : '') +
          statusHtml +
          '</div>';
      }).join("") + '<button class="add-tile" onclick="App.openModal(\'exercice\')">' + icon("camera") + ' Importer un exercice</button></div>';
    }
    renderShell(["exercices"], head + grid);
  }

  function renderImportedExercisePage(exId) {
    var entry = userData().importedExercises.find(function (x) { return x.id === exId; });
    if (!entry) { navigate("#/exercices"); return; }
    var head = '<div class="course-head">' +
      (entry.images && entry.images.length ? '<img class="course-thumb" src="' + entry.images[0] + '">' : '') +
      '<div><h1 class="page-title" style="margin-bottom:6px">' + esc(entry.title) + '</h1>' +
      '<p class="page-sub">' + (entry.subjectGuess ? esc(entry.subjectGuess) + " · " : "") + 'Exercice importé — ne rapporte pas de points Dino Park</p></div>' +
      (entry.status === "ready" && entry.images && entry.images.length ? '<div style="display:flex;gap:10px;margin-left:auto"><button class="btn btn-ghost btn-sm" style="width:auto" onclick="App.retryImportedExerciseGeneration(\'' + entry.id + '\')">🔄 Régénérer</button></div>' : '') +
      '</div>';

    var body;
    if (entry.status === "processing") {
      body = '<div class="processing-box">' + genLogo() + genProgressHtml(entry.id, "Gemini analyse ton exercice…") + '</div>';
    } else if (entry.status === "error") {
      body = '<div class="processing-box"><span>⚠️ ' + esc(entry.error || "L'import a échoué.") + '</span>' +
        '<div style="display:flex;gap:10px">' +
        (entry.errorDetail ? '<button class="btn btn-ghost btn-sm" style="width:auto;margin-top:14px" onclick="App.openImportedExerciseErrorDetail(\'' + entry.id + '\')">Détails</button>' : '') +
        '<button class="btn btn-primary" style="width:auto;margin-top:14px" onclick="App.retryImportedExerciseGeneration(\'' + entry.id + '\')">Réessayer</button>' +
        '</div></div>';
    } else {
      var multi = entry.exercises.length > 1;
      var allGraded = entry.exercises.length && entry.exercises.every(function (ex) { return ex.answerStatus === "graded"; });
      var col = entry.exercises.map(function (ex, i) {
        var block = (multi ? '<div class="dp-exercise-label" style="margin-bottom:8px">Exercice ' + (i + 1) + ' / ' + entry.exercises.length + '</div>' : '') +
          '<div class="prose">' + mdToHtml(ex.statement, entry.figures) + '</div>' + exerciseFigureHtml({ prompt: ex.statement, figureSvg: ex.figureSvg });
        if (ex.answerStatus === "grading") {
          block += '<div class="processing-box">' + genLogo() + '<span>Correction en cours…</span></div>';
        } else if (ex.answerStatus === "graded") {
          var ielvl = ex.level || (ex.correct ? "correct" : "wrong");
          var iecls = gradeLevelCls(ielvl);
          block += '<div class="rte-display" style="color:var(--text-muted);font-size:13.5px;margin-bottom:6px">Ta réponse :</div>' +
            '<div class="rte-display" style="margin-bottom:14px">' + (ex.answerHtml || "<em>(vide)</em>") + '</div>' +
            '<div class="quiz-feedback ' + iecls + '">' +
            '<div class="quiz-feedback-title ' + iecls + '" style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span>' + gradeLevelLabel(ielvl) + '</span>' + gradeScoreBadge(ex.score, ex.scoreMax) + '</div>' +
            gradeMistakesHtml(ex.mistakes) +
            '<div class="correction-exp">' + mdToHtml(ex.feedback) + '</div>' +
            '</div>' +
            '<div class="dp-exercise-box" style="margin-top:14px"><div class="dp-exercise-label">Solution de référence</div><div class="dp-exercise-text">' + mdToHtml(splitInlineNumberedQuestions(ex.solution)) + '</div></div>' +
            '<div class="quiz-nav" style="margin-top:14px"><button class="btn btn-ghost" style="width:auto" onclick="App.retryImportedExerciseAnswer(\'' + entry.id + '\',' + i + ')">Refaire cet exercice</button></div>';
        } else {
          block += '<div class="field"><label>Ta réponse</label>' + richEditorHtml("ie-answer-" + i, "Écris ton raisonnement et ta réponse…", ex.answerHtml || "", true) + '</div>' +
            '<button class="btn btn-primary" style="width:auto" onclick="App.submitImportedExerciseAnswer(\'' + entry.id + '\',' + i + ')">Valider ma réponse</button>';
        }
        return '<div class="dp-exercise-item"' + (multi ? ' style="margin-bottom:26px;padding-bottom:22px;border-bottom:2px solid var(--border-soft)"' : '') + '>' + block + '</div>';
      }).join("") +
        (allGraded ? '<button class="btn btn-ghost" style="width:auto" onclick="App.downloadImportedExercisePdf(\'' + entry.id + '\')">⬇️ Télécharger en PDF</button>' : "") +
        figuresPanelHtml(entry.figures, entryFiguresOpen, entry.id, "toggleEntryFigures", "deleteEntryFigure");
      body = '<div class="exercise-layout"><div class="quiz-wrap quiz-wrap-exercise">' + col + '</div>' + dinoCompanionHtml() + '</div>';
    }
    renderShell(["exercices", exId], head + body, { narrow: entry.status !== "ready" });
  }

  /* ---------------- Podcast (pages) ---------------- */
  var podcastPlayerInterval = null;
  var podcastProcessingInterval = null;
  var podcastIdleImgCache = null; // choisie une seule fois par session — ne doit pas changer à chaque clic
  var podcastExpliqueByPod = {}; // per podcast id: index courant — stable tant qu'on reste sur CE podcast, change seulement toutes les ~60s
  var podcastFolderOpen = {}; // per groupId: bool — dossier de parties replié par défaut
  // Vitesse de lecture choisie (x0,5 à x2), gardée d'un podcast/partie à l'autre et entre les visites.
  var PODCAST_RATES = [0.5, 1, 1.5, 2];
  var podcastRate = 1;
  try { var savedRate = parseFloat(localStorage.getItem("studino-podcast-rate")); if (PODCAST_RATES.indexOf(savedRate) >= 0) podcastRate = savedRate; } catch (e) {}
  function podcastRateLabel(r) { return "x" + String(r).replace(".", ","); }
  var podcastAutoPlayNext = false; // mis à true juste avant de naviguer vers la partie suivante en fin de lecture
  function podcastFormatTime(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function podcastStatusBadge(p) {
    return p.status === "processing" ? '<span class="status-pill status-processing"><span class="dotpulse"></span>Préparation…' + genPillPct(p.id) + '</span>'
      : p.status === "error" ? '<span class="status-pill status-processing">⚠️ Erreur</span>'
      : '<span class="status-pill status-ready">🎧 ' + podcastFormatTime(p.durationSec) + '</span>';
  }
  var PODCAST_NEW_CONTENT_BADGE = '<span class="status-pill status-processing" title="Des cours ont été ajoutés ou modifiés depuis ce podcast">🆕 Nouveau contenu</span>';
  function podcastTileHtml(p) {
    var refreshHtml = podcastRefreshStatusHtml(podcastGroupKey(p));
    var hasNew = !refreshHtml && p.status === "ready" && podcastGroupHasNewContent([p]);
    return '<div class="tile" onclick="location.hash=\'#/podcasts/' + p.id + '\'">' +
      '<button class="tile-rename" style="right:40px" title="Renommer" onclick="event.stopPropagation();App.openRenameModal(\'podcast\',null,null,null,\'' + p.id + '\')">✏️</button>' +
      '<button class="tile-del" title="Supprimer" onclick="event.stopPropagation();App.askDelete(\'podcast\',null,null,null,\'' + p.id + '\')">' + icon("trash") + '</button>' +
      '<div class="tile-icon">🎙️</div>' +
      '<div class="tile-title">' + esc(p.title) + '</div>' +
      podcastStatusBadge(p) +
      (hasNew ? PODCAST_NEW_CONTENT_BADGE : "") +
      refreshHtml +
      '</div>';
  }
  // Plusieurs parties du même podcast (même groupId) prennent un seul emplacement sous forme de
  // dossier repliable, plutôt qu'une tuile pleine par partie — beaucoup plus compact.
  function podcastFolderTileHtml(gid, parts) {
    var chapterName = podcastGroupDisplayName(parts);
    var open = !!podcastFolderOpen[gid];
    var busy = parts.some(function (p) { return p.status === "processing"; });
    var refreshHtml = podcastRefreshStatusHtml(gid);
    var hasNew = !busy && !refreshHtml && podcastGroupHasNewContent(parts);
    if (!open) {
      return '<div class="tile" onclick="App.togglePodcastFolder(\'' + gid + '\')">' +
        '<button class="tile-rename" style="right:10px" title="Renommer le podcast" onclick="event.stopPropagation();App.openRenameModal(\'podcastGroup\',null,null,null,\'' + gid + '\')">✏️</button>' +
        '<div class="tile-icon">📁</div>' +
        '<div class="tile-title">' + esc(chapterName) + '</div>' +
        '<span class="demo-badge">' + parts.length + ' parties</span>' +
        (hasNew ? PODCAST_NEW_CONTENT_BADGE : "") +
        refreshHtml +
        '</div>';
    }
    var anyReady = parts.some(function (p) { return p.status === "ready"; });
    return '<div class="tile podcast-folder-open">' +
      '<div class="podcast-folder-head" onclick="App.togglePodcastFolder(\'' + gid + '\')"><div class="tile-icon">📂</div><div class="tile-title">' + esc(chapterName) + '</div>' +
      '<button class="tile-rename" style="right:40px" title="Renommer le podcast" onclick="event.stopPropagation();App.openRenameModal(\'podcastGroup\',null,null,null,\'' + gid + '\')">✏️</button>' +
      '<button class="tile-del" title="Supprimer toutes les parties" onclick="event.stopPropagation();App.askDelete(\'podcastGroup\',null,null,null,\'' + gid + '\')">' + icon("trash") + '</button></div>' +
      (anyReady ? '<button class="btn btn-ghost btn-sm" style="width:auto;margin-bottom:8px" ' + mp3ButtonAttrs("g:" + gid, "⬇️ Tout télécharger en un seul MP3") + ' onclick="event.stopPropagation();App.downloadPodcastGroupMp3(\'' + gid + '\')">' + mp3ButtonInner("g:" + gid, "⬇️ Tout télécharger en un seul MP3") + '</button>' : "") +
      (hasNew ? '<button class="btn btn-primary btn-sm" style="width:auto;margin:0 0 8px 8px" onclick="event.stopPropagation();App.refreshPodcast(\'' + gid + '\')" title="Refait tout le podcast avec les cours à jour (consomme autant de quota voix qu\'un nouveau podcast)">🔄 Actualiser avec le nouveau contenu</button>' : "") +
      (refreshHtml ? '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">' + refreshHtml + '</div>' : "") +
      '<div class="podcast-folder-items">' + parts.map(function (p) {
        return '<div class="podcast-folder-item" onclick="location.hash=\'#/podcasts/' + p.id + '\'">' +
          '<span>🎙️ ' + esc(p.title || ("Partie " + p.partIndex)) + '</span>' + podcastStatusBadge(p) +
          '<button class="tile-rename" title="Renommer cette partie" onclick="event.stopPropagation();App.openRenameModal(\'podcast\',null,null,null,\'' + p.id + '\')">✏️</button>' +
          '<button class="tile-del" title="Supprimer" onclick="event.stopPropagation();App.askDelete(\'podcast\',null,null,null,\'' + p.id + '\')">' + icon("trash") + '</button>' +
          '</div>';
      }).join("") + '</div></div>';
  }
  // Où ranger un podcast dans « Mes podcasts » : on suit l'arborescence actuelle du Menu
  // (matière → thème → chapitre). Si son thème/chapitre/cours a disparu, il reste dans sa matière.
  function podcastPlace(p) {
    var subj = findSubject(p.subjectId);
    if (!subj) return {};
    var out = { subjectId: subj.id };
    if (p.scopeLevel === "theme") {
      if (findTheme(subj, p.scopeId)) out.themeId = p.scopeId;
      return out;
    }
    if (p.scopeLevel === "course") {
      var loc = locateCourse(p.scopeId);
      if (loc && loc.subject.id === subj.id) { out.themeId = loc.theme.id; out.chapterId = loc.chapter.id; out.courseId = loc.course.id; }
      return out;
    }
    subj.themes.some(function (t) {
      return t.chapters.some(function (c) { if (c.id === p.scopeId) { out.themeId = t.id; out.chapterId = c.id; return true; } return false; });
    });
    return out;
  }
  function podcastLibHash(p) {
    var pl = podcastPlace(p);
    return "#/podcasts/lib" + (pl.subjectId ? "/" + pl.subjectId + (pl.themeId ? "/" + pl.themeId + (pl.chapterId ? "/" + pl.chapterId : "") : "") : "");
  }
  function podcastVisibleList() { return podcastData().filter(function (p) { return !isHiddenPendingPodcast(p); }); }
  function podcastGroupCount(items) {
    var seen = {};
    items.forEach(function (p) { seen[podcastGroupKey(p)] = 1; });
    return Object.keys(seen).length;
  }
  function podcastCountLabel(items) {
    var n = podcastGroupCount(items);
    return n + " podcast" + (n !== 1 ? "s" : "");
  }
  // Tuiles des podcasts (un dossier par podcast en plusieurs parties), les plus récents d'abord.
  function podcastGroupsGridHtml(items) {
    var byGroup = {}, order = [];
    items.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).forEach(function (p) {
      var gid = podcastGroupKey(p);
      if (!byGroup[gid]) { byGroup[gid] = []; order.push(gid); }
      byGroup[gid].push(p);
    });
    return '<div class="card-grid">' + order.map(function (gid) {
      var parts = byGroup[gid].sort(function (a, b) { return a.partIndex - b.partIndex; });
      return parts.length > 1 ? podcastFolderTileHtml(gid, parts) : podcastTileHtml(parts[0]);
    }).join("") + '</div>';
  }
  function podcastLibSection(label, items) {
    if (!items.length) return "";
    return '<div class="podcast-lib-section"><div class="podcast-lib-label">' + label + '</div>' + podcastGroupsGridHtml(items) + '</div>';
  }
  // Tuile « dossier » comme dans le Menu (matière / thème / chapitre), avec le nombre de podcasts dedans.
  function podcastLibFolderTile(hash, iconHtml, name, items) {
    var busy = items.some(function (p) { return p.status === "processing"; });
    return '<div class="tile tile-sign tile-sign-short" onclick="location.hash=\'' + hash + '\'">' +
      '<div class="tile-icon">' + iconHtml + '</div>' +
      '<div class="tile-title">' + esc(name) + '</div>' +
      '<div class="tile-meta">🎙️ ' + podcastCountLabel(items) + (busy ? ' · en préparation…' : '') + '</div>' +
      '</div>';
  }

  // Accueil Podcast : papi + deux gros boutons. La bibliothèque est rangée dans « Mes podcasts ».
  function renderPodcastListPage() {
    var list = podcastVisibleList();
    if (!podcastIdleImgCache) podcastIdleImgCache = PODCAST_ATTEND_IMGS[Math.floor(Math.random() * PODCAST_ATTEND_IMGS.length)];
    var busy = list.some(function (p) { return p.status === "processing"; });
    var note = busy ? '🎙️ Un podcast est en préparation, tu le retrouveras dans « Mes podcasts ».'
      : !list.length ? 'Choisis un thème, un chapitre ou un cours, le vieux prof s\'occupe du reste.' : '';
    var count = podcastGroupCount(list);
    var body = '<div class="podcast-fullscreen">' +
      '<img src="' + PODCAST_DIR + podcastIdleImgCache + '" class="podcast-bg-img" alt="">' +
      '<div class="podcast-fs-header"><button class="mobile-nav-toggle" style="background:rgba(255,255,255,0.14);border-color:rgba(255,255,255,0.4);color:#fff" onclick="App.toggleMobileNav()" aria-label="Menu">☰</button><div class="page-title-row"><img class="page-title-logo" src="assets/objects/ui/Podcast.png" alt=""><div class="podcast-fs-title">Podcast</div></div></div>' +
      '<div class="podcast-home-actions">' +
      '<button class="btn btn-metal podcast-home-btn" onclick="location.hash=\'#/podcasts/lib\'">📚 Mes podcasts' + (count ? ' <span class="podcast-home-count">' + count + '</span>' : '') + '</button>' +
      '<button class="btn btn-primary podcast-home-btn" onclick="App.openPodcastModal()">' + icon("plus") + ' Nouveau podcast</button>' +
      (note ? '<div class="podcast-home-note">' + note + '</div>' : '') +
      '</div></div>';
    renderShell(["podcasts"], body);
  }

  // « Mes podcasts » : rangés comme les cours dans le Menu (matière → thème → chapitre → cours).
  function renderPodcastLibraryPage(subjectId, themeId, chapterId) {
    var parts = ["podcasts", "lib"];
    var all = podcastVisibleList().map(function (p) { return { p: p, pl: podcastPlace(p) }; });
    var pick = function (fn) { return all.filter(function (x) { return fn(x.pl, x.p); }).map(function (x) { return x.p; }); };
    var s = subjectId ? findSubject(subjectId) : null;
    var th = s && themeId ? findTheme(s, themeId) : null;
    var c = th && chapterId ? findChapter(th, chapterId) : null;
    if ((subjectId && !s) || (themeId && !th) || (chapterId && !c)) { navigate("#/podcasts/lib"); return; }
    var title, sub, content = "";
    if (c) {
      parts.push(s.id, th.id, c.id);
      var inChap = pick(function (pl) { return pl.chapterId === c.id; });
      title = c.name; sub = esc(s.name) + ' · ' + esc(th.name) + ' · ' + podcastCountLabel(inChap);
      content = podcastLibSection("📂 Tout le chapitre", inChap.filter(function (p) { return p.scopeLevel !== "course"; }));
      c.courses.forEach(function (co) {
        content += podcastLibSection("📄 " + esc(co.title), inChap.filter(function (p) { return p.scopeLevel === "course" && p.scopeId === co.id; }));
      });
    } else if (th) {
      parts.push(s.id, th.id);
      var inTheme = pick(function (pl) { return pl.themeId === th.id; });
      title = th.name; sub = esc(s.name) + ' · ' + podcastCountLabel(inTheme);
      content = podcastLibSection("📚 Tout le thème", pick(function (pl, p) { return pl.themeId === th.id && !pl.chapterId; }));
      var chapTiles = th.chapters.map(function (ch) {
        var items = pick(function (pl) { return pl.chapterId === ch.id; });
        return items.length ? podcastLibFolderTile("#/podcasts/lib/" + s.id + "/" + th.id + "/" + ch.id, icon("folder"), ch.name, items) : "";
      }).join("");
      if (chapTiles) content += '<div class="podcast-lib-section"><div class="podcast-lib-label">Chapitres</div><div class="card-grid-signs-short">' + chapTiles + '</div></div>';
    } else if (s) {
      parts.push(s.id);
      var inSubj = pick(function (pl) { return pl.subjectId === s.id; });
      title = s.name; sub = podcastCountLabel(inSubj);
      var themeTiles = s.themes.map(function (t) {
        var items = pick(function (pl) { return pl.themeId === t.id; });
        return items.length ? podcastLibFolderTile("#/podcasts/lib/" + s.id + "/" + t.id, icon("book"), t.name, items) : "";
      }).join("");
      if (themeTiles) content += '<div class="podcast-lib-section"><div class="podcast-lib-label">Thèmes</div><div class="card-grid-signs-short">' + themeTiles + '</div></div>';
      content += podcastLibSection("Cours supprimés ou déplacés", pick(function (pl) { return pl.subjectId === s.id && !pl.themeId; }));
    } else {
      title = "Mes podcasts"; sub = podcastCountLabel(all.map(function (x) { return x.p; }));
      var subjTiles = userData().subjects.map(function (sj) {
        var items = pick(function (pl) { return pl.subjectId === sj.id; });
        return items.length ? podcastLibFolderTile("#/podcasts/lib/" + sj.id, icon("book"), sj.name, items) : "";
      }).join("");
      if (subjTiles) content += '<div class="podcast-lib-section"><div class="podcast-lib-label">Matières</div><div class="card-grid-signs-short">' + subjTiles + '</div></div>';
      content += podcastLibSection("Matières supprimées", pick(function (pl) { return !pl.subjectId; }));
    }
    if (!content) {
      content = '<div class="empty-state">' + sprite("dinoBig", 5, { bob: true }) + '<h3>Aucun podcast ici</h3><p>Crée un podcast sur un thème, un chapitre ou un seul cours : il sera rangé ici automatiquement.</p>' +
        '<button class="btn btn-primary" style="width:auto;margin-top:14px" onclick="App.openPodcastModal()">' + icon("plus") + ' Nouveau podcast</button></div>';
    }
    var head = '<div class="page-head"><div><div class="page-title-row"><img class="page-title-logo" src="assets/objects/ui/Podcast.png" alt=""><h1 class="page-title">' + esc(title) + '</h1></div><p class="page-sub">' + sub + '</p></div>' +
      '<button class="btn btn-primary" style="width:auto" onclick="App.openPodcastModal()">' + icon("plus") + ' Nouveau podcast</button></div>';
    renderShell(parts, head + content);
  }
  function renderPodcastDetailPage(id) {
    var pod = podcastFind(id);
    if (!pod) { navigate("#/podcasts"); return; }
    var closeBtn = '<button class="podcast-fs-close" onclick="location.hash=\'' + podcastLibHash(pod) + '\'" title="Retour à mes podcasts">✕</button>';
    var body;
    if (pod.status === "processing") {
      var procStart = pod.processingStartedAt || pod.createdAt || Date.now();
      // pod.script n'est rempli qu'une fois le texte généré (voir runPodcastGeneration/retryPodcastPartAudio)
      // : ça permet de distinguer les deux étapes (texte, puis voix) pour donner une estimation honnête
      // plutôt qu'un seul message vague pendant tout le temps de génération.
      // La voix se génère maintenant par petits morceaux recollés ensuite (voir generatePodcastAudio),
      // ce qui prend plus longtemps qu'un seul appel mais évite la troncature silencieuse — ça vaut le
      // coup d'attendre un peu plus pour avoir l'intégralité de la partie, pas un podcast coupé net.
      var procLabel = pod.script
        ? "Le vieux conteur enregistre sa voix pour « " + pod.title + " », morceau par morceau pour ne rien couper… généralement 3 à 8 minutes par partie."
        : pod.pendingReplace
        ?"Le vieux conteur refait tout le podcast « " + pod.scopeName + " » avec tes cours à jour… généralement 1 à 3 minutes pour le texte. Ton ancien podcast reste disponible jusqu'à ce que le nouveau texte soit prêt."
        : "Le vieux conteur prépare son texte sur « " + pod.title + " »… généralement 1 à 3 minutes, un peu plus pour un cours très riche en plusieurs parties.";
      body = '<div class="podcast-fullscreen">' + closeBtn +
        '<img src="' + PODCAST_DIR + PODCAST_LIS_IMG + '" class="podcast-bg-img" alt="">' +
        '<div class="podcast-fs-bottom"><div class="processing-box" style="color:#fff">' + genLogo() + '<span>' + esc(procLabel) + '</span>' + genProgressHtml(pod.id, "", true) +
        '<div class="mono" id="podcast-processing-timer" style="margin-top:8px;opacity:0.85">⏱️ ' + dpFormatCountdown(Date.now() - procStart) + '</div>' +
        '</div></div>' +
        '</div>';
    } else if (pod.status === "error") {
      body = '<div class="podcast-fullscreen">' + closeBtn +
        '<img src="' + PODCAST_DIR + PODCAST_LIS_IMG + '" class="podcast-bg-img" alt="">' +
        '<div class="podcast-fs-bottom"><div class="processing-box" style="color:#fff"><span>⚠️ ' + esc(pod.error || "La génération a échoué.") + '</span>' +
        '<div style="display:flex;gap:10px">' +
        (pod.errorDetail ? '<button class="btn btn-ghost btn-sm" style="width:auto;margin-top:14px" onclick="App.openPodcastErrorDetail(\'' + pod.id + '\')">Détails</button>' : '') +
        '<button class="btn btn-primary" style="width:auto;margin-top:14px" onclick="App.retryPodcastGeneration(\'' + pod.id + '\')">Réessayer</button>' +
        '</div></div></div></div>';
    } else {
      if (!(pod.id in podcastExpliqueByPod)) podcastExpliqueByPod[pod.id] = Math.floor(Math.random() * PODCAST_EXPLIQUE_IMGS.length);
      body = '<div class="podcast-fullscreen">' + closeBtn +
        '<img id="podcast-papi-img" src="' + PODCAST_DIR + PODCAST_EXPLIQUE_IMGS[podcastExpliqueByPod[pod.id]] + '" class="podcast-bg-img" alt="">' +
        '<div class="podcast-fs-header"><button class="mobile-nav-toggle" style="background:rgba(255,255,255,0.14);border-color:rgba(255,255,255,0.4);color:#fff" onclick="App.toggleMobileNav()" aria-label="Menu">☰</button><div class="podcast-fs-title">' + esc(pod.title) + (pod.partCount > 1 ? ' · Partie ' + pod.partIndex + '/' + pod.partCount : "") + '</div>' +
        '<button class="btn btn-ghost btn-sm" style="width:auto;margin-left:auto;background:rgba(255,255,255,0.14);border-color:rgba(255,255,255,0.4);color:#fff" ' + mp3ButtonAttrs("p:" + pod.id, "⬇️ MP3") + ' onclick="App.downloadPodcastMp3(\'' + pod.id + '\')" title="Télécharger cette partie en MP3">' + mp3ButtonInner("p:" + pod.id, "⬇️ MP3") + '</button>' +
        (pod.partCount > 1 ? '<button class="btn btn-ghost btn-sm" style="width:auto;background:rgba(255,255,255,0.14);border-color:rgba(255,255,255,0.4);color:#fff" ' + mp3ButtonAttrs("g:" + pod.groupId, "⬇️ Tout en 1 MP3") + ' onclick="App.downloadPodcastGroupMp3(\'' + pod.groupId + '\')" title="Télécharger toutes les parties en un seul MP3">' + mp3ButtonInner("g:" + pod.groupId, "⬇️ Tout en 1 MP3") + '</button>' : "") +
        (function () {
          var gid = podcastGroupKey(pod);
          var refreshHtml = podcastRefreshStatusHtml(gid);
          if (refreshHtml) return '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' + refreshHtml + '</div>';
          var hasNew = podcastGroupHasNewContent(podcastGroupParts(gid));
          return '<button class="btn btn-ghost btn-sm" style="width:auto;background:' + (hasNew ? "rgba(255,200,60,0.35)" : "rgba(255,255,255,0.14)") + ';border-color:rgba(255,255,255,0.4);color:#fff" onclick="App.refreshPodcast(\'' + gid + '\')" title="Refait tout le podcast avec les cours à jour (consomme autant de quota voix qu\'un nouveau podcast)">🔄 Actualiser' + (hasNew ? " (nouveau contenu)" : "") + '</button>';
        })() +
        '<button class="btn btn-ghost btn-sm" style="width:auto;background:rgba(255,255,255,0.14);border-color:rgba(255,255,255,0.4);color:#fff" onclick="App.openRenameModal(\'podcast\',null,null,null,\'' + pod.id + '\')" title="Renommer">✏️</button>' +
        '<button class="btn btn-ghost btn-sm" style="width:auto;background:rgba(255,255,255,0.14);border-color:rgba(255,255,255,0.4);color:#fff" onclick="App.askDelete(\'podcast\',null,null,null,\'' + pod.id + '\')" title="Supprimer">' + icon("trash") + '</button>' +
        '</div>' +
        '<div class="podcast-fs-bottom">' +
        '<div id="podcast-subtitle" class="podcast-subtitle">' + (pod.segments && pod.segments[0] ? esc(pod.segments[0].text) : "") + '</div>' +
        '<audio id="podcast-audio" src="' + pod.audioUrl + '" preload="metadata" ' +
        'onplay="document.getElementById(\'podcast-play-icon\').textContent=\'⏸\'" ' +
        'onpause="document.getElementById(\'podcast-play-icon\').textContent=\'▶\'" ' +
        'onended="App.podcastOnEnded()"></audio>' +
        '<div class="podcast-player">' +
        '<div class="podcast-player-row">' +
        '<button class="podcast-ctrl-btn" onclick="App.podcastSkip(-10)" title="Reculer de 10s">⏪</button>' +
        '<button class="podcast-ctrl-btn podcast-ctrl-play" onclick="App.podcastToggleAudio()" title="Lecture/Pause"><span id="podcast-play-icon">▶</span></button>' +
        '<button class="podcast-ctrl-btn" onclick="App.podcastSkip(10)" title="Avancer de 10s">⏩</button>' +
        '</div>' +
        '<input id="podcast-seek" type="range" min="0" max="1000" value="0" oninput="App.podcastSeek(this.value)">' +
        '<div class="podcast-time-row"><span id="podcast-time-cur">0:00</span><span id="podcast-time-dur">' + podcastFormatTime(pod.durationSec) + '</span></div>' +
        '<div class="podcast-rate-row">' + PODCAST_RATES.map(function (r) {
          return '<button class="podcast-rate-btn' + (r === podcastRate ? ' active' : '') + '" data-rate="' + r + '" onclick="App.setPodcastRate(' + r + ')">' + podcastRateLabel(r) + '</button>';
        }).join("") + '</div>' +
        '</div>' +
        '</div></div>';
    }
    renderShell(["podcasts", id], body);
    if (pod.status === "ready") {
      var rateAudio = document.getElementById("podcast-audio");
      if (rateAudio) { rateAudio.defaultPlaybackRate = podcastRate; rateAudio.playbackRate = podcastRate; }
      podcastEnsurePlayerInterval();
      if (podcastAutoPlayNext) {
        podcastAutoPlayNext = false;
        var autoAudio = document.getElementById("podcast-audio");
        if (autoAudio) autoAudio.play().catch(function () {});
      }
    } else if (pod.status === "processing") {
      podcastEnsureProcessingTimer(pod.processingStartedAt || pod.createdAt || Date.now());
    }
  }
  // Chrono écoulé pendant la génération (texte puis voix) — on ne connaît pas de durée totale fixe à
  // l'avance (ça dépend du nombre de parties décidé par l'IA), donc un vrai compte à rebours serait
  // trompeur : on affiche le temps déjà écoulé, pour au moins rassurer que ça travaille toujours.
  // S'auto-arrête dès que l'élément disparaît (navigation ailleurs), même schéma que le lecteur audio.
  function podcastEnsureProcessingTimer(startedAt) {
    if (podcastProcessingInterval) clearInterval(podcastProcessingInterval);
    podcastProcessingInterval = setInterval(function () {
      var el = document.getElementById("podcast-processing-timer");
      if (!el) { clearInterval(podcastProcessingInterval); podcastProcessingInterval = null; return; }
      el.textContent = "⏱️ " + dpFormatCountdown(Date.now() - startedAt);
    }, 1000);
  }
  // Rien à voir avec render() : un re-rendu complet recréerait l'élément <audio> et couperait la
  // lecture en cours. On met donc à jour la barre de progression, le chrono, les sous-titres et la
  // rotation du papy directement dans le DOM via un intervalle léger, qui s'auto-arrête dès que le
  // lecteur n'est plus affiché (navigation vers une autre page).
  function podcastEnsurePlayerInterval() {
    if (podcastPlayerInterval) return;
    var lastImgSwitch = Date.now();
    podcastPlayerInterval = setInterval(function () {
      var a = document.getElementById("podcast-audio");
      if (!a) { clearInterval(podcastPlayerInterval); podcastPlayerInterval = null; return; }
      var parts = location.hash.replace(/^#\//, "").split("/");
      var pod = parts[0] === "podcasts" && parts[1] ? podcastFind(parts[1]) : null;
      if (!pod) return;
      var dur = a.duration || pod.durationSec || 0;
      var seekEl = document.getElementById("podcast-seek");
      if (seekEl && dur) seekEl.value = String(Math.round((a.currentTime / dur) * 1000));
      var curEl = document.getElementById("podcast-time-cur");
      if (curEl) curEl.textContent = podcastFormatTime(a.currentTime);
      var subEl = document.getElementById("podcast-subtitle");
      if (subEl && pod.segments && pod.segments.length) {
        var seg = pod.segments.find(function (s) { return a.currentTime >= s.start && a.currentTime < s.end; });
        if (!seg) {
          // Pendant la petite pause entre deux phrases, le temps ne tombe dans AUCUN segment : on
          // garde le dernier segment déjà commencé plutôt que de retomber sur le tout dernier segment
          // du podcast (ancien bug : ça faisait flasher une phrase de la fin à chaque pause).
          for (var si = pod.segments.length - 1; si >= 0; si--) {
            if (pod.segments[si].start <= a.currentTime) { seg = pod.segments[si]; break; }
          }
          if (!seg) seg = pod.segments[0];
        }
        if (seg) subEl.textContent = seg.text;
      }
      if (Date.now() - lastImgSwitch > 60000) {
        lastImgSwitch = Date.now();
        var nextIdx = (podcastExpliqueByPod[pod.id] + 1) % PODCAST_EXPLIQUE_IMGS.length;
        podcastExpliqueByPod[pod.id] = nextIdx;
        var imgEl = document.getElementById("podcast-papi-img");
        if (imgEl) imgEl.src = PODCAST_DIR + PODCAST_EXPLIQUE_IMGS[nextIdx];
      }
    }, 400);
  }

  /* ---------------- Méthodologies (pages) ---------------- */
  function subjectChaptersWithContent(subj) {
    var out = [];
    (subj.themes || []).forEach(function (t) {
      (t.chapters || []).forEach(function (c) {
        if ((c.courses || []).some(dpCourseHasContent)) out.push({ id: c.id, name: c.name, themeId: t.id, themeName: t.name });
      });
    });
    return out;
  }
  function findChapterAnywhere(subj, chapterId) {
    var found = null;
    (subj.themes || []).some(function (t) { return (t.chapters || []).some(function (c) { if (c.id === chapterId) { found = c; return true; } return false; }); });
    return found;
  }
  function chapterContentText(subj, chapterId) {
    var chap = findChapterAnywhere(subj, chapterId);
    if (!chap) return "";
    return (chap.courses || []).filter(dpCourseHasContent).map(function (co) {
      return "### " + co.title + "\n" + stripFigureMarkdown(co.transcription || "");
    }).join("\n\n");
  }
  // Pour un podcast portant sur "tout un thème" : agrège tous les chapitres du thème.
  function themeContentText(subj, themeId) {
    var theme = findTheme(subj, themeId);
    if (!theme) return "";
    var blocks = [];
    (theme.chapters || []).forEach(function (c) {
      (c.courses || []).filter(dpCourseHasContent).forEach(function (co) {
        blocks.push("### " + c.name + " — " + co.title + "\n" + stripFigureMarkdown(co.transcription || ""));
      });
    });
    return blocks.join("\n\n");
  }

  function renderMethodologyListPage() {
    var list = methodoData().slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    var head = '<div class="page-head"><div><div class="page-title-row"><img class="page-title-logo" src="assets/objects/ui/Méthodologie.png" alt=""><h1 class="page-title">Méthodologie</h1></div><p class="page-sub">Les méthodes données par tes profs (dissertation, commentaire, étude de document...) — Studino génère des sujets à rédiger dessus, pas du quiz sur la méthode.</p></div>' +
      '<button class="btn btn-primary" style="width:auto" onclick="App.openModal(\'methodologie\')">' + icon("plus") + ' Ajouter une méthodologie</button></div>';
    var grid;
    if (!list.length) {
      grid = '<div class="empty-state">' + sprite("dinoBig", 5, { bob: true }) + '<h3>Aucune méthodologie</h3><p>Importe la méthode donnée par ton prof pour un type d\'épreuve (dissertation, commentaire, étude de document...).</p>' +
        '<button class="btn btn-primary" style="width:auto;margin-top:14px" onclick="App.openModal(\'methodologie\')">' + icon("plus") + ' Ajouter une méthodologie</button></div>';
    } else {
      grid = '<div class="card-grid">' + list.map(function (m) {
        var statusHtml = m.status === "processing" ? '<span class="status-pill status-processing"><span class="dotpulse"></span>Analyse…' + genPillPct(m.id) + '</span>'
          : m.status === "error" ? '<span class="status-pill status-processing">⚠️ Erreur</span>'
          : '<span class="status-pill status-ready">' + (m.practiceItems || []).length + ' sujet' + ((m.practiceItems || []).length > 1 ? "s" : "") + '</span>';
        return '<div class="tile" onclick="location.hash=\'#/methodologies/' + m.id + '\'">' +
          '<button class="tile-del" title="Supprimer" onclick="event.stopPropagation();App.askDelete(\'methodology\',null,null,null,\'' + m.id + '\')">' + icon("trash") + '</button>' +
          '<div class="tile-icon">' + icon("book") + '</div>' +
          '<div class="tile-title">' + esc(m.title) + '</div>' +
          (m.genre ? '<span class="demo-badge">' + esc(m.genre) + '</span>' : '') +
          statusHtml +
          '</div>';
      }).join("") + '<button class="add-tile" onclick="App.openModal(\'methodologie\')">' + icon("plus") + ' Ajouter une méthodologie</button></div>';
    }
    renderShell(["methodologies"], head + grid);
  }
  function methodologyItemHtml(methodo, item, defaultOpen) {
    var mechLabel = item.customMechanic || METHODOLOGY_MECHANIC_LABELS[item.mechanic] || item.mechanic;
    var isOpen = methodoItemOpen.hasOwnProperty(item.id) ? methodoItemOpen[item.id] : !!defaultOpen;
    var dateLabel = item.createdAt ? new Date(item.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "";
    var statusBadge;
    if (item.status === "graded") {
      var badgeTier = "grade-" + gradeLevelFromGrade20(item.grade20);
      statusBadge = '<span class="grade-pill ' + badgeTier + '">' + item.grade20 + '/20</span>';
    } else if (item.status === "grading") {
      statusBadge = '<span class="status-pill status-processing"><span class="dotpulse"></span>Correction…</span>';
    } else {
      statusBadge = '<span class="status-pill status-ready">À rédiger</span>';
    }
    var deleteBtn = '<button class="btn btn-ghost btn-sm" style="width:auto" title="Supprimer ce sujet" onclick="event.stopPropagation();App.deleteMethodoItem(\'' + methodo.id + '\',\'' + item.id + '\')">' + icon("trash") + '</button>';
    if (!isOpen) {
      var subjectPreview = (item.subject || "").replace(/[#*_`]/g, "").trim();
      if (subjectPreview.length > 110) subjectPreview = subjectPreview.slice(0, 110) + "…";
      return '<div class="dp-exercise-item" style="margin-bottom:14px;padding:14px 16px;cursor:pointer" onclick="App.toggleMethodoItem(\'' + item.id + '\')">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
        '<div style="flex:1;min-width:0">' +
        '<div class="quiz-q-num" style="margin-bottom:4px">' + esc(mechLabel) + (item.chapterName ? " · " + esc(item.chapterName) : "") + (dateLabel ? " · " + dateLabel : "") + '</div>' +
        '<div style="font-size:13px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(subjectPreview) + '</div>' +
        '</div>' + statusBadge + deleteBtn +
        '</div></div>';
    }
    var docHtml = item.document ? (
      '<div class="dp-exercise-box" style="margin-bottom:14px">' +
      '<div class="dp-exercise-label">Document — ' + esc(item.document.author || "?") + (item.document.sourceTitle ? ", " + esc(item.document.sourceTitle) : "") + (item.document.date ? " (" + esc(item.document.date) + ")" : "") + '</div>' +
      '<div class="dp-exercise-text">' + mdToHtml(item.document.excerpt || "") + '</div>' +
      (item.document.sourceUrl ? '<a href="' + esc(item.document.sourceUrl) + '" target="_blank" rel="noopener noreferrer" style="font-size:11.5px;color:var(--text-muted);display:inline-block;margin-top:8px">🔗 Source</a>' : '') +
      '</div>'
    ) : "";
    var subjectHtml = '<div class="quiz-q-num">' + esc(mechLabel) + (item.chapterName ? " · " + esc(item.chapterName) : "") + '</div>' +
      '<div class="quiz-q-text">' + mdToHtml(item.subject) + '</div>';
    var answerArea;
    if (item.status === "grading") {
      answerArea = '<div class="processing-box">' + genLogo() + '<span>Correction en cours… (la sévérité prend un peu plus de temps qu\'un simple correct/faux)</span></div>';
    } else if (item.status === "graded") {
      var tier = gradeLevelFromGrade20(item.grade20);
      answerArea = '<div class="rte-display" style="color:var(--text-muted);font-size:13.5px;margin-bottom:6px">Ta réponse :</div>' +
        '<div class="rte-display" style="margin-bottom:14px">' + (item.answerHtml || "<em>(vide)</em>") + '</div>' +
        '<div class="quiz-feedback ' + tier + '">' +
        '<div class="quiz-feedback-title ' + tier + '" style="display:flex;justify-content:space-between;align-items:center;gap:10px">' +
        '<span>' + esc(item.verdict) + '</span><span class="mono" style="font-size:18px;flex:none">' + item.grade20 + '/20</span></div>' +
        (item.strengths && item.strengths.length ? '<div class="correction-exp"><strong>Points forts :</strong><ul>' + item.strengths.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + '</ul></div>' : '') +
        (item.weaknesses && item.weaknesses.length ? '<div class="correction-exp"><strong>Points faibles :</strong><ul>' + item.weaknesses.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + '</ul></div>' : '') +
        '<div class="correction-exp">' + mdToHtml(item.detailedFeedback || "") + '</div>' +
        '</div>' +
        (item.referencePlan ? '<div class="dp-exercise-box" style="margin-top:14px"><div class="dp-exercise-label">Corrigé de référence</div><div class="dp-exercise-text">' + mdToHtml(item.referencePlan) + '</div></div>' : '');
    } else {
      answerArea = '<div class="field">' + richEditorHtml("methodo-answer-" + item.id, item.mechanic === "plan" ? "Rédige ton plan détaillé (parties, sous-parties, idées et exemples)…" : "Rédige ta réponse…", item.answerHtml || "", true) + '</div>' +
        '<button class="btn btn-primary" style="width:auto" onclick="App.submitMethodoAnswer(\'' + methodo.id + '\',\'' + item.id + '\')">Valider ma réponse</button>';
    }
    var collapseBtn = '<button class="btn btn-ghost btn-sm" style="width:auto" onclick="App.toggleMethodoItem(\'' + item.id + '\')">▲ Replier</button>';
    var itemHead = '<div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:8px">' + collapseBtn + deleteBtn + '</div>';
    return '<div class="dp-exercise-item" style="margin-bottom:26px;padding-bottom:22px;border-bottom:2px solid var(--border-soft)">' + itemHead + docHtml + subjectHtml + '<div style="margin-top:14px">' + answerArea + '</div></div>';
  }
  function renderMethodologyDetailPage(id) {
    var methodo = methodoFind(id);
    if (!methodo) { navigate("#/methodologies"); return; }
    var head = '<div class="course-head">' +
      '<div><h1 class="page-title" style="margin-bottom:6px">' + esc(methodo.title) + '</h1>' +
      '<p class="page-sub">' + (methodo.genre ? esc(methodo.genre) : "Méthodologie") + '</p></div>' +
      '<div style="display:flex;gap:10px;margin-left:auto;align-items:center">' +
      (methodo.status === "ready" ? '<div class="print-scale-ctrl" title="Taille de la police à l\'impression"><button class="btn btn-ghost btn-sm" style="width:auto;padding:4px 10px" onclick="App.adjustPrintScale(-0.1)">−</button><span class="mono" style="min-width:42px;text-align:center;display:inline-block">' + Math.round(getPrintScale() * 100) + '%</span><button class="btn btn-ghost btn-sm" style="width:auto;padding:4px 10px" onclick="App.adjustPrintScale(0.1)">+</button></div>' : "") +
      (methodo.status === "ready" ? '<button class="btn btn-ghost btn-sm" style="width:auto" onclick="App.downloadMethodologyPdf(\'' + methodo.id + '\')">⬇️ Télécharger en PDF</button>' : "") +
      (methodo.status === "ready" && methodo.images && methodo.images.length ? '<button class="btn btn-ghost btn-sm" style="width:auto" onclick="App.retryMethodologyGeneration(\'' + methodo.id + '\')">🔄 Régénérer</button>' : "") +
      '<button class="btn btn-ghost btn-sm" style="width:auto" onclick="App.askDelete(\'methodology\',null,null,null,\'' + methodo.id + '\')">' + icon("trash") + ' Supprimer</button>' +
      '</div></div>';
    var body;
    if (methodo.status === "processing") {
      body = '<div class="processing-box">' + genLogo() + genProgressHtml(methodo.id, "Gemini analyse ta méthodologie…") + '</div>';
    } else if (methodo.status === "error") {
      body = '<div class="processing-box"><span>⚠️ ' + esc(methodo.error || "L'analyse a échoué.") + '</span>' +
        '<button class="btn btn-primary" style="width:auto;margin-top:14px" onclick="App.retryMethodologyGeneration(\'' + methodo.id + '\')">Réessayer</button></div>';
    } else {
      var structureBox = '<div class="dp-exercise-box"><div class="dp-exercise-label">Méthode retenue</div><div class="dp-exercise-text">' + mdToHtml(methodo.structure) + '</div></div>';
      var transcriptionOpen = !!methodoTranscriptionOpen[methodo.id];
      var transcriptionBox = methodo.transcription ? (
        '<button class="ep-day-fc-toggle" style="margin:10px 0" onclick="App.toggleMethodoTranscription(\'' + methodo.id + '\')">' + (transcriptionOpen ? "▾" : "▸") + ' Document original du prof (pour vérifier que rien n\'a été perdu)</button>' +
        (transcriptionOpen ? '<div class="dp-exercise-box" style="margin-bottom:14px"><div class="dp-exercise-text">' + mdToHtml(methodo.transcription) + '</div></div>' : '')
      ) : '';
      var allSubs = userData().subjects;
      var st = methodoTrainState[methodo.id];
      if (!st) { st = methodoTrainState[methodo.id] = { subjectId: allSubs[0] ? allSubs[0].id : "", chapterId: "", mechanic: methodo.mechanics[0] || "redaction", customMechanic: "" }; }
      var stSubj = findSubject(st.subjectId) || allSubs[0];
      if (stSubj) st.subjectId = stSubj.id;
      var chapters = stSubj ? subjectChaptersWithContent(stSubj) : [];
      if (!chapters.some(function (c) { return c.id === st.chapterId; })) st.chapterId = chapters[0] ? chapters[0].id : "";
      var subjectOptionsT = allSubs.map(function (s) { return '<option value="' + s.id + '" ' + (s.id === st.subjectId ? "selected" : "") + '>' + esc(s.name) + '</option>'; }).join("");
      var chapterOptions = chapters.map(function (c) { return '<option value="' + c.id + '" ' + (c.id === st.chapterId ? "selected" : "") + '>' + esc(c.themeName + " / " + c.name) + '</option>'; }).join("");
      var mechanicChoices = methodo.mechanics.concat([METHODOLOGY_MECHANIC_CUSTOM]);
      var mechanicOptions = mechanicChoices.map(function (m) { return '<option value="' + m + '" ' + (m === st.mechanic ? "selected" : "") + '>' + (m === METHODOLOGY_MECHANIC_CUSTOM ? "Autre (à préciser)" : esc(METHODOLOGY_MECHANIC_LABELS[m] || m)) + '</option>'; }).join("");
      var trainPanel = '<div class="dp-section"><h3 class="dp-section-title">S\'entraîner</h3>' +
        (allSubs.length
          ? '<div class="field"><label>Matière</label><select onchange="App.setMethodoTrainSubject(\'' + methodo.id + '\',this.value)">' + subjectOptionsT + '</select></div>' +
            (chapters.length
              ? '<div class="field"><label>Chapitre</label><select onchange="App.setMethodoTrainChapter(\'' + methodo.id + '\',this.value)">' + chapterOptions + '</select></div>' +
                '<div class="field"><label>Type d\'entraînement</label><select onchange="App.setMethodoTrainMechanic(\'' + methodo.id + '\',this.value)">' + mechanicOptions + '</select></div>' +
                (st.mechanic === METHODOLOGY_MECHANIC_CUSTOM ? '<div class="field"><label>Précise ce que tu veux comme entraînement</label><input value="' + esc(st.customMechanic || "") + '" placeholder="Ex. Rédiger uniquement la conclusion" oninput="App.setMethodoTrainCustom(\'' + methodo.id + '\',this.value)"></div>' : "") +
                '<button class="btn btn-primary" style="width:auto" ' + (methodo.generatingPractice ? "disabled" : "") + ' onclick="App.generateMethodoSubject(\'' + methodo.id + '\')">' + (methodo.generatingPractice ? "Génération du sujet…" : "🎲 Nouveau sujet") + '</button>'
              : '<p class="modal-warn">La matière « ' + esc(stSubj.name) + ' » n\'a encore aucun cours généré — génère au moins un cours avant de t\'entraîner, ou choisis une autre matière.</p>')
          : '<p class="modal-warn">Crée d\'abord une matière avec au moins un cours généré.</p>') +
        '</div>';
      var itemsHtml = (methodo.practiceItems || []).map(function (item, idx) { return methodologyItemHtml(methodo, item, idx === 0 || item.status !== "graded"); }).join("");
      body = structureBox + transcriptionBox + trainPanel + (itemsHtml || '<p class="dp-empty-note">Aucun sujet généré pour l\'instant.</p>');
    }
    renderShell(["methodologies", id], head + '<div class="exercise-layout"><div class="quiz-wrap quiz-wrap-exercise">' + body + '</div>' + dinoCompanionHtml() + '</div>');
  }

  /* ---------------- Course page ---------------- */
  var TABS = [
    { id: "transcription", label: "Retranscription" },
    { id: "explication", label: "Explication" },
    { id: "videos", label: "Vidéos" },
    { id: "flashcards", label: "Flashcards" },
    { id: "quiz", label: "Contrôle" }
  ];

  function renderRevisionSheetPage(sheetId) {
    var sheet = userData().revisionSheets.find(function (x) { return x.id === sheetId; });
    if (!sheet) { navigate("#/"); return; }
    var subj = findSubject(sheet.subjectId);
    var theme = subj && findTheme(subj, sheet.themeId);
    var chap = theme && findChapter(theme, sheet.chapterId);
    var head = '<div class="course-head"><div><h1 class="page-title" style="margin-bottom:6px">📋 ' + esc(sheet.title) + '</h1>' +
      '<p class="page-sub">' + (subj ? esc(subj.name) : "") + (theme ? ' · ' + esc(theme.name) : "") + (chap ? ' · ' + esc(chap.name) : "") + ' · Fiche de ' + (sheet.scope === "course" ? "cours" : sheet.scope === "theme" ? "thème" : "chapitre") + '</p></div>' +
      '<div style="display:flex;gap:10px;margin-left:auto;align-items:center">' +
      (sheet.status === "ready" ? '<div class="print-scale-ctrl" title="Taille de la police à l\'impression"><button class="btn btn-ghost btn-sm" style="width:auto;padding:4px 10px" onclick="App.adjustPrintScale(-0.1)">−</button><span class="mono" style="min-width:42px;text-align:center;display:inline-block">' + Math.round(getPrintScale() * 100) + '%</span><button class="btn btn-ghost btn-sm" style="width:auto;padding:4px 10px" onclick="App.adjustPrintScale(0.1)">+</button></div>' : "") +
      (sheet.status === "ready" ? '<button class="btn btn-ghost btn-sm" style="width:auto" onclick="App.downloadRevisionSheetPdf(\'' + sheet.id + '\')">⬇️ Télécharger en PDF</button>' : "") +
      (sheet.status === "ready" ? '<button class="btn btn-ghost btn-sm" style="width:auto" onclick="App.viewRevisionSheetRaw(\'' + sheet.id + '\')">📄 Texte brut</button>' : "") +
      '<button class="btn btn-ghost btn-sm" style="width:auto" onclick="App.askDelete(\'revisionSheet\',null,null,null,\'' + sheet.id + '\')">' + icon("trash") + ' Supprimer</button>' +
      '</div>' +
      '</div>';
    var body;
    if (sheet.status === "processing") {
      body = '<div class="processing-box">' + genLogo() + genProgressHtml(sheet.id, "Gemini rédige ta fiche…") + '</div>';
    } else if (sheet.status === "error") {
      body = '<div class="processing-box"><span>⚠️ ' + esc(sheet.error || "La génération a échoué.") + '</span>' +
        '<div style="display:flex;gap:10px">' +
        (sheet.errorDetail ? '<button class="btn btn-ghost btn-sm" style="width:auto;margin-top:14px" onclick="App.openRevisionSheetErrorDetail(\'' + sheet.id + '\')">Détails</button>' : '') +
        '<button class="btn btn-primary" style="width:auto;margin-top:14px" onclick="App.retryRevisionSheetGeneration(\'' + sheet.id + '\')">Réessayer</button>' +
        '</div></div>';
    } else {
      body = '<div class="prose">' + mdToHtml(sheet.content, sheet.schemas) + '</div>' + exerciseFigureHtml({ prompt: sheet.content });
    }
    renderShell(["revision", sheetId], head + body, { narrow: true });
  }

  /* ---------------- Prépa examens (pages) ---------------- */
  function renderExamPrepListPage() {
    var list = epData().slice().sort(function (a, b) { return a.examDate < b.examDate ? -1 : (a.examDate > b.examDate ? 1 : 0); });
    var head = '<div class="page-head"><div><div class="page-title-row"><img class="page-title-logo" src="assets/objects/ui/MissionControle.png" alt=""><h1 class="page-title">Mission Contrôle</h1></div><p class="page-sub">Étale tes révisions sur plusieurs jours au lieu de tout faire la veille.</p></div>' +
      '<button class="btn btn-metal" style="width:auto" onclick="App.openExamPrepModal()">' + icon("plus") + ' Nouvelle prépa</button></div>';
    var grid;
    if (!list.length) {
      grid = '<div class="empty-state">' + sprite("dinoBig", 5, { bob: true }) + '<h3>Aucune prépa en cours</h3><p>Indique la date de ton prochain examen : Studino te prépare un planning de révision jour par jour.</p>' +
        '<button class="btn btn-metal" style="width:auto;margin-top:14px" onclick="App.openExamPrepModal()">' + icon("plus") + ' Nouvelle prépa</button></div>';
    } else {
      var today = epTodayStr();
      grid = '<div class="card-grid-signs-short">' + list.map(function (p) {
        var daysLeft = epDaysBetween(today, p.examDate);
        var todaySession = p.sessions && p.sessions[today];
        var statusHtml = p.planStatus === "processing" ? '<span class="status-pill status-processing"><span class="dotpulse"></span>Planning…' + genPillPct(p.id) + '</span>'
          : p.planStatus === "error" ? '<span class="status-pill status-processing">⚠️ Erreur</span>'
          : daysLeft < 0 ? '<span class="status-pill status-ready">Examen passé</span>'
          : daysLeft === 0 ? '<span class="status-pill status-ready">Examen aujourd\'hui !</span>'
          : '<span class="status-pill status-ready">' + (todaySession && todaySession.status === "done" ? "✅ Fait aujourd'hui" : "J-" + daysLeft) + '</span>';
        return '<div class="tile tile-sign tile-sign-metal ep-tile-tall" onclick="location.hash=\'#/examprep/' + p.id + '\'">' +
          '<button class="tile-del" title="Supprimer" onclick="event.stopPropagation();App.askDelete(\'examPrep\',null,null,null,\'' + p.id + '\')">' + icon("trash") + '</button>' +
          '<div class="tile-icon">' + icon("calendar") + '</div>' +
          '<div class="tile-title">' + esc(p.title) + '</div>' +
          '<div class="tile-meta">' + esc(epScopeLabel(p.scope)) + '</div>' +
          (p.planStatus === "ready" ? epReadinessBarHtml(epReadinessPercent(p), true) : "") +
          statusHtml +
          '</div>';
      }).join("") + '<button class="add-tile" onclick="App.openExamPrepModal()">' + icon("plus") + ' Nouvelle prépa</button></div>';
    }
    renderShell(["examprep"], head + grid);
  }

  function renderExamPrepSession(prep) {
    var s = epSession;
    var backBtn = '<button class="btn btn-ghost" style="width:auto;margin-bottom:20px" onclick="App.examPrepExitSession()">← Retour à la prépa</button>';
    var liveTimer = (s.status !== "reviewing" && !s.done) ? '<div class="ep-session-timer mono" id="ep-session-timer">⏱️ ' + dpFormatCountdown(Date.now() - s.startedAt) + '</div>' : "";
    var head = '<div class="page-head"><div><h1 class="page-title">' + esc(prep.title) + '</h1><p class="page-sub">Entraînement du ' + esc(epFormatDateFr(s.date)) + '</p></div>' + liveTimer + '</div>';
    if (s.status === "reviewing") {
      renderShell(["examprep", prep.id], head + '<div class="processing-box">' + genLogo() + '<span>Studino analyse ta séance…</span></div>');
      return;
    }
    if (s.done) {
      var items = s.history.map(function (h) {
        var level = h.level || (h.wasCorrect ? "correct" : "wrong");
        var cls = gradeLevelCls(level);
        return '<div class="correction-item ' + cls + '">' +
          '<div class="correction-q">' + mdToHtml(h.prompt || "") + '<span class="grade-pill grade-' + cls + '">' + gradeLevelLabel(level) + '</span></div>' + exerciseFigureHtml(h) +
          '<div class="correction-ans ' + (h.wasCorrect ? "good" : "bad") + '">Ta réponse : ' + esc(h.yourAnswer || "(vide)") + '</div>' +
          gradeMistakesHtml(h.mistakes) +
          (level === "correct" ? '' : '<div class="correction-ans good"><b>Bonne réponse :</b>' + mdToHtml(h.correctAnswer || "") + '</div>') +
          '<div class="correction-exp">' + mdToHtml(h.explanation || "") + '</div>' +
          '</div>';
      }).join("");
      var reviewGroup = function (list, cls, title) {
        return (list && list.length) ? '<div class="ep-review-group ' + cls + '"><div class="ep-review-title">' + title + '</div>' + list.map(function (entry) {
          return '<div class="ep-review-entry"><span class="ep-review-chip">' + esc(entry.topic) + '</span>' + gradeMistakesHtml(entry.mistakes) + '</div>';
        }).join("") + '</div>' : "";
      };
      var reviewHtml = s.review ? '<div class="ep-review">' +
        reviewGroup(s.review.mastered, "ep-review-good", "✅ Maîtrisé") +
        reviewGroup(s.review.unclear, "ep-review-mid", "🤔 Dans le flou") +
        reviewGroup(s.review.weak, "ep-review-bad", "⚠️ Lacunes") +
        '</div>' : "";
      var readinessDelta = s.readinessAfter != null && s.readinessAfter !== s.readinessBefore
        ? '<div class="result-total">Niveau de préparation : ' + s.readinessBefore + '% → <strong>' + s.readinessAfter + '%</strong></div>' : "";
      renderShell(["examprep", prep.id], head +
        '<div class="result-hero"><div class="result-score mono">' + s.correct + '/' + s.pool.length + '</div><div class="result-total">bonnes réponses aujourd\'hui</div>' +
        (s.durationMs ? '<div class="result-total">⏱️ Temps passé : ' + dpFormatCountdown(s.durationMs) + '</div>' : '') +
        (s.pointsEarned ? '<div class="result-total">🪙 +' + s.pointsEarned + ' pts Dino Park</div>' : '') +
        readinessDelta +
        (s.newFlashcardsCount ? '<div class="result-total">📇 +' + s.newFlashcardsCount + ' flashcards de lacunes créées</div>' : '') + '</div>' +
        (s.readinessAfter != null ? epReadinessBarHtml(s.readinessAfter, false) : "") +
        reviewHtml +
        '<button class="btn btn-ghost" style="width:auto;margin:0 auto 26px;display:flex" onclick="App.examPrepExitSession()">Retour à la prépa</button>' +
        '<h3 style="font-size:16px;margin-bottom:12px">Correction</h3>' + items);
      return;
    }
    var item = s.pool[s.idx];
    if (item.kind === "methodo") {
      var mMethodo = methodoFind(item.methodologyId);
      var mMechLabel = item.customMechanic || METHODOLOGY_MECHANIC_LABELS[item.mechanic] || item.mechanic;
      var mBody = '<div class="quiz-q-num">' + esc(mMechLabel) + (mMethodo ? " · " + esc(mMethodo.genre || mMethodo.title) : "") + (item.chapterName ? " · " + esc(item.chapterName) : "") + '</div>';
      if (item.document) {
        mBody += '<div class="dp-exercise-box" style="margin-bottom:14px"><div class="dp-exercise-label">Document — ' + esc(item.document.author || "?") + (item.document.sourceTitle ? ", " + esc(item.document.sourceTitle) : "") + (item.document.date ? " (" + esc(item.document.date) + ")" : "") + '</div><div class="dp-exercise-text">' + mdToHtml(item.document.excerpt || "") + '</div>' +
          (item.document.sourceUrl ? '<a href="' + esc(item.document.sourceUrl) + '" target="_blank" rel="noopener noreferrer" style="font-size:11.5px;color:var(--text-muted);display:inline-block;margin-top:8px">🔗 Source</a>' : '') + '</div>';
      }
      mBody += '<div class="quiz-q-text">' + mdToHtml(item.subject) + '</div>';
      if (item.status === "grading") {
        mBody += '<div class="processing-box">' + genLogo() + '<span>Correction en cours… (la sévérité prend un peu plus de temps qu\'un simple correct/faux)</span></div>';
      } else if (item.status !== "graded") {
        mBody += '<div class="field">' + richEditorHtml("ep-methodo-answer", item.mechanic === "plan" ? "Rédige ton plan détaillé (parties, sous-parties, idées et exemples)…" : "Rédige ta réponse…", item.answerHtml || "", true) + '</div>' +
          '<button class="btn btn-primary" style="width:auto" onclick="App.examPrepSubmitMethodoAnswer()">Valider ma réponse</button>';
      } else {
        var mTier = gradeLevelFromGrade20(item.grade20);
        mBody += '<div class="rte-display" style="color:var(--text-muted);font-size:13.5px;margin-bottom:6px">Ta réponse :</div>' +
          '<div class="rte-display" style="margin-bottom:14px">' + (item.answerHtml || "<em>(vide)</em>") + '</div>' +
          '<div class="quiz-feedback ' + mTier + '">' +
          '<div class="quiz-feedback-title ' + mTier + '" style="display:flex;justify-content:space-between;gap:10px"><span>' + esc(item.verdict) + '</span><span class="mono" style="font-size:18px;flex:none">' + item.grade20 + '/20</span></div>' +
          (item.strengths && item.strengths.length ? '<div class="correction-exp"><strong>Points forts :</strong><ul>' + item.strengths.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + '</ul></div>' : '') +
          (item.weaknesses && item.weaknesses.length ? '<div class="correction-exp"><strong>Points faibles :</strong><ul>' + item.weaknesses.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + '</ul></div>' : '') +
          '<div class="correction-exp">' + mdToHtml(item.detailedFeedback || "") + '</div>' +
          '</div>' +
          (item.referencePlan ? '<div class="dp-exercise-box" style="margin-top:14px"><div class="dp-exercise-label">Corrigé de référence</div><div class="dp-exercise-text">' + mdToHtml(item.referencePlan) + '</div></div>' : '') +
          '<div class="quiz-nav" style="margin-top:14px"><span></span><button class="btn btn-primary" style="width:auto" onclick="App.examPrepNext()">' + (s.idx === s.pool.length - 1 ? "Terminer" : "Suivante →") + '</button></div>';
      }
      renderShell(["examprep", prep.id], backBtn + head + '<div class="exercise-layout"><div class="quiz-wrap quiz-wrap-exercise">' + mBody + '</div>' + dinoCompanionHtml() + '</div>');
      return;
    }
    var body = '<div class="quiz-q-num">Question ' + (s.idx + 1) + ' / ' + s.pool.length + (item.kind === "exercise" ? " · Exercice" : "") + ' · ≈ ' + Math.max(1, epPoolMinutes(s.pool.slice(s.idx))) + ' min restantes</div>';
    if (item.kind === "exercise") {
      body += '<div class="dp-exercise-box"><div class="dp-exercise-label">Exercice</div><div class="dp-exercise-text">' + mdToHtml(splitInlineNumberedQuestions(item.prompt)) + '</div></div>' + exerciseFigureHtml(item);
    } else {
      body += '<div class="quiz-q-text">' + mdToHtml(item.prompt) + '</div>' + exerciseFigureHtml(item);
    }
    if (item.kind === "qcm") {
      body += item.choices.map(function (c, i) {
        var cls = "quiz-choice";
        var attrs = "";
        if (s.revealed) {
          cls += " disabled";
          if (i === item.correctIndex) cls += " correct";
          else if (i === s.answer) cls += " wrong";
        } else {
          attrs = ' onclick="App.examPrepAnswerQcm(' + i + ')"';
        }
        return '<label class="' + cls + '"' + attrs + '><input type="radio" ' + (s.answer === i ? "checked" : "") + ' readonly disabled><span>' + esc(c) + '</span></label>';
      }).join("");
    } else if (s.status === "grading") {
      body += '<div class="processing-box">' + genLogo() + '<span>Correction en cours…</span></div>';
    } else if (s.status !== "graded") {
      body += '<div class="field">' + richEditorHtml("ep-open-answer", "Écris ton raisonnement et ta réponse…", s.answerHtml || "", item.kind === "exercise") + '</div>' +
        '<button class="btn btn-primary" style="width:auto" onclick="App.examPrepSubmitOpenAnswer()">Valider</button>';
    } else if (item.kind === "exercise") {
      body += '<div class="rte-display" style="color:var(--text-muted);font-size:13.5px;margin-bottom:6px">Ta réponse :</div>' +
        '<div class="rte-display" style="margin-bottom:14px">' + (s.answerHtml || "<em>(vide)</em>") + '</div>';
    } else {
      body += '<div class="rte-display" style="color:var(--text-muted);font-size:13.5px;margin-bottom:6px">Ta réponse :</div>' +
        '<div class="rte-display" style="margin-bottom:14px">' + (s.answerHtml || "<em>(vide)</em>") + '</div>' +
        '<div style="font-size:13.5px;margin-bottom:14px"><b>Réponse attendue :</b>' + mdToHtml(item.answer || "") + '</div>';
    }
    if (s.revealed && s.wasCorrect != null) {
      var slvl = s.level || (s.wasCorrect ? "correct" : "wrong");
      var scls = gradeLevelCls(slvl);
      body += '<div class="quiz-feedback ' + scls + '">' +
        '<div class="quiz-feedback-title ' + scls + '" style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span>' + gradeLevelLabel(slvl) + '</span>' + gradeScoreBadge(s.score, s.scoreMax) + '</div>' +
        gradeMistakesHtml(s.mistakes) +
        (s.aiFeedback ? '<div class="correction-exp">' + mdToHtml(s.aiFeedback) + '</div>' : "") +
        (item.kind === "exercise" ? '' : '<div class="correction-exp">' + mdToHtml(item.explanation || "") + '</div>') +
        '</div>' +
        (item.kind === "exercise" ? '<div class="dp-exercise-box" style="margin-top:14px"><div class="dp-exercise-label">Solution de référence</div><div class="dp-exercise-text">' + mdToHtml(splitInlineNumberedQuestions(item.solution)) + '</div></div>' : '') +
        '<div class="quiz-nav" style="margin-top:14px"><span></span><button class="btn btn-primary" style="width:auto" onclick="App.examPrepNext()">' + (s.idx === s.pool.length - 1 ? "Terminer" : "Suivante →") + '</button></div>';
    }
    renderShell(["examprep", prep.id], backBtn + head + '<div class="exercise-layout"><div class="quiz-wrap">' + body + '</div>' + dinoCompanionHtml() + '</div>');
  }

  function epReadinessTier(pct) {
    return pct < 30 ? "low" : pct < 60 ? "mid" : pct < 80 ? "okay" : pct < 95 ? "good" : "ready";
  }
  function epReadinessBarHtml(pct, compact) {
    var tier = epReadinessTier(pct);
    return '<div class="ep-readiness' + (compact ? " ep-readiness-compact" : "") + '">' +
      '<div class="ep-readiness-head"><span>Niveau de préparation : <strong>' + pct + '%</strong></span>' +
      (compact ? "" : '<span class="ep-readiness-label ep-readiness-' + tier + '">' + esc(epReadinessLabel(pct)) + '</span>') +
      '</div>' +
      '<div class="ep-readiness-bar"><div class="ep-readiness-fill ep-readiness-' + tier + '" style="width:' + pct + '%"></div></div>' +
      '</div>';
  }
  var epTopicDetailOpen = {}; // per prepId : détail par notion replié par défaut
  function epTopicDetailHtml(prep) {
    epEnsureTopics(prep);
    var open = !!epTopicDetailOpen[prep.id];
    var toggle = '<button class="ep-day-fc-toggle" style="margin:8px 0 4px;display:inline-block" onclick="App.toggleExamPrepTopicDetail(\'' + prep.id + '\')">' + (open ? "▾" : "▸") + ' Détail par notion (' + (prep.topics || []).length + ')</button>';
    if (!open) return toggle;
    var rows = (prep.topics || []).slice().sort(function (a, b) { return epTopicMastery(prep, a) - epTopicMastery(prep, b); }).map(function (t) {
      var score = Math.round(epTopicMastery(prep, t));
      var tier = epReadinessTier(score);
      return '<div class="ep-topic-row"><span class="ep-topic-row-name">' + esc(t) + '</span>' +
        '<div class="ep-topic-row-bar"><div class="ep-readiness-fill ep-readiness-' + tier + '" style="width:' + score + '%"></div></div>' +
        '<span class="ep-topic-row-pct mono">' + score + '%</span></div>';
    }).join("");
    return toggle + '<div class="ep-topic-detail">' + (rows || '<p class="modal-warn">Aucune notion pour l\'instant.</p>') + '</div>';
  }
  function renderExamPrepDetailPage(prepId) {
    var prep = epFind(prepId);
    if (!prep) { navigate("#/examprep"); return; }
    if (epSession && epSession.prepId === prepId) { renderExamPrepSession(prep); return; }
    var today = epTodayStr();
    var daysLeft = epDaysBetween(today, prep.examDate);
    var head = '<div class="course-head"><div><h1 class="page-title" style="margin-bottom:6px">📅 ' + esc(prep.title) + '</h1>' +
      '<p class="page-sub">' + esc(epScopeLabel(prep.scope)) + ' · Examen le ' + esc(epFormatDateFr(prep.examDate)) + (daysLeft >= 0 ? ' (J-' + daysLeft + ')' : ' (passé)') + '</p></div>' +
      '<div style="display:flex;gap:10px;margin-left:auto">' +
      '<button class="btn btn-ghost btn-sm" style="width:auto" onclick="App.openExamPrepEditDate(\'' + prep.id + '\')">📅 Changer la date</button>' +
      (prep.planStatus === "ready" ? '<button class="btn btn-ghost btn-sm" style="width:auto" onclick="App.retryExamPlanGeneration(\'' + prep.id + '\')">🔄 Regénérer le planning</button>' : "") +
      '<button class="btn btn-ghost btn-sm" style="width:auto" onclick="App.askDelete(\'examPrep\',null,null,null,\'' + prep.id + '\')">' + icon("trash") + ' Supprimer</button>' +
      '</div></div>';
    var body;
    if (prep.planStatus === "processing") {
      body = '<div class="processing-box">' + genLogo() + genProgressHtml(prep.id, "Gemini prépare ton planning de révision…") + '</div>';
    } else if (prep.planStatus === "error") {
      body = '<div class="processing-box"><span>⚠️ ' + esc(prep.planError || "La génération a échoué.") + '</span>' +
        '<div style="display:flex;gap:10px">' +
        (prep.planErrorDetail ? '<button class="btn btn-ghost btn-sm" style="width:auto;margin-top:14px" onclick="App.openExamPrepErrorDetail(\'' + prep.id + '\')">Détails</button>' : '') +
        '<button class="btn btn-primary" style="width:auto;margin-top:14px" onclick="App.retryExamPlanGeneration(\'' + prep.id + '\')">Réessayer</button>' +
        '</div></div>';
    } else {
      var todayEntry = prep.days.find(function (d) { return d.date === today; });
      var todaySession = prep.sessions && prep.sessions[today];
      var readinessHtml = epReadinessBarHtml(epReadinessPercent(prep), false);
      var startingToday = epStartingSessionFor === (prep.id + "::" + today);
      var loadingBtnHtml = genProgressHtml(prep.id + "::" + today, "⏳ Préparation de la séance…");
      var resumable = prep.activeSession && !prep.activeSession.done;
      var cta;
      if (resumable) {
        var rs = prep.activeSession;
        cta = '<div class="ep-today-card"><div class="ep-today-title">⏸️ Séance en pause — exercice ' + (rs.idx + 1) + ' / ' + rs.pool.length + '</div><div class="ep-today-sub">' + rs.correct + ' bonne(s) réponse(s), ' + rs.wrong + ' erreur(s) jusqu\'ici, rien n\'est perdu</div>' +
          '<button class="btn btn-metal" style="width:auto" onclick="App.resumeExamPrepSession(\'' + prep.id + '\')">▶ Reprendre où j\'en étais</button></div>';
      } else if (daysLeft < 0) {
        cta = '<div class="ep-today-card"><div class="ep-today-title">📅 Cet examen est passé.</div></div>';
      } else if (!todayEntry) {
        cta = '<div class="ep-today-card"><div class="ep-today-title">Rien de prévu aujourd\'hui pour cette prépa.</div></div>';
      } else if (todaySession && todaySession.status === "done") {
        cta = '<div class="ep-today-card"><div class="ep-today-title">✅ Séance du jour terminée</div><div class="ep-today-sub">' + todaySession.correct + ' / ' + todaySession.total + ' bonnes réponses</div>' +
          (startingToday ? loadingBtnHtml : '<button class="btn btn-ghost" style="width:auto" onclick="App.startExamPrepDay(\'' + prep.id + '\')">Refaire la séance</button>') + '</div>';
      } else {
        cta = '<div class="ep-today-card"><div class="ep-today-title">🎯 ' + esc(todayEntry.focus) + '</div><div class="ep-today-sub">~' + todayEntry.minutes + ' min</div>' +
          (startingToday ? loadingBtnHtml : '<button class="btn btn-metal" style="width:auto" onclick="App.startExamPrepDay(\'' + prep.id + '\')">Commencer l\'entraînement du jour (≈ ' + EP_SESSION_MINUTES + ' min)</button>') + '</div>';
      }
      var daysHtml = prep.days.map(function (d) {
        var sess = prep.sessions && prep.sessions[d.date];
        var done = sess && sess.status === "done";
        var isToday = d.date === today;
        var isPast = d.date < today;
        var cls = "ep-day" + (isToday ? " ep-day-today" : "") + (done ? " ep-day-done" : "") + (isPast && !done ? " ep-day-missed" : "");
        var statusLabel = done ? "✅ " + sess.correct + "/" + sess.total : (isPast ? "manqué" : d.minutes + " min");
        var dayCards = (prep.gapFlashcards || []).filter(function (f) { return f.day === d.date; });
        var fcKey = prep.id + "::" + d.date;
        var dayFcToggle = dayCards.length ? '<button class="ep-day-fc-toggle" onclick="event.stopPropagation();App.toggleExamPrepFlashcards(\'' + fcKey + '\')">📇 ' + dayCards.length + '</button>' : "";
        var dayFcSection = (dayCards.length && epGapFcOpen[fcKey]) ? renderExamPrepGapFlashcards(dayCards, fcKey) : "";
        // Rattraper/rejouer un jour passé, à volonté — les jours à venir restent au jour J pour garder le rythme prévu.
        var startingThisDay = epStartingSessionFor === (prep.id + "::" + d.date);
        var pastActionBtn = isPast ? (startingThisDay
          ? '<button class="ep-day-fc-toggle" disabled>⏳…</button>'
          : '<button class="ep-day-fc-toggle" onclick="event.stopPropagation();App.startExamPrepDay(\'' + prep.id + '\',\'' + d.date + '\')">' + (done ? "↻ Refaire" : "▶ Rattraper") + '</button>') : "";
        return '<div class="ep-day-wrap">' +
          '<div class="' + cls + '">' +
          '<div class="ep-day-date mono">' + esc(epFormatDateFr(d.date)) + '</div>' +
          '<div class="ep-day-body"><div class="ep-day-focus">' + esc(d.focus) + '</div>' +
          '<div class="ep-day-topics">' + (d.topics || []).map(function (t) { return '<span class="ep-day-topic">' + esc(t) + '</span>'; }).join("") + '</div></div>' +
          '<div class="ep-day-status mono">' + statusLabel + '</div>' +
          pastActionBtn +
          dayFcToggle +
          '</div>' +
          dayFcSection +
          '</div>';
      }).join("");
      var epMode = prep.revisionMode || "auto";
      var epShare = typeof prep.practiceShare === "number" ? prep.practiceShare : null;
      var epModeLine = epShare === null ? ""
        : epMode === "cours" ? "📖 Prépa orientée <b>apprentissage du cours</b> (choisi par toi)."
        : epMode === "exos" ? "✏️ Prépa orientée <b>exercices d'application</b> (choisi par toi)."
        : (epShare >= 60 ? "✏️ Prépa orientée <b>exercices</b>" : epShare <= 40 ? "📖 Prépa orientée <b>cours</b>" : "⚖️ Prépa <b>cours + exercices</b>") +
          " (≈ " + epShare + " % d'exercices, choisi par l'IA)" + (prep.modeReason ? " : " + esc(prep.modeReason) : ".");
      var epModeHtml = '<div class="ep-mode-box">' + (epModeLine ? '<div>' + epModeLine + '</div>' : "") +
        '<label class="ep-mode-change">Type de révision : <select onchange="App.setExamPrepRevisionMode(\'' + prep.id + '\', this.value)">' +
        EP_REVISION_MODES.map(function (rm) { return '<option value="' + rm[0] + '" ' + (epMode === rm[0] ? "selected" : "") + '>' + rm[1] + '</option>'; }).join("") +
        '</select></label></div>';
      body = readinessHtml + epTopicDetailHtml(prep) + epModeHtml + '<div class="prose" style="margin:16px 0 20px"><p>' + esc(prep.overview) + '</p></div>' + cta + '<h3 style="font-size:16px;margin:22px 0 12px">Planning jour par jour</h3><div class="ep-day-list">' + daysHtml + '</div>';
    }
    renderShell(["examprep", prep.id], head + body, { narrow: true });
  }

  function figuresPanelHtml(figures, openState, entityId, toggleAction, deleteAction) {
    if (!figures || !figures.length) return "";
    var toggle = '<button class="ep-day-fc-toggle" style="margin:14px 0 4px;display:inline-block" onclick="App.' + toggleAction + '(\'' + entityId + '\')">🖼️ Images/schémas (' + figures.length + ')</button>';
    if (!openState[entityId]) return toggle;
    var grid = figures.map(function (f) {
      return '<div class="course-figure-item">' +
        '<img src="' + figureSrc(f) + '" alt="" onclick="App.openFigureLightbox(this.src)">' +
        (f.caption ? '<div class="course-figure-caption">' + esc(f.caption) + '</div>' : "") +
        '<button class="btn btn-ghost btn-sm" style="width:100%" onclick="App.' + deleteAction + '(\'' + entityId + '\',\'' + f.id + '\')">' + icon("trash") + ' Supprimer</button>' +
        '</div>';
    }).join("");
    return toggle + '<div class="course-figures-grid">' + grid + '</div>';
  }
  /* ---------------- Chat avec le vieux conteur (dans chaque cours) ----------------
     Rien n'est affiché tant que l'élève n'a pas cliqué sur « Parler au vieux conteur ». La conversation
     est gardée dans le cours (course.chat) ; chaque question part avec le contenu du cours pour que les
     réponses s'appuient dessus. Hors cours : il répond quand même, mais le signale clairement. */
  var courseChatOpen = {};    // courseId → conversation dépliée
  var courseChatPending = {}; // courseId → réponse en cours
  var courseChatDraft = {};   // courseId → texte en cours de frappe (survit aux re-rendus)
  var courseChatScrollIntoView = false;
  var courseChatBig = false; // fenêtre du chat agrandie (gardée d'un cours à l'autre)
  try { courseChatBig = localStorage.getItem("studino-chat-big") === "1"; } catch (e) {}
  var courseChatStream = {};  // courseId → texte de la réponse en train de s'écrire
  // Chat : modèle le plus rapide d'abord (pas besoin du plus puissant pour expliquer un cours), les
  // autres en secours si celui-ci est à quota ou indisponible.
  var COURSE_CHAT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.7-flash"];
  // Réponse en streaming (SSE) : onText reçoit le texte déjà écrit à chaque morceau qui arrive.
  async function streamCourseChatWithKey(apiKey, prompt, onText) {
    var lastErr = null;
    for (var i = 0; i < COURSE_CHAT_MODELS.length; i++) {
      var model = COURSE_CHAT_MODELS[i];
      var url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":streamGenerateContent?alt=sse&key=" + encodeURIComponent(apiKey);
      // prompt : un texte, ou une liste de parts (texte + images des dessins de l'élève).
      var body = JSON.stringify({ contents: [{ role: "user", parts: Array.isArray(prompt) ? prompt : [{ text: prompt }] }], generationConfig: { max_output_tokens: 4096 } });
      var res;
      try {
        res = await fetchWithTimeout(url, { method: "POST", headers: { "content-type": "application/json" }, body: body }, 45000);
      } catch (netErr) {
        lastErr = new Error(netErr && netErr.name === "AbortError" ? "le conteur n'a pas répondu à temps" : "connexion impossible");
        lastErr.detail = String(netErr);
        continue;
      }
      if (!res.ok) {
        var detail = "";
        try { detail = await res.text(); } catch (e) {}
        lastErr = new Error("erreur " + res.status + " de Gemini");
        lastErr.status = res.status; lastErr.detail = detail; lastErr.rateLimited = res.status === 429;
        if (res.status === 401 || res.status === 403) throw lastErr; // clé refusée : inutile d'essayer les autres modèles
        continue;
      }
      var full = "", buf = "";
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var handleLine = function (line) {
        line = line.trim();
        if (line.indexOf("data:") !== 0) return;
        try {
          var json = JSON.parse(line.slice(5));
          var cand = json.candidates && json.candidates[0];
          ((cand && cand.content && cand.content.parts) || []).forEach(function (p) {
            if (p.text && !p.thought) { full += p.text; onText(full); }
          });
        } catch (e) {}
      };
      for (;;) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        var lines = buf.split("\n");
        buf = lines.pop();
        lines.forEach(handleLine);
      }
      handleLine(buf);
      if (full.trim()) return full;
      lastErr = new Error("réponse vide de Gemini");
    }
    throw lastErr || new Error("aucun modèle disponible");
  }
  async function streamCourseChatReply(prompt, onText) {
    var primaryKey = getApiKey();
    if (!primaryKey) throw new Error("ajoute ta clé API Gemini dans les paramètres");
    try {
      // Serveurs Google saturés (503) sur tous les modèles : on réessaie après 5 s puis 12 s.
      var waits = [5000, 12000];
      for (var attempt = 0; ; attempt++) {
        try {
          return await streamCourseChatWithKey(primaryKey, prompt, onText);
        } catch (e) {
          if (e.status !== 503 || attempt >= waits.length) {
            if (e.status === 503) e.message = "les serveurs de Google sont saturés en ce moment, réessaie dans une minute";
            throw e;
          }
          await sleep(waits[attempt]);
        }
      }
    } catch (err1) {
      var backupKey = getBackupApiKey();
      if (!err1.rateLimited || !backupKey) throw err1;
      return await streamCourseChatWithKey(backupKey, prompt, onText);
    }
  }
  function buildCourseChatPrompt(course, loc, history) {
    var gender = getUserGender();
    var genderNote = gender === "m" ? "L'élève est un garçon (formulations masculines si tu l'interpelles : \"mon grand\", \"jeune homme\")."
      : gender === "f" ? "L'élève est une fille (formulations féminines si tu l'interpelles : \"ma grande\", \"jeune demoiselle\")."
      : "Tu ne connais pas le genre de l'élève : interpellations neutres (\"jeune ami\", \"mon enfant\").";
    var content = "## Retranscription du cours\n" + stripFigureMarkdown(course.transcription || "") +
      (course.explanation ? "\n\n## Explication du cours\n" + stripFigureMarkdown(course.explanation) : "");
    var convo = history.map(function (m) { return (m.role === "user" ? "ÉLÈVE : " : "CONTEUR : ") + m.text; }).join("\n\n");
    return "Tu es le vieux conteur de Studino : un ancien professeur devenu archéologue sur le tard, chaleureux et bienveillant comme un grand-père (mais pas le grand-père de l'élève), plein d'anecdotes de terrain. Un élève te pose des questions sur SON cours, par écrit, pour mieux le comprendre.\n\n" +
      "Cours : « " + course.title + " » (matière : " + loc.subject.name + ", chapitre : " + loc.chapter.name + ").\n\n" +
      "Règles :\n" +
      "- Appuie-toi D'ABORD sur le cours ci-dessous : tes explications doivent être cohérentes avec lui et ne jamais le contredire.\n" +
      "- Si la question dépasse le cours (une notion, un fait ou un détail qui n'y figure pas), réponds quand même, correctement et honnêtement, MAIS signale-le clairement, par exemple « Attention, ça ce n'est pas dans ton cours : ... », pour que l'élève sache ce qui risque de tomber au contrôle et ce qui est en plus. Ne présente jamais une information hors cours comme si elle venait du cours.\n" +
      "- Tu es un prof avant tout : explique le POURQUOI, avec des images et des exemples concrets, étape par étape pour une méthode ou un calcul. Si l'élève semble perdu, reformule plus simplement. Si sa question contient une erreur, corrige-la gentiment.\n" +
      "- Réponds de façon vivante mais CONCISE : ce qui est utile pour répondre à la question, pas un nouveau cours entier (sauf s'il le demande). Paragraphes courts, listes si utile.\n" +
      "- S'il te demande de l'interroger : pose UNE question à la fois sur le cours, attends sa réponse, puis corrige-la (ce qui est juste, ce qui manque) avant la question suivante.\n" +
      "- " + genderNote + "\n" +
      "- LANGUE : si le cours est entièrement dans une langue étrangère (anglais, espagnol, japonais...), réponds dans cette langue avec des phrases simples (l'élève doit maîtriser le cours dans cette langue), sauf s'il te demande explicitement une explication en français. Si le cours mélange français et langue étrangère, réponds en français en citant les mots et expressions dans la langue étrangère. Sinon, en français.\n" +
      "- DESSINS : l'élève peut t'envoyer des dessins faits avec l'outil Dessin (images jointes, repérées dans la conversation). Regarde-les vraiment : explique ce qui est juste, ce qui est faux ou manque (éléments, légendes, flèches), et comment l'améliorer. Tu peux aussi lui demander de faire un schéma quand ça l'aide à apprendre.\n" +
      "- Formules en LaTeX entre $...$ (ou $$...$$ isolée), jamais de commande de couleur. Markdown simple autorisé (gras, listes, tableaux).\n\n" +
      "Voici le cours :\n\n" + content + "\n\n" +
      "Conversation jusqu'ici (le dernier message est celui auquel tu dois répondre maintenant) :\n\n" + convo + "\n\n" +
      "Réponds directement par ton message au dernier message de l'élève (Markdown simple), sans préambule ni balise.";
  }
  function courseChatHtml(course) {
    if (course.status !== "ready") return "";
    var msgs = course.chat || [];
    var avatar = PODCAST_DIR + PODCAST_ATTEND_IMGS[0];
    if (!courseChatOpen[course.id]) {
      // Bouton flottant, toujours visible en bas de l'écran : pas besoin de descendre tout en bas du cours.
      return '<button class="course-chat-fab" onclick="App.openCourseChat(\'' + course.id + '\')" title="Pose tes questions sur ce cours au vieux conteur"><img src="' + avatar + '" alt=""><span>💬 ' + (msgs.length ? "Reprendre la conversation" : "Parler au vieux conteur") + '</span></button>';
    }
    var pending = !!courseChatPending[course.id];
    var dis = pending ? " disabled" : "";
    // Même éditeur que dans « Mes exos » (LaTeX, tableaux, tableau périodique, mise en forme). Ce qui est
    // déjà tapé est relu dans la page juste avant de la redessiner, pour ne jamais le perdre.
    var liveBox = document.getElementById("course-chat");
    var liveEditor = document.getElementById("course-chat-input");
    if (liveEditor && liveBox && liveBox.getAttribute("data-course") === course.id) courseChatDraft[course.id] = liveEditor.innerHTML;
    var chatEditor = richEditorHtml("course-chat-input", "Pose ta question…", sanitizeRichHtml(courseChatDraft[course.id] || ""))
      .replace('contenteditable="true"', 'contenteditable="' + (pending ? "false" : "true") + '" onkeydown="if(event.key===\'Enter\'&&(event.ctrlKey||event.metaKey)){event.preventDefault();App.sendCourseChat(\'' + course.id + '\')}"');
    var listHtml = msgs.length ? msgs.map(function (m) {
      return m.role === "user"
        ? '<div class="chat-msg chat-msg-user">' + (m.html ? '<div class="rte-display">' + sanitizeRichHtml(m.html) + '</div>' : esc(m.text).replace(/\n/g, "<br>")) + '</div>'
        : '<div class="chat-msg chat-msg-bot"><img src="' + avatar + '" alt=""><div class="chat-msg-body prose">' + mdToHtml(m.text, course.figures) + '</div></div>';
    }).join("") : '<div class="chat-msg chat-msg-bot"><img src="' + avatar + '" alt=""><div class="chat-msg-body">Ah, te voilà ! Pose-moi n\'importe quelle question sur « ' + esc(course.title) + ' », je t\'explique tout ça.</div></div>';
    if (pending) listHtml += (courseChatStream[course.id] ? '<div class="chat-msg chat-msg-bot"><img src="' + avatar + '" alt=""><div class="chat-msg-body prose" id="course-chat-stream">' + mdToHtml(courseChatStream[course.id], course.figures) + '</div></div>' : '<div class="chat-msg chat-msg-bot"><img src="' + avatar + '" alt=""><div class="chat-msg-body chat-typing" id="course-chat-stream"><span class="dotpulse"></span> Le conteur réfléchit…</div></div>');
    return '<div class="course-chat' + (courseChatBig ? " course-chat-big" : "") + '" id="course-chat" data-course="' + course.id + '">' +
      '<div class="course-chat-head"><img src="' + avatar + '" alt=""><div style="flex:1;font-weight:700">Le vieux conteur</div>' +
      (msgs.length ? '<button class="btn btn-ghost btn-sm" style="width:auto"' + dis + ' onclick="App.resetCourseChat(\'' + course.id + '\')">🗑 Nouvelle conversation</button>' : "") +
      '<button class="btn btn-ghost btn-sm" style="width:auto" data-chat-size onclick="App.toggleCourseChatSize()" title="' + (courseChatBig ? "Réduire la fenêtre" : "Agrandir la fenêtre") + '">' + (courseChatBig ? "⤡ Réduire" : "⤢ Agrandir") + '</button>' +
      '<button class="btn btn-ghost btn-sm" style="width:auto" onclick="App.closeCourseChat(\'' + course.id + '\')" title="Fermer le chat">✕</button></div>' +
      '<div class="course-chat-list" id="course-chat-list">' + listHtml + '</div>' +
      '<div class="course-chat-form">' + chatEditor +
      '<div class="course-chat-send"><span class="course-chat-hint">Ctrl + Entrée pour envoyer</span><button type="button" class="btn btn-primary" style="width:auto"' + dis + ' onclick="App.sendCourseChat(\'' + course.id + '\')">Envoyer</button></div></div>' +
      '</div>';
  }
  function renderCoursePage(courseId, tab) {
    var loc = locateCourse(courseId);
    if (!loc) { navigate("#/"); return; }
    var course = loc.course;
    tab = tab || "transcription";
    var head = '<div class="course-head">' +
      (course.images && course.images.length ? (isPdfDataUrl(course.images[0]) ? '<div class="course-thumb file-thumb-pdf">📄<span>PDF</span></div>' : '<img class="course-thumb" src="' + course.images[0] + '">') : '') +
      '<div><h1 class="page-title" style="margin-bottom:6px">' + esc(course.title) + '</h1>' +
      '<p class="page-sub">' + esc(loc.subject.name) + ' · ' + esc(loc.chapter.name) + '</p></div>' +
      (course.status !== "processing" ? (
        '<div style="display:flex;gap:10px;margin-left:auto">' +
        (course.status === "ready" ? '<button class="btn btn-ghost btn-sm" style="width:auto" onclick="App.openDownloadCourseModal(\'' + course.id + '\')">⬇️ Télécharger en PDF</button>' : "") +
        (course.status === "ready" ? '<button class="btn btn-ghost btn-sm" style="width:auto" onclick="App.retryGeneration(\'' + course.id + '\')">🔄 Régénérer</button>' : "") +
        '<button class="btn btn-ghost btn-sm" style="width:auto" onclick="App.openAddCourseDocsModal(\'' + course.id + '\')">' + icon("camera") + ' Ajouter des documents</button>' +
        '</div>'
      ) : "") +
      '</div>';
    var tabsHtml = '<div class="tabs">' + TABS.map(function (t) {
      return '<button class="tab-btn ' + (t.id === tab ? "active" : "") + '" onclick="location.hash=\'#/course/' + course.id + '/' + t.id + '\'">' + t.label + '</button>';
    }).join("") + '</div>';

    var body;
    if (course.status === "processing") {
      body = '<div class="processing-box">' + genLogo() + genProgressHtml(course.id, "Gemini analyse ton cours…") + '</div>';
    } else if (course.status === "error") {
      body = '<div class="processing-box"><span>⚠️ ' + esc(course.error || "La génération a échoué.") + '</span>' +
        '<div style="display:flex;gap:10px">' +
        (course.errorDetail ? '<button class="btn btn-ghost btn-sm" style="width:auto;margin-top:14px" onclick="App.openCourseErrorDetail(\'' + course.id + '\')">Détails</button>' : '') +
        '<button class="btn btn-primary" style="width:auto;margin-top:14px" onclick="App.retryGeneration(\'' + course.id + '\')">Réessayer</button>' +
        '</div></div>';
    } else {
      body = renderTabBody(course, tab, loc) + figuresPanelHtml(course.figures, courseFiguresOpen, course.id, "toggleCourseFigures", "deleteCourseFigure") +
        courseChatHtml(course);
    }
    renderShell(["course", courseId, null, tab], head + tabsHtml + body, { narrow: true });
    if (courseChatOpen[course.id]) {
      var chatList = document.getElementById("course-chat-list");
      if (chatList) chatList.scrollTop = chatList.scrollHeight;
      if (courseChatScrollIntoView) {
        courseChatScrollIntoView = false;
        var chatInput = document.getElementById("course-chat-input");
        if (chatInput && !courseChatPending[course.id]) chatInput.focus();
      }
    }
  }

  function mdIsTableSep(line) {
    var core = line.trim();
    // Tolère un caractère parasite isolé en fin de ligne (ex. "|---|---|>" — un ">" de citation
    // Markdown qui a fui par erreur dans la ligne de séparation d'un tableau généré par l'IA) : sans
    // ça, la ligne entière était prise pour une vraie ligne de données et affichée telle quelle
    // ("---", "---", ">"), créant une fausse colonne à droite du tableau.
    if (core && !/[|:-]/.test(core.charAt(core.length - 1))) core = core.slice(0, -1).trim();
    if (core && !/[|:-]/.test(core.charAt(0))) core = core.slice(1).trim();
    return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(core);
  }
  function mdPipeCount(line) {
    var m = line.match(/\|/g);
    return m ? m.length : 0;
  }
  function mdTableRow(line) {
    var t = line.trim();
    if (t.charAt(0) === "|") t = t.slice(1);
    if (t.charAt(t.length - 1) === "|") t = t.slice(0, -1);
    return t.split("|").map(function (c) { return c.trim(); });
  }
  function mdExtractMath(md) {
    // Gemini met parfois les délimiteurs $ / $$ sur leur propre ligne, avec la formule au milieu
    // (ex. "$\n\\rightarrow ...\n$") : ça casse le rendu si on cherche les paires $...$ ligne par
    // ligne. On extrait donc TOUTES les formules sur le texte entier (avant de couper en lignes) et
    // on les remplace par un jeton mono-ligne, substitué par le vrai chip KaTeX à la toute fin.
    var chips = [];
    var text = String(md || "").replace(/\$\$([^$]+?)\$\$|\$([^$]+?)\$/g, function (m2, block, inline) {
      chips.push((block !== undefined ? block : inline).trim());
      return "" + (chips.length - 1) + "";
    });
    // Filet de secours : il arrive que Gemini écrive une commande LaTeX isolée (ex. "\mu m", parfois
    // même collée à la lettre suivante en "\mum") sans la mettre entre $...$ comme demandé — sans ça,
    // elle reste affichée telle quelle en texte brut au lieu d'être rendue. On reconnaît une liste de
    // commandes COURTES ET CONNUES précisément (pas un "\xxx" générique quelconque) : un "+" générique
    // capturerait "mum" en entier dans "\mum" au lieu de couper juste après "\mu", collant alors "m" au
    // symbole au lieu de le laisser en texte normal juste après.
    text = text.replace(/\\(?:mu|pi|circ|times|cdot|pm|mp|div|infty|leq|geq|neq|approx|rightarrow|leftarrow|Rightarrow|sqrt|Delta|delta|alpha|beta|gamma|theta|lambda|sigma|Omega|omega|text|mathrm|mathbf|operatorname)(?:\{[^{}]*\})*/g, function (m3) {
      chips.push(m3);
      return "\x02" + (chips.length - 1) + "\x02";
    });
    // Même filet pour une puissance de 10 écrite hors $...$ (ex. "10^{-9}" ou, encore plus fréquent
    // quand l'IA oublie les accolades, "10^9"/"x^2"), très courant dans les conversions d'unités
    // pico/nano/micro... : sans ça, l'exposant s'affiche tel quel ("^9") au lieu d'être mis en exposant.
    // On couvre aussi un multiplicateur juste devant (ex. "2,5 × 10^{-7}") et le cas sans accolades.
    text = text.replace(/((?:[0-9]+(?:[.,][0-9]+)?\s*[×x*]\s*)?[0-9]+(?:[.,][0-9]+)?)\s*\^\s*(?:\{([^{}]*)\}|(-?[0-9]+))/g, function (m4, base, braced, bare) {
      chips.push(base.replace(/[×x*]/, "\\times") + "^{" + (braced !== undefined ? braced : bare) + "}");
      return "\x02" + (chips.length - 1) + "\x02";
    });
    return { text: text, chips: chips };
  }
  function mdToHtml(rawMd, figures) {
    var extracted = mdExtractMath(rawMd);
    var md = extracted.text;
    var lines = md.split("\n");
    var html = "";
    var inList = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      // Bloc de code ``` : opérations posées (addition, soustraction, division en colonnes...) dont
      // l'alignement des chiffres compte. Avant, chaque ligne devenait un paragraphe et perdait ses
      // espaces : l'opération s'éparpillait. Rendu tel quel, en police à chasse fixe.
      if (/^\s*```/.test(line)) {
        if (inList) { html += "</ul>"; inList = false; }
        var codeLines = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { codeLines.push(lines[i].replace(/\s+$/, "")); i++; }
        var indents = codeLines.filter(function (l) { return l.trim(); }).map(function (l) { return l.match(/^ */)[0].length; });
        var minIndent = indents.length ? Math.min.apply(null, indents) : 0;
        html += '<pre class="md-pre">' + codeLines.map(function (l) { return esc(l.slice(minIndent)); }).join("\n") + "</pre>";
        continue;
      }
      // Tableau : ligne d'en-tête suivie idéalement d'une ligne |---|---|, mais on l'accepte
      // aussi sans cette ligne de séparation (l'IA l'omet parfois) tant qu'au moins deux lignes
      // consécutives contiennent des pipes.
      var nextLine = i + 1 < lines.length ? lines[i + 1] : "";
      var looksLikeTable = mdPipeCount(line) >= 1 && nextLine.trim() !== "" && (mdIsTableSep(nextLine) || mdPipeCount(nextLine) >= 1);
      if (looksLikeTable) {
        if (inList) { html += "</ul>"; inList = false; }
        // Un schéma peut être DANS une case (ex. « Électrisation par frottement | explication | schéma »,
        // comme dans le cours d'origine) : avant, la case affichait le code brut ![...](figure:...).
        var cellHtml = function (c) {
          var re = /!\[([^\]]*)\]\(((?:figure|schema):[^)\s]+)\)/g, out = "", last = 0, m;
          while ((m = re.exec(c))) {
            out += inlineMdPlain(c.slice(last, m.index));
            var id = m[2].replace(/^(figure|schema):/, "");
            var f = (figures || []).find(function (x) { return x.id === id; });
            if (!f) out += '<span class="prose-figure-removed">🚫 Schéma supprimé</span>';
            else if (m[2].indexOf("schema:") === 0) out += '<span class="table-figure table-schema">' + f.svg + '</span>';
            else out += '<img class="table-figure" src="' + figureSrc(f) + '" alt="' + esc(m[1]) + '" title="' + esc(m[1]) + '" onclick="App.openFigureLightbox(this.src)">';
            last = re.lastIndex;
          }
          return out + inlineMdPlain(c.slice(last));
        };
        var head = mdTableRow(line);
        html += "<table><thead><tr>" + head.map(function (c) { return "<th>" + cellHtml(c) + "</th>"; }).join("") + "</tr></thead><tbody>";
        i++;
        while (i < lines.length && mdPipeCount(lines[i]) >= 1 && lines[i].trim() !== "") {
          if (mdIsTableSep(lines[i])) { i++; continue; }
          var row = mdTableRow(lines[i]);
          html += "<tr>" + row.map(function (c) { return "<td>" + cellHtml(c) + "</td>"; }).join("") + "</tr>";
          i++;
        }
        html += "</tbody></table>";
        i--;
        continue;
      }
      // Tolère un caractère de ponctuation parasite juste après la parenthèse fermante (ex. un point
      // final de phrase que l'IA a collé par habitude à "![légende](schema:id)."), sans quoi la ligne
      // entière n'était plus reconnue comme une image et s'affichait en syntaxe Markdown brute au lieu
      // du schéma/de la figure réels.
      var imgLine = /^!\[([^\]]*)\]\((\S+)\)[.,;:]?\s*$/.exec(line.trim());
      if (imgLine) {
        if (inList) { html += "</ul>"; inList = false; }
        var figRef = /^figure:(.+)$/.exec(imgLine[2]);
        var schemaRef = /^schema:(.+)$/.exec(imgLine[2]);
        if (figRef) {
          var refFig = (figures || []).find(function (f) { return f.id === figRef[1]; });
          if (refFig) {
            html += '<figure class="prose-figure"><img src="' + figureSrc(refFig) + '" alt="' + esc(imgLine[1]) + '" onclick="App.openFigureLightbox(this.src)">' + (imgLine[1] ? "<figcaption>" + esc(imgLine[1]) + "</figcaption>" : "") + "</figure>";
          } else {
            html += '<div class="prose-figure-removed">🚫 Schéma supprimé pour libérer de l\'espace' + (imgLine[1] ? " — " + esc(imgLine[1]) : "") + '</div>';
          }
        } else if (schemaRef) {
          // Schéma dessiné directement par l'IA (pas une photo recadrée) : le SVG complet est stocké
          // tel quel, inséré inline plutôt que via <img src>.
          var refSchema = (figures || []).find(function (f) { return f.id === schemaRef[1]; });
          if (refSchema) {
            html += '<figure class="prose-figure prose-schema">' + refSchema.svg + (imgLine[1] ? "<figcaption>" + esc(imgLine[1]) + "</figcaption>" : "") + "</figure>";
          }
        } else {
          html += '<figure class="prose-figure"><img src="' + imgLine[2] + '" alt="' + esc(imgLine[1]) + '" onclick="App.openFigureLightbox(this.src)">' + (imgLine[1] ? "<figcaption>" + esc(imgLine[1]) + "</figcaption>" : "") + "</figure>";
        }
      }
      else if (/^>\s?/.test(line.trim()) && line.trim() !== ">") {
        // Bloc encadré ("> ..." consécutifs) pour mettre en valeur une définition/formule/mise en garde
        // importante — beaucoup plus lisible qu'un mur de texte uniforme sur une fiche de révision.
        if (inList) { html += "</ul>"; inList = false; }
        var quoteLines = [];
        while (i < lines.length && /^>\s?/.test(lines[i].trim())) { quoteLines.push(lines[i].trim().replace(/^>\s?/, "")); i++; }
        i--;
        html += '<div class="prose-callout">' + quoteLines.map(function (l) { return l.trim() === "" ? "" : "<p>" + inlineMdPlain(l) + "</p>"; }).join("") + '</div>';
      }
      else if (/^(#{2,6}\s*|#\s+)/.test(line.trim())) { // « # Titre » aussi (avant, le # restait affiché)
        if (inList) { html += "</ul>"; inList = false; }
        var headingMatch = /^(#{1,6})\s*(.*)$/.exec(line.trim());
        var tag = headingMatch[1].length <= 2 ? "h3" : "h4";
        html += "<" + tag + ">" + inlineMdPlain(headingMatch[2]) + "</" + tag + ">";
      }
      else if (/^-\s+/.test(line.trim())) { if (!inList) { html += "<ul>"; inList = true; } html += "<li>" + inlineMdPlain(line.trim().replace(/^-\s+/, "")) + "</li>"; }
      else if (line.trim() === "") { if (inList) { html += "</ul>"; inList = false; } }
      // Un ">" tout seul sur sa ligne est un résidu de syntaxe de citation (ex. une ligne de
      // séparation de tableau contaminée — voir mdIsTableSep) qui n'apporte rien à l'élève : on
      // l'ignore silencieusement comme une ligne vide plutôt que de l'afficher tel quel.
      else if (line.trim() === ">") { if (inList) { html += "</ul>"; inList = false; } }
      else { if (inList) { html += "</ul>"; inList = false; } html += "<p>" + inlineMdPlain(line) + "</p>"; }
    }
    if (inList) html += "</ul>";
    html = html.replace(/\x02(\d+)\x02/g, function (m, idx) { return mathChipHtml(extracted.chips[+idx] || ""); });
    return html;
  }
  function inlineMdPlain(s) {
    // Gemini insère parfois <br> à l'intérieur d'une cellule de tableau pour empiler plusieurs
    // lignes — on le protège avant l'échappement HTML pour qu'il reste un vrai saut de ligne
    // au lieu de s'afficher tel quel comme du texte brut "<br>".
    s = String(s == null ? "" : s).replace(/<br\s*\/?>/gi, "");
    s = esc(s);
    s = s.replace(//g, "<br>");
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    // Italique *texte* (après le gras) : l'étoile doit être collée au texte des deux côtés, pour ne pas
    // confondre avec une multiplication écrite « 3 * 4 ».
    s = s.replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, "$1<em>$2</em>");
    s = s.replace(/__(.+?)__/g, "<u>$1</u>");
    return s;
  }
  function inlineMd(s) {
    // render $...$/$$...$$ as real math-chips (not left as raw text for the global KaTeX
    // auto-render pass) so any copy-paste of this content keeps the formula's LaTeX source.
    // Réutilise mdExtractMath (même filet de secours pour une commande LaTeX orpheline ou une
    // puissance de 10 hors $...$) plutôt que de dupliquer une extraction $...$ plus basique ici.
    var extracted = mdExtractMath(s);
    var out = inlineMdPlain(extracted.text);
    out = out.replace(/\x02(\d+)\x02/g, function (m, idx) { return mathChipHtml(extracted.chips[+idx] || ""); });
    return out;
  }

