# Flight request endpoint (Google Apps Script)

The website's forms post to this script. Discovery Flight requests go to a "Guest requests"
tab and are emailed to the club. Welcome pack requests from Learn to fly get an email with a
link to the pack, go to a "Student leads" tab, and the club gets a short note. It runs under the club's Google account; nothing
about it is secret except the sheet ID, which is kept in Script Properties, not here.

## Deploying with clasp (the usual way)

The script is linked to this folder with clasp (Google's Apps Script command line), signed in as the
club account. `apps-script/.clasp.json` holds the script ID; the `.gs` files listed in `.claspignore` and
`appsscript.json` are pushed.

```
npm run script:deploy
```

runs the tests, pushes the code and updates the live web app deployment, so the `/exec` URL in
`src/config.ts` never changes. To roll back, in the Apps Script editor use Deploy > Manage deployments >
Edit and pick an earlier version.

The installed clasp (3.0.3) does not run on Node 25; if `clasp` fails with a `SlowBuffer` error, run it
with Node 22 (`/usr/local/bin/node /usr/local/bin/clasp …`) or update it: `npm install -g @google/clasp`.

## Deploy by hand (first time, or without clasp)

1. Signed in as the club's Google account, create a new Google Sheet for requests
   (or use an existing club sheet that is not public). Copy its ID from the URL.
2. Go to <https://script.google.com>, **New project**, name it "PAGSC flight requests".
   Replace the contents of `Code.gs` with the file in this folder.
3. **Project Settings > Script Properties**, add:
   - `SHEET_ID`: the sheet ID from step 1
   - `CLUB_EMAIL`: the club email from `content/club-facts.yaml`
   - `SITE_ORIGINS`: `https://www.pagsc.ca,https://<account>.github.io` (no trailing slash)
4. **Deploy > New deployment > Web app**. Execute as: *Me*. Who has access: *Anyone*.
   Approve the permissions (Sheets and Gmail sending).
5. Copy the web app URL (ends in `/exec`) into `FORM_ENDPOINT` in `src/config.ts`, commit and push.

When you change `Code.gs` later, use **Deploy > Manage deployments > Edit > New version** so the
URL stays the same.

## The booking calendar (Booking.gs)

The Discovery Flight page shows a calendar of the next 4 weeks from the Flying Schedule. Guests pick
a day, a start time (11:00 to 4:30, half an hour per person, up to 4 people, finishing by 5:00) and book. Weekends are
pencilled in straight away; weekdays are requests a member confirms. Weekends share 8 guest flights across Saturday and Sunday; each day also has room for 12 half-hour slots, less 3 (1.5 hours) for each student on the Flying Schedule that day, so the first student has no effect and from the second students reduce guest spots (0 to 1 students: 8; 2: 6; 3: 3; 4 or more: 0). Weekdays: 12 slots less 3 per student.

To set it up (once):

1. In the Apps Script editor, add a second file: **+ (Add a file) > Script**, name it `Booking`, and
   paste `Booking.gs` into it. Replace `Code.gs` with the new version too.
2. The Flying Schedule's ID is built in; a `SCHEDULE_ID` Script Property overrides it. The club
   account needs edit access to that sheet.
3. **Project Settings > Time zone**: America/Regina.
4. **Deploy > Manage deployments > Edit > New version > Deploy.** Google asks to approve the new
   permissions (reading and editing the Flying Schedule); approve them as the club account.

What it does with the sheets:

- Bookings go to a **Bookings** tab in the requests sheet (name, email, phone, interest, payment).
  Set a row's Status to `Cancelled` to free the slot.
- Each booking is also written into that day's **Intro Fam Flight** block on the Flying Schedule as
  first name and time only, e.g. `Jane 11:30 (2) web` or `Request: Sam 13:00 web` for a weekday.
- Guests added by hand in a day's Intro Fam Flight block count too. Write a first name and a start time,
  with the number of people if more than one: `Jane 1:30 (2)` takes 1:30 and 2:00 off the website.
  Times without am/pm are read as flying hours (1:30 is 1:30 pm). A name with no time takes one spot
  that day without blocking a time; `(2)` or `+1` for more people. Leave the word `web` on the
  script's own entries: those are counted from the Bookings tab, and removing it counts them twice.
- To change a weekend's guest limit (or one weekday's), add a **Guest caps** tab with `Date` (yyyy-mm-dd) and `Cap` columns; for a weekend, a date on either day sets the shared limit.
- A day whose Status / Comments cell says it is cancelled is shown as "Not flying" and can't be booked.
- Guests get a confirmation email with a cancel link; cancelling frees the slot, clears the schedule
  cell and emails the club.

