# Sitemap and page specs

## Navigation

Header, every page: logo/name · **Fly with us** · **Learn to fly** · **Why gliding** · **Costs** · **Find us** · button **Book a Discovery Flight**.

On a phone the button stays visible in the header; the five links collapse into a menu.

Footer, every page: the button again; email, phone, Facebook; **Members**; affiliations line; year.

## Pages

| Path | Page | Primary action | Copy file |
| --- | --- | --- | --- |
| `/` | Home | Book a Discovery Flight | `home.md` |
| `/discovery-flight/` | Discovery Flight | Submit the request form | `discovery-flight.md` |
| `/discovery-flight/requested/` | Request received | Read what happens next | `discovery-flight.md` (section "After you request") |
| `/learn-to-fly/` | Learn to fly | Book a first lesson (same form) | `learn-to-fly.md` |
| `/learn-to-fly/youth-and-cadets/` | Youth and cadets | Book a first lesson | `youth-and-cadets.md` |
| `/learn-to-fly/power-pilots/` | Power pilots | Book a first lesson | `power-pilots.md` |
| `/why-gliding/` | Why gliding | Book a Discovery Flight | `why-gliding.md` |
| `/costs/` | Costs | Book a Discovery Flight | `costs.md` |
| `/find-us/` | Find us | Book a Discovery Flight | `find-us.md` |
| `/the-club/` | The club and the fleet | Book a Discovery Flight | `the-club.md` |
| `/faq/` | Questions | Book a Discovery Flight | `faq.md` |
| `/members/` | Members | Open the Flying Schedule | `members.md` |
| `/404` | Not found | Go home | none |

`/the-club/`, `/faq/` and the two audience pages are reached from other pages and the footer, not the header.

## Home

1. **Hero.** Real club photo or short muted video. Headline, one-line description, price, the button, and a text link "or learn to fly".
2. **Three facts.** First flight price · free instruction · drive times.
3. **How it works.** Three steps: request a date, we confirm, come out and fly.
4. **Choose your path.** Four cards: Try a flight · Learn to fly · Youth and cadets · Power pilots.
5. **Next flying days.** The next few dates from the schedule with their status (see "Next flying days" below). Hidden if the data cannot be read.
6. **Why gliding.** Headline "A sport you never finish", the sailing line, link to the page.
7. **What it costs.** The "$10 lesson flight" line and three or four prices, link to Costs.
8. **Proof.** Real photos; 632 km out of PAGSC; founded 1986; affiliations. Guest and student quotes when supplied with permission (Q8).
9. **Questions.** Four from the FAQ, link to the rest.
10. **Find us.** Drive times, map, link.
11. **Closing action.** The button.

## Discovery Flight

The main conversion page. Top to bottom:

1. Headline, price, the button (jumps to the form).
2. What happens: winch launch to about 2,000 feet, 8 to 30 minutes, an instructor or club pilot with you throughout.
3. At a glance: price and group price · when flights run · where · who can fly (weight limit, reaching the controls).
4. How it works, three steps.
5. Your first day: what to bring, how the day runs.
6. Weather: flights depend on it; a cancelled day is rebooked at no charge.
7. **Request form.**
8. Give a flight as a gift: the payment link and how the recipient books (Q3).
9. Questions most asked before a first flight.

### Request form

Fields: name · email · phone · number of flyers · preferred dates (free text, with a hint that weekends are the main flying days) · a checkbox confirming each flyer is under the weight limit · optional message. One hidden honeypot field.

On submit: go to `/discovery-flight/requested/`, which states who will reply and how soon (Q2), how to pay (online with the payment link, or by e-transfer on the day), and links the welcome pack.

Backend: see "Form handling" below.

## Learn to fly

1. Headline and the three ages: any age to start, solo at 14, licence at 16.
2. What it costs: free instruction, about $10 a lesson flight, membership prices, and a worked estimate to licence (Q6).
3. The five steps to a Glider Pilot Licence.
4. Who can learn.
5. Come regularly if you can.
6. Two cards to the audience pages: Youth and cadets · Power pilots.
7. Action: Book a first lesson. Secondary: the membership form.

## Youth and cadets

For parents as much as teenagers. Bursary amount first, then membership price, supervision (all flying before solo is with a certified instructor as pilot-in-command), ages, cadet conversion, carpooling, how to apply.

## Power pilots

The requirements table (from scratch against PPL(A) credit), what you will actually be learning, glider hours that count back toward PPL(A) and CPL(A).

## Why gliding

The copy in `why-gliding.md`: the sailing comparison, the game, racing, the ladder from first solo to Diamond, the figures, a sport for decades, better pilots.

The ladder is a drawn staircase of six steps, as on page 5 of the welcome pack.

## Costs

One table, read from `club-facts.yaml`. The "$10" line above it. Notes below: what membership includes, half price after August 1, ages as of January 1, how to pay.

## Find us

Drive times, the airport name, an embedded map, carpooling, what to do on arrival, and the season and usual flying hours.

## The club and the fleet

Short: founded 1986, non-profit, affiliations, a club that runs on its members pitching in. Then the three gliders with their figures and outlines, as on page 8 of the welcome pack. Instructor photos and names when supplied (Q5).

## Questions

From `faq.md`. Each question is a heading so it can be linked and found by search.

## Members

Not a login. A plain page for people who already fly here:

- The Flying Schedule link and the walkthrough of the sheet (pages 2 and 3 of the welcome pack), including the phone note.
- The membership form and how to pay dues.
- Weather links.
- The club's group chat, if it is to be public (Q4).

## Next flying days

Built at deploy time, not in the browser.

- A scheduled GitHub Actions run (every few hours in season) fetches the public schedule as CSV and rebuilds the site.
- Read only: the date row, the Status / Comments row, and whether the instructors block has any entry under a date.
- Publish only: date, status text, and "instructor signed up" yes or no. Never publish names from the sheet.
- If the fetch or the parse fails, build without the section. A failed fetch must never fail the deploy.

The sheet's layout is described in `reference/current-site-audit.md`.

## Form handling

GitHub Pages serves static files only, so the form posts to a small endpoint outside this repo. Preferred: a Google Apps Script web app owned by the club's Google account that appends the request to a "Guest requests" sheet and emails the club address. It is free and keeps requests beside the schedule the club already uses.

- The Apps Script source lives in `apps-script/` in this repo for reference; Ryan deploys it and supplies the endpoint URL.
- The form must also work without JavaScript: a normal POST with a redirect to the "requested" page.
- If the endpoint is not ready when the form is built, wire the form to a `mailto:` fallback and mark the task open; do not launch on the fallback.

## Old URLs

Every path on the current site gets a redirect page to its new home. The list is in `reference/current-site-audit.md`. Use Astro's `redirects` config, which emits static redirect pages that work on GitHub Pages.
