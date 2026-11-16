'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Hand, Loader2, Printer as PrinterIcon, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { generateLabelsForRunWithImages } from '@/lib/runBuilder';
import { capAfterSizeError, jobsOfRequests, officeSendCap, officeSendParts, officeSendPlan, OFFICE_BITMAP_LABELS_PER_SEND, OFFICE_MAX_LABELS, type OfficeJobLike, type OfficeSpan } from '@/lib/officeRange';
import { officeStatusLine, plainJobReason, plainOfficeRefusal, sendKeepsRequest, type OfficeReviewHold } from '@/lib/officeSendOutcome';
import { useOfficeRequests, type OfficeRequest } from '@/components/runs/useOfficeRequests';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { friendlyError } from '@/lib/userMessages';
import { KIOSK_REPRINT_REASON, bitmapDigestSource, kioskLabelValues, kioskLabelsSent, kioskPhase, kioskTestCount, rebuildKioskFlow, type KioskFlowState } from '@/lib/kiosk/plan';
import type { Run } from '@/lib/types';
import { KioskPreview } from './KioskPreview';

/**
 * One kiosk print, start to finish: a test of the first 12 labels, the
 * question "Do these look right?", then the rest. Every send goes through the
 * office printer's own endpoint (POST /api/office/jobs) with a key saved on
 * this device first, exactly like the run page, so a lost answer is sent
 * again with the same key and never prints twice. The server's own rules
 * (no overlapping sends; a repeat is a reprint with a reason) are planned for
 * with the same helpers the run page uses.
 */

interface Printer { station_id: string; id: string; name: string; online: boolean; available: boolean; dispatch_enabled: boolean; paired_at: string | null; needs_review: boolean; dispatch_hold_reason?: string | null; review_holds?: OfficeReviewHold[] }
interface SendPayload { runId: string; stationId: string; printerId: string; from: number; to: number; idempotencyKey: string; reprintOf?: string; reason?: string; expectedBitmapDigest?: string }
type Group = 'test' | 'rest';
interface SavedFlow extends KioskFlowState { pending?: { payload: SendPayload; group: Group } }

class SendError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers }, cache: 'no-store' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new SendError(typeof result.error === 'string' ? result.error : 'Request failed', response.status, typeof result.code === 'string' ? result.code : undefined);
  return result;
}
/** The run's office sends, read fresh (for planning a send). */
async function readRequests(runId: string): Promise<{ requests: OfficeRequest[]; jobs: Array<OfficeJobLike & { requestId: string }> }> {
  const data = await api('/api/office/jobs?runId=' + encodeURIComponent(runId));
  const requests: OfficeRequest[] = Array.isArray(data.requests) ? data.requests : [];
  return { requests, jobs: data.truncated === true && Array.isArray(data.jobs) ? data.jobs : jobsOfRequests(requests) };
}
/** Is the send saved under this key at the office? Its id, null when not, undefined when it couldn't be read. */
async function lookUpSend(runId: string, key: string): Promise<string | null | undefined> {
  try {
    const data = await api(`/api/office/jobs?runId=${encodeURIComponent(runId)}&key=${encodeURIComponent(key)}`);
    return typeof data.keyRequestId === 'string' ? data.keyRequestId : data.keyRequestId === null ? null : undefined;
  } catch { return undefined; }
}
async function sha256(text: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}
const labels = (n: number) => (n === 1 ? '1 label' : `${n.toLocaleString('en-US')} labels`);
function readSaved(key: string): SavedFlow | null {
  try { const raw = localStorage.getItem(key); const data = raw ? JSON.parse(raw) as SavedFlow : null; return data && Array.isArray(data.testIds) && Array.isArray(data.restPlan) ? data : null; } catch { return null; }
}

export interface KioskPrintJob {
  runId: string;
  /** 'first': the print made at the kiosk. 'reprint': labels 1..count of a run printed again. */
  mode: 'first' | 'reprint';
  count: number;
  /** For a first print: where its 12-label check stands on the server. */
  stage?: 'test' | 'approved' | 'stopped';
  title: string;
  designName: string;
}

