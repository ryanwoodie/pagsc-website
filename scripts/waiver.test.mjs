// Tests the waiver logic in apps-script/Waivers.gs and the generated WaiverText.gs (no Google services needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'yaml';
import { readWaiver, gsSource, GS_FILE } from './waiver-text.mjs';

const ctx = {};
vm.createContext(ctx);
for (const f of ['Code.gs', 'Booking.gs', 'Emails.gs', 'Waivers.gs', 'WaiverText.gs']) vm.runInContext(readFileSync(new URL(`../apps-script/${f}`, import.meta.url), 'utf8'), ctx);
const { ageOn, needsGuardian, readWaiverPost, waiverPlain, waiverDocHtml, waiverEmail, signedCount, dayOfMonth, confirmationEmail } = ctx;
vm.runInContext('var __w = WAIVER, __t = WAIVER_TEXT;', ctx);

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const adult = {
  participant: 'Sam Example', dob: '1990-05-01', email: 'sam@example.com', phone: '306 555 0100', address: '1 Main St, Prince Albert',
  emergency_name: 'Pat Example', emergency_phone: '306 555 0101', place: 'Prince Albert', sig: PNG, agree: 'yes', version: '2026-10',
};
const links = { site: 'https://www.pagsc.ca', email: 'club@example.com', phone: '(306) 222-5684', cancel: 'https://x/cancel', waiver: 'https://www.pagsc.ca/waiver/?b=abc' };

test('WaiverText.gs is up to date with content/waiver.md (run npm run waiver)', () => {
  assert.equal(readFileSync(GS_FILE, 'utf8'), gsSource());
});

test('the waiver keeps its wording and fills in the name', () => {
  const w = readWaiver();
  assert.equal(w.blocks[0].type, 'h2');
  const text = waiverPlain(ctx.__t, 'Sam Example');
  assert.match(text, /This is a legally binding contract between me, Sam Example, and Prince Albert Gliding and Soaring Club Inc\./);
  assert.match(text, /Court of King's Bench for Saskatchewan/);
  assert.ok(!text.includes('**') && !text.includes('{participant}'));
});

test('guardian age matches club-facts.yaml', () => {
  const facts = parse(readFileSync(new URL('../content/club-facts.yaml', import.meta.url), 'utf8')).waiver;
  assert.equal(ctx.__w.GUARDIAN_MAX_AGE, facts.guardian_max_age);
});

test('ages count whole years to the day', () => {
  assert.equal(ageOn('2008-10-16', '2026-10-16'), 18);
  assert.equal(ageOn('2008-10-17', '2026-10-16'), 17);
  assert.equal(ageOn('2007-10-16', '2026-10-16'), 19);
  assert.ok(Number.isNaN(ageOn('16/10/2008', '2026-10-16')));
  assert.equal(needsGuardian(18), true);
  assert.equal(needsGuardian(19), false);
});

test('an adult signing needs every field, and no guardian', () => {
  const ok = readWaiverPost({ ...adult, guardian: 'Ignored', guardian_sig: PNG }, '2026-10-16');
  assert.ok(ok.f);
  assert.equal(ok.f.age, 36);
  assert.equal(ok.f.guardian, '');
  const bad = readWaiverPost({ ...adult, emergency_phone: '', sig: 'data:image/jpeg;base64,xx', agree: '' }, '2026-10-16');
  assert.match(bad.error, /emergency contact's phone/);
  assert.match(bad.error, /a signature/);
  assert.match(bad.error, /read the waiver/);
});

test('anyone 18 or under signs with a guardian', () => {
  const kid = { ...adult, dob: '2012-03-01' };
  assert.match(readWaiverPost(kid, '2026-10-16').error, /parent or guardian's name.*parent or guardian's signature/);
  const ok = readWaiverPost({ ...kid, guardian: 'Pat Example', guardian_sig: PNG }, '2026-10-16');
  assert.equal(ok.f.guardian, 'Pat Example');
});

test('the signed PDF shows the text, signatures, details and the record', () => {
  const f = { ...readWaiverPost({ ...adult, dob: '2012-03-01', guardian: 'Pat Example', guardian_sig: PNG, device: 'Test' }, '2026-10-16').f,
    signedIso: '2026-10-16', signedText: 'October 16, 2026, 3:05 PM', hash: 'ab'.repeat(32), id: 'id-1' };
  const html = waiverDocHtml(ctx.__t, f);
  assert.match(html, /between me, <strong>Sam Example<\/strong>, and/);
  assert.match(html, /SIGNED at Prince Albert on the 16th day of October, 2026\./);
  assert.match(html, /Guardian signature \(18 and under\)/);
  assert.match(html, /Emergency contact phone/);
  assert.match(html, /Waiver version 2026-10/);
  assert.ok(html.includes('ab'.repeat(32)));
  assert.equal(dayOfMonth('2026-10-01'), '1st day of October, 2026');
  assert.equal(dayOfMonth('2026-10-12'), '12th day of October, 2026');
  assert.match(waiverEmail(f, links).text, /with Pat Example as parent or guardian/);
});

test('signed counts distinct people per booking', () => {
  const row = (name, key) => { const r = Array(ctx.__w.HEADERS.length).fill(''); r[1] = name; r[12] = key; return r; };
  assert.equal(signedCount([ctx.__w.HEADERS, row('Sam A', 'k1'), row('sam a ', 'k1'), row('Jo B', 'k1'), row('Jo B', 'k2')], 'k1'), 2);
  assert.equal(signedCount([row('Sam A', '')], ''), 0);
});

test('booking emails carry the waiver link until everyone has signed', () => {
  const b = { name: 'Sam Example', date: '2026-10-17', start: '11:00', people: 2 };
  const mail = confirmationEmail(b, true, links);
  assert.ok(mail.html.includes('Sign the waiver') && mail.text.includes(links.waiver));
  assert.match(mail.text, /each person signs their own/);
  const done = confirmationEmail({ ...b, waiversSigned: 2 }, true, links);
  assert.ok(!done.html.includes('Sign the waiver'));
});
