import type { LabelFormat, LabelTemplate, TemplateElement, Run } from './types';
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
 * Produce the set of field values for label #index in a run.
 * Static values are copied as-is; the mapped field gets the ith entry from sourceData.
 */
function valuesForLabel(run: Run, index: number): Record<string, string> {
  const values: Record<string, string> = { ...run.staticValues };
  if (run.mappedField && index < run.sourceData.length) {
    values[run.mappedField] = run.sourceData[index] ?? '';
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

/** Preview a single label (useful for the wizard preview step). */
export function previewLabelValues(run: Run, index = 0): Record<string, string> {
  return valuesForLabel(run, index);
}

/**
 * Determine which template fields SHOULD be shown as "static" inputs in the
 * wizard. Everything except the mapped (variable) field is static.
 */
export function staticFieldsForRun(template: LabelTemplate, mappedField: string | null): string[] {
  const all = dynamicFieldsForTemplate(template);
  return all.filter((f) => f !== mappedField);
}

// Re-export for convenience in UI.
export type { TemplateElement };
