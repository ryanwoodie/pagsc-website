/**
 * The club's contact records, kept in the requests sheet beside the existing tabs:
 *
 *   People    one row per person (matched by email and name: a parent and child share an email)
 *   Flyers    one row per person in a booking; waivers signed through the booking's link fill them in
 *   Messages  every email sent to a guest, by the script or by a volunteer from the admin page
 *
 * Bookings gain a Booking ID (short, safe to show), a Person ID for the booker, Follow-up sent and Notes.
 * Waivers gain a Person ID. ensureCrm (every 10 minutes) fills in anything missing, so rows added by hand
 * or before these tabs existed are picked up.
 *
 * New code reads columns by header name (tab()), so adding or moving columns in the sheet is safe for it.
 */

var CRM = {
  PEOPLE: 'People',
  PEOPLE_HEADERS: ['Person ID', 'Name', 'Email', 'Phone', 'First seen', 'Source', 'Tags', 'Notes'],
  FLYERS: 'Flyers',
  FLYERS_HEADERS: ['Booking ID', 'Person ID', 'Name', 'Email', 'Waiver ID', 'Flown', 'Added', 'Flyer ID'],
  MESSAGES: 'Messages',
  MESSAGES_HEADERS: ['Sent', 'To', 'Booking ID', 'Subject', 'By'],
  ID_ALPHABET: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
};

// ---------- Pure logic (tested in scripts/crm.test.mjs) ----------

/** "B-7KQ2XM" from 6 random bytes. */
function makeId(prefix, bytes) {
  var s = '';
  for (var i = 0; i < 6; i++) s += CRM.ID_ALPHABET.charAt(bytes[i] % CRM.ID_ALPHABET.length);
  return prefix + '-' + s;
}

/** People are the same person when email and name match, ignoring case and spacing. */
function personKey(email, name) {
  return String(email || '').trim().toLowerCase() + '|' + String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Placeholder names for flyers not known yet: "Guest 2", "Guest 3"… */
function isPlaceholderName(name) {
  return !String(name || '').trim() || /^guest \d+$/i.test(String(name).trim());
}

/** A short name that is the start of a fuller one: "Braeden" and "Braeden Whatcott". */
function sameFirstName(a, b) {
  var x = String(a || '').trim().toLowerCase().split(/\s+/), y = String(b || '').trim().toLowerCase().split(/\s+/);
  if (!x[0] || x[0] !== y[0]) return false;
  return x.length === 1 || y.length === 1; // one of them is only a first name
}

/**
 * Which Flyers row (index into rows, each {name, waiverId}) a new waiver for `name` should fill, or -1
 * (add a row). In order: the row with their exact name; a row with only their first name ("Braeden" for
 * "Braeden Whatcott"); a placeholder ("Guest 2"). Rows that already have a waiver are never taken.
 */
function flyerSlot(rows, name) {
  var want = String(name || '').trim().toLowerCase();
  var free = function (r) { return !r.waiverId; };
  for (var i = 0; i < rows.length; i++) if (free(rows[i]) && String(rows[i].name).trim().toLowerCase() === want) return i;
  for (var j = 0; j < rows.length; j++) if (free(rows[j]) && !isPlaceholderName(rows[j].name) && sameFirstName(rows[j].name, name)) return j;
  for (var k = 0; k < rows.length; k++) if (free(rows[k]) && isPlaceholderName(rows[k].name)) return k;
  return -1;
}

// ---------- Sheet access by header name ----------

/**
 * A tab read whole, with header lookup. Missing headers are added at the end (never reordered).
 * t.col(name) = 1-based column; t.rows = data rows (arrays); t.row(i, name) = a value; t.set(i, name, v); t.add(obj).
 * Row index i is 0-based into t.rows.
 */
function tab(name, headers) {
  var sh = sheet(name, headers);
  var values = sh.getDataRange().getValues();
  var head = values[0].map(String);
  var missing = headers.filter(function (h) { return head.indexOf(h) < 0; });
  if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
    head = head.concat(missing);
  }
  var idx = {};
  head.forEach(function (h, i) { if (h && idx[h] == null) idx[h] = i; });
  var rows = values.slice(1);
  var t = {
    sh: sh,
    head: head,
    rows: rows,
    col: function (h) { return idx[h] + 1; },
    row: function (i, h) { return idx[h] == null ? '' : rows[i][idx[h]]; },
    del: function (i) {
      sh.deleteRow(i + 2);
      rows.splice(i, 1);
    },
    set: function (i, h, v) {
      sh.getRange(i + 2, idx[h] + 1).setValue(v);
      while (rows[i].length <= idx[h]) rows[i].push('');
      rows[i][idx[h]] = v;
    },
    add: function (obj) {
      var r = head.map(function (h) { return obj[h] != null ? obj[h] : ''; });
      sh.appendRow(r);
      rows.push(r);
      return rows.length - 1;
    },
    obj: function (i) {
      var o = {};
      head.forEach(function (h, k) { if (h) o[h] = rows[i][k]; });
      return o;
    }
  };
  return t;
}

