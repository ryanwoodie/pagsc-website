// After `astro build`: print /welcome-pack/print/ to dist/welcome-pack.pdf with headless Chrome.
// Serves dist/ on a local port so fonts and images load as they do on the live site.
// In CI a missing PDF fails the build; locally it warns (Chrome may not be installed).
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFile } from 'node:child_process';

const DIST = new URL('../dist/', import.meta.url).pathname;
const BASE = (process.env.BASE_PATH || '/').replace(/\/$/, '');
const OUT = join(DIST, 'welcome-pack.pdf');
const strict = !!process.env.CI;
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif' };

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p));
}

function fail(msg) {
  if (strict) {
    console.error(`[pack] ${msg}`);
    process.exit(1);
  }
  console.warn(`[pack] ${msg}; skipping the welcome pack PDF`);
  process.exit(0);
}

const chrome = findChrome();
if (!chrome) fail('Chrome not found (set CHROME_PATH)');

const server = http.createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (BASE && path.startsWith(BASE)) path = path.slice(BASE.length) || '/';
  let file = join(DIST, path);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}${BASE}/welcome-pack/print/`;
  // execFile (not execFileSync): the server above must keep answering while Chrome loads the page.
  execFile(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--no-pdf-header-footer', '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=20000', `--print-to-pdf=${OUT}`, url,
  ], { timeout: 120000 }, async (err, _stdout, stderr) => {
    server.close();
    let buf;
    try {
      buf = await readFile(OUT);
    } catch {
      return fail(`no PDF written${err ? `: ${String(stderr || err.message).slice(-300)}` : ''}`);
    }
    const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    if (pages !== 9) return fail(`expected 9 pages, got ${pages}`);
    console.log(`[pack] welcome-pack.pdf: ${pages} pages, ${Math.round(buf.length / 1024)} KB`);
  });
});
