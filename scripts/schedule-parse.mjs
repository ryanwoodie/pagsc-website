// Parses the public Flying Schedule CSV into the few fields the site may publish:
// date, a status category, and whether any instructor has signed up.
// The Status / Comments cell is free text and often names members, so it is
// reduced to a category and never copied. No name from the sheet reaches the output.
// Sheet layout: reference/current-site-audit.md ("The Flying Schedule sheet").

/** Minimal RFC 4180 CSV parser: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Sat Oct 3,2026" -> "2026-10-03"; null if it does not look like a date. */
export function parseSheetDate(text) {
  const m = /([A-Za-z]{3})[a-z]*\.?\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s*(\d{4})/.exec(text ?? '');
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0) return null;
  const d = new Date(Date.UTC(Number(m[4]), month, Number(m[3])));
  if (d.getUTCMonth() !== month) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Reduce the free-text Status / Comments cell to one of a few fixed values.
 * @returns {'on' | 'delayed' | 'cancelled' | 'unknown' | ''}
 */
export function classifyStatus(text) {
  const t = (text ?? '').toLowerCase();
  if (!t.trim()) return '';
  if (/\b(cancel+ed|cancel+ing|cancel|scrubbed|no fly(ing)?|not flying|grounded|day is off|is off|off today)\b/.test(t)) return 'cancelled';
  if (/\b(delay(ed)?|postpon\w*|later start|on hold|tbd|wait(ing)? (and|&) see)\b/.test(t)) return 'delayed';
  if (/\b(a go|is go|go for|good to go|flying (is )?on|day is on|we('re| are) flying|on for|confirmed)\b/.test(t)) return 'on';
  return 'unknown';
}

const SIGNUP_LABEL = /sign-?\s*up\s+below/i;
const INSTRUCTOR_LABEL = /instructors?\s+sign-?\s*up\s+below/i;

/**
 * @param {string[][]} rows
 * @param {string} today ISO date (local to the airfield)
 * @param {number} limit
 */
export function extractDays(rows, today, limit = 4) {
  if (!rows.length) return [];
  const width = Math.max(...rows.map((r) => r.length));
  const cell = (r, c) => (rows[r]?.[c] ?? '').trim();
  const statusRow = rows.findIndex((r) => /^status/i.test((r[0] ?? '').trim()));

  const days = [];
  for (let c = 1; c < width; c++) {
    const date = parseSheetDate(cell(0, c));
    if (!date || date < today) continue;

    const status = statusRow >= 0 ? classifyStatus(cell(statusRow, c)) : '';

    let instructor = false;
    const labelRow = rows.findIndex((_, r) => INSTRUCTOR_LABEL.test(cell(r, c)));
    if (labelRow >= 0) {
      for (let r = labelRow + 1; r < rows.length; r++) {
        const v = cell(r, c);
        if (SIGNUP_LABEL.test(v)) break;
        if (v) {
          instructor = true;
          break;
        }
      }
    }

    const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    if (weekend || status) days.push({ date, status, instructor });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return days.slice(0, limit);
}
