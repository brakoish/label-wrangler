/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
require('../thermal/register.cjs');
const assert = require('node:assert/strict');
const { staticValuesForRun, sameValueRisks, sameValueRiskKey, scannableFieldNames, defaultScanField, scanLabelValues, scanCheckData, scanCanLookUpRow } = require('../../src/lib/runFieldSetup.ts');
const { checkRunData } = require('../../src/lib/runDataCheck.ts');
const { barcodeValueProblem, checkRunBarcodes, describeBarcodeIssue } = require('../../src/lib/barcodeCheck.ts');
const { friendlyFieldName, nextFieldName, spreadsheetRow } = require('../../src/lib/fieldLabels.ts');
const { printedBarcodeWidth, layoutProblems, freeSpot } = require('../../src/lib/designerLayout.ts');
const { readRunDraft, saveRunDraft, clearRunDraft } = require('../../src/lib/runDraft.ts');

const text = (fieldName, extra = {}) => ({ id: 'txt-' + fieldName, type: 'text', isStatic: false, fieldName, x: 0, y: 0, width: 300, height: 40, rotation: 0, zIndex: 1, fontSize: 10, lineHeight: 1.2, textAlign: 'left', ...extra });
const barcode = (fieldName, extra = {}) => ({ id: 'bc-' + fieldName, type: 'barcode', isStatic: false, fieldName, barcodeFormat: 'CODE128', showText: true, x: 0, y: 60, width: 300, height: 80, rotation: 0, zIndex: 2, ...extra });
const qr = (fieldName, extra = {}) => ({ id: 'qr-' + fieldName, type: 'qr', isStatic: false, fieldName, errorCorrection: 'M', x: 320, y: 0, width: 80, height: 80, rotation: 0, zIndex: 3, ...extra });

// ---------------------------------------------------------------------------
// BLOCKER 1: "Same on every label" must never carry row 1's value.
// ---------------------------------------------------------------------------
const rows = Array.from({ length: 20 }, (_, i) => ({ 'Product Name': `Flower ${i + 1}`, SKU: String(85001000000 + i), Size: '3.5g', 'Lab Results Link': `https://lab.example/${i + 1}` }));
const flower = { elements: [text('Product Name'), barcode('SKU'), qr('Lab Results Link'), text('Size', { id: 'size', y: 45 })] };
const fields = ['Product Name', 'SKU', 'Lab Results Link', 'Size'];

// A value typed for a field that now comes from a column is dropped when saving.
const mappings = { 'Product Name': { mode: 'column', csvColumn: 'Product Name' }, SKU: { mode: 'column', csvColumn: 'SKU' }, 'Lab Results Link': { mode: 'column', csvColumn: 'Lab Results Link' }, Size: { mode: 'static' } };
assert.deepEqual(staticValuesForRun(fields, mappings, { 'Product Name': 'Flower 1', SKU: '85001000000', 'Lab Results Link': 'https://lab.example/1', Size: '3.5g' }), { Size: '3.5g' });
// Missing mapping counts as "Same on every label" (manual runs).
assert.deepEqual(staticValuesForRun(['a'], {}, { a: 'x' }), { a: 'x' });

// Switching SKU to "Same on every label" with a SKU column that differs per row
// is flagged, with or without a typed value, and names the column.
const skuStatic = { ...mappings, SKU: { mode: 'static' } };
let risks = sameValueRisks({ fields, mappings: skuStatic, staticValues: {}, candidateColumns: { SKU: 'SKU', Size: 'Size' }, rows, scannableFields: scannableFieldNames(flower) });
assert.equal(risks.length, 1, 'only SKU: Size is the same on every row');
assert.equal(risks[0].field, 'SKU');
assert.equal(risks[0].everyRowDiffers, true);
assert.equal(risks[0].scannable, true);
assert.equal(risks[0].value, '', 'nothing is pre-filled');
risks = sameValueRisks({ fields, mappings: skuStatic, staticValues: { SKU: '123' }, candidateColumns: { SKU: 'SKU' }, rows });
assert.equal(risks[0].value, '123');
assert.notEqual(sameValueRiskKey(risks), sameValueRiskKey([{ ...risks[0], value: '124' }]), 'a confirmation covers only the value it was given for');
// One row: nothing to compare.
assert.equal(sameValueRisks({ fields, mappings: skuStatic, staticValues: {}, candidateColumns: { SKU: 'SKU' }, rows: rows.slice(0, 1) }).length, 0);

