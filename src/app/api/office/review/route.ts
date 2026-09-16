import { body, json, failure, uuid, OfficeError } from '@/lib/office/http';
import { requireUser, requirePrinter } from '@/lib/office/auth';
import { officeSql } from '@/lib/office/db';
export async function POST(req: Request){
  try{
    const user=await requireUser(req,'print');const data=await body(req);
    if(!uuid(data.jobId) || data.pendingCupsResolved!==true || typeof data.reason!=='string' || data.reason.trim().length<3 || data.reason.length>500)throw new OfficeError('Confirm pending CUPS work is resolved and record what happened');
    const sql=officeSql();const jobs=await sql`SELECT station_id,printer_id FROM office_jobs WHERE id=${data.jobId}`;
    if(!jobs.length)throw new OfficeError('Job not found',404);
    await requirePrinter(user,jobs[0].station_id,jobs[0].printer_id);
    await sql`SELECT office_resolve(${user.id}::uuid,${data.jobId}::uuid,${data.reason})`;
    return json({ok:true});
  }catch(error){return failure(error);}
}
