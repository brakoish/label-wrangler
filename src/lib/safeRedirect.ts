/**
 * Where to go after signing in. Only same-origin paths are allowed: the value
 * is resolved the way the browser will resolve it, so tricks like
 * "/\t/evil.com" or "//evil.com" (which become another site) fall back.
 */
export function safeNextPath(next: string | null | undefined, origin: string, fallback = '/runs'): string {
  if (!next) return fallback;
  try {
    const url = new URL(next, origin);
    return url.origin === origin ? url.pathname + url.search + url.hash : fallback;
  } catch { return fallback; }
}
