import type { BarcodeElement, LabelFormat, QRElement, TemplateElement, TextElement } from './types';
import { zplQrGeometry } from './zplGenerator';
import { layoutThermalText, wrapThermalText } from './thermalTextLayout';
import { elementTypeName, friendlyFieldName } from './fieldLabels';

/**
 * Where each item really prints on a native thermal label, and the layout
 * problems that follow (items covering each other, items running off the
 * label). Preview-only: it reads the same rules zplGenerator uses (fixed
 * ^BY2 module width, Code 128 subset B, QR magnification) and changes nothing
 * that is printed.
 */

export interface Box { x: number; y: number; width: number; height: number }

/** zplGenerator emits ^BY2 after every barcode, so bars are always 2 dots per module. */
export const ZPL_MODULE_DOTS = 2;
/** Height of the human-readable line Zebra prints under a ^BY2 barcode. */
const INTERPRETATION_DOTS = 20;

/**
 * Printed width in dots of a barcode as the printer draws it (modules x 2).
 * Code 128 is drawn in subset B without mode switching (^BC mode N), so every
 * character costs 11 modules: start 11 + data + check 11 + stop 13.
 */
export function printedBarcodeWidth(format: BarcodeElement['barcodeFormat'] | undefined, value: string): number {
  const n = Array.from(value).length;
  let modules: number;
  switch (format ?? 'CODE128') {
    case 'CODE39': modules = (n + 2) * 16 - 1; break; // ratio 3:1 => 16 modules a character, gap included
    case 'UPC': modules = 95; break;
    case 'EAN13': modules = 95; break;
    case 'EAN8': modules = 67; break;
    case 'ITF14': modules = n * 14 + 20; break; // Industrial 2 of 5 at 3:1, approximate
    case 'CODE128':
    default: modules = 11 * n + 35;
  }
  return modules * ZPL_MODULE_DOTS;
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
      const width = printedBarcodeWidth(el.barcodeFormat, value);
      const height = Math.max(el.height, Math.round(el.height * 0.75) + (el.showText ? INTERPRETATION_DOTS : 0));
      return rotateAroundCenter(el, { x: el.x, y: el.y, width, height });
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
      const layout = layoutThermalText({ content, width: t.width, height: t.height, fontSize: t.fontSize, dpi, lineHeight: t.lineHeight, charWidth: t.charWidth, autoFit: t.autoFit === true, minFontSize: t.minFontSize });
      const fontH = layout.fontHeight;
      const lines = t.autoFit === true ? layout.visibleLines : wrapThermalText(content, Math.max(1, Math.floor(t.width / Math.max(1, fontH * 0.48)))).slice(0, layout.maxLines);
      const longest = Math.max(1, ...lines.map((line) => line.length));
      const inkWidth = Math.min(t.width, Math.round(longest * fontH * 0.48));
      const offset = t.textAlign === 'center' ? (t.width - inkWidth) / 2 : t.textAlign === 'right' ? t.width - inkWidth : 0;
      const box = { x: t.x + offset, y: t.y, width: inkWidth, height: Math.max(fontH, lines.length * layout.lineAdvance - layout.lineSpacing) };
      const r = rotation(t);
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

export type LayoutProblemKind = 'overlap' | 'off-label' | 'wider-than-box';

export interface LayoutProblem {
  kind: LayoutProblemKind;
  /** Element ids involved (the item first). */
  ids: string[];
  message: string;
}

/** "the barcode Package tag", "the text Product name", "the QR code". */
export function itemName(el: TemplateElement): string {
  const type = elementTypeName(el.type).toLowerCase().replace(/^qr code$/, 'QR code');
  if (!el.isStatic && el.fieldName) return `the ${type} ${friendlyFieldName(el.fieldName)}`;
  if (el.type === 'text' && el.isStatic && el.content?.trim()) {
    const text = el.content.trim();
    return `the text “${text.length > 18 ? `${text.slice(0, 17)}…` : text}”`;
  }
  return `the ${type}`;
}

function capitalise(text: string) { return text.charAt(0).toUpperCase() + text.slice(1); }

/** Items whose overlap can make a label unreadable or unscannable. */
const CONTENT = new Set(['text', 'barcode', 'qr', 'image']);

/**
 * Layout problems on one label for native thermal designs. Overlaps are only
 * reported when a barcode, QR code or picture is involved, or two texts
 * really print on top of each other; frames and lines around text are fine.
 */
export function layoutProblems(elements: ReadonlyArray<TemplateElement>, format: LabelFormat, values?: Record<string, string>): LayoutProblem[] {
  if (format.type !== 'thermal') return [];
  const dpi = format.dpi || 203;
  const labelW = Math.round(format.width * dpi);
  const labelH = Math.round(format.height * dpi);
  const problems: LayoutProblem[] = [];
  const placed = elements
    .filter((el) => CONTENT.has(el.type))
    .map((el) => ({ el, box: printedBounds(el, format, values) }))
    .filter((item): item is { el: TemplateElement; box: Box } => !!item.box);

  // A Code 128 is as wide as its value needs, whatever its box says. That
  // only matters when the extra width lands on something or off the label,
  // so it is named inside those problems rather than on its own.
  const wider = new Set(placed.filter(({ el, box }) => el.type === 'barcode' && rotation(el) % 180 === 0 && box.width > el.width + 2).map(({ el }) => el.id));
  const widerNote = (el: TemplateElement) => (wider.has(el.id) ? ' is wider than its box and' : '');

  for (const { el, box } of placed) {
    const tolerance = 2;
    if (box.x < -tolerance || box.y < -tolerance || box.x + box.width > labelW + tolerance || box.y + box.height > labelH + tolerance) {
      problems.push({ kind: 'off-label', ids: [el.id], message: `${capitalise(itemName(el))}${widerNote(el)} runs off the edge of the label${wider.has(el.id) ? '' : ' and will be cut off'}.` });
    }
  }

  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      const area = intersection(a.box, b.box);
      if (area <= 0) continue;
      const smaller = Math.min(a.box.width * a.box.height, b.box.width * b.box.height);
      const scannable = a.el.type === 'barcode' || a.el.type === 'qr' || b.el.type === 'barcode' || b.el.type === 'qr';
      // Ignore slivers: a couple of dots of touching boxes prints fine.
      if (area < Math.max(16, smaller * (scannable ? 0.01 : 0.15))) continue;
      // Name the item drawn on top first.
      const [top, under] = a.el.zIndex >= b.el.zIndex ? [a.el, b.el] : [b.el, a.el];
      const scan = top.type === 'barcode' || top.type === 'qr' || under.type === 'barcode' || under.type === 'qr';
      const wide = wider.has(top.id) ? top : wider.has(under.id) ? under : null;
      problems.push({
        kind: 'overlap',
        ids: [top.id, under.id],
        message: wide
          ? `${capitalise(itemName(wide))}${widerNote(wide)} prints over ${itemName(wide === top ? under : top)} — it may not scan.`
          : `${capitalise(itemName(top))} covers ${itemName(under)}${scan ? ' — it may not scan' : ''}.`,
      });
    }
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
