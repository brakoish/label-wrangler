import { json, failure, uuid, OfficeError } from '@/lib/office/http';
import { requireUser } from '@/lib/office/auth';
import { officeSql } from '@/lib/office/db';
import { requestAccess } from '@/lib/office/jobs';
export async function DELETE(req: Request,{params}:{params:Promise<{id:string}>}){
  try{
    const user=await requireUser(req,'print');const {id}=await params;if(!uuid(id))throw new OfficeError('Invalid request ID');
    await requestAccess(user,id);const sql=officeSql();const result=await sql`SELECT office_cancel(${user.id}::uuid,${id}::uuid) AS result`;
    return json(result[0].result);
  }catch(error){return failure(error);}
}
