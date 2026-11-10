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
  assert.deepEqual(s.failed[0], { from: 81, to: 120, reason: 'media out', requestId: 'req-bad', jobIds: ['job-81', 'job-101'], didNotPrint: true, kind: 'did-not-print' });
  assert.equal(s.failedLabels, 40, 'counted in labels');
  const unsure = R.officeDeliverySummary([{ from: 1, to: 10, state: 'claimed', review: true, requestId: 'r', id: 'j' }], 10);
  assert.equal(unsure.failed[0].didNotPrint, false, 'a part the office never confirmed may have printed');
  assert.equal(unsure.onTheWay, 0, 'and is not "on the way" any more');
  assert.equal(R.officeDeliverySummary([queued(1, 10), sent(1, 10)], 10).onTheWay, 0, 'a reprint of sent labels is not counted twice');
  assert.deepEqual(R.officeDeliverySummary([{ from: 1, to: 10, state: 'resolved', requestId: 'r' }], 10).failed.map((f) => f.kind), ['print-again'], 'a checked part no longer needs a check, but still needs printing (or counting)');
}

// --- Failed parts: one line per state, counted in labels ---------------------
{
  // 51–100 rejected (out of labels), 101–150 never confirmed: two parts, not one.
  const jobs = [sent(1, 50), rejected(51, 75), rejected(76, 100, { id: 'job-76' }), { from: 101, to: 125, state: 'submitted', review: true, reason: 'station_outcome_timeout', requestId: 'req-bad', id: 'job-101' }, { from: 126, to: 150, state: 'claimed', review: true, reason: 'station_outcome_timeout', requestId: 'req-bad', id: 'job-126' }];
  const s = R.officeDeliverySummary(jobs, 200);
  assert.deepEqual(s.failed.map((f) => [f.from, f.to, f.kind]), [[51, 100, 'did-not-print'], [101, 150, 'needs-check']], 'each part separately and correctly');
  assert.equal(s.failedLabels, 100, 'labels, not requests');
  assert.deepEqual(s.failed[1].jobIds, ['job-101', 'job-126']);
  // Different causes stay apart even in one send.
  const two = R.officeDeliverySummary([rejected(1, 25), rejected(26, 50, { reason: 'ribbon out', id: 'j2' })], 50);
  assert.equal(two.failed.length, 2);
}
// --- Checked off but not printed again: shown, never "all sent" (code #2) ---
{
  const resolved = (from, to) => ({ from, to, state: 'resolved', requestId: 'req-a', id: 'res-' + from });
  const s = R.officeDeliverySummary([sent(1, 25), resolved(26, 50), sent(51, 300)], 300);
  assert.deepEqual(s.failed.map((f) => [f.from, f.to, f.kind, f.requestId]), [[26, 50, 'print-again', 'req-a']]);
  assert.equal(R.officeDeliverySummary([sent(1, 25), resolved(26, 50), { from: 26, to: 50, state: 'sent_to_printer', requestId: 'r2' }], 50).failed.length, 0, 'printed again: done');
  assert.equal(R.officeDeliverySummary([sent(1, 25), resolved(26, 50), { from: 26, to: 50, state: 'queued', requestId: 'r2' }], 50).failed.length, 0, 'reprint on its way');
  assert.equal(R.officeDeliverySummary([sent(1, 25), resolved(26, 50)], 50, { printedSpans: [{ from: 26, to: 50 }] }).failed.length, 0, 'a person said they printed');
  assert.equal(R.officeDeliverySummary([resolved(26, 50)], 50, { printedCount: 50 }).failed.length, 0, 'already counted as printed');
  assert.deepEqual(R.officeDeliverySummary([resolved(26, 50)], 50, { printedCount: 30 }).failed.map((f) => [f.from, f.to]), [[31, 50]]);
  assert.equal(R.officeDeliverySummary([{ from: 1, to: 50, state: 'cancelled' }], 50).failed.length, 0, 'cancelled before sending is just unsent');
}
// --- Mark every sent stretch, not just the first (B3) -----------------------
{
  const plan = R.officeMarkPlan(0, [sent(1, 50), rejected(51, 100), sent(101, 150)], [], 2000);
  assert.deepEqual(plan.ranges, [{ from: 1, to: 50 }, { from: 101, to: 150 }]);
  assert.equal(plan.through, 50, 'progress only moves through an unbroken stretch');
  // Once 51–100 is confirmed (they printed, or reprinted and marked), progress reaches 150.
  assert.equal(R.officeMarkPlan(50, [sent(1, 50), sent(101, 150)], [{ from: 51, to: 100 }, { from: 101, to: 150 }], 2000).through, 150);
  assert.deepEqual(R.officeMarkPlan(50, [sent(1, 50), sent(101, 150)], [{ from: 51, to: 100 }, { from: 101, to: 150 }], 2000).ranges, [], 'confirmed stretches are not offered again');
  assert.deepEqual(R.officeMarkPlan(20, [sent(1, 50)], [], 50), { ranges: [{ from: 21, to: 50 }], through: 50 });
  assert.deepEqual(R.officeMarkPlan(0, [sent(1, 10, { review: true })], [], 50).ranges, [], 'a part that needs a check is not offered');
  assert.equal(R.extendThrough(10, [{ from: 12, to: 20 }]), 10);
  assert.equal(R.extendThrough(10, [{ from: 11, to: 20 }, { from: 21, to: 30 }]), 30);
  assert.equal(R.spanWords([{ from: 1, to: 50 }, { from: 101, to: 150 }]), 'labels 1–50 and 101–150');
  assert.equal(R.spanWords([{ from: 7, to: 7 }]), 'label 7');
  assert.equal(R.spanWords([{ from: 101, to: 125 }, { from: 76, to: 100 }, { from: 126, to: 150 }]), 'labels 76–150');
}
// --- Big runs: one explicit multi-part send, whole feeds at every boundary --
{
  assert.deepEqual(R.officeSendParts(1, 2000, 500, 1).map((p) => [p.from, p.to]), [[1, 500], [501, 1000], [1001, 1500], [1501, 2000]]);
  const three = R.officeSendParts(1, 2000, R.officeSendCap([300], 3, true), 3);
  assert.ok(three.slice(0, -1).every((p) => p.to % 3 === 0), '3-across: every part ends on a whole row');
  assert.ok(three.every((p) => p.to - p.from + 1 <= 500));
  assert.equal(three[three.length - 1].to, 2000);
  const mid = R.officeSendParts(5, 2000, 498, 3);
  assert.equal(mid[0].to % 3, 0, 'a start mid-row ends its first part on a row boundary');
  assert.equal(mid[1].from % 3, 1, 'later parts start a new row');
  assert.deepEqual(R.officeSendParts(1, 10, 500, 1), [{ from: 1, to: 10 }]);
  assert.equal(R.officeSendCap([300], 3, true) % 3, 0, 'send size is whole rows (code #7)');
  assert.equal(R.officeSendCap([300], 3, true), 498);
  assert.equal(R.capAfterSizeError('Labels 1601–1608: Selected range exceeds 32 MiB; select a smaller range', 1, 3) % 3, 0);
  const plan = { stationId: 's', printerId: 'p', parts: [{ from: 1, to: 500 }, { from: 501, to: 1000 }], next: 1, at: 't' };
  assert.deepEqual(R.readPartsPlan(JSON.stringify(plan)), plan);
  assert.deepEqual(R.remainingParts(R.readPartsPlan(JSON.stringify(plan))), [{ from: 501, to: 1000 }], 'reopening offers the remaining parts');
  assert.equal(R.readPartsPlan('{bad'), null);
  assert.equal(R.readPartsPlan(JSON.stringify({ ...plan, next: 9 })), null);
  assert.equal(R.readPartsPlan(JSON.stringify({ ...plan, parts: [{ from: 5, to: 1 }] })), null);
  assert.deepEqual(R.remainingParts(null), []);
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
assert.equal(O.sendKeepsRequest(403, undefined, false), false, 'a first try refused for print access queued nothing');
assert.equal(O.sendKeepsRequest(401, undefined, false), false, 'a first try while signed out queued nothing');
assert.equal(O.sendKeepsRequest(403, undefined, true), true, 'a resend refused for access keeps the request: an earlier try may have arrived');
assert.equal(O.sendKeepsRequest(403, 'origin_not_allowed', false), true, 'the wrong address keeps the request and its own words');
assert.equal(O.sendKeepsRequest(undefined, undefined, false), true, 'no answer keeps the request');
assert.equal(O.sendKeepsRequest(409, undefined, true), false, 'a definite refusal clears it');
assert.equal(O.uncertainSendWords(401).cause, 'signed-out');
assert.equal(O.uncertainSendWords(403, 'origin_not_allowed').cause, 'address');
assert.equal(O.uncertainSendWords(403).cause, 'no-access');
assert.equal(O.uncertainSendWords(429).cause, 'busy');
assert.match(O.uncertainSendWords(undefined).message, /same request, so it won’t print twice/);
assert.match(O.uncertainSendWords(undefined).message, /connection dropped/);
assert.match(O.uncertainSendWords(503).message, /^The server had a problem/);
assert.doesNotMatch(O.uncertainSendWords(503).message, /503|Service/);
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

// --- One printer status line: never "Ready" while stopped or paused ---------
{
  const p = { online: true, available: true, dispatch_enabled: true, paired_at: 't', needs_review: false, dispatch_hold_reason: null, review_holds: [] };
  assert.equal(O.officeStatusLine(p).text, 'Ready');
  const paused = O.officeStatusLine({ ...p, dispatch_hold_reason: 'printer_paused' });
  assert.equal(paused.paused, true);assert.equal(paused.tone, 'warn');assert.match(paused.text, /Paused/);assert.doesNotMatch(paused.text, /Ready/);assert.equal(paused.canSend, true, 'sends still queue');
  const held = O.officeStatusLine({ ...p, needs_review: true, review_holds: [{ run_id: 'run-a', run_name: 'Run A stalls', from: 26, to: 50 }] }, 'run-b');
  assert.equal(held.stopped, true);assert.equal(held.canSend, false);assert.equal(held.tone, 'bad');
  assert.equal(held.text, 'Stopped: labels 26–50 of “Run A stalls” need a check.');assert.equal(held.hold.run_id, 'run-a');
  const mine = O.officeStatusLine({ ...p, needs_review: true, review_holds: [{ run_id: 'run-a', run_name: 'Run A', from: 26, to: 50 }] }, 'run-a');
  assert.match(mine.text, /of this run/);
  assert.match(O.officeStatusLine({ ...p, needs_review: true }).text, /needs a check/, 'names the problem even without details');
  assert.match(O.officeStatusLine({ ...p, dispatch_hold_reason: 'control_pending' }).text, /confirm/);
  assert.match(O.officeStatusLine({ ...p, online: false }).text, /offline/);
  // After a send: never "the office keeps going" while paused or stopped.
  assert.match(O.queuedNotice('Labels 1–20', false, paused), /paused, so nothing prints until someone taps Resume/);
  assert.doesNotMatch(O.queuedNotice('Labels 1–20', false, paused), /keeps going/);
  assert.doesNotMatch(O.queuedNotice('Labels 1–20', false, held), /keeps going/);
  assert.match(O.queuedNotice('Labels 1–20', false, O.officeStatusLine(p)), /keeps going/);
  assert.equal(O.refusalNeedsSomeoneElse('no-access'), true, 'no "Try again" for a refusal only an admin can fix');
  assert.equal(O.refusalNeedsSomeoneElse('already-queued'), false);
  assert.deepEqual(O.readPendingMeta(JSON.stringify({ status: 503 })), { status: 503 }, 'the "not sure" cause survives a refresh');
  assert.equal(O.uncertainSendWords(O.readPendingMeta(JSON.stringify({ status: 503 })).status).message, O.uncertainSendWords(503).message);
  assert.deepEqual(O.readPendingMeta('nope'), {});
}

// --- Header and list wording --------------------------------------------------
{
  const run = (status, printedCount, totalLabels = 100) => ({ status, printedCount, totalLabels });
  { const s = runDisplayStatus(run('queued', 0), { sent: 0, onTheWay: 20, failed: 0 }); assert.equal(s.label, 'Printing', 'never "Ready" while printing'); assert.equal(s.detail, 'Sending to the office printer'); }
  { const s = runDisplayStatus(run('queued', 0), { sent: 100, onTheWay: 0, failed: 0 }); assert.equal(s.label, 'Needs you', 'sent is not printed: someone confirms'); assert.match(s.detail, /^Sent to the office printer/); }
  assert.equal(runDisplayStatus(run('queued', 0), { sent: 20, onTheWay: 0, failed: 0 }).detail, 'Partly sent');
  { const s = runDisplayStatus(run('queued', 0), { sent: 20, onTheWay: 0, failed: 1 }); assert.equal(s.label, 'Needs you'); assert.equal(s.detail, 'Office print needs a check'); }
  assert.equal(runDisplayStatus(run('queued', 0), null).label, 'Ready');
  assert.equal(runDisplayStatus(run('printing', 10), null).label, 'Printing');
  assert.equal(runDisplayStatus(run('paused', 100), { sent: 100, onTheWay: 0, failed: 0 }).label, 'Done');
  assert.equal(runDisplayStatus(run('cancelled', 10), { sent: 0, onTheWay: 5, failed: 0 }).label, 'Cancelled');
  assert.equal(officeSentLine({ sent: 20, onTheWay: 30, failed: 0 }, 100), 'Sent to office printer: 20 of 100 · 30 on the way');
  assert.equal(officeSentLine({ sent: 20, onTheWay: 30, failed: 1 }, 100), 'Sent to office printer: 20 of 100 · 30 waiting', 'held labels are not on their way');
  assert.equal(officeSentLine({ sent: 0, onTheWay: 20, failed: 0, held: true }, 20), 'Sent to office printer: 0 of 20 · 20 waiting', 'paused printer: waiting');
  assert.equal(runDisplayStatus({ status: 'printing', printedCount: 0, totalLabels: 20 }, { sent: 0, onTheWay: 20, failed: 0, held: true }).detail, 'Waiting for the office printer');
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

// --- Round 4: the office panel, run page and Runs list follow the rules ------
{
  // Labels still at the office (queued or picked up), merged, minus sent ones.
  const jobs = [
    { from: 1, to: 50, state: 'sent_to_printer' }, { from: 51, to: 75, state: 'rejected', review: true },
    { from: 76, to: 100, state: 'queued' }, { from: 101, to: 150, state: 'queued' }, { from: 151, to: 160, state: 'claimed', review: true },
  ];
  assert.deepEqual(R.officeWaitingSpans(jobs, 200), [{ from: 76, to: 150 }], 'held labels are named as one stretch; a part that needs a check is not "waiting"');
  assert.equal(R.spanWords(R.officeWaitingSpans(jobs, 200)), 'labels 76–150');

  const { runDisplayStatus } = require('../../src/lib/runDisplayStatus.ts');
  const run = { status: 'queued', printedCount: 0, totalLabels: 100 };
  assert.equal(runDisplayStatus(run, { sent: 50, onTheWay: 0, failed: 1, firstFailed: { kind: 'print-again' } }).detail, 'Labels to print again', 'a checked-off part that never printed again is named');
  assert.equal(runDisplayStatus(run, { sent: 50, onTheWay: 0, failed: 1, firstFailed: { kind: 'did-not-print' } }).detail, 'Office print needs a check');

  const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
  const panel = read('src/components/runs/OfficePiPrinter.tsx');
  // A failed storage write is said, not silent, and nothing is sent.
  assert.match(panel, /try\{localStorage\.setItem\(storageKey,JSON\.stringify\(payload\)\);\}\s*catch\{setError\('This device can’t save the request, so it wasn’t sent/, 'a failed save stops the send and says so');
  // "Send again" reuses the saved key whatever the printer says (the server answers a saved key first).
  assert.match(panel, /const disabled=pending\?busy:/, '"Send again" is only disabled while busy');
  // The reason for "not sure" is kept beside the saved request, so a refresh says the same.
  assert.match(panel, /localStorage\.setItem\(metaKey,JSON\.stringify\(meta\)\)/);
  assert.match(panel, /readPendingMeta\(meta\)/);
  // No "Try again" after a refusal only someone else can fix.
  assert.match(panel, /noAccess\?'Ask your admin for print access\.'/);
  assert.match(panel, /:shownRefusal && !noAccess\?'refusal'/, 'no primary button after a no-access refusal');
  // Nothing new is sent before one read of the office queue succeeded.
  assert.match(panel, /if\(!printAllowed \|\| !requestsEverLoaded\)return;/);
  // A multi-part send is one explicit tap, and each part goes through the one POST site with its own saved key.
  assert.match(panel, /`Send all \$\{sendCount\.toLocaleString\(\)\} in \$\{parts\.length\} parts`/);
  assert.match(panel, /const outcome=await submit\(part\);\s*if\(outcome!=='sent'\)break;/, 'parts go one after another and stop at the first one not clearly queued');
  assert.match(panel, /if\(bitmap && proof\?\.key!==keyOf\(want\.from,want\.to\)\)return;/, 'each part needs its own label check');
  // An unsure part resends its own saved request (same key); a part already queued is skipped, never sent twice.
  assert.match(panel, /if\(direct \|\| payload\.from!==want\.from \|\| payload\.to!==want\.to\)\{/, 'a part, the form or a one-tap send never sends another range\'s saved request');
  assert.match(panel, /if\(!resend && officeSendPlan\(jobsRef\.current,part\.from,part\.to\)\.kind!=='new'\)\{current=\{\.\.\.current,next:i\+1\};savePartsPlan\(current\);continue;\}/);
  assert.match(panel, /if\(pending && pendingInPlan && partsPlan\)\{void runSeries\(partsPlan\);return;\}/, '"Send again" on an unsure part carries on with the plan');
  // Fixing a part: later parts are held before the check lets the office carry on; a 409 means already checked.
  const save = panel.slice(panel.indexOf('const saveFix='), panel.indexOf('const pendingWords='));
  assert.ok(save.indexOf("method:'DELETE'") > 0 && save.indexOf("method:'DELETE'") < save.indexOf("'/api/office/review'"), 'hold the rest before recording the check');
  assert.match(save, /err\.status===409/, 'already checked counts as done');
  assert.match(save, /\['resolved','cancelled','sent_to_printer'\]\.includes\(job\.state\)\)continue;/, 'a fresh read skips parts already checked');
  assert.match(save, /onRecordPrinted\?\.\(/, '"They printed" counts them only on that explicit choice');
  // "Print some labels again" starts empty.
  assert.match(panel, /Print some labels again…/);
  assert.match(panel, /const openAgain=\(mode:Again\['mode'\],requestId\?:string\)=>\{setAgain\(\{mode,text:'',queue:\[\],requestId\}\);/, 'choosing labels again starts with an empty box (never prefilled, also in a queue row)');
  assert.ok((panel.match(/openAgain\('(again|missing)'/g) || []).length >= 4, 'every "print again" opens the same one box');
  assert.match(panel, /const showForm=!!pending \|\| \(!again && /, 'only one range editor at a time');
  assert.match(panel, /const outcome=await sendNow\(againNext,current\.requestId,true\);/, 'one press checks and sends one stretch');

  const page = read('src/components/runs/RunPrinter.tsx');
  assert.match(page, /confirmLabel: `Start at \$\{skipped\.from\} instead`,\s*altLabel: 'Skip and count as printed'/, 'the safe start is the primary button');
  assert.match(page, /confirmLabel: `Keep progress at \$\{printedCount\}`,\s*altLabel: 'Count them too'/, 'keeping progress honest is the primary button');
  assert.match(page, /resetProgress: true, expectedPrintedCount: before/, 'a rewind says which count it expects');
  assert.match(page, /\.\.\.\(plan\.rewind \? \{ expectedPrintedCount: printedCount \} : \{\}\)/);
  assert.doesNotMatch(page, /label: 'Scan mode'/, 'scan mode is not offered in the menu where it cannot work');
  assert.match(page, /officeMarkPlan\(/, 'mark printed offers every sent stretch');

  // The run header never says "Sending" while the office printer is paused or held.
  {
    const { officePrinterHeld } = require('../../src/components/runs/useOfficeHeld.ts');
    const base = { online: true, available: true, dispatch_enabled: true, paired_at: '2026-01-01', needs_review: false };
    assert.equal(officePrinterHeld([{ ...base, dispatch_hold_reason: 'printer_paused' }]), true, 'paused');
    assert.equal(officePrinterHeld([{ ...base, needs_review: true, review_holds: [{ run_id: 'x', from: 1, to: 2 }] }]), true, 'stopped for a check');
    assert.equal(officePrinterHeld([base]), false, 'ready');
    assert.equal(officePrinterHeld([]), false, 'no printer');
    assert.match(page, /firstFailed: office\.summary\.failed\[0\], held: officeHeld \}/, 'the run header gets the station status');
    assert.match(page, /onHeldChange=\{setPanelHeld\}/, 'lifted from the office panel');
    assert.match(panel, /useEffect\(\(\)=>\{onHeldChange\?\.\(printerHeld,heldById\?\{runId:heldById,runName:heldByName\}:null\);\}/, 'the header also learns which other run holds the printer');
  }
  // Designer test print: a first send refused as signed out / no access queued nothing (plain refusal); a resend keeps its key.
  const preview = read('src/components/designer/OfficePreviewPrint.tsx');
  assert.match(preview, /const resend = !!pending;/);
  assert.match(preview, /if \(!sendKeepsRequest\(status, code, resend\)\) \{/, 'the test print uses the same rule as the run panel');
  assert.ok(preview.indexOf('localStorage.setItem(storageKey, JSON.stringify(payload))') < preview.indexOf("api('/api/office/preview', { method: 'POST'"), 'the key is saved before the POST');
  const controls = read('src/components/runs/OfficePrinterControls.tsx');
  assert.match(controls, /setInterval\(update,pending\|\|busy\?2000:15000\)/, 'controls read fast only while a pause or resume is on its way');
  assert.match(controls, /controlFailure\(r\.status,typeof answer\.code==='string'\?answer\.code:undefined,resend\)/, 'a resend keeps its key when signed out or refused');
  assert.match(controls, /readSavedControl\(/, 'the saved pause/resume is per account');
  {
    // A main tab may still be retrying the device-wide request with its key:
    // it is copied to the account's key, and removed only once that same request settles.
    const P = require('../../src/lib/officeControlPending.ts');
    assert.equal(P.controlPendingKey('u1'), 'lw:office-control-pending:u1');
    const mem = new Map();
    const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
    const old = JSON.stringify({ action: 'pause', idempotencyKey: 'k-old' });
    mem.set(P.LEGACY_KEY, old);
    assert.equal(P.readSavedControl(store, 'u1'), old);
    assert.equal(mem.get(P.LEGACY_KEY), old, 'the old build still finds its request');
    assert.equal(mem.get('lw:office-control-pending:u1'), old);
    P.clearSavedControl(store, 'u1');
    assert.equal(mem.size, 0, 'settled: both copies go');
    // A different request saved later by an old tab is left alone.
    mem.set(P.LEGACY_KEY, JSON.stringify({ action: 'resume', idempotencyKey: 'k-main' }));
    mem.set('lw:office-control-pending:u1', JSON.stringify({ action: 'pause', idempotencyKey: 'k-new' }));
    P.clearSavedControl(store, 'u1');
    assert.deepEqual([...mem.keys()], [P.LEGACY_KEY]);
    assert.equal(controls.indexOf("localStorage.setItem(key,JSON.stringify(payload))") < controls.indexOf("fetch('/api/office/controls',{method:'POST'"), true, 'saved before the POST');
  }

  // A parts series never stops silently, and Start over drops the unsure part from a saved plan.
  {
    const pi = read('src/components/runs/OfficePiPrinter.tsx');
    assert.match(pi, /if\(!checked\)\{setError\(e=>e \|\| `Stopped before part \$\{i\+1\} of \$\{current\.parts\.length\}: the labels changed while sending\. Check the preview, then send the remaining parts\.`\);break;\}/);
    const over = pi.slice(pi.indexOf('const startOver=async'), pi.indexOf('const act=async'));
    assert.match(over, /if\(pendingInPlan && partsPlan\)savePartsPlan\(\{\.\.\.partsPlan,next:partsPlan\.next\+1\}\);/);
    assert.ok(over.indexOf('confirmDialog') < over.indexOf('savePartsPlan'), 'only after the person confirms');
  }
  // Another run on the same page starts empty, and a late answer for the last run is dropped.
  const officeHook = read('src/components/runs/useOfficeRequests.ts');
  assert.match(officeHook, /if \(shownRun !== runId\) \{\n\s+setShownRun\(runId\);\n\s+setRequests\(\[\]\); setAllJobs\(null\); setTruncated\(false\); setLoaded\(false\); setEverLoaded\(false\); setFailed\(null\);/);
  assert.match(officeHook, /if \(currentRun\.current !== runId\) return;/);
  assert.doesNotMatch(officeHook, /active\.current = true/, 'no shared flag that a new run turns back on');

  const list = read('src/app/runs/page.tsx');
  assert.doesNotMatch(list, /Otherwise it’s deleted for good/, 'the delete dialog says the one case that applies');
  assert.match(list, /moving \? 5000 : 15000/, 'the Runs list reads faster only while labels are on their way');
  assert.match(list, /Mark sent labels as printed/, 'bulk mark printed on the Runs list');
  const feedback = read('src/components/ui/feedback.tsx');
  assert.match(feedback, /resolve\(outcome === 'dismiss' \? null : outcome\)/, 'closing a choice dialog picks neither choice');
}
// --- Finding 9: marking office labels printed never pauses a run another device is printing ---
{
  const read = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
  assert.equal(R.statusAfterMarkPrinted('printing', 10, 100), null, 'printing elsewhere: status left alone, progress only');
  assert.equal(R.statusAfterMarkPrinted('paused', 10, 100), 'paused');
  assert.equal(R.statusAfterMarkPrinted('pending', 10, 100), 'paused');
  assert.equal(R.statusAfterMarkPrinted(undefined, 10, 100), 'paused');
  assert.equal(R.statusAfterMarkPrinted('printing', 100, 100), 'completed', 'every label counted completes the run');
  assert.equal(R.statusAfterMarkPrinted('paused', 120, 100), 'completed');
  const store = read('src/lib/runStore.ts');
  assert.match(store, /recordPrinted: async \(id, printedCount, status, options\) => \{\n\s+if \(status\) return get\(\)\.setRunStatus\(id, status, printedCount, options\);\n\s+const run = await updateRunWithQueue\(id, \{ printedCount \}, options\?\.onSetAside\);/, 'no status: a progress-only (high-water) write');
  const queue = read('src/lib/offlineQueue.ts');
  assert.match(queue, /progressOnly: !patch\.status && patch\.printedCount !== undefined/, 'a patch without a status is sent as a high-water write');
  const printer = read('src/components/runs/RunPrinter.tsx');
  assert.match(printer, /statusAfterMarkPrinted\(statusRef\.current === 'running' \? 'printing' : run\.status, through, total\)/);
  assert.match(printer, /await recordPrinted\(run\.id, through, nextStatus,/);
  assert.match(printer, /if \(nextStatus\) setStatus\(nextStatus\);/);
  assert.doesNotMatch(printer, /const nextStatus = through >= total \? 'completed' : 'paused'/);
  const list = read('src/app/runs/page.tsx');
  // Bulk "mark printed" re-reads each run first and writes from that fresh copy.
  assert.match(list, /await recordPrinted\(run\.id, through, statusAfterMarkPrinted\(fresh\.status, through, fresh\.totalLabels\),/);
  assert.match(list, /fetch\(`\/api\/runs\/\$\{encodeURIComponent\(run\.id\)\}`, \{ cache: 'no-store' \}\)|fetch\('\/api\/runs\/' \+ encodeURIComponent\(run\.id\), \{ cache: 'no-store' \}\)/);
  assert.doesNotMatch(list, /through >= run\.totalLabels \? 'completed' : 'paused'/);
}
// --- "Which labels?" box: a list of labels, several stretches ---------------
{
  const L = (t, total = 100, cap) => R.parseLabelList(t, total, cap);
  assert.deepEqual(L('5-8, 12').spans, [{ from: 5, to: 8 }, { from: 12, to: 12 }]);
  assert.deepEqual(L('5–8 and 12 to 14').spans, [{ from: 5, to: 8 }, { from: 12, to: 14 }]);
  assert.deepEqual(L('12, 5-8, 9').spans, [{ from: 5, to: 9 }, { from: 12, to: 12 }], 'sorted, touching stretches merged');
  assert.deepEqual(L('1,000-1,002', 2000).spans, [{ from: 1000, to: 1002 }], 'thousands commas are numbers, not lists');
  assert.deepEqual(L('1-10', 100, 4).spans, [{ from: 1, to: 4 }, { from: 5, to: 8 }, { from: 9, to: 10 }], 'split to the send size');
  assert.equal(L('').spans.length, 0);
  assert.equal(L('').error, '', 'empty is not an error');
  assert.match(L('8-5').error, /smaller number first/);
  assert.match(L('0-3').error, /from 1 to 100/);
  assert.match(L('101').error, /from 1 to 100/);
  assert.match(L('five').error, /label numbers only/);
}
console.log('PASS office r4: held labels named, print-again status, storage/send-again/meta/no-access rules, parts one by one, fix holds the rest first, safe primaries, guarded rewinds, quieter polling, plain delete');
