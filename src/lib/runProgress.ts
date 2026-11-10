import type { OfficeSpan } from './officeRange';

/** Labels 1..printedCount plus every stretch confirmed after a gap, merged. */
export function printedSpans(printedCount: number, confirmed: ReadonlyArray<OfficeSpan>, total: number): OfficeSpan[] {
  const all = [...(printedCount > 0 ? [{ from: 1, to: Math.min(printedCount, total) }] : []), ...confirmed]
    .map((s) => ({ from: Math.max(1, s.from), to: Math.min(total, s.to) }))
    .filter((s) => s.from <= s.to)
    .sort((a, b) => a.from - b.from);
  const out: OfficeSpan[] = [];
  for (const s of all) {
    const last = out[out.length - 1];
    if (last && s.from <= last.to + 1) last.to = Math.max(last.to, s.to); else out.push({ ...s });
  }
  return out;
}

/** The labels not printed yet, as spans. */
export function stillToGo(spans: ReadonlyArray<OfficeSpan>, total: number): OfficeSpan[] {
  const out: OfficeSpan[] = [];
  let next = 1;
  for (const s of spans) { if (s.from > next) out.push({ from: next, to: s.from - 1 }); next = Math.max(next, s.to + 1); }
  if (next <= total) out.push({ from: next, to: total });
  return out;
}

/** Labels in both lists of spans, merged and sorted. */
export function intersectSpans(a: ReadonlyArray<OfficeSpan>, b: ReadonlyArray<OfficeSpan>): OfficeSpan[] {
  const out: OfficeSpan[] = [];
  for (const x of a) for (const y of b) { const from = Math.max(x.from, y.from), to = Math.min(x.to, y.to); if (from <= to) out.push({ from, to }); }
  return printedSpans(0, out, Infinity);
}


/** A print-history entry, as far as counting printed labels goes. */
export interface CountedEventLike { eventType: string; output: string; rangeFrom: number; rangeTo: number; createdAt?: string | null }

/**
 * Stretches counted as printed apart from the run's progress (1..printedCount):
 * office ranges a person confirmed came out, and labels printed one by one by
 * scanning, after the latest accepted "Go back" (`rewoundAt`, ms; unknown
 * times count as after). The run page and the Runs list both count printed
 * labels with this and `printedLabelCount`, so they always say the same number.
 */
export function countedEventSpans(events: ReadonlyArray<CountedEventLike>, total: number, rewoundAt = 0): OfficeSpan[] {
  const picked: OfficeSpan[] = [];
  for (const event of events) {
    const counts = (event.eventType === 'confirmed' && event.output === 'office-pi') || (event.eventType === 'sent' && event.output === 'scan');
    if (!counts) continue;
    if (rewoundAt) {
      const at = event.createdAt ? Date.parse(event.createdAt) : NaN;
      if (Number.isFinite(at) && at <= rewoundAt) continue;
      if (!Number.isFinite(at) && rewoundAt === Number.POSITIVE_INFINITY) continue;
    }
    picked.push({ from: Number(event.rangeFrom), to: Number(event.rangeTo) });
  }
  return printedSpans(0, picked, total);
}

/** Labels counted as printed, wherever they sit: progress plus the counted stretches, each label once. */
export function printedLabelCount(printedCount: number, counted: ReadonlyArray<OfficeSpan>, total: number): number {
  return printedSpans(Math.max(0, Math.floor(printedCount) || 0), counted, total).reduce((n, s) => n + s.to - s.from + 1, 0);
}
