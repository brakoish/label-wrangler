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
    return json({printers,canPrint:user.can_print,isAdmin:user.is_admin});
  }catch(error){return failure(error);}
}
