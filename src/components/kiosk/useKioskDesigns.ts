'use client';
import { useCallback, useEffect, useState } from 'react';
import type { KioskDesignsAnswer } from '@/lib/kiosk/types';
import type { KioskCategory } from '@/lib/kiosk/plan';
import { friendlyError } from '@/lib/userMessages';

const EMPTY: KioskDesignsAnswer = { ready: false, categoriesReady: false, ids: [], categories: {}, canEdit: false };

/**
 * Which designs are on the kiosk and each design's categories, for the
 * Designs list (the owner's switches) and New run (designs for a product's
 * category first). Until kiosk mode is set up, `ready` stays false and the
 * switches don't show.
 */
export function useKioskDesigns() {
  const [state, setState] = useState<KioskDesignsAnswer>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetch('/api/kiosk/designs', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() as Promise<KioskDesignsAnswer> : null))
      .then((data) => { if (active && data) setState({ ...EMPTY, ...data }); })
      .catch(() => {})
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);
  const save = useCallback(async (templateId: string, change: { kiosk?: boolean; categories?: KioskCategory[] }) => {
    setBusy(templateId); setError('');
    try {
      const response = await fetch('/api/kiosk/designs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId, ...change }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'That didn’t save. Try again.');
      setState({ ...EMPTY, ...data });
      return true;
    } catch (e) {
      setError(friendlyError(e, 'That didn’t save. Try again.'));
      return false;
    } finally { setBusy(null); }
  }, []);
  return { ...state, loaded, busy, error, save };
}
