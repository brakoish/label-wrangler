import { json, browserFailure } from '@/lib/office/http';
import { requireUser } from '@/lib/office/auth';
import { officeSql } from '@/lib/office/db';
export async function GET(req: Request){
  try{
    const user=await requireUser(req);const sql=officeSql();
    const printers=await sql`SELECT p.station_id,p.id,p.name,p.dpi,p.max_width_dots,s.last_seen,
      (s.last_seen>now()-interval '30 seconds') AS online,s.dispatch_enabled,s.paired_at,
      EXISTS(SELECT 1 FROM jsonb_array_elements(s.advertised_printers) a WHERE a->>'id'=p.id AND a->>'available'='true') AS available,
      EXISTS(SELECT 1 FROM office_jobs j WHERE j.station_id=s.id AND (j.review_required OR
        (j.state='claimed' AND j.claimed_at<now()-interval '5 minutes') OR (j.state='submitted' AND j.submitted_at<now()-interval '30 minutes'))) AS needs_review
      FROM office_printers p JOIN office_stations s ON s.id=p.station_id JOIN office_printer_access a ON a.station_id=p.station_id AND a.printer_id=p.id
      WHERE a.user_id=${user.id} AND p.enabled AND s.revoked_at IS NULL`;
    // Read-only explanation of why queued work is not being handed to the Pi,
    // mirroring the control gate in office_poll (scripts/office/schema.sql).
    // Informational only: separate query, failures fall back to no reason, and
    // nothing the Pi receives changes.
    const holds = new Map<string, string | null>();
    for (const stationId of new Set(printers.map(p => String(p.station_id)))) {
      try {
        const [row] = await sql`SELECT CASE
          WHEN NOT EXISTS(SELECT 1 FROM office_control_status cs WHERE cs.station_id=s.id) THEN NULL
          WHEN EXISTS(SELECT 1 FROM office_controls c WHERE c.station_id=s.id AND c.result IS NULL) THEN 'control_pending'
          WHEN EXISTS(SELECT 1 FROM office_control_status o WHERE o.station_id=s.id AND o.paused=false AND o.received_at>now()-interval '30 seconds'
            AND o.received_at>coalesce((SELECT max(c.resolved_at) FROM office_controls c WHERE c.station_id=s.id),'epoch'::timestamptz)) THEN NULL
          WHEN EXISTS(SELECT 1 FROM office_control_status o WHERE o.station_id=s.id AND o.paused AND o.received_at>now()-interval '30 seconds') THEN 'printer_paused'
          ELSE 'control_stale' END AS reason
          FROM office_stations s WHERE s.id=${stationId}`;
        holds.set(stationId, typeof row?.reason === 'string' ? row.reason : null);
      } catch { holds.set(stationId, null); }
    }
    // Read-only: which run's labels stop the shared printer for everyone (the
    // review gate in office_poll / office_enqueue), so every page can name the
    // run and labels and link to it. One line per send that needs a check,
    // oldest first. Informational only: failures fall back to none.
    const reviewHolds = new Map<string, Array<{run_id:string;run_name:string;from:number;to:number;did_not_print:boolean}>>();
    for (const stationId of new Set(printers.filter(p => p.needs_review).map(p => String(p.station_id)))) {
      try {
        const rows = await sql`SELECT r.run_id, coalesce(ru.name,'') AS run_name, min(j.range_from) AS range_from, max(j.range_to) AS range_to,
          bool_and(j.state='rejected') AS did_not_print, min(j.sequence) AS first_sequence
          FROM office_jobs j JOIN office_requests r ON r.id=j.request_id LEFT JOIN runs ru ON ru.id=r.run_id
          WHERE j.station_id=${stationId} AND (j.review_required OR (j.state='claimed' AND j.claimed_at<now()-interval '5 minutes') OR (j.state='submitted' AND j.submitted_at<now()-interval '30 minutes'))
          GROUP BY r.id, r.run_id, ru.name ORDER BY first_sequence LIMIT 5`;
        reviewHolds.set(stationId, rows.map(row => ({ run_id: String(row.run_id), run_name: String(row.run_name ?? ''), from: Number(row.range_from), to: Number(row.range_to), did_not_print: row.did_not_print === true })));
      } catch { reviewHolds.set(stationId, []); }
    }
    return json({printers:printers.map(p=>({...p,dispatch_hold_reason:holds.get(String(p.station_id)) ?? null,review_holds:reviewHolds.get(String(p.station_id)) ?? []})),canPrint:user.can_print,isAdmin:user.is_admin});
  }catch(error){return browserFailure(error);}
}
