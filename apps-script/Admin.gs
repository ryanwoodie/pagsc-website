/**
 * The club's admin page (/admin/ on the site). POST form=admin with an action; every action but "login" needs a token.
 *
 * Sign-in is a link by email: a volunteer enters their address on /admin/, and if it is in the Script Property
 * ADMIN_EMAILS (comma-separated; default CLUB_EMAIL) they get a link that signs them in for ADMIN.DAYS days.
 * The token is the email and an expiry, signed with a key kept in Script Properties (ADMIN_KEY, made on first use).
 * Every change records who made it (Messages "By", booking Notes).
 *
 * Actions:
 *   login {email}                       email a sign-in link (always answers ok)
 *   overview {}                         the next 4 weeks: bookings, people and status per day, and what needs attention
 *   day {date}                          one day: schedule status, bookings with flyers and waivers, standby, recent unlinked waivers
 *   status {booking, status}            Confirmed (weekday requests; emails the guest), Flown, No-show, Held (undo)
 *   cancel {booking, notify, message}   cancel and free the slot; optionally email the guest
 *   move {booking, date, start}         move to another free time; emails the guest
 *   add {…booking form fields}          a phone-in booking (no weekend paid-only rule); the guest gets the usual emails
 *   message {booking, subject, body}    email the booker
 *   note {booking, notes}               set the booking's notes
 *   link-waiver {booking, waiver}       attach a signed waiver to a booking
 *   standby-message {tokens, subject, body}   email standby sign-ups
 *   dismiss {kind, row}                 mark a plain-form request or an unmatched e-transfer as dealt with
 */

var ADMIN = {
  DAYS: 30,                  // a sign-in lasts this long
  ATTENTION_DAYS: 14,        // how far back plain-form requests and e-transfers show
  WAIVER_DAYS: 60            // recent waivers not linked to a booking, offered for linking
};

// ---------- Pure logic (tested in scripts/admin.test.mjs) ----------

function adminAllowed(email, list) {
  var e = String(email || '').trim().toLowerCase();
  return !!e && String(list || '').toLowerCase().split(/[\s,;]+/).filter(String).indexOf(e) >= 0;
}

