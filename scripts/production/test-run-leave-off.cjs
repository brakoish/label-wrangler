/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
// "Leave a part off this run" and the Nabis "leave them off" tick: the left-off
// parts are gone from the checks, the picture and the run's saved design, so
// Start unlocks and nothing (not the design's sample) prints there.
const h = require('./route-harness.cjs');
const assert = require('node:assert/strict');
const { leaveFieldsOff } = require('../../src/lib/runLeaveOff.ts');
const { checkRunData, blankCheckAllowsPrinting } = require('../../src/lib/runDataCheck.ts');
const { validate } = require('../../src/lib/validation.ts');
const { missingDetailFields, runMissingDetails } = require('../../src/lib/nabisDetails.ts');
const { blankPreviewItems } = require('../../src/lib/runPreviewBlanks.ts');

const text = (fieldName, extra = {}) => ({ id: 'txt-' + fieldName, type: 'text', isStatic: false, fieldName, x: 10, y: 20, width: 100, height: 30, rotation: 0, zIndex: 1, ...extra });
const template = {
  id: 't', name: 'Grandson', formatId: 'f',
  elements: [
    text('Product', { defaultValue: 'Blue Dream' }),
    text('Packaged', { defaultValue: '11/01/2026' }),
    { id: 'qr', type: 'qr', isStatic: false, fieldName: 'Lab Results Link', defaultValue: 'https://example.com', x: 200, y: 0, width: 80, height: 80, rotation: 0, zIndex: 2 },
    { id: 'logo', type: 'image', isStatic: true, src: 'data:image/png;base64,AA', x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 0 },
    { id: 'title', type: 'text', isStatic: true, content: 'Packaged', fieldName: 'Packaged', x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 0 },
  ],
};

