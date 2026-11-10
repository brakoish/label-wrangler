'use client';

import { useState, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import type { LayoutProblem } from '@/lib/designerLayout';
import { barcodeHasDetails, barcodePlainSentence } from '@/lib/runBarcodeTicks';
import { WhyToggle } from '@/components/checks/BarcodeWarning';

const SHOWN = 3;

/** The problem's full words: what is wrong, then the fix. */
export function problemText(problem: LayoutProblem): string {
  return `${problem.message}${problem.fix ? ` ${problem.fix.replace(/\.$/, '')}.` : ''}`;
}

/**
 * What is wrong with the design, above the label (the editing canvas and the
 * exact print view show the same notice): one plain sentence per problem,
 * problems that stop printing first, a barcode's measurements behind "Why?",
 * and the fix buttons under them.
 */
export function DesignNotice({ problems, action }: { problems: ReadonlyArray<LayoutProblem>; action?: ReactNode }) {
  const [showAll, setShowAll] = useState(false);
  if (!problems.length) return null;
  const sorted = [...problems].sort((a, b) => Number(!!b.blocking) - Number(!!a.blocking));
  const shown = showAll ? sorted : sorted.slice(0, SHOWN);
  const hidden = sorted.length - shown.length;
  return (
    <div role="status" className="space-y-1.5 text-sm">
      <ul className="space-y-1">
        {shown.map((problem) => {
          const full = problemText(problem);
          const barcode = !!problem.barcodeFit;
          const sentence = barcode ? barcodePlainSentence(full) : full;
          return (
            <li key={problem.ids.join(',') + problem.kind} className="fold-reveal flex items-start gap-1.5">
              <AlertCircle className={`mt-0.5 size-4 shrink-0 ${problem.blocking ? 'text-red-400' : 'text-amber-300'}`} aria-hidden="true" />
              <div className="min-w-0 flex-1 text-zinc-100">
                <span>{sentence}</span>
                {barcode && barcodeHasDetails(full) && <> <WhyToggle>{full}</WhyToggle></>}
              </div>
            </li>
          );
        })}
      </ul>
      {(hidden > 0 || (showAll && sorted.length > SHOWN)) && (
        <button type="button" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)} className="link inline-flex min-h-control-sm items-center pl-5.5">
          {showAll ? 'Show fewer' : `Show ${hidden} more`}
        </button>
      )}
      {action && <div className="flex flex-wrap items-center gap-2 pl-5.5">{action}</div>}
    </div>
  );
}
