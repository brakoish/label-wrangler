export class OfficeError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function failure(error: unknown) {
  if (error instanceof OfficeError) return json({ error: error.message }, error.status);
  console.error('Office printing request failed:', error instanceof Error ? error.message : 'Unknown error');
  return json({ error: 'Office printing request failed. No automatic retry was created.' }, 500);
}
export async function body(req: Request, maxBytes = 32_768): Promise<Record<string, unknown>> {
  if (!req.headers.get('content-type')?.startsWith('application/json')) throw new OfficeError('Expected application/json', 415);
  const reader = req.body?.getReader();
  if (!reader) throw new OfficeError('Missing request body');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > maxBytes) { await reader.cancel(); throw new OfficeError('Request too large', 413); }
    chunks.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new OfficeError('Invalid JSON object'); }
}
export function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  const expected = process.env.OFFICE_APP_ORIGIN || 'https://label-wrangler.vercel.app';
  if (origin !== expected) throw new OfficeError('Request origin not allowed', 403);
}
