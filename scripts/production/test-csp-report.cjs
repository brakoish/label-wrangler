// Report-only CSP sends violations to /api/csp-report, which logs a trimmed
// summary, never reflects input and stays quiet under a flood. Headers still
// skip the Pi station endpoints.
require('../thermal/register.cjs');
const assert=require('node:assert/strict');
const {summarizeCspReports}=require('../../src/lib/cspReport.ts');
const route=require('../../src/app/api/csp-report/route.ts');
const config=require('../../next.config.ts').default;
(async()=>{
 assert.deepEqual(summarizeCspReports({'csp-report':{'document-uri':'https://lw.test/runs/abc?token=secret#x','violated-directive':'script-src-elem','effective-directive':'script-src-elem','blocked-uri':'https://cdn.evil.test/x.js?k=1','line-number':12,'source-file':'https://lw.test/_next/a.js'}}),
  ['directive=script-src-elem blocked=https://cdn.evil.test/x.js page=https://lw.test/runs/abc source=https://lw.test/_next/a.js:12']);
 assert.deepEqual(summarizeCspReports([{type:'csp-violation',body:{documentURL:'https://lw.test/designer',effectiveDirective:'img-src',blockedURL:'https://img.test/a.png',disposition:'report'}}]),
  ['directive=img-src blocked=https://img.test/a.png page=https://lw.test/designer disposition=report']);
 const [long]=summarizeCspReports({'csp-report':{'blocked-uri':'x'.repeat(5000)+'\nFAKE LOG LINE','effective-directive':'a\r\nb'}});
 assert.ok(long.length<600&&!/[\r\n]/.test(long),'report fields not trimmed');
 assert.deepEqual(summarizeCspReports('nope'),[]);assert.deepEqual(summarizeCspReports(Array(50).fill({body:{}})).length,5);
 const logs=[];const warn=console.warn;console.warn=(...a)=>logs.push(a.join(' '));
 try{
  const post=(body,type='application/csp-report')=>route.POST(new Request('https://lw.test/api/csp-report',{method:'POST',headers:{'content-type':type},body}));
  let res=await post(JSON.stringify({'csp-report':{'effective-directive':'style-src','blocked-uri':'inline','document-uri':'https://lw.test/runs'}}));
  assert.equal(res.status,204);assert.equal(await res.text(),'');assert.equal(logs.length,1);assert.match(logs[0],/^CSP report-only: directive=style-src blocked=inline/);
  await post('{not json');await post(JSON.stringify({'csp-report':{x:'y'.repeat(20000)}}));await post('{}','text/plain');
  assert.equal(logs.length,1,'malformed, oversized or wrong-type reports must not be logged');
  for(let i=0;i<40;i++)assert.equal((await post(JSON.stringify({'csp-report':{'effective-directive':'img-src'}}))).status,204);
  assert.ok(logs.length<=20,`flood logged ${logs.length} lines`);
 }finally{console.warn=warn;}
 const [rule]=await config.headers();
 assert.equal(rule.source,'/((?!api/print-stations).*)','security headers must keep skipping the Pi endpoints');
 const csp=rule.headers.find(h=>h.key==='Content-Security-Policy-Report-Only').value;
 assert.match(csp,/report-uri \/api\/csp-report/);assert.ok(!rule.headers.some(h=>h.key==='Content-Security-Policy'),'CSP must stay report-only');
 console.log('PASS CSP report: report-uri set, trimmed/rate-limited logging, 204 always, headers still skip /api/print-stations');
})().catch(e=>{console.error(e);process.exitCode=1;});
