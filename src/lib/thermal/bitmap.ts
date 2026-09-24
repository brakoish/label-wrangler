import type { TemplateElement } from '../types';

export const BITMAP_VERSION = 'bitmap-v1-liberation-160-fit2';
export const MAX_RASTER_PIXELS = 12_000_000;
export type LaneValues = Record<string, string> | null | undefined;
export type FeedValues = Record<string, string> | LaneValues[];

// Deliberately matches native-v1 truthy/default semantics, including blank vs '0'.
export function resolveThermalContent(element: TemplateElement, values: Record<string, string> = {}) {
  if (element.isStatic) return 'content' in element ? element.content || '' : '';
  return `${element.prefix || ''}${(element.fieldName && values[element.fieldName]) || element.defaultValue || ''}${element.suffix || ''}`;
}

export function rasterSize(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_RASTER_PIXELS) throw new Error('Unsupported bitmap dimensions');
  return Math.ceil(width / 8) * height;
}

export function packMonochrome(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number) {
  const packed = new Uint8Array(rasterSize(width, height));
  if (rgba.length !== width * height * 4) throw new Error('Invalid raster buffer');
  const rowBytes = Math.ceil(width / 8);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, alpha = rgba[i + 3] / 255;
    const luminance = (rgba[i] * .299 + rgba[i + 1] * .587 + rgba[i + 2] * .114) * alpha + 255 * (1 - alpha);
    if (luminance < 160) packed[y * rowBytes + (x >> 3)] |= 128 >> (x % 8);
  }
  return packed;
}

export function unpackMonochrome(packed: Uint8Array, width: number, height: number) {
  if (packed.length !== rasterSize(width, height)) throw new Error('Invalid packed raster');
  const rgba = new Uint8ClampedArray(width * height * 4), stride = Math.ceil(width / 8);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, v = packed[y * stride + (x >> 3)] & (128 >> (x % 8)) ? 0 : 255;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = v; rgba[i + 3] = 255;
  }
  return rgba;
}

export function bitmapZpl(packed: Uint8Array, width: number, height: number, inputDigest: string, pixelDigest: string) {
  if (packed.length !== rasterSize(width, height) || !/^[a-f0-9]{64}$/.test(inputDigest) || !/^[a-f0-9]{64}$/.test(pixelDigest)) throw new Error('Invalid bitmap result');
  const stride = Math.ceil(width / 8), rows = Math.floor(99999 / stride);
  const commands = ['^XA', `^FXLWBITMAP1:${inputDigest}:${pixelDigest}^FS`, '^PON^PMN^LRN', `^PW${width}`, `^LL${height}`];
  // Local calibration offsets remain printer settings. Office adds its own resets.
  for (let y = 0; y < height; y += rows) {
    const bytes = packed.subarray(y * stride, Math.min(height, y + rows) * stride);
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    commands.push(`^FO0,${y}^GFA,${bytes.length},${bytes.length},${stride},${hex}^FS`);
  }
  return commands.concat('^PQ1', '^XZ').join('\n');
}

// Only our tagged bitmap documents take this path. Legacy ZPL still uses WASM.
export function decodeBitmapZpl(zpl: string) {
  if (!zpl.includes('^FXLWBITMAP1:')) return null;
  const width = Number(zpl.match(/\^PW(\d+)/)?.[1]), height = Number(zpl.match(/\^LL(\d+)/)?.[1]);
  const packed = new Uint8Array(rasterSize(width, height)), stride = Math.ceil(width / 8);
  let offset = 0;
  for (const m of zpl.matchAll(/\^FO0,(\d+)\^GFA,(\d+),(\d+),(\d+),([A-F0-9]+)\^FS/g)) {
    const length = Number(m[2]);
    if (Number(m[1]) * stride !== offset || length !== Number(m[3]) || Number(m[4]) !== stride || m[5].length !== length * 2 || length % stride || offset + length > packed.length) throw new Error('Invalid bitmap strip');
    for (let i = 0; i < length; i++) packed[offset + i] = parseInt(m[5].slice(i * 2, i * 2 + 2), 16);
    offset += length;
  }
  if (offset !== packed.length) throw new Error('Incomplete bitmap proof');
  return { width, height, packed };
}
