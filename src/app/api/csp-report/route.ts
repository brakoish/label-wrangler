import { summarizeCspReports } from '@/lib/cspReport';

// Receives report-only CSP violations from browsers (report-uri in
// next.config.ts) and logs a trimmed summary. No database and no auth:
// browsers send these on their own. Rate-safe: bodies are capped, at most
// MAX_LOGS reports are logged per minute per instance, and the reply is
// always an empty 204 so nothing is reflected back.
const MAX_BYTES = 16_384;
const MAX_LOGS = 20;
const WINDOW_MS = 60_000;
let windowStart = 0;
let logged = 0;
let dropped = 0;

function allowLog(now: number) {
  if (now - windowStart >= WINDOW_MS) {
    if (dropped) console.warn(`CSP report-only: ${dropped} more report${dropped === 1 ? '' : 's'} not logged in the last minute`);
    windowStart = now; logged = 0; dropped = 0;
  }
  if (logged < MAX_LOGS) { logged++; return true; }
  dropped++;
  return false;
}

async function readCapped(req: Request): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const noContent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: Request) {
  try {
    const type = req.headers.get('content-type') ?? '';
    if (!/^application\/(csp-report|reports\+json|json)\b/i.test(type)) return noContent();
    if (!allowLog(Date.now())) { await req.body?.cancel().catch(() => {}); return noContent(); }
    const text = await readCapped(req);
    if (!text) return noContent();
    for (const line of summarizeCspReports(JSON.parse(text))) console.warn(`CSP report-only: ${line}`);
  } catch { /* malformed report: ignore */ }
  return noContent();
}
