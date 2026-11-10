// Deletes blocked by saved references return 409 with a plain explanation,
// not a 500, and the client keeps the item and surfaces the message.
const h=require('./route-harness.cjs');
const assert=require('node:assert/strict');
const fk=()=>Object.assign(new Error('wrapped'),{cause:Object.assign(new Error('violates foreign key constraint'),{code:'23503'})});
(async()=>{
 const formatRoute=require('../../src/app/api/formats/[id]/route.ts');
 h.reset();h.results.push(fk(),[{count:3,archived:1}]);
 let res=await formatRoute.DELETE(h.request('DELETE'),h.params('f'));let body=await res.json();
 assert.equal(res.status,409);assert.equal(body.error,'This format is used by 3 designs (1 archived). Delete or move those first.');
 const presetRoute=require('../../src/app/api/presets/[id]/route.ts');
 h.reset();h.results.push(fk(),[{count:1}]);
 res=await presetRoute.DELETE(h.request('DELETE'),h.params('p'));body=await res.json();
 assert.equal(res.status,409);assert.match(body.error,/used by 1 run,/);
 const runRoute=require('../../src/app/api/runs/[id]/route.ts');
 h.reset();h.results.push(fk(),[{count:4}],[{count:2}]);
 res=await runRoute.DELETE(h.request('DELETE'),h.params('r'));body=await res.json();
 assert.equal(res.status,409);assert.match(body.error,/6 print records/);
 // Unrelated database failures stay a generic 500.
 h.reset();h.results.push(new Error('connection reset'));
 const quiet=console.error;console.error=()=>{};
 try{res=await runRoute.DELETE(h.request('DELETE'),h.params('r'));}finally{console.error=quiet;}
 assert.equal(res.status,500);
 // Unreferenced deletes still succeed.
 h.reset();res=await formatRoute.DELETE(h.request('DELETE'),h.params('f'));assert.equal(res.status,200);
 // A print event for a deleted run is a 404 (the outbox sets it aside) rather than a retried 500.
 const eventRoute=require('../../src/app/api/runs/[id]/print-events/route.ts');
 h.reset();h.results.push(fk());
 res=await eventRoute.POST(h.request('POST',{eventType:'sent',output:'roll-zpl',rangeFrom:1,rangeTo:1,labelCount:1}),h.params('gone'));assert.equal(res.status,404);
 // Client keeps the item and returns the message.
 const {useRunStore}=require('../../src/lib/runStore.ts');
 useRunStore.setState({runs:[{id:'r'}],presets:[{id:'p'}],error:null});
 global.fetch=async()=>Response.json({error:'This run has print history (2 print records), so it can\'t be deleted.'},{status:409});
 assert.match(await useRunStore.getState().deleteRun('r'),/print history/);assert.equal(useRunStore.getState().runs.length,1);assert.equal(useRunStore.getState().error,null);
 assert.ok(await useRunStore.getState().deletePreset('p'));assert.equal(useRunStore.getState().presets.length,1);
 const {useFormatStore}=require('../../src/lib/store.ts');
 useFormatStore.setState({formats:[{id:'f'}]});
 global.fetch=async()=>Response.json({error:'This format is used by 3 designs. Delete or move those first.'},{status:409});
 await assert.rejects(useFormatStore.getState().deleteFormat('f'),e=>e.status===409&&/3 designs/.test(e.message));assert.equal(useFormatStore.getState().formats.length,1);
 console.log('PASS delete conflicts: FK-blocked format/preset/run deletes return 409 with counts, other errors stay 500, client keeps items and shows the message');
})().catch(e=>{console.error(e);process.exitCode=1;});
