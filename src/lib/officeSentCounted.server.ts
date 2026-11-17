import { officeSql } from './office/db';
import { OFFICE_SENT_MESSAGE, officeSentPlan, type HistoryEvent, type SentJob } from './officeSentCounted';

/**
 * Counts the office parts reported sent to the printer as printed on their
 * run: adds a confirmed history entry per part and moves progress (never
 * back). Safe to call any number of times; it re-reads the whole run each
 * time, so a missed or repeated report is caught up on the next one.
 * Returns the run's progress afterwards, or null when the job has no run.
 */
export async function countOfficeSent(jobId: string): Promise<{ runId: string; through: number } | null> {
  const sql = officeSql();
  const owner = await sql`SELECT q.run_id FROM office_jobs j JOIN office_requests q ON q.id=j.request_id WHERE j.id=${jobId}::uuid`;
  const runId = owner[0]?.run_id as string | null | undefined;
  return runId ? countRunOfficeSent(runId) : null;
}

export async function countRunOfficeSent(runId: string): Promise<{ runId: string; through: number } | null> {
  const sql = officeSql();
  const [runs, jobRows, eventRows] = await Promise.all([
    sql`SELECT printed_count, total_labels, status FROM runs WHERE id=${runId}`,
    sql`SELECT j.id, j.range_from, j.range_to, j.state, j.review_required, q.created_at FROM office_jobs j JOIN office_requests q ON q.id=j.request_id WHERE q.run_id=${runId}`,
    sql`SELECT id, event_type, output, range_from, range_to, created_at FROM run_print_events WHERE run_id=${runId}`,
  ]);
  const run = runs[0];
  if (!run) return null;
  const jobs: SentJob[] = jobRows.map((r) => ({ id: String(r.id), from: Number(r.range_from), to: Number(r.range_to), state: String(r.state), review: r.review_required === true, requestAt: r.created_at ? new Date(r.created_at as string).toISOString() : null }));
  const events: HistoryEvent[] = eventRows.map((r) => ({ id: String(r.id), eventType: String(r.event_type), output: String(r.output), rangeFrom: Number(r.range_from), rangeTo: Number(r.range_to), createdAt: String(r.created_at) }));
  const plan = officeSentPlan({ printedCount: Number(run.printed_count), total: Number(run.total_labels), status: String(run.status) }, jobs, events);
  const now = new Date().toISOString();
  const writes = plan.add.map((part) => sql`INSERT INTO run_print_events(id,run_id,event_type,output,range_from,range_to,label_count,printed_count_after,printer_name,message,created_at)
    VALUES(${part.id},${runId},'confirmed','office-pi',${part.from},${part.to},${part.to - part.from + 1},${plan.through},'Office printer',${OFFICE_SENT_MESSAGE},${now}) ON CONFLICT (id) DO NOTHING`);
  if (plan.through > Number(run.printed_count)) {
    writes.push(plan.status === 'completed'
      ? sql`UPDATE runs SET printed_count=GREATEST(printed_count,${plan.through}), status=CASE WHEN status IN ('cancelled','completed') THEN status ELSE 'completed' END, completed_at=COALESCE(completed_at,${now}), updated_at=${now} WHERE id=${runId}`
      : sql`UPDATE runs SET printed_count=GREATEST(printed_count,${plan.through}), updated_at=${now} WHERE id=${runId}`);
  }
  if (writes.length) await sql.transaction(writes);
  return { runId, through: plan.through };
}
