import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseSheetDate, extractDays, classifyStatus } from './schedule-parse.mjs';

// Synthetic sheet in the documented layout. No real names.
const csv = [
  ',"Fri Oct 2,2026","Sat Oct 3,2026","Sun Oct 4,2026","Mon Oct 5,2026","Sat Oct 10,2026"',
  'Weather link,cloudy,"sunny, light wind",showers,,',
  'Status/Comments:,,"Day is a go. Member E and Member F arriving at 10:15am",Cancelled: wind,,',
  'Intro flights,Intro Fam Flight Sign-up Below for Fri:,Intro Fam Flight Sign-up Below for Sat:,Intro Fam Flight Sign-up Below for Sun:,x,x',
  'Directions,,Guest A,,,',
  'Students :,Student/Pilots SIgn-up Below:,Student/Pilots SIgn-up Below:,Student/Pilots SIgn-up Below:,,',
  ',,Member B,Member C,,',
  'Instructors:,Instructors Sign-up Below:,Instructors Sign-up Below:,Instructors Sign-up Below:,,Instructors Sign-up Below:',
  ',,Instructor D,,,',
].join('\r\n');

test('parses quoted CSV', () => {
  const rows = parseCsv('a,"b, c","d ""e"""\n1,2,3');
  assert.deepEqual(rows, [['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
});

test('parses sheet dates', () => {
  assert.equal(parseSheetDate('Sat Oct 3,2026'), '2026-10-03');
  assert.equal(parseSheetDate('Sun Nov 15, 2026'), '2026-11-15');
  assert.equal(parseSheetDate('Directions'), null);
  assert.equal(parseSheetDate('Sat Feb 31,2026'), null);
});

test('extracts upcoming weekend days, status and instructor flag only', () => {
  const days = extractDays(parseCsv(csv), '2026-10-03');
  assert.deepEqual(days, [
    { date: '2026-10-03', status: 'on', note: 'Day is a go. Member E and Member F arriving at 10:15am', instructor: true },
    { date: '2026-10-04', status: 'cancelled', note: 'Cancelled: wind', instructor: false },
    { date: '2026-10-10', status: '', note: '', instructor: false },
  ]);
  const json = JSON.stringify(days);
  // Sign-up names never appear; the status text is published as written.
  for (const name of ['Guest A', 'Member B', 'Member C', 'Instructor D']) {
    assert.ok(!json.includes(name), name);
  }
});

test('empty or unrelated input gives no days', () => {
  assert.deepEqual(extractDays([], '2026-10-03'), []);
  assert.deepEqual(extractDays(parseCsv('<html>sign in</html>'), '2026-10-03'), []);
});

test('classifies status text without keeping it', () => {
  assert.equal(classifyStatus('day is a go. Two members arriving at 10:15am'), 'on');
  assert.equal(classifyStatus('Cancelled - too windy'), 'cancelled');
  assert.equal(classifyStatus('Delayed until 1 pm, low cloud'), 'delayed');
  assert.equal(classifyStatus('Bring a jacket'), 'unknown');
  assert.equal(classifyStatus('  '), '');
});
