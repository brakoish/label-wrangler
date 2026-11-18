/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
// A design where nothing changes per label can still make a run: New run asks
// how many labels and saves that many empty rows. Offline: no database, no
// network, no printer.
require('../thermal/register.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { buildBatches } = require('../../src/lib/office/render.ts');

let passed = 0;
const ok = name => { passed++; console.log('PASS ' + name); };

(async () => {
  const page = fs.readFileSync('src/app/runs/new/page.tsx', 'utf8');
  assert.ok(!page.includes('Nothing on this design changes per label'), 'the blocking message is gone');
  assert.match(page, /const fixedDesign = !!template && allDynamicFields\.length === 0;/);
  assert.match(page, /fixedDesign \|\| \(allDynamicFields\.length > 0 && dynamicFields\.length > 0\)/, 'fixed designs count as filled in');
  assert.match(page, /allDynamicFields\.length > 0 \|\| fixedDesign/, 'fixed designs show the rest of the form');
  assert.ok((page.match(/\{qtyField\}/g) || []).length >= 2, 'the same quantity box serves Type mode and fixed designs');
  assert.match(page, /setInputMode\('manual'\)/, 'fixed designs switch to the quantity path');
  ok('New run: a fixed design asks how many labels instead of blocking');

  // What the page saves for a fixed design: N empty rows, no mappings.
  const fmt = { id: 'f', type: 'thermal', width: 0.5, height: 0.5, dpi: 203, labelsAcross: 1 };
  const t = (id, y, content) => ({ id, type: 'text', x: 2, y, width: 44, height: 12, rotation: 0, zIndex: 0, isStatic: true, content, fontSize: 6, lineHeight: 1.1, textAlign: 'center', fontWeight: 'bold' });
  const template = { id: 'tc', name: 'Net Wt Tokin Chews', formatId: 'f', elements: [t('a', 4, 'NET WT'), t('b', 18, '2.9 OZ'), t('c', 32, '(85g)')] };
  const copies = 3968;
  const run = { staticValues: {}, fieldMappings: {}, sourceData: Array.from({ length: copies }, () => ({})) };
  const batches = await buildBatches(run, template, fmt, 1, 498, 203, 448);
  const labels = batches.reduce((n, b) => n + b.count, 0);
  assert.equal(labels, 498);
  const zpl = batches.map(b => Buffer.from(b.payload, 'base64').toString()).join('\n');
  assert.equal((zpl.match(/\^XA/g) || []).length, 498, 'one label per row');
  assert.equal((zpl.match(/2\.9 OZ/g) || []).length, 498, 'the fixed text prints on every label');
  const last = await buildBatches(run, template, fmt, 3969 - 478, copies, 203, 448);
  assert.equal(last.reduce((n, b) => n + b.count, 0), 478);
  ok(`Office: a ${copies}-copy fixed run renders every label the same, in parts`);

  console.log(`\n${passed} fixed-design checks passed`);
})().catch(err => { console.error(err); process.exit(1); });
