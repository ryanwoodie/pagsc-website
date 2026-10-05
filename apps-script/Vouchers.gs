/**
 * Discovery Flight certificates (vouchers) for flights bought online with Stripe.
 *
 * Buyers pay on a Stripe Payment Link, which sends them to /discovery-flight/paid/?session_id=…
 * That page asks this script (GET ?action=voucher&session_id=…) for the certificates. The script
 * fetches the Checkout Session from Stripe with STRIPE_KEY, checks it is paid, and issues one code
 * per flight: a row each in the "Vouchers" tab, and one email to the buyer with a PDF certificate
 * per flight. An hourly job (syncStripe) does the same for buyers who closed the tab, and marks
 * refunded flights. Each Checkout Session issues certificates once.
 *
 * Booking with a code (Booking.gs) marks it Booked; cancelling returns it to Issued. The club sets
 * Flown by hand. Certificates never expire.
 *
 * Manual certificates (cash, e-transfer): add a row to the Vouchers tab with Type "manual",
 * Buyer name, Buyer email and optionally For and Message, and leave Code empty. Within the hour
 * the script fills in the code and emails the certificate. One row per flight.
 *
 * Script Property: STRIPE_KEY, a restricted key with read access to Checkout Sessions and Refunds.
 * One-time setup in the editor: run installVouchers (approves Stripe access and the hourly job).
 */

var VOUCHER = {
  TAB: 'Vouchers',
  HEADERS: ['Code', 'Session ID', 'Payment ID', 'Issued', 'Buyer name', 'Buyer email', 'For', 'Message',
    'Type', 'Value', 'Status', 'Booking token', 'Booked date', 'Flown date', 'Notes'],
  PRICE: 50,              // keep in step with discovery_flight.price in content/club-facts.yaml (manual certificates)
  ALPHABET: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', // no 0/O, 1/I/L
  SYNC_DAYS: 7,           // how far back the hourly job looks for paid sessions and refunds
  MAX_CODES: 4            // codes accepted with one booking (BOOKING.MAX_GROUP)
};

// Column numbers (1-based) in the Vouchers tab.
var VC = {};
VOUCHER.HEADERS.forEach(function (h, i) { VC[h] = i + 1; });

// ---------- Pure logic (tested in scripts/vouchers.test.mjs) ----------

/** "PAGSC-XXXX-XXXX" from 8 random bytes (0–255 each). */
function makeCode(bytes) {
  var a = VOUCHER.ALPHABET, s = '';
  for (var i = 0; i < 8; i++) s += a.charAt(bytes[i] % a.length);
  return 'PAGSC-' + s.slice(0, 4) + '-' + s.slice(4);
}

/** Tidy what a guest typed: "pagsc 7kq2xm9d" -> "PAGSC-7KQ2-XM9D"; '' if it cannot be a code. */
function normalizeCode(text) {
  var s = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.indexOf('PAGSC') === 0) s = s.slice(5);
  if (s.length !== 8) return '';
  for (var i = 0; i < 8; i++) if (VOUCHER.ALPHABET.indexOf(s.charAt(i)) < 0) return '';
  return 'PAGSC-' + s.slice(0, 4) + '-' + s.slice(4);
}

/** Codes from a comma, space or newline separated list, tidied, without repeats. Bad entries come back in `bad`. */
function parseCodes(text) {
  var out = { codes: [], bad: [] };
  String(text || '').split(/[,;\n]+/).forEach(function (part) {
    var raw = part.trim();
    if (!raw) return;
    var c = normalizeCode(raw);
    if (!c) out.bad.push(raw);
    else if (out.codes.indexOf(c) < 0) out.codes.push(c);
  });
  return out;
}

/**
 * The order in a Stripe Checkout Session (retrieved with line_items expanded).
 * @returns {sessionId, paymentId, paid, ours, type, name, email, quantity, value, recipient, message}
 */
