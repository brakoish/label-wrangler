'use client';
import { BarcodeWarning, FixInDesignerLink } from '@/components/checks/BarcodeWarning';
import { ProblemList } from '@/components/checks/RunChecks';
import { LAYOUT_GO_AHEAD, stopFixWords, type RunPrintCheck } from '@/lib/runLayoutCheck';
import { barcodeItemTicked } from '@/lib/runBarcodeTicks';

/**
 * The run page's check before printing, in the same words and shape as the
 * new-run page: one plain sentence per barcode problem (measurements behind
 * "Why?"), its own "Print anyway" tick, and "Fix in the designer"; then
 * barcodes close to the edge and overlaps (one tick, as on the new-run
 * page). A problem the exact renderer refuses has no tick: nothing prints.
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
  if (!check.blocking.length && !check.tight.length && !check.layout.length) return null;
  return (
    <div className="space-y-3">
      <BarcodeWarning
        items={check.blocking}
        stops={check.verdict.stops}
        stopWords={stopFixWords(check.verdict.fixIn)}
        isTicked={(item) => barcodeItemTicked(item, ticks, wizardGoAhead)}
        onTick={onTick}
        why="This run keeps the design it started with: after fixing it, use Re-run with the same data (More menu) to print with the fix."
        fix={<FixInDesignerLink href={designHref} />}
      />
      <ProblemList heading="Barcodes close to the edge" items={check.tight.slice(0, 3)} more={check.tight.length - Math.min(3, check.tight.length)} />
      <ProblemList
        heading="Some items overlap or run off the label"
        items={check.layout.slice(0, 6)}
        more={check.layout.length - Math.min(6, check.layout.length)}
        confirmLabel={LAYOUT_GO_AHEAD}
        confirmed={layoutGoAhead}
        onConfirmedChange={onLayoutGoAhead}
      />
    </div>
  );
}
