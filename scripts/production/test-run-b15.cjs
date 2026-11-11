/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
// Round 15, area B: printed gaps (office-confirmed and scanned labels are
// never sent again without a reprint choice), the uncapped stop pass with
// leave-out, plain stop words, the bundled fonts' glyph tables, the dots, the
// plain server error, and source checks for the run page and office panel.
require('../thermal/register.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// #1: gaps.
{
  const { gapSuggestion, rangeGaps, partsForSpans, spanListWords, labelsToSpans, mergeSpans } = require('../../src/lib/runGaps.ts');
  const { printedSpans, stillToGo } = require('../../src/lib/runProgress.ts');
  const total = 120;
  const toGo = stillToGo(printedSpans(40, [{ from: 61, to: 80 }, { from: 100, to: 101 }], total), total);
  assert.deepEqual(toGo, [{ from: 41, to: 60 }, { from: 81, to: 99 }, { from: 102, to: 120 }]);
  assert.deepEqual(gapSuggestion([], total, 40, toGo), { from: 41, to: 60 }, 'the suggestion stays in the first gap');
  assert.deepEqual(gapSuggestion([{ from: 41, to: 60, state: 'sent_to_printer' }], total, 40, toGo), { from: 81, to: 99 }, 'office work moves it to the next gap');
  const g = rangeGaps(41, 120, toGo);
  assert.deepEqual(g.printed, [{ from: 61, to: 80 }, { from: 100, to: 101 }]);
  assert.deepEqual(g.gaps, toGo);
  assert.deepEqual(partsForSpans(g.gaps, 500).map((p) => `${p.from}-${p.to}`), ['41-60', '81-99', '102-120'], 'one part per gap, never across an island');
  assert.equal(spanListWords(g.gaps).replace(/⁠/g, ''), '41–60, 81–99 and 102–120');
  assert.deepEqual(rangeGaps(1, 10, undefined, labelsToSpans([5])).gaps, [{ from: 1, to: 4 }, { from: 6, to: 10 }], 'left-out labels are gone from the gaps');
  assert.deepEqual(mergeSpans([{ from: 5, to: 9 }, { from: 1, to: 4 }]), [{ from: 1, to: 9 }]);
}

// #2: the stop pass covers every label of a send; a left-out label neither stops nor asks; one row's words.
{
  const { runPrintCheck, runSendCheck, stopLabelsIn, stopLabelWords } = require('../../src/lib/runLayoutCheck.ts');
  const format = { id: 'f', name: 'f', type: 'thermal', width: 2, height: 1, dpi: 203, labelsAcross: 1 };
  const el = { id: 'b', type: 'barcode', x: 10, y: 10, width: 300, height: 100, rotation: 0, zIndex: 1, isStatic: false, fieldName: 'SKU', content: '', barcodeFormat: 'CODE128', showText: false };
  const template = { id: 't', name: 't', formatId: 'f', thermalRenderMode: 'bitmap-v1', elements: [el] };
  const rows = Array.from({ length: 3000 }, (_, i) => ({ SKU: i === 2599 ? 'X'.repeat(44) : `S${i + 1}` }));
  const run = { id: 'r', name: 'r', templateId: 't', sourceData: rows, totalLabels: rows.length, fieldMappings: { SKU: { mode: 'column', csvColumn: 'SKU' } }, staticValues: {}, mappedField: null, dataSource: 'csv' };
  const base = runPrintCheck(run, template, format);
  const all = runSendCheck(base, run, template, format, { from: 1, to: 3000 });
  assert.deepEqual(all.stopsHere, [2600], 'label 2,600 is found before the series starts, and only it');
  assert.equal(all.check.verdict.stops, true);
  assert.match(all.check.blocking[0], /^Label 2,600’s SKU is too long for this label \(44 characters\), so it can’t print\. Fix row 2,601/);
  const skipped = runSendCheck(base, run, template, format, { from: 1, to: 3000 }, 2000, [2600]);
  assert.deepEqual(skipped.stopsHere, [], 'left out: nothing stops');
  assert.equal(skipped.check.verdict.stops, false);
  assert.deepEqual(stopLabelsIn(run, template, format, [{ from: 2501, to: 3000 }]), [2600]);
  assert.deepEqual(stopLabelsIn(run, template, format, [{ from: 2501, to: 3000 }], [2600]), []);
  assert.equal(stopLabelWords(run, template, format, [2600]), 'Label 2,600’s SKU is too long for this label (44 characters), so it can’t print.');
}

// #5: the glyph tables match the bundled fonts, read with the renderer's own cmap rule.
{
  const { fontHasGlyph, bitmapFontKey, missingGlyphs, checkRunBitmapGlyphs, glyphStopWords } = require('../../src/lib/runGlyphs.ts');
  function hasGlyph(font, cp) {
    let cmap = 0;
    for (let i = 0; i < font.readUInt16BE(4); i++) { const p = 12 + i * 16; if (font.toString('ascii', p, p + 4) === 'cmap') cmap = font.readUInt32BE(p + 8); }
    for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
      const table = cmap + 4 + i * 8, sub = cmap + font.readUInt32BE(table + 4); const format = font.readUInt16BE(sub);
      if (format === 12) for (let j = 0; j < font.readUInt32BE(sub + 12); j++) { const p = sub + 16 + j * 12, start = font.readUInt32BE(p), end = font.readUInt32BE(p + 4); if (cp >= start && cp <= end) return font.readUInt32BE(p + 8) + cp - start !== 0; }
      if (format === 4 && cp <= 0xffff) {
        const n = font.readUInt16BE(sub + 6) / 2;
        for (let j = 0; j < n; j++) {
          const end = font.readUInt16BE(sub + 14 + j * 2), start = font.readUInt16BE(sub + 16 + n * 2 + j * 2);
          if (cp < start || cp > end) continue;
          const delta = font.readInt16BE(sub + 16 + n * 4 + j * 2), p = sub + 16 + n * 6 + j * 2, offset = font.readUInt16BE(p);
          if (!offset) return ((cp + delta) & 0xffff) !== 0;
          const glyph = font.readUInt16BE(p + offset + (cp - start) * 2);
          return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
        }
      }
    }
    return false;
  }
  // The renderer's rule (frozen file): this copy must stay the same as its hasGlyph and font choice.
  const server = read('src/lib/thermal/render.server.ts');
  assert.match(server, /const fontFamilies: Record<string, string> = \{ 'Liberation Sans': 'Sans', 'Liberation Serif': 'Serif', 'Liberation Mono': 'Mono' \};/);
  assert.match(server, /const style = `\$\{e\.fontWeight === 'bold' \? 'Bold' : ''\}\$\{e\.fontStyle === 'italic' \? 'Italic' : ''\}` \|\| 'Regular';/);
  assert.match(server, /if \(!\/\\s\/\.test\(char\) && !hasGlyph\(font, char\.codePointAt\(0\)!\)\) throw/);
  for (const family of ['Sans', 'Serif', 'Mono']) for (const style of ['Regular', 'Bold', 'Italic', 'BoldItalic']) {
    const font = fs.readFileSync(path.join(root, 'assets/thermal-fonts', `Liberation${family}-${style}.ttf`));
    const key = `${family}-${style}`;
    for (let cp = 0; cp <= 0x2ffff; cp += cp < 0x3000 ? 1 : 7) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      assert.equal(fontHasGlyph(key, String.fromCodePoint(cp)), hasGlyph(font, cp), `${key} U+${cp.toString(16)}`);
    }
  }
  assert.equal(bitmapFontKey({ fontFamily: 'Liberation Serif', fontWeight: 'bold', fontStyle: 'italic' }), 'Serif-BoldItalic');
  assert.equal(bitmapFontKey({ fontFamily: 'Arial' }), null);
  assert.deepEqual(missingGlyphs({ fontFamily: 'Liberation Sans', fontWeight: 'normal' }, 'Blue Dream ✓ 1g'), ['✓']);
  assert.deepEqual(missingGlyphs({ fontFamily: 'Liberation Sans', fontWeight: 'normal' }, 'Café · 3.5g'), []);
  const text = { id: 'x', type: 'text', isStatic: false, fieldName: 'Strain', fontFamily: 'Liberation Sans', fontWeight: 'normal', fontStyle: 'normal' };
  const run = { sourceData: [{ Strain: 'OG' }, { Strain: 'Star ★' }, { Strain: 'Kush' }], fieldMappings: { Strain: { mode: 'column', csvColumn: 'Strain' } }, staticValues: {} };
  const check = checkRunBitmapGlyphs({ elements: [text], thermalRenderMode: 'bitmap-v1' }, { type: 'thermal' }, run);
  assert.deepEqual(check.labels, [2]);
  assert.equal(glyphStopWords(check, [2], () => true), 'Label 2’s Strain has “★”, which can’t be drawn, so it can’t print. Fix row 3 in your spreadsheet.');
  assert.deepEqual(checkRunBitmapGlyphs({ elements: [text], thermalRenderMode: 'native-v1' }, { type: 'thermal' }, run).labels, [], 'native ZPL is never stopped');
}

