"use strict";
// Studino — podcast et méthodologies (génération)
// Fichier chargé dans l'ordre par index.html : les fichiers partagent les mêmes variables globales.

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
            script: { type: "string", description: "Texte intégral à lire à voix haute par le narrateur, dans la langue fixée par la consigne de LANGUE (français courant par défaut), SANS aucune balise, markdown, puce ou didascalie entre parenthèses — uniquement les phrases parlées telles qu'elles doivent être prononcées, prêtes à être envoyées telles quelles à une synthèse vocale." }
          },
          required: ["title", "script"]
        }
      }
    },
    required: ["notionCount", "estimatedTotalWords", "parts"]
  };
  // Cours de langue (ou rédigé dans une langue étrangère) : la langue du cours dit ce que l'élève doit
  // savoir. Tout en anglais = le connaître EN anglais ; mélangé avec du français = le COMPRENDRE.
  var PODCAST_LANG_MODES = [["auto", "Auto (recommandé)"], ["fr", "Français"], ["target", "Entièrement dans la langue du cours"], ["bilingual", "Bilingue (explications en français)"]];
  var PODCAST_LANG_HINTS = {
    auto: "Le conteur choisit selon ton cours : cours entièrement en anglais, espagnol, japonais… → il te l'explique dans cette langue ; cours mélangé avec du français → bilingue ; cours en français → en français.",
    fr: "Tout en français.",
    target: "Le même podcast que d'habitude, mais entièrement dans la langue du cours.",
    bilingual: "Le conteur explique en français, en disant les mots et expressions clés dans la langue du cours."
  };
  // Pas d'analyse ligne par ligne : le conteur explique le cours EXACTEMENT comme d'habitude, juste dans
  // la bonne langue.
  function podcastLanguageRule(mode) {
    var target = "écris TOUT le script dans la langue du cours : c'est exactement le même podcast que d'habitude (même conteur, même façon de raconter et d'expliquer le cours, mêmes règles), simplement dans cette langue au lieu du français. N'analyse pas le cours phrase par phrase et ne le traduis pas : explique-le, comme tu le ferais en français. Phrases claires et vocabulaire proche de celui du cours, pour un élève qui apprend cette langue.";
    var bilingual = "explique le cours exactement comme d'habitude, en français, mais dis dans la langue étrangère les mots, expressions et notions clés que le cours donne dans cette langue (avec leur sens), pour que l'élève les reconnaisse. N'analyse pas le cours phrase par phrase.";
    var script = " Écris toute langue étrangère dans son orthographe et son écriture normales (japonais, chinois, arabe, russe, coréen... jamais en romanisation), sinon la voix la prononce mal.";
    if (mode === "fr") return "LANGUE : le podcast est entièrement en français.";
    if (mode === "target") return "LANGUE : " + target + script;
    if (mode === "bilingual") return "LANGUE : " + bilingual + script;
    return "LANGUE — choisis-la toi-même AVANT d'écrire, en regardant dans quelle langue est rédigé le cours : (a) cours entièrement (ou presque) dans une langue étrangère (anglais, espagnol, allemand, japonais...) → " + target + " (b) cours qui mélange le français et une langue étrangère → " + bilingual + " (c) cours en français, même avec quelques mots étrangers isolés → podcast en français, normalement." + script;
  }
  // Outil Dessin : l'IA peut demander un schéma à faire, et doit alors décrire ce qu'il doit contenir.
  var DRAWING_QUESTION_RULE = "L'élève dispose dans sa zone de réponse d'un outil « Dessin » et d'un outil « Graphique » (GeoGebra : tracer des fonctions, points, droites, courbes). Pour un graphique à tracer, tu peux donc demander « Trace la courbe de... » et décrire dans la solution l'allure et les points attendus. Quand c'est vraiment utile pour la matière (schéma d'une expérience ou d'un montage, cycle, organe ou cellule légendés, croquis de géographie, figure géométrique, courbe ou graphique à tracer, frise...), tu peux poser une question du type « Fais le schéma légendé de... » ou « Représente... ». Dans la solution, décris alors précisément ce que le schéma doit contenir (éléments, légendes, flèches, allure) pour pouvoir le corriger. N'en abuse pas : seulement quand un dessin est la meilleure façon de répondre.\n\n";
  // Opérations posées : affichées telles quelles dans un bloc ``` (police à chasse fixe, espaces gardés).
  var COURSE_POSED_OPERATION_RULE = "Pour une opération POSÉE (addition, soustraction ou multiplication en colonnes, division posée, conversion par divisions successives...), écris-la dans un bloc de code délimité par une ligne ``` avant et une ligne ``` après, en alignant les chiffres à droite, colonne par colonne, avec des espaces (jamais de tabulation), la ligne du trait faite de tirets « - ». Exemple :\n```\n  A9\n+  1\n----\n  AA\n```\nN'utilise ce bloc QUE pour ces opérations posées (pas pour du texte ni pour des formules, qui restent en LaTeX).\n\n";
  // Même règle pour la génération du cours (retranscription, explication, flashcards, contrôle) et des fiches.
  var COURSE_LANGUAGE_RULE = "RÈGLE DE LANGUE (prioritaire sur toute consigne « en français » de ce message) — regarde d'abord dans quelle langue est rédigé le contenu source : " +
    "(a) contenu ENTIÈREMENT (ou presque) dans une langue étrangère (anglais, espagnol, allemand, japonais...) : l'élève doit le maîtriser DANS cette langue. Ne traduis rien : la retranscription reste dans la langue d'origine ; l'explication est rédigée dans cette langue (claire, vocabulaire proche de celui du cours), avec seulement la traduction française entre parenthèses des mots ou expressions difficiles ; flashcards, questions et exercices sont posés ET corrigés dans cette langue. " +
    "(b) contenu MÉLANGÉ (consignes, explications ou traductions en français + textes, vocabulaire, dialogues ou exemples dans une langue étrangère) : l'élève doit COMPRENDRE la langue étrangère. Retranscription fidèle, chaque passage dans sa langue d'origine ; explication en français qui cite les passages, mots et expressions dans la langue étrangère avec leur sens ; flashcards et questions qui font passer d'une langue à l'autre dans les deux sens (sens d'une expression, comment dire une idée, compréhension d'un passage), sans jamais traduire le texte étudié lui-même. " +
    "(c) contenu en français : tout en français, comme d'habitude. " +
    "Dans les cas (a) et (b), un texte en langue étrangère à étudier (texte littéraire, article, discours, dialogue, poème, chanson...) est retranscrit MOT POUR MOT, sans le reformuler ni le corriger, même s'il existe déjà sur internet — la règle de reformulation des textes publics ne s'applique PAS à lui. Écris chaque langue dans son orthographe et son écriture normales. Les noms des champs JSON ne changent jamais.\n\n";
  function buildPodcastScriptPrompt(subjectName, scopeName, scopeLevel, content, retryReason, langMode) {
    var gender = getUserGender();
    var genderNote = gender === "m"
      ? "L'élève qui t'écoute est un garçon : si tu t'adresses directement à lui (une interpellation affectueuse, pas à chaque phrase), utilise des formulations masculines (\"mon petit\", \"mon grand\", \"jeune homme\"), jamais féminines."
      : gender === "f"
      ? "L'élève qui t'écoute est une fille : si tu t'adresses directement à elle (une interpellation affectueuse, pas à chaque phrase), utilise des formulations féminines (\"ma petite\", \"ma grande\", \"jeune demoiselle\"), jamais masculines."
      : "Tu ne connais pas le genre de l'élève qui t'écoute : si tu t'adresses directement à lui/elle, utilise des formulations neutres (\"mon enfant\", \"jeune ami\", \"toi qui m'écoutes\") plutôt qu'un terme genré.";
    return "Tu es un vieux conteur chevronné : un ancien professeur devenu archéologue sur le tard, aussi chaleureux et bienveillant qu'un grand-père mais PAS un grand-père de famille — un vieux savant plein d'anecdotes de terrain qui adore raconter des histoires pour transmettre son savoir à un jeune élève qui l'écoute en podcast. Voici le cours (matière : " + subjectName + ", " + podcastScopeLabel(scopeLevel) + " : " + scopeName + ") à partir duquel tu dois créer ce podcast.\n\n" +
      "Règles absolues :\n" +
      "- " + genderNote + "\n" +
      "- " + podcastLanguageRule(langMode) + "\n" +
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
      "- Respecte une orthographe irréprochable dans chaque langue utilisée, avec tous les accents nécessaires (en français : é, è, ê, à, ç, etc.) — la synthèse vocale prononce mal un mot mal orthographié ou mal accentué. Les nombres et unités s'écrivent en toutes lettres dans la langue où ils sont prononcés.\n\n" +
      (retryReason === "short" ? "[Note système — IMPORTANT : ta tentative précédente a produit au moins une partie BEAUCOUP trop courte (loin en dessous de 1600 mots, parfois à peine 1 minute à l'oral) — c'est un échec strict de la consigne de durée. Cette fois, développe réellement CHAQUE notion en profondeur (surtout les formules/méthodes si la matière en a) jusqu'à dépasser 1600 mots sur CHAQUE partie, quitte à prendre plus de temps par explication. Ne recommence pas la même erreur.]\n\n" : "") +
      (retryReason === "partcount" ? "[Note système — IMPORTANT : ta tentative précédente a toi-même estimé qu'il fallait plus de mots au total que ce que tu as réellement écrit dans \"parts\" — autrement dit tu as sous-estimé le nombre de parties nécessaires par rapport à ton propre calcul. Cette fois, suis VRAIMENT la procédure : compte notionCount, calcule estimatedTotalWords, puis fixe le nombre de parties sur ce calcul (estimatedTotalWords / 3000, arrondi au-dessus) sans te brider par habitude. Ne recommence pas la même erreur.]\n\n" : "") +
      "Voici le cours :\n\n" + content + "\n\n" +
      "Réponds uniquement en respectant le schéma JSON fourni, dans la ou les langues fixées par la règle de LANGUE ci-dessus (français par défaut).";
  }
  function podcastScriptWordCount(script) {
    // Japonais/chinois sans espaces : ~2 caractères par « mot », sinon une partie normale serait vue
    // comme beaucoup trop courte et regénérée pour rien.
    var s = String(script || "");
    var cjk = (s.match(/[぀-ヿ㐀-鿿]/g) || []).length;
    var words = s.replace(/[぀-ヿ㐀-鿿]/g, " ").trim().split(/\s+/).filter(Boolean).length;
    return words + Math.round(cjk / 2);
  }
  // Filet de sécurité côté code, pas seulement une consigne de prompt : si au moins une partie générée
  // est manifestement trop courte (bien en dessous du plancher de 1600 mots demandé), OU si l'IA a
  // elle-même estimé qu'il fallait plus de mots que ce qu'elle a réellement écrit (donc qu'elle s'est
  // bridée sur le nombre de parties malgré son propre calcul), on retente une fois avec une note d'échec
  // explicite plutôt que d'accepter silencieusement un podcast trop court.
  function generatePodcastScript(subjectName, scopeName, scopeLevel, content, langMode, attempt, retryReason) {
    attempt = attempt || 1;
    var parts = [{ text: buildPodcastScriptPrompt(subjectName, scopeName, scopeLevel, content, retryReason, langMode) }];
    // Un cours très riche peut légitimement nécessiter de nombreuses parties de plusieurs milliers de
    // mots chacune : une limite de sortie par défaut trop basse tronquerait la réponse en silence avant
    // que l'IA ait fini, donnant l'impression d'un plafond artificiel sur le nombre de parties.
    return callGemini(parts, PODCAST_SCRIPT_SCHEMA, 65536, 180000).then(function (data) {
      var scriptParts = (data.parts || []).filter(function (p) { return p && p.script; });
      var tooShort = scriptParts.some(function (p) { return podcastScriptWordCount(p.script) < 900; });
      var actualWords = scriptParts.reduce(function (sum, p) { return sum + podcastScriptWordCount(p.script); }, 0);
      var estimated = data.estimatedTotalWords || 0;
      // Marge large (60%) : on ne veut retenter que sur un écart franc, jamais sur un simple flou
      // d'estimation — le but est d'attraper le cas "l'IA a sous-livré par rapport à son propre calcul".
      var underDelivered = estimated > 3500 && actualWords < estimated * 0.6;
      if ((tooShort || underDelivered) && attempt < 2) {
        return generatePodcastScript(subjectName, scopeName, scopeLevel, content, langMode, attempt + 1, tooShort ? "short" : "partcount");
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
  // Reconstruit un data URL WAV à partir d'échantillons PCM déjà en mémoire (Int16Array) — utilisé pour
  // recoller plusieurs morceaux de synthèse vocale générés séparément (voir generatePodcastAudio).
  function pcm16ToWavDataUrl(samples, sampleRate) {
    var bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.length * 2);
    return pcmBase64ToWavDataUrl(bytesToBase64(bytes), sampleRate);
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
    var hadRateLimit = false;
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
      if (res.status === 429) hadRateLimit = true;
      lastErr = new Error(msg);
      lastErr.status = res.status;
      lastErr.detail = "Modèle : " + GEMINI_TTS_MODELS[i] + "\n\n" + JSON.stringify(errBody, null, 2);
      if (!retryable) throw lastErr;
    }
    var finalErr = lastErr || new Error("Erreur inconnue lors de la génération audio.");
    finalErr.rateLimited = hadRateLimit;
    throw finalErr;
  }
  // Le quota gratuit de la voix est beaucoup plus restrictif que celui du texte (quelques requêtes par
  // JOUR, pas par minute) : un message générique "réessaie dans 1-2 minutes" serait trompeur ici, le
  // vrai délai se compte souvent en heures.
  function ttsRateLimitFallbackError(detail, triedBackup) {
    var err = new Error(triedBackup
      ? "Le quota gratuit de la voix (très limité, quelques requêtes par jour) est épuisé sur tes deux clés API. Il faut attendre le renouvellement du quota (parfois plusieurs heures)."
      : "Le quota gratuit de la voix (très limité, quelques requêtes par jour) est épuisé. Il faut attendre le renouvellement du quota (parfois plusieurs heures), ou ajouter une clé API de secours dans les paramètres pour repartir sur un quota indépendant.");
    err.status = 429;
    err.detail = detail;
    return err;
  }
  async function generatePodcastAudioChunk(script, voiceName) {
    var primaryKey = getApiKey();
    if (!primaryKey) { var e = new Error("Ajoute ta clé API Gemini dans les paramètres avant de continuer."); e.code = "NO_API_KEY"; throw e; }
    try {
      return await attemptTtsWithKey(primaryKey, script, voiceName);
    } catch (err1) {
      var backupKey = getBackupApiKey();
      if (!err1.rateLimited || !backupKey) throw (err1.rateLimited ? ttsRateLimitFallbackError(err1.detail, false) : err1);
      try {
        return await attemptTtsWithKey(backupKey, script, voiceName);
      } catch (err2) {
        throw (err2.rateLimited ? ttsRateLimitFallbackError(err2.detail, true) : err2);
      }
    }
  }
  // Scinde le script sur la ponctuation forte (.!?) en morceaux d'au plus maxChars caractères, sans
  // jamais couper au milieu d'une phrase — les morceaux sont envoyés à la synthèse vocale un par un,
  // puis recollés (voir generatePodcastAudio).
  function splitScriptIntoTtsChunks(script, maxChars) {
    var raw = String(script || "").replace(/\s+/g, " ").trim();
    // 。！？ : ponctuation japonaise/chinoise, jamais suivie d'une espace.
    var sentences = raw.match(/[^.!?。！？]+(?:[。！？]+\s*|[.!?]+(?:\s+|$))/g) || (raw ? [raw] : []);
    var chunks = [], cur = "";
    sentences.forEach(function (s) {
      s = s.trim();
      if (!s) return;
      if (cur && (cur.length + 1 + s.length) > maxChars) { chunks.push(cur); cur = s; }
      else cur = cur ? cur + " " + s : s;
    });
    if (cur) chunks.push(cur);
    return chunks.length ? chunks : [raw];
  }
  // La synthèse vocale Gemini tronque silencieusement l'audio au-delà d'une certaine longueur par appel
  // (constaté : des parties de script bien plus longues ressortaient systématiquement avec ~3 minutes
  // d'audio, sans la moindre erreur) — contrairement à la génération de texte, il n'y a aucun signal
  // d'échec à détecter ici, donc aucun garde-fou possible après coup. La seule solution fiable est de
  // ne JAMAIS envoyer un texte assez long pour risquer d'atteindre cette limite : on découpe le script
  // en morceaux surs, on génère l'audio de chacun séparément, puis on recolle le PCM avant un seul
  // encodage WAV final — invisible pour l'élève, qui reçoit un unique fichier audio continu.
  // Taille des morceaux : le plus GRAND possible tout en restant sous le seuil de troncature observé
  // (~2900 caractères ≈ 3 min) — le quota gratuit de la voix est très limité (10 requêtes/jour pour le
  // modèle lite), donc chaque morceau en moins compte vraiment, pas la peine d'être plus prudent que
  // nécessaire.
  // onProgress(k, n) : k morceaux de voix enregistrés sur n (avancement réel, voir podcastVoiceProgress).
  async function generatePodcastAudio(script, voiceName, onProgress) {
    var chunks = splitScriptIntoTtsChunks(script, 2600);
    var wavs = [];
    for (var i = 0; i < chunks.length; i++) {
      if (onProgress) onProgress(i, chunks.length);
      var url = await generatePodcastAudioChunk(chunks[i], voiceName);
      wavs.push(await parseWavPcm16(url));
    }
    if (onProgress) onProgress(chunks.length, chunks.length);
    if (wavs.length === 1) return pcm16ToWavDataUrl(wavs[0].samples, wavs[0].sampleRate);
    var sampleRate = wavs[0].sampleRate;
    var totalLen = wavs.reduce(function (sum, w) { return sum + w.samples.length; }, 0);
    var merged = new Int16Array(totalLen);
    var offset = 0;
    wavs.forEach(function (w) { merged.set(w.samples, offset); offset += w.samples.length; });
    return pcm16ToWavDataUrl(merged, sampleRate);
  }
  // Découpe sur la ponctuation forte (.!?) ET sur les virgules/points-virgules/deux-points : des
  // segments plus courts et plus nombreux limitent l'accumulation de dérive sur un long podcast (une
  // erreur d'estimation sur une seule grosse phrase pesait lourd ; répartie sur plusieurs petits
  // segments, chaque erreur reste petite et le sous-titre "rattrape" son retard plus souvent).
  function splitScriptIntoSentences(script) {
    var raw = String(script || "").replace(/\s+/g, " ").trim();
    var sentences = raw.match(/[^.!?,;:。！？、]+(?:[。！？、]+\s*|[.!?,;:]*(?:\s+|$))/g) || (raw ? [raw] : []);
    return sentences.map(function (s) { return s.trim(); }).filter(Boolean);
  }
  // Une pause après une virgule/un point-virgule est naturellement plus courte qu'une pause en fin de
  // phrase complète — distinguer les deux rapproche un peu plus l'estimation du rythme réel du narrateur.
  function podcastPauseAfter(s) {
    var last = s.charAt(s.length - 1);
    return (last === "," || last === ";" || last === ":" || last === "、") ? 0.14 : 0.3;
  }
  // Pas d'horodatage mot-à-mot fourni par l'API TTS : on approxime le minutage de chaque segment sur la
  // durée réelle de l'audio généré, au NOMBRE DE MOTS plutôt qu'au nombre de caractères (une phrase
  // pleine de mots courts prend un temps très différent d'une phrase avec un seul mot très long, alors
  // que les deux peuvent avoir la même longueur en caractères) + une pause estimée entre chaque segment.
  function buildPodcastSegments(script, durationSec) {
    var sentences = splitScriptIntoSentences(script);
    if (!sentences.length || !durationSec) return [];
    var wordCounts = sentences.map(function (s) { return podcastScriptWordCount(s) || 1; });
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
  // Tout est asynchrone et découpé : un podcast de 20 min, c'est des dizaines de millions d'échantillons.
  // Traité d'un seul bloc, la page restait complètement figée plusieurs secondes (impossible de savoir
  // si ça travaillait ou si ça avait planté). fetch() décode le data URL nativement, sans bloquer.
  function parseWavPcm16(dataUrl) {
    return fetch(dataUrl).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
      var bytes = new Uint8Array(buf);
      var view = new DataView(buf);
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
      var sampleCount = Math.floor(Math.min(dataLength, bytes.length - dataOffset) / 2);
      // Copie native (rapide) des octets PCM dans un Int16Array : le WAV est en little-endian, comme
      // tous les appareils qui font tourner un navigateur aujourd'hui.
      var samples = new Int16Array(buf.slice(dataOffset, dataOffset + sampleCount * 2));
      return { sampleRate: sampleRate, numChannels: numChannels || 1, samples: samples };
    });
  }
  function yieldToUi() { return new Promise(function (r) { setTimeout(r, 0); }); }
  async function pcm16ToMp3Blob(samples, sampleRate, numChannels, onProgress) {
    var encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, 128);
    var chunkSize = 1152;
    var perTick = chunkSize * 200; // rend la main au navigateur régulièrement (animation, clics)
    var chunks = [];
    for (var i = 0; i < samples.length; i += chunkSize) {
      var buf = encoder.encodeBuffer(samples.subarray(i, i + chunkSize));
      if (buf.length > 0) chunks.push(buf);
      if (i > 0 && i % perTick === 0) {
        if (onProgress) onProgress(i / samples.length);
        await yieldToUi();
      }
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
  async function mergePodcastPartsToMp3Blob(parts, onProgress) {
    var wavs = [];
    for (var i = 0; i < parts.length; i++) wavs.push(await parseWavPcm16(parts[i].audioUrl));
    var sampleRate = wavs[0].sampleRate, numChannels = wavs[0].numChannels;
    var totalLen = wavs.reduce(function (sum, w) { return sum + w.samples.length; }, 0);
    var merged = new Int16Array(totalLen);
    var offset = 0;
    wavs.forEach(function (w) { merged.set(w.samples, offset); offset += w.samples.length; });
    return pcm16ToMp3Blob(merged, sampleRate, numChannels, onProgress);
  }
  // État des téléchargements MP3 en cours, mis à jour directement dans le DOM (jamais via render() :
  // sur la page du lecteur, un rendu complet recréerait l'élément <audio> et couperait la lecture).
  // Chaque bouton porte data-mp3-key ("p:<id>" pour une partie, "g:<groupe>" pour tout le podcast).
  var podcastMp3Jobs = {};
  function mp3ButtonInner(key, label) {
    var pct = podcastMp3Jobs[key];
    return pct == null ? label : '<span class="mp3-spinner"></span> Conversion… ' + pct + ' %';
  }
  function mp3ButtonAttrs(key, label) {
    return 'data-mp3-key="' + key + '" data-mp3-label="' + esc(label) + '"' + (podcastMp3Jobs[key] != null ? " disabled" : "");
  }
  function updateMp3Buttons(key) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-mp3-key="' + key + '"]'), function (el) {
      var busy = podcastMp3Jobs[key] != null;
      el.innerHTML = mp3ButtonInner(key, el.getAttribute("data-mp3-label"));
      el.disabled = busy;
    });
  }
  async function runMp3Job(key, buildBlob, filename) {
    if (podcastMp3Jobs[key] != null) return;
    if (typeof lamejs === "undefined") { toast("Le convertisseur MP3 n'a pas pu se charger (vérifie ta connexion puis recharge la page)."); return; }
    podcastMp3Jobs[key] = 0;
    updateMp3Buttons(key);
    await yieldToUi(); // laisse le navigateur afficher la roue avant de commencer à calculer
    try {
      var blob = await buildBlob(function (fraction) {
        podcastMp3Jobs[key] = Math.min(99, Math.round(fraction * 100));
        updateMp3Buttons(key);
      });
      triggerBlobDownload(blob, filename);
      toast("⬇️ MP3 téléchargé");
    } catch (e) {
      toast("Échec de la conversion MP3 : " + (e.message || "erreur inconnue"));
    } finally {
      delete podcastMp3Jobs[key];
      updateMp3Buttons(key);
    }
  }
  // C'est l'IA qui décide du nombre de parties (voir buildPodcastScriptPrompt), pas l'élève — on ne
  // sait donc PAS combien il y en aura avant d'avoir la réponse. "podcast" est la SEULE entrée déjà
  // créée/affichée (part 1 par défaut) ; si l'IA renvoie plusieurs parties, les suivantes sont créées
  // ici dynamiquement et ajoutées à la bibliothèque. L'audio de chaque partie se génère ensuite l'une
  // après l'autre (pas en parallèle, pour rester raisonnable côté quota) — chaque partie passe "ready"
  // dès que SON audio est prêt, sans attendre les autres.
  // Empreinte des cours couverts par un podcast, prise au moment où son script est généré : permet de
  // savoir plus tard quels cours ont été ajoutés ou modifiés depuis, pour signaler que le podcast n'est
  // plus à jour et proposer de le refaire (voir App.refreshPodcast).
  function podcastGroupKey(p) { return p.groupId || p.id; }
  function podcastGroupParts(gid) {
    return podcastData().filter(function (p) { return podcastGroupKey(p) === gid; })
      .sort(function (a, b) { return (a.partIndex || 1) - (b.partIndex || 1); });
  }
  // Nom affiché d'un podcast entier : le nom choisi par l'élève (groupName, via Renommer) s'il existe,
  // sinon le nom du chapitre/thème/cours couvert.
  function podcastGroupDisplayName(parts) {
    return parts[0].groupName || parts[0].scopeName || parts[0].title;
  }
  function hashText(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  var courseHashCache = {}; // recalculé seulement si le texte du cours a changé (évite de tout re-hacher à chaque rendu)
  function courseContentHash(co) {
    var text = stripFigureMarkdown(co.transcription || "");
    var c = courseHashCache[co.id];
    if (c && c.text === text) return c.hash;
    var h = hashText(text);
    courseHashCache[co.id] = { text: text, hash: h };
    return h;
  }
  function podcastScopeCourses(pod) {
    var subj = findSubject(pod.subjectId);
    if (!subj) return [];
    var out = [];
    if (pod.scopeLevel === "theme") {
      var th = findTheme(subj, pod.scopeId);
      (th ? th.chapters : []).forEach(function (c) {
        (c.courses || []).filter(dpCourseHasContent).forEach(function (co) { out.push({ course: co, chapterName: c.name }); });
      });
    } else if (pod.scopeLevel === "course") {
      var loc = locateCourse(pod.scopeId);
      if (loc && dpCourseHasContent(loc.course)) out.push({ course: loc.course, chapterName: loc.chapter.name });
    } else {
      var ch = findChapterAnywhere(subj, pod.scopeId);
      (ch ? ch.courses : []).filter(dpCourseHasContent).forEach(function (co) { out.push({ course: co, chapterName: ch.name }); });
    }
    return out;
  }
  // Un podcast peut porter sur tout un thème, un chapitre ou un seul cours.
  function podcastScopeLabel(level) { return level === "theme" ? "thème" : level === "course" ? "cours" : "chapitre"; }
  function podcastScopeContentText(subj, level, scopeId) {
    if (level === "theme") return themeContentText(subj, scopeId);
    if (level === "course") {
      var loc = locateCourse(scopeId);
      return loc && dpCourseHasContent(loc.course) ? "### " + loc.course.title + "\n" + stripFigureMarkdown(loc.course.transcription || "") : "";
    }
    return chapterContentText(subj, scopeId);
  }
  function podcastScopeSnapshot(pod) {
    return podcastScopeCourses(pod).map(function (x) { return { id: x.course.id, title: x.course.title, hash: courseContentHash(x.course) }; });
  }
  // known=false : podcast créé avant ce système (pas d'empreinte), on ne peut pas savoir ce qui a changé.
  function podcastGroupChanges(parts) {
    var current = podcastScopeCourses(parts[0]);
    var snapPart = parts.find(function (p) { return p.sourceSnapshot; });
    if (!snapPart) return { known: false, added: [], modified: [], courses: current };
    var old = {};
    snapPart.sourceSnapshot.forEach(function (s) { old[s.id] = s; });
    var added = [], modified = [];
    current.forEach(function (x) {
      var o = old[x.course.id];
      if (!o) added.push(x);
      else if (o.hash !== courseContentHash(x.course)) modified.push(x);
    });
    return { known: true, added: added, modified: modified, courses: current };
  }
  function podcastGroupHasNewContent(parts) {
    var ch = podcastGroupChanges(parts);
    return ch.known && (ch.added.length > 0 || ch.modified.length > 0);
  }
  // Actualisation silencieuse (voir App.refreshPodcast) : les parties du nouveau podcast portent
  // pendingReplace = groupe de l'ancien podcast et restent CACHÉES tant qu'elles n'ont pas TOUTES leur
  // voix. L'élève continue d'écouter l'ancien pendant ce temps ; s'il manque une voix (quota épuisé...),
  // l'ancien reste en place. Si l'ancien a été supprimé entre-temps, le nouveau redevient visible.
  function podcastPendingFor(oldGid) {
    return podcastData().filter(function (p) { return p.pendingReplace === oldGid; })
      .sort(function (a, b) { return (a.partIndex || 1) - (b.partIndex || 1); });
  }
  function isHiddenPendingPodcast(p) {
    if (!p.pendingReplace) return false;
    return podcastData().some(function (q) { return !q.pendingReplace && podcastGroupKey(q) === p.pendingReplace; });
  }
  function finalizePodcastReplacement(oldGid) {
    var pending = podcastPendingFor(oldGid);
    if (!pending.length || pending.some(function (p) { return p.status !== "ready"; })) return;
    var hashParts = location.hash.replace(/^#\//, "").split("/");
    var viewed = hashParts[0] === "podcasts" && hashParts[1] ? podcastFind(hashParts[1]) : null;
    var viewingOld = !!(viewed && !viewed.pendingReplace && podcastGroupKey(viewed) === oldGid);
    var d = userData();
    d.podcasts = d.podcasts.filter(function (p) { return p.pendingReplace || podcastGroupKey(p) !== oldGid; });
    pending.forEach(function (p) { delete p.pendingReplace; });
    setTimeout(gcPodcastAudio, 0);
    saveDB();
    toast("🎙️ Podcast actualisé : « " + podcastGroupDisplayName(pending) + " »");
    if (viewingOld) navigate("#/podcasts/" + pending[0].id);
    else render();
  }
  function podcastVoiceProgress(podId) {
    var t = Date.now();
    return function (k, n) {
      if (k > 0) { genLearn("ttsChunk", Date.now() - t); t = Date.now(); }
      genSub(podId, k / n, k < n ? 1 / n : 0, "ttsChunk");
    };
  }
  function runPodcastGeneration(podcast, subjectName, scopeName, content) {
    podcast.status = "processing";
    podcast.processingStartedAt = Date.now();
    podcast.error = null; podcast.errorStatus = null; podcast.errorDetail = null;
    genStart(podcast.id, [
      { label: "Le conteur écrit son texte", weight: 30, type: "podcastScript", scale: Math.max(1, String(content || "").length / 20000) },
      { label: "Enregistrement de la voix", weight: 70, type: "ttsChunk", learn: false }
    ]);
    saveDB(); render();
    var scopeLevel = podcast.scopeLevel || "chapter";
    var gid = podcastGroupKey(podcast);
    var snapshot = podcastScopeSnapshot(podcast);
    generatePodcastScript(subjectName, scopeName, scopeLevel, content, podcast.langMode || "auto").then(function (data) {
      var scriptParts = (data.parts || []).filter(function (p) { return p && p.script; });
      if (!scriptParts.length) {
        genEnd(podcast.id, false);
        podcast.status = "error";
        podcast.error = "Aucun script généré.";
        saveDB(); render();
        return;
      }
      var total = scriptParts.length;
      var pods = [podcast];
      for (var k = 1; k < total; k++) {
        var extra = {
          id: uid(), groupId: gid, title: "",
          subjectId: podcast.subjectId, subjectName: podcast.subjectName,
          scopeLevel: podcast.scopeLevel, scopeId: podcast.scopeId, scopeName: podcast.scopeName,
          langMode: podcast.langMode,
          partIndex: k + 1, partCount: total,
          status: "processing", error: null, errorStatus: null, errorDetail: null,
          script: "", segments: [], audioUrl: "", durationSec: 0, createdAt: Date.now() + k, processingStartedAt: Date.now()
        };
        if (podcast.pendingReplace) extra.pendingReplace = podcast.pendingReplace;
        if (podcast.groupName) extra.groupName = podcast.groupName;
        podcastData().push(extra);
        pods.push(extra);
      }
      podcast.groupId = gid;
      podcast.partIndex = 1;
      // Titres et scripts posés tout de suite sur toutes les parties : si la voix d'une partie échoue
      // (ou si l'onglet est fermé en route), son texte est déjà sauvegardé et seule la voix sera à refaire.
      pods.forEach(function (pod, i) {
        // Podcast renommé par l'élève puis actualisé en une seule partie : on garde son nom à lui.
        pod.title = total === 1 && podcast.groupName ? podcast.groupName : (scriptParts[i].title || scopeName);
        pod.script = scriptParts[i].script;
        pod.partCount = total;
        pod.sourceSnapshot = snapshot;
      });
      saveDB(); render();
      var runOne = function (i) {
        if (i >= pods.length) return;
        var pod = pods[i];
        if (podcastData().indexOf(pod) === -1) return; // supprimé ou actualisation annulée en route : inutile de consommer du quota voix

        if (i === 0) genPhase(pod.id, "Enregistrement de la voix");
        else genStart(pod.id, [{ label: "Enregistrement de la voix", weight: 100, type: "ttsChunk", learn: false }]);
        generatePodcastAudio(pod.script, PODCAST_VOICE, podcastVoiceProgress(pod.id)).then(function (audioUrl) {
          return audioDurationFromDataUrl(audioUrl).then(function (duration) {
            return storePodcastAudio(pod, audioUrl).then(function () { return duration; });
          }).then(function (duration) {
            pod.durationSec = duration;
            pod.segments = buildPodcastSegments(pod.script, duration);
            genEnd(pod.id, true);
            pod.status = "ready";
            saveDB();
            if (pod.pendingReplace) { finalizePodcastReplacement(pod.pendingReplace); return; }
            toast("🎙️ " + pod.title + " est prêt");
            render();
          });
        }).catch(function (err) {
          genEnd(pod.id, false);
          pod.status = "error";
          pod.error = err.message || "Erreur inconnue";
          pod.errorStatus = err.status || null;
          pod.errorDetail = err.detail || null;
          saveDB(); render();
        }).then(function () { runOne(i + 1); });
      };
      runOne(0);
    }).catch(function (err) {
      genEnd(podcast.id, false);
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
    genStart(pod.id, [{ label: "Enregistrement de la voix", weight: 100, type: "ttsChunk", learn: false }]);
    pod.processingStartedAt = Date.now();
    pod.error = null; pod.errorStatus = null; pod.errorDetail = null;
    saveDB(); render();
    return generatePodcastAudio(pod.script, PODCAST_VOICE, podcastVoiceProgress(pod.id)).then(function (audioUrl) {
      return audioDurationFromDataUrl(audioUrl).then(function (duration) {
        return storePodcastAudio(pod, audioUrl).then(function () { return duration; });
      }).then(function (duration) {
        pod.durationSec = duration;
        pod.segments = buildPodcastSegments(pod.script, duration);
        genEnd(pod.id, true);
        pod.status = "ready";
        saveDB();
        if (pod.pendingReplace) { finalizePodcastReplacement(pod.pendingReplace); return; }
        toast("🎙️ " + pod.title + " est prêt");
        render();
      });
    }).catch(function (err) {
      genEnd(pod.id, false);
      pod.status = "error";
      pod.error = err.message || "Erreur inconnue";
      pod.errorStatus = err.status || null;
      pod.errorDetail = err.detail || null;
      saveDB();
      toast("Échec de la génération audio : " + (err.message || "erreur inconnue"), { status: err.status, detail: err.detail });
      render();
    });
  }
  // Bandeau d'état d'une actualisation silencieuse, affiché sur l'ANCIEN podcast (le nouveau est caché).
  function podcastRefreshStatusHtml(oldGid) {
    var pending = podcastPendingFor(oldGid);
    if (!pending.length) return "";
    if (pending.some(function (p) { return p.status === "processing"; })) {
      var ready = pending.filter(function (p) { return p.status === "ready"; }).length;
      var withScript = pending.some(function (p) { return p.script; });
      return '<span class="status-pill status-processing"><span class="dotpulse"></span>Actualisation en cours' + (withScript ? " (" + ready + "/" + pending.length + " voix prêtes)" : "") + '…</span>';
    }
    return '<span class="status-pill status-processing" title="' + esc((pending.find(function (p) { return p.error; }) || {}).error || "") + '">⚠️ Actualisation interrompue</span>' +
      '<button class="btn btn-ghost btn-sm" style="width:auto" onclick="event.stopPropagation();App.retryPodcastRefresh(\'' + oldGid + '\')">Réessayer</button>' +
      '<button class="btn btn-ghost btn-sm" style="width:auto" onclick="event.stopPropagation();App.cancelPodcastRefresh(\'' + oldGid + '\')">Annuler</button>';
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
    genStart(methodo.id, [{ label: "Analyse de ta méthodologie", weight: 100, type: "methodo", scale: Math.max(1, (methodo.images || []).length * 0.5) }]);
    saveDB(); render();
    generateMethodologyContent(methodo.images, methodo.title).then(function (data) {
      methodo.genre = data.genre || "Épreuve";
      methodo.mechanics = (data.mechanics || []).filter(function (m) { return METHODOLOGY_MECHANICS.indexOf(m) !== -1; });
      if (!methodo.mechanics.length) methodo.mechanics = ["redaction"];
      methodo.structure = data.structure || "";
      methodo.transcription = data.transcription || "";
      genEnd(methodo.id, true);
      methodo.status = "ready";
      methodo.images = [];
      saveDB();
      toast("Méthodologie prête · " + methodo.title);
      render();
    }).catch(function (err) {
      genEnd(methodo.id, false);
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
      "Réponds uniquement en respectant le schéma JSON fourni, en français — sauf si le document/cours source est rédigé dans une langue étrangère (cours de langue) : énoncés, sujets et solutions restent alors dans cette langue (entièrement s'il est entièrement dans cette langue ; s'il mélange français et langue étrangère, consignes en français et textes/expressions dans la langue étrangère). Ne traduis jamais un texte étudié.";
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
      "Réponds uniquement en respectant le schéma JSON fourni, en français — mais si l'exercice est dans une langue étrangère (cours de langue), évalue la réponse dans cette langue (sens, vocabulaire, grammaire attendus), et cite les corrections dans cette langue.";
  }
  function gradeMethodologyAnswer(methodo, item, studentAnswer) {
    var drawn = drawingsForAnswer(studentAnswer);
    var promptText = buildMethodologyGradePrompt(methodo, item, drawn.text);
    if (drawn.images.length) promptText = DRAWING_GRADE_RULE + "\n" + promptText;
    var parts = drawingParts(drawn.images).concat([{ text: promptText }]);
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

