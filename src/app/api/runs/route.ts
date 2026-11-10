import { resolveRunImages } from '@/lib/runImages.server';
import { captureDesign } from '@/lib/runDesign.server';
import { leaveFieldsOff } from '@/lib/runLeaveOff';
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
import { countedEventSpans } from "@/lib/runProgress";

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
  // Stretches the print history counts as printed beyond progress (the run page counts the same way).
  const counted = new Map<string, OfficeSpan[]>();
  let officeOk = false, historyOk = false, countedOk = false;
  if (!ids.length) return { office, history, counted, officeOk: true, historyOk: true, countedOk: true };
  const user = officeUserFor(request);
  await Promise.all([
    (async () => {
      if (!user) return;
      try {
        // Ranges a person already confirmed as printed after the office sent
        // them (read-only), so checked-off parts and "mark printed" agree
        // with the run page.
        // An accepted "Go back to label N" (a rewind event) is respected the
        // same way: office work and confirmations from before it are never
        // offered or counted again.
        // Labels printed one by one by scanning are read too, only to count
        // printed labels the same way as the run page (countedSpans).
        const eventRows = await db.select({ runId: runPrintEvents.runId, type: runPrintEvents.eventType, output: runPrintEvents.output, from: runPrintEvents.rangeFrom, to: runPrintEvents.rangeTo, createdAt: runPrintEvents.createdAt })
          .from(runPrintEvents).where(and(inArray(runPrintEvents.runId, ids), or(and(eq(runPrintEvents.eventType, 'confirmed'), eq(runPrintEvents.output, 'office-pi')), and(eq(runPrintEvents.eventType, 'sent'), eq(runPrintEvents.output, 'scan')), eq(runPrintEvents.eventType, REWIND_EVENT))));
        const rewound = new Map<string, number>();
        for (const row of eventRows) if (row.type === REWIND_EVENT) rewound.set(row.runId, Math.max(rewound.get(row.runId) ?? 0, lastRewindAt([{ eventType: row.type, createdAt: row.createdAt }])));
        const confirmed = new Map<string, OfficeSpan[]>();
        for (const row of eventRows) {
          if (row.type !== 'confirmed' || row.output !== 'office-pi' || !afterRewind(row.createdAt, rewound.get(row.runId) ?? 0)) continue;
          const list = confirmed.get(row.runId) ?? []; list.push({ from: Number(row.from), to: Number(row.to) }); confirmed.set(row.runId, list);
        }
        const byRunEvents = new Map<string, Array<{ eventType: string; output: string; rangeFrom: number; rangeTo: number; createdAt: string }>>();
        for (const row of eventRows) { const list = byRunEvents.get(row.runId) ?? []; list.push({ eventType: row.type, output: row.output, rangeFrom: Number(row.from), rangeTo: Number(row.to), createdAt: row.createdAt }); byRunEvents.set(row.runId, list); }
        for (const row of rows) counted.set(row.id, countedEventSpans(byRunEvents.get(row.id) ?? [], row.totalLabels, rewound.get(row.id) ?? 0));
        countedOk = true;
        // The office's work, summed up in the database instead of one row per
        // job (a job holds at most 25 labels, so months of history is
        // thousands of rows). Jobs that only count as labels (sent, on their
        // way, checked off, cancelled) come back as merged stretches per run,
        // state and side of the latest rewind: every summary below reads them
        // only as a union of labels, so the answer is the same. Jobs that
        // didn't print or need a check come back one by one, as before,
        // because each is named with its send and reason. "After the rewind"
        // is the same test as afterRewind(), at the same millisecond precision.
        const rewindRuns = Array.from(rewound.keys()).filter((id) => rewound.get(id)! > 0);
        const rewindTimes = rewindRuns.map((id) => new Date(rewound.get(id)!).toISOString());
        const sql = officeSql();
        const found = await sql`WITH jobs AS (
            SELECT r.run_id, r.created_at AS request_created_at, j.id, j.request_id, j.sequence, j.range_from, j.range_to, j.state, j.reason,
              (j.review_required OR (j.state='claimed' AND j.claimed_at<now()-interval '5 minutes') OR (j.state='submitted' AND j.submitted_at<now()-interval '30 minutes')) IS TRUE AS review,
              (c.cutoff IS NULL OR date_trunc('milliseconds', r.created_at) > c.cutoff) AS after_rewind
            FROM office_requests r
            JOIN office_printer_access a ON a.station_id=r.station_id AND a.printer_id=r.printer_id AND a.user_id=${user.id}
            JOIN office_jobs j ON j.request_id=r.id
            LEFT JOIN unnest(${rewindRuns}::text[], ${rewindTimes}::timestamptz[]) AS c(run_id, cutoff) ON c.run_id=r.run_id
            WHERE r.run_id = ANY(${ids}::text[])
          ), plain AS (
            SELECT run_id, state, after_rewind, range_from, range_to,
              CASE WHEN range_from <= max(range_to) OVER (PARTITION BY run_id, state, after_rewind ORDER BY range_from, range_to ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) + 1 THEN 0 ELSE 1 END AS starts
            FROM jobs WHERE NOT review AND state NOT IN ('needs_review','rejected')
          ), islands AS (
            SELECT run_id, state, after_rewind, range_from, range_to,
              sum(starts) OVER (PARTITION BY run_id, state, after_rewind ORDER BY range_from, range_to ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS island
            FROM plain
          )
          SELECT run_id, state, after_rewind, range_from, range_to, review, id, request_id, reason FROM (
            SELECT run_id, state, after_rewind, min(range_from) AS range_from, max(range_to) AS range_to, false AS review,
              NULL::uuid AS id, NULL::uuid AS request_id, NULL::text AS reason, NULL::timestamptz AS request_created_at, NULL::bigint AS sequence
            FROM islands GROUP BY run_id, state, after_rewind, island
            UNION ALL
            SELECT run_id, state, after_rewind, range_from, range_to, review, id, request_id, reason, request_created_at, sequence
            FROM jobs WHERE review OR state IN ('needs_review','rejected')
          ) parts
          ORDER BY run_id, range_from, request_created_at, sequence`;
        const byRun = new Map<string, Array<OfficeJobLike & { afterRewind: boolean }>>();
        for (const job of found as Array<Record<string, unknown>>) {
          const list = byRun.get(String(job.run_id)) ?? [];
          list.push({ ...(job.id ? { id: String(job.id), requestId: String(job.request_id) } : {}), from: Number(job.range_from), to: Number(job.range_to), state: String(job.state), review: job.review === true, reason: typeof job.reason === 'string' ? job.reason : null, afterRewind: job.after_rewind !== false });
          byRun.set(String(job.run_id), list);
        }
        for (const row of rows) {
          const jobs = byRun.get(row.id);
          if (!jobs?.length) continue;
          const printedSpans = confirmed.get(row.id) ?? [];
          const summary = officeDeliverySummary(jobs, row.totalLabels, { printedCount: row.printedCount ?? 0, printedSpans });
          const first = summary.failed[0];
          const sinceRewind = jobs.filter((job) => job.afterRewind);
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
  return { office, history, counted, officeOk, historyOk, countedOk };
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
      // Additive: stretches counted as printed beyond printedCount, so the list counts printed labels like the run page.
      ...(extras.countedOk ? { countedSpans: extras.counted.get(row.id) ?? [] } : {}),
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
    // Parts the person left off this run print nothing: their items are not in the run's design.
    if (body.leaveOff?.length) design.template = leaveFieldsOff(design.template, body.leaveOff);
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
