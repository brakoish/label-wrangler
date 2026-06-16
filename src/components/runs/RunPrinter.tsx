'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Printer, Pause, Play, X, CheckCircle2, AlertCircle, Loader2, Plug, RotateCcw, FileSpreadsheet, Clipboard, Hash, SquareDashed, Pencil, Copy, ScanBarcode, Download, FileText, FileCode2, Search } from 'lucide-react';
import Link from 'next/link';
import { LabelOutlineOverlay } from '../LabelOutlineOverlay';
import { LayoutPreview } from '@/components/designer/LayoutPreview';
import type { LabelTemplate, LabelFormat, RunPrintEvent } from '@/lib/types';
import { useRunStore } from '@/lib/runStore';
import { useTemplateStore } from '@/lib/templateStore';
import { useFormatStore } from '@/lib/store';
import { startPrintQueue, type RunQueueHandle } from '@/lib/printQueue';
import { generateLabelsForRun, previewLabelValues } from '@/lib/runBuilder';
import { feedRangeForLabels, labelRangeCount, normalizeLabelRange } from '@/lib/runRanges';
import { updateRunWithQueue, flushOfflineQueue } from '@/lib/offlineQueue';
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

function runSourceMeta(source: string) {
  if (source === 'csv') return { label: 'CSV import', fieldLabel: 'CSV', icon: FileSpreadsheet };
  if (source === 'manifest') return { label: 'Manifest rows', fieldLabel: 'Manifest', icon: Search };
  if (source === 'manual') return { label: 'Manual rows', fieldLabel: 'Manual', icon: Pencil };
  return { label: 'Pasted rows', fieldLabel: 'Paste', icon: Clipboard };
}

interface RunPrinterProps {
  runId: string;
  onDone?: () => void;
}

