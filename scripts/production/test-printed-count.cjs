// The run page and the Runs list count printed labels the same way, from the
// same saved values: the run's progress (printedCount) plus the stretches the
// print history counts (office ranges a person confirmed, labels scanned one
// by one), after the latest accepted "Go back". Round 10: after "Count 66–90
// as printed" the run page said 65 of 120 and the list 40 of 120.
const h=require('./route-harness.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const sqlCalls=[];let historyRows=[];
{const file=path.resolve('src/lib/office/db.ts');require.cache[file]={id:file,filename:file,loaded:true,exports:{officeSql:()=>async(strings,...values)=>{const text=strings.join('?');sqlCalls.push([text,values]);return text.includes('FROM run_print_events e')?historyRows:[];}},children:[],paths:[]};}
const {countedEventSpans,printedLabelCount}=require('../../src/lib/runProgress.ts');
(async()=>{
 const confirmed={eventType:'confirmed',output:'office-pi',rangeFrom:66,rangeTo:90,createdAt:'2026-11-10T12:00:00.000Z'};
 const spans=countedEventSpans([confirmed],120);
 assert.deepEqual(spans,[{from:66,to:90}]);
 assert.equal(printedLabelCount(40,spans,120),65,'40 in order plus 66–90 confirmed is 65');
 // Overlaps count once; stretches inside progress add nothing.
 assert.equal(printedLabelCount(70,spans,120),90,'1–70 plus 66–90 is 90 labels');
 assert.equal(printedLabelCount(100,spans,120),100);
 // Only confirmed office ranges and scanned labels count; a send alone does not.
 assert.deepEqual(countedEventSpans([{eventType:'sent',output:'office-pi',rangeFrom:1,rangeTo:10},{eventType:'confirmed',output:'roll-zpl',rangeFrom:1,rangeTo:10}],120),[]);
 assert.deepEqual(countedEventSpans([{eventType:'sent',output:'scan',rangeFrom:7,rangeTo:7}],120),[{from:7,to:7}]);
 // A "Go back" drops what was counted before it; nothing is counted while one waits to be saved.
 const rewoundAt=Date.parse('2026-11-10T13:00:00.000Z');
 assert.deepEqual(countedEventSpans([confirmed],120,rewoundAt),[]);
 assert.deepEqual(countedEventSpans([{...confirmed,createdAt:'2026-11-10T14:00:00.000Z'}],120,rewoundAt),[{from:66,to:90}]);
 assert.deepEqual(countedEventSpans([{...confirmed,createdAt:null}],120,Number.POSITIVE_INFINITY),[]);
 // Out-of-range stretches are clipped to the run.
 assert.equal(printedLabelCount(0,countedEventSpans([{...confirmed,rangeFrom:110,rangeTo:200}],120),120),11);

 // The Runs list returns the same stretches, worked out in the database from
 // the same print history (see runListQueries.server.ts; the PGlite check in
 // the review notes compares that SQL with countedEventSpans on real rows).
 const list=require('../../src/app/api/runs/route.ts');
 const runsRows=[{id:'r1',name:'R1',status:'paused',totalLabels:120,printedCount:40,updatedAt:'2026-11-01T00:00:00.000Z'},{id:'r2',name:'R2',status:'completed',totalLabels:50,printedCount:50,updatedAt:'2026-11-01T00:00:00.000Z'},{id:'r3',name:'R3',status:'completed',totalLabels:50,printedCount:20,updatedAt:'2026-11-01T00:00:00.000Z'}];
 const answer=(calls)=>{
  const fields=Object.keys(calls[0][1][0]||{});
  if(fields.includes('name'))return runsRows;
  return [{runId:'r1'}];
 };
 historyRows=[{run_id:'r1',kind:'c',range_from:66,range_to:90,cutoff_ms:null},{run_id:'r1',kind:'o',range_from:66,range_to:90,cutoff_ms:null}];
 h.reset();sqlCalls.length=0;
 h.results.push(answer,answer,answer,answer);
 let res=await list.GET(new Request('https://example.test/api/runs?offset=0'));
 assert.equal(res.status,200);
 let rows=await res.json();
 assert.deepEqual(rows[0].countedSpans,[{from:66,to:90}],'the list gets the stretches the run page counts');
 assert.equal(printedLabelCount(rows[0].printedCount,rows[0].countedSpans,rows[0].totalLabels),65,'so the list says 65 of 120, like the run page');
 assert.deepEqual(rows[1].countedSpans,[],'a run printed to the end needs no stretches (same count)');
 assert.equal(rows[1].hasPrintHistory,false);assert.equal(rows[0].hasPrintHistory,true,'the full read says which runs have history');
 {
  const [text,values]=sqlCalls.find(([t])=>t.includes('FROM run_print_events e'));
  assert.match(text,/GROUP BY run_id, kind, island/,'stretches come back merged, not a row per label');
  assert.deepEqual(values[0],['r1','r2','r3']);
  assert.deepEqual(values[2],[true,false,true],'counted stretches are worked out only where progress hasn’t reached the end');
 }
 // A live poll reads only runs being printed, changed lately, or named as moving.
 h.reset();sqlCalls.length=0;
 h.results.push(answer,answer,answer,answer);
 res=await list.GET(new Request('https://example.test/api/runs?offset=0&live=1&watch=r3'));
 rows=await res.json();
 {
  const [,values]=sqlCalls.find(([t])=>t.includes('FROM run_print_events e'));
  assert.deepEqual(values[0],['r1','r3'],'the paused run and the watched one only');
 }
 assert.ok('countedSpans' in rows[0]&&'office' in rows[0]&&'countedSpans' in rows[2],'read runs carry the fields');
 assert.ok(!('countedSpans' in rows[1])&&!('office' in rows[1]),'a run not read leaves them out, so the page keeps what it has');
 assert.ok(rows.every((row)=>!('hasPrintHistory' in row)),'a live poll doesn’t re-check delete history');
 assert.equal(h.log.filter((calls)=>calls[0][0]==='selectDistinct').length,0,'and runs no history query');
 // Nothing being printed or changed: a live poll asks the database for nothing more than the runs.
 h.reset();sqlCalls.length=0;
 runsRows[0].status='completed';
 h.results.push(answer,answer,answer,answer);
 res=await list.GET(new Request('https://example.test/api/runs?offset=0&live=1'));
 rows=await res.json();
 assert.equal(sqlCalls.length,0,'no history or office query');
 assert.ok(rows.every((row)=>!('countedSpans' in row)&&!('office' in row)));
 // A run changed in the last minutes is read again.
 h.reset();sqlCalls.length=0;
 runsRows[2].updatedAt=new Date(Date.now()-60000).toISOString();
 h.results.push(answer,answer,answer,answer);
 res=await list.GET(new Request('https://example.test/api/runs?offset=0&live=1'));
 rows=await res.json();
 assert.deepEqual(sqlCalls.find(([t])=>t.includes('FROM run_print_events e'))[1][0],['r3']);
 // The page asks live most of the time, with a full read at least every minute.
 {
  const runsPage=fs.readFileSync(path.join(__dirname,'../../src/app/runs/page.tsx'),'utf8');
  assert.match(runsPage,/live=1/);assert.match(runsPage,/Date\.now\(\) - lastFull >= 60000/);
 }

 // Both pages count with the same helpers.
 const read=(f)=>fs.readFileSync(path.join(__dirname,'../..',f),'utf8');
 const page=read('src/components/runs/RunPrinter.tsx');
 assert.match(page,/countedEventSpans\(eventsForRun, run\?\.totalLabels \?\? 0, rewoundAt\)/,'the run page counts with countedEventSpans');
 const runsPage=read('src/app/runs/page.tsx');
 assert.match(runsPage,/printedLabelCount\(/,'the Runs list counts with printedLabelCount');
 console.log('PASS printed count: run page and Runs list count printed labels from the same saved values (40 + confirmed 66–90 = 65 on both)');
})().catch((error)=>{console.error(error);process.exit(1);});
