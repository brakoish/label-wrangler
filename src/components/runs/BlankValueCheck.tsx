'use client';

import { useId, useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { blankRemedy, describeBlankIssue, describeBlankLine, describeBlankSummary, type RunDataCheck } from '@/lib/runDataCheck';
import { fieldDisplayName } from '@/lib/fieldDisplayName';
import { Fold, FoldToggle } from '@/components/ui/Fold';

const MAX_LINES = 5;

/**
 * Shows the whole-run blank-value check before printing can start: one line
 * ("3 labels have no product name. They’ll print blank there."), the rows and
 * what to do behind "Show which". Blocks by default; offers a deliberate
 * "leave blank" choice only when the generator would really print blank
 * (never when it would print the sample).
 */
export function BlankValueCheck({ check, leaveBlank, onLeaveBlankChange, showWhenOk = true, remedy }: {
  check: RunDataCheck;
  leaveBlank: boolean;
  onLeaveBlankChange: (value: boolean) => void;
  showWhenOk?: boolean;
  /** Kept for callers; the check reads the same everywhere now. */
  compact?: boolean;
  /** Replaces the default "fix your spreadsheet" advice where that doesn't apply (scan mode). */
  remedy?: string;
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  if (!check.issues.length) {
    if (!showWhenOk || check.checkedLabels === 0) return null;
    return (
      <p className="flex items-center gap-1.5 text-sm text-emerald-400">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
        {describeBlankSummary(check)}
      </p>
    );
  }
  // The same readable names as the data table ("Product name", not "product_name").
  const lines = check.issues.slice(0, MAX_LINES).map((issue) => describeBlankIssue({ ...issue, field: fieldDisplayName(issue.field) }, check.checkedLabels));
  const hiddenCount = check.issues.length - lines.length;
  const hasRows = check.issues.some((issue) => issue.kind === 'empty-rows' && issue.count < check.checkedLabels);
  return (
    <div role="alert" className="space-y-1 text-sm">
      <p className="flex items-start gap-1.5 text-amber-300">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{describeBlankLine(check, fieldDisplayName)}</span>
      </p>
      <FoldToggle open={open} onToggle={() => setOpen((v) => !v)} controls={`${uid}-which`} className="ml-5.5">{hasRows ? 'Show which' : 'How to fix it'}</FoldToggle>
      <Fold open={open} id={`${uid}-which`}>
        <div className="space-y-1 pl-5.5 text-zinc-300">
          {(check.issues.length > 1 || hasRows) && lines.map((line) => <p key={line}>{line}</p>)}
          {hiddenCount > 0 && <p>And {hiddenCount} more field{hiddenCount === 1 ? '' : 's'}.</p>}
          <p>{remedy ?? blankRemedy(check)}</p>
        </div>
      </Fold>
      {check.canLeaveBlank && (
        <label htmlFor={`${uid}-blank`} className="press ml-5.5 flex min-h-11 w-fit cursor-pointer items-center gap-3 text-zinc-100">
          <input id={`${uid}-blank`} type="checkbox" className="check shrink-0" checked={leaveBlank} onChange={(e) => onLeaveBlankChange(e.target.checked)} />
          <span>Print {check.blankLabels === 1 ? 'this label' : `these ${check.blankLabels.toLocaleString()} labels`} with {check.issues.length === 1 ? 'that field' : 'those fields'} left blank</span>
        </label>
      )}
    </div>
  );
}
