import type { FieldMapping, LabelTemplate, Run } from './types';

/**
 * Rules for which value each field of a run prints, shared by the new-run
 * wizard and scan mode. Kept free of React so the rules can be tested.
 */

type Row = Record<string, string>;

/**
 * Only fields set to "Same on every label" keep a typed value. A value that
 * was typed (or, in older builds, copied from row 1) for a field that now
 * comes from a spreadsheet column is dropped, so it can never leak onto
 * other labels (scan mode used to print row 1's barcode on every scan).
 */
export function staticValuesForRun(
  fields: ReadonlyArray<string>,
  mappings: Record<string, FieldMapping> | null | undefined,
  staticValues: Record<string, string> | null | undefined,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const field of fields) {
    const mapping = mappings?.[field];
    if (mapping && mapping.mode === 'column') continue;
    const value = staticValues?.[field];
    if (value !== undefined) next[field] = value;
  }
  return next;
}

/** How many different non-empty values a column has (stops counting at `cap`). */
export function distinctValueCount(rows: ReadonlyArray<Row>, column: string, cap = 1000): number {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = (row[column] ?? '').trim();
    if (!value) continue;
    seen.add(value);
    if (seen.size >= cap) break;
  }
  return seen.size;
}

export interface SameValueRisk {
  field: string;
  /** The spreadsheet column that has a different value per row. */
  column: string;
  /** Different values found in that column. */
  distinct: number;
  /** True when every row has its own value (an id, a SKU, a link). */
  everyRowDiffers: boolean;
  /** The one value every label would get ('' when nothing is typed yet). */
  value: string;
  /** The field prints as a barcode or QR code. */
  scannable: boolean;
}

/**
 * Fields set to "Same on every label" although the spreadsheet has a column
 * for them whose value changes from row to row. Printing one value on every
 * label is then almost always a mistake (one SKU barcode on 20 products), so
 * the wizard asks for an explicit confirmation before it starts.
 */
export function sameValueRisks(input: {
  fields: ReadonlyArray<string>;
  mappings: Record<string, FieldMapping>;
  staticValues: Record<string, string>;
  /** Best matching spreadsheet column per field, if any. */
  candidateColumns: Record<string, string | null | undefined>;
  rows: ReadonlyArray<Row>;
  scannableFields?: ReadonlySet<string>;
}): SameValueRisk[] {
  const risks: SameValueRisk[] = [];
  if (input.rows.length < 2) return risks;
  for (const field of input.fields) {
    const mapping = input.mappings[field];
    if (mapping && mapping.mode !== 'static') continue;
    const column = input.candidateColumns[field];
    if (!column) continue;
    const distinct = distinctValueCount(input.rows, column);
    if (distinct < 2) continue;
    const nonEmpty = input.rows.filter((row) => (row[column] ?? '').trim()).length;
    risks.push({
      field,
      column,
      distinct,
      everyRowDiffers: distinct >= nonEmpty,
      value: (input.staticValues[field] ?? '').trim(),
      scannable: input.scannableFields?.has(field) ?? false,
    });
  }
  return risks;
}

/** Stable key so a confirmation only covers the exact risks it was given for. */
export function sameValueRiskKey(risks: ReadonlyArray<SameValueRisk>): string {
  return risks.map((risk) => `${risk.field}=${risk.value}`).join('|');
}

