// Tests the pure certificate logic in apps-script/Vouchers.gs and the QR encoder in Qr.gs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'yaml';

const ctx = {};
vm.createContext(ctx);
for (const f of ['Booking.gs', 'Emails.gs', 'Qr.gs', 'Vouchers.gs']) vm.runInContext(readFileSync(new URL(`../apps-script/${f}`, import.meta.url), 'utf8'), ctx);
const { makeCode, normalizeCode, parseCodes, orderFromSession, flightsRefunded, bookingLink, certificateHtml, voucherEmail, qrMatrix, VOUCHER, BOOKING } = ctx;
const links = { site: 'https://www.pagsc.ca', email: 'club@example.com', phone: '(306) 000-0000' };

test('codes use the look-alike-free alphabet', () => {
  const code = makeCode([0, 1, 2, 3, 250, 251, 252, 253]);
  assert.match(code, /^PAGSC-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  assert.ok(!/[01OIL]/.test(code.slice(6)));
});

test('typed codes are tidied, bad ones refused', () => {
  assert.equal(normalizeCode(' pagsc 7kq2 xm9d '), 'PAGSC-7KQ2-XM9D');
  assert.equal(normalizeCode('7KQ2XM9D'), 'PAGSC-7KQ2-XM9D');
  assert.equal(normalizeCode('PAGSC-7KQ2-XM9O'), ''); // O is not in the alphabet
  assert.equal(normalizeCode('PAGSC-7KQ2'), '');
  const p = parseCodes('PAGSC-7KQ2-XM9D, pagsc-7kq2-xm9d\nPAGSC-ABCD-EFGH; nonsense');
  assert.deepEqual([...p.codes], ['PAGSC-7KQ2-XM9D', 'PAGSC-ABCD-EFGH']);
  assert.deepEqual([...p.bad], ['nonsense']);
  assert.equal(parseCodes('').codes.length, 0);
});

test('order from a Checkout Session', () => {
  const s = {
    id: 'cs_live_abc', status: 'complete', payment_status: 'paid', payment_intent: 'pi_1',
    metadata: { pagsc_type: 'group' },
    customer_details: { email: 'buyer@example.com', name: 'Card Name' },
    collected_information: { individual_name: 'Pat Buyer' },
    custom_fields: [{ key: 'recipient', text: { value: ' Sam ' } }, { key: 'giftmessage', text: { value: null } }],
    line_items: { data: [{ quantity: 5, amount_total: 20000 }] },
  };
  const o = orderFromSession(s);
  assert.equal(o.paid, true);
  assert.equal(o.ours, true);
  assert.equal(o.name, 'Pat Buyer');
  assert.equal(o.email, 'buyer@example.com');
  assert.equal(o.quantity, 5);
  assert.equal(o.value, 40);
  assert.equal(o.recipient, 'Sam');
  assert.equal(o.message, '');
  assert.equal(o.paymentId, 'pi_1');
  assert.equal(orderFromSession({ ...s, payment_status: 'unpaid' }).paid, false);
  assert.equal(orderFromSession({ ...s, metadata: {} }).ours, false);
  assert.equal(orderFromSession({ ...s, collected_information: null }).name, 'Card Name');
});

test('refunds count flights by amount', () => {
  assert.equal(flightsRefunded(5000, 50), 1);
  assert.equal(flightsRefunded(12000, 40), 3);
  assert.equal(flightsRefunded(100, 50), 1);
});

test('certificate: one page per flight, code, QR link, recipient or blank lines', () => {
  const html = certificateHtml([
    { code: 'PAGSC-7KQ2-XM9D', recipient: 'Sam <3', message: 'Happy birthday', value: 50 },
    { code: 'PAGSC-ABCD-EFGH', recipient: '', message: '', value: 50 },
  ], links);
  assert.equal(html.match(/page-break-after:always/g).length, 1);
  assert.ok(html.includes('PAGSC-7KQ2-XM9D') && html.includes('PAGSC-ABCD-EFGH'));
  assert.ok(html.includes('Sam &lt;3'));
  assert.ok(html.includes('Never expires'));
  assert.ok(html.includes('Value $50'));
  assert.equal(bookingLink(links.site, ['PAGSC-7KQ2-XM9D']), 'https://www.pagsc.ca/discovery-flight/?code=PAGSC-7KQ2-XM9D#request');
});

test('certificate email lists every code and links to booking with them', () => {
  const m = voucherEmail({ name: 'Pat Buyer' }, ['PAGSC-7KQ2-XM9D', 'PAGSC-ABCD-EFGH'], links);
  assert.match(m.subject, /2 Discovery Flight certificates/);
  assert.ok(m.html.includes('code=PAGSC-7KQ2-XM9D,PAGSC-ABCD-EFGH#request'));
  assert.ok(m.text.includes('Hi Pat,'));
  assert.equal(voucherEmail({ name: 'Pat' }, ['PAGSC-7KQ2-XM9D'], links).subject, 'Your Discovery Flight certificate');
});

test('QR codes are square and sized for the booking link', () => {
  const m = qrMatrix(bookingLink(links.site, ['PAGSC-7KQ2-XM9D']));
  assert.equal(m.length, 37); // version 5
  assert.ok(m.every((r) => r.length === m.length));
  assert.equal(m[0][0], true); // finder pattern corner
});

test('club-facts.yaml price and group size match Vouchers.gs', () => {
  const facts = parse(readFileSync(new URL('../content/club-facts.yaml', import.meta.url), 'utf8'));
  assert.equal(facts.discovery_flight.price, VOUCHER.PRICE);
  assert.equal(VOUCHER.MAX_CODES, BOOKING.MAX_GROUP);
});

test('certificate QR is an embedded PNG, not table cells', () => {
  const { qrPng } = ctx;
  const png = qrPng('https://www.pagsc.ca/', 4);
  assert.deepEqual([...png.slice(0, 8)], [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const html = certificateHtml([{ code: 'PAGSC-7KQ2-XM9D', recipient: '', message: '', value: 50 }], links);
  assert.equal(html.match(/data:image\/png;base64,/g).length, 1);
});
