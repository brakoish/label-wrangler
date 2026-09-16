import { body, json, failure, OfficeError } from '@/lib/office/http';
import { requireUser } from '@/lib/office/auth';
import { officeSql } from '@/lib/office/db';
import { createJobs } from '@/lib/office/jobs';
export const maxDuration=60;
export async function POST(req: Request){
  try{return json(await createJobs(await requireUser(req,'print'),await body(req)));}catch(error){return failure(error);}
}
export async function GET(req: Request){
  try{
    const user=await requireUser(req);const runId=new URL(req.url).searchParams.get('runId');
    if(!runId || runId.length>200)throw new OfficeError('Run ID required');
    const sql=officeSql();
    const requests=await sql`SELECT r.id,r.range_from,r.range_to,r.reprint_of,r.reason,r.created_at,u.username,
      coalesce(jsonb_agg(jsonb_build_object('id',j.id,'from',j.range_from,'to',j.range_to,'count',j.label_count,
        'state',j.state,'review',j.review_required OR (j.state='claimed' AND j.claimed_at<now()-interval '5 minutes') OR (j.state='submitted' AND j.submitted_at<now()-interval '30 minutes'),
        'reason',j.reason,'cupsJobId',j.cups_job_id) ORDER BY j.sequence) FILTER(WHERE j.id IS NOT NULL),'[]') AS jobs
      FROM office_requests r JOIN office_users u ON u.id=r.requester JOIN office_printer_access a ON a.station_id=r.station_id AND a.printer_id=r.printer_id AND a.user_id=${user.id}
      LEFT JOIN office_jobs j ON j.request_id=r.id WHERE r.run_id=${runId} GROUP BY r.id,u.username ORDER BY r.created_at DESC LIMIT 100`;
    return json({requests});
  }catch(error){return failure(error);}
}
