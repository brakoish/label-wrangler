import { requireUser } from '@/lib/office/auth';
import { body, json, failure, OfficeError } from '@/lib/office/http';
import { bitmapCopy } from '@/lib/thermal/import';
import { fitBitmapCopy, renderThermalBitmap } from '@/lib/thermal/render.server';
import type { LabelFormat, LabelTemplate } from '@/lib/types';
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    await requireUser(req, 'read');
    const data = await body(req, 4_000_000);
    if (!data.template || !data.format || !Array.isArray((data.template as LabelTemplate).elements)) throw new OfficeError('Template and format required');
    const values = data.values ?? {};
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.values(values).some(v => typeof v !== 'string' || v.length > 8192)) throw new OfficeError('Invalid sample values');
    const format = data.format as LabelFormat;
    const result = await fitBitmapCopy(bitmapCopy(data.template as LabelTemplate, format), format, values as Record<string, string>);
    const proof = await renderThermalBitmap(result.template, format, values as Record<string, string>, true);
    return json({ ...result, proof: proof.proof, warnings: proof.warnings });
  } catch (error) { return failure(error instanceof OfficeError ? error : new OfficeError(error instanceof Error ? error.message : 'Conversion failed')); }
}
