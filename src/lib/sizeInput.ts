/**
 * Reading what a person types into a size box. Number inputs drop what they
 * don't understand, so "1 1/2" became 112, "1,5" became 15 and "abc" became
 * 0; these boxes are plain text and read the value here instead.
 *
 * Accepted: "1.5", "1,5" (comma decimal), ".5", "1 1/2", "1-1/2", "3/4",
 * with or without a unit: "1.5in", "1.5 in", '1.5"', "1.5 inches". Anything
 * else is refused, with a plain reason.
 */

export type SizeParse = { ok: true; value: number } | { ok: false; reason: 'empty' | 'not-a-number' };

const UNIT = /\s*(?:in(?:ch(?:es)?)?\.?|"|”|″|pt|points?)\s*$/i;

export function parseSizeInput(raw: string): SizeParse {
  let text = String(raw ?? '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  text = text.replace(UNIT, '').trim();
  const negative = /^[-−]/.test(text);
  if (negative) text = text.slice(1).trim();
  let value: number | null = null;
  // Whole number and a fraction: "1 1/2", "1-1/2".
  const mixed = /^(\d+)(?:\s+|\s*-\s*)(\d+)\s*\/\s*(\d+)$/.exec(text);
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (mixed) {
    const den = Number(mixed[3]);
    if (den > 0) value = Number(mixed[1]) + Number(mixed[2]) / den;
  } else if (fraction) {
    const den = Number(fraction[2]);
    if (den > 0) value = Number(fraction[1]) / den;
  } else if (/^\d*[.,]\d+$|^\d+[.,]?$/.test(text)) {
    // One decimal mark, either a point or a comma ("1,5"). A thousands
    // separator makes no sense for a label size, so "1,500" is 1.5 too.
    value = Number(text.replace(',', '.'));
  }
  if (value === null || !Number.isFinite(value)) return { ok: false, reason: 'not-a-number' };
  return { ok: true, value: negative ? -value : value };
}

/** "2", "1.5", "0.05": a size as people write it. */
export function formatSize(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/**
 * One plain sentence for a size that can't be used, naming the item and the
 * box: "Barcode 1’s width must be between 0.01" and 2"." / "“abc” isn’t a
 * size. Type a number like 1.5 or 1 1/2."
 */
export function sizeProblem(raw: string, parsed: SizeParse, range: { min?: number; max?: number; unit?: string; what?: string }): string | null {
  const unit = range.unit ?? '';
  const what = range.what ?? 'This';
  if (!parsed.ok) {
    return parsed.reason === 'empty'
      ? `${what} can’t be empty. Type a number like 1.5.`
      : `“${raw.trim()}” isn’t a size. Type a number like 1.5 or 1 1/2.`;
  }
  const { min, max } = range;
  const tooSmall = min !== undefined && parsed.value < min - 1e-9;
  const tooBig = max !== undefined && parsed.value > max + 1e-9;
  if (!tooSmall && !tooBig) return null;
  if (min !== undefined && max !== undefined) return `${what} must be between ${formatSize(min)}${unit} and ${formatSize(max)}${unit}.`;
  if (tooSmall) return `${what} must be at least ${formatSize(min!)}${unit}.`;
  return `${what} must be at most ${formatSize(max!)}${unit}.`;
}
