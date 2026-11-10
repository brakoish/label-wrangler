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
 // Sheet tab confirming 1-30 after 61-90 sends an absolute 30 with a status.
 let {res,set}=await put({status:'paused',printedCount:30,completedAt:null});
 assert.equal(res.status,200);assert.ok(is(set.printedCount,SQL),'status update with printedCount must use greatest()');
 ({set}=await put({printedCount:30,progressOnly:true}));assert.ok(is(set.printedCount,SQL));
 // Explicit rewind (Reprint from / Reprint all) is still possible.
 ({set}=await put({status:'paused',printedCount:9,resetProgress:true}));assert.equal(set.printedCount,9);
 ({set}=await put({status:'queued',printedCount:0,resetProgress:true}));assert.equal(set.printedCount,0);
 // Updates without printedCount leave it alone.
 ({set}=await put({status:'paused'}));assert.equal('printedCount' in set,false);
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
