'use client';
import { useId } from 'react';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { FixInDesignerLink, WhyToggle } from '@/components/checks/BarcodeWarning';
import { ProblemList } from '@/components/checks/RunChecks';
import { LAYOUT_GO_AHEAD, stopFixWords, type RunPrintCheck } from '@/lib/runLayoutCheck';
import { barcodeGoAheadLine, barcodeItemTicked, barcodePlainSentence, barcodeRunWhy, barcodeSendTickLabel } from '@/lib/runBarcodeTicks';

/** The run page's way to the designer: the same name area A uses. */
export const OPEN_IN_DESIGNER = 'Open in designer';
const MAX_SHOWN = 6;

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
function RerunLink({ designHref, asButton = false }: { designHref: string; asButton?: boolean }) {
  const href = new URL(rerunAfterFixHref(designHref), 'https://label-wrangler.invalid').searchParams.get('returnTo');
  if (!href?.startsWith('/runs/new?')) return null;
  // Beside "Leave label N out", the other way out looks like its pair.
  if (asButton) return <Link href={href} className="btn btn-ghost btn-sm text-zinc-300">Use a fixed file</Link>;
  return <Link href={href} className="link inline-flex min-h-11 items-center">Re-run with the fixed file</Link>;
}

/**
 * The run page's check before printing, in the same words and shape as the
 * new-run page: one plain sentence per barcode problem (measurements behind
 * "Why?"), its own tick, and "Open in designer", which comes back to a
 * re-run with the same data, since this run keeps its design; then barcodes
 * close to the edge, overlaps (one tick, as on the new-run page) and text the
 * printer can't print. A problem the exact renderer refuses has no tick:
 * nothing prints.
 *
 * send: the labels the next print or send really covers, so a tick names
 * that exact range and count ("Print labels 97–240 (144) anyway").
 * readOnly: a finished or cancelled run shows what was wrong, with no ticks.
 */
