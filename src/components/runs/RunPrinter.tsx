'use client';

import { canLeaveLocalPrint, setLocalPrintRunning } from '@/lib/printNavigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Printer, Pause, Play, X, CheckCircle2, AlertCircle, Loader2, Plug, RotateCcw, FileSpreadsheet, Clipboard, SquareDashed, Pencil, PenTool, Copy, ScanBarcode, Download, FileText, FileCode2, Search, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { OfficePiPrinter } from './OfficePiPrinter';
import { BlankValueCheck } from './BlankValueCheck';
import { Dialog } from '@/components/ui/Dialog';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { extendThrough, firstUnsentLabel, officeLabelsIn, officeMarkPlan, skippedLabels, spanWords, type OfficeSpan } from '@/lib/officeRange';
import { useOfficeRequests } from './useOfficeRequests';
import { officeSentLine, runDisplayStatus } from '@/lib/runDisplayStatus';
import { runLayoutWarnings } from '@/lib/runLayoutCheck';
import { fieldDisplayName } from '@/lib/fieldDisplayName';
import { choiceDialog, confirmDialog } from '@/components/ui/feedback';
import { blankCheckAllowsPrinting, checkRunData, hasBlankChoice, rememberBlankChoice } from '@/lib/runDataCheck';
import { friendlyError, friendlyRenderError, printEventLabel } from '@/lib/userMessages';
import { LabelOutlineOverlay } from '../LabelOutlineOverlay';
import { LayoutPreview } from '@/components/designer/LayoutPreview';
import type { LabelTemplate, LabelFormat, Run, RunStatus } from '@/lib/types';
import { useRunStore } from '@/lib/runStore';
import { startPrintQueue, type RunQueueHandle } from '@/lib/printQueue';
import { dynamicFieldsForTemplate, generateLabelsForRunWithImages, previewLabelValues } from '@/lib/runBuilder';
import { feedRangeForLabels, labelRangeCount, normalizeLabelRange, planRunStart } from '@/lib/runRanges';
import { openInNewTab } from '@/lib/openTab';
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
  if (source === 'csv') return { label: 'From a spreadsheet', fieldLabel: 'Spreadsheet', icon: FileSpreadsheet };
  if (source === 'manifest') return { label: 'From a manifest', fieldLabel: 'Manifest', icon: Search };
  if (source === 'manual') return { label: 'Typed in', fieldLabel: 'Typed', icon: Pencil };
  return { label: 'Pasted', fieldLabel: 'Paste', icon: Clipboard };
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
  const [rewindNotice, setRewindNotice] = useState<string | null>(null);

  const total = run?.totalLabels ?? 0;
  const pct = total > 0 ? Math.round((printedCount / total) * 100) : 0;
  const isSheetFormat = format?.type === 'sheet';

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
  const [showTransportPicker, setShowTransportPicker] = useState(false);
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

  // A deliberate "Go back" on this device: office work from before it is no
  // longer offered as "mark printed", so the offer can't undo the rewind.
  const rewindKey = `lw:run-rewound:${runId}`;
  const [rewoundAt, setRewoundAt] = useState(0);
  useEffect(() => { try { setRewoundAt(Number(localStorage.getItem(rewindKey)) || 0); } catch { setRewoundAt(0); } }, [rewindKey]);
  const noteRewind = () => { const at = Date.now(); setRewoundAt(at); try { localStorage.setItem(rewindKey, String(at)); } catch { /* this page still knows */ } };
  // Ranges people confirmed came out of the office printer (print history).
  const officeConfirmed = useMemo<OfficeSpan[]>(() => eventsForRun
    .filter((event) => event.eventType === 'confirmed' && event.output === 'office-pi' && Date.parse(event.createdAt) > rewoundAt)
    .map((event) => ({ from: event.rangeFrom, to: event.rangeTo })), [eventsForRun, rewoundAt]);

  // The office printer's work on this run, for display only. Office sends
  // never move the run's progress: "sent to the printer" isn't proof that a
  // label printed, so marking them printed is an explicit, confirmed step.
  const office = useOfficeRequests(runId, transport === 'office', total, { printedCount, printedSpans: officeConfirmed });
  const officeSummary = office.loaded && office.jobs.length > 0
    ? { sent: office.summary.sent, onTheWay: office.summary.onTheWay, failed: office.summary.failed.length, failedLabels: office.summary.failedLabels, firstFailed: office.summary.failed[0] }
    : null;
  // Every stretch the office reported sent and nobody counted yet.
  const officeMark = useMemo(() => {
    const after = rewoundAt ? new Set(office.requests.filter((r) => r.created_at && Date.parse(r.created_at) > rewoundAt).map((r) => r.id)) : null;
    const jobs = after ? office.jobs.filter((job) => after.has(job.requestId)) : office.jobs;
    return officeMarkPlan(printedCount, jobs, officeConfirmed, total);
  }, [office.jobs, office.requests, officeConfirmed, printedCount, total, rewoundAt]);
  const allWithOffice = !!officeSummary && printedCount < total && firstUnsentLabel(office.jobs, total, printedCount) === null;
  // Print history follows the office: every move re-reads it.
  const officeSignature = office.signature;
  useEffect(() => { if (officeSignature) void fetchPrintEvents(runId); }, [officeSignature, fetchPrintEvents, runId]);
  const [markNotice, setMarkNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  // Items that cover each other or run off the label, checked on every label
  // (up to 2,000) the same way the run wizard does. Asked about once before
  // printing or sending. Keyed on what changes printed labels, not progress.
  const layoutWarnings = useMemo(
    () => runLayoutWarnings(run, template, format),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run?.id, run?.sourceData, run?.fieldMappings, run?.staticValues, run?.mappedField, run?.totalLabels, template, format],
  );
  const [layoutAskedKey, setLayoutAskedKey] = useState('');
  const layoutKey = layoutWarnings.join('|');
  const askAboutLayout = async (action: string) => {
    if (!layoutWarnings.length || layoutAskedKey === layoutKey) return true;
    const ok = await confirmDialog({
      title: `${action} labels with layout problems?`,
      body: <div className="space-y-2"><p>The preview shows items that cover each other or run off the label:</p><ul className="list-disc space-y-1 pl-5">{layoutWarnings.slice(0, 4).map((w) => <li key={w}>{w}</li>)}</ul>{layoutWarnings.length > 4 && <p>And {layoutWarnings.length - 4} more.</p>}<p>Check the preview first. Fix the design for next time with Edit design.</p></div>,
      confirmLabel: `${action} anyway`,
    });
    if (ok) setLayoutAskedKey(layoutKey);
    return ok;
  };

  // Open the preview at the next label to print, once per run.
  const previewStarted = useRef('');
  useEffect(() => {
    if (!run || previewStarted.current === run.id) return;
    previewStarted.current = run.id;
    setPreviewIndex(Math.max(0, Math.min(run.totalLabels - 1, run.printedCount ?? 0)));
  }, [run]);

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

  // Pick a printer once on mount: the one this person used last (if it is
  // available here), else the Dazzle app if running, else the office printer
  // when the account has one, else a USB printer in Chrome.
  useEffect(() => {
    (async () => {
      let saved: string | null = null;
      try { saved = localStorage.getItem('lw:last-transport'); } catch { saved = null; }
      const dz = await isDazzleRunning();
      setDazzleAvailable(dz);
      if (dz) {
        try {
          const ps = await listDazzlePrinters();
          setDazzlePrinters(ps);
          const savedPrinter = typeof window !== 'undefined' ? localStorage.getItem('lw:dazzle-printer') : null;
          const match = savedPrinter ? ps.find((p) => p.name === savedPrinter) : undefined;
          setDazzleSelected(match?.name ?? ps.find((p) => p.is_default)?.name ?? ps[0]?.name ?? null);
        } catch (err) {
          setTransportError(friendlyError(err, 'Couldn’t list the printers in the Dazzle app.'));
        }
      }
      let pick: Transport | null = saved === 'office' ? 'office' : saved === 'dazzle' && dz ? 'dazzle' : saved === 'webusb' && webUsbSupported ? 'webusb' : null;
      if (!pick && dz) pick = 'dazzle';
      if (!pick) {
        try {
          const response = await fetch('/api/office/stations', { cache: 'no-store' });
          const data = response.ok ? await response.json() : null;
          if (data?.canPrint && Array.isArray(data.printers) && data.printers.length > 0) pick = 'office';
        } catch { /* no office printer info: fall through */ }
      }
      if (!pick) pick = webUsbSupported ? 'webusb' : 'office';
      const chosen = pick;
      setTransport(current => current || chosen);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconnect a USB printer this browser was already allowed to use.
  const triedUsb = useRef(false);
  useEffect(() => {
    if (transport !== 'webusb' || usbPrinter || triedUsb.current || !webUsbSupported) return;
    triedUsb.current = true;
    void (async () => {
      try {
        const authorized = await getAuthorizedPrinters();
        if (authorized.length > 0) setUsbPrinter(await openPrinter(authorized[0]));
      } catch { /* soft fail — the person can press Connect printer */ }
    })();
  }, [transport, usbPrinter, webUsbSupported]);

  const chooseTransport = (option: Transport) => {
    setTransport(option);
    try { localStorage.setItem('lw:last-transport', option); } catch { /* remembered for this page only */ }
  };

  // Warn user if they try to close the tab mid-print.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // Only while labels are streaming from this browser. Office sends and
      // sheet tabs carry on without this page, and a paused run has nothing
      // in flight.
      if ((status === 'running' && transport !== 'office' && !isSheetFormat) || reprinting) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [status, transport, isSheetFormat, reprinting]);

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
          source: mapping.csvColumn === '__paste__' ? 'Pasted value' : `${sourceMeta.fieldLabel} column “${mapping.csvColumn}”`,
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
    // A permanently refused update (run deleted, no permission) means the
    // labels being printed are not recorded anywhere, so stop.
    const stopUnrecorded = (reason: string) => { queueRef.current?.pause(); setStatus('paused'); setErrorMsg(`Printing paused because the server refused to save progress. ${reason}`); };
    try { await updateRunWithQueue(run.id, { printedCount: next }, stopUnrecorded); }
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
    // A From at or below what is already printed moves the run back, the same
    // as "Go back to label N". Without the explicit rewind the server would
    // keep the higher count and the next Resume would skip labels.
    const plan = planRunStart(printedCount, selectedFrom);
    // Starting after the next unprinted label would count the labels in
    // between as printed, because progress is "printed up to label N".
    const skipped = plan.rewind ? null : skippedLabels(printedCount, selectedFrom);
    if (skipped) {
      // The safe choice is the primary button; closing the dialog starts nothing.
      const choice = await choiceDialog({
        title: `Skip ${skipped.from === skipped.to ? `label ${skipped.from}` : `labels ${skipped.from}–${skipped.to}`}?`,
        body: `The next label to print is ${skipped.from}. If you start at ${selectedFrom}, ${skipped.from === skipped.to ? `label ${skipped.from} is` : `labels ${skipped.from}–${skipped.to} are`} counted as printed without printing.`,
        confirmLabel: `Start at ${skipped.from} instead`,
        altLabel: 'Skip and count as printed',
      });
      if (choice === 'confirm') { setFromDraft(String(skipped.from)); setCountDraft(null); return; }
      if (choice !== 'alt') return;
    }
    // Labels the office printer already has: printing them here too is a
    // choice, not a surprise.
    const atOffice = officeLabelsIn(office.jobs, selectedFrom, selectedThrough);
    if (atOffice) {
      const one = atOffice.from === atOffice.to;
      const ok = await confirmDialog({
        title: `Print ${one ? `label ${atOffice.from}` : `labels ${atOffice.from}–${atOffice.to}`} here too?`,
        body: `${one ? `Label ${atOffice.from} was` : `Labels ${atOffice.from}–${atOffice.to} were`} ${atOffice.sent ? 'already sent to' : 'already queued for'} the office printer. Printing here prints ${one ? 'it' : 'them'} a second time.`,
        confirmLabel: 'Print here too',
      });
      if (!ok) return;
    }
    if (!(await askAboutLayout('Print'))) return;
    if (plan.rewind) {
      const ok = await confirmDialog({
        title: `Go back to label ${selectedFrom} and continue?`,
        body: `Labels up to ${printedCount} are already printed. The run's progress goes back to ${plan.startCount} of ${total}, and labels ${selectedFrom} to ${selectedThrough} print now. To print a few labels again without changing progress, use "Print some labels again" instead.`,
        confirmLabel: `Go back to label ${selectedFrom}`,
      });
      if (!ok) { setFromDraft(null); setCountDraft(null); return; }
      setPrintedCount(plan.startCount);
      noteRewind();
    }
    const startCount = plan.startCount;
    setStatus('running');
    const controller = new AbortController();
    preparation.current = controller;
    const refusedStart = { reason: '' };
    try { await setRunStatus(run.id, 'printing', startCount, { resetProgress: plan.rewind, ...(plan.rewind ? { expectedPrintedCount: printedCount } : {}), onSetAside: (reason) => { refusedStart.reason = reason; } }); }
    catch(error) { setStatus('paused'); setErrorMsg((error as Error).message); return; }
    if (refusedStart.reason) { setStatus('paused'); setErrorMsg(`The server refused to start this run, so nothing was printed. ${refusedStart.reason}`); return; }
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
    catch (error) { if (controller.signal.aborted) return; setStatus('error'); setErrorMsg(error instanceof Error ? error.message : 'Render failed'); await setRunStatus(run.id, 'paused', startCount); return; }
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
      if (!openInNewTab(sheetPrintHref(range))) { setErrorMsg('Popup blocked. Allow popups, then try again.'); return; }
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
    noteRewind();
    const refused = { reason: '' };
    const before = printedCount;
    await setRunStatus(run.id, 'paused', n - 1, { resetProgress: true, expectedPrintedCount: before, onSetAside: (reason) => { refused.reason = reason; } });
    if (refused.reason) { setPrintedCount(run.printedCount ?? 0); setErrorMsg(`Going back didn’t save. ${refused.reason}`); return; }
    if (pendingPatchCount(run.id)) setRewindNotice(`Going back to label ${n} is saved on this device and is sent when you’re back online. If another device prints more first, it isn’t applied and you’ll be told.`);
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
    if (!openInNewTab(sheetPrintHref(resolved))) {
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
    // A later range would move progress past labels that never printed.
    // Ask; the safe answer (and closing the dialog) keeps progress where it is.
    const skipped = skippedLabels(printedCount, pendingSheetRange.from);
    let countSkipped = true;
    if (skipped) {
      const one = skipped.from === skipped.to;
      // Keeping progress honest is the primary button, and closing the dialog.
      countSkipped = (await choiceDialog({
        title: `${one ? `Label ${skipped.from} hasn’t` : `Labels ${skipped.from}–${skipped.to} haven’t`} printed yet`,
        body: `Labels ${pendingSheetRange.from}–${pendingSheetRange.to} are marked printed either way. Keep progress at ${printedCount} so the next print starts at label ${skipped.from}, or count ${one ? `label ${skipped.from}` : `labels ${skipped.from}–${skipped.to}`} as printed too?`,
        confirmLabel: `Keep progress at ${printedCount}`,
        altLabel: 'Count them too',
      })) === 'alt';
    }
    const nextPrinted = countSkipped ? Math.max(printedCount, pendingSheetRange.to) : printedCount;
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
    if (!blanksOk) { setErrorMsg('Some labels are missing a value. Fix the data (see the list above) before saving labels as a file.'); return; }
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
    if (!blanksOk) { setErrorMsg('Some labels are missing a value. Fix the data (see the list above) before saving labels as a file.'); return; }
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

  const transportReady = (transport === 'dazzle' && !!dazzleSelected) || (transport === 'webusb' && !!usbPrinter);
  const pickerOpen = !isSheetFormat && (showTransportPicker || !transport);
  const runFinished = printedCount >= total && total > 0;
  const display = runDisplayStatus({ status: run.status, printedCount, totalLabels: total }, officeSummary);
  const sentLine = officeSentLine(officeSummary, total);
  // Scan mode is for printing here, one label per scan: kept out of the way
  // when the office printer is chosen or the run is over.
  const scanInHeader = !isSheetFormat && transport !== 'office' && !runFinished && run.status !== 'cancelled';
  /**
   * Counts labels the office sent (or a part someone saw come out) as printed:
   * progress moves through every unbroken stretch, and each range is kept in
   * the print history as confirmed, so a range after a gap counts once the gap
   * is printed. Never runs on its own.
   */
  const recordOfficePrinted = async (ranges: OfficeSpan[], message: string): Promise<boolean> => {
    if (!run || !ranges.length) return false;
    setMarkNotice(null);
    const through = extendThrough(printedCount, [...officeConfirmed, ...ranges], total);
    if (through > printedCount) {
      const nextStatus = through >= total ? 'completed' : 'paused';
      const refused = { reason: '' };
      try { await setRunStatus(run.id, nextStatus, through, { onSetAside: (reason) => { refused.reason = reason; } }); }
      catch { setMarkNotice({ tone: 'bad', text: 'That didn’t save. Try again in a moment.' }); return false; }
      if (refused.reason) { setMarkNotice({ tone: 'bad', text: `That didn’t save. ${refused.reason}` }); return false; }
      setPrintedCount((count) => Math.max(count, through));
      setStatus(nextStatus);
    }
    for (const r of ranges) {
      await createPrintEvent(run.id, {
        eventType: 'confirmed', output: 'office-pi', rangeFrom: r.from, rangeTo: r.to, labelCount: r.to - r.from + 1,
        printedCountAfter: Math.max(printedCount, through), printerName: 'Office printer', message: message || 'Checked and marked printed after the office sent them',
      });
    }
    return true;
  };
  const markOfficePrinted = async () => {
    const ranges = officeMark.ranges;
    if (!run || !ranges.length) return;
    const words = spanWords(ranges);
    const one = ranges.length === 1 && ranges[0].from === ranges[0].to;
    const through = Math.max(printedCount, officeMark.through);
    const ok = await confirmDialog({
      title: `Mark ${words} as printed?`,
      body: `The office printer reported ${one ? 'it' : 'them'} as sent. Check that ${one ? 'it' : 'they'} came out of the printer first.${through > printedCount ? ` Progress moves to ${through.toLocaleString()} of ${total.toLocaleString()}.` : ''}`,
      confirmLabel: 'Mark printed',
    });
    if (!ok) return;
    if (await recordOfficePrinted(ranges, '')) setMarkNotice({ tone: 'ok', text: `${words.charAt(0).toUpperCase()}${words.slice(1)} marked printed.` });
  };
  const moreItems: MenuItem[] = [
    { label: 'Re-run with the same data', icon: <Copy className="h-4 w-4 text-zinc-400" aria-hidden="true" />, href: `/runs/new?duplicateFrom=${run.id}` },
    { label: 'Edit run', icon: <Pencil className="h-4 w-4 text-zinc-400" aria-hidden="true" />, onSelect: openEdit },
    { label: 'Edit design for next time', icon: <PenTool className="h-4 w-4 text-zinc-400" aria-hidden="true" />, href: `/designer?id=${template.id}&returnTo=${encodeURIComponent(`/runs/${run.id}`)}` },
    { label: 'Save labels as a file…', icon: <Download className="h-4 w-4 text-zinc-400" aria-hidden="true" />, onSelect: () => { setExportFrom(1); setExportTo(total); setShowExport(true); } },
    ...(!isSheetFormat && transport !== 'office' && status !== 'completed' && status !== 'cancelled' && !reprinting
      ? [{ label: 'Cancel run', icon: <X className="h-4 w-4" aria-hidden="true" />, danger: true, onSelect: () => void requestCancel() }]
      : []),
  ];

  return (
    <>
    <div className="flex-1 overflow-auto">
      <div className="page-frame space-y-5 sm:space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold text-zinc-100 break-words">{run.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-zinc-400">
              <span className="inline-flex items-center gap-1.5 font-medium text-zinc-100">
                <span aria-hidden="true" className={`size-2 rounded-full ${
                  display.tone === 'done' ? 'bg-emerald-400' :
                  display.tone === 'active' ? 'bg-amber-400' :
                  display.tone === 'attention' ? 'bg-red-400' :
                  display.tone === 'paused' ? 'ring-2 ring-inset ring-amber-300' :
                  display.tone === 'cancelled' ? 'bg-zinc-500' : 'ring-2 ring-inset ring-zinc-500'
                }`} /><span className={display.tone === 'attention' ? 'text-red-400' : undefined}>{display.label}</span></span>
              <span aria-hidden="true">·</span>
              <span>{template.name}</span>
              <span aria-hidden="true">·</span>
              <span>{format.name}{/["″]/.test(format.name) ? '' : ` (${format.width}″ × ${format.height}″)`}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{total.toLocaleString()} label{total === 1 ? '' : 's'}</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {scanInHeader && <Link href={`/runs/${run.id}/scan`} className="btn btn-secondary btn-sm" title="One label per scan, hands-free">
              <ScanBarcode className="w-4 h-4 text-amber-400" aria-hidden="true" />
              Scan mode
            </Link>}
            <Menu items={moreItems} label="More" />
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[400px_minmax(0,1fr)] gap-5 lg:gap-6">
          {/* Print first, on every screen: what you see first is what Tab reaches first. */}
          <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <section aria-label="Print" className="card card-flat p-4 sm:p-5 space-y-5">
          <div className="space-y-3">
            <div className="flex min-h-control items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="section-title">{isSheetFormat ? 'Sheet labels' : 'Printer'}</h2>
                {!isSheetFormat && <p className="truncate text-sm text-zinc-300">{transport ? TRANSPORT_LABELS[transport].label : 'Choose a printer'}</p>}
              </div>
              {!isSheetFormat && transport && (
                <button type="button" onClick={() => setShowTransportPicker((v) => !v)} aria-expanded={pickerOpen} disabled={status === 'running' || !!reprinting} className="btn btn-ghost btn-sm text-zinc-300">
                  {pickerOpen ? 'Done' : 'Change'}
                </button>
              )}
            </div>
            {isSheetFormat && (
              <p className="text-sm text-zinc-300">Sheets open as a print page for any printer, or Save as PDF. <span className="text-amber-300">Print at 100% (Actual size), not Fit to page.</span></p>
            )}
            {pickerOpen && (
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
                      onClick={() => { chooseTransport(option); setShowTransportPicker(false); }}
                      className={`flex min-h-control items-start gap-3 px-2 py-2 rounded-lg text-left text-sm transition-colors disabled:cursor-not-allowed ${selected ? 'bg-zinc-800 text-zinc-100' : available ? 'text-zinc-300 hover:bg-zinc-800' : 'text-zinc-400'}`}
                    >
                      <span aria-hidden="true" className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border transition-colors ${selected ? 'border-amber-400' : 'border-zinc-600'}`}>
                        <span className={`size-2 rounded-full bg-amber-400 transition-transform duration-150 ${selected ? 'scale-100' : 'scale-0'}`} />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium">{TRANSPORT_LABELS[option].label}</span>
                        {!available && <span id={`transport-why-${option}`} className="block text-xs font-normal text-zinc-400">{TRANSPORT_LABELS[option].unavailable}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {!isSheetFormat && transport === 'office' && <div ref={setOfficeConnectionTarget} />}
            {!isSheetFormat && transport === 'dazzle' && (
              dazzlePrinters.length > 0 ? (
                <div className="space-y-2">
                  {dazzlePrinters.length > 1 ? (
                    <CustomSelect
                      aria-label="Printer in the Dazzle app"
                      value={dazzleSelected ?? ''}
                      onChange={(value) => {
                        setDazzleSelected(value);
                        try { localStorage.setItem('lw:dazzle-printer', value); } catch { /* remembered for this page only */ }
                      }}
                      options={dazzlePrinters.map((p) => ({ value: p.name, label: p.name, sublabel: p.is_default ? 'Default printer' : undefined }))}
                    />
                  ) : <p className="text-sm text-zinc-300">{dazzlePrinters[0].name}</p>}
                  <p className="text-sm text-zinc-400">The Dazzle app can&apos;t tell if the printer is out of labels or ribbon, so watch the printer.</p>
                </div>
              ) : (
                <p className="text-sm text-zinc-400">The Dazzle app is running but doesn&apos;t see a printer. Turn the printer on and check it&apos;s installed on this computer.</p>
              )
            )}
            {!isSheetFormat && transport === 'webusb' && (
              usbPrinter ? (
                <div className="space-y-2">
                  <p className="flex items-center gap-2 text-sm text-emerald-400"><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> {usbPrinter.productName}</p>
                  {usbPrinter.endpointIn ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          setPrinterStatusMessage('Checking printer…');
                          try {
                            const next = await queryHostStatus(usbPrinter);
                            webUsbStatusWorkingRef.current = true;
                            setPrinterStatusMessage(next.summary);
                          } catch (err) {
                            setPrinterStatusMessage(friendlyError(err, 'Status check failed'));
                          }
                        }}
                        className="btn btn-ghost btn-sm -ml-2 text-zinc-300"
                      >
                        Check paper and ribbon
                      </button>
                      {printerStatusMessage && <p role="status" className="text-sm text-zinc-400">{printerStatusMessage}</p>}
                    </div>
                  ) : <p className="text-sm text-zinc-400">This printer can&apos;t report paper or ribbon problems, so watch it while it prints.</p>}
                </div>
              ) : (
                <button
                  type="button"
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
                          : friendlyError(err, 'Couldn’t connect to the printer. Unplug and replug it, then try again.'));
                    }
                  }}
                  className="btn btn-secondary w-full"
                >
                  <Plug className="w-4 h-4" aria-hidden="true" /> Connect printer
                </button>
              )
            )}
            {transportError && !isSheetFormat && transport !== 'office' && <p role="alert" className="text-sm text-red-400">{transportError}</p>}
          </div>

          {blankCheck && <BlankValueCheck check={blankCheck} leaveBlank={leaveBlank} onLeaveBlankChange={setLeaveBlank} showWhenOk={false} compact />}

          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="section-title">Progress</h2>
              <span className="text-sm font-medium text-zinc-100 tabular-nums">Printed {printedCount.toLocaleString()} of {total.toLocaleString()}</span>
            </div>
            <div className="h-2 rounded-full bg-zinc-800 overflow-hidden" role="progressbar" aria-label="Labels printed" aria-valuemin={0} aria-valuemax={total} aria-valuenow={printedCount}>
              <div className={`h-full rounded-full transition-[width,background-color] duration-300 ease-in-out ${runFinished ? 'bg-emerald-400' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
            </div>
            {/* What the office printer has done: shown, never counted as printed.
                With the office printer chosen, its panel says it once. */}
            {transport !== 'office' && sentLine && <p className="text-sm text-zinc-400 tabular-nums">{sentLine}</p>}
            {officeSummary && officeSummary.failed > 0 && transport !== 'office' && (
              <p className="text-sm text-red-400">{officeSummary.failedLabels ? `${officeSummary.failedLabels.toLocaleString()} office label${officeSummary.failedLabels === 1 ? '' : 's'} need${officeSummary.failedLabels === 1 ? 's' : ''} attention.` : 'Part of an office print needs attention.'} <button type="button" className="font-medium underline underline-offset-2" onClick={() => chooseTransport('office')}>Open the office printer</button></p>
            )}
            {transport !== 'office' && officeMark.ranges.length > 0 && status !== 'running' && (
              <button type="button" onClick={() => void markOfficePrinted()} className="btn btn-secondary btn-sm w-full">
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Mark {spanWords(officeMark.ranges)} as printed…
              </button>
            )}
            {markNotice && <p role={markNotice.tone === 'bad' ? 'alert' : 'status'} className={`text-sm ${markNotice.tone === 'bad' ? 'text-red-400' : 'text-emerald-400'}`}>{markNotice.text}</p>}
            {rewindNotice && <p role="status" className="text-sm text-amber-300">{rewindNotice}</p>}
          </div>

          {(isSheetFormat || transport !== 'office') && <>
          {isSheetFormat && pendingSheetRange && (
            <div className="space-y-2">
              <p className="text-sm text-amber-300">Labels {pendingSheetRange.from}–{pendingSheetRange.to} are open in the print tab. Did they print?</p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void markSheetRangePrinted()} className="btn btn-primary btn-sm flex-1">
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Yes, mark printed
                </button>
                <button type="button" onClick={() => void dismissPendingSheetRange()} className="btn btn-ghost btn-sm">
                  Not printed
                </button>
              </div>
            </div>
          )}
          {errorMsg && (
            <p role="alert" className="text-sm text-red-400 flex items-start gap-1.5">
              <AlertCircle className="mt-0.5 w-4 h-4 shrink-0" aria-hidden="true" /> {friendlyRenderError(friendlyError(errorMsg), template.elements, across)}
            </p>
          )}

          {(status === 'idle' || status === 'paused' || status === 'error') && printedCount < total && !reprinting && !showReprint && !(isSheetFormat && pendingSheetRange) && (
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
          {allWithOffice && !isSheetFormat && status !== 'running' && !showReprint && (
            <p className="text-sm text-amber-300">Every label is already {officeSummary && officeSummary.onTheWay > 0 ? 'on its way to' : 'sent to'} the office printer. Printing here prints them again.</p>
          )}
          {/* While "Print some labels again" is open, its own range and button are the only ones on screen. */}
          {!showReprint && <div className="flex items-center gap-2">
            {isSheetFormat && !pendingSheetRange && printedCount < total && (
              <button type="button" onClick={() => openSheetPrintRange()} className="btn btn-primary flex-1">
                <FileText className="w-4 h-4" aria-hidden="true" />
                Open print page
              </button>
            )}
            {!isSheetFormat && (status === 'idle' || status === 'paused' || status === 'error') && printedCount < total && (
              <button type="button" onClick={startOrResume} disabled={!canStart || !rangeValid} className="btn btn-primary flex-1">
                {status === 'paused' ? <Play className="w-4 h-4" aria-hidden="true" /> : <Printer className="w-4 h-4" aria-hidden="true" />}
                {rangeValid && selectedFrom <= printedCount ? `Go back to label ${selectedFrom}` : allWithOffice ? 'Print here too…' : status === 'paused' ? `Resume from label ${selectedFrom || printedCount + 1}` : status === 'error' ? 'Try again' : 'Start printing'}
              </button>
            )}
            {status === 'running' && transport === 'dazzle' && (
              <div role="status" className="flex-1 flex min-h-control items-center justify-center gap-2 text-sm text-zinc-300"><Loader2 className="w-4 h-4 animate-spin text-amber-400" aria-hidden="true" />Sending labels…</div>
            )}
            {status === 'running' && transport !== 'dazzle' && !isSheetFormat && (
              <button type="button" onClick={handlePause} className="btn btn-secondary flex-1">
                <Pause className="w-4 h-4" aria-hidden="true" /> Pause
              </button>
            )}
            {(status === 'completed' || (runFinished && status !== 'running')) && (
              onDone ? (
                <button type="button" onClick={onDone} className="btn btn-secondary flex-1">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 animate-success rounded-full" aria-hidden="true" /> Done
                </button>
              ) : (
                <p role="status" className="flex-1 flex min-h-control items-center gap-2 text-sm font-medium text-emerald-400"><CheckCircle2 className="w-4 h-4 rounded-full animate-success" aria-hidden="true" /> All {total.toLocaleString()} labels printed</p>
              )
            )}
          </div>}
          {!isSheetFormat && !transportReady && !showReprint && (status === 'idle' || status === 'paused' || status === 'error') && printedCount < total && (
            <p className="text-sm text-zinc-400">{transport === 'webusb' ? 'Connect a printer first.' : transport === 'dazzle' ? 'Turn on a printer in the Dazzle app first.' : 'Choose a printer first.'}</p>
          )}
          {!blanksOk && !isSheetFormat && (status === 'idle' || status === 'paused' || status === 'error') && printedCount < total && (
            <p className="text-sm text-amber-300">Printing is off until every label has a value (see the list above).</p>
          )}

          {/* Reprint: a separate From/To job that never changes the run's progress.
              Offered once something has printed. */}
          {status !== 'running' && total > 0 && (printedCount > 0 || !!reprinting || showReprint) && (
            reprinting ? (
              <div role="status" className="space-y-2 text-sm text-zinc-300">
                <p className="flex items-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin text-amber-400" aria-hidden="true" /> Reprinting labels {reprinting.from}–{reprinting.to} ({reprinting.done} of {reprinting.to - reprinting.from + 1} sent). Progress won&apos;t change.</p>
                <button type="button" onClick={stopReprint} className="btn btn-secondary btn-sm">Stop reprint</button>
              </div>
            ) : !showReprint ? (
              <button
                type="button"
                onClick={() => openReprint(Math.max(1, Math.min(printedCount || 1, total)), Math.max(1, Math.min(printedCount || 1, total)))}
                className={`btn btn-sm w-full ${runFinished ? 'btn-secondary' : 'btn-ghost text-zinc-300'}`}
                title="Jam, ribbon out, bad print? Print some labels again."
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" /> Print some labels again…
              </button>
            ) : (
              <fieldset className="space-y-3">
                <legend className="mb-2 text-sm font-semibold text-zinc-100">Print some labels again</legend>
                <div className="grid grid-cols-2 gap-2 text-xs font-medium text-zinc-400">
                  <label>From label
                    <input type="number" inputMode="numeric" min={1} max={total} value={reprintFromDraft} onChange={(e) => setReprintFromDraft(e.target.value)} className="field mt-1 w-full tabular-nums" />
                  </label>
                  <label>To label
                    <input type="number" inputMode="numeric" min={reprintFrom || 1} max={total} value={reprintToDraft} onChange={(e) => setReprintToDraft(e.target.value)} className="field mt-1 w-full tabular-nums" />
                  </label>
                </div>
                {reprintValid
                  ? <p className="text-sm text-zinc-400">{reprintCount === 1 ? '1 label' : `${reprintCount.toLocaleString()} labels`}. Progress won&apos;t change.</p>
                  : <p role="alert" className="text-sm text-amber-300">Enter label numbers from 1 to {total}, with &ldquo;To&rdquo; at or after &ldquo;From&rdquo;.</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleReprintRange()}
                    disabled={!reprintValid || !blanksOk || (!isSheetFormat && transport === 'office')}
                    className="btn btn-primary btn-sm"
                  >
                    <Printer className="w-4 h-4" aria-hidden="true" /> {isSheetFormat ? 'Open these labels to print' : `Reprint ${reprintCount === 1 ? '1 label' : `${reprintCount} labels`}`}
                  </button>
                  <button type="button" onClick={() => setReprintToDraft(String(total))} className="btn btn-ghost btn-sm" disabled={reprintToDraft === String(total)}>To the end</button>
                  <button type="button" onClick={() => setShowReprint(false)} className="btn btn-ghost btn-sm">Cancel</button>
                </div>
                {!isSheetFormat && reprintValid && reprintFrom <= printedCount && (
                  <button type="button" onClick={() => void handleReprintFromHereAndContinue()} className="btn btn-ghost btn-sm -ml-2 h-auto whitespace-normal py-2 text-left text-zinc-300">
                    Or go back to label {reprintFrom} and continue the run from there…
                  </button>
                )}
              </fieldset>
            )
          )}
          </>}
          {!isSheetFormat && transport === 'office' && <OfficePiPrinter run={run} template={template} format={format} runId={runId} total={total} connectionTarget={officeConnectionTarget} printAllowed={blanksOk} printedCount={printedCount} runStatus={run.status} requests={office.requests} jobs={office.jobs} summary={office.summary} requestsLoaded={office.loaded} requestsEverLoaded={office.everLoaded} requestsTruncated={office.truncated} requestsError={office.failed} refreshRequests={office.refresh} layoutWarnings={layoutWarnings} markRanges={status === 'running' ? [] : officeMark.ranges} onMarkPrinted={markOfficePrinted} onRecordPrinted={(ranges, note) => recordOfficePrinted(ranges, note ? `They printed (checked at the office). ${note}` : 'They printed (checked at the office)')} />}
        </section>
          </div>

          <div className="space-y-5">
        {/* Run summary: where each value comes from, and a live label preview. */}
        <section className="card card-flat p-4 sm:p-5 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="section-title">Label {Math.min(previewIndex + 1, Math.max(1, total))} data</h2>
            <span className="text-sm text-zinc-400 flex items-center gap-1.5">
              {(() => {
                const SourceIcon = runSourceMeta(run.dataSource).icon;
                return <SourceIcon className="w-4 h-4" aria-hidden="true" />;
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
                  {/* Where the value comes from is a hover detail, not a line of code under every row. */}
                  <dt className="font-medium text-zinc-300 truncate" title={`${fieldDisplayName(m.field)}: ${m.source}`}>{fieldDisplayName(m.field)}</dt>
                  <dd className="min-w-0">
                    <span className="block truncate text-zinc-100 tabular-nums" title={m.sample}>
                      {m.sample || <span className="text-amber-300">(empty)</span>}
                    </span>
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
                  <SquareDashed className="w-4 h-4" aria-hidden="true" />
                </button>
              {total > 0 && (
                <div className="flex items-center gap-1 text-sm">
                  <button
                    type="button"
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
                    type="button"
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
            <p className="text-xs text-zinc-400">This run keeps the design it started with.{run.designSnapshot?.legacy ? ' (Older run: the design was saved during an update, not when the run was made.)' : ''}</p>
          </div>
        </section>

        {eventsForRun.length > 0 && (
          <section className="px-1 space-y-2">
            <h2 className="section-title">Print history</h2>
            <ul className="space-y-1.5">
              {eventsForRun.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5).map((event) => (
                <li key={event.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-baseline gap-2 text-zinc-300">
                    <span aria-hidden="true" className={`size-1.5 shrink-0 translate-y-[-1px] rounded-full ${
                      event.eventType === 'confirmed' ? 'bg-emerald-400' :
                      event.eventType === 'failed' ? 'bg-red-400' :
                      event.eventType === 'cancelled' ? 'bg-amber-300' :
                      'bg-zinc-500'
                    }`} />
                    {printEventLabel(event)}
                  </span>
                  <span className="shrink-0 text-zinc-400 tabular-nums">{formatEventTime(event.createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
          </div>
        </div>
      </div>
    </div>

    {/* Save labels as a file */}
    <Dialog open={showExport} onClose={() => { if (!exporting) { setShowExport(false); } }} title="Save labels as a file" dismissible={!exporting}>
      <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-300">
        <span>Labels</span>
        <input
          aria-label="Save from label"
          type="number" min={1} max={total} value={exportFrom}
          onChange={(e) => setExportFrom(Math.max(1, parseInt(e.target.value, 10) || 1))}
          className="field w-24 tabular-nums"
        />
        <span aria-hidden="true">–</span>
        <input
          aria-label="Save to label"
          type="number" min={1} max={total} value={resolvedExportTo}
          onChange={(e) => setExportTo(Math.min(total, parseInt(e.target.value, 10) || total))}
          className="field w-24 tabular-nums"
        />
        <span className="text-zinc-400 tabular-nums">of {total}</span>
      </div>
      {(() => {
        const count = resolvedExportTo - exportFrom + 1;
        if (isSheetFormat) return <p className="text-sm text-zinc-400">Sheets open in a print page. Choose Save as PDF in the print dialog.</p>;
        if (exporting === 'pdf') return null;
        if (count > 500) return <p className="text-sm text-amber-300">Big ranges download as several PDFs of up to 500 labels. Your browser may ask to allow multiple downloads.</p>;
        if (count > 100) return <p className="text-sm text-zinc-400">{count} labels take about {Math.round(count * 0.1)} seconds.</p>;
        return null;
      })()}
      {!blanksOk && !isSheetFormat && <p className="text-sm text-amber-300">Saving is off until every label has a value.</p>}
      {exporting === 'pdf' && (
        <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden" role="progressbar" aria-label="Making the PDF" aria-valuemin={0} aria-valuemax={100} aria-valuenow={exportProgress}>
          <div className="h-full rounded-full bg-amber-500 transition-[width] duration-300 ease-in-out" style={{ width: `${exportProgress}%` }} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {isSheetFormat ? (
          <button type="button" onClick={() => { openSheetPrintRange({ from: exportFrom, to: resolvedExportTo }); setShowExport(false); }} className="btn btn-primary flex-1">
            <FileText className="w-4 h-4" aria-hidden="true" /> Open print page
          </button>
        ) : (
          <>
            <button type="button" onClick={() => void handleExportPDF()} disabled={!!exporting || !blanksOk} className="btn btn-primary flex-1">
              {exporting === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <FileText className="w-4 h-4" aria-hidden="true" />}
              PDF
            </button>
            <button type="button" onClick={() => void handleExportZPL()} disabled={!!exporting || !blanksOk} className="btn btn-secondary flex-1">
              {exporting === 'zpl' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <FileCode2 className="w-4 h-4" aria-hidden="true" />}
              Printer file
            </button>
          </>
        )}
      </div>
    </Dialog>

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
                    <label htmlFor={`edit-static-${field}`} className="text-sm text-zinc-300 w-28 shrink-0 truncate" title={field}>{fieldDisplayName(field)}</label>
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
                      <label htmlFor={`edit-source-${item.field}`} className="text-sm text-zinc-300 truncate" title={item.field}>{fieldDisplayName(item.field)}</label>
                      <span className="text-xs text-zinc-400 truncate">{item.source}</span>
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
              {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              onClick={() => setShowEdit(false)}
              disabled={saving}
              className="btn btn-secondary"
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
