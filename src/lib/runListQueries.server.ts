/**
 * The Runs list's read-only print-history and office summaries, worked out in
 * the database so each poll gets back merged stretches, not one row per
 * scanned label or office job. Both are tagged-template queries for
 * `officeSql()` (Neon HTTP); the PGlite check in the review notes runs the
 * same text against the real schema.
 */
type Tag = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

/**
 * Per run, from the print history (only rows that matter for counting):
 * - kind 'r': the latest accepted "Go back to label N", as epoch ms (cutoff_ms);
 * - kind 'o': office ranges a person confirmed came out, after that go-back, merged;
 * - kind 'c': labels counted as printed apart from progress (confirmed office
 *   ranges and scanned labels), after that go-back, clipped to 1..total and
 *   merged, only for runs whose progress hasn't reached the end (`need`).
 *
 * Same rules as countedEventSpans(), lastRewindAt() and afterRewind(): times
 * at millisecond precision; an event with an unreadable time counts as after
 * the go-back, and a go-back with an unreadable time is ignored. Adjacent
 * stretches merge, as printedSpans() and the office union do.
 */
export function historySummaryQuery<T extends Tag>(sql: T, ids: string[], totals: number[], need: boolean[]): ReturnType<T> {
  return sql`WITH t AS (
      SELECT * FROM unnest(${ids}::text[], ${totals}::int[], ${need}::boolean[]) AS t(run_id, total, need_counted)
    ), ev AS (
      SELECT e.run_id, e.event_type, e.output, e.range_from, e.range_to,
        CASE WHEN e.created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?Z$'
          THEN date_trunc('milliseconds', e.created_at::timestamptz) END AS at
      FROM run_print_events e
      WHERE e.run_id = ANY(${ids}::text[])
        AND (e.event_type = 'rewind' OR (e.event_type = 'confirmed' AND e.output = 'office-pi') OR (e.event_type = 'sent' AND e.output = 'scan'))
    ), cut AS (
      SELECT run_id, max(at) AS cutoff FROM ev WHERE event_type = 'rewind' AND at IS NOT NULL GROUP BY run_id
    ), picked AS (
      SELECT ev.run_id, 'o'::text AS kind, ev.range_from AS f, ev.range_to AS l
      FROM ev LEFT JOIN cut ON cut.run_id = ev.run_id
      WHERE ev.event_type = 'confirmed' AND (cut.cutoff IS NULL OR ev.at IS NULL OR ev.at > cut.cutoff)
      UNION ALL
      SELECT ev.run_id, 'c'::text, greatest(ev.range_from, 1), least(ev.range_to, t.total)
      FROM ev JOIN t ON t.run_id = ev.run_id LEFT JOIN cut ON cut.run_id = ev.run_id
      WHERE t.need_counted AND ev.event_type <> 'rewind' AND (cut.cutoff IS NULL OR ev.at IS NULL OR ev.at > cut.cutoff)
    ), marked AS (
      SELECT run_id, kind, f, l,
        CASE WHEN f <= max(l) OVER (PARTITION BY run_id, kind ORDER BY f, l ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) + 1 THEN 0 ELSE 1 END AS starts
      FROM picked WHERE f <= l
    ), islands AS (
      SELECT run_id, kind, f, l,
        sum(starts) OVER (PARTITION BY run_id, kind ORDER BY f, l ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS island
      FROM marked
    )
    SELECT run_id, kind, min(f) AS range_from, max(l) AS range_to, NULL::bigint AS cutoff_ms FROM islands GROUP BY run_id, kind, island
    UNION ALL
    SELECT run_id, 'r', NULL, NULL, (extract(epoch FROM cutoff) * 1000)::bigint FROM cut
    ORDER BY 1, 2, 3` as ReturnType<T>;
}

/**
 * The office's work for these runs, on printers this account can use. Jobs
 * that only count as labels (sent, on their way, checked off, cancelled) come
 * back as merged stretches per run, state and side of the latest go-back:
 * every summary reads them only as a union of labels, so the answer is the
 * same. Jobs that didn't print or need a check come back one by one, because
 * each is named with its send and reason. "After the go-back" is the same test
 * as afterRewind(), at the same millisecond precision.
 */
export function officeSummaryQuery<T extends Tag>(sql: T, userId: string, ids: string[], rewindRuns: string[], rewindTimes: string[]): ReturnType<T> {
  return sql`WITH jobs AS (
      SELECT r.run_id, r.created_at AS request_created_at, j.id, j.request_id, j.sequence, j.range_from, j.range_to, j.state, j.reason,
        (j.review_required OR (j.state='claimed' AND j.claimed_at<now()-interval '5 minutes') OR (j.state='submitted' AND j.submitted_at<now()-interval '30 minutes')) IS TRUE AS review,
        (c.cutoff IS NULL OR date_trunc('milliseconds', r.created_at) > c.cutoff) AS after_rewind
      FROM office_requests r
      JOIN office_printer_access a ON a.station_id=r.station_id AND a.printer_id=r.printer_id AND a.user_id=${userId}
      JOIN office_jobs j ON j.request_id=r.id
      LEFT JOIN unnest(${rewindRuns}::text[], ${rewindTimes}::timestamptz[]) AS c(run_id, cutoff) ON c.run_id=r.run_id
      WHERE r.run_id = ANY(${ids}::text[])
    ), plain AS (
      SELECT run_id, state, after_rewind, range_from, range_to,
        CASE WHEN range_from <= max(range_to) OVER (PARTITION BY run_id, state, after_rewind ORDER BY range_from, range_to ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) + 1 THEN 0 ELSE 1 END AS starts
      FROM jobs WHERE NOT review AND state NOT IN ('needs_review','rejected')
    ), islands AS (
      SELECT run_id, state, after_rewind, range_from, range_to,
        sum(starts) OVER (PARTITION BY run_id, state, after_rewind ORDER BY range_from, range_to ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS island
      FROM plain
    )
    SELECT run_id, state, after_rewind, range_from, range_to, review, id, request_id, reason FROM (
      SELECT run_id, state, after_rewind, min(range_from) AS range_from, max(range_to) AS range_to, false AS review,
        NULL::uuid AS id, NULL::uuid AS request_id, NULL::text AS reason, NULL::timestamptz AS request_created_at, NULL::bigint AS sequence
      FROM islands GROUP BY run_id, state, after_rewind, island
      UNION ALL
      SELECT run_id, state, after_rewind, range_from, range_to, review, id, request_id, reason, request_created_at, sequence
      FROM jobs WHERE review OR state IN ('needs_review','rejected')
    ) parts
    ORDER BY run_id, range_from, request_created_at, sequence` as ReturnType<T>;
}
