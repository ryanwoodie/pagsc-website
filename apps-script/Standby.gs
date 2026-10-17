/**
 * Standby list: guests who would rather wait for a good flying day than book ahead.
 *
 * Weekend spots are held only for paid flights (a certificate code) until the club confirms the day.
 * Anyone can join the standby list instead, paid or paying at the field, for:
 *   Day      one weekend day
 *   Weekend  either day of one weekend
 *   Any      any weekend we fly (the general list)
 * Nothing is held. Once the club opens a day to the standby list ("Discovery flights available" in the Status /
 * Comments row; see guestOpening in Booking.gs), the regular check (every 10 minutes, Reminders.gs) emails everyone waiting for it, all at
 * once: "Spots are open" (or "Flying is on" when the status text explicitly confirms the day), first
 * come, first served. The email quotes the day's Status / Comments text. That includes the day itself:
 * a day opened that morning can be booked the same day.
 * Day and Weekend sign-ups get one email and are done. Any-weekend sign-ups get an email for each day that
 * opens and stay on the list until they book or take themselves off (a link in every email). Every
 * ASK_EVERY emails, the email asks whether they would like to come off the list.
 *
 * Day and Weekend sign-ups also show on the Flying Schedule, in the day's guest block, by first name only:
 * "Standby: Jane (2) web (or Sun)". They take empty rows only; a booking replaces one if the block is full.
 * The entry comes off when they book, leave the list or the weekend passes.
 *
 * Standby tab (requests sheet): one row per sign-up. Status: Waiting -> Notified (Day, Weekend),
 * Booked, Removed, Replaced (signed up again), or Expired (Day, Weekend: the weekend passed).
 */

var STANDBY = {
  TAB: 'Standby',
  HEADERS: ['Received', 'Date', 'Start', 'People', 'Either weekend day', 'Name', 'Email', 'Phone', 'Interest',
    'Message', 'Status', 'Notified', 'Opened date', 'Scope', 'Codes', 'Token', 'Days notified', 'Emails sent', 'Schedule cell', 'Schedule text'],
  ASK_EVERY: 10     // any-weekend guests: every 10th flying-day email asks if they would like to come off the list
};

function standbySheet() {
  var sh = sheet(STANDBY.TAB, STANDBY.HEADERS);
  var head = sh.getRange(1, 1, 1, STANDBY.HEADERS.length).getValues()[0];
  if (head.join('|') !== STANDBY.HEADERS.join('|')) sh.getRange(1, 1, 1, STANDBY.HEADERS.length).setValues([STANDBY.HEADERS]);
  return sh;
}

function standbyCol(name) {
  return STANDBY.HEADERS.indexOf(name) + 1;
}

/** 'Day', 'Weekend' or 'Any'. Rows from before the Scope column use the either-day answer. */
function standbyScope(scope, either) {
  if (scope === 'Any' || scope === 'Weekend' || scope === 'Day') return scope;
  return either === 'Yes' ? 'Weekend' : 'Day';
}

/**
 * Which day, if any, has opened for a one-weekend sign-up: its own date if flying is on, otherwise the
 * other weekend day if they said either works and that day is on. Only days still bookable online.
 * @param s {date, flexible}  @param availByDate {date: availability day}
 */
function standbyOpenDay(s, availByDate) {
  var own = availByDate[s.date];
  if (own && own.open && own.remaining > 0) return own;
  if (s.flexible) {
    var other = availByDate[weekendPartner(s.date)];
    if (other && other.open && other.remaining > 0) return other;
  }
  return null;
}

/** Any-weekend sign-ups: confirmed weekend days with room for their group that they have not heard about yet. */
function standbyAnyOpenDays(s, avail, notified) {
  return avail.filter(function (d) {
    return d.kind === 'weekend' && d.open && d.remaining >= s.people && notified.indexOf(d.date) < 0;
  });
}

