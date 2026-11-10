export interface LabelRange {
  from: number;
  to: number;
}

interface NormalizeRangeOptions {
  total: number;
  from?: number;
  to?: number;
  fallbackFrom?: number;
  fallbackTo?: number;
}

/** Normalize a 1-based physical label range, inclusive. */
export function normalizeLabelRange({
  total,
  from,
  to,
  fallbackFrom = 1,
  fallbackTo = total,
}: NormalizeRangeOptions): LabelRange {
  const max = Math.max(1, Math.floor(total || 1));
  const start = Math.max(1, Math.min(max, Math.floor(from ?? fallbackFrom)));
  const end = Math.max(start, Math.min(max, Math.floor(to ?? fallbackTo)));
  return { from: start, to: end };
}

export function labelRangeCount(range: LabelRange): number {
  return Math.max(0, range.to - range.from + 1);
}

export function feedRangeForLabels(range: LabelRange, labelsAcross: number): { startFeed: number; stopFeed: number } {
  const across = Math.max(1, Math.floor(labelsAcross || 1));
  return {
    startFeed: Math.floor((range.from - 1) / across),
    stopFeed: Math.ceil(range.to / across),
  };
}

/**
 * What Start/Resume does with the chosen "From" label. The server keeps the
 * highest printed count it has seen, so a From at or below the printed count
 * is a deliberate rewind: it needs the same confirmation as "Go back to label
 * N" and must be saved with resetProgress. Otherwise the server would keep the
 * higher count and the labels in between would be skipped after a pause.
 * `startCount` is the progress to save when printing starts.
 */
export function planRunStart(printedCount: number, from: number): { rewind: boolean; startCount: number } {
  return from <= printedCount ? { rewind: true, startCount: Math.max(0, from - 1) } : { rewind: false, startCount: printedCount };
}
