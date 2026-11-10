import type { LabelFormat, LabelTemplate, Run } from './types';
import { layoutProblems, type LayoutProblem } from './designerLayout';
import { previewLabelValues } from './runBuilder';
import { checkRunBarcodes, describeBarcodeGroups, type BarcodeIssue } from './barcodeCheck';

/** One message per problem, with the labels it is on when not every label. */
function collect(run: Run, template: LabelTemplate, format: LabelFormat, total: number, keep: (problem: LayoutProblem) => boolean): string[] {
  const found = new Map<string, { message: string; labels: number[]; count: number }>();
  for (let index = 0; index < total; index++) {
    const values = previewLabelValues(run, Math.min(index, Math.max(0, run.sourceData.length - 1)));
    for (const problem of layoutProblems(template.elements, format, values)) {
      if (!keep(problem)) continue;
      const key = `${problem.kind}:${problem.ids.join(',')}`;
      const message = problem.fix ? `${problem.message} ${problem.fix}.` : problem.message;
      const entry = found.get(key) ?? { message, labels: [], count: 0 };
      entry.count++;
      if (entry.labels.length < 3) entry.labels.push(index + 1);
      found.set(key, entry);
    }
  }
  return Array.from(found.values()).map((entry) => (total > 1 && entry.count < total
    ? `${entry.message.replace(/\.$/, '')} (label${entry.count === 1 ? '' : 's'} ${entry.labels.join(', ')}${entry.count > entry.labels.length ? ` and ${entry.count - entry.labels.length} more` : ''}).`
    : entry.message));
}

/** The go-ahead for a barcode the printer would cut off (designer emulation, not a renderer failure). */
export const BARCODE_GO_AHEAD = 'Print anyway — the barcode may be cut off';
/** The go-ahead when the only problem is a value the barcode type can't hold. */
export const BARCODE_VALUE_GO_AHEAD = 'Print anyway — the barcode may not scan';
/** The go-ahead for items that cover each other or run off the label (the wizard's words). */
export const LAYOUT_GO_AHEAD = 'I checked the preview. Print it like this.';

type VerdictIssue = Pick<BarcodeIssue, 'kind' | 'fit'>;
type VerdictFormat = Pick<LabelFormat, 'type'> | null | undefined;

/**
 * A barcode the exact (bitmap) renderer refuses: that renderer stops and
 * nothing prints, so it stays a stop. Every other "blocked" verdict comes
 * from emulating the printer and needs an explicit go-ahead instead.
 */
export function barcodeIssueStops(issue: VerdictIssue, format: VerdictFormat): boolean {
  return format?.type === 'thermal' && !!issue.fit?.bitmap && issue.fit.level === 'blocked';
}

export interface BarcodeVerdict {
  /** Nothing can print until the design changes (the exact renderer refuses it). */
  stops: boolean;
  /** Red heading over the list of problems. */
  heading: string;
  /** The words on the explicit go-ahead (when it doesn't stop). */
  goAheadLabel: string;
  /** One plain line for why printing waits, next to the disabled button. */
  waitReason: string;
}

/** Shared words for the barcode problems, so the wizard and the run page say the same thing. */
export function barcodeVerdict(issues: ReadonlyArray<VerdictIssue>, badLabels: number, format: VerdictFormat): BarcodeVerdict {
  const stops = issues.some((issue) => barcodeIssueStops(issue, format));
  const valuesOnly = issues.length > 0 && issues.every((issue) => issue.kind === 'characters');
  const n = Math.max(1, badLabels);
  const labels = `${n.toLocaleString()} label${n === 1 ? '' : 's'}`;
  const has = n === 1 ? 'has' : 'have';
  const heading = stops
    ? `${labels} ${has} a barcode that can’t be drawn`
    : valuesOnly
      ? `${labels} ${has} a barcode value its barcode type can’t hold`
      : `${labels} ${has} a barcode that won’t print whole`;
  const goAheadLabel = valuesOnly ? BARCODE_VALUE_GO_AHEAD : BARCODE_GO_AHEAD;
  const waitReason = stops
    ? `${heading}, so nothing can print. Fix the design (see the list above).`
    : `${heading}. Fix it (see the list above), or tick “${goAheadLabel}”.`;
  return { stops, heading, goAheadLabel, waitReason };
}

