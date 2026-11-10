/** Office print job shape as the Office Pi panel sees it (read-only helpers). */
export interface OfficeJobLike { from: number; to: number; state: string }

export const OFFICE_IN_PROGRESS = ['queued', 'claimed', 'submitted'];

/**
 * First label that is neither sent nor still on its way, so the suggested
 * range never repeats labels already queued at the office. Null when every
 * label is already sent or on its way.
 */
export function firstUnsentLabel(jobs: ReadonlyArray<OfficeJobLike>, total: number, alreadyThrough = 0): number | null {
  const covered = jobs
    .filter((job) => job.state === 'sent_to_printer' || OFFICE_IN_PROGRESS.includes(job.state))
    .slice()
    .sort((a, b) => a.from - b.from);
  // Labels 1..alreadyThrough are already printed (on this computer or by an
  // earlier office print), so the suggestion starts after them.
  let through = Math.max(0, Math.min(total, Math.floor(alreadyThrough) || 0));
  for (const job of covered) {
    if (job.from > through + 1) break;
    through = Math.max(through, job.to);
  }
  return through >= total ? null : Math.max(1, through + 1);
}

/** True when work still on its way to the office overlaps labels from..to. */
export function rangeOverlapsQueued(jobs: ReadonlyArray<OfficeJobLike>, from: number, to: number): boolean {
  return jobs.some((job) => OFFICE_IN_PROGRESS.includes(job.state) && job.from <= to && job.to >= from);
}

/** Valid office range: whole numbers, 1 <= from <= to <= total. */
export function isValidOfficeRange(from: string, to: string, total: number): boolean {
  if (from.trim() === '' || to.trim() === '') return false;
  const a = Number(from), b = Number(to);
  return Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b >= a && b <= total;
}

/** Fields of a run that change printed labels; anything else must not invalidate a checked range. */
export function officeProofKey(run: { id?: string; sourceData?: unknown; fieldMappings?: unknown; staticValues?: unknown; mappedField?: unknown } | undefined, template: unknown, format: unknown, from: string, to: string): string {
  return JSON.stringify([run?.id, run?.sourceData, run?.fieldMappings, run?.staticValues, run?.mappedField, template, format, from, to]);
}

/**
 * The run's progress after office deliveries: the highest label N such that
 * every label 1..N is either already counted as printed (printedCount) or was
 * reported sent to the printer by the office. Gaps stop the count, so a later
 * range sent out of order never skips labels that were not printed.
 */
export function officePrintedThrough(printedCount: number, jobs: ReadonlyArray<OfficeJobLike>, total = Infinity): number {
  let through = Math.max(0, Math.floor(printedCount) || 0);
  const sent = jobs.filter((job) => job.state === 'sent_to_printer').slice().sort((a, b) => a.from - b.from);
  for (const job of sent) {
    if (job.from > through + 1) break;
    through = Math.max(through, job.to);
  }
  return Math.min(through, total);
}

/** Labels still on their way to the office that are not already counted as printed. */
export function queuedBeyond(jobs: ReadonlyArray<OfficeJobLike & { count?: number }>, through: number): number {
  let count = 0;
  for (const job of jobs) {
    if (!OFFICE_IN_PROGRESS.includes(job.state)) continue;
    count += Math.max(0, job.to - Math.max(job.from - 1, through));
  }
  return count;
}

/**
 * The run update to record office progress, or null when there is nothing new.
 * Progress only moves forward (the server keeps the highest printedCount too).
 * A run that is now fully printed is marked done; a run that had not started
 * is marked paused (partly printed), like a local print that stops early.
 */
export function officeProgressUpdate(
  run: { status: string; printedCount: number; totalLabels: number },
  through: number,
): { printedCount: number; status: string } | null {
  const total = run.totalLabels;
  const next = Math.min(total, Math.floor(through));
  if (!(next > (run.printedCount || 0))) return null;
  if (run.status === 'cancelled') return { printedCount: next, status: 'cancelled' };
  if (next >= total) return { printedCount: next, status: 'completed' };
  const status = run.status === 'queued' || run.status === 'draft' || run.status === 'completed' ? 'paused' : run.status;
  return { printedCount: next, status };
}
