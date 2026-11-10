import { randomUUID } from 'node:crypto';
import { body as readBody, OfficeError, uuid } from '@/lib/office/http';
import { withOfficeAuth } from "@/lib/office/guard";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runPrintEvents } from "@/lib/db/schema";
import { desc, eq, and, sql } from "drizzle-orm";
import { isForeignKeyViolation } from "@/lib/dbErrors";
// An accepted "Go back to label N" (additive: older pages never send it).
import { REWIND_EVENT } from "@/lib/runRewind";
import { REWIND_NOT_APPLIED } from "@/lib/errorCodes";

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
    if (!['opened','sent','confirmed','failed','cancelled',REWIND_EVENT].includes(String(body.eventType)) || !['roll-zpl','sheet-pdf','roll-pdf','scan','office-pi'].includes(String(body.output))) throw new OfficeError('Invalid print event');
    for (const key of ['rangeFrom','rangeTo','labelCount']) if(!Number.isInteger(body[key]) || Number(body[key])< (key==='labelCount'?0:1) || Number(body[key])>100000) throw new OfficeError('Invalid print range');
    if(Number(body.rangeTo)<Number(body.rangeFrom)) throw new OfficeError('Invalid print range');
    if(body.printedCountAfter!=null && (!Number.isInteger(body.printedCountAfter)||Number(body.printedCountAfter)<0||Number(body.printedCountAfter)>100000)) throw new OfficeError('Invalid print count');
    for(const key of ['printerName','message']) if(body[key]!=null && (typeof body[key]!=='string'||String(body[key]).length>2000)) throw new OfficeError('Invalid print event text');
    if(body.idempotencyKey!==undefined && !uuid(body.idempotencyKey)) throw new OfficeError('Invalid print event key');
    // A "Go back to label N" entry is written by the go-back itself (PUT
    // /api/runs/[id] with X-LW-Rewind-Key), in the same statement and at the
    // same database time. One sent on its own is only accepted as a repeat of
    // that entry (same key, same content); anything else would move the
    // cutoff that decides which office work and confirmations still count,
    // without a go-back behind it. Main's pages never send this type.
    if (body.eventType === REWIND_EVENT) {
      const [written] = body.idempotencyKey ? await db.select().from(runPrintEvents).where(and(eq(runPrintEvents.id, `print-event-${body.idempotencyKey}`), eq(runPrintEvents.runId, id))) : [];
      if (!written) return NextResponse.json({ error: 'A go-back is recorded with the go-back itself.', code: REWIND_NOT_APPLIED }, { status: 409 });
      const same = written.eventType === REWIND_EVENT && written.output === body.output && written.rangeFrom === body.rangeFrom && written.rangeTo === body.rangeTo && written.labelCount === body.labelCount && (written.printedCountAfter ?? null) === (body.printedCountAfter ?? null);
      if (!same) throw new OfficeError('Print event key already used for another event', 409);
      return NextResponse.json(written, { status: 201 });
    }
    // Stamped with the database's clock, as office requests and jobs are, so
    // a "Go back to label N" cutoff and the office work it is compared with
    // use one clock (same ISO text shape as before).
    const now = sql<string>`to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
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
    try { await db.insert(runPrintEvents).values(event).onConflictDoNothing(); }
    catch (error) { if (isForeignKeyViolation(error)) throw new OfficeError('Run not found', 404); throw error; }
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

export const POST = withOfficeAuth(handlePOST, 'print-or-edit');
