/**
 * The run page's go-ahead for barcodes that won't print whole: one tick per
 * problem, kept on this device. A go-ahead given in the new-run wizard still
 * covers the milder problems, but never a barcode that runs onto the next
 * label ("neither label would scan"): that spoils two labels each time, so it
 * is asked again here, where printing starts.
 */
const PREFIX = 'lw:run-barcode-ok:';

/** True for a problem that spoils the next label too. */
export function barcodeProblemSevere(item: string): boolean {
  return /neither label would scan/i.test(item);
}

/** What printing it anyway really costs, in one sentence. */
export function barcodeDamage(item: string): string {
  if (barcodeProblemSevere(item)) return 'Printing anyway spoils two labels each time: this one, and the next one on the roll.';
  if (/cuts it off/i.test(item)) return 'Printing anyway gives labels whose barcode won’t scan.';
  return 'Printing anyway gives labels whose barcode may not scan.';
}

/** The problem as the run page shows it: the fix points at the designer link beside it. */
export function runPageProblemText(item: string): string {
  return item.replace(/ \(More menu in the designer\)/g, ' (in the designer)');
}

/** The tick's words for one problem. */
export function barcodeTickLabel(item: string): string {
  return barcodeProblemSevere(item) ? 'Print anyway — I accept that both labels won’t scan' : 'Print anyway — I accept this barcode may not scan';
}

export function readRunBarcodeTicks(storage: Pick<Storage, 'getItem'> | null | undefined, runId: string): string[] {
  try {
    const data = JSON.parse(storage?.getItem(PREFIX + runId) ?? '[]') as unknown;
    return Array.isArray(data) ? data.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
}

export function saveRunBarcodeTicks(storage: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined, runId: string, ticks: ReadonlyArray<string>): void {
  try {
    if (ticks.length) storage?.setItem(PREFIX + runId, JSON.stringify(ticks));
    else storage?.removeItem(PREFIX + runId);
  } catch { /* kept for this page only */ }
}

/** Whether one problem counts as ticked. */
export function barcodeItemTicked(item: string, ticks: ReadonlyArray<string>, wizardGoAhead: boolean): boolean {
  return ticks.includes(item) || (wizardGoAhead && !barcodeProblemSevere(item));
}

/** Every problem ticked (none at all also counts). */
export function barcodeTicksAllow(items: ReadonlyArray<string>, ticks: ReadonlyArray<string>, wizardGoAhead: boolean): boolean {
  return items.every((item) => barcodeItemTicked(item, ticks, wizardGoAhead));
}