// With an empty "Same on every label" box the blank check fails instead of
// silently printing a value: the wizard checks only the saved static values.
const runData = { sourceData: rows, fieldMappings: skuStatic, staticValues: staticValuesForRun(fields, skuStatic, { Size: '3.5g' }) };
const check = checkRunData(flower, runData);
assert.equal(check.issues.length, 1);
assert.equal(check.issues[0].field, 'SKU');
assert.equal(check.issues[0].kind, 'no-value');

// ---------------------------------------------------------------------------
// BLOCKER 2: scan mode fills the chosen field and never reuses another row's
// per-label values.
// ---------------------------------------------------------------------------
// A run saved by an older build: row 1's values stored as static for column fields.
const oldRun = { staticValues: { 'Product Name': 'Flower 1', SKU: '85001000000', 'Lab Results Link': 'https://lab.example/1', Size: '3.5g' }, fieldMappings: mappings, sourceData: rows, mappedField: null };
assert.equal(defaultScanField(oldRun, flower, fields), 'SKU', 'defaults to the barcode field');
assert.equal(scanCanLookUpRow(oldRun, 'SKU'), true);
// Scanning product 7's SKU prints product 7's label.
let label = scanLabelValues(oldRun, fields, 'SKU', ' 85001000006 ');
assert.equal(label.matchedLabel, 7);
assert.deepEqual(label.values, { Size: '3.5g', SKU: '85001000006', 'Product Name': 'Flower 7', 'Lab Results Link': 'https://lab.example/7' });
assert.deepEqual(label.unfilled, []);
// An unknown SKU never borrows row 1's name or lab link.
label = scanLabelValues(oldRun, fields, 'SKU', '999');
assert.equal(label.matchedLabel, null);
assert.equal(label.values['Product Name'], undefined);
assert.equal(label.values['Lab Results Link'], undefined);
assert.deepEqual(label.unfilled.sort(), ['Lab Results Link', 'Product Name']);
// Scanning into a field that isn't a column: other per-label fields are blank
// in the up-front check (row 1's stale values don't count as filled).
const manualTarget = { ...oldRun, fieldMappings: { ...mappings, Size: { mode: 'static' } } };
let scanCheck = checkRunData(flower, scanCheckData(manualTarget, fields, 'Size'));
assert.deepEqual(scanCheck.issues.map((i) => i.field).sort(), ['Lab Results Link', 'Product Name', 'SKU']);
// With a look-up field, the other per-label fields count as filled.
scanCheck = checkRunData(flower, scanCheckData(oldRun, fields, 'SKU'));
assert.equal(scanCheck.issues.length, 0);
// A manual run: the scan fills its field, typed values fill the rest.
const manualRun = { staticValues: { 'Product Name': 'Blue Dream', Size: '3.5g', 'Lab Results Link': 'x' }, fieldMappings: {}, sourceData: [{}, {}], mappedField: null };
label = scanLabelValues(manualRun, fields, 'SKU', '42');
assert.deepEqual(label.values, { 'Product Name': 'Blue Dream', Size: '3.5g', 'Lab Results Link': 'x', SKU: '42' });
assert.equal(checkRunData(flower, scanCheckData(manualRun, fields, 'SKU')).issues.length, 0);

