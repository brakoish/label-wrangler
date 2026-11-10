// A page left open across a deploy is asked to reload: the server says which
// build it runs (hashed, no database), and the page compares it with the one
// it loaded with. Unknown on either side never asks.
require('../thermal/register.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {buildChanged}=require('../../src/lib/buildCheck.ts');
assert.equal(buildChanged('a','a'),false);
assert.equal(buildChanged('a','b'),true);
assert.equal(buildChanged(null,'b'),false,'unknown when loaded: no prompt');
assert.equal(buildChanged('a',null),false,'unknown now: no prompt');
assert.equal(buildChanged(undefined,undefined),false);
(async()=>{
 process.env.VERCEL_GIT_COMMIT_SHA='0123456789abcdef0123456789abcdef01234567';
 const route=require('../../src/app/api/version/route.ts');
 const res=await route.GET();
 assert.equal(res.status,200);
 assert.equal(res.headers.get('cache-control'),'no-store');
 const body=await res.json();
 assert.match(body.build,/^[a-f0-9]{16}$/,'a short hash');
 assert.ok(!body.build.includes('0123456789abcdef0'),'the commit itself is not shown');
 assert.equal((await (await route.GET()).json()).build,body.build,'stable within one deployment');
 const shell=fs.readFileSync(path.join(__dirname,'../../src/components/AppShell.tsx'),'utf8');
 assert.match(shell,/<NewVersionNotice \/>/,'every page with the app shell shows the notice');
 const notice=fs.readFileSync(path.join(__dirname,'../../src/components/NewVersionNotice.tsx'),'utf8');
 assert.match(notice,/A new version is ready — reload/);
 assert.match(notice,/if \(canLeaveLocalPrint\(\)\) window\.location\.reload\(\)/,'a reload never cuts off a print in progress');
 assert.doesNotMatch(notice,/location\.reload\(\);?\s*\}\s*,\s*\d/,'nothing reloads on its own');
 console.log('PASS build check: the server names its build (hashed); open pages ask for a reload after a deploy, never on their own');
})().catch(e=>{console.error(e);process.exitCode=1;});
