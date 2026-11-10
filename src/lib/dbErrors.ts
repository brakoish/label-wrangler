/** Postgres foreign-key violation (SQLSTATE 23503), whether the driver error
 * is thrown directly or wrapped by the query builder. */
export function isForeignKeyViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current && typeof current === 'object' && depth < 5; depth++) {
    if ((current as { code?: unknown }).code === '23503') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
