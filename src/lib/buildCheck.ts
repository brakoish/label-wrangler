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
