import type { LabelFormat } from '../types';

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
