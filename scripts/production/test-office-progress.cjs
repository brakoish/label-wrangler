// Office printing in the browser. Office deliveries are shown ("Sent to
// office printer: X of N") but never written into the run's progress; a
// person marks them printed. Failed parts are named with a reason and a
// reprint the server accepts. Overlapping ranges switch to the reprint path.
// Big runs are sent in safe chunks. A send is kept for a safe resend unless
// the server definitely refused it before queuing.
require('../thermal/register.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../../src/lib/officeRange.ts');
const O = require('../../src/lib/officeSendOutcome.ts');
const { runDisplayStatus, officeSentLine } = require('../../src/lib/runDisplayStatus.ts');

const sent = (from, to, extra = {}) => ({ from, to, state: 'sent_to_printer', requestId: 'req-sent', ...extra });
const queued = (from, to, extra = {}) => ({ from, to, state: 'queued', requestId: 'req-q', ...extra });
const rejected = (from, to, extra = {}) => ({ from, to, state: 'rejected', review: true, reason: 'media out', requestId: 'req-bad', id: `job-${from}`, ...extra });

// --- No automatic progress: only an offer to mark sent labels printed --------
assert.equal('officeProgressUpdate' in R, false, 'office deliveries must not be turned into progress updates');
assert.equal(R.officePrintedThrough(0, [sent(1, 20)]), 20, 'labels 1–20 can be offered to mark printed');
assert.equal(R.officePrintedThrough(40, [sent(41, 60)]), 60, 'continues local progress');
assert.equal(R.officePrintedThrough(0, [sent(21, 40)]), 0, 'a gap stops the offer (never skips labels)');
assert.equal(R.officePrintedThrough(10, [sent(1, 5)]), 10, 'never goes backwards');
assert.equal(R.officePrintedThrough(0, [sent(1, 10), queued(11, 20), sent(21, 30)]), 10, 'queued work is not sent yet');
assert.equal(R.officePrintedThrough(0, [sent(1, 10, { review: true })]), 0, 'a part that needs a check is not offered');
assert.equal(R.officePrintedThrough(0, [sent(1, 500)], 400), 400, 'clamped to the run length');

// --- Delivery summary: sent, on the way, and what didn't print ---------------
{
  const s = R.officeDeliverySummary([sent(1, 50), sent(40, 60), queued(61, 80), rejected(81, 100), rejected(101, 120, { id: 'job-101' })], 200);
  assert.equal(s.sent, 60, 'overlapping (reprinted) ranges count once');
  assert.equal(s.onTheWay, 20);
  assert.equal(s.failed.length, 1, 'touching failed parts of one send merge');
  assert.deepEqual(s.failed[0], { from: 81, to: 120, reason: 'media out', requestId: 'req-bad', jobIds: ['job-81', 'job-101'], didNotPrint: true });
  const unsure = R.officeDeliverySummary([{ from: 1, to: 10, state: 'claimed', review: true, requestId: 'r', id: 'j' }], 10);
  assert.equal(unsure.failed[0].didNotPrint, false, 'a part the office never confirmed may have printed');
  assert.equal(unsure.onTheWay, 0, 'and is not "on the way" any more');
  assert.equal(R.officeDeliverySummary([queued(1, 10), sent(1, 10)], 10).onTheWay, 0, 'a reprint of sent labels is not counted twice');
  assert.equal(R.officeDeliverySummary([{ from: 1, to: 10, state: 'resolved', requestId: 'r' }], 10).failed.length, 0, 'a checked part is no longer failed');
}

