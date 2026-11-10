'use client';

import { useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertCircle, Pencil } from 'lucide-react';
import { barcodeHasDetails, barcodePlainSentence, FIX_IN_DESIGNER, PRINT_ANYWAY } from '@/lib/runBarcodeTicks';

/**
 * "Why?" under a plain sentence: the measurements and the fix, folded away
 * until asked for. A button (not <details>) so it sits inline with the
 * other actions and reads as one control.
 */
export function WhyToggle({ children, label = 'Why?' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="link inline-flex min-h-control-sm items-center">
        {open ? 'Hide why' : label}
      </button>
      <div id={id} className="fold basis-full" data-open={open}>
        <div className="fold-inner">
          <p className="pt-1 text-zinc-400">{children}</p>
        </div>
      </div>
    </>
  );
}

const MAX_SHOWN = 6;

/**
 * A barcode that won't scan, the same everywhere it is shown (new run, run
 * page, designer): one plain sentence per problem, its measurements behind
 * "Why?", one "Print anyway" tick per problem (none when nothing can print),
 * and the fix (a link or a "Fix it for me" button) under them.
 */
export function BarcodeWarning({ items, stops, isTicked, onTick, fix, why, tickable = true }: {
  /** The problems, in the shared check's words (each one becomes one sentence). */
  items: ReadonlyArray<string>;
  /** Nothing can print until the design changes: no tick. */
  stops: boolean;
  isTicked?: (item: string) => boolean;
  onTick?: (item: string, value: boolean) => void;
  /** What fixes it: "Fix in the designer", "Fix it for me", "Choose another file". */
  fix?: ReactNode;
  /** One more line of background, behind the last "Why?" (the run page: this run keeps its design). */
  why?: string;
  /** False where nothing prints from this page (the designer): no ticks. */
  tickable?: boolean;
}) {
  const uid = useId();
  if (!items.length) return null;
  const shown = items.slice(0, MAX_SHOWN);
  const rest = items.slice(MAX_SHOWN);
  const canTick = tickable && !stops && !!onTick;
  const ticked = (item: string) => !!isTicked?.(item);
  return (
    <div role="alert" className="space-y-2 text-sm">
      <ul className="space-y-2">
        {shown.map((item, i) => {
          const details = barcodeHasDetails(item) ? `${item}${why && i === shown.length - 1 && !rest.length ? ` ${why}` : ''}` : (why && i === shown.length - 1 && !rest.length ? why : '');
          return (
            <li key={item} className="space-y-1">
              <p className="flex items-start gap-1.5 text-zinc-100">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-400" aria-hidden="true" />
                <span>{barcodePlainSentence(item)}</span>
              </p>
              {details && <div className="flex flex-wrap items-center gap-x-4 pl-5.5"><WhyToggle>{details}</WhyToggle></div>}
              {canTick && (
                <label htmlFor={`${uid}-${i}`} className="press ml-5.5 flex min-h-11 w-fit cursor-pointer items-center gap-3 text-zinc-100">
                  <input id={`${uid}-${i}`} type="checkbox" className="size-5 shrink-0 accent-amber-500" checked={ticked(item)} onChange={(e) => onTick!(item, e.target.checked)} />
                  <span>{PRINT_ANYWAY}</span>
                </label>
              )}
            </li>
          );
        })}
        {rest.length > 0 && (
          <li className="space-y-1">
            <p className="flex items-start gap-1.5 text-zinc-100">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-400" aria-hidden="true" />
              <span>{rest.length.toLocaleString()} more barcode problem{rest.length === 1 ? '' : 's'} like {rest.length === 1 ? 'this' : 'these'}.</span>
            </p>
            {canTick && (
              <label htmlFor={`${uid}-more`} className="press ml-5.5 flex min-h-11 w-fit cursor-pointer items-center gap-3 text-zinc-100">
                <input id={`${uid}-more`} type="checkbox" className="size-5 shrink-0 accent-amber-500" checked={rest.every(ticked)} onChange={(e) => { for (const item of rest) onTick!(item, e.target.checked); }} />
                <span>{PRINT_ANYWAY}</span>
              </label>
            )}
          </li>
        )}
      </ul>
      {stops && <p className="pl-5.5 text-zinc-300">Nothing can print until the design is fixed.</p>}
      {fix && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-5.5">{fix}</div>}
    </div>
  );
}

/** The one way out to the designer, named and drawn the same on every page. */
export function FixInDesignerLink({ href }: { href: string }) {
  return (
    <Link href={href} className="link inline-flex min-h-control-sm items-center gap-1.5">
      <Pencil className="size-4" aria-hidden="true" />{FIX_IN_DESIGNER}
    </Link>
  );
}
