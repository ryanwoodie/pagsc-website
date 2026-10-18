/**
 * Booking reminders, status-change and standby emails, run every RUN_MINUTES by a time-driven trigger.
 * Each run only sends what is due and records it, so running often never repeats an email.
 *
 * Reminders (see reminderDue in Booking.gs): a week before for bookings made more than a week ahead,
 * 3 days before for bookings made 4 to 7 days ahead, and the day before (late afternoon) for everyone.
 * Each one shows the day's current status, forecast and whether an instructor has signed up.
 * When a day's Status / Comments text changes, guests booked within the next week get an email.
 *
 * One-time setup, in the Apps Script editor: choose installReminders in the function list and Run.
 * Google asks to approve running on a schedule; approve as the club account.
 */

var RUN_MINUTES = 10; // Apps Script allows 1, 5, 10, 15 or 30

/** Run once from the editor. Safe to run again: it replaces the existing trigger. */
function installReminders() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runReminders').timeBased().everyMinutes(RUN_MINUTES).create();
  Logger.log('Reminders installed: every ' + RUN_MINUTES + ' minutes.');
}

function runReminders() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var now = new Date();
    var today = Utilities.formatDate(now, BOOKING.TZ, 'yyyy-MM-dd');
    var hour = Number(Utilities.formatDate(now, BOOKING.TZ, 'H'));
    var byDate = {};
    scheduleDays(scheduleSheet().getDataRange().getDisplayValues()).forEach(function (d) { byDate[d.date] = d; });

    var sh = bookingsSheet();
    var rows = sh.getDataRange().getValues();
    var flexCol = BOOKING.HEADERS.indexOf('Either weekend day'), movedCol = BOOKING.HEADERS.indexOf('Moved from');
    var waiverCol = BOOKING.HEADERS.indexOf('Waiver key');
    var followCol = BOOKING.HEADERS.indexOf('Follow-up sent');
    var availByDate = null;
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      if (!r[1] || r[5] === 'Cancelled') continue;
      var b = { date: isoOf(r[1]), start: hhmmOf(r[2]), people: Number(r[3]) || 1, name: String(r[6]), email: String(r[7]),
        waiversSigned: Number(r[waiverCol + 1]) || 0 };
      var daysUntil = daysBetween(today, b.date);
      var day = byDate[b.date] || { statusText: '', weather: '', instructor: false };
      if (thankYouDue(String(r[5]), daysUntil, hour, classifyStatus(day.statusText), r[followCol])) {
        sendThankYou(sh, i, r, b);
        continue;
      }
      if (daysUntil < 0) continue;
      var held = r[5] === 'Held' || r[5] === 'Confirmed';

      // Flexible weekend guests move to the other day when theirs is cancelled (not on two-day weekends).
      if (held && r[flexCol] === 'Yes' && !r[movedCol] && classifyStatus(day.statusText) === 'cancelled') {
        if (!availByDate) {
          availByDate = {};
          computeAvailability(scheduleDays(scheduleSheet().getDataRange().getDisplayValues()), activeBookings(), guestCaps(), today)
            .forEach(function (a) { availByDate[a.date] = a; });
        }
        if (moveBookingRow(sh, rows, i, availByDate)) {
          availByDate = null; // spots changed; recompute for the next guest
          continue;
        }
      }
      var links = emailLinks(String(r[12]), String(r[waiverCol] || ''));
      links.late = minutesUntil(b.date, b.start, today, nowOnField()) < SELF_CANCEL_MINUTES && classifyStatus(day.statusText) !== 'cancelled';
      var lead = daysBetween(isoOf(r[0]), b.date);
      var sent = String(r[15] || '');

      var due = reminderDue(lead, daysUntil, hour, sent);
      if (due) {
        sendGuestEmail(b.email, reminderEmail(b, held, due, day, links));
        sh.getRange(i + 1, 16).setValue(sent ? sent + ',' + due : due);
        sh.getRange(i + 1, 17).setValue(day.statusText); // the reminder carried the latest status
        continue;
      }
      if (statusChangeDue(r[16], day.statusText, daysUntil, hour)) {
        sendGuestEmail(b.email, statusEmail(b, held, day, links));
        sh.getRange(i + 1, 17).setValue(day.statusText);
      }
    }
    openStandby(today);
  } finally {
    lock.releaseLock();
  }
  try { checkEtransfers(); } catch (err) { console.error(err); }
  try { ensureCrm(); } catch (err) { console.error(err); }
  try { refreshAvailabilityCache(); } catch (err) { /* visitors fall back to a fresh read */ }
}

