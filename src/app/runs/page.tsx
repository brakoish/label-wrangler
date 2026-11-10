'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2, Copy, Play, Search, Pin, PinOff, CheckCircle2, Loader2, X } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Menu } from '@/components/ui/Menu';
import { PageTitle } from '@/components/PageTitle';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { useRunStore } from '@/lib/runStore';
import { useTemplateStore } from '@/lib/templateStore';
import { useFormatStore } from '@/lib/store';
import type { Run, RunPreset, RunStatus } from '@/lib/types';
import { alertDialog, confirmDialog, toast } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/Dialog';
import { friendlyError } from '@/lib/userMessages';
import { moreNeedAttention, runDisplayStatus, RUN_STATUS_WORDS, type RunDisplayTone, type RunStatusBucket } from '@/lib/runDisplayStatus';
import { officeStatusLine, type OfficeReviewHold } from '@/lib/officeSendOutcome';
import { officeProblemWords } from '@/lib/officeProblem';
import { askCancelRun, cancelEvents, readOfficeJobs, stopProblem, stopWaitingAtOffice } from '@/components/runs/officeCancel';
import { scannedLabelNumbers } from '@/lib/scannedLabels';
import { readPartsPlan, remainingParts, spanWords, statusAfterMarkPrinted, type OfficeSpan } from '@/lib/officeRange';
import { OfficePrinterControls } from '@/components/runs/OfficePrinterControls';
import { printedLabelCount } from '@/lib/runProgress';
import { officePrinterHeld } from '@/components/runs/useOfficeHeld';

/** Read-only extras the runs list API adds (left out when it can't tell). */
interface ListOffice {
  sent: number; onTheWay: number; failed: number; failedLabels?: number;
  firstFailed: { from: number; to: number; reason: string | null; didNotPrint: boolean; kind?: 'did-not-print' | 'needs-check' | 'print-again' } | null;
  /** Sent stretches nobody counted as printed yet, and where progress lands once they are. */
  markable?: { ranges: OfficeSpan[]; through: number };
  /** Labels after the progress that no office send covers yet (what a stopped series left). */
  unsent?: OfficeSpan[];
}
/** countedSpans: stretches the print history counts as printed beyond printedCount (confirmed office ranges, scanned labels). */
type ListRun = Run & { office?: ListOffice | null; hasPrintHistory?: boolean; countedSpans?: OfficeSpan[] };
/** Labels counted as printed, the same way the run page counts them. */
const printedShown = (run: ListRun) => Math.min(printedLabelCount(run.printedCount || 0, run.countedSpans ?? [], run.totalLabels), run.totalLabels);

type StatusFilter = 'all' | RunStatusBucket;

const RUN_SCROLL_THRESHOLD = 15;
const ACTIVE_STATUSES: RunStatus[] = ['draft', 'queued', 'printing', 'paused'];

/** Status is a coloured dot plus plain words — no pills. */
const TONE_DOT: Record<RunDisplayTone, string> = {
  idle: 'bg-transparent ring-2 ring-inset ring-zinc-500',
  active: 'bg-amber-400',
  attention: 'bg-red-400',
  check: 'bg-amber-300',
  confirm: 'bg-zinc-300',
  paused: 'bg-transparent ring-2 ring-inset ring-amber-300',
  done: 'bg-emerald-400',
  cancelled: 'bg-zinc-500',
};

/** Labels in the given stretches. */
const spanCount = (spans: ReadonlyArray<OfficeSpan> | undefined) => (spans ?? []).reduce((n, s) => n + s.to - s.from + 1, 0);

/**
 * A row's office state, also used by the status filter so both agree.
 * Only a run with labels waiting at the office reads "Paused" behind another
 * run's part (named once); every other run keeps its own status. Sent labels
 * nobody checked yet read "N labels sent, not checked yet".
 */
function rowOffice(run: ListRun, printerHeld: boolean, holdRun: { runId: string; runName: string } | null) {
  const heldBy = holdRun && holdRun.runId !== run.id && (run.office?.onTheWay ?? 0) > 0 ? holdRun : null;
  // Labels still to send are said beside "Did they all come out?", like the run page.
  return run.office ? { ...run.office, held: printerHeld, heldBy, unchecked: spanCount(run.office.markable?.ranges), stillToSend: spanCount(run.office.unsent) } : null;
}

