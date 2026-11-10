'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Printer } from 'lucide-react';
import { getBitmapProof, type BitmapResult } from '@/lib/thermal/client';
import type { LabelFormat, LabelTemplate } from '@/lib/types';
import { confirmDialog } from '@/components/ui/feedback';
import { friendlyError } from '@/lib/userMessages';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { officeStatusLine, plainOfficeRefusal, readRefusal, refusalNeedsSomeoneElse, refusalStillApplies, sendKeepsRequest, uncertainSendWords, type OfficeRefusalRecord, type OfficeReviewHold } from '@/lib/officeSendOutcome';

type PrinterInfo = { station_id: string; id: string; name: string; online: boolean; available?: boolean; dispatch_enabled: boolean; paired_at?: string | null; needs_review: boolean; dispatch_hold_reason?: string | null; review_holds?: OfficeReviewHold[] };
type Pending = { status?: number; code?: string; idempotencyKey: string; stationId: string; printerId: string; quantity: number; template: LabelTemplate; format: LabelFormat; testData: Record<string, string>; expectedPixelDigests?: string[] };
/** Carries the HTTP status so a definite "no" is not read as "maybe it arrived". */
class OfficeRequestError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
/** A refusal in words that fit a test print (never raw server text). */
function testPrintRefusal(message: string, status?: number) {
  if (/save this template/i.test(message)) return { reason: 'other' as const, message: 'Save the design first, then send a test print. Nothing was printed.' };
  const plain = plainOfficeRefusal(message, status);
  const words = plain.reason === 'other' ? 'The office printer didn’t take this test print. Nothing was printed.'
    : plain.reason === 'signed-out' || plain.reason === 'no-access' ? `${plain.message} Nothing was printed.`
    : plain.message.replace('Nothing new was sent.', 'Nothing was printed.').replace(' Check the office queue below.', ' Check Runs.');
  return { reason: plain.reason, message: words };
}
function withoutAnswer(saved: Pending): Pending {
  const copy = { ...saved }; delete copy.status; delete copy.code; return copy;
}
function listError(error: unknown) {
  if (error instanceof OfficeRequestError && error.status === 401) return 'You’re signed out. Sign in again to use the office printer.';
  if (error instanceof OfficeRequestError && error.status === 403) return 'Your account can’t see the office printer. Ask your admin for access.';
  return 'Couldn’t reach the office printer list. It tries again on its own.';
}
async function api(url: string, options?: RequestInit) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new OfficeRequestError(data.error || 'Office printer request failed', response.status, typeof data.code === 'string' ? data.code : undefined);
  return data;
}

