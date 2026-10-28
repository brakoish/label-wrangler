/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
require('../thermal/register.cjs');
const assert = require('node:assert/strict');
const {createTemplatePreviewLoader} = require('../../src/lib/templatePreviewLoader.ts');
const summary = (id, revision = 'v1') => ({id, updatedAt: revision, elements: [], summaryOnly: true});
const full = s => ({...s, summaryOnly: false});
(async () => {
 const load = createTemplatePreviewLoader();
 let active = 0, peak = 0, calls = 0;
 const releases = [];
 global.fetch = async (url, options) => {
  assert.equal(options.cache, 'no-store'); assert.ok(options.signal);
  calls++; active++; peak = Math.max(peak, active);
  await new Promise(resolve => releases.push(resolve)); active--;
  return Response.json(full(summary(decodeURIComponent(url.split('/').pop()))));
 };
 const first = load(summary('a/b'));
 assert.equal(first, load(summary('a/b')), 'in-flight requests coalesce');
 const requests = [first, ...Array.from({length: 7}, (_, i) => load(summary(String(i))))];
 assert.equal(calls, 3);
 while (releases.length || active) { releases.splice(0).forEach(r => r()); await new Promise(r => setImmediate(r)); }
 await Promise.all(requests); assert.equal(peak, 3);
 await load(summary('a/b')); assert.equal(calls, 8, 'cached revision reused');
 global.fetch = async () => { calls++; return Response.json(full(summary('a/b', 'v2'))); };
 await load(summary('a/b', 'v2')); assert.equal(calls, 9);
 const retry = createTemplatePreviewLoader();
 global.fetch = async () => new Response('', {status: 503});
 await assert.rejects(retry(summary('failure')), /Unable/);
 global.fetch = async () => Response.json(full(summary('failure')));
 await retry(summary('failure'));
 global.fetch = async () => Response.json(summary('incomplete'));
 await assert.rejects(retry(summary('incomplete')), /Incomplete/);
 const bounded = createTemplatePreviewLoader(); let boundedCalls = 0;
 global.fetch = async url => { boundedCalls++; return Response.json(full(summary(url.split('/').pop()))); };
 for (let i = 0; i < 25; i++) await bounded(summary(String(i)));
 await bounded(summary('0')); assert.equal(boundedCalls, 26, 'oldest evicted');
 console.log('PASS: preview concurrency, coalescing, revision cache, retry, validation, eviction');
})().catch(error => { console.error(error); process.exitCode = 1; });
