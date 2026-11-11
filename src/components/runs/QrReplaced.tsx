'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Run } from '@/lib/types';
import { useRunStore } from '@/lib/runStore';
import { confirmDialog } from '@/components/ui/feedback';
import { readOfficeJobs } from './officeCancel';

/**
 * "Use a QR code instead" on a run page opens the new-run page with the same
 * data, where the barcode becomes a QR code. The old run is then still
 * ready, so two runs could print the same labels. Right after it creates
 * that run, the new-run page saves an explicit link on this device:
 * `lw:qr-replaces:<new run id>` = `<old run id>`. Only that link makes the
 * new run's page offer to cancel the old one (and only while the old run
 * exists, isn't printing and isn't finished), and only that link makes the
 * old run's page say a QR run replaced it. No clock guesses: a run made
 * any other way never offers to cancel another run.
 */
const REPLACES_PREFIX = 'lw:qr-replaces:';
const replacesKey = (runId: string) => `${REPLACES_PREFIX}${runId}`;

const local = () => (typeof window !== 'undefined' ? window.localStorage : null);

/** The old run's id this run replaces: the plain id the new-run page saves (or a record with that id). */
export function readQrReplaces(storage: Pick<Storage, 'getItem'> | null, runId: string): string | null {
  try {
    const raw = storage?.getItem(replacesKey(runId));
    let id = typeof raw === 'string' ? raw.trim() : '';
    // A plain id is what the new-run page saves; a {"id": …} record is read the same way.
    if (id.startsWith('{')) { try { const data = JSON.parse(id) as { id?: unknown }; id = typeof data?.id === 'string' ? data.id.trim() : ''; } catch { id = ''; } }
    return id && id !== runId && /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : null;
  } catch { return null; }
}

/** The runs that say they replace `runId` (normally one). */
export function readQrReplacedBy(storage: Pick<Storage, 'length' | 'key' | 'getItem'> | null, runId: string): string[] {
  const out: string[] = [];
  try {
    if (!storage) return out;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !key.startsWith(REPLACES_PREFIX)) continue;
      const newId = key.slice(REPLACES_PREFIX.length);
      if (newId && readQrReplaces(storage, newId) === runId) out.push(newId);
    }
  } catch { /* storage off: nothing to say */ }
  return out;
}

/** Whether the old run can still print labels the new run prints too: it exists, isn't printing, isn't finished or cancelled. */
export function qrOldRunOpen(old: Pick<Run, 'status' | 'printedCount' | 'totalLabels'> | null | undefined): boolean {
  return !!old && old.status !== 'printing' && old.status !== 'cancelled' && old.status !== 'completed' && (old.printedCount || 0) < old.totalLabels;
}

export function QrReplaced({ run }: { run: Run }) {
  const { runs, fetchRun, setRunStatus } = useRunStore();
  const [replacesId, setReplacesId] = useState<string | null>(null);
  const [replacedById, setReplacedById] = useState<string | null>(null);
  const [looked, setLooked] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState<{ text: string; href?: string; name?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setReplacesId(readQrReplaces(local(), run.id));
    setReplacedById(readQrReplacedBy(local(), run.id)[0] ?? null);
  }, [run.id]);

  // The other run is read once (one small request), so a deleted or unknown run offers nothing.
  useEffect(() => {
    for (const id of [replacesId, replacedById]) {
      if (!id || looked[id] || runs.some((r) => r.id === id)) continue;
      setLooked((m) => ({ ...m, [id]: true }));
      void fetchRun(id).catch(() => null);
    }
  }, [replacesId, replacedById, runs, looked, fetchRun]);

  const old = replacesId ? runs.find((r) => r.id === replacesId) ?? null : null;
  const newer = replacedById ? runs.find((r) => r.id === replacedById) ?? null : null;

  const keepBoth = () => {
    try { local()?.removeItem(replacesKey(run.id)); } catch { /* nothing saved */ }
    setReplacesId(null);
  };
  const cancelOld = async () => {
    if (!old || busy) return;
    const name = old.name;
    const ok = await confirmDialog({ title: `Cancel “${name}”?`, body: 'Its labels won’t print. Labels it already printed stay counted.', confirmLabel: 'Cancel the old run', cancelLabel: 'Keep it', danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      // Read the old run again: it may have started printing since this page loaded.
      const current = await fetchRun(old.id).catch(() => null);
      if (!current) { setNote({ text: `Couldn’t check “${name}”, so it wasn’t cancelled. Open it to cancel it.`, href: `/runs/${old.id}`, name }); return; }
      if (!qrOldRunOpen(current)) { setNote({ text: current.status === 'printing' ? `“${name}” is printing now, so it wasn’t cancelled here. Open it to stop it.` : `“${name}” isn’t waiting to print any more. Nothing was cancelled.`, href: `/runs/${old.id}`, name }); return; }
      // Labels of the old run waiting at the office are its own page's choice (stop them or let them print).
      const jobs = await readOfficeJobs(old.id);
      const waiting = jobs?.some((j) => ['queued', 'claimed', 'submitted'].includes(j.state));
      if (!jobs || waiting) {
        setNote({ text: !jobs ? `Couldn’t check the office printer for “${name}”, so it wasn’t cancelled. Open it to cancel it.` : `“${name}” has labels waiting at the office printer, so it wasn’t cancelled here. Open it to cancel it.`, href: `/runs/${old.id}`, name });
        return;
      }
      const done = await setRunStatus(old.id, 'cancelled', current.printedCount ?? undefined);
      if (done === null) { setNote({ text: `Couldn’t cancel “${name}”. Open it to cancel it.`, href: `/runs/${old.id}`, name }); return; }
      // The link stays, so the old run's page still says which run replaced it.
      setNote({ text: `Cancelled “${name}”.` });
    } catch {
      setNote({ text: `Couldn’t cancel “${name}”. Open it to cancel it.`, href: `/runs/${old.id}`, name });
    } finally { setBusy(false); }
  };

  if (note) return <p role="status" className="text-sm text-zinc-300">{note.text}{note.href && <> <Link href={note.href} className="link">Open “{note.name ?? 'the old run'}”</Link></>}</p>;
  if (old && qrOldRunOpen(old)) {
    return (
      <div className="space-y-1 text-sm">
        <p className="text-zinc-100">This run replaces “{old.name}”, which is still ready to print. Cancel it so its labels don’t print too.</p>
        <div className="flex flex-wrap items-center gap-x-2">
          <button type="button" disabled={busy} className="btn btn-secondary btn-sm" onClick={() => void cancelOld()}>Cancel the old run</button>
          <button type="button" disabled={busy} className="btn btn-ghost btn-sm text-zinc-300" onClick={keepBoth}>Keep both</button>
        </div>
      </div>
    );
  }
  if (newer) {
    return <p className="text-sm text-zinc-300">A QR code run replaced this run: <Link href={`/runs/${newer.id}`} className="link">{newer.name}</Link>.</p>;
  }
  return null;
}
