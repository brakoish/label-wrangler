import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { templates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await db.delete(templates).where(eq(templates.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting template:", error);
    return NextResponse.json({ error: "Failed to delete template" }, { status: 500 });
  }
}
