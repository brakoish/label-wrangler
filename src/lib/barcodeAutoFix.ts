import type { BarcodeElement, LabelFormat, QRElement, TemplateElement } from './types';
import { barcodeFit, nativeBarcodeFootprint } from './barcodeFit';
import { layoutProblems, printedBounds, type Box } from './designerLayout';
import { bitmapFootprint, bitmapLayoutProblems, bitmapQrModules, boxesOverlap, resolvedValue } from './bitmapLayout';
import { zplQrGeometry } from './zplGenerator';

/**
 * "Fix it for me" for a barcode that won't print whole or lands on another
 * item: a change to THIS design's layout only (move it so it fits and lands
 * on nothing, widen its box, turn it sideways, or use a QR code in the same
 * spot), offered only when the shared checks say the result prints whole and
 * lands on nothing else. Works for "Printer font" (native) and "Exact
 * picture" (bitmap) designs. Nothing here is sent to a printer, the ZPL
 * generator is untouched, and other designs and their runs are untouched;
 * the designer applies it as one edit, so Undo takes it back.
 */
export interface BarcodeAutoFix {
  kind: 'move' | 'turn' | 'widen' | 'qr';
  /** The button's words. */
  label: string;
  /** What changed, said after the fix ("Moved the barcode so it fits on the label."). */
  done: string;
  /** The design's items with the fix applied. */
  elements: TemplateElement[];
}

type Values = Record<string, string>;
export interface AutoFixOptions {
  /** Native designs: printed ink of items measured from the print renderer (the designer canvas). */
  measured?: Readonly<Record<string, Box | undefined>>;
}

/** Items whose ink matters when something lands on them (lines and frames don't). */
const CONTENT = new Set(['text', 'barcode', 'qr', 'image']);

/**
 * The QR code a printer draws for ^BQ sits 10 dots below its field origin,
 * and its version can be one above the estimate zplGenerator uses (measured
 * with zpl-renderer-js). A QR code offered as a fix must fit with both.
 */
const NATIVE_QR_DROP = 10;
const NATIVE_QR_EXTRA_MODULES = 4;

function nativeQrInk(el: QRElement, values: Values): Box {
  const value = resolvedValue(el, values) || 'QR';
  const { magnification, printedSize, modules } = zplQrGeometry(value, el.errorCorrection || 'M', el.width);
  const x = Math.round(el.x) + Math.round((Math.round(el.width) - printedSize) / 2);
  const y = Math.round(el.y) + Math.round((Math.round(el.height) - printedSize) / 2);
  const side = (modules + NATIVE_QR_EXTRA_MODULES) * magnification;
  return { x, y: y + NATIVE_QR_DROP, width: side, height: side };
}

/** Where an item's ink lands, for the fix's own checks (generous for a QR code it makes). */
function inkOf(el: TemplateElement, format: LabelFormat, values: Values, bitmap: boolean, opts: AutoFixOptions, own: boolean): Box | null {
  if (bitmap) return bitmapFootprint(el, values);
  if (own && el.type === 'qr') return nativeQrInk(el, values);
  return (!own && opts.measured?.[el.id]) || printedBounds(el, format, values);
}

interface Spot { labelW: number; labelH: number; margin: number; others: Box[] }

function spotFor(elements: ReadonlyArray<TemplateElement>, id: string, format: LabelFormat, values: Values, bitmap: boolean, opts: AutoFixOptions): Spot {
  const dpi = format.dpi || 203;
  return {
    labelW: Math.round(format.width * dpi),
    labelH: Math.round(format.height * dpi),
    margin: Math.round(dpi * 0.03),
    others: elements.filter((e) => e.id !== id && CONTENT.has(e.type)).map((e) => inkOf(e, format, values, bitmap, opts, false)).filter((b): b is Box => !!b),
  };
}

/** The box sits inside the label (with a small margin) and on nothing else. */
function boxFree(box: Box | null, spot: Spot): boolean {
  if (!box) return false;
  const m = spot.margin;
  if (box.x < m || box.y < m || box.x + box.width > spot.labelW - m || box.y + box.height > spot.labelH - m) return false;
  // A few dots apart, not just touching.
  return !spot.others.some((other) => boxesOverlap(box, other, -3));
}

