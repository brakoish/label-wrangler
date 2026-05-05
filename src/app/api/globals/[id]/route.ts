import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { globalElements } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [row] = await db.select().from(globalElements).where(eq(globalElements.id, id));
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    console.error("Error fetching global element:", error);
    return NextResponse.json({ error: "Failed to fetch global element" }, { status: 500 });
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
    const updates: Record<string, unknown> = { updatedAt: now };
    for (const k of ["name", "description", "elements"]) {
      if (k in body) updates[k] = (body as Record<string, unknown>)[k];
    }
    const [updated] = await db
      .update(globalElements)
      .set(updates)
      .where(eq(globalElements.id, id))
      .returning();
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating global element:", error);
    return NextResponse.json({ error: "Failed to update global element" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await db.delete(globalElements).where(eq(globalElements.id, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting global element:", error);
    return NextResponse.json({ error: "Failed to delete global element" }, { status: 500 });
  }
}
