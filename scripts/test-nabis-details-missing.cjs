/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
// A Nabis search that runs out of time (or loses Metrc) must flag each row
// missing its per-unit retail IDs or lab potency, never return it as complete.
// Runs the route's own code against stubbed upstreams (no network).
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const source = fs.readFileSync('src/app/api/nabis/search/route.ts', 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^export const GET = .*$/m, '')
  .replace(/^export /gm, '');

function load(fetchStub) {
  const context = {
    URL, AbortSignal, Buffer, Promise, Array, Set, Map, Math, Number, String, Object, JSON, Date, Error, console: { error() {} },
    process: { env: { MANIFEST_API_BASE_URL: 'http://manifest.test/api', METRC_BASE_URL: 'http://metrc.test', METRC_LICENSE_DISTRIBUTOR: 'L1', METRC_INTEGRATOR_KEY: 'k', METRC_USER_KEY: 'u' } },
    NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) },
    neon: () => { throw new Error('no database in tests'); },
    fetch: fetchStub,
  };
  vm.createContext(context);
  vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022 }) + '\nthis.handleGET = handleGET;', context);
  return (q) => context.handleGET({ nextUrl: new URL(`http://app.test/api/nabis/search?q=${encodeURIComponent(q)}`) });
}

const ok = (data) => ({ ok: true, status: 200, json: async () => data });
const pkg = { packageTag: '1A4060300002EE1000012345', itemName: 'Blue Dream 1g', metrcPackageId: '777', quantity: 3, unitOfMeasure: 'Each' };

(async () => {
  // Manifest answers; Metrc times out for retail IDs and lab results.
  const timeout = () => { const e = new Error('timed out'); e.name = 'TimeoutError'; return Promise.reject(e); };
  const search = load((url) => {
    const u = String(url);
    if (u.includes('/packages?')) return Promise.resolve(ok([pkg]));
    if (u.includes('/retail-labels/label-data/')) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    if (u.startsWith('http://metrc.test')) return timeout();
    throw new Error(`unexpected ${u}`);
  });
  const res = await search('Blue Dream');
  assert.equal(res.status, 200);
  assert.equal(res.body.detailsIncomplete, true);
  assert.ok(res.body.packages.length >= 1);
  for (const row of res.body.packages) {
    const missing = String(row.detailsMissing || '').split(' ');
    assert.ok(missing.includes('retailIds'), 'flags the missing retail IDs');
    assert.ok(missing.includes('labPotency'), 'flags the missing lab potency');
  }

  // Everything answers: no flag.
  const fine = load((url) => {
    const u = String(url);
    if (u.includes('/packages?')) return Promise.resolve(ok([pkg]));
    if (u.includes('/retail-labels/label-data/')) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    if (u.includes('/retailid/')) return Promise.resolve(ok({ Eaches: ['RID-1', 'RID-2', 'RID-3'] }));
    if (u.startsWith('http://metrc.test')) return Promise.resolve(ok([]));
    throw new Error(`unexpected ${u}`);
  });
  const good = await fine('Blue Dream');
  assert.equal(good.body.detailsIncomplete, undefined);
  assert.ok(good.body.packages.every((row) => !row.detailsMissing), 'a complete row has no flag');
  console.log('PASS Nabis search: rows cut short by the time limit or a Metrc failure are flagged with what is missing');
})().catch((error) => { console.error(error); process.exit(1); });
