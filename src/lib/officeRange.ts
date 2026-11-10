/**
 * Office print jobs as the run page sees them (read-only helpers). Nothing
 * here changes what is sent to the office; it only decides what the page
 * suggests, shows and asks. The rules mirror the server's own checks in
 * scripts/office/schema.sql (office_enqueue), so the page never offers a send
 * the server would refuse.
 */
export interface OfficeJobLike {
  from: number;
  to: number;
  state: string;
  /** The server's "check the printer before retrying" flag. */
  review?: boolean;
  reason?: string | null;
  id?: string;
  /** The office request (send) this job belongs to. */
  requestId?: string;
}

/** Waiting to go out, picked up, or in the office computer's print queue. */
export const OFFICE_IN_PROGRESS = ['queued', 'claimed', 'submitted'];
/** States the server treats as unresolved: no reprint may overlap them. */
const UNRESOLVED = ['queued', 'claimed', 'submitted', 'needs_review'];

/** A part the office could not print, or that someone must check first. */
export function jobNeedsCheck(job: OfficeJobLike): boolean {
  return !!job.review || job.state === 'needs_review' || job.state === 'rejected';
}
/** Still on its way, or waiting for a check: the server refuses any reprint over it. */
export function jobBlocksReprint(job: OfficeJobLike): boolean {
  return UNRESOLVED.includes(job.state) || !!job.review;
}
/** Any job that isn't cancelled counts as "already queued" for a new send (schema.sql: state <> 'cancelled'). */
export function jobCoversLabels(job: OfficeJobLike): boolean {
  return job.state !== 'cancelled';
}

/** Jobs of every request, each tagged with its request id. */
export function jobsOfRequests<J extends OfficeJobLike>(requests: ReadonlyArray<{ id: string; jobs: ReadonlyArray<J> }>): Array<J & { requestId: string }> {
  return requests.flatMap((request) => request.jobs.map((job) => ({ ...job, requestId: request.id })));
}

/**
 * First label that no office job covers yet (sent, on its way, failed or
 * checked), after the labels already counted as printed. The server refuses a
 * new send over any of those, so the suggestion never starts inside one.
 * Null when every label is printed or covered.
 */
export function firstUnsentLabel(jobs: ReadonlyArray<OfficeJobLike>, total: number, alreadyThrough = 0): number | null {
  const covered = jobs.filter(jobCoversLabels).slice().sort((a, b) => a.from - b.from);
  let through = Math.max(0, Math.min(total, Math.floor(alreadyThrough) || 0));
  for (const job of covered) {
    if (job.from > through + 1) break;
    through = Math.max(through, job.to);
  }
  return through >= total ? null : Math.max(1, through + 1);
}

/**
 * The range to suggest next: from the first uncovered label up to (not into)
 * the next covered one, and at most `cap` labels so the server accepts it in
 * one send. Null when nothing is left to send.
 */
export function suggestOfficeRange(jobs: ReadonlyArray<OfficeJobLike>, total: number, alreadyThrough = 0, cap = Infinity): { from: number; to: number } | null {
  const from = firstUnsentLabel(jobs, total, alreadyThrough);
  if (from === null) return null;
  const next = jobs.filter(jobCoversLabels).filter((job) => job.to >= from).reduce((min, job) => Math.min(min, job.from), Infinity);
  const limit = Math.max(1, Math.floor(cap) || 1);
  return { from, to: Math.max(from, Math.min(total, next - 1, from + limit - 1)) };
}

/** True when work still on its way to the office (or waiting for a check) overlaps labels from..to. */
export function rangeOverlapsQueued(jobs: ReadonlyArray<OfficeJobLike>, from: number, to: number): boolean {
  return jobs.some((job) => jobBlocksReprint(job) && job.from <= to && job.to >= from);
}

export type OfficeSendPlan =
  | { kind: 'new' }
  /** The range overlaps finished office work: it can only go as a reprint. */
  | { kind: 'reprint'; reprintOf: string; overlap: { from: number; to: number } }
  /** The server would refuse any send now: part is still on its way, or needs a check. */
  | { kind: 'wait'; why: 'on-its-way' | 'needs-check'; overlap: { from: number; to: number } };

/**
 * How a send of labels from..to has to go so the server accepts it:
 * - no office job covers any of it: a new send;
 * - it overlaps only finished work (sent or checked): a reprint of the
 *   earliest overlapping request (the reprint path the server accepts);
 * - it overlaps work still on its way or waiting for a check: nothing can be
 *   sent until that is done.
 */
