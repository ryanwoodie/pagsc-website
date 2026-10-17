// Tests the pure booking logic in apps-script/Booking.gs (no Google services needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'yaml';

const ctx = {};
vm.createContext(ctx);
for (const f of ['Booking.gs', 'Emails.gs', 'Standby.gs']) vm.runInContext(readFileSync(new URL(`../apps-script/${f}`, import.meta.url), 'utf8'), ctx);
const { guestOpening, standbyNotifiedList, standbyOpenDay, standbyEmail, standbyOpenEmail, standbyAnyOpenDays, standbyAskToStay, standbyScope, standbyLink, weekendPartner, planWeekendMove, scheduleText, moveEmail, upcomingDays, manualEntry, slotTimes, scheduleDays, computeAvailability, canBook, timeRange, reminderDue, statusChangeDue, clock12, timeRange12, longDate, confirmationEmail, reminderEmail, statusEmail, minutesUntil } = ctx;

// Synthetic schedule in the documented layout. No real names.
const grid = [
  ['', 'Fri Oct 9,2026', 'Sat Oct 10,2026', 'Sun Oct 11,2026', 'Tue Oct 13,2026', 'Sat Nov 28,2026'],
  ['Weather forecast', '', 'Sunny', '', '', ''],
  ['Status/Comments:', '', 'Day is a go', 'Cancelled: wind', '', ''],
  ['Intro', 'Intro Fam Flight Sign-up Below for Fri:', 'Intro Fam Flight Sign-up Below for Sat:', 'Intro Fam Flight Sign-up Below', 'Intro Fam Flight Sign-up Below', 'Intro Fam Flight Sign-up Below'],
  ['', '', 'Guest A', '', '', ''],
  ['Students', 'Student/Pilots Sign-up Below', 'Student/Pilots Sign-up Below', 'Student/Pilots SIgn-up Below:', '', ''],
  ['', '', '', 'Student E', '', ''],
  ['Instructors:', 'Instructors Sign-up Below', 'Instructors Sign-up Below', 'Instructors Sign-up Below', '', ''],
  ['', '', 'Instructor D', '', '', ''],
];

test('slot times run 11:00 to 16:30 every half hour', () => {
  const t = slotTimes();
  assert.equal(t[0], '11:00');
  assert.equal(t.at(-1), '16:30');
  assert.equal(t.length, 12);
});

test('reads dates, status and intro rows', () => {
  const d = scheduleDays(grid);
  assert.equal(d.length, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(d[1])), { date: '2026-10-10', col: 2, introRow: 3, statusText: 'Day is a go', students: 0, manual: [{ start: '', people: 1 }], weather: 'Sunny', instructor: true });
  assert.equal(d[2].instructor, false);
});

test('availability: window, weekend/weekday, cancelled, cap and taken slots', () => {
  const days = scheduleDays(grid);
  const bookings = [{ date: '2026-10-10', start: '11:30', people: 2 }, { date: '2026-10-10', start: '15:00', people: 3 }];
  const a = computeAvailability(days, bookings, { '2026-10-13': 2 }, '2026-10-09');
  assert.deepEqual([...a.map((d) => d.date)], ['2026-10-10', '2026-10-11', '2026-10-13']); // not today, not past 28 days
  const sat = a[0];
  assert.equal(sat.kind, 'weekend');
  assert.equal(sat.status, 'on');
  assert.equal(sat.remaining, 2); // weekend limit 8 - 5 booked - 1 typed into the schedule (Guest A, no time)
  assert.deepEqual([...sat.slots.filter((s) => !s.free).map((s) => s.time)], ['11:30', '12:00', '15:00', '15:30', '16:00']);
  assert.equal(a[1].status, 'cancelled');
  assert.equal(a[2].kind, 'weekday');
  assert.equal(a[2].remaining, 2);
  assert.ok(!JSON.stringify(a).includes('Guest A'));
});

