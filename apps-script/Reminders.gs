/**
 * Booking reminders and status-change emails, run hourly by a time-driven trigger.
 *
 * Reminders (see reminderDue in Booking.gs): a week before for bookings made more than a week ahead,
 * 3 days before for bookings made 4 to 7 days ahead, and the day before (late afternoon) for everyone.
 * Each one shows the day's current status, forecast and whether an instructor has signed up.
 * When a day's Status / Comments text changes, guests booked within the next week get an email.
 *
 * One-time setup, in the Apps Script editor: choose installReminders in the function list and Run.
 * Google asks to approve running on a schedule; approve as the club account.
 */

/** Run once from the editor. Safe to run again: it replaces the existing trigger. */
function installReminders() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runReminders').timeBased().everyHours(1).create();
  Logger.log('Hourly reminders installed.');
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
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      if (!r[1] || r[5] === 'Cancelled') continue;
      var b = { date: isoOf(r[1]), start: hhmmOf(r[2]), people: Number(r[3]) || 1, name: String(r[6]), email: String(r[7]) };
      var daysUntil = daysBetween(today, b.date);
      if (daysUntil < 0) continue;
      var day = byDate[b.date] || { statusText: '', weather: '', instructor: false };
      var held = r[5] === 'Held';
      var links = emailLinks(String(r[12]));
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
  } finally {
    lock.releaseLock();
  }
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
