/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
// "Fix it for me" in the designer and the plain barcode sentences shared by
// the new-run check, the run page and the designer.
require('../thermal/register.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { barcodeAutoFix, barcodeToQr } = require('../../src/lib/barcodeAutoFix.ts');
const { barcodeFit } = require('../../src/lib/barcodeFit.ts');
const { layoutProblems } = require('../../src/lib/designerLayout.ts');
const { barcodePlainSentence, barcodeWaitWords, barcodeTickLabel, PRINT_ANYWAY, FIX_IN_DESIGNER } = require('../../src/lib/runBarcodeTicks.ts');
const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');

const fmt = { id: 'f', name: '2x1', type: 'thermal', width: 2, height: 1, dpi: 203, labelsAcross: 1, labelGap: 0.125 };
const base = { rotation: 0, isStatic: true };
const text = (id, x, y, w, h, content, fontSize, extra = {}) => ({ ...base, id, type: 'text', x, y, width: w, height: h, zIndex: 1, content, fontSize, fontFamily: 'Arial', fontWeight: 'normal', textAlign: 'left', color: '#000000', lineHeight: 1.2, ...extra });
const tag = '1A4FF0300000022000012345';
const flower = [
  text('title', 14, 8, 378, 28, 'Lemon Cherry Gelato', 12, { fontWeight: 'bold' }),
  { ...base, id: 'qr', type: 'qr', x: 290, y: 42, width: 100, height: 100, zIndex: 2, content: 'https://example.com/coa/1', errorCorrection: 'M', isStatic: false, fieldName: 'coa_url', defaultValue: 'https://example.com/coa/1' },
  { ...base, id: 'bc', type: 'barcode', x: 14, y: 132, width: 260, height: 50, zIndex: 3, content: tag, barcodeFormat: 'CODE128', showText: true, isStatic: false, fieldName: 'package_tag', defaultValue: tag },
];
const values = {};

// A 24-character tag can't fit across 2": no move or turn fixes it, but a
// QR code with the same value does, in a clean spot, keeping the field.
assert.equal(barcodeFit(flower[2], tag, fmt, false).level, 'blocked');
assert.equal(barcodeAutoFix(flower, 'bc', fmt, values, false), null);
const qr = barcodeToQr(flower, 'bc', fmt, values, false);
assert.ok(qr, 'a QR code fits where the barcode was');
assert.equal(qr.kind, 'qr');
const swapped = qr.elements.find((e) => e.id === 'bc');
assert.equal(swapped.type, 'qr');
assert.equal(swapped.fieldName, 'package_tag');
assert.equal(swapped.defaultValue, tag);
assert.ok(swapped.x >= 0 && swapped.y >= 0 && swapped.x + swapped.width <= 406 && swapped.y + swapped.height <= 203, 'inside the label');
assert.ok(!layoutProblems(qr.elements, fmt, values).some((p) => p.ids.includes('bc') && (p.blocking || p.kinds.includes('overlap'))), 'lands on nothing');
// The other items are untouched, and the input is not changed.
assert.deepEqual(qr.elements.filter((e) => e.id !== 'bc'), flower.filter((e) => e.id !== 'bc'));
assert.equal(flower[2].type, 'barcode');

// A short code that hangs off the right edge is moved back so its bars fit.
const offEdge = [{ ...flower[2], id: 'b2', x: 300, content: 'LCG1102', defaultValue: 'LCG1102', width: 200 }];
const offFit = barcodeFit(offEdge[0], 'LCG1102', fmt, false);
assert.equal(offFit.level, 'blocked');
const moved = barcodeAutoFix(offEdge, 'b2', fmt, values, false);
assert.equal(moved && moved.kind, 'move');
const fixed = moved.elements[0];
assert.notEqual(barcodeFit(fixed, 'LCG1102', fmt, false).level, 'blocked', 'prints whole after the fix');
assert.equal(fixed.content, 'LCG1102');
assert.equal(fixed.y, offEdge[0].y, 'moved along its length only');

// Nothing is offered for exact (bitmap) designs, locked items or sheets.
assert.equal(barcodeAutoFix(flower, 'bc', fmt, values, true), null);
assert.equal(barcodeToQr(flower, 'bc', fmt, values, true), null);
assert.equal(barcodeToQr(flower.map((e) => (e.id === 'bc' ? { ...e, locked: true } : e)), 'bc', fmt, values, false), null);
assert.equal(barcodeToQr(flower, 'bc', { ...fmt, type: 'sheet' }, values, false), null);

// Plain sentences: one per problem, the measurements kept for Why?.
const full = 'The Package tag barcode prints 2.95" wide for 24 characters but only 1.93" fits, so the printer cuts it off and it won’t scan, and prints over the COA link QR code and the Batch text, so the COA link QR code won’t scan either. Make an exact-print copy, which draws thinner bars that fit.';
assert.equal(barcodePlainSentence(full), 'The Package tag barcode is too wide for this label and covers the COA link QR code, so neither will scan.');
assert.ok(!/\d"/.test(barcodePlainSentence(full)), 'no measurements in the sentence');
assert.equal(PRINT_ANYWAY, 'Print anyway');
assert.equal(barcodeTickLabel('anything'), PRINT_ANYWAY);
assert.equal(FIX_IN_DESIGNER, 'Fix in the designer');
assert.match(barcodeWaitWords(false, 1), /tick “Print anyway”/);
assert.match(barcodeWaitWords(true, 1), /can’t print/);
assert.ok(!/list|above|below/i.test(barcodeWaitWords(false, 3)), 'never points to a list');

// Wizard, run page and designer draw the same warning and name the same fix.
assert.match(read('src/app/runs/new/page.tsx'), /<BarcodeWarning/);
assert.match(read('src/components/runs/RunBarcodeCheck.tsx'), /<BarcodeWarning/);
assert.match(read('src/components/designer/DesignNotice.tsx'), /barcodePlainSentence/);
assert.match(read('src/app/designer/page.tsx'), /barcodeAutoFix\(/);

console.log('PASS barcode autofix: QR swap or move only when it prints whole and lands on nothing; plain sentences, one Print anyway, one Fix in the designer');
