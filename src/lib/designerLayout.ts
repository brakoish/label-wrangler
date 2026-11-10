import type { BarcodeElement, LabelFormat, QRElement, TemplateElement, TextElement } from './types';
import { zplQrGeometry } from './zplGenerator';
import { layoutThermalText, wrapThermalText } from './thermalTextLayout';
import { elementTypeName, friendlyFieldName } from './fieldLabels';
import { font0Width, font0Wrap } from './zebraFont0';
import { barcodeFit, barcodeFitFix, barcodeFitProblem, nativeBarcodeDots, nativeBarcodeFootprint, NATIVE_MODULE_DOTS, type BarcodeFit } from './barcodeFit';

/**
 * Where each item really prints on a native thermal label, and the layout
 * problems that follow (items covering each other, items running off the
 * label). Preview-only: it reads the same rules zplGenerator uses (fixed
 * ^BY2 module width, Code 128 subset B, QR magnification) and changes nothing
 * that is printed.
 */

export interface Box { x: number; y: number; width: number; height: number }

/** zplGenerator emits ^BY2 after every barcode, so bars are always 2 dots per module. */
export const ZPL_MODULE_DOTS = NATIVE_MODULE_DOTS;

/**
 * Printed width in dots of a barcode as the printer draws it (modules x 2).
 * Code 128 is drawn in subset B without mode switching (^BC mode N), so every
 * character costs 11 modules: start 11 + data + check 11 + stop 13.
 */
export function printedBarcodeWidth(format: BarcodeElement['barcodeFormat'] | undefined, value: string): number {
  return nativeBarcodeDots(format, value);
}

function resolvedValue(el: TemplateElement, values?: Record<string, string>): string {
  if (el.isStatic) return 'content' in el ? el.content || '' : '';
  const value = (el.fieldName && values?.[el.fieldName]) || el.defaultValue || ('content' in el ? el.content : '') || '';
  return `${el.prefix || ''}${value}${el.suffix || ''}`;
}

