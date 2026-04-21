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
 * Generate per-label ZPL strings for an entire run.
 * Returns one complete ^XA..^XZ per label.
 */
export function generateLabelsForRun(
  run: Run,
  template: LabelTemplate,
  format: LabelFormat,
): string[] {
  const labels: string[] = [];
  const total = Math.max(run.sourceData.length, 1);
  for (let i = 0; i < total; i++) {
    const values = valuesForLabel(run, i);
    labels.push(generateZPL(template, format, values));
  }
  return labels;
}

/** Preview a single label. */
export function previewLabelValues(run: Run, index = 0): Record<string, string> {
  return valuesForLabel(run, index);
}

export type { TemplateElement };
