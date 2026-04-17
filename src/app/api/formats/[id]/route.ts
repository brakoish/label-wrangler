import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { formats } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const format = await db.select().from(formats).where(eq(formats.id, id));

    if (format.length === 0) {
      return NextResponse.json({ error: "Format not found" }, { status: 404 });
    }

    return NextResponse.json(format[0]);
  } catch (error) {
    console.error("Error fetching format:", error);
    return NextResponse.json({ error: "Failed to fetch format" }, { status: 500 });
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
      .update(formats)
      .set({ ...body, updatedAt: now })
      .where(eq(formats.id, id));

    const updated = await db.select().from(formats).where(eq(formats.id, id));

    if (updated.length === 0) {
      return NextResponse.json({ error: "Format not found" }, { status: 404 });
    }

    return NextResponse.json(updated[0]);
  } catch (error) {
    console.error("Error updating format:", error);
    return NextResponse.json({ error: "Failed to update format" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await db.delete(formats).where(eq(formats.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting format:", error);
    return NextResponse.json({ error: "Failed to delete format" }, { status: 500 });
  }
}