function rotation(el: TemplateElement): 0 | 90 | 180 | 270 {
  const r = (((Math.round(el.rotation || 0) % 360) + 360) % 360);
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

/** Turn an unrotated box drawn from the item's top-left corner into the rotated footprint. */
function rotateAroundCenter(el: TemplateElement, box: Box): Box {
  const r = rotation(el);
  if (r === 0) return box;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const corners = [
    [box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height],
  ].map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    if (r === 90) return [cx - dy, cy + dx];
    if (r === 180) return [cx - dx, cy - dy];
    return [cx + dy, cy - dx];
  });
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** Footprint of the ink an item prints, in label dots. */
export function printedBounds(el: TemplateElement, format: LabelFormat, values?: Record<string, string>): Box | null {
  const dpi = format.dpi || 203;
  switch (el.type) {
    case 'barcode': {
      const value = resolvedValue(el, values);
      if (!value) return null;
      // Where the printer puts the bars for each rotation (shared with the barcode fit verdict).
      return nativeBarcodeFootprint(el as BarcodeElement, value);
    }
    case 'qr': {
      const value = resolvedValue(el, values) || 'QR';
      const { printedSize } = zplQrGeometry(value, (el as QRElement).errorCorrection || 'M', el.width);
      const x = el.x + Math.round((Math.round(el.width) - printedSize) / 2);
      const y = el.y + Math.round((Math.round(el.height) - printedSize) / 2);
      return { x, y, width: printedSize, height: printedSize };
    }
    case 'text': {
      const content = resolvedValue(el, values);
      if (!content) return null;
      const t = el as TextElement;
      // The same numbers zplGenerator.textToZPL sends: ^A0 height and width,
      // ^FB block width, line count and spacing.
      const autoFit = t.autoFit === true;
      const layout = autoFit ? layoutThermalText({ content, width: Math.round(t.width), height: t.height, fontSize: t.fontSize, dpi, lineHeight: t.lineHeight, charWidth: t.charWidth, autoFit: true, minFontSize: t.minFontSize }) : null;
      const fontH = layout?.fontHeight ?? Math.round(t.fontSize * (dpi / 72));
      const fontW = layout?.fontWidth ?? Math.max(1, Math.round(fontH * (t.charWidth ?? 0.5)));
      const maxLines = layout?.maxLines ?? Math.max(1, Math.floor(t.height / (fontH * (t.lineHeight || 1.2))));
      const lineSpacing = layout?.lineSpacing ?? Math.round(fontH * ((t.lineHeight || 1.2) - 1));
      const blockWidth = Math.round(t.width);
      const r = rotation(t);
      // Unrotated fields are wrapped by the printer (^FB); rotated ones are
      // broken into lines by the generator with its own character estimate.
      const lines = layout?.visibleLines
        ?? (r === 0 ? font0Wrap(content, blockWidth, fontW) : wrapThermalText(content, Math.max(1, Math.floor(blockWidth / Math.max(1, fontH * 0.48))))).slice(0, maxLines);
      const widths = lines.map((line) => Math.min(blockWidth, Math.round(font0Width(line, fontW))));
      const inkWidth = Math.max(1, ...widths);
      const offset = t.textAlign === 'center' ? Math.round((blockWidth - inkWidth) / 2) : t.textAlign === 'right' ? blockWidth - inkWidth : 0;
      // Font 0 capitals fill the top 3/4 of the ^A0 height; descenders reach about 0.93.
      const last = lines[lines.length - 1] ?? '';
      const glyphH = Math.round(fontH * (/[gjpqy,;()[\]{}|@$]/.test(last) ? 0.93 : 0.76));
      const box = { x: t.x + offset, y: t.y, width: inkWidth, height: Math.max(1, (lines.length - 1) * (fontH + lineSpacing) + glyphH) };
      if (r === 0) return box;
      // Text rotates around its field origin (top-left), as ZPL does.
      if (r === 90) return { x: t.x - box.height, y: t.y + offset, width: box.height, height: box.width };
      if (r === 180) return { x: t.x - offset - box.width, y: t.y - box.height, width: box.width, height: box.height };
      return { x: t.x, y: t.y - offset - box.width, width: box.height, height: box.width };
    }
    case 'image':
      return el.src ? rotateAroundCenter(el, { x: el.x, y: el.y, width: el.width, height: el.height }) : null;
    case 'line':
    case 'rectangle':
      return rotateAroundCenter(el, { x: el.x, y: el.y, width: Math.max(1, el.width), height: Math.max(1, el.height) });
    default:
      return null;
  }
}

