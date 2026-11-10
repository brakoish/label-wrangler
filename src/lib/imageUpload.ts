/** Client-side preparation of designer image uploads: type check, size check
 * and downscale before the image is stored inline in the template. */
export const IMAGE_MAX_SIDE = 1200;
export const IMAGE_MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Stored data URLs above this are rejected by the API (validation.ts src limit). */
export const IMAGE_MAX_DATA_URL = 3_000_000;
const RASTER = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const UNSUPPORTED_IMAGE_MESSAGE = 'That file type is not supported. Use a PNG, JPEG, WebP, GIF or SVG image. (iPhone HEIC photos: export or share as JPEG first.)';

/** A plain-language problem with the file, or null when it can be used. */
export function imageUploadProblem(file: { type: string; size: number }): string | null {
  if (![...RASTER, 'image/svg+xml'].includes(file.type)) return UNSUPPORTED_IMAGE_MESSAGE;
  if (file.size > IMAGE_MAX_FILE_BYTES) return 'That image is larger than 25 MB. Use a smaller file.';
  if (file.type === 'image/svg+xml' && file.size > 1_000_000) return 'That SVG is larger than 1 MB. Use a simpler SVG or a PNG.';
  return null;
}
/** Size that fits within maxSide on the longest side. Never upscales. */
export function fitWithin(width: number, height: number, maxSide = IMAGE_MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!(longest > maxSide)) return { width, height };
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that image file.'));
    reader.readAsDataURL(blob);
  });
}
/** Returns a data URL ready to store, or throws an Error with a friendly message. */
export async function prepareDesignerImage(file: File): Promise<string> {
  const problem = imageUploadProblem(file);
  if (problem) throw new Error(problem);
  if (file.type === 'image/svg+xml') return readDataUrl(file);
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('That image could not be opened. It may be damaged or in an unsupported format. Try saving it as PNG or JPEG.'); }
  try {
    const target = fitWithin(bitmap.width, bitmap.height);
    const unchanged = target.width === bitmap.width && target.height === bitmap.height;
    // Small images that need no resize are stored exactly as uploaded.
    if (unchanged && file.type !== 'image/gif' && file.size <= 1_500_000) return readDataUrl(file);
    const canvas = document.createElement('canvas');
    canvas.width = target.width; canvas.height = target.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not resize the image.');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, target.width, target.height);
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'; // keep transparency
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, 0.92));
    if (!blob) throw new Error('This browser could not resize the image.');
    const dataUrl = await readDataUrl(blob);
    if (dataUrl.length > IMAGE_MAX_DATA_URL) throw new Error('That image is still too large after resizing. Use a simpler image or a JPEG.');
    return dataUrl;
  } finally { bitmap.close(); }
}
