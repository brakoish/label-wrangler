import { apiJson } from './apiClient';
import { create } from 'zustand';
import type { GlobalElement, TemplateElement } from './types';

interface GlobalElementStore {
  globals: GlobalElement[];
  hydrated: boolean;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  offset: number;
  fetchGlobals: (more?: boolean) => Promise<void>;
  createGlobal: (name: string, elements: TemplateElement[], description?: string) => Promise<GlobalElement>;
  updateGlobal: (id: string, updates: Partial<Pick<GlobalElement, 'name' | 'description' | 'elements'>>) => Promise<void>;
  deleteGlobal: (id: string) => Promise<void>;
}

export const useGlobalElementStore = create<GlobalElementStore>((set, get) => ({
  globals: [],
  hydrated: false, loading: false, error: null, hasMore: false, offset: 0,

  fetchGlobals: async (more = false) => {
    if (get().loading) return;
    const offset = more ? get().offset : 0;
    set({ loading: true, error: null });
    try {
      const rows = await apiJson<GlobalElement[]>(`/api/globals?offset=${offset}`);
      if (!Array.isArray(rows)) throw new Error('Invalid globals response');
      set(state => ({ globals: more ? [...state.globals.filter(old => !rows.some(row => row.id === old.id)), ...rows] : rows, hydrated: true, loading: false, offset: offset + rows.length, hasMore: rows.length === 50 }));
    } catch(error) { set({ loading: false, hydrated: true, error: (error as Error).message }); }
  },

  createGlobal: async (name, elements, description) => {
    const res = await fetch('/api/globals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, elements, description }),
    });
    if (!res.ok) throw new Error('Failed to create global element');
    const created = await res.json() as GlobalElement;
    set((state) => ({ globals: [created, ...state.globals] }));
    return created;
  },

  updateGlobal: async (id, updates) => {
    const res = await fetch(`/api/globals/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error('Failed to update global element');
    const updated = await res.json() as GlobalElement;
    set((state) => ({
      globals: state.globals.map((g) => (g.id === id ? updated : g)),
    }));
  },

  deleteGlobal: async (id) => {
    const res = await fetch(`/api/globals/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete global element');
    set((state) => ({ globals: state.globals.filter((g) => g.id !== id) }));
  },
}));
