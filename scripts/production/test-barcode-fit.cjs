/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
// One barcode verdict for the designer, the new-run check and the run page,
// checked against what the printer is really sent: real Metrc package tags
// are drawn by the same renderers the app uses (zpl-renderer-js for native
// designs, the exact bitmap renderer for exact designs) and the bars are
// decoded back to the tag.
require('../thermal/register.cjs');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { barcodeFit, nativeBarcodeFootprint, barcodeFitProblem, barcodeFitFix } = require('../../src/lib/barcodeFit.ts');
const { checkRunBarcodes, describeBarcodeGroups } = require('../../src/lib/barcodeCheck.ts');
const { layoutProblems } = require('../../src/lib/designerLayout.ts');
const { runPrintCheck, printCheckAllows, readPrintGoAhead, rememberPrintGoAhead, barcodeVerdict, BARCODE_VALUE_GO_AHEAD } = require('../../src/lib/runLayoutCheck.ts');
const { barcodeDamage, barcodeTickLabel, barcodeTicksAllow } = require('../../src/lib/runBarcodeTicks.ts');
const fs = require('node:fs');
const path = require('node:path');
const { generateZPL } = require('../../src/lib/zplGenerator.ts');
const { thermalRenderGeometry } = require('../../src/lib/thermal/geometry.ts');
const { renderThermalBitmap } = require('../../src/lib/thermal/render.server.ts');
const { BARS } = require('jsbarcode/bin/barcodes/CODE128/constants.js');

// Realistic package tags: today's 24-character tags, a 22-character one and an older 16-character one.
const TAGS = ['1A4FF0100000022000012345', '1A4FF0300000022000012399', '1A4FF03000000220000999', '1A40603000012345'];
const T24 = TAGS[0];

const fmt = (id, width, height, dpi = 203, extra = {}) => ({ id, name: id, type: 'thermal', width, height, dpi, labelsAcross: 1, ...extra });
const F = {
  '2x1': fmt('2x1', 2, 1), '2.25x1.25': fmt('2.25x1.25', 2.25, 1.25), '3x2': fmt('3x2', 3, 2), '4x6': fmt('4x6', 4, 6),
  '2x1-300': fmt('2x1-300', 2, 1, 300),
  preroll: fmt('preroll', 1.25, 1, 300, { labelsAcross: 2, linerWidth: 2.75, horizontalGapThermal: 0.125, sideMarginThermal: 0.0625 }),
};
const barcode = (extra = {}) => ({ id: 'tag', type: 'barcode', fieldName: 'Package Tag', isStatic: false, barcodeFormat: 'CODE128', showText: true, x: 8, y: 60, width: 390, height: 100, rotation: 0, zIndex: 2, ...extra });
const design = (formatId, mode, el) => ({ id: `t-${formatId}`, name: formatId, formatId, thermalRenderMode: mode, elements: [{ id: 'name', type: 'text', isStatic: false, fieldName: 'Product', x: 8, y: 8, width: 300, height: 40, rotation: 0, zIndex: 1, fontSize: 10, fontFamily: mode === 'bitmap-v1' ? 'Liberation Sans' : 'Arial', fontWeight: 'normal', textAlign: 'left', color: '#000000', lineHeight: 1.2, content: '' }, el] });
const run = (tags) => ({ sourceData: tags.map((tag, i) => ({ Product: `Flower ${i + 1}`, 'Package Tag': tag })), fieldMappings: { Product: { mode: 'column', csvColumn: 'Product' }, 'Package Tag': { mode: 'column', csvColumn: 'Package Tag' } }, staticValues: {} });

