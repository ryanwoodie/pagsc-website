# Design

The site continues the look of the welcome pack (`reference/welcome-pack/`): airfield signage. Navy, sky and windsock orange; condensed capitals; flat blocks; a drawn glider circling in a thermal. Open the pack's source files for exact spacing and proportions.

## Colour

| Token | Value | Use |
| --- | --- | --- |
| `--ink` | `#0E2233` | Text, rules, dark blocks |
| `--sky` | `#E1EEF7` | Hero band, pale panels |
| `--sky-line` | `#8FB9D8` | Dashed thermal circles |
| `--blue` | `#1F5F8F` | Links |
| `--orange` | `#C2460E` | Primary button, numerals, small-caps labels |
| `--orange-dark` | `#A93C0B` | Orange text on tint |
| `--orange-tint` | `#FCEBE1` | Callout panels |
| `--grey` | `#3B4C5A` | Secondary text |
| `--rule` | `#A9BBC8` | Hairlines |
| `--paper` | `#FFFFFF` | Page |

White text on `--ink`, `--blue` and `--orange` all pass 4.5:1. Do not put text on `--sky-line`.

Light theme only at launch.

## Type

- **Display:** Barlow Condensed, 600 and 700. Headlines, numerals, small-caps labels (uppercase, letter-spacing 0.12 to 0.14em).
- **Body:** Barlow, 400, 500 and 600.
- Self-host both as WOFF2 (`@fontsource/barlow`, `@fontsource/barlow-condensed`); no third-party font requests. `font-display: swap`, with `Arial Narrow` and `Helvetica Neue` fallbacks.
- Body 17px on phones, 18px on desktop, line-height 1.5. Measure 60 to 75 characters.
- Hero headline uppercase, tight leading (0.92), sized with `clamp()`.

## Components

Each exists in the welcome pack; reuse the proportions.

- **Hero band:** `--sky` field, headline, one-line description, price, button, the glider-in-thermal drawing or a photo.
- **Primary button:** `--orange` fill, white Barlow Condensed 700, square corners, at least 48px tall.
- **Fact tiles:** `--ink` block, big condensed figure, one line beneath.
- **Numbered steps:** large orange numeral, condensed heading, one or two sentences.
- **Path cards:** heading, one line, arrow. Whole card is the link.
- **Price table:** real `<table>`, 2px ink rule top and bottom, 1px hairlines between rows, prices right-aligned.
- **Callout panel:** `--orange-tint` or `--sky` block with a condensed lead-in.
- **Ladder:** six steps rising left to right; on a phone it becomes a vertical list with the same order.
- **Glider outlines:** the three planform drawings from the fleet page, at one scale.
- **Small-caps label:** orange, above a heading or a column.

No cards with rounded corners and a coloured left border, no gradients, no drop shadows, no emoji, no icon library. Icons, where needed, are simple inline stroke SVG.

## Layout

- Content column up to 1120px, 20px side padding on phones.
- Sections separated by space and a 2px ink rule, not by boxes.
- Grids collapse to one column below 640px.
- Sticky header, 56px on phones, containing the name and the button.

## Imagery

Real club photographs only: the K7 on the winch launch, a guest in the front seat, the view over the prairie, people at the launch point, the field at Birch Hills. Faces where permission is given. The shot list is in `06-open-questions.md` (Q5).

Until photographs arrive, the hero uses the drawn glider and thermal circles on the sky band, as on the pack's cover. Never use stock imagery.

Every image has descriptive alt text, explicit width and height, and is served as AVIF or WebP with a JPEG fallback through Astro's image pipeline. Lazy-load everything below the first screen.

## Motion

None required. If any is added, it is one slow drift of the hero glider around its thermal, disabled under `prefers-reduced-motion`.

## Accessibility

Real elements for controls (`<button>`, `<a>`, `<label>` with every `<input>`), visible focus states, a skip link, one `<h1>` per page, headings in order, 44px minimum touch targets, colour never the only signal.
