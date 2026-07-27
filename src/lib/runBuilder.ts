import type { LabelFormat, LabelTemplate, TemplateElement, Run, FieldMapping } from './types';
import { generateZPL } from './zplGenerator';

/**
 * Get the list of dynamic-field names present in a template (deduplicated,
 * excluding elements that don't have a field name).
 */
export function dynamicFieldsForTemplate(template: LabelTemplate): string[] {
  const names = new Set<string>();
  for (const el of template.elements) {
    if (el.isStatic) continue;
    const name = el.fieldName;
    if (name && name.trim()) names.add(name);
  }
  return Array.from(names);
}

/**
 * List of element ids that are STATIC but look like they'd make sense as
 * dynamic fields in a print run (QR, barcode, empty-content text). Used in
 * the Runs wizard to offer a one-click "make dynamic" shortcut.
 */
export function staticFlippableElements(template: LabelTemplate): Array<{ id: string; type: string; suggestedName: string }> {
  const used = new Set(template.elements.map((e) => e.fieldName).filter((s): s is string => !!s));
  return template.elements
    .filter((el) => el.isStatic && (el.type === 'qr' || el.type === 'barcode'))
    .map((el) => {
      let n = 1;
      let name = `${el.type}_${n}`;
      while (used.has(name)) {
        n++;
        name = `${el.type}_${n}`;
      }
      used.add(name);
      return { id: el.id, type: el.type, suggestedName: name };
    });
}

/**
 * Given a template and saved mappings, figure out which fields the user should
 * still see as static inputs: every dynamic field that isn't mapped to a CSV
 * column.
 */
export function staticFieldsForMappings(
  template: LabelTemplate,
  mappings: Record<string, FieldMapping>,
): string[] {
  const all = dynamicFieldsForTemplate(template);
  return all.filter((f) => !mappings[f] || mappings[f].mode === 'static');
}

/** True if any field in `mappings` is mapped to a CSV column. */
export function hasVariableMapping(mappings: Record<string, FieldMapping>): boolean {
  return Object.values(mappings).some((m) => m.mode === 'column' && m.csvColumn);
}

/**
 * Produce the set of field values for label #index in a run.
 * Static fields come from run.staticValues. Variable fields pull from the
 * indexed row in run.sourceData (if it's an array of row objects) or from
 * the indexed string (legacy paste mode + single-field runs).
 */
function valuesForLabel(run: Run, index: number): Record<string, string> {
  const values: Record<string, string> = { ...run.staticValues };

  const mappings = run.fieldMappings || {};
  const row = run.sourceData[index];

  // Multi-field CSV runs: each row is Record<string, string>. For every
  // field mapped to a column, pull that column's value out of the row.
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    for (const [field, mapping] of Object.entries(mappings)) {
      if (mapping.mode === 'column' && mapping.csvColumn) {
        values[field] = (row as Record<string, string>)[mapping.csvColumn] ?? '';
      }
    }
    return values;
  }

  // Legacy single-field runs: row is a plain string that fills the
  // legacy run.mappedField (or any field with mode='column').
  if (typeof row === 'string') {
    const legacyField =
      run.mappedField ??
      Object.entries(mappings).find(([, m]) => m.mode === 'column')?.[0] ??
      null;
    if (legacyField) values[legacyField] = row;
  }
  return values;
}

/**
 * Generate the ZPL feed strings for an entire run. For a single-across roll
 * this is one ^XA..^XZ per row (1 feed = 1 physical label). For a
 * multi-across roll this is one ^XA..^XZ per FEED (each feed produces
 * `labelsAcross` physical labels side-by-side, each with its own CSV row).
 *
 * Returned array length = number of printer feeds needed for the run, NOT
 * the total physical label count. The printer prints one feed per entry.
 */
export function generateLabelsForRun(
  run: Run,
  template: LabelTemplate,
  format: LabelFormat,
): string[] {
  const feeds: string[] = [];
  const total = Math.max(run.sourceData.length, 1);
  const across = Math.max(1, format.labelsAcross || 1);

  if (across === 1) {
    // Simple case: one feed per row.
    for (let i = 0; i < total; i++) {
      feeds.push(generateZPL(template, format, valuesForLabel(run, i)));
    }
    return feeds;
  }

  // Multi-across: bundle `across` consecutive rows into each feed. The last
  // feed may be partially filled; pad with undefined so those lanes print
  // blank instead of repeating the previous row.
  for (let i = 0; i < total; i += across) {
    const laneValues: Array<Record<string, string> | undefined> = [];
    for (let lane = 0; lane < across; lane++) {
      const idx = i + lane;
      laneValues.push(idx < total ? valuesForLabel(run, idx) : undefined);
    }
    feeds.push(generateZPL(template, format, laneValues));
  }
  return feeds;
}

/** Total physical labels a run will produce. For single-across this equals
 *  the row count; for multi-across it still equals the row count since each
 *  row produces exactly one physical label somewhere across the lanes. */
export function totalLabelsForRun(run: Run): number {
  return run.sourceData.length;
}

/** Count of printer feeds needed to produce the run. Equals ceil(rows / across). */
export function totalFeedsForRun(run: Run, format: LabelFormat): number {
  const across = Math.max(1, format.labelsAcross || 1);
  return Math.ceil(run.sourceData.length / across);
}

/** Preview a single label. */
export function previewLabelValues(run: Run, index = 0): Record<string, string> {
  return valuesForLabel(run, index);
}

export type { TemplateElement };
