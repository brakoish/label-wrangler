'use client';
import { useEffect, useState } from 'react';

export interface KioskStatus { ready: boolean; kiosk: boolean; canEdit: boolean; canPrint: boolean; username: string }

/** One read per page load (pages share it as you move around); a failed read is tried again next time. */
let cached: Promise<KioskStatus | null> | null = null;
export function fetchKioskStatus(fresh = false): Promise<KioskStatus | null> {
  if (!cached || fresh) {
    cached = fetch('/api/kiosk/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() as Promise<KioskStatus> : null))
      .catch(() => null)
      .then((status) => { if (!status) cached = null; return status; });
  }
  return cached;
}

/** undefined while reading; null when it couldn't be read (signed out, offline). */
export function useKioskStatus(): KioskStatus | null | undefined {
  const [status, setStatus] = useState<KioskStatus | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void fetchKioskStatus().then((value) => { if (active) setStatus(value); });
    return () => { active = false; };
  }, []);
  return status;
}

/** Sign the kiosk (or anyone) out: the kiosk hint first, then the session. */
export async function signOutEverywhere(): Promise<boolean> {
  await fetch('/api/kiosk/status', { method: 'DELETE' }).catch(() => {});
  cached = null;
  const result = await fetch('/api/office/session', { method: 'DELETE' });
  return result.ok;
}
