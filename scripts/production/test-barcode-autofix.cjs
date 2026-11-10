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
// The other items are untouched, and the input is not changed. The number
// that printed under the bars stays readable, as text next to the QR code.
assert.deepEqual(qr.elements.filter((e) => e.id !== 'bc' && e.id !== 'bc-number'), flower.filter((e) => e.id !== 'bc'));
assert.equal(qr.keptText, true);
const number = qr.elements.find((e) => e.id === 'bc-number');
assert.equal(number.type, 'text');
assert.equal(number.fieldName, 'package_tag');
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

// A native QR code is drawn 10 dots below its origin and can be a version
// bigger than estimated: the one offered fits even then.
{
  const { zplQrGeometry } = require('../../src/lib/zplGenerator.ts');
  const q = qr.elements.find((e) => e.id === 'bc');
  const g = zplQrGeometry(tag, 'M', q.width);
  const top = q.y + Math.round((q.height - g.printedSize) / 2) + 10;
  assert.ok(top + (g.modules + 4) * g.magnification <= 203, 'room for the printer’s QR offset and a bigger version');
}

// Exact picture (bitmap) designs, the default for new designs, get the same offers.
{
  const { bitmapLayoutProblems, bitmapFootprint } = require('../../src/lib/bitmapLayout.ts');
  const exact = [
    text('t', 6, 6, 244, 36, 'Blue Dream 3.5g', 10),
    { ...base, id: 'b', type: 'barcode', x: 305, y: 48, width: 244, height: 51, zIndex: 2, content: '123456789', barcodeFormat: 'CODE128', showText: true },
    { ...base, id: 'q', type: 'qr', x: 258, y: 6, width: 81, height: 81, zIndex: 3, content: 'https://example.com', errorCorrection: 'M' },
  ];
  // Off the right edge and under the QR code: one plain line that says both.
  const problems = bitmapLayoutProblems(exact, fmt, {});
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /runs off the right edge of the label/);
  assert.match(problems[0].message, /QR code/);
  assert.match(barcodePlainSentence(problems[0].message), /^The barcode runs off the right edge of the label, so it can’t print/);
  const fix = barcodeAutoFix(exact, 'b', fmt, {}, true);
  assert.equal(fix && fix.kind, 'move');
  const box = bitmapFootprint(fix.elements.find((e) => e.id === 'b'), {});
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 406 && box.y + box.height <= 203, 'inside the label');
  assert.equal(bitmapLayoutProblems(fix.elements, fmt, {}).length, 0, 'lands on nothing');
  assert.equal(barcodeFit(fix.elements.find((e) => e.id === 'b'), '123456789', fmt, true).level, 'ok', 'the renderer draws it');
  assert.deepEqual(fix.elements.filter((e) => e.id !== 'b'), exact.filter((e) => e.id !== 'b'), 'nothing else moves');
  // A 40-character value can't fit across 2" at whole dots: a QR code that fits, inside the label.
  const long = 'ABCDEFGHIJ1234567890ABCDEFGHIJ1234567890';
  const inside = exact.map((e) => (e.id === 'b' ? { ...e, x: 6, content: long } : e));
  assert.equal(barcodeFit(inside[1], long, fmt, true).reason, 'box-too-small');
  assert.equal(barcodeAutoFix(inside, 'b', fmt, {}, true), null);
  const swap = barcodeToQr(inside, 'b', fmt, {}, true);
  assert.equal(swap && swap.kind, 'qr');
  const qbox = bitmapFootprint(swap.elements.find((e) => e.id === 'b'), {});
  assert.ok(qbox && qbox.x >= 0 && qbox.y >= 0 && qbox.x + qbox.width <= 406 && qbox.y + qbox.height <= 203, 'the QR code never runs off the label');
  assert.equal(bitmapLayoutProblems(swap.elements, fmt, {}).length, 0);
  // A barcode that fits but sits on the QR code: moved off it.
  const onQr = exact.map((e) => (e.id === 'b' ? { ...e, x: 150, y: 40, width: 150 } : e));
  assert.equal(barcodeFit(onQr[1], '123456789', fmt, true).level, 'ok');
  assert.ok(bitmapLayoutProblems(onQr, fmt, {}).some((p) => p.kinds.includes('overlap')));
  const off = barcodeAutoFix(onQr, 'b', fmt, {}, true);
  assert.equal(off && off.kind, 'move');
  assert.equal(bitmapLayoutProblems(off.elements, fmt, {}).length, 0);
  // Nothing to do: no offer.
  assert.equal(barcodeAutoFix(exact.map((e) => (e.id === 'b' ? { ...e, x: 6 } : e)), 'b', fmt, {}, true), null);
}

