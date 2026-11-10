import type { RunStatus } from './types';
import { officeProblemWords } from './officeProblem';

/** What the office printer has done for a run (display only; never progress). */
export interface RunOfficeSummary {
  sent: number; onTheWay: number;
  /** Parts that didn't print, need a check, or need printing again. */
  failed: number;
  /** Labels in those parts. */
  failedLabels?: number;
  /** The first such part: did-not-print and needs-check stop the shared printer; print-again doesn't. */
  firstFailed?: { kind?: 'did-not-print' | 'needs-check' | 'print-again'; from?: number; to?: number; reason?: string | null } | null;
  /** The shared printer is paused or stopped for a check, so queued labels wait. */
  held?: boolean;
  /** Another run's part stops the shared printer, so this run can't send or print yet. */
  heldBy?: { runId: string; runName: string } | null;
}

export type RunDisplayTone = 'done' | 'active' | 'attention' | 'paused' | 'cancelled' | 'idle';
/** The six run statuses, used the same way in rows, the run header and the filter. */
export type RunStatusBucket = 'needs-you' | 'printing' | 'paused' | 'ready' | 'done' | 'cancelled';
export const RUN_STATUS_WORDS: Record<RunStatusBucket, string> = {
  'needs-you': 'Needs you',
  printing: 'Printing',
  paused: 'Paused',
  ready: 'Ready',
  done: 'Done',
  cancelled: 'Cancelled',
};

/**
 * One status for a run, shared by the run header and the Runs list: one of
 * six words (Needs you, Printing, Paused, Ready, Done, Cancelled), with the
 * detail beside it. The words never contradict each other: "Needs you" is
 * always the attention colour, "Ready" is always plain, a run whose labels
 * wait for a paused or stopped office printer is "Paused", never "Printing". Office deliveries are shown as "Sent", never as "Printed": the
 * office reports labels sent to the printer, which is not proof they printed.
 * A run is never called "Ready" while labels are on their way.
 * `localProblem` is a printer here that stopped with an error.
 */
export function runDisplayStatus(run: { status: RunStatus | string; printedCount?: number | null; totalLabels: number }, office?: RunOfficeSummary | null, localProblem = false): { label: string; tone: RunDisplayTone; bucket: RunStatusBucket; detail: string } {
  const printed = run.printedCount ?? 0;
  const total = run.totalLabels;
  const out = (bucket: RunStatusBucket, tone: RunDisplayTone, detail = '') => ({ label: RUN_STATUS_WORDS[bucket], tone, bucket, detail });
  if (run.status === 'cancelled') return out('cancelled', 'cancelled');
  if (total > 0 && printed >= total) return out('done', 'done');
  if (localProblem) return out('needs-you', 'attention', 'Stopped: printer problem');
  if (office && office.failed > 0) {
    const first = office.firstFailed;
    // A known cause ("Out of labels") is named; otherwise the plain kind.
    if (first && first.reason && first.from !== undefined && first.to !== undefined) return out('needs-you', 'attention', officeProblemWords({ from: first.from, to: first.to, kind: first.kind, reason: first.reason }).short);
    return out('needs-you', 'attention', first?.kind === 'print-again' ? 'Labels to print again' : 'Office print needs a check');
  }
  if (office?.heldBy && run.status !== 'draft') return out('paused', 'paused', `“${office.heldBy.runName || 'Another run'}” needs a check first`);
  if (office && office.onTheWay > 0) return office.held ? out('paused', 'paused', 'Waiting for the office printer') : out('printing', 'active', 'Sending to the office printer');
  if (run.status === 'printing') return out('printing', 'active');
  if (run.status === 'completed') return out('done', 'done');
  if (office && total > 0 && office.sent >= total) return out('needs-you', 'attention', 'Sent to the office printer: check they came out');
  if (office && office.sent > 0) return out('ready', 'idle', printed > 0 ? 'Partly printed' : 'Partly sent');
  if (printed > 0) return out('ready', 'idle', 'Partly printed');
  return out('ready', 'idle');
}

/** "Sent to office printer: X of N" — the office line next to printed progress. */
export function officeSentLine(office: RunOfficeSummary | null | undefined, total: number): string | null {
  if (!office || (office.sent === 0 && office.onTheWay === 0 && office.failed === 0)) return null;
  const parts = [`Sent to office printer: ${office.sent.toLocaleString()} of ${total.toLocaleString()}`];
  // A part that needs a check, or a paused printer, stops the office printer, so the rest waits.
  if (office.onTheWay > 0) parts.push(`${office.onTheWay.toLocaleString()} ${office.failed > 0 || office.held ? 'waiting' : 'on the way'}`);
  return parts.join(' · ');
}

/** " 50 more labels also need attention." after the first failed part, or nothing. */
export function moreNeedAttention(office: { failed: number; failedLabels?: number }, first: { from: number; to: number }): string {
  if (office.failed <= 1) return '';
  const rest = (office.failedLabels ?? 0) - (first.to - first.from + 1);
  if (rest > 0) return ` ${rest.toLocaleString()} more label${rest === 1 ? ' also needs' : 's also need'} attention.`;
  const parts = office.failed - 1;
  return ` ${parts} more part${parts === 1 ? ' also needs' : 's also need'} attention.`;
}
