(function () {
  "use strict";
  var APP_VERSION = "6.4"; // +0.1 à chaque push sur GitHub, pour que l'utilisateur puisse vérifier qu'il a bien la dernière version
  var DB_KEY = "recto_v1"; // ancien stockage localStorage — gardé uniquement pour la migration one-shot vers IndexedDB
  var IDB_NAME = "studino_db", IDB_STORE = "kv", IDB_ENTRY = "db";

  /* ---------------- Storage : IndexedDB (bien plus de place que les ~5-10 Mo de localStorage),
     avec repli automatique sur localStorage si IndexedDB est indisponible ---------------- */
  var idbInstance = null;
  function idbOpen() {
    if (idbInstance) return Promise.resolve(idbInstance);
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error("IndexedDB indisponible")); return; }
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = function () { idbInstance = req.result; resolve(idbInstance); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readonly");
        var req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }
  function idbSet(key, value) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  var DB = { users: {}, currentUser: null, data: {} };
  var dbUsesLocalStorageFallback = false;
  function saveDB() {
    // Horodatage de la dernière modification, par compte — c'est ce qui permet à l'import "Fusionner"
    // (cf. plus bas) de savoir, entre deux appareils, lequel des deux a le plus avancé récemment,
    // sans avoir à suivre précisément quel enregistrement individuel a changé.
    if (DB.currentUser && DB.data[DB.currentUser]) DB.data[DB.currentUser].updatedAt = Date.now();
    if (dbUsesLocalStorageFallback) {
      try {
        localStorage.setItem(DB_KEY, JSON.stringify(DB));
      } catch (err) {
        console.error("Échec de la sauvegarde :", err);
        toast("⚠️ Sauvegarde impossible (stockage plein ?). Essaie avec un PDF/des photos plus légers, ou supprime d'anciens cours pour libérer de la place.");
      }
      return;
    }
    idbSet(IDB_ENTRY, DB).catch(function (err) {
      console.error("Échec de la sauvegarde :", err);
      toast("⚠️ Sauvegarde impossible. " + (err && err.message ? err.message : "Réessaie."));
    });
  }
  function initDB() {
    return idbGet(IDB_ENTRY).then(function (stored) {
      if (stored) { DB = stored; return; }
      // Premier lancement avec IndexedDB : on récupère les données de l'ancien localStorage si
      // elles existent, on les sauvegarde dans IndexedDB, puis on libère l'ancien stockage.
      var raw = null;
      try { raw = localStorage.getItem(DB_KEY); } catch (e) {}
      if (raw) { try { DB = JSON.parse(raw); } catch (e) {} }
      return idbSet(IDB_ENTRY, DB).then(function () {
        try { localStorage.removeItem(DB_KEY); } catch (e) {}
      });
    }).catch(function (err) {
      // IndexedDB indisponible (navigateur trop ancien, mode privé très restrictif...) : on retombe
      // sur l'ancien système localStorage plutôt que de bloquer complètement l'application.
      console.error("IndexedDB indisponible, repli sur localStorage :", err);
      dbUsesLocalStorageFallback = true;
      try {
        var raw2 = localStorage.getItem(DB_KEY);
        if (raw2) DB = JSON.parse(raw2);
      } catch (e) {}
    });
  }

  var storageEstimateCache = null;
  function refreshStorageEstimate() {
    if (!(navigator.storage && navigator.storage.estimate)) return;
    navigator.storage.estimate().then(function (est) {
      storageEstimateCache = { usedBytes: est.usage || 0, quotaBytes: est.quota || 0 };
      if (modal && modal.type === "settings") renderModal();
    }).catch(function () {});
  }
  function storageUsageInfo() {
    if (storageEstimateCache && storageEstimateCache.quotaBytes) {
      var used = storageEstimateCache.usedBytes, quota = storageEstimateCache.quotaBytes;
      return { usedBytes: used, quotaBytes: quota, pct: Math.min(100, Math.round((used / quota) * 100)), estimating: false };
    }
    var fallbackUsed = 0;
    try { fallbackUsed = new Blob([JSON.stringify(DB)]).size; } catch (e) {}
    return { usedBytes: fallbackUsed, quotaBytes: 0, pct: 0, estimating: true };
  }
  function formatBytes(n) {
    if (n < 1024) return n + " o";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " Ko";
    return (n / (1024 * 1024)).toFixed(1) + " Mo";
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  async function sha256(text) {
    var enc = new TextEncoder().encode(text);
    var buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }

  function userData() {
    var u = DB.currentUser;
    if (!DB.data[u]) DB.data[u] = { subjects: [] };
    if (!DB.data[u].importedExercises) DB.data[u].importedExercises = [];
    if (!DB.data[u].revisionSheets) DB.data[u].revisionSheets = [];
    if (!DB.data[u].examPreps) DB.data[u].examPreps = [];
    if (!DB.data[u].methodologies) DB.data[u].methodologies = [];
    if (!DB.data[u].podcasts) DB.data[u].podcasts = [];
    // Migration : ancienne hiérarchie matière -> chapitres directement, sans thème.
    // On enveloppe les chapitres existants dans un thème "Général" créé une seule fois.
    DB.data[u].subjects.forEach(function (s) {
      if (!s.themes) { s.themes = [{ id: uid(), name: "Général", chapters: s.chapters || [] }]; delete s.chapters; }
    });
    // Migration : un exercice importé contenait un seul énoncé/solution, désormais un tableau "exercises".
    DB.data[u].importedExercises.forEach(function (en) {
      if (!en.exercises) {
        en.exercises = en.status === "ready" ? [{
          statement: en.statement || "", solution: en.solution || "",
          answerHtml: en.answerHtml || "", answerText: en.answerText || "",
          answerStatus: en.answerStatus || "unanswered", correct: en.correct != null ? en.correct : null, feedback: en.feedback || ""
        }] : [];
        delete en.statement; delete en.solution; delete en.answerHtml; delete en.answerText; delete en.answerStatus; delete en.correct; delete en.feedback;
      }
    });
    // Migration (une seule fois par cours/exercice) : avant l'extraction des schémas en entrées
    // séparées et supprimables, une image de figure nécessaire était collée directement en base64
    // dans le Markdown — ça gonflait le stockage sans qu'aucun bouton ne puisse la retirer. On la
    // retire simplement ici (le texte reste lisible, seule l'image intégrée disparaît).
    // Cette même passe unique en profite aussi pour vider les photos/PDF source des cours déjà
    // prêts générés avant l'auto-nettoyage : celui-ci ne s'exécutait qu'à la fin d'une (re)génération,
    // donc un cours jamais régénéré depuis gardait sa miniature/ses images d'origine indéfiniment.
    DB.data[u].subjects.forEach(function (s) {
      s.themes.forEach(function (t) { t.chapters.forEach(function (c) { c.courses.forEach(function (co) {
        if (!co.figuresMigrated) {
          co.transcription = stripOldInlineFigures(co.transcription);
          co.explanation = stripOldInlineFigures(co.explanation);
          if (co.status === "ready") co.images = [];
          co.figuresMigrated = true;
        }
      }); }); });
    });
    DB.data[u].importedExercises.forEach(function (en) {
      if (!en.figuresMigrated) {
        (en.exercises || []).forEach(function (ex) { ex.statement = stripOldInlineFigures(ex.statement); });
        if (en.status === "ready") en.images = [];
        en.figuresMigrated = true;
      }
    });
    return DB.data[u];
  }

  /* ---------------- Toasts ---------------- */
  var toastErrorDetails = {};
  function toast(msg, errDetail) {
    var stack = document.getElementById("toastStack");
    var el = document.createElement("div");
    el.className = "toast";
    if (errDetail && (errDetail.status || errDetail.detail)) {
      var tid = uid();
      toastErrorDetails[tid] = errDetail;
      var span = document.createElement("span");
      span.textContent = msg;
      el.appendChild(span);
      var btn = document.createElement("span");
      btn.className = "toast-detail-btn";
      btn.textContent = "Détails";
      btn.onclick = function () { window.App.showErrorDetailRaw(tid); };
      el.appendChild(btn);
      stack.appendChild(el);
      setTimeout(function () { el.remove(); delete toastErrorDetails[tid]; }, 8000);
    } else {
      el.textContent = msg;
      stack.appendChild(el);
      setTimeout(function () { el.remove(); }, 2600);
    }
  }

  /* ---------------- Image import (JPEG/PNG/WebP/TIFF/HEIC) ---------------- */
  var IMG_MAX_W = 700;
  function isHeicFile(file) {
    return /heic|heif/i.test(file.type || "") || /\.hei[cf]$/i.test(file.name || "");
  }
  function isTiffFile(file) {
    return /tiff/i.test(file.type || "") || /\.tiff?$/i.test(file.name || "");
  }
  function isPdfFile(file) {
    return /pdf/i.test(file.type || "") || /\.pdf$/i.test(file.name || "");
  }
  function isPdfDataUrl(src) { return /^data:application\/pdf/i.test(src || ""); }
  function fileThumbHtml(src, i) {
    var preview = isPdfDataUrl(src)
      ? '<div class="file-thumb-pdf">📄<span>PDF</span></div>'
      : '<img src="' + src + '">';
    return '<div class="file-thumb">' + preview + '<button type="button" class="file-thumb-remove" onclick="App.removeCourseImage(' + i + ')">×</button></div>';
  }
  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (ev) { resolve(ev.target.result); };
      reader.onerror = function () { reject(new Error("Lecture du fichier impossible.")); };
      reader.readAsDataURL(file);
    });
  }
  function loadImageEl(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("Format d'image non supporté par le navigateur.")); };
      img.src = url;
    });
  }
  function drawSourceToJpegDataUrl(source, w, h) {
    var scale = Math.min(1, IMG_MAX_W / w);
    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  }
  function cropImageRegion(dataUrl, box) {
    // box: [ymin, xmin, ymax, xmax] normalisé sur 0-1000 (convention utilisée par Gemini pour les zones détectées)
    return loadImageEl(dataUrl).then(function (img) {
      var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      var clamp = function (v) { return Math.max(0, Math.min(1000, v)); };
      var xmin = clamp(box[1]) / 1000 * w, ymin = clamp(box[0]) / 1000 * h;
      var xmax = clamp(box[3]) / 1000 * w, ymax = clamp(box[2]) / 1000 * h;
      var cw = Math.max(1, Math.round(xmax - xmin)), ch = Math.max(1, Math.round(ymax - ymin));
      var canvas = document.createElement("canvas");
      canvas.width = cw; canvas.height = ch;
      canvas.getContext("2d").drawImage(img, xmin, ymin, cw, ch, 0, 0, cw, ch);
      return canvas.toDataURL("image/jpeg", 0.88);
    });
  }
  var FIGURE_REFINE_SCHEMA = {
    type: "object",
    properties: {
      boxes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer", description: "Index du schéma dans la liste fournie (à partir de 0)." },
            found: { type: "boolean", description: "false si ce schéma n'est en réalité PAS présent sur cette image (erreur de la détection précédente) — dans ce cas ignore \"box\"." },
            box: { type: "array", items: { type: "integer" }, description: "Zone rectangulaire CORRIGÉE [ymin, xmin, ymax, xmax] sur une échelle de 0 à 1000 (0,0 = coin haut-gauche de CETTE image, 1000,1000 = coin bas-droit), qui encadre EXACTEMENT ce schéma, sans texte alentour ni morceau d'un autre schéma/tableau voisin. Si found=false, renvoie [0,0,0,0]." }
          },
          required: ["index", "found", "box"]
        }
      }
    },
    required: ["boxes"]
  };
  function buildFigureRefinePrompt(figsOnThisImage) {
    var list = figsOnThisImage.map(function (f, i) { return i + ". " + (f.caption || "(sans légende)"); }).join("\n");
    return "Voici UNE SEULE image (une page/photo de cours). Une première passe moins précise pense qu'elle contient les schémas/graphiques suivants :\n" + list + "\n\n" +
      "Pour CHAQUE schéma de cette liste, regarde attentivement CETTE image précise et donne la zone rectangulaire qui l'encadre le plus exactement possible, au format [ymin, xmin, ymax, xmax] sur une échelle 0-1000, en excluant tout texte alentour et tout élément d'un AUTRE schéma ou tableau voisin — ne prends surtout pas un morceau de texte ou une zone vide par erreur. Si un schéma de la liste n'est en fait PAS présent sur cette image précise (erreur de la passe précédente), mets \"found\": false pour lui plutôt que d'inventer une zone approximative.\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni.";
  }
  // Seconde passe dédiée, UNE image à la fois : la détection initiale des schémas se fait en même
  // temps que toute la retranscription/le quiz/les exercices sur PLUSIEURS photos à la fois, ce qui
  // laisse peu d'attention pour des coordonnées de zone précises — en pratique ça donne parfois des
  // découpages n'importe où (un bout de texte, un autre schéma, une zone vide). Montrer à l'IA UNE
  // seule image avec juste la liste des schémas à y retrouver améliore nettement la précision, sans
  // bloquer la génération si cet appel échoue (on garde alors la zone d'origine).
  function refineImageFigureBoxes(src, figsOnThisImage) {
    var parts = geminiImageParts([src]).concat([{ text: buildFigureRefinePrompt(figsOnThisImage) }]);
    return callGemini(parts, FIGURE_REFINE_SCHEMA).catch(function () { return null; });
  }
  function resolveFigures(figures, images) {
    // Chaque figure détectée est croquée depuis la photo source puis stockée à part (course.figures /
    // entry.figures), référencée dans le texte par un simple jeton "figure:ID" plutôt que par son
    // image encodée en base64 directement dans le Markdown — ça permet à l'utilisateur de supprimer
    // une image plus tard (bouton "Supprimer" dédié) sans devoir toucher au texte du cours/exercice :
    // la référence reste, elle affiche juste "schéma supprimé" une fois l'entrée retirée de la liste.
    var list = figures || [];
    var byImage = {};
    list.forEach(function (fig, i) { (byImage[fig.imageIndex] = byImage[fig.imageIndex] || []).push(i); });
    var refinePerImage = Object.keys(byImage).map(function (idxStr) {
      var idx = +idxStr;
      var src = images[idx];
      if (!src || isPdfDataUrl(src)) return Promise.resolve();
      var idxList = byImage[idx];
      return refineImageFigureBoxes(src, idxList.map(function (i) { return list[i]; })).then(function (data) {
        if (!data || !data.boxes) return;
        data.boxes.forEach(function (b) {
          var fig = list[idxList[b.index]];
          if (!fig) return;
          if (!b.found) { fig.box = null; }
          else if (Array.isArray(b.box) && b.box.length === 4) { fig.box = b.box; }
        });
      });
    });
    return Promise.all(refinePerImage).then(function () {
      return Promise.all(list.map(function (fig) {
        var src = images[fig.imageIndex];
        if (!src || isPdfDataUrl(src) || !Array.isArray(fig.box) || fig.box.length !== 4) return Promise.resolve(null);
        return cropImageRegion(src, fig.box).catch(function () { return null; });
      }));
    }).then(function (crops) {
      var subs = [], stored = [];
      list.forEach(function (fig, i) {
        var cropUrl = crops[i];
        var caption = String(fig.caption || "").replace(/[[\]]/g, "");
        if (cropUrl) {
          var fid = uid();
          stored.push({ id: fid, image: cropUrl, caption: caption });
          subs.push({ placeholder: fig.placeholder || "", replacement: "![" + caption + "](figure:" + fid + ")" });
        } else {
          subs.push({ placeholder: fig.placeholder || "", replacement: "" });
        }
      });
      return { subs: subs, figures: stored };
    });
  }
  function substituteFigures(text, subs) {
    var out = text || "";
    (subs || []).forEach(function (s) { if (s.placeholder) out = out.split(s.placeholder).join(s.replacement); });
    return out;
  }
  function stripFigureMarkdown(text) {
    return String(text || "").replace(/!\[[^\]]*\]\((?:data:[^)]+|figure:[^)]+|schema:[^)]+)\)/g, "");
  }
  function stripOldInlineFigures(text) {
    // Migration one-shot uniquement : ne retire QUE l'ancien format (image encodée en base64
    // directement dans le texte), jamais les références "figure:ID" du nouveau système déjà
    // gérables individuellement — celles-là n'ont pas besoin d'être migrées.
    return String(text || "").replace(/!\[[^\]]*\]\(data:[^)]+\)/g, "");
  }
  function decodeTiffFile(file) {
    if (typeof UTIF === "undefined") return Promise.reject(new Error("Le support TIFF n'a pas pu se charger."));
    return file.arrayBuffer().then(function (buf) {
      var ifds = UTIF.decode(buf);
      if (!ifds.length) throw new Error("Fichier TIFF illisible.");
      UTIF.decodeImage(buf, ifds[0]);
      var rgba = UTIF.toRGBA8(ifds[0]);
      var w = ifds[0].width, h = ifds[0].height;
      var canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext("2d");
      var imageData = ctx.createImageData(w, h);
      imageData.data.set(rgba);
      ctx.putImageData(imageData, 0, 0);
      return drawSourceToJpegDataUrl(canvas, w, h);
    });
  }
  function decodeHeicFile(file) {
    if (typeof heic2any === "undefined") return Promise.reject(new Error("Le support HEIC n'a pas pu se charger."));
    return heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 }).then(function (out) {
      var blob = Array.isArray(out) ? out[0] : out;
      return readFileAsDataUrl(blob);
    }).then(loadImageEl).then(function (img) {
      return drawSourceToJpegDataUrl(img, img.width, img.height);
    });
  }
  function processImageFile(file) {
    if (isPdfFile(file)) return readFileAsDataUrl(file);
    if (isHeicFile(file)) return decodeHeicFile(file);
    if (isTiffFile(file)) return decodeTiffFile(file);
    return readFileAsDataUrl(file).then(loadImageEl).then(function (img) {
      return drawSourceToJpegDataUrl(img, img.width, img.height);
    });
  }

  /* ---------------- Gemini AI generation ---------------- */
  var API_KEY_STORAGE = "studino_gemini_key";
  var BACKUP_API_KEY_STORAGE = "studino_gemini_key_backup";
  var GEMINI_MODELS = ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];

  function getApiKey() { return localStorage.getItem(API_KEY_STORAGE) || ""; }
  function setApiKey(k) { if (k) localStorage.setItem(API_KEY_STORAGE, k); else localStorage.removeItem(API_KEY_STORAGE); }
  // Clé optionnelle d'un second compte Google : si TOUS les modèles de la clé principale sont à quota
  // (429 partout), on bascule dessus avant d'abandonner — un quota Gemini gratuit est par compte, donc
  // une deuxième clé d'un autre compte a un quota totalement indépendant.
  function getBackupApiKey() { return localStorage.getItem(BACKUP_API_KEY_STORAGE) || ""; }
  function setBackupApiKey(k) { if (k) localStorage.setItem(BACKUP_API_KEY_STORAGE, k); else localStorage.removeItem(BACKUP_API_KEY_STORAGE); }
  var apiKeyGuideShown = false; // une seule ouverture auto par chargement de page, cf. render()

  var VOLUME_MUSIC_STORAGE = "studino_volume_music";
  var VOLUME_SFX_STORAGE = "studino_volume_sfx";
  function getVolumeMusic() { var v = localStorage.getItem(VOLUME_MUSIC_STORAGE); return v === null ? 70 : parseInt(v, 10); }
  function getVolumeSfx() { var v = localStorage.getItem(VOLUME_SFX_STORAGE); return v === null ? 70 : parseInt(v, 10); }

  var PRINT_SCALE_STORAGE = "studino_print_scale";
  function getPrintScale() { var v = localStorage.getItem(PRINT_SCALE_STORAGE); return v === null ? 1 : parseFloat(v); }
  function setPrintScale(v) { v = Math.max(0.6, Math.min(3, v)); localStorage.setItem(PRINT_SCALE_STORAGE, v.toFixed(2)); }

  // Genre de l'élève (facultatif) : utilisé uniquement pour que le conteur du Podcast s'adresse à lui
  // naturellement ("mon petit"/"ma petite") plutôt que de rester neutre par défaut faute d'info.
  var USER_GENDER_STORAGE = "studino_user_gender";
  function getUserGender() { return localStorage.getItem(USER_GENDER_STORAGE) || ""; }
  function setUserGender(g) { if (["m", "f", "autre"].indexOf(g) !== -1) localStorage.setItem(USER_GENDER_STORAGE, g); else localStorage.removeItem(USER_GENDER_STORAGE); }

  // Rappel de révision : limite honnête, Studino est un site statique sans serveur de notifications
  // push — ça ne peut donc prévenir que si l'onglet est rouvert/déjà ouvert (un simple check au
  // démarrage), jamais en vrai arrière-plan comme une appli mobile. Mieux que rien, pas une vraie alarme.
  var REMINDER_STORAGE = "studino_reminder_enabled";
  var REMINDER_LAST_NOTIF_STORAGE = "studino_reminder_last_notif";
  function getReminderEnabled() { return localStorage.getItem(REMINDER_STORAGE) === "1"; }
  function setReminderEnabled(v) { localStorage.setItem(REMINDER_STORAGE, v ? "1" : "0"); }
  function checkRevisionReminder() {
    if (!getReminderEnabled() || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    var today = epTodayStr();
    if (localStorage.getItem(REMINDER_LAST_NOTIF_STORAGE) === today) return;
    var pending = epData().some(function (p) {
      return p.planStatus === "ready" && epDaysBetween(today, p.examDate) >= 0 && (!p.sessions || !p.sessions[today] || p.sessions[today].status !== "done");
    });
    if (!pending) return;
    localStorage.setItem(REMINDER_LAST_NOTIF_STORAGE, today);
    try { new Notification("Studino", { body: "Ta session de révision du jour t'attend sur Mission Contrôle 🦖" }); } catch (e) {}
  }

  // Un exercice/question qui renvoie à un support visuel (figure géométrique, graphique, spectre,
  // schéma, carte...) sans jamais le montrer est inutilisable pour l'élève : contrairement à un
  // exercice importé par photo (où l'image existe déjà), rien ne garantit qu'un tel visuel existe
  // ailleurs. L'IA doit donc le dessiner elle-même en SVG plutôt que se contenter d'en parler.
  var FIGURE_SVG_FIELD_DESC = "SVG autonome et complet (une seule balise <svg viewBox=\"0 0 W H\">...</svg>, sans dépendance externe) REPRÉSENTANT RÉELLEMENT un support visuel qui sert de DONNÉE externe au problème (ce que l'élève lirait sur un document fourni en vrai examen), JAMAIS un support qui donnerait la réponse ou la connaissance que la question est censée vérifier. Règle absolue, à appliquer AVANT toute autre considération : si la question teste une connaissance à apprendre par cœur d'après le cours (une date, un événement, une formule, une définition, un résultat, un nom, une valeur numérique à retenir), figureSvg doit rester une chaîne VIDE, même si un support visuel existerait dans l'absolu — fournir ce support reviendrait à donner la réponse à la place de l'élève (ex. jamais de frise chronologique pour une question de date d'histoire, jamais la formule elle-même en image pour une question qui demande de connaître/appliquer une formule de cours, jamais une image qui contient le mot/la définition/le résultat attendu). En dehors de ce cas, fournis un SVG uniquement quand la question donne des valeurs numériques dont l'élève ne peut PAS trouver la correspondance par le calcul ou le raisonnement, mais seulement en lisant un repère externe non mémorisable au mot près (ex. : le spectre de la lumière visible avec ses bandes de couleur et longueurs d'onde en nm quand la question donne une longueur d'onde et demande une couleur EN PARTICULIER, un graphique/une courbe donnés comme données du problème à lire, une figure géométrique dont les mesures/angles sont les données de l'énoncé, une carte ou un schéma de circuit donnés comme support). ATTENTION, piège fréquent : la seule présence d'une valeur en nanomètres (nm) ne justifie PAS à elle seule le spectre visible — une taille de virus/bactérie/cellule, une conversion d'unités, ou tout autre exercice qui ne demande explicitement AUCUNE couleur ne doit JAMAIS afficher ce spectre, même si les valeurs tombent dans la plage 400-700 nm. Chaîne vide dans tous les autres cas (la grande majorité). Le SVG doit être lisible seul (inclure un rectangle de fond blanc plein cadre, des traits/textes en noir ou en couleurs vives et contrastées, des légendes/graduations/valeurs numériques précises), car il s'affiche tel quel, dans n'importe quel thème clair ou sombre. Qualité de dessin exigée, sans exception : calcule d'abord un vrai quadrillage/grille de positions pour TOUS les éléments (boîtes, flèches, textes) avant de les placer, de sorte qu'AUCUN texte ne chevauche une forme, une flèche ou un autre texte, et qu'AUCUNE flèche ne traverse une boîte ou une étiquette — prévois une marge généreuse autour de chaque élément et un viewBox assez grand pour tout faire tenir proprement ; chaque flèche doit partir et arriver exactement au bord de l'élément qu'elle relie (jamais en l'air, jamais à travers) ; une étiquette se place toujours à côté de ce qu'elle désigne, jamais superposée dessus.";
  var COURSE_SCHEMA = {
    type: "object",
    properties: {
      transcription: { type: "string", description: "Retranscription Markdown structurée du cours." },
      explanation: { type: "string", description: "Explication pédagogique approfondie du cours, structurée en Markdown (## et ###), notion par notion." },
      flashcards: {
        type: "array",
        items: {
          type: "object",
          properties: { q: { type: "string" }, a: { type: "string" } },
          required: ["q", "a"]
        }
      },
      quizQuestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", description: "\"qcm\" ou \"ouverte\"" },
            category: { type: "string", description: "\"definition\", \"formule\" ou \"application\"" },
            prompt: { type: "string" },
            choices: { type: "array", items: { type: "string" } },
            correctIndex: { type: "integer" },
            answer: { type: "string" },
            explanation: { type: "string" },
            figureSvg: { type: "string", description: FIGURE_SVG_FIELD_DESC }
          },
          required: ["type", "category", "prompt", "choices", "correctIndex", "answer", "explanation", "figureSvg"]
        }
      },
      exercises: {
        type: "array",
        items: {
          type: "object",
          properties: {
            prompt: { type: "string" },
            solution: { type: "string" },
            figureSvg: { type: "string", description: FIGURE_SVG_FIELD_DESC }
          },
          required: ["prompt", "solution", "figureSvg"]
        }
      },
      figures: {
        type: "array",
        description: "Schémas, graphiques ou images des photos sources indispensables à la compréhension, à réinsérer dans le texte.",
        items: {
          type: "object",
          properties: {
            imageIndex: { type: "integer", description: "Index (à partir de 0) de la photo source où se trouve ce schéma." },
            box: { type: "array", items: { type: "integer" }, description: "Zone [ymin, xmin, ymax, xmax] du schéma dans cette photo, sur une échelle 0-1000." },
            caption: { type: "string", description: "Légende courte du schéma." },
            placeholder: { type: "string", description: "Jeton unique au format [[figure:N]] (N = index de cette figure) à insérer tel quel dans \"transcription\" et/ou \"explanation\" à l'endroit exact où ce schéma doit apparaître." }
          },
          required: ["imageIndex", "box", "caption", "placeholder"]
        }
      }
    },
    required: ["transcription", "explanation", "flashcards", "quizQuestions", "exercises", "figures"]
  };

  function buildCoursePrompt(title, subjectName, chapterName, imageCount, priorTranscription) {
    var step1;
    if (priorTranscription) {
      step1 = imageCount > 0
        // mergeNewOnly : volontairement, "transcription" ne doit contenir QUE le nouveau contenu — le
        // contenu déjà connu est donné ci-dessous UNIQUEMENT comme contexte (pour que l'explication et
        // les questions restent cohérentes), jamais pour être réécrit. Faire réécrire par l'IA un long
        // texte déjà transcrit, même avec la consigne "ne perds rien", finit toujours par le compresser
        // un peu (une tendance naturelle des modèles à "faire plus propre") — la seule façon de garantir
        // zéro perte est de ne plus jamais y retoucher, et de laisser le code les recoller tel quel.
        ? "Ce cours a déjà été retranscrit à partir de documents précédents. Voici son contenu déjà connu, donné ici UNIQUEMENT comme contexte pour que ton explication/tes questions restent cohérentes avec lui — tu ne dois PAS le recopier ni le reformuler dans \"transcription\" :\n\n" + priorTranscription + "\n\nL'élève vient d'ajouter " + imageCount + " nouvelle(s) photo(s)/page(s) à ce même cours (fournies ci-dessous, dans l'ordre). Dans le champ \"transcription\" de ta réponse, retranscris UNIQUEMENT le contenu de CES NOUVELLES photos, fidèlement et intégralement, en Markdown structuré (## et ### pour les titres, - pour les listes, ** pour le gras) — reprends les détails/exemples/remarques QUI SONT RÉELLEMENT ÉCRITS SUR CES PHOTOS, jamais un exemple ou un détail que tu inventerais toi-même. Le contenu déjà connu ci-dessus sera rajouté automatiquement par le site, tel quel, tu n'as pas à t'en occuper."
        : "Ce cours a déjà été retranscrit à partir de documents précédents (aucune nouvelle photo n'est fournie cette fois). Reprends sa transcription telle quelle dans \"transcription\" (tu peux la nettoyer légèrement si besoin, mais garde tout le contenu, en Markdown structuré) :\n\n" + priorTranscription;
    } else if (imageCount === 0) {
      step1 = "Aucune photo n'a été fournie : rédige à partir du seul titre un contenu de cours plausible, rigoureux et structuré en Markdown (## et ### pour les titres, - pour les listes, ** pour le gras).";
    } else if (imageCount === 1) {
      step1 = "Retranscris fidèlement et INTÉGRALEMENT le contenu visible sur la photo, en Markdown structuré (## et ### pour les titres, - pour les listes, ** pour le gras). Corrige les fautes évidentes mais garde le sens exact. C'est une vraie retranscription, pas une synthèse : ne garde pas seulement les points importants, reprends aussi les détails, exemples et remarques annexes QUI SONT RÉELLEMENT ÉCRITS SUR LA PHOTO (jamais un exemple ou un détail que tu inventerais toi-même pour illustrer — la transcription doit rester un reflet fidèle à 100% de ce que l'enseignant a écrit, rien de plus, rien de moins). Ne résume et ne saute rien : si la photo contient un tableau ou une liste de définitions/dates/formules, retranscris-le intégralement, ligne par ligne ou case par case, sans en omettre aucune.";
    } else {
      step1 = "Les " + imageCount + " photos fournies sont plusieurs pages du même cours, dans l'ordre. Retranscris-les fidèlement et INTÉGRALEMENT en un seul contenu cohérent et continu, en Markdown structuré (## et ### pour les titres, - pour les listes, ** pour le gras). Corrige les fautes évidentes mais garde le sens exact. C'est une vraie retranscription, pas une synthèse : ne garde pas seulement les points importants, reprends aussi les détails, exemples et remarques annexes QUI SONT RÉELLEMENT ÉCRITS SUR LES PHOTOS (jamais un exemple ou un détail que tu inventerais toi-même pour illustrer — la transcription doit rester un reflet fidèle à 100% de ce que l'enseignant a écrit, rien de plus, rien de moins). Ne résume et ne saute rien : si le cours contient un tableau ou une liste de définitions/dates/formules, retranscris-le intégralement, ligne par ligne ou case par case, sans en omettre aucune.";
    }
    return "Tu es un assistant pédagogique pour un élève francophone. Voici un cours intitulé « " + title + " » (matière : " + subjectName + ", chapitre : " + chapterName + ").\n\n" +
      "Règle importante : si un passage du contenu source correspond mot pour mot à un texte déjà public sur internet (article Wikipedia, site d'analyse littéraire, résumé de manuel, etc. — ce qui arrive souvent quand l'enseignant a lui-même repris une source en ligne), REFORMULE ce passage avec des mots différents en gardant strictement le même sens, la même structure et toutes les informations (dates, définitions, courtes citations d'œuvres entre guillemets restent autorisées) plutôt que de le recopier tel quel. Ce n'est pas à l'élève de rendre des comptes sur les sources utilisées par son enseignant.\n\n" +
      "1. " + step1 + "\n" +
      "2. Rédige une VRAIE explication pédagogique approfondie, pas un résumé reformulé en plus simple. Pour CHAQUE notion du cours (pas seulement les principales) : explique le \"pourquoi\" avant/avec le \"quoi\" (d'où ça vient, à quoi ça sert, pourquoi c'est vrai ou pourquoi on en a besoin), donne au moins un exemple concret et chiffré/situé (jamais juste \"par exemple...\" vague), anticipe et lève explicitement la confusion ou l'erreur la plus fréquente sur cette notion précise (\"beaucoup d'élèves confondent X et Y, mais...\"), et relie la notion à celles qui précèdent/suivent dans le cours pour que l'ensemble forme un raisonnement cohérent plutôt qu'une liste de paragraphes indépendants. Structure-la en Markdown avec les mêmes ## et ### que la retranscription (une sous-section par grande notion), jamais un seul bloc de texte continu. Une explication qui se contente de reformuler la transcription avec des mots plus simples, sans profondeur ni exemple ni mise en garde, est un ÉCHEC — vise la longueur et la richesse qu'il faut pour que l'élève comprenne vraiment, pas un résumé expéditif.\n" +
      "3. Les vidéos YouTube recommandées sont gérées séparément après cette génération (recherche de vraies vidéos existantes) : ignore ce point ici.\n" +
      "4. Génère un nombre de flashcards (question / réponse courte) ADAPTÉ à la richesse réelle du cours (entre 5 et 20 au total) plutôt qu'un nombre fixe : pour un cours très court avec peu de notions, génère seulement 5 à 8 flashcards bien ciblées ; pour un cours long et dense couvrant beaucoup de notions, génère-en davantage, jusqu'à 20. Une notion distincte du cours = une flashcard, pas plus — ne crée jamais de flashcards redondantes ou artificielles juste pour atteindre un quota. Qualité exigée pour chaque flashcard : \"q\" doit être une question PRÉCISE et autonome (compréhensible sans relire le cours, jamais une question vague type \"à quoi ça sert ?\" sans préciser de quoi on parle) ; \"a\" doit être une réponse COMPLÈTE et formulée en vraie phrase (jamais un mot ou un fragment télégraphique isolé, sauf si la réponse est authentiquement un seul mot/une seule valeur comme une date ou un nombre) — une flashcard doit se suffire à elle-même pour réviser sans le cours sous les yeux.\n" +
      "5. Génère des questions de révision qui couvrent DE FAÇON EXHAUSTIVE tout ce qu'il y a à savoir par cœur dans ce cours — tu ne choisis pas un sous-ensemble et tu n'en oublies aucune. Repère chaque définition, chaque date, chaque notion, chaque formule ou notation à connaître par cœur, et chaque ligne/case d'un tableau à mémoriser, puis crée une question pour CHACUN d'entre eux, un par un. S'il y a 40 définitions dans le cours, génère 40 questions de définition (une par définition) ; s'il y a 3 formules à connaître par cœur, génère 3 questions de formule ; si un tableau contient 15 cases à mémoriser, génère les 15 questions correspondantes. Il n'y a AUCUNE limite haute au nombre de questions : le nombre exact dépend uniquement de ce qu'il y a à mémoriser dans le cours, même si ça fait beaucoup plus que d'habitude — ce n'est pas à toi de trier ou de raccourcir la liste. La seule chose à éviter est la vraie redondance (ne pose pas deux fois la même question sur le même élément) ou les questions hors-sujet ; en dehors de ça, couvre tout, sans exception. Varie les catégories dans le champ \"category\" : \"definition\" (qu'est-ce que...), \"formule\" (formule ou notation à connaître par cœur) et \"application\" (mini-exercice rapide d'application directe). RÈGLE STRICTE sur le type : toute question de catégorie \"definition\" ou \"formule\" — donc tout ce qui se récite mot pour mot — DOIT être de type \"ouverte\" (l'élève réécrit lui-même la définition/formule ; JAMAIS de type \"qcm\" pour ces deux catégories, reconnaître une bonne réponse parmi 4 ne prouve pas qu'on la sait par cœur). Seule la catégorie \"application\" peut être en \"qcm\", et encore minoritairement : au global sur l'ensemble des questions, le type \"ouverte\" doit rester largement majoritaire (au moins deux tiers), le \"qcm\" n'est qu'un complément. Qualité exigée, sans exception : l'énoncé (\"prompt\") doit être précis et sans ambiguïté (une seule bonne réponse possible, jamais une formulation qui prête à interprétation) ; pour un \"qcm\", les 3 mauvaises réponses doivent être réellement plausibles (des erreurs ou confusions fréquentes sur cette notion précise), jamais des réponses absurdes ou évidemment fausses qui rendent le choix trivial sans connaître le cours ; \"explanation\" doit vraiment expliquer POURQUOI la bonne réponse est correcte (et implicitement pourquoi les autres ne le sont pas pour un qcm), pas se contenter de la répéter. Une question mal formulée, ambiguë ou avec des distracteurs ridicules est un ÉCHEC même si la bonne réponse elle-même est juste.\n" +
      "6. Génère un nombre d'exercices plus complets ADAPTÉ à la richesse du cours (au moins 4, et bien plus pour un cours dense qui s'y prête — pas de plafond artificiel), volontairement PLUS DIFFICILES que les questions ci-dessus : plusieurs étapes de raisonnement ou de calcul, une vraie difficulté à surmonter, quitte à être longs si besoin (un exercice qui prend 15-20 minutes de réflexion n'est pas un problème, l'objectif est que l'élève ait vraiment cherché et progressé, pas reconnu une réponse en 30 secondes). Chacun avec un énoncé clair dans \"prompt\" et une solution rédigée complète et détaillée (avec le résultat final) dans \"solution\".\n" +
      (imageCount > 0 ? "7. Si une des photos sources contient un schéma, un graphique, une carte, un diagramme ou un dessin VISUEL réellement NÉCESSAIRE pour comprendre le cours (pas une simple photo décorative), repère-le et ajoute une entrée dans \"figures\" avec : \"imageIndex\" (index de la photo, à partir de 0), \"box\" (la zone rectangulaire exacte de ce schéma dans la photo, au format [ymin, xmin, ymax, xmax] sur une échelle de 0 à 1000, en excluant le texte autour), \"caption\" (légende courte), et \"placeholder\" (un jeton unique \"[[figure:N]]\" où N est l'index de cette figure dans le tableau \"figures\"). Insère ensuite ce jeton \"[[figure:N]]\" tel quel, seul sur sa ligne, exactement à l'endroit de \"transcription\" et/ou \"explanation\" où ce schéma doit apparaître — ne le décris jamais en mots à la place de l'insérer réellement. Signal à prendre TRÈS au sérieux : dès que le texte source dit \"ci-contre\", \"ci-dessous\", \"ci-joint\" ou \"ci-après\" à propos d'une représentation graphique/d'un schéma, c'est qu'un visuel est physiquement présent à cet endroit — cherche-le activement et capture-le, ne le laisse jamais de côté. INTERDIT : ne crée JAMAIS de figure pour du texte, même s'il apparaît visuellement dans un encadré, une bulle de citation, un fond coloré ou une police différente — une citation, un extrait de texte, une définition encadrée ou une légende écrite doivent TOUJOURS être retranscrits comme du texte normal (corrigé) dans \"transcription\"/\"explanation\", jamais capturés comme une image. \"figures\" est réservé exclusivement à du contenu qui ne peut PAS être retranscrit en texte (dessin, photo, graphique, carte, schéma). S'il n'y a aucun schéma nécessaire, renvoie un tableau \"figures\" vide.\n\n" : "\n") +
      "8. Pour CHAQUE question de révision et CHAQUE exercice (champ \"figureSvg\" de chacun) : dès qu'un support visuel est NÉCESSAIRE pour lire une DONNÉE externe du problème — même si l'énoncé ne le dit pas explicitement en mots (ex. donner des longueurs d'onde et demander une couleur suppose le spectre visible sous les yeux, même sans le mot \"spectre\" dans l'énoncé) —, tu DOIS dessiner toi-même ce support en SVG dans \"figureSvg\". ATTENTION, ne confonds jamais ça avec fournir la réponse : si la question teste une connaissance à savoir par cœur d'après le cours (une date/un événement d'histoire-géo, une formule de maths/physique à connaître, une définition, un résultat, un nom), \"figureSvg\" reste VIDE, un point c'est tout — par exemple jamais de frise chronologique pour une question de date, jamais la formule elle-même dessinée en image pour une question qui demande de connaître ou d'appliquer une formule du cours. " + FIGURE_SVG_FIELD_DESC + " Pour toutes les autres questions/exercices (la grande majorité, purement textuels ou calculatoires, ou testant une connaissance à savoir par cœur), laisse \"figureSvg\" vide.\n\n" +
      "Important — les flashcards, questions de révision et exercices doivent porter sur les notions, règles, définitions et méthodes du cours lui-même, jamais sur les exemples illustratifs qui les accompagnent. Interdit : des questions du type « quel exemple a été donné dans le cours pour... », « que valait X dans l'exemple », ou toute question qui ne teste que la mémorisation d'un détail d'exemple plutôt que la compréhension de la notion. Si le cours illustre une règle avec un exemple, interroge sur la règle elle-même (au besoin avec un cas ou des valeurs différents de ceux de l'exemple) — retenir un exemple par cœur n'apprend rien.\n\n" +
      "Pour toute formule ou notation mathématique/scientifique (dans n'importe quel champ), utilise du LaTeX délimité par $...$ en ligne ou $$...$$ pour une formule isolée — jamais de simple texte brut pour une formule. N'utilise jamais de commande de couleur LaTeX (\\textcolor, \\colorbox, \\color, etc.) pour surligner un terme : le texte doit toujours rester dans la couleur par défaut, utilise le gras (**) si tu veux mettre quelque chose en valeur.\n\n" +
      "Si le contenu source (ou ton explication) comporte un tableau, reproduis-le comme un vrai tableau Markdown, avec EXACTEMENT ce format (une ligne d'en-tête, puis une ligne de séparation avec des tirets, puis une ligne par ligne du tableau, jamais de texte ou de liste à puces à la place) :\n" +
      "| Colonne 1 | Colonne 2 |\n" +
      "|---|---|\n" +
      "| Valeur A | Valeur B |\n" +
      "| Valeur C | Valeur D |\n\n" +
      "Le site sait afficher de vrais tableaux, alors n'hésite pas à t'en servir dès que c'est pertinent (dans la retranscription comme dans l'explication) — mais respecte bien ce format ligne par ligne, sans jamais oublier la ligne de séparation |---|---|.\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni, en français.";
  }

  // Gemini écrit parfois une commande LaTeX (\text, \bullet, \frac, \forall...) avec un seul backslash
  // au lieu de le doubler comme l'exige JSON. Quand la lettre qui suit est "t", "b" ou "f", ce simple
  // backslash correspond pile à une VRAIE séquence d'échappement JSON (tabulation/retour arrière/saut de
  // page) : JSON.parse l'interprète donc silencieusement comme ce caractère de contrôle au lieu de le
  // garder tel quel, ce qui casse l'affichage ("\text{...}" devient une tabulation suivie de "ext{...}").
  // Ces 3 caractères de contrôle n'ont eux-mêmes aucune raison légitime d'apparaître dans un texte
  // généré, donc on restaure sans risque le backslash littéral partout où on les trouve après coup.
  function repairStrayLatexEscapes(value) {
    if (typeof value === "string") return value.replace(/[\b\t\f]/g, function (ch) { return "\\" + { "\b": "b", "\t": "t", "\f": "f" }[ch]; });
    if (Array.isArray(value)) return value.map(repairStrayLatexEscapes);
    if (value && typeof value === "object") {
      var out = {};
      Object.keys(value).forEach(function (k) { out[k] = repairStrayLatexEscapes(value[k]); });
      return out;
    }
    return value;
  }
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  // Un fetch() nu n'a AUCUN délai limite : si Google traîne ou que la connexion reste bloquée, l'appel
  // ne se résout jamais et l'élève reste planté indéfiniment sur le sablier, sans erreur ni recours.
  // On force donc une limite de temps par tentative, pour toujours retomber sur le modèle de secours
  // suivant (ou un message d'erreur clair) plutôt que d'attendre pour rien.
  function fetchWithTimeout(url, opts, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    var merged = {};
    for (var k in opts) merged[k] = opts[k];
    merged.signal = controller.signal;
    return fetch(url, merged).finally(function () { clearTimeout(timer); });
  }
  // Message clair à afficher quand TOUS les modèles (et, le cas échéant, la clé de secours) ont
  // échoué à cause d'une limite de débit Google (429) — sans ça, l'élève ne voit que le texte brut
  // anglais de la DERNIÈRE tentative, qui donne l'impression trompeuse qu'aucun secours n'a eu lieu.
  function rateLimitFallbackError(detail, triedBackup) {
    var err = new Error(triedBackup
      ? "Tous les modèles Gemini sont temporairement limités par Google, même avec ta clé de secours. Réessaie dans 1 à 2 minutes."
      : "Tous les modèles Gemini disponibles sont temporairement limités par Google (quota gratuit dépassé). Réessaie dans 1 à 2 minutes, ou ajoute une clé API de secours dans les paramètres.");
    err.status = 429;
    err.detail = detail;
    return err;
  }
  // Essaie les 4 modèles de secours avec UNE clé API donnée. Lève une erreur avec `.rateLimited = true`
  // si TOUS ont échoué spécifiquement par manque de quota (429), pour que l'appelant sache s'il vaut la
  // peine de rebasculer sur une deuxième clé plutôt que d'abandonner tout de suite.
  function recitationNoteText(n) {
    return "\n\n[Note système — IMPORTANT : une tentative précédente de cette même génération a été bloquée par le filtre anti-plagiat de Gemini (RECITATION) pour ressemblance trop forte avec un contenu déjà public en ligne (ex. un diaporama ou une fiche de cours partagée par un autre professeur/élève). Reformule ENTIÈREMENT avec une structure de phrases et un vocabulaire totalement différents de toute source existante — change l'ordre des idées, les tournures, les exemples, regroupe les informations différemment — sans jamais recopier plusieurs mots consécutifs identiques à un texte déjà publié. Conserve néanmoins EXACTEMENT les mêmes informations factuelles (dates, chiffres, définitions, structure logique du cours) : ne réduis jamais la quantité ou la précision de l'information, seule la formulation doit changer." + (n > 1 ? " C'est déjà la " + n + "e tentative bloquée pour la même raison : sois RADICAL dans la reformulation cette fois, quitte à changer complètement l'angle pédagogique, l'ordre des sections ou la façon de présenter l'information." : "") + "]";
  }
  // Un seul essai Gemini : modèle + clé donnés, avec une éventuelle note de reformulation si c'est un
  // réessai après blocage RECITATION. Isolé de la boucle de fallback pour pouvoir aussi re-tenter le
  // modèle le PLUS CAPABLE (le premier de la liste) en tout dernier recours, plutôt que de finir
  // systématiquement sur le modèle le plus faible (flash-lite) qui est justement le moins apte à
  // reformuler intelligemment un contenu très indexé en ligne.
  async function tryGeminiModel(apiKey, modelName, parts, schema, recitationCount, maxOutputTokens) {
    var generationConfig = { response_mime_type: "application/json", response_schema: schema };
    if (maxOutputTokens) generationConfig.max_output_tokens = maxOutputTokens;
    var requestParts = parts;
    if (recitationCount > 0) {
      generationConfig.temperature = 1; // max dès le 1er réessai : une hausse progressive laissait trop d'essais à basse créativité
      requestParts = parts.concat([{ text: recitationNoteText(recitationCount) }]);
    }
    var body = JSON.stringify({ contents: [{ role: "user", parts: requestParts }], generationConfig: generationConfig });
    var endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + modelName + ":generateContent";
    var res;
    try {
      res = await fetchWithTimeout(endpoint + "?key=" + encodeURIComponent(apiKey), { method: "POST", headers: { "content-type": "application/json" }, body: body }, 60000);
    } catch (netErr) {
      var timedOut = netErr && netErr.name === "AbortError";
      var netError = new Error(timedOut ? "Gemini n'a pas répondu à temps (60s)." : ("Connexion à Gemini impossible : " + (netErr && netErr.message || "erreur réseau")));
      netError.status = timedOut ? 408 : 0;
      netError.detail = String(netErr);
      return { ok: false, err: netError, retryable: true, recitation: false };
    }
    if (res.ok) {
      var data = await res.json();
      if (data.promptFeedback && data.promptFeedback.blockReason) {
        var blockErr = new Error("Contenu bloqué par Gemini (" + data.promptFeedback.blockReason + ").");
        blockErr.status = res.status;
        blockErr.detail = JSON.stringify(data, null, 2);
        return { ok: false, err: blockErr, retryable: true, recitation: false };
      }
      var cand = data.candidates && data.candidates[0];
      var candParts = cand && cand.content && cand.content.parts;
      if (!candParts || !candParts[0]) {
        // HTTP 200 mais réponse vide : Gemini a quand même refusé de générer (souvent finishReason
        // RECITATION quand le texte source colle de trop près à une œuvre déjà indexée en ligne,
        // typique d'une analyse littéraire connue ou d'un diaporama scolaire largement partagé).
        var reason = cand && cand.finishReason;
        var reasonLabels = {
          RECITATION: "le contenu généré ressemblait de trop près à une œuvre déjà publiée en ligne (fréquent pour l'analyse d'une œuvre littéraire connue ou un diaporama de cours partagé) et a été bloqué automatiquement",
          SAFETY: "le contenu a été jugé sensible par les filtres de sécurité de Gemini",
          PROHIBITED_CONTENT: "le contenu a été jugé non autorisé par Gemini",
          BLOCKLIST: "le contenu contient des termes bloqués par Gemini",
          SPII: "le contenu semblait contenir des informations personnelles sensibles",
          OTHER: "Gemini a refusé de répondre pour une raison non précisée"
        };
        var reasonMsg = reason && reasonLabels[reason];
        var emptyErr = new Error(reasonMsg ? "Génération refusée par Gemini : " + reasonMsg + "." : "Réponse vide de l'API.");
        emptyErr.status = res.status;
        emptyErr.detail = "Modèle : " + modelName + "\n\n" + JSON.stringify(data, null, 2);
        return { ok: false, err: emptyErr, retryable: true, recitation: reason === "RECITATION" };
      }
      return { ok: true, value: repairStrayLatexEscapes(JSON.parse(candParts[0].text)) };
    }
    var errBody = await res.json().catch(function () { return {}; });
    var msg = (errBody.error && errBody.error.message) || ("Erreur API Gemini (" + res.status + ")");
    var retryable = res.status === 503 || res.status === 429 || res.status === 404 || /overload|unavailable|high demand|no longer available|not found|deprecated/i.test(msg);
    var httpErr = new Error(msg);
    httpErr.status = res.status;
    httpErr.detail = "Modèle : " + modelName + "\n\n" + JSON.stringify(errBody, null, 2);
    return { ok: false, err: httpErr, retryable: retryable, rateLimit: res.status === 429 };
  }
  async function attemptGeminiWithKey(apiKey, parts, schema, maxOutputTokens) {
    var lastErr = null;
    var hadRateLimit = false;
    var recitationRetries = 0;
    for (var i = 0; i < GEMINI_MODELS.length; i++) {
      if (hadRateLimit) await sleep(4000); // laisse une chance à la limite par MINUTE de se libérer avant le modèle de secours suivant
      var r = await tryGeminiModel(apiKey, GEMINI_MODELS[i], parts, schema, recitationRetries, maxOutputTokens);
      if (r.ok) return r.value;
      lastErr = r.err;
      if (r.rateLimit) hadRateLimit = true;
      if (r.recitation) recitationRetries++;
      if (!r.retryable) throw lastErr;
    }
    // Dernier recours spécifique au blocage RECITATION : la boucle ci-dessus finit sur flash-lite, le
    // modèle le moins capable de reformuler intelligemment un contenu très indexé en ligne — on retente
    // donc une dernière fois avec le modèle le PLUS capable (le premier de la liste) et la consigne de
    // reformulation la plus insistante, plutôt que d'abandonner sur l'essai le plus faible.
    if (recitationRetries > 0 && GEMINI_MODELS.length > 1) {
      var last = await tryGeminiModel(apiKey, GEMINI_MODELS[0], parts, schema, recitationRetries + 1, maxOutputTokens);
      if (last.ok) return last.value;
      lastErr = last.err;
    }
    var finalErr = lastErr || new Error("Erreur inconnue de l'API Gemini.");
    finalErr.rateLimited = hadRateLimit;
    throw finalErr;
  }
  // maxOutputTokens est optionnel (laisse l'API utiliser la limite par défaut du modèle) — utilisé
  // uniquement pour les générations dont la sortie peut légitimement être très longue (ex. un podcast à
  // plusieurs parties de plusieurs milliers de mots chacune), pour ne jamais risquer une réponse
  // tronquée silencieusement par une limite de sortie trop basse pour ce cas précis.
  async function callGemini(parts, schema, maxOutputTokens) {
    var primaryKey = getApiKey();
    if (!primaryKey) { var e = new Error("Ajoute ta clé API Gemini dans les paramètres avant de continuer."); e.code = "NO_API_KEY"; throw e; }
    try {
      return await attemptGeminiWithKey(primaryKey, parts, schema, maxOutputTokens);
    } catch (err1) {
      var backupKey = getBackupApiKey();
      if (!err1.rateLimited || !backupKey) throw (err1.rateLimited ? rateLimitFallbackError(err1.detail, false) : err1);
      // Clé principale à quota sur ses 4 modèles : bascule entière sur la clé de secours (compte Google
      // différent, donc quota totalement indépendant) avant d'abandonner pour de bon.
      try {
        return await attemptGeminiWithKey(backupKey, parts, schema, maxOutputTokens);
      } catch (err2) {
        throw (err2.rateLimited ? rateLimitFallbackError(err2.detail, true) : err2);
      }
    }
  }

  // Variante de callGemini qui laisse le modèle interroger le vrai Google Search ("grounding") au lieu
  // de générer depuis sa seule mémoire — indispensable pour aller chercher un document RÉEL (source,
  // auteur, date) plutôt que d'en halluciner un qui ressemblerait à un vrai document sans en être un.
  // Le grounding et la sortie JSON structurée (response_schema) ne sont pas fiables ensemble sur cette
  // API (le grounding est silencieusement ignoré si response_schema est présent) : cette fonction
  // renvoie donc du texte libre avec ses sources, à faire ensuite passer par un second appel callGemini
  // "normal" pour le mettre en forme dans le schéma voulu. Gratuit dans la limite d'un quota mensuel
  // généreux (~5000 requêtes/mois sur les modèles Gemini 3.x), sans carte bancaire.
  async function attemptGeminiSearchWithKey(apiKey, parts) {
    var lastErr = null;
    var hadRateLimit = false;
    for (var i = 0; i < GEMINI_MODELS.length; i++) {
      if (hadRateLimit) await sleep(4000); // laisse une chance à la limite par MINUTE de se libérer avant le modèle de secours suivant
      var body = JSON.stringify({ contents: [{ role: "user", parts: parts }], tools: [{ google_search: {} }] });
      var endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODELS[i] + ":generateContent";
      var res;
      try {
        res = await fetchWithTimeout(endpoint + "?key=" + encodeURIComponent(apiKey), { method: "POST", headers: { "content-type": "application/json" }, body: body }, 60000);
      } catch (netErr) {
        var timedOut = netErr && netErr.name === "AbortError";
        lastErr = new Error(timedOut ? "Gemini n'a pas répondu à temps (60s)." : ("Connexion à Gemini impossible : " + (netErr && netErr.message || "erreur réseau")));
        lastErr.status = timedOut ? 408 : 0;
        lastErr.detail = String(netErr);
        continue;
      }
      if (res.ok) {
        var data = await res.json();
        if (data.promptFeedback && data.promptFeedback.blockReason) {
          lastErr = new Error("Contenu bloqué par Gemini (" + data.promptFeedback.blockReason + ").");
          lastErr.status = res.status; lastErr.detail = JSON.stringify(data, null, 2);
          continue;
        }
        var cand = data.candidates && data.candidates[0];
        var candParts = cand && cand.content && cand.content.parts;
        var text = (candParts || []).map(function (p) { return p.text || ""; }).join("\n");
        if (!text.trim()) {
          lastErr = new Error("Réponse vide de l'API lors de la recherche.");
          lastErr.status = res.status; lastErr.detail = JSON.stringify(data, null, 2);
          continue;
        }
        var chunks = (cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
        var sources = chunks.map(function (c) { return c.web ? { uri: c.web.uri || "", title: c.web.title || "" } : null; }).filter(Boolean);
        return { text: text, sources: sources };
      }
      var errBody = await res.json().catch(function () { return {}; });
      var msg = (errBody.error && errBody.error.message) || ("Erreur API Gemini (" + res.status + ")");
      var retryable = res.status === 503 || res.status === 429 || res.status === 404 || /overload|unavailable|high demand|no longer available|not found|deprecated/i.test(msg);
      if (res.status === 429) hadRateLimit = true;
      lastErr = new Error(msg);
      lastErr.status = res.status; lastErr.detail = "Modèle : " + GEMINI_MODELS[i] + "\n\n" + JSON.stringify(errBody, null, 2);
      if (!retryable) throw lastErr;
    }
    var finalErr = lastErr || new Error("Erreur inconnue de l'API Gemini.");
    finalErr.rateLimited = hadRateLimit;
    throw finalErr;
  }
  async function callGeminiSearch(parts) {
    var primaryKey = getApiKey();
    if (!primaryKey) { var e = new Error("Ajoute ta clé API Gemini dans les paramètres avant de continuer."); e.code = "NO_API_KEY"; throw e; }
    try {
      return await attemptGeminiSearchWithKey(primaryKey, parts);
    } catch (err1) {
      var backupKey = getBackupApiKey();
      if (!err1.rateLimited || !backupKey) throw (err1.rateLimited ? rateLimitFallbackError(err1.detail, false) : err1);
      try {
        return await attemptGeminiSearchWithKey(backupKey, parts);
      } catch (err2) {
        throw (err2.rateLimited ? rateLimitFallbackError(err2.detail, true) : err2);
      }
    }
  }

  async function generateCourseContent(imageDataUrls, title, subjectName, chapterName, priorTranscription) {
    var images = (imageDataUrls || []).map(function (url) {
      var m = /^data:(image\/[a-zA-Z+]+|application\/pdf);base64,(.+)$/.exec(url || "");
      return m ? { inline_data: { mime_type: m[1], data: m[2] } } : null;
    }).filter(Boolean);
    var parts = images.concat([{ text: buildCoursePrompt(title, subjectName, chapterName, images.length, priorTranscription) }]);
    return callGemini(parts, COURSE_SCHEMA);
  }

  var REVISION_SHEET_SCHEMA = {
    type: "object",
    properties: {
      content: { type: "string", description: "Fiche de révision complète en Markdown." },
      schemas: {
        type: "array",
        description: "0 à 3 schémas/diagrammes qui aident vraiment à mémoriser ou comprendre une notion dense de cette fiche (ex. un cycle, une structure annotée, une frise chronologique, un schéma de circuit, une figure géométrique). N'en crée QUE si une vraie représentation visuelle apporte quelque chose qu'une liste ou un texte n'apporte pas — ne force jamais un schéma artificiel pour une notion purement textuelle. Contrairement à un exercice, rien n'est caché ici : une fiche de révision montre l'information complète sur le schéma (légendes, valeurs, noms), exactement comme un vrai schéma de cours.",
        items: {
          type: "object",
          properties: {
            caption: { type: "string", description: "Légende courte du schéma." },
            placeholder: { type: "string", description: "Jeton unique au format [[schema:N]] (N = index de ce schéma dans ce tableau) à insérer tel quel, seul sur sa ligne, dans \"content\" à l'endroit exact où ce schéma doit apparaître." },
            description: { type: "string", description: "Description PRÉCISE et complète de ce que ce schéma doit représenter : tous les éléments à y faire figurer (boîtes, flèches, zones, axes...), leurs noms/légendes exacts, leurs valeurs, et comment ils sont reliés/organisés entre eux (ex. \"flèche du glucose entrant depuis le milieu extracellulaire vers le cytoplasme, à travers une protéine de transport dans la membrane\"). Ce texte sera donné à un autre outil, SANS accès au cours, qui ira chercher sur internet à quoi ressemble vraiment ce schéma dans un manuel scolaire puis le dessinera — sois donc exhaustif et explicite, ne suppose aucune connaissance implicite." }
          },
          required: ["caption", "placeholder", "description"]
        }
      }
    },
    required: ["content", "schemas"]
  };
  function buildRevisionSheetPrompt(title, subjectName, chapterName, scope, courses) {
    var sourceBlocks = courses.map(function (co) {
      return "### Cours : " + co.title + "\n" + stripFigureMarkdown(co.transcription || "");
    }).join("\n\n");
    var scopeLabel = scope === "course" ? "le contenu retranscrit d'un cours" : scope === "theme" ? "le contenu retranscrit de tous les cours de tout un thème" : "le contenu retranscrit de tous les cours d'un chapitre";
    return "Tu es un assistant pédagogique pour un élève francophone. Voici " + scopeLabel + " intitulé « " + title + " » (matière : " + subjectName + ", " + (scope === "theme" ? "thème" : "chapitre") + " : " + chapterName + ").\n\n" +
      "Règle importante : si un passage du contenu source correspond mot pour mot à un texte déjà public sur internet (article, site d'analyse littéraire, résumé de manuel, etc.), REFORMULE ce passage avec des mots différents en gardant strictement le même sens et toutes les informations (dates, définitions, courtes citations d'œuvres entre guillemets restent autorisées) plutôt que de le recopier tel quel — sinon la génération est bloquée automatiquement.\n\n" +
      "Génère une fiche de révision ULTRA COMPLÈTE en Markdown qui reprend absolument TOUT ce qu'il y a à savoir dans ce contenu : chaque définition, chaque date, chaque formule ou notation à connaître par cœur, chaque notion clé, chaque règle, chaque tableau à mémoriser. Rien ne doit être coupé, résumé à l'excès ou oublié — ce n'est pas un résumé qui trie, c'est une fiche qui couvre l'intégralité du contenu de façon dense et bien organisée par thème/section, prête à réviser juste avant un contrôle.\n\n" +
      "PRÉCISION CONCRÈTE OBLIGATOIRE : dès que le contenu source mentionne un élément nommé et identifiable — une expérience, un événement, une loi, un texte ou traité, une découverte, un personnage, une technique, un processus... — la fiche doit dire CE QUE C'EST CONCRÈTEMENT, pas seulement son nom ou sa conclusion. Exemple à ne jamais faire : écrire \"une expérience a montré que...\" sans préciser en quoi elle consistait (qui, sur quoi, comment, ce qui a été observé) si le cours source le précise. Si le cours source ne donne pas ce détail, ne l'invente jamais — dans ce cas, contente-toi de ce qui est donné plutôt que de meubler.\n\n" +
      "Mise en forme — c'est important, une fiche doit avoir l'allure d'une vraie fiche de révision d'élève, pas d'un texte plat et froid :\n" +
      "- ## et ### pour les titres de section/sous-section (varie les sous-sections, ne mets pas tout au même niveau).\n" +
      "- ** pour mettre en gras les termes clés à chaque première apparition.\n" +
      "- __ (double underscore, ex. __terme__) pour souligner un mot ou un chiffre vraiment critique (une date, une unité, un résultat) — à utiliser avec parcimonie, seulement pour ce qui doit sauter aux yeux, jamais pour un paragraphe entier.\n" +
      "- > (chevron en début de ligne, comme une citation Markdown) pour ENCADRER dans un bloc à part LA chose la plus importante de chaque section à retenir par cœur — une formule clé, une définition centrale, un piège fréquent (\"Attention à ne pas confondre...\"). Un encadré par section max, réservé à ce qui mérite vraiment de ressortir visuellement, jamais pour du contenu secondaire.\n" +
      "- Des listes à puces (-) pour énumérer, jamais de longs paragraphes denses quand une liste serait plus lisible.\n\n" +
      "LaTeX obligatoire — règle stricte, applique-la à CHAQUE occurrence sans exception : dès qu'un symbole/nombre a un exposant, un indice, une fraction, une racine, une lettre grecque ou une unité scientifique composée, encadre-le avec $...$ (ou $$...$$ s'il est isolé sur sa ligne), JAMAIS en texte brut. Exemples à respecter littéralement : écris $H_2O$ (jamais \"H2O\"), $CO_2$ (jamais \"CO2\"), $x^2$ (jamais \"x2\" ou \"x^2\" hors $...$), $3 \\times 10^{8}$ (jamais \"3 x 10^8\"), $\\frac{1}{2}$ (jamais \"1/2\" pour une vraie fraction mathématique), $m^3$, $km/h$, $25°C$. Relis mentalement chaque formule/valeur scientifique de \"content\" avant de répondre : si elle contient un exposant, un indice ou un symbole spécial et n'est pas entre $...$, corrige-la. N'utilise jamais de commande de couleur LaTeX (\\textcolor, \\colorbox, \\color, etc.) pour surligner un terme : le texte doit toujours rester dans la couleur par défaut, utilise le gras (**) ou le soulignement (__) si tu veux mettre quelque chose en valeur.\n\n" +
      "Si le contenu source comporte un tableau (ou si organiser une notion sous forme de tableau serait plus clair), utilise un vrai tableau Markdown, avec EXACTEMENT ce format (jamais de liste à puces à la place) :\n" +
      "| Colonne 1 | Colonne 2 |\n" +
      "|---|---|\n" +
      "| Valeur A | Valeur B |\n\n" +
      "Le site sait afficher de vrais tableaux — respecte bien ce format ligne par ligne, sans oublier la ligne de séparation |---|---|.\n\n" +
      "Voici le contenu source :\n\n" + sourceBlocks + "\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni, en français.";
  }
  function generateRevisionSheetContent(courses, title, subjectName, chapterName, scope) {
    var parts = [{ text: buildRevisionSheetPrompt(title, subjectName, chapterName, scope, courses) }];
    return callGemini(parts, REVISION_SHEET_SCHEMA);
  }
  // Laisser l'IA dessiner un schéma "boîtes reliées par des flèches" en SVG libre a été testé deux fois
  // (consignes anti-chevauchement, puis recherche internet avant de dessiner) et reste systématiquement
  // raté en pratique : texte qui déborde, flèches qui ne touchent rien, éléments au mauvais endroit —
  // parce que calculer des coordonnées précises qui ne se chevauchent jamais est un problème spatial que
  // les LLM ne résolvent pas fiablement en écrivant du texte token par token, aussi bonne soit la
  // consigne. Pour CE type de schéma (le plus fréquent en cours : cycle, classification, relations entre
  // notions), on retire donc entièrement la mise en page des mains de l'IA : elle ne fournit QUE le
  // contenu (des boîtes avec un texte + une position de grille, des flèches entre elles), et c'est du
  // code déterministe (renderDiagramSvg) qui calcule tailles de boîtes, positions et tracés de flèches —
  // aucun chevauchement n'est alors possible, par construction. Le mode "svg" libre reste disponible en
  // repli pour les cas qui ne sont vraiment pas des boîtes/flèches (coupe anatomique, carte...).
  function diagramWrapText(text, maxChars) {
    var words = String(text == null ? "" : text).split(/\s+/).filter(Boolean);
    var lines = [], cur = "";
    words.forEach(function (w) {
      var trial = cur ? cur + " " + w : w;
      if (trial.length > maxChars && cur) { lines.push(cur); cur = w; } else cur = trial;
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  }
  var DIAGRAM_COLORS = {
    vert: { fill: "#4C8C4A", text: "#fff" }, bleu: { fill: "#2F7FC1", text: "#fff" },
    jaune: { fill: "#D9A51B", text: "#1c1c1c" }, orange: { fill: "#E8862B", text: "#fff" },
    rose: { fill: "#D44C80", text: "#fff" }, violet: { fill: "#7A4FC4", text: "#fff" },
    rouge: { fill: "#D14B35", text: "#fff" }, gris: { fill: "#5b6472", text: "#fff" }
  };
  function renderDiagramSvg(rawNodes, rawEdges) {
    var nodes = (rawNodes || []).filter(function (n) { return n && n.id && n.label; });
    if (!nodes.length) return "";
    var edges = (rawEdges || []).filter(function (e) { return e && e.from && e.to; });
    var FONT = 15, SUBFONT = 12, PAD_X = 16, PAD_Y = 14, LINE_H = 19, SUB_LINE_H = 15, SUB_GAP = 6;
    var GAP_X = 70, GAP_Y = 56, CHAR_W = 8.3, MAX_CHARS = 20, MIN_W = 120, MARGIN = 24;
    var byId = {}, maxCol = 0, maxRow = 0;
    nodes.forEach(function (n) {
      n.col = Math.max(0, n.col | 0); n.row = Math.max(0, n.row | 0);
      maxCol = Math.max(maxCol, n.col); maxRow = Math.max(maxRow, n.row);
      n._lines = diagramWrapText(n.label, MAX_CHARS);
      n._subLines = n.sublabel ? diagramWrapText(n.sublabel, MAX_CHARS + 6) : [];
      var longest = 0;
      n._lines.concat(n._subLines).forEach(function (l) { longest = Math.max(longest, l.length); });
      n._w = Math.max(MIN_W, Math.round(longest * CHAR_W) + PAD_X * 2);
      n._h = PAD_Y * 2 + n._lines.length * LINE_H + (n._subLines.length ? SUB_GAP + n._subLines.length * SUB_LINE_H : 0);
      byId[n.id] = n;
    });
    var colW = [], rowH = [];
    for (var c = 0; c <= maxCol; c++) colW[c] = 0;
    for (var r = 0; r <= maxRow; r++) rowH[r] = 0;
    nodes.forEach(function (n) { colW[n.col] = Math.max(colW[n.col], n._w); rowH[n.row] = Math.max(rowH[n.row], n._h); });
    var colX = [0], rowY = [0];
    for (var c2 = 1; c2 <= maxCol; c2++) colX[c2] = colX[c2 - 1] + colW[c2 - 1] + GAP_X;
    for (var r2 = 1; r2 <= maxRow; r2++) rowY[r2] = rowY[r2 - 1] + rowH[r2 - 1] + GAP_Y;
    var W = colX[maxCol] + colW[maxCol] + MARGIN * 2;
    var H = rowY[maxRow] + rowH[maxRow] + MARGIN * 2;
    nodes.forEach(function (n) {
      n._x = MARGIN + colX[n.col] + (colW[n.col] - n._w) / 2;
      n._y = MARGIN + rowY[n.row] + (rowH[n.row] - n._h) / 2;
      n._cx = n._x + n._w / 2; n._cy = n._y + n._h / 2;
    });
    // Point où une flèche sort d'une boîte rectangulaire en partant de son centre vers (dx,dy) : la
    // plus petite distance t telle que le point centre+t*(dx,dy) touche un des 4 bords de la boîte.
    function rectExit(n, dx, dy) {
      if (!dx && !dy) return { x: n._cx, y: n._cy };
      var hw = n._w / 2, hh = n._h / 2;
      var tx = dx ? hw / Math.abs(dx) : Infinity, ty = dy ? hh / Math.abs(dy) : Infinity;
      var t = Math.min(tx, ty);
      return { x: n._cx + dx * t, y: n._cy + dy * t };
    }
    var edgesSvg = edges.map(function (e) {
      var a = byId[e.from], b = byId[e.to];
      if (!a || !b || a === b) return "";
      var dx = b._cx - a._cx, dy = b._cy - a._cy;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / len, uy = dy / len;
      var p1 = rectExit(a, ux, uy), p2 = rectExit(b, -ux, -uy);
      var mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      var label = "";
      if (e.label) {
        var lw = Math.max(32, String(e.label).length * 7.2 + 12);
        label = '<rect x="' + (mx - lw / 2) + '" y="' + (my - 11) + '" width="' + lw + '" height="20" rx="5" fill="#fff" stroke="#999" stroke-width="1"/>' +
          '<text x="' + mx + '" y="' + (my + 4) + '" font-size="12" font-weight="700" text-anchor="middle" fill="#222">' + esc(e.label) + '</text>';
      }
      return '<line x1="' + p1.x + '" y1="' + p1.y + '" x2="' + p2.x + '" y2="' + p2.y + '" stroke="#333" stroke-width="2" marker-end="url(#diagArrow)"/>' + label;
    }).join("");
    var nodesSvg = nodes.map(function (n) {
      var palette = DIAGRAM_COLORS[n.color] || DIAGRAM_COLORS.gris;
      var ty = n._y + PAD_Y + FONT * 0.8;
      var lines = n._lines.map(function (l, idx) { return '<tspan x="' + n._cx + '" dy="' + (idx === 0 ? 0 : LINE_H) + '">' + esc(l) + '</tspan>'; }).join("");
      var subSvg = "";
      if (n._subLines.length) {
        var subY = ty + (n._lines.length - 1) * LINE_H + LINE_H / 2 + SUB_GAP + SUBFONT * 0.7;
        var subLines = n._subLines.map(function (l, idx) { return '<tspan x="' + n._cx + '" dy="' + (idx === 0 ? 0 : SUB_LINE_H) + '">' + esc(l) + '</tspan>'; }).join("");
        subSvg = '<text x="' + n._cx + '" y="' + subY + '" font-size="' + SUBFONT + '" text-anchor="middle" fill="' + palette.text + '" opacity="0.92">' + subLines + '</text>';
      }
      return '<rect x="' + n._x + '" y="' + n._y + '" width="' + n._w + '" height="' + n._h + '" rx="10" fill="' + palette.fill + '"/>' +
        '<text x="' + n._cx + '" y="' + ty + '" font-size="' + FONT + '" font-weight="700" text-anchor="middle" fill="' + palette.text + '">' + lines + '</text>' + subSvg;
    }).join("");
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>' +
      '<defs><marker id="diagArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#333"/></marker></defs>' +
      edgesSvg + nodesSvg + '</svg>';
  }
  var DIAGRAM_NODE_SCHEMA = {
    type: "object",
    properties: {
      id: { type: "string", description: "Identifiant court unique (ex. \"masse\"), réutilisé tel quel dans \"diagramEdges\"." },
      label: { type: "string", description: "Texte principal de la boîte, COURT (2-5 mots max)." },
      sublabel: { type: "string", description: "Texte secondaire optionnel sous le label (ex. une formule écrite en toutes lettres, JAMAIS de LaTeX/symbole brut) — chaîne vide si inutile." },
      col: { type: "integer", description: "Colonne de la boîte dans une grille (0, 1, 2...) : détermine sa position horizontale." },
      row: { type: "integer", description: "Ligne de la boîte dans une grille (0, 1, 2...) : détermine sa position verticale." },
      color: { type: "string", description: "Une seule couleur parmi : vert, bleu, jaune, orange, rose, violet, rouge, gris." }
    },
    required: ["id", "label", "sublabel", "col", "row", "color"]
  };
  var DIAGRAM_EDGE_SCHEMA = {
    type: "object",
    properties: {
      from: { type: "string", description: "id du nœud de départ." },
      to: { type: "string", description: "id du nœud d'arrivée." },
      label: { type: "string", description: "Texte très court optionnel sur la flèche (ex. une opération, en toutes lettres, jamais de LaTeX brut) — chaîne vide si inutile." }
    },
    required: ["from", "to", "label"]
  };
  var SCHEMA_SVG_SCHEMA = {
    type: "object",
    properties: {
      figureType: { type: "string", description: "'diagram' si ce schéma peut se représenter avec des boîtes de texte reliées par des flèches (cycle, processus, classification, relations entre notions/grandeurs/formules — LE CAS LE PLUS FRÉQUENT, à choisir PAR DÉFAUT) : BEAUCOUP plus fiable visuellement, résultat garanti sans chevauchement. 'svg' UNIQUEMENT si c'est vraiment impossible à représenter avec des boîtes/flèches (une figure géométrique avec angles/mesures précises, une courbe/un graphique, une carte, une coupe anatomique détaillée)." },
      diagramNodes: { type: "array", description: "Si figureType = 'diagram' : la liste des boîtes du schéma. Pense la disposition comme une grille simple (2-4 colonnes, 1-3 lignes suffisent presque toujours) qui reflète la logique du schéma (ex. une boîte centrale avec les autres autour). Tableau vide si figureType = 'svg'.", items: DIAGRAM_NODE_SCHEMA },
      diagramEdges: { type: "array", description: "Si figureType = 'diagram' : les flèches entre boîtes. Tableau vide si figureType = 'svg' ou s'il n'y a aucune flèche.", items: DIAGRAM_EDGE_SCHEMA },
      svg: { type: "string", description: "Si figureType = 'svg' UNIQUEMENT : SVG autonome et complet (une seule balise <svg viewBox=\"0 0 W H\">...</svg>, sans dépendance externe), fidèle à la description et à la référence trouvée sur internet fournies ci-dessus — fond blanc plein cadre, traits/textes en noir ou en couleurs vives et contrastées, légendes/graduations/valeurs précises, qualité soignée sans chevauchement. Chaîne vide si figureType = 'diagram'." }
    },
    required: ["figureType", "diagramNodes", "diagramEdges", "svg"]
  };
  function buildSchemaResearchPrompt(caption, description, subjectName, chapterName) {
    return "Je prépare une fiche de révision scolaire (matière : " + subjectName + ", chapitre : " + chapterName + ") et j'ai besoin d'un schéma intitulé « " + caption + " ».\n\n" +
      "Ce que ce schéma doit représenter : " + description + "\n\n" +
      "Cherche sur internet à quoi ressemble VRAIMENT ce schéma dans des manuels scolaires, cours en ligne ou sites pédagogiques de référence pour ce niveau. Décris-moi ensuite précisément, en français et en détail, sa structure réelle telle qu'on la trouve habituellement : quels éléments y figurent, comment ils sont disposés les uns par rapport aux autres (positions relatives : à gauche/à droite, en haut/en bas, à l'intérieur de...), quelles sont les flèches/liaisons entre eux et leur sens exact, et les légendes/valeurs précises qui y apparaissent. Je dois pouvoir redessiner ce schéma fidèlement rien qu'à partir de ta description : sois concret et structuré, pas de généralités.";
  }
  function buildSchemaSvgPrompt(caption, description, researchText) {
    return "Prépare le schéma de cours intitulé « " + caption + " ».\n\n" +
      "Ce qu'il doit représenter : " + description + "\n\n" +
      (researchText ? "Voici une description de la structure réelle de ce schéma telle qu'on la trouve dans des sources pédagogiques (recherchée sur internet juste avant) — base-toi fidèlement sur CETTE structure, ces éléments et leur disposition, ne l'improvise pas différemment :\n\n" + researchText + "\n\n" : "") +
      "Réponds uniquement en respectant le schéma JSON fourni.";
  }
  function resolveSchemaVisualSvg(data) {
    if (data.figureType === "svg" && data.svg) return data.svg;
    return renderDiagramSvg(data.diagramNodes, data.diagramEdges);
  }
  function generateRevisionSheetSchemaSvg(caption, description, subjectName, chapterName) {
    return callGeminiSearch([{ text: buildSchemaResearchPrompt(caption, description, subjectName, chapterName) }])
      .then(function (res) { return res.text; })
      .catch(function () { return ""; })
      .then(function (researchText) {
        var parts = [{ text: buildSchemaSvgPrompt(caption, description, researchText) }];
        return callGemini(parts, SCHEMA_SVG_SCHEMA);
      })
      .then(function (data) { return resolveSchemaVisualSvg(data); });
  }
  function runRevisionSheetGeneration(sheet, courses, subjectName, chapterName) {
    sheet.status = "processing";
    sheet.error = null;
    saveDB(); render();
    generateRevisionSheetContent(courses, sheet.title, subjectName, chapterName, sheet.scope).then(function (data) {
      var content = data.content || "";
      var pending = (data.schemas || []).filter(function (sc) { return sc.placeholder && sc.description; });
      var schemas = [];
      function next(i) {
        if (i >= pending.length) {
          sheet.content = content;
          sheet.schemas = schemas;
          sheet.status = "ready";
          saveDB();
          toast("Fiche générée · " + sheet.title);
          render();
          return;
        }
        var sc = pending[i];
        generateRevisionSheetSchemaSvg(sc.caption || "", sc.description, subjectName, chapterName).then(function (svg) {
          if (svg) {
            var sid = uid();
            schemas.push({ id: sid, svg: svg, caption: sc.caption || "" });
            content = content.split(sc.placeholder).join("![" + String(sc.caption || "").replace(/[[\]]/g, "") + "](schema:" + sid + ")");
          } else {
            content = content.split(sc.placeholder).join("");
          }
        }).catch(function () {
          content = content.split(sc.placeholder).join("");
        }).then(function () { next(i + 1); });
      }
      next(0);
    }).catch(function (err) {
      sheet.status = "error";
      sheet.error = err.message || "Erreur inconnue";
      sheet.errorStatus = err.status || null;
      sheet.errorDetail = err.detail || null;
      saveDB();
      toast("Échec de la génération : " + sheet.error, { status: sheet.errorStatus, detail: sheet.errorDetail });
      render();
    });
  }

  /* ---------------- Podcast (un vieux conteur raconte le cours en audio) ----------------
     Deux générations distinctes et bien séparées : un texte (le script à lire, un vrai récit engageant
     plutôt qu'une récitation, fidèle et exhaustif par rapport au cours) PUIS un audio (synthèse vocale
     à partir de ce script). Les sous-titres sont calés sur la durée réelle de l'audio en répartissant
     chaque phrase proportionnellement à sa longueur — pas d'horodatage mot-à-mot fourni par l'API, mais
     une approximation largement suffisante pour suivre à l'oreille. */
  var PODCAST_DIR = "assets/objects/vieux papi/";
  var PODCAST_ATTEND_IMGS = ["PapiAttend.png", "PapiAttend2.png", "PapiAttend3.png", "PapiAttend4.png"];
  var PODCAST_EXPLIQUE_IMGS = ["PapiExplique.png", "PapiExplique2.png", "PapiExplique3.png", "PapiExplique4.png", "PapiExplique5.png", "PapiExplique6.png"];
  var PODCAST_LIS_IMG = "PapiLis.png";
  var GEMINI_TTS_MODELS = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"];
  var PODCAST_VOICE = "Algenib"; // voix masculine "gravelly" du catalogue Gemini — colle au personnage du vieux conteur

  function podcastData() { return userData().podcasts; }
  function podcastFind(id) { return podcastData().find(function (p) { return p.id === id; }); }

  var PODCAST_SCRIPT_SCHEMA = {
    type: "object",
    properties: {
      notionCount: { type: "integer", description: "Compte D'ABORD, une par une, le nombre de notions/sous-thèmes distincts du cours qu'il faut couvrir en profondeur. Ce chiffre doit être rempli AVANT de décider du nombre de parties — ne décide jamais le nombre de parties avant d'avoir fait ce compte." },
      estimatedTotalWords: { type: "integer", description: "Estimation du nombre total de mots nécessaires pour couvrir TOUTES ces notions en vraie profondeur (repère : une notion correctement expliquée avec contexte + exemple + lien avec les autres prend typiquement 150 à 400 mots à elle seule, parfois bien plus pour une formule/méthode). Calcule ce total AVANT de décider du nombre de parties : c'est ce chiffre, pas une intuition, qui détermine combien de parties il faut (voir consigne sur le nombre de parties)." },
      parts: {
        type: "array",
        description: "Toi seul décides du nombre d'éléments, et ce nombre doit être arithmétiquement cohérent avec estimatedTotalWords (environ estimatedTotalWords / 3000 parties, arrondi au-dessus) — jamais imposé par l'élève, et jamais une habitude comme \"2 parties\" sans rapport avec le calcul fait ci-dessus.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Titre court et accrocheur de cette partie du podcast." },
            script: { type: "string", description: "Texte intégral à lire à voix haute par le narrateur, en français courant, SANS aucune balise, markdown, puce ou didascalie entre parenthèses — uniquement les phrases parlées telles qu'elles doivent être prononcées, prêtes à être envoyées telles quelles à une synthèse vocale." }
          },
          required: ["title", "script"]
        }
      }
    },
    required: ["notionCount", "estimatedTotalWords", "parts"]
  };
  function buildPodcastScriptPrompt(subjectName, scopeName, scopeLevel, content, retryReason) {
    var gender = getUserGender();
    var genderNote = gender === "m"
      ? "L'élève qui t'écoute est un garçon : si tu t'adresses directement à lui (une interpellation affectueuse, pas à chaque phrase), utilise des formulations masculines (\"mon petit\", \"mon grand\", \"jeune homme\"), jamais féminines."
      : gender === "f"
      ? "L'élève qui t'écoute est une fille : si tu t'adresses directement à elle (une interpellation affectueuse, pas à chaque phrase), utilise des formulations féminines (\"ma petite\", \"ma grande\", \"jeune demoiselle\"), jamais masculines."
      : "Tu ne connais pas le genre de l'élève qui t'écoute : si tu t'adresses directement à lui/elle, utilise des formulations neutres (\"mon enfant\", \"jeune ami\", \"toi qui m'écoutes\") plutôt qu'un terme genré.";
    return "Tu es un vieux conteur chevronné : un ancien professeur devenu archéologue sur le tard, aussi chaleureux et bienveillant qu'un grand-père mais PAS un grand-père de famille — un vieux savant plein d'anecdotes de terrain qui adore raconter des histoires pour transmettre son savoir à un jeune élève qui l'écoute en podcast. Voici le cours (matière : " + subjectName + ", " + (scopeLevel === "theme" ? "thème" : "chapitre") + " : " + scopeName + ") à partir duquel tu dois créer ce podcast.\n\n" +
      "Règles absolues :\n" +
      "- " + genderNote + "\n" +
      "- Base-toi UNIQUEMENT sur le contenu du cours fourni ci-dessous : n'invente, ne déforme et n'ajoute AUCUN fait, date, chiffre, nom ou notion qui n'y figure pas. Tout ce que tu racontes doit rester rigoureusement exact par rapport à ce cours précis.\n" +
      "- Couvre l'INTÉGRALITÉ du contenu du cours, sans rien oublier ni laisser de côté — chaque notion, définition, date, formule ou règle du cours doit se retrouver quelque part dans le podcast.\n" +
      "- Ce n'est PAS une récitation : ne lis pas le cours tel quel et ne te contente pas de l'énoncer dans l'ordre. Transforme-le en un vrai récit engageant et vivant — raconte, pose des questions rhétoriques, utilise des images et des comparaisons parlantes, varie le ton, crée un peu de curiosité ou de suspense avant de révéler une notion — comme un grand-père passionnant qui sait captiver, jamais comme un robot qui réciterait une liste. Ne te contente JAMAIS de mentionner une notion en une seule phrase rapide : prends le temps de vraiment l'expliquer en profondeur — le contexte, le \"pourquoi\" et pas seulement le \"quoi\", un exemple concret, une comparaison parlante, le lien avec ce qui précède — avant de passer à la suivante.\n" +
      "- STRUCTURE NARRATIVE OBLIGATOIRE — le piège le plus fréquent, à éviter à tout prix : garder le même déroulé que le cours (les mêmes sections, dans le même ordre, juste reformulées avec un ton de conteur). Ça reste de la récitation déguisée même si chaque phrase individuelle est bien écrite, et c'est un ÉCHEC. Un vrai conteur NE SUIT PAS le plan du cours : il part d'une accroche, d'une question, d'une scène ou d'une énigme, puis tisse les notions ENSEMBLE au fil d'un vrai fil narratif (une enquête à résoudre, une question qui trouve sa réponse petit à petit, un voyage, un fil conducteur qui revient régulièrement), quitte à aller et venir entre les notions plutôt que de les aligner une par une dans l'ordre où le cours les présente. Teste-toi avant de répondre : si on pouvait reconnaître le sommaire du cours juste en lisant l'ordre de ton script, c'est raté, recommence la structure. Chaque passage d'une notion à une autre doit être un vrai lien de sens (parce que..., ce qui explique..., ce qui nous amène à...), jamais une simple transition d'étape du type \"passons maintenant à...\" ou \"ensuite, parlons de...\".\n" +
      "- PRÉCISION CONCRÈTE OBLIGATOIRE, règle à prendre très au sérieux : dès que le cours mentionne un élément nommé et identifiable — une expérience scientifique, un événement historique, une loi, un texte ou traité, une découverte, un personnage, une technique, un processus... — tu dois TOUJOURS raconter CE QUE C'EST CONCRÈTEMENT, pas seulement son nom ou sa conclusion. Exemples de ce qu'il NE FAUT JAMAIS faire : dire \"une expérience a permis de démontrer que...\" sans raconter en quoi consistait cette expérience (qui l'a menée, sur quoi, comment, ce qui a été observé) ; dire \"tel événement a marqué un tournant...\" sans raconter ce qui s'est concrètement passé pendant cet événement. Si le cours source donne ce détail concret, raconte-le fidèlement et en profondeur ; si le cours source NE donne PAS ce détail (juste le nom et la conclusion), dis-le explicitement à l'élève plutôt que de glisser dessus en silence comme si de rien n'était (ex. \"le cours ne détaille pas comment cette expérience a été menée, mais on sait qu'elle a montré que...\") — n'invente JAMAIS un détail qui ne figure pas dans le cours. La précision prime toujours sur la longueur : mieux vaut une partie plus longue mais qui explique vraiment chaque élément cité, qu'une partie qui enchaîne des noms et des conclusions sans jamais s'arrêter dessus.\n" +
      "- MATIÈRES AVEC FORMULES/MÉTHODES DE CALCUL (maths, physique-chimie, et toute matière avec des démarches techniques) : c'est le cas où un conteur a le plus tendance à bâcler, parce qu'une formule semble \"aride\" à raconter — c'est une erreur, le raisonnement EST le récit. Pour CHAQUE formule/méthode du cours : raconte D'OÙ elle vient (sa logique, sa démonstration si le cours la donne, sinon au moins l'intuition de pourquoi elle marche), explique CE QUE représente concrètement chaque terme/symbole, QUAND et POURQUOI on s'en sert plutôt que d'une autre, puis déroule à voix haute UN SEUL exemple d'application chiffré, pas à pas, bien choisi et détaillé du début à la fin. Un seul exemple bien expliqué vaut infiniment mieux que plusieurs exemples expédiés — ne multiplie JAMAIS les exemples juste pour faire du volume, ce serait du remplissage inutile, pas de la pédagogie. L'objectif est que l'élève ressorte capable de réellement APPLIQUER la méthode lui-même à un contrôle, pas d'avoir juste entendu son nom passer.\n" +
      "- DURÉE par partie : entre 1600 et 3500 mots (à l'oral, environ 10 à 22 minutes) — c'est un PLANCHER STRICT, pas un objectif approximatif : une partie de moins de 1600 mots (par exemple une partie d'1 minute) est un ÉCHEC CRITIQUE, quelle que soit la matière, y compris en maths/physique-chimie où le réflexe fautif est d'aller trop vite sur les formules. Pas de plafond strict non plus : si vraiment détailler précisément chaque élément du cours (voir règles de précision et de formules ci-dessus) demande d'aller au-delà de 3500 mots pour une partie donnée, ne sacrifie JAMAIS la précision pour respecter ce chiffre. Si le contenu du cours semble court, ne raccourcis JAMAIS le podcast pour autant : développe chaque notion bien plus en profondeur (contexte, exemples, implications, reformulations, liens entre les notions) plutôt que de rester en surface — mais sans padding artificiel ni exemples répétés juste pour gonfler le compte de mots, la profondeur doit rester utile à la compréhension. Avant de répondre, vérifie mentalement : est-ce que CHAQUE partie dépasse bien 1600 mots ? Si une partie est clairement plus courte que les autres, c'est le signe qu'elle a été bâclée — reprends-la. Un podcast de 2-3 minutes qui survole le cours est un ÉCHEC total, même s'il est exact et complet sur le papier — l'élève doit ressortir prêt pour un contrôle sur cette matière, pas avec un simple aperçu.\n" +
      "- NOMBRE DE PARTIES — PROCÉDURE OBLIGATOIRE, ne saute aucune étape : un biais fréquent est de retomber par habitude sur un nombre \"qui sonne bien\" (souvent 2) sans vraiment calculer, même avec la consigne \"aucune limite\" — pour éviter ça, tu DOIS calculer avant de décider. Étape 1 : remplis \"notionCount\" en comptant une par une les notions/sous-thèmes distincts du cours. Étape 2 : remplis \"estimatedTotalWords\" en estimant le nombre de mots nécessaires pour toutes les couvrir en vraie profondeur (150 à 400 mots par notion simple, bien plus pour une formule/méthode à expliquer avec un exemple). Étape 3 : SEULEMENT APRÈS avoir rempli ces deux chiffres, déduis le nombre de parties par le calcul estimatedTotalWords / 3000 (arrondi au-dessus) — PAS par intuition. Il N'Y A AUCUNE LIMITE HAUTE — ni 2, ni 3, ni 5 : si le calcul donne 7 parties, fais 7 parties, ne te bride jamais en pensant qu'un podcast \"a déjà assez de parties\". Si le calcul donne 1 (tout tient dans 1600-3500 mots en profondeur), fais UNE SEULE partie — ne découpe JAMAIS artificiellement. Chaque partie respecte elle-même la fourchette de 1600 à 3500 mots, sans chevauchement ni répétition d'une partie à l'autre, et sans rien oublier au global.\n" +
      "- Le \"script\" de chaque partie est le texte EXACT à lire à voix haute : uniquement des phrases parlées naturelles, aucun titre, aucune puce, aucun markdown, aucune parenthèse de mise en scène — seulement ce que le narrateur dit, du début à la fin.\n" +
      "- Commence chaque partie par une accroche qui donne envie d'écouter, et termine par une petite conclusion qui boucle le sujet de cette partie (ou du podcast entier s'il n'y a qu'une seule partie).\n" +
      "- INTERDIT ABSOLU : aucune notation LaTeX, aucun symbole mathématique brut ($, ^, _, \\frac, °, %, =, ×...) ni aucune abréviation qui se prononcerait mal lue telle quelle — une synthèse vocale va lire ce texte MOT POUR MOT. Écris TOUT en toutes lettres, exactement comme un professeur le dirait à voix haute : \"2^3\" devient \"deux puissance trois\", \"H2O\" devient \"H deux O\" dit \"aitch deux o\" ou plus naturellement \"eau\", \"50%\" devient \"cinquante pour cent\", \"20°C\" devient \"vingt degrés Celsius\", \"=\" devient \"égale\", une fraction \"3/4\" devient \"trois quarts\". Fais cette conversion pour CHAQUE formule, unité ou nombre technique du cours, sans exception.\n" +
      "- Respecte une orthographe française irréprochable, avec tous les accents nécessaires (é, è, ê, à, ç, etc.) — la synthèse vocale prononce mal un mot mal accentué.\n\n" +
      (retryReason === "short" ? "[Note système — IMPORTANT : ta tentative précédente a produit au moins une partie BEAUCOUP trop courte (loin en dessous de 1600 mots, parfois à peine 1 minute à l'oral) — c'est un échec strict de la consigne de durée. Cette fois, développe réellement CHAQUE notion en profondeur (surtout les formules/méthodes si la matière en a) jusqu'à dépasser 1600 mots sur CHAQUE partie, quitte à prendre plus de temps par explication. Ne recommence pas la même erreur.]\n\n" : "") +
      (retryReason === "partcount" ? "[Note système — IMPORTANT : ta tentative précédente a toi-même estimé qu'il fallait plus de mots au total que ce que tu as réellement écrit dans \"parts\" — autrement dit tu as sous-estimé le nombre de parties nécessaires par rapport à ton propre calcul. Cette fois, suis VRAIMENT la procédure : compte notionCount, calcule estimatedTotalWords, puis fixe le nombre de parties sur ce calcul (estimatedTotalWords / 3000, arrondi au-dessus) sans te brider par habitude. Ne recommence pas la même erreur.]\n\n" : "") +
      "Voici le cours :\n\n" + content + "\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni, en français.";
  }
  function podcastScriptWordCount(script) {
    return String(script || "").trim().split(/\s+/).filter(Boolean).length;
  }
  // Filet de sécurité côté code, pas seulement une consigne de prompt : si au moins une partie générée
  // est manifestement trop courte (bien en dessous du plancher de 1600 mots demandé), OU si l'IA a
  // elle-même estimé qu'il fallait plus de mots que ce qu'elle a réellement écrit (donc qu'elle s'est
  // bridée sur le nombre de parties malgré son propre calcul), on retente une fois avec une note d'échec
  // explicite plutôt que d'accepter silencieusement un podcast trop court.
  function generatePodcastScript(subjectName, scopeName, scopeLevel, content, attempt, retryReason) {
    attempt = attempt || 1;
    var parts = [{ text: buildPodcastScriptPrompt(subjectName, scopeName, scopeLevel, content, retryReason) }];
    // Un cours très riche peut légitimement nécessiter de nombreuses parties de plusieurs milliers de
    // mots chacune : une limite de sortie par défaut trop basse tronquerait la réponse en silence avant
    // que l'IA ait fini, donnant l'impression d'un plafond artificiel sur le nombre de parties.
    return callGemini(parts, PODCAST_SCRIPT_SCHEMA, 65536).then(function (data) {
      var scriptParts = (data.parts || []).filter(function (p) { return p && p.script; });
      var tooShort = scriptParts.some(function (p) { return podcastScriptWordCount(p.script) < 900; });
      var actualWords = scriptParts.reduce(function (sum, p) { return sum + podcastScriptWordCount(p.script); }, 0);
      var estimated = data.estimatedTotalWords || 0;
      // Marge large (60%) : on ne veut retenter que sur un écart franc, jamais sur un simple flou
      // d'estimation — le but est d'attraper le cas "l'IA a sous-livré par rapport à son propre calcul".
      var underDelivered = estimated > 3500 && actualWords < estimated * 0.6;
      if ((tooShort || underDelivered) && attempt < 2) {
        return generatePodcastScript(subjectName, scopeName, scopeLevel, content, attempt + 1, tooShort ? "short" : "partcount");
      }
      return data;
    });
  }

  // Convertit un buffer en base64 par blocs (plutôt que String.fromCharCode.apply(null, bytes) d'un
  // coup) pour ne pas dépasser la limite d'arguments d'un appel de fonction sur un gros fichier audio.
  function bytesToBase64(bytes) {
    var CHUNK = 0x8000;
    var parts = [];
    for (var i = 0; i < bytes.length; i += CHUNK) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
    }
    return btoa(parts.join(""));
  }
  // La synthèse vocale Gemini renvoie souvent du PCM 16 bits brut (sans en-tête), pas un vrai fichier
  // .wav directement lisible par <audio> — on reconstruit l'en-tête WAV nous-mêmes autour des octets
  // reçus si le mimeType annoncé n'est pas déjà un vrai conteneur wav.
  function pcmBase64ToWavDataUrl(base64Pcm, sampleRate) {
    sampleRate = sampleRate || 24000;
    var binary = atob(base64Pcm);
    var len = binary.length;
    var pcm = new Uint8Array(len);
    for (var i = 0; i < len; i++) pcm[i] = binary.charCodeAt(i);
    var numChannels = 1, bitsPerSample = 16;
    var byteRate = sampleRate * numChannels * bitsPerSample / 8;
    var blockAlign = numChannels * bitsPerSample / 8;
    var buffer = new ArrayBuffer(44 + len);
    var view = new DataView(buffer);
    function writeStr(offset, str) { for (var j = 0; j < str.length; j++) view.setUint8(offset + j, str.charCodeAt(j)); }
    writeStr(0, "RIFF"); view.setUint32(4, 36 + len, true); writeStr(8, "WAVE");
    writeStr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true); view.setUint16(32, blockAlign, true); view.setUint16(34, bitsPerSample, true);
    writeStr(36, "data"); view.setUint32(40, len, true);
    new Uint8Array(buffer, 44).set(pcm);
    return "data:audio/wav;base64," + bytesToBase64(new Uint8Array(buffer));
  }
  function buildPodcastTtsBody(script, voiceName) {
    return JSON.stringify({
      contents: [{ role: "user", parts: [{ text: script }] }],
      generationConfig: {
        response_modalities: ["AUDIO"],
        speech_config: { voice_config: { prebuilt_voice_config: { voice_name: voiceName } } }
      }
    });
  }
  async function attemptTtsWithKey(apiKey, script, voiceName) {
    var lastErr = null;
    for (var i = 0; i < GEMINI_TTS_MODELS.length; i++) {
      var endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_TTS_MODELS[i] + ":generateContent";
      var res;
      try {
        res = await fetchWithTimeout(endpoint + "?key=" + encodeURIComponent(apiKey), { method: "POST", headers: { "content-type": "application/json" }, body: buildPodcastTtsBody(script, voiceName) }, 120000);
      } catch (netErr) {
        lastErr = new Error("Connexion impossible pour générer l'audio.");
        lastErr.detail = String(netErr);
        continue;
      }
      if (res.ok) {
        var data = await res.json();
        var cand = data.candidates && data.candidates[0];
        var p = cand && cand.content && cand.content.parts && cand.content.parts[0];
        var inline = p && p.inlineData;
        if (inline && inline.data) {
          var mime = inline.mimeType || "";
          var rateMatch = /rate=(\d+)/.exec(mime);
          var sampleRate = rateMatch ? +rateMatch[1] : 24000;
          return /wav/i.test(mime) ? ("data:audio/wav;base64," + inline.data) : pcmBase64ToWavDataUrl(inline.data, sampleRate);
        }
        lastErr = new Error("Réponse audio vide de l'API.");
        lastErr.detail = "Modèle : " + GEMINI_TTS_MODELS[i] + "\n\n" + JSON.stringify(data, null, 2);
        continue;
      }
      var errBody = await res.json().catch(function () { return {}; });
      var msg = (errBody.error && errBody.error.message) || ("Erreur API Gemini (" + res.status + ")");
      var retryable = res.status === 503 || res.status === 429 || res.status === 404;
      lastErr = new Error(msg);
      lastErr.status = res.status;
      lastErr.detail = "Modèle : " + GEMINI_TTS_MODELS[i] + "\n\n" + JSON.stringify(errBody, null, 2);
      if (!retryable) throw lastErr;
    }
    throw lastErr || new Error("Erreur inconnue lors de la génération audio.");
  }
  async function generatePodcastAudio(script, voiceName) {
    var primaryKey = getApiKey();
    if (!primaryKey) { var e = new Error("Ajoute ta clé API Gemini dans les paramètres avant de continuer."); e.code = "NO_API_KEY"; throw e; }
    try {
      return await attemptTtsWithKey(primaryKey, script, voiceName);
    } catch (err1) {
      var backupKey = getBackupApiKey();
      if (!backupKey) throw err1;
      try { return await attemptTtsWithKey(backupKey, script, voiceName); }
      catch (err2) { throw err1; }
    }
  }
  // Découpe sur la ponctuation forte (.!?) ET sur les virgules/points-virgules/deux-points : des
  // segments plus courts et plus nombreux limitent l'accumulation de dérive sur un long podcast (une
  // erreur d'estimation sur une seule grosse phrase pesait lourd ; répartie sur plusieurs petits
  // segments, chaque erreur reste petite et le sous-titre "rattrape" son retard plus souvent).
  function splitScriptIntoSentences(script) {
    var raw = String(script || "").replace(/\s+/g, " ").trim();
    var sentences = raw.match(/[^.!?,;:]+[.!?,;:]*(\s+|$)/g) || (raw ? [raw] : []);
    return sentences.map(function (s) { return s.trim(); }).filter(Boolean);
  }
  // Une pause après une virgule/un point-virgule est naturellement plus courte qu'une pause en fin de
  // phrase complète — distinguer les deux rapproche un peu plus l'estimation du rythme réel du narrateur.
  function podcastPauseAfter(s) {
    var last = s.charAt(s.length - 1);
    return (last === "," || last === ";" || last === ":") ? 0.14 : 0.3;
  }
  // Pas d'horodatage mot-à-mot fourni par l'API TTS : on approxime le minutage de chaque segment sur la
  // durée réelle de l'audio généré, au NOMBRE DE MOTS plutôt qu'au nombre de caractères (une phrase
  // pleine de mots courts prend un temps très différent d'une phrase avec un seul mot très long, alors
  // que les deux peuvent avoir la même longueur en caractères) + une pause estimée entre chaque segment.
  function buildPodcastSegments(script, durationSec) {
    var sentences = splitScriptIntoSentences(script);
    if (!sentences.length || !durationSec) return [];
    var wordCounts = sentences.map(function (s) { return (s.match(/\S+/g) || []).length || 1; });
    var totalWords = wordCounts.reduce(function (a, b) { return a + b; }, 0) || 1;
    var pauses = sentences.map(function (s, i) { return i < sentences.length - 1 ? podcastPauseAfter(s) : 0; });
    var totalPause = pauses.reduce(function (a, b) { return a + b; }, 0);
    var speakableDuration = Math.max(durationSec * 0.5, durationSec - totalPause);
    var t = 0;
    return sentences.map(function (s, i) {
      var share = wordCounts[i] / totalWords * speakableDuration;
      var seg = { start: t, end: t + share, text: s };
      t += share + pauses[i];
      return seg;
    });
  }
  function audioDurationFromDataUrl(url) {
    return new Promise(function (resolve) {
      var a = new Audio();
      a.preload = "metadata";
      a.onloadedmetadata = function () { resolve(isFinite(a.duration) ? a.duration : 0); };
      a.onerror = function () { resolve(0); };
      a.src = url;
    });
  }
  // Téléchargement en MP3 : l'audio généré est stocké en WAV (PCM brut, énorme — un podcast de 20 min
  // pèse des dizaines de Mo), peu pratique à garder/partager hors de l'appli. On relit nous-mêmes les
  // chunks du conteneur WAV qu'on a construit (cf. pcmBase64ToWavDataUrl) pour en extraire le PCM 16
  // bits brut, puis on l'encode en MP3 entièrement côté navigateur avec lamejs (aucun serveur).
  function parseWavPcm16(dataUrl) {
    var base64 = (dataUrl.split(",")[1] || "");
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    var view = new DataView(bytes.buffer);
    var sampleRate = 24000, numChannels = 1, dataOffset = -1, dataLength = 0;
    var pos = 12; // passe "RIFF" + taille (4) + "WAVE"
    while (pos + 8 <= bytes.length) {
      var id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
      var size = view.getUint32(pos + 4, true);
      if (id === "fmt ") { numChannels = view.getUint16(pos + 10, true); sampleRate = view.getUint32(pos + 12, true); }
      else if (id === "data") { dataOffset = pos + 8; dataLength = size; }
      pos += 8 + size + (size % 2);
    }
    if (dataOffset < 0) throw new Error("Fichier audio invalide (chunk WAV introuvable).");
    var sampleCount = Math.floor(dataLength / 2);
    var samples = new Int16Array(sampleCount);
    for (var s = 0; s < sampleCount; s++) samples[s] = view.getInt16(dataOffset + s * 2, true);
    return { sampleRate: sampleRate, numChannels: numChannels || 1, samples: samples };
  }
  function pcm16ToMp3Blob(samples, sampleRate, numChannels) {
    var encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, 128);
    var chunkSize = 1152;
    var chunks = [];
    for (var i = 0; i < samples.length; i += chunkSize) {
      var buf = encoder.encodeBuffer(samples.subarray(i, i + chunkSize));
      if (buf.length > 0) chunks.push(buf);
    }
    var end = encoder.flush();
    if (end.length > 0) chunks.push(end);
    return new Blob(chunks, { type: "audio/mpeg" });
  }
  function triggerBlobDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  // Fusionne le PCM de plusieurs parties (déjà triées par partIndex) bout à bout avant un seul encodage
  // MP3 — un podcast en 3 parties de 3 min donne ainsi un unique fichier de 9 min, pas 3 fichiers séparés.
  function mergePodcastPartsToMp3Blob(parts) {
    var wavs = parts.map(function (p) { return parseWavPcm16(p.audioUrl); });
    var sampleRate = wavs[0].sampleRate, numChannels = wavs[0].numChannels;
    var totalLen = wavs.reduce(function (sum, w) { return sum + w.samples.length; }, 0);
    var merged = new Int16Array(totalLen);
    var offset = 0;
    wavs.forEach(function (w) { merged.set(w.samples, offset); offset += w.samples.length; });
    return pcm16ToMp3Blob(merged, sampleRate, numChannels);
  }
  // C'est l'IA qui décide du nombre de parties (voir buildPodcastScriptPrompt), pas l'élève — on ne
  // sait donc PAS combien il y en aura avant d'avoir la réponse. "podcast" est la SEULE entrée déjà
  // créée/affichée (part 1 par défaut) ; si l'IA renvoie plusieurs parties, les suivantes sont créées
  // ici dynamiquement et ajoutées à la bibliothèque. L'audio de chaque partie se génère ensuite l'une
  // après l'autre (pas en parallèle, pour rester raisonnable côté quota) — chaque partie passe "ready"
  // dès que SON audio est prêt, sans attendre les autres.
  function runPodcastGeneration(podcast, subjectName, scopeName, content) {
    podcast.status = "processing";
    saveDB(); render();
    var scopeLevel = podcast.scopeLevel || "chapter";
    generatePodcastScript(subjectName, scopeName, scopeLevel, content).then(function (data) {
      var scriptParts = (data.parts || []).filter(function (p) { return p && p.script; });
      if (!scriptParts.length) {
        podcast.status = "error";
        podcast.error = "Aucun script généré.";
        saveDB(); render();
        return;
      }
      var total = scriptParts.length;
      var pods = [podcast];
      for (var k = 1; k < total; k++) {
        var extra = {
          id: uid(), groupId: podcast.groupId, title: "",
          subjectId: podcast.subjectId, subjectName: podcast.subjectName,
          scopeLevel: podcast.scopeLevel, scopeId: podcast.scopeId, scopeName: podcast.scopeName,
          partIndex: k + 1, partCount: total,
          status: "processing", error: null, errorStatus: null, errorDetail: null,
          script: "", segments: [], audioUrl: "", durationSec: 0, createdAt: Date.now() + k
        };
        podcastData().push(extra);
        pods.push(extra);
      }
      podcast.partIndex = 1;
      podcast.partCount = total;
      saveDB(); render();
      var runOne = function (i) {
        if (i >= pods.length) return;
        var pod = pods[i];
        var sp = scriptParts[i];
        pod.title = sp.title || scopeName;
        pod.script = sp.script;
        generatePodcastAudio(sp.script, PODCAST_VOICE).then(function (audioUrl) {
          return audioDurationFromDataUrl(audioUrl).then(function (duration) {
            pod.audioUrl = audioUrl;
            pod.durationSec = duration;
            pod.segments = buildPodcastSegments(sp.script, duration);
            pod.status = "ready";
            saveDB();
            toast("🎙️ " + pod.title + " est prêt");
            render();
          });
        }).catch(function (err) {
          pod.status = "error";
          pod.error = err.message || "Erreur inconnue";
          pod.errorStatus = err.status || null;
          pod.errorDetail = err.detail || null;
          saveDB(); render();
        }).then(function () { runOne(i + 1); });
      };
      runOne(0);
    }).catch(function (err) {
      podcast.status = "error";
      podcast.error = err.message || "Erreur inconnue";
      podcast.errorStatus = err.status || null;
      podcast.errorDetail = err.detail || null;
      saveDB();
      toast("Échec de la génération du podcast : " + (err.message || "erreur inconnue"), { status: err.status, detail: err.detail });
      render();
    });
  }
  // Une partie peut échouer uniquement à l'étape audio (le script, lui, a déjà été généré avec succès
  // et vit dans pod.script) : relancer toute la génération depuis runPodcastGeneration redécouperait le
  // script à neuf avec un nombre de parties potentiellement différent et écraserait l'index de CETTE
  // partie à 1, créant des doublons/conflits avec les autres parties déjà prêtes du même groupe. On ne
  // relance donc QUE l'audio, à partir du script déjà existant, sans toucher au reste du groupe.
  function retryPodcastPartAudio(pod) {
    pod.status = "processing";
    pod.error = null; pod.errorStatus = null; pod.errorDetail = null;
    saveDB(); render();
    generatePodcastAudio(pod.script, PODCAST_VOICE).then(function (audioUrl) {
      return audioDurationFromDataUrl(audioUrl).then(function (duration) {
        pod.audioUrl = audioUrl;
        pod.durationSec = duration;
        pod.segments = buildPodcastSegments(pod.script, duration);
        pod.status = "ready";
        saveDB();
        toast("🎙️ " + pod.title + " est prêt");
        render();
      });
    }).catch(function (err) {
      pod.status = "error";
      pod.error = err.message || "Erreur inconnue";
      pod.errorStatus = err.status || null;
      pod.errorDetail = err.detail || null;
      saveDB();
      toast("Échec de la génération audio : " + (err.message || "erreur inconnue"), { status: err.status, detail: err.detail });
      render();
    });
  }

  /* ---------------- Méthodologies (dissertation, commentaire, étude de document...) ----------------
     Contrairement à un cours "de connaissances", une méthodologie n'est pas un contenu à mémoriser
     question par question : c'est une PROCÉDURE à appliquer sur un sujet neuf à chaque fois. On la
     traite donc comme un contenu à part, qui génère des SUJETS D'ENTRAÎNEMENT (pas du quiz), notés
     comme une vraie copie plutôt que "correct/faux". */
  var METHODOLOGY_MECHANICS = ["plan", "redaction", "partie", "document", "courte", "traduction"];
  var METHODOLOGY_MECHANIC_LABELS = {
    plan: "Plan détaillé", redaction: "Rédaction complète", partie: "Partie ciblée (intro, transition, conclusion...)",
    document: "Analyse de document réel", courte: "Réponse développée courte", traduction: "Traduction"
  };
  // Toujours proposée en plus de ce que l'IA détecte : l'élève sait parfois mieux que l'IA sur quoi il
  // a besoin de s'entraîner précisément (une consigne inventée par son prof, une variante locale...).
  var METHODOLOGY_MECHANIC_CUSTOM = "autre";
  var METHODOLOGY_SCHEMA = {
    type: "object",
    properties: {
      genre: { type: "string", description: "Nom de l'épreuve tel que désigné dans le document (ex. \"Dissertation\", \"Commentaire de texte\", \"Question problématisée\", \"Étude de documents\"...) — reprends le terme utilisé par le document lui-même, ne l'invente pas." },
      mechanics: {
        type: "array", items: { type: "string", enum: METHODOLOGY_MECHANICS },
        description: "Parmi \"plan\" (plan détaillé sans rédiger), \"redaction\" (rédaction complète), \"partie\" (s'entraîner sur UNE partie précise et difficile isolément — introduction/problématique, transition, conclusion...), \"document\" (l'épreuve porte sur l'analyse d'un document/texte/source fourni), \"courte\" (réponse développée courte, sans plan formel — question de cours, question ouverte), \"traduction\" (traduire un passage) : coche TOUTES celles qui ont vraiment du sens pour ce genre d'épreuve, ne te limite pas à une seule par excès de prudence — une dissertation, une composition ou un développement construit se prêtent quasiment toujours À LA FOIS à \"plan\", \"redaction\" ET \"partie\" (ce sont 3 façons différentes et complémentaires de s'entraîner sur la même méthode, pas 3 méthodes concurrentes). Ne coche que ce qui n'a clairement aucun sens (ex. \"traduction\" pour une dissertation de philo)."
      },
      structure: { type: "string", description: "La méthode elle-même, en Markdown, à un niveau de détail ÉGAL à celui du document source — PAS un résumé condensé. Ce champ sert directement et intégralement de grille de correction : chaque étape attendue, chaque critère, chaque nuance, chaque exemple de formulation ou de tournure attendue mentionné dans le document doit s'y retrouver, dans le même niveau de détail. Si le document source fait plusieurs pages, ce champ doit lui aussi être long et détaillé (plusieurs sections en Markdown) — une seule phrase ou un seul paragraphe pour un document de plusieurs pages est un échec de ta part, jamais un résultat acceptable." },
      transcription: { type: "string", description: "Retranscription fidèle, complète et intégrale du document source, en Markdown structuré — même longueur d'information que l'original, rien de résumé ni d'omis." }
    },
    required: ["genre", "mechanics", "structure", "transcription"]
  };
  function buildMethodologyPrompt(title, imageCount) {
    // Pas de matière ici volontairement : une même méthode (dissertation, question problématisée...)
    // sert souvent pour plusieurs matières différentes (français ET histoire, par ex.) — la matière et
    // le chapitre ne sont choisis qu'au moment de s'entraîner, jamais figés à la création.
    var step1 = imageCount === 0
      ? "Aucun document n'a été fourni — l'élève n'a que le titre « " + title + " ». Rédige TOI-MÊME dans \"transcription\" une méthodologie standard, rigoureuse et complète pour ce type précis d'épreuve, telle qu'elle est réellement enseignée dans le système scolaire/universitaire français (mêmes attentes qu'un vrai prof : structure de l'introduction/problématique, du développement, de la conclusion, ou l'équivalent propre à ce genre) — pas une version vague ou générique, une vraie méthode utilisable telle quelle."
      : "Voici " + (imageCount > 1 ? imageCount + " photos d'" : "la photo d'") + "une méthodologie d'épreuve intitulée « " + title + " » fournie par le prof de l'élève — attention, ce n'est PAS un cours de connaissances, c'est un document qui explique COMMENT réussir un type d'épreuve précis (dissertation, commentaire, étude de document, etc.). Retranscris-la fidèlement dans \"transcription\" (ne la remplace jamais par une méthode générique : c'est CETTE méthode précise, celle du prof, qui doit servir de grille de correction).";
    return "Tu es un assistant pédagogique pour un élève francophone.\n\n" +
      "Règle importante : si un passage correspond mot pour mot à un texte déjà public sur internet (site pédagogique, manuel, etc.), REFORMULE-le avec des mots différents en gardant strictement le même sens et le même niveau de détail, plutôt que de le recopier tel quel — sinon la génération est bloquée automatiquement.\n\n" +
      "1. " + step1 + " Utilise du Markdown structuré (## et ### pour les titres, - pour les listes, ** pour le gras).\n" +
      "2. Identifie le \"genre\" exact de l'épreuve" + (imageCount === 0 ? " (reprends le titre donné par l'élève, reformulé proprement si besoin)" : ", en reprenant le terme utilisé dans le document lui-même") + ".\n" +
      "3. Extrais dans \"structure\" la méthode elle-même, EXHAUSTIVEMENT et SANS LA RÉSUMER : reprends chaque étape attendue, chaque exigence de chaque partie, chaque critère de réussite, chaque nuance ou exemple donné par le document, au même niveau de détail que le document source — ce champ sert TEL QUEL de grille de correction stricte pour noter les copies des élèves, donc toute exigence qui n'y figure pas sera tout simplement ignorée à la correction. Un document de plusieurs pages doit donner une \"structure\" longue et structurée en Markdown (plusieurs sections/sous-sections), jamais un paragraphe unique condensé — si tu hésites entre condenser et être exhaustif, choisis TOUJOURS l'exhaustivité.\n" +
      "4. Détermine dans \"mechanics\" tous les types d'entraînement qui ont du sens pour CETTE méthode précise (voir la description du champ).\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni, en français.";
  }
  function generateMethodologyContent(imageDataUrls, title) {
    var images = geminiImageParts(imageDataUrls);
    var parts = images.concat([{ text: buildMethodologyPrompt(title, images.length) }]);
    return callGemini(parts, METHODOLOGY_SCHEMA);
  }
  function runMethodologyGeneration(methodo) {
    methodo.status = "processing";
    methodo.error = null;
    saveDB(); render();
    generateMethodologyContent(methodo.images, methodo.title).then(function (data) {
      methodo.genre = data.genre || "Épreuve";
      methodo.mechanics = (data.mechanics || []).filter(function (m) { return METHODOLOGY_MECHANICS.indexOf(m) !== -1; });
      if (!methodo.mechanics.length) methodo.mechanics = ["redaction"];
      methodo.structure = data.structure || "";
      methodo.transcription = data.transcription || "";
      methodo.status = "ready";
      methodo.images = [];
      saveDB();
      toast("Méthodologie prête · " + methodo.title);
      render();
    }).catch(function (err) {
      methodo.status = "error";
      methodo.error = err.message || "Erreur inconnue";
      methodo.errorStatus = err.status || null;
      methodo.errorDetail = err.detail || null;
      saveDB();
      toast("Échec de la génération : " + methodo.error, { status: methodo.errorStatus, detail: methodo.errorDetail });
      render();
    });
  }

  // Sujet d'entraînement SANS document externe (plan / rédaction / réponse courte / traduction sans
  // support) — s'appuie uniquement sur le contenu réel du chapitre choisi, jamais sur des faits inventés.
  var METHODOLOGY_SUBJECT_SCHEMA = {
    type: "object",
    properties: {
      subject: { type: "string", description: "Le sujet/la consigne exacte proposée à l'élève, formulée dans le style d'un vrai sujet d'examen pour ce genre d'épreuve — pas une simple question de cours." },
      referencePlan: { type: "string", description: "Corrigé de référence en Markdown : un plan détaillé (parties, sous-parties, idées et exemples PRÉCIS tirés du chapitre fourni) qui répondrait parfaitement au sujet selon la méthode donnée. Sert uniquement de grille de correction, ne sera jamais montré à l'élève avant sa correction — ne le simplifie pas, il doit être complet et rigoureux." }
    },
    required: ["subject", "referencePlan"]
  };
  function buildMethodologySubjectPrompt(methodo, chapterName, chapterContent, mechanic, customInstruction) {
    var mechanicLabel = customInstruction
      ? "exactement ceci, demandé par l'élève lui-même : " + customInstruction
      : ({
        plan: "un plan détaillé uniquement (pas la rédaction complète)",
        redaction: "une rédaction complète",
        partie: "UNE seule partie précise et généralement difficile de la méthode (à toi de choisir laquelle — introduction/problématique, une transition clé, la conclusion...), jamais l'intégralité du devoir : indique CLAIREMENT dans le sujet quelle partie exactement est demandée",
        courte: "une réponse développée courte, sans plan formel"
      }[mechanic] || "une réponse complète");
    return "Voici la méthode de l'épreuve « " + methodo.genre + " » à suivre :\n\n" + methodo.structure + "\n\n" +
      "Voici le contenu du chapitre « " + chapterName + " » sur lequel doit porter l'épreuve (déjà étudié par l'élève) :\n\n" + stripFigureMarkdown(chapterContent).slice(0, 6000) + "\n\n" +
      "Génère UN sujet inédit, plausible pour un vrai contrôle sur ce chapitre, dans le style exact d'un sujet de « " + methodo.genre + " » — une vraie formulation d'examen, jamais une simple question de cours. L'élève devra y répondre avec " + mechanicLabel + ", en s'appuyant EXCLUSIVEMENT sur les connaissances réelles du chapitre fourni (dates, notions, auteurs, exemples déjà étudiés) : n'invente aucun fait, aucune date, aucun événement absent de ce chapitre.\n\n" +
      "Fournis aussi \"referencePlan\", un corrigé de référence complet et rigoureux (correspondant précisément à ce qui est demandé ci-dessus — ne corrige que la partie demandée si une seule partie est demandée) qui servira de grille de correction.\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni, en français.";
  }
  function generateMethodologySubject(methodo, chapterName, chapterContent, mechanic, customInstruction) {
    var parts = [{ text: buildMethodologySubjectPrompt(methodo, chapterName, chapterContent, mechanic, customInstruction) }];
    return callGemini(parts, METHODOLOGY_SUBJECT_SCHEMA);
  }

  // Sujet reposant sur un document RÉEL (analyse de document, commentaire, traduction) : un prof ne
  // réutilise jamais le document déjà vu en cours pour un entraînement (effet de surprise), donc on ne
  // pioche PAS dans les propres documents importés de l'élève, et on n'en fait SURTOUT PAS halluciner un
  // par l'IA — on utilise la recherche Google réelle (callGeminiSearch) pour en trouver un vrai, avec sa
  // source exacte, puis un second appel structuré pour le mettre en forme proprement.
  var METHODOLOGY_DOCUMENT_SCHEMA = {
    type: "object",
    properties: {
      excerpt: { type: "string", description: "L'extrait exact du document trouvé, reproduit fidèlement (pas de reformulation, pas de raccourci abusif)." },
      author: { type: "string" },
      sourceTitle: { type: "string" },
      date: { type: "string" },
      sourceUrl: { type: "string", description: "URL de la source la plus fiable parmi celles fournies — chaîne vide si aucune URL fiable n'est disponible plutôt que d'en inventer une." },
      consigne: { type: "string", description: "La consigne d'analyse à donner à l'élève, formulée dans le style attendu pour ce genre d'épreuve, portant précisément sur ce document." },
      referencePlan: { type: "string", description: "Corrigé de référence complet (analyse attendue du document, idées clés et éléments précis à relever) servant de grille de correction stricte." }
    },
    required: ["excerpt", "author", "sourceTitle", "date", "sourceUrl", "consigne", "referencePlan"]
  };
  function buildDocumentSearchPrompt(methodo, chapterName, chapterContent, subjectName) {
    return "Tu prépares un exercice de « " + methodo.genre + " » (matière : " + subjectName + ") pour un élève qui étudie le chapitre « " + chapterName + " ».\n\n" +
      "Contenu déjà étudié par l'élève sur ce chapitre (pour choisir un document du bon niveau, de la bonne période et de la bonne thématique) :\n\n" + stripFigureMarkdown(chapterContent).slice(0, 4000) + "\n\n" +
      "Utilise la recherche Google pour trouver un VRAI document en lien direct avec ce chapitre, adapté à un exercice de « " + methodo.genre + " » — un texte, un extrait, une source primaire ou secondaire réellement publiée quelque part (jamais un document que tu inventes ou reconstitues de mémoire sans le vérifier par la recherche). Ce document ne doit PAS être un texte déjà présent dans le contenu du chapitre ci-dessus (l'effet de surprise fait partie de l'exercice), mais doit rester cohérent avec ce que l'élève a étudié.\n\n" +
      "Dans ta réponse, donne clairement : le texte exact de l'extrait choisi (reproduis-le fidèlement, sans le reformuler), son auteur, son titre exact, sa date/origine précise, et l'URL de la page où tu l'as trouvé.";
  }
  function searchRealDocument(methodo, chapterName, chapterContent, subjectName) {
    var parts = [{ text: buildDocumentSearchPrompt(methodo, chapterName, chapterContent, subjectName) }];
    return callGeminiSearch(parts);
  }
  function buildDocumentStructurePrompt(methodo, rawSearchResult, sources) {
    var sourcesTxt = sources.map(function (s) { return "- " + (s.title || "(sans titre)") + " : " + s.uri; }).join("\n") || "(aucune)";
    return "Voici le résultat brut d'une recherche qui a trouvé un document réel :\n\n" + rawSearchResult + "\n\nSources consultées durant la recherche :\n" + sourcesTxt + "\n\n" +
      "Méthode de l'épreuve « " + methodo.genre + " » à respecter pour formuler la consigne :\n\n" + methodo.structure + "\n\n" +
      "Extrais proprement de ce résultat : l'extrait exact du document (fidèle, sans reformulation), son auteur, son titre, sa date/origine précise, et l'URL source la plus pertinente parmi celles listées (laisse \"sourceUrl\" vide si aucune n'est fiable, plutôt que d'en inventer une). Rédige ensuite \"consigne\" (la consigne d'analyse, dans le style d'un sujet de « " + methodo.genre + " ») et \"referencePlan\" (un corrigé de référence complet).\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni, en français.";
  }
  function generateMethodologyDocument(methodo, chapterName, chapterContent, subjectName) {
    return searchRealDocument(methodo, chapterName, chapterContent, subjectName).then(function (searchResult) {
      var parts = [{ text: buildDocumentStructurePrompt(methodo, searchResult.text, searchResult.sources) }];
      return callGemini(parts, METHODOLOGY_DOCUMENT_SCHEMA);
    });
  }

  // Fabrique un item d'entraînement normalisé (même forme quel que soit le mécanisme), pour que le
  // reste du code (affichage, correction, Mission Contrôle) n'ait qu'une seule forme à gérer.
  function generateMethodologyPracticeItem(methodo, chapterId, chapterName, chapterContent, mechanic, subjectName, customInstruction) {
    var base = function (subject, document, referencePlan) {
      return {
        id: uid(), mechanic: mechanic, customMechanic: customInstruction || "", chapterId: chapterId, chapterName: chapterName,
        subject: subject, document: document, referencePlan: referencePlan,
        answerHtml: "", answerText: "", status: "unanswered",
        grade20: null, verdict: "", strengths: [], weaknesses: [], detailedFeedback: "",
        createdAt: Date.now()
      };
    };
    if (mechanic === "document" || mechanic === "traduction") {
      return generateMethodologyDocument(methodo, chapterName, chapterContent, subjectName).then(function (doc) {
        return base(doc.consigne, { excerpt: doc.excerpt, author: doc.author, sourceTitle: doc.sourceTitle, date: doc.date, sourceUrl: doc.sourceUrl }, doc.referencePlan);
      });
    }
    return generateMethodologySubject(methodo, chapterName, chapterContent, mechanic, customInstruction).then(function (data) {
      return base(data.subject, null, data.referencePlan);
    });
  }
  function runMethodologyPracticeGeneration(methodo, chapterId, chapterName, chapterContent, mechanic, subjectName, customInstruction) {
    methodo.generatingPractice = true;
    saveDB(); render();
    return generateMethodologyPracticeItem(methodo, chapterId, chapterName, chapterContent, mechanic, subjectName, customInstruction).then(function (item) {
      methodo.practiceItems = methodo.practiceItems || [];
      methodo.practiceItems.unshift(item);
      methodo.generatingPractice = false;
      saveDB(); render();
      return item;
    }).catch(function (err) {
      methodo.generatingPractice = false;
      saveDB();
      toast("Échec de la génération du sujet : " + (err.message || "erreur inconnue"), { status: err.status, detail: err.detail });
      render();
      throw err;
    });
  }

  // Correction sévère : l'élève doit savoir précisément où il en est réellement, pas se rassurer. Voir
  // la discussion produit — une IA trop indulgente qui laisse croire à 18/20 alors que la vraie copie
  // fera 7/20 le jour J est activement nuisible, pas gentille.
  var METHODOLOGY_GRADE_SCHEMA = {
    type: "object",
    properties: {
      grade20: { type: "number", description: "Note sur 20, avec la sévérité d'un vrai correcteur d'examen — jamais gonflée pour encourager." },
      verdict: { type: "string", description: "Verdict global en une phrase, direct et sans complaisance." },
      strengths: { type: "array", items: { type: "string" }, description: "Points RÉELLEMENT réussis uniquement — tableau vide si rien ne mérite d'être cité, ne cherche jamais à en inventer par politesse." },
      weaknesses: { type: "array", items: { type: "string" }, description: "Chaque problème réel, nommé précisément (pas vaguement) et sans adoucir." },
      detailedFeedback: { type: "string", description: "Correction détaillée en Markdown, partie par partie selon la méthode attendue (ex. introduction/problématique, chaque partie du plan, conclusion)." }
    },
    required: ["grade20", "verdict", "strengths", "weaknesses", "detailedFeedback"]
  };
  function buildMethodologyGradePrompt(methodo, item, studentAnswer) {
    var mechanicNote = item.customMechanic
      ? "exactement ceci, demandé par l'élève lui-même : " + item.customMechanic + " — évalue UNIQUEMENT ce qui a été demandé, rien d'autre"
      : ({
        plan: "un PLAN DÉTAILLÉ uniquement, pas une rédaction complète — évalue-le comme un plan (structure, articulation, idées et exemples précis), n'exige pas de phrases entièrement rédigées ni de transitions rédigées",
        redaction: "une rédaction complète et entièrement rédigée",
        partie: "UNE seule partie précise de la méthode (précisée dans le sujet, ex. juste l'introduction/problématique) — évalue UNIQUEMENT cette partie, pas le reste du devoir qui n'a pas été demandé",
        courte: "une réponse courte développée, sans plan formel attendu",
        traduction: "une traduction"
      }[item.mechanic] || "une réponse complète");
    return "Tu es un correcteur d'examen EXTRÊMEMENT EXIGEANT, au niveau d'un vrai jury de bac/concours. Règles absolues à respecter dans TOUTE ta correction :\n" +
      "- INTERDICTION des formulations molles (\"pas tout à fait\", \"presque\", \"tu y es presque\", \"c'est un bon début\") : dis directement \"c'est faux\", \"hors sujet\", \"incohérent\", \"contresens\", \"non justifié\" quand c'est le cas.\n" +
      "- Ne cherche JAMAIS un point positif dans une partie fausse ou hors-sujet pour adoucir le propos — si c'est mauvais, dis-le tel quel, sans l'entourer de compliments non mérités.\n" +
      "- Un 20/20 doit être QUASI IMPOSSIBLE à obtenir, même pour une bonne copie : une copie réellement excellente plafonne autour de 16-17/20, une bonne copie solide tourne autour de 12-14/20, une copie avec de vrais problèmes de fond doit descendre sous la moyenne sans hésiter. Ne gonfle JAMAIS la note pour encourager — un élève qui se croit à 18 alors qu'il aura 7 le jour du contrôle est desservi, pas aidé.\n" +
      "- Vérifie que la structure respecte EXACTEMENT la méthode fournie ci-dessous ; toute étape attendue absente ou mal exécutée doit être nommée précisément et pénalisée.\n" +
      "- Vérifie que le contenu (faits, dates, exemples, citations, analyse du document le cas échéant) est réellement exact et pertinent — toute erreur factuelle, tout hors-sujet, toute affirmation non justifiée par des exemples doit être signalée sans complaisance.\n" +
      "- Orthographe et grammaire : ce n'est presque jamais ce qui est évalué ici. Ça ne doit JAMAIS coûter plus de 1 à 2 points sur 20 au total, même avec des fautes fréquentes, sauf si la méthode/consigne elle-même porte explicitement sur la langue (ex. exercice de traduction, ou correction ciblée de la maîtrise de la langue). Ce qui fait vraiment la note ici, c'est la structure, l'argumentation, la pertinence du contenu et le respect de la méthode — pas la forme.\n\n" +
      "Méthode/grille de correction à appliquer :\n\n" + methodo.structure + "\n\n" +
      "Corrigé de référence (grille détaillée à comparer avec la copie) :\n\n" + (item.referencePlan || "") + "\n\n" +
      (item.document ? "Document fourni à l'élève :\n\n« " + item.document.excerpt + " »\n— " + item.document.author + ", " + item.document.sourceTitle + " (" + item.document.date + ")\n\n" : "") +
      "Sujet/consigne donné à l'élève : " + item.subject + "\n\n" +
      "Copie de l'élève (attendu : " + mechanicNote + ") :\n\n" + (studentAnswer && studentAnswer.trim() ? studentAnswer : "(aucune réponse fournie — note 0/20, c'est un devoir non rendu)") + "\n\n" +
      "Donne une note sur 20, un verdict direct, les points forts réels (liste vide si aucun), les points faibles précis, et une correction détaillée partie par partie.\n\n" +
      "Pour toute formule ou notation nécessitant du LaTeX, utilise $...$ ou $$...$$.\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni, en français.";
  }
  function gradeMethodologyAnswer(methodo, item, studentAnswer) {
    var parts = [{ text: buildMethodologyGradePrompt(methodo, item, studentAnswer) }];
    return callGemini(parts, METHODOLOGY_GRADE_SCHEMA);
  }
  function submitMethodologyAnswer(methodo, item, answerHtml, answerText) {
    item.answerHtml = answerHtml; item.answerText = answerText; item.status = "grading";
    saveDB(); render();
    gradeMethodologyAnswer(methodo, item, answerText).then(function (g) {
      item.status = "graded";
      item.grade20 = typeof g.grade20 === "number" ? Math.max(0, Math.min(20, g.grade20)) : 0;
      item.verdict = g.verdict || "";
      item.strengths = g.strengths || [];
      item.weaknesses = g.weaknesses || [];
      item.detailedFeedback = g.detailedFeedback || "";
      saveDB(); render();
    }).catch(function (err) {
      item.status = "unanswered";
      toast("Échec de la correction : " + (err.message || "erreur inconnue"), { status: err.status, detail: err.detail });
      render();
    });
  }
  function methodoData() { return userData().methodologies; }
  function methodoFind(id) { return methodoData().find(function (m) { return m.id === id; }); }

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
    required: ["overview", "days"]
  };
  function buildExamPlanPrompt(title, examDateStr, todayStr, dayCount, courses, priorTopics, offsets) {
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
      "Voici le contenu à réviser :\n\n" + sourceBlocks + "\n\n" +
      "Certains jours parmi ces " + dayCount + " sont des jours de repos SANS séance (pour ne pas surcharger l'élève quand l'examen est encore loin). Voici la liste EXACTE des décalages en jours depuis aujourd'hui (offsetDays, 0 = aujourd'hui) pour lesquels une séance est prévue : " + offsets.join(", ") + ". Produis EXACTEMENT une entrée par offsetDays listé ici, ni plus ni moins (n'en ajoute aucun pour les jours de repos, n'en oublie aucun de la liste), en respectant ces principes :\n" +
      "- Les séances doivent être substantielles, pas expéditives : mieux vaut une séance un peu longue et exigeante qu'une séance courte qui ne prépare à rien (typiquement 20 à 60 minutes indicatives, mais dépasser cette estimation n'est jamais un problème).\n" +
      "- Couvre l'intégralité du contenu ci-dessus au moins une fois d'ici la fin du planning.\n" +
      "- Plus on se rapproche de l'examen, plus les jours prévus doivent revenir sur les notions déjà vues plus tôt (en plus des notions nouvelles du jour), façon répétition espacée, pour consolider — ce n'est pas qu'un simple découpage linéaire du programme.\n" +
      "- Pour chaque jour prévu, \"focus\" résume l'objectif du jour en une phrase, et \"topics\" liste 2 à 6 notions précises concernées.\n\n" +
      "\"overview\" résume ta stratégie globale en 2-3 phrases motivantes, en français.\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni, en français.";
  }
  function generateExamPlan(title, examDateStr, todayStr, dayCount, courses, priorTopics, offsets) {
    var parts = [{ text: buildExamPlanPrompt(title, examDateStr, todayStr, dayCount, courses, priorTopics, offsets) }];
    return callGemini(parts, EXAM_PLAN_SCHEMA);
  }
  function runExamPlanGeneration(prep) {
    prep.planStatus = "processing";
    prep.planError = null;
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
    generateExamPlan(prep.title, prep.examDate, today, dayCount, courses, priorTopics, scheduleOffsets).then(function (data) {
      prep.overview = data.overview || prep.overview || "";
      var offsetSet = {};
      scheduleOffsets.forEach(function (o) { offsetSet[o] = true; });
      var newDays = (data.days || [])
        .filter(function (d) { return offsetSet[Math.max(0, d.offsetDays || 0)]; })
        .map(function (d) {
          return { date: epAddDays(today, Math.max(0, d.offsetDays || 0)), minutes: Math.max(5, d.minutes || 20), focus: d.focus || "", topics: d.topics || [] };
        });
      finishPlan(newDays);
    }).catch(function (err) {
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
  function epPickDayQuestions(pool, dayEntry, prep) {
    if (!pool.length) return [];
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
    var picked = [];
    var pickedIds = {};
    var add = function (it) { if (it && !pickedIds[it.id]) { pickedIds[it.id] = true; picked.push(it); } };
    var countKind = function (kind) { return picked.filter(function (p) { return p.kind === kind; }).length; };
    // 1. Couverture du "par cœur" : toute définition/formule à savoir par cœur liée aux notions du
    // jour est posée SANS exception, et forcément en rédaction (jamais en QCM — voir buildCoursePrompt
    // qui force déjà ces catégories en type "ouverte") : l'élève doit la réécrire, pas la reconnaître.
    scored.forEach(function (s) { if (s.isMemo && s.matchesToday) add(s.item); });
    // 2. Un vrai volume d'exercices exigeants et de questions rédigées, dimensionné sur ce que le cours
    // propose réellement plutôt que bridé par un budget minutes strict — mieux vaut une séance plus
    // longue que prévu qu'une séance trop courte pour vraiment préparer à l'examen. Le QCM reste
    // minoritaire, jamais le pilier de la séance.
    var byKind = { exercise: [], open: [], qcm: [] };
    scored.forEach(function (s) { byKind[s.item.kind].push(s.item); });
    var targetExercise = Math.min(byKind.exercise.length, 4);
    var targetOpen = Math.min(byKind.open.length, 8);
    var targetQcm = Math.min(byKind.qcm.length, 3);
    byKind.exercise.forEach(function (it) { if (countKind("exercise") < targetExercise) add(it); });
    byKind.open.forEach(function (it) { if (countKind("open") < targetOpen) add(it); });
    byKind.qcm.forEach(function (it) { if (countKind("qcm") < targetQcm) add(it); });
    if (!picked.length && scored.length) add(scored[0].item);
    for (var j = picked.length - 1; j > 0; j--) { var k = Math.floor(Math.random() * (j + 1)); var t = picked[j]; picked[j] = picked[k]; picked[k] = t; }
    return picked;
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
      "Pour CHAQUE erreur ci-dessus, crée exactement 2 flashcards de révision (une question courte au recto dans \"q\", une réponse courte et précise au verso dans \"a\") qui aident à retravailler la notion à l'origine de CETTE erreur précise. Les 2 flashcards d'une même erreur doivent aborder la notion sous deux angles différents (pas juste reformuler la même question), pour bien l'ancrer. Il y a " + wrongItems.length + " erreur(s) : renvoie EXACTEMENT " + (wrongItems.length * 2) + " flashcards, dans l'ordre des erreurs listées (les 2 premières pour l'erreur 1, les 2 suivantes pour l'erreur 2, etc.).\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni, en français.";
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
      "Réponds uniquement en respectant le schéma JSON fourni, en français.";
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
          [gapFlashcardsFlat[wi * 2], gapFlashcardsFlat[wi * 2 + 1]].forEach(function (f) {
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
      "Réponds uniquement en respectant le schéma JSON fourni, en français.";
  }
  async function gradeExerciseAnswer(exercisePrompt, referenceSolution, studentAnswer) {
    var parts = [{ text: buildExerciseGradePrompt(stripFigureMarkdown(exercisePrompt), stripFigureMarkdown(referenceSolution), studentAnswer) }];
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
            imageIndex: { type: "integer", description: "Index (à partir de 0) de la photo source où se trouve ce schéma." },
            box: { type: "array", items: { type: "integer" }, description: "Zone [ymin, xmin, ymax, xmax] du schéma dans cette photo, sur une échelle 0-1000." },
            caption: { type: "string", description: "Légende courte du schéma." },
            placeholder: { type: "string", description: "Jeton unique au format [[figure:N]] (N = index de cette figure) à insérer tel quel dans le \"statement\" de l'exercice concerné, à l'endroit exact où ce schéma doit apparaître." }
          },
          required: ["imageIndex", "box", "caption", "placeholder"]
        }
      }
    },
    required: ["subjectGuess", "exercises", "figures"]
  };
  function buildImportedExercisePrompt(imageCount) {
    var step1 = imageCount === 1
      ? "Voici la photo ou le document d'un ou plusieurs exercices pris par un élève."
      : "Voici " + imageCount + " photos/pages qui font partie du même document d'exercices, dans l'ordre.";
    return step1 + " Ne réponds pas encore aux exercices ici : \n" +
      "Règle importante : si un énoncé correspond mot pour mot à un exercice déjà public sur internet (banque d'exercices en ligne, manuel, site de révision, etc.), REFORMULE légèrement sa formulation en gardant strictement le même sens, les mêmes données et la même difficulté, plutôt que de le recopier tel quel — sinon la génération est bloquée automatiquement.\n" +
      "1. Repère CHAQUE exercice distinct présent dans le document (généralement numéroté \"Exercice 1\", \"Exercice 2\"... ou séparé visuellement) et crée une entrée dans \"exercises\" pour chacun, dans l'ordre d'apparition. S'il n'y a qu'un seul exercice, renvoie un tableau \"exercises\" avec un seul élément. S'il y en a 7 exercices distincts, renvoie exactement 7 éléments — ne fusionne jamais deux exercices ensemble et n'en invente aucun.\n" +
      "   ATTENTION, très important : les sous-questions ou étapes À L'INTÉRIEUR d'un même exercice (numérotées a, b, c, d... ou 1, 2, 3... ou 1), 2), 3)...) NE SONT PAS des exercices séparés — ce sont des questions qui font partie d'un seul et même exercice. Un exercice avec 5 sous-questions ou 5 étapes reste UN SEUL élément dans \"exercises\", avec toutes ses sous-questions rassemblées dans le même \"statement\" et une seule \"solution\" qui traite les 5. Ne crée une nouvelle entrée dans \"exercises\" QUE quand le document passe à un exercice numéroté différent (Exercice 1 → Exercice 2), jamais entre deux sous-questions du même exercice.\n" +
      "2. Pour chaque exercice, retranscris fidèlement son énoncé complet dans \"statement\", en gardant toutes ses sous-questions (a, b, c... ou 1, 2, 3...) ensemble dans ce même \"statement\", chacune sur sa propre ligne (une ligne \"- \" par sous-question si elles sont nombreuses, sinon une ligne par ligne du document source). N'ajoute JAMAIS de titre du type \"## Exercice N\" ou \"### Énoncé\" en tête du \"statement\" : l'application affiche déjà le numéro de l'exercice ailleurs, ce serait redondant. Utilise ** pour le gras et $...$/$$...$$ pour les formules, mais pas de ## ni ### ici. Corrige les fautes évidentes mais garde le sens exact.\n" +
      "3. Devine la matière probable de l'ensemble des exercices (un seul \"subjectGuess\" pour tout le document).\n" +
      "4. Pour chaque exercice, rédige toi-même une solution de référence complète, détaillée et rigoureuse (avec le résultat final) dans \"solution\" — en traitant TOUTES les sous-questions de cet exercice (a, b, c... ou 1, 2, 3...) dans cette même solution. C'est cette solution qui servira ensuite à corriger la réponse de l'élève sur CET exercice précis (l'élève répond en une seule fois à toutes ses sous-questions).\n" +
      "5. Si un exercice s'appuie sur un schéma, graphique, figure géométrique ou dessin VISUEL réellement NÉCESSAIRE pour le résoudre (pas une simple décoration), repère-le dans les photos sources et ajoute une entrée dans \"figures\" avec : \"imageIndex\" (index de la photo, à partir de 0), \"box\" (zone rectangulaire exacte du schéma dans cette photo, format [ymin, xmin, ymax, xmax] sur une échelle 0-1000, en excluant le texte autour), \"caption\" (légende courte) et \"placeholder\" (jeton unique \"[[figure:N]]\"). Insère ce jeton tel quel, seul sur sa ligne, exactement à l'endroit du \"statement\" de cet exercice où le schéma doit apparaître — ne le décris jamais en mots à la place. Signal à prendre TRÈS au sérieux : dès qu'un énoncé contient les mots \"ci-contre\", \"ci-dessous\", \"ci-joint\" ou \"ci-après\" à propos d'une représentation graphique/d'un schéma/d'une figure, c'est qu'un visuel est physiquement présent dans la photo à cet endroit — cherche-le activement et capture-le, ne le laisse JAMAIS de côté même si le document contient beaucoup d'exercices et que tu dois rester attentif jusqu'au dernier. INTERDIT : ne crée JAMAIS de figure pour du texte, même encadré ou stylisé (citation, définition, énoncé) — ce texte doit TOUJOURS être retranscrit normalement dans \"statement\", jamais capturé comme une image. \"figures\" est réservé exclusivement à du contenu qui ne peut PAS être retranscrit en texte. S'il n'y a aucun schéma nécessaire, renvoie un tableau \"figures\" vide.\n\n" +
      "Pour toute formule ou notation mathématique/scientifique, utilise du LaTeX délimité par $...$ en ligne ou $$...$$ pour une formule isolée. N'utilise jamais de commande de couleur LaTeX (\\textcolor, \\colorbox, \\color, etc.) pour surligner un terme : le texte doit toujours rester dans la couleur par défaut, utilise le gras (**) si tu veux mettre quelque chose en valeur.\n\n" +
      "Si un énoncé comporte un tableau de données, reproduis-le comme un vrai tableau Markdown (| Colonne 1 | Colonne 2 |, puis une ligne |---|---|, puis les lignes de données) plutôt qu'une liste à puces : le site sait afficher de vrais tableaux.\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni, en français.";
  }
  async function generateImportedExercise(imageDataUrls) {
    var images = (imageDataUrls || []).map(function (url) {
      var m = /^data:(image\/[a-zA-Z+]+|application\/pdf);base64,(.+)$/.exec(url || "");
      return m ? { inline_data: { mime_type: m[1], data: m[2] } } : null;
    }).filter(Boolean);
    var parts = images.concat([{ text: buildImportedExercisePrompt(images.length) }]);
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
    saveDB(); render();
    generateImportedExercise(entry.images).then(function (data) {
      entry.subjectGuess = data.subjectGuess || "";
      return resolveFigures(data.figures, entry.images).then(function (resolved) {
        var exercises = (data.exercises || []).map(function (ex) {
          return { statement: substituteFigures(ex.statement || "", resolved.subs), solution: ex.solution || "", figureSvg: "", answerHtml: "", answerText: "", answerStatus: "unanswered", correct: null, feedback: "" };
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
          entry.figures = resolved.figures;
          entry.status = "ready";
          // Tout ce qui a été détecté est déjà découpé/reconstruit et stocké à part : la photo complète
          // ne sert donc plus à rien dans le cas normal, et on la jette (coûteuse en stockage, comme
          // pour les cours). On ne la garde QUE s'il reste un énoncé sans aucune figure malgré tout ça
          // — c'est alors le seul moyen de pouvoir corriger le tir avec "Régénérer" plus tard.
          if (!stillMissing) entry.images = [];
          saveDB();
          toast((entry.exercises.length > 1 ? entry.exercises.length + " exercices importés · " : "Exercice importé · ") + entry.title);
          render();
        });
      });
    }).catch(function (err) {
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
    saveDB(); render();
    var images = imagesOverride || course.images;
    generateCourseContent(images, course.title, subjectName, chapterName, priorTranscription).then(function (data) {
      return resolveFigures(data.figures, images).then(function (resolved) {
        var transcription = substituteFigures(data.transcription, resolved.subs);
        // Ajout de nouvelles photos à un cours existant : l'IA n'a retranscrit QUE le nouveau contenu
        // (voir buildCoursePrompt) — on recolle l'ancien texte tel quel, jamais retouché par l'IA, pour
        // garantir qu'aucun détail déjà transcrit ne puisse être perdu/compressé lors de l'ajout.
        if (priorTranscription && images && images.length) transcription = priorTranscription + "\n\n" + transcription;
        var explanation = substituteFigures(data.explanation, resolved.subs);
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
          course.explanation = explanation;
          course.transcriptionFigureSvg = textBlocks[0].figureSvg;
          course.explanationFigureSvg = textBlocks[1].figureSvg;
          // Remplacé (pas accumulé) : les figures d'un ancien contenu ne sont de toute façon plus
          // référencées dans le texte fraîchement régénéré (le contexte envoyé à l'IA est nettoyé de
          // ses anciennes images), les garder ne ferait que gonfler le stockage pour rien.
          course.figures = resolved.figures;
          course.videos = course.videos || [];
          course.flashcards = (data.flashcards || []).map(function (f) { return { id: uid(), q: f.q, a: f.a, status: "new" }; });
          course.quizQuestions = quizQuestions;
          course.exercises = exercises;
          course.status = "ready";
          // Les photos/PDF source ne sont plus utiles une fois le cours généré : la retranscription
          // sert désormais de mémoire pour "Régénérer"/"Ajouter des documents", donc plus la peine
          // d'accumuler les images dans le stockage local (c'est automatique, pas besoin de bouton).
          // Exception : s'il reste un schéma introuvable malgré la reconstruction, on garde les photos
          // — sans elles, "Régénérer" ne pourrait plus jamais retenter, il faudrait tout réimporter.
          if (!stillMissing) course.images = [];
          saveDB();
          toast("Cours généré · " + course.title);
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
      course.status = "error";
      course.error = err.message || "Erreur inconnue";
      course.errorStatus = err.status || null;
      course.errorDetail = err.detail || null;
      saveDB();
      toast("Échec de la génération : " + course.error, { status: course.errorStatus, detail: course.errorDetail });
      render();
    });
  }


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
  function dpSpecies(id) { return DP_SPECIES.find(function (s) { return s.id === id; }); }
  function dpSpeciesByZone(zoneId) { return DP_SPECIES.filter(function (s) { return s.zone === zoneId; }); }

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

  var DP_SHOP_SLOTS = 5;
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
  function dpGenerateShopItems(zoneId, lucky) {
    var species = dpSpeciesByZone(zoneId);
    var weighted = [];
    species.forEach(function (s) {
      var w = DP_RARITY[s.rarity].weight;
      if (lucky) w = s.rarity === "commun" ? Math.max(1, Math.round(w * 0.2)) : w * 5;
      for (var i = 0; i < w; i++) weighted.push(s.id);
    });
    var picks = [];
    var used = {};
    var slots = Math.min(DP_SHOP_SLOTS, species.length);
    var guard = 0;
    while (picks.length < slots && guard < 2000) {
      guard++;
      var pick = weighted[Math.floor(Math.random() * weighted.length)];
      if (used[pick]) continue;
      used[pick] = true;
      picks.push(pick);
    }
    return picks;
  }
  function dpShop(zoneId) {
    var dp = dpData();
    var shop = dp.shops[zoneId];
    if (!shop || Date.now() >= shop.expiresAt) {
      shop = { items: dpGenerateShopItems(zoneId, false), expiresAt: Date.now() + DP_SHOP_DURATION };
      dp.shops[zoneId] = shop;
      saveDB();
    }
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
    var head = '<div class="page-head"><div><div class="page-title-row">' + sprite("footprint", 4) + '<h1 class="page-title">Encyclopédie</h1></div><p class="page-sub">' + Object.keys(dp.discovered).length + ' / ' + DP_SPECIES.length + ' espèces découvertes.</p></div></div>';
    var grid = '<div class="dp-ency-grid">' + DP_SPECIES.map(function (sp, i) {
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
    var body = '<div class="dp-exercise-box"><div class="dp-exercise-label">Exercice</div><div class="dp-exercise-text">' + mdToHtml(ex.prompt) + '</div></div>' + exerciseFigureHtml(ex);
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
        '<div class="dp-exercise-box" style="margin-top:14px"><div class="dp-exercise-label">Solution de référence</div><div class="dp-exercise-text">' + mdToHtml(ex.solution) + '</div></div>' +
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
    } else if (parts[0] === "podcasts") {
      trail.push({ label: "Podcast", hash: "#/podcasts" });
      if (parts[1]) {
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
      '<button class="nav-item ' + (parts.length === 0 ? "active" : "") + '" onclick="App.closeMobileNav();location.hash=\'#/\'"><img class="nav-icon-img" src="assets/objects/ui/Menu.png" alt=""> Menu</button>' +
      '<button class="nav-item ' + (parts[0] === "exercices" ? "active" : "") + '" onclick="App.closeMobileNav();location.hash=\'#/exercices\'"><img class="nav-icon-img" src="assets/objects/ui/MesExos.png" alt=""> Mes exercices</button>' +
      '<button class="nav-item ' + (parts[0] === "dinopark" ? "active" : "") + '" onclick="App.closeMobileNav();App.dpGoHub()"><img class="nav-icon-img" src="assets/objects/ui/DinoPark.png" alt=""> Dino Park' + (dpAttentionList().length ? '<span class="nav-alert-dot" title="Des dinos ont besoin d\'attention"></span>' : '') + '</button>' +
      '<button class="nav-item ' + (parts[0] === "dinotime" ? "active" : "") + '" onclick="App.closeMobileNav();App.dtGoDinoTime()"><img class="nav-icon-img" src="assets/objects/ui/DinoTime.png" alt=""> DinoTime</button>' +
      '<button class="nav-item ' + (parts[0] === "examprep" ? "active" : "") + '" onclick="App.closeMobileNav();location.hash=\'#/examprep\'"><img class="nav-icon-img" src="assets/objects/ui/MissionControle.png" alt=""> Mission Contrôle</button>' +
      '<button class="nav-item ' + (parts[0] === "methodologies" ? "active" : "") + '" onclick="App.closeMobileNav();location.hash=\'#/methodologies\'"><img class="nav-icon-img" src="assets/objects/ui/Méthodologie.png" alt=""> Méthodologie</button>' +
      '<button class="nav-item ' + (parts[0] === "podcasts" ? "active" : "") + '" onclick="App.closeMobileNav();location.hash=\'#/podcasts\'"><img class="nav-icon-img" src="assets/objects/ui/Podcast.png" alt=""> Podcast</button>' +
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
      var canLuck = dp.points >= DP_SHOP_LUCK_COST;
      toolsHtml = '<div class="dp-merchant-tools">' +
        '<span class="dp-shop-timer mono">🪙 <span class="dp-points-value">' + dp.points + '</span></span>' +
        '<span class="dp-shop-timer mono" id="dp-shop-timer" data-zone="' + zoneId + '">⏳ ' + dpFormatCountdown(shopState.expiresAt - Date.now()) + '</span>' +
        '<button class="btn btn-sm btn-ghost" ' + (canRefresh ? "" : "disabled") + ' onclick="App.dpRefreshShop(\'' + zoneId + '\')">🔄 Rafraîchir (' + DP_SHOP_REFRESH_COST + ' pts)</button>' +
        '<button class="btn btn-sm btn-ghost" ' + (canLuck ? "" : "disabled") + ' onclick="App.dpLuckShop(\'' + zoneId + '\')">🍀 Chance+ (' + DP_SHOP_LUCK_COST + ' pts)</button>' +
        '<button class="btn btn-sm btn-ghost" onclick="App.dpStartSellDino()">💰 Vendre des dinos</button>' +
        '</div>';
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
            ? '<span class="status-pill status-processing"><span class="dotpulse"></span>Génération…</span>'
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
          '<button class="tile-rename" style="right:40px" title="Renommer" onclick="event.stopPropagation();App.openRenameModal(\'theme\',\'' + s.id + '\',\'' + t.id + '\')">✏️</button>' +
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
          ? '<span class="status-pill status-processing"><span class="dotpulse"></span>Génération…</span>'
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
          ? '<span class="status-pill status-processing"><span class="dotpulse"></span>Analyse…</span>'
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
      body = '<div class="processing-box">' + genLogo() + '<span>Gemini analyse ton exercice…</span></div>';
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
            '<div class="dp-exercise-box" style="margin-top:14px"><div class="dp-exercise-label">Solution de référence</div><div class="dp-exercise-text">' + mdToHtml(ex.solution) + '</div></div>' +
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
  var podcastIdleImgCache = null; // choisie une seule fois par session — ne doit pas changer à chaque clic
  var podcastExpliqueByPod = {}; // per podcast id: index courant — stable tant qu'on reste sur CE podcast, change seulement toutes les ~60s
  var podcastFolderOpen = {}; // per groupId: bool — dossier de parties replié par défaut
  var podcastAutoPlayNext = false; // mis à true juste avant de naviguer vers la partie suivante en fin de lecture
  function podcastFormatTime(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function podcastStatusBadge(p) {
    return p.status === "processing" ? '<span class="status-pill status-processing"><span class="dotpulse"></span>Préparation…</span>'
      : p.status === "error" ? '<span class="status-pill status-processing">⚠️ Erreur</span>'
      : '<span class="status-pill status-ready">🎧 ' + podcastFormatTime(p.durationSec) + '</span>';
  }
  function podcastTileHtml(p) {
    return '<div class="tile" onclick="location.hash=\'#/podcasts/' + p.id + '\'">' +
      '<button class="tile-del" title="Supprimer" onclick="event.stopPropagation();App.askDelete(\'podcast\',null,null,null,\'' + p.id + '\')">' + icon("trash") + '</button>' +
      '<div class="tile-icon">🎙️</div>' +
      '<div class="tile-title">' + esc(p.title) + '</div>' +
      podcastStatusBadge(p) +
      '</div>';
  }
  // Plusieurs parties du même podcast (même groupId) prennent un seul emplacement sous forme de
  // dossier repliable, plutôt qu'une tuile pleine par partie — beaucoup plus compact.
  function podcastFolderTileHtml(gid, parts) {
    var chapterName = parts[0].scopeName || parts[0].title;
    var open = !!podcastFolderOpen[gid];
    if (!open) {
      return '<div class="tile" onclick="App.togglePodcastFolder(\'' + gid + '\')">' +
        '<div class="tile-icon">📁</div>' +
        '<div class="tile-title">' + esc(chapterName) + '</div>' +
        '<span class="demo-badge">' + parts.length + ' parties</span>' +
        '</div>';
    }
    var anyReady = parts.some(function (p) { return p.status === "ready"; });
    return '<div class="tile podcast-folder-open">' +
      '<div class="podcast-folder-head" onclick="App.togglePodcastFolder(\'' + gid + '\')"><div class="tile-icon">📂</div><div class="tile-title">' + esc(chapterName) + '</div>' +
      '<button class="tile-del" title="Supprimer toutes les parties" onclick="event.stopPropagation();App.askDelete(\'podcastGroup\',null,null,null,\'' + gid + '\')">' + icon("trash") + '</button></div>' +
      (anyReady ? '<button class="btn btn-ghost btn-sm" style="width:auto;margin-bottom:8px" onclick="event.stopPropagation();App.downloadPodcastGroupMp3(\'' + gid + '\')">⬇️ Tout télécharger en un seul MP3</button>' : "") +
      '<div class="podcast-folder-items">' + parts.map(function (p) {
        return '<div class="podcast-folder-item" onclick="location.hash=\'#/podcasts/' + p.id + '\'">' +
          '<span>🎙️ ' + esc(p.title || ("Partie " + p.partIndex)) + '</span>' + podcastStatusBadge(p) +
          '<button class="tile-del" title="Supprimer" onclick="event.stopPropagation();App.askDelete(\'podcast\',null,null,null,\'' + p.id + '\')">' + icon("trash") + '</button>' +
          '</div>';
      }).join("") + '</div></div>';
  }
  function renderPodcastListPage() {
    var list = podcastData().slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    if (!podcastIdleImgCache) podcastIdleImgCache = PODCAST_ATTEND_IMGS[Math.floor(Math.random() * PODCAST_ATTEND_IMGS.length)];
    var libraryHtml;
    if (!list.length) {
      libraryHtml = '<p class="podcast-fs-empty">Choisis une matière et un chapitre, le vieux conteur s\'occupe du reste.</p>';
    } else {
      // Regroupe par matière (comme dans le Menu), puis par groupId à l'intérieur de chaque matière.
      var bySubject = {}, subjectOrder = [];
      list.forEach(function (p) {
        var key = p.subjectId || "?";
        if (!bySubject[key]) { bySubject[key] = { name: p.subjectName || "Sans matière", items: [] }; subjectOrder.push(key); }
        bySubject[key].items.push(p);
      });
      libraryHtml = subjectOrder.map(function (key) {
        var grp = bySubject[key];
        var byGroup = {}, groupOrder = [];
        grp.items.forEach(function (p) {
          var gid = p.groupId || p.id;
          if (!byGroup[gid]) { byGroup[gid] = []; groupOrder.push(gid); }
          byGroup[gid].push(p);
        });
        var tilesHtml = groupOrder.map(function (gid) {
          var parts = byGroup[gid].sort(function (a, b) { return a.partIndex - b.partIndex; });
          return parts.length > 1 ? podcastFolderTileHtml(gid, parts) : podcastTileHtml(parts[0]);
        }).join("");
        return '<div class="podcast-fs-subject"><div class="podcast-fs-subject-name">' + esc(grp.name) + '</div><div class="podcast-fs-grid">' + tilesHtml + '</div></div>';
      }).join("");
    }
    var body = '<div class="podcast-fullscreen">' +
      '<img src="' + PODCAST_DIR + podcastIdleImgCache + '" class="podcast-bg-img" alt="">' +
      '<div class="podcast-fs-header"><button class="mobile-nav-toggle" style="background:rgba(255,255,255,0.14);border-color:rgba(255,255,255,0.4);color:#fff" onclick="App.toggleMobileNav()" aria-label="Menu">☰</button><div class="page-title-row"><img class="page-title-logo" src="assets/objects/ui/Podcast.png" alt=""><div class="podcast-fs-title">Podcast</div></div><button class="btn btn-metal" style="width:auto" onclick="App.openPodcastModal()">' + icon("plus") + ' Nouveau podcast</button></div>' +
      '<div class="podcast-fs-library">' + libraryHtml + '</div>' +
      '</div>';
    renderShell(["podcasts"], body);
  }
  function renderPodcastDetailPage(id) {
    var pod = podcastFind(id);
    if (!pod) { navigate("#/podcasts"); return; }
    var closeBtn = '<button class="podcast-fs-close" onclick="location.hash=\'#/podcasts\'" title="Retour">✕</button>';
    var body;
    if (pod.status === "processing") {
      body = '<div class="podcast-fullscreen">' + closeBtn +
        '<img src="' + PODCAST_DIR + PODCAST_LIS_IMG + '" class="podcast-bg-img" alt="">' +
        '<div class="podcast-fs-bottom"><div class="processing-box" style="color:#fff">' + genLogo() + '<span>Le vieux conteur lit « ' + esc(pod.title) + ' » pour te préparer une belle histoire… ça peut prendre quelques minutes.</span></div></div>' +
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
        '<button class="btn btn-ghost btn-sm" style="width:auto;margin-left:auto;background:rgba(255,255,255,0.14);border-color:rgba(255,255,255,0.4);color:#fff" onclick="App.downloadPodcastMp3(\'' + pod.id + '\')" title="Télécharger cette partie en MP3">⬇️ MP3</button>' +
        (pod.partCount > 1 ? '<button class="btn btn-ghost btn-sm" style="width:auto;background:rgba(255,255,255,0.14);border-color:rgba(255,255,255,0.4);color:#fff" onclick="App.downloadPodcastGroupMp3(\'' + pod.groupId + '\')" title="Télécharger toutes les parties en un seul MP3">⬇️ Tout en 1 MP3</button>' : "") +
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
        '</div>' +
        '</div></div>';
    }
    renderShell(["podcasts", id], body);
    if (pod.status === "ready") {
      podcastEnsurePlayerInterval();
      if (podcastAutoPlayNext) {
        podcastAutoPlayNext = false;
        var autoAudio = document.getElementById("podcast-audio");
        if (autoAudio) autoAudio.play().catch(function () {});
      }
    }
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
  // Pour choisir la portée d'un podcast ("tout un thème" plutôt qu'un seul chapitre) : mêmes helpers
  // que ci-dessus, mais agrégeant tous les chapitres d'un thème au lieu d'un seul chapitre.
  function subjectThemesWithContent(subj) {
    return (subj.themes || []).filter(function (t) {
      return (t.chapters || []).some(function (c) { return (c.courses || []).some(dpCourseHasContent); });
    }).map(function (t) { return { id: t.id, name: t.name }; });
  }
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
        var statusHtml = m.status === "processing" ? '<span class="status-pill status-processing"><span class="dotpulse"></span>Analyse…</span>'
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
      body = '<div class="processing-box">' + genLogo() + '<span>Gemini analyse ta méthodologie…</span></div>';
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
      body = '<div class="processing-box">' + genLogo() + '<span>Gemini rédige ta fiche…</span></div>';
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
        var statusHtml = p.planStatus === "processing" ? '<span class="status-pill status-processing"><span class="dotpulse"></span>Planning…</span>'
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
          '<div class="correction-q">' + esc(h.prompt) + '<span class="grade-pill grade-' + cls + '">' + gradeLevelLabel(level) + '</span></div>' + exerciseFigureHtml(h) +
          '<div class="correction-ans ' + (h.wasCorrect ? "good" : "bad") + '">Ta réponse : ' + esc(h.yourAnswer || "(vide)") + '</div>' +
          gradeMistakesHtml(h.mistakes) +
          (level === "correct" ? '' : '<div class="correction-ans good">Bonne réponse : ' + esc(h.correctAnswer) + '</div>') +
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
    var body = '<div class="quiz-q-num">Question ' + (s.idx + 1) + ' / ' + s.pool.length + (item.kind === "exercise" ? " · Exercice" : "") + '</div>';
    if (item.kind === "exercise") {
      body += '<div class="dp-exercise-box"><div class="dp-exercise-label">Exercice</div><div class="dp-exercise-text">' + mdToHtml(item.prompt) + '</div></div>' + exerciseFigureHtml(item);
    } else {
      body += '<div class="quiz-q-text">' + esc(item.prompt) + '</div>' + exerciseFigureHtml(item);
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
        '<p style="font-size:13.5px;margin-bottom:14px">Réponse attendue : <strong>' + inlineMd(item.answer) + '</strong></p>';
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
        (item.kind === "exercise" ? '<div class="dp-exercise-box" style="margin-top:14px"><div class="dp-exercise-label">Solution de référence</div><div class="dp-exercise-text">' + mdToHtml(item.solution) + '</div></div>' : '') +
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
      body = '<div class="processing-box">' + genLogo() + '<span>Gemini prépare ton planning de révision…</span></div>';
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
      var loadingBtnHtml = '<button class="btn btn-ghost" style="width:auto" disabled>⏳ Préparation de séances variées…</button>';
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
          (startingToday ? loadingBtnHtml : '<button class="btn btn-metal" style="width:auto" onclick="App.startExamPrepDay(\'' + prep.id + '\')">Commencer l\'entraînement du jour</button>') + '</div>';
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
      body = readinessHtml + epTopicDetailHtml(prep) + '<div class="prose" style="margin:16px 0 20px"><p>' + esc(prep.overview) + '</p></div>' + cta + '<h3 style="font-size:16px;margin:22px 0 12px">Planning jour par jour</h3><div class="ep-day-list">' + daysHtml + '</div>';
    }
    renderShell(["examprep", prep.id], head + body, { narrow: true });
  }

  function figuresPanelHtml(figures, openState, entityId, toggleAction, deleteAction) {
    if (!figures || !figures.length) return "";
    var toggle = '<button class="ep-day-fc-toggle" style="margin:14px 0 4px;display:inline-block" onclick="App.' + toggleAction + '(\'' + entityId + '\')">🖼️ Images/schémas (' + figures.length + ')</button>';
    if (!openState[entityId]) return toggle;
    var grid = figures.map(function (f) {
      return '<div class="course-figure-item">' +
        '<img src="' + f.image + '" alt="" onclick="App.openFigureLightbox(this.src)">' +
        (f.caption ? '<div class="course-figure-caption">' + esc(f.caption) + '</div>' : "") +
        '<button class="btn btn-ghost btn-sm" style="width:100%" onclick="App.' + deleteAction + '(\'' + entityId + '\',\'' + f.id + '\')">' + icon("trash") + ' Supprimer</button>' +
        '</div>';
    }).join("");
    return toggle + '<div class="course-figures-grid">' + grid + '</div>';
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
      body = '<div class="processing-box">' + genLogo() + '<span>Gemini analyse ton cours…</span></div>';
    } else if (course.status === "error") {
      body = '<div class="processing-box"><span>⚠️ ' + esc(course.error || "La génération a échoué.") + '</span>' +
        '<div style="display:flex;gap:10px">' +
        (course.errorDetail ? '<button class="btn btn-ghost btn-sm" style="width:auto;margin-top:14px" onclick="App.openCourseErrorDetail(\'' + course.id + '\')">Détails</button>' : '') +
        '<button class="btn btn-primary" style="width:auto;margin-top:14px" onclick="App.retryGeneration(\'' + course.id + '\')">Réessayer</button>' +
        '</div></div>';
    } else {
      body = renderTabBody(course, tab, loc) + figuresPanelHtml(course.figures, courseFiguresOpen, course.id, "toggleCourseFigures", "deleteCourseFigure");
    }
    renderShell(["course", courseId, null, tab], head + tabsHtml + body, { narrow: true });
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
      // Tableau : ligne d'en-tête suivie idéalement d'une ligne |---|---|, mais on l'accepte
      // aussi sans cette ligne de séparation (l'IA l'omet parfois) tant qu'au moins deux lignes
      // consécutives contiennent des pipes.
      var nextLine = i + 1 < lines.length ? lines[i + 1] : "";
      var looksLikeTable = mdPipeCount(line) >= 1 && nextLine.trim() !== "" && (mdIsTableSep(nextLine) || mdPipeCount(nextLine) >= 1);
      if (looksLikeTable) {
        if (inList) { html += "</ul>"; inList = false; }
        var head = mdTableRow(line);
        html += "<table><thead><tr>" + head.map(function (c) { return "<th>" + inlineMdPlain(c) + "</th>"; }).join("") + "</tr></thead><tbody>";
        i++;
        while (i < lines.length && mdPipeCount(lines[i]) >= 1 && lines[i].trim() !== "") {
          if (mdIsTableSep(lines[i])) { i++; continue; }
          var row = mdTableRow(lines[i]);
          html += "<tr>" + row.map(function (c) { return "<td>" + inlineMdPlain(c) + "</td>"; }).join("") + "</tr>";
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
            html += '<figure class="prose-figure"><img src="' + refFig.image + '" alt="' + esc(imgLine[1]) + '" onclick="App.openFigureLightbox(this.src)">' + (imgLine[1] ? "<figcaption>" + esc(imgLine[1]) + "</figcaption>" : "") + "</figure>";
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
      else if (/^#{2,6}\s*/.test(line.trim())) {
        if (inList) { html += "</ul>"; inList = false; }
        var headingMatch = /^(#{2,6})\s*(.*)$/.exec(line.trim());
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

  /* ---------------- Rich text mini-editor ---------------- */
  // mdToHtml() (qui affiche les énoncés) produit aussi des <ul>/<li>, <h3>/<h4> et <thead>/<th> — sans
  // eux dans cette liste, coller un énoncé qui en contient (n'importe quelle liste à puces, très
  // fréquent) les remplaçait par du texte brut collé bout à bout, sans le moindre espace ni saut de
  // ligne entre les éléments (perte totale de la mise en forme, pas juste des puces).
  var RTE_ALLOWED_TAGS = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, SPAN: 1, BR: 1, DIV: 1, P: 1, H3: 1, H4: 1, UL: 1, OL: 1, LI: 1, TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TH: 1, TD: 1 };
  // background-color est volontairement exclu : coller du texte qui en portait (Word, une page web,
  // un ancien fond de citation...) laissait un bloc de couleur plein derrière la ligne collée.
  var RTE_ALLOWED_STYLES = { color: 1, "text-decoration": 1, "font-weight": 1, "font-style": 1 };
  function sanitizeRichHtml(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var root = doc.body;
    (function clean(node) {
      var children = Array.prototype.slice.call(node.childNodes);
      children.forEach(function (child) {
        if (child.nodeType === 3) return; // text node, keep as-is
        if (child.nodeType === 8) { node.removeChild(child); return; } // comment node (e.g. Windows clipboard's <!--StartFragment-->) — discard
        if (child.nodeType === 1 && child.tagName === "SPAN" && child.classList.contains("math-chip")) {
          // trusted: regenerate from the stored LaTeX source rather than trusting existing markup
          var tpl = doc.createElement("template");
          tpl.innerHTML = mathChipHtml(child.getAttribute("data-latex") || "");
          while (tpl.content.firstChild) node.insertBefore(tpl.content.firstChild, child);
          node.removeChild(child);
          return;
        }
        if (child.nodeType === 1) {
          // raw KaTeX markup pasted without its math-chip wrapper (e.g. selection copied straight
          // off a rendered formula): rebuild a chip from the hidden TeX annotation instead of letting
          // the generic span/text rules flatten <math> into a garbled mix of glyphs + raw source text.
          var isKatexRoot = child.classList.contains("katex") || child.classList.contains("katex-mathml");
          var isKatexTag = (child.tagName || "").toLowerCase() === "annotation" && (child.getAttribute("encoding") || "") === "application/x-tex";
          if (isKatexRoot || isKatexTag) {
            var ann = isKatexTag ? child : (child.querySelector && child.querySelector('annotation[encoding="application/x-tex"]'));
            var tpl2 = doc.createElement("template");
            tpl2.innerHTML = ann ? mathChipHtml(ann.textContent || "") : "";
            while (tpl2.content.firstChild) node.insertBefore(tpl2.content.firstChild, child);
            node.removeChild(child);
            return;
          }
          if (child.classList.contains("katex-html")) {
            // pure visual duplicate of the annotation above — drop it, it carries no source info
            node.removeChild(child);
            return;
          }
        }
        if (child.nodeType !== 1 || !RTE_ALLOWED_TAGS[child.tagName]) {
          var text = doc.createTextNode(child.textContent || "");
          node.replaceChild(text, child);
          return;
        }
        clean(child);
        var keptStyle = "";
        if (child.style) {
          for (var i = 0; i < child.style.length; i++) {
            var prop = child.style[i];
            if (RTE_ALLOWED_STYLES[prop]) keptStyle += prop + ":" + child.style.getPropertyValue(prop) + ";";
          }
        }
        Array.prototype.slice.call(child.attributes || []).forEach(function (a) { child.removeAttribute(a.name); });
        if (keptStyle) child.setAttribute("style", keptStyle);
      });
    })(root);
    return root.innerHTML;
  }
  /* ---------------- Tableau périodique ---------------- */
  var PERIODIC_CATS = {
    hydrogene: { label: "Hydrogène", color: "#9BC49B" },
    alcalin: { label: "Métal alcalin", color: "#E8846B" },
    "alcalino-terreux": { label: "Alcalino-terreux", color: "#E8B36B" },
    "metal-transition": { label: "Métal de transition", color: "#E8D26B" },
    "metal-pauvre": { label: "Métal pauvre", color: "#9EC7E8" },
    metalloide: { label: "Métalloïde", color: "#8FC7A8" },
    "non-metal": { label: "Non-métal", color: "#8FE0C7" },
    halogene: { label: "Halogène", color: "#F0E36B" },
    "gaz-noble": { label: "Gaz noble", color: "#C7A8E8" },
    lanthanide: { label: "Lanthanide", color: "#C79EE8" },
    actinide: { label: "Actinide", color: "#E89EC7" }
  };
  // z, symbole, nom, masse atomique, catégorie, période réelle, groupe (colonne), ligne d'affichage dans la grille, état à 20°C
  // point de fusion °C, point d'ébullition °C, année de découverte, découvreur(s) — "—" quand la valeur n'est pas déterminée
  var PERIODIC_EXTRA = {
    H: ["-259.16", "-252.87", "1766", "Henry Cavendish"], He: ["-272.2", "-268.93", "1868", "Pierre Janssen et Norman Lockyer"],
    Li: ["180.5", "1342", "1817", "Johan August Arfwedson"], Be: ["1287", "2469", "1798", "Louis-Nicolas Vauquelin"],
    B: ["2076", "3927", "1808", "Joseph Louis Gay-Lussac et Louis Jacques Thénard"], C: ["3550", "4027", "Antiquité", "Connu depuis la préhistoire"],
    N: ["-210.1", "-195.79", "1772", "Daniel Rutherford"], O: ["-218.79", "-182.96", "1774", "Joseph Priestley et Carl Wilhelm Scheele"],
    F: ["-219.67", "-188.11", "1886", "Henri Moissan"], Ne: ["-248.59", "-246.05", "1898", "William Ramsay et Morris Travers"],
    Na: ["97.79", "882.9", "1807", "Humphry Davy"], Mg: ["650", "1090", "1808", "Humphry Davy"],
    Al: ["660.32", "2519", "1825", "Hans Christian Ørsted"], Si: ["1414", "3265", "1824", "Jöns Jacob Berzelius"],
    P: ["44.15", "280.5", "1669", "Hennig Brand"], S: ["115.21", "444.6", "Antiquité", "Connu depuis l'Antiquité"],
    Cl: ["-101.5", "-34.04", "1774", "Carl Wilhelm Scheele"], Ar: ["-189.34", "-185.85", "1894", "Lord Rayleigh et William Ramsay"],
    K: ["63.38", "759", "1807", "Humphry Davy"], Ca: ["842", "1484", "1808", "Humphry Davy"],
    Sc: ["1541", "2836", "1879", "Lars Fredrik Nilson"], Ti: ["1668", "3287", "1791", "William Gregor"],
    V: ["1910", "3407", "1801", "Andrés Manuel del Río"], Cr: ["1907", "2671", "1797", "Louis Nicolas Vauquelin"],
    Mn: ["1246", "2061", "1774", "Johan Gottlieb Gahn"], Fe: ["1538", "2862", "Antiquité", "Connu depuis l'Antiquité"],
    Co: ["1495", "2927", "1735", "Georg Brandt"], Ni: ["1455", "2913", "1751", "Axel Fredrik Cronstedt"],
    Cu: ["1084.6", "2562", "Antiquité", "Connu depuis l'Antiquité"], Zn: ["419.53", "907", "1746", "Andreas Sigismund Marggraf"],
    Ga: ["29.76", "2204", "1875", "Paul-Émile Lecoq de Boisbaudran"], Ge: ["938.25", "2833", "1886", "Clemens Winkler"],
    As: ["817", "614", "vers 1250", "Albertus Magnus"], Se: ["221", "685", "1817", "Jöns Jacob Berzelius"],
    Br: ["-7.2", "58.8", "1826", "Antoine Balard"], Kr: ["-157.36", "-153.22", "1898", "William Ramsay et Morris Travers"],
    Rb: ["39.31", "688", "1861", "Robert Bunsen et Gustav Kirchhoff"], Sr: ["777", "1382", "1808", "Humphry Davy"],
    Y: ["1526", "3336", "1794", "Johan Gadolin"], Zr: ["1855", "4409", "1789", "Martin Heinrich Klaproth"],
    Nb: ["2477", "4744", "1801", "Charles Hatchett"], Mo: ["2623", "4639", "1778", "Carl Wilhelm Scheele"],
    Tc: ["2157", "4265", "1937", "Carlo Perrier et Emilio Segrè"], Ru: ["2334", "4150", "1844", "Karl Ernst Claus"],
    Rh: ["1964", "3695", "1803", "William Hyde Wollaston"], Pd: ["1554.9", "2963", "1803", "William Hyde Wollaston"],
    Ag: ["961.78", "2162", "Antiquité", "Connu depuis l'Antiquité"], Cd: ["321.07", "767", "1817", "Friedrich Stromeyer"],
    In: ["156.6", "2072", "1863", "Ferdinand Reich et Hieronymous Theodor Richter"], Sn: ["231.93", "2602", "Antiquité", "Connu depuis l'Antiquité"],
    Sb: ["630.63", "1587", "Antiquité", "Connu depuis l'Antiquité"], Te: ["449.51", "988", "1782", "Franz-Joseph Müller von Reichenstein"],
    I: ["113.7", "184.3", "1811", "Bernard Courtois"], Xe: ["-111.75", "-108.1", "1898", "William Ramsay et Morris Travers"],
    Cs: ["28.44", "671", "1860", "Robert Bunsen et Gustav Kirchhoff"], Ba: ["727", "1897", "1808", "Humphry Davy"],
    La: ["920", "3464", "1839", "Carl Gustaf Mosander"], Ce: ["795", "3443", "1803", "Jöns Jacob Berzelius et Wilhelm Hisinger"],
    Pr: ["935", "3130", "1885", "Carl Auer von Welsbach"], Nd: ["1024", "3074", "1885", "Carl Auer von Welsbach"],
    Pm: ["1042", "3000", "1945", "Jacob Marinsky, Lawrence Glendenin et Charles Coryell"], Sm: ["1072", "1794", "1879", "Paul-Émile Lecoq de Boisbaudran"],
    Eu: ["826", "1529", "1901", "Eugène-Anatole Demarçay"], Gd: ["1312", "3273", "1880", "Jean Charles Galissard de Marignac"],
    Tb: ["1356", "3230", "1843", "Carl Gustaf Mosander"], Dy: ["1407", "2567", "1886", "Paul-Émile Lecoq de Boisbaudran"],
    Ho: ["1461", "2720", "1878", "Jacques-Louis Soret et Marc Delafontaine"], Er: ["1529", "2868", "1843", "Carl Gustaf Mosander"],
    Tm: ["1545", "1950", "1879", "Per Teodor Cleve"], Yb: ["824", "1196", "1878", "Jean Charles Galissard de Marignac"],
    Lu: ["1652", "3402", "1907", "Georges Urbain"], Hf: ["2233", "4603", "1923", "Dirk Coster et George de Hevesy"],
    Ta: ["3017", "5458", "1802", "Anders Gustaf Ekeberg"], W: ["3422", "5555", "1783", "Juan José et Fausto Elhuyar"],
    Re: ["3186", "5596", "1925", "Walter et Ida Noddack, Otto Berg"], Os: ["3033", "5012", "1803", "Smithson Tennant"],
    Ir: ["2446", "4428", "1803", "Smithson Tennant"], Pt: ["1768.3", "3825", "1735", "Antonio de Ulloa"],
    Au: ["1064.18", "2856", "Antiquité", "Connu depuis l'Antiquité"], Hg: ["-38.83", "356.73", "Antiquité", "Connu depuis l'Antiquité"],
    Tl: ["304", "1473", "1861", "William Crookes"], Pb: ["327.46", "1749", "Antiquité", "Connu depuis l'Antiquité"],
    Bi: ["271.4", "1564", "1753", "Claude François Geoffroy"], Po: ["254", "962", "1898", "Marie et Pierre Curie"],
    At: ["302", "337", "1940", "Dale Corson, Kenneth MacKenzie et Emilio Segrè"], Rn: ["-71", "-61.7", "1900", "Friedrich Ernst Dorn"],
    Fr: ["27", "677", "1939", "Marguerite Perey"], Ra: ["700", "1737", "1898", "Marie et Pierre Curie"],
    Ac: ["1050", "3200", "1899", "André-Louis Debierne"], Th: ["1750", "4788", "1829", "Jöns Jacob Berzelius"],
    Pa: ["1568", "4027", "1913", "Kasimir Fajans et Oswald Göhring"], U: ["1132.2", "4131", "1789", "Martin Heinrich Klaproth"],
    Np: ["644", "3902", "1940", "Edwin McMillan et Philip Abelson"], Pu: ["639.4", "3228", "1940", "Glenn Seaborg et son équipe"],
    Am: ["1176", "2607", "1944", "Glenn Seaborg et son équipe"], Cm: ["1345", "3110", "1944", "Glenn Seaborg et son équipe"],
    Bk: ["986", "—", "1949", "Glenn Seaborg et son équipe"], Cf: ["900", "—", "1950", "Glenn Seaborg et son équipe"],
    Es: ["860", "—", "1952", "Albert Ghiorso et son équipe"], Fm: ["1527", "—", "1952", "Albert Ghiorso et son équipe"],
    Md: ["827", "—", "1955", "Albert Ghiorso et son équipe"], No: ["827", "—", "1966", "JINR Dubna"],
    Lr: ["1627", "—", "1961", "Berkeley (Ghiorso et al.)"], Rf: ["—", "—", "1964", "JINR Dubna"],
    Db: ["—", "—", "1970", "JINR Dubna / Berkeley"], Sg: ["—", "—", "1974", "Berkeley"],
    Bh: ["—", "—", "1981", "GSI Darmstadt"], Hs: ["—", "—", "1984", "GSI Darmstadt"],
    Mt: ["—", "—", "1982", "GSI Darmstadt"], Ds: ["—", "—", "1994", "GSI Darmstadt"],
    Rg: ["—", "—", "1994", "GSI Darmstadt"], Cn: ["—", "—", "1996", "GSI Darmstadt"],
    Nh: ["—", "—", "2004", "RIKEN (Japon)"], Fl: ["—", "—", "1998", "JINR Dubna"],
    Mc: ["—", "—", "2003", "JINR Dubna / Livermore"], Lv: ["—", "—", "2000", "JINR Dubna / Livermore"],
    Ts: ["—", "—", "2010", "JINR Dubna / Oak Ridge / Vanderbilt"], Og: ["—", "—", "2002", "JINR Dubna / Livermore"]
  };
  var PERIODIC_ELEMENTS = [
    [1, "H", "Hydrogène", "1.008", "hydrogene", 1, 1, 1, "gaz"], [2, "He", "Hélium", "4.003", "gaz-noble", 1, 18, 1, "gaz"],
    [3, "Li", "Lithium", "6.94", "alcalin", 2, 1, 2, "solide"], [4, "Be", "Béryllium", "9.012", "alcalino-terreux", 2, 2, 2, "solide"],
    [5, "B", "Bore", "10.81", "metalloide", 2, 13, 2, "solide"], [6, "C", "Carbone", "12.011", "non-metal", 2, 14, 2, "solide"],
    [7, "N", "Azote", "14.007", "non-metal", 2, 15, 2, "gaz"], [8, "O", "Oxygène", "15.999", "non-metal", 2, 16, 2, "gaz"],
    [9, "F", "Fluor", "18.998", "halogene", 2, 17, 2, "gaz"], [10, "Ne", "Néon", "20.180", "gaz-noble", 2, 18, 2, "gaz"],
    [11, "Na", "Sodium", "22.990", "alcalin", 3, 1, 3, "solide"], [12, "Mg", "Magnésium", "24.305", "alcalino-terreux", 3, 2, 3, "solide"],
    [13, "Al", "Aluminium", "26.982", "metal-pauvre", 3, 13, 3, "solide"], [14, "Si", "Silicium", "28.085", "metalloide", 3, 14, 3, "solide"],
    [15, "P", "Phosphore", "30.974", "non-metal", 3, 15, 3, "solide"], [16, "S", "Soufre", "32.06", "non-metal", 3, 16, 3, "solide"],
    [17, "Cl", "Chlore", "35.45", "halogene", 3, 17, 3, "gaz"], [18, "Ar", "Argon", "39.948", "gaz-noble", 3, 18, 3, "gaz"],
    [19, "K", "Potassium", "39.098", "alcalin", 4, 1, 4, "solide"], [20, "Ca", "Calcium", "40.078", "alcalino-terreux", 4, 2, 4, "solide"],
    [21, "Sc", "Scandium", "44.956", "metal-transition", 4, 3, 4, "solide"], [22, "Ti", "Titane", "47.867", "metal-transition", 4, 4, 4, "solide"],
    [23, "V", "Vanadium", "50.942", "metal-transition", 4, 5, 4, "solide"], [24, "Cr", "Chrome", "51.996", "metal-transition", 4, 6, 4, "solide"],
    [25, "Mn", "Manganèse", "54.938", "metal-transition", 4, 7, 4, "solide"], [26, "Fe", "Fer", "55.845", "metal-transition", 4, 8, 4, "solide"],
    [27, "Co", "Cobalt", "58.933", "metal-transition", 4, 9, 4, "solide"], [28, "Ni", "Nickel", "58.693", "metal-transition", 4, 10, 4, "solide"],
    [29, "Cu", "Cuivre", "63.546", "metal-transition", 4, 11, 4, "solide"], [30, "Zn", "Zinc", "65.38", "metal-transition", 4, 12, 4, "solide"],
    [31, "Ga", "Gallium", "69.723", "metal-pauvre", 4, 13, 4, "solide"], [32, "Ge", "Germanium", "72.630", "metalloide", 4, 14, 4, "solide"],
    [33, "As", "Arsenic", "74.922", "metalloide", 4, 15, 4, "solide"], [34, "Se", "Sélénium", "78.971", "non-metal", 4, 16, 4, "solide"],
    [35, "Br", "Brome", "79.904", "halogene", 4, 17, 4, "liquide"], [36, "Kr", "Krypton", "83.798", "gaz-noble", 4, 18, 4, "gaz"],
    [37, "Rb", "Rubidium", "85.468", "alcalin", 5, 1, 5, "solide"], [38, "Sr", "Strontium", "87.62", "alcalino-terreux", 5, 2, 5, "solide"],
    [39, "Y", "Yttrium", "88.906", "metal-transition", 5, 3, 5, "solide"], [40, "Zr", "Zirconium", "91.224", "metal-transition", 5, 4, 5, "solide"],
    [41, "Nb", "Niobium", "92.906", "metal-transition", 5, 5, 5, "solide"], [42, "Mo", "Molybdène", "95.95", "metal-transition", 5, 6, 5, "solide"],
    [43, "Tc", "Technétium", "[98]", "metal-transition", 5, 7, 5, "solide"], [44, "Ru", "Ruthénium", "101.07", "metal-transition", 5, 8, 5, "solide"],
    [45, "Rh", "Rhodium", "102.906", "metal-transition", 5, 9, 5, "solide"], [46, "Pd", "Palladium", "106.42", "metal-transition", 5, 10, 5, "solide"],
    [47, "Ag", "Argent", "107.868", "metal-transition", 5, 11, 5, "solide"], [48, "Cd", "Cadmium", "112.414", "metal-transition", 5, 12, 5, "solide"],
    [49, "In", "Indium", "114.818", "metal-pauvre", 5, 13, 5, "solide"], [50, "Sn", "Étain", "118.710", "metal-pauvre", 5, 14, 5, "solide"],
    [51, "Sb", "Antimoine", "121.760", "metalloide", 5, 15, 5, "solide"], [52, "Te", "Tellure", "127.60", "metalloide", 5, 16, 5, "solide"],
    [53, "I", "Iode", "126.904", "halogene", 5, 17, 5, "solide"], [54, "Xe", "Xénon", "131.293", "gaz-noble", 5, 18, 5, "gaz"],
    [55, "Cs", "Césium", "132.905", "alcalin", 6, 1, 6, "solide"], [56, "Ba", "Baryum", "137.327", "alcalino-terreux", 6, 2, 6, "solide"],
    [57, "La", "Lanthane", "138.905", "lanthanide", 6, 3, 9, "solide"], [58, "Ce", "Cérium", "140.116", "lanthanide", 6, 4, 9, "solide"],
    [59, "Pr", "Praséodyme", "140.908", "lanthanide", 6, 5, 9, "solide"], [60, "Nd", "Néodyme", "144.242", "lanthanide", 6, 6, 9, "solide"],
    [61, "Pm", "Prométhium", "[145]", "lanthanide", 6, 7, 9, "solide"], [62, "Sm", "Samarium", "150.36", "lanthanide", 6, 8, 9, "solide"],
    [63, "Eu", "Europium", "151.964", "lanthanide", 6, 9, 9, "solide"], [64, "Gd", "Gadolinium", "157.25", "lanthanide", 6, 10, 9, "solide"],
    [65, "Tb", "Terbium", "158.925", "lanthanide", 6, 11, 9, "solide"], [66, "Dy", "Dysprosium", "162.500", "lanthanide", 6, 12, 9, "solide"],
    [67, "Ho", "Holmium", "164.930", "lanthanide", 6, 13, 9, "solide"], [68, "Er", "Erbium", "167.259", "lanthanide", 6, 14, 9, "solide"],
    [69, "Tm", "Thulium", "168.934", "lanthanide", 6, 15, 9, "solide"], [70, "Yb", "Ytterbium", "173.045", "lanthanide", 6, 16, 9, "solide"],
    [71, "Lu", "Lutécium", "174.967", "lanthanide", 6, 17, 9, "solide"],
    [72, "Hf", "Hafnium", "178.49", "metal-transition", 6, 4, 6, "solide"], [73, "Ta", "Tantale", "180.948", "metal-transition", 6, 5, 6, "solide"],
    [74, "W", "Tungstène", "183.84", "metal-transition", 6, 6, 6, "solide"], [75, "Re", "Rhénium", "186.207", "metal-transition", 6, 7, 6, "solide"],
    [76, "Os", "Osmium", "190.23", "metal-transition", 6, 8, 6, "solide"], [77, "Ir", "Iridium", "192.217", "metal-transition", 6, 9, 6, "solide"],
    [78, "Pt", "Platine", "195.084", "metal-transition", 6, 10, 6, "solide"], [79, "Au", "Or", "196.967", "metal-transition", 6, 11, 6, "solide"],
    [80, "Hg", "Mercure", "200.592", "metal-transition", 6, 12, 6, "liquide"], [81, "Tl", "Thallium", "204.38", "metal-pauvre", 6, 13, 6, "solide"],
    [82, "Pb", "Plomb", "207.2", "metal-pauvre", 6, 14, 6, "solide"], [83, "Bi", "Bismuth", "208.980", "metal-pauvre", 6, 15, 6, "solide"],
    [84, "Po", "Polonium", "[209]", "metal-pauvre", 6, 16, 6, "solide"], [85, "At", "Astate", "[210]", "halogene", 6, 17, 6, "solide"],
    [86, "Rn", "Radon", "[222]", "gaz-noble", 6, 18, 6, "gaz"],
    [87, "Fr", "Francium", "[223]", "alcalin", 7, 1, 7, "solide"], [88, "Ra", "Radium", "[226]", "alcalino-terreux", 7, 2, 7, "solide"],
    [89, "Ac", "Actinium", "[227]", "actinide", 7, 3, 10, "solide"], [90, "Th", "Thorium", "232.038", "actinide", 7, 4, 10, "solide"],
    [91, "Pa", "Protactinium", "231.036", "actinide", 7, 5, 10, "solide"], [92, "U", "Uranium", "238.029", "actinide", 7, 6, 10, "solide"],
    [93, "Np", "Neptunium", "[237]", "actinide", 7, 7, 10, "solide"], [94, "Pu", "Plutonium", "[244]", "actinide", 7, 8, 10, "solide"],
    [95, "Am", "Américium", "[243]", "actinide", 7, 9, 10, "solide"], [96, "Cm", "Curium", "[247]", "actinide", 7, 10, 10, "solide"],
    [97, "Bk", "Berkélium", "[247]", "actinide", 7, 11, 10, "solide"], [98, "Cf", "Californium", "[251]", "actinide", 7, 12, 10, "solide"],
    [99, "Es", "Einsteinium", "[252]", "actinide", 7, 13, 10, "solide"], [100, "Fm", "Fermium", "[257]", "actinide", 7, 14, 10, "solide"],
    [101, "Md", "Mendélévium", "[258]", "actinide", 7, 15, 10, "solide"], [102, "No", "Nobélium", "[259]", "actinide", 7, 16, 10, "solide"],
    [103, "Lr", "Lawrencium", "[266]", "actinide", 7, 17, 10, "solide"],
    [104, "Rf", "Rutherfordium", "[267]", "metal-transition", 7, 4, 7, "solide"], [105, "Db", "Dubnium", "[268]", "metal-transition", 7, 5, 7, "solide"],
    [106, "Sg", "Seaborgium", "[269]", "metal-transition", 7, 6, 7, "solide"], [107, "Bh", "Bohrium", "[270]", "metal-transition", 7, 7, 7, "solide"],
    [108, "Hs", "Hassium", "[269]", "metal-transition", 7, 8, 7, "solide"], [109, "Mt", "Meitnérium", "[278]", "metal-transition", 7, 9, 7, "solide"],
    [110, "Ds", "Darmstadtium", "[281]", "metal-transition", 7, 10, 7, "solide"], [111, "Rg", "Roentgenium", "[282]", "metal-transition", 7, 11, 7, "solide"],
    [112, "Cn", "Copernicium", "[285]", "metal-transition", 7, 12, 7, "solide"], [113, "Nh", "Nihonium", "[286]", "metal-pauvre", 7, 13, 7, "solide"],
    [114, "Fl", "Flerovium", "[289]", "metal-pauvre", 7, 14, 7, "solide"], [115, "Mc", "Moscovium", "[290]", "metal-pauvre", 7, 15, 7, "solide"],
    [116, "Lv", "Livermorium", "[293]", "metal-pauvre", 7, 16, 7, "solide"], [117, "Ts", "Tennesse", "[294]", "halogene", 7, 17, 7, "solide"],
    [118, "Og", "Oganesson", "[294]", "gaz-noble", 7, 18, 7, "gaz"]
  ].map(function (a) {
    var extra = PERIODIC_EXTRA[a[1]] || ["—", "—", "—", "—"];
    return { z: a[0], sym: a[1], name: a[2], mass: a[3], cat: a[4], period: a[5], group: a[6], row: a[7], state: a[8], melt: extra[0], boil: extra[1], year: extra[2], by: extra[3] };
  });
  var PERIODIC_BY_SYM = {};
  PERIODIC_ELEMENTS.forEach(function (e) { PERIODIC_BY_SYM[e.sym] = e; });

  function periodicGridHtml() {
    return '<div class="periodic-grid">' + PERIODIC_ELEMENTS.map(function (e) {
      var color = PERIODIC_CATS[e.cat].color;
      return '<button type="button" class="periodic-cell" style="grid-row:' + e.row + ';grid-column:' + e.group + ';background:' + color + '" onclick="App.selectPeriodicElement(\'' + e.sym + '\')" title="' + esc(e.name) + '">' +
        '<span class="periodic-z">' + e.z + '</span><span class="periodic-sym">' + e.sym + '</span>' +
        '</button>';
    }).join("") + '</div>';
  }
  function periodicLegendHtml() {
    return '<div class="periodic-legend">' + Object.keys(PERIODIC_CATS).map(function (k) {
      return '<span class="periodic-legend-item"><span class="periodic-legend-dot" style="background:' + PERIODIC_CATS[k].color + '"></span>' + PERIODIC_CATS[k].label + '</span>';
    }).join("") + '</div>';
  }
  function periodicDetailHtml(sym) {
    var e = PERIODIC_BY_SYM[sym];
    if (!e) return "";
    var color = PERIODIC_CATS[e.cat].color;
    return '<div class="periodic-detail" style="border-color:' + color + '">' +
      '<div class="periodic-detail-badge" style="background:' + color + '"><span class="periodic-detail-z">' + e.z + '</span><span class="periodic-detail-sym">' + e.sym + '</span></div>' +
      '<div class="periodic-detail-body">' +
      '<div class="periodic-detail-name">' + esc(e.name) + '</div>' +
      '<div class="periodic-detail-info">' +
      '<span>Masse atomique : <strong>' + e.mass + '</strong></span>' +
      '<span>Catégorie : <strong>' + PERIODIC_CATS[e.cat].label + '</strong></span>' +
      '<span>État à 20°C : <strong>' + e.state + '</strong></span>' +
      '<span>Période ' + e.period + (e.cat === "lanthanide" || e.cat === "actinide" ? "" : ' · Groupe ' + e.group) + '</span>' +
      '<span>Point de fusion : <strong>' + e.melt + (e.melt === "—" ? "" : " °C") + '</strong></span>' +
      '<span>Point d\'ébullition : <strong>' + e.boil + (e.boil === "—" ? "" : " °C") + '</strong></span>' +
      '<span>Découverte : <strong>' + esc(e.year) + '</strong></span>' +
      '<span>Découvreur(s) : <strong>' + esc(e.by) + '</strong></span>' +
      '</div>' +
      '<button type="button" class="btn btn-sm btn-primary" onclick="App.insertPeriodicElement()">Insérer le symbole</button>' +
      '</div>' +
      '</div>';
  }

  function richEditorHtml(id, placeholder, initialHtml, tall) {
    return '<div class="rte-toolbar">' +
      '<button type="button" class="rte-btn" style="font-weight:800" onmousedown="event.preventDefault()" onclick="App.rteCmd(\'' + id + '\',\'bold\')">G</button>' +
      '<button type="button" class="rte-btn" style="font-style:italic" onmousedown="event.preventDefault()" onclick="App.rteCmd(\'' + id + '\',\'italic\')">I</button>' +
      '<button type="button" class="rte-btn" style="text-decoration:underline" onmousedown="event.preventDefault()" onclick="App.rteCmd(\'' + id + '\',\'underline\')">S</button>' +
      '<button type="button" class="rte-btn" onmousedown="event.preventDefault()" onclick="App.rteCmd(\'' + id + '\',\'backColor\',\'#fff2a8\')">🖍️ Surligner</button>' +
      '<input type="color" class="rte-color" title="Couleur du texte" value="#e63946" onmousedown="event.preventDefault()" onchange="App.rteCmd(\'' + id + '\',\'foreColor\',this.value)">' +
      '<button type="button" class="rte-btn" onmousedown="event.preventDefault()" onclick="App.openLatexPicker(\'' + id + '\')">∑ LaTeX</button>' +
      '<button type="button" class="rte-btn" onmousedown="event.preventDefault()" onclick="App.openPeriodicTable(\'' + id + '\')">🧪 Tableau périodique</button>' +
      '<span class="rte-sep"></span>' +
      '<button type="button" class="rte-btn" onmousedown="event.preventDefault()" onclick="App.openTablePicker(\'' + id + '\')">▦ Tableau</button>' +
      '</div>' +
      '<div class="rte-editor' + (tall ? " rte-editor-tall" : "") + '" id="' + id + '" contenteditable="true" data-placeholder="' + esc(placeholder || "") + '">' + (initialHtml || "") + '</div>';
  }
  function rteMakeTd() {
    var td = document.createElement("td");
    td.innerHTML = "<br>";
    td.oncontextmenu = function (e) { rteOpenCellMenu(e, td); };
    return td;
  }
  function rteBuildTableFragment(rows, cols) {
    var frag = document.createDocumentFragment();
    var table = document.createElement("table");
    var tbody = document.createElement("tbody");
    for (var r = 0; r < rows; r++) {
      var tr = document.createElement("tr");
      for (var c = 0; c < cols; c++) tr.appendChild(rteMakeTd());
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    frag.appendChild(table);
    var afterLine = document.createElement("div");
    afterLine.innerHTML = "<br>";
    frag.appendChild(afterLine);
    return frag;
  }

  /* ---------------- Menu clic droit sur une cellule de tableau ---------------- */
  var rteMenuEl = null;
  function rteCloseCellMenu() {
    if (rteMenuEl) { rteMenuEl.remove(); rteMenuEl = null; }
    document.removeEventListener("mousedown", rteCloseCellMenuOnOutside, true);
    document.removeEventListener("keydown", rteCloseCellMenuOnEsc, true);
  }
  function rteCloseCellMenuOnOutside(e) { if (rteMenuEl && !rteMenuEl.contains(e.target)) rteCloseCellMenu(); }
  function rteCloseCellMenuOnEsc(e) { if (e.key === "Escape") rteCloseCellMenu(); }
  function rteMenuItem(label, fn) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "rte-cellmenu-item";
    b.textContent = label;
    b.onmousedown = function (e) { e.preventDefault(); };
    b.onclick = function () { fn(); rteCloseCellMenu(); };
    return b;
  }
  function rteOpenCellMenu(e, cell) {
    e.preventDefault();
    rteCloseCellMenu();
    var menu = document.createElement("div");
    menu.className = "rte-cellmenu";
    menu.appendChild(rteMenuItem("⬆️ Ajouter une ligne au-dessus", function () { rteInsertRow(cell, "above"); }));
    menu.appendChild(rteMenuItem("⬇️ Ajouter une ligne en-dessous", function () { rteInsertRow(cell, "below"); }));
    menu.appendChild(rteMenuItem("⬅️ Ajouter une colonne à gauche", function () { rteInsertCol(cell, "left"); }));
    menu.appendChild(rteMenuItem("➡️ Ajouter une colonne à droite", function () { rteInsertCol(cell, "right"); }));
    menu.appendChild(rteMenuItem("🗑️ Supprimer cette ligne", function () { rteDeleteRow(cell); }));
    menu.appendChild(rteMenuItem("🗑️ Supprimer cette colonne", function () { rteDeleteCol(cell); }));
    document.body.appendChild(menu);
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.min(e.pageX, document.documentElement.scrollWidth - mw - 8) + "px";
    menu.style.top = Math.min(e.pageY, window.scrollY + window.innerHeight - mh - 8) + "px";
    rteMenuEl = menu;
    setTimeout(function () {
      document.addEventListener("mousedown", rteCloseCellMenuOnOutside, true);
      document.addEventListener("keydown", rteCloseCellMenuOnEsc, true);
    }, 0);
  }
  function rteInsertRow(cell, dir) {
    var row = cell.closest("tr");
    var cellCount = row.children.length;
    var newRow = document.createElement("tr");
    for (var i = 0; i < cellCount; i++) newRow.appendChild(rteMakeTd());
    if (dir === "above") row.parentNode.insertBefore(newRow, row);
    else row.parentNode.insertBefore(newRow, row.nextSibling);
  }
  function rteDeleteRow(cell) {
    var row = cell.closest("tr");
    var tbody = row.parentNode;
    if (tbody.children.length <= 1) { toast("Le tableau doit garder au moins une ligne."); return; }
    row.remove();
  }
  function rteInsertCol(cell, dir) {
    var row = cell.closest("tr");
    var table = cell.closest("table");
    var idx = Array.prototype.indexOf.call(row.children, cell);
    var insertIdx = dir === "left" ? idx : idx + 1;
    Array.prototype.forEach.call(table.querySelectorAll("tr"), function (r) {
      var td = rteMakeTd();
      if (r.children[insertIdx]) r.insertBefore(td, r.children[insertIdx]);
      else r.appendChild(td);
    });
  }
  function rteDeleteCol(cell) {
    var row = cell.closest("tr");
    var table = cell.closest("table");
    if (row.children.length <= 1) { toast("Le tableau doit garder au moins une colonne."); return; }
    var idx = Array.prototype.indexOf.call(row.children, cell);
    Array.prototype.forEach.call(table.querySelectorAll("tr"), function (r) {
      if (r.children[idx]) r.children[idx].remove();
    });
  }
  function rteValue(id) {
    var el = document.getElementById(id);
    return el ? sanitizeRichHtml(el.innerHTML) : "";
  }
  function rteExtractText(node) {
    var out = "";
    Array.prototype.slice.call(node.childNodes).forEach(function (child) {
      if (child.nodeType === 3) { out += child.nodeValue; return; }
      if (child.nodeType !== 1) return;
      if (child.classList && child.classList.contains("math-chip")) {
        out += "$" + (child.getAttribute("data-latex") || "") + "$";
        return;
      }
      if (child.tagName === "BR") { out += "\n"; return; }
      var childText = rteExtractText(child);
      if (child.tagName === "TD") { out += childText + "\t"; return; }
      if (child.tagName === "TR") { out += childText + "\n"; return; }
      if (child.tagName === "DIV" || child.tagName === "P") {
        // La toute première ligne tapée dans un éditeur vide reste souvent un simple nœud texte SANS
        // wrapper (seules les lignes suivantes, créées par Entrée, sont de vraies <div>) : sans ce
        // garde-fou, "mot1" (texte brut) suivi de "<div>mot2</div>" perdait le saut de ligne entre les
        // deux et les collait en "mot1mot2" aux yeux de l'IA qui corrige, même si l'élève avait bien
        // tapé chaque mot sur sa propre ligne.
        if (out && !/\n$/.test(out)) out += "\n";
        out += childText + "\n";
        return;
      }
      out += childText;
    });
    return out;
  }
  function rteText(id) {
    var el = document.getElementById(id);
    return el ? rteExtractText(el).trim() : "";
  }

  /* ---------------- LaTeX formula picker (MathLive) ---------------- */
  // Répare les motifs les plus fréquents qui font échouer KaTeX sans que ce soit une vraie erreur de
  // fond (ex. "\,^{\circ}C" pour "°C" : une commande d'espacement juste avant un exposant n'a pas de
  // "base" valide à côté de laquelle s'accrocher, donc KaTeX refuse TOUTE la formule). Un groupe vide
  // {} juste avant répare ça sans rien changer visuellement.
  function repairLatexForKatex(s) {
    s = String(s || "");
    s = s.replace(/(\\[,;:! ])(\^|_)/g, "$1{}$2");
    s = s.replace(/^(\^|_)/, "{}$1");
    return s;
  }
  // Dernier recours si même après réparation KaTeX refuse toujours la formule : plutôt que son texte
  // d'erreur rouge illisible par défaut, on affiche une version texte simple mais lisible (symboles
  // les plus courants convertis à la main, le reste des commandes juste retirées).
  var LATEX_PLAIN_SYMBOLS = {
    circ: "°", times: "×", cdot: "·", pm: "±", mp: "∓", div: "÷",
    mu: "μ", pi: "π", infty: "∞", leq: "≤", geq: "≥", neq: "≠", approx: "≈",
    rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", sqrt: "√",
    Delta: "Δ", delta: "δ", alpha: "α", beta: "β", gamma: "γ", theta: "θ",
    lambda: "λ", sigma: "σ", Omega: "Ω", omega: "ω"
  };
  function latexToPlainFallback(s) {
    s = String(s || "");
    s = s.replace(/\\(?:text|mathrm|mathbf|operatorname)\{([^{}]*)\}/g, "$1");
    s = s.replace(/\\([a-zA-Z]+)/g, function (m, cmd) { return LATEX_PLAIN_SYMBOLS[cmd] !== undefined ? LATEX_PLAIN_SYMBOLS[cmd] : ""; });
    s = s.replace(/[{}]/g, "");
    return s.replace(/\s+/g, " ").trim();
  }
  function katexRenderSafe(latex) {
    if (!window.katex) return esc("$" + latex + "$");
    try {
      return window.katex.renderToString(repairLatexForKatex(latex), { throwOnError: true, macros: KATEX_NO_COLOR_MACROS });
    } catch (e) {
      return '<span class="math-fallback">' + esc(latexToPlainFallback(latex)) + '</span>';
    }
  }
  function mathChipHtml(latex) {
    var zeroWidthSpace = String.fromCharCode(8203);
    var rendered = katexRenderSafe(latex);
    // Filet de sécurité ultime : un élève ne doit JAMAIS voir un simple blanc à la place d'une
    // formule (ni même le fallback texte, s'il finissait lui-même vide pour un cas limite non
    // prévu) — dans ce cas précis seulement, on retombe sur la source brute échappée.
    if (!String(rendered || "").replace(/<[^>]*>/g, "").trim()) rendered = esc(String(latex || ""));
    return '<span class="math-chip" contenteditable="false" data-latex="' + esc(latex) + '" title="Cliquer pour modifier" onclick="App.editLatexChip(this)">' + rendered + '</span>' + zeroWidthSpace;
  }

  /* ---------------- Figures dessinées par l'IA (SVG) ---------------- */
  // Quand un exercice/question généré par l'IA fait référence à un support visuel (figure géométrique,
  // graphique, spectre...), l'IA dessine elle-même le schéma en SVG plutôt que de simplement le décrire
  // sans jamais le montrer. On nettoie ce SVG avant affichage (balises et attributs actifs retirés) au
  // cas où le modèle produirait un jour un balisage inattendu.
  function sanitizeSvg(raw) {
    var m = /<svg[\s\S]*<\/svg>/i.exec(raw || "");
    if (!m) return "";
    try {
      var doc = new DOMParser().parseFromString(m[0], "image/svg+xml");
      var root = doc.documentElement;
      if (!root || root.tagName.toLowerCase() !== "svg" || doc.getElementsByTagName("parsererror").length) return "";
      var DISALLOWED = { script: 1, foreignobject: 1, iframe: 1, embed: 1, object: 1, style: 1 };
      (function clean(node) {
        Array.prototype.slice.call(node.childNodes).forEach(function (child) {
          if (child.nodeType !== 1) return;
          var tag = child.tagName.toLowerCase();
          if (DISALLOWED[tag]) { node.removeChild(child); return; }
          Array.prototype.slice.call(child.attributes || []).forEach(function (attr) {
            var name = attr.name.toLowerCase();
            if (name.indexOf("on") === 0) child.removeAttribute(attr.name);
            else if ((name === "href" || name === "xlink:href") && /^\s*javascript:/i.test(attr.value || "")) child.removeAttribute(attr.name);
          });
          clean(child);
        });
      })(root);
      return new XMLSerializer().serializeToString(root);
    } catch (e) { return ""; }
  }
  function resolveExerciseFigureSvg(item) {
    return (item && item.figureSvg) || "";
  }
  // Un énoncé qui dit "voir le graphique ci-contre" sans qu'aucun schéma n'ait pu être récupéré (photo
  // importée mal cadrée, détection de figure ratée par l'IA...) est tout aussi inutilisable qu'un
  // énoncé sans figureSvg — mais ici on ne peut pas redessiner un graphique arbitraire nous-mêmes (on ne
  // connaît pas sa forme réelle). Le minimum fiable est de détecter ce cas et de prévenir clairement
  // l'élève plutôt que de le laisser deviner pourquoi il ne voit rien.
  // "ci-contre"/"ci-dessous" seuls ne suffisent PAS : ça déclenchait aussi sur "le tableau ci-dessous"
  // (un vrai tableau Markdown, qui n'a besoin d'aucune figure) ou "vu ci-dessus" à propos de texte. On
  // exige donc un mot de visuel (graphique/schéma/figure/courbe/dessin) à proximité immédiate, jamais
  // juste la présence isolée de "ci-contre".
  var MISSING_FIGURE_RE = /\b(?:graphique|sch[ée]mas?|figures?|courbes?|repr[ée]sentation graphique|dessins?|diagrammes?)\b[^.!?\n]{0,50}\bci[\s-]?(?:contre|dessous|joint|apr[eè]s)\b|\bci[\s-]?(?:contre|dessous|joint|apr[eè]s)\b[^.!?\n]{0,50}\b(?:graphique|sch[ée]mas?|figures?|courbes?|repr[ée]sentation graphique|dessins?|diagrammes?)\b/i;
  function statementMissesFigure(text) {
    return !!text && !/\(figure:/.test(text) && MISSING_FIGURE_RE.test(text);
  }
  function exerciseFigureHtml(item) {
    var text = (item && item.prompt) || "";
    if (/\(figure:/.test(text)) return ""; // une vraie image (photo importée) est déjà intégrée au texte via mdToHtml, rien à ajouter ici
    var clean = sanitizeSvg(resolveExerciseFigureSvg(item));
    if (clean) return '<div class="exercise-figure">' + clean + '</div>';
    if (statementMissesFigure(text)) {
      return '<div class="figure-missing-warning">⚠️ Cet énoncé fait référence à un schéma ou un graphique (« ci-contre »/« ci-dessous »…) qui n\'a pas pu être récupéré. Clique sur « 🔄 Régénérer » en haut de la page pour relancer la détection (les photos source sont conservées) ; si ça persiste, réimporte une photo plus nette et mieux cadrée sur ce schéma.</div>';
    }
    return "";
  }
  function rtePlainTextToHtml(text) {
    var html = "";
    var re = /\$\$([^$]+?)\$\$|\$([^$]+?)\$/g;
    var last = 0, m;
    while ((m = re.exec(text))) {
      html += esc(text.slice(last, m.index)).replace(/\n/g, "<br>");
      html += mathChipHtml((m[1] !== undefined ? m[1] : m[2]).trim());
      last = re.lastIndex;
    }
    html += esc(text.slice(last)).replace(/\n/g, "<br>");
    return html;
  }
  function rteChipifyDollarText(node) {
    Array.prototype.slice.call(node.childNodes).forEach(function (child) {
      if (child.nodeType === 1) {
        if (child.classList && child.classList.contains("math-chip")) return;
        rteChipifyDollarText(child);
        return;
      }
      if (child.nodeType !== 3 || !/\$/.test(child.nodeValue)) return;
      var tpl = document.createElement("template");
      tpl.innerHTML = rtePlainTextToHtml(child.nodeValue);
      node.replaceChild(tpl.content, child);
    });
  }
  function rteInsertHtmlAtCaret(editor, html) {
    var sel = window.getSelection();
    var range = (sel && sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) ? sel.getRangeAt(0) : null;
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    var tpl = document.createElement("template");
    tpl.innerHTML = html;
    rteChipifyDollarText(tpl.content);
    var lastNode = tpl.content.lastChild;
    range.deleteContents();
    range.insertNode(tpl.content);
    if (sel) {
      sel.removeAllRanges();
      if (lastNode) {
        var after = document.createRange();
        after.setStartAfter(lastNode);
        after.collapse(true);
        sel.addRange(after);
      }
    }
  }
  document.addEventListener("paste", function (e) {
    var editor = e.target && e.target.closest && e.target.closest(".rte-editor");
    if (!editor) return;
    e.preventDefault();
    var cd = e.clipboardData || window.clipboardData;
    var html = cd ? cd.getData("text/html") : "";
    var text = cd ? cd.getData("text/plain") : "";
    // On préfère toujours le HTML quand il existe : sanitizeRichHtml reconstruit déjà correctement une
    // formule KaTeX collée (elle repère l'annotation LaTeX cachée dans le HTML, cf. plus bas) tout en
    // gardant la mise en forme (listes, titres, tableaux...) — préférer le texte brut dès qu'une formule
    // y était détectée cassait justement cette mise en forme, puisqu'un texte brut n'a plus aucune
    // structure à préserver. Le texte brut ne reste utilisé que quand la source ne fournit AUCUN HTML
    // (ex. le clavier de formule LaTeX de l'appli, qui exporte son "$$...$$" uniquement en texte).
    var insertHtml = html ? sanitizeRichHtml(html) : rtePlainTextToHtml(text);
    rteInsertHtmlAtCaret(editor, insertHtml);
  });

  /* ---------------- PDF export (browser print) ---------------- */
  function buildExercisePrintHtml(title, meta, statementHtml, answerHtml, level, feedback, solutionHtml, mistakes) {
    return '<div class="print-doc">' +
      '<h1>' + esc(title) + '</h1>' +
      (meta ? '<p class="print-meta">' + esc(meta) + '</p>' : '') +
      '<h2>Énoncé</h2><div class="print-block">' + statementHtml + '</div>' +
      '<h2>Ta réponse</h2><div class="print-block">' + (answerHtml || "<em>(vide)</em>") + '</div>' +
      '<h2>Correction</h2>' +
      '<p class="print-verdict ' + (gradeLevelIsSuccess(level) ? "good" : "bad") + '">' + gradeLevelLabel(level) + '</p>' +
      gradeMistakesHtml(mistakes) +
      (feedback ? '<div class="print-block">' + mdToHtml(feedback) + '</div>' : "") +
      '<h2>Solution de référence</h2><div class="print-block">' + solutionHtml + '</div>' +
      '</div>';
  }
  // Mêmes teintes "claires" que la palette de couleur de l'appli (voir style.css, data-app-color),
  // reprises ici tel quel pour que le PDF imprimé (toujours sur fond blanc, quel que soit le mode
  // sombre/clair actuel) corresponde à la couleur choisie par l'élève plutôt qu'un vert fixe.
  var PRINT_HUE_COLORS = {
    vert: { accent: "#4C8C4A", strong: "#3A7038", soft: "#D7ECC9" },
    bleu: { accent: "#2F7FC1", strong: "#25659C", soft: "#D3E7F7" },
    jaune: { accent: "#D9A51B", strong: "#B38613", soft: "#F7E7B0" },
    rose: { accent: "#D44C80", strong: "#B13566", soft: "#F8D3E3" },
    violet: { accent: "#7A4FC4", strong: "#6238A3", soft: "#E4DAF7" },
    rouge: { accent: "#D14B35", strong: "#AC3522", soft: "#F8D2C7" },
    orange: { accent: "#E8862B", strong: "#C56A18", soft: "#FBE4C0" }
  };
  // Le zoom d'impression passait par une variable CSS (--print-scale) consommée dans un calc() du
  // stylesheet statique : correct sur le papier, mais sans effet visible en pratique chez l'utilisateur
  // (même nombre de pages à 100% et à 280%, donc pas juste une histoire de perception). Plutôt que de
  // continuer à deviner quelle subtilité de substitution CSS/imprimante neutralise ce mécanisme, on
  // calcule directement les tailles en pixels ici et on les injecte en dur dans un <style> scopé à
  // cette page imprimée : aucune dépendance à var()/calc(), donc aucune ambiguïté possible. Partagé par
  // toutes les "fiches" imprimables (révision, méthodologie...) pour un même réglage de zoom partout.
  function ficheHueAndScaleStyle() {
    var hue = document.documentElement.getAttribute("data-app-color") || "vert";
    var hc = PRINT_HUE_COLORS[hue] || PRINT_HUE_COLORS.vert;
    var hueStyle = 'style="--fiche-accent:' + hc.accent + ';--fiche-strong:' + hc.strong + ';--fiche-soft:' + hc.soft + '"';
    var scale = getPrintScale();
    function px(n) { return (n * scale).toFixed(2) + "px"; }
    var scaleStyle = '<style>' +
      '.print-fiche-eyebrow{font-size:' + px(11) + '}' +
      '.print-doc-fiche h1{font-size:' + px(27) + '}' +
      '.print-fiche-sub{font-size:' + px(12) + '}' +
      '.print-fiche-body{font-size:' + px(13.5) + '}' +
      '.print-fiche-body h3{font-size:' + px(16) + '}' +
      '.print-fiche-body h4{font-size:' + px(14) + '}' +
      '.print-fiche-body table{font-size:' + px(12.5) + '}' +
      '</style>';
    return { hueStyle: hueStyle, scaleStyle: scaleStyle };
  }
  function buildRevisionSheetPrintHtml(sheet, subjectName, chapterName) {
    var fs = ficheHueAndScaleStyle();
    return fs.scaleStyle + '<div class="print-doc print-doc-fiche" ' + fs.hueStyle + '>' +
      '<div class="print-fiche-header">' +
      '<div class="print-fiche-eyebrow">' + esc(subjectName) + (chapterName ? ' · ' + esc(chapterName) : "") + '</div>' +
      '<h1>' + esc(sheet.title) + '</h1>' +
      '<div class="print-fiche-sub">Fiche de révision' + (sheet.scope === "theme" ? " — thème complet" : sheet.scope === "course" ? "" : " — chapitre complet") + '</div>' +
      '</div>' +
      '<div class="print-fiche-body">' + mdToHtml(sheet.content, sheet.schemas) + '</div>' +
      '</div>';
  }
  function buildCoursePrintHtml(course, subjectName, chapterName, includeExplanation) {
    var fs = ficheHueAndScaleStyle();
    var sections = '<h3>Retranscription</h3>' + mdToHtml(course.transcription, course.figures);
    if (includeExplanation && course.explanation) sections += '<h3>Explication</h3>' + mdToHtml(course.explanation, course.figures);
    return fs.scaleStyle + '<div class="print-doc print-doc-fiche" ' + fs.hueStyle + '>' +
      '<div class="print-fiche-header">' +
      '<div class="print-fiche-eyebrow">' + esc(subjectName) + (chapterName ? ' · ' + esc(chapterName) : "") + '</div>' +
      '<h1>' + esc(course.title) + '</h1>' +
      '<div class="print-fiche-sub">Cours</div>' +
      '</div>' +
      '<div class="print-fiche-body">' + sections + '</div>' +
      '</div>';
  }
  function buildMethodologyPrintHtml(methodo) {
    var fs = ficheHueAndScaleStyle();
    return fs.scaleStyle + '<div class="print-doc print-doc-fiche" ' + fs.hueStyle + '>' +
      '<div class="print-fiche-header">' +
      '<div class="print-fiche-eyebrow">Méthodologie' + (methodo.genre ? ' · ' + esc(methodo.genre) : "") + '</div>' +
      '<h1>' + esc(methodo.title) + '</h1>' +
      '<div class="print-fiche-sub">Fiche de méthode</div>' +
      '</div>' +
      '<div class="print-fiche-body">' + mdToHtml(methodo.structure) + '</div>' +
      '</div>';
  }
  function printAndDownload(html) {
    var area = document.getElementById("print-area");
    if (!area) { area = document.createElement("div"); area.id = "print-area"; document.body.appendChild(area); }
    area.innerHTML = html;
    renderMath();
    setTimeout(function () { window.print(); }, 60);
  }

  function courseFieldEditorHtml(course, field) {
    if (courseEditState && courseEditState.courseId === course.id && courseEditState.field === field) {
      return '<div class="course-field-edit">' +
        '<textarea id="course-field-textarea" class="course-field-textarea">' + esc(course[field] || "") + '</textarea>' +
        '<div class="modal-actions" style="margin-top:10px"><button type="button" class="btn btn-ghost" onclick="App.cancelEditCourseField()">Annuler</button><button type="button" class="btn btn-primary" onclick="App.saveEditCourseField(\'' + course.id + '\',\'' + field + '\')">Enregistrer</button></div>' +
        '</div>';
    }
    var fieldValue = field === "transcription" ? course.transcription : course.explanation;
    var fieldFigureSvg = field === "transcription" ? course.transcriptionFigureSvg : course.explanationFigureSvg;
    return '<div class="prose prose-lesson">' + mdToHtml(fieldValue, course.figures) + '</div>' +
      exerciseFigureHtml({ prompt: fieldValue, figureSvg: fieldFigureSvg }) +
      '<button class="btn btn-ghost btn-sm" style="width:auto;margin-top:14px" onclick="App.startEditCourseField(\'' + course.id + '\',\'' + field + '\')">✏️ Modifier</button>';
  }
  function renderTabBody(course, tab, loc) {
    if (tab === "transcription") {
      return courseFieldEditorHtml(course, "transcription");
    }
    if (tab === "explication") {
      return courseFieldEditorHtml(course, "explanation");
    }
    if (tab === "videos") {
      if (!course.videos || !course.videos.length) {
        return '<p class="dp-empty-note">Aucune vidéo pertinente trouvée pour ce cours' + (course.status === "ready" ? " (recherche en cours ou sans résultat)" : "") + '.</p>';
      }
      return '<span class="demo-badge">Vidéos trouvées sur YouTube</span><div class="video-list">' + course.videos.map(function (v) {
        return '<a class="video-item" href="' + v.url + '" target="_blank" rel="noopener noreferrer"><div class="video-ico">' + icon("play") + '</div><div><div class="video-title">' + esc(v.title) + '</div><div class="video-sub">' + esc(v.sub) + '</div></div></a>';
      }).join("") + '</div>';
    }
    if (tab === "flashcards") return renderFlashcards(course);
    if (tab === "quiz") return renderQuiz(course);
    return "";
  }

  /* ---------------- Flashcards ---------------- */
  function renderFlashcards(course) {
    if (!course.flashcards.length) return '<div class="fc-done"><h3>Aucune flashcard</h3></div>';
    var st = fcState[course.id] || { idx: 0, flipped: false };
    fcState[course.id] = st;
    if (st.idx >= course.flashcards.length) st.idx = course.flashcards.length - 1;
    var card = course.flashcards[st.idx];
    var known = course.flashcards.filter(function (f) { return f.status === "known"; }).length;
    return '<div class="fc-wrap">' +
      '<div class="fc-progress"><span>Carte ' + (st.idx + 1) + ' / ' + course.flashcards.length + '</span><span>' + known + ' su' + (known !== 1 ? "es" : "e") + '</span></div>' +
      '<div class="fc-bar"><div class="fc-bar-fill" style="width:' + Math.round(((st.idx + 1) / course.flashcards.length) * 100) + '%"></div></div>' +
      '<div class="fc-hint">Clique sur la carte pour la retourner</div>' +
      '<div class="flip-card' + (st.flipped ? " flipped" : "") + '" onclick="App.flipCard(\'' + course.id + '\')">' +
      '<div class="flip-inner">' +
      '<div class="flip-face"><span class="flip-eyebrow">Question</span><span class="flip-text">' + esc(card.q) + '</span></div>' +
      '<div class="flip-face flip-face-back"><span class="flip-eyebrow">Réponse</span><span class="flip-text">' + esc(card.a) + '</span></div>' +
      '</div></div>' +
      '<div class="fc-controls">' +
      '<button class="btn btn-ghost" onclick="App.markCard(\'' + course.id + '\',\'review\')">À revoir</button>' +
      '<button class="btn btn-primary" style="width:auto;flex:1" onclick="App.markCard(\'' + course.id + '\',\'known\')">Je la sais</button>' +
      '</div>' +
      '<div class="fc-nav"><button ' + (st.idx === 0 ? "disabled" : "") + ' onclick="App.navCard(\'' + course.id + '\',-1)">← Précédente</button><button ' + (st.idx === course.flashcards.length - 1 ? "disabled" : "") + ' onclick="App.navCard(\'' + course.id + '\',1)">Suivante →</button></div>' +
      '</div>';
  }

  function renderExamPrepGapFlashcards(cards, key) {
    if (!cards.length) return "";
    var st = epFcState[key] || { idx: 0, flipped: false };
    epFcState[key] = st;
    if (st.idx >= cards.length) st.idx = cards.length - 1;
    var card = cards[st.idx];
    var known = cards.filter(function (f) { return f.status === "known"; }).length;
    return '<div class="fc-wrap ep-day-fc" onclick="event.stopPropagation()">' +
      '<div class="fc-progress"><span>Carte ' + (st.idx + 1) + ' / ' + cards.length + '</span><span>' + known + ' su' + (known !== 1 ? "es" : "e") + '</span></div>' +
      '<div class="fc-bar"><div class="fc-bar-fill" style="width:' + Math.round(((st.idx + 1) / cards.length) * 100) + '%"></div></div>' +
      '<div class="fc-hint">Une carte par erreur détectée ce jour-là — clique pour la retourner</div>' +
      '<div class="flip-card' + (st.flipped ? " flipped" : "") + '" onclick="App.epFlipCard(\'' + key + '\')">' +
      '<div class="flip-inner">' +
      '<div class="flip-face"><span class="flip-eyebrow">Question</span><span class="flip-text">' + esc(card.q) + '</span></div>' +
      '<div class="flip-face flip-face-back"><span class="flip-eyebrow">Réponse</span><span class="flip-text">' + esc(card.a) + '</span></div>' +
      '</div></div>' +
      '<div class="fc-controls">' +
      '<button class="btn btn-ghost" onclick="App.epMarkCard(\'' + key + '\',\'review\')">À revoir</button>' +
      '<button class="btn btn-primary" style="width:auto;flex:1" onclick="App.epMarkCard(\'' + key + '\',\'known\')">Je la sais</button>' +
      '</div>' +
      '<div class="fc-nav"><button ' + (st.idx === 0 ? "disabled" : "") + ' onclick="App.epNavCard(\'' + key + '\',-1)">← Précédente</button><button ' + (st.idx === cards.length - 1 ? "disabled" : "") + ' onclick="App.epNavCard(\'' + key + '\',1)">Suivante →</button></div>' +
      '</div>';
  }

  /* ---------------- Quiz ---------------- */
  function courseQcmQuestions(course) {
    return (course.quizQuestions || []).filter(function (q) { return q.type === "qcm"; });
  }
  function renderQuiz(course) {
    var questions = courseQcmQuestions(course);
    if (!questions.length) return '<div class="quiz-done-empty"><h3>Aucune question</h3></div>';
    var st = quizState[course.id];
    if (!st) { st = { idx: 0, answers: new Array(questions.length).fill(null), submitted: false }; quizState[course.id] = st; }
    if (st.submitted) return renderQuizResult(course, st);
    var q = questions[st.idx];
    var dots = questions.map(function (_, i) {
      return '<div class="quiz-dot ' + (st.answers[i] != null ? "done" : "") + (i === st.idx ? " current" : "") + '"></div>';
    }).join("");
    var choices = q.choices.map(function (c, i) {
      return '<label class="quiz-choice ' + (st.answers[st.idx] === i ? "selected" : "") + '" onclick="App.answerQuiz(\'' + course.id + '\',' + i + ')">' +
        '<input type="radio" name="q' + q.id + '" ' + (st.answers[st.idx] === i ? "checked" : "") + ' readonly><span>' + esc(c) + '</span></label>';
    }).join("");
    var isLast = st.idx === questions.length - 1;
    var canNext = st.answers[st.idx] != null;
    return '<div class="exercise-layout"><div class="quiz-wrap">' +
      '<div class="quiz-progress-dots">' + dots + '</div>' +
      '<div class="quiz-q-num">Question ' + (st.idx + 1) + ' / ' + questions.length + '</div>' +
      '<div class="quiz-q-text">' + esc(q.prompt) + '</div>' + exerciseFigureHtml(q) +
      choices +
      '<div class="quiz-nav">' +
      '<button class="btn btn-ghost" ' + (st.idx === 0 ? "disabled" : "") + ' onclick="App.quizNav(\'' + course.id + '\',-1)">← Précédente</button>' +
      (isLast
        ? '<button class="btn btn-primary" style="width:auto" ' + (canNext ? "" : "disabled") + ' onclick="App.submitQuiz(\'' + course.id + '\')">Valider le contrôle</button>'
        : '<button class="btn btn-primary" style="width:auto" ' + (canNext ? "" : "disabled") + ' onclick="App.quizNav(\'' + course.id + '\',1)">Suivante →</button>') +
      '</div></div>' + dinoCompanionHtml() + '</div>';
  }

  function renderQuizResult(course, st) {
    var questions = courseQcmQuestions(course);
    var correct = 0;
    questions.forEach(function (q, i) { if (st.answers[i] === q.correctIndex) correct++; });
    var total = questions.length;
    var score20 = Math.round((correct / total) * 20 * 10) / 10;
    var items = questions.map(function (q, i) {
      var ok = st.answers[i] === q.correctIndex;
      return '<div class="correction-item ' + (ok ? "correct" : "wrong") + '">' +
        '<div class="correction-q">' + esc(q.prompt) + '</div>' + exerciseFigureHtml(q) +
        '<div class="correction-ans ' + (ok ? "good" : "bad") + '">Ta réponse : ' + esc(q.choices[st.answers[i]]) + '</div>' +
        (ok ? '' : '<div class="correction-ans good">Bonne réponse : ' + esc(q.choices[q.correctIndex]) + '</div>') +
        '<div class="correction-exp">' + mdToHtml(q.explanation) + '</div>' +
        '</div>';
    }).join("");
    return '<div class="quiz-wrap">' +
      '<div class="result-hero"><div class="result-score mono">' + score20 + '<span style="font-size:22px;color:var(--text-muted)">/20</span></div><div class="result-total">' + correct + ' bonnes réponses sur ' + total + '</div></div>' +
      '<button class="btn btn-ghost" style="width:auto;margin:0 auto 26px;display:flex" onclick="App.retryQuiz(\'' + course.id + '\')">Refaire le contrôle</button>' +
      '<h3 style="font-size:16px;margin-bottom:12px">Correction</h3>' + items +
      '</div>';
  }

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
      var ppThemes = ppSubj ? subjectThemesWithContent(ppSubj) : [];
      var ppChapters = ppSubj ? subjectChaptersWithContent(ppSubj) : [];
      if (!ppThemes.some(function (t) { return t.id === modal.themeId; })) modal.themeId = ppThemes[0] ? ppThemes[0].id : "";
      if (!ppChapters.some(function (c) { return c.id === modal.chapterId; })) modal.chapterId = ppChapters[0] ? ppChapters[0].id : "";
      var ppSubjOptions = ppSubs.map(function (s) { return '<option value="' + s.id + '" ' + (s.id === modal.subjectId ? "selected" : "") + '>' + esc(s.name) + '</option>'; }).join("");
      var ppThemeOptions = ppThemes.map(function (t) { return '<option value="' + t.id + '" ' + (t.id === modal.themeId ? "selected" : "") + '>' + esc(t.name) + '</option>'; }).join("");
      var ppChapOptions = ppChapters.map(function (c) { return '<option value="' + c.id + '" ' + (c.id === modal.chapterId ? "selected" : "") + '>' + esc(c.themeName + " / " + c.name) + '</option>'; }).join("");
      var ppHasAny = ppLevel === "theme" ? ppThemes.length : ppChapters.length;
      inner = '<h3>🎙️ Nouveau podcast</h3>' +
        '<p class="modal-warn" style="margin-bottom:14px">Le vieux conteur raconte la portée choisie, fidèlement et en entier — pas une récitation, un vrai récit.</p>' +
        (ppSubs.length ? (
          '<div class="field"><label>Matière</label><select onchange="App.changePodcastSubject(this.value)">' + ppSubjOptions + '</select></div>' +
          '<div class="field"><label>Portée</label><div style="display:flex;gap:8px">' +
          '<button type="button" class="btn btn-sm ' + (ppLevel === "chapter" ? "btn-primary" : "btn-ghost") + '" style="width:auto" onclick="App.setPodcastLevel(\'chapter\')">Un chapitre</button>' +
          '<button type="button" class="btn btn-sm ' + (ppLevel === "theme" ? "btn-primary" : "btn-ghost") + '" style="width:auto" onclick="App.setPodcastLevel(\'theme\')">Tout un thème</button>' +
          '</div></div>' +
          (ppHasAny ? (
            (ppLevel === "theme"
              ? '<div class="field"><label>Thème</label><select onchange="App.changePodcastTheme(this.value)">' + ppThemeOptions + '</select></div>'
              : '<div class="field"><label>Chapitre</label><select onchange="App.changePodcastChapter(this.value)">' + ppChapOptions + '</select></div>') +
            '<p style="font-size:12px;color:var(--text-muted);margin:-4px 0 14px">Le vieux conteur décide lui-même s\'il faut une ou plusieurs parties, selon la quantité réelle de contenu à couvrir.</p>' +
            '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button><button type="button" class="btn btn-primary" onclick="App.createPodcast()">Générer</button></div>'
          ) : '<p class="modal-warn">Cette matière n\'a encore aucun cours généré — génère au moins un cours avant de créer un podcast.</p>')
        ) : '<p class="modal-warn">Crée d\'abord une matière avec au moins un cours généré.</p>');
    } else if (modal.type === "addCourseDocs") {
      inner = '<h3>Ajouter des documents</h3>' +
        '<p class="modal-warn" style="margin-bottom:14px">Le contenu de ces nouvelles photos sera fusionné avec la retranscription déjà connue de ce cours, et tout le cours (retranscription, flashcards, contrôle, exercices) sera régénéré pour couvrir l\'ensemble.</p>' +
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
        storageBarHtml = '<div class="storage-bar-label">' + formatBytes(storageInfo.usedBytes) + ' utilisés — calcul de l\'espace disponible…</div>';
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
    overlay.innerHTML = '<div class="modal' + (isTool ? " modal-tool" : "") + (modal.type === "latex" || modal.type === "periodic" || modal.type === "apiKeyGuide" || modal.type === "backupApiKeyGuide" || modal.type === "confirmImportBackup" ? " modal-wide" : "") + (modal.type === "periodic" ? " modal-periodic" : "") + '">' + inner + '</div>';
    document.body.appendChild(overlay);
  }

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
      modal = { type: "podcastGen", subjectId: firstSubj && firstSubj.id, level: "chapter", chapterId: null, themeId: null };
      render();
    },
    changePodcastSubject: function (subjectId) { modal.subjectId = subjectId; modal.chapterId = null; modal.themeId = null; render(); },
    setPodcastLevel: function (level) { modal.level = level; render(); },
    changePodcastChapter: function (chapterId) { modal.chapterId = chapterId; render(); },
    changePodcastTheme: function (themeId) { modal.themeId = themeId; render(); },
    createPodcast: function () {
      var m = modal;
      var subj = findSubject(m.subjectId);
      if (!subj) { toast("Choisis une matière"); return; }
      var level = m.level || "chapter";
      var content, scopeName, scopeId;
      if (level === "theme") {
        var theme = findTheme(subj, m.themeId);
        if (!theme) { toast("Choisis un thème"); return; }
        content = themeContentText(subj, theme.id);
        scopeName = theme.name;
        scopeId = theme.id;
      } else {
        var chap = findChapterAnywhere(subj, m.chapterId);
        if (!chap) { toast("Choisis un chapitre"); return; }
        content = chapterContentText(subj, m.chapterId);
        scopeName = chap.name;
        scopeId = chap.id;
      }
      if (!getApiKey()) { toast("Ajoute d'abord ta clé API dans les paramètres"); App.openApiKeyModal(); return; }
      if (!content) { toast(level === "theme" ? "Ce thème n'a aucun cours généré" : "Ce chapitre n'a aucun cours généré"); return; }
      // Le nombre de parties n'est PAS choisi ici : c'est l'IA qui décide selon la richesse réelle du
      // contenu (voir runPodcastGeneration). On crée une seule entrée pour l'instant, les parties
      // suivantes (s'il y en a) seront ajoutées dynamiquement une fois la réponse connue.
      var pod = {
        id: uid(), groupId: uid(), title: scopeName,
        subjectId: subj.id, subjectName: subj.name, scopeLevel: level, scopeId: scopeId, scopeName: scopeName,
        partIndex: 1, partCount: 1,
        status: "processing", error: null, errorStatus: null, errorDetail: null,
        script: "", segments: [], audioUrl: "", durationSec: 0, createdAt: Date.now()
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
      if (pod.script) { retryPodcastPartAudio(pod); return; }
      var subj = findSubject(pod.subjectId);
      if (!subj) return;
      var content = pod.scopeLevel === "theme" ? themeContentText(subj, pod.scopeId) : chapterContentText(subj, pod.scopeId);
      runPodcastGeneration(pod, subj.name, pod.scopeName, content);
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
      if (typeof lamejs === "undefined") { toast("Le convertisseur MP3 n'a pas pu se charger (vérifie ta connexion puis recharge la page)."); return; }
      toast("🎙️ Conversion en MP3…");
      setTimeout(function () {
        try {
          var wav = parseWavPcm16(pod.audioUrl);
          var blob = pcm16ToMp3Blob(wav.samples, wav.sampleRate, wav.numChannels);
          var filename = String(pod.title || "podcast").replace(/[\\/:*?"<>|]/g, "_") + ".mp3";
          triggerBlobDownload(blob, filename);
          toast("⬇️ MP3 téléchargé");
        } catch (e) {
          toast("Échec de la conversion MP3 : " + (e.message || "erreur inconnue"));
        }
      }, 30);
    },
    downloadPodcastGroupMp3: function (groupId) {
      var parts = podcastData().filter(function (p) { return p.groupId === groupId && p.status === "ready" && p.audioUrl; })
        .sort(function (a, b) { return a.partIndex - b.partIndex; });
      if (!parts.length) return;
      if (typeof lamejs === "undefined") { toast("Le convertisseur MP3 n'a pas pu se charger (vérifie ta connexion puis recharge la page)."); return; }
      toast("🎙️ Fusion des " + parts.length + " parties et conversion en MP3…");
      setTimeout(function () {
        try {
          var blob = mergePodcastPartsToMp3Blob(parts);
          var filename = String(parts[0].scopeName || parts[0].title || "podcast").replace(/[\\/:*?"<>|]/g, "_") + ".mp3";
          triggerBlobDownload(blob, filename);
          toast("⬇️ MP3 téléchargé (" + parts.length + " parties fusionnées)");
        } catch (e) {
          toast("Échec de la conversion MP3 : " + (e.message || "erreur inconnue"));
        }
      }, 30);
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
        runCourseGeneration(loc.course, loc.subject.name, loc.chapter.name, [], stripFigureMarkdown(loc.course.transcription));
      }
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
      printAndDownload(buildRevisionSheetPrintHtml(sheet, subj ? subj.name : "", chap ? chap.name : ""));
    },
    downloadMethodologyPdf: function (id) {
      var methodo = methodoFind(id);
      if (!methodo || methodo.status !== "ready") return;
      printAndDownload(buildMethodologyPrintHtml(methodo));
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
      printAndDownload(buildCoursePrintHtml(loc.course, loc.subject.name, loc.chapter.name, includeExplanation));
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
      var picked = epPickDayQuestions(pool, dayEntry, prep);
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
      var methodo = prep.methodologyId ? methodoFind(prep.methodologyId) : null;
      var finalizeLaunch = function (finalPool) {
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
      prep.itemUseCount = prep.itemUseCount || {};
      // Un item déjà rencontré lors d'une séance précédente de cette même prépa est réécrit (valeurs et
      // contexte différents, même notion) avant de démarrer, pour éviter de retomber mot pour mot sur le
      // même exercice à chaque répétition.
      var repeats = picked.filter(function (it) { return (it.kind === "exercise" || it.kind === "open") && prep.itemUseCount[it.id]; });
      picked.forEach(function (it) { prep.itemUseCount[it.id] = (prep.itemUseCount[it.id] || 0) + 1; });
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
        return buildExercisePrintHtml(entry.title + (entry.exercises.length > 1 ? " — Exercice " + (i + 1) : ""), entry.subjectGuess, mdToHtml(ex.statement, entry.figures), ex.answerHtml, ex.level || (ex.correct ? "correct" : "wrong"), ex.feedback, mdToHtml(ex.solution), ex.mistakes);
      }).join("");
      printAndDownload(html);
    },
    openApiKeyModal: function () { modal = { type: "apiKey" }; render(); },
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
      var json = JSON.stringify(DB, null, 2);
      var blob = new Blob([json], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "studino-sauvegarde-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast("Sauvegarde téléchargée");
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
      if (!item) return;
      modal = { type: "renameItem", kind: kind, subjectId: subjectId, themeId: themeId, chapterId: chapterId, courseId: courseId, currentName: kind === "course" ? item.title : item.name };
      render();
    },
    confirmRename: function (e) {
      e.preventDefault();
      var name = e.target.name.value.trim();
      if (!name) return;
      var m = modal;
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
        toast("Podcast supprimé");
      } else if (m.kind === "podcastGroup") {
        var d7 = userData();
        d7.podcasts = d7.podcasts.filter(function (x) { return x.groupId !== m.courseId; });
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
      dp.shops[zoneId] = { items: dpGenerateShopItems(zoneId, false), expiresAt: Date.now() + DP_SHOP_DURATION };
      saveDB(); toast("Le vendeur a été rafraîchi"); render();
    },
    dpLuckShop: function (zoneId) {
      var dp = dpData();
      if (dp.points < DP_SHOP_LUCK_COST) { toast("Pas assez de points"); return; }
      dp.points -= DP_SHOP_LUCK_COST;
      dp.shops[zoneId] = { items: dpGenerateShopItems(zoneId, true), expiresAt: Date.now() + DP_SHOP_DURATION };
      saveDB(); toast("Le vendeur propose de meilleures trouvailles !"); render();
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
      var pnnool = (loc.course.quizQuestions || []).slice();
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
      var html = buildExercisePrintHtml(title, "", mdToHtml(ex.prompt), qz.answerHtml, qz.level || (qz.correct ? "correct" : "wrong"), qz.feedback, mdToHtml(ex.solution), qz.mistakes);
      printAndDownload(html);
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
    markCard: function (courseId, status) {
      var loc = locateCourse(courseId);
      var st = fcState[courseId] || { idx: 0, flipped: false };
      var card = loc.course.flashcards[st.idx];
      card.status = status;
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
      card.status = status;
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
  var appEl = document.getElementById("app");
  if (appEl) appEl.innerHTML = '<div class="processing-box" style="min-height:100vh;justify-content:center">' + genLogo() + '<span>Chargement…</span></div>';
  initDB().then(function () {
    window.addEventListener("hashchange", render);
    window.addEventListener("resize", syncTopbarHeightVar);
    render();
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
})();
