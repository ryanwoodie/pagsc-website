# PAGSC website rebuild

A new public website for the Prince Albert Gliding and Soaring Club (PAGSC), replacing the WordPress site at pagsc.ca. Its job is to turn a curious visitor into a booked first flight, and a first flight into a club member.

Ryan manages the site and is the only person who decides content and direction. The club is a small volunteer non-profit.

## Read these first

1. `docs/01-strategy.md`: goal, funnel, audiences, principles
2. `docs/02-sitemap-and-pages.md`: every page, its sections and its one action
3. `docs/03-design.md`: visual direction and components
4. `docs/04-hosting-and-dns.md`: GitHub Pages deployment and the domain cutover
5. `docs/05-build-plan.md`: phases, tasks and acceptance checks. Work through it in order.
6. `docs/06-open-questions.md`: decisions still owed by Ryan. Do not guess these.

`content/` holds the facts and the page copy. `reference/` holds the current-site audit and the welcome pack the copy and look are drawn from.

## Stack

- **Astro**, static output, no client-side framework. Plain CSS with custom properties. JavaScript only where a feature needs it.
- **GitHub Pages**, deployed by a GitHub Actions workflow on push to `main`.
- **Node 22**. Use `npm`.
- No CMS, no database, no server code in this repo.

Commands once scaffolded: `npm install`, `npm run dev`, `npm run build`, `npm run preview`.

## Rules

- **One source of truth for facts.** Prices, contacts, links, ages, limits and glider figures live in `content/club-facts.yaml`. Pages read from it. Never hard-code a price or a phone number in a page.
- **Copy comes from `content/pages/`.** Use it as written. The copy quotes figures in prose so it reads naturally; when building, bind each figure to its value in `club-facts.yaml`. Lines in square brackets are buttons or links, and short unpunctuated notes under a heading (such as the form field list) describe what goes there. If copy is missing, add it to `docs/06-open-questions.md` and leave a visible `[NEEDED: …]` marker on the page in development; never invent facts, numbers, quotes or testimonials.
- **No meta-commentary in anything a visitor sees.** No notes about how the page was made, no rationale, no "simplified" or "placeholder" caveats, no reassurance lists about what the visitor does not have to do ("nothing to print", "no form to fill"). State what is true and what to do next.
- **Voice** is in `docs/01-strategy.md` under "Voice". Follow it.
- **This repository is public.** No secrets, no member names or personal details, no copies of the flying schedule's contents.
- **One primary action per page**, as listed in `docs/02-sitemap-and-pages.md`.
- **Phone first.** Design and check every page at 375px wide before desktop.
- **Real photos only.** No stock imagery. Where a photo is not yet supplied, use the drawn glider motif from the welcome pack, not a stock placeholder.
- **Do not touch DNS, the live WordPress site or the CanSpace hosting.** The cutover in `docs/04-hosting-and-dns.md` is Ryan's to carry out.
- Commit in small steps. Do not push or open pull requests unless Ryan asks.

## Checks before calling a phase done

- `npm run build` succeeds with no warnings about broken links.
- Every page has one `<h1>`, a title, a meta description and its primary action above the fold on a phone.
- Lighthouse on the built site: performance, accessibility, best practices and SEO each 95 or higher on mobile.
- Every fact on the page matches `content/club-facts.yaml`.
