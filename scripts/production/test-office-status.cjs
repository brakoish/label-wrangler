// Browser-facing office status explains a control-gate hold and names the run
// whose labels stop the shared printer; a failure of those extra
// (informational) queries never breaks the printer list. Definite refusals
// from the office SQL functions reach the browser as 409, not 500.
require('../thermal/register.cjs');
const assert=require('node:assert/strict');
const path=require('node:path');
const mock=(file,exports)=>{require.cache[file]={id:file,filename:file,loaded:true,exports,children:[],paths:[]};};
let holdResult,reviewResult,sqlHandler=null;const queries=[];
const printer={station_id:'office-zebra-pi',id:'black-zebra',name:'Black Zebra',online:true,available:true,dispatch_enabled:true,needs_review:false};
mock(path.resolve('src/lib/office/db.ts'),{officeSql:()=>(strings,...v)=>{const q=strings.join('?');queries.push(q);if(sqlHandler)return sqlHandler(q,v);if(q.includes('FROM office_printers p'))return Promise.resolve([printer]);if(q.includes('AS reason'))return holdResult();if(q.includes('first_sequence'))return reviewResult();throw new Error('unexpected '+q);}});
mock(path.resolve('src/lib/office/auth.ts'),{requireUser:async()=>({id:'u',can_print:true,is_admin:false}),requirePrinter:async()=>({dpi:203,max_width_dots:832})});
const route=require('../../src/app/api/office/stations/route.ts');
const review=require('../../src/app/api/office/review/route.ts');
const controls=require('../../src/app/api/office/controls/route.ts');
const post=(body)=>new Request('https://example.test/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
(async()=>{
 holdResult=()=>Promise.resolve([{reason:'control_stale'}]);
 let body=await (await route.GET(new Request('https://example.test/api/office/stations'))).json();
 assert.equal(body.printers[0].dispatch_hold_reason,'control_stale');assert.equal(body.printers[0].name,'Black Zebra');
 assert.deepEqual(body.printers[0].review_holds,[],'nothing holds the printer');
 assert.ok(!queries.some(q=>q.includes('first_sequence')),'no extra query unless something needs a check');
 holdResult=()=>Promise.resolve([{reason:null}]);
 body=await (await route.GET(new Request('https://example.test/api/office/stations'))).json();
 assert.equal(body.printers[0].dispatch_hold_reason,null);
 holdResult=()=>Promise.reject(new Error('relation does not exist'));
 let res=await route.GET(new Request('https://example.test/api/office/stations'));
 assert.equal(res.status,200);body=await res.json();assert.equal(body.printers[0].dispatch_hold_reason,null);assert.equal(body.canPrint,true);
 // A part that needs a check stops the printer for everyone: name the run and labels.
 printer.needs_review=true;holdResult=()=>Promise.resolve([{reason:null}]);
 reviewResult=()=>Promise.resolve([{run_id:'run-a',run_name:'Run A stalls',range_from:26,range_to:50,did_not_print:false,first_sequence:3}]);
 body=await (await route.GET(new Request('https://example.test/api/office/stations'))).json();
 assert.deepEqual(body.printers[0].review_holds,[{run_id:'run-a',run_name:'Run A stalls',from:26,to:50,did_not_print:false}]);
 assert.equal(body.printers[0].needs_review,true);
 reviewResult=()=>Promise.reject(new Error('boom'));
 res=await route.GET(new Request('https://example.test/api/office/stations'));
 assert.equal(res.status,200);body=await res.json();assert.deepEqual(body.printers[0].review_holds,[],'a failed hold query never breaks the list');
 printer.needs_review=false;
 assert.ok(queries.every(q=>!/\b(INSERT|UPDATE|DELETE)\b/i.test(q)),'status API must stay read-only');
 console.log('PASS office status: control-gate hold reason and the run/labels that stop the printer exposed, read-only, failures fall back without breaking the printer list');

 // --- Review: a job that no longer needs a check is a definite 409 ---------
 const job='00000000-0000-4000-8000-0000000000aa';
 sqlHandler=(q)=>{if(q.includes('SELECT station_id'))return Promise.resolve([{station_id:'office-zebra-pi',printer_id:'black-zebra'}]);if(q.includes('office_resolve'))return Promise.reject(new Error('Job does not require resolution'));throw new Error('unexpected '+q);};
 res=await review.POST(post({jobId:job,pendingCupsResolved:true,reason:'They printed.'}));
 assert.equal(res.status,409,'already resolved is a definite refusal');assert.equal((await res.json()).code,'already_resolved');
 sqlHandler=(q)=>{if(q.includes('SELECT station_id'))return Promise.resolve([{station_id:'office-zebra-pi',printer_id:'black-zebra'}]);if(q.includes('office_resolve'))return Promise.reject(new Error('connection reset'));throw new Error('unexpected');};
 res=await review.POST(post({jobId:job,pendingCupsResolved:true,reason:'They printed.'}));
 assert.equal(res.status,500,'an unknown failure stays "not sure"');assert.doesNotMatch((await res.json()).error,/connection reset/);
 sqlHandler=(q)=>{if(q.includes('SELECT station_id'))return Promise.resolve([{station_id:'office-zebra-pi',printer_id:'black-zebra'}]);if(q.includes('office_resolve'))return Promise.resolve([{}]);throw new Error('unexpected');};
 res=await review.POST(post({jobId:job,pendingCupsResolved:true,reason:'They printed.'}));assert.equal(res.status,200);

 // --- Controls: refusals raised by office_control_create are 409/403 --------
 const key='00000000-0000-4000-8000-0000000000bb';
 for(const [message,status,code] of [['A printer control is still pending',409,'control_pending'],['Control worker offline',409,'worker_offline'],['Idempotency conflict',409,'key_conflict'],['Station unavailable',409,'station_unavailable'],['Control permission denied',403,'no_permission']]){
  sqlHandler=(q)=>{if(q.includes('can_control'))return Promise.resolve([{can_control:true}]);if(q.includes('office_control_create'))return Promise.reject(new Error(message));throw new Error('unexpected '+q);};
  res=await controls.POST(post({action:'pause',idempotencyKey:key}));
  assert.equal(res.status,status,message);assert.equal((await res.json()).code,code);
 }
 sqlHandler=(q)=>{if(q.includes('can_control'))return Promise.resolve([{can_control:true}]);if(q.includes('office_control_create'))return Promise.reject(new Error('timeout'));throw new Error('unexpected');};
 res=await controls.POST(post({action:'pause',idempotencyKey:key}));assert.equal(res.status,500,'unknown failures stay "not sure"');
 const O=require('../../src/lib/officeSendOutcome.ts');
 assert.equal(O.controlFailure(409,'control_pending').keep,false);assert.match(O.controlFailure(409,'control_pending').message,/still on its way/);
 assert.equal(O.controlFailure(409,'worker_offline').keep,false);assert.match(O.controlFailure(409,'worker_offline').message,/isn’t reporting/);
 assert.equal(O.controlFailure(401,undefined,true).keep,true,'a resend keeps its key when signed out');
 assert.equal(O.controlFailure(403,undefined,true).keep,true,'a resend keeps its key on 403');
 assert.equal(O.controlFailure(401).keep,false);
 sqlHandler=null;
 console.log('PASS office routes: "Job does not require resolution" and Pause/Resume refusals answer 409 (403 for permission), unknown failures stay 500');
})().catch(e=>{console.error(e);process.exitCode=1;});
