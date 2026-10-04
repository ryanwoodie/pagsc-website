/**
 * PAGSC booking emails, styled to match pagsc.ca: navy, sky and windsock orange, condensed headings.
 * Pure string building (no Google services), so samples can be rendered and checked locally.
 */

var EMAIL = {
  INK: '#0E2233', SKY: '#E1EEF7', ORANGE: '#C2460E', ORANGE_DARK: '#A93C0B', TINT: '#FCEBE1', GREY: '#3B4C5A', RULE: '#A9BBC8',
  DISPLAY: "'Barlow Condensed','Arial Narrow','Helvetica Neue',Arial,sans-serif",
  BODY: "Barlow,'Helvetica Neue',Helvetica,Arial,sans-serif",
  CLUB: 'Prince Albert Gliding and Soaring Club'
};

/** "15:30" -> "3:30 pm", "12:00" -> "12 pm" */
function clock12(hhmm) {
  var m = toMinutes(hhmm), h = Math.floor(m / 60), mm = m % 60;
  return ((h + 11) % 12 + 1) + (mm ? ':' + (mm < 10 ? '0' : '') + mm : '') + (h < 12 ? ' am' : ' pm');
}

/** "3:30 pm to 4 pm" */
function timeRange12(start, people) {
  return clock12(start) + ' to ' + clock12(fromMinutes(toMinutes(start) + people * BOOKING.STEP));
}

var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-10-10" -> "Saturday, October 10" */
function longDate(iso) {
  var d = new Date(iso + 'T12:00:00Z');
  return DAY_NAMES[d.getUTCDay()] + ', ' + MONTH_NAMES[d.getUTCMonth()] + ' ' + d.getUTCDate();
}

/** "Saturday, October 10, 3:30 pm to 4 pm (2 people)" */
function whenText(b) {
  return longDate(b.date) + ', ' + timeRange12(b.start, b.people) + (b.people > 1 ? ' (' + b.people + ' people)' : '');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- Building blocks ----------

function para(html) {
  return '<p style="margin:0 0 14px;font-family:' + EMAIL.BODY + ';font-size:16px;line-height:1.5;color:' + EMAIL.INK + '">' + html + '</p>';
}

function heading(text) {
  return '<h1 style="margin:0 0 14px;font-family:' + EMAIL.DISPLAY + ';font-size:32px;line-height:1.05;font-weight:700;color:' + EMAIL.INK + '">' + esc(text) + '</h1>';
}

function label(text) {
  return '<div style="font-family:' + EMAIL.DISPLAY + ';font-size:13px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:' + EMAIL.ORANGE_DARK + ';margin:0 0 4px">' + esc(text) + '</div>';
}

/** A shaded panel: sky (default) or orange tint. */
function panel(inner, tint) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr><td style="background:' + (tint ? EMAIL.TINT : EMAIL.SKY) + ';border-top:2px solid ' + EMAIL.INK + ';padding:14px 18px">' + inner + '</td></tr></table>';
}

function whenPanel(b, kindLabel) {
  return panel(label(kindLabel) +
    '<div style="font-family:' + EMAIL.DISPLAY + ';font-size:22px;line-height:1.2;font-weight:700;color:' + EMAIL.INK + '">' + esc(longDate(b.date)) + '</div>' +
    '<div style="font-family:' + EMAIL.BODY + ';font-size:16px;color:' + EMAIL.INK + '">' + esc(timeRange12(b.start, b.people)) + (b.people > 1 ? ', ' + b.people + ' people' : '') + '</div>');
}

function button(text, url, ghost) {
  var bg = ghost ? '#FFFFFF' : EMAIL.ORANGE, fg = ghost ? EMAIL.INK : '#FFFFFF', border = ghost ? EMAIL.INK : EMAIL.ORANGE;
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 8px 10px 0;display:inline-table"><tr><td style="background:' + bg + ';border:2px solid ' + border + '">' +
    '<a href="' + esc(url) + '" style="display:inline-block;padding:12px 20px;font-family:' + EMAIL.DISPLAY + ';font-size:17px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:' + fg + ';text-decoration:none">' + esc(text) + '</a></td></tr></table>';
}

