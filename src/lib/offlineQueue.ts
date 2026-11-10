/** Durable, append-only progress outbox. Each acknowledgement removes only its
 * own operation; a reconnect can never erase a newer pending update. */
import type { Run, RunStatus, RunPrintEvent } from './types';
import { ORIGIN_NOT_ALLOWED } from './errorCodes';
import { RUN_CLIENT_HEADER, RUN_CLIENT_VERSION } from './runClientVersion';

/**
 * Two namespaces, so a rollback to the previous build (main, ffda577) is
 * safe. Main's outbox reads every key starting with PREFIX under the same
 * lock and stops its whole queue on any refusal, so only operations main can
 * send are stored there: ordinary progress and print events, which main then
 * sends too, so nothing pending is lost on a rollback. Operations main would
 * refuse (a guarded rewind and its 'rewind' print event) live under
 * NEW_PREFIX, which main never reads ('lw:run-op-v2:' does not start with
 * 'lw:run-op:'). This build reads both and keeps them in one order per run.
 */
const PREFIX = 'lw:run-op:';
const NEW_PREFIX = 'lw:run-op-v2:';
const DEAD = 'lw:run-op-dead:';
/** What main's print-events route accepts (anything else it refuses with 400). */
const MAIN_EVENT_TYPES: ReadonlySet<string> = new Set(['opened', 'sent', 'confirmed', 'failed', 'cancelled']);
const MAIN_OUTPUTS: ReadonlySet<string> = new Set(['roll-zpl', 'sheet-pdf', 'roll-pdf', 'scan', 'office-pi']);
/** Main's refusal of the rewind fields: 400 "Invalid field resetProgress". */
const MAIN_REFUSES_REWIND = /Invalid field (resetProgress|expectedPrintedCount)/;
const LEGACY = 'lw:pending-run-ops';
/** Responses that will never succeed on retry. These operations are set aside
 * (dead-lettered) so they stop blocking newer progress. Network failures,
 * 401 (sign in again), 408, 429 and 5xx keep retrying in order. A 403 that the
 * server marks as an origin refusal (code ORIGIN_NOT_ALLOWED) is not terminal
 * either: it blocks that run until the app is opened at its usual address. */
export const TERMINAL_STATUSES: ReadonlySet<number> = new Set([400, 403, 404, 409, 410, 413, 415, 422]);
export interface DeadLetter {
  id: string;
  runId: string | null;
  /** rewind-dropped: a "go back to label N" saved while offline that was not
   * applied, because another device moved this run's progress since. */
  kind: 'progress' | 'event' | 'unreadable' | 'rewind-dropped';
  status: number | null;
  /** Plain words for people. */
  message: string;
  /** What the server said, kept for the exported file only (never shown). */
  serverMessage?: string;
  deadAt: string;
  /** The original operation (or raw stored text when it could not be read). */
  op: unknown;
}
export interface RunPatch {
  printedCount?: number;
  status?: RunStatus;
  completedAt?: string | null;
  notes?: string | null;
  /** Explicit rewind of the resume position. Without it the server keeps the
   * highest printedCount it has seen. */
  resetProgress?: boolean;
  /** With resetProgress: the progress this device saw when someone asked to
   * go back. The server applies the rewind only if its stored count still
   * matches (compare-and-set), so a rewind that arrives late never erases
   * progress another device made since; otherwise it answers 409 and the
   * rewind is set aside with a plain notice. */
  expectedPrintedCount?: number;
}
export interface QueuedRunPatch extends RunPatch { runId: string }
type PrintEventData = Omit<RunPrintEvent,'id'|'runId'|'createdAt'>;
/** v: the rules the update was written for (runClientVersion). Updates an
 * older tab saved have none, and are sent as that code meant them.
 * then: a print event that is due only once this update is accepted (the
 * 'rewind' event of a "go back"). It is kept in the outbox with the update,
 * so it is recorded even if the tab closes before sync, and it is never sent
 * when the update is set aside. */
