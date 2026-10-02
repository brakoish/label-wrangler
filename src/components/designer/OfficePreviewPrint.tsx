'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Printer } from 'lucide-react';
import { getBitmapProof, type BitmapResult } from '@/lib/thermal/client';
import type { LabelFormat, LabelTemplate } from '@/lib/types';

type PrinterInfo = { station_id: string; id: string; name: string; online: boolean; dispatch_enabled: boolean; needs_review: boolean };
type Pending = { idempotencyKey: string; stationId: string; printerId: string; quantity: number; template: LabelTemplate; format: LabelFormat; testData: Record<string, string>; expectedPixelDigests?: string[] };
async function api(url: string, options?: RequestInit) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json' } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Office printer request failed');
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
      } catch (e) { if (active) setError((e as Error).message); }
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [open, bitmap, pending, proofKey, template, format, testData, quantity]);
  const storageKey = `lw:designer-office-preview:${template.id}`;

  useEffect(() => {
    setPending(null); setRunId(''); setError('');
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) { setPending(JSON.parse(saved)); setOpen(true); }
    } catch { setError('Unable to read the pending preview request. Check Runs before printing again.'); }
  }, [storageKey]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const refresh = async () => {
      try {
        const data = await api('/api/office/stations');
        if (!active) return;
        setPrinters(data.printers); setCanPrint(data.canPrint);
        setSelected(value => value || data.printers[0]?.id || '');
      } catch (error) { if (active) setError((error as Error).message); }
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [open]);

  const printer = printers.find(p => p.id === (pending?.printerId ?? selected));
  const submit = async () => {
    if (inFlight.current || !printer || (bitmap && !pending && proofs?.key !== proofKey)) return;
    inFlight.current = true; setBusy(true); setError(''); setRunId('');
    try {
      const payload = pending ?? {
        idempotencyKey: crypto.randomUUID(), stationId: printer.station_id, printerId: printer.id,
        quantity, template, format, testData: testData ?? {},
        ...(bitmap ? { expectedPixelDigests: proofs!.results.map(r => r.pixelDigest) } : {}),
      };
      // Persist the exact snapshot before sending; edits/reloads cannot change a retry.
      localStorage.setItem(storageKey, JSON.stringify(payload));
      setPending(payload);
      const result = await api('/api/office/preview', { method: 'POST', body: JSON.stringify(payload) });
      localStorage.removeItem(storageKey); setPending(null); setRunId(result.runId);
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to queue preview'); }
    finally { inFlight.current = false; setBusy(false); }
  };

  return <div className="text-xs">
    <button onClick={() => setOpen(value => !value)} aria-expanded={open} className="px-2 py-1 rounded border border-zinc-700 text-amber-400 inline-flex items-center gap-1"><Printer className="w-3 h-3" />Office printer</button>
    {open && <div className="mt-2 p-3 rounded-lg border border-zinc-700 bg-zinc-950 space-y-2 max-w-md">
      <p className="text-zinc-400">Print the current design and preview values. A Designer test record is saved in Runs.</p>
      <label className="block text-zinc-400">Printer
        <select aria-label="Preview office printer" disabled={busy || !!pending} value={pending?.printerId ?? selected} onChange={e => setSelected(e.target.value)} className="block w-full mt-1 bg-zinc-900 rounded p-2">
          {!printers.length && <option value="">No authorized office printer</option>}
          {printers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      {printer && <p className="text-zinc-400">{printer.online ? 'Office connected' : 'Office offline — queued work waits for reconnect'}{printer.needs_review ? ' · Check printer before retrying' : ''}</p>}
      <label className="block text-zinc-400">Preview labels (1–25)
        <input aria-label="Office preview label count" type="number" min={1} max={25} value={pending?.quantity ?? quantity} disabled={busy || !!pending} onChange={e => setQuantity(Number(e.target.value))} className="ml-2 w-16 rounded bg-zinc-900 p-1" />
      </label>
      {bitmap && !pending && <div className="space-y-1">{proofs?.key === proofKey ? proofs.results.map((r, i) => <img key={i} src={r.proof} alt={`Office feed ${i + 1} final proof`} className="w-full bg-white" style={{ imageRendering: 'pixelated' }} />) : <p className="text-zinc-500">Preparing exact Office proof…</p>}</div>}
      {pending && <p className="text-amber-400">Retry sends the same saved preview, not subsequent edits.</p>}
      <button disabled={busy || !canPrint || !printer?.dispatch_enabled || (bitmap && !pending && proofs?.key !== proofKey) || (!pending && (printer.needs_review || !Number.isInteger(quantity) || quantity < 1 || quantity > 25))} onClick={() => void submit()} className="rounded bg-amber-500 text-black px-3 py-2 font-semibold disabled:opacity-40">{busy ? 'Queueing…' : pending ? 'Retry same preview' : 'Print preview to Office'}</button>
      {error && <p role="alert" className="text-red-400">{error}</p>}
      {pending && !busy && <p className="text-zinc-400"><Link href="/runs" className="underline">Check Runs</Link> before <button className="underline" onClick={() => {
        if (!confirm('Check Runs first: the preview may already be queued. Clearing this form does not cancel any print job. Continue?')) return;
        localStorage.removeItem(storageKey); setPending(null); setError('');
      }}>clearing the pending form</button>. Clearing does not cancel queued printing.</p>}
      {runId && <p role="status" className="text-emerald-400">Preview queued. <Link href={`/runs/${encodeURIComponent(runId)}`} className="underline">View delivery / cancel</Link></p>}
    </div>}
  </div>;
}
