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
  firstFailed?: { kind?: 'did-not-print' | 'needs-check' | 'print-again'; from?: number; to?: number; reason?: string | null; didNotPrint?: boolean } | null;
  /** The shared printer is paused or stopped for a check, so queued labels wait. */
  held?: boolean;
  /** Another run's part stops the shared printer, so this run can't send or print yet. */
  heldBy?: { runId: string; runName: string } | null;
  /** Labels the office reported sent that nobody has said came out yet. */
  unchecked?: number;
  /** The run page's office panel: a send it isn't sure the office got. */
  unsure?: { from: number; to: number } | null;
  /** The run page's office panel: a send the office refused (nothing was queued). */
  refused?: { from: number; to: number } | null;
  /** The run page's office panel: the office printer is paused. */
  printerPaused?: boolean;
}

/**
 * Tones: 'attention' (red) is only for something that went wrong (a printer
 * problem, labels that didn't print, a refused send); 'check' (amber) is a
 * routine "look at the printer" step.
 */
export type RunDisplayTone = 'done' | 'active' | 'attention' | 'check' | 'paused' | 'cancelled' | 'idle';
/** The run statuses, used the same way in rows, the run header and the filter. */
export type RunStatusBucket = 'needs-you' | 'check' | 'printing' | 'paused' | 'ready' | 'done' | 'cancelled';
export const RUN_STATUS_WORDS: Record<RunStatusBucket, string> = {
  'needs-you': 'Needs you',
  check: 'Needs a check',
  printing: 'Printing',
  paused: 'Paused',
  ready: 'Ready',
  done: 'Done',
  cancelled: 'Cancelled',
};

const labelsWord = (span: { from: number; to: number }) => (span.from === span.to ? `Label ${span.from.toLocaleString('en-US')}` : `Labels ${span.from.toLocaleString('en-US')}–${span.to.toLocaleString('en-US')}`);
const plural = (n: number) => (n === 1 ? '1 label' : `${n.toLocaleString('en-US')} labels`);

/**
 * One status for a run, shared by the run header and the Runs list, from the
 * same facts the office panel shows: one of seven words (Needs you, Needs a
 * check, Printing, Paused, Ready, Done, Cancelled), with a short detail
 * beside it. The words never contradict the panel: "Needs you" is always red
 * and only for something that went wrong, "Needs a check" is amber, a run
 * whose labels wait for a paused or stopped office printer is "Paused",
 * never "Printing", and a run is "Ready" only when nothing is outstanding.
 * Office deliveries are shown as "sent", never as "printed": the office
 * reports labels sent to the printer, which is not proof they printed.
 * `localProblem` is a printer here that stopped with an error.
 */
export function runDisplayStatus(run: { status: RunStatus | string; printedCount?: number | null; totalLabels: number }, office?: RunOfficeSummary | null, localProblem = false): { label: string; tone: RunDisplayTone; bucket: RunStatusBucket; detail: string } {
  const printed = run.printedCount ?? 0;
  const total = run.totalLabels;
  const out = (bucket: RunStatusBucket, tone: RunDisplayTone, detail = '') => ({ label: RUN_STATUS_WORDS[bucket], tone, bucket, detail });
  if (run.status === 'cancelled') return out('cancelled', 'cancelled');
  if (total > 0 && printed >= total) return out('done', 'done');
  if (localProblem) return out('needs-you', 'attention', 'Stopped: printer problem');
  if (office?.unsure) return out('check', 'check', `Not sure the office got ${labelsWord(office.unsure).toLowerCase()}`);
  if (office && office.failed > 0) {
    const first = office.firstFailed;
    const kind = first?.kind ?? (first?.didNotPrint ? 'did-not-print' : first ? 'needs-check' : undefined);
    // A known cause ("Out of labels") is named; otherwise the plain kind.
    const short = first && first.reason && first.from !== undefined && first.to !== undefined
      ? officeProblemWords({ from: first.from, to: first.to, kind: first.kind, reason: first.reason, didNotPrint: first.didNotPrint }).short
      : '';
    if (kind === 'print-again') return out('check', 'check', short || 'Labels to print again');
    if (kind === 'needs-check') return out('check', 'check', short && short !== 'Needs a check' ? short : 'The office didn’t confirm some labels');
    return out('needs-you', 'attention', short || 'Office print needs a check');
  }
  if (office?.refused) return out('needs-you', 'attention', `${labelsWord(office.refused)} weren’t sent`.replace(/^(Label \S+) weren’t/, '$1 wasn’t'));
  if (office?.heldBy && run.status !== 'draft') return out('paused', 'paused', `“${office.heldBy.runName || 'Another run'}” needs a check first`);
  if (office && office.onTheWay > 0) return office.held ? out('paused', 'paused', 'Waiting for the office printer') : out('printing', 'active', 'At the office printer');
  if (office?.printerPaused) return out('paused', 'paused', 'The office printer is paused');
  if (run.status === 'printing') return out('printing', 'active');
  if (run.status === 'completed') return out('done', 'done');
  if (office && (office.unchecked ?? 0) > 0) return out('check', 'check', `${plural(office.unchecked!)} sent, not checked yet`);
  if (office && office.unchecked === undefined && total > 0 && office.sent >= total) return out('check', 'check', 'Sent: check they came out');
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
