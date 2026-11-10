/**
 * How the browser reads the answer to an office print request. Nothing here
 * changes what is sent: same endpoint, same payload, same idempotency key.
 * It only decides what the person is told and whether a retry of the saved
 * request makes sense.
 *
 * - refused:   the server answered with a 4xx. It definitely did not queue
 *              anything new for that request, so resending the same request
 *              can only be refused again. The saved request is cleared and
 *              the reason is shown in plain words.
 * - uncertain: no answer, a timeout or a 5xx. The request may have arrived,
 *              so the saved request (same idempotency key) is kept and can be
 *              sent again safely: the server returns the original request.
 * - other:     something on this device failed before anything was sent.
 */
export type OfficeFailureKind = 'refused' | 'uncertain' | 'other';

/** Plain refusal reasons the UI can react to (e.g. not showing "connected"). */
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

/**
 * status: the HTTP status when the server answered, undefined when the
 * request itself failed (offline, aborted, timed out) after it may have left.
 */
export function officeFailureKind(status: number | undefined): OfficeFailureKind {
  if (status === undefined) return 'uncertain';
  // 408 means the server gave up waiting; treat it like no answer.
  if (status === 408) return 'uncertain';
  if (status >= 400 && status < 500) return 'refused';
  if (status >= 500) return 'uncertain';
  return 'other';
}

const REFUSALS: Array<[RegExp, OfficeRefusalReason, string]> = [
  [/awaiting verified pairing|pairing not activated|job creation is disabled/i, 'not-paired',
    'The office printer isn’t ready to take jobs yet — it’s waiting to be paired. Ask your admin to finish setting it up. Nothing was printed.'],
  [/check printer before retrying/i, 'needs-review',
    'Someone needs to check the office printer before more labels can be sent. Nothing new was printed.'],
  [/print(er)? access denied|does not have permission/i, 'no-access',
    'Your account isn’t allowed to print on the office printer. Ask your admin for print access. Nothing was printed.'],
  [/sign in to label wrangler|unauthori[sz]ed/i, 'signed-out',
    'You’re signed out. Sign in again, then send. Nothing was printed.'],
  [/already been queued/i, 'already-queued',
    'Some of these labels were already sent to the office printer. Use Reprint to print them again.'],
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
  const cleaned = message.trim().replace(/\.$/, '');
  return { reason: 'other', message: cleaned ? `The office printer didn’t take this request: ${cleaned}. Nothing new was printed.` : 'The office printer didn’t take this request. Nothing new was printed.' };
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

/** Words for the printer's own readiness, from the stations list and any refusal seen. */
export function officePrinterReadiness(
  printer: { online: boolean; available?: boolean; dispatch_enabled: boolean; paired_at?: string | null; needs_review: boolean } | undefined,
  refusal: OfficeRefusalReason | null,
): { tone: 'ok' | 'warn' | 'bad'; text: string; canSend: boolean } {
  if (!printer) return { tone: 'warn', text: 'No office printer is set up for your account.', canSend: false };
  if (!printer.dispatch_enabled || printer.paired_at === null || refusal === 'not-paired') {
    return { tone: 'warn', text: 'The office printer isn’t ready to take jobs yet — it’s waiting to be paired.', canSend: printer.dispatch_enabled && printer.paired_at !== null };
  }
  if (printer.needs_review || refusal === 'needs-review') return { tone: 'bad', text: 'Someone needs to check the office printer before more labels can be sent.', canSend: !printer.needs_review };
  if (refusal === 'no-access') return { tone: 'warn', text: 'Your account isn’t allowed to print on the office printer.', canSend: true };
  if (!printer.online) return { tone: 'warn', text: 'The office is offline. Anything you send waits until it reconnects.', canSend: true };
  if (printer.available === false) return { tone: 'warn', text: 'The office is online, but the printer isn’t available.', canSend: true };
  return { tone: 'ok', text: 'Office printer ready', canSend: true };
}
