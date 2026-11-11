/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
// Round 15, area A: the new-run page reuses a QR copy only when it is
// provably the same design; it links a QR run to the run it replaces; it
// catches text a picture design can't draw before Start; and it says plainly
// when a run to copy can't be opened or the server fails.
require('../thermal/register.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stableJson, designFingerprint, qrCopyStillMatches, freshQrCopyName, readQrCopy, saveQrCopy, qrCopyKey } = require('../../src/app/runs/new/qrCopy.ts');
const { wizardGlyphCheck, glyphProblemItems } = require('../../src/components/checks/glyphRows.ts');
const { checkRunBitmapGlyphs } = require('../../src/lib/runGlyphs.ts');

// --- QR copy: never by name, only a provably current, untouched copy. ---
{
  assert.equal(stableJson({ b: 1, a: [{ d: 2, c: 3 }] }), stableJson({ a: [{ c: 3, d: 2 }], b: 1 }), 'key order never matters (the database reorders keys)');
  const qr = { id: 'q', type: 'qr', x: 10, y: 10, width: 120, height: 120, isStatic: false, fieldName: 'tag', errorCorrection: 'M' };
  const text = { id: 't', type: 'text', x: 140, y: 10, width: 200, height: 40, isStatic: false, fieldName: 'name', fontFamily: 'Liberation Sans' };
  const wanted = { formatId: 'f', thermalRenderMode: 'bitmap-v1', elements: [text, qr] };
  const saved = { id: 'copy-1', name: 'Flower (QR code)', formatId: 'f', thermalRenderMode: 'bitmap-v1', archivedAt: null, elements: JSON.parse(JSON.stringify([text, qr])) };
  const record = { copyId: 'copy-1', made: designFingerprint(wanted), saved: designFingerprint(saved) };
  // The server hands the copy back with its keys in another order: still the same copy.
  const reordered = { ...saved, elements: saved.elements.map((el) => Object.fromEntries(Object.entries(el).reverse())) };
  assert.equal(qrCopyStillMatches(record, reordered, wanted), true, 'the same copy of the same design is reused');
  // Scenario A: the original changed since the copy was made (a corrected THC position).
  const moved = { ...wanted, elements: [{ ...text, y: 30 }, qr] };
  assert.equal(qrCopyStillMatches(record, saved, moved), false, 'a stale copy is never reused');
  // Scenario B: the copy was edited by hand, renamed, archived, or is another design.
  assert.equal(qrCopyStillMatches(record, { ...saved, elements: [text, { ...qr, width: 60 }] }, wanted), false, 'a hand-edited copy is never reused');
  assert.equal(qrCopyStillMatches(record, { ...saved, archivedAt: '2026-11-10T00:00:00Z' }, wanted), false, 'an archived copy is never reused');
  assert.equal(qrCopyStillMatches(record, { ...saved, id: 'other' }, wanted), false, 'only the copy this device made');
  assert.equal(qrCopyStillMatches(record, { ...saved, formatId: 'g' }, wanted), false, 'another label size is another design');
  assert.equal(qrCopyStillMatches(record, { ...saved, thermalRenderMode: 'native-v1' }, wanted), false, 'another renderer is another design');
  assert.equal(qrCopyStillMatches(null, saved, wanted), false, 'with no record (another device, storage cleared) a fresh copy is made');
  assert.equal(freshQrCopyName('Flower', []), 'Flower (QR code)');
  assert.equal(freshQrCopyName('Flower', ['Flower (QR code)', 'Flower (QR code 2)']), 'Flower (QR code 3)', 'a fresh copy never shares a name');
  // Storage round trip, and a broken record reads as none.
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  saveQrCopy(storage, 't-1', record);
  assert.deepEqual(readQrCopy(storage, 't-1'), record);
  store.set(qrCopyKey('t-2'), '{"copyId":3}');
  assert.equal(readQrCopy(storage, 't-2'), null);
  assert.equal(readQrCopy(null, 't-1'), null);
  saveQrCopy({ setItem() { throw new Error('quota'); } }, 't-3', record); // never throws
}

// --- Picture designs: characters the bundled fonts can't draw, as the run page sees them. ---
{
  const format = { id: 'f', type: 'thermal', width: 3, height: 1, dpi: 203 };
  const name = { id: 'n', type: 'text', x: 10, y: 10, width: 400, height: 40, isStatic: false, fieldName: 'strain', fontFamily: 'Liberation Sans', fontWeight: 'normal' };
  const sku = { id: 'b', type: 'barcode', x: 10, y: 60, width: 560, height: 120, rotation: 0, isStatic: false, fieldName: 'sku', barcodeFormat: 'CODE128', showText: true };
  const template = { thermalRenderMode: 'bitmap-v1', elements: [name, sku] };
  const rows = Array.from({ length: 12 }, (_, i) => ({ strain: `Strain ${i + 1}`, sku: `SKU${i + 1}` }));
  rows[3].strain = 'Dragon 龍 Kush 3.5g';
  rows[6].strain = 'Star ★ Haze 3.5g';
  rows[8].strain = 'Crème Brûlée';
  const run = { sourceData: rows, fieldMappings: { strain: { mode: 'column', csvColumn: 'strain' }, sku: { mode: 'column', csvColumn: 'sku' } }, staticValues: {} };
  const check = wizardGlyphCheck(template, format, run);
  assert.deepEqual(check.labels, [4, 7], 'the same labels the run page stops');
  assert.deepEqual(check.labels, checkRunBitmapGlyphs(template, format, run).labels, 'agrees with the run page check');
  assert.deepEqual(check.chars.sort(), ['★', '龍'].sort());
  const items = glyphProblemItems(check, () => true);
  assert.equal(items.items.length, 2);
  assert.match(items.items[0], /^Label 4 \(row 5 in your file\): Strain has “龍”$/);
  assert.match(items.items[1], /^Label 7 \(row 8 in your file\): Strain has “★”$/);
  // A printer-font (native) design is never stopped here (the printer prints a box).
  assert.deepEqual(wizardGlyphCheck({ ...template, thermalRenderMode: 'native-v1' }, format, run).labels, []);
  // A barcode value the barcode can't hold is the barcode check's, never named twice.
  const badSku = rows.map((r, i) => (i === 1 ? { ...r, sku: 'X★' } : r));
  assert.deepEqual(wizardGlyphCheck(template, format, { ...run, sourceData: badSku }).labels, [4, 7]);
  // The barcode's number is checked when it shows (every value it can hold has glyphs today).
  assert.deepEqual(wizardGlyphCheck({ ...template, elements: [{ ...sku, isStatic: true, content: 'ABC-123' }] }, format, run).labels, []);
  // A fixed text stops every label, and says to change the design.
  const fixed = wizardGlyphCheck({ ...template, elements: [{ ...name, isStatic: true, content: 'Top ★ pick' }] }, format, run);
  assert.deepEqual(fixed.labels, [0]);
  assert.match(glyphProblemItems(fixed, () => true).items[0], /A fixed text on the label has “★”\. Change it in the design\./);
}

// --- The page: wiring that the browser checks also cover. ---
{
  const page = fs.readFileSync(path.join(__dirname, '../../src/app/runs/new/page.tsx'), 'utf8');
  assert.doesNotMatch(page, /t\.name === name/, 'a design is never picked by its name');
  assert.match(page, /qrCopyStillMatches\(record, saved, wanted\)/, 'a QR copy is reused only when proved current');
  assert.match(page, /if \(duplicateFrom && qrIntent && qrCopy\?\.tone === 'ok' && qrCopy\.to === template\.id\) \{\s*try \{ window\.localStorage\.setItem\(`lw:qr-replaces:\$\{run\.id\}`, duplicateFrom\); \} catch/, 'the QR run is linked to the run it replaces, explicitly');
  assert.match(page, /layoutOk &&\s*glyphsOk &&/, 'characters a picture design can’t draw hold Start');
  assert.match(page, /This makes a new run from label 1\./, 'a re-run of an open run says the old run is still open');
  assert.match(page, /We couldn’t open that run/, 'a run that can’t be loaded says so');
  assert.match(page, /plainServerError\(error, 'Something went wrong on our side, so the run didn’t start\./, 'server errors are plain words, raw text behind Details');
  assert.match(page, /Choose a column for \{friendlyFieldName\(field\)\}/, 'a missing column offers choosing one first');
  assert.match(page, /Sort out the problem in Review to start\./, 'the footer points to Review instead of repeating the problem');
  const designer = fs.readFileSync(path.join(__dirname, '../../src/app/designer/page.tsx'), 'utf8');
  assert.doesNotMatch(designer, /copy-note/, 'the picture copy is explained once, in its dialog');
}

console.log('PASS: wizard round 15 (QR copy reuse, QR link, picture-design characters, plain errors)');
