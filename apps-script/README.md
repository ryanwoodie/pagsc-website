# Flight request endpoint (Google Apps Script)

The website's forms post to this script. Discovery Flight requests go to a "Guest requests"
tab and are emailed to the club. Welcome pack requests from Learn to fly get an email with a
link to the pack, go to a "Student leads" tab, and the club gets a short note. It runs under the club's Google account; nothing
about it is secret except the sheet ID, which is kept in Script Properties, not here.

## Deploy (Ryan, once)

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
