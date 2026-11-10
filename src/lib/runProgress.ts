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

