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
 *   all {}                              everything the page shows: a week back to 4 weeks ahead, attention, unlinked waivers
 *   day {date}                          one day outside that range
 *   walkin {date, start, waivers, payment, status, interest, thanks}   a booking made from signed waivers
 *   status {booking, status}            Confirmed (weekday requests; emails the guest), Flown, No-show, Held (undo)
 *   cancel {booking, notify, message}   cancel and free the slot; optionally email the guest
 *   move {booking, date, start}         move to another free time; emails the guest
 *   add {…booking form fields}          a phone-in booking (no weekend paid-only rule); the guest gets the usual emails
 *   message {booking, subject, body}    email the booker
 *   note {booking, notes}               set the booking's notes
 *   link-waiver {booking, waiver, flyer?}   attach a signed waiver to a booking (to one flyer, if given)
 *   flyer-merge {booking, keep, drop}   two flyers are one person: keep one row (with the waiver) and merge the contacts
 *   flyer-remove {booking, flyer}       take a flyer off a booking (its waiver goes back to the unlinked list)
 *   standby-message {tokens, subject, body}   email standby sign-ups
 *   dismiss {kind, row}                 mark a plain-form request or an unmatched e-transfer as dealt with
 *   etransfer-issue {row, name, email, quantity, value, recipient, message}   certificates (and a contact) from an
 *                                       e-transfer that came without a reference; emails the certificate PDF
 *   etransfer-apply {row, reference}    count an e-transfer sent without its reference against that waiting order
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
      case 'all': out = adminAll(); break;
      case 'walkin': out = adminWalkin(p, user); break;
      case 'day': out = adminDay(String(p.date || todayOnField())); break;
      case 'status': out = adminStatus(p.booking, p.status, user); break;
      case 'cancel': out = adminCancel(p.booking, p.notify === 'yes', clean(p.message), user); break;
      case 'move': out = adminMove(p.booking, clean(p.date), clean(p.start), user); break;
      case 'add': out = adminAdd(p, user); break;
      case 'message': out = adminMessage(p.booking, clean(p.subject), String(p.body || '').slice(0, 5000), user); break;
      case 'note': out = adminNote(p.booking, clean(p.notes)); break;
      case 'link-waiver': out = adminLinkWaiver(p.booking, clean(p.waiver), clean(p.flyer)); break;
      case 'flyer-merge': out = adminFlyerMerge(p.booking, clean(p.keep), clean(p.drop), user); break;
      case 'flyer-remove': out = adminFlyerRemove(p.booking, clean(p.flyer), user); break;
      case 'standby-message': out = adminStandbyMessage(String(p.tokens || '').split(','), clean(p.subject), String(p.body || '').slice(0, 5000), user); break;
      case 'dismiss': out = adminDismiss(p.kind, Number(p.row), user); break;
      case 'etransfer-issue': out = adminEtransferIssue(p, user); break;
      case 'etransfer-apply': out = adminEtransferApply(Number(p.row), clean(p.reference), user); break;
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
    (out[id] = out[id] || []).push({ id: String(fl.row(i, 'Flyer ID')), name: String(fl.row(i, 'Name')), email: String(fl.row(i, 'Email')),
      waiver: String(fl.row(i, 'Waiver ID')), flown: String(fl.row(i, 'Flown')), person: String(fl.row(i, 'Person ID')) });
  }
  return out;
}

/**
 * Everything the admin page shows, in one request: each day from a week ago to four weeks ahead that has bookings, a
 * status or is a weekend, with its bookings, standby and spots; what needs attention; and recent waivers not on a booking.
 * The page keeps this and switches days without asking again.
 */
