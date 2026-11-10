'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { jobsOfRequests, officeDeliverySummary, OFFICE_IN_PROGRESS, type OfficeDeliverySummary, type OfficeSpan } from '@/lib/officeRange';

export interface OfficeJob { id: string; from: number; to: number; count: number; state: string; review: boolean; reason: string | null; cupsJobId: number | null }
export interface OfficeRequest { id: string; range_from: number; range_to: number; reprint_of: string | null; username: string; created_at?: string; jobs: OfficeJob[] }
/** Every job of the run in compact form, sent by the server when the request list is cut at 100. */
export interface OfficeJobBrief { id: string; requestId: string; /** When its send was made (the server's clock). */ requestAt?: string; from: number; to: number; state: string; review: boolean; reason: string | null }

/**
 * The run's office print requests (read-only GET /api/office/jobs), shared by
 * the run header, the progress line and the office printer panel. Polls fast
 * while anything is on its way or the office printer is the chosen printer,
 * slowly otherwise, and not while the page is hidden. An account without
 * office printer access just sees none.
 *
 * `jobs` is every job of the run: when the server lists only the latest 100
 * sends it also sends a compact list of all jobs, and plans use that.
 * `everLoaded` is true once one read succeeded; nothing new is sent before.
 * `done` (labels counted printed, ranges confirmed at the office) only decides
 * which checked parts still need printing again.
 */
export function useOfficeRequests(runId: string, fast: boolean, total: number, done?: { printedCount: number; printedSpans: ReadonlyArray<OfficeSpan> }) {
  const [requests, setRequests] = useState<OfficeRequest[]>([]);
  const [allJobs, setAllJobs] = useState<OfficeJobBrief[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [everLoaded, setEverLoaded] = useState(false);
  const [failed, setFailed] = useState<{ status: number; message: string } | null>(null);
  // Another run on the same page (Next.js may keep this component): start
  // empty, so nothing of the last run shows and nothing is sent before this
  // run's first read (React's reset-on-prop-change pattern).
  const [shownRun, setShownRun] = useState(runId);
  if (shownRun !== runId) {
    setShownRun(runId);
    setRequests([]); setAllJobs(null); setTruncated(false); setLoaded(false); setEverLoaded(false); setFailed(null);
  }
  /** The run this page shows now (null once it has left): a late answer for any other run is dropped. */
  const currentRun = useRef<string | null>(runId);
  useEffect(() => { currentRun.current = runId; return () => { currentRun.current = null; }; }, [runId]);
  /** The run whose read was refused (no office access). */
  const denied = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    const response = await fetch('/api/office/jobs?runId=' + encodeURIComponent(runId), { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (currentRun.current !== runId) return;
    denied.current = response.status === 401 || response.status === 403 ? runId : null;
    if (!response.ok) { setFailed({ status: response.status, message: typeof data.error === 'string' ? data.error : '' }); setLoaded(true); throw Object.assign(new Error(data.error || 'Request failed'), { status: response.status }); }
    setRequests(Array.isArray(data.requests) ? data.requests : []);
    setTruncated(data.truncated === true);
    setAllJobs(data.truncated === true && Array.isArray(data.jobs) ? data.jobs : null);
    setFailed(null); setLoaded(true); setEverLoaded(true);
  }, [runId]);
  const listed = useMemo(() => jobsOfRequests(requests), [requests]);
  const jobs: Array<OfficeJobBrief & { count?: number; cupsJobId?: number | null }> = allJobs ?? listed;
  const moving = jobs.some((job) => OFFICE_IN_PROGRESS.includes(job.state));
  useEffect(() => {
    // An account without office printer access stops asking until the office
    // printer is chosen on this page.
    const update = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (!fast && denied.current === runId) return;
      void refresh().catch(() => { /* shown by the panel */ });
    };
    update();
    // Every 5 s while labels are on their way, 15 s while the office printer
    // is chosen but nothing moves (the list can be long), 30 s otherwise.
    const timer = setInterval(update, moving ? 5000 : fast ? 15000 : 30000);
    const onVisible = () => { if (document.visibilityState === 'visible') update(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh, fast, moving, runId]);
  const printedCount = done?.printedCount ?? 0;
  const printedSpans = done?.printedSpans;
  const summary: OfficeDeliverySummary = useMemo(() => officeDeliverySummary(jobs, total, { printedCount, printedSpans }), [jobs, total, printedCount, printedSpans]);
  /** Changes whenever any job moves, so the page can re-read its print history. */
  const signature = useMemo(() => jobs.map((job) => `${job.id}:${job.state}:${job.review ? 1 : 0}`).join(','), [jobs]);
  return { requests, jobs, summary, loaded, everLoaded, truncated, failed, refresh, signature };
}
