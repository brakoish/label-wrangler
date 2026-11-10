// Browser-facing office status explains a control-gate hold, and a failure of
// that extra (informational) query never breaks the printer list.
require('../thermal/register.cjs');
const assert=require('node:assert/strict');
const path=require('node:path');
const mock=(file,exports)=>{require.cache[file]={id:file,filename:file,loaded:true,exports,children:[],paths:[]};};
let holdResult;const queries=[];
const printer={station_id:'office-zebra-pi',id:'black-zebra',name:'Black Zebra',online:true,available:true,dispatch_enabled:true,needs_review:false};
mock(path.resolve('src/lib/office/db.ts'),{officeSql:()=>(strings,...v)=>{const q=strings.join('?');queries.push(q);if(q.includes('FROM office_printers p'))return Promise.resolve([printer]);if(q.includes('AS reason'))return holdResult();throw new Error('unexpected '+q);}});
mock(path.resolve('src/lib/office/auth.ts'),{requireUser:async()=>({id:'u',can_print:true,is_admin:false})});
const route=require('../../src/app/api/office/stations/route.ts');
(async()=>{
 holdResult=()=>Promise.resolve([{reason:'control_stale'}]);
 let body=await (await route.GET(new Request('https://example.test/api/office/stations'))).json();
 assert.equal(body.printers[0].dispatch_hold_reason,'control_stale');assert.equal(body.printers[0].name,'Black Zebra');
 holdResult=()=>Promise.resolve([{reason:null}]);
 body=await (await route.GET(new Request('https://example.test/api/office/stations'))).json();
 assert.equal(body.printers[0].dispatch_hold_reason,null);
 holdResult=()=>Promise.reject(new Error('relation does not exist'));
 const res=await route.GET(new Request('https://example.test/api/office/stations'));
 assert.equal(res.status,200);body=await res.json();assert.equal(body.printers[0].dispatch_hold_reason,null);assert.equal(body.canPrint,true);
 assert.ok(queries.every(q=>!/\b(INSERT|UPDATE|DELETE)\b/i.test(q)),'status API must stay read-only');
 console.log('PASS office status: control-gate hold reason exposed, read-only, failure falls back without breaking the printer list');
})().catch(e=>{console.error(e);process.exitCode=1;});
