'use client';
import { useEffect, useState } from 'react';
import { officeStatusLine, type OfficeReviewHold } from '@/lib/officeSendOutcome';

type StationPrinter = { online: boolean; available?: boolean; dispatch_enabled: boolean; paired_at?: string | null; needs_review: boolean; dispatch_hold_reason?: string | null; review_holds?: OfficeReviewHold[] | null };

/** The shared office printer is paused or stopped for a check, so queued labels wait. */
export function officePrinterHeld(printers: ReadonlyArray<StationPrinter> | null | undefined): boolean {
  const printer = printers?.find((p) => p.dispatch_enabled && p.paired_at);
  if (!printer) return false;
  const status = officeStatusLine(printer);
  return status.stopped || status.paused;
}

/**
 * Whether the office printer is paused or held, for the run header while the
 * office panel isn't open (read-only GET /api/office/stations, the same read
 * the panel and the Runs list make). Reads only while `enabled`, faster while
 * held, never while the page is hidden.
 */
export function useOfficeHeld(enabled: boolean): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!enabled) { setHeld(false); return; }
    let active = true;
    const read = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      try {
        const response = await fetch('/api/office/stations', { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        if (active && Array.isArray(data?.printers)) setHeld(officePrinterHeld(data.printers));
      } catch { /* tries again on the next read */ }
    };
    void read();
    const timer = setInterval(() => void read(), 10000);
    const onVisible = () => { if (document.visibilityState === 'visible') void read(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [enabled]);
  return held;
}