test('canBook rules', () => {
  const days = scheduleDays(grid);
  const [sat, sun, tue] = computeAvailability(days, [{ date: '2026-10-10', start: '11:30', people: 2 }], {}, '2026-10-09');
  assert.equal(canBook(sat, '11:00', 1), '');
  assert.match(canBook(sat, '11:00', 2), /just taken/);
  assert.match(canBook(sat, '16:00', 3), /too late/); // would end at 17:30
  assert.equal(canBook(sat, '15:30', 3), '');           // ends at 17:00
  assert.match(canBook(sat, '13:00', 5), /1 to 4/);
  assert.match(canBook(sun, '11:00', 1), /not running/);
  assert.match(canBook(tue, '11:00', 4), /^$/);
  assert.match(canBook({ ...tue, remaining: 1 }, '11:00', 2), /only 1 guest spot left/);
  assert.equal(timeRange('15:30', 3), '15:30 to 17:00');
});

test('club-facts.yaml booking settings match Booking.gs', () => {
  const facts = parse(readFileSync(new URL('../content/club-facts.yaml', import.meta.url), 'utf8')).booking;
  const B = vm.runInContext('BOOKING', ctx);
  assert.equal(facts.first_start, B.FIRST);
  assert.equal(facts.last_start, B.LAST);
  assert.equal(facts.minutes_per_person, B.STEP);
  assert.equal(facts.max_group, B.MAX_GROUP);
  assert.equal(facts.days_ahead, B.DAYS_AHEAD);
});

test('reminder timing', () => {
  // booked 20 days ahead: week reminder from 9 am, 7 days out; day-before from 4 pm
  assert.equal(reminderDue(20, 8, 10, ''), '');
  assert.equal(reminderDue(20, 7, 8, ''), '');
  assert.equal(reminderDue(20, 7, 9, ''), '7');
  assert.equal(reminderDue(20, 5, 12, ''), '7'); // caught up if a run was missed
  assert.equal(reminderDue(20, 5, 12, '7'), '');
  assert.equal(reminderDue(20, 1, 15, '7'), '');
  assert.equal(reminderDue(20, 1, 16, '7'), '1');
  assert.equal(reminderDue(20, 1, 20, '7,1'), '');
  // booked 5 days ahead: 3-day reminder, no week reminder
  assert.equal(reminderDue(5, 4, 12, ''), '');
  assert.equal(reminderDue(5, 3, 12, ''), '3');
  assert.equal(reminderDue(5, 1, 17, '3'), '1');
  // booked 2 days ahead: day-before only
  assert.equal(reminderDue(2, 2, 12, ''), '');
  assert.equal(reminderDue(2, 1, 16, ''), '1');
  // never on the day or after
  assert.equal(reminderDue(20, 0, 16, ''), '');
});

test('status-change emails', () => {
  assert.equal(statusChangeDue('', 'Day is a go', 3, 10), true);
  assert.equal(statusChangeDue('Day is a go', 'Day is a go', 3, 10), false);
  assert.equal(statusChangeDue('Day is a go', '', 3, 10), false);
  assert.equal(statusChangeDue('', 'Day is a go', 9, 10), false); // too far out
  assert.equal(statusChangeDue('', 'Delayed to 1pm', 0, 9), true);
  assert.equal(statusChangeDue('', 'Delayed to 1pm', 0, 16), false);
});

test('email text uses the site\'s time style and escapes names', () => {
  assert.equal(clock12('15:30'), '3:30 pm');
  assert.equal(clock12('12:00'), '12 pm');
  assert.equal(clock12('11:00'), '11 am');
  assert.equal(timeRange12('15:30', 1), '3:30 pm to 4 pm');
  assert.equal(longDate('2026-10-10'), 'Saturday, October 10');
  const links = { cancel: 'https://example.com/c?t=1', calendar: 'https://www.pagsc.ca/discovery-flight/#request', site: 'https://www.pagsc.ca', email: 'club@example.com', phone: '(306) 222-5684' };
  const b = { name: '<b>Pat</b> Smith', date: '2026-10-10', start: '15:30', people: 2 };
  const c = confirmationEmail(b, true, links);
  assert.match(c.subject, /3:30 pm to 4:30 pm/);
  assert.ok(!c.html.includes('<b>Pat</b>'));
  assert.ok(c.html.includes('Change or cancel'));
  assert.ok(!/arrive when we tell you/i.test(c.html + c.text));
  const r = reminderEmail(b, true, '1', { statusText: 'Cancelled: wind', weather: '', instructor: false }, links);
  assert.match(r.subject, /^Flying is off/);
  assert.ok(r.html.includes('Cancel and rebook'));
  assert.match(statusEmail(b, true, { statusText: 'Day is a go', weather: 'Sunny', instructor: true }, links).subject, /^Flying is on/);

  // Arrival map in the confirmation and the day-before reminder, linked to the full-size image.
  assert.ok(c.html.includes('https://www.pagsc.ca/images/airfield-arrival.jpg') && c.html.includes('maps.app.goo.gl'));
  assert.ok(reminderEmail(b, true, '1', { statusText: 'Day is a go', weather: '', instructor: true }, links).html.includes('airfield-arrival.jpg'));
  assert.ok(!reminderEmail(b, true, '7', { statusText: '', weather: '', instructor: false }, links).html.includes('airfield-arrival.jpg'));

  // Within 24 hours: no self-service cancel link, call instead. A day the club calls off can still be rebooked.
  assert.equal(minutesUntil('2026-10-10', '15:30', '2026-10-09', 16 * 60), 23 * 60 + 30);
  const late = { ...links, late: true };
  const lateReminder = reminderEmail(b, true, '1', { statusText: 'Day is a go', weather: '', instructor: true }, late);
  assert.ok(!lateReminder.html.includes('https://example.com/c?t=1') && lateReminder.html.includes('(306) 222-5684'));
  assert.ok(!lateReminder.text.includes('https://example.com/c?t=1'));
  assert.ok(c.html.includes('up to 24 hours before'));
});

