/* eslint-disable @typescript-eslint/no-require-imports */
require('./register.cjs');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { renderThermalBitmap } = require('../../src/lib/thermal/render.server.ts');
const { decodeBitmapZpl, unpackMonochrome } = require('../../src/lib/thermal/bitmap.ts');
(async () => {
  const format = { id: 'f', type: 'thermal', width: 2, height: 1, dpi: 203 };
  for (const lineStyle of ['dotted', 'dashed']) for (const rotation of [0, 90, 180, 270]) {
    let previous = 0;
    for (const strokeWidth of [1, 3]) {
      const template = { id: 't', thermalRenderMode: 'bitmap-v1', elements: [{ id: 'line', type: 'line', x: 120, y: 85, width: 100, height: 1, rotation, zIndex: 0, isStatic: true, color: '#000000', strokeWidth, lineStyle }] };
      const proof = await renderThermalBitmap(template, format);
      const raw = await sharp(Buffer.from(proof.proof.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer();
      const decoded = decodeBitmapZpl(proof.zpl);
      assert.deepEqual(Buffer.from(unpackMonochrome(decoded.packed, decoded.width, decoded.height)), raw);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let y = 0; y < proof.height; y++) for (let x = 0; x < proof.width; x++) if (raw[(y * proof.width + x) * 4] < 128) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      const thickness = rotation % 180 ? maxX - minX + 1 : maxY - minY + 1;
      assert(thickness >= Math.floor(strokeWidth * 203 / 72), 'dot diameter must not be clipped to one-pixel line height');
      assert(thickness > previous); previous = thickness;
      assert(Math.abs((rotation % 180 ? (minX + maxX) / 2 : (minY + maxY) / 2) - (rotation % 180 ? 170 : 85.5)) <= 2, 'weight preserves line center');
    }
  }
  console.log('PASS full dotted/dashed thickness at 1pt/3pt and all quarter turns; stable center; exact preview/ZPL pixel parity');
})().catch(error => { console.error(error); process.exitCode = 1; });
