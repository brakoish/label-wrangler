// Sign-in "next" must stay on this site (open-redirect regression).
require('../thermal/register.cjs');
const assert=require('node:assert/strict');
const {safeNextPath}=require('../../src/lib/safeRedirect.ts');
const origin='https://label-wrangler.vercel.app';
for(const [next,expected] of [
 ['/runs/abc?x=1#h','/runs/abc?x=1#h'],['/designer?id=t&returnTo=%2Fruns%2Fr','/designer?id=t&returnTo=%2Fruns%2Fr'],[null,'/runs'],['','/runs'],
 ['/\t/evil.com','/runs'],['/\n/evil.com','/runs'],['//evil.com','/runs'],['/\\evil.com','/runs'],['\\\\evil.com','/runs'],
 ['https://evil.com/x','/runs'],['javascript:alert(1)','/runs'],[' //evil.com','/runs'],['http://label-wrangler.vercel.app/runs','/runs'],
]) assert.equal(safeNextPath(next,origin),expected,JSON.stringify(next));
// Relative paths resolve on this site.
assert.equal(safeNextPath('runs',origin),'/runs');
console.log('PASS safe redirect: sign-in next stays same-origin (tab/newline/backslash/protocol tricks fall back to /runs)');