export function OfficePreviewPrint({ template, format, testData }: { template: LabelTemplate; format: LabelFormat; testData?: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selected, setSelected] = useState('');
  const [canPrint, setCanPrint] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [runId, setRunId] = useState('');
  const inFlight = useRef(false);
  const bitmap = template.thermalRenderMode === 'bitmap-v1';
  const [proofs, setProofs] = useState<{ key: string; results: BitmapResult[] } | null>(null);
  const proofKey = JSON.stringify([template, format, testData, quantity]);
  useEffect(() => {
    if (!open || !bitmap || pending) return;
    let active = true; setError(''); setProofs(null);
    const timer = setTimeout(async () => {
      try {
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 25) return;
        const results: BitmapResult[] = [], across = format.labelsAcross || 1;
        for (let first = 0; first < quantity; first += across) {
          const result = await getBitmapProof(template, format, Array.from({ length: across }, (_, lane) => first + lane < quantity ? testData ?? {} : null));
          if (!active) return; results.push(result);
        }
        setProofs({ key: proofKey, results });
      } catch (e) { if (active) setError(friendlyError(e, 'Couldn’t draw the label for the office printer.')); }
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [open, bitmap, pending, proofKey, template, format, testData, quantity]);
  const storageKey = `lw:designer-office-preview:${template.id}`;
  const refusedKey = `lw:designer-office-refused:${template.id}`;
  const [refusal, setRefusal] = useState<OfficeRefusalRecord | null>(null);
  const clearRefusal = () => { setRefusal(null); try { localStorage.removeItem(refusedKey); } catch { /* nothing saved */ } };

  useEffect(() => {
    setPending(null); setRunId(''); setError(''); setRefusal(null);
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) { setPending(JSON.parse(saved)); setOpen(true); }
      else setRefusal(readRefusal(localStorage.getItem(refusedKey)));
    } catch { setError('The saved test print on this device couldn’t be read. Check Runs before printing again.'); }
  }, [storageKey, refusedKey]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const refresh = async () => {
      try {
        const data = await api('/api/office/stations');
        if (!active) return;
        setPrinters(data.printers); setCanPrint(data.canPrint);
        setSelected(value => value || data.printers[0]?.id || '');
      } catch (error) { if (active) setError(listError(error)); }
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [open]);

  const printer = printers.find(p => p.id === (pending?.printerId ?? selected));
  const submit = async () => {
    if (inFlight.current || !printer || (bitmap && !pending && proofs?.key !== proofKey)) return;
    inFlight.current = true; setBusy(true); setError(''); setRunId('');
    // A resend goes out with the saved key; a first send gets a new one.
    const resend = !!pending;
    try {
      // The saved request goes out exactly as saved (same key); the last
      // answer's status is kept only for the words shown here.
      const payload: Pending = pending ? withoutAnswer(pending) : {
        idempotencyKey: crypto.randomUUID(), stationId: printer.station_id, printerId: printer.id,
        quantity, template, format, testData: testData ?? {},
        ...(bitmap ? { expectedPixelDigests: proofs!.results.map(r => r.pixelDigest) } : {}),
      };
      // Persist the exact snapshot before sending; edits/reloads cannot change a retry.
      localStorage.setItem(storageKey, JSON.stringify(payload));
      setPending(payload);
      clearRefusal();
      try {
        const result = await api('/api/office/preview', { method: 'POST', body: JSON.stringify(payload) });
        localStorage.removeItem(storageKey); setPending(null); setRunId(result.runId);
      } catch (error) {
        // A definite refusal (400/404/409/413) means nothing was queued, so
        // the saved print is cleared and not offered again. So does a first
        // send refused as signed out (401) or without print access (403): the
        // server checks the account before queuing anything. No answer, a
        // 5xx or busy (429), or signed out / no access on a resend, might mean
        // an earlier try arrived, so the same print (same key) is kept.
        const status = error instanceof OfficeRequestError ? error.status : undefined;
        const code = error instanceof OfficeRequestError ? error.code : undefined;
        if (!sendKeepsRequest(status, code, resend)) {
          localStorage.removeItem(storageKey); setPending(null);
          const plain = testPrintRefusal(error instanceof Error ? error.message : '', status);
          const record: OfficeRefusalRecord = { from: 1, to: payload.quantity, reason: plain.reason, message: plain.message, at: new Date().toISOString() };
          try { localStorage.setItem(refusedKey, JSON.stringify(record)); } catch { /* shown here anyway */ }
          setRefusal(record);
        } else setPending({ ...payload, status, code });
      }
    } catch { setError('The test print wasn’t sent. Try again in a moment.'); }
    finally { inFlight.current = false; setBusy(false); }
  };

  // Live status decides readiness; a remembered refusal never overrides it.
  // One status line: never "ready" while the printer is paused or stopped.
  const readiness = officeStatusLine(printer);
  const shownRefusal = refusalStillApplies(refusal, printer) ? refusal : null;
  const quantityOk = Number.isInteger(quantity) && quantity >= 1 && quantity <= 25;
  const canSend = !busy && canPrint && !!printer && (pending ? true : readiness.canSend && quantityOk && !(bitmap && proofs?.key !== proofKey));
  const dot = readiness.tone === 'ok' ? 'bg-emerald-400' : readiness.tone === 'bad' ? 'bg-red-400' : 'bg-amber-400';

  return <div className="text-sm">
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className="btn btn-secondary btn-sm"><Printer className="size-4" aria-hidden="true" />Test print at the office</button>
    {open && <div className="popover-enter card mt-2 max-w-md space-y-3 p-4">
      <p className="text-zinc-400">Prints this design with its sample text on the office printer. It shows up in Runs as a test print.</p>
      <div className="space-y-1.5">
        {printers.length > 1 ? (
          <CustomSelect aria-label="Office printer" disabled={busy || !!pending} value={pending?.printerId ?? selected} onChange={setSelected} options={printers.map(p => ({ value: p.id, label: p.name }))} />
        ) : <p className="font-medium text-zinc-100">{printers[0]?.name ?? 'No office printer is set up for your account'}</p>}
        {printer && <p className="flex items-start gap-2 text-zinc-400"><span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${dot}`} />{readiness.text}</p>}
      </div>
      <label className="flex items-center gap-2 text-zinc-300">How many test labels
        <input type="number" inputMode="numeric" min={1} max={25} value={pending?.quantity ?? quantity} disabled={busy || !!pending} onChange={e => setQuantity(Number(e.target.value))} className="field w-20 tabular-nums" aria-describedby="office-test-quantity-help" />
        <span id="office-test-quantity-help" className="text-zinc-400">up to 25</span>
      </label>
      {bitmap && !pending && <div className="space-y-1">{proofs?.key === proofKey ? proofs.results.map((r, i) => <img key={i} src={r.proof} alt={`Test label ${i + 1} as it will print`} className="w-full bg-white" style={{ imageRendering: 'pixelated' }} />) : <p role="status" className="text-zinc-400">Drawing the label exactly as it will print…</p>}</div>}
      {pending && <p role="status" className="text-amber-300">We&apos;re not sure the office got your last test print. {pending.status === undefined || uncertainSendWords(pending.status, pending.code).cause === 'no-answer' ? 'Tap “Send again”. It resends that same print (not later edits), so it won’t print twice.' : uncertainSendWords(pending.status, pending.code).message.replace('come back to this run', 'come back to this design')}</p>}
      {shownRefusal && !pending && <p role="alert" className="text-amber-300">Your last test print wasn&apos;t sent. {shownRefusal.message}</p>}
      <button type="button" disabled={!canSend} onClick={() => void submit()} className="btn btn-primary btn-sm">{busy ? 'Sending…' : pending ? 'Send again' : shownRefusal && !refusalNeedsSomeoneElse(shownRefusal.reason) ? 'Try again' : quantity === 1 ? 'Send 1 test label' : `Send ${quantity} test labels`}</button>
      {error && <p role="alert" className="text-red-400">{error}</p>}
      {pending && !busy && <p className="text-zinc-400"><Link href="/runs" className="underline underline-offset-2">Check Runs</Link> first, or <button type="button" className="underline underline-offset-2" onClick={async () => {
        const ok = await confirmDialog({ title: 'Start over?', body: 'Check Runs first. The office may already have this test print, and starting over doesn’t cancel anything already sent.', confirmLabel: 'Start over' });
        if (!ok) return;
        localStorage.removeItem(storageKey); setPending(null); setError('');
      }}>start over</button>.</p>}
      {runId && <p role="status" className="text-emerald-400">Test print sent to the office. <Link href={`/runs/${encodeURIComponent(runId)}`} className="underline underline-offset-2">See it or cancel it</Link></p>}
    </div>}
  </div>;
}
