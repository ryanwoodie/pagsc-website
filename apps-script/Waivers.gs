/**
 * The club's waiver, signed online at /waiver/.
 *
 *   POST form=waiver           one person's signed waiver: saved to the "Waivers" tab, a signed PDF filed in
 *                              the club's Drive folder, a copy emailed to the signer and a note to the club.
 *   GET  ?action=waiver&key=…  for a booking's waiver link: the flight date, people and how many have signed.
 *
 * The wording is content/waiver.md, compiled into WaiverText.gs (npm run waiver). Each signature records the
 * waiver version and a SHA-256 hash of the exact text signed, with the participant's name filled in.
 * Anyone GUARDIAN_MAX_AGE or under on the day they sign needs a parent or guardian to sign as well.
 *
 * Optional Script Property: WAIVER_FOLDER_ID, the Drive folder for signed PDFs. Without it the script
 * creates "PAGSC signed waivers" in the club's Drive on the first signature and remembers it.
 */

var WAIVER = {
  TAB: 'Waivers',
  GUARDIAN_MAX_AGE: 18,   // waiver.guardian_max_age in content/club-facts.yaml
  MAX_IMAGE: 200000,      // longest accepted signature image, as a data URL
  FOLDER_NAME: 'PAGSC signed waivers',
  HEADERS: ['Signed', 'Participant', 'Date of birth', 'Age', 'Guardian', 'Email', 'Phone', 'Address',
    'Emergency contact', 'Emergency phone', 'Signed at', 'Signature', 'Booking key', 'Flight date',
    'Version', 'Text SHA-256', 'Device', 'PDF', 'ID']
};

// ---------- Pure logic (no Google services; tested in scripts/waiver.test.mjs) ----------

/** Whole years between a yyyy-mm-dd birth date and today (yyyy-mm-dd), or NaN. */
function ageOn(dob, today) {
  var a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob || ''), b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today || '');
  if (!a || !b) return NaN;
  var years = Number(b[1]) - Number(a[1]);
  if (b[2] + b[3] < a[2] + a[3]) years--;
  return years;
}

function needsGuardian(age) {
  return age <= WAIVER.GUARDIAN_MAX_AGE;
}

/** The waiver as plain text, the participant's name filled in: what the hash covers. */
function waiverPlain(w, participant) {
  return w.blocks.map(function (b) {
    var t = b.type === 'ul' ? b.items.map(function (i) { return '- ' + i; }).join('\n') : b.text;
    return t.replace(/\*\*/g, '').replace(/\{participant\}/g, participant);
  }).join('\n\n');
}

function waiverInline(text, participant) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\{participant\}/g, '<strong>' + esc(participant) + '</strong>');
}

/** Reads and checks a signing. Returns {f} or {error}. */
function readWaiverPost(p, today) {
  var f = {
    participant: clean(p.participant),
    dob: clean(p.dob),
    email: clean(p.email),
    phone: clean(p.phone),
    address: clean(p.address),
    emergencyName: clean(p.emergency_name),
    emergencyPhone: clean(p.emergency_phone),
    place: clean(p.place),
    guardian: clean(p.guardian),
    method: p.sig_method === 'typed' ? 'typed' : 'drawn',
    guardianMethod: p.guardian_sig_method === 'typed' ? 'typed' : 'drawn',
    sig: String(p.sig || ''),
    guardianSig: String(p.guardian_sig || ''),
    key: clean(p.key).replace(/[^a-f0-9]/g, '').slice(0, 32),
    version: clean(p.version),
    device: clean(p.device).slice(0, 300)
  };
  f.age = ageOn(f.dob, today);
  var image = function (v) { return /^data:image\/png;base64,[A-Za-z0-9+\/=]+$/.test(v) && v.length <= WAIVER.MAX_IMAGE; };
  var out = [];
  if (!f.participant) out.push('the name of the person flying');
  if (!(f.age >= 0 && f.age < 120)) out.push('their date of birth');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) out.push('a valid email address');
  if (!/\d{3}.*\d{4}/.test(f.phone)) out.push('a phone number');
  if (!f.address) out.push('an address');
  if (!f.emergencyName) out.push('an emergency contact');
  if (!/\d{3}.*\d{4}/.test(f.emergencyPhone)) out.push("the emergency contact's phone number");
  if (!f.place) out.push('where you are signing');
  if (!image(f.sig)) out.push('a signature');
  if (needsGuardian(f.age)) {
    if (!f.guardian) out.push("the parent or guardian's name");
    if (!image(f.guardianSig)) out.push("the parent or guardian's signature");
  } else {
    f.guardian = '';
    f.guardianSig = '';
  }
  if (p.agree !== 'yes') out.push('the box confirming you have read the waiver');
  if (out.length) return { error: 'We still need ' + out.join(', ') + '.' };
  return { f: f };
}

/** "16th day of October, 2026" */
function dayOfMonth(iso) {
  var d = Number(iso.slice(8, 10)), m = Number(iso.slice(5, 7)), y = iso.slice(0, 4);
  var suffix = d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th';
  return d + suffix + ' day of ' + MONTH_NAMES[m - 1] + ', ' + y;
}

