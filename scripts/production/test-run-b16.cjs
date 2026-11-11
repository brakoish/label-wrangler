/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
// Round 16, area B: saved parts trimmed by every counted label, one series
// across tabs, the QR link, the end blank after a refused last label, the
// glyph stop's words and barcode text, the go-back after a rollback, the
// run holding the printer, the dots, and printed islands.
require('../thermal/register.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// #1: "Send the last part" leaves out labels scanned (or confirmed) meanwhile, not only contiguous progress.
{
  const { partsAfterCounted } = require('../../src/lib/runGaps.ts');
  const { printedSpans, stillToGo } = require('../../src/lib/runProgress.ts');
  const total = 2000;
  const toGo = stillToGo(printedSpans(100, [{ from: 1501, to: 1600 }], total), total);
  assert.deepEqual(partsAfterCounted([{ from: 1501, to: 2000 }], 100, toGo), { parts: [{ from: 1601, to: 2000 }], trimmed: [{ from: 1501, to: 1600 }] }, 'scanned 1501–1600 are never resent');
  assert.deepEqual(partsAfterCounted([{ from: 1, to: 500 }], 0, [{ from: 1, to: 100 }, { from: 201, to: 500 }]), { parts: [{ from: 1, to: 100 }, { from: 201, to: 500 }], trimmed: [{ from: 101, to: 200 }] }, 'a printed island splits a part');
  assert.deepEqual(partsAfterCounted([{ from: 1001, to: 1500 }], 1200), { parts: [{ from: 1201, to: 1500 }], trimmed: [{ from: 1001, to: 1200 }] }, 'without the counted list: progress only, as before');
  assert.deepEqual(partsAfterCounted([{ from: 1, to: 10 }], 0, []), { parts: [], trimmed: [{ from: 1, to: 10 }] }, 'all counted: nothing offered');
  const panel = read('src/components/runs/OfficePiPrinter.tsx');
  assert.doesNotMatch(panel, /partsAfterPrinted\(/, 'the panel trims with the counted labels only');
  assert.match(panel, /partsAfterCounted\(left,printedCount,toGoSpans\)/, 'the offered "send the rest" uses the same count');
}

// #2: one series across tabs: a shared mark under the send lock; the other tab offers nothing that sends.
{
  const panel = read('src/components/runs/OfficePiPrinter.tsx');
  assert.match(panel, /lw:office-series:\$\{runId\}/);
  const series = panel.slice(panel.indexOf('const runSeries=async'), panel.indexOf('const startSeries=async'));
  assert.match(series, /withOfficeSendLock\(/, 'the series claims under the per-run send lock');
  assert.match(panel, /Sending part \$\{[^}]+\} of \$\{[^}]+\}[^`]*from another tab/, 'the other tab says what is happening');
  assert.match(panel, /const seriesElsewhere=!series && !!otherSeries/);
  assert.match(panel, /const showForm=\(!!pending && !seriesElsewhere\)/, 'no send form while another tab sends a series');
  assert.match(panel, /sent from another tab or device\. Nothing was sent twice\./, 'an overlap refusal mid-series says what happened');
  assert.match(panel, /if\(seriesRunning\.current\)return;|seriesRunning\.current\)\s*return/, 'a running series never takes another tab’s range');
}

// #3: the QR link is explicit (no clock), and the cancel needs the old run to exist and not print.
{
  const { readQrReplaces, readQrReplacedBy, qrOldRunOpen } = require('../../src/lib/runQrLink.ts');
  const store = (data) => ({ getItem: (k) => (k in data ? data[k] : null), key: (i) => Object.keys(data)[i] ?? null, get length() { return Object.keys(data).length; } });
  const s = store({ 'lw:qr-replaces:new-1': 'old-1', 'lw:qr-replaces:new-2': '{"id":"old-2"}', 'lw:qr-replaces:new-3': 'new-3', 'lw:qr-replaces:new-4': 'bad id!', 'other': 'old-1' });
  assert.equal(readQrReplaces(s, 'new-1'), 'old-1', 'a plain id');
  assert.equal(readQrReplaces(s, 'new-2'), 'old-2', 'an {id} record');
  assert.equal(readQrReplaces(s, 'new-3'), null, 'never itself');
  assert.equal(readQrReplaces(s, 'new-4'), null);
  assert.equal(readQrReplaces(s, 'none'), null, 'no link: no offer');
  assert.deepEqual(readQrReplacedBy(s, 'old-1'), ['new-1']);
  assert.deepEqual(readQrReplacedBy(s, 'old-9'), []);
  assert.equal(qrOldRunOpen({ status: 'queued', printedCount: 0, totalLabels: 10 }), true);
  assert.equal(qrOldRunOpen({ status: 'paused', printedCount: 4, totalLabels: 10 }), true);
  assert.equal(qrOldRunOpen({ status: 'printing', printedCount: 4, totalLabels: 10 }), false, 'never while printing');
  assert.equal(qrOldRunOpen({ status: 'completed', printedCount: 10, totalLabels: 10 }), false);
  assert.equal(qrOldRunOpen({ status: 'cancelled', printedCount: 0, totalLabels: 10 }), false);
  assert.equal(qrOldRunOpen(null), false, 'a missing run offers nothing');
  const qr = read('src/components/runs/QrReplaced.tsx');
  assert.doesNotMatch(qr, /FROM_WINDOW|createdAt|Date\.now\(\)|sessionStorage/, 'no clock guess');
  assert.doesNotMatch(read('src/components/runs/RunPrinter.tsx'), /markQrFrom/);
}

// #4: USB: a typed printed range prints again without rewinding; "Move start to N" moves the boxes (checked on the next press).
{
  const printer = read('src/components/runs/RunPrinter.tsx');
  assert.match(printer, /if \(plan\.rewind && selectedThrough <= printedCount\) \{[\s\S]{0,900}The run’s progress stays at[\s\S]{0,600}handleReprintRange\(\{ from: startFrom, to: selectedThrough \}, 'reprint'\)/);
  // "Move start to N" moves the boxes and stops, so the next press checks labels N on before anything prints.
  assert.match(printer, /if \(choice === 'confirm'\) \{ setFromDraft\(String\(skipped\.from\)\); setCountDraft\(null\); return; \}/);
  assert.match(printer, /confirmLabel: `Move start to \$\{skipped\.from\}`/);
  assert.match(printer, /selectedThrough <= printedCount \? `Print \$\{/);
}

// #5: a refused last label moves the end blank to the new last send, and says so.
{
  const panel = read('src/components/runs/OfficePiPrinter.tsx');
  const start = panel.slice(panel.indexOf('const startSeries=async'), panel.indexOf('// Leaving the page mid-series'));
  assert.match(start, /The blank label you asked for comes after label \$\{newLast\.toLocaleString\(\)\} instead\./);
  assert.match(start, /if\(blankMoves\)blankAt=newLast;/);
}

// #6, #9: glyph stop words; barcode human-readable text is checked like a text.
{
  const { checkRunBitmapGlyphs, glyphStopWords } = require('../../src/lib/runGlyphs.ts');
  const run = { sourceData: [{ SKU: 'ABC-1' }, { SKU: 'ABC★2' }], fieldMappings: { sku: { mode: 'column', csvColumn: 'SKU' } } };
  const barcode = { id: 'b', type: 'barcode', fieldName: 'sku', showText: true, fontFamily: 'Liberation Serif', fontWeight: 'bold' };
  const t = { elements: [barcode], thermalRenderMode: 'bitmap-v1' };
  // A value the barcode can't hold (★ in a Code 128) is the barcode check's to name, never twice.
  assert.deepEqual(checkRunBitmapGlyphs(t, { type: 'thermal' }, run).labels, [], 'the barcode check owns a value the barcode cannot hold');
  const holds = { elements: [{ ...barcode, barcodeFormat: 'QR' }], thermalRenderMode: 'bitmap-v1' };
  assert.deepEqual(checkRunBitmapGlyphs(holds, { type: 'thermal' }, run).labels, [2], 'the line under a barcode is drawn too');
  assert.deepEqual(checkRunBitmapGlyphs({ ...t, elements: [{ ...barcode, showText: false }] }, { type: 'thermal' }, run).labels, [], 'no text line: nothing drawn');
  const check = checkRunBitmapGlyphs(holds, { type: 'thermal' }, run);
  assert.equal(glyphStopWords(check, [2], () => true), 'Label 2 (row 3 in your file) has “★” in SKU, which can’t be drawn, so it can’t print.');
  assert.doesNotMatch(glyphStopWords(check, [2], () => false), /row|spreadsheet/);
  const printer = read('src/components/runs/RunPrinter.tsx');
  assert.match(printer, /glyphStop \? '' : shownCheck\.blocking\.length/, 'the sentence shows once (not again by Send)');
  assert.match(printer, /glyphStop && baseDisplay\.bucket === 'ready'/, 'the header says Needs you, not Ready');
  assert.match(printer, /setPreviewIndex\(firstGlyphLabel - 1\)/, 'the preview jumps to the bad label');
}

// #7: a go-back the server refused (rollback) isn't offered again; one line says so.
{
  const printer = read('src/components/runs/RunPrinter.tsx');
  assert.match(printer, /lw:go-back-refused/);
  assert.match(printer, /Going back to an earlier label can’t be done right now\. Nothing was changed\./);
  assert.doesNotMatch(printer, /This page is out of date/, 'no reload loop');
  assert.match(printer, /if \(plan\.rewind && goBackOff\) \{ setGoBackRefusedHere\(true\); return; \}/);
  assert.match(printer, /!goBackOff && reprintValid && reprintFrom <= printedCount/);
  assert.match(printer, /fetch\('\/api\/version'/, 'turned back on by the build route, never by a database read');
}

// #8: the run holding the printer never looks finished; red only for needs you; islands named.
{
  const D = require('../../src/lib/runDisplayStatus.ts');
  const done = { status: 'completed', printedCount: 30, totalLabels: 30 };
  const base = { sent: 30, onTheWay: 0, failed: 1 };
  const holding = D.runDisplayStatus(done, { ...base, firstFailed: { kind: 'needs-check', from: 1, to: 30, reason: null, didNotPrint: false } });
  assert.notEqual(holding.bucket, 'done', 'a run holding the printer is not Done');
  assert.equal(D.runToneDot(holding.tone), D.runToneDot('attention'), 'it needs someone: red');
  assert.equal(D.officeHoldsPrinter({ failed: 1, firstFailed: { kind: 'print-again', from: 1, to: 2, reason: null, didNotPrint: false } }), false, 'a print-again part holds nothing');
  assert.equal(D.officeHoldsPrinter(null), false);
  const run = { status: 'queued', printedCount: 0, totalLabels: 100 };
  const held = D.runDisplayStatus(run, { sent: 10, onTheWay: 10, failed: 0, heldBy: { runId: 'a', runName: 'Gift tins' } });
  assert.equal(held.label, 'Waiting');
  assert.notEqual(D.runToneDot(held.tone), D.runToneDot('attention'), 'waiting behind another run is never red');
  assert.notEqual(D.runToneDot('confirm'), D.runToneDot('attention'), 'a successful send is never red');
  assert.notEqual(D.runToneDot('paused'), D.runToneDot('attention'));
  const back = D.runDisplayStatus(run, { sent: 75, onTheWay: 0, failed: 0, unchecked: 75, stillToSend: 1925, heldBack: { from: 76, to: 150 } });
  assert.equal(back.label, 'Waiting'); assert.equal(back.detail, 'Send labels 76–150 next');
  const list = read('src/app/runs/page.tsx');
  assert.match(list, /else if \(officeHoldsPrinter\(\(r as ListRun\)\.office\)\) active\.push\(r\);/, 'listed with the unfinished runs');
  assert.match(list, /Waiting for a check/);
  assert.match(list, /sent, not counted yet/, 'the bar’s lighter part is named');
  const progress = read('src/components/runs/RunProgress.tsx');
  assert.match(progress, /Printed: \{spanNumbers\(spans\)\}/, 'printed islands are listed');
  assert.match(progress, /islands \? `\$\{printed\.toLocaleString\(\)\} of \$\{total\.toLocaleString\(\)\} printed`/, 'and the header reads as a count');
  assert.match(read('src/components/runs/OfficePiPrinter.tsx'), /', and one blank label'/, 'the sent line names the blank');
}

console.log('PASS run b16: parts skip every counted label, one series across tabs, explicit QR link, USB print-again, blank kept, glyph stop said once, no go-back loop, the holding run never looks done');

// Final re-check: the series mark is renewed only while ours; the part holding the printer leads.
{
  const panel = read('src/components/runs/OfficePiPrinter.tsx');
  assert.match(panel, /const writeMark=\(\)=>\{if\(!markAt\.part\|\|lostMark\)return;if\(readOtherSeries\(\)\)\{lostMark=true;return;\}/, 'never overwrites another tab\'s live series mark');
  assert.match(panel, /markAt=\{index:i,total:current\.parts\.length,part\};writeMark\(\);\n\s*if\(lostMark\)\{setError\(/, 'stops before the next part once another tab took over');
  assert.match(read('src/app/api/runs/route.ts'), /summary\.failed\.find\(\(part\) => part\.kind !== 'print-again'\) \?\? summary\.failed\[0\]/);
  assert.match(read('src/components/runs/RunPrinter.tsx'), /firstFailed: office\.summary\.failed\.find\(\(part\) => part\.kind !== 'print-again'\) \?\? office\.summary\.failed\[0\]/);
  const { officeHoldsPrinter } = require('../../src/lib/runDisplayStatus.ts');
  assert.equal(officeHoldsPrinter({ failed: 2, firstFailed: { kind: 'needs-check' } }), true);
  assert.equal(officeHoldsPrinter({ failed: 1, firstFailed: { kind: 'print-again' } }), false);
}
console.log('PASS run b16 final re-check: series mark stays ours, the holding part leads, Move start re-checks');