export function KioskPrinter({ job, onFinished }: { job: KioskPrintJob; onFinished: () => void }) {
  const { runId, mode, count } = job;
  const storageKey = `lw:kiosk-flow:${mode}:${runId}`;
  const [run, setRun] = useState<Run | null>(null);
  const [loadError, setLoadError] = useState('');
  const [printer, setPrinter] = useState<Printer | undefined>();
  const [stationsRead, setStationsRead] = useState(false);
  const [flow, setFlowState] = useState<SavedFlow | null>(null);
  const [cap, setCap] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [unsure, setUnsure] = useState(false);
  const [working, setWorking] = useState('');
  const [answering, setAnswering] = useState(false);
  const inFlight = useRef(false);
  const flowRef = useRef<SavedFlow | null>(null);

  const design = run?.designSnapshot ?? null;
  const template = design?.template ?? null;
  const format = design?.format ?? null;
  const across = Math.max(1, format?.labelsAcross || 1);
  const bitmap = template?.thermalRenderMode === 'bitmap-v1';
  const office = useOfficeRequests(runId, true, run?.totalLabels ?? count);

  const setFlow = useCallback((next: SavedFlow | null) => {
    flowRef.current = next; setFlowState(next);
    try { if (next) localStorage.setItem(storageKey, JSON.stringify(next)); else localStorage.removeItem(storageKey); } catch { /* the page still has it */ }
  }, [storageKey]);

  // The run, as saved (its design is a snapshot, so the labels never change under it).
  useEffect(() => {
    let active = true;
    api('/api/runs/' + encodeURIComponent(runId))
      .then((data: Run) => { if (active) setRun(data); })
      .catch((e) => { if (active) setLoadError(friendlyError(e, 'Couldn’t open this print. Go back and try again.')); });
    return () => { active = false; };
  }, [runId]);

  // The office printer (the kiosk account has the one office printer).
  const readStations = useCallback(async () => {
    try {
      const data = await api('/api/office/stations');
      setPrinter(Array.isArray(data.printers) ? data.printers[0] : undefined);
    } catch { /* the last answer stays */ }
    setStationsRead(true);
  }, []);
  useEffect(() => {
    void readStations();
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void readStations(); }, 10_000);
    return () => clearInterval(timer);
  }, [readStations]);

  // How many labels one send may hold, from a few sample labels (like the run page).
  useEffect(() => {
    if (!run || !template || !format) return;
    let active = true; const controller = new AbortController();
    const fallback = Math.floor((bitmap ? OFFICE_BITMAP_LABELS_PER_SEND : OFFICE_MAX_LABELS) / across) * across || across;
    generateLabelsForRunWithImages(run, template, format, { from: 1, to: Math.min(run.totalLabels, Math.max(8, across * 2)) }, { signal: controller.signal })
      .then((feeds) => { if (active) setCap(feeds.length ? officeSendCap(feeds.map((f) => new TextEncoder().encode(f).length), across, bitmap) : fallback); })
      .catch(() => { if (active) setCap(fallback); });
    return () => { active = false; controller.abort(); };
  }, [run, template, format, across, bitmap]);

  // Where this print is: saved on this device, or (a first print) rebuilt from the office's records.
  useEffect(() => {
    if (flowRef.current || !run || !format || !office.everLoaded || !cap) return;
    const saved = readSaved(storageKey);
    const testTo = kioskTestCount(count, across);
    if (saved) { setFlow(saved); return; }
    if (mode === 'first') {
      setFlow(rebuildKioskFlow({ total: count, testTo, stage: job.stage ?? 'test', requests: office.requests, cap, across }));
    } else {
      setFlow({ total: count, testTo, testIds: [], restIds: [], restPlan: [], approved: false, stopped: false });
    }
  }, [run, format, office.everLoaded, office.requests, storageKey, count, across, mode, job.stage, cap, setFlow]);

  const jobs = office.jobs;
  const phase = flow ? kioskPhase(flow, jobs) : null;
  const status = officeStatusLine(printer, runId);
  const sentCount = flow ? kioskLabelsSent(flow, jobs) : 0;

  /** Sends one saved request (a first try, or the same request again with its key). */
  const post = useCallback(async (payload: SendPayload, group: Group, resend: boolean) => {
    try {
      const result = await api('/api/office/jobs', { method: 'POST', body: JSON.stringify(payload) });
      const current = flowRef.current;
      if (current && typeof result.requestId === 'string') {
        const ids = group === 'test' ? { testIds: [...current.testIds, result.requestId] } : { restIds: [...current.restIds, result.requestId] };
        setFlow({ ...current, ...ids, pending: undefined });
      }
      setUnsure(false);
    } catch (e) {
      const status = e instanceof SendError ? e.status : undefined;
      const code = e instanceof SendError ? e.code : undefined;
      const current = flowRef.current;
      if (!sendKeepsRequest(status, code, resend)) {
        // A definite "no": nothing was queued, so the saved request goes.
        if (current) setFlow({ ...current, pending: undefined });
        const plain = plainOfficeRefusal(e instanceof Error ? e.message : '', status);
        if (plain.reason === 'too-large' && current && group === 'rest') {
          // Too much for one send: split the rest of this print smaller and carry on.
          const part = payload;
          const smaller = Math.max(across, Math.floor(Math.floor((part.to - part.from + 1) / 2) / across) * across);
          const done = current.restPlan.slice(0, current.restIds.length);
          setFlow({ ...current, pending: undefined, restPlan: [...done, ...officeSendParts(part.from, current.total, smaller, across)] });
          setCap(smaller);
        } else if (plain.reason === 'needs-review') {
          setError('The printer needs a check before it can print more. Ask a manager.');
        } else {
          setError(plain.message);
        }
        setUnsure(false);
      } else {
        // Not sure it arrived: keep the same request and key, so Try again can't print twice.
        setUnsure(true);
        setError('We’re not sure the printer got that. Press Try again. It won’t print twice.');
      }
    } finally {
      await office.refresh().catch(() => {});
    }
  }, [across, office, setFlow]);

  /** Plans, saves and sends the next part of the test or the rest. */
  const sendNext = useCallback(async () => {
    const current = flowRef.current;
    if (inFlight.current || !current || !run || !template || !format || !printer) return;
    const group: Group = current.approved ? 'rest' : 'test';
    const span: OfficeSpan | undefined = group === 'test' ? { from: 1, to: current.testTo } : current.restPlan[current.restIds.length];
    if (!span) return;
    inFlight.current = true; setError(''); setUnsure(false);
    try {
      setWorking(group === 'test' ? 'Sending the test labels…' : 'Sending labels to the printer…');
      const fresh = await readRequests(runId);
      const plan = officeSendPlan(fresh.jobs, span.from, span.to);
      if (plan.kind === 'wait') {
        setError(plan.why === 'needs-check' ? 'The printer needs a check before it can print these. Ask a manager.' : 'Some of these labels are still on their way to the printer. Wait a moment, then press Try again.');
        return;
      }
      if (plan.kind === 'reprint' && mode === 'first') {
        // Already sent (from another screen): catch up from the office's records instead of printing twice.
        const caught = rebuildKioskFlow({ total: current.total, testTo: current.testTo, stage: current.stopped ? 'stopped' : current.approved ? 'approved' : 'test', requests: fresh.requests, cap: cap ?? OFFICE_BITMAP_LABELS_PER_SEND, across });
        if (caught.testIds.length + caught.restIds.length > current.testIds.length + current.restIds.length) setFlow(caught);
        else setError('Some of these labels were already sent to the printer. Ask a manager.');
        return;
      }
      let digest: string | undefined;
      if (bitmap) {
        setWorking(`Getting ${labels(span.to - span.from + 1)} ready…`);
        const feeds = await generateLabelsForRunWithImages(run, template, format, span, { onProgress: (done, all) => setWorking(`Getting labels ready… ${done.toLocaleString('en-US')} of ${all.toLocaleString('en-US')}`) });
        if (!feeds.length) throw new Error('Nothing to print');
        digest = await sha256(bitmapDigestSource(feeds));
        setWorking('Sending labels to the printer…');
      }
      const payload: SendPayload = {
        runId, stationId: printer.station_id, printerId: printer.id, from: span.from, to: span.to, idempotencyKey: crypto.randomUUID(),
        ...(plan.kind === 'reprint' ? { reprintOf: plan.reprintOf, reason: KIOSK_REPRINT_REASON } : {}),
        ...(digest ? { expectedBitmapDigest: digest } : {}),
      };
      // Saved before it goes, so a lost answer is sent again with the same key.
      setFlow({ ...current, pending: { payload, group } });
      await post(payload, group, false);
    } catch (e) {
      // Too much printer data for one send: the rest goes in smaller sends.
      const smaller = group === 'rest' ? capAfterSizeError(e instanceof Error ? e.message : '', span.from, across) : null;
      if (smaller) {
        const latest = flowRef.current ?? current;
        setFlow({ ...latest, pending: undefined, restPlan: [...latest.restPlan.slice(0, latest.restIds.length), ...officeSendParts(span.from, latest.total, smaller, across)] });
        setCap(smaller);
      } else setError(friendlyError(e, 'Couldn’t get the labels ready. Press Try again, or ask a manager if it happens again.'));
    } finally {
      inFlight.current = false; setWorking('');
    }
  }, [run, template, format, printer, runId, mode, cap, across, bitmap, post, setFlow]);

  /** A send saved earlier (a lost answer, or the page closed mid-send): find it at the office, or send it again with its key. */
  const finishPending = useCallback(async () => {
    const current = flowRef.current;
    if (inFlight.current || !current?.pending) return;
    inFlight.current = true; setError(''); setWorking('Checking with the printer…');
    try {
      const { payload, group } = current.pending;
      const found = await lookUpSend(runId, payload.idempotencyKey);
      if (typeof found === 'string') {
        const ids = group === 'test' ? { testIds: [...current.testIds, found] } : { restIds: [...current.restIds, found] };
        setFlow({ ...current, ...ids, pending: undefined });
        setUnsure(false);
        await office.refresh().catch(() => {});
      } else {
        setWorking('Sending labels to the printer…');
        await post(payload, group, true);
      }
    } finally { inFlight.current = false; setWorking(''); }
  }, [runId, office, post, setFlow]);

  // Keep going by itself: the test goes as soon as the printer can take it,
  // and after "Yes" each part of the rest follows the last. Never after an
  // error (staff press Try again), never while the printer is stopped.
  const autoKey = flow ? `${phase}:${flow.testIds.length}:${flow.restIds.length}:${flow.restPlan.length}:${flow.pending ? 'p' : ''}` : '';
  useEffect(() => {
    if (!flow || error || working || !printer || !status.canSend || !cap) return;
    if (flow.pending) { if (!unsure) void finishPending(); return; }
    if (phase === 'send-test' || phase === 'send-rest') void sendNext();
    // autoKey stands for the flow's progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoKey, error, working, printer, status.canSend, cap, unsure]);

  // Finished or stopped: nothing left to resume on this device.
  useEffect(() => {
    if ((phase === 'done' || phase === 'stopped') && flow && !flow.pending) { try { localStorage.removeItem(storageKey); } catch { /* nothing saved */ } }
  }, [phase, flow, storageKey]);

  const answer = async (yes: boolean) => {
    const current = flowRef.current;
    if (!current || answering) return;
    setAnswering(true); setError('');
    try {
      if (mode === 'first') await api('/api/kiosk/runs/' + encodeURIComponent(runId), { method: 'PUT', body: JSON.stringify({ stage: yes ? 'approved' : 'stopped' }) });
      if (yes) {
        const plan = current.testTo < current.total ? officeSendParts(current.testTo + 1, current.total, cap ?? OFFICE_BITMAP_LABELS_PER_SEND, across) : [];
        setFlow({ ...current, approved: true, restPlan: plan });
      } else {
        setFlow({ ...current, stopped: true });
      }
    } catch (e) {
      setError(friendlyError(e, 'That didn’t save. Press the button again.'));
    } finally { setAnswering(false); }
  };

  const failedJob = useMemo(() => {
    if (!flow) return null;
    const ids = [...flow.testIds, ...flow.restIds];
    return jobs.find((j) => ids.includes(j.requestId) && (j.review || j.state === 'needs_review' || j.state === 'rejected')) ?? null;
  }, [flow, jobs]);

  const firstLabel = useMemo(() => {
    if (!run || !Array.isArray(run.sourceData)) return [];
    const rows = run.sourceData as Record<string, string>[];
    return Array.from({ length: Math.min(across, rows.length) }, (_, i) => kioskLabelValues(run.fieldMappings ?? {}, run.staticValues ?? {}, rows[i]));
  }, [run, across]);

  if (loadError) return <Message tone="bad" title="Couldn’t open this print" body={loadError} action={<button type="button" className="btn btn-secondary kiosk-btn" onClick={onFinished}>Back to start</button>} />;
  if (!run || !flow || !phase || !stationsRead) return <Message tone="wait" title="Getting the print ready…" />;
  if (!printer) return <Message tone="bad" title="No label printer for this kiosk" body="Ask a manager to give the kiosk account the office printer." action={<button type="button" className="btn btn-secondary kiosk-btn" onClick={onFinished}>Back to start</button>} />;

  const rest = flow.total - flow.testTo;
  const testWords = flow.total <= flow.testTo ? `all ${labels(flow.total)}` : `the first ${labels(flow.testTo)}`;
  const steps = flow.total > flow.testTo ? ['Test print', 'Check it', 'Print the rest'] : ['Print', 'Check it'];
  const stepAt = phase === 'review' ? 1 : ['send-rest', 'rest-waiting', 'rest-printing', 'done'].includes(phase) ? 2 : 0;

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <p className="text-sm text-zinc-400">{mode === 'reprint' ? 'Printing again' : 'Printing'}</p>
        <h2 className="text-2xl font-semibold text-zinc-100">{job.title}</h2>
        <p className="mt-1 text-base text-zinc-300">{job.designName} · {labels(flow.total)}</p>
        <ol className="mt-4 flex flex-wrap gap-2" aria-label="Steps">
          {steps.map((step, i) => (
            <li key={step} aria-current={i === Math.min(stepAt, steps.length - 1) ? 'step' : undefined}
              className={`rounded-full px-3 py-1 text-sm ${i < stepAt || phase === 'done' ? 'bg-emerald-500/15 text-emerald-300' : i === stepAt ? 'bg-amber-400/15 text-amber-200' : 'bg-zinc-800 text-zinc-400'}`}>
              {i + 1}. {step}
            </li>
          ))}
        </ol>
      </div>

      {(error || unsure) && (
        <div role="alert" className="card flex flex-wrap items-center gap-4 border-red-500/40 p-5">
          <AlertTriangle className="size-7 shrink-0 text-red-400" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-lg text-zinc-100">{error}</p>
          <button type="button" className="btn btn-primary kiosk-btn" disabled={!!working} onClick={() => { setError(''); if (flowRef.current?.pending) void finishPending(); else void sendNext(); }}>
            <RotateCcw className="size-5" aria-hidden="true" />Try again
          </button>
        </div>
      )}

      {phase !== 'done' && phase !== 'stopped' && !status.canSend && (
        <p role="status" className="card flex items-center gap-3 p-4 text-base text-amber-200"><Hand className="size-6 shrink-0" aria-hidden="true" />Printer: {status.text} Ask a manager if this doesn’t clear.</p>
      )}

      {(phase === 'send-test' || phase === 'test-waiting' || phase === 'test-printing') && (
        <Message tone="wait" title={phase === 'test-printing' ? `Printing ${testWords}…` : working || `Sending ${testWords} to the printer…`}
          body={phase === 'test-waiting' && status.tone !== 'ok' ? `Printer: ${status.text}` : 'Take them off the printer when they come out. Next you’ll check them.'} />
      )}

      {phase === 'review' && (
        <div className="card space-y-5 p-5">
          <h3 className="text-2xl font-semibold text-zinc-100">{flow.total <= flow.testTo ? `Do ${flow.total === 1 ? 'this label' : `these ${flow.total} labels`} look right?` : `Do these ${flow.testTo} labels look right?`}</h3>
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {template && format && <div><p className="mb-2 text-sm text-zinc-400">It should look like this:</p><KioskPreview template={template} format={format} lanes={firstLabel} alt={`Picture of the ${job.designName} label`} /></div>}
            <ul className="space-y-2 text-lg text-zinc-200">
              <li>• The right product name</li>
              <li>• Clear, easy-to-read words</li>
              <li>• Barcodes and QR codes print sharp and whole</li>
              <li>• Labels lined up on the roll, nothing cut off</li>
            </ul>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" className="btn btn-primary kiosk-btn flex-1" disabled={answering || !cap} onClick={() => void answer(true)}>
              <ThumbsUp className="size-6" aria-hidden="true" />{!cap ? 'Getting ready…' : rest > 0 ? `Yes, print the rest (${labels(rest)})` : 'Yes, they look right'}
            </button>
            <button type="button" className="btn btn-secondary kiosk-btn flex-1" disabled={answering} onClick={() => void answer(false)}>
              <ThumbsDown className="size-6" aria-hidden="true" />No, stop
            </button>
          </div>
        </div>
      )}

      {(phase === 'send-rest' || phase === 'rest-waiting' || phase === 'rest-printing') && (
        <div className="card space-y-4 p-5" role="status">
          <div className="flex items-center gap-3"><Loader2 className="size-7 shrink-0 animate-spin text-amber-300" aria-hidden="true" /><h3 className="text-2xl font-semibold text-zinc-100">{working || `Printing: ${sentCount.toLocaleString('en-US')} of ${labels(flow.total)} done`}</h3></div>
          <ProgressBar value={sentCount} max={flow.total} label="Labels printed" className="h-3" />
          <p className="text-base text-zinc-400">{phase === 'rest-waiting' && status.tone !== 'ok' ? `Printer: ${status.text}` : 'You can leave this screen. Printing keeps going.'}</p>
        </div>
      )}

      {phase === 'done' && (
        <Message tone="ok" title={`All ${labels(flow.total)} printed.`} body="Check the last ones as they come off the printer."
          action={<button type="button" className="btn btn-primary kiosk-btn" onClick={onFinished}><PrinterIcon className="size-6" aria-hidden="true" />Print something else</button>} />
      )}
      {phase === 'stopped' && (
        <Message tone="bad" title="Stopped. Nothing else will print." body="Please ask a manager to look at the test labels before trying again."
          action={<button type="button" className="btn btn-secondary kiosk-btn" onClick={onFinished}>Back to start</button>} />
      )}
      {phase === 'needs-check' && (
        <Message tone="bad" title="The printer needs a check" body={`${failedJob ? capital(plainJobReason(failedJob.reason)) + '. ' : ''}Please ask a manager. Nothing more will print until it’s checked.`}
          action={<button type="button" className="btn btn-secondary kiosk-btn" onClick={onFinished}>Back to start</button>} />
      )}
      {phase === 'cancelled' && (
        <Message tone="bad" title="This print was stopped at the office" body="Please ask a manager."
          action={<button type="button" className="btn btn-secondary kiosk-btn" onClick={onFinished}>Back to start</button>} />
      )}

      {phase !== 'done' && phase !== 'stopped' && phase !== 'needs-check' && phase !== 'cancelled' && (
        <div className="flex justify-start">
          <button type="button" className="btn btn-ghost" onClick={onFinished}>Back to start{phase === 'review' ? ' (answer later from Today’s prints)' : ''}</button>
        </div>
      )}
    </div>
  );
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function Message({ tone, title, body, action }: { tone: 'ok' | 'bad' | 'wait'; title: string; body?: string; action?: React.ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'bad' ? AlertTriangle : Loader2;
  return (
    <div className="card flex flex-col items-start gap-4 p-6" role={tone === 'bad' ? 'alert' : 'status'}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 size-8 shrink-0 ${tone === 'ok' ? 'text-emerald-400' : tone === 'bad' ? 'text-red-400' : 'animate-spin text-amber-300'}`} aria-hidden="true" />
        <div>
          <h3 className="text-2xl font-semibold text-zinc-100">{title}</h3>
          {body && <p className="mt-1 text-lg text-zinc-300">{body}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
