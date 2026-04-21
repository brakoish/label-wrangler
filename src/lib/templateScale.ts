import type { LabelFormat, LabelTemplate, TemplateElement, TextElement } from './types';

/**
 * Compute the working-units width/height of a label format (thermal in dots,
 * sheet in inches). Used to compute scale ratios when duplicating across formats.
 */
function formatWorkingDims(format: LabelFormat): { w: number; h: number } {
  if (format.type === 'thermal') {
    const dpi = format.dpi || 203;
    return { w: format.width * dpi, h: format.height * dpi };
  }
  return { w: format.width, h: format.height };
}

export interface DuplicateOptions {
  /** Scale elements proportionally to fit the new format dimensions. When false,
   *  elements keep their literal x/y/width/height values (useful when the two
   *  formats use the same units and you want exact placement). */
  scale: boolean;
}

/**
 * Duplicate a template's elements, optionally rescaling positions/sizes/fontSize
 * to fit a new format. Uniform scale (min of x/y ratios) preserves aspect ratio.
 */
export function duplicateElementsForFormat(
  source: LabelTemplate,
  sourceFormat: LabelFormat,
  targetFormat: LabelFormat,
  { scale }: DuplicateOptions,
): TemplateElement[] {
  if (!scale) {
    // Literal deep copy; drop id + zIndex so the DB assigns fresh ones.
    return source.elements.map((el) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, zIndex: _z, ...rest } = el as any;
      return rest as TemplateElement;
    });
  }

  const src = formatWorkingDims(sourceFormat);
  const tgt = formatWorkingDims(targetFormat);
  // Uniform scale preserves element aspect ratios even if label aspect changes.
  const ratio = Math.min(tgt.w / src.w, tgt.h / src.h);

  return source.elements.map((el) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, zIndex: _z, ...rest } = el as any;
    const base: TemplateElement = {
      ...rest,
      x: el.x * ratio,
      y: el.y * ratio,
      width: el.width * ratio,
      height: el.height * ratio,
    } as TemplateElement;

    // Scale text fontSize too so text stays visually proportional.
    if (base.type === 'text') {
      const t = base as TextElement;
      (base as TextElement).fontSize = Math.max(4, Math.round(t.fontSize * ratio * 10) / 10);
    }

    return base;
  });
}