/** True when the item prints whole, inside the label, over nothing (the shared checks). */
function clean(elements: TemplateElement[], id: string, format: LabelFormat, values: Values, bitmap: boolean, opts: AutoFixOptions): boolean {
  const el = elements.find((e) => e.id === id);
  if (!el) return false;
  if (el.type === 'barcode') {
    const fit = barcodeFit(el, resolvedValue(el, values), format, bitmap);
    if (fit.level === 'tight' || (fit.level === 'blocked' && fit.reason !== 'characters')) return false;
  }
  if (!boxFree(inkOf(el, format, values, bitmap, opts, true), spotFor(elements, id, format, values, bitmap, opts))) return false;
  const others = opts.measured ? Object.fromEntries(Object.entries(opts.measured).filter(([key]) => key !== id)) : undefined;
  const problems = bitmap ? bitmapLayoutProblems(elements, format, values) : layoutProblems(elements, format, values, others);
  return !problems.some((p) => p.ids.includes(id) && (p.blocking || p.kinds.some((k) => k === 'overlap' || k === 'off-label')));
}

function replace(elements: ReadonlyArray<TemplateElement>, id: string, next: TemplateElement): TemplateElement[] {
  return elements.map((e) => (e.id === id ? next : e));
}

/**
 * Where to put an item of a given ink box so it lands on nothing: positions
 * across the label, nearest to where it is now first. Cheap box tests pick
 * the candidates; the caller confirms one with the full checks.
 */
function freePlaces(el: TemplateElement, ink: Box, spot: Spot): Array<{ x: number; y: number }> {
  const dx = ink.x - Math.round(el.x), dy = ink.y - Math.round(el.y);
  const step = Math.max(4, Math.round(Math.min(spot.labelW, spot.labelH) / 40));
  const maxX = spot.labelW - spot.margin - ink.width, maxY = spot.labelH - spot.margin - ink.height;
  if (maxX < spot.margin || maxY < spot.margin) return [];
  const xs: number[] = [], ys: number[] = [];
  for (let x = spot.margin; x <= maxX; x += step) xs.push(x);
  for (let y = spot.margin; y <= maxY; y += step) ys.push(y);
  // The far edges too, so a box that just fits isn't missed.
  xs.push(maxX); ys.push(maxY);
  const places: Array<{ x: number; y: number; d: number }> = [];
  for (const x of xs) for (const y of ys) {
    if (!boxFree({ x, y, width: ink.width, height: ink.height }, spot)) continue;
    places.push({ x: Math.round(x - dx), y: Math.round(y - dy), d: Math.hypot(x - ink.x, y - ink.y) });
  }
  return places.sort((a, b) => a.d - b.d).slice(0, 40);
}

function tryPlaces(elements: ReadonlyArray<TemplateElement>, id: string, candidate: TemplateElement, format: LabelFormat, values: Values, bitmap: boolean, opts: AutoFixOptions): TemplateElement[] | null {
  const ink = inkOf(candidate, format, values, bitmap, opts, true);
  if (!ink) return null;
  const spot = spotFor(elements, id, format, values, bitmap, opts);
  // Where it is now first (a box made wider or turned may already fit there).
  if (boxFree(ink, spot)) {
    const here = replace(elements, id, candidate);
    if (clean(here, id, format, values, bitmap, opts)) return here;
  }
  for (const place of freePlaces(candidate, ink, spot)) {
    const next = replace(elements, id, { ...candidate, x: place.x, y: place.y } as TemplateElement);
    if (clean(next, id, format, values, bitmap, opts)) return next;
  }
  return null;
}

/** Shift a native barcode so its printed bars start at `start` dots along its length. */
function placeBars(el: BarcodeElement, value: string, start: number): BarcodeElement {
  const box = nativeBarcodeFootprint(el, value);
  const sideways = el.rotation === 90 || el.rotation === 270;
  return sideways ? { ...el, y: Math.round(el.y + start - box.y) } : { ...el, x: Math.round(el.x + start - box.x) };
}