function RunStatusText({ run, office }: { run: ListRun; office: (ListOffice & { held?: boolean; heldBy?: { runId: string; runName: string } | null }) | null }) {
  const display = runDisplayStatus({ ...run, printedCount: printedShown(run) }, office);
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium ${display.tone === 'attention' ? 'text-red-400' : display.tone === 'check' ? 'text-amber-300' : 'text-zinc-300'}`}>
      <span aria-hidden="true" className={`size-2 rounded-full transition-colors duration-200 ${TONE_DOT[display.tone]}`} />
      <span key={display.label} className="status-swap">{display.label}</span>
    </span>
  );
}

/**
 * Keeps progress and office status on this page current without reloading
 * the whole list: re-reads the first page while the page is visible and
 * merges only those fields into the runs already shown.
 */
function useLiveRunsList() {
  useEffect(() => {
    let active = true;
    // Most polls are live reads: the server reads history and office work
    // only for runs being printed, changed lately, or with office work moving
    // (named here); the rest keep what they have. A full read every minute,
    // and on coming back to the page, catches up everything else.
    let lastFull = 0;
    const update = async (forceFull = false) => {
      if (document.visibilityState === 'hidden' || !useRunStore.getState().hydrated) return;
      try {
        const full = forceFull || Date.now() - lastFull >= 60000;
        const watch = full ? [] : useRunStore.getState().runs.filter((run) => ((run as ListRun).office?.onTheWay ?? 0) > 0 || ((run as ListRun).office?.failed ?? 0) > 0).map((run) => run.id).slice(0, 50);
        const response = await fetch(full ? '/api/runs?offset=0' : `/api/runs?offset=0&live=1${watch.length ? `&watch=${watch.map(encodeURIComponent).join(',')}` : ''}`, { cache: 'no-store' });
        if (full && response.ok) lastFull = Date.now();
        if (!response.ok || !active) return;
        const rows = await response.json() as ListRun[];
        if (!Array.isArray(rows) || !active) return;
        const byId = new Map(rows.map((row) => [row.id, row]));
        useRunStore.setState((state) => ({
          runs: state.runs.map((old) => {
            const fresh = byId.get(old.id);
            if (!fresh) return old;
            return { ...old, printedCount: fresh.printedCount, status: fresh.status, completedAt: fresh.completedAt,
              ...('office' in fresh ? { office: fresh.office } : {}), ...('hasPrintHistory' in fresh ? { hasPrintHistory: fresh.hasPrintHistory } : {}),
              ...('countedSpans' in fresh ? { countedSpans: fresh.countedSpans } : {}) } as Run;
          }),
        }));
      } catch { /* the next try catches up */ }
    };
    // Every 15 s, or every 5 s while labels are on their way to the office.
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const moving = useRunStore.getState().runs.some((run) => ((run as ListRun).office?.onTheWay ?? 0) > 0);
      timer = setTimeout(() => { void update().finally(() => { if (active) schedule(); }); }, moving ? 5000 : 15000);
    };
    // Read once right away too: coming back from a run, its counts are current at once.
    void update(true).finally(() => { if (active) schedule(); });
    const onVisible = () => { if (document.visibilityState === 'visible') void update(true); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
}

interface BarPrinter { station_id: string; id: string; name: string; online: boolean; available?: boolean; dispatch_enabled: boolean; paired_at: string | null; needs_review: boolean; dispatch_hold_reason?: string | null; review_holds?: OfficeReviewHold[] }
/**
 * The shared office printer, reachable without opening a run: one status line
 * (never "Ready" while it is stopped or paused), which run and labels stop it
 * with a link there, and Pause/Resume. Reads every 15 s, faster while it is
 * stopped or paused, never while the page is hidden.
 */
function OfficePrinterBar({ onHeld, runs = [] }: { onHeld?: (held: boolean, holdRun?: { runId: string; runName: string } | null) => void; runs?: ListRun[] }) {
  const [printers, setPrinters] = useState<BarPrinter[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const read = useCallback(async () => {
    try {
      const response = await fetch('/api/office/stations', { cache: 'no-store' });
      if (response.status === 401 || response.status === 403) { setHidden(true); return; }
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data?.printers)) setPrinters(data.printers);
    } catch { /* tries again on the next read */ }
  }, []);
  const printer = printers?.find((p) => p.dispatch_enabled && p.paired_at) ?? null;
  // A pause the printer confirmed reads "Paused" at once, before the next stations read.
  const [controlPaused, setControlPaused] = useState<boolean | null>(null);
  const live = officeStatusLine(printer ?? undefined);
  const status = controlPaused && !live.paused && !live.stopped && printer?.online
    ? { ...live, paused: true, tone: 'warn' as const, text: 'Paused: nothing new prints until someone resumes it.' } : live;
  const watch = status.stopped || status.paused || status.tone !== 'ok';
  const held = officePrinterHeld(printers);
  const holdId = status.stopped && status.hold ? status.hold.run_id : '';
  const holdName = status.stopped && status.hold ? status.hold.run_name : '';
  useEffect(() => { onHeld?.(held, holdId ? { runId: holdId, runName: holdName } : null); }, [held, holdId, holdName, onHeld]);
  useEffect(() => {
    let active = true;
    const update = () => { if (active && document.visibilityState !== 'hidden') void read(); };
    update();
    const timer = setInterval(update, watch ? 5000 : 15000);
    const onVisible = () => { if (document.visibilityState === 'visible') update(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [read, watch]);
  if (hidden || !printer) return null;
  const dot = status.paused ? 'border-2 border-amber-300 bg-transparent' : status.tone === 'ok' ? 'bg-emerald-400' : status.tone === 'bad' ? 'bg-red-400' : 'bg-amber-300';
  const text = status.tone === 'ok' ? 'text-zinc-300' : status.tone === 'bad' ? 'text-red-400' : 'text-amber-300';
  // The same sentence as that run's row, from the same part: the row's first failed part.
  const holdRun = status.hold ? runs.find((r) => r.id === status.hold!.run_id) : undefined;
  const first = holdRun?.office?.firstFailed ?? null;
  const words = status.stopped && status.hold
    ? (first ? officeProblemWords(first) : officeProblemWords({ from: status.hold.from, to: status.hold.to, kind: status.hold.did_not_print ? 'did-not-print' : 'needs-check' }))
    : null;
  const runName = status.hold?.run_name || holdRun?.name || 'another run';
  // That run's row below says what to do; the bar names it once. A run not
  // shown in the list keeps the whole sentence here.
  const line = words ? `Stopped by “${runName}”${holdRun ? '.' : `: ${words.sentence}`}${status.otherHolds > 1 ? ` ${status.otherHolds} runs need a check.` : ''}` : status.text;
  return (
    <section aria-label="Office printer" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div role="status" className="min-w-0 text-sm">
        <p className={`flex items-start gap-2 ${text}`}><span aria-hidden="true" className={`status-dot mt-1.5 size-2 shrink-0 rounded-full ${dot}`} /><span key={line} className="status-swap"><span className="font-medium text-zinc-100">{printer.name}:</span> {line}</span></p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* The bar's action is the row's action: open that run and fix it there. */}
        {status.stopped && status.hold && <Link href={`/runs/${encodeURIComponent(status.hold.run_id)}`} className="btn btn-secondary btn-sm">Open “{runName}”</Link>}
        <OfficePrinterControls stopped={!!status.stopped} onPausedChange={setControlPaused} onUnavailable={() => setHidden(true)} onChange={() => void read()} />
      </div>
    </section>
  );
}

/**
 * "Mark sent labels as printed" for many runs at once: one dialog that lists
 * every selected run and its ranges, one confirm. Each run's progress moves
 * through its unbroken sent stretches, and each range is kept as confirmed.
 */
function BulkMarkDialog({ runs, leftOut = [], open, onClose }: { runs: ListRun[]; leftOut?: ListRun[]; open: boolean; onClose: () => void }) {
  const { recordPrinted, createPrintEvent } = useRunStore();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [problem, setProblem] = useState('');
  // Picked once when the dialog opens; a list refresh while it is open keeps the choice.
  useEffect(() => { if (open) { setPicked(new Set(runs.map((r) => r.id))); setProblem(''); } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open]);
  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true); setProblem('');
    let done = 0; const failed: string[] = []; const changed: string[] = [];
    // The list can be a few seconds old: each run is read again just before it
    // is written, so a run another device started printing (or cancelled,
    // or finished) since is never paused or changed from here.
    const norm = (r: { status: string; printedCount?: number | null; totalLabels: number }) => (r.status === 'completed' && (r.printedCount || 0) < r.totalLabels ? 'paused' : r.status);
    for (const run of runs.filter((r) => picked.has(r.id))) {
      const plan = run.office?.markable;
      if (!plan?.ranges.length) continue;
      let fresh: Run;
      try {
        const response = await fetch(`/api/runs/${encodeURIComponent(run.id)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(String(response.status));
        fresh = await response.json() as Run;
      } catch { failed.push(run.name); continue; }
      // A go-back on another device (progress lowered since the list was read)
      // is never undone from here: those labels may have jammed.
      if (norm(fresh) !== norm(run) || fresh.totalLabels !== run.totalLabels || (fresh.printedCount || 0) < (run.printedCount || 0)) {
        changed.push(run.name);
        setPicked((current) => { const next = new Set(current); next.delete(run.id); return next; });
        continue;
      }
      const printed = fresh.printedCount || 0;
      const through = Math.max(printed, plan.through);
      const refused = { reason: '' };
      try {
        if (through > printed) {
          // Never "paused" under a device that is printing this run, and a
          // cancelled run stays cancelled: progress only.
          await recordPrinted(run.id, through, statusAfterMarkPrinted(fresh.status, through, fresh.totalLabels), { onSetAside: (reason) => { refused.reason = reason; } });
          if (refused.reason) { failed.push(run.name); continue; }
        }
        for (const r of plan.ranges) {
          await createPrintEvent(run.id, { eventType: 'confirmed', output: 'office-pi', rangeFrom: r.from, rangeTo: r.to, labelCount: r.to - r.from + 1, printedCountAfter: through, printerName: 'Office printer', message: 'Checked and marked printed after the office sent them (from the Runs list)' });
        }
        done++;
        // Saved: a second try after a failure never marks this run again.
        setPicked((current) => { const next = new Set(current); next.delete(run.id); return next; });
      } catch { failed.push(run.name); }
    }
    saving.current = false;
    setBusy(false);
    const doneWords = done ? `${done === 1 ? '1 run was' : `${done} runs were`} marked printed. ` : '';
    const changedWords = changed.length ? `${changed.length === 1 ? `“${changed[0]}” changed` : `${changed.length} runs changed`} on another device, so ${changed.length === 1 ? 'it wasn’t' : 'they weren’t'} marked. Open ${changed.length === 1 ? 'it' : 'them'} to check. ` : '';
    const failedWords = failed.length ? `${failed.length === 1 ? `“${failed[0]}” didn’t` : `${failed.length} runs didn’t`} save. Try again in a moment.` : '';
    if (failed.length || changed.length) { setProblem(`${doneWords}${changedWords}${failedWords}`.trim()); return; }
    onClose();
    toast(`${done === 1 ? '1 run' : `${done} runs`} marked printed`);
  };
  const count = runs.filter((r) => picked.has(r.id)).length;
  return (
    <Dialog open={open} onClose={onClose} dismissible={!busy} title="Mark sent labels as printed?" className="max-w-lg">
      <p className="text-sm text-zinc-300">The office printer reported these labels as sent. Check they came out of the printer first.{runs.some((r) => r.status === 'cancelled') ? ' Cancelled runs stay cancelled; only their count changes.' : ''}</p>
      <ul className="max-h-80 space-y-1 overflow-y-auto">
        {runs.map((run) => {
          const plan = run.office?.markable;
          return (
            <li key={run.id}>
              <label className="flex min-h-control cursor-pointer items-start gap-3 rounded-lg px-2 py-2 text-sm hover:bg-zinc-800">
                <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-amber-500" checked={picked.has(run.id)} disabled={busy}
                  onChange={(e) => setPicked((current) => { const next = new Set(current); if (e.target.checked) next.add(run.id); else next.delete(run.id); return next; })} />
                <span className="min-w-0">
                  <span className="block font-medium text-zinc-100">{run.name}{run.status === 'cancelled' ? <span className="font-normal text-zinc-400"> · cancelled</span> : null}</span>
                  <span className="block text-zinc-400">{plan ? spanWords(plan.ranges) : ''}{plan && plan.through > (run.printedCount || 0) ? ` · progress moves to ${plan.through.toLocaleString()} of ${run.totalLabels.toLocaleString()}` : ''}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {leftOut.length > 0 && <ul className="space-y-1 text-sm text-zinc-400">
        {leftOut.map((run) => {
          const first = run.office?.firstFailed;
          const labels = first ? (first.from === first.to ? `label ${first.from.toLocaleString()}` : `labels ${first.from.toLocaleString()}–${first.to.toLocaleString()}`) : '';
          const one = !!first && first.from === first.to;
          const why = first
            ? (first.kind === 'needs-check' || (!first.kind && !first.didNotPrint) ? `${labels} need${one ? 's' : ''} a check first` : `${labels} need${one ? 's' : ''} printing again first`)
            : (run.office?.failed ?? 0) > 0 ? 'part of it needs a check first' : 'some of its labels are still on their way to the office printer';
          return <li key={run.id}>“{run.name}” isn’t included: {why}.</li>;
        })}
      </ul>}
      {problem && <p role="alert" className="text-sm text-red-400">{problem}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" data-autofocus disabled={busy || count === 0} onClick={() => void save()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
          {count === 1 ? 'Mark 1 run printed' : `Mark ${count} runs printed`}
        </button>
      </div>
    </Dialog>
  );
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export default function RunsPage() {
  const { runs, presets, deleteRun, deletePreset, togglePin } = useRunStore();
  const { templates } = useTemplateStore();
  const { formats } = useFormatStore();

  // Dashboard filter/view state. All kept in local component state for now
  // — if we want to remember it across sessions later, move to localStorage.
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [templateFilter, setTemplateFilter] = useState<string>('all');

  const runsHydrated = useRunStore((state) => state.hydrated);
  const runsLoading = useRunStore((state) => state.loading);
  const runsError = useRunStore((state) => state.error);
  useLiveRunsList();
  const requestDeleteRun = async (run: ListRun) => {
    // One plain sentence for the case that applies. When the list couldn't
    // tell, check the run's print history first.
    let history = run.hasPrintHistory;
    if (history === undefined) {
      try {
        const response = await fetch(`/api/runs/${encodeURIComponent(run.id)}/print-events`, { cache: 'no-store' });
        const events = response.ok ? await response.json() : null;
        history = Array.isArray(events) ? events.length > 0 || ((run as ListRun).office?.sent ?? 0) + ((run as ListRun).office?.onTheWay ?? 0) > 0 : undefined;
      } catch { history = undefined; }
    }
    if (history === undefined) { void alertDialog('Couldn’t check this run', 'Its print history couldn’t be read just now, so nothing was deleted. Try again in a moment.'); return; }
    if (history) { void alertDialog(`“${run.name}” is kept`, 'This run has print history, so it can’t be deleted. It stays in your list for your records.'); return; }
    const printed = run.printedCount || 0;
    const ok = await confirmDialog({
      title: `Delete “${run.name}” for good?`,
      body: printed > 0
        ? `It counts ${printed.toLocaleString()} label${printed === 1 ? '' : 's'} as printed but has no print records, so it’s removed for good. This can’t be undone.`
        : 'Nothing was printed from this run, so it’s removed for good. This can’t be undone.',
      confirmLabel: 'Delete for good',
      danger: true,
    });
    if (!ok) return;
    const refused = await deleteRun(run.id);
    if (refused) void alertDialog('This run is kept for your records', refused);
    else toast('Run deleted');
  };
  const [bulkOpen, setBulkOpen] = useState(false);
  // The shared printer is paused or stopped: queued labels read as waiting, not on their way.
  const [printerHeld, setPrinterHeld] = useState(false);
  const [holdRun, setHoldRun] = useState<{ runId: string; runName: string } | null>(null);
  const onPrinterHeld = useCallback((held: boolean, by?: { runId: string; runName: string } | null) => {
    setPrinterHeld(held);
    setHoldRun((prev) => (prev?.runId === by?.runId && prev?.runName === by?.runName ? prev : by ?? null));
  }, []);
  const requestDeletePreset = async (preset: RunPreset) => {
    const ok = await confirmDialog({ title: `Delete the preset “${preset.name}”?`, body: 'A preset that runs were made from is kept for your records and can’t be deleted. A preset no run used is removed for good.', confirmLabel: 'Delete preset', danger: true });
    if (!ok) return;
    const refused = await deletePreset(preset.id);
    if (refused) void alertDialog('This preset is kept for your records', refused);
  };
  const templateName = (id: string) => templates.find((t) => t.id === id)?.name ?? 'Deleted design';
  const formatName = (templateId: string) => {
    const t = templates.find((x) => x.id === templateId);
    if (!t) return '';
    return formats.find((f) => f.id === t.formatId)?.name ?? '';
  };

  // Split runs into three buckets: active (printing/paused/queued/draft/error),
  // pinned (anything explicitly pinned by the user), and the rest (history).
  // Pinned wins over active — an active run that's ALSO pinned appears in
  // the pinned section, not duplicated.
  const { active, pinned, history, stats } = useMemo(() => {
    const pinned: Run[] = [];
    const active: Run[] = [];
    const history: Run[] = [];
    // Stats: completed this month, total labels ever printed, active count.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let completedThisMonth = 0;
    let totalLabelsPrinted = 0;
    for (const r of runs) {
      totalLabelsPrinted += printedShown(r as ListRun);
      if (r.status === 'completed' && (r.printedCount || 0) >= r.totalLabels && r.completedAt) {
        try {
          if (new Date(r.completedAt) >= monthStart) completedThisMonth++;
        } catch { /* ignore */ }
      }
      if (r.pinnedAt) pinned.push(r);
      else if (r.status === 'completed' && (r.printedCount || 0) < r.totalLabels) active.push({...r,status:'paused'});
      else if (ACTIVE_STATUSES.includes(r.status)) active.push(r);
      else history.push(r);
    }
    // Sort pinned by pinnedAt DESC (most recently pinned on top).
    pinned.sort((a, b) => (b.pinnedAt || '').localeCompare(a.pinnedAt || ''));
    // Active: runs whose office print needs someone first, then by recency.
    const needsSomeone = (run: Run) => (((run as ListRun).office?.failed ?? 0) > 0 ? 0 : 1);
    active.sort((a, b) => needsSomeone(a) - needsSomeone(b) || (b.createdAt || '').localeCompare(a.createdAt || ''));
    // History already comes in createdAt DESC from the API.
    return {
      active,
      pinned,
      history,
      stats: { active: active.length, completedThisMonth, totalLabelsPrinted },
    };
  }, [runs]);

  // Build unique template list for the filter dropdown.
  const templateOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: Array<{ value: string; label: string }> = [{ value: 'all', label: 'All designs' }];
    for (const r of runs) {
      if (seen.has(r.templateId)) continue;
      seen.add(r.templateId);
      opts.push({ value: r.templateId, label: templateName(r.templateId) });
    }
    return opts;
    // templateName is stable enough (depends only on templates)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, templates]);

  // Apply search + filters to every run bucket. Search has to include active
  // and pinned work too; otherwise the box feels broken when the matching run
  // is above History.
  const filteredRuns = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (r: Run) => {
      // The same five words as the rows and the run page.
      if (statusFilter !== 'all' && runDisplayStatus({ ...r, printedCount: printedShown(r as ListRun) }, rowOffice(r as ListRun, printerHeld, holdRun)).bucket !== statusFilter) return false;
      if (templateFilter !== 'all' && r.templateId !== templateFilter) return false;
      if (q) {
        const hay = [
          r.name,
          r.status,
          r.dataSource,
          r.notes ?? '',
          templateName(r.templateId),
          formatName(r.templateId),
          JSON.stringify(r.staticValues ?? {}),
          JSON.stringify(r.sourceData ?? []),
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    };
    return {
      active: active.filter(matches),
      pinned: pinned.filter(matches),
      history: history.filter(matches),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pinned, history, search, statusFilter, templateFilter, templates, formats, printerHeld, holdRun]);

  // Runs whose sent office labels nobody counted yet (for the bulk action).
  // Cancelled runs too: labels that printed after "Cancel run, let them print" still need counting.
  const markableRuns = useMemo(() => (runs as ListRun[]).filter((r) => (r.office?.markable?.ranges.length ?? 0) > 0 && (r.office?.onTheWay ?? 0) === 0 && (r.office?.failed ?? 0) === 0 && (ACTIVE_STATUSES.includes(r.status) || r.status === 'cancelled')), [runs]);
  // Runs with sent labels that aren't offered because a part needs someone first.
  // Also runs with labels still on their way: they're offered once the office is done with them.
  const bulkLeftOut = useMemo(() => (active as ListRun[]).filter((r) => (r.office?.sent ?? 0) > 0 && !markableRuns.includes(r) && ((r.office?.failed ?? 0) > 0 || (r.office?.onTheWay ?? 0) > 0)), [active, markableRuns]);

  const renderRunCollection = (collection: Run[], emptyMsg: string) => {
    if (collection.length === 0) {
      return <p className="py-2 text-sm text-zinc-400">{emptyMsg}</p>;
    }
    const scrollProps = collection.length > RUN_SCROLL_THRESHOLD
      ? {
          className: 'min-h-0 overflow-y-auto overscroll-contain pr-2 -mr-2',
          style: { maxHeight: 'min(720px, calc(100vh - 18rem))' },
        }
      : { className: undefined, style: undefined };
    return (
      <div {...scrollProps}>
        <ul className="stagger space-y-2">
          {collection.map((r) => (
            <li key={r.id}>
              <RunRow
                run={r}
                templateName={templateName(r.templateId)}
                onDelete={() => void requestDeleteRun(r)}
                onTogglePin={() => void togglePin(r.id)}
                printerHeld={printerHeld}
                holdRun={holdRun}
              />
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <AppShell>
      <PageTitle title="Runs" />
      <BulkMarkDialog runs={markableRuns} leftOut={bulkLeftOut} open={bulkOpen} onClose={() => setBulkOpen(false)} />
      <div className="flex-1 overflow-auto">
        <div className="page-container space-y-6 sm:space-y-8">
          <section>
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold text-zinc-100">Runs</h1>
                <p className="mt-1 text-sm text-zinc-400">{runs.length > 0 ? 'Start a run, or pick up where you left off.' : 'A run prints one design with your data, one label per row.'}</p>
              </div>
              {/* One primary on screen: with no runs (empty or couldn't load), the body has it. */}
              {runs.length > 0 && <div className="flex flex-wrap gap-2">
                <QuickAction
                  href="/runs/new"
                  icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                  label="New run"
                  primary
                />
                {/* One way in: where the data comes from is chosen inside the new run. */}
              </div>}
            </div>
          </section>

          {/* Stats strip — one glance summary at the top. Hidden when empty.
              Stacks to single column on phone, then a 3-wide grid. */}
          {runs.length > 0 && (
            <p className="hidden sm:flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-400">
              <span><span className="font-semibold text-zinc-100 tabular-nums">{stats.active}</span> not finished</span>
              <span><span className="font-semibold text-zinc-100 tabular-nums">{stats.completedThisMonth}</span> completed this month</span>
              <span><span className="font-semibold text-zinc-100 tabular-nums">{stats.totalLabelsPrinted.toLocaleString()}</span> labels printed</span>
            </p>
          )}

          {/* The office printer can be paused even with no run open (once there are runs). */}
          {runs.length > 0 && <OfficePrinterBar onHeld={onPrinterHeld} runs={active as ListRun[]} />}

          {/* Presets start a run, so they sit with "New run", above the lists:
              full-width cards, each with its own menu inside. */}
          {presets.length > 0 && (
            <section>
              <h2 className="section-title mb-3">Start from a preset</h2>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {presets.map((p) => (
                  <li key={p.id}>
                    <PresetRow preset={p} templateName={templateName(p.templateId)} formatName={formatName(p.templateId)} onDelete={() => void requestDeletePreset(p)} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Toolbar: primary New Run button + search + filters + view toggle */}
          {runs.length > 0 && (
            <section className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px] max-w-md relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search runs"
                  placeholder="Search runs"
                  className="field pl-9"
                />
              </div>
              <div className="w-[calc(50%-0.25rem)] sm:w-40">
                <CustomSelect
                  value={statusFilter}
                  onChange={(v) => setStatusFilter(v as StatusFilter)}
                  aria-label="Filter by status"
                  options={[
                    { value: 'all', label: 'All statuses' },
                    ...(Object.keys(RUN_STATUS_WORDS) as RunStatusBucket[]).map((bucket) => ({ value: bucket, label: RUN_STATUS_WORDS[bucket] })),
                  ]}
                />
              </div>
              <div className="w-[calc(50%-0.25rem)] sm:w-48">
                <CustomSelect
                  value={templateFilter}
                  onChange={setTemplateFilter}
                  aria-label="Filter by design"
                  options={templateOptions}
                />
              </div>
            </section>
          )}

          {!runsHydrated && runs.length === 0 && (
            <div role="status" aria-label="Loading runs" className="space-y-2">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-[72px] rounded-xl bg-zinc-900 animate-pulse" />)}
              <span className="sr-only">Loading runs…</span>
            </div>
          )}
          {runsHydrated && runsError && runs.length === 0 && (
            <div role="alert" className="py-10 text-center space-y-3">
              <h2 className="text-base font-semibold text-zinc-100">We couldn&apos;t load your runs</h2>
              <p className="text-sm text-zinc-400">{friendlyError(runsError, 'Check your connection, then try again.')}</p>
              <button type="button" disabled={runsLoading} onClick={() => {
                void useRunStore.getState().loadAll();
                if (useTemplateStore.getState().error) void useTemplateStore.getState().fetchTemplates();
                if (useFormatStore.getState().error) void useFormatStore.getState().fetchFormats();
              }} className="btn btn-primary">{runsLoading ? 'Trying again…' : 'Try again'}</button>
            </div>
          )}
          {/* Empty state: only once loading has finished and there really are no runs. */}
          {runsHydrated && !runsError && runs.length === 0 && (
            <RunsEmptyState hasTemplates={templates.length > 0} />
          )}

          {/* Pinned runs */}
          {filteredRuns.pinned.length > 0 && (
            <section>
              <div className="flex items-baseline gap-3 mb-3">
                <h2 className="section-title">Pinned</h2>
                <span className="text-sm text-zinc-400 tabular-nums">
                  {filteredRuns.pinned.length}{filteredRuns.pinned.length !== pinned.length ? ` of ${pinned.length}` : ''}
                </span>
              </div>
              {renderRunCollection(filteredRuns.pinned, 'No pinned runs match your filters.')}
            </section>
          )}

          {/* Active runs */}
          {filteredRuns.active.length > 0 && (
            <section>
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="section-title whitespace-nowrap">Not finished</h2>
                <span className="text-sm text-zinc-400 tabular-nums">
                  {filteredRuns.active.length}{filteredRuns.active.length !== active.length ? ` of ${active.length}` : ''}
                </span>
                {markableRuns.length > 0 && (
                  <button type="button" onClick={() => setBulkOpen(true)} className="btn btn-ghost btn-sm text-zinc-300 max-sm:-ml-2 max-sm:basis-full max-sm:justify-start sm:ml-auto">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Mark sent labels as printed…
                  </button>
                )}
              </div>
              {renderRunCollection(filteredRuns.active, 'No unfinished runs match your filters.')}
            </section>
          )}

          {/* History / filterable list */}
          {runs.length > 0 && (
            <section>
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="section-title">Finished and cancelled</h2>
                <span className="text-sm text-zinc-400 tabular-nums">
                  {filteredRuns.history.length}{filteredRuns.history.length !== history.length ? ` of ${history.length}` : ''}
                </span>
                {/* With no unfinished runs, the bulk action lives here (cancelled runs with sent labels). */}
                {markableRuns.length > 0 && filteredRuns.active.length === 0 && (
                  <button type="button" onClick={() => setBulkOpen(true)} className="btn btn-ghost btn-sm text-zinc-300 max-sm:-ml-2 max-sm:basis-full max-sm:justify-start sm:ml-auto">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Mark sent labels as printed…
                  </button>
                )}
              </div>
              {renderRunCollection(
                filteredRuns.history,
                history.length === 0
                  ? 'No completed runs yet.'
                  : 'No runs match your filters.',
              )}
            </section>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function QuickAction({
  href,
  icon,
  label,
  primary = false,
  secondary = false,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
  /** Hidden on phones so the run list is visible without scrolling. */
  secondary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`${secondary ? 'hidden sm:inline-flex' : 'max-sm:w-full'} btn ${primary ? 'btn-primary' : 'btn-secondary'}`}
    >
      {icon}
      {label}
    </Link>
  );
}

/** One sentence, one action: design a label first, or start the first run. */
function RunsEmptyState({ hasTemplates }: { hasTemplates: boolean }) {
  return (
    <div className="py-12 text-center">
      <h2 className="text-lg font-semibold text-zinc-100">Nothing printed yet</h2>
      <p className="mt-1 text-sm text-zinc-400">
        {hasTemplates ? 'Start a run to print your first batch of labels.' : 'Design a label first, then start a run to print it.'}
      </p>
      <Link href={hasTemplates ? '/runs/new' : '/designer'} className="btn btn-primary mt-5">
        <Plus className="h-4 w-4" aria-hidden="true" /> {hasTemplates ? 'New run' : 'Design a label'}
      </Link>
    </div>
  );
}

/** One preset: the card starts a run from it; its menu (delete) sits inside the card. */
function PresetRow({
  preset,
  templateName,
  formatName,
  onDelete,
}: {
  preset: RunPreset;
  templateName: string;
  formatName: string;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl bg-zinc-900 pr-1 transition-colors hover:bg-zinc-800">
      <Link
        href={`/runs/new?presetId=${preset.id}`}
        className="flex min-h-control min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 transition-transform active:scale-[0.97]"
      >
        <Play className="size-4 shrink-0 text-amber-400" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-zinc-100">{preset.name}</span>
          <span className="block truncate text-xs text-zinc-400">{templateName}{formatName ? ` · ${formatName}` : ''}</span>
        </span>
      </Link>
      <Menu
        label={`More for ${preset.name}`}
        showLabel={false}
        items={[{ label: 'Delete preset…', icon: <Trash2 className="w-4 h-4" aria-hidden="true" />, danger: true, onSelect: onDelete }]}
      />
    </div>
  );
}

function RunRow({
  run,
  templateName,
  onDelete,
  onTogglePin,
  printerHeld = false,
  holdRun = null,
}: {
  run: ListRun;
  printerHeld?: boolean;
  /** Another run whose part stops the shared printer. */
  holdRun?: { runId: string; runName: string } | null;
  templateName: string;
  onDelete: () => void;
  onTogglePin?: () => void;
}) {
  const office = rowOffice(run, printerHeld, holdRun);
  const { setRunStatus, createPrintEvent } = useRunStore();
  const display = runDisplayStatus({ ...run, printedCount: printedShown(run) }, office);
  // Under the bar, only what the bar doesn't show: labels on their way.
  const waitingLine = office && office.onTheWay > 0 ? `${office.onTheWay.toLocaleString()} ${office.failed > 0 || office.held ? 'waiting' : 'on the way to the office printer'}` : '';
  const failed = office?.firstFailed ?? null;
  // The run's progress (what a cancel keeps), and every label counted as printed (what the row shows, like the run page).
  const printed = Math.min(run.printedCount || 0, run.totalLabels);
  const shown = printedShown(run);
  const finished = run.totalLabels > 0 && shown >= run.totalLabels;
  const pct = run.totalLabels > 0 ? Math.round((shown / run.totalLabels) * 100) : 0;
  const unfinished = !finished && run.status !== 'cancelled';
  const pinned = !!run.pinnedAt;
  // A "Send all … in N parts" that stopped early on this device.
  const [partsLeft, setPartsLeft] = useState<OfficeSpan[]>([]);
  useEffect(() => { try { setPartsLeft(remainingParts(readPartsPlan(localStorage.getItem(`lw:office-parts:${run.id}`)))); } catch { setPartsLeft([]); } }, [run.id, office?.sent, office?.onTheWay]);

  // Same choice as the run page: labels nobody at the office has picked up
  // yet can be stopped with the run or left to print, and the history says
  // only what is true.
  const cancelRun = async () => {
    const mayHaveOffice = !!run.office;
    // Unreadable office queue: the stop is still offered (it reads the queue again first).
    const jobs = mayHaveOffice ? await readOfficeJobs(run.id) : [];
    const choice = await askCancelRun({ title: `Cancel “${run.name}”?`, jobs, total: run.totalLabels });
    if (!choice) return;
    try {
      await setRunStatus(run.id, 'cancelled', printed);
      let after = jobs;
      let stoppedJobIds = new Set<string>();
      let problem: string | null = null;
      if (choice === 'stop') {
        const result = await stopWaitingAtOffice(run.id, jobs);
        stoppedJobIds = result.stoppedJobIds;
        after = result.jobs ?? after;
        problem = stopProblem(result);
      }
      // Labels printed by scanning are never called "not printed".
      let scanned: number[] = [];
      let confirmed: OfficeSpan[] = [];
      let historyRead = false;
      try {
        const response = await fetch(`/api/runs/${encodeURIComponent(run.id)}/print-events`, { cache: 'no-store' });
        const events = response.ok ? await response.json() : [];
        if (Array.isArray(events)) {
          scanned = scannedLabelNumbers(events, run.totalLabels);
          confirmed = events.filter((event) => event?.eventType === 'confirmed' && event?.output === 'office-pi').map((event) => ({ from: event.rangeFrom, to: event.rangeTo }));
          historyRead = true;
        }
      } catch { /* below: nothing is called "not printed" without the history */ }
      const events = cancelEvents({ printedCount: printed, end: run.totalLabels, jobs: after ?? [], stoppedJobIds, scanned, confirmed, output: run.office ? 'office-pi' : 'roll-zpl', printerName: null });
      // Without the history, scanned labels can't be told apart: name only what was stopped.
      for (const event of events) if ((historyRead && after) || event.message !== 'Run cancelled') await createPrintEvent(run.id, event);
      if (problem) void alertDialog('Some labels may still print', problem);
      else toast('Run cancelled');
    } catch (error) { void alertDialog('The run wasn’t cancelled', friendlyError(error, 'Try again in a moment.')); }
  };
  return (
    <div className="run-row relative flex items-center gap-2 rounded-xl bg-zinc-900 p-3 transition-colors hover:bg-zinc-800 sm:gap-4 sm:px-4">
      <Link href={`/runs/${run.id}`} className="flex min-w-0 flex-1 flex-col gap-2 rounded-lg sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 max-sm:pr-12">
            <h3 className="line-clamp-2 min-w-0 break-words text-sm font-semibold text-zinc-100">{run.name}</h3>
            <RunStatusText run={run} office={office} />
          </div>
          {/* The design and the date tell runs apart; the label size is on the run's own page. */}
          <p className="mt-0.5 text-xs text-zinc-400 max-sm:line-clamp-2 sm:truncate">
            {display.detail && !failed ? `${display.detail} · ` : ''}{templateName} · <span className="whitespace-nowrap">{formatDate(run.createdAt)}</span>
          </p>
          {failed && run.status !== 'cancelled' && (
            <p className={`mt-0.5 text-xs ${failed.kind === 'did-not-print' || (!failed.kind && failed.didNotPrint) ? 'text-red-400' : 'text-amber-300'}`}>
              {officeProblemWords(failed).sentence}{office ? moreNeedAttention(office, failed) : ''}
            </p>
          )}
          {run.status === 'cancelled' && (office?.unchecked ?? 0) > 0 && (
            <p className="mt-0.5 text-xs text-zinc-400">{office!.unchecked === 1 ? '1 sent: did it come out?' : `${office!.unchecked!.toLocaleString()} sent: did they all come out?`}</p>
          )}
          {!failed && partsLeft.length > 0 && unfinished && (
            <p className="mt-0.5 text-xs text-amber-300">{partsLeft.length === 1 ? 'The last part wasn’t' : `${partsLeft.length} parts weren’t`} sent yet. Open this run to send {partsLeft.length === 1 ? 'it' : 'them'}.</p>
          )}
          {!failed && !partsLeft.length && unfinished && office && office.onTheWay === 0 && (office.unsent?.length ?? 0) > 0 && (
            <p className="mt-0.5 text-xs text-zinc-400">{spanWords(office.unsent!).replace(/^l/, 'L')} {office.unsent!.length === 1 && office.unsent![0].from === office.unsent![0].to ? 'hasn’t' : 'haven’t'} gone to the office printer yet.</p>
          )}
        </div>
        <div className="w-full shrink-0 sm:w-36 sm:text-right">
          <p className="text-sm tabular-nums text-zinc-400">
            {finished
              ? <span className="font-medium text-emerald-400">All {run.totalLabels.toLocaleString()} printed</span>
              : <><span className="font-medium text-zinc-100">{shown.toLocaleString()}</span> of {run.totalLabels.toLocaleString()} printed</>}
          </p>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-800" aria-hidden="true">
            <div className={`h-full rounded-full ${run.status === 'cancelled' ? 'bg-zinc-500' : finished ? 'bg-emerald-400' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
          </div>
          {waitingLine && !finished && <p className="mt-1 text-xs tabular-nums text-zinc-400">{waitingLine}</p>}
        </div>
      </Link>
      <Menu
        label={`More for ${run.name}`}
        showLabel={false}
        className="max-sm:absolute max-sm:right-2 max-sm:top-2"
        items={[
          ...(onTogglePin ? [{ label: pinned ? 'Unpin' : 'Pin to top', icon: pinned ? <PinOff className="h-4 w-4 text-zinc-400" aria-hidden="true" /> : <Pin className="h-4 w-4 text-zinc-400" aria-hidden="true" />, onSelect: onTogglePin }] : []),
          { label: 'Re-run with the same data', icon: <Copy className="h-4 w-4 text-zinc-400" aria-hidden="true" />, href: `/runs/new?duplicateFrom=${run.id}` },
          ...(unfinished && run.status !== 'printing' ? [{ label: 'Cancel run…', icon: <X className="h-4 w-4" aria-hidden="true" />, danger: true, onSelect: () => void cancelRun() }] : []),
          // A run with print history can't be deleted (it's kept for your records).
          ...(run.hasPrintHistory ? [] : [{ label: 'Delete run', icon: <Trash2 className="h-4 w-4" aria-hidden="true" />, danger: true, onSelect: onDelete }]),
        ]}
      />
    </div>
  );
}
