import { jobsOfRequests, officeCancelHistory, officeQueuedRequestIds, officeQueuedSpans, officeWaitingSpans, spanWords, type OfficeSpan } from '@/lib/officeRange';
import { choiceDialog, confirmDialog } from '@/components/ui/feedback';
import type { OfficeJobBrief } from './useOfficeRequests';
import type { RunPrintOutput } from '@/lib/types';

/**
 * Cancelling a run with labels still waiting at the office: the run page and
 * the Runs list share this, so both offer the same choice and write the same
 * history. It uses only the office queue's existing calls: GET
 * /api/office/jobs?runId= to read, and DELETE /api/office/jobs/:requestId,
 * which cancels the parts nobody has picked up yet and nothing else.
 */

/** Every office job of the run, or null when the office queue can't be read. */
export async function readOfficeJobs(runId: string): Promise<OfficeJobBrief[] | null> {
  try {
    const response = await fetch('/api/office/jobs?runId=' + encodeURIComponent(runId), { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json().catch(() => ({}));
    if (data.truncated === true && Array.isArray(data.jobs)) return data.jobs;
    return jobsOfRequests(Array.isArray(data.requests) ? data.requests : []);
  } catch { return null; }
}

export interface OfficeStopResult {
  /** The office jobs read after stopping (null if they couldn't be read). */
  jobs: OfficeJobBrief[] | null;
  /** Jobs that were waiting when the person chose to stop them. */
  stoppedJobIds: Set<string>;
  /** Sends whose cancel call failed. */
  failed: number;
}

/** Stops every part of the run that is still waiting to be picked up: one DELETE per send that has one. */
export async function stopWaitingAtOffice(runId: string, jobs: ReadonlyArray<OfficeJobBrief>): Promise<OfficeStopResult> {
  const stoppedJobIds = new Set(jobs.filter((job) => job.state === 'queued').map((job) => job.id));
  let failed = 0;
  for (const requestId of officeQueuedRequestIds(jobs)) {
    try {
      const response = await fetch('/api/office/jobs/' + encodeURIComponent(requestId), { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, cache: 'no-store' });
      if (!response.ok) failed += 1;
    } catch { failed += 1; }
  }
  return { jobs: await readOfficeJobs(runId), stoppedJobIds, failed };
}

/** The print history entries a cancel writes: only what is true. */
export function cancelEvents(input: {
  printedCount: number; end: number; jobs: ReadonlyArray<OfficeJobBrief>; stoppedJobIds?: ReadonlySet<string>;
  scanned?: ReadonlyArray<number>; confirmed?: ReadonlyArray<OfficeSpan>; output: RunPrintOutput; printerName: string | null;
}) {
  const plan = officeCancelHistory(input.printedCount, input.end, input.jobs, input.stoppedJobIds ?? new Set(), input.scanned, input.confirmed);
  return [
    ...plan.stopped.map((span) => ({ eventType: 'cancelled' as const, output: 'office-pi' as const, rangeFrom: span.from, rangeTo: span.to, labelCount: span.to - span.from + 1, printedCountAfter: input.printedCount, printerName: 'Office printer', message: 'Stopped at the office when the run was cancelled' })),
    ...plan.notPrinted.map((span) => ({ eventType: 'cancelled' as const, output: input.output, rangeFrom: span.from, rangeTo: span.to, labelCount: span.to - span.from + 1, printedCountAfter: input.printedCount, printerName: input.printerName, message: 'Run cancelled' })),
  ];
}

const count = (spans: ReadonlyArray<OfficeSpan>) => spans.reduce((n, span) => n + span.to - span.from + 1, 0);
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * "Cancel this run?" with the office in mind. Labels nobody has picked up yet
 * can be stopped with the run, or left to print; labels already picked up
 * print anyway, and the dialog says so. Resolves 'stop', 'let' or null (keep
 * the run).
 */
export async function askCancelRun(input: { title: string; jobs: ReadonlyArray<OfficeJobBrief>; total: number; after?: string }): Promise<'stop' | 'let' | null> {
  const queued = officeQueuedSpans(input.jobs, input.total);
  const queuedSet = new Set<number>();
  for (const span of queued) for (let n = span.from; n <= span.to; n++) queuedSet.add(n);
  const pickedUp: OfficeSpan[] = [];
  for (const span of officeWaitingSpans(input.jobs, input.total)) {
    for (let n = span.from; n <= span.to; n++) {
      if (queuedSet.has(n)) continue;
      const last = pickedUp[pickedUp.length - 1];
      if (last && last.to === n - 1) last.to = n; else pickedUp.push({ from: n, to: n });
    }
  }
  const one = (spans: ReadonlyArray<OfficeSpan>) => count(spans) === 1;
  const pickedWords = pickedUp.length ? ` ${capital(spanWords(pickedUp))} ${one(pickedUp) ? 'was' : 'were'} already picked up by the office and ${one(pickedUp) ? 'prints' : 'print'} anyway.` : '';
  const after = input.after ? ` ${input.after}` : '';
  if (!queued.length) {
    const ok = await confirmDialog({ title: input.title, body: `Labels already printed stay printed and the print history is kept.${pickedWords}${after}`, confirmLabel: 'Cancel run', cancelLabel: 'Keep run', danger: true });
    return ok ? 'let' : null;
  }
  const n = count(queued);
  const choice = await choiceDialog({
    title: input.title,
    body: `Labels already printed stay printed and the print history is kept. ${capital(spanWords(queued))} ${n === 1 ? 'is' : 'are'} waiting at the office and ${n === 1 ? 'hasn’t' : 'haven’t'} been picked up yet: stop ${n === 1 ? 'it' : 'them'} too, or let ${n === 1 ? 'it' : 'them'} print?${pickedWords}${after}`,
    confirmLabel: n === 1 ? 'Cancel run and stop it' : `Cancel run and stop those ${n.toLocaleString('en-US')}`,
    altLabel: n === 1 ? 'Cancel run, let it print' : 'Cancel run, let them print',
    cancelAlso: true,
    cancelLabel: 'Keep run',
    danger: true,
  });
  return choice === 'confirm' ? 'stop' : choice === 'alt' ? 'let' : null;
}

/** Words for a stop that didn't fully work, or null. */
export function stopProblem(result: OfficeStopResult): string | null {
  if (!result.failed && result.jobs) return null;
  if (!result.jobs) return 'The run was cancelled, but the office queue couldn’t be read afterwards. Open the run and check its office queue.';
  const still = result.jobs.filter((job) => job.state === 'queued');
  return still.length ? `The run was cancelled, but ${spanWords(still.map((job) => ({ from: job.from, to: job.to })))} could not be stopped at the office and may still print. Open the run and tap “Cancel what hasn’t been picked up” in its office queue.` : null;
}
