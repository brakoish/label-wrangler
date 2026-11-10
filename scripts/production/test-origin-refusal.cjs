// Browser-facing routes add a machine-readable code to an origin refusal so the
// browser can keep (not drop) the update. The Pi's failure() output is unchanged.
require('../thermal/register.cjs');
const assert=require('node:assert/strict');
const path=require('node:path');
const http=require('../../src/lib/office/http.ts');
(async()=>{
 const bad=new Request('https://label-wrangler.vercel.app/api/runs/r',{method:'PUT',headers:{origin:'https://preview.example'}});
 let refusal;try{http.sameOrigin(bad);}catch(e){refusal=e;}
 assert.ok(refusal instanceof http.OfficeError);assert.equal(refusal.status,403);assert.equal(refusal.message,'Request origin not allowed');
 // Pi helper: byte-for-byte the same body as before (no code field).
 const pi=http.failure(refusal);assert.equal(pi.status,403);assert.equal(await pi.text(),JSON.stringify({error:'Request origin not allowed'}));
 const pi401=http.failure(new http.OfficeError('Invalid station credential',401));assert.equal(await pi401.text(),JSON.stringify({error:'Invalid station credential'}));
 // Browser helper: same message and status plus the code; other errors unchanged.
 const browser=http.browserFailure(refusal);assert.equal(browser.status,403);assert.deepEqual(await browser.json(),{error:'Request origin not allowed',code:'origin_not_allowed'});
 const denied=http.browserFailure(new http.OfficeError('Your account does not have permission',403));assert.deepEqual(await denied.json(),{error:'Your account does not have permission'});
 // The library guard (used by /api/runs) returns the code; the session lookup is faked.
 const auth=path.resolve('src/lib/office/auth.ts');
 require.cache[auth]={id:auth,filename:auth,loaded:true,children:[],paths:[],exports:{requireUser:async(req)=>{if(!['GET','HEAD'].includes(req.method))http.sameOrigin(req);return {id:'u',username:'u',can_print:true,can_edit:true,is_admin:false};}}};
 process.env.OFFICE_APP_ORIGIN='https://label-wrangler.vercel.app';
 const {withOfficeAuth}=require('../../src/lib/office/guard.ts');
 const route=withOfficeAuth(async()=>Response.json({ok:true}),'print-or-edit');
 const res=await route(bad);assert.equal(res.status,403);assert.equal((await res.json()).code,'origin_not_allowed');
 const ok=await route(new Request('https://label-wrangler.vercel.app/api/runs/r',{method:'PUT',headers:{origin:'https://label-wrangler.vercel.app'}}));assert.equal(ok.status,200);
 console.log('PASS origin refusal: browser-facing responses carry code origin_not_allowed; Pi failure() body unchanged');
})().catch(e=>{console.error(e);process.exitCode=1;});
