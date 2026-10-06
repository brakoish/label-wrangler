import { randomUUID } from 'node:crypto';
import { body as readBody, OfficeError, uuid } from '@/lib/office/http';
import { withOfficeAuth } from "@/lib/office/guard";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runPrintEvents } from "@/lib/db/schema";
import { desc, eq, and } from "drizzle-orm";

async function handleGET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const events = await db
      .select()
      .from(runPrintEvents)
      .where(eq(runPrintEvents.runId, id))
      .orderBy(desc(runPrintEvents.createdAt));
    return NextResponse.json(events);
  } catch (error) {
    if(error instanceof OfficeError) return NextResponse.json({error:error.message},{status:error.status});
    console.error("Error fetching run print events:", error);
    return NextResponse.json({ error: "Failed to fetch run print events" }, { status: 500 });
  }
}

async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await readBody(req,8192);
    if (!['opened','sent','confirmed','failed','cancelled'].includes(String(body.eventType)) || !['roll-zpl','sheet-pdf','roll-pdf','scan','office-pi'].includes(String(body.output))) throw new OfficeError('Invalid print event');
    for (const key of ['rangeFrom','rangeTo','labelCount']) if(!Number.isInteger(body[key]) || Number(body[key])< (key==='labelCount'?0:1) || Number(body[key])>100000) throw new OfficeError('Invalid print range');
    if(Number(body.rangeTo)<Number(body.rangeFrom)) throw new OfficeError('Invalid print range');
    if(body.printedCountAfter!=null && (!Number.isInteger(body.printedCountAfter)||Number(body.printedCountAfter)<0||Number(body.printedCountAfter)>100000)) throw new OfficeError('Invalid print count');
    for(const key of ['printerName','message']) if(body[key]!=null && (typeof body[key]!=='string'||String(body[key]).length>2000)) throw new OfficeError('Invalid print event text');
    if(body.idempotencyKey!==undefined && !uuid(body.idempotencyKey)) throw new OfficeError('Invalid print event key');
    const now = new Date().toISOString();
    const rangeFrom = Math.max(1, Math.floor(Number(body.rangeFrom) || 1));
    const rangeTo = Math.max(rangeFrom, Math.floor(Number(body.rangeTo) || rangeFrom));
    const labelCount = Math.max(0, Math.floor(Number(body.labelCount) || (rangeTo - rangeFrom + 1)));
    const event = {
      id: `print-event-${body.idempotencyKey ?? randomUUID()}`,
      runId: id,
      eventType: String(body.eventType),
      output: String(body.output),
      rangeFrom,
      rangeTo,
      labelCount,
      printedCountAfter: typeof body.printedCountAfter === 'number' ? body.printedCountAfter : null,
      printerName: typeof body.printerName === 'string' ? body.printerName : null,
      message: typeof body.message === 'string' ? body.message : null,
      createdAt: now,
    };
    await db.insert(runPrintEvents).values(event).onConflictDoNothing();
    const [saved] = await db.select().from(runPrintEvents).where(and(eq(runPrintEvents.id,event.id),eq(runPrintEvents.runId,id)));
    if (!saved || ['eventType','output','rangeFrom','rangeTo','labelCount','printedCountAfter','printerName','message'].some(key => saved[key as keyof typeof saved] !== event[key as keyof typeof event])) throw new OfficeError('Print event key already used for another event',409);
    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    if(error instanceof OfficeError) return NextResponse.json({error:error.message},{status:error.status});
    console.error("Error creating run print event:", error);
    return NextResponse.json({ error: "Failed to create run print event" }, { status: 500 });
  }
}

export const GET = withOfficeAuth(handleGET);

export const POST = withOfficeAuth(handlePOST);
