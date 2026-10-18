// Tests the contact records, thank-you email and admin helpers (apps-script/Data.gs, Emails.gs, Admin.gs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'yaml';

const ctx = {};
vm.createContext(ctx);
for (const f of ['Code.gs', 'Booking.gs', 'Emails.gs', 'Qr.gs', 'Vouchers.gs', 'Waivers.gs', 'Etransfer.gs', 'Standby.gs', 'Data.gs', 'Admin.gs']) vm.runInContext(readFileSync(new URL(`../apps-script/${f}`, import.meta.url), 'utf8'), ctx);
const { makeId, personKey, isPlaceholderName, flyerSlot, thankYouDue, thankYouEmail, adminAllowed, adminMessageEmail, clubCancelEmail, clubMoveEmail } = ctx;
vm.runInContext('var __t = THANKS, __b = BOOKING;', ctx);

const links = { site: 'https://www.pagsc.ca', email: 'club@example.com', phone: '(306) 222-5684', cancel: 'https://x/cancel', calendar: 'https://www.pagsc.ca/discovery-flight/#request' };

test('IDs are short and readable', () => {
  assert.match(makeId('B', [0, 1, 2, 3, 4, 255]), /^B-[A-Z2-9]{6}$/);
});

test('a person is an email and a name: a parent and child sharing an email stay two people', () => {
  assert.equal(personKey('Sam@Example.com ', 'Sam  Example'), personKey('sam@example.com', 'sam example'));
  assert.notEqual(personKey('sam@example.com', 'Sam Example'), personKey('sam@example.com', 'Kid Example'));
});

test('a waiver fills the flyer named after them, else the first placeholder', () => {
  const rows = [{ name: 'Sam Example', waiverId: '' }, { name: 'Guest 2', waiverId: '' }, { name: 'Guest 3', waiverId: '' }];
  assert.equal(flyerSlot(rows, 'sam example'), 0);
  assert.equal(flyerSlot(rows, 'Jo Other'), 1);
  assert.equal(flyerSlot([{ name: 'Sam', waiverId: 'w1' }], 'Jo'), -1);
  assert.equal(isPlaceholderName('Guest 4'), true);
  assert.equal(isPlaceholderName('Guestly'), false);
});

test('the thank-you goes the evening after, only for flights that went ahead', () => {
  assert.equal(thankYouDue('Held', -1, 19, 'on', ''), true);
  assert.equal(thankYouDue('Flown', -1, 20, '', ''), true);
  assert.equal(thankYouDue('Held', -1, 18, 'on', ''), false);
  assert.equal(thankYouDue('Held', -2, 19, 'on', ''), false);
  assert.equal(thankYouDue('No-show', -1, 19, 'on', ''), false);
  assert.equal(thankYouDue('Cancelled', -1, 19, 'on', ''), false);
  assert.equal(thankYouDue('Requested', -1, 19, 'on', ''), false);
  assert.equal(thankYouDue('Held', -1, 19, 'cancelled', ''), false);
  assert.equal(thankYouDue('Held', -1, 19, 'on', new Date()), false);
});

test('thank-you email links match club-facts.yaml', () => {
  const facts = parse(readFileSync(new URL('../content/club-facts.yaml', import.meta.url), 'utf8'));
  assert.equal(ctx.__t.REVIEW, facts.links.google_review);
  assert.equal(ctx.__t.MEMBERSHIP, facts.links.membership_form);
  assert.equal(ctx.__t.SOLO_AGE, facts.training.solo_age);
  assert.equal(ctx.__t.LICENCE_AGE, facts.training.licence_age);
  const m = thankYouEmail('Sam', '2026-10-17', links);
  assert.equal(m.subject, 'Thanks for flying with us');
  assert.ok(m.html.includes(facts.links.google_review) && m.html.includes('https://www.pagsc.ca/learn-to-fly/'));
  assert.match(m.text, /Saturday, October 17/);
});

test('only listed emails may sign in', () => {
  assert.equal(adminAllowed('PA.Gliding.Soaring.Club@gmail.com', 'pa.gliding.soaring.club@gmail.com'), true);
  assert.equal(adminAllowed('other@gmail.com', 'pa.gliding.soaring.club@gmail.com, b@x.com'), false);
  assert.equal(adminAllowed('', ''), false);
});

test('volunteer messages are escaped and kept in paragraphs', () => {
  const m = adminMessageEmail('Sam', 'Hello', 'Line one\nline two\n\n<script>x</script>', links);
  assert.ok(m.html.includes('Line one<br>line two'));
  assert.ok(!m.html.includes('<script>'));
  const b = { name: 'Sam Example', date: '2026-10-24', start: '13:00', people: 2 };
  assert.match(clubCancelEmail(b, 'Wind forecast is too strong.', links).text, /Wind forecast is too strong\./);
  assert.match(clubMoveEmail(b, { date: '2026-10-24', start: '11:00' }, links).subject, /Saturday, October 24, 1 pm to 2 pm/);
});

test('bookings carry the new columns at the end', () => {
  const h = [...ctx.__b.HEADERS];
  assert.deepEqual(h.slice(-4), ['Booking ID', 'Person ID', 'Follow-up sent', 'Notes']);
  assert.equal(h.indexOf('Token'), 12); // older code reads columns by position
});
