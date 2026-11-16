/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
// Kiosk mode: quantities, the 12-then-the-rest split, product categories,
// filling a design from a product, who counts as a kiosk account, and what
// happens before the kiosk tables exist. Offline: the database, the session
// and cookies are in-memory fakes.
process.env.HARNESS_REAL_GUARD = '1';
const h = require('./route-harness.cjs');
const path = require('node:path');
const assert = require('node:assert/strict');
function mock(rel, exports) { const file = path.resolve(rel); require.cache[file] = { id: file, filename: file, loaded: true, exports, children: [], paths: [] }; }

// officeSql: a tagged template that answers from `sqlAnswer` and records each query.
const queries = [];
let sqlAnswer = () => [];
const missing = () => Object.assign(new Error('relation "kiosk_accounts" does not exist'), { code: '42P01' });
function officeSql() {
  const fn = (strings, ...values) => {
    const text = strings.join('?').replace(/\s+/g, ' ');
    queries.push({ text, values });
    try { const out = sqlAnswer(text, values); return out instanceof Error ? Promise.reject(out) : Promise.resolve(out); } catch (error) { return Promise.reject(error); }
  };
  fn.transaction = async (list) => Promise.all(list);
  return fn;
}
mock('src/lib/office/db.ts', { officeSql });
const jar = new Map();
const cookieStore = { get: (k) => (jar.has(k) ? { name: k, value: jar.get(k) } : undefined), set: (k, v) => jar.set(k, v), delete: (k) => jar.delete(k) };
require.cache[require.resolve('next/headers')] = { id: 'next/headers', filename: require.resolve('next/headers'), loaded: true, exports: { cookies: async () => cookieStore }, children: [], paths: [] };

const plan = require('../../src/lib/kiosk/plan.ts');
const server = require('../../src/lib/kiosk/server.ts');
const statusRoute = require('../../src/app/api/kiosk/status/route.ts');
const designsRoute = require('../../src/app/api/kiosk/designs/route.ts');
const runsRoute = require('../../src/app/api/kiosk/runs/route.ts');
const stageRoute = require('../../src/app/api/kiosk/runs/[id]/route.ts');

const kioskUser = { id: '11111111-1111-4111-8111-111111111111', username: 'kiosk', can_print: true, can_edit: false, is_admin: false };
const owner = { id: '22222222-2222-4222-8222-222222222222', username: 'owner', can_print: true, can_edit: true, is_admin: true };
const reset = (user, answer) => { h.reset(); h.session.user = user; queries.length = 0; jar.clear(); sqlAnswer = answer; };
const isKiosk = (text, values) => /FROM kiosk_accounts/.test(text) ? (values[0] === kioskUser.id ? [{ '?column?': 1 }] : []) : null;

