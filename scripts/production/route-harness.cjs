// Offline harness for API route handlers: replaces the database client and the
// session guard with in-memory fakes. Nothing here opens a network connection.
require('../thermal/register.cjs');
const path=require('node:path');
function mock(rel,exports){const file=path.resolve(rel);require.cache[file]={id:file,filename:file,loaded:true,exports,children:[],paths:[]};}
const log=[];const results=[];
function chain(first){
 const calls=[first];log.push(calls);
 const proxy=new Proxy(function(){},{get(_,key){
  if(key==='then'){const next=results.length?results.shift():[];const value=typeof next==='function'?next(calls):next;const promise=value instanceof Error?Promise.reject(value):Promise.resolve(value);return promise.then.bind(promise);}
  return (...args)=>{calls.push([key,args]);return proxy;};
 }});
 return proxy;
}
const db=new Proxy({},{get(_,key){return (...args)=>chain([key,args]);}});
mock('src/lib/db/index.ts',{db});
let permissionsSeen=[];
mock('src/lib/office/guard.ts',{withOfficeAuth:(handler,permission)=>async(req,...args)=>{permissionsSeen.push([req.method,permission]);return handler(req,...args);}});
function request(method,body){return new Request('https://example.test/api',{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});}
const params=id=>({params:Promise.resolve({id})});
module.exports={db,log,results,request,params,permissionsSeen,reset(){log.length=0;results.length=0;permissionsSeen.length=0;}};
