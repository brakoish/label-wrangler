'use client';

import { canLeaveLocalPrint, setLocalPrintRunning } from '@/lib/printNavigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Printer, Pause, Play, X, CheckCircle2, AlertCircle, Loader2, Plug, RotateCcw, FileSpreadsheet, Clipboard, Hash, SquareDashed, Pencil, PenTool, Copy, ScanBarcode, Download, FileText, FileCode2, Search, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { OfficePiPrinter } from './OfficePiPrinter';
import { BlankValueCheck } from './BlankValueCheck';
import { Dialog } from '@/components/ui/Dialog';
import { confirmDialog } from '@/components/ui/feedback';
import { blankCheckAllowsPrinting, checkRunData, hasBlankChoice, rememberBlankChoice } from '@/lib/runDataCheck';
import { friendlyError, friendlyRenderError, printEventLabel, runStatusLabel } from '@/lib/userMessages';
import { LabelOutlineOverlay } from '../LabelOutlineOverlay';
import { LayoutPreview } from '@/components/designer/LayoutPreview';
import type { LabelTemplate, LabelFormat, Run, RunStatus } from '@/lib/types';
import { useRunStore } from '@/lib/runStore';
import { startPrintQueue, type RunQueueHandle } from '@/lib/printQueue';
import { dynamicFieldsForTemplate, generateLabelsForRunWithImages, previewLabelValues } from '@/lib/runBuilder';
import { feedRangeForLabels, labelRangeCount, normalizeLabelRange } from '@/lib/runRanges';
import { updateRunWithQueue, flushOfflineQueue, pendingPatchCount } from '@/lib/offlineQueue';
import { generateZPLWithImages } from '@/lib/zplGenerator';
import { renderZplToDataUrl, thermalRenderDimensions, thermalRenderGeometry } from '@/lib/zplRenderClient';
import {
  isWebUsbSupported,
  getAuthorizedPrinters,
  openPrinter,
  requestPrinter,
  printZpl,
  queryHostStatus,
  type ConnectedPrinter,
} from '@/lib/webusbPrinter';
import {
  isDazzleRunning,
  listDazzlePrinters,
  printViaDazzle,
  type DazzlePrinter,
} from '@/lib/dazzlePrinter';

type Transport = 'dazzle' | 'webusb' | 'office';
type PrinterUiStatus = 'idle' | 'running' | 'paused' | 'completed' | 'cancelled' | 'error';
type EditSourceField = { field: string; source: string; column: string | null; legacyPaste: boolean };
type SheetPrintConfirmedMessage = {
  type: 'sheet-range-confirmed';
  runId: string;
  rangeFrom: number;
  rangeTo: number;
  printedCountAfter: number;
  status: 'paused' | 'completed';
};

function isSheetPrintConfirmedMessage(value: unknown): value is SheetPrintConfirmedMessage {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.type === 'sheet-range-confirmed' &&
    typeof record.runId === 'string' &&
    typeof record.rangeFrom === 'number' &&
    typeof record.rangeTo === 'number' &&
    typeof record.printedCountAfter === 'number' &&
    (record.status === 'paused' || record.status === 'completed');
}

function runSourceMeta(source: string) {
  if (source === 'csv') return { label: 'CSV import', fieldLabel: 'CSV', icon: FileSpreadsheet };
  if (source === 'manifest') return { label: 'Manifest rows', fieldLabel: 'Manifest', icon: Search };
  if (source === 'manual') return { label: 'Manual rows', fieldLabel: 'Manual', icon: Pencil };
  return { label: 'Pasted rows', fieldLabel: 'Paste', icon: Clipboard };
}

