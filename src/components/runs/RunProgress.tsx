'use client';
import { spanWords, type OfficeSpan } from '@/lib/officeRange';
import { printedSpans, stillToGo } from '@/lib/runProgress';

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
export function RunProgress({ printedCount, total, confirmed, sent = [], waiting = [], waitingLabel = 'waiting at the office', tone, animate = false }: {
  printedCount: number; total: number; confirmed: ReadonlyArray<OfficeSpan>;
  /** Labels the office reported sent to the printer, not counted as printed yet. */
  sent?: ReadonlyArray<OfficeSpan>;
  /** Labels at the office that haven't gone to the printer yet. */
  waiting?: ReadonlyArray<OfficeSpan>;
  /** Their words ("waiting at the office", "on the way to the office printer"); empty when the office panel already says it. */
  waitingLabel?: string;
  tone: 'done' | 'active' | 'muted'; animate?: boolean;
}) {
  const spans = printedSpans(printedCount, confirmed, total);
  const printed = spans.reduce((n, s) => n + s.to - s.from + 1, 0);
  const sentOnly = without(sent, spans, total);
  const sentCount = sentOnly.reduce((n, s) => n + s.to - s.from + 1, 0);
  const waitingOnly = without(waiting, [...spans, ...sentOnly], total);
  const waitingCount = waitingOnly.reduce((n, s) => n + s.to - s.from + 1, 0);
  const lighter = [...sentOnly, ...waitingOnly];
  const covered = printedSpans(0, [...spans, ...lighter], total);
  const left = stillToGo(covered, total);
  const gapped = covered.length > 1 || (covered.length === 1 && covered[0].from > 1);
  const fill = tone === 'done' ? 'bg-emerald-400' : tone === 'active' ? 'bg-amber-500' : 'bg-zinc-500';
  const sentFill = tone === 'muted' ? 'bg-zinc-600' : 'bg-amber-500/35';
  const leftWords = spanWords(left);
  const motion = animate ? 'transition-[left,width,background-color] duration-300 ease-in-out' : '';
  const officeWords = [sentCount ? `${sentCount.toLocaleString()} sent to the printer` : '', waitingCount && waitingLabel ? `${waitingCount.toLocaleString()} ${waitingLabel}` : ''].filter(Boolean);
  const valueText = [`${printed.toLocaleString()} of ${total.toLocaleString()} printed`, ...officeWords, gapped && left.length ? `${leftWords} still to go` : ''].filter(Boolean).join('; ');
  return <div className="space-y-2">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="section-title">Progress</h2>
      <span className="text-sm font-medium text-zinc-100 tabular-nums">Printed {printed.toLocaleString()} of {total.toLocaleString()}</span>
    </div>
    <div className="relative h-2 rounded-full bg-zinc-800 overflow-hidden" role="progressbar" aria-label="Labels printed" aria-valuemin={0} aria-valuemax={total} aria-valuenow={printed} aria-valuetext={officeWords.length || (gapped && left.length) ? valueText : undefined}>
      {total > 0 && lighter.map((s) => (
        <div key={`sent-${s.from}-${s.to}`} className={`progress-seg absolute inset-y-0 rounded-full ${sentFill} ${motion}`}
          style={{ left: `${((s.from - 1) / total) * 100}%`, width: `${((s.to - s.from + 1) / total) * 100}%` }} />
      ))}
      {total > 0 && spans.map((s) => (
        <div key={`${s.from}-${s.to}`} className={`progress-seg absolute inset-y-0 rounded-full ${fill} ${motion}`}
          style={{ left: `${((s.from - 1) / total) * 100}%`, width: `${((s.to - s.from + 1) / total) * 100}%` }} />
      ))}
    </div>
    {officeWords.length > 0 && <p className="reveal text-sm text-zinc-300 tabular-nums">{officeWords.join(' · ')}</p>}
    {gapped && left.length > 0 && <p className="reveal text-sm text-zinc-400 tabular-nums">{leftWords.charAt(0).toUpperCase() + leftWords.slice(1)} still to go.</p>}
  </div>;
}
