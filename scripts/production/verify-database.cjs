// Explicit integration verification. Uses synthetic records in its own schema.
require('../thermal/register.cjs');
require('@next/env').loadEnvConfig(process.cwd(),false);
const {neon}=require('@neondatabase/serverless');
const {drizzle}=require('drizzle-orm/neon-http');
const assert=require('node:assert/strict');
(async()=>{
 const sql=neon(process.env.DATABASE_URL), schema='reliability_verify_'+Date.now();
 await sql.query(`CREATE SCHEMA ${schema}`);
 for(const table of ['formats','templates','runs','run_print_events']) {
  await sql.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
  await sql.query(`ALTER TABLE ${schema}.${table} ADD PRIMARY KEY(id)`);
 }
 await sql.query(`ALTER TABLE ${schema}.runs ADD COLUMN IF NOT EXISTS design_snapshot jsonb`);
 const scoped=(...args)=>sql.transaction([sql.query(`SET LOCAL search_path TO ${schema},public`),sql(...args)]).then(r=>r[1]);
 scoped.query=(text,params,options)=>sql.transaction([sql.query(`SET LOCAL search_path TO ${schema},public`),sql.query(text,params)],options).then(r=>r[1]);
 require('../../src/lib/db/index.ts').db=drizzle(scoped);
 require('../../src/lib/office/guard.ts').withOfficeAuth=h=>h;
 const formats=require('../../src/app/api/formats/route.ts');
 const templates=require('../../src/app/api/templates/route.ts');
 const item=require('../../src/app/api/templates/[id]/route.ts');
 const runs=require('../../src/app/api/runs/route.ts');
 const runItem=require('../../src/app/api/runs/[id]/route.ts');
 const req=data=>new Request('http://test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const ctx=id=>({params:Promise.resolve({id})});
 const f=await(await formats.POST(req({name:'Synthetic',type:'thermal',width:2,height:1,dpi:203}))).json();
 const t=await(await templates.POST(req({name:'Original',formatId:f.id,elements:[]}))).json();assert.ok(t.id);
 const r=await(await runs.POST(req({name:'Synthetic',templateId:t.id,sourceData:['a','b'],status:'draft'}))).json();assert.equal(r.designSnapshot.template.name,'Original');
 const responses=await Promise.all(['A','B'].map(name=>item.PUT(req({name,expectedUpdatedAt:t.updatedAt}),ctx(t.id))));assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 const persisted=await(await runItem.GET(new Request('http://test'),ctx(r.id))).json();assert.equal(persisted.designSnapshot.template.name,'Original');
 assert.equal((await item.PUT(req({name:'No revision'}),ctx(t.id))).status,428);
 assert.equal((await runItem.PUT(req({printedCount:3}),ctx(r.id))).status,400);
 await runItem.PUT(req({printedCount:2,progressOnly:true}),ctx(r.id));await runItem.PUT(req({printedCount:1,progressOnly:true}),ctx(r.id));
 assert.equal((await(await runItem.GET(new Request('http://test'),ctx(r.id))).json()).printedCount,2);
 assert.equal((await templates.POST(req({name:'X',formatId:f.id,id:'overwrite'}))).status,400);
 const events=require('../../src/app/api/runs/[id]/print-events/route.ts');
 const event={eventType:'sent',output:'roll-zpl',rangeFrom:1,rangeTo:2,labelCount:2,printedCountAfter:2,idempotencyKey:crypto.randomUUID()};
 const first=await events.POST(req(event),ctx(r.id));assert.equal(first.status,201);const saved=await first.json();
 const retry=await events.POST(req(event),ctx(r.id));assert.equal((await retry.json()).id,saved.id);
 assert.equal((await events.POST(req({...event,labelCount:1}),ctx(r.id))).status,409);
 assert.equal((await(await events.GET(new Request('http://test'),ctx(r.id))).json()).length,1);
 console.log(JSON.stringify({passed:['snapshot immutability','atomic concurrent-save conflict','missing revision rejected','invalid progress rejected','stale progress cannot regress','immutable ID rejected','idempotent print history retry'],isolatedSchema:schema,productionRecordsChanged:0}));
})().catch(error=>{console.error(error.message);process.exitCode=1});
