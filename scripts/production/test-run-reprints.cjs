/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
// Owner: "i should be able to reprint as i please, just needs to be tracked".
// Printing labels that already printed goes straight through, with no
// question first; each reprint is kept in the print history, and the run's
// progress (printedCount) never goes down because of one.
const assert=require('node:assert/strict');
require('../thermal/register.cjs');
const fs=require('node:fs');const path=require('node:path');
const P=require('../../src/lib/runReprint.ts');
const {printEventLabel}=require('../../src/lib/userMessages.ts');
const {countedEventSpans}=require('../../src/lib/runProgress.ts');
const read=(file)=>fs.readFileSync(path.join(__dirname,'../..',file),'utf8');

// --- What a Print does with labels that already printed ---
// A range that is all printed: a reprint, progress stays.
assert.deepEqual(P.planStartReprints(8,3,4),{allPrinted:true,startCount:8,again:[{from:3,to:4}]});
assert.deepEqual(P.planStartReprints(8,8,8),{allPrinted:true,startCount:8,again:[{from:8,to:8}]});
// Partly printed: 3–5 again, 6–10 for the first time; progress starts at 5, never lower.
assert.deepEqual(P.planStartReprints(5,3,10),{allPrinted:false,startCount:5,again:[{from:3,to:5}]});
// The next labels: nothing prints twice.
assert.deepEqual(P.planStartReprints(5,6,10),{allPrinted:false,startCount:5,again:[]});
assert.deepEqual(P.planStartReprints(0,1,10),{allPrinted:false,startCount:0,again:[]});
// Labels printed by scanning, with "Print only" or confirmed at the office print again too (repeats and labels outside the range ignored).
assert.deepEqual(P.planStartReprints(5,6,20,[2,9,10,10,11,15,30]).again,[{from:9,to:11},{from:15,to:15}]);
// Labels within the progress are named once, in the leading stretch.
assert.deepEqual(P.planStartReprints(5,3,20,[4,7]).again,[{from:3,to:5},{from:7,to:7}]);
// Bad progress reads as nothing printed.
assert.deepEqual(P.planStartReprints(NaN,1,3),{allPrinted:false,startCount:0,again:[]});

// --- Progress is a high-water mark ---
assert.equal(P.progressAfter(5,3),5,'reprinting 3 never moves progress back to 3');
assert.equal(P.progressAfter(5,5),5);
assert.equal(P.progressAfter(5,9),9,'first-time labels move it on');
{
  // Feed by feed over 3–10 after printing 1–5: never below 5, ends at 10.
  const seen=[3,4,5,6,7,8,9,10].map((physical)=>P.progressAfter(5,physical));
  assert.deepEqual(seen,[5,5,5,6,7,8,9,10]);
  for(let i=1;i<seen.length;i++)assert.ok(seen[i]>=seen[i-1],'progress never goes down');
}

// --- What a stop partway keeps ---
assert.deepEqual(P.reprintSpansDone([{from:3,to:5},{from:9,to:9}],4),[{from:3,to:4}],'cut short at label 4');
assert.deepEqual(P.reprintSpansDone([{from:3,to:5},{from:9,to:9}],2),[],'nothing sent yet');
assert.deepEqual(P.reprintSpansDone([{from:3,to:5},{from:9,to:9}],20),[{from:3,to:5},{from:9,to:9}]);

// --- The note after printing ---
assert.equal(P.againNotice([{from:3,to:4}]),'Labels 3–4 printed again (logged as a reprint).');
assert.equal(P.againNotice([{from:7,to:7}]),'Label 7 printed again (logged as a reprint).');
assert.equal(P.againNotice([{from:3,to:5},{from:9,to:9}]),'Labels 3–5 and 9 printed again (logged as a reprint).');
assert.equal(P.againNotice([1,3,5,7,9,11,13].map((n)=>({from:n,to:n}))),'Labels 1, 3, 5, 7, 9 and 2 more printed again (logged as a reprint).');
assert.equal(P.againNotice([]),'');

// --- History entries ---
{
  const entries=P.reprintEntries([{from:3,to:5},{from:9,to:9}]);
  assert.deepEqual(entries,[{from:3,to:5,labelCount:3,message:P.REPRINT_MESSAGE},{from:9,to:9,labelCount:1,message:P.REPRINT_MESSAGE}]);
  // Each reads as a reprint in the history, and none counts toward progress.
  for(const e of entries){
    const event={eventType:'sent',output:'roll-zpl',rangeFrom:e.from,rangeTo:e.to,message:e.message};
    assert.match(printEventLabel(event),/^Reprinted label/);
  }
  assert.deepEqual(countedEventSpans(entries.map((e)=>({eventType:'sent',output:'roll-zpl',rangeFrom:e.from,rangeTo:e.to})),100),[],'a reprint never counts as progress');
  // Many scattered labels: a bounded number of entries, every label counted once.
  const many=Array.from({length:30},(_,i)=>({from:i*2+1,to:i*2+1}));
  const capped=P.reprintEntries(many,20);
  assert.equal(capped.length,20);
  assert.equal(capped.reduce((n,e)=>n+e.labelCount,0),30);
  assert.deepEqual({from:capped[19].from,to:capped[19].to},{from:39,to:59});
  assert.match(capped[19].message,/^Reprint \(run progress unchanged\): labels 39, 41/);
  assert.match(printEventLabel({eventType:'sent',output:'roll-zpl',rangeFrom:39,rangeTo:59,message:capped[19].message}),/^Reprinted/);
}

