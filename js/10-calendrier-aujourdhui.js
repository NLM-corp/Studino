"use strict";
// Studino — calendrier, répétition espacée, sauvegarde, Aujourd'hui
// Fichier chargé dans l'ordre par index.html : les fichiers partagent les mêmes variables globales.

  /* ---------------- Calendrier ----------------
     Vues Mois / Semaine / Jour. On y voit les contrôles, les séances de révision des prépas et les
     événements ajoutés par l'élève (cours de guitare, sport...). Les événements de l'élève sont
     PRIORITAIRES : chaque séance de révision reçoit un créneau dans les « heures de révision » (réglables),
     et si un événement « Occupé » tombe dessus, la séance est décalée au premier créneau libre du jour, ou
     à défaut sur un autre jour avant le contrôle. Ce placement est recalculé à chaque affichage : ajouter,
     déplacer ou supprimer un événement replace aussitôt les révisions. */
  var MONTH_NAMES = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  var CAL_DAY_NAMES = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  var CAL_HOUR_START = 6, CAL_HOUR_END = 24, CAL_HOUR_PX = 48;
  var CAL_COLORS = ["#4C8C4A", "#2F7FC1", "#D9A51B", "#D44C80", "#7A4FC4", "#D14B35", "#E8862B", "#5B6770"];
  var CAL_REPEATS = [["none", "Une seule fois"], ["daily", "Tous les jours"], ["weekdays", "Du lundi au vendredi"], ["weekly", "Toutes les semaines"], ["monthly", "Tous les mois"], ["yearly", "Tous les ans"]];
  var calView = null; // { mode: "month"|"week"|"day", date: "AAAA-MM-JJ" (jour de référence / sélectionné) }
  function calDateStr(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function calParse(ds) { return new Date(ds + "T00:00:00"); }
  function calAddDays(ds, n) { var d = calParse(ds); d.setDate(d.getDate() + n); return calDateStr(d); }
  function calToMin(hhmm) { var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ""); return m ? (+m[1]) * 60 + (+m[2]) : 0; }
  function calFromMin(min) { min = Math.max(0, Math.min(24 * 60, Math.round(min))); return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0"); }
  function calEnsureView() {
    if (!calView) {
      var saved = null;
      try { saved = localStorage.getItem("studino-cal-mode"); } catch (e) {}
      calView = { mode: saved === "week" || saved === "day" ? saved : "month", date: calDateStr(new Date()) };
    }
    return calView;
  }
  function calEvents() { var d = userData(); if (!d.calendarEvents) d.calendarEvents = []; return d.calendarEvents; }
  function calSettings() {
    var d = userData();
    if (!d.calendarSettings) d.calendarSettings = { studyStart: "17:00", studyEnd: "21:00" };
    return d.calendarSettings;
  }
  // Occurrences des événements de l'élève sur [fromDs, toDs] (inclus), répétitions comprises.
  function calExpandUserEvents(fromDs, toDs) {
    var out = [];
    calEvents().forEach(function (ev) {
      var startDs = ev.startDate, endDs = ev.endDate || ev.startDate;
      var spanDays = Math.max(0, Math.round((calParse(endDs) - calParse(startDs)) / 86400000));
      var push = function (ds) {
        for (var k = 0; k <= spanDays; k++) {
          var day = calAddDays(ds, k);
          if (day < fromDs || day > toDs) continue;
          out.push({
            kind: "user", ev: ev, date: day, title: ev.title || "(sans titre)", color: ev.color || CAL_COLORS[1],
            allDay: !!ev.allDay, busy: ev.busy !== false,
            startMin: ev.allDay ? 0 : (k === 0 ? calToMin(ev.startTime) : 0),
            endMin: ev.allDay ? 24 * 60 : (k === spanDays ? calToMin(ev.endTime) : 24 * 60),
            time: ev.allDay || k > 0 ? "" : ev.startTime, location: ev.location || ""
          });
        }
      };
      var rep = ev.repeat || "none";
      if (rep === "none") { push(startDs); return; }
      var cur = startDs, guard = 0;
      // On démarre assez tôt pour attraper une occurrence de plusieurs jours qui déborde sur la période.
      var from = calAddDays(fromDs, -spanDays);
      if (rep === "daily" || rep === "weekdays") { if (cur < from) cur = from; }
      while (cur <= toDs && guard++ < 800) {
        var d = calParse(cur);
        var ok = cur >= startDs && (rep !== "weekdays" || (d.getDay() !== 0 && d.getDay() !== 6));
        if (ok && cur >= from) push(cur);
        if (rep === "daily" || rep === "weekdays") cur = calAddDays(cur, 1);
        else if (rep === "weekly") cur = calAddDays(cur, 7);
        else if (rep === "monthly") { var s = calParse(startDs); var n = new Date(d.getFullYear(), d.getMonth() + 1, s.getDate()); cur = calDateStr(n); }
        else if (rep === "yearly") { var s2 = calParse(startDs); cur = calDateStr(new Date(d.getFullYear() + 1, s2.getMonth(), s2.getDate())); }
        else break;
      }
    });
    return out;
  }
  // Créneaux occupés d'un jour (minutes), pour placer les révisions.
  function calBusyIntervals(list) {
    return list.filter(function (o) { return o.busy; }).map(function (o) { return [o.startMin, o.endMin]; }).sort(function (a, b) { return a[0] - b[0]; });
  }
  function calFindSlot(busy, winStart, winEnd, duration) {
    var t = winStart;
    for (var i = 0; i < busy.length; i++) {
      var b = busy[i];
      if (b[1] <= t) continue;
      if (b[0] >= t + duration) break;
      t = Math.max(t, b[1]);
    }
    return t + duration <= winEnd ? t : -1;
  }
  // Place chaque séance de révision (et les contrôles) ; renvoie toutes les occurrences sur [fromDs, toDs].
  function calScheduledRevisions(fromDs, toDs) {
    var st = calSettings();
    var winStart = calToMin(st.studyStart), winEnd = calToMin(st.studyEnd);
    if (winEnd <= winStart) winEnd = winStart + 120;
    var today = calDateStr(new Date());
    var sessions = [];
    var lo = fromDs, hi = toDs;
    (userData().examPreps || []).forEach(function (p) {
      (p.days || []).forEach(function (d) {
        if (!d.date || !p.examDate || d.date >= p.examDate) return;
        sessions.push({ prep: p, day: d, done: !!(p.sessions && p.sessions[d.date] && p.sessions[d.date].status === "done") });
        if (d.date < lo) lo = d.date;
      });
      if (p.examDate > hi) hi = p.examDate;
    });
    // Les occupations de l'élève sur toute la période utile (un décalage peut changer de jour).
    var userAll = calExpandUserEvents(calAddDays(lo, -1), calAddDays(hi, 1));
    var busyByDate = {};
    userAll.forEach(function (o) { if (o.busy) (busyByDate[o.date] = busyByDate[o.date] || []).push(o); });
    var placedByDate = {}; // révisions déjà placées, pour ne pas en mettre deux au même moment
    var busyOf = function (ds) { return calBusyIntervals((busyByDate[ds] || []).concat(placedByDate[ds] || [])); };
    sessions.sort(function (a, b) { return a.day.date < b.day.date ? -1 : a.day.date > b.day.date ? 1 : 0; });
    var out = [];
    sessions.forEach(function (s) {
      var dur = Math.max(15, Math.min(winEnd - winStart, s.day.minutes || 30));
      var date = s.day.date, start = -1, moved = false;
      // Séance passée ou faite : affichée à sa place d'origine, on ne la déplace plus.
      if (s.done || date < today) {
        start = calFindSlot(busyOf(date), winStart, winEnd, dur);
        if (start < 0) start = winStart;
      } else {
        start = calFindSlot(busyOf(date), winStart, winEnd, dur);
        if (start < 0) {
          // Pas de place ce jour-là : jour le plus proche avant le contrôle (d'abord la veille, puis le lendemain...).
          for (var k = 1; k <= 10 && start < 0; k++) {
            var cands = [calAddDays(s.day.date, -k), calAddDays(s.day.date, k)];
            for (var c = 0; c < cands.length && start < 0; c++) {
              var cd = cands[c];
              if (cd < today || cd >= s.prep.examDate) continue;
              var t = calFindSlot(busyOf(cd), winStart, winEnd, dur);
              if (t >= 0) { start = t; date = cd; moved = true; }
            }
          }
          if (start < 0) { start = winStart; moved = false; }
        } else if (start !== winStart) {
          moved = true;
        }
      }
      var occ = { kind: "session", date: date, startMin: start, endMin: start + dur, time: calFromMin(start), title: "Révision : " + s.prep.title, detail: s.day.focus || "", hash: "#/examprep/" + s.prep.id, done: s.done, moved: moved && date !== s.day.date ? "Déplacée du " + calParse(s.day.date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) + " (pas de créneau libre)" : (moved ? "Décalée à cause d'un autre événement" : ""), busy: true };
      (placedByDate[date] = placedByDate[date] || []).push(occ);
      if (date >= fromDs && date <= toDs) out.push(occ);
    });
    (userData().examPreps || []).forEach(function (p) {
      if (p.examDate && p.examDate >= fromDs && p.examDate <= toDs) out.push({ kind: "exam", date: p.examDate, allDay: true, startMin: 0, endMin: 0, title: "Contrôle : " + p.title, hash: "#/examprep/" + p.id });
    });
    return out;
  }
  function calRangeFor(v) {
    var ref = calParse(v.date);
    if (v.mode === "day") return { from: v.date, to: v.date };
    if (v.mode === "week") { var mon = calAddDays(v.date, -((ref.getDay() + 6) % 7)); return { from: mon, to: calAddDays(mon, 6) }; }
    var first = new Date(ref.getFullYear(), ref.getMonth(), 1);
    var start = calAddDays(calDateStr(first), -((first.getDay() + 6) % 7));
    var last = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
    return { from: start, to: calAddDays(calDateStr(last), 6 - ((last.getDay() + 6) % 7)) };
  }
  function calAllOccurrences(from, to) {
    return calExpandUserEvents(from, to).concat(calScheduledRevisions(from, to));
  }
  function calChip(o, short) {
    var style = o.kind === "user" ? ' style="--cal-color:' + esc(o.color) + '"' : "";
    var icon = o.kind === "exam" ? "🎯 " : o.kind === "session" ? (o.done ? "✅ " : o.moved ? "↪️ " : "📖 ") : "";
    return '<span class="cal-chip cal-chip-' + (o.kind === "user" ? "google" : o.kind) + '"' + style + ' title="' + esc((o.time ? o.time + " " : "") + o.title) + '">' + icon + (o.time && !short ? "<b>" + o.time + "</b> " : (o.time && short ? o.time + " " : "")) + esc(o.title) + "</span>";
  }
  function calOccClick(o) {
    if (o.kind === "user") return ' onclick="event.stopPropagation();App.calEditEvent(\'' + o.ev.id + '\')"';
    if (o.hash) return ' onclick="event.stopPropagation();location.hash=\'' + o.hash + '\'"';
    return "";
  }
  function calSortOcc(list) {
    var order = { exam: 0, session: 1, user: 1 };
    return list.sort(function (a, b) { return (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) || (order[a.kind] - order[b.kind]) || a.startMin - b.startMin; });
  }
  function calMonthHtml(v, byDate, range) {
    var ref = calParse(v.date), today = calDateStr(new Date()), cells = "";
    for (var ds = range.from; ds <= range.to; ds = calAddDays(ds, 1)) {
      var d = calParse(ds), list = calSortOcc(byDate[ds] || []);
      var cls = "cal-cell" + (d.getMonth() !== ref.getMonth() ? " cal-out" : "") + (ds === today ? " cal-today" : "") + (ds === v.date ? " cal-selected" : "") + (list.some(function (e) { return e.kind === "exam"; }) ? " cal-has-exam" : "");
      cells += '<div role="button" tabindex="0" class="' + cls + '" onclick="App.calSelect(\'' + ds + '\')" ondblclick="App.calNewEvent(\'' + ds + '\')"><span class="cal-daynum">' + d.getDate() + '</span>' +
        list.slice(0, 3).map(function (o) { return '<span class="cal-chip-wrap"' + calOccClick(o) + '>' + calChip(o, true) + '</span>'; }).join("") +
        (list.length > 3 ? '<span class="cal-more">+' + (list.length - 3) + '</span>' : "") + '</div>';
    }
    return '<div class="cal-grid">' + CAL_DAY_NAMES.map(function (n) { return '<div class="cal-head">' + n + '</div>'; }).join("") + cells + '</div>';
  }
  // Vue Semaine / Jour : une colonne par jour, grille horaire, événements placés selon leur heure.
  function calTimeGridHtml(days, byDate) {
    var today = calDateStr(new Date());
    var hours = "";
    for (var h = CAL_HOUR_START; h < CAL_HOUR_END; h++) hours += '<div class="cal-hour" style="height:' + CAL_HOUR_PX + 'px"><span>' + String(h).padStart(2, "0") + ':00</span></div>';
    var heads = days.map(function (ds) {
      var d = calParse(ds);
      return '<button type="button" class="cal-tg-head' + (ds === today ? " cal-today" : "") + '" onclick="App.calSetMode(\'day\', \'' + ds + '\')"><span>' + CAL_DAY_NAMES[(d.getDay() + 6) % 7] + '</span><b class="cal-daynum">' + d.getDate() + '</b></button>';
    }).join("");
    var allDayRow = days.map(function (ds) {
      return '<div class="cal-tg-allday">' + calSortOcc((byDate[ds] || []).filter(function (o) { return o.allDay; })).map(function (o) { return '<span class="cal-chip-wrap"' + calOccClick(o) + '>' + calChip(o, true) + '</span>'; }).join("") + '</div>';
    }).join("");
    var cols = days.map(function (ds) {
      var timed = (byDate[ds] || []).filter(function (o) { return !o.allDay; }).sort(function (a, b) { return a.startMin - b.startMin; });
      // Événements qui se chevauchent : côte à côte (colonnes attribuées dans l'ordre).
      var lanesEnd = [];
      timed.forEach(function (o) {
        var lane = lanesEnd.findIndex(function (end) { return end <= o.startMin; });
        if (lane === -1) { lane = lanesEnd.length; lanesEnd.push(0); }
        lanesEnd[lane] = o.endMin; o._lane = lane;
      });
      var lanes = Math.max(1, lanesEnd.length);
      var items = timed.map(function (o) {
        var top = (Math.max(o.startMin, CAL_HOUR_START * 60) - CAL_HOUR_START * 60) / 60 * CAL_HOUR_PX;
        var height = Math.max(20, (Math.min(o.endMin, CAL_HOUR_END * 60) - Math.max(o.startMin, CAL_HOUR_START * 60)) / 60 * CAL_HOUR_PX - 2);
        var kindCls = o.kind === "user" ? "cal-ev-user" : "cal-ev-" + o.kind;
        return '<div class="cal-ev ' + kindCls + '" style="top:' + top + 'px;height:' + height + 'px;left:calc(' + (o._lane * 100 / lanes) + '% + 2px);width:calc(' + (100 / lanes) + '% - 4px);' + (o.kind === "user" ? "--cal-color:" + esc(o.color) : "") + '"' + calOccClick(o) + ' title="' + esc(o.title) + '">' +
          '<b>' + (o.kind === "session" ? (o.done ? "✅ " : o.moved ? "↪️ " : "📖 ") : "") + esc(o.title) + '</b><span>' + calFromMin(o.startMin) + " – " + calFromMin(o.endMin) + (o.location ? " · " + esc(o.location) : "") + '</span></div>';
      }).join("");
      var nowLine = "";
      if (ds === today) {
        var n = new Date(), nm = n.getHours() * 60 + n.getMinutes();
        if (nm >= CAL_HOUR_START * 60) nowLine = '<div class="cal-now" style="top:' + ((nm - CAL_HOUR_START * 60) / 60 * CAL_HOUR_PX) + 'px"></div>';
      }
      return '<div class="cal-tg-col" onclick="App.calSlotClick(event, \'' + ds + '\')" style="height:' + ((CAL_HOUR_END - CAL_HOUR_START) * CAL_HOUR_PX) + 'px">' + items + nowLine + '</div>';
    }).join("");
    var tpl = "grid-template-columns: 52px repeat(" + days.length + ", minmax(0, 1fr))";
    return '<div class="cal-tg">' +
      '<div class="cal-tg-top" style="' + tpl + '"><div></div>' + heads + '<div class="cal-tg-allday-label">Journée</div>' + allDayRow + '</div>' +
      '<div class="cal-tg-scroll" id="cal-tg-scroll"><div class="cal-tg-body" style="' + tpl + '"><div class="cal-hours">' + hours + '</div>' + cols + '</div></div></div>';
  }
  function renderCalendarPage() {
    var v = calEnsureView();
    var range = calRangeFor(v);
    var occ = calAllOccurrences(range.from, range.to);
    var byDate = {};
    occ.forEach(function (o) { (byDate[o.date] = byDate[o.date] || []).push(o); });
    var ref = calParse(v.date), title;
    if (v.mode === "month") title = MONTH_NAMES[ref.getMonth()] + " " + ref.getFullYear();
    else if (v.mode === "week") {
      var a = calParse(range.from), b = calParse(range.to);
      title = a.getDate() + (a.getMonth() !== b.getMonth() ? " " + MONTH_NAMES[a.getMonth()] : "") + " – " + b.getDate() + " " + MONTH_NAMES[b.getMonth()] + " " + b.getFullYear();
    } else title = ref.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    title = title.charAt(0).toUpperCase() + title.slice(1);
    var modeBtn = function (m, label) { return '<button type="button" class="cal-mode-btn' + (v.mode === m ? " active" : "") + '" onclick="App.calSetMode(\'' + m + '\')">' + label + '</button>'; };
    var st = calSettings();
    var head = '<div class="page-head"><div><div class="page-title-row"><img class="page-title-logo" src="assets/objects/ui/Calendrier.png" alt=""><h1 class="page-title">Calendrier</h1></div><p class="page-sub">Tes contrôles, tes séances de révision et ton emploi du temps. Révisions placées entre ' + st.studyStart.replace(":", "h") + ' et ' + st.studyEnd.replace(":", "h") + ', décalées si tu es occupé.</p></div>' +
      '<div class="cal-gbar"><button class="btn btn-ghost btn-sm" style="width:auto" onclick="App.calOpenSettings()">⚙️ Heures de révision</button><button class="btn btn-primary" style="width:auto" onclick="App.calNewEvent()">' + icon("plus") + ' Événement</button></div></div>';
    var nav = '<div class="cal-nav"><button class="btn btn-ghost btn-sm" style="width:auto" onclick="App.calMove(-1)" aria-label="Précédent">‹</button><h2 class="cal-month">' + esc(title) + '</h2><button class="btn btn-ghost btn-sm" style="width:auto" onclick="App.calMove(1)" aria-label="Suivant">›</button>' +
      '<button class="btn btn-ghost btn-sm" style="width:auto" onclick="App.calToday()">Aujourd\'hui</button><div class="cal-modes">' + modeBtn("day", "Jour") + modeBtn("week", "Semaine") + modeBtn("month", "Mois") + '</div></div>';
    var mainHtml;
    if (v.mode === "month") {
      var sel = calSortOcc(byDate[v.date] || []);
      var selLabel = ref.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      var dayList = sel.length ? sel.map(function (o) {
        return '<div class="cal-day-item"' + calOccClick(o) + (o.kind === "user" ? ' style="--cal-color:' + esc(o.color) + '"' : "") + '>' +
          '<div class="cal-day-time mono">' + (o.allDay ? "Journée" : calFromMin(o.startMin) + "<br>" + calFromMin(o.endMin)) + '</div>' +
          '<div style="min-width:0"><div class="cal-day-title">' + calChip(o, false) + '</div>' +
          (o.detail ? '<div class="cal-day-sub">' + esc(o.detail) + '</div>' : "") +
          (o.moved ? '<div class="cal-day-sub">↪️ ' + esc(o.moved) + '</div>' : "") +
          (o.location ? '<div class="cal-day-sub">📍 ' + esc(o.location) + '</div>' : "") + '</div></div>';
      }).join("") : '<p class="cal-empty">Rien de prévu ce jour-là.</p>';
      mainHtml = '<div class="cal-wrap"><div class="cal-main">' + calMonthHtml(v, byDate, range) + '</div>' +
        '<aside class="cal-side"><h3 class="cal-side-title">' + esc(selLabel.charAt(0).toUpperCase() + selLabel.slice(1)) + '</h3>' + dayList +
        '<button class="btn btn-ghost btn-sm" style="width:auto;align-self:flex-start" onclick="App.calNewEvent(\'' + v.date + '\')">' + icon("plus") + ' Ajouter ce jour-là</button></aside></div>';
    } else {
      var days = [];
      for (var ds = range.from; ds <= range.to; ds = calAddDays(ds, 1)) days.push(ds);
      mainHtml = calTimeGridHtml(days, byDate);
    }
    var legend = '<div class="cal-legend"><span class="cal-chip cal-chip-exam">🎯 Contrôle</span><span class="cal-chip cal-chip-session">📖 Révision</span><span class="cal-chip cal-chip-session">↪️ Révision décalée</span><span class="cal-chip cal-chip-google">Tes événements</span></div>';
    renderShell(["calendar"], head + nav + mainHtml + legend);
    // Semaine / Jour : on fait défiler jusqu'à l'heure actuelle (ou 8 h).
    var sc = document.getElementById("cal-tg-scroll");
    if (sc) { var n = new Date(); sc.scrollTop = Math.max(0, ((calDateStr(n) >= range.from && calDateStr(n) <= range.to ? n.getHours() - 1 : 8) - CAL_HOUR_START) * CAL_HOUR_PX); }
  }
  // Fenêtre d'ajout / de modification d'un événement (mêmes informations que Google Agenda).
  function calEventModalHtml() {
    var e = modal.ev;
    var colorBtns = CAL_COLORS.map(function (c) { return '<button type="button" class="cal-color' + (e.color === c ? " selected" : "") + '" style="background:' + c + '" onclick="App.calEvField(\'color\', \'' + c + '\')" aria-label="Couleur"></button>'; }).join("");
    var notif = e.notify == null ? '<button type="button" class="btn btn-ghost btn-sm" style="width:auto" onclick="App.calEvField(\'notify\', 30)">🔔 Ajouter une notification</button>'
      : '<div class="cal-row"><span>🔔 Notification</span><input type="number" min="0" max="999" value="' + (e.notifyValue || 30) + '" style="width:80px" onchange="App.calEvField(\'notifyValue\', this.value)">' +
        '<select onchange="App.calEvField(\'notifyUnit\', this.value)">' + [["min", "minutes"], ["h", "heures"], ["d", "jours"]].map(function (u) { return '<option value="' + u[0] + '"' + ((e.notifyUnit || "min") === u[0] ? " selected" : "") + '>' + u[1] + '</option>'; }).join("") + '</select>' +
        '<span class="cal-muted">avant</span><button type="button" class="btn btn-ghost btn-sm" style="width:auto" onclick="App.calEvField(\'notify\', null)" aria-label="Retirer la notification">✕</button></div>';
    return '<div class="cal-ev-modal">' +
      '<input class="cal-ev-title" placeholder="Ajouter un titre" value="' + esc(e.title || "") + '" oninput="App.calEvField(\'title\', this.value, true)" autofocus>' +
      '<div class="cal-row">' +
      // Dates et heures : mise à jour SANS redessiner la fenêtre (sinon chaque chiffre tapé effaçait le
      // champ en cours de saisie) ; les champs liés (fin) sont mis à jour directement.
      '<input type="date" id="cal-ev-sd" value="' + e.startDate + '" onchange="App.calEvField(\'startDate\', this.value, true)">' +
      (e.allDay ? "" : '<input type="time" id="cal-ev-st" value="' + e.startTime + '" onchange="App.calEvField(\'startTime\', this.value, true)"><span>–</span><input type="time" id="cal-ev-et" value="' + e.endTime + '" onchange="App.calEvField(\'endTime\', this.value, true)">') +
      '<input type="date" id="cal-ev-ed" value="' + e.endDate + '" onchange="App.calEvField(\'endDate\', this.value, true)"></div>' +
      '<div class="cal-row"><label class="cal-check"><input type="checkbox"' + (e.allDay ? " checked" : "") + ' onchange="App.calEvField(\'allDay\', this.checked)"> Toute la journée</label>' +
      '<select onchange="App.calEvField(\'repeat\', this.value)">' + CAL_REPEATS.map(function (r) { return '<option value="' + r[0] + '"' + ((e.repeat || "none") === r[0] ? " selected" : "") + '>' + r[1] + '</option>'; }).join("") + '</select></div>' +
      '<div class="field"><input placeholder="📍 Ajouter un lieu" value="' + esc(e.location || "") + '" oninput="App.calEvField(\'location\', this.value, true)"></div>' +
      notif +
      '<div class="cal-row"><span class="cal-muted">Couleur</span><div class="cal-colors">' + colorBtns + '</div></div>' +
      '<div class="cal-row"><select onchange="App.calEvField(\'busy\', this.value === \'1\')"><option value="1"' + (e.busy !== false ? " selected" : "") + '>Occupé (les révisions se décalent)</option><option value="0"' + (e.busy === false ? " selected" : "") + '>Disponible (ne bloque rien)</option></select></div>' +
      '<div class="field"><label>Description</label>' + richEditorHtml("cal-ev-desc", "Ajouter une description", sanitizeRichHtml(e.description || "")) + '</div>' +
      '<div class="modal-actions">' + (modal.editId ? '<button type="button" class="btn btn-ghost" style="margin-right:auto" onclick="App.calDeleteEvent()">' + icon("trash") + ' Supprimer</button>' : "") +
      '<button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button><button type="button" class="btn btn-primary" onclick="App.calSaveEvent()">Enregistrer</button></div></div>';
  }
  function calSettingsModalHtml() {
    var st = calSettings();
    return '<h3>⚙️ Heures de révision</h3><p class="modal-warn" style="margin-bottom:12px">Les séances de révision de tes prépas sont placées dans cette plage horaire, autour de tes événements. Si un jour est trop chargé, la séance passe sur un autre jour avant le contrôle.</p>' +
      '<div class="cal-row"><span>De</span><input type="time" id="cal-st-start" value="' + st.studyStart + '"><span>à</span><input type="time" id="cal-st-end" value="' + st.studyEnd + '"></div>' +
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button><button type="button" class="btn btn-primary" onclick="App.calSaveSettings()">Enregistrer</button></div>';
  }
  // Notifications des événements (tant que Studino est ouvert) : toast + notification du navigateur.
  var calNotified = {};
  setInterval(function () {
    if (!DB || !DB.currentUser) return;
    var now = new Date(), today = calDateStr(now);
    var occ;
    try { occ = calExpandUserEvents(today, calAddDays(today, 2)); } catch (e) { return; }
    occ.forEach(function (o) {
      var ev = o.ev;
      if (ev.notify == null) return;
      var mult = ev.notifyUnit === "h" ? 60 : ev.notifyUnit === "d" ? 1440 : 1;
      var before = (Number(ev.notifyValue) || 0) * mult;
      var start = calParse(o.date); start.setMinutes(o.startMin);
      var fireAt = start.getTime() - before * 60000;
      var key = ev.id + "@" + o.date;
      if (calNotified[key] || now.getTime() < fireAt || now.getTime() > start.getTime()) return;
      calNotified[key] = true;
      var msg = "🔔 " + o.title + (o.time ? " à " + o.time : "") + (o.location ? " · " + o.location : "");
      toast(msg);
      try { if (window.Notification && Notification.permission === "granted") new Notification("Studino", { body: msg }); } catch (e) {}
    });
  }, 30000);

  /* ---------------- Répétition espacée des flashcards ----------------
     Chaque flashcard (des cours et des prépas) a une prochaine date de révision. Ratée → elle revient
     demain ; sue → elle revient de plus en plus tard (1, 3, 7, 15, 30, 60 puis 120 jours). On revoit
     ainsi chaque notion juste avant de l'oublier, même sans contrôle prévu. */
  var SRS_STEPS = [1, 3, 7, 15, 30, 60, 120];
  var SRS_NEW_PER_DAY = 15;
  function srsToday() { return calDateStr(new Date()); }
  function srsGrade(card, ok) {
    if (!card) return;
    if (ok) card.srsStep = card.srsStep == null ? 0 : Math.min(SRS_STEPS.length - 1, card.srsStep + 1);
    else card.srsStep = null; // repart du début : demain, puis 1, 3, 7...
    card.srsDue = calAddDays(srsToday(), ok ? SRS_STEPS[card.srsStep] : 1);
    card.srsReps = (card.srsReps || 0) + 1;
    card.status = ok ? "known" : "review";
  }
  // Toutes les flashcards, avec de quoi les retrouver.
  function srsAllCards() {
    var out = [];
    (userData().subjects || []).forEach(function (s) {
      (s.themes || []).forEach(function (t) {
        (t.chapters || []).forEach(function (c) {
          (c.courses || []).forEach(function (co) {
            (co.flashcards || []).forEach(function (f) { out.push({ card: f, source: co.title, kind: "course", courseId: co.id }); });
          });
        });
      });
    });
    (userData().examPreps || []).forEach(function (p) {
      (p.gapFlashcards || []).forEach(function (f) { out.push({ card: f, source: "Prépa : " + p.title, kind: "gap", prepId: p.id }); });
    });
    return out;
  }
  function srsDueCards() {
    var today = srsToday(), all = srsAllCards();
    var due = all.filter(function (x) { return x.card.srsDue && x.card.srsDue <= today; });
    due.sort(function (a, b) { return a.card.srsDue < b.card.srsDue ? -1 : 1; });
    var fresh = all.filter(function (x) { return !x.card.srsDue; }).slice(0, SRS_NEW_PER_DAY);
    return { due: due, fresh: fresh, all: due.concat(fresh) };
  }
  var srsSession = null; // { ids: [cardId], idx, flipped, ok, ko }
  function srsFindCard(id) {
    var hit = srsAllCards().find(function (x) { return x.card.id === id; });
    return hit || null;
  }
  function renderReviewPage() {
    var s = srsSession;
    var head = '<div class="page-head"><div><div class="page-title-row"><span class="page-title-emoji">🃏</span><h1 class="page-title">Révision des flashcards</h1></div><p class="page-sub">Ratée : elle revient demain. Sue : elle revient de plus en plus tard.</p></div></div>';
    if (!s) {
      var d = srsDueCards();
      if (!d.all.length) { renderShell(["review"], head + '<div class="empty-state">' + sprite("dinoBig", 5, { bob: true }) + '<h3>Rien à revoir aujourd\'hui 🎉</h3><p>Reviens demain : tes cartes reviendront juste avant que tu les oublies.</p></div>'); return; }
      srsSession = s = { ids: d.all.map(function (x) { return x.card.id; }), idx: 0, flipped: false, ok: 0, ko: 0 };
    }
    if (s.idx >= s.ids.length) {
      var body = '<div class="today-card" style="text-align:center"><h2 style="margin:0 0 8px">Révision terminée ✅</h2><p>' + s.ok + ' carte' + (s.ok !== 1 ? "s" : "") + ' sue' + (s.ok !== 1 ? "s" : "") + ', ' + s.ko + ' à revoir demain.</p>' +
        '<button class="btn btn-primary" style="width:auto" onclick="App.srsFinish()">Retour à Aujourd\'hui</button></div>';
      renderShell(["review"], head + body);
      return;
    }
    var hit = srsFindCard(s.ids[s.idx]);
    if (!hit) { s.idx++; renderReviewPage(); return; }
    var c = hit.card;
    var html = '<div class="fc-wrap">' +
      '<div class="fc-progress"><span>Carte ' + (s.idx + 1) + ' / ' + s.ids.length + '</span><span class="mono">' + esc(hit.source) + (c.srsDue ? "" : " · nouvelle") + '</span></div>' +
      '<div class="fc-bar"><div class="fc-bar-fill" style="width:' + Math.round((s.idx / s.ids.length) * 100) + '%"></div></div>' +
      '<div class="fc-hint">Essaie de répondre de tête, puis retourne la carte</div>' +
      '<div class="flip-card' + (s.flipped ? " flipped" : "") + '" onclick="App.srsFlip()"><div class="flip-inner">' +
      '<div class="flip-face"><span class="flip-eyebrow">Question</span><span class="flip-text">' + esc(c.q) + '</span></div>' +
      '<div class="flip-face flip-face-back"><span class="flip-eyebrow">Réponse</span><span class="flip-text">' + esc(c.a) + '</span></div>' +
      '</div></div>' +
      (s.flipped
        ? '<div class="fc-controls"><button class="btn btn-ghost" style="flex:1" onclick="App.srsAnswer(false)">❌ Ratée (demain)</button><button class="btn btn-primary" style="flex:1" onclick="App.srsAnswer(true)">✅ Sue</button></div>'
        : '<div class="fc-controls"><button class="btn btn-primary" style="flex:1" onclick="App.srsFlip()">Voir la réponse</button></div>') +
      '</div>';
    renderShell(["review"], head + html);
  }

  /* ---------------- Sauvegarde : rappel d'export ----------------
     Tout est stocké dans ce navigateur : vider ses données, changer d'appareil ou un nettoyage du
     navigateur effacerait tout. On demande au navigateur de garder les données (stockage persistant)
     et on rappelle d'exporter une sauvegarde au moins une fois par semaine. */
  var LAST_EXPORT_KEY = "studino-last-export";
  function lastExportAt() { try { return Number(localStorage.getItem(LAST_EXPORT_KEY)) || 0; } catch (e) { return 0; } }
  function hasDataWorthSaving() {
    var d = userData();
    return (d.subjects || []).some(function (s) { return (s.themes || []).length; }) || (d.examPreps || []).length > 0;
  }
  function backupDaysAgo() { var t = lastExportAt(); return t ? Math.floor((Date.now() - t) / 86400000) : null; }
  function backupNeeded() { if (!hasDataWorthSaving()) return false; var d = backupDaysAgo(); return d === null || d >= 7; }
  function backupBannerHtml() {
    if (!backupNeeded()) return "";
    var d = backupDaysAgo();
    return '<div class="backup-banner"><span>💾 ' + (d === null ? "Tu n'as encore jamais sauvegardé tes données." : "Dernière sauvegarde il y a " + d + " jours.") +
      ' Tout est stocké dans ce navigateur : une sauvegarde évite de tout perdre.</span><button class="btn btn-primary btn-sm" style="width:auto" onclick="App.exportBackup()">⬇️ Sauvegarder maintenant</button></div>';
  }

  /* ---------------- Aujourd'hui ----------------
     Page d'accueil : tout ce qu'il y a à faire aujourd'hui, en un coup d'œil (séance de prépa du jour,
     flashcards à revoir, prochains contrôles, emploi du temps), un clic pour s'y mettre. */
  function renderTodayPage() {
    var today = srsToday();
    var preps = userData().examPreps || [];
    var slots = {};
    try { calScheduledRevisions(today, today).forEach(function (o) { if (o.kind === "session" && o.hash) slots[o.hash] = o; }); } catch (e) {}
    var sessions = preps.filter(function (p) { return p.examDate >= today && (p.days || []).some(function (d) { return d.date === today; }); }).map(function (p) {
      var done = p.sessions && p.sessions[today] && p.sessions[today].status === "done";
      var slot = slots["#/examprep/" + p.id];
      var day = p.days.find(function (d) { return d.date === today; });
      return '<div class="today-row">' +
        '<div style="min-width:0"><div class="today-row-title">' + (done ? "✅ " : "📖 ") + esc(p.title) + '</div>' +
        '<div class="today-row-sub">' + (slot && !done ? "Prévue à " + slot.time + " · " : "") + "≈ " + EP_SESSION_MINUTES + " min" + (day && day.focus ? " · " + esc(day.focus) : "") + '</div></div>' +
        (done ? '<span class="today-done">Faite</span>' : '<button class="btn btn-primary btn-sm" style="width:auto" onclick="location.hash=\'#/examprep/' + p.id + '\'">Commencer</button>') + '</div>';
    }).join("");
    var d = srsDueCards();
    var cardsHtml = d.all.length
      ? '<div class="today-row"><div><div class="today-row-title">🃏 ' + d.due.length + ' à revoir' + (d.fresh.length ? " + " + d.fresh.length + " nouvelle" + (d.fresh.length > 1 ? "s" : "") : "") + '</div><div class="today-row-sub">Environ ' + Math.max(1, Math.round(d.all.length * 0.3)) + ' min</div></div><button class="btn btn-primary btn-sm" style="width:auto" onclick="App.srsStart()">Réviser</button></div>'
      : '<p class="today-empty">Aucune flashcard à revoir aujourd\'hui 🎉</p>';
    var upcoming = preps.filter(function (p) { return p.examDate >= today; }).sort(function (a, b) { return a.examDate < b.examDate ? -1 : 1; }).slice(0, 4).map(function (p) {
      var n = Math.round((calParse(p.examDate) - calParse(today)) / 86400000);
      return '<div class="today-row" onclick="location.hash=\'#/examprep/' + p.id + '\'" style="cursor:pointer"><div class="today-row-title">🎯 ' + esc(p.title) + '</div><span class="today-badge' + (n <= 3 ? " today-badge-hot" : "") + '">' + (n === 0 ? "Aujourd'hui" : n === 1 ? "Demain" : "Dans " + n + " jours") + '</span></div>';
    }).join("");
    var events = [];
    try { events = calExpandUserEvents(today, today).sort(function (a, b) { return a.startMin - b.startMin; }); } catch (e) {}
    var eventsHtml = events.map(function (o) {
      return '<div class="today-row" onclick="App.calEditEvent(\'' + o.ev.id + '\')" style="cursor:pointer;--cal-color:' + esc(o.color) + '"><div class="today-row-title"><span class="today-dot"></span>' + esc(o.title) + '</div><span class="today-row-sub mono">' + (o.allDay ? "Journée" : calFromMin(o.startMin) + " – " + calFromMin(o.endMin)) + '</span></div>';
    }).join("");
    var dateLabel = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    var head = '<div class="page-head"><div><div class="page-title-row"><span class="page-title-emoji">☀️</span><h1 class="page-title">Aujourd\'hui</h1></div><p class="page-sub">' + esc(dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)) + '</p></div></div>';
    var nothing = !sessions && !d.all.length && !upcoming;
    var body = backupBannerHtml() + '<div class="today-grid">' +
      '<section class="today-card"><h3>Séance de prépa du jour</h3>' + (sessions || '<p class="today-empty">Pas de séance prévue aujourd\'hui.' + (preps.length ? "" : ' <a href="#/examprep">Crée une prépa</a> pour un planning de révision avant ton prochain contrôle.') + '</p>') + '</section>' +
      '<section class="today-card"><h3>Flashcards</h3>' + cardsHtml + '</section>' +
      '<section class="today-card"><h3>Prochains contrôles</h3>' + (upcoming || '<p class="today-empty">Aucun contrôle prévu.</p>') + '</section>' +
      '<section class="today-card"><h3>Ton emploi du temps</h3>' + (eventsHtml || '<p class="today-empty">Rien dans ton calendrier aujourd\'hui. <a href="#/calendar">Ouvrir le calendrier</a></p>') + '</section>' +
      '</div>' +
      (nothing ? '<p class="today-empty" style="margin-top:16px">Pour commencer : importe un cours depuis le <a href="#/">Menu</a>, puis crée une prépa avant ton prochain contrôle.</p>' : "");
    renderShell(["today"], head + body);
  }

