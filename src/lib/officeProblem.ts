import { plainJobReason } from './officeSendOutcome';

/**
 * One set of words for an office part that needs someone, used by the run
 * page's failed-parts list, the Runs list row, the printer bar and the run
 * header. Titles have no final period; the action is one sentence that says
 * what to do next.
 */
export interface OfficeProblemPart {
  from: number;
  to: number;
  kind?: 'did-not-print' | 'needs-check' | 'print-again';
  reason?: string | null;
  didNotPrint?: boolean;
}

export interface OfficeProblemWords {
  /** Two or three words for a status line: "Out of labels". */
  short: string;
  /** The heading for the part: "Out of labels". */
  title: string;
  /** What to do: "Load a new roll, then print labels 51–100 again." */
  action: string;
  /** Title and action as one sentence, for a row or a bar. */
  sentence: string;
  /** The fix before printing again, when there is one: "Load a new roll". */
  step?: string;
}

const n = (v: number) => v.toLocaleString('en-US');
export function labelRange(from: number, to: number): string {
  return from === to ? `label ${n(from)}` : `labels ${n(from)}–${n(to)}`;
}

/** The cause of a part that didn't print, as a short title and a fix. */
function cause(reason: string | null | undefined): { title: string; fix: string } | null {
  const plain = plainJobReason(reason);
  switch (plain) {
    case 'the printer is out of labels': return { title: 'Out of labels', fix: 'Load a new roll' };
    case 'the printer is out of ribbon': return { title: 'Out of ribbon', fix: 'Put in a new ribbon' };
    case 'the printer’s lid is open': return { title: 'Printer lid open', fix: 'Close the lid' };
    case 'the labels jammed': return { title: 'Labels jammed', fix: 'Clear the jam' };
    case 'the printer wasn’t connected': return { title: 'Printer not connected', fix: 'Check the printer is on and plugged in' };
    case 'the printer was paused': return { title: 'Printer was paused', fix: 'Resume the printer' };
    default: return null;
  }
}

export function officeProblemWords(part: OfficeProblemPart): OfficeProblemWords {
  const range = labelRange(part.from, part.to);
  const kind = part.kind ?? (part.didNotPrint ? 'did-not-print' : 'needs-check');
  const out = (short: string, title: string, action: string, step?: string): OfficeProblemWords => ({ short, title, action, sentence: `${title}. ${action}`, ...(step ? { step } : {}) });
  if (kind === 'print-again') return out('Labels to print again', 'To print again', `Print ${range} again.`);
  if (kind === 'needs-check') return out('Needs a check', 'Needs a check', `Check whether ${range} came out at the office.`);
  const known = cause(part.reason);
  if (known) return out(known.title, known.title, `${known.fix}, then print ${range} again.`, known.fix);
  if (/cancel/i.test(part.reason ?? '')) return out('Cancelled at the office', 'Cancelled at the office', `Print ${range} again if you still need them.`);
  return out('Didn’t print', 'Didn’t print', `Check the office printer, then print ${range} again.`, 'Check the office printer');
}
