/**
 * "Go back to label N" in the print history. A rewind the server accepted is
 * kept as a print event (event_type 'rewind', a plain text value the
 * print-events route takes), so every device and the Runs list know about it:
 * office work sent before it is never offered as "mark printed" again, and
 * "They printed" answers from before it don't push progress past it.
 */
export const REWIND_EVENT = 'rewind' as const;

interface EventLike { eventType: string; createdAt: string }

/** Milliseconds of the latest accepted rewind in this history, or 0. */
export function lastRewindAt(events: ReadonlyArray<EventLike>): number {
  let latest = 0;
  for (const event of events) {
    if (event.eventType !== REWIND_EVENT) continue;
    const at = Date.parse(event.createdAt);
    if (Number.isFinite(at) && at > latest) latest = at;
  }
  return latest;
}

/** True when something happened after the latest rewind (or there was none). Unknown times count as after. */
export function afterRewind(createdAt: string | null | undefined, rewoundAt: number): boolean {
  if (!rewoundAt) return true;
  const at = createdAt ? Date.parse(createdAt) : NaN;
  return !Number.isFinite(at) || at > rewoundAt;
}

/** The print event for a rewind from `before` printed back to label `goBackTo`. */
export function rewindEvent(goBackTo: number, before: number) {
  const from = Math.max(1, Math.floor(goBackTo));
  const to = Math.max(from, Math.floor(before));
  return {
    eventType: REWIND_EVENT,
    output: 'roll-zpl' as const,
    rangeFrom: from,
    rangeTo: to,
    labelCount: Math.max(0, Math.floor(before) - from + 1),
    printedCountAfter: from - 1,
    printerName: null,
    message: `Went back to label ${from.toLocaleString('en-US')}`,
  };
}
