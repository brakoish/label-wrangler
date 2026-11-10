import type { FieldMapping, LabelTemplate, TemplateElement } from './types';
import { detectUrlColumn } from './csv';
import { EXAMPLE_CODE_VALUES } from './sampleValues';

/**
 * Helpers for the new-run wizard's barcode and QR columns, and for the plain
 * digits of numbers a spreadsheet formats ("$1,234.50"). Free of React so the
 * rules can be tested.
 */

type Row = Record<string, string>;
export type CodeType = 'barcode' | 'qr';

const URLISH = /^https?:\/\//i;
// Names that say "the barcode of this product", best first.
const BARCODE_HEADINGS: RegExp[] = [
  /^(sku|upc|ean|gtin|barcode)$/i,
  /\b(sku|upc|ean|gtin|barcode)\b|sku|upc|barcode/i,
  /package\s*_?tag|^tag$|\buid\b|metrc|package\s*id/i,
  /item\s*_?(code|number|no)|product\s*_?(code|id)/i,
];
const QR_HEADINGS: RegExp[] = [/^(url|link|qr|qr code)$/i, /url|link|qr|coa|website|lab\s*result/i];

function values(rows: ReadonlyArray<Row>, column: string, limit = 500): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const value = (row[column] ?? '').trim();
    if (value) out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function looksLikeBarcodeColumn(rows: ReadonlyArray<Row>, column: string): boolean {
  const found = values(rows, column);
  if (!found.length) return false;
  const codeLike = found.filter((v) => !URLISH.test(v) && /^[A-Za-z0-9][A-Za-z0-9\-.]{3,47}$/.test(v) && /\d/.test(v));
  return codeLike.length / found.length >= 0.8;
}

/**
 * The spreadsheet column a barcode or QR code most likely comes from: a
 * heading such as SKU or UPC (or a link column for a QR code), else a column
 * whose values look like codes. Null when nothing fits.
 */
export function bestCodeColumn(type: CodeType, headers: ReadonlyArray<string>, rows: ReadonlyArray<Row>): string | null {
  if (!headers.length) return null;
  if (type === 'qr') {
    for (const pattern of QR_HEADINGS) {
      const named = headers.find((h) => pattern.test(h) && (!rows.length || values(rows, h).some((v) => URLISH.test(v) || v.length > 8)));
      if (named) return named;
    }
    return rows.length ? detectUrlColumn({ headers: [...headers], rows: [...rows] }) : null;
  }
  for (const pattern of BARCODE_HEADINGS) {
    const named = headers.find((h) => pattern.test(h) && (!rows.length || values(rows, h).every((v) => !URLISH.test(v))));
    if (named) return named;
  }
  if (!rows.length) return null;
  return headers.find((h) => looksLikeBarcodeColumn(rows, h)) ?? null;
}

/** Which per-label fields print as a barcode or a QR code. */
export function codeFieldTypes(template: Pick<LabelTemplate, 'elements'> | null | undefined): Record<string, CodeType> {
  const out: Record<string, CodeType> = {};
  for (const el of template?.elements ?? []) {
    if (el.isStatic || !el.fieldName?.trim()) continue;
    if (el.type === 'barcode' || el.type === 'qr') out[el.fieldName] ??= el.type;
  }
  return out;
}

function staticContent(el: TemplateElement): string {
  return 'content' in el ? (el.content ?? '').trim() : '';
}

export interface ExampleCodeRisk {
  elementId: string;
  type: CodeType;
  /** What prints on every label. */
  value: string;
  /** The design still holds its example value. */
  isExample: boolean;
  /** A spreadsheet column that changes per row and probably holds the real codes. */
  column: string | null;
}

/**
 * Barcodes and QR codes set to print the same value on every label while
 * that value is the design's example, or while the data has a column that
 * changes per row and looks like the real codes. Printing those is almost
 * always a mistake, so the wizard asks before Start.
 */
export function exampleCodeRisks(template: Pick<LabelTemplate, 'elements'> | null | undefined, headers: ReadonlyArray<string>, rows: ReadonlyArray<Row>): ExampleCodeRisk[] {
  const risks: ExampleCodeRisk[] = [];
  for (const el of template?.elements ?? []) {
    if (!el.isStatic || (el.type !== 'barcode' && el.type !== 'qr')) continue;
    const value = staticContent(el);
    const isExample = !value || EXAMPLE_CODE_VALUES.includes(value);
    let column = rows.length > 1 ? bestCodeColumn(el.type, headers, rows) : null;
    if (column && new Set(values(rows, column)).size < 2) column = null;
    if (column && values(rows, column).every((v) => v === value)) column = null;
    // A fixed QR code with its own link (the shop's website) is normal; a fixed barcode next to a SKU column isn't.
    if (isExample || (column && el.type === 'barcode')) risks.push({ elementId: el.id, type: el.type, value, isExample, column });
  }
  return risks;
}

