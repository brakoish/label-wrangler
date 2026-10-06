// Read-only backup plus transactional temporary-table restore rehearsal.
// Contains confidential application data: output must remain private/off-repository.
require('@next/env').loadEnvConfig(process.cwd(),false);
const {neon,Pool,neonConfig}=require('@neondatabase/serverless');
neonConfig.webSocketConstructor=WebSocket;
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const dir=process.argv[2];if(!dir||!path.isAbsolute(dir)||dir.startsWith(process.cwd()+'/'))throw Error('Provide an absolute private backup directory outside the repository');
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 const sql=neon(process.env.DATABASE_URL);
 const tables=['formats','templates','runs','run_presets','global_elements','run_print_events'];
 const backup={createdAt:new Date().toISOString(),tables:{}};
 const pool=new Pool({connectionString:process.env.DATABASE_URL});
 const client=await pool.connect();
 try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  for(const t of tables){
   const rows=[];
   for(let offset=0;;offset+=10){const page=await client.query(`SELECT * FROM ${t} ORDER BY id LIMIT 10 OFFSET $1`,[offset]);rows.push(...page.rows);if(page.rows.length<10)break;}
   backup.tables[t]=rows;
  }
  await client.query('COMMIT');
 } finally {client.release();await pool.end();}
 const file=path.join(dir,'label-data-'+Date.now()+'.json');await fs.writeFile(file,JSON.stringify(backup),{mode:0o600});
 const restorePool=new Pool({connectionString:process.env.DATABASE_URL});
 const restore=await restorePool.connect();
 try {
  for(const t of tables){
   const rows=backup.tables[t];
   await restore.query('BEGIN');
   await restore.query(`CREATE TEMP TABLE restore_check (LIKE ${t} INCLUDING DEFAULTS) ON COMMIT DROP`);
   for(let offset=0;offset<rows.length;offset+=10)await restore.query(`INSERT INTO restore_check SELECT * FROM jsonb_populate_recordset(NULL::restore_check,$1::jsonb)`,[JSON.stringify(rows.slice(offset,offset+10))]);
   const count=await restore.query('SELECT count(*)::int AS count FROM restore_check');assert.equal(count.rows[0].count,rows.length);
   for(let offset=0;offset<rows.length;offset+=10){const page=await restore.query('SELECT * FROM restore_check ORDER BY id LIMIT 10 OFFSET $1',[offset]);assert.deepEqual(page.rows,rows.slice(offset,offset+10));}
   await restore.query('COMMIT');
  }
 } finally {restore.release();await restorePool.end();}
 console.log(JSON.stringify({backup:file,restoredTables:tables.length,counts:Object.fromEntries(tables.map(t=>[t,backup.tables[t].length])),productionWrites:0}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
