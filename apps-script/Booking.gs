/**
 * PAGSC Discovery Flight booking calendar.
 *
 * The website shows the next few weeks from the Flying Schedule and lets a guest hold a
 * half-hour slot (or a few in a row for a group). This file:
 *   - reads dates and the Status / Comments row from the Flying Schedule (SCHEDULE_ID),
 *   - keeps bookings in a private "Bookings" tab of the requests sheet (SHEET_ID),
 *   - answers GET ?action=availability with free / taken slots (no names),
 *   - takes POST form=booking, re-checks the slot, saves it, writes "First name 11:30 (2)" into
 *     that day's intro-flight block on the Flying Schedule, and emails the guest and the club,
 *   - handles GET ?action=cancel&token=… from the guest's email.
 *
 * Weekend bookings are pencilled in right away; weekday bookings are requests a member confirms.
 * Neither is a guarantee: flying depends on weather and volunteers.
 *
 * Extra Script Property: SCHEDULE_ID (the Flying Schedule spreadsheet ID).
 * Optional tab "Guest caps" in the requests sheet: Date (yyyy-mm-dd) | Cap, to change one day's cap.
 */

var BOOKING = {
  FIRST: '11:00',        // first start time
  LAST: '16:00',         // last start time
  STEP: 30,              // minutes per person
  CAP: 6,                // guest half-hours per day
  MAX_GROUP: 4,          // people per booking
  DAYS_AHEAD: 28,
  TZ: 'America/Regina',
  TAB: 'Bookings',
  CAPS_TAB: 'Guest caps',
  HEADERS: ['Received', 'Date', 'Start', 'People', 'Kind', 'Status', 'Name', 'Email', 'Phone',
    'Interest', 'Payment', 'Message', 'Token', 'Schedule cell', 'Schedule text']
};

// ---------- Pure logic (no Google services; tested in scripts/booking.test.mjs) ----------

/** ['11:00', '11:30', … '16:00'] */
function slotTimes() {
  var out = [];
  var t = toMinutes(BOOKING.FIRST), last = toMinutes(BOOKING.LAST);
  for (; t <= last; t += BOOKING.STEP) out.push(fromMinutes(t));
  return out;
}

function toMinutes(hhmm) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

function fromMinutes(n) {
  var h = Math.floor(n / 60), m = n % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Sat Oct 3,2026" -> "2026-10-03"; null if not a date. */
function parseSheetDate(text) {
  var m = /([A-Za-z]{3})[a-z]*\.?\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s*(\d{4})/.exec(String(text || ''));
  if (!m) return null;
  var month = MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0) return null;
  var d = new Date(Date.UTC(Number(m[4]), month, Number(m[3])));
  if (d.getUTCMonth() !== month) return null;
  return d.toISOString().slice(0, 10);
}

