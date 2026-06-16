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
