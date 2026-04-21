'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Printer, Pause, Play, X, CheckCircle2, AlertCircle, Loader2, Plug } from 'lucide-react';
import type { Run, LabelTemplate, LabelFormat } from '@/lib/types';
import { useRunStore } from '@/lib/runStore';
import { useTemplateStore } from '@/lib/templateStore';
import { useFormatStore } from '@/lib/store';
import { startPrintQueue, type RunQueueHandle } from '@/lib/printQueue';
import { generateLabelsForRun } from '@/lib/runBuilder';
import {
  isWebUsbSupported,
  getAuthorizedPrinters,
  openPrinter,
  requestPrinter,
  printZpl,
  type ConnectedPrinter,
} from '@/lib/webusbPrinter';
import {
  isDazzleRunning,
  listDazzlePrinters,
  printViaDazzle,
  type DazzlePrinter,
} from '@/lib/dazzlePrinter';

type Transport = 'dazzle' | 'webusb';

interface RunPrinterProps {
  runId: string;
  onDone?: () => void;
}

/**
 * Screen shown after a run is created and ready to print.
 * Resolves the transport (Dazzle preferred if running), then streams ZPL in
 * batches with a live progress bar, pause/resume, and cancel.
 */
export function RunPrinter({ runId, onDone }: RunPrinterProps) {
  const { runs, updateRun, setRunStatus } = useRunStore();
  const { templates } = useTemplateStore();
  const { formats } = useFormatStore();

  const run = runs.find((r) => r.id === runId) ?? null;
  const template: LabelTemplate | null = run ? templates.find((t) => t.id === run.templateId) ?? null : null;
  const format: LabelFormat | null = template ? formats.find((f) => f.id === template.formatId) ?? null : null;

  // Transport detection
  const [dazzleAvailable, setDazzleAvailable] = useState(false);
  const [transport, setTransport] = useState<Transport | null>(null);
  const [usbPrinter, setUsbPrinter] = useState<ConnectedPrinter | null>(null);
  const [dazzlePrinters, setDazzlePrinters] = useState<DazzlePrinter[]>([]);
  const [dazzleSelected, setDazzleSelected] = useState<string | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);

  // Print state
  const queueRef = useRef<RunQueueHandle | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'paused' | 'completed' | 'cancelled' | 'error'>('idle');
  const [printedCount, setPrintedCount] = useState(run?.printedCount ?? 0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const total = run?.totalLabels ?? 0;
  const pct = total > 0 ? Math.round((printedCount / total) * 100) : 0;

  const webUsbSupported = typeof window !== 'undefined' && isWebUsbSupported();

  // Detect transport once on mount.
  useEffect(() => {
    (async () => {
      const dz = await isDazzleRunning();
      setDazzleAvailable(dz);
      // Prefer Dazzle; fall back to WebUSB.
      if (dz) {
        setTransport('dazzle');
        try {
          const ps = await listDazzlePrinters();
          setDazzlePrinters(ps);
          const savedPrinter = typeof window !== 'undefined' ? localStorage.getItem('lw:dazzle-printer') : null;
          const match = savedPrinter ? ps.find((p) => p.name === savedPrinter) : undefined;
          setDazzleSelected(match?.name ?? ps.find((p) => p.is_default)?.name ?? ps[0]?.name ?? null);
        } catch (err) {
          setTransportError((err as Error).message || 'Failed to load Dazzle printers');
        }
      } else if (webUsbSupported) {
        setTransport('webusb');
        try {
          const authorized = await getAuthorizedPrinters();
          if (authorized.length > 0) {
            const opened = await openPrinter(authorized[0]);
            setUsbPrinter(opened);
          }
        } catch {
          /* soft fail \u2014 user can reconnect */
        }
      } else {
        setTransportError('No printer transport available. Install Dazzle or use Chrome/Edge.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warn user if they try to close the tab mid-print.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (status === 'running' || status === 'paused') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [status]);

  // Build the per-label ZPL list once we have run + template + format.
  const labels = useMemo(() => {
    if (!run || !template || !format) return [] as string[];
    return generateLabelsForRun(run, template, format);
  }, [run, template, format]);

  const canStart = !!run && labels.length > 0 && (
    (transport === 'dazzle' && !!dazzleSelected) ||
    (transport === 'webusb' && !!usbPrinter)
  );

  const persistProgress = async (next: number) => {
    if (!run) return;
    await updateRun(run.id, { printedCount: next });
  };

  const startOrResume = async () => {
    if (!run || labels.length === 0) return;
    setErrorMsg(null);
    setStatus('running');
    await setRunStatus(run.id, 'printing', printedCount);

    const sender = {
      send: async (zpl: string) => {
        if (transport === 'dazzle') {
          await printViaDazzle(zpl, dazzleSelected ?? undefined);
        } else if (transport === 'webusb' && usbPrinter) {
          await printZpl(usbPrinter, zpl);
        } else {
          throw new Error('No printer connected');
        }
      },
    };

    const handle = startPrintQueue(sender, {
      labels,
      batchSize: 25,
      startIndex: printedCount,
      onProgress: async (done) => {
        setPrintedCount(done);
        // Fire-and-forget DB update \u2014 we don't block printing on persistence.
        void persistProgress(done);
        if (done >= labels.length) {
          setStatus('completed');
          await setRunStatus(run.id, 'completed', done);
        }
      },
      onError: async (err, atIndex) => {
        setStatus('error');
        setErrorMsg((err as Error)?.message || 'Print failed');
        await setRunStatus(run.id, 'paused', atIndex);
      },
    });

    queueRef.current = handle;
  };

  const handlePause = async () => {
    queueRef.current?.pause();
    setStatus('paused');
    if (run) await setRunStatus(run.id, 'paused', printedCount);
  };

  const handleCancel = async () => {
    queueRef.current?.cancel();
    setStatus('cancelled');
    if (run) await setRunStatus(run.id, 'cancelled', printedCount);
  };

  if (!run || !template || !format) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading run\u2026
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-[800px] mx-auto w-full p-8 space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-zinc-100">{run.name}</h1>
          <p className="text-sm text-zinc-500 mt-1">{template.name} \u00b7 {format.name} \u00b7 {total} labels</p>
        </header>

        {/* Transport setup */}
        <section className="glass rounded-2xl p-5 border border-zinc-800 space-y-3">
          <h2 className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Printer</h2>
          {dazzleAvailable && webUsbSupported && (
            <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-zinc-900 border border-zinc-800 w-fit">
              <button
                onClick={() => setTransport('dazzle')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium ${transport === 'dazzle' ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-500'}`}
              >
                Dazzle
              </button>
              <button
                onClick={() => setTransport('webusb')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium ${transport === 'webusb' ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-500'}`}
              >
                WebUSB
              </button>
            </div>
          )}
          {transport === 'dazzle' && (
            dazzlePrinters.length > 0 ? (
              <select
                value={dazzleSelected ?? ''}
                onChange={(e) => {
                  setDazzleSelected(e.target.value);
                  if (typeof window !== 'undefined') localStorage.setItem('lw:dazzle-printer', e.target.value);
                }}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 px-3 py-2"
              >
                {dazzlePrinters.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}{p.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-zinc-500">No printers found in Dazzle.</p>
            )
          )}
          {transport === 'webusb' && (
            usbPrinter ? (
              <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle2 className="w-4 h-4" /> {usbPrinter.productName}
              </div>
            ) : (
              <button
                onClick={async () => {
                  try {
                    const d = await requestPrinter();
                    const o = await openPrinter(d);
                    setUsbPrinter(o);
                  } catch (err) {
                    if ((err as Error).name !== 'NotFoundError') setTransportError((err as Error).message);
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-zinc-900 border border-zinc-800 hover:border-amber-500/30 text-zinc-300 transition-colors"
              >
                <Plug className="w-3.5 h-3.5" /> Connect printer
              </button>
            )
          )}
          {transportError && <p className="text-xs text-red-400">{transportError}</p>}
        </section>

        {/* Progress */}
        <section className="glass rounded-2xl p-5 border border-zinc-800 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Progress</h2>
            <span className="text-sm font-semibold text-zinc-100 tabular-nums">
              {printedCount} / {total} \u00b7 {pct}%
            </span>
          </div>
          <div className="h-3 rounded-full bg-zinc-900 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all" style={{ width: `${pct}%` }} />
          </div>
          {errorMsg && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" /> {errorMsg}
            </p>
          )}

          {/* Controls */}
          <div className="flex items-center gap-2 pt-2">
            {(status === 'idle' || status === 'paused' || status === 'error') && printedCount < total && (
              <button
                onClick={startOrResume}
                disabled={!canStart}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:from-amber-400 hover:to-amber-500 transition-all disabled:opacity-40"
              >
                {status === 'paused' ? <Play className="w-4 h-4" /> : <Printer className="w-4 h-4" />}
                {status === 'paused' ? 'Resume' : status === 'error' ? 'Retry' : 'Start Printing'}
              </button>
            )}
            {status === 'running' && (
              <button
                onClick={handlePause}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
              >
                <Pause className="w-4 h-4" /> Pause
              </button>
            )}
            {status !== 'completed' && status !== 'cancelled' && (
              <button
                onClick={handleCancel}
                className="px-4 py-2.5 rounded-lg text-sm font-medium bg-zinc-900 text-zinc-400 hover:text-red-400 hover:border-red-500/30 border border-zinc-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            {status === 'completed' && (
              <button
                onClick={onDone}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" /> Done
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
