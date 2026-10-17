"use strict";
// Studino — stockage, images, audio, schémas
// Fichier chargé dans l'ordre par index.html : les fichiers partagent les mêmes variables globales.

  var APP_VERSION = "12.7"; // +0.1 à chaque push sur GitHub, pour que l'utilisateur puisse vérifier qu'il a bien la dernière version
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

  function idbDelete(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function idbKeys() {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).getAllKeys();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  var DB = { users: {}, currentUser: null, data: {} };
  var dbUsesLocalStorageFallback = false;

  /* ---------------- Audio des podcasts : rangé à part ----------------
     Une partie de 17 min, c'est ~50 Mo de WAV, soit ~65 Mo en data URL. Gardé DANS l'objet DB, chaque
     saveDB() (n'importe quel clic qui sauvegarde) recopiait tout ça dans IndexedDB : l'appli ramait et
     ratait des clics. L'audio vit donc dans sa propre entrée IndexedDB ("pa:<id>", en Blob), et
     pod.audioUrl n'est plus qu'une URL blob: valable pour la session, jamais sauvegardée. */
  var PODCAST_AUDIO_PREFIX = "pa:";
  var podcastLiveAudioUrls = {}; // id → URL blob: de cette session
  function allPodcastsInDB() {
    var out = [];
    Object.keys(DB.data || {}).forEach(function (u) {
      var d = DB.data[u];
      if (d && Array.isArray(d.podcasts)) out = out.concat(d.podcasts);
    });
    return out;
  }
  // Copie de DB à sauvegarder/exporter sans les URL blob: (inutiles hors de cette session). Un data URL
  // pas encore migré est gardé tel quel, pour ne jamais perdre un son.
  function dbWithoutPodcastAudio() {
    if (dbUsesLocalStorageFallback) return DB;
    var data = {};
    Object.keys(DB.data || {}).forEach(function (u) {
      var d = DB.data[u];
      if (d && Array.isArray(d.podcasts) && d.podcasts.length) {
        data[u] = Object.assign({}, d, { podcasts: d.podcasts.map(function (p) {
          return p.audioUrl && p.audioUrl.indexOf("data:") !== 0 ? Object.assign({}, p, { audioUrl: "" }) : p;
        }) });
      } else {
        data[u] = d;
      }
    });
    return Object.assign({}, DB, { data: data });
  }
  function storePodcastAudio(pod, dataUrl) {
    if (dbUsesLocalStorageFallback) { pod.audioUrl = dataUrl; return Promise.resolve(); }
    return fetch(dataUrl).then(function (r) { return r.blob(); }).then(function (blob) {
      return idbSet(PODCAST_AUDIO_PREFIX + pod.id, blob).then(function () {
        if (podcastLiveAudioUrls[pod.id]) URL.revokeObjectURL(podcastLiveAudioUrls[pod.id]);
        pod.audioUrl = podcastLiveAudioUrls[pod.id] = URL.createObjectURL(blob);
        pod.hasAudio = true;
      });
    });
  }
  // Au chargement (et après un import) : migre les anciens podcasts (son dans DB) vers le stockage à
  // part, et redonne à chaque partie une URL jouable. Un son introuvable (sauvegarde importée depuis un
  // autre appareil) passe la partie en erreur : son texte est gardé, « Réessayer » refait juste la voix.
  function hydratePodcastAudio() {
    if (dbUsesLocalStorageFallback) return Promise.resolve();
    var changed = false;
    // Une par une : migrer d'un coup plusieurs data URL de dizaines de Mo saturerait la mémoire.
    return allPodcastsInDB().reduce(function (chain, p) {
      return chain.then(function () {
        if (p.audioUrl && p.audioUrl.indexOf("data:") === 0) {
          changed = true;
          return storePodcastAudio(p, p.audioUrl).catch(function (err) { console.error("Migration audio podcast :", err); });
        }
        if (podcastLiveAudioUrls[p.id]) { p.audioUrl = podcastLiveAudioUrls[p.id]; return; }
        if (p.status !== "ready" && !p.hasAudio) return;
        return idbGet(PODCAST_AUDIO_PREFIX + p.id).then(function (blob) {
          if (blob) { p.audioUrl = podcastLiveAudioUrls[p.id] = URL.createObjectURL(blob); p.hasAudio = true; return; }
          if (p.status === "ready") {
            p.audioUrl = ""; p.hasAudio = false; p.status = "error";
            p.error = "Le son de cette partie n'est pas sur cet appareil (sauvegarde importée sans l'audio) : relance juste la voix.";
            changed = true;
          }
        }).catch(function () {});
      });
    }, Promise.resolve()).then(function () {
      if (changed) saveDB();
      return gcPodcastAudio();
    });
  }
  // Au chargement, aucune génération ne tourne encore : un podcast resté « en préparation » a forcément
  // été interrompu (page fermée ou rechargée, mise à jour de l'appli...). Sans ça, il restait bloqué pour
  // toujours avec un chrono qui montait. Son texte éventuel est gardé : « Réessayer » ne refait que la voix.
  function markInterruptedPodcasts() {
    var changed = false;
    allPodcastsInDB().forEach(function (p) {
      if (p.status !== "processing") return;
      p.status = "error";
      p.error = p.script
        ? "La voix n'a pas pu être terminée : la page a été fermée ou rechargée pendant la préparation. Clique sur Réessayer (le texte est gardé)."
        : "La préparation a été interrompue : la page a été fermée ou rechargée. Clique sur Réessayer.";
      changed = true;
    });
    // Même chose pour toutes les autres générations : cours, fiches, méthodologies, exercices importés,
    // plannings de prépa. Leurs photos/documents sont gardés tant que la génération n'a pas abouti, donc
    // « Réessayer » repart bien de zéro.
    var interrupted = "La génération a été interrompue : la page a été fermée ou rechargée pendant qu'elle tournait. Clique sur Réessayer.";
    Object.keys(DB.data || {}).forEach(function (u) {
      var d = DB.data[u];
      if (!d) return;
      var fix = function (x) { if (x && x.status === "processing") { x.status = "error"; x.error = interrupted; changed = true; } };
      (d.subjects || []).forEach(function (s) {
        (s.themes || []).forEach(function (t) { (t.chapters || []).forEach(function (c) { (c.courses || []).forEach(fix); }); });
      });
      (d.revisionSheets || []).forEach(fix);
      (d.methodologies || []).forEach(fix);
      (d.importedExercises || []).forEach(fix);
      (d.examPreps || []).forEach(function (p) {
        if (p && p.planStatus === "processing") { p.planStatus = "error"; p.planError = interrupted; changed = true; }
      });
    });
    if (changed) saveDB();
  }
  // Supprime les sons des podcasts qui n'existent plus (supprimés, remplacés par une actualisation...).
  function gcPodcastAudio() {
    if (dbUsesLocalStorageFallback) return Promise.resolve();
    var alive = {};
    allPodcastsInDB().forEach(function (p) { alive[PODCAST_AUDIO_PREFIX + p.id] = 1; });
    allFigureLists(DB).forEach(function (list) { list.forEach(function (f) { if (f) alive[FIGURE_IMG_PREFIX + f.id] = 1; }); });
    return idbKeys().then(function (keys) {
      keys.forEach(function (k) {
        if (typeof k === "string" && k.indexOf(PODCAST_AUDIO_PREFIX) === 0 && !alive[k]) {
          var id = k.slice(PODCAST_AUDIO_PREFIX.length);
          if (podcastLiveAudioUrls[id]) { URL.revokeObjectURL(podcastLiveAudioUrls[id]); delete podcastLiveAudioUrls[id]; }
          idbDelete(k).catch(function () {});
        }
        if (typeof k === "string" && k.indexOf(FIGURE_IMG_PREFIX) === 0 && !alive[k]) {
          var fid = k.slice(FIGURE_IMG_PREFIX.length);
          if (figureUrlCache[fid]) { URL.revokeObjectURL(figureUrlCache[fid]); delete figureUrlCache[fid]; }
          idbDelete(k).catch(function () {});
        }
      });
    }).catch(function () {});
  }

  /* ---------------- Images des schémas découpés : rangées à part ----------------
     Même raison que l'audio des podcasts : gardées en data URL dans DB, chaque saveDB() les recopiait
     toutes (des dizaines de Mo avec beaucoup de cours). Chaque image vit dans sa propre entrée IndexedDB
     (« fig:<id> ») ; dans DB, le schéma garde son id, sa légende et stored=true, et figureSrc() donne
     l'URL blob: chargée pour la session. */
  var FIGURE_IMG_PREFIX = "fig:";
  var figureUrlCache = {}; // id → URL blob: de cette session
  function figureSrc(f) { return (f && (f.image || figureUrlCache[f.id])) || ""; }
  function allFigureLists(db) {
    var lists = [];
    Object.keys((db && db.data) || {}).forEach(function (u) {
      var d = db.data[u];
      if (!d) return;
      (d.subjects || []).forEach(function (s) {
        (s.themes || []).forEach(function (t) {
          (t.chapters || []).forEach(function (c) {
            (c.courses || []).forEach(function (co) { if (Array.isArray(co.figures)) lists.push(co.figures); });
          });
        });
      });
      (d.importedExercises || []).forEach(function (e) { if (Array.isArray(e.figures)) lists.push(e.figures); });
    });
    return lists;
  }
  // Range dans IndexedDB les images encore stockées dans les données (nouvelles découpes, anciens cours).
  function storeFigureImages() {
    if (dbUsesLocalStorageFallback) return Promise.resolve();
    var todo = [];
    allFigureLists(DB).forEach(function (list) { list.forEach(function (f) { if (f && f.image && f.image.indexOf("data:") === 0) todo.push(f); }); });
    if (!todo.length) return Promise.resolve();
    return todo.reduce(function (chain, f) {
      return chain.then(function () {
        var dataUrl = f.image;
        return fetch(dataUrl).then(function (r) { return r.blob(); }).then(function (blob) {
          return idbSet(FIGURE_IMG_PREFIX + f.id, blob).then(function () {
            if (f.image !== dataUrl) return; // remplacé entre-temps
            figureUrlCache[f.id] = URL.createObjectURL(blob);
            f.image = ""; f.stored = true;
          });
        }).catch(function (err) { console.error("Rangement d'un schéma :", err); });
      });
    }, Promise.resolve()).then(function () { saveDB(); });
  }
  function hydrateFigureImages() {
    if (dbUsesLocalStorageFallback) return Promise.resolve();
    var stored = [];
    allFigureLists(DB).forEach(function (list) { list.forEach(function (f) { if (f && f.stored && !f.image && !figureUrlCache[f.id]) stored.push(f); }); });
    return Promise.all(stored.map(function (f) {
      return idbGet(FIGURE_IMG_PREFIX + f.id).then(function (blob) { if (blob) figureUrlCache[f.id] = URL.createObjectURL(blob); }).catch(function () {});
    })).then(storeFigureImages);
  }
  // Copie pour l'export : les images rangées à part sont remises dedans (data URL), sinon une sauvegarde
  // importée sur un autre appareil n'aurait plus aucun schéma.
  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(blob);
    });
  }
  function exportCopyWithFigures(dbCopy) {
    var jobs = [];
    allFigureLists(dbCopy).forEach(function (list) {
      list.forEach(function (f) {
        if (!f || f.image || !f.stored) return;
        jobs.push(idbGet(FIGURE_IMG_PREFIX + f.id).then(function (blob) {
          if (!blob) return;
          return blobToDataUrl(blob).then(function (url) { f.image = url; delete f.stored; });
        }).catch(function () {}));
      });
    });
    return Promise.all(jobs).then(function () { return dbCopy; });
  }

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
    idbSet(IDB_ENTRY, dbWithoutPodcastAudio()).catch(function (err) {
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
    // Pas de JSON.stringify(DB) ici : avec beaucoup de cours/photos, ça figeait la page à l'ouverture des paramètres.
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
  // 1400 px : à 700, une page pleine d'exercices devenait trop petite pour que l'IA lise bien et découpe
  // précisément chaque schéma (et les schémas découpés étaient flous). Les photos sont effacées après la génération.
  var IMG_MAX_W = 1400;
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
    // Réduction calée sur le PETIT côté (1400 px) : calée sur la largeur, un document très large devenait
    // une bande de quelques pixels de haut, illisible. Le grand côté est plafonné pour rester sous la
    // taille maximale d'un canvas du navigateur.
    var scale = Math.min(1, IMG_MAX_W / Math.min(w, h), 16000 / Math.max(w, h));
    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  }
  // Zone [ymin, xmin, ymax, xmax] sur 0-1000 : rejette les zones vides, inversées ou minuscules (un
  // point, une ligne) qu'une détection ratée renvoie parfois.
  function isValidFigureBox(box) {
    if (!Array.isArray(box) || box.length !== 4) return false;
    if (box.some(function (v) { return typeof v !== "number" || !isFinite(v); })) return false;
    var h = Math.min(1000, box[2]) - Math.max(0, box[0]), w = Math.min(1000, box[3]) - Math.max(0, box[1]);
    return h >= 20 && w >= 20;
  }
  // Petite marge autour du schéma : une zone au ras du dessin coupe souvent une lettre ou une graduation.
  function padFigureBox(box) {
    var pad = 12;
    return [Math.max(0, box[0] - pad), Math.max(0, box[1] - pad), Math.min(1000, box[2] + pad), Math.min(1000, box[3] + pad)];
  }
  // pdf.js chargé à la demande (seulement quand un schéma doit être découpé dans un PDF).
  var PDFJS_BASE = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  var pdfJsPromise = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfJsPromise) {
      pdfJsPromise = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = PDFJS_BASE + "pdf.min.js";
        s.onload = function () {
          if (!window.pdfjsLib) { reject(new Error("pdf.js indisponible")); return; }
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + "pdf.worker.min.js";
          resolve(window.pdfjsLib);
        };
        s.onerror = function () { pdfJsPromise = null; reject(new Error("Impossible de charger pdf.js")); };
        document.head.appendChild(s);
      });
    }
    return pdfJsPromise;
  }
  function renderPdfPageToJpeg(pdfDataUrl, pageNum) {
    return Promise.all([loadPdfJs(), fetch(pdfDataUrl).then(function (r) { return r.arrayBuffer(); })]).then(function (res) {
      return res[0].getDocument({ data: new Uint8Array(res[1]) }).promise;
    }).then(function (doc) {
      var n = Math.max(1, Math.min(doc.numPages, pageNum || 1));
      return doc.getPage(n).then(function (page) {
        var base = page.getViewport({ scale: 1 });
        var viewport = page.getViewport({ scale: Math.min(3, 1800 / base.width) });
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
          var url = canvas.toDataURL("image/jpeg", 0.9);
          doc.destroy();
          return url;
        });
      });
    });
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
            box: { type: "array", items: { type: "integer" }, description: "Zone rectangulaire CORRIGÉE [ymin, xmin, ymax, xmax] sur une échelle de 0 à 1000 (0,0 = coin haut-gauche de CETTE image, 1000,1000 = coin bas-droit), qui encadre EXACTEMENT ce schéma EN ENTIER avec ses propres annotations (lettres des points, valeurs, axes, graduations, légende), sans le texte de l'énoncé autour ni aucun morceau d'un autre schéma/tableau voisin. Si found=false, renvoie [0,0,0,0]." }
          },
          required: ["index", "found", "box"]
        }
      }
    },
    required: ["boxes"]
  };
  function buildFigureRefinePrompt(figsOnThisImage) {
    var list = figsOnThisImage.map(function (f, i) {
      var b = Array.isArray(f.box) && f.box.length === 4 ? " — première estimation (peu fiable) : [" + f.box.join(", ") + "]" : "";
      return i + ". " + (f.caption || "(sans légende)") + b;
    }).join("\n");
    return "Voici UNE SEULE image (une page/photo de cours ou d'exercices). Une première passe moins précise pense qu'elle contient les schémas/graphiques suivants :\n" + list + "\n\n" +
      "Pour CHAQUE schéma de cette liste, regarde attentivement CETTE image précise et donne la zone rectangulaire qui l'encadre le plus exactement possible, au format [ymin, xmin, ymax, xmax] sur une échelle 0-1000. La zone doit contenir le schéma EN ENTIER avec tout ce qui lui appartient (lettres des points, valeurs, flèches, axes, graduations, légende, titre de la figure) — ne coupe jamais un bord ni une annotation. Elle doit exclure le texte de l'énoncé autour et tout élément d'un AUTRE schéma ou tableau voisin — ne prends surtout pas un morceau de texte ou une zone vide par erreur.\n" +
      "Une même page peut contenir PLUSIEURS exercices, chacun avec son schéma : sers-toi de la légende (numéro d'exercice, ce que montre le schéma, lettres des points...) et de la position estimée pour associer chaque élément de la liste au BON schéma, et ne donne JAMAIS la même zone à deux éléments différents. Si un schéma de la liste n'est en fait PAS présent sur cette image précise (erreur de la passe précédente), mets \"found\": false pour lui plutôt que d'inventer une zone approximative.\n\n" +
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
    // Une « source » = une photo, ou UNE page d'un PDF (rendue en image pour pouvoir y découper le
    // schéma — avant, les schémas d'un PDF n'étaient jamais découpés du tout).
    var sourceKey = function (fig) {
      var src = images[fig.imageIndex];
      return fig.imageIndex + ":" + (isPdfDataUrl(src) ? (fig.pageIndex || 1) : 0);
    };
    var sourceCache = {};
    var sourceFor = function (fig) {
      var src = images[fig.imageIndex];
      if (!src) return Promise.resolve(null);
      if (!isPdfDataUrl(src)) return Promise.resolve(src);
      var key = sourceKey(fig);
      if (!sourceCache[key]) {
        sourceCache[key] = renderPdfPageToJpeg(src, fig.pageIndex || 1).catch(function (err) {
          console.error("Rendu de la page PDF impossible :", err);
          return null;
        });
      }
      return sourceCache[key];
    };
    var bySource = {}, srcOf = [];
    list.forEach(function (fig, i) { var k = sourceKey(fig); (bySource[k] = bySource[k] || []).push(i); });
    // 3 pages à la fois maximum : 11 appels lancés d'un coup dépasseraient le quota de requêtes par minute.
    var refineTasks = Object.keys(bySource).map(function (k) { return function () {
      var idxList = bySource[k];
      return sourceFor(list[idxList[0]]).then(function (src) {
        if (!src) return;
        idxList.forEach(function (i) { srcOf[i] = src; });
        return refineImageFigureBoxes(src, idxList.map(function (i) { return list[i]; })).then(function (data) {
          if (!data || !data.boxes) return;
          var seen = {};
          data.boxes.forEach(function (b) {
            var fig = list[idxList[b.index]];
            if (!fig) return;
            if (!b.found) { fig.box = null; return; }
            // Zone corrigée gardée seulement si elle est plausible et pas déjà donnée à un autre schéma
            // de la même page — sinon on garde la première estimation plutôt qu'un doublon.
            var sig = isValidFigureBox(b.box) ? b.box.join(",") : null;
            if (sig && !seen[sig]) { seen[sig] = 1; fig.box = b.box; }
          });
        });
      });
    }; });
    var runPool = function (tasks, limit) {
      var next = 0;
      var worker = function () {
        if (next >= tasks.length) return Promise.resolve();
        var task = tasks[next++];
        return Promise.resolve().then(task).catch(function () {}).then(worker);
      };
      var workers = [];
      for (var w = 0; w < Math.min(limit, tasks.length); w++) workers.push(worker());
      return Promise.all(workers);
    };
    return runPool(refineTasks, 3).then(function () {
      return Promise.all(list.map(function (fig, i) {
        var src = srcOf[i];
        if (!src || !isValidFigureBox(fig.box)) return Promise.resolve(null);
        return cropImageRegion(src, padFigureBox(fig.box)).catch(function () { return null; });
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
  // Schémas d'un cours existant envoyés à l'IA sous forme de jetons [[keep:id]] (elle ne voit pas les
  // images), puis remis en vraies références après la génération.
  function protectFigureRefs(text) {
    return String(text || "").replace(/!\[[^\]]*\]\(figure:([^)\s]+)\)/g, "[[keep:$1]]");
  }
  function restoreFigureRefs(text, figures) {
    return String(text || "").replace(/\[\[keep:([^\]\s]+)\]\]/g, function (m, id) {
      var f = (figures || []).find(function (x) { return x.id === id; });
      return f ? "![" + String(f.caption || "").replace(/[[\]]/g, "") + "](figure:" + id + ")" : "";
    });
  }
  function substituteFigures(text, subs) {
    var out = text || "";
    (subs || []).forEach(function (s) { if (s.placeholder) out = out.split(s.placeholder).join(s.replacement); });
    // Jeton resté sans schéma (découpe ratée ou schéma ignoré) : on le retire plutôt que de l'afficher tel quel.
    out = out.replace(/^[ \t]*\[\[(?:figure|img):\d+\]\][ \t]*\n?/gm, "").replace(/\[\[(?:figure|img):\d+\]\]/g, "");
    return out;
  }
  /* ---------------- Passe dédiée de détection des schémas ----------------
     Avant, les schémas étaient repérés DANS le gros appel qui génère aussi la retranscription,
     l'explication, les flashcards, le contrôle... Sur un document chargé (ex. 11 pages d'exercices),
     l'IA sautait souvent cette étape : aucun schéma. Un appel qui ne fait QUE ça les repère tous ; ils
     sont découpés avant la génération, qui n'a plus qu'à placer leurs jetons [[img:N]] dans le texte. */
  // Repère et découpe les visuels du document. Ne bloque jamais la génération : en cas d'échec on
  // renvoie simplement une liste vide (la génération repère alors les schémas elle-même, comme avant).
  /* Pourquoi des « tranches » : l'IA ne regarde jamais une image en pleine résolution, elle la réduit
     d'abord. Une page très haute (ex. tout un cours sur une seule longue page de PDF, 20 fois plus haute
     que large) devenait une bande illisible, et une zone sur une grille de 0 à 1000 y valait des
     centaines de pixels : découpes au hasard. En plus, le rendu de cette page entière dépassait la
     taille maximale d'un canvas du navigateur (découpes blanches). On découpe donc chaque photo / page
     en tranches aux proportions normales qui se chevauchent, l'IA repère les visuels tranche par tranche,
     puis chaque visuel est revérifié sur un zoom serré autour de lui avant la découpe finale. */
  var FIG_RENDER_SHORT = 1600;   // petit côté d'une page de PDF au rendu (page haute OU large)
  var FIG_TILE_RATIO = 1.6;      // hauteur d'une tranche = 1,6 × sa largeur (proche d'une page A4)
  // 50 % de chevauchement : tout schéma moins haut que la moitié d'une tranche est forcément ENTIER dans au
  // moins une tranche. Un schéma plus grand, coupé partout, est quand même signalé (cut=true) puis
  // récupéré en entier par le zoom de vérification, qui regarde alors large au-dessus et en dessous.
  var FIG_TILE_OVERLAP = 0.5;
  var FIG_TILES_PER_CALL = 4;
  var FIG_MAX_TILES = 150, FIG_MAX_PDF_PAGES = 60, FIG_MAX_FIGURES = 80;
  function runWithConcurrency(tasks, limit) {
    var next = 0;
    var worker = function () {
      if (next >= tasks.length) return Promise.resolve();
      var task = tasks[next++];
      return Promise.resolve().then(task).catch(function (err) { console.error(err); }).then(worker);
    };
    var workers = [];
    for (var w = 0; w < Math.min(limit, tasks.length); w++) workers.push(worker());
    return Promise.all(workers);
  }
  // Source = une photo, ou une page de PDF. renderRegion(x, y, w, h) renvoie cette zone (en pixels de
  // la source) en JPEG, à pleine résolution, sans jamais dessiner la page entière d'un coup.
  async function buildFigureSources(images) {
    var sources = [];
    for (var fi = 0; fi < images.length; fi++) {
      var src = images[fi];
      if (!src) continue;
      if (isPdfDataUrl(src)) {
        var lib = await loadPdfJs();
        var buf = await (await fetch(src)).arrayBuffer();
        var doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
        var pageCount = Math.min(doc.numPages, FIG_MAX_PDF_PAGES);
        if (doc.numPages > FIG_MAX_PDF_PAGES) sources.truncated = true;
        for (var pn = 1; pn <= pageCount; pn++) {
          (function (page, pageNum) {
            var base = page.getViewport({ scale: 1 });
            var vp = page.getViewport({ scale: Math.min(3, FIG_RENDER_SHORT / Math.min(base.width, base.height)) });
            sources.push({
              fileIndex: fi, page: pageNum, w: Math.round(vp.width), h: Math.round(vp.height), doc: doc,
              renderCanvas: function (x, y, w, h) {
                var canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.round(w)); canvas.height = Math.max(1, Math.round(h));
                var ctx = canvas.getContext("2d");
                ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
                return page.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -x, -y] }).promise
                  .then(function () { return canvas; });
              }
            });
          })(await doc.getPage(pn), pn);
        }
      } else {
        var img = await loadImageEl(src);
        (function (im) {
          sources.push({
            fileIndex: fi, page: 1, w: im.naturalWidth || im.width, h: im.naturalHeight || im.height,
            renderCanvas: function (x, y, w, h) {
              var canvas = document.createElement("canvas");
              canvas.width = Math.max(1, Math.round(w)); canvas.height = Math.max(1, Math.round(h));
              var ctx = canvas.getContext("2d");
              ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(im, x, y, w, h, 0, 0, canvas.width, canvas.height);
              return Promise.resolve(canvas);
            }
          });
        })(img);
      }
    }
    sources.forEach(function (s) {
      s.renderRegion = function (x, y, w, h) { return s.renderCanvas(x, y, w, h).then(function (c) { return c.toDataURL("image/jpeg", 0.9); }); };
    });
    return sources;
  }
  // Tranches le long du GRAND côté : bandes horizontales pour une page haute, verticales pour une page
  // large. Chaque tranche garde des proportions normales (1,6 × le petit côté).
  function figureTilesFor(source) {
    var vertical = source.h >= source.w;
    var along = vertical ? source.h : source.w, across = vertical ? source.w : source.h;
    var len = Math.round(across * FIG_TILE_RATIO);
    var spans = [];
    if (along <= len * 1.15) spans.push({ start: 0, len: along });
    else {
      var step = Math.round(len * (1 - FIG_TILE_OVERLAP));
      for (var p = 0; p < along; p += step) {
        var start = Math.min(p, along - len);
        spans.push({ start: start, len: len });
        if (start + len >= along) break;
      }
    }
    return spans.map(function (sp) {
      return vertical ? { x: 0, y: sp.start, w: source.w, h: sp.len } : { x: sp.start, y: 0, w: sp.len, h: source.h };
    });
  }
  var FIGURE_TILE_DETECT_SCHEMA = {
    type: "object",
    properties: {
      figures: {
        type: "array",
        items: {
          type: "object",
          properties: {
            imageIndex: { type: "integer", description: "Index (à partir de 0) de l'image de CET envoi où le visuel est entièrement visible." },
            box: { type: "array", items: { type: "integer" }, description: "Zone [ymin, xmin, ymax, xmax] sur 0-1000 dans CETTE image, qui contient TOUT le visuel avec son titre et ses annotations, sans le texte de l'énoncé autour." },
            caption: { type: "string", description: "Légende distinctive : partie/exercice + ce que montre le visuel." },
            cut: { type: "boolean", description: "true si le visuel est coupé par un bord de cette image (il continue au-delà)." }
          },
          required: ["imageIndex", "box", "caption", "cut"]
        }
      }
    },
    required: ["figures"]
  };
  function buildTileDetectPrompt(count) {
    return "Voici " + count + " image(s), chacune précédée de son numéro (« Image 0 », « Image 1 »…), le numéro à renvoyer dans imageIndex : ce sont des morceaux d'un document de cours ou d'exercices (des tranches successives d'une même page, qui se chevauchent). Ta SEULE tâche : repérer les éléments VISUELS qui ne peuvent pas être retranscrits en texte et qui servent à comprendre le contenu.\n\n" +
      "À repérer : graphiques, courbes, schémas (cases, flèches, cercles, tableaux de bits dessinés...), diagrammes, montages, figures géométriques, structures chimiques, cartes, pictogrammes, photos qui apportent une information.\n" +
      "À NE PAS repérer : le texte normal, les calculs et développements écrits (même alignés ou posés en colonnes : ils seront retranscrits en texte), les tableaux de texte simples, les titres, les numéros, les logos, les décorations, les zones vides.\n\n" +
      FIGURE_SCOPE_RULE + "\n" +
      "Règles de zone : la zone [ymin, xmin, ymax, xmax] (0-1000, relative à l'image indiquée) doit contenir le visuel EN ENTIER, sans couper de bord, et rien de ce qui n'en fait pas partie. Si un visuel est coupé par un bord de l'image (haut, bas, gauche ou droite), donne quand même la partie visible avec cut=true (il sera reconstitué en entier ensuite) ; sinon cut=false. S'il apparaît en entier dans deux images, donne-le une seule fois. Si une image ne contient aucun visuel, ne renvoie rien pour elle.\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni, en français.";
  }
  var FIGURE_ZOOM_SCHEMA = {
    type: "object",
    properties: {
      found: { type: "boolean", description: "false si le visuel décrit n'est PAS dans cette image." },
      box: { type: "array", items: { type: "integer" }, description: "Zone [ymin, xmin, ymax, xmax] sur 0-1000 dans CETTE image, qui encadre exactement le visuel en entier avec son titre et ses annotations, sans le texte normal autour." }
    },
    required: ["found", "box"]
  };
  // Ce qui appartient (ou pas) à un visuel : partagé par le repérage, le zoom et la vérification finale.
  // Avant, « avec son titre » faisait garder le titre de l'EXERCICE (« 35 Cohésion d'un cristal de sel »)
  // et le texte qui longe la photo, et rien ne demandait de signaler une photo coupée.
  var FIGURE_SCOPE_RULE = "CE QUI FAIT PARTIE DU VISUEL : le dessin ou la photo lui-même, ses annotations (lettres, valeurs, flèches, axes, graduations, légende) et sa propre étiquette quand elle est collée au visuel (ex. « Doc. 1 Courbe d'étalonnage », « CHAMP DE GRAVITATION – LE LIVRE SCOLAIRE »), ainsi que son cadre s'il en a un. " +
    "CE QUI N'EN FAIT PAS PARTIE (à exclure absolument) : le numéro et le titre de l'EXERCICE ou de la partie (ex. « 35 Cohésion d'un cristal de sel », « ✔ MATH : Calcul littéral »), les questions numérotées, et tout texte du cours ou de l'énoncé qui entoure le visuel, le longe ou s'enroule autour, même s'il est collé à lui. " +
    "Pour une PHOTO : la zone suit exactement le bord rectangulaire de la photo ; si un bord de la photo n'est pas visible (la photo continue au-delà de l'image), elle est coupée de ce côté.";
  function buildFigureZoomPrompt(caption) {
    return "Cette image est un zoom sur une partie d'un document, autour d'un visuel décrit ainsi : « " + caption + " ».\n" +
      "Donne la zone [ymin, xmin, ymax, xmax] (échelle 0-1000, relative à CETTE image) qui encadre ce visuel EN ENTIER, sans en couper le moindre bord. Sois précis au pixel près.\n" +
      FIGURE_SCOPE_RULE + "\n" +
      "Si ce visuel n'est pas dans l'image (ou si ce n'est que du texte), mets found=false.\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni.";
  }
  // Vérification au pixel : si un trait (encre plus foncée que le fond) touche un bord de la découpe, c'est
  // que le schéma continue au-delà → on élargit CE côté et on revérifie (jusqu'à 12 fois). Rattrape les
  // découpes un peu trop serrées de l'IA (une lettre, un chiffre ou un bord de schéma coupé).
  function figureEdgeInk(canvas) {
    var w = canvas.width, h = canvas.height;
    var data = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    var lum = function (x, y) { var k = (y * w + x) * 4; return 0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2]; };
    // Fond = luminance claire typique de la découpe (90e centile d'un échantillon).
    var sample = [];
    for (var sy = 0; sy < h; sy += Math.max(1, Math.floor(h / 40))) for (var sx = 0; sx < w; sx += Math.max(1, Math.floor(w / 40))) sample.push(lum(sx, sy));
    sample.sort(function (a, b) { return a - b; });
    // Document à fond sombre (mode sombre, tableau noir) : l'« encre » est alors plus CLAIRE que le fond.
    var median = sample[Math.floor(sample.length * 0.5)] || 255;
    var dark = median < 110;
    var bg = dark ? (sample[Math.floor(sample.length * 0.1)] || 0) : (sample[Math.floor(sample.length * 0.9)] || 255);
    var isInk = dark ? function (x, y) { return lum(x, y) > bg + 70; } : function (x, y) { return lum(x, y) < bg - 70; };
    var band = 2;
    var side = function (horizontal, fixedStart) {
      var len = horizontal ? w : h, ink = 0;
      for (var p = 0; p < len; p++) {
        for (var d = 0; d < band; d++) {
          var c = fixedStart + d;
          if (horizontal ? isInk(p, Math.min(h - 1, c)) : isInk(Math.min(w - 1, c), p)) { ink++; break; }
        }
      }
      return ink / Math.max(1, len);
    };
    return { top: side(true, 0), bottom: side(true, h - band), left: side(false, 0), right: side(false, w - band) };
  }
  async function cropUntilEdgesClear(source, r) {
    var clamp = function (b) {
      var x = Math.max(0, b.x), y = Math.max(0, b.y);
      return { x: x, y: y, w: Math.min(source.w, b.x + b.w) - x, h: Math.min(source.h, b.y + b.h) - y };
    };
    var box = clamp(r);
    if (box.w < 20 || box.h < 20) return null;
    var canvas = await source.renderCanvas(box.x, box.y, box.w, box.h);
    // On n'élargit que pour de FINS traits coupés (1,5 % à 45 % du bord) : un bord presque entièrement
    // « encré » est une grande zone (ombre de la photo, table, fond d'un encadré), pas un trait coupé.
    var cutSide = function (v) { return v > 0.015 && v < 0.45; };
    for (var round = 0; round < 12; round++) {
      var e = figureEdgeInk(canvas);
      var stepX = Math.max(16, box.w * 0.06), stepY = Math.max(16, box.h * 0.06);
      var grow = { x: box.x, y: box.y, w: box.w, h: box.h }, changed = false;
      if (cutSide(e.left) && box.x > 0) { grow.x -= stepX; grow.w += stepX; changed = true; }
      if (cutSide(e.right) && box.x + box.w < source.w) { grow.w += stepX; changed = true; }
      if (cutSide(e.top) && box.y > 0) { grow.y -= stepY; grow.h += stepY; changed = true; }
      if (cutSide(e.bottom) && box.y + box.h < source.h) { grow.h += stepY; changed = true; }
      if (!changed) break;
      box = clamp(grow);
      canvas = await source.renderCanvas(box.x, box.y, box.w, box.h);
    }
    return { url: canvas.toDataURL("image/jpeg", 0.9), box: box };
  }
  // Dernière vérification de chaque découpe, par l'IA, sur l'image finale elle-même : la vérification au
  // pixel ne sait pas distinguer un trait du schéma d'une ligne de texte voisine (un schéma encadré collé
  // à une colonne de texte récupérait des bouts de phrases, voire s'agrandissait vers le texte). L'IA
  // retire ce qui n'appartient pas au schéma, et signale un bord où il est coupé (on élargit alors ce côté).
  var FIGURE_REVIEW_SCHEMA = {
    type: "object",
    properties: {
      cutSides: { type: "array", items: { type: "string", enum: ["top", "bottom", "left", "right"] }, description: "Bords de l'image par lesquels le visuel est coupé (il continue au-delà). Vide s'il est entier." },
      box: { type: "array", items: { type: "integer" }, description: "[ymin, xmin, ymax, xmax] sur 0-1000 dans CETTE image : le visuel entier (titre, annotations, légendes, cadre éventuel compris), sans aucun texte du cours qui ne lui appartient pas." }
    },
    required: ["cutSides", "box"]
  };
  function buildFigureReviewPrompt(caption) {
    return "Cette image est une découpe qui doit contenir UNIQUEMENT ce visuel : « " + caption + " ».\n" +
      FIGURE_SCOPE_RULE + "\n" +
      "1. Si le visuel est coupé par un bord de l'image (une partie du dessin, de la photo, du cadre ou de ses annotations continue au-delà), indique ce ou ces bords dans \"cutSides\". Regarde chaque bord attentivement : une photo dont on ne voit pas le bord net est coupée.\n" +
      "2. Donne dans \"box\" la zone [ymin, xmin, ymax, xmax] (0-1000, relative à cette image) qui contient TOUT le visuel mais RIEN de ce qui n'en fait pas partie (titre d'exercice, questions, texte voisin, même coupé ou collé au visuel). Si l'image ne contient que le visuel, renvoie [0, 0, 1000, 1000].\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni.";
  }
  async function reviewFigureCrop(source, box, caption) {
    var cur = { x: box.x, y: box.y, w: box.w, h: box.h };
    var clamp = function (b) {
      var x = Math.max(0, b.x), y = Math.max(0, b.y);
      return { x: x, y: y, w: Math.min(source.w, b.x + b.w) - x, h: Math.min(source.h, b.y + b.h) - y };
    };
    for (var round = 0; round < 3; round++) {
      var url = await source.renderRegion(cur.x, cur.y, cur.w, cur.h);
      var r = null;
      try { r = await callGemini(geminiImageParts([url]).concat([{ text: buildFigureReviewPrompt(caption) }]), FIGURE_REVIEW_SCHEMA); } catch (e) { r = null; }
      if (!r) return { url: url, box: cur };
      var cut = (r.cutSides || []).filter(function (sd) {
        return (sd === "top" && cur.y > 0) || (sd === "left" && cur.x > 0) || (sd === "bottom" && cur.y + cur.h < source.h) || (sd === "right" && cur.x + cur.w < source.w);
      });
      if (cut.length && round < 2) {
        var gx = cur.w * 0.25, gy = cur.h * 0.25, g = { x: cur.x, y: cur.y, w: cur.w, h: cur.h };
        if (cut.indexOf("left") !== -1) { g.x -= gx; g.w += gx; }
        if (cut.indexOf("right") !== -1) { g.w += gx; }
        if (cut.indexOf("top") !== -1) { g.y -= gy; g.h += gy; }
        if (cut.indexOf("bottom") !== -1) { g.h += gy; }
        cur = clamp(g);
        continue;
      }
      if (isValidFigureBox(r.box)) {
        var nb = { x: cur.x + r.box[1] / 1000 * cur.w, y: cur.y + r.box[0] / 1000 * cur.h, w: (r.box[3] - r.box[1]) / 1000 * cur.w, h: (r.box[2] - r.box[0]) / 1000 * cur.h };
        // Garde-fou : une « correction » qui ne garderait presque rien est plus probablement une erreur.
        if (nb.w * nb.h >= 0.2 * cur.w * cur.h) {
          var pad = Math.max(6, Math.min(nb.w, nb.h) * 0.02);
          var trimmed = clamp({ x: nb.x - pad, y: nb.y - pad, w: nb.w + 2 * pad, h: nb.h + 2 * pad });
          if (trimmed.w >= 20 && trimmed.h >= 20) return { url: await source.renderRegion(trimmed.x, trimmed.y, trimmed.w, trimmed.h), box: trimmed };
        }
      }
      return { url: url, box: cur };
    }
    return { url: await source.renderRegion(cur.x, cur.y, cur.w, cur.h), box: cur };
  }
  function figBoxOverlap(a, b) {
    var ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    var iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return (ix * iy) / Math.max(1, Math.min(a.w * a.h, b.w * b.h));
  }
  // Repère et découpe les visuels du document. Ne bloque jamais la génération : en cas d'échec on renvoie
  // ok=false et la génération repère alors les schémas elle-même, comme avant.
  // report(base, span, type) : avancement réel (voir genSub), 60 % pour le repérage, 40 % pour les zooms.
  async function prepareDocumentFigures(images, report) {
    report = report || function () {};
    var empty = { ok: false, list: [], subs: [], figures: [] };
    if (!images || !images.length) return empty;
    var sources = [];
    try {
      sources = await buildFigureSources(images);
      var truncated = !!sources.truncated, failedBatches = 0;
      // 1. Tranches de toutes les sources, repérage par lots de quelques tranches.
      var tiles = [];
      sources.forEach(function (s, si) {
        figureTilesFor(s).forEach(function (t) {
          if (tiles.length < FIG_MAX_TILES) tiles.push({ si: si, x: t.x, y: t.y, w: t.w, h: t.h });
          else truncated = true;
        });
      });
      for (var ti = 0; ti < tiles.length; ti++) tiles[ti].dataUrl = await sources[tiles[ti].si].renderRegion(tiles[ti].x, tiles[ti].y, tiles[ti].w, tiles[ti].h);
      var batches = [];
      for (var b = 0; b < tiles.length; b += FIG_TILES_PER_CALL) batches.push(tiles.slice(b, b + FIG_TILES_PER_CALL));
      var found = [], anyBatchOk = false, batchesDone = 0;
      var reportBatches = function () { report(0.6 * batchesDone / batches.length, 0.6 * Math.min(2, batches.length - batchesDone) / batches.length, "figTile"); };
      reportBatches();
      await runWithConcurrency(batches.map(function (batch) {
        return function () {
          var t0 = Date.now();
          var batchDone = function () { batchesDone++; genLearn("figTile", Date.now() - t0); reportBatches(); };
          // Chaque image est précédée de son numéro écrit en clair : sans ça, l'IA se trompait parfois de
          // numéro (en comptant à partir de 1) et le schéma était cherché dans la mauvaise tranche.
          var parts = [];
          batch.forEach(function (t, k) { parts.push({ text: "Image " + k + " :" }); parts = parts.concat(geminiImageParts([t.dataUrl])); });
          parts.push({ text: buildTileDetectPrompt(batch.length) });
          // Un lot qui échoue (quota, serveurs saturés) est retenté une fois après une pause, plutôt que de
          // perdre en silence les schémas de ces tranches.
          return callGemini(parts, FIGURE_TILE_DETECT_SCHEMA).catch(function () {
            return sleep(8000).then(function () { return callGemini(parts, FIGURE_TILE_DETECT_SCHEMA); });
          }).catch(function (err) { failedBatches++; throw err; }).then(function (data) {
            anyBatchOk = true;
            (data && data.figures || []).forEach(function (f) {
              var t = batch[f.imageIndex];
              if (!t || !isValidFigureBox(f.box)) return;
              var x0 = t.x + f.box[1] / 1000 * t.w, x1 = t.x + f.box[3] / 1000 * t.w;
              var y0 = t.y + f.box[0] / 1000 * t.h, y1 = t.y + f.box[2] / 1000 * t.h;
              found.push({ si: t.si, x: x0, y: y0, w: x1 - x0, h: y1 - y0, caption: f.caption || "", cut: !!f.cut, tileW: t.w, tileH: t.h });
            });
          }).then(batchDone, function (err) { batchDone(); throw err; });
        };
      }), 2);
      if (!anyBatchOk) return empty;
      // 2a. Visuel plus grand qu'une tranche : il est coupé PARTOUT, et chaque tranche n'en donne qu'un
      // morceau. On recolle les morceaux coupés qui se touchent (même colonne/ligne, bords adjacents ou
      // superposés) en un seul rectangle, avant le zoom.
      var touches = function (a, b) {
        var ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        var tolY = 0.06 * Math.max(a.tileH, b.tileH), tolX = 0.06 * Math.max(a.tileW, b.tileW);
        return (ox > 0.5 * Math.min(a.w, b.w) && oy > -tolY) || (oy > 0.5 * Math.min(a.h, b.h) && ox > -tolX);
      };
      for (var mergedSome = true; mergedSome;) {
        mergedSome = false;
        for (var ai = 0; ai < found.length && !mergedSome; ai++) {
          for (var bi = ai + 1; bi < found.length; bi++) {
            var A = found[ai], B = found[bi];
            if (A.si !== B.si || !(A.cut || B.cut) || !touches(A, B)) continue;
            var nx = Math.min(A.x, B.x), ny = Math.min(A.y, B.y);
            found[ai] = { si: A.si, x: nx, y: ny, w: Math.max(A.x + A.w, B.x + B.w) - nx, h: Math.max(A.y + A.h, B.y + B.h) - ny,
              caption: A.caption.length >= B.caption.length ? A.caption : B.caption, cut: true, tileW: A.tileW, tileH: A.tileH };
            found.splice(bi, 1);
            mergedSome = true;
            break;
          }
        }
      }
      // 2b. Doublons (même visuel vu en entier dans deux tranches qui se chevauchent) : on garde le plus grand.
      found.sort(function (a, b) { return b.w * b.h - a.w * a.h; });
      var kept = [];
      found.forEach(function (f) {
        if (kept.length >= FIG_MAX_FIGURES) { truncated = true; return; }
        if (!kept.some(function (k) { return k.si === f.si && figBoxOverlap(k, f) > 0.5; })) kept.push(f);
      });
      kept.sort(function (a, b) { return a.si - b.si || a.y - b.y; }); // ordre de lecture
      // 3. Zoom de vérification autour de chaque visuel, puis découpe finale à pleine résolution.
      var crops = [], finals = [], zoomsDone = 0;
      var reportZooms = function () { report(0.6 + 0.4 * zoomsDone / Math.max(1, kept.length), 0.4 * Math.min(2, kept.length - zoomsDone) / Math.max(1, kept.length), "figZoom"); };
      reportZooms();
      await runWithConcurrency(kept.map(function (f, i) {
        var zoomTask = function () {
          var s = sources[f.si];
          // Visuel plus grand qu'une tranche (morceaux recollés) : un zoom serait encore une bande trop
          // réduite pour l'IA. On part directement du rectangle recollé et la vérification au pixel des
          // bords l'agrandit jusqu'à ce que plus aucun trait ne soit coupé.
          if ((f.tileH < s.h && f.h > f.tileH * 0.9) || (f.tileW < s.w && f.w > f.tileW * 0.9)) {
            var bp = Math.max(10, Math.min(f.w, f.h) * 0.04);
            return cropUntilEdgesClear(s, { x: f.x - bp, y: f.y - bp, w: f.w + 2 * bp, h: f.h + 2 * bp }).then(function (res) { return res ? reviewFigureCrop(s, res.box, f.caption) : null; }).then(function (res) {
              if (res) { crops[i] = res.url; finals[i] = res.box; }
            });
          }
          var mx = Math.max(40, f.w * 0.25), my = Math.max(40, f.h * 0.35);
          // Visuel coupé au bord d'une tranche : on regarde beaucoup plus haut et plus bas pour le récupérer en entier.
          if (f.cut) { if (f.tileH < s.h) my = Math.max(my, f.tileH * 0.6); if (f.tileW < s.w) mx = Math.max(mx, f.tileW * 0.6); }
          var cx = Math.max(0, f.x - mx), cy = Math.max(0, f.y - my);
          var cw = Math.min(s.w, f.x + f.w + mx) - cx, ch = Math.min(s.h, f.y + f.h + my) - cy;
          return s.renderRegion(cx, cy, cw, ch).then(function (zoomUrl) {
            return callGemini(geminiImageParts([zoomUrl]).concat([{ text: buildFigureZoomPrompt(f.caption) }]), FIGURE_ZOOM_SCHEMA)
              .catch(function () { return null; })
              .then(function (z) {
                var box = { x: f.x, y: f.y, w: f.w, h: f.h };
                if (z && z.found === false) return null; // zoom : finalement pas un visuel
                if (z && isValidFigureBox(z.box)) {
                  box = { x: cx + z.box[1] / 1000 * cw, y: cy + z.box[0] / 1000 * ch, w: (z.box[3] - z.box[1]) / 1000 * cw, h: (z.box[2] - z.box[0]) / 1000 * ch };
                }
                var pad = Math.max(10, Math.min(box.w, box.h) * 0.04);
                var r = { x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad };
                return cropUntilEdgesClear(s, r).then(function (res) { return res ? reviewFigureCrop(s, res.box, f.caption) : null; }).then(function (res) {
                  if (res) { crops[i] = res.url; finals[i] = res.box; }
                });
              });
          });
        };
        return function () {
          var t0 = Date.now();
          var zoomDone = function () { zoomsDone++; genLearn("figZoom", Date.now() - t0); reportZooms(); };
          return Promise.resolve().then(zoomTask).then(zoomDone, function (err) { zoomDone(); throw err; });
        };
      }), 2);
      // 4. Deuxième chasse aux doublons, APRÈS le zoom : deux morceaux d'un même grand schéma (coupé dans
      // deux tranches) se recouvraient peu au repérage, mais le zoom les agrandit tous deux jusqu'au schéma
      // entier. On ne garde alors que la découpe la plus grande.
      // 4a. Deux morceaux d'un même visuel (même légende, même page) qui se touchent ou se chevauchent :
      // on les recolle en une seule découpe. Ex. une photo coupée par la limite entre deux tranches,
      // repérée en deux moitiés qui portaient la même légende « Exercice 23 - Photo du Soleil ».
      var normCap = function (c) { return String(c || "").toLowerCase().replace(/[^a-z0-9à-ÿ]+/g, " ").trim(); };
      for (var mergedAny = true; mergedAny;) {
        mergedAny = false;
        var idxs = kept.map(function (f, i) { return i; }).filter(function (i) { return crops[i]; });
        for (var pa = 0; pa < idxs.length && !mergedAny; pa++) {
          for (var pb = pa + 1; pb < idxs.length && !mergedAny; pb++) {
            var ia = idxs[pa], ib = idxs[pb], A = finals[ia], B = finals[ib];
            if (kept[ia].si !== kept[ib].si || !normCap(kept[ia].caption) || normCap(kept[ia].caption) !== normCap(kept[ib].caption)) continue;
            var gapX = Math.max(A.x, B.x) - Math.min(A.x + A.w, B.x + B.w), gapY = Math.max(A.y, B.y) - Math.min(A.y + A.h, B.y + B.h);
            var tol = 0.15 * Math.max(A.w, A.h, B.w, B.h);
            if (gapX > tol || gapY > tol) continue;
            var src = sources[kept[ia].si];
            var ux = Math.min(A.x, B.x), uy = Math.min(A.y, B.y);
            var u = { x: ux, y: uy, w: Math.max(A.x + A.w, B.x + B.w) - ux, h: Math.max(A.y + A.h, B.y + B.h) - uy };
            crops[ia] = await src.renderRegion(u.x, u.y, u.w, u.h);
            finals[ia] = u;
            crops[ib] = null;
            mergedAny = true;
          }
        }
      }
      var order = kept.map(function (f, i) { return i; }).filter(function (i) { return crops[i]; })
        .sort(function (a, b) { return finals[b].w * finals[b].h - finals[a].w * finals[a].h; });
      var finalKeep = {};
      order.forEach(function (i) {
        var dup = Object.keys(finalKeep).some(function (j) { return kept[j].si === kept[i].si && figBoxOverlap(finals[j], finals[i]) > 0.5; });
        if (!dup) finalKeep[i] = true;
      });
      var list = [], subs = [], figures = [];
      kept.forEach(function (f, i) {
        if (!crops[i] || !finalKeep[i]) return;
        var placeholder = "[[img:" + list.length + "]]";
        var caption = String(f.caption || "").replace(/[[\]]/g, "");
        var fid = uid();
        figures.push({ id: fid, image: crops[i], caption: caption });
        subs.push({ placeholder: placeholder, replacement: "![" + caption + "](figure:" + fid + ")" });
        // Position dans le document, pour que la génération place chaque schéma au bon endroit du texte même
        // quand deux légendes se ressemblent.
        var src = sources[f.si];
        var along = src.h >= src.w ? (f.y + f.h / 2) / src.h : (f.x + f.w / 2) / src.w;
        var where = "fichier " + (src.fileIndex + 1) + (src.page > 1 || sources.some(function (o) { return o.fileIndex === src.fileIndex && o.page > 1; }) ? ", page " + src.page : "") +
          ", vers " + Math.round(along * 100) + " % de " + (src.h >= src.w ? "la hauteur" : "la largeur");
        list.push({ placeholder: placeholder, caption: caption, imageIndex: src.fileIndex, where: where, order: list.length + 1 });
      });
      var warning = truncated ? "Document très long : seuls les schémas du début ont pu être récupérés automatiquement."
        : failedBatches ? "Certains passages du document n'ont pas pu être analysés (serveurs saturés) : il peut manquer des schémas."
        : "";
      return { ok: true, list: list, subs: subs, figures: figures, warning: warning };
    } catch (err) {
      console.error("Détection des schémas :", err);
      return empty;
    } finally {
      sources.forEach(function (s) { if (s.doc && !s.doc._destroyed) { s.doc._destroyed = true; try { s.doc.destroy(); } catch (e) {} } });
    }
  }
  // Consigne donnée à la génération quand les schémas sont déjà découpés : elle n'a plus qu'à placer
  // les jetons. Chaîne vide s'il n'y en a pas (la génération garde alors sa propre détection).
  function preFiguresPromptText(pre, where) {
    if (pre && pre.ok && !pre.list.length) return "SCHÉMAS : les visuels du document ont déjà été repérés à part (il n'y en a aucun à placer). Laisse \"figures\" vide et n'insère aucun jeton [[figure:N]].\n\n";
    if (!pre || !pre.list || !pre.list.length) return "";
    return "SCHÉMAS DÉJÀ DÉCOUPÉS — les visuels du document ont déjà été repérés et découpés :\n" +
      pre.list.map(function (f) { return f.placeholder + " — n° " + f.order + " dans l'ordre du document — " + (f.where || "fichier " + f.imageIndex) + " — " + f.caption; }).join("\n") + "\n" +
      "Insère CHAQUE jeton ci-dessus tel quel, seul sur sa ligne, " + where + ", à l'endroit exact où ce visuel apparaît dans le document. N'en oublie aucun, ne les décris pas en mots à la place, ne les modifie pas. Laisse \"figures\" vide et n'insère aucun autre jeton : tous les visuels ont déjà été repérés et découpés à part.\n\n";
  }
  // Jetons que la génération n'a pas placés : on n'en perd aucun.
  function unplacedPreFigures(pre, texts) {
    var all = (texts || []).join("\n");
    return (pre && pre.subs || []).filter(function (s) { return all.indexOf(s.placeholder) === -1; });
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

