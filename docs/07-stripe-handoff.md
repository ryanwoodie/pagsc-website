# Stripe handoff: flight purchases, gift certificates and redemption

Written 4 October 2026 to continue in a new conversation. Read `CLAUDE.md` first, then this.

## Where things stand

The site is live at https://www.pagsc.ca (GitHub Pages, repo `ryanwoodie/pagsc-website`, DNS on
Cloudflare). Discovery Flights are sold through **Wave** checkout links today. We are moving the
purchase to **Stripe** so that certificates can be issued automatically and redeemed once.

**Why we are leaving Wave checkout:** Wave's payment notification to the club Gmail
(from `payment-support@waveapps.com`, subject "Congrats, you just got paid!") contains only the
buyer's name, the amount and the product, e.g. "a payment from Ryan Wood for $50.00. This payment
was for Introductory Glider Flight." No buyer email, no quantity, no recipient. Wave's API is
built around invoices and accounting and is not known to expose checkout payments, so it was not
pursued. Wave stays as the club's bookkeeping; Stripe pays out to the bank and Wave reconciles
the deposits.

### Stripe setup progress

- [x] Decision: Stripe Payment Links / Checkout, Payments first. Terminal (card reader at the
  field), Billing (membership renewals) and Invoicing (groups, cadet squadrons) are later phases.
- [x] Stripe Claude Code plugin installed: `stripe@claude-plugins-official` (user scope). It
  bundles the Stripe MCP server `plugin:stripe:stripe` at `https://mcp.stripe.com`.
- [ ] **Ryan:** create the club's Stripe account (club Gmail, legal details, bank account,
  identity verification). Ask Stripe about the non-profit / registered-charity rate.
- [x] MCP server authenticated (3 October 2026). It reaches only the **sandbox**
  "Prince Albert Gliding and Soaring Club Inc. sandbox" (`acct_1UMDdbABB6Va3lZY`, test mode).
  To create the live objects through the MCP, Ryan grants the live account in the Stripe
  dashboard (MCP > manage accounts), or recreates them by hand in live mode.
- [ ] Run `stripe_implementation_planner` with: Business `pagsc.ca`; "Non-profit gliding club,
  provides glider flight training"; products Payments (now), Billing, Invoicing, Terminal (later).
  If the planner is unavailable after authenticating, fall back to `npx skills add https://docs.stripe.com`.
- [x] Sandbox products and Payment Links created (3 October 2026), see "Sandbox objects" below.
- [x] Live products and Payment Links created (4 October 2026), see "Live objects" below. The MCP
  connection has write access to the live account.
- [x] Live restricted key in Apps Script Script Properties as `STRIPE_KEY` (4 October 2026). It
  was pasted into a chat once; Ryan to rotate it in Stripe and paste the new one into Script Properties.
- [x] Voucher system built (4 October 2026): `apps-script/Vouchers.gs`, `apps-script/Qr.gs`,
  booking code checks in `Booking.gs`, the paid page and the calendar's code field.
  Tests in `scripts/vouchers.test.mjs`. Details in `apps-script/README.md`.
- [ ] **Ryan:** run `installVouchers` once in the Apps Script editor (approves Stripe access,
  installs the hourly `syncStripe`). Then `npm run script:deploy`.
- [ ] One real $50 purchase and refund on the live link; check the email, PDF, Vouchers tab,
  booking with the code, cancel, and the Refunded mark.
- [ ] Push the site (links switch from Wave to Stripe; already changed in `club-facts.yaml`).

## What to build

### Stripe objects

| Object | Settings |
| --- | --- |
| Product "Discovery Flight" | One-time price **$50 CAD**. |
| Payment Link: single | Quantity adjustable 1 to 10. Collect email (always). Optional custom fields: "Who is this flight for?" (text) and "Gift message" (text, short). After payment: redirect to `https://www.pagsc.ca/discovery-flight/paid/?session_id={CHECKOUT_SESSION_ID}`. |
| Product "Discovery Flight, group rate" | One-time price **$40 CAD** each. |
| Payment Link: group | Quantity adjustable, **minimum 4**. Same email, custom fields and redirect. |