// ---------------------------------------------------------------------------
// Barcode values the barcode type can't hold fail by label and field.
// ---------------------------------------------------------------------------
assert.equal(barcodeValueProblem('CODE128', '85001000000'), null);
assert.match(barcodeValueProblem('CODE128', 'ABC-ÄÖ'), /can't hold \(Ä, Ö\)/);
assert.match(barcodeValueProblem('UPC', '12345'), /12 digits/);
assert.equal(barcodeValueProblem('UPC', '012345678905'), null);
assert.match(barcodeValueProblem('UPC', '012345678901'), /check digit/);
assert.match(barcodeValueProblem('CODE39', 'abc'), /capital letters/);
const badRows = rows.map((r, i) => (i === 9 ? { ...r, SKU: 'ABC-not-a-number-ÄÖ' } : r));
const bc = checkRunBarcodes(flower, { sourceData: badRows, fieldMappings: mappings, staticValues: {} });
assert.equal(bc.badLabels, 1);
assert.equal(bc.issues[0].label, 10);
assert.equal(describeBarcodeIssue(bc.issues[0], true), 'Label 10: the SKU "ABC-not-a-number-ÄÖ" has characters a barcode can\'t hold (Ä, Ö). Fix row 11 of your spreadsheet.');

// ---------------------------------------------------------------------------
// Friendly names, layout and drafts.
// ---------------------------------------------------------------------------
assert.equal(friendlyFieldName('package_tag'), 'Package tag');
assert.equal(friendlyFieldName('coa_url'), 'COA link');
assert.equal(friendlyFieldName('thc'), 'THC');
assert.equal(friendlyFieldName('thcPercent'), 'THC %');
assert.equal(friendlyFieldName('Product Name'), 'Product Name');
assert.equal(nextFieldName('text', [{ fieldName: 'Text 1' }]), 'Text 2');
assert.equal(nextFieldName('qr', []), 'QR code 1');
assert.equal(spreadsheetRow(18), 19);

// Code 128 is drawn in subset B at 2 dots a module (measured with the Zebra renderer).
assert.equal(printedBarcodeWidth('CODE128', '123456789'), 268);
assert.equal(printedBarcodeWidth('CODE128', '1A4FF0300000022000012345'), 598);
assert.equal(printedBarcodeWidth('CODE39', 'ABC123'), 254);
const format = { type: 'thermal', width: 2, height: 1, dpi: 203 };
const crowded = [text('name', { width: 380, height: 40, defaultValue: 'Lemon Cherry Gelato' }), barcode('tag', { y: 20, width: 200, defaultValue: '1A4FF0300000022000012345' })];
const problems = layoutProblems(crowded, format);
assert.ok(problems.some((p) => p.kinds.includes('off-label')), 'the long barcode runs off a 2" label');
assert.ok(problems.some((p) => p.kinds.includes('overlap') && /prints over the Name text/.test(p.message)), 'the barcode covers the name');
// One line per item, naming everything wrong with it.
assert.equal(problems.length, 1);
assert.equal(problems[0].message, 'The Tag barcode prints 2.95" wide for 24 characters, but only 2" fits from where it starts, so the printer cuts it off and it won’t scan, and prints over the Name text.');
assert.equal(problems[0].blocking, true);
assert.doesNotMatch(`${problems[0].message} ${problems[0].fix}`, /shorten/i);
assert.equal(layoutProblems([text('a', { width: 200 }), barcode('b', { x: 20, y: 100, height: 60, defaultValue: '123' })], format).length, 0);
assert.equal(layoutProblems([barcode('b', { x: 0, y: 100, height: 60, defaultValue: '123' })], format)[0].kind, 'barcode-tight', 'bars right at the edge are a warning, not a block');
// New items go into clear space.
const spot = freeSpot([{ x: 10, y: 10, width: 380, height: 40 }], { width: 100, height: 50 }, { width: 406, height: 203 }, 10);
assert.ok(spot.fits && spot.y >= 50, 'below the existing text');
assert.equal(freeSpot([{ x: 0, y: 0, width: 406, height: 203 }], { width: 100, height: 50 }, { width: 406, height: 203 }, 10).fits, false);

const store = new Map(); const storage = { setItem: (k, v) => store.set(k, v), getItem: (k) => store.get(k) ?? null, removeItem: (k) => store.delete(k) };
saveRunDraft({ name: 'Batch', templateId: 't', inputMode: 'csv', staticValues: {}, fieldMappings: {}, hiddenRunFields: [], pasteText: '', pasteField: null, csvHeaders: ['a'], csvRows: [{ a: '1' }], csvFileName: 'a.csv', manualQty: 1, savedAt: 1000 }, storage);
assert.equal(readRunDraft(storage, 2000).name, 'Batch');
assert.equal(readRunDraft(storage, 1000 + 25 * 3600 * 1000), null, 'old drafts are dropped');
clearRunDraft(storage);
assert.equal(readRunDraft(storage, 2000), null);

console.log('run field setup: ok');
