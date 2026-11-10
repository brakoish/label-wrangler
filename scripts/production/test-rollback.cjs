// Rollback safety for the progress outbox. After a rollback to main
// (ffda577) the server refuses the guarded-rewind fields and the 'rewind'
// print event, and main's own outbox (same prefix, same lock) stops its whole
// queue on any refusal. This checks both directions on one device's storage:
// this build against main's server, and main's outbox code reading what this
// build saved (main's file is kept verbatim in fixtures/).
require('../thermal/register.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const Module=require('node:module');const ts=require('typescript');
const {webcrypto}=require('node:crypto');
global.crypto=webcrypto;
const values=new Map();
const dispatched=[];
global.window={localStorage:{get length(){return values.size},key:i=>[...values.keys()][i],getItem:k=>values.has(k)?values.get(k):null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)},dispatchEvent:e=>{dispatched.push(e);return true;}};
const NEW=path.resolve(__dirname,'../../src/lib/offlineQueue.ts');
/** A fresh copy of this build's outbox, as after a page load. */
function loadNew(){delete require.cache[NEW];return require(NEW);}
/** Main's outbox code, as a page on the rolled-back build runs it. */
function loadMain(){
 const file=path.join(__dirname,'fixtures/main-ffda577-offlineQueue.ts.txt');
 const m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
 m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
 return m.exports;
}
// Main's server rules (validation.ts 'run' fields, the PUT and print-events routes at ffda577).
const MAIN_RUN_FIELDS=['imageSelections','name','templateId','presetId','staticValues','fieldMappings','dataSource','sourceData','mappedField','status','totalLabels','printedCount','notes','completedAt','pinnedAt','pinned','progressOnly'];
function mainServer(db,calls){
 return async(url,init)=>{
  const body=JSON.parse(init.body);calls.push([init.method,url,body]);
  const m=/^\/api\/runs\/([^/]+)(\/print-events)?$/.exec(url);const id=m[1];
  if(m[2]){
   if(!['opened','sent','confirmed','failed','cancelled'].includes(String(body.eventType))||!['roll-zpl','sheet-pdf','roll-pdf','scan','office-pi'].includes(String(body.output)))return Response.json({error:'Invalid print event'},{status:400});
   return Response.json({id:`print-event-${body.idempotencyKey}`,runId:id,...body,createdAt:'2026-11-10T12:00:00.000Z'},{status:201});
  }
  for(const k of Object.keys(body))if(!MAIN_RUN_FIELDS.includes(k))return Response.json({error:`Invalid field ${k}`},{status:400});
  if(body.printedCount!==undefined)db[id]=body.progressOnly===true?Math.max(db[id]??0,body.printedCount):body.printedCount;
  if(body.status)db[id+':status']=body.status;
  return Response.json({id,printedCount:db[id],status:db[id+':status']});
 };
}
// This build's server rules: high-water progress, guarded rewinds, 'rewind' events accepted.
function newServer(db,calls,clock){
 return async(url,init)=>{
  const body=JSON.parse(init.body);calls.push([init.method,url,body]);
  const m=/^\/api\/runs\/([^/]+)(\/print-events)?$/.exec(url);const id=m[1];
  if(m[2])return Response.json({id:`print-event-${body.idempotencyKey}`,runId:id,...body,createdAt:clock()},{status:201});
  if(body.resetProgress&&typeof body.expectedPrintedCount==='number'&&db[id]!==body.expectedPrintedCount)return Response.json({error:'changed',code:'progress_changed',printedCount:db[id]},{status:409});
  if(body.printedCount!==undefined)db[id]=body.resetProgress||body.progressOnly===false?body.printedCount:Math.max(db[id]??0,body.printedCount);
  return Response.json({id,printedCount:db[id]});
 };
}
const offline=async()=>{throw new TypeError('Failed to fetch');};
const keys=()=>[...values.keys()];
(async()=>{
 const {rewindEvent}=require('../../src/lib/runRewind.ts');
 // --- 1. A tab on this build, server rolled back to main: going back still works. ---
 {
  values.clear();
  const queue=loadNew();const {useRunStore}=require('../../src/lib/runStore.ts');
  const db={r:120};const calls=[];global.fetch=mainServer(db,calls);
  useRunStore.setState({runs:[{id:'r',printedCount:120,status:'paused'}]});
  let aside=null;
  await useRunStore.getState().setRunStatus('r','paused',39,{resetProgress:true,expectedPrintedCount:120,onSetAside:r=>{aside=r;}});
  assert.equal(aside,null,'not set aside');
  assert.equal(db.r,39,'the go-back landed as main’s exact write');
  assert.deepEqual(calls.map(c=>c[2].resetProgress??null),[true,null,null],'guarded try, then main’s own write, then the event');
  assert.deepEqual(calls[1][2],{status:'paused',printedCount:39,progressOnly:false},'exactly what main itself sends for a status change');
  assert.equal(calls[2][2].eventType,'rewind');
  assert.equal(queue.pendingPatchCount(),0,'nothing left behind');
  assert.equal(queue.deadLetteredOps().length,0,'the refused rewind event is dropped quietly, never set aside with alarming words');
  assert.equal(keys().length,0);
  // Ordinary progress and events still go through main unchanged.
  calls.length=0;
  await queue.updateRunWithQueue('r',{printedCount:45});
  await queue.savePrintEvent('r',{eventType:'sent',output:'roll-zpl',rangeFrom:40,rangeTo:45,labelCount:6,printedCountAfter:45,printerName:null,message:null});
  assert.equal(db.r,45);assert.equal(calls.length,2);assert.equal(queue.pendingPatchCount(),0);
  // Another 400 (a real one) is still set aside after the single retry.
  calls.length=0;
  global.fetch=async(url,init)=>{calls.push(JSON.parse(init.body));return Response.json({error:calls.length===1?'Invalid field resetProgress':'Progress exceeds run length'},{status:400});};
  await useRunStore.getState().setRunStatus('r','paused',9999,{resetProgress:true,expectedPrintedCount:45,onSetAside:r=>{aside=r;}});
  assert.equal(calls.length,2,'retried once only');assert.match(aside,/rejected/);
  queue.discardDeadLetters();values.clear();
 }
 // --- 2. Ops this build saved offline, then main's code loads: main never stalls. ---
 {
  values.clear();
  const queue=loadNew();
  global.fetch=offline;
  await queue.updateRunWithQueue('a',{printedCount:120});
  await queue.updateRunWithQueue('a',{status:'paused',printedCount:39,resetProgress:true,expectedPrintedCount:120},undefined,rewindEvent(40,120));
  await queue.savePrintEvent('a',{eventType:'sent',output:'roll-zpl',rangeFrom:40,rangeTo:60,labelCount:21,printedCountAfter:60,printerName:null,message:null});
  await queue.updateRunWithQueue('a',{printedCount:60});
  await queue.updateRunWithQueue('b',{status:'printing',printedCount:10});
  assert.equal(queue.pendingPatchCount(),5);
  assert.equal(keys().filter(k=>k.startsWith('lw:run-op-v2:')).length,1,'the go-back (with its event) is kept where main never reads');
  assert.equal(keys().filter(k=>k.startsWith('lw:run-op:')).length,4,'ordinary progress stays readable by main, so it isn’t lost on a rollback');
  // Main's page loads after the rollback.
  const main=loadMain();
  assert.equal(main.pendingPatchCount(),4,'main sees only what it can send (and never reads the go-back as corrupt)');
  const db={a:100,b:0};const calls=[];global.fetch=mainServer(db,calls);
  const result=await main.flushOfflineQueue();
  assert.equal(result.remaining,0,'main’s outbox drained: nothing stalled behind the go-back');
  assert.equal(main.progressSyncError(),'');
  assert.ok(calls.every(c=>!('resetProgress' in c[2])),'main never sent the go-back');
  assert.equal(db.a,120);assert.equal(db.b,10);
  assert.equal(keys().filter(k=>k.startsWith('lw:run-op-v2:')).length,1,'the go-back waits for this build');
  // New local batches on main aren't held: its count of pending progress is zero.
  assert.equal(main.pendingPatchCount(),0);
  // Rolled forward again, after another device printed on to 130: this build
  // sends the stale go-back, compare-and-set refuses it, and it is set aside
  // with plain words; its event is never sent.
  const queue2=loadNew();const calls2=[];global.fetch=newServer(db,calls2,()=>'2026-11-10T13:00:00.000Z');
  db.a=130;
  await queue2.flushOfflineQueue();
  assert.equal(calls2.length,1);assert.equal(calls2[0][2].expectedPrintedCount,120);
  assert.equal(db.a,130,'the late go-back did not erase progress');
  assert.equal(queue2.deadLetteredOps()[0].kind,'rewind-dropped');
  assert.ok(!calls2.some(c=>c[2].eventType==='rewind'),'no rewind event for a go-back that wasn’t applied');
  assert.equal(queue2.pendingPatchCount(),0);
  queue2.discardDeadLetters();values.clear();
 }
 // --- 3. Go-backs saved under main's prefix by the previous build of this branch are moved aside. ---
 {
  values.clear();
  values.set('lw:run-op:00000000-0000-4000-8000-000000000001',JSON.stringify({id:'00000000-0000-4000-8000-000000000001',createdAt:1,patch:{runId:'c',status:'paused',printedCount:4,resetProgress:true,expectedPrintedCount:9},v:2}));
  values.set('lw:run-op:00000000-0000-4000-8000-000000000002',JSON.stringify({id:'00000000-0000-4000-8000-000000000002',createdAt:2,patch:{runId:'c',printedCount:12},v:2}));
  const queue=loadNew();global.fetch=offline;
  await queue.flushOfflineQueue();
  assert.deepEqual(keys().sort(),['lw:run-op-v2:00000000-0000-4000-8000-000000000001','lw:run-op:00000000-0000-4000-8000-000000000002']);
  assert.equal(queue.pendingPatchCount('c'),2,'both kept, in order');
  const main=loadMain();const db={c:9};const calls=[];global.fetch=mainServer(db,calls);
  assert.equal((await main.flushOfflineQueue()).remaining,0);assert.equal(db.c,12);
  values.clear();
 }
 // --- 4. One order per run across both namespaces. ---
 {
  values.clear();
  const queue=loadNew();global.fetch=offline;
  await queue.updateRunWithQueue('d',{printedCount:120});
  await queue.updateRunWithQueue('d',{status:'paused',printedCount:39,resetProgress:true,expectedPrintedCount:120},undefined,rewindEvent(40,120));
  await queue.updateRunWithQueue('d',{printedCount:45});
  await queue.updateRunWithQueue('e',{printedCount:7});
  const db={d:100,e:0};const calls=[];
  // The go-back can't be sent yet: later progress for run d waits; run e goes.
  const server=newServer(db,calls,()=>'2026-11-10T14:00:00.000Z');
  global.fetch=async(url,init)=>{const b=JSON.parse(init.body);if(b.resetProgress)throw new TypeError('Failed to fetch');return server(url,init);};
  await queue.flushOfflineQueue();
  assert.deepEqual(calls.map(c=>[c[1],c[2].printedCount]),[['/api/runs/d',120],['/api/runs/e',7]]);
  assert.equal(queue.pendingPatchCount('d'),2);
  calls.length=0;global.fetch=server;
  await queue.flushOfflineQueue();
  assert.deepEqual(calls.map(c=>c[2].eventType?`event:${c[2].eventType}`:c[2].printedCount),[39,'event:rewind',45],'go-back, its event, then later progress');
  assert.equal(db.d,45);assert.equal(queue.pendingPatchCount(),0);
  values.clear();
 }
 // --- 5. The rewind event is durable and carries the server's time. ---
 {
  values.clear();dispatched.length=0;
  let queue=loadNew();global.fetch=offline;
  await queue.updateRunWithQueue('f',{status:'paused',printedCount:9,resetProgress:true,expectedPrintedCount:50},undefined,rewindEvent(10,50));
  const stored=JSON.parse(values.get(keys()[0]));
  assert.equal(stored.then.eventType,'rewind','the event is stored with the go-back, not only in memory');
  // The tab closes; a later page load sends both.
  queue=loadNew();
  assert.equal(queue.rewindPending('f'),true);
  const db={f:50};const calls=[];global.fetch=newServer(db,calls,()=>'2026-11-10T15:00:00.000Z');
  await queue.flushOfflineQueue();
  assert.equal(db.f,9);
  assert.equal(calls[1][2].eventType,'rewind');assert.equal(calls[1][2].idempotencyKey,stored.id,'one idempotency key for the event, whatever retries');
  const synced=dispatched.find(e=>e.type==='lw:event-synced');
  assert.equal(synced.detail.createdAt,'2026-11-10T15:00:00.000Z','the page gets the server’s time');
  assert.equal(queue.rewindPending('f'),false);
  // The go-back landed but its answer was lost: the next try finds the
  // server already there, counts it done and records the event.
  values.clear();calls.length=0;
  db.g=50;let first=true;const server=newServer(db,calls,()=>'2026-11-10T16:00:00.000Z');
  global.fetch=async(url,init)=>{const r=await server(url,init);if(first){first=false;throw new TypeError('network lost after the server applied it');}return r;};
  await queue.updateRunWithQueue('g',{status:'paused',printedCount:9,resetProgress:true,expectedPrintedCount:50},undefined,rewindEvent(10,50));
  assert.equal(db.g,9);assert.equal(queue.pendingPatchCount('g'),1);
  await queue.flushOfflineQueue();
  assert.equal(queue.pendingPatchCount(),0);assert.equal(queue.deadLetteredOps().length,0,'not reported as a dropped go-back');
  assert.equal(calls.filter(c=>c[2].eventType==='rewind').length,1);
  // An event for a go-back that is set aside is never sent.
  values.clear();calls.length=0;db.h=70;
  await queue.updateRunWithQueue('h',{status:'paused',printedCount:9,resetProgress:true,expectedPrintedCount:50},()=>{},rewindEvent(10,50));
  assert.equal(calls.length,1);assert.equal(db.h,70);assert.equal(queue.pendingPatchCount(),0);
  values.clear();
 }
 console.log('PASS rollback: on main’s server a go-back retries once as main’s exact write and its rewind event is dropped quietly; main’s outbox code never reads (or stalls on) a go-back, and still sends every ordinary update; previous-build go-backs are moved aside; one order per run; the rewind event is durable and carries the server’s time');
})().catch(e=>{console.error(e);process.exitCode=1;});