function formatEventTime(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function printEventLabel(event: RunPrintEvent) {
  const range = `${event.rangeFrom}-${event.rangeTo}`;
  if (event.eventType === 'opened') return `Opened ${event.output} labels ${range}`;
  if (event.eventType === 'confirmed') return `Printed ${event.output} labels ${range}`;
  if (event.eventType === 'failed') return `Failed ${event.output} labels ${range}`;
  if (event.eventType === 'cancelled') return `Cancelled ${event.output} labels ${range}`;
  return `${event.message || 'Sent'} labels ${range}`;
}

/**
 * Screen shown after a run is created and ready to print.
 * Resolves the transport (Dazzle preferred if running), then streams ZPL in
 * batches with a live progress bar, pause/resume, and cancel.
 */
export function RunPrinter({ runId, onDone }: RunPrinterProps) {
  const { runs, updateRun, setRunStatus, printEvents, fetchPrintEvents, createPrintEvent } = useRunStore();
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
  const isSheetFormat = format?.type === 'sheet';

  // Label preview state — which row to show in the small thumbnail.
  const [previewIndex, setPreviewIndex] = useState(0);
  // Show dashed outlines around each label in the preview. Default on for
  // multi-across formats where lane boundaries actually matter visually.
  const [showOutlines, setShowOutlines] = useState<boolean>(((format?.labelsAcross ?? 1) > 1));
  // Reprint-range UI state.
  const [showReprint, setShowReprint] = useState(false);
  const [reprintFrom, setReprintFrom] = useState(1);
  const [stopAt, setStopAt] = useState(0); // 0 = print all; >0 = stop after this physical label
  const [showExport, setShowExport] = useState(false);
  const [exportFrom, setExportFrom] = useState(1);
  const [exportTo, setExportTo] = useState(0); // 0 = use total at render
  const [exporting, setExporting] = useState<'zpl' | 'pdf' | null>(null);
  const [exportProgress, setExportProgress] = useState(0);
  const [pendingSheetRange, setPendingSheetRange] = useState<{ from: number; to: number } | null>(null);

  // Inline run editing
  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState('');
  const [editStatic, setEditStatic] = useState<Record<string, string>>({});
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const webUsbSupported = typeof window !== 'undefined' && isWebUsbSupported();

  const eventsForRun = useMemo(
    () => printEvents.filter((event) => event.runId === runId),
    [printEvents, runId],
  );

  useEffect(() => {
    void fetchPrintEvents(runId);
  }, [fetchPrintEvents, runId]);

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
  const canStart = !!run && labels.length > 0 && (
    !isSheetFormat &&
    ((transport === 'dazzle' && !!dazzleSelected) ||
    (transport === 'webusb' && !!usbPrinter))
  );

  const previewValues = useMemo(() => {
    if (!run) return {};
    const maxIdx = Math.max(0, run.sourceData.length - 1);
    const idx = Math.min(Math.max(0, previewIndex), maxIdx);
    return previewLabelValues(run, idx);
  }, [run, previewIndex]);

  const sheetPreviewValues = useMemo(() => {
    if (!run || !format || format.type !== 'sheet') return undefined;
    const labelsPerSheet = Math.max(1, (format.columns || 1) * (format.rows || 1));
    const pageStart = Math.floor(previewIndex / labelsPerSheet) * labelsPerSheet;
    return Array.from({ length: labelsPerSheet }, (_, offset) => {
      const rowIndex = pageStart + offset;
      if (rowIndex >= run.sourceData.length) return undefined;
      return previewLabelValues(run, rowIndex);
    });
  }, [run, format, previewIndex]);

  const selectedSheetLabelOffset = useMemo(() => {
    if (!format || format.type !== 'sheet') return undefined;
    const labelsPerSheet = Math.max(1, (format.columns || 1) * (format.rows || 1));
    return previewIndex % labelsPerSheet;
  }, [format, previewIndex]);

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
    const sourceMeta = runSourceMeta(run.dataSource);
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
          source: col === '__paste__' ? 'pasted values' : `${sourceMeta.fieldLabel} → ${col}`,
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
    // Use the offline-friendly wrapper so a transient network flap during a
    // long print doesn't cost us the latest printedCount. Failed calls
    // queue in localStorage and flush on reconnect.
    await updateRunWithQueue(run.id, { printedCount: next });
  };

  // Flush any offline progress updates on mount + whenever the browser
  // tells us we're back online. Cheap: no-op when the queue is empty.
  useEffect(() => {
    void flushOfflineQueue();
    const onOnline = () => { void flushOfflineQueue(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

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

    const printRange = normalizeLabelRange({
      total,
      fallbackFrom: printedCount + 1,
      fallbackTo: stopAt > 0 ? Math.min(stopAt, total) : total,
    });
    // The queue tracks feeds internally (startIndex/done are feed counts).
    // We convert between physical-label count (what the user + DB see) and
    // feed count (what the queue consumes) at the boundary so multi-across
    // progress bars behave intuitively.
    const { startFeed, stopFeed } = feedRangeForLabels(printRange, across);
    const labelsToSend = stopFeed < labels.length ? labels.slice(0, stopFeed) : labels;
    const handle = startPrintQueue(sender, {
      labels: labelsToSend,
      batchSize: 25,
      startIndex: startFeed,
      onProgress: async (feedsDone) => {
        // Each feed produced up to `across` physical labels. Clamp to total
        // so the last (possibly-partial) feed doesn't overshoot.
        const physical = Math.min(feedsDone * across, total);
        setPrintedCount(physical);
        // Fire-and-forget DB update — don't block printing on persistence.
        void persistProgress(physical);
        if (feedsDone >= labelsToSend.length) {
          setStatus('completed');
          await setRunStatus(run.id, 'completed', physical);
          await createPrintEvent(run.id, {
            eventType: 'confirmed',
            output: 'roll-zpl',
            rangeFrom: printRange.from,
            rangeTo: printRange.to,
            labelCount: labelRangeCount(printRange),
            printedCountAfter: physical,
            printerName: transport === 'dazzle' ? dazzleSelected : usbPrinter?.productName ?? null,
            message: null,
          });
        }
      },
      onError: async (err, atFeed) => {
        setStatus('error');
        setErrorMsg((err as Error)?.message || 'Print failed');
        // Persist physical-label count corresponding to the failed feed.
        const atPhysical = Math.min(atFeed * across, total);
        await setRunStatus(run.id, 'paused', atPhysical);
        await createPrintEvent(run.id, {
          eventType: 'failed',
          output: 'roll-zpl',
          rangeFrom: printRange.from,
          rangeTo: printRange.to,
          labelCount: labelRangeCount(printRange),
          printedCountAfter: atPhysical,
          printerName: transport === 'dazzle' ? dazzleSelected : usbPrinter?.productName ?? null,
          message: (err as Error)?.message || 'Print failed',
        });
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
    if (run) {
      await setRunStatus(run.id, 'cancelled', printedCount);
      await createPrintEvent(run.id, {
        eventType: 'cancelled',
        output: 'roll-zpl',
        rangeFrom: Math.min(total, printedCount + 1),
        rangeTo: stopAt > 0 ? Math.min(stopAt, total) : total,
        labelCount: Math.max(0, (stopAt > 0 ? Math.min(stopAt, total) : total) - printedCount),
        printedCountAfter: printedCount,
        printerName: transport === 'dazzle' ? dazzleSelected : usbPrinter?.productName ?? null,
        message: null,
      });
    }
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

  const normalizeSheetRange = (range?: { from?: number; to?: number }) => normalizeLabelRange({
    total,
    from: range?.from,
    to: range?.to,
    fallbackFrom: printedCount + 1,
    fallbackTo: stopAt > 0 ? Math.min(stopAt, total) : total,
  });

  const sheetPrintHref = (range?: { from?: number; to?: number }) => {
    const resolved = normalizeSheetRange(range);
    const params = new URLSearchParams({
      from: String(resolved.from),
      to: String(resolved.to),
    });
    return `/runs/${runId}/print?${params.toString()}`;
  };

  const openSheetPrintRange = (range?: { from?: number; to?: number }) => {
    const resolved = normalizeSheetRange(range);
    const opened = window.open(sheetPrintHref(resolved), '_blank', 'noopener,noreferrer');
    if (!opened) {
      setErrorMsg('Popup blocked. Allow popups, then try again.');
      return;
    }
    setErrorMsg(null);
    setPendingSheetRange(resolved);
    if (run) {
      void createPrintEvent(run.id, {
        eventType: 'opened',
        output: 'sheet-pdf',
        rangeFrom: resolved.from,
        rangeTo: resolved.to,
        labelCount: labelRangeCount(resolved),
        printedCountAfter: printedCount,
        printerName: null,
        message: 'Opened sheet print/PDF output',
      });
    }
  };

  const markSheetRangePrinted = async () => {
    if (!run || !pendingSheetRange) return;
    const nextPrinted = Math.max(printedCount, pendingSheetRange.to);
    const nextStatus = nextPrinted >= total ? 'completed' : 'paused';
    setPrintedCount(nextPrinted);
    setStatus(nextStatus);
    setPendingSheetRange(null);
    await setRunStatus(run.id, nextStatus, nextPrinted);
    await createPrintEvent(run.id, {
      eventType: 'confirmed',
      output: 'sheet-pdf',
      rangeFrom: pendingSheetRange.from,
      rangeTo: pendingSheetRange.to,
      labelCount: labelRangeCount(pendingSheetRange),
      printedCountAfter: nextPrinted,
      printerName: null,
      message: null,
    });
  };

  // --- Edit handlers ---
  const openEdit = () => {
    if (!run) return;
    setEditName(run.name);
    setEditStatic({ ...run.staticValues });
    setEditNotes(run.notes ?? '');
    setShowEdit(true);
  };

  const handleSaveEdit = async () => {
    if (!run) return;
    setSaving(true);
    try {
      await updateRun(run.id, {
        name: editName.trim() || run.name,
        staticValues: editStatic,
        notes: editNotes.trim() || null,
      });
      setShowEdit(false);
    } finally {
      setSaving(false);
    }
  };

  // --- Export handlers ---
  const resolvedExportTo = exportTo > 0 ? exportTo : total;

  const handleExportZPL = async () => {
    if (!run || !template || !format) return;
    setExporting('zpl');
    try {
      const allFeeds = generateLabelsForRun(run, template, format);
      const range = normalizeLabelRange({ total, from: exportFrom, to: resolvedExportTo });
      const { startFeed, stopFeed } = feedRangeForLabels(range, across);
      const slice = allFeeds.slice(startFeed, stopFeed);
      const content = slice.join('\n');
      const blob = new Blob([content], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(run.name || 'run').replace(/[^a-z0-9_-]/gi, '_')}_${range.from}-${range.to}.zpl`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      await createPrintEvent(run.id, {
        eventType: 'sent',
        output: 'roll-zpl',
        rangeFrom: range.from,
        rangeTo: range.to,
        labelCount: labelRangeCount(range),
        printedCountAfter: null,
        printerName: null,
        message: 'Exported ZPL',
      });
    } finally {
      setExporting(null);
    }
  };

  const handleExportPDF = async () => {
    if (!run || !template || !format) return;
    setExporting('pdf');
    setExportProgress(0);
    try {
      const allFeeds = generateLabelsForRun(run, template, format);
      const range = normalizeLabelRange({ total, from: exportFrom, to: resolvedExportTo });
      const cappedRange = normalizeLabelRange({ total, from: range.from, to: Math.min(range.to, range.from + 499) }); // hard cap: 500 labels
      const { startFeed, stopFeed } = feedRangeForLabels(cappedRange, across);
      const slice = allFeeds.slice(startFeed, stopFeed);

      const mod = await import('zpl-renderer-js');
      const { api } = await mod.ready;
      const widthMm = format.width * 25.4;
      const heightMm = format.height * 25.4;
      const dpmm = Math.round((format.dpi || 203) / 25.4);

      const { PDFDocument } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.create();
      // Page size in PDF points (72 pt = 1 inch)
      const pageW = format.width * 72;
      const pageH = format.height * 72;

      for (let i = 0; i < slice.length; i++) {
        // Yield to the browser event loop every label so the page stays
        // responsive during long renders. WASM + pdf-lib are synchronous
        // under the hood and will lock the tab without this.
        await new Promise<void>((r) => setTimeout(r, 0));
        const b64 = await api.zplToBase64Async(slice[i], widthMm, heightMm, dpmm);
        const binStr = atob(b64);
        const bytes = new Uint8Array(binStr.length);
        for (let j = 0; j < binStr.length; j++) bytes[j] = binStr.charCodeAt(j);
        const img = await pdfDoc.embedPng(bytes);
        const page = pdfDoc.addPage([pageW, pageH]);
        page.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
        setExportProgress(Math.round(((i + 1) / slice.length) * 100));
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(run.name || 'run').replace(/[^a-z0-9_-]/gi, '_')}_${cappedRange.from}-${cappedRange.to}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      await createPrintEvent(run.id, {
        eventType: 'sent',
        output: 'roll-pdf',
        rangeFrom: cappedRange.from,
        rangeTo: cappedRange.to,
        labelCount: labelRangeCount(cappedRange),
        printedCountAfter: null,
        printerName: null,
        message: 'Exported PDF',
      });
    } finally {
      setExporting(null);
      setExportProgress(0);
    }
  };

  if (!run || !template || !format) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading run…
      </div>
    );
  }

  return (
    <>
    <div className="flex-1 overflow-auto">
      <div className="max-w-[980px] mx-auto w-full p-4 sm:p-8 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-zinc-100 truncate">{run.name}</h1>
            <p className="text-sm text-zinc-500 mt-1">
              {template.name} · {format.name} · {format.width}″ × {format.height}″ · {total} labels
            </p>
          </div>
          <div className="shrink-0 flex items-center gap-1 sm:gap-2">
            {/* Quick actions. On mobile we render icon-only buttons (still
                tappable, just tighter); labels appear from sm up. */}
            <Link
              href={`/runs/${run.id}/scan`}
              className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-md text-[11px] font-medium text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
              title="Open scan mode: one label per scan, hands-free"
            >
              <ScanBarcode className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Scan mode</span>
            </Link>
            <Link
              href={`/runs/new?duplicateFrom=${run.id}`}
              className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-md text-[11px] font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
              title="Start a new run with this run's data and mappings"
            >
              <Copy className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Re-run</span>
            </Link>
            <button
              onClick={openEdit}
              className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-md text-[11px] font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
              title="Edit run name, static field values, notes"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Edit run</span>
            </button>
            <Link
              href={`/designer?id=${template.id}&returnTo=${encodeURIComponent(`/runs/${run.id}`)}`}
              className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-md text-[11px] font-medium text-zinc-400 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
              title="Open this run's template in the designer"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Edit template</span>
            </Link>
            <div className="hidden sm:flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-full font-medium border border-zinc-800 bg-zinc-900/60">
              <span className={
                run.status === 'completed' ? 'text-emerald-400' :
                run.status === 'printing' ? 'text-amber-400' :
                run.status === 'paused' ? 'text-yellow-400' :
                run.status === 'cancelled' ? 'text-red-400' : 'text-zinc-400'
              }>{run.status}</span>
            </div>
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
              {(() => {
                const SourceIcon = runSourceMeta(run.dataSource).icon;
                return <SourceIcon className="w-3 h-3" />;
              })()}
              {runSourceMeta(run.dataSource).label}
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
                  <LayoutPreview
                    format={format}
                    elements={template.elements}
                    testData={previewValues}
                    testDataByLabel={sheetPreviewValues}
                    selectedLabelOffset={selectedSheetLabelOffset}
                  />
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
          <h2 className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">{isSheetFormat ? 'Sheet Output' : 'Printer'}</h2>
          {isSheetFormat ? (
            <div className="space-y-2">
              <p className="text-xs text-zinc-400 leading-relaxed">
                Sheets open as a print-ready page for regular printers or Save as PDF.
              </p>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">Important print setting</p>
                <p className="mt-1 text-xs text-amber-100">Set scale to 100% / Actual size. Do not use Fit to page or Shrink to printable area.</p>
              </div>
            </div>
          ) : (
            <>
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
            </>
          )}
          {transportError && !isSheetFormat && <p className="text-xs text-red-400">{transportError}</p>}
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
          {isSheetFormat && pendingSheetRange && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 space-y-2">
              <p className="text-xs text-amber-100">
                Opened labels {pendingSheetRange.from}-{pendingSheetRange.to}. Mark this range printed after the sheet job finishes.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void markSheetRangePrinted()}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold bg-amber-500 text-black hover:bg-amber-400 transition-colors"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  Mark printed
                </button>
                <button
                  onClick={() => setPendingSheetRange(null)}
                  className="px-3 py-1.5 rounded-md text-[11px] font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-950/60 border border-zinc-800"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
          {errorMsg && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" /> {errorMsg}
            </p>
          )}

          {/* Stop-at control: only show when idle/paused (not while running) */}
          {(status === 'idle' || status === 'paused' || status === 'error') && printedCount < total && (
            <div className="flex items-center gap-2 text-[11px] text-zinc-400">
              <span className="whitespace-nowrap">Stop after label</span>
              <input
                type="number"
                min={printedCount + 1}
                max={total}
                placeholder={`all (${total - printedCount})`}
                value={stopAt > 0 ? stopAt : ''}
                onChange={(e) => setStopAt(parseInt(e.target.value, 10) || 0)}
                className="w-28 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 tabular-nums focus:outline-none focus:border-amber-500/40 placeholder-zinc-600"
              />
              <span className="text-zinc-600">/ {total}</span>
              {stopAt > 0 && (
                <button onClick={() => setStopAt(0)} className="text-zinc-500 hover:text-zinc-300 text-[10px]">clear</button>
              )}
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-2 pt-2">
            {isSheetFormat && printedCount < total && (
              <button
                onClick={() => openSheetPrintRange()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:from-amber-400 hover:to-amber-500 transition-all disabled:opacity-40"
              >
                <FileText className="w-4 h-4" />
                Open Print / PDF
              </button>
            )}
            {!isSheetFormat && (status === 'idle' || status === 'paused' || status === 'error') && printedCount < total && (
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
            {!isSheetFormat && status !== 'completed' && status !== 'cancelled' && (
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

          {/* Export section */}
          <div className="pt-3 border-t border-zinc-800/60">
            {!showExport ? (
              <button
                onClick={() => { setExportFrom(1); setExportTo(total); setShowExport(true); }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium text-zinc-400 hover:text-amber-400 hover:bg-amber-500/10 transition-colors border border-zinc-800"
              >
                <Download className="w-3 h-3" /> Export labels…
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-zinc-400 whitespace-nowrap">Labels</span>
                  <input
                    type="number" min={1} max={total} value={exportFrom}
                    onChange={(e) => setExportFrom(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-20 bg-zinc-950 border border-zinc-800 rounded text-xs text-zinc-200 tabular-nums px-2 py-1 focus:outline-none focus:border-amber-500/40"
                  />
                  <span className="text-[11px] text-zinc-500">–</span>
                  <input
                    type="number" min={1} max={total} value={resolvedExportTo}
                    onChange={(e) => setExportTo(Math.min(total, parseInt(e.target.value, 10) || total))}
                    className="w-20 bg-zinc-950 border border-zinc-800 rounded text-xs text-zinc-200 tabular-nums px-2 py-1 focus:outline-none focus:border-amber-500/40"
                  />
                  <span className="text-[11px] text-zinc-500">/ {total}</span>
                </div>
                {(() => {
                  const count = resolvedExportTo - exportFrom + 1;
                  if (isSheetFormat) return <p className="text-[10px] text-zinc-500">Sheets open in a print-ready tab. Choose Save as PDF in the browser print dialog.</p>;
                  if (exporting === 'pdf') return null;
                  if (count > 500) return <p className="text-[10px] text-red-400/80">PDF is capped at 500 labels — set a narrower range. Use ZPL for large exports.</p>;
                  if (count > 100) return <p className="text-[10px] text-yellow-500/80">{count} labels — may take ~{Math.round(count * 0.1)}s. Page stays usable.</p>;
                  return null;
                })()}
                {exporting === 'pdf' && (
                  <div className="space-y-1">
                    <div className="h-1.5 rounded-full bg-zinc-900 overflow-hidden">
                      <div className="h-full bg-amber-500 transition-all" style={{ width: `${exportProgress}%` }} />
                    </div>
                    <p className="text-[10px] text-zinc-500 text-right">{exportProgress}%</p>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  {!isSheetFormat && (
                    <button
                      onClick={() => void handleExportZPL()}
                      disabled={!!exporting}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors disabled:opacity-40"
                    >
                      {exporting === 'zpl' ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileCode2 className="w-3 h-3" />}
                      ZPL
                    </button>
                  )}
                  {isSheetFormat ? (
                    <button
                      onClick={() => openSheetPrintRange({ from: exportFrom, to: resolvedExportTo })}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors"
                    >
                      <FileText className="w-3 h-3" />
                      Print / PDF
                    </button>
                  ) : (
                    <button
                      onClick={() => void handleExportPDF()}
                      disabled={!!exporting}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors disabled:opacity-40"
                    >
                      {exporting === 'pdf' ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                      PDF
                    </button>
                  )}
                  <button
                    onClick={() => { setShowExport(false); setExporting(null); }}
                    className="px-2 py-1.5 rounded-md text-[11px] text-zinc-500 hover:text-zinc-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {eventsForRun.length > 0 && (
            <div className="pt-3 border-t border-zinc-800/60 space-y-2">
              <h3 className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">Print history</h3>
              <div className="space-y-1">
                {eventsForRun.slice(0, 5).map((event) => (
                  <div key={event.id} className="flex items-center justify-between gap-3 rounded-md bg-zinc-950/40 px-2 py-1.5 text-[11px]">
                    <span className={
                      event.eventType === 'confirmed' ? 'text-emerald-400' :
                      event.eventType === 'failed' ? 'text-red-400' :
                      event.eventType === 'cancelled' ? 'text-yellow-400' :
                      'text-zinc-300'
                    }>
                      {printEventLabel(event)}
                    </span>
                    <span className="shrink-0 text-zinc-600">{formatEventTime(event.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

          </div>
        </div>
      </div>
    </div>

    {/* Edit run modal */}
    {showEdit && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-100">Edit Run</h2>
            <button onClick={() => setShowEdit(false)} className="text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
          </div>

          {/* Run name */}
          <div className="space-y-1">
            <label className="text-[11px] text-zinc-500 uppercase tracking-wide">Run name</label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-amber-500/50"
            />
          </div>

          {/* Static field values */}
          {Object.keys(editStatic).length > 0 && (
            <div className="space-y-2">
              <label className="text-[11px] text-zinc-500 uppercase tracking-wide">Static fields</label>
              <div className="space-y-2">
                {Object.entries(editStatic).map(([field, val]) => (
                  <div key={field} className="flex items-center gap-2">
                    <span className="text-[11px] text-zinc-400 w-28 shrink-0 truncate">{field}</span>
                    <input
                      value={val}
                      onChange={(e) => setEditStatic((prev) => ({ ...prev, [field]: e.target.value }))}
                      className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-[11px] text-zinc-500 uppercase tracking-wide">Notes</label>
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              rows={2}
              placeholder="Optional notes…"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 resize-none"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => void handleSaveEdit()}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:from-amber-400 hover:to-amber-500 disabled:opacity-40 transition-all"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button
              onClick={() => setShowEdit(false)}
              className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 bg-zinc-900 border border-zinc-800"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )}
    </>
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
  }, [zpl, format.width, format.height, format.dpi, format.horizontalGapThermal, format.labelsAcross, format.linerWidth, format.sideMarginThermal]);

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
