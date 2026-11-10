'use client';
import { apiJson, ApiError } from './apiClient';
import { updateRunWithQueue, savePrintEvent } from './offlineQueue';
import { rewindEvent } from './runRewind';

import { create } from 'zustand';
import type { Run, RunPreset, RunPrintEvent, RunStatus } from './types';

/** A refused delete keeps the item. A 409 (still in use) is returned for the
 * page to show; other failures go to the store error banner as before. */
function deleteRefused(error: unknown, set: (partial: { error: string }) => void): string | null {
  const message = (error as Error).message;
  if (error instanceof ApiError && error.status === 409) return message;
  set({ error: message });
  return null;
}

interface RunStore {
  runs: Run[];
  presets: RunPreset[];
  printEvents: RunPrintEvent[];
  hydrated: boolean;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  offset: number;
  loadAll: (more?: boolean) => Promise<void>;
  fetchRun: (id: string) => Promise<Run | null>;
  /** Why the last single-run fetch failed, per run id (cleared on success). */
  runLoadErrors: Record<string, { status: number; message: string }>;

  // Runs
  createRun: (data: Partial<Run> & { name: string; templateId: string; fieldMappings?: Run['fieldMappings']; imageSelections?: import('./runImages').RunImageSelections; leaveOff?: string[] }) => Promise<Run>;
  updateRun: (id: string, updates: Partial<Run>) => Promise<Run | null>;
  /** `onSetAside` is called with a plain reason when the server permanently
   * refused this update (it was set aside, not saved). */
  setRunStatus: (id: string, status: RunStatus, printedCount?: number, options?: { resetProgress?: boolean; expectedPrintedCount?: number; onSetAside?: (reason: string) => void;
    /** A go-back the server already had (an earlier answer was lost): the server's count then, or null. */
    onAlreadyApplied?: (serverPrinted: number | null) => void }) => Promise<Run | null>;
  /**
   * Labels counted as printed (high-water: never lowers progress), with the
   * status changed only when `status` is given. For "mark printed" when
   * another device may be printing the run: its status is left alone.
   */
  recordPrinted: (id: string, printedCount: number, status: RunStatus | null, options?: { onSetAside?: (reason: string) => void }) => Promise<Run | null>;
  /** Resolves to a plain-language message when the server refuses (the item is kept). */
  deleteRun: (id: string) => Promise<string | null>;
  /** Toggle the pinned state of a run. Server stamps pinnedAt. */
  togglePin: (id: string) => Promise<Run | null>;
  fetchPrintEvents: (runId: string) => Promise<RunPrintEvent[]>;
  createPrintEvent: (
    runId: string,
    data: Omit<RunPrintEvent, 'id' | 'runId' | 'createdAt'>
  ) => Promise<RunPrintEvent | null>;

  // Presets
  createPreset: (data: Partial<RunPreset> & { name: string; templateId: string }) => Promise<RunPreset>;
  updatePreset: (id: string, updates: Partial<RunPreset> & { touch?: boolean }) => Promise<RunPreset | null>;
  deletePreset: (id: string) => Promise<string | null>;
}

async function loadPresets() {
  const rows: RunPreset[] = [];
  for (let offset=0;offset<100000;offset+=50) {
    const page=await apiJson<RunPreset[]>(`/api/presets?offset=${offset}`);
    if(!Array.isArray(page)) throw new Error('Invalid presets response');
    rows.push(...page); if(page.length<50) break;
  }
  return rows;
}