// ---------------------------------------------------------------------------
// A small Code 128 reader: bars of one pixel row -> text, or null.
// ---------------------------------------------------------------------------
const PATTERNS = new Map(BARS.map((bits, value) => [String(bits), value]));
function decodeRow(ink) {
  const first = ink.indexOf(1), last = ink.lastIndexOf(1);
  if (first < 0) return null;
  const runs = [];
  for (let i = first, run = 1; i <= last; i++) { if (i === last || ink[i + 1] !== ink[i]) { runs.push(run); run = 1; } else run++; }
  const unit = runs[0] / 2; // every start symbol begins with a 2-module bar
  const bits = runs.map((r, i) => (i % 2 === 0 ? '1' : '0').repeat(Math.round(r / unit))).join('');
  if (bits.length < 35 || (bits.length - 13) % 11) return null;
  const values = [];
  for (let i = 0; i < bits.length - 13; i += 11) { const v = PATTERNS.get(bits.slice(i, i + 11)); if (v === undefined) return null; values.push(v); }
  if (bits.slice(-13) !== String(BARS[106])) return null;
  const [start, ...rest] = values, check = rest.pop();
  if ((start + rest.reduce((sum, v, i) => sum + v * (i + 1), 0)) % 103 !== check) return null;
  let set = { 103: 'A', 104: 'B', 105: 'C' }[start], text = '';
  for (const v of rest) {
    if (set === 'C') { if (v === 100) set = 'B'; else if (v === 101) set = 'A'; else text += String(v).padStart(2, '0'); continue; }
    if (v === 99) set = 'C'; else if (v === 100 && set === 'A') set = 'B'; else if (v === 101 && set === 'B') set = 'A';
    else if (set === 'B') text += String.fromCharCode(v + 32);
    else text += String.fromCharCode(v < 64 ? v + 32 : v - 64);
  }
  return text;
}
async function rows(png) {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, row: (y) => Array.from({ length: info.width }, (_, x) => (data[y * info.width + x] < 128 ? 1 : 0)) };
}

let zpl;
async function renderNative(template, format, values) {
  zpl = zpl || (await require('zpl-renderer-js').ready).api;
  const g = thermalRenderGeometry(format);
  const b64 = await zpl.zplToBase64Async(generateZPL(template, format, values), g.linerIn * 25.4, g.heightIn * 25.4, g.dpmm);
  return Buffer.from(b64, 'base64');
}

