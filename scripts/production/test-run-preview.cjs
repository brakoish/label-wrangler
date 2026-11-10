/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
require('../thermal/register.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {prepareRunPreview} = require('../../src/lib/runPreview.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
(async () => {
 let states = [], renders = 0;
 const publish = state => states.push(state);
 const render = async () => { renders++; return 'proof'; };
 prepareRunPreview(async () => { throw new Error('manufacturedDate: text overflows its box'); }, render, publish);
 assert.deepEqual(states, [{status:'loading'}]);
 await tick();
 assert.deepEqual(states.at(-1), {status:'error',message:'manufacturedDate: text overflows its box'});
 assert.equal(renders,0);
 prepareRunPreview(async () => '^XA^XZ', render, publish);
 assert.deepEqual(states.at(-1), {status:'loading'}, 'corrected input clears error/proof');
 await tick(); assert.deepEqual(states.at(-1), {status:'ready',url:'proof'});
 states=[];
 prepareRunPreview(async () => '  ', render, publish);
 await tick(); assert.deepEqual(states.at(-1), {status:'empty'}); assert.equal(renders,1);
 prepareRunPreview(async () => '^XA', async () => { throw new Error('WASM failed'); }, publish);
 await tick(); assert.equal(states.at(-1).message,'WASM failed');
 for (const stage of ['generate','render']) {
  for (const fail of [false,true]) {
   states=[]; const pending=deferred();
   const cancel=prepareRunPreview(stage==='generate' ? () => pending.promise : async () => '^XA', stage==='render' ? () => pending.promise : render, publish);
   await tick(); cancel();
   prepareRunPreview(async () => '^XA', async () => 'new proof', publish);
   await tick();
   if(fail) pending.reject(new Error('stale error')); else pending.resolve('stale proof');
   await tick(); assert.deepEqual(states.at(-1), {status:'ready',url:'new proof'});
   assert.equal(states.length,3,'cancelled completion cannot publish');
  }
 }
 const page=fs.readFileSync('src/app/runs/new/page.tsx','utf8');
 assert.equal(page.split('disabled={!canCreate || !previewReady || isCreatingRun}').length - 1,1,'the single (sticky) Start control is gated');
 assert.ok(/blanksOk &&\s*sameOk &&\s*barcodesOk &&\s*charactersOk &&\s*layoutOk/.test(page),'whole-run checks (blanks, same-value, barcodes, printer characters, layout) gate Start');
 assert.ok(page.includes("router.replace(`/runs/${run.id}`)"),'created run gets its own URL');
 assert.ok(page.includes('beforeLeave={confirmLeave}'),'half-filled run warns before leaving');
 assert.ok(page.includes('if (!canCreate || !previewReady || !template || isCreatingRun)'));
 assert.ok(page.includes('previewResult?.input === previewInput'),'input changes immediately invalidate proof');
 assert.ok(page.includes('role="alert"'));
 console.log('PASS: run preview errors, empty/loading/recovery, cancelled async results, Start guards (proof + blank check)');
})().catch(error => { console.error(error); process.exitCode=1; });
