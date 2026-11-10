import type { BarcodeElement, FieldMapping, LabelFormat, LabelTemplate, TemplateElement } from './types';
import { fieldItemWords, friendlyFieldName, spreadsheetRow } from './fieldLabels';
import { barcodeFit, barcodeFitFix, barcodeFitProblem, type BarcodeFit } from './barcodeFit';
import { itemName, layoutProblems } from './designerLayout';

/**
 * Whole-run check that every barcode will print, label by label, with the
 * same verdict the designer and the run page use (barcodeFit). The printer
 * (and the exact renderer) fail on such values part-way through a run, so
 * the wizard checks every label before it starts.
 *
 * Value resolution mirrors runBuilder.valuesForLabel (and runDataCheck): the
 * typed value, then the row's column value, then prefix/suffix around it.
 */

export { barcodeValueProblem } from './barcodeValue';

export interface BarcodeIssue {
  field: string;
  /** 1-based label number (0 for a fixed barcode, the same on every label). */
  label: number;
  value: string;
  problem: string;
  /**
   * 'characters': the barcode type can't hold the value (fix the value).
   * 'too-long': the value is fine but the barcode can't print where it is
   * (fix the layout). 'tight': it prints, with little clear space (warning).
   */
  kind?: 'characters' | 'too-long' | 'tight';
  /** For 'too-long' on a native label: it runs off the label edge. */
  offLabel?: boolean;
  /** The shared verdict behind this issue. */
  fit?: BarcodeFit;
  /** The barcode on the design this issue is about. */
  elementId?: string;
  /**
   * Native labels: what else the too-long bars print over on that label, as
   * the preview shows it ("the COA link QR code", "the Batch text").
   */
  overprints?: string[];
  /** Some of `overprints` is a QR code or barcode, so it won't scan either. */
  overprintsCode?: boolean;
  /** The barcodes and QR codes among them, by name: they won’t scan either. */
  overprintedCodes?: string[];
}

type FitFormat = Pick<LabelFormat, 'type' | 'width' | 'height' | 'dpi'> & Partial<Pick<LabelFormat, 'labelsAcross' | 'horizontalGapThermal'>>;

/**
 * Whether a valid value fits its barcode (kept for callers of the old API;
 * barcodeFit has the full verdict). A 'tight' barcode fits.
 */
export function barcodeFits(el: Pick<BarcodeElement, 'barcodeFormat' | 'x' | 'y' | 'width' | 'height' | 'rotation' | 'showText'>, value: string, format: FitFormat, bitmap: boolean): { fits: boolean; offLabel: boolean } {
  const fit = barcodeFit(el, value, format, bitmap);
  if (fit.level !== 'blocked' || fit.reason === 'characters') return { fits: true, offLabel: false };
  return { fits: false, offLabel: fit.reason === 'off-label' || fit.reason === 'into-next-label' || fit.reason === 'box-off-label' };
}

export interface BarcodeCheck {
  /** Barcodes that can't print: the run waits for a fix. */
  issues: BarcodeIssue[];
  /** Labels with at least one barcode that can't print (counted in full). */
  badLabels: number;
  /** Barcodes that print but are tight (warning only). */
  warnings: BarcodeIssue[];
  /** Labels checked. */
  checkedLabels: number;
  /** Labels per barcode field and fit problem ("field|reason"), counted in full. */
  fitCounts: Record<string, number>;
}

interface RunData {
  sourceData: ReadonlyArray<string | Record<string, string>>;
  fieldMappings?: Record<string, FieldMapping> | null;
  staticValues?: Record<string, string> | null;
  mappedField?: string | null;
}

export function valuesFor(run: RunData, index: number): Record<string, string> {
  const values: Record<string, string> = { ...(run.staticValues || {}) };
  const row = run.sourceData[index];
  const mappings = run.fieldMappings || {};
  if (row && typeof row === 'object') {
    for (const [field, mapping] of Object.entries(mappings)) {
      if (mapping.mode === 'column' && mapping.csvColumn) values[field] = (row as Record<string, string>)[mapping.csvColumn] ?? '';
    }
  } else if (typeof row === 'string') {
    const legacy = run.mappedField ?? Object.entries(mappings).find(([, m]) => m.mode === 'column')?.[0];
    if (legacy) values[legacy] = row;
  }
  return values;
}

function printedValue(el: TemplateElement, values: Record<string, string>): string {
  if (el.isStatic) return 'content' in el ? el.content || '' : '';
  const value = (el.fieldName && values[el.fieldName]) || el.defaultValue || '';
  return `${el.prefix || ''}${value}${el.suffix || ''}`;
}

const MAX_ISSUES = 50;

