import { requireUser } from '@/lib/office/auth';
import { body, json, failure, OfficeError } from '@/lib/office/http';
import { renderThermalBitmap } from '@/lib/thermal/render.server';
import type { LabelFormat, LabelTemplate } from '@/lib/types';
import type { FeedValues } from '@/lib/thermal/bitmap';
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    await requireUser(req, 'read');
    const data = await body(req, 4_000_000);
    if (!data.template || !data.format || !Array.isArray(data.feeds) || data.feeds.length < 1 || data.feeds.length > 8) throw new OfficeError('Choose 1–8 feeds per render');
    const results = []; let bytes = 0;
    for (const feed of data.feeds) {
      const result = await renderThermalBitmap(data.template as LabelTemplate, data.format as LabelFormat, feed as FeedValues, data.editing === true);
      bytes += result.zpl.length + result.proof.length + result.packed.length;
      if (bytes > 3_500_000) throw new OfficeError('Bitmap response too large; render fewer or smaller feeds');
      results.push(result);
    }
    return json({ results });
  } catch (error) { return failure(error instanceof OfficeError ? error : new OfficeError(error instanceof Error ? error.message : 'Bitmap rendering failed')); }
}