(async () => {
  // The left-off part's items go; fixed text with the same name and pictures stay.
  const left = leaveFieldsOff(template, ['Packaged']);
  assert.deepEqual(left.elements.map((el) => el.id), ['txt-Product', 'qr', 'logo', 'title']);
  assert.equal(leaveFieldsOff(template, []), template, 'nothing left off: the same design');
  assert.equal(template.elements.length, 5, 'the shared design is never changed');

  // products20.csv has no Packaged column: the check stops Start, until it's left off.
  const run = { sourceData: [{ name: 'A', link: 'https://a' }, { name: 'B', link: 'https://b' }], fieldMappings: { Product: { mode: 'column', csvColumn: 'name' }, 'Lab Results Link': { mode: 'column', csvColumn: 'link' } }, staticValues: {} };
  const before = checkRunData(template, run);
  assert.equal(before.issues.length, 1);
  assert.equal(before.issues[0].field, 'Packaged');
  assert.equal(blankCheckAllowsPrinting(before, false), false, 'a part with no value stops Start');
  const after = checkRunData(left, run);
  assert.equal(after.issues.length, 0, 'left off: nothing missing, so Start can unlock');

  // The run request carries the left-off parts only when a run is made.
  validate({ name: 'Run', templateId: 't', leaveOff: ['Packaged'] }, 'run', true);
  assert.throws(() => validate({ leaveOff: ['Packaged'] }, 'run', false), /immutable/);
  assert.throws(() => validate({ name: 'Run', templateId: 't', leaveOff: 'Packaged' }, 'run', true), /parts left off/);
  assert.throws(() => validate({ name: 'Run', templateId: 't', leaveOff: [5] }, 'run', true), /part left off/);

  // The server saves the run's design without them, so every print leaves them off.
  const route = require('../../src/app/api/runs/route.ts');
  h.reset();
  h.results.push([{ template: JSON.parse(JSON.stringify(template)), format: { id: 'f', type: 'thermal', width: 2, height: 1 } }], []);
  const res = await route.POST(h.request('POST', { name: 'Run', templateId: 't', fieldMappings: run.fieldMappings, sourceData: run.sourceData, leaveOff: ['Packaged', 'Lab Results Link'] }));
  assert.equal(res.status, 201);
  const saved = await res.json();
  assert.deepEqual(saved.designSnapshot.template.elements.map((el) => el.id), ['txt-Product', 'logo', 'title'], 'saved design leaves the parts out');
  assert.equal('leaveOff' in saved, false, 'nothing else is stored');
  const inserted = h.log.find((calls) => calls[0][0] === 'insert');
  const values = inserted.find(([key]) => key === 'values')[1][0];
  assert.deepEqual(values.designSnapshot.template.elements.map((el) => el.id), ['txt-Product', 'logo', 'title']);
  // An old tab (no leaveOff) keeps the whole design, as before.
  h.reset();
  h.results.push([{ template: JSON.parse(JSON.stringify(template)), format: { id: 'f', type: 'thermal', width: 2, height: 1 } }], []);
  const old = await (await route.POST(h.request('POST', { name: 'Run', templateId: 't', sourceData: [] }))).json();
  assert.equal(old.designSnapshot.template.elements.length, 5);
  console.log('PASS leave a part off: checks, run request and saved run design leave it out');

  // Nabis didn't send lab potency or retail IDs: exactly those parts are left off.
  const nabisRows = [{ itemName: 'Blue Dream', thcPercent: '', retailId: '', detailsMissing: 'retailIds labPotency' }];
  const nabisMap = { Strain: { mode: 'column', csvColumn: 'itemName' }, THC: { mode: 'column', csvColumn: 'thcPercent' }, QR: { mode: 'column', csvColumn: 'retailId' } };
  const gap = runMissingDetails(nabisRows, nabisMap);
  assert.deepEqual(gap.labels, [1]);
  assert.deepEqual(missingDetailFields(nabisRows, nabisMap, gap.labels).sort(), ['QR', 'THC']);
  assert.deepEqual(missingDetailFields([{ ...nabisRows[0], thcPercent: '21%' }], nabisMap, gap.labels), ['QR'], 'a value that did arrive stays on');
  const nabisDesign = { elements: [text('Strain'), text('THC', { defaultValue: '25%' }), { id: 'q', type: 'qr', isStatic: false, fieldName: 'QR', defaultValue: 'X' }] };
  const blank = checkRunData(nabisDesign, { sourceData: nabisRows, fieldMappings: nabisMap });
  assert.equal(blankCheckAllowsPrinting(blank, true), false, 'a blank THC would print the sample 25%');
  const ticked = checkRunData(leaveFieldsOff(nabisDesign, ['THC', 'QR']), { sourceData: nabisRows, fieldMappings: { Strain: nabisMap.Strain } });
  assert.equal(ticked.issues.length, 0, 'ticked: nothing missing, so Start can unlock');
  console.log('PASS Nabis tick leaves the missing parts off, so Start unlocks and no sample prints');

  // The picture never shows the sample for a part with no value.
  const shown = blankPreviewItems(template, [{ Product: 'A', Packaged: '', 'Lab Results Link': 'https://a' }], ['Product', 'Packaged', 'Lab Results Link']);
  assert.deepEqual(shown.emptyFields, ['Packaged']);
  assert.deepEqual(shown.template.elements.map((el) => el.id), ['txt-Product', 'qr', 'logo', 'title']);
  assert.deepEqual(shown.boxes, [{ lane: 0, x: 10, y: 20, width: 100, height: 30 }]);
  const pair = blankPreviewItems(template, [{ Packaged: '' }, { Packaged: '11/02' }], ['Packaged']);
  assert.deepEqual(pair.emptyFields, [], 'a part with a value on one of the pair is drawn');
  const plain = blankPreviewItems({ elements: [text('Note')] }, [{ Note: '' }], ['Note']);
  assert.deepEqual(plain.emptyFields, [], 'text with no sample prints as it is, so it stays');
  console.log('PASS review picture leaves out the design sample for parts with no value');
})().catch((error) => { console.error(error); process.exit(1); });
