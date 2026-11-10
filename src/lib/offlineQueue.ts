/** Durable, append-only progress outbox. Each acknowledgement removes only its
 * own operation; a reconnect can never erase a newer pending update. */
import type { Run, RunStatus, RunPrintEvent } from './types';

const PREFIX = 'lw:run-op:';
const DEAD = 'lw:run-op-dead:';
const LEGACY = 'lw:pending-run-ops';
/** Responses that will never succeed on retry. These operations are set aside
 * (dead-lettered) so they stop blocking newer progress. Network failures,
 * 401 (sign in again), 408, 429 and 5xx keep retrying in order. */
export const TERMINAL_STATUSES: ReadonlySet<number> = new Set([400, 403, 404, 409, 410, 422]);
export interface DeadLetter {
  id: string;
  runId: string | null;
  kind: 'progress' | 'event' | 'unreadable';
  status: number | null;
  message: string;
  deadAt: string;
  /** The original operation (or raw stored text when it could not be read). */
  op: unknown;
}
export interface RunPatch {
  printedCount?: number;
  status?: RunStatus;
  completedAt?: string | null;
  notes?: string | null;
}
export interface QueuedRunPatch extends RunPatch { runId: string }
type PrintEventData = Omit<RunPrintEvent,'id'|'runId'|'createdAt'>;
type Operation = { id: string; createdAt: number; patch: QueuedRunPatch; event?: PrintEventData };
const syncedEvents = new Map<string,RunPrintEvent>();
let flushing: Promise<{ flushed: number; remaining: number }> | null = null;
let lastError = '';
let lastTime = 0;
const syncedRuns = new Map<string, Run>();
export const QUEUE_EVENT = 'lw:progress-sync';
function announce(error = '') {
  lastError = error;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(QUEUE_EVENT));
}
export function progressSyncError() { return lastError; }
function plainReason(status: number | null, serverMessage: string): string {
  const reason = status === 404 || status === 410 ? 'The run no longer exists. It may have been deleted on another device.'
    : status === 403 ? 'Your account does not have permission to record this.'
    : status === 409 ? 'This update conflicts with one the server already saved.'
    : status === 400 || status === 422 ? 'The server rejected this update as invalid (for example, the run is now shorter than the saved progress).'
    : 'This saved update could not be read.';
  return serverMessage ? `${reason} Server said: ${serverMessage.slice(0, 200)}` : reason;
}
function deadLetter(key: string, entry: Omit<DeadLetter,'deadAt'>) {
  const storage = window.localStorage;
  // Write the dead letter before removing the live copy so nothing is lost if
  // storage fails between the two steps.
  storage.setItem(DEAD + entry.id, JSON.stringify({ ...entry, deadAt: new Date().toISOString() }));
  storage.removeItem(key);
}
function entries(): Operation[] {
  if (typeof window === 'undefined') return [];
  const storage = window.localStorage;
  const result: Operation[] = [];
  const unreadable: Array<[string, string | null]> = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    const raw = storage.getItem(key);
    let op: Operation | null = null;
    try { op = JSON.parse(raw!); } catch { op = null; }
    if (!op?.id || !op?.patch?.runId) { unreadable.push([key, raw]); continue; }
    result.push(op);
  }
  // A corrupt entry must not block every later update: keep it for export.
  for (const [key, raw] of unreadable) {
    try { deadLetter(key, { id: key.slice(PREFIX.length) || crypto.randomUUID(), runId: null, kind: 'unreadable', status: null, message: plainReason(null, ''), op: raw }); }
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
    catch { result.push({ id: key.slice(DEAD.length), runId: null, kind: 'unreadable', status: null, message: plainReason(null, ''), deadAt: '', op: storage.getItem(key) }); }
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
export function enqueueRunPatch(patch: QueuedRunPatch, event?: PrintEventData): string {
  const id = crypto.randomUUID();
  try {
    window.localStorage.setItem(PREFIX + id, JSON.stringify({ id, createdAt: (lastTime = Math.max(performance.timeOrigin + performance.now(), lastTime + 0.001)), patch, event }));
    announce();
    return id;
  } catch {
    announce('Print progress could not be stored on this device. Pause printing and keep this tab open.');
    throw new Error(lastError);
  }
}
function migrate() {
  const raw = window.localStorage.getItem(LEGACY);
  if (!raw) return;
  const queue = JSON.parse(raw);
  for (const patch of Object.values(queue) as QueuedRunPatch[]) enqueueRunPatch(patch);
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
async function serverError(response: Response): Promise<string> {
  try { const data = await response.json(); return typeof data?.error === 'string' ? data.error : ''; } catch { return ''; }
}
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
        let response: Response;
        try {
          response = await fetch(`/api/runs/${runId}${op.event ? '/print-events' : ''}`, {
            method: op.event ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(op.event ? {...op.event,idempotencyKey:op.id} : { ...patch, progressOnly: !patch.status && patch.printedCount !== undefined }),
            signal: AbortSignal.timeout(15000),
          });
        } catch (error) {
          blocked.add(runId);
          pendingError = error instanceof Error ? `Progress sync pending: ${error.message}` : 'Progress sync pending. Keep this browser data.';
          continue;
        }
        if (!response.ok) {
          if (TERMINAL_STATUSES.has(response.status)) {
            deadLetter(PREFIX + op.id, { id: op.id, runId, kind: op.event ? 'event' : 'progress', status: response.status, message: plainReason(response.status, await serverError(response)), op });
            announce(pendingError);
            continue;
          }
          blocked.add(runId);
          pendingError = response.status === 401 ? 'Sign in again to sync saved print progress.' : `Print progress is saved on this device but not synced (${response.status}). Retry when the connection is restored.`;
          continue;
        }
        const run = await response.json?.().catch(()=>null);
        if (op.event && run?.id) { syncedEvents.set(op.id,run); if(syncedEvents.size>128) syncedEvents.delete(syncedEvents.keys().next().value!); window.dispatchEvent(new CustomEvent('lw:event-synced',{detail:run})); }
        else if (run?.id) { syncedRuns.set(run.id,run); window.dispatchEvent(new CustomEvent('lw:run-synced',{detail:run})); }
        window.localStorage.removeItem(PREFIX + op.id);
        flushed++;
        announce(pendingError);
      }
      announce(pendingError);
    } catch (error) {
      announce(error instanceof Error ? `Progress sync pending: ${error.message}` : 'Progress sync pending. Keep this browser data.');
    }
    return { flushed, remaining: pendingPatchCount() };
  };
  flushing = (typeof navigator !== 'undefined' && navigator.locks
    ? Promise.resolve(navigator.locks.request('lw-progress-outbox', drain)).then(result => result) : drain());
  try { return await flushing; } finally { flushing = null; }
}
export async function updateRunWithQueue(runId: string, patch: RunPatch): Promise<Run | null> {
  enqueueRunPatch({ runId, ...patch });
  await flushOfflineQueue();
  // Callers should display pendingPatchCount rather than implying that local
  // printer acceptance means the server has persisted progress.
  return entries().some(op=>op.patch.runId===runId) ? null : syncedRuns.get(runId) ?? null;
}

export async function savePrintEvent(runId: string, event: PrintEventData): Promise<RunPrintEvent | null> {
  const id=enqueueRunPatch({runId},event);
  await flushOfflineQueue();
  const saved=syncedEvents.get(id) ?? null;
  syncedEvents.delete(id);
  return saved;
}
