// Real headless browser + authoritative local renderer. All edits and print writes intercepted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
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
 const run={id:'saved-manifest',name:'Saved Manifest snapshot',templateId:fixture.id,staticValues:{product:'MANUAL HISTORICAL NAME'},fieldMappings:{product:{mode:'static'},url:{mode:'column',csvColumn:'savedUrl'}},dataSource:'manifest',sourceData:[{savedUrl:'https://example.invalid/OLD-1'},{savedUrl:'https://example.invalid/OLD-2'}],totalLabels:2,printedCount:2,status:'completed',createdAt:'',updatedAt:''};
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
 const original=window.fetch.bind(window);window.created=[];window.manifestSearches=0;window.detailLoads=0;
 const run=${JSON.stringify(run)};
 window.fetch=async(url,options={})=>{
 const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
 if(String(url)==='/api/templates')return json([${JSON.stringify(fixture)}]);
 if(String(url)==='/api/formats')return json([${JSON.stringify(format)}]);
 if(String(url)==='/api/presets'||String(url)==='/api/globals')return json([]);
 if(String(url)==='/api/runs'){
 if(options.method==='POST'){window.created.push(JSON.parse(options.body));return new Response(JSON.stringify({error:'Test intercepted creation'}),{status:409});}
 const {sourceData,...summary}=run;return json([summary]);}
 if(String(url)==='/api/runs/saved-manifest'){window.detailLoads++;return json(run);}
 if(String(url).startsWith('/api/nabis/search')){window.manifestSearches++;throw Error('Must not reload Manifest for a re-run');}
 if(options.method && options.method!=='GET' && String(url)!=='/api/thermal/render' && String(url)!=='/api/zpl-preview')throw Error('Unexpected write '+url);
 return original(url,options);
 };`});
 await send('Page.navigate',{url:base+'/runs/new?duplicateFrom=saved-manifest'});
 await waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Start Run (2 labels)')&&!b.disabled)");
 await pause(500);
 await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Start Run (2 labels)')).click()");
 await waitFor('window.created.length===1');
 const result=await evaluate('({body:window.created[0],searches:window.manifestSearches,loads:window.detailLoads})');
 assert.deepEqual(result.body.sourceData,run.sourceData);
 assert.deepEqual(result.body.fieldMappings,run.fieldMappings);
 assert.deepEqual(result.body.staticValues,run.staticValues);
 assert.equal(result.searches,0);assert.ok(result.loads>0);
 console.log('PASS: cold-loaded Manifest re-run preserves saved rows, custom mappings, manual values and count without live lookup. Creation intercepted; no jobs printed.');
} finally {if(socket)socket.close();chrome.kill('SIGTERM');await fetch(base+'/api/office/session',{method:'DELETE',headers:{Origin:new URL(base).origin,Cookie:cookie}});}
