'use client';
import { spanWords, type OfficeSpan } from '@/lib/officeRange';
import { printedSpans, stillToGo } from '@/lib/runProgress';

/**
 * Progress for a run: every label counted as printed, wherever it sits, so
 * marking 5–10 printed reads "6 of 20", with one line naming what is left
 * when the printed labels aren't one stretch from label 1.
 */
export function RunProgress({ printedCount, total, confirmed, tone, animate = false }: {
  printedCount: number; total: number; confirmed: ReadonlyArray<OfficeSpan>;
  tone: 'done' | 'active' | 'muted'; animate?: boolean;
}) {
  const spans = printedSpans(printedCount, confirmed, total);
  const printed = spans.reduce((n, s) => n + s.to - s.from + 1, 0);
  const left = stillToGo(spans, total);
  const gapped = spans.length > 1 || (spans.length === 1 && spans[0].from > 1);
  const fill = tone === 'done' ? 'bg-emerald-400' : tone === 'active' ? 'bg-amber-500' : 'bg-zinc-500';
  const leftWords = spanWords(left);
  return <div className="space-y-2">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="section-title">Progress</h2>
      <span className="text-sm font-medium text-zinc-100 tabular-nums">Printed {printed.toLocaleString()} of {total.toLocaleString()}</span>
    </div>
    <div className="relative h-2 rounded-full bg-zinc-800 overflow-hidden" role="progressbar" aria-label="Labels printed" aria-valuemin={0} aria-valuemax={total} aria-valuenow={printed} aria-valuetext={gapped && left.length ? `${printed} of ${total} printed; ${leftWords} still to go` : undefined}>
      {total > 0 && spans.map((s) => (
        <div key={`${s.from}-${s.to}`} className={`progress-seg absolute inset-y-0 rounded-full ${fill} ${animate ? 'transition-[left,width,background-color] duration-300 ease-in-out' : ''}`}
          style={{ left: `${((s.from - 1) / total) * 100}%`, width: `${((s.to - s.from + 1) / total) * 100}%` }} />
      ))}
    </div>
    {gapped && left.length > 0 && <p className="reveal text-sm text-zinc-400 tabular-nums">{leftWords.charAt(0).toUpperCase() + leftWords.slice(1)} still to go.</p>}
  </div>;
}