function newId(prefix) {
  var hex = Utilities.getUuid().replace(/-/g, '');
  var bytes = [];
  for (var i = 0; i < 6; i++) bytes.push(parseInt(hex.substr(i * 2, 2), 16));
  return makeId(prefix, bytes);
}

/** The Person ID for {name, email, phone}, adding them to People if new. Call inside the script lock. */
function upsertPerson(people, info, source) {
  var email = String(info.email || '').trim();
  var name = String(info.name || '').trim();
  if (!email && !name) return '';
  var key = personKey(email, name);
  for (var i = 0; i < people.rows.length; i++) {
    if (personKey(people.row(i, 'Email'), people.row(i, 'Name')) !== key) continue;
    if (info.phone && !people.row(i, 'Phone')) people.set(i, 'Phone', info.phone);
    return String(people.row(i, 'Person ID'));
  }
  // Same email and a short form of the name ("Braeden" / "Braeden Whatcott"): the same person; keep the fuller name.
  for (var j = 0; email && j < people.rows.length; j++) {
    if (String(people.row(j, 'Email')).trim().toLowerCase() !== email.toLowerCase() || !sameFirstName(people.row(j, 'Name'), name)) continue;
    if (name.length > String(people.row(j, 'Name')).length) people.set(j, 'Name', name);
    if (info.phone && !people.row(j, 'Phone')) people.set(j, 'Phone', info.phone);
    return String(people.row(j, 'Person ID'));
  }
  var id = newId('P');
  people.add({ 'Person ID': id, 'Name': name, 'Email': email, 'Phone': info.phone || '', 'First seen': new Date(), 'Source': source || '' });
  return id;
}

/** Flyers rows for a new booking: the booker first, then "Guest 2"… Call inside the script lock. */
function addFlyers(bookingId, people, booker) {
  var fl = tab(CRM.FLYERS, CRM.FLYERS_HEADERS);
  var now = new Date();
  fl.add({ 'Booking ID': bookingId, 'Person ID': booker.personId || '', 'Name': booker.name, 'Email': booker.email, 'Added': now, 'Flyer ID': newId('F') });
  for (var n = 2; n <= people; n++) fl.add({ 'Booking ID': bookingId, 'Name': 'Guest ' + n, 'Added': now, 'Flyer ID': newId('F') });
}

/**
 * Put a signed waiver on its booking's Flyers row. w = {id, name, email, personId}. flyerId (optional) = the row to
 * fill, chosen by a volunteer; otherwise flyerSlot picks. Call inside the script lock.
 */
function linkWaiverToFlyer(bookingId, w, flyerId) {
  var fl = tab(CRM.FLYERS, CRM.FLYERS_HEADERS);
  var mine = [], at = [], target = -1;
  for (var i = 0; i < fl.rows.length; i++) {
    if (fl.row(i, 'Booking ID') !== bookingId) continue;
    if (fl.row(i, 'Waiver ID') === w.id) return;
    if (flyerId && fl.row(i, 'Flyer ID') === flyerId) target = i;
    mine.push({ name: fl.row(i, 'Name'), email: fl.row(i, 'Email'), waiverId: fl.row(i, 'Waiver ID') });
    at.push(i);
  }
  var k = flyerSlot(mine, w.name);
  var i2 = target >= 0 ? target : k >= 0 ? at[k] : fl.add({ 'Booking ID': bookingId, 'Added': new Date(), 'Flyer ID': newId('F') });
  // The row's earlier contact is the same person only when the names agree ("Braeden" / "Braeden Whatcott");
  // otherwise (a parent's row given to their child's waiver) the contacts stay separate.
  var oldPerson = String(fl.row(i2, 'Person ID') || ''), oldName = String(fl.row(i2, 'Name'));
  var same = oldName.trim().toLowerCase() === String(w.name).trim().toLowerCase() || sameFirstName(oldName, w.name);
  if (oldPerson && w.personId && oldPerson !== w.personId && same) mergePeople(oldPerson, w.personId);
  fl.set(i2, 'Name', w.name);
  if (w.email) fl.set(i2, 'Email', w.email);
  if (w.personId) fl.set(i2, 'Person ID', w.personId);
  fl.set(i2, 'Waiver ID', w.id);
}

