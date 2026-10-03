// Build step: fetch the public Flying Schedule as CSV and write the next few
// flying days to src/data/flying-days.json for the home page.
// It must never fail the build: on any error it writes an empty list and the
// home page leaves the section out.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parse } from 'yaml';
import { parseCsv, extractDays } from './schedule-parse.mjs';

const OUT = new URL('../src/data/flying-days.json', import.meta.url);
const empty = { updated: null, days: [] };

async function write(data) {
  await mkdir(new URL('.', OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(data, null, 2) + '\n');
}

function todayOnTheField() {
  // Saskatchewan keeps Central Standard Time all year.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Regina' }).format(new Date());
}

async function main() {
  if (process.env.SKIP_SCHEDULE === '1') {
    console.log('[schedule] skipped (SKIP_SCHEDULE=1)');
    return write(empty);
  }
  const facts = parse(await readFile(new URL('../content/club-facts.yaml', import.meta.url), 'utf8'));
  const id = /\/d\/([\w-]+)/.exec(facts.links.flying_schedule)?.[1];
  if (!id) throw new Error('could not read the sheet id from links.flying_schedule');

  const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv`, {
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('csv')) throw new Error(`unexpected content type ${type}`);

  const days = extractDays(parseCsv(await res.text()), todayOnTheField());
  await write({ updated: new Date().toISOString(), days });
  console.log(`[schedule] ${days.length} upcoming flying day(s)`);
}

main().catch(async (err) => {
  console.warn(`[schedule] could not read the Flying Schedule (${err.message}); building without "Next flying days"`);
  try {
    await write(empty);
  } catch {
    /* the page falls back to no section if the file is missing too */
  }
});
