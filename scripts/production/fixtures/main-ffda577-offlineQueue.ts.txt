/** Durable, append-only progress outbox. Each acknowledgement removes only its
 * own operation; a reconnect can never erase a newer pending update. */
import type { Run, RunStatus, RunPrintEvent } from './types';

const PREFIX = 'lw:run-op:';
const LEGACY = 'lw:pending-run-ops';
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
function entries(): Operation[] {
  if (typeof window === 'undefined') return [];
  const storage = window.localStorage;
  const result: Operation[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    const op = JSON.parse(storage.getItem(key)!);
    if (!op?.id || !op?.patch?.runId) throw new Error('Saved print progress needs recovery. Do not clear browser storage.');
    result.push(op);
  }
  return result.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
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
export function pendingPatchCount(): number {
  try { return entries().length + (typeof window !== 'undefined' && window.localStorage.getItem(LEGACY) ? 1 : 0); }
  catch { return 1; }
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
      for (let i = 0; i < 1000; i++) {
        const op = entries()[0];
        if (!op) { announce(); break; }
        const { runId, ...patch } = op.patch;
        const response = await fetch(`/api/runs/${runId}${op.event ? '/print-events' : ''}`, {
          method: op.event ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(op.event ? {...op.event,idempotencyKey:op.id} : { ...patch, progressOnly: !patch.status && patch.printedCount !== undefined }),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          announce(response.status === 401 ? 'Sign in again to sync saved print progress.' : `Print progress is saved on this device but not synced (${response.status}). Retry when the connection is restored.`);
          break;
        }
        const run = await response.json?.().catch(()=>null);
        if (op.event && run?.id) { syncedEvents.set(op.id,run); if(syncedEvents.size>128) syncedEvents.delete(syncedEvents.keys().next().value!); window.dispatchEvent(new CustomEvent('lw:event-synced',{detail:run})); }
        else if (run?.id) { syncedRuns.set(run.id,run); window.dispatchEvent(new CustomEvent('lw:run-synced',{detail:run})); }
        window.localStorage.removeItem(PREFIX + op.id);
        flushed++;
        announce();
      }
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