function issueFor(el: BarcodeElement, label: number, value: string, format: FitFormat | null | undefined, bitmap: boolean): BarcodeIssue | null {
  const fit = barcodeFit(el, value, format, bitmap);
  if (fit.level === 'ok') return null;
  const field = el.isStatic ? '' : el.fieldName || '';
  if (fit.reason === 'characters') return { field, label, value, problem: fit.problem || 'can’t be drawn with this value', kind: 'characters', fit, elementId: el.id };
  return { field, label, value, problem: barcodeFitProblem(fit, value), kind: fit.level === 'tight' ? 'tight' : 'too-long', offLabel: fit.reason === 'off-label' || fit.reason === 'into-next-label', fit, elementId: el.id };
}

/**
 * What a too-long native barcode prints over on its label, from the same
 * footprints the preview and the designer outline use. Only the issues kept
 * for the list are looked at (at most MAX_ISSUES labels).
 */
function addOverprints(template: Pick<LabelTemplate, 'elements'>, run: RunData, format: FitFormat | null | undefined, issues: BarcodeIssue[]): void {
  if (!format || format.type !== 'thermal') return;
  const byLabel = new Map<number, ReturnType<typeof layoutProblems>>();
  for (const issue of issues) {
    if (issue.kind !== 'too-long' || !issue.elementId || issue.fit?.bitmap) continue;
    let problems = byLabel.get(issue.label);
    if (!problems) {
      problems = layoutProblems(template.elements, format as LabelFormat, valuesFor(run, Math.max(0, issue.label - 1)));
      byLabel.set(issue.label, problems);
    }
    const others = new Set<string>();
    for (const problem of problems) if (problem.ids.includes(issue.elementId)) for (const id of problem.ids) if (id !== issue.elementId) others.add(id);
    const items = template.elements.filter((el) => others.has(el.id));
    if (!items.length) continue;
    issue.overprints = items.map(itemName);
    const codes = items.filter((el) => el.type === 'qr' || el.type === 'barcode');
    issue.overprintsCode = codes.length > 0;
    if (codes.length) issue.overprintedCodes = codes.map(itemName);
  }
}

function listNames(names: string[]): string {
  return names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** " It also prints over the COA link QR code, so that won’t scan either." */
export function describeOverprints(issue: Pick<BarcodeIssue, 'overprints' | 'overprintsCode' | 'overprintedCodes'>): string {
  if (!issue.overprints?.length) return '';
  const codes = issue.overprintedCodes ?? [];
  const lost = !issue.overprintsCode ? '' : issue.overprints.length === 1 ? ', so that won’t scan either' : codes.length ? `, so ${listNames(codes)} won’t scan either` : ', so the code it covers won’t scan either';
  return ` It also prints over ${listNames(issue.overprints)}${lost}.`;
}

export function checkRunBarcodes(template: Pick<LabelTemplate, 'elements'> & Partial<Pick<LabelTemplate, 'thermalRenderMode'>>, run: RunData, format?: FitFormat | null): BarcodeCheck {
  const bitmap = template.thermalRenderMode === 'bitmap-v1';
  const barcodes = template.elements.filter((el): el is BarcodeElement => el.type === 'barcode');
  const issues: BarcodeIssue[] = [];
  const warnings: BarcodeIssue[] = [];
  const fitCounts: Record<string, number> = {};
  let badLabels = 0;
  const total = Math.max(1, run.sourceData.length);
  if (!barcodes.length) return { issues, badLabels, warnings, checkedLabels: total, fitCounts };
  const keep = (list: BarcodeIssue[], found: BarcodeIssue) => {
    if (list.length < MAX_ISSUES && !list.some((i) => i.label === found.label && i.field === found.field)) list.push(found);
  };
  // A fixed barcode is the same on every label: check it once.
  for (const el of barcodes.filter((b) => b.isStatic)) {
    const found = issueFor(el, 0, printedValue(el, {}), format, bitmap);
    if (!found) continue;
    if (found.kind === 'tight') warnings.push(found);
    else { issues.push(found); badLabels = total; }
  }
  const dynamic = barcodes.filter((b) => !b.isStatic);
  for (let index = 0; index < total && dynamic.length; index++) {
    const values = valuesFor(run, index);
    let bad = false;
    for (const el of dynamic) {
      const found = issueFor(el, index + 1, printedValue(el, values), format, bitmap);
      if (!found) continue;
      if (found.fit && found.kind !== 'characters') fitCounts[`${found.field}|${found.fit.reason}`] = (fitCounts[`${found.field}|${found.fit.reason}`] ?? 0) + 1;
      if (found.kind === 'tight') { keep(warnings, found); continue; }
      bad = true;
      keep(issues, found);
    }
    if (bad && badLabels < total) badLabels++;
  }
  addOverprints(template, run, format, issues);
  return { issues, badLabels, warnings, checkedLabels: total, fitCounts };
}

function shorten(value: string, max = 24): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * "Label 10: the SKU 'ABC-…ÄÖ' has characters a barcode can't hold (Ä, Ö).
 * Fix row 11 of your spreadsheet." `fromSpreadsheet` adds the row hint. Only
 * a value the barcode type can't hold is sent back to the data; a barcode
 * that doesn't fit is a layout fix, never "shorten it" (package tags are
 * state tracking IDs).
 */
