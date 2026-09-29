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

  window.fixture=JSON.parse(localStorage.getItem('fixture')||${JSON.stringify(JSON.stringify(fixture))});
  window.fetch=async(url,options={})=>{
   if(String(url)==='/api/thermal/render')window.renderRequests.push(JSON.parse(options.body));
   const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
   if(String(url).startsWith('/api/nabis/search'))return json({packages:[{id:'test-product',packageTag:'SYNTHETIC',productName:'SELECTED PRODUCT',thcPercent:'0',cbdPercent:'2.75',retailId:'https://example.invalid/SELECTED'}]});
   if(String(url)==='/api/templates' && options.method==='POST'){window.createdCopy=JSON.parse(options.body);return json({...window.createdCopy,id:'synthetic-copy'});}
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
 await click('[data-element-id="qr"] > rect');
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Move to back').click()");
 await waitFor('window.saves.length===1');
 assert.deepEqual(await evaluate('window.fixture.elements.slice().sort((a,b)=>a.zIndex-b.zIndex).map(e=>e.id)'),['qr','text','second']);
 assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Move to back').disabled"),true);
 await key('z',2,'KeyZ');await waitFor('window.saves.length===2');
 assert.deepEqual(await evaluate('window.fixture.elements.slice().sort((a,b)=>a.zIndex-b.zIndex).map(e=>e.id)'),['text','second','qr']);
 await key('z',10,'KeyZ');await waitFor('window.saves.length===3');
 await send('Page.reload');
 await waitFor(`!!document.querySelector('[data-element-id="qr"]')`);
 assert.deepEqual(await evaluate('window.fixture.elements.slice().sort((a,b)=>a.zIndex-b.zIndex).map(e=>e.id)'),['qr','text','second']);
 await click('[data-element-id="qr"] > rect');
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Move to top').click()");
 await waitFor('window.saves.length===1');
 assert.deepEqual(await evaluate('window.fixture.elements.slice().sort((a,b)=>a.zIndex-b.zIndex).map(e=>e.id)'),['text','second','qr']);
 assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Move to top').disabled"),true);
 await key('z',2,'KeyZ');await waitFor('window.saves.length===2');
 assert.deepEqual(await evaluate('window.fixture.elements.slice().sort((a,b)=>a.zIndex-b.zIndex).map(e=>e.id)'),['qr','text','second']);
 await key('z',10,'KeyZ');await waitFor('window.saves.length===3');
 await send('Page.reload');
 await waitFor(`!!document.querySelector('[data-element-id="qr"]')`);
 assert.deepEqual(await evaluate('window.fixture.elements.slice().sort((a,b)=>a.zIndex-b.zIndex).map(e=>e.id)'),['text','second','qr']);
 console.log('PASS move to back and top: saved order, boundary disabled states, undo, redo, reload; all template writes intercepted.');
} finally {if(socket)socket.close();chrome.kill('SIGTERM');await fetch(base+'/api/office/session',{method:'DELETE',headers:{Origin:new URL(base).origin,Cookie:cookie}});}
