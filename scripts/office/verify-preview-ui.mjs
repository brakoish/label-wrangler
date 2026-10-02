// Private, isolated browser smoke. Reads credentials locally; never logs them.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
const base=process.argv[2] || 'http://127.0.0.1:3120';
const account=await fs.readFile(path.resolve('../private/office-printing/account-chilly.txt'),'utf8');
const login=await fetch(base+'/api/office/session',{method:'POST',headers:{Origin:new URL(base).origin,'Content-Type':'application/json'},body:JSON.stringify({username:account.match(/^Username: (.+)$/m)[1],password:account.match(/^Password: (.+)$/m)[1]})});
assert.equal(login.status,200);
const cookie=login.headers.get('set-cookie').split(';')[0];
const get=async route=>(await fetch(base+route,{headers:{Cookie:cookie}})).json();
const [runs,templates,formats]=await Promise.all([get('/api/runs'),get('/api/templates'),get('/api/formats')]);
const run=runs.find(r=>formats.find(f=>f.id===templates.find(t=>t.id===r.templateId)?.formatId)?.type==='thermal');
assert.ok(run);
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'lw-office-browser-'));
const chrome=spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--window-size=1440,1100','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
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
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error('Browser evaluation failed');return r.result.value;};
 await send('Page.enable');await send('Runtime.enable');
 await send('Network.setCookie',{name:'lw-office-session',value:cookie.slice(cookie.indexOf('=')+1),url:base,httpOnly:true,secure:base.startsWith('https:'),sameSite:'Strict'});

 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
   delete Navigator.prototype.usb;
   const actualFetch=window.fetch.bind(window);window.previewRequests=[];
   window.fetch=async (url,options)=>{
     if(String(url)==='/api/office/preview'){
       window.previewRequests.push(JSON.parse(options.body));
       return new Response(JSON.stringify(window.previewRequests.length===1?{error:'Simulated lost response'}:{runId:'mock-preview-run'}),{status:window.previewRequests.length===1?503:200,headers:{'Content-Type':'application/json'}});
     }
     return actualFetch(url,options);
   };
 `});
 await send('Page.navigate',{url:base+'/designer?id='+encodeURIComponent(run.templateId)});
 const waitFor=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await pause(150);}throw new Error('UI condition timed out: '+expression);};
 await waitFor("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Print Preview'))");
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Print Preview')).click()");
 await waitFor("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Office printer')");
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Office printer').click()");
 await waitFor("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Print preview to Office' && !b.disabled)");
 assert.equal(await evaluate("'usb' in navigator"),false);
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Print preview to Office').click()");
 await waitFor("document.body.textContent.includes('Simulated lost response')");
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Retry same preview').click()");
 await waitFor("document.body.textContent.includes('Preview queued.')");
 const requests=await evaluate('window.previewRequests');
 assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);
 assert.equal(requests[0].template.id,run.templateId);assert.equal(requests[0].quantity,1);
 assert.ok(await evaluate("!!document.querySelector('a[href=\"/runs/mock-preview-run\"]')"));
 console.log('PASS designer Office preview without WebUSB; exact snapshot retry after simulated failure; delivery link. Physical print requests intercepted.');
}finally{
 if(socket)socket.close();chrome.kill('SIGTERM');
 await fetch(base+'/api/office/session',{method:'DELETE',headers:{Origin:new URL(base).origin,Cookie:cookie}});
}
