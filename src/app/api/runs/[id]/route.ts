import { loadRunWithDesign } from '@/lib/runDesign.server';
import { validatedBody, OfficeError } from '@/lib/validation';
import { withOfficeAuth, officeUserFor } from "@/lib/office/guard";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runs, runPrintEvents, officeRequests } from "@/lib/db/schema";
import { isForeignKeyViolation, plural } from "@/lib/dbErrors";
import { and, eq, sql, getTableColumns } from "drizzle-orm";
import { followsCurrentRules, keepsHighWater } from "@/lib/runClientVersion";

async function handleGET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const row = await loadRunWithDesign(id);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    if (error instanceof OfficeError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error fetching run:", error);
    return NextResponse.json({ error: "Failed to fetch run" }, { status: 500 });
  }
}

const PROGRESS_FIELDS = new Set(['printedCount', 'status', 'completedAt', 'progressOnly', 'resetProgress', 'expectedPrintedCount']);

async function handlePUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await validatedBody(req, 'run', false);
    // Recording print progress is printing work; anything else edits the run.
    if (Object.keys(body).some(key => !PROGRESS_FIELDS.has(key)) && !officeUserFor(req)?.can_edit) throw new OfficeError('Your account does not have permission', 403);
    const [current] = await db.select({totalLabels:runs.totalLabels,printedCount:runs.printedCount}).from(runs).where(eq(runs.id,id));
    if (!current) throw new OfficeError('Run not found',404);
    const total = Array.isArray(body.sourceData) ? body.sourceData.length : current.totalLabels;
    if (body.printedCount !== undefined && Number(body.printedCount) > total) throw new OfficeError('Progress exceeds run length');
    if (body.totalLabels !== undefined && body.totalLabels !== total) throw new OfficeError('Label count must match source rows');
    if (body.templateId !== undefined) throw new OfficeError('Create a new run to change its design');
    if (body.expectedPrintedCount !== undefined && body.resetProgress !== true) throw new OfficeError('expectedPrintedCount only goes with resetProgress');
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    // Only copy known fields.
    for (const k of ['name', 'staticValues', 'fieldMappings', 'sourceData', 'mappedField', 'status',
                     'totalLabels', 'printedCount', 'notes', 'completedAt', 'dataSource',
                     'pinnedAt']) {
      if (k in body) updates[k] = (body as unknown as Record<string, unknown>)[k];
    }
    // Convenience shortcut: clients can send `{ pinned: true|false }` and the
    // server sets/clears the pinnedAt timestamp instead of computing it on
    // the client. Keeps the clock authoritative.
    if ('pinned' in body) {
      updates.pinnedAt = body.pinned ? new Date().toISOString() : null;
    }
    if ('sourceData' in body && Array.isArray(body.sourceData)) {
      updates.totalLabels = body.sourceData.length;
    }
    // Progress is a high-water mark for current code: an older or
    // out-of-order update (a sheet tab confirmed late, a delayed outbox
    // entry) can never lower it, and only an explicit rewind (resetProgress)
    // moves the resume position backwards. A tab still running the code from
    // before this rule (no X-LW-Client header) keeps its exact writes, so its
    // "Reprint from" and "Reprint all" still go back instead of being ignored.
    if (keepsHighWater(followsCurrentRules(req.headers, body as unknown as Record<string, unknown>), body as unknown as Record<string, unknown>)) updates.printedCount = sql`greatest(${runs.printedCount}, ${Number(body.printedCount)})`;
    const { sourceData: _source, designSnapshot: _design, ...summary } = getTableColumns(runs);
    // A rewind can say which progress it saw (expectedPrintedCount). It then
    // applies only if the stored count still matches, in the same statement,
    // so a "go back" that arrives late never erases progress another device
    // made in the meantime. Without it, the update behaves as before.
    const guarded = body.resetProgress === true && typeof body.expectedPrintedCount === 'number';
    const where = guarded ? and(eq(runs.id, id), eq(runs.printedCount, Number(body.expectedPrintedCount))) : eq(runs.id, id);
    const [updated] = await db.update(runs).set(updates).where(where).returning(summary);
    if (!updated && guarded) {
      const [now] = await db.select({ printedCount: runs.printedCount }).from(runs).where(eq(runs.id, id));
      if (now) return NextResponse.json({ error: `This run’s progress changed on another device (now ${Number(now.printedCount).toLocaleString('en-US')} printed), so going back wasn’t applied.`, code: 'progress_changed', printedCount: Number(now.printedCount) }, { status: 409 });
    }
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ...updated, ...(body.sourceData ? {sourceData:body.sourceData} : {}) });
  } catch (error) {
    if (error instanceof OfficeError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error updating run:", error);
    return NextResponse.json({ error: "Failed to update run" }, { status: 500 });
  }
}

async function handleDELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    try { await db.delete(runs).where(eq(runs.id, id)); }
    catch (error) {
      if (!isForeignKeyViolation(error)) throw error;
      const [events] = await db.select({ count: sql<number>`count(*)::int` }).from(runPrintEvents).where(eq(runPrintEvents.runId, id));
      const [office] = await db.select({ count: sql<number>`count(*)::int` }).from(officeRequests).where(eq(officeRequests.runId, id));
      const count = Number(events?.count ?? 0) + Number(office?.count ?? 0);
      throw new OfficeError(`This run has print history (${count ? plural(count, 'print record') : 'saved print records'}), so it can't be deleted. It stays in your list so that history is kept.`, 409);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof OfficeError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error deleting run:", error);
    return NextResponse.json({ error: "Failed to delete run" }, { status: 500 });
  }
}

export const GET = withOfficeAuth(handleGET);

export const PUT = withOfficeAuth(handlePUT, 'print-or-edit');

export const DELETE = withOfficeAuth(handleDELETE);
