import { validatedBody, OfficeError } from '@/lib/validation';
import { randomUUID } from 'node:crypto';
import { withOfficeAuth } from "@/lib/office/guard";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runPresets } from "@/lib/db/schema";
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
    await db.delete(runPresets).where(eq(runPresets.id, id));
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
