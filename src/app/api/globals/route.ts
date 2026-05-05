import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { globalElements } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const all = await db.select().from(globalElements).orderBy(desc(globalElements.createdAt));
    return NextResponse.json(all);
  } catch (error) {
    console.error("Error fetching global elements:", error);
    return NextResponse.json({ error: "Failed to fetch global elements" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const now = new Date().toISOString();
    const id = `ge-${Date.now()}`;
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
    console.error("Error creating global element:", error);
    return NextResponse.json({ error: "Failed to create global element" }, { status: 500 });
  }
}