// --- Suggestions never run into work the server would refuse ----------------
assert.equal(R.firstUnsentLabel([], 120, 40), 41, 'starts after labels printed anywhere');
assert.equal(R.firstUnsentLabel([queued(41, 60)], 120, 40), 61, 'and after work already queued');
assert.equal(R.firstUnsentLabel([rejected(1, 50)], 300), 51, 'failed work goes again as a reprint, not a new send');
assert.equal(R.firstUnsentLabel([{ from: 1, to: 50, state: 'cancelled' }], 300), 1, 'cancelled work is free to send');
assert.equal(R.firstUnsentLabel([sent(1, 120)], 120, 0), null);
assert.deepEqual(R.suggestOfficeRange([queued(70, 80)], 120, 40), { from: 41, to: 69 }, 'stops before the next office range');
assert.deepEqual(R.suggestOfficeRange([], 50000, 0, 3000), { from: 1, to: 3000 }, 'capped to one safe send');
assert.deepEqual(R.suggestOfficeRange([sent(1, 3000)], 50000, 0, 3000), { from: 3001, to: 6000 }, '"Send next N" continues from there');
assert.equal(R.suggestOfficeRange([sent(1, 10)], 10, 0, 5), null);

// --- Overlap: new send, automatic reprint, or wait ---------------------------
assert.deepEqual(R.officeSendPlan([sent(1, 50)], 51, 100), { kind: 'new' });
assert.deepEqual(R.officeSendPlan([sent(1, 50)], 1, 20), { kind: 'reprint', reprintOf: 'req-sent', overlap: { from: 1, to: 20 } }, '"Print some labels again" goes as a reprint');
assert.deepEqual(R.officeSendPlan([sent(1, 50)], 40, 80), { kind: 'reprint', reprintOf: 'req-sent', overlap: { from: 40, to: 50 } });
assert.equal(R.officeSendPlan([{ from: 1, to: 50, state: 'resolved', requestId: 'r1' }], 1, 50).kind, 'reprint', 'a checked failure is reprinted');
assert.deepEqual(R.officeSendPlan([queued(1, 50)], 10, 20), { kind: 'wait', why: 'on-its-way', overlap: { from: 10, to: 20 } }, 'never offer a send the server refuses');
assert.equal(R.officeSendPlan([rejected(1, 50)], 1, 50).why, 'needs-check', 'a failed part must be checked before reprinting');
assert.equal(R.officeSendPlan([{ from: 1, to: 50, state: 'cancelled' }], 1, 50).kind, 'new');
assert.equal(R.rangeOverlapsQueued([{ from: 1, to: 10, state: 'needs_review' }], 1, 10), true);
assert.deepEqual(R.officeLabelsIn([sent(1, 20), queued(21, 30)], 15, 40), { from: 15, to: 30, sent: true }, 'local printing asks before printing these again');
assert.equal(R.officeLabelsIn([rejected(1, 20)], 1, 20), null, 'failed labels are not "already at the office"');

// --- Big runs: size estimated from a few labels, before the long check -------
assert.equal(R.officeSendCap([300], 1, false), 10000, 'small labels: the 10,000-label limit');
const big = R.officeSendCap([20000], 1, false);
assert.ok(big * (20000 * 1.1 + 40) <= R.OFFICE_MAX_BYTES * 0.8, 'large labels stay well under 32 MiB');
assert.ok(big >= 1000 && big % 100 === 0, 'a tidy number');
assert.equal(R.officeSendCap([300], 1, true), 500, 'bitmap labels: a chunk the server can draw in time');
assert.equal(R.officeSendCap([300000], 2, false) % 2, 0, 'whole feeds on multi-across rolls');
assert.equal(R.capAfterSizeError('Labels 1601–1608: Selected range exceeds 32 MiB; select a smaller range', 1), 1440);
assert.equal(R.capAfterSizeError('Some other problem', 1), null);

// --- Skipped labels ---------------------------------------------------------
assert.deepEqual(R.skippedLabels(10, 15), { from: 11, to: 14 });
assert.equal(R.skippedLabels(10, 11), null);
assert.equal(R.skippedLabels(10, 5), null);

