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
import { desc, inArray } from "drizzle-orm";
import { historySummaryQuery, officeSummaryQuery } from "@/lib/runListQueries.server";

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

/** Statuses of runs being printed: their history and office work can change at any moment. */
const LIVE_STATUSES: ReadonlySet<string> = new Set(['queued', 'printing', 'paused']);
/** A run changed this recently (progress, a go-back, "mark printed") is read again on a live poll too. */
const RECENT_MS = 10 * 60 * 1000;

/**
 * Which listed runs a request reads print history and office work for. The
 * first load (and the page's regular full refresh) reads every listed run. A
 * live poll (`live=1`) reads only runs being printed, runs changed in the last
 * few minutes, and runs the page says have office work moving (`watch`); the
 * others come back without these fields and the page keeps what it has.
 */
function runsToRead(request: NextRequest, rows: Array<{ id: string; status: string | null; updatedAt: string | null }>): { ids: Set<string>; full: boolean } {
  const params = new URL(request.url).searchParams;
  if (params.get('live') !== '1') return { ids: new Set(rows.map((row) => row.id)), full: true };
  const watch = new Set((params.get('watch') ?? '').split(',').filter(Boolean).slice(0, 50));
  const since = Date.now() - RECENT_MS;
  const ids = new Set<string>();
  for (const row of rows) {
    const changed = row.updatedAt ? Date.parse(row.updatedAt) : NaN;
    if (LIVE_STATUSES.has(String(row.status)) || watch.has(row.id) || (Number.isFinite(changed) && changed >= since)) ids.add(row.id);
  }
  return { ids, full: false };
}

/**
 * Additive, read-only fields for the Runs list: `office` (labels the office
 * printer reported sent / still on their way / parts that didn't print, for
 * printers this account can use), `countedSpans` (stretches the print history
 * counts as printed beyond progress, as the run page counts them) and
 * `hasPrintHistory` (whether delete would be refused). Each is left out if its
 * query fails, or for runs this request doesn't read (see runsToRead), so the
 * list still loads and the page keeps what it last had.
 */
async function listExtras(request: NextRequest, rows: Array<{ id: string; status: string | null; updatedAt: string | null; totalLabels: number; printedCount: number | null }>) {
  const office = new Map<string, RunListOffice>();
  const history = new Set<string>();
  const counted = new Map<string, OfficeSpan[]>();
  const { ids: readIds, full } = runsToRead(request, rows);
  const read = rows.filter((row) => readIds.has(row.id));
  const ids = read.map((row) => row.id);
  let officeOk = false, historyOk = false, countedOk = false;
  if (!ids.length) return { office, history, counted, readIds, officeOk: true, historyOk: full, countedOk: true };
  const user = officeUserFor(request);
  await Promise.all([
    (async () => {
      if (!user) return;
      try {
        const sql = officeSql();
        // Merged stretches and each run's latest go-back, worked out in the
        // database (no row per scanned label). Counted stretches are read
        // only for runs whose progress hasn't reached the end: past it they
        // can't change the count.
        const need = read.map((row) => (row.printedCount ?? 0) < row.totalLabels);
        const found = await historySummaryQuery(sql, ids, read.map((row) => row.totalLabels), need) as Array<Record<string, unknown>>;
        const rewound = new Map<string, number>();
        const confirmed = new Map<string, OfficeSpan[]>();
        for (const row of read) counted.set(row.id, []);
        for (const item of found) {
          const runId = String(item.run_id);
          if (item.kind === 'r') { const at = Number(item.cutoff_ms); if (Number.isFinite(at) && at > 0) rewound.set(runId, at); continue; }
          const span = { from: Number(item.range_from), to: Number(item.range_to) };
          const into = item.kind === 'o' ? confirmed : item.kind === 'c' ? counted : null;
          if (!into) continue;
          const list = into.get(runId) ?? []; list.push(span); into.set(runId, list);
        }
        countedOk = true;
        const rewindRuns = Array.from(rewound.keys());
        const rewindTimes = rewindRuns.map((id) => new Date(rewound.get(id)!).toISOString());
        const jobsFound = await officeSummaryQuery(sql, user.id, ids, rewindRuns, rewindTimes) as Array<Record<string, unknown>>;
        const byRun = new Map<string, Array<OfficeJobLike & { afterRewind: boolean }>>();
        for (const job of jobsFound) {
          const list = byRun.get(String(job.run_id)) ?? [];
          list.push({ ...(job.id ? { id: String(job.id), requestId: String(job.request_id) } : {}), from: Number(job.range_from), to: Number(job.range_to), state: String(job.state), review: job.review === true, reason: typeof job.reason === 'string' ? job.reason : null, afterRewind: job.after_rewind !== false });
          byRun.set(String(job.run_id), list);
        }
        for (const row of read) {
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
      // Whether delete would be refused only changes from no to yes, and the
      // page checks again before it deletes, so live polls don't read it.
      if (!full) return;
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
  return { office, history, counted, readIds, officeOk, historyOk, countedOk };
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
      ...(extras.officeOk && extras.readIds.has(row.id) ? { office: extras.office.get(row.id) ?? null } : {}),
      ...(extras.historyOk && extras.readIds.has(row.id) ? { hasPrintHistory: extras.history.has(row.id) } : {}),
      // Additive: stretches counted as printed beyond printedCount, so the list counts printed labels like the run page.
      ...(extras.countedOk && extras.readIds.has(row.id) ? { countedSpans: extras.counted.get(row.id) ?? [] } : {}),
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
