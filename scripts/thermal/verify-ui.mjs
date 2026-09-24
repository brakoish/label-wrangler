// Real headless browser + authoritative local renderer. All edits and print writes intercepted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {PDFDocument} from 'pdf-lib';
const base=process.argv[2] || 'http://127.0.0.1:3130';
const account=await fs.readFile(path.resolve('../private/office-printing/account-chilly.txt'),'utf8');
const login=await fetch(base+'/api/office/session',{method:'POST',headers:{Origin:new URL(base).origin,'Content-Type':'application/json'},body:JSON.stringify({username:account.match(/^Username: (.+)$/m)[1],password:account.match(/^Password: (.+)$/m)[1]})});
assert.equal(login.status,200);
const cookie=login.headers.get('set-cookie').split(';')[0];
const fixture={id:'thermal-ui-test',name:'Synthetic bitmap verification',formatId:'thermal-format',thermalRenderMode:'bitmap-v1',createdAt:'',updatedAt:'',elements:[
 {id:'text',type:'text',x:20,y:20,width:220,height:42,rotation:0,zIndex:0,isStatic:false,fieldName:'product',defaultValue:'DEFAULT',content:'DESIGN',fontFamily:'Liberation Sans',fontWeight:'normal',fontSize:10,lineHeight:1.2,textAlign:'left',color:'#000000',autoFit:true,minFontSize:4},
 {id:'second',type:'text',x:20,y:90,width:220,height:42,rotation:0,zIndex:1,isStatic:true,content:'SECOND',fontFamily:'Liberation Sans',fontWeight:'normal',fontSize:10,lineHeight:1.2,textAlign:'left',color:'#000000',autoFit:true,minFontSize:4},
 {id:'qr',type:'qr',x:260,y:20,width:135,height:135,rotation:0,zIndex:2,isStatic:false,fieldName:'url',defaultValue:'https://example.invalid/UI',errorCorrection:'M'},
]};
const format={id:'thermal-format',name:'2 x 1',type:'thermal',width:2,height:1,dpi:203,labelsAcross:1,createdAt:'',updatedAt:''};
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'lw-thermal-browser-'));
const chrome=spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--window-size=1600,1100','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket;let id=0;const pending=new Map();
try{
 let port;
 for(let i=0;i<100;i++){try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await pause(100);}}
 assert.ok(port,'Chrome did not start');
 const pages=await(await fetch('http://127.0.0.1:'+port+'/json')).json();
 socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
 socket.onmessage=e=>{const data=JSON.parse(e.data);if(data.id){const promise=pending.get(data.id);pending.delete(data.id);if(data.error)promise?.reject(new Error(data.error.message));else promise?.resolve(data.result);}};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});socket.send(JSON.stringify({id:next,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error('Browser evaluation failed: '+(r.exceptionDetails.exception?.description||expression));return r.result.value;};
 const waitFor=async expression=>{for(let i=0;i<120;i++){if(await evaluate(expression))return;await pause(100);}throw new Error('UI timed out: '+expression+'\n'+(await evaluate('document.body.innerText')).slice(-2000));};
 await send('Page.enable');await send('Runtime.enable');
 await send('Network.setCookie',{name:'lw-office-session',value:cookie.slice(cookie.indexOf('=')+1),url:base,httpOnly:true,secure:base.startsWith('https:'),sameSite:'Strict'});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
  const original=window.fetch.bind(window);window.saves=[];window.previewRequests=[];window.proofs=[];window.downloads=[];
  const objectURL=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{if(blob.type==='application/pdf')window.downloads.push(blob);return objectURL(blob);};
  const syntheticRun={id:'bitmap-run',name:'Synthetic run',templateId:'thermal-ui-test',staticValues:{product:'RUN SAMPLE',url:'https://example.invalid/RUN'},fieldMappings:{},dataSource:'manual',sourceData:[{},{},{}],status:'draft',totalLabels:3,printedCount:0,createdAt:'',updatedAt:''};

  window.fixture=JSON.parse(localStorage.getItem('fixture')||${JSON.stringify(JSON.stringify(fixture))});
  window.fetch=async(url,options={})=>{
   const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
   if(String(url).startsWith('/api/nabis/search'))return json({packages:[{id:'test-product',packageTag:'SYNTHETIC',productName:'SELECTED PRODUCT',thcPercent:'0',cbdPercent:'2.75',retailId:'https://example.invalid/SELECTED'}]});
   if(String(url)==='/api/templates')return json([window.fixture]);
   if(String(url)==='/api/formats')return json([{...${JSON.stringify(format)},...(localStorage.getItem('testAcross')?{labelsAcross:2,horizontalGapThermal:.05,sideMarginThermal:.02,linerWidth:4.1}:{})}]);
   if(String(url)==='/api/runs')return json([syntheticRun]);
   if(String(url)==='/api/runs/bitmap-run')return json(syntheticRun);
   if(String(url)==='/api/runs/bitmap-run/print-events')return json(options.method==='POST'?{...JSON.parse(options.body),id:'event',createdAt:''}:[]);
   if(String(url).startsWith('/api/office/jobs')){if(options.method==='POST'){window.previewRequests.push(JSON.parse(options.body));return json({requestId:'mock-request-id'});}return json({requests:[]});}
   if(String(url)==='/api/globals')return json([]);
   if(String(url).startsWith('/api/templates/') && options.method==='PUT'){
    const changes=JSON.parse(options.body);window.fixture={...window.fixture,...changes};window.saves.push(changes);localStorage.setItem('fixture',JSON.stringify(window.fixture));return json(window.fixture);
   }
   if(String(url)==='/api/office/preview'){window.previewRequests.push(JSON.parse(options.body));return new Response(JSON.stringify(window.previewRequests.length===1?{error:'Simulated lost response'}:{runId:'mock-run'}),{status:window.previewRequests.length===1?503:200,headers:{'Content-Type':'application/json'}});}
   if(String(url)==='/api/thermal/render'&&window.forceRenderFailure)return new Response(JSON.stringify({error:'Synthetic text overflow'}),{status:400,headers:{'Content-Type':'application/json'}});
   const response=await original(url,options);
   if(String(url)==='/api/thermal/render'&&response.ok){const data=await response.clone().json();window.proofs.push(...data.results);}
   return response;
  };
 `});
 await send('Page.navigate',{url:base+'/designer?id=thermal-ui-test'});
 await waitFor("document.querySelector('[data-element-id=\"text\"]') && document.body.innerText.includes('Exact bitmap')");
 const center=selector=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 const mouse=async(type,p,extra={})=>send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1,...extra});
 const click=async selector=>{const p=await center(selector);await mouse('mousePressed',p);await mouse('mouseReleased',p);};
 const key=async(key,modifiers=0,code=key)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});};
 const setText=async value=>evaluate(`(()=>{const el=document.querySelector('textarea[aria-label="Inline label text"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await click('[data-element-id="text"] > rect');await key('Enter');await waitFor(`!!document.querySelector('textarea[aria-label="Inline label text"]')`);
 await setText('EDITED DEFAULT');await key('Enter',2);await waitFor('window.saves.length===1');
 let saved=await evaluate('window.fixture.elements.find(e=>e.id==="text")');assert.equal(saved.defaultValue,'EDITED DEFAULT');assert.equal(saved.fieldName,'product');assert.equal(saved.isStatic,false);assert.equal(saved.content,'DESIGN');
 // Escape cancels without another save.
 await key('Enter');await waitFor(`!!document.querySelector('textarea[aria-label="Inline label text"]')`);await setText('CANCELLED');await key('Escape');await pause(250);assert.equal(await evaluate('window.saves.length'),1);
 // One resize gesture => one save. Plain resize preserves font; Shift scales it.
 const drag=async(selector,dx,dy,modifiers=0)=>{const p=await center(selector);await mouse('mousePressed',p,{modifiers});await mouse('mouseMoved',{x:p.x+dx,y:p.y+dy},{buttons:1,modifiers});await mouse('mouseReleased',{x:p.x+dx,y:p.y+dy},{modifiers});};
 await drag('[data-element-id="text"] [data-resize-handle="se"]',30,20,2);await waitFor('window.saves.length===2');saved=await evaluate('window.fixture.elements.find(e=>e.id==="text")');assert.equal(saved.fontSize,10);assert.ok(saved.width>220);
 await drag('[data-element-id="text"] [data-resize-handle="se"]',30,20,8);await waitFor('window.saves.length===3');assert.ok(await evaluate('window.fixture.elements.find(e=>e.id==="text").fontSize>10'));
 // Multi-step undo then redo retains both future entries.
 await key('z',2,'KeyZ');await waitFor('window.saves.length===4');await key('z',2,'KeyZ');await waitFor('window.saves.length===5');
 await key('z',10,'KeyZ');await waitFor('window.saves.length===6');await key('z',10,'KeyZ');await waitFor('window.saves.length===7');assert.ok(await evaluate('window.fixture.elements.find(e=>e.id==="text").fontSize>10'));
 // Alt-drag preserves a binding, one compound history entry.
 await drag('[data-element-id="text"] > rect',0,180,1);await waitFor('window.saves.length===8');assert.equal(await evaluate('window.fixture.elements.filter(e=>e.fieldName==="product").length'),2);
 await key('z',2,'KeyZ');await waitFor('window.saves.length===9');assert.equal(await evaluate('window.fixture.elements.length'),3);
 // Held arrows are one transaction; upright nudge maps screen axes back to printer dots.
 await click('[data-element-id="second"] > rect');const y0=await evaluate('window.fixture.elements.find(e=>e.id==="second").y');
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.title==='Edit upright').click()");
 await evaluate('document.activeElement.blur()');
 for(let i=0;i<3;i++)await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',autoRepeat:i>0});
 await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight'});await waitFor('window.saves.length===10');
 assert.equal(await evaluate('window.fixture.elements.find(e=>e.id==="second").y'),y0+3);
 await key('z',2,'KeyZ');await waitFor('window.saves.length===11');
 // Reload uses saved structured objects, mode and defaults (not flattened image).
 await send('Page.reload');await waitFor('document.body.innerText.includes("Exact bitmap")');assert.equal(await evaluate('window.fixture.thermalRenderMode'),'bitmap-v1');
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Print Preview')).click()");
 await waitFor("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Office printer')");await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Office printer').click()");
 await waitFor("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Print preview to Office'&&!b.disabled)");
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Print preview to Office').click()");await waitFor("document.body.innerText.includes('Simulated lost response')");
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Retry same preview').click()");await waitFor("document.body.innerText.includes('Preview queued.')");
 const requests=await evaluate('window.previewRequests');assert.deepEqual(requests[0],requests[1]);assert.equal(requests[0].expectedPixelDigests.length,1);assert.ok(await evaluate(`window.proofs.some(p=>p.pixelDigest===${JSON.stringify(requests[0].expectedPixelDigests[0])})`));
 // A failed final proof must not erase editable text or become printable artwork.
 await evaluate('window.forceRenderFailure=true');
 await click('[data-element-id="text"] > rect');await key('Enter');await waitFor(`!!document.querySelector('textarea[aria-label="Inline label text"]')`);
 await setText('VISIBLE EVEN IF PROOF FAILS');await key('Enter',2);
 await waitFor("document.body.innerText.includes('Editing approximation — printing blocked')");
 assert.ok(await evaluate(`!!document.querySelector('[data-element-id="text"] text')`));
 await evaluate('window.forceRenderFailure=false');await key('z',2,'KeyZ');
 // Real saved-run PDF export and Office range proof, with all job writes intercepted.
 await send('Page.navigate',{url:base+'/runs/bitmap-run'});
 await waitFor("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Export labels'))");
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Export labels')).click()");
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='PDF').click()");
 await waitFor('window.downloads.length===1');
 const pdfBytes=await evaluate('window.downloads[0].arrayBuffer().then(b=>Array.from(new Uint8Array(b)))');
 const pdf=await PDFDocument.load(Uint8Array.from(pdfBytes));assert.equal(pdf.getPageCount(),3);assert.equal(pdf.getPage(0).getWidth(),144);assert.equal(pdf.getPage(0).getHeight(),72);
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Office Pi').click()");
 await waitFor("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Prepare exact range proof')");
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Prepare exact range proof').click()");
 await waitFor(`!!document.querySelector('img[alt="Office range bitmap proof"]')`);
 await waitFor("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Start Printing'&&!b.disabled)");
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Start Printing'&&!b.disabled).click()");
 await waitFor('window.previewRequests.length===1');assert.equal((await evaluate('window.previewRequests[0].expectedBitmapDigest')).length,64);
 await evaluate("localStorage.setItem('testAcross','2')");await send('Page.reload');
 await waitFor("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Export labels'))");
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Export labels')).click()");
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='PDF').click()");
 await waitFor('window.downloads.length===1');
 const multiPdf=await PDFDocument.load(Uint8Array.from(await evaluate('window.downloads[0].arrayBuffer().then(b=>Array.from(new Uint8Array(b)))')));
 assert.equal(multiPdf.getPageCount(),2);assert.ok(Math.abs(multiPdf.getPage(0).getWidth()-832*72/203)<1e-8);assert.equal(multiPdf.getPage(0).getHeight(),72);
 // Conversion cannot create an invalid copy; a valid reviewed proof enables it.
 await evaluate(`localStorage.removeItem('testAcross'); localStorage.setItem('fixture',JSON.stringify({...${JSON.stringify(fixture)},thermalRenderMode:'native-v1'}))`);
 await send('Page.navigate',{url:base+'/designer?id=thermal-ui-test'});
 await waitFor("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Duplicate and convert')");
 await evaluate("window.forceRenderFailure=true; Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Duplicate and convert').click()");
 await waitFor("document.body.innerText.includes('Synthetic text overflow')");
 assert.ok(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Create editable bitmap copy').disabled"));
 await evaluate("Array.from(document.querySelectorAll('[role=dialog] button')).find(b=>b.textContent==='Cancel').click(); window.forceRenderFailure=false");
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Duplicate and convert').click()");
 await waitFor(`!!document.querySelector('img[alt="New bitmap proof"]')`);
 assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Create editable bitmap copy').disabled"),false);
 // Off-label QR is an editing warning, not a whole-label render failure.
 await evaluate(`localStorage.setItem('fixture',JSON.stringify({...${JSON.stringify(fixture)},elements:${JSON.stringify(fixture.elements)}.map(e=>e.id==='qr'?{...e,x:390}:e)}))`);
 await send('Page.navigate',{url:base+'/designer?id=thermal-ui-test'});
 await waitFor("document.body.innerText.includes('Fix highlighted objects before printing')");
 assert.ok(await evaluate(`!!document.querySelector('[data-element-id="qr"] rect[stroke="#ef4444"]')`));
 assert.ok(await evaluate(`!!document.querySelector('svg image')`));
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Print Preview')).click()");
 await waitFor(`!!document.querySelector('img[alt="Editing preview with warnings"]')`);
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Fit QR inside label').click()");
 await waitFor("document.body.innerText.includes('Exact bitmap artwork') && !document.body.innerText.includes('Fix highlighted objects before printing')");
 assert.ok(await evaluate("window.fixture.elements.find(e=>e.id==='qr').x<390"));
 await evaluate(`localStorage.setItem('fixture',${JSON.stringify(JSON.stringify(fixture))})`);
 await send('Page.reload');
 await waitFor("document.body.innerText.includes('Exact bitmap artwork')");
 assert.equal(await evaluate("document.body.innerText.includes('Fix highlighted objects before printing')"),false);
 // Newly bound fields inherit the selected product; manual test edits survive.
 await evaluate(`(()=>{const e=document.querySelector('input[placeholder="Search Manifest package"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'test');e.dispatchEvent(new Event('input',{bubbles:true}));e.focus();})()`);
 await key('Enter');
 await waitFor("Array.from(document.querySelectorAll('input')).some(e=>e.value==='SELECTED PRODUCT')");
 await evaluate(`(()=>{const e=Array.from(document.querySelectorAll('input')).find(e=>e.value==='SELECTED PRODUCT');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'MANUAL OVERRIDE');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await click('[data-element-id="second"] > rect');
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Dynamic').click()");
 await waitFor(`!!document.querySelector('input[placeholder="product_name"]')`);
 const bindField=async value=>{await evaluate(`(()=>{const e=document.querySelector('input[placeholder="product_name"]');e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.blur();})()`);};
 await bindField('thcPercent');
 await waitFor("Array.from(document.querySelectorAll('input')).some(e=>e.value==='0') && localStorage.getItem('lw:test-data:thermal-ui-test')?.includes('thcPercent')");
 assert.equal(JSON.parse(await evaluate("localStorage.getItem('lw:test-data:thermal-ui-test')")).thcPercent,'0');
 await bindField('cbdPercent');
 await waitFor("localStorage.getItem('lw:test-data:thermal-ui-test')?.includes('2.75')");
 assert.equal(JSON.parse(await evaluate("localStorage.getItem('lw:test-data:thermal-ui-test')")).product,'MANUAL OVERRIDE');
 console.log('PASS bitmap bound inline edits/cancel, box vs Shift type resize, repeated undo/redo, Alt-drag binding copy, one save per gesture, reload, exact Office proof digest and lost-response retry, upright held nudge, PDF page geometry, saved-run range proof. All print/edit writes intercepted.');
} finally {if(socket)socket.close();chrome.kill('SIGTERM');await fetch(base+'/api/office/session',{method:'DELETE',headers:{Origin:new URL(base).origin,Cookie:cookie}});}
