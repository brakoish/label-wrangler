import { validatedBody, OfficeError } from '@/lib/validation';
import { randomUUID } from 'node:crypto';
import { withOfficeAuth } from "@/lib/office/guard";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { formats } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

async function handleGET(request: NextRequest) {
  try {
    const offset = Math.max(0, Math.min(100000, Math.floor(Number(new URL(request.url).searchParams.get('offset'))) || 0));
    const allFormats = await db.select().from(formats).orderBy(desc(formats.createdAt)).limit(50).offset(offset);
    return NextResponse.json(allFormats);
  } catch (error) {
    if (error instanceof OfficeError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error fetching formats:", error);
    return NextResponse.json({ error: "Failed to fetch formats" }, { status: 500 });
  }
}

async function handlePOST(request: NextRequest) {
  try {
    const body = await validatedBody(request, 'format', true);
    const now = new Date().toISOString();
    const id = `format-${randomUUID()}`;

    const newFormat = {
      ...body,
      id,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(formats).values(newFormat);
    return NextResponse.json(newFormat, { status: 201 });
  } catch (error) {
    if (error instanceof OfficeError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error creating format:", error);
    return NextResponse.json({ error: "Failed to create format" }, { status: 500 });
  }
}

export const GET = withOfficeAuth(handleGET);

export const POST = withOfficeAuth(handlePOST);