/**
 * One person recorded twice ("Braeden" from a booking, "Braeden Whatcott" from a waiver): point every Bookings,
 * Flyers and Waivers row at keepId, keep the fuller details on the kept People row, and remove the other.
 * Call inside the script lock.
 */
function mergePeople(dropId, keepId) {
  if (!dropId || !keepId || dropId === keepId) return;
  [[BOOKING.TAB, BOOKING.HEADERS], [CRM.FLYERS, CRM.FLYERS_HEADERS], [WAIVER.TAB, WAIVER.HEADERS]].forEach(function (x) {
    var t = tab(x[0], x[1]);
    for (var i = 0; i < t.rows.length; i++) if (String(t.row(i, 'Person ID')) === dropId) t.set(i, 'Person ID', keepId);
  });
  var people = tab(CRM.PEOPLE, CRM.PEOPLE_HEADERS), drop = -1, keep = -1;
  for (var k = 0; k < people.rows.length; k++) {
    if (people.row(k, 'Person ID') === dropId) drop = k;
    if (people.row(k, 'Person ID') === keepId) keep = k;
  }
  if (drop < 0) return;
  if (keep >= 0) {
    ['Phone', 'Email', 'Notes'].forEach(function (h) { if (!people.row(keep, h) && people.row(drop, h)) people.set(keep, h, people.row(drop, h)); });
    if (String(people.row(drop, 'Name')).length > String(people.row(keep, 'Name')).length) people.set(keep, 'Name', people.row(drop, 'Name'));
  }
  people.del(drop);
}

/** Note an email in Messages. Never throws: logging must not stop an email. */
function logMessage(to, subject, bookingId, by) {
  try {
    tab(CRM.MESSAGES, CRM.MESSAGES_HEADERS).add({ 'Sent': new Date(), 'To': to, 'Booking ID': bookingId || '', 'Subject': subject, 'By': by || 'automatic' });
  } catch (err) { console.error(err); }
}

/**
 * Every 10 minutes: give bookings and waivers IDs and people, make Flyers rows for bookings without them, and
 * link waivers signed through a booking's link. Only touches rows that are missing something.
 */
function ensureCrm() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var people = tab(CRM.PEOPLE, CRM.PEOPLE_HEADERS);
    var bk = tab(BOOKING.TAB, BOOKING.HEADERS);
    var fl = tab(CRM.FLYERS, CRM.FLYERS_HEADERS);
    var haveFlyers = {};
    fl.rows.forEach(function (r, i) {
      haveFlyers[fl.row(i, 'Booking ID')] = true;
      if (!fl.row(i, 'Flyer ID')) fl.set(i, 'Flyer ID', newId('F'));
    });
    var byKey = {};
    for (var i = 0; i < bk.rows.length; i++) {
      if (!bk.row(i, 'Date')) continue;
      if (!bk.row(i, 'Booking ID')) bk.set(i, 'Booking ID', newId('B'));
      if (!bk.row(i, 'Person ID')) bk.set(i, 'Person ID', upsertPerson(people, { name: bk.row(i, 'Name'), email: bk.row(i, 'Email'), phone: bk.row(i, 'Phone') }, 'Booking'));
      var id = String(bk.row(i, 'Booking ID'));
      if (bk.row(i, 'Waiver key')) byKey[bk.row(i, 'Waiver key')] = id;
      if (!haveFlyers[id]) {
        addFlyers(id, Number(bk.row(i, 'People')) || 1, { personId: bk.row(i, 'Person ID'), name: String(bk.row(i, 'Name')), email: String(bk.row(i, 'Email')) });
        haveFlyers[id] = true;
      }
    }
    var linked = {};
    fl.rows.forEach(function (r, i) { if (fl.row(i, 'Waiver ID')) linked[fl.row(i, 'Waiver ID')] = true; });
    var wv = tab(WAIVER.TAB, WAIVER.HEADERS);
    for (var w = 0; w < wv.rows.length; w++) {
      if (!wv.row(w, 'ID')) continue;
      var pid = wv.row(w, 'Person ID');
      if (!pid) {
        pid = upsertPerson(people, { name: wv.row(w, 'Participant'), email: wv.row(w, 'Email'), phone: wv.row(w, 'Phone') }, 'Waiver');
        wv.set(w, 'Person ID', pid);
      }
      var bid = byKey[wv.row(w, 'Booking key')];
      if (bid && !linked[wv.row(w, 'ID')]) linkWaiverToFlyer(bid, { id: String(wv.row(w, 'ID')), name: String(wv.row(w, 'Participant')), email: String(wv.row(w, 'Email')), personId: pid });
    }
  } finally {
    lock.releaseLock();
  }
}
