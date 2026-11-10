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
 * when the printed labels aren't one stretch from label 1. Labels sent to
 * the office printer that nobody has checked yet are drawn lighter and
 * counted apart ("75 sent, not checked yet"): sent is never printed until a
 * person says so, and "still to go" names only labels never sent.
 */
export function RunProgress({ printedCount, total, confirmed, sent = [], tone, animate = false }: {
  printedCount: number; total: number; confirmed: ReadonlyArray<OfficeSpan>;
  /** Labels at or sent to the office printer, not counted as printed yet. */
  sent?: ReadonlyArray<OfficeSpan>;
  tone: 'done' | 'active' | 'muted'; animate?: boolean;
}) {
  const spans = printedSpans(printedCount, confirmed, total);
  const printed = spans.reduce((n, s) => n + s.to - s.from + 1, 0);
  const sentOnly = without(sent, spans, total);
  const sentCount = sentOnly.reduce((n, s) => n + s.to - s.from + 1, 0);
  const covered = printedSpans(0, [...spans, ...sentOnly], total);
  const left = stillToGo(covered, total);
  const gapped = covered.length > 1 || (covered.length === 1 && covered[0].from > 1);
  const fill = tone === 'done' ? 'bg-emerald-400' : tone === 'active' ? 'bg-amber-500' : 'bg-zinc-500';
  const sentFill = tone === 'muted' ? 'bg-zinc-600' : 'bg-amber-500/35';
  const leftWords = spanWords(left);
  const motion = animate ? 'transition-[left,width,background-color] duration-300 ease-in-out' : '';
  const valueText = [`${printed} of ${total} printed`, sentCount ? `${sentCount} sent, not checked yet` : '', gapped && left.length ? `${leftWords} still to go` : ''].filter(Boolean).join('; ');
  return <div className="space-y-2">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="section-title">Progress</h2>
      <span className="text-sm font-medium text-zinc-100 tabular-nums">Printed {printed.toLocaleString()} of {total.toLocaleString()}</span>
    </div>
    <div className="relative h-2 rounded-full bg-zinc-800 overflow-hidden" role="progressbar" aria-label="Labels printed" aria-valuemin={0} aria-valuemax={total} aria-valuenow={printed} aria-valuetext={sentCount || (gapped && left.length) ? valueText : undefined}>
      {total > 0 && sentOnly.map((s) => (
        <div key={`sent-${s.from}-${s.to}`} className={`progress-seg absolute inset-y-0 rounded-full ${sentFill} ${motion}`}
          style={{ left: `${((s.from - 1) / total) * 100}%`, width: `${((s.to - s.from + 1) / total) * 100}%` }} />
      ))}
      {total > 0 && spans.map((s) => (
        <div key={`${s.from}-${s.to}`} className={`progress-seg absolute inset-y-0 rounded-full ${fill} ${motion}`}
          style={{ left: `${((s.from - 1) / total) * 100}%`, width: `${((s.to - s.from + 1) / total) * 100}%` }} />
      ))}
    </div>
    {sentCount > 0 && <p className="reveal text-sm text-zinc-300 tabular-nums">{sentCount.toLocaleString()} sent to the office printer, not checked yet</p>}
    {gapped && left.length > 0 && <p className="reveal text-sm text-zinc-400 tabular-nums">{leftWords.charAt(0).toUpperCase() + leftWords.slice(1)} still to go.</p>}
  </div>;
}
