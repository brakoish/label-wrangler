import { body, json, browserFailure, OfficeError } from '@/lib/office/http';
import { requireUser } from '@/lib/office/auth';
import { officeSql } from '@/lib/office/db';
import { createJobs } from '@/lib/office/jobs';
export const maxDuration=300;
/** Sends listed per run (newest first). */
const REQUEST_LIMIT=100;
export async function POST(req: Request){
  try{return json(await createJobs(await requireUser(req,'print'),await body(req)));}catch(error){return browserFailure(error);}
}
export async function GET(req: Request){
  try{
    const user=await requireUser(req);const runId=new URL(req.url).searchParams.get('runId');
    if(!runId || runId.length>200)throw new OfficeError('Run ID required');
    const sql=officeSql();
    const found=await sql`SELECT r.id,r.range_from,r.range_to,r.reprint_of,r.reason,r.created_at,u.username,
      coalesce(jsonb_agg(jsonb_build_object('id',j.id,'from',j.range_from,'to',j.range_to,'count',j.label_count,
        'state',j.state,'review',j.review_required OR (j.state='claimed' AND j.claimed_at<now()-interval '5 minutes') OR (j.state='submitted' AND j.submitted_at<now()-interval '30 minutes'),
        'reason',j.reason,'cupsJobId',j.cups_job_id) ORDER BY j.sequence) FILTER(WHERE j.id IS NOT NULL),'[]') AS jobs
      FROM office_requests r JOIN office_users u ON u.id=r.requester JOIN office_printer_access a ON a.station_id=r.station_id AND a.printer_id=r.printer_id AND a.user_id=${user.id}
      LEFT JOIN office_jobs j ON j.request_id=r.id WHERE r.run_id=${runId} GROUP BY r.id,u.username ORDER BY r.created_at DESC LIMIT ${REQUEST_LIMIT+1}`;
    if (found.length <= REQUEST_LIMIT) return json({requests:found});
    const requests=found.slice(0,REQUEST_LIMIT);
    // More sends than the list shows: say so (truncated), and give every job
    // of the run in a compact form so the page plans from all of them.
    // Additive and read-only.
    const jobs=await sql`SELECT j.id,j.request_id AS "requestId",j.range_from AS "from",j.range_to AS "to",j.state,
      (j.review_required OR (j.state='claimed' AND j.claimed_at<now()-interval '5 minutes') OR (j.state='submitted' AND j.submitted_at<now()-interval '30 minutes')) AS review,j.reason
      FROM office_jobs j JOIN office_requests r ON r.id=j.request_id JOIN office_printer_access a ON a.station_id=r.station_id AND a.printer_id=r.printer_id AND a.user_id=${user.id}
      WHERE r.run_id=${runId} ORDER BY j.sequence LIMIT 20000`;
    return json({requests,truncated:true,limit:REQUEST_LIMIT,jobs});
  }catch(error){return browserFailure(error);}
}