(async () => {
  // -------------------------------------------------------------------------
  // Native designs: the printer draws ^BC mode N in subset B at 2 dots a
  // module, so every tag character costs 11 modules (digits don't pair up).
  // -------------------------------------------------------------------------
  {
    const t = design('4x6', 'native-v1', barcode({ x: 60, y: 420, width: 690, height: 180 }));
    for (const tag of TAGS) {
      const fit = barcodeFit(t.elements[1], tag, F['4x6'], false);
      assert.equal(fit.level, 'ok', `${tag} fits a 4" × 6" label`);
      assert.equal(fit.barsDots, (11 * tag.length + 35) * 2);
      const img = await rows(await renderNative(t, F['4x6'], { 'Package Tag': tag, Product: 'Flower' }));
      const ink = img.row(450);
      assert.equal(ink.lastIndexOf(1) - ink.indexOf(1) + 1, fit.barsDots, 'renderer bars are as long as the verdict says');
      assert.equal(decodeRow(ink), tag, `renderer output scans as ${tag}`);
    }
    const check = checkRunBarcodes(t, run(TAGS), F['4x6']);
    assert.equal(check.issues.length, 0, 'the wizard lets 4" × 6" case labels through');
    assert.equal(check.warnings.length, 0);
  }
  // 3" × 2" native: a 24-character tag fits with almost no clear margin: a warning, never a block.
  {
    const t = design('3x2', 'native-v1', barcode({ x: 6, y: 100, width: 590 }));
    const fit = barcodeFit(t.elements[1], T24, F['3x2'], false);
    assert.equal(fit.level, 'tight');
    const check = checkRunBarcodes(t, run([T24, TAGS[3]]), F['3x2']);
    assert.equal(check.issues.length, 0, 'tight is not a block');
    assert.equal(check.warnings.length, 2, 'both labels sit 6 dots from the edge: a warning each, grouped later');
    assert.equal(decodeRow((await rows(await renderNative(t, F['3x2'], { 'Package Tag': T24 }))).row(130)), T24, 'and it renders whole');
    // 300 dpi 2" × 1": 600 dots, so the same tag fits right at the edge.
    const t300 = design('2x1-300', 'native-v1', barcode({ x: 1, y: 60, width: 590 }));
    assert.equal(barcodeFit(t300.elements[1], T24, F['2x1-300'], false).level, 'tight');
    assert.equal(decodeRow((await rows(await renderNative(t300, F['2x1-300'], { 'Package Tag': T24 }))).row(90)), T24);
  }
  // 2" × 1" native: 598 dots of bars on a 406-dot label. The renderer cuts them off; the verdict blocks.
  {
    const t = design('2x1', 'native-v1', barcode({ x: 14, y: 132, width: 260, height: 50 }));
    const fit = barcodeFit(t.elements[1], T24, F['2x1'], false);
    assert.equal(fit.level, 'blocked');
    assert.equal(fit.reason, 'off-label');
    const ink = (await rows(await renderNative(t, F['2x1'], { 'Package Tag': T24 }))).row(150);
    assert.ok(ink.lastIndexOf(1) - ink.indexOf(1) + 1 < fit.barsDots, 'the renderer really loses the end of the bars');
    assert.equal(decodeRow(ink), null, 'and what is left does not scan');
    const message = `${barcodeFitProblem(fit, T24)}. ${barcodeFitFix(fit)}.`;
    assert.match(message, /prints 2\.95" wide for 24 characters but only 1\.93" fits/);
    assert.match(message, /exact-print copy of the design in the designer/);
    assert.doesNotMatch(message, /More menu/, 'no directions to a menu');
    const inDesigner = barcodeFitFix(fit, 'designer');
    assert.match(inDesigner, /make an exact-print copy/i);
    assert.doesNotMatch(inDesigner, /designer|More menu/, 'inside the designer, never "go to the designer"');
    assert.doesNotMatch(message, /shorten/i, 'never tell anyone to shorten a package tag');
    // The designer, the wizard and the run page say the same thing.
    const designer = layoutProblems(t.elements, F['2x1'], { 'Package Tag': T24, Product: 'x' });
    assert.equal(designer.length, 1);
    assert.equal(designer[0].blocking, true);
    assert.equal(designer[0].barcodeFit.reason, 'off-label');
    const forty = run(Array.from({ length: 40 }, (_, i) => `1A4FF0100000022000${String(12345 + i).padStart(6, '0')}`));
    const check = checkRunBarcodes(t, forty, F['2x1']);
    assert.equal(check.badLabels, 40);
    const grouped = describeBarcodeGroups(check.issues, check.checkedLabels, () => true, 5, check.fitCounts);
    assert.equal(grouped.items.length, 1, 'one grouped message, not one per row');
    assert.match(grouped.items[0], /^The Package Tag barcode on all 40 labels prints 2\.95" wide/);
    assert.doesNotMatch(grouped.items.join(' '), /shorten/i);
    const page = runPrintCheck({ ...forty, totalLabels: 40, dataSource: 'csv' }, t, F['2x1']);
    assert.deepEqual(page.blocking, grouped.items, 'the run page names it with the same words');
    // Operational rule: an emulated "won't print whole" never hard-stops. It is
    // shown first, in red, with its fix, and printing takes an explicit go-ahead.
    assert.equal(page.verdict.stops, false, 'a native barcode the printer cuts off is not a stop');
    assert.equal(page.verdict.goAheadLabel, 'Print anyway — the Package Tag barcode will be cut off and won’t scan', 'the go-ahead says what will happen');
    assert.equal(page.verdict.carriesOver, true);
    assert.equal(page.barcodeElementIds.join(), 'tag');
    assert.match(page.verdict.heading, /^40 labels have a barcode that won’t print whole$/);
    assert.equal(printCheckAllows(page, {}), false, 'printing waits for the go-ahead');
    assert.equal(printCheckAllows(page, { barcode: page.blockingKey }), true, 'and goes ahead once given');
    assert.equal(printCheckAllows(page, { barcode: 'an older problem' }), false, 'a go-ahead covers only the problems it was given for');
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
    rememberPrintGoAhead(storage, 'run-1', { barcode: page.blockingKey });
    assert.equal(printCheckAllows(page, readPrintGoAhead(storage, 'run-1')), true, 'the go-ahead is kept for this run on this device');
    rememberPrintGoAhead(storage, 'run-1', {});
    assert.deepEqual(readPrintGoAhead(storage, 'run-1'), {}, 'unticking takes it back');
    assert.doesNotMatch(page.verdict.waitReason, /shorten/i);
  }
  // Two across: the bars print onto the next label's barcode.
  {
    const t = design('preroll', 'native-v1', barcode({ x: 10, y: 120, width: 355, height: 120 }));
    const fit = barcodeFit(t.elements[1], TAGS[2], F.preroll, false);
    assert.equal(fit.reason, 'into-next-label');
    assert.equal(fit.overNextBarcode, true);
    assert.match(barcodeFitProblem(fit, TAGS[2]), /runs over the next label’s barcode, so neither label will scan/);
    // The go-ahead names that damage, and is asked again on the run page.
    const pairs = runPrintCheck({ ...run([TAGS[2], TAGS[2]]), totalLabels: 2, dataSource: 'csv' }, t, F.preroll);
    assert.equal(pairs.verdict.severity, 'neither-scans');
    assert.equal(pairs.verdict.goAheadLabel, 'Print anyway — the Package Tag barcode prints over the next label’s, so neither label will scan');
    assert.equal(pairs.verdict.carriesOver, false, 'a wizard tick for "neither label will scan" never carries over to the run page');
    assert.equal(pairs.blocking.length, 1);
    assert.equal(pairs.layout.length, 0, 'one problem, one tick: the overlap is not asked about again');
    const g = thermalRenderGeometry(F.preroll);
    const ink = (await rows(await renderNative(t, F.preroll, [{ 'Package Tag': TAGS[2] }, null]))).row(150);
    assert.ok(ink.lastIndexOf(1) > g.effectiveSideMDots + g.labelWDots + Math.round(0.125 * 300), 'lane 1 ink lands on lane 2');
  }
  // Turned barcodes land where zplGenerator's field origin puts them.
  {
    const square = fmt('4x4', 4, 4);
    for (const rotation of [0, 90, 180, 270]) for (const showText of [true, false]) {
      const el = barcode({ x: 200, y: 300, width: 260, height: 60, rotation, showText, isStatic: true, content: T24 });
      const img = await rows(await renderNative({ id: 'r', name: 'r', formatId: '4x4', thermalRenderMode: 'native-v1', elements: [el] }, square, {}));
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < img.height; y++) { const r = img.row(y); const a = r.indexOf(1); if (a < 0) continue; x0 = Math.min(x0, a); x1 = Math.max(x1, r.lastIndexOf(1)); y0 = Math.min(y0, y); y1 = y; }
      const box = nativeBarcodeFootprint(el, T24);
      const sideways = rotation === 90 || rotation === 270;
      const [start, end] = sideways ? [y0, y1] : [x0, x1];
      const [want] = sideways ? [box.y] : [box.x];
      assert.equal(start, want, `rotation ${rotation}: bars start where the verdict says`);
      const labelDots = sideways ? img.height : img.width;
      if (want + 598 <= labelDots) assert.equal(end, want + 598 - 1, `rotation ${rotation}: bars run 598 dots`);
      else assert.ok(end >= labelDots - 6, `rotation ${rotation}: bars run to the label edge and are cut there`);
      const fit = barcodeFit(el, T24, square, false);
      assert.equal(fit.level === 'blocked', want + 598 > 812 + 2, `rotation ${rotation}: blocked exactly when the renderer cuts the bars`);
    }
  }

  // -------------------------------------------------------------------------
  // Exact designs: the renderer fits whole-dot modules (subset C for digit
  // runs) inside the box, so the box width is what matters.
  // -------------------------------------------------------------------------
  for (const [formatId, el] of [['2x1', barcode()], ['2.25x1.25', barcode({ width: 440, height: 120 })], ['4x6', barcode({ x: 60, y: 420, width: 690, height: 180 })]]) {
    const t = design(formatId, 'bitmap-v1', el);
    const check = checkRunBarcodes(t, run(TAGS), F[formatId]);
    assert.equal(check.issues.length, 0, `exact ${formatId} design passes the wizard check for every tag`);
    for (const tag of TAGS) {
      assert.equal(barcodeFit(el, tag, F[formatId], true).level, 'ok');
      const proof = await renderThermalBitmap(t, F[formatId], { 'Package Tag': tag, Product: 'Flower' });
      const img = await rows(Buffer.from(proof.proof.split(',')[1], 'base64'));
      assert.equal(decodeRow(img.row(el.y + 10)), tag, `exact ${formatId} renders ${tag} and it scans`);
    }
  }
  // The box limit is the renderer's: bits + 20 quiet modules at 1 dot a module.
  {
    const needed = barcodeFit(barcode(), T24, F['2x1'], true).barsDots;
    assert.equal(needed, 231, 'a 24-character tag needs a 231-dot (1.14") box on an exact design');
    for (const [width, ok] of [[needed, true], [needed - 1, false]]) {
      const el = barcode({ width });
      assert.equal(barcodeFit(el, T24, F['2x1'], true).level, ok ? 'ok' : 'blocked');
      const rendered = await renderThermalBitmap(design('2x1', 'bitmap-v1', el), F['2x1'], { 'Package Tag': T24, Product: 'x' }).then(() => true, (e) => { assert.match(e.message, /Barcode box is too small/); return false; });
      assert.equal(rendered, ok, `a ${width}-dot box ${ok ? 'renders' : 'is refused by the renderer'}`);
    }
    const small = barcodeFit(barcode({ width: 210 }), T24, F['2x1'], true);
    assert.equal(small.reason, 'box-too-small');
    assert.match(barcodeFitFix(small), /make the barcode box at least 1\.14" wide/i);
  }

  // -------------------------------------------------------------------------
  // Genuinely impossible values are still caught.
  // -------------------------------------------------------------------------
  {
    const accented = `${T24}é`;
    for (const bitmap of [false, true]) {
      const fit = barcodeFit(barcode(), accented, F['4x6'], bitmap);
      assert.equal(fit.reason, 'characters');
      assert.equal(fit.level, 'blocked');
    }
    await assert.rejects(renderNative(design('4x6', 'native-v1', barcode()), F['4x6'], { 'Package Tag': accented }), 'the native renderer fails on it too');
    const forty = `${T24}ABCDEFGHIJKLMNOP`;
    const full = barcode({ x: 0, width: 406 });
    const fit = barcodeFit(full, forty, F['2x1'], true);
    assert.equal(fit.reason, 'box-too-small');
    assert.match(barcodeFitFix(fit), /use a label at least [0-9.]+" wide, or a QR code/i);
    await assert.rejects(renderThermalBitmap(design('2x1', 'bitmap-v1', full), F['2x1'], { 'Package Tag': forty, Product: 'x' }), /Barcode box is too small/);
    const check = checkRunBarcodes(design('2x1', 'bitmap-v1', full), run([T24, forty]), F['2x1']);
    assert.equal(check.badLabels, 1, 'only the impossible label is held back');
    assert.equal(check.issues[0].label, 2);
    // The exact renderer refuses it, so nothing could print: that stays a stop.
    const exactPage = runPrintCheck({ ...run([T24, forty]), totalLabels: 2, dataSource: 'csv' }, design('2x1', 'bitmap-v1', full), F['2x1']);
    assert.equal(exactPage.verdict.stops, true, 'a renderer refusal is a stop');
    assert.equal(printCheckAllows(exactPage, { barcode: exactPage.blockingKey }), false, 'no go-ahead past a renderer refusal');
    // A native value the barcode type can't hold: the printer is still sent it, so it needs a go-ahead, not a stop.
    const valuePage = runPrintCheck({ ...run([accented]), totalLabels: 1, dataSource: 'csv' }, design('4x6', 'native-v1', barcode()), F['4x6']);
    assert.equal(valuePage.verdict.stops, false);
    assert.equal(valuePage.verdict.goAheadLabel, BARCODE_VALUE_GO_AHEAD);
    // A value only the spreadsheet can fix says so, consistently, in the heading and the bottom bar.
    const exactValue = runPrintCheck({ ...run([accented]), totalLabels: 1, dataSource: 'csv' }, design('4x6', 'bitmap-v1', barcode()), F['4x6']);
    assert.equal(exactValue.verdict.stops, true);
    assert.equal(exactValue.verdict.fixIn, 'data');
    assert.match(exactValue.verdict.waitReason, /Fix the spreadsheet rows listed above, then choose the file again\./);
    assert.doesNotMatch(exactValue.verdict.waitReason, /Fix the design/);
    assert.match(exactValue.blocking[0], /Fix row 2 of your spreadsheet/);
    assert.match(exactValue.verdict.heading, /barcode value it can’t print/);
    const typed = barcodeVerdict(exactValue.verdict.stops ? [{ kind: 'characters', fit: { bitmap: true, level: 'blocked', reason: 'characters' }, field: 'Package Tag', label: 1 }] : [], 1, F['4x6'], () => false);
    assert.equal(typed.fixIn, 'design', 'a typed value is not a spreadsheet fix');
  }
  // -------------------------------------------------------------------------
  // A print the printer can produce is never a stop. On an exact design the
  // renderer (JsBarcode) decides: a value it still encodes needs a go-ahead
  // that says what will scan; only a value it refuses stops the run.
  // -------------------------------------------------------------------------
  {
    const lot = (format, extra = {}) => barcode({ fieldName: 'Batch', barcodeFormat: format, x: 40, width: 700, ...extra });
    const batchRun = (values) => ({ sourceData: values.map((v) => ({ Batch: v })), fieldMappings: { Batch: { mode: 'column', csvColumn: 'Batch' } }, staticValues: {}, totalLabels: values.length, dataSource: 'csv' });
    const cases = [
      { name: 'CODE39 lowercase', format: 'CODE39', value: 'lot-a12', stops: false, note: /Lowercase letters will scan as UPPERCASE/, go: 'Print anyway — lowercase letters will scan as UPPERCASE', tick: 'Print anyway — I accept it scans as UPPERCASE', damage: /scans in UPPERCASE/ },
      { name: 'CODE128 tab', format: 'CODE128', value: 'LOT\t12', stops: false, note: /The tab will scan as a Tab key press/, go: 'Print anyway — the tab will scan as a Tab key press', tick: 'Print anyway — I accept it won’t scan exactly as written', damage: /won’t scan exactly as written/ },
      { name: 'CODE128 DEL', format: 'CODE128', value: 'LOT12\x7f', showText: false, stops: false, note: /hidden character \(DEL\)/, go: 'Print anyway — the hidden character is printed in the barcode, so the scan won’t match the text you see', tick: 'Print anyway — I accept it won’t scan exactly as written', damage: /won’t scan exactly as written/ },
      { name: 'CODE128 é', format: 'CODE128', value: 'café', stops: true },
    ];
    // Every stop decision matches what the exact renderer really does, with and without the number under the bars.
    for (const showText of [true, false]) {
      for (const [format, value] of [['CODE39', 'lot-a12'], ['CODE39', 'lot_a12'], ['CODE128', 'LOT\t12'], ['CODE128', 'A\r\nB'], ['CODE128', 'LOT12\x7f'], ['CODE128', 'café'], ['CODE128', 'A\x01B'], ['CODE128', 'AÈB'], ['CODE128', 'AÏB'], ['CODE128', 'AÓB'], ['CODE128', 'A\u00a0B']]) {
        const el = lot(format, { showText });
        const rendered = await renderThermalBitmap(design('4x6', 'bitmap-v1', el), F['4x6'], { Batch: value, Product: 'x' }).then(() => true, () => false);
        const fit = barcodeFit(el, value, F['4x6'], true);
        assert.equal(fit.level === 'blocked' && !fit.printable, !rendered, `${format} ${JSON.stringify(value)} (number ${showText ? 'shown' : 'hidden'}): stops exactly when the exact renderer refuses it`);
      }
    }
    // DEL can't go in the number under the bars: a stop that says how to fix it.
    const delText = barcodeFit(lot('CODE128', { showText: true }), 'LOT12\x7f', F['4x6'], true);
    assert.equal(delText.printable, undefined);
    assert.match(delText.problem, /turn off the number under the barcode/);
    for (const c of cases) {
      const t = design('4x6', 'bitmap-v1', lot(c.format, c.showText === false ? { showText: false } : {}));
      // What the exact renderer really does with it.
      const rendered = await renderThermalBitmap(t, F['4x6'], { Batch: c.value, Product: 'x' }).then(() => true, () => false);
      assert.equal(rendered, !c.stops, `${c.name}: the exact renderer ${c.stops ? 'refuses' : 'draws'} it`);
      const fit = barcodeFit(t.elements[1], c.value, F['4x6'], true);
      assert.equal(fit.reason, 'characters', c.name);
      assert.equal(!!fit.printable, !c.stops, `${c.name}: printable only when the renderer draws it`);
      const page = runPrintCheck(batchRun([c.value]), t, F['4x6']);
      assert.equal(page.blocking.length, 1, c.name);
      assert.equal(page.verdict.stops, c.stops, `${c.name}: ${c.stops ? 'a stop' : 'a go-ahead, not a stop'}`);
      assert.equal(printCheckAllows(page, { barcode: page.blockingKey }), !c.stops, `${c.name}: the go-ahead ${c.stops ? 'cannot' : 'does'} let it print`);
      assert.equal(printCheckAllows(page, {}), false, `${c.name}: never prints without a tick`);
      if (c.stops) {
        assert.match(page.blocking[0], /é/);
        assert.match(page.verdict.waitReason, /nothing can print/);
        continue;
      }
      assert.match(page.blocking[0], c.note, `${c.name}: the problem says what will scan`);
      assert.match(page.blocking[0], /Fix row 2 of your spreadsheet/);
      assert.equal(page.verdict.severity, 'value');
      assert.equal(page.verdict.carriesOver, true);
      assert.equal(page.verdict.fixIn, 'data');
      assert.equal(page.verdict.goAheadLabel, c.go, `${c.name}: the wizard's tick says what will scan`);
      assert.match(page.verdict.heading, /won’t scan exactly as written/);
      assert.match(page.verdict.waitReason, /tick the box/);
      assert.equal(barcodeTickLabel(page.blocking[0]), c.tick, `${c.name}: the run page's tick`);
      assert.match(barcodeDamage(page.blocking[0]), c.damage);
      assert.equal(barcodeTicksAllow(page.blocking, [], false), false);
      assert.equal(barcodeTicksAllow(page.blocking, [page.blocking[0]], false), true);
      // The wizard's checks use the same verdict.
      const wizard = barcodeVerdict(checkRunBarcodes(t, batchRun([c.value]), F['4x6']).issues, 1, F['4x6'], () => true);
      assert.equal(wizard.stops, false);
      assert.equal(wizard.goAheadLabel, c.go);
    }
    // A drawable value in a box the renderer refuses is still a stop (the box is the reason).
    const narrow = barcodeFit(lot('CODE39', { width: 120 }), 'lot-a12', F['4x6'], true);
    assert.equal(narrow.reason, 'box-too-small');
    // A Code 39 value with a character JsBarcode refuses stops, naming only that character.
    const under = barcodeFit(lot('CODE39'), 'lot_a12', F['4x6'], true);
    assert.equal(under.printable, undefined);
    assert.match(under.problem, /\(_\)/);
    // A control character the exact renderer refuses before drawing stays a stop, though JsBarcode could encode it.
    assert.equal(barcodeFit(lot('CODE128'), 'A\x01B', F['4x6'], true).printable, undefined);
    // Mixed drawn values: one go-ahead in general words.
    const mixed = runPrintCheck(batchRun(['LOT\t1', 'LOT2\x7f']), design('4x6', 'bitmap-v1', lot('CODE128', { showText: false })), F['4x6']);
    assert.equal(mixed.verdict.stops, false);
    assert.equal(mixed.verdict.goAheadLabel, 'Print anyway — the barcode won’t scan exactly as written');
    // A drawable value next to a refused one: the refusal stops the run.
    const both = runPrintCheck(batchRun(['LOT\t1', 'café']), design('4x6', 'bitmap-v1', lot('CODE128')), F['4x6']);
    assert.equal(both.verdict.stops, true);
    // Native designs: the printer is sent every value, so none of these is a stop.
    for (const c of cases) {
      const page = runPrintCheck(batchRun([c.value]), design('4x6', 'native-v1', lot(c.format, c.showText === false ? { showText: false } : {})), F['4x6']);
      assert.equal(page.verdict.stops, false, `native ${c.name}: a go-ahead, not a stop`);
      assert.equal(printCheckAllows(page, { barcode: page.blockingKey }), true);
      assert.equal(printCheckAllows(page, {}), false);
      assert.equal(page.verdict.goAheadLabel, BARCODE_VALUE_GO_AHEAD);
    }
    // Line breaks are named once, as a line break.
    assert.match(barcodeFit(lot('CODE128'), 'A\r\nB', F['4x6'], false).problem, /\(a line break\)$/);
  }
  // A barcode cut off over a QR code: one line names both, and the go-ahead says both won't scan.
  {
    const qr = { id: 'coa', type: 'qr', fieldName: 'COA link', isStatic: false, x: 300, y: 80, width: 100, height: 100, rotation: 0, zIndex: 3, errorCorrection: 'M' };
    const t = { ...design('2x1', 'native-v1', barcode({ x: 14, y: 80, width: 260, height: 50 })), elements: [barcode({ x: 14, y: 80, width: 260, height: 50 }), qr] };
    const data = { sourceData: [{ 'Package Tag': T24, 'COA link': 'https://lab.example/1' }], fieldMappings: { 'Package Tag': { mode: 'column', csvColumn: 'Package Tag' }, 'COA link': { mode: 'column', csvColumn: 'COA link' } }, staticValues: {}, totalLabels: 1, dataSource: 'csv' };
    const page = runPrintCheck(data, t, F['2x1']);
    assert.match(page.blocking[0], /It also prints over the COA link QR code, so that won’t scan either\./);
    assert.equal(page.verdict.goAheadLabel, 'Print anyway — the Package Tag barcode and the COA link QR code won’t scan');
    assert.equal(page.layout.length, 0, 'the overlap is part of the barcode problem, not a second tick');
    // Over a QR code and a text: the code is named as the one that won't scan, never "the code it covers".
    const batch = { id: 'batch', type: 'text', fieldName: 'Batch', isStatic: false, x: 230, y: 60, width: 60, height: 90, rotation: 0, zIndex: 4, fontSize: 10, fontFamily: 'Arial', fontWeight: 'normal', textAlign: 'left', color: '#000000', lineHeight: 1.2 };
    const t2 = { ...t, elements: [...t.elements, batch] };
    const data2 = { ...data, sourceData: [{ ...data.sourceData[0], Batch: 'B-1102' }], fieldMappings: { ...data.fieldMappings, Batch: { mode: 'column', csvColumn: 'Batch' } } };
    const page2 = runPrintCheck(data2, t2, F['2x1']);
    assert.doesNotMatch(page2.blocking[0] + page2.verdict.goAheadLabel, /code it covers/);
    assert.match(page2.blocking[0], /so the COA link QR code won’t scan either\./);
    assert.equal(page2.verdict.goAheadLabel, 'Print anyway — the Package Tag barcode and the COA link QR code won’t scan');
  }
  // The wizard and the run page use the same verdict and the same go-ahead words, and neither hard-stops on it.
  {
    const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
    const wizard = read('src/app/runs/new/page.tsx');
    assert.match(wizard, /const barcodesOk = barcodesClear \|\| barcodeGoAhead;/, 'the wizard goes ahead on an explicit tick');
    assert.match(wizard, /confirmLabel=\{barcodeWords\.stops \? undefined : barcodeWords\.goAheadLabel\}/);
    assert.match(wizard, /saved\.verdict\.carriesOver/, 'the wizard keeps a go-ahead for the run page only when it may carry over');
    const page = read('src/components/runs/RunPrinter.tsx');
    assert.match(page, /runPrintCheck\(run, template, format\)/, 'the run page checks with runPrintCheck');
    assert.match(page, /printAllowed=\{blanksOk && checksOk\}/, 'office sends wait for the same check');
    assert.doesNotMatch(page, /runLayoutWarnings|anyway`/, 'no old layout-only "… anyway" path');
    const panel = read('src/components/runs/OfficePiPrinter.tsx');
    assert.doesNotMatch(panel, /Send anyway|layoutWarnings/, 'the office panel has no second, different ask');
    const checks = read('src/components/checks/RunChecks.tsx');
    assert.match(checks, /confirmLabel=\{check\.verdict\.stops \? undefined : check\.verdict\.goAheadLabel\}/);
  }
  console.log('PASS barcode fit: one verdict, matched to the native and exact renderers; Metrc tags pass on 4"×6", 3"×2" (tight), 300 dpi 2"×1" and every exact design; impossible values still blocked; never "shorten"');
})().catch((error) => { console.error(error); process.exit(1); });
