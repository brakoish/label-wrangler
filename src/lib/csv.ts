/**
 * Small, dependency-free CSV parser tuned for METRC-style exports.
 * Handles quoted fields, commas/newlines inside quotes, and simple escaping.
 * Returns `{ headers, rows }` where rows are objects keyed by header name.
 */

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  /** Spreadsheet row (1-based) that holds the headings. */
  headerRow?: number;
  /** True when rows above the headings looked like a title and were skipped. */
  titleSkipped?: boolean;
  /** Excel only: the name of the sheet that was read. */
  sheetName?: string;
  /** Excel only: how many sheets the workbook has. */
  sheetCount?: number;
  /**
   * Excel only, one entry per row: the plain digits of number cells whose
   * format adds separators, currency or text ("1234.50" for "$1,234.50").
   * Only cells that differ are listed. Barcodes use these, so a format can't
   * put commas or a "$" into a barcode.
   */
  plainRows?: Record<string, string>[];
}

export interface ReadOptions {
  /** Use this spreadsheet row (1-based) as the headings instead of finding it. */
  headerRow?: number;
}

/**
 * Which row holds the headings. A title above the table ("November new
 * products") fills one cell; the headings fill several. Returns a 0-based
 * index into `grid`.
 */
export function findHeaderRow(grid: string[][]): number {
  const filled = (row: string[]) => row.filter((cell) => cell.trim()).length;
  const sample = grid.slice(0, 30);
  const widest = Math.max(0, ...sample.map(filled));
  if (widest < 2) return 0;
  for (let i = 0; i < Math.min(10, sample.length); i++) {
    const count = filled(sample[i]);
    if (count >= 2 && count >= Math.ceil(widest * 0.5)) return i;
  }
  return 0;
}

/** Headings and rows from a grid of cells, starting at `headerIndex`. */
export function gridToRows(grid: string[][], headerIndex: number): { headers: string[]; rows: Record<string, string>[] } {
  const header = grid[headerIndex] ?? [];
  const headers = header.map((h) => h.trim());
  const rows = grid.slice(headerIndex + 1).filter((r) => r.some((c) => c.trim())).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) obj[h] = r[i] ?? ''; });
    return obj;
  });
  return { headers: headers.filter(Boolean), rows };
}

export function parseCsv(input: string, options: ReadOptions = {}): ParsedCsv {
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

  let leading = 0;
  while (rows.length > 0 && rows[0].every((f) => f.trim() === '')) { rows.shift(); leading++; }
  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  const found = findHeaderRow(rows);
  const headerIndex = options.headerRow ? Math.min(rows.length - 1, Math.max(0, options.headerRow - 1 - leading)) : found;
  const header = rows[headerIndex].map((h) => h.trim());
  const dataRows = rows.slice(headerIndex + 1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      obj[h] = r[idx] ?? '';
    });
    return obj;
  });

  return { headers: header, rows: dataRows, headerRow: leading + headerIndex + 1, titleSkipped: headerIndex > 0 && !options.headerRow };
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
