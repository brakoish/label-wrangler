import { validatedBody, OfficeError } from '@/lib/validation';
import { withOfficeAuth } from "@/lib/office/guard";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runPresets, runs } from "@/lib/db/schema";
import { isForeignKeyViolation, plural } from "@/lib/dbErrors";
import { eq, sql } from "drizzle-orm";

async function handleGET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [row] = await db.select().from(runPresets).where(eq(runPresets.id, id));
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    if (error instanceof OfficeError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error fetching preset:", error);
    return NextResponse.json({ error: "Failed to fetch preset" }, { status: 500 });
  }
}

async function handlePUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await validatedBody(req, 'preset', false);
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    for (const k of ['name', 'staticDefaults', 'fieldMappings', 'mappedField', 'csvColumn', 'templateId']) {
      if (k in body) updates[k] = (body as unknown as Record<string, unknown>)[k];
    }
    // Increment-use sentinel: PUT with { touch: true } bumps lastUsedAt + useCount.
    if (body.touch) {
      updates.lastUsedAt = new Date().toISOString();
      updates.useCount = sql`${runPresets.useCount} + 1`;
    }
    const [updated] = await db.update(runPresets).set(updates).where(eq(runPresets.id, id)).returning();
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof OfficeError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error updating preset:", error);
    return NextResponse.json({ error: "Failed to update preset" }, { status: 500 });
  }
}

async function handleDELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    try { await db.delete(runPresets).where(eq(runPresets.id, id)); }
    catch (error) {
      if (!isForeignKeyViolation(error)) throw error;
      const [used] = await db.select({ count: sql<number>`count(*)::int` }).from(runs).where(eq(runs.presetId, id));
      const count = Number(used?.count ?? 0);
      throw new OfficeError(`This preset was used by ${count ? plural(count, 'run') : 'saved runs'}, so it can’t be deleted. Runs keep a link to the preset they were made from.`, 409);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof OfficeError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error deleting preset:", error);
    return NextResponse.json({ error: "Failed to delete preset" }, { status: 500 });
  }
}

export const GET = withOfficeAuth(handleGET);

export const PUT = withOfficeAuth(handlePUT);

export const DELETE = withOfficeAuth(handleDELETE);
