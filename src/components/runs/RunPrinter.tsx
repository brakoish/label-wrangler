'use client';

import { canLeaveLocalPrint, officeSeriesActive, setLocalPrintRunning, stopOfficeSeries } from '@/lib/printNavigation';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Printer, Pause, Play, X, CheckCircle2, AlertCircle, Loader2, Plug, RotateCcw, FileSpreadsheet, Clipboard, SquareDashed, Pencil, PenTool, Copy, ScanBarcode, Download, FileText, FileCode2, Search, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { OfficePiPrinter } from './OfficePiPrinter';
import { BlankValueCheck } from './BlankValueCheck';
import { Dialog } from '@/components/ui/Dialog';
import { Recovery } from '@/components/ui/Recovery';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { lastRewindAt, REWIND_EVENT } from '@/lib/runRewind';
import { askCancelRun, cancelEvents, readOfficeJobs, stopProblem, stopWaitingAtOffice } from './officeCancel';
import { extendThrough, parseLabelList, firstUnsentLabel, officeLabelsIn, officeMarkPlan, officeUnsentSpans, officeWaitingSpans, skippedLabels, spanWords, statusAfterMarkPrinted, type OfficeSpan } from '@/lib/officeRange';
import { RunProgress, progressParts } from './RunProgress';
import { countedEventSpans, printedSpans, stillToGo } from '@/lib/runProgress';
import { groupPrintHistory } from '@/lib/printHistoryGroups';
import { useOfficeRequests, type OfficeJobBrief } from './useOfficeRequests';
import { useOfficeHeld } from './useOfficeHeld';
import { officeHoldsPrinter, officeSentLine, runDisplayStatus, runToneDot } from '@/lib/runDisplayStatus';
import { LAYOUT_GO_AHEAD, printCheckAllows, readPrintGoAhead, rememberPrintGoAhead, runPrintCheck, runSendCheck, type PrintGoAhead } from '@/lib/runLayoutCheck';
import { RunBarcodeCheck, rerunAfterFixHref } from './RunBarcodeCheck';
import { RawDetails } from './RawDetails';
import { QrReplaced, markQrFrom } from './QrReplaced';
import { plainServerError } from '@/lib/runErrors';
import { FixInDesignerLink } from '@/components/checks/BarcodeWarning';
import { barcodeItemTicked, barcodeSendTickLabel, barcodeTicksAllow, barcodeWaitWords, readRunBarcodeTicks, saveRunBarcodeTicks } from '@/lib/runBarcodeTicks';
import { drawFailureWords, plainJobReason } from '@/lib/officeSendOutcome';
import { checkRunPrinterCharacters, summarizePrinterCharacterIssues } from '@/lib/printerCharacters';
import { checkRunBitmapGlyphs, glyphStopWords } from '@/lib/runGlyphs';
import { checkRunBarcodes } from '@/lib/barcodeCheck';
import { runBarcodeFixes } from '@/lib/runBarcodeFix';
import { labelListWords, scannedLabelNumbers, scannedSkipPlan, type LabelSpan } from '@/lib/scannedLabels';
import { plainPrinterProblem } from '@/lib/printerWords';
import { fieldDisplayName } from '@/lib/fieldDisplayName';
import { columnSourceWords, runSourceWords } from '@/lib/fieldLabels';
import { choiceDialog, confirmDialog } from '@/components/ui/feedback';
import { blankCheckAllowsPrinting, checkRunData, hasBlankChoice, rememberBlankChoice } from '@/lib/runDataCheck';
import { friendlyError, friendlyRenderError, printEventLabel } from '@/lib/userMessages';
import { LabelOutlineOverlay } from '../LabelOutlineOverlay';
import { LayoutPreview } from '@/components/designer/LayoutPreview';
import type { LabelTemplate, LabelFormat, Run, RunPrintEvent, RunStatus } from '@/lib/types';
import { useRunStore } from '@/lib/runStore';
import { startPrintQueue, type RunQueueHandle } from '@/lib/printQueue';
import { dynamicFieldsForTemplate, generateLabelsForRunWithImages, previewLabelValues } from '@/lib/runBuilder';
import { feedRangeForLabels, labelRangeCount, normalizeLabelRange, planRunStart } from '@/lib/runRanges';
import { openInNewTab } from '@/lib/openTab';
import { updateRunWithQueue, flushOfflineQueue, pendingPatchCount, rewindPending, QUEUE_EVENT, REWIND_SETTLED_EVENT } from '@/lib/offlineQueue';
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

/** Where the run's values came from, in the same words as everywhere else (runSourceWords). */
function runSourceMeta(source: string) {
  const icon = source === 'csv' ? FileSpreadsheet : source === 'manifest' ? Search : source === 'manual' ? Pencil : Clipboard;
  return { label: runSourceWords(source).label, icon };
}

/** Saved on this device, not confirmed by the server yet: printing waits. Named after the banner's own button. */
const SYNC_WAIT_START = 'This run’s progress hasn’t reached the server yet, so nothing was printed. Press “Send now” at the top, then try again.';
const SYNC_WAIT_GO_BACK = 'Going back hasn’t reached the server yet, so nothing was printed. It tries again on its own, or press “Send now” at the top.';
const SYNC_WAITS: ReadonlySet<string> = new Set([SYNC_WAIT_START, SYNC_WAIT_GO_BACK]);
/** Another device printed on after a go-back this page asked for: one line, and the button to press. */
function movedOnWords(goBackTo: number, serverCount: number, total: number): string {
  return `Another device printed up to label ${serverCount.toLocaleString('en-US')} after you went back to label ${(goBackTo + 1).toLocaleString('en-US')}, so nothing was printed here.${serverCount < total ? ` Press “Resume from label ${(serverCount + 1).toLocaleString('en-US')}” to carry on.` : ''}`;
}

/** "Label 37 can’t print, so these labels can’t go yet. Press “Send labels 21–36” to send the ones before it." */
function sendStopWords(stopsHere: number[], before: { from: number; to: number } | null, verb: 'Send' | 'Print', after: { from: number; to: number } | null = null): string {
  if (!stopsHere.length || stopsHere.includes(0)) return '';
  const n = (x: number) => x.toLocaleString('en-US');
  const which = stopsHere.length === 1 ? `Label ${n(stopsHere[0])} can’t print` : `Labels ${stopsHere.slice(0, 3).map(n).join(', ')}${stopsHere.length > 3 ? ' and more' : ''} can’t print`;
  return before
    ? `${which}, so these labels can’t go yet. Press “${verb} labels ${n(before.from)}–${n(before.to)}” to ${verb.toLowerCase()} the ones before it, or fix it first.`
    : after
      ? `${which}, so these labels can’t go yet. Press “${verb} labels ${n(after.from)}–${n(after.to)}” to ${verb.toLowerCase()} the ones after it, or fix it first.`
      : `${which}, so these labels can’t go yet. Fix it first, or choose labels that leave it out.`;
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
  dazzle: { label: 'Printer on this computer', unavailable: 'Install and open the free Dazzle app on this computer to print here.' },
  webusb: { label: 'USB printer (Chrome)', unavailable: 'USB printing needs Chrome or Edge on a computer with the printer plugged in.' },
  office: { label: 'Office printer (remote)', unavailable: '' },
};



/**
 * Screen shown after a run is created and ready to print.
 * Resolves the transport (Dazzle preferred if running), then streams ZPL in
 * batches with a live progress bar, pause/resume, and cancel.
 */