function adminAll() {
  var today = todayOnField();
  var ctx = adminContext(today);
  var dates = {};
  Object.keys(ctx.bookingsByDate).forEach(function (d) { dates[d] = true; });
  for (var n = -7; n < BOOKING.DAYS_AHEAD; n++) {
    var dt = addDays(today, n), wd = weekdayOf(dt);
    if (wd === 0 || wd === 6 || (ctx.dayByDate[dt] && ctx.dayByDate[dt].statusText)) dates[dt] = true;
  }
  var from = addDays(today, -7), to = addDays(today, BOOKING.DAYS_AHEAD);
  var days = Object.keys(dates).filter(function (d) { return d >= from && d < to; }).sort().map(function (d) { return dayView(d, ctx); });
  return { ok: true, today: today, days: days, attention: adminAttention(ctx, today), waivers: ctx.unlinked };
}

/** One day, for dates outside adminAll's range. */
function adminDay(date) {
  var ctx = adminContext(todayOnField());
  var v = dayView(date, ctx);
  v.ok = true;
  v.waivers = ctx.unlinked;
  return v;
}

/** Every sheet the admin page needs, read once. */
function adminContext(today) {
  var bk = bookingTab();
  var fl = flyersByBooking();
  var days = scheduleDays(scheduleSheet().getDataRange().getDisplayValues());
  var dayByDate = {}, availByDate = {}, bookingsByDate = {}, active = [];
  days.forEach(function (d) { dayByDate[d.date] = d; });
  for (var i = 0; i < bk.rows.length; i++) {
    var date = isoOf(bk.row(i, 'Date'));
    if (!date || !bk.row(i, 'Booking ID')) continue;
    (bookingsByDate[date] = bookingsByDate[date] || []).push(bookingView(bk, i, fl));
    if (bk.row(i, 'Status') !== 'Cancelled') active.push({ date: date, start: hhmmOf(bk.row(i, 'Start')), people: Number(bk.row(i, 'People')) || 1 });
  }
  computeAvailability(days, active, guestCaps(), today, nowOnField()).forEach(function (a) { availByDate[a.date] = a; });

  var sb = tab(STANDBY.TAB, STANDBY.HEADERS), standby = [];
  for (var s = 0; s < sb.rows.length; s++) {
    var st = String(sb.row(s, 'Status'));
    if (st !== 'Waiting' && st !== 'Notified') continue;
    standby.push({ token: String(sb.row(s, 'Token')), name: String(sb.row(s, 'Name')), email: String(sb.row(s, 'Email')), phone: String(sb.row(s, 'Phone')),
      people: Number(sb.row(s, 'People')) || 1, scope: standbyScope(sb.row(s, 'Scope'), sb.row(s, 'Either weekend day')), status: st,
      codes: String(sb.row(s, 'Codes')), date: sb.row(s, 'Date') ? isoOf(sb.row(s, 'Date')) : '' });
  }

  var linked = {};
  Object.keys(fl).forEach(function (k) { fl[k].forEach(function (f) { if (f.waiver) linked[f.waiver] = true; }); });
  var wv = tab(WAIVER.TAB, WAIVER.HEADERS), unlinked = [];
  var since = Date.now() - ADMIN.WAIVER_DAYS * 86400000;
  for (var w = wv.rows.length - 1; w >= 0; w--) {
    var signed = wv.row(w, 'Signed');
    if (!(signed instanceof Date) || signed.getTime() < since) continue;
    var id = String(wv.row(w, 'ID'));
    if (!id || linked[id]) continue;
    unlinked.push({ id: id, name: String(wv.row(w, 'Participant')), email: String(wv.row(w, 'Email')), phone: String(wv.row(w, 'Phone')),
      age: Number(wv.row(w, 'Age')), guardian: String(wv.row(w, 'Guardian') || ''), signed: signed.toISOString(),
      signedDate: Utilities.formatDate(signed, BOOKING.TZ, 'yyyy-MM-dd') });
  }
  return { bk: bk, fl: fl, dayByDate: dayByDate, availByDate: availByDate, bookingsByDate: bookingsByDate, standby: standby, unlinked: unlinked };
}

