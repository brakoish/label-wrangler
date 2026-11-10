// "Go back to label N" is kept in the print history once the server accepts
// it, so every device and the Runs list respect it: office work sent before
// it is never offered as "mark printed" again. A saved "Send all in parts"
// plan never offers labels already counted as printed.
const h=require('./route-harness.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const officeRows=[];
{const file=path.resolve('src/lib/office/db.ts');require.cache[file]={id:file,filename:file,loaded:true,exports:{officeSql:()=>async()=>officeRows},children:[],paths:[]};}
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
 h.reset();
 assert.equal((await events.POST(h.request('POST',{...ev,eventType:'rewound'}),h.params('r'))).status,400,'unknown event types are still refused');
 // --- Runs list: sent work from before the rewind is not markable ---
 const list=require('../../src/app/api/runs/route.ts');
 const rewindAt='2026-11-10T12:00:00.000Z';
 officeRows.length=0;
 officeRows.push(
  {run_id:'r1',request_id:'before',request_created_at:new Date('2026-11-10T11:00:00.000Z'),id:'j1',range_from:1,range_to:100,state:'sent_to_printer',reason:null,review:false},
  {run_id:'r1',request_id:'after',request_created_at:new Date('2026-11-10T12:30:00.000Z'),id:'j2',range_from:40,range_to:60,state:'sent_to_printer',reason:null,review:false},
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
 console.log('PASS rewind: kept as a print event once accepted; the Runs list offers only office work sent after it');

 // --- The run page records a rewind only after the server accepted it ---
 const page=fs.readFileSync(path.join(__dirname,'../../src/components/runs/RunPrinter.tsx'),'utf8');
 assert.doesNotMatch(page,/noteRewind\(\)/,'no marker before the rewind is saved');
 const start=page.slice(page.indexOf('const startOrResume'),page.indexOf('const handlePause'));
 assert.ok(start.indexOf("await setRunStatus(run.id, 'printing'")<start.indexOf('recordRewind(selectedFrom'),'start: recorded after the server answered');
 assert.ok(start.indexOf('if (refusedStart.reason)')<start.indexOf('recordRewind(selectedFrom'),'never when refused');
 const back=page.slice(page.indexOf('const handleReprintFromHereAndContinue'),page.indexOf('const normalizeSheetRange'));
 assert.ok(back.indexOf("await setRunStatus(run.id, 'paused', n - 1")<back.indexOf('recordRewind(n, before)'));
 assert.ok(back.indexOf('if (refused.reason)')<back.indexOf('recordRewind(n, before)'));
 assert.match(page,/const rewoundAt = Math\.max\(localRewoundAt, serverRewoundAt\)/,'the print history counts on every device');
 console.log('PASS rewind: the run page marks a rewind only after the server accepts it, and reads other devices’ rewinds from the history');

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
