'use client';
import Link from 'next/link';
import { BarcodeWarning, FixInDesignerLink } from '@/components/checks/BarcodeWarning';
import { ProblemList } from '@/components/checks/RunChecks';
import { LAYOUT_GO_AHEAD, stopFixWords, type RunPrintCheck } from '@/lib/runLayoutCheck';
import { barcodeItemTicked } from '@/lib/runBarcodeTicks';

/**
 * A run keeps the design it started with, so a design fix prints only in a
 * re-run. Send "Done" in the designer to a re-run with the same data
 * (/runs/new?duplicateFrom=<id>) instead of back to this unchanged run.
 */
export function rerunAfterFixHref(designHref: string): string {
  try {
    const url = new URL(designHref, 'https://label-wrangler.invalid');
    const back = url.searchParams.get('returnTo') ?? '';
    const runId = back.match(/^\/runs\/([^/?#]+)$/)?.[1];
    if (!runId || runId === 'new') return designHref;
    url.searchParams.set('returnTo', `/runs/new?duplicateFrom=${encodeURIComponent(runId)}`);
    return `${url.pathname}${url.search}`;
  } catch { return designHref; }
}

/** A value fixed in the spreadsheet: re-run with the corrected file. */
function RerunLink({ designHref }: { designHref: string }) {
  const href = new URL(rerunAfterFixHref(designHref), 'https://label-wrangler.invalid').searchParams.get('returnTo');
  if (!href?.startsWith('/runs/new?')) return null;
  return <Link href={href} className="link inline-flex min-h-11 items-center">Re-run with the fixed file</Link>;
}

/**
 * The run page's check before printing, in the same words and shape as the
 * new-run page: one plain sentence per barcode problem (measurements behind
 * "Why?"), its own tick (with the count when one tick covers several
 * labels), and "Fix the design and re-run", which comes back to a re-run
 * with the same data, since this run keeps its design; then
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
        why="This run keeps the design it started with, so a fix prints in a re-run with the same data."
        fix={check.verdict.fixIn === 'data'
          ? <RerunLink designHref={designHref} />
          : <FixInDesignerLink href={rerunAfterFixHref(designHref)} label="Fix the design and re-run" />}
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
