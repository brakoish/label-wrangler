/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
require('../thermal/register.cjs');
const assert = require('node:assert/strict');
const { blankCheckAllowsPrinting, checkRunData, describeBlankIssue, describeRowList, blankRemedy, describeBlankSummary, rememberBlankChoice, hasBlankChoice } = require('../../src/lib/runDataCheck.ts');
const { printEventLabel, friendlyError, friendlyRenderError, runStatusLabel, printOutputLabel, stripInternalIds, OFFLINE_MESSAGE } = require('../../src/lib/userMessages.ts');

const text = (fieldName, extra = {}) => ({ id: 'txt-' + fieldName, type: 'text', isStatic: false, fieldName, ...extra });
const barcode = (fieldName, extra = {}) => ({ id: 'bc-' + fieldName, type: 'barcode', isStatic: false, fieldName, ...extra });

// B1: a blank SKU cell would silently print the designer sample barcode.
const template = { elements: [text('product_name', { defaultValue: 'Wildflower Honey' }), barcode('sku', { defaultValue: '123456789012' }), { id: 'logo', type: 'image', isStatic: true }] };
const rows = Array.from({ length: 2000 }, (_, i) => ({ name: `Product ${i + 1}`, sku: String(100000 + i) }));
for (const blank of [7, 212, 1500, 1600, 1700, 1800]) rows[blank - 1].sku = '';
let check = checkRunData(template, { sourceData: rows, fieldMappings: { product_name: { mode: 'column', csvColumn: 'name' }, sku: { mode: 'column', csvColumn: 'sku' } } });
assert.equal(check.checkedLabels, 2000);
assert.equal(check.issues.length, 1);
assert.deepEqual(check.issues[0].rows, [7, 212, 1500, 1600, 1700, 1800]);
assert.equal(check.issues[0].outcome, 'sample', 'blank barcode with a designer sample prints the sample');
assert.equal(check.canLeaveBlank, false, 'no "leave blank" override when the generator would print the sample');
assert.equal(blankCheckAllowsPrinting(check, true), false, 'a stale or forged leave-blank choice cannot unlock a sample-printing run');
assert.equal(describeBlankIssue(check.issues[0], 2000), 'sku is empty on rows 7, 212, 1500 (and 3 more). Those labels would print the design\'s sample "123456789012" instead.');
assert.match(blankRemedy(check), /Same on every label/);
assert.equal(describeBlankSummary(check), '6 labels are missing a value');

// Unmapped field left on "Same on every label" with an empty box.
check = checkRunData(template, { sourceData: rows.slice(0, 20).map(r => ({ ...r, sku: '1' })), fieldMappings: { product_name: { mode: 'static' }, sku: { mode: 'column', csvColumn: 'sku' } }, staticValues: { product_name: '' } });
assert.equal(check.issues[0].kind, 'no-value');
assert.equal(check.issues[0].count, 20);
assert.match(describeBlankIssue(check.issues[0], 20), /^product_name has no value/);
// Whitespace counts as blank; a typed static value fixes it.
assert.equal(checkRunData(template, { sourceData: [{ sku: '1' }], fieldMappings: { sku: { mode: 'column', csvColumn: 'sku' } }, staticValues: { product_name: '   ' } }).issues.length, 1);
assert.equal(checkRunData(template, { sourceData: [{ sku: '1' }], fieldMappings: { sku: { mode: 'column', csvColumn: 'sku' } }, staticValues: { product_name: 'Clover' } }).issues.length, 0);
assert.equal(describeBlankSummary(checkRunData(template, { sourceData: [{ sku: '1' }], fieldMappings: { sku: { mode: 'column', csvColumn: 'sku' } }, staticValues: { product_name: 'Clover' } })), 'All 1 labels checked — every field has a value.');

