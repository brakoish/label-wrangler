/**
 * How wide Zebra Font 0 (^A0) text prints, for layout checks.
 *
 * The advances below were measured from the same ZPL renderer the print
 * preview uses (zpl-renderer-js): each printable ASCII character, ten times
 * in a row at ^A0N,100,100, between two H's. Printed width grows with the
 * ^A0 width parameter only (not the height), so a character's advance is
 * `ADVANCE[code - 32] * fontWidth / 100` dots.
 *
 * Preview and check only: nothing here changes the printed bytes.
 */

// Index = char code - 32. `^` and `~` are escaped by the generator; measured as 50.
const ADVANCE = [
  25, 33.3, 33.3, 50, 50, 83.3, 66.8, 25, 33.3, 33.3, 50, 50, 33.3, 80, 33.3, 27.8,
  50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 27.8, 27.8, 50, 50, 50, 50,
  83.3, 55.6, 55.6, 55.6, 61.1, 50, 50, 61.1, 61.1, 27.8, 44.5, 55.6, 50, 77.8, 61.1, 61.1,
  55.6, 61.1, 61.1, 55.6, 50, 61.1, 55.6, 83.3, 55.6, 55.6, 50, 33.3, 100, 33.3, 50, 50,
  33.3, 50, 50, 44.5, 50, 50, 27.8, 50, 50, 27.8, 27.8, 44.5, 27.8, 77.8, 50, 50,
  50, 50, 33.3, 44.5, 27.8, 50, 44.5, 66.8, 44.5, 44.5, 39, 27.5, 25, 27.5, 50,
];

/** Characters the generator turns into plain ones before printing. */
function printable(ch: string): string {
  if (/[‐‑‒–—−]/.test(ch)) return '-';
  if (ch === ' ') return ' ';
  return ch;
}

/** Printed width of one line in dots at ^A0 width `fontWidth`. */
export function font0Width(text: string, fontWidth: number): number {
  let total = 0;
  for (const raw of text) {
    const code = printable(raw).codePointAt(0) ?? 63;
    // Anything outside ASCII prints as two junk glyphs (UTF-8 bytes); count it wide.
    total += code >= 32 && code < 127 ? ADVANCE[code - 32] : 100;
  }
  return (total * fontWidth) / 100;
}

/**
 * Lines as a ^FB field block wraps them: whole words while they fit the
 * block width, a word wider than the block on its own line.
 */
export function font0Wrap(content: string, blockWidth: number, fontWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of content.split(/\r?\n|\\&/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (!current || font0Width(candidate, fontWidth) <= blockWidth) current = candidate;
      else { lines.push(current); current = word; }
    }
    lines.push(current);
  }
  return lines.length ? lines : [''];
}
