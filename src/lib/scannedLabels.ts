/**
 * Labels printed one at a time in scan mode. The scan page records each one
 * as a print event (output 'scan', one label each), so the run page can see
 * them from any device and offer to leave them out of a bigger print.
 */
export interface ScanEventLike { eventType: string; output: string; rangeFrom: number; rangeTo: number; createdAt?: string }
export interface LabelSpan { from: number; to: number }

/** Label numbers printed by scanning, after the last rewind (a rewind means "print these again"). Sorted, no repeats. */
export function scannedLabelNumbers(events: ReadonlyArray<ScanEventLike>, total = Infinity, rewoundAt = 0): number[] {
  const seen = new Set<number>();
  for (const event of events) {
    if (event.output !== 'scan' || event.eventType !== 'sent') continue;
    if (rewoundAt && event.createdAt) {
      const at = Date.parse(event.createdAt);
      if (Number.isFinite(at) && at <= rewoundAt) continue;
    }
    for (let n = Math.max(1, event.rangeFrom); n <= Math.min(total, event.rangeTo) && n - event.rangeFrom < 10000; n++) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

/** Merge sorted label numbers into spans: 3,4,5,9 -> 3–5, 9. */
export function labelSpans(numbers: ReadonlyArray<number>): LabelSpan[] {
  const out: LabelSpan[] = [];
  for (const n of [...numbers].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && n <= last.to + 1) last.to = Math.max(last.to, n); else out.push({ from: n, to: n });
  }
  return out;
}

/** "label 4", "labels 4 and 9", "labels 3–5, 9 and 12", with the rest counted after five pieces. */
export function labelListWords(numbers: ReadonlyArray<number>): string {
  const spans = labelSpans(numbers);
  if (!spans.length) return '';
  const word = (s: LabelSpan) => (s.from === s.to ? s.from.toLocaleString() : `${s.from.toLocaleString()}–${s.to.toLocaleString()}`);
  const single = spans.length === 1 && spans[0].from === spans[0].to;
  const shown = spans.slice(0, 5).map(word);
  const rest = spans.slice(5).reduce((sum, s) => sum + s.to - s.from + 1, 0);
  let list: string;
  if (rest) list = `${shown.join(', ')} and ${rest.toLocaleString()} more`;
  else if (shown.length === 1) list = shown[0];
  else list = `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  return `${single ? 'label' : 'labels'} ${list}`;
}

/**
 * Which scanned labels fall inside from–to, and the pieces left to print
 * once they are skipped. `keep` is empty when every label was scanned.
 */
export function scannedSkipPlan(from: number, to: number, scanned: ReadonlyArray<number>): { skipped: number[]; keep: LabelSpan[] } {
  const skipped = scanned.filter(n => n >= from && n <= to);
  const keep: LabelSpan[] = [];
  let start = from;
  for (const n of skipped) {
    if (n > start) keep.push({ from: start, to: n - 1 });
    start = Math.max(start, n + 1);
  }
  if (start <= to) keep.push({ from: start, to });
  return { skipped, keep };
}