// #3, #10: status words and dots.
{
  const { runDisplayStatus, runToneDot, RUN_TONE_MEANING } = require('../../src/lib/runDisplayStatus.ts');
  const run = { status: 'queued', printedCount: 0, totalLabels: 100 };
  const base = { sent: 0, onTheWay: 0, failed: 0 };
  assert.equal(runDisplayStatus(run, { ...base, unsure: { from: 1, to: 20, missing: true, notYet: true } }).detail, 'The office hasn’t got labels 1–20 yet');
  assert.equal(runDisplayStatus(run, { ...base, unsure: { from: 1, to: 20, missing: true } }).detail, 'The office didn’t get labels 1–20');
  const checking = runDisplayStatus(run, { ...base, sending: 'Checking labels 1–20' });
  assert.equal(checking.label, 'Checking'); assert.equal(checking.detail, 'Labels 1–20');
  assert.equal(new Set(Object.values(RUN_TONE_MEANING)).size, 4, 'four dots by meaning');
  assert.equal(runToneDot('confirm'), runToneDot('check'));
  assert.notEqual(runToneDot('idle'), runToneDot('confirm'), 'Ready has one dot');
}

// #10: a server's raw words are folded away.
{
  const { plainServerError } = require('../../src/lib/runErrors.ts');
  assert.deepEqual(plainServerError(new Error('boom')), { text: 'Something went wrong on our side. Try again in a minute.', details: 'boom' });
  assert.equal(plainServerError(new Error('Database unavailable')).details, '');
}

