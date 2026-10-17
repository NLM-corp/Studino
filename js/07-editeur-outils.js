"use strict";
// Studino — éditeur, LaTeX, dessin, graphique, PDF, flashcards, quiz
// Fichier chargé dans l'ordre par index.html : les fichiers partagent les mêmes variables globales.

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
        // Dessin inséré avec l'outil Dessin : seule une image en data URL est gardée, sans aucun autre attribut.
        if (child.nodeType === 1 && child.tagName === "IMG") {
          var imgSrc = child.getAttribute("src") || "";
          if (/^data:image\/(png|jpeg|webp);base64,/i.test(imgSrc)) {
            var cleanImg = doc.createElement("img");
            cleanImg.setAttribute("class", "rte-drawing");
            cleanImg.setAttribute("src", imgSrc);
            cleanImg.setAttribute("alt", "Dessin");
            // Taille choisie par l'élève (barre − / + sur le dessin) : seul un pourcentage est gardé.
            var imgW = child.style && child.style.width;
            if (/^\d{1,3}%$/.test(imgW || "")) cleanImg.setAttribute("style", "width:" + imgW);
            // De quoi rééditer le dessin/graphique (scène Excalidraw ou fichier GeoGebra), gardé tel quel.
            var editSrc = child.getAttribute("data-src") || "";
            if (/^(ex|gg):/.test(editSrc) && editSrc.length < 4000000) cleanImg.setAttribute("data-src", editSrc);
            if (child.getAttribute("alt") === "Graphique") cleanImg.setAttribute("alt", "Graphique");
            node.replaceChild(cleanImg, child);
          } else {
            node.removeChild(child);
          }
          return;
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
      '<button type="button" class="rte-btn" onmousedown="event.preventDefault()" onclick="App.openDrawing(\'' + id + '\')" title="Faire un schéma ou un dessin et l\'ajouter à ta réponse">✏️ Dessin</button>' +
      '<button type="button" class="rte-btn" onmousedown="event.preventDefault()" onclick="App.openGraph(\'' + id + '\')" title="Tracer un graphique (fonctions, points, droites) avec GeoGebra et l\'ajouter à ta réponse">📈 Graphique</button>' +
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
      if (child.tagName === "IMG") {
        // Dessin : un repère dans le texte ; l'image elle-même est jointe à part à la correction.
        var dsrc = child.getAttribute("src") || "";
        if (dsrc.indexOf("data:image/") === 0) {
          var did = "d" + hashText(dsrc);
          drawingRegistry[did] = dsrc;
          out += "\n[DESSIN:" + did + "]\n";
        }
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
  /* ---------------- Dessin (Excalidraw) dans les réponses ----------------
     Bouton « ✏️ Dessin » de l'éditeur : ouvre Excalidraw dans une fenêtre, et le dessin est inséré dans
     la réponse comme image. À la correction, l'IA reçoit les dessins en images jointes (voir
     drawingsForAnswer) et les corrige comme le reste de la réponse. Excalidraw (React) n'est chargé
     qu'au premier clic. */
  var EXCALIDRAW_VERSION = "0.17.6";
  var excalidrawPromise = null;
  function loadScriptOnce(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("Impossible de charger " + src)); };
      document.head.appendChild(s);
    });
  }
  function loadExcalidraw() {
    if (window.ExcalidrawLib && window.React && window.ReactDOM) return Promise.resolve(window.ExcalidrawLib);
    if (!excalidrawPromise) {
      window.EXCALIDRAW_ASSET_PATH = "https://unpkg.com/@excalidraw/excalidraw@" + EXCALIDRAW_VERSION + "/dist/";
      excalidrawPromise = (window.React ? Promise.resolve() : loadScriptOnce("https://unpkg.com/react@18.2.0/umd/react.production.min.js"))
        .then(function () { return window.ReactDOM ? null : loadScriptOnce("https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js"); })
        .then(function () { return loadScriptOnce("https://unpkg.com/@excalidraw/excalidraw@" + EXCALIDRAW_VERSION + "/dist/excalidraw.production.min.js"); })
        .then(function () { if (!window.ExcalidrawLib) throw new Error("Excalidraw indisponible"); return window.ExcalidrawLib; })
        .catch(function (err) { excalidrawPromise = null; throw err; });
    }
    return excalidrawPromise;
  }
  // Images des dessins, par id, pour la correction (le texte de la réponse ne contient qu'un repère [DESSIN:id]).
  var drawingRegistry = {};
  function drawingsForAnswer(text) {
    var images = [];
    var out = String(text || "").replace(/\[DESSIN:([A-Za-z0-9]+)\]/g, function (m, id) {
      var url = drawingRegistry[id];
      if (!url) return "[Dessin de l'élève (image non disponible)]";
      images.push(url);
      return "[Dessin n° " + images.length + " de l'élève : voir l'image jointe n° " + images.length + "]";
    });
    return { text: out, images: images };
  }
  // Images jointes à envoyer à l'IA, chacune précédée de son numéro.
  function drawingParts(images) {
    var parts = [];
    (images || []).forEach(function (url, k) {
      parts.push({ text: "Image jointe n° " + (k + 1) + " (dessin fait par l'élève dans sa réponse) :" });
      parts = parts.concat(geminiImageParts([url]));
    });
    return parts;
  }
  var DRAWING_GRADE_RULE = "- DESSINS ET GRAPHIQUES : si la réponse de l'élève contient des dessins ou des graphiques tracés avec GeoGebra (images jointes), ils font partie de sa réponse. Corrige-les avec la même exigence : vérifie chaque élément attendu (présence, exactitude, légendes, flèches, proportions ou position quand ça compte ; pour un graphique : bonne fonction, allure, points remarquables, axes et échelle adaptés) et liste précisément dans les erreurs ce qui manque ou est faux dans le schéma. Un schéma juste mais mal soigné n'est pas une erreur ; un élément faux ou absent en est une.\n";
  var drawingSession = null; // { editorId, savedRange, root, api, overlay }
  function closeDrawing() {
    var d = drawingSession;
    drawingSession = null;
    if (!d) return;
    try { if (d.root) d.root.unmount(); } catch (e) {}
    if (d.overlay) d.overlay.remove();
  }
  // edit (optionnel) : { img, scene } pour rééditer un dessin déjà inséré (double-clic dessus).
  function openDrawing(editorId, edit) {
    var el = document.getElementById(editorId);
    var savedRange = null;
    if (el) {
      var sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)) savedRange = sel.getRangeAt(0).cloneRange();
    }
    closeDrawing();
    var overlay = document.createElement("div");
    overlay.className = "draw-overlay";
    overlay.innerHTML = '<div class="draw-box"><div class="draw-head"><b>✏️ Dessin</b><span class="draw-hint">Dessine ton schéma, puis insère-le dans ta réponse.</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" style="width:auto" data-draw="cancel">Annuler</button>' +
      '<button type="button" class="btn btn-primary btn-sm" style="width:auto" data-draw="insert">Insérer dans ma réponse</button></div>' +
      '<div class="draw-canvas"><div class="processing-box" style="height:100%">' + genLogo() + '<span>Chargement de l\'outil de dessin…</span></div></div></div>';
    document.body.appendChild(overlay);
    drawingSession = { editorId: editorId, savedRange: savedRange, overlay: overlay, editImg: edit ? edit.img : null };
    if (edit) overlay.querySelector('[data-draw="insert"]').textContent = "Mettre à jour le dessin";
    var session = drawingSession;
    overlay.querySelector('[data-draw="cancel"]').onclick = closeDrawing;
    overlay.querySelector('[data-draw="insert"]').onclick = function () { insertDrawing(session); };
    loadExcalidraw().then(function (lib) {
      if (drawingSession !== session) return;
      var host = overlay.querySelector(".draw-canvas");
      host.innerHTML = "";
      session.root = window.ReactDOM.createRoot(host);
      var dark = (document.documentElement.getAttribute("data-app-theme") || "light") === "dark";
      session.root.render(window.React.createElement(lib.Excalidraw, {
        excalidrawAPI: function (api) { session.api = api; },
        langCode: "fr-FR",
        theme: dark ? "dark" : "light",
        initialData: edit && edit.scene
          ? { elements: edit.scene.elements || [], files: edit.scene.files || {}, appState: { viewBackgroundColor: "#ffffff", currentItemFontFamily: 1 }, scrollToContent: true }
          : { appState: { viewBackgroundColor: "#ffffff", currentItemFontFamily: 1 } },
        UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false } }
      }));
    }).catch(function () {
      if (drawingSession !== session) return;
      overlay.querySelector(".draw-canvas").innerHTML = '<div class="processing-box" style="height:100%"><span>⚠️ L\'outil de dessin n\'a pas pu se charger (connexion ?). Réessaie dans un instant.</span></div>';
    });
  }
  // Insère une image (dessin ou graphique) dans une zone de réponse, à l'endroit du curseur mémorisé.
  // Elle devient une image « rte-drawing » : redimensionnable (barre − / +) et jointe à la correction.
  // srcData : de quoi rééditer l'image plus tard (« ex: » + scène Excalidraw, « gg: » + fichier GeoGebra).
  function insertImageInEditor(editorId, savedRange, dataUrl, alt, srcData) {
    var editor = document.getElementById(editorId);
    if (!editor) return;
    editor.focus();
    var range = savedRange && editor.contains(savedRange.startContainer) ? savedRange : null;
    if (!range) { range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); }
    var wrap = document.createElement("div");
    var img = document.createElement("img");
    img.className = "rte-drawing";
    img.src = dataUrl;
    img.alt = alt || "Dessin";
    img.style.width = "60%";
    if (srcData) img.setAttribute("data-src", srcData);
    wrap.appendChild(img);
    var after = document.createElement("div");
    after.innerHTML = "<br>";
    range.deleteContents();
    range.insertNode(after);
    range.insertNode(wrap);
    var sel = window.getSelection();
    if (sel) { var r = document.createRange(); r.setStart(after, 0); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); }
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }
  /* ---------------- Graphique (GeoGebra) dans les réponses ----------------
     Bouton « 📈 Graphique » : ouvre GeoGebra (calculatrice graphique) ; on trace des fonctions, des
     points, des droites... puis le graphique est inséré dans la réponse comme image (même rendu, même
     redimensionnement et même correction par l'IA que les dessins). GeoGebra n'est chargé qu'au besoin. */
  var geogebraPromise = null;
  function loadGeoGebra() {
    if (window.GGBApplet) return Promise.resolve();
    if (!geogebraPromise) geogebraPromise = loadScriptOnce("https://www.geogebra.org/apps/deployggb.js").catch(function (err) { geogebraPromise = null; throw err; });
    return geogebraPromise;
  }
  var graphSession = null;
  function closeGraph() {
    var g = graphSession;
    graphSession = null;
    if (g && g.overlay) g.overlay.remove();
  }
  // edit (optionnel) : { img, ggb } pour rééditer un graphique déjà inséré (double-clic dessus).
  function openGraph(editorId, edit) {
    var el = document.getElementById(editorId);
    var savedRange = null;
    if (el) {
      var sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)) savedRange = sel.getRangeAt(0).cloneRange();
    }
    closeGraph();
    var hostId = "ggb-host-" + Date.now();
    var overlay = document.createElement("div");
    overlay.className = "draw-overlay";
    overlay.innerHTML = '<div class="draw-box"><div class="draw-head"><b>📈 Graphique</b><span class="draw-hint">Tape une fonction à gauche (ex. f(x) = x^2 - 3x + 1) ou utilise les outils, puis insère le graphique.</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" style="width:auto" data-graph="cancel">Annuler</button>' +
      '<button type="button" class="btn btn-primary btn-sm" style="width:auto" data-graph="insert">Insérer dans ma réponse</button></div>' +
      '<div class="draw-canvas"><div id="' + hostId + '" class="ggb-host"><div class="processing-box" style="height:100%">' + genLogo() + '<span>Chargement de GeoGebra…</span></div></div></div></div>';
    document.body.appendChild(overlay);
    graphSession = { editorId: editorId, savedRange: savedRange, overlay: overlay, api: null, editImg: edit ? edit.img : null };
    if (edit) overlay.querySelector('[data-graph="insert"]').textContent = "Mettre à jour le graphique";
    var session = graphSession;
    overlay.querySelector('[data-graph="cancel"]').onclick = closeGraph;
    overlay.querySelector('[data-graph="insert"]').onclick = function () {
      var api = session.api;
      if (!api) { toast("GeoGebra n'est pas encore prêt"); return; }
      var b64 = "";
      try { b64 = api.getPNGBase64(1.5, false, 72); } catch (e) { b64 = ""; }
      if (!b64) { toast("Le graphique n'a pas pu être exporté"); return; }
      // Fichier GeoGebra gardé avec l'image pour pouvoir le rééditer (double-clic).
      var ggb = "";
      try { ggb = api.getBase64() || ""; } catch (e) { ggb = ""; }
      var srcData = ggb ? "gg:" + ggb : "";
      closeGraph();
      if (session.editImg && document.body.contains(session.editImg)) replaceEditorImage(session.editImg, "data:image/png;base64," + b64, srcData);
      else insertImageInEditor(session.editorId, session.savedRange, "data:image/png;base64," + b64, "Graphique", srcData);
    };
    loadGeoGebra().then(function () {
      if (graphSession !== session) return;
      var host = document.getElementById(hostId);
      if (!host) return;
      var box = host.parentNode.getBoundingClientRect();
      host.innerHTML = "";
      var applet = new window.GGBApplet({
        appName: "graphing", width: Math.max(320, Math.floor(box.width)), height: Math.max(320, Math.floor(box.height)),
        showToolBar: true, showAlgebraInput: true, showMenuBar: false, enableShiftDragZoom: true, enableRightClick: true,
        showResetIcon: false, language: "fr", borderColor: "#FFFFFF",
        ggbBase64: edit && edit.ggb ? edit.ggb : undefined,
        appletOnLoad: function (api) { session.api = api || window.ggbApplet; }
      }, true);
      applet.inject(hostId);
    }).catch(function () {
      if (graphSession !== session) return;
      var host = document.getElementById(hostId);
      if (host) host.innerHTML = '<div class="processing-box" style="height:100%"><span>⚠️ GeoGebra n\'a pas pu se charger (connexion ?). Réessaie dans un instant.</span></div>';
    });
  }
  // Remplace l'image d'un dessin/graphique réédité (même taille, même place).
  function replaceEditorImage(img, dataUrl, srcData) {
    img.src = dataUrl;
    if (srcData) img.setAttribute("data-src", srcData);
    var ed = img.closest(".rte-editor");
    if (ed) ed.dispatchEvent(new Event("input", { bubbles: true }));
    hideDrawingSizeBar();
  }
  // Double-clic sur un dessin ou un graphique d'une zone de réponse : on le rouvre pour le modifier.
  document.addEventListener("dblclick", function (e) {
    var img = e.target;
    if (!img || img.tagName !== "IMG" || !img.classList.contains("rte-drawing")) return;
    var editor = img.closest(".rte-editor");
    if (!editor || !editor.id) return;
    e.preventDefault();
    var src = img.getAttribute("data-src") || "";
    if (src.indexOf("ex:") === 0) {
      var scene = null;
      try { scene = JSON.parse(src.slice(3)); } catch (er) { scene = null; }
      if (scene) { openDrawing(editor.id, { img: img, scene: scene }); return; }
    } else if (src.indexOf("gg:") === 0) {
      openGraph(editor.id, { img: img, ggb: src.slice(3) });
      return;
    }
    toast("Ce dessin a été fait avant la mise à jour : il ne peut pas être modifié. Supprime-le et refais-le.");
  });
  function insertDrawing(session) {
    var api = session.api, lib = window.ExcalidrawLib;
    if (!api || !lib) { toast("L'outil de dessin n'est pas encore prêt"); return; }
    var elements = api.getSceneElements().filter(function (e) { return !e.isDeleted; });
    if (!elements.length) { toast("Dessine quelque chose avant de l'insérer"); return; }
    lib.exportToBlob({
      elements: elements,
      appState: Object.assign({}, api.getAppState(), { exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false }),
      files: api.getFiles(),
      mimeType: "image/png",
      exportPadding: 16,
      // Pas plus de 1200 px de large : assez net pour la correction, sans alourdir les données.
      getDimensions: function (w, h) { var scale = Math.min(2, 1200 / Math.max(1, w)); return { width: Math.round(w * scale), height: Math.round(h * scale), scale: scale }; }
    }).then(blobToDataUrl).then(function (dataUrl) {
      // Scène gardée avec l'image pour pouvoir la rééditer (double-clic).
      var scene = "ex:" + JSON.stringify({ elements: elements, files: api.getFiles() });
      closeDrawing();
      if (session.editImg && document.body.contains(session.editImg)) replaceEditorImage(session.editImg, dataUrl, scene);
      else insertImageInEditor(session.editorId, session.savedRange, dataUrl, "Dessin", scene);
    }).catch(function (err) {
      console.error(err);
      toast("Le dessin n'a pas pu être inséré");
    });
  }
  // Redimensionner un dessin déjà inséré : un clic dessus (dans une zone de réponse) affiche une petite
  // barre − / taille / + / 🗑, de 20 % à 100 % de la largeur de la réponse.
  var drawingSizeBar = null;
  function hideDrawingSizeBar() { if (drawingSizeBar) { drawingSizeBar.remove(); drawingSizeBar = null; } }
  function showDrawingSizeBar(img) {
    hideDrawingSizeBar();
    var bar = document.createElement("div");
    bar.className = "draw-size-bar";
    var cur = function () { return parseInt(img.style.width, 10) || 60; };
    var notify = function () { var ed = img.closest(".rte-editor"); if (ed) ed.dispatchEvent(new Event("input", { bubbles: true })); };
    var place = function () {
      var r = img.getBoundingClientRect();
      bar.style.top = Math.max(8, r.top - 44) + "px";
      bar.style.left = Math.max(8, r.left) + "px";
      bar.querySelector(".draw-size-val").textContent = cur() + " %";
    };
    var setW = function (w) { img.style.width = Math.max(20, Math.min(100, w)) + "%"; notify(); place(); };
    bar.innerHTML = '<button type="button" data-a="minus" title="Plus petit">−</button><span class="draw-size-val mono"></span><button type="button" data-a="plus" title="Plus grand">+</button><button type="button" data-a="del" title="Supprimer le dessin">🗑</button>';
    bar.addEventListener("mousedown", function (e) { e.preventDefault(); });
    bar.addEventListener("click", function (e) {
      var a = e.target.getAttribute && e.target.getAttribute("data-a");
      if (a === "minus") setW(cur() - 10);
      else if (a === "plus") setW(cur() + 10);
      else if (a === "del") { var p = img.parentNode; img.remove(); if (p && p.tagName === "DIV" && !p.textContent.trim() && !p.querySelector("img")) p.remove(); notify(); hideDrawingSizeBar(); }
    });
    document.body.appendChild(bar);
    drawingSizeBar = bar;
    place();
  }
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (drawingSizeBar && drawingSizeBar.contains(t)) return;
    if (t && t.tagName === "IMG" && t.classList.contains("rte-drawing") && t.closest(".rte-editor")) { showDrawingSizeBar(t); return; }
    hideDrawingSizeBar();
  });
  window.addEventListener("scroll", hideDrawingSizeBar, true);
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
  // Le nom de fichier suggéré par "Imprimer > Enregistrer en PDF" du navigateur vient du <title> de la
  // page, pas du contenu affiché — sans ça, tout export (fiche, cours, exercice...) se sauvegardait sous
  // le même nom générique "Studino" quel que soit son contenu réel. On change temporairement le titre de
  // la page le temps de l'impression, puis on le restaure une fois la boîte de dialogue fermée.
  function printAndDownload(html, filename) {
    var area = document.getElementById("print-area");
    if (!area) { area = document.createElement("div"); area.id = "print-area"; document.body.appendChild(area); }
    area.innerHTML = html;
    renderMath();
    var originalTitle = document.title;
    if (filename) document.title = String(filename).replace(/[\\/:*?"<>|]/g, "_");
    var restore = function () { document.title = originalTitle; window.removeEventListener("afterprint", restore); };
    window.addEventListener("afterprint", restore);
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