/** The latest from the schedule for that day: status, forecast, instructors. */
function fieldPanel(day) {
  var rows = [];
  var status = classifyStatus(day.statusText);
  var statusLine = !day.statusText
    ? 'No update posted yet. We will email you when the club posts one.'
    : ({ on: 'Flying is on', delayed: 'Delayed', cancelled: 'Not flying', unknown: 'Update posted' }[status] || 'Update posted') +
      ': <span style="color:' + EMAIL.GREY + '">&ldquo;' + esc(day.statusText) + '&rdquo;</span>';
  rows.push(['Status', statusLine]);
  rows.push(['Forecast', day.weather ? esc(day.weather) : 'Not posted yet. The forecast fills in about a week ahead.']);
  rows.push(['Instructors', day.instructor ? 'An instructor has signed up for the day.' : 'No instructor signed up yet.']);
  var html = label('Latest from the field');
  rows.forEach(function (r) {
    html += '<div style="font-family:' + EMAIL.BODY + ';font-size:15px;line-height:1.45;color:' + EMAIL.INK + ';margin:6px 0 0"><strong>' + r[0] + ':</strong> ' + r[1] + '</div>';
  });
  return panel(html, status === 'cancelled' || status === 'delayed');
}

/** Whole email: header bar, body, footer. */
function layout(preheader, body, links) {
  return '<!doctype html><html><body style="margin:0;padding:0;background:#F2F6F9">' +
    '<div style="display:none;max-height:0;overflow:hidden">' + esc(preheader) + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F6F9"><tr><td align="center" style="padding:20px 10px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF">' +
    '<tr><td style="background:' + EMAIL.INK + ';padding:14px 24px;font-family:' + EMAIL.DISPLAY + ';font-size:20px;font-weight:700;letter-spacing:0.06em;color:#FFFFFF">PAGSC <span style="font-family:' + EMAIL.BODY + ';font-size:13px;font-weight:400;letter-spacing:0;color:#C9D6E0">&nbsp;' + EMAIL.CLUB + '</span></td></tr>' +
    '<tr><td style="padding:26px 24px 10px">' + body + '</td></tr>' +
    '<tr><td style="padding:16px 24px 22px;border-top:1px solid ' + EMAIL.RULE + ';font-family:' + EMAIL.BODY + ';font-size:13px;line-height:1.5;color:' + EMAIL.GREY + '">' +
    EMAIL.CLUB + ' &middot; Birch Hills Airport, Saskatchewan<br>' +
    '<a href="mailto:' + esc(links.email) + '" style="color:#1F5F8F">' + esc(links.email) + '</a> &middot; ' + esc(links.phone) + ' &middot; <a href="' + esc(links.site) + '" style="color:#1F5F8F">' + esc(links.site.replace(/^https?:\/\//, '')) + '</a>' +
    '</td></tr></table></td></tr></table></body></html>';
}

var BRING = 'Bring a hat, sunscreen, sunglasses, water and snacks, and layers (it is cooler at altitude). If you have not paid online, bring a way to pay: e-transfer or cash.';

// ---------- Emails ----------

/**
 * @param b {name, date, start, people}
 * @param held true for a weekend booking (pencilled in), false for a weekday request
 * @param links {cancel, calendar, site, email, phone}
 * @returns {subject, html, text}
 */
function confirmationEmail(b, held, links) {
  var first = String(b.name).split(/\s+/)[0];
  var when = whenText(b);
  var body = heading(held ? "You're pencilled in" : 'Your weekday request is in') +
    para('Hi ' + esc(first) + ',') +
    whenPanel(b, held ? 'Discovery Flight' : 'Weekday request') +
    (held
      ? para('Gliding depends on the weather and on volunteers, so this is a pencilled-in time rather than a guarantee. We will send you a reminder before the day with the latest from the field, including any arrival time the club has posted, and let you know if anything changes.')
      : para('Weekday flying happens when volunteers are free, so a club member will email you to confirm this time or suggest another day.')) +
    para('Plan to stay a while: there is plenty to watch, and the crew is happy to answer questions.') +
    para(esc(BRING)) +
    button('Change or cancel', links.cancel, true) +
    para('<span style="font-size:14px;color:' + EMAIL.GREY + '">Questions? Just reply to this email.</span>');
  return {
    subject: (held ? "You're pencilled in: " : 'Weekday request received: ') + when,
    html: layout(held ? 'Your Discovery Flight: ' + when : 'Your weekday request: ' + when, body, links),
    text: [
      'Hi ' + first + ',', '',
      held ? "You're pencilled in for a Discovery Flight: " + when + '.' : 'We have your weekday request: ' + when + '. A club member will email you to confirm.',
      '',
      'Gliding depends on the weather and on volunteers, so this is not a guaranteed time. We will send you a reminder before the day, with any arrival time the club has posted, and let you know if anything changes.',
      '', BRING, '',
      'Change or cancel: ' + links.cancel, '',
      EMAIL.CLUB
    ].join('\n')
  };
}

/**
 * @param which '7' | '3' | '1' (days before)
 * @param day {statusText, weather, instructor} for the booking's date
 */
function reminderEmail(b, held, which, day, links) {
  var first = String(b.name).split(/\s+/)[0];
  var lead = which === '1' ? 'Tomorrow' : which === '3' ? 'In 3 days' : 'In a week';
  var status = classifyStatus(day.statusText);
  var nothingYet = !day.statusText && !day.instructor;
  var title = status === 'cancelled' ? 'Flying is off that day' : lead + ': your Discovery Flight';
  var body = heading(title) +
    para('Hi ' + esc(first) + ',') +
    whenPanel(b, held ? 'Your pencilled-in time' : 'Your weekday request') +
    fieldPanel(day) +
    (status === 'cancelled'
      ? para('The club has posted that flying is off. Cancel this time and pick another day; it only takes a minute.') + button('Cancel and rebook', links.cancel)
      : nothingYet
        ? para('Nothing has been posted for the day yet, which is normal' + (which === '1' ? '' : ' this far out') + '. Flying depends on the weather and volunteers, so your time is still pencilled in rather than guaranteed. We will email you as soon as the club posts an update.')
        : para('Flying depends on the weather and volunteers, so things can still change. We will email you if they do.')) +
    (which === '1' && status !== 'cancelled' ? para('Check your email the morning of your flight for any last changes before you head out. ' + esc(BRING)) : '') +
    (held ? '' : para('If a club member has not confirmed your weekday request yet, reply to this email.')) +
    (status === 'cancelled' ? '' : button('Change or cancel', links.cancel, true));
  return {
    subject: (status === 'cancelled' ? 'Flying is off: ' : lead + ': your Discovery Flight, ') + longDate(b.date) + ' at ' + clock12(b.start),
    html: layout(lead + ': ' + whenText(b), body, links),
    text: [
      'Hi ' + first + ',', '',
      lead + ': ' + whenText(b) + '.', '',
      'Status: ' + (day.statusText || 'No update posted yet.'),
      'Forecast: ' + (day.weather || 'Not posted yet.'),
      'Instructors: ' + (day.instructor ? 'An instructor has signed up.' : 'None signed up yet.'), '',
      status === 'cancelled' ? 'Flying is off that day. Cancel this time and pick another day: ' + links.cancel : 'Flying depends on the weather and volunteers, so things can still change. We will email you if they do.',
      '', status === 'cancelled' ? '' : 'Change or cancel: ' + links.cancel, '', EMAIL.CLUB
    ].join('\n')
  };
}

/** Sent when the day's Status / Comments text changes. */
function statusEmail(b, held, day, links) {
  var first = String(b.name).split(/\s+/)[0];
  var status = classifyStatus(day.statusText);
  var title = { on: 'Flying is on', delayed: 'Flying is delayed', cancelled: 'Flying is off that day' }[status] || 'An update for your flight';
  var body = heading(title) +
    para('Hi ' + esc(first) + ', the club has posted an update for your day.') +
    whenPanel(b, held ? 'Your pencilled-in time' : 'Your weekday request') +
    fieldPanel(day) +
    (status === 'cancelled'
      ? para('Cancel this time and pick another day; it only takes a minute. If the club posts that flying is back on, we will email you again.') + button('Cancel and rebook', links.cancel)
      : para('Flying depends on the weather and volunteers, so things can still change. We will email you if they do.') + button('Change or cancel', links.cancel, true));
  return {
    subject: title + ': ' + longDate(b.date),
    html: layout(title + ': ' + day.statusText, body, links),
    text: ['Hi ' + first + ',', '', 'Update for ' + whenText(b) + ':', '"' + day.statusText + '"', '',
      status === 'cancelled' ? 'Cancel this time and pick another day: ' + links.cancel : 'Things can still change; we will email you if they do.',
      '', status === 'cancelled' ? '' : 'Change or cancel: ' + links.cancel, '', EMAIL.CLUB].join('\n')
  };
}

/** The page a guest sees after using the cancel link. */
function cancelPageHtml(title, message, calendarUrl) {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title></head>' +
    '<body style="margin:0;background:#FFFFFF">' +
    '<div style="background:' + EMAIL.INK + ';padding:14px 20px;font-family:' + EMAIL.DISPLAY + ';font-size:20px;font-weight:700;letter-spacing:0.06em;color:#FFFFFF">PAGSC</div>' +
    '<div style="max-width:560px;margin:0 auto;padding:28px 20px">' + heading(title) + para(esc(message)) +
    (calendarUrl ? button('Pick another day', calendarUrl) : '') + '</div></body></html>';
}
