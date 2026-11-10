'use client';
import Link from 'next/link';
import { AlertCircle, PenTool } from 'lucide-react';
import { useId } from 'react';
import { ProblemList } from '@/components/checks/RunChecks';
import { LAYOUT_GO_AHEAD, type RunPrintCheck } from '@/lib/runLayoutCheck';
import { barcodeDamage, barcodeItemTicked, barcodeProblemSevere, barcodeTickLabel, runPageProblemText } from '@/lib/runBarcodeTicks';

const MAX_ITEMS = 6;

/**
 * The run page's check before printing: each barcode problem with what
 * printing it anyway really costs and its own tick, a link to fix the
 * design, then barcodes close to the edge and overlaps (one tick, as in the
 * wizard). A problem the exact renderer refuses has no tick: nothing prints.
 */
export function RunBarcodeCheck({ check, ticks, wizardGoAhead, onTick, layoutGoAhead, onLayoutGoAhead, designHref }: {
  check: RunPrintCheck;
  ticks: ReadonlyArray<string>;
  wizardGoAhead: boolean;
  onTick: (item: string, value: boolean) => void;
  layoutGoAhead: boolean;
  onLayoutGoAhead: (value: boolean) => void;
  designHref: string;
}) {
  const uid = useId();
  if (!check.blocking.length && !check.tight.length && !check.layout.length) return null;
  const shown = check.blocking.slice(0, MAX_ITEMS);
  const more = check.blocking.length - shown.length;
  return (
    <div className="space-y-3">
      {check.blocking.length > 0 && (
        <div role="alert" className="space-y-2 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-red-400">
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            {check.verdict.heading}
          </p>
          <ul className="space-y-3 pl-5.5">
            {shown.map((item, i) => {
              const severe = barcodeProblemSevere(item);
              const ticked = barcodeItemTicked(item, ticks, wizardGoAhead);
              return (
                <li key={item} className="space-y-1">
                  <p className="text-zinc-300">{runPageProblemText(item)}</p>
                  {!check.verdict.stops && <p className={severe ? 'text-red-300' : 'text-zinc-400'}>{barcodeDamage(item)}</p>}
                  {!check.verdict.stops && (
                    <label htmlFor={`${uid}-${i}`} className="flex min-h-11 items-center gap-3 text-zinc-100">
                      <input id={`${uid}-${i}`} type="checkbox" className="size-5 shrink-0 accent-amber-500" checked={ticked} onChange={(e) => onTick(item, e.target.checked)} />
                      <span>{barcodeTickLabel(item)}</span>
                    </label>
                  )}
                </li>
              );
            })}
            {more > 0 && (
              <li className="space-y-1">
                <p className="text-zinc-300">And {more.toLocaleString()} more barcode problem{more === 1 ? '' : 's'} like these.</p>
                {!check.verdict.stops && (
                  <label htmlFor={`${uid}-more`} className="flex min-h-11 items-center gap-3 text-zinc-100">
                    <input id={`${uid}-more`} type="checkbox" className="size-5 shrink-0 accent-amber-500"
                      checked={check.blocking.slice(MAX_ITEMS).every((item) => barcodeItemTicked(item, ticks, wizardGoAhead))}
                      onChange={(e) => { for (const item of check.blocking.slice(MAX_ITEMS)) onTick(item, e.target.checked); }} />
                    <span>Print anyway — I accept {more === 1 ? 'it' : 'these'} too</span>
                  </label>
                )}
              </li>
            )}
          </ul>
          {check.verdict.stops && <p className="pl-5.5 text-zinc-300">Nothing can print until the design is fixed.</p>}
          <div className="space-y-1 pl-5.5">
            <Link href={designHref} className="btn btn-secondary btn-sm"><PenTool className="size-4" aria-hidden="true" />Fix the design</Link>
            <p className="text-zinc-400">This run keeps the design it started with. After fixing it, use Re-run with the same data (More menu) to print with the fix.</p>
          </div>
        </div>
      )}
      <ProblemList heading="Barcodes close to the edge" items={check.tight.slice(0, 3)} more={check.tight.length - Math.min(3, check.tight.length)} />
      <ProblemList
        heading="Some items overlap or run off the label"
        items={check.layout.slice(0, MAX_ITEMS)}
        more={check.layout.length - Math.min(MAX_ITEMS, check.layout.length)}
        confirmLabel={LAYOUT_GO_AHEAD}
        confirmed={layoutGoAhead}
        onConfirmedChange={onLayoutGoAhead}
      />
    </div>
  );
}