test('students take 3 half-hour slots each; weekends share 8 guest flights', () => {
  const days = scheduleDays(grid);
  assert.equal(days.find((d) => d.date === '2026-10-11').students, 1);
  // Sunday: 1 student (room 12 - 3 = 9), Saturday has 1 guest typed in, so the weekend has 8 - 1 = 7 left
  const sun = computeAvailability(days, [], {}, '2026-10-09').find((d) => d.date === '2026-10-11');
  assert.equal(sun.remaining, 7);
  // The agreed table, for a Sunday with no guests booked that weekend
  const withStudents = (n) => {
    const rows = [grid[0], ['Status/Comments:', '', '', '', '', ''], grid[3], ['', '', '', 'Student/Pilots Sign-up Below', '', '']];
    for (let k = 0; k < n; k++) rows.push(['', '', '', `S${k}`, '', '']);
    return computeAvailability(scheduleDays(rows), [], {}, '2026-10-09').find((d) => d.date === '2026-10-11').remaining;
  };
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(withStudents), [8, 8, 6, 3, 0, 0]);
  // Bookings on the other day of the weekend count toward the 8
  const both = computeAvailability(scheduleDays([grid[0], ['Status/Comments:', '', '', '', '', ''], grid[3]]), [{ date: '2026-10-10', start: '11:00', people: 4 }], {}, '2026-10-09');
  assert.equal(both.find((d) => d.date === '2026-10-11').remaining, 4);
  assert.equal(both.find((d) => d.date === '2026-10-10').remaining, 4);
  // A Guest caps entry on either day replaces the weekend limit
  assert.equal(computeAvailability(scheduleDays([grid[0], ['Status/Comments:', '', '', '', '', ''], grid[3]]), [], { '2026-10-10': 5 }, '2026-10-09').find((d) => d.date === '2026-10-11').remaining, 5);
});

test('guests typed into the schedule by hand', () => {
  const e = (t) => JSON.parse(JSON.stringify(manualEntry(t)));
  assert.equal(manualEntry('Jane 11:30 (2) web'), null);
  assert.equal(manualEntry('Request: Sam 13:00 web'), null);
  assert.equal(manualEntry(''), null);
  assert.deepEqual(e('Jane 1:30 (2)'), { start: '13:30', people: 2 });
  assert.deepEqual(e('Bob 11:00'), { start: '11:00', people: 1 });
  assert.deepEqual(e('Kim 2pm +1'), { start: '14:00', people: 2 });
  assert.deepEqual(e('Lee 3:15 PM x3'), { start: '15:00', people: 3 });
  assert.deepEqual(e('Pat 14:30'), { start: '14:30', people: 1 });
  assert.deepEqual(e('Alex'), { start: '', people: 1 });
  assert.deepEqual(e('Sam (2)'), { start: '', people: 2 });
  assert.deepEqual(e('Max 9am'), { start: '', people: 1 }); // before the first slot
  const g = grid.map((r) => [...r]);
  g[4][2] = 'Jane 1:30 (2)';
  const sat = computeAvailability(scheduleDays(g), [], {}, '2026-10-09')[0];
  assert.equal(sat.remaining, 6); // weekend limit 8 - 2
  assert.deepEqual([...sat.slots.filter((s) => !s.free).map((s) => s.time)], ['13:30', '14:00']);
  assert.ok(!JSON.stringify(sat).includes('Jane'));
});

