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
import { isNetworkError } from './userMessages';

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
  | 'printer-offline'
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
  if (status === 401) return { cause: 'signed-out', message: 'You’re signed out. Sign in again, come back to this run, then press “Send again”.' };
  if (status === 403 && code === 'origin_not_allowed') return { cause: 'address', message: 'This page was opened at an address the server doesn’t accept. Open Label Wrangler at its usual address, then press “Send again”.' };
  if (status === 403) return { cause: 'no-access', message: 'Your account can’t send to the office printer right now. Ask your admin for print access, then press “Send again”.' };
  if (status === 429) return { cause: 'busy', message: 'The server is busy. Wait a moment, then press “Send again”.' };
  if (status !== undefined && status >= 500) return { cause: 'no-answer', message: 'The server had a problem. Press “Send again”. It’s the same request, so it won’t print twice.' };
  return { cause: 'no-answer', message: 'The connection dropped before the server answered. Press “Send again”. It’s the same request, so it won’t print twice.' };
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
  [/printer is offline|printer offline|station (is )?(offline|unavailable)|printer (is )?(not connected|unreachable)/i, 'printer-offline',
    'The office printer is offline, so nothing was sent. Check that the Office Pi and the printer are switched on.'],
  [/too large|exceeds 32 MiB|exceeds the 2 MiB|up to 10,000/i, 'too-large',
    'That’s too many labels for one send. Send a smaller range.'],
  [/no room for a blank feed/i, 'too-large',
    'There isn’t room for the blank label at the end of this send. Send a smaller range, or untick the blank label.'],
];

/** A refusal from the office API in plain words, with a reason the UI can act on. */
export function plainOfficeRefusal(message: string, status?: number): { reason: OfficeRefusalReason; message: string } {
  for (const [pattern, reason, words] of REFUSALS) if (pattern.test(message)) return { reason, message: words };
  if (status === 401) return { reason: 'signed-out', message: REFUSALS[3][2] };
  if (status === 403) return { reason: 'no-access', message: REFUSALS[2][2] };
  // Never show raw server text: it is written for developers.
  return { reason: 'other', message: 'The office printer didn’t take this request, so nothing was sent. If it happens again, ask your admin.' };
}

/**
 * The one useful next step after a refusal, for the panel's main button:
 * - resend:  send the same labels again (a fresh check and a new request)
 * - queue:   look at the office queue (the office already has these labels)
 * - smaller: pick a smaller range
 * - sign-in: sign in again
 * - none:    only someone else can fix it, so no button
 */
