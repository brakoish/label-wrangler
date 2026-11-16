import { and, eq, inArray } from 'drizzle-orm';
import { body, json, browserFailure, OfficeError } from '@/lib/office/http';
import { officeSql } from '@/lib/office/db';
import { db } from '@/lib/db';
import { runs } from '@/lib/db/schema';
import { requireKiosk } from '@/lib/kiosk/server';
import { isMissingTable } from '@/lib/kiosk/plan';

/**
 * PUT { stage: 'approved' | 'stopped' }: staff's answer to "Do these 12 labels
 * look right?". Only a test print waiting for that answer changes; the same
 * answer twice is fine. Stopping also pauses the run, so Runs shows it's
 * waiting for someone.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireKiosk(req);
    const { id } = await params;
    if (!id || id.length > 200) throw new OfficeError('Invalid run');
    const data = await body(req, 1024);
    if (data.stage !== 'approved' && data.stage !== 'stopped') throw new OfficeError('Invalid answer');
    const sql = officeSql();
    let updated;
    try {
      updated = await sql`UPDATE kiosk_runs SET stage=${data.stage}, updated_at=now() WHERE run_id=${id} AND stage IN ('test', ${data.stage}) RETURNING stage`;
      if (!updated.length) {
        const [now] = await sql`SELECT stage FROM kiosk_runs WHERE run_id=${id}`;
        if (!now) throw new OfficeError('This print wasn’t made at the kiosk.', 404);
        throw new OfficeError(now.stage === 'stopped' ? 'This print was already stopped.' : 'This print was already approved.', 409);
      }
    } catch (error) {
      if (isMissingTable(error)) throw new OfficeError('Kiosk mode isn’t set up yet. Ask a manager.', 409);
      throw error;
    }
    if (data.stage === 'stopped') {
      await db.update(runs).set({ status: 'paused', updatedAt: new Date().toISOString() }).where(and(eq(runs.id, id), inArray(runs.status, ['draft', 'queued', 'printing'])));
    }
    return json({ stage: updated[0].stage });
  } catch (error) { return browserFailure(error); }
}