## Emails and reminders (Emails.gs, Reminders.gs)

Guest emails are HTML in the site's style, with times like "3:30 pm" and a "Change or cancel" button.

- **Confirmation** when they book (weekend: "You're pencilled in"; weekday: "request is in").
- **Reminders:** booked more than a week ahead, a reminder a week before; booked 4 to 7 days ahead,
  3 days before; everyone, the day before from 4 pm. Each shows the day's Status / Comments text,
  the forecast row and whether an instructor has signed up, and says so plainly if nothing is posted yet.
- **Status updates:** when a day's Status / Comments text changes, guests booked within the next
  week get an email (not after 3 pm on the day itself). If it says flying is off, the email offers
  "Cancel and rebook".
- The Bookings tab tracks which reminders went out ("Reminders sent") and the last status emailed.
- To stop emails for a booking (for example a weekday request the club declined), set its Status to
  `Cancelled`.

**One-time setup:** in the Apps Script editor, pick `installReminders` in the function menu and click
Run. Approve the permission to run on a schedule. It runs `runReminders` every 10 minutes (`RUN_MINUTES` in Reminders.gs). To preview every
email, run `sendSampleEmails`: it sends 5 samples to the club address and books nothing.

The slot settings (11:00 to 16:30 starts, 30 minutes, 3 slots per student, 8 per weekend, groups of 4, 28 days) are at the top of
`Booking.gs` and in `content/club-facts.yaml` under `booking`. Change both together; `npm test` checks
they match.

## Certificates for flights bought online (Vouchers.gs, Qr.gs)

Discovery Flights are sold on two Stripe Payment Links (single and group). After paying, Stripe sends the
buyer to `/discovery-flight/paid/?session_id=…`; that page asks this script for the certificates.

- The script fetches the Checkout Session from Stripe, checks it is paid, and issues one code per flight
  (`PAGSC-XXXX-XXXX`, no look-alike characters) into a **Vouchers** tab: Code, Session ID, Payment ID,
  Issued, Buyer name, Buyer email, For, Message, Type, Value, Status, Booking token, Booked date, Flown date, Notes.
- The buyer gets one email with a PDF, a page per flight: recipient and message (or lines to write on),
  the code and a QR code that opens the booking calendar with the code filled in. The club gets a note.
- Each Checkout Session issues certificates once. An hourly job, `syncStripe`, catches buyers who closed
  the tab, and marks flights **Refunded** when a refund is made in the Stripe dashboard (unused ones first;
  the club is emailed, and told if a refunded certificate was already booked).
- Booking with "I've paid online" or "It's a gift" asks for the code(s), one per person. A code must be
  **Issued** to be used; the booking marks it **Booked**, and cancelling returns it to **Issued**. Leaving the
  code blank is allowed (flights bought before Stripe, or by e-transfer); the club email says so.
- After the flight, set Status to **Flown** by hand.
- The certificate's banner (photo, title, club mark) is `public/certificate/hero.jpg` on the site; the PDF loads it
  from there. To preview the PDF, run `sendSampleCertificate` in the editor: it emails the club a filled-in and a blank page.
- **Manual certificates** (cash or e-transfer gifts): add a row with Type `manual`, Buyer name, Buyer email,
  and optionally For, Message and Value (default $50). Leave Code empty. Within the hour the code is filled in
  and the certificate emailed. One row per flight.

**Setup (once):** Script Property `STRIPE_KEY`, a Stripe restricted key with read access to Checkout Sessions,
Charges and Refunds. Then in the editor pick `installVouchers` and Run: Google asks to approve connecting to an
external service (Stripe); approve as the club account. It checks the key works and installs the hourly job.
Do this before deploying a version that includes Vouchers.gs, or the web app stops until it is approved.

