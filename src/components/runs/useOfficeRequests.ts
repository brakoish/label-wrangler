'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { jobsOfRequests, officeDeliverySummary, OFFICE_IN_PROGRESS, type OfficeDeliverySummary } from '@/lib/officeRange';

export interface OfficeJob { id: string; from: number; to: number; count: number; state: string; review: boolean; reason: string | null; cupsJobId: number | null }
export interface OfficeRequest { id: string; range_from: number; range_to: number; reprint_of: string | null; username: string; created_at?: string; jobs: OfficeJob[] }

/**
 * The run's office print requests (read-only GET /api/office/jobs), shared by
 * the run header, the progress line and the office printer panel. Polls fast
 * while anything is on its way or the office printer is the chosen printer,
 * slowly otherwise. An account without office printer access just sees none.
 */
export function useOfficeRequests(runId: string, fast: boolean, total: number) {
  const [requests, setRequests] = useState<OfficeRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState<{ status: number; message: string } | null>(null);
  const active = useRef(true);
  const denied = useRef(false);
  const refresh = useCallback(async () => {
    const response = await fetch('/api/office/jobs?runId=' + encodeURIComponent(runId), { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!active.current) return;
    denied.current = response.status === 401 || response.status === 403;
    if (!response.ok) { setFailed({ status: response.status, message: typeof data.error === 'string' ? data.error : '' }); setLoaded(true); throw Object.assign(new Error(data.error || 'Request failed'), { status: response.status }); }
    setRequests(Array.isArray(data.requests) ? data.requests : []);
    setFailed(null); setLoaded(true);
  }, [runId]);
  const jobs = useMemo(() => jobsOfRequests(requests), [requests]);
  const moving = jobs.some((job) => OFFICE_IN_PROGRESS.includes(job.state));
  useEffect(() => {
    active.current = true;
    // An account without office printer access stops asking until the office
    // printer is chosen on this page.
    const update = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (!fast && denied.current) return;
      void refresh().catch(() => { /* shown by the panel */ });
    };
    update();
    const timer = setInterval(update, fast || moving ? 5000 : 30000);
    return () => { active.current = false; clearInterval(timer); };
  }, [refresh, fast, moving]);
  const summary: OfficeDeliverySummary = useMemo(() => officeDeliverySummary(jobs, total), [jobs, total]);
  return { requests, jobs, summary, loaded, failed, refresh };
}