function orderFromSession(s) {
  var cd = s.customer_details || {}, ci = s.collected_information || {};
  var field = function (key) {
    var f = (s.custom_fields || []).filter(function (x) { return x.key === key; })[0];
    return f && f.text && f.text.value ? String(f.text.value).trim() : '';
  };
  var items = (s.line_items && s.line_items.data) || [];
  var quantity = 0, total = 0;
  items.forEach(function (li) { quantity += Number(li.quantity) || 0; total += Number(li.amount_total) || 0; });
  var type = (s.metadata && s.metadata.pagsc_type) || '';
  return {
    sessionId: s.id,
    paymentId: typeof s.payment_intent === 'string' ? s.payment_intent : (s.payment_intent && s.payment_intent.id) || '',
    paid: s.status === 'complete' && s.payment_status === 'paid',
    ours: type === 'single' || type === 'group',
    type: type,
    name: String(ci.individual_name || cd.individual_name || cd.name || '').trim(),
    email: String(cd.email || s.customer_email || '').trim(),
    quantity: quantity,
    value: quantity ? Math.round(total / quantity) / 100 : 0,
    recipient: field('recipient'),
    message: field('giftmessage')
  };
}

/** How many flights a refund covers: the refunded amount over the price of one, at least 1. */
function flightsRefunded(refundCents, valueDollars) {
  if (!(valueDollars > 0)) return 1;
  return Math.max(1, Math.round(refundCents / (valueDollars * 100)));
}

/** The booking link printed on a certificate and in its QR code. */
function bookingLink(site, codes) {
  return site + '/discovery-flight/?code=' + codes.join(',') + '#request';
}

/** "$50" or "$40" */
function dollars(v) {
  return '$' + (Math.round(v) === v ? String(v) : v.toFixed(2));
}

// ---------- Certificate and email (pure string building) ----------

/**
 * One page per certificate. The banner (photo, title and club mark) is an image on the site,
 * because Google's HTML-to-PDF conversion only has basic fonts; everything that changes is HTML.
 * That conversion also drops table cell backgrounds, so colour comes from borders, text and images,
 * and the QR code is an embedded PNG.
 * @param vouchers [{code, recipient, message, value}]
 * @param links {site, email, phone}
 */