test('upcoming days for the home page: today on, weekends and status days, live status', () => {
  const days = scheduleDays(grid);
  const avail = computeAvailability(days, [], {}, '2026-10-10');
  const up = upcomingDays(days, avail, '2026-10-10', 4);
  // Fri Oct 9 is past; Sat 10 is today (no online booking); Sun 11 cancelled; Tue 13 has no status; Sat Nov 28 is outside the window
  assert.deepEqual([...up.map((d) => d.date)], ['2026-10-10', '2026-10-11', '2026-11-28']);
  assert.equal(up[0].statusText, 'Day is a go');
  assert.equal(up[0].instructor, true);
  assert.equal(up[0].remaining, null);
  assert.equal(up[1].status, 'cancelled');
  assert.equal(typeof up[1].remaining, 'number');
  assert.equal(up[2].remaining, null);
});

test('flexible weekend: partner day, move planning and schedule note', () => {
  assert.equal(weekendPartner('2026-10-10'), '2026-10-11'); // Sat -> Sun
  assert.equal(weekendPartner('2026-10-11'), '2026-10-10'); // Sun -> Sat
  assert.equal(weekendPartner('2026-10-13'), null);
  assert.equal(scheduleText('Held', 'Jane', '13:30', 2, '2026-10-11'), 'Jane 13:30 (2) web (or Sun)');
  assert.equal(scheduleText('Held', 'Jane', '13:30', 1, null), 'Jane 13:30 web');

  const sat = { date: '2026-10-17', status: '', remaining: 12, slots: ['11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30'].map((t) => ({ time: t, free: true })) };
  const sun = { ...sat, date: '2026-10-18', slots: sat.slots.map((x) => ({ ...x, free: x.time !== '13:30' })) };
  // Sunday cancelled, guest booked Sunday 13:30: moves to Saturday 13:30
  assert.deepEqual({ ...planWeekendMove({ date: '2026-10-18', start: '13:30', people: 1 }, { '2026-10-17': sat }) }, { date: '2026-10-17', start: '13:30' });
  // Saturday cancelled, Sunday 13:30 taken: nearest free time (13:00 before 14:00)
  assert.deepEqual({ ...planWeekendMove({ date: '2026-10-17', start: '13:30', people: 1 }, { '2026-10-18': sun }) }, { date: '2026-10-18', start: '13:00' });
  // other day cancelled, missing or full: no move
  assert.equal(planWeekendMove({ date: '2026-10-17', start: '13:30', people: 1 }, { '2026-10-18': { ...sun, status: 'cancelled' } }), null);
  assert.equal(planWeekendMove({ date: '2026-10-17', start: '13:30', people: 1 }, {}), null);
  assert.equal(planWeekendMove({ date: '2026-10-17', start: '13:30', people: 2 }, { '2026-10-18': { ...sun, remaining: 1 } }), null);

  const links = { cancel: 'https://x/c', confirm: 'https://x/ok', calendar: 'https://x/cal', site: 'https://www.pagsc.ca', email: 'club@example.com', phone: '(306) 222-5684' };
  const m = moveEmail({ name: 'Jane Doe', date: '2026-10-18', start: '13:00', people: 1 }, '2026-10-17', links);
  assert.match(m.subject, /^Flying moved to Sunday: you're pencilled in for 1 pm$/);
  assert.ok(m.html.includes('https://x/ok') && m.html.includes('Pick another day'));
});

test('standby: opens when the day is on (or the other weekend day, if either works)', () => {
  const day = (date, status, remaining) => ({ date, status, open: status === 'on', remaining });
  const avail = { '2026-10-17': day('2026-10-17', '', 8), '2026-10-18': day('2026-10-18', 'on', 5) };
  assert.equal(standbyOpenDay({ date: '2026-10-17', flexible: false }, avail), null); // Saturday not confirmed yet
  assert.equal(standbyOpenDay({ date: '2026-10-17', flexible: true }, avail).date, '2026-10-18'); // either day: Sunday is on
  assert.equal(standbyOpenDay({ date: '2026-10-18', flexible: false }, avail).date, '2026-10-18');
  assert.equal(standbyOpenDay({ date: '2026-10-18', flexible: false }, { '2026-10-18': day('2026-10-18', 'on', 0) }), null); // full
  assert.equal(standbyOpenDay({ date: '2026-10-17', flexible: true }, { '2026-10-18': day('2026-10-18', 'cancelled', 8) }), null);
  const links = { cancel: '', confirm: '', calendar: '', site: 'https://www.pagsc.ca', email: 'club@example.com', phone: '(306) 222-5684', off: 'https://x/off', keep: 'https://x/keep' };
  const e = standbyEmail({ scope: 'Weekend', name: 'Sam Lee', date: '2026-10-17', people: 2, flexible: true, codes: [] }, links);
  assert.match(e.subject, /standby list: Saturday, October 17/);
  assert.ok(e.html.includes('https://x/off') && e.html.includes('Buy a Discovery Flight'));
  const link = standbyLink('https://www.pagsc.ca', '2026-10-18', []);
  const o = standbyOpenEmail({ name: 'Sam Lee', codes: [] }, [{ date: '2026-10-18', remaining: 5, link }], links);
  assert.equal(o.subject, 'Spots are open: Sunday, October 18');
  assert.ok(o.html.includes('?date=2026-10-18#request') && o.html.includes('pay at the field'));
});

test('standby: any weekend we fly', () => {
  assert.equal(standbyScope('', 'Yes'), 'Weekend');
  assert.equal(standbyScope('', 'No'), 'Day');
  assert.equal(standbyScope('Any', 'No'), 'Any');
  const avail = [
    { date: '2026-10-16', kind: 'weekday', open: true, remaining: 12 },
    { date: '2026-10-17', kind: 'weekend', open: true, remaining: 3 },
    { date: '2026-10-18', kind: 'weekend', open: true, remaining: 1 },
    { date: '2026-10-24', kind: 'weekend', status: '', remaining: 8 },
  ];
  // Weekend days only, with room for the group, not already emailed about.
  assert.deepEqual(standbyAnyOpenDays({ people: 2 }, avail, []).map((d) => d.date), ['2026-10-17']);
  assert.deepEqual(standbyAnyOpenDays({ people: 1 }, avail, ['2026-10-17']).map((d) => d.date), ['2026-10-18']);
  assert.deepEqual(standbyAnyOpenDays({ people: 1 }, avail, ['2026-10-17', '2026-10-18']), []);

  // 'Days notified' read back as text, or as the Date Sheets made of a lone entry: no repeat emails.
  assert.deepEqual([...standbyNotifiedList('2026-10-17, 2026-10-18')], ['2026-10-17', '2026-10-18']);
  assert.deepEqual([...standbyNotifiedList('')], []);
  // A Date as Apps Script hands it back (built inside the script's context, with a stand-in for Utilities).
  ctx.Utilities = { formatDate: (d) => d.toISOString().slice(0, 10) };
  const sheetDate = vm.runInContext("new Date('2026-10-17T12:00:00Z')", ctx);
  assert.deepEqual([...standbyNotifiedList(sheetDate)], ['2026-10-17']);
  assert.deepEqual(standbyAnyOpenDays({ people: 1 }, avail, standbyNotifiedList(sheetDate)).map((d) => d.date), ['2026-10-18']);
  delete ctx.Utilities;
  // Every 10th email asks whether they would like to come off the list; nobody is removed.
  assert.deepEqual([1, 9, 10, 11, 20].map(standbyAskToStay), [false, false, true, false, true]);

  const links = { site: 'https://www.pagsc.ca', email: 'club@example.com', phone: '(306) 222-5684', off: 'https://x/off' };
  const codes = ['PAGSC-7KQ2-XM9D'];
  const e = standbyEmail({ scope: 'Any', name: 'Sam Lee', date: '', people: 1, codes }, links);
  assert.equal(e.subject, "You're on the standby list");
  assert.ok(e.html.includes('Any weekend we fly') && e.html.includes('?code=PAGSC-7KQ2-XM9D') && !e.html.includes('Buy a Discovery Flight'));
  const days = ['2026-10-17', '2026-10-18'].map((date) => ({ date, remaining: 3, link: standbyLink(links.site, date, codes) }));
  const o = standbyOpenEmail({ name: 'Sam Lee', codes }, days, links);
  assert.equal(o.subject, 'Spots are open: Saturday, October 17 and Sunday, October 18');
  assert.ok(o.html.includes('?date=2026-10-18&amp;code=PAGSC-7KQ2-XM9D#request') && o.html.includes('Book a spot on Saturday'));
  assert.ok(!o.html.includes('Still want these emails?'));
  const tenth = standbyOpenEmail({ name: 'Sam Lee', codes }, days, links, 10);
  assert.ok(tenth.html.includes('Still want these emails?') && tenth.html.includes('email number 10') && tenth.html.includes('https://x/off'));
});

test('same day: a day opened to guests opens today, from an hour ahead', () => {
  const rows = [
    ['', 'Sat Oct 10,2026', 'Sun Oct 11,2026'],
    ['Status/Comments:', 'Day is a go. Discovery flights available', ''],
    ['Intro', 'Intro Fam Flight Sign-up Below', 'Intro Fam Flight Sign-up Below'],
  ];
  const days = scheduleDays(rows);
  // Without the time of day (the reminder job's weekend moves), today stays closed.
  assert.equal(computeAvailability(days, [], {}, '2026-10-10')[0].date, '2026-10-11');
  // At 12:10 the first open start is 13:30 (an hour's notice): 13:30 to 16:30 is 7 starts.
  const sat = computeAvailability(days, [], {}, '2026-10-10', 12 * 60 + 10)[0];
  assert.equal(sat.date, '2026-10-10');
  assert.equal(sat.slots.find((x) => x.free).time, '13:30');
  assert.equal(sat.remaining, 7);
  // Flying but not opened to guests: today stays closed.
  rows[1][1] = 'Day is a go';
  assert.equal(computeAvailability(scheduleDays(rows), [], {}, '2026-10-10', 9 * 60)[0].date, '2026-10-11');
  // Late in the day there is nothing left to book.
  rows[1][1] = 'Discovery flights available';
  assert.equal(computeAvailability(scheduleDays(rows), [], {}, '2026-10-10', 16 * 60)[0].remaining, 0);
});

test('guest opening: "Discovery flights available", with optional total spots', () => {
  assert.deepEqual({ ...guestOpening('Day is a go. Discovery flights available') }, { spots: null });
  assert.deepEqual({ ...guestOpening('Discovery flights available: 4') }, { spots: 4 });
  assert.deepEqual({ ...guestOpening('Discovery Flights Open (3)') }, { spots: 3 });
  assert.deepEqual({ ...guestOpening('Confirmed, 2 discovery flights available') }, { spots: 2 });
  assert.equal(guestOpening('Day is a go'), null);
  assert.equal(guestOpening('Confirmed'), null);
  assert.equal(guestOpening('Cancelled: wind. Discovery flights available next weekend'), null);

  // The number is guest flights that day in total: 4, with 1 already booked, leaves 3.
  const rows = [
    ['', 'Sat Oct 10,2026', 'Sun Oct 11,2026'],
    ['Status/Comments:', 'Discovery flights available: 4', 'Day is a go'],
    ['Intro', 'Intro Fam Flight Sign-up Below', 'Intro Fam Flight Sign-up Below'],
  ];
  const [sat, sun] = computeAvailability(scheduleDays(rows), [{ date: '2026-10-10', start: '11:00', people: 1 }], {}, '2026-10-09');
  assert.equal(sat.open, true);
  assert.equal(sat.remaining, 3);
  assert.equal(sun.open, false); // flying, but not open to guests yet
  assert.equal(sun.status, 'on');
});

test('website booking cells are not counted twice, with or without the either-day note', () => {
  assert.equal(manualEntry('Morgan 11:00 (2) web'), null);
  assert.equal(manualEntry('Morgan 12:00 (2) web (or Sat)'), null);
  assert.equal(manualEntry('Morgan 12:00 web (or Sun)'), null);
  assert.equal(manualEntry(scheduleText('Held', 'Morgan', '12:00', 2, '2026-10-24')), null);
  assert.equal(manualEntry("Pratham's friend").people, 1);
});
