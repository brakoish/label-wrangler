/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
require('../thermal/register.cjs');
const assert = require('node:assert/strict');
const { formatExcelNumber, builtInFormat } = require('../../src/lib/excelNumberFormat.ts');
const { parseCsv, findHeaderRow } = require('../../src/lib/csv.ts');
const { spreadsheetRow, setSpreadsheetHeaderRow } = require('../../src/lib/fieldLabels.ts');

// Numbers as Excel shows them.
assert.equal(formatExcelNumber('46327', builtInFormat(14)), '11/1/2026');
assert.equal(formatExcelNumber('46327', 'mm/dd/yyyy'), '11/01/2026');
assert.equal(formatExcelNumber('46327', 'yyyy-mm-dd'), '2026-11-01');
assert.equal(formatExcelNumber('46327', 'mmmm d, yyyy'), 'November 1, 2026');
assert.equal(formatExcelNumber('20', '"$"#,##0.00'), '$20.00');
assert.equal(formatExcelNumber('1234.5', '[$$-409]#,##0.00'), '$1,234.50');
assert.equal(formatExcelNumber('20', builtInFormat(44)), '$20.00');
assert.equal(formatExcelNumber('-5', builtInFormat(7)), '($5.00)');
assert.equal(formatExcelNumber('0.275', '0.0%'), '27.5%');
assert.equal(formatExcelNumber('3.5', '0.0"g"'), '3.5g');
assert.equal(formatExcelNumber('7', '000'), '007');
assert.equal(formatExcelNumber('85001000000', undefined), '85001000000');
assert.equal(formatExcelNumber('27.410000000000004', 'General'), '27.41');
assert.equal(formatExcelNumber('0.5', builtInFormat(18)), '12:00 PM');
assert.equal(formatExcelNumber('46327', 'm/d/yyyy', true), '11/2/2030', '1904 date system');
// Excel rounds the decimal value half away from zero (toFixed on the binary float did not).
const { roundLikeExcel } = require('../../src/lib/excelNumberFormat.ts');
assert.equal(formatExcelNumber('1.005', '0.00'), '1.01');
assert.equal(formatExcelNumber('2.675', '"$"#,##0.00'), '$2.68');
assert.equal(formatExcelNumber('8.345', '0.00'), '8.35');
assert.equal(formatExcelNumber('-2.675', '0.00'), '-2.68');
assert.equal(formatExcelNumber('-1.005', builtInFormat(7)), '($1.01)');
assert.equal(formatExcelNumber('0.125', '0.0%'), '12.5%');
assert.equal(formatExcelNumber('1234567.125', '#,##0.00'), '1,234,567.13');
assert.equal(formatExcelNumber('0.5', '0'), '1');
assert.equal(formatExcelNumber('2.5', '0'), '3');
assert.equal(roundLikeExcel(1e22, 2), (1e22).toFixed(2));
// A zero section that is text alone shows that text, not "-0".
assert.equal(formatExcelNumber('0', '0.00;-0.00;"-"'), '-');
assert.equal(formatExcelNumber('0', '0.00;-0.00;'), '');
assert.equal(formatExcelNumber('3', '0.00;-0.00;"-"'), '3.00');
// Plain digits for barcodes and templates that add their own "$".
const plain = (raw, code) => formatExcelNumber(raw, code, false, { plain: true });
assert.equal(plain('1234.5', '"$"#,##0.00'), '1234.50');
assert.equal(plain('2.675', '"$"#,##0.00'), '2.68');
assert.equal(plain('850010000001', '#,##0'), '850010000001');
assert.equal(plain('12345678905', '000000000000'), '012345678905', 'zero padding is kept (UPC)');
assert.equal(plain('-5', builtInFormat(7)), '-5.00');
assert.equal(plain('20', builtInFormat(44)), '20.00');
assert.equal(plain('0.2741', '0.00%'), '27.41');
assert.equal(plain('46327', builtInFormat(14)), '11/1/2026', 'dates stay dates');
assert.equal(plain('85001000000', undefined), '85001000000');

// A title row above the headings is not a label.
const titled = 'November new products – for Grandma,,\n,,\nProduct Name,SKU,Price\nBlue Dream,850010,$20.00\nGelato,850011,$21.00\n';
const parsed = parseCsv(titled);
assert.deepEqual(parsed.headers, ['Product Name', 'SKU', 'Price']);
assert.equal(parsed.rows.length, 2);
assert.equal(parsed.headerRow, 3);
assert.equal(parsed.titleSkipped, true);
assert.equal(parseCsv(titled, { headerRow: 1 }).headers[0], 'November new products – for Grandma');
assert.equal(parseCsv('Name,SKU\nA,1\n').headerRow, 1);
assert.equal(findHeaderRow([['Only a title'], ['A', 'B', 'C'], ['1', '2', '3']]), 1);
assert.equal(findHeaderRow([['Name'], ['Blue Dream'], ['Gelato']]), 0, 'a one-column sheet keeps row 1');

// Row numbers in checks follow the headings.
setSpreadsheetHeaderRow(3);
assert.equal(spreadsheetRow(1), 4);
setSpreadsheetHeaderRow(1);
assert.equal(spreadsheetRow(12), 13);

(async () => {
  // A real .xlsx: rows read as Excel shows them, plain digits alongside for barcodes.
  globalThis.DOMParser = require('./mini-xml-dom.cjs').DOMParser;
  const { readXlsx } = require('../../src/lib/xlsx.ts');
  const file = require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures/formatted-numbers.xlsx'));
  const book = await readXlsx(new Uint8Array(file));
  assert.deepEqual(book.headers, ['Product Name', 'SKU', 'Package Tag', 'Price', 'Markup price', 'Units']);
  assert.deepEqual(book.rows[0], { 'Product Name': 'Blue Dream 3.5g', SKU: '850,010,000,001', 'Package Tag': '1A4FF0100000022000012345', Price: '$20.00', 'Markup price': '$2.68', Units: '1,234,567' });
  assert.deepEqual(book.rows[1], { 'Product Name': 'Gelato 41 3.5g', SKU: '012345678905', 'Package Tag': '1A4FF0100000022000012346', Price: '$1,234.50', 'Markup price': '$1.01', Units: '-' });
  assert.deepEqual(book.plainRows, [
    { SKU: '850010000001', Price: '20.00', 'Markup price': '2.68', Units: '1234567' },
    { Price: '1234.50', 'Markup price': '1.01', Units: '0' },
  ]);
  console.log('PASS spreadsheet import: Excel number formats and rounding, plain digits, title rows, header row choice, row numbers');
})().catch((error) => { console.error(error); process.exit(1); });