// #12: one sentence for a long code; no jargon.
{
  const { barcodeRunWhy, barcodePlainSentence } = require('../../src/lib/runBarcodeTicks.ts');
  const wizard = 'This code is too long to scan at this size. Print it as a QR code, or use a bigger label.';
  assert.equal(barcodeRunWhy('The Metrc Tag barcode on all 20 labels prints 2.95" wide for 24 characters and runs onto the next label, so it won’t scan. Make a picture copy of the design in the designer, which draws thinner bars that fit.'), wizard);
  const row = 'Label 12’s SKU is too long for this label (40 characters), so it can’t print. Fix row 13 in your spreadsheet, or leave label 12 out.';
  assert.equal(barcodePlainSentence(row), row);
  assert.equal(barcodeRunWhy(row), '');
}

const has = (src, re) => assert.ok(re.test(src), `source check: ${re}`);
// Source checks.
{
  const panel = read('src/components/runs/OfficePiPrinter.tsx');
  const printer = read('src/components/runs/RunPrinter.tsx');
  const list = read('src/app/runs/page.tsx');
  // #1: the already-printed check names the gaps; a reprint is a choice of its own.
  has(panel, /\$\{one\?'was':'were'\} already printed/);
  has(panel, /extraLabel:`Print \$\{them\} again too`/);
  has(printer, /already printed on the office printer/);
  // #2: Send all checks the whole series first; the last part always says why.
  has(panel, /Send the rest without \$\{which\}\?/);
  has(panel, /Nothing was sent\./);
  // #3: sentAt saved with the key.
  has(panel, /sentAt:Date\.now\(\)/);
  // #4: forget takes the send lock and re-reads; a new payload clears the meta record.
  has(panel, /withOfficeSendLock/);
  // #6: only thermal runs wait for the office printer.
  has(list, /if \(!thermal && !run\.office\) return null;/);
  // #7: the office queue pads back in for the ghost inset.
  has(panel, /className="-ml-\[calc\(0\.75rem\+1px\)\]"/);
  // #8: the go-back names the labels that print twice.
  has(printer, /already printed, so \$\{twiceOne \? 'it prints' : 'they print'\} a second time/);
  // #9: the QR run offers to cancel the old run.
  has(printer, /onQr=\{\(\) => markQrFrom\(run\)\}/);
  has(read('src/components/runs/QrReplaced.tsx'), /Cancel the old run/);
  // #11: the bulk mark rebuilds its plan fresh.
  has(list, /freshPlan = officeMarkPlan\(/);
}

console.log('PASS run b15: printed gaps, uncapped stops with leave-out, glyph tables, four dots, plain errors, one long-code sentence');
