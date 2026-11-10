import type { TemplateElement } from './types';
import { nextItemName } from './fieldLabels';

type Typed = { type: string; isStatic: boolean; content?: string; defaultValue?: string; fieldName?: string };

/**
 * Updates for switching an element between "Same on every label" (static) and
 * "Changes per label" (dynamic) without losing what was typed: the fixed text
 * becomes the preview sample, and a sample becomes the fixed text.
 */
export function contentModeUpdates(element: Typed, sameOnEveryLabel: boolean, makeFieldName: () => string = () => nextItemName(element.type, [])): Partial<TemplateElement> {
  const hasText = element.type !== 'line' && element.type !== 'rectangle' && element.type !== 'image';
  if (sameOnEveryLabel) {
    const updates: Record<string, unknown> = { isStatic: true };
    if (hasText && !(element.content || '').trim() && element.defaultValue) updates.content = element.defaultValue;
    return updates as Partial<TemplateElement>;
  }
  const updates: Record<string, unknown> = { isStatic: false };
  if (hasText && !(element.defaultValue || '').trim() && (element.content || '').trim()) updates.defaultValue = element.content;
  if (!element.fieldName || !element.fieldName.trim()) updates.fieldName = makeFieldName();
  return updates as Partial<TemplateElement>;
}
