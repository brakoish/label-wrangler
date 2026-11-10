// Round 5 run page rules: labels a "Print in order" fix held back are offered
// on their own afterwards, scanned labels can be left out, one tick per
// barcode problem (never carried over from the wizard for a barcode that
// spoils the next label), five status words, plain printer words.
const assert=require('node:assert/strict');
require('../thermal/register.cjs');
const fs=require('node:fs');const path=require('node:path');
const R=require('../../src/lib/officeRange.ts');
const S=require('../../src/lib/scannedLabels.ts');
const B=require('../../src/lib/runBarcodeTicks.ts');
const D=require('../../src/lib/runDisplayStatus.ts');
const W=require('../../src/lib/printerWords.ts');
const read=(file)=>fs.readFileSync(path.join(__dirname,'../..',file),'utf8');

// --- Held labels ("Print in order") ---
assert.deepEqual(R.readHeldSpans(null),[]);
assert.deepEqual(R.readHeldSpans('nope'),[]);
assert.deepEqual(R.readHeldSpans('[{"from":151,"to":200},{"from":76,"to":150}]',2000),[{from:76,to:150},{from:151,to:200}]);
assert.deepEqual(R.readHeldSpans('[{"from":0,"to":5}]'),[],'bad data reads as nothing held');
assert.deepEqual(R.readHeldSpans('[{"from":1,"to":50}]',20),[],'beyond the run reads as nothing held');
{
  const job=(from,to,state)=>({from,to,state,review:false});
  const held=[{from:76,to:150}];
  // After the fix: 76–150 cancelled, 51–75 printing again. The offer is 76–150, not 76–2000.
  assert.deepEqual(R.heldStillUnsent(held,[job(1,50,'sent_to_printer'),job(51,75,'rejected'),job(76,150,'cancelled'),job(51,75,'queued')],0,2000),[{from:76,to:150}]);
  // Sent again: nothing held any more.
  assert.deepEqual(R.heldStillUnsent(held,[job(76,150,'cancelled'),job(76,150,'queued')],0,2000),[]);
  // Partly sent again, or partly counted as printed.
  assert.deepEqual(R.heldStillUnsent(held,[job(76,100,'queued')],0,2000),[{from:101,to:150}]);
  assert.deepEqual(R.heldStillUnsent(held,[],120,2000),[{from:121,to:150}]);
  assert.deepEqual(R.heldStillUnsent([],[],0,2000),[]);
  assert.deepEqual(R.heldStillUnsent([{from:76,to:100},{from:101,to:125},{from:126,to:150}],[],0,2000),[{from:76,to:150}],'held parts read as one stretch');
}
// A saved parts plan never offers labels already counted as printed.
assert.deepEqual(R.partsAfterPrinted([{from:1,to:500},{from:501,to:1000},{from:1001,to:1500}],700),{parts:[{from:701,to:1000},{from:1001,to:1500}],trimmed:{from:1,to:700}});

// --- Scanned labels ---
const scan=(n,createdAt='2026-11-10T10:00:00.000Z',message='Scan')=>({eventType:'sent',output:'scan',rangeFrom:n,rangeTo:n,createdAt,message});
assert.deepEqual(S.scannedLabelNumbers([scan(9),scan(4),scan(4),{eventType:'sent',output:'roll-zpl',rangeFrom:1,rangeTo:50},{eventType:'failed',output:'scan',rangeFrom:7,rangeTo:7}]),[4,9]);
assert.deepEqual(S.scannedLabelNumbers([scan(4,'2026-11-10T09:00:00.000Z'),scan(9,'2026-11-10T11:00:00.000Z')],Infinity,Date.parse('2026-11-10T10:00:00.000Z')),[9],'a rewind means "print these again"');
assert.deepEqual(S.scannedLabelNumbers([scan(30)],20),[],'outside the run');
assert.deepEqual(S.scannedSkipPlan(1,10,[4,9,30]),{skipped:[4,9],keep:[{from:1,to:3},{from:5,to:8},{from:10,to:10}]});
assert.deepEqual(S.scannedSkipPlan(1,5,[1,2,3,4,5]),{skipped:[1,2,3,4,5],keep:[]});
assert.deepEqual(S.scannedSkipPlan(6,10,[1,2]),{skipped:[],keep:[{from:6,to:10}]});
assert.equal(S.labelListWords([4]),'label 4');
assert.equal(S.labelListWords([4,9]),'labels 4 and 9');
assert.equal(S.labelListWords([3,4,5,9,12]),'labels 3–5, 9 and 12');
assert.equal(S.labelListWords([1,3,5,7,9,11,13,14]),'labels 1, 3, 5, 7, 9 and 3 more');