// --- Uncertain vs refused (M3) ----------------------------------------------
for (const status of [400, 404, 409, 413]) assert.equal(O.officeFailureKind(status), 'refused', `${status} is refused before queuing`);
for (const status of [401, 403, 408, 429, 500, 502, 503, undefined]) assert.equal(O.officeFailureKind(status), 'uncertain', `${status} keeps the saved request`);
assert.equal(O.keepPendingAfter('refused'), false, 'a refused request is not offered for resend');
assert.equal(O.keepPendingAfter('uncertain'), true, 'an unknown outcome keeps the same request and key');
assert.equal(O.uncertainSendWords(401).cause, 'signed-out');
assert.equal(O.uncertainSendWords(403, 'origin_not_allowed').cause, 'address');
assert.equal(O.uncertainSendWords(403).cause, 'no-access');
assert.equal(O.uncertainSendWords(429).cause, 'busy');
assert.match(O.uncertainSendWords(undefined).message, /same request, so it won’t print twice/);
for (const status of [401, 403, 429, undefined]) assert.match(O.uncertainSendWords(status).message, /Send again/);

const pairing = O.plainOfficeRefusal('Office Pi is awaiting verified pairing. Job creation is disabled.', 409);
assert.equal(pairing.reason, 'not-paired');
assert.doesNotMatch(pairing.message, /Office Pi|Job creation/);
assert.equal(O.plainOfficeRefusal('Check printer before retrying', 409).reason, 'needs-review');
assert.equal(O.plainOfficeRefusal('Resolve pending original jobs before reprinting', 409).reason, 'reprint-pending');
assert.equal(O.plainOfficeRefusal('This range has already been queued. Use Reprint to print this range again.', 409).reason, 'already-queued');
assert.equal(O.plainOfficeRefusal('The saved run/design changed or its bitmap proof is missing. Prepare the proof again before printing.', 409).reason, 'labels-changed');
const odd = O.plainOfficeRefusal('relation "office_jobs" violates constraint', 400);
assert.equal(odd.reason, 'other');
assert.doesNotMatch(odd.message, /relation|constraint|office_jobs/, 'raw server text never shown');

// Saved refusals expire and never override live status.
{
  const now = Date.parse('2026-11-10T12:00:00Z');
  const ready = { online: true, available: true, dispatch_enabled: true, paired_at: 't', needs_review: false };
  const rec = (reason, minutesAgo) => ({ from: 1, to: 5, reason, message: 'x', at: new Date(now - minutesAgo * 60000).toISOString() });
  assert.equal(O.refusalStillApplies(rec('other', 1), ready, now), true);
  assert.equal(O.refusalStillApplies(rec('other', 31), ready, now), false, 'expires after a short time');
  assert.equal(O.refusalStillApplies(rec('not-paired', 1), ready, now), false, 'pairing finished: live status wins');
  assert.equal(O.refusalStillApplies(rec('not-paired', 1), { ...ready, paired_at: null }, now), true);
  assert.equal(O.refusalStillApplies(rec('needs-review', 1), ready, now), false, 'check done: live status wins');
  assert.equal(O.refusalStillApplies({ ...rec('other', 0), at: 'garbage' }, ready, now), false);
  assert.equal(O.refusalStillApplies(null, ready, now), false);
  assert.equal(O.officePrinterReadiness(ready).tone, 'ok');
  assert.equal(O.officePrinterReadiness.length, 1, 'readiness reads live status only');
  assert.equal(O.officePrinterReadiness({ ...ready, dispatch_enabled: false }).canSend, false);
  assert.equal(O.officePrinterReadiness({ ...ready, needs_review: true }).canSend, false);
  assert.equal(O.officePrinterReadiness(undefined).canSend, false);
}
assert.deepEqual(O.readRefusal(JSON.stringify({ from: 1, to: 20, reason: 'not-paired', message: 'x', at: 't' })), { from: 1, to: 20, reason: 'not-paired', message: 'x', at: 't' });
assert.equal(O.readRefusal('{bad'), null);

// Failed parts in plain words.
assert.equal(O.plainJobReason('media out'), 'the printer is out of labels');
assert.equal(O.plainJobReason('CUPS: ribbon out'), 'the printer is out of ribbon');
assert.equal(O.plainJobReason('station_outcome_timeout'), 'the office computer didn’t confirm it in time');
assert.equal(O.plainJobReason('ipp-error 0x0507 printer-state-reasons=weird'), 'the office printer reported a problem', 'unknown codes never shown raw');
assert.equal(O.plainJobReason(null), 'the office printer reported a problem');