// --- Source checks: run page (local printer) ---
{
  const page=read('src/components/runs/RunPrinter.tsx');
  const start=page.slice(page.indexOf('const startOrResume = async'),page.indexOf('const handlePause = async'));
  assert.ok(start.length>1000,'start path found');
  // No blocking "already printed" question on the way to printing.
  assert.doesNotMatch(start,/Print \$\{which\} again\?/,'no question before printing an all-printed range');
  assert.doesNotMatch(start,/Go back to label \$\{startFrom\} and continue\?/,'no go-back question for a range that crosses printed labels');
  assert.doesNotMatch(start,/'Print them again'|Skip \$\{one/,'no scan-mode question');
  assert.doesNotMatch(start,/resetProgress/,'Print never moves progress back');
  // "Move start to N" (a From that skips unprinted labels) is unchanged.
  assert.match(start,/confirmLabel: `Move start to \$\{skipped\.from\}`,\s*altLabel: `Print only \$\{only\}`,\s*extraLabel: `\$\{one \? 'It' : 'They'\} already printed…`/);
  // An all-printed range goes to the reprint path (logged, progress unchanged).
  assert.match(start,/if \(selectedThrough <= printedCount\) \{\s*starting\.current = false;\s*await handleReprintRange\(\{ from: startFrom, to: selectedThrough \}, 'reprint'\);/);
  // Progress is a high-water mark while printing, after a failure, and when saved.
  assert.match(start,/const progress = progressAfter\(startCount, physical\);\s*setFromDraft\(null\);\s*setCountDraft\(null\);\s*setPrintedCount\(progress\);/);
  assert.match(start,/if \(progress > saved\) \{ saved = progress; void persistProgress\(progress\); \}/);
  assert.match(start,/const kept = progressAfter\(startCount, atPhysical\);\s*await setRunStatus\(run\.id, 'paused', kept\);/);
  // Reprints are logged once: at the end, on a failure, or on a pause or cancel partway.
  assert.match(start,/await logReprintsOnce\(printRange\.to\);/);
  assert.match(start,/await logReprintsOnce\(atPhysical\);/);
  assert.match(page,/const handlePause = async \(\) => \{\s*const logReprinted = reprintLog\.current;[\s\S]{0,400}if \(logReprinted\) await logReprinted\(\);/);
  assert.match(page,/const handleCancel = async[^\n]*\n\s*const logReprinted = reprintLog\.current;[\s\S]{0,300}if \(logReprinted\) await logReprinted\(\);/);
  // The first-time labels are their own history line, after the reprinted ones.
  assert.match(start,/const firstNew = Math\.max\(printRange\.from, startCount \+ 1\);/);
  // The short note after printing, never a question before.
  assert.match(start,/setAgainNotice\(againNotice\(reprint\.again\)\)/);
  assert.match(page,/\{againNoticeText && <p role="status"/);
  // The reprint panel keeps its own history message, and a stop partway keeps what was sent.
  assert.match(page,/const message = kind === 'only' \? 'Printed out of order \(run progress unchanged\)' : REPRINT_MESSAGE;/);
  assert.match(page,/const stopReprint = \(\) => \{ const logSent = reprintLog\.current;/);
  assert.equal(P.REPRINT_MESSAGE,'Reprint (run progress unchanged)','the history wording stays the same');
  // The button names what happens.
  assert.match(page,/: crossesPrinted \? `Print \$\{selectedFrom\}\\u2060–\\u2060\$\{selectedThrough\}` :/);
}

// --- Source checks: office printer ---
{
  const panel=read('src/components/runs/OfficePiPrinter.tsx');
  const primary=panel.slice(panel.indexOf('const onPrimary=async'),panel.indexOf('const alreadyPrinted='));
  assert.ok(primary.length>200,'office primary found');
  assert.doesNotMatch(primary,/confirmDialog|choiceDialog/,'an office send over labels already sent or printed asks nothing');
  // The server's rule stays: labels still on their way wait.
  assert.match(primary,/if\(plan\.kind==='wait' \|\| !rangeValid\)return;/);
  // A one-tap "Print 51–100 again" asks nothing either.
  const again=panel.slice(panel.indexOf('const printAgainNow=async'),panel.indexOf('const fixWhy='));
  assert.doesNotMatch(again,/confirmDialog/);
  const office=require('../../src/lib/officeRange.ts');
  const job=(from,to,state,requestId='r1')=>({from,to,state,requestId,review:false});
  assert.deepEqual(office.officeSendPlan([job(1,10,'sent_to_printer')],3,4),{kind:'reprint',reprintOf:'r1',overlap:{from:3,to:4}},'an office send over sent labels is a reprint of the earlier send');
  assert.equal(office.officeSendPlan([job(1,10,'queued')],3,4).kind,'wait','still waits while the same labels are queued');
}
console.log('PASS reprints go straight through, logged as reprints, progress never lowered; Move start unchanged; office keeps its wait rule');