type Operation = { id: string; createdAt: number; patch: QueuedRunPatch; event?: PrintEventData; then?: PrintEventData; v?: number };
type Stored = Operation & { key: string };
/** True when main (ffda577) could send this operation as it is. */
function mainCanSend(op: Pick<Operation, 'patch' | 'event' | 'then'>): boolean {
  if (op.event) return MAIN_EVENT_TYPES.has(String(op.event.eventType)) && MAIN_OUTPUTS.has(String(op.event.output));
  return !op.then && !op.patch.resetProgress && op.patch.expectedPrintedCount === undefined;
}
function storageKey(op: Operation): string {
  return (mainCanSend(op) ? PREFIX : NEW_PREFIX) + op.id;
}
const syncedEvents = new Map<string,RunPrintEvent>();
let flushing: Promise<{ flushed: number; remaining: number }> | null = null;
let lastError = '';
let lastTime = 0;
const syncedRuns = new Map<string, Run>();
/** Plain reasons for operations set aside during a flush, by operation id, so
 * the caller that queued one can tell its own update was refused. */
const setAsideOps = new Map<string, string>();
const rewindDropOps = new Set<string>();
/** Operations a flush has tried to send (cleared by the caller that queued them). */
const attemptedOps = new Set<string>();
export const QUEUE_EVENT = 'lw:progress-sync';
function announce(error = '') {
  lastError = error;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(QUEUE_EVENT));
}
export function progressSyncError() { return lastError; }
function plainReason(status: number | null): string {
  return status === 404 || status === 410 ? 'The run no longer exists. It may have been deleted on another device.'
    : status === 403 ? 'Your account does not have permission to record this.'
    : status === 409 ? 'This update conflicts with one the server already saved.'
    : status === 400 || status === 422 ? 'The server rejected this update as invalid (for example, the run is now shorter than the saved progress).'
    : status === 413 || status === 415 ? 'The server could not accept this update in the form it was saved on this device.'
    : 'This saved update could not be read.';
}
/** Words for a rewind that was not applied (see RunPatch.expectedPrintedCount). */
export function rewindDroppedMessage(goBackTo: number, serverPrinted: number | null): string {
  const now = serverPrinted === null ? '' : ` (now ${serverPrinted.toLocaleString('en-US')} printed)`;
  return `“Go back to label ${goBackTo + 1}” wasn’t applied, because this run’s progress changed on another device since${now}. Check the run, then go back again if you still need to.`;
}
/** Words for a go-back that reached a server rolled back to the previous build. */
export function rewindNeedsReloadMessage(goBackTo: number): string {
  return `“Go back to label ${(goBackTo + 1).toLocaleString('en-US')}” wasn’t applied, because Label Wrangler was changed back to an earlier version. Reload the page, then go back again if you still need to.`;
}
/** The operation as it was stored (without the storage key this module adds). */
function storedOp(op: Stored): Operation {
  const { key: _key, ...rest } = op;
  return rest;
}
function deadLetter(key: string, entry: Omit<DeadLetter,'deadAt'>) {
  const storage = window.localStorage;
  // Write the dead letter before removing the live copy so nothing is lost if
  // storage fails between the two steps.
  storage.setItem(DEAD + entry.id, JSON.stringify({ ...entry, deadAt: new Date().toISOString() }));
  storage.removeItem(key);
}
function entries(): Stored[] {
  if (typeof window === 'undefined') return [];
  const storage = window.localStorage;
  const result: Stored[] = [];
  const unreadable: Array<[string, string | null]> = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(PREFIX) && !key?.startsWith(NEW_PREFIX)) continue;
    const raw = storage.getItem(key);
    let op: Operation | null = null;
    try { op = JSON.parse(raw!); } catch { op = null; }
    if (!op?.id || !op?.patch?.runId) { unreadable.push([key, raw]); continue; }
    result.push({ ...op, key });
  }
  // A corrupt entry must not block every later update: keep it for export.
  for (const [key, raw] of unreadable) {
    try { deadLetter(key, { id: key.slice(key.startsWith(NEW_PREFIX) ? NEW_PREFIX.length : PREFIX.length) || crypto.randomUUID(), runId: null, kind: 'unreadable', status: null, message: plainReason(null), op: raw }); }
    catch { throw new Error('Saved print progress needs recovery. Do not clear browser storage.'); }
  }
  return result.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
