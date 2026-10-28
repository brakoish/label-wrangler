// No authentication, production data, or printer access: every API/bridge request is intercepted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
const base=process.argv[2]||'http://127.0.0.1:3150';
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'lw-reliability-'));
const chrome=spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox','--no-zygote','--single-process','--disable-dev-shm-usage','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let socket;let id=0;const pending=new Map();
try {
 let port;for(let i=0;i<100;i++){try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break}catch{await pause(100)}}assert.ok(port,'Chrome unavailable');
 const pages=await(await fetch(`http://127.0.0.1:${port}/json`)).json();socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
 socket.onmessage=e=>{const data=JSON.parse(e.data);if(data.id){const p=pending.get(data.id);pending.delete(data.id);data.error?p?.reject(Error(data.error.message)):p?.resolve(data.result)}};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});socket.send(JSON.stringify({id:next,method,params}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value};
 const wait=async expression=>{for(let i=0;i<300;i++){if(await evaluate(expression))return;await pause(100)}throw Error('Timed out: '+expression+' '+await evaluate('JSON.stringify({text:document.body.innerText.slice(-2000),alerts:window.alerts,path:location.pathname})'))};
 await send('Page.enable');await send('Runtime.enable');await send('Network.setCookie',{name:'lw-office-session',value:'synthetic-not-a-real-session',url:base});
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
 window.requests=[];window.renderBodies=[];window.fail=true;
 const format={id:'f',name:'Fixture',type:'thermal',width:2,height:1,dpi:203};
 const elements=[{id:'e',type:'rectangle',x:10,y:10,width:100,height:40,rotation:0,zIndex:0,isStatic:true,strokeWidth:1}];
 const templates=Array.from({length:30},(_,i)=>({id:'t'+i,name:'Preview '+i,formatId:'f',elements:[],elementCount:1,summaryOnly:true,thermalRenderMode:'bitmap-v1',updatedAt:'2026-01-01'}));
 const real=window.fetch.bind(window);window.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'?input:input.url||input.href,location.origin);
 if(url.pathname.startsWith('/api/')){
 window.requests.push(url.pathname);
 if(url.pathname==='/api/templates')return Response.json(templates);
 if(url.pathname==='/api/formats')return Response.json([format]);
 if(url.pathname.startsWith('/api/templates/')){
 if(url.pathname==='/api/templates/t0'&&window.fail)return new Response('{}',{status:503});
 return Response.json({...templates.find(t=>'/api/templates/'+t.id===url.pathname),summaryOnly:false,elements});
 }
 if(url.pathname==='/api/thermal/render'){
 window.renderBodies.push(JSON.parse(init.body));
 return Response.json({results:[{proof:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',zpl:'',packed:'',warnings:[]}]});
 }
 return Response.json([]);
 }
 if(url.origin!==location.origin)throw Error('External request blocked');
 return real(input,init);
 };
 `});
 await send('Page.navigate',{url:base+'/designer'});
 await wait("document.body.innerText.includes('Retry preview')");
 await wait("document.querySelectorAll('img[alt$=\" preview\"]').length>0");
 assert.equal(await evaluate("window.requests.includes('/api/templates/t29')"),false,'offscreen details stay unloaded');
 await evaluate("window.fail=false;[...document.querySelectorAll('button')].find(b=>b.textContent==='Retry preview').click()");
 await wait("document.querySelector('img[alt=\"Preview 0 preview\"]')!==null");
 assert.equal(await evaluate('location.search'),'','retry must not open designer');
 assert.equal(await evaluate('window.renderBodies.every(b=>b.editing===true)'),true,'bitmap uses draft authority');
 await evaluate("[...document.querySelectorAll('h3')].find(e=>e.textContent==='Preview 29').scrollIntoView()");
 await wait("document.querySelector('img[alt=\"Preview 29 preview\"]')!==null");
 const screenshot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/lw-template-previews.png',Buffer.from(screenshot.data,'base64'));
 console.log('PASS: visible-only detail loading, bitmap draft proof, error/retry without navigation, scroll loads preview; no saved-data writes or printer calls');
} finally {socket?.close();chrome.kill();}
