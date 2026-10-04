/**
 * PAGSC website forms.
 *
 * A Google Apps Script web app, owned by the club's Google account. Two forms post here:
 *   form=flight  Discovery Flight requests: added to the "Guest requests" tab and emailed to the club.
 *   form=pack    Welcome pack requests from prospective students: the visitor is emailed a link
 *                to the pack, and the request is added to the "Student leads" tab and emailed to the club.
 *
 * Settings live in Project Settings > Script Properties, not in this file:
 *   SHEET_ID     the spreadsheet that holds the "Guest requests" tab
 *   CLUB_EMAIL   where request emails go
 *   SITE_ORIGINS comma-separated origins allowed as the return page, e.g.
 *                https://www.pagsc.ca,https://<account>.github.io
 *
 * Deploy notes: apps-script/README.md
 */

var TAB = 'Guest requests';
var HEADERS = ['Received', 'Name', 'Email', 'Phone', 'Flyers', 'Preferred dates', 'Weight confirmed', 'Message', 'Page', 'Payment'];
var LEADS_TAB = 'Student leads';
var LEADS_HEADERS = ['Received', 'Name', 'Email', 'Page'];
var MAX = 2000; // longest accepted field, in characters

function doPost(e) {
  var p = (e && e.parameter) || {};
  var next = safeNext(p.next);

  // Honeypot: people never see this field; bots fill it. Drop silently.
  if (p.website) return redirect(next);

  if (p.form === 'pack') return packRequest(p, next);

  var req = {
    name: clean(p.name),
    email: clean(p.email),
    phone: clean(p.phone),
    flyers: parseInt(p.flyers, 10),
    dates: clean(p.dates),
    weightOk: p.weight_ok === 'yes',
    message: clean(p.message),
    page: clean(p.page),
    payment: clean(p.payment) || 'Not stated'
  };

  var problems = validate(req);
  if (problems.length) return errorPage(problems, next);

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet(TAB, HEADERS).appendRow([
      new Date(), req.name, req.email, req.phone, req.flyers, req.dates,
      req.weightOk ? 'Yes' : 'No', req.message, req.page, req.payment
    ]);
  } finally {
    lock.releaseLock();
  }

  MailApp.sendEmail({
    to: prop('CLUB_EMAIL'),
    replyTo: req.email,
    subject: 'Discovery Flight booking: ' + req.name + ' (' + req.flyers + ', ' + req.payment + ')',
    body: [
      'A new Discovery Flight request from the website.',
      '',
      'Name: ' + req.name,
      'Email: ' + req.email,
      'Phone: ' + req.phone,
      'Flyers: ' + req.flyers,
      'Preferred dates: ' + req.dates,
      'Everyone under the weight limit: ' + (req.weightOk ? 'Yes' : 'No'),
      'Payment: ' + req.payment,
      'Message: ' + (req.message || '(none)'),
      '',
      'Reply to this email to confirm a date and an arrival time.'
    ].join('\n')
  });

  return redirect(next);
}

function packRequest(p, next) {
  var name = clean(p.name);
  var email = clean(p.email);
  var problems = [];
  if (!name) problems.push('your name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push('a valid email address');
  if (problems.length) return errorPage(problems, next.replace(/welcome-pack-sent\/?$/, '#pack-h'));

  // The pack sits at the root of the same site the visitor came from.
  var packUrl = next.replace(/learn-to-fly\/welcome-pack-sent\/?$/, 'welcome-pack.pdf');
  if (packUrl === next) packUrl = next.replace(/^(https:\/\/[^\/]+).*$/, '$1/welcome-pack.pdf');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet(LEADS_TAB, LEADS_HEADERS).appendRow([new Date(), name, email, clean(p.page)]);
  } finally {
    lock.releaseLock();
  }

  MailApp.sendEmail({
    to: email,
    replyTo: prop('CLUB_EMAIL'),
    name: 'Prince Albert Gliding and Soaring Club',
    subject: 'Your PAGSC welcome pack',
    body: [
      'Hi ' + name + ',',
      '',
      'Here is the club welcome pack: booking lessons on the Flying Schedule, the morning you fly, costs, the path to a licence and the fleet.',
      '',
      packUrl,
      '',
      'Your first lesson is a Discovery Flight. Reply to this email with any questions.',
      '',
      'Prince Albert Gliding and Soaring Club'
    ].join('\n')
  });

  MailApp.sendEmail({
    to: prop('CLUB_EMAIL'),
    replyTo: email,
    subject: 'Welcome pack sent to a prospective student: ' + name,
    body: 'The website sent the welcome pack to ' + name + ' <' + email + '>.\nThey are in the "' + LEADS_TAB + '" tab.'
  });

  return redirect(next);
}

function doGet() {
  return HtmlService.createHtmlOutput('PAGSC flight requests endpoint.');
}

function validate(r) {
  var out = [];
  if (!r.name) out.push('your name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) out.push('a valid email address');
  if (!/\d{3}.*\d{4}/.test(r.phone)) out.push('a phone number');
  if (!(r.flyers >= 1 && r.flyers <= 20)) out.push('the number of flyers');
  if (!r.dates) out.push('your preferred dates');
  if (!r.weightOk) out.push('the weight confirmation');
  return out;
}

function clean(v) {
  return String(v || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, MAX)
    // Stop a value being read as a formula when the sheet is opened.
    .replace(/^[=+\-@]/, "'$&");
}

function sheet(tab, headers) {
  var ss = SpreadsheetApp.openById(prop('SHEET_ID'));
  var sh = ss.getSheetByName(tab);
  if (!sh) {
    sh = ss.insertSheet(tab);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function prop(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('Script property ' + key + ' is not set');
  return v;
}

/** Only return visitors to the club's own site. */
function safeNext(next) {
  var origins = (PropertiesService.getScriptProperties().getProperty('SITE_ORIGINS') || 'https://www.pagsc.ca')
    .split(',').map(function (s) { return s.trim(); });
  var fallback = origins[0] + '/discovery-flight/requested/';
  next = String(next || '');
  for (var i = 0; i < origins.length; i++) {
    if (next.indexOf(origins[i] + '/') === 0) return next;
  }
  return fallback;
}

function redirect(url) {
  var u = JSON.stringify(url);
  var html =
    '<!doctype html><meta charset="utf-8"><title>Request sent</title>' +
    '<p style="font-family:sans-serif">Request sent. <a href=' + escapeAttr(url) + ' target="_top">Continue</a></p>' +
    '<script>window.top.location.replace(' + u + ');</script>';
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function errorPage(problems, next) {
  var back = next.replace(/requested\/?$/, '#request');
  var html =
    '<!doctype html><meta charset="utf-8"><title>Please check your request</title>' +
    '<div style="font-family:sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem">' +
    '<h1>Please check your request</h1><p>We still need: ' + problems.join(', ') + '.</p>' +
    '<p><a href=' + escapeAttr(back) + ' target="_top">Go back to the form</a></p></div>';
  return HtmlService.createHtmlOutput(html);
}

function escapeAttr(s) {
  return '"' + String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"';
}