export type OfficeRefusalNextStep = 'resend' | 'queue' | 'smaller' | 'sign-in' | 'none';
export function refusalNextStep(reason: OfficeRefusalReason): OfficeRefusalNextStep {
  if (reason === 'no-access' || reason === 'not-paired') return 'none';
  if (reason === 'already-queued' || reason === 'reprint-pending' || reason === 'needs-review') return 'queue';
  if (reason === 'too-large') return 'smaller';
  if (reason === 'signed-out') return 'sign-in';
  return 'resend';
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

/**
 * Whether a failed send keeps its saved request for "Send again". A first try
 * refused as signed out or without print access queued nothing (the server
 * checks the account first), so it is a plain refusal. A resend keeps the
 * request on those answers too, because an earlier try may have arrived.
 */
export function sendKeepsRequest(status: number | undefined, code: string | undefined, resend: boolean): boolean {
  if (!resend && (status === 401 || (status === 403 && code !== 'origin_not_allowed'))) return false;
  return keepPendingAfter(officeFailureKind(status));
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

/** A part on the shared office printer that stops it for everyone (from GET /api/office/stations). */
export interface OfficeReviewHold { run_id: string; run_name: string; from: number; to: number; did_not_print?: boolean }

export type OfficeStatusTone = 'ok' | 'warn' | 'bad';
/**
 * One status line for the shared office printer, from the live stations list
 * only. Never "Ready" while the printer is stopped for a check, paused, or
 * holding work for another reason. `review_holds` names the parts that stop
 * it; `thisRunId` lets a run page say "this run" instead of naming itself.
 * canSend: the server takes new work now (it may still wait to print).
 */
export function officeStatusLine(
  printer: { online: boolean; available?: boolean; dispatch_enabled: boolean; paired_at?: string | null; needs_review: boolean; dispatch_hold_reason?: string | null; review_holds?: OfficeReviewHold[] | null } | undefined,
  thisRunId?: string,
): { tone: OfficeStatusTone; text: string; canSend: boolean; paused: boolean; stopped: boolean; hold: OfficeReviewHold | null; otherHolds: number } {
  const base = { paused: false, stopped: false, hold: null as OfficeReviewHold | null, otherHolds: 0 };
  if (!printer) return { ...base, tone: 'warn', text: 'No office printer is set up for your account.', canSend: false };
  if (!printer.dispatch_enabled || !printer.paired_at) return { ...base, tone: 'warn', text: 'Not set up yet: the office printer is waiting to be paired.', canSend: false };
  if (printer.needs_review) {
    const holds = printer.review_holds ?? [];
    const hold = holds.find((h) => h.run_id !== thisRunId) ?? holds[0] ?? null;
    const mine = !!hold && hold.run_id === thisRunId;
    const others = new Set(holds.filter((h) => h.run_id !== thisRunId).map((h) => h.run_id)).size;
    const one = !!hold && hold.from === hold.to;
    const labels = hold ? (one ? `label ${hold.from.toLocaleString('en-US')}` : `labels ${hold.from.toLocaleString('en-US')}–${hold.to.toLocaleString('en-US')}`) : '';
    const text = !hold ? 'Stopped: a print on the office printer needs a check.'
      : mine ? `Stopped until ${labels} of this run ${one ? 'is' : 'are'} checked.`
      : `Stopped: ${labels} of “${hold.run_name || 'another run'}” need${one ? 's' : ''} a check.${others > 1 ? ` ${others} runs need a check.` : ''}`;
    return { ...base, stopped: true, hold, otherHolds: others, tone: 'bad', text, canSend: false };
  }
  if (!printer.online) return { ...base, tone: 'warn', text: 'The office is offline. Anything you send waits until it reconnects.', canSend: true };
  if (printer.dispatch_hold_reason === 'printer_paused') return { ...base, paused: true, tone: 'warn', text: 'Paused: nothing new prints until someone resumes it.', canSend: true };
  if (printer.dispatch_hold_reason === 'control_pending') return { ...base, tone: 'warn', text: 'Waiting for the printer to confirm a pause or resume…', canSend: true };
  if (printer.dispatch_hold_reason === 'control_stale') return { ...base, tone: 'warn', text: 'The office computer hasn’t reported in lately, so labels wait until it does.', canSend: true };
  if (printer.available === false) return { ...base, tone: 'warn', text: 'The office is online, but the printer isn’t available.', canSend: true };
  return { ...base, tone: 'ok', text: 'Ready', canSend: true };
}

/**
 * The words after a successful send. Never "the office keeps going" when the
 * printer is paused or stopped: say when it will print instead.
 */
export function queuedNotice(range: string, one: boolean, status: { paused: boolean; stopped: boolean }, blankAfter?: number): string {
  const verb = one ? 'is' : 'are';
  // One blank label was asked for at the end of this send (never after each part).
  const blank = blankAfter ? ` One blank label comes out after label ${blankAfter.toLocaleString()}.` : '';
  if (status.stopped) return `${range} ${verb} queued.${blank} The office printer is stopped for a check, so ${one ? 'it prints' : 'they print'} once that’s done.`;
  if (status.paused) return `${range} ${verb} queued.${blank} The printer is paused, so nothing prints until someone presses Resume.`;
  return `${range} ${verb} queued for the office printer.${blank} You can leave this page; the office keeps going.`;
}

/** A refusal that only someone else can fix: no "Try again" button for it. */
export function refusalNeedsSomeoneElse(reason: OfficeRefusalReason): boolean {
  return reason === 'no-access' || reason === 'not-paired';
}

/**
 * The one request saved on this device before its POST (`lw:office-pending:<runId>`).
 * It is the request payload itself, the same record main's panel writes and
 * reads (from, to, reprintOf, endBlank, idempotencyKey, ...), so a rollback or
 * a roll-forward resumes it unchanged. Only what the panel shows is read here;
 * a resend always posts the saved record as it is.
 */
export interface SavedOfficeRequest { from: number; to: number; reprintOf?: string; endBlank: boolean }
export function readSavedOfficeRequest(raw: string | null): SavedOfficeRequest | null | 'unreadable' {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { from?: unknown; to?: unknown; reprintOf?: unknown; endBlank?: unknown } | null;
    if (!data || !Number.isInteger(data.from) || !Number.isInteger(data.to)) return 'unreadable';
    return { from: data.from as number, to: data.to as number, ...(typeof data.reprintOf === 'string' && data.reprintOf ? { reprintOf: data.reprintOf } : {}), endBlank: data.endBlank === true };
  } catch { return 'unreadable'; }
}

/** Why the last try of a saved request was "not sure", kept beside it so a refresh says the same thing. */
export interface OfficePendingMeta { status?: number; code?: string }
export function readPendingMeta(raw: string | null): OfficePendingMeta {
  if (!raw) return {};
  try {
    const data = JSON.parse(raw) as OfficePendingMeta;
    return { ...(Number.isInteger(data.status) ? { status: data.status } : {}), ...(typeof data.code === 'string' ? { code: data.code } : {}) };
  } catch { return {}; }
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
 * (bad request, signed out, no access, no permission, and the 409 refusals:
 * another pause or resume still pending, office computer not reporting, key
 * already used) happens before a new control is created, so a first try's
 * saved request is cleared. A resend of a saved request keeps it on 401/403,
 * because the first try may already have created the control. Anything else
 * (offline, busy, 5xx) might have arrived, so the same request is kept and
 * "Try again" reuses its key.
 */
export function controlFailure(status: number | undefined, code?: string, resend = false): { keep: boolean; message: string } {
  if (status === 401) return { keep: resend, message: resend ? 'You’re signed out. Sign in again, then press “Try again”. It’s the same request, so it won’t happen twice.' : 'You’re signed out. Sign in again, then pause or resume the printer.' };
  if (status === 403) return { keep: resend, message: 'Your account can’t pause or resume the office printer. Ask your admin.' };
  if (status === 409 && code === 'control_pending') return { keep: false, message: 'Another pause or resume is still on its way to the printer. Wait for it, then try again.' };
  if (status === 409 && code === 'worker_offline') return { keep: false, message: 'The office computer isn’t reporting right now, so the printer can’t be paused or resumed. Try again once it reports in.' };
  if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) return { keep: false, message: 'The printer didn’t take that request. Check its status above, then try again.' };
  return { keep: true, message: 'We’re not sure the printer got that. Press “Try again”. It’s the same request, so it won’t happen twice.' };
}

/**
 * A label-drawing failure that isn't the design's fault (the drawing service
 * didn't answer, no internet): plain words and a next step instead of
 * "Labels 1–8: Bitmap rendering failed". Null when the message names a
 * problem in the design itself, which keeps its own words.
 */
export function drawFailureWords(error: unknown, span: { from: number; to: number }): string | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (/Lane \d+, [^:]+: /.test(message) || /32 MiB|too much printer data/i.test(message)) return null;
  const detail = message.replace(/^Labels? [\d,]+(?:–[\d,]+)?: /, '');
  const down = isNetworkError(error)
    || /^(Bitmap (rendering|proof) failed|Render failed|Incomplete bitmap proof( response)?|Internal Server Error|Failed to fetch|Load failed|NetworkError.*|Service unavailable|Bad gateway|Gateway time-?out)\.?$/i.test(detail.trim());
  if (!down) return null;
  const words = span.from === span.to ? `label ${span.from.toLocaleString('en-US')}` : `labels ${span.from.toLocaleString('en-US')}–${span.to.toLocaleString('en-US')}`;
  return `Couldn’t draw ${words}. Check the connection and try again.`;
}
