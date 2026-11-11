import type { Run } from './types';

/**
 * The explicit link between a QR run and the run it replaces, kept on this
 * device: the new-run page saves `lw:qr-replaces:<new run id>` = `<old run
 * id>` right after it creates a run from "Use a QR code instead".
 */
export const REPLACES_PREFIX = 'lw:qr-replaces:';
export const replacesKey = (runId: string) => `${REPLACES_PREFIX}${runId}`;

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

