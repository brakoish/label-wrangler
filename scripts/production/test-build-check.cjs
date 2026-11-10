// A page left open across a deploy is asked to reload: the server says which
// build it runs (hashed, no database), and the page compares it with the one
// it loaded with. Unknown on either side never asks.
require('../thermal/register.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {buildChanged,builtInBuild,versionRouteGone}=require('../../src/lib/buildCheck.ts');
assert.equal(buildChanged('a','a'),false);
assert.equal(buildChanged('a','b'),true);
assert.equal(buildChanged(null,'b'),false,'unknown when loaded: no prompt');
assert.equal(buildChanged('a',null),false,'unknown now: no prompt');
assert.equal(buildChanged(undefined,undefined),false);
// After a rollback to a build without /api/version, the 404 means "out of
// date", but only for a tab that knows its own build had the route.
assert.equal(versionRouteGone(404,true),true,'rolled back past the route: reload');
assert.equal(versionRouteGone(404,false),false,'never knew the route: no prompt');
for(const status of [500,502,503,504,401,403,429])assert.equal(versionRouteGone(status,true),false,`${status} is trouble, not a new version`);
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
 assert.match(notice,/Label Wrangler was updated\. Reload to keep working\./);
 assert.match(notice,/versionRouteGone\(response\.status, knewRoute\)/,'a 404 after a rollback asks for a reload');
 assert.match(notice,/gone404 >= 2/,'one stray 404 is not enough');
 assert.match(notice,/catch \{ \/\* offline: try again later \*\/ \}/,'a network error never asks');
 assert.match(notice,/if \(canLeaveLocalPrint\(\)\) window\.location\.reload\(\)/,'a reload never cuts off a print in progress');
 assert.doesNotMatch(notice,/location\.reload\(\);?\s*\}\s*,\s*\d/,'nothing reloads on its own');
 // The build is built into the page (next.config env) with the same value the
 // server reports, so a deploy before the first check is still announced.
 const config=require('../../next.config.ts').default;
 assert.equal(config.env.LW_BUILD_STAMP,body.build,'the page carries the same stamp /api/version reports');
 assert.equal(builtInBuild(config.env.LW_BUILD_STAMP),body.build);
 assert.equal(builtInBuild(''),undefined,'a build that could not tell: learn from the first check');
 assert.equal(builtInBuild(undefined),undefined);
 assert.equal(builtInBuild('not-a-stamp'),undefined);
 const stampFile=require.resolve('../../src/lib/buildStamp.server.ts');
 delete require.cache[stampFile];
 process.env.LW_BUILD_STAMP='fedcba9876543210';
 assert.equal(require(stampFile).buildStamp(),'fedcba9876543210','the server reports the built-in stamp first');
 delete process.env.LW_BUILD_STAMP;
 delete require.cache[stampFile];
 assert.equal(require(stampFile).buildStamp(),body.build,'without one, the runtime ids give the same hash');
 assert.match(notice,/let pageBuild: string \| null \| undefined = builtInBuild\(process\.env\.LW_BUILD_STAMP\);/,'the page compares against its built-in build');
 assert.match(notice,/if \(pageBuild === undefined\) \{ pageBuild = build; return; \}/,'first-check fallback only when the build could not tell');
 const configSrc=fs.readFileSync(path.join(__dirname,'../../next.config.ts'),'utf8');
 assert.match(configSrc,/env: \{ LW_BUILD_STAMP: buildStamp \}/);
 assert.doesNotMatch(configSrc,/deploymentId|generateBuildId/,'asset URLs and the build id are left as they were');
 console.log('PASS build check: the server names its build (hashed); open pages ask for a reload after a deploy (the build is built into the page), never on their own');
})().catch(e=>{console.error(e);process.exitCode=1;});
