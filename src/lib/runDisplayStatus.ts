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
  /** The run page's office panel: a send it isn't sure the office got (likely: the queue lists those labels). */
  unsure?: { from: number; to: number; likely?: boolean; missing?: boolean } | null;
  /** The run page's office panel: a send the office refused (nothing was queued). */
  refused?: { from: number; to: number } | null;
  /** The run page's office panel: the office printer is paused. */
  printerPaused?: boolean;
  /** The run page's office panel is sending right now (or checking a send), in a few words: "Sending part 1 of 4". */
  sending?: string | null;
  /** Labels after progress that no office send covers yet (parts still to send, or labels never sent). */
  stillToSend?: number;
  /** The run page's office panel: labels a "Print in order" fix held back, waiting for a press to send them. */
  heldBack?: { from: number; to: number } | null;
}

/**
 * Tones: 'attention' (red) is only for something that went wrong (a printer
 * problem, labels that didn't print, a refused send); 'check' (amber) is for
 * something that is actually uncertain (the office didn't confirm a part, a
 * send nobody is sure arrived); 'confirm' (calm, neutral) is the normal ask
 * after a send went through: did they all come out?
 */
export type RunDisplayTone = 'done' | 'active' | 'attention' | 'check' | 'confirm' | 'paused' | 'cancelled' | 'idle';
/** The run statuses, used the same way in rows, the run header and the filter. */
export type RunStatusBucket = 'needs-you' | 'check' | 'sent' | 'printing' | 'paused' | 'waiting' | 'ready' | 'done' | 'cancelled';
export const RUN_STATUS_WORDS: Record<RunStatusBucket, string> = {
  'needs-you': 'Needs you',
  check: 'Needs a check',
  sent: 'Sent',
  printing: 'Printing',
  paused: 'Paused',
  waiting: 'Waiting',
  ready: 'Ready',
  done: 'Done',
  cancelled: 'Cancelled',
};

const labelsWord = (span: { from: number; to: number }) => (span.from === span.to ? `Label ${span.from.toLocaleString('en-US')}` : `Labels ${span.from.toLocaleString('en-US')}–${span.to.toLocaleString('en-US')}`);

/**
 * One status for a run, shared by the run header and the Runs list, from the
 * same facts the office panel shows: one of nine words (Needs you, Needs a
 * check, Sent, Printing, Paused, Waiting, Ready, Done, Cancelled), with a short detail
 * beside it. The words never contradict the panel: "Needs you" is always red
 * and only for something that went wrong, "Needs a check" is amber and only
 * for something uncertain, "Sent" (labels the office sent that nobody has
 * said came out yet) is a calm question, never a warning, a run
 * whose labels wait for a paused or stopped office printer is "Paused",
 * never "Printing", and a run is "Ready" only when nothing is outstanding.
 * Office deliveries are shown as "sent", never as "printed": the office
 * reports labels sent to the printer, which is not proof they printed.
 * `localProblem` is a printer here that stopped with an error.
 */
/**
 * A run saved as printing is only shown as "Printing" while something is: a
 * print going on this page (`printingHere`), office labels on their way, or a
 * run whose progress moved in the last few minutes (a printer on another
 * computer). A run left at "printing" with nothing going reads as Ready.
 */
const PRINTING_FRESH_MS = 5 * 60_000;
function recentlyMoved(updatedAt: string | Date | null | undefined, now: number): boolean {
  if (!updatedAt) return true; // no time to go by: keep the saved word
  const at = new Date(updatedAt).getTime();
  return !Number.isFinite(at) || now - at < PRINTING_FRESH_MS;
}

export function runDisplayStatus(run: { status: RunStatus | string; printedCount?: number | null; totalLabels: number; updatedAt?: string | Date | null }, office?: RunOfficeSummary | null, localProblem = false, options: { printingHere?: boolean; now?: number } = {}): { label: string; tone: RunDisplayTone; bucket: RunStatusBucket; detail: string } {
  const printed = run.printedCount ?? 0;
  const total = run.totalLabels;
  const out = (bucket: RunStatusBucket, tone: RunDisplayTone, detail = '') => ({ label: RUN_STATUS_WORDS[bucket], tone, bucket, detail });
  if (run.status === 'cancelled') return out('cancelled', 'cancelled');
  if (total > 0 && printed >= total) return out('done', 'done');
  if (localProblem) return out('needs-you', 'attention', 'Stopped: printer problem');
  if (office?.unsure?.missing) return out('check', 'check', `The office didn’t get ${labelsWord(office.unsure).toLowerCase()}`);
  if (office?.unsure) return out('check', 'check', office.unsure.likely ? `${labelsWord(office.unsure)} look${office.unsure.from === office.unsure.to ? 's' : ''} like ${office.unsure.from === office.unsure.to ? 'it' : 'they'} arrived` : `Not sure the office got ${labelsWord(office.unsure).toLowerCase()}`);
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
  // A send going out right now (a part of "Send all in parts", or one the page
  // is checking) is never "Ready": the header says what the panel is doing.
  if (office?.sending) return out('printing', 'active', office.sending);
  // Another run's part stops the shared printer. Only labels of this run
  // already waiting there make it "Paused"; a run with nothing there is
  // "Waiting" (never "Ready"), and says what for. The run header and the Runs
  // list both read this, so they use the same word.
  if (office?.heldBy && run.status !== 'draft') {
    const name = office.heldBy.runName || 'Another run';
    return office.onTheWay > 0 ? out('paused', 'paused', `“${name}” needs a check first`) : out('waiting', 'paused', `For “${name}” to be checked`);
  }
  if (office && office.onTheWay > 0) return office.held ? out('paused', 'paused', 'Waiting for the office printer') : out('printing', 'active', 'At the office printer');
  if (office?.printerPaused) return out('paused', 'paused', 'The office printer is paused');
  // Labels a "Print in order" fix held back: nothing sends them but a press.
  if (office?.heldBack) return out('ready', 'confirm', `Send ${labelsWord(office.heldBack).toLowerCase()} next`);
  if (run.status === 'printing' && (options.printingHere || recentlyMoved(run.updatedAt, options.now ?? Date.now()))) return out('printing', 'active');
  if (run.status === 'completed') return out('done', 'done');
  // The question is only about what was sent; labels still to send are said apart.
  const toSend = (office?.stillToSend ?? 0) > 0 ? ` · ${office!.stillToSend!.toLocaleString('en-US')} still to send` : '';
  if (office && (office.unchecked ?? 0) > 0) return out('sent', 'confirm', (office.unchecked === 1 ? 'Did it come out?' : `Did all ${office.unchecked!.toLocaleString('en-US')} come out?`) + toSend);
  if (office && office.unchecked === undefined && total > 0 && office.sent >= total) return out('sent', 'confirm', 'Did they all come out?');
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