export function describeBarcodeIssue(issue: BarcodeIssue, fromSpreadsheet: boolean): string {
  if (issue.kind === 'too-long' || issue.kind === 'tight') {
    const fix = issue.fit ? barcodeFitFix(issue.fit) : '';
    const name = issue.label ? fieldItemWords(issue.field, 'barcode') : 'fixed barcode';
    const where = issue.label ? ` on label ${issue.label.toLocaleString()}${fromSpreadsheet ? ` (row ${spreadsheetRow(issue.label).toLocaleString()})` : ''}` : '';
    return `The ${name}${where} ${issue.problem}.${describeOverprints(issue)}${fix ? ` ${fix}.` : ''}`;
  }
  if (!issue.label) return `The fixed barcode "${shorten(issue.value)}" ${issue.problem}. Change it in the design.`;
  const name = friendlyFieldName(issue.field);
  const fix = fromSpreadsheet ? ` Fix row ${spreadsheetRow(issue.label)} of your spreadsheet.` : '';
  return `Label ${issue.label.toLocaleString()}: the ${name} "${shorten(issue.value)}" ${issue.problem}.${fix}`;
}

/** "label 3 (row 4)", "labels 3, 7 and 9", "all 40 labels". */
function whichLabels(labels: number[], count: number, total: number, fromSpreadsheet: boolean): string {
  if (count >= total) return total === 1 ? 'the label' : total === 2 ? 'both labels' : `all ${total.toLocaleString()} labels`;
  const shown = labels.slice(0, 3);
  const rows = fromSpreadsheet ? ` (row${shown.length === 1 ? '' : 's'} ${shown.map((l) => spreadsheetRow(l).toLocaleString()).join(', ')}${count > shown.length ? '…' : ''})` : '';
  const list = count > shown.length ? `${shown.join(', ')} and ${(count - shown.length).toLocaleString()} more` : shown.length === 1 ? String(shown[0]) : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  return `label${count === 1 ? '' : 's'} ${list}${rows}`;
}

/**
 * One sentence per barcode and problem, for the run check: "The Package tag
 * barcode on all 40 labels prints 2.95" wide for 24 characters, but only
 * 1.93" fits from where it starts, so the printer cuts it off and it won’t
 * scan. Make an exact-print copy of the design…". Values the barcode type
 * can't hold stay one line per label (each needs its own fix in the data).
 */
export function describeBarcodeGroups(issues: ReadonlyArray<BarcodeIssue>, totalLabels: number, fromSpreadsheet: (field: string) => boolean, limit = 5, fitCounts: Record<string, number> = {}): { items: string[]; more: number } {
  const groups = new Map<string, BarcodeIssue[]>();
  const lines: string[] = [];
  for (const issue of issues) {
    if (issue.kind === 'characters' || !issue.fit) {
      lines.push(describeBarcodeIssue(issue, fromSpreadsheet(issue.field)));
      continue;
    }
    const key = `${issue.field}|${issue.label ? 'row' : 'fixed'}|${issue.fit.reason}`;
    groups.set(key, [...(groups.get(key) ?? []), issue]);
  }
  const grouped: string[] = [];
  for (const list of groups.values()) {
    // Describe the widest value; the others are narrower.
    const widest = list.reduce((a, b) => ((b.fit?.barsDots ?? 0) > (a.fit?.barsDots ?? 0) ? b : a));
    if (!widest.label) { grouped.push(describeBarcodeIssue(widest, false)); continue; }
    const labels = list.map((i) => i.label);
    const count = Math.max(list.length, fitCounts[`${widest.field}|${widest.fit?.reason}`] ?? 0);
    const fix = widest.fit ? barcodeFitFix(widest.fit) : '';
    const over = list.find((i) => i.overprints?.length) ?? widest;
    grouped.push(`The ${fieldItemWords(widest.field, 'barcode')} on ${whichLabels(labels, Math.min(count, totalLabels), totalLabels, fromSpreadsheet(widest.field))} ${widest.problem}.${describeOverprints(over)}${fix ? ` ${fix}.` : ''}`);
  }
  const all = [...grouped, ...lines];
  return { items: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}
