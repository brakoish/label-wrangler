/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
// Office Z64 graphics and native ZPL field fixes (QR level, ^BY order, ^CI28,
// ^FH escaping). Offline: no database, no network, no printer or print station.
require('../thermal/register.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { inflateSync } = require('node:zlib');
const sharp = require('sharp');
const { crc16Xmodem, compressGraphicFields, expandGraphicFields } = require('../../src/lib/thermal/z64.ts');
const { decodeBitmapZpl } = require('../../src/lib/thermal/bitmap.ts');
const { renderThermalBitmap } = require('../../src/lib/thermal/render.server.ts');
const { importNaturalDesign } = require('../../src/lib/thermal/import.ts');
const { buildBatches, prepareServerImages } = require('../../src/lib/office/render.ts');
const { generateZPL, zplQrGeometry } = require('../../src/lib/zplGenerator.ts');
const { thermalRenderGeometry } = require('../../src/lib/thermal/geometry.ts');

let passed = 0;
const ok = name => { passed++; console.log('PASS ' + name); };
const decode = b => Buffer.from(b.payload, 'base64').toString();
let renderer;
async function render(zpl, format) {
  renderer = renderer || (await require('zpl-renderer-js').ready).api;
  const g = thermalRenderGeometry(format);
  const png = Buffer.from(await renderer.zplToBase64Async(zpl, g.linerIn * 25.4, g.heightIn * 25.4, g.dpmm), 'base64');
  return sharp(png).greyscale().raw().toBuffer();
}

(async () => {
  // --- Z64 helper -----------------------------------------------------------
  assert.equal(crc16Xmodem('123456789'), 0x31C3);
  assert.equal(crc16Xmodem(''), 0);
  const bytes = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 37) & 0xff));
  const hex = bytes.toString('hex').toUpperCase();
  const source = `^XA\n^FO0,0^GFA,300,300,10,${hex}^FS\n^FO0,40^GFA,2,2,1,ff00^FS\n^XZ`;
  const packed = compressGraphicFields(source);
  const fields = [...packed.matchAll(/\^GFA,(\d+),(\d+),(\d+),:Z64:([A-Za-z0-9+/=]+):([0-9A-F]{4})\^FS/g)];
  assert.equal(fields.length, 2);
  assert.deepEqual(fields.map(m => [m[1], m[2], m[3]]), [['300', '300', '10'], ['2', '2', '1']]);
  assert.deepEqual(inflateSync(Buffer.from(fields[0][4], 'base64')), bytes);
  assert.deepEqual(inflateSync(Buffer.from(fields[1][4], 'base64')), Buffer.from([0xff, 0x00]));
  assert.equal(fields[0][5], crc16Xmodem(fields[0][4]).toString(16).toUpperCase().padStart(4, '0'));
  assert.equal(expandGraphicFields(packed), source.replace('ff00', 'FF00'));
  assert.equal(compressGraphicFields(packed), packed, 'already-compressed fields untouched');
  for (const untouched of ['^GFA,4,4,1,FFG0^FS', '^GFA,3,3,1,FFFF^FS', '^GFA,2,2,1,:B64:AAA=:1234^FS', '^GFB,2,2,1,FFFF^FS', '^FDNo graphics^FS'])
    assert.equal(compressGraphicFields(untouched), untouched);
  assert.throws(() => expandGraphicFields(packed.replace(/:([0-9A-F]{4})\^FS/, ':0000^FS')), /CRC/);
  ok('Z64: CRC-16/XMODEM vector, zlib round trip, non-hex and compressed fields untouched');

  // Labelary-compatible renderer draws Z64 exactly like hex.
  const fmt = { id: 'f', type: 'thermal', width: 2, height: 1, dpi: 203, labelsAcross: 1 };
  const art = Buffer.alloc(51 * 120); for (let i = 0; i < art.length; i++) art[i] = (i * 2654435761 >>> 24) & 0xff;
  const hexLabel = `^XA^PW406^LL203^FO10,10^GFA,${art.length},${art.length},51,${art.toString('hex').toUpperCase()}^FS^XZ`;
  const hexPixels = await render(hexLabel, fmt);
  assert.ok(hexPixels.some(v => v < 128) && hexPixels.some(v => v >= 128), 'hex graphic drew something');
  assert.deepEqual(await render(compressGraphicFields(hexLabel), fmt), hexPixels);
  ok('Z64 graphic renders pixel-identical to hex');

  // --- Office bitmap path ---------------------------------------------------
  const lemon = importNaturalDesign(JSON.parse(fs.readFileSync('scripts/thermal/fixtures/Lemon-Cherry-Gelato-Your-Edits.label.json')));
  const run = { staticValues: {}, fieldMappings: {}, sourceData: Array.from({ length: 25 }, () => ({})) };
  const proof = await renderThermalBitmap(lemon.template, lemon.format);
  const batches = await buildBatches(run, lemon.template, lemon.format, 1, 25, 203, 448);
  assert.equal(batches.length, 1);
  const payload = decode(batches[0]);
  assert.equal(batches[0].sha256, createHash('sha256').update(Buffer.from(batches[0].payload, 'base64')).digest('hex'));
  assert.ok(!/\^GFA,\d+,\d+,\d+,[0-9A-F]/.test(payload), 'no hex graphics left on the Office path');
  assert.ok(payload.includes(':Z64:'));
  const feeds = payload.match(/\^XA[\s\S]*?\^XZ/g);
  assert.equal(feeds.length, 25);
  for (const feed of feeds) {
    assert.ok(feed.startsWith('^XA\n^PON\n^LH0,0\n^LT0\n^LS0\n^PQ1\n^FXLWBITMAP1:'));
    assert.deepEqual(decodeBitmapZpl(expandGraphicFields(feed)).packed, decodeBitmapZpl(proof.zpl).packed);
  }
  // jobs.ts/preview.ts read the pixel digest from the untouched ^FX tag.
  const digests = [...payload.matchAll(/\^FXLWBITMAP1:[a-f0-9]{64}:([a-f0-9]{64})\^FS/g)].map(m => m[1]);
  assert.deepEqual(digests, Array(25).fill(proof.pixelDigest));
  const hexBytes = Buffer.byteLength(expandGraphicFields(payload)), z64Bytes = Buffer.byteLength(payload);
  assert.ok(z64Bytes < hexBytes / 2, `Z64 batch ${z64Bytes} B vs hex ${hexBytes} B`);
  console.log(`  25-label Lemon bitmap batch: hex ${hexBytes} B -> Z64 ${z64Bytes} B (${(hexBytes / 25 / 1024).toFixed(1)} KB -> ${(z64Bytes / 25 / 1024).toFixed(1)} KB per label)`);
  ok('Office bitmap batch: Z64 strips, ^FX proof digests intact, pixels unchanged, sha256 over sent bytes');

  // --- Office native path (logo + text + QR + barcode) ----------------------
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="black"/></svg>').toString('base64');
  const logo = { id: 'logo', type: 'image', x: 5, y: 5, width: 40, height: 40, rotation: 0, zIndex: 0, isStatic: true, objectFit: 'contain', src: 'data:image/svg+xml;base64,' + svg };
  const text = { id: 'text', type: 'text', x: 60, y: 10, width: 300, height: 40, rotation: 0, zIndex: 1, isStatic: false, fieldName: 'name', fontSize: 9, lineHeight: 1.2, textAlign: 'left', content: '', fontWeight: 'normal' };
  const qr = { id: 'qr', type: 'qr', x: 300, y: 60, width: 100, height: 100, rotation: 0, zIndex: 1, isStatic: false, fieldName: 'url', errorCorrection: 'H', content: '' };
  const bar = { id: 'bar', type: 'barcode', x: 10, y: 80, width: 280, height: 80, rotation: 0, zIndex: 1, isStatic: false, fieldName: 'tag', barcodeFormat: 'CODE128', showText: false, content: '' };
  const native = { id: 'n', name: 'Native', formatId: 'f', elements: [logo, text, qr, bar] };
  const nativeRun = { staticValues: {}, fieldMappings: { name: { mode: 'column', csvColumn: 'name' }, url: { mode: 'column', csvColumn: 'url' }, tag: { mode: 'column', csvColumn: 'tag' } },
    sourceData: [{ name: 'Lemon_Cherry Gelato', url: 'https://example.test/p/1', tag: '1A40603000012345' }] };
  const office = decode((await buildBatches(nativeRun, native, fmt, 1, 1, 203, 448))[0]);
  const logoHex = (await prepareServerImages(native, fmt)).logo.graphic;
  assert.ok(logoHex.startsWith('^GFA,') && !logoHex.includes(':Z64:'), 'prepared logo stays hex; compression happens in buildBatches');
  assert.ok(office.includes(':Z64:'));
  assert.ok(office.startsWith('^XA\n^PON\n^LH0,0\n^LT0\n^LS0\n^PQ1\n^CI28\n^PW406\n'), 'Office resets land after ^XA and ^CI28 survives');
  assert.ok(expandGraphicFields(office).includes(logoHex));
  assert.ok(office.includes('^FH_^FDLemon_5FCherry Gelato^FS'));
  ok('Office native batch: logo Z64, ^CI28 kept after Office resets, ^FH escaping');

  // --- Native generator fixes (local + Office) ------------------------------
  const values = { name: 'A^B~C_D\\E', url: 'https://example.test/q?a=1', tag: '1A40603000012345' };
  const zpl = generateZPL(native, fmt, values);
  assert.ok(zpl.startsWith('^XA\n^CI28\n^PW406\n^LL203\n'));
  assert.equal(zpl.match(/\^CI28/g).length, 1);
  assert.ok(zpl.includes('^FH_^FDA_5EB_7EC_5FD\\\\E^FS'), 'text: ^ ~ _ hex-escaped, backslash doubled for ^FB');
  assert.ok(!/\\\^|\\~/.test(zpl), 'no invalid backslash escapes');
  // QR: level is the first data character and matches the sized geometry.
  for (const ec of ['L', 'M', 'Q', 'H']) {
    const q = generateZPL({ ...native, elements: [{ ...qr, errorCorrection: ec }] }, fmt, values);
    const mag = zplQrGeometry(values.url, ec, qr.width).magnification;
    assert.ok(q.includes(`^BQN,2,${mag},${ec}^FD${ec}A,https://example.test/q?a=1^FS`), q);
  }
  for (const legacy of ['', 'm', undefined]) assert.ok(generateZPL({ ...native, elements: [{ ...qr, errorCorrection: legacy }] }, fmt, values).includes('^FDMA,'));
  assert.ok(generateZPL({ ...native, elements: [{ ...qr, isStatic: true, content: 'X_Y' }] }, fmt, {}).includes('^FH_^FDHA,X_5FY^FS'));
  // Barcode: ^BY2 precedes the symbol it sizes; nothing trails the field.
  assert.ok(zpl.includes('^BY2^BCN,60,N,N,N^FD1A40603000012345^FS'));
  assert.ok(!/\^FS\^BY/.test(zpl));
  for (const format of ['CODE39', 'UPC', 'EAN13', 'EAN8', 'ITF14']) assert.ok(/\^BY2\^B[3UE8I]/.test(generateZPL({ ...native, elements: [{ ...bar, barcodeFormat: format }] }, fmt, values)));
  assert.ok(generateZPL({ ...native, elements: [{ ...bar }] }, fmt, { tag: 'A\\B' }).includes('^FDA\\B^FS'), 'barcode data keeps one backslash');
  assert.ok(generateZPL({ ...native, elements: [{ ...text }] }, fmt, { name: 'Plain' }).includes('^FB300,1,5,L,0^FDPlain^FS'), 'no ^FH when nothing needs escaping');
  assert.ok(generateZPL({ ...native, elements: [{ ...text, rotation: 90 }] }, fmt, { name: 'R^T' }).includes('^FH_^FDR_5ET^FS'), 'rotated text lines escaped');
  assert.ok(generateZPL({ ...native, elements: [{ ...text }] }, fmt, { name: 'a–b c' }).includes('^FDa-b c^FS'), 'font-0 glyph replacements kept');
  ok('generator: ^CI28 after ^XA, QR level in data, ^BY2 before barcodes, ^FH hex escaping');

  // Renders: escaped text draws the real characters; ^CI28 + UTF-8 accepted.
  const plainText = { ...native, elements: [{ ...text, x: 10, width: 380 }] };
  const escapedZpl = generateZPL(plainText, fmt, { name: 'A^B~C' });
  const ink = px => px.reduce((n, v) => n + (v < 128 ? 1 : 0), 0);
  const escaped = await render(escapedZpl, fmt), literal = await render(escapedZpl.replace('^FH_', ''), fmt);
  assert.ok(ink(escaped) > 0 && ink(escaped) < ink(literal), 'renderer decodes ^FH (A^B~C draws less than literal A_5EB_7EC)');
  const withHex = await render(generateZPL({ ...native, elements: [{ ...qr }, { ...bar }] }, fmt, values), fmt);
  assert.ok(withHex.some(v => v < 128));
  ok('renderer accepts ^CI28, ^FH fields, ^BY2-first barcodes and level-prefixed QR');

  console.log(`${passed} checks passed`);
})().catch(error => { console.error(error); process.exit(1); });
