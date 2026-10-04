// After the build: every internal link and asset in dist/ must resolve to a file.
// Fails the build with a list of broken links.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const BASE = (process.env.BASE_PATH || '/').replace(/\/$/, '');

async function* htmlFiles(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* htmlFiles(p);
    else if (e.name.endsWith('.html')) yield p;
  }
}

async function exists(p) {
  try {
    const s = await stat(p);
    return s.isFile() || (await stat(join(p, 'index.html'))).isFile();
  } catch {
    return false;
  }
}

const broken = [];
for await (const file of htmlFiles(DIST)) {
  const html = await readFile(file, 'utf8');
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const [, url] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|tel:|data:)/.test(url)) continue;
    const [withQuery, hash] = url.split('#');
    const path = withQuery.split('?')[0];
    if (!path) {
      if (hash && !ids.has(hash)) broken.push(`${file.replace(DIST, '')}: #${hash}`);
      continue;
    }
    if (!path.startsWith(BASE + '/')) {
      broken.push(`${file.replace(DIST, '')}: ${url} (missing base path)`);
      continue;
    }
    const target = join(DIST, decodeURI(path.slice(BASE.length)));
    if (!(await exists(target))) broken.push(`${file.replace(DIST, '')}: ${url}`);
  }
}

if (broken.length) {
  console.error(`Broken links:\n  ${broken.join('\n  ')}`);
  process.exit(1);
}
console.log('[links] all internal links resolve');