function dayView(date, ctx) {
  var d = ctx.dayByDate[date], a = ctx.availByDate[date];
  var bookings = (ctx.bookingsByDate[date] || []).slice().sort(function (x, y) { return x.start < y.start ? -1 : 1; });
  var partner = weekendPartner(date), weekend = weekdayOf(date) === 0 || weekdayOf(date) === 6;
  var standby = ctx.standby.filter(function (s) {
    return s.scope === 'Any' ? weekend : s.date === date || (s.scope === 'Weekend' && s.date === partner);
  });
  var people = 0;
  bookings.forEach(function (b) { if (b.status !== 'Cancelled') people += b.people; });
  return {
    date: date,
    day: d ? { status: d.statusText, weather: d.weather, instructor: d.instructor, students: d.students, manual: (d.manual || []).length } : null,
    avail: a ? { remaining: a.remaining, open: a.open, confirmed: a.confirmed, kind: a.kind, slots: a.slots } : null,
    bookings: bookings, standby: standby, people: people
  };
}

function adminAttention(ctx, today) {
  var out = { requests: [], weekday: [], etransfers: [], unpaid: [], waivers: [], orders: [] };
  var since = Date.now() - ADMIN.ATTENTION_DAYS * 86400000;
  Object.keys(ctx.bookingsByDate).forEach(function (date) {
    if (date < today) return;
    ctx.bookingsByDate[date].forEach(function (v) {
      if (v.status === 'Cancelled') return;
      if (v.status === 'Requested') out.weekday.push(v);
      if (daysBetween(today, date) <= 2 && v.waivers < v.people) out.waivers.push(v);
      if (/^E-transfer$/.test(v.payment)) out.unpaid.push(v);
    });
  });
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
    out.etransfers.push({ row: e, received: when.toISOString(), from: String(et.row(e, 'From')), amount: et.row(e, 'Amount'), message: String(et.row(e, 'Message')),
      result: result, reference: String(et.row(e, 'Interac reference')), deposited: et.row(e, 'Deposited') === 'Yes' });
  }
  // E-transfer orders still waiting, for applying a transfer sent without its reference.
  var vr = vouchersSheet().getDataRange().getValues(), orders = {};
  for (var v = 1; v < vr.length; v++) {
    if (vr[v][VC['Status'] - 1] !== ETRANSFER.STATUS) continue;
    var ref = String(vr[v][VC['Session ID'] - 1]);
    var o = orders[ref] = orders[ref] || { reference: ref, name: String(vr[v][VC['Buyer name'] - 1]), email: String(vr[v][VC['Buyer email'] - 1]), amount: 0, flights: 0,
      booked: vr[v][VC['Booked date'] - 1] ? isoOf(vr[v][VC['Booked date'] - 1]) : '' };
    o.amount += Number(vr[v][VC['Value'] - 1]) || 0;
    o.flights++;
  }
  out.orders = Object.keys(orders).map(function (k) { return orders[k]; });
  return out;
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

