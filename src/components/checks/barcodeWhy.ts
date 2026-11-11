/**
 * "Why?" under a barcode problem on the new run page, in words anyone
 * follows: what goes wrong and what to do, with no inches and no design
 * jargon. The shared check (src/lib/barcodeCheck.ts) keeps its measured
 * sentence for the run page and the tests; this only rewords it for show.
 */

const INCH = /\s*\d+(?:\.\d+)?"/;

/**
 * The one plain sentence for a code too long for its label (a 24-character
 * Metrc tag as a barcode on a small label), used wherever that problem is
 * explained, so every page says it the same way.
 */
export const LONG_CODE_WHY = 'This code is too long to scan at this size. Print it as a QR code, or use a bigger label.';
const LONG_CODE_REASON = 'This code is too long to scan at this size.';
const QR_OR_BIGGER = 'print it as a QR code, or use a bigger label';

/** Why it won't scan or can't print, as one plain sentence (no measurements). */
function plainReason(text: string): string {
  if (/neither label (?:would|will) scan|over the next label’s barcode|runs onto the next label/.test(text)) return LONG_CODE_REASON;
  if (/starts off the (?:\w+ edge of the )?label/.test(text)) return 'It starts past the edge of the label, so part of it is cut off.';
  if (/of bars for .+ start where only/.test(text)) return 'The bars would fit on this label, but they start too far along, so the end is cut off.';
  if (/prints [\d.]+" wide for \d+ characters but only/.test(text) && /cuts it off/.test(text)) return LONG_CODE_REASON;
  if (/cuts it off/.test(text)) return 'The code has too many letters and numbers for its bars to fit across this label, so the end is cut off.';
  if (/needs a box at least/.test(text)) return 'The code has too many letters and numbers for the space it has on the design.';
  if (/box too short/.test(text)) return 'Its space on the design is too short for the bars and the number under them.';
  if (/runs off the \w+ edge of the label|crosses the label edge/.test(text)) return 'Part of it sits off the label.';
  if (/almost no clear space/.test(text)) return 'Scanners need a little blank space beside the bars, and it has almost none.';
  return '';
}

/** One fix the check suggests, without measurements. */
function plainFix(option: string): string {
  const o = option.trim();
  if (/picture copy/i.test(o)) return 'open the design and choose “Make a picture copy”. The copy prints the barcode with thinner bars, so it fits, and your original stays as it is';
  if (/make the barcode box at least/i.test(o)) return 'make the barcode’s space wider in the design';
  if (/use a label at least/i.test(o)) return QR_OR_BIGGER;
  if (/make the barcode box taller/i.test(o)) return 'make the barcode’s space taller in the design';
  if (/move the barcode box fully onto the label/i.test(o)) return 'move the barcode fully onto the label in the design';
  if (/move it in from the edge/i.test(o)) return 'move it in from the edge a little in the design';
  if (/^move it in the design/i.test(o)) return 'move it in the design so all of it sits on the label';
  if (/turn it sideways/i.test(o)) return 'turn it sideways in the design';
  return INCH.test(o) ? '' : o;
}

function sentence(s: string): string {
  const t = s.trim();
  if (!t) return '';
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? '' : '.'}`;
}

/**
 * The plain "Why?" for one check sentence. Keeps what it covers ("It also
 * prints over …") and drops every figure; empty when there's nothing to add.
 */
export function plainBarcodeWhy(item: string, measured: string, plain = ''): string {
  const text = item.trim().replace(/\s+/g, ' ');
  const reason = plainReason(text);
  if (!reason) return measured;
  const parts: string[] = [reason];
  // What it prints over, unless the plain sentence already named it.
  const over = text.match(/It also prints over ([^.,]+)/);
  if (over && !/\b(?:covers|overlaps|won’t either)\b/.test(plain)) parts.push(`It also prints over ${over[1]}.`);
  // The fix is the last sentence: "Make …, move … or turn …".
  const fixSentence = text.match(/(?:^|\.\s)((?:Make|Use|Move|Turn) [^]*?)\.?$/)?.[1] ?? '';
  if (fixSentence) {
    // Split "a, b or c" into its options; a picture copy's own comma stays with it.
    const options = fixSentence
      .replace(/, which draws thinner bars that fit/gi, '')
      .split(/,\s(?!or a QR code)|\sor\s(?=(?:make|use|move|turn)\b)/i)
      .map(plainFix)
      .filter(Boolean);
    const unique = [...new Set(options)];
    // The long-code fix reads as its own instruction ("Print it as a QR code, or use a bigger label.").
    if (unique.length === 1 && unique[0] === QR_OR_BIGGER) parts.push(sentence(QR_OR_BIGGER));
    else if (unique.length) {
      const list = unique.length > 1 ? unique.map((o) => (o === QR_OR_BIGGER ? 'print it as a QR code, use a bigger label' : o)) : unique;
      parts.push(sentence(list.length === 1 ? `To fix it, ${list[0]}` : `To fix it, ${list.slice(0, -1).join(', ')}, or ${list[list.length - 1]}`));
    }
  }
  return parts.join(' ');
}