## One flying day per weekend (Booking.gs, Reminders.gs)

The club usually flies one day each weekend. A weekend booking asks, required and with nothing
pre-selected: "If we only fly one day that weekend, could you come on <the other day> instead?"
"Yes" adds "(or Sun)" / "(or Sat)" to the schedule cell and "Yes" in the Bookings tab's
"Either weekend day" column.

When the regular check sees the booked day's Status / Comments marked cancelled (and only then;
two-day weekends are left alone), a "Yes" booking moves to the other day: same start time if free,
otherwise the nearest time that fits. The schedule cell moves, the row's Date, Start and "Moved from"
update, certificates follow, the club is told, and the guest gets "Flying moved to Sunday" with
"Yes, see you Sunday" (sets "Move confirmed" to Yes) and "Pick another day" (cancel and rebook).
Without a reply they stay pencilled in. If the other day is cancelled or full, the guest gets the
usual "flying is off" email instead. A booking moves at most once.

## Weekend standby list (Standby.gs)

**The trigger.** Only the words "Discovery flights available" in a day's Status / Comments row open
the day to the standby list and email the standby list. Other "on" wording ("Day is a go", "Confirmed") still
shows as flying is on in reminders and on the home page, but opens nothing. Add a number to limit
guests: "Discovery flights available: 4" allows 4 guest flights that day **in total, counting those
already booked** (the weekend's shared limit of 8 still applies). A cancellation in the same text
overrides it. See `guestOpening` in Booking.gs.

Weekend spots are held only for paid flights (a certificate code) until the club confirms the day.
On an unconfirmed weekend day, "I'll pay at the field" becomes "put me on the standby list": the
guest's details go to the **Standby** tab (Status `Waiting`), nothing is held, and they and the club
get an email. When the day's Status / Comments row says **"Discovery flights available"** (or
"Discovery flights open"), that day opens to pay-at-the-field bookings for anyone, and the regular check (every 10 minutes)
emails everyone waiting for it (or for that weekend, if they said either day works): "Flying is on
Saturday: spots are open", with a link to that day, first come, first served. Their row becomes
`Notified`; rows for past days become `Expired`. Weekdays and bookings made before this change are
unaffected.

**Any weekend we fly.** Anyone, paid or not, can join the general standby list with the form under
"Or wait for a good day" on the Discovery Flight page (`#standby`), on the paid page after buying, or
from the link in the certificate email. Those rows have Scope `Any` and no date. Every time a weekend
day is opened to the standby list with room for their group, they get an email listing the open days (one email per
day, never repeated; `Days notified` records which), and everyone on the list is emailed at once. If
they gave certificate codes, the links fill them in. They stay `Waiting` until:

- they book (any booking with the same email marks their waiting rows `Booked`);
- they use "Take me off the standby list", in every standby email (`?action=standby-off`, row `Removed`).

Nobody is removed for being quiet. `Emails sent` counts their flying-day emails; every 10th one
(`STANDBY.ASK_EVERY`) asks whether they would like to come off the list, with the link.

**Same day.** A day opened to the standby list on the morning itself can be booked that day, from start times at
least an hour away (`BOOKING.SAME_DAY_LEAD`), and the regular check emails the standby list about it.

Signing up for any weekend again replaces their earlier waiting rows (`Replaced`).

## Updating the deployed script

After changing `Code.gs`: paste the new version into the Apps Script editor, then
**Deploy > Manage deployments > Edit (pencil) > Version: New version > Deploy**. The `/exec` URL stays the same.

## Check it

- Submit the form on the site: a row appears in "Guest requests", the club inbox gets an email,
  and the browser lands on `/discovery-flight/requested/`.
- Request the welcome pack on Learn to fly: the email arrives with a working link, a row appears in
  "Student leads", the club gets a note, and the browser lands on `/learn-to-fly/welcome-pack-sent/`.
- A submission with the hidden `website` field filled is dropped without a row or email.
- With `FORM_ENDPOINT` pointing nowhere, the form shows the club's email and phone instead.
