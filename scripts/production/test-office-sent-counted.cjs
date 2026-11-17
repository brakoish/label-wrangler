/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness */
// Office parts the printer took ("sent to printer") count as printed on their
// run: a confirmed history entry per part, progress through every unbroken
// stretch, the run completed once every label counts. Parts that need a check,
// didn't print, or were sent before a "go back" never count. Counting runs
// after the station's reply, so the Pi's protocol and timing are unchanged.
require('../thermal/register.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { officeSentPlan, officeSentEventId, OFFICE_SENT_MESSAGE } = require('../../src/lib/officeSentCounted.ts');

const job = (id, from, to, extra = {}) => ({ id, from, to, state: 'sent_to_printer', review: false, requestAt: '2026-11-10T10:00:00.000Z', ...extra });
const run = (printedCount, total, status = 'queued') => ({ printedCount, total, status });

// Whole run sent: every part counted, run completed.
let plan = officeSentPlan(run(0, 50), [job('a', 1, 25), job('b', 26, 50)], []);
assert.equal(plan.through, 50); assert.equal(plan.status, 'completed'); assert.equal(plan.add.length, 2);
assert.deepEqual(plan.add[0], { id: officeSentEventId('a'), from: 1, to: 25 });

// Part way: progress moves, status left alone.
plan = officeSentPlan(run(0, 100), [job('a', 1, 25)], []);
assert.equal(plan.through, 25); assert.equal(plan.status, null);

// A gap stops progress; the later part is still recorded and counts once the gap is filled.
plan = officeSentPlan(run(0, 100), [job('b', 26, 50)], []);
assert.equal(plan.through, 0); assert.equal(plan.add.length, 1);
const history = [{ id: officeSentEventId('b'), eventType: 'confirmed', output: 'office-pi', rangeFrom: 26, rangeTo: 50, createdAt: '2026-11-10T10:01:00.000Z' }];
plan = officeSentPlan(run(0, 100), [job('a', 1, 25), job('b', 26, 50)], history);
assert.equal(plan.through, 50); assert.deepEqual(plan.add.map((a) => a.id), [officeSentEventId('a')], 'a part already in the history is never added twice');

// Not counted: waiting, needs a check, didn't print, held for review.
for (const other of [job('q', 1, 10, { state: 'queued' }), job('n', 1, 10, { state: 'needs_review' }), job('r', 1, 10, { state: 'rejected' }), job('v', 1, 10, { review: true })]) {
  plan = officeSentPlan(run(0, 10), [other], []);
  assert.equal(plan.through, 0, `${other.id} must not count`); assert.equal(plan.add.length, 0);
}

// Never backwards, never past the run.
plan = officeSentPlan(run(80, 100), [job('a', 1, 25)], []);
assert.equal(plan.through, 80);
plan = officeSentPlan(run(0, 10), [job('a', 1, 25)], []);
assert.equal(plan.through, 10); assert.deepEqual(plan.add[0], { id: officeSentEventId('a'), from: 1, to: 10 });

// A "go back" wins over parts sent before it.
const rewind = { id: 'rw', eventType: 'rewind', output: 'roll-zpl', rangeFrom: 1, rangeTo: 50, createdAt: '2026-11-10T11:00:00.000Z' };
plan = officeSentPlan(run(0, 50), [job('a', 1, 50)], [...history, rewind]);
assert.equal(plan.through, 0); assert.equal(plan.add.length, 0);
plan = officeSentPlan(run(0, 50), [job('a', 1, 50), job('c', 1, 50, { requestAt: '2026-11-10T12:00:00.000Z' })], [rewind]);
assert.equal(plan.through, 50); assert.deepEqual(plan.add.map((a) => a.id), [officeSentEventId('c')]);

// Cancelled and completed runs keep their status; progress still counts.
assert.equal(officeSentPlan(run(0, 10, 'cancelled'), [job('a', 1, 10)], []).status, null);
assert.equal(officeSentPlan(run(0, 10, 'cancelled'), [job('a', 1, 10)], []).through, 10);
assert.equal(officeSentPlan(run(10, 10, 'completed'), [job('a', 1, 10)], []).status, null);

// The history words, and the hook: after the station's answer, only for "sent to printer".
assert.equal(OFFICE_SENT_MESSAGE, 'Printed on the office printer');
const station = fs.readFileSync(path.join(__dirname, '../../src/lib/office/station.ts'), 'utf8');
assert.match(station, /if \(data\.state === 'sent_to_printer'\) countSentLater\(String\(data\.job_id\)\);\n  return result\[0\]\.response;/);
assert.match(station, /try \{ after\(work\); \} catch \{ void work\(\); \}/);
const server = fs.readFileSync(path.join(__dirname, '../../src/lib/officeSentCounted.server.ts'), 'utf8');
assert.match(server, /ON CONFLICT \(id\) DO NOTHING/);
assert.match(server, /printed_count=GREATEST\(printed_count,/);
console.log('office sent counted: ok');
