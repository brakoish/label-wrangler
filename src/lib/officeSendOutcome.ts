/**
 * How the browser reads the answer to an office print request. Nothing here
 * changes what is sent: same endpoint, same payload, same idempotency key.
 * It only decides what the person is told and whether a retry of the saved
 * request makes sense.
 *
 * - refused:   a definite "no" the server gives before it queues anything
 *              (src/lib/office/jobs.ts: 400 invalid request, 409 pairing,
 *              conflicts, label check, key mismatch, 404 not found; 413/415
 *              when the body itself is refused). Resending the same request
 *              can only be refused again, so the saved request is cleared.
 * - uncertain: no answer, a timeout, a 5xx, or a refusal that happens before
 *              the server looks at the request at all (401 signed out, 403 no
 *              access or wrong address, 429 busy). An earlier try with the
 *              same key may already be queued, so the saved request (same
 *              idempotency key) is kept for a safe "Send again".
 * - other:     something on this device failed before anything was sent.
 */
export type OfficeFailureKind = 'refused' | 'uncertain' | 'other';

/** Plain refusal reasons the UI can react to. */
export type OfficeRefusalReason =
  | 'not-paired'
  | 'needs-review'
  | 'no-access'
  | 'signed-out'
  | 'already-queued'
  | 'reprint-pending'
  | 'labels-changed'
  | 'key-mismatch'
  | 'too-large'
  | 'other';

/** Statuses the office API returns only when it refused before queuing anything. */
const DEFINITE_REFUSALS = new Set([400, 404, 409, 413, 415, 422]);

/**
 * status: the HTTP status when the server answered, undefined when the
 * request itself failed (offline, aborted, timed out) after it may have left.
 */
export function officeFailureKind(status: number | undefined): OfficeFailureKind {
  if (status === undefined) return 'uncertain';
  if (DEFINITE_REFUSALS.has(status)) return 'refused';
  if (status >= 400) return 'uncertain';
  return 'other';
}

/** Why a send is still "not sure", in words, for the saved-request box. */
export function uncertainSendWords(status: number | undefined, code?: string): { cause: 'signed-out' | 'no-access' | 'address' | 'busy' | 'no-answer'; message: string } {
  if (status === 401) return { cause: 'signed-out', message: 'You’re signed out. Sign in again, come back to this run, then tap “Send again”.' };
  if (status === 403 && code === 'origin_not_allowed') return { cause: 'address', message: 'This page was opened at an address the server doesn’t accept. Open Label Wrangler at its usual address, then tap “Send again”.' };
  if (status === 403) return { cause: 'no-access', message: 'Your account can’t send to the office printer right now. Ask your admin for print access, then tap “Send again”.' };
  if (status === 429) return { cause: 'busy', message: 'The server is busy. Wait a moment, then tap “Send again”.' };
  return { cause: 'no-answer', message: 'Tap “Send again”. It’s the same request, so it won’t print twice.' };
}

const REFUSALS: Array<[RegExp, OfficeRefusalReason, string]> = [
  [/awaiting verified pairing|pairing not activated|job creation is disabled/i, 'not-paired',
    'The office printer isn’t ready to take jobs yet — it’s waiting to be paired. Ask your admin to finish setting it up. Nothing new was sent.'],
  [/check printer before retrying/i, 'needs-review',
    'Someone needs to check the office printer before more labels can be sent. Nothing new was sent.'],
  [/print(er)? access denied|does not have permission/i, 'no-access',
    'Your account isn’t allowed to print on the office printer. Ask your admin for print access.'],
  [/sign in to label wrangler|unauthori[sz]ed/i, 'signed-out',
    'You’re signed out. Sign in again, then send.'],
  [/already been queued/i, 'already-queued',
    'The office already has some of these labels. Check the office queue below.'],
  [/resolve pending original jobs/i, 'reprint-pending',
    'The earlier print is still on its way. Wait for it to finish, or record what happened, before reprinting.'],
  [/changed or (its bitmap proof )?is missing|refresh the bitmap proof|prepare the proof again/i, 'labels-changed',
    'The labels changed after they were checked. Check them again, then send.'],
  [/key already used/i, 'key-mismatch',
    'This request doesn’t match the one saved on this device. Start a new send.'],
  [/too large|exceeds 32 MiB|exceeds the 2 MiB|up to 10,000/i, 'too-large',
    'That’s too many labels for one send. Send a smaller range.'],
];

/** A refusal from the office API in plain words, with a reason the UI can act on. */
export function plainOfficeRefusal(message: string, status?: number): { reason: OfficeRefusalReason; message: string } {
  for (const [pattern, reason, words] of REFUSALS) if (pattern.test(message)) return { reason, message: words };
  if (status === 401) return { reason: 'signed-out', message: REFUSALS[3][2] };
  if (status === 403) return { reason: 'no-access', message: REFUSALS[2][2] };
  // Never show raw server text: it is written for developers.
  return { reason: 'other', message: 'The office printer didn’t take this request. Check the office queue below.' };
}