(async () => {
  // --- How many -------------------------------------------------------------------
  assert.deepEqual(plan.parseQuantity('24'), { value: 24, error: '' });
  assert.deepEqual(plan.parseQuantity(' 1,200 '), { value: 1200, error: '' }, 'commas and spaces are fine');
  assert.equal(plan.parseQuantity('').value, null);
  assert.match(plan.parseQuantity('').error, /how many/);
  assert.match(plan.parseQuantity('2.5').error, /whole number/);
  assert.match(plan.parseQuantity('-3').error, /whole number/);
  assert.match(plan.parseQuantity('0').error, /1 or more/);
  assert.equal(plan.parseQuantity('100000').value, 100000, 'no kiosk cap: the run limit only');
  assert.equal(plan.parseQuantity('100001').value, null, 'over the existing run limit');
  assert.equal(plan.parseQuantity('99999999999999999999').value, null);

  // --- 12 first, then the rest -----------------------------------------------------
  const spansOk = (split, total, cap) => {
    let next = split.test.to + 1;
    for (const part of split.rest) { assert.equal(part.from, next, 'the rest picks up right after the last label sent'); assert.ok(part.to - part.from + 1 <= cap, 'no send over the cap'); next = part.to + 1; }
    assert.equal(next - 1, total, 'every label is sent exactly once');
  };
  assert.deepEqual(plan.kioskSplit(1, 10000), { test: { from: 1, to: 1 }, rest: [] }, '1 label: the test is the whole print');
  assert.deepEqual(plan.kioskSplit(12, 10000), { test: { from: 1, to: 12 }, rest: [] }, '12 labels: the test is the whole print');
  assert.deepEqual(plan.kioskSplit(13, 10000), { test: { from: 1, to: 12 }, rest: [{ from: 13, to: 13 }] }, '13 labels: 12, then 1');
  assert.deepEqual(plan.kioskSplit(500, 10000), { test: { from: 1, to: 12 }, rest: [{ from: 13, to: 500 }] }, '500 labels: 12, then 13-500');
  const bitmap500 = plan.kioskSplit(5000, 500);
  assert.equal(bitmap500.rest.length, 10); spansOk(bitmap500, 5000, 500);
  for (const total of [1, 12, 13, 500]) spansOk(plan.kioskSplit(total, 100), total, 100);
  // A roll with labels side by side: the test is whole rows, so the rest never starts mid-row.
  assert.equal(plan.kioskTestCount(500, 5), 15);
  assert.equal(plan.kioskTestCount(500, 3), 12);
  assert.equal(plan.kioskTestCount(7, 5), 7);
  const lanes = plan.kioskSplit(500, 100, 5); spansOk(lanes, 500, 100);
  assert.ok(lanes.rest.slice(0, -1).every((p) => p.to % 5 === 0), 'every part but the last ends on a whole row');

  // --- Categories --------------------------------------------------------------------
  const cases = {
    'Flower': 'Flower', 'Buds': 'Flower', 'Flower (packaged eighth - each)': 'Flower', 'Infused Flower': 'Flower',
    'Pre-Roll Flower': 'Pre-roll', 'Infused Pre-Roll': 'Pre-roll', 'Pre-Roll Leaf': 'Pre-roll', 'Preroll': 'Pre-roll',
    'Edible (weight - each)': 'Edible', 'Infused Edible': 'Edible', 'Infused Liquid Edible': 'Edible', 'Infused Beverage': 'Edible',
    'Vape Cartridge (volume - each)': 'Vape', 'Cartridge': 'Vape', 'Concentrate (Each)': 'Concentrate', 'Extract (weight - each)': 'Concentrate', 'Kief': 'Concentrate',
    'Shake/Trim': 'Shake/Trim', 'Shake': 'Shake/Trim', 'Trim': 'Shake/Trim',
    'Infused Non-Edible': 'Other', 'Topical': 'Other', 'Seeds': 'Other', 'Clone - Cutting': 'Other', '': 'Other',
  };
  for (const [name, want] of Object.entries(cases)) assert.equal(plan.plainCategory(name), want, `"${name}" is ${want}`);
  assert.equal(plan.plainCategory(null), 'Other');
  assert.equal(plan.productCategory({ category: 'Infused Liquid Edible' }), 'Edible');
  assert.equal(plan.productCategory({ itemName: 'x' }), null, 'no category from Nabis: nothing is filtered');
  assert.deepEqual(plan.cleanCategories(['Vape', 'Nope', 'Flower', 'Vape', 3]), ['Flower', 'Vape'], 'known ones, once each, in list order');
  const designs = [{ id: 'gummies' }, { id: 'jar' }, { id: 'any' }];
  const categories = { gummies: ['Edible'], jar: ['Flower', 'Shake/Trim'] };
  assert.deepEqual(plan.designsForCategory(designs, categories, 'Edible'), { shown: [{ id: 'gummies' }, { id: 'any' }], matched: true }, 'an edible shows edible labels and labels for every product');
  assert.deepEqual(plan.designsForCategory(designs, categories, 'Flower').shown.map((d) => d.id), ['jar', 'any']);
  assert.deepEqual(plan.designsForCategory(designs, categories, null).shown.length, 3, 'no category: all of them');
  assert.deepEqual(plan.designsForCategory([{ id: 'gummies' }], categories, 'Vape'), { shown: [{ id: 'gummies' }], matched: false }, 'nothing fits: show all, say so');
  assert.deepEqual(plan.designsInCategoryFirst(designs, categories, 'Flower'), { matching: [{ id: 'jar' }], rest: [{ id: 'gummies' }, { id: 'any' }] }, 'New run: matching designs first, nothing hidden for good');
  assert.deepEqual(plan.designsInCategoryFirst(designs, categories, 'Vape'), { matching: [], rest: designs });
  assert.deepEqual(plan.designsInCategoryFirst(designs, categories, null).matching, []);

  // --- Filling a design from a product ----------------------------------------------
  const text = (fieldName, extra = {}) => ({ id: 'txt-' + fieldName, type: 'text', isStatic: false, fieldName, ...extra });
  const units = Array.from({ length: 5 }, (_, i) => ({ itemName: 'Blue Dream 3.5g', productName: 'Blue Dream', packageTag: '1A4000000000000000001234', batchNumber: 'B-7', retailId: `RID-${i + 1}`, unitIndex: String(i + 1), category: 'Flower' }));
  const plain = { elements: [text('productName'), text('batchNumber')] };
  let filled = plan.kioskRunData(plain, units, 40);
  assert.equal(filled.ok, true);
  assert.equal(filled.sourceData.length, 40, 'the same product details on every label');
  assert.equal(filled.perUnit, false);
  assert.deepEqual(filled.sourceData[39], { productName: 'Blue Dream', batchNumber: 'B-7' }, 'only the columns the design uses are kept');
  assert.equal(filled.fieldMappings.productName.csvColumn, 'productName');
  const perUnit = { elements: [text('productName'), { id: 'qr', type: 'qrcode', isStatic: false, fieldName: 'retailId' }] };
  filled = plan.kioskRunData(perUnit, units, 5);
  assert.equal(filled.ok, true); assert.equal(filled.perUnit, true);
  assert.deepEqual(filled.sourceData.map((r) => r.retailId), ['RID-1', 'RID-2', 'RID-3', 'RID-4', 'RID-5'], 'one unit per label: no retail ID printed twice');
  filled = plan.kioskRunData(perUnit, units, 6);
  assert.equal(filled.ok, false); assert.match(filled.message, /Print up to 5/);
  assert.equal(plan.kioskRunData(plain, [], 3).ok, false);
  assert.equal(plan.kioskRunData(plain, units, 0).ok, false);
  const needsMore = { elements: [text('productName'), text('harvestMoonPhase', { defaultValue: 'Full moon' })] };
  const notThere = plan.kioskDesignCheck(needsMore, units);
  assert.equal(notThere.usable, false, 'a detail Nabis doesn\u2019t have would print the design\u2019s sample');
  assert.match(plan.kioskDesignProblem(notThere), /missing Harvest moon phase/);
  assert.match(plan.kioskRunData(needsMore, units, 3).message, /missing/, 'and the server refuses it too');
  const noSample = plan.kioskDesignCheck({ elements: [text('productName'), text('harvestMoonPhase')] }, units);
  assert.equal(noSample.usable, true, 'a text part with no sample just prints empty');
  assert.deepEqual(noSample.leftBlank, ['Harvest moon phase']);
  assert.deepEqual(plan.kioskLabelValues({ a: { mode: 'column', csvColumn: 'x' }, b: { mode: 'static' } }, { b: 'fixed' }, { x: '1' }), { a: '1', b: 'fixed' });
  assert.match(plan.kioskRunName('Blue Dream 3.5g', new Date(2026, 10, 16)), /^Blue Dream 3\.5g - 11\/16\/26 \(kiosk\)$/);

  // --- Where a print is ----------------------------------------------------------------
  const flow = { total: 30, testTo: 12, testIds: ['t'], restIds: [], restPlan: [], approved: false, stopped: false };
  const job = (requestId, from, to, state, extra = {}) => ({ requestId, from, to, state, count: to - from + 1, ...extra });
  assert.equal(plan.kioskPhase({ ...flow, testIds: [] }, []), 'send-test');
  assert.equal(plan.kioskPhase(flow, []), 'test-waiting', 'sent, not listed yet');
  assert.equal(plan.kioskPhase(flow, [job('t', 1, 12, 'claimed')]), 'test-printing');
  assert.equal(plan.kioskPhase(flow, [job('t', 1, 12, 'sent_to_printer')]), 'review');
  assert.equal(plan.kioskPhase(flow, [job('t', 1, 12, 'rejected', { reason: 'media out' })]), 'needs-check');
  assert.equal(plan.kioskPhase({ ...flow, stopped: true }, [job('t', 1, 12, 'sent_to_printer')]), 'stopped');
  const approved = { ...flow, approved: true, restPlan: [{ from: 13, to: 30 }] };
  assert.equal(plan.kioskPhase(approved, [job('t', 1, 12, 'sent_to_printer')]), 'send-rest');
  assert.equal(plan.kioskPhase({ ...approved, restIds: ['r'] }, [job('t', 1, 12, 'sent_to_printer'), job('r', 13, 30, 'queued')]), 'rest-waiting');
  assert.equal(plan.kioskPhase({ ...approved, restIds: ['r'] }, [job('t', 1, 12, 'sent_to_printer'), job('r', 13, 30, 'sent_to_printer')]), 'done');
  assert.equal(plan.kioskLabelsSent({ ...approved, restIds: ['r'] }, [job('t', 1, 12, 'sent_to_printer'), job('r', 13, 30, 'claimed'), job('other', 1, 30, 'sent_to_printer')]), 12, 'only this print’s own sends count');
  assert.equal(plan.kioskPhase({ ...flow, total: 12, approved: true }, [job('t', 1, 12, 'sent_to_printer')]), 'done', '12 or fewer: done after Yes');
  // Rebuilt from the office's records on another browser.
  const rebuilt = plan.rebuildKioskFlow({ total: 1000, testTo: 12, stage: 'approved', cap: 500, requests: [{ id: 't', range_from: 1, range_to: 12 }, { id: 'r1', range_from: 13, range_to: 512 }, { id: 'again', range_from: 1, range_to: 12, reprint_of: 't' }] });
  assert.deepEqual(rebuilt.testIds, ['t']); assert.deepEqual(rebuilt.restIds, ['r1'], 'reprints are not part of the print');
  assert.deepEqual(rebuilt.restPlan, [{ from: 13, to: 512 }, { from: 513, to: 1000 }], 'what was never sent is planned after what was');
  assert.equal(plan.kioskPhase(rebuilt, [job('t', 1, 12, 'sent_to_printer'), job('r1', 13, 512, 'sent_to_printer')]), 'send-rest');
  assert.deepEqual(plan.rebuildKioskFlow({ total: 20, testTo: 12, stage: 'test', cap: 500, requests: [] }).restPlan, [], 'nothing planned before Yes');
  assert.equal(plan.bitmapDigestSource(['^XA^FXLWBITMAP1:' + 'a'.repeat(64) + ':' + 'b'.repeat(64) + '^FS^XZ', '^XA^XZ']), 'b'.repeat(64) + '\n');

  // --- Missing tables -----------------------------------------------------------------------
  assert.equal(plan.isMissingTable(missing()), true);
  assert.equal(plan.isMissingTable(new Error('relation "template_categories" does not exist')), true);
  assert.equal(plan.isMissingTable(new Error('relation "runs" does not exist')), false, 'only the kiosk tables');
  assert.equal(plan.isMissingTable(new Error('connection refused')), false);
  assert.equal(plan.isMissingTable(null), false);

  // --- Who is a kiosk account ------------------------------------------------------------
  reset(kioskUser, (t, v) => isKiosk(t, v) ?? []);
  assert.deepEqual(await server.kioskAccess(h.request('GET')).then(({ ready, kiosk }) => ({ ready, kiosk })), { ready: true, kiosk: true });
  reset(owner, (t, v) => isKiosk(t, v) ?? []);
  assert.deepEqual(await server.kioskAccess(h.request('GET')).then(({ ready, kiosk }) => ({ ready, kiosk })), { ready: true, kiosk: false }, 'the owner is not a kiosk account');
  reset(kioskUser, () => missing());
  assert.deepEqual(await server.kioskAccess(h.request('GET')).then(({ ready, kiosk }) => ({ ready, kiosk })), { ready: false, kiosk: false }, 'before setup: nobody is a kiosk account');
  reset(kioskUser, () => new Error('connection refused'));
  await assert.rejects(server.kioskAccess(h.request('GET')), /connection refused/, 'a real database error is not "not set up"');
  const refused = async (user, answer) => { reset(user, answer); try { await server.requireKiosk(h.request('GET')); return 0; } catch (e) { return e.status; } };
  assert.equal(await refused(kioskUser, (t, v) => isKiosk(t, v) ?? []), 0);
  assert.equal(await refused(owner, (t, v) => isKiosk(t, v) ?? []), 403, 'kiosk APIs refuse other accounts');
  assert.equal(await refused({ ...kioskUser, can_print: false }, (t, v) => isKiosk(t, v) ?? []), 403, 'a kiosk account that cannot print');
  assert.equal(await refused(kioskUser, () => missing()), 409, 'not set up yet');
  reset(null, () => []);
  assert.equal(await server.requireKiosk(h.request('GET')).then(() => 0, (e) => e.status), 401);

  // Status and the navigation hint.
  reset(kioskUser, (t, v) => isKiosk(t, v) ?? []);
  let res = await statusRoute.GET(h.request('GET'));
  assert.deepEqual(await res.json(), { ready: true, kiosk: true, canEdit: false, canPrint: true, username: 'kiosk' });
  assert.equal(jar.get(server.KIOSK_HINT_COOKIE), '1', 'a kiosk browser gets the hint');
  sqlAnswer = (t, v) => isKiosk(t, v) ?? []; h.session.user = owner;
  res = await statusRoute.GET(h.request('GET'));
  assert.equal((await res.json()).kiosk, false); assert.equal(jar.has(server.KIOSK_HINT_COOKIE), false, 'the hint is cleared for anyone else');
  reset(owner, () => missing());
  res = await statusRoute.GET(h.request('GET'));
  assert.equal(res.status, 200, 'the app keeps working before setup');
  assert.deepEqual(await res.json(), { ready: false, kiosk: false, canEdit: true, canPrint: true, username: 'owner' });

  // Designs: before setup the switch is hidden (ready false), nothing breaks.
  reset(owner, () => missing());
  res = await designsRoute.GET(h.request('GET'));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ready: false, categoriesReady: false, ids: [], categories: {}, canEdit: true });
  reset(owner, (t, v) => isKiosk(t, v) ?? (/FROM kiosk_designs/.test(t) ? [{ template_id: 'tpl-a' }] : /FROM template_categories/.test(t) ? [{ template_id: 'tpl-a', category: 'Edible' }, { template_id: 'tpl-a', category: 'Flower' }] : []));
  res = await designsRoute.GET(h.request('GET'));
  assert.deepEqual(await res.json(), { ready: true, categoriesReady: true, ids: ['tpl-a'], categories: { 'tpl-a': ['Flower', 'Edible'] }, canEdit: true });
  reset(kioskUser, (t, v) => isKiosk(t, v) ?? []);
  res = await designsRoute.PUT(h.request('PUT', { templateId: 'tpl-a', kiosk: false }));
  assert.equal(res.status, 403, 'the kiosk account cannot change which labels are on the kiosk');
  reset({ ...owner, can_edit: false }, (t, v) => isKiosk(t, v) ?? []);
  res = await designsRoute.PUT(h.request('PUT', { templateId: 'tpl-a', kiosk: true }));
  assert.equal(res.status, 403, 'only accounts that can edit flip the switch');
  reset(owner, (t, v) => isKiosk(t, v) ?? []);
  res = await designsRoute.PUT(h.request('PUT', { templateId: 'tpl-a', categories: ['Snacks'] }));
  assert.equal(res.status, 400, 'unknown categories are refused');
  reset(owner, (t, v) => isKiosk(t, v) ?? (/kiosk_designs|template_categories/.test(t) ? missing() : []));
  h.results.push([{ id: 'tpl-a', archivedAt: null, type: 'thermal' }]);
  res = await designsRoute.PUT(h.request('PUT', { templateId: 'tpl-a', kiosk: true }));
  assert.equal(res.status, 409, 'saving before setup says so');

  // Runs: only the kiosk account, only once set up.
  const kioskRun = { templateId: 'tpl-a', quantity: 24, rows: units, packageKey: units[0].packageTag, productName: 'Blue Dream 3.5g', category: 'Flower' };
  reset(owner, (t, v) => isKiosk(t, v) ?? []);
  res = await runsRoute.POST(h.request('POST', kioskRun));
  assert.equal(res.status, 403, 'an editor makes runs in New run, not here');
  reset(kioskUser, () => missing());
  res = await runsRoute.POST(h.request('POST', kioskRun));
  assert.equal(res.status, 409);
  reset(kioskUser, (t, v) => isKiosk(t, v) ?? (/FROM kiosk_designs k JOIN templates/.test(t) ? [] : []));
  res = await runsRoute.POST(h.request('POST', kioskRun));
  assert.equal(res.status, 409, 'a design taken off the kiosk can’t be printed from it');
  assert.match((await res.json()).error, /isn’t on the kiosk/);
  reset(kioskUser, (t, v) => isKiosk(t, v) ?? []);
  res = await runsRoute.POST(h.request('POST', { ...kioskRun, quantity: 0 }));
  assert.equal(res.status, 400);
  reset(kioskUser, (t, v) => isKiosk(t, v) ?? []);
  res = await runsRoute.GET(new Request('https://example.test/api/kiosk/runs?since=2026-11-16T00:00:00.000Z'));
  assert.deepEqual(await res.json(), { runs: [] });
  reset(kioskUser, (t, v) => isKiosk(t, v) ?? (/FROM kiosk_runs k JOIN runs/.test(t) ? missing() : []));
  res = await runsRoute.GET(new Request('https://example.test/api/kiosk/runs'));
  assert.equal(res.status, 409);

  // "Do these look right?": only a test print waiting for the answer changes.
  reset(kioskUser, (t, v) => isKiosk(t, v) ?? (/UPDATE kiosk_runs/.test(t) ? [{ stage: 'approved' }] : []));
  res = await stageRoute.PUT(h.request('PUT', { stage: 'approved' }), h.params('run-1'));
  assert.deepEqual(await res.json(), { stage: 'approved' });
  reset(kioskUser, (t, v) => isKiosk(t, v) ?? (/UPDATE kiosk_runs/.test(t) ? [] : /SELECT stage/.test(t) ? [{ stage: 'approved' }] : []));
  res = await stageRoute.PUT(h.request('PUT', { stage: 'stopped' }), h.params('run-1'));
  assert.equal(res.status, 409, 'an approved print can’t be stopped from here');
  reset(kioskUser, (t, v) => isKiosk(t, v) ?? []);
  res = await stageRoute.PUT(h.request('PUT', { stage: 'printed' }), h.params('run-1'));
  assert.equal(res.status, 400);
  reset(owner, (t, v) => isKiosk(t, v) ?? []);
  res = await stageRoute.PUT(h.request('PUT', { stage: 'approved' }), h.params('run-1'));
  assert.equal(res.status, 403);

  console.log('PASS kiosk: quantities, 12-then-rest (1/12/13/500), categories, filling designs, print phases, kiosk accounts, missing tables');
})().catch((e) => { console.error(e); process.exitCode = 1; });
