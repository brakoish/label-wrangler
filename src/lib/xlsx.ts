/**
 * Read the first sheet of an Excel (.xlsx) file into the same shape as
 * parseCsv: `{ headers, rows }`. No dependency: an .xlsx is a zip of XML
 * files, unzipped with the browser's DecompressionStream and read with
 * DOMParser. Anything unexpected throws XlsxReadError, and the caller falls
 * back to asking for a CSV.
 */
import type { ParsedCsv } from './csv';

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

/** Excel stores dates as day numbers; numbers keep Excel's general format. */
function cellNumber(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  // Avoid float noise such as 27.410000000000004.
  return String(Math.round(n * 1e9) / 1e9);
}

export async function readXlsx(input: ArrayBuffer | Uint8Array): Promise<ParsedCsv> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!isZipFile(bytes)) throw new XlsxReadError('Not an Excel file');
  const entries = readEntries(bytes);
  const find = (name: string) => entries.find((e) => e.name.toLowerCase() === name.toLowerCase());

  // The first sheet in workbook order, resolved through the relationships file.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const workbook = find('xl/workbook.xml');
  const rels = find('xl/_rels/workbook.xml.rels');
  if (workbook && rels) {
    const firstSheet = parseXml(await readEntry(bytes, workbook)).getElementsByTagName('sheet')[0];
    const relId = firstSheet?.getAttribute('r:id') ?? firstSheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    if (relId) {
      const rel = Array.from(parseXml(await readEntry(bytes, rels)).getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === relId);
      const target = rel?.getAttribute('Target');
      if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    }
  }
  const sheetEntry = find(sheetPath);
  if (!sheetEntry) throw new XlsxReadError('No sheet found');

  const sharedEntry = find('xl/sharedStrings.xml');
  const shared = sharedEntry ? Array.from(parseXml(await readEntry(bytes, sharedEntry)).getElementsByTagName('si')).map(textOf) : [];

  const sheet = parseXml(await readEntry(bytes, sheetEntry));
  const grid: string[][] = [];
  for (const row of Array.from(sheet.getElementsByTagName('row'))) {
    const cells: string[] = [];
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
      else value = v === '' ? '' : cellNumber(v);
      cells[index] = value;
    }
    grid.push(Array.from(cells, (c) => c ?? ''));
  }
  while (grid.length && grid[grid.length - 1].every((c) => !c.trim())) grid.pop();
  while (grid.length && grid[0].every((c) => !c.trim())) grid.shift();
  if (!grid.length) return { headers: [], rows: [] };

  const headers = grid[0].map((h) => h.trim());
  const rows = grid.slice(1).filter((r) => r.some((c) => c.trim())).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) obj[h] = r[i] ?? ''; });
    return obj;
  });
  return { headers: headers.filter(Boolean), rows };
}
