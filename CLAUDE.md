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
7. `docs/07-stripe-handoff.md`: where the Stripe purchase and gift-certificate work stands, and how the site, booking script and deploys work. Read it before payment or voucher work.

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
- **This repository is public.** No secrets, and no copies of the Flying Schedule's contents (its sign-up names are never published).
- **Names.** Names that appear in the club's own public social media posts (Instagram, Facebook) may be used in news posts as they appear there. News is drafted from what is already public on the club's socials. Do not add other personal details: no phone numbers, email addresses or home addresses of members or guests.
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

## Club news posts

News posts are Markdown files in `content/news/`. A separate agent publishes them by pushing straight to `main` with a deploy key; review happens before the push. **Every push to `main` deploys the live site through the existing GitHub Actions workflow**, so each file must be complete and valid when it lands. If a post fails validation, the build fails and nothing new publishes until it is fixed, including other changes.

**File name:** `content/news/YYYY-MM-DD-short-slug.md`
- The date is the post's date. The slug is lowercase words joined by hyphens (`a-z`, `0-9`, `-`), at most about 6 words, e.g. `2026-10-12-first-solo-for-sam.md`.
- The file name (without `.md`) becomes the address: `https://www.pagsc.ca/news/2026-10-12-first-solo-for-sam/`. Never rename a published post.
- Files not matching `YYYY-MM-DD-*.md` are ignored.

**Frontmatter** (YAML between `---` lines, these fields only; unknown fields fail the build):

| Field | Required | Type and rules |
| --- | --- | --- |
| `title` | yes | Text, 3 to 90 characters. Plain words, no trailing period. |
| `date` | yes | `YYYY-MM-DD`, unquoted, e.g. `date: 2026-10-12`. The date of the event or original post. |
| `summary` | yes | Text, 20 to 200 characters. One or two sentences; used in lists and as the page description. |
| `image` | no | Relative path to a photo in `content/news/images/`, written from the post file: `./images/2026-10-12-first-solo-for-sam.jpg`. |
| `image_alt` | if `image` | Text describing the photo for screen readers, at least 5 characters. |
| `source` | no | Full `https://` URL of the original Instagram or Facebook post. Shown as "Originally posted on Instagram". |
| `draft` | no | `true` or `false` (default `false`). `true` keeps the post off the site. |

Quote a text value with double quotes if it contains a colon, `#`, or starts with a special character.

**Body:** Markdown below the frontmatter. Plain paragraphs; `##` subheadings if needed (never `#`, the title is the page heading); links as `[text](https://…)`. No raw HTML, no images in the body (use `image`). Write in the site's voice (`docs/01-strategy.md`, Voice): plain, concrete, "the club" or "we". Facts only from the social post or `content/club-facts.yaml`; no invented quotes or numbers.

**Photos:** `content/news/images/`, named like the post (`2026-10-12-first-solo-for-sam.jpg`; add `-2`, `-3` for extras). JPEG, PNG or WebP, at least 1200 px wide, under 5 MB, with location (GPS) data removed. The site resizes and converts them. Only photos from the club's own posts.

**Example** (`content/news/2026-10-03-new-website.md`):

```markdown
---
title: A new website, with online booking
date: 2026-10-03
summary: Book a Discovery Flight online, pick your day on the booking calendar, and see the next flying days straight from the club's schedule.
image: ./images/2026-10-03-new-website.jpg
image_alt: A smiling student stands beside the club's two-seat glider on the runway under a sky full of cumulus clouds
source: https://www.instagram.com/p/EXAMPLE/
---

The club has a new home at pagsc.ca. …
```

**Before pushing:** run `npm ci` then `SKIP_SCHEDULE=1 npm run build` (Node 22.12 or later) and push only if it succeeds. Commit only the post and its photos, with a message like `News: First solo for Sam`. Posts appear on `/news/`, and the latest three on the home page.

