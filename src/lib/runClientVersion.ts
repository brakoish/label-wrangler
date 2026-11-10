/**
 * Which rules a run update follows. Tabs that were open before a deploy keep
 * running the old code (production `main`), which writes printedCount
 * exactly: "Reprint from label N" sends N-1 and "Reprint all" sends 0, with no
 * rewind flag. Current code marks every progress write with this header and
 * sends an explicit rewind (resetProgress) when it means to go back, so the
 * server can keep progress as a high-water mark for it without silently
 * ignoring an older tab's rewind.
 */
export const RUN_CLIENT_HEADER = 'X-LW-Client';
export const RUN_CLIENT_VERSION = 2;

/** True when an update follows the current rules (high-water mark, explicit rewinds). */
export function followsCurrentRules(headers: Pick<Headers, 'get'>, body: Record<string, unknown>): boolean {
  if (Number(headers.get(RUN_CLIENT_HEADER)) >= RUN_CLIENT_VERSION) return true;
  // Only current code knows these fields; older code never sends them.
  return body.resetProgress !== undefined || body.expectedPrintedCount !== undefined;
}

/**
 * Whether the server keeps the higher of the stored and the sent count.
 * - Current rules: always, except an explicit rewind (resetProgress).
 * - Older tabs: only where that code already meant "never lower" (its
 *   progressOnly ticks, and the sheet print tab's confirmation, which always
 *   sends completedAt and only ever moves forward). A plain status update
 *   with a count is written as sent, as before, so "Reprint from" and
 *   "Reprint all" from an old tab still go back.
 */
export function keepsHighWater(current: boolean, body: Record<string, unknown>): boolean {
  if (body.printedCount === undefined) return false;
  if (current) return body.resetProgress !== true;
  return body.progressOnly === true || 'completedAt' in body;
}
