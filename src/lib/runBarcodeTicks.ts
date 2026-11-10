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

/** An exact design's value that prints, but scans differently (the words barcodeValue's drawnValueNote writes). */
function drawnAs(item: string): 'uppercase' | 'not-as-written' | null {
  if (/will scan as UPPERCASE/.test(item)) return 'uppercase';
  if (/scan as a Tab key press|scan as an Enter key press|so the scan won’t match the text you see|printed as (a )?special scanner codes?/.test(item)) return 'not-as-written';
  return null;
}

/** What printing it anyway really costs, in one sentence. */
export function barcodeDamage(item: string): string {
  if (barcodeProblemSevere(item)) return 'Printing anyway spoils two labels each time: this one, and the next one on the roll.';
  if (/cuts it off/i.test(item)) return 'Printing anyway gives labels whose barcode won’t scan.';
  const drawn = drawnAs(item);
  if (drawn === 'uppercase') return 'Printing anyway gives labels whose barcode scans in UPPERCASE.';
  if (drawn) return 'Printing anyway gives labels whose barcode won’t scan exactly as written.';
  return 'Printing anyway gives labels whose barcode may not scan.';
}

/** The problem as the run page shows it: the fix points at the designer link beside it. */
export function runPageProblemText(item: string): string {
  return item.replace(/ \(More menu in the designer\)/g, ' (in the designer)');
}

/**
 * The one go-ahead wording, the same on the new-run page, the run page and
 * the designer: the plain sentence above it already says what goes wrong.
 */
export const PRINT_ANYWAY = 'Print anyway';

/** The tick's words for one problem (one wording everywhere). */
export function barcodeTickLabel(item: string): string {
  void item;
  return PRINT_ANYWAY;
}

/** The fix link's words, the same wherever a barcode problem is shown outside the designer. */
export const FIX_IN_DESIGNER = 'Fix in the designer';

function firstSentence(text: string): string {
  // A sentence ends at ". " that isn't inside quotes or a measurement ("2.84"").
  const match = text.match(/^.*?[.!?](?=\s+[A-Z(]|$)/);
  return (match ? match[0] : text).trim();
}

function listCount(names: string): number {
  return names.split(/,\s*|\s+and\s+/).filter(Boolean).length;
}

/**
 * One plain sentence for a barcode problem, as a first-timer would say it:
 * "The Package tag barcode is too wide for this label and covers the COA
 * link QR code, so neither will scan." The measurements and the fix stay in
 * the full text, shown behind "Why?". Works on the shared check's words
 * (new run, run page) and the designer's; anything it doesn't recognise
 * keeps its first sentence.
 */
export function barcodePlainSentence(item: string): string {
  const text = item.trim();
  const head = text.match(/^The (?:(.+?) )?barcode(?: on (all [\d,]+ labels|both labels|the label|labels? .+?))? (?=prints |starts |needs |has |crosses |reaches |runs )/);
  if (!head) return firstSentence(text);
  const name = !head[1] || head[1] === 'fixed' ? 'The barcode' : `The ${head[1]} barcode`;
  const where = head[2] && !/^(all |both |the label)/.test(head[2]) ? ` on ${head[2].replace(/\s*\(rows? [^)]*\)/, '')}` : '';
  const subject = `${name}${where}`;
  // What else it prints over that won't scan either ("so that" names the one item it covers).
  const lost = text.match(/.*\bso (.+?) won’t scan either/);
  const over = text.match(/(?:It also prints over|and prints over|and is under) (.+?)(?:, so|\.)/);
  const covered = lost ? (lost[1] === 'that' ? over?.[1] ?? '' : lost[1]) : '';
  const both = covered ? (listCount(covered) > 1 ? 'none of them' : 'neither') : '';
  if (/neither label (?:would|will) scan/.test(text)) {
    return `${subject} is too wide and prints over the next label’s barcode, so neither label will scan${covered ? `, and ${covered} won’t either` : ''}.`;
  }
  if (/runs onto the next label/.test(text)) return covered ? `${subject} is too wide, runs onto the next label and covers ${covered}, so ${both} will scan.` : `${subject} is too wide and runs onto the next label, so it won’t scan.`;
  const edge = text.match(/(?:starts|runs) off the (left|right|top|bottom) edge of the label/);
  if (/starts off the (?:\w+ edge of the )?label/.test(text)) return `${subject} starts off the ${edge ? `${edge[1]} ` : ''}edge of the label, so it won’t scan.`;
  if (edge && /can’t be drawn/.test(text)) return `${subject} runs off the ${edge[1]} edge of the label, so it can’t print${covered ? `, and overlaps ${covered}` : ''}.`;
  if (edge) return covered ? `${subject} runs off the ${edge[1]} edge of the label and covers ${covered}, so ${both} will scan.` : `${subject} runs off the ${edge[1]} edge of the label, so it won’t scan.`;
  if (/cuts it off/.test(text)) return covered ? `${subject} is too wide for this label and covers ${covered}, so ${both} will scan.` : `${subject} is too wide for this label, so it won’t scan.`;
  if (/needs a box at least/.test(text)) return `${subject} doesn’t fit in its box, so it can’t print.`;
  if (/box too short/.test(text)) return `${subject} has a box too short for it, so it can’t print.`;
  if (/crosses the label edge/.test(text)) return `${subject} runs off the label, so it can’t print.`;
  if (/almost no clear space/.test(text)) return `${subject} is very close to the label edge, so some scanners may not read it.`;
  return firstSentence(text);
}

/** True when "Why?" would show more than the plain sentence. */
export function barcodeHasDetails(item: string): boolean {
  return barcodePlainSentence(item).replace(/\s+/g, ' ') !== item.trim().replace(/\s+/g, ' ');
}

/**
 * Why the Start or Print button waits, in one line that points at what is
 * on the page (never "the list above"): the run waits for a fix, or for a
 * tick on each "Print anyway".
 */
export function barcodeWaitWords(stops: boolean, problems: number): string {
  if (stops) return problems === 1 ? 'A barcode can’t print. Fix the design to go on.' : 'Some barcodes can’t print. Fix the design to go on.';
  return problems === 1 ? 'A barcode won’t scan. Fix it, or tick “Print anyway”.' : 'Some barcodes won’t scan. Fix them, or tick “Print anyway” for each.';
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
