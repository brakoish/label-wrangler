/**
 * Where to go after signing in. Only same-origin paths are allowed: the value
 * is resolved the way the browser will resolve it, so tricks like
 * "/\t/evil.com" or "//evil.com" (which become another site) fall back.
 * The result is checked too: dot segments ("/.//evil.com") can resolve to a
 * path that starts with "//", which the browser reads as another site.
 */
export function safeNextPath(next: string | null | undefined, origin: string, fallback = '/runs'): string {
  if (!next) return fallback;
  try {
    const url = new URL(next, origin);
    if (url.origin !== origin) return fallback;
    const path = url.pathname + url.search + url.hash;
    // A same-origin path must still read as one when used as a link.
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return fallback;
    return new URL(path, origin).origin === origin ? path : fallback;
  } catch { return fallback; }
}