/**
 * The 'Days notified' cell as a list of ISO dates, whatever Sheets made of what was written.
 * A lone '2026-10-17' entry can be stored as a date value and read back as a Date object instead
 * of the string, which used to make the day look never-notified and re-email it every hour.
 */
function standbyNotifiedList(v) {
  if (!v) return [];
  if (Object.prototype.toString.call(v) === '[object Date]') return [isoOf(v)];
  return String(v).split(/,\s*/).filter(String);
}

/** The schedule entry for a one-weekend sign-up. Ends in "web" so it is never counted as a guest flight. */
function standbyScheduleText(name, people, orDate) {
  var first = String(name || '').trim().split(/\s+/)[0];
  return 'Standby: ' + first + (people > 1 ? ' (' + people + ')' : '') + ' web' +
    (orDate ? ' (or ' + DAY_NAMES[weekdayOf(orDate)].slice(0, 3) + ')' : '');
}

/** Any-weekend sign-ups: does the nth flying-day email ask whether they would like to come off the list? */
function standbyAskToStay(n) {
  return n > 0 && n % STANDBY.ASK_EVERY === 0;
}

/** Where a standby email sends them: the calendar on that day, with their certificate codes filled in. */
function standbyLink(site, date, codes) {
  return site + '/discovery-flight/?date=' + date + (codes && codes.length ? '&code=' + codes.join(',') : '') + '#request';
}

/** Email links plus the link to leave the standby list for one sign-up. */
function standbyLinks(token) {
  var links = emailLinks('');
  links.off = ScriptApp.getService().getUrl() + '?action=standby-off&token=' + encodeURIComponent(token);
  return links;
}

function standbyPost(p) {
  var scope = p.scope === 'any' ? 'Any' : p.scope === 'weekend' || p.flexible === 'yes' ? 'Weekend' : 'Day';
  var s = {
    scope: scope,
    date: scope === 'Any' ? '' : clean(p.date),
    start: scope === 'Any' ? '' : clean(p.start),
    people: parseInt(p.people, 10),
    name: clean(p.name),
    email: clean(p.email),
    phone: clean(p.phone),
    interest: clean(p.interest) || 'Discovery flight',
    message: clean(p.message),
    flexible: scope === 'Weekend',
    codes: []
  };
  var problems = [];
  if (!s.name) problems.push('your name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email)) problems.push('a valid email address');
  // Phone and the weight check are asked for when they book, not to join the list.
  if (s.phone && !/\d{3}.*\d{4}/.test(s.phone)) problems.push('a full phone number (or leave it blank)');
  if (!(s.people >= 1 && s.people <= BOOKING.MAX_GROUP)) problems.push('the number of people');
  if (problems.length) return json({ ok: false, error: 'We still need ' + problems.join(', ') + '.' });
  if (scope !== 'Any' && (!weekendPartner(s.date) || s.date <= todayOnField())) return json({ ok: false, error: 'The standby list is for weekend days.' });
  var parsed = parseCodes(p.codes);
  if (parsed.bad.length) return json({ ok: false, error: '"' + clean(parsed.bad[0]) + '" is not a certificate code. Codes look like PAGSC-7KQ2-XM9D.' });
  s.codes = parsed.codes.slice(0, BOOKING.MAX_GROUP);

  var token = Utilities.getUuid();
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = standbySheet();
    // Signing up for any weekend replaces their earlier sign-ups that are still waiting.
    if (scope === 'Any') {
      var rows = sh.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        if (rows[i][standbyCol('Status') - 1] === 'Waiting' && String(rows[i][standbyCol('Email') - 1]).toLowerCase() === s.email.toLowerCase()) {
          sh.getRange(i + 1, standbyCol('Status')).setValue('Replaced');
        }
      }
    }
    sh.appendRow([new Date(), s.date, s.start ? "'" + s.start : '', s.people, s.flexible ? 'Yes' : 'No', s.name, s.email, s.phone,
      s.interest, s.message, 'Waiting', '', '', scope, s.codes.join(', '), token, '', 0]);
  } finally {
    lock.releaseLock();
  }

  sendGuestEmail(s.email, standbyEmail(s, standbyLinks(token)));
  var forWhat = scope === 'Any' ? 'any weekend we fly' : longDate(s.date) + (s.flexible ? ' (or the other day of that weekend)' : '');
  MailApp.sendEmail({
    to: prop('CLUB_EMAIL'),
    replyTo: s.email,
    subject: 'Standby: ' + s.name + ', ' + (scope === 'Any' ? 'any weekend' : longDate(s.date) + (s.flexible ? ' (either day)' : '')) + ', ' + s.people + (s.people === 1 ? ' person' : ' people'),
    body: [
      s.name + ' joined the standby list' + (s.codes.length ? ' (paid online).' : ' to pay at the field.'),
      '',
      'For: ' + forWhat,
      s.start ? 'Preferred time: ' + clock12(s.start) : null,
      'People: ' + s.people,
      s.codes.length ? 'Certificates: ' + s.codes.join(', ') : null,
      'Email: ' + s.email,
      'Phone: ' + (s.phone || '(not given)'),
      'Interest: ' + s.interest,
      'Message: ' + (s.message || '(none)'),
      '',
      'When you add "Discovery flights available" to that day\'s Status row, they get an email within about 10 minutes that spots are open.'
    ].filter(function (line) { return line !== null; }).join('\n')
  });
  return json({ ok: true, kind: 'Standby', scope: scope, date: s.date, people: s.people });
}

