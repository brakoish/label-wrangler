// Additive migration: preserves every template and all run/preset references.
// Usage: node --env-file=.env.local scripts/archive_templates.mjs
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
await sql`ALTER TABLE templates ADD COLUMN IF NOT EXISTS archived_at text`;
console.log('Template archive column ready');
