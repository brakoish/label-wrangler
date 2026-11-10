import { resolveRunImages } from '@/lib/runImages.server';
import { captureDesign } from '@/lib/runDesign.server';
import { validatedBody, OfficeError } from '@/lib/validation';
import { randomUUID } from 'node:crypto';
import { withOfficeAuth, officeUserFor } from "@/lib/office/guard";
import { officeSql } from "@/lib/office/db";
import { officeDeliverySummary, officeMarkPlan, officeUnsentSpans, type OfficeJobLike, type OfficeSpan, type OfficeFailedKind } from "@/lib/officeRange";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runs, runPrintEvents, officeRequests } from "@/lib/db/schema";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { afterRewind, lastRewindAt, REWIND_EVENT } from "@/lib/runRewind";

/** What the office printer did for each run, for display only (read-only). */
interface RunListOffice {
  sent: number; onTheWay: number;
  /** Parts that didn't print, need a check, or need printing again. */
  failed: number;
  /** Labels in those parts. */
  failedLabels: number;
  firstFailed: { from: number; to: number; reason: string | null; didNotPrint: boolean; kind: OfficeFailedKind } | null;
  /** Sent stretches not counted as printed yet, and where progress lands once a person confirms them (for "Mark sent labels as printed"). */
  markable: { ranges: OfficeSpan[]; through: number };
  /** Labels after progress that no office send covers yet, once the office has some of this run (a "Send all in parts" that stopped early shows on every device). */
  unsent: OfficeSpan[];
}

/**
 * Additive, read-only fields for the Runs list: `office` (labels the office
 * printer reported sent / still on their way / parts that didn't print, for
 * printers this account can use) and `hasPrintHistory` (whether delete would
 * be refused). Each is left out if its query fails, so the list still loads.
 */
async function listExtras(request: NextRequest, rows: Array<{ id: string; totalLabels: number; printedCount: number | null }>) {
  const ids = rows.map((row) => row.id);
  const office = new Map<string, RunListOffice>();
  const history = new Set<string>();
  let officeOk = false, historyOk = false;
  if (!ids.length) return { office, history, officeOk: true, historyOk: true };
  const user = officeUserFor(request);
  await Promise.all([
    (async () => {
      if (!user) return;
      try {
        const sql = officeSql();
        const found = await sql`SELECT r.run_id, r.id AS request_id, r.created_at AS request_created_at, j.id, j.range_from, j.range_to, j.state, j.reason,
            (j.review_required OR (j.state='claimed' AND j.claimed_at<now()-interval '5 minutes') OR (j.state='submitted' AND j.submitted_at<now()-interval '30 minutes')) AS review
          FROM office_requests r
          JOIN office_printer_access a ON a.station_id=r.station_id AND a.printer_id=r.printer_id AND a.user_id=${user.id}
          JOIN office_jobs j ON j.request_id=r.id
          WHERE r.run_id = ANY(${ids}::text[])`;
        // Ranges a person already confirmed as printed after the office sent
        // them (read-only), so checked-off parts and "mark printed" agree
        // with the run page.
        // An accepted "Go back to label N" (a rewind event) is respected the
        // same way: office work and confirmations from before it are never
        // offered or counted again.
        const eventRows = await db.select({ runId: runPrintEvents.runId, type: runPrintEvents.eventType, from: runPrintEvents.rangeFrom, to: runPrintEvents.rangeTo, createdAt: runPrintEvents.createdAt })
          .from(runPrintEvents).where(and(inArray(runPrintEvents.runId, ids), or(and(eq(runPrintEvents.eventType, 'confirmed'), eq(runPrintEvents.output, 'office-pi')), eq(runPrintEvents.eventType, REWIND_EVENT))));
        const rewound = new Map<string, number>();
        for (const row of eventRows) if (row.type === REWIND_EVENT) rewound.set(row.runId, Math.max(rewound.get(row.runId) ?? 0, lastRewindAt([{ eventType: row.type, createdAt: row.createdAt }])));
        const confirmed = new Map<string, OfficeSpan[]>();
        for (const row of eventRows) {
          if (row.type !== 'confirmed' || !afterRewind(row.createdAt, rewound.get(row.runId) ?? 0)) continue;
          const list = confirmed.get(row.runId) ?? []; list.push({ from: Number(row.from), to: Number(row.to) }); confirmed.set(row.runId, list);
        }
        const byRun = new Map<string, Array<OfficeJobLike & { requestCreatedAt: string | null }>>();
        for (const job of found as Array<Record<string, unknown>>) {
          const list = byRun.get(String(job.run_id)) ?? [];
          const created = job.request_created_at instanceof Date ? job.request_created_at.toISOString() : typeof job.request_created_at === 'string' ? job.request_created_at : null;
          list.push({ id: String(job.id), requestId: String(job.request_id), from: Number(job.range_from), to: Number(job.range_to), state: String(job.state), review: job.review === true, reason: typeof job.reason === 'string' ? job.reason : null, requestCreatedAt: created });
          byRun.set(String(job.run_id), list);
        }
        for (const row of rows) {
          const jobs = byRun.get(row.id);
          if (!jobs?.length) continue;
          const printedSpans = confirmed.get(row.id) ?? [];
          const summary = officeDeliverySummary(jobs, row.totalLabels, { printedCount: row.printedCount ?? 0, printedSpans });
          const first = summary.failed[0];
          const sinceRewind = jobs.filter((job) => afterRewind(job.requestCreatedAt, rewound.get(row.id) ?? 0));
          office.set(row.id, { sent: summary.sent, onTheWay: summary.onTheWay, failed: summary.failed.length, failedLabels: summary.failedLabels,
            firstFailed: first ? { from: first.from, to: first.to, reason: first.reason, didNotPrint: first.didNotPrint, kind: first.kind } : null,
            markable: officeMarkPlan(row.printedCount ?? 0, sinceRewind, printedSpans, row.totalLabels),
            unsent: officeUnsentSpans(jobs, row.totalLabels, row.printedCount ?? 0) });
        }
        officeOk = true;
      } catch (error) { console.error('Runs list: office summary skipped:', error instanceof Error ? error.message : 'unknown'); }
    })(),
    (async () => {
      try {
        const [events, requests] = await Promise.all([
          db.selectDistinct({ runId: runPrintEvents.runId }).from(runPrintEvents).where(inArray(runPrintEvents.runId, ids)),
          db.selectDistinct({ runId: officeRequests.runId }).from(officeRequests).where(inArray(officeRequests.runId, ids)),
        ]);
        for (const row of [...events, ...requests]) if (row.runId) history.add(row.runId);
        historyOk = true;
      } catch (error) { console.error('Runs list: print history check skipped:', error instanceof Error ? error.message : 'unknown'); }
    })(),
  ]);
  return { office, history, officeOk, historyOk };
}

