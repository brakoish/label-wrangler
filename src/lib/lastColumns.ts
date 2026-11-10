/**
 * The column headings of the last spreadsheet loaded on New run, kept on this
 * device so the designer can offer them as a list ("Spreadsheet column")
 * instead of asking for the exact heading to be typed. Only the headings are
 * kept, never a row of data. Matching a heading to a column stays as it was
 * (capitals and spaces don't matter).
 */
const KEY = 'lw:last-spreadsheet-columns';
const MAX = 60;

export interface LastColumns { headers: string[]; fileName?: string }

export function saveLastColumns(storage: Pick<Storage, 'setItem'> | null | undefined, headers: ReadonlyArray<string>, fileName?: string): void {
  const clean = Array.from(new Set(headers.map((h) => h.trim()).filter(Boolean))).slice(0, MAX);
  if (!clean.length) return;
  try { storage?.setItem(KEY, JSON.stringify({ headers: clean, ...(fileName ? { fileName: fileName.slice(0, 120) } : {}) })); } catch { /* kept for this page only */ }
}

export function readLastColumns(storage: Pick<Storage, 'getItem'> | null | undefined): LastColumns {
  try {
    const data = JSON.parse(storage?.getItem(KEY) ?? 'null') as Partial<LastColumns> | null;
    const headers = Array.isArray(data?.headers) ? data.headers.filter((h): h is string => typeof h === 'string' && !!h.trim()).slice(0, MAX) : [];
    return { headers, ...(typeof data?.fileName === 'string' ? { fileName: data.fileName } : {}) };
  } catch { return { headers: [] }; }
}

const simple = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The names to pick from, in order: the last file's headings, then the
 * columns other items on the design use (each name once, by how it matches).
 */
export function columnChoices(lastHeaders: ReadonlyArray<string>, designNames: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...lastHeaders, ...designNames]) {
    const key = simple(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** True for a name the app made up ("Text 1", "Barcode 2"), not a real heading. */
export function isMadeUpFieldName(name: string | undefined): boolean {
  return !name || /^(text|barcode|qr code|qr|picture|image|line|box) \d+$/i.test(name.trim());
}
