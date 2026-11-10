/** Office print job shape as the Office Pi panel sees it (read-only helpers). */
export interface OfficeJobLike { from: number; to: number; state: string }

export const OFFICE_IN_PROGRESS = ['queued', 'claimed', 'submitted'];

/**
 * First label that is neither sent nor still on its way, so the suggested
 * range never repeats labels already queued at the office. Null when every
 * label is already sent or on its way.
 */
export function firstUnsentLabel(jobs: ReadonlyArray<OfficeJobLike>, total: number): number | null {
  const covered = jobs
    .filter((job) => job.state === 'sent_to_printer' || OFFICE_IN_PROGRESS.includes(job.state))
    .slice()
    .sort((a, b) => a.from - b.from);
  let through = 0;
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