function intersection(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export type LayoutProblemKind = 'overlap' | 'off-label' | 'wider-than-box' | 'characters' | 'barcode-tight';

export interface LayoutProblem {
  /** The main problem; `kinds` lists all of them for this item. */
  kind: LayoutProblemKind;
  kinds: LayoutProblemKind[];
  /** Element ids involved (the item first). */
  ids: string[];
  message: string;
  /** The layout change that fixes it, when there is a clear one. */
  fix?: string;
  /** For a barcode: the shared fit verdict (barcodeFit). 'blocked' can't print. */
  barcodeFit?: BarcodeFit;
  /** The printer can't produce this item as designed: printing must wait for a fix. */
  blocking?: boolean;
}

/** "the Package tag barcode", "the THC text", "the text “Net Wt 3.5g”", "the QR code". */
export function itemName(el: TemplateElement): string {
  const type = elementTypeName(el.type).toLowerCase().replace(/^qr code$/, 'QR code');
  if (!el.isStatic && el.fieldName) return `the ${friendlyFieldName(el.fieldName)} ${type}`;
  if (el.type === 'text' && el.isStatic && el.content?.trim()) {
    const text = el.content.trim();
    return `the text “${text.length > 18 ? `${text.slice(0, 17)}…` : text}”`;
  }
  return `the ${type}`;
}

function capitalise(text: string) { return text.charAt(0).toUpperCase() + text.slice(1); }

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Items whose overlap can make a label unreadable or unscannable. */
const CONTENT = new Set(['text', 'barcode', 'qr', 'image']);

/**
 * Layout problems on one label for native thermal designs, one line per
 * item: "The Package tag barcode is too wide: it runs off the label and
 * prints over the QR code — it may not scan." Overlaps are only reported when
 * a barcode, QR code or picture is involved, or two texts really print on
 * top of each other; frames and lines around text are fine.
 *
 * `measured` replaces the computed footprint for items whose printed ink was
 * measured from the print renderer (the designer canvas does this).
 */
export function layoutProblems(elements: ReadonlyArray<TemplateElement>, format: LabelFormat, values?: Record<string, string>, measured?: Readonly<Record<string, Box | undefined>>): LayoutProblem[] {
  if (format.type !== 'thermal') return [];
  const dpi = format.dpi || 203;
  const labelW = Math.round(format.width * dpi);
  const labelH = Math.round(format.height * dpi);
  const placed = elements
    .filter((el) => CONTENT.has(el.type))
    .map((el) => ({ el, box: measured?.[el.id] ?? printedBounds(el, format, values) }))
    .filter((item): item is { el: TemplateElement; box: Box } => !!item.box);

  // Barcodes get the shared verdict (barcodeFit): it knows how long the bars
  // really print and whether that is cut off or lands on the next label. A
  // measured footprint is clipped at the label edge, so it can't say that.
  const fits = new Map<string, BarcodeFit>();
  for (const { el } of placed) {
    if (el.type === 'barcode') fits.set(el.id, barcodeFit(el, resolvedValue(el, values), format, false));
  }

  // A Code 128 is as wide as its value needs, whatever its box says. That
  // only matters when the extra width lands on something or off the label,
  // so it is named inside those problems rather than on its own.
  const wider = new Set(placed.filter(({ el, box }) => el.type === 'barcode' && rotation(el) % 180 === 0 && box.width > el.width + 2).map(({ el }) => el.id));
  const scannable = (el: TemplateElement) => el.type === 'barcode' || el.type === 'qr';

  type Entry = { el: TemplateElement; offLabel: boolean; over: TemplateElement[] };
  const byItem = new Map<string, Entry>();
  const entry = (el: TemplateElement) => {
    const found = byItem.get(el.id) ?? { el, offLabel: false, over: [] };
    byItem.set(el.id, found);
    return found;
  };

  const tolerance = 2;
  for (const { el, box } of placed) {
    const fit = fits.get(el.id);
    if (fit) {
      if (fit.level !== 'ok' && fit.reason !== 'characters') entry(el);
      continue;
    }
    if (box.x < -tolerance || box.y < -tolerance || box.x + box.width > labelW + tolerance || box.y + box.height > labelH + tolerance) entry(el).offLabel = true;
  }

  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      const area = intersection(a.box, b.box);
      if (area <= 0) continue;
      const smaller = Math.min(a.box.width * a.box.height, b.box.width * b.box.height);
      const scan = scannable(a.el) || scannable(b.el);
      // Ignore slivers: a couple of dots of touching boxes prints fine.
      if (area < Math.max(16, smaller * (scan ? 0.01 : 0.15))) continue;
      // The too-wide barcode is the one to fix; otherwise the item drawn on top.
      const [main, other] = wider.has(a.el.id) && !wider.has(b.el.id) ? [a.el, b.el]
        : wider.has(b.el.id) && !wider.has(a.el.id) ? [b.el, a.el]
          : a.el.zIndex >= b.el.zIndex ? [a.el, b.el] : [b.el, a.el];
      entry(main).over.push(other);
    }
  }

  // A barcode printing over another code ruins that one too: say so by name.
  const coveredCodes = (over: TemplateElement[]) => {
    const codes = over.filter((o) => o.type === 'qr' || o.type === 'barcode');
    return codes.length ? `, so ${codes.length === 1 && over.length === 1 ? 'that' : listNames(codes.map(itemName))} won’t scan either` : '';
  };
  const problems: LayoutProblem[] = [];
  for (const { el, offLabel, over } of byItem.values()) {
    const fit = fits.get(el.id);
    const overText = over.length ? `${el.type === 'text' && over.every((o) => o.type === 'text') ? 'covers' : 'prints over'} ${listNames(over.map(itemName))}` : '';
    if (fit && fit.level !== 'ok' && fit.reason !== 'characters') {
      const value = resolvedValue(el, values);
      const blocking = fit.level === 'blocked';
      const kinds: LayoutProblemKind[] = [blocking ? 'off-label' as const : 'barcode-tight' as const, ...(over.length ? ['overlap' as const] : []), ...(wider.has(el.id) ? ['wider-than-box' as const] : [])];
      problems.push({
        kind: kinds[0],
        kinds,
        ids: [el.id, ...over.map((o) => o.id)],
        message: `${capitalise(itemName(el))} ${barcodeFitProblem(fit, value)}${overText ? `, and ${overText}` : ''}${coveredCodes(over)}.`,
        fix: barcodeFitFix(fit) || undefined,
        barcodeFit: fit,
        blocking,
      });
      continue;
    }
    const parts: string[] = [];
    if (offLabel) parts.push('runs off the edge of the label and will be cut off');
    if (overText) parts.push(overText);
    if (!parts.length) continue;
    const tooWide = wider.has(el.id);
    const mayNotScan = over.length > 0 && (scannable(el) || over.some(scannable));
    const kinds: LayoutProblemKind[] = [...(offLabel ? ['off-label' as const] : []), ...(over.length ? ['overlap' as const] : []), ...(tooWide ? ['wider-than-box' as const] : [])];
    problems.push({
      kind: kinds[0],
      kinds,
      ids: [el.id, ...over.map((o) => o.id)],
      message: `${capitalise(itemName(el))} ${tooWide ? 'prints wider than its box and ' : ''}${parts.join(' and ')}${mayNotScan ? ' — it may not scan' : ''}.`,
      ...(fit ? { barcodeFit: fit } : {}),
    });
  }
  return problems;
}

