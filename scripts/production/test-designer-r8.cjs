/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
// Designer, round 8: text over text is named (with "Fix it for me"), the
// save problem is said plainly, and the shared design is never changed by the checks.
require('../thermal/register.cjs');
const assert = require('node:assert/strict');
const { bitmapTextOverlaps, bitmapLayoutProblems } = require('../../src/lib/bitmapLayout.ts');
const { textAutoFix } = require('../../src/lib/barcodeAutoFix.ts');
const { designSaveProblem } = require('../../src/lib/userMessages.ts');
const { plainPrinterText, plainReplacement } = require('../../src/lib/printerCharacters.ts');

const format = { id: 'f', type: 'thermal', width: 2, height: 1, dpi: 203 };
const text = (id, fieldName, x, y, extra = {}) => ({ id, type: 'text', isStatic: false, fieldName, defaultValue: 'Sample', x, y, width: 120, height: 30, rotation: 0, zIndex: 1, fontSize: 20, fontFamily: 'Inter', fontWeight: 'normal', textAlign: 'left', ...extra });
const price = text('price', 'Price', 40, 40, { zIndex: 2, defaultValue: '$20.00' });
const packaged = text('packaged', 'Packaged', 90, 45, { defaultValue: '11/01/2026' });
const elements = [price, packaged];

const found = bitmapTextOverlaps(elements, format, {});
assert.equal(found.length, 1);
assert.deepEqual(found[0].ids, ['price', 'packaged'], 'named once, by the text on top');
assert.match(found[0].message, /covers/);
assert.equal(found[0].blocking, undefined, 'a warning, never a stop');
assert.equal(bitmapLayoutProblems(elements, format, {}).length, 0, 'the shared checks are unchanged');
assert.deepEqual(bitmapTextOverlaps([price, text('apart', 'Packaged', 40, 120)], format, {}), [], 'apart: nothing to say');
assert.deepEqual(bitmapTextOverlaps([price, text('touch', 'Packaged', 157, 40)], format, {}), [], 'a sliver of touching boxes is fine');

const fix = textAutoFix(elements, 'price', format, {}, true);
assert.ok(fix, 'there is room on a 2×1 label');
assert.equal(fix.label, 'Fix it for me');
assert.deepEqual(bitmapTextOverlaps(fix.elements, format, {}), [], 'after the fix nothing covers anything');
const moved = fix.elements.find((el) => el.id === 'price');
assert.equal(moved.width, price.width, 'moved, not resized');
assert.equal(elements[0].x, 40, 'the design passed in is not changed');
assert.equal(textAutoFix([{ ...price, locked: true }, packaged], 'price', format, {}, true), null, 'a locked item stays put');
console.log('PASS designer: text over text is named once, with a Fix it for me that moves it to a free spot');

assert.equal(designSaveProblem('Failed', []), 'Label Wrangler couldn’t save that just now.');
assert.match(designSaveProblem('Failed to fetch', []), /internet|connection|offline/i);
assert.match(designSaveProblem('This design was changed in another tab.', []), /another tab/);
assert.equal(plainPrinterText('1g · Hybrid'), '1g - Hybrid');
assert.equal(plainReplacement('·'), '-');
console.log('PASS designer: a failed save says why in plain words; "Replace with -" swaps the middle dot');

const BT = require('../../src/lib/runBarcodeTicks.ts');
// Round 9: "Why?" under an odd-character problem says only what is new.
{
  const item = 'Label 3: the SKU "café-é" has characters a barcode can\'t hold (é). Fix row 4 of your spreadsheet.';
  assert.equal(BT.barcodePlainSentence(item), 'Label 3: the SKU "café-é" has characters a barcode can\'t hold (é).');
  const why = BT.barcodeWhyText(item);
  assert.ok(!why.includes('café-é'), 'the sentence is not repeated behind Why?');
  assert.match(why, /^This barcode holds plain letters, numbers and everyday symbols only\. Fix row 4 of your spreadsheet\.$/);
  console.log('PASS run r9: Why? under a barcode problem adds only what the sentence did not say');
}
{
  // Round 10: the designer's office test print says "Sending…" while the first send is in flight,
  // never "We're not sure the office got your last test print" (that is only for after a reload or a real uncertain answer).
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/components/designer/OfficePreviewPrint.tsx'), 'utf8');
  assert.match(src, /\{pending && !busy && <p role="status"[^>]*>We’re not sure the office got your last test print/);
  assert.match(src, /\{busy \? 'Sending…'/);
  console.log('PASS designer r10: no "not sure" warning while a test print is still sending');
}