/** A field name for a code that now changes per label: the column's own heading when it is free. */
export function fieldNameForColumn(column: string | null, fallback: string, taken: ReadonlyArray<string>): string {
  const name = (column ?? '').trim();
  if (!name || name.length > 60 || taken.some((t) => t.trim().toLowerCase() === name.toLowerCase())) return fallback;
  return name;
}

// ---------------------------------------------------------------------------
// Plain numbers
// ---------------------------------------------------------------------------

export const PLAIN_NUMBER_SUFFIX = ' (plain number)';
const NUMBER_ONLY_SUFFIX = ' (number only)';
const CURRENCY = '$€£¥';

/** "$1,234.50" -> "1234.50"; anything that isn't a plain amount stays as it is. */
export function stripCurrency(value: string): string {
  const match = value.trim().match(new RegExp(`^(-?)[${CURRENCY}]\\s?(-?)((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)$`));
  if (!match) return value;
  return `${match[1] || match[2]}${match[3].replace(/,/g, '')}`;
}

export interface PlainNumberInput {
  rows: ReadonlyArray<Row>;
  /** From the Excel reader: the digits behind formatted cells, only where they differ. */
  plainRows?: ReadonlyArray<Row> | null;
  mappings: Record<string, FieldMapping>;
  /** Fields that print the plain number (barcodes, QR codes, and fields the person switched). */
  plainFields: ReadonlySet<string>;
  /** Fields where a "$" in the cell is dropped too (the design adds its own). */
  currencyFields?: ReadonlySet<string>;
}

/**
 * Rows and mappings where the plain fields read the unformatted value: a
 * "(plain number)" copy of each such column is added and those fields point
 * at it, so text fields mapped to the same column keep what Excel shows.
 * Returns the inputs themselves when nothing changes.
 */
export function applyPlainNumbers({ rows, plainRows, mappings, plainFields, currencyFields }: PlainNumberInput): { rows: Row[]; mappings: Record<string, FieldMapping>; columns: string[] } {
  const added = new Map<string, string[]>();
  const nextMappings: Record<string, FieldMapping> = { ...mappings };
  for (const field of plainFields) {
    const mapping = mappings[field];
    const column = mapping?.mode === 'column' ? mapping.csvColumn : '';
    if (!column) continue;
    const stripMoney = !!currencyFields?.has(field);
    const plainColumn = `${column}${stripMoney ? NUMBER_ONLY_SUFFIX : PLAIN_NUMBER_SUFFIX}`;
    let cells = added.get(plainColumn);
    if (!cells) {
      let differs = false;
      cells = rows.map((row, index) => {
        const shown = row[column] ?? '';
        const fromExcel = plainRows?.[index]?.[column];
        const plain = fromExcel ?? (stripMoney ? stripCurrency(shown) : shown);
        if (plain !== shown) differs = true;
        return plain;
      });
      if (!differs) continue;
      added.set(plainColumn, cells);
    }
    nextMappings[field] = { ...mapping, csvColumn: plainColumn };
  }
  if (!added.size) return { rows: rows as Row[], mappings, columns: [] };
  const nextRows = rows.map((row, index) => {
    const copy: Row = { ...row };
    for (const [column, cells] of added) copy[column] = cells[index];
    return copy;
  });
  return { rows: nextRows, mappings: nextMappings, columns: [...added.keys()] };
}

export interface DoubledCurrencyRisk {
  field: string;
  column: string;
  symbol: string;
  /** How a label would print, e.g. "$$20.00". */
  printed: string;
  /** How it prints with the plain number, e.g. "$20.00". */
  plain: string;
}

/**
 * Text fields whose design adds a currency sign in front ("$") while the
 * spreadsheet column already starts with one, so labels would print "$$20.00".
 */
export function doubledCurrencyRisks(template: Pick<LabelTemplate, 'elements'> | null | undefined, mappings: Record<string, FieldMapping>, rows: ReadonlyArray<Row>, plainRows?: ReadonlyArray<Row> | null): DoubledCurrencyRisk[] {
  const risks: DoubledCurrencyRisk[] = [];
  const seen = new Set<string>();
  for (const el of template?.elements ?? []) {
    if (el.isStatic || el.type === 'barcode' || el.type === 'qr' || !el.fieldName || seen.has(el.fieldName)) continue;
    const prefix = (el.prefix ?? '').trimEnd();
    const symbol = prefix.slice(-1);
    if (!symbol || !CURRENCY.includes(symbol)) continue;
    const mapping = mappings[el.fieldName];
    const column = mapping?.mode === 'column' ? mapping.csvColumn : '';
    if (!column) continue;
    const found = values(rows, column, 200);
    const first = rows.findIndex((row) => (row[column] ?? '').trim().startsWith(symbol));
    if (!found.length || first < 0 || found.filter((v) => v.startsWith(symbol)).length / found.length < 0.5) continue;
    seen.add(el.fieldName);
    const shown = (rows[first][column] ?? '').trim();
    const plain = plainRows?.[first]?.[column] ?? stripCurrency(shown);
    risks.push({ field: el.fieldName, column, symbol, printed: `${prefix}${shown}`, plain: `${prefix}${plain}` });
  }
  return risks;
}
