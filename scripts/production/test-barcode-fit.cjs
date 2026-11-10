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
const { runPrintCheck } = require('../../src/lib/runLayoutCheck.ts');
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
    assert.match(message, /prints 2\.95" wide for 24 characters, but only 1\.93" fits/);
    assert.match(message, /exact-print copy/);
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
    assert.deepEqual(page.blocking, grouped.items, 'the run page blocks with the same words');
  }
  // Two across: the bars print onto the next label's barcode.
  {
    const t = design('preroll', 'native-v1', barcode({ x: 10, y: 120, width: 355, height: 120 }));
    const fit = barcodeFit(t.elements[1], TAGS[2], F.preroll, false);
    assert.equal(fit.reason, 'into-next-label');
    assert.equal(fit.overNextBarcode, true);
    assert.match(barcodeFitProblem(fit, TAGS[2]), /runs onto the next label, over its barcode/);
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
    assert.match(barcodeFitFix(fit), /use a wider label or a QR code/);
    await assert.rejects(renderThermalBitmap(design('2x1', 'bitmap-v1', full), F['2x1'], { 'Package Tag': forty, Product: 'x' }), /Barcode box is too small/);
    const check = checkRunBarcodes(design('2x1', 'bitmap-v1', full), run([T24, forty]), F['2x1']);
    assert.equal(check.badLabels, 1, 'only the impossible label is held back');
    assert.equal(check.issues[0].label, 2);
  }
  console.log('PASS barcode fit: one verdict, matched to the native and exact renderers; Metrc tags pass on 4"×6", 3"×2" (tight), 300 dpi 2"×1" and every exact design; impossible values still blocked; never "shorten"');
})().catch((error) => { console.error(error); process.exit(1); });