// Pause/Resume: a definite refusal clears the saved control, anything unsure keeps it.
for (const status of [400, 401, 403, 404, 409]) assert.equal(O.controlFailure(status).keep, false, `control ${status}`);
for (const status of [408, 429, 500, 503, undefined]) assert.equal(O.controlFailure(status).keep, true, `control ${status}`);
assert.match(O.controlFailure(403).message, /Ask your admin/);
assert.doesNotMatch(O.controlFailure(403).message, /permission required/i);

// --- Header and list wording --------------------------------------------------
{
  const run = (status, printedCount, totalLabels = 100) => ({ status, printedCount, totalLabels });
  assert.equal(runDisplayStatus(run('queued', 0), { sent: 0, onTheWay: 20, failed: 0 }).label, 'Sending to office printer', 'never "Ready to print" while printing');
  assert.equal(runDisplayStatus(run('queued', 0), { sent: 100, onTheWay: 0, failed: 0 }).label, 'Sent to office printer', '"Sent", not "Printed"');
  assert.equal(runDisplayStatus(run('queued', 0), { sent: 20, onTheWay: 0, failed: 0 }).label, 'Partly sent');
  assert.equal(runDisplayStatus(run('queued', 0), { sent: 20, onTheWay: 0, failed: 1 }).label, 'Office print needs a check');
  assert.equal(runDisplayStatus(run('queued', 0), null).label, 'Ready to print');
  assert.equal(runDisplayStatus(run('printing', 10), null).label, 'Printing');
  assert.equal(runDisplayStatus(run('paused', 100), { sent: 100, onTheWay: 0, failed: 0 }).label, 'Done');
  assert.equal(runDisplayStatus(run('cancelled', 10), { sent: 0, onTheWay: 5, failed: 0 }).label, 'Cancelled');
  assert.equal(officeSentLine({ sent: 20, onTheWay: 30, failed: 0 }, 100), 'Sent to office printer: 20 of 100 · 30 on the way');
  assert.equal(officeSentLine({ sent: 0, onTheWay: 0, failed: 0 }, 100), null);
  assert.equal(officeSentLine(null, 100), null);
}

// --- The office panel's request contract is unchanged ------------------------
// Same endpoint and method, same payload keys (new-job or reprint shape), the
// idempotency key saved before the POST, and one POST per tap.
{
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/runs/OfficePiPrinter.tsx'), 'utf8');
  const payload = src.match(/payload=\{(runId,stationId[^\n]*?)\};/);
  assert.ok(payload, 'payload literal found');
  const keys = [...payload[1].matchAll(/(?:^|,|\{)\s*(?:\.\.\.\(\w+\?\{)?(\w+):/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(['runId', ...keys])].sort(), ['expectedBitmapDigest', 'from', 'idempotencyKey', 'printerId', 'reprintOf', 'runId', 'stationId', 'to'].sort());
  assert.doesNotMatch(payload[1], /reason/, 'no new payload key');
  const save = src.indexOf('localStorage.setItem(storageKey,JSON.stringify(payload))');
  const post = src.indexOf("api('/api/office/jobs',{method:'POST'");
  assert.ok(save > 0 && post > save, 'idempotency key saved before the POST');
  assert.equal(src.split("api('/api/office/jobs',{method:'POST'").length - 1, 1, 'one POST site: one tap, one job request');
  assert.match(src, /if\(bitmap && proof\?\.key!==currentProofKey\.current\)return;/, 'the label check (proof) still gates a new send');
  assert.match(src, /plan\.kind==='wait' \|\| tooBig\)return;/, 'never sends what the server would refuse');
  assert.doesNotMatch(src, /officeProgressUpdate|onOfficeProgress/, 'no automatic progress writes');
}
console.log('PASS office: no automatic progress (explicit Mark printed only), failed parts named with reasons, overlap -> reprint or wait, safe send size, uncertain keeps the request, refusals expire, plain words, unchanged request contract');

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