/** Updates the server permanently refused. They never block printing. */
export function deadLetteredOps(): DeadLetter[] {
  if (typeof window === 'undefined') return [];
  const storage = window.localStorage;
  const result: DeadLetter[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(DEAD)) continue;
    try { const item = JSON.parse(storage.getItem(key)!); if (item?.id) result.push(item); }
    catch { result.push({ id: key.slice(DEAD.length), runId: null, kind: 'unreadable', status: null, message: plainReason(null), deadAt: '', op: storage.getItem(key) }); }
  }
  return result.sort((a, b) => a.deadAt.localeCompare(b.deadAt) || a.id.localeCompare(b.id));
}
export function exportDeadLetters(): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), app: 'label-wrangler', setAsideUpdates: deadLetteredOps() }, null, 2);
}
export function discardDeadLetters(ids?: string[]) {
  if (typeof window === 'undefined') return;
  for (const item of deadLetteredOps()) if (!ids || ids.includes(item.id)) window.localStorage.removeItem(DEAD + item.id);
  announce(lastError);
}
export function enqueueRunPatch(patch: QueuedRunPatch, event?: PrintEventData, older = false, then?: PrintEventData): string {
  const id = crypto.randomUUID();
  try {
    const op: Operation = { id, createdAt: (lastTime = Math.max(performance.timeOrigin + performance.now(), lastTime + 0.001)), patch, ...(event ? { event } : {}), ...(then && !event ? { then } : {}), ...(older ? {} : { v: RUN_CLIENT_VERSION }) };
    window.localStorage.setItem(storageKey(op), JSON.stringify(op));
    announce();
    return id;
  } catch {
    announce('Print progress could not be stored on this device. Pause printing and keep this tab open.');
    throw new Error(lastError);
  }
}
function migrate() {
  // Go-backs saved by the previous build of this branch sit under main's
  // prefix: move them where main never reads them (same id, same order).
  const storage = window.localStorage;
  const misplaced: Array<[string, Operation]> = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try { const op = JSON.parse(storage.getItem(key)!) as Operation; if (op?.id && op?.patch?.runId && !mainCanSend(op)) misplaced.push([key, op]); } catch { /* entries() sets it aside */ }
  }
  for (const [key, op] of misplaced) { storage.setItem(NEW_PREFIX + op.id, JSON.stringify(op)); storage.removeItem(key); }
  const raw = window.localStorage.getItem(LEGACY);
  if (!raw) return;
  const queue = JSON.parse(raw);
  // Saved by older code: sent as that code meant it (exact counts).
  for (const patch of Object.values(queue) as QueuedRunPatch[]) enqueueRunPatch(patch, undefined, true);
  window.localStorage.removeItem(LEGACY);
}
/** Live (still retrying) operations, optionally for one run only. Set-aside
 * operations are not counted, so they never block new printing. */