/** What the run page remembers about a refused send, so a refresh tells the truth. */
export interface OfficeRefusalRecord { from: number; to: number; reason: OfficeRefusalReason; message: string; at: string }

export function readRefusal(raw: string | null): OfficeRefusalRecord | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<OfficeRefusalRecord>;
    if (typeof data.message !== 'string' || !Number.isInteger(data.from) || !Number.isInteger(data.to)) return null;
    return { from: data.from!, to: data.to!, reason: (data.reason ?? 'other') as OfficeRefusalReason, message: data.message, at: typeof data.at === 'string' ? data.at : '' };
  } catch { return null; }
}

/**
 * What to do with the request saved on this device after a failed POST:
 * keep it (safe resend with the same key) only when the outcome is unknown.
 */
export function keepPendingAfter(kind: OfficeFailureKind): boolean {
  return kind !== 'refused';
}

/** How long a remembered refusal is shown before live status takes over again. */
export const REFUSAL_TTL_MS = 30 * 60 * 1000;

/**
 * Whether a refusal saved on this device should still be shown. Live station
 * status always wins: a "waiting to be paired" refusal goes away once the
 * station is paired, a "check the printer" one once nothing needs a check,
 * and any refusal after a short time.
 */
export function refusalStillApplies(
  record: OfficeRefusalRecord | null,
  printer: { dispatch_enabled: boolean; paired_at?: string | null; needs_review: boolean } | undefined,
  now = Date.now(),
): boolean {
  if (!record) return false;
  const at = Date.parse(record.at);
  if (!Number.isFinite(at) || now - at > REFUSAL_TTL_MS || at - now > 60_000) return false;
  if (record.reason === 'not-paired' && printer && printer.dispatch_enabled && printer.paired_at) return false;
  if (record.reason === 'needs-review' && printer && !printer.needs_review) return false;
  return true;
}

/** Words for the printer's own readiness, from the live stations list only. */
export function officePrinterReadiness(
  printer: { online: boolean; available?: boolean; dispatch_enabled: boolean; paired_at?: string | null; needs_review: boolean } | undefined,
): { tone: 'ok' | 'warn' | 'bad'; text: string; canSend: boolean } {
  if (!printer) return { tone: 'warn', text: 'No office printer is set up for your account.', canSend: false };
  if (!printer.dispatch_enabled || !printer.paired_at) {
    return { tone: 'warn', text: 'The office printer isn’t ready to take jobs yet — it’s waiting to be paired.', canSend: false };
  }
  if (printer.needs_review) return { tone: 'bad', text: 'Someone needs to check the office printer before more labels can be sent.', canSend: false };
  if (!printer.online) return { tone: 'warn', text: 'The office is offline. Anything you send waits until it reconnects.', canSend: true };
  if (printer.available === false) return { tone: 'warn', text: 'The office is online, but the printer isn’t available.', canSend: true };
  return { tone: 'ok', text: 'Office printer ready', canSend: true };
}

/** What the office computer said about a part it couldn't print, in plain words. */
export function plainJobReason(reason: string | null | undefined): string {
  const r = (reason ?? '').toLowerCase();
  if (!r) return 'the office printer reported a problem';
  if (/media out|paper out|out of (labels|paper|media)|no media/.test(r)) return 'the printer is out of labels';
  if (/ribbon/.test(r)) return 'the printer is out of ribbon';
  if (/head (open|up)|cover open|lid open/.test(r)) return 'the printer’s lid is open';
  if (/jam/.test(r)) return 'the labels jammed';
  if (/paused/.test(r)) return 'the printer was paused';
  if (/offline|not connected|unreachable|no printer/.test(r)) return 'the printer wasn’t connected';
  if (/station_outcome_timeout|timeout|timed out/.test(r)) return 'the office computer didn’t confirm it in time';
  if (/conflicting_event/.test(r)) return 'the office computer reported something unexpected';
  if (/operator_cancelled|cancel/.test(r)) return 'it was cancelled';
  if (/operator_resolved/.test(r)) return 'someone at the office checked it';
  return 'the office printer reported a problem';
}

/**
 * A Pause/Resume POST that failed. Every 4xx the controls route returns
 * (bad request, signed out, no access, no permission) happens before the
 * control is created, so the saved request is cleared. Anything else
 * (offline, busy, 5xx) might have arrived, so the same request is kept and
 * "Try again" reuses its key.
 */
export function controlFailure(status: number | undefined): { keep: boolean; message: string } {
  if (status === 401) return { keep: false, message: 'You’re signed out. Sign in again, then pause or resume the printer.' };
  if (status === 403) return { keep: false, message: 'Your account can’t pause or resume the office printer. Ask your admin.' };
  if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) return { keep: false, message: 'The printer didn’t take that request. Check its status above, then try again.' };
  return { keep: true, message: 'We’re not sure the printer got that. Tap “Try again”. It’s the same request, so it won’t happen twice.' };
}
