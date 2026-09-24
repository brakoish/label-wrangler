/* eslint-disable @typescript-eslint/no-require-imports */
require('./register.cjs');
const assert = require('node:assert/strict'), fs = require('node:fs'), cp = require('node:child_process'), Module = require('node:module'), ts = require('typescript'), sharp = require('sharp');
const { createHash } = require('node:crypto');
const { renderThermalBitmap } = require('../../src/lib/thermal/render.server.ts');
const { importNaturalDesign, bitmapCopy } = require('../../src/lib/thermal/import.ts');
const { packMonochrome, unpackMonochrome, bitmapZpl, decodeBitmapZpl, resolveThermalContent } = require('../../src/lib/thermal/bitmap.ts');
const { generateZPL } = require('../../src/lib/zplGenerator.ts');
const { previewLabelValues, generateLabelsForRunWithImages } = require('../../src/lib/runBuilder.ts');
const { buildBatches } = require('../../src/lib/office/render.ts');
const { nearestSnap, arrangeElements, artworkBounds, resizeArtwork } = require('../../src/lib/thermal/editorGeometry.ts');
const { useUndoStore } = require('../../src/lib/undoStore.ts');
const decoderPath = process.env.ZXING_PATH || '/tmp/lw-bitmap-verification/node_modules/@zxing/library';
const ZX = require(decoderPath);
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
async function decode(png, region) {
 let im = sharp(png); if(region) im = im.extract(region);
 const {data,info} = await im.flatten({background:'#fff'}).greyscale().raw().toBuffer({resolveWithObject:true});
 const reader = new ZX.MultiFormatReader(); reader.setHints(new Map([[ZX.DecodeHintType.TRY_HARDER,true]]));
 return reader.decode(new ZX.BinaryBitmap(new ZX.HybridBinarizer(new ZX.RGBLuminanceSource(Uint8ClampedArray.from(data),info.width,info.height)))) .getText();
}
function pngOf(p) { return Buffer.from(p.proof.split(',')[1],'base64'); }
async function parity(p) {
 const z = decodeBitmapZpl(p.zpl), raw = await sharp(pngOf(p)).ensureAlpha().raw().toBuffer();
 assert.deepEqual(Buffer.from(z.packed),Buffer.from(p.packed,'base64'));
 assert.deepEqual(Buffer.from(unpackMonochrome(z.packed,z.width,z.height)),raw);
 assert.equal(createHash('sha256').update(z.packed).digest('hex'),p.pixelDigest);
 check(!/\^LH|\^LT|\^LS/.test(p.zpl),'local calibration unchanged');
}
const format = {id:'f',type:'thermal',width:2,height:1,dpi:203,labelsAcross:1};
const qr = {id:'qr',type:'qr',x:8,y:8,width:184,height:184,zIndex:1,rotation:0,isStatic:false,fieldName:'retailId',errorCorrection:'M'};
const template = {id:'t',name:'Verification',formatId:'f',thermalRenderMode:'bitmap-v1',elements:[qr]};
(async()=>{
 const source = JSON.parse(fs.readFileSync('scripts/thermal/fixtures/Lemon-Cherry-Gelato-Your-Edits.label.json'));
 const lemon = importNaturalDesign(source), result = await renderThermalBitmap(lemon.template,lemon.format);
 await parity(result); check(result.width===406 && result.height===203,'Lemon exact dots');
 check(await decode(pngOf(result))==='HTTPS://1A4.COM/5LO1I9DSOIOZ6RNP6EIO','Lemon QR payload exact');
 // Threshold, alpha, byte padding and strip boundaries.
 const rgba = new Uint8Array(13*3*4).fill(255); rgba.set([0,0,0,255],0); rgba.set([0,0,0,0],4); rgba.set([159,159,159,255],8); rgba.set([160,160,160,255],12);
 const packed = packMonochrome(rgba,13,3); check(packed[0]===160 && packed[1]===0,'threshold160 alpha and MSB padding');
 const large = new Uint8Array(Math.ceil(1201/8)*1000).fill(170), z = bitmapZpl(large,1201,1000,'a'.repeat(64),'b'.repeat(64));
 check([...z.matchAll(/\^GFA,(\d+)/g)].every(m=>+m[1]<=99999),'bounded graphic strips'); assert.deepEqual(decodeBitmapZpl(z).packed,large);
 for(const dpi of [203,300,600]) {const r=await renderThermalBitmap(template,{...format,dpi}, {retailId:'DOTS-'+dpi}); await parity(r); check(r.width===2*dpi&&r.height===dpi,'DPI geometry');}
 // Existing native output must remain byte-for-byte identical, including missing mode.
 const baseline = new Module(require.resolve('../../src/lib/zplGenerator.ts')); baseline.filename=require.resolve('../../src/lib/zplGenerator.ts'); baseline.paths=module.paths;
 baseline._compile(ts.transpileModule(cp.execFileSync('git',['show','d13551a:src/lib/zplGenerator.ts'],{encoding:'utf8'}),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,baseline.filename);
 const legacy = {...template,thermalRenderMode:undefined,elements:[qr,{...qr,id:'text',type:'text',x:200,y:20,width:180,height:80,fontSize:10,fontWeight:'normal',fontFamily:'Arial',textAlign:'left',lineHeight:1.2,content:'DESIGN',defaultValue:'FALLBACK',prefix:'[',suffix:']'}]};
 for(const rotation of [0,90,180,270]) for(const v of [{retailId:'0'},{retailId:''},{retailId:'000042'}]) {
  const t={...legacy,elements:legacy.elements.map(e=>({...e,rotation}))}; assert.equal(generateZPL(t,format,v),baseline.exports.generateZPL(t,format,v)); checks++;
 }
 assert.throws(()=>generateZPL(template,format,{}),/bitmap|async/i);
 const contract=JSON.parse(fs.readFileSync('scripts/thermal/fixtures/dynamic-data-contract-cases.json'));
 const cases=contract.cases; const seven=cases[0].run;
 // Test real browser async generation against real server renderer, without HTTP or print transport.
 global.fetch=async(url,opts)=>{assert.equal(url,'/api/thermal/render');const b=JSON.parse(opts.body);const proofs=[];for(const feed of b.feeds)proofs.push(await renderThermalBitmap(b.template,b.format,feed));return {ok:true,json:async()=>({results:proofs})};};
 const f3={...format,labelsAcross:3};
 const feeds=await generateLabelsForRunWithImages(seven,template,f3);
 check(feeds.length===3,'seven records three feeds');
 async function verifyLanes(zpl, expected) {
  const d=decodeBitmapZpl(zpl),png=await sharp(Buffer.from(unpackMonochrome(d.packed,d.width,d.height)),{raw:{width:d.width,height:d.height,channels:4}}).png().toBuffer();
  for(let lane=0;lane<expected.length;lane++) {const region={left:lane*406,top:0,width:406,height:203};
   if(expected[lane]) check(await decode(png,region)===expected[lane],'QR lane order');
   else {const raw=await sharp(png).extract(region).removeAlpha().raw().toBuffer();check(raw.every(v=>v===255),'excluded lane blank');}
  }
 }
 const urls=Array.from({length:7},(_,i)=>previewLabelValues(seven,i).retailId);
 await verifyLanes(feeds[0],urls.slice(0,3));await verifyLanes(feeds[1],urls.slice(3,6));await verifyLanes(feeds[2],[urls[6],null,null]);
 const partial=await generateLabelsForRunWithImages(seven,template,f3,{from:2,to:5});await verifyLanes(partial[0],[null,urls[1],urls[2]]);await verifyLanes(partial[1],[urls[3],urls[4],null]);
 const manual=cases[1].run, mf=await generateLabelsForRunWithImages(manual,template,f3), mv=previewLabelValues(manual,0).retailId;
 await verifyLanes(mf[0],[mv,mv,mv]);await verifyLanes(mf[1],[mv,null,null]);
 for(const c of cases.slice(2,4)) check(previewLabelValues(c.run,0).retailId===c.expected.qrPayloads[0],'paste mapping preserved');
 const fallback={...qr,type:'text',defaultValue:'FALLBACK',prefix:'[',suffix:']'};
 for(const [values,expected] of [[{},'[FALLBACK]'],[{retailId:''},'[FALLBACK]'],[{retailId:'0'},'[0]'],[{retailId:'000042'},'[000042]']]) check(resolveThermalContent(fallback,values)===expected,'legacy default semantics');
 await assert.rejects(renderThermalBitmap(template,format,{}),/Missing QR/);
 const nativeCopy=bitmapCopy(legacy); check(nativeCopy.elements[1].fieldName===legacy.elements[1].fieldName && !nativeCopy.elements[1].isStatic,'conversion retains bindings');
 // Barcode formats independently decoded, not just generator smoke tests.
 for(const [barcodeFormat,content] of [['CODE128','A00123'],['CODE39','A00123'],['UPC','123456789012'],['EAN13','5901234123457'],['EAN8','96385074'],['ITF14','10012345000017']]) {
  const t={...template,elements:[{...qr,id:'bar',type:'barcode',isStatic:true,content,barcodeFormat,showText:true,x:5,y:5,width:390,height:180}]};
  const r=await renderThermalBitmap(t,format);await parity(r); const read=await decode(pngOf(r));check(read===content || (barcodeFormat==='UPC'&&read==='0'+content),barcodeFormat+' decoded');
 }
 const text={...legacy.elements[1],id:'text',x:8,y:8,width:380,height:180,isStatic:true,content:'Literal ^XA ~ text 0',fontFamily:'Liberation Sans',fontStyle:'italic',charWidth:1};
 await parity(await renderThermalBitmap({...template,elements:[text]},format));
 await assert.rejects(renderThermalBitmap({...template,elements:[{...text,content:'😀'}]},format),/no glyph/);
 await assert.rejects(renderThermalBitmap({...template,elements:[{...text,width:10,height:10}]},format),/overflows/);
 await assert.rejects(renderThermalBitmap({...template,elements:[{...qr,x:300}]},format,{retailId:'clip'}),/clipped/);
 // Converted legacy shape: omitted fit flag, one-line title/footer, and boxes
 // extending past the label while their real ink remains inside. No data rewrite.
 const conversionText={...text,fontWeight:'bold',fontSize:10,autoFit:undefined,minFontSize:undefined,x:4.184,y:11.955,width:397.632,height:33.833,content:'Lemon Cherry Gelato - Hybrid',textAlign:'center'};
 const oversizedBox={...text,fontWeight:'bold',fontSize:9,autoFit:undefined,x:145.882,y:133.5,width:369.652,height:33.833,lineHeight:1,content:'EXP: 00/00/00'};
 const footer={...text,fontSize:6,autoFit:undefined,x:11.184,y:183.093,width:252.61,height:19.868,lineHeight:1,content:'SYNTHETIC SUPPLY, LLC - 11501'};
 for(const e of [conversionText,oversizedBox,footer]) {const snapshot=JSON.stringify(e);await parity(await renderThermalBitmap({...template,elements:[e]},format));assert.equal(JSON.stringify(e),snapshot);}
 await assert.rejects(renderThermalBitmap({...template,elements:[{...conversionText,autoFit:false}]},format),/overflows/);
 await assert.rejects(renderThermalBitmap({...template,elements:[{...text,x:400,content:'OUTSIDE'}]},format),/outside/);
 // Horizontal width must preserve every glyph, not cover-crop the ends.
 for(const charWidth of [.6,1,1.4]) {
  const r=await renderThermalBitmap({...template,elements:[{...text,x:0,y:0,width:400,height:70,content:'H H H H H H',fontStyle:'normal',fontSize:12,charWidth}]},format);
  const raw=await sharp(pngOf(r)).removeAlpha().greyscale().raw().toBuffer();let groups=0,previous=false;
  for(let x=0;x<r.width;x++){let ink=false;for(let y=0;y<r.height;y++)if(raw[y*r.width+x]<160)ink=true;if(ink&&!previous)groups++;previous=ink;}
  check(groups===6,'character width preserves all six glyphs at '+charWidth);
 }
 const nativeLayout={...template,elements:[{...text,id:'a',fontFamily:'sans-serif',x:15,y:49,width:200,height:33,charWidth:.8},{...text,id:'b',x:155,y:49,width:169,height:33,charWidth:.8},{...qr,id:'q',x:285,y:34,width:116,height:116},{...footer,id:'footer',y:184.3,height:41}]};
 const savedLayout=JSON.stringify(nativeLayout), fitted=bitmapCopy(nativeLayout,format);
 check(fitted.elements[0].charWidth===.8 && fitted.elements[0].fontFamily==='Liberation Sans','conversion preserves condensation and sans family');
 check(fitted.elements[0].x+fitted.elements[0].width<=151 && fitted.elements[1].x+fitted.elements[1].width<=281,'conversion separates neighboring fields');
 check(fitted.elements[3].y+fitted.elements[3].height<=203,'converted footer stays on label');
 check(JSON.stringify(nativeLayout)===savedLayout,'conversion leaves source unchanged');
 const framed=bitmapCopy({...nativeLayout,elements:[...nativeLayout.elements,{id:'frame',type:'rectangle',x:8,y:43,width:271,height:86,rotation:0}]},format);
 check(framed.elements[1].x+framed.elements[1].width<=275,'conversion leaves space inside enclosing border');
 // Editing isolates bad objects; strict printing still rejects identical input.
 const good={...text,id:'good',x:8,y:8,content:'KEEP ME',width:120,height:45};
 for(const bad of [{...qr,id:'bad',x:380,isStatic:true,content:'QR'}, {...qr,id:'bad',width:2,height:2,isStatic:true,content:'QR'}, {...text,id:'bad',x:400,content:'OUTSIDE'}, {...text,id:'bad',width:2,height:2,content:'TOO SMALL'}]) {
  const t={...template,elements:[good,bad]};
  await assert.rejects(renderThermalBitmap(t,format));
  const draft=await renderThermalBitmap(t,format,{},true), reference=await renderThermalBitmap({...template,elements:[good]},format);
  check(draft.warnings.length>0 && draft.warnings.every(w=>w.elementId==='bad'),'draft marks only invalid object');
  check(!draft.zpl && !draft.packed,'draft cannot supply print bytes');
  const region={left:0,top:0,width:140,height:60};
  assert.deepEqual(await sharp(pngOf(draft)).extract(region).raw().toBuffer(),await sharp(pngOf(reference)).extract(region).raw().toBuffer());
  check(true,'valid artwork pixels survive invalid neighbor');
 }
 // An oversized QR allocation may cross the edge while the required quiet
 // zone remains entirely inside. Unused padding must not erase adjacent art.
 for(const rotation of [0,90,180,270]) {
  const padded={...qr,id:'padded',isStatic:true,content:'PADDING',x:250,y:55,width:200,height:100,rotation};
  const mark={id:'mark',type:'rectangle',x:260,y:65,width:10,height:10,rotation:0,zIndex:-1,isStatic:true,fillColor:'#000000',strokeColor:'#000000',strokeWidth:0,borderRadius:0};
  const result=await renderThermalBitmap({...template,elements:[mark,padded]},format);
  check(await decode(pngOf(result))==='PADDING','padded QR remains decodable at '+rotation);
  const ink=result.qrInkBounds.padded;check(ink.width<result.qrBounds.padded.width,'QR ink bounds exclude quiet zone');
  const b=result.qrBounds.padded;check(b.x>=0 && b.y>=0 && b.x+b.width<=406 && b.y+b.height<=203,'reported QR quiet bounds match actual label');
  const markPixels=await sharp(pngOf(result)).extract({left:260,top:65,width:10,height:10}).removeAlpha().raw().toBuffer();
  check(markPixels.every(v=>v===0),'unused QR padding cannot cover neighboring artwork');
  await assert.rejects(renderThermalBitmap({...template,elements:[{...padded,x:350}]},format),/clipped|outside/);
 }
 // Draft layers retain complete artwork for immediate motion, including off-label pixels.
 const liveQr={...qr,id:'live',isStatic:true,content:'LIVE',x:260,y:20,width:135,height:135};
 const liveTemplate={...template,elements:[liveQr]};
 const initial=await renderThermalBitmap(liveTemplate,format,{},true);
 check(initial.editorLayers.length===1 && initial.editorLayers[0].elementId==='live','draft contains movable artwork');
 const edgeX=liveQr.x+406-initial.qrBounds.live.x-initial.qrBounds.live.width+1;
 const edgeTemplate={...liveTemplate,elements:[{...liveQr,x:edgeX}]};
 const edge=await renderThermalBitmap(edgeTemplate,format,{},true);
 check(edge.warnings.length===0 && edge.advisories.length===1,'margin advisory does not mark intact code invalid');
 check(edge.editorLayers[0].width===initial.editorLayers[0].width,'draft layer keeps complete code beyond edge');
 const printableEdge=await renderThermalBitmap(edgeTemplate,format);
 check(!!printableEdge.zpl && printableEdge.advisories.length===1,'short QR margin permits print bytes');
 await parity(printableEdge);
 await assert.rejects(renderThermalBitmap({...edgeTemplate,elements:[{...liveQr,x:edgeX+30}]},format),/clipped|outside/);
 // Styled and rotated text, transparency/fits, QR correction and liner geometry.
 const before=JSON.stringify(template);
 for(const family of ['Liberation Sans','Liberation Serif','Liberation Mono']) for(const rotation of [0,90,180,270]) {
  const t={...text,fontFamily:family,fontWeight:'bold',fontStyle:'italic',letterSpacing:1,lineHeight:1.4,content:'Wrap words 000042',autoFit:true,minFontSize:4,width:120,height:100,x:rotation===90||rotation===180?150:20,y:rotation===180||rotation===270?180:20,rotation,textAlign:'center',verticalAlign:'middle'};
  await parity(await renderThermalBitmap({...template,elements:[t]},format));
 }
 check(JSON.stringify(template)===before,'fit does not mutate template');
 const transparent=await sharp({create:{width:30,height:20,channels:4,background:'#00000000'}}).composite([{input:Buffer.from('<svg width="10" height="10"><rect width="10" height="10" fill="black"/></svg>'),left:0,top:0}]).png().toBuffer();
 for(const fit of ['contain','cover','fill']) await parity(await renderThermalBitmap({...template,elements:[{id:'image',type:'image',x:80,y:40,width:80,height:60,rotation:90,zIndex:0,isStatic:true,src:'data:image/png;base64,'+transparent.toString('base64'),objectFit:fit}]},format));
 for(const errorCorrection of ['L','M','Q','H']) {
  const r=await renderThermalBitmap({...template,elements:[{...qr,errorCorrection}]},format,{retailId:'https://example.invalid/'+errorCorrection});
  check(await decode(pngOf(r))==='https://example.invalid/'+errorCorrection,'QR correction '+errorCorrection);
 }
 for(const labelsAcross of [1,2,3,4]) {
  const f={...format,labelsAcross,horizontalGapThermal:.05,sideMarginThermal:.02};
  const r=await renderThermalBitmap(template,f,Array.from({length:labelsAcross},(_,i)=>({retailId:'LANE-'+i})));
  await parity(r);for(let i=0;i<labelsAcross;i++)check(await decode(pngOf(r),{left:4+i*416,top:0,width:406,height:203})==='LANE-'+i,'margin/gap lane');
 }
 for(const rotation of [0,90,180,270]) {
  const e={...text,x:200,y:200,width:120,height:50,rotation},b=artworkBounds(e);
  const changed={...e,...resizeArtwork(e,'se',20,10,false)},c=artworkBounds(changed);
  assert.deepEqual(c,{...b,width:b.width+20,height:b.height+10});check(changed.fontSize===e.fontSize,'rotated box resize keeps type');
 }
 // Queue caps apply to bytes and retain complete feed boundaries; uncertain send is not retried.
 const {startPrintQueue}=require('../../src/lib/printQueue.ts');const sent=[];
 const queue=startPrintQueue({send:async z=>sent.push(z)},{labels:['12345','67890','abcde'],maxBatchBytes:10});
 await new Promise(r=>setTimeout(r,10));assert.equal(queue.status,'completed');assert.deepEqual(sent,['12345','67890','abcde']);checks++;
 let attempts=0;const failed=startPrintQueue({send:async()=>{attempts++;throw Error('uncertain');}},{labels:['a','b']});await new Promise(r=>setTimeout(r,10));check(failed.status==='error'&&attempts===1,'no automatic uncertain resend');
 const tooBig=startPrintQueue({send:async()=>assert.fail('Oversized feed sent')},{labels:['123456'],maxBatchBytes:5});await new Promise(r=>setTimeout(r,10));check(tooBig.status==='error','oversized feed rejected');
 const batches=await buildBatches(seven,template,f3,2,5,203,1218);
 check(batches.reduce((n,b)=>n+b.count,0)===4,'Office counts selected labels');
 const officeZpl=Buffer.from(batches[0].payload,'base64').toString().match(/\^XA[\s\S]*?\^XZ/g);
 for(let i=0;i<partial.length;i++) assert.deepEqual(decodeBitmapZpl(officeZpl[i]).packed,decodeBitmapZpl(partial[i]).packed);
 check(officeZpl.every(z=>z.includes('^LH0,0')),'Office calibration resets preserved');
 check(nearestSnap([10],[14,11],6).delta===1,'nearest not last snap');
 const arranged=arrangeElements([0,17,100].map((x,i)=>({...qr,id:String(i),x,width:10})),'distribute-x');check(arranged[1].x===50,'equal gaps');
 const history=useUndoStore.getState();history.clear();history.push('t',[{...qr,x:0}]);history.push('t',[{...qr,x:1}]);history.setCurrent('t',[{...qr,x:2}]);history.undo();history.setCurrent('t',[{...qr,x:1}]);history.undo();history.rememberPast('t',[{...qr,x:0}]);check(history.redo().elements[0].x===1,'first redo');history.rememberPast('t',[{...qr,x:1}]);check(history.redo().elements[0].x===2,'second redo retained');
 console.log(JSON.stringify({passed:checks,lemonPixelDigest:result.pixelDigest,physicalJobs:0}));
})().catch(e=>{console.error(e);process.exitCode=1;});
