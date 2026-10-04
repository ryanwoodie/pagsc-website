# Open questions

Decisions and assets needed from Ryan. Each notes what is assumed until it is answered and which phase it blocks.

| # | Question | Assumed for now | Blocks |
| --- | --- | --- | --- |
| Q1 | Is the priority new members or more paid first flights? | Answered 3 October 2026: revenue. The main button everywhere is "Buy a Discovery Flight" straight to the Wave checkout ($50 is an impulse price, and it matches gift buying); dates are booked after purchase. | Done |
| Q2 | Who replies to flight requests, and how soon can the club promise a reply? | Not stated on the page until answered. | Phase 2 |
| Q3 | Gift flights: after paying through the Wave link, what does the buyer receive, how does the recipient book, and does a gift flight expire? | Gift section shows the payment link and "email us to arrange the date". | Phase 2 |
| Q4 | Should the WhatsApp group invite be on the public site, or only sent after a request? An open invite on a public page can attract spam. | Answered 3 October 2026: the invite is in the welcome pack, which is public at `/welcome-pack.pdf` for students and sharing. It is not linked from the Discovery Flight pages and not stored in `club-facts.yaml`. | Done |
| Q5 | Photographs and video. See the shot list below. Supplied 2 October 2026: winch launch clip (home hero), guest in the front seat (Discovery Flight, home), student at the glider (Learn to fly), running the wing (The club, home). Added 3 October: glider in flight (Why gliding), student on the runway (Learn to fly), young student with a club member (Youth and cadets), cockpit view over the prairie (Discovery Flight). Confirm the people shown have agreed to appear. | Drawn glider motif where no photo is supplied. | Launch quality |
| Q6 | A typical number of flights and seasons from first lesson to solo and to licence, for an honest cost estimate. | Partly answered 3 October 2026: around 40 instructional flights to solo, 10 to 20 with previous aviation experience; the licence needs 20 solo flights. No dollar total shown yet. | Learn to fly |
| Q7 | The 7-hour figure: keep it, replace it with the club's longest duration, or drop it? | Shown as "aloft on a single flight out of PAGSC". | Why gliding |
| Q8 | Two or three short quotes from guests or students, with permission and first names. | No quotes shown. | Home proof section |
| Q9 | GitHub account or organisation for the repository, and is a public repository acceptable? | Public repository under Ryan's account. | Phase 0 deploy |
| Q10 | Analytics: which tool? Options with no cookie banner include Cloudflare Web Analytics and GoatCounter. | None until chosen. | Phase 3 |
| Q11 | Where is DNS for pagsc.ca managed, and are any pagsc.ca mailboxes still in use? | DNS at CanSpace; mail in use, so mail records are left alone. | Phase 4 |
| Q12 | Fleet figures differ between published sources. Are the figures in `club-facts.yaml` the ones the club wants shown? And who may fly the Ka 6E and Phoebus C? | Figures as listed; no statement about who may fly which glider. | The club and the fleet |
| Q13 | Is the Discovery Flight price on the Wave payment page $50, and does it offer the $40 group price? | Answered 4 October 2026: a separate Wave checkout for the group rate ($40 each, 4 or more), linked from Discovery Flight, Costs and the request-received page. | Done |
| Q14 | Instructor names and photos for The club page. | Section omitted. | The club and the fleet |
| Q16 | The club posts on Instagram (pa.gliding). Add it to the footer and `club-facts.yaml` beside Facebook? | Answered 3 October 2026: yes, in the footer and on Find us. | Done |
| Q17 | SAC's bursary page says the SAC Youth Bursary is $499 per applicant and that clubs are not required to match it. `club-facts.yaml` says $500 from SAC matched by $500 from the club ($1,000). What is the club's match, and should the site say $499? | $500 + $500 = $1,000 as before, with the SAC eligibility and availability note added. | Youth and cadets, Costs, Home |
| Q18 | Wave checkout: can it send buyers to `https://www.pagsc.ca/discovery-flight/paid/` after paying (a redirect or "thank you" link setting)? Does it offer a quantity? Who watches for Wave payments and emails buyers if they don't book a date, and do prepaid or gift flights expire or get refunded? | No redirect; buyers are told to book their date on the Discovery Flight page; groups book first. | Purchase flow |
| Q19 | For Learn to fly, from the instructors: what a student actually does on their first three visits (one or two observable skills each), and how long a visit to the field usually takes. | Not shown. The page says skills come one at a time and solo only when the instructor is satisfied. | Learn to fly |
| Q20 | A beginner's story (someone who started with no aviation experience), and a guest's account of their Discovery Flight, in their own words, with photo and permission. Also what keeps a long-time member coming back. | Not shown (see also Q8). | Learn to fly, Discovery Flight, Why gliding |
| Q21 | Compare costs with powered training? An outside school's published rates (e.g. a Saskatoon school's 2025 PPL rate sheet) would need checking and dating, and the site's voice avoids running powered flying down. | Not compared; "Within reach" on Why gliding states PAGSC's own prices only. | Why gliding |
| Q15 | Short lines written during the build where no copy was supplied: the 404 page ("Page not found. This address is not on the site."), the form's failure message ("Your request did not go through. Email us … or call … and we will book you in."), and the "Next flying days" labels ("Flying is on", "Delayed", "Cancelled", "Update posted", "No update posted yet", "Instructor signed up", "From the club's Flying Schedule, <time>. Flying depends on the weather."). Also: the "request received" page's "Before you come" line ("What to bring, how the day runs, and what happens if the weather turns."), the welcome pack section on Learn to fly ("Nine pages for new students: …", "Email me the welcome pack"), its sent page ("Check your email. The welcome pack is on its way. If it does not arrive in a few minutes, look in your spam folder."), and the email the script sends. Approve or replace. | As written. | Launch |

## Shot list (Q5)

Landscape, at least 2400px wide, taken at Birch Hills. People shown need to agree to appear.

1. ~~The K7 on a winch launch, from the side: the hero image~~ (clip supplied)
2. ~~A guest or student in the front seat, canopy open, smiling~~ (supplied)
3. ~~The view from the cockpit over the prairie~~ (supplied)
4. ~~Members running a wing or walking the glider out~~ (supplied)
5. The launch point with the winch and the field
6. Each glider on the ground: K7, Ka 6E, Phoebus C
7. A first-solo moment, if one exists
8. ~~A 20 to 40 second clip of a winch launch, steady, for the hero~~ (10 seconds supplied and in use)

## Also needed

- ~~The welcome pack exported as a PDF~~ (supplied 3 October; at `public/welcome-pack.pdf`). Its booking pages describe signing up on the Flying Schedule, which suits students rather than one-off guests. Replace the file when the pack changes.
- The Apps Script endpoint deployed under the club's Google account (Phase 2).
