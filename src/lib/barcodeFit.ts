import JsBarcode from 'jsbarcode';
import type { BarcodeElement, LabelFormat } from './types';
import { barcodeValueProblem } from './barcodeValue';

/**
 * One verdict for "will this barcode print?", shared by the designer, the
 * new-run check and the run page, so a Metrc tag can't be "may not scan" in
 * one place, "can't print" in another and "send anyway" in a third.
 *
 * It follows what the printer is actually sent (read-only; nothing printed
 * changes):
 *
 * - Native designs (zplGenerator): Code 128 is sent as ^BC mode N, which the
 *   printer draws in subset B, 11 modules a character whatever the
 *   characters (digits do not pair up: there is no >; subset C switch), at
 *   ^BY2 = 2 dots a module. The box width is not used: a 24-character
 *   package tag is always 598 dots (2.95" at 203 dpi). The field origin is
 *   the one zplGenerator computes for each rotation (^FO is the upper-left
 *   of the rotated field). Verified against zpl-renderer-js, the renderer
 *   the previews use (scripts/production/test-barcode-fit.cjs).
 * - Exact (bitmap) designs (thermal/render.server): JsBarcode's encoding
 *   (Code 128 switches to subset C for digit runs) scaled to whole-dot
 *   modules inside the box, with a 10-module clear margin each side. The
 *   renderer refuses a box narrower than that at 1 dot a module, or one that
 *   crosses the label edge.
 *
 * Only what the printer can't produce blocks: a value the barcode type can't
 * hold, an exact box the renderer refuses, bars cut off at the label edge,
 * or bars printed onto the next label. Bars that fit with little clear
 * margin are a warning. The data is never the thing to change for a fit
 * problem: package tags are state tracking IDs.
 */

export type BarcodeFitLevel = 'ok' | 'tight' | 'blocked';
export type BarcodeFitReason =
  | 'ok'
  /** The value can't be drawn by this barcode type (the renderer fails). */
  | 'characters'
  /** Exact design: the box is narrower than the bars at 1 dot a module plus clear margins. */
  | 'box-too-small'
  /** Exact design: the box is too short for bars and the number under them. */
  | 'box-too-short'
  /** Exact design: the box crosses the label edge (the renderer refuses it). */
  | 'box-off-label'
  /** Native design: the bars run past the label edge and are cut off. */
  | 'off-label'
  /** Native design, several labels across: the bars print onto the next label. */
  | 'into-next-label'
  /** The bars fit, with less clear margin than scanners like. */
  | 'quiet-zone';

export type BarcodeFix = 'move' | 'turn' | 'exact-copy' | 'wider-box' | 'taller-box' | 'move-inside' | 'wider-label';

export interface BarcodeFit {
  level: BarcodeFitLevel;
  reason: BarcodeFitReason;
  /** For 'characters': what is wrong with the value, in plain words. */
  problem?: string;
  bitmap: boolean;
  dpi: number;
  /** Length of the bars as printed (native) or the box needed at 1 dot a module (exact), in dots. */
  barsDots: number;
  /** Where the bars start along their length, from the label edge, in dots. */
  startDots: number;
  /** Label length in the bars' direction, in dots. */
  labelDots: number;
  /** Exact designs: the box width in dots. */
  boxDots?: number;
  /** 'into-next-label': the bars reach the next label's barcode. */
  overNextBarcode?: boolean;
  /** Layout changes that would fix it, best first. */
  fixes: BarcodeFix[];
}

/** zplGenerator's module width (^BY2 after every barcode; the printer's default is also 2). */
export const NATIVE_MODULE_DOTS = 2;
/** Clear margin each side the exact renderer keeps inside the box, in modules. */
const BITMAP_QUIET_MODULES = 10;
/** Less clear margin than this beside native bars is a warning (5 modules at ^BY2). */
const TIGHT_MARGIN_DOTS = 10;

