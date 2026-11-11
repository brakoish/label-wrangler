// The owner's "blank label at the end" (main afa3c52/50ea233) in this build's
// office panel: the choice is saved with the request (and its key) before the
// one POST and reused unchanged on a resend; only the last part of a "Send all
// in parts" carries it; a pending record written by main's panel resumes as
// itself. Offline: the office database, session and run store are fakes.
const assert=require('node:assert/strict');
require('../thermal/register.cjs');
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const R=require('../../src/lib/officeRange.ts');
const O=require('../../src/lib/officeSendOutcome.ts');
const read=(file)=>fs.readFileSync(path.join(__dirname,'../..',file),'utf8');

// --- Only the part that ends the whole range carries the blank -------------
{
  const parts=R.officeSendParts(1,2000,500,1);
  const plan={stationId:'office-zebra-pi',printerId:'black-zebra',parts,next:0,at:'t',endBlankAt:2000};
  assert.deepEqual(parts.map(p=>R.partCarriesEndBlank(plan,p)),[false,false,false,true],'one blank, after the last part only');
  assert.deepEqual(parts.map(p=>R.partCarriesEndBlank({...plan,endBlankAt:undefined},p)),[false,false,false,false],'not asked for: never');
  assert.equal(R.partCarriesEndBlank(null,parts[3]),false);
  // Saved with the plan, so closing the page and sending the rest later keeps it.
  const saved=R.readPartsPlan(JSON.stringify({...plan,next:2}));
  assert.equal(saved.endBlankAt,2000,'kept in the saved parts plan');
  assert.deepEqual(R.remainingParts(saved).map(p=>R.partCarriesEndBlank(saved,p)),[false,true],'resumed: still only the last part');
  const old={stationId:'s',printerId:'p',parts,next:1,at:'t'};
  assert.deepEqual(R.readPartsPlan(JSON.stringify(old)),old,'a plan saved before this change reads as before (no blank)');
  assert.equal(R.readPartsPlan(JSON.stringify({...old,endBlankAt:'2000'})).endBlankAt,undefined,'a malformed choice is dropped, never guessed');
  // Labels counted as printed meanwhile trim the start of a part, never its end.
  const trimmed=R.partsAfterPrinted([parts[3]],1700).parts[0];
  assert.deepEqual(trimmed,{from:1701,to:2000});assert.equal(R.partCarriesEndBlank(plan,trimmed),true);
  // The office already has the last part (a resend that arrived): the earlier
  // part left over is not the end of the range, so it never takes the blank.
  assert.equal(R.partCarriesEndBlank(plan,parts[2]),false);
  // A series stopped (Stop after this part, cancelled run) before the last part: no blank sent.
  const sentWithBlank=[];for(let i=0;i<parts.length;i++){if(i===2)break;sentWithBlank.push(R.partCarriesEndBlank(plan,parts[i]));}
  assert.ok(sentWithBlank.every(b=>!b),'a stopped series never sends the blank on an earlier part');
  console.log('PASS end blank: only the last part of a series, kept in the saved plan, never on an earlier part');
}

// --- A pending record written by main's panel resumes as itself ------------
{
  const key=crypto.randomUUID();
  const mainRecord={runId:'r1',endBlank:true,stationId:'office-zebra-pi',printerId:'black-zebra',from:1,to:63,idempotencyKey:key,expectedBitmapDigest:'a'.repeat(64)};
  assert.deepEqual(O.readSavedOfficeRequest(JSON.stringify(mainRecord)),{from:1,to:63,endBlank:true});
  assert.deepEqual(O.readSavedOfficeRequest(JSON.stringify({...mainRecord,endBlank:false,reprintOf:key})),{from:1,to:63,reprintOf:key,endBlank:false});
  const ours={runId:'r1',stationId:'office-zebra-pi',printerId:'black-zebra',from:5,to:9,idempotencyKey:key};
  assert.deepEqual(O.readSavedOfficeRequest(JSON.stringify(ours)),{from:5,to:9,endBlank:false},'no endBlank: no blank');
  assert.equal(O.readSavedOfficeRequest(JSON.stringify({...ours,endBlank:'yes'})).endBlank,false,'only true means a blank');
  assert.equal(O.readSavedOfficeRequest(null),null);
  assert.equal(O.readSavedOfficeRequest('{bad'),'unreadable');
  assert.equal(O.readSavedOfficeRequest(JSON.stringify({from:'1',to:2})),'unreadable');
  // Our record is main's record: same key, and the fields main reads.
  const panel=read('src/components/runs/OfficePiPrinter.tsx');
  assert.match(panel,/const storageKey=`lw:office-pending:\$\{runId\}`;/,'same key as main, so a rollback resumes it');
  console.log('PASS end blank: main-format pending records (with or without endBlank) resume; ours stay readable by main');
}

