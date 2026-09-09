export interface ThermalTextLayoutOptions {
  content: string;
  width: number;
  height: number;
  fontSize: number;
  dpi: number;
  lineHeight?: number;
  charWidth?: number;
  autoFit?: boolean;
  minFontSize?: number;
}

export interface ThermalTextLayout {
  fontHeight: number;
  fontWidth: number;
  lineAdvance: number;
  lineSpacing: number;
  maxLines: number;
  lines: string[];
  visibleLines: string[];
  overflow: boolean;
}

const DEFAULT_LINE_HEIGHT = 1.2;
const DEFAULT_CHAR_WIDTH = 0.5;
const DEFAULT_MIN_FONT_SIZE = 4;

/**
 * Compute the line breaks and effective ZPL font dimensions for a thermal
 * text field. The designer and ZPL generator both use this function so an
 * editable text box shows the same wrapping as the printer output.
 */
export function layoutThermalText(options: ThermalTextLayoutOptions): ThermalTextLayout {
  const maxFontHeight = Math.max(1, Math.round(options.fontSize * (options.dpi / 72)));
  const requestedMinHeight = Math.max(1, Math.round((options.minFontSize ?? DEFAULT_MIN_FONT_SIZE) * (options.dpi / 72)));
  const minFontHeight = options.autoFit ? Math.min(maxFontHeight, requestedMinHeight) : maxFontHeight;
  const lineHeight = Math.max(0.1, options.lineHeight || DEFAULT_LINE_HEIGHT);
  const widthRatio = Math.max(0.05, options.charWidth ?? DEFAULT_CHAR_WIDTH);

  let chosen = buildLayout(maxFontHeight);
  if (options.autoFit && chosen.overflow) {
    for (let fontHeight = maxFontHeight - 1; fontHeight >= minFontHeight; fontHeight -= 1) {
      chosen = buildLayout(fontHeight);
      if (!chosen.overflow) break;
    }
  }

  return chosen;

  function buildLayout(fontHeight: number): ThermalTextLayout {
    // Zebra Font 0 is proportional. Its established wrapping metric is an
    // average advance of about 0.48 of font height. Keep that independent of
    // the requested ^A0 glyph width: legacy templates often use charWidth 0.8,
    // but Zebra still fit their proportional text using this average. Treating
    // charWidth as the advance regressed those one-line fields by wrapping far
    // too early (for example, a full product name became only "The Drop -").
    const averageCharAdvance = Math.max(1, fontHeight * 0.48);
    const maxChars = Math.max(1, Math.floor(options.width / averageCharAdvance));
    const lines = wrapThermalText(options.content, maxChars);
    const lineAdvance = Math.max(1, Math.round(fontHeight * lineHeight));
    const maxLines = Math.max(1, Math.floor(options.height / lineAdvance));

    return {
      fontHeight,
      fontWidth: Math.max(1, Math.round(fontHeight * widthRatio)),
      lineAdvance,
      lineSpacing: lineAdvance - fontHeight,
      maxLines,
      lines,
      visibleLines: lines.slice(0, maxLines),
      overflow: lines.length > maxLines,
    };
  }
}

/** Word-wrap text while honoring manual newlines and breaking long tokens. */
export function wrapThermalText(content: string, maxChars: number): string[] {
  const limit = Math.max(1, Math.floor(maxChars));
  const lines: string[] = [];

  for (const paragraph of content.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let current = '';
    for (const originalWord of words) {
      let word = originalWord;

      while (word.length > limit) {
        if (current) {
          lines.push(current);
          current = '';
        }
        lines.push(word.slice(0, limit));
        word = word.slice(limit);
      }

      if (!word) continue;
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= limit) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }

    if (current) lines.push(current);
  }

  return lines.length > 0 ? lines : [''];
}