/** What the fix is about: a barcode that won't print whole, or one that lands on something. */
function problemOf(elements: ReadonlyArray<TemplateElement>, el: BarcodeElement, format: LabelFormat, values: Values, bitmap: boolean, opts: AutoFixOptions): 'fit' | 'overlap' | null {
  const fit = barcodeFit(el, resolvedValue(el, values), format, bitmap);
  // A value the barcode type can't hold is fixed in the data, not the layout.
  if (fit.level === 'blocked' && fit.reason === 'characters') return null;
  if (fit.level === 'blocked') return 'fit';
  const problems = bitmap ? bitmapLayoutProblems(elements, format, values) : layoutProblems(elements, format, values, opts.measured);
  return problems.some((p) => p.ids.includes(el.id) && p.kinds.some((k) => k === 'overlap' || k === 'off-label')) ? 'overlap' : null;
}

/**
 * Move, widen or turn the barcode so it prints whole and lands on nothing.
 * Null when no such change exists (then "Use a QR code instead" may).
 */
export function barcodeAutoFix(elements: ReadonlyArray<TemplateElement>, id: string, format: LabelFormat | null | undefined, values: Values, bitmap: boolean, opts: AutoFixOptions = {}): BarcodeAutoFix | null {
  if (!format || format.type !== 'thermal') return null;
  const el = elements.find((e) => e.id === id);
  if (!el || el.type !== 'barcode' || el.locked) return null;
  const problem = problemOf(elements, el, format, values, bitmap, opts);
  if (!problem) return null;
  const value = resolvedValue(el, values);
  const fit = barcodeFit(el, value, format, bitmap);
  const dpi = format.dpi || 203;
  const labelW = Math.round(format.width * dpi);
  const labelH = Math.round(format.height * dpi);
  const margin = Math.round(dpi * 0.05);
  const moved = (next: TemplateElement[]): BarcodeAutoFix => ({ kind: 'move', label: 'Fix it for me', done: problem === 'overlap' ? 'Moved the barcode so it lands on nothing else.' : 'Moved the barcode so it fits on the label.', elements: next });

  if (bitmap) {
    // Exact picture: the box is what prints.
    if (fit.reason === 'box-too-short') {
      const textHeight = el.showText ? Math.round(10 * dpi / 72) : 0;
      const taller: BarcodeElement = { ...el, height: Math.max(Math.round(el.height), textHeight + Math.round(dpi * 0.15)) };
      const next = tryPlaces(elements, id, taller, format, values, true, opts);
      return next ? { kind: 'widen', label: 'Fix it for me', done: 'Made the barcode taller so it can print.', elements: next } : null;
    }
    if (fit.reason !== 'box-too-small') {
      const next = tryPlaces(elements, id, el, format, values, true, opts);
      if (next) return moved(next);
    }
    // The box must hold the bars at whole dots: the widest size that fits across, then sideways.
    const needed = fit.reason === 'box-too-small' ? fit.barsDots : 0;
    if (needed) {
      const sideways = el.rotation === 90 || el.rotation === 270;
      for (const turn of [false, true]) {
        const along = sideways !== turn ? labelH : labelW;
        for (let scale = 3; scale >= 1; scale--) {
          const width = needed * scale;
          if (width > along - 2 * margin) continue;
          const resized: BarcodeElement = { ...el, width, rotation: turn ? (sideways ? 0 : 90) : el.rotation };
          const next = tryPlaces(elements, id, resized, format, values, true, opts);
          if (next) return turn
            ? { kind: 'turn', label: 'Fix it for me', done: 'Turned the barcode sideways and made its box fit the bars.', elements: next }
            : { kind: 'widen', label: 'Fix it for me', done: 'Made the barcode box wide enough for its bars.', elements: next };
        }
      }
    }
    return null;
  }

  // Printer font (native): the bars are as long as the value needs, whatever the box.
  if (problem === 'overlap') {
    const next = tryPlaces(elements, id, el, format, values, false, opts);
    return next ? moved(next) : null;
  }
  // 1. Move it along its length so the bars fit (centred, then each edge), then anywhere free.
  if (fit.barsDots + 2 * margin <= fit.labelDots) {
    for (const start of [Math.round((fit.labelDots - fit.barsDots) / 2), margin, fit.labelDots - margin - fit.barsDots]) {
      const next = replace(elements, id, placeBars(el, value, start));
      if (clean(next, id, format, values, false, opts)) return moved(next);
    }
    const anywhere = tryPlaces(elements, id, placeBars(el, value, Math.round((fit.labelDots - fit.barsDots) / 2)), format, values, false, opts);
    if (anywhere) return moved(anywhere);
  }

  // 2. Turn it sideways when the label is long enough the other way.
  const otherDots = fit.labelDots === labelW ? labelH : labelW;
  if (fit.barsDots + 2 * margin <= otherDots) {
    for (const rotation of [90, 270] as const) {
      const turned: BarcodeElement = { ...el, rotation };
      const box = nativeBarcodeFootprint(turned, value);
      for (const across of [labelW - margin - box.width, margin]) {
        const shifted: BarcodeElement = { ...turned, x: Math.round(turned.x + across - box.x) };
        const next = replace(elements, id, placeBars(shifted, value, Math.round((labelH - fit.barsDots) / 2)));
        if (clean(next, id, format, values, false, opts)) return { kind: 'turn', label: 'Fix it for me', done: 'Turned the barcode sideways so its bars fit.', elements: next };
      }
      const anywhere = tryPlaces(elements, id, placeBars(turned, value, Math.round((labelH - fit.barsDots) / 2)), format, values, false, opts);
      if (anywhere) return { kind: 'turn', label: 'Fix it for me', done: 'Turned the barcode sideways so its bars fit.', elements: anywhere };
    }
  }
  return null;
}

