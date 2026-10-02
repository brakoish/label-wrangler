/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
const {randomUUID,createHash}=require('node:crypto');
const {neon}=require('@neondatabase/serverless');
require('@next/env').loadEnvConfig(process.cwd(),false);
const resolveFilename=Module._resolveFilename;
Module._resolveFilename=function(specifier,...rest){return resolveFilename.call(this,specifier.startsWith('@/')?path.resolve('src',specifier.slice(2)):specifier,...rest);};
require.extensions['.ts']=function(mod,file){mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);};

(async()=>{
 const sql=neon(process.env.DATABASE_URL);const schema='preview_verify_'+Date.now();
 await sql.query(`CREATE SCHEMA ${schema}`);
 const setPath=()=>sql.query(`SET LOCAL search_path TO ${schema},pg_catalog`);
 const q=async(text,params=[])=>{const r=await sql.transaction([setPath(),sql.query(text,params)]);return r[1];};
 // Exercise the production handler against real SQL in an isolated schema.
 const scoped=(...args)=>{
   const raw=sql(...args);
   return {raw,then:(resolve,reject)=>sql.transaction([setPath(),raw]).then(r=>r[1]).then(resolve,reject)};
 };
 scoped.transaction=async queries=>(await sql.transaction([setPath(),...queries.map(q=>q.raw)])).slice(1);
 require('../../src/lib/office/db.ts').officeSql=()=>scoped;
 const {createPreviewJobs}=require('../../src/lib/office/preview.ts');
 const {statements}=await import('../office/sql-statements.mjs');
 await sql.transaction([setPath(),sql.query('CREATE TABLE templates(id text PRIMARY KEY)'),
 sql.query(`CREATE TABLE runs(id text PRIMARY KEY,name text,template_id text REFERENCES templates(id),static_values jsonb,field_mappings jsonb,data_source text,source_data jsonb,status text,total_labels integer,notes text,created_at text,updated_at text)`),
 ...statements(fs.readFileSync(path.join(__dirname,'../office/schema.sql'),'utf8')).map(s=>sql.query(s))]);
 const uid=randomUUID();
 await q("INSERT INTO templates VALUES('preview-template')");
 await q("INSERT INTO office_users(id,username,password_hash,can_print) VALUES($1,'test','disabled',true)",[uid]);
 await q("INSERT INTO office_stations(id,dispatch_enabled,paired_at) VALUES('office-zebra-pi',true,now())");
 await q("INSERT INTO office_printers VALUES('office-zebra-pi','black-zebra','Test','TEST',203,448,true)");
 await q("INSERT INTO office_printer_access VALUES($1,'office-zebra-pi','black-zebra')",[uid]);
 const user={id:uid,can_print:true};
 const data={idempotencyKey:randomUUID(),stationId:'office-zebra-pi',printerId:'black-zebra',quantity:3,
   format:{id:'format',type:'thermal',width:1,height:1,dpi:203,labelsAcross:2},
   template:{id:'preview-template',formatId:'format',name:'Unsaved preview',elements:[{id:'text',type:'text',x:2,y:2,width:180,height:40,rotation:0,zIndex:0,isStatic:false,fieldName:'name',fontSize:9,lineHeight:1.2,textAlign:'left',content:'OLD',fontWeight:'normal'}]},
   testData:{name:'CURRENT PREVIEW'}};
 const results=await Promise.all(Array.from({length:4},()=>createPreviewJobs(user,data)));
 assert.ok(results.every(r=>r.requestId===results[0].requestId));
 assert.equal((await q('SELECT * FROM runs')).length,1);
 const jobs=await q('SELECT * FROM office_jobs');assert.equal(jobs.length,1);assert.equal(jobs[0].label_count,3);
 const bytes=Buffer.from(jobs[0].payload_base64,'base64');const zpl=bytes.toString();
 assert.equal((zpl.match(/CURRENT PREVIEW/g)||[]).length,3);assert.equal((zpl.match(/\^XA/g)||[]).length,2);assert.ok(!zpl.includes('OLD'));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),jobs[0].sha256);
 await assert.rejects(createPreviewJobs(user,{...data,testData:{name:'CHANGED'}}),/different preview|Idempotency/);
 assert.deepEqual(await createPreviewJobs(user,data),results[0]);
 await assert.rejects(createPreviewJobs(user,{...data,idempotencyKey:randomUUID(),quantity:26}),/1–25/);
 await assert.rejects(createPreviewJobs(user,{...data,idempotencyKey:randomUUID(),testData:{name:'^XA'}}),/control characters/);
 await assert.rejects(createPreviewJobs({...user,id:randomUUID()},{...data,idempotencyKey:randomUUID()}),/access denied/);
 await q('UPDATE office_stations SET dispatch_enabled=false');
 await assert.rejects(createPreviewJobs(user,{...data,idempotencyKey:randomUUID()}),/pairing/);
 assert.equal((await q('SELECT * FROM runs')).length,1,'Rejected enqueue rolls back test run');
 assert.equal((await q('SELECT * FROM office_jobs')).length,1);
 await q('UPDATE office_stations SET dispatch_enabled=true');
 const {renderThermalBitmap}=require('../../src/lib/thermal/render.server.ts');
 const bitmap={...data,idempotencyKey:randomUUID(),template:{...data.template,thermalRenderMode:'bitmap-v1',elements:data.template.elements.map(e=>({...e,fontFamily:'Liberation Sans',autoFit:true,minFontSize:4}))}};
 const proofs=await Promise.all([[bitmap.testData,bitmap.testData],[bitmap.testData,null]].map(v=>renderThermalBitmap(bitmap.template,bitmap.format,v)));
 bitmap.expectedPixelDigests=proofs.map(p=>p.pixelDigest);
 await assert.rejects(createPreviewJobs(user,{...bitmap,expectedPixelDigests:['0'.repeat(64)]}),/proof|Proof/);
 const bmResults=await Promise.all([createPreviewJobs(user,bitmap),createPreviewJobs(user,bitmap)]);
 assert.equal(bmResults[0].requestId,bmResults[1].requestId);
 const bmJobs=(await q('SELECT * FROM office_jobs')).filter(j=>j.id!==jobs[0].id);
 assert.equal(bmJobs.length,1);assert.equal(bmJobs[0].label_count,3);
 const bmZpl=Buffer.from(bmJobs[0].payload_base64,'base64').toString();
 for(const proof of proofs)assert.ok(bmZpl.includes(proof.pixelDigest));
 await assert.rejects(createPreviewJobs(user,{...bitmap,expectedPixelDigests:['0'.repeat(64)]}),/different preview|Idempotency/);
 assert.deepEqual(await createPreviewJobs(user,bitmap),bmResults[0]);
 assert.equal((await q('SELECT * FROM runs')).length,2);
 // Saved-run endpoint independently enforces the displayed range digest.
 const savedRun={id:'saved-bitmap-run',templateId:bitmap.template.id,sourceData:[{}, {}, {}],staticValues:bitmap.testData,fieldMappings:{},totalLabels:3};
 await q("INSERT INTO runs(id,name,template_id,source_data,total_labels) VALUES('saved-bitmap-run','Test','preview-template','[{},{},{}]'::jsonb,3)");
 const chain={innerJoin:()=>chain,from:()=>chain,where:async()=>[{run:savedRun,template:bitmap.template,format:bitmap.format}]};
 require('../../src/lib/db/index.ts').db={select:()=>chain};
 const {createJobs}=require('../../src/lib/office/jobs.ts');
 const expectedBitmapDigest=createHash('sha256').update(bitmap.expectedPixelDigests.join('\n')).digest('hex');
 const savedData={idempotencyKey:randomUUID(),runId:savedRun.id,stationId:data.stationId,printerId:data.printerId,from:1,to:3,expectedBitmapDigest};
 await assert.rejects(createJobs(user,{...savedData,expectedBitmapDigest:'0'.repeat(64)}),/proof/);
 const first=await createJobs(user,savedData);assert.deepEqual(await createJobs(user,savedData),first);
 bitmap.template.elements[0].defaultValue='AFTER QUEUE';
 assert.deepEqual(await createJobs(user,savedData),first);
 assert.equal((await q('SELECT * FROM office_jobs')).length,3);
 console.log('PASS saved-run proof digest, identity and immutable retry.');
 console.log('PASS bitmap Office server digest validation, immutable queue pixels, concurrent retry, mismatched proof rollback. No production jobs.');
 console.log(JSON.stringify({passed:['current preview values','partial multi-across feed','exact payload hash','concurrent duplicate-safe retry','changed snapshot rejected','quantity/control validation','printer authorization','disabled dispatch rollback'],schema,productionJobsCreated:0}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
