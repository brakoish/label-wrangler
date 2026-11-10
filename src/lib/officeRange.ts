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
export function jobsOfRequests<J extends OfficeJobLike>(requests: ReadonlyArray<{ id: string; created_at?: string; jobs: ReadonlyArray<J> }>): Array<J & { requestId: string; requestAt?: string }> {
  return requests.flatMap((request) => request.jobs.map((job) => ({ ...job, requestId: request.id, ...(request.created_at ? { requestAt: request.created_at } : {}) })));
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
function union(jobs: ReadonlyArray<{ from: number; to: number }>, total: number): Span[] {
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

/**
 * A part of the run the office could not print, or that someone must look at.
 * - did-not-print: the office said these didn't print (rejected, e.g. out of labels).
 * - needs-check:   the office never confirmed them; they may or may not have printed.
 * - print-again:   someone checked them at the office, but they were neither
 *                  printed again nor counted as printed, so they would be lost.
 * didNotPrint is kept for older callers: true only for did-not-print.
 */
export type OfficeFailedKind = 'did-not-print' | 'needs-check' | 'print-again';
export interface OfficeFailedPart { from: number; to: number; reason: string | null; requestId: string | null; jobIds: string[]; didNotPrint: boolean; kind: OfficeFailedKind }
export interface OfficeDeliverySummary {
  /** Distinct labels the office reported "sent to printer" (CUPS delivery, not proof of printing). */
  sent: number;
  /** Distinct labels still on their way (not yet sent). */
  onTheWay: number;
  /** Parts that didn't print, need a check, or need printing again; one per request, kind and reason. */
  failed: OfficeFailedPart[];
  /** Labels in those parts (counted once), so counts read in labels, never in requests. */
  failedLabels: number;
}
export interface OfficeSpan { from: number; to: number }

const kindOf = (job: OfficeJobLike): OfficeFailedKind => (job.state === 'rejected' ? 'did-not-print' : 'needs-check');

/**
 * What the office did for a run. `printedCount` and `printedSpans` (ranges a
 * person confirmed as printed) only decide which checked-off labels still
 * need printing again; they never change what counts as sent.
 */
export function officeDeliverySummary(jobs: ReadonlyArray<OfficeJobLike>, total: number, done?: { printedCount?: number; printedSpans?: ReadonlyArray<OfficeSpan> }): OfficeDeliverySummary {
  const sentSpans = union(jobs.filter((j) => j.state === 'sent_to_printer' && !j.review), total);
  const moving = minus(union(jobs.filter((j) => OFFICE_IN_PROGRESS.includes(j.state) && !j.review), total), sentSpans);
  const failed: OfficeFailedPart[] = [];
  for (const job of jobs.filter(jobNeedsCheck).slice().sort((a, b) => a.from - b.from)) {
    const last = failed[failed.length - 1];
    const kind = kindOf(job);
    // Two parts merge only when they are one send, one kind and one cause, so
    // "51–100 didn't print (out of labels)" never swallows "101–150 need a check".
    if (last && last.requestId === (job.requestId ?? null) && last.kind === kind && (last.reason ?? null) === (job.reason ?? null) && job.from <= last.to + 1) {
      last.to = Math.max(last.to, job.to);
      if (job.id) last.jobIds.push(job.id);
    } else failed.push({ from: job.from, to: job.to, reason: job.reason ?? null, requestId: job.requestId ?? null, jobIds: job.id ? [job.id] : [], didNotPrint: kind === 'did-not-print', kind });
  }
  // Checked off at the office but not printed again (or counted) yet.
  const printedThrough = Math.max(0, Math.floor(done?.printedCount ?? 0) || 0);
  const stillCovered = union(jobs.filter((j) => j.state === 'sent_to_printer' || OFFICE_IN_PROGRESS.includes(j.state) || jobNeedsCheck(j)), total);
  const confirmed = union(done?.printedSpans ?? [], total);
  let again = minus(union(jobs.filter((j) => j.state === 'resolved'), total), stillCovered);
  again = minus(again, [...confirmed, ...(printedThrough > 0 ? [[1, printedThrough] as Span] : [])]);
  for (const [a, b] of again) {
    const source = jobs.find((j) => j.state === 'resolved' && j.from <= b && j.to >= a);
    failed.push({ from: a, to: b, reason: null, requestId: source?.requestId ?? null, jobIds: [], didNotPrint: false, kind: 'print-again' });
  }
  failed.sort((x, y) => x.from - y.from);
  return { sent: size(sentSpans), onTheWay: size(moving), failed, failedLabels: size(union(failed, total)) };
}

/** Labels still waiting at the office (queued or picked up, not reported sent), as merged spans. */
export function officeWaitingSpans(jobs: ReadonlyArray<OfficeJobLike>, total: number): OfficeSpan[] {
  const sent = union(jobs.filter((j) => j.state === 'sent_to_printer' && !j.review), total);
  return minus(union(jobs.filter((j) => OFFICE_IN_PROGRESS.includes(j.state) && !j.review), total), sent).map(([from, to]) => ({ from, to }));
}

/** Labels from..to as merged spans, for messages like "labels 1–50 and 101–150". */
export function spanWords(input: ReadonlyArray<OfficeSpan>): string {
  // Touching parts read as one stretch: "labels 76–150", not "76–100, 101–125 and 126–150".
  const spans: OfficeSpan[] = [];
  for (const s of input.slice().sort((a, b) => a.from - b.from)) {
    const last = spans[spans.length - 1];
    if (last && s.from <= last.to + 1) last.to = Math.max(last.to, s.to); else spans.push({ from: s.from, to: s.to });
  }
  const parts = spans.map((s) => (s.from === s.to ? `${s.from.toLocaleString()}` : `${s.from.toLocaleString()}–${s.to.toLocaleString()}`));
  const one = spans.length === 1 && spans[0].from === spans[0].to;
  const list = parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${one ? 'label' : 'labels'} ${list}`;
}

/**
 * Highest label N such that every label 1..N is counted as printed
 * (printedCount) or lies in one of `spans`. Gaps stop it.
 */
export function extendThrough(printedCount: number, spans: ReadonlyArray<OfficeSpan>, total = Infinity): number {
  let through = Math.max(0, Math.floor(printedCount) || 0);
  for (const s of spans.slice().sort((a, b) => a.from - b.from)) {
    if (s.from > through + 1) break;
    through = Math.max(through, s.to);
  }
  return Math.min(through, total);
}

/**
 * What "Mark sent labels as printed" offers: every stretch the office
 * reported sent that isn't counted as printed yet (not just the first one),
 * and where progress ends up once a person confirms them. Progress is
 * "printed up to label N", so it only moves through an unbroken stretch;
 * ranges after a gap are recorded as confirmed and counted once the gap is
 * printed. `confirmedSpans`: ranges people already confirmed at the office.
 */
export function officeMarkPlan(printedCount: number, jobs: ReadonlyArray<OfficeJobLike>, confirmedSpans: ReadonlyArray<OfficeSpan>, total: number): { ranges: OfficeSpan[]; through: number } {
  const printed = Math.max(0, Math.min(total, Math.floor(printedCount) || 0));
  const confirmed = union(confirmedSpans, total);
  let sent = union(jobs.filter((j) => j.state === 'sent_to_printer' && !j.review), total);
  sent = minus(sent, [...confirmed, ...(printed > 0 ? [[1, printed] as Span] : [])]);
  const ranges = sent.map(([from, to]) => ({ from, to }));
  const through = extendThrough(printed, [...ranges, ...confirmed.map(([from, to]) => ({ from, to }))], total);
  return { ranges, through };
}

/**
 * The run status after a person marks office labels printed: completed once
 * every label is counted, otherwise paused, except while the run is printing
 * (on this or another device): then the status is left alone (null) and only
 * the progress moves, so the Runs list doesn't flip to "paused" and nobody
 * resumes a run that is still printing.
 */
export function statusAfterMarkPrinted(runStatus: string | null | undefined, through: number, total: number): 'completed' | 'paused' | null {
  if (through >= total) return 'completed';
  return runStatus === 'printing' ? null : 'paused';
}

/**
 * One explicit "Send all N in K parts": consecutive ranges of at most `cap`
 * labels. Every boundary after the first falls on a whole feed of a
 * multi-across roll (a multiple of `across`), so no part starts mid-row and
 * leaves blank labels.
 */
export function officeSendParts(from: number, to: number, cap: number, across = 1): OfficeSpan[] {
  const lanes = Math.max(1, Math.floor(across) || 1);
  const step = Math.max(lanes, Math.floor(Math.max(1, Math.floor(cap) || 1) / lanes) * lanes);
  const parts: OfficeSpan[] = [];
  let start = Math.max(1, Math.floor(from));
  const end = Math.floor(to);
  while (start <= end && parts.length < 1000) {
    let stop = Math.min(end, start + step - 1);
    // End on a feed boundary unless this is the last part.
    if (stop < end) stop = Math.max(start, Math.floor(stop / lanes) * lanes);
    if (stop < start) stop = Math.min(end, start + lanes - 1);
    parts.push({ from: start, to: stop });
    start = stop + 1;
  }
  return parts;
}

/** A multi-part send saved on this device so a closed page can finish it later. */
export interface OfficePartsPlan { stationId: string; printerId: string; parts: OfficeSpan[]; next: number; at: string }
export function readPartsPlan(raw: string | null): OfficePartsPlan | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<OfficePartsPlan>;
    if (typeof data.stationId !== 'string' || typeof data.printerId !== 'string' || !Array.isArray(data.parts) || !Number.isInteger(data.next)) return null;
    const parts = data.parts.filter((p): p is OfficeSpan => !!p && Number.isInteger(p.from) && Number.isInteger(p.to) && p.from >= 1 && p.to >= p.from);
    if (parts.length !== data.parts.length || data.next! < 0 || data.next! > parts.length) return null;
    return { stationId: data.stationId, printerId: data.printerId, parts, next: data.next!, at: typeof data.at === 'string' ? data.at : '' };
  } catch { return null; }
}
/** Parts still to send, or none. */
export function remainingParts(plan: OfficePartsPlan | null): OfficeSpan[] {
  return plan ? plan.parts.slice(plan.next) : [];
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
  // Whole feeds last: on a 3-across roll 500 becomes 498, so the next send
  // starts on a new row instead of leaving blank labels at every boundary.
  cap = Math.floor(cap / lanes) * lanes;
  return Math.max(lanes, cap);
}

/**
 * After the label check stopped at a size limit ("Labels 1601–1608: …
 * exceeds 32 MiB"), a smaller cap that fits: 90% of what was checked.
 */
export function capAfterSizeError(message: string, from: number, across = 1): number | null {
  if (!/exceeds 32 MiB|exceeds the 2 MiB|up to 10,000|time limit/i.test(message)) return null;
  const at = message.match(/Labels?\s+(\d+)/i);
  const failedAt = at ? Number(at[1]) : NaN;
  if (!Number.isFinite(failedAt) || failedAt <= from) return null;
  const lanes = Math.max(1, Math.floor(across) || 1);
  return Math.max(lanes, Math.floor(Math.floor((failedAt - from) * 0.9) / lanes) * lanes);
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

/**
 * Labels after the printed progress that no office send covers yet (not
 * sent, not on the way, not waiting for a check), as merged spans. Read from
 * the office's own records, so every device sees what a stopped "Send all in
 * parts" left unsent. None when the office has nothing of this run.
 */
export function officeUnsentSpans(jobs: ReadonlyArray<OfficeJobLike>, total: number, printedCount = 0): OfficeSpan[] {
  const covered = union(jobs.filter(jobCoversLabels), total);
  if (!covered.length) return [];
  const printed = Math.max(0, Math.min(total, Math.floor(printedCount) || 0));
  if (printed >= total) return [];
  return minus([[printed + 1, total]], covered).map(([from, to]) => ({ from, to }));
}

/**
 * A saved "Send all in parts" plan, minus what is already counted as printed:
 * parts at or below printedCount drop out, a part that straddles it starts
 * after it. `trimmed` is the stretch that was taken out (for "Labels A–B are
 * already counted as printed"), or null.
 */
export function partsAfterPrinted(parts: ReadonlyArray<OfficeSpan>, printedCount: number): { parts: OfficeSpan[]; trimmed: OfficeSpan | null } {
  const printed = Math.max(0, Math.floor(printedCount) || 0);
  const kept: OfficeSpan[] = [];
  let lo = Infinity, hi = 0;
  for (const part of parts) {
    if (part.to <= printed) { lo = Math.min(lo, part.from); hi = Math.max(hi, part.to); continue; }
    if (part.from <= printed) { lo = Math.min(lo, part.from); hi = Math.max(hi, printed); kept.push({ from: printed + 1, to: part.to }); continue; }
    kept.push({ from: part.from, to: part.to });
  }
  return { parts: kept, trimmed: hi ? { from: lo, to: hi } : null };
}

/**
 * Labels a "Print in order" fix cancelled for now, saved on this device so
 * the panel can offer "Send labels 76–150 now" once the reprint is done.
 * Bad or empty data reads as nothing held.
 */
export function readHeldSpans(raw: string | null, total = Infinity): OfficeSpan[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    const spans: OfficeSpan[] = [];
    for (const item of data) {
      const span = item as Partial<OfficeSpan>;
      if (!span || !Number.isInteger(span.from) || !Number.isInteger(span.to)) return [];
      if (span.from! < 1 || span.to! < span.from! || span.to! > total) return [];
      spans.push({ from: span.from!, to: span.to! });
    }
    return spans.sort((a, b) => a.from - b.from);
  } catch { return []; }
}

/** Held labels that still need sending: not printed yet and not already on their way again. */
export function heldStillUnsent(held: ReadonlyArray<OfficeSpan>, jobs: ReadonlyArray<OfficeJobLike>, printedCount: number, total: number): OfficeSpan[] {
  if (!held.length) return [];
  const printed = Math.max(0, Math.floor(printedCount) || 0);
  const covered = union(jobs.filter(jobCoversLabels), total);
  // Touching held parts (76–100, 101–125, 126–150) read as one stretch.
  const want = union(held.map(s => ({ from: Math.max(s.from, printed + 1), to: s.to })), total);
  return minus(want, covered).map(([from, to]) => ({ from, to }));
}

/**
 * Label numbers a person typed in one box ("5–8, 12", "3 17", "5 to 8"):
 * sorted, touching stretches joined, each stretch cut into pieces of at most
 * `cap` labels (one send each). `error` says in plain words what to fix;
 * an empty box is neither spans nor an error.
 */
export function parseLabelList(text: string, total: number, cap = Infinity): { spans: OfficeSpan[]; error: string } {
  // "1,000" is a thousand; "3,17" and "3, 17" are two labels.
  const cleaned = text.trim().replace(/(\d),(\d{3})(?!\d)/g, '$1$2').replace(/\s*(?:–|—|-|\bto\b|\bthrough\b|\.\.)\s*/gi, '-').replace(/\band\b|[,;&+]/gi, ' ');
  if (!cleaned) return { spans: [], error: '' };
  const raw: OfficeSpan[] = [];
  for (const token of cleaned.split(/\s+/).filter(Boolean)) {
    const match = /^(\d{1,7})(?:-(\d{1,7}))?$/.exec(token);
    if (!match) return { spans: [], error: 'Type label numbers only, like 5–8, 12.' };
    const from = Number(match[1]); const to = match[2] === undefined ? from : Number(match[2]);
    if (from < 1 || to > total || from > to) return { spans: [], error: from > to ? `In ${from}–${to}, put the smaller number first.` : `Use label numbers from 1 to ${total.toLocaleString()}.` };
    raw.push({ from, to });
  }
  const joined: OfficeSpan[] = [];
  for (const s of raw.sort((a, b) => a.from - b.from)) {
    const last = joined[joined.length - 1];
    if (last && s.from <= last.to + 1) last.to = Math.max(last.to, s.to); else joined.push({ ...s });
  }
  const size = Math.max(1, Math.floor(cap) || 1);
  const spans: OfficeSpan[] = [];
  for (const s of joined) for (let a = s.from; a <= s.to; a += size) spans.push({ from: a, to: Math.min(s.to, a + size - 1) });
  return { spans, error: '' };
}

/** Job states whose labels may still print, or may have printed: never called "not printed". */
const MIGHT_PRINT = new Set(['queued', 'claimed', 'submitted', 'sent_to_printer', 'needs_review', 'resolved']);

/** Merged spans of the given label numbers (sorted or not). */
function spansOf(numbers: Iterable<number>): OfficeSpan[] {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const spans: OfficeSpan[] = [];
  for (const n of sorted) {
    const last = spans[spans.length - 1];
    if (last && n === last.to + 1) last.to = n; else spans.push({ from: n, to: n });
  }
  return spans;
}

/** The sends of this run that still have a part waiting to be picked up (only those can be stopped). */
export function officeQueuedRequestIds(jobs: ReadonlyArray<OfficeJobLike & { requestId?: string }>): string[] {
  return [...new Set(jobs.filter((job) => job.state === 'queued' && job.requestId).map((job) => job.requestId as string))];
}

/** Labels waiting to be picked up at the office, merged (the labels a cancel can still stop). */
export function officeQueuedSpans(jobs: ReadonlyArray<OfficeJobLike>, total: number): OfficeSpan[] {
  const numbers: number[] = [];
  for (const job of jobs) if (job.state === 'queued') for (let n = Math.max(1, job.from); n <= Math.min(total, job.to); n++) numbers.push(n);
  return spansOf(numbers);
}

/**
 * What a run's history says when it is cancelled, so it never records
 * something false:
 *  - stopped: labels whose office parts were waiting and are now cancelled
 *    (they were stopped at the office);
 *  - notPrinted: labels after the run's progress that didn't print and won't:
 *    never labels still at the office or sent to the printer, and never
 *    labels printed by scanning or confirmed at the office.
 * `stoppedJobIds` are the jobs that were waiting when the person chose to stop them.
 */
export function officeCancelHistory(
  printedCount: number,
  end: number,
  jobs: ReadonlyArray<OfficeJobLike & { id?: string }>,
  stoppedJobIds: ReadonlySet<string>,
  done: ReadonlyArray<number> = [],
  confirmed: ReadonlyArray<OfficeSpan> = [],
): { stopped: OfficeSpan[]; notPrinted: OfficeSpan[] } {
  const from = Math.max(1, printedCount + 1);
  const stoppedNumbers: number[] = [];
  const mightPrint = new Set<number>(done);
  for (const span of confirmed) for (let n = Math.max(from, span.from); n <= Math.min(end, span.to); n++) mightPrint.add(n);
  for (const job of jobs) {
    const stopped = job.state === 'cancelled' && !!job.id && stoppedJobIds.has(job.id);
    if (stopped) { for (let n = Math.max(1, job.from); n <= job.to && n - job.from < OFFICE_MAX_LABELS; n++) stoppedNumbers.push(n); continue; }
    if (!MIGHT_PRINT.has(job.state)) continue;
    for (let n = Math.max(from, job.from); n <= Math.min(end, job.to); n++) mightPrint.add(n);
  }
  const notPrinted: number[] = [];
  for (let n = from; n <= end; n++) if (!mightPrint.has(n)) notPrinted.push(n);
  return { stopped: spansOf(stoppedNumbers), notPrinted: spansOf(notPrinted) };
}
