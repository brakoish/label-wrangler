import { validatedBody, OfficeError } from '@/lib/validation';
import { randomUUID } from 'node:crypto';
import { withOfficeAuth } from "@/lib/office/guard";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { globalElements } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

async function handleGET(request: NextRequest) {
  try {
    const offset = Math.max(0, Math.min(100000, Math.floor(Number(new URL(request.url).searchParams.get('offset'))) || 0));
    const all = await db.select().from(globalElements).orderBy(desc(globalElements.createdAt)).limit(50).offset(offset);
    return NextResponse.json(all);
  } catch (error) {
    if (error instanceof OfficeError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error fetching global elements:", error);
    return NextResponse.json({ error: "Failed to fetch global elements" }, { status: 500 });
  }
}

async function handlePOST(request: NextRequest) {
  try {
    const body = await validatedBody(request, 'global', true);
    const now = new Date().toISOString();
    const id = `ge-${randomUUID()}`;
    const newEntry = {
      id,
      name: body.name,
      description: body.description ?? null,
      elements: body.elements ?? [],
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(globalElements).values(newEntry);
    return NextResponse.json(newEntry, { status: 201 });
  } catch (error) {
    if (error instanceof OfficeError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error creating global element:", error);
    return NextResponse.json({ error: "Failed to create global element" }, { status: 500 });
  }
}

export const GET = withOfficeAuth(handleGET);

export const POST = withOfficeAuth(handlePOST);