// "Leave blank" exists only when the generator would really print blank.
const plain = { elements: [text('note'), text('name', { defaultValue: '' })] };
check = checkRunData(plain, { sourceData: [{ n: 'a', note: '' }, { n: 'b', note: 'x' }], fieldMappings: { name: { mode: 'column', csvColumn: 'n' }, note: { mode: 'column', csvColumn: 'note' } } });
assert.equal(check.issues[0].outcome, 'blank');
assert.equal(check.canLeaveBlank, true);
assert.match(blankRemedy(check), /left blank/);
assert.equal(blankCheckAllowsPrinting(check, false), false, 'blocked by default');
assert.equal(blankCheckAllowsPrinting(check, true), true);
// A barcode without a sample would fail to render, so no override either.
assert.equal(checkRunData({ elements: [barcode('sku')] }, { sourceData: [{ s: '' }], fieldMappings: { sku: { mode: 'column', csvColumn: 's' } } }).issues[0].outcome, 'error');
assert.equal(checkRunData({ elements: [barcode('sku')] }, { sourceData: [{ s: '' }], fieldMappings: { sku: { mode: 'column', csvColumn: 's' } } }).canLeaveBlank, false);
// The same field on a second element with a sample makes the whole field unsafe.
assert.equal(checkRunData({ elements: [text('a'), text('a', { id: 'two', defaultValue: 'X' })] }, { sourceData: [{}], fieldMappings: {} }).issues[0].outcome, 'sample');
// Legacy string rows resolve through mappedField.
assert.equal(checkRunData({ elements: [text('qr')] }, { sourceData: ['a', '', 'c'], mappedField: 'qr' }).issues[0].rows[0], 2);
assert.equal(checkRunData({ elements: [text('qr')] }, { sourceData: ['a', '', 'c'], mappedField: 'qr' }).issues[0].kind, 'empty-rows');
// Static elements and images are never checked.
assert.equal(checkRunData({ elements: [{ id: 's', type: 'text', isStatic: true, content: '' }] }, { sourceData: [{}] }).issues.length, 0);
assert.equal(describeRowList([1, 2], 2), '1, 2');
assert.equal(describeRowList([1, 2, 3, 4], 1203), '1, 2, 3 (and 1,200 more)');

// The remembered "leave blank" choice covers only the exact issues confirmed.
const store = new Map(); const storage = { setItem: (k, v) => store.set(k, v), getItem: (k) => store.get(k) ?? null };
const okCheck = checkRunData(plain, { sourceData: [{ n: 'a', note: '' }], fieldMappings: { name: { mode: 'column', csvColumn: 'n' }, note: { mode: 'column', csvColumn: 'note' } } });
rememberBlankChoice(storage, 'run-1', okCheck.signature);
assert.equal(hasBlankChoice(storage, 'run-1', okCheck), true);
const changed = checkRunData(plain, { sourceData: [{ n: '', note: '' }], fieldMappings: { name: { mode: 'column', csvColumn: 'n' }, note: { mode: 'column', csvColumn: 'note' } } });
assert.equal(hasBlankChoice(storage, 'run-1', changed), false, 'new blanks need a new choice');
assert.equal(hasBlankChoice(storage, 'run-2', okCheck), false);
assert.equal(hasBlankChoice({ getItem() { throw new Error('blocked'); } }, 'run-1', okCheck), false);

// User-facing messages: no internal IDs, plain network/server copy.
assert.equal(friendlyError(new TypeError('Failed to fetch')), OFFLINE_MESSAGE);
assert.equal(friendlyError(new Error('Office printing request failed. No automatic retry was created.')), 'Label Wrangler is having trouble right now. Try again in a minute.');
assert.equal(stripInternalIds('Queued labels 1–20. Request 7f1c2a9e.'), 'Queued labels 1–20.');
assert.equal(friendlyRenderError('Lane 1, 087b8c70-1234-4abc-8def-0123456789ab: Image is missing', [{ id: '087b8c70-1234-4abc-8def-0123456789ab', type: 'image' }]), 'The picture box has no picture yet — choose a file or delete the box.');
assert.equal(friendlyRenderError('Labels 1–8: Lane 2, sku: Missing QR/barcode value', [barcode('sku')], 2), 'Labels 1–8: The barcode "sku" (label position 2) has no value — type one under "Sample text (preview only)", or fill it from your data.');
assert.doesNotMatch(friendlyRenderError('Lane 1, 087b8c70-1234-4abc-8def-0123456789ab: Weird failure', []), /087b8c70/);
assert.equal(runStatusLabel('queued'), 'Ready to print');
assert.equal(runStatusLabel('completed'), 'Done');
assert.equal(printOutputLabel('roll-zpl'), 'thermal printer');
assert.equal(printEventLabel({ eventType: 'sent', output: 'roll-zpl', rangeFrom: 1, rangeTo: 20, message: null }), 'Sent labels 1–20 to the thermal printer');
assert.equal(printEventLabel({ eventType: 'sent', output: 'roll-zpl', rangeFrom: 5, rangeTo: 8, message: 'Reprint' }), 'Reprinted labels 5–8 on the thermal printer');
assert.equal(printEventLabel({ eventType: 'confirmed', output: 'sheet-pdf', rangeFrom: 3, rangeTo: 3, message: null }), 'Printed label 3 on the sheet printer / PDF');
assert.doesNotMatch(printEventLabel({ eventType: 'sent', output: 'roll-pdf', rangeFrom: 1, rangeTo: 9, message: 'Exported PDF' }), /roll-/);
console.log('PASS: whole-run blank check (sample/error/blank outcomes, no unsafe override), remembered choice, plain user messages');

