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
const { ageOn, needsGuardian, readWaiverPost, waiverPlain, waiverDocHtml, waiverEmail, signedCount, confirmationEmail } = ctx;
vm.runInContext('var __w = WAIVER, __t = WAIVER_TEXT;', ctx);

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const adult = {
  participant: 'Sam Example', dob: '1990-05-01', email: 'sam@example.com', phone: '306 555 0100', address: '1 Main St, Prince Albert',
  emergency_name: 'Pat Example', emergency_phone: '306 555 0101', place: 'Prince Albert', sig: PNG, agree: 'yes', version: '2026-10-16',
};
const links = { site: 'https://www.pagsc.ca', email: 'club@example.com', phone: '(306) 222-5684', cancel: 'https://x/cancel', waiver: 'https://www.pagsc.ca/waiver/?b=abc' };

test('WaiverText.gs is up to date with content/waiver.md (run npm run waiver)', () => {
  assert.equal(readFileSync(GS_FILE, 'utf8'), gsSource());
});

test('the waiver keeps its wording; the guardian paragraph is signed only with a guardian', () => {
  const w = readWaiver();
  assert.deepEqual(w.blocks.slice(0, 4).map((b) => b.type), ['h1', 'h2', 'p', 'hr']);
  const text = waiverPlain(ctx.__t, false);
  assert.match(text, /READ THIS CAREFULLY BEFORE YOU SIGN\./);
  assert.match(text, /I release the Club and the Landowners from all claims for injury, death, or loss or damage to property arising from gliding activities, including claims caused by their negligence\./);
  assert.match(text, /- I am signing voluntarily\.$/);
  assert.ok(!text.includes('**') && !text.includes('parent or legal guardian of the participant'));
  assert.match(waiverPlain(ctx.__t, true), /I am the parent or legal guardian of the participant\./);
});

test('guardian age matches club-facts.yaml', () => {
  const facts = parse(readFileSync(new URL('../content/club-facts.yaml', import.meta.url), 'utf8')).waiver;
  assert.equal(ctx.__w.GUARDIAN_UNDER, facts.guardian_under);
});

test('ages count whole years to the day', () => {
  assert.equal(ageOn('2008-10-16', '2026-10-16'), 18);
  assert.equal(ageOn('2008-10-17', '2026-10-16'), 17);
  assert.equal(ageOn('2007-10-16', '2026-10-16'), 19);
  assert.ok(Number.isNaN(ageOn('16/10/2008', '2026-10-16')));
  assert.equal(needsGuardian(17), true);
  assert.equal(needsGuardian(18), false);
});

test('an adult signing needs every field, and no guardian', () => {
  const ok = readWaiverPost({ ...adult, guardian: 'Ignored', guardian_sig: PNG, guardian_agree: 'yes' }, '2026-10-16');
  assert.ok(ok.f);
  assert.equal(ok.f.age, 36);
  assert.equal(ok.f.guardian, '');
  const bad = readWaiverPost({ ...adult, emergency_phone: '', sig: 'data:image/jpeg;base64,xx', agree: '' }, '2026-10-16');
  assert.match(bad.error, /emergency contact's phone/);
  assert.match(bad.error, /participant's signature/);
  assert.match(bad.error, /read and agree/);
});

test('a witness is optional, but gives both name and signature', () => {
  assert.equal(readWaiverPost({ ...adult, witness: 'Jo Witness', witness_sig: PNG }, '2026-10-16').f.witness, 'Jo Witness');
  assert.match(readWaiverPost({ ...adult, witness: 'Jo Witness' }, '2026-10-16').error, /witness's signature/);
  assert.match(readWaiverPost({ ...adult, witness_sig: PNG }, '2026-10-16').error, /witness's name/);
});

const guardian = { guardian: 'Pat Example', relationship: 'Mother', guardian_phone: '306 555 0102', guardian_sig: PNG, guardian_agree: 'yes' };

test('anyone under 18 signs with a guardian', () => {
  const kid = { ...adult, dob: '2012-03-01' };
  assert.match(readWaiverPost(kid, '2026-10-16').error, /parent or guardian's name.*relationship.*phone number.*signature.*agreement/);
  const ok = readWaiverPost({ ...kid, ...guardian }, '2026-10-16');
  assert.equal(ok.f.relationship, 'Mother');
  assert.ok(readWaiverPost({ ...adult, dob: '2008-10-16' }, '2026-10-16').f); // 18 today
});

test('the signed PDF shows the text, signatures, details and the record', () => {
  const f = { ...readWaiverPost({ ...adult, dob: '2012-03-01', ...guardian, device: 'Test' }, '2026-10-16').f,
    signedText: 'October 16, 2026, 3:05 PM', dateText: 'October 16, 2026', hash: 'ab'.repeat(32), id: 'id-1' };
  const html = waiverDocHtml(ctx.__t, f);
  assert.match(html, /<strong>2\. I give up my right to sue\.<\/strong>/);
  assert.match(html, /Parent or guardian \(required if the participant is under 18\)/);
  assert.match(html, /I am the parent or legal guardian of the participant/);
  assert.match(html, /Mother/);
  assert.match(html, /Emergency contact phone/);
  assert.match(html, /Signed at \(place\)<\/td><td[^>]*>Prince Albert/);
  assert.match(html, /<em>The personal information on this form/);
  assert.match(html, /Waiver version 2026-10-16/);
  assert.ok(html.includes('ab'.repeat(32)));
  assert.match(waiverEmail(f, links).text, /with Pat Example as parent or guardian/);
  const adultHtml = waiverDocHtml(ctx.__t, { ...readWaiverPost(adult, '2026-10-16').f, signedText: 'x', dateText: 'x', hash: 'x', id: 'x' });
  assert.match(adultHtml, /Not required: the participant was 36 on the date signed\./);
});

test('signed counts distinct people per booking', () => {
  const row = (name, key) => { const r = Array(ctx.__w.HEADERS.length).fill(''); r[1] = name; r[ctx.__w.HEADERS.indexOf('Booking key')] = key; return r; };
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