async function handleGET(request: NextRequest) {
  try {
    const offset = Math.max(0, Math.min(100000, Math.floor(Number(new URL(request.url).searchParams.get('offset'))) || 0));
    const all = await db
      .select({
        id: runs.id,
        name: runs.name,
        templateId: runs.templateId,
        presetId: runs.presetId,
        staticValues: runs.staticValues,
        fieldMappings: runs.fieldMappings,
        dataSource: runs.dataSource,
        mappedField: runs.mappedField,
        status: runs.status,
        totalLabels: runs.totalLabels,
        printedCount: runs.printedCount,
        notes: runs.notes,
        pinnedAt: runs.pinnedAt,
        createdAt: runs.createdAt,
        updatedAt: runs.updatedAt,
        completedAt: runs.completedAt,
      })
      .from(runs)
      .orderBy(desc(runs.createdAt)).limit(50).offset(offset);
    const extras = await listExtras(request, all);
    return NextResponse.json(all.map((row) => ({
      ...row,
      ...(extras.officeOk ? { office: extras.office.get(row.id) ?? null } : {}),
      ...(extras.historyOk ? { hasPrintHistory: extras.history.has(row.id) } : {}),
    })));
  } catch (error) {
    if (error instanceof OfficeError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error fetching runs:", error);
    return NextResponse.json({ error: "Failed to fetch runs" }, { status: 500 });
  }
}

async function handlePOST(request: NextRequest) {
  try {
    const body = await validatedBody(request, 'run', true);
    const now = new Date().toISOString();
    const id = `run-${randomUUID()}`;
    const design = await captureDesign(String(body.templateId));
    if (body.imageSelections) design.template = await resolveRunImages(design.template, body.imageSelections);
    const newRun = {
      id,
      designSnapshot: design,
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
    if (error instanceof OfficeError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error creating run:", error);
    return NextResponse.json({ error: "Failed to create run" }, { status: 500 });
  }
}

export const GET = withOfficeAuth(handleGET);

export const POST = withOfficeAuth(handlePOST);
