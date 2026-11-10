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

console.log('PASS spreadsheet import: Excel number formats, title rows, header row choice, row numbers');
