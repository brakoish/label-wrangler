/* eslint-disable @typescript-eslint/no-require-imports */
require('./register.cjs');
const assert=require('node:assert/strict');
const {neon}=require('@neondatabase/serverless');
(async()=>{
 const admin=neon(process.env.DATABASE_URL),schema='bitmap_verify_'+Date.now();
 await admin.query(`CREATE SCHEMA ${schema}`);
 await admin.query(`CREATE TABLE ${schema}.formats (LIKE public.formats INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
 await admin.query(`CREATE TABLE ${schema}.templates (LIKE public.templates INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
 await admin.query(`ALTER TABLE ${schema}.templates ADD PRIMARY KEY(id)`);
 await admin.query(`CREATE TABLE ${schema}.runs(id text PRIMARY KEY, template_id text REFERENCES ${schema}.templates(id))`);
 const scoped=(...args)=>admin.transaction([admin.query(`SET LOCAL search_path TO ${schema},public`),admin(...args)]).then(r=>r[1]);
 scoped.query=(text,params,options)=>admin.transaction([admin.query(`SET LOCAL search_path TO ${schema},public`),admin.query(text,params)],options).then(r=>r[1]);
 assert.equal((await scoped`SELECT current_schema() AS name`)[0].name,schema);
 require('../../src/lib/db/index.ts').db=require('drizzle-orm/neon-http').drizzle(scoped);
 // Exercise real route persistence, bypassing only authentication (verified over HTTP separately).
 require('../../src/lib/office/guard.ts').withOfficeAuth=handler=>handler;
 const collection=require('../../src/app/api/templates/route.ts'),item=require('../../src/app/api/templates/[id]/route.ts');
 const now=new Date().toISOString();
 await scoped`INSERT INTO formats(id,name,type,width,height,dpi,created_at,updated_at) VALUES('thermal','Test','thermal',2,1,203,${now},${now}),('sheet','Test','sheet',2,1,203,${now},${now})`;
 const req=data=>new Request('http://test/api/templates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const create=async data=>{const r=await collection.POST(req(data));return [r.status,await r.json()];};
 const [status,legacy]=await create({name:'Legacy',formatId:'thermal',elements:[]});assert.equal(status,201);assert.equal(legacy.thermalRenderMode,'native-v1');
 await new Promise(r=>setTimeout(r,5));
 const [bs,bitmap]=await create({name:'Bitmap',formatId:'thermal',thermalRenderMode:'bitmap-v1',elements:[]});assert.equal(bs,201);
 assert.equal((await create({name:'No',formatId:'sheet',thermalRenderMode:'bitmap-v1'}))[0],400);
 const ctx=id=>({params:Promise.resolve({id})});
 assert.equal((await item.PUT(req({thermalRenderMode:'bitmap-v1'}),ctx(legacy.id))).status,409);
 assert.equal((await item.PUT(req({formatId:'sheet'}),ctx(bitmap.id))).status,400);
 await scoped`INSERT INTO runs VALUES('old-run',${legacy.id}),('bitmap-run',${bitmap.id})`;
 await item.DELETE(new Request('http://test'),ctx(bitmap.id));
 let loaded=await(await item.GET(new Request('http://test'),ctx(bitmap.id))).json();assert.equal(loaded.thermalRenderMode,'bitmap-v1');assert.ok(loaded.archivedAt);
 assert.equal((await scoped`SELECT * FROM runs WHERE template_id=${bitmap.id}`).length,1);
 await item.PUT(req({archivedAt:null}),ctx(bitmap.id));loaded=await(await item.GET(new Request('http://test'),ctx(bitmap.id))).json();assert.equal(loaded.archivedAt,null);assert.equal(loaded.thermalRenderMode,'bitmap-v1');
 assert.equal((await(await item.GET(new Request('http://test'),ctx(legacy.id))).json()).thermalRenderMode,'native-v1');
 console.log(JSON.stringify({passed:['real API default mode','thermal-only validation','immutable mode','save/load','archive/restore','saved-run references'],isolatedSchema:schema,productionTemplatesChanged:0}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
