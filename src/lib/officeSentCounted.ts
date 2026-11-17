import { extendThrough, type OfficeSpan } from './officeRange';
import { countedEventSpans } from './runProgress';
import { afterRewind, lastRewindAt } from './runRewind';

/**
 * Labels the office printer reported "sent to printer" count as printed.
 *
 * The office Pi hands each part to CUPS and reports `sent_to_printer` once the
 * printer took it. In practice that is the moment the labels come out, so the
 * run counts them straight away, the same way a person pressing "Mark printed"
 * used to: each part is kept in the print history as confirmed, and progress
 * moves through every unbroken stretch. Parts that need a check, didn't print,
 * or were sent before a "go back" are never counted.
 */

export interface SentJob { id: string; from: number; to: number; state: string; review: boolean; requestAt: string | null }
export interface HistoryEvent { id?: string; eventType: string; output: string; rangeFrom: number; rangeTo: number; createdAt: string }
export interface RunNow { printedCount: number; total: number; status: string }

export const OFFICE_SENT_MESSAGE = 'Printed on the office printer';
/** One history entry per office part, so a repeated report never counts twice. */
export const OFFICE_SENT_PREFIX = 'office-sent-';
export const officeSentEventId = (jobId: string) => `${OFFICE_SENT_PREFIX}${jobId}`;
/** How long after an office report the run page re-reads the server's count. */
export const OFFICE_COUNT_SETTLE_MS = 1500;

export interface SentPlan {
  /** Confirmed history entries to add (parts not in the history yet). */
  add: { id: string; from: number; to: number }[];
  /** Progress after counting: never lower than now. */
  through: number;
  /** 'completed' once every label counts; null leaves the status alone. */
  status: 'completed' | null;
}

export function officeSentPlan(run: RunNow, jobs: ReadonlyArray<SentJob>, events: ReadonlyArray<HistoryEvent>): SentPlan {
  const total = Math.max(0, Math.floor(run.total) || 0);
  const printed = Math.max(0, Math.min(total, Math.floor(run.printedCount) || 0));
  const rewoundAt = lastRewindAt(events);
  const have = new Set(events.map((e) => e.id).filter(Boolean));
  const counted = jobs.filter((j) => j.state === 'sent_to_printer' && !j.review && afterRewind(j.requestAt, rewoundAt) && j.to >= j.from && j.from <= total);
  const add = counted.filter((j) => !have.has(officeSentEventId(j.id)))
    .map((j) => ({ id: officeSentEventId(j.id), from: Math.max(1, j.from), to: Math.min(total, j.to) }));
  const spans: OfficeSpan[] = [...countedEventSpans(events, total, rewoundAt), ...add.map(({ from, to }) => ({ from, to }))];
  const through = Math.max(printed, extendThrough(printed, spans, total));
  // A cancelled run stays cancelled (labels that printed anyway still count as progress).
  const status = through >= total && total > 0 && run.status !== 'cancelled' && run.status !== 'completed' ? 'completed' : null;
  return { add, through, status };
}
