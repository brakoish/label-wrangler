import type { FieldMapping } from './types';

/**
 * Details a Nabis row can be missing because Metrc didn't answer in time
 * (the search route's `detailsMissing`): the per-unit retail IDs, and the
 * lab potency (THC / CBD / total cannabinoids).
 */
export type NabisMissing = 'retailIds' | 'labPotency';

const LAB_COLUMN = /^(thc|cbd|tac|totalActiveCannabinoids|totalCannabinoids)/;

export function rowMissingDetails(row: Record<string, string> | undefined | null): NabisMissing[] {
  const words = String(row?.detailsMissing ?? '').split(/\s+/);
  return (['retailIds', 'labPotency'] as const).filter((detail) => words.includes(detail));
}

/**
 * The labels (1-based, in run order) whose mapped Nabis details are missing,
 * and which details. Only what the design really prints counts: a missing
 * retail ID doesn't matter to a design that doesn't print one.
 */
export function runMissingDetails(rows: ReadonlyArray<Record<string, string>>, mappings: Record<string, FieldMapping>): { labels: number[]; missing: NabisMissing[]; signature: string } {
  const columns = Object.values(mappings).filter((m) => m.mode === 'column' && m.csvColumn).map((m) => m.csvColumn as string);
  const prints: Record<NabisMissing, boolean> = {
    retailIds: columns.includes('retailId'),
    labPotency: columns.some((column) => LAB_COLUMN.test(column)),
  };
  const labels: number[] = [];
  const missing = new Set<NabisMissing>();
  rows.forEach((row, index) => {
    const gaps = rowMissingDetails(row).filter((detail) => prints[detail]);
    if (!gaps.length) return;
    labels.push(index + 1);
    for (const gap of gaps) missing.add(gap);
  });
  const list = (['retailIds', 'labPotency'] as const).filter((d) => missing.has(d));
  return { labels, missing: list, signature: `${list.join('+')}:${labels.join(',')}` };
}

/** "retail IDs", "lab potency", "retail IDs and lab potency". */
export function missingDetailsWords(missing: ReadonlyArray<NabisMissing>): string {
  const words = missing.map((d) => (d === 'retailIds' ? 'retail IDs' : 'lab potency'));
  return words.join(' and ');
}

/** "label 3", "labels 1–4", "labels 1, 3 and 7", "all 12 labels". */
export function labelsWords(labels: ReadonlyArray<number>, total: number): string {
  if (labels.length >= total && total > 1) return total === 2 ? 'both labels' : `all ${total.toLocaleString()} labels`;
  if (labels.length === 1) return total === 1 ? 'the label' : `label ${labels[0]}`;
  const consecutive = labels.every((n, i) => i === 0 || n === labels[i - 1] + 1);
  if (consecutive) return `labels ${labels[0]}–${labels[labels.length - 1]}`;
  const shown = labels.slice(0, 4);
  return labels.length > shown.length
    ? `labels ${shown.join(', ')} and ${(labels.length - shown.length).toLocaleString()} more`
    : `labels ${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}
