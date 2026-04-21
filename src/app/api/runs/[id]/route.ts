import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [row] = await db.select().from(runs).where(eq(runs.id, id));
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    console.error("Error fetching run:", error);
    return NextResponse.json({ error: "Failed to fetch run" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    // Only copy known fields.
    for (const k of ['name', 'staticValues', 'fieldMappings', 'sourceData', 'mappedField', 'status',
                     'totalLabels', 'printedCount', 'notes', 'completedAt', 'dataSource',
                     'pinnedAt']) {
      if (k in body) updates[k] = (body as Record<string, unknown>)[k];
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
    const [updated] = await db.update(runs).set(updates).where(eq(runs.id, id)).returning();
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating run:", error);
    return NextResponse.json({ error: "Failed to update run" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await db.delete(runs).where(eq(runs.id, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting run:", error);
    return NextResponse.json({ error: "Failed to delete run" }, { status: 500 });
  }
}
