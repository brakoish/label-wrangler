// "Go back to label N" is kept in the print history once the server accepts
// it, so every device and the Runs list respect it: office work sent before
// it is never offered as "mark printed" again. A saved "Send all in parts"
// plan never offers labels already counted as printed.
const h=require('./route-harness.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const officeRows=[];
const officeCalls=[];
{const file=path.resolve('src/lib/office/db.ts');require.cache[file]={id:file,filename:file,loaded:true,exports:{officeSql:()=>async(strings,...values)=>{officeCalls.push([strings.join('?'),values]);return officeRows;}},children:[],paths:[]};}
const {lastRewindAt,afterRewind,rewindEvent,REWIND_EVENT}=require('../../src/lib/runRewind.ts');
const R=require('../../src/lib/officeRange.ts');
(async()=>{
 // --- Pure rules ---
 assert.equal(lastRewindAt([]),0);
 assert.equal(lastRewindAt([{eventType:'rewind',createdAt:'2026-11-10T10:00:00.000Z'},{eventType:'rewind',createdAt:'2026-11-10T12:00:00.000Z'},{eventType:'confirmed',createdAt:'2026-11-10T13:00:00.000Z'}]),Date.parse('2026-11-10T12:00:00.000Z'));
 assert.equal(afterRewind('2026-11-10T11:00:00.000Z',0),true,'no rewind: everything counts');
 assert.equal(afterRewind('2026-11-10T11:00:00.000Z',Date.parse('2026-11-10T12:00:00.000Z')),false);
 assert.equal(afterRewind('2026-11-10T13:00:00.000Z',Date.parse('2026-11-10T12:00:00.000Z')),true);
 const ev=rewindEvent(120,400);
 assert.deepEqual([ev.eventType,ev.output,ev.rangeFrom,ev.rangeTo,ev.labelCount,ev.printedCountAfter],['rewind','roll-zpl',120,400,281,119]);
 assert.deepEqual([rewindEvent(1,0).rangeFrom,rewindEvent(1,0).rangeTo,rewindEvent(1,0).labelCount],[1,1,0],'a valid range even from nothing printed');
 // --- The print-events route takes it (additive) ---
 const events=require('../../src/app/api/runs/[id]/print-events/route.ts');
 h.reset();h.results.push([],[{id:'print-event-x',runId:'r',...ev,createdAt:'now'}]);
 const saved=await events.POST(h.request('POST',ev),h.params('r'));
 assert.equal(saved.status,201,'a rewind event is accepted');
 {
  // Stamped with the database clock (like office requests), not this server's.
  const values=h.log.flat().find((call)=>Array.isArray(call)&&call[0]==='values')?.[1]?.[0];
  assert.ok(values&&typeof values.createdAt==='object'&&!('toISOString' in values.createdAt),'createdAt is an SQL expression');
  const route=fs.readFileSync(path.join(__dirname,'../../src/app/api/runs/[id]/print-events/route.ts'),'utf8');
  assert.match(route,/to_char\(now\(\) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"'\)/,'same ISO shape, database time');
  assert.doesNotMatch(route,/new Date\(\)\.toISOString\(\)/,'no app-server clock for print events');
 }
 h.reset();
 assert.equal((await events.POST(h.request('POST',{...ev,eventType:'rewound'}),h.params('r'))).status,400,'unknown event types are still refused');
 // --- Runs list: sent work from before the rewind is not markable ---
 const list=require('../../src/app/api/runs/route.ts');
 const rewindAt='2026-11-10T12:00:00.000Z';
 officeRows.length=0;
 officeRows.push(
  // Rows as the aggregate query returns them: stretches per run, state and
  // side of the rewind (the database works out after_rewind from the cutoff).
  {run_id:'r1',state:'sent_to_printer',after_rewind:false,range_from:1,range_to:100,review:false,id:null,request_id:null,reason:null},
  {run_id:'r1',state:'sent_to_printer',after_rewind:true,range_from:40,range_to:60,review:false,id:null,request_id:null,reason:null},
 );
 h.reset();
 // Queries run side by side, so each answer is picked by what was asked.
 const answer=(calls)=>{
  const fields=Object.keys(calls[0][1][0]||{});
  if(fields.includes('name'))return [{id:'r1',name:'R1',status:'paused',totalLabels:2000,printedCount:39}];
  if(fields.includes('type'))return [{runId:'r1',type:'confirmed',from:1,to:100,createdAt:'2026-11-10T11:30:00.000Z'},{runId:'r1',type:REWIND_EVENT,from:40,to:100,createdAt:rewindAt}];
  return [{runId:'r1'}];
 };
 h.results.push(answer,answer,answer,answer);
 const res=await list.GET(new Request('https://example.test/api/runs?offset=0'));
 const rows=await res.json();
 assert.equal(res.status,200);
 const office=rows[0].office;
 assert.ok(office,'office summary present');
 assert.deepEqual(office.markable.ranges,[{from:40,to:60}],'only the stretch sent after the rewind is offered; the confirmation from before it is not counted');
 assert.equal(office.markable.through,60);
 assert.deepEqual(office.unsent,[{from:101,to:2000}],'labels the office has none of are named on every device');
 // The query gets each run's latest rewind (server time), summed up in SQL rather than a row per job.
 const [text,values]=officeCalls[officeCalls.length-1];
 assert.match(text,/GROUP BY run_id, state, after_rewind, island/,'office jobs are aggregated in the database');
 assert.deepEqual(values.slice(1,3),[['r1'],[rewindAt]],'the rewind cutoff is passed per run');
 console.log('PASS rewind: kept as a print event once accepted; the Runs list offers only office work sent after it');

 // --- The run page never stamps a rewind with this device's clock ---
 const page=fs.readFileSync(path.join(__dirname,'../../src/components/runs/RunPrinter.tsx'),'utf8');
 assert.doesNotMatch(page,/noteRewind\(\)/,'no marker before the rewind is saved');
 assert.doesNotMatch(page,/recordRewind|localRewoundAt|pendingRewind/,'no local rewind stamp or in-memory pending rewind');
 assert.doesNotMatch(page,/setItem\(`lw:run-rewound/,'no clock stamp kept on this device');
 assert.match(page,/const rewoundAt = rewindWaiting \? Number\.POSITIVE_INFINITY : serverRewoundAt;/,'the server’s rewind time once read back; nothing offered while the go-back waits in the outbox');
 const store=fs.readFileSync(path.join(__dirname,'../../src/lib/runStore.ts'),'utf8');
 assert.match(store,/rewind = rewindEvent\(printedCount \+ 1/,'the store queues the rewind event with the go-back');
 console.log('PASS rewind: the run page uses the server’s rewind time only, and holds back office offers while a go-back is unsent');

 // --- Saved parts never offer what is already printed ---
 const parts=[{from:1,to:500},{from:501,to:1000},{from:1001,to:1500},{from:1501,to:2000}];
 assert.deepEqual(R.partsAfterPrinted(parts,0),{parts,trimmed:null});
 assert.deepEqual(R.partsAfterPrinted(parts.slice(2),2000),{parts:[],trimmed:{from:1001,to:2000}},'everything printed elsewhere: nothing offered');
 assert.deepEqual(R.partsAfterPrinted(parts.slice(2),1200),{parts:[{from:1201,to:1500},{from:1501,to:2000}],trimmed:{from:1001,to:1200}},'a part that straddles progress starts after it');
 assert.deepEqual(R.officeUnsentSpans([],100,0),[],'nothing at the office: nothing to say');
 assert.deepEqual(R.officeUnsentSpans([{from:1,to:500,state:'sent_to_printer'},{from:501,to:1000,state:'queued'}],2000,0),[{from:1001,to:2000}]);
 assert.deepEqual(R.officeUnsentSpans([{from:1,to:500,state:'sent_to_printer'},{from:501,to:1000,state:'cancelled'}],2000,0),[{from:501,to:2000}],'cancelled before sending is unsent');
 assert.deepEqual(R.officeUnsentSpans([{from:1,to:500,state:'sent_to_printer'}],2000,2000),[]);
 console.log('PASS parts: a saved plan drops parts already counted as printed; unsent labels come from the office records');
})().catch(e=>{console.error(e);process.exitCode=1;});
