'use client';

import { create } from 'zustand';
import type { Run, RunPreset, RunStatus } from './types';

interface RunStore {
  runs: Run[];
  presets: RunPreset[];
  hydrated: boolean;
  loadAll: () => Promise<void>;

  // Runs
  createRun: (data: Partial<Run> & { name: string; templateId: string; fieldMappings?: Run['fieldMappings'] }) => Promise<Run>;
  updateRun: (id: string, updates: Partial<Run>) => Promise<Run | null>;
  setRunStatus: (id: string, status: RunStatus, printedCount?: number) => Promise<Run | null>;
  deleteRun: (id: string) => Promise<void>;

  // Presets
  createPreset: (data: Partial<RunPreset> & { name: string; templateId: string }) => Promise<RunPreset>;
  updatePreset: (id: string, updates: Partial<RunPreset> & { touch?: boolean }) => Promise<RunPreset | null>;
  deletePreset: (id: string) => Promise<void>;
}

export const useRunStore = create<RunStore>((set, get) => ({
  runs: [],
  presets: [],
  hydrated: false,

  loadAll: async () => {
    const [rRes, pRes] = await Promise.all([
      fetch('/api/runs').then((r) => r.json()),
      fetch('/api/presets').then((r) => r.json()),
    ]);
    set({
      runs: Array.isArray(rRes) ? rRes : [],
      presets: Array.isArray(pRes) ? pRes : [],
      hydrated: true,
    });
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
    if (!res.ok) return null;
    const run = (await res.json()) as Run;
    set((state) => ({ runs: state.runs.map((r) => (r.id === id ? run : r)) }));
    return run;
  },

  setRunStatus: async (id, status, printedCount) => {
    const body: Record<string, unknown> = { status };
    if (typeof printedCount === 'number') body.printedCount = printedCount;
    if (status === 'completed') body.completedAt = new Date().toISOString();
    return get().updateRun(id, body as Partial<Run>);
  },

  deleteRun: async (id) => {
    await fetch(`/api/runs/${id}`, { method: 'DELETE' });
    set((state) => ({ runs: state.runs.filter((r) => r.id !== id) }));
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
    if (!res.ok) return null;
    const preset = (await res.json()) as RunPreset;
    set((state) => ({ presets: state.presets.map((p) => (p.id === id ? preset : p)) }));
    return preset;
  },

  deletePreset: async (id) => {
    await fetch(`/api/presets/${id}`, { method: 'DELETE' });
    set((state) => ({ presets: state.presets.filter((p) => p.id !== id) }));
  },
}));
