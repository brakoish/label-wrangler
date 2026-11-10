/**
 * The saved pause/resume request for the office printer, per account. Older
 * builds (main) kept one per device under LEGACY_KEY and retry it with the
 * same idempotency key, so a request found there is copied to the account's
 * key, never moved: the old key goes only once that same request is settled.
 * Endpoint, payload and keys are unchanged.
 */
export const LEGACY_KEY = 'lw:office-control-pending';
export const controlPendingKey = (userId?: string) => (userId ? `${LEGACY_KEY}:${userId}` : LEGACY_KEY);
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null | undefined;

const idempotencyKeyOf = (raw: string | null): string | null => {
  try { const key = raw ? JSON.parse(raw)?.idempotencyKey : null; return typeof key === 'string' ? key : null; }
  catch { return null; }
};

/** The saved request (JSON text), or null. */
export function readSavedControl(storage: Store, userId?: string): string | null {
  try {
    const own = storage?.getItem(controlPendingKey(userId));
    if (own) return own;
    const legacy = userId ? storage?.getItem(LEGACY_KEY) ?? null : null;
    if (legacy && userId) storage?.setItem(controlPendingKey(userId), legacy);
    return legacy;
  } catch { return null; }
}

/** The saved request is settled (or unreadable): forget it, and the device-wide copy of the same request. */
export function clearSavedControl(storage: Store, userId?: string): void {
  try {
    const key = controlPendingKey(userId);
    const own = storage?.getItem(key) ?? null;
    storage?.removeItem(key);
    if (key === LEGACY_KEY) return;
    const legacy = storage?.getItem(LEGACY_KEY) ?? null;
    const ownKey = idempotencyKeyOf(own);
    // Only the same request: a different one belongs to a tab on the older build.
    if (legacy && ownKey && (ownKey === idempotencyKeyOf(legacy) || !idempotencyKeyOf(legacy))) storage?.removeItem(LEGACY_KEY);
  } catch { /* nothing saved */ }
}

/**
 * The account's own saved request only (JSON text), or null. A device-wide
 * request from an older build is never taken over silently: on a shared
 * device it may be someone else's, so the page asks first (readLegacyControl).
 */
export function readOwnControl(storage: Store, userId?: string): string | null {
  try { return storage?.getItem(controlPendingKey(userId)) ?? null; } catch { return null; }
}

/** The device-wide request an older build saved, when this account has none of its own. */
export function readLegacyControl(storage: Store, userId?: string): string | null {
  try {
    if (!userId || storage?.getItem(controlPendingKey(userId))) return null;
    return storage?.getItem(LEGACY_KEY) ?? null;
  } catch { return null; }
}