Prices and the group minimum live in `content/club-facts.yaml` (`discovery_flight.price`,
`group_price_each`, `group_minimum`); keep Stripe in step. Put the two Payment Link URLs in
`content/club-facts.yaml` under `links` in place of the Wave ones (`discovery_flight_payment`,
`discovery_flight_group_payment`). `src/scripts/track.ts` tells single from group by the group
link's ID, so update it too.

### Sandbox objects (test mode, created 3 October 2026)

| Object | ID | URL |
| --- | --- | --- |
| Product "Discovery Flight" | `prod_VNTFOaNuWjKA0r`, price `price_1UMiItABB6Va3lZYpNOSgTZZ` ($50 CAD) | |
| Product "Discovery Flight, group rate" | `prod_VNTFLg4ypipEnk`, price `price_1UMiItABB6Va3lZYoardNG89` ($40 CAD) | |
| Payment Link: single (qty 1 to 10) | `plink_1UMiJ6ABB6Va3lZY1ua5U0vF` | https://buy.stripe.com/test_28E6oGchncSf2AO3cYcEw00 |
| Payment Link: group (qty 4 to 99) | `plink_1UMiJ7ABB6Va3lZYQknC0gVn` | https://buy.stripe.com/test_00w9ASa9ff0n5N000McEw01 |

Both links collect name and email, have optional custom fields `recipient` and `giftmessage`,
carry `metadata.pagsc_type` (`single` / `group`, copied to each Checkout Session so the script
can tell them apart), and redirect to `/discovery-flight/paid/?session_id={CHECKOUT_SESSION_ID}`.
Test card: 4242 4242 4242 4242, any future date, any CVC. The site still uses the Wave links.

### Live objects (created 4 October 2026, account `acct_1UMhKXAmFx3WHRxV`)

| Object | ID | URL |
| --- | --- | --- |
| Product "Discovery Flight" | `prod_VNTcrQjXNLASP5`, price `price_1UMifaAmFx3WHRxVpZU81K68` ($50 CAD) | |
| Product "Discovery Flight, group rate" | `prod_VNTcNg7KGMGH7U`, price `price_1UMifaAmFx3WHRxViTj9mmiB` ($40 CAD) | |
| Payment Link: single (qty 1 to 10) | `plink_1UMifqAmFx3WHRxVPsSflat9` | https://buy.stripe.com/28EaEW5PZ0QQ6hY55KbV600 |
| Payment Link: group (qty 4 to 99) | `plink_1UMifqAmFx3WHRxVdN7jUVzS` | https://buy.stripe.com/7sY7sKdirdDC5dU9m0bV601 |

Same settings as the sandbox links. `src/scripts/track.ts` tells the group link by its URL.

### Vouchers (Apps Script, new `Vouchers.gs`)

- **Confirming payment, no webhooks.** Apps Script web apps cannot read request headers, so
  Stripe webhook signatures cannot be verified there. Instead:
  1. The `/discovery-flight/paid/` page sends `session_id` to the script, which fetches the
     Checkout Session from Stripe with `STRIPE_KEY` (`UrlFetchApp`), checks `payment_status = paid`,
     reads email, quantity (line items), product and custom fields, and issues vouchers.
  2. An hourly job (add to `runReminders` or its own trigger) lists recent completed Checkout
     Sessions and issues vouchers for any not yet issued (buyer closed the tab).
  Each session issues vouchers once (record the session ID).
- **Vouchers tab** in the requests sheet: Code, Session ID, Issued, Buyer name, Buyer email,
  For (recipient), Message, Type (single/group/manual), Status (Issued / Booked / Flown /
  Refunded), Booking token, Booked date, Flown date, Notes.
