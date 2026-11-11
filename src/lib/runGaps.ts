import { officeSendParts, suggestOfficeRange, type OfficeJobLike, type OfficeSpan } from './officeRange';

/**
 * Labels already printed sit in islands (office ranges a person confirmed,
 * labels printed by scanning, progress 1..N). These helpers keep every send
 * inside the true gaps, so a suggested or chosen range never crosses a
 * printed island without the person choosing to print it again.
 */

/** Merged, sorted, clipped to 1..total. */
export function mergeSpans(spans: ReadonlyArray<OfficeSpan>, total = Infinity): OfficeSpan[] {
  const sorted = spans
    .map((s) => ({ from: Math.max(1, Math.floor(s.from)), to: Math.min(total, Math.floor(s.to)) }))
    .filter((s) => Number.isFinite(s.from) && Number.isFinite(s.to) && s.from <= s.to)
    .sort((a, b) => a.from - b.from);
  const out: OfficeSpan[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.from <= last.to + 1) last.to = Math.max(last.to, s.to); else out.push({ ...s });
  }
  return out;
}

/** The labels of from..to that are not in `avoid`, as spans. */
export function spansWithout(from: number, to: number, avoid: ReadonlyArray<OfficeSpan>): OfficeSpan[] {
  const out: OfficeSpan[] = [];
  let next = from;
  for (const a of mergeSpans(avoid)) {
    if (a.to < next) continue;
    if (a.from > to) break;
    if (a.from > next) out.push({ from: next, to: Math.min(to, a.from - 1) });
    next = Math.max(next, a.to + 1);
    if (next > to) break;
  }
  if (next <= to) out.push({ from: next, to });
  return out;
}

/** The labels of from..to that are in `spans`, as spans. */
export function spansWithin(from: number, to: number, spans: ReadonlyArray<OfficeSpan>): OfficeSpan[] {
  return mergeSpans(spans).map((s) => ({ from: Math.max(from, s.from), to: Math.min(to, s.to) })).filter((s) => s.from <= s.to);
}

/** How many labels the spans hold. */
export function spanCount(spans: ReadonlyArray<OfficeSpan>): number {
  return spans.reduce((n, s) => n + s.to - s.from + 1, 0);
}

/** Label numbers as spans: 3,4,5,9 -> 3–5, 9. */
export function labelsToSpans(labels: ReadonlyArray<number>): OfficeSpan[] {
  return mergeSpans(labels.filter((n) => Number.isInteger(n) && n > 0).map((n) => ({ from: n, to: n })));
}

/**
 * The range to suggest next: the office's own rule (after the progress,
 * never into office work), then kept inside the first gap that is still to
 * go, so it never runs over labels a person confirmed or printed by scanning.
 * `toGo` undefined: no print history known, the office's rule alone.
 */
export function gapSuggestion(jobs: ReadonlyArray<OfficeJobLike>, total: number, printedCount: number, toGo?: ReadonlyArray<OfficeSpan>): OfficeSpan | null {
  if (!toGo) return suggestOfficeRange(jobs, total, printedCount, Infinity);
  const gaps = mergeSpans(toGo, total);
  let through = Math.max(0, Math.floor(printedCount) || 0);
  for (let guard = 0; guard < 10_000; guard++) {
    const next = suggestOfficeRange(jobs, total, through, Infinity);
    if (!next) return null;
    const gap = gaps.find((g) => g.to >= next.from);
    if (!gap) return null;
    if (gap.from > next.from) { through = gap.from - 1; continue; }
    return { from: next.from, to: Math.min(next.to, gap.to) };
  }
  return null;
}

/**
 * What a chosen range would print again, and the gaps that can go instead.
 * `printed`: labels counted as printed (the complement of the labels still
 * to go); `skip`: labels that can't be sent at all (left out by the person).
 */
export function rangeGaps(from: number, to: number, toGo: ReadonlyArray<OfficeSpan> | undefined, skip: ReadonlyArray<OfficeSpan> = []): { printed: OfficeSpan[]; gaps: OfficeSpan[]; skipped: OfficeSpan[] } {
  const gapsOnly = toGo ? spansWithin(from, to, toGo) : [{ from, to }];
  const printed = toGo ? spansWithout(from, to, toGo) : [];
  const skipped = spansWithin(from, to, skip);
  const gaps = gapsOnly.flatMap((g) => spansWithout(g.from, g.to, skip));
  return { printed, gaps, skipped };
}

/** One explicit "Send all in parts" over several gaps: each gap in parts the office takes. */
export function partsForSpans(spans: ReadonlyArray<OfficeSpan>, cap: number, across = 1): OfficeSpan[] {
  return mergeSpans(spans).flatMap((s) => officeSendParts(s.from, s.to, cap, across));
}

/** "41–60, 81–99 and 102–120", with word joiners so a span stays on one line. */
export function spanListWords(spans: ReadonlyArray<OfficeSpan>): string {
  const one = (s: OfficeSpan) => (s.from === s.to ? s.from.toLocaleString('en-US') : `${s.from.toLocaleString('en-US')}⁠–⁠${s.to.toLocaleString('en-US')}`);
  const words = spans.map(one);
  return words.length <= 1 ? words[0] ?? '' : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * A saved "Send all in parts" plan, minus every label already counted as
 * printed: the progress, office ranges a person confirmed and labels printed
 * by scanning (the same counted labels a fresh send leaves out). A part that
 * a printed island splits becomes one part per gap, each smaller than the
 * part it came from. `toGo` undefined: no print history known, the progress
 * alone. `trimmed`: the labels taken out, merged. Printing them again stays
 * its own choice ("Print some labels again…").
 */
export function partsAfterCounted(parts: ReadonlyArray<OfficeSpan>, printedCount: number, toGo?: ReadonlyArray<OfficeSpan>): { parts: OfficeSpan[]; trimmed: OfficeSpan[] } {
  const printed = Math.max(0, Math.floor(printedCount) || 0);
  const kept: OfficeSpan[] = [];
  const out: OfficeSpan[] = [];
  for (const part of parts) {
    let left = spansWithout(part.from, part.to, printed > 0 ? [{ from: 1, to: printed }] : []);
    if (toGo) left = left.flatMap((s) => spansWithin(s.from, s.to, toGo));
    kept.push(...left);
    out.push(...spansWithout(part.from, part.to, left));
  }
  return { parts: kept, trimmed: mergeSpans(out) };
}
