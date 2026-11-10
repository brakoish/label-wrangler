// Office printing in the browser: progress recorded from office deliveries,
// one suggested range across printers, and refused sends read as refusals
// (no "not sure it arrived", no resend of a request the server said no to).
require('../thermal/register.cjs');
const assert = require('node:assert/strict');
const { firstUnsentLabel, officePrintedThrough, queuedBeyond, officeProgressUpdate } = require('../../src/lib/officeRange.ts');
const { officeFailureKind, plainOfficeRefusal, keepPendingAfter, readRefusal, officePrinterReadiness } = require('../../src/lib/officeSendOutcome.ts');

// --- Progress from office deliveries ---------------------------------------
const sent = (from, to) => ({ from, to, state: 'sent_to_printer' });
const queued = (from, to) => ({ from, to, state: 'queued' });
assert.equal(officePrintedThrough(0, [sent(1, 20)]), 20, 'everything sent counts');
assert.equal(officePrintedThrough(40, [sent(41, 60)]), 60, 'office labels continue local progress');
assert.equal(officePrintedThrough(0, [sent(21, 40)]), 0, 'a gap stops the count');
assert.equal(officePrintedThrough(10, [sent(1, 5)]), 10, 'never goes backwards');
assert.equal(officePrintedThrough(0, [sent(1, 10), queued(11, 20), sent(21, 30)]), 10, 'queued work is not printed yet');
assert.equal(officePrintedThrough(0, [sent(1, 10), { from: 11, to: 20, state: 'rejected' }]), 10);
assert.equal(officePrintedThrough(0, [sent(1, 10), sent(5, 30)]), 30, 'overlapping (reprinted) ranges join up');
assert.equal(officePrintedThrough(0, [sent(1, 500)], 400), 400, 'clamped to the run length');

assert.deepEqual(officeProgressUpdate({ status: 'queued', printedCount: 0, totalLabels: 20 }, 20), { printedCount: 20, status: 'completed' }, 'all sent: run is done');
assert.deepEqual(officeProgressUpdate({ status: 'queued', printedCount: 0, totalLabels: 120 }, 60), { printedCount: 60, status: 'paused' }, 'part sent: partly printed');
assert.deepEqual(officeProgressUpdate({ status: 'paused', printedCount: 40, totalLabels: 120 }, 60), { printedCount: 60, status: 'paused' });
assert.deepEqual(officeProgressUpdate({ status: 'printing', printedCount: 40, totalLabels: 120 }, 60), { printedCount: 60, status: 'printing' }, 'a live local print keeps its status');
assert.deepEqual(officeProgressUpdate({ status: 'cancelled', printedCount: 0, totalLabels: 10 }, 10), { printedCount: 10, status: 'cancelled' }, 'a cancelled run stays cancelled');
assert.equal(officeProgressUpdate({ status: 'paused', printedCount: 60, totalLabels: 120 }, 60), null, 'nothing new: no update');
assert.equal(officeProgressUpdate({ status: 'paused', printedCount: 60, totalLabels: 120 }, 30), null, 'never records lower progress');

// --- One suggested range across printers -----------------------------------
assert.equal(firstUnsentLabel([], 120, 40), 41, 'starts after labels printed on this computer');
assert.equal(firstUnsentLabel([queued(41, 60)], 120, 40), 61, 'and after work already queued');
assert.equal(firstUnsentLabel([sent(1, 120)], 120, 0), null);
assert.equal(firstUnsentLabel([], 120, 120), null, 'a finished run suggests nothing');
assert.equal(firstUnsentLabel([queued(70, 80)], 120, 40), 41, 'a later queued range leaves the gap to fill');
assert.equal(queuedBeyond([queued(73, 96)], 96), 0, 'queued labels already counted are not "more on the way"');
assert.equal(queuedBeyond([queued(73, 96), sent(1, 72)], 72), 24);
assert.equal(queuedBeyond([queued(73, 96)], 80), 16);

