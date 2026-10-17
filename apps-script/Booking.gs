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
  // Capacity. A day has 12 half-hour slots; each student on the schedule takes STUDENT_COST of them.
  // Weekends share WEEKEND_CAP guest flights across Saturday and Sunday, limited by each day's room.
  STUDENT_COST: 3,       // half-hour slots per student (1.5 hours)
  WEEKEND_CAP: 8,        // guest flights per weekend, Saturday and Sunday combined
  MAX_GROUP: 4,          // people per booking
  DAYS_AHEAD: 28,
  SAME_DAY_LEAD: 60,     // on a day opened to the standby list, book the same day up to this many minutes before a start time
  TZ: 'America/Regina',
  TAB: 'Bookings',
  REMIND_HOUR: 9,        // week and 3-day reminders go out from this hour (field time)
  DAY_BEFORE_HOUR: 16,   // the day-before reminder goes out from this hour, after most status updates
  STATUS_DAYS: 7,        // status-change emails for bookings this many days out or fewer
  CAPS_TAB: 'Guest caps',
  HEADERS: ['Received', 'Date', 'Start', 'People', 'Kind', 'Status', 'Name', 'Email', 'Phone',
    'Interest', 'Payment', 'Message', 'Token', 'Schedule cell', 'Schedule text', 'Reminders sent', 'Last status', 'Certificates',
    'Either weekend day', 'Moved from', 'Move confirmed']
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
  if (/\b(a go|is go|go for|good to go|flying (is )?on|day is on|we('re| are) flying|on for|confirmed|discovery flights? (are )?(now )?(available|open))\b/.test(t)) return 'on';
  return 'unknown';
}

/**
 * Has the club opened the day to Discovery Flight guests? The Status / Comments text says so with
 * "Discovery flights available" (or "open"), optionally with the number of guest flights that day in
 * total, counting those already booked: "Discovery flights available: 4". A cancellation overrides it.
 * Opening a day lets guests paying at the field book it and emails the standby list.
 * @returns null if not open, else {spots: number or null}
 */
function guestOpening(text) {
  var t = String(text || '').toLowerCase();
  if (classifyStatus(t) === 'cancelled') return null;
  var m = /discovery flights?\s*(?:are\s+)?(?:now\s+)?(?:available|open)\b(?:\s*[:(,\-–—]?\s*(\d{1,2})\b)?/.exec(t);
  if (!m) return null;
  var before = /(\d{1,2})\s+discovery flights?\s*(?:are\s+)?(?:now\s+)?(?:available|open)/.exec(t);
  var n = m[1] || (before && before[1]);
  return { spots: n ? Number(n) : null };
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
 * @param nowMin minutes since midnight on the field. When given, today is included if it is open to
 *   guests (guestOpening), with start times less than SAME_DAY_LEAD minutes away taken.
 */
function computeAvailability(days, bookings, caps, today, nowMin) {
  var times = slotTimes();
  var first = addDays(today, 1), last = addDays(today, BOOKING.DAYS_AHEAD);
  var sameDay = nowMin != null;
  var out = [];
  // Guest flights per date (website bookings plus guests the club typed on the schedule), for weekend totals.
  var usedByDate = {};
  bookings.forEach(function (b) { usedByDate[b.date] = (usedByDate[b.date] || 0) + b.people; });
  days.forEach(function (d) {
    (d.manual || []).forEach(function (e) { usedByDate[d.date] = (usedByDate[d.date] || 0) + e.people; });
  });
  var capFor = function (date) { return caps && caps[date] != null && caps[date] !== '' ? Number(caps[date]) : null; };
  days.forEach(function (d) {
    var isToday = d.date === today;
    var opening = guestOpening(d.statusText);
    if (isToday ? !(sameDay && opening) : d.date < first || d.date > last) return;
    var wd = weekdayOf(d.date);
    var taken = {};
    if (isToday) times.forEach(function (t, i) { if (toMinutes(t) < nowMin + BOOKING.SAME_DAY_LEAD) taken[i] = true; });
    bookings.concat((d.manual || []).map(function (e) { return { date: d.date, start: e.start, people: e.people }; })).forEach(function (b) {
      if (b.date !== d.date) return;
      var i = times.indexOf(b.start);
      for (var k = 0; k < b.people; k++) if (i + k >= 0 && i + k < times.length) taken[i + k] = true;
    });
    var used = usedByDate[d.date] || 0;
    var room = times.length - BOOKING.STUDENT_COST * (d.students || 0) - used;
    var remaining;
    if (wd === 0 || wd === 6) {
      var partner = weekendPartner(d.date);
      var weekendCap = capFor(d.date) != null ? capFor(d.date) : capFor(partner) != null ? capFor(partner) : BOOKING.WEEKEND_CAP;
      remaining = Math.min(weekendCap - used - (usedByDate[partner] || 0), room);
    } else {
      remaining = (capFor(d.date) != null ? capFor(d.date) : times.length) - BOOKING.STUDENT_COST * (d.students || 0) - used;
    }
    if (opening && opening.spots != null) remaining = Math.min(remaining, opening.spots - used);
    if (isToday) remaining = Math.min(remaining, times.filter(function (t, i) { return !taken[i]; }).length);
    out.push({
      date: d.date,
      kind: wd === 0 || wd === 6 ? 'weekend' : 'weekday',
      status: classifyStatus(d.statusText),
      open: !!opening,
      statusText: d.statusText,
      remaining: Math.max(0, remaining),
      // Counts only (no names), so the club can see why a day shows full: students on the schedule,
      // guest flights that day (website bookings plus guests typed on the schedule) and the limit used.
      students: d.students || 0,
      guests: used,
      limit: wd === 0 || wd === 6 ? weekendCap : capFor(d.date),
      slots: times.map(function (t, i) { return { time: t, free: !taken[i] }; })
    });
  });
  out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  return out;
}

/**
 * The next flying days for the home page: today onward, weekends plus any day with a status posted,
 * each with its status text, instructor sign-up and (when bookable online) guest spots left.
 * @param days from scheduleDays()  @param avail from computeAvailability()  @param today ISO date
 */
function upcomingDays(days, avail, today, limit) {
  var byDate = {};
  avail.forEach(function (a) { byDate[a.date] = a; });
  return days
    .filter(function (d) {
      if (d.date < today) return false;
      var wd = weekdayOf(d.date);
      return wd === 0 || wd === 6 || !!d.statusText;
    })
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; })
    .slice(0, limit || 4)
    .map(function (d) {
      var a = byDate[d.date];
      var wd = weekdayOf(d.date);
      return {
        date: d.date,
        kind: wd === 0 || wd === 6 ? 'weekend' : 'weekday',
        status: classifyStatus(d.statusText),
        statusText: d.statusText,
        instructor: !!d.instructor,
        remaining: a ? a.remaining : null // null: today, or outside the booking window
      };
    });
}

/** The other day of the same weekend: Saturday -> Sunday, Sunday -> Saturday; null on weekdays. */
function weekendPartner(iso) {
  var wd = weekdayOf(iso);
  return wd === 6 ? addDays(iso, 1) : wd === 0 ? addDays(iso, -1) : null;
}

/**
 * Where a flexible weekend booking goes when its day is cancelled: the other day of the weekend,
 * at the same start time if free, otherwise the nearest time that fits. Null if the other day is
 * not bookable (past, outside the window, cancelled or full).
 * @param b {date, start, people}  @param availByDate {date: availability day}
 */
function planWeekendMove(b, availByDate) {
  var partner = weekendPartner(b.date);
  var a = partner && availByDate[partner];
  if (!a || a.status === 'cancelled') return null;
  var want = toMinutes(b.start);
  var times = a.slots.map(function (s) { return s.time; }).sort(function (x, y) {
    return Math.abs(toMinutes(x) - want) - Math.abs(toMinutes(y) - want) || toMinutes(x) - toMinutes(y);
  });
  for (var i = 0; i < times.length; i++) {
    if (canBook(a, times[i], b.people) === '') return { date: partner, start: times[i] };
  }
  return null;
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
  if (p.action === 'days') return json(daysResponse());
  if (p.action === 'cancel') return cancelBooking(p.token);
  if (p.action === 'confirm') return confirmMove(p.token);
  if (p.action === 'voucher') return json(voucherResponse(p.session_id));
  if (p.action === 'standby-off') return standbyOff(p.token);
  return HtmlService.createHtmlOutput('PAGSC website endpoint.');
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function todayOnField() {
  return Utilities.formatDate(new Date(), BOOKING.TZ, 'yyyy-MM-dd');
}

/** Minutes since midnight on the field. */
function nowOnField() {
  var now = new Date();
  return Number(Utilities.formatDate(now, BOOKING.TZ, 'H')) * 60 + Number(Utilities.formatDate(now, BOOKING.TZ, 'm'));
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

function daysResponse() {
  try {
    var days = scheduleDays(scheduleSheet().getDataRange().getDisplayValues());
    var today = todayOnField();
    var avail = computeAvailability(days, activeBookings(), guestCaps(), today, nowOnField());
    return { ok: true, updated: new Date().toISOString(), days: upcomingDays(days, avail, today, 4) };
  } catch (err) {
    return { ok: false, error: 'unavailable' };
  }
}

function availabilityResponse() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(AVAILABILITY_CACHE);
  if (hit) return JSON.parse(hit);
  try {
    var days = scheduleDays(scheduleSheet().getDataRange().getDisplayValues());
    var out = { ok: true, days: computeAvailability(days, activeBookings(), guestCaps(), todayOnField(), nowOnField()) };
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
    codes: [],
    flexible: p.flexible === 'yes' ? 'Yes' : p.flexible === 'no' ? 'No' : ''
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
    var avail = computeAvailability(days, activeBookings(), guestCaps(), todayOnField(), nowOnField());
    var day = null;
    avail.forEach(function (d) { if (d.date === b.date) day = d; });
    var why = canBook(day, b.start, b.people);
    if (why) return json({ ok: false, error: why, refresh: true });
    // Weekend spots are held only for paid flights until the club opens the day to the standby list
    // ("Discovery flights available" in the Status row); then anyone can book.
    if (day.kind === 'weekend' && !prepaid && !day.open) {
      return json({ ok: false, error: 'Weekend spots are for paid flights until the club opens the day to the standby list. Buy a flight to book now, or choose "pay at the field" to join the standby list.' });
    }
    var codeCheck = checkCodes(b.codes, b.people);
    if (codeCheck.error) return json({ ok: false, error: codeCheck.error });

    var partner = weekendPartner(b.date);
    var partnerDay = null;
    days.forEach(function (d) { if (d.date === partner) partnerDay = d; });
    if (partnerDay && classifyStatus(partnerDay.statusText) !== 'cancelled' && !b.flexible) {
      return json({ ok: false, error: 'Please tell us whether the other day of that weekend would also work.' });
    }
    var kind = day.kind === 'weekend' ? 'Held' : 'Requested';
    var token = Utilities.getUuid();
    var first = b.name.split(/\s+/)[0];
    var text = scheduleText(kind, first, b.start, b.people, b.flexible === 'Yes' ? partner : null);
    var cell = writeToSchedule(sched, grid, days, b.date, text);

    bookingsSheet().appendRow([
      new Date(), b.date, "'" + b.start, b.people, day.kind, kind, b.name, b.email, b.phone,
      b.interest, b.payment, b.message, token, cell, text, '', day.statusText, b.codes.join(', '),
      b.flexible, '', ''
    ]);
    markCodesBooked(codeCheck.rows, token, b.date);
    clearAvailabilityCache();
    result = { ok: true, kind: kind, date: b.date, start: b.start, people: b.people, range: timeRange(b.start, b.people), token: token, day: day };
  } finally {
    lock.releaseLock();
  }

  sendBookingEmails(b, result);
  try { standbyBooked(b.email); } catch (err) { /* the booking stands; the standby row can be tidied by hand */ }
  return json({ ok: true, kind: result.kind, date: result.date, range: result.range, people: result.people });
}

/** "Jane 13:30 (2) web (or Sun)": first name and time only; the note shows the other weekend day works. */
function scheduleText(kind, first, start, people, orDate) {
  var or = orDate ? ' (or ' + DAY_NAMES[weekdayOf(orDate)].slice(0, 3) + ')' : '';
  return (kind === 'Requested' ? 'Request: ' : '') + first + ' ' + start + (people > 1 ? ' (' + people + ')' : '') + ' web' + or;
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
    confirm: ScriptApp.getService().getUrl() + '?action=confirm&token=' + encodeURIComponent(token),
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

/**
 * Move a flexible weekend booking (sheet row index i) to the other day of the weekend.
 * Clears its schedule cell, writes the new one, updates the row and certificates, emails the guest
 * to confirm and tells the club. Returns true if it moved.
 */
function moveBookingRow(sh, rows, i, availByDate) {
  var r = rows[i];
  var b = { date: isoOf(r[1]), start: hhmmOf(r[2]), people: Number(r[3]) || 1, name: String(r[6]), email: String(r[7]) };
  var to = planWeekendMove(b, availByDate);
  if (!to) return false;
  var sched = scheduleSheet();
  var a1 = r[13], oldText = r[14];
  if (a1) {
    var cell = sched.getRange(a1);
    if (String(cell.getDisplayValue()) === String(oldText)) cell.clearContent();
  }
  var grid = sched.getDataRange().getDisplayValues();
  var days = scheduleDays(grid);
  var text = scheduleText('Held', b.name.split(/\s+/)[0], to.start, b.people, null);
  var newCell = writeToSchedule(sched, grid, days, to.date, text);
  var newStatus = '';
  days.forEach(function (d) { if (d.date === to.date) newStatus = d.statusText; });
  var col = function (name) { return BOOKING.HEADERS.indexOf(name) + 1; };
  sh.getRange(i + 1, col('Date')).setValue(to.date);
  sh.getRange(i + 1, col('Start')).setValue("'" + to.start);
  sh.getRange(i + 1, col('Schedule cell')).setValue(newCell);
  sh.getRange(i + 1, col('Schedule text')).setValue(text);
  sh.getRange(i + 1, col('Last status')).setValue(newStatus);
  sh.getRange(i + 1, col('Moved from')).setValue(b.date + ' ' + b.start);
  sh.getRange(i + 1, col('Move confirmed')).setValue('Waiting');
  moveCodesDate(String(r[12]), to.date);
  clearAvailabilityCache();
  var moved = { name: b.name, date: to.date, start: to.start, people: b.people };
  sendGuestEmail(b.email, moveEmail(moved, b.date, emailLinks(String(r[12]))));
  MailApp.sendEmail({
    to: prop('CLUB_EMAIL'),
    replyTo: b.email,
    subject: 'Guest moved to ' + longDate(to.date) + ': ' + b.name,
    body: b.name + ' was booked for ' + whenText(b) + ', which is now cancelled. They said either weekend day works, so they are now pencilled in for ' +
      whenText(moved) + ' and have been asked to confirm. The Bookings tab shows "Move confirmed".'
  });
  return true;
}

/** The guest's "Yes, see you then" link after a move. */
function confirmMove(token) {
  token = String(token || '');
  var calendar = siteOrigin() + '/discovery-flight/#request';
  if (!/^[0-9a-f-]{36}$/i.test(token)) return HtmlService.createHtmlOutput(cancelPageHtml('Booking not found', 'That link is not valid.', calendar));
  var sh = bookingsSheet();
  var rows = sh.getDataRange().getValues();
  var col = function (name) { return BOOKING.HEADERS.indexOf(name) + 1; };
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][12] !== token) continue;
    if (rows[i][5] === 'Cancelled') return HtmlService.createHtmlOutput(cancelPageHtml('This booking was cancelled', 'Pick another day whenever it suits you.', calendar));
    sh.getRange(i + 1, col('Move confirmed')).setValue('Yes');
    var b = { date: isoOf(rows[i][1]), start: hhmmOf(rows[i][2]), people: Number(rows[i][3]) || 1 };
    return HtmlService.createHtmlOutput(cancelPageHtml('Thanks, see you ' + DAY_NAMES[weekdayOf(b.date)], 'You are pencilled in for ' + whenText(b) + '. We will send a reminder the day before with the latest from the field.', ''));
  }
  return HtmlService.createHtmlOutput(cancelPageHtml('Booking not found', 'We could not find that booking.', calendar));
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
