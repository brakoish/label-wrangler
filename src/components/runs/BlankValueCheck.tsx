'use client';

import { useId } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { blankRemedy, describeBlankIssue, describeBlankSummary, type RunDataCheck } from '@/lib/runDataCheck';

const MAX_LINES = 5;

/**
 * Shows the whole-run blank-value check before printing can start.
 * Blocks by default; offers a deliberate "leave blank" choice only when the
 * generator would really print blank (never when it would print the sample).
 */
export function BlankValueCheck({ check, leaveBlank, onLeaveBlankChange, showWhenOk = true, compact = false, remedy }: {
  check: RunDataCheck;
  leaveBlank: boolean;
  onLeaveBlankChange: (value: boolean) => void;
  showWhenOk?: boolean;
  compact?: boolean;
  /** Replaces the default "fix your spreadsheet" advice where that doesn't apply (scan mode). */
  remedy?: string;
}) {
  const checkboxId = useId();
  if (!check.issues.length) {
    if (!showWhenOk || check.checkedLabels === 0) return null;
    return (
      <p className="flex items-center gap-1.5 text-sm text-emerald-400">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
        {describeBlankSummary(check)}
      </p>
    );
  }
  const lines = check.issues.slice(0, MAX_LINES).map((issue) => describeBlankIssue(issue, check.checkedLabels));
  const hiddenCount = check.issues.length - lines.length;
  return (
    <div role="alert" className={`rounded-lg border border-amber-500/30 bg-amber-500/10 ${compact ? 'p-2.5' : 'p-3'} space-y-2 text-sm text-amber-200`}>
      <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-300">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {describeBlankSummary(check)}
      </p>
      <ul className="list-disc space-y-1 pl-5">
        {lines.map((line) => <li key={line}>{line}</li>)}
        {hiddenCount > 0 && <li>…and {hiddenCount} more field{hiddenCount === 1 ? '' : 's'}.</li>}
      </ul>
      <p className="text-amber-200">{remedy ?? blankRemedy(check)}</p>
      {check.canLeaveBlank && (
        <label htmlFor={checkboxId} className="flex items-start gap-2 rounded-md bg-zinc-950 p-2.5 text-zinc-200">
          <input id={checkboxId} type="checkbox" className="mt-0.5 size-4 shrink-0 accent-amber-500" checked={leaveBlank} onChange={(e) => onLeaveBlankChange(e.target.checked)} />
          <span>Print {check.blankLabels === 1 ? 'this label' : `these ${check.blankLabels.toLocaleString()} labels`} with {check.issues.length === 1 ? 'that field' : 'those fields'} left blank.</span>
        </label>
      )}
    </div>
  );
}
