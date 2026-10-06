require('../thermal/register.cjs');require('@next/env').loadEnvConfig(process.cwd(),false);
const {neon}=require('@neondatabase/serverless');
(async()=>{
 const sql=neon(process.env.DATABASE_URL);
 const [baseline]=await sql`select octet_length(coalesce(json_agg(t),'[]'::json)::text) as bytes from templates t`;
 require('../../src/lib/office/guard.ts').withOfficeAuth=h=>h;
 const response=await require('../../src/app/api/templates/route.ts').GET(new Request('http://fixture/api/templates'));
 if(response.status!==200)throw Error('Template read failed');
 const text=await response.text();const bytes=Buffer.byteLength(text);
 console.log(JSON.stringify({templateLibrary:{previousBytes:baseline.bytes,newBytes:bytes,reductionPercent:Math.round((1-bytes/baseline.bytes)*1000)/10,rows:JSON.parse(text).length},method:'read-only payload comparison, not a browser latency benchmark'}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
