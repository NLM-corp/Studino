"use strict";
// Studino — appels à l'IA, retranscription, pourcentages
// Fichier chargé dans l'ordre par index.html : les fichiers partagent les mêmes variables globales.

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
            imageIndex: { type: "integer", description: "Index (à partir de 0) du fichier source (photo ou PDF) où se trouve ce schéma." },
            pageIndex: { type: "integer", description: "Si ce fichier est un PDF : numéro de la page (à partir de 1) où se trouve ce schéma. Pour une photo : 1." },
            box: { type: "array", items: { type: "integer" }, description: "Zone [ymin, xmin, ymax, xmax] du schéma dans cette photo (ou dans cette page du PDF), sur une échelle 0-1000, qui contient TOUT le schéma avec ses propres annotations (lettres, valeurs, axes, graduations, légende) mais pas le texte de l'énoncé autour." },
            caption: { type: "string", description: "Légende courte et DISTINCTIVE : à quel exercice/partie il appartient (ex. \"Exercice 3 — triangle ABC rectangle en B\") et ce qu'il montre, pour ne jamais le confondre avec un autre schéma de la même page." },
            placeholder: { type: "string", description: "Jeton unique au format [[figure:N]] (N = index de cette figure) à insérer tel quel dans \"transcription\" et/ou \"explanation\" à l'endroit exact où ce schéma doit apparaître." }
          },
          required: ["imageIndex", "box", "caption", "placeholder"]
        }
      }
    },
    required: ["transcription", "explanation", "flashcards", "quizQuestions", "exercises", "figures"]
  };

  function buildCoursePrompt(title, subjectName, chapterName, imageCount, priorTranscription, pre, pagesText, addMode) {
    var step1;
    if (priorTranscription) {
      step1 = imageCount > 0
        // mergeNewOnly : volontairement, "transcription" ne doit contenir QUE le nouveau contenu — le
        // contenu déjà connu est donné ci-dessous UNIQUEMENT comme contexte (pour que l'explication et
        // les questions restent cohérentes), jamais pour être réécrit. Faire réécrire par l'IA un long
        // texte déjà transcrit, même avec la consigne "ne perds rien", finit toujours par le compresser
        // un peu (une tendance naturelle des modèles à "faire plus propre") — la seule façon de garantir
        // zéro perte est de ne plus jamais y retoucher, et de laisser le code les recoller tel quel.
        ? "Ce cours a déjà été retranscrit à partir de documents précédents. Voici son contenu déjà connu, donné ici UNIQUEMENT comme contexte pour que ton explication/tes questions restent cohérentes avec lui — tu ne dois PAS le recopier ni le reformuler dans \"transcription\" :\n\n" + priorTranscription + "\n\nL'élève vient d'ajouter " + imageCount + " nouvelle(s) photo(s)/page(s) à ce même cours (fournies ci-dessous, dans l'ordre). Dans le champ \"transcription\" de ta réponse, retranscris UNIQUEMENT ce que CES NOUVELLES photos apportent de NOUVEAU par rapport au contenu déjà connu ci-dessus, fidèlement et intégralement : un passage déjà présent dans le contenu connu (même formulé un peu autrement, une page reprise, recoupée ou mieux photographiée) ne doit PAS être recopié une deuxième fois ; s'il n'y a absolument rien de nouveau, laisse \"transcription\" vide. Retranscris le nouveau en Markdown structuré (## et ### pour les titres, - pour les listes, ** pour le gras) — reprends les détails/exemples/remarques QUI SONT RÉELLEMENT ÉCRITS SUR CES PHOTOS, jamais un exemple ou un détail que tu inventerais toi-même. Le contenu déjà connu ci-dessus sera rajouté automatiquement par le site, tel quel, tu n'as pas à t'en occuper."
        : "Ce cours a déjà été retranscrit à partir de documents précédents (aucune nouvelle photo n'est fournie cette fois). Reprends sa transcription telle quelle dans \"transcription\" (tu peux la nettoyer légèrement si besoin, mais garde tout le contenu, en Markdown structuré). Les jetons de la forme [[keep:...]] sont des schémas : recopie-les tels quels, chacun seul sur sa ligne, exactement au même endroit du texte :\n\n" + priorTranscription;
    } else if (imageCount === 0) {
      step1 = "Aucune photo n'a été fournie : rédige à partir du seul titre un contenu de cours plausible, rigoureux et structuré en Markdown (## et ### pour les titres, - pour les listes, ** pour le gras).";
    } else if (imageCount === 1) {
      step1 = "Retranscris fidèlement et INTÉGRALEMENT le contenu visible sur la photo, en Markdown structuré (## et ### pour les titres, - pour les listes, ** pour le gras). Corrige les fautes évidentes mais garde le sens exact. C'est une vraie retranscription, pas une synthèse : ne garde pas seulement les points importants, reprends aussi les détails, exemples et remarques annexes QUI SONT RÉELLEMENT ÉCRITS SUR LA PHOTO (jamais un exemple ou un détail que tu inventerais toi-même pour illustrer — la transcription doit rester un reflet fidèle à 100% de ce que l'enseignant a écrit, rien de plus, rien de moins). Ne résume et ne saute rien : si la photo contient un tableau ou une liste de définitions/dates/formules, retranscris-le intégralement, ligne par ligne ou case par case, sans en omettre aucune.";
    }
    // Retranscription déjà faite à part, page par page (voir transcribeDocumentPages) : la génération ne
    // la refait pas, elle s'en sert pour l'explication, les flashcards, le contrôle et les exercices.
    if (pagesText) {
      step1 = (addMode
        ? "Voici le contenu DÉJÀ CONNU de ce cours, donné UNIQUEMENT comme contexte (il est déjà traité) :\n\n" + (priorTranscription || "") + "\n\nEt voici le NOUVEAU contenu, déjà retranscrit page par page :\n\n"
        : "Voici la retranscription intégrale du cours, déjà faite page par page :\n\n") +
        pagesText + "\n\nNe refais PAS la retranscription : renvoie \"transcription\" vide (chaîne vide). Les étapes suivantes s'appuient sur ce texte.";
    } else if (imageCount > 1 && !priorTranscription) {
      step1 = "Les " + imageCount + " photos fournies sont plusieurs pages du même cours, dans l'ordre. Retranscris-les fidèlement et INTÉGRALEMENT en un seul contenu cohérent et continu, en Markdown structuré (## et ### pour les titres, - pour les listes, ** pour le gras). Corrige les fautes évidentes mais garde le sens exact. C'est une vraie retranscription, pas une synthèse : ne garde pas seulement les points importants, reprends aussi les détails, exemples et remarques annexes QUI SONT RÉELLEMENT ÉCRITS SUR LES PHOTOS (jamais un exemple ou un détail que tu inventerais toi-même pour illustrer — la transcription doit rester un reflet fidèle à 100% de ce que l'enseignant a écrit, rien de plus, rien de moins). Ne résume et ne saute rien : si le cours contient un tableau ou une liste de définitions/dates/formules, retranscris-le intégralement, ligne par ligne ou case par case, sans en omettre aucune.";
    }
    return "Tu es un assistant pédagogique pour un élève francophone. Voici un cours intitulé « " + title + " » (matière : " + subjectName + ", chapitre : " + chapterName + ").\n\n" +
      COURSE_LANGUAGE_RULE +
      preFiguresPromptText(pre, "dans \"transcription\" (et aussi dans \"explanation\" là où c'est utile)") +
      "Règle importante : si un passage du contenu source correspond mot pour mot à un texte déjà public sur internet (article Wikipedia, site d'analyse littéraire, résumé de manuel, etc. — ce qui arrive souvent quand l'enseignant a lui-même repris une source en ligne), REFORMULE ce passage avec des mots différents en gardant strictement le même sens, la même structure et toutes les informations (dates, définitions, courtes citations d'œuvres entre guillemets restent autorisées) plutôt que de le recopier tel quel. Ce n'est pas à l'élève de rendre des comptes sur les sources utilisées par son enseignant.\n\n" +
      "1. " + step1 + "\n" +
      ((addMode || (priorTranscription && imageCount > 0)) ? "MODE AJOUT (prioritaire sur les consignes 2 à 6) : l'explication, les flashcards, les questions de révision et les exercices du contenu déjà connu EXISTENT DÉJÀ et sont conservés tels quels. \"explanation\", \"flashcards\", \"quizQuestions\" et \"exercises\" doivent donc porter UNIQUEMENT sur le contenu NOUVEAU que tu as mis dans \"transcription\" (en restant cohérents avec le reste du cours), sans reprendre ce qui est déjà couvert. Les nombres minimums indiqués plus bas ne s'appliquent pas : adapte-les à la quantité de contenu nouveau. Si \"transcription\" est vide, laisse-les tous vides.\n" : "") +
      "2. Rédige une VRAIE explication pédagogique approfondie, pas un résumé reformulé en plus simple. Pour CHAQUE notion du cours (pas seulement les principales) : explique le \"pourquoi\" avant/avec le \"quoi\" (d'où ça vient, à quoi ça sert, pourquoi c'est vrai ou pourquoi on en a besoin), donne au moins un exemple concret et chiffré/situé (jamais juste \"par exemple...\" vague), anticipe et lève explicitement la confusion ou l'erreur la plus fréquente sur cette notion précise (\"beaucoup d'élèves confondent X et Y, mais...\"), et relie la notion à celles qui précèdent/suivent dans le cours pour que l'ensemble forme un raisonnement cohérent plutôt qu'une liste de paragraphes indépendants. Structure-la en Markdown avec les mêmes ## et ### que la retranscription (une sous-section par grande notion), jamais un seul bloc de texte continu. Une explication qui se contente de reformuler la transcription avec des mots plus simples, sans profondeur ni exemple ni mise en garde, est un ÉCHEC — vise la longueur et la richesse qu'il faut pour que l'élève comprenne vraiment, pas un résumé expéditif.\n" +
      "3. Les vidéos YouTube recommandées sont gérées séparément après cette génération (recherche de vraies vidéos existantes) : ignore ce point ici.\n" +
      "4. Génère un nombre de flashcards (question / réponse courte) ADAPTÉ à la richesse réelle du cours (entre 5 et 20 au total) plutôt qu'un nombre fixe : pour un cours très court avec peu de notions, génère seulement 5 à 8 flashcards bien ciblées ; pour un cours long et dense couvrant beaucoup de notions, génère-en davantage, jusqu'à 20. Une notion distincte du cours = une flashcard, pas plus — ne crée jamais de flashcards redondantes ou artificielles juste pour atteindre un quota. Qualité exigée pour chaque flashcard : \"q\" doit être une question PRÉCISE et autonome (compréhensible sans relire le cours, jamais une question vague type \"à quoi ça sert ?\" sans préciser de quoi on parle) ; \"a\" doit être une réponse COMPLÈTE et formulée en vraie phrase (jamais un mot ou un fragment télégraphique isolé, sauf si la réponse est authentiquement un seul mot/une seule valeur comme une date ou un nombre) — une flashcard doit se suffire à elle-même pour réviser sans le cours sous les yeux.\n" +
      "5. Génère des questions de révision qui couvrent DE FAÇON EXHAUSTIVE tout ce qu'il y a à savoir par cœur dans ce cours — tu ne choisis pas un sous-ensemble et tu n'en oublies aucune. Repère chaque définition, chaque date, chaque notion, chaque formule ou notation à connaître par cœur, et chaque ligne/case d'un tableau à mémoriser, puis crée une question pour CHACUN d'entre eux, un par un. S'il y a 40 définitions dans le cours, génère 40 questions de définition (une par définition) ; s'il y a 3 formules à connaître par cœur, génère 3 questions de formule ; si un tableau contient 15 cases à mémoriser, génère les 15 questions correspondantes. Il n'y a AUCUNE limite haute au nombre de questions : le nombre exact dépend uniquement de ce qu'il y a à mémoriser dans le cours, même si ça fait beaucoup plus que d'habitude — ce n'est pas à toi de trier ou de raccourcir la liste. La seule chose à éviter est la vraie redondance (ne pose pas deux fois la même question sur le même élément) ou les questions hors-sujet ; en dehors de ça, couvre tout, sans exception. Varie les catégories dans le champ \"category\" : \"definition\" (qu'est-ce que...), \"formule\" (formule ou notation à connaître par cœur) et \"application\" (mini-exercice rapide d'application directe). RÈGLE STRICTE sur le type : toute question de catégorie \"definition\" ou \"formule\" — donc tout ce qui se récite mot pour mot — DOIT être de type \"ouverte\" (l'élève réécrit lui-même la définition/formule ; JAMAIS de type \"qcm\" pour ces deux catégories, reconnaître une bonne réponse parmi 4 ne prouve pas qu'on la sait par cœur). Seule la catégorie \"application\" peut être en \"qcm\", et encore minoritairement : au global sur l'ensemble des questions, le type \"ouverte\" doit rester largement majoritaire (au moins deux tiers), le \"qcm\" n'est qu'un complément. Qualité exigée, sans exception : l'énoncé (\"prompt\") doit être précis et sans ambiguïté (une seule bonne réponse possible, jamais une formulation qui prête à interprétation) ; pour un \"qcm\", les 3 mauvaises réponses doivent être réellement plausibles (des erreurs ou confusions fréquentes sur cette notion précise), jamais des réponses absurdes ou évidemment fausses qui rendent le choix trivial sans connaître le cours ; \"explanation\" doit vraiment expliquer POURQUOI la bonne réponse est correcte (et implicitement pourquoi les autres ne le sont pas pour un qcm), pas se contenter de la répéter. Une question mal formulée, ambiguë ou avec des distracteurs ridicules est un ÉCHEC même si la bonne réponse elle-même est juste.\n" +
      "6. Génère un nombre d'exercices plus complets ADAPTÉ à la richesse du cours (au moins 4, et bien plus pour un cours dense qui s'y prête — pas de plafond artificiel), volontairement PLUS DIFFICILES que les questions ci-dessus : plusieurs étapes de raisonnement ou de calcul, une vraie difficulté à surmonter, quitte à être longs si besoin (un exercice qui prend 15-20 minutes de réflexion n'est pas un problème, l'objectif est que l'élève ait vraiment cherché et progressé, pas reconnu une réponse en 30 secondes). Chacun avec un énoncé clair dans \"prompt\" et une solution rédigée complète et détaillée (avec le résultat final) dans \"solution\".\n" +
      (imageCount > 0 ? "7. Si une des photos sources contient un schéma, un graphique, une carte, un diagramme ou un dessin VISUEL réellement NÉCESSAIRE pour comprendre le cours (pas une simple photo décorative), repère-le et ajoute une entrée dans \"figures\" avec : \"imageIndex\" (index du fichier, à partir de 0), \"pageIndex\" (pour un PDF : numéro de la page où est le schéma, à partir de 1 ; pour une photo : 1), \"box\" (la zone rectangulaire exacte de ce schéma dans la photo, au format [ymin, xmin, ymax, xmax] sur une échelle de 0 à 1000, en excluant le texte autour), \"caption\" (légende courte et DISTINCTIVE : numéro de l'exercice ou de la partie + ce que montre le schéma, ex. \"Exercice 2 — circuit avec deux lampes en série\"), et \"placeholder\" (un jeton unique \"[[figure:N]]\" où N est l'index de cette figure dans le tableau \"figures\"). Insère ensuite ce jeton \"[[figure:N]]\" tel quel, seul sur sa ligne, exactement à l'endroit de \"transcription\" et/ou \"explanation\" où ce schéma doit apparaître — ne le décris jamais en mots à la place de l'insérer réellement. Signal à prendre TRÈS au sérieux : dès que le texte source dit \"ci-contre\", \"ci-dessous\", \"ci-joint\" ou \"ci-après\" à propos d'une représentation graphique/d'un schéma, c'est qu'un visuel est physiquement présent à cet endroit — cherche-le activement et capture-le, ne le laisse jamais de côté. Si le document contient PLUSIEURS exercices ou schémas sur une même page, crée une entrée séparée par schéma (jamais deux schémas dans une même zone, aucun oublié), avec une zone qui ne déborde pas sur le voisin, et place chaque jeton à côté du BON exercice/passage. INTERDIT : ne crée JAMAIS de figure pour du texte, même s'il apparaît visuellement dans un encadré, une bulle de citation, un fond coloré ou une police différente — une citation, un extrait de texte, une définition encadrée ou une légende écrite doivent TOUJOURS être retranscrits comme du texte normal (corrigé) dans \"transcription\"/\"explanation\", jamais capturés comme une image. \"figures\" est réservé exclusivement à du contenu qui ne peut PAS être retranscrit en texte (dessin, photo, graphique, carte, schéma). S'il n'y a aucun schéma nécessaire, renvoie un tableau \"figures\" vide.\n\n" : "\n") +
      "8. Pour CHAQUE question de révision et CHAQUE exercice (champ \"figureSvg\" de chacun) : dès qu'un support visuel est NÉCESSAIRE pour lire une DONNÉE externe du problème — même si l'énoncé ne le dit pas explicitement en mots (ex. donner des longueurs d'onde et demander une couleur suppose le spectre visible sous les yeux, même sans le mot \"spectre\" dans l'énoncé) —, tu DOIS dessiner toi-même ce support en SVG dans \"figureSvg\". ATTENTION, ne confonds jamais ça avec fournir la réponse : si la question teste une connaissance à savoir par cœur d'après le cours (une date/un événement d'histoire-géo, une formule de maths/physique à connaître, une définition, un résultat, un nom), \"figureSvg\" reste VIDE, un point c'est tout — par exemple jamais de frise chronologique pour une question de date, jamais la formule elle-même dessinée en image pour une question qui demande de connaître ou d'appliquer une formule du cours. " + FIGURE_SVG_FIELD_DESC + " Pour toutes les autres questions/exercices (la grande majorité, purement textuels ou calculatoires, ou testant une connaissance à savoir par cœur), laisse \"figureSvg\" vide.\n\n" +
      "Important — les flashcards, questions de révision et exercices doivent porter sur les notions, règles, définitions et méthodes du cours lui-même, jamais sur les exemples illustratifs qui les accompagnent. Interdit : des questions du type « quel exemple a été donné dans le cours pour... », « que valait X dans l'exemple », ou toute question qui ne teste que la mémorisation d'un détail d'exemple plutôt que la compréhension de la notion. Si le cours illustre une règle avec un exemple, interroge sur la règle elle-même (au besoin avec un cas ou des valeurs différents de ceux de l'exemple) — retenir un exemple par cœur n'apprend rien.\n\n" +
      "Pour toute formule ou notation mathématique/scientifique (dans n'importe quel champ), utilise du LaTeX délimité par $...$ en ligne ou $$...$$ pour une formule isolée — jamais de simple texte brut pour une formule. N'utilise jamais de commande de couleur LaTeX (\\textcolor, \\colorbox, \\color, etc.) pour surligner un terme : le texte doit toujours rester dans la couleur par défaut, utilise le gras (**) si tu veux mettre quelque chose en valeur.\n\n" +
      "Si le contenu source (ou ton explication) comporte un tableau, reproduis-le comme un vrai tableau Markdown, avec EXACTEMENT ce format (une ligne d'en-tête, puis une ligne de séparation avec des tirets, puis une ligne par ligne du tableau, jamais de texte ou de liste à puces à la place) :\n" +
      "| Colonne 1 | Colonne 2 |\n" +
      "|---|---|\n" +
      "| Valeur A | Valeur B |\n" +
      "| Valeur C | Valeur D |\n\n" +
      "Le site sait afficher de vrais tableaux, alors n'hésite pas à t'en servir dès que c'est pertinent (dans la retranscription comme dans l'explication) — mais respecte bien ce format ligne par ligne, sans jamais oublier la ligne de séparation |---|---|.\n\n" +
      COURSE_POSED_OPERATION_RULE +
      DRAWING_QUESTION_RULE +
      "Réponds uniquement en respectant le schéma JSON fourni, en français — sauf ce que la RÈGLE DE LANGUE du début impose de garder ou d'écrire dans une autre langue.";
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
  async function tryGeminiModel(apiKey, modelName, parts, schema, recitationCount, maxOutputTokens, timeoutMs) {
    timeoutMs = timeoutMs || 60000;
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
      res = await fetchWithTimeout(endpoint + "?key=" + encodeURIComponent(apiKey), { method: "POST", headers: { "content-type": "application/json" }, body: body }, timeoutMs);
    } catch (netErr) {
      var timedOut = netErr && netErr.name === "AbortError";
      var netError = new Error(timedOut ? "Gemini n'a pas répondu à temps (" + Math.round(timeoutMs / 1000) + "s)." : ("Connexion à Gemini impossible : " + (netErr && netErr.message || "erreur réseau")));
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
  async function attemptGeminiWithKey(apiKey, parts, schema, maxOutputTokens, timeoutMs) {
    var lastErr = null;
    var hadRateLimit = false;
    var recitationRetries = 0;
    // Serveurs Google saturés (503 « high demand ») : c'est passager mais ça touche souvent TOUS les
    // modèles en même temps. Plutôt que d'abandonner après un seul tour, on attend puis on refait le
    // tour des modèles (jusqu'à 2 fois de plus : après 8 s, puis 20 s).
    var OVERLOAD_WAITS = [8000, 20000];
    for (var round = 0; round <= OVERLOAD_WAITS.length; round++) {
      var hadOverload = false;
      for (var i = 0; i < GEMINI_MODELS.length; i++) {
        if (hadRateLimit) await sleep(4000); // laisse une chance à la limite par MINUTE de se libérer avant le modèle de secours suivant
        var r = await tryGeminiModel(apiKey, GEMINI_MODELS[i], parts, schema, recitationRetries, maxOutputTokens, timeoutMs);
        if (r.ok) return r.value;
        lastErr = r.err;
        if (r.rateLimit) hadRateLimit = true;
        if (r.recitation) recitationRetries++;
        if (r.err && (r.err.status === 503 || /overload|unavailable|high demand/i.test(r.err.message || ""))) hadOverload = true;
        if (!r.retryable) throw lastErr;
      }
      if (!hadOverload || hadRateLimit || round === OVERLOAD_WAITS.length) break;
      await sleep(OVERLOAD_WAITS[round]);
    }
    // Dernier recours spécifique au blocage RECITATION : la boucle ci-dessus finit sur flash-lite, le
    // modèle le moins capable de reformuler intelligemment un contenu très indexé en ligne — on retente
    // donc une dernière fois avec le modèle le PLUS capable (le premier de la liste) et la consigne de
    // reformulation la plus insistante, plutôt que d'abandonner sur l'essai le plus faible.
    if (recitationRetries > 0 && GEMINI_MODELS.length > 1) {
      var last = await tryGeminiModel(apiKey, GEMINI_MODELS[0], parts, schema, recitationRetries + 1, maxOutputTokens, timeoutMs);
      if (last.ok) return last.value;
      lastErr = last.err;
    }
    var finalErr = lastErr || new Error("Erreur inconnue de l'API Gemini.");
    finalErr.rateLimited = hadRateLimit;
    if (hadOverload && !hadRateLimit) finalErr.message = "Les serveurs de Google sont saturés en ce moment (ce n'est ni ta clé ni ton quota). Réessaie dans quelques minutes.";
    throw finalErr;
  }
  // maxOutputTokens et timeoutMs sont optionnels (défauts : limite du modèle, 60s) — utilisés pour les
  // générations dont la sortie peut légitimement être très longue (ex. un podcast à plusieurs parties de
  // plusieurs milliers de mots chacune) : sans un délai allongé en conséquence, une réponse volumineuse
  // qui met plus de 60s à s'écrire se fait couper court côté navigateur avant même que Gemini ait fini,
  // ce qui ressemble à un échec silencieux (ça recommence sur le modèle suivant, en boucle, très long).
  async function callGemini(parts, schema, maxOutputTokens, timeoutMs) {
    var primaryKey = getApiKey();
    if (!primaryKey) { var e = new Error("Ajoute ta clé API Gemini dans les paramètres avant de continuer."); e.code = "NO_API_KEY"; throw e; }
    try {
      return await attemptGeminiWithKey(primaryKey, parts, schema, maxOutputTokens, timeoutMs);
    } catch (err1) {
      var backupKey = getBackupApiKey();
      if (!err1.rateLimited || !backupKey) throw (err1.rateLimited ? rateLimitFallbackError(err1.detail, false) : err1);
      // Clé principale à quota sur ses 4 modèles : bascule entière sur la clé de secours (compte Google
      // différent, donc quota totalement indépendant) avant d'abandonner pour de bon.
      try {
        return await attemptGeminiWithKey(backupKey, parts, schema, maxOutputTokens, timeoutMs);
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

  async function generateCourseContent(imageDataUrls, title, subjectName, chapterName, priorTranscription, pre, pagesText, addMode) {
    // Retranscription déjà faite page par page : les photos ne sont pas renvoyées (le texte suffit pour
    // l'explication, les flashcards et le contrôle, et ça allège beaucoup l'appel).
    if (pagesText) {
      return callGemini([{ text: buildCoursePrompt(title, subjectName, chapterName, 0, priorTranscription, null, pagesText, addMode) }], COURSE_SCHEMA);
    }
    var images = (imageDataUrls || []).map(function (url) {
      var m = /^data:(image\/[a-zA-Z+]+|application\/pdf);base64,(.+)$/.exec(url || "");
      return m ? { inline_data: { mime_type: m[1], data: m[2] } } : null;
    }).filter(Boolean);
    var parts = images.concat([{ text: buildCoursePrompt(title, subjectName, chapterName, images.length, priorTranscription, pre) }]);
    return callGemini(parts, COURSE_SCHEMA);
  }

  /* ---------------- Retranscription page par page ----------------
     Avant, la retranscription se faisait dans le même gros appel que l'explication, les flashcards, le
     contrôle et les exercices : avec beaucoup de pages (ex. 16 captures d'exercices), l'IA en sautait
     une bonne partie pour finir. Elle est maintenant faite à part, quelques pages à la fois, puis
     recollée dans l'ordre : chaque appel a peu de pages et doit tout recopier. */
  var PAGE_TRANSCRIPTION_SCHEMA = {
    type: "object",
    properties: { transcription: { type: "string", description: "Retranscription intégrale et fidèle de ces pages, en Markdown." } },
    required: ["transcription"]
  };
  function buildPageTranscriptionPrompt(title, subjectName, label, tokens, priorContext) {
    return "Voici " + label + " d'un document de cours ou d'exercices intitulé « " + title + " » (matière : " + subjectName + ").\n\n" +
      COURSE_LANGUAGE_RULE +
      "Retranscris fidèlement et INTÉGRALEMENT tout le contenu de " + label + ", en Markdown structuré (## et ### pour les titres, - pour les listes, ** pour le gras). C'est une vraie retranscription, pas un résumé :\n" +
      "- N'oublie RIEN : chaque titre, chaque paragraphe, chaque définition, chaque exercice (avec son numéro et son titre, son énoncé complet, TOUTES ses questions numérotées ou lettrées, ses données et ses encadrés), même s'il y en a beaucoup et même si c'est long. Si la page contient plusieurs colonnes, retranscris une colonne entière puis la suivante, dans l'ordre de lecture.\n" +
      "- Une question par ligne, numérotée comme dans le document, avec une ligne vide entre deux questions.\n" +
      "- Corrige seulement les fautes évidentes, garde le sens et les valeurs exacts.\n" +
      "- Si un passage correspond mot pour mot à un texte déjà public (manuel, site...), reformule légèrement sa formulation en gardant strictement les mêmes informations, données et questions.\n" +
      "- Formules et notations en LaTeX entre $...$ (ou $$...$$), jamais de commande de couleur. Tableaux en vrai tableau Markdown (ligne d'en-tête, ligne |---|, puis les lignes).\n" +
      COURSE_POSED_OPERATION_RULE +
      (tokens.length
        ? "Schémas déjà découpés à part (à insérer, chacun seul sur sa ligne, à l'endroit exact où il apparaît, uniquement s'il se trouve sur ces pages) :\n" + tokens.map(function (t) { return t.placeholder + " — " + (t.where || "") + " — " + t.caption; }).join("\n") + "\nNe décris jamais ces schémas en mots à leur place ; ne les mets qu'une fois.\n\n"
        : "Ne décris pas en mots les photos ou dessins : ils sont gérés à part.\n\n") +
      (priorContext ? "Ce contenu est AJOUTÉ à un cours qui contient déjà le texte ci-dessous : ne recopie pas une seconde fois un passage qui y figure déjà (même page reprise ou recoupée). S'il n'y a rien de nouveau, renvoie une retranscription vide.\n\nContenu déjà connu :\n" + String(priorContext).slice(0, 20000) + "\n\n" : "") +
      "Réponds uniquement en respectant le schéma JSON fourni.";
  }
  function pdfPageCount(dataUrl) {
    return loadPdfJs().then(function (lib) {
      return fetch(dataUrl).then(function (r) { return r.arrayBuffer(); }).then(function (buf) { return lib.getDocument({ data: new Uint8Array(buf) }).promise; });
    }).then(function (doc) { var n = doc.numPages; doc.destroy(); return n; });
  }
  // Renvoie { ok, text } ; ok=false si un morceau a échoué (on retombe alors sur l'ancienne méthode).
  async function transcribeDocumentPages(images, pre, priorContext, title, subjectName, report) {
    report = report || function () {};
    var jobs = []; // { parts, label, fileIndex }
    var batch = [];
    var flush = function () {
      if (!batch.length) return;
      var files = batch.slice();
      var parts = [];
      files.forEach(function (f, k) { parts.push({ text: "Page " + (k + 1) + " :" }); parts = parts.concat(geminiImageParts([f.src])); });
      jobs.push({ parts: parts, label: files.length > 1 ? "ces " + files.length + " pages (dans l'ordre)" : "cette page", fileIdx: files.map(function (f) { return f.i; }) });
      batch = [];
    };
    for (var i = 0; i < images.length; i++) {
      var src = images[i];
      if (isPdfDataUrl(src)) {
        flush();
        var n = 0;
        try { n = await pdfPageCount(src); } catch (e) { n = 0; }
        // Nombre de pages inconnu (PDF illisible par pdf.js) : tout le PDF en une fois.
        if (!n) jobs.push({ parts: geminiImageParts([src]), label: "ce PDF (toutes ses pages, dans l'ordre)", fileIdx: [i] });
        for (var p = 1; p <= n; p += 3) {
          var last = Math.min(n, p + 2);
          jobs.push({ parts: geminiImageParts([src]), label: (p === last ? "la page " + p : "les pages " + p + " à " + last) + " de ce PDF (et UNIQUEMENT ces pages-là)", fileIdx: [i] });
        }
      } else {
        batch.push({ src: src, i: i });
        if (batch.length >= 2) flush();
      }
    }
    flush();
    if (!jobs.length) return { ok: false, text: "" };
    var results = new Array(jobs.length), failed = false, done = 0;
    var tokensFor = function (fileIdx) { return ((pre && pre.list) || []).filter(function (t) { return fileIdx.indexOf(t.imageIndex) !== -1; }); };
    report(0, Math.min(1, 2 / jobs.length), "pageTranscript");
    await runWithConcurrency(jobs.map(function (job, k) {
      return function () {
        var t0 = Date.now();
        var prompt = buildPageTranscriptionPrompt(title, subjectName, job.label, tokensFor(job.fileIdx), priorContext);
        return callGemini(job.parts.concat([{ text: prompt }]), PAGE_TRANSCRIPTION_SCHEMA, 32768, 150000).then(function (data) {
          results[k] = String(data && data.transcription || "").trim();
        }).catch(function (err) {
          console.error("Retranscription d'une page :", err);
          failed = true;
        }).then(function () {
          done++;
          genLearn("pageTranscript", Date.now() - t0);
          report(done / jobs.length, Math.min(2, jobs.length - done) / jobs.length, "pageTranscript");
        });
      };
    }), 2);
    if (failed) return { ok: false, text: "" };
    return { ok: true, text: results.filter(Boolean).join("\n\n") };
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
      COURSE_LANGUAGE_RULE +
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
      COURSE_POSED_OPERATION_RULE +
      "Voici le contenu source :\n\n" + sourceBlocks + "\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni, en français — sauf ce que la RÈGLE DE LANGUE du début impose de garder ou d'écrire dans une autre langue.";
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
  /* ---------------- Pourcentage des générations ----------------
     Google ne dit pas où en est l'IA pendant qu'elle réfléchit : un pourcentage exact n'existe que là
     où l'appli compte elle-même des étapes (tranches analysées, schémas découpés, morceaux de voix
     enregistrés...). Ailleurs, on estime d'après la durée HABITUELLE de cette étape, apprise sur les
     générations précédentes de l'élève (moyenne glissante gardée dans ce navigateur). Une étape plus
     longue que prévu ralentit vers 99 % sans jamais l'atteindre ; 100 % = vraiment terminé.
     Une génération = une suite de phases pondérées { label, weight, type, scale } (scale = taille du travail,
     ex. nombre de pages : la durée apprise est ramenée à une unité, puis multipliée) ; genSub() donne
     l'avancement RÉEL à l'intérieur de la phase en cours quand il est connu. */
  var GEN_DURATIONS_KEY = "studino-gen-durations";
  var GEN_DEFAULT_MS = { pageTranscript: 35000, figTile: 20000, figZoom: 12000, figures: 60000, course: 90000, exerciseImport: 60000, podcastScript: 120000, ttsChunk: 45000, sheet: 70000, sheetSchema: 25000, methodo: 50000, examPlan: 40000, finish: 15000, step: 30000 };
  var genDurations = {};
  try { genDurations = JSON.parse(localStorage.getItem(GEN_DURATIONS_KEY) || "{}") || {}; } catch (e) {}
  function genExpected(type) { return genDurations[type] || GEN_DEFAULT_MS[type] || 60000; }
  function genLearn(type, ms) {
    if (!type || !(ms > 500)) return;
    genDurations[type] = genDurations[type] ? Math.round(genDurations[type] * 0.6 + ms * 0.4) : Math.round(ms);
    try { localStorage.setItem(GEN_DURATIONS_KEY, JSON.stringify(genDurations)); } catch (e) {}
  }
  var genProgress = {}; // id de l'élément généré → état
  function genStart(id, phases) {
    var list = phases.filter(function (p) { return p.weight > 0; });
    genProgress[id] = { phases: list, idx: 0, phaseStart: Date.now(), sub: null, total: list.reduce(function (s, p) { return s + p.weight; }, 0) || 1 };
  }
  function genPhase(id, label) {
    var g = genProgress[id];
    if (!g) return;
    var cur = g.phases[g.idx];
    if (cur && cur.learn !== false) genLearn(cur.type, (Date.now() - g.phaseStart) / (cur.scale || 1));
    var next = g.phases.findIndex(function (p) { return p.label === label; });
    g.idx = next === -1 ? Math.min(g.idx + 1, g.phases.length - 1) : next;
    g.phaseStart = Date.now();
    g.sub = null;
  }
  // Avancement réel dans la phase : base (0-1) déjà fait, plus une part `span` en cours, estimée au temps
  // écoulé selon la durée habituelle du type `type`.
  function genSub(id, base, span, type) {
    var g = genProgress[id];
    if (!g) return;
    g.sub = { base: Math.max(0, Math.min(1, base)), span: span || 0, type: type, start: Date.now() };
  }
  function genEnd(id, ok) {
    var g = genProgress[id];
    if (g && ok) { var cur = g.phases[g.idx]; if (cur && cur.learn !== false) genLearn(cur.type, (Date.now() - g.phaseStart) / (cur.scale || 1)); }
    delete genProgress[id];
  }
  function genTimeFraction(elapsed, expected) {
    var r = elapsed / Math.max(1000, expected);
    return r <= 0.9 ? r : 0.9 + 0.09 * (1 - Math.exp(-(r - 0.9) * 2));
  }
  function genState(id) {
    var g = genProgress[id];
    if (!g || !g.phases.length) return null;
    var cur = g.phases[g.idx];
    var done = 0;
    for (var i = 0; i < g.idx; i++) done += g.phases[i].weight;
    var f;
    if (g.sub) f = g.sub.base + g.sub.span * genTimeFraction(Date.now() - g.sub.start, genExpected(g.sub.type));
    else f = genTimeFraction(Date.now() - g.phaseStart, genExpected(cur.type) * (cur.scale || 1));
    var pct = Math.floor(((done + cur.weight * Math.min(0.99, f)) / g.total) * 100);
    return { pct: Math.max(1, Math.min(99, pct)), label: cur.label };
  }
  // Barre de progression pour un écran d'attente (mise à jour en direct, sans redessiner la page).
  function genProgressHtml(id, fallbackLabel, light) {
    var st = genState(id);
    if (!st) return '<span>' + esc(fallbackLabel) + '</span>';
    return '<div class="gen-progress' + (light ? " gen-progress-light" : "") + '" data-gen-id="' + id + '">' +
      '<div class="gen-progress-bar"><span style="width:' + st.pct + '%"></span></div>' +
      '<div class="gen-progress-label"><b class="gen-pct mono">' + st.pct + ' %</b> · <span class="gen-label">' + esc(st.label) + '</span></div></div>';
  }
  // Petit pourcentage dans une pastille de liste (« Génération… 42 % »).
  function genPillPct(id) {
    var st = genState(id);
    return st ? ' <span class="gen-pill-pct" data-gen-pill="' + id + '">' + st.pct + ' %</span>' : "";
  }
  setInterval(function () {
    document.querySelectorAll("[data-gen-id]").forEach(function (el) {
      var st = genState(el.getAttribute("data-gen-id"));
      if (!st) return;
      var bar = el.querySelector(".gen-progress-bar span"); if (bar) bar.style.width = st.pct + "%";
      var pct = el.querySelector(".gen-pct"); if (pct) pct.textContent = st.pct + " %";
      var lab = el.querySelector(".gen-label"); if (lab) lab.textContent = st.label;
    });
    document.querySelectorAll("[data-gen-pill]").forEach(function (el) {
      var st = genState(el.getAttribute("data-gen-pill"));
      if (st) el.textContent = st.pct + " %";
    });
  }, 500);

  function runRevisionSheetGeneration(sheet, courses, subjectName, chapterName) {
    sheet.status = "processing";
    sheet.error = null;
    genStart(sheet.id, [
      { label: "Rédaction de la fiche", weight: 75, type: "sheet", scale: Math.max(1, (courses || []).length * 0.5) },
      { label: "Dessin des schémas", weight: 25, type: "sheetSchema", learn: false }
    ]);
    saveDB(); render();
    generateRevisionSheetContent(courses, sheet.title, subjectName, chapterName, sheet.scope).then(function (data) {
      var content = data.content || "";
      genPhase(sheet.id, "Dessin des schémas");
      var pending = (data.schemas || []).filter(function (sc) { return sc.placeholder && sc.description; });
      var schemas = [];
      function next(i) {
        if (i >= pending.length) {
          genEnd(sheet.id, true);
          sheet.content = content;
          sheet.schemas = schemas;
          sheet.status = "ready";
          saveDB();
          toast("Fiche générée · " + sheet.title);
          render();
          return;
        }
        var sc = pending[i];
        genSub(sheet.id, i / pending.length, 1 / pending.length, "sheetSchema");
        var schemaT0 = Date.now();
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
        }).then(function () { genLearn("sheetSchema", Date.now() - schemaT0); next(i + 1); });
      }
      next(0);
    }).catch(function (err) {
      genEnd(sheet.id, false);
      sheet.status = "error";
      sheet.error = err.message || "Erreur inconnue";
      sheet.errorStatus = err.status || null;
      sheet.errorDetail = err.detail || null;
      saveDB();
      toast("Échec de la génération : " + sheet.error, { status: sheet.errorStatus, detail: sheet.errorDetail });
      render();
    });
  }

