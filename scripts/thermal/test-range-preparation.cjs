/* eslint-disable @typescript-eslint/no-require-imports */
require('./register.cjs');
const assert=require('node:assert/strict');
const {renderThermalBitmap,createBitmapRenderer}=require('../../src/lib/thermal/render.server.ts');
const {generateLabelsForRunWithImages}=require('../../src/lib/runBuilder.ts');
const {buildBatches}=require('../../src/lib/office/render.ts');
const format={id:'range-test',type:'thermal',width:2,height:0.7,dpi:203,labelsAcross:1};
const text={type:'text',rotation:0,isStatic:true,fontFamily:'Liberation Sans',fontSize:6,fontWeight:'normal',textAlign:'left',lineHeight:1.2,color:'#000000'};
const template={id:'range-test',thermalRenderMode:'bitmap-v1',elements:[
 ...Array.from({length:6},(_,i)=>({...text,id:'text'+i,zIndex:i,x:4,y:i*21,width:245,height:20,content:['Synthetic 3.5g Product','TAC: 35.71% 357.1mg/g','THC: 31.39% 313.9mg/g','CBD: 00.00% 000.0mg/g','EXP: 7/24/27 MFG: 7/24/26','LOT: TEST-0001'][i]})),
 {id:'qr',type:'qr',x:270,y:4,width:132,height:132,zIndex:7,rotation:0,isStatic:false,fieldName:'url',errorCorrection:'M'}]};
const run={sourceData:Array.from({length:1700},(_,i)=>({url:'https://example.invalid/'+String(i+1).padStart(6,'0')})),fieldMappings:{url:{mode:'column',csvColumn:'url'}},staticValues:{}};
(async()=>{
 let calls=0;const progress=[];
 global.fetch=async(url,options)=>{
  assert.equal(url,'/api/thermal/render');calls++;
  const body=JSON.parse(options.body);assert.ok(body.feeds.length<=8);
  const render=createBitmapRenderer();const results=[];
  for(const feed of body.feeds)results.push(await render(body.template,body.format,feed));
  return {ok:true,json:async()=>({results})};
 };
 let start=Date.now();
 const feeds=await generateLabelsForRunWithImages(run,template,format,undefined,{onProgress:(done,total)=>{assert.equal(total,1700);progress.push(done);}});
 const preparationMs=Date.now()-start;console.log(JSON.stringify({phase:"proof",preparationMs}));
 assert.equal(feeds.length,1700);assert.equal(calls,213);assert.equal(progress.at(-1),1700);assert.ok(progress.every((v,i)=>!i||v>progress[i-1]));
 // Independent renderer proves first/last and batch-boundary records were not reordered.
 for(const i of [0,7,8,15,16,1698,1699])assert.equal(feeds[i],(await renderThermalBitmap(template,format,[run.sourceData[i]])).zpl);
 start=Date.now();const batches=await buildBatches(run,template,format,1,1700,203,448);const submissionMs=Date.now()-start;
 const queued=batches.flatMap(b=>Buffer.from(b.payload,'base64').toString().match(/\^FXLWBITMAP1:[a-f0-9]+:[a-f0-9]+\^FS/g));
 assert.deepEqual(queued,feeds.map(f=>f.match(/\^FXLWBITMAP1:[a-f0-9]+:[a-f0-9]+\^FS/)[0]));
 assert.equal(batches.reduce((n,b)=>n+b.count,0),1700);assert.ok(batches.every(b=>b.count<=25));
 const controller=new AbortController();calls=0;
 await assert.rejects(generateLabelsForRunWithImages(run,template,format,undefined,{signal:controller.signal,onProgress:done=>{if(done)controller.abort();}}),/abort/i);assert.equal(calls,1);
 // Oversized response splitting preserves exact order; failed/incomplete responses never return partial proof.
 calls=0;global.fetch=async(_,options)=>{calls++;const b=JSON.parse(options.body);return b.feeds.length>2?{ok:false,json:async()=>({error:'Bitmap response too large; render fewer or smaller feeds'})}:{ok:true,json:async()=>({results:b.feeds.map(v=>({zpl:JSON.stringify(v)}))})};};
 const subset=await generateLabelsForRunWithImages(run,template,{...format,labelsAcross:3},{from:2,to:26});
 assert.deepEqual(subset.map(JSON.parse).flat().filter(Boolean),run.sourceData.slice(1,26));assert.equal(JSON.parse(subset[0])[0],null);assert.equal(JSON.parse(subset.at(-1))[2],null);assert.ok(calls>2);
 global.fetch=async()=>({ok:true,json:async()=>({results:[]})});await assert.rejects(generateLabelsForRunWithImages(run,template,format,{from:1,to:8}),/Incomplete/);
 const reuse=createBitmapRenderer();
 for(const dpi of [203,300])for(const value of ['https://example.invalid/A','https://example.invalid/B']){
   const f={...format,dpi};assert.deepEqual(await reuse(template,f,[{url:value}]),await renderThermalBitmap(template,f,[{url:value}]));
 }
 const overflowing={...template,elements:[{...text,id:'overflow',zIndex:0,x:0,y:0,width:2,height:2,content:'TOO LONG',autoFit:false}]};
 await reuse(overflowing,format,{},true);await assert.rejects(reuse(overflowing,format,{},false),/overflow/i);
 console.log(JSON.stringify({labels:1700,requests:213,preparationMs,submissionMs,batches:batches.length,checks:'ordered proofs, exact server parity, progress, cancel, partial lanes, response splitting, incomplete rejection'}));
})().catch(e=>{console.error(e);process.exitCode=1;});
