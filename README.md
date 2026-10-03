# pagsc-website

The rebuild of [pagsc.ca](https://www.pagsc.ca) for the Prince Albert Gliding and Soaring Club: a small static site, hosted free on GitHub Pages, built to turn visitors into first flights and first flights into members.

## Where things are

| Path | What it holds |
| --- | --- |
| `CLAUDE.md` | Working rules for Claude Code |
| `docs/01-strategy.md` | Goal, funnel, audiences, voice, measurement |
| `docs/02-sitemap-and-pages.md` | Navigation and a section-by-section spec for every page |
| `docs/03-design.md` | Colours, type, components, imagery |
| `docs/04-hosting-and-dns.md` | GitHub Pages setup, custom domain, cutover checklist |
| `docs/05-build-plan.md` | Phased tasks with acceptance checks |
| `docs/06-open-questions.md` | Decisions and assets still needed |
| `content/club-facts.yaml` | Every price, contact, link and figure, in one place |
| `content/pages/` | Page copy |
| `reference/current-site-audit.md` | What the current site does, and its URLs for redirects |
| `reference/welcome-pack/` | Source of the nine-page welcome pack: the look and most of the copy |

## Working on the site

Needs Node 22.12 or later.

```
npm install
npm run dev        # http://localhost:4321
npm run build      # fetch the schedule, type-check, build to dist/, check links
npm run preview    # serve dist/
npm test           # schedule parser tests
```

- Change a price, contact or figure in `content/club-facts.yaml` only. The build fails if a key is missing or misspelled, or if figures that depend on each other disagree.
- `src/config.ts` holds the form endpoint.
- The welcome pack is `public/welcome-pack.pdf` (served at `/welcome-pack.pdf`). Replace the file to update it.
- `SKIP_SCHEDULE=1 npm run build` builds without fetching the Flying Schedule.
- `npm run og` regenerates `public/og.png` from `scripts/og/og.html` (needs Google Chrome).

| Path | What it holds |
| --- | --- |
| `src/pages/` | One file per page |
| `src/components/` | Header, footer, buttons, tiles, steps, cards, drawings, the form |
| `src/lib/facts.ts` | Loads and checks `club-facts.yaml`; formatting helpers |
| `src/lib/faq.ts` | Questions and answers, bound to the facts |
| `scripts/` | Schedule fetch (build time), link check, OG image source |
| `apps-script/` | The flight request endpoint, with deploy notes |
| `.github/workflows/deploy.yml` | Build and deploy to GitHub Pages; scheduled refresh |

## Status

- **Live at https://www.pagsc.ca** since 3 October 2026. DNS is on Cloudflare (club account; records in `docs/cloudflare-pagsc.ca.zone`), mail to any @pagsc.ca address is forwarded to the club Gmail by Cloudflare Email Routing, and the site is served by GitHub Pages with HTTPS enforced.

- Phases 0 and 1: done. Every page built, Lighthouse mobile 99 to 100 in all four categories.
- Phase 2: endpoint deployed and wired. Welcome pack published for students, with an emailed-on-request form on Learn to fly.
- Phase 3: "Next flying days", redirects, sitemap, robots, structured data and OG image done. Analytics waits on Q10. Check "Next flying days" against the live sheet after the first deploy.
- Open questions: see `docs/06-open-questions.md`