/** The signed waiver as one HTML document, for the PDF. f.signedIso, f.signedText, f.hash and f.id are set by the caller. */
function waiverDocHtml(w, f) {
  var ink = EMAIL.INK, grey = EMAIL.GREY, rule = EMAIL.RULE;
  var body = w.blocks.map(function (b) {
    if (b.type === 'h2') return '<h1 style="font-family:' + EMAIL.DISPLAY + ';font-size:20pt;line-height:1.1;margin:0 0 10pt">' + esc(b.text) + '</h1>';
    if (b.type === 'h3') return '<h2 style="font-family:' + EMAIL.DISPLAY + ';font-size:13pt;margin:14pt 0 6pt">' + esc(b.text) + '</h2>';
    if (b.type === 'ul') return '<ul style="margin:0 0 8pt;padding-left:16pt">' + b.items.map(function (i) { return '<li style="margin:0 0 3pt">' + waiverInline(i, f.participant) + '</li>'; }).join('') + '</ul>';
    return '<p style="margin:0 0 8pt">' + waiverInline(b.text, f.participant) + '</p>';
  }).join('');
  var row = function (k, v) {
    return '<tr><td style="padding:3pt 8pt 3pt 0;color:' + grey + ';white-space:nowrap;vertical-align:top">' + esc(k) + '</td><td style="padding:3pt 0;vertical-align:top">' + esc(v) + '</td></tr>';
  };
  var sig = function (title, img, name) {
    return '<div style="margin:10pt 0 0"><div style="font-size:9pt;color:' + grey + '">' + esc(title) + '</div>' +
      '<img src="' + img + '" style="display:block;height:60pt;max-width:260pt;border-bottom:1px solid ' + ink + '">' +
      '<div style="font-size:9pt">' + esc(name) + '</div></div>';
  };
  return '<!doctype html><html><head><meta charset="utf-8"><style>@page{size:letter;margin:16mm 16mm}</style></head>' +
    '<body style="font-family:' + EMAIL.BODY + ';font-size:9.5pt;line-height:1.42;color:' + ink + '">' + body +
    '<p style="margin:12pt 0 0">SIGNED at ' + esc(f.place) + ' on the ' + esc(dayOfMonth(f.signedIso)) + '.</p>' +
    sig('Participant signature' + (f.method === 'typed' ? ' (typed)' : ''), f.sig, f.participant) +
    (f.guardianSig ? sig('Guardian signature (18 and under)' + (f.guardianMethod === 'typed' ? ' (typed)' : ''), f.guardianSig, f.guardian) : '') +
    '<table style="margin:12pt 0 0;border-collapse:collapse;font-size:9.5pt">' +
    row('Print name', f.participant) +
    row('Date of birth', f.dob + ' (age ' + f.age + ')') +
    row('Email', f.email) +
    row('Address', f.address) +
    row('Phone', f.phone) +
    row('Emergency contact name', f.emergencyName) +
    row('Emergency contact phone', f.emergencyPhone) +
    '</table>' +
    '<div style="margin:14pt 0 0;padding:6pt 0 0;border-top:1px solid ' + rule + ';font-size:7.5pt;line-height:1.4;color:' + grey + '">' +
    'Signed online at pagsc.ca/waiver on ' + esc(f.signedText) + ' (Saskatchewan time). Waiver version ' + esc(f.version) +
    '. SHA-256 of the text signed: ' + esc(f.hash) + '. Device: ' + esc(f.device || 'not given') + '. Record ' + esc(f.id) + '.</div>' +
    '</body></html>';
}

/** The copy emailed to the signer. */
function waiverEmail(f, links) {
  var first = String(f.participant).split(/\s+/)[0];
  var body = heading('Your signed waiver') +
    para('Thanks for signing the club\'s waiver' + (f.guardian ? ' for ' + esc(first) : '') + '. A signed copy is attached for your records.') +
    panel(label('Signed') +
      '<div style="font-family:' + EMAIL.BODY + ';font-size:16px;line-height:1.45;color:' + EMAIL.INK + '">' + esc(f.participant) + (f.guardian ? ', with ' + esc(f.guardian) + ' as parent or guardian' : '') + '<br>' + esc(f.signedText) + '</div>') +
    para('It stays in force while ' + (f.guardian ? esc(first) + ' flies' : 'you fly') + ' with the club, so there is nothing more to sign next time.') +
    para('<span style="font-size:14px;color:' + EMAIL.GREY + '">Questions? Just reply to this email.</span>');
  return {
    subject: 'Your signed PAGSC waiver: ' + f.participant,
    html: layout('Your signed waiver is attached.', body, links),
    text: [
      'Thanks for signing the club\'s waiver' + (f.guardian ? ' for ' + first : '') + '. A signed copy is attached for your records.', '',
      'Signed: ' + f.participant + (f.guardian ? ', with ' + f.guardian + ' as parent or guardian' : '') + ', ' + f.signedText, '',
      'It stays in force while ' + (f.guardian ? first + ' flies' : 'you fly') + ' with the club, so there is nothing more to sign next time.', '',
      EMAIL.CLUB
    ].join('\n')
  };
}

