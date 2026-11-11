/**
 * The run page's go-ahead for barcodes that won't print whole: one tick per
 * problem, kept on this device. A go-ahead given in the new-run wizard for
 * these exact problems carries over (shown ticked, with a line saying it was
 * chosen when the run was made), so nobody ticks the same thing twice. A
 * barcode that runs onto the next label ("neither label would scan") says
 * what printing it costs right beside that tick.
 */
const PREFIX = 'lw:run-barcode-ok:';

/** True for a problem that spoils the next label too. */
export function barcodeProblemSevere(item: string): boolean {
  return /neither label (?:would|will) scan/i.test(item);
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

/**
 * The tick's words for one problem: plain "Print anyway" for one label, and
 * the count when one tick covers more ("Print all 20 anyway"), so a tick
 * never covers more than it says.
 */
export function barcodeTickLabel(item: string): string {
  const all = item.match(/ on all ([\d,]+) labels /);
  if (all) return `Print all ${all[1]} anyway`;
  if (/ on both labels /.test(item)) return 'Print both anyway';
  const some = item.match(/ on labels ([\d, ]+?)(?: and ([\d,]+) more| and (\d+))?(?: \(rows?|\s(?=prints |starts |needs |has |crosses |reaches |runs ))/);
  if (some) {
    const shown = some[1].split(',').map((n) => n.trim()).filter(Boolean).length + (some[3] ? 1 : 0);
    const count = shown + (some[2] ? Number(some[2].replace(/,/g, '')) : 0);
    if (count > 1) return `Print these ${count.toLocaleString()} anyway`;
  }
  if (/^The fixed barcode /.test(item)) return 'Print every label anyway';
  return PRINT_ANYWAY;
}

/** True when one problem is on every label of the run (so any send has it). */
function onEveryLabel(item: string): boolean {
  return / on all [\d,]+ labels /.test(item) || /^The fixed barcode /.test(item);
}

/**
 * The run page's tick words, for the labels the next send or print really
 * covers: a problem on every label names that exact range and count ("Print
 * labels 97–240 (144) anyway"), never the run's total when fewer go. The
 * whole run (or no range yet) keeps the plain words.
 */
export function barcodeSendTickLabel(item: string, send: { from: number; to: number } | null | undefined, total: number): string {
  const plain = barcodeTickLabel(item);
  if (!send || !onEveryLabel(item) || !Number.isInteger(send.from) || !Number.isInteger(send.to) || send.from < 1 || send.to < send.from) return plain;
  if (send.from === 1 && send.to >= total) return plain;
  const count = send.to - send.from + 1;
  if (count === 1) return `Print label ${send.from.toLocaleString('en-US')} anyway`;
  return `Print labels ${send.from.toLocaleString('en-US')}–${send.to.toLocaleString('en-US')} (${count.toLocaleString('en-US')}) anyway`;
}

/** The fix link's words, the same wherever a barcode problem is shown outside the designer. */
/** The secondary way out, beside "Fix it for me", named the same on every page. */
export const FIX_IN_DESIGNER = 'Open in designer';

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
 * What "Why?" adds under the plain sentence: only what the sentence didn't
 * already say (the measurements, the fix), never the same sentence again.
 * A value the barcode can't hold also says what it can hold.
 */
export function barcodeWhyText(item: string): string {
  const text = item.trim().replace(/\s+/g, ' ');
  const plain = barcodePlainSentence(item).trim().replace(/\s+/g, ' ');
  let rest = text.startsWith(plain) ? text.slice(plain.length).trim() : text;
  if (/characters a barcode can't hold/.test(plain)) rest = `This barcode holds plain letters, numbers and everyday symbols only.${rest ? ` ${rest}` : ''}`;
  return rest;
}

/**
 * The run page's "Why?" in words a first-timer follows: what to do about it,
 * with no measurements and no unexplained terms. A run keeps the design it
 * was made with, so the last sentence says where the fix prints.
 */
export function barcodeRunWhy(item: string, finished = false): string {
  const text = item.trim().replace(/\s+/g, ' ');
  const picture = /picture copy/.test(text);
  let fix: string;
  if (/neither label (?:would|will) scan|runs onto the next label|cuts it off|too wide/.test(text)) {
    fix = picture
      ? 'The code is too long to fit this label. In the designer, press “Make a picture copy”: it draws thinner bars that fit.'
      : /QR code/.test(text)
        ? 'The code is too long to fit this label. In the designer, make the barcode box wider, or use a QR code instead.'
        : 'The code is too long to fit this label. In the designer, make the barcode box wider.';
  } else if (/starts off the|runs off the (?:left|right|top|bottom) edge|crosses the label edge|move the barcode box fully onto/.test(text)) {
    fix = 'Part of the barcode is off the label. In the designer, move it fully onto the label.';
  } else if (/needs a box at least|box too short|make the barcode box taller/.test(text)) {
    fix = 'The barcode’s box is too small for it. In the designer, make the box bigger.';
  } else if (/almost no clear space/.test(text)) {
    fix = 'Scanners need a little empty space around a barcode. In the designer, move it in from the edge a little.';
  } else if (/characters a barcode can['’]t hold/.test(text)) {
    fix = 'This barcode holds plain letters, numbers and everyday symbols only. Change the text, or use a QR code instead.';
  } else if (/will scan as UPPERCASE/.test(text)) {
    fix = 'This kind of barcode only holds capital letters, so a scanner reads the text in capitals.';
  } else if (/Tab key press|Enter key press|special scanner codes?|scan won’t match/.test(text)) {
    fix = 'Some of the text turns into scanner keys (like Tab or Enter), so a scan won’t match what you see.';
  } else {
    // Anything else: the item's own words, without measurements.
    fix = text.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((sentence) => !/\d+(?:\.\d+)?["”]/.test(sentence)).join(' ');
  }
  const where = finished
    ? 'Fixing the design doesn’t change labels already printed; the fix prints in a new run with the same data.'
    : 'Fixing the design doesn’t change this run; the fix prints in a new run with the same data.';
  return `${fix} ${where}`.trim();
}

/**
 * Why the Start or Print button waits, in one line that points at what is
 * on the page (never "the list above"): the run waits for a fix, or for a
 * tick on each "Print anyway".
 */
export function barcodeWaitWords(stops: boolean, problems: number, tickLabel: string = PRINT_ANYWAY): string {
  if (stops) return problems === 1 ? 'A barcode can’t print. Fix the design to go on.' : 'Some barcodes can’t print. Fix the design to go on.';
  return problems === 1 ? `A barcode won’t scan. Fix it, or tick “${tickLabel}”.` : 'Some barcodes won’t scan. Fix them, or tick each “Print … anyway”.';
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
  return ticks.includes(item) || wizardGoAhead;
}

/** Every problem ticked (none at all also counts). */
export function barcodeTicksAllow(items: ReadonlyArray<string>, ticks: ReadonlyArray<string>, wizardGoAhead: boolean): boolean {
  return items.every((item) => barcodeItemTicked(item, ticks, wizardGoAhead));
}
