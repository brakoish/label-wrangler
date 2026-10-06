// No authentication, production data, or printer access: every API/bridge request is intercepted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
const base=process.argv[2]||'http://127.0.0.1:3150';
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'lw-reliability-'));
const chrome=spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
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
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
  window.bootId=crypto.randomUUID();window.requests=[];window.prints=[];window.alerts=[];window.alert=m=>window.alerts.push(m);
  const format={id:'f',name:'Fixture 2x1',type:'thermal',width:2,height:1,dpi:203,labelsAcross:1};
  const template={id:'t',name:'Saved fixture',formatId:'f',elements:[],thermalRenderMode:'native-v1',updatedAt:'2026-01-01T00:00:00.000Z'};
  const run={id:'r',name:'Synthetic run',templateId:'t',sourceData:Array.from({length:100},()=>({x:'fixture'})),staticValues:{},fieldMappings:{},status:'draft',printedCount:0,totalLabels:100,designSnapshot:{template,format,capturedAt:'2026-01-01',legacy:false}};
  const real=window.fetch.bind(window);window.fetch=async(input,init={})=>{
    const url=new URL(typeof input==='string'?input:input.url||input.href,location.origin);window.requests.push(url.pathname);
    if(url.port==='29100'){
      if(url.pathname==='/printers')return Response.json([{name:'Synthetic printer',is_default:true}]);
      if(url.pathname==='/print'){window.prints.push(init.body);await new Promise(resolve=>window.releasePrint=resolve);return Response.json({job_id:'mock'});}
      return Response.json({status:'ok',version:'test'});
    }
    if(url.pathname.startsWith('/api/')){
      if(url.pathname==='/api/runs/r'){if(init.method==='PUT')Object.assign(run,JSON.parse(init.body));return Response.json(run)}
      if(url.pathname==='/api/runs')return Response.json([{...run,sourceData:undefined,designSnapshot:undefined}]);
      if(url.pathname==='/api/templates/t')return Response.json(template);
      if(url.pathname==='/api/templates')return Response.json([template]);
      if(url.pathname==='/api/formats/f')return Response.json(format);
      if(url.pathname==='/api/formats')return Response.json([format]);
      if(url.pathname.includes('print-events'))return Response.json(init.method==='POST'?{id:'event',runId:'r',...JSON.parse(init.body)}:[]);
      if(url.pathname==='/api/client-diagnostics')return Response.json({ok:true});
      return Response.json([]);
    }
    if(url.origin!==location.origin)throw Error('External request blocked');
    return real(input,init);
  };
 `});
 await send('Page.navigate',{url:base+'/runs/r'});
 await wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Start Printing')&&!b.disabled)");
 assert.equal(await evaluate("window.requests.filter(p=>p==='/api/templates').length"),0,'Detail route must not fetch all templates');
 assert.equal(await evaluate("window.requests.filter(p=>p==='/api/runs').length"),0,'Detail route must not fetch run history');
 const boot=await evaluate('window.bootId');
 await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Start Printing')).click()");
 await wait('window.prints.length===1');
 await evaluate("document.querySelector('nav a[href=\"/designer\"]').click()");
 await wait('window.alerts.length>=1');assert.equal(await evaluate('location.pathname'),'/runs/r');
 await evaluate("[...document.querySelectorAll('button')].find(b=>b.className.includes('hover:text-red-400')).click()");
 await evaluate('window.releasePrint()');await pause(500);assert.equal(await evaluate('window.prints.length'),1);
 await evaluate("document.querySelector('nav a[href=\"/designer\"]').click()");await wait("location.pathname==='/designer'");assert.equal(await evaluate('window.bootId'),boot,'Navigation reloaded document');
 await wait("window.requests.includes('/api/templates')");
 // Recovery fixture survives a full reload; no live mutations are possible.
 await evaluate("localStorage.setItem('lw:template-draft:t:test',JSON.stringify({template:{id:'t',name:'Draft',formatId:'f',elements:[]},baseUpdatedAt:'old',savedAt:'2026-01-01T00:00:00.000Z'}))");
 await send('Page.navigate',{url:base+'/designer?id=t'});
 await wait("document.body.innerText.includes('Recover as copy')");
 console.log(JSON.stringify({passed:['detail page skips template library','local print navigation guard','cancel sends no additional batches','client navigation keeps document','draft recovery after reload'],printerRequestsIntercepted:true,physicalLabelsPrinted:0}));
} finally {socket?.close();chrome.kill();}
