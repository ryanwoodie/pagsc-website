/**
 * Discovery Flights paid by Interac e-transfer, matched automatically from the club's Gmail.
 *
 *   POST form=etransfer      Buy certificates by e-transfer (/discovery-flight/e-transfer/): one row per flight in the
 *                            Vouchers tab, Type "etransfer", Status "Awaiting e-transfer", no code yet. The buyer gets
 *                            a reference (ET-XXXX-XXXX) to put in the e-transfer message.
 *   Booking with payment     The calendar's "I'll pay now by e-transfer": the booking holds the slot like a paid
 *   "E-transfer"             flight, and its rows carry the booking token and a "Pay by" time.
 *
 * Every 10 minutes (runReminders) checkEtransfers reads new Interac "automatically deposited" emails from
 * notify@payments.interac.ca (DKIM-checked), finds an ET- reference in the message and checks the amount. A match
 * issues the certificate codes: booked ones become Booked and the guest is told the payment arrived; the rest get the
 * usual certificate email. Every e-transfer seen goes in the "E-transfers" tab, matched or not, so dues and other
 * payments can be told apart by eye. A booking not paid by its "Pay by" time is released and the guest emailed; the
 * reference still works if they pay later (they get certificates and rebook).
 *
 * The script reads the club Gmail, so deploying it needs the club account to approve Gmail access once in the editor
 * (run checkEtransfers).
 */

var ETRANSFER = {
  GROUP_PRICE: 40,        // discovery_flight.group_price_each in content/club-facts.yaml
  GROUP_MIN: 4,           // discovery_flight.group_minimum
  MAX_QUANTITY: 10,       // flights in one e-transfer purchase
  HOLD_HOURS: 48,         // a booking paid by e-transfer is held this long...
  LEAD_MINUTES: 30,       // ...or until this long before the flight, whichever is sooner (same-day bookings start an hour out)
  TAB: 'E-transfers',
  HEADERS: ['Received', 'From', 'Amount', 'Message', 'Interac reference', 'Deposited', 'Our reference', 'Result', 'Message ID'],
  SEARCH: 'from:notify@payments.interac.ca newer_than:14d',
  STATUS: 'Awaiting e-transfer'
};

// ---------- Pure logic (tested in scripts/etransfer.test.mjs) ----------

/** "ET-XXXX-XXXX" from 8 random bytes. */
function makeReference(bytes) {
  return makeCode(bytes).replace(/^PAGSC-/, 'ET-');
}

/** The first ET- reference in any text, tidied ("et 7kq2xm9d" -> "ET-7KQ2-XM9D"), or ''. */
function findReference(text) {
  var re = /\bET[\s\-–_.:#]*([A-Z0-9]{4})[\s\-–_.]*([A-Z0-9]{4})\b/gi, m;
  while ((m = re.exec(String(text || '')))) {
    var s = (m[1] + m[2]).toUpperCase();
    var ok = true;
    for (var i = 0; i < 8; i++) if (VOUCHER.ALPHABET.indexOf(s.charAt(i)) < 0) ok = false;
    if (ok) return 'ET-' + s.slice(0, 4) + '-' + s.slice(4);
  }
  return '';
}

/** Price per flight for a purchase of n flights. */
function etransferEach(n) {
  return n >= ETRANSFER.GROUP_MIN ? ETRANSFER.GROUP_PRICE : VOUCHER.PRICE;
}

/** When a booking made at createdMs for date + start (field time, UTC-6 all year) must be paid by, in ms. */
function payByMs(createdMs, date, start) {
  var flight = Date.parse(date + 'T' + start + ':00-06:00');
  return Math.min(createdMs + ETRANSFER.HOLD_HOURS * 3600000, flight - ETRANSFER.LEAD_MINUTES * 60000);
}

/**
 * Reads an Interac notification: {amount, from, deposited, reference (Interac's), message (whole text)}.
 * Subject e.g. "Interac e-Transfer: You've received $50.00 from Kim's Pet Grooming and it has been automatically deposited."
 */
function parseInterac(subject, body) {
  subject = String(subject || '');
  body = String(body || '');
  var m = /received \$([\d,]+\.\d{2}) from (.+?)(?: and it has been automatically deposited|\.?$)/i.exec(subject);
  var amount = m ? Number(m[1].replace(/,/g, '')) : NaN;
  if (isNaN(amount)) {
    var a = /Amount:\s*\$([\d,]+\.\d{2})/i.exec(body);
    amount = a ? Number(a[1].replace(/,/g, '')) : NaN;
  }
  var from = m ? m[2].trim() : ((/Sent From:\s*(.+)/i.exec(body) || [])[1] || '').trim();
  var ref = (/Reference Number:\s*([A-Za-z0-9]+)/i.exec(body) || [])[1] || '';
  var msg = (/Message:\s*([\s\S]*?)\n\s*(?:Date|Reference Number|Sent From|Amount):/i.exec(body) || [])[1] || '';
  return {
    amount: amount,
    from: from,
    deposited: /automatically deposited|funds deposited/i.test(subject + ' ' + body),
    reference: ref,
    message: msg.replace(/\s+/g, ' ').trim()
  };
}

/** True when Gmail's Authentication-Results show a DKIM pass for interac.ca. */
function interacSigned(authResults) {
  return /dkim=pass[^;]*header\.(?:i=@?|d=)(?:[\w-]+\.)*interac\.ca(?=[\s;)]|$)/i.test(String(authResults || ''));
}

