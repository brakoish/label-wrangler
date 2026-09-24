// Real login/session checks; creates and revokes only this test's sessions.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
const base=process.argv[2] || 'http://127.0.0.1:3132';
const account=await fs.readFile('../private/office-printing/account-chilly.txt','utf8');
const credentials={username:account.match(/^Username: (.+)$/m)[1],password:account.match(/^Password: (.+)$/m)[1]};
const sql=neon(process.env.DATABASE_URL);
const request=(method,body,cookie)=>fetch(base+'/api/office/session',{method,headers:{Origin:new URL(base).origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
for(const [preference,seconds] of [[undefined,43200],[false,43200],[true,2592000]]){
 let cookie;
 try{
  const response=await request('POST',{...credentials,...(preference===undefined?{}:{staySignedIn:preference})});assert.equal(response.status,200);
  const header=response.headers.get('set-cookie');cookie=header.split(';')[0];
  assert.match(header,new RegExp('Max-Age='+seconds+'(?:;|$)','i'));assert.match(header,/HttpOnly/i);assert.match(header,/SameSite=strict/i);assert.match(header,/Secure/i);
  const hash=createHash('sha256').update(cookie.slice(cookie.indexOf('=')+1)).digest('hex');
  const rows=await sql`SELECT extract(epoch from (expires_at-now())) AS remaining FROM office_sessions WHERE token_hash=${hash}`;
  assert.equal(rows.length,1);assert.ok(Number(rows[0].remaining)<=seconds && Number(rows[0].remaining)>seconds-60);
  assert.ok((await(await request('GET',null,cookie)).json()).user);
  assert.equal((await request('DELETE',null,cookie)).status,200);
  assert.equal((await(await request('GET',null,cookie)).json()).user,null);
  console.log('PASS session '+seconds+' seconds: matching cookie/database expiry, authenticated read, logout invalidates token');
 }finally{if(cookie)await request('DELETE',null,cookie);}
}
assert.equal((await request('POST',{...credentials,staySignedIn:'true'})).status,400);
console.log('PASS invalid preference rejected; no print jobs or template changes');