/** After a booking: anyone with that email still waiting on the standby list comes off it. */
function standbyBooked(email) {
  var sh = standbySheet();
  var rows = sh.getDataRange().getValues();
  email = String(email).toLowerCase();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][standbyCol('Status') - 1] === 'Waiting' && String(rows[i][standbyCol('Email') - 1]).toLowerCase() === email) {
      sh.getRange(i + 1, standbyCol('Status')).setValue('Booked');
    }
  }
}

/** The "Take me off the standby list" link in standby emails. */
function standbyOff(token) {
  token = String(token || '');
  var calendar = siteOrigin() + '/discovery-flight/#request';
  var page = function (title, message, showCalendar) {
    return HtmlService.createHtmlOutput(cancelPageHtml(title, message, showCalendar ? calendar : '', 'Book a flight'));
  };
  if (!/^[0-9a-f-]{36}$/i.test(token)) return page('Not found', 'That link is not valid.', true);
  var sh = standbySheet();
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][standbyCol('Token') - 1] !== token) continue;
    if (rows[i][standbyCol('Status') - 1] === 'Waiting') {
      sh.getRange(i + 1, standbyCol('Status')).setValue('Removed');
      MailApp.sendEmail({ to: prop('CLUB_EMAIL'), subject: 'Standby: ' + rows[i][standbyCol('Name') - 1] + ' left the list', body: rows[i][standbyCol('Name') - 1] + ' took themselves off the standby list.' });
    }
    return page("You're off the standby list", 'We will not email you about flying days. You can book a flight on the website any time.', true);
  }
  return page('Not found', 'That link is not valid.', true);
}