/** "Sunday, October 18 at 1:30 pm" for a time in ms. */
function payByText(ms) {
  var d = new Date(ms - 6 * 3600000); // field time
  var iso = d.toISOString();
  return longDate(iso.slice(0, 10)) + ' at ' + clock12(iso.slice(11, 16));
}

/** The "how to pay" panel in emails. */
function etransferHtml(o, links) {
  return panel(label('Pay by e-transfer') +
    '<div style="font-family:' + EMAIL.BODY + ';font-size:16px;line-height:1.5;color:' + EMAIL.INK + '">' +
    'Send <strong>' + esc(dollars(o.amount)) + '</strong> to <strong>' + esc(links.email) + '</strong><br>' +
    'Put this in the message: <strong style="font-family:Menlo,Consolas,monospace;font-size:18px">' + esc(o.reference) + '</strong>' +
    (o.payBy ? '<br>Please send it by ' + esc(o.payBy) + ', or the spot is released.' : '') +
    '</div>', true);
}

function etransferText(o, links) {
  return 'Pay by e-transfer: send ' + dollars(o.amount) + ' to ' + links.email + ' and put ' + o.reference + ' in the message.' +
    (o.payBy ? ' Please send it by ' + o.payBy + ', or the spot is released.' : '');
}

/** Sent when someone buys by e-transfer without booking. */
function etransferOrderEmail(o, links) {
  var first = String(o.name).split(/\s+/)[0];
  var flights = o.quantity > 1 ? o.quantity + ' Discovery Flights' : 'a Discovery Flight';
  var body = heading('Pay by e-transfer') +
    para('Hi ' + esc(first) + ', thanks for choosing ' + esc(flights) + '.') +
    etransferHtml(o, links) +
    para('When your e-transfer arrives, we email you ' + (o.quantity > 1 ? 'the certificates, each with a booking code' : 'your certificate with its booking code') + '. Then pick your flying day on the calendar. Certificates never expire.') +
    para('<span style="font-size:14px;color:' + EMAIL.GREY + '">Questions? Just reply to this email.</span>');
  return {
    subject: 'Pay by e-transfer: ' + o.reference,
    html: layout('Send ' + dollars(o.amount) + ' with ' + o.reference + ' in the message.', body, links),
    text: ['Hi ' + first + ',', '', 'Thanks for choosing ' + flights + '.', '', etransferText(o, links), '',
      'When your e-transfer arrives, we email you ' + (o.quantity > 1 ? 'the certificates' : 'your certificate') + '. Then pick your flying day on the calendar.', '', EMAIL.CLUB].join('\n')
  };
}

/** Sent when the e-transfer for a booking arrives. */
function etransferPaidEmail(b, held, links) {
  var first = String(b.name).split(/\s+/)[0];
  var body = heading('Payment received') +
    para('Hi ' + esc(first) + ', your e-transfer arrived. Thank you.') +
    whenPanel(b, held ? (b.confirmed ? 'Booked in' : 'Your flight time') : 'Your weekday request') +
    para('Your booking stands as it is. We will send a reminder before the day with the latest from the field.') +
    changeHtml(links);
  return {
    subject: 'Payment received: ' + whenText(b),
    html: layout('Your e-transfer arrived.', body, links),
    text: ['Hi ' + first + ',', '', 'Your e-transfer arrived. Thank you. Your booking stands: ' + whenText(b) + '.', '', changeText(links), '', EMAIL.CLUB].join('\n')
  };
}