// --- Barcode go-ahead: one tick per problem ---
const severe='The Metrc barcode on labels 1–20 prints 2.1″ wide for 24 characters and runs onto the next label, over its barcode, so neither label would scan. To fix it, make an exact-print copy of the design (More menu in the designer), which draws thinner bars.';
const cut='The Metrc barcode on label 7 prints 2.1″ wide for 24 characters, but only 1.9″ fits from where it starts, so the printer cuts it off and it won’t scan.';
assert.equal(B.barcodeProblemSevere(severe),true);assert.equal(B.barcodeProblemSevere(cut),false);
assert.match(B.barcodeDamage(severe),/two labels/);
assert.doesNotMatch(B.runPageProblemText(severe),/More menu/);
assert.equal(B.barcodeTicksAllow([severe,cut],[],true),false,'a wizard go-ahead never covers a barcode that spoils the next label');
assert.equal(B.barcodeTicksAllow([cut],[],true),true,'a wizard go-ahead still covers a milder problem');
assert.equal(B.barcodeTicksAllow([severe,cut],[severe],false),false,'every problem needs its own tick');
assert.equal(B.barcodeTicksAllow([severe,cut],[severe,cut],false),true);
assert.equal(B.barcodeTicksAllow([],[],false),true);
{
  const store=new Map();const storage={getItem:(k)=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:(k)=>store.delete(k)};
  B.saveRunBarcodeTicks(storage,'r1',[cut]);assert.deepEqual(B.readRunBarcodeTicks(storage,'r1'),[cut]);
  B.saveRunBarcodeTicks(storage,'r1',[]);assert.deepEqual(B.readRunBarcodeTicks(storage,'r1'),[]);
  store.set('lw:run-barcode-ok:r2','{bad');assert.deepEqual(B.readRunBarcodeTicks(storage,'r2'),[]);
}

// --- Five status words ---
{
  const run=(status,printedCount,totalLabels=100)=>({status,printedCount,totalLabels});
  const words=new Set(Object.values(D.RUN_STATUS_WORDS));
  assert.deepEqual([...words],['Needs you','Printing','Ready','Done','Cancelled']);
  const cases=[
    [run('queued',0),null],[run('draft',0),null],[run('paused',40),null],[run('printing',10),null],[run('completed',100),null],[run('cancelled',3),null],
    [run('queued',0),{sent:0,onTheWay:20,failed:0}],[run('queued',0),{sent:0,onTheWay:20,failed:0,held:true}],[run('queued',0),{sent:100,onTheWay:0,failed:0}],[run('queued',0),{sent:20,onTheWay:0,failed:1}],
  ];
  for(const [r,o] of cases){const s=D.runDisplayStatus(r,o);assert.ok(words.has(s.label),s.label);assert.equal(s.label,D.RUN_STATUS_WORDS[s.bucket]);}
  assert.equal(D.runDisplayStatus(run('paused',40),null).bucket,'ready');
  assert.equal(D.runDisplayStatus(run('paused',40),null).detail,'Partly printed');
  const stopped=D.runDisplayStatus(run('paused',40),null,true);
  assert.equal(stopped.label,'Needs you');assert.equal(stopped.detail,'Stopped: printer problem','after a printer error the header says what happened, not "Paused"');
  assert.equal(D.moreNeedAttention({failed:2,failedLabels:100},{from:51,to:100}),' 50 more labels also need attention.');
  assert.equal(D.moreNeedAttention({failed:2,failedLabels:51},{from:51,to:100}),' 1 more label also needs attention.');
  assert.equal(D.moreNeedAttention({failed:3},{from:51,to:100}),' 2 more parts also need attention.');
  assert.equal(D.moreNeedAttention({failed:1,failedLabels:50},{from:51,to:100}),'');
}

