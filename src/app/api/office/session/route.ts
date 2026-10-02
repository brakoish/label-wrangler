import { cookies } from 'next/headers';
import { body, json, failure, sameOrigin, OfficeError } from '@/lib/office/http';
import { currentUser, login, COOKIE, hash } from '@/lib/office/auth';
import { officeSql } from '@/lib/office/db';
export async function GET(){try{return json({user:await currentUser()});}catch(error){return failure(error);}}
export async function POST(req: Request){
  try{
    sameOrigin(req);const data=await body(req,2048);
    if(typeof data.username!=='string' || !/^[a-zA-Z0-9._@+-]{1,100}$/.test(data.username) || typeof data.password!=='string' || data.password.length>256)throw new OfficeError('Invalid login');
    if(data.staySignedIn !== undefined && typeof data.staySignedIn !== 'boolean')throw new OfficeError('Invalid sign-in preference');
    return json(await login(data.username,data.password,data.staySignedIn === true));
  }catch(error){return failure(error);}
}
export async function DELETE(req: Request){
  try{
    sameOrigin(req);const jar=await cookies();const token=jar.get(COOKIE)?.value;
    if(token){const sql=officeSql();await sql`DELETE FROM office_sessions WHERE token_hash=${hash(token)}`;}
    jar.delete(COOKIE);return json({ok:true});
  }catch(error){return failure(error);}
}