/** Sent when a booking's e-transfer did not arrive in time. */
function etransferReleasedEmail(b, reference, links) {
  var first = String(b.name).split(/\s+/)[0];
  var body = heading('Your spot was released') +
    para('Hi ' + esc(first) + ', we did not receive your e-transfer in time, so your spot on ' + esc(longDate(b.date)) + ' at ' + esc(clock12(b.start)) + ' is free again.') +
    para('If you still send it, with ' + esc(reference) + ' in the message, we will email you a certificate to book another day.') +
    button('Pick another day', links.calendar);
  return {
    subject: 'Spot released: ' + longDate(b.date),
    html: layout('We did not receive your e-transfer in time.', body, links),
    text: ['Hi ' + first + ',', '', 'We did not receive your e-transfer in time, so your spot on ' + longDate(b.date) + ' at ' + clock12(b.start) + ' is free again.', '',
      'If you still send it, with ' + reference + ' in the message, we will email you a certificate to book another day: ' + links.calendar, '', EMAIL.CLUB].join('\n')
  };
}

// ---------- Google services ----------

function etransferSheet() {
  return sheet(ETRANSFER.TAB, ETRANSFER.HEADERS);
}

function newReference(rows) {
  var existing = {};
  rows.forEach(function (r) { existing[String(r[VC['Session ID'] - 1])] = true; });
  for (var tries = 0; tries < 20; tries++) {
    var hex = Utilities.getUuid().replace(/-/g, '');
    var bytes = [];
    for (var i = 0; i < 8; i++) bytes.push(parseInt(hex.substr(i * 2, 2), 16));
    var ref = makeReference(bytes);
    if (!existing[ref]) return ref;
  }
  throw new Error('Could not make a unique reference');
}

/**
 * Add an e-transfer order to the Vouchers tab: one row per flight, Status "Awaiting e-transfer", no code yet.
 * booking (optional) = {token, date, payBy (Date)}. Returns {reference, quantity, each, amount}. Call inside the lock.
 */
function addEtransferOrder(o, booking) {
  var sh = vouchersSheet();
  var reference = newReference(sh.getDataRange().getValues().slice(1));
  var each = etransferEach(o.quantity), now = new Date(), add = [];
  for (var i = 0; i < o.quantity; i++) {
    var row = new Array(VOUCHER.HEADERS.length).fill('');
    row[VC['Session ID'] - 1] = reference;
    row[VC['Issued'] - 1] = now;
    row[VC['Buyer name'] - 1] = o.name;
    row[VC['Buyer email'] - 1] = o.email;
    row[VC['For'] - 1] = o.recipient || '';
    row[VC['Message'] - 1] = o.message || '';
    row[VC['Type'] - 1] = 'etransfer';
    row[VC['Value'] - 1] = each;
    row[VC['Status'] - 1] = ETRANSFER.STATUS;
    if (booking) {
      row[VC['Booking token'] - 1] = booking.token;
      row[VC['Booked date'] - 1] = booking.date;
      row[VC['Pay by'] - 1] = booking.payBy;
    }
    add.push(row);
  }
  sh.getRange(sh.getLastRow() + 1, 1, add.length, add[0].length).setValues(add);
  return { reference: reference, quantity: o.quantity, each: each, amount: each * o.quantity };
}

