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
  const { linerIn, heightIn, dpmm } = thermalRenderGeometry(format);

  return {
    widthMm: linerIn * 25.4,
    heightMm: heightIn * 25.4,
    dpmm,
  };
}

export function thermalRenderGeometry(format: Pick<LabelFormat, 'width' | 'height' | 'dpi' | 'labelsAcross' | 'horizontalGapThermal' | 'sideMarginThermal' | 'linerWidth'>) {
  const dpi = format.dpi || 203;
  const across = Math.max(1, format.labelsAcross || 1);
  const gapIn = format.horizontalGapThermal || 0;
  const sideIn = format.sideMarginThermal || 0;
  const labelWDots = Math.round(format.width * dpi);
  const heightDots = Math.round(format.height * dpi);
  const gapDots = Math.round(gapIn * dpi);
  const sideMDots = Math.round(sideIn * dpi);
  const computedLinerIn = sideIn * 2 + across * format.width + (across - 1) * gapIn;
  const linerIn = format.linerWidth || computedLinerIn;
  const linerDots = format.linerWidth
    ? Math.round(format.linerWidth * dpi)
    : sideMDots * 2 + across * labelWDots + (across - 1) * gapDots;
  const effectiveSideMDots = sideIn > 0
    ? sideMDots
    : Math.max(0, Math.round((linerDots - (across * labelWDots + (across - 1) * gapDots)) / 2));

  return {
    labelWDots,
    heightDots,
    linerDots,
    effectiveSideMDots,
    linerIn,
    heightIn: format.height,
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