function hex(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/** Paragraphs from a volunteer's typed message, escaped. */
function messageParas(body) {
  return String(body || '').trim().split(/\n\s*\n/).map(function (p) { return para(esc(p.trim()).replace(/\n/g, '<br>')); }).join('');
}

/** A message a volunteer writes from the admin page, in the club's email style. */
function adminMessageEmail(first, subject, body, links) {
  return {
    subject: subject,
    html: layout(subject, para('Hi ' + esc(first) + ',') + messageParas(body) + para(EMAIL.CLUB), links),
    text: ['Hi ' + first + ',', '', String(body || '').trim(), '', EMAIL.CLUB].join('\n')
  };
}

/** Sent when the club cancels a booking. */
function clubCancelEmail(b, message, links) {
  var first = String(b.name).split(/\s+/)[0];
  var body = heading('Your booking is cancelled') +
    para('Hi ' + esc(first) + ', we have cancelled your Discovery Flight on ' + esc(longDate(b.date)) + ' at ' + esc(clock12(b.start)) + '.') +
    (message ? messageParas(message) : '') +
    para('Pick another day whenever it suits you; any certificate you used is ready to book again.') +
    button('Pick another day', links.calendar);
  return {
    subject: 'Booking cancelled: ' + longDate(b.date),
    html: layout('Your booking on ' + longDate(b.date) + ' is cancelled.', body, links),
    text: ['Hi ' + first + ',', '', 'We have cancelled your Discovery Flight on ' + longDate(b.date) + ' at ' + clock12(b.start) + '.', '',
      message ? String(message).trim() + '\n' : '', 'Pick another day: ' + links.calendar, '', EMAIL.CLUB].join('\n')
  };
}

/** Sent when the club moves a booking. */
function clubMoveEmail(b, from, links) {
  var first = String(b.name).split(/\s+/)[0];
  var body = heading('Your flight has moved') +
    para('Hi ' + esc(first) + ', we have moved your Discovery Flight from ' + esc(longDate(from.date)) + ' at ' + esc(clock12(from.start)) + ' to:') +
    whenPanel(b, 'Your new flight time') +
    para('If the new time does not suit you, change or cancel it with the button below, or reply to this email.') +
    changeHtml(links);
  return {
    subject: 'Your flight has moved: ' + whenText(b),
    html: layout('Your new flight time: ' + whenText(b), body, links),
    text: ['Hi ' + first + ',', '', 'We have moved your Discovery Flight from ' + longDate(from.date) + ' at ' + clock12(from.start) + ' to ' + whenText(b) + '.', '',
      changeText(links), '', EMAIL.CLUB].join('\n')
  };
}

// ---------- Sign-in ----------

function adminKey() {
  var props = PropertiesService.getScriptProperties();
  var k = props.getProperty('ADMIN_KEY');
  if (!k) {
    k = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('ADMIN_KEY', k);
  }
  return k;
}

function adminList() {
  return PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || prop('CLUB_EMAIL');
}

function signToken(payload) {
  return hex(Utilities.computeHmacSha256Signature(payload, adminKey()));
}

function makeAdminToken(email) {
  var payload = email.toLowerCase() + '|' + (Date.now() + ADMIN.DAYS * 86400000);
  return Utilities.base64EncodeWebSafe(payload + '|' + signToken(payload));
}

/** The signed-in email for a token, or ''. */
function adminUser(token) {
  try {
    var s = Utilities.newBlob(Utilities.base64DecodeWebSafe(String(token || ''))).getDataAsString();
    var cut = s.lastIndexOf('|');
    var payload = s.slice(0, cut), sig = s.slice(cut + 1);
    var parts = payload.split('|');
    if (sig !== signToken(payload) || Number(parts[1]) < Date.now() || !adminAllowed(parts[0], adminList())) return '';
    return parts[0];
  } catch (err) {
    return '';
  }
}

function adminLogin(email) {
  email = String(email || '').trim().toLowerCase();
  if (adminAllowed(email, adminList())) {
    var link = siteOrigin() + '/admin/#t=' + makeAdminToken(email);
    MailApp.sendEmail({
      to: email, name: EMAIL.CLUB, subject: 'Sign in to the PAGSC admin page',
      body: 'Open this link to sign in to the admin page. It works for ' + ADMIN.DAYS + ' days on this device.\n\n' + link + '\n\nIf you did not ask for this, ignore this email.',
      htmlBody: layout('Your sign-in link', heading('Sign in') + para('Open the link to sign in to the admin page. It works for ' + ADMIN.DAYS + ' days on the device you open it on.') + button('Sign in', link) +
        para('<span style="font-size:14px;color:' + EMAIL.GREY + '">If you did not ask for this, ignore this email.</span>'), emailLinks(''))
    });
  }
  return { ok: true };
}

// ---------- Router ----------

function adminPost(p) {
  if (p.action === 'login') return json(adminLogin(p.email));
  var user = adminUser(p.token);
  if (!user) return json({ ok: false, error: 'signin' });
  try {
    var out;
    switch (p.action) {
      case 'overview': out = adminOverview(); break;
      case 'day': out = adminDay(String(p.date || todayOnField())); break;
      case 'status': out = adminStatus(p.booking, p.status, user); break;
      case 'cancel': out = adminCancel(p.booking, p.notify === 'yes', clean(p.message), user); break;
      case 'move': out = adminMove(p.booking, clean(p.date), clean(p.start), user); break;
      case 'add': out = adminAdd(p, user); break;
      case 'message': out = adminMessage(p.booking, clean(p.subject), String(p.body || '').slice(0, 5000), user); break;
      case 'note': out = adminNote(p.booking, clean(p.notes)); break;
      case 'link-waiver': out = adminLinkWaiver(p.booking, clean(p.waiver)); break;
      case 'standby-message': out = adminStandbyMessage(String(p.tokens || '').split(','), clean(p.subject), String(p.body || '').slice(0, 5000), user); break;
      case 'dismiss': out = adminDismiss(p.kind, Number(p.row), user); break;
      default: out = { ok: false, error: 'Unknown action.' };
    }
    return json(out);
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------- Reading ----------

function bookingTab() {
  return tab(BOOKING.TAB, BOOKING.HEADERS);
}

function findBooking(bk, id) {
  for (var i = 0; i < bk.rows.length; i++) if (String(bk.row(i, 'Booking ID')) === String(id)) return i;
  throw new Error('Booking not found. Reload the page.');
}

function bookingView(bk, i, flyersById) {
  var id = String(bk.row(i, 'Booking ID'));
  var flyers = flyersById[id] || [];
  return {
    id: id,
    date: isoOf(bk.row(i, 'Date')),
    start: hhmmOf(bk.row(i, 'Start')),
    people: Number(bk.row(i, 'People')) || 1,
    kind: String(bk.row(i, 'Kind')),
    status: String(bk.row(i, 'Status')),
    name: String(bk.row(i, 'Name')),
    email: String(bk.row(i, 'Email')),
    phone: String(bk.row(i, 'Phone')),
    interest: String(bk.row(i, 'Interest')),
    payment: String(bk.row(i, 'Payment')),
    certificates: String(bk.row(i, 'Certificates')),
    message: String(bk.row(i, 'Message')),
    notes: String(bk.row(i, 'Notes')),
    flexible: String(bk.row(i, 'Either weekend day')),
    movedFrom: String(bk.row(i, 'Moved from')),
    followUp: bk.row(i, 'Follow-up sent') ? 'Sent' : '',
    flyers: flyers,
    waivers: flyers.filter(function (f) { return f.waiver; }).length
  };
}

function flyersByBooking() {
  var fl = tab(CRM.FLYERS, CRM.FLYERS_HEADERS);
  var out = {};
  for (var i = 0; i < fl.rows.length; i++) {
    var id = String(fl.row(i, 'Booking ID'));
    (out[id] = out[id] || []).push({ name: String(fl.row(i, 'Name')), email: String(fl.row(i, 'Email')), waiver: String(fl.row(i, 'Waiver ID')), flown: String(fl.row(i, 'Flown')) });
  }
  return out;
}

function adminOverview() {
  ensureCrm();
  var today = todayOnField();
  var bk = bookingTab();
  var days = scheduleDays(scheduleSheet().getDataRange().getDisplayValues());
  var byDate = {};
  days.forEach(function (d) { byDate[d.date] = d; });
  var list = [], counts = {};
  for (var i = 0; i < bk.rows.length; i++) {
    var date = isoOf(bk.row(i, 'Date'));
    if (!date || date < today || bk.row(i, 'Status') === 'Cancelled') continue;
    var c = counts[date] = counts[date] || { bookings: 0, people: 0 };
    c.bookings++;
    c.people += Number(bk.row(i, 'People')) || 1;
  }
  for (var n = 0; n < BOOKING.DAYS_AHEAD; n++) {
    var dt = addDays(today, n), d = byDate[dt];
    var wd = weekdayOf(dt);
    if (!counts[dt] && !(d && d.statusText) && wd !== 0 && wd !== 6) continue;
    list.push({ date: dt, bookings: (counts[dt] || {}).bookings || 0, people: (counts[dt] || {}).people || 0, status: d ? d.statusText : '' });
  }
  return { ok: true, today: today, days: list, attention: adminAttention(bk, today) };
}

function adminAttention(bk, today) {
  var out = { requests: [], weekday: [], etransfers: [], unpaid: [], waivers: [] };
  var since = Date.now() - ADMIN.ATTENTION_DAYS * 86400000;
  var fl = flyersByBooking();
  for (var i = 0; i < bk.rows.length; i++) {
    var date = isoOf(bk.row(i, 'Date'));
    if (!date || date < today || bk.row(i, 'Status') === 'Cancelled') continue;
    var v = bookingView(bk, i, fl);
    if (v.status === 'Requested') out.weekday.push(v);
    if (daysBetween(today, date) <= 2 && v.waivers < v.people) out.waivers.push(v);
    if (/^E-transfer$/.test(v.payment)) out.unpaid.push(v);
  }
  var gr = tab(TAB, HEADERS.concat(['Handled']));
  for (var g = 0; g < gr.rows.length; g++) {
    var got = gr.row(g, 'Received');
    if (!(got instanceof Date) || got.getTime() < since || gr.row(g, 'Handled')) continue;
    out.requests.push({ row: g, received: got.toISOString(), name: String(gr.row(g, 'Name')), email: String(gr.row(g, 'Email')), phone: String(gr.row(g, 'Phone')),
      flyers: gr.row(g, 'Flyers'), dates: String(gr.row(g, 'Preferred dates')), message: String(gr.row(g, 'Message')), payment: String(gr.row(g, 'Payment')) });
  }
  var et = tab(ETRANSFER.TAB, ETRANSFER.HEADERS.concat(['Reviewed']));
  for (var e = 0; e < et.rows.length; e++) {
    var when = et.row(e, 'Received'), result = String(et.row(e, 'Result'));
    if (!(when instanceof Date) || when.getTime() < since || et.row(e, 'Reviewed') || /^(Paid|Ignored|Already paid)/.test(result)) continue;
    out.etransfers.push({ row: e, received: when.toISOString(), from: String(et.row(e, 'From')), amount: et.row(e, 'Amount'), message: String(et.row(e, 'Message')), result: result });
  }
  return out;
}

function adminDay(date) {
  var bk = bookingTab();
  var fl = flyersByBooking();
  var grid = scheduleSheet().getDataRange().getDisplayValues();
  var days = scheduleDays(grid);
  var d = null;
  days.forEach(function (x) { if (x.date === date) d = x; });
  var avail = null;
  computeAvailability(days, activeBookings(), guestCaps(), todayOnField(), nowOnField()).forEach(function (a) { if (a.date === date) avail = a; });
  var bookings = [];
  for (var i = 0; i < bk.rows.length; i++) if (isoOf(bk.row(i, 'Date')) === date) bookings.push(bookingView(bk, i, fl));
  bookings.sort(function (a, b) { return a.start < b.start ? -1 : 1; });

  var sb = tab(STANDBY.TAB, STANDBY.HEADERS), standby = [];
  var partner = weekendPartner(date);
  for (var s = 0; s < sb.rows.length; s++) {
    var st = String(sb.row(s, 'Status'));
    if (st !== 'Waiting' && st !== 'Notified') continue;
    var scope = standbyScope(sb.row(s, 'Scope'), sb.row(s, 'Either weekend day'));
    var sd = sb.row(s, 'Date') ? isoOf(sb.row(s, 'Date')) : '';
    var mine = scope === 'Any' ? (weekdayOf(date) === 0 || weekdayOf(date) === 6) : sd === date || (scope === 'Weekend' && sd === partner);
    if (!mine) continue;
    standby.push({ token: String(sb.row(s, 'Token')), name: String(sb.row(s, 'Name')), email: String(sb.row(s, 'Email')), phone: String(sb.row(s, 'Phone')),
      people: Number(sb.row(s, 'People')) || 1, scope: scope, status: st, codes: String(sb.row(s, 'Codes')) });
  }

  var linked = {};
  Object.keys(fl).forEach(function (k) { fl[k].forEach(function (f) { if (f.waiver) linked[f.waiver] = true; }); });
  var wv = tab(WAIVER.TAB, WAIVER.HEADERS), waivers = [];
  var since = Date.now() - ADMIN.WAIVER_DAYS * 86400000;
  for (var w = wv.rows.length - 1; w >= 0; w--) {
    var signed = wv.row(w, 'Signed');
    if (!(signed instanceof Date) || signed.getTime() < since) continue;
    var id = String(wv.row(w, 'ID'));
    if (!id || linked[id]) continue;
    waivers.push({ id: id, name: String(wv.row(w, 'Participant')), email: String(wv.row(w, 'Email')), signed: signed.toISOString() });
  }

  return {
    ok: true, date: date,
    day: d ? { status: d.statusText, weather: d.weather, instructor: d.instructor, students: d.students, manual: (d.manual || []).length } : null,
    avail: avail ? { remaining: avail.remaining, open: avail.open, confirmed: avail.confirmed, kind: avail.kind, slots: avail.slots } : null,
    bookings: bookings, standby: standby, waivers: waivers
  };
}

// ---------- Changes ----------

function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function addNote(bk, i, text, user) {
  var old = String(bk.row(i, 'Notes') || '');
  bk.set(i, 'Notes', (old ? old + '\n' : '') + Utilities.formatDate(new Date(), BOOKING.TZ, 'MMM d') + ' ' + user.split('@')[0] + ': ' + text);
}

function bookingFromRow(bk, i) {
  return { date: isoOf(bk.row(i, 'Date')), start: hhmmOf(bk.row(i, 'Start')), people: Number(bk.row(i, 'People')) || 1,
    name: String(bk.row(i, 'Name')), email: String(bk.row(i, 'Email')), waiverKey: String(bk.row(i, 'Waiver key') || '') };
}

function adminStatus(id, status, user) {
  if (['Confirmed', 'Flown', 'No-show', 'Held'].indexOf(status) < 0) return { ok: false, error: 'Unknown status.' };
  var confirmMail = null;
  withLock(function () {
    var bk = bookingTab(), i = findBooking(bk, id);
    var was = String(bk.row(i, 'Status'));
    if (was === 'Cancelled') throw new Error('That booking is cancelled.');
    bk.set(i, 'Status', status);
    addNote(bk, i, was + ' → ' + status, user);
    if (status === 'Confirmed' && was === 'Requested') {
      // The schedule cell drops its "Request:" prefix.
      var a1 = bk.row(i, 'Schedule cell'), text = String(bk.row(i, 'Schedule text'));
      if (a1 && /^Request:\s*/.test(text)) {
        var cell = scheduleSheet().getRange(a1), now = text.replace(/^Request:\s*/, '');
        if (String(cell.getDisplayValue()) === text) cell.setValue(now);
        bk.set(i, 'Schedule text', now);
      }
      var b = bookingFromRow(bk, i);
      b.confirmed = true;
      confirmMail = { to: b.email, mail: confirmationEmail(b, true, emailLinks(String(bk.row(i, 'Token')), b.waiverKey)) };
    }
    var flown = status === 'Flown' ? 'Yes' : status === 'No-show' ? 'No' : '';
    var fl = tab(CRM.FLYERS, CRM.FLYERS_HEADERS);
    for (var k = 0; k < fl.rows.length; k++) if (fl.row(k, 'Booking ID') === id) fl.set(k, 'Flown', flown);
    if (status === 'Flown') {
      var vs = vouchersSheet(), vr = vs.getDataRange().getValues(), token = bk.row(i, 'Token');
      for (var v = 1; v < vr.length; v++) if (vr[v][VC['Booking token'] - 1] === token && vr[v][VC['Status'] - 1] === 'Booked') {
        vs.getRange(v + 1, VC['Status']).setValue('Flown');
        vs.getRange(v + 1, VC['Flown date']).setValue(isoOf(bk.row(i, 'Date')));
      }
    }
    clearAvailabilityCache();
  });
  if (confirmMail) sendGuestEmail(confirmMail.to, confirmMail.mail, { bookingId: id, by: user });
  return { ok: true };
}

function adminCancel(id, notify, message, user) {
  var b, links;
  withLock(function () {
    var bk = bookingTab(), i = findBooking(bk, id);
    if (bk.row(i, 'Status') === 'Cancelled') throw new Error('Already cancelled.');
    b = bookingFromRow(bk, i);
    addNote(bk, i, 'cancelled' + (message ? ': ' + message : ''), user);
    links = emailLinks('');
  });
  var sh = bookingsSheet(), rows = sh.getDataRange().getValues();
  for (var r = 1; r < rows.length; r++) if (String(rows[r][BOOKING.HEADERS.indexOf('Booking ID')]) === String(id)) { cancelBookingRow(sh, rows, r); break; }
  if (notify) sendGuestEmail(b.email, clubCancelEmail(b, message, links), { bookingId: id, by: user });
  return { ok: true };
}

function adminMove(id, date, start, user) {
  var mail;
  withLock(function () {
    var bk = bookingTab(), i = findBooking(bk, id);
    if (bk.row(i, 'Status') === 'Cancelled') throw new Error('That booking is cancelled.');
    var from = bookingFromRow(bk, i);
    var token = String(bk.row(i, 'Token'));
    // Availability without this booking, so it can move within its own day.
    var others = [];
    for (var k = 0; k < bk.rows.length; k++) {
      if (k === i || bk.row(k, 'Status') === 'Cancelled' || !bk.row(k, 'Date')) continue;
      others.push({ date: isoOf(bk.row(k, 'Date')), start: hhmmOf(bk.row(k, 'Start')), people: Number(bk.row(k, 'People')) || 1 });
    }
    var sched = scheduleSheet();
    var grid = sched.getDataRange().getDisplayValues();
    var days = scheduleDays(grid);
    var day = null;
    computeAvailability(days, others, guestCaps(), todayOnField(), nowOnField()).forEach(function (a) { if (a.date === date) day = a; });
    var why = canBook(day, start, from.people);
    if (why) throw new Error(why);
    var a1 = bk.row(i, 'Schedule cell'), oldText = String(bk.row(i, 'Schedule text'));
    if (a1) {
      var cell = sched.getRange(a1);
      if (String(cell.getDisplayValue()) === oldText) { cell.clearContent(); grid = sched.getDataRange().getDisplayValues(); days = scheduleDays(grid); }
    }
    var kind = day.kind === 'weekend' ? 'Held' : String(bk.row(i, 'Status')) === 'Requested' ? 'Requested' : 'Confirmed';
    var text = scheduleText(kind, from.name.split(/\s+/)[0], start, from.people, null);
    bk.set(i, 'Date', date);
    bk.set(i, 'Start', "'" + start);
    bk.set(i, 'Kind', day.kind);
    bk.set(i, 'Status', kind);
    bk.set(i, 'Schedule cell', writeToSchedule(sched, grid, days, date, text, true));
    bk.set(i, 'Schedule text', text);
    bk.set(i, 'Last status', day.statusText);
    bk.set(i, 'Reminders sent', '');
    bk.set(i, 'Moved from', from.date + ' ' + from.start);
    addNote(bk, i, 'moved from ' + from.date + ' ' + from.start, user);
    moveCodesDate(token, date);
    clearAvailabilityCache();
    var to = { name: from.name, date: date, start: start, people: from.people };
    mail = { to: from.email, mail: clubMoveEmail(to, from, emailLinks(token, from.waiverKey)) };
  });
  sendGuestEmail(mail.to, mail.mail, { bookingId: id, by: user });
  return { ok: true };
}

function adminAdd(p, user) {
  return JSON.parse(bookingPost(p, user).getContent());
}

function adminMessage(id, subject, body, user) {
  if (!subject || !body.trim()) return { ok: false, error: 'Write a subject and a message.' };
  var bk = bookingTab(), i = findBooking(bk, id);
  var b = bookingFromRow(bk, i);
  sendGuestEmail(b.email, adminMessageEmail(b.name.split(/\s+/)[0], subject, body, emailLinks('')), { bookingId: id, by: user });
  return { ok: true };
}

function adminNote(id, notes) {
  return withLock(function () {
    var bk = bookingTab(), i = findBooking(bk, id);
    bk.set(i, 'Notes', notes);
    return { ok: true };
  });
}

function adminLinkWaiver(id, waiverId) {
  return withLock(function () {
    var bk = bookingTab(), i = findBooking(bk, id);
    var wv = tab(WAIVER.TAB, WAIVER.HEADERS), w = -1;
    for (var k = 0; k < wv.rows.length; k++) if (String(wv.row(k, 'ID')) === waiverId) w = k;
    if (w < 0) throw new Error('Waiver not found.');
    var key = String(bk.row(i, 'Waiver key') || '');
    if (key) wv.set(w, 'Booking key', key);
    wv.set(w, 'Flight date', isoOf(bk.row(i, 'Date')));
    linkWaiverToFlyer(id, { id: waiverId, name: String(wv.row(w, 'Participant')), email: String(wv.row(w, 'Email')), personId: String(wv.row(w, 'Person ID') || '') });
    var n = (flyersByBooking()[id] || []).filter(function (f) { return f.waiver; }).length;
    bk.set(i, 'Waivers signed', n);
    return { ok: true };
  });
}

function adminStandbyMessage(tokens, subject, body, user) {
  if (!subject || !body.trim()) return { ok: false, error: 'Write a subject and a message.' };
  var want = {};
  tokens.forEach(function (t) { if (t) want[t] = true; });
  var sb = tab(STANDBY.TAB, STANDBY.HEADERS), sent = 0, links = emailLinks('');
  for (var s = 0; s < sb.rows.length; s++) {
    if (!want[String(sb.row(s, 'Token'))]) continue;
    var name = String(sb.row(s, 'Name'));
    sendGuestEmail(String(sb.row(s, 'Email')), adminMessageEmail(name.split(/\s+/)[0], subject, body, links), { by: user });
    sent++;
  }
  return { ok: true, sent: sent };
}

function adminDismiss(kind, row, user) {
  var t = kind === 'request' ? tab(TAB, HEADERS.concat(['Handled'])) : kind === 'etransfer' ? tab(ETRANSFER.TAB, ETRANSFER.HEADERS.concat(['Reviewed'])) : null;
  if (!t || !(row >= 0 && row < t.rows.length)) return { ok: false, error: 'Not found.' };
  t.set(row, kind === 'request' ? 'Handled' : 'Reviewed', Utilities.formatDate(new Date(), BOOKING.TZ, 'yyyy-MM-dd') + ' ' + user.split('@')[0]);
  return { ok: true };
}
