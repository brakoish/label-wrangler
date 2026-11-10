/**
 * Print history, grouped: the office reports each part of a big send as its
 * own event ("Sent labels 1476-1500 ..."), 80 lines for 2,000 labels. Parts
 * of the same kind that follow on from each other, close together in time,
 * read as one line with a count ("... (80 parts)").
 */
export interface HistoryEventLike {
  id: string; eventType: string; output: string; rangeFrom: number; rangeTo: number;
  message: string | null; createdAt: string;
}
export interface HistoryGroup<E extends HistoryEventLike> { event: E; parts: number }

const GAP_MS = 15 * 60 * 1000;

export function groupPrintHistory<E extends HistoryEventLike>(events: ReadonlyArray<E>): Array<HistoryGroup<E>> {
  const groups: Array<HistoryGroup<E>> = [];
  // By time, whatever the text shape ("2026-11-10 12:00:00+00" from the office, ISO elsewhere).
  const at = (e: E) => Date.parse(e.createdAt);
  const byTime = (a: E, b: E) => { const x = at(a), y = at(b); return Number.isFinite(x) && Number.isFinite(y) && x !== y ? x - y : a.createdAt.localeCompare(b.createdAt); };
  for (const event of events.slice().sort(byTime)) {
    const last = groups[groups.length - 1];
    const joins = !!last && event.output === 'office-pi' && last.event.output === 'office-pi'
      && event.eventType === last.event.eventType && event.eventType === 'sent'
      && (event.message ?? '') === (last.event.message ?? '')
      && event.rangeFrom === last.event.rangeTo + 1
      && Date.parse(event.createdAt) - Date.parse(last.event.createdAt) < GAP_MS;
    if (joins) groups[groups.length - 1] = { event: { ...last.event, rangeTo: event.rangeTo, createdAt: event.createdAt }, parts: last.parts + 1 };
    else groups.push({ event, parts: 1 });
  }
  return groups.reverse();
}
