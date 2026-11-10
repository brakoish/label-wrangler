import type { BarcodeElement, LabelFormat, QRElement, TemplateElement } from './types';
import { barcodeFit, nativeBarcodeFootprint } from './barcodeFit';
import { layoutProblems } from './designerLayout';
import { zplQrGeometry } from './zplGenerator';

/**
 * "Fix it for me" for a barcode that won't print whole: a change to THIS
 * design's layout only (move it so the bars fit, turn it sideways, or use a
 * QR code in the same spot), offered only when the shared checks say the
 * result prints whole and lands on nothing else. Nothing here is sent to a
 * printer, and other designs and their runs are untouched; the designer
 * applies it as one edit, so Undo takes it back.
 */
export interface BarcodeAutoFix {
  kind: 'move' | 'turn' | 'qr';
  /** The button's words. */
  label: string;
  /** What changed, said after the fix ("Moved the barcode so its bars fit"). */
  done: string;
  /** The design's items with the fix applied. */
  elements: TemplateElement[];
}

type Values = Record<string, string>;

function printedValue(el: TemplateElement, values: Values): string {
  if (el.isStatic) return 'content' in el ? el.content || '' : '';
  const value = (el.fieldName && values[el.fieldName]) || el.defaultValue || '';
  return `${el.prefix || ''}${value}${el.suffix || ''}`;
}

/** True when the item prints whole, inside the label, over nothing. */
function clean(elements: TemplateElement[], id: string, format: LabelFormat, values: Values): boolean {
  const el = elements.find((e) => e.id === id);
  if (!el) return false;
  if (el.type === 'barcode' && barcodeFit(el, printedValue(el, values), format, false).level === 'blocked') return false;
  return !layoutProblems(elements, format, values).some((p) => p.ids.includes(id) && (p.blocking || p.kinds.some((k) => k === 'overlap' || k === 'off-label')));
}

function replace(elements: ReadonlyArray<TemplateElement>, id: string, next: TemplateElement): TemplateElement[] {
  return elements.map((e) => (e.id === id ? next : e));
}

/** Shift a native barcode so its printed bars start at `start` dots along its length. */
function placeBars(el: BarcodeElement, value: string, start: number): BarcodeElement {
  const box = nativeBarcodeFootprint(el, value);
  const sideways = el.rotation === 90 || el.rotation === 270;
  return sideways ? { ...el, y: Math.round(el.y + start - box.y) } : { ...el, x: Math.round(el.x + start - box.x) };
}

export function barcodeAutoFix(elements: ReadonlyArray<TemplateElement>, id: string, format: LabelFormat | null | undefined, values: Values, bitmap: boolean): BarcodeAutoFix | null {
  if (!format || format.type !== 'thermal' || bitmap) return null;
  const el = elements.find((e) => e.id === id);
  if (!el || el.type !== 'barcode' || el.locked) return null;
  const value = printedValue(el, values);
  const fit = barcodeFit(el, value, format, false);
  if (fit.level !== 'blocked' || fit.reason === 'characters') return null;
  const dpi = format.dpi || 203;
  const labelW = Math.round(format.width * dpi);
  const labelH = Math.round(format.height * dpi);
  const margin = Math.round(dpi * 0.05);

  // 1. Move it along its length so the bars fit (centred, then each edge).
  if (fit.barsDots + 2 * margin <= fit.labelDots) {
    for (const start of [Math.round((fit.labelDots - fit.barsDots) / 2), margin, fit.labelDots - margin - fit.barsDots]) {
      const moved = placeBars(el, value, start);
      const next = replace(elements, id, moved);
      if (clean(next, id, format, values)) return { kind: 'move', label: 'Fix it for me', done: 'Moved the barcode so its bars fit on the label.', elements: next };
    }
  }

  // 2. Turn it sideways when the label is long enough the other way.
  const otherDots = fit.labelDots === labelW ? labelH : labelW;
  if (fit.barsDots + 2 * margin <= otherDots) {
    for (const rotation of [90, 270] as const) {
      const turned: BarcodeElement = { ...el, rotation };
      const box = nativeBarcodeFootprint(turned, value);
      for (const across of [labelW - margin - box.width, margin]) {
        const shifted: BarcodeElement = { ...turned, x: Math.round(turned.x + across - box.x) };
        const placed = placeBars(shifted, value, Math.round((labelH - fit.barsDots) / 2));
        const next = replace(elements, id, placed);
        if (clean(next, id, format, values)) return { kind: 'turn', label: 'Fix it for me', done: 'Turned the barcode sideways so its bars fit.', elements: next };
      }
    }
  }
  return null;
}

/**
 * "Use a QR code instead": the same value as a QR code, as big as fits where
 * the barcode was without landing on anything, with modules big enough to
 * scan (at least 0.24 mm). Null when there is no such spot.
 */
export function barcodeToQr(elements: ReadonlyArray<TemplateElement>, id: string, format: LabelFormat | null | undefined, values: Values, bitmap: boolean): BarcodeAutoFix | null {
  if (!format || format.type !== 'thermal' || bitmap) return null;
  const el = elements.find((e) => e.id === id);
  if (!el || el.type !== 'barcode' || el.locked) return null;
  const value = printedValue(el, values) || 'QR';
  const dpi = format.dpi || 203;
  const labelW = Math.round(format.width * dpi);
  const labelH = Math.round(format.height * dpi);
  const margin = Math.round(dpi * 0.03);
  const modules = zplQrGeometry(value, 'M', 1000).modules;
  const minMag = Math.max(2, Math.ceil((0.24 / 25.4) * dpi));
  const biggest = Math.min(10, Math.floor((Math.min(labelW, labelH) - 2 * margin) / modules));
  const box = nativeBarcodeFootprint(el, printedValue(el, values));
  for (let mag = biggest; mag >= minMag; mag--) {
    const side = modules * mag;
    const spots: Array<[number, number]> = [
      [Math.max(margin, Math.min(labelW - margin - side, box.x)), Math.max(margin, Math.min(labelH - margin - side, box.y + box.height - side))],
      [Math.max(margin, Math.min(labelW - margin - side, box.x)), Math.max(margin, Math.min(labelH - margin - side, box.y))],
      [labelW - margin - side, labelH - margin - side],
      [margin, labelH - margin - side],
    ];
    for (const [x, y] of spots) {
      const qr: QRElement = {
        id: el.id, type: 'qr', x: Math.round(x), y: Math.round(y), width: side, height: side, rotation: 0, zIndex: el.zIndex,
        isStatic: el.isStatic, content: el.content, errorCorrection: 'M',
        ...(el.fieldName !== undefined ? { fieldName: el.fieldName } : {}),
        ...(el.defaultValue !== undefined ? { defaultValue: el.defaultValue } : {}),
        ...(el.prefix !== undefined ? { prefix: el.prefix } : {}),
        ...(el.suffix !== undefined ? { suffix: el.suffix } : {}),
      };
      const next = replace(elements, id, qr as TemplateElement);
      if (clean(next, id, format, values)) return { kind: 'qr', label: 'Use a QR code instead', done: 'The barcode is now a QR code with the same value.', elements: next };
    }
  }
  return null;
}
