'use client';

import { useId } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { describeRowList, type BlankFieldIssue, type RunDataCheck } from '@/lib/runDataCheck';
import { friendlyFieldName, spreadsheetRow } from '@/lib/fieldLabels';

/** Where the run's values come from: decides which advice fits. */
export type CheckMode = 'manual' | 'paste' | 'csv' | 'manifest' | 'scan';

const MAX_ITEMS = 5;

/** "3 labels are missing a value" / "2 fields have no value". */
export function blankHeading(check: RunDataCheck): string {
  if (!check.issues.length) return '';
  if (check.issues.every((issue) => issue.kind === 'no-value')) {
    const n = check.issues.length;
    return `${n} field${n === 1 ? ' has' : 's have'} no value`;
  }
  const n = check.blankLabels;
  return `${n.toLocaleString()} label${n === 1 ? ' is' : 's are'} missing a value`;
}

/** "labels 7, 212 (rows 8, 213)" in spreadsheet modes, "labels 7, 212" otherwise. */
function where(issue: BlankFieldIssue, total: number, mode: CheckMode): string {
  if (issue.kind === 'no-value') {
    if (mode === 'manual') return 'type a value above';
    if (mode === 'scan') return 'a scan can’t fill it';
    if (mode === 'paste') return 'type one value for every label';
    return 'pick a column or type one value';
  }
  if (issue.count >= total && total > 1) return 'empty on every label';
  const labels = describeRowList(issue.rows, issue.count);
  const plural = issue.count === 1 ? '' : 's';
  if (mode === 'csv') {
    const rows = describeRowList(issue.rows.map(spreadsheetRow), issue.count);
    return `empty on label${plural} ${labels} (spreadsheet row${plural} ${rows})`;
  }
  return `empty on label${plural} ${labels}`;
}

function consequence(check: RunDataCheck): string {
  if (check.issues.some((issue) => issue.outcome === 'sample')) return 'Empty fields would print the design’s sample text instead.';
  if (check.issues.some((issue) => issue.outcome === 'error')) return 'A barcode or QR code can’t print without a value.';
  return '';
}

/**
 * The whole-run blank check, short: one heading with the right count, a
 * compact list (field: where), one line on what would happen, and the
 * "leave blank" choice only where the printer would really print blank.
 */
export function BlankSummary({ check, mode, leaveBlank, onLeaveBlankChange, showWhenOk = true, extra }: {
  check: RunDataCheck;
  mode: CheckMode;
  leaveBlank: boolean;
  onLeaveBlankChange: (value: boolean) => void;
  showWhenOk?: boolean;
  /** One more sentence of advice that fits this page (scan mode). */
  extra?: string;
}) {
  const checkboxId = useId();
  if (!check.issues.length) {
    if (!showWhenOk || check.checkedLabels === 0) return null;
    return (
      <p className="flex items-center gap-1.5 text-sm text-emerald-400">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
        All {check.checkedLabels.toLocaleString()} labels have a value in every field
      </p>
    );
  }
  const shown = check.issues.slice(0, MAX_ITEMS);
  const hidden = check.issues.length - shown.length;
  const note = [consequence(check), extra].filter(Boolean).join(' ');
  return (
    <div role="alert" className="space-y-1.5 text-sm">
      <p className="flex items-center gap-1.5 font-medium text-amber-300">
        <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
        {blankHeading(check)}
      </p>
      <ul className="space-y-0.5 pl-5.5 text-zinc-300">
        {shown.map((issue) => (
          <li key={issue.field}><span className="text-zinc-100">{friendlyFieldName(issue.field)}</span>: {where(issue, check.checkedLabels, mode)}</li>
        ))}
        {hidden > 0 && <li>and {hidden} more field{hidden === 1 ? '' : 's'}</li>}
      </ul>
      {note && <p className="pl-5.5 text-zinc-400">{note}</p>}
      {check.canLeaveBlank && (
        <label htmlFor={checkboxId} className="ml-5.5 flex min-h-11 items-center gap-3 text-zinc-100">
          <input id={checkboxId} type="checkbox" className="size-5 shrink-0 accent-amber-500" checked={leaveBlank} onChange={(e) => onLeaveBlankChange(e.target.checked)} />
          <span>Print {check.blankLabels === 1 ? 'that label' : `those ${check.blankLabels.toLocaleString()} labels`} with the field left blank</span>
        </label>
      )}
    </div>
  );
}

/**
 * A short list of problems that must be fixed (or, with `confirmLabel`,
 * acknowledged) before printing: bad barcode values, overlapping items.
 */
export function ProblemList({ heading, items, more, confirmLabel, confirmed, onConfirmedChange, tone = 'warn' }: {
  heading: string;
  items: string[];
  more?: number;
  confirmLabel?: string;
  confirmed?: boolean;
  onConfirmedChange?: (value: boolean) => void;
  tone?: 'warn' | 'error';
}) {
  const checkboxId = useId();
  if (!items.length) return null;
  return (
    <div role="alert" className="space-y-1.5 text-sm">
      <p className={`flex items-center gap-1.5 font-medium ${tone === 'error' ? 'text-red-400' : 'text-amber-300'}`}>
        <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
        {heading}
      </p>
      <ul className="space-y-0.5 pl-5.5 text-zinc-300">
        {items.map((item) => <li key={item}>{item}</li>)}
        {!!more && more > 0 && <li>and {more.toLocaleString()} more</li>}
      </ul>
      {confirmLabel && onConfirmedChange && (
        <label htmlFor={checkboxId} className="ml-5.5 flex min-h-11 items-center gap-3 text-zinc-100">
          <input id={checkboxId} type="checkbox" className="size-5 shrink-0 accent-amber-500" checked={!!confirmed} onChange={(e) => onConfirmedChange(e.target.checked)} />
          <span>{confirmLabel}</span>
        </label>
      )}
    </div>
  );
}