/** Ids with any problem, for outlining them in red on the canvas. */
export function problemIds(problems: ReadonlyArray<LayoutProblem>): Set<string> {
  return new Set(problems.flatMap((problem) => problem.ids));
}

/**
 * A free spot for a new item of `size`: the first place, scanning top to
 * bottom and left to right in small steps, where it doesn't touch anything
 * already on the label. Falls back to below the lowest item, then to the
 * top-left corner (and reports that it overlaps).
 */
export function freeSpot(
  existing: ReadonlyArray<Box>,
  size: { width: number; height: number },
  label: { width: number; height: number },
  margin: number,
): { x: number; y: number; fits: boolean } {
  const round = (v: number) => Math.round(v * 100) / 100;
  const step = Math.max(margin, Math.min(label.width, label.height) / 40);
  const pad = margin / 2;
  const hits = (x: number, y: number) => existing.some((b) => x < b.x + b.width + pad && x + size.width + pad > b.x && y < b.y + b.height + pad && y + size.height + pad > b.y);
  const maxX = label.width - margin - size.width;
  const maxY = label.height - margin - size.height;
  for (let y = margin; y <= maxY + 1e-9; y += step) {
    for (let x = margin; x <= maxX + 1e-9; x += step) {
      if (!hits(x, y)) return { x: round(x), y: round(y), fits: true };
    }
  }
  return { x: round(margin), y: round(margin), fits: false };
}

/**
 * Render warnings in plain words for the designer. friendlyRenderError
 * handles "Lane 1, <id>: …"; the bitmap proof also says "Lane 1: …" with no
 * item named, and "Lane" means nothing to a person.
 */
export function plainRenderWarning(message: string, friendly: (message: string) => string): string {
  return friendly(message)
    .replace(/Lane \d+:\s*Image is missing/gi, 'A picture box has no picture yet. Choose a file or delete the box.')
    .replace(/Lane \d+:\s*/g, '')
    .trim();
}
