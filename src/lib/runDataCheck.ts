import type { FieldMapping, LabelTemplate, TemplateElement } from './types';

/**
 * Whole-run blank-value check.
 *
 * The label generators (ZPL, bitmap and sheet) deliberately fall back to an
 * element's designer sample (`defaultValue`) when a field resolves to ''.
 * That is right in the designer and wrong in a run: a blank SKU cell would
 * print the sample barcode. The generators are frozen (they define printed
 * bytes), so instead every run is checked here before it can start.
 *
 * Value resolution mirrors runBuilder.valuesForLabel exactly.
 */
export interface RunDataLike {
  sourceData: ReadonlyArray<string | Record<string, string>>;
  fieldMappings?: Record<string, FieldMapping> | null;
  staticValues?: Record<string, string> | null;
  mappedField?: string | null;
}

/** What the printer does when this field is blank. */
export type BlankOutcome = 'sample' | 'error' | 'blank';

export interface BlankFieldIssue {
  field: string;
  /** no-value: the field has no column and no typed value (every label is blank). */
  kind: 'no-value' | 'empty-rows';
  /** 1-based label/row numbers that are blank (capped at ROW_SAMPLE_LIMIT). */
  rows: number[];
  count: number;
  outcome: BlankOutcome;
  /** The designer sample that would print instead, when outcome is 'sample'. */
  sample: string;
}

export interface RunDataCheck {
  issues: BlankFieldIssue[];
  /** Labels with at least one blank field. */
  blankLabels: number;
  checkedLabels: number;
  /** True only when every issue would really print blank (no sample, no failure). */
  canLeaveBlank: boolean;
  /** Stable text key, so an explicit "leave blank" choice only covers these exact issues. */
  signature: string;
}

const ROW_SAMPLE_LIMIT = 50;

function labelValues(run: RunDataLike, index: number): Record<string, string> {
  const values: Record<string, string> = { ...(run.staticValues || {}) };
  const mappings = run.fieldMappings || {};
  const row = run.sourceData[index];
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    for (const [field, mapping] of Object.entries(mappings)) {
      if (mapping.mode === 'column' && mapping.csvColumn) values[field] = (row as Record<string, string>)[mapping.csvColumn] ?? '';
    }
    return values;
  }
  if (typeof row === 'string') {
    const legacyField = run.mappedField ?? Object.entries(mappings).find(([, m]) => m.mode === 'column')?.[0] ?? null;
    if (legacyField) values[legacyField] = row;
  }
  return values;
}

function fieldIsFromData(run: RunDataLike, field: string) {
  const mapping = run.fieldMappings?.[field];
  if (mapping?.mode === 'column' && mapping.csvColumn) return true;
  return run.mappedField === field && run.sourceData.some((row) => typeof row === 'string');
}

/** Elements whose printed content comes from `field`. */
function elementsForField(template: Pick<LabelTemplate, 'elements'>, field: string): TemplateElement[] {
  return template.elements.filter((el) => !el.isStatic && el.type !== 'image' && el.fieldName === field);
}

export function blankOutcome(template: Pick<LabelTemplate, 'elements'>, field: string): { outcome: BlankOutcome; sample: string } {
  let outcome: BlankOutcome = 'blank';
  let sample = '';
  for (const el of elementsForField(template, field)) {
    if (el.defaultValue) { outcome = 'sample'; sample = sample || el.defaultValue; }
    else if ((el.type === 'qr' || el.type === 'barcode') && outcome === 'blank') outcome = 'error';
  }
  return { outcome, sample };
}

export function dynamicFieldNames(template: Pick<LabelTemplate, 'elements'>): string[] {
  const names = new Set<string>();
  for (const el of template.elements) {
    if (el.isStatic || el.type === 'image') continue;
    if (el.fieldName && el.fieldName.trim()) names.add(el.fieldName);
  }
  return Array.from(names);
}

