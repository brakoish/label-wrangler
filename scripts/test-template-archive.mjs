// Transaction-scoped regression check; all synthetic records are rolled back.
// Usage: node --env-file=.env.local scripts/test-template-archive.mjs
import assert from 'node:assert/strict';
import { Pool, neonConfig } from '@neondatabase/serverless';
neonConfig.webSocketConstructor = WebSocket;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const id = `archive-test-${crypto.randomUUID()}`;
  await client.query(`INSERT INTO formats (id,name,type,width,height,created_at,updated_at) VALUES ($1,'Archive test','thermal',2,1,'test','test')`, [id]);
  await client.query(`INSERT INTO templates (id,name,format_id,elements,created_at,updated_at) VALUES ($1,'Archive test',$1,'[]','test','test')`, [id]);
  await client.query(`INSERT INTO runs (id,name,template_id,created_at,updated_at) VALUES ($1,'Archive test',$1,'test','test')`, [id]);
  await client.query('SAVEPOINT deletion');
  await assert.rejects(client.query('DELETE FROM templates WHERE id=$1', [id]), { code: '23503' });
  await client.query('ROLLBACK TO SAVEPOINT deletion');
  await client.query("UPDATE templates SET archived_at='test' WHERE id=$1", [id]);
  const { rows } = await client.query('SELECT t.archived_at,t.elements FROM runs r JOIN templates t ON t.id=r.template_id WHERE r.id=$1', [id]);
  assert.equal(rows[0].archived_at, 'test');
  assert.deepEqual(rows[0].elements, []);
  await client.query('UPDATE templates SET archived_at=NULL WHERE id=$1', [id]);
  const restored = await client.query('SELECT id FROM templates WHERE id=$1 AND archived_at IS NULL', [id]);
  assert.equal(restored.rowCount, 1);
  console.log('PASS: delete blocked by saved run; archive preserves run/template; restore succeeds.');
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}
