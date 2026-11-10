import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

let cached: string | null | undefined;

/**
 * One short, stable id for the deployed build, the same on every server of
 * that deployment. It is hashed, so no commit or deployment name is shown.
 * Null when it can't tell (local development): then no page ever asks for a
 * reload.
 */
export function buildStamp(): string | null {
  if (cached !== undefined) return cached;
  let raw = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_DEPLOYMENT_ID || '';
  if (!raw) {
    try { raw = readFileSync(path.join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim(); } catch { raw = ''; }
  }
  cached = raw ? createHash('sha256').update(raw).digest('hex').slice(0, 16) : null;
  return cached;
}
