// Tests the pure booking logic in apps-script/Booking.gs (no Google services needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'yaml';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../apps-script/Booking.gs', import.meta.url), 'utf8'), ctx);
const { slotTimes, scheduleDays, computeAvailability, canBook, timeRange } = ctx;

// Synthetic schedule in the documented layout. No real names.
const grid = [
  ['', 'Fri Oct 9,2026', 'Sat Oct 10,2026', 'Sun Oct 11,2026', 'Tue Oct 13,2026', 'Sat Nov 28,2026'],
  ['Weather', '', '', '', '', ''],
  ['Status/Comments:', '', 'Day is a go', 'Cancelled: wind', '', ''],
  ['Intro', 'Intro Fam Flight Sign-up Below for Fri:', 'Intro Fam Flight Sign-up Below for Sat:', 'Intro Fam Flight Sign-up Below', 'Intro Fam Flight Sign-up Below', 'Intro Fam Flight Sign-up Below'],
  ['', '', 'Guest A', '', '', ''],
  ['Students', 'Student/Pilots Sign-up Below', 'Student/Pilots Sign-up Below', '', '', ''],
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
  assert.deepEqual({ ...d[1] }, { date: '2026-10-10', col: 2, introRow: 3, statusText: 'Day is a go' });
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
