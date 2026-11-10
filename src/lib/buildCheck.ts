/**
 * True when the server now runs a different build than the one this page
 * loaded with. Unknown on either side (local development, an old server)
 * never asks for a reload.
 */
export function buildChanged(loaded: string | null | undefined, now: string | null | undefined): boolean {
  return !!loaded && !!now && loaded !== now;
}

/**
 * The build stamp built into the page (a 16-character hash), or undefined
 * when the build couldn't tell, so the page learns it from its first check.
 */
export function builtInBuild(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && /^[a-f0-9]{16}$/.test(value) ? value : undefined;
}

/**
 * What a non-OK answer from /api/version means. A 404 means the server now
 * runs a build without that route (a rollback to an older build), so this
 * page is out of date. That only counts once this tab knows its own build
 * came with the route: its built-in stamp, or an earlier OK answer. Anything
 * else (a 5xx, a 401, a 429) is trouble, not a new version: try again later.
 * Network errors never reach here (the fetch throws).
 */
export function versionRouteGone(status: number, knewRoute: boolean): boolean {
  return status === 404 && knewRoute;
}
