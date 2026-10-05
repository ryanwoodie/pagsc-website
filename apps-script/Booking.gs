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
 *   - handles GET ?action=cancel&token=… from the guest's email,
 *   - checks certificate codes (Vouchers.gs) for bookings paid online or given as a gift.
 *
 * Weekend bookings are pencilled in right away; weekday bookings are requests a member confirms.
 * Neither is a guarantee: flying depends on weather and volunteers.
 *
 * Guests the club types straight into a day's intro-flight block count too: "Jane 1:30 (2)" takes the
 * 1:30 and 2:00 slots; a name with no time takes one spot that day without a set time ("+1" or "(2)"
 * for more people). Entries ending in "web" were written by this script and are counted from the
 * Bookings tab instead.
 *
 * Optional Script Property: SCHEDULE_ID (defaults to the Flying Schedule below).
 * Optional tab "Guest caps" in the requests sheet: Date (yyyy-mm-dd) | Cap, to change one day's cap.
 */

var BOOKING = {
  FIRST: '11:00',        // first start time
  LAST: '16:30',         // last start time; every booking must finish by 17:00
  STEP: 30,              // minutes per person
  // Guest spots per day: every half-hour slot (12), less STUDENT_COST per student on the schedule.
  STUDENT_COST: 2,       // guest spots each student signed up on the schedule takes away
  MAX_GROUP: 4,          // people per booking
  DAYS_AHEAD: 28,
  TZ: 'America/Regina',
  TAB: 'Bookings',
  REMIND_HOUR: 9,        // week and 3-day reminders go out from this hour (field time)
  DAY_BEFORE_HOUR: 16,   // the day-before reminder goes out from this hour, after most status updates
  STATUS_DAYS: 7,        // status-change emails for bookings this many days out or fewer
  CAPS_TAB: 'Guest caps',
  HEADERS: ['Received', 'Date', 'Start', 'People', 'Kind', 'Status', 'Name', 'Email', 'Phone',
    'Interest', 'Payment', 'Message', 'Token', 'Schedule cell', 'Schedule text', 'Reminders sent', 'Last status', 'Certificates']
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
 * A guest typed into the intro-flight block by hand: {start: 'HH:MM' or '', people}, or null for
 * a booking this script wrote (ends in "web"). Times without am/pm are read as flying hours:
 * 11 and 12 as morning and noon, 1 to 10 as afternoon. Off-slot times round down to the half hour.
 */
function manualEntry(text) {
  var t = String(text || '').trim();
  if (!t || /\bweb\s*$/i.test(t)) return null;
  var people = 1, m;
  if ((m = /\((\d{1,2})\)/.exec(t))) people = Number(m[1]);
  else if ((m = /\bx\s*(\d{1,2})\b/i.exec(t))) people = Number(m[1]);
  else if ((m = /\+\s*(\d{1,2})\b/.exec(t))) people = Number(m[1]) + 1;
  people = Math.max(1, Math.min(people, 12));
  var start = '';
  var tm = /\b(\d{1,2})(?::(\d{2})\s*([ap])?\.?m?\.?|\s*([ap])\.?m\.?)(?![\w])/i.exec(t.replace(/\(\d{1,2}\)/g, ''));
  if (tm) {
    var h = Number(tm[1]), min = Number(tm[2] || 0), ap = (tm[3] || tm[4] || '').toLowerCase();
    if (ap === 'p' && h < 12) h += 12;
    else if (ap === 'a' && h === 12) h = 0;
    else if (!ap && h >= 1 && h <= 10) h += 12;
    var n = h * 60 + min;
    n -= (n - toMinutes(BOOKING.FIRST)) % BOOKING.STEP;
    if (min < 60 && n >= toMinutes(BOOKING.FIRST) && n <= toMinutes(BOOKING.LAST)) start = fromMinutes(n);
  }
  return { start: start, people: people };
}

/**
 * Pull the dates, status text and intro-block row for each column of the schedule grid.
 * @param {string[][]} grid display values of the schedule's first tab
 */
function scheduleDays(grid) {
  var days = [];
  if (!grid || !grid.length) return days;
  var statusRow = -1, weatherRow = -1;
  for (var r = 0; r < grid.length; r++) {
    var first = String(grid[r][0] || '').trim();
    if (statusRow < 0 && /^status/i.test(first)) statusRow = r;
    if (weatherRow < 0 && /weather|forecast/i.test(first)) weatherRow = r;
  }
  if (weatherRow < 0 && grid.length > 1) weatherRow = 1; // row 2 holds the forecast
  for (var c = 1; c < grid[0].length; c++) {
    var date = parseSheetDate(grid[0][c]);
    if (!date) continue;
    var introRow = -1;
    for (var r2 = 1; r2 < grid.length; r2++) {
      if (/intro\s*fam\s*flight\s*sign-?\s*up/i.test(String(grid[r2][c] || ''))) { introRow = r2; break; }
    }
    var manual = [];
    if (introRow >= 0) {
      for (var r7 = introRow + 1; r7 < grid.length; r7++) {
        var cell = String(grid[r7][c] || '');
        if (/sign-?\s*up\s+below/i.test(cell)) break;
        var entry = manualEntry(cell);
        if (entry) manual.push(entry);
      }
    }
    var students = 0;
    for (var r5 = 1; r5 < grid.length; r5++) {
      if (!/student\/?\s*pilots?\s+sign-?\s*up\s+below/i.test(String(grid[r5][c] || ''))) continue;
      for (var r6 = r5 + 1; r6 < grid.length; r6++) {
        var sv = String(grid[r6][c] || '').trim();
        if (/sign-?\s*up\s+below/i.test(sv)) break;
        if (sv) students++;
      }
      break;
    }
    var instructor = false;
    for (var r3 = 1; r3 < grid.length; r3++) {
      if (!/instructors?\s+sign-?\s*up\s+below/i.test(String(grid[r3][c] || ''))) continue;
      for (var r4 = r3 + 1; r4 < grid.length; r4++) {
        var v = String(grid[r4][c] || '').trim();
        if (/sign-?\s*up\s+below/i.test(v)) break;
        if (v) { instructor = true; break; }
      }
      break;
    }
    days.push({
      date: date,
      col: c,
      introRow: introRow,
      statusText: statusRow >= 0 ? String(grid[statusRow][c] || '').replace(/\s+/g, ' ').trim().slice(0, 160) : '',
      students: students,
      manual: manual,
      weather: weatherRow >= 0 && weatherRow !== statusRow ? String(grid[weatherRow][c] || '').replace(/\s+/g, ' ').trim().slice(0, 200) : '',
      instructor: instructor
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
    bookings.concat((d.manual || []).map(function (e) { return { date: d.date, start: e.start, people: e.people }; })).forEach(function (b) {
      if (b.date !== d.date) return;
      var i = times.indexOf(b.start);
      for (var k = 0; k < b.people; k++) if (i + k >= 0 && i + k < times.length) taken[i + k] = true;
      used += b.people;
    });
    var cap = (caps && caps[d.date] != null ? Number(caps[d.date]) : times.length) - BOOKING.STUDENT_COST * (d.students || 0);
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

/** Whole days from a to b (ISO dates). */
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
}

/**
 * Which reminder, if any, is due now.
 * Booked more than a week ahead: a week before and the day before.
 * Booked 4 to 7 days ahead: 3 days before and the day before. Otherwise: the day before.
 * @param lead days between booking and flight
 * @param daysUntil days from today (field time) to the flight
 * @param hour current hour on the field
 * @param sent e.g. "7,1"
 * @returns '7' | '3' | '1' | ''
 */
function reminderDue(lead, daysUntil, hour, sent) {
  var done = String(sent || '').split(',');
  var has = function (k) { return done.indexOf(k) >= 0; };
  if (daysUntil === 1 && hour >= BOOKING.DAY_BEFORE_HOUR && !has('1')) return '1';
  if (hour < BOOKING.REMIND_HOUR) return '';
  if (lead > 7 && daysUntil <= 7 && daysUntil >= 2 && !has('7')) return '7';
  if (lead > 3 && lead <= 7 && daysUntil <= 3 && daysUntil >= 2 && !has('3')) return '3';
  return '';
}

/** Should the guest hear about a status change? Only for real changes to a non-empty status, within a week. */
function statusChangeDue(lastStatus, currentStatus, daysUntil, hour) {
  var cur = String(currentStatus || '').trim();
  if (!cur || cur === String(lastStatus || '').trim()) return false;
  if (daysUntil < 0 || daysUntil > BOOKING.STATUS_DAYS) return false;
  if (daysUntil === 0 && hour >= 15) return false; // too late in the day to matter
  return true;
}

// ---------- Google services ----------

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'availability') return json(availabilityResponse());
  if (p.action === 'cancel') return cancelBooking(p.token);
  if (p.action === 'voucher') return json(voucherResponse(p.session_id));
  return HtmlService.createHtmlOutput('PAGSC website endpoint.');
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function todayOnField() {
  return Utilities.formatDate(new Date(), BOOKING.TZ, 'yyyy-MM-dd');
}

// The Flying Schedule (public). A SCHEDULE_ID Script Property overrides it.
var DEFAULT_SCHEDULE_ID = '18n3c3T0eJh9exZWXCKhG1IhYb_GXY45IwfDZP-xshwc';

function scheduleSheet() {
  var id = PropertiesService.getScriptProperties().getProperty('SCHEDULE_ID') || DEFAULT_SCHEDULE_ID;
  return SpreadsheetApp.openById(id).getSheets()[0];
}

function activeBookings() {
  var rows = bookingsSheet().getDataRange().getValues().slice(1);
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

var AVAILABILITY_CACHE = 'availability';
var AVAILABILITY_SECONDS = 60; // edits to the schedule show within a minute; bookings clear it at once

function availabilityResponse() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(AVAILABILITY_CACHE);
  if (hit) return JSON.parse(hit);
  try {
    var days = scheduleDays(scheduleSheet().getDataRange().getDisplayValues());
    var out = { ok: true, days: computeAvailability(days, activeBookings(), guestCaps(), todayOnField()) };
    try { cache.put(AVAILABILITY_CACHE, JSON.stringify(out), AVAILABILITY_SECONDS); } catch (e) { /* too big to cache */ }
    return out;
  } catch (err) {
    return { ok: false, error: 'unavailable' };
  }
}

function clearAvailabilityCache() {
  CacheService.getScriptCache().remove(AVAILABILITY_CACHE);
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
    weightOk: p.weight_ok === 'yes',
    codes: []
  };
  var prepaid = b.payment === 'Paid online' || b.payment === 'Gift';
  var problems = [];
  if (!b.name) problems.push('your name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) problems.push('a valid email address');
  if (!/\d{3}.*\d{4}/.test(b.phone)) problems.push('a phone number');
  if (!b.weightOk) problems.push('the weight confirmation');
  if (problems.length) return json({ ok: false, error: 'We still need ' + problems.join(', ') + '.' });
  if (prepaid) {
    var parsed = parseCodes(p.codes);
    if (parsed.bad.length) return json({ ok: false, error: '"' + clean(parsed.bad[0]) + '" is not a certificate code. Codes look like PAGSC-7KQ2-XM9D.' });
    b.codes = parsed.codes.slice(0, VOUCHER.MAX_CODES + 1);
  }

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
    var codeCheck = checkCodes(b.codes, b.people);
    if (codeCheck.error) return json({ ok: false, error: codeCheck.error });

    var kind = day.kind === 'weekend' ? 'Held' : 'Requested';
    var token = Utilities.getUuid();
    var first = b.name.split(/\s+/)[0];
    var text = (kind === 'Requested' ? 'Request: ' : '') + first + ' ' + b.start + (b.people > 1 ? ' (' + b.people + ')' : '') + ' web';
    var cell = writeToSchedule(sched, grid, days, b.date, text);

    bookingsSheet().appendRow([
      new Date(), b.date, "'" + b.start, b.people, day.kind, kind, b.name, b.email, b.phone,
      b.interest, b.payment, b.message, token, cell, text, '', day.statusText, b.codes.join(', ')
    ]);
    markCodesBooked(codeCheck.rows, token, b.date);
    clearAvailabilityCache();
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

function siteOrigin() {
  return ((PropertiesService.getScriptProperties().getProperty('SITE_ORIGINS') || 'https://www.pagsc.ca').split(',')[0]).trim();
}

/** Links used in every guest email. */
function emailLinks(token) {
  var site = siteOrigin();
  return {
    cancel: ScriptApp.getService().getUrl() + '?action=cancel&token=' + encodeURIComponent(token),
    calendar: site + '/discovery-flight/#request',
    site: site,
    email: prop('CLUB_EMAIL'),
    phone: '(306) 222-5684'
  };
}

function sendGuestEmail(to, mail) {
  MailApp.sendEmail({ to: to, replyTo: prop('CLUB_EMAIL'), name: EMAIL.CLUB, subject: mail.subject, body: mail.text, htmlBody: mail.html });
}

function sendBookingEmails(b, r) {
  var held = r.kind === 'Held';
  sendGuestEmail(b.email, confirmationEmail(b, held, emailLinks(r.token)));
  var when = whenText(b);
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
      'Payment: ' + b.payment + paymentNote(b),
      'Message: ' + (b.message || '(none)'),
      '',
      'It is in the "' + BOOKING.TAB + '" tab and on the Flying Schedule. The guest gets reminders before the day and an email when the day\'s status changes.'
    ].join('\n')
  });
}

/** For the club: which certificates cover the booking, and how many people still need to pay. */
function paymentNote(b) {
  if (b.payment !== 'Paid online' && b.payment !== 'Gift') return '';
  var rest = b.people - b.codes.length;
  if (!b.codes.length) return ' (no certificate code given: check how they paid)';
  return ' (certificate' + (b.codes.length > 1 ? 's ' : ' ') + b.codes.join(', ') + (rest > 0 ? '; ' + rest + ' more to pay or check' : '') + ')';
}

/** The Bookings tab, with header cells for any columns added since it was created. */
function bookingsSheet() {
  var sh = sheet(BOOKING.TAB, BOOKING.HEADERS);
  if (sh.getLastColumn() < BOOKING.HEADERS.length) sh.getRange(1, 1, 1, BOOKING.HEADERS.length).setValues([BOOKING.HEADERS]);
  return sh;
}

function cancelBooking(token) {
  token = String(token || '');
  var calendar = siteOrigin() + '/discovery-flight/#request';
  var page = function (title, message, showCalendar) {
    return HtmlService.createHtmlOutput(cancelPageHtml(title, message, showCalendar ? calendar : ''));
  };
  if (!/^[0-9a-f-]{36}$/i.test(token)) return page('Booking not found', 'That link is not valid.', true);
  var sh = bookingsSheet();
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][12] !== token) continue;
    if (rows[i][5] === 'Cancelled') return page('Already cancelled', 'This booking was already cancelled.', true);
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      sh.getRange(i + 1, 6).setValue('Cancelled');
      releaseCodes(token);
      clearAvailabilityCache();
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
      subject: 'Guest cancelled: ' + rows[i][6] + ', ' + longDate(isoOf(rows[i][1])) + ' at ' + clock12(hhmmOf(rows[i][2])),
      body: rows[i][6] + ' cancelled their website booking. The slot is free again.'
    });
    return page('Your booking is cancelled', 'The spot is free for someone else. Pick another day whenever it suits you.', true);
  }
  return page('Booking not found', 'We could not find that booking.', true);
}
