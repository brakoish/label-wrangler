import type { LabelTemplate } from './types';

// Library-only cache: never hydrate the editable store with background responses.
export function createTemplatePreviewLoader() {
  const cache = new Map<string, { template: LabelTemplate; bytes: number }>();
  const pending = new Map<string, Promise<LabelTemplate>>();
  const queue: Array<() => void> = [];
  let active = 0;
  let bytes = 0;
  const pump = () => {
    while (active < 3 && queue.length) queue.shift()!();
  };
  return (summary: LabelTemplate): Promise<LabelTemplate> => {
    const key = JSON.stringify([summary.id, summary.updatedAt]);
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key); cache.set(key, cached);
      return Promise.resolve(cached.template);
    }
    const existing = pending.get(key);
    if (existing) return existing;
    const request = new Promise<LabelTemplate>((resolve, reject) => {
      queue.push(() => {
        active++;
        void (async () => {
          try {
            const response = await fetch('/api/templates/' + encodeURIComponent(summary.id), { signal: AbortSignal.timeout(20_000), cache: 'no-store' });
            if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to load previews' : 'Unable to load preview');
            const template: LabelTemplate = await response.json();
            if (template.id !== summary.id || template.summaryOnly || !Array.isArray(template.elements)) throw new Error('Incomplete preview response');
            const size = JSON.stringify(template).length * 2;
            // A stale list may fetch a newer revision; don't cache it as the old revision.
            if (template.updatedAt === summary.updatedAt && size <= 8_000_000) {
              cache.set(key, { template, bytes: size }); bytes += size;
              while (cache.size > 24 || bytes > 8_000_000) {
                const oldest = cache.keys().next().value!;
                bytes -= cache.get(oldest)!.bytes; cache.delete(oldest);
              }
            }
            resolve(template);
          } catch (error) { reject(error); }
          finally { pending.delete(key); active--; pump(); }
        })();
      });
    });
    pending.set(key, request);
    pump();
    return request;
  };
}

export const loadTemplatePreview = createTemplatePreviewLoader();
