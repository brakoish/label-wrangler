import { loadRunWithDesign } from '@/lib/runDesign.server';
import { validatedBody, OfficeError } from '@/lib/validation';
import { randomUUID } from 'node:crypto';
import { withOfficeAuth } from "@/lib/office/guard";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import { eq, sql, getTableColumns } from "drizzle-orm";

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

async function handlePUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await validatedBody(req, 'run', false);
    const [current] = await db.select({totalLabels:runs.totalLabels,printedCount:runs.printedCount}).from(runs).where(eq(runs.id,id));
    if (!current) throw new OfficeError('Run not found',404);
    const total = Array.isArray(body.sourceData) ? body.sourceData.length : current.totalLabels;
    if (body.printedCount !== undefined && Number(body.printedCount) > total) throw new OfficeError('Progress exceeds run length');
    if (body.totalLabels !== undefined && body.totalLabels !== total) throw new OfficeError('Label count must match source rows');
    if (body.templateId !== undefined) throw new OfficeError('Create a new run to change its design');
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
    if (body.progressOnly === true && body.printedCount !== undefined) updates.printedCount = sql`greatest(${runs.printedCount}, ${Number(body.printedCount)})`;
    const { sourceData: _source, designSnapshot: _design, ...summary } = getTableColumns(runs);
    const [updated] = await db.update(runs).set(updates).where(eq(runs.id, id)).returning(summary);
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
    await db.delete(runs).where(eq(runs.id, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof OfficeError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error deleting run:", error);
    return NextResponse.json({ error: "Failed to delete run" }, { status: 500 });
  }
}

export const GET = withOfficeAuth(handleGET);

export const PUT = withOfficeAuth(handlePUT);

export const DELETE = withOfficeAuth(handleDELETE);