/** POST form=etransfer: buy certificates, pay by e-transfer. */
function etransferPost(p) {
  var o = {
    name: clean(p.name),
    email: clean(p.email),
    quantity: parseInt(p.quantity, 10),
    recipient: clean(p.recipient),
    message: clean(p.gift_message)
  };
  var problems = [];
  if (!o.name) problems.push('your name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email)) problems.push('a valid email address');
  if (!(o.quantity >= 1 && o.quantity <= ETRANSFER.MAX_QUANTITY)) problems.push('how many flights');
  if (problems.length) return json({ ok: false, error: 'We still need ' + problems.join(', ') + '.' });

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  var order;
  try {
    order = addEtransferOrder(o, null);
  } finally {
    lock.releaseLock();
  }
  var links = voucherLinks();
  var mail = etransferOrderEmail({ name: o.name, quantity: o.quantity, amount: order.amount, reference: order.reference }, links);
  sendGuestEmail(o.email, mail);
  MailApp.sendEmail({
    to: links.email,
    replyTo: o.email,
    subject: 'E-transfer order: ' + o.name + ' (' + o.quantity + ', ' + dollars(order.amount) + ', ' + order.reference + ')',
    body: o.name + ' <' + o.email + '> chose to pay ' + dollars(order.amount) + ' by e-transfer for ' + o.quantity + ' Discovery Flight' + (o.quantity > 1 ? 's' : '') + '.\n' +
      (o.recipient ? 'For: ' + o.recipient + '\n' : '') + 'Reference: ' + order.reference + '\n\n' +
      'When the e-transfer arrives with the reference, the certificates are issued and emailed automatically. Rows are in the "' + VOUCHER.TAB + '" tab.'
  });
  return json({ ok: true, reference: order.reference, amount: order.amount, email: o.email, to: links.email });
}

/** Every 10 minutes: match new Interac emails, then release unpaid holds. */
function checkEtransfers() {
  var props = PropertiesService.getScriptProperties();
  var seen = (props.getProperty('ETRANSFER_SEEN') || '').split(',').filter(String);
  var log = etransferSheet();
  GmailApp.search(ETRANSFER.SEARCH, 0, 50).forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      var id = msg.getId();
      if (seen.indexOf(id) >= 0) return;
      seen.push(id);
      if (!/notify@payments\.interac\.ca/i.test(msg.getFrom()) || !interacSigned(msg.getHeader('Authentication-Results'))) {
        log.appendRow([msg.getDate(), msg.getFrom(), '', '', '', '', '', 'Ignored: not signed by Interac', id]);
        return;
      }
      var t = parseInterac(msg.getSubject(), msg.getPlainBody());
      if (isNaN(t.amount)) return; // not a money-received notice
      var ours = findReference(t.message) || findReference(msg.getPlainBody());
      var result = ours ? matchEtransfer(ours, t) : 'No reference';
      log.appendRow([msg.getDate(), t.from, t.amount, t.message, t.reference, t.deposited ? 'Yes' : 'No', ours, result, id]);
    });
  });
  props.setProperty('ETRANSFER_SEEN', seen.slice(-500).join(','));
  releaseUnpaid();
}

/** Apply a received e-transfer to its order. Returns what happened, for the E-transfers tab. */
function matchEtransfer(reference, t) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var paid, order, codes = [];
  try {
    var sh = vouchersSheet();
    var rows = sh.getDataRange().getValues();
    var mine = [];
    for (var i = 1; i < rows.length; i++) if (rows[i][VC['Session ID'] - 1] === reference) mine.push(i);
    if (!mine.length) return 'Unknown reference';
    var waiting = mine.filter(function (i) { return rows[i][VC['Status'] - 1] === ETRANSFER.STATUS; });
    if (!waiting.length) return 'Already paid';
    var due = waiting.reduce(function (s, i) { return s + Number(rows[i][VC['Value'] - 1]); }, 0);
    if (!t.deposited) return 'Not deposited yet: check the bank';
    if (t.amount + 0.001 < due) {
      MailApp.sendEmail({ to: prop('CLUB_EMAIL'), subject: 'E-transfer short: ' + reference + ' (' + dollars(t.amount) + ' of ' + dollars(due) + ')',
        body: t.from + ' sent ' + dollars(t.amount) + ' with ' + reference + ', but the order is ' + dollars(due) + '. Nothing was confirmed. Sort it out with them, then set the rows\' Status in the "' + VOUCHER.TAB + '" tab by hand.' });
      return 'Short: ' + dollars(due) + ' due';
    }
    var existing = {};
    rows.forEach(function (r) { if (r[0]) existing[r[0]] = true; });
    var r0 = rows[waiting[0]];
    var token = String(r0[VC['Booking token'] - 1] || '');
    waiting.forEach(function (i) {
      var code = randomCode(existing);
      codes.push(code);
      sh.getRange(i + 1, VC['Code']).setValue(code);
      sh.getRange(i + 1, VC['Payment ID']).setValue('Interac ' + t.reference);
      sh.getRange(i + 1, VC['Status']).setValue(rows[i][VC['Booking token'] - 1] ? 'Booked' : 'Issued');
    });
    SpreadsheetApp.flush();
    order = { name: String(r0[VC['Buyer name'] - 1]), email: String(r0[VC['Buyer email'] - 1]), recipient: String(r0[VC['For'] - 1]),
      message: String(r0[VC['Message'] - 1]), each: Number(r0[VC['Value'] - 1]), token: token };
    paid = true;
  } finally {
    lock.releaseLock();
  }
  if (!paid) return '';
  var booking = order.token ? markBookingPaid(order.token, codes) : null;
  if (booking) {
    var links = emailLinks(order.token, booking.waiverKey);
    sendGuestEmail(booking.b.email, etransferPaidEmail(booking.b, booking.held, links));
  } else {
    sendVouchers({ name: order.name, email: order.email, recipient: order.recipient },
      codes.map(function (c) { return { code: c, recipient: order.recipient, message: order.message, value: order.each }; }));
  }
  MailApp.sendEmail({ to: prop('CLUB_EMAIL'), subject: 'E-transfer received: ' + order.name + ' (' + dollars(t.amount) + ', ' + reference + ')',
    body: t.from + ' sent ' + dollars(t.amount) + ' with ' + reference + '. ' + (booking ? 'Their booking for ' + whenText(booking.b) + ' is paid.' : 'The certificates were emailed.') + '\nCodes: ' + codes.join(', ') });
  return booking ? 'Paid: booking ' + booking.b.date : 'Paid: certificates emailed';
}