// --- Plain words -------------------------------------------------------------
{
  const words=O.queuedNotice('Labels 1–63',false,{paused:false,stopped:false},63);
  assert.match(words,/^Labels 1–63 are queued for the office printer\. One blank label comes out after label 63\. You can leave/);
  assert.doesNotMatch(O.queuedNotice('Labels 1–63',false,{paused:false,stopped:false}),/blank/,'no blank asked: not mentioned');
  assert.match(O.queuedNotice('Label 4',true,{paused:true,stopped:false},4),/One blank label comes out after label 4\./);
  const room=O.plainOfficeRefusal('Final batch has no room for a blank feed. Choose a smaller range or reduce artwork size.',400);
  assert.equal(room.reason,'no-blank-room');assert.match(room.message,/isn’t room for the blank label/);
  assert.equal(O.refusalNextStep('no-blank-room'),'without-blank','the way out is a send without the blank, never the refused send again');
  assert.equal(O.plainOfficeRefusal('This range with its blank feed exceeds 32 MiB. Choose a smaller range.',400).reason,'no-blank-room');
  assert.equal(O.plainOfficeRefusal('Request exceeds 32 MiB of printer data',413).reason,'too-large');
  assert.equal(O.officeFailureKind(400),'refused','a definite refusal: the saved request is cleared');
  // The refused send remembers that it asked for the blank, so other resends keep it.
  assert.deepEqual(O.readRefusal(JSON.stringify({from:1,to:9,reason:'labels-changed',message:'m',at:'x',endBlank:true})).endBlank,true);
  assert.equal(O.readRefusal(JSON.stringify({from:1,to:9,reason:'other',message:'m',at:'x'})).endBlank,undefined);
  assert.equal(O.plainOfficeRefusal('Invalid end blank option',400).reason,'other','developer words never shown');
  console.log('PASS end blank: plain words for the notice and refusals');
}