export interface RunPrintCheck {
  /**
   * Barcodes the printer can't produce whole (a value the barcode type can't
   * hold, bars cut off at the label edge or printed onto the next label, an
   * exact box the renderer refuses). Shown first, in red, with the fix.
   * Printing needs an explicit go-ahead, unless `stops`.
   */
  blocking: string[];
  /** Prints, but worth a look first: tight barcodes, then overlaps. */
  warnings: string[];
  /** Barcodes with little clear space (shown, no go-ahead needed). */
  tight: string[];
  /** Items that cover each other or run off the label (go-ahead needed). */
  layout: string[];
  /** Words for the blocking barcodes; `stops` when the exact renderer refuses them. */
  verdict: BarcodeVerdict;
  /** Change when the problems change: a go-ahead covers these exact problems. */
  blockingKey: string;
  layoutKey: string;
}

/**
 * The run page's check before printing or sending, with the same barcode
 * verdict as the designer and the new-run wizard (barcodeFit), so the same
 * Metrc tag gets the same answer everywhere. Read-only.
 */
export function runPrintCheck(run: Run | null | undefined, template: LabelTemplate | null | undefined, format: LabelFormat | null | undefined, limit = 2000): RunPrintCheck {
  const none: RunPrintCheck = { blocking: [], warnings: [], tight: [], layout: [], verdict: barcodeVerdict([], 0, format), blockingKey: '', layoutKey: '' };
  if (!run || !template || !format) return none;
  const total = Math.min(Math.max(1, run.totalLabels || run.sourceData.length || 1), limit);
  const sheet = run.dataSource === 'csv';
  const data = { sourceData: run.sourceData.slice(0, total), fieldMappings: run.fieldMappings, staticValues: run.staticValues, mappedField: run.mappedField };
  const barcodes = checkRunBarcodes(template, data, format);
  const fromSheet = (field: string) => sheet && run.fieldMappings?.[field]?.mode === 'column';
  const blocking = describeBarcodeGroups(barcodes.issues, barcodes.checkedLabels, fromSheet, 50, barcodes.fitCounts).items;
  const tight = describeBarcodeGroups(barcodes.warnings, barcodes.checkedLabels, fromSheet, 50, barcodes.fitCounts).items;
  // Barcode fit problems are named above, once; other layout problems (overlaps) here.
  const layout = format.type === 'thermal' && template.thermalRenderMode !== 'bitmap-v1'
    ? collect(run, template, format, total, (problem) => !problem.barcodeFit || (problem.barcodeFit.level === 'ok' && problem.kinds.includes('overlap')))
    : [];
  return {
    blocking,
    warnings: [...tight, ...layout],
    tight,
    layout,
    verdict: barcodeVerdict(barcodes.issues, barcodes.badLabels, format),
    blockingKey: blocking.join('\n'),
    layoutKey: layout.join('\n'),
  };
}

/** A person's go-ahead on a run, kept on this device: the problems it covered. */
export interface PrintGoAhead { barcode?: string; layout?: string }
const GO_AHEAD_PREFIX = 'lw:print-go-ahead:';

export function readPrintGoAhead(storage: Pick<Storage, 'getItem'> | null | undefined, runId: string): PrintGoAhead {
  try {
    const data = JSON.parse(storage?.getItem(GO_AHEAD_PREFIX + runId) || '{}') as PrintGoAhead;
    return { ...(typeof data.barcode === 'string' ? { barcode: data.barcode } : {}), ...(typeof data.layout === 'string' ? { layout: data.layout } : {}) };
  } catch { return {}; }
}

export function rememberPrintGoAhead(storage: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined, runId: string, goAhead: PrintGoAhead): void {
  try {
    if (goAhead.barcode || goAhead.layout) storage?.setItem(GO_AHEAD_PREFIX + runId, JSON.stringify(goAhead));
    else storage?.removeItem(GO_AHEAD_PREFIX + runId);
  } catch { /* storage unavailable: the person ticks it again */ }
}

/** True when printing may go ahead: no stop, and every problem has its go-ahead. */
export function printCheckAllows(check: RunPrintCheck, goAhead: PrintGoAhead): boolean {
  if (check.blocking.length && check.verdict.stops) return false;
  if (check.blocking.length && goAhead.barcode !== check.blockingKey) return false;
  if (check.layout.length && goAhead.layout !== check.layoutKey) return false;
  return true;
}
