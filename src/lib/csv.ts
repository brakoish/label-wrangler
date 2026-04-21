/**
 * Small, dependency-free CSV parser tuned for METRC-style exports.
 * Handles quoted fields, commas/newlines inside quotes, and simple escaping.
 * Returns `{ headers, rows }` where rows are objects keyed by header name.
 */

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(input: string): ParsedCsv {
  // Normalize line endings and strip BOM.
  const src = input.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          // Escaped double quote inside a quoted field.
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += c;
      }
    }
  }
  // Flush final field/row.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Remove trailing completely-empty rows.
  while (rows.length > 0 && rows[rows.length - 1].every((f) => f === '')) {
    rows.pop();
  }

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = r[idx] ?? '';
    });
    return obj;
  });

  return { headers, rows: dataRows };
}

/**
 * Detect which column in a parsed CSV most looks like URL/QR data.
 * Returns the header name, or null if none stand out.
 * Strategy: pick the column where the highest fraction of non-empty cells
 * start with "http" (case-insensitive). Tie-breaker: earliest column.
 */
export function detectUrlColumn(parsed: ParsedCsv): string | null {
  if (parsed.headers.length === 0 || parsed.rows.length === 0) return null;

  const scores = parsed.headers.map((h) => {
    const values = parsed.rows.map((r) => (r[h] ?? '').trim()).filter(Boolean);
    if (values.length === 0) return { h, score: 0 };
    const urlish = values.filter((v) => /^https?:\/\//i.test(v)).length;
    return { h, score: urlish / values.length };
  });

  const best = scores.reduce((a, b) => (b.score > a.score ? b : a), scores[0]);
  return best.score >= 0.5 ? best.h : null;
}

/** Extract a column as an array of non-empty trimmed values. */
export function extractColumn(parsed: ParsedCsv, column: string): string[] {
  return parsed.rows
    .map((r) => (r[column] ?? '').trim())
    .filter((v) => v.length > 0);
}
