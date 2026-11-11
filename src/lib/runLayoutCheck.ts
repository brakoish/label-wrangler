import type { LabelFormat, LabelTemplate, Run } from './types';
import { layoutProblems, withAllEdges, type LayoutProblem } from './designerLayout';
import { previewLabelValues } from './runBuilder';
import { checkRunBarcodes, describeBarcodeGroups, issueStopsRenderer, rendererStopLabels, rowStopLine, type BarcodeIssue } from './barcodeCheck';
import { fieldItemWords, friendlyFieldName, placeholderDescription } from './fieldLabels';
import { NOT_AS_WRITTEN_NOTE } from './barcodeValue';
import { barcodeFitProblem } from './barcodeFit';
import { checkRunBitmapGlyphs, glyphStopWords } from './runGlyphs';

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
      // A barcode close to the edge is already in "Barcodes close to the
      // edge" (with its fix): here only what it prints over, said once.
      const fit = problem.barcodeFit;
      const edgeWords = fit && fit.level === 'tight' ? ` ${barcodeFitProblem(fit, '')}, and ` : '';
      const message = withAllEdges(edgeWords && problem.message.includes(edgeWords)
        ? problem.message.replace(edgeWords, ' ')
        : problem.fix ? `${problem.message} ${problem.fix.replace(/\.$/, '')}.` : problem.message, problem.edges);
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
  return issueStopsRenderer(issue, format);
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
  const names = Array.from(new Set(issues.map((issue) => (issue.label && issue.field ? (placeholderDescription(issue.field) ?? friendlyFieldName(issue.field)) : 'fixed'))));
  if (!names.length) return 'the barcode';
  // An item with no column yet is just "the barcode" (never "Barcode 1").
  if (names.length === 1 && placeholderDescription(issues.find((i) => i.field)?.field)) return `the ${fieldItemWords(issues.find((i) => i.field)?.field, 'barcode')}`;
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
    ? 'Fix those rows in your spreadsheet, then choose the file again.'
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
  /** Labels the exact renderer refuses (0: a fixed barcode, so every label), found in full among the labels checked. */
  stopLabels?: number[];
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
    stopLabels: exactStops(barcodes, format),
  };
}

/** Every label the renderer refuses, in full (older callers' checks have no stopLabels: use the list). */
function exactStops(found: ReturnType<typeof checkRunBarcodes>, format: LabelFormat): number[] {
  const labels = found.stopLabels ?? found.issues.filter((issue) => barcodeIssueStops(issue, format)).map((issue) => issue.label);
  return Array.from(new Set(labels)).sort((a, b) => a - b);
}

/** The check for one send: what blocks these labels, and the part that can go. */
export interface RunSendCheck {
  check: RunPrintCheck;
  /** Labels in this send the exact renderer refuses (0: every label). */
  stopsHere: number[];
  /** The labels before the first one that can't print, when there are any. */
  before: { from: number; to: number } | null;
  /** When the send starts with labels that can't print: the rest, if none of them can't. */
  after: { from: number; to: number } | null;
  /** Labels elsewhere in the run that can't print (not in this send). */
  stopsElsewhere: number[];
  /** Only the first `limit` labels of a bigger send were checked: the last one checked. */
  checkedTo: number | null;
}

/**
 * The whole-run check (`base`, the first 2,000 labels) narrowed to the labels
 * a print or send really covers. A label the exact renderer refuses stops only
 * the sends that include it. Those stops are found over the whole send, with
 * no cap (the cheap stop-only pass), so a 3,000-label "Send all in parts"
 * learns about label 2,600 before its first part goes; the list of printable
 * problems (each needing its go-ahead) still covers the first `limit` labels
 * of the send. Stops are never decided from the capped list of problems.
 * `skip`: labels the person chose to leave out (they are not sent), so they
 * neither stop nor ask anything.
 */
