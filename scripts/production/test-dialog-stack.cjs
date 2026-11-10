// Nested dialogs: only the top one reacts to Tab/Escape.
require('../thermal/register.cjs');
const assert=require('node:assert/strict');
const {pushDialogLayer,removeDialogLayer,isTopDialogLayer}=require('../../src/components/ui/dialogStack.ts');
const picker=pushDialogLayer();assert.equal(isTopDialogLayer(picker),true);
const confirm=pushDialogLayer();
assert.equal(isTopDialogLayer(confirm),true);assert.equal(isTopDialogLayer(picker),false,'outer dialog still handles keys');
// Two document listeners, registered outer first, see the same Escape: only the confirm closes.
const closed=[];const listener=(layer,name)=>()=>{if(isTopDialogLayer(layer))closed.push(name);};
for(const l of [listener(picker,'picker'),listener(confirm,'confirm')])l();
assert.deepEqual(closed,['confirm']);
removeDialogLayer(confirm);assert.equal(isTopDialogLayer(picker),true,'outer dialog takes keys back');
// Closing out of order (outer first) keeps the inner one on top.
const a=pushDialogLayer();const b=pushDialogLayer();removeDialogLayer(a);assert.equal(isTopDialogLayer(b),true);removeDialogLayer(b);removeDialogLayer(picker);
assert.equal(isTopDialogLayer(picker),false);
console.log('PASS dialog stack: only the top dialog handles Tab/Escape; outer takes keys back when the inner closes');
