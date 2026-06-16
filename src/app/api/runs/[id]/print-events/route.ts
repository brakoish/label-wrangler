import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runPrintEvents } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const events = await db
      .select()
      .from(runPrintEvents)
      .where(eq(runPrintEvents.runId, id))
      .orderBy(desc(runPrintEvents.createdAt));
    return NextResponse.json(events);
  } catch (error) {
    console.error("Error fetching run print events:", error);
    return NextResponse.json({ error: "Failed to fetch run print events" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const now = new Date().toISOString();
    const rangeFrom = Math.max(1, Math.floor(Number(body.rangeFrom) || 1));
    const rangeTo = Math.max(rangeFrom, Math.floor(Number(body.rangeTo) || rangeFrom));
    const labelCount = Math.max(0, Math.floor(Number(body.labelCount) || (rangeTo - rangeFrom + 1)));
    const event = {
      id: `print-event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      runId: id,
      eventType: body.eventType,
      output: body.output,
      rangeFrom,
      rangeTo,
      labelCount,
      printedCountAfter: typeof body.printedCountAfter === 'number' ? body.printedCountAfter : null,
      printerName: body.printerName ?? null,
      message: body.message ?? null,
      createdAt: now,
    };
    await db.insert(runPrintEvents).values(event);
    return NextResponse.json(event, { status: 201 });
  } catch (error) {
    console.error("Error creating run print event:", error);
    return NextResponse.json({ error: "Failed to create run print event" }, { status: 500 });
  }
}
