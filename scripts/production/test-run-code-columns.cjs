/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
// The new-run wizard's barcode/QR columns and plain numbers: "Make the
// barcode change per label" picks the right column, example values are
// caught before Start, barcodes read the plain digits of formatted numbers,
// and "$" added by the design next to a "$20.00" cell is spotted.
require('../thermal/register.cjs');
const assert = require('node:assert/strict');
const c = require('../../src/lib/runCodeColumns.ts');

const headers = ['Product Name', 'SKU', 'Lab Results Link', 'Price'];
const rows = Array.from({ length: 20 }, (_, i) => ({ 'Product Name': `Flower ${i}`, SKU: String(85001000000 + i), 'Lab Results Link': `https://lab.example.com/coa/${i}`, Price: `$${20 + i}.00` }));

// The right column for each kind of code.
assert.equal(c.bestCodeColumn('barcode', headers, rows), 'SKU');
assert.equal(c.bestCodeColumn('qr', headers, rows), 'Lab Results Link');
assert.equal(c.bestCodeColumn('barcode', ['Name', 'Package Tag', 'COA'], [{ Name: 'a', 'Package Tag': '1A4FF0100000022000012345', COA: 'https://x.test/1' }]), 'Package Tag');
assert.equal(c.bestCodeColumn('barcode', ['Name', 'Item', 'Weight'], [{ Name: 'a', Item: 'GEL-0001', Weight: '3.5 g' }, { Name: 'b', Item: 'GEL-0002', Weight: '7 g' }]), 'Item', 'values that look like codes');
assert.equal(c.bestCodeColumn('barcode', ['Name', 'Notes'], [{ Name: 'a b', Notes: 'hello there' }]), null);

// A barcode left on the design's example value, with a SKU column in the file.
const template = { elements: [
  { id: 'bc', type: 'barcode', isStatic: true, content: '123456789', barcodeFormat: 'CODE128' },
  { id: 'qr', type: 'qr', isStatic: true, content: 'https://example.com' },
  { id: 'logo', type: 'qr', isStatic: true, content: 'https://shop.test/' },
  { id: 'name', type: 'text', isStatic: false, fieldName: 'Product Name' },
  { id: 'price', type: 'text', isStatic: false, fieldName: 'Price', prefix: '$' },
] };
const risks = c.exampleCodeRisks(template, headers, rows);
assert.deepEqual(risks.map((r) => [r.elementId, r.isExample, r.column]), [['bc', true, 'SKU'], ['qr', true, 'Lab Results Link']], 'a QR code with its own link is left alone');
assert.deepEqual(c.exampleCodeRisks({ elements: [{ id: 'own', type: 'barcode', isStatic: true, content: '0850001' }] }, headers, rows).map((r) => r.column), ['SKU'], 'a fixed barcode next to a SKU column');
assert.deepEqual(c.exampleCodeRisks(template, [], []).map((r) => r.elementId), ['bc', 'qr'], 'example values are caught when typing values too');
assert.equal(c.fieldNameForColumn('SKU', 'Barcode 1', ['Product Name']), 'SKU');
assert.equal(c.fieldNameForColumn('Product Name', 'Barcode 1', ['Product Name']), 'Barcode 1', 'a heading already used by another item');
assert.deepEqual(c.codeFieldTypes({ elements: [{ type: 'barcode', isStatic: false, fieldName: 'SKU' }, { type: 'text', isStatic: false, fieldName: 'Name' }] }), { SKU: 'barcode' });

// Plain numbers for barcodes, and for a field the person switched.
assert.equal(c.stripCurrency('$1,234.50'), '1234.50');
assert.equal(c.stripCurrency('-$5.00'), '-5.00');
assert.equal(c.stripCurrency('$ 20'), '20');
assert.equal(c.stripCurrency('20 dollars'), '20 dollars');
const excelRows = [{ SKU: '850,010,000,001', Price: '$20.00', Name: 'A' }, { SKU: '850,010,000,002', Price: '$1,234.50', Name: 'B' }];
const plainRows = [{ SKU: '850010000001', Price: '20.00' }, { SKU: '850010000002', Price: '1234.50' }];
const mappings = { SKU: { mode: 'column', csvColumn: 'SKU' }, 'SKU text': { mode: 'column', csvColumn: 'SKU' }, Price: { mode: 'column', csvColumn: 'Price' }, Name: { mode: 'column', csvColumn: 'Name' } };
const plain = c.applyPlainNumbers({ rows: excelRows, plainRows, mappings, plainFields: new Set(['SKU', 'Price']), currencyFields: new Set(['Price']) });
assert.equal(plain.mappings.SKU.csvColumn, 'SKU (plain number)');
assert.equal(plain.mappings['SKU text'].csvColumn, 'SKU', 'text bound to the same column keeps what Excel shows');
assert.equal(plain.rows[0]['SKU (plain number)'], '850010000001');
assert.equal(plain.rows[1]['Price (number only)'], '1234.50');
assert.equal(plain.rows[0].SKU, '850,010,000,001');
const csvPlain = c.applyPlainNumbers({ rows: excelRows.map(({ Price }) => ({ Price })), mappings, plainFields: new Set(['Price']), currencyFields: new Set(['Price']) });
assert.equal(csvPlain.rows[1]['Price (number only)'], '1234.50', 'a CSV drops the "$" by pattern');
const same = { rows: [{ SKU: '1' }], mappings: { SKU: { mode: 'column', csvColumn: 'SKU' } } };
const unchanged = c.applyPlainNumbers({ ...same, plainFields: new Set(['SKU']) });
assert.equal(unchanged.rows, same.rows, 'nothing to change: the same rows come back');
assert.equal(unchanged.mappings, same.mappings);

// "$" from the design next to "$20.00" from the file.
const doubled = c.doubledCurrencyRisks(template, { Price: { mode: 'column', csvColumn: 'Price' }, 'Product Name': { mode: 'column', csvColumn: 'Product Name' } }, rows);
assert.deepEqual(doubled, [{ field: 'Price', column: 'Price', symbol: '$', printed: '$$20.00', plain: '$20.00' }]);
assert.deepEqual(c.doubledCurrencyRisks(template, { Price: { mode: 'column', csvColumn: 'Price' } }, rows.map((r) => ({ ...r, Price: '20.00' }))), []);

console.log('PASS run code columns: best barcode/QR column, example values caught, plain numbers for barcodes, doubled currency spotted');

const { runSourceWords, columnSourceWords } = require('../../src/lib/fieldLabels.ts');
assert.equal(runSourceWords('csv').label, 'From a spreadsheet');
assert.deepEqual(columnSourceWords('csv', 'coa_url'), { text: 'From the spreadsheet column COA link', title: 'coa_url' });
assert.equal(columnSourceWords('csv', 'Price (plain number)').text, 'From the spreadsheet column Price (number only)');
assert.equal(columnSourceWords('manifest', 'packageTag').text, 'From Manifest: Package tag');
console.log('PASS run source words for the run page');