/** Distinct people who have signed for a booking key, from Waivers rows. */
function signedCount(rows, key) {
  var seen = {};
  var keyCol = WAIVER.HEADERS.indexOf('Booking key'), nameCol = WAIVER.HEADERS.indexOf('Participant');
  rows.forEach(function (r) {
    if (key && String(r[keyCol]) === key) seen[String(r[nameCol]).trim().toLowerCase()] = true;
  });
  return Object.keys(seen).length;
}

// ---------- Google services ----------

function waiversSheet() {
  return sheet(WAIVER.TAB, WAIVER.HEADERS);
}

function waiverFolder() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('WAIVER_FOLDER_ID');
  if (id) return DriveApp.getFolderById(id);
  var folder = DriveApp.createFolder(WAIVER.FOLDER_NAME);
  props.setProperty('WAIVER_FOLDER_ID', folder.getId());
  return folder;
}

/** The booking row (sheet values index) for a waiver key, or -1. */
function bookingForKey(rows, key) {
  var col = BOOKING.HEADERS.indexOf('Waiver key');
  if (!key) return -1;
  for (var i = 1; i < rows.length; i++) if (String(rows[i][col]) === key) return i;
  return -1;
}

/** GET ?action=waiver&key=…: what the waiver page shows for a booking. No names. */
function waiverInfo(key) {
  key = String(key || '').replace(/[^a-f0-9]/g, '');
  var rows = bookingsSheet().getDataRange().getValues();
  var i = bookingForKey(rows, key);
  if (i < 0 || rows[i][5] === 'Cancelled') return { ok: false };
  return { ok: true, date: isoOf(rows[i][1]), people: Number(rows[i][3]) || 1, signed: signedCount(waiversSheet().getDataRange().getValues(), key) };
}

function waiverPost(p) {
  var now = new Date();
  var today = Utilities.formatDate(now, BOOKING.TZ, 'yyyy-MM-dd');
  var read = readWaiverPost(p, today);
  if (read.error) return json({ ok: false, error: read.error });
  var f = read.f;
  if (f.version !== WAIVER_TEXT.version) {
    return json({ ok: false, error: 'The waiver has been updated since this page was opened. Reload the page, read it again and sign.' });
  }
  f.signedIso = today;
  f.signedText = Utilities.formatDate(now, BOOKING.TZ, 'MMMM d, yyyy, h:mm a');
  f.hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, waiverPlain(WAIVER_TEXT, f.participant), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  f.id = Utilities.getUuid();

  var pdf = Utilities.newBlob(waiverDocHtml(WAIVER_TEXT, f), 'text/html', 'waiver.html').getAs('application/pdf')
    .setName('PAGSC waiver ' + f.participant.replace(/[^\w .-]/g, '') + ' ' + today + '.pdf');
  var file = waiverFolder().createFile(pdf);

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  var flightDate = '', signed = 0, people = 0;
  try {
    var bsh = bookingsSheet();
    var brows = bsh.getDataRange().getValues();
    var bi = bookingForKey(brows, f.key);
    if (bi >= 0) flightDate = isoOf(brows[bi][1]);
    var wsh = waiversSheet();
    wsh.appendRow([now, f.participant, "'" + f.dob, f.age, f.guardian, f.email, f.phone, f.address,
      f.emergencyName, f.emergencyPhone, f.place, f.method + (f.guardian ? ', guardian ' + f.guardianMethod : ''), bi >= 0 ? f.key : '', flightDate,
      f.version, f.hash, f.device, file.getUrl(), f.id]);
    if (bi >= 0) {
      signed = signedCount(wsh.getDataRange().getValues(), f.key);
      people = Number(brows[bi][3]) || 1;
      bsh.getRange(bi + 1, BOOKING.HEADERS.indexOf('Waivers signed') + 1).setValue(signed);
    }
  } finally {
    lock.releaseLock();
  }

  var links = emailLinks('');
  var mail = waiverEmail(f, links);
  MailApp.sendEmail({ to: f.email, replyTo: links.email, name: EMAIL.CLUB, subject: mail.subject, body: mail.text, htmlBody: mail.html, attachments: [pdf] });
  MailApp.sendEmail({
    to: links.email,
    replyTo: f.email,
    subject: 'Waiver signed: ' + f.participant + (flightDate ? ', flying ' + longDate(flightDate) : ''),
    body: [
      f.participant + (f.guardian ? ' (age ' + f.age + ', parent or guardian ' + f.guardian + ')' : '') + ' signed the waiver online.',
      flightDate ? 'Booking: ' + longDate(flightDate) + ', ' + signed + ' of ' + people + ' signed.' : 'Not linked to a booking.',
      '',
      'Signed PDF: ' + file.getUrl(),
      'Details are in the "' + WAIVER.TAB + '" tab.'
    ].join('\n')
  });
  return json({ ok: true, signed: signed, people: people });
}
