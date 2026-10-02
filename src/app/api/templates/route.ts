import { withOfficeAuth } from "@/lib/office/guard";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { templates, formats } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

async function handleGET() {
  try {
    const allTemplates = await db.select().from(templates).orderBy(desc(templates.createdAt));
    return NextResponse.json(allTemplates);
  } catch (error) {
    console.error("Error fetching templates:", error);
    return NextResponse.json({ error: "Failed to fetch templates" }, { status: 500 });
  }
}

async function handlePOST(request: NextRequest) {
  try {
    const body = await request.json();
    const mode = body.thermalRenderMode ?? 'native-v1';
    if (!['native-v1', 'bitmap-v1'].includes(mode)) return NextResponse.json({ error: 'Invalid thermal render mode' }, { status: 400 });
    if (mode === 'bitmap-v1') {
      const [format] = await db.select().from(formats).where(eq(formats.id, body.formatId));
      if (format?.type !== 'thermal') return NextResponse.json({ error: 'Bitmap mode is thermal only' }, { status: 400 });
    }
    const now = new Date().toISOString();
    const id = `template-${Date.now()}`;

    const newTemplate = {
      id,
      ...body,
      thermalRenderMode: mode,
      elements: body.elements || [],
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(templates).values(newTemplate);
    return NextResponse.json(newTemplate, { status: 201 });
  } catch (error) {
    console.error("Error creating template:", error);
    return NextResponse.json({ error: "Failed to create template" }, { status: 500 });
  }
}

export const GET = withOfficeAuth(handleGET);

export const POST = withOfficeAuth(handlePOST);
