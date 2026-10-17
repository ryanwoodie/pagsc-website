// Tests the e-transfer logic in apps-script/Etransfer.gs (no Google services needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'yaml';

const ctx = {};
vm.createContext(ctx);
for (const f of ['Code.gs', 'Booking.gs', 'Emails.gs', 'Qr.gs', 'Vouchers.gs', 'Waivers.gs', 'Etransfer.gs']) vm.runInContext(readFileSync(new URL(`../apps-script/${f}`, import.meta.url), 'utf8'), ctx);
const { makeReference, findReference, etransferEach, payByMs, parseInterac, interacSigned, payByText, etransferOrderEmail, etransferReleasedEmail, confirmationEmail } = ctx;
vm.runInContext('var __e = ETRANSFER, __v = VOUCHER;', ctx);

const links = { site: 'https://www.pagsc.ca', email: 'pa.gliding.soaring.club@gmail.com', phone: '(306) 222-5684', cancel: 'https://x/cancel', calendar: 'https://www.pagsc.ca/discovery-flight/#request', waiver: '' };

// Shaped like the Interac "automatically deposited" email (synthetic sender and details).
const subject = "Interac e-Transfer: You've received $100.00 from Sam Example and it has been automatically deposited.";
const body = `Hi PRINCE ALBERT GLIDING AND,
Funds Deposited!
$100.00
Your funds have been automatically deposited into your account at RBC Royal Bank.
Transfer Details
Message:
Two flights et-7kq2 xm9d thanks
Date:
Oct 15, 2026
Reference Number:
CA6xAB12
Sent From:
Sam Example
Amount:
$100.00 (CAD)`;

test('references look like certificate codes with an ET prefix', () => {
  assert.match(makeReference([0, 1, 2, 3, 4, 5, 6, 7]), /^ET-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
});

test('finds a reference however it is typed, and ignores look-alikes', () => {
  assert.equal(findReference('ET-7KQ2-XM9D'), 'ET-7KQ2-XM9D');
  assert.equal(findReference('flight et 7kq2xm9d'), 'ET-7KQ2-XM9D');
  assert.equal(findReference('ET7KQ2 XM9D please'), 'ET-7KQ2-XM9D');
  assert.equal(findReference('ET-7KQ0-XM9D'), ''); // 0 is never in a reference
  assert.equal(findReference('Thank you'), '');
});

test('reads the Interac email', () => {
  const t = parseInterac(subject, body);
  assert.equal(t.amount, 100);
  assert.equal(t.from, 'Sam Example');
  assert.equal(t.deposited, true);
  assert.equal(t.reference, 'CA6xAB12');
  assert.equal(t.message, 'Two flights et-7kq2 xm9d thanks');
  assert.equal(findReference(t.message), 'ET-7KQ2-XM9D');
  const pending = parseInterac('Interac e-Transfer: Sam Example sent you $50.00 (CAD) and the money is waiting for you.', 'Amount:\n$50.00 (CAD)');
  assert.equal(pending.amount, 50);
  assert.equal(pending.deposited, false);
});

test('only Interac-signed emails count', () => {
  assert.equal(interacSigned('mx.google.com; dkim=pass header.i=@payments.interac.ca header.s=s1; spf=pass'), true);
  assert.equal(interacSigned('mx.google.com; dkim=pass header.d=interac.ca'), true);
  assert.equal(interacSigned('mx.google.com; dkim=fail header.i=@payments.interac.ca'), false);
  assert.equal(interacSigned('mx.google.com; dkim=pass header.i=@interac.ca.evil.com'), false);
  assert.equal(interacSigned(''), false);
});

test('prices and limits match club-facts.yaml', () => {
  const facts = parse(readFileSync(new URL('../content/club-facts.yaml', import.meta.url), 'utf8')).discovery_flight;
  assert.equal(ctx.__e.GROUP_PRICE, facts.group_price_each);
  assert.equal(ctx.__e.GROUP_MIN, facts.group_minimum);
  assert.equal(etransferEach(1), facts.price);
  assert.equal(etransferEach(4), facts.group_price_each);
});

test('a booking is held 48 hours, or until 30 minutes before the flight', () => {
  const made = Date.parse('2026-10-15T12:00:00-06:00');
  assert.equal(payByMs(made, '2026-10-24', '13:00'), made + 48 * 3600000);
  assert.equal(payByMs(made, '2026-10-16', '11:00'), Date.parse('2026-10-16T10:30:00-06:00'));
  assert.equal(payByText(Date.parse('2026-10-16T10:30:00-06:00')), 'Friday, October 16 at 10:30 am');
});

test('emails carry the amount, address and reference', () => {
  const o = { name: 'Sam Example', quantity: 2, amount: 100, reference: 'ET-7KQ2-XM9D' };
  const m = etransferOrderEmail(o, links);
  assert.match(m.subject, /ET-7KQ2-XM9D/);
  assert.ok(m.text.includes('send $100 to pa.gliding.soaring.club@gmail.com and put ET-7KQ2-XM9D in the message'));
  const b = { name: 'Sam Example', date: '2026-10-17', start: '14:30', people: 2, etransfer: { reference: 'ET-7KQ2-XM9D', amount: 100, payBy: 'Friday, October 16 at 10:30 am' } };
  const c = confirmationEmail(b, true, links);
  assert.ok(c.html.includes('ET-7KQ2-XM9D') && c.text.includes('or the spot is released'));
  assert.match(etransferReleasedEmail(b, 'ET-7KQ2-XM9D', links).text, /still send it, with ET-7KQ2-XM9D/);
});
