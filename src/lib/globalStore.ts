import { create } from 'zustand';
import type { GlobalElement, TemplateElement } from './types';

interface GlobalElementStore {
  globals: GlobalElement[];
  hydrated: boolean;
  fetchGlobals: () => Promise<void>;
  createGlobal: (name: string, elements: TemplateElement[], description?: string) => Promise<GlobalElement>;
  updateGlobal: (id: string, updates: Partial<Pick<GlobalElement, 'name' | 'description' | 'elements'>>) => Promise<void>;
  deleteGlobal: (id: string) => Promise<void>;
}

export const useGlobalElementStore = create<GlobalElementStore>((set, get) => ({
  globals: [],
  hydrated: false,

  fetchGlobals: async () => {
    try {
      const res = await fetch('/api/globals');
      if (res.ok) {
        const globals = await res.json();
        set({ globals, hydrated: true });
      }
    } catch (error) {
      console.error('Error fetching global elements:', error);
      set({ hydrated: true });
    }
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
