import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runPresets } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const all = await db.select().from(runPresets).orderBy(desc(runPresets.lastUsedAt));
    return NextResponse.json(all);
  } catch (error) {
    console.error("Error fetching presets:", error);
    return NextResponse.json({ error: "Failed to fetch presets" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const now = new Date().toISOString();
    const id = `preset-${Date.now()}`;
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
    console.error("Error creating preset:", error);
    return NextResponse.json({ error: "Failed to create preset" }, { status: 500 });
  }
}
