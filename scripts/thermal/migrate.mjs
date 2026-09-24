import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
await sql`ALTER TABLE templates ADD COLUMN IF NOT EXISTS thermal_render_mode text NOT NULL DEFAULT 'native-v1'`;
console.log('Thermal render mode ready; existing templates unchanged.');