/** Note the payment on the booking. Returns {b, held, waiverKey} for an active booking, or null. */
function markBookingPaid(token, codes) {
  var sh = bookingsSheet();
  var rows = sh.getDataRange().getValues();
  var col = function (name) { return BOOKING.HEADERS.indexOf(name); };
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (r[col('Token')] !== token) continue;
    if (r[col('Status')] === 'Cancelled') return null;
    sh.getRange(i + 1, col('Payment') + 1).setValue('E-transfer (paid)');
    sh.getRange(i + 1, col('Certificates') + 1).setValue(codes.join(', '));
    var b = { date: isoOf(r[col('Date')]), start: hhmmOf(r[col('Start')]), people: Number(r[col('People')]) || 1, name: String(r[col('Name')]), email: String(r[col('Email')]) };
    return { b: b, held: r[col('Status')] === 'Held', waiverKey: String(r[col('Waiver key')] || '') };
  }
  return null;
}

/** Release bookings whose e-transfer has not arrived by their Pay by time. */
function releaseUnpaid() {
  var vs = vouchersSheet();
  var vrows = vs.getDataRange().getValues();
  var now = Date.now(), tokens = {};
  for (var i = 1; i < vrows.length; i++) {
    var r = vrows[i], payBy = r[VC['Pay by'] - 1];
    if (r[VC['Status'] - 1] !== ETRANSFER.STATUS || !r[VC['Booking token'] - 1] || !(payBy instanceof Date) || payBy.getTime() > now) continue;
    tokens[r[VC['Booking token'] - 1]] = String(r[VC['Session ID'] - 1]);
  }
  Object.keys(tokens).forEach(function (token) {
    var sh = bookingsSheet();
    var rows = sh.getDataRange().getValues();
    for (var k = 1; k < rows.length; k++) {
      if (rows[k][12] !== token) continue;
      if (rows[k][5] !== 'Cancelled') {
        cancelBookingRow(sh, rows, k);
        var b = { date: isoOf(rows[k][1]), start: hhmmOf(rows[k][2]), name: String(rows[k][6]) };
        sendGuestEmail(String(rows[k][7]), etransferReleasedEmail(b, tokens[token], emailLinks('')));
        MailApp.sendEmail({ to: prop('CLUB_EMAIL'), subject: 'Unpaid booking released: ' + b.name + ', ' + longDate(b.date) + ' at ' + clock12(b.start),
          body: 'No e-transfer with ' + tokens[token] + ' arrived in time, so the booking was cancelled and the slot freed. If they paid without the reference, check the "' + ETRANSFER.TAB + '" tab.' });
      }
      break;
    }
    releaseCodes(token); // the order stays Awaiting e-transfer, without the booking
  });
}
