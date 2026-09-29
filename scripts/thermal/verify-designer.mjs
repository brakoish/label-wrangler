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
 const waitFor=async expression=>{for(let i=0;i<120;i++){if(await evaluate(expression))return;await pause(100);}throw new Error('UI timed out: '+expression+'\n'+(await evaluate(`document.body?.innerText`)).slice(-2000));};
 await send('Page.enable');await send('Runtime.enable');
 await send('Network.setCookie',{name:'lw-office-session',value:cookie.slice(cookie.indexOf('=')+1),url:base,httpOnly:true,secure:base.startsWith('https:'),sameSite:'Strict'});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
  const original=window.fetch.bind(window);window.saves=[];window.renderRequests=[];window.previewRequests=[];window.proofs=[];window.downloads=[];
  const objectURL=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{if(blob.type==='application/pdf')window.downloads.push(blob);return objectURL(blob);};
  const syntheticRun={id:'bitmap-run',name:'Synthetic run',templateId:'thermal-ui-test',staticValues:{product:'RUN SAMPLE',url:'https://example.invalid/RUN'},fieldMappings:{},dataSource:'manual',sourceData:[{},{},{}],status:'draft',totalLabels:3,printedCount:0,createdAt:'',updatedAt:''};

  window.attempts=[];window.fixture=JSON.parse(localStorage.getItem('fixture')||${JSON.stringify(JSON.stringify(fixture))});
  window.fetch=async(url,options={})=>{
   if(String(url)==='/api/thermal/render')window.renderRequests.push(JSON.parse(options.body));
   const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
   if(String(url).startsWith('/api/nabis/search'))return json({packages:[{id:'test-product',packageTag:'SYNTHETIC',productName:'SELECTED PRODUCT',thcPercent:'0',cbdPercent:'2.75',retailId:'https://example.invalid/SELECTED'}]});
   if(String(url)==='/api/templates' && options.method==='POST'){window.createdCopy=JSON.parse(options.body);return json({...window.createdCopy,id:'synthetic-copy'});}
   if(String(url)==='/api/templates')return json([window.fixture,{...window.fixture,id:'sheet',name:'Other sheet template',formatId:'sheet-format',thermalRenderMode:'native-v1'},{...window.fixture,id:'archive',name:'Archived test template',archivedAt:'2026-09-29'}]);
   if(String(url)==='/api/formats')return json([${JSON.stringify(format)},{...${JSON.stringify(format)},id:'large-format',name:'4 x 2',width:4,height:2},{...${JSON.stringify(format)},id:'sheet-format',name:'Sheet 2 x 1',type:'sheet'}]);
   if(String(url)==='/api/runs')return json([syntheticRun]);
   if(String(url)==='/api/runs/bitmap-run')return json(syntheticRun);
   if(String(url)==='/api/runs/bitmap-run/print-events')return json(options.method==='POST'?{...JSON.parse(options.body),id:'event',createdAt:''}:[]);
   if(String(url).startsWith('/api/office/jobs')){if(options.method==='POST'){window.previewRequests.push(JSON.parse(options.body));return json({requestId:'mock-request-id'});}return json({requests:[]});}
   if(String(url)==='/api/globals')return json([]);
   if(String(url).startsWith('/api/templates/') && options.method==='PUT'){
    const changes=JSON.parse(options.body);window.attempts.push(changes);if(window.failNextSave){window.failNextSave=false;return new Response(JSON.stringify({error:'Synthetic save failure'}),{status:503});}window.fixture={...window.fixture,...changes};window.saves.push(changes);localStorage.setItem('fixture',JSON.stringify(window.fixture));if(window.loseAck){window.loseAck=false;window.saves.pop();return new Response(JSON.stringify({error:'Synthetic lost acknowledgment'}),{status:503});}return json(window.fixture);
   }
   if(String(url)==='/api/office/preview'){window.previewRequests.push(JSON.parse(options.body));return new Response(JSON.stringify(window.previewRequests.length===1?{error:'Simulated lost response'}:{runId:'mock-run'}),{status:window.previewRequests.length===1?503:200,headers:{'Content-Type':'application/json'}});}
   if(['/api/thermal/render','/api/thermal/convert'].includes(String(url))&&window.forceRenderFailure)return new Response(JSON.stringify({error:'Synthetic text overflow'}),{status:400,headers:{'Content-Type':'application/json'}});
   if(String(url)==='/api/thermal/render' && window.holdProof)await new Promise(resolve=>{window.releaseProof=resolve;});
   const response=await original(url,options);
   if(String(url)==='/api/thermal/render'&&response.ok){const data=await response.clone().json();window.proofs.push(...data.results);}
   if(String(url)==='/api/thermal/convert'&&response.ok)window.conversion=await response.clone().json();
   return response;
  };
 `});
 await send('Page.navigate',{url:base+'/designer?id=thermal-ui-test'});
 await waitFor("document.querySelector('[data-element-id=\"text\"]') && document.body?.innerText.includes('Exact bitmap')");
 const center=selector=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 const mouse=async(type,p,extra={})=>send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1,...extra});
 const click=async selector=>{const p=await center(selector);await mouse('mousePressed',p);await mouse('mouseReleased',p);};
 const key=async(key,modifiers=0,code=key)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});};
 const setText=async value=>evaluate(`(()=>{const el=document.querySelector('textarea[aria-label="Inline label text"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 const button = label => evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
 const row = (id, additive=false) => evaluate(`document.querySelector('[data-layer-id="${id}"]').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:${additive}}))`);
 const order = () => evaluate('window.fixture.elements.slice().sort((a,b)=>a.zIndex-b.zIndex).map(e=>e.id)');
 const setInput = (selector,value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
 const undo = () => click('button[title="Undo (Ctrl+Z)"]');
 const redo = () => click('button[title="Redo (Ctrl+Shift+Z)"]');
 const waitSaves = n => waitFor('window.saves.length==='+n);
 // Multi-layer ordering preserves internal order and has one undo entry.
 await row('text');await row('qr',true);await button('Move to back');await waitSaves(1);
 assert.deepEqual(await order(),['text','qr','second']);
 await undo();await waitSaves(2);assert.deepEqual(await order(),['text','second','qr']);
 await redo();await waitSaves(3);assert.deepEqual(await order(),['text','qr','second']);
 await button('Move to top');await waitSaves(4);assert.deepEqual(await order(),['second','text','qr']);
 // Lost acknowledgment: retry the exact locally committed order, don't move again.
 await evaluate('window.loseAck=true');await button('Move to back');
 await waitFor('document.body.innerText.includes("Retry save")');
 assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('[data-layer-id]')).map(e=>e.dataset.layerId)"),['second','qr','text']);
 const failed = await evaluate('window.attempts.at(-1)');
 await button('Retry save');await waitSaves(5);
 assert.deepEqual(await evaluate('window.attempts.at(-1)'),failed);
 // Duplicate/delete use the same recovery path without duplicate copies.
 await row('text');await evaluate('window.failNextSave=true');await click('[data-layer-id="text"] button[title="Duplicate"]');
 await waitFor('document.body.innerText.includes("Retry save")');
 const duplicate = await evaluate('window.attempts.at(-1).elements.find(e=>!["text","second","qr"].includes(e.id)).id');
 await button('Retry save');await waitSaves(6);assert.equal(await evaluate('window.fixture.elements.length'),4);
 await evaluate('window.failNextSave=true');await click(`[data-layer-id="${duplicate}"] button[title="Delete"]`);
 await waitFor('document.body.innerText.includes("Retry save")');await button('Retry save');await waitSaves(7);
 assert.equal(await evaluate('window.fixture.elements.length'),3);
 // Lock persists, disables editing and canvas handles; keyboard cannot move it.
 await row('text');await button('Lock selected');await waitSaves(8);
 await waitFor('document.body.innerText.includes("Selection includes locked layers")');
 assert.equal(await evaluate('window.fixture.elements.find(e=>e.id==="text").locked'),true);
 assert.equal(await evaluate(`document.querySelector('[data-element-id="text"]').getAttribute('pointer-events')`),'none');
 assert.equal(await evaluate(`document.querySelectorAll('[data-element-id="text"] [data-resize-handle]').length`),0);
 await key('ArrowRight');await key('Enter');await pause(500);assert.equal(await evaluate('window.saves.length'),8);
 assert.equal(await evaluate(`!!document.querySelector('textarea[aria-label="Inline label text"]')`),false);
 await button('Unlock selected');await waitSaves(9);
 await key('ArrowRight');await waitSaves(10);
 assert.equal(await evaluate('window.fixture.elements.find(e=>e.id==="text").x'),21);
 // Format changes restore both dimensions and exact original elements on Undo.
 const originalElements=await evaluate('window.fixture.elements');
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.startsWith('2 x 1') && b.querySelector('svg')).click()");
 await waitFor("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.startsWith('4 x 2'))");
 await evaluate('window.failNextSave=true');
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.startsWith('4 x 2')).click()");
 await waitFor('document.body.innerText.includes("Retry save")');await button('Retry save');await waitSaves(11);
 assert.equal(await evaluate('window.fixture.formatId'),'large-format');
 const scaledElements=await evaluate('window.fixture.elements');
 assert.equal(scaledElements.find(e=>e.id==='text').x,42);
 await undo();await waitSaves(12);
 assert.equal(await evaluate('window.fixture.formatId'),'thermal-format');assert.deepEqual(await evaluate('window.fixture.elements'),originalElements);
 await redo();await waitSaves(13);
 assert.equal(await evaluate('window.fixture.formatId'),'large-format');assert.deepEqual(await evaluate('window.fixture.elements'),scaledElements);
 await button('Lock selected');await waitSaves(14);
 await send('Page.reload');await waitFor(`!!document.querySelector('[data-layer-id="text"]')`);
 assert.equal(await evaluate('window.fixture.formatId'),'large-format');assert.equal(await evaluate('window.fixture.elements.find(e=>e.id==="text").locked'),true);
 // Library search AND size filter, including archive and clear/no-result recovery.
 await send('Page.navigate',{url:base+'/designer'});await waitFor(`!!document.querySelector('[aria-label="Search templates"]') && document.body.innerText.includes("Other sheet template")`);
 await setInput('[aria-label="Search templates"]','SYNTHETIC');
 await waitFor('!document.body.innerText.includes("Other sheet template")');
 await setInput('[aria-label="Filter label format"]','sheet-format');await waitFor('document.body.innerText.includes("No matching templates")');
 await button('Clear filters');await waitFor('document.body.innerText.includes("Other sheet template")');
 await setInput('[aria-label="Filter label format"]','sheet-format');
 await waitFor('!document.body.innerText.includes("Synthetic bitmap verification")');
 await button('Clear filters');
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.startsWith('Archived (')).click()");
 await setInput('[aria-label="Search templates"]','archived');await waitFor('document.body.innerText.includes("Archived test template")');
 assert.equal(await evaluate('document.body.innerText.includes("Other sheet template")'),false);
 // Duplicating a selected group keeps spacing and internal stacking intact.
 await send('Page.navigate',{url:base+'/designer?id=thermal-ui-test'});
 await waitFor(`!!document.querySelector('[data-layer-id="text"]')`);
 await row('text');await row('qr',true);await button('Unlock selected');await waitSaves(1);
 const group=await evaluate('window.fixture.elements.filter(e=>["text","qr"].includes(e.id)).sort((a,b)=>a.zIndex-b.zIndex)');
 await click('[data-layer-id="text"] button[title="Duplicate"]');await waitSaves(2);
 const copies=await evaluate('window.fixture.elements.filter(e=>!["text","second","qr"].includes(e.id)).sort((a,b)=>a.zIndex-b.zIndex)');
 assert.equal(copies.length,2);
 assert.deepEqual(copies.map(e=>e.fieldName),group.map(e=>e.fieldName));
 assert.ok(Math.abs((copies[1].x-copies[0].x)-(group[1].x-group[0].x)) < 1e-9);
 assert.ok(Math.abs((copies[1].y-copies[0].y)-(group[1].y-group[0].y)) < 1e-9);
 await undo();await waitSaves(3);assert.equal(await evaluate('window.fixture.elements.length'),3);
 if(process.env.DESIGNER_SCREENSHOT){await row('text');await row('qr',true);await fs.writeFile(process.env.DESIGNER_SCREENSHOT,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));}
 console.log('PASS multi-layer ordering, failed saves/retry for move/duplicate/delete/format, lock/unlock/nudge/inline protections, format undo/redo and exact elements, persisted lock/format, search/size/archive/clear filters. All template writes intercepted.');
} finally {if(socket)socket.close();chrome.kill('SIGTERM');await fetch(base+'/api/office/session',{method:'DELETE',headers:{Origin:new URL(base).origin,Cookie:cookie}});}
