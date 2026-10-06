import { validatedBody, OfficeError } from '@/lib/validation';
import { randomUUID } from 'node:crypto';
import { withOfficeAuth } from "@/lib/office/guard";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runPresets } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

async function handleGET(request: NextRequest) {
  try {
    const offset = Math.max(0, Math.min(100000, Math.floor(Number(new URL(request.url).searchParams.get('offset'))) || 0));
    const all = await db.select().from(runPresets).orderBy(desc(runPresets.lastUsedAt)).limit(50).offset(offset);
    return NextResponse.json(all);
  } catch (error) {
    if (error instanceof OfficeError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error fetching presets:", error);
    return NextResponse.json({ error: "Failed to fetch presets" }, { status: 500 });
  }
}

async function handlePOST(request: NextRequest) {
  try {
    const body = await validatedBody(request, 'preset', true);
    const now = new Date().toISOString();
    const id = `preset-${randomUUID()}`;
    const newPreset = {
      id,
      name: body.name,
      templateId: body.templateId,
      staticDefaults: body.staticDefaults ?? {},
      fieldMappings: body.fieldMappings ?? {},
      mappedField: body.mappedField ?? null,
      csvColumn: body.csvColumn ?? null,
      lastUsedAt: null,
      useCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(runPresets).values(newPreset);
    return NextResponse.json(newPreset, { status: 201 });
  } catch (error) {
    if (error instanceof OfficeError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error creating preset:", error);
    return NextResponse.json({ error: "Failed to create preset" }, { status: 500 });
  }
}

export const GET = withOfficeAuth(handleGET);

export const POST = withOfficeAuth(handlePOST);
