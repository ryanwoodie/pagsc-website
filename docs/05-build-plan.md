# Build plan

Work through the phases in order. Each ends with checks; do not start the next phase until they pass. Anything blocked on `06-open-questions.md` is built with its `[NEEDED: …]` marker and listed at the end of the phase.

## Phase 0: Foundation

1. `git init`, default branch `main`, a `.gitignore` for Node and Astro.
2. Scaffold Astro (static output, TypeScript strict, no UI framework). Node 22.
3. Add `content/club-facts.yaml` as a typed data source: a loader with a schema so a missing or misspelled key fails the build.
4. Design tokens as CSS custom properties, self-hosted Barlow and Barlow Condensed, base styles, per `03-design.md`.
5. Base layout: header with navigation and the button, footer, skip link, SEO head (title, description, canonical, Open Graph).
6. Shared components: button, fact tile, numbered step, path card, price table, callout, small-caps label, section.
7. GitHub Actions workflow: build and deploy to Pages on push to `main`. Use a `base` path for the `github.io` stage, set from one config value.
8. A 404 page.

**Checks:** `npm run build` passes. A placeholder home page renders with the header, footer and tokens at 375px and 1280px. The workflow file is valid (do not push; Ryan creates the remote).

## Phase 1: Pages

Build each page from `02-sitemap-and-pages.md` with copy from `content/pages/`:

1. Home (without "Next flying days" and without the form)
2. Discovery Flight (form markup only, not yet wired)
3. Learn to fly
4. Youth and cadets
5. Power pilots
6. Why gliding, including the ladder
7. Costs
8. Find us, with an embedded map that loads only on interaction or as a static image linking to the map
9. The club and the fleet, including the three glider outlines
10. Questions
11. Members, including the drawn map of the schedule sheet from the welcome pack

**Checks:** every page has one `<h1>`, a unique title and description, and its primary action visible on the first screen at 375px. No fact appears that is not in `club-facts.yaml`. Internal links all resolve. Lighthouse mobile 95 or higher in all four categories.

## Phase 2: Requests and payment

1. Write the Google Apps Script endpoint in `apps-script/`: validate fields, reject honeypot hits, append to a "Guest requests" sheet, email the club address, redirect to the "requested" page. Include a short deploy note for Ryan.
2. Wire the Discovery Flight form to the endpoint URL from one config value. It must submit without JavaScript.
3. Build `/discovery-flight/requested/`: who replies and when, how to pay, the welcome pack link.
4. Add the payment link (from `club-facts.yaml`) to the "requested" page and to the gift section.
5. Add the welcome pack PDF to `public/` once Ryan exports it.

**Checks:** a test submission appears in the sheet and in the club inbox, and lands on the "requested" page. A honeypot submission is dropped. With the endpoint unreachable, the visitor sees a plain message with the club's email and phone.

## Phase 3: Alive and findable

1. "Next flying days": a build-time script that fetches the schedule as CSV, extracts date, status and whether an instructor is signed up, and writes a small JSON file the home page reads. Fail soft.
2. Scheduled workflow run to refresh it (every three hours, April to October; daily otherwise).
3. Redirect pages for every old URL.
4. `sitemap.xml`, `robots.txt`, structured data for the organisation and its location, Open Graph image.
5. Analytics, once chosen (Q10), with the `flight_request_submitted` event.
6. Accessibility pass with a screen reader and keyboard only.

**Checks:** the section shows the right dates against the live sheet and disappears cleanly when the fetch is forced to fail. Every old URL lands on its new page. Structured data validates.

## Phase 4: Cutover

Ryan's steps, in `04-hosting-and-dns.md`. Before he starts:

1. Remove the `base` path and add the `CNAME` file.
2. Confirm no `[NEEDED: …]` markers remain in the built output (`grep -r "NEEDED" dist/` returns nothing).
3. Final read of every page against `club-facts.yaml`.

## After launch

- Stories: a short dated post for each first solo and licence, as Markdown in `content/stories/`. Not needed for launch.
- Review the season's numbers: requests, flights flown, new members.
