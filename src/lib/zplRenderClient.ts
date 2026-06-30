'use client';

import { LabelFormat } from './types';

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
  const across = Math.max(1, format.labelsAcross || 1);
  const gapIn = format.horizontalGapThermal || 0;
  const sideIn = format.sideMarginThermal || 0;
  const computedLinerIn = sideIn * 2 + across * format.width + (across - 1) * gapIn;
  const linerIn = format.linerWidth || computedLinerIn;

  return {
    widthMm: linerIn * 25.4,
    heightMm: format.height * 25.4,
    dpmm: Math.round((format.dpi || 203) / 25.4),
  };
}

export async function renderZplToDataUrl(
  zpl: string,
  format: Pick<LabelFormat, 'width' | 'height' | 'dpi' | 'labelsAcross' | 'horizontalGapThermal' | 'sideMarginThermal' | 'linerWidth'>,
) {
  const api = await getLocalZplApi();
  const { widthMm, heightMm, dpmm } = thermalRenderDimensions(format);
  const base64 = await api.zplToBase64Async(zpl, widthMm, heightMm, dpmm);
  return `data:image/png;base64,${base64}`;
}
