/**
 * Read one sheet of an Excel (.xlsx) file (the first with something on it, or
 * the one asked for) into the same shape as
 * parseCsv: `{ headers, rows }`. Numbers come out as Excel shows them (dates
 * as dates, prices with their symbol), and a title row above the headings is
 * skipped. No dependency: an .xlsx is a zip of XML
 * files, unzipped with the browser's DecompressionStream and read with
 * DOMParser. Anything unexpected throws XlsxReadError, and the caller falls
 * back to asking for a CSV.
 */
import { findHeaderRow, gridToRows, type ParsedCsv, type ReadOptions } from './csv';
import { builtInFormat, formatExcelNumber } from './excelNumberFormat';

export class XlsxReadError extends Error {}

export const EXCEL_SAVE_AS_CSV = 'This is an Excel file. In Excel choose File > Save As > CSV, then upload that.';

/** Zip files (.xlsx, .numbers, .ods) start with "PK\x03\x04". */
export function isZipFile(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Old binary Excel (.xls) and other OLE files. */
export function isOleFile(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

interface ZipEntry { name: string; method: number; compressedSize: number; offset: number }

function readEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory record: search backwards for its signature.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new XlsxReadError('Not a readable zip file');
  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) throw new XlsxReadError('Broken zip directory');
    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const offset = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
    entries.push({ name, method, compressedSize, offset });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readEntry(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(entry.offset, true) !== 0x04034b50) throw new XlsxReadError('Broken zip entry');
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
  const data = bytes.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8 || typeof DecompressionStream === 'undefined') throw new XlsxReadError('Unsupported compression');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new XlsxReadError('Broken sheet XML');
  return doc;
}

/** "BC12" -> 54 (0-based column index). */
function columnIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, '').toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function textOf(node: Element): string {
  // Shared and inline strings may be split into rich-text runs (<r><t>…</t></r>).
  return Array.from(node.getElementsByTagName('t')).map((t) => t.textContent ?? '').join('');
}

/** Number format code for each cell style index (the `s` attribute). */
function styleFormats(styles: Document | null): Array<string | undefined> {
  if (!styles) return [];
  const custom = new Map<number, string>();
  for (const fmt of Array.from(styles.getElementsByTagName('numFmt'))) {
    custom.set(Number(fmt.getAttribute('numFmtId')), fmt.getAttribute('formatCode') ?? '');
  }
  const cellXfs = styles.getElementsByTagName('cellXfs')[0];
  if (!cellXfs) return [];
  return Array.from(cellXfs.getElementsByTagName('xf')).map((xf) => {
    const id = Number(xf.getAttribute('numFmtId') ?? 0);
    return custom.get(id) ?? builtInFormat(id);
  });
}

/** One sheet's cells as text, as Excel shows them, with the plain digits of formatted numbers. */
function sheetGrid(sheet: Document, shared: string[], formats: Array<string | undefined>, date1904: boolean): { grid: string[][]; plainGrid: Array<Array<string | undefined>>; leading: number } {
  const grid: string[][] = [];
  // Plain digits of formatted number cells, by grid row (see ParsedCsv.plainRows).
  const plainGrid: Array<Array<string | undefined>> = [];
  for (const row of Array.from(sheet.getElementsByTagName('row'))) {
    const cells: string[] = [];
    const plainCells: Array<string | undefined> = [];
    let next = 0;
    for (const cell of Array.from(row.getElementsByTagName('c'))) {
      const ref = cell.getAttribute('r');
      const index = ref ? columnIndex(ref) : next;
      next = index + 1;
      const type = cell.getAttribute('t');
      const v = cell.getElementsByTagName('v')[0]?.textContent ?? '';
      let value: string;
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = textOf(cell);
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (type === 'str' || type === 'e') value = v;
      else if (type === 'd') value = v;
      else {
        const code = formats[Number(cell.getAttribute('s') ?? 0)];
        value = v === '' ? '' : formatExcelNumber(v, code, date1904);
        const plain = value === '' ? '' : formatExcelNumber(v, code, date1904, { plain: true });
        if (plain !== value) plainCells[index] = plain;
      }
      cells[index] = value;
    }
    // Keep each row at its sheet row number (Excel leaves empty rows out).
    const rowNumber = Number(row.getAttribute('r'));
    const at = Number.isInteger(rowNumber) && rowNumber >= 1 && rowNumber <= 1_048_576 ? Math.max(rowNumber - 1, grid.length) : grid.length;
    while (grid.length < at) { grid.push([]); plainGrid.push([]); }
    grid.push(Array.from(cells, (c) => c ?? ''));
    plainGrid.push(plainCells);
  }
  while (grid.length && grid[grid.length - 1].every((c) => !c.trim())) { grid.pop(); plainGrid.pop(); }
  let leading = 0;
  while (grid.length && grid[0].every((c) => !c.trim())) { grid.shift(); plainGrid.shift(); leading++; }
  return { grid, plainGrid, leading };

}

