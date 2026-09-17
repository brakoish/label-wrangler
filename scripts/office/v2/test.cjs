/* eslint-disable @typescript-eslint/no-require-imports */
// Offline synthetic fixtures only. Does not load env, database or print transports.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(specifier, ...rest) { return resolve.call(this, specifier.startsWith('@/') ? path.resolve('src', specifier.slice(2)) : specifier, ...rest); };
require.extensions['.ts'] = function(mod, file) { mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file); };
const { generateZPL } = require('../../../src/lib/zplGenerator.ts');
const { prepareServerImages, validateLayout } = require('../../../src/lib/office/render.ts');
(async () => {
  const { prepare, validate, verifyChunk, decodeManifest, hash, limits } = await import('./manifest.mjs');
  const logo = { id: 'logo', type: 'image', x: 0, y: 0, width: 8, height: 8, rotation: 0, zIndex: 0, objectFit: 'contain', src: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="black"/></svg>').toString('base64') };
  const qr = { id: 'qr', type: 'qr', x: 10, y: 10, width: 60, height: 60, rotation: 0, zIndex: 1, isStatic: false, fieldName: 'qr', errorCorrection: 'M', content: '' };
  const template = { elements: [logo, qr] };
  const results = [];
  for (const across of [1, 2, 3, 4]) {
    const format = { type: 'thermal', width: 0.5, height: 1, dpi: 203, labelsAcross: across };
    validateLayout(template, format, 203, 448);
    const imageGraphics = await prepareServerImages(template, format);
    const from = across === 1 ? 1 : 2, to = from + 4999;
    const metadata = { print_run_id: randomUUID(), snapshot_sha256: hash(Buffer.from('synthetic snapshot')), station_id: 'fixture', printer_id: 'fixture', range_from: from, range_to: to, labels_across: across };
    const stored = new Map();
    async function* feeds() {
      for (let first = Math.floor((from - 1) / across) * across + 1; first <= to; first += across) {
        const lanes = Array.from({ length: across }, (_, lane) => first + lane >= from && first + lane <= to ? first + lane : null);
        const values = lanes.map(n => n === null ? undefined : { qr: 'https://example.invalid/record/' + String(n).padStart(5, '0') });
        const bytes = Buffer.from(generateZPL(template, format, values, { imageGraphics }).replace('^XA', '^XA\n^PON\n^LH0,0\n^LT0\n^LS0\n^PQ1'));
        yield { bytes, lanes };
      }
    }
    const sealed = await prepare(metadata, feeds(), (c, bytes) => stored.set(c.chunk_id, bytes), 4096);
    assert.deepEqual(decodeManifest(sealed.response).bytes, sealed.bytes);
    const seen = [];
    for (const c of sealed.manifest.chunks) {
      const bytes = stored.get(c.chunk_id);
      assert.deepEqual(verifyChunk(c, bytes), verifyChunk(c, bytes)); // identical repeated download
      for (const f of c.feeds) {
        const text = bytes.subarray(f.byte_offset, f.byte_offset + f.byte_count).toString();
        assert.ok(text.includes('^GFA')); assert.ok(text.includes('^PON'));
        const records = [...text.matchAll(/https:\/\/example\.invalid\/record\/(\d{5})/g)].map(m => Number(m[1]));
        assert.deepEqual(records, f.lanes.filter(n => n !== null)); seen.push(...records);
      }
    }
    assert.deepEqual(seen, Array.from({ length: 5000 }, (_, i) => from + i));
    for (const mutate of [m => m.chunks[0].feeds[0].byte_offset++, m => m.chunks[0].feeds[0].lanes.reverse(), m => m.total_bytes++, m => m.chunks[0].extra = true, m => m.chunks[0].sha256 = 'bad']) {
      const copy = structuredClone(sealed.manifest); mutate(copy);
      if (JSON.stringify(copy) !== JSON.stringify(sealed.manifest)) assert.throws(() => validate(copy));
    }
    const c = sealed.manifest.chunks[0], corrupt = Buffer.from(stored.get(c.chunk_id)); corrupt[0] ^= 1;
    assert.throws(() => verifyChunk(c, corrupt));
    const response = JSON.parse(sealed.response); response.manifest_bytes++; assert.throws(() => decodeManifest(Buffer.from(JSON.stringify(response))));
    await assert.rejects(prepare(metadata, [{ bytes: Buffer.alloc(limits.chunk + 1), lanes: [1] }], () => {}));
    await assert.rejects(prepare({ ...metadata, range_to: from + 5000 }, [], () => {}));
    results.push({ across, labels: seen.length, feeds: sealed.manifest.feed_count, chunks: sealed.manifest.chunks.length, payloadBytes: sealed.manifest.total_bytes, manifestBytes: sealed.bytes.length });
  }
  // Descriptor ceiling: 5,000 one-feed chunks; 25 lane slots, 24 blank.
  const chunks = Array.from({ length: 5000 }, (_, i) => ({ chunk_id: randomUUID(), ordinal: i, label_count: 1, feed_count: 1, byte_count: 1, sha256: hash(Buffer.from('x')), feeds: [{ feed_ordinal: i, byte_offset: 0, byte_count: 1, lanes: Array(25).fill(null) }] }));
  const descriptorBytes = Buffer.byteLength(JSON.stringify(chunks));
  assert.ok(descriptorBytes < limits.manifest); // conservative descriptor size, not a valid range mapping
  const maxChunk = Buffer.alloc(limits.chunk);
  verifyChunk({ chunk_id: randomUUID(), byte_count: maxChunk.length, sha256: hash(maxChunk) }, maxChunk);
  console.log(JSON.stringify({ status: 'passed', scope: 'offline synthetic preparation fixtures only', results, descriptorCeilingBytes: descriptorBytes, durableWorkerTested: false, physicalPrintingTested: false }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
