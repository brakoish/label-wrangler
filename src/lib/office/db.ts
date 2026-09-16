import { neon } from '@neondatabase/serverless';

// Separate SQL functions keep multi-step queue transitions atomic over Neon HTTP.
export function officeSql() {
  return neon(process.env.DATABASE_URL!);
}
