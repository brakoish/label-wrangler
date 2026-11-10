import type { RunPrintEvent } from './types';

type ScanEvent = Pick<RunPrintEvent, 'eventType' | 'output' | 'rangeFrom' | 'rangeTo'> & Partial<Pick<RunPrintEvent, 'runId'>>;

/**
 * The label numbers (1-based, ascending, each once) that scan mode has sent
 * to a printer, read from the run's print events. Scan mode logs one 'sent'
 * event with output 'scan' per scanned label (rangeFrom === rangeTo), and a
 * label scanned twice logs twice; it is listed once here. Pass runId to
 * ignore events of other runs in a shared list.
 *
 * Scans don't move the run's printed count (they print out of order), so a
 * run page uses this to say which labels went out by scan.
 */
export function scannedLabelNumbers(events: ReadonlyArray<ScanEvent>, runId?: string): number[] {
  const seen = new Set<number>();
  for (const event of events) {
    if (event.output !== 'scan' || event.eventType !== 'sent') continue;
    if (runId && event.runId && event.runId !== runId) continue;
    const from = Math.floor(Math.min(event.rangeFrom, event.rangeTo));
    const to = Math.floor(Math.max(event.rangeFrom, event.rangeTo));
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1) continue;
    // A scan event covers one label; cap a malformed range so it can't run away.
    for (let n = from; n <= Math.min(to, from + 10_000); n++) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

/** Touching numbers joined into ranges ([4,5,6,9] -> 4–6 and 9), for display. */
export function scannedLabelRanges(numbers: ReadonlyArray<number>): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  for (const n of numbers) {
    const last = ranges[ranges.length - 1];
    if (last && n === last.to + 1) last.to = n;
    else if (!last || n > last.to) ranges.push({ from: n, to: n });
  }
  return ranges;
}