function classifyStatus(text) {
  var t = String(text || '').toLowerCase();
  if (!t.trim()) return '';
  if (/\b(cancel+ed|cancel+ing|cancel|scrubbed|no fly(ing)?|not flying|grounded|day is off|is off|off today)\b/.test(t)) return 'cancelled';
  if (/\b(delay(ed)?|postpon\w*|later start|on hold|tbd)\b/.test(t)) return 'delayed';
  if (/\b(a go|is go|go for|good to go|flying (is )?on|day is on|we('re| are) flying|on for|confirmed)\b/.test(t)) return 'on';
  return 'unknown';
}

function weekdayOf(iso) {
  return new Date(iso + 'T12:00:00Z').getUTCDay(); // 0 Sun … 6 Sat
}

function addDays(iso, n) {
  var d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Pull the dates, status text and intro-block row for each column of the schedule grid.
 * @param {string[][]} grid display values of the schedule's first tab
 */
function scheduleDays(grid) {
  var days = [];
  if (!grid || !grid.length) return days;
  var statusRow = -1;
  for (var r = 0; r < grid.length; r++) {
    if (/^status/i.test(String(grid[r][0] || '').trim())) { statusRow = r; break; }
  }
  for (var c = 1; c < grid[0].length; c++) {
    var date = parseSheetDate(grid[0][c]);
    if (!date) continue;
    var introRow = -1;
    for (var r2 = 1; r2 < grid.length; r2++) {
      if (/intro\s*fam\s*flight\s*sign-?\s*up/i.test(String(grid[r2][c] || ''))) { introRow = r2; break; }
    }
    days.push({
      date: date,
      col: c,
      introRow: introRow,
      statusText: statusRow >= 0 ? String(grid[statusRow][c] || '').replace(/\s+/g, ' ').trim().slice(0, 160) : ''
    });
  }
  return days;
}

/**
 * Availability for the website.
 * @param days from scheduleDays()
 * @param bookings [{date, start, people}] that are not cancelled
 * @param caps {date: cap} overrides
 * @param today ISO date on the field
 */
function computeAvailability(days, bookings, caps, today) {
  var times = slotTimes();
  var first = addDays(today, 1), last = addDays(today, BOOKING.DAYS_AHEAD);
  var out = [];
  days.forEach(function (d) {
    if (d.date < first || d.date > last) return;
    var wd = weekdayOf(d.date);
    var taken = {}, used = 0;
    bookings.forEach(function (b) {
      if (b.date !== d.date) return;
      var i = times.indexOf(b.start);
      for (var k = 0; k < b.people; k++) if (i + k >= 0 && i + k < times.length) taken[i + k] = true;
      used += b.people;
    });
    var cap = caps && caps[d.date] != null ? Number(caps[d.date]) : BOOKING.CAP;
    var status = classifyStatus(d.statusText);
    out.push({
      date: d.date,
      kind: wd === 0 || wd === 6 ? 'weekend' : 'weekday',
      status: status,
      statusText: d.statusText,
      remaining: Math.max(0, cap - used),
      slots: times.map(function (t, i) { return { time: t, free: !taken[i] }; })
    });
  });
  out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  return out;
}

/** Can a group of `people` start at `start` on this availability day? */
function canBook(day, start, people) {
  if (!day || day.status === 'cancelled') return 'That day is not running.';
  if (!(people >= 1 && people <= BOOKING.MAX_GROUP)) return 'Bookings are for 1 to ' + BOOKING.MAX_GROUP + ' people.';
  if (people > day.remaining) return 'There ' + (day.remaining === 1 ? 'is' : 'are') + ' only ' + day.remaining + ' guest spot' + (day.remaining === 1 ? '' : 's') + ' left that day.';
  var i = -1;
  for (var k = 0; k < day.slots.length; k++) if (day.slots[k].time === start) i = k;
  if (i < 0) return 'Please pick a start time.';
  if (i + people > day.slots.length) return 'That start time is too late for ' + people + ' people.';
  for (var j = i; j < i + people; j++) if (!day.slots[j].free) return 'That time was just taken. Please pick another.';
  return '';
}

/** "11:30 to 12:30" for a group starting at 11:30 */
function timeRange(start, people) {
  return start + ' to ' + fromMinutes(toMinutes(start) + people * BOOKING.STEP);
}

// ---------- Google services ----------

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'availability') return json(availabilityResponse());
  if (p.action === 'cancel') return cancelBooking(p.token);
  return HtmlService.createHtmlOutput('PAGSC website endpoint.');
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function todayOnField() {
  return Utilities.formatDate(new Date(), BOOKING.TZ, 'yyyy-MM-dd');
}

function scheduleSheet() {
  return SpreadsheetApp.openById(prop('SCHEDULE_ID')).getSheets()[0];
}

function activeBookings() {
  var rows = sheet(BOOKING.TAB, BOOKING.HEADERS).getDataRange().getValues().slice(1);
  return rows.filter(function (r) { return r[5] !== 'Cancelled' && r[1]; }).map(function (r) {
    return { date: isoOf(r[1]), start: hhmmOf(r[2]), people: Number(r[3]) || 1 };
  });
}

/** Sheets turns "2026-10-10" into a Date and "11:30" into a time; read both back as text. */
function isoOf(v) {
  return v instanceof Date ? Utilities.formatDate(v, BOOKING.TZ, 'yyyy-MM-dd') : String(v).slice(0, 10);
}
function hhmmOf(v) {
  return v instanceof Date ? Utilities.formatDate(v, BOOKING.TZ, 'HH:mm') : String(v).replace(/^'/, '');
}

function guestCaps() {
  var ss = SpreadsheetApp.openById(prop('SHEET_ID'));
  var sh = ss.getSheetByName(BOOKING.CAPS_TAB);
  var caps = {};
  if (!sh) return caps;
  sh.getDataRange().getValues().slice(1).forEach(function (r) {
    if (r[0] !== '' && r[1] !== '') caps[isoOf(r[0])] = Number(r[1]);
  });
  return caps;
}

function availabilityResponse() {
  try {
    var days = scheduleDays(scheduleSheet().getDataRange().getDisplayValues());
    return { ok: true, days: computeAvailability(days, activeBookings(), guestCaps(), todayOnField()) };
  } catch (err) {
    return { ok: false, error: 'unavailable' };
  }
}

function bookingPost(p) {
  var b = {
    date: clean(p.date),
    start: clean(p.start),
    people: parseInt(p.people, 10),
    name: clean(p.name),
    email: clean(p.email),
    phone: clean(p.phone),
    interest: clean(p.interest) || 'Discovery flight',
    payment: clean(p.payment) || 'Not stated',
    message: clean(p.message),
    weightOk: p.weight_ok === 'yes'
  };
  var problems = [];
  if (!b.name) problems.push('your name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) problems.push('a valid email address');
  if (!/\d{3}.*\d{4}/.test(b.phone)) problems.push('a phone number');
  if (!b.weightOk) problems.push('the weight confirmation');
  if (problems.length) return json({ ok: false, error: 'We still need ' + problems.join(', ') + '.' });

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  var result;
  try {
    var sched = scheduleSheet();
    var grid = sched.getDataRange().getDisplayValues();
    var days = scheduleDays(grid);
    var avail = computeAvailability(days, activeBookings(), guestCaps(), todayOnField());
    var day = null;
    avail.forEach(function (d) { if (d.date === b.date) day = d; });
    var why = canBook(day, b.start, b.people);
    if (why) return json({ ok: false, error: why, refresh: true });

    var kind = day.kind === 'weekend' ? 'Held' : 'Requested';
    var token = Utilities.getUuid();
    var first = b.name.split(/\s+/)[0];
    var text = (kind === 'Requested' ? 'Request: ' : '') + first + ' ' + b.start + (b.people > 1 ? ' (' + b.people + ')' : '') + ' web';
    var cell = writeToSchedule(sched, grid, days, b.date, text);

    sheet(BOOKING.TAB, BOOKING.HEADERS).appendRow([
      new Date(), b.date, "'" + b.start, b.people, day.kind, kind, b.name, b.email, b.phone,
      b.interest, b.payment, b.message, token, cell, text
    ]);
    result = { ok: true, kind: kind, date: b.date, start: b.start, people: b.people, range: timeRange(b.start, b.people), token: token, day: day };
  } finally {
    lock.releaseLock();
  }

  sendBookingEmails(b, result);
  return json({ ok: true, kind: result.kind, date: result.date, range: result.range, people: result.people });
}

/** Put the booking in the first empty cell of that day's intro-flight block. Returns its A1 address, or ''. */
function writeToSchedule(sched, grid, days, date, text) {
  var d = null;
  days.forEach(function (x) { if (x.date === date) d = x; });
  if (!d || d.introRow < 0) return '';
  for (var r = d.introRow + 1; r < grid.length + 20; r++) {
    var v = r < grid.length ? String(grid[r][d.col] || '') : '';
    if (/sign-?\s*up\s+below/i.test(v)) return ''; // block is full
    if (!v.trim()) {
      var range = sched.getRange(r + 1, d.col + 1);
      range.setValue(text);
      return range.getA1Notation();
    }
  }
  return '';
}

function niceDate(iso) {
  return Utilities.formatDate(new Date(iso + 'T12:00:00Z'), 'UTC', 'EEEE MMMM d');
}

function sendBookingEmails(b, r) {
  var cancelUrl = ScriptApp.getService().getUrl() + '?action=cancel&token=' + encodeURIComponent(r.token);
  var when = niceDate(r.date) + ', ' + r.range + (r.people > 1 ? ' (' + r.people + ' people)' : '');
  var held = r.kind === 'Held';
  MailApp.sendEmail({
    to: b.email,
    replyTo: prop('CLUB_EMAIL'),
    name: 'Prince Albert Gliding and Soaring Club',
    subject: (held ? 'You are pencilled in for a Discovery Flight: ' : 'Your Discovery Flight request: ') + when,
    body: [
      'Hi ' + b.name.split(/\s+/)[0] + ',',
      '',
      held
        ? 'We have pencilled you in: ' + when + '.'
        : 'We have your request for ' + when + '. Weekday flying depends on who is free, so a club member will email you to confirm.',
      '',
      'Gliding depends on the weather and on volunteers, so this is not a guaranteed time. We will email you if the day changes. Check the day is on before you leave home, and arrive when we tell you.',
      '',
      'Need a different day? Cancel here and book again:',
      cancelUrl,
      '',
      'Bring a hat, sunscreen, water, layers and a way to pay if you have not paid online.',
      '',
      'Prince Albert Gliding and Soaring Club'
    ].join('\n')
  });
  MailApp.sendEmail({
    to: prop('CLUB_EMAIL'),
    replyTo: b.email,
    subject: (held ? 'Guest pencilled in: ' : 'Weekday request: ') + b.name + ', ' + when,
    body: [
      (held ? 'A guest pencilled in a slot on the website.' : 'A weekday request came in on the website. Please confirm or decline by replying.'),
      '',
      'When: ' + when,
      'Name: ' + b.name,
      'Email: ' + b.email,
      'Phone: ' + b.phone,
      'Interest: ' + b.interest,
      'Payment: ' + b.payment,
      'Message: ' + (b.message || '(none)'),
      '',
      'It is in the "' + BOOKING.TAB + '" tab and on the Flying Schedule.'
    ].join('\n')
  });
}

function cancelBooking(token) {
  token = String(token || '');
  var page = function (title, body) {
    return HtmlService.createHtmlOutput('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title><div style="font-family:sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem"><h1>' + title + '</h1>' + body + '</div>');
  };
  if (!/^[0-9a-f-]{36}$/i.test(token)) return page('Booking not found', '<p>That link is not valid.</p>');
  var sh = sheet(BOOKING.TAB, BOOKING.HEADERS);
  var rows = sh.getDataRange().getValues();
  var origin = ((PropertiesService.getScriptProperties().getProperty('SITE_ORIGINS') || 'https://www.pagsc.ca').split(',')[0]).trim();
  var again = '<p><a href="' + origin + '/discovery-flight/#request">Book another day</a></p>';
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][12] !== token) continue;
    if (rows[i][5] === 'Cancelled') return page('Already cancelled', again);
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      sh.getRange(i + 1, 6).setValue('Cancelled');
      var a1 = rows[i][13], text = rows[i][14];
      if (a1) {
        var cell = scheduleSheet().getRange(a1);
        if (String(cell.getDisplayValue()) === String(text)) cell.clearContent();
      }
    } finally {
      lock.releaseLock();
    }
    MailApp.sendEmail({
      to: prop('CLUB_EMAIL'),
      subject: 'Guest cancelled: ' + rows[i][6] + ', ' + isoOf(rows[i][1]) + ' ' + hhmmOf(rows[i][2]),
      body: rows[i][6] + ' cancelled their website booking. The slot is free again.'
    });
    return page('Your booking is cancelled', '<p>The spot is free for someone else. Pick another day when it suits you.</p>' + again);
  }
  return page('Booking not found', '<p>We could not find that booking.</p>' + again);
}