/**
 * "Use a QR code instead": the same value as a QR code, as big as fits near
 * where the barcode was without landing on anything or running off the
 * label, with modules big enough to scan (at least 0.24 mm). Sized for the
 * value the caller passes (the longest one). Null when there is no such spot.
 */
export function barcodeToQr(elements: ReadonlyArray<TemplateElement>, id: string, format: LabelFormat | null | undefined, values: Values, bitmap: boolean, opts: AutoFixOptions = {}): BarcodeAutoFix | null {
  if (!format || format.type !== 'thermal') return null;
  const el = elements.find((e) => e.id === id);
  if (!el || el.type !== 'barcode' || el.locked) return null;
  if (!problemOf(elements, el, format, values, bitmap, opts)) return null;
  const value = resolvedValue(el, values) || 'QR';
  const dpi = format.dpi || 203;
  const labelW = Math.round(format.width * dpi);
  const labelH = Math.round(format.height * dpi);
  const margin = Math.round(dpi * 0.03);
  const minMag = Math.max(2, Math.ceil((0.24 / 25.4) * dpi));
  const room = Math.min(labelW, labelH) - 2 * margin;
  // Exact picture: (modules + 8) × scale, its clear margin included. Printer font: modules × magnification, plus room for the printer's offset.
  const qrModules = bitmap ? bitmapQrModules(value, 'M') : zplQrGeometry(value, 'M', 1000).modules;
  if (!qrModules) return null;
  const modules = bitmap ? qrModules + 8 : qrModules;
  const inkModules = bitmap ? modules : modules + NATIVE_QR_EXTRA_MODULES;
  const biggest = Math.min(10, Math.floor((room - (bitmap ? 0 : NATIVE_QR_DROP)) / inkModules));
  const anchor = (bitmap ? bitmapFootprint(el, values) : nativeBarcodeFootprint(el, value)) ?? { x: Math.round(el.x), y: Math.round(el.y), width: 0, height: 0 };
  for (let mag = biggest; mag >= minMag; mag--) {
    const side = modules * mag;
    const qr = {
      id: el.id, type: 'qr', x: Math.max(margin, Math.min(labelW - margin - side, anchor.x)), y: Math.max(margin, Math.min(labelH - margin - side, anchor.y)),
      width: side, height: side, rotation: 0, zIndex: el.zIndex,
      isStatic: el.isStatic, content: el.content, errorCorrection: 'M',
      ...(el.fieldName !== undefined ? { fieldName: el.fieldName } : {}),
      ...(el.defaultValue !== undefined ? { defaultValue: el.defaultValue } : {}),
      ...(el.prefix !== undefined ? { prefix: el.prefix } : {}),
      ...(el.suffix !== undefined ? { suffix: el.suffix } : {}),
    } as QRElement;
    const next = tryPlaces(elements, id, qr as TemplateElement, format, values, bitmap, opts);
    if (next) return { kind: 'qr', label: 'Use a QR code instead', done: 'The barcode is now a QR code with the same value.', elements: next };
  }
  return null;
}
