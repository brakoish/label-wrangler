'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Printer, Pause, Play, X, CheckCircle2, AlertCircle, Loader2, Plug, RotateCcw, FileSpreadsheet, Clipboard, Hash, SquareDashed } from 'lucide-react';
import { LabelOutlineOverlay } from '../LabelOutlineOverlay';
import { LayoutPreview } from '@/components/designer/LayoutPreview';
import type { Run, LabelTemplate, LabelFormat } from '@/lib/types';
import { useRunStore } from '@/lib/runStore';
import { useTemplateStore } from '@/lib/templateStore';
import { useFormatStore } from '@/lib/store';
import { startPrintQueue, type RunQueueHandle } from '@/lib/printQueue';
import { generateLabelsForRun, previewLabelValues } from '@/lib/runBuilder';
import { generateZPL } from '@/lib/zplGenerator';
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

  // Label preview state — which row to show in the small thumbnail.
  const [previewIndex, setPreviewIndex] = useState(0);
  // Show dashed outlines around each label in the preview. Default on for
  // multi-across formats where lane boundaries actually matter visually.
  const [showOutlines, setShowOutlines] = useState<boolean>(((format?.labelsAcross ?? 1) > 1));
  // Reprint-range UI state.
  const [showReprint, setShowReprint] = useState(false);
  const [reprintFrom, setReprintFrom] = useState(1);

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
          /* soft fail — user can reconnect */
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

  // Build the ZPL feed list once we have run + template + format. For
  // single-across rolls one feed = one physical label. For multi-across
  // each feed produces `across` physical labels with unique data per lane.
  const across = Math.max(1, format?.labelsAcross || 1);
  const labels = useMemo(() => {
    if (!run || !template || !format) return [] as string[];
    return generateLabelsForRun(run, template, format);
  }, [run, template, format]);
  // Total printer feeds (may be < total physical labels when across > 1).
  const totalFeeds = labels.length;

  const canStart = !!run && labels.length > 0 && (
    (transport === 'dazzle' && !!dazzleSelected) ||
    (transport === 'webusb' && !!usbPrinter)
  );

  // Preview ZPL for whichever label index the user is inspecting.
  // For multi-across rolls we group rows by feed so the preview matches
  // what actually prints: lane 0 = row N, lane 1 = row N+1, etc.
  const previewZpl = useMemo(() => {
    if (!run || !template || !format) return '';
    const maxIdx = Math.max(0, run.sourceData.length - 1);
    const idx = Math.min(Math.max(0, previewIndex), maxIdx);
    if (across === 1) {
      return generateZPL(template, format, previewLabelValues(run, idx));
    }
    // Multi-across: snap idx to the start of its feed group, then build
    // per-lane values for that group.
    const feedStart = Math.floor(idx / across) * across;
    const laneValues: Array<Record<string, string> | undefined> = [];
    for (let lane = 0; lane < across; lane++) {
      const rowIdx = feedStart + lane;
      laneValues.push(rowIdx <= maxIdx ? previewLabelValues(run, rowIdx) : undefined);
    }
    return generateZPL(template, format, laneValues);
  }, [run, template, format, previewIndex, across]);

  // Friendly description of where each dynamic field's value is coming from.
  const mappingRows = useMemo(() => {
    if (!run || !template) return [] as Array<{ field: string; source: string; sample: string }>;
    const out: Array<{ field: string; source: string; sample: string }> = [];
    const row0 = run.sourceData[0];
    const isObjRow = row0 && typeof row0 === 'object' && !Array.isArray(row0);
    const fieldsSeen = new Set<string>();
    for (const el of template.elements) {
      if (el.isStatic) continue;
      const f = el.fieldName;
      if (!f || fieldsSeen.has(f)) continue;
      fieldsSeen.add(f);
      const mapping = run.fieldMappings?.[f];
      if (mapping?.mode === 'column' && mapping.csvColumn) {
        const col = mapping.csvColumn;
        let sample = '';
        if (col === '__paste__') {
          sample = typeof row0 === 'string' ? row0 : '';
        } else if (isObjRow) {
          sample = (row0 as Record<string, string>)[col] ?? '';
        }
        out.push({
          field: f,
          source: col === '__paste__' ? 'pasted values' : `CSV → ${col}`,
          sample,
        });
      } else if (run.mappedField === f && typeof row0 === 'string') {
        out.push({ field: f, source: 'pasted values', sample: row0 });
      } else {
        out.push({ field: f, source: 'static', sample: run.staticValues?.[f] ?? '' });
      }
    }
    return out;
  }, [run, template]);

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

    // The queue tracks feeds internally (startIndex/done are feed counts).
    // We convert between physical-label count (what the user + DB see) and
    // feed count (what the queue consumes) at the boundary so multi-across
    // progress bars behave intuitively.
    const startFeed = Math.floor(printedCount / across);
    const handle = startPrintQueue(sender, {
      labels,
      batchSize: 25,
      startIndex: startFeed,
      onProgress: async (feedsDone) => {
        // Each feed produced up to `across` physical labels. Clamp to total
        // so the last (possibly-partial) feed doesn't overshoot.
        const physical = Math.min(feedsDone * across, total);
        setPrintedCount(physical);
        // Fire-and-forget DB update — don't block printing on persistence.
        void persistProgress(physical);
        if (feedsDone >= labels.length) {
          setStatus('completed');
          await setRunStatus(run.id, 'completed', physical);
        }
      },
      onError: async (err, atFeed) => {
        setStatus('error');
        setErrorMsg((err as Error)?.message || 'Print failed');
        // Persist physical-label count corresponding to the failed feed.
        const atPhysical = Math.min(atFeed * across, total);
        await setRunStatus(run.id, 'paused', atPhysical);
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

  // Jump back to label N (1-based) and put the run back in 'paused' so Start
  // kicks off from there. Used for reprinting a bad strip without re-running
  // the whole batch.
  const handleReprintFrom = async (oneBased: number) => {
    if (!run) return;
    const n = Math.max(1, Math.min(total, Math.floor(oneBased)));
    const newPrinted = n - 1;
    setPrintedCount(newPrinted);
    setStatus('paused');
    setShowReprint(false);
    await setRunStatus(run.id, 'paused', newPrinted);
  };

  // Reset the whole run (printedCount -> 0, status -> queued) so user can hit
  // Start again and print the whole batch from scratch.
  const handleReprintAll = async () => {
    if (!run) return;
    if (!confirm(`Reprint all ${total} labels from the beginning?`)) return;
    setPrintedCount(0);
    setStatus('idle');
    await setRunStatus(run.id, 'queued', 0);
  };

  if (!run || !template || !format) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading run…
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-[980px] mx-auto w-full p-8 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-zinc-100 truncate">{run.name}</h1>
            <p className="text-sm text-zinc-500 mt-1">
              {template.name} · {format.name} · {format.width}″ × {format.height}″ · {total} labels
            </p>
          </div>
          <div className="shrink-0 flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-full font-medium border"
            style={{}}
          >
            <span className={
              run.status === 'completed' ? 'text-emerald-400' :
              run.status === 'printing' ? 'text-amber-400' :
              run.status === 'paused' ? 'text-yellow-400' :
              run.status === 'cancelled' ? 'text-red-400' : 'text-zinc-400'
            }>{run.status}</span>
          </div>
        </header>

        {/* Two-column: left = summary + preview; right = printer + controls. */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-6">

        {/* Run summary: how fields are mapped + a live label preview. */}
        <section className="glass rounded-2xl p-5 border border-zinc-800 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Label Data</h2>
            <span className="text-[11px] text-zinc-500 flex items-center gap-1.5">
              {run.dataSource === 'csv' ? <FileSpreadsheet className="w-3 h-3" /> : <Clipboard className="w-3 h-3" />}
              {run.dataSource === 'csv' ? 'CSV import' : 'Pasted values'}
            </span>
          </div>
          {mappingRows.length === 0 ? (
            <p className="text-xs text-zinc-500">No dynamic fields — every label prints the same.</p>
          ) : (
            <div className="space-y-1">
              {mappingRows.map((m) => (
                <div key={m.field} className="flex items-center gap-3 text-xs py-1.5 px-2 rounded-md bg-zinc-950/40">
                  <span className="w-28 shrink-0 font-medium text-zinc-200 truncate">{m.field}</span>
                  <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${m.source === 'static' ? 'bg-zinc-800 text-zinc-400' : 'bg-amber-500/15 text-amber-400'}`}>
                    {m.source}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-zinc-400 font-mono text-[10.5px]" title={m.sample}>
                    {m.sample || <span className="text-zinc-600">(empty)</span>}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Per-label preview with row stepper. Lets the user spot-check that,
              say, label 1 and label 543 really do have different QR codes. */}
          <div className="pt-2 border-t border-zinc-800/60 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Preview</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowOutlines((s) => !s)}
                  title={showOutlines ? 'Hide label outlines' : 'Show label outlines'}
                  className={`p-1 rounded transition-colors ${showOutlines ? 'text-amber-400 bg-amber-500/10' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  <SquareDashed className="w-3.5 h-3.5" />
                </button>
              {total > 0 && (
                <div className="flex items-center gap-1.5 text-[11px]">
                  <button
                    onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                    disabled={previewIndex === 0}
                    className="px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
                  >‹</button>
                  <input
                    type="number"
                    min={1}
                    max={total}
                    value={previewIndex + 1}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (Number.isFinite(n)) setPreviewIndex(Math.max(0, Math.min(total - 1, n - 1)));
                    }}
                    className="w-14 text-center bg-zinc-950 border border-zinc-800 rounded text-[11px] text-zinc-200 tabular-nums py-0.5 focus:outline-none focus:border-amber-500/40"
                  />
                  <span className="text-zinc-500">/ {total}</span>
                  <button
                    onClick={() => setPreviewIndex((i) => Math.min(total - 1, i + 1))}
                    disabled={previewIndex >= total - 1}
                    className="px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
                  >›</button>
                </div>
              )}
              </div>
            </div>
            <div className="rounded-xl bg-zinc-950/60 p-3 min-h-[120px] flex items-center justify-center">
              {format.type === 'sheet' ? (
                // Sheet formats can't be rendered by the ZPL WASM engine —
                // show the SVG sheet-grid layout instead so the user actually
                // sees 10x20 / 8x11 / whatever grid they designed.
                <div className="w-full">
                  <LayoutPreview format={format} elements={template.elements} />
                </div>
              ) : (
                <LocalZplPreview zpl={previewZpl} format={format} showOutlines={showOutlines} />
              )}
            </div>
          </div>
        </section>

          </div>

          <div className="space-y-6">

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
              {printedCount} / {total} · {pct}%
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

          {/* Reprint tools — always available once status is not 'running'. */}
          {status !== 'running' && total > 0 && (
            <div className="pt-3 border-t border-zinc-800/60 space-y-2">
              {!showReprint ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setReprintFrom(Math.max(1, printedCount)); setShowReprint(true); }}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium text-zinc-400 hover:text-amber-400 hover:bg-amber-500/10 transition-colors border border-zinc-800"
                    title="Jam, ribbon out, bad print? Reprint a range."
                  >
                    <Hash className="w-3 h-3" /> Reprint from label…
                  </button>
                  {status === 'completed' && (
                    <button
                      onClick={handleReprintAll}
                      className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium text-zinc-400 hover:text-amber-400 hover:bg-amber-500/10 transition-colors border border-zinc-800"
                    >
                      <RotateCcw className="w-3 h-3" /> All
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-zinc-400 whitespace-nowrap">Start at label</label>
                  <input
                    type="number"
                    min={1}
                    max={total}
                    value={reprintFrom}
                    onChange={(e) => setReprintFrom(parseInt(e.target.value, 10) || 1)}
                    className="w-20 bg-zinc-950 border border-zinc-800 rounded text-xs text-zinc-200 tabular-nums px-2 py-1 focus:outline-none focus:border-amber-500/40"
                  />
                  <span className="text-[11px] text-zinc-500">/ {total}</span>
                  <button
                    onClick={() => void handleReprintFrom(reprintFrom)}
                    className="px-3 py-1 rounded-md text-[11px] font-semibold bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                  >
                    Set
                  </button>
                  <button
                    onClick={() => setShowReprint(false)}
                    className="px-2 py-1 rounded-md text-[11px] text-zinc-500 hover:text-zinc-300"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

          </div>
        </div>
      </div>
    </div>
  );
}

// Inline ZPL preview via zpl-renderer-js WASM — same renderer as the
// designer, scaled into whatever space it's given. Caches module-level.
function LocalZplPreview({ zpl, format, showOutlines }: { zpl: string; format: LabelFormat; showOutlines?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    if (!zpl) return;
    (async () => {
      try {
        const mod = await import('zpl-renderer-js');
        const { api } = await mod.ready;
        // Multi-across: render the full liner width so all N labels fit in the preview.
        const across = Math.max(1, format.labelsAcross || 1);
        const gapIn = format.horizontalGapThermal || 0;
        const sideIn = format.sideMarginThermal || 0;
        const computedLinerIn = sideIn * 2 + across * format.width + (across - 1) * gapIn;
        const linerIn = format.linerWidth || computedLinerIn;
        const widthMm = linerIn * 25.4;
        const heightMm = format.height * 25.4;
        const dpmm = Math.round((format.dpi || 203) / 25.4);
        const b64 = await api.zplToBase64Async(zpl, widthMm, heightMm, dpmm);
        if (!cancelled) setUrl(`data:image/png;base64,${b64}`);
      } catch (e) {
        if (!cancelled) setErr((e as Error)?.message || 'Render failed');
      }
    })();
    return () => { cancelled = true; };
  }, [zpl, format.width, format.height, format.dpi]);

  if (err) return <p className="text-[11px] text-red-400">{err}</p>;
  if (!url) return <p className="text-[11px] text-zinc-500">Rendering…</p>;
  return (
    <div className="relative inline-block">
      <img
        src={url}
        alt="Label preview"
        className="rounded-md border border-zinc-800 bg-white"
        style={{ imageRendering: 'pixelated', maxWidth: '100%', maxHeight: '240px', display: 'block' }}
      />
      {showOutlines && <LabelOutlineOverlay format={format} />}
    </div>
  );
}
