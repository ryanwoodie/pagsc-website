// Build step: save a snapshot of the booking calendar's open days and free slots (no names) to
// src/data/availability.json, so the calendar shows straight away while the live data loads.
// The site rebuilds every few hours (.github/workflows), which keeps the snapshot fresh.
// It must never fail the build: on any error it writes no days and the calendar loads live only.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const OUT = new URL('../src/data/availability.json', import.meta.url);
const empty = { updated: null, days: [] };

async function write(data) {
  await mkdir(new URL('.', OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(data) + '\n');
}

async function endpoint() {
  if (process.env.PUBLIC_FORM_ENDPOINT) return process.env.PUBLIC_FORM_ENDPOINT;
  const config = await readFile(new URL('../src/config.ts', import.meta.url), 'utf8');
  return /'(https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec)'/.exec(config)?.[1] ?? '';
}

async function main() {
  if (process.env.SKIP_SCHEDULE === '1') {
    console.log('[availability] skipped (SKIP_SCHEDULE=1)');
    return write(empty);
  }
  const url = await endpoint();
  if (!url) throw new Error('no booking endpoint in src/config.ts');
  const res = await fetch(`${url}?action=availability`, { signal: AbortSignal.timeout(30000), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok || !Array.isArray(data.days)) throw new Error('no days in the response');
  // Keep only what the calendar uses.
  const days = data.days.map(({ date, kind, status, statusText, remaining, slots }) => ({ date, kind, status, statusText, remaining, slots }));
  await write({ updated: new Date().toISOString(), days });
  console.log(`[availability] ${days.length} bookable day(s)`);
}

main().catch(async (err) => {
  console.warn(`[availability] could not read the booking calendar (${err.message}); it will load live only`);
  try {
    await write(empty);
  } catch {
    /* the calendar loads live if the file is missing too */
  }
});
