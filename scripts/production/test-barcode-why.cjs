/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
// The new run page's barcode "Why?" says what goes wrong and what to do in
// plain words: no inches, and a picture copy always says what it is.
require('../thermal/register.cjs');
const assert = require('node:assert/strict');
const { plainBarcodeWhy } = require('../../src/components/checks/barcodeWhy.ts');
const { barcodeWhyText, barcodePlainSentence } = require('../../src/lib/runBarcodeTicks.ts');

const why = (t) => plainBarcodeWhy(t, barcodeWhyText(t), barcodePlainSentence(t));
const cases = [
  'The Package Tag barcode on all 40 labels prints 2.95" wide for 24 characters but only 1.93" fits, so the printer cuts it off and it won’t scan. Make a picture copy of the design in the designer, which draws thinner bars that fit.',
  'The barcode on labels 3, 7 and 9 (rows 4, 8, 10) runs off the right edge of the label: its 1.6" of bars for 16 characters start where only 1.2" fits, so the printer cuts it off and it won’t scan. Move it in the design so the 1.6" of bars fit on the 2" label, make the barcode box at least 1.6" wide in the design or turn it sideways in the design.',
  'The barcode on all 40 labels prints 2.95" wide for 24 characters and runs onto the next label, so it won’t scan. It also prints over Batch, so that won’t scan either. Use a label at least 2.95" wide, or a QR code or make a picture copy of the design in the designer, which draws thinner bars that fit.',
  'The barcode needs a box at least 1.14" wide for 24 characters; its box is 0.8" wide, so it can’t be drawn. Make the barcode box at least 1.14" wide in the design.',
];
for (const t of cases) {
  const w = why(t);
  assert.ok(w, t);
  assert.doesNotMatch(w, /\d"/, `no inches: ${w}`);
  assert.match(w, /To fix it, /, w);
  if (/picture copy/.test(t)) assert.match(w, /“Make a picture copy”\. The copy prints the barcode with thinner bars/, w);
}
assert.match(why(cases[0]), /too many letters and numbers/);
assert.match(why(cases[1]), /start too far along/);
assert.match(why(cases[1]), /move it in the design so all of it sits on the label, make the barcode’s space wider in the design, or turn it sideways/);
// The plain sentence already says it covers Batch: not said twice.
assert.doesNotMatch(why(cases[2]), /prints over Batch/);
// Something it doesn't recognise keeps the measured words.
assert.equal(plainBarcodeWhy('Something new.', 'measured', ''), 'measured');

// A value too long for its barcode on some labels only is a problem with
// those rows (leave them out), not the design; on every label it is the design.
{
  const { longValueRows, isLongValueIssue } = require('../../src/components/checks/longValues.ts');
  const { longValueSentence, longValueReason } = require('../../src/components/checks/longValues.ts');
  const format = { id: 'f', name: 'f', type: 'thermal', width: 2, height: 1, dpi: 203, labelsAcross: 1 };
  const bar = { id: 'sku', type: 'barcode', fieldName: 'SKU', isStatic: false, barcodeFormat: 'CODE128', showText: true, x: 8, y: 60, width: 240, height: 80, rotation: 0, zIndex: 2 };
  const rows = Array.from({ length: 20 }, (_, i) => ({ SKU: `SKU-${100 + i}` }));
  rows[11] = { SKU: 'X'.repeat(40) };
  const run = { sourceData: rows, fieldMappings: { SKU: { mode: 'column', csvColumn: 'SKU' } }, staticValues: {} };
  const sheet = () => true;
  for (const mode of ['bitmap-v1', 'native-v1']) {
    const found = longValueRows({ elements: [bar], thermalRenderMode: mode }, format, run, sheet);
    assert.deepEqual(found.indexes, [11], mode);
    assert.equal(found.fields[0].longest, 40);
    assert.equal(found.fields[0].othersLongest, 7);
    assert.equal(found.stops, mode === 'bitmap-v1', mode);
    assert.ok(isLongValueIssue({ kind: 'too-long', field: 'SKU', label: 12, fit: { reason: mode === 'bitmap-v1' ? 'box-too-small' : 'off-label' } }, found));
    assert.ok(!isLongValueIssue({ kind: 'characters', field: 'SKU', label: 12, fit: { reason: 'characters' } }, found));
  }
  const found = longValueRows({ elements: [bar], thermalRenderMode: 'bitmap-v1' }, format, run, sheet);
  assert.equal(longValueSentence(found.fields[0], 20, (i) => i + 2), 'Label 12’s SKU (spreadsheet row 13) is too long for its barcode: 40 characters, where the other labels have 7 or fewer.');
  assert.equal(longValueReason(found.fields, 1, 20, true), 'Label 12’s SKU is too long for its barcode. Leave that label out or fix that row.');
  // Too long on every label: the design's problem, not listed.
  const allLong = { ...run, sourceData: rows.map(() => ({ SKU: 'X'.repeat(40) })) };
  assert.deepEqual(longValueRows({ elements: [bar], thermalRenderMode: 'bitmap-v1' }, format, allLong, sheet).indexes, []);
  // A typed value (not from the spreadsheet) is never a row problem.
  assert.deepEqual(longValueRows({ elements: [bar], thermalRenderMode: 'bitmap-v1' }, format, run, () => false).indexes, []);
}
console.log('barcode why: ok');
