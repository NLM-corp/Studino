"use strict";
// Studino — état, fusion, icônes, Dino Park, DinoTime, connexion
// Fichier chargé dans l'ordre par index.html : les fichiers partagent les mêmes variables globales.

  /* ---------------- Router state ---------------- */
  var modal = null; // { type: 'subject'|'chapter'|'course'|'confirmDelete'|'dinoFiche', ... }
  var mobileNavOpen = false; // écran étroit : le menu latéral est un tiroir replié par défaut, ouvert via le bouton ☰ de la topbar
  var dpMerchantZone = null; // zoneId of the currently open full-screen merchant, or null
  var dpMerchantMode = "eggs"; // "eggs" | "objects"
  var dpSellMode = false;
  var dpSellSelectedDinoId = null;
  var quizState = {}; // per courseId: { idx, answers: [] }
  var fcState = {}; // per courseId: { idx, flipped }
  var courseEditState = null; // { courseId, field: "transcription"|"explanation" } — édition du texte source d'un cours
  var courseFiguresOpen = {}; // per courseId: bool — panneau des schémas/images du cours déplié ou non
  var entryFiguresOpen = {}; // per importedExercise id: idem, pour les exercices importés
  var methodoTrainState = {}; // per methodology id: { chapterId, mechanic } — choix courant du panneau "S'entraîner"
  var methodoItemOpen = {}; // per practice item id: bool — replié par défaut une fois plusieurs sujets accumulés
  var methodoTranscriptionOpen = {}; // per methodology id: bool — repliée par défaut, pour vérifier que rien n'a été perdu par rapport au document du prof
  var dpView = { mode: "hub" }; // Dino Park in-memory sub-navigation
  var dtState = { mode: "setup", tab: "chrono", durationMin: 25, enclosureId: null, pomoWork: 25, pomoBreak: 5, pomoCycles: 4, pomoDinoId: null }; // DinoTime sub-navigation
  var dtRunning = null; // { enclosureId, remainingSec, endsAt, dinos: [...], paused }
  var dtPomoRunning = null; // { dinoId, workMin, breakMin, cycles, phase: "work"|"break", cycleIndex, remainingSec, endsAt, paused }
  var dtTimerInterval = null;
  var dtWalkRaf = null;

  function parseHash() {
    var h = location.hash.replace(/^#\/?/, "");
    var parts = h.split("/").filter(Boolean);
    return parts;
  }
  function navigate(hash) { location.hash = hash; }

  function findSubject(id) { return userData().subjects.find(function (s) { return s.id === id; }); }
  function findTheme(subj, id) { return subj && subj.themes.find(function (t) { return t.id === id; }); }
  function findChapter(theme, id) { return theme && theme.chapters.find(function (c) { return c.id === id; }); }
  function findCourse(chap, id) { return chap && chap.courses.find(function (c) { return c.id === id; }); }

  /* ---------------- Fusion de sauvegardes (import "Fusionner" plutôt que "Remplacer") ----------------
     Sans vrai serveur, deux appareils peuvent avancer chacun de leur côté depuis le dernier export.
     Un import qui REMPLACE perd systématiquement tout ce qui n'a été fait que sur l'appareil du fichier
     importé. La fusion évite ça : elle prend comme base le compte le plus récemment actif (data.updatedAt,
     posé par saveDB() à chaque sauvegarde) et y RAJOUTE tout ce qui n'existe QUE dans l'autre fichier
     (nouveaux sujets/thèmes/chapitres/cours/exercices importés/fiches/prépas, jamais vus sur l'appareil
     "gagnant"), sans jamais rien écraser côté gagnant. Ce n'est pas une fusion champ par champ parfaite
     (un cours modifié en parallèle des deux côtés garde la version du plus récent, pas un mélange des
     deux), mais ça garantit qu'aucun contenu propre à un appareil ne disparaît jamais silencieusement. */
  function mergeArraysById(winnerArr, loserArr) {
    var result = (winnerArr || []).slice();
    var ids = {};
    result.forEach(function (it) { if (it && it.id) ids[it.id] = true; });
    (loserArr || []).forEach(function (it) { if (it && it.id && !ids[it.id]) { result.push(it); ids[it.id] = true; } });
    return result;
  }
  function mergeChaptersTree(winnerChapters, loserChapters) {
    var byId = {};
    (winnerChapters || []).forEach(function (c) { byId[c.id] = c; });
    var result = (winnerChapters || []).slice();
    (loserChapters || []).forEach(function (lc) {
      var wc = byId[lc.id];
      if (!wc) { result.push(lc); return; }
      wc.courses = mergeArraysById(wc.courses, lc.courses);
    });
    return result;
  }
  function mergeThemesTree(winnerThemes, loserThemes) {
    var byId = {};
    (winnerThemes || []).forEach(function (t) { byId[t.id] = t; });
    var result = (winnerThemes || []).slice();
    (loserThemes || []).forEach(function (lt) {
      var wt = byId[lt.id];
      if (!wt) { result.push(lt); return; }
      wt.chapters = mergeChaptersTree(wt.chapters, lt.chapters);
    });
    return result;
  }
  function mergeSubjectsTree(winnerSubjects, loserSubjects) {
    var byId = {};
    (winnerSubjects || []).forEach(function (s) { byId[s.id] = s; });
    var result = (winnerSubjects || []).slice();
    (loserSubjects || []).forEach(function (ls) {
      var ws = byId[ls.id];
      if (!ws) { result.push(ls); return; }
      ws.themes = mergeThemesTree(ws.themes, ls.themes);
    });
    return result;
  }
  function mergeUserData(winner, loser) {
    var merged = JSON.parse(JSON.stringify(winner));
    merged.subjects = mergeSubjectsTree(merged.subjects, loser.subjects);
    merged.importedExercises = mergeArraysById(merged.importedExercises, loser.importedExercises);
    merged.revisionSheets = mergeArraysById(merged.revisionSheets, loser.revisionSheets);
    merged.examPreps = mergeArraysById(merged.examPreps, loser.examPreps);
    merged.calendarEvents = mergeArraysById(merged.calendarEvents || [], loser.calendarEvents || []);
    // Dino Park n'est pas qu'un objet à prendre en bloc d'un seul côté : dinosaures/œufs/enclos ont
    // chacun un id stable (jamais régénéré), donc on peut — et on doit — les fusionner comme le reste,
    // sinon un dino attrapé UNIQUEMENT sur l'appareil "perdant" serait purement et simplement perdu à
    // la fusion. mergeArraysById ne duplique jamais rien (un id déjà présent n'est jamais rajouté), donc
    // fusionner deux fois le même fichier, ou faire des allers-retours entre deux appareils, ne peut ni
    // perdre ni dupliquer un dino.
    if (loser.dinoPark && merged.dinoPark) {
      var wdp = merged.dinoPark, ldp = loser.dinoPark;
      wdp.points = Math.max(wdp.points || 0, ldp.points || 0);
      wdp.discovered = Object.assign({}, ldp.discovered || {}, wdp.discovered || {});
      wdp.dinosaurs = mergeArraysById(wdp.dinosaurs, ldp.dinosaurs);
      wdp.eggs = mergeArraysById(wdp.eggs, ldp.eggs);
      wdp.enclosures = mergeArraysById(wdp.enclosures, ldp.enclosures);
      wdp.unlockedZones = Array.from(new Set((wdp.unlockedZones || []).concat(ldp.unlockedZones || [])));
      // L'inventaire n'a pas d'id (juste un compteur par type d'objet) : le max évite qu'un aller-retour
      // de fusions ne fasse gonfler artificiellement le stock au lieu de refléter la vraie progression.
      var mergedInventory = Object.assign({}, ldp.inventory || {}, wdp.inventory || {});
      Object.keys(mergedInventory).forEach(function (k) { mergedInventory[k] = Math.max((wdp.inventory || {})[k] || 0, (ldp.inventory || {})[k] || 0); });
      wdp.inventory = mergedInventory;
    } else if (loser.dinoPark && !merged.dinoPark) {
      merged.dinoPark = loser.dinoPark;
    }
    return merged;
  }
  function mergeDB(localDB, importedDB) {
    var merged = { users: Object.assign({}, importedDB.users, localDB.users), data: {}, currentUser: localDB.currentUser };
    var allUsernames = {};
    Object.keys(localDB.users || {}).forEach(function (u) { allUsernames[u] = true; });
    Object.keys(importedDB.users || {}).forEach(function (u) { allUsernames[u] = true; });
    Object.keys(allUsernames).forEach(function (username) {
      var localUserData = (localDB.data || {})[username];
      var importedUserData = (importedDB.data || {})[username];
      if (localUserData && importedUserData) {
        var localNewer = (localUserData.updatedAt || 0) >= (importedUserData.updatedAt || 0);
        merged.data[username] = localNewer ? mergeUserData(localUserData, importedUserData) : mergeUserData(importedUserData, localUserData);
      } else {
        merged.data[username] = localUserData || importedUserData;
      }
    });
    return merged;
  }

  function locateCourse(courseId) {
    var subs = userData().subjects;
    for (var i = 0; i < subs.length; i++) {
      for (var t = 0; t < subs[i].themes.length; t++) {
        for (var j = 0; j < subs[i].themes[t].chapters.length; j++) {
          var c = subs[i].themes[t].chapters[j].courses.find(function (x) { return x.id === courseId; });
          if (c) return { subject: subs[i], theme: subs[i].themes[t], chapter: subs[i].themes[t].chapters[j], course: c };
        }
      }
    }
    return null;
  }

  /* ---------------- Icons (inline SVG) ---------------- */
  function icon(name) {
    var icons = {
      home: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
      plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>',
      chevron: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>',
      chevronDown: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>',
      trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 7h16M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2m2 0l-1 13a2 2 0 01-2 2H8a2 2 0 01-2-2L5 7"/></svg>',
      book: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>',
      folder: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>',
      doc: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5"/></svg>',
      play: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
      camera: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7l2-3h4l2 3"/><circle cx="12" cy="13.5" r="3.2"/></svg>',
      clock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 3.5"/></svg>',
      calendar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/><path d="M8 13h2M8 17h2M14 13h2M14 17h2"/></svg>'
    };
    return icons[name] || "";
  }

  /* ---------------- Pixel sprites ---------------- */
  var spriteCache = {};
  function drawSprite(rows, palette, px) {
    var w = rows[0].length, h = rows.length;
    var canvas = document.createElement("canvas");
    canvas.width = w * px; canvas.height = h * px;
    var ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var ch = rows[y][x];
        if (ch === "." || !palette[ch]) continue;
        ctx.fillStyle = palette[ch];
        ctx.fillRect(x * px, y * px, px, px);
      }
    }
    return canvas.toDataURL("image/png");
  }
  var SPRITES = {
    dino: {
      rows: [
        "..ss..ss..",
        ".obbbbbbo.",
        "obbbbbbbbo",
        "obbebbbbbo",
        "obbbbbbbbo",
        "obbbbbbbbo",
        ".obbbbbbo.",
        "..oooooo.."
      ],
      palette: { o: "#2F4A26", b: "#5DA157", e: "#1B2412", s: "#E8862B" }
    },
    dinoBig: {
      rows: [
        ".....oo.....",
        "....obbo....",
        "...obbebo...",
        "..oobbbboo..",
        ".o.sbbbbs.o.",
        "obbbbbbbbbbo",
        "obbbbbbbbbbo",
        "obbhhhhhhbbo",
        "obbhhhhhhbbo",
        "obbbbbbbbbbo",
        ".obb.oo.bbo.",
        "..oo....oo.."
      ],
      palette: { o: "#2F4A26", b: "#5DA157", e: "#1B2412", s: "#E8862B", h: "#EFE7C4" }
    },
    fern: {
      rows: [
        "...ll...",
        "..llll..",
        ".ll..ll.",
        "...ll...",
        "..llll..",
        ".ll..ll.",
        "...ll...",
        "...ll...",
        "...ll...",
        "...tt..."
      ],
      palette: { l: "#4C8C4A", t: "#6B4A2A" }
    },
    egg: {
      rows: [
        "..bbbb..",
        ".bbbbbb.",
        "bbbsbbbb",
        "bbbbbbbb",
        "bbsbbbsb",
        "bbbbbbbb",
        "bbbbsbbb",
        ".bbbbbb.",
        ".bbbbbb.",
        "..bbbb.."
      ],
      palette: { b: "#EFE1B8", s: "#8A5A2B" }
    },
    footprint: {
      rows: [
        ".o.o.o.",
        "ooooooo",
        "ooooooo",
        ".ooooo.",
        "..ooo.."
      ],
      palette: { o: "#3A5A32" }
    }
  };
  function sprite(name, px, opts) {
    opts = opts || {};
    var key = name + "_" + px;
    if (!spriteCache[key]) {
      var s = SPRITES[name];
      spriteCache[key] = drawSprite(s.rows, s.palette, px);
    }
    var w = SPRITES[name].rows[0].length * px, h = SPRITES[name].rows.length * px;
    var cls = "sprite" + (opts.bob ? " sprite-bob" : "") + (opts.className ? " " + opts.className : "");
    return '<img class="' + cls + '" src="' + spriteCache[key] + '" width="' + w + '" height="' + h + '" alt="" style="' + (opts.style || "") + '">';
  }
  function genLogo() {
    return '<img class="sprite sprite-bob" src="assets/objects/ui/DinoPark.png" alt="" style="width:72px;height:auto;">';
  }

  /* ---------------- Dino Park : data ---------------- */
  var DP_ZONES = [
    { id: "foret", name: "Forêt", emoji: "🌳", cost: 0, color: "#3E7A3F" },
    { id: "plaine", name: "Plaine", emoji: "🌾", cost: 750, color: "#B7A23A" },
    { id: "desert", name: "Désert", emoji: "🏜️", cost: 1500, color: "#D9A253" },
    { id: "arctique", name: "Arctique", emoji: "❄️", cost: 3000, color: "#8FC7E0" },
    { id: "marine", name: "Marine", emoji: "🌊", cost: 5000, color: "#2E7BAA" },
    { id: "volcanique", name: "Volcanique", emoji: "🌋", cost: 8000, color: "#B14A2E" }
  ];
  function dpZone(id) { return DP_ZONES.find(function (z) { return z.id === id; }); }
  var DP_PORTAL_ZONE_FILE = { foret: "Foret", plaine: "Plaine", desert: "Desert", arctique: "Artique", marine: "Marin", volcanique: "Volcanique" };
  function dpPortalArtPath(zoneId, locked) {
    return "assets/objects/portaille/Portaille_" + DP_PORTAL_ZONE_FILE[zoneId] + (locked ? "_silhouette" : "") + ".png";
  }
  function dpZoneEnclosureCost(zoneId) {
    var idx = DP_ZONES.findIndex(function (z) { return z.id === zoneId; });
    return DP_ENCLOSURE_BUILD_COST + Math.max(0, idx) * 10;
  }

  var DP_RARITY = {
    commun: { label: "Commun", weight: 80, price: 150, hatch: 600 },
    rare: { label: "Rare", weight: 30, price: 400, hatch: 1200 },
    epique: { label: "Épique", weight: 10, price: 900, hatch: 2100 },
    legendaire: { label: "Légendaire", weight: 1, price: 2000, hatch: 3600 }
  };

  var DP_PORTIONS_PER_CRATE = 20;
  var DP_DOSES_PER_CRATE = 3;
  var DP_FOOD_ITEMS = [
    { id: "herbe", name: "Herbe", diet: "herbivore", dietLabel: "Herbivores", emoji: "🌿", price: 40, img: "assets/objects/ui/caisse_herbe.png", unitImg: "assets/objects/ui/herbe.png" },
    { id: "fruit", name: "Fruit", diet: "frugivore", dietLabel: "Frugivores", emoji: "🍓", price: 45, img: "assets/objects/ui/caisse_fruit.png", unitImg: "assets/objects/ui/fruit.png" },
    { id: "insecte", name: "Insectes", diet: "insectivore", dietLabel: "Insectivores", emoji: "🐛", price: 45, img: "assets/objects/ui/caisse_insecte.png", unitImg: "assets/objects/ui/insecte.png" },
    { id: "poisson", name: "Poisson", diet: "piscivore", dietLabel: "Piscivores", emoji: "🐟", price: 55, img: "assets/objects/ui/caisse_poisson.png", unitImg: "assets/objects/ui/poisson.png" },
    { id: "viande", name: "Viande", diet: "carnivore", dietLabel: "Carnivores", emoji: "🍖", price: 60, img: "assets/objects/ui/caisse_viande.png", unitImg: "assets/objects/ui/viande.png" }
  ];
  var DP_MEDICINE_ITEMS = [
    { id: "soin", name: "Soins", emoji: "💊", price: 70, img: "assets/objects/ui/caisse_soin.png", unitImg: "assets/objects/ui/bandage.png" }
  ];
  function dpFoodItem(id) { return DP_FOOD_ITEMS.find(function (i) { return i.id === id; }); }
  function dpMedicineItem(id) { return DP_MEDICINE_ITEMS.find(function (i) { return i.id === id; }); }
  function dpFoodPortionsNeeded(weightKg) {
    if (weightKg < 10) return 1;
    if (weightKg < 100) return 2;
    if (weightKg < 1000) return 4;
    if (weightKg < 5000) return 7;
    if (weightKg < 15000) return 10;
    return 15;
  }
  function dpWeightLabel(weightKg) {
    return weightKg >= 1000 ? (Math.round(weightKg / 100) / 10) + " t" : weightKg + " kg";
  }
  var DP_DINO_MIN_SCALE = 0.55, DP_DINO_MAX_SCALE = 1.4, DP_DINO_MAX_WEIGHT_LOG = Math.log(40000);
  function dpDinoSizeScale(weightKg) {
    var t = Math.log(Math.max(1, weightKg || 1)) / DP_DINO_MAX_WEIGHT_LOG;
    t = Math.max(0, Math.min(1, t));
    return DP_DINO_MIN_SCALE + t * (DP_DINO_MAX_SCALE - DP_DINO_MIN_SCALE);
  }

  var DP_SPECIES = [
    { id: "compsognathus", name: "Compsognathus", zone: "foret", diet: "insectivore", weightKg: 3, rarity: "commun" },
    { id: "iguanodon", name: "Iguanodon", zone: "foret", diet: "herbivore", weightKg: 3000, rarity: "commun" },
    { id: "archaeopteryx", name: "Archaeopteryx", zone: "foret", diet: "insectivore", weightKg: 1, rarity: "commun" },
    { id: "sinosauropteryx", name: "Sinosauropteryx", zone: "foret", diet: "insectivore", weightKg: 1, rarity: "commun" },
    { id: "caudipteryx", name: "Caudipteryx", zone: "foret", diet: "omnivore", weightKg: 5, rarity: "commun" },
    { id: "anchiornis", name: "Anchiornis", zone: "foret", diet: "insectivore", weightKg: 1, rarity: "commun" },
    { id: "coelophysis", name: "Coelophysis", zone: "foret", diet: "carnivore", weightKg: 25, rarity: "commun" },
    { id: "hypsilophodon", name: "Hypsilophodon", zone: "foret", diet: "frugivore", weightKg: 20, rarity: "commun" },
    { id: "dryosaurus", name: "Dryosaurus", zone: "foret", diet: "herbivore", weightKg: 90, rarity: "commun" },
    { id: "camptosaurus", name: "Camptosaurus", zone: "foret", diet: "herbivore", weightKg: 1000, rarity: "commun" },
    { id: "heterodontosaurus", name: "Heterodontosaurus", zone: "foret", diet: "frugivore", weightKg: 3, rarity: "commun" },
    { id: "scutellosaurus", name: "Scutellosaurus", zone: "foret", diet: "frugivore", weightKg: 10, rarity: "commun" },
    { id: "velociraptor", name: "Vélociraptor", zone: "foret", diet: "carnivore", weightKg: 15, rarity: "rare" },
    { id: "stegosaure", name: "Stégosaure", zone: "foret", diet: "herbivore", weightKg: 3500, rarity: "rare" },
    { id: "kentrosaure", name: "Kentrosaure", zone: "foret", diet: "herbivore", weightKg: 1000, rarity: "rare" },
    { id: "huayangosaure", name: "Huayangosaure", zone: "foret", diet: "herbivore", weightKg: 700, rarity: "rare" },
    { id: "tuojiangosaure", name: "Tuojiangosaure", zone: "foret", diet: "herbivore", weightKg: 1000, rarity: "rare" },
    { id: "ornitholestes", name: "Ornitholestes", zone: "foret", diet: "carnivore", weightKg: 12, rarity: "rare" },
    { id: "citipati", name: "Citipati", zone: "foret", diet: "omnivore", weightKg: 75, rarity: "rare" },
    { id: "khaan", name: "Khaan", zone: "foret", diet: "omnivore", weightKg: 20, rarity: "rare" },
    { id: "sinornithosaure", name: "Sinornithosaurus", zone: "foret", diet: "insectivore", weightKg: 1, rarity: "rare" },
    { id: "massospondylus", name: "Massospondylus", zone: "foret", diet: "herbivore", weightKg: 300, rarity: "rare" },
    { id: "deinonychus", name: "Deinonychus", zone: "foret", diet: "carnivore", weightKg: 70, rarity: "epique" },
    { id: "plateosaure", name: "Plateosaurus", zone: "foret", diet: "herbivore", weightKg: 700, rarity: "epique" },
    { id: "diplodocus", name: "Diplodocus", zone: "foret", diet: "herbivore", weightKg: 15000, rarity: "epique" },
    { id: "camarasaure", name: "Camarasaurus", zone: "foret", diet: "herbivore", weightKg: 18000, rarity: "epique" },
    { id: "apatosaure", name: "Apatosaure", zone: "foret", diet: "herbivore", weightKg: 25000, rarity: "epique" },
    { id: "dracorex", name: "Dracorex", zone: "foret", diet: "frugivore", weightKg: 20, rarity: "epique" },
    { id: "brachiosaure", name: "Brachiosaure", zone: "foret", diet: "herbivore", weightKg: 40000, rarity: "legendaire" },
    { id: "saurornitholestes", name: "Saurornitholestes", zone: "foret", diet: "carnivore", weightKg: 10, rarity: "legendaire" },
    { id: "gallimimus", name: "Gallimimus", zone: "plaine", diet: "omnivore", weightKg: 440, rarity: "commun" },
    { id: "triceratops", name: "Tricératops", zone: "plaine", diet: "herbivore", weightKg: 9000, rarity: "commun" },
    { id: "styracosaure", name: "Styracosaure", zone: "plaine", diet: "herbivore", weightKg: 2700, rarity: "commun" },
    { id: "pachycephalosaure", name: "Pachycéphalosaure", zone: "plaine", diet: "frugivore", weightKg: 450, rarity: "commun" },
    { id: "centrosaure", name: "Centrosaure", zone: "plaine", diet: "herbivore", weightKg: 2300, rarity: "commun" },
    { id: "maiasaura", name: "Maiasaura", zone: "plaine", diet: "herbivore", weightKg: 3000, rarity: "commun" },
    { id: "corythosaure", name: "Corythosaure", zone: "plaine", diet: "herbivore", weightKg: 3800, rarity: "commun" },
    { id: "lambeosaure", name: "Lambeosaure", zone: "plaine", diet: "herbivore", weightKg: 4000, rarity: "commun" },
    { id: "saurolophus", name: "Saurolophus", zone: "plaine", diet: "herbivore", weightKg: 2000, rarity: "commun" },
    { id: "ornithomimus", name: "Ornithomimus", zone: "plaine", diet: "omnivore", weightKg: 170, rarity: "commun" },
    { id: "struthiomimus", name: "Struthiomimus", zone: "plaine", diet: "omnivore", weightKg: 150, rarity: "commun" },
    { id: "thescelosaure", name: "Thescelosaure", zone: "plaine", diet: "frugivore", weightKg: 270, rarity: "commun" },
    { id: "ankylosaure", name: "Ankylosaure", zone: "plaine", diet: "herbivore", weightKg: 6000, rarity: "rare" },
    { id: "allosaure", name: "Allosaure", zone: "plaine", diet: "carnivore", weightKg: 2300, rarity: "rare" },
    { id: "chasmosaure", name: "Chasmosaure", zone: "plaine", diet: "herbivore", weightKg: 2200, rarity: "rare" },
    { id: "torosaure", name: "Torosaure", zone: "plaine", diet: "herbivore", weightKg: 8000, rarity: "rare" },
    { id: "deinocheirus", name: "Deinocheirus", zone: "plaine", diet: "omnivore", weightKg: 6000, rarity: "rare" },
    { id: "gorgosaure", name: "Gorgosaure", zone: "plaine", diet: "carnivore", weightKg: 2400, rarity: "rare" },
    { id: "albertosaure", name: "Albertosaure", zone: "plaine", diet: "carnivore", weightKg: 2500, rarity: "rare" },
    { id: "edmontonia", name: "Edmontonia", zone: "plaine", diet: "herbivore", weightKg: 3000, rarity: "rare" },
    { id: "euoplocephale", name: "Euoplocéphale", zone: "plaine", diet: "herbivore", weightKg: 2700, rarity: "rare" },
    { id: "leptoceratops", name: "Leptoceratops", zone: "plaine", diet: "frugivore", weightKg: 70, rarity: "rare" },
    { id: "parasaurolophus", name: "Parasaurolophus", zone: "plaine", diet: "herbivore", weightKg: 2500, rarity: "epique" },
    { id: "avaceratops", name: "Avaceratops", zone: "plaine", diet: "frugivore", weightKg: 400, rarity: "epique" },
    { id: "anchiceratops", name: "Anchiceratops", zone: "plaine", diet: "herbivore", weightKg: 3000, rarity: "epique" },
    { id: "hypacrosaure", name: "Hypacrosaure", zone: "plaine", diet: "herbivore", weightKg: 4000, rarity: "epique" },
    { id: "brachylophosaure", name: "Brachylophosaure", zone: "plaine", diet: "herbivore", weightKg: 2300, rarity: "epique" },
    { id: "nodosaure", name: "Nodosaure", zone: "plaine", diet: "herbivore", weightKg: 2500, rarity: "epique" },
    { id: "tyrannosaure", name: "Tyrannosaure", zone: "plaine", diet: "carnivore", weightKg: 7000, rarity: "legendaire" },
    { id: "daspletosaure", name: "Daspletosaure", zone: "plaine", diet: "carnivore", weightKg: 3000, rarity: "legendaire" },
    { id: "protoceratops", name: "Protoceratops", zone: "desert", diet: "frugivore", weightKg: 180, rarity: "commun" },
    { id: "oviraptor", name: "Oviraptor", zone: "desert", diet: "omnivore", weightKg: 33, rarity: "commun" },
    { id: "mononykus", name: "Mononykus", zone: "desert", diet: "insectivore", weightKg: 3, rarity: "commun" },
    { id: "shuvuuia", name: "Shuvuuia", zone: "desert", diet: "insectivore", weightKg: 3, rarity: "commun" },
    { id: "nemegtosaure", name: "Nemegtosaure", zone: "desert", diet: "herbivore", weightKg: 15000, rarity: "commun" },
    { id: "pinacosaure", name: "Pinacosaure", zone: "desert", diet: "herbivore", weightKg: 1000, rarity: "commun" },
    { id: "bagaceratops", name: "Bagaceratops", zone: "desert", diet: "frugivore", weightKg: 20, rarity: "commun" },
    { id: "archaeoceratops", name: "Archaeoceratops", zone: "desert", diet: "frugivore", weightKg: 15, rarity: "commun" },
    { id: "psittacosaure", name: "Psittacosaure", zone: "desert", diet: "frugivore", weightKg: 20, rarity: "commun" },
    { id: "avimimus", name: "Avimimus", zone: "desert", diet: "omnivore", weightKg: 15, rarity: "commun" },
    { id: "elmisaurus", name: "Elmisaurus", zone: "desert", diet: "omnivore", weightKg: 25, rarity: "commun" },
    { id: "conchoraptor", name: "Conchoraptor", zone: "desert", diet: "omnivore", weightKg: 20, rarity: "commun" },
    { id: "carnotaurus", name: "Carnotaurus", zone: "desert", diet: "carnivore", weightKg: 1500, rarity: "rare" },
    { id: "pentaceratops", name: "Pentaceratops", zone: "desert", diet: "herbivore", weightKg: 5500, rarity: "rare" },
    { id: "saichania", name: "Saichania", zone: "desert", diet: "herbivore", weightKg: 2000, rarity: "rare" },
    { id: "tarchia", name: "Tarchia", zone: "desert", diet: "herbivore", weightKg: 4000, rarity: "rare" },
    { id: "segnosaure", name: "Segnosaure", zone: "desert", diet: "herbivore", weightKg: 1300, rarity: "rare" },
    { id: "erlikosaure", name: "Erlikosaure", zone: "desert", diet: "herbivore", weightKg: 200, rarity: "rare" },
    { id: "alxasaure", name: "Alxasaure", zone: "desert", diet: "herbivore", weightKg: 400, rarity: "rare" },
    { id: "rinchenia", name: "Rinchenia", zone: "desert", diet: "omnivore", weightKg: 40, rarity: "rare" },
    { id: "nemegtomaia", name: "Nemegtomaia", zone: "desert", diet: "omnivore", weightKg: 40, rarity: "rare" },
    { id: "bactrosaure", name: "Bactrosaure", zone: "desert", diet: "herbivore", weightKg: 2000, rarity: "rare" },
    { id: "nigersaurus", name: "Nigersaurus", zone: "desert", diet: "herbivore", weightKg: 4000, rarity: "epique" },
    { id: "gigantoraptor", name: "Gigantoraptor", zone: "desert", diet: "omnivore", weightKg: 1400, rarity: "epique" },
    { id: "alioramus", name: "Alioramus", zone: "desert", diet: "carnivore", weightKg: 500, rarity: "epique" },
    { id: "gobisaure", name: "Gobisaure", zone: "desert", diet: "herbivore", weightKg: 1000, rarity: "epique" },
    { id: "shamosaure", name: "Shamosaure", zone: "desert", diet: "herbivore", weightKg: 3000, rarity: "epique" },
    { id: "linhenykus", name: "Linhenykus", zone: "desert", diet: "insectivore", weightKg: 1, rarity: "epique" },
    { id: "spinosaure", name: "Spinosaure", zone: "desert", diet: "piscivore", weightKg: 12000, rarity: "legendaire" },
    { id: "tarbosaure", name: "Tarbosaure", zone: "desert", diet: "carnivore", weightKg: 5000, rarity: "legendaire" },
    { id: "pachyrhinosaure", name: "Pachyrhinosaure", zone: "arctique", diet: "herbivore", weightKg: 3000, rarity: "commun" },
    { id: "troodon", name: "Troodon", zone: "arctique", diet: "carnivore", weightKg: 50, rarity: "commun" },
    { id: "leaellynasaura", name: "Leaellynasaura", zone: "arctique", diet: "frugivore", weightKg: 10, rarity: "commun" },
    { id: "qantassaure", name: "Qantassaure", zone: "arctique", diet: "frugivore", weightKg: 15, rarity: "commun" },
    { id: "atlascopcosaure", name: "Atlascopcosaure", zone: "arctique", diet: "frugivore", weightKg: 10, rarity: "commun" },
    { id: "fulgurotherium", name: "Fulgurotherium", zone: "arctique", diet: "frugivore", weightKg: 10, rarity: "commun" },
    { id: "galleonosaure", name: "Galleonosaure", zone: "arctique", diet: "frugivore", weightKg: 15, rarity: "commun" },
    { id: "weewarrasaure", name: "Weewarrasaure", zone: "arctique", diet: "frugivore", weightKg: 15, rarity: "commun" },
    { id: "gasparinisaura", name: "Gasparinisaura", zone: "arctique", diet: "frugivore", weightKg: 8, rarity: "commun" },
    { id: "timimus", name: "Timimus", zone: "arctique", diet: "carnivore", weightKg: 200, rarity: "commun" },
    { id: "ozraptor", name: "Ozraptor", zone: "arctique", diet: "insectivore", weightKg: 20, rarity: "commun" },
    { id: "rapator", name: "Rapator", zone: "arctique", diet: "carnivore", weightKg: 300, rarity: "commun" },
    { id: "nanuqsaurus", name: "Nanuqsaurus", zone: "arctique", diet: "carnivore", weightKg: 900, rarity: "rare" },
    { id: "edmontosaure", name: "Edmontosaure", zone: "arctique", diet: "herbivore", weightKg: 4000, rarity: "rare" },
    { id: "muttaburrasaure", name: "Muttaburrasaure", zone: "arctique", diet: "herbivore", weightKg: 2800, rarity: "rare" },
    { id: "diamantinasaure", name: "Diamantinasaure", zone: "arctique", diet: "herbivore", weightKg: 20000, rarity: "rare" },
    { id: "austrosaure", name: "Austrosaure", zone: "arctique", diet: "herbivore", weightKg: 20000, rarity: "rare" },
    { id: "wintonotitan", name: "Wintonotitan", zone: "arctique", diet: "herbivore", weightKg: 18000, rarity: "rare" },
    { id: "minmi", name: "Minmi", zone: "arctique", diet: "herbivore", weightKg: 300, rarity: "rare" },
    { id: "kunbarrasaure", name: "Kunbarrasaure", zone: "arctique", diet: "frugivore", weightKg: 400, rarity: "rare" },
    { id: "diluvicursor", name: "Diluvicursor", zone: "arctique", diet: "herbivore", weightKg: 200, rarity: "rare" },
    { id: "austrocheirus", name: "Austrocheirus", zone: "arctique", diet: "carnivore", weightKg: 40, rarity: "rare" },
    { id: "cryolophosaure", name: "Cryolophosaure", zone: "arctique", diet: "carnivore", weightKg: 500, rarity: "epique" },
    { id: "glacialisaure", name: "Glacialisaure", zone: "arctique", diet: "herbivore", weightKg: 4000, rarity: "epique" },
    { id: "antarctopelta", name: "Antarctopelta", zone: "arctique", diet: "herbivore", weightKg: 1000, rarity: "epique" },
    { id: "serendipaceratops", name: "Serendipaceratops", zone: "arctique", diet: "frugivore", weightKg: 100, rarity: "epique" },
    { id: "trinisaura", name: "Trinisaura", zone: "arctique", diet: "frugivore", weightKg: 10, rarity: "epique" },
    { id: "morrosaure", name: "Morrosaure", zone: "arctique", diet: "herbivore", weightKg: 5000, rarity: "epique" },
    { id: "yutyrannus", name: "Yutyrannus", zone: "arctique", diet: "carnivore", weightKg: 1400, rarity: "legendaire" },
    { id: "imperobator", name: "Imperobator", zone: "arctique", diet: "carnivore", weightKg: 20, rarity: "legendaire" },
    { id: "ichtyosaure", name: "Ichtyosaure", zone: "marine", diet: "piscivore", weightKg: 90, rarity: "commun" },
    { id: "plesiosaure", name: "Plésiosaure", zone: "marine", diet: "piscivore", weightKg: 450, rarity: "commun" },
    { id: "pliosaure", name: "Pliosaure", zone: "marine", diet: "piscivore", weightKg: 5000, rarity: "commun" },
    { id: "nothosaure", name: "Nothosaure", zone: "marine", diet: "piscivore", weightKg: 130, rarity: "commun" },
    { id: "cryptoclidus", name: "Cryptoclidus", zone: "marine", diet: "piscivore", weightKg: 800, rarity: "commun" },
    { id: "dolichorhynchops", name: "Dolichorhynchops", zone: "marine", diet: "piscivore", weightKg: 200, rarity: "commun" },
    { id: "rhomaleosaure", name: "Rhomaleosaure", zone: "marine", diet: "piscivore", weightKg: 2000, rarity: "commun" },
    { id: "simolestes", name: "Simolestes", zone: "marine", diet: "piscivore", weightKg: 3000, rarity: "commun" },
    { id: "peloneustes", name: "Peloneustes", zone: "marine", diet: "piscivore", weightKg: 500, rarity: "commun" },
    { id: "stenopterygius", name: "Stenopterygius", zone: "marine", diet: "piscivore", weightKg: 300, rarity: "commun" },
    { id: "eurhinosaure", name: "Eurhinosaure", zone: "marine", diet: "piscivore", weightKg: 500, rarity: "commun" },
    { id: "ophthalmosaure", name: "Ophthalmosaure", zone: "marine", diet: "piscivore", weightKg: 950, rarity: "commun" },
    { id: "elasmosaure", name: "Élasmosaure", zone: "marine", diet: "piscivore", weightKg: 2000, rarity: "rare" },
    { id: "kronosaure", name: "Kronosaure", zone: "marine", diet: "piscivore", weightKg: 7000, rarity: "rare" },
    { id: "temnodontosaure", name: "Temnodontosaure", zone: "marine", diet: "piscivore", weightKg: 1000, rarity: "rare" },
    { id: "shonisaure", name: "Shonisaure", zone: "marine", diet: "piscivore", weightKg: 30000, rarity: "rare" },
    { id: "thalassomedon", name: "Thalassomedon", zone: "marine", diet: "piscivore", weightKg: 5000, rarity: "rare" },
    { id: "styxosaure", name: "Styxosaure", zone: "marine", diet: "piscivore", weightKg: 4000, rarity: "rare" },
    { id: "attenborosaure", name: "Attenborosaure", zone: "marine", diet: "piscivore", weightKg: 500, rarity: "rare" },
    { id: "hauffiopteryx", name: "Hauffiopteryx", zone: "marine", diet: "piscivore", weightKg: 200, rarity: "rare" },
    { id: "platypterygius", name: "Platypterygius", zone: "marine", diet: "piscivore", weightKg: 900, rarity: "rare" },
    { id: "globidens", name: "Globidens", zone: "marine", diet: "piscivore", weightKg: 400, rarity: "rare" },
    { id: "liopleurodon", name: "Liopleurodon", zone: "marine", diet: "piscivore", weightKg: 10000, rarity: "epique" },
    { id: "plotosaure", name: "Plotosaure", zone: "marine", diet: "piscivore", weightKg: 1000, rarity: "epique" },
    { id: "clidastes", name: "Clidastes", zone: "marine", diet: "piscivore", weightKg: 400, rarity: "epique" },
    { id: "prognathodon", name: "Prognathodon", zone: "marine", diet: "piscivore", weightKg: 6000, rarity: "epique" },
    { id: "dakosaure", name: "Dakosaure", zone: "marine", diet: "piscivore", weightKg: 3000, rarity: "epique" },
    { id: "metriorhynchus", name: "Metriorhynchus", zone: "marine", diet: "piscivore", weightKg: 1000, rarity: "epique" },
    { id: "mosasaure", name: "Mosasaure", zone: "marine", diet: "piscivore", weightKg: 15000, rarity: "legendaire" },
    { id: "tylosaure", name: "Tylosaure", zone: "marine", diet: "piscivore", weightKg: 12000, rarity: "legendaire" },
    { id: "ceratosaure", name: "Ceratosaure", zone: "volcanique", diet: "carnivore", weightKg: 700, rarity: "commun" },
    { id: "dilophosaure", name: "Dilophosaure", zone: "volcanique", diet: "carnivore", weightKg: 400, rarity: "commun" },
    { id: "baryonyx", name: "Baryonyx", zone: "volcanique", diet: "piscivore", weightKg: 1700, rarity: "commun" },
    { id: "suchomimus", name: "Suchomimus", zone: "volcanique", diet: "piscivore", weightKg: 3800, rarity: "commun" },
    { id: "irritator", name: "Irritator", zone: "volcanique", diet: "piscivore", weightKg: 1000, rarity: "commun" },
    { id: "eocarcharia", name: "Eocarcharia", zone: "volcanique", diet: "carnivore", weightKg: 1000, rarity: "commun" },
    { id: "rugops", name: "Rugops", zone: "volcanique", diet: "carnivore", weightKg: 500, rarity: "commun" },
    { id: "masiakasaure", name: "Masiakasaure", zone: "volcanique", diet: "insectivore", weightKg: 20, rarity: "commun" },
    { id: "eustreptospondyle", name: "Eustreptospondyle", zone: "volcanique", diet: "carnivore", weightKg: 500, rarity: "commun" },
    { id: "metriacanthosaure", name: "Metriacanthosaure", zone: "volcanique", diet: "carnivore", weightKg: 1500, rarity: "commun" },
    { id: "piatnitzkysaure", name: "Piatnitzkysaure", zone: "volcanique", diet: "carnivore", weightKg: 500, rarity: "commun" },
    { id: "condorraptor", name: "Condorraptor", zone: "volcanique", diet: "carnivore", weightKg: 400, rarity: "commun" },
    { id: "yangchuanosaure", name: "Yangchuanosaure", zone: "volcanique", diet: "carnivore", weightKg: 2000, rarity: "rare" },
    { id: "concavenator", name: "Concavenator", zone: "volcanique", diet: "carnivore", weightKg: 1000, rarity: "rare" },
    { id: "majungasaure", name: "Majungasaure", zone: "volcanique", diet: "carnivore", weightKg: 1100, rarity: "rare" },
    { id: "skorpiovenator", name: "Skorpiovenator", zone: "volcanique", diet: "carnivore", weightKg: 500, rarity: "rare" },
    { id: "neovenator", name: "Neovenator", zone: "volcanique", diet: "carnivore", weightKg: 1000, rarity: "rare" },
    { id: "sinraptor", name: "Sinraptor", zone: "volcanique", diet: "carnivore", weightKg: 1500, rarity: "rare" },
    { id: "monolophosaure", name: "Monolophosaure", zone: "volcanique", diet: "carnivore", weightKg: 700, rarity: "rare" },
    { id: "afrovenator", name: "Afrovenator", zone: "volcanique", diet: "carnivore", weightKg: 500, rarity: "rare" },
    { id: "veterupristisaure", name: "Veterupristisaure", zone: "volcanique", diet: "carnivore", weightKg: 1000, rarity: "rare" },
    { id: "lourinhanosaure", name: "Lourinhanosaure", zone: "volcanique", diet: "carnivore", weightKg: 800, rarity: "rare" },
    { id: "giganotosaure", name: "Giganotosaure", zone: "volcanique", diet: "carnivore", weightKg: 8000, rarity: "epique" },
    { id: "tyrannotitan", name: "Tyrannotitan", zone: "volcanique", diet: "carnivore", weightKg: 7000, rarity: "epique" },
    { id: "mapusaure", name: "Mapusaure", zone: "volcanique", diet: "carnivore", weightKg: 5000, rarity: "epique" },
    { id: "acrocanthosaure", name: "Acrocanthosaure", zone: "volcanique", diet: "carnivore", weightKg: 5500, rarity: "epique" },
    { id: "berberosaure", name: "Berberosaure", zone: "volcanique", diet: "carnivore", weightKg: 3000, rarity: "epique" },
    { id: "chilantaisaure", name: "Chilantaisaure", zone: "volcanique", diet: "carnivore", weightKg: 2000, rarity: "epique" },
    { id: "torvosaure", name: "Torvosaure", zone: "volcanique", diet: "carnivore", weightKg: 4000, rarity: "legendaire" },
    { id: "saurophaganax", name: "Saurophaganax", zone: "volcanique", diet: "carnivore", weightKg: 3000, rarity: "legendaire" }
  ];
  // 10 espèces par biome, les plus connues (4 communes, 3 rares, 2 épiques, 1 légendaire) : avec 30
  // par biome, on tombait sans arrêt sur les mêmes petits dinos à plumes inconnus. Les autres restent
  // définies (retired) uniquement pour que les dinos déjà possédés continuent de fonctionner : elles
  // n'apparaissent plus dans les œufs, la boutique ni l'encyclopédie.
  var DP_ACTIVE_SPECIES = {
    foret: { commun: ["compsognathus", "iguanodon", "archaeopteryx", "coelophysis"], rare: ["velociraptor", "stegosaure", "deinonychus"], epique: ["diplodocus", "apatosaure"], legendaire: ["brachiosaure"] },
    plaine: { commun: ["gallimimus", "pachycephalosaure", "styracosaure", "maiasaura"], rare: ["triceratops", "ankylosaure", "parasaurolophus"], epique: ["allosaure", "albertosaure"], legendaire: ["tyrannosaure"] },
    desert: { commun: ["protoceratops", "oviraptor", "psittacosaure", "mononykus"], rare: ["carnotaurus", "pinacosaure", "pentaceratops"], epique: ["nigersaurus", "alioramus"], legendaire: ["spinosaure"] },
    arctique: { commun: ["troodon", "pachyrhinosaure", "leaellynasaura", "minmi"], rare: ["edmontosaure", "muttaburrasaure", "nanuqsaurus"], epique: ["cryolophosaure", "antarctopelta"], legendaire: ["yutyrannus"] },
    marine: { commun: ["ichtyosaure", "plesiosaure", "nothosaure", "pliosaure"], rare: ["elasmosaure", "kronosaure", "shonisaure"], epique: ["liopleurodon", "tylosaure"], legendaire: ["mosasaure"] },
    volcanique: { commun: ["dilophosaure", "ceratosaure", "baryonyx", "suchomimus"], rare: ["majungasaure", "concavenator", "sinraptor"], epique: ["acrocanthosaure", "torvosaure"], legendaire: ["giganotosaure"] }
  };
  (function () {
    var active = {};
    Object.keys(DP_ACTIVE_SPECIES).forEach(function (zone) {
      Object.keys(DP_ACTIVE_SPECIES[zone]).forEach(function (rarity) {
        DP_ACTIVE_SPECIES[zone][rarity].forEach(function (id) { active[id] = rarity; });
      });
    });
    DP_SPECIES.forEach(function (s) {
      if (active[s.id]) s.rarity = active[s.id];
      else s.retired = true;
    });
  })();
  var DP_ACTIVE_SPECIES_LIST = DP_SPECIES.filter(function (s) { return !s.retired; });
  function dpSpecies(id) { return DP_SPECIES.find(function (s) { return s.id === id; }); }
  function dpSpeciesByZone(zoneId) { return DP_ACTIVE_SPECIES_LIST.filter(function (s) { return s.zone === zoneId; }); }

  function dpHashColor(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return "hsl(" + (h % 360) + ", 58%, 46%)";
  }

  var DP_ART = {
    tyrannosaure: { folder: "T-rex", face: "Tyrannosaurus_rex_face.png", profil: "Tyrannosaurus_rex_profil.png" },
    compsognathus: { folder: "Compsognathus", face: "Compsognathus_face.png", profil: "Compsognathus_profil.png" },
    stegosaure: { folder: "Stegosaure", face: "Stegosaure_face.png", profil: "Stegosaure_profil.png" },
    iguanodon: { folder: "Iguanodon", face: "Iguanodon_face.png", profil: "Iguanodon_profil.png" },
    velociraptor: { folder: "Velociraptor", face: "Velociraptor_face.png", profil: "Velociraptor_profil.png" },
    deinonychus: { folder: "Deinonychus", face: "Deinonychus_face.png", profil: "Deinonychus_profil.png" },
    brachiosaure: { folder: "Brachiosaure", face: "Brachiosaure_face.png", profil: "Brachiosaure_profil.png" },
    sinosauropteryx: { folder: "Sinosauropteryx", face: "Sinosauropteryx_face.png", profil: "Sinosauropteryx_profil.png" },
    archaeopteryx: { folder: "Archaeopteryx", face: "Archaeopteryx_face.png", profil: "Archaeopteryx_profil.png" },
    caudipteryx: { folder: "Caudipteryx", face: "Caudipteryx_face.png", profil: "Caudipteryx_profil.png" },
    anchiornis: { folder: "Anchiornis", face: "Anchiornis_face.png", profil: "Anchiornis_profil.png" },
    camptosaurus: { folder: "Camptosaurus", face: "Camptosaurus_face.png", profil: "Camptosaurus_profil.png" },
    coelophysis: { folder: "Coelophysis", face: "Coelophysis_face.png", profil: "Coelophysis_profil.png" },
    dryosaurus: { folder: "Dryosaurus", face: "Dryosaurus_face.png", profil: "Dryosaurus_profil.png" },
    heterodontosaurus: { folder: "Heterodontosaurus", face: "Heterodontosaurus_face.png", profil: "Heterodontosaurus_profil.png" },
    huayangosaure: { folder: "Huayangosaure", face: "Huayangosaure_face.png", profil: "Huayangosaure_profil.png" },
    hypsilophodon: { folder: "Hypsilophodon", face: "Hypsilophodon_face.png", profil: "Hypsilophodon_profil.png" },
    kentrosaure: { folder: "Kentrosaure", face: "Kentrosaure_face.png", profil: "Kentrosaure_profil.png" },
    scutellosaurus: { folder: "Scutellosaurus", face: "Scutellosaurus_face.png", profil: "Scutellosaurus_profil.png" },
    tuojiangosaure: { folder: "Tuojiangosaure", face: "Tuojiangosaure_face.png", profil: "Tuojiangosaure_profil.png" },
    ornitholestes: { folder: "Ornitholestes", face: "Ornitholestes_face.png", profil: "Ornitholestes_profil.png" },
    citipati: { folder: "Citipati", face: "Citipati_face.png", profil: "Citipati_profil.png" },
    khaan: { folder: "Khaan", face: "Khaan_face.png", profil: "Khaan_profil.png" },
    sinornithosaure: { folder: "Sinornithosaurus", face: "Sinornithosaurus_face.png", profil: "Sinornithosaurus_profil.png" },
    massospondylus: { folder: "Massospondylus", face: "Massospondylus_face.png", profil: "Massospondylus_profil.png" },
    plateosaure: { folder: "Plateosaurus", face: "Plateosaurus_face.png", profil: "Plateosaurus_profil.png" },
    diplodocus: { folder: "Diplodocus", face: "Diplodocus_face.png", profil: "Diplodocus_profil.png" },
    camarasaure: { folder: "Camarasaurus", face: "Camarasaurus_face.png", profil: "Camarasaurus_profil.png" },
    apatosaure: { folder: "Apatosaure", face: "Apatosaure_face.png", profil: "Apatosaure_profil.png" },
    dracorex: { folder: "dracorex", face: "Dracorex_face.png", profil: "Dracorex_profil.png" },
    saurornitholestes: { folder: "Saurornitholestes", face: "Saurornitholestes_face.png", profil: "Saurornitholestes_profil.png" },
    gallimimus: { folder: "Gallimimus", face: "Gallimimus_face.png", profil: "Gallimimus_profil.png" },
    triceratops: { folder: "Tricératops", face: "Triceratops_face.png", profil: "Triceratops_profil.png" },
    styracosaure: { folder: "Styracosaure", face: "Styracosaure_face.png", profil: "Styracosaure_profil.png" },
    pachycephalosaure: { folder: "Pachycéphalosaure", face: "Pachycephalosaure_face.png", profil: "Pachycephalosaure_profil.png" },
    centrosaure: { folder: "Centrosaure", face: "Centrosaure_face.png", profil: "Centrosaure_profil.png" },
    maiasaura: { folder: "Maiasaura", face: "Maiasaura_face.png", profil: "Maiasaura_profil.png" },
    corythosaure: { folder: "Corythosaure", face: "Corythosaure_face.png", profil: "Corythosaure_profil.png" },
    lambeosaure: { folder: "Lambeosaure", face: "Lambeosaure_face.png", profil: "Lambeosaure_profil.png" },
    saurolophus: { folder: "Saurolophus", face: "Saurolophus_face.png", profil: "Saurolophus_profil.png" },
    ornithomimus: { folder: "Ornithomimus", face: "Ornithomimus_face.png", profil: "Ornithomimus_profil.png" },
    struthiomimus: { folder: "Struthiomimus", face: "Struthiomimus_face.png", profil: "Struthiomimus_profil.png" },
    thescelosaure: { folder: "Thescelosaurus", face: "Thescelosaurus_face.png", profil: "Thescelosaurus_profil.png" },
    ankylosaure: { folder: "Ankylosaure", face: "Ankylosaure_face.png", profil: "Ankylosaure_profil.png" },
    allosaure: { folder: "Allosaure", face: "Allosaure_face.png", profil: "Allosaure_profil.png" },
    chasmosaure: { folder: "Chasmosaurus", face: "Chasmosaurus_face.png", profil: "Chasmosaurus_profil.png" },
    torosaure: { folder: "Torosaure", face: "Torosaure_face.png", profil: "Torosaure_profil.png" },
    deinocheirus: { folder: "Deinocheirus", face: "Deinocheirus_face.png", profil: "Deinocheirus_profil.png" },
    gorgosaure: { folder: "Gorgosaurus", face: "Gorgosaurus_face.png", profil: "Gorgosaurus_profil.png" },
    albertosaure: { folder: "Albertosaure", face: "Albertosaure_face.png", profil: "Albertosaure_profil.png" },
    edmontonia: { folder: "Edmontonia", face: "Edmontonia_face.png", profil: "Edmontonia_profil.png" },
    euoplocephale: { folder: "Euoplocephalus", face: "Euoplocephalus_face.png", profil: "Euoplocephalus_profil.png" },
    leptoceratops: { folder: "Leptoceratops", face: "Leptoceratops_face.png", profil: "Leptoceratops_profil.png" },
    parasaurolophus: { folder: "Parasaurolophus", face: "Parasaurolophus_face.png", profil: "Parasaurolophus_profil.png" },
    avaceratops: { folder: "Avaceratops", face: "Avaceratops_face.png", profil: "Avaceratops_profil.png" },
    anchiceratops: { folder: "Anchiceratops", face: "Anchiceratops_face.png", profil: "Anchiceratops_profil.png" },
    hypacrosaure: { folder: "Hypacrosaure", face: "Hypacrosaure_face.png", profil: "Hypacrosaure_profil.png" },
    brachylophosaure: { folder: "Brachylophosaurus", face: "Brachylophosaurus_face.png", profil: "Brachylophosaurus_profil.png" },
    nodosaure: { folder: "Nodosaure", face: "Nodosaure_face.png", profil: "Nodosaure_profil.png" },
    daspletosaure: { folder: "Daspletosaurus", face: "Daspletosaurus_face.png", profil: "Daspletosaurus_profil.png" },
    protoceratops: { folder: "Protoceratops", face: "Protoceratops_face.png", profil: "Protoceratops_profil.png" },
    oviraptor: { folder: "Oviraptor", face: "Oviraptor_face.png", profil: "Oviraptor_profil.png" },
    mononykus: { folder: "Mononykus", face: "Mononykus_face.png", profil: "Mononykus_profil.png" },
    shuvuuia: { folder: "Shuvuuia", face: "Shuvuuia_face.png", profil: "Shuvuuia_profil.png" },
    nemegtosaure: { folder: "Nemegtosaurus", face: "Nemegtosaurus_face.png", profil: "Nemegtosaurus_profil.png" },
    pinacosaure: { folder: "Pinacausaure", face: "Pinacosaure_face.png", profil: "Pinacosaure_profil.png" },
    bagaceratops: { folder: "Bagaceratops", face: "Bagaceratops_face.png", profil: "Bagaceratops_profil.png" },
    archaeoceratops: { folder: "Archaeoceratops", face: "Archaeoceratops_face.png", profil: "Archaeoceratops_profil.png" },
    psittacosaure: { folder: "Psittacosaurus", face: "Psittacosaurus_face.png", profil: "Psittacosaurus_profil.png" },
    avimimus: { folder: "Avimimus", face: "Avimimus_face.png", profil: "Avimimus_profil.png" },
    elmisaurus: { folder: "Elmisaurus", face: "Elmisaurus_face.png", profil: "Elmisaurus_profil.png" },
    carnotaurus: { folder: "Carnotaurus", face: "Carnotaurus_face.png", profil: "Carnotaurus_profil.png" },
    pentaceratops: { folder: "Pentaceratops", face: "Pentaceratops_face.png", profil: "Pentaceratops_profil.png" },
    tarchia: { folder: "Tarchia", face: "Tarchia_face.png", profil: "Tarchia_profil.png" },
    segnosaure: { folder: "Segnosaure", face: "Segnosaure_face.png", profil: "Segnosaure_profil.png" },
    alxasaure: { folder: "Alxasaurus", face: "Alxasaurus_face.png", profil: "Alxasaurus_profil.png" },
    rinchenia: { folder: "Rinchenia", face: "Rinchenia_face.png", profil: "Rinchenia_profil.png" },
    bactrosaure: { folder: "Bactrosaurus", face: "Bactrosaurus_face.png", profil: "Bactrosaurus_profil.png" },
    nigersaurus: { folder: "Nigersaurus", face: "Nigersaurus_face.png", profil: "Nigersaurus_profil.png" },
    alioramus: { folder: "Alioramus", face: "Alioramus_face.png", profil: "Alioramus_profil.png" },
    gobisaure: { folder: "Gobisaurus", face: "Gobisaurus_face.png", profil: "Gobisaurus_profil.png" },
    linhenykus: { folder: "Linhenykus", face: "Linhenykus_face.png", profil: "Linhenykus_profil.png" },
    spinosaure: { folder: "spinosaure", face: "Spinosaure_face.png", profil: "Spinosaure_profil.png" }
  };
  function dpArtPath(speciesId, kind) {
    var a = DP_ART[speciesId];
    if (!a) return null;
    var sp = dpSpecies(speciesId);
    var zoneFolder = sp ? DP_ENCLOS_ZONE_FOLDER[sp.zone] : "";
    return "assets/dinos/" + zoneFolder + "/" + a.folder + "/" + a[kind];
  }
  // Prototype en ligne : une zone dont toutes les espèces n'ont pas encore leurs images ne doit pas
  // être achetable (l'élève paierait pour un enclos qu'il ne pourrait pas vraiment peupler). Calculé à
  // la volée plutôt que codé en dur : dès que les assets manquants d'une zone sont ajoutés, elle
  // redevient automatiquement disponible sans toucher au code.
  function dpZoneFullyStocked(zoneId) {
    var species = dpSpeciesByZone(zoneId);
    return species.length > 0 && species.every(function (s) { return !!DP_ART[s.id]; });
  }

  var DP_EGG_ZONE_FOLDER = { foret: "foret", plaine: "plaine", desert: "desert", arctique: "arctique", marine: "marin", volcanique: "volcanique" };
  var DP_EGG_RARITY_FOLDER = { commun: "communs", rare: "rares", epique: "epiques", legendaire: "legendaires" };
  function dpEggArtPath(zoneId, rarity) {
    return "assets/oeufs/oeuf_" + DP_EGG_ZONE_FOLDER[zoneId] + "_" + DP_EGG_RARITY_FOLDER[rarity] + ".png";
  }

  var DP_ENCLOS_ZONE_FOLDER = { foret: "Foret", plaine: "Plaine", desert: "Desert", arctique: "Arctique", marine: "Marine", volcanique: "Volcanique" };
  var DP_ENCLOS_VARIANT_COUNT = { marine: 1 };
  function dpEnclosureVariantCount(zoneId) { return DP_ENCLOS_VARIANT_COUNT[zoneId] || 3; }
  function dpRandomEnclosureVariant(zoneId) { return 1 + Math.floor(Math.random() * dpEnclosureVariantCount(zoneId)); }
  function dpEnclosureArtPath(zoneId, level, variant) {
    return "assets/objects/enclos/Variante" + variant + "_" + DP_ENCLOS_ZONE_FOLDER[zoneId] + "_level" + level + ".png";
  }
  function dpMerchantArtPath(zoneId) {
    return "assets/objects/marchand/Marchand_" + DP_ENCLOS_ZONE_FOLDER[zoneId] + ".png";
  }

  function dpSquareHtml(speciesId, opts) {
    opts = opts || {};
    var cls = "dp-square" + (opts.className ? " " + opts.className : "");
    var attrs = opts.attrs || "";
    var style = opts.style || "";
    if (opts.hidden) return '<div class="' + cls + '" style="background:var(--surface-2);' + style + '"' + attrs + '></div>';
    var src = opts.egg ? dpEggArtPath(opts.egg.zone, opts.egg.rarity) : dpArtPath(speciesId, opts.kind || "profil");
    if (src) return '<img class="' + cls + '" src="' + src + '" alt="" style="object-fit:contain;background:var(--surface-2);' + style + '" onerror="this.onerror=null;this.src=\'\';this.style.background=\'' + dpHashColor(speciesId) + '\'"' + attrs + '>';
    return '<div class="' + cls + '" style="background:' + dpHashColor(speciesId) + ';' + style + '"' + attrs + '></div>';
  }

  function dpEnclosureDinoHtml(speciesId, attrs) {
    attrs = attrs || "";
    var src = dpArtPath(speciesId, "profil");
    if (src) return '<img class="dp-enc-dino" src="' + src + '" alt="" onerror="this.style.display=\'none\'"' + attrs + '>';
    return '<div class="dp-enc-dino-fallback" style="background:' + dpHashColor(speciesId) + '"' + attrs + '></div>';
  }

  /* ---------------- Dino study companion ---------------- */
  function dinoCompanionHtml() {
    var dp = dpData();
    if (!dp.dinosaurs.length) return "";
    var sp = dp.companionSpeciesId ? dpSpecies(dp.companionSpeciesId) : null;
    var owned = sp && dp.dinosaurs.some(function (d) { return d.speciesId === sp.id; });
    if (!owned) {
      return '<div class="dino-companion-panel" id="dino-companion-panel-slot"><button type="button" class="btn btn-sm btn-ghost" style="width:100%" onclick="App.openCompanionModal()">🦕 Choisir un compagnon</button></div>';
    }
    return '<div class="dino-companion-panel" id="dino-companion-panel-slot">' +
      '<div class="dino-companion-wrap" id="dino-companion-wrap">' +
      dpSquareHtml(sp.id, { kind: "face", className: "dino-companion-img" }) +
      '<div class="dino-companion-fx" id="dino-companion-fx"></div>' +
      '</div>' +
      '<div class="dino-companion-name">' + esc(sp.name) + '</div>' +
      '<button type="button" class="btn btn-sm btn-ghost" style="width:100%" onclick="App.openCompanionModal()">Changer</button>' +
      '</div>';
  }
  function dinoReact(correct) {
    dpPlayGameSound(correct ? "correct" : "incorrect");
    var el = document.getElementById("dino-companion-wrap");
    if (!el) return;
    var cls = correct ? "dino-react-good" : "dino-react-bad";
    el.classList.remove("dino-react-good", "dino-react-bad");
    void el.offsetWidth;
    el.classList.add(cls);
    var fx = document.getElementById("dino-companion-fx");
    if (fx) {
      fx.innerHTML = "";
      var n = correct ? 3 : 2;
      for (var i = 0; i < n; i++) {
        var s = document.createElement("span");
        s.className = "dino-fx-item";
        s.textContent = correct ? "✨" : "😠";
        s.style.left = (8 + i * 30) + "%";
        s.style.animationDelay = (i * 0.15) + "s";
        fx.appendChild(s);
      }
    }
    el.addEventListener("animationend", function h() {
      el.classList.remove(cls);
      if (fx) fx.innerHTML = "";
      el.removeEventListener("animationend", h);
    }, { once: true });
  }

  var DP_QUIZ_POINTS_PER_CORRECT = 25;
  var DP_EXERCISE_POINTS = 150;
  function dpCourseHasContent(co) {
    return co.status === "ready" && ((co.quizQuestions && co.quizQuestions.length) || (co.exercises && co.exercises.length));
  }
  function dpSubjectsWithContent() {
    return userData().subjects.filter(function (s) {
      return s.themes.some(function (t) { return t.chapters.some(function (c) { return c.courses.some(dpCourseHasContent); }); });
    });
  }
  function dpThemesWithContent(subject) {
    return subject.themes.filter(function (t) { return t.chapters.some(function (c) { return c.courses.some(dpCourseHasContent); }); });
  }
  function dpChaptersWithContent(theme) {
    return theme.chapters.filter(function (c) { return c.courses.some(dpCourseHasContent); });
  }
  function dpCoursesWithContent(chapter) {
    return chapter.courses.filter(dpCourseHasContent);
  }

  // Nombre d'œufs proposés par le vendeur, PAR BIOME : 2 au départ, améliorable jusqu'à 5.
  var DP_SHOP_SLOTS_MIN = 2, DP_SHOP_SLOTS_MAX = 5;
  var DP_SHOP_SLOT_UPGRADE_COST = { 3: 400, 4: 800, 5: 1500 }; // prix pour passer À ce nombre d'œufs
  function dpShopSlots(zoneId) {
    var lv = (dpData().shopSlots || {})[zoneId] || DP_SHOP_SLOTS_MIN;
    return Math.max(DP_SHOP_SLOTS_MIN, Math.min(DP_SHOP_SLOTS_MAX, lv));
  }
  var DP_SHOP_DURATION = 30 * 60 * 1000;
  var DP_SHOP_REFRESH_COST = 150;
  var DP_SHOP_LUCK_COST = 300;
  var DP_ENCLOSURE_UPGRADE_COST = { 1: 250, 2: 500 };
  var DP_ENCLOSURE_BUILD_COST = 300;
  var DP_HATCH_PLACEMENT_LIMIT = 10 * 60 * 1000;

  function dpData() {
    var u = userData();
    if (!u.dinoPark) {
      // encBuildBugRefund à true dès la création : ce profil n'a jamais pu perdre de points dans
      // l'ancien bug d'achat d'enclos, il ne doit donc pas recevoir le remboursement rétroactif ci-dessous.
      u.dinoPark = { points: 500, unlockedZones: ["foret"], eggs: [], incubators: [null, null, null], enclosures: [], dinosaurs: [], discovered: {}, shops: {}, encBuildBugRefund: true };
    }
    var dp = u.dinoPark;
    dpAdvanceClock(dp);
    if (!dp.encBuildBugRefund) {
      // dpBuildEnclosure débitait les points AVANT de planter sur une variable inexistante lors de la
      // création de l'enclos : l'achat était prélevé sans jamais donner l'enclos. Remboursement unique
      // du coût d'achat pour compenser, maintenant que le bug est corrigé.
      dp.encBuildBugRefund = true;
      dp.points += DP_ENCLOSURE_BUILD_COST;
      toast("🎁 +" + DP_ENCLOSURE_BUILD_COST + " pts remboursés suite à un bug d'achat d'enclos corrigé");
    }
    if (!dp.shops) dp.shops = {};
    if (dp.companionSpeciesId === undefined) dp.companionSpeciesId = null;
    if (!dp.inventory) dp.inventory = { herbe: 0, fruit: 0, insecte: 0, poisson: 0, viande: 0, soin: 0 };
    DP_FOOD_ITEMS.concat(DP_MEDICINE_ITEMS).forEach(function (it) { if (dp.inventory[it.id] == null) dp.inventory[it.id] = 0; });
    dp.unlockedZones = dp.unlockedZones.filter(function (z) { return !!dpZone(z); });
    if (!dp.plaineRelocked) {
      dp.plaineRelocked = true;
      var pi = dp.unlockedZones.indexOf("plaine");
      if (pi !== -1) dp.unlockedZones.splice(pi, 1);
    }
    dp.enclosures = dp.enclosures.filter(function (e) { return !!dpZone(e.zone); });
    dp.enclosures.forEach(function (e) {
      if (!e.level) e.level = 1;
      if (!e.variant) e.variant = dpRandomEnclosureVariant(e.zone);
      if (e.capacity > 2) e.capacity = 2;
    });
    var encIds = {};
    dp.enclosures.forEach(function (e) { encIds[e.id] = true; });
    dp.dinosaurs = dp.dinosaurs.filter(function (d) { return !!dpSpecies(d.speciesId); });
    dp.dinosaurs.forEach(function (d) { if (d.enclosureId && !encIds[d.enclosureId]) d.enclosureId = null; });
    dp.dinosaurs.forEach(function (d) { dpTick(d, dp.virtualNow); });
    dp.dinosaurs = dp.dinosaurs.filter(function (d) {
      if (dpHealth(d) <= 0) { toast("💀 " + d.name + " n'a pas survécu..."); return false; }
      if (!d.enclosureId && (Date.now() - d.bornAt) > DP_HATCH_PLACEMENT_LIMIT) { toast("💀 " + d.name + " n'a pas survécu, il n'a pas été mis dans un enclos à temps..."); return false; }
      return true;
    });
    if (dp.companionSpeciesId && !dp.dinosaurs.some(function (d) { return d.speciesId === dp.companionSpeciesId; })) dp.companionSpeciesId = null;
    dp.eggs = dp.eggs.filter(function (e) { return !!dpSpecies(e.speciesId); });
    dp.incubators = dp.incubators.map(function (inc) { return (inc && dpSpecies(inc.speciesId)) ? inc : null; });
    return dp;
  }
  function dpEnclosuresInZone(zoneId) { return dpData().enclosures.filter(function (e) { return e.zone === zoneId; }); }
  function dpEnclosureDisplayName(e) {
    var dinos = dpData().dinosaurs.filter(function (d) { return d.enclosureId === e.id; });
    if (dinos.length) {
      var sp = dpSpecies(dinos[0].speciesId);
      if (sp) return "Enclos de " + sp.name;
    }
    return e.name || "Enclos vide";
  }
  function dpEnclosuresAvailableFor(d) {
    var sp = dpSpecies(d.speciesId);
    var dp = dpData();
    return dpEnclosuresInZone(sp.zone).filter(function (e) {
      var occupants = dp.dinosaurs.filter(function (o) { return o.enclosureId === e.id; });
      if (occupants.length >= e.capacity) return false;
      if (occupants.length && occupants[0].speciesId !== d.speciesId) return false;
      return true;
    });
  }
  function dpDinosaurById(id) { return dpData().dinosaurs.find(function (d) { return d.id === id; }); }
  function dpUnplacedDinosaurs() { return dpData().dinosaurs.filter(function (d) { return !d.enclosureId; }); }

  // Horloge virtuelle de la faim/vie : n'avance que par petits pas plafonnés à chaque tick, donc un
  // écart réel énorme (appli fermée pendant des heures/jours) n'ajoute quasiment rien — la faim et la
  // vie ne bougent QUE pendant qu'on joue réellement, jamais pendant qu'on est déconnecté.
  var DP_CLOCK_MAX_STEP = 2 * 60 * 1000;
  function dpAdvanceClock(dp) {
    var real = Date.now();
    if (!dp.clockAt || !dp.virtualNow) { dp.clockAt = real; dp.virtualNow = real; return; }
    var deltaReal = real - dp.clockAt;
    dp.virtualNow += Math.max(0, Math.min(deltaReal, DP_CLOCK_MAX_STEP));
    dp.clockAt = real;
  }
  function dpHunger(d, now) {
    if (now == null) now = dpData().virtualNow;
    return Math.max(0, Math.round(100 - ((now - d.lastFedAt) / 3600000) * 20));
  }
  function dpTick(d, now) {
    if (now == null) now = dpData().virtualNow;
    var last = d.healthCheckedAt || d.lastFedAt;
    // La faim met 5h à tomber à 0 (100 / 20 par heure) — on ne compte comme "heures d'affamement"
    // que le temps écoulé APRÈS ce cap, jamais tout le temps passé hors-ligne depuis le dernier repas.
    var hungerZeroAt = d.lastFedAt + 5 * 3600000;
    var starvingSince = Math.max(last, hungerZeroAt);
    if (now > starvingSince) {
      var hoursStarving = (now - starvingSince) / 3600000;
      d.health = Math.max(0, (d.health == null ? 100 : d.health) - hoursStarving * 10);
    }
    d.healthCheckedAt = now;
  }
  function dpHealth(d) { return d.health == null ? 100 : Math.round(d.health); }
  var DP_HUNGER_ALERT = 40;
  var DP_HEALTH_ALERT = 50;
  function dpNeedsAttention(d) {
    dpTick(d);
    var hungry = dpHunger(d) < DP_HUNGER_ALERT;
    var sick = dpHealth(d) < DP_HEALTH_ALERT;
    if (sick && hungry) return "both";
    if (sick) return "sick";
    if (hungry) return "hungry";
    return null;
  }
  function dpAttentionList() {
    return dpData().dinosaurs.filter(function (d) { return dpNeedsAttention(d); });
  }
  function dpAttentionBadgeHtml(d) {
    var need = dpNeedsAttention(d);
    if (!need) return "";
    var emoji = need === "sick" ? "🤒" : need === "both" ? "⚠️" : "🍖";
    var label = need === "both" ? "Faim et malade" : need === "sick" ? "Malade" : "A faim";
    return '<span class="dp-need-badge" title="' + label + '">' + emoji + '</span>';
  }
  function dpPlacementCountdownHtml(d) {
    if (d.enclosureId) return "";
    var remain = DP_HATCH_PLACEMENT_LIMIT - (Date.now() - d.bornAt);
    if (remain <= 0) return "";
    var urgent = remain < 2 * 60 * 1000;
    return '<div class="dp-placement-countdown' + (urgent ? " dp-placement-countdown-urgent" : "") + '" title="Temps restant avant de le placer dans un enclos">⏳ ' + dpFormatCountdown(remain) + '</div>';
  }
  function dpHappiness(d) {
    var enc = dpData().enclosures.find(function (e) { return e.id === d.enclosureId; });
    var decorFactor = enc ? (enc.level - 1) * 50 : 0;
    return Math.round(dpHunger(d) * 0.4 + dpHealth(d) * 0.4 + decorFactor * 0.2);
  }
  function dpAgeLabel(d) {
    var mins = Math.floor((Date.now() - d.bornAt) / 60000);
    if (mins < 1) return "à l'instant";
    if (mins < 60) return mins + " min";
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + " h";
    return Math.floor(hours / 24) + " j";
  }
  // Chance du vendeur, par niveaux. Chaque case de la boutique tire d'abord sa RARETÉ avec ces
  // pourcentages (ceux affichés au joueur), puis une espèce de cette rareté. Avant, on tirait 5 espèces
  // différentes pondérées une par une : avec seulement 10 espèces par biome, ça sortait presque toujours
  // les 4 communs, et « Chance+ » ne changeait quasiment rien.
  var DP_LUCK_ODDS = [
    { commun: 70, rare: 22, epique: 7, legendaire: 1 },
    { commun: 50, rare: 33, epique: 13, legendaire: 4 },
    { commun: 35, rare: 38, epique: 20, legendaire: 7 },
    { commun: 20, rare: 40, epique: 28, legendaire: 12 },
    { commun: 10, rare: 38, epique: 34, legendaire: 18 },
    { commun: 0, rare: 35, epique: 40, legendaire: 25 }
  ];
  var DP_LUCK_MAX = DP_LUCK_ODDS.length - 1;
  function dpLuckLevel(shop) { return Math.max(0, Math.min(DP_LUCK_MAX, (shop && shop.luck) || 0)); }
  // « Chance » affichée = probabilité qu'une case ne soit PAS un commun.
  function dpLuckPercent(level) { return 100 - DP_LUCK_ODDS[level].commun; }
  function dpGenerateShopItems(zoneId, luckLevel, count) {
    var species = dpSpeciesByZone(zoneId);
    var odds = DP_LUCK_ODDS[Math.max(0, Math.min(DP_LUCK_MAX, luckLevel || 0))];
    var byRarity = {};
    species.forEach(function (s) { (byRarity[s.rarity] = byRarity[s.rarity] || []).push(s.id); });
    var rarities = Object.keys(odds).filter(function (r) { return odds[r] > 0 && byRarity[r]; });
    var total = rarities.reduce(function (sum, r) { return sum + odds[r]; }, 0);
    var picks = [], used = {};
    var slots = Math.min(count || dpShopSlots(zoneId), species.length);
    for (var i = 0; i < slots && total > 0; i++) {
      var x = Math.random() * total, rarity = rarities[rarities.length - 1];
      for (var k = 0; k < rarities.length; k++) { x -= odds[rarities[k]]; if (x < 0) { rarity = rarities[k]; break; } }
      // Une espèce pas encore proposée si possible ; sinon (ex. 2 légendaires tirés, 1 seule espèce) on la répète.
      var candidates = byRarity[rarity].filter(function (id) { return !used[id]; });
      if (!candidates.length) candidates = byRarity[rarity];
      var pick = candidates[Math.floor(Math.random() * candidates.length)];
      used[pick] = true;
      picks.push(pick);
    }
    return picks;
  }
  function dpShop(zoneId) {
    var dp = dpData();
    var shop = dp.shops[zoneId];
    if (!shop || Date.now() >= shop.expiresAt) {
      shop = { items: dpGenerateShopItems(zoneId, 0), luck: 0, expiresAt: Date.now() + DP_SHOP_DURATION };
      dp.shops[zoneId] = shop;
      saveDB();
    }
    // Boutique générée avant le passage à 2 œufs de base (ou trop grande) : on la ramène au bon nombre.
    var maxSlots = dpShopSlots(zoneId);
    if (shop.items.length > maxSlots) { shop.items = shop.items.slice(0, maxSlots); saveDB(); }
    return shop;
  }
  function dpFormatCountdown(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ":" + String(r).padStart(2, "0");
  }

  var DP_MERCHANT_SOUNDS = {
    welcome: ["welcome1.mp3", "welcome2.mp3", "welcome3.mp3", "welcome4.mp3"],
    thankyou: ["thankyou1.mp3", "thankyou2.mp3", "thankyou3.mp3", "thankyou4.mp3"],
    noCash: ["not_enough_cash.mp3"],
    whatAreYouSelling: ["what_are_you_selling.mp3"],
    interesting: ["interesting.mp3"]
  };
  function dpSyncPointsDisplay() {
    var points = dpData().points;
    document.querySelectorAll(".dp-points-value").forEach(function (el) { el.textContent = points; });
  }
  var dpCurrentMerchantAudio = null;
  function dpPlayMerchantSound(kind) {
    var pool = DP_MERCHANT_SOUNDS[kind];
    if (!pool || !pool.length) return;
    if (dpCurrentMerchantAudio) {
      try { dpCurrentMerchantAudio.pause(); dpCurrentMerchantAudio.currentTime = 0; } catch (e) {}
      dpCurrentMerchantAudio = null;
    }
    var vol = getVolumeSfx() / 100;
    if (vol <= 0) return;
    var file = pool[Math.floor(Math.random() * pool.length)];
    try {
      var audio = new Audio("assets/mp3/marchand/" + file);
      audio.volume = vol;
      dpCurrentMerchantAudio = audio;
      audio.play().catch(function () {});
    } catch (e) {}
  }

  var DP_GAME_SOUNDS = { correct: ["correct.mp3"], incorrect: ["incorrect.mp3"] };
  function dpPlayGameSound(kind) {
    var pool = DP_GAME_SOUNDS[kind];
    if (!pool || !pool.length) return;
    var vol = getVolumeSfx() / 100;
    if (vol <= 0) return;
    var file = pool[Math.floor(Math.random() * pool.length)];
    try {
      var audio = new Audio(encodeURI("assets/mp3/sons du jeux/" + file));
      audio.volume = vol;
      audio.play().catch(function () {});
    } catch (e) {}
  }

  function dpDecorHtml() {
    return '<img class="dp-decor" src="assets/objects/decor/nuage_1.png" alt="" style="width:110px;top:1%;left:280px">' +
      '<img class="dp-decor" src="assets/objects/decor/nuage_2.png" alt="" style="width:90px;top:4%;left:46%">' +
      '<img class="dp-decor" src="assets/objects/decor/nuage_3.png" alt="" style="width:100px;top:0%;right:6%">' +
      '<img class="dp-decor dp-decor-ground" src="assets/objects/decor/montagne_1.png" alt="" style="width:260px;left:255px;opacity:0.75;z-index:-2">' +
      '<img class="dp-decor dp-decor-ground" src="assets/objects/decor/montagne_2.png" alt="" style="width:220px;right:0%;opacity:0.7;z-index:-2">' +
      '<img class="dp-decor dp-decor-ground" src="assets/objects/decor/arbre_1.png" alt="" style="width:150px;left:255px">' +
      '<img class="dp-decor dp-decor-ground" src="assets/objects/decor/arbre_2.png" alt="" style="width:110px;left:390px">' +
      '<img class="dp-decor dp-decor-ground" src="assets/objects/decor/buisson_2.png" alt="" style="width:80px;left:340px">' +
      '<img class="dp-decor dp-decor-ground" src="assets/objects/decor/rocher_1.png" alt="" style="width:65px;left:470px">' +
      '<img class="dp-decor dp-decor-ground" src="assets/objects/decor/plante_2.png" alt="" style="width:50px;left:300px">' +
      '<img class="dp-decor dp-decor-ground" src="assets/objects/decor/plante_3.png" alt="" style="width:55px;left:520px">' +
      '<img class="dp-decor dp-decor-ground" src="assets/objects/decor/arbre_3.png" alt="" style="width:160px;right:0%">' +
      '<img class="dp-decor dp-decor-ground" src="assets/objects/decor/buisson_3.png" alt="" style="width:85px;right:9%">' +
      '<img class="dp-decor dp-decor-ground" src="assets/objects/decor/buisson_1.png" alt="" style="width:75px;right:15%">' +
      '<img class="dp-decor dp-decor-ground" src="assets/objects/decor/rocher_3.png" alt="" style="width:65px;right:20%">' +
      '<img class="dp-decor dp-decor-ground" src="assets/objects/decor/rocher_2.png" alt="" style="width:60px;right:5%">' +
      '<img class="dp-decor dp-decor-ground" src="assets/objects/decor/plante_1.png" alt="" style="width:50px;right:12%">';
  }

  function renderDinoParkHub() {
    var dp = dpData();
    var head = '<div class="page-head"><div><div class="page-title-row"><img class="page-title-logo" src="assets/objects/ui/DinoPark.png" alt=""><h1 class="page-title">Dino Park</h1></div><p class="page-sub">Ton île principale — choisis un portail pour explorer une zone.</p></div></div>';
    var needy = dpAttentionList();
    var alertBanner = needy.length ? '<div class="dp-hub-alert">⚠️ ' + needy.length + ' dino' + (needy.length > 1 ? "s ont besoin" : " a besoin") + ' d\'attention (faim ou maladie)' +
      '<button class="btn btn-sm btn-primary" onclick="App.dpSelectDino(\'' + needy[0].id + '\')">Voir</button></div>' : '';
    var points = '<div class="dp-points-badge">🪙 ' + dp.points + ' points</div>';
    var actions = '<div class="dp-actions"><button class="btn btn-ghost" onclick="App.dpGoLab()">🧪 Laboratoire</button><button class="btn btn-ghost" onclick="App.dpGoEncyclopedia()">📖 Encyclopédie</button><button class="btn btn-primary" style="width:auto" onclick="App.dpGoQuiz()">🧠 Gagner des points</button></div>';
    var zoneGrid = '<div class="dp-zone-grid">' + DP_ZONES.map(function (z) {
      var unlocked = dp.unlockedZones.indexOf(z.id) !== -1;
      if (unlocked) {
        return '<button class="dp-zone-card" onclick="App.dpGoZone(\'' + z.id + '\')">' +
          '<div class="dp-zone-portal" style="background-image:url(\'' + dpPortalArtPath(z.id, false) + '\')"></div>' +
          '<div class="dp-zone-sign">' + esc(z.name) + '</div>' +
          '</button>';
      }
      var stocked = dpZoneFullyStocked(z.id);
      var canUnlock = stocked && dp.points >= z.cost;
      return '<div class="dp-zone-card locked">' +
        '<div class="dp-zone-portal" style="background-image:url(\'' + dpPortalArtPath(z.id, true) + '\')"></div>' +
        '<div class="dp-zone-sign">' + esc(z.name) + '</div>' +
        (stocked
          ? '<div class="dp-zone-meta mono">' + z.cost + ' pts</div>' +
            '<button class="btn btn-sm ' + (canUnlock ? "btn-primary" : "btn-ghost") + '" ' + (canUnlock ? "" : "disabled") + ' onclick="App.dpUnlockZone(\'' + z.id + '\')">Débloquer</button>'
          : '<div class="dp-zone-meta mono">Bientôt disponible</div>' +
            '<button class="btn btn-sm btn-ghost" disabled title="Cette zone n\'a pas encore tous ses dinosaures">Indisponible</button>') +
        '</div>';
    }).join("") + '</div>';
    renderShell(["dinopark"], dpDecorHtml() + head + alertBanner + points + actions + zoneGrid);
  }

  function renderDinoParkZone(zoneId) {
    var zone = dpZone(zoneId);
    var dp = dpData();
    var backBtn = '<button class="btn btn-ghost" style="width:auto;margin-bottom:20px" onclick="App.dpGoHub()">← Retour au spawn</button>';
    var head = '<div class="dp-zone-head"><div class="page-title-row"><span style="font-size:22px">' + zone.emoji + '</span><h1 class="page-title">Zone ' + esc(zone.name) + '</h1></div><p class="page-sub">' + dpSpeciesByZone(zoneId).length + ' espèces répertoriées ici.</p></div>';

    var shopState = dpShop(zoneId);
    var encCost = dpZoneEnclosureCost(zoneId);
    var canBuyEnc = dp.points >= encCost;
    var shop = '<div class="dp-section dp-merchant-triggers">' +
      '<button class="dp-merchant-trigger" onclick="App.dpOpenMerchant(\'' + zoneId + '\')">' +
      '<span class="dp-merchant-trigger-icon">⛺</span><span>Marchand d\'œufs</span>' +
      '<span class="dp-merchant-trigger-timer mono" id="dp-shop-timer-mini" data-zone="' + zoneId + '">⏳ ' + dpFormatCountdown(shopState.expiresAt - Date.now()) + '</span>' +
      '</button>' +
      '<button class="dp-merchant-trigger" onclick="App.dpOpenObjectMerchant(\'' + zoneId + '\')">' +
      '<span class="dp-merchant-trigger-icon">🛒</span><span>Marchand d\'objets</span>' +
      '</button>' +
      '<button class="dp-merchant-trigger' + (canBuyEnc ? "" : " dp-merchant-trigger-dim") + '" onclick="App.dpBuildEnclosure(\'' + zoneId + '\')">' +
      '<span class="dp-merchant-trigger-icon">🏕️</span><span>Construire un enclos</span>' +
      '<span class="dp-merchant-trigger-timer mono">' + encCost + ' pts</span>' +
      '</button>' +
      '</div>';

    var encs = dpEnclosuresInZone(zoneId);
    var enclosures = '<div class="dp-section">' +
      (encs.length ? '<h3 class="dp-section-title">Tes enclos</h3><div class="dp-enclosure-grid">' + encs.map(function (e) {
        var dinos = dp.dinosaurs.filter(function (d) { return d.enclosureId === e.id; });
        var art = dpEnclosureArtPath(zoneId, e.level, e.variant);
        var upgradeCost = DP_ENCLOSURE_UPGRADE_COST[e.level];
        var canUpgrade = upgradeCost != null && dp.points >= upgradeCost;
        return '<div class="dp-enclosure-card">' +
          '<div class="dp-enc-visual">' +
          '<img class="dp-enc-img" src="' + art + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
          '<div class="dp-enc-fallback">' + zone.emoji + '</div>' +
          '<div class="dp-enc-dino-slot">' + (dinos.length ? dinos.map(function (d) {
            var dsc = dpDinoSizeScale(dpSpecies(d.speciesId).weightKg);
            return '<span class="dp-dino-thumb-wrap" style="width:' + (28 * dsc).toFixed(1) + '%;max-width:' + Math.round(210 * dsc) + 'px">' + dpEnclosureDinoHtml(d.speciesId, ' title="' + esc(dpSpecies(d.speciesId).name) + '" onclick="App.dpSelectDino(\'' + d.id + '\')"') + dpAttentionBadgeHtml(d) + '</span>';
          }).join("") : '<span class="dp-enc-empty-hint">Vide</span>') + '</div>' +
          '</div>' +
          '<div class="dp-enc-sign">' +
          '<div class="dp-enclosure-head"><span>' + esc(dpEnclosureDisplayName(e)) + '</span><span class="dp-enclosure-count mono">' + dinos.length + '/' + e.capacity + '</span></div>' +
          '<div class="dp-enc-info"><span>Déco niveau ' + e.level + '/3</span>' +
          (upgradeCost != null
            ? '<button class="btn btn-sm ' + (canUpgrade ? "btn-primary" : "btn-ghost") + '" ' + (canUpgrade ? "" : "disabled") + ' onclick="App.dpUpgradeEnclosure(\'' + e.id + '\')">Améliorer (' + upgradeCost + ' pts)</button>'
            : '<span class="dp-empty-note">Niveau max</span>') +
          '</div>' +
          '</div>' +
          '</div>';
      }).join("") + '</div>' : '<p class="dp-empty-note">Aucun enclos ici pour l\'instant.</p>') +
      '</div>';

    var unplaced = dpUnplacedDinosaurs().filter(function (d) { return dpSpecies(d.speciesId).zone === zoneId; });
    var unplacedHtml = unplaced.length ? '<div class="dp-section"><h3 class="dp-section-title">🦕 En attente d\'un enclos</h3><div class="dp-enclosure-dinos">' +
      unplaced.map(function (d) {
        return '<span class="dp-dino-thumb-wrap">' + dpSquareHtml(d.speciesId, { attrs: ' title="' + esc(dpSpecies(d.speciesId).name) + '" onclick="App.dpSelectDino(\'' + d.id + '\')"' }) + dpAttentionBadgeHtml(d) + dpPlacementCountdownHtml(d) + '</span>';
      }).join("") + '</div></div>' : "";

    renderShell(["dinopark"], dpDecorHtml() + backBtn + head + shop + enclosures + unplacedHtml);
  }

  function renderDinoParkLab() {
    var dp = dpData();
    var backBtn = '<button class="btn btn-ghost" style="width:auto;margin-bottom:20px" onclick="App.dpGoHub()">← Retour au spawn</button>';
    var head = '<div class="page-head"><div><div class="page-title-row">' + sprite("egg", 4) + '<h1 class="page-title">Laboratoire</h1></div><p class="page-sub">Place tes œufs dans un incubateur pour les faire éclore.</p></div></div>';
    var grid = '<div class="dp-lab-grid">' + dp.incubators.map(function (inc, i) {
      if (!inc) {
        return '<div class="dp-incubator dp-incubator-empty">' +
          '<img class="dp-incubator-art" src="assets/objects/ui/incubateur_vide.png" alt="">' +
          (dp.eggs.length ? '<select onchange="App.dpStartIncubation(' + i + ', this.value)"><option value="">Choisir un œuf…</option>' + dp.eggs.map(function (e, ei) { return '<option value="' + ei + '">' + esc(dpSpecies(e.speciesId).name) + '</option>'; }).join("") + '</select>' : '<span class="dp-empty-note">Aucun œuf en stock</span>') +
          '</div>';
      }
      var sp = dpSpecies(inc.speciesId);
      var rarity = DP_RARITY[sp.rarity];
      var remainMs = rarity.hatch * 1000 - (Date.now() - inc.startedAt);
      var pct = Math.min(100, Math.round((Date.now() - inc.startedAt) / 1000 / rarity.hatch * 100));
      var done = remainMs <= 0;
      return '<div class="dp-incubator">' +
        '<img class="dp-incubator-art" src="assets/objects/ui/incubateur_remplie.png" alt="">' +
        '<div class="dp-egg-name">' + esc(sp.name) + '</div>' +
        '<div class="dp-bar"><div class="dp-bar-fill" style="width:' + pct + '%;background:var(--leaf)"></div></div>' +
        (done ? '<button class="btn btn-sm btn-primary" onclick="App.dpCollectHatched(' + i + ')">Récupérer 🎉</button>' : '<span class="dp-empty-note mono dp-inc-timer" data-slot="' + i + '">⏳ ' + dpFormatCountdown(remainMs) + '</span>') +
        '</div>';
    }).join("") + '</div>';
    renderShell(["dinopark"], dpDecorHtml() + backBtn + head + grid);
  }

  function renderDinoParkEncyclopedia() {
    var dp = dpData();
    var backBtn = '<button class="btn btn-ghost" style="width:auto;margin-bottom:20px" onclick="App.dpGoHub()">← Retour au spawn</button>';
    var head = '<div class="page-head"><div><div class="page-title-row">' + sprite("footprint", 4) + '<h1 class="page-title">Encyclopédie</h1></div><p class="page-sub">' + DP_ACTIVE_SPECIES_LIST.filter(function (s) { return dp.discovered[s.id]; }).length + ' / ' + DP_ACTIVE_SPECIES_LIST.length + ' espèces découvertes.</p></div></div>';
    var grid = '<div class="dp-ency-grid">' + DP_ACTIVE_SPECIES_LIST.map(function (sp, i) {
      var found = !!dp.discovered[sp.id];
      var num = String(i + 1).padStart(3, "0");
      return '<div class="dp-ency-cell ' + (found ? "" : "locked") + '">' +
        dpSquareHtml(sp.id, { hidden: !found, kind: "face" }) +
        '<div class="dp-ency-num mono">' + num + '</div>' +
        '<div class="dp-ency-name">' + (found ? esc(sp.name) : "???") + '</div>' +
        '</div>';
    }).join("") + '</div>';
    renderShell(["dinopark"], dpDecorHtml() + backBtn + head + grid);
  }

  function dpFinishAnswer(qz, q, yourAnswerText, correctAnswerText, level, mistakes) {
    var wasCorrect = gradeLevelIsSuccess(level);
    qz.wasCorrect = wasCorrect;
    qz.level = level;
    qz.answeredCount++;
    if (wasCorrect) qz.correct++; else qz.wrong++;
    // Les points suivent le barème gradué (pointsFactor), pas seulement "réussi ou pas" — sinon un
    // "2 erreurs" qui rapporte pourtant des points d'après GRADE_LEVELS n'en recevrait jamais ici.
    var earned = Math.round(DP_QUIZ_POINTS_PER_CORRECT * (GRADE_LEVELS[level] || GRADE_LEVELS.wrong).pointsFactor);
    if (earned > 0) {
      qz.totalEarned += earned;
      var dp = dpData();
      dp.points += earned;
      saveDB();
      toast("+" + earned + " pts !");
    }
    qz.history.push({ prompt: q.prompt, yourAnswer: yourAnswerText, correctAnswer: correctAnswerText, explanation: q.explanation, wasCorrect: wasCorrect, level: level, mistakes: mistakes || [], figureSvg: q.figureSvg || "" });
  }

  function renderDinoParkQuiz() {
    var backBtn = '<button class="btn btn-ghost" style="width:auto;margin-bottom:20px" onclick="App.dpGoHub()">← Retour au spawn</button>';
    var head = '<div class="page-head"><div><div class="page-title-row">' + sprite("dino", 4) + '<h1 class="page-title">Répondre à des questions</h1></div><p class="page-sub">Révise tes cours importés pour gagner des points.</p></div></div>';

    if (!dpView.quiz) {
      var nav = dpView.quizNav || (dpView.quizNav = { level: "subjects" });
      var list;
      if (nav.level === "themes" || nav.level === "chapters" || nav.level === "courses") {
        var navSubj = findSubject(nav.subjectId);
        if (!navSubj) nav = dpView.quizNav = { level: "subjects" };
      }
      if (nav.level === "chapters" || nav.level === "courses") {
        var navTheme = findTheme(findSubject(nav.subjectId), nav.themeId);
        if (!navTheme) nav = dpView.quizNav = { level: "themes", subjectId: nav.subjectId };
      }
      if (nav.level === "courses") {
        var navChap = findChapter(findTheme(findSubject(nav.subjectId), nav.themeId), nav.chapterId);
        if (!navChap) nav = dpView.quizNav = { level: "chapters", subjectId: nav.subjectId, themeId: nav.themeId };
      }
      if (nav.level === "subjects") {
        var subs = dpSubjectsWithContent();
        list = subs.length
          ? '<div class="dp-section"><h3 class="dp-section-title">Choisis une matière</h3><div class="dp-subject-grid">' +
            subs.map(function (s) {
              return '<div class="dp-subject-card" onclick="App.dpQuizGoSubject(\'' + s.id + '\')">' + icon("book") + '<span>' + esc(s.name) + '</span></div>';
            }).join("") + '</div></div>'
          : '<p class="dp-empty-note">Importe et génère au moins un cours pour pouvoir réviser ici.</p>';
      } else if (nav.level === "themes") {
        var subj0 = findSubject(nav.subjectId);
        var themes0 = dpThemesWithContent(subj0);
        list = '<button class="btn btn-ghost" style="width:auto;margin-bottom:16px" onclick="App.dpQuizGoSubjects()">← Retour aux matières</button>' +
          '<div class="dp-section"><h3 class="dp-section-title">' + esc(subj0.name) + ' — choisis un thème</h3><div class="dp-subject-grid">' +
          themes0.map(function (t) {
            return '<div class="dp-subject-card" onclick="App.dpQuizGoTheme(\'' + t.id + '\')">' + icon("book") + '<span>' + esc(t.name) + '</span></div>';
          }).join("") + '</div></div>';
      } else if (nav.level === "chapters") {
        var subj = findSubject(nav.subjectId);
        var theme = findTheme(subj, nav.themeId);
        var chaps = dpChaptersWithContent(theme);
        list = '<button class="btn btn-ghost" style="width:auto;margin-bottom:16px" onclick="App.dpQuizGoThemes(\'' + subj.id + '\')">← Retour aux thèmes</button>' +
          '<div class="dp-section"><h3 class="dp-section-title">' + esc(subj.name) + ' / ' + esc(theme.name) + ' — choisis un chapitre</h3><div class="dp-subject-grid">' +
          chaps.map(function (c) {
            return '<div class="dp-subject-card" onclick="App.dpQuizGoChapter(\'' + c.id + '\')">' + icon("folder") + '<span>' + esc(c.name) + '</span></div>';
          }).join("") + '</div></div>';
      } else {
        var subj2 = findSubject(nav.subjectId);
        var theme2 = findTheme(subj2, nav.themeId);
        var chap2 = findChapter(theme2, nav.chapterId);
        var courses = dpCoursesWithContent(chap2);
        list = '<button class="btn btn-ghost" style="width:auto;margin-bottom:16px" onclick="App.dpQuizGoChapters(\'' + subj2.id + '\',\'' + theme2.id + '\')">← Retour aux chapitres</button>' +
          '<div class="dp-section"><h3 class="dp-section-title">' + esc(subj2.name) + ' / ' + esc(theme2.name) + ' / ' + esc(chap2.name) + '</h3><div class="dp-subject-grid">' +
          courses.map(function (co) {
            var qCount = (co.quizQuestions || []).length;
            var exCount = (co.exercises || []).length;
            return '<div class="dp-subject-card" style="cursor:default">' +
              '<div style="font-weight:700;font-size:12.5px;margin-bottom:8px">' + esc(co.title) + '</div>' +
              (qCount ? '<button class="btn btn-sm btn-primary" style="width:100%;margin-bottom:6px" onclick="App.dpStartCourseQuiz(\'' + co.id + '\')">🧠 Questions (' + qCount + ')</button>' : '') +
              (exCount ? '<button class="btn btn-sm btn-ghost" style="width:100%" onclick="App.dpStartCourseExercise(\'' + co.id + '\')">✏️ Exercice (+' + DP_EXERCISE_POINTS + ' pts)</button>' : '') +
              '</div>';
          }).join("") + '</div></div>';
      }
      renderShell(["dinopark"], backBtn + head + list);
      return;
    }

    var qz = dpView.quiz;
    if (qz.mode === "exercise") { renderDinoParkExercise(backBtn, head, qz); return; }

    if (qz.done) {
      var items = qz.history.map(function (h) {
        var level = h.level || (h.wasCorrect ? "correct" : "wrong");
        var cls = gradeLevelCls(level);
        return '<div class="correction-item ' + cls + '">' +
          '<div class="correction-q">' + esc(h.prompt) + '<span class="grade-pill grade-' + cls + '">' + gradeLevelLabel(level) + '</span></div>' + exerciseFigureHtml(h) +
          '<div class="correction-ans ' + (h.wasCorrect ? "good" : "bad") + '">Ta réponse : ' + esc(h.yourAnswer || "(vide)") + '</div>' +
          gradeMistakesHtml(h.mistakes) +
          (level === "correct" ? '' : '<div class="correction-ans good">Bonne réponse : ' + esc(h.correctAnswer) + '</div>') +
          '<div class="correction-exp">' + mdToHtml(h.explanation || "") + '</div>' +
          '</div>';
      }).join("");
      renderShell(["dinopark"], backBtn + head +
        '<div class="result-hero"><div class="result-score mono">+' + qz.totalEarned + '</div><div class="result-total">points gagnés · ' + qz.correct + '/' + (qz.correct + qz.wrong) + ' bonnes réponses</div></div>' +
        '<button class="btn btn-ghost" style="width:auto;margin:0 auto 26px;display:flex" onclick="App.dpGoQuiz()">Choisir un autre cours</button>' +
        '<h3 style="font-size:16px;margin-bottom:12px">Correction</h3>' + items);
      return;
    }

    var q = qz.questions[qz.idx];
    var body = '<div class="quiz-batch-note">' + qz.totalEarned + ' pts gagnés jusqu\'ici</div>' +
      '<div class="quiz-q-num">Question ' + (qz.idx + 1) + ' / ' + qz.questions.length + '</div>' +
      '<div class="quiz-q-text">' + esc(q.prompt) + '</div>' + exerciseFigureHtml(q);

    if (q.type === "qcm") {
      body += q.choices.map(function (c, i) {
        var cls = "quiz-choice";
        var attrs = "";
        if (qz.revealed) {
          cls += " disabled";
          if (i === q.correctIndex) cls += " correct";
          else if (i === qz.answer) cls += " wrong";
        } else {
          attrs = ' onclick="App.dpAnswerQcm(' + i + ')"';
        }
        return '<label class="' + cls + '"' + attrs + '><input type="radio" ' + (qz.answer === i ? "checked" : "") + ' readonly disabled><span>' + esc(c) + '</span></label>';
      }).join("");
    } else if (qz.status === "grading") {
      body += '<div class="processing-box">' + genLogo() + '<span>Correction en cours…</span></div>';
    } else if (qz.status !== "graded") {
      body += '<div class="field">' + richEditorHtml("dp-open-answer", "Tape ta réponse…", qz.answerHtml || "") + '</div>' +
        '<button class="btn btn-primary" style="width:auto" onclick="App.dpSubmitOpenAnswer()">Valider</button>';
    } else {
      body += '<div class="rte-display" style="color:var(--text-muted);font-size:13.5px;margin-bottom:6px">Ta réponse :</div>' +
        '<div class="rte-display" style="margin-bottom:14px">' + (qz.answerHtml || "<em>(vide)</em>") + '</div>' +
        '<p style="font-size:13.5px;margin-bottom:14px">Réponse attendue : <strong>' + inlineMd(q.answer) + '</strong></p>';
    }

    if (qz.revealed && qz.wasCorrect != null) {
      var qlvl = qz.level || (qz.wasCorrect ? "correct" : "wrong");
      var qcls = gradeLevelCls(qlvl);
      body += '<div class="quiz-feedback ' + qcls + '">' +
        '<div class="quiz-feedback-title ' + qcls + '" style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span>' + gradeLevelLabel(qlvl) + '</span>' + gradeScoreBadge(qz.score, qz.scoreMax) + '</div>' +
        gradeMistakesHtml(qz.mistakes) +
        (qz.aiFeedback ? '<div class="correction-exp">' + mdToHtml(qz.aiFeedback) + '</div>' : "") +
        '<div class="correction-exp">' + mdToHtml(q.explanation || "") + '</div>' +
        '</div>' +
        '<div class="quiz-nav"><span></span><button class="btn btn-primary" style="width:auto" onclick="App.dpNextQuizQuestion()">' + (qz.idx === qz.questions.length - 1 ? "Terminer" : "Suivante →") + '</button></div>';
    }

    renderShell(["dinopark"], backBtn + head + '<div class="exercise-layout"><div class="quiz-wrap">' + body + '</div>' + dinoCompanionHtml() + '</div>');
  }

  function renderDinoParkExercise(backBtn, head, qz) {
    var ex = qz.exercise;
    var body = '<div class="dp-exercise-box"><div class="dp-exercise-label">Exercice</div><div class="dp-exercise-text">' + mdToHtml(splitInlineNumberedQuestions(ex.prompt)) + '</div></div>' + exerciseFigureHtml(ex);
    if (qz.status === "grading") {
      body += '<div class="processing-box">' + genLogo() + '<span>Correction en cours…</span></div>';
    } else if (qz.status === "graded") {
      var exlvl = qz.level || (qz.correct ? "correct" : "wrong");
      var excls = gradeLevelCls(exlvl);
      body += '<div class="rte-display" style="color:var(--text-muted);font-size:13.5px;margin-bottom:6px">Ta réponse :</div>' +
        '<div class="rte-display" style="margin-bottom:14px">' + (qz.answerHtml || "<em>(vide)</em>") + '</div>' +
        '<div class="quiz-feedback ' + excls + '">' +
        '<div class="quiz-feedback-title ' + excls + '" style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span>' + gradeLevelLabel(exlvl) + (qz.pointsEarned ? " ! +" + qz.pointsEarned + " pts" : "") + '</span>' + gradeScoreBadge(qz.score, qz.scoreMax) + '</div>' +
        gradeMistakesHtml(qz.mistakes) +
        '<div class="correction-exp">' + mdToHtml(qz.feedback) + '</div>' +
        '</div>' +
        '<div class="dp-exercise-box" style="margin-top:14px"><div class="dp-exercise-label">Solution de référence</div><div class="dp-exercise-text">' + mdToHtml(splitInlineNumberedQuestions(ex.solution)) + '</div></div>' +
        '<div class="quiz-nav" style="margin-top:14px"><button class="btn btn-ghost" style="width:auto" onclick="App.dpGoQuiz()">Choisir un autre cours</button><button class="btn btn-ghost" style="width:auto" onclick="App.downloadDpExercisePdf()">⬇️ Télécharger en PDF</button></div>';
    } else {
      body += '<div class="field"><label>Ta réponse</label>' + richEditorHtml("dp-exercise-answer", "Écris ton raisonnement et ta réponse…", qz.answerHtml || "", true) + '</div>' +
        '<button class="btn btn-primary" style="width:auto" onclick="App.dpSubmitExerciseAnswer()">Valider ma réponse</button>';
    }
    renderShell(["dinopark"], backBtn + head + '<div class="exercise-layout"><div class="quiz-wrap quiz-wrap-exercise">' + body + '</div>' + dinoCompanionHtml() + '</div>');
  }

  function renderDinoParkPage() {
    if (dpView.mode === "zone") { renderDinoParkZone(dpView.zoneId); return; }
    if (dpView.mode === "lab") { renderDinoParkLab(); return; }
    if (dpView.mode === "encyclopedia") { renderDinoParkEncyclopedia(); return; }
    if (dpView.mode === "quiz") { renderDinoParkQuiz(); return; }
    renderDinoParkHub();
  }

  /* ---------------- DinoTime ---------------- */
  var DT_DURATIONS = [5, 15, 25, 45, 60];
  var DT_MIN_X = 24, DT_MAX_X = 76;

  var DP_DINOTIME_ZONE_FOLDER = { foret: "foret", plaine: "plaine", desert: "desert", arctique: "arctique", marine: "aquatique", volcanique: "volcanique" };
  function dtArtPath(zoneId, level) {
    return "assets/dinotime/enclos_" + (DP_DINOTIME_ZONE_FOLDER[zoneId] || zoneId) + "_level" + level + ".png";
  }
  function dtAllEnclosures() { return dpData().enclosures.slice(); }
  function dtEnclosureDinos(encId) { return dpData().dinosaurs.filter(function (d) { return d.enclosureId === encId; }); }

  function renderDinoTimePage() {
    if (dtState.mode === "running" && dtRunning) { renderDinoTimeRunning(); return; }
    if (dtState.mode === "running" && dtPomoRunning) { renderPomodoroRunning(); return; }
    renderDinoTimeSetup();
  }

  function renderDinoTimeSetup() {
    var head = '<div class="page-head"><div><div class="page-title-row"><img class="page-title-logo" src="assets/objects/ui/DinoTime.png" alt=""><h1 class="page-title">DinoTime</h1></div><p class="page-sub">Chronomètre ton temps de travail — tes dinos t\'accompagnent en arrière-plan.</p></div></div>';
    var tabsHtml = '<div class="tabs">' +
      '<button class="tab-btn ' + (dtState.tab !== "pomodoro" ? "active" : "") + '" onclick="App.dtSetTab(\'chrono\')">⏱️ Chrono simple</button>' +
      '<button class="tab-btn ' + (dtState.tab === "pomodoro" ? "active" : "") + '" onclick="App.dtSetTab(\'pomodoro\')">🍅 Pomorodosaure</button>' +
      '</div>';
    var body = dtState.tab === "pomodoro" ? renderDinoTimePomodoroSetup() : renderDinoTimeChronoSetup();
    renderShell(["dinotime"], head + tabsHtml + body);
  }

  function renderDinoTimeChronoSetup() {
    var encs = dtAllEnclosures();
    var durationHtml = '<div class="dp-section"><h3 class="dp-section-title">Durée</h3><div class="dt-duration-row">' +
      DT_DURATIONS.map(function (m) {
        return '<button class="dt-duration-btn' + (dtState.durationMin === m ? " selected" : "") + '" onclick="App.dtSetDuration(' + m + ')">' + m + ' min</button>';
      }).join("") +
      '<span class="dt-duration-custom"><input type="number" min="1" max="240" id="dt-custom-min" placeholder="Autre" value="' + (DT_DURATIONS.indexOf(dtState.durationMin) === -1 ? dtState.durationMin : "") + '" onchange="App.dtSetDuration(this.value)"> min</span>' +
      '</div></div>';

    var encHtml;
    if (!encs.length) {
      encHtml = '<div class="empty-state">' + sprite("dinoBig", 5, { bob: true }) + '<h3>Aucun enclos construit</h3><p>Va dans Dino Park pour construire un enclos et y installer des dinos avant de lancer une séance.</p></div>';
    } else {
      encHtml = '<div class="dp-section"><h3 class="dp-section-title">Quel enclos veux-tu regarder ?</h3>' +
        DP_ZONES.map(function (zone) {
          var zoneEncs = encs.filter(function (e) { return e.zone === zone.id; });
          if (!zoneEncs.length) return "";
          return '<h4 class="dt-zone-title">' + zone.emoji + ' ' + esc(zone.name) + '</h4><div class="dt-enc-grid">' +
            zoneEncs.map(function (e) {
              var dinos = dtEnclosureDinos(e.id);
              var selected = dtState.enclosureId === e.id;
              var thumb = dtArtPath(e.zone, e.level);
              return '<button class="dt-enc-card' + (selected ? " selected" : "") + '" onclick="App.dtSelectEnclosure(\'' + e.id + '\')">' +
                '<div class="dt-enc-thumb-wrap" style="background:' + zone.color + '">' +
                '<img class="dt-enc-thumb" src="' + thumb + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
                '<div class="dt-enc-thumb-fallback">' + zone.emoji + '</div>' +
                '</div>' +
                '<div class="dt-enc-info"><span>' + esc(dpEnclosureDisplayName(e)) + '</span><span class="dt-enc-dinos mono">' + dinos.length + ' dino' + (dinos.length !== 1 ? "s" : "") + '</span></div>' +
                '</button>';
            }).join("") + '</div>';
        }).join("") + '</div>';
    }

    var startBtn = '<button class="btn btn-primary" style="width:auto" onclick="App.dtStart()">▶ Commencer</button>';
    return durationHtml + encHtml + startBtn;
  }

  function renderDinoTimePomodoroSetup() {
    var pomoFields = [
      { field: "pomoWork", label: "Travail (min)", value: dtState.pomoWork, max: 180 },
      { field: "pomoBreak", label: "Pause courte (min)", value: dtState.pomoBreak, max: 60 },
      { field: "pomoCycles", label: "Nombre de cycles", value: dtState.pomoCycles, max: 12 }
    ];
    var settingsHtml = '<div class="dp-section"><h3 class="dp-section-title">Réglages du cycle</h3>' +
      '<p class="dp-empty-note" style="margin-bottom:14px">Travaille sans interruption, fais une pause courte, répète.</p>' +
      '<div class="dt-pomo-fields">' +
      pomoFields.map(function (f) {
        return '<div class="dt-pomo-field-card">' +
          '<div class="dt-pomo-field-label">' + esc(f.label) + '</div>' +
          '<input type="number" class="dt-pomo-field-input" min="1" max="' + f.max + '" value="' + f.value + '" onchange="App.dtSetPomoField(\'' + f.field + '\',this.value)">' +
          '</div>';
      }).join("") +
      '</div></div>';

    var dinos = dpData().dinosaurs;
    var dinoHtml;
    if (!dinos.length) {
      dinoHtml = '<div class="dp-section"><h3 class="dp-section-title">Dino compagnon</h3><p class="dp-empty-note">.</p></div>';
    } else {
      dinoHtml = '<div class="dp-section"><h3 class="dp-section-title">Choisis ton dino compagnon</h3><div class="dt-enc-grid">' +
        dinos.map(function (d) {
          var sp = dpSpecies(d.speciesId);
          var zone = dpZone(sp.zone);
          var selected = dtState.pomoDinoId === d.id;
          return '<button class="dt-enc-card' + (selected ? " selected" : "") + '" onclick="App.dtSetPomoDino(\'' + d.id + '\')">' +
            '<div class="dt-enc-thumb-wrap" style="background:' + zone.color + '">' + dpSquareHtml(sp.id, { className: "dt-enc-thumb", kind: "profil" }) + '</div>' +
            '<div class="dt-enc-info"><span>' + esc(d.name) + '</span><span class="dt-enc-dinos mono">' + esc(sp.name) + '</span></div>' +
            '</button>';
        }).join("") + '</div></div>';
    }

    var startBtn = '<button class="btn btn-primary" style="width:auto" onclick="App.dtStartPomodoro()">▶ Commencer le Pomorodosaure</button>';
    return settingsHtml + dinoHtml + startBtn;
  }

  var DT_CYCLE = ["walk", "pause", "look", "pause"];
  function dtDurationFor(mode) {
    if (mode === "walk") return 3000 + Math.random() * 3000;
    if (mode === "look") return 2000 + Math.random() * 2000;
    return 5000 + Math.random() * 5000;
  }
  var DT_DINO_BASE_HEIGHT = 200;
  // Échelle de taille propre à DinoTime (chrono + Pomorodosaure) : plus contrastée que celle des
  // enclos pour que le Brachiosaure (le plus lourd) impose vraiment sa taille à l'écran.
  var DT_DINO_MIN_SCALE = 0.45, DT_DINO_MAX_SCALE = 2.2;
  function dtDinoSizeScale(weightKg) {
    var t = Math.log(Math.max(1, weightKg || 1)) / DP_DINO_MAX_WEIGHT_LOG;
    t = Math.max(0, Math.min(1, t));
    return DT_DINO_MIN_SCALE + t * (DT_DINO_MAX_SCALE - DT_DINO_MIN_SCALE);
  }
  var DT_POMO_DINO_BASE_HEIGHT = 56, DT_POMO_DINO_FALLBACK_W = 38, DT_POMO_DINO_FALLBACK_H = 33;
  function dtInitDinoState(d) {
    var cycleIdx = Math.floor(Math.random() * DT_CYCLE.length);
    var sp = dpSpecies(d.speciesId);
    return {
      speciesId: d.speciesId,
      hasArt: !!DP_ART[d.speciesId],
      heightPx: Math.round(DT_DINO_BASE_HEIGHT * dtDinoSizeScale(sp ? sp.weightKg : null)),
      x: DT_MIN_X + Math.random() * (DT_MAX_X - DT_MIN_X),
      dir: Math.random() < 0.5 ? -1 : 1,
      cycleIdx: cycleIdx,
      mode: DT_CYCLE[cycleIdx],
      lastMode: null,
      modeUntil: performance.now() + dtDurationFor(DT_CYCLE[cycleIdx]),
      speed: 0.0035 + Math.random() * 0.0025,
      lastTs: null
    };
  }
  function dtDinoVisualHtml(ds, i) {
    if (ds.hasArt) return '<img class="dt-dino" id="dt-dino-' + i + '" src="' + dpArtPath(ds.speciesId, "profil") + '" alt="">';
    return '<div class="dt-dino dt-dino-fallback" id="dt-dino-' + i + '" style="background:' + dpHashColor(ds.speciesId) + ';height:' + ds.heightPx + 'px"></div>';
  }

  function renderDinoTimeRunning() {
    var enc = dpData().enclosures.find(function (e) { return e.id === dtRunning.enclosureId; });
    if (!enc) { App.dtStop(); return; }
    var zone = dpZone(enc.zone);
    var bg = dtArtPath(enc.zone, enc.level);
    var dinosHtml = dtRunning.dinos.map(function (ds, i) {
      return '<span class="dt-dino-wrap" id="dt-dino-wrap-' + i + '" style="left:' + ds.x + '%;height:' + ds.heightPx + 'px">' + dtDinoVisualHtml(ds, i) + '</span>';
    }).join("");
    var html = '<div class="dt-scene" style="background-color:' + zone.color + '">' +
      '<img class="dt-scene-bg" src="' + bg + '" alt="" onerror="this.style.display=\'none\'">' +
      '<button class="dt-stop" onclick="App.dtStop()">✕</button>' +
      '<button class="dt-pause" id="dt-pause-btn" onclick="App.dtTogglePause()">⏸</button>' +
      '<div class="dt-timer mono" id="dt-timer-display">' + dpFormatCountdown(dtRunning.remainingSec * 1000) + '</div>' +
      dinosHtml +
      '</div>';
    document.getElementById("app").innerHTML = html;
    dtEnsureTimerInterval();
    dtStartWalkLoop();
  }

  var DT_POMO_PHASE_LABEL = { work: "Travail", break: "☕ Pause courte" };
  // Position (0 à 1) du dino sur la ligne : avance pendant le travail, s'arrête pile au checkpoint
  // pendant la pause, reprend là où il en était au cycle suivant, repart de 0 après le dernier cycle.
  function dtPomoProgress(p) {
    var segStart = (p.cycleIndex - 1) / p.cycles;
    var segEnd = p.cycleIndex / p.cycles;
    if (p.phase === "break") return segEnd;
    var workTotal = p.workMin * 60;
    var elapsedFrac = workTotal > 0 ? Math.min(1, Math.max(0, 1 - p.remainingSec / workTotal)) : 0;
    return segStart + elapsedFrac * (segEnd - segStart);
  }
  function renderPomodoroRunning() {
    var p = dtPomoRunning;
    var dino = p.dinoId ? dpData().dinosaurs.find(function (d) { return d.id === p.dinoId; }) : null;
    var sp = dino ? dpSpecies(dino.speciesId) : null;
    var looking = p.phase !== "work";
    var artPath = sp ? dpArtPath(sp.id, looking ? "face" : "profil") : null;
    var pomoScale = dtDinoSizeScale(sp ? sp.weightKg : null);
    var dinoHtml;
    if (artPath) {
      dinoHtml = '<img class="dt-pomo-dino' + (looking ? " sprite-bob" : "") + '" src="' + artPath + '" alt="" style="height:' + Math.round(DT_POMO_DINO_BASE_HEIGHT * pomoScale) + 'px" onerror="this.style.display=\'none\'">';
    } else if (sp) {
      dinoHtml = '<div class="dt-pomo-dino-fallback' + (looking ? " sprite-bob" : "") + '" style="background:' + dpHashColor(sp.id) + ';height:' + Math.round(DT_POMO_DINO_FALLBACK_H * pomoScale) + 'px;width:' + Math.round(DT_POMO_DINO_FALLBACK_W * pomoScale) + 'px"></div>';
    } else {
      dinoHtml = '<div class="dt-pomo-dino-placeholder">.</div>';
    }
    // Les sprites "profil" regardent nativement vers la gauche, on les retourne pour qu'ils avancent
    // visuellement vers la droite (sens de la piste) ; on les remet à l'endroit pour le "face" au checkpoint.
    dinoHtml = '<span class="dt-pomo-flip' + (looking ? "" : " reversed") + '">' + dinoHtml + '</span>';
    var checkpoints = "";
    for (var i = 0; i <= p.cycles; i++) checkpoints += '<span class="dt-pomo-checkpoint" style="left:' + (i / p.cycles * 100) + '%"></span>';
    var cycleHtml = '<div class="dt-pomo-cycle mono">Cycle ' + p.cycleIndex + ' / ' + p.cycles + '</div>';
    var html = '<div class="dt-scene dt-pomo-scene">' +
      '<button class="dt-stop" onclick="App.dtStopPomodoro()">✕</button>' +
      '<button class="dt-pause" id="dt-pause-btn" onclick="App.dtTogglePausePomo()">⏸</button>' +
      '<div class="dt-pomo-phase">' + DT_POMO_PHASE_LABEL[p.phase] + '</div>' +
      '<div class="dt-timer mono" id="dt-timer-display">' + dpFormatCountdown(p.remainingSec * 1000) + '</div>' +
      cycleHtml +
      '<div class="dt-pomo-track">' +
      '<div class="dt-pomo-track-line"></div>' +
      checkpoints +
      '<div class="dt-pomo-runner' + (p.phase === "work" ? " working" : "") + '" id="dt-pomo-runner" style="left:' + (dtPomoProgress(p) * 100) + '%">' + dinoHtml + '</div>' +
      '</div>' +
      '</div>';
    document.getElementById("app").innerHTML = html;
    dtEnsureTimerInterval();
  }

  // Le décompte tourne en continu (indépendant de la page affichée) tant qu'une séance existe —
  // seuls dtStop/dtComplete/dtStopPomodoro l'arrêtent. Basé sur une échéance absolue (endsAt) plutôt
  // qu'un simple compteur, pour rester exact même si le tick est retardé (onglet en arrière-plan).
  function dtStopTimerInterval() {
    if (dtTimerInterval) { clearInterval(dtTimerInterval); dtTimerInterval = null; }
  }
  function dtEnsureTimerInterval() {
    if (dtTimerInterval) return;
    dtTimerInterval = setInterval(function () {
      if (dtRunning && !dtRunning.paused) {
        dtRunning.remainingSec = Math.max(0, Math.round((dtRunning.endsAt - Date.now()) / 1000));
        var el = document.getElementById("dt-timer-display");
        if (el) el.textContent = dpFormatCountdown(dtRunning.remainingSec * 1000);
        if (dtRunning.remainingSec <= 0) { App.dtComplete(); }
      }
      if (dtPomoRunning && !dtPomoRunning.paused) {
        dtPomoRunning.remainingSec = Math.max(0, Math.round((dtPomoRunning.endsAt - Date.now()) / 1000));
        var pel = document.getElementById("dt-timer-display");
        if (pel) pel.textContent = dpFormatCountdown(dtPomoRunning.remainingSec * 1000);
        var runnerEl = document.getElementById("dt-pomo-runner");
        if (runnerEl) runnerEl.style.left = (dtPomoProgress(dtPomoRunning) * 100) + "%";
        if (dtPomoRunning.remainingSec <= 0) { App.dtPomoPhaseComplete(); }
      }
    }, 1000);
  }
  // L'animation de balade des dinos, elle, s'arrête d'elle-même dès que la scène n'est plus affichée
  // (pas besoin de la faire tourner pour rien sur une autre page) et repart quand on revient dessus.
  function dtStopWalkLoop() {
    if (dtWalkRaf) { cancelAnimationFrame(dtWalkRaf); dtWalkRaf = null; }
  }
  function dtStartWalkLoop() {
    dtStopWalkLoop();
    dtWalkRaf = requestAnimationFrame(dtTickWalk);
  }

  function dtTickWalk(ts) {
    if (!dtRunning || !document.querySelector(".dt-scene")) { dtWalkRaf = null; return; }
    if (!dtRunning.paused) {
      dtRunning.dinos.forEach(function (ds, i) {
        var wrap = document.getElementById("dt-dino-wrap-" + i);
        var img = document.getElementById("dt-dino-" + i);
        if (!wrap || !img) return;
        if (ts > ds.modeUntil) {
          ds.cycleIdx = (ds.cycleIdx + 1) % DT_CYCLE.length;
          ds.mode = DT_CYCLE[ds.cycleIdx];
          ds.modeUntil = ts + dtDurationFor(ds.mode);
          if (ds.mode === "walk" && Math.random() < 0.5) ds.dir *= -1;
        }
        var dt = ds.lastTs ? (ts - ds.lastTs) : 16;
        if (ds.mode === "walk") {
          ds.x += ds.dir * ds.speed * dt;
          if (ds.x < DT_MIN_X) { ds.x = DT_MIN_X; ds.dir = 1; }
          if (ds.x > DT_MAX_X) { ds.x = DT_MAX_X; ds.dir = -1; }
          wrap.style.left = ds.x + "%";
        }
        wrap.style.transform = "translateX(-50%) " + (ds.mode === "look" ? "scaleX(1)" : (ds.dir > 0 ? "scaleX(-1)" : "scaleX(1)"));
        if (ds.mode !== ds.lastMode) {
          img.classList.toggle("dt-dino-walking", ds.mode === "walk");
          if (ds.hasArt) img.src = dpArtPath(ds.speciesId, ds.mode === "look" ? "face" : "profil");
          ds.lastMode = ds.mode;
        }
        ds.lastTs = ts;
      });
    }
    dtWalkRaf = requestAnimationFrame(dtTickWalk);
  }

  /* ---------------- Auth screens ---------------- */
  var authError = "";
  function renderAuth(mode) {
    var isLogin = mode !== "signup";
    var html = '<div class="auth-screen">' +
      sprite("fern", 7, { className: "fern-corner", style: "left:4%;bottom:6%;transform:scaleX(-1);" }) +
      sprite("fern", 9, { className: "fern-corner", style: "right:6%;bottom:10%;" }) +
      sprite("fern", 5, { className: "fern-corner", style: "left:10%;top:12%;" }) +
      sprite("fern", 6, { className: "fern-corner", style: "right:14%;top:16%;transform:scaleX(-1);" }) +
      '<div class="auth-card">' +
      sprite("dinoBig", 6, { className: "auth-mascot sprite-bob" }) +
      '<div class="wordmark">Studino<span class="dot">.</span></div>' +
      '<p class="auth-sub">' + (isLogin ? "Connecte-toi pour retrouver tes cours." : "Crée ton espace personnel de révision.") + '</p>' +
      (authError ? '<div class="error-msg">' + authError + '</div>' : '') +
      '<form onsubmit="App.submitAuth(event, \'' + (isLogin ? "login" : "signup") + '\')">' +
      '<div class="field"><label>Nom d\'utilisateur</label><input name="username" autocomplete="username" required></div>' +
      '<div class="field"><label>Mot de passe</label><input name="password" type="password" autocomplete="' + (isLogin ? "current-password" : "new-password") + '" required minlength="4"></div>' +
      '<button class="btn btn-primary" type="submit">' + (isLogin ? "Se connecter" : "Créer mon compte") + '</button>' +
      '</form>' +
      '<div class="auth-switch">' + (isLogin ? "Pas encore de compte ? " : "Déjà inscrit ? ") +
      '<button onclick="App.switchAuth(\'' + (isLogin ? "signup" : "login") + '\')">' + (isLogin ? "Créer un compte" : "Se connecter") + '</button></div>' +
      '<div class="auth-switch" style="margin-top:6px">' +
      '<button onclick="document.getElementById(\'import-backup-input-auth\').click()">📥 Importer une sauvegarde</button>' +
      '<input type="file" id="import-backup-input-auth" accept="application/json" style="display:none" onchange="App.importBackupFile(event)">' +
      '</div>' +
      '</div></div>';
    document.getElementById("app").innerHTML = html;
    // Contrairement à renderShell (qui affiche systématiquement la modale via son propre appel),
    // cet écran de connexion ne passe pas par renderShell — sans cette ligne, importer une sauvegarde
    // AVANT d'avoir de compte (le cas d'usage exact de ce bouton) n'ouvrirait jamais sa confirmation.
    if (modal) renderModal();
  }