- **Codes:** `PAGSC-XXXX-XXXX`, letters and digits without look-alikes (no 0/O, 1/I/L). One per flight.
- **Certificate PDF**, one page per voucher, in the site's style (see `apps-script/Emails.gs`
  colours and `docs/03-design.md`): "Discovery Flight", the $50 value, recipient and message if
  given (otherwise lines to write on), the code, a QR code linking to
  `https://www.pagsc.ca/discovery-flight/?code=CODE#request`, "Never expires", how to book,
  club contacts. Build HTML and convert with `Utilities.newBlob(html, 'text/html').getAs('application/pdf')`;
  generate the QR in the script (a small pure-JS QR encoder), not from an outside service.
  Email it to the buyer (`MailApp` with attachment) and show "Book your flying day" on the paid page.
- **Redemption:** the booking calendar (`src/components/BookingCalendar.astro`) reads `?code=`.
  When payment is "Paid online" or "Gift", ask for the code. `bookingPost` in
  `apps-script/Booking.gs` checks the code is Issued, marks it Booked with the booking token;
  `cancelBooking` returns it to Issued. A used or unknown code is refused with a clear message.
  "Pay at the field" bookings need no code.
- **Flown:** set Status to Flown in the sheet; optionally a "mark flown" link for instructors.
- **Refunds:** done in the Stripe dashboard; the hourly job marks those vouchers Refunded (needs
  refund read access) or the club marks them by hand.
- **Manual issue:** a sheet menu item "Issue voucher" (name, email, recipient, quantity) for cash
  and e-transfer gift purchases, producing the same PDF.
- **Policy (decided):** prepaid and gift flights never expire, rebook at no charge, refund on request.

### Site changes when Stripe goes live

- Swap the two links in `club-facts.yaml`; the buttons read from there.
- Rework `/discovery-flight/paid/` to show the certificate(s) for `session_id` and the calendar.
- Questions and the gift section: mention the emailed certificate.
- Update `docs/06-open-questions.md` Q18 (Wave redirect no longer needed).

## How this project works (essentials)

- **Two Node versions on this Mac.** Astro needs Node 22.12+: prefix with `PATH=/opt/homebrew/bin:$PATH`.
  clasp only runs on the old Node 22.11: `/usr/local/bin/node /usr/local/bin/clasp …`.
- Local builds: `SKIP_SCHEDULE=1 npm run build` (don't fetch the live schedule from this machine).
  `npm test` runs the schedule and booking tests. Push to `main` deploys the site.
- **Apps Script** project "PAGSC flight requests" (club account), linked in `apps-script/.clasp.json`.
  Deploy with `npm run script:deploy` (tests, push, update the live deployment so the `/exec` URL in
  `src/config.ts` never changes). Currently version 6. Files: `Code.gs` (forms), `Booking.gs`
  (calendar), `Emails.gs` (email templates), `Reminders.gs` (hourly reminders; Ryan must run
  `installReminders` once in the editor if not done). Script Properties: `SHEET_ID`, `CLUB_EMAIL`,
  `SITE_ORIGINS`. Add `STRIPE_KEY`.
- The club Gmail (`pa.gliding.soaring.club@gmail.com`) is signed in in the Claude browser pane.
  The Gmail MCP connector in the desktop app is a different (work) account; don't use it for club mail.
- Do not change DNS yourself (Cloudflare); Ryan makes DNS changes.
- One source of truth for facts: `content/club-facts.yaml`. Voice and rules: `CLAUDE.md`, `docs/01-strategy.md`.

## Also outstanding (not Stripe)

- Wave security: the club's Wave account has had "New sign-in detected" warnings, including one
  from Pogwizdów, Poland on 4 April 2026. Ryan to check, change the password and turn on 2-step.
- Ryan to run `installReminders` and optionally `sendSampleEmails` in the Apps Script editor.
- Open questions in `docs/06-open-questions.md`: Q5 photo permissions, Q8/Q20 stories, Q15
  wording approval, Q17 bursary amount ($499 vs $500 and the club match), Q18 follow-up owner.
