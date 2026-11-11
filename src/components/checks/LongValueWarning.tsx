'use client';

import { useId } from 'react';
import { AlertCircle } from 'lucide-react';
import { FixInDesignerLink } from './BarcodeWarning';
import type { CheckMode } from './RunChecks';
import { longValueSentence, type LongValueField } from './longValues';

/**
 * A value too long for its barcode on some labels only (one long SKU in a
 * spreadsheet of short ones): said as a problem with that row, with the same
 * way out as blank cells, "Leave label 12 out", and fixing the file. Changing
 * the design stays a quiet second choice, since it is fine for every other
 * label. A label that prints cut off (not refused) can still be printed with
 * an explicit tick.
 */
export function LongValueWarning({ fields, labels, total, rest, mode, stops, onLeaveOut, sheetRow, designHref, ticked = false, onTick }: {
  fields: ReadonlyArray<LongValueField>;
  /** Labels named (0-based, over the whole file), still in this run. */
  labels: ReadonlyArray<number>;
  /** Labels in the whole file (for "label 12" vs "all 20 labels"). */
  total: number;
  /** Labels this run keeps once these are left out. */
  rest: number;
  mode: CheckMode;
  stops: boolean;
  onLeaveOut: () => void;
  sheetRow?: (index: number) => number;
  designHref?: string;
  ticked?: boolean;
  onTick?: (value: boolean) => void;
}) {
  const tickId = useId();
  if (!labels.length) return null;
  const n = labels.length;
  const fix = mode === 'csv'
    ? `Or fix ${n === 1 ? 'it' : 'them'} in your spreadsheet, then use “Choose another file” at the top.`
    : mode === 'manifest' ? 'Or pick another package.' : `Or fix ${n === 1 ? 'it' : 'them'} in the list above.`;
  const consequence = stops
    ? (n === 1 ? 'That label can’t print as it is.' : 'Those labels can’t print as they are.')
    : (n === 1 ? 'Its barcode would be cut off and won’t scan.' : 'Their barcodes would be cut off and won’t scan.');
  return (
    <div role="alert" className="space-y-2 text-sm">
      <ul className="space-y-1">
        {fields.map((field) => (
          <li key={field.field} className="flex items-start gap-1.5 text-zinc-100">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-400" aria-hidden="true" />
            <span>{longValueSentence(field, total, sheetRow)}</span>
          </li>
        ))}
      </ul>
      <p className="pl-5.5 text-zinc-300">{consequence}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-5.5">
        {rest > 0 && (
          <button type="button" className="btn btn-secondary btn-sm max-w-full whitespace-normal text-left max-sm:min-h-11 max-sm:py-2" onClick={onLeaveOut}>
            {n === 1 ? `Leave label ${(labels[0] + 1).toLocaleString()} out and print the other ${rest.toLocaleString()}` : `Leave these ${n.toLocaleString()} labels out and print the other ${rest.toLocaleString()}`}
          </button>
        )}
        {designHref && <FixInDesignerLink href={designHref} />}
      </div>
      <p className="pl-5.5 text-zinc-400">{fix}</p>
      {!stops && onTick && (
        <label htmlFor={tickId} className="press ml-5.5 flex min-h-11 w-fit cursor-pointer items-center gap-3 text-zinc-100">
          <input id={tickId} type="checkbox" className="check" checked={ticked} onChange={(e) => onTick(e.target.checked)} />
          <span>{n === 1 ? 'Print it anyway, cut off' : `Print those ${n.toLocaleString()} anyway, cut off`}</span>
        </label>
      )}
    </div>
  );
}
