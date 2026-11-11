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
console.log('barcode why: ok');
