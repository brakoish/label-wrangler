// The run page and the Runs list count printed labels the same way, from the
// same saved values: the run's progress (printedCount) plus the stretches the
// print history counts (office ranges a person confirmed, labels scanned one
// by one), after the latest accepted "Go back". Round 10: after "Count 66–90
// as printed" the run page said 65 of 120 and the list 40 of 120.
const h=require('./route-harness.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
{const file=path.resolve('src/lib/office/db.ts');require.cache[file]={id:file,filename:file,loaded:true,exports:{officeSql:()=>async()=>[]},children:[],paths:[]};}
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

 // The Runs list returns the same stretches, read from the same print history.
 const list=require('../../src/app/api/runs/route.ts');
 h.reset();
 const answer=(calls)=>{
  const fields=Object.keys(calls[0][1][0]||{});
  if(fields.includes('name'))return [{id:'r1',name:'R1',status:'paused',totalLabels:120,printedCount:40}];
  if(fields.includes('type')){assert.ok(fields.includes('output'),'the list reads each event’s output');return [{runId:'r1',type:'confirmed',output:'office-pi',from:66,to:90,createdAt:'2026-11-10T12:00:00.000Z'},{runId:'r1',type:'confirmed',output:'roll-zpl',from:91,to:95,createdAt:'2026-11-10T12:00:00.000Z'}];}
  return [{runId:'r1'}];
 };
 h.results.push(answer,answer,answer,answer);
 const res=await list.GET(new Request('https://example.test/api/runs?offset=0'));
 assert.equal(res.status,200);
 const rows=await res.json();
 assert.deepEqual(rows[0].countedSpans,[{from:66,to:90}],'the list gets the stretches the run page counts');
 assert.equal(printedLabelCount(rows[0].printedCount,rows[0].countedSpans,rows[0].totalLabels),65,'so the list says 65 of 120, like the run page');

 // Both pages count with the same helpers.
 const read=(f)=>fs.readFileSync(path.join(__dirname,'../..',f),'utf8');
 const page=read('src/components/runs/RunPrinter.tsx');
 assert.match(page,/countedEventSpans\(eventsForRun, run\?\.totalLabels \?\? 0, rewoundAt\)/,'the run page counts with countedEventSpans');
 const runsPage=read('src/app/runs/page.tsx');
 assert.match(runsPage,/printedLabelCount\(/,'the Runs list counts with printedLabelCount');
 console.log('PASS printed count: run page and Runs list count printed labels from the same saved values (40 + confirmed 66–90 = 65 on both)');
})().catch((error)=>{console.error(error);process.exit(1);});