function rotationOf(el: Pick<BarcodeElement, 'rotation'>): 0 | 90 | 180 | 270 {
  const r = (((Math.round(el.rotation || 0) % 360) + 360) % 360);
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

/** Modules the printer draws for `value` (native: ^BC mode N, subset B). */
export function nativeBarcodeModules(format: BarcodeElement['barcodeFormat'] | undefined, value: string): number {
  const n = Array.from(value).length;
  switch (format ?? 'CODE128') {
    case 'CODE39': return (n + 2) * 16 - 1; // ratio 3:1: 16 modules a character, gap included
    case 'UPC': return 95;
    case 'EAN13': return 95;
    case 'EAN8': return 67;
    case 'ITF14': return n * 14 + 20; // Interleaved 2 of 5 at 3:1, approximate
    case 'CODE128':
    default: return 11 * n + 35; // start 11 + 11 a character + check 11 + stop 13
  }
}

/** Printed length of a native barcode's bars, in dots. */
export function nativeBarcodeDots(format: BarcodeElement['barcodeFormat'] | undefined, value: string): number {
  return nativeBarcodeModules(format, value) * NATIVE_MODULE_DOTS;
}

/** Height of the number Zebra prints under (beside) ^BY2 bars. */
const INTERPRETATION_DOTS = 20;

/**
 * Where a native barcode's ink lands on the label, in dots: the field origin
 * zplGenerator sends for the rotation (rotatedBoxOrigin), with the bars
 * running from it. Measured with the renderer for 0, 90, 180 and 270.
 */
export function nativeBarcodeFootprint(el: Pick<BarcodeElement, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'barcodeFormat' | 'showText'>, value: string): { x: number; y: number; width: number; height: number } {
  const bars = nativeBarcodeDots(el.barcodeFormat, value);
  const barH = Math.round(el.height * 0.75);
  const thick = barH + (el.showText ? INTERPRETATION_DOTS : 0);
  const x = Math.round(el.x), y = Math.round(el.y), w = Math.round(el.width), h = Math.round(el.height);
  switch (rotationOf(el)) {
    case 90: {
      const ox = Math.round(x + w / 2 + h / 2), oy = Math.round(y + h / 2 - w / 2);
      return { x: ox - (el.showText ? INTERPRETATION_DOTS : 0), y: oy, width: thick, height: bars };
    }
    case 180: return { x: x + w, y: y + h, width: bars, height: thick };
    case 270: {
      const ox = Math.round(x + w / 2 - h / 2), oy = Math.round(y + h / 2 + w / 2);
      return { x: ox, y: oy, width: thick, height: bars };
    }
    default: return { x, y, width: bars, height: thick };
  }
}

/** JsBarcode's bits for an exact design, or null when it can't encode the value. */
function bitmapBits(format: BarcodeElement['barcodeFormat'] | undefined, value: string): string | null {
  const target = {} as { encodings?: Array<{ data: string }> };
  try { JsBarcode(target, value, { format: format ?? 'CODE128', displayValue: false, margin: 0, width: 1 }); } catch { return null; }
  const bits = target.encodings?.map((v) => v.data).join('') || '';
  return bits && !/[^01]/.test(bits) ? bits : null;
}

type FitFormat = Pick<LabelFormat, 'type' | 'width' | 'height' | 'dpi'> & Partial<Pick<LabelFormat, 'labelsAcross' | 'horizontalGapThermal'>>;
type FitElement = Pick<BarcodeElement, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'barcodeFormat' | 'showText'>;

const OK = (bitmap: boolean, dpi: number): BarcodeFit => ({ level: 'ok', reason: 'ok', bitmap, dpi, barsDots: 0, startDots: 0, labelDots: 0, fixes: [] });

/** The verdict for one barcode printing `value` (prefix and suffix included). */
export function barcodeFit(el: FitElement, value: string, format: FitFormat | null | undefined, bitmap: boolean): BarcodeFit {
  const dpi = format?.dpi || 203;
  if (!value) return OK(bitmap, dpi);
  const problem = barcodeValueProblem(el.barcodeFormat, value);
  if (problem) return { ...OK(bitmap, dpi), level: 'blocked', reason: 'characters', problem };
  if (!format || format.type !== 'thermal') return OK(bitmap, dpi);
  const labelW = Math.round(format.width * dpi);
  const labelH = Math.round(format.height * dpi);
  return bitmap ? bitmapFit(el, value, labelW, labelH, dpi) : nativeFit(el, value, format, labelW, labelH, dpi);
}

function bitmapFit(el: FitElement, value: string, labelW: number, labelH: number, dpi: number): BarcodeFit {
  const base = OK(true, dpi);
  const bits = bitmapBits(el.barcodeFormat, value);
  if (!bits) return { ...base, level: 'blocked', reason: 'characters', problem: 'can’t be drawn as this barcode type' };
  const width = Math.round(el.width), height = Math.round(el.height);
  const needed = bits.length + 2 * BITMAP_QUIET_MODULES;
  const along = { barsDots: needed, boxDots: width, labelDots: labelW, startDots: Math.round(el.x) };
  if (width < needed) {
    return { ...base, ...along, level: 'blocked', reason: 'box-too-small', fixes: needed <= labelW ? ['wider-box'] : ['wider-label'] };
  }
  const textHeight = el.showText ? Math.round(10 * dpi / 72) : 0;
  if (height - textHeight < 8) return { ...base, ...along, level: 'blocked', reason: 'box-too-short', fixes: ['taller-box'] };
  // The renderer crops the box to the label and refuses a barcode that loses any of it.
  const r = rotationOf(el);
  const [bw, bh] = r === 90 || r === 270 ? [height, width] : [width, height];
  const left = Math.round(el.x) + Math.round((width - bw) / 2), top = Math.round(el.y) + Math.round((height - bh) / 2);
  if (left < 0 || top < 0 || left + bw > labelW || top + bh > labelH) return { ...base, ...along, level: 'blocked', reason: 'box-off-label', fixes: ['move-inside'] };
  return { ...base, ...along };
}

function nativeFit(el: FitElement, value: string, format: FitFormat, labelW: number, labelH: number, dpi: number): BarcodeFit {
  const r = rotationOf(el);
  const box = nativeBarcodeFootprint(el, value);
  const sideways = r === 90 || r === 270;
  const bars = sideways ? box.height : box.width;
  const start = sideways ? box.y : box.x;
  const labelDots = sideways ? labelH : labelW;
  const otherDots = sideways ? labelW : labelH;
  const base: BarcodeFit = { ...OK(false, dpi), barsDots: bars, startDots: start, labelDots };
  // Worked out only when it doesn't fit (the wizard checks every label).
  const blockedFixes = (): BarcodeFix[] => {
    const fixes: BarcodeFix[] = [];
    if (bars <= labelDots) fixes.push('move');
    if (bars <= otherDots && bars > labelDots) fixes.push('turn');
    // An exact copy draws 1-dot modules (digit pairs packed); offer it only when that fits.
    const exactBits = bitmapBits(el.barcodeFormat, value);
    if (exactBits && exactBits.length + 2 * BITMAP_QUIET_MODULES <= labelDots) fixes.push('exact-copy');
    else if (!fixes.length) fixes.push('wider-label');
    return fixes;
  };
  const end = start + bars;
  const tolerance = 2;
  if (start < -tolerance) return { ...base, level: 'blocked', reason: 'off-label', fixes: blockedFixes() };
  if (end > labelDots + tolerance) {
    const across = Math.max(1, format.labelsAcross || 1);
    if (!sideways && across > 1) {
      const gap = Math.round((format.horizontalGapThermal || 0) * dpi);
      // The next label's copy of this barcode starts at labelW + gap + start.
      return { ...base, level: 'blocked', reason: 'into-next-label', overNextBarcode: end > labelW + gap + start, fixes: blockedFixes() };
    }
    return { ...base, level: 'blocked', reason: 'off-label', fixes: blockedFixes() };
  }
  if (start < TIGHT_MARGIN_DOTS || labelDots - end < TIGHT_MARGIN_DOTS) return { ...base, level: 'tight', reason: 'quiet-zone', fixes: ['move'] };
  return base;
}

function inches(dots: number, dpi: number): string {
  return `${(Math.round((dots / dpi) * 100) / 100).toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}"`;
}

function characters(value: string): string {
  const n = Array.from(value).length;
  return `${n} character${n === 1 ? '' : 's'}`;
}

/**
 * What is wrong, in plain words, without the fix: "is 2.95" wide with
 * “1A4FF0…” (24 characters); only 1.93" fits from where it starts, so the
 * printer cuts it off". Starts with a verb, to follow the item's name.
 */
export function barcodeFitProblem(fit: BarcodeFit, value: string): string {
  const width = inches(fit.barsDots, fit.dpi);
  switch (fit.reason) {
    case 'characters': return fit.problem || 'can’t be drawn with this value';
    case 'box-too-small':
      return `needs a box at least ${width} wide for ${characters(value)}; its box is ${inches(fit.boxDots ?? 0, fit.dpi)} wide, so it can’t be drawn`;
    case 'box-too-short': return 'has a box too short to draw the bars and the number under them';
    case 'box-off-label': return 'crosses the label edge, so it can’t be drawn';
    case 'off-label': {
      const room = Math.max(0, fit.labelDots - Math.max(0, fit.startDots));
      return fit.startDots < 0
        ? 'starts off the label, so the printer cuts it off and it won’t scan'
        : `prints ${width} wide for ${characters(value)}, but only ${inches(room, fit.dpi)} fits from where it starts, so the printer cuts it off and it won’t scan`;
    }
    case 'into-next-label':
      return `prints ${width} wide for ${characters(value)} and runs onto the next label${fit.overNextBarcode ? ', over its barcode' : ''}, so neither label would scan`;
    case 'quiet-zone': return 'reaches the label edge with almost no clear space beside the bars; some scanners may not read it';
    default: return '';
  }
}

/** The layout change that fixes it, as an instruction. Never "shorten it". */
export function barcodeFitFix(fit: BarcodeFit): string {
  if (fit.reason === 'characters') return '';
  const label = inches(fit.labelDots, fit.dpi);
  const width = inches(fit.barsDots, fit.dpi);
  const options: string[] = [];
  for (const fix of fit.fixes) {
    if (fix === 'wider-box') options.push(`make the barcode box at least ${width} wide in the design`);
    if (fix === 'wider-label') options.push(`this needs ${width} and the label is ${label}: use a wider label or a QR code`);
    if (fix === 'taller-box') options.push('make the barcode box taller in the design');
    if (fix === 'move-inside') options.push('move the barcode box fully onto the label in the design');
    if (fix === 'move') options.push(fit.reason === 'quiet-zone' ? 'move it in from the edge a little in the design' : `move it in the design so the ${width} of bars fit on the ${label} label`);
    if (fix === 'turn') options.push('turn it sideways in the design');
    if (fix === 'exact-copy') options.push('make an exact-print copy of the design (More menu in the designer), which draws thinner bars');
  }
  if (!options.length) return '';
  const joined = options.length === 1 ? options[0] : `${options.slice(0, -1).join(', ')} or ${options[options.length - 1]}`;
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}