/** Every run of runReminders: tell waiting standby guests when a day they want is confirmed. */
function openStandby(today) {
  var sh = standbySheet();
  var rows = sh.getDataRange().getValues();
  if (rows.length < 2) return;
  var avail = computeAvailability(scheduleDays(scheduleSheet().getDataRange().getDisplayValues()), activeBookings(), guestCaps(), today, nowOnField());
  var availByDate = {};
  avail.forEach(function (a) { availByDate[a.date] = a; });
  var col = standbyCol, site = siteOrigin();
  var set = function (i, name, value) { sh.getRange(i + 1, col(name)).setValue(value); };
  syncStandbySchedule(sh, rows, today);
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (r[col('Status') - 1] !== 'Waiting') continue;
    var s = {
      scope: standbyScope(r[col('Scope') - 1], r[col('Either weekend day') - 1]),
      date: r[1] ? isoOf(r[1]) : '', start: r[2] ? hhmmOf(r[2]) : '', people: Number(r[3]) || 1,
      name: String(r[col('Name') - 1]), email: String(r[col('Email') - 1]),
      codes: String(r[col('Codes') - 1] || '').split(/,\s*/).filter(String)
    };
    s.flexible = s.scope === 'Weekend';
    var token = String(r[col('Token') - 1] || '');
    if (!token) {
      token = Utilities.getUuid();
      set(i, 'Token', token);
    }
    var links = standbyLinks(token);

    if (s.scope === 'Any') {
      var notified = standbyNotifiedList(r[col('Days notified') - 1]);
      var open = standbyAnyOpenDays(s, avail, notified);
      if (!open.length) continue;
      var sent = (Number(r[col('Emails sent') - 1]) || 0) + 1;
      sendGuestEmail(s.email, standbyOpenEmail(s, open.map(function (d) {
        return { date: d.date, remaining: d.remaining, statusText: d.statusText, link: standbyLink(site, d.date, s.codes) };
      }), links, standbyAskToStay(sent) ? sent : 0));
      set(i, 'Emails sent', sent);
      sh.getRange(i + 1, col('Days notified')).setNumberFormat('@');
      set(i, 'Days notified', notified.concat(open.map(function (d) { return d.date; })).join(', '));
      set(i, 'Notified', new Date());
      continue;
    }

    if (!s.date) continue;
    var lastDay = s.flexible && weekdayOf(s.date) === 6 ? addDays(s.date, 1) : s.date;
    if (lastDay < today) { set(i, 'Status', 'Expired'); continue; }
    var day = standbyOpenDay(s, availByDate);
    if (!day || day.remaining < s.people) continue;
    sendGuestEmail(s.email, standbyOpenEmail(s, [{ date: day.date, remaining: day.remaining, statusText: day.statusText, link: standbyLink(site, day.date, s.codes) }], links));
    set(i, 'Status', 'Notified');
    set(i, 'Notified', new Date());
    set(i, 'Opened date', day.date);
  }
}

/**
 * Keep the Flying Schedule in step with one-weekend standby sign-ups: an entry for each one still waiting
 * (or emailed, until the weekend passes), none for anyone who booked, left or expired.
 */
function syncStandbySchedule(sh, rows, today) {
  var sched = scheduleSheet();
  var grid = sched.getDataRange().getDisplayValues();
  var days = scheduleDays(grid);
  var col = standbyCol;
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var scope = standbyScope(r[col('Scope') - 1], r[col('Either weekend day') - 1]);
    if (scope === 'Any' || !r[1]) continue;
    var date = isoOf(r[1]);
    var status = r[col('Status') - 1];
    var lastDay = scope === 'Weekend' && weekdayOf(date) === 6 ? addDays(date, 1) : date;
    var active = (status === 'Waiting' || status === 'Notified') && lastDay >= today;
    var a1 = String(r[col('Schedule cell') - 1] || ''), text = String(r[col('Schedule text') - 1] || '');
    var shown = false;
    if (a1) {
      var range = sched.getRange(a1);
      shown = String(range.getDisplayValue()) === text;
      if (shown && !active) { range.clearContent(); shown = false; }
      if (!shown) sh.getRange(i + 1, col('Schedule cell')).setValue(''); // cleared, or a booking took its place
    }
    if (active && !shown && date >= today) {
      text = standbyScheduleText(r[col('Name') - 1], Number(r[3]) || 1, scope === 'Weekend' ? weekendPartner(date) : null);
      var cell = writeToSchedule(sched, grid, days, date, text, false);
      if (cell) {
        sh.getRange(i + 1, col('Schedule cell')).setValue(cell);
        sh.getRange(i + 1, col('Schedule text')).setValue(text);
      }
    }
  }
}
