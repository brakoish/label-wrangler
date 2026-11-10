import QRCode from 'qrcode';
import type { LabelFormat, TemplateElement } from './types';
import type { Box, LayoutProblem } from './designerLayout';
import { itemName } from './designerLayout';
import { barcodeFit, barcodeFitFix, barcodeFitProblem } from './barcodeFit';

/**
 * Where each item lands on an exact-picture (bitmap) label, as the exact
 * renderer (thermal/render.server) draws it: a barcode paints its whole box
 * (white behind the bars), a QR code paints a square of its modules plus a
 * four-module clear margin centred in its box, text and pictures fill their
 * box. Read-only: used for the designer's notice and "Fix it for me"; it
 * changes nothing that is printed.
 */

type Values = Record<string, string>;

export function resolvedValue(el: TemplateElement, values?: Values): string {
  if (el.isStatic) return 'content' in el ? el.content || '' : '';
  const value = (el.fieldName && values?.[el.fieldName]) || el.defaultValue || ('content' in el ? el.content : '') || '';
  return `${el.prefix || ''}${value}${el.suffix || ''}`;
}

function rotationOf(el: Pick<TemplateElement, 'rotation'>): 0 | 90 | 180 | 270 {
  const r = (((Math.round(el.rotation || 0) % 360) + 360) % 360);
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

/** Modules a side of the QR code the exact renderer draws (the qrcode library), or 0 when it can't encode it. */
export function bitmapQrModules(value: string, ec: 'L' | 'M' | 'Q' | 'H' = 'M'): number {
  try { return QRCode.create(value || 'QR', { errorCorrectionLevel: ec }).modules.size; } catch { return 0; }
}

/** The square a bitmap QR code paints in a w × h box: (modules + 8) × scale, centred. */
export function bitmapQrSide(value: string, ec: 'L' | 'M' | 'Q' | 'H', width: number, height: number): { side: number; scale: number; modules: number } {
  const modules = bitmapQrModules(value, ec);
  if (!modules) return { side: 0, scale: 0, modules: 0 };
  const scale = Math.floor(Math.min(Math.round(width), Math.round(height)) / (modules + 8));
  return { side: Math.max(0, scale) * (modules + 8), scale: Math.max(0, scale), modules };
}

/** The ink box of one item on an exact-picture label, in dots. Null when it draws nothing. */
export function bitmapFootprint(el: TemplateElement, values?: Values): Box | null {
  const x = Math.round(el.x), y = Math.round(el.y), w = Math.round(el.width), h = Math.round(el.height);
  const r = rotationOf(el);
  if (el.type === 'text') {
    if (!resolvedValue(el, values).trim()) return null;
    // Text turns around its top-left corner, as the renderer places it.
    if (r === 90) return { x: x - h, y, width: h, height: w };
    if (r === 180) return { x: x - w, y: y - h, width: w, height: h };
    if (r === 270) return { x, y: y - w, width: h, height: w };
    return { x, y, width: w, height: h };
  }
  if ((el.type === 'barcode' || el.type === 'qr') && !resolvedValue(el, values).trim()) return null;
  if (el.type === 'image' && !el.src) return null;
  if (el.type === 'qr') {
    // A square centred in its box, whichever way it is turned.
    const { side } = bitmapQrSide(resolvedValue(el, values), el.errorCorrection || 'M', w, h);
    if (!side) return null;
    return { x: x + Math.floor((w - side) / 2), y: y + Math.floor((h - side) / 2), width: side, height: side };
  }
  // Other items turn around their centre.
  if (r === 90 || r === 270) return { x: x + Math.round((w - h) / 2), y: y + Math.round((h - w) / 2), width: h, height: w };
  return { x, y, width: w, height: h };
}

/** Items whose ink matters when something lands on them. Lines and frames don't. */
const CONTENT = new Set(['text', 'barcode', 'qr', 'image']);
const CODES = new Set(['barcode', 'qr']);

export function boxesOverlap(a: Box, b: Box, slack = 2): boolean {
  return a.x + slack < b.x + b.width && b.x + slack < a.x + a.width && a.y + slack < b.y + b.height && b.y + slack < a.y + a.height;
}

function insideLabel(box: Box, labelW: number, labelH: number): boolean {
  return box.x >= 0 && box.y >= 0 && box.x + box.width <= labelW && box.y + box.height <= labelH;
}

/** The label edge a box runs off first ("right"), or null. */
export function edgeCrossed(box: Box, labelW: number, labelH: number): 'left' | 'right' | 'top' | 'bottom' | null {
  const over = { left: -box.x, top: -box.y, right: box.x + box.width - labelW, bottom: box.y + box.height - labelH };
  const worst = (Object.entries(over) as Array<[keyof typeof over, number]>).sort((a, b) => b[1] - a[1])[0];
  return worst && worst[1] > 0 ? worst[0] : null;
}

function capitalise(text: string): string { return text.charAt(0).toUpperCase() + text.slice(1); }

function listNames(names: string[]): string {
  return names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The exact-picture label's problems the designer names in plain words: a
 * barcode the renderer refuses (with the shared verdict, so "Why?" has the
 * measurements), a QR code that runs off the edge, and a barcode or QR code
 * that lands on another item (or has one on top of it), which may not scan.
 */
export function bitmapLayoutProblems(elements: ReadonlyArray<TemplateElement>, format: LabelFormat, values?: Values): LayoutProblem[] {
  if (format.type !== 'thermal') return [];
  const dpi = format.dpi || 203;
  const labelW = Math.round(format.width * dpi), labelH = Math.round(format.height * dpi);
  const placed = elements.filter((el) => CONTENT.has(el.type)).map((el) => ({ el, box: bitmapFootprint(el, values) })).filter((p): p is { el: TemplateElement; box: Box } => !!p.box);
  const problems: LayoutProblem[] = [];
  for (const { el, box } of placed) {
    if (!CODES.has(el.type)) continue;
    const over = placed.filter((other) => other.el.id !== el.id && boxesOverlap(box, other.box)).map((other) => other.el);
    const overText = over.length ? `${over.some((o) => o.zIndex > el.zIndex) ? 'is under' : 'prints over'} ${listNames(over.map(itemName))}` : '';
    const lost = over.filter((o) => CODES.has(o.type));
    const lostText = lost.length ? `, so ${lost.length === 1 && over.length === 1 ? 'that' : listNames(lost.map(itemName))} won’t scan either` : '';
    if (el.type === 'barcode') {
      const value = resolvedValue(el, values);
      const fit = barcodeFit(el, value, format, true);
      if (fit.level === 'blocked' && fit.reason !== 'characters') {
        problems.push({
          kind: 'off-label', kinds: ['off-label', ...(over.length ? ['overlap' as const] : [])], ids: [el.id, ...over.map((o) => o.id)],
          message: `${capitalise(itemName(el))} ${barcodeFitProblem(fit, value)}${overText ? `, and ${overText}` : ''}${lostText}.`,
          fix: barcodeFitFix(fit, 'designer') || undefined, barcodeFit: fit, blocking: true,
        });
        continue;
      }
    } else if (!insideLabel(box, labelW, labelH)) {
      const edge = edgeCrossed(box, labelW, labelH);
      problems.push({
        kind: 'off-label', kinds: ['off-label', ...(over.length ? ['overlap' as const] : [])], ids: [el.id, ...over.map((o) => o.id)],
        message: `${capitalise(itemName(el))} runs off the ${edge ?? ''} edge of the label, so it won’t scan${overText ? `, and ${overText}` : ''}${lostText}.`.replace('the  edge', 'the edge'),
        blocking: true,
      });
      continue;
    }
    if (!over.length) continue;
    // One line per pair of codes: the one drawn on top names it.
    if (over.every((o) => CODES.has(o.type) && problems.some((p) => p.ids[0] === o.id))) continue;
    problems.push({
      kind: 'overlap', kinds: ['overlap'], ids: [el.id, ...over.map((o) => o.id)],
      message: `${capitalise(itemName(el))} ${overText} — it may not scan${lostText}.`,
    });
  }
  return problems;
}

/**
 * Text drawn on top of other text on an exact-picture label (the designer
 * only; the run checks don't use it). The boxes are what the picture fills,
 * so a real overlap (at least 15% of the smaller box, as the printer-font
 * check uses) is named once, by the text drawn on top. A warning, never a
 * stop: the label still prints exactly as shown.
 */
export function bitmapTextOverlaps(elements: ReadonlyArray<TemplateElement>, format: LabelFormat, values?: Values): LayoutProblem[] {
  if (format.type !== 'thermal') return [];
  const texts = elements.filter((el) => el.type === 'text').map((el): { el: TemplateElement; box: Box | null } => ({ el, box: bitmapFootprint(el, values) })).filter((p): p is { el: TemplateElement; box: Box } => !!p.box);
  const over = new Map<string, { el: TemplateElement; under: TemplateElement[] }>();
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      const w = Math.min(a.box.x + a.box.width, b.box.x + b.box.width) - Math.max(a.box.x, b.box.x);
      const h = Math.min(a.box.y + a.box.height, b.box.y + b.box.height) - Math.max(a.box.y, b.box.y);
      if (w <= 0 || h <= 0) continue;
      const smaller = Math.min(a.box.width * a.box.height, b.box.width * b.box.height);
      if (w * h < Math.max(16, smaller * 0.15)) continue;
      const [top, under] = a.el.zIndex >= b.el.zIndex ? [a.el, b.el] : [b.el, a.el];
      const entry = over.get(top.id) ?? { el: top, under: [] };
      entry.under.push(under);
      over.set(top.id, entry);
    }
  }
  return Array.from(over.values()).map(({ el, under }) => ({
    kind: 'overlap' as const, kinds: ['overlap' as const], ids: [el.id, ...under.map((o) => o.id)],
    message: `${capitalise(itemName(el))} covers ${listNames(under.map(itemName))}, so the words run together.`,
  }));
}
