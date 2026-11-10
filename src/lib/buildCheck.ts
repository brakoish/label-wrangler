/**
 * True when the server now runs a different build than the one this page
 * loaded with. Unknown on either side (local development, an old server)
 * never asks for a reload.
 */
export function buildChanged(loaded: string | null | undefined, now: string | null | undefined): boolean {
  return !!loaded && !!now && loaded !== now;
}
