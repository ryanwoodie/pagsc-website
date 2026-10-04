// Tests the pure booking logic in apps-script/Booking.gs (no Google services needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'yaml';

const ctx = {};
vm.createContext(ctx);
for (const f of ['Booking.gs', 'Emails.gs']) vm.runInContext(readFileSync(new URL(`../apps-script/${f}`, import.meta.url), 'utf8'), ctx);
const { slotTimes, scheduleDays, computeAvailability, canBook, timeRange, reminderDue, statusChangeDue, clock12, timeRange12, longDate, confirmationEmail, reminderEmail, statusEmail } = ctx;

// Synthetic schedule in the documented layout. No real names.
const grid = [
  ['', 'Fri Oct 9,2026', 'Sat Oct 10,2026', 'Sun Oct 11,2026', 'Tue Oct 13,2026', 'Sat Nov 28,2026'],
  ['Weather forecast', '', 'Sunny', '', '', ''],
  ['Status/Comments:', '', 'Day is a go', 'Cancelled: wind', '', ''],
  ['Intro', 'Intro Fam Flight Sign-up Below for Fri:', 'Intro Fam Flight Sign-up Below for Sat:', 'Intro Fam Flight Sign-up Below', 'Intro Fam Flight Sign-up Below', 'Intro Fam Flight Sign-up Below'],
  ['', '', 'Guest A', '', '', ''],
  ['Students', 'Student/Pilots Sign-up Below', 'Student/Pilots Sign-up Below', '', '', ''],
  ['Instructors:', 'Instructors Sign-up Below', 'Instructors Sign-up Below', 'Instructors Sign-up Below', '', ''],
  ['', '', 'Instructor D', '', '', ''],
];

test('slot times run 11:00 to 16:00 every half hour', () => {
  const t = slotTimes();
  assert.equal(t[0], '11:00');
  assert.equal(t.at(-1), '16:00');
  assert.equal(t.length, 11);
});

test('reads dates, status and intro rows', () => {
  const d = scheduleDays(grid);
  assert.equal(d.length, 5);
  assert.deepEqual({ ...d[1] }, { date: '2026-10-10', col: 2, introRow: 3, statusText: 'Day is a go', weather: 'Sunny', instructor: true });
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
  assert.equal(sat.remaining, 1); // 6 - 5
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
  assert.match(canBook(sat, '15:30', 3), /too late/);
  assert.equal(canBook(sat, '15:00', 3), '');
  assert.match(canBook(sat, '13:00', 5), /1 to 4/);
  assert.match(canBook(sun, '11:00', 1), /not running/);
  assert.match(canBook(tue, '11:00', 4), /^$/);
  assert.match(canBook({ ...tue, remaining: 1 }, '11:00', 2), /only 1 guest spot left/);
  assert.equal(timeRange('15:00', 3), '15:00 to 16:30');
});

test('club-facts.yaml booking settings match Booking.gs', () => {
  const facts = parse(readFileSync(new URL('../content/club-facts.yaml', import.meta.url), 'utf8')).booking;
  const B = vm.runInContext('BOOKING', ctx);
  assert.equal(facts.first_start, B.FIRST);
  assert.equal(facts.last_start, B.LAST);
  assert.equal(facts.minutes_per_person, B.STEP);
  assert.equal(facts.guest_spots_per_day, B.CAP);
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
});