// --- Plain printer words ---
assert.equal(W.plainPrinterProblem('Printer media out'),'The printer is out of labels. Load a new roll, then resume printing.');
assert.equal(W.plainPrinterProblem('Printer media out, head open'),'The printer is out of labels and its lid is open. Load a new roll and close the lid, then resume printing.');
assert.match(W.plainPrinterProblem('A transfer error has occurred.'),/^The printer stopped answering over USB/);
assert.match(W.plainPrinterProblem('NetworkError: A transfer error has occurred.'),/^The printer stopped answering over USB/);
assert.equal(W.plainPrinterProblem('Printer ready'),'The printer is ready.');
assert.equal(W.plainPrinterProblem('Something else'),'Something else');

// --- Source checks: office panel ---
const panel=read('src/components/runs/OfficePiPrinter.tsx');
{
  const save=panel.slice(panel.indexOf('const saveFix='),panel.indexOf('const pendingWords='));
  assert.ok(save.indexOf('saveHeld(')>save.indexOf("method:'DELETE'"),'held labels are remembered only after the office cancelled them');
  assert.match(panel,/Print in order: cancel \$\{spanWords\(fixLater\.spans\)\} for now, print \$\{range\(fix\.part\.from,fix\.part\.to\)\} again, then offer to send/,'the dialog says what really happens');
  assert.match(panel,/:sendingHeld\?`Send \$\{range\(fromNumber,toNumber\)\} now`/,'after the reprint: "Send labels 76–150 now"');
  assert.match(panel,/heldFrom!==undefined && heldTo!==undefined\?\{from:heldFrom,to:heldTo\}:suggestOfficeRange\(/,'the held range is suggested before the rest of the run');
  assert.match(panel,/window\.addEventListener\('beforeunload',warn\)/,'leaving mid-series asks first');
  assert.match(panel,/setOfficeSeriesRunning\(true\)/,'in-app links ask too');
  assert.match(panel,/const ok=await confirmDialog\(\{title:`Send \$\{plural\(sendCount\)\} in \$\{parts\.length\} parts\?`/,'one confirm before a multi-part send');
  assert.match(panel,/if\(!resend\)\{\s*const after=partsAfterPrinted\(\[part\],printedRef\.current\);/,'a new part leaves out labels printed meanwhile; an unsure part resends exactly what it saved');
  assert.match(panel,/seriesLocks\.has\(runId\)/,'one series per run');
  assert.match(panel,/void runSeries\(\{\.\.\.partsPlan,parts:leftParts,next:0\}\)/,'"Send the remaining parts" sends only what is left');
  assert.doesNotMatch(panel,/This plan is saved on this device only/,'no storage jargon');
  assert.match(panel,/const scanned=scannedSkipPlan\(fromNumber,toNumber,scannedLabels\);/,'scanned labels are offered to leave out');
  assert.equal((panel.match(/method:'POST',body:JSON\.stringify\(payload\)/g)||[]).length,1,'one POST site for jobs');
  assert.ok(panel.indexOf('try{localStorage.setItem(storageKey,JSON.stringify(payload));}')<panel.indexOf("api('/api/office/jobs',{method:'POST'"),'the key is saved before the POST');
}
// --- Source checks: run page ---
const page=read('src/components/runs/RunPrinter.tsx');
assert.match(page,/confirmLabel: scanned\.keep\.length \? `Skip \$\{one \? 'it' : 'them'\}` : 'Don’t print',\s*altLabel: 'Print them again'/,'skipping scanned labels is the primary button');
assert.match(page,/feedsDone >= feedEnds\.length \? printRange\.to/,'skipped labels at the end still count as printed when the batch finishes');
assert.doesNotMatch(page,/<PrintCheckList/,'the run page has its own one-tick-per-problem check');
assert.match(page,/barcodeTicksAllow\(printCheck\.blocking, barcodeTicks, wizardBarcodeGoAhead\)/);
assert.match(page,/const calm = \(runFinished \|\| run\.status === 'cancelled' \|\| status === 'cancelled'\) && !woken && status !== 'running'/,'finished and cancelled runs are a calm summary');
assert.match(page,/\{officeFixFirst && checkList\}/,'a failed office part comes before the barcode list');
assert.match(page,/runDisplayStatus\(\{ status: run\.status, printedCount, totalLabels: total \}, officeSummary, \(status === 'error' \|\| printerStopped\)/,'the header says a printer problem stopped it');
assert.doesNotMatch(page,/remaining in printer batch/);
const nav=read('src/lib/printNavigation.ts');
assert.match(nav,/if \(officeSeries\) \{/);
console.log('PASS run r5: held labels offered on their own, parts trimmed by progress, scanned labels left out, one tick per barcode problem, five status words, plain printer words');

// --- Round 6: one set of words for office problems, refusals with a next step, held by another run ---
{
  const { officeProblemWords } = require('../../src/lib/officeProblem.ts');
  const out = officeProblemWords({ from: 51, to: 100, kind: 'did-not-print', reason: 'media out' });
  assert.equal(out.title, 'Out of labels');
  assert.equal(out.action, 'Load a new roll, then print labels 51–100 again.');
  assert.doesNotMatch(out.title, /\.$/, 'titles have no final period');
  assert.equal(officeProblemWords({ from: 101, to: 150, kind: 'needs-check', reason: 'station_outcome_timeout' }).action, 'Check whether labels 101–150 came out at the office.');
  assert.equal(officeProblemWords({ from: 7, to: 7, kind: 'print-again' }).action, 'Print label 7 again.');
  const O = require('../../src/lib/officeSendOutcome.ts');
  const offline = O.plainOfficeRefusal('Office printer is offline', 409);
  assert.equal(offline.reason, 'printer-offline');
  assert.match(offline.message, /offline/);
  assert.match(offline.message, /Office Pi/);
  assert.equal(O.refusalNextStep('printer-offline'), 'resend', 'an offline refusal offers a real resend');
  assert.equal(O.refusalNextStep('no-access'), 'none');
  assert.equal(O.refusalNextStep('already-queued'), 'queue');
  assert.doesNotMatch(O.plainOfficeRefusal('weird', 409).message, /Try again/);
  const paused = O.officeStatusLine({ online: true, dispatch_enabled: true, paired_at: 'x', needs_review: false, dispatch_hold_reason: 'printer_paused' });
  assert.match(paused.text, /^Paused/);
  const run = { status: 'queued', printedCount: 0, totalLabels: 100 };
  const held = D.runDisplayStatus(run, { sent: 0, onTheWay: 0, failed: 0, heldBy: { runId: 'a', runName: 'Run A' } });
  assert.equal(held.label, 'Waiting on another run');
  assert.equal(held.detail, '“Run A” needs a check first');
  assert.notEqual(D.runDisplayStatus({ ...run, status: 'draft' }, { sent: 0, onTheWay: 0, failed: 0, heldBy: { runId: 'a', runName: 'Run A' } }).label, 'Waiting on another run', 'drafts are not "waiting"');
  assert.equal(D.runDisplayStatus(run, { sent: 0, onTheWay: 0, failed: 1, firstFailed: { kind: 'did-not-print', from: 51, to: 100, reason: 'media out' } }).detail, 'Out of labels', 'the header names a known cause');
  // The fix dialog asks what came out, never for a tick the person can't verify; Pause is not red.
  assert.doesNotMatch(panel, /I checked: nothing for/);
  assert.match(panel, /Did any of \{range\(part\.from,part\.to\)\} come out\?/);
  assert.doesNotMatch(panel, /Try again<\/button>/, 'no "Try again" that only clears the message');
  assert.doesNotMatch(panel, /onClick=\{\(\)=>\{rangeEdited\.current=true;setReprintOf\(r\.id\)/, 'a queue row never takes over the main button');
  const controls = read('src/components/runs/OfficePrinterControls.tsx');
  assert.doesNotMatch(controls, /confirmLabel:'Pause printer',danger:true/);
  // Progress counts every printed label, wherever it sits.
  const { printedSpans, stillToGo } = require('../../src/lib/runProgress.ts');
  const spans = printedSpans(0, [{ from: 5, to: 10 }], 20);
  assert.deepEqual(spans, [{ from: 5, to: 10 }]);
  assert.deepEqual(stillToGo(spans, 20), [{ from: 1, to: 4 }, { from: 11, to: 20 }]);
  assert.deepEqual(printedSpans(4, [{ from: 5, to: 10 }], 20), [{ from: 1, to: 10 }]);
  const pageNow = read('src/components/runs/RunPrinter.tsx');
  assert.match(pageNow, /label: 'Cancel run…'/);
  assert.doesNotMatch(pageNow, /!isSheetFormat && transport !== 'office' && status !== 'completed'/, 'office and sheet runs can be cancelled');
  console.log('PASS run r6: shared problem words, refusal next step, paused in words, waiting on another run, fix asks what came out, progress counts every printed label, office runs cancel');
}