function certificateHtml(vouchers, links) {
  var SANS = 'Arial,Helvetica,sans-serif', NARROW = "'Barlow Condensed','Arial Narrow',Arial,sans-serif";
  var SERIF = 'Georgia,"Times New Roman",serif', MONO = "'Courier New',Courier,monospace";
  var site = links.site.replace(/^https?:\/\//, '');
  var label = function (t, color) {
    return '<div style="font-family:' + SANS + ';font-size:10px;font-weight:bold;letter-spacing:3px;text-transform:uppercase;color:' + (color || EMAIL.ORANGE_DARK) + ';margin:0 0 6px">' + t + '</div>';
  };
  var line = '<div style="border-bottom:1px solid ' + EMAIL.RULE + ';height:30px"></div>';
  var step = function (n, title, text) {
    return '<td width="33%" style="vertical-align:top;padding:0 10px">' +
      '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>' +
      '<td style="vertical-align:top;padding:0 8px 0 0;font-family:' + NARROW + ';font-size:28px;line-height:1;font-weight:bold;color:' + EMAIL.ORANGE + '">' + n + '</td>' +
      '<td style="vertical-align:top;font-family:' + SANS + ';font-size:12px;line-height:1.45;color:' + EMAIL.INK + '"><b>' + title + '</b><br>' + text + '</td>' +
      '</tr></table></td>';
  };
  var pages = vouchers.map(function (v, i) {
    var url = bookingLink(links.site, [v.code]);
    var who = v.recipient
      ? '<div style="font-family:' + NARROW + ';font-size:34px;line-height:1.1;font-weight:bold;color:' + EMAIL.INK + '">' + esc(v.recipient) + '</div>'
      : line;
    var msg = v.message
      ? '<div style="font-family:' + SERIF + ';font-style:italic;font-size:17px;line-height:1.5;color:' + EMAIL.INK + '">&ldquo;' + esc(v.message) + '&rdquo;</div>'
      : line + line;
    return '<div style="' + (i < vouchers.length - 1 ? 'page-break-after:always;' : '') + '">' +
      // Frame: navy outer rule, orange inner rule.
      '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:3px solid ' + EMAIL.INK + '"><tr><td style="padding:6px">' +
      '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ' + EMAIL.ORANGE + '"><tr><td style="padding:0">' +
      // Banner
      '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr><td style="background:' + EMAIL.INK + ';padding:0;line-height:0">' +
      '<img src="' + esc(links.site) + '/certificate/hero.jpg" width="704" height="372" alt="Discovery Flight" style="display:block;width:100%;height:auto;border:0"></td></tr></table>' +
      // Presented to, message, QR
      '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>' +
      '<td style="vertical-align:top;padding:30px 20px 26px 34px">' +
      label('Presented to') + who +
      '<div style="height:24px"></div>' + label('Message') + msg +
      '</td>' +
      '<td style="vertical-align:top;width:190px;padding:28px 34px 26px 0" align="center">' +
      '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:2px solid ' + EMAIL.INK + '"><tr><td style="padding:4px;line-height:0">' +
      '<img src="data:image/png;base64,' + qrBase64(qrPng(url, 6)) + '" width="160" height="160" alt="QR code to book" style="display:block;border:0"></td></tr></table>' +
      '<div style="font-family:' + SANS + ';font-size:10px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:' + EMAIL.INK + ';margin-top:8px;text-align:center">Scan to book your day</div>' +
      '</td></tr></table>' +
      // Code band: navy rules above and below
      '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr><td style="padding:0 34px">' +
      '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:3px solid ' + EMAIL.INK + ';border-bottom:3px solid ' + EMAIL.INK + '"><tr>' +
      '<td style="padding:16px 0;vertical-align:middle">' +
      label('Certificate code') +
      '<div style="font-family:' + MONO + ';font-size:32px;font-weight:bold;letter-spacing:3px;color:' + EMAIL.INK + '">' + esc(v.code) + '</div></td>' +
      '<td style="padding:16px 0;vertical-align:middle;text-align:right;white-space:nowrap">' +
      '<div style="font-family:' + NARROW + ';font-size:32px;font-weight:bold;color:' + EMAIL.ORANGE_DARK + '">Value ' + dollars(v.value) + '</div>' +
      '<div style="font-family:' + SANS + ';font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:' + EMAIL.INK + ';margin-top:2px">Never expires</div></td>' +
      '</tr></table></td></tr></table>' +
      // How to book
      '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr><td style="padding:22px 24px 6px">' +
      '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>' +
      step(1, 'Book your day', 'Scan the code or go to ' + esc(site) + '/discovery-flight, pick a day and a time, and enter the certificate code.') +
      step(2, 'Check the day is on', 'Flying is on weekends and holidays, spring to fall, weather permitting. If your day is cancelled, rebook at no charge.') +
      step(3, 'Come out and fly', 'Meet us at Birch Hills Airport, 25 minutes from Prince Albert. Bring a hat, sunscreen, water and layers.') +
      '</tr></table></td></tr>' +
      '<tr><td style="padding:12px 34px 16px;border-top:1px solid ' + EMAIL.RULE + ';font-family:' + SANS + ';font-size:11px;color:' + EMAIL.GREY + ';text-align:center">' +
      EMAIL.CLUB + ' &middot; ' + esc(links.email) + ' &middot; ' + esc(links.phone) + ' &middot; ' + esc(site) +
      '</td></tr></table>' +
      '</td></tr></table></td></tr></table></div>';
  });
  return '<!doctype html><html><head><meta charset="utf-8"><style>@page{size:letter;margin:0.4in}body{margin:0}</style></head><body>' + pages.join('') + '</body></html>';
}

/** Run from the editor to email the club a sample certificate PDF (two pages: filled in and blank). Issues nothing. */
function sendSampleCertificate() {
  sendVouchers({ name: 'Sample Buyer', email: prop('CLUB_EMAIL') }, [
    { code: 'PAGSC-SAMP-LE2X', recipient: 'Sample Recipient', message: 'Happy birthday! Enjoy the view from up there.', value: VOUCHER.PRICE },
    { code: 'PAGSC-SAMP-LE3X', recipient: '', message: '', value: VOUCHER.PRICE }
  ]);
}

/**
 * The email that carries the certificates.
 * @param order {name, quantity, recipient}
 * @param codes ['PAGSC-…']
 * @param links {site, email, phone}
 */
function voucherEmail(order, codes, links) {
  var first = String(order.name || '').split(/\s+/)[0];
  var many = codes.length > 1;
  var book = bookingLink(links.site, codes);
  var codeList = codes.map(function (c) {
    return '<div style="font-family:\'Courier New\',Courier,monospace;font-size:22px;font-weight:700;letter-spacing:1px;color:' + EMAIL.INK + '">' + esc(c) + '</div>';
  }).join('');
  var body = heading(many ? 'Your ' + codes.length + ' Discovery Flights are paid' : 'Your Discovery Flight is paid') +
    para('Hi ' + esc(first || 'there') + ',') +
    para(many
      ? 'Thanks for buying ' + codes.length + ' Discovery Flights. Each one has its own certificate, attached as a PDF to print or forward.'
      : 'Thanks for buying a Discovery Flight. Your certificate is attached as a PDF to print or forward.') +
    panel(label(many ? 'Certificate codes' : 'Certificate code') + codeList) +
    para('To book, pick a day and a time on the calendar and enter the code' + (many ? 's, one for each person flying' : '') + '. Certificates never expire, and if a day is cancelled you rebook at no charge.') +
    button('Book your flying day', book) +
    para('<span style="font-size:14px;color:' + EMAIL.GREY + '">Questions? Just reply to this email.</span>');
  return {
    subject: many ? 'Your ' + codes.length + ' Discovery Flight certificates' : 'Your Discovery Flight certificate',
    html: layout('Certificate code' + (many ? 's: ' : ': ') + codes.join(', '), body, links),
    text: [
      'Hi ' + (first || 'there') + ',', '',
      many ? 'Thanks for buying ' + codes.length + ' Discovery Flights. The certificates are attached.' : 'Thanks for buying a Discovery Flight. Your certificate is attached.', '',
      (many ? 'Certificate codes: ' : 'Certificate code: ') + codes.join(', '), '',
      'Book your flying day: ' + book, '',
      'Certificates never expire, and if a day is cancelled you rebook at no charge.', '',
      EMAIL.CLUB
    ].join('\n')
  };
}

// ---------- Google services ----------

/** Run once from the editor: approves Stripe access and installs the hourly syncStripe job. */
function installVouchers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncStripe') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncStripe').timeBased().everyHours(1).create();
  vouchersSheet();
  var r = stripeGet('/v1/checkout/sessions', { limit: 1 });
  Logger.log('Stripe key works (' + (r.data || []).length + ' recent session found). Hourly sync installed.');
}

