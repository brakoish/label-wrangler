/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
// Round 14, area B: the barcode check's stops are exact (never decided from
// the capped list of problems), plus source checks for the run page and
// office panel fixes.
require('../thermal/register.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runPrintCheck, runSendCheck, printCheckAllows } = require('../../src/lib/runLayoutCheck.ts');
const { checkRunBarcodes } = require('../../src/lib/barcodeCheck.ts');

const format = { id: 'f', name: 'f', type: 'thermal', width: 3, height: 1, dpi: 203, labelsAcross: 1 };
const el = { id: 'b', type: 'barcode', x: 10, y: 10, width: 560, height: 120, rotation: 0, zIndex: 1, isStatic: false, fieldName: 'tag', content: '', barcodeFormat: 'CODE39', showText: false };
const template = { id: 't', name: 't', formatId: 'f', thermalRenderMode: 'bitmap-v1', elements: [el] };
const runOf = (rows) => ({ id: 'r', name: 'r', templateId: 't', sourceData: rows, totalLabels: rows.length, fieldMappings: { tag: { mode: 'column', csvColumn: 'tag' } }, staticValues: {}, mappedField: 'tag', dataSource: 'csv' });
const allowedWithTicks = (s) => printCheckAllows(s.check, { barcode: s.check.blockingKey, layout: s.check.layoutKey });

// Lowercase Code 39 prints (with a warning); a control character is refused by the exact renderer.
{
  const rows = [];
  for (let i = 1; i <= 3000; i++) rows.push({ tag: i === 10 ? 'AB\u0001C' : `ab${i}` });
  const run = runOf(rows);
  const base = runPrintCheck(run, template, format);
  assert.equal(base.verdict.stops, true);
  assert.deepEqual(base.stopLabels, [10]);
  const big = runSendCheck(base, run, template, format, { from: 1000, to: 1100 });
  assert.deepEqual(big.stopsHere, []);
  assert.equal(big.check.verdict.stops, false, 'a send of 101 printable labels is not stopped by label 10');
  assert.equal(allowedWithTicks(big), true, 'it goes ahead with "Print anyway"');
  const small = runSendCheck(base, run, template, format, { from: 1000, to: 1020 });
  assert.equal(allowedWithTicks(small), true);
  const withStop = runSendCheck(base, run, template, format, { from: 5, to: 15 });
  assert.deepEqual(withStop.stopsHere, [10]);
  assert.deepEqual(withStop.before, { from: 5, to: 9 });
  assert.equal(allowedWithTicks(withStop), false, 'a send that includes the refused label still stops');
}

// The reverse: a refused label past the first 50 printable problems is still found (never fails open).
{
  const rows = [];
  for (let i = 1; i <= 300; i++) rows.push({ tag: i === 80 ? 'AB\u0001C' : `ab${i}` });
  const run = runOf(rows);
  const found = checkRunBarcodes(template, run, format);
  assert.ok(found.issues.length <= 50, 'the display list stays capped');
  assert.deepEqual(found.stopLabels, [80], 'stops are counted in full');
  assert.ok(found.issues.some((issue) => issue.label === 80), 'the refused label is always in the list');
  const base = runPrintCheck(run, template, format);
  assert.equal(base.verdict.stops, true);
  assert.deepEqual(base.stopLabels, [80]);
  const send = runSendCheck(base, run, template, format, { from: 1, to: 120 });
  assert.deepEqual(send.stopsHere, [80]);
  assert.deepEqual(send.before, { from: 1, to: 79 });
  assert.equal(allowedWithTicks(send), false);
  const late = runSendCheck(base, run, template, format, { from: 81, to: 200 });
  assert.equal(allowedWithTicks(late), true);
  // Many refused labels: every one is counted, the list stays capped.
  const many = runOf(Array.from({ length: 400 }, (_, i) => ({ tag: i % 3 === 0 ? 'X\u0002' : `ab${i}` })));
  const all = checkRunBarcodes(template, many, format);
  assert.equal(all.stopLabels.length, 134);
  assert.ok(all.issues.length <= 50);
}

// A run saved as "printing" with nothing going reads as Ready (user.md 6).
{
  const { runDisplayStatus } = require('../../src/lib/runDisplayStatus.ts');
  const now = Date.parse('2026-11-11T12:00:00Z');
  const run = { status: 'printing', printedCount: 40, totalLabels: 120 };
  assert.equal(runDisplayStatus({ ...run, updatedAt: '2026-11-09T10:00:00Z' }, null, false, { now }).bucket, 'ready', 'nothing printing for days: Ready');
  assert.equal(runDisplayStatus({ ...run, updatedAt: '2026-11-09T10:00:00Z' }, null, false, { now }).detail, 'Partly printed');
  assert.equal(runDisplayStatus({ ...run, updatedAt: '2026-11-11T11:58:00Z' }, null, false, { now }).bucket, 'printing', 'progress moved a minute ago: still Printing');
  assert.equal(runDisplayStatus({ ...run, updatedAt: '2026-11-09T10:00:00Z' }, null, false, { now, printingHere: true }).bucket, 'printing', 'printing on this page');
  assert.equal(runDisplayStatus({ ...run, updatedAt: '2026-11-09T10:00:00Z' }, { sent: 0, onTheWay: 20, failed: 0 }, false, { now }).bucket, 'printing', 'labels at the office printer');
  assert.equal(runDisplayStatus(run, null, false, { now }).bucket, 'printing', 'no time to go by keeps the saved word');
}

// The run page's barcode "Why?" is plain words: no measurements, the picture copy explained (design.md 3).
{
  const { barcodeRunWhy } = require('../../src/lib/runBarcodeTicks.ts');
  const long = 'The SKU barcode on all 80 labels prints 3.38" wide for 28 characters but only 1.95" fits, so the printer cuts it off and it won’t scan. Make a picture copy of the design in the designer, which draws thinner bars that fit.';
  const why = barcodeRunWhy(long);
  assert.doesNotMatch(why, /\d"/, 'no inches');
  assert.doesNotMatch(why, /design it started with/);
  // Round 15 (#12): the wizard's one sentence for a long code, no picture-copy or new-run jargon.
  assert.equal(why, 'This code is too long to scan at this size. Print it as a QR code, or use a bigger label.');
  assert.doesNotMatch(why, /picture copy|new run with the same data/);
}

// Source checks: the office panel and run page fixes stay in place.
{
  const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
  const panel = read('src/components/runs/OfficePiPrinter.tsx');
  const printer = read('src/components/runs/RunPrinter.tsx');
  const nav = read('src/lib/printNavigation.ts');
  // #3: leaving after a part: the page's leave warning comes down before leave() runs.
  assert.match(nav, /leaveAfterSeries = leave;\s*stop\(true\);/);
  assert.match(nav, /const leave = leaveAfterSeries; leaveAfterSeries = null;/);
  // #4: a renewal of the same mark is not news; a duplicated tab id is replaced.
  assert.match(panel, /if\(m\.type==='taken' && m\.to===pageInstance\)\{pageTabId=newTabId\(\);/);
  assert.match(panel, /if\(nav\?\.type==='reload'\)id=sessionStorage\.getItem\('lw:tab-id'\)/);
  // #11: the queue is read again before "Send the last part"; nothing is offered until then.
  assert.match(panel, /const leftFresh=!!leftKey && leftReadFor===leftKey;/);
  // #8: the reason for a held Send is passed to the office panel.
  assert.match(printer, /: checkCurrent \? checksReason : ''\} printNote=\{checksOk \? characterNote : ''\}/);
  // #13: a refetch on coming back never runs while this page prints or has unsaved progress.
  assert.match(printer, /if \(pendingPatchCount\(runId\) > 0\) return;/);
  const list = read('src/app/runs/page.tsx');
  assert.match(list, /if \(written\.current\.has\(line\)\) continue;/, 'a retry never writes the same history line twice');
  assert.doesNotMatch(list, /type="checkbox" className="mt-0\.5 size-4/, 'the tick box uses the 44px .check target');
}

console.log('PASS run b14: barcode stops found in full; a printable send is never blocked by a refused label elsewhere, and a refused label past the list is never missed');
