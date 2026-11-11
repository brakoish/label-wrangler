'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, Printer } from 'lucide-react';
import { getBitmapProof, type BitmapResult } from '@/lib/thermal/client';
import type { LabelFormat, LabelTemplate } from '@/lib/types';
import { confirmDialog } from '@/components/ui/feedback';
import { friendlyError } from '@/lib/userMessages';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { PopLayer, useDismiss } from '@/components/ui/PopLayer';
import { IconSwap } from '@/components/ui/IconSwap';
import { Recovery } from '@/components/ui/Recovery';
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
  const response = await fetch(url, { ...options, cache: 'no-store', headers: { 'Content-Type': 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new OfficeRequestError(data.error || 'Office printer request failed', response.status, typeof data.code === 'string' ? data.code : undefined);
  return data;
}

/**
 * Runs `fn` under a Web Lock shared by every tab on this design, so checking
 * for a saved test print and saving a new one happen as one step (the same
 * lock the run page's office panel uses, named for the design). Without Web
 * Locks (or if the browser refuses the lock) it runs `fn` as before, never twice.
 */
async function withTestPrintLock<T>(templateId: string, fn: () => T): Promise<T> {
  let ran = false;
  try {
    if (typeof navigator !== 'undefined' && navigator.locks?.request) return await navigator.locks.request(`lw-office-send:test:${templateId}`, () => { ran = true; return fn(); }) as T;
  } catch (error) { if (ran) throw error; }
  return fn();
}
/**
 * The run a test print is filed under. The server names it from the account
 * and the request key (src/lib/office/preview.ts), so a page that finds a
 * saved test print can ask whether it arrived without having sent it.
 */
export function testPrintRunId(userId: string, key: string) { return `designer-test-${userId}-${key}`; }
/** Did the test print saved under this key reach the office? The run id, null when not, undefined when it couldn't be read. */
async function lookUpTestPrint(userId: string | null, key: string): Promise<string | null | undefined> {
  if (!userId) return undefined;
  const runId = testPrintRunId(userId, key);
  try {
    const response = await fetch(`/api/office/jobs?runId=${encodeURIComponent(runId)}&key=${encodeURIComponent(key)}`, { cache: 'no-store' });
    if (!response.ok) return undefined;
    const data = await response.json().catch(() => null) as { keyRequestId?: unknown } | null;
    if (!data || !('keyRequestId' in data)) return undefined;
    return typeof data.keyRequestId === 'string' ? runId : null;
  } catch { return undefined; }
}
const SENDING_FRESH_MS = 12_000;

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
      if (saved) setPending(JSON.parse(saved));
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

  // While a POST is out, this tab keeps a fresh mark another tab can see, so
  // a second tab on the same design says "sending from another tab" instead
  // of a false "not sure" (it also follows the saved test print as it changes).
  const sendingKey = `lw:designer-office-sending:${template.id}`;
  // When a send succeeds this tab also leaves a short note, so another tab
  // showing "sending from another tab" can say it went (and nobody sends a
  // second test print). Only a hint: the server and Runs stay the record.
  const sentKey = `lw:designer-office-sent:${template.id}`;
  const [otherTabSending, setOtherTabSending] = useState(false);
  // This tab's own send, kept per tab across a reload, so the page after a
  // reload mid-send says "Sending…" rather than "from another tab".
  const mineKey = `lw:designer-office-mine:${template.id}`;
  const [sendingBeforeReload, setSendingBeforeReload] = useState(false);
  const [sentElsewhere, setSentElsewhere] = useState(false);
  useEffect(() => {
    const check = () => {
      if (inFlight.current) { setOtherTabSending(false); return; }
      try {
        const at = Number(localStorage.getItem(sendingKey));
        const fresh = at > 0 && Date.now() - at < SENDING_FRESH_MS;
        setOtherTabSending(fresh);
        let mine = false;
        try { const raw = localStorage.getItem(storageKey); mine = fresh && !!raw && sessionStorage.getItem(mineKey) === (JSON.parse(raw) as Pending).idempotencyKey; } catch { mine = false; }
        setSendingBeforeReload(mine);
      } catch { setOtherTabSending(false); }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey && !inFlight.current) {
        try { setPending(event.newValue ? JSON.parse(event.newValue) : null); } catch { /* keep what is shown */ }
      }
      if (event.key === sentKey && event.newValue && !inFlight.current) {
        try {
          const note = JSON.parse(event.newValue) as { runId?: string; at?: number };
          if (typeof note.runId === 'string' && Date.now() - Number(note.at) < 5 * 60_000) { setRunId(note.runId); setSentElsewhere(true); setRefusal(null); setError(''); }
        } catch { /* only a hint */ }
      }
      if (event.key === refusedKey && !inFlight.current) { setRefusal(readRefusal(event.newValue)); if (event.newValue) { setRunId(''); setSentElsewhere(false); } }
      if (event.key === storageKey || event.key === sendingKey) check();
    };
    check();
    window.addEventListener('storage', onStorage);
    const timer = setInterval(check, 2000);
    return () => { window.removeEventListener('storage', onStorage); clearInterval(timer); };
  }, [storageKey, sendingKey, sentKey, refusedKey, mineKey]);

  // Who is signed in: the test print's run is named from it (see testPrintRunId).
  const [userId, setUserId] = useState<string | null>(null);
  // The office couldn't say whether the saved test print arrived (an older
  // server, or no answer): then the person is the one who knows.
  const [lookupMissing, setLookupMissing] = useState(false);
  const [clearedNote, setClearedNote] = useState('');
  useEffect(() => {
    let active = true;
    fetch('/api/office/session', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(d => { if (active && typeof d?.user?.id === 'string') setUserId(d.user.id); }).catch(() => {});
    return () => { active = false; };
  }, []);
  // Only this send's own saved print is cleared: never one another tab saved since.
  const forgetSaved = (key: string) => {
    try { const saved = localStorage.getItem(storageKey); if (saved && (JSON.parse(saved) as Pending).idempotencyKey === key) localStorage.removeItem(storageKey); } catch { /* nothing saved */ }
  };
  // A test print found at the office: settled here and in every tab, whoever sent it.
  const settleSent = (key: string, sentRunId: string, elsewhere: boolean) => {
    forgetSaved(key);
    try {
      localStorage.setItem(sentKey, JSON.stringify({ runId: sentRunId, at: Date.now() }));
    } catch { /* shown here anyway */ }
    try { sessionStorage.removeItem(mineKey); } catch { /* nothing saved */ }
    setPending(null); setRunId(sentRunId); setSentElsewhere(elsewhere); setError('');
  };
  const settleRef = useRef(settleSent);
  const sendingBeforeReloadRef = useRef(false);
  useEffect(() => { settleRef.current = settleSent; sendingBeforeReloadRef.current = sendingBeforeReload; });
  // A saved test print this tab isn't sending (a reload mid-send, another
  // tab's, an answer that never came): ask the office whether it arrived, now
  // and then, so it settles on its own instead of staying "not sure".
  const pendingKey = pending?.idempotencyKey;
  useEffect(() => {
    if (!pendingKey || busy || !userId) return;
    let active = true; let timer: ReturnType<typeof setTimeout> | undefined; let looks = 0;
    const tick = async () => {
      if (document.visibilityState !== 'hidden') {
        const found = await lookUpTestPrint(userId, pendingKey);
        if (!active) return;
        setLookupMissing(found === undefined);
        if (found) { let other = false; try { const at = Number(localStorage.getItem(sendingKey)); other = at > 0 && Date.now() - at < SENDING_FRESH_MS; } catch { /* no hint */ } settleRef.current(pendingKey, found, other && !sendingBeforeReloadRef.current); return; }
      }
      looks++;
      timer = setTimeout(() => void tick(), looks < 12 ? 5000 : 20_000);
    };
    void tick();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [pendingKey, busy, userId, sendingKey]);

  const unloading = useRef(false);
  useEffect(() => {
    const away = () => { unloading.current = true; };
    const back = () => { unloading.current = false; };
    window.addEventListener('pagehide', away); window.addEventListener('pageshow', back);
    return () => { window.removeEventListener('pagehide', away); window.removeEventListener('pageshow', back); };
  }, []);
  const printer = printers.find(p => p.id === (pending?.printerId ?? selected));
  const submit = async () => {
    if (inFlight.current || !printer || (bitmap && !pending && proofs?.key !== proofKey)) return;
    inFlight.current = true; setBusy(true); setError(''); setRunId(''); setSentElsewhere(false); setClearedNote('');
    // What this tab shows: a saved test print to resend, or none (a new one).
    const shown = pending;
    try {
      const mark = () => { try { localStorage.setItem(sendingKey, String(Date.now())); } catch { /* only a hint for other tabs */ } };
      // Read, decide and save under one lock shared by this design's tabs, so
      // two tabs pressing Send at the same moment never send two test prints:
      // the second finds the first one's saved print and shows it instead.
      const claimed = await withTestPrintLock(template.id, (): { payload: Pending; resend: boolean } | null => {
        let saved: Pending | null = null;
        try { const raw = localStorage.getItem(storageKey); saved = raw ? JSON.parse(raw) as Pending : null; } catch { saved = null; }
        let sendingElsewhere = false;
        try { const at = Number(localStorage.getItem(sendingKey)); sendingElsewhere = at > 0 && Date.now() - at < SENDING_FRESH_MS; } catch { sendingElsewhere = false; }
        // Another tab is sending (or just saved) a test print: nothing new goes out from here.
        if (sendingElsewhere) { if (saved) setPending(saved); setOtherTabSending(true); return null; }
        if (saved && saved.idempotencyKey !== shown?.idempotencyKey) { setPending(saved); return null; }
        // The print this tab offered to resend was settled in another tab.
        if (!saved && shown) { setPending(null); return null; }
        // The saved request goes out exactly as saved (same key); the last
        // answer's status is kept only for the words shown here.
        const payload: Pending = saved ? withoutAnswer(saved) : {
          idempotencyKey: crypto.randomUUID(), stationId: printer.station_id, printerId: printer.id,
          quantity, template, format, testData: testData ?? {},
          ...(bitmap ? { expectedPixelDigests: proofs!.results.map(r => r.pixelDigest) } : {}),
        };
        // Persist the exact snapshot before sending; edits/reloads cannot change a retry.
        localStorage.setItem(storageKey, JSON.stringify(payload));
        try { sessionStorage.setItem(mineKey, payload.idempotencyKey); } catch { /* only for the words after a reload */ }
        mark();
        return { payload, resend: !!saved };
      });
      if (!claimed) return;
      const { payload, resend } = claimed;
      setPending(payload);
      clearRefusal();
      // A resend first asks whether the earlier try arrived after all.
      if (resend) {
        const found = await lookUpTestPrint(userId, payload.idempotencyKey);
        setLookupMissing(found === undefined);
        if (found) { try { localStorage.removeItem(sendingKey); } catch { /* lapses on its own */ } settleSent(payload.idempotencyKey, found, false); return; }
      }
      mark();
      const heartbeat = setInterval(mark, 4000);
      try {
        // A stalled connection ends as "no answer" (the same print is kept to
        // send again) a little after the server's own 60s limit.
        const result = await api('/api/office/preview', { method: 'POST', body: JSON.stringify(payload), signal: AbortSignal.timeout(75_000) }).finally(() => {
          clearInterval(heartbeat);
          // Cut off by a reload: the mark stays up (it lapses on its own), so
          // the next page says "sending" and looks the print up instead of "not sure".
          if (!unloading.current) try { localStorage.removeItem(sendingKey); sessionStorage.removeItem(mineKey); } catch { /* lapses on its own */ }
        });
        try { localStorage.setItem(sentKey, JSON.stringify({ runId: result.runId, at: Date.now() })); } catch { /* only a hint for other tabs */ }
        forgetSaved(payload.idempotencyKey); setPending(null); setRunId(result.runId);
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
          forgetSaved(payload.idempotencyKey); setPending(null);
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
  const canSend = !busy && !otherTabSending && canPrint && !!printer && (pending ? true : readiness.canSend && quantityOk && !(bitmap && proofs?.key !== proofKey));
  const dot = readiness.tone === 'ok' ? 'bg-emerald-400' : readiness.tone === 'bad' ? 'bg-red-400' : 'bg-amber-400';
  // Another tab is sending this design's saved test print: said once, with no button to press.
  const elsewhere = !!pending && !busy && otherTabSending;
  const unsure = !!pending && !busy && !otherTabSending;
  const unsureWords = pending && (pending.status === undefined || uncertainSendWords(pending.status, pending.code).cause === 'no-answer')
    ? '“Send again” resends that same print (not later edits), so it won’t print twice.'
    : pending ? uncertainSendWords(pending.status, pending.code).message.replace('come back to this run', 'come back to this design') : '';
  const sendLabel = busy ? 'Sending…' : shownRefusal && !refusalNeedsSomeoneElse(shownRefusal.reason) ? 'Try again' : quantity === 1 ? 'Send 1 test label' : `Send ${quantity} test labels`;
  // The same two ways out as a run's saved send: clear it when it came out,
  // or forget it (asks first, since sending it again later could print twice).
  const dropSaved = () => {
    if (!pending) return;
    forgetSaved(pending.idempotencyKey);
    try { sessionStorage.removeItem(mineKey); } catch { /* nothing saved */ }
    setPending(null); setError(''); setLookupMissing(false);
  };
  const clearArrived = () => { dropSaved(); setClearedNote('Cleared. Test prints show up in Runs.'); };
  const forgetSend = async () => {
    if (!pending) return;
    const ok = await confirmDialog({ title: 'Forget this send?',
      body: 'If the office did get this test print, sending it again later prints it twice. “Send again” is the safe way: it can’t print twice.',
      confirmLabel: 'Forget it', cancelLabel: 'Keep it', danger: true });
    // The dialog closed the panel; open it again on what was chosen.
    setOpen(true);
    if (!ok) return;
    dropSaved();
  };
  const sentLine = runId && <p role="status" className="flex items-start gap-2 text-emerald-400"><Check className="mt-0.5 size-4 shrink-0 rounded-full animate-success" aria-hidden="true" /><span>{sentElsewhere ? 'Sent from another tab.' : 'Test print sent to the office.'} <Link href={`/runs/${encodeURIComponent(runId)}`} className="link">See it or cancel it</Link></span></p>;
  // Closed panel: one short line beside the button, so the state is seen
  // without the panel opening by itself (and pushing the row about).
  const inline = open ? null
    : elsewhere ? <span role="status" className="text-zinc-400">{sendingBeforeReload ? 'Sending…' : 'Sending from another tab…'}</span>
      : busy ? <span role="status" className="text-zinc-400">Sending…</span>
        : unsure ? <span className="text-amber-300">Not sure the last test print went</span>
          : runId ? <span role="status" className="text-emerald-400">{sentElsewhere ? 'Sent from another tab' : 'Test print sent'}</span>
            : null;
  const triggerIcon = busy || elsewhere ? 'busy' : runId ? 'sent' : 'idle';
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  useDismiss(open, () => setOpen(false), [panelRef, triggerRef]);

  return <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
    <button ref={triggerRef} type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className="btn btn-secondary btn-sm">
      <IconSwap className="size-4" active={triggerIcon} icons={{ idle: <Printer className="size-4" />, busy: <Loader2 className="size-4 animate-spin" />, sent: <Check className="size-4 text-emerald-400" /> }} />
      Test print at the office
    </button>
    {inline}
    {/* Drawn over the page, so opening it moves nothing beside it. */}
    <PopLayer ref={panelRef} open={open} className="absolute left-0 top-full z-50 mt-1 w-[min(28rem,calc(100vw-1.5rem))] space-y-3 rounded-xl bg-zinc-900 p-4 shadow-xl shadow-black/50 [--origin:top_left]">
      <p className="text-zinc-400">Prints this design with its sample text on the office printer. It shows up in Runs as a test print.</p>
      <div className="space-y-1.5">
        {printers.length > 1 ? (
          <CustomSelect aria-label="Office printer" disabled={busy || !!pending} value={pending?.printerId ?? selected} onChange={setSelected} options={printers.map(p => ({ value: p.id, label: p.name }))} />
        ) : <p className="font-medium text-zinc-100">{printers[0]?.name ?? 'No office printer is set up for your account'}</p>}
        {printer && <p className="flex items-start gap-2 text-zinc-400"><span aria-hidden="true" className={`status-dot mt-1.5 size-2 shrink-0 rounded-full ${dot}`} />{readiness.text}</p>}
      </div>
      <label className="flex items-center gap-2 text-zinc-300">How many test labels
        <input type="number" inputMode="numeric" min={1} max={25} value={pending?.quantity ?? quantity} disabled={busy || !!pending} onChange={e => setQuantity(Number(e.target.value))} className="field w-20 tabular-nums" aria-describedby="office-test-quantity-help" />
        <span id="office-test-quantity-help" className="text-zinc-400">up to 25</span>
      </label>
      {bitmap && !pending && <div className="space-y-1">{proofs?.key === proofKey ? proofs.results.map((r, i) => <img key={i} src={r.proof} alt={`Test label ${i + 1} as it will print`} className="w-full bg-white" style={{ imageRendering: 'pixelated' }} />) : <p role="status" className="text-zinc-400">Drawing the label exactly as it will print…</p>}</div>}
      {elsewhere && <p role="status" className="flex items-center gap-2 text-zinc-300"><Loader2 className="size-4 shrink-0 animate-spin text-amber-400" aria-hidden="true" />{sendingBeforeReload ? 'Sending your last test print…' : 'Sending this test print from another tab…'}</p>}
      {unsure && <Recovery tone="warning" title="We’re not sure the office got your last test print" actions={<>
        <button type="button" disabled={!canSend} onClick={() => void submit()} className="btn btn-primary btn-sm">Send again</button>
        {lookupMissing
          ? <button type="button" onClick={clearArrived} className="btn btn-ghost btn-sm">They arrived, clear this</button>
          : <button type="button" onClick={() => void forgetSend()} className="btn btn-ghost btn-sm">Forget this send</button>}
      </>}>
        <p>{unsureWords}{lookupMissing ? ' If it came out of the office printer, press “They arrived, clear this”.' : <> Or <Link href="/runs" className="link">check Runs</Link> first.</>}</p>
      </Recovery>}
      {clearedNote && !pending && !runId && <p role="status" className="text-zinc-400">{clearedNote}</p>}
      {shownRefusal && !pending && <Recovery role="alert" tone="danger" title="Your last test print wasn’t sent"><p>{shownRefusal.message}</p></Recovery>}
      {(!pending || busy) && <button type="button" disabled={!canSend} onClick={() => void submit()} className="btn btn-primary btn-sm">{busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}{sendLabel}</button>}
      {error && <p role="alert" className="text-red-400">{error}</p>}
      {sentLine}
    </PopLayer>
  </div>;
}
