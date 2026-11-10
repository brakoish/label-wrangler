/**
 * Friendly names for field keys and spreadsheet columns.
 *
 * Field keys are what a design stores (`package_tag`, `coa_url`, `thcPercent`)
 * and what a spreadsheet header must match. People should read words
 * instead: "Package tag", "COA link", "THC %". The key itself never changes,
 * so printed output and column matching are unaffected.
 */

const WORDS: Record<string, string> = {
  thc: 'THC',
  cbd: 'CBD',
  tac: 'TAC',
  thca: 'THCA',
  cbg: 'CBG',
  cbn: 'CBN',
  sku: 'SKU',
  upc: 'UPC',
  ean: 'EAN',
  coa: 'COA',
  id: 'ID',
  uid: 'UID',
  qr: 'QR code',
  url: 'link',
  uri: 'link',
  mg: 'mg',
  g: 'g',
  oz: 'oz',
  pct: '%',
  percent: '%',
  qty: 'quantity',
  num: 'number',
  no: 'number',
  mfg: 'made',
  exp: 'expires',
  lot: 'lot',
  metrc: 'Metrc',
  nabis: 'Nabis',
};

/** Split `package_tag`, `packageTag`, `PACKAGE-TAG` and `qr1` into words. */
function splitWords(key: string): string[] {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .filter(Boolean);
}

/**
 * "package_tag" -> "Package tag", "coa_url" -> "COA link", "thcPercent" ->
 * "THC %", "qr_1" -> "QR code 1". Text that already reads as words (has a
 * space and no underscores) is returned as typed.
 */
export function friendlyFieldName(key: string | null | undefined): string {
  const raw = (key ?? '').trim();
  if (!raw) return 'Unnamed field';
  if (/\s/.test(raw) && !/[_]/.test(raw)) return raw;
  const words = splitWords(raw).map((word) => {
    const lower = word.toLowerCase();
    return WORDS[lower] ?? lower;
  });
  if (!words.length) return raw;
  const text = words.join(' ');
  // Capitalise the first letter unless it is already an acronym.
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Package tag (package_tag)" when the friendly name hides the exact key. */
export function friendlyWithKey(key: string): string {
  const friendly = friendlyFieldName(key);
  return friendly.toLowerCase() === key.toLowerCase() ? friendly : `${friendly} (${key})`;
}

const TYPE_NAMES: Record<string, string> = {
  text: 'Text',
  qr: 'QR code',
  barcode: 'Barcode',
  line: 'Line',
  rectangle: 'Box',
  image: 'Picture',
};

/** "Text", "QR code", "Barcode", "Line", "Box", "Picture". */
export function elementTypeName(type: string): string {
  return TYPE_NAMES[type] ?? 'Item';
}

/**
 * The next free plain name for a new item of this type: "Text 1", "Barcode 2".
 * `taken` is every name already used on the design.
 */
export function nextItemName(type: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (name) => name.trim().toLowerCase()));
  const base = elementTypeName(type);
  for (let n = 1; ; n++) {
    const candidate = `${base} ${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * A blank per-label column name gets a readable default that is also a
 * plausible spreadsheet heading ("Barcode 1"), instead of random letters.
 */
export function nextFieldName(type: string, existing: ReadonlyArray<{ fieldName?: string }>): string {
  return nextItemName(type, existing.map((el) => el.fieldName ?? '').filter(Boolean));
}

let headerRow = 1;

/**
 * The row the uploaded spreadsheet's headings are in (1 unless a title sits
 * above them). Set by New run when a file is read, so row numbers in its
 * checks match what the person sees in Excel.
 */
export function setSpreadsheetHeaderRow(row: number): void {
  headerRow = Number.isFinite(row) && row >= 1 ? Math.floor(row) : 1;
}

let rowMap: ReadonlyArray<number> | null = null;

/**
 * When New run leaves some rows out (blank cells), label N is no longer row
 * N of the file: `map[label - 1]` is the 0-based data row it came from.
 * Null when every row is a label.
 */
export function setSpreadsheetRowMap(map: ReadonlyArray<number> | null): void {
  rowMap = map && map.length ? map : null;
}

/** Spreadsheet row the person sees for a label: the row after the headings. */
export function spreadsheetRow(labelNumber: number): number {
  const dataRow = rowMap && labelNumber >= 1 && labelNumber <= rowMap.length ? rowMap[labelNumber - 1] + 1 : labelNumber;
  return dataRow + headerRow;
}

/**
 * Plain words for where a run's values came from, for the run page (in place
 * of "CSV import" and `CSV column "coa_url"`). `column` is the raw heading,
 * for a tooltip only; `source` is the run's dataSource.
 */
export function runSourceWords(source: string | null | undefined): { label: string; rowWord: string } {
  if (source === 'csv') return { label: 'From a spreadsheet', rowWord: 'spreadsheet' };
  if (source === 'manifest') return { label: 'From Manifest', rowWord: 'Manifest' };
  if (source === 'manual') return { label: 'Typed in', rowWord: 'typed' };
  return { label: 'Pasted in', rowWord: 'pasted' };
}

/** "From the spreadsheet's COA link column", with the "(plain number)" copy named as its column. */
export function columnSourceWords(source: string | null | undefined, column: string): { text: string; title: string } {
  const plain = / \((plain number|number only)\)$/.exec(column);
  const base = plain ? column.slice(0, plain.index) : column;
  if (column === '__paste__') return { text: 'Pasted values', title: '' };
  const name = friendlyFieldName(base);
  const where = runSourceWords(source).rowWord;
  const text = source === 'manifest' ? `From Manifest: ${name}` : `From the ${where} column ${name}${plain ? ' (number only)' : ''}`;
  return { text, title: base };
}