// --- The panel: saved before the POST, reused unchanged ---------------------
{
  const src=read('src/components/runs/OfficePiPrinter.tsx');
  const submit=src.slice(src.indexOf('const submit=async'),src.indexOf('const [directCheck,setDirectCheck]'));
  const blank=submit.indexOf('const blank=target?partBlank:direct?direct.endBlank===true:endBlank;');
  const literal=submit.indexOf('payload={runId,stationId:printer.station_id,printerId:printer.id,from:want.from,to:want.to,idempotencyKey:crypto.randomUUID(),...(blank?{endBlank:true}:{}),');
  const save=submit.indexOf('localStorage.setItem(storageKey,JSON.stringify(payload))');
  const post=submit.indexOf("api('/api/office/jobs',{method:'POST',body:JSON.stringify(payload),");
  assert.ok(blank>0 && literal>blank && save>literal && post>save,'endBlank is in the payload saved (with its key) before the single POST');
  assert.ok(submit.indexOf('try{payload=JSON.parse(saved);}')>0 && submit.indexOf('try{payload=JSON.parse(saved);}')<save,'a resend posts the saved record');
  assert.doesNotMatch(submit,/payload\.endBlank\s*=(?!=)|delete payload|payload=\{\.\.\.payload/,'and never changes it');
  assert.equal(src.split("api('/api/office/jobs',{method:'POST'").length-1,1,'one POST site');
  const loop=src.slice(src.indexOf('const runSeries=async'),src.indexOf('const startSeries=async'));
  assert.match(loop,/const blankHere=partCarriesEndBlank\(current,part\);\s*const outcome=await submit\(part,undefined,blankHere\);/,'each part asks the plan whether it ends the range');
  const start=src.slice(src.indexOf('const startSeries=async'),src.indexOf('// Leaving the page mid-series'));
  assert.match(start,/const blankAt=chosen\?opts\.endBlankAt:endBlank\?\(list\[list\.length-1\]\.to===toNumber\?toNumber:undefined\):undefined;[\s\S]{0,1600}\.\.\.\(blankAt\?\{endBlankAt:blankAt\}:\{\}\)/,'the choice is saved in the parts plan (with the part that ends the range)');
  assert.match(src,/const \[endBlank,setEndBlank\]=useState\(false\);/,'defaults off');
  // Per send: off again after every send that went through, and a saved record never changes the box.
  assert.match(submit,/setPending\(null\);setPosting\(false\);\s*\/\/[^\n]*\n\s*setEndBlank\(false\);/,'a successful send turns the box off');
  assert.doesNotMatch(src,/setEndBlank\(data\.endBlank\)/,'a resumed record keeps its choice for its own resend only');
  assert.match(src,/\{!pending && rangeValid && <BlankOption id=\{`\$\{uid\}-form-blank`\} checked=\{endBlank\}/,'the form’s box is hidden while a saved request waits (it resends as saved)');
  assert.match(src,/setFix\(\{part,seen:'',againText:'',note:'',order:'in-order',blank:null\}\)/,'the fix dialog starts untouched (fixBlank decides)');
  // B13: untouched, the box is ticked only when the plan's last label is where an earlier send's blank was, and that blank went with the labels this plan sends.
  assert.match(src,/if\(current\.blank!==null\)return current\.blank;/,'a person’s choice always wins');
  assert.match(src,/return jobs\.some\(j=>j\.to===last && sentWithBlank\(j\.requestId\) && Math\.max\(\.\.\.jobs\.filter\(o=>o\.requestId===j\.requestId\)\.map\(o=>o\.to\)\)===last\);/,'only the true end of a send that asked for the blank');
  assert.match(src,/const blank=fixBlank\(current\);\s*if\(blank && heldLast!==null\)saveHeldBlank\(heldLast\);\s*const blankOnReprint=blank && heldLast===null;/,'a "Print in order" fix feeds the blank after the held labels, never after the reprint');
  // B13: a "too big" split keeps the blank due for the send that ends the range.
  assert.match(src,/if\(again\.endBlank===true && end<again\.to\)saveBlankDue\(again\.to\);/,'the split remembers where the blank is due');
  assert.match(src,/if\(blankDueAt!==null && payload\.to===blankDueAt\)saveBlankDue\(null\);/,'the send ending there clears it');
  assert.match(src,/body:`\$\{end-part\.from===0\?'It prints':'They print'\} once more on the office printer\. The run’s progress doesn’t change\.`/,'a one-confirm reprint has no blank');
  // No room for the blank: a new request without it, never the refused payload again.
  assert.match(src,/refusalStep==='without-blank'[\s\S]{0,400}sendNow\(\{from:again\.from,to:Math\.min\(again\.to,again\.from\+cap-1\)\},undefined,false,false\)/);
  // While the single POST is on its way, the panel doesn't say "not sure".
  assert.match(src,/const unsure=!!pending && !posting && \(pendingPhase==='unsure' \|\| pendingPhase==='missing'\);/);
  // Before "not sure", the page checks the office queue, and says when another tab is sending.
  assert.match(src,/Checking whether the office got \$\{range\(pending\.from,pending\.to\)\}…/);
  assert.match(src,/\{unsure && pending && <Recovery tone="warning"/);
  assert.match(src,/const unsureFrom=unsure\?pending\?\.from:undefined/);
  assert.match(src,/payload\.endBlank===true\?payload\.to:undefined/,'the notice names the blank when one was asked for');
  console.log('PASS end blank: panel saves the choice before the POST, resends it unchanged, passes it to the last part only');
}

// --- The server (main's code, unchanged): same identity on a resend ---------
(async()=>{
  const mock=(rel,exports)=>{const file=path.resolve(rel);require.cache[file]={id:file,filename:file,loaded:true,exports,children:[],paths:[]};};
  const hash=(v)=>crypto.createHash('sha256').update(v).digest('hex');
  const requests=new Map();
  const sql=(strings,...values)=>{
    const text=strings.join('?');
    if(text.includes('SELECT id,fingerprint FROM office_requests')){const r=requests.get(values[1]);return Promise.resolve(r?[{id:r.id,fingerprint:r.fingerprint}]:[]);}
    if(text.includes('SELECT dispatch_enabled'))return Promise.resolve([{dispatch_enabled:true,paired_at:'2026-11-01T00:00:00Z'}]);
    if(text.includes('office_enqueue')){const id=crypto.randomUUID();requests.set(values[2],{id,fingerprint:values[3],batches:JSON.parse(values[12])});return Promise.resolve([{id}]);}
    return Promise.reject(new Error('unexpected query '+text));
  };
  mock('src/lib/office/db.ts',{officeSql:()=>sql});
  mock('src/lib/office/auth.ts',{hash,requirePrinter:async()=>({dpi:203,max_width_dots:448})});
  const format={id:'f',type:'thermal',width:2,height:1,dpi:203,labelsAcross:1};
  const text={id:'text',type:'text',x:10,y:10,width:180,height:40,rotation:0,zIndex:0,isStatic:false,fieldName:'name',fontSize:9,lineHeight:1.2,textAlign:'left',content:'',fontWeight:'normal'};
  const run={id:'r1',staticValues:{},fieldMappings:{name:{mode:'column',csvColumn:'name'}},sourceData:Array.from({length:63},(_,i)=>({name:'Label '+(i+1)})),designSnapshot:{template:{id:'t',elements:[text]},format}};
  mock('src/lib/runDesign.server.ts',{loadRunWithDesign:async()=>run});
  const {createJobs}=require('../../src/lib/office/jobs.ts');
  const user={id:crypto.randomUUID(),username:'u',can_print:true,can_edit:false,is_admin:false};
  const base={runId:'r1',stationId:'office-zebra-pi',printerId:'black-zebra',from:1,to:63};
  const decode=b=>Buffer.from(b.payload,'base64').toString();

  const withBlank={...base,endBlank:true,idempotencyKey:crypto.randomUUID()};
  const first=await createJobs(user,JSON.parse(JSON.stringify(withBlank)));
  assert.deepEqual(await createJobs(user,JSON.parse(JSON.stringify(withBlank))),first,'a resend of the saved request is the same request');
  await assert.rejects(createJobs(user,{...base,idempotencyKey:withBlank.idempotencyKey}),/already used/,'the same key without the blank is refused, never a second print');
  const plainKey=crypto.randomUUID();
  await createJobs(user,{...base,idempotencyKey:plainKey});
  const blanked=requests.get(withBlank.idempotencyKey).batches,plain=requests.get(plainKey).batches;
  assert.deepEqual(blanked.map(b=>[b.from,b.to,b.count]),plain.map(b=>[b.from,b.to,b.count]),'label counts unchanged');
  assert.deepEqual(blanked.slice(0,-1).map(decode),plain.slice(0,-1).map(decode),'earlier batches unchanged');
  assert.ok(decode(blanked.at(-1)).endsWith('^PQ1\n^XZ') && decode(blanked.at(-1)).startsWith(decode(plain.at(-1))),'one blank at the end of the final batch');
  // Main's panel saves endBlank:false; this build leaves it out. Same request either way.
  const mainKey=crypto.randomUUID();
  const r1=await createJobs(user,{...base,from:2,to:3,endBlank:false,idempotencyKey:mainKey});
  assert.deepEqual(await createJobs(user,{...base,from:2,to:3,idempotencyKey:mainKey}),r1,'a record saved by main (endBlank:false) resent by this build matches');
  await assert.rejects(createJobs(user,{...base,endBlank:'true',idempotencyKey:crypto.randomUUID()}),/Invalid end blank option/);
  console.log('PASS end blank: server identity — resend reuses the request, a changed choice is refused, false and absent match');
})().catch(e=>{console.error(e);process.exit(1);});
