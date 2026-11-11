'use client';
import { type OfficeSpan } from '@/lib/officeRange';
import { intersectSpans, printedSpans, stillToGo, PROGRESS_FILL, PROGRESS_OFFICE_TINT } from '@/lib/runProgress';

/** "41–60, 81–89, 93–120": label numbers only, each range kept on one line. */
export function spanNumbers(spans: ReadonlyArray<OfficeSpan>): string {
  return spans.map((s) => (s.from === s.to ? s.from.toLocaleString() : `${s.from.toLocaleString()}\u2060–\u2060${s.to.toLocaleString()}`)).join(', ');
}

/** Labels in `spans` that aren't in `minus`, merged. */
function without(spans: ReadonlyArray<OfficeSpan>, minus: ReadonlyArray<OfficeSpan>, total: number): OfficeSpan[] {
  const merged = printedSpans(0, spans, total);
  const out: OfficeSpan[] = [];
  for (const s of merged) {
    let from = s.from;
    for (const m of minus) {
      if (m.to < from || m.from > s.to) continue;
      if (m.from > from) out.push({ from, to: m.from - 1 });
      from = Math.max(from, m.to + 1);
    }
    if (from <= s.to) out.push({ from, to: s.to });
  }
  return out;
}

/**
 * What the progress line names: printed stretches, office labels drawn
 * lighter, and the labels still to go (never printed, not at the office).
 * `shown` is true when the progress line spells those labels out (the
 * printed labels aren't one stretch from label 1). The office panel reads
 * this too, so "still to go" is said once, from one place.
 */
export function progressParts(printedCount: number, total: number, confirmed: ReadonlyArray<OfficeSpan>, sent: ReadonlyArray<OfficeSpan> = [], waiting: ReadonlyArray<OfficeSpan> = []) {
  const spans = printedSpans(printedCount, confirmed, total);
  const sentOnly = without(sent, spans, total);
  const waitingOnly = without(waiting, [...spans, ...sentOnly], total);
  const covered = printedSpans(0, [...spans, ...sentOnly, ...waitingOnly], total);
  const left = stillToGo(covered, total);
  const gapped = covered.length > 1 || (covered.length === 1 && covered[0].from > 1);
  return { spans, sentOnly, waitingOnly, left, shown: gapped && left.length > 0 };
}

/**
 * Progress for a run: every label counted as printed, wherever it sits, so
 * marking 5–10 printed reads "6 of 20", with one line naming what is left
 * when the printed labels aren't one stretch from label 1. Office labels
 * not counted as printed are drawn lighter and counted apart, with the same
 * words as the office panel: "20 sent to the printer" (the office reported
 * them sent; a person still says whether they came out) and "60 waiting at
 * the office" (accepted, not sent to the printer yet, for example while it
 * is paused). Neither is ever called printed, and "still to go" names only
 * labels never sent.
 */
export function RunProgress({ printedCount, total, confirmed, sent = [], waiting = [], waitingLabel = 'waiting at the office', named = [], tone, animate = false }: {
  printedCount: number; total: number; confirmed: ReadonlyArray<OfficeSpan>;
  /** Labels the office reported sent to the printer, not counted as printed yet. */
  sent?: ReadonlyArray<OfficeSpan>;
  /** Labels at the office that haven't gone to the printer yet. */
  waiting?: ReadonlyArray<OfficeSpan>;
  /** Their words ("waiting at the office", "on the way to the office printer"); empty when the office panel already says it. */
  waitingLabel?: string;
  /** Labels the panel already names on their own line ("Out of labels: 66–90"): "Still to go" doesn't repeat them. */
  named?: ReadonlyArray<OfficeSpan>;
  tone: 'done' | 'active' | 'muted'; animate?: boolean;
}) {
  const parts = progressParts(printedCount, total, confirmed, sent, waiting);
  const { spans, sentOnly, waitingOnly } = parts;
  const left = named.length ? intersectSpans(parts.left, stillToGo([...named].sort((a, b) => a.from - b.from), total)) : parts.left;
  const shown = parts.shown && left.length > 0;
  const printed = spans.reduce((n, s) => n + s.to - s.from + 1, 0);
  const sentCount = sentOnly.reduce((n, s) => n + s.to - s.from + 1, 0);
  const waitingCount = waitingOnly.reduce((n, s) => n + s.to - s.from + 1, 0);
  // One colour rule (the Runs list uses it too): printed solid, labels at
  // the office not counted yet in a lighter tint of the same colour, named in
  // the words under the bar.
  const fill = PROGRESS_FILL[tone];
  const sentFill = PROGRESS_OFFICE_TINT[tone];
  const waitingFill = PROGRESS_OFFICE_TINT[tone];
  const leftWords = spanNumbers(left);
  const motion = animate ? 'transition-[left,width,background-color] duration-300 ease-in-out' : '';
  const officeKey = [sentCount ? { words: `${sentCount.toLocaleString()} sent to the printer`, fill: sentFill } : null, waitingCount && waitingLabel ? { words: `${waitingCount.toLocaleString()} ${waitingLabel}`, fill: waitingFill } : null].filter((k): k is { words: string; fill: string } => !!k);
  const officeWords = officeKey.map((k) => k.words);
  const valueText = [`${printed.toLocaleString()} of ${total.toLocaleString()} printed`, ...officeWords, shown ? `Still to go: ${leftWords}` : ''].filter(Boolean).join('; ');
  return <div className="space-y-2">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="section-title">Progress</h2>
      <span className="text-sm font-medium text-zinc-100 tabular-nums">Printed {printed.toLocaleString()} of {total.toLocaleString()}</span>
    </div>
    <div className="relative h-2 rounded-full bg-zinc-800 overflow-hidden" role="progressbar" aria-label="Labels printed" aria-valuemin={0} aria-valuemax={total} aria-valuenow={printed} aria-valuetext={officeWords.length || shown ? valueText : undefined}>
      {total > 0 && [...sentOnly.map((s) => ({ ...s, fill: sentFill, kind: 'sent' })), ...waitingOnly.map((s) => ({ ...s, fill: waitingFill, kind: 'waiting' }))].map((s) => (
        <div key={`${s.kind}-${s.from}-${s.to}`} className={`progress-seg absolute inset-y-0 rounded-full ${s.fill} ${motion}`}
          style={{ left: `${((s.from - 1) / total) * 100}%`, width: `${((s.to - s.from + 1) / total) * 100}%` }} />
      ))}
      {total > 0 && spans.map((s) => (
        <div key={`${s.from}-${s.to}`} className={`progress-seg absolute inset-y-0 rounded-full ${fill} ${motion}`}
          style={{ left: `${((s.from - 1) / total) * 100}%`, width: `${((s.to - s.from + 1) / total) * 100}%` }} />
      ))}
    </div>
    {officeKey.length > 0 && <p className="reveal flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-300 tabular-nums">{officeKey.map((k) => (
      <span key={k.words} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${k.fill}`} />{k.words}</span>
    ))}</p>}
    {shown && <p className="reveal text-sm text-zinc-400 tabular-nums">Still to go: {spanNumbers(left)}</p>}
  </div>;
}
