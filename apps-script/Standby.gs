/**
 * Standby list for weekend guests who want to pay at the field.
 *
 * Weekend spots are held only for paid flights (a certificate code). A guest who wants to pay at
 * the field joins the standby list for a day (and, if they say so, either day of that weekend).
 * Nothing is held. Once the club marks that day as on in the Status / Comments row, the day opens
 * to pay-at-the-field bookings, and the hourly check emails everyone waiting for it: "Flying is on,
 * spots are open", first come, first served, up to the spots left.
 *
 * Standby tab (requests sheet): one row per sign-up. Status: Waiting -> Notified, or Expired once
 * the day has passed.
 */

var STANDBY = {
  TAB: 'Standby',
  HEADERS: ['Received', 'Date', 'Start', 'People', 'Either weekend day', 'Name', 'Email', 'Phone', 'Interest',
    'Message', 'Status', 'Notified', 'Opened date']
};

function standbySheet() {
  var sh = sheet(STANDBY.TAB, STANDBY.HEADERS);
  if (sh.getLastColumn() < STANDBY.HEADERS.length) sh.getRange(1, 1, 1, STANDBY.HEADERS.length).setValues([STANDBY.HEADERS]);
  return sh;
}

/**
 * Which day, if any, has opened for a standby sign-up: its own date if flying is on, otherwise the
 * other weekend day if they said either works and that day is on. Only days still bookable online.
 * @param s {date, flexible}  @param availByDate {date: availability day}
 */
function standbyOpenDay(s, availByDate) {
  var own = availByDate[s.date];
  if (own && own.status === 'on' && own.remaining > 0) return own;
  if (s.flexible) {
    var other = availByDate[weekendPartner(s.date)];
    if (other && other.status === 'on' && other.remaining > 0) return other;
  }
  return null;
}

function standbyPost(p) {
  var s = {
    date: clean(p.date),
    start: clean(p.start),
    people: parseInt(p.people, 10),
    name: clean(p.name),
    email: clean(p.email),
    phone: clean(p.phone),
    interest: clean(p.interest) || 'Discovery flight',
    message: clean(p.message),
    flexible: p.flexible === 'yes',
    weightOk: p.weight_ok === 'yes'
  };
  var problems = [];
  if (!s.name) problems.push('your name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email)) problems.push('a valid email address');
  if (!/\d{3}.*\d{4}/.test(s.phone)) problems.push('a phone number');
  if (!s.weightOk) problems.push('the weight confirmation');
  if (!(s.people >= 1 && s.people <= BOOKING.MAX_GROUP)) problems.push('the number of people');
  if (problems.length) return json({ ok: false, error: 'We still need ' + problems.join(', ') + '.' });
  if (!weekendPartner(s.date) || s.date <= todayOnField()) return json({ ok: false, error: 'The standby list is for weekend days.' });

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    standbySheet().appendRow([new Date(), s.date, "'" + s.start, s.people, s.flexible ? 'Yes' : 'No', s.name, s.email, s.phone,
      s.interest, s.message, 'Waiting', '', '']);
  } finally {
    lock.releaseLock();
  }

  var links = emailLinks('');
  sendGuestEmail(s.email, standbyEmail(s, links));
  MailApp.sendEmail({
    to: prop('CLUB_EMAIL'),
    replyTo: s.email,
    subject: 'Standby: ' + s.name + ', ' + longDate(s.date) + (s.flexible ? ' (either day)' : '') + ', ' + s.people + (s.people === 1 ? ' person' : ' people'),
    body: [
      s.name + ' joined the standby list to pay at the field.',
      '',
      'Day: ' + longDate(s.date) + (s.flexible ? ' (or the other day of that weekend)' : ''),
      'Preferred time: ' + clock12(s.start),
      'People: ' + s.people,
      'Email: ' + s.email,
      'Phone: ' + s.phone,
      'Interest: ' + s.interest,
      'Message: ' + (s.message || '(none)'),
      '',
      'When you mark the day as on in the Status row, they get an email within the hour that spots are open.'
    ].join('\n')
  });
  return json({ ok: true, kind: 'Standby', date: s.date, people: s.people });
}

/** Hourly (from runReminders): tell waiting standby guests when their day is confirmed. */
function openStandby(today) {
  var sh = standbySheet();
  var rows = sh.getDataRange().getValues();
  if (rows.length < 2) return;
  var availByDate = {};
  computeAvailability(scheduleDays(scheduleSheet().getDataRange().getDisplayValues()), activeBookings(), guestCaps(), today)
    .forEach(function (a) { availByDate[a.date] = a; });
  var col = function (name) { return STANDBY.HEADERS.indexOf(name) + 1; };
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (r[col('Status') - 1] !== 'Waiting' || !r[1]) continue;
    var s = { date: isoOf(r[1]), start: hhmmOf(r[2]), people: Number(r[3]) || 1, flexible: r[col('Either weekend day') - 1] === 'Yes', name: String(r[5]), email: String(r[6]) };
    var lastDay = s.flexible && weekdayOf(s.date) === 6 ? addDays(s.date, 1) : s.date;
    if (lastDay < today) {
      sh.getRange(i + 1, col('Status')).setValue('Expired');
      continue;
    }
    var open = standbyOpenDay(s, availByDate);
    if (!open || open.remaining < s.people) continue;
    var link = siteOrigin() + '/discovery-flight/?date=' + open.date + '#request';
    sendGuestEmail(s.email, standbyOpenEmail(s, open.date, open.remaining, link, emailLinks('')));
    sh.getRange(i + 1, col('Status')).setValue('Notified');
    sh.getRange(i + 1, col('Notified')).setValue(new Date());
    sh.getRange(i + 1, col('Opened date')).setValue(open.date);
  }
}