/** Run from the editor to email the club a sample of each guest email. Sends 5 emails, books nothing. */
function sendSampleEmails() {
  var to = prop('CLUB_EMAIL');
  var b = { name: 'Sample Guest', date: Utilities.formatDate(new Date(Date.now() + 8 * 86400000), BOOKING.TZ, 'yyyy-MM-dd'), start: '13:30', people: 2 };
  var links = emailLinks('00000000-0000-0000-0000-000000000000');
  var quiet = { statusText: '', weather: '', instructor: false };
  var busy = { statusText: 'Day is a go. Instructors arriving about 10am', weather: 'Sunny, light SW wind, 24°C', instructor: true };
  var off = { statusText: 'Cancelled: strong wind', weather: 'Gusts to 50 km/h', instructor: true };
  [
    confirmationEmail(b, true, links),
    reminderEmail(b, true, '7', quiet, links),
    reminderEmail(b, true, '1', busy, links),
    statusEmail(b, true, off, links),
    confirmationEmail(b, false, links)
  ].forEach(function (m) { sendGuestEmail(to, { subject: '[SAMPLE] ' + m.subject, html: m.html, text: m.text }); });
}

/** Who gets a booking's thank-you note: the booker and every flyer with a different email (from their waivers). */
function thankYouRecipients(bookingId, b) {
  var to = [{ email: b.email, name: b.name }];
  if (bookingId) {
    var fl = tab(CRM.FLYERS, CRM.FLYERS_HEADERS);
    for (var k = 0; k < fl.rows.length; k++) {
      if (fl.row(k, 'Booking ID') === bookingId && fl.row(k, 'Flown') !== 'No') to.push({ email: String(fl.row(k, 'Email')), name: String(fl.row(k, 'Name')) });
    }
  }
  var seen = {}, out = [];
  to.forEach(function (p) {
    var e = String(p.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || seen[e]) return;
    seen[e] = true;
    out.push({ email: String(p.email).trim(), first: String(p.name).split(/\s+/)[0] });
  });
  return out;
}

/** Send a booking's thank-you note and record it (Bookings row index i, its values r). by = who sent it by hand. */
function sendThankYou(sh, i, r, b, by) {
  var bookingId = String(r[BOOKING.HEADERS.indexOf('Booking ID')] || '');
  var links = emailLinks(''), today = todayOnField();
  thankYouRecipients(bookingId, b).forEach(function (p) {
    sendGuestEmail(p.email, thankYouEmail(p.first, b.date, links, today), { bookingId: bookingId, by: by });
  });
  sh.getRange(i + 1, BOOKING.HEADERS.indexOf('Follow-up sent') + 1).setValue(new Date());
}

/** Bookings from yesterday still due a thank-you note (not cancelled, a no-show, an unconfirmed request, or sent). */
function yesterdaysThankYous() {
  var sh = bookingsSheet(), rows = sh.getDataRange().getValues();
  var yesterday = addDays(todayOnField(), -1), follow = BOOKING.HEADERS.indexOf('Follow-up sent'), out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[1] || isoOf(r[1]) !== yesterday || r[follow] || ['Held', 'Confirmed', 'Flown'].indexOf(String(r[5])) < 0) continue;
    out.push({ i: i, r: r, b: { date: yesterday, name: String(r[6]), email: String(r[7]) } });
  }
  return { sh: sh, list: out };
}

/** In the editor: list who would get yesterday's thank-you notes, without sending. */
function previewYesterdaysThankYous() {
  var y = yesterdaysThankYous();
  y.list.forEach(function (x) {
    var to = thankYouRecipients(String(x.r[BOOKING.HEADERS.indexOf('Booking ID')] || ''), x.b);
    Logger.log(x.b.name + ' (' + x.r[3] + ' people, ' + x.r[5] + '): ' + to.map(function (p) { return p.first + ' <' + p.email + '>'; }).join(', '));
  });
  Logger.log(y.list.length + ' booking(s).');
}

/** In the editor: send yesterday's thank-you notes now, and mark them sent so the evening run skips them. */
function sendYesterdaysThankYous() {
  var y = yesterdaysThankYous();
  y.list.forEach(function (x) { sendThankYou(y.sh, x.i, x.r, x.b, 'sent by hand'); });
  Logger.log('Sent for ' + y.list.length + ' booking(s).');
}
