import { withOfficeAuth } from "@/lib/office/guard";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { templates, formats } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

async function handleGET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const template = await db.select().from(templates).where(eq(templates.id, id));

    if (template.length === 0) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json(template[0]);
  } catch (error) {
    console.error("Error fetching template:", error);
    return NextResponse.json({ error: "Failed to fetch template" }, { status: 500 });
  }
}

async function handlePUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    if (body.thermalRenderMode !== undefined) {
      if (!['native-v1', 'bitmap-v1'].includes(body.thermalRenderMode)) return NextResponse.json({ error: 'Invalid thermal render mode' }, { status: 400 });
      const [current] = await db.select().from(templates).where(eq(templates.id, id));
      if (current && current.thermalRenderMode !== body.thermalRenderMode) return NextResponse.json({ error: 'Duplicate and convert to preserve existing runs' }, { status: 409 });
    }
    if (body.formatId) {
      const [current] = await db.select().from(templates).where(eq(templates.id, id));
      const [format] = await db.select().from(formats).where(eq(formats.id, body.formatId));
      if (current?.thermalRenderMode === 'bitmap-v1' && format?.type !== 'thermal') return NextResponse.json({ error: 'Bitmap mode is thermal only' }, { status: 400 });
    }
    const now = new Date().toISOString();

    await db
      .update(templates)
      .set({ ...body, updatedAt: now })
      .where(eq(templates.id, id));

    const updated = await db.select().from(templates).where(eq(templates.id, id));

    if (updated.length === 0) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json(updated[0]);
  } catch (error) {
    console.error("Error updating template:", error);
    return NextResponse.json({ error: "Failed to update template" }, { status: 500 });
  }
}

async function handleDELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // Preserve references from saved runs and presets; DELETE archives only.
    const [archived] = await db.update(templates)
      .set({ archivedAt: new Date().toISOString() })
      .where(eq(templates.id, id)).returning();
    if (!archived) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    return NextResponse.json(archived);
  } catch (error) {
    console.error("Error archiving template:", error);
    return NextResponse.json({ error: "Failed to archive template" }, { status: 500 });
  }
}

export const GET = withOfficeAuth(handleGET);

export const PUT = withOfficeAuth(handlePUT);

export const DELETE = withOfficeAuth(handleDELETE);
