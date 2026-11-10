// Round 8 run page rules: "Print anyway" names the labels really sent, a
// series never sends for a cancelled run, plain words when labels can't be
// drawn, and status words that match the office panel.
const assert=require('node:assert/strict');
require('../thermal/register.cjs');
const fs=require('node:fs');const path=require('node:path');
const B=require('../../src/lib/runBarcodeTicks.ts');
const O=require('../../src/lib/officeSendOutcome.ts');
const D=require('../../src/lib/runDisplayStatus.ts');
const R=require('../../src/lib/officeRange.ts');
const read=(file)=>fs.readFileSync(path.join(__dirname,'../..',file),'utf8');

// --- "Print anyway" names the exact range and count sent ---
{
  const item='The barcode on all 240 labels runs into the next label (row 2–241).';
  const count=(label)=>{const m=label.match(/\((\d[\d,]*)\) anyway$/);return m?Number(m[1].replace(/,/g,'')):label.match(/^Print label \d/)?1:null;};
  for(const send of [{from:97,to:240},{from:1,to:60},{from:61,to:120},{from:2000,to:2000}]){
    const label=B.barcodeSendTickLabel(item,send,2400);
    assert.equal(count(label),send.to-send.from+1,`the tick's count is the request's count (${label})`);
    if(send.from!==send.to)assert.ok(label.includes(`${send.from.toLocaleString('en-US')}–${send.to.toLocaleString('en-US')}`),'and its range');
  }
  assert.equal(B.barcodeSendTickLabel(item,{from:97,to:240},240),'Print labels 97–240 (144) anyway');
  assert.equal(B.barcodeSendTickLabel(item,{from:1,to:240},240),'Print all 240 anyway','the whole run keeps the plain words');
  assert.equal(B.barcodeSendTickLabel(item,null,240),'Print all 240 anyway','no range yet: plain words');
  assert.equal(B.barcodeSendTickLabel(item,{from:5,to:5},240),'Print label 5 anyway');
  assert.equal(B.barcodeSendTickLabel(item,{from:9,to:3},240),'Print all 240 anyway','a range that makes no sense is ignored');
  const some='The barcode on labels 4, 9 and 12 runs off the label (rows 5, 10 and 13).';
  assert.equal(B.barcodeSendTickLabel(some,{from:1,to:5},240),B.barcodeTickLabel(some),'a problem on some labels keeps its own count');
  const page=read('src/components/runs/RunPrinter.tsx');
  assert.match(page,/barcodeWaitWords\(false, printCheck\.blocking\.length, barcodeSendTickLabel\(printCheck\.blocking\[0\], tickSend, total\)\)/,'the wait line uses the same words as the tick');
  assert.match(read('src/components/runs/RunBarcodeCheck.tsx'),/barcodeSendTickLabel\(item, send, total\)/,'each tick names the labels sent');
  console.log('PASS run b8: Print anyway names the exact range and count sent');
}

// --- A series never sends for a cancelled run ---
{
  const panel=read('src/components/runs/OfficePiPrinter.tsx');
  const loop=panel.slice(panel.indexOf('const runSeries=async'),panel.indexOf('const startSeries=async'));
  assert.ok(loop.indexOf('await runEndedWords(i,current.parts.length)')>-1 && loop.indexOf('await runEndedWords(')<loop.indexOf('await submit(part,'),'the run is read again before every part');
  assert.ok(loop.lastIndexOf('await runEndedWords(')>loop.indexOf('await drawProof(') && loop.lastIndexOf('await runEndedWords(')<loop.indexOf('await submit(part,'),'and read again right before the send, after the check');
  assert.match(panel,/fetch\(`\/api\/runs\/\$\{encodeURIComponent\(runId\)\}`,\{cache:'no-store'\}\)/,'a fresh read of the run');
  assert.match(panel,/couldn’t check the run just now/,'an unreadable run stops the parts too');
  const page=read('src/components/runs/RunPrinter.tsx');
  const cancel=page.slice(page.indexOf('const requestCancel = async'),page.indexOf('const handleCancel = async'));
  assert.ok(cancel.indexOf('await stopOfficeSeries()')>-1 && cancel.indexOf('await stopOfficeSeries()')<cancel.indexOf('askCancelRun('),'Cancel run stops the parts first');
  assert.match(cancel,/await readOfficeJobs\(run\.id\)/,'and reads the office queue fresh');
  console.log('PASS run b8: parts stop for a cancelled run; cancel stops parts first');
}

// --- Plain words when labels can't be drawn ---
{
  assert.equal(O.drawFailureWords(new Error('Labels 1–8: Bitmap rendering failed'),{from:1,to:8}),'Couldn’t draw labels 1–8. Check the connection and try again.');
  assert.equal(O.drawFailureWords(new TypeError('Failed to fetch'),{from:5,to:5}),'Couldn’t draw label 5. Check the connection and try again.');
  assert.equal(O.drawFailureWords(new Error('Labels 1–8: Lane 1, SKU: Barcode too wide'),{from:1,to:8}),null,'a design problem keeps its own words');
  assert.equal(O.drawFailureWords(new Error('Selected range exceeds 32 MiB; select a smaller range'),{from:1,to:8}),null);
  console.log('PASS run b8: plain words when labels can’t be drawn');
}

// --- Status words match the panel; a cancelled run stays cancelled ---
{
  const run={status:'paused',printedCount:0,totalLabels:100};
  const base={sent:0,onTheWay:0,failed:0,firstFailed:null};
  assert.equal(D.runDisplayStatus(run,{...base,unsure:{from:1,to:20}}).label,'Needs a check','not sure the office got them');
  assert.equal(D.runDisplayStatus(run,{...base,printerPaused:true}).label,'Paused');
  assert.equal(D.runDisplayStatus(run,{...base,sent:20,unchecked:20}).tone,'check','a routine check is amber, never red');
  assert.equal(D.runDisplayStatus(run,{...base,refused:{from:1,to:20}}).tone,'attention','a refused send needs someone');
  assert.equal(D.runDisplayStatus(run,base).label,'Ready');
  assert.equal(R.statusAfterMarkPrinted('cancelled',100,100),null);
  const list=read('src/app/runs/page.tsx');
  assert.match(list,/\(fresh\.printedCount \|\| 0\) < \(run\.printedCount \|\| 0\)/,'bulk mark never undoes a go-back made elsewhere');
  assert.match(list,/sent — check they came out/,'a cancelled run with sent labels says so on the list');
  console.log('PASS run b8: status words match the panel; cancelled runs stay cancelled');
}
