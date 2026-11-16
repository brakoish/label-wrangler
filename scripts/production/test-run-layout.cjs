/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
// "Adjust for this run": the new run is made with its own layout of the
// design's items, the saved design never changes, and the designer's copy of
// a design for one run can never reach /api/templates.
const h = require('./route-harness.cjs');
const assert = require('node:assert/strict');
const sharp = require('sharp');

function fakeStorage() {
  const values = new Map();
  return { values, get length() { return values.size; }, key: (i) => [...values.keys()][i] ?? null, getItem: (k) => (values.has(k) ? values.get(k) : null), setItem: (k, v) => { values.set(k, String(v)); }, removeItem: (k) => { values.delete(k); } };
}
const local = fakeStorage();
const session = fakeStorage();
global.window = { localStorage: local, sessionStorage: session, dispatchEvent: () => true };

const { validate } = require('../../src/lib/validation.ts');
const { applyLayoutOverride, layoutOverrideFor, runLayoutId, isRunLayoutId, runLayoutSource } = require('../../src/lib/runLayout.ts');
const drafts = require('../../src/lib/runLayoutDraft.ts');

const text = (id, extra = {}) => ({ id, type: 'text', isStatic: true, content: id, x: 10, y: 20, width: 100, height: 30, rotation: 0, zIndex: 1, ...extra });

