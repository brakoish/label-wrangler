// Round 10 fixes to the office panel's words and the jobs list:
// - a page that finds a saved send it didn't make asks the office first (by
//   the request's own key) and never claims "the connection dropped";
// - other tabs are told a send is on its way (a separate key; the saved
//   request itself is unchanged);
// - the run header says what is being sent, and what is still to send.
require('../thermal/register.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const mock=(file,exports)=>{require.cache[file]={id:file,filename:file,loaded:true,exports,children:[],paths:[]};};
const queries=[];let rows=[];
mock(path.resolve('src/lib/office/db.ts'),{officeSql:()=>(strings,...v)=>{queries.push([strings.join('?'),v]);return Promise.resolve(rows);}});
mock(path.resolve('src/lib/office/auth.ts'),{requireUser:async()=>({id:'u1',can_print:true,is_admin:false})});
mock(path.resolve('src/lib/office/jobs.ts'),{createJobs:async()=>({})});
const route=require('../../src/app/api/office/jobs/route.ts');
const {unconfirmedSendWords}=require('../../src/lib/officeSendOutcome.ts');
const {runDisplayStatus}=require('../../src/lib/runDisplayStatus.ts');
(async()=>{
 // Words: only a page that saw the try fail may say the connection dropped.
 assert.match(unconfirmedSendWords(undefined,undefined,'here'),/connection dropped/);
 assert.doesNotMatch(unconfirmedSendWords(undefined,undefined,'earlier'),/connection dropped/);
 assert.doesNotMatch(unconfirmedSendWords(undefined,undefined,'none'),/connection dropped/);
 assert.match(unconfirmedSendWords(undefined,undefined,'none'),/office queue doesn’t show them yet.*same request, so it won’t print twice/);
 assert.match(unconfirmedSendWords(undefined,undefined,'none',true),/doesn’t show it yet/);
 assert.match(unconfirmedSendWords(401,undefined,'earlier'),/signed out/,'a saved reason from this device is kept');

 // Jobs list: "did my send with this key arrive?" (read-only, this account's own sends).
 const key='0d6f3a8e-2b4c-4f1a-9c7e-5a1b2c3d4e5f';
 rows=[{id:'req-9'}];queries.length=0;
 let res=await route.GET(new Request(`https://example.test/api/office/jobs?runId=r1&key=${key}`));
 assert.deepEqual(await res.json(),{keyRequestId:'req-9'});
 assert.match(queries[0][0],/FROM office_requests WHERE requester=\?\s*AND idempotency_key=\?::uuid AND run_id=\?/);
 assert.deepEqual(queries[0][1],['u1',key,'r1']);
 rows=[];
 res=await route.GET(new Request(`https://example.test/api/office/jobs?runId=r1&key=${key}`));
 assert.deepEqual(await res.json(),{keyRequestId:null});
 res=await route.GET(new Request('https://example.test/api/office/jobs?runId=r1&key=nope'));
 assert.equal(res.status,400,'a bad key is refused');
 // Without a key, the list is answered as before (old tabs).
 rows=[{id:'req-1',range_from:1,range_to:25,jobs:[]}];queries.length=0;
 res=await route.GET(new Request('https://example.test/api/office/jobs?runId=r1'));
 const body=await res.json();
 assert.deepEqual(Object.keys(body),['requests']);
 assert.match(queries[0][0],/jsonb_agg/);

 // Run header: one status while sending; "still to send" while parts wait.
 const run={status:'queued',printedCount:0,totalLabels:500};
 const base={sent:100,onTheWay:0,failed:0};
 assert.equal(runDisplayStatus(run,{...base,sending:'Sending part 2 of 5'}).detail,'Sending part 2 of 5');
 const sent=runDisplayStatus(run,{...base,unchecked:100,stillToSend:400});
 assert.equal(sent.detail,'Did all 100 come out? · 400 still to send');
 assert.match(sent.detail,/400 still to send/,'the header says what is still to send');
 assert.doesNotMatch(sent.detail,/all 500/,'and never asks about all 500');

 // The panel: the in-flight mark is written right after the saved request, before the one POST, and cleared after.
 const panel=fs.readFileSync(path.join(__dirname,'../../src/components/runs/OfficePiPrinter.tsx'),'utf8');
 const save=panel.indexOf('try{localStorage.setItem(storageKey,JSON.stringify(payload));}');
 const mark=panel.indexOf('mark();const beat=setInterval(mark,4000);',save);
 const post=panel.indexOf("api('/api/office/jobs',{method:'POST',body:JSON.stringify(payload)})",save);
 assert.ok(save>0 && mark>save && post>mark,'saved request, then the in-flight mark, then the POST');
 assert.match(panel,/lw:office-sending:/,'the in-flight mark has its own key');
 assert.match(panel,/finally\{clearInterval\(beat\);unmark\(\);\}/,'and is cleared whatever the answer');
 assert.doesNotMatch(panel,/lw:office-pending:[^`]*`[^;]*tab:/,'nothing new in the saved request');
 // Start reads the count the server saved: another device ahead pauses with a word, nothing prints twice.
 const runPage=fs.readFileSync(path.join(__dirname,'../../src/components/runs/RunPrinter.tsx'),'utf8');
 assert.match(runPage,/if \(!plan\.rewind && Number\.isFinite\(serverCount\) && serverCount > startCount\) \{\s*setStatus\('paused'\); setPrintedCount\(serverCount\);\s*setErrorMsg\(`Another device already printed up to label/);
 // Pause/resume on a shared device: an older build's device-wide request is never taken over silently.
 {
  const P=require('../../src/lib/officeControlPending.ts');
  const mem=new Map();const st={getItem:(k)=>(mem.has(k)?mem.get(k):null),setItem:(k,v)=>mem.set(k,String(v)),removeItem:(k)=>mem.delete(k)};
  const old=JSON.stringify({action:'pause',idempotencyKey:'k-old'});
  mem.set(P.LEGACY_KEY,old);
  assert.equal(P.readOwnControl(st,'u2'),null,'not this account’s');
  assert.equal(mem.has('lw:office-control-pending:u2'),false,'and not copied by reading');
  assert.equal(P.readLegacyControl(st,'u2'),old,'offered only as a question');
  mem.set('lw:office-control-pending:u2',JSON.stringify({action:'resume',idempotencyKey:'k-own'}));
  assert.equal(P.readLegacyControl(st,'u2'),null,'an account with its own request is not asked');
  const controls=fs.readFileSync(path.join(__dirname,'../../src/components/runs/OfficePrinterControls.tsx'),'utf8');
  assert.match(controls,/const readSaved=\(userId\?:string\)=>readOwnControl\(store\(\),userId\);/);
  assert.match(controls,/const again=await confirmDialog\(\{title:`Send the earlier \$\{word\} from your account\?`/);
  assert.match(controls,/if\(again\)saved=adoptLegacy\(userId\);/);
 }
 // Lighter reads: the run's office list slows down when nothing moves; the stations reads run side by side.
 const hook=fs.readFileSync(path.join(__dirname,'../../src/components/runs/useOfficeRequests.ts'),'utf8');
 assert.match(hook,/setInterval\(update, moving \? 5000 : fast \? 15000 : 30000\)/);
 const stations=fs.readFileSync(path.join(__dirname,'../../src/app/api/office/stations/route.ts'),'utf8');
 assert.match(stations,/await Promise\.all\(\[readHolds, readReviews\]\);/);
 console.log('PASS office B11: key lookup before “not sure”, no false “connection dropped”, other tabs told, one header status while sending');
})().catch((error)=>{console.error(error);process.exit(1);});