export function RunBarcodeCheck({ check, ticks, wizardGoAhead, onTick, layoutGoAhead, onLayoutGoAhead, designHref, send = null, total, readOnly = false, characters, stopNote = '', leaveOut = null, skipOut = null, elsewhere = '', checkedTo = null, qrHref = null, glyphStop = null, onQr }: {
  check: RunPrintCheck;
  ticks: ReadonlyArray<string>;
  wizardGoAhead: boolean;
  onTick: (item: string, value: boolean) => void;
  layoutGoAhead: boolean;
  onLayoutGoAhead: (value: boolean) => void;
  designHref: string;
  send?: { from: number; to: number } | null;
  total: number;
  readOnly?: boolean;
  /** Text the thermal printer can't print, already in plain words. */
  characters?: { heading: string; items: string[]; more: number } | null;
  /** In place of "Nothing can print…" when only some labels can't: what this send can do. */
  stopNote?: string;
  /** Send the labels before the first one that can't print. */
  leaveOut?: { label: string; pick: () => void } | null;
  /** Leave the labels that can't print out, and send everything else around them. */
  skipOut?: { label: string; pick: () => void } | null;
  /** Labels that can't print but aren't in this send. */
  elsewhere?: string;
  /** Only part of a big send was checked: the last label checked. */
  checkedTo?: number | null;
  /** Text a picture design can't draw on the labels of this send: a stop, with a one-tap leave-out on the office printer. */
  glyphStop?: { words: string; skip: { label: string; pick: () => void } | null; inDesign: boolean } | null;
  /** A QR code of the same value fits every label: a new run with the same data, where the barcode becomes a QR code. */
  qrHref?: string | null;
  /** Called when "Use a QR code instead" is pressed (the new run then offers to cancel this one). */
  onQr?: () => void;
}) {
  const uid = useId();
  const hasCharacters = !!characters && characters.items.length > 0;
  const extra = !readOnly && (!!elsewhere || !!checkedTo);
  const glyphs = !readOnly && !!glyphStop;
  if (!check.blocking.length && !check.tight.length && !check.layout.length && !hasCharacters && !extra && !glyphs) return null;
  const fix = check.verdict.fixIn === 'data'
    ? <RerunLink designHref={designHref} />
    : <FixInDesignerLink href={rerunAfterFixHref(designHref)} label={OPEN_IN_DESIGNER} />;
  const shown = check.blocking.slice(0, MAX_SHOWN);
  const rest = check.blocking.slice(MAX_SHOWN);
  const canTick = !readOnly && !check.verdict.stops;
  const ticked = (item: string) => barcodeItemTicked(item, ticks, wizardGoAhead);
  return (
    <div className="space-y-3">
      {glyphs && <div role="alert" className="space-y-2 text-sm">
        <p className="flex items-start gap-1.5 text-zinc-100">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-400" aria-hidden="true" />
          <span>{glyphStop!.words}</span>
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-5.5">
          {glyphStop!.skip && <button type="button" className="btn btn-secondary btn-sm" onClick={glyphStop!.skip.pick}>{glyphStop!.skip.label}</button>}
          {glyphStop!.inDesign ? <FixInDesignerLink href={rerunAfterFixHref(designHref)} label={OPEN_IN_DESIGNER} /> : <RerunLink designHref={designHref} asButton={!!glyphStop!.skip} />}
        </div>
      </div>}
      {check.blocking.length > 0 && <div role={readOnly ? undefined : 'alert'} className="space-y-2 text-sm">
        <ul className="space-y-2">
          {shown.map((item, i) => {
            // What to do about it, in plain words (no measurements): RunBarcodeCheck's own "Why?".
            const details = barcodeRunWhy(item, readOnly);
            return (
              <li key={item} className="space-y-1">
                <div className="flex items-start gap-1.5 text-zinc-100">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-400" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <span>{barcodePlainSentence(item)}</span>
                    {details && <> <WhyToggle>{details}</WhyToggle></>}
                  </div>
                </div>
                {canTick && (
                  <label htmlFor={`${uid}-${i}`} className="press ml-5.5 flex min-h-11 w-fit cursor-pointer items-center gap-3 text-zinc-100">
                    <input id={`${uid}-${i}`} type="checkbox" className="check shrink-0" checked={ticked(item)} onChange={(e) => onTick(item, e.target.checked)} />
                    <span>{barcodeSendTickLabel(item, send, total)}</span>
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
                  <input id={`${uid}-more`} type="checkbox" className="check shrink-0" checked={rest.every(ticked)} onChange={(e) => { for (const item of rest) onTick(item, e.target.checked); }} />
                  <span>{rest.length === 1 ? 'Print that one anyway' : `Print those ${rest.length.toLocaleString()} anyway`}</span>
                </label>
              )}
            </li>
          )}
        </ul>
        {/* A go-ahead carried over from the new-run page says what it costs, right beside the tick. */}
        {canTick && wizardGoAhead && <p className="pl-5.5 text-amber-300">{barcodeGoAheadLine(check.blocking[0])}</p>}
        {canTick && qrHref && <p className="pl-5.5 text-zinc-300">A QR code fits on every label. <Link href={qrHref} className="link" onClick={onQr}>Use a QR code instead</Link></p>}
        {check.verdict.stops && !readOnly && <p className="pl-5.5 text-zinc-300">{stopNote || stopFixWords(check.verdict.fixIn)}</p>}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-5.5">
          {check.verdict.stops && !readOnly && skipOut && <button type="button" className="btn btn-secondary btn-sm" onClick={skipOut.pick}>{skipOut.label}</button>}
          {check.verdict.stops && !readOnly && leaveOut && <button type="button" className={`btn btn-sm ${skipOut ? 'btn-ghost text-zinc-300' : 'btn-secondary'}`} onClick={leaveOut.pick}>{leaveOut.label}</button>}
          {fix}
        </div>
      </div>}
      {!readOnly && elsewhere && <p className="text-sm text-zinc-300">{elsewhere}</p>}
      {!readOnly && checkedTo && <p className="text-sm text-zinc-400">Every label was checked for ones that can’t print. Other barcode problems were checked up to label {checkedTo.toLocaleString('en-US')}.</p>}
      <ProblemList heading="Barcodes close to the edge" items={check.tight.slice(0, 3)} more={check.tight.length - Math.min(3, check.tight.length)} />
      <ProblemList
        heading="Some items overlap or run off the label"
        items={check.layout.slice(0, 6)}
        more={check.layout.length - Math.min(6, check.layout.length)}
        {...(readOnly ? {} : { confirmLabel: LAYOUT_GO_AHEAD, confirmed: layoutGoAhead, onConfirmedChange: onLayoutGoAhead })}
      />
      {hasCharacters && <ProblemList heading={characters!.heading} items={characters!.items} more={characters!.more}
        actions={!check.blocking.length ? <FixInDesignerLink href={rerunAfterFixHref(designHref)} label={OPEN_IN_DESIGNER} /> : undefined} />}
    </div>
  );
}