function stripeGet(path, params) {
  var q = [];
  Object.keys(params || {}).forEach(function (k) {
    var v = params[k];
    (Array.isArray(v) ? v : [v]).forEach(function (x) { q.push(encodeURIComponent(k) + '=' + encodeURIComponent(x)); });
  });
  var res = UrlFetchApp.fetch('https://api.stripe.com' + path + (q.length ? '?' + q.join('&') : ''), {
    headers: { Authorization: 'Bearer ' + prop('STRIPE_KEY') },
    muteHttpExceptions: true
  });
  var body = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() >= 300) throw new Error('Stripe ' + res.getResponseCode() + ': ' + ((body.error && body.error.message) || 'error'));
  return body;
}

function vouchersSheet() {
  var sh = sheet(VOUCHER.TAB, VOUCHER.HEADERS);
  if (sh.getLastColumn() < VOUCHER.HEADERS.length) sh.getRange(1, 1, 1, VOUCHER.HEADERS.length).setValues([VOUCHER.HEADERS]);
  return sh;
}

function voucherLinks() {
  return { site: siteOrigin(), email: prop('CLUB_EMAIL'), phone: '(306) 222-5684' };
}

function randomCode(existing) {
  for (var tries = 0; tries < 20; tries++) {
    var hex = Utilities.getUuid().replace(/-/g, '');
    var bytes = [];
    for (var i = 0; i < 8; i++) bytes.push(parseInt(hex.substr(i * 2, 2), 16) ^ Math.floor(Math.random() * 256));
    var code = makeCode(bytes);
    if (!existing[code]) { existing[code] = true; return code; }
  }
  throw new Error('Could not make a unique code');
}