export function officeSendPlan(jobs: ReadonlyArray<OfficeJobLike>, from: number, to: number): OfficeSendPlan {
  const overlapping = jobs.filter((job) => jobCoversLabels(job) && job.from <= to && job.to >= from);
  if (!overlapping.length) return { kind: 'new' };
  const overlap = { from: Math.max(from, Math.min(...overlapping.map((j) => j.from))), to: Math.min(to, Math.max(...overlapping.map((j) => j.to))) };
  const blocking = overlapping.filter(jobBlocksReprint);
  if (blocking.length) return { kind: 'wait', why: blocking.some(jobNeedsCheck) ? 'needs-check' : 'on-its-way', overlap };
  const earliest = overlapping.filter((job) => job.requestId).sort((a, b) => a.from - b.from)[0];
  if (!earliest?.requestId) return { kind: 'wait', why: 'on-its-way', overlap };
  return { kind: 'reprint', reprintOf: earliest.requestId, overlap };
}

type Span = [number, number];
/** Sorted, merged spans within 1..total. */
function union(jobs: ReadonlyArray<OfficeJobLike>, total: number): Span[] {
  const spans = jobs.map((j) => [Math.max(1, j.from), Math.min(total, j.to)] as Span).filter(([a, b]) => b >= a).sort((a, b) => a[0] - b[0]);
  const out: Span[] = [];
  for (const [a, b] of spans) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out;
}
const size = (spans: Span[]) => spans.reduce((sum, [a, b]) => sum + b - a + 1, 0);
function minus(spans: Span[], cut: Span[]): Span[] {
  let out = spans.map((s) => [...s] as Span);
  for (const [x, y] of cut) out = out.flatMap(([a, b]) => (y < a || x > b ? [[a, b] as Span] : [...(a < x ? [[a, x - 1] as Span] : []), ...(b > y ? [[y + 1, b] as Span] : [])]));
  return out;
}

/** didNotPrint: the office said these didn't print (rejected). Otherwise they may or may not have printed and need a look. */
export interface OfficeFailedPart { from: number; to: number; reason: string | null; requestId: string | null; jobIds: string[]; didNotPrint: boolean }
export interface OfficeDeliverySummary {
  /** Distinct labels the office reported "sent to printer" (CUPS delivery, not proof of printing). */
  sent: number;
  /** Distinct labels still on their way (not yet sent). */
  onTheWay: number;
  /** Parts the office couldn't print or that need someone to check, merged per request. */
  failed: OfficeFailedPart[];
}

export function officeDeliverySummary(jobs: ReadonlyArray<OfficeJobLike>, total: number): OfficeDeliverySummary {
  const sentSpans = union(jobs.filter((j) => j.state === 'sent_to_printer' && !j.review), total);
  const moving = minus(union(jobs.filter((j) => OFFICE_IN_PROGRESS.includes(j.state) && !j.review), total), sentSpans);
  const failed: OfficeFailedPart[] = [];
  for (const job of jobs.filter(jobNeedsCheck).slice().sort((a, b) => a.from - b.from)) {
    const last = failed[failed.length - 1];
    if (last && last.requestId === (job.requestId ?? null) && job.from <= last.to + 1) {
      last.to = Math.max(last.to, job.to);
      if (!last.reason && job.reason) last.reason = job.reason;
      if (job.id) last.jobIds.push(job.id);
      if (job.state !== 'rejected') last.didNotPrint = false;
    } else failed.push({ from: job.from, to: job.to, reason: job.reason ?? null, requestId: job.requestId ?? null, jobIds: job.id ? [job.id] : [], didNotPrint: job.state === 'rejected' });
  }
  return { sent: size(sentSpans), onTheWay: size(moving), failed };
}

/** Valid office range: whole numbers, 1 <= from <= to <= total. */
export function isValidOfficeRange(from: string, to: string, total: number): boolean {
  if (from.trim() === '' || to.trim() === '') return false;
  const a = Number(from), b = Number(to);
  return Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b >= a && b <= total;
}

/** Fields of a run that change printed labels; anything else must not invalidate a checked range. */
export function officeProofKey(run: { id?: string; sourceData?: unknown; fieldMappings?: unknown; staticValues?: unknown; mappedField?: unknown } | undefined, template: unknown, format: unknown, from: string, to: string): string {
  return JSON.stringify([run?.id, run?.sourceData, run?.fieldMappings, run?.staticValues, run?.mappedField, template, format, from, to]);
}

/**
 * The highest label N such that every label 1..N is either already counted
 * as printed (printedCount) or was reported sent to the printer by the
 * office. Gaps stop the count. Used only to offer an explicit "Mark labels
 * as printed"; office deliveries never move progress on their own, because
 * "sent to printer" is not proof that a label printed.
 */
