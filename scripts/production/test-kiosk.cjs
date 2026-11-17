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
const printer = { id: '33333333-3333-4333-8333-333333333333', username: 'printer', can_print: true, can_edit: false, is_admin: false };
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
  // The kiosk is strict: only labels set for the product's kind (and brand) are offered.
  const rules = { categories, brands: {} };
  assert.deepEqual(plan.kioskDesignsFor(designs, rules, 'Edible', 'Any'), { shown: [{ id: 'gummies' }], gap: null, untyped: [{ id: 'any' }] }, 'an edible sees edible labels only; a label with no kind is offered to nothing');
  assert.deepEqual(plan.kioskDesignsFor(designs, rules, 'Flower', 'Any').shown.map((d) => d.id), ['jar'], 'a flower never sees the edible label');
  assert.deepEqual(plan.kioskDesignsFor(designs, rules, null, 'Any'), { shown: [], gap: 'no-category', untyped: [{ id: 'any' }] }, 'unknown kind: nothing until staff say what it is');
  assert.deepEqual(plan.kioskDesignsFor(designs, rules, 'Vape', 'Any').gap, 'none-for-category', 'nothing for the kind: say so, never show all');
  const branded = { categories: { zg: ['Flower'], jar: ['Flower'], other: ['Flower'] }, brands: { zg: ['Zero Gravity'], other: ['NoiZey'] } };
  const flowerDesigns = [{ id: 'jar' }, { id: 'zg' }, { id: 'other' }];
  assert.deepEqual(plan.kioskDesignsFor(flowerDesigns, branded, 'Flower', ' zero  gravity ').shown.map((d) => d.id), ['zg', 'jar'], 'brand labels first, other brands’ labels hidden, brand matched loosely');
  assert.deepEqual(plan.kioskDesignsFor(flowerDesigns, branded, 'Flower', 'Zero Gravity', 'jar').shown.map((d) => d.id), ['jar', 'zg'], 'the label used last for this product comes first');
  assert.deepEqual(plan.kioskDesignsFor([{ id: 'zg' }], branded, 'Flower', 'MGP').gap, 'none-for-brand');
  assert.equal(plan.kioskDesignFits('zg', branded, 'Flower', 'ZERO GRAVITY'), true);
  assert.equal(plan.kioskDesignFits('zg', branded, 'Flower', null), false, 'a brand-limited label needs the brand');
  assert.equal(plan.kioskDesignFits('jar', branded, 'Edible', 'x'), false);
  assert.equal(plan.kioskDesignFits('jar', branded, null, 'x'), false);
  assert.equal(plan.brandKey('  Café   Noir '), 'cafe noir');
  assert.deepEqual(plan.cleanBrands([' Zero Gravity ', 'zero gravity', '', 7, 'NoiZey']), ['Zero Gravity', 'NoiZey'], 'brands once each, trimmed');
  assert.equal(plan.cleanBrands(Array.from({ length: 30 }, (_, i) => `B${i}`)).length, 20);
  assert.equal(plan.cleanBrands(['x'.repeat(150)])[0].length, 100);
  assert.deepEqual(plan.cleanBrands('nope'), []);
  const cover = plan.kioskCoverage(['gummies', 'jar', 'any'], rules);
  assert.deepEqual([cover.counts.Edible, cover.counts.Flower, cover.counts['Shake/Trim'], cover.counts.Vape], [1, 1, 1, 0]);
  assert.deepEqual(cover.untyped, ['any'], 'the manager sees kiosk labels nobody can use yet');
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
  assert.deepEqual(await server.kioskAccess(h.request('GET')).then(({ ready, kiosk, manager }) => ({ ready, kiosk, manager })), { ready: true, kiosk: false, manager: true }, 'the owner is not a kiosk account, but may preview it');
  reset({ ...owner, is_admin: false }, (t, v) => isKiosk(t, v) ?? []);
  assert.equal((await server.kioskAccess(h.request('GET'))).manager, true, 'an editor may preview the kiosk');
  reset(printer, (t, v) => isKiosk(t, v) ?? []);
  assert.equal((await server.kioskAccess(h.request('GET'))).manager, false, 'a print-only account is not a manager');
  reset(kioskUser, (t, v) => isKiosk(t, v) ?? []);
  assert.equal((await server.kioskAccess(h.request('GET'))).manager, false, 'the kiosk account is never a manager');
  reset(kioskUser, () => missing());
  assert.deepEqual(await server.kioskAccess(h.request('GET')).then(({ ready, kiosk, manager }) => ({ ready, kiosk, manager })), { ready: false, kiosk: false, manager: false }, 'before setup: nobody is a kiosk account');
  reset(kioskUser, () => new Error('connection refused'));
  await assert.rejects(server.kioskAccess(h.request('GET')), /connection refused/, 'a real database error is not "not set up"');
  const refused = async (user, answer) => { reset(user, answer); try { await server.requireKiosk(h.request('GET')); return 0; } catch (e) { return e.status; } };
  assert.equal(await refused(kioskUser, (t, v) => isKiosk(t, v) ?? []), 0);
  assert.equal(await refused(owner, (t, v) => isKiosk(t, v) ?? []), 0, 'the owner can preview and print from the kiosk');
  assert.equal(await refused({ ...owner, can_print: false }, (t, v) => isKiosk(t, v) ?? []), 403, 'previewing still needs print permission to print');
  assert.equal(await refused(printer, (t, v) => isKiosk(t, v) ?? []), 403, 'kiosk APIs refuse other accounts');
  assert.equal(await refused({ ...kioskUser, can_print: false }, (t, v) => isKiosk(t, v) ?? []), 403, 'a kiosk account that cannot print');
  assert.equal(await refused(kioskUser, () => missing()), 409, 'not set up yet');
  reset(null, () => []);
  assert.equal(await server.requireKiosk(h.request('GET')).then(() => 0, (e) => e.status), 401);

  // Status and the navigation hint.
  reset(kioskUser, (t, v) => isKiosk(t, v) ?? []);
  let res = await statusRoute.GET(h.request('GET'));
  assert.deepEqual(await res.json(), { ready: true, kiosk: true, preview: false, canEdit: false, canPrint: true, username: 'kiosk' });
  assert.equal(jar.get(server.KIOSK_HINT_COOKIE), '1', 'a kiosk browser gets the hint');
  sqlAnswer = (t, v) => isKiosk(t, v) ?? []; h.session.user = owner;
  res = await statusRoute.GET(h.request('GET'));
  { const body = await res.json(); assert.equal(body.kiosk, false); assert.equal(body.preview, true, 'the owner may preview'); }
  assert.equal(jar.has(server.KIOSK_HINT_COOKIE), false, 'the hint is cleared for anyone else, a previewing owner included');
  reset(owner, () => missing());
  res = await statusRoute.GET(h.request('GET'));
  assert.equal(res.status, 200, 'the app keeps working before setup');
  assert.deepEqual(await res.json(), { ready: false, kiosk: false, preview: false, canEdit: true, canPrint: true, username: 'owner' });

  // Designs: before setup the switch is hidden (ready false), nothing breaks.
  reset(owner, () => missing());
  res = await designsRoute.GET(h.request('GET'));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ready: false, categoriesReady: false, ids: [], categories: {}, brandsReady: false, brands: {}, canEdit: true });
  reset(owner, (t, v) => isKiosk(t, v) ?? (/FROM kiosk_designs/.test(t) ? [{ template_id: 'tpl-a' }] : /FROM template_categories/.test(t) ? [{ template_id: 'tpl-a', category: 'Edible' }, { template_id: 'tpl-a', category: 'Flower' }] : /FROM template_brands/.test(t) ? [{ template_id: 'tpl-a', brand: 'Zero Gravity' }] : []));
  h.results.push([]);
  res = await designsRoute.GET(h.request('GET'));
  assert.deepEqual(await res.json(), { ready: true, categoriesReady: true, ids: ['tpl-a'], categories: { 'tpl-a': ['Flower', 'Edible'] }, brandsReady: true, brands: { 'tpl-a': ['Zero Gravity'] }, canEdit: true, designs: [] }, 'a previewing owner gets the kiosk designs too');
  reset(printer, (t, v) => isKiosk(t, v) ?? (/FROM kiosk_designs/.test(t) ? [{ template_id: 'tpl-a' }] : []));
  res = await designsRoute.GET(h.request('GET'));
  assert.equal('designs' in await res.json(), false, 'a print-only account gets no kiosk designs');
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
  reset(owner, (t, v) => isKiosk(t, v) ?? []);
  h.results.push([{ id: 'tpl-a', archivedAt: null, type: 'thermal' }]);
  res = await designsRoute.PUT(h.request('PUT', { templateId: 'tpl-a', kiosk: true }));
  assert.equal(res.status, 400, 'a label goes on the kiosk only once it says what it’s for');
  assert.match((await res.json()).error, /what kind of product/);
  reset(owner, (t, v) => isKiosk(t, v) ?? (/SELECT 1 FROM kiosk_designs/.test(t) ? [{ '?column?': 1 }] : []));
  h.results.push([{ id: 'tpl-a', archivedAt: null, type: 'thermal' }]);
  res = await designsRoute.PUT(h.request('PUT', { templateId: 'tpl-a', categories: [] }));
  assert.equal(res.status, 400, 'a kiosk label can’t lose its last kind');
  reset(owner, (t, v) => isKiosk(t, v) ?? []);
  res = await designsRoute.PUT(h.request('PUT', { templateId: 'tpl-a', brands: Array.from({ length: 21 }, (_, i) => `B${i}`) }));
  assert.equal(res.status, 400, 'too many brands are refused');
  reset(owner, (t, v) => isKiosk(t, v) ?? (/template_brands/.test(t) ? missing() : []));
  h.results.push([{ id: 'tpl-a', archivedAt: null, type: 'thermal' }]);
  res = await designsRoute.PUT(h.request('PUT', { templateId: 'tpl-a', brands: ['Zero Gravity'] }));
  assert.equal(res.status, 409, 'brand limits before their table exists say so');

  // Runs: only the kiosk account, only once set up.
  const kioskRun = { templateId: 'tpl-a', quantity: 24, rows: units, packageKey: units[0].packageTag, productName: 'Blue Dream 3.5g', category: 'Flower' };
  reset(printer, (t, v) => isKiosk(t, v) ?? []);
  res = await runsRoute.POST(h.request('POST', kioskRun));
  assert.equal(res.status, 403, 'a print-only account makes runs in New run, not here');
  reset(kioskUser, () => missing());
  res = await runsRoute.POST(h.request('POST', kioskRun));
  assert.equal(res.status, 409);
  reset(kioskUser, (t, v) => isKiosk(t, v) ?? (/FROM kiosk_designs k JOIN templates/.test(t) ? [] : []));
  res = await runsRoute.POST(h.request('POST', kioskRun));
  assert.equal(res.status, 409, 'a design taken off the kiosk can’t be printed from it');
  assert.match((await res.json()).error, /isn’t on the kiosk/);
  const onKiosk = (kinds, brands = []) => (t, v) => isKiosk(t, v) ?? (/FROM kiosk_designs k JOIN templates/.test(t) ? [{ '?column?': 1 }] : /FROM template_categories/.test(t) ? kinds.map((category) => ({ category })) : /FROM template_brands/.test(t) ? brands.map((brand) => ({ template_id: 'tpl-a', brand })) : []);
  reset(kioskUser, onKiosk(['Edible']));
  res = await runsRoute.POST(h.request('POST', kioskRun));
  assert.equal(res.status, 409, 'the server refuses an edible label for a flower product, whatever the screen sent');
  assert.match((await res.json()).error, /isn’t set up for Flower/);
  reset(kioskUser, onKiosk(['Flower'], ['Somebody Else']));
  res = await runsRoute.POST(h.request('POST', kioskRun));
  assert.equal(res.status, 409, 'a label limited to another brand is refused');
  assert.match((await res.json()).error, /from this brand/);
  reset(kioskUser, onKiosk([]));
  res = await runsRoute.POST(h.request('POST', kioskRun));
  assert.equal(res.status, 409, 'a kiosk label with no kind prints for nothing');
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
  reset(printer, (t, v) => isKiosk(t, v) ?? []);
  res = await stageRoute.PUT(h.request('PUT', { stage: 'approved' }), h.params('run-1'));
  assert.equal(res.status, 403, 'a print-only account cannot answer the kiosk check');
  reset(owner, (t, v) => isKiosk(t, v) ?? (/UPDATE kiosk_runs/.test(t) ? [{ stage: 'approved' }] : []));
  res = await stageRoute.PUT(h.request('PUT', { stage: 'approved' }), h.params('run-1'));
  assert.deepEqual(await res.json(), { stage: 'approved' }, 'a previewing owner can answer the 12-label check');

  console.log('PASS kiosk: quantities, 12-then-rest (1/12/13/500), categories, filling designs, print phases, kiosk accounts, owner preview, missing tables');
})().catch((e) => { console.error(e); process.exitCode = 1; });
