import type { LabelFormat, LabelTemplate, Run } from './types';
import { layoutProblems } from './designerLayout';
import { previewLabelValues } from './runBuilder';

/**
 * Items that cover each other or run off the label, on any of the run's
 * labels (up to `limit`). The same check the run wizard does, read-only, so
 * the run page can ask before sending a run made before that check existed
 * or a design changed since. Native thermal designs only: bitmap labels are
 * drawn whole and checked when they are drawn.
 */
export function runLayoutWarnings(run: Run | null | undefined, template: LabelTemplate | null | undefined, format: LabelFormat | null | undefined, limit = 2000): string[] {
  if (!run || !template || !format || format.type !== 'thermal' || template.thermalRenderMode === 'bitmap-v1') return [];
  const found = new Map<string, { message: string; labels: number[]; count: number }>();
  const total = Math.min(Math.max(1, run.totalLabels || run.sourceData.length || 1), limit);
  for (let index = 0; index < total; index++) {
    const values = previewLabelValues(run, Math.min(index, Math.max(0, run.sourceData.length - 1)));
    for (const problem of layoutProblems(template.elements, format, values)) {
      const key = `${problem.kind}:${problem.ids.join(',')}`;
      const entry = found.get(key) ?? { message: problem.message, labels: [], count: 0 };
      entry.count++;
      if (entry.labels.length < 3) entry.labels.push(index + 1);
      found.set(key, entry);
    }
  }
  return Array.from(found.values()).map((entry) => (total > 1 && entry.count < total
    ? `${entry.message.replace(/\.$/, '')} (label${entry.count === 1 ? '' : 's'} ${entry.labels.join(', ')}${entry.count > entry.labels.length ? ` and ${entry.count - entry.labels.length} more` : ''}).`
    : entry.message));
}