export function checkRunData(template: Pick<LabelTemplate, 'elements'>, run: RunDataLike): RunDataCheck {
  const total = run.sourceData.length;
  const fields = dynamicFieldNames(template);
  const issues: BlankFieldIssue[] = [];
  const blankLabelSet = new Set<number>();
  const blankRows = new Map<string, number[]>();
  const counts = new Map<string, number>();
  for (let index = 0; index < total; index++) {
    const values = labelValues(run, index);
    for (const field of fields) {
      if ((values[field] ?? '').trim() !== '') continue;
      blankLabelSet.add(index);
      counts.set(field, (counts.get(field) ?? 0) + 1);
      const rows = blankRows.get(field) ?? [];
      if (rows.length < ROW_SAMPLE_LIMIT) rows.push(index + 1);
      blankRows.set(field, rows);
    }
  }
  for (const field of fields) {
    const count = counts.get(field) ?? 0;
    if (!count) continue;
    const { outcome, sample } = blankOutcome(template, field);
    issues.push({
      field,
      kind: fieldIsFromData(run, field) ? 'empty-rows' : 'no-value',
      rows: blankRows.get(field) ?? [],
      count,
      outcome,
      sample,
    });
  }
  return {
    issues,
    blankLabels: blankLabelSet.size,
    checkedLabels: total,
    canLeaveBlank: issues.length > 0 && issues.every((issue) => issue.outcome === 'blank'),
    signature: issues.map((issue) => `${issue.field}:${issue.kind}:${issue.count}:${issue.rows.slice(0, 5).join(',')}`).join('|'),
  };
}

/** "7, 212, 1500 (and 3 more)" */
export function describeRowList(rows: number[], count: number, shown = 3): string {
  const head = rows.slice(0, shown).join(', ');
  return count > shown ? `${head} (and ${(count - shown).toLocaleString()} more)` : head;
}

/** One plain sentence per issue, e.g. "SKU is empty on rows 7, 212, 1500 (and 3 more)." */
export function describeBlankIssue(issue: BlankFieldIssue, total: number): string {
  const consequence = issue.outcome === 'sample'
    ? ` Those labels would print the design's sample "${issue.sample}" instead.`
    : issue.outcome === 'error'
      ? ' A barcode or QR code can\'t print without a value.'
      : '';
  if (issue.kind === 'no-value') {
    return `${issue.field} has no value — pick a spreadsheet column for it or type one value for every label.${consequence}`;
  }
  if (issue.count >= total && total > 1) return `${issue.field} is empty on every row.${consequence}`;
  return `${issue.field} is empty on row${issue.count === 1 ? '' : 's'} ${describeRowList(issue.rows, issue.count)}.${consequence}`;
}

/** Headline for the whole check, e.g. "3 labels are missing a value". */
export function describeBlankSummary(check: RunDataCheck): string {
  if (!check.issues.length) return check.checkedLabels > 0 ? `All ${check.checkedLabels.toLocaleString()} labels checked — every field has a value.` : '';
  const n = check.blankLabels;
  return `${n.toLocaleString()} label${n === 1 ? ' is' : 's are'} missing a value`;
}

/** What to do about it, chosen by whether "leave blank" is a real option. */
export function blankRemedy(check: RunDataCheck): string {
  if (!check.issues.length) return '';
  if (check.canLeaveBlank) return 'Fill them in your spreadsheet and upload it again, or confirm below that these labels should print with that field left blank.';
  return 'Fill them in your spreadsheet and upload it again, or type one value for every label. If the field should never change, open the design and set it to "Same on every label".';
}

const ACK_PREFIX = 'lw:blank-ok:';
/** Remember an explicit "leave blank" choice for a run, tied to the exact issues it covered. */
export function rememberBlankChoice(storage: Pick<Storage, 'setItem'> | null | undefined, runId: string, signature: string) {
  try { storage?.setItem(ACK_PREFIX + runId, signature); } catch { /* storage unavailable: the user can confirm again */ }
}
export function hasBlankChoice(storage: Pick<Storage, 'getItem'> | null | undefined, runId: string, check: RunDataCheck): boolean {
  if (!check.canLeaveBlank) return false;
  try { return storage?.getItem(ACK_PREFIX + runId) === check.signature; } catch { return false; }
}

/** True when printing may start: no blanks, or a deliberate, valid "leave blank" choice. */
export function blankCheckAllowsPrinting(check: RunDataCheck, leaveBlank: boolean) {
  return check.issues.length === 0 || (check.canLeaveBlank && leaveBlank);
}