export const useRunStore = create<RunStore>((set, get) => ({
  runs: [],
  presets: [],
  printEvents: [],
  runLoadErrors: {},
  hydrated: false, loading: false, error: null, hasMore: false, offset: 0,

  loadAll: async (more = false) => {
    if (get().loading) return;
    const offset = more ? get().offset : 0;
    set({ loading: true, error: null });
    try {
      const [rows, presets] = await Promise.all([
        apiJson<Run[]>(`/api/runs?offset=${offset}`),
        more ? Promise.resolve(get().presets) : loadPresets(),
      ]);
      if (!Array.isArray(rows) || !Array.isArray(presets)) throw new Error('Invalid run response');
      set(state => ({ runs: [...state.runs.filter(old => !rows.some(row => row.id === old.id)), ...rows.map(row => ({...state.runs.find(old=>old.id===row.id), ...row, sourceData: row.sourceData ?? state.runs.find(old=>old.id===row.id)?.sourceData ?? []}))], presets, hydrated:true, loading:false, offset:offset+rows.length, hasMore:rows.length===50 }));
    } catch (error) { set({ loading:false, hydrated:true, error:(error as Error).message }); }
  },

  fetchRun: async (id) => {
    let run: Run;
    try { run = await apiJson<Run>(`/api/runs/${id}`); }
    catch(error) {
      const status = error instanceof ApiError ? error.status : 0;
      set(state => ({
        runLoadErrors: { ...state.runLoadErrors, [id]: { status, message: (error as Error).message } },
        // A missing run is shown on its own page, not as a library-wide error.
        ...(status === 404 ? {} : { error: (error as Error).message }),
      }));
      return null;
    }
    set((state) => {
      const exists = state.runs.some((r) => r.id === id);
      const { [id]: _cleared, ...runLoadErrors } = state.runLoadErrors;
      void _cleared;
      return {
        runLoadErrors,
        runs: exists
          ? state.runs.map((r) => (r.id === id ? { ...r, ...run } : r))
          : [run, ...state.runs],
      };
    });
    return run;
  },

  createRun: async (data) => {
    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) { const error = await res.json().catch(() => null); throw new Error(error?.error || 'Failed to create run'); }
    const run = (await res.json()) as Run;
    set((state) => ({ runs: [run, ...state.runs] }));
    return run;
  },

  updateRun: async (id, updates) => {
    const res = await fetch(`/api/runs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) { const data = await res.json().catch(()=>null); set({error:data?.error || 'Update failed. Please retry.'}); return null; }
    const run = (await res.json()) as Run;
    set((state) => ({ runs: state.runs.map((r) => (r.id === id ? { ...r, ...run } : r)) }));
    return run;
  },

  setRunStatus: async (id, status, printedCount, options) => {
    const body: Record<string, unknown> = { status };
    let rewind: ReturnType<typeof rewindEvent> | undefined;
    if (typeof printedCount === 'number') body.printedCount = printedCount;
    if (options?.resetProgress && typeof printedCount === 'number') {
      body.resetProgress = true;
      // The server applies the rewind only if progress is still what this
      // device saw when someone tapped it (compare-and-set), so a late
      // rewind never erases progress another device made in the meantime.
      // The caller passes the count on its screen; the store's copy is the
      // fallback (local printing doesn't always write the store).
      const seen = typeof options.expectedPrintedCount === 'number' ? options.expectedPrintedCount : get().runs.find((r) => r.id === id)?.printedCount;
      if (typeof seen === 'number') body.expectedPrintedCount = seen;
      // The go-back's print-history entry rides in the outbox with it: sent
      // right after the server accepts the go-back (with the server's time),
      // never when it is set aside, and kept if the tab closes first.
      rewind = rewindEvent(printedCount + 1, typeof seen === 'number' ? seen : printedCount);
    }
    if (status === 'completed') body.completedAt = new Date().toISOString();
    const run=await updateRunWithQueue(id,body as Partial<Run>,options?.onSetAside,rewind,options?.onAlreadyApplied);
    if(run) set(state=>({runs:state.runs.map(r=>r.id===id?{...r,...run}:r)}));
    return run;
  },

  recordPrinted: async (id, printedCount, status, options) => {
    if (status) return get().setRunStatus(id, status, printedCount, options);
    const run = await updateRunWithQueue(id, { printedCount }, options?.onSetAside);
    if (run) set(state => ({ runs: state.runs.map(r => r.id === id ? { ...r, ...run } : r) }));
    return run;
  },

  deleteRun: async (id) => {
    try { await apiJson(`/api/runs/${id}`, { method: 'DELETE' }); } catch(error) { return deleteRefused(error, set); }
    set((state) => ({ runs: state.runs.filter((r) => r.id !== id) }));
    return null;
  },

  togglePin: async (id) => {
    const current = get().runs.find((r) => r.id === id);
    if (!current) return null;
    // Send the convenience flag; server decides the timestamp.
    const res = await fetch(`/api/runs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: !current.pinnedAt }),
    });
    if (!res.ok) { const data = await res.json().catch(()=>null); set({error:data?.error || 'Update failed. Please retry.'}); return null; }
    const updated = (await res.json()) as Run;
    set((state) => ({ runs: state.runs.map((r) => (r.id === id ? {...r,...updated} : r)) }));
    return updated;
  },

  fetchPrintEvents: async (runId) => {
    const res = await fetch(`/api/runs/${runId}/print-events`);
    if (!res.ok) return [];
    const events = (await res.json()) as RunPrintEvent[];
    set((state) => ({
      printEvents: [
        ...events,
        ...state.printEvents.filter((event) => event.runId !== runId),
      ],
    }));
    return events;
  },

  createPrintEvent: async (runId, data) => {
    const event = await savePrintEvent(runId,data);
    if (!event) return null;
    set((state) => ({
      printEvents: [event, ...state.printEvents.filter(old=>old.id!==event.id)],
    }));
    return event;
  },

  createPreset: async (data) => {
    const res = await fetch('/api/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create preset');
    const preset = (await res.json()) as RunPreset;
    set((state) => ({ presets: [preset, ...state.presets] }));
    return preset;
  },

  updatePreset: async (id, updates) => {
    const res = await fetch(`/api/presets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) { const data = await res.json().catch(()=>null); set({error:data?.error || 'Update failed. Please retry.'}); return null; }
    const preset = (await res.json()) as RunPreset;
    set((state) => ({ presets: state.presets.map((p) => (p.id === id ? preset : p)) }));
    return preset;
  },

  deletePreset: async (id) => {
    try { await apiJson(`/api/presets/${id}`, { method: 'DELETE' }); } catch(error) { return deleteRefused(error, set); }
    set((state) => ({ presets: state.presets.filter((p) => p.id !== id) }));
    return null;
  },
}));
