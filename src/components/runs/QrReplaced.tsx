'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { LabelTemplate, Run } from '@/lib/types';
import { useRunStore } from '@/lib/runStore';
import { confirmDialog } from '@/components/ui/feedback';
import { readOfficeJobs } from './officeCancel';

/**
 * "Use a QR code instead" on a run page makes a new run with the same data
 * (in the new-run page), where the barcode becomes a QR code. The old run is
 * then still Ready, so two runs could print the same labels. The link marks
 * the old run in this tab; the new run's page then offers to cancel it (one
 * tap and a confirm), and the old run's page says a QR run replaced it.
 * Kept on this device; cancelling the old run is a normal cancel that every
 * device sees.
 */
const FROM_KEY = 'lw:qr-from';
const replacesKey = (runId: string) => `lw:qr-replaces:${runId}`;
const replacedByKey = (runId: string) => `lw:qr-replaced-by:${runId}`;
/** How long after the press a new run still counts as made from it. */
const FROM_WINDOW_MS = 2 * 60 * 60_000;

interface RunRef { id: string; name: string }

function readRef(storage: Storage | null, key: string): RunRef | null {
  try {
    const data = JSON.parse(storage?.getItem(key) || 'null') as { id?: unknown; name?: unknown } | null;
    return data && typeof data.id === 'string' && typeof data.name === 'string' ? { id: data.id, name: data.name } : null;
  } catch { return null; }
}
const local = () => (typeof window !== 'undefined' ? window.localStorage : null);
const session = () => (typeof window !== 'undefined' ? window.sessionStorage : null);

/** Called when "Use a QR code instead" is pressed on `run`'s page. */
export function markQrFrom(run: Pick<Run, 'id' | 'name'>): void {
  try { session()?.setItem(FROM_KEY, JSON.stringify({ id: run.id, name: run.name, at: Date.now() })); } catch { /* storage off: no offer */ }
}

export function QrReplaced({ run, template }: { run: Run; template: Pick<LabelTemplate, 'elements'> }) {
  const { runs, fetchRun, setRunStatus } = useRunStore();
  const [replaces, setReplaces] = useState<RunRef | null>(null);
  const [replacedBy, setReplacedBy] = useState<RunRef | null>(null);
  const [note, setNote] = useState<{ text: string; href?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const hasQr = template.elements.some((el) => el.type === 'qr');

  useEffect(() => {
    let mine: RunRef | null = null;
    try {
      const raw = JSON.parse(session()?.getItem(FROM_KEY) || 'null') as { id?: unknown; name?: unknown; at?: unknown } | null;
      const at = typeof raw?.at === 'number' ? raw.at : 0;
      const made = Date.parse(run.createdAt);
      if (raw && typeof raw.id === 'string' && typeof raw.name === 'string' && raw.id !== run.id && hasQr
        && Date.now() - at < FROM_WINDOW_MS && Number.isFinite(made) && made >= at - 60_000) {
        mine = { id: raw.id, name: raw.name };
        local()?.setItem(replacesKey(run.id), JSON.stringify(mine));
        local()?.setItem(replacedByKey(raw.id), JSON.stringify({ id: run.id, name: run.name }));
        session()?.removeItem(FROM_KEY);
      }
    } catch { /* storage off: no offer */ }
    setReplaces(mine ?? readRef(local(), replacesKey(run.id)));
    setReplacedBy(readRef(local(), replacedByKey(run.id)));
  }, [run.id, run.name, run.createdAt, hasQr]);

  const old = replaces ? runs.find((r) => r.id === replaces.id) ?? null : null;
  useEffect(() => { if (replaces && !old) void fetchRun(replaces.id).catch(() => { /* offer stays, named from storage */ }); }, [replaces, old, fetchRun]);
  const oldOpen = !!replaces && (!old || (old.status !== 'cancelled' && old.status !== 'completed' && (old.printedCount || 0) < old.totalLabels));

  const forget = () => { try { if (replaces) local()?.removeItem(replacesKey(run.id)); } catch { /* nothing saved */ } setReplaces(null); };
  const cancelOld = async () => {
    if (!replaces || busy) return;
    const ok = await confirmDialog({ title: `Cancel “${replaces.name}”?`, body: 'Its labels won’t print. Labels it already printed stay counted.', confirmLabel: 'Cancel the old run', danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      // Labels of the old run waiting at the office are its own page's choice (stop them or let them print).
      const jobs = await readOfficeJobs(replaces.id);
      const waiting = jobs?.some((j) => ['queued', 'claimed', 'submitted'].includes(j.state));
      if (!jobs || waiting) {
        setNote({ text: !jobs ? `Couldn’t check the office printer for “${replaces.name}”, so it wasn’t cancelled. Open it to cancel it.` : `“${replaces.name}” has labels waiting at the office printer, so it wasn’t cancelled here. Open it to cancel it.`, href: `/runs/${replaces.id}` });
        return;
      }
      const current = useRunStore.getState().runs.find((r) => r.id === replaces.id) ?? (await fetchRun(replaces.id).then(() => useRunStore.getState().runs.find((r) => r.id === replaces.id)).catch(() => undefined));
      const done = await setRunStatus(replaces.id, 'cancelled', current?.printedCount ?? undefined);
      if (done === null) { setNote({ text: `Couldn’t cancel “${replaces.name}”. Open it to cancel it.`, href: `/runs/${replaces.id}` }); return; }
      setNote({ text: `Cancelled “${replaces.name}”.` });
      forget();
    } catch {
      setNote({ text: `Couldn’t cancel “${replaces.name}”. Open it to cancel it.`, href: `/runs/${replaces.id}` });
    } finally { setBusy(false); }
  };

  if (note) return <p role="status" className="text-sm text-zinc-300">{note.text}{note.href && <> <Link href={note.href} className="link">Open “{replaces?.name ?? 'the old run'}”</Link></>}</p>;
  if (replaces && oldOpen) {
    return (
      <div className="space-y-1 text-sm">
        <p className="text-zinc-100">This run replaces “{replaces.name}”, which is still ready to print. Cancel it so its labels don’t print too.</p>
        <div className="flex flex-wrap items-center gap-x-2">
          <button type="button" disabled={busy} className="btn btn-secondary btn-sm" onClick={() => void cancelOld()}>Cancel the old run</button>
          <button type="button" disabled={busy} className="btn btn-ghost btn-sm text-zinc-300" onClick={forget}>Keep both</button>
        </div>
      </div>
    );
  }
  if (replacedBy && replacedBy.id !== run.id) {
    return <p className="text-sm text-zinc-300">A QR code run replaced this run: <Link href={`/runs/${replacedBy.id}`} className="link">{replacedBy.name}</Link>.</p>;
  }
  return null;
}
