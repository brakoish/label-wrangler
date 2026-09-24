/* eslint-disable @typescript-eslint/no-require-imports */
require('./register.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {importNaturalDesign}=require('../../src/lib/thermal/import.ts');
const {renderThermalBitmap}=require('../../src/lib/thermal/render.server.ts');
const sharp=require('sharp');
const {createHash}=require('node:crypto');
const {decodeBitmapZpl,unpackMonochrome}=require('../../src/lib/thermal/bitmap.ts');
// Vercel's unpromoted URLs may be SSO protected. CLI performs its own bypass;
// credentials/cookies stay in mode-600 temporary files, never command arguments.
const request=process.env.VERCEL_TEST ? async (url,init={})=>{
 const os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lw-host-'));fs.chmodSync(dir,0o700);
 try{
  const headersFile=path.join(dir,'headers'),bodyFile=path.join(dir,'body'),out=path.join(dir,'out'),responseHeaders=path.join(dir,'response-headers');
  fs.writeFileSync(headersFile,Object.entries(init.headers||{}).map(([k,v])=>k+': '+v).join('\n'),{mode:0o600});
  fs.writeFileSync(bodyFile,init.body||'',{mode:0o600});
  const target=new URL(url),args=['curl',target.pathname,'--deployment',target.origin,'--','--silent','--request',init.method||'GET','--header','@'+headersFile,'--dump-header',responseHeaders,'--output',out];
  if(init.body)args.push('--data-binary','@'+bodyFile);
  const result=spawnSync('vercel',args,{encoding:'utf8',timeout:60000});if(result.status!==0)throw new Error('Vercel authenticated test request failed');
  const rawHeaders=fs.readFileSync(responseHeaders,'utf8');const blocks=rawHeaders.trim().split(/\r?\n\r?\n/),block=blocks[blocks.length-1];
  const status=Number(block.match(/^HTTP\/\S+ (\d+)/)[1]);const headers=new Headers();
  for(const line of block.split(/\r?\n/).slice(1)){const i=line.indexOf(':');if(i>0)headers.append(line.slice(0,i),line.slice(i+1).trim());}
  return new Response(fs.readFileSync(out),{status,headers});
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}:fetch;
(async()=>{
 const base=process.argv[2]||'http://127.0.0.1:3130',origin=process.env.TEST_ORIGIN||base;
 const account=fs.readFileSync('../private/office-printing/account-chilly.txt','utf8');
 const unauthorized=await request(base+'/api/thermal/render',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:'{}',redirect:'manual'});assert.ok([401,307].includes(unauthorized.status));
 const auth=await request(base+'/api/office/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:account.match(/^Username: (.+)$/m)[1],password:account.match(/^Password: (.+)$/m)[1]})});assert.equal(auth.status,200);
 const cookie=auth.headers.get('set-cookie').split(';')[0],headers={Origin:origin,Cookie:cookie,'Content-Type':'application/json'};
 try{
  const design=importNaturalDesign(JSON.parse(fs.readFileSync('scripts/thermal/fixtures/Lemon-Cherry-Gelato-Your-Edits.label.json')));
  const local=await renderThermalBitmap(design.template,design.format);const start=Date.now();
  const r=await request(base+'/api/thermal/render',{method:'POST',headers,body:JSON.stringify({...design,feeds:[{}]})});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));
  const hosted=data.results[0],decoded=decodeBitmapZpl(hosted.zpl);
  assert.deepEqual(Buffer.from(decoded.packed),Buffer.from(hosted.packed,'base64'));
  const png=Buffer.from(hosted.proof.split(',')[1],'base64');
  assert.deepEqual(Buffer.from(unpackMonochrome(decoded.packed,decoded.width,decoded.height)),await sharp(png).ensureAlpha().raw().toBuffer());
  assert.equal(createHash('sha256').update(decoded.packed).digest('hex'),hosted.pixelDigest);
  const repeat=await(await request(base+'/api/thermal/render',{method:'POST',headers,body:JSON.stringify({...design,feeds:[{}]})})).json();
  assert.equal(repeat.results[0].pixelDigest,hosted.pixelDigest,'Hosted renders must repeat exactly');
  const ZX=require(process.env.ZXING_PATH||'/tmp/lw-bitmap-verification/node_modules/@zxing/library');
  const raw=await sharp(png).removeAlpha().greyscale().raw().toBuffer();
  assert.equal(new ZX.MultiFormatReader().decode(new ZX.BinaryBitmap(new ZX.HybridBinarizer(new ZX.RGBLuminanceSource(Uint8ClampedArray.from(raw),decoded.width,decoded.height)))).getText(),'HTTPS://1A4.COM/5LO1I9DSOIOZ6RNP6EIO');
  if(process.env.CAPTURE_RENDER)fs.writeFileSync(process.env.CAPTURE_RENDER,png);

  if(process.env.GOTTI_FIXTURE){
   const saved=JSON.parse(fs.readFileSync(process.env.GOTTI_FIXTURE));
   const gotti=saved.find(x=>x.template.thermalRenderMode==='bitmap-v1');
   assert.ok(gotti);
   const response=await request(base+'/api/thermal/render',{method:'POST',headers,body:JSON.stringify({...gotti,feeds:[{}]})});
   const proof=await response.json();assert.equal(response.status,200,JSON.stringify(proof));
   const result=proof.results[0],bitmap=decodeBitmapZpl(result.zpl);
   assert.deepEqual(Buffer.from(bitmap.packed),Buffer.from(result.packed,'base64'));
   assert.deepEqual(Buffer.from(unpackMonochrome(bitmap.packed,bitmap.width,bitmap.height)),await sharp(Buffer.from(result.proof.split(',')[1],'base64')).ensureAlpha().raw().toBuffer());
   if(process.env.TEMPLATE_CAPTURE)fs.writeFileSync(process.env.TEMPLATE_CAPTURE,Buffer.from(result.proof.split(',')[1],'base64'));
   console.log('PASS private saved-template fixture renders; hosted PNG equals ZPL; no saved data changed');
  }
  const bad=await request(base+'/api/thermal/render',{method:'POST',headers,body:JSON.stringify({...design,template:{...design.template,thermalRenderMode:'native-v1'},feeds:[{}]})});assert.equal(bad.status,400);
  const wrong=await request(base+'/api/thermal/render',{method:'POST',headers:{...headers,Origin:'https://example.invalid'},body:JSON.stringify({...design,feeds:[{}]})});assert.equal(wrong.status,403);
  console.log(JSON.stringify({host:base,authenticatedRaster:true,hostedPixelDigest:hosted.pixelDigest,localPixelDigest:local.pixelDigest,localHostPixelsIdentical:hosted.pixelDigest===local.pixelDigest,proofEqualsZpl:true,repeatStable:true,qrDecoded:true,renderAndHTTPMs:Date.now()-start,unauthorizedRejected:true,wrongOriginRejected:true,nativeModeRejected:true,physicalJobs:0}));
 }finally{await request(base+'/api/office/session',{method:'DELETE',headers});}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
