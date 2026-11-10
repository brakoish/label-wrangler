import type { LabelFormat, LabelTemplate, Run } from './types';
import { layoutProblems, type LayoutProblem } from './designerLayout';
import { previewLabelValues } from './runBuilder';
import { checkRunBarcodes, describeBarcodeGroups } from './barcodeCheck';

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

/**
 * Items that cover each other or run off the label, on any of the run's
 * labels (up to `limit`). The same check the run wizard does, read-only, so
 * the run page can ask before sending a run made before that check existed
 * or a design changed since. Native thermal designs only: bitmap labels are
 * drawn whole and checked when they are drawn.
 */
export function runLayoutWarnings(run: Run | null | undefined, template: LabelTemplate | null | undefined, format: LabelFormat | null | undefined, limit = 2000): string[] {
  if (!run || !template || !format || format.type !== 'thermal' || template.thermalRenderMode === 'bitmap-v1') return [];
  const total = Math.min(Math.max(1, run.totalLabels || run.sourceData.length || 1), limit);
  return collect(run, template, format, total, () => true);
}

export interface RunPrintCheck {
  /**
   * Barcodes the printer can't produce (a value the barcode type can't hold,
   * an exact box the renderer refuses, bars cut off at the label edge or
   * printed onto the next label). Sending should wait for a design fix.
   */
  blocking: string[];
  /** Prints, but worth a look first (overlaps, tight barcodes): ask, then allow. */
  warnings: string[];
}

/**
 * The run page's check before sending, with the same barcode verdict as the
 * designer and the new-run wizard (barcodeFit), so the same Metrc tag gets
 * the same answer everywhere. Read-only.
 */
export function runPrintCheck(run: Run | null | undefined, template: LabelTemplate | null | undefined, format: LabelFormat | null | undefined, limit = 2000): RunPrintCheck {
  if (!run || !template || !format) return { blocking: [], warnings: [] };
  const total = Math.min(Math.max(1, run.totalLabels || run.sourceData.length || 1), limit);
  const sheet = run.dataSource === 'csv';
  const data = { sourceData: run.sourceData.slice(0, total), fieldMappings: run.fieldMappings, staticValues: run.staticValues, mappedField: run.mappedField };
  const barcodes = checkRunBarcodes(template, data, format);
  const fromSheet = (field: string) => sheet && run.fieldMappings?.[field]?.mode === 'column';
  const blocking = describeBarcodeGroups(barcodes.issues, barcodes.checkedLabels, fromSheet, 50, barcodes.fitCounts).items;
  const warnings = describeBarcodeGroups(barcodes.warnings, barcodes.checkedLabels, fromSheet, 50, barcodes.fitCounts).items;
  if (format.type === 'thermal' && template.thermalRenderMode !== 'bitmap-v1') {
    // Barcode fit problems are named above, once; other layout problems (overlaps) here.
    warnings.push(...collect(run, template, format, total, (problem) => !problem.barcodeFit || (problem.barcodeFit.level === 'ok' && problem.kinds.includes('overlap'))));
  }
  return { blocking, warnings };
}
