// Progress is a high-water mark on the server: stale or out-of-order updates
// can never lower printedCount; only an explicit resetProgress rewind can.
const h=require('./route-harness.cjs');
const assert=require('node:assert/strict');
const {is,SQL}=require('drizzle-orm');
const route=require('../../src/app/api/runs/[id]/route.ts');
(async()=>{
 const setArgs=()=>h.log.find(c=>c[0][0]==='update').find(([k])=>k==='set')[1][0];
 async function put(body){
  h.reset();
  h.results.push([{totalLabels:100,printedCount:60}],[{id:'r',printedCount:60}]);
  const res=await route.PUT(h.request('PUT',body),h.params('r'));
  return {res,set:setArgs()};
 }
 // Current code marks its updates (X-LW-Client: 2): the high-water mark
 // applies to them. Tabs still running the code from before the rule send no
 // header and keep their exact writes, so their "Reprint from label N"
 // (status paused, N-1) and "Reprint all" (queued, 0) still go back.
 async function putMarked(body,header='2'){
  h.reset();
  h.results.push([{totalLabels:100,printedCount:60}],[{id:'r',printedCount:60}]);
  const req=new Request('https://example.test/api',{method:'PUT',headers:{'content-type':'application/json',...(header?{'X-LW-Client':header}:{})},body:JSON.stringify(body)});
  const res=await route.PUT(req,h.params('r'));
  return {res,set:setArgs()};
 }
 {
  let r=await putMarked({status:'paused',printedCount:9});assert.equal(r.res.status,200);assert.ok(is(r.set.printedCount,SQL),'marked: a lower count never lowers progress');
  r=await putMarked({status:'queued',printedCount:0});assert.ok(is(r.set.printedCount,SQL),'marked: "queued, 0" without a rewind flag is not a rewind');
  r=await putMarked({status:'paused',printedCount:9,resetProgress:true});assert.equal(r.set.printedCount,9,'marked: an explicit rewind goes back');
  r=await putMarked({printedCount:70,progressOnly:true});assert.ok(is(r.set.printedCount,SQL));
  // Legacy (unmarked) tabs: main's exact write for a status update with a count.
  r=await putMarked({status:'paused',printedCount:9},null);assert.equal(r.set.printedCount,9,'legacy "Reprint from label 10" still goes back to 9');
  r=await putMarked({status:'queued',printedCount:0},null);assert.equal(r.set.printedCount,0,'legacy "Reprint all" still goes back to 0');
  r=await putMarked({printedCount:30,progressOnly:true},null);assert.ok(is(r.set.printedCount,SQL),'legacy progress ticks were already "never lower" on main');
  r=await putMarked({status:'paused',printedCount:30,completedAt:null},null);assert.ok(is(r.set.printedCount,SQL),'the sheet tab confirmation only ever moves forward');
  r=await putMarked({status:'paused'},null);assert.equal('printedCount' in r.set,false);
  // A rewind flag only exists in current code, header or not.
  r=await putMarked({status:'paused',printedCount:9,resetProgress:true},null);assert.equal(r.set.printedCount,9);
  r=await putMarked({status:'paused',printedCount:40},'1');assert.equal(r.set.printedCount,40,'an older client version number is legacy');
  console.log('PASS run progress: marked updates keep the high-water mark; unmarked (older tab) updates keep main\u2019s exact writes, so their rewinds still apply');
 }
 // Sheet tab confirming 1-30 after 61-90 sends an absolute 30 with a status.
 let {res,set}=await put({status:'paused',printedCount:30,completedAt:null});
 assert.equal(res.status,200);assert.ok(is(set.printedCount,SQL),'status update with printedCount must use greatest()');
 ({set}=await put({printedCount:30,progressOnly:true}));assert.ok(is(set.printedCount,SQL));
 // Explicit rewind (Reprint from / Reprint all) is still possible.
 ({set}=await put({status:'paused',printedCount:9,resetProgress:true}));assert.equal(set.printedCount,9);
 ({set}=await put({status:'queued',printedCount:0,resetProgress:true}));assert.equal(set.printedCount,0);
 // Updates without printedCount leave it alone.
 ({set}=await put({status:'paused'}));assert.equal('printedCount' in set,false);
 // Guarded rewind (compare-and-set): applied only while the stored count is
 // still the one the device saw; otherwise a plain 409 with the current count.
 {
  const {PgDialect}=require('drizzle-orm/pg-core');const dialect=new PgDialect();
  h.reset();h.results.push([{totalLabels:100,printedCount:60}],[{id:'r',printedCount:39}]);
  let ok=await route.PUT(h.request('PUT',{status:'paused',printedCount:39,resetProgress:true,expectedPrintedCount:60}),h.params('r'));
  assert.equal(ok.status,200);assert.equal(setArgs().printedCount,39);
  const update=h.log.find(c=>c[0][0]==='update');const where=update.find(([k])=>k==='where')[1][0];
  const rendered=dialect.sqlToQuery(where);
  assert.match(rendered.sql,/"printed_count" = \$\d/,'the rewind is conditional on the stored count');assert.ok(rendered.params.includes(60));
  h.reset();h.results.push([{totalLabels:100,printedCount:60}],[],[{printedCount:250}]);
  const refused=await route.PUT(h.request('PUT',{status:'paused',printedCount:39,resetProgress:true,expectedPrintedCount:60}),h.params('r'));
  assert.equal(refused.status,409);const body=await refused.json();
  assert.equal(body.code,'progress_changed');assert.equal(body.printedCount,250);assert.match(body.error,/changed on another device \(now 250 printed\)/);
  // An unguarded update keeps its plain id filter.
  h.reset();h.results.push([{totalLabels:100,printedCount:60}],[{id:'r',printedCount:9}]);
  await route.PUT(h.request('PUT',{status:'paused',printedCount:9,resetProgress:true}),h.params('r'));
  const plain=dialect.sqlToQuery(h.log.find(c=>c[0][0]==='update').find(([k])=>k==='where')[1][0]);
  assert.doesNotMatch(plain.sql,/printed_count/);
  // expectedPrintedCount only with a rewind, and only a whole number.
  h.reset();h.results.push([{totalLabels:100,printedCount:60}]);
  assert.equal((await route.PUT(h.request('PUT',{printedCount:70,expectedPrintedCount:60}),h.params('r'))).status,400);
  h.reset();h.results.push([{totalLabels:100,printedCount:60}]);
  assert.equal((await route.PUT(h.request('PUT',{printedCount:9,resetProgress:true,expectedPrintedCount:'60'}),h.params('r'))).status,400);
  console.log('PASS run progress: guarded rewind applies only while progress matches (409 with the current count otherwise)');
 }
 // Validation: resetProgress must be boolean.
 h.reset();h.results.push([{totalLabels:100,printedCount:60}]);
 res=await route.PUT(h.request('PUT',{printedCount:1,resetProgress:'yes'}),h.params('r'));assert.equal(res.status,400);
 // Client: only rewinds send resetProgress.
 const {webcrypto}=require('node:crypto');global.crypto=webcrypto;const values=new Map();
 global.window={localStorage:{get length(){return values.size},key:i=>[...values.keys()][i],getItem:k=>values.has(k)?values.get(k):null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)},dispatchEvent:()=>true};
 const sent=[];global.fetch=async(url,init)=>{sent.push(JSON.parse(init.body));return Response.json({id:'r'});};
 const {useRunStore}=require('../../src/lib/runStore.ts');
 await useRunStore.getState().setRunStatus('r','paused',40);
 await useRunStore.getState().setRunStatus('r','paused',9,{resetProgress:true});
 assert.equal(sent[0].resetProgress,undefined);assert.equal(sent[1].resetProgress,true);
 // Every update current code queues carries the marker; one an older tab
 // left in this browser's outbox is sent without it, as that code meant it.
 {
  const headersSeen=[];const prev=global.fetch;
  global.fetch=async(url,init)=>{headersSeen.push({url,h:init.headers,b:JSON.parse(init.body)});return Response.json({id:'r'});};
  await useRunStore.getState().setRunStatus('r','paused',41);
  assert.equal(headersSeen[0].h['X-LW-Client'],'2','current updates are marked');
  values.set('lw:run-op:legacy-1',JSON.stringify({id:'legacy-1',createdAt:1,patch:{runId:'r',status:'paused',printedCount:9}}));
  const {flushOfflineQueue}=require('../../src/lib/offlineQueue.ts');
  await flushOfflineQueue();
  const legacy=headersSeen.find(x=>x.b.printedCount===9);
  assert.ok(legacy,'the older update was sent');assert.equal(legacy.h['X-LW-Client'],undefined,'an older tab\u2019s saved update is not marked');
  values.set('lw:pending-run-ops',JSON.stringify({r:{runId:'r',status:'queued',printedCount:0}}));
  await flushOfflineQueue();
  const migrated=headersSeen.find(x=>x.b.status==='queued');
  assert.ok(migrated);assert.equal(migrated.h['X-LW-Client'],undefined,'migrated old-format updates are not marked');
  global.fetch=prev;
 }
 // Run page "From" below progress, then pause: the start is an explicit rewind,
 // so the paused count is where printing really stopped and the next Resume
 // continues from there (no skipped labels). Fake server keeps the high-water mark.
 const {planRunStart}=require('../../src/lib/runRanges.ts');
 const {updateRunWithQueue}=require('../../src/lib/offlineQueue.ts');
 assert.deepEqual(planRunStart(100,101),{rewind:false,startCount:100});
 assert.deepEqual(planRunStart(0,1),{rewind:false,startCount:0});
 assert.deepEqual(planRunStart(100,100),{rewind:true,startCount:99});
 let serverCount=100;
 global.fetch=async(url,init)=>{const b=JSON.parse(init.body);if(b.printedCount!==undefined)serverCount=b.resetProgress?b.printedCount:Math.max(serverCount,b.printedCount);return Response.json({id:'r2',printedCount:serverCount,status:b.status??'printing'});};
 async function printFrom(from,stopAt){
  const plan=planRunStart(serverCount,from);
  await useRunStore.getState().setRunStatus('r2','printing',plan.startCount,{resetProgress:plan.rewind});
  for(let n=from;n<=stopAt;n+=10)await updateRunWithQueue('r2',{printedCount:n});
  await useRunStore.getState().setRunStatus('r2','paused',stopAt);
  return plan;
 }
 const plan=await printFrom(40,70);
 assert.equal(plan.rewind,true);assert.equal(plan.startCount,39);
 assert.equal(serverCount,70,'pause after a From-below-progress start must record where printing stopped');
 assert.equal(planRunStart(serverCount,serverCount+1).rewind,false,'next Resume continues at 71');
 console.log('PASS run progress: From below progress rewinds with resetProgress; pause then resume continues where it stopped');
 console.log('PASS run progress: out-of-order/stale counts never lower printedCount; explicit rewind still works; client sends rewind flag only for rewinds');
})().catch(e=>{console.error(e);process.exitCode=1;});
