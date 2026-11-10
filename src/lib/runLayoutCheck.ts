import type { LabelFormat, LabelTemplate, Run } from './types';
import { layoutProblems, type LayoutProblem } from './designerLayout';
import { previewLabelValues } from './runBuilder';
import { checkRunBarcodes, describeBarcodeGroups, type BarcodeIssue } from './barcodeCheck';
import { friendlyFieldName } from './fieldLabels';
import { NOT_AS_WRITTEN_NOTE } from './barcodeValue';

/** The run data the checks read (a Run, or the new-run wizard's data before the run exists). */
export interface RunCheckData {
  sourceData: ReadonlyArray<string | Record<string, string>>;
  fieldMappings?: Run['fieldMappings'] | null;
  staticValues?: Run['staticValues'] | null;
  mappedField?: string | null;
}

/**
 * A layout problem that is NOT already named by the barcode check: a barcode
 * that doesn't print whole is one problem, with one go-ahead, and its
 * overlaps are named in that same line ("It also prints over the COA link QR
 * code"). Everything else that covers something or runs off the label is
 * listed here.
 */
export function isSeparateLayoutProblem(problem: LayoutProblem): boolean {
  const fit = problem.barcodeFit;
  if (fit && fit.level === 'blocked' && fit.reason !== 'characters') return false;
  if (fit && fit.level === 'tight' && !problem.kinds.includes('overlap')) return false;
  return true;
}

/**
 * Items that cover each other or run off the label, on any of the first
 * `total` labels: one message per problem, with the labels it is on when not
 * every label. Shared by the new-run wizard and the run page.
 */