/** Fields printed as a barcode or QR code. */
export function scannableFieldNames(template: Pick<LabelTemplate, 'elements'>): Set<string> {
  const names = new Set<string>();
  for (const el of template.elements) {
    if (el.isStatic || (el.type !== 'barcode' && el.type !== 'qr')) continue;
    if (el.fieldName?.trim()) names.add(el.fieldName);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Scan mode
// ---------------------------------------------------------------------------

type ScanRun = Pick<Run, 'staticValues' | 'fieldMappings' | 'sourceData' | 'mappedField'>;

function columnFor(run: ScanRun, field: string): string | null {
  const mapping = run.fieldMappings?.[field];
  return mapping?.mode === 'column' && mapping.csvColumn ? mapping.csvColumn : null;
}

function rowObjects(run: ScanRun): Row[] {
  return (run.sourceData as Array<string | Row>).filter((row): row is Row => !!row && typeof row === 'object' && !Array.isArray(row));
}

/** Fields whose value comes from a spreadsheet column, one per label. */
export function columnFields(run: ScanRun, fields: ReadonlyArray<string>): string[] {
  return fields.filter((field) => !!columnFor(run, field));
}

/**
 * Whether a scan into `target` can find its label: the target comes from a
 * spreadsheet column and the run has rows, so the scanned value is looked up
 * in that column and the matching row fills every other per-label field.
 */
export function scanCanLookUpRow(run: ScanRun, target: string | null): boolean {
  return !!target && !!columnFor(run, target) && rowObjects(run).length > 0;
}

/** Sensible default for "Each scan fills": the barcode or tag field. */
export function defaultScanField(run: ScanRun, template: Pick<LabelTemplate, 'elements'>, fields: ReadonlyArray<string>): string | null {
  if (!fields.length) return null;
  const typed = (type: string) => template.elements.filter((el) => !el.isStatic && el.type === type && el.fieldName && fields.includes(el.fieldName)).map((el) => el.fieldName as string);
  const barcodes = typed('barcode');
  const qrs = typed('qr');
  const tagLike = fields.filter((field) => /tag|sku|barcode|upc|ean|uid|code|id$/i.test(field));
  const columned = (list: string[]) => list.find((field) => !!columnFor(run, field));
  return columned(barcodes) ?? barcodes[0]
    ?? columned(tagLike) ?? columned(qrs) ?? tagLike[0] ?? qrs[0]
    ?? columned([...fields])
    ?? (run.mappedField && fields.includes(run.mappedField) ? run.mappedField : null)
    ?? fields[0];
}

export interface ScanLabel {
  values: Record<string, string>;
  /** 1-based label number of the matching row, when the scan was looked up. */
  matchedLabel: number | null;
  /** Per-label fields the scan could not fill (no matching row). */
  unfilled: string[];
}

/**
 * The values one scanned label prints with. Only "Same on every label" values
 * are reused; another row's per-label values never are. When the scanned
 * field comes from a column, the row whose cell equals the scan supplies the
 * other per-label values; with no match those fields stay empty and are
 * reported, so the caller can refuse to print instead of printing samples.
 */
export function scanLabelValues(run: ScanRun, fields: ReadonlyArray<string>, target: string, scanned: string): ScanLabel {
  const value = scanned.trim();
  const values: Record<string, string> = staticValuesForRun(fields, run.fieldMappings, run.staticValues);
  values[target] = value;
  const perLabel = columnFields(run, fields).filter((field) => field !== target);
  const targetColumn = columnFor(run, target);
  if (targetColumn) {
    const rows = rowObjects(run);
    const index = rows.findIndex((row) => (row[targetColumn] ?? '').trim() === value);
    if (index >= 0) {
      const row = rows[index];
      for (const field of perLabel) values[field] = row[columnFor(run, field) as string] ?? '';
      return { values, matchedLabel: index + 1, unfilled: perLabel.filter((field) => !(values[field] ?? '').trim()) };
    }
  }
  return { values, matchedLabel: null, unfilled: perLabel };
}

/**
 * Data for the up-front blank check in scan mode: the scanned field counts as
 * filled; other per-label fields count as filled only when a scan can look up
 * its row. Typed values are used only for "Same on every label" fields.
 */
export function scanCheckData(run: ScanRun, fields: ReadonlyArray<string>, target: string) {
  const lookUp = scanCanLookUpRow(run, target);
  const row: Row = { __scan__: 'scanned' };
  const mappings: Record<string, FieldMapping> = { [target]: { mode: 'column', csvColumn: '__scan__' } };
  if (lookUp) {
    for (const field of columnFields(run, fields)) {
      if (field === target) continue;
      row.__row__ = 'looked up';
      mappings[field] = { mode: 'column', csvColumn: '__row__' };
    }
  }
  return {
    sourceData: [row],
    fieldMappings: mappings,
    staticValues: staticValuesForRun(fields, run.fieldMappings, run.staticValues),
  };
}
