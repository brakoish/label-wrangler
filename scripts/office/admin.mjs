// Trusted local operator CLI. Credentials are generated to restricted files only.
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
import { statements } from './sql-statements.mjs';
import { neon } from '@neondatabase/serverless';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, randomUUID, createHash, scryptSync } from 'node:crypto';
loadEnvConfig(process.cwd(),false);
const sql=neon(process.env.DATABASE_URL);
const hash=(s)=>createHash('sha256').update(s).digest('hex');
const [command,arg]=process.argv.slice(2);
async function secretFile(name,value){
 const dir=resolve(process.cwd(),'../private/office-printing');
 await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
 const file=resolve(dir,name);await writeFile(file,value,{mode:0o600,flag:'wx'});return file;
}
try{
 if(command==='migrate'){
  const source=await readFile(new URL('./schema.sql',import.meta.url),'utf8')+'\n'+await readFile(new URL('./controls.sql',import.meta.url),'utf8');
  await sql.transaction(statements(source).map(statement=>sql.query(statement)));
  console.log('Office schema applied (additive).');
 }else if(command==='provision-station'){
  const exists=await sql`SELECT id FROM office_stations WHERE id='office-zebra-pi'`;
  if(exists.length)throw new Error('Station already exists; use rotate-station to replace its credential.');
  const token=randomBytes(32).toString('base64url');
  const file=await secretFile('station-token',token+'\n');
  await sql`INSERT INTO office_stations(id,token_hash) VALUES('office-zebra-pi',${hash(token)})`;
  await sql`INSERT INTO office_printers(station_id,id,name,serial,dpi,max_width_dots) VALUES('office-zebra-pi','black-zebra','Black Zebra - ZD411 (Pi)','DFJ244801186',203,448)`;
  console.log(file);
 }else if(command==='create-user'){
  if(!arg || !/^[a-z0-9._@+-]{1,100}$/.test(arg))throw new Error('Supply a lowercase username.');
  const password=randomBytes(24).toString('base64url');const salt=randomBytes(16).toString('hex');
  const verifier=salt+':'+scryptSync(password,salt,64).toString('hex');
  const file=await secretFile('account-'+arg+'.txt','Username: '+arg+'\nPassword: '+password+'\n');
  const id=randomUUID();const admin=process.argv.includes('--admin');
  await sql`INSERT INTO office_users(id,username,password_hash,can_print,can_edit,is_admin) VALUES(${id},${arg},${verifier},true,true,${admin})`;
  await sql`INSERT INTO office_printer_access(user_id,station_id,printer_id) VALUES(${id},'office-zebra-pi','black-zebra')`;
  console.log(file);
 }else if(command==='activate'){
  if(!process.argv.includes('--pairing-verified'))throw new Error('Requires --pairing-verified after the Pi setup agent verifies an authenticated empty poll.');
  const result=await sql`UPDATE office_stations SET paired_at=now(),dispatch_enabled=true WHERE id='office-zebra-pi' AND revoked_at IS NULL
   AND last_seen>now()-interval '30 seconds' AND EXISTS(SELECT 1 FROM jsonb_array_elements(advertised_printers) a WHERE a->>'id'='black-zebra' AND a->>'serial'='DFJ244801186' AND a->>'available'='true') RETURNING id`;
  if(!result.length)throw new Error('No recent authenticated healthy black-printer poll. Remains disabled.');
  console.log('Office Pi activated after verified pairing. No job was created.');
 }else if(command==='disable'){
  await sql`UPDATE office_stations SET dispatch_enabled=false WHERE id='office-zebra-pi'`;console.log('Dispatch disabled. Claimed/submitted jobs still require review.');
 }else if(command==='revoke-station'){
  await sql`UPDATE office_stations SET revoked_at=now(),dispatch_enabled=false WHERE id='office-zebra-pi'`;console.log('Station credential revoked; dispatch disabled.');
 }else if(command==='rotate-station'){
  const token=randomBytes(32).toString('base64url');const file=await secretFile('station-token-'+Date.now(),token+'\n');
  await sql`UPDATE office_stations SET token_hash=${hash(token)},revoked_at=NULL,dispatch_enabled=false,paired_at=NULL WHERE id='office-zebra-pi'`;console.log(file);
 }else if(command==='disable-user'){
  await sql`UPDATE office_users SET disabled=true WHERE username=${arg}`;console.log('User disabled; sessions can no longer authorize requests.');
 }else if(command==='status'){
  console.log(JSON.stringify(await sql`SELECT id,dispatch_enabled,paired_at,last_seen,revoked_at FROM office_stations`));
 }else throw new Error('Commands: migrate, provision-station, create-user USER [--admin], activate --pairing-verified, disable, revoke-station, rotate-station, disable-user USER, status');
}catch(error){console.error(error.message);process.exitCode=1;}
