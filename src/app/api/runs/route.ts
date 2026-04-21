import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const all = await db.select().from(runs).orderBy(desc(runs.createdAt));
    return NextResponse.json(all);
  } catch (error) {
    console.error("Error fetching runs:", error);
    return NextResponse.json({ error: "Failed to fetch runs" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const now = new Date().toISOString();
    const id = `run-${Date.now()}`;
    const newRun = {
      id,
      name: body.name,
      templateId: body.templateId,
      presetId: body.presetId ?? null,
      staticValues: body.staticValues ?? {},
      fieldMappings: body.fieldMappings ?? {},
      dataSource: body.dataSource ?? 'paste',
      sourceData: body.sourceData ?? [],
      mappedField: body.mappedField ?? null,
      status: body.status ?? 'draft',
      totalLabels: Array.isArray(body.sourceData) ? body.sourceData.length : 0,
      printedCount: 0,
      notes: body.notes ?? null,
      pinnedAt: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    await db.insert(runs).values(newRun);
    return NextResponse.json(newRun, { status: 201 });
  } catch (error) {
    console.error("Error creating run:", error);
    return NextResponse.json({ error: "Failed to create run" }, { status: 500 });
  }
}
