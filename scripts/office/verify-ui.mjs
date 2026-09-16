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
 await send('Page.navigate',{url:base+'/runs/'+encodeURIComponent(run.id)});
 let found=false;
 for(let i=0;i<100;i++){found=await evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Office Pi')");if(found)break;await pause(200);}
 assert.ok(found,'Office Pi transport not rendered');
 assert.ok(await evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Dazzle') && Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='WebUSB')"));
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Office Pi').click()");
 let ready=false;
 for(let i=0;i<80;i++){ready=await evaluate("document.body.innerText.includes('Awaiting verified pairing and activation')");if(ready)break;await pause(200);}
 assert.ok(ready,'Station state did not load');
 assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Queue at office')?.disabled"),true);
 assert.ok(await evaluate("document.body.innerText.includes('Black Zebra - ZD411 (Pi)') && !document.body.innerText.includes('White Zebra')"));
 assert.ok(await evaluate("document.body.innerText.includes('Export labels')"));
 const screenshot=path.join(profile,'office-pi.png');
 const capture=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(screenshot,Buffer.from(capture.data,'base64'),{mode:0o600});
 console.log(JSON.stringify({passed:['Office Pi transport','Dazzle/WebUSB preserved','black-only station selector','pairing disables queue button','export preserved'],screenshot}));
 await send('Page.navigate',{url:base+'/login'});
 for(let i=0;i<50;i++){if(await evaluate("!!document.querySelector('input[autocomplete=\"current-password\"]')"))break;await pause(100);}
 assert.ok(await evaluate("!!document.querySelector('input[autocomplete=\"current-password\"]')"));
 console.log('PASS login form renders');
 const sheet=runs.find(r=>formats.find(f=>f.id===templates.find(t=>t.id===r.templateId)?.formatId)?.type==='sheet');
 if(sheet){
   await send('Page.addScriptToEvaluateOnNewDocument',{source:"delete Navigator.prototype.usb; delete navigator.usb;"});
   await send('Page.navigate',{url:base+'/runs/'+encodeURIComponent(sheet.id)});
   let sheetReady=false;
   for(let i=0;i<80;i++){sheetReady=await evaluate("!!document.body && document.body.textContent.includes('Sheet Output') && document.body.textContent.includes('Printed:')");if(sheetReady)break;await pause(200);}
   assert.equal(await evaluate("'usb' in navigator"),false);
   assert.ok(sheetReady,'Sheet progress controls hidden on a browser without WebUSB');
   console.log('PASS sheet printing controls preserved without WebUSB');
 }
}finally{
 if(socket)socket.close();chrome.kill('SIGTERM');
 await fetch(base+'/api/office/session',{method:'DELETE',headers:{Origin:new URL(base).origin,Cookie:cookie}});
}