// Office Pi panel: suggested range skips queued work, Start waits on overlap,
// and only print-affecting run fields invalidate a checked range.
{
  const { firstUnsentLabel, rangeOverlapsQueued, isValidOfficeRange, officeProofKey } = require('../../src/lib/officeRange.ts');
  const jobs = [{ from: 1, to: 50, state: 'sent_to_printer' }, { from: 51, to: 100, state: 'queued' }, { from: 150, to: 200, state: 'sent_to_printer' }];
  assert.equal(firstUnsentLabel(jobs, 300), 101, 'queued labels are not suggested again');
  assert.equal(firstUnsentLabel([{ from: 1, to: 50, state: 'rejected' }], 300), 1, 'rejected work is suggested again');
  assert.equal(firstUnsentLabel([{ from: 1, to: 300, state: 'sent_to_printer' }], 300), 300);
  assert.equal(rangeOverlapsQueued(jobs, 90, 120), true);
  assert.equal(rangeOverlapsQueued(jobs, 101, 300), false);
  assert.equal(rangeOverlapsQueued([{ from: 1, to: 10, state: 'needs_review' }], 1, 10), false);
  assert.equal(isValidOfficeRange('1', '20', 20), true);
  assert.equal(isValidOfficeRange('0', '20', 20), false);
  assert.equal(isValidOfficeRange('5', '4', 20), false);
  assert.equal(isValidOfficeRange('1', '21', 20), false);
  assert.equal(isValidOfficeRange('', '3', 20), false);
  assert.equal(isValidOfficeRange('1.5', '3', 20), false);
  const run = { id: 'r', sourceData: [{ a: '1' }], fieldMappings: {}, staticValues: {}, printedCount: 0, status: 'queued' };
  const key = officeProofKey(run, { t: 1 }, { f: 1 }, '1', '1');
  assert.equal(officeProofKey({ ...run, printedCount: 40, status: 'printing' }, { t: 1 }, { f: 1 }, '1', '1'), key, 'progress updates keep the check');
  assert.notEqual(officeProofKey({ ...run, sourceData: [{ a: '2' }] }, { t: 1 }, { f: 1 }, '1', '1'), key, 'new data needs a new check');
  assert.notEqual(officeProofKey({ ...run, staticValues: { x: 'y' } }, { t: 1 }, { f: 1 }, '1', '1'), key);
  assert.notEqual(officeProofKey(run, { t: 2 }, { f: 1 }, '1', '1'), key);
  assert.notEqual(officeProofKey(run, { t: 1 }, { f: 1 }, '1', '2'), key);
  console.log('PASS: office range helpers (skip queued, overlap wait, validation, print-only check key)');
}

// Designer: switching "Same on every label" <-> "Changes per label" keeps what was typed.
{
  const { contentModeUpdates } = require('../../src/lib/elementBinding.ts');
  assert.deepEqual(contentModeUpdates({ type: 'text', isStatic: true, content: 'Wildflower Honey' }, false, () => 'product_name'), { isStatic: false, defaultValue: 'Wildflower Honey', fieldName: 'product_name' });
  assert.deepEqual(contentModeUpdates({ type: 'barcode', isStatic: true, content: '123', defaultValue: 'keep', fieldName: 'sku' }, false), { isStatic: false }, 'an existing sample and column name are kept');
  assert.deepEqual(contentModeUpdates({ type: 'qr', isStatic: false, content: '', defaultValue: 'https://example.test' }, true), { isStatic: true, content: 'https://example.test' });
  assert.deepEqual(contentModeUpdates({ type: 'text', isStatic: false, content: 'typed', defaultValue: 'sample' }, true), { isStatic: true }, 'fixed text is not overwritten');
  assert.deepEqual(contentModeUpdates({ type: 'line', isStatic: true, fieldName: 'x' }, false), { isStatic: false });
  console.log('PASS: content mode switch carries typed text into the sample and back');
}