function uiStatusForRunStatus(status: RunStatus): PrinterUiStatus {
  if (status === 'completed' || status === 'cancelled' || status === 'paused') return status;
  // If the page reloads while the DB says "printing", there is no live queue
  // in this browser session anymore. Treat it as paused so the operator can
  // deliberately resume from the persisted printed count.
  if (status === 'printing') return 'paused';
  return 'idle';
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

const TRANSPORT_LABELS: Record<Transport, { label: string; unavailable: string }> = {
  dazzle: { label: 'This computer (Dazzle app)', unavailable: 'Install and open the free Dazzle app on this computer to use it.' },
  webusb: { label: 'USB printer (Chrome)', unavailable: 'USB printing needs Chrome or Edge on a computer with the printer plugged in.' },
  office: { label: 'Office printer (remote)', unavailable: '' },
};



/**
 * Screen shown after a run is created and ready to print.
 * Resolves the transport (Dazzle preferred if running), then streams ZPL in
 * batches with a live progress bar, pause/resume, and cancel.
 */
export function RunPrinter({ runId, onDone }: RunPrinterProps) {
  const { runs, fetchRun, updateRun, setRunStatus, printEvents, fetchPrintEvents, createPrintEvent, runLoadErrors } = useRunStore();
  const loadError = runLoadErrors[runId] ?? null;

  const run = runs.find((r) => r.id === runId) ?? null;
  const template: LabelTemplate | null = run?.designSnapshot?.template ?? null;
  const format: LabelFormat | null = run?.designSnapshot?.format ?? null;

  // Transport detection
  const [dazzleAvailable, setDazzleAvailable] = useState(false);
  const [transport, setTransport] = useState<Transport | null>(null);
  const [officeConnectionTarget, setOfficeConnectionTarget] = useState<HTMLDivElement | null>(null);
  const [usbPrinter, setUsbPrinter] = useState<ConnectedPrinter | null>(null);
  const [dazzlePrinters, setDazzlePrinters] = useState<DazzlePrinter[]>([]);
  const [dazzleSelected, setDazzleSelected] = useState<string | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [printerStatusMessage, setPrinterStatusMessage] = useState<string | null>(null);

  // Print state
  const queueRef = useRef<RunQueueHandle | null>(null);
  const mounted = useRef(true);
  const starting = useRef(false);
  const [sending, setSending] = useState(false);
  const preparation = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; preparation.current?.abort(); queueRef.current?.cancel(); }; }, []);
  const [status, setStatus] = useState<PrinterUiStatus>('idle');
  const statusRef = useRef<PrinterUiStatus>('idle');
  const webUsbStatusUnavailableRef = useRef(false);
  const webUsbStatusWorkingRef = useRef(false);
  const [printedCount, setPrintedCount] = useState(run?.printedCount ?? 0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const total = run?.totalLabels ?? 0;
  const pct = total > 0 ? Math.round((printedCount / total) * 100) : 0;
  const isSheetFormat = format?.type === 'sheet';
  const progressLabel = 'Printed';

  // Label preview state — which row to show in the small thumbnail.
  const [previewIndex, setPreviewIndex] = useState(0);
  // Show dashed outlines around each label in the preview. Default on for
  // multi-across formats where lane boundaries actually matter visually.
  const [showOutlines, setShowOutlines] = useState<boolean>(((format?.labelsAcross ?? 1) > 1));
  // Reprint-range UI state. A reprint prints exactly From..To and never
  // touches the run's progress or status.
  const [showReprint, setShowReprint] = useState(false);
  const [reprintFromDraft, setReprintFromDraft] = useState('1');
  const [reprintToDraft, setReprintToDraft] = useState('1');
  const [reprinting, setReprinting] = useState<{ from: number; to: number; done: number } | null>(null);
  const reprintQueue = useRef<RunQueueHandle | null>(null);
  const [stopAt, setStopAt] = useState(0); // 0 = print all; >0 = stop after this physical label
  const [fromDraft, setFromDraft] = useState<string | null>(null);
  const [throughDraft, setThroughDraft] = useState<string | null>(null);
  const [countDraft, setCountDraft] = useState<string | null>(null);
  const fromValue = fromDraft ?? String(printedCount + 1);
  const throughValue = throughDraft ?? String(stopAt || total);
  const selectedFrom = Number(fromValue);
  const selectedThrough = Number(throughValue);
  const rangeValid = fromValue.trim() !== '' && throughValue.trim() !== '' &&
    Number.isInteger(selectedFrom) && Number.isInteger(selectedThrough) &&
    selectedFrom >= 1 && selectedThrough >= selectedFrom && selectedThrough <= total &&
    (countDraft === null || (countDraft.trim() !== '' && Number.isInteger(Number(countDraft)) && Number(countDraft) > 0));
  const clearRangeDrafts = () => { setFromDraft(null); setThroughDraft(null); setCountDraft(null); };
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
  const [editSourceValues, setEditSourceValues] = useState<Record<string, string>>({});
  const [editRowIndex, setEditRowIndex] = useState(0);
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const webUsbSupported = typeof window !== 'undefined' && isWebUsbSupported();

  useEffect(() => {
    if (!run || !run.designSnapshot || (run.totalLabels > 0 && run.sourceData.length === 0)) {
      void fetchRun(runId);
    }
  }, [fetchRun, run, runId]);



  useEffect(() => {
    statusRef.current = status;
    setLocalPrintRunning(status === 'running' && transport !== 'office' && !isSheetFormat);
    const guard = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('a[href]') || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (!canLeaveLocalPrint()) { event.preventDefault(); event.stopPropagation(); }
    };
    document.addEventListener('click', guard, true);
    return () => { setLocalPrintRunning(false); document.removeEventListener('click', guard, true); };
  }, [status, transport, isSheetFormat]);

  useEffect(() => {
    if (!run || statusRef.current === 'running') return;
    setPrintedCount(run.printedCount ?? 0);
    setStatus(run.status === 'completed' && (run.printedCount ?? 0) < run.totalLabels ? 'paused' : uiStatusForRunStatus(run.status));
  }, [run?.id, run?.printedCount, run?.status, run]);

  const eventsForRun = useMemo(
    () => printEvents.filter((event) => event.runId === runId),
    [printEvents, runId],
  );

  useEffect(() => {
    void fetchPrintEvents(runId);
  }, [fetchPrintEvents, runId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const applySheetConfirmation = (message: SheetPrintConfirmedMessage) => {
      if (message.runId !== runId) return;
      setPrintedCount(message.printedCountAfter);
      setStatus(message.status);
      setPendingSheetRange((current) => {
        if (!current) return current;
        if (current.from === message.rangeFrom && current.to === message.rangeTo) return null;
        return current;
      });
      void fetchRun(runId);
      void fetchPrintEvents(runId);
    };

    let channel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel('label-wrangler-print');
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (isSheetPrintConfirmedMessage(event.data)) applySheetConfirmation(event.data);
      };
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'lw:sheet-print-confirmed' || !event.newValue) return;
      try {
        const parsed: unknown = JSON.parse(event.newValue);
        if (isSheetPrintConfirmedMessage(parsed)) applySheetConfirmation(parsed);
      } catch {
        // Ignore malformed localStorage values from older tabs.
      }
    };

    window.addEventListener('storage', onStorage);
    return () => {
      channel?.close();
      window.removeEventListener('storage', onStorage);
    };
  }, [fetchPrintEvents, fetchRun, runId]);

  // Detect transport once on mount.
  useEffect(() => {
    (async () => {
      const dz = await isDazzleRunning();
      setDazzleAvailable(dz);
      // Prefer Dazzle; fall back to WebUSB.
      if (dz) {
        setTransport(current => current || 'dazzle');
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
        setTransport(current => current || 'webusb');
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
        setTransport(current => current || 'office');
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
  // Whole-run blank check: a blank value would print the designer sample.
  const blankCheck = useMemo(() => (run && template ? checkRunData(template, run) : null), [run, template]);
  const [leaveBlankChoice, setLeaveBlankChoice] = useState<string | null>(null);
  const leaveBlank = !!blankCheck && (leaveBlankChoice === blankCheck.signature || hasBlankChoice(typeof window !== 'undefined' ? window.localStorage : null, runId, blankCheck));
  const setLeaveBlank = (value: boolean) => {
    if (!blankCheck) return;
    setLeaveBlankChoice(value ? blankCheck.signature : '');
    rememberBlankChoice(typeof window !== 'undefined' ? window.localStorage : null, runId, value ? blankCheck.signature : '');
  };
  const blanksOk = !blankCheck || blankCheckAllowsPrinting(blankCheck, leaveBlank);
  const canStart = blanksOk && !reprinting && !sending && !!run && run.sourceData.length > 0 && (
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

  const templateFields = useMemo(() => (template ? dynamicFieldsForTemplate(template) : []), [template]);
  const sourceEditFields = useMemo<EditSourceField[]>(() => {
    if (!run) return [];
    const sourceMeta = runSourceMeta(run.dataSource);
    return templateFields.flatMap<EditSourceField>((field) => {
      const mapping = run.fieldMappings?.[field];
      if (mapping?.mode === 'column' && mapping.csvColumn) {
        return [{
          field,
          source: mapping.csvColumn === '__paste__' ? 'Pasted value' : `${sourceMeta.fieldLabel} -> ${mapping.csvColumn}`,
          column: mapping.csvColumn,
          legacyPaste: false,
        }];
      }
      if (run.mappedField === field && run.sourceData.some((row) => typeof row === 'string')) {
        return [{
          field,
          source: 'Pasted value',
          column: null,
          legacyPaste: true,
        }];
      }
      return [];
    });
  }, [run, templateFields]);

  const staticEditFields = useMemo(() => {
    if (!run) return [] as string[];
    const sourceFields = new Set(sourceEditFields.map((item) => item.field));
    return templateFields.filter((field) => !sourceFields.has(field));
  }, [run, sourceEditFields, templateFields]);

  // Preview ZPL for whichever label index the user is inspecting.
  // For multi-across rolls we group rows by feed so the preview matches
  // what actually prints: lane 0 = row N, lane 1 = row N+1, etc.
  const [previewZpl, setPreviewZpl] = useState('');
  useEffect(() => {
    let cancelled = false;
    setPreviewZpl('');
    if (!run || !template || !format || format.type !== 'thermal') return;
    const maxIdx = Math.max(0, run.sourceData.length - 1);
    const idx = Math.min(Math.max(0, previewIndex), maxIdx);
    (async () => {
      try {
        if (across === 1) {
          const nextZpl = await generateZPLWithImages(template, format, previewLabelValues(run, idx));
          if (!cancelled) setPreviewZpl(nextZpl);
          return;
        }
        // Multi-across: snap idx to the start of its feed group, then build
        // per-lane values for that group.
        const feedStart = Math.floor(idx / across) * across;
        const laneValues: Array<Record<string, string> | undefined> = [];
        for (let lane = 0; lane < across; lane++) {
          const rowIdx = feedStart + lane;
          laneValues.push(rowIdx <= maxIdx ? previewLabelValues(run, rowIdx) : undefined);
        }
        const nextZpl = await generateZPLWithImages(template, format, laneValues);
        if (!cancelled) setPreviewZpl(nextZpl);
      } catch {
        if (!cancelled) setPreviewZpl('');
      }
    })();
    return () => { cancelled = true; };
  }, [run, template, format, previewIndex, across]);

  // Friendly description of where each dynamic field's value is coming from.
  const mappingRows = useMemo(() => {
    if (!run || !template) return [] as Array<{ field: string; source: string; sample: string }>;
    const out: Array<{ field: string; source: string; sample: string }> = [];
    // Follow the label shown in the preview, not always row 1.
    const row0 = run.sourceData[Math.min(Math.max(0, previewIndex), Math.max(0, run.sourceData.length - 1))];
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
          source: col === '__paste__' ? 'pasted values' : `${sourceMeta.fieldLabel} column “${col}”`,
          sample,
        });
      } else if (run.mappedField === f && typeof row0 === 'string') {
        out.push({ field: f, source: 'pasted values', sample: row0 });
      } else {
        out.push({ field: f, source: 'same on every label', sample: run.staticValues?.[f] ?? '' });
      }
    }
    return out;
  }, [run, template, previewIndex]);

  const persistProgress = async (next: number) => {
    if (!run) return;
    // Use the offline-friendly wrapper so a transient network flap during a
    // long print doesn't cost us the latest printedCount. Failed calls
    // queue in localStorage and flush on reconnect.
    try { await updateRunWithQueue(run.id, { printedCount: next }); }
    catch (error) { queueRef.current?.pause(); setStatus('paused'); setErrorMsg((error as Error).message); }
  };

  // Flush any offline progress updates on mount + whenever the browser
  // tells us we're back online. Cheap: no-op when the queue is empty.
  useEffect(() => {
    void flushOfflineQueue();
    const onOnline = () => { void flushOfflineQueue(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  // One way to talk to the local printer, shared by normal printing and reprints.
  const makeSender = (controller: AbortController) => {
    return {
      send: async (zpl: string) => {
        if (!mounted.current || controller.signal.aborted) throw new Error('Printing stopped because the page was left. Already sent labels may still print.');
        setSending(true);
        try {
        if (transport === 'dazzle') {
          await printViaDazzle(zpl, dazzleSelected ?? undefined);
        } else if (transport === 'webusb' && usbPrinter) {
          if (usbPrinter.endpointIn && !webUsbStatusUnavailableRef.current) {
            try {
              const printerStatus = await queryHostStatus(usbPrinter);
              webUsbStatusWorkingRef.current = true;
              setPrinterStatusMessage(
                printerStatus.labelsRemaining === null
                  ? printerStatus.summary
                  : `${printerStatus.summary} · ${printerStatus.labelsRemaining} label${printerStatus.labelsRemaining === 1 ? '' : 's'} remaining in printer batch`,
              );
              if (!printerStatus.ready) {
                throw new Error(printerStatus.summary);
              }
            } catch (err) {
              const message = (err as Error)?.message || '';
              if (/endpoint/i.test(message) || (!webUsbStatusWorkingRef.current && /timed out|Status read failed/i.test(message))) {
                webUsbStatusUnavailableRef.current = true;
              } else {
                throw err;
              }
            }
          }
          await printZpl(usbPrinter, zpl);
        } else {
          throw new Error('No printer connected');
        }
        } finally { if (mounted.current) setSending(false); }
      },
    };
  };

  const startOrResume = async () => {
    if (!run || !template || !format || starting.current || sending || statusRef.current === 'running') return;
    starting.current = true;
    try {
    if (!rangeValid) { setErrorMsg(`Enter a whole-number range between 1 and ${total}.`); return; }
    if (!blanksOk) { setErrorMsg('Some labels are missing a value. Fix the data (see the list above) before printing.'); return; }
    setErrorMsg(null);
    if (pendingPatchCount(run.id)) { await flushOfflineQueue(); if (pendingPatchCount(run.id)) { setErrorMsg('Sync pending print progress for this run before starting another batch. Use Retry sync above.'); return; } }
    setStatus('running');
    const controller = new AbortController();
    preparation.current = controller;
    try { await setRunStatus(run.id, 'printing', printedCount); }
    catch(error) { setStatus('paused'); setErrorMsg((error as Error).message); return; }
    if (pendingPatchCount(run.id)) { setStatus('paused'); setErrorMsg('Run start is saved locally but not synced. Retry sync before printing.'); return; }
    if (!mounted.current || controller.signal.aborted) return;

    const sender = makeSender(controller);

    const printRange = normalizeLabelRange({
      total,
      from: selectedFrom,
      to: selectedThrough,
    });
    // The queue tracks feeds internally (startIndex/done are feed counts).
    // We convert between physical-label count (what the user + DB see) and
    // feed count (what the queue consumes) at the boundary so multi-across
    // progress bars behave intuitively.
    const { startFeed, stopFeed } = feedRangeForLabels(printRange, across);
    void stopFeed;
    let labelsToSend: string[];
    try { labelsToSend = await generateLabelsForRunWithImages(run, template, format, printRange, { signal: controller.signal }); }
    catch (error) { if (controller.signal.aborted) return; setStatus('error'); setErrorMsg(error instanceof Error ? error.message : 'Render failed'); await setRunStatus(run.id, 'paused', printedCount); return; }
    if (!mounted.current || controller.signal.aborted) return;
    const handle = startPrintQueue(sender, {
      labels: labelsToSend,
      batchSize: 25,
      delayBetweenBatchesMs: 0,
      startIndex: 0,
      onProgress: async (feedsDone) => {
        // Each feed produced up to `across` physical labels. Clamp to total
        // so the last (possibly-partial) feed doesn't overshoot.
        const physical = Math.min((startFeed + feedsDone) * across, printRange.to);
        setFromDraft(null);
        setCountDraft(null);
        setPrintedCount(physical);
        // Fire-and-forget DB update — don't block printing on persistence.
        void persistProgress(physical);
        if (feedsDone >= labelsToSend.length) {
          const nextStatus = physical >= total ? 'completed' : 'paused';
          setStatus(nextStatus);
          clearRangeDrafts();
          setStopAt(0);
          await setRunStatus(run.id, nextStatus, physical);
          await createPrintEvent(run.id, {
            eventType: 'sent',
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
        const atPhysical = Math.max(printRange.from - 1, Math.min((startFeed + atFeed) * across, printRange.to));
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
    } finally { starting.current = false; }
  };

  const handlePause = async () => {
    preparation.current?.abort();
    queueRef.current?.cancel();
    setStatus('paused');
    if (run) try { await setRunStatus(run.id, 'paused', printedCount); } catch(error) { setErrorMsg((error as Error).message); }
  };

  const requestCancel = async () => {
    const ok = await confirmDialog({
      title: 'Cancel this run?',
      body: 'Labels already printed stay printed. You can start a new run from the same data with Re-run.',
      confirmLabel: 'Cancel run',
      cancelLabel: 'Keep run',
      danger: true,
    });
    if (ok) await handleCancel();
  };

  const handleCancel = async () => {
    preparation.current?.abort();
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

  const reprintFrom = Number(reprintFromDraft);
  const reprintTo = Number(reprintToDraft);
  const reprintValid = Number.isInteger(reprintFrom) && Number.isInteger(reprintTo) && reprintFrom >= 1 && reprintTo >= reprintFrom && reprintTo <= total;
  const reprintCount = reprintValid ? reprintTo - reprintFrom + 1 : 0;
  const openReprint = (from: number, to: number) => {
    setReprintFromDraft(String(from));
    setReprintToDraft(String(to));
    setShowReprint(true);
  };

  // Reprint exactly From..To (e.g. a jammed strip). This is a separate job:
  // it never rewinds or changes the run's progress or status, and it is
  // logged in the print history as a reprint.
  const handleReprintRange = async () => {
    if (!run || !template || !format || !reprintValid || reprinting || statusRef.current === 'running' || starting.current) return;
    if (!blanksOk) { setErrorMsg('Some labels are missing a value. Fix the data (see the list above) before printing.'); return; }
    const range = { from: reprintFrom, to: reprintTo };
    setErrorMsg(null);
    if (isSheetFormat) {
      const opened = window.open(sheetPrintHref(range), '_blank', 'noopener,noreferrer');
      if (!opened) { setErrorMsg('Popup blocked. Allow popups, then try again.'); return; }
      setShowReprint(false);
      void createPrintEvent(run.id, { eventType: 'opened', output: 'sheet-pdf', rangeFrom: range.from, rangeTo: range.to, labelCount: labelRangeCount(range), printedCountAfter: null, printerName: null, message: 'Reprint (run progress unchanged)' });
      return;
    }
    if (!(transport === 'dazzle' && dazzleSelected) && !(transport === 'webusb' && usbPrinter)) { setErrorMsg('Connect a printer first, then press Reprint again.'); return; }
    const controller = new AbortController();
    preparation.current = controller;
    setReprinting({ ...range, done: 0 });
    setLocalPrintRunning(true);
    const printerName = transport === 'dazzle' ? dazzleSelected : usbPrinter?.productName ?? null;
    const finish = () => { reprintQueue.current = null; if (mounted.current) { setReprinting(null); setLocalPrintRunning(false); } };
    let labelsToSend: string[];
    try { labelsToSend = await generateLabelsForRunWithImages(run, template, format, range, { signal: controller.signal }); }
    catch (error) { finish(); if (!controller.signal.aborted) setErrorMsg(friendlyRenderError(friendlyError(error, 'Could not prepare the labels.'), template.elements, across)); return; }
    if (!mounted.current || controller.signal.aborted) { finish(); return; }
    reprintQueue.current = startPrintQueue(makeSender(controller), {
      labels: labelsToSend,
      batchSize: 25,
      delayBetweenBatchesMs: 0,
      startIndex: 0,
      onProgress: async (feedsDone) => {
        const physical = Math.min(range.from - 1 + feedsDone * across, range.to) - (range.from - 1);
        if (mounted.current) setReprinting((current) => current && { ...current, done: physical });
        if (feedsDone >= labelsToSend.length) {
          finish();
          setShowReprint(false);
          await createPrintEvent(run.id, { eventType: 'sent', output: 'roll-zpl', rangeFrom: range.from, rangeTo: range.to, labelCount: labelRangeCount(range), printedCountAfter: null, printerName, message: 'Reprint (run progress unchanged)' });
        }
      },
      onError: async (err) => {
        finish();
        setErrorMsg(friendlyError(err, 'Reprint failed'));
        await createPrintEvent(run.id, { eventType: 'failed', output: 'roll-zpl', rangeFrom: range.from, rangeTo: range.to, labelCount: labelRangeCount(range), printedCountAfter: null, printerName, message: `Reprint failed: ${(err as Error)?.message || 'Print failed'}` });
      },
    });
  };
  const stopReprint = () => { preparation.current?.abort(); reprintQueue.current?.cancel(); reprintQueue.current = null; setReprinting(null); setLocalPrintRunning(false); };

  // Deliberate rewind: move the run's resume point back to label N and keep
  // going to the end from there. Only this action rewinds progress.
  const handleReprintFromHereAndContinue = async () => {
    if (!run || !reprintValid) return;
    const n = reprintFrom;
    const ok = await confirmDialog({
      title: `Go back to label ${n} and continue?`,
      body: `The run's progress goes back to ${n - 1} of ${total}, and the next Start prints labels ${n} to ${total} (${total - n + 1} labels). To print only a few labels again, use "Reprint ${reprintCount} labels" instead.`,
      confirmLabel: `Go back to label ${n}`,
    });
    if (!ok) return;
    clearRangeDrafts();
    setStopAt(0);
    setPrintedCount(n - 1);
    setStatus('paused');
    setShowReprint(false);
    await setRunStatus(run.id, 'paused', n - 1, { resetProgress: true });
  };

  const normalizeSheetRange = (range?: { from?: number; to?: number }) => normalizeLabelRange({
    total,
    from: range?.from,
    to: range?.to,
    fallbackFrom: selectedFrom,
    fallbackTo: selectedThrough,
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
    if (!range && !rangeValid) { setErrorMsg(`Enter a whole-number range between 1 and ${total}.`); return; }
    const resolved = normalizeSheetRange(range);
    const opened = window.open(sheetPrintHref(resolved), '_blank', 'noopener,noreferrer');
    if (!opened) {
      setErrorMsg('Popup blocked. Allow popups, then try again.');
      return;
    }
    setErrorMsg(null);
    setPendingSheetRange(resolved);
    setStatus('running');
    if (run) {
      void setRunStatus(run.id, 'printing', printedCount);
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

  const dismissPendingSheetRange = async () => {
    if (!run || !pendingSheetRange) {
      setPendingSheetRange(null);
      return;
    }
    const range = pendingSheetRange;
    setPendingSheetRange(null);
    setStatus('paused');
    await setRunStatus(run.id, 'paused', printedCount);
    await createPrintEvent(run.id, {
      eventType: 'cancelled',
      output: 'sheet-pdf',
      rangeFrom: range.from,
      rangeTo: range.to,
      labelCount: labelRangeCount(range),
      printedCountAfter: printedCount,
      printerName: null,
      message: 'Sheet print/PDF confirmation dismissed',
    });
  };

  const markSheetRangePrinted = async () => {
    if (!run || !pendingSheetRange) return;
    const nextPrinted = Math.max(printedCount, pendingSheetRange.to);
    const nextStatus = nextPrinted >= total ? 'completed' : 'paused';
    clearRangeDrafts();
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
    const rowIndex = Math.min(Math.max(0, previewIndex), Math.max(0, run.sourceData.length - 1));
    const row = run.sourceData[rowIndex];
    const nextSourceValues: Record<string, string> = {};
    for (const item of sourceEditFields) {
      if (item.legacyPaste || item.column === '__paste__') {
        nextSourceValues[item.field] = typeof row === 'string' ? row : '';
      } else if (item.column && row && typeof row === 'object' && !Array.isArray(row)) {
        nextSourceValues[item.field] = (row as Record<string, string>)[item.column] ?? '';
      } else {
        nextSourceValues[item.field] = '';
      }
    }
    const nextStaticValues = { ...run.staticValues };
    for (const field of staticEditFields) {
      nextStaticValues[field] = nextStaticValues[field] ?? '';
    }
    setEditName(run.name);
    setEditStatic(nextStaticValues);
    setEditSourceValues(nextSourceValues);
    setEditRowIndex(rowIndex);
    setEditNotes(run.notes ?? '');
    setShowEdit(true);
  };

  const handleSaveEdit = async () => {
    if (!run) return;
    setSaving(true);
    try {
      let nextSourceData: Run['sourceData'] = run.sourceData;
      if (sourceEditFields.length > 0 && run.sourceData.length > 0) {
        const mutableSourceData = [...run.sourceData] as Array<string | Record<string, string>>;
        nextSourceData = mutableSourceData as Run['sourceData'];
        const currentRow = nextSourceData[editRowIndex];
        if (typeof currentRow === 'string') {
          const firstSourceField = sourceEditFields.find((item) => item.legacyPaste || item.column === '__paste__');
          if (firstSourceField) {
            const previousValue = currentRow;
            const nextValue = editSourceValues[firstSourceField.field] ?? '';
            const everyRowMatches = run.sourceData.every((row) => typeof row === 'string' && row === previousValue);
            if (everyRowMatches) {
              for (let i = 0; i < mutableSourceData.length; i++) mutableSourceData[i] = nextValue;
            } else {
              mutableSourceData[editRowIndex] = nextValue;
            }
          }
        } else if (currentRow && typeof currentRow === 'object' && !Array.isArray(currentRow)) {
          for (const item of sourceEditFields) {
            if (item.column && item.column !== '__paste__') {
              const previousValue = (currentRow as Record<string, string>)[item.column] ?? '';
              const nextValue = editSourceValues[item.field] ?? '';
              const everyRowMatches = run.sourceData.every(
                (row) => row && typeof row === 'object' && !Array.isArray(row) && (row as Record<string, string>)[item.column!] === previousValue,
              );
              if (everyRowMatches) {
                for (let i = 0; i < mutableSourceData.length; i++) {
                  const row = mutableSourceData[i];
                  if (row && typeof row === 'object' && !Array.isArray(row)) {
                    mutableSourceData[i] = { ...row, [item.column]: nextValue };
                  }
                }
              } else {
                mutableSourceData[editRowIndex] = {
                  ...(mutableSourceData[editRowIndex] as Record<string, string>),
                  [item.column]: nextValue,
                };
              }
            }
          }
        }
      }
      await updateRun(run.id, {
        name: editName.trim() || run.name,
        staticValues: editStatic,
        sourceData: nextSourceData,
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
      const range = normalizeLabelRange({ total, from: exportFrom, to: resolvedExportTo });
      const allFeeds = await generateLabelsForRunWithImages(run, template, format, range);
      const slice = allFeeds;
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
    } catch (error) { setErrorMsg(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  const handleExportPDF = async () => {
    if (!run || !template || !format) return;
    setExporting('pdf');
    setExportProgress(0);
    try {
      const range = normalizeLabelRange({ total, from: exportFrom, to: resolvedExportTo });
      const allFeeds = await generateLabelsForRunWithImages(run, template, format, range);
      const { startFeed, stopFeed } = feedRangeForLabels(range, across);
      const maxFeedsPerFile = Math.max(1, Math.floor(500 / across));
      const totalFeeds = stopFeed - startFeed;
      const chunkCount = Math.ceil(totalFeeds / maxFeedsPerFile);
      let renderedFeeds = 0;

      const { widthMm, heightMm } = thermalRenderDimensions(format);
      const bitmapGeometry = thermalRenderGeometry(format);

      const { PDFDocument } = await import('pdf-lib');
      // Page size in PDF points (72 pt = 1 inch)
      const pageW = template.thermalRenderMode === 'bitmap-v1' ? bitmapGeometry.linerDots * 72 / (format.dpi || 203) : widthMm * (72 / 25.4);
      const pageH = template.thermalRenderMode === 'bitmap-v1' ? bitmapGeometry.heightDots * 72 / (format.dpi || 203) : heightMm * (72 / 25.4);

      for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
        const chunkStartFeed = startFeed + chunkIndex * maxFeedsPerFile;
        const chunkStopFeed = Math.min(stopFeed, chunkStartFeed + maxFeedsPerFile);
        const slice = allFeeds.slice(chunkStartFeed - startFeed, chunkStopFeed - startFeed);
        const chunkRange = {
          from: Math.max(range.from, chunkStartFeed * across + 1),
          to: Math.min(range.to, chunkStopFeed * across),
        };
        const pdfDoc = await PDFDocument.create();

        for (const feed of slice) {
          // Yield to the browser event loop every feed so the page stays
          // responsive during long renders. WASM + pdf-lib are synchronous
          // under the hood and will lock the tab without this.
          await new Promise<void>((r) => setTimeout(r, 0));
          const b64 = (await renderZplToDataUrl(feed, format)).split(',')[1];
          const binStr = atob(b64);
          const bytes = new Uint8Array(binStr.length);
          for (let j = 0; j < binStr.length; j++) bytes[j] = binStr.charCodeAt(j);
          const img = await pdfDoc.embedPng(bytes);
          const page = pdfDoc.addPage([pageW, pageH]);
          page.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
          renderedFeeds++;
          setExportProgress(Math.round((renderedFeeds / totalFeeds) * 100));
        }

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(run.name || 'run').replace(/[^a-z0-9_-]/gi, '_')}_${chunkRange.from}-${chunkRange.to}.pdf`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        await createPrintEvent(run.id, {
          eventType: 'sent',
          output: 'roll-pdf',
          rangeFrom: chunkRange.from,
          rangeTo: chunkRange.to,
          labelCount: labelRangeCount(chunkRange),
          printedCountAfter: null,
          printerName: null,
          message: chunkCount > 1 ? `Exported PDF ${chunkIndex + 1} of ${chunkCount}` : 'Exported PDF',
        });
      }
    } catch (error) { setErrorMsg(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setExporting(null);
      setExportProgress(0);
    }
  };

  if (!run || !template || !format) {
    if (loadError) {
      const missing = loadError.status === 404;
      return (
        <div className="flex-1 flex items-center justify-center p-6">
          <div role="alert" className="max-w-sm space-y-3 text-center">
            <h1 className="text-lg font-semibold text-zinc-100">{missing ? "We couldn't find that run" : "We couldn't load this run"}</h1>
            <p className="text-sm text-zinc-400">{missing ? 'It may have been deleted, or the link is wrong.' : friendlyError(new Error(loadError.message))}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {!missing && <button type="button" onClick={() => void fetchRun(runId)} className="btn btn-primary">Try again</button>}
              <Link href="/runs" className="btn btn-secondary"><ArrowLeft className="h-4 w-4" /> Back to runs</Link>
            </div>
          </div>
        </div>
      );
    }
    if (run && run.designSnapshot === null) {
      return (
        <div className="flex-1 flex items-center justify-center p-6">
          <div role="alert" className="max-w-sm space-y-3 text-center">
            <h1 className="text-lg font-semibold text-zinc-100">This run has no saved design</h1>
            <p className="text-sm text-zinc-400">It can&apos;t be printed. Use Re-run to start a new run from the same data.</p>
            <Link href="/runs" className="btn btn-secondary"><ArrowLeft className="h-4 w-4" /> Back to runs</Link>
          </div>
        </div>
      );
    }
    return (
      <div role="status" className="flex-1 flex items-center justify-center text-sm text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" /> Loading run…
      </div>
    );
  }

  return (
    <>
    <div className="flex-1 overflow-auto">
      <div className="max-w-[1040px] mx-auto w-full p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
        <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold text-zinc-50 truncate">{run.name}</h1>
            <p className="text-sm text-zinc-400 mt-1">
              <span className="mr-2 inline-flex items-center gap-1.5 font-medium text-zinc-200">
                <span aria-hidden="true" className={`size-2 rounded-full ${
                  run.status === 'completed' ? 'bg-emerald-400' :
                  run.status === 'printing' ? 'bg-amber-400' :
                  run.status === 'paused' ? 'ring-2 ring-inset ring-amber-300' :
                  run.status === 'cancelled' ? 'bg-red-400' : 'bg-zinc-500'
                }`} />{runStatusLabel(run.status)}</span>
              <span className="whitespace-nowrap">{template.name}</span> · <span className="whitespace-nowrap">{format.name}{/["″]/.test(format.name) ? '' : ` · ${format.width}″ × ${format.height}″`}</span> · <span className="whitespace-nowrap">{total.toLocaleString()} label{total === 1 ? '' : 's'}</span>
            </p>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center [&>*]:max-sm:whitespace-normal [&>*]:max-sm:leading-tight [&>*]:max-sm:text-center">
            {/* Quick actions keep their words on phones, with 44px targets. */}
            <Link
              href={`/runs/${run.id}/scan`}
              className="btn btn-secondary btn-sm"
              title="One label per scan, hands-free"
            >
              <ScanBarcode className="w-4 h-4 text-amber-400" aria-hidden="true" />
              Scan mode
            </Link>
            <Link
              href={`/runs/new?duplicateFrom=${run.id}`}
              className="btn btn-secondary btn-sm"
              title="Start a new run with this run's data and settings"
            >
              <Copy className="w-4 h-4" />
              Re-run
            </Link>
            <button
              type="button"
              onClick={openEdit}
              className="btn btn-secondary btn-sm"
              title="Change the run name, values and notes"
            >
              <Pencil className="w-4 h-4" />
              Edit run
            </button>
            <Link
              href={`/designer?id=${template.id}&returnTo=${encodeURIComponent(`/runs/${run.id}`)}`}
              className="btn btn-secondary btn-sm"
              title="Changes the design for new runs; this run keeps its saved design"
            >
              <PenTool className="w-4 h-4" />
              Edit design for next time
            </Link>
          </div>
        </header>

        {/* Two-column: left = summary + preview; right = printer + controls. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-5 lg:gap-6">
          <div className="order-2 space-y-6 lg:order-1">

        {/* Run summary: how fields are mapped + a live label preview. */}
        <section className="card p-4 sm:p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Label {Math.min(previewIndex + 1, Math.max(1, total))} data</h2>
            <span className="text-xs text-zinc-400 flex items-center gap-1.5">
              {(() => {
                const SourceIcon = runSourceMeta(run.dataSource).icon;
                return <SourceIcon className="w-3.5 h-3.5" aria-hidden="true" />;
              })()}
              {runSourceMeta(run.dataSource).label}
            </span>
          </div>
          {mappingRows.length === 0 ? (
            <p className="text-sm text-zinc-400">Nothing changes from label to label — every label prints the same.</p>
          ) : (
            <dl className="grid grid-cols-[minmax(6rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
              {mappingRows.map((m) => (
                <div key={m.field} className="contents">
                  <dt className="font-medium text-zinc-300 truncate">{m.field}</dt>
                  <dd className="min-w-0">
                    <span className="block truncate text-zinc-100 tabular-nums" title={m.sample}>
                      {m.sample || <span className="text-amber-300">(empty)</span>}
                    </span>
                    <span className="block truncate text-xs text-zinc-500">{m.source}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {/* Per-label preview with row stepper. Lets the user spot-check that,
              say, label 1 and label 543 really do have different QR codes. */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="section-title">Preview</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowOutlines((s) => !s)}
                  aria-pressed={showOutlines}
                  aria-label="Show label outlines"
                  title={showOutlines ? 'Hide label outlines' : 'Show label outlines'}
                  className={`btn btn-ghost btn-icon btn-sm ${showOutlines ? 'text-amber-400 bg-amber-500/10' : 'text-zinc-400'}`}
                >
                  <SquareDashed className="w-4 h-4" />
                </button>
              {total > 0 && (
                <div className="flex items-center gap-1 text-sm">
                  <button
                    onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                    disabled={previewIndex === 0}
                    aria-label="Previous label"
                    className="btn btn-ghost btn-icon btn-sm text-zinc-300"
                  ><ChevronLeft className="w-4 h-4" aria-hidden="true" /></button>
                  <input
                    type="number"
                    aria-label="Label number to preview"
                    min={1}
                    max={total}
                    value={previewIndex + 1}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (Number.isFinite(n)) setPreviewIndex(Math.max(0, Math.min(total - 1, n - 1)));
                    }}
                    className="field field-sm w-16 text-center tabular-nums"
                  />
                  <span className="text-zinc-400 tabular-nums">of {total}</span>
                  <button
                    onClick={() => setPreviewIndex((i) => Math.min(total - 1, i + 1))}
                    disabled={previewIndex >= total - 1}
                    aria-label="Next label"
                    className="btn btn-ghost btn-icon btn-sm text-zinc-300"
                  ><ChevronRight className="w-4 h-4" aria-hidden="true" /></button>
                </div>
              )}
              </div>
            </div>
            <div className="rounded-lg bg-zinc-950 p-3 sm:p-4 min-h-[120px] flex items-center justify-center">
              {format.type === 'sheet' ? (
                // Sheet formats can't be rendered by the ZPL WASM engine —
                // show the SVG sheet-grid layout instead so the user actually
                // sees 10x20 / 8x11 / whatever grid they designed.
                <div className="w-full">
                  <LayoutPreview
                    thermalRenderMode={template.thermalRenderMode}
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

          <div className="order-1 space-y-6 lg:order-2 lg:sticky lg:top-24 lg:self-start">

        {/* Transport setup */}
        <section className="card p-4 sm:p-5 space-y-3">
          <h2 className="section-title">{isSheetFormat ? 'Sheet output' : 'Printer'}</h2>
          {isSheetFormat ? (
            <div className="space-y-2">
              <p className="text-sm text-zinc-400">
                Sheets open as a print-ready page for regular printers or Save as PDF.
              </p>
              <div className="rounded-lg bg-amber-500/10 px-3 py-2.5">
                <p className="text-sm font-medium text-amber-300">Important print setting</p>
                <p className="mt-0.5 text-sm text-amber-300">Set scale to 100% / Actual size. Do not use Fit to page or Shrink to printable area.</p>
              </div>
            </div>
          ) : (
            <>
              <div role="radiogroup" aria-label="Which printer" className="grid grid-cols-1 gap-0.5 -mx-1">
                {(['office', 'dazzle', 'webusb'] as Transport[]).map((option) => {
                  const available = option === 'office' || (option === 'dazzle' ? dazzleAvailable : webUsbSupported);
                  const selected = transport === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-describedby={available ? undefined : `transport-why-${option}`}
                      disabled={!available || status === 'running' || !!reprinting}
                      title={available ? undefined : TRANSPORT_LABELS[option].unavailable}
                      onClick={() => setTransport(option)}
                      className={`flex min-h-control items-start gap-3 px-2 py-2 rounded-lg text-left text-sm transition-colors disabled:cursor-not-allowed ${selected ? 'bg-zinc-800 text-zinc-50' : available ? 'text-zinc-200 hover:bg-zinc-800/60' : 'text-zinc-500'}`}
                    >
                      <span aria-hidden="true" className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border transition-colors ${selected ? 'border-amber-400' : 'border-zinc-600'}`}>
                        <span className={`size-2 rounded-full bg-amber-400 transition-transform duration-150 ${selected ? 'scale-100' : 'scale-0'}`} />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium">{TRANSPORT_LABELS[option].label}</span>
                        {!available && <span id={`transport-why-${option}`} className="block text-xs font-normal text-zinc-500 max-sm:sr-only">{TRANSPORT_LABELS[option].unavailable}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
              {transport === 'office' && <div ref={setOfficeConnectionTarget} />}
              {transport === 'dazzle' && (
                dazzlePrinters.length > 0 ? (
                  <div className="space-y-2">
                    <select
                      value={dazzleSelected ?? ''}
                      onChange={(e) => {
                        setDazzleSelected(e.target.value);
                        if (typeof window !== 'undefined') localStorage.setItem('lw:dazzle-printer', e.target.value);
                      }}
                      className="field"
                    >
                      {dazzlePrinters.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name}{p.is_default ? ' (default)' : ''}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs leading-relaxed text-zinc-500">
                      The Dazzle app can&apos;t tell us if the printer is out of labels or ribbon. Watch the printer, or use &ldquo;USB printer (Chrome)&rdquo; for live checks.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">The Dazzle app is running but doesn&apos;t see a printer. Turn the printer on and check it is installed on this computer.</p>
                )
              )}
              {transport === 'webusb' && (
                usbPrinter ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                      <CheckCircle2 className="w-4 h-4" /> {usbPrinter.productName}
                    </div>
                    <p className="text-xs text-zinc-500">
                      {usbPrinter.endpointIn
                        ? 'The printer is checked for paper and ribbon before each batch.'
                        : 'This printer can\'t report paper or ribbon problems, so watch it while it prints.'}
                    </p>
                    {usbPrinter.endpointIn && (
                      <button
                        onClick={async () => {
                          setPrinterStatusMessage('Checking printer...');
                          try {
                            const next = await queryHostStatus(usbPrinter);
                            webUsbStatusWorkingRef.current = true;
                            setPrinterStatusMessage(next.summary);
                          } catch (err) {
                            setPrinterStatusMessage((err as Error)?.message || 'Status check failed');
                          }
                        }}
                        className="btn btn-secondary btn-sm"
                      >
                        Check printer
                      </button>
                    )}
                    {printerStatusMessage && (
                      <p className="text-xs text-zinc-400">{printerStatusMessage}</p>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={async () => {
                      setTransportError(null);
                      try {
                        const d = await requestPrinter();
                        const o = await openPrinter(d);
                        setUsbPrinter(o);
                      } catch (err) {
                        setTransportError((err as Error).name === 'NotFoundError'
                          ? 'No Zebra printer found. Plug it in with USB, turn it on, then press Connect printer again.'
                          : (err as Error).name === 'SecurityError' || (err as Error).name === 'NetworkError'
                            ? 'The printer is busy or in use by another program. Close other label apps, unplug and replug the printer, then try again.'
                            : friendlyError(err, 'Could not connect to the printer. Unplug and replug it, then try again.'));
                      }
                    }}
                    className="btn btn-secondary"
                  >
                    <Plug className="w-4 h-4" aria-hidden="true" /> Connect printer
                  </button>
                )
              )}
            </>
          )}
          {transportError && !isSheetFormat && transport !== 'office' && <p role="alert" className="text-xs text-red-400">{transportError}</p>}
        </section>

        {/* Progress */}
        <section className="card p-4 sm:p-5 space-y-4">
          {blankCheck && <BlankValueCheck check={blankCheck} leaveBlank={leaveBlank} onLeaveBlankChange={setLeaveBlank} showWhenOk={false} compact />}
          {(isSheetFormat || transport !== 'office') && <>
          <div className="flex items-center justify-between">
            <h2 className="section-title">Progress</h2>
            <span className="text-sm font-medium text-zinc-100 tabular-nums">
              {progressLabel} {printedCount.toLocaleString()} of {total.toLocaleString()} · {pct}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
            <div className="h-full rounded-full bg-amber-500 transition-[width] duration-300 ease-in-out" style={{ width: `${pct}%` }} />
          </div>
          {isSheetFormat && pendingSheetRange && (
            <div className="rounded-lg bg-amber-500/10 p-3 space-y-2.5">
              <p className="text-sm text-amber-300">
                Opened labels {pendingSheetRange.from}-{pendingSheetRange.to}. This run stays in progress until the printed sheet is confirmed.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void markSheetRangePrinted()}
                  className="btn btn-primary btn-sm flex-1"
                >
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  Mark printed
                </button>
                <button
                  onClick={() => void dismissPendingSheetRange()}
                  className="btn btn-ghost btn-sm"
                >
                  Not printed
                </button>
              </div>
            </div>
          )}
          {errorMsg && (
            <p role="alert" className="text-sm text-red-400 flex items-start gap-1.5">
              <AlertCircle className="mt-0.5 w-3.5 h-3.5 shrink-0" /> {friendlyRenderError(friendlyError(errorMsg), template.elements, across)}
            </p>
          )}

          {/* Stop-at control: only show when idle/paused (not while running) */}
          {(status === 'idle' || status === 'paused' || status === 'error') && printedCount < total && !reprinting && (
            <div className="space-y-2 text-xs font-medium text-zinc-400">
              <div className="grid grid-cols-3 gap-2">
                <label>From label
                  <input type="number" inputMode="numeric" min={1} max={total} value={fromValue} onChange={e => { setFromDraft(e.target.value); setCountDraft(null); }} className="field mt-1 w-full tabular-nums" />
                </label>
                <label>Stop after label
                  <input type="number" inputMode="numeric" min={selectedFrom || 1} max={total} value={throughValue} onChange={e => { setThroughDraft(e.target.value); setCountDraft(null); }} className="field mt-1 w-full tabular-nums" />
                </label>
                <label>How many
                  <input type="number" inputMode="numeric" min={1} max={total-selectedFrom+1} value={countDraft ?? (rangeValid ? selectedThrough-selectedFrom+1 : '')} onChange={e => { setCountDraft(e.target.value); if (e.target.value.trim() && Number.isInteger(Number(e.target.value)) && Number(e.target.value) > 0) setThroughDraft(String(selectedFrom + Number(e.target.value) - 1)); }} className="field mt-1 w-full tabular-nums" />
                </label>
              </div>
              {!rangeValid && <p role="alert" className="text-sm font-normal text-amber-300">Enter whole label numbers from 1 to {total}, with the stop number at or after the start.</p>}
            </div>
          )}
          {/* Controls */}
          <div className="flex items-center gap-2">
            {isSheetFormat && pendingSheetRange && (
              <button
                onClick={() => void markSheetRangePrinted()}
                className="btn btn-primary flex-1"
              >
                <CheckCircle2 className="w-4 h-4" />
                Confirm printed
              </button>
            )}
            {isSheetFormat && !pendingSheetRange && printedCount < total && (
              <button
                onClick={() => openSheetPrintRange()}
                className="btn btn-primary flex-1"
              >
                <FileText className="w-4 h-4" />
                Open Print / PDF
              </button>
            )}
            {!isSheetFormat && (status === 'idle' || status === 'paused' || status === 'error') && printedCount < total && (
              <button
                onClick={startOrResume}
                disabled={!canStart || !rangeValid}
                className="btn btn-primary flex-1"
              >
                {status === 'paused' ? <Play className="w-4 h-4" /> : <Printer className="w-4 h-4" />}
                {status === 'paused' ? `Resume from label ${selectedFrom || printedCount + 1}` : status === 'error' ? 'Try again' : 'Start printing'}
              </button>
            )}
            {status === 'running' && transport === 'dazzle' && (
              <div role="status" className="flex-1 flex min-h-control items-center justify-center gap-2 text-sm text-zinc-300"><Loader2 className="w-4 h-4 animate-spin text-amber-400" aria-hidden="true" />Sending labels…</div>
            )}
            {status === 'running' && transport !== 'dazzle' && (
              <button
                onClick={handlePause}
                className="btn btn-secondary flex-1"
              >
                <Pause className="w-4 h-4" /> Pause
              </button>
            )}
            {status === 'completed' && (
              onDone ? (
                <button
                  type="button"
                  onClick={onDone}
                  className="btn btn-secondary flex-1"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 animate-success rounded-full" aria-hidden="true" /> Done
                </button>
              ) : (
                <p role="status" className="flex-1 flex min-h-control items-center justify-center gap-2 text-sm font-medium text-emerald-400"><CheckCircle2 className="w-4 h-4 rounded-full animate-success" aria-hidden="true" /> All {total.toLocaleString()} labels printed</p>
              )
            )}
          </div>
          {!blanksOk && !isSheetFormat && (status === 'idle' || status === 'paused' || status === 'error') && printedCount < total && (
            <p className="text-sm text-amber-300">Printing is off until every label has a value (see the list above).</p>
          )}

          <p className="text-xs text-zinc-500">This run keeps the design it was started with; design edits apply to new runs. {run.designSnapshot?.legacy && "Older run: the design was saved during the reliability update, not when the run was first made."}</p>
          {!isSheetFormat && status !== 'completed' && status !== 'cancelled' && !reprinting && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void requestCancel()}
                aria-label="Cancel run"
                className="btn btn-danger-ghost btn-sm"
              >
                <X className="w-4 h-4" aria-hidden="true" /> Cancel run
              </button>
            </div>
          )}

          {/* Reprint: a separate From/To job that never changes the run's progress. */}
          {status !== 'running' && total > 0 && (
            <div className="pt-1 space-y-2">
              {reprinting ? (
                <div role="status" className="space-y-2 text-sm text-zinc-300">
                  <p className="flex items-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin text-amber-400" aria-hidden="true" /> Reprinting labels {reprinting.from}–{reprinting.to} ({reprinting.done} of {reprinting.to - reprinting.from + 1} sent). The run&apos;s progress won&apos;t change.</p>
                  <button type="button" onClick={stopReprint} className="btn btn-secondary btn-sm">Stop reprint</button>
                </div>
              ) : !showReprint ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openReprint(Math.max(1, Math.min(printedCount || 1, total)), Math.max(1, Math.min(printedCount || 1, total)))}
                    className="btn btn-secondary btn-sm flex-1"
                    title="Jam, ribbon out, bad print? Print some labels again."
                  >
                    <Hash className="w-4 h-4" aria-hidden="true" /> Reprint some labels…
                  </button>
                  {printedCount > 0 && (
                    <button
                      type="button"
                      onClick={() => openReprint(1, total)}
                      className="btn btn-secondary btn-sm"
                    >
                      <RotateCcw className="w-4 h-4" aria-hidden="true" /> Reprint all
                    </button>
                  )}
                </div>
              ) : (
                <fieldset className="space-y-3 rounded-lg bg-zinc-950 p-3">
                  <legend className="float-left mb-1 text-sm font-semibold text-zinc-200">Reprint labels</legend>
                  <div className="clear-left grid grid-cols-2 gap-2 text-xs font-medium text-zinc-400">
                    <label>From label
                      <input type="number" inputMode="numeric" min={1} max={total} value={reprintFromDraft} onChange={(e) => setReprintFromDraft(e.target.value)} className="field mt-1 w-full tabular-nums" />
                    </label>
                    <label>To label
                      <input type="number" inputMode="numeric" min={reprintFrom || 1} max={total} value={reprintToDraft} onChange={(e) => setReprintToDraft(e.target.value)} className="field mt-1 w-full tabular-nums" />
                    </label>
                  </div>
                  {reprintValid
                    ? <p className="text-sm text-zinc-400">{reprintCount === 1 ? '1 label' : `${reprintCount.toLocaleString()} labels`}. This won&apos;t change the run&apos;s progress.</p>
                    : <p role="alert" className="text-sm text-amber-300">Enter label numbers from 1 to {total}, with &ldquo;To&rdquo; at or after &ldquo;From&rdquo;.</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleReprintRange()}
                      disabled={!reprintValid || !blanksOk || (!isSheetFormat && transport === 'office')}
                      className="btn btn-primary btn-sm"
                    >
                      <Printer className="w-3.5 h-3.5" /> {isSheetFormat ? 'Open these labels to print' : `Reprint ${reprintCount === 1 ? '1 label' : `${reprintCount} labels`}`}
                    </button>
                    <button type="button" onClick={() => setShowReprint(false)} className="btn btn-ghost btn-sm">Cancel</button>
                  </div>
                  {!isSheetFormat && reprintValid && reprintFrom <= printedCount && (
                    <button type="button" onClick={() => void handleReprintFromHereAndContinue()} className="min-h-control-sm text-left text-sm text-zinc-400 underline underline-offset-2 hover:text-zinc-200">
                      Or go back to label {reprintFrom} and continue the run from there…
                    </button>
                  )}
                </fieldset>
              )}
            </div>
          )}

          </>}
          {!isSheetFormat && transport === 'office' && <OfficePiPrinter run={run} template={template} format={format} runId={runId} total={total} connectionTarget={officeConnectionTarget} printAllowed={blanksOk} />}
          {/* Export section — preserved for every transport */}
          <div>
            {!showExport ? (
              <button
                onClick={() => { setExportFrom(1); setExportTo(total); setShowExport(true); }}
                className="btn btn-ghost btn-sm w-full text-zinc-400"
              >
                <Download className="w-4 h-4" aria-hidden="true" /> Save labels as a file…
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-400 whitespace-nowrap">Labels</span>
                  <input
                    aria-label="Save from label"
                    type="number" min={1} max={total} value={exportFrom}
                    onChange={(e) => setExportFrom(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="field field-sm w-20 tabular-nums"
                  />
                  <span className="text-xs text-zinc-500">–</span>
                  <input
                    aria-label="Save to label"
                    type="number" min={1} max={total} value={resolvedExportTo}
                    onChange={(e) => setExportTo(Math.min(total, parseInt(e.target.value, 10) || total))}
                    className="field field-sm w-20 tabular-nums"
                  />
                  <span className="text-sm text-zinc-400">of {total}</span>
                </div>
                {(() => {
                  const count = resolvedExportTo - exportFrom + 1;
                  if (isSheetFormat) return <p className="text-xs text-zinc-500">Sheets open in a print-ready tab. Choose Save as PDF in the browser print dialog.</p>;
                  if (exporting === 'pdf') return null;
                  if (count > 500) return <p className="text-xs text-amber-400">Large ranges download as consecutive PDF files of up to 500 labels each. Your browser may ask to allow multiple downloads.</p>;
                  if (count > 100) return <p className="text-xs text-amber-400">{count} labels — may take ~{Math.round(count * 0.1)}s. Page stays usable.</p>;
                  return null;
                })()}
                {exporting === 'pdf' && (
                  <div className="space-y-1">
                    <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                      <div className="h-full rounded-full bg-amber-500 transition-[width] duration-300 ease-in-out" style={{ width: `${exportProgress}%` }} />
                    </div>
                    <p className="text-xs text-zinc-500 text-right">{exportProgress}%</p>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  {!isSheetFormat && (
                    <button
                      onClick={() => void handleExportZPL()}
                      disabled={!!exporting}
                      className="btn btn-secondary btn-sm flex-1"
                    >
                      {exporting === 'zpl' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCode2 className="w-4 h-4" />}
                      Printer file (ZPL)
                    </button>
                  )}
                  {isSheetFormat ? (
                    <button
                      onClick={() => openSheetPrintRange({ from: exportFrom, to: resolvedExportTo })}
                      className="btn btn-secondary btn-sm flex-1"
                    >
                      <FileText className="w-4 h-4" />
                      Print / PDF
                    </button>
                  ) : (
                    <button
                      onClick={() => void handleExportPDF()}
                      disabled={!!exporting}
                      className="btn btn-secondary btn-sm flex-1"
                    >
                      {exporting === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                      PDF
                    </button>
                  )}
                  <button
                    onClick={() => { setShowExport(false); setExporting(null); }}
                    className="btn btn-ghost btn-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {eventsForRun.length > 0 && (
            <div className="pt-2 space-y-2">
              <h3 className="section-title">Print history</h3>
              <div className="space-y-1.5">
                {eventsForRun.slice(0, 5).map((event) => (
                  <div key={event.id} className="flex items-baseline justify-between gap-3 text-xs">
                    <span className={
                      event.eventType === 'confirmed' ? 'text-emerald-400' :
                      event.eventType === 'failed' ? 'text-red-400' :
                      event.eventType === 'cancelled' ? 'text-amber-300' :
                      'text-zinc-300'
                    }>
                      {printEventLabel(event)}
                    </span>
                    <span className="shrink-0 text-zinc-500">{formatEventTime(event.createdAt)}</span>
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

    {/* Edit run dialog */}
    <Dialog open={showEdit} onClose={() => setShowEdit(false)} title="Edit run" dismissible={!saving}>
          <div className="space-y-1">
            <label htmlFor="edit-run-name" className="field-label">Run name</label>
            <input
              id="edit-run-name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="field w-full"
            />
          </div>

          {staticEditFields.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="field-label">Same on every label</legend>
              <div className="space-y-2">
                {staticEditFields.map((field) => (
                  <div key={field} className="flex items-center gap-2">
                    <label htmlFor={`edit-static-${field}`} className="text-sm text-zinc-300 w-28 shrink-0 truncate">{field}</label>
                    <input
                      id={`edit-static-${field}`}
                      value={editStatic[field] ?? ''}
                      onChange={(e) => setEditStatic((prev) => ({ ...prev, [field]: e.target.value }))}
                      className="field flex-1 min-w-0"
                    />
                  </div>
                ))}
              </div>
            </fieldset>
          )}

          {sourceEditFields.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="field-label">Label {editRowIndex + 1}</legend>
              <p className="field-help">
                If a value is the same on every label, saving changes all of them; otherwise only label {editRowIndex + 1} changes.
              </p>
              <div className="space-y-2">
                {sourceEditFields.map((item) => (
                  <div key={item.field} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor={`edit-source-${item.field}`} className="text-sm text-zinc-300 truncate">{item.field}</label>
                      <span className="text-xs text-zinc-500 truncate">{item.source}</span>
                    </div>
                    <input
                      id={`edit-source-${item.field}`}
                      value={editSourceValues[item.field] ?? ''}
                      onChange={(e) => setEditSourceValues((prev) => ({ ...prev, [item.field]: e.target.value }))}
                      className="field w-full"
                    />
                  </div>
                ))}
              </div>
            </fieldset>
          )}

          <div className="space-y-1">
            <label htmlFor="edit-run-notes" className="field-label">Notes</label>
            <textarea
              id="edit-run-notes"
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              rows={2}
              placeholder="Optional notes…"
              className="field w-full resize-none"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => void handleSaveEdit()}
              disabled={saving}
              className="btn btn-primary flex-1"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              onClick={() => setShowEdit(false)}
              className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 bg-zinc-900 border border-zinc-800"
            >
              Cancel
            </button>
          </div>
    </Dialog>
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
        const nextUrl = await renderZplToDataUrl(zpl, format);
        if (!cancelled) setUrl(nextUrl);
      } catch (e) {
        if (!cancelled) setErr((e as Error)?.message || 'Render failed');
      }
    })();
    return () => { cancelled = true; };
  }, [zpl, format]);

  if (err) return <p role="alert" className="text-xs text-red-400">{friendlyError(err)}</p>;
  if (!url) return <p role="status" className="text-xs text-zinc-500">Rendering…</p>;
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