// --- Refused sends -----------------------------------------------------------
assert.equal(officeFailureKind(409), 'refused');
assert.equal(officeFailureKind(400), 'refused');
assert.equal(officeFailureKind(401), 'refused');
assert.equal(officeFailureKind(403), 'refused');
assert.equal(officeFailureKind(undefined), 'uncertain', 'no answer: it may have arrived');
assert.equal(officeFailureKind(500), 'uncertain');
assert.equal(officeFailureKind(503), 'uncertain');
assert.equal(officeFailureKind(408), 'uncertain');
assert.equal(keepPendingAfter('refused'), false, 'a refused request is not offered for resend');
assert.equal(keepPendingAfter('uncertain'), true, 'an unknown outcome keeps the same request (same key) for a safe resend');
assert.equal(keepPendingAfter('other'), true);

const pairing = plainOfficeRefusal('Office Pi is awaiting verified pairing. Job creation is disabled.', 409);
assert.equal(pairing.reason, 'not-paired');
assert.match(pairing.message, /isn’t ready to take jobs yet — it’s waiting to be paired/);
assert.doesNotMatch(pairing.message, /Office Pi|Job creation/);
assert.equal(plainOfficeRefusal('Station pairing not activated', 409).reason, 'not-paired', 'designer test print wording');
assert.equal(plainOfficeRefusal('Check printer before retrying', 409).reason, 'needs-review');
assert.equal(plainOfficeRefusal('Printer access denied', 403).reason, 'no-access');
assert.equal(plainOfficeRefusal('Sign in to Label Wrangler', 401).reason, 'signed-out');
assert.equal(plainOfficeRefusal('This range has already been queued. Use Reprint to print this range again.', 409).reason, 'already-queued');
assert.equal(plainOfficeRefusal('The saved run/design changed or its bitmap proof is missing. Prepare the proof again before printing.', 409).reason, 'labels-changed');
assert.equal(plainOfficeRefusal('Preview changed or is missing. Refresh the bitmap proof before printing.', 409).reason, 'labels-changed');
assert.equal(plainOfficeRefusal('Something odd', 422).reason, 'other');
assert.match(plainOfficeRefusal('Something odd.', 422).message, /Something odd\. Nothing new was printed\./);

assert.deepEqual(readRefusal(JSON.stringify({ from: 1, to: 20, reason: 'not-paired', message: 'x', at: 't' })), { from: 1, to: 20, reason: 'not-paired', message: 'x', at: 't' });
assert.equal(readRefusal('{bad'), null);
assert.equal(readRefusal(JSON.stringify({ from: 'a' })), null);

// Never "connected" in green while sending is refused.
const ready = { online: true, available: true, dispatch_enabled: true, paired_at: 't', needs_review: false };
assert.equal(officePrinterReadiness(ready, null).tone, 'ok');
assert.equal(officePrinterReadiness(ready, 'not-paired').tone, 'warn', 'a pairing refusal overrides a stale "ready"');
assert.equal(officePrinterReadiness(ready, 'not-paired').canSend, true, 'a fresh Try again is still possible');
assert.equal(officePrinterReadiness({ ...ready, dispatch_enabled: false }, null).canSend, false);
assert.match(officePrinterReadiness({ ...ready, dispatch_enabled: false }, null).text, /waiting to be paired/);
assert.equal(officePrinterReadiness({ ...ready, needs_review: true }, null).canSend, false);
assert.equal(officePrinterReadiness(undefined, null).canSend, false);

console.log('PASS office progress: deliveries record contiguous progress (done when all sent), one range across printers, 4xx refusals clear the saved request and read in plain words');

// Field names on the run page read as words, not code.
const { fieldDisplayName } = require('../../src/lib/fieldDisplayName.ts');
assert.equal(fieldDisplayName('coa_url'), 'COA link');
assert.equal(fieldDisplayName('package_tag'), 'Package tag');
assert.equal(fieldDisplayName('thc'), 'THC');
assert.equal(fieldDisplayName('batchNumber'), 'Batch number');
assert.equal(fieldDisplayName('Product Name'), 'Product Name', 'spreadsheet headings stay as typed');
assert.equal(fieldDisplayName('SKU'), 'SKU');
assert.equal(fieldDisplayName('url'), 'Link');
console.log('PASS field display names');
