import type { LabelTemplate, TemplateElement } from './types';

/**
 * "Leave a part off this run": the run's design without the items that print
 * those per-label parts, so nothing is drawn there (not the designer's
 * sample, which is what a blank part prints). Used for the new-run preview
 * and checks, and by the server for the run's saved design, so the preview,
 * the checks and every print of the run agree. The shared design is never
 * changed, and the printers draw the items that are left exactly as before.
 */
export function isLeftOffElement(el: Pick<TemplateElement, 'isStatic' | 'type' | 'fieldName'>, fields: ReadonlySet<string>): boolean {
  return !el.isStatic && el.type !== 'image' && !!el.fieldName && fields.has(el.fieldName);
}

export function leaveFieldsOff<T extends Pick<LabelTemplate, 'elements'>>(template: T, fields: Iterable<string>): T {
  const set = new Set(Array.from(fields).filter((field) => typeof field === 'string' && field.trim()));
  if (!set.size) return template;
  const elements = template.elements.filter((el) => !isLeftOffElement(el, set));
  return elements.length === template.elements.length ? template : { ...template, elements };
}
