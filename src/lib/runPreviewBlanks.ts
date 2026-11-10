import type { LabelTemplate, TemplateElement } from './types';

export interface PreviewBlankBox { lane: number; x: number; y: number; width: number; height: number }

/**
 * The new-run picture never shows the designer's sample for a part that has
 * no value: the printers fall back to that sample for a blank value, and a
 * picture of a finished-looking label hides that nothing real is there yet.
 * Items whose part is empty on every label shown (a pair on a 2-across roll,
 * the page on a sheet) are taken out of the picture only, and their boxes
 * are returned so the picture can mark them as empty. A text item with no
 * sample prints as it is, so it stays. The checks and the run are untouched.
 */
export function blankPreviewItems<T extends Pick<LabelTemplate, 'elements'>>(
  template: T,
  shown: ReadonlyArray<Record<string, string> | null | undefined>,
  fields: ReadonlyArray<string>,
): { template: T; emptyFields: string[]; boxes: PreviewBlankBox[] } {
  const lanes = shown.map((values, lane) => ({ values, lane })).filter((entry): entry is { values: Record<string, string>; lane: number } => !!entry.values);
  if (!lanes.length) return { template, emptyFields: [], boxes: [] };
  const empty = new Set(fields.filter((field) => lanes.every(({ values }) => !(values[field] ?? '').trim())));
  if (!empty.size) return { template, emptyFields: [], boxes: [] };
  const drawsSample = (el: TemplateElement) => !el.isStatic && el.type !== 'image' && !!el.fieldName && empty.has(el.fieldName)
    && (!!el.defaultValue || el.type === 'barcode' || el.type === 'qr');
  const removed = template.elements.filter(drawsSample);
  if (!removed.length) return { template, emptyFields: [], boxes: [] };
  const boxes: PreviewBlankBox[] = [];
  for (const el of removed) {
    if (((Math.round(el.rotation || 0) % 360) + 360) % 360 !== 0) continue;
    for (const { lane } of lanes) boxes.push({ lane, x: el.x, y: el.y, width: el.width, height: Math.max(el.height, 1) });
  }
  return {
    template: { ...template, elements: template.elements.filter((el) => !drawsSample(el)) },
    emptyFields: Array.from(new Set(removed.map((el) => el.fieldName as string))),
    boxes,
  };
}
