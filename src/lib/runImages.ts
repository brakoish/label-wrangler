import type { LabelTemplate } from './types';
import { OfficeError } from './office/http';

export type RunImageSelections = Record<string, string>;
export const MAX_RUN_IMAGE_BYTES = 1_000_000;
export const MAX_RUN_IMAGE_TOTAL_CHARS = 2_800_000;
export const MAX_RUN_IMAGE_PIXELS = 16_000_000;
export function validateRunImages(value: unknown): asserts value is RunImageSelections {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OfficeError('Invalid run images');
  const entries = Object.entries(value);
  if (entries.length > 100) throw new OfficeError('Too many run images');
  let total = 0;
  for (const [id, src] of entries) {
    if (!id || id.length > 200 || typeof src !== 'string') throw new OfficeError('Invalid run image');
    total += src.length;
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(src);
    if (!match || match[2].length % 4 !== 0) throw new OfficeError('Run images must be embedded PNG, JPEG or WebP files');
    const bytes = match[2].length * 3 / 4 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
    if (bytes > MAX_RUN_IMAGE_BYTES) throw new OfficeError('Each run image must be 1 MB or smaller');
  }
  if (total > MAX_RUN_IMAGE_TOTAL_CHARS) throw new OfficeError('Combined run images are too large (2.8 MB encoded limit)');
}

export function applyRunImages(template: LabelTemplate, selections: RunImageSelections): LabelTemplate {
  validateRunImages(selections);
  for (const id of Object.keys(selections)) {
    if (!template.elements.some(e => e.id === id && e.type === 'image' && e.runSelectable === true)) {
      throw new OfficeError('Image slot changed or is not run-selectable. Reload setup.');
    }
  }
  return { ...template, elements: template.elements.map(e => e.type === 'image' && Object.hasOwn(selections, e.id) ? { ...e, src: selections[e.id] } : e) };
}