export function runSendCheck(base: RunPrintCheck, run: Run | null | undefined, template: LabelTemplate | null | undefined, format: LabelFormat | null | undefined, send: { from: number; to: number } | null | undefined, limit = 2000, skip: ReadonlyArray<number> = []): RunSendCheck {
  const plain: RunSendCheck = { check: base, stopsHere: [], before: null, after: null, stopsElsewhere: [], checkedTo: null };
  if (!run || !template || !format || !send || !Number.isInteger(send.from) || !Number.isInteger(send.to) || send.from < 1 || send.to < send.from) return plain;
  const runTotal = Math.max(1, run.totalLabels || run.sourceData.length || 1);
  const baseChecked = Math.min(runTotal, limit);
  const stopLabels = base.stopLabels ?? [];
  if (stopLabels.includes(0)) return { ...plain, stopsHere: [0] };
  const end = Math.min(send.to, runTotal);
  const skipped = new Set(skip);
  // The stop-only pass over the labels past what the base check covered.
  const lateStops = send.to > baseChecked ? rendererStopLabels(template, run, format, Math.max(send.from, baseChecked + 1), end) : [];
  if (lateStops.includes(0)) return { ...plain, stopsHere: [0] };
  if (!base.verdict.stops && send.to <= baseChecked) return plain;
  const to = Math.min(end, send.from + limit - 1);
  const data = { sourceData: run.sourceData.slice(send.from - 1, to), fieldMappings: run.fieldMappings, staticValues: run.staticValues, mappedField: run.mappedField };
  const found = checkRunBarcodes(template, data, format);
  for (const issue of [...found.issues, ...found.warnings]) if (issue.label > 0) issue.label += send.from - 1;
  // Stops past the first `limit` labels of the send: each one's own line (at most 50).
  const extra: BarcodeIssue[] = [];
  for (const label of lateStops.filter((n) => n > to && !skipped.has(n)).slice(0, 50)) {
    const one = checkRunBarcodes(template, { ...data, sourceData: run.sourceData.slice(label - 1, label) }, format);
    for (const issue of one.issues) if (issue.label > 0) extra.push({ ...issue, label: issue.label + label - 1 });
  }
  const issues = [...found.issues, ...extra].filter((issue) => !skipped.has(issue.label));
  // found.stopLabels counts from the start of the slice.
  const stopsHere = Array.from(new Set([...(found.stopLabels ?? []).map((label) => (label > 0 ? label + send.from - 1 : label)), ...lateStops]))
    .filter((label) => !skipped.has(label)).sort((a, b) => a - b);
  const sheet = run.dataSource === 'csv';
  const fromSheet = (field: string) => sheet && run.fieldMappings?.[field]?.mode === 'column';
  // A stop on a few spreadsheet rows is about those rows' values, not the
  // design: "Label 2,600’s SKU is too long for this label (44 characters)".
  const stopping = issues.filter((issue) => barcodeIssueStops(issue, format));
  const fewRows = stopsHere.length > 0 && !stopsHere.includes(0) && stopsHere.length <= 3 && stopping.length > 0
    && stopping.every((issue) => issue.label > 0 && fromSheet(issue.field) && rowStopLine(issue) !== null);
  const rowLines = fewRows ? stopping.map((issue) => rowStopLine(issue)!) : [];
  const rest = fewRows ? issues.filter((issue) => !stopping.includes(issue)) : issues;
  const badLabels = Math.max(0, found.badLabels - found.issues.filter((issue) => skipped.has(issue.label)).length) + extra.length;
  const blocking = [...rowLines, ...describeBarcodeGroups(rest, found.checkedLabels, fromSheet, 50, found.fitCounts).items];
  const verdict = barcodeVerdict(issues, badLabels, format, fromSheet);
  const shownVerdict: BarcodeVerdict = fewRows && verdict.stops
    ? { ...verdict, fixIn: 'data', waitReason: `${rowLines.length === 1 ? 'One label' : `${rowLines.length} labels`} can’t print, so nothing can go until ${rowLines.length === 1 ? 'it’s' : 'they’re'} fixed or left out.` }
    : verdict;
  const check: RunPrintCheck = {
    ...base,
    blocking,
    verdict: shownVerdict,
    blockingKey: blocking.join('\n'),
    barcodeElementIds: Array.from(new Set(issues.map((issue) => issue.elementId).filter((id): id is string => !!id))),
    stopLabels: stopsHere,
  };
  const first = stopsHere[0];
  let last = first ?? 0;
  while (stopsHere.includes(last + 1)) last++;
  return {
    check,
    stopsHere,
    before: first !== undefined && first > send.from ? { from: send.from, to: first - 1 } : null,
    after: first === send.from && stopsHere.every((label) => label <= last) && last < end ? { from: last + 1, to: end } : null,
    stopsElsewhere: stopLabels.filter((label) => (label < send.from || label > send.to) && !skipped.has(label)),
    checkedTo: to < end ? to : null,
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

/**
 * Labels the exact renderer refuses, said plainly and only those labels
 * (2,600, never the 8-label batch it was drawn in): one spreadsheet row's
 * value says it is too long for this label; anything else says the barcode
 * on it can't be drawn. Empty when there are none.
 */
export function stopLabelWords(run: Run | null | undefined, template: LabelTemplate | null | undefined, format: LabelFormat | null | undefined, labels: ReadonlyArray<number>): string {
  if (!labels.length) return '';
  const n = (x: number) => x.toLocaleString('en-US');
  // Text the picture renderer can't draw (a character its font lacks) is said as that.
  if (run && template && format) {
    const glyphs = checkRunBitmapGlyphs(template, format, { sourceData: run.sourceData, fieldMappings: run.fieldMappings, staticValues: run.staticValues, mappedField: run.mappedField });
    const mine = labels.filter((label) => glyphs.labels.includes(label) || (label > 0 && glyphs.labels.includes(0)));
    if (mine.length === labels.length) return glyphStopWords(glyphs, glyphs.labels.includes(0) ? [0] : mine, (field) => run.dataSource === 'csv' && run.fieldMappings?.[field]?.mode === 'column');
  }
  if (labels.includes(0)) return 'A barcode on every label can’t be drawn, so nothing can print. Fix the design first.';
  const which = labels.length === 1 ? `Label ${n(labels[0])}` : `Labels ${labels.slice(0, 3).map(n).join(', ')}${labels.length > 3 ? ` and ${n(labels.length - 3)} more` : ''}`;
  if (run && template && format && labels.length === 1) {
    const data = { sourceData: run.sourceData.slice(labels[0] - 1, labels[0]), fieldMappings: run.fieldMappings, staticValues: run.staticValues, mappedField: run.mappedField };
    const issue = checkRunBarcodes(template, data, format).issues.find((i) => barcodeIssueStops(i, format));
    const sheet = run.dataSource === 'csv' && !!issue?.field && run.fieldMappings?.[issue.field]?.mode === 'column';
    if (issue && sheet && issue.kind === 'too-long') return `${which}’s ${friendlyFieldName(issue.field)} is too long for this label (${n(Array.from(issue.value).length)} characters), so it can’t print.`;
    if (issue && sheet && issue.kind === 'characters') return `${which}’s ${friendlyFieldName(issue.field)} has characters its barcode can’t hold, so it can’t print.`;
  }
  return `${which} can’t print: a barcode on ${labels.length === 1 ? 'it' : 'them'} can’t be drawn.`;
}

/** Labels from..to (each span) the exact renderer refuses, leaving out `skip`. */
export function stopLabelsIn(run: Run | null | undefined, template: LabelTemplate | null | undefined, format: LabelFormat | null | undefined, spans: ReadonlyArray<{ from: number; to: number }>, skip: ReadonlyArray<number> = []): number[] {
  if (!run || !template || !format) return [];
  const data = { sourceData: run.sourceData, fieldMappings: run.fieldMappings, staticValues: run.staticValues, mappedField: run.mappedField };
  const out = new Set<number>();
  for (const span of spans) for (const label of rendererStopLabels(template, data, format, span.from, span.to)) if (!skip.includes(label)) out.add(label);
  // And labels whose text the picture renderer can't draw.
  const glyphs = checkRunBitmapGlyphs(template, format, data).labels;
  if (glyphs.includes(0)) return [0];
  for (const label of glyphs) if (!skip.includes(label) && spans.some((span) => label >= span.from && label <= span.to)) out.add(label);
  return [...out].sort((a, b) => a - b);
}
