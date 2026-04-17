import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { templates } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const allTemplates = await db.select().from(templates).orderBy(desc(templates.createdAt));
    return NextResponse.json(allTemplates);
  } catch (error) {
    console.error("Error fetching templates:", error);
    return NextResponse.json({ error: "Failed to fetch templates" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const now = new Date().toISOString();
    const id = `template-${Date.now()}`;

    const newTemplate = {
      id,
      ...body,
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
