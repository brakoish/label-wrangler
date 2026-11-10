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
 * and which details. Lab potency counts only when the design prints it;
 * missing retail IDs always count (the package becomes one label instead of
 * one per unit).
 */
export function runMissingDetails(rows: ReadonlyArray<Record<string, string>>, mappings: Record<string, FieldMapping>): { labels: number[]; missing: NabisMissing[]; signature: string } {
  const columns = Object.values(mappings).filter((m) => m.mode === 'column' && m.csvColumn).map((m) => m.csvColumn as string);
  const prints: Record<NabisMissing, boolean> = {
    // Retail IDs always count: without them a package is one label, not one per unit.
    retailIds: true,
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

/** The Nabis detail a column holds, when Metrc can leave it out. */
function detailForColumn(column: string): NabisMissing | null {
  if (column === 'retailId') return 'retailIds';
  return LAB_COLUMN.test(column) ? 'labPotency' : null;
}

/**
 * The parts of the label (field names) that are empty on some of `labels`
 * (1-based) because Nabis didn't send that detail. Ticking "leave them off"
 * leaves exactly these off the run, so nothing (not the design's sample)
 * prints there.
 */
export function missingDetailFields(rows: ReadonlyArray<Record<string, string>>, mappings: Record<string, FieldMapping>, labels: ReadonlyArray<number>): string[] {
  const out: string[] = [];
  for (const [field, mapping] of Object.entries(mappings)) {
    if (mapping.mode !== 'column' || !mapping.csvColumn) continue;
    const column = mapping.csvColumn;
    const detail = detailForColumn(column);
    if (!detail) continue;
    if (labels.some((n) => { const row = rows[n - 1]; return rowMissingDetails(row).includes(detail) && !String(row?.[column] ?? '').trim(); })) out.push(field);
  }
  return out;
}