export function runLayoutIssues(data: RunCheckData, template: Pick<LabelTemplate, 'elements' | 'thermalRenderMode'>, format: LabelFormat | null | undefined, total: number): string[] {
  if (!format || format.type !== 'thermal' || template.thermalRenderMode === 'bitmap-v1') return [];
  const found = new Map<string, { message: string; labels: number[]; count: number }>();
  const run = { ...data, fieldMappings: data.fieldMappings ?? {}, staticValues: data.staticValues ?? {} } as unknown as Run;
  for (let index = 0; index < total; index++) {
    const values = previewLabelValues(run, Math.min(index, Math.max(0, data.sourceData.length - 1)));
    for (const problem of layoutProblems(template.elements, format, values)) {
      if (!isSeparateLayoutProblem(problem)) continue;
      const key = `${problem.kinds.join('+')}:${problem.ids.join(',')}`;
      const message = problem.fix ? `${problem.message} ${problem.fix.replace(/\.$/, '')}.` : problem.message;
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

/** The old go-ahead words, kept for callers that still import them. */
export const BARCODE_GO_AHEAD = 'Print anyway — the barcode may be cut off';
/** The go-ahead when the only problem is a value the barcode type can't hold. */
export const BARCODE_VALUE_GO_AHEAD = 'Print anyway — the barcode may not scan';
/** The go-ahead for items that cover each other or run off the label (the wizard's words). */
export const LAYOUT_GO_AHEAD = 'I checked the preview. Print it like this.';

type VerdictIssue = Pick<BarcodeIssue, 'kind' | 'fit'> & Partial<Pick<BarcodeIssue, 'field' | 'label' | 'overprints' | 'overprintsCode' | 'overprintedCodes'>>;
type VerdictFormat = Pick<LabelFormat, 'type'> | null | undefined;

/**
 * A barcode the exact (bitmap) renderer refuses: that renderer stops and
 * nothing prints, so it stays a stop. A print the printer can produce is
 * never a stop: an exact design's value the renderer still draws
 * (`printable`), and every native verdict (emulated), need an explicit
 * go-ahead instead.
 */
export function barcodeIssueStops(issue: VerdictIssue, format: VerdictFormat): boolean {
  return format?.type === 'thermal' && !!issue.fit?.bitmap && issue.fit.level === 'blocked' && !issue.fit.printable;
}

/** "Lowercase letters will scan as UPPERCASE" -> "lowercase letters will scan as UPPERCASE". */
function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/**
 * How bad the worst barcode problem is, in the order a person should weigh it:
 * - 'stop': the exact renderer refuses it; nothing can print.
 * - 'neither-scans': the bars print over the next label's barcode (two
 *   across), so both labels of every pair are ruined.
 * - 'damage': the bars are cut off (and may print over other items).
 * - 'value': a value the barcode type can't hold (native printers still print
 *   something; the exact renderer draws it, for example lowercase as UPPERCASE).
 */
export type BarcodeSeverity = 'none' | 'stop' | 'neither-scans' | 'damage' | 'value';

export interface BarcodeVerdict {
  /** Nothing can print until the design changes (the exact renderer refuses it). */
  stops: boolean;
  severity: BarcodeSeverity;
  /** Red heading over the list of problems. */
  heading: string;
  /** The words on the explicit go-ahead (when it doesn't stop): what will really happen. */
  goAheadLabel: string;
  /** One plain line for why printing waits, next to the disabled button. */
  waitReason: string;
  /**
   * Whether a go-ahead given in the new-run wizard is kept for the run page.
   * True unless nothing can print; the run page still asks again, item by
   * item, for a barcode that prints over the next label's ("neither label
   * will scan", see runBarcodeTicks.barcodeProblemSevere).
   */
  carriesOver: boolean;
  /** What to change: the spreadsheet rows, the design, or both. */
  fixIn: 'design' | 'data' | 'both' | 'none';
}

function joinNames(names: ReadonlyArray<string>): string {
  return names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function codeNames(issues: ReadonlyArray<VerdictIssue>): string {
  const names = Array.from(new Set(issues.map((issue) => (issue.label && issue.field ? friendlyFieldName(issue.field) : 'fixed'))));
  if (!names.length) return 'the barcode';
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `the ${list} barcode${names.length === 1 ? '' : 's'}`;
}

/**
 * Shared words for the barcode problems, so the wizard and the run page say
 * the same thing. The go-ahead names the damage the preview shows, never a
 * softer "may be cut off". `fromSheet` says whether a field's values come
 * from the spreadsheet (so a bad value is fixed there, not in the design).
 */
export function barcodeVerdict(issues: ReadonlyArray<VerdictIssue>, badLabels: number, format: VerdictFormat, fromSheet?: (field: string) => boolean): BarcodeVerdict {
  const stopping = issues.filter((issue) => barcodeIssueStops(issue, format));
  const stops = stopping.length > 0;
  const valuesOnly = issues.length > 0 && issues.every((issue) => issue.kind === 'characters');
  const fits = issues.filter((issue) => issue.kind !== 'characters' && issue.fit);
  const pairs = fits.filter((issue) => issue.fit?.reason === 'into-next-label' && issue.fit.overNextBarcode);
  const severity: BarcodeSeverity = !issues.length ? 'none' : stops ? 'stop' : pairs.length ? 'neither-scans' : fits.length ? 'damage' : 'value';
  const n = Math.max(1, badLabels);
  const labels = `${n.toLocaleString()} label${n === 1 ? '' : 's'}`;
  const has = n === 1 ? 'has' : 'have';
  // A value fixed in the spreadsheet vs a design change.
  const isData = (issue: VerdictIssue) => issue.kind === 'characters' && !!issue.label && !!issue.field && !!fromSheet?.(issue.field);
  const toFix = stops ? stopping : issues;
  const fixIn: BarcodeVerdict['fixIn'] = !toFix.length ? 'none' : toFix.every(isData) ? 'data' : toFix.some(isData) ? 'both' : 'design';
  // Exact designs whose values are drawn anyway: say what will scan.
  const drawnNotes = valuesOnly && issues.every((issue) => issue.fit?.printable && issue.fit.note)
    ? Array.from(new Set(issues.map((issue) => issue.fit!.note!)))
    : [];
  const heading = stops
    ? stopping.every((issue) => issue.kind === 'characters')
      ? `${labels} ${has} a barcode value it can’t print`
      : `${labels} ${has} a barcode that can’t be drawn`
    : drawnNotes.length
      ? `${labels} ${has} a barcode value that won’t scan exactly as written`
      : valuesOnly
      ? `${labels} ${has} a barcode value its barcode type can’t hold`
      : severity === 'neither-scans'
        ? `${labels} ${has} a barcode that prints over the next label’s`
        : `${labels} ${has} a barcode that won’t print whole`;
  let goAheadLabel = BARCODE_VALUE_GO_AHEAD;
  if (severity === 'value' && drawnNotes.length) {
    goAheadLabel = `Print anyway — ${lowerFirst(drawnNotes.length === 1 ? drawnNotes[0] : NOT_AS_WRITTEN_NOTE)}`;
  } else if (severity === 'neither-scans') {
    goAheadLabel = `Print anyway — ${codeNames(pairs)} print${codeNames(pairs).endsWith('s') ? '' : 's'} over the next label’s, so neither label will scan`;
  } else if (severity === 'damage') {
    const covered = fits.find((issue) => issue.overprints?.length);
    const name = codeNames(fits);
    goAheadLabel = covered?.overprintsCode
      ? `Print anyway — ${name} and ${covered.overprintedCodes?.length ? joinNames(covered.overprintedCodes) : covered.overprints!.length === 1 ? covered.overprints![0] : 'the code it covers'} won’t scan`
      : covered
        ? `Print anyway — ${name} won’t scan and print${name.endsWith('s') ? '' : 's'} over ${covered.overprints![0]}`
        : `Print anyway — ${name} will be cut off and won’t scan`;
  }
  const fixWords = fixIn === 'data'
    ? 'Fix the spreadsheet rows listed above, then choose the file again.'
    : fixIn === 'both' ? 'Fix the items listed above.' : 'Fix the design (see the list above).';
  const waitReason = stops
    ? `${heading}, so nothing can print. ${fixWords}`
    : `${heading}. Fix it, or tick each “Print … anyway”.`;
  return { stops, severity, heading, goAheadLabel, waitReason, carriesOver: !stops, fixIn };
}

/** The line under a stop: what has to change before anything prints. */
export function stopFixWords(fixIn: BarcodeVerdict['fixIn']): string {
  if (fixIn === 'data') return 'Nothing can print until the spreadsheet rows are fixed.';
  if (fixIn === 'both') return 'Nothing can print until the items above are fixed.';
  return 'Nothing can print until the design is fixed.';
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
  /** The barcodes on the design behind `blocking` (to open the designer with one selected). */
  barcodeElementIds: string[];
}

/**
 * The run page's check before printing or sending, with the same barcode
 * verdict as the designer and the new-run wizard (barcodeFit), so the same
 * Metrc tag gets the same answer everywhere. Read-only.
 */
export function runPrintCheck(run: Run | null | undefined, template: LabelTemplate | null | undefined, format: LabelFormat | null | undefined, limit = 2000): RunPrintCheck {
  const none: RunPrintCheck = { blocking: [], warnings: [], tight: [], layout: [], verdict: barcodeVerdict([], 0, format), blockingKey: '', layoutKey: '', barcodeElementIds: [] };
  if (!run || !template || !format) return none;
  const total = Math.min(Math.max(1, run.totalLabels || run.sourceData.length || 1), limit);
  const sheet = run.dataSource === 'csv';
  const data = { sourceData: run.sourceData.slice(0, total), fieldMappings: run.fieldMappings, staticValues: run.staticValues, mappedField: run.mappedField };
  const barcodes = checkRunBarcodes(template, data, format);
  const fromSheet = (field: string) => sheet && run.fieldMappings?.[field]?.mode === 'column';
  const blocking = describeBarcodeGroups(barcodes.issues, barcodes.checkedLabels, fromSheet, 50, barcodes.fitCounts).items;
  const tight = describeBarcodeGroups(barcodes.warnings, barcodes.checkedLabels, fromSheet, 50, barcodes.fitCounts).items;
  // A barcode problem is named above, once, with what it prints over; other layout problems here.
  const layout = runLayoutIssues(run, template, format, total);
  return {
    blocking,
    warnings: [...tight, ...layout],
    tight,
    layout,
    verdict: barcodeVerdict(barcodes.issues, barcodes.badLabels, format, fromSheet),
    blockingKey: blocking.join('\n'),
    layoutKey: layout.join('\n'),
    barcodeElementIds: Array.from(new Set(barcodes.issues.map((issue) => issue.elementId).filter((id): id is string => !!id))),
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
