import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { formats } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const allFormats = await db.select().from(formats).orderBy(desc(formats.createdAt));
    return NextResponse.json(allFormats);
  } catch (error) {
    console.error("Error fetching formats:", error);
    return NextResponse.json({ error: "Failed to fetch formats" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const now = new Date().toISOString();
    const id = `format-${Date.now()}`;

    const newFormat = {
      id,
      ...body,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(formats).values(newFormat);
    return NextResponse.json(newFormat, { status: 201 });
  } catch (error) {
    console.error("Error creating format:", error);
    return NextResponse.json({ error: "Failed to create format" }, { status: 500 });
  }
}
