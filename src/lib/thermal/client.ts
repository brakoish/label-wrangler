import type { LabelFormat, LabelTemplate } from '../types';
import type { FeedValues } from './bitmap';
export type EditorLayer = { elementId: string; x: number; y: number; width: number; height: number; url: string };
export type BitmapResult = { advisories?: Array<{ elementId: string; message: string }>; editorLayers?: EditorLayer[]; version: string; width: number; height: number; inputDigest: string; pixelDigest: string; packed: string; proof: string; zpl: string; qrInkBounds?: Record<string, { x: number; y: number; width: number; height: number }>; qrBounds?: Record<string, { x: number; y: number; width: number; height: number }>; warnings?: Array<{ elementId: string; message: string }> };
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
      cacheBytes += key.length + result.zpl.length + result.proof.length + result.packed.length + JSON.stringify(result.editorLayers || []).length;
      if (cacheBytes > 8_000_000 || cache.size > 24) { cache.clear(); cacheBytes = 0; }
      return result;
    }).catch(error => { cache.delete(key); throw error; });
  cache.set(key, request);
  return request;
}

/** Bounded range requests, separate from the small interactive preview cache. */
export async function getBitmapProofBatch(template: LabelTemplate, format: LabelFormat, feeds: FeedValues[], signal?: AbortSignal): Promise<BitmapResult[]> {
  const response = await fetch('/api/thermal/render', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(55_000)]) : AbortSignal.timeout(55_000),
    body: JSON.stringify({ template, format, feeds }),
  });
  const data = await response.json();
  // Larger artwork may exceed the response cap even with eight feeds.
  if (!response.ok && feeds.length > 1 && /response too large/.test(data.error || '')) {
    const middle = Math.ceil(feeds.length / 2);
    return [...await getBitmapProofBatch(template, format, feeds.slice(0, middle), signal),
      ...await getBitmapProofBatch(template, format, feeds.slice(middle), signal)];
  }
  if (!response.ok) throw new Error(data.error || 'Bitmap proof failed');
  if (!Array.isArray(data.results) || data.results.length !== feeds.length) throw new Error('Incomplete bitmap proof response');
  return data.results;
}
