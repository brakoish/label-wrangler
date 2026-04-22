/**
 * Small offline-friendly queue for run updates.
 *
 * Problem we solve: during a long print run, losing the network for a few
 * seconds shouldn't nuke progress tracking. The print queue keeps going
 * regardless (it only talks to the printer, not the DB), but the
 * fire-and-forget `updateRun` calls to persist `printedCount` / `status`
 * were silently swallowed on failure.
 *
 * This module wraps persistence calls so:
 *  - A failed PUT is serialized into localStorage under `lw:pending-run-ops`.
 *  - Subsequent calls for the same run MERGE with any pending entry (we
 *    only need the LATEST printed count, not every intermediate step).
 *  - `flushOfflineQueue()` replays everything on reconnect / startup.
 *
 * Deliberately minimal:
 *  - Only queues run updates. Formats / templates / presets aren't
 *    long-running so they don't need the same protection today.
 *  - No timestamps / conflict resolution — the client is the source of
 *    truth for progress during a print, and the printer is the only
 *    authoritative producer of "I printed N more labels" data.
 */

import type { Run, RunStatus } from './types';

const STORAGE_KEY = 'lw:pending-run-ops';

/** The subset of run fields we persist offline. Keep it small so the
 *  localStorage payload stays tiny even during big runs. */
export interface RunPatch {
  printedCount?: number;
  status?: RunStatus;
  completedAt?: string | null;
  notes?: string | null;
}

/** A queued patch carries the target runId so we can replay it later. */
export interface QueuedRunPatch extends RunPatch {
  runId: string;
}

/** Internal shape: keyed by runId so repeated updates coalesce. */
type QueueMap = Record<string, QueuedRunPatch>;

function readQueue(): QueueMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as QueueMap;
    }
    return {};
  } catch {
    return {};
  }
}

function writeQueue(q: QueueMap): void {
  if (typeof window === 'undefined') return;
  try {
    // Prune empty entries so the key doesn't grow forever.
    const compact: QueueMap = {};
    for (const [k, v] of Object.entries(q)) {
      if (v && (v.printedCount !== undefined || v.status !== undefined
        || v.completedAt !== undefined || v.notes !== undefined)) {
        compact[k] = v;
      }
    }
    if (Object.keys(compact).length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
    }
  } catch {
    /* quota exceeded / private mode — swallow */
  }
}

/** Merge a patch into the pending queue. Call when a PUT fails. */
export function enqueueRunPatch(patch: QueuedRunPatch): void {
  const q = readQueue();
  const existing = q[patch.runId] || { runId: patch.runId };
  q[patch.runId] = { ...existing, ...patch };
  writeQueue(q);
}

/**
 * Attempt a run update with automatic offline queueing. Returns the parsed
 * response on success; returns `null` on network failure and adds the patch
 * to the pending queue so it can be replayed later.
 */
export async function updateRunWithQueue(
  runId: string,
  patch: RunPatch,
): Promise<Run | null> {
  try {
    const res = await fetch(`/api/runs/${runId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      // 4xx/5xx — don't queue, this is a real server error we want surfaced.
      return null;
    }
    return (await res.json()) as Run;
  } catch {
    // Fetch threw (offline / DNS / abort). Queue and move on.
    enqueueRunPatch({ runId, ...patch });
    return null;
  }
}

/**
 * Replay every pending run patch against the API. Clears entries that
 * succeed; leaves the rest in the queue for the next attempt.
 * Returns a count of how many patches were flushed.
 */
export async function flushOfflineQueue(): Promise<{ flushed: number; remaining: number }> {
  const q = readQueue();
  const entries = Object.entries(q);
  if (entries.length === 0) return { flushed: 0, remaining: 0 };
  let flushed = 0;
  const remaining: QueueMap = {};
  for (const [runId, patch] of entries) {
    try {
      const { runId: _ignore, ...body } = patch;
      const res = await fetch(`/api/runs/${runId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        flushed++;
      } else {
        // Keep the patch; 4xx likely means run was deleted — we could
        // drop in that case, but being conservative is safer.
        remaining[runId] = patch;
      }
    } catch {
      remaining[runId] = patch;
    }
  }
  writeQueue(remaining);
  return { flushed, remaining: Object.keys(remaining).length };
}

/** Number of pending patches. UI surfaces this to let users know there's
 *  unsaved progress. */
export function pendingPatchCount(): number {
  return Object.keys(readQueue()).length;
}
