/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
require('../thermal/register.cjs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { generateZPL } = require('../../src/lib/zplGenerator.ts');
const { checkRunBarcodes, describeBarcodeIssue } = require('../../src/lib/barcodeCheck.ts');
const pc = require('../../src/lib/printerCharacters.ts');
const { designSampleValues, elementSample } = require('../../src/lib/sampleValues.ts');
const { font0Width, font0Wrap } = require('../../src/lib/zebraFont0.ts');
const { layoutProblems, printedBarcodeWidth } = require('../../src/lib/designerLayout.ts');

const fmt = { id: 'f', type: 'thermal', width: 2, height: 1, dpi: 203, lanes: 1, labelsAcross: 1 };
const sku = { id: 'b', type: 'barcode', isStatic: false, fieldName: 'SKU', x: 10, y: 100, width: 300, height: 60, rotation: 0, zIndex: 1, barcodeFormat: 'CODE128', showText: true };
const strain = { id: 't', type: 'text', isStatic: false, fieldName: 'strain', x: 10, y: 10, width: 380, height: 40, rotation: 0, zIndex: 2, fontSize: 10, lineHeight: 1.2, textAlign: 'left', prefix: 'Strain: ', content: 'Strain: Gelato' };
const fixed = { id: 's', type: 'text', isStatic: true, content: '1g · Hybrid', x: 10, y: 60, width: 380, height: 30, rotation: 0, zIndex: 3, fontSize: 8, lineHeight: 1.2, textAlign: 'left' };
const template = { id: 'tpl', name: 'Test', formatId: 'f', elements: [sku, strain, fixed] };
const mappings = { SKU: { mode: 'column', csvColumn: 'SKU' }, strain: { mode: 'column', csvColumn: 'Strain' } };
const rows = Array.from({ length: 20 }, (_, i) => ({ SKU: i === 11 ? '1234567890123456789012345678901234567890' : `85001000${i}`, Strain: i === 4 ? 'Café Haze' : `Strain ${i}` }));

// Printed bytes: the checks and preview samples only read; the ZPL for the
// same values is byte-identical before and after they run, and matches the
// pinned hash of the f33337f generator.
const values = { SKU: '850010003', strain: 'Gelato' };
const before = generateZPL(structuredClone(template), fmt, values);
const snapshot = structuredClone(template);
checkRunBarcodes(template, { sourceData: rows, fieldMappings: mappings }, fmt);
pc.checkRunPrinterCharacters(template, fmt, { sourceData: rows, fieldMappings: mappings });
designSampleValues(template.elements, {});
layoutProblems(template.elements, fmt, designSampleValues(template.elements, {}));
assert.deepEqual(template, snapshot, 'checks must not change the design');
assert.equal(generateZPL(template, fmt, values), before, 'printed bytes unchanged');
assert.equal(crypto.createHash('sha256').update(before).digest('hex'), 'a822d356257cc6e9a3a416a1112f55a3fc801e1a97e1df37855960d7f92b845c', 'ZPL matches the pinned bytes');

// Sample values: prefix never doubles; barcodes get a scannable placeholder.
assert.equal(elementSample(strain, {}), 'Gelato');
assert.equal(elementSample({ ...sku, content: undefined }, {}), '123456789');
assert.deepEqual(designSampleValues([strain, { ...strain, id: 't2', defaultValue: 'OG Kush' }], {}), { strain: 'OG Kush' });
assert.equal(designSampleValues([strain], { strain: 'Typed' }).strain, 'Typed');

// Printer characters.
assert.equal(pc.describeUnprintable(['·']), "The printer can't print · — use a plain dash.");
assert.equal(pc.describeUnprintable(['·', 'é']), "The printer can't print · or é — use a plain dash and e.");
assert.equal(pc.plainPrinterText('1g · Hybrid Café'), '1g - Hybrid Cafe');
assert.deepEqual(pc.unprintableCharacters('Gelato — 3.5g'), [], 'long dashes are converted by the generator');
const chars = pc.checkRunPrinterCharacters(template, fmt, { sourceData: rows, fieldMappings: mappings });
const said = chars.issues.map((i) => pc.describePrinterCharacterIssue(i, true));
assert.ok(said.includes('The text “1g · Hybrid” on every label: the printer can\'t print · — use a plain dash. Change it in the design.'), said.join('\n'));
assert.ok(said.includes("Label 5 (row 6), Strain: the printer can't print é — use e."), said.join('\n'));
assert.equal(pc.checkRunPrinterCharacters({ ...template, thermalRenderMode: 'bitmap-v1' }, fmt, { sourceData: rows, fieldMappings: mappings }).issues.length, 0, 'artwork labels draw their own text');

// Barcode too long for its box, by label, field and row, with the printer's width math.
const bc = checkRunBarcodes(template, { sourceData: rows, fieldMappings: mappings }, fmt);
const long = bc.issues.filter((i) => i.kind === 'too-long');
assert.equal(long.length, 1);
assert.match(describeBarcodeIssue(long[0], true), /^The SKU barcode on label 12 \(row 13\) prints 4\.68" wide for 40 characters, but only 1\.95" fits/);
assert.doesNotMatch(describeBarcodeIssue(long[0], true), /shorten/i);
assert.ok(printedBarcodeWidth({ ...sku }, rows[11].SKU, fmt) > 406 - 10, 'the long SKU really runs off a 2" label');
const artRows = rows.map((r, i) => (i === 11 ? { ...r, SKU: 'LEMON-CHERRY-GELATO-PREROLL-1G-BATCH-1102' } : r));
const art = checkRunBarcodes({ ...template, thermalRenderMode: 'bitmap-v1' }, { sourceData: artRows, fieldMappings: mappings }, fmt);
assert.match(describeBarcodeIssue(art.issues.find((i) => i.kind === 'too-long'), true), /use a wider label or a QR code/);

// Font 0 widths measured from the preview renderer.
assert.ok(Math.abs(font0Width('Gelato Pre-roll', 25) - 161) <= 2, 'measured 161 dots in the renderer');
assert.deepEqual(font0Wrap('Lemon Cherry Gelato', 150, 25), ['Lemon Cherry', 'Gelato']);

console.log('PASS what-you-see checks: printed bytes pinned, sample values, printer characters, too-long barcodes, font widths');
