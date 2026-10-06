'use client';
import { apiJson } from './apiClient';
import { updateRunWithQueue, savePrintEvent } from './offlineQueue';

import { create } from 'zustand';
import type { Run, RunPreset, RunPrintEvent, RunStatus } from './types';

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

  // Runs
  createRun: (data: Partial<Run> & { name: string; templateId: string; fieldMappings?: Run['fieldMappings'] }) => Promise<Run>;
  updateRun: (id: string, updates: Partial<Run>) => Promise<Run | null>;
  setRunStatus: (id: string, status: RunStatus, printedCount?: number) => Promise<Run | null>;
  deleteRun: (id: string) => Promise<void>;
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
  deletePreset: (id: string) => Promise<void>;
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
    catch(error) { set({error:(error as Error).message}); return null; }
    set((state) => {
      const exists = state.runs.some((r) => r.id === id);
      return {
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
    if (!res.ok) throw new Error('Failed to create run');
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

  setRunStatus: async (id, status, printedCount) => {
    const body: Record<string, unknown> = { status };
    if (typeof printedCount === 'number') body.printedCount = printedCount;
    if (status === 'completed') body.completedAt = new Date().toISOString();
    const run=await updateRunWithQueue(id,body as Partial<Run>);
    if(run) set(state=>({runs:state.runs.map(r=>r.id===id?{...r,...run}:r)}));
    return run;
  },

  deleteRun: async (id) => {
    try { await apiJson(`/api/runs/${id}`, { method: 'DELETE' }); } catch(error) { set({error:(error as Error).message}); return; }
    set((state) => ({ runs: state.runs.filter((r) => r.id !== id) }));
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
    try { await apiJson(`/api/presets/${id}`, { method: 'DELETE' }); } catch(error) { set({error:(error as Error).message}); return; }
    set((state) => ({ presets: state.presets.filter((p) => p.id !== id) }));
  },
}));
