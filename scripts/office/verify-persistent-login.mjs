// Real browser cookie persistence + external-link entry. Revokes only its own login.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
const base=process.argv[2] || 'https://label-wrangler.vercel.app';
const expectFixed=process.argv.includes('--expect-fixed');
const account=await fs.readFile('../private/office-printing/account-chilly.txt','utf8');
const credentials={username:account.match(/^Username: (.+)$/m)[1],password:account.match(/^Password: (.+)$/m)[1]};
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'lw-persistent-login-'));
const external=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<a id="return" href="${base}/designer">Return to Label Wrangler</a>`);});
await new Promise(r=>external.listen(0,'127.0.0.1',r));
const externalUrl='http://127.0.0.1:'+external.address().port;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let chrome,socket,send,evaluate,waitFor,cookie;
async function open(){
 chrome=spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 let pages;
 for(let i=0;i<100;i++){try{const port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];pages=await(await fetch('http://127.0.0.1:'+port+'/json')).json();if(pages.length)break;}catch{}await pause(100);}
 assert.ok(pages?.length,'Browser did not start');
 socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});let id=0;const pending=new Map();
 socket.onmessage=e=>{const d=JSON.parse(e.data);if(d.id){const p=pending.get(d.id);pending.delete(d.id);d.error?p?.reject(new Error(d.error.message)):p?.resolve(d.result);}};
 send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error('Browser evaluation failed');return r.result.value;};
 waitFor=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await pause(100);}throw new Error('Browser condition timed out: '+expression);};
 await send('Page.enable');await send('Runtime.enable');
}
async function close(){const exited=new Promise(r=>chrome.once('exit',r));await send('Browser.close').catch(()=>{});await exited;socket?.close();}
try{
 await open();await send('Page.navigate',{url:base+'/login'});await waitFor(`!!document.querySelector('input[name="staySignedIn"]')`);await pause(400);
 await evaluate(`(()=>{for(const [name,value] of Object.entries(${JSON.stringify(credentials)})){const e=document.querySelector('input[name="'+name+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelector('input[name="staySignedIn"]').click();document.querySelector('form button').click();})()`);
 await waitFor('location.pathname==="/runs"');
 const session=(await send('Network.getCookies',{urls:[base]})).cookies.find(c=>c.name==='lw-office-session');
 assert.ok(session);cookie=session.name+'='+session.value;
 assert.ok(session.expires>Date.now()/1000+29*86400,'Checked login must set persistent 30-day cookie');
 console.log('PASS checked browser login: persistent cookie, SameSite='+session.sameSite);
 await close();await open();await send('Page.navigate',{url:base+'/runs'});await waitFor('location.pathname==="/runs" && document.readyState==="complete"');
 assert.equal(await evaluate(`fetch('/api/office/session').then(r=>r.json()).then(d=>!!d.user)`),true);
 console.log('PASS session survives clean browser close/reopen');
 await send('Page.navigate',{url:externalUrl});await waitFor('!!document.querySelector("#return")');await evaluate('document.querySelector("#return").click()');
 await waitFor('location.origin==='+JSON.stringify(new URL(base).origin)+' && document.readyState==="complete"');
 if(expectFixed){await waitFor('location.pathname==="/designer"');assert.equal(await evaluate(`fetch('/api/office/session').then(r=>r.json()).then(d=>!!d.user)`),true);console.log('PASS external-link entry stays authenticated');
   // Previously issued Strict cookies must also recover without another login.
   await send('Network.setCookie',{name:session.name,value:session.value,url:base,httpOnly:true,secure:session.secure,sameSite:'Strict',expires:session.expires});
   await send('Page.navigate',{url:externalUrl});await waitFor('!!document.querySelector("#return")');await evaluate('document.querySelector("#return").click()');
   await waitFor('location.pathname==="/designer" && location.origin==='+JSON.stringify(new URL(base).origin));
   console.log('PASS existing Strict cookie recovers through login session check');
   const blocked=await fetch(base+'/api/office/session',{method:'DELETE',headers:{Origin:externalUrl,Cookie:cookie}});
   assert.equal(blocked.status,403,'Cross-site writes remain blocked');
   assert.equal((await fetch(base+'/api/office/session',{method:'DELETE',headers:{Origin:new URL(base).origin,Cookie:cookie}})).status,200);
   await send('Page.navigate',{url:base+'/login'});await waitFor('location.pathname==="/login" && document.readyState==="complete"');
   assert.equal(await evaluate(`fetch('/api/office/session').then(r=>r.json()).then(d=>d.user)`),null);
   console.log('PASS logout revokes session; cross-site writes denied');
 }
 else {console.log('External-link destination: '+await evaluate('location.pathname'));console.log('Session still valid from login page: '+await evaluate(`fetch('/api/office/session').then(r=>r.json()).then(d=>!!d.user)`));}
}finally{
 if(socket&&chrome?.exitCode===null)await close();external.close();
 if(cookie)await fetch(base+'/api/office/session',{method:'DELETE',headers:{Origin:new URL(base).origin,Cookie:cookie}});
}
