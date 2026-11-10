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
 let dead=queue.deadLetteredOps();assert.equal(dead.length,1);assert.equal(dead[0].status,404);assert.equal(dead[0].runId,'gone');assert.match(dead[0].message,/no longer exists/);assert.doesNotMatch(dead[0].message,/Run not found|Server said/);assert.equal(dead[0].serverMessage,'Run not found');
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
 await queue.flushOfflineQueue();assert.equal(queue.pendingPatchCount('stuck'),2);assert.match(queue.progressSyncError(),/offline/);assert.doesNotMatch(queue.progressSyncError(),/Failed to fetch/,'raw browser error shown');
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
 // An origin refusal (403 with the server's code) is not a permission problem:
 // the update is kept and blocks that run instead of being set aside.
 values.clear();
 global.fetch=async()=>Response.json({error:'Request origin not allowed',code:'origin_not_allowed'},{status:403});
 let aside=null;
 assert.equal(await queue.updateRunWithQueue('origin',{status:'printing',printedCount:0},r=>{aside=r;}),null);
 assert.equal(aside,null,'origin refusal must not be set aside');
 assert.equal(queue.pendingPatchCount('origin'),1);assert.equal(queue.deadLetteredOps().length,0);
 assert.match(queue.progressSyncError(),/usual address/);
 global.fetch=async()=>Response.json({id:'origin',printedCount:0});
 await queue.flushOfflineQueue();assert.equal(queue.pendingPatchCount('origin'),0);
 // A plain 403 (no permission) is still set aside.
 global.fetch=async()=>Response.json({error:'Your account does not have permission'},{status:403});
 await queue.updateRunWithQueue('perm',{printedCount:1});assert.equal(queue.pendingPatchCount('perm'),0);assert.equal(queue.deadLetteredOps().length,1);
 queue.discardDeadLetters();
 // When this update is set aside, the caller gets null and the reason, never
 // the older cached run from an earlier success.
 global.fetch=async()=>Response.json({id:'stale',printedCount:50});
 assert.equal((await queue.updateRunWithQueue('stale',{printedCount:50})).printedCount,50);
 global.fetch=async()=>Response.json({error:'Run not found'},{status:404});
 aside=null;
 assert.equal(await queue.updateRunWithQueue('stale',{status:'printing',printedCount:50},r=>{aside=r;}),null,'stale cached run returned after a set-aside');
 assert.match(aside,/no longer exists/);
 values.clear();
 // The store passes the reason through and leaves its copy of the run alone.
 const {useRunStore}=require('../../src/lib/runStore.ts');
 useRunStore.setState({runs:[{id:'kept',printedCount:7,status:'paused'}]});
 global.fetch=async()=>Response.json({error:'This update conflicts'},{status:409});
 aside=null;
 assert.equal(await useRunStore.getState().setRunStatus('kept','printing',7,{onSetAside:r=>{aside=r;}}),null);
 assert.match(aside,/conflicts/);assert.equal(useRunStore.getState().runs[0].status,'paused');
 values.clear();
 // A rewind ("go back to label N") carries the progress this device saw; the
 // server applies it only if that still matches (compare-and-set), so a late
 // rewind never erases progress another device made in the meantime.
 {
  // Fake server with the route's rule: high-water mark, guarded rewinds.
  let server={rw:120};const calls=[];
  const fakeServer=async(url,init)=>{
   const id=url.split('/').pop();const b=JSON.parse(init.body);calls.push([id,b]);
   if(b.resetProgress&&typeof b.expectedPrintedCount==='number'&&server[id]!==b.expectedPrintedCount)return Response.json({error:'changed',code:'progress_changed',printedCount:server[id]},{status:409});
   if(b.printedCount!==undefined)server[id]=b.resetProgress?b.printedCount:Math.max(server[id]??0,b.printedCount);
   return Response.json({id,printedCount:server[id]});
  };
  // The review's scenario: progress 120 queued and failed (offline), then
  // "Go back to label 40" queued behind it. Another device prints to 250.
  global.fetch=async()=>{throw new TypeError('Failed to fetch');};
  server.rw=100;
  await queue.updateRunWithQueue('rw',{printedCount:120});
  let aside=null;
  assert.equal(await queue.updateRunWithQueue('rw',{status:'paused',printedCount:39,resetProgress:true,expectedPrintedCount:120},r=>{aside=r;}),null);
  assert.equal(queue.pendingPatchCount('rw'),2,'both kept while offline, in order');
  server.rw=250;
  global.fetch=fakeServer;
  await queue.flushOfflineQueue();
  assert.deepEqual(calls.map(c=>c[1].printedCount),[120,39],'progress first, then the guarded rewind');
  assert.equal(calls[1][1].expectedPrintedCount,120,'the rewind carries what this device saw');
  assert.equal(server.rw,250,'the stale rewind did not erase the other device’s progress');
  assert.equal(queue.pendingPatchCount('rw'),0);
  const dropped=queue.deadLetteredOps().find(d=>d.runId==='rw');
  assert.equal(dropped.kind,'rewind-dropped');assert.match(dropped.message,/Go back to label 40/);assert.match(dropped.message,/another device/);assert.match(dropped.message,/250 printed/);
  queue.discardDeadLetters();values.clear();calls.length=0;
  // Same queue on one device only: progress 120 lands, then the rewind applies.
  server.rw2=100;
  global.fetch=async()=>{throw new TypeError('Failed to fetch');};
  await queue.updateRunWithQueue('rw2',{printedCount:120});
  await queue.updateRunWithQueue('rw2',{status:'paused',printedCount:39,resetProgress:true,expectedPrintedCount:120});
  global.fetch=fakeServer;
  await queue.flushOfflineQueue();
  assert.equal(server.rw2,39,'a single-device rewind behind its own progress applies');
  assert.equal(queue.pendingPatchCount(),0);assert.equal(queue.deadLetteredOps().length,0);
  // A rewind refused straight away tells the caller in plain words.
  server.rw3=60;aside=null;
  assert.equal(await queue.updateRunWithQueue('rw3',{status:'paused',printedCount:9,resetProgress:true,expectedPrintedCount:40},r=>{aside=r;}),null);
  assert.match(aside,/Go back to label 10/);assert.match(aside,/60 printed/);assert.equal(server.rw3,60);
  queue.discardDeadLetters();
  // expectedPrintedCount never rides on an ordinary progress update.
  calls.length=0;
  await queue.updateRunWithQueue('rw3',{printedCount:61,expectedPrintedCount:60});
  assert.equal('expectedPrintedCount' in calls[0][1],false);
  // The store sends the count the caller saw (falls back to its own copy).
  const {useRunStore:store}=require('../../src/lib/runStore.ts');
  store.setState({runs:[{id:'rw4',printedCount:33,status:'paused'}]});
  server.rw4=50;calls.length=0;
  await store.getState().setRunStatus('rw4','paused',5,{resetProgress:true,expectedPrintedCount:50});
  assert.equal(calls[0][1].resetProgress,true);assert.equal(calls[0][1].expectedPrintedCount,50);assert.equal(server.rw4,5);
  store.setState({runs:[{id:'rw4',printedCount:33,status:'paused'}]});server.rw4=33;calls.length=0;
  await store.getState().setRunStatus('rw4','paused',2,{resetProgress:true});
  assert.equal(calls[0][1].expectedPrintedCount,33,'store copy as the fallback');
  assert.equal(queue.pendingPatchCount(),0);
  values.clear();
 }
 // An update queued while another flush is finishing is still sent.
 {
  let release;const gate=new Promise(r=>{release=r;});const sentBodies=[];
  global.fetch=async(url,init)=>{sentBodies.push(JSON.parse(init.body).printedCount);if(sentBodies.length===1)await gate;return Response.json({id:'race',printedCount:sentBodies[sentBodies.length-1]});};
  queue.enqueueRunPatch({runId:'race',printedCount:1});
  const first=queue.flushOfflineQueue();
  await new Promise(r=>setTimeout(r,0));
  const second=queue.updateRunWithQueue('race',{printedCount:2});
  release();await first;await second;
  assert.deepEqual(sentBodies,[1,2]);assert.equal(queue.pendingPatchCount(),0);
  values.clear();
 }
 console.log('PASS outbox: a rewind queued behind other progress is compare-and-set on the server (dropped with plain words when another device moved progress, applied otherwise); raw server text kept out of messages; no update left behind by a finishing flush');
 console.log('PASS outbox: origin refusal blocks (kept, not set aside); set-aside update returns null with its reason and drops the cached run');
 console.log('PASS outbox: permanent 4xx set aside (400/403/404/409/410/413/415/422), export/discard, per-run ordering, 5xx/401/network retained, corrupt entry isolated');
})().catch(e=>{console.error(e);process.exitCode=1;});