export function RunPrinter({ runId, onDone }: RunPrinterProps) {
  const router = useRouter();
  const { runs, fetchRun, updateRun, setRunStatus, recordPrinted, printEvents, fetchPrintEvents, createPrintEvent, runLoadErrors } = useRunStore();
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
  // A go-back reached an earlier build of the server (a rollback): nothing was
  // changed, and only a reload brings this page up to date.
  const [reloadNeeded, setReloadNeeded] = useState(false);
  // The printer here stopped mid-run (out of labels, unplugged…): the header says so until the next start.
  const [printerStopped, setPrinterStopped] = useState(false);
  const [rewindNotice, setRewindNotice] = useState<string | null>(null);

  const total = run?.totalLabels ?? 0;
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
  // The one "which labels?" box, typed like the office printer's ("5–8").
  const [reprintText, setReprintText] = useState('1');
  const [reprintTextError, setReprintTextError] = useState('');
  const [reprinting, setReprinting] = useState<{ from: number; to: number; done: number; kind?: 'reprint' | 'only' } | null>(null);
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

  // Coming back to this tab: read the run once more (at most every 10 s), so
  // a count another device moved shows before anyone presses Go back or
  // Resume from an old number. Never while this page prints.
  useEffect(() => {
    let last = 0;
    const look = () => {
      if (document.visibilityState !== 'visible' || statusRef.current === 'running' || Date.now() - last < 10_000) return;
      // Progress this device hasn't saved yet would be shown lower: wait for it.
      if (pendingPatchCount(runId) > 0) return;
      last = Date.now();
      void fetchRun(runId).catch(() => { /* the page keeps what it has */ });
    };
    document.addEventListener('visibilitychange', look);
    window.addEventListener('focus', look);
    return () => { document.removeEventListener('visibilitychange', look); window.removeEventListener('focus', look); };
  }, [fetchRun, runId]);

  useEffect(() => {
    statusRef.current = status;
    setLocalPrintRunning(status === 'running' && transport !== 'office' && !isSheetFormat);
    const guard = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('a[href]') || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const href = event.target.closest('a[href]')?.getAttribute('href') ?? '';
      // A page of this app is opened in the app (no full reload, so no "Leave site?" box); anything else as a link.
      const leave = () => { if (href.startsWith('/') && !href.startsWith('//')) router.push(href); else window.location.assign(href); };
      if (!canLeaveLocalPrint(href && !href.startsWith('#') ? leave : undefined)) { event.preventDefault(); event.stopPropagation(); }
    };
    document.addEventListener('click', guard, true);
    return () => { setLocalPrintRunning(false); document.removeEventListener('click', guard, true); };
  }, [status, transport, isSheetFormat, router]);

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

  // A deliberate "Go back" that the server accepted: office work from before
  // it is no longer offered as "mark printed", so the offer can't undo the
  // rewind. Each accepted rewind is kept in the print history (a 'rewind'
  // event), so every device and the Runs list respect it too. That event
  // travels in the outbox with the go-back itself (setRunStatus), so it is
  // recorded even if this tab closes before sync, and only the server's
  // time is compared with the server's other times (never this device's
  // clock). While a go-back is still in this device's outbox, nothing from
  // the office is offered as "mark printed" at all.
  const [rewindWaiting, setRewindWaiting] = useState(false);
  useEffect(() => {
    // Earlier builds kept a stamp from this device's clock here.
    try { localStorage.removeItem(`lw:run-rewound:${runId}`); } catch { /* nothing to tidy */ }
    const check = () => setRewindWaiting(rewindPending(runId));
    const onEvent = (event: Event) => {
      const saved = (event as CustomEvent<RunPrintEvent | undefined>).detail;
      if (saved?.runId !== runId || saved.eventType !== REWIND_EVENT) return;
      // In the history before the outbox says it is done, so there is no gap.
      useRunStore.setState((state) => ({ printEvents: [saved, ...state.printEvents.filter((old) => old.id !== saved.id)] }));
    };
    check();
    window.addEventListener(QUEUE_EVENT, check);
    window.addEventListener('lw:event-synced', onEvent);
    return () => { window.removeEventListener(QUEUE_EVENT, check); window.removeEventListener('lw:event-synced', onEvent); };
  }, [runId]);
  // A go-back this page is sending right now settles in its own code path.
  const ownGoBack = useRef(false);
  /**
   * A go-back the server has now (a retry found it applied, or it went through
   * late): the page follows the server's count, drops "not synced" words and
   * says in one line when another device printed on since, with the button to
   * press. Its history entry arrives through the outbox (lw:event-synced).
   */
  const settleGoBack = useCallback(async (goBackTo: number, serverCount: number | null) => {
    if (statusRef.current === 'running') return;
    const fresh = await fetchRun(runId).catch(() => null);
    if (!mounted.current || (statusRef.current as PrinterUiStatus) === 'running') return;
    const now = fresh ? Number(fresh.printedCount ?? 0) : serverCount;
    setErrorMsg((prev) => (prev && SYNC_WAITS.has(prev) ? null : prev));
    if (typeof now !== 'number' || !Number.isFinite(now)) { setRewindNotice(null); return; }
    setPrintedCount(now);
    if (now > goBackTo) {
      clearRangeDrafts(); setStopAt(0); setStatus('paused');
      setRewindNotice(movedOnWords(goBackTo, now, fresh?.totalLabels ?? total));
    } else setRewindNotice(null);
    // The server still says "printing" from the go-back's start; nothing prints here now.
    if (fresh?.status === 'printing') { try { await setRunStatus(runId, 'paused', now); } catch { /* shown above already */ } }
  }, [fetchRun, runId, setRunStatus, total]);
  useEffect(() => {
    const onSettled = (event: Event) => {
      const detail = (event as CustomEvent<{ runId: string; goBackTo: number; printedCount: number | null } | undefined>).detail;
      if (!detail || detail.runId !== runId || ownGoBack.current) return;
      void settleGoBack(detail.goBackTo, detail.printedCount);
    };
    // Anything else saved here that reached the server: no "not synced" words left behind.
    const onQueue = () => { if (!pendingPatchCount(runId)) setErrorMsg((prev) => (prev && SYNC_WAITS.has(prev) ? null : prev)); };
    window.addEventListener(REWIND_SETTLED_EVENT, onSettled);
    window.addEventListener(QUEUE_EVENT, onQueue);
    return () => { window.removeEventListener(REWIND_SETTLED_EVENT, onSettled); window.removeEventListener(QUEUE_EVENT, onQueue); };
  }, [runId, settleGoBack]);
  const serverRewoundAt = useMemo(() => lastRewindAt(eventsForRun), [eventsForRun]);
  const rewoundAt = rewindWaiting ? Number.POSITIVE_INFINITY : serverRewoundAt;
  // Ranges people confirmed came out of the office printer (print history).
  const officeConfirmed = useMemo<OfficeSpan[]>(() => eventsForRun
    .filter((event) => event.eventType === 'confirmed' && event.output === 'office-pi' && Date.parse(event.createdAt) > rewoundAt)
    .map((event) => ({ from: event.rangeFrom, to: event.rangeTo })), [eventsForRun, rewoundAt]);
  // Every stretch the print history counts as printed beyond progress (confirmed office ranges, scanned labels).
  const countedSpans = useMemo(() => countedEventSpans(eventsForRun, run?.totalLabels ?? 0, rewoundAt), [eventsForRun, run?.totalLabels, rewoundAt]);
  // Labels printed one by one in scan mode (print history, any device).
  const scannedLabels = useMemo(() => scannedLabelNumbers(eventsForRun, run?.totalLabels ?? Infinity, rewoundAt), [eventsForRun, run?.totalLabels, rewoundAt]);
  // Labels printed here with "Print only 5–8" (progress unchanged), still ahead of
  // the progress: starting the run asks before printing them a second time.
  const printedOutOfOrder = useMemo(() => {
    const out = new Set<number>();
    for (const event of eventsForRun) {
      if (event.eventType !== 'sent' || event.output !== 'roll-zpl' || !/^Printed out of order/.test(event.message || '')) continue;
      if (Date.parse(event.createdAt) <= rewoundAt) continue;
      for (let n = Math.max(1, event.rangeFrom); n <= Math.min(run?.totalLabels ?? 0, event.rangeTo); n++) out.add(n);
    }
    return [...out];
  }, [eventsForRun, rewoundAt, run?.totalLabels]);

  // The office printer's work on this run, for display only. Office sends
  // never move the run's progress: "sent to the printer" isn't proof that a
  // label printed, so marking them printed is an explicit, confirmed step.
  const office = useOfficeRequests(runId, transport === 'office', total, { printedCount, printedSpans: officeConfirmed });
  // A paused or held office printer: queued labels wait, so the header says
  // "Waiting", never "Sending". The office panel knows its printer's status;
  // with another printer chosen, the station status is read while labels wait.
  // The panel also says which other run's part stops the shared printer.
  const [panelHold, setPanelHold] = useState<{ held: boolean; by: { runId: string; runName: string } | null }>({ held: false, by: null });
  const setPanelHeld = useCallback((held: boolean, by?: { runId: string; runName: string } | null) => {
    setPanelHold((prev) => (prev.held === held && prev.by?.runId === by?.runId && prev.by?.runName === by?.runName ? prev : { held, by: by ?? null }));
  }, []);
  const panelHeld = panelHold.held;
  const stationHeld = useOfficeHeld(transport !== 'office' && office.loaded && office.summary.onTheWay > 0);
  const officeHeld = transport === 'office' ? panelHeld : stationHeld;
  const officeHeldBy = transport === 'office' ? panelHold.by : null;
  // What the office panel says (a send it isn't sure arrived, a refused send,
  // a paused printer), so the header and the panel never disagree.
  type PanelState = { unsure: (OfficeSpan & { likely?: boolean; missing?: boolean; notYet?: boolean }) | null; refused: OfficeSpan | null; paused: boolean; sending: string | null; held?: OfficeSpan | null };
  const [panelState, setPanelState] = useState<PanelState>({ unsure: null, refused: null, paused: false, sending: null, held: null });
  const onPanelState = useCallback((next: PanelState) => {
    setPanelState((prev) => (prev.paused === next.paused && prev.sending === next.sending && prev.unsure?.from === next.unsure?.from && prev.unsure?.to === next.unsure?.to && prev.unsure?.likely === next.unsure?.likely && prev.unsure?.missing === next.unsure?.missing && prev.unsure?.notYet === next.unsure?.notYet && prev.refused?.from === next.refused?.from && prev.refused?.to === next.refused?.to && prev.held?.from === next.held?.from && prev.held?.to === next.held?.to ? prev : next));
  }, []);
  const panel: PanelState = transport === 'office' ? panelState : { unsure: null, refused: null, paused: false, sending: null, held: null };
  // The labels the office panel's main button sends next (for "Print anyway" words).
  const [officeSend, setOfficeSend] = useState<OfficeSpan | null>(null);
  // A range for the office panel's boxes (the barcode check's "Send labels A–B"), counted so the same range can be asked twice.
  const [officeRangeAsk, setOfficeRangeAsk] = useState<{ from: number; to: number; n: number } | null>(null);
  const onOfficeRange = useCallback((span: OfficeSpan | null) => {
    setOfficeSend((prev) => (prev?.from === span?.from && prev?.to === span?.to ? prev : span));
  }, []);
  // Every stretch the office reported sent and nobody counted yet.
  const officeMark = useMemo(() => {
    // Each job carries its send's time, for every send of the run (not only
    // the latest 100 listed), so this matches what the Runs list offers.
    const jobs = rewoundAt ? office.jobs.filter((job) => !!job.requestAt && Date.parse(job.requestAt) > rewoundAt) : office.jobs;
    return officeMarkPlan(printedCount, jobs, officeConfirmed, total);
  }, [office.jobs, officeConfirmed, printedCount, total, rewoundAt]);
  const uncheckedLabels = officeMark.ranges.reduce((n, r) => n + r.to - r.from + 1, 0);
  // Labels after progress that no office send covers: what is still to send (the same rule as the Runs list).
  const stillToSend = office.loaded && office.jobs.length > 0 ? officeUnsentSpans(office.jobs, total, printedCount).reduce((n, s) => n + s.to - s.from + 1, 0) : 0;
  const officeSummary = (office.loaded && office.jobs.length > 0) || officeHeldBy || panel.unsure || panel.refused || panel.paused || panel.sending || panel.held
    ? { heldBy: officeHeldBy, sent: office.summary.sent, onTheWay: office.summary.onTheWay, failed: office.summary.failed.length, failedLabels: office.summary.failedLabels, firstFailed: office.summary.failed[0], held: officeHeld,
      unchecked: uncheckedLabels, unsure: panel.unsure, refused: panel.refused, printerPaused: panel.paused, sending: panel.sending, stillToSend, heldBack: panel.held ?? null }
    : null;
  // Labels at or sent to the office printer that nobody counted yet: the lighter part of the progress bar,
  // named apart ("sent to the printer", "waiting at the office") like the office panel names them.
  // Labels on their way are named once: by the office panel's line, or (another printer chosen) the
  // "Sent to office printer" line; only a paused office printer leaves the count to the progress line.
  const waitingSpans = useMemo<OfficeSpan[]>(() => (office.loaded ? officeWaitingSpans(office.jobs, total) : []), [office.loaded, office.jobs, total]);
  const allWithOffice = !!officeSummary && printedCount < total && firstUnsentLabel(office.jobs, total, printedCount) === null;
  // Print history follows the office: every move re-reads it.
  const officeSignature = office.signature;
  useEffect(() => { if (officeSignature) void fetchPrintEvents(runId); }, [officeSignature, fetchPrintEvents, runId]);
  const [markNotice, setMarkNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  // "Labels 41–50 marked printed." is news for a moment: it goes after about
  // 8 s, and at once when the panel starts a send or has something new to say.
  useEffect(() => {
    if (markNotice?.tone !== 'ok') return;
    const timer = setTimeout(() => setMarkNotice((current) => (current === markNotice ? null : current)), 8000);
    return () => clearTimeout(timer);
  }, [markNotice]);
  const panelNews = !!(panelState.sending || panelState.unsure || panelState.refused);
  useEffect(() => { if (panelNews) setMarkNotice(null); }, [panelNews]);

  // The same check the wizard does, before any print or office send: barcodes
  // the printer would cut off (shown first, with the fix, and an explicit
  // go-ahead), barcodes close to the edge, and items that overlap. Checked on
  // every label (up to 2,000). Keyed on what changes printed labels, not
  // progress. The go-ahead is kept on this device for these exact problems.
  const printCheck = useMemo(
    () => runPrintCheck(run, template, format),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run?.id, run?.sourceData, run?.fieldMappings, run?.staticValues, run?.mappedField, run?.totalLabels, run?.dataSource, template, format],
  );
  // The wizard's "Use a QR code instead", for a barcode too long for this
  // label: offered here too (a run keeps its design, so it leads to a new run
  // with the same data, where the switch is made), only when a QR code of the
  // same value fits every label.
  const qrFixFits = useMemo(() => {
    if (!run || !template || !format || format.type !== 'thermal' || !printCheck.blocking.length || printCheck.verdict.stops) return false;
    const rows = Math.min(Math.max(1, run.totalLabels || run.sourceData.length || 1), 2000);
    const data = { sourceData: run.sourceData.slice(0, rows), fieldMappings: run.fieldMappings, staticValues: run.staticValues, mappedField: run.mappedField };
    const found = checkRunBarcodes(template, data, format);
    if (!found.issues.some((issue) => issue.kind === 'too-long')) return false;
    return !!runBarcodeFixes(template, data, format, found.issues, rows)?.qr;
  }, [run, template, format, printCheck]);
  // Text the thermal printer can't print ("·", accents): named on every view of the run, done runs included.
  const characterWarning = useMemo(() => {
    if (!run || !template) return null;
    const result = checkRunPrinterCharacters(template, format, { sourceData: run.sourceData ?? [], fieldMappings: run.fieldMappings, staticValues: run.staticValues, mappedField: run.mappedField });
    if (!result.issues.length) return null;
    const fromSheet = (field: string) => run.fieldMappings?.[field]?.mode === 'column' || (!!run.mappedField && run.mappedField === field);
    const { items, more } = summarizePrinterCharacterIssues(result.issues, fromSheet);
    const chars = [...new Set(result.issues.flatMap((issue) => issue.chars))];
    return { heading: `${result.badLabels.toLocaleString()} label${result.badLabels === 1 ? ' has' : 's have'} characters the printer can’t print`, items, more, chars, badLabels: result.badLabels };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, run?.sourceData, run?.fieldMappings, run?.staticValues, run?.mappedField, template, format]);
  // The characters by name, and what the printer puts in their place: a box.
  const characterNames = (() => {
    if (!characterWarning) return '';
    const names = characterWarning.chars.slice(0, 3).map((ch) => ch === '\t' ? 'a tab' : /\s/.test(ch) ? 'an odd space' : `“${ch}”`);
    return `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? ''}${characterWarning.chars.length > 3 ? ' and others' : ''}`;
  })();
  const characterBoxes = characterWarning && characterWarning.chars.length > 1 ? 'boxes' : 'a box';
  const characterLabels = characterWarning ? `${characterWarning.badLabels.toLocaleString('en-US')} label${characterWarning.badLabels === 1 ? '' : 's'}` : '';
  const characterNote = characterWarning ? `${characterLabels.replace(/^./, (c) => c.toUpperCase())} will print ${characterBoxes} where ${characterNames} should be. Everything else prints as it is.` : '';
  const [goAhead, setGoAhead] = useState<PrintGoAhead>({});
  useEffect(() => { setGoAhead(readPrintGoAhead(typeof window !== 'undefined' ? window.localStorage : null, runId)); }, [runId]);
  const chooseGoAhead = (part: keyof PrintGoAhead, key: string | false) => setGoAhead((current) => {
    const next = { ...current, [part]: key || undefined };
    rememberPrintGoAhead(typeof window !== 'undefined' ? window.localStorage : null, runId, next);
    return next;
  });
  // One tick per barcode problem, kept on this device. A go-ahead from the
  // new-run wizard covers the milder ones, never a barcode that spoils the next label.
  const [barcodeTicks, setBarcodeTicks] = useState<string[]>([]);
  // "Print some labels again…" on a finished run's summary.
  const [woken, setWoken] = useState(false);
  const [officeChooser, setOfficeChooser] = useState(0);
  useEffect(() => { setBarcodeTicks(readRunBarcodeTicks(typeof window !== 'undefined' ? window.localStorage : null, runId)); }, [runId]);
  // The labels the next print or send covers: the office panel's range, else the From/To boxes.
  const tickSend = transport === 'office' && !isSheetFormat ? officeSend : rangeValid ? { from: selectedFrom, to: selectedThrough } : null;
  // The check narrowed to those labels: a barcode the exact renderer refuses
  // stops only the sends that include it, and a send past the first 2,000
  // labels is checked itself. Deferred, so typing a range stays quick.
  const checkFrom = useDeferredValue(tickSend?.from ?? 0);
  const checkTo = useDeferredValue(tickSend?.to ?? 0);
  // Labels the person chose to leave out of office sends because they can't
  // print (the exact renderer refuses them): sends go around them. This page only.
  const [leftOut, setLeftOut] = useState<{ runId: string; labels: number[] }>({ runId: '', labels: [] });
  const officeSkip = useMemo(() => (leftOut.runId === runId && transport === 'office' && !isSheetFormat ? leftOut.labels : []), [leftOut, runId, transport, isSheetFormat]);
  const sendCheck = useMemo(
    () => runSendCheck(printCheck, run, template, format, checkFrom && checkTo ? { from: checkFrom, to: checkTo } : null, 2000, officeSkip),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [printCheck, checkFrom, checkTo, template, format, officeSkip],
  );
  const shownCheck = sendCheck.check;
  // Text a picture (bitmap) design can't draw: the renderer refuses it, so
  // the labels that have it can't print (never a note that fails after the tap).
  const glyphCheck = useMemo(
    () => (run && template ? checkRunBitmapGlyphs(template, format, { sourceData: run.sourceData ?? [], fieldMappings: run.fieldMappings, staticValues: run.staticValues, mappedField: run.mappedField }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run?.id, run?.sourceData, run?.fieldMappings, run?.staticValues, run?.mappedField, template, format],
  );
  const glyphFrom = tickSend?.from ?? 0;
  const glyphTo = tickSend?.to ?? 0;
  const glyphHere = useMemo(() => {
    const labels = glyphCheck?.labels ?? [];
    if (!labels.length) return [];
    if (labels.includes(0)) return [0];
    return labels.filter((label) => (!glyphFrom || (label >= glyphFrom && label <= glyphTo)) && !officeSkip.includes(label));
  }, [glyphCheck, glyphFrom, glyphTo, officeSkip]);
  const glyphStop = glyphCheck && glyphHere.length
    ? glyphStopWords(glyphCheck, glyphHere, (field) => run?.dataSource === 'csv' && run?.fieldMappings?.[field]?.mode === 'column')
    : '';
  // The wizard's go-ahead for these exact problems carries over (RunBarcodeCheck says so beside the tick).
  const wizardBarcodeGoAhead = !!shownCheck.blocking.length && shownCheck.verdict.carriesOver && goAhead.barcode === shownCheck.blockingKey;
  const barcodeOk = barcodeTicksAllow(shownCheck.blocking, barcodeTicks, wizardBarcodeGoAhead);
  const tickBarcode = (item: string, value: boolean) => setBarcodeTicks((current) => {
    // Once someone ticks here, every problem's tick is its own.
    const explicit = shownCheck.blocking.filter((problem) => problem === item ? value : barcodeItemTicked(problem, current, wizardBarcodeGoAhead));
    saveRunBarcodeTicks(typeof window !== 'undefined' ? window.localStorage : null, runId, explicit);
    chooseGoAhead('barcode', shownCheck.blocking.every((problem) => explicit.includes(problem)) && shownCheck.blockingKey);
    return explicit;
  });
  // Until the deferred check has caught up with the range, nothing new goes.
  const checkCurrent = (tickSend?.from ?? 0) === checkFrom && (tickSend?.to ?? 0) === checkTo;
  const checksOk = checkCurrent && !glyphStop && printCheckAllows(shownCheck, { ...goAhead, barcode: barcodeOk ? shownCheck.blockingKey : undefined });
  const stopWords = sendStopWords(sendCheck.stopsHere, sendCheck.before, transport === 'office' && !isSheetFormat ? 'Send' : 'Print', sendCheck.after);
  const checksReason = checksOk ? '' : !checkCurrent ? 'Checking these labels…' : glyphStop ? glyphStop : shownCheck.blocking.length && (shownCheck.verdict.stops || !barcodeOk)
    ? (shownCheck.verdict.stops ? (stopWords || shownCheck.verdict.waitReason) : barcodeWaitWords(false, shownCheck.blocking.length, barcodeSendTickLabel(shownCheck.blocking[0], tickSend, total)))
    : `Some items overlap or run off the label. Check the preview, then tick “${LAYOUT_GO_AHEAD}” above.`;

  // Open the preview at the next label to print, once per run.
  const previewStarted = useRef('');
  useEffect(() => {
    if (!run || previewStarted.current === run.id) return;
    previewStarted.current = run.id;
    setPreviewIndex(Math.max(0, Math.min(run.totalLabels - 1, run.printedCount ?? 0)));
  }, [run]);
  // The preview follows the labels the office panel sends next (its range
  // boxes, or "Which labels didn't come out?"), so the person sees the first
  // of the labels they typed.
  const officeSendFrom = officeSend?.from;
  useEffect(() => {
    if (officeSendFrom === undefined || !Number.isInteger(officeSendFrom) || officeSendFrom < 1 || officeSendFrom > total) return;
    setPreviewIndex(officeSendFrom - 1);
  }, [officeSendFrom, total]);

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
  // Whether this account can change the run's data (null until read). A
  // print-only account can't fill in a blank value, so it is told who can.
  const [canEdit, setCanEdit] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    fetch('/api/office/session', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (active && d?.user) setCanEdit(d.user.can_edit === true); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const blankNeedsEditor = canEdit === false && !!blankCheck && blankCheck.issues.length > 0 && !blankCheck.canLeaveBlank;
  const blankFields = blankCheck ? [...new Set(blankCheck.issues.map((issue) => fieldDisplayName(issue.field)))] : [];
  const blankFieldWords = blankFields.length <= 1 ? (blankFields[0] ?? '') : `${blankFields.slice(0, -1).join(', ')} and ${blankFields[blankFields.length - 1]}`;
  const blankEditorRemedy = blankNeedsEditor ? `Ask someone who can edit runs to fill in ${blankFieldWords}. Your account can print, but can’t change this run’s data.` : undefined;
  const canStart = blanksOk && checksOk && !reprinting && !sending && !!run && run.sourceData.length > 0 && (
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
    return templateFields.flatMap<EditSourceField>((field) => {
      const mapping = run.fieldMappings?.[field];
      if (mapping?.mode === 'column' && mapping.csvColumn) {
        return [{
          field,
          source: columnSourceWords(run.dataSource, mapping.csvColumn).text,
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
          source: columnSourceWords(run.dataSource, col).text,
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
              setPrinterStatusMessage(plainPrinterProblem(printerStatus.summary));
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

  /** fromOverride: start from this label instead of the From box ("Start at 1 instead" starts right away). */
  const startOrResume = async (fromOverride?: number) => {
    if (!run || !template || !format || starting.current || sending || statusRef.current === 'running') return;
    starting.current = true;
    const startFrom = typeof fromOverride === 'number' ? fromOverride : selectedFrom;
    try {
    setPrinterStopped(false);
    if (!rangeValid) { setErrorMsg(`Enter a whole-number range between 1 and ${total}.`); return; }
    if (!blanksOk) { setErrorMsg('Some labels are missing a value. Fix the data (see above) before printing.'); return; }
    if (!checksOk) { setErrorMsg(checksReason); return; }
    setErrorMsg(null);
    if (pendingPatchCount(run.id)) { await flushOfflineQueue(); if (pendingPatchCount(run.id)) { setErrorMsg(SYNC_WAIT_START); return; } }
    setRewindNotice(null);
    // A From at or below what is already printed moves the run back, the same
    // as "Go back to label N". Without the explicit rewind the server would
    // keep the higher count and the next Resume would skip labels.
    const plan = planRunStart(printedCount, startFrom);
    // Starting after the next unprinted label would count the labels in
    // between as printed, because progress is "printed up to label N".
    const skipped = plan.rewind ? null : skippedLabels(printedCount, startFrom);
    if (skipped) {
      // The safe choice is the primary button; closing the dialog starts
      // nothing. Labels are only counted as printed when the person says
      // they did print.
      const one = skipped.from === skipped.to;
      const gap = one ? `label ${skipped.from}` : `labels ${skipped.from}–${skipped.to}`;
      const only = startFrom === selectedThrough ? `${startFrom}` : `${startFrom}\u2060–\u2060${selectedThrough}`;
      const choice = await choiceDialog({
        title: `${gap.charAt(0).toUpperCase()}${gap.slice(1)} ${one ? 'isn’t' : 'aren’t'} counted as printed yet`,
        body: `The next label to print is ${skipped.from}. Start there, or print only ${startFrom === selectedThrough ? 'label' : 'labels'} ${only} now and leave the run’s progress as it is.`,
        confirmLabel: `Start at ${skipped.from} instead`,
        altLabel: `Print only ${only}`,
        extraLabel: `${one ? 'It' : 'They'} already printed…`,
        cancelAlso: true,
      });
      // Starts right away from the next label to print (the press was the ask).
      if (choice === 'confirm') { setFromDraft(String(skipped.from)); setCountDraft(null); starting.current = false; await startOrResume(skipped.from); return; }
      // Printed apart from the run (its own guard against a second start).
      if (choice === 'alt') { starting.current = false; await handleReprintRange({ from: startFrom, to: selectedThrough }, 'only'); return; }
      if (choice !== 'extra') return;
      const printedThem = await confirmDialog({
        title: `Did ${gap} print?`,
        body: `Only say yes if ${one ? 'it came' : 'they came'} out of a printer. ${one ? 'It is' : 'They are'} then counted as printed, and printing starts at ${startFrom}.`,
        confirmLabel: `Yes, ${one ? 'it' : 'they'} printed`,
        cancelLabel: 'No',
        focusCancel: true,
      });
      if (!printedThem) return;
    }
    // A range that is all printed already ("3–4" after printing 1–8) prints
    // those labels again and leaves the run's progress alone, like the office
    // panel: going back would make labels 5–8 print a second time on Resume.
    if (plan.rewind && selectedThrough <= printedCount) {
      const one = startFrom === selectedThrough;
      const which = one ? `label ${startFrom.toLocaleString('en-US')}` : `labels ${startFrom.toLocaleString('en-US')}–${selectedThrough.toLocaleString('en-US')}`;
      const ok = await confirmDialog({
        title: `Print ${which} again?`,
        body: `${one ? 'It was' : 'They were'} already printed, so ${one ? 'it prints' : 'they print'} a second time. The run’s progress stays at ${printedCount.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}.`,
        confirmLabel: `Print ${one ? startFrom.toLocaleString('en-US') : `${startFrom.toLocaleString('en-US')}\u2060–\u2060${selectedThrough.toLocaleString('en-US')}`} again`,
      });
      if (!ok) return;
      starting.current = false;
      await handleReprintRange({ from: startFrom, to: selectedThrough }, 'reprint');
      return;
    }
    // Labels the office printer already has: printing them here too is a
    // choice, not a surprise.
    const atOffice = officeLabelsIn(office.jobs, startFrom, selectedThrough);
    if (atOffice) {
      const one = atOffice.from === atOffice.to;
      const ok = await confirmDialog({
        title: `Print ${one ? `label ${atOffice.from}` : `labels ${atOffice.from}–${atOffice.to}`} here too?`,
        body: `${one ? `Label ${atOffice.from} was` : `Labels ${atOffice.from}–${atOffice.to} were`} ${atOffice.sent ? 'already sent to' : 'already queued for'} the office printer. Printing here prints ${one ? 'it' : 'them'} a second time.`,
        confirmLabel: 'Print here too',
      });
      if (!ok) return;
    }
    // Labels printed one by one in scan mode would come out twice: skipping
    // them is the primary button, and they still count as printed.
    let pieces: LabelSpan[] | null = null;
    // Labels printed out of order here ("Print only 5–8") are asked about the same way.
    const outOfOrder = printedOutOfOrder.filter((n) => n > printedCount);
    // Office ranges a person confirmed came out are printed too, wherever they sit.
    const confirmedHere: number[] = [];
    for (const span of officeConfirmed) for (let n = Math.max(startFrom, span.from, printedCount + 1); n <= Math.min(selectedThrough, span.to); n++) confirmedHere.push(n);
    const scanned = scannedSkipPlan(startFrom, selectedThrough, [...new Set([...scannedLabels, ...outOfOrder, ...confirmedHere])].sort((a, b) => a - b));
    if (scanned.skipped.length) {
      const words = labelListWords(scanned.skipped);
      const one = scanned.skipped.length === 1;
      const byScan = scanned.skipped.every((n) => scannedLabels.includes(n));
      const byOnly = scanned.skipped.every((n) => outOfOrder.includes(n));
      const byOffice = scanned.skipped.every((n) => confirmedHere.includes(n));
      const how = byScan ? 'already printed by scanning' : byOnly ? `already printed with “Print only”` : byOffice ? 'already printed on the office printer' : 'already printed';
      const choice = await choiceDialog({
        title: `${words.charAt(0).toUpperCase()}${words.slice(1)} ${one ? 'was' : 'were'} ${how}`,
        body: scanned.keep.length
          ? `Printing labels ${startFrom}–${selectedThrough} prints ${one ? 'it' : 'them'} a second time. Skipping leaves ${one ? 'it' : 'them'} out; ${one ? 'it still counts' : 'they still count'} as printed.`
          : `Every label from ${startFrom} to ${selectedThrough} was ${byScan ? 'printed by scanning' : 'already printed'}. Printing ${one ? 'it' : 'them'} again makes a second copy.`,
        confirmLabel: scanned.keep.length ? `Skip ${one ? 'it' : 'them'}` : 'Don’t print',
        altLabel: 'Print them again',
      });
      if (choice === null) return;
      if (choice === 'confirm') { if (!scanned.keep.length) return; pieces = scanned.keep; }
    }
    if (plan.rewind) {
      // The labels that print twice, named: from the From box up to what is already printed.
      const twiceTo = Math.min(printedCount, selectedThrough);
      const twiceOne = twiceTo === startFrom;
      const twice = twiceOne ? `Label ${startFrom.toLocaleString('en-US')} was` : `Labels ${startFrom.toLocaleString('en-US')}–${twiceTo.toLocaleString('en-US')} were`;
      const ok = await confirmDialog({
        title: `Go back to label ${startFrom} and continue?`,
        body: `${twice} already printed, so ${twiceOne ? 'it prints' : 'they print'} a second time. The run’s progress goes back to ${plan.startCount} of ${total}, then labels ${startFrom}–${selectedThrough} print. To print a few labels again without changing progress, use “Print some labels again…” instead.`,
        confirmLabel: `Go back to label ${startFrom}`,
      });
      if (!ok) { setFromDraft(null); setCountDraft(null); return; }
      setPrintedCount(plan.startCount);
    }
    const startCount = plan.startCount;
    setStatus('running');
    const controller = new AbortController();
    preparation.current = controller;
    const refusedStart = { reason: '', reload: false };
    let started: Awaited<ReturnType<typeof setRunStatus>> = null;
    // A go-back whose first answer was lost and that the server already had.
    const applied: { server?: number | null } = {};
    ownGoBack.current = plan.rewind;
    try { started = await setRunStatus(run.id, 'printing', startCount, { resetProgress: plan.rewind, ...(plan.rewind ? { expectedPrintedCount: printedCount } : {}), onSetAside: (reason, kind) => { refusedStart.reason = reason; refusedStart.reload = kind === 'needs-reload'; }, onAlreadyApplied: (server) => { applied.server = server; } }); }
    catch(error) { setStatus('paused'); setErrorMsg((error as Error).message); return; }
    finally { ownGoBack.current = false; }
    if (refusedStart.reason && refusedStart.reload) { setStatus('paused'); setPrintedCount(printedCount); setReloadNeeded(true); return; }
    // A go-back says only why it wasn't applied (nothing printed or started); a start says it didn't start.
    if (refusedStart.reason) { setStatus('paused'); setErrorMsg(plan.rewind ? refusedStart.reason : `Printing didn’t start, so nothing was printed. ${refusedStart.reason}`); const fresh = await fetchRun(run.id).catch(() => null); if (fresh && mounted.current) setPrintedCount(fresh.printedCount ?? 0); return; }
    if (pendingPatchCount(run.id)) { setStatus('paused'); setErrorMsg(plan.rewind ? SYNC_WAIT_GO_BACK : SYNC_WAIT_START); return; }
    // Already applied: the screen may be behind the server (another device
    // printed on meanwhile). Nothing prints from a stale count.
    if (plan.rewind && 'server' in applied) {
      const fresh = await fetchRun(run.id).catch(() => null);
      const now = fresh ? Number(fresh.printedCount ?? 0) : applied.server;
      if (now === null || now === undefined || now !== startCount) {
        setStatus('paused');
        if (typeof now === 'number') { setPrintedCount(now); clearRangeDrafts(); setStopAt(0); setRewindNotice(now > startCount ? movedOnWords(startCount, now, total) : null); }
        if (typeof now === 'number') { try { await setRunStatus(run.id, 'paused', now); } catch { /* the count above is still right */ } }
        return;
      }
    }
    // The server keeps the highest progress any device saved. If it is ahead
    // of this screen, another device printed meanwhile: nothing prints here
    // until the person has looked, so no label comes out twice.
    const serverCount = Number(started?.printedCount);
    if (!plan.rewind && Number.isFinite(serverCount) && serverCount > startCount) {
      setStatus('paused'); setPrintedCount(serverCount); clearRangeDrafts(); setStopAt(0);
      setErrorMsg(`Another device already printed up to label ${serverCount.toLocaleString('en-US')}, so nothing was printed here.${serverCount < total ? ` Press “Resume from label ${(serverCount + 1).toLocaleString('en-US')}” to carry on.` : ''}`);
      try { await setRunStatus(run.id, 'paused', serverCount); } catch { /* the count above is still right */ }
      return;
    }
    if (!mounted.current || controller.signal.aborted) return;

    const sender = makeSender(controller);

    const printRange = normalizeLabelRange({
      total,
      from: startFrom,
      to: selectedThrough,
    });
    // The queue tracks feeds internally (startIndex/done are feed counts).
    // We convert between physical-label count (what the user + DB see) and
    // feed count (what the queue consumes) at the boundary so multi-across
    // progress bars behave intuitively.
    const { startFeed, stopFeed } = feedRangeForLabels(printRange, across);
    void stopFeed;
    let labelsToSend: string[];
    // With scanned labels skipped, each feed remembers the label it ends on.
    let feedEnds: number[] | null = null;
    try {
      if (pieces) {
        const all: string[] = []; const ends: number[] = [];
        for (const piece of pieces) {
          const feeds = await generateLabelsForRunWithImages(run, template, format, piece, { signal: controller.signal });
          const first = feedRangeForLabels(piece, across).startFeed;
          feeds.forEach((feed, k) => { all.push(feed); ends.push(Math.min((first + k + 1) * across, piece.to)); });
        }
        labelsToSend = all; feedEnds = ends;
      } else labelsToSend = await generateLabelsForRunWithImages(run, template, format, printRange, { signal: controller.signal });
    }
    catch (error) { if (controller.signal.aborted) return; setStatus('error'); setErrorMsg(drawFailureWords(error, printRange) ?? (error instanceof Error ? error.message : 'Render failed')); await setRunStatus(run.id, 'paused', startCount); return; }
    if (!mounted.current || controller.signal.aborted) return;
    const handle = startPrintQueue(sender, {
      labels: labelsToSend,
      batchSize: 25,
      delayBetweenBatchesMs: 0,
      startIndex: 0,
      onProgress: async (feedsDone) => {
        // Each feed produced up to `across` physical labels. Clamp to total
        // so the last (possibly-partial) feed doesn't overshoot.
        const physical = feedEnds
          ? (feedsDone >= feedEnds.length ? printRange.to : feedsDone > 0 ? feedEnds[feedsDone - 1] : printRange.from - 1)
          : Math.min((startFeed + feedsDone) * across, printRange.to);
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
            message: scanned.skipped.length && pieces ? `Skipped ${labelListWords(scanned.skipped)} (${scanned.skipped.every((n) => scannedLabels.includes(n)) ? 'printed by scanning' : 'already printed'})` : null,
          });
        }
      },
      onError: async (err, atFeed) => {
        setStatus('error');
        setPrinterStopped(true);
        setErrorMsg((err as Error)?.message || 'Print failed');
        // Persist physical-label count corresponding to the failed feed.
        const atPhysical = feedEnds
          ? (atFeed > 0 ? feedEnds[Math.min(atFeed, feedEnds.length) - 1] : printRange.from - 1)
          : Math.max(printRange.from - 1, Math.min((startFeed + atFeed) * across, printRange.to));
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
    // A "Send all in parts" going on here stops first, so no part is sent
    // after the run is cancelled.
    if (officeSeriesActive()) {
      const stop = await confirmDialog({ title: 'Stop sending parts first?', body: 'Parts are still going to the office printer. Sending stops after the part on its way now, then you can choose what happens to the run.', confirmLabel: 'Stop sending', cancelLabel: 'Keep sending' });
      if (!stop) return;
      await stopOfficeSeries();
    }
    // Labels still waiting at the office can be stopped with the run, or left
    // to print: the person chooses, and the history says what really happened.
    // Read fresh, so a page that just opened (or a slow connection) still
    // offers the stop; an account that can't see the office has nothing there.
    const fresh = run ? await readOfficeJobs(run.id) : null;
    const denied = office.failed?.status === 401 || office.failed?.status === 403;
    const jobs = fresh ?? (denied ? [] : null);
    const choice = await askCancelRun({ title: 'Cancel this run?', jobs, total, after: 'You can start a new run from the same data with Re-run.' });
    if (choice) await handleCancel(choice === 'stop', jobs);
  };

  const handleCancel = async (stopAtOffice = false, known: OfficeJobBrief[] | null = office.loaded ? office.jobs : null) => {
    preparation.current?.abort();
    queueRef.current?.cancel();
    setStatus('cancelled');
    if (run) {
      await setRunStatus(run.id, 'cancelled', printedCount);
      let jobs: OfficeJobBrief[] | null = known;
      let stoppedJobIds = new Set<string>();
      if (stopAtOffice) {
        const result = await stopWaitingAtOffice(run.id, jobs);
        stoppedJobIds = result.stoppedJobIds;
        jobs = result.jobs ?? jobs;
        const problem = stopProblem(result);
        if (problem) setErrorMsg(problem);
        void office.refresh().catch(() => { /* shown by the panel */ });
      }
      const end = stopAt > 0 ? Math.min(stopAt, total) : total;
      const events = cancelEvents({
        printedCount, end, jobs: jobs ?? [], stoppedJobIds, scanned: scannedLabels, confirmed: officeConfirmed,
        output: isSheetFormat ? 'sheet-pdf' : transport === 'office' ? 'office-pi' : 'roll-zpl',
        printerName: transport === 'dazzle' ? dazzleSelected : transport === 'office' ? 'Office printer' : usbPrinter?.productName ?? null,
      });
      // Without the office queue, labels still at the office can't be told
      // apart: the history names only what was stopped, never "not printed".
      for (const event of events) if (jobs || event.message !== 'Run cancelled') await createPrintEvent(run.id, event);
    }
  };

  const reprintFrom = Number(reprintFromDraft);
  const reprintTo = Number(reprintToDraft);
  const reprintValid = Number.isInteger(reprintFrom) && Number.isInteger(reprintTo) && reprintFrom >= 1 && reprintTo >= reprintFrom && reprintTo <= total;
  const reprintCount = reprintValid ? reprintTo - reprintFrom + 1 : 0;
  const setReprintSpan = (from: number, to: number) => {
    setReprintFromDraft(String(from));
    setReprintToDraft(String(to));
    setReprintText(from === to ? String(from) : `${from}–${to}`);
    setReprintTextError('');
  };
  const openReprint = (from: number, to: number) => {
    setReprintSpan(from, to);
    setShowReprint(true);
  };
  const typeReprint = (text: string) => {
    setReprintText(text);
    const parsed = parseLabelList(text, total);
    const one = !parsed.error && parsed.spans.length === 1 ? parsed.spans[0] : null;
    setReprintFromDraft(one ? String(one.from) : '');
    setReprintToDraft(one ? String(one.to) : '');
    // Show the first of the labels typed.
    if (one && one.from <= total) setPreviewIndex(one.from - 1);
    setReprintTextError(parsed.error || (parsed.spans.length > 1 ? 'Type one stretch, like 5–8. Print the others after.' : ''));
  };

  // Reprint exactly From..To (e.g. a jammed strip). This is a separate job:
  // it never rewinds or changes the run's progress or status, and it is
  // logged in the print history as a reprint.
  /**
   * Prints a range without touching the run's progress: a reprint, or
   * ('only') labels picked out of order from the start form.
   */
  const handleReprintRange = async (chosen?: { from: number; to: number }, kind: 'reprint' | 'only' = 'reprint') => {
    if (!run || !template || !format || (!chosen && !reprintValid) || reprinting || statusRef.current === 'running' || starting.current) return;
    if (!blanksOk) { setErrorMsg('Some labels are missing a value. Fix the data (see above) before printing.'); return; }
    if (!checksOk) { setErrorMsg(checksReason); return; }
    const range = chosen ?? { from: reprintFrom, to: reprintTo };
    // The check above covers the range boxes; these labels get their own look for a label that can't print.
    const own = runSendCheck(printCheck, run, template, format, range);
    if (own.stopsHere.length) { setErrorMsg(sendStopWords(own.stopsHere, own.before, 'Print', own.after) || own.check.verdict.waitReason); return; }
    const message = kind === 'only' ? 'Printed out of order (run progress unchanged)' : 'Reprint (run progress unchanged)';
    setErrorMsg(null);
    if (isSheetFormat) {
      if (!openInNewTab(sheetPrintHref(range))) { setErrorMsg('Popup blocked. Allow popups, then try again.'); return; }
      setShowReprint(false);
      void createPrintEvent(run.id, { eventType: 'opened', output: 'sheet-pdf', rangeFrom: range.from, rangeTo: range.to, labelCount: labelRangeCount(range), printedCountAfter: null, printerName: null, message });
      return;
    }
    if (!(transport === 'dazzle' && dazzleSelected) && !(transport === 'webusb' && usbPrinter)) { setErrorMsg(kind === 'only' ? 'Connect a printer first, then press Print again.' : 'Connect a printer first, then press Reprint again.'); return; }
    const controller = new AbortController();
    preparation.current = controller;
    setReprinting({ ...range, done: 0, kind });
    setLocalPrintRunning(true);
    const printerName = transport === 'dazzle' ? dazzleSelected : usbPrinter?.productName ?? null;
    const finish = () => { reprintQueue.current = null; if (mounted.current) { setReprinting(null); setLocalPrintRunning(false); } };
    let labelsToSend: string[];
    try { labelsToSend = await generateLabelsForRunWithImages(run, template, format, range, { signal: controller.signal }); }
    catch (error) { finish(); if (!controller.signal.aborted) setErrorMsg(drawFailureWords(error, range) ?? friendlyRenderError(friendlyError(error, 'Could not prepare the labels.'), template.elements, across)); return; }
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
          await createPrintEvent(run.id, { eventType: 'sent', output: 'roll-zpl', rangeFrom: range.from, rangeTo: range.to, labelCount: labelRangeCount(range), printedCountAfter: null, printerName, message });
        }
      },
      onError: async (err) => {
        finish();
        setErrorMsg(friendlyError(err, kind === 'only' ? 'Printing failed' : 'Reprint failed'));
        await createPrintEvent(run.id, { eventType: 'failed', output: 'roll-zpl', rangeFrom: range.from, rangeTo: range.to, labelCount: labelRangeCount(range), printedCountAfter: null, printerName, message: kind === 'only' ? `Print failed: ${(err as Error)?.message || 'Print failed'}` : `Reprint failed: ${(err as Error)?.message || 'Print failed'}` });
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
      title: `Go back to label ${n}?`,
      body: `The run’s progress goes back to ${n - 1} of ${total}. Nothing prints yet: “Resume from label ${n}” then prints labels ${n} to ${total} (${total - n + 1} labels). To print only a few labels again, use “Print ${reprintCount === 1 ? '1 label' : `${reprintCount} labels`} again” instead.`,
      confirmLabel: `Go back to label ${n}`,
    });
    if (!ok) return;
    clearRangeDrafts();
    setStopAt(0);
    setPrintedCount(n - 1);
    setStatus('paused');
    setShowReprint(false);
    const refused = { reason: '' };
    const before = printedCount;
    const applied: { server?: number | null } = {};
    ownGoBack.current = true;
    try { await setRunStatus(run.id, 'paused', n - 1, { resetProgress: true, expectedPrintedCount: before, onSetAside: (reason) => { refused.reason = reason; }, onAlreadyApplied: (server) => { applied.server = server; } }); }
    finally { ownGoBack.current = false; }
    if ('server' in applied) { await settleGoBack(n - 1, applied.server ?? null); return; }
    if (refused.reason) {
      setPrintedCount(run.printedCount ?? 0); setErrorMsg(`Going back didn’t save. ${refused.reason}`);
      // Show the progress the other device saved.
      const fresh = await fetchRun(run.id).catch(() => null);
      if (fresh && mounted.current) setPrintedCount(fresh.printedCount ?? 0);
      return;
    }
    if (pendingPatchCount(run.id)) {
      setRewindNotice(`Going back to label ${n} hasn’t reached the server yet. It tries again on its own. If another device prints more first, it isn’t applied and you’ll be told.`);
      return;
    }
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
    if (!checksOk) { setErrorMsg(checksReason); return; }
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
  const openEdit = async () => {
    if (!run) return;
    // Labels already at the office were made with the current values: an edit
    // changes only labels sent after it, so say that before editing.
    const atOffice = office.loaded ? officeWaitingSpans(office.jobs, total) : [];
    if (atOffice.length) {
      const words = spanWords(atOffice);
      const one = atOffice.length === 1 && atOffice[0].from === atOffice[0].to;
      const ok = await confirmDialog({
        title: 'Labels are at the office printer',
        body: `${words.charAt(0).toUpperCase()}${words.slice(1)} ${one ? 'is' : 'are'} already at the office with the current values and ${one ? 'prints' : 'print'} as ${one ? 'it is' : 'they are'}. Changes apply only to labels sent after you save.`,
        confirmLabel: 'Edit anyway',
        cancelLabel: 'Not now',
      });
      if (!ok) return;
    }
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
    if (!blanksOk) { setErrorMsg('Some labels are missing a value. Fix the data (see above) before saving labels as a file.'); return; }
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
    if (!blanksOk) { setErrorMsg('Some labels are missing a value. Fix the data (see above) before saving labels as a file.'); return; }
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
    // Every load failure looks the same: the page's title, then one Recovery
    // block in the normal content column, its way out first.
    const failure = (title: string, body: string, actions: ReactNode, details = '') => (
      <div className="flex-1 overflow-auto">
        <div className="page-container space-y-5 sm:space-y-6">
          <h1 className="text-xl sm:text-2xl font-semibold text-zinc-100">{run?.name ?? 'Run'}</h1>
          <Recovery role="alert" tone="warning" title={title} actions={actions}><p>{body}</p>{details && <RawDetails text={details} />}</Recovery>
        </div>
      </div>
    );
    if (loadError) {
      const missing = loadError.status === 404;
      const said = plainServerError(new Error(loadError.message));
      return failure(
        missing ? 'We couldn’t find this run' : 'We couldn’t load this run',
        missing ? 'It may have been deleted, or the link is wrong.' : said.text,
        <>
          {!missing && <button type="button" onClick={() => void fetchRun(runId)} className="btn btn-primary">Try again</button>}
          <Link href="/runs" className={missing ? 'btn btn-primary' : 'btn btn-ghost'}><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to runs</Link>
        </>,
        missing ? '' : said.details,
      );
    }
    if (run && run.designSnapshot === null) {
      return failure('This run has no saved design', 'It can’t be printed. Use Re-run to start a new run from the same data.',
        <Link href="/runs" className="btn btn-primary"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to runs</Link>);
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
  // Every label counted as printed, wherever it sits (5–10 marked reads as 6, not 0).
  // Labels printed one by one by scanning count too, wherever they sit.
  // The same count as the Runs list: progress plus what the print history counts (countedEventSpans).
  const printedSpanList = printedSpans(printedCount, countedSpans, total);
  const printedLabels = printedSpanList.reduce((n, s) => n + s.to - s.from + 1, 0);
  const toGo = stillToGo(printedSpanList, total);
  // Whether the progress line spells out what is still to go (then the office panel doesn't say it again).
  const toGoShown = progressParts(printedCount, total, countedSpans, officeMark.ranges, waitingSpans).shown;
  const display = runDisplayStatus({ status: run.status, printedCount: printedLabels, totalLabels: total, updatedAt: run.updatedAt }, officeSummary, (status === 'error' || printerStopped) && transport !== 'office' && !isSheetFormat, { printingHere: status === 'running' });
  // A finished or cancelled run is a calm summary: no live printer, no other
  // run's alarm, no barcode tick. "Print some labels again…" wakes it up.
  const officeNeedsSomeone = (officeSummary?.failed ?? 0) > 0 || (officeSummary?.onTheWay ?? 0) > 0;
  const calm = (runFinished || run.status === 'cancelled' || status === 'cancelled') && !woken && status !== 'running'
    && !reprinting && !showReprint && !(isSheetFormat && pendingSheetRange) && !officeNeedsSomeone && !officeMark.ranges.length;
  const wakeForReprint = () => {
    setWoken(true);
    if (!isSheetFormat && transport === 'office') setOfficeChooser((n) => n + 1);
    else openReprint(Math.max(1, Math.min(printedCount || 1, total)), Math.max(1, Math.min(printedCount || 1, total)));
  };
  // With an office part that failed, its fix comes before the barcode list (phones see it first).
  const officeFixFirst = !isSheetFormat && transport === 'office' && (officeSummary?.failed ?? 0) > 0;
  const designHref = `/designer?id=${template.id}${(shownCheck.barcodeElementIds[0] ?? printCheck.barcodeElementIds[0]) ? `&select=${encodeURIComponent(shownCheck.barcodeElementIds[0] ?? printCheck.barcodeElementIds[0])}` : ''}&returnTo=${encodeURIComponent(`/runs/${run.id}`)}`;
  const sendVerb = transport === 'office' && !isSheetFormat ? 'Send' : 'Print';
  // Send the labels before the first one that can't print: the range boxes change, the person still presses.
  const leavePart = sendCheck.before ?? sendCheck.after;
  const leaveOut = leavePart && checkCurrent ? (() => {
    const part = leavePart;
    return { label: `${sendVerb} labels ${part.from.toLocaleString('en-US')}–${part.to.toLocaleString('en-US')}`, pick: () => {
      if (transport === 'office' && !isSheetFormat) setOfficeRangeAsk((n) => ({ from: part.from, to: part.to, n: (n?.n ?? 0) + 1 }));
      else { setFromDraft(String(part.from)); setThroughDraft(String(part.to)); setCountDraft(null); }
      setErrorMsg(null);
    } };
  })() : null;
  // Or send everything else: the office panel goes around the labels that can't print, in parts.
  const skipTargets = sendCheck.stopsHere.filter((label) => label > 0);
  const skipOut = transport === 'office' && !isSheetFormat && checkCurrent && skipTargets.length > 0 && skipTargets.length <= 20 && skipTargets.length === sendCheck.stopsHere.length ? {
    label: skipTargets.length === 1 ? `Leave label ${skipTargets[0].toLocaleString('en-US')} out` : `Leave those ${skipTargets.length} labels out`,
    pick: () => { setLeftOut((current) => ({ runId, labels: [...new Set([...(current.runId === runId ? current.labels : []), ...skipTargets])].sort((a, b) => a - b) })); setErrorMsg(null); },
  } : null;
  // The same one-tap leave-out for labels whose text can't be drawn.
  const glyphTargets = glyphHere.filter((label) => label > 0);
  const glyphSkip = transport === 'office' && !isSheetFormat && checkCurrent && glyphTargets.length > 0 && glyphTargets.length <= 20 && glyphTargets.length === glyphHere.length ? {
    label: glyphTargets.length === 1 ? `Leave label ${glyphTargets[0].toLocaleString('en-US')} out` : `Leave those ${glyphTargets.length} labels out`,
    pick: () => { setLeftOut((current) => ({ runId, labels: [...new Set([...(current.runId === runId ? current.labels : []), ...glyphTargets])].sort((a, b) => a - b) })); setErrorMsg(null); },
  } : null;
  const elsewhere = !shownCheck.verdict.stops && sendCheck.stopsElsewhere.length > 0 && !sendCheck.stopsElsewhere.includes(0)
    ? `${sendCheck.stopsElsewhere.length === 1 ? `Label ${sendCheck.stopsElsewhere[0].toLocaleString('en-US')} can’t print` : `Labels ${sendCheck.stopsElsewhere.slice(0, 3).map((x) => x.toLocaleString('en-US')).join(', ')}${sendCheck.stopsElsewhere.length > 3 ? ' and more' : ''} can’t print`} until ${sendCheck.stopsElsewhere.length === 1 ? 'it’s' : 'they’re'} fixed.${tickSend ? ` Labels ${tickSend.from.toLocaleString('en-US')}–${tickSend.to.toLocaleString('en-US')} leave ${sendCheck.stopsElsewhere.length === 1 ? 'it' : 'them'} out, so they can go.` : ''}`
    : '';
  const checkList = (
    <RunBarcodeCheck
      send={tickSend}
      total={total}
      characters={characterWarning}
      check={shownCheck}
      stopNote={shownCheck.verdict.stops && sendCheck.stopsHere.length && !sendCheck.stopsHere.includes(0) ? (skipOut ? `Leave ${skipTargets.length === 1 ? 'it' : 'them'} out and send the rest, or fix ${skipTargets.length === 1 ? 'it' : 'them'} first.` : leaveOut ? `${sendCheck.before ? 'Send the labels before it' : 'Send the labels after it'}, or fix it first.` : 'Fix it first, or choose labels that leave it out.') : ''}
      leaveOut={leaveOut}
      skipOut={skipOut}
      glyphStop={glyphStop ? { words: glyphStop, skip: glyphSkip, inDesign: glyphHere.includes(0) } : null}
      elsewhere={elsewhere}
      checkedTo={sendCheck.checkedTo}
      ticks={barcodeTicks}
      wizardGoAhead={wizardBarcodeGoAhead}
      onTick={tickBarcode}
      layoutGoAhead={!!printCheck.layout.length && goAhead.layout === printCheck.layoutKey}
      onLayoutGoAhead={(value) => chooseGoAhead('layout', value && printCheck.layoutKey)}
      designHref={designHref}
      qrHref={qrFixFits ? `/runs/new?duplicateFrom=${encodeURIComponent(run.id)}&barcode=qr` : null}
      onQr={() => markQrFrom(run)}
    />
  );
  // A finished or cancelled run doesn't lead with its design's problems: one
  // calm note below, and the full list (with its ticks) once someone prints again.
  const calmProblems = printCheck.blocking.length + printCheck.tight.length + printCheck.layout.length + (characterWarning?.items.length ?? 0) > 0;
  const otherCalmProblems = printCheck.blocking.length + printCheck.tight.length + printCheck.layout.length > 0;
  const calmCheckList = calmProblems
    ? <div className="space-y-1 text-sm">
      {/* Named plainly: what printed wrong on these labels, and where to fix it for next time. */}
      {characterWarning && <p className="text-amber-300">{characterNames} didn’t print on {characterLabels}; {characterWarning.chars.length > 1 ? 'they' : 'it'} came out as {characterBoxes}.</p>}
      {otherCalmProblems && <p className="text-zinc-400">This design also has some barcode or layout problems. They’re listed if you print again.</p>}
      {characterWarning && <FixInDesignerLink href={rerunAfterFixHref(designHref)} label="Fix the design" />}
    </div>
    : null;
  const sentLine = officeSentLine(officeSummary, total);
  // Print history, with what the office queue knows and the office's own
  // history lines don't say: a send that was a reprint reads "Reprinted …",
  // and a part the office couldn't print is listed with its cause (at the
  // time it was sent). Display only; nothing is written.
  const historyRows = (() => {
    const requestOfJob = new Map<string, { reprint: boolean; at?: string }>();
    for (const r of office.requests) for (const j of r.jobs) requestOfJob.set(j.id, { reprint: !!r.reprint_of, at: r.created_at });
    const requestAt = new Map<string, string | undefined>(office.requests.map((r) => [r.id, r.created_at]));
    for (const j of office.jobs) if (j.requestAt && !requestAt.has(j.requestId)) requestAt.set(j.requestId, j.requestAt);
    const rows = eventsForRun.map((event) => {
      const job = event.output === 'office-pi' && event.eventType === 'sent' && event.id.startsWith('office-') ? requestOfJob.get(event.id.slice('office-'.length)) : undefined;
      return job?.reprint ? { ...event, message: 'Reprint sent to the office printer' } : event;
    });
    const failed = office.summary.failed.filter((part) => part.kind === 'did-not-print').flatMap((part) => {
      const at = part.requestId ? requestAt.get(part.requestId) : undefined;
      if (!at || !part.jobIds[0]) return [];
      return [{ id: `office-failed-${part.jobIds[0]}`, runId, eventType: 'failed' as const, output: 'office-pi' as const, rangeFrom: part.from, rangeTo: part.to, labelCount: part.to - part.from + 1, printedCountAfter: null, printerName: null, message: `Didn’t print: ${plainJobReason(part.reason)}`, createdAt: at }];
    });
    return [...rows, ...failed];
  })();
  // The blank label fed after a send (asked for on this device): kept with
  // the send's request id on this device only, so its history line says so.
  const blankAfter = (() => {
    const after = new Set<number>();
    let ids: unknown = [];
    try { ids = JSON.parse(window.localStorage.getItem(`lw:office-blank-sends:${runId}`) || '[]'); } catch { ids = []; }
    if (!Array.isArray(ids) || !ids.length) return after;
    for (const requestId of ids) {
      const ends = office.jobs.filter((job) => job.requestId === requestId).map((job) => job.to);
      if (ends.length) after.add(Math.max(...ends));
    }
    return after;
  })();
  const historyText = (event: (typeof historyRows)[number]) => {
    const text = historyBaseText(event);
    return event.output === 'office-pi' && event.eventType === 'sent' && blankAfter.has(event.rangeTo) ? `${text}, then one blank label` : text;
  };
  const historyBaseText = (event: (typeof historyRows)[number]) => {
    if (event.eventType === REWIND_EVENT) return `Went back to label ${event.rangeFrom.toLocaleString()}`;
    if (event.id.startsWith('office-failed-')) {
      const which = event.rangeFrom === event.rangeTo ? `Label ${event.rangeFrom.toLocaleString()}` : `Labels ${event.rangeFrom.toLocaleString()}–${event.rangeTo.toLocaleString()}`;
      return `${which} didn’t print: ${(event.message ?? '').replace(/^Didn’t print: /, '')}`;
    }
    return printEventLabel(event);
  };
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
      // Progress always moves (high-water). The status changes only when no
      // device is printing this run: never "paused" under someone printing.
      const nextStatus = statusAfterMarkPrinted(statusRef.current === 'running' ? 'printing' : run.status, through, total);
      const refused = { reason: '' };
      try { await recordPrinted(run.id, through, nextStatus, { onSetAside: (reason) => { refused.reason = reason; } }); }
      catch { setMarkNotice({ tone: 'bad', text: 'That didn’t save. Try again in a moment.' }); return false; }
      if (refused.reason) { setMarkNotice({ tone: 'bad', text: `That didn’t save. ${refused.reason}` }); return false; }
      setPrintedCount((count) => Math.max(count, through));
      if (nextStatus) setStatus(nextStatus);
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
    { label: 'Edit run', icon: <Pencil className="h-4 w-4 text-zinc-400" aria-hidden="true" />, onSelect: () => void openEdit() },
    { label: 'Edit design for next time', icon: <PenTool className="h-4 w-4 text-zinc-400" aria-hidden="true" />, href: `/designer?id=${template.id}&returnTo=${encodeURIComponent(`/runs/${run.id}`)}` },
    { label: 'Save labels as a file…', icon: <Download className="h-4 w-4 text-zinc-400" aria-hidden="true" />, onSelect: () => { setExportFrom(1); setExportTo(total); setShowExport(true); } },
    // Any run that isn't finished can be cancelled: office and sheet runs too.
    ...(status !== 'completed' && status !== 'cancelled' && run.status !== 'cancelled' && status !== 'running' && !reprinting && printedCount < total
      ? [{ label: 'Cancel run…', icon: <X className="h-4 w-4" aria-hidden="true" />, danger: true, onSelect: () => void requestCancel() }]
      : []),
  ];

  return (
    <>
    <div className="flex-1 overflow-auto">
      <div className="page-container space-y-5 sm:space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold text-zinc-100 break-words">{run.name}</h1>
            {/* The dot sits on the first line; a long detail wraps under the words, not under the dot. */}
            <p className="mt-1 flex items-start gap-1.5 text-sm font-medium text-zinc-100">
              <span aria-hidden="true" className={`status-dot mt-1.5 size-2 shrink-0 rounded-full ${runToneDot(display.tone)}`} /><span key={`${display.label}|${display.detail}`} className={`status-swap min-w-0 ${display.tone === 'attention' ? 'text-red-400' : ''}`}>{display.label}{display.detail && <span className="font-normal text-zinc-300"> · {display.detail}</span>}</span>
            </p>
            {/* Facts as separate items that wrap whole, never a run-on line of dots. */}
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-zinc-400" aria-label="About this run">
              <li>{template.name}</li>
              <li>{format.name}{/["″]/.test(format.name) ? '' : ` (${format.width}″ × ${format.height}″)`}</li>
              <li className="tabular-nums">{total.toLocaleString()} label{total === 1 ? '' : 's'}</li>
            </ul>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {scanInHeader && <Link href={`/runs/${run.id}/scan`} className="btn btn-secondary btn-sm" title="One label per scan, on a label printer plugged into this computer. The office printer can’t print from scans." aria-label="Scan mode (needs a label printer plugged into this computer)">
              <ScanBarcode className="w-4 h-4 text-amber-400" aria-hidden="true" />
              <span className="max-sm:sr-only">Scan mode</span>
            </Link>}
            <Menu items={moreItems} label="More" />
          </div>
        </div>
        <QrReplaced run={run} template={template} />

        <div className="grid grid-cols-1 lg:grid-cols-[400px_minmax(0,1fr)] gap-5 lg:gap-6">
          {/* Print first, on every screen: what you see first is what Tab reaches first. */}
          <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <section aria-label="Print" className="card card-flat p-4 sm:p-5 space-y-5">
          {calm ? (
            <div className="space-y-4 reveal">
              <div className="space-y-2">
                <RunProgress printedCount={printedCount} total={total} confirmed={countedSpans} tone={runFinished ? 'done' : 'muted'} />
                <p role="status" className={`text-sm ${runFinished ? 'flex items-center gap-2 font-medium text-emerald-400' : 'text-zinc-300'}`}>
                  {runFinished
                    ? <><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> All {total.toLocaleString()} labels printed</>
                    : `This run was cancelled after ${printedCount.toLocaleString()} of ${total.toLocaleString()} labels.`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {onDone && runFinished && <button type="button" onClick={onDone} className="btn btn-secondary">Done</button>}
                <button type="button" onClick={wakeForReprint} className="btn btn-ghost btn-sm -ml-2 text-zinc-300" title="Jam, ribbon out, bad print? Print some labels again.">
                  <RotateCcw className="h-4 w-4" aria-hidden="true" /> Print some labels again…
                </button>
              </div>
              {calmCheckList}
            </div>
          ) : <>
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
                            setPrinterStatusMessage(plainPrinterProblem(next.summary));
                          } catch (err) {
                            setPrinterStatusMessage(friendlyError(err, 'Status check failed'));
                          }
                        }}
                        className="btn btn-ghost btn-sm -ml-2 text-zinc-300"
                      >
                        Check paper and ribbon
                      </button>
                      {printerStatusMessage && !errorMsg && <p role="status" className="text-sm text-zinc-400">{printerStatusMessage}</p>}
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

          {blankCheck && <BlankValueCheck check={blankCheck} leaveBlank={leaveBlank} onLeaveBlankChange={setLeaveBlank} showWhenOk={false} compact remedy={blankEditorRemedy} />}
          {!calm && !officeFixFirst && checkList}

          <div className="space-y-2">
            <RunProgress printedCount={printedCount} total={total} confirmed={countedSpans} sent={officeMark.ranges} waiting={waitingSpans} waitingLabel={transport === 'office' && panel.paused ? 'waiting at the office' : ''} named={transport === 'office' && !isSheetFormat ? office.summary.failed : []} tone={runFinished && !officeHoldsPrinter(officeSummary) ? 'done' : 'active'} animate />
            {/* What the office printer has done: shown, never counted as printed.
                With the office printer chosen, its panel says it once. */}
            {transport !== 'office' && sentLine && <p className="text-sm text-zinc-400 tabular-nums">{sentLine}</p>}
            {officeSummary && officeSummary.failed > 0 && transport !== 'office' && (
              <p className="text-sm text-red-400">{officeSummary.failedLabels ? `${officeSummary.failedLabels.toLocaleString()} office label${officeSummary.failedLabels === 1 ? '' : 's'} need${officeSummary.failedLabels === 1 ? 's' : ''} attention.` : 'Part of an office print needs attention.'} <button type="button" className="link" onClick={() => chooseTransport('office')}>Open the office printer</button></p>
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
          {reloadNeeded && (
            <Recovery tone="warning" title="This page is out of date" actions={
              <button type="button" className="btn btn-primary" onClick={() => { if (canLeaveLocalPrint()) window.location.reload(); }}><RotateCcw className="w-4 h-4" aria-hidden="true" />Reload page</button>}>
              <p>Reload to see where the run is now. Nothing was changed.</p>
            </Recovery>
          )}
          {errorMsg && !reloadNeeded && (
            <p role="alert" className="text-sm text-red-400 flex items-start gap-1.5">
              <AlertCircle className="mt-0.5 w-4 h-4 shrink-0" aria-hidden="true" /> {friendlyRenderError(friendlyError(plainPrinterProblem(errorMsg)), template.elements, across)}
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
              <button type="button" onClick={() => openSheetPrintRange()} disabled={!checksOk} className="btn btn-primary flex-1">
                <FileText className="w-4 h-4" aria-hidden="true" />
                Open print page
              </button>
            )}
            {!isSheetFormat && !reloadNeeded && (status === 'idle' || status === 'paused' || status === 'error') && printedCount < total && (
              <button type="button" onClick={() => void startOrResume()} disabled={!canStart || !rangeValid} className="btn btn-primary flex-1">
                {status === 'paused' ? <Play className="w-4 h-4" aria-hidden="true" /> : <Printer className="w-4 h-4" aria-hidden="true" />}
                {rangeValid && selectedThrough <= printedCount ? `Print ${selectedFrom === selectedThrough ? `label ${selectedFrom}` : `${selectedFrom}\u2060–\u2060${selectedThrough}`} again` : rangeValid && selectedFrom <= printedCount ? `Go back to label ${selectedFrom}` : allWithOffice ? 'Print here too…' : status === 'paused' ? `Resume from label ${selectedFrom || printedCount + 1}` : status === 'error' ? 'Try again' : 'Start printing'}
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
            {(status === 'completed' || (runFinished && status !== 'running')) && !officeHoldsPrinter(officeSummary) && (
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
          {/* Why Start or Print waits, right under it: the same words wherever a label problem holds the button. */}
          {blanksOk && !checksOk && checkCurrent && !showReprint && !isSheetFormat && transport !== 'office' && !reloadNeeded && (status === 'idle' || status === 'paused' || status === 'error') && printedCount < total && (
            <p className="text-sm text-amber-300">{checksReason}</p>
          )}
          {blanksOk && !checksOk && checkCurrent && isSheetFormat && !pendingSheetRange && printedCount < total && <p className="text-sm text-amber-300">{checksReason}</p>}
          {/* A text problem doesn't hold the button: it is named beside it, in one line. */}
          {checksOk && characterNote && !showReprint && transport !== 'office' && printedCount < total && (status === 'idle' || status === 'paused' || status === 'error') && <p className="text-sm text-zinc-400">{characterNote}</p>}
          {!blanksOk && !isSheetFormat && transport !== 'office' && (status === 'idle' || status === 'paused' || status === 'error') && printedCount < total && (
            <p className="text-sm text-amber-300">{blankNeedsEditor ? 'Printing is off until someone who can edit runs fills in the missing values.' : 'Printing is off until every label has a value (see above).'}</p>
          )}

          {/* Reprint: a separate From/To job that never changes the run's progress.
              Offered once something has printed. */}
          {status !== 'running' && total > 0 && (printedCount > 0 || !!reprinting || showReprint) && (
            reprinting ? (
              <div role="status" className="space-y-2 text-sm text-zinc-300">
                <p className="flex items-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin text-amber-400" aria-hidden="true" /> {reprinting.kind === 'only' ? 'Printing' : 'Reprinting'} {reprinting.from === reprinting.to ? `label ${reprinting.from}` : `labels ${reprinting.from}–${reprinting.to}`} ({reprinting.done.toLocaleString()} of {(reprinting.to - reprinting.from + 1).toLocaleString()} sent). Progress won&apos;t change.</p>
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
                <div className="space-y-1">
                  <label htmlFor="reprint-labels" className="block text-sm text-zinc-300">Which labels?</label>
                  <input id="reprint-labels" inputMode="text" autoComplete="off" placeholder="For example 5–8" value={reprintText} onChange={(e) => typeReprint(e.target.value)} className="field w-full tabular-nums" aria-describedby="reprint-labels-help" />
                  <p id="reprint-labels-help" className="text-sm text-zinc-400">A dash means every label in between.</p>
                </div>
                {reprintValid
                  ? <p className="text-sm text-zinc-400">{reprintCount === 1 ? '1 label' : `${reprintCount.toLocaleString()} labels`}. Progress won&apos;t change.</p>
                  : reprintText.trim() !== '' && <p role="alert" className="text-sm text-amber-300">{reprintTextError || `Use label numbers from 1 to ${total.toLocaleString()}.`}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleReprintRange()}
                    disabled={!reprintValid || !blanksOk || !checksOk || (!isSheetFormat && transport === 'office')}
                    className="btn btn-primary btn-sm"
                  >
                    <Printer className="w-4 h-4" aria-hidden="true" /> {isSheetFormat ? 'Open these labels to print' : `Print ${reprintCount === 1 ? '1 label' : `${reprintCount} labels`} again`}
                  </button>
                  <button type="button" onClick={() => setReprintSpan(reprintValid ? reprintFrom : 1, total)} className="btn btn-ghost btn-sm" disabled={reprintToDraft === String(total)}>To the end</button>
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
          {!isSheetFormat && transport === 'office' && <OfficePiPrinter toGo={toGo} toGoShown={toGoShown} run={run} template={template} format={format} runId={runId} total={total} connectionTarget={officeConnectionTarget} printAllowed={blanksOk && checksOk} printBlockedReason={!blanksOk ? (blankNeedsEditor ? 'Sending is off until someone who can edit runs fills in the missing values.' : 'Sending is off until every label has a value (see above).') : checkCurrent ? checksReason : ''} printNote={checksOk ? characterNote : ''} printedCount={printedCount} runStatus={run.status} requests={office.requests} jobs={office.jobs} summary={office.summary} requestsLoaded={office.loaded} requestsEverLoaded={office.everLoaded} requestsTruncated={office.truncated} requestsError={office.failed} refreshRequests={office.refresh} markRanges={status === 'running' ? [] : officeMark.ranges} onMarkPrinted={markOfficePrinted} onHeldChange={setPanelHeld} onPanelState={onPanelState} onRangeChange={onOfficeRange} onRecordPrinted={(ranges, note) => recordOfficePrinted(ranges, note ? `They printed (checked at the office). ${note}` : 'They printed (checked at the office)')} skipLabels={officeSkip} openChooser={officeChooser} rangeAsk={officeRangeAsk} />}
          {officeFixFirst && checkList}
          </>}
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
            {/* Phones: the label stepper gets its own full-width row, so nothing runs past the card. */}
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="section-title mr-auto">Preview</h3>
                <button
                  type="button"
                  onClick={() => setShowOutlines((s) => !s)}
                  aria-pressed={showOutlines}
                  title={showOutlines ? 'Hide label outlines' : 'Show label outlines'}
                  className={`btn btn-ghost btn-sm ${showOutlines ? 'text-amber-400 bg-amber-500/10' : 'text-zinc-400'}`}
                >
                  <SquareDashed className="w-4 h-4" aria-hidden="true" />Outlines
                </button>
              {total > 0 && (
                <div className="flex items-center gap-1 text-sm max-sm:-mx-2 max-sm:w-[calc(100%+1rem)]">
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
                  <span className="whitespace-nowrap text-zinc-400 tabular-nums max-sm:mr-auto">of {total.toLocaleString()}</span>
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
            {/* Said once: the barcode check above says it when it shows. */}
            {(calm || printCheck.blocking.length === 0 || !!run.designSnapshot?.legacy) && <p className="text-xs text-zinc-400">This run keeps the design it started with.{run.designSnapshot?.legacy ? ' (Older run: the design was saved during an update, not when the run was made.)' : ''}</p>}
          </div>
        </section>

        {historyRows.length > 0 && (
          <section className="space-y-2">
            <h2 className="section-title">Print history</h2>
            <ul className="space-y-1.5">
              {/* Office sends in a row read as one line: no part count, which
                  wouldn't match the parts the send flow named. */}
              {groupPrintHistory(historyRows).slice(0, 5).map(({ event }) => (
                <li key={event.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-baseline gap-2 text-zinc-300">
                    <span aria-hidden="true" className={`size-1.5 shrink-0 translate-y-[-1px] rounded-full ${
                      event.eventType === 'confirmed' ? 'bg-emerald-400' :
                      event.eventType === 'failed' ? 'bg-red-400' :
                      event.eventType === 'cancelled' ? 'bg-amber-300' :
                      'bg-zinc-500'
                    }`} />
                    {historyText(event)}
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
        <span className="text-zinc-400 tabular-nums">of {total.toLocaleString()}</span>
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
