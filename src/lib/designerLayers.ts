import type { TemplateElement } from './types';

export type LayerDirection = 'up' | 'down' | 'top' | 'back';

// Work in sorted order, not zIndex +/- 1: deleted/imported layers can have gaps.
export function moveLayers(elements: TemplateElement[], ids: Set<string>, direction: LayerDirection): TemplateElement[] {
  const ordered = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  const selected = (e: TemplateElement) => ids.has(e.id) && !e.locked;
  let result = ordered;
  if (direction === 'top' || direction === 'back') {
    const moving = ordered.filter(selected), rest = ordered.filter(e => !selected(e));
    result = direction === 'top' ? [...rest, ...moving] : [...moving, ...rest];
  } else if (direction === 'up') {
    for (let i = result.length - 2; i >= 0; i--) {
      if (selected(result[i]) && !selected(result[i + 1])) [result[i], result[i + 1]] = [result[i + 1], result[i]];
    }
  } else {
    for (let i = 1; i < result.length; i++) {
      if (selected(result[i]) && !selected(result[i - 1])) [result[i], result[i - 1]] = [result[i - 1], result[i]];
    }
  }
  const original = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  if (result.every((e, i) => e.id === original[i].id)) return elements;
  const positions = new Map(result.map((e, i) => [e.id, i]));
  return elements.map(e => ({ ...e, zIndex: positions.get(e.id)! }));
}
