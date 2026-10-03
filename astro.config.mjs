// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Where the site is served. The deploy workflow sets both from GitHub Pages
// (https://<account>.github.io and /<repo> before the cutover; https://www.pagsc.ca
// and no base path after it). Locally the site runs at the root.
const SITE = process.env.SITE_URL || 'https://www.pagsc.ca';
const BASE = process.env.BASE_PATH || '/';

export default defineConfig({
  site: SITE,
  base: BASE,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/discovery-flight/requested/'),
    }),
  ],
  // Old WordPress paths (reference/current-site-audit.md). Emitted as static
  // redirect pages, which work on GitHub Pages.
  redirects: {
    '/come-fly-with-us': '/discovery-flight/',
    '/learn-to-soar-gliding': '/learn-to-fly/',
    '/about-our-club': '/the-club/',
    '/pictures-videos-gallery': '/the-club/',
    '/members-fees': '/costs/',
    '/useful-link': '/members/',
    '/contact-us': '/find-us/',
    '/members-section': '/members/',
  },
});
