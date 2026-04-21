// Add pinned_at column to runs table. Idempotent — safe to re-run.
import { neon } from '@neondatabase/serverless';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = neon(url);

await sql`ALTER TABLE runs ADD COLUMN IF NOT EXISTS pinned_at text`;
console.log('ok: pinned_at column ensured on runs');
