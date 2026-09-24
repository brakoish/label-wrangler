import type { LabelFormat, LabelTemplate } from '../types';
import type { FeedValues } from './bitmap';
export type BitmapResult = { version: string; width: number; height: number; inputDigest: string; pixelDigest: string; packed: string; proof: string; zpl: string; warnings?: Array<{ elementId: string; message: string }> };
// Coalesce identical editor/print requests; bound retained results, including keys.
const cache = new Map<string, Promise<BitmapResult>>();
let cacheBytes = 0;
export async function getBitmapProof(template: LabelTemplate, format: LabelFormat, values: FeedValues = {}, editing = false): Promise<BitmapResult> {
  const key = JSON.stringify([template.elements, template.thermalRenderMode, format, values, editing]);
  const found = cache.get(key); if (found) return found;
  const request = fetch('/api/thermal/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template, format, feeds: [values], editing }) })
    .then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Bitmap proof failed');
      const result: BitmapResult = data.results[0];
      cacheBytes += key.length + result.zpl.length + result.proof.length + result.packed.length;
      if (cacheBytes > 8_000_000 || cache.size > 24) { cache.clear(); cacheBytes = 0; }
      return result;
    }).catch(error => { cache.delete(key); throw error; });
  cache.set(key, request);
  return request;
}
