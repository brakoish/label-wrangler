'use client';

import { LabelFormat } from './types';
import { decodeBitmapZpl, unpackMonochrome } from './thermal/bitmap';
import { thermalRenderGeometry } from './thermal/geometry';
export { thermalRenderGeometry } from './thermal/geometry';

type ZplRendererApi = {
  zplToBase64Async: (zpl: string, widthMm?: number, heightMm?: number, dpmm?: number) => Promise<string>;
};

let zplApiPromise: Promise<ZplRendererApi> | null = null;

async function getLocalZplApi() {
  if (!zplApiPromise) {
    zplApiPromise = import('zpl-renderer-js').then(async (m) => {
      const { api } = await m.ready;
      return api as ZplRendererApi;
    });
  }
  return zplApiPromise;
}

export function thermalRenderDimensions(format: Pick<LabelFormat, 'width' | 'height' | 'dpi' | 'labelsAcross' | 'horizontalGapThermal' | 'sideMarginThermal' | 'linerWidth'>) {
  const { linerIn, heightIn, dpmm } = thermalRenderGeometry(format);

  return {
    widthMm: linerIn * 25.4,
    heightMm: heightIn * 25.4,
    dpmm,
  };
}


export async function renderZplToDataUrl(
  zpl: string,
  format: Pick<LabelFormat, 'width' | 'height' | 'dpi' | 'labelsAcross' | 'horizontalGapThermal' | 'sideMarginThermal' | 'linerWidth'>,
) {
  const bitmap = decodeBitmapZpl(zpl);
  if (bitmap) {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to display bitmap proof');
    const pixels = ctx.createImageData(bitmap.width, bitmap.height);
    pixels.data.set(unpackMonochrome(bitmap.packed, bitmap.width, bitmap.height));
    ctx.putImageData(pixels, 0, 0);
    return canvas.toDataURL('image/png');
  }
  const api = await getLocalZplApi();
  const { widthMm, heightMm, dpmm } = thermalRenderDimensions(format);
  const base64 = await api.zplToBase64Async(zpl, widthMm, heightMm, dpmm);
  return `data:image/png;base64,${base64}`;
}

/**
 * The renderer refuses a label with nothing on it ("No labels parsed"). That
 * happens in the new-run picture before any value is typed, when every part
 * is left out of the picture because it has no value yet.
 */
export function isNothingToDrawError(error: unknown): boolean {
  return error instanceof Error && /no labels parsed/i.test(error.message);
}

/** A plain white label the size the renderer would draw, for the striped empty picture. */
export function blankLabelDataUrl(format: Pick<LabelFormat, 'width' | 'height' | 'dpi' | 'labelsAcross' | 'horizontalGapThermal' | 'sideMarginThermal' | 'linerWidth'>) {
  const { widthMm, heightMm, dpmm } = thermalRenderDimensions(format);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(widthMm * dpmm));
  canvas.height = Math.max(1, Math.round(heightMm * dpmm));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to display the label');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}
