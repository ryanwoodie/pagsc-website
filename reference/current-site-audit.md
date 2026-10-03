# Current site audit

Reviewed 2 October 2026. The current site is WordPress on CanSpace cPanel hosting, with a 2018-era slider plugin on the home page.

## What it does today

- **Leads with the organisation.** The home page opens on the founding year, affiliations and what the club "provides its members". The price, the booking steps and "no experience needed" are not on it.
- **Two conflicting booking paths.** The home page's "Book a Flight" button opens the raw Google Sheet. "Come fly with us" says to reserve through the contact page and never states the price.
- **The best offers are buried or missing.** Free instruction appears only on the fees page. The $10 lesson flight and the $1,000 youth bursary are not on the site.
- **It looks dormant.** Most pages were last edited in 2018. The hero slider is stock photography. The gallery has four uncaptioned photos and two embedded videos.
- **Errors.** The fees and contact pages name different treasurers, an email address is misspelled on the fees page, and the public menu includes a "Members section" that is only a webmail link.

## Pages, last edited, and where each goes

| Old path | Last edited | Redirect to |
| --- | --- | --- |
| `/` | May 2023 | `/` |
| `/come-fly-with-us/` | Sep 2018 | `/discovery-flight/` |
| `/learn-to-soar-gliding/` | Sep 2018 | `/learn-to-fly/` |
| `/about-our-club/` | Sep 2018 | `/the-club/` |
| `/pictures-videos-gallery/` | Sep 2018 | `/the-club/` |
| `/members-fees/` | Apr 2026 | `/costs/` |
| `/useful-link/` | May 2023 | `/members/` |
| `/contact-us/` | not dated | `/find-us/` |
| `/members-section/` | Sep 2018 | `/members/` |

## Worth carrying over

- The fees and membership categories on `/members-fees/` (already in `content/club-facts.yaml`).
- The two weather links on `/useful-link/` ("Birch Hills weather", "CYPA forecast"). Copy their URLs from the live page for the Members page.
- The four real club photos in the gallery, if no better ones are supplied.
- The two embedded videos on the home page, as candidates for the club page. Check they still play and that the club has the right to use them.

## Not carried over

- Stock hero images.
- Personal phone numbers, the mailing address, and any email address other than the one in `club-facts.yaml`.
- The member count, the physics explainer on the old training page and its badge descriptions.
- The webmail link.

## The Flying Schedule sheet

Public Google Sheet, first tab. One column per day, running left to right from today for about a month.

| Row | First column | Day columns |
| --- | --- | --- |
| 1 | (blank) | The date, as text, for example `Sat Oct 3,2026` |
| 2 | A link label | Weather forecast text, filled in about a week ahead |
| 3 | `Status/Comments:` | Free text set by the club: on, delayed, cancelled, arrival time |
| 4 | Intro flights heading | `Intro Fam Flight Sign-up Below for <date>:` |
| 5 onward | Directions and notes | Guest sign-ups under each date |
| later | `Students :…` | `Student/Pilots SIgn-up Below:` then member sign-ups |
| later | `Instructors:` | `Instructors Sign-up Below:` then instructor sign-ups |

Row positions below row 4 are not fixed; find blocks by their label text, not by row number.

For "Next flying days", read only row 1, row 3, and whether any cell under the instructors label is filled for that date. Names in the sheet are members' and guests' and must never be published or stored in this repository.