export function pendingPatchCount(runId?: string): number {
  try {
    const live = entries().filter(op => runId === undefined || op.patch.runId === runId).length;
    const legacy = typeof window !== 'undefined' && window.localStorage.getItem(LEGACY) ? 1 : 0;
    return live + legacy;
  }
  catch { return 1; }
}
async function serverError(response: Response): Promise<{ message: string; code: string; printedCount?: number }> {
  try {
    const data = await response.json();
    return { message: typeof data?.error === 'string' ? data.error : '', code: typeof data?.code === 'string' ? data.code : '', ...(Number.isInteger(data?.printedCount) ? { printedCount: data.printedCount } : {}) };
  } catch { return { message: '', code: '' }; }
}
export const ORIGIN_REFUSED_MESSAGE = 'Print progress can\u2019t be saved from this web address. Open Label Wrangler at its usual address; your progress is kept on this device until then.';
export async function flushOfflineQueue(): Promise<{ flushed: number; remaining: number }> {
  if (typeof window === 'undefined') return { flushed: 0, remaining: 0 };
  if (flushing) return flushing;
  const drain = async () => {
    let flushed = 0;
    try {
      migrate();
      // Re-read after each response so concurrent enqueues are included. The
      // browser lock serializes senders across tabs, not just this module.
      // Order is kept per run: a retryable failure stops later updates for
      // that run only, so one run cannot block every other run.
      const blocked = new Set<string>();
      let pendingError = '';
      for (let i = 0; i < 1000; i++) {
        const op = entries().find(candidate => !blocked.has(candidate.patch.runId));
        if (!op) break;
        const { runId, ...patch } = op.patch;
        // expectedPrintedCount only ever travels with a rewind.
        if (!patch.resetProgress) delete patch.expectedPrintedCount;
        attemptedOps.add(op.id);
        if (attemptedOps.size > 512) attemptedOps.delete(attemptedOps.values().next().value!);
        const send = (body: unknown) => fetch(`/api/runs/${runId}${op.event ? '/print-events' : ''}`, {
          method: op.event ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json', ...((op.v ?? 0) >= RUN_CLIENT_VERSION ? { [RUN_CLIENT_HEADER]: String(RUN_CLIENT_VERSION) } : {}) },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        });
        let response: Response;
        let refused: Awaited<ReturnType<typeof serverError>> = { message: '', code: '' };
        try {
          response = await send(op.event ? {...op.event,idempotencyKey:op.id} : { ...patch, progressOnly: !patch.status && patch.printedCount !== undefined });
          if (!response.ok) refused = await serverError(response);
        } catch {
          blocked.add(runId);
          pendingError = 'Progress sync pending. You seem to be offline; it sends when the connection is back.';
          continue;
        }
        // Rolled back to main, which has no guarded rewind and refuses its
        // fields. Sending it again as main's exact write would drop the
        // compare-and-set and could erase progress another device made since,
        // so it is set aside with plain words: reload, then go back again.
        if (!op.event && response.status === 400 && patch.resetProgress && MAIN_REFUSES_REWIND.test(refused.message)) {
          const message = rewindNeedsReloadMessage(patch.printedCount ?? 0);
          deadLetter(op.key, { id: op.id, runId, kind: 'rewind-dropped', status: 400, message, serverMessage: refused.message.slice(0, 500), op: storedOp(op) });
          syncedRuns.delete(runId);
          setAsideOps.set(op.id, message);
          rewindDropOps.add(op.id);
          if (setAsideOps.size > 128) setAsideOps.delete(setAsideOps.keys().next().value!);
          announce(pendingError);
          continue;
        }
        // Main refuses the informational 'rewind' event: drop it quietly.
        if (op.event && op.event.eventType === 'rewind' && response.status === 400) {
          window.localStorage.removeItem(op.key);
          announce(pendingError);
          continue;
        }
        // The rewind was applied, but its answer was lost (tab closed, timeout):
        // the server is already at the count asked for, so it counts as done.
        const alreadyApplied = !op.event && response.status === 409 && refused.code === 'progress_changed' && !!patch.resetProgress && refused.printedCount === patch.printedCount;
        if (!response.ok && !alreadyApplied) {
          // A guarded rewind the server didn't apply because progress moved
          // on another device since: set aside, with plain words.
          if (response.status === 409 && refused.code === 'progress_changed' && patch.resetProgress && !op.event) {
            const message = rewindDroppedMessage(patch.printedCount ?? 0, refused.printedCount ?? null);
            deadLetter(op.key, { id: op.id, runId, kind: 'rewind-dropped', status: 409, message, op: storedOp(op) });
            syncedRuns.delete(runId);
            setAsideOps.set(op.id, message);
            rewindDropOps.add(op.id);
            if (setAsideOps.size > 128) setAsideOps.delete(setAsideOps.keys().next().value!);
            announce(pendingError);
            continue;
          }
          if (response.status === 403 && refused.code === ORIGIN_NOT_ALLOWED) {
            // Not a permission problem: the app was opened at an address the
            // server doesn't accept. Keep the update and block this run.
            blocked.add(runId);
            pendingError = ORIGIN_REFUSED_MESSAGE;
            continue;
          }
          if (TERMINAL_STATUSES.has(response.status)) {
            const message = plainReason(response.status);
            deadLetter(op.key, { id: op.id, runId, kind: op.event ? 'event' : 'progress', status: response.status, message, ...(refused.message ? { serverMessage: refused.message.slice(0, 500) } : {}), op: storedOp(op) });
            // The last good response may be older than the refused update.
            if (!op.event) {
              syncedRuns.delete(runId);
              setAsideOps.set(op.id, message);
              if (setAsideOps.size > 128) setAsideOps.delete(setAsideOps.keys().next().value!);
            }
            announce(pendingError);
            continue;
          }
          blocked.add(runId);
          pendingError = response.status === 401 ? 'Sign in again to sync saved print progress.' : `Print progress is saved on this device but not synced (${response.status}). Retry when the connection is restored.`;
          continue;
        }
        const run = alreadyApplied ? null : await response.json?.().catch(()=>null);
        if (op.event && run?.id) { syncedEvents.set(op.id,run); if(syncedEvents.size>128) syncedEvents.delete(syncedEvents.keys().next().value!); window.dispatchEvent(new CustomEvent('lw:event-synced',{detail:run})); }
        else if (run?.id) { syncedRuns.set(run.id,run); window.dispatchEvent(new CustomEvent('lw:run-synced',{detail:run})); }
        else if (alreadyApplied) syncedRuns.delete(runId);
        if (op.then && !op.event) {
          // The update is accepted: its print event takes its place, first in
          // this run's order, under the same id (its idempotency key).
          const next: Operation = { id: op.id, createdAt: op.createdAt, patch: { runId }, event: op.then, ...(op.v !== undefined ? { v: op.v } : {}) };
          const nextKey = storageKey(next);
          window.localStorage.setItem(nextKey, JSON.stringify(next));
          if (nextKey !== op.key) window.localStorage.removeItem(op.key);
        } else window.localStorage.removeItem(op.key);
        flushed++;
        announce(pendingError);
      }
      announce(pendingError);
    } catch (error) {
      announce(error instanceof Error && /recovery/.test(error.message) ? error.message : 'Progress sync pending. Keep this browser data.');
    }
    return { flushed, remaining: pendingPatchCount() };
  };
  flushing = (typeof navigator !== 'undefined' && navigator.locks
    ? Promise.resolve(navigator.locks.request('lw-progress-outbox', drain)).then(result => result) : drain());
  try { return await flushing; } finally { flushing = null; }
}
/**
 * Queue a run update and try to send it. Resolves to the server's run, or null
 * when it is still pending or was set aside. When the server permanently
 * refused this update, `onSetAside` gets the plain reason (and the stale
 * cached run is not returned).
 */
export async function updateRunWithQueue(runId: string, patch: RunPatch, onSetAside?: (reason: string) => void, then?: PrintEventData): Promise<Run | null> {
  const id = enqueueRunPatch({ runId, ...patch }, undefined, false, then);
  await flushOfflineQueue();
  // A flush that was already finishing when this was queued may have missed
  // it: send once more so the caller's own update isn't left behind.
  if (!attemptedOps.has(id)) await flushOfflineQueue();
  attemptedOps.delete(id);
  const refused = setAsideOps.get(id);
  if (refused !== undefined) {
    setAsideOps.delete(id);
    // A dropped "go back" the page is told about right away needs no second,
    // app-wide notice; one that drops later (offline) still gets it.
    if (rewindDropOps.delete(id) && onSetAside) discardDeadLetters([id]);
    onSetAside?.(refused);
    return null;
  }
  // Callers should display pendingPatchCount rather than implying that local
  // printer acceptance means the server has persisted progress.
  return entries().some(op=>op.patch.runId===runId) ? null : syncedRuns.get(runId) ?? null;
}

/** True while a "go back" for this run (or its print event) is still in the outbox. */
export function rewindPending(runId: string): boolean {
  try { return entries().some((op) => op.patch.runId === runId && (op.event ? op.event.eventType === 'rewind' : !!op.patch.resetProgress)); }
  catch { return false; }
}

export async function savePrintEvent(runId: string, event: PrintEventData): Promise<RunPrintEvent | null> {
  const id=enqueueRunPatch({runId},event);
  await flushOfflineQueue();
  const saved=syncedEvents.get(id) ?? null;
  syncedEvents.delete(id);
  return saved;
}
