# Flight request endpoint (Google Apps Script)

The website's forms post to this script. Discovery Flight requests go to a "Guest requests"
tab and are emailed to the club. Welcome pack requests from Learn to fly get an email with a
link to the pack, go to a "Student leads" tab, and the club gets a short note. It runs under the club's Google account; nothing
about it is secret except the sheet ID, which is kept in Script Properties, not here.

## Deploying with clasp (the usual way)

The script is linked to this folder with clasp (Google's Apps Script command line), signed in as the
club account. `apps-script/.clasp.json` holds the script ID; only `Code.gs`, `Booking.gs` and
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
a day, a start time (11:00 to 4:00, half an hour per person, up to 4 people) and book. Weekends are
pencilled in straight away; weekdays are requests a member confirms. Up to 6 guest half-hours a day.

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
- To change one day's guest limit, add a **Guest caps** tab with `Date` (yyyy-mm-dd) and `Cap` columns.
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
Run. Approve the permission to run on a schedule. It runs `runReminders` every hour. To preview every
email, run `sendSampleEmails`: it sends 5 samples to the club address and books nothing.

The slot settings (11:00, 16:00, 30 minutes, cap 6, groups of 4, 28 days) are at the top of
`Booking.gs` and in `content/club-facts.yaml` under `booking`. Change both together; `npm test` checks
they match.

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
