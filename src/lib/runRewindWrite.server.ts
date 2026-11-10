import { sql, type SQLWrapper } from 'drizzle-orm';
import type { rewindEvent } from './runRewind';

/**
 * One statement: the go-back's update (`goBack`, which must return the run's
 * id) and its 'rewind' print-history entry, written only if the update
 * applied, stamped with that statement's database time (same text shape as
 * the print-events route). Answers `updated` (0 or 1) and `written_at`: the
 * entry's time if it exists now (written here, or already under this key), or null.
 */
/**
 * Part of a keyed go-back's WHERE: true only while no history entry exists
 * under its key. A go-back whose answer was lost can be sent again with the
 * same key after another device printed back up to the count it saw; without
 * this the guard (printed_count = expected) would match again and progress
 * would drop a second time, with no new entry. With it the retry changes
 * nothing and is answered as already applied.
 */
export function notAppliedYet(eventId: string) {
  return sql`NOT EXISTS (SELECT 1 FROM run_print_events WHERE id = ${eventId})`;
}

export function goBackWithEntry(goBack: SQLWrapper, eventId: string, runId: string, entry: ReturnType<typeof rewindEvent>) {
  // getSQL(): embedded as is (a query builder would be wrapped in parentheses,
  // which isn't valid inside WITH ... AS (...)).
  return sql`WITH upd AS (${goBack.getSQL()}), ev AS (
      INSERT INTO run_print_events (id, run_id, event_type, output, range_from, range_to, label_count, printed_count_after, printer_name, message, created_at)
      SELECT ${eventId}, upd.id, ${entry.eventType}, ${entry.output}, ${entry.rangeFrom}, ${entry.rangeTo}, ${entry.labelCount}, ${entry.printedCountAfter}, NULL, ${entry.message},
        to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      FROM upd ON CONFLICT (id) DO NOTHING RETURNING created_at
    )
    SELECT (SELECT count(*) FROM upd)::int AS updated,
      (SELECT created_at FROM ev UNION ALL SELECT created_at FROM run_print_events WHERE id = ${eventId} AND run_id = ${runId} LIMIT 1) AS written_at`;
}