const simpleName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** How many of a sheet's headings match the design's fields (capitals and spaces don't matter). */
function headingScore(grid: string[][], wanted: ReadonlySet<string>): number {
  if (!grid.length || !wanted.size) return 0;
  const { headers } = gridToRows(grid, findHeaderRow(grid));
  return new Set(headers.map(simpleName).filter((h) => wanted.has(h))).size;
}

/**
 * `preferHeaders`: the design's field names. With no sheet asked for, the
 * sheet whose headings match the most of them is read (a "Read me" first
 * sheet is passed over); otherwise the first sheet with something on it.
 */
export async function readXlsx(input: ArrayBuffer | Uint8Array, options: ReadOptions & { preferHeaders?: ReadonlyArray<string> } = {}): Promise<ParsedCsv> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!isZipFile(bytes)) throw new XlsxReadError('Not an Excel file');
  const entries = readEntries(bytes);
  const find = (name: string) => entries.find((e) => e.name.toLowerCase() === name.toLowerCase());

  // The sheets in workbook order, each resolved through the relationships file.
  let sheetNames: string[] = [];
  let sheetPaths: string[] = ['xl/worksheets/sheet1.xml'];
  let date1904 = false;
  const workbook = find('xl/workbook.xml');
  const rels = find('xl/_rels/workbook.xml.rels');
  if (workbook) {
    const book = parseXml(await readEntry(bytes, workbook));
    const pr = book.getElementsByTagName('workbookPr')[0];
    date1904 = pr?.getAttribute('date1904') === '1' || pr?.getAttribute('date1904') === 'true';
    const sheets = Array.from(book.getElementsByTagName('sheet'));
    sheetNames = sheets.map((sheet, i) => sheet.getAttribute('name') || `Sheet ${i + 1}`);
    const relations = rels ? Array.from(parseXml(await readEntry(bytes, rels)).getElementsByTagName('Relationship')) : [];
    if (sheets.length) {
      sheetPaths = sheets.map((sheet, i) => {
        const relId = sheet.getAttribute('r:id') ?? sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
        const target = relId ? relations.find((r) => r.getAttribute('Id') === relId)?.getAttribute('Target') : null;
        return target ? (target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`) : `xl/worksheets/sheet${i + 1}.xml`;
      });
    }
  }
  const sheetCount = Math.max(1, sheetNames.length);
  if (!find(sheetPaths[0]) && !sheetPaths.some((path) => find(path))) throw new XlsxReadError('No sheet found');

  const sharedEntry = find('xl/sharedStrings.xml');
  const shared = sharedEntry ? Array.from(parseXml(await readEntry(bytes, sharedEntry)).getElementsByTagName('si')).map(textOf) : [];

  const stylesEntry = find('xl/styles.xml');
  let formats: Array<string | undefined> = [];
  try { formats = styleFormats(stylesEntry ? parseXml(await readEntry(bytes, stylesEntry)) : null); } catch { formats = []; }

  const readGrid = async (path: string) => {
    const entry = find(path);
    if (!entry) return null;
    return sheetGrid(parseXml(await readEntry(bytes, entry)), shared, formats, date1904);
  };
  // The sheet asked for; otherwise the first one with something on it.
  let sheetIndex = options.sheet !== undefined ? Math.min(Math.max(0, Math.floor(options.sheet)), sheetPaths.length - 1) : 0;
  let read = await readGrid(sheetPaths[sheetIndex]);
  if (options.sheet === undefined) {
    for (let i = 0; (!read || !read.grid.length) && i < sheetPaths.length; i++) {
      if (i === sheetIndex) continue;
      const next = await readGrid(sheetPaths[i]);
      if (next && next.grid.length) { read = next; sheetIndex = i; }
    }
    const wanted = new Set((options.preferHeaders ?? []).map(simpleName).filter(Boolean));
    if (wanted.size && sheetPaths.length > 1 && read) {
      let best = headingScore(read.grid, wanted);
      for (let i = 0; i < Math.min(sheetPaths.length, 20); i++) {
        if (i === sheetIndex) continue;
        const next = await readGrid(sheetPaths[i]);
        const score = next ? headingScore(next.grid, wanted) : 0;
        if (next && score > best) { best = score; read = next; sheetIndex = i; }
      }
    }
  }
  if (!read) throw new XlsxReadError('No sheet found');
  const { grid, plainGrid, leading } = read;
  const sheetName = sheetNames[sheetIndex];
  const sheetInfo = { sheetName, sheetCount, sheetIndex, ...(sheetNames.length ? { sheetNames } : {}) };
  if (!grid.length) return { headers: [], rows: [], ...sheetInfo };

  const headerIndex = options.headerRow ? Math.min(grid.length - 1, Math.max(0, options.headerRow - 1 - leading)) : findHeaderRow(grid);
  const { headers, rows } = gridToRows(grid, headerIndex);
  // The same rows gridToRows keeps (non-blank, below the headings).
  const names = (grid[headerIndex] ?? []).map((h) => h.trim());
  const plainRows: Record<string, string>[] = [];
  grid.forEach((cells, i) => {
    if (i <= headerIndex || !cells.some((c) => c.trim())) return;
    const plain: Record<string, string> = {};
    plainGrid[i]?.forEach((value, col) => { if (value !== undefined && names[col]) plain[names[col]] = value; });
    plainRows.push(plain);
  });
  const anyPlain = plainRows.some((row) => Object.keys(row).length > 0);
  return { headers, rows, headerRow: leading + headerIndex + 1, titleSkipped: headerIndex > 0 && !options.headerRow, ...sheetInfo, ...(anyPlain ? { plainRows } : {}) };
}
