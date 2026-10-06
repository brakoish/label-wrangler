import { validatedBody, OfficeError } from '@/lib/validation';
import { randomUUID } from 'node:crypto';
import { withOfficeAuth } from "@/lib/office/guard";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { templates, formats } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";

async function handleGET(request: NextRequest) {
  try {
    const offset = Math.max(0, Math.min(100000, Math.floor(Number(new URL(request.url).searchParams.get('offset'))) || 0));
    const allTemplates = await db.select({id:templates.id,name:templates.name,description:templates.description,formatId:templates.formatId,thermalRenderMode:templates.thermalRenderMode,archivedAt:templates.archivedAt,createdAt:templates.createdAt,updatedAt:templates.updatedAt,elements:sql`'[]'::jsonb`,summaryOnly:sql`true`,elementCount:sql`jsonb_array_length(${templates.elements})`,dynamicCount:sql`(select count(*)::int from jsonb_array_elements(${templates.elements}) e where e->>'isStatic' = 'false')`}).from(templates).orderBy(desc(templates.createdAt)).limit(50).offset(offset);
    return NextResponse.json(allTemplates);
  } catch (error) {
    if (error instanceof OfficeError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error fetching templates:", error);
    return NextResponse.json({ error: "Failed to fetch templates" }, { status: 500 });
  }
}

async function handlePOST(request: NextRequest) {
  try {
    const body = await validatedBody(request, 'template', true);
    const mode = body.thermalRenderMode ?? 'native-v1';
    if (!['native-v1', 'bitmap-v1'].includes(mode)) return NextResponse.json({ error: 'Invalid thermal render mode' }, { status: 400 });
    if (mode === 'bitmap-v1') {
      const [format] = await db.select().from(formats).where(eq(formats.id, body.formatId));
      if (format?.type !== 'thermal') return NextResponse.json({ error: 'Bitmap mode is thermal only' }, { status: 400 });
    }
    const now = new Date().toISOString();
    const id = `template-${randomUUID()}`;

    const newTemplate = {
      ...body,
      id,
      thermalRenderMode: mode,
      elements: body.elements || [],
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(templates).values(newTemplate);
    return NextResponse.json(newTemplate, { status: 201 });
  } catch (error) {
    if (error instanceof OfficeError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error creating template:", error);
    return NextResponse.json({ error: "Failed to create template" }, { status: 500 });
  }
}

export const GET = withOfficeAuth(handleGET);

export const POST = withOfficeAuth(handlePOST);
