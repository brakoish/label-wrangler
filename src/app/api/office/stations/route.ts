import { json, failure } from '@/lib/office/http';
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
    return json({printers:printers.map(p=>({...p,dispatch_hold_reason:holds.get(String(p.station_id)) ?? null})),canPrint:user.can_print,isAdmin:user.is_admin});
  }catch(error){return failure(error);}
}
