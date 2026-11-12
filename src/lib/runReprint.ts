import { labelSpans, type LabelSpan } from './scannedLabels';

/**
 * Printing labels that already printed is allowed whenever someone asks:
 * nothing stops to ask first. Each label that prints a second time is kept in
 * the print history as a reprint, and the run's progress ("printed up to label
 * N") never goes down because of one.
 */

/** The history message every reprint carries (printEventLabel reads "Reprint…" as a reprint). */
export const REPRINT_MESSAGE = 'Reprint (run progress unchanged)';

export interface StartReprintPlan {
  /** Every label in from–to is within the progress: the whole range is a reprint and progress stays as it is. */
  allPrinted: boolean;
  /** Progress to save when printing starts: what is printed already, never lower. */
  startCount: number;
  /** Labels in from–to that print a second time, as sorted spans. */
  again: LabelSpan[];
}

/**
 * What a Print over from–to does with labels that already printed. Labels up
 * to `printedCount` and those in `printedElsewhere` (printed by scanning,
 * with "Print only" or confirmed at the office) print again, as reprints.
 */
export function planStartReprints(printedCount: number, from: number, to: number, printedElsewhere: ReadonlyArray<number> = []): StartReprintPlan {
  const printed = Math.max(0, Math.floor(printedCount) || 0);
  const head: LabelSpan[] = from <= printed ? [{ from, to: Math.min(to, printed) }] : [];
  const ahead = labelSpans(printedElsewhere.filter((n) => n > printed && n >= from && n <= to));
  return { allPrinted: to <= printed, startCount: printed, again: [...head, ...ahead] };
}

/** Progress after `physical` labels of a print that started at `startCount`: a high-water mark, never lower. */
export function progressAfter(startCount: number, physical: number): number {
  return Math.max(startCount, physical);
}

/** The labels of `spans` sent by the time the print reached label `upTo` (a span cut short is clipped). */
export function reprintSpansDone(spans: ReadonlyArray<LabelSpan>, upTo: number): LabelSpan[] {
  return spans.filter((s) => s.from <= upTo).map((s) => ({ from: s.from, to: Math.min(s.to, upTo) }));
}

function spanText(s: LabelSpan): string {
  return s.from === s.to ? s.from.toLocaleString('en-US') : `${s.from.toLocaleString('en-US')}–${s.to.toLocaleString('en-US')}`;
}

/** "labels 3–4 and 9", with the rest counted after five pieces. */
export function againWords(spans: ReadonlyArray<LabelSpan>): string {
  if (!spans.length) return '';
  const shown = spans.slice(0, 5).map(spanText);
  const rest = spans.slice(5).reduce((n, s) => n + s.to - s.from + 1, 0);
  const single = spans.length === 1 && spans[0].from === spans[0].to;
  const list = rest ? `${shown.join(', ')} and ${rest.toLocaleString('en-US')} more` : shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  return `${single ? 'label' : 'labels'} ${list}`;
}

/** The short note after printing: "Labels 3–4 printed again (logged as a reprint)." */
export function againNotice(spans: ReadonlyArray<LabelSpan>): string {
  const words = againWords(spans);
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)} printed again (logged as a reprint).` : '';
}

/**
 * Print-history entries for the reprinted spans: one each, so the history
 * names exactly which labels printed twice. Past `max` entries the rest share
 * one entry over their whole stretch, its message naming them.
 */
export function reprintEntries(spans: ReadonlyArray<LabelSpan>, max = 20): Array<LabelSpan & { labelCount: number; message: string }> {
  const one = (s: LabelSpan) => ({ from: s.from, to: s.to, labelCount: s.to - s.from + 1, message: REPRINT_MESSAGE });
  if (spans.length <= max) return spans.map(one);
  const rest = spans.slice(max - 1);
  const count = rest.reduce((n, s) => n + s.to - s.from + 1, 0);
  return [...spans.slice(0, max - 1).map(one), { from: rest[0].from, to: rest[rest.length - 1].to, labelCount: count, message: `${REPRINT_MESSAGE}: ${againWords(rest)}` }];
}
