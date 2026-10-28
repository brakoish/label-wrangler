import sharp from 'sharp';
import { applyRunImages, MAX_RUN_IMAGE_PIXELS, validateRunImages } from './runImages';
import type { LabelTemplate } from './types';
import { OfficeError } from './office/http';

export async function resolveRunImages(template: LabelTemplate, value: unknown): Promise<LabelTemplate> {
  validateRunImages(value);
  const result = applyRunImages(template, value);
  for (const src of Object.values(value)) {
    try {
      const image = sharp(Buffer.from(src.slice(src.indexOf(',') + 1), 'base64'), { limitInputPixels: MAX_RUN_IMAGE_PIXELS });
      const metadata = await image.metadata();
      const expected = src.startsWith('data:image/jpeg;') ? 'jpeg' : src.startsWith('data:image/png;') ? 'png' : 'webp';
      if (metadata.format !== expected || (metadata.pages ?? 1) !== 1) throw new Error();
      await image.stats();
    } catch { throw new OfficeError('Invalid run image: use a single-frame PNG, JPEG or WebP up to 16 megapixels'); }
  }
  return result;
}