/** GET ?action=voucher&session_id=… from the paid page. */
function voucherResponse(sessionId) {
  sessionId = String(sessionId || '');
  if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId)) return { ok: false, error: 'not-found' };
  try {
    var r = issueForSession(sessionId);
    if (!r) return { ok: false, error: 'pending' };
    return { ok: true, codes: r.codes, email: r.email, recipient: r.recipient };
  } catch (err) {
    console.error(err);
    return { ok: false, error: 'unavailable' };
  }
}

/** Certificates already issued for a session: {codes, email, recipient} or null. */
function issuedFor(rows, sessionId) {
  var codes = [], email = '', recipient = '';
  rows.forEach(function (r) {
    if (r[VC['Session ID'] - 1] !== sessionId) return;
    codes.push(String(r[VC['Code'] - 1]));
    email = String(r[VC['Buyer email'] - 1]);
    recipient = String(r[VC['For'] - 1]);
  });
  return codes.length ? { codes: codes, email: email, recipient: recipient } : null;
}

/**
 * Issue certificates for a paid Checkout Session, once. Returns {codes, email, recipient},
 * or null if it is not paid yet. `session` may be passed in when already fetched with line items.
 */
function issueForSession(sessionId, session) {
  var sh = vouchersSheet();
  var done = issuedFor(sh.getDataRange().getValues().slice(1), sessionId);
  if (done) return done;

  var s = session && session.line_items ? session : stripeGet('/v1/checkout/sessions/' + encodeURIComponent(sessionId), { 'expand[]': 'line_items' });
  var order = orderFromSession(s);
  if (!order.paid) return null;
  if (!order.ours || !order.quantity) throw new Error('Session ' + sessionId + ' is not a Discovery Flight purchase');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var codes = [];
  try {
    var rows = sh.getDataRange().getValues().slice(1);
    done = issuedFor(rows, sessionId);
    if (done) return done;
    var existing = {};
    rows.forEach(function (r) { existing[r[0]] = true; });
    var now = new Date(), add = [];
    for (var i = 0; i < order.quantity; i++) {
      var code = randomCode(existing);
      codes.push(code);
      add.push([code, sessionId, order.paymentId, now, clean(order.name), clean(order.email), clean(order.recipient), clean(order.message),
        order.type, order.value, 'Issued', '', '', '', '']);
    }
    sh.getRange(sh.getLastRow() + 1, 1, add.length, add[0].length).setValues(add);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  sendVouchers(order, codes.map(function (c) { return { code: c, recipient: order.recipient, message: order.message, value: order.value }; }));
  MailApp.sendEmail({
    to: prop('CLUB_EMAIL'),
    replyTo: order.email,
    subject: 'Discovery Flight bought online: ' + order.name + ' (' + order.quantity + (order.type === 'group' ? ', group rate' : '') + ')',
    body: order.name + ' <' + order.email + '> bought ' + order.quantity + ' Discovery Flight' + (order.quantity > 1 ? 's' : '') + ' at ' + dollars(order.value) + ' each.\n' +
      (order.recipient ? 'For: ' + order.recipient + '\n' : '') +
      'Codes: ' + codes.join(', ') + '\n\n' +
      'The certificates were emailed to the buyer. They are in the "' + VOUCHER.TAB + '" tab.'
  });
  return { codes: codes, email: order.email, recipient: order.recipient };
}

/** Email the buyer one message with a PDF holding a page per certificate. */
function sendVouchers(order, vouchers) {
  var links = voucherLinks();
  var codes = vouchers.map(function (v) { return v.code; });
  var mail = voucherEmail(order, codes, links);
  var pdf = Utilities.newBlob(certificateHtml(vouchers, links), 'text/html', 'certificate.html').getAs('application/pdf')
    .setName(codes.length > 1 ? 'PAGSC Discovery Flight certificates.pdf' : 'PAGSC Discovery Flight certificate ' + codes[0] + '.pdf');
  MailApp.sendEmail({
    to: order.email, replyTo: links.email, name: EMAIL.CLUB,
    subject: mail.subject, body: mail.text, htmlBody: mail.html, attachments: [pdf]
  });
}

/** Hourly: certificates for paid sessions not yet issued, manual rows without a code, and refunds. */
function syncStripe() {
  var since = Math.floor(Date.now() / 1000) - VOUCHER.SYNC_DAYS * 86400;
  try {
    var list = stripeGet('/v1/checkout/sessions', { status: 'complete', 'created[gte]': since, limit: 100, 'expand[]': 'data.line_items' });
    (list.data || []).forEach(function (s) {
      var o = orderFromSession(s);
      if (!o.paid || !o.ours) return;
      try { issueForSession(s.id, s); } catch (err) { console.error(err); }
    });
  } catch (err) {
    console.error(err);
  }
  issueManualVouchers();
  try { markRefunds(since); } catch (err) { console.error(err); }
}

function issueManualVouchers() {
  var sh = vouchersSheet();
  var rows = sh.getDataRange().getValues();
  var existing = {};
  rows.forEach(function (r) { if (r[0]) existing[r[0]] = true; });
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var email = String(r[VC['Buyer email'] - 1]).trim();
    if (r[0] || String(r[VC['Type'] - 1]).toLowerCase() !== 'manual' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    var code = randomCode(existing);
    var value = Number(r[VC['Value'] - 1]) || VOUCHER.PRICE;
    sh.getRange(i + 1, VC['Code']).setValue(code);
    sh.getRange(i + 1, VC['Issued']).setValue(new Date());
    sh.getRange(i + 1, VC['Value']).setValue(value);
    sh.getRange(i + 1, VC['Status']).setValue('Issued');
    SpreadsheetApp.flush();
    var order = { name: String(r[VC['Buyer name'] - 1]), email: email, recipient: String(r[VC['For'] - 1]) };
    sendVouchers(order, [{ code: code, recipient: order.recipient, message: String(r[VC['Message'] - 1]), value: value }]);
  }
}

/** Mark refunded flights. Refund IDs already handled are kept in a Script Property. */
function markRefunds(since) {
  var props = PropertiesService.getScriptProperties();
  var seen = (props.getProperty('STRIPE_REFUNDS_DONE') || '').split(',').filter(String);
  var refunds = stripeGet('/v1/refunds', { 'created[gte]': since, limit: 100 }).data || [];
  var sh = vouchersSheet();
  refunds.forEach(function (rf) {
    if (rf.status !== 'succeeded' || !rf.payment_intent || seen.indexOf(rf.id) >= 0) return;
    var rows = sh.getDataRange().getValues();
    var mine = [];
    for (var i = 1; i < rows.length; i++) if (rows[i][VC['Payment ID'] - 1] === rf.payment_intent) mine.push(i);
    seen.push(rf.id);
    if (!mine.length) return;
    var n = flightsRefunded(rf.amount, Number(rows[mine[0]][VC['Value'] - 1]));
    // Refund unused certificates first.
    var order = { Issued: 0, Booked: 1, Flown: 2 };
    mine = mine.filter(function (i) { return rows[i][VC['Status'] - 1] !== 'Refunded'; })
      .sort(function (a, b) { return (order[rows[a][VC['Status'] - 1]] || 0) - (order[rows[b][VC['Status'] - 1]] || 0); })
      .slice(0, n);
    var used = [];
    mine.forEach(function (i) {
      if (rows[i][VC['Status'] - 1] !== 'Issued') used.push(rows[i][0] + ' (' + rows[i][VC['Status'] - 1] + ')');
      sh.getRange(i + 1, VC['Status']).setValue('Refunded');
      sh.getRange(i + 1, VC['Notes']).setValue(String(rows[i][VC['Notes'] - 1] || '') + (rows[i][VC['Notes'] - 1] ? '; ' : '') + 'Refund ' + rf.id);
    });
    MailApp.sendEmail({
      to: prop('CLUB_EMAIL'),
      subject: 'Discovery Flight refunded: ' + mine.map(function (i) { return rows[i][0]; }).join(', '),
      body: 'A Stripe refund of ' + dollars(rf.amount / 100) + ' marked ' + mine.length + ' certificate' + (mine.length === 1 ? '' : 's') + ' Refunded in the "' + VOUCHER.TAB + '" tab.' +
        (used.length ? '\n\nThese had already been used for a booking: ' + used.join(', ') + '. Check the booking.' : '')
    });
  });
  props.setProperty('STRIPE_REFUNDS_DONE', seen.slice(-300).join(','));
}

/**
 * Check codes for a booking. Returns {error} or {rows: [sheet row numbers]}.
 * Call inside the script lock.
 */
function checkCodes(codes, people) {
  if (codes.length > people) return { error: 'You entered ' + codes.length + ' codes for ' + people + (people === 1 ? ' person' : ' people') + '. Enter one code for each person flying.' };
  if (!codes.length) return { rows: [] };
  var rows = vouchersSheet().getDataRange().getValues();
  var found = [];
  for (var k = 0; k < codes.length; k++) {
    var at = -1;
    for (var i = 1; i < rows.length; i++) if (rows[i][0] === codes[k]) { at = i; break; }
    if (at < 0) return { error: 'We could not find the code ' + codes[k] + '. Check it against your certificate.' };
    var status = rows[at][VC['Status'] - 1];
    if (status === 'Booked') return { error: 'The code ' + codes[k] + ' is already used for a booking. To change the day, use the "Change or cancel" link in your booking email first.' };
    if (status === 'Flown') return { error: 'The code ' + codes[k] + ' has already been flown.' };
    if (status === 'Refunded') return { error: 'The code ' + codes[k] + ' was refunded.' };
    if (status !== 'Issued') return { error: 'The code ' + codes[k] + ' cannot be used. Please email us.' };
    found.push(at + 1);
  }
  return { rows: found };
}

function markCodesBooked(sheetRows, token, date) {
  var sh = vouchersSheet();
  sheetRows.forEach(function (r) {
    sh.getRange(r, VC['Status']).setValue('Booked');
    sh.getRange(r, VC['Booking token']).setValue(token);
    sh.getRange(r, VC['Booked date']).setValue(date);
  });
}

/** When a booking is cancelled, its certificates can be used again. */
function releaseCodes(token) {
  if (!token) return;
  var sh = vouchersSheet();
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][VC['Booking token'] - 1] !== token || rows[i][VC['Status'] - 1] !== 'Booked') continue;
    sh.getRange(i + 1, VC['Status']).setValue('Issued');
    sh.getRange(i + 1, VC['Booking token']).setValue('');
    sh.getRange(i + 1, VC['Booked date']).setValue('');
  }
}
