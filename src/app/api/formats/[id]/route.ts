import { validatedBody, OfficeError } from '@/lib/validation';
import { randomUUID } from 'node:crypto';
import { withOfficeAuth } from "@/lib/office/guard";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { formats, templates } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { isForeignKeyViolation, plural } from "@/lib/dbErrors";

async function handleGET(
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
    if (error instanceof OfficeError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error fetching format:", error);
    return NextResponse.json({ error: "Failed to fetch format" }, { status: 500 });
  }
}

async function handlePUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await validatedBody(request, 'format', false);
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
    if (error instanceof OfficeError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error updating format:", error);
    return NextResponse.json({ error: "Failed to update format" }, { status: 500 });
  }
}

async function handleDELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    try { await db.delete(formats).where(eq(formats.id, id)); }
    catch (error) {
      if (!isForeignKeyViolation(error)) throw error;
      const [used] = await db.select({ count: sql<number>`count(*)::int`, archived: sql<number>`count(${templates.archivedAt})::int` }).from(templates).where(eq(templates.formatId, id));
      const count = Number(used?.count ?? 0), archived = Number(used?.archived ?? 0);
      throw new OfficeError(`This format is used by ${count ? plural(count, 'design') : 'saved designs'}${archived ? ` (${archived} archived)` : ''}. Delete or move those first.`, 409);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof OfficeError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error deleting format:", error);
    return NextResponse.json({ error: "Failed to delete format" }, { status: 500 });
  }
}

export const GET = withOfficeAuth(handleGET);

export const PUT = withOfficeAuth(handlePUT);

export const DELETE = withOfficeAuth(handleDELETE);
