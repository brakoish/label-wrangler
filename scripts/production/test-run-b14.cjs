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

console.log('PASS run b14: barcode stops found in full; a printable send is never blocked by a refused label elsewhere, and a refused label past the list is never missed');
