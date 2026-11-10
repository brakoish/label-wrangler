// Print-only accounts may record run progress and print history; editing a
// run, template, format or preset still requires the edit permission.
process.env.HARNESS_REAL_GUARD='1';
const h=require('./route-harness.cjs');
const assert=require('node:assert/strict');
const runRoute=require('../../src/app/api/runs/[id]/route.ts');
const eventRoute=require('../../src/app/api/runs/[id]/print-events/route.ts');
const templateRoute=require('../../src/app/api/templates/[id]/route.ts');
const printOnly={id:'p',username:'printer',can_print:true,can_edit:false,is_admin:false};
const editOnly={id:'e',username:'editor',can_print:false,can_edit:true,is_admin:false};
const readOnly={id:'r',username:'reader',can_print:false,can_edit:false,is_admin:false};
const event={eventType:'sent',output:'roll-zpl',rangeFrom:1,rangeTo:2,labelCount:2,printedCountAfter:2,printerName:null,message:null};
(async()=>{
 const put=async(user,body)=>{h.reset();h.session.user=user;h.results.push([{totalLabels:100,printedCount:0}],[{id:'run'}]);return runRoute.PUT(h.request('PUT',body),h.params('run'));};
 assert.equal((await put(printOnly,{printedCount:5,progressOnly:true})).status,200);
 assert.equal((await put(printOnly,{status:'paused',printedCount:5})).status,200);
 assert.equal((await put(printOnly,{status:'queued',printedCount:0,resetProgress:true})).status,200);
 assert.equal((await put(printOnly,{name:'Renamed'})).status,403,'print-only user renamed a run');
 assert.equal((await put(printOnly,{printedCount:5,sourceData:['a']})).status,403,'print-only user replaced source rows');
 assert.equal((await put(editOnly,{printedCount:5,progressOnly:true})).status,200,'edit-only user lost progress recording');
 assert.equal((await put(editOnly,{name:'Renamed'})).status,200);
 assert.equal((await put(readOnly,{printedCount:5})).status,403,'read-only user recorded progress');
 h.reset();h.session.user=printOnly;h.results.push(undefined,[{id:'print-event-x',runId:'run',...event,createdAt:'now'}]);
 assert.equal((await eventRoute.POST(h.request('POST',event),h.params('run'))).status,201);
 h.reset();h.session.user=readOnly;assert.equal((await eventRoute.POST(h.request('POST',event),h.params('run'))).status,403);
 h.reset();h.session.user=printOnly;assert.equal((await templateRoute.PUT(h.request('PUT',{name:'x'}),h.params('t'))).status,403,'print-only user edited a template');
 h.reset();h.session.user=printOnly;assert.equal((await runRoute.DELETE(h.request('DELETE'),h.params('run'))).status,403,'print-only user deleted a run');
 console.log('PASS permissions: print-only records progress/history, cannot edit runs/templates or delete; edit-only keeps progress; read-only refused');
})().catch(e=>{console.error(e);process.exitCode=1;});
