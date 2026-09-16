import { randomUUID } from 'node:crypto';
import { requireUser,requirePrinter } from '@/lib/office/auth';
import { body,json,failure,uuid,OfficeError } from '@/lib/office/http';
import { officeSql } from '@/lib/office/db';
export async function GET(req:Request){try{
 const user=await requireUser(req);await requirePrinter(user,'office-zebra-pi','black-zebra');const sql=officeSql();
 const [permission]=await sql`SELECT can_control FROM office_users WHERE id=${user.id}`;
 const [status]=await sql`SELECT paused,received_at,(received_at>now()-interval '30 seconds') AS fresh FROM office_control_status WHERE station_id='office-zebra-pi' AND printer_id='black-zebra'`;
 const controls=await sql`SELECT c.id,c.action,c.created_at,c.expires_at,c.result,c.resolved_at,u.username FROM office_controls c JOIN office_users u ON u.id=c.requester WHERE c.station_id='office-zebra-pi' AND c.printer_id='black-zebra' ORDER BY c.created_at DESC LIMIT 10`;
 return json({canControl:permission.can_control,status:status||null,controls});
}catch(e){return failure(e);}}
export async function POST(req:Request){try{
 const user=await requireUser(req);await requirePrinter(user,'office-zebra-pi','black-zebra');const d=await body(req);
 if(!['pause','resume'].includes(String(d.action)) || !uuid(d.idempotencyKey))throw new OfficeError('Invalid control');
 const sql=officeSql();const [permission]=await sql`SELECT can_control FROM office_users WHERE id=${user.id}`;if(!permission.can_control)throw new OfficeError('Printer control permission required',403);
 const [r]=await sql`SELECT office_control_create(${user.id},'office-zebra-pi','black-zebra',${String(d.action)},${d.idempotencyKey},${randomUUID()}) AS id`;
 return json({id:r.id});
}catch(e){return failure(e);}}