// Nothing is offered for locked items or sheets.
assert.equal(barcodeToQr(flower.map((e) => (e.id === 'bc' ? { ...e, locked: true } : e)), 'bc', fmt, values, false), null);
assert.equal(barcodeToQr(flower, 'bc', { ...fmt, type: 'sheet' }, values, false), null);

// Plain sentences: one per problem, the measurements kept for Why?.
const full = 'The Package tag barcode prints 2.95" wide for 24 characters but only 1.93" fits, so the printer cuts it off and it won’t scan, and prints over the COA link QR code and the Batch text, so the COA link QR code won’t scan either. Make a picture copy, which draws thinner bars that fit.';
assert.equal(barcodePlainSentence(full), 'The Package tag barcode is too wide for this label and covers the COA link QR code, so neither will scan.');
assert.ok(!/\d"/.test(barcodePlainSentence(full)), 'no measurements in the sentence');
assert.equal(PRINT_ANYWAY, 'Print anyway');
assert.equal(barcodeTickLabel('anything'), PRINT_ANYWAY);
// A tick that covers more than one label says how many.
assert.equal(barcodeTickLabel('The Metrc barcode on all 20 labels prints 2.1″ wide.'), 'Print all 20 anyway');
assert.equal(barcodeTickLabel('The Metrc barcode on both labels prints 2.1″ wide.'), 'Print both anyway');
assert.equal(barcodeTickLabel('The Metrc barcode on labels 1, 3, 5 and 17 more (rows 2, 4, 6…) prints 2.1″ wide.'), 'Print these 20 anyway');
assert.equal(barcodeTickLabel('The Metrc barcode on label 7 (row 8) prints 2.1″ wide.'), 'Print anyway');
assert.equal(FIX_IN_DESIGNER, 'Open in designer');
assert.match(barcodeWaitWords(false, 1), /tick “Print anyway”/);
assert.match(barcodeWaitWords(true, 1), /can’t print/);
assert.ok(!/list|above|below/i.test(barcodeWaitWords(false, 3)), 'never points to a list');

// Wizard, run page and designer draw the same warning and name the same fix.
assert.match(read('src/app/runs/new/page.tsx'), /<BarcodeWarning/);
// The run page uses the shared sentence and "Why?" (its ticks name the labels each send covers).
assert.match(read('src/components/runs/RunBarcodeCheck.tsx'), /import \{ FixInDesignerLink, WhyToggle \} from '@\/components\/checks\/BarcodeWarning';/);
assert.match(read('src/components/designer/DesignNotice.tsx'), /barcodePlainSentence/);
assert.match(read('src/app/designer/page.tsx'), /barcodeAutoFix\(/);

// The new-run page offers the same fixes, checked on every label of the run:
// a 24-character tag across 2" gets a QR code sized for the longest value.
{
  const { runBarcodeFixes } = require('../../src/lib/runBarcodeFix.ts');
  const { checkRunBarcodes } = require('../../src/lib/barcodeCheck.ts');
  const t = { elements: flower, thermalRenderMode: 'native-v1' };
  const long = 'https://example.com/coa/1234567890abcdefghij';
  const run = { sourceData: [{ Tag: tag, COA: 'https://example.com/coa/1' }, { Tag: tag + 'X', COA: long }], fieldMappings: { package_tag: { mode: 'column', csvColumn: 'Tag' }, coa_url: { mode: 'column', csvColumn: 'COA' } }, staticValues: {} };
  const check = checkRunBarcodes(t, run, fmt);
  assert.ok(check.issues.length > 0);
  const fixes = runBarcodeFixes(t, run, fmt, check.issues);
  assert.ok(fixes && !fixes.fix && fixes.qr, 'the QR swap is offered');
  const after = { ...t, elements: fixes.qr.elements };
  assert.equal(checkRunBarcodes(after, run, fmt).issues.length, 0, 'nothing left on any label');
  assert.deepEqual(fixes.qr.elements.filter((e) => e.id !== 'bc' && e.id !== 'bc-number'), flower.filter((e) => e.id !== 'bc'), 'only that barcode changes (and its number stays as text)');
  // A short code hanging off the edge on one row is moved, and checked on all.
  const short = { elements: [{ ...flower[2], id: 'b3', x: 250, width: 150 }], thermalRenderMode: 'native-v1' };
  const shortRun = { sourceData: [{ Tag: 'LCG1' }, { Tag: 'LCG1102' }], fieldMappings: { package_tag: { mode: 'column', csvColumn: 'Tag' } }, staticValues: {} };
  const shortCheck = checkRunBarcodes(short, shortRun, fmt);
  assert.ok(shortCheck.issues.length > 0);
  const moveFix = runBarcodeFixes(short, shortRun, fmt, shortCheck.issues);
  assert.equal(moveFix && moveFix.fix && moveFix.fix.kind, 'move');
  assert.equal(checkRunBarcodes({ ...short, elements: moveFix.fix.elements }, shortRun, fmt).issues.length, 0);
  // Nothing offered for a value problem.
  assert.equal(runBarcodeFixes(short, shortRun, fmt, [{ field: 'package_tag', label: 1, value: 'é', problem: 'x', kind: 'characters', elementId: 'b3' }]), null);
}

const pending = [];
// "Use a QR code instead" on a small Metrc label (1" × 0.5"): the tag number
// stays on the label as text, the whole box on the label and landing on
// nothing, and the fix says the QR code prints under the size phones like.
{
  const { QR_SCAN_INCHES } = require('../../src/lib/barcodeAutoFix.ts');
  const small = { id: 's', name: '1x0.5', type: 'thermal', width: 1, height: 0.5, dpi: 203, labelsAcross: 1 };
  const metrc = [{ ...base, id: 'tag', type: 'barcode', x: 6, y: 20, width: 180, height: 40, zIndex: 1, isStatic: false, fieldName: 'tag', defaultValue: tag, content: tag, barcodeFormat: 'CODE128', showText: true }];
  for (const bitmap of [false, true]) {
    const fix = barcodeToQr(metrc, 'tag', small, { tag }, bitmap);
    assert.ok(fix && fix.keptText && !fix.droppedText, `${bitmap ? 'exact' : 'printer font'}: the tag number stays`);
    assert.ok(fix.qrInches < QR_SCAN_INCHES, 'the QR code prints under the size phones like, and the fix says how big');
    const text = fix.elements.find((e) => e.type === 'text');
    assert.ok(text.x >= 0 && text.y >= 0 && text.x + text.width <= 203 && text.y + text.height <= 101, 'the number’s whole box is on the label');
    assert.ok(text.fontSize >= 4);
    if (!bitmap) assert.equal(layoutProblems(fix.elements, small, { tag }).length, 0, 'lands on nothing');
  }
  // A barcode that printed no number gets none.
  const bare = barcodeToQr([{ ...metrc[0], showText: false }], 'tag', small, { tag }, false);
  assert.ok(bare && !bare.keptText && !bare.droppedText && bare.elements.length === 1);
  // The exact renderer draws the QR code and the number (no "overflows its box").
  const { renderThermalBitmap } = require('../../src/lib/thermal/render.server.ts');
  const exactFix = barcodeToQr(metrc, 'tag', small, { tag }, true);
  pending.push(renderThermalBitmap({ id: 'm', name: 'm', formatId: 's', thermalRenderMode: 'bitmap-v1', elements: exactFix.elements }, small, { tag }));
  const wideFix = barcodeToQr(metrc, 'tag', fmt, { tag }, true);
  pending.push(renderThermalBitmap({ id: 'm2', name: 'm2', formatId: 'f', thermalRenderMode: 'bitmap-v1', elements: wideFix.elements }, fmt, { tag }));
}

// An exact-picture design whose barcode can't hold a spreadsheet value (é in
// a Code 128) can't print that label: the way out offered here is a QR code,
// which holds any text (besides leaving the label out or fixing the row).
{
  const { runBarcodeFixes } = require('../../src/lib/runBarcodeFix.ts');
  const { checkRunBarcodes } = require('../../src/lib/barcodeCheck.ts');
  const { barcodeIssueStops } = require('../../src/lib/runLayoutCheck.ts');
  const sku = [{ ...base, id: 'sku', type: 'barcode', x: 14, y: 60, width: 300, height: 70, zIndex: 1, isStatic: false, fieldName: 'sku', defaultValue: '1002003004', content: '1002003004', barcodeFormat: 'CODE128', showText: true }];
  const exact = { elements: sku, thermalRenderMode: 'bitmap-v1' };
  const run = { sourceData: [{ SKU: '1002003004' }, { SKU: '1002003004é2' }], fieldMappings: { sku: { mode: 'column', csvColumn: 'SKU' } }, staticValues: {} };
  const check = checkRunBarcodes(exact, run, fmt);
  assert.ok(check.issues.some((issue) => issue.kind === 'characters' && barcodeIssueStops(issue, fmt)), 'the exact renderer refuses é');
  const fixes = runBarcodeFixes(exact, run, fmt, check.issues);
  assert.ok(fixes && !fixes.fix && fixes.qr, 'a QR code is offered');
  assert.equal(checkRunBarcodes({ ...exact, elements: fixes.qr.elements }, run, fmt).issues.length, 0, 'nothing left after it');
  // A printer-font design prints it anyway (the tick); no swap is pushed there.
  assert.equal(runBarcodeFixes({ ...exact, thermalRenderMode: 'native-v1' }, run, fmt, checkRunBarcodes({ ...exact, thermalRenderMode: 'native-v1' }, run, fmt).issues), null);
}

// A barcode close to the edge that also prints over something: the edge is
// said once (in "Barcodes close to the edge"), the overlap here.
{
  const { runLayoutIssues } = require('../../src/lib/runLayoutCheck.ts');
  const near = [
    { ...base, id: 'b', type: 'barcode', x: 2, y: 40, width: 300, height: 60, zIndex: 1, isStatic: true, content: '100200300403', barcodeFormat: 'CODE128', showText: true },
    { ...base, id: 'q', type: 'qr', x: 200, y: 30, width: 90, height: 90, zIndex: 2, isStatic: true, content: 'https://example.com/x', errorCorrection: 'M' },
  ];
  assert.equal(barcodeFit(near[0], '100200300403', fmt, false).level, 'tight');
  const issues = runLayoutIssues({ sourceData: [{}], fieldMappings: {}, staticValues: {} }, { elements: near, thermalRenderMode: 'native-v1' }, fmt, 1);
  assert.equal(issues.length, 1);
  assert.doesNotMatch(issues[0], /edge/);
  assert.match(issues[0], /prints over the QR code/);
}

// Round 12: printer-font bars hanging off the bottom (or off two edges) get the
// same "Fix it for me" as exact-picture ones, and the note names every edge.
{
  const short = (x, y) => [{ ...flower[2], id: 'nb', x, y, width: 150, content: 'LCG1102', defaultValue: 'LCG1102' }];
  for (const mode of [false, true]) {
    const bottom = short(14, 170);
    const p = (mode ? require('../../src/lib/bitmapLayout.ts').bitmapLayoutProblems(bottom, fmt, {}) : layoutProblems(bottom, fmt, {})).find((q) => q.ids[0] === 'nb');
    assert.ok(p, `${mode ? 'exact' : 'printer font'}: bars off the bottom are a problem`);
    assert.match(p.message, /bottom edge/);
    const fix = barcodeAutoFix(bottom, 'nb', fmt, {}, mode);
    assert.equal(fix && fix.kind, 'move', `${mode ? 'exact' : 'printer font'}: Fix it for me moves it back on`);
    assert.equal(fix.label, 'Fix it for me');
    assert.equal(fix.done, 'Moved the barcode so it fits on the label.');
    const after = mode ? require('../../src/lib/bitmapLayout.ts').bitmapLayoutProblems(fix.elements, fmt, {}) : layoutProblems(fix.elements, fmt, {});
    assert.equal(after.filter((q) => q.ids.includes('nb')).length, 0, 'clean after the fix');
  }
  // Off the right and the bottom: both edges named, and still fixable.
  const corner = short(330, 170);
  const cp = layoutProblems(corner, fmt, {}).find((q) => q.ids[0] === 'nb');
  assert.ok(cp && cp.edges && cp.edges.includes('right') && cp.edges.includes('bottom'), 'both edges recorded');
  const { withAllEdges } = require('../../src/lib/designerLayout.ts');
  assert.match(withAllEdges('The SKU barcode runs off the right edge of the label, so it won’t scan.', cp.edges), /off the right and bottom edges of the label/);
  assert.equal(barcodeAutoFix(corner, 'nb', fmt, {}, false)?.kind, 'move');
}

Promise.all(pending).then(() => console.log('PASS barcode autofix: move, widen, turn or QR swap only when it prints whole and lands on nothing, for printer-font and exact-picture designs; plain sentences, one Print anyway, one Open in designer'), (error) => { console.error(error); process.exit(1); });