function adminLinkWaiver(id, waiverId, flyerId) {
  return withLock(function () {
    var bk = bookingTab(), i = findBooking(bk, id);
    var wv = tab(WAIVER.TAB, WAIVER.HEADERS), w = -1;
    for (var k = 0; k < wv.rows.length; k++) if (String(wv.row(k, 'ID')) === waiverId) w = k;
    if (w < 0) throw new Error('Waiver not found.');
    var key = String(bk.row(i, 'Waiver key') || '');
    if (key) wv.set(w, 'Booking key', key);
    wv.set(w, 'Flight date', isoOf(bk.row(i, 'Date')));
    linkWaiverToFlyer(id, { id: waiverId, name: String(wv.row(w, 'Participant')), email: String(wv.row(w, 'Email')), personId: String(wv.row(w, 'Person ID') || '') }, flyerId);
    recountWaivers(bk, i, id);
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

/**
 * A walk-in: a booking made from waivers signed at the field (or before), at any time the volunteer types.
 * The flyers are the waivers' participants; the contact is the first one's (their parent or guardian for a minor).
 * Nothing is written on the Flying Schedule and no confirmation is sent. thanks = "yes" sends the thank-you note
 * now for a flight before today; otherwise it goes the evening after, as for any booking.
 */
function adminWalkin(p, user) {
  var date = clean(p.date), start = clean(p.start);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Pick the day of the flight.' };
  if (!/^\d{2}:\d{2}$/.test(start)) return { ok: false, error: 'Enter the time of the flight.' };
  var ids = String(p.waivers || '').split(',').map(function (x) { return x.trim(); }).filter(String);
  if (!ids.length) return { ok: false, error: 'Tick at least one waiver.' };
  var status = p.status === 'Held' ? 'Held' : 'Flown';
  var payment = clean(p.payment) || 'Paid at the field';
  var today = todayOnField();
  var out = withLock(function () {
    var wv = tab(WAIVER.TAB, WAIVER.HEADERS), people = tab(CRM.PEOPLE, CRM.PEOPLE_HEADERS);
    var flyers = [];
    ids.forEach(function (id) {
      for (var k = 0; k < wv.rows.length; k++) if (String(wv.row(k, 'ID')) === id) { flyers.push(k); return; }
      throw new Error('A waiver was not found. Reload the page.');
    });
    var w0 = flyers[0];
    var minor = Number(wv.row(w0, 'Age')) < WAIVER.GUARDIAN_UNDER && wv.row(w0, 'Guardian');
    var contact = {
      name: String(minor ? wv.row(w0, 'Guardian') : wv.row(w0, 'Participant')),
      email: String(wv.row(w0, 'Email')),
      phone: String(minor ? (wv.row(w0, 'Guardian phone') || wv.row(w0, 'Phone')) : wv.row(w0, 'Phone'))
    };
    var bookingId = newId('B'), waiverKey = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
    var personId = upsertPerson(people, contact, 'Walk-in');
    var wd = weekdayOf(date), past = date <= today;
    var bk = bookingTab();
    bk.add({
      'Received': new Date(), 'Date': date, 'Start': "'" + start, 'People': flyers.length,
      'Kind': wd === 0 || wd === 6 ? 'weekend' : 'weekday', 'Status': status,
      'Name': contact.name, 'Email': contact.email, 'Phone': contact.phone,
      'Interest': clean(p.interest) || 'Discovery flight', 'Payment': payment, 'Token': Utilities.getUuid(),
      'Reminders sent': past ? '7,3,1' : '', // no reminders for a flight already under way
      'Waiver key': waiverKey, 'Waivers signed': flyers.length, 'Booking ID': bookingId, 'Person ID': personId,
      'Notes': Utilities.formatDate(new Date(), BOOKING.TZ, 'MMM d') + ' ' + user.split('@')[0] + ': walk-in from waivers'
    });
    var fl = tab(CRM.FLYERS, CRM.FLYERS_HEADERS), to = [];
    flyers.forEach(function (k) {
      var pid = String(wv.row(k, 'Person ID') || '') || upsertPerson(people, { name: wv.row(k, 'Participant'), email: wv.row(k, 'Email'), phone: wv.row(k, 'Phone') }, 'Waiver');
      fl.add({ 'Booking ID': bookingId, 'Person ID': pid, 'Name': wv.row(k, 'Participant'), 'Email': wv.row(k, 'Email'), 'Waiver ID': wv.row(k, 'ID'),
        'Flown': status === 'Flown' ? 'Yes' : '', 'Added': new Date(), 'Flyer ID': newId('F') });
      wv.set(k, 'Booking key', waiverKey);
      wv.set(k, 'Flight date', date);
      to.push({ email: String(wv.row(k, 'Email')), name: String(minor && k === w0 ? contact.name : wv.row(k, 'Participant')) });
    });
    clearAvailabilityCache();
    var thanks = p.thanks === 'yes' && date < today;
    if (thanks) bk.set(bk.rows.length - 1, 'Follow-up sent', new Date());
    return { bookingId: bookingId, to: thanks ? to : [], date: date };
  });
  var seen = {}, links = emailLinks('');
  out.to.forEach(function (x) {
    var e = x.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || seen[e]) return;
    seen[e] = true;
    sendGuestEmail(x.email.trim(), thankYouEmail(x.name.split(/\s+/)[0], out.date, links), { bookingId: out.bookingId, by: user });
  });
  return { ok: true, booking: out.bookingId };
}

function recountWaivers(bk, i, id) {
  bk.set(i, 'Waivers signed', (flyersByBooking()[id] || []).filter(function (f) { return f.waiver; }).length);
}

function flyerRows(fl, bookingId) {
  var out = {};
  for (var i = 0; i < fl.rows.length; i++) if (fl.row(i, 'Booking ID') === bookingId) out[fl.row(i, 'Flyer ID')] = i;
  return out;
}

function adminFlyerMerge(id, keepId, dropId, user) {
  return withLock(function () {
    var bk = bookingTab(), i = findBooking(bk, id);
    var fl = tab(CRM.FLYERS, CRM.FLYERS_HEADERS), rows = flyerRows(fl, id);
    var keep = rows[keepId], drop = rows[dropId];
    if (keep == null || drop == null || keep === drop) throw new Error('Those flyers were not found. Reload the page.');
    if (fl.row(keep, 'Waiver ID') && fl.row(drop, 'Waiver ID')) throw new Error('Both have a waiver. Remove one instead.');
    if (!fl.row(keep, 'Waiver ID') && fl.row(drop, 'Waiver ID')) { var t = keep; keep = drop; drop = t; } // the row with the waiver stays
    var keepName = String(fl.row(keep, 'Name')), dropName = String(fl.row(drop, 'Name'));
    var keepPerson = String(fl.row(keep, 'Person ID') || ''), dropPerson = String(fl.row(drop, 'Person ID') || '');
    ['Email', 'Flown'].forEach(function (h) { if (!fl.row(keep, h) && fl.row(drop, h)) fl.set(keep, h, fl.row(drop, h)); });
    if (dropPerson && keepPerson && dropPerson !== keepPerson) mergePeople(dropPerson, keepPerson);
    else if (dropPerson && !keepPerson) fl.set(keep, 'Person ID', dropPerson);
    // The booker's name follows the fuller one ("Braeden" becomes "Braeden Whatcott").
    if (String(bk.row(i, 'Name')).trim().toLowerCase() === dropName.trim().toLowerCase() && keepName.length > dropName.length) bk.set(i, 'Name', keepName);
    fl.del(drop);
    addNote(bk, i, 'merged flyer ' + dropName + ' into ' + keepName, user);
    recountWaivers(bk, i, id);
    return { ok: true };
  });
}

function adminFlyerRemove(id, flyerId, user) {
  return withLock(function () {
    var bk = bookingTab(), i = findBooking(bk, id);
    var fl = tab(CRM.FLYERS, CRM.FLYERS_HEADERS), k = flyerRows(fl, id)[flyerId];
    if (k == null) throw new Error('That flyer was not found. Reload the page.');
    var waiverId = String(fl.row(k, 'Waiver ID') || ''), name = String(fl.row(k, 'Name'));
    if (waiverId) {
      var wv = tab(WAIVER.TAB, WAIVER.HEADERS);
      for (var w = 0; w < wv.rows.length; w++) if (String(wv.row(w, 'ID')) === waiverId) { wv.set(w, 'Booking key', ''); wv.set(w, 'Flight date', ''); }
    }
    fl.del(k);
    addNote(bk, i, 'removed flyer ' + name, user);
    recountWaivers(bk, i, id);
    return { ok: true };
  });
}

/** The E-transfers row an admin action is about, as matchEtransfer reads it. */
function etransferRow(row) {
  var et = tab(ETRANSFER.TAB, ETRANSFER.HEADERS.concat(['Reviewed']));
  if (!(row >= 0 && row < et.rows.length)) throw new Error('That e-transfer was not found. Reload the page.');
  return { et: et, t: { amount: Number(et.row(row, 'Amount')), from: String(et.row(row, 'From')), deposited: et.row(row, 'Deposited') === 'Yes',
    reference: String(et.row(row, 'Interac reference')), message: String(et.row(row, 'Message')) } };
}

function markEtransfer(et, row, result, user) {
  et.set(row, 'Result', result);
  et.set(row, 'Reviewed', Utilities.formatDate(new Date(), BOOKING.TZ, 'yyyy-MM-dd') + ' ' + user.split('@')[0]);
}

/**
 * Certificates for an e-transfer that arrived without an order (a gift bought by e-transfer): a contact for the buyer,
 * one Vouchers row per flight (Type "etransfer", paid by that Interac transfer) and the usual certificate email.
 */
function adminEtransferIssue(p, user) {
  var name = clean(p.name), email = clean(p.email).toLowerCase();
  var quantity = parseInt(p.quantity, 10), value = Number(p.value);
  var recipient = clean(p.recipient), message = clean(p.message);
  if (!name) return { ok: false, error: 'Enter the buyer\'s name.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter an email address for the certificate.' };
  if (!(quantity >= 1 && quantity <= ETRANSFER.MAX_QUANTITY)) return { ok: false, error: 'Choose how many flights.' };
  if (!(value > 0)) return { ok: false, error: 'Enter the value of each flight.' };
  var row = Number(p.row), codes = [];
  withLock(function () {
    var r = etransferRow(row);
    upsertPerson(tab(CRM.PEOPLE, CRM.PEOPLE_HEADERS), { name: name, email: email }, 'E-transfer');
    var sh = vouchersSheet();
    var existing = {};
    sh.getDataRange().getValues().forEach(function (x) { if (x[0]) existing[x[0]] = true; });
    var now = new Date(), add = [];
    for (var i = 0; i < quantity; i++) {
      var code = randomCode(existing);
      codes.push(code);
      var v = new Array(VOUCHER.HEADERS.length).fill('');
      v[VC['Code'] - 1] = code;
      v[VC['Payment ID'] - 1] = 'Interac ' + r.t.reference;
      v[VC['Issued'] - 1] = now;
      v[VC['Buyer name'] - 1] = name;
      v[VC['Buyer email'] - 1] = email;
      v[VC['For'] - 1] = recipient;
      v[VC['Message'] - 1] = message;
      v[VC['Type'] - 1] = 'etransfer';
      v[VC['Value'] - 1] = value;
      v[VC['Status'] - 1] = 'Issued';
      v[VC['Notes'] - 1] = 'Issued from an e-transfer from ' + r.t.from + ' by ' + user.split('@')[0];
      add.push(v);
    }
    sh.getRange(sh.getLastRow() + 1, 1, add.length, add[0].length).setValues(add);
    markEtransfer(r.et, row, 'Paid: certificates issued (' + codes.join(', ') + ')', user);
  });
  sendVouchers({ name: name, email: email, recipient: recipient }, codes.map(function (c) { return { code: c, recipient: recipient, message: message, value: value }; }));
  logMessage(email, 'Certificate' + (codes.length > 1 ? 's ' : ' ') + codes.join(', '), '', user);
  return { ok: true, codes: codes };
}

/** An e-transfer sent without its reference, counted against an order that is waiting for it. */
function adminEtransferApply(row, reference, user) {
  var r = etransferRow(row);
  var result = matchEtransfer(reference, r.t);
  if (!/^Paid/.test(result)) return { ok: false, error: result + '.' };
  var again = etransferRow(row);
  markEtransfer(again.et, row, result + ' (' + reference + ', applied by hand)', user);
  return { ok: true };
}