export function officePrintedThrough(printedCount: number, jobs: ReadonlyArray<OfficeJobLike>, total = Infinity): number {
  let through = Math.max(0, Math.floor(printedCount) || 0);
  const sent = jobs.filter((job) => job.state === 'sent_to_printer' && !job.review).slice().sort((a, b) => a.from - b.from);
  for (const job of sent) {
    if (job.from > through + 1) break;
    through = Math.max(through, job.to);
  }
  return Math.min(through, total);
}

/** Labels still on their way to the office that are not already counted as printed. */
export function queuedBeyond(jobs: ReadonlyArray<OfficeJobLike & { count?: number }>, through: number): number {
  let count = 0;
  for (const job of jobs) {
    if (!OFFICE_IN_PROGRESS.includes(job.state)) continue;
    count += Math.max(0, job.to - Math.max(job.from - 1, through));
  }
  return count;
}

/** Labels in from..to that the office already has (sent or on its way, not cancelled or checked off), or null. */
export function officeLabelsIn(jobs: ReadonlyArray<OfficeJobLike>, from: number, to: number): { from: number; to: number; sent: boolean } | null {
  const overlapping = jobs.filter((job) => (job.state === 'sent_to_printer' || OFFICE_IN_PROGRESS.includes(job.state)) && job.from <= to && job.to >= from);
  if (!overlapping.length) return null;
  return {
    from: Math.max(from, Math.min(...overlapping.map((j) => j.from))),
    to: Math.min(to, Math.max(...overlapping.map((j) => j.to))),
    sent: overlapping.some((j) => j.state === 'sent_to_printer'),
  };
}

// --- Size of one send ----------------------------------------------------------
// The server takes at most 10,000 labels and 32 MiB of printer data per
// request (src/lib/office/render.ts, src/lib/runBuilder.ts), and stops
// preparing bitmap labels after 240 seconds. The page keeps every suggested
// range well inside those limits.
export const OFFICE_MAX_LABELS = 10_000;
export const OFFICE_MAX_BYTES = 32 * 1024 * 1024;
/** Bitmap labels are drawn one by one on the server; this many fit its time limit with room to spare. */
export const OFFICE_BITMAP_LABELS_PER_SEND = 500;
/** Bytes the server adds to each feed for office output (^PON, ^LH0,0, ^LT0, ^LS0, ^PQ1 and newlines). */
const OFFICE_FEED_OVERHEAD = 40;

/**
 * The most labels to suggest in one office send, from the printer data of a
 * few sample feeds. Uses the largest sample plus 10%, keeps 20% headroom
 * under the byte limit, and rounds down to a tidy number.
 */
export function officeSendCap(sampleFeedBytes: ReadonlyArray<number>, across = 1, bitmap = false): number {
  const lanes = Math.max(1, Math.floor(across) || 1);
  const perFeed = Math.max(1, ...sampleFeedBytes.filter((n) => Number.isFinite(n) && n > 0)) * 1.1 + OFFICE_FEED_OVERHEAD;
  let cap = Math.floor((OFFICE_MAX_BYTES * 0.8) / perFeed) * lanes;
  cap = Math.min(cap, OFFICE_MAX_LABELS, bitmap ? OFFICE_BITMAP_LABELS_PER_SEND : Infinity);
  if (cap >= 1000) cap = Math.floor(cap / 100) * 100;
  else if (cap >= 100) cap = Math.floor(cap / 50) * 50;
  return Math.max(lanes, cap);
}

/**
 * After the label check stopped at a size limit ("Labels 1601–1608: …
 * exceeds 32 MiB"), a smaller cap that fits: 90% of what was checked.
 */
export function capAfterSizeError(message: string, from: number): number | null {
  if (!/exceeds 32 MiB|exceeds the 2 MiB|up to 10,000|time limit/i.test(message)) return null;
  const at = message.match(/Labels?\s+(\d+)/i);
  const failedAt = at ? Number(at[1]) : NaN;
  if (!Number.isFinite(failedAt) || failedAt <= from) return null;
  return Math.max(1, Math.floor((failedAt - from) * 0.9));
}

/**
 * Labels a start (or a "mark as printed") would skip: when it begins after
 * the next unprinted label, everything in between would be counted as
 * printed. Null when nothing is skipped.
 */
export function skippedLabels(printedCount: number, from: number): { from: number; to: number } | null {
  const next = Math.max(0, Math.floor(printedCount) || 0) + 1;
  return from > next ? { from: next, to: from - 1 } : null;
}
