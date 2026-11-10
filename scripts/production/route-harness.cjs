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
const session={user:{id:'u',username:'fixture',can_print:true,can_edit:true,is_admin:false}};
if(process.env.HARNESS_REAL_GUARD==='1'){
 // Real guard; only the session lookup is faked.
 mock('src/lib/office/auth.ts',{requireUser:async(req,permission='read')=>{const u=session.user;permissionsSeen.push([req.method,permission]);if(!u){const {OfficeError}=require('../../src/lib/office/http.ts');throw new OfficeError('Sign in to Label Wrangler',401);}
  const {OfficeError}=require('../../src/lib/office/http.ts');
  if((permission==='print'&&!u.can_print)||(permission==='edit'&&!u.can_edit)||(permission==='admin'&&!u.is_admin))throw new OfficeError('Your account does not have permission',403);return u;}});
}else{
 mock('src/lib/office/guard.ts',{withOfficeAuth:(handler,permission)=>async(req,...args)=>{permissionsSeen.push([req.method,permission]);return handler(req,...args);},officeUserFor:()=>session.user});
}
function request(method,body){return new Request('https://example.test/api',{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});}
const params=id=>({params:Promise.resolve({id})});
module.exports={session,db,log,results,request,params,permissionsSeen,reset(){log.length=0;results.length=0;permissionsSeen.length=0;}};
