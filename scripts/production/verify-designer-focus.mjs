// No authentication, production data, or printer access: every API/bridge request is intercepted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
const base=process.argv[2]||'http://127.0.0.1:3152';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Local fixture server required');
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'lw-reliability-'));
const chrome=spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--renderer-process-limit=1','--disable-gpu','--js-flags=--max-old-space-size=128','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let socket;let id=0;const pending=new Map();
try {
 let port;for(let i=0;i<100;i++){try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break}catch{await pause(100)}}assert.ok(port,'Chrome unavailable');
 const pages=await(await fetch(`http://127.0.0.1:${port}/json`)).json();socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
 socket.onmessage=e=>{const data=JSON.parse(e.data);if(data.id){const p=pending.get(data.id);pending.delete(data.id);data.error?p?.reject(Error(data.error.message)):p?.resolve(data.result)}};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});socket.send(JSON.stringify({id:next,method,params}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value};
 const wait=async expression=>{for(let i=0;i<300;i++){if(await evaluate('Boolean('+expression+')'))return;await pause(100)}throw Error('Timed out: '+expression+' '+await evaluate('JSON.stringify({text:document.body.innerText.slice(-2000),alerts:window.alerts,path:location.pathname})'))};
 await send('Page.enable');await send('Runtime.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Network.setCookie',{name:'lw-office-session',value:'synthetic-not-a-real-session',url:base});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
 window.saves=[];
 const format={id:'f',name:'Fixture',type:'thermal',width:3,height:2,dpi:203,labelsAcross:1};
 const rect=(id,x,w)=>({id,type:'rectangle',x,y:30,width:w,height:70,rotation:0,isStatic:true,zIndex:x,strokeWidth:1,strokeColor:'#000000',fillColor:'#eeeeee',borderRadius:0});
 window.template={id:'t',name:'Focus fixture',formatId:'f',elements:[rect('a',30,80),rect('b',180,120)],thermalRenderMode:'native-v1',updatedAt:'2026-01-01T00:00:00.000Z'};
 const real=window.fetch.bind(window);window.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'?input:input.url||input.href,location.origin);
 if(url.pathname.startsWith('/api/')){
 if(url.pathname==='/api/templates/t'){if(init.method==='PUT'){Object.assign(window.template,JSON.parse(init.body));window.saves.push(structuredClone(window.template));}return Response.json(window.template);}
 if(url.pathname==='/api/templates')return Response.json([window.template]);
 if(url.pathname==='/api/formats/f')return Response.json(format);
 if(url.pathname==='/api/formats')return Response.json([format]);
 return Response.json([]);}
 if(url.origin!==location.origin)throw Error('External request blocked');return real(input,init);
 };
 `});
 const q=s=>'document.querySelector('+JSON.stringify(s)+')';
 const width='input[aria-label="Width"]';
 const x='input[aria-label="Distance from left edge"]';
 const value=(s=width)=>evaluate(q(s)+'.value');
 const key=async(key,modifiers=0)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,modifiers});await send('Input.dispatchKeyEvent',{type:'keyUp',key,modifiers});await pause(100)};
 const click=async(selector,modifiers=0)=>{const r=await evaluate('(()=>{const r='+q(selector)+'.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');await send('Input.dispatchMouseEvent',{type:'mousePressed',...r,button:'left',clickCount:1,modifiers});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...r,button:'left',clickCount:1,modifiers});await pause(100)};
 const type=async(selector,text)=>{await evaluate(q(selector)+'.focus()');await evaluate(q(selector)+'.select()');if(text)await send('Input.insertText',{text});else await key('Backspace');await pause(100)};
 const saved=async()=>{await wait('window.saves.length>0');await pause(200);return evaluate('window.template.elements')};
 await send('Page.navigate',{url:base+'/designer?id=t'});
 await wait('document.querySelector("[data-element-id=a]")');
 await click('[data-element-id=a]');assert.equal(await value(),'0.39');
 await type(width,'0.47');await click('[data-element-id=b]');
 assert.equal(await evaluate('document.activeElement.hasAttribute("data-designer-canvas")'),true);
 assert.equal(await value(),'0.59','same-type selection must reset inspector');
 let es=await saved();assert.equal(es[0].width,95);assert.equal(es[1].width,120);
 await key('ArrowRight');es=await saved();assert.equal(es[1].x,182.03);assert.equal(es[0].x,30);
 await key('z',2);assert.equal(await value(x),'0.89');
 await key('z',10);assert.equal(await value(x),'0.9');
 await type(width,'');await click('[data-element-id=a]');assert.equal(await value(),'0.47');
 es=await saved();assert.equal(es[1].width,120,'incomplete input resets only on old object');assert.equal(es[0].width,95);
 await evaluate(q(width)+'.focus()');await key('ArrowUp');await click('[data-element-id=a]');es=await saved();assert.equal(es[0].width,97);assert.equal(es[0].x,30,'native numeric arrows do not nudge');
 await click('[data-layer-id=b] [data-layer-select]');await key('ArrowRight',8);es=await saved();assert.equal(es[1].x,202.33,'layer shift nudge');
 await click('[data-layer-id=a] [data-layer-select]',8);await key('ArrowDown');es=await saved();assert.equal(es[0].y,32.03);assert.equal(es[1].y,32.03);
 await key('ArrowRight',2);es=await saved();assert.equal(es[1].x,202.33,'modified arrow is not nudge');
 await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Upright").click()');
 await click('[data-layer-id=b] [data-layer-select]');await key('ArrowRight');es=await saved();assert.equal(es[1].x,202.33);assert.equal(es[1].y,34.06);
 await evaluate('document.querySelector("[data-layer-id=b] button:not([data-layer-select])").focus()');await key('ArrowRight');es=await saved();assert.equal(es[1].y,34.06);
 await evaluate('document.querySelector("[data-designer-canvas]").focus();document.querySelector("[data-designer-canvas] svg rect").dispatchEvent(new MouseEvent("click",{bubbles:true}))');await pause(100);
 assert.equal(await evaluate(q(width)+'===null'),true);await key('ArrowRight');es=await saved();assert.equal(es[1].y,34.06);
 console.log(JSON.stringify({passed:['canvas focus transfer','same-type inspector reset','old-object pending blur','native input arrows','canvas and layer nudges','shift and multi-selection','modifier guard','upright direction','layer control guard','blank deselection','undo redo latest snapshot'],apiWritesIntercepted:true,physicalLabelsPrinted:0}));
} finally {socket?.close();chrome.kill();}
