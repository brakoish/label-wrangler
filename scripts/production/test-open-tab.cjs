// Sheet print/reprint tabs: a successful open must not be reported as
// "Popup blocked". Browsers return null from window.open with noopener.
require('../thermal/register.cjs');
const assert=require('node:assert/strict');
const {openInNewTab}=require('../../src/lib/openTab.ts');
const calls=[];const tab={opener:'run page'};
// Stub behaves like a real browser: noopener always yields null.
const browser={open:(url,target,features='')=>{calls.push([url,target,features]);return /noopener/.test(features)?null:tab;}};
assert.equal(openInNewTab('/runs/r/print?from=1&to=10',browser),true,'opened tab reported as blocked');
assert.deepEqual(calls[0],['/runs/r/print?from=1&to=10','_blank','']);
assert.equal(tab.opener,null,'new tab can still reach the run page');
// A real popup block still reports false.
assert.equal(openInNewTab('/x',{open:()=>null}),false);
// A tab whose opener cannot be cleared still counts as opened.
assert.equal(openInNewTab('/x',{open:()=>({set opener(v){throw new Error('nope');}})}),true);
console.log('PASS open tab: success is not reported as popup blocked; opener cleared; real blocks still detected');
