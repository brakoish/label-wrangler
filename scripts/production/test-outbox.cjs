// Offline regressions for the progress outbox: permanent 4xx responses are set
// aside (dead-lettered) instead of blocking forever, retryable failures keep
// their order per run, and set-aside updates never block new printing.
require('../thermal/register.cjs');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
global.crypto=webcrypto;
const values=new Map();
global.window={localStorage:{get length(){return values.size},key:i=>[...values.keys()][i],getItem:k=>values.has(k)?values.get(k):null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)},dispatchEvent:()=>true};
const queue=require('../../src/lib/offlineQueue.ts');
(async()=>{
 // A 404 (run deleted elsewhere) is set aside; it no longer counts as pending.
 const sent=[];
 global.fetch=async(url,init)=>{sent.push([url,JSON.parse(init.body)]);return Response.json({error:'Run not found'},{status:404});};
 await queue.updateRunWithQueue('gone',{printedCount:10});
 assert.equal(queue.pendingPatchCount(),0);assert.equal(queue.pendingPatchCount('gone'),0);
 let dead=queue.deadLetteredOps();assert.equal(dead.length,1);assert.equal(dead[0].status,404);assert.equal(dead[0].runId,'gone');assert.match(dead[0].message,/no longer exists/);assert.match(dead[0].message,/Run not found/);
 // Every permanent status dead-letters; each of them is attempted exactly once.
 for(const status of [400,403,409,410,413,415,422]){
  let calls=0;global.fetch=async()=>{calls++;return Response.json({error:'nope'},{status});};
  await queue.updateRunWithQueue('r'+status,{printedCount:1});await queue.flushOfflineQueue();
  assert.equal(calls,1,`status ${status} retried`);assert.equal(queue.pendingPatchCount(),0,`status ${status} still pending`);
 }
 assert.equal(queue.deadLetteredOps().length,8);
 assert.match(queue.deadLetteredOps().find(d=>d.status===403).message,/permission/);
 assert.match(queue.deadLetteredOps().find(d=>d.status===413).message,/could not accept/);
 // Print events dead-letter too and keep the original event for export.
 global.fetch=async()=>Response.json({error:'Print event key already used for another event'},{status:409});
 await queue.savePrintEvent('ev',{eventType:'sent',output:'roll-zpl',rangeFrom:1,rangeTo:2,labelCount:2,printedCountAfter:2,printerName:null,message:null});
 dead=queue.deadLetteredOps().find(d=>d.runId==='ev');assert.equal(dead.kind,'event');assert.equal(dead.op.event.rangeTo,2);
 const exported=JSON.parse(queue.exportDeadLetters());assert.equal(exported.setAsideUpdates.length,9);
 queue.discardDeadLetters([dead.id]);assert.equal(queue.deadLetteredOps().length,8);
 queue.discardDeadLetters();assert.equal(queue.deadLetteredOps().length,0);
 // Retryable failures (5xx, 401, network) stay queued in order for that run only.
 const order=[];
 global.fetch=async(url,init)=>{const b=JSON.parse(init.body);order.push([url,b.printedCount]);if(url==='/api/runs/stuck')return new Response('{}',{status:503});return Response.json({id:url.split('/').pop()});};
 queue.enqueueRunPatch({runId:'stuck',printedCount:5});
 queue.enqueueRunPatch({runId:'other',printedCount:7});
 queue.enqueueRunPatch({runId:'stuck',printedCount:6});
 await queue.flushOfflineQueue();
 assert.deepEqual(order,[['/api/runs/stuck',5],['/api/runs/other',7]],'later update for a blocked run was sent out of order, or another run was blocked');
 assert.equal(queue.pendingPatchCount('stuck'),2);assert.equal(queue.pendingPatchCount('other'),0);assert.match(queue.progressSyncError(),/503/);
 global.fetch=async()=>{throw new TypeError('Failed to fetch');};
 await queue.flushOfflineQueue();assert.equal(queue.pendingPatchCount('stuck'),2);assert.match(queue.progressSyncError(),/Failed to fetch/);
 global.fetch=async()=>new Response('{}',{status:401});
 await queue.flushOfflineQueue();assert.equal(queue.pendingPatchCount('stuck'),2);assert.match(queue.progressSyncError(),/Sign in/);
 order.length=0;global.fetch=async(url,init)=>{order.push(JSON.parse(init.body).printedCount);return Response.json({id:'stuck'});};
 await queue.flushOfflineQueue();assert.deepEqual(order,[5,6]);assert.equal(queue.pendingPatchCount(),0);assert.equal(queue.progressSyncError(),'');
 // A corrupt stored entry is set aside instead of blocking the whole outbox.
 values.set('lw:run-op:broken','{not json');
 queue.enqueueRunPatch({runId:'after',printedCount:3});
 global.fetch=async()=>Response.json({id:'after'});
 await queue.flushOfflineQueue();
 assert.equal(queue.pendingPatchCount(),0);assert.equal(queue.deadLetteredOps().length,1);assert.equal(queue.deadLetteredOps()[0].kind,'unreadable');
 console.log('PASS outbox: permanent 4xx set aside (400/403/404/409/410/413/415/422), export/discard, per-run ordering, 5xx/401/network retained, corrupt entry isolated');
})().catch(e=>{console.error(e);process.exitCode=1;});
