// The club's waiver (content/waiver.md) as blocks, for the /waiver/ page and for the Apps Script,
// which renders the signed PDF and hashes the exact text signed.
// Run directly (`npm run waiver`) to rewrite apps-script/WaiverText.gs.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const SOURCE = new URL('../content/waiver.md', import.meta.url);
export const GS_FILE = new URL('../apps-script/WaiverText.gs', import.meta.url);

/**
 * @typedef {{ type: 'h1' | 'h2' | 'h3' | 'p', text: string } | { type: 'ul', items: string[] } | { type: 'hr' }} WaiverBlock
 * @returns {{ version: string, guardianConsent: string, privacy: string, blocks: WaiverBlock[] }}
 *   Text keeps its **bold** and *italic* markers.
 */
export function readWaiver(md = readFileSync(SOURCE, 'utf8')) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('content/waiver.md needs frontmatter');
  const front = parse(m[1]);
  for (const k of ['version', 'guardian_consent', 'privacy']) if (!front[k]) throw new Error(`content/waiver.md needs ${k}`);
  /** @type {WaiverBlock[]} */
  const blocks = [];
  for (const chunk of m[2].trim().split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    const h = lines[0].match(/^(#{1,3})\s+(.*)$/);
    if (lines.length === 1 && /^-{3,}$/.test(lines[0])) blocks.push({ type: 'hr' });
    else if (h) blocks.push({ type: /** @type {'h1' | 'h2' | 'h3'} */ ('h' + h[1].length), text: h[2].replace(/\*\*/g, '') });
    else if (lines.every((l) => l.startsWith('* '))) blocks.push({ type: 'ul', items: lines.map((l) => l.slice(2)) });
    else blocks.push({ type: 'p', text: lines.join(' ') });
  }
  return { version: String(front.version), guardianConsent: front.guardian_consent, privacy: front.privacy, blocks };
}

/** Inline markup to HTML: escape, then **bold** and *italic*. */
export function inlineHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
}

export function gsSource(w = readWaiver()) {
  return [
    '// Generated from content/waiver.md by scripts/waiver-text.mjs (npm run waiver). Do not edit by hand.',
    'var WAIVER_TEXT = ' + JSON.stringify(w, null, 2) + ';',
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(GS_FILE, gsSource());
  console.log('Wrote apps-script/WaiverText.gs');
}
