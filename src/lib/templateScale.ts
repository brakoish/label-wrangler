import type { LabelFormat, LabelTemplate, TemplateElement, TextElement } from './types';

type ElementWithoutIdentity = TemplateElement extends infer T
  ? T extends TemplateElement
    ? Omit<T, 'id' | 'zIndex'>
    : never
  : never;

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
  // Generate a fresh, unique id + index pair for every cloned element.
  // The template POST endpoint doesn't mint element ids for us, so if we
  // passed through the source ids (or left them undefined) every element
  // would end up colliding in the selection state.
  const freshId = (i: number) => `el-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;

  if (!scale) {
    // Literal deep copy; fresh id + zIndex per element.
    return source.elements.map((el, i) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, zIndex: _z, ...rest } = el;
      return { ...rest, id: freshId(i), zIndex: i } as TemplateElement;
    });
  }

  const src = formatWorkingDims(sourceFormat);
  const tgt = formatWorkingDims(targetFormat);
  // Uniform scale preserves element aspect ratios even if label aspect changes.
  const ratio = Math.min(tgt.w / src.w, tgt.h / src.h);
  const physicalRatio = Math.min(targetFormat.width / sourceFormat.width, targetFormat.height / sourceFormat.height);

  return source.elements.map((el, i) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, zIndex: _z, ...rest } = el;
    const base: TemplateElement = {
      ...(rest as ElementWithoutIdentity),
      id: freshId(i),
      zIndex: i,
      x: el.x * ratio,
      y: el.y * ratio,
      width: el.width * ratio,
      height: el.height * ratio,
    } as TemplateElement;

    // Scale text fontSize too so text stays visually proportional.
    if (base.type === 'text') {
      const t = base as TextElement;
      t.fontSize = Math.max(4, Math.round(t.fontSize * physicalRatio * 10) / 10);
      if (t.minFontSize !== undefined) t.minFontSize = Math.min(t.fontSize, Math.max(.5, t.minFontSize * physicalRatio));
      if (source.thermalRenderMode === 'bitmap-v1' && targetFormat.type === 'thermal' && t.letterSpacing !== undefined) t.letterSpacing *= ratio;
    }

    return base;
  });
}