(async () => {
  const png = 'data:image/png;base64,' + (await sharp({ create: { width: 8, height: 6, channels: 4, background: '#ffffff' } }).png().toBuffer()).toString('base64');
  const design = {
    id: 't', name: 'Grandson', formatId: 'f', thermalRenderMode: 'native-v1', updatedAt: '2026-11-01T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z',
    elements: [
      text('title'),
      { id: 'strain', type: 'text', isStatic: false, fieldName: 'Strain', defaultValue: 'Blue Dream', x: 10, y: 60, width: 100, height: 30, rotation: 0, zIndex: 2 },
      { id: 'logo', type: 'image', isStatic: true, src: png, x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 0 },
    ],
  };

  // Ids: a run's copy is never a saved design id.
  assert.equal(runLayoutId('t'), 'rundraft:t');
  assert.equal(isRunLayoutId('rundraft:t'), true);
  assert.equal(isRunLayoutId('rundraft:'), false);
  assert.equal(isRunLayoutId('t'), false);
  assert.equal(runLayoutSource('rundraft:t'), 't');
  assert.equal(runLayoutSource('t'), null);

  // The request: the design's own picture goes without its data; a new one with it.
  const moved = design.elements.map((el) => (el.id === 'title' ? { ...el, x: 40, y: 5 } : el));
  const override = layoutOverrideFor(moved, design);
  assert.equal('src' in override.elements.find((el) => el.id === 'logo'), false, 'unchanged picture is not sent twice');
  assert.equal(override.elements.find((el) => el.id === 'title').x, 40);
  const other = 'data:image/png;base64,' + (await sharp({ create: { width: 3, height: 3, channels: 4, background: '#000000' } }).png().toBuffer()).toString('base64');
  assert.equal(layoutOverrideFor([{ ...design.elements[2], src: other }], design).elements[0].src, other, 'a changed picture is sent');
  console.log('PASS run layout ids and request shape');

  // Validation: like a design's items, only when a run is made, nothing else in it.
  validate({ name: 'Run', templateId: 't', layoutOverride: JSON.parse(JSON.stringify(override)) }, 'run', true);
  assert.throws(() => validate({ layoutOverride: { elements: [] } }, 'run', false), /immutable/);
  assert.throws(() => validate({ name: 'Run', templateId: 't', layoutOverride: [] }, 'run', true), /layout for this run/);
  assert.throws(() => validate({ name: 'Run', templateId: 't', layoutOverride: { elements: [], formatId: 'g' } }, 'run', true), /layout for this run field formatId/);
  assert.throws(() => validate({ name: 'Run', templateId: 't', layoutOverride: { elements: [], id: 'x' } }, 'run', true), /field id/);
  assert.throws(() => validate({ name: 'Run', templateId: 't', layoutOverride: { elements: 'x' } }, 'run', true), /elements/);
  assert.throws(() => validate({ name: 'Run', templateId: 't', layoutOverride: { elements: [text('a', { type: 'script' })] } }, 'run', true), /element type/);
  assert.throws(() => validate({ name: 'Run', templateId: 't', layoutOverride: { elements: [text('a', { width: -1 })] } }, 'run', true), /width/);
  assert.throws(() => validate({ name: 'Run', templateId: 't', layoutOverride: { elements: [text('a'), text('a')] } }, 'run', true), /duplicate/);
  assert.throws(() => validate({ name: 'Run', templateId: 't', layoutOverride: { elements: Array.from({ length: 501 }, (_, i) => text('e' + i)) } }, 'run', true), /elements/);
  assert.throws(() => validate({ name: 'Run', templateId: 't', layoutOverride: { elements: [{ ...design.elements[2], src: 'javascript:alert(1)' }] } }, 'run', true), /image source/);
  assert.throws(() => validate({ name: 'Run', templateId: 't', layoutOverride: { elements: [text('a', { style: { x: 1 } })] } }, 'run', true), /style/);
  // A picture without data is only allowed in a run's layout, never in a design.
  assert.throws(() => validate({ elements: [{ ...design.elements[2], src: undefined }] }, 'template'), /image source/);
  console.log('PASS run layout validation: same rules as a design, create only, nothing but items');

  // The server: the run's design has the adjusted items; id, name, label size stay the design's.
  const route = require('../../src/app/api/runs/route.ts');
  const capture = () => [{ template: JSON.parse(JSON.stringify(design)), format: { id: 'f', type: 'thermal', width: 2, height: 1, dpi: 203 } }];
  h.reset();
  h.results.push(capture(), []);
  const res = await route.POST(h.request('POST', { name: 'Run', templateId: 't', sourceData: [{ s: 'A' }], fieldMappings: { Strain: { mode: 'column', csvColumn: 's' } }, layoutOverride: override }));
  assert.equal(res.status, 201);
  const saved = await res.json();
  const snap = saved.designSnapshot;
  assert.equal(snap.adjusted, true, 'the run says its layout was adjusted');
  assert.equal(snap.template.id, 't');
  assert.equal(snap.template.formatId, 'f');
  assert.equal(snap.template.name, 'Grandson');
  assert.equal(snap.format.id, 'f');
  assert.deepEqual(snap.template.elements.find((el) => el.id === 'title'), { ...design.elements[0], x: 40, y: 5 });
  assert.equal(snap.template.elements.find((el) => el.id === 'logo').src, png, 'the design picture is taken from the design');
  assert.equal('layoutOverride' in saved, false, 'nothing else is stored');
  const inserted = h.log.find((calls) => calls[0][0] === 'insert')[0];
  assert.equal(inserted[1][0], require('../../src/lib/db/schema.ts').runs, 'only the runs table is written');
  assert.equal(h.log.filter((calls) => ['update', 'delete'].includes(calls[0][0])).length, 0, 'the saved design is not touched');

  // Left-off parts still apply to the adjusted layout.
  h.reset();
  h.results.push(capture(), []);
  const left = await (await route.POST(h.request('POST', { name: 'Run', templateId: 't', sourceData: [], layoutOverride: layoutOverrideFor(moved, design), leaveOff: ['Strain'] }))).json();
  assert.deepEqual(left.designSnapshot.template.elements.map((el) => el.id), ['title', 'logo']);
  assert.equal(left.designSnapshot.template.elements[0].x, 40);

  // A picture the design no longer has: refused in plain words, nothing saved.
  h.reset();
  h.results.push(capture(), []);
  const gone = await route.POST(h.request('POST', { name: 'Run', templateId: 't', sourceData: [], layoutOverride: { elements: [{ id: 'old-logo', type: 'image', isStatic: true, x: 0, y: 0, width: 1, height: 1, rotation: 0, zIndex: 0 }] } }));
  assert.equal(gone.status, 409);
  assert.match((await gone.json()).error, /no longer in the design/);
  assert.equal(h.log.some((calls) => calls[0][0] === 'insert'), false);

  // An old tab (no override): the design as it is, with no mark.
  h.reset();
  h.results.push(capture(), []);
  const plain = await (await route.POST(h.request('POST', { name: 'Run', templateId: 't', sourceData: [] }))).json();
  assert.deepEqual(plain.designSnapshot.template.elements, design.elements);
  assert.equal('adjusted' in plain.designSnapshot, false);
  assert.throws(() => applyLayoutOverride(design, { elements: [{ id: 'title', type: 'image' }] }), /no longer in the design/, 'a picture id that is text in the design is refused');
  console.log('PASS POST /api/runs: adjusted items in the run design, picture from the design, left-off parts still apply, saved design untouched');

  // The kept copy (this tab): one per design, never another design's.
  const copy = drafts.startRunLayout({ ...design, summaryOnly: false, elementCount: 3 });
  assert.equal(copy.template.id, 'rundraft:t');
  assert.equal('elementCount' in copy.template, false);
  assert.equal(copy.template.updatedAt, design.updatedAt, 'remembers which design it was taken from');
  assert.equal(drafts.runLayoutDiffers(copy, design), false, 'an untouched copy adjusts nothing');
  assert.equal(drafts.startRunLayout(design).savedAt, copy.savedAt, 'a kept copy is reused');
  assert.equal(drafts.readRunLayout('u'), null);
  session.setItem('lw:run-layout:u', session.getItem('lw:run-layout:t'));
  assert.equal(drafts.readRunLayout('u'), null, 'a copy of another design is never used');
  assert.equal(drafts.readRunLayout('t', session, Date.now() + 25 * 3600 * 1000), null, 'old copies are dropped');
  assert.throws(() => drafts.saveRunLayout({ ...copy.template, id: 'rundraft:u' }, 't'), /another design/);
  session.setItem('lw:new-run-draft', 'keep');
  drafts.clearAllRunLayouts();
  assert.deepEqual([...session.values.keys()], ['lw:new-run-draft'], 'only run layouts are cleared');
  session.removeItem('lw:new-run-draft');
  console.log('PASS kept copy: per design, reused, expires, never crosses designs');

  // The designer's store: a run's copy is kept in this tab and never sent to /api/templates.
  const { useTemplateStore, forgetRunLayoutsInStore } = require('../../src/lib/templateStore.ts');
  const { useFormatStore } = require('../../src/lib/store.ts');
  const calls = [];
  global.fetch = async (url, init) => { calls.push([String(url), init?.method ?? 'GET']); return new Response(JSON.stringify({ error: 'should not be called' }), { status: 500 }); };
  useFormatStore.setState({ formats: [{ id: 'f', name: '2x1', type: 'thermal', width: 2, height: 1, dpi: 203 }] });
  useTemplateStore.setState({ templates: [JSON.parse(JSON.stringify(design))] });
  const id = 'rundraft:t';
  assert.equal(await useTemplateStore.getState().fetchTemplate(id), 'ok');
  const store = () => useTemplateStore.getState();
  store().updateElementLocal(id, 'title', { x: 77 });
  await store().saveTemplate(id);
  await store().updateElement(id, 'strain', { y: 90 });
  await store().addElement(id, { type: 'line', x: 0, y: 100, width: 50, height: 0, rotation: 0, isStatic: true, strokeWidth: 2, color: '#000000' });
  await store().duplicateElement(id, 'title');
  await store().reorderElement(id, 'title', 3);
  await store().removeElement(id, 'logo');
  await store().updateTemplate(id, { elements: store().getTemplateById(id).elements });
  await assert.rejects(store().updateTemplate(id, { name: 'Renamed' }), /one run only/);
  await assert.rejects(store().updateTemplate(id, { formatId: 'g' }), /one run only/);
  await assert.rejects(store().updateTemplate(id, { archivedAt: '2026-11-16T00:00:00.000Z' }), /one run only/);
  await assert.rejects(store().deleteTemplate(id), /one run only/);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(calls, [], 'nothing was sent to the server');
  const kept = drafts.readRunLayout('t');
  assert.equal(kept.template.elements.find((el) => el.id === 'title').x, 77, 'the copy keeps the changes');
  assert.equal(kept.template.elements.some((el) => el.id === 'logo'), false);
  assert.equal(kept.template.name, 'Grandson');
  assert.deepEqual(store().getTemplateById('t').elements, design.elements, 'the saved design is unchanged');
  assert.equal([...local.values.keys()].some((k) => k.includes('rundraft')), false, 'no recovery copy that could be saved as a design');
  // Reopened: always this tab's copy, never a stale one.
  forgetRunLayoutsInStore();
  assert.equal(store().getTemplateById(id), undefined, 'leaving the designer: not in the design list');
  assert.equal(store().getTemplateById('t').id, 't');
  assert.equal(await store().fetchTemplate(id), 'ok');
  assert.equal(store().getTemplateById(id).elements.find((el) => el.id === 'title').x, 77);
  // Items a design couldn't save aren't kept for a run either (the run could not be made from them).
  await assert.rejects(store().updateElement(id, 'title', { width: -5 }), /width/);
  assert.equal(drafts.readRunLayout('t').template.elements.find((el) => el.id === 'title').width, 100);
  await store().updateElement(id, 'title', { width: 100 });
  // Storage full: said in plain words, nothing sent anywhere.
  const setItem = session.setItem;
  session.setItem = () => { throw new Error('QuotaExceededError'); };
  await assert.rejects(store().updateElement(id, 'title', { x: 1 }), /couldn’t keep this run’s layout/);
  session.setItem = setItem;
  assert.deepEqual(calls, []);
  console.log('PASS designer store: a run\'s copy is kept in this tab, only its items change, nothing reaches /api/templates');
})().catch((error) => { console.error(error); process.exitCode = 1; });
