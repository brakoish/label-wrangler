import { NextResponse } from 'next/server';
import { buildStamp } from '@/lib/buildStamp.server';

export const dynamic = 'force-dynamic';

/**
 * Which build the server is running, so a page left open across a deploy can
 * say "A new version is ready — reload". Read-only, no data, no database.
 */
export async function GET() {
  return NextResponse.json({ build: buildStamp() }, { headers: { 'Cache-Control': 'no-store' } });
}
