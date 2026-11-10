import { json } from './office/http';

/**
 * Definite refusals raised inside the office SQL functions
 * (scripts/office/schema.sql office_resolve, scripts/office/controls.sql
 * office_control_create). They are plain exceptions there, so the shared
 * failure() turns them into a 500, which a browser reads as "not sure, keep
 * the saved request and try again". These happen before anything is changed,
 * so the browser-facing routes answer them as 409 (403 for a permission
 * refusal) with a stable code. The SQL functions and the Pi routes are
 * unchanged.
 */
const KNOWN: Array<{ pattern: RegExp; status: number; code: string }> = [
  { pattern: /Job does not require resolution/, status: 409, code: 'already_resolved' },
  { pattern: /A printer control is still pending/, status: 409, code: 'control_pending' },
  { pattern: /Control worker offline/, status: 409, code: 'worker_offline' },
  { pattern: /Idempotency conflict/, status: 409, code: 'key_conflict' },
  { pattern: /Station unavailable/, status: 409, code: 'station_unavailable' },
  { pattern: /Control permission denied/, status: 403, code: 'no_permission' },
];

/** A JSON response for a known SQL refusal, or null for anything else. */
export function knownOfficeRefusal(error: unknown): Response | null {
  const message = error instanceof Error ? error.message : '';
  for (const { pattern, status, code } of KNOWN) {
    if (pattern.test(message)) return json({ error: (message.match(pattern) as RegExpMatchArray)[0], code }, status);
  }
  return null;
}
