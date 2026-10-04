// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Where the site is served. The deploy workflow sets both from GitHub Pages
// (https://<account>.github.io and /<repo> before the cutover; https://www.pagsc.ca
// and no base path after it). Locally the site runs at the root.
const SITE = process.env.SITE_URL || 'https://www.pagsc.ca';
const BASE = process.env.BASE_PATH || '/';
/** @param {string} path */
const to = (path) => BASE.replace(/\/$/, '') + path;

export default defineConfig({
  site: SITE,
  base: BASE,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'always' },
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/discovery-flight/requested/') && !page.includes('/welcome-pack-sent/') && !page.includes('/discovery-flight/paid/'),
    }),
  ],
  // Old WordPress paths (reference/current-site-audit.md). Emitted as static
  // redirect pages, which work on GitHub Pages.
  redirects: {
    '/come-fly-with-us': to('/discovery-flight/'),
    '/learn-to-soar-gliding': to('/learn-to-fly/'),
    '/about-our-club': to('/the-club/'),
    '/pictures-videos-gallery': to('/the-club/'),
    '/members-fees': to('/costs/'),
    '/useful-link': to('/members/'),
    '/contact-us': to('/find-us/'),
    '/members-section': to('/members/'),
  },
});
