import { apiJson } from './apiClient';
import { create } from 'zustand';
import { LabelFormat, calculateLabelsPerSheet } from './types';

interface FormatStore {
  formats: LabelFormat[];
  selectedFormatId: string | null;
  hydrated: boolean;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  offset: number;

  // Actions
  fetchFormats: (more?: boolean) => Promise<void>;
  addFormat: (format: Omit<LabelFormat, 'id' | 'createdAt' | 'updatedAt'>) => Promise<LabelFormat>;
  updateFormat: (id: string, updates: Partial<LabelFormat>) => Promise<void>;
  deleteFormat: (id: string) => Promise<void>;
  selectFormat: (id: string | null) => void;
  getFormatById: (id: string) => LabelFormat | undefined;

  // Import/Export
  exportFormats: () => string;
  importFormats: (json: string) => { success: boolean; count: number; error?: string };
}

export const useFormatStore = create<FormatStore>()((set, get) => ({
  formats: [],
  selectedFormatId: null,
  hydrated: false, loading: false, error: null, hasMore: false, offset: 0,

  fetchFormats: async (more = false) => {
    if (get().loading) return;
    const offset = more ? get().offset : 0;
    set({ loading: true, error: null });
    try {
      const rows = await apiJson<LabelFormat[]>(`/api/formats?offset=${offset}`);
      if (!Array.isArray(rows)) throw new Error('Invalid formats response');
      set(state => ({ formats: more ? [...state.formats.filter(old => !rows.some(row => row.id === old.id)), ...rows] : rows, hydrated: true, loading: false, offset: offset + rows.length, hasMore: rows.length === 50 }));
    } catch(error) { set({ loading: false, hydrated: true, error: (error as Error).message }); }
  },

  addFormat: async (formatData) => {
    const newFormat: Omit<LabelFormat, 'id' | 'createdAt' | 'updatedAt'> = {
      ...formatData,
    };

    // Auto-calculate labels per sheet for sheet types
    if (newFormat.type === 'sheet') {
      newFormat.labelsPerSheet = calculateLabelsPerSheet(newFormat as LabelFormat);
    }

    const res = await fetch('/api/formats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newFormat),
    });

    if (!res.ok) throw new Error('Failed to create format');

    const created = await res.json();
    set((state) => ({
      formats: [...state.formats, created],
    }));

    return created;
  },

  updateFormat: async (id, updates) => {
    const updated = { ...updates };

    // Recalculate labels per sheet if sheet dimensions changed
    const current = get().formats.find((f) => f.id === id);
    if (current?.type === 'sheet' && (updates.columns || updates.rows)) {
      const merged = { ...current, ...updates };
      updated.labelsPerSheet = calculateLabelsPerSheet(merged as LabelFormat);
    }

    const res = await fetch(`/api/formats/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });

    if (!res.ok) throw new Error('Failed to update format');

    const updatedFormat = await res.json();
    set((state) => ({
      formats: state.formats.map((f) => (f.id === id ? updatedFormat : f)),
    }));
  },

  deleteFormat: async (id) => {
    const res = await fetch(`/api/formats/${id}`, {
      method: 'DELETE',
    });

    if (!res.ok) throw new Error('Failed to delete format');

    set((state) => ({
      formats: state.formats.filter((f) => f.id !== id),
      selectedFormatId: state.selectedFormatId === id ? null : state.selectedFormatId,
    }));
  },

  selectFormat: (id) => {
    set({ selectedFormatId: id });
  },

  getFormatById: (id) => {
    return get().formats.find((f) => f.id === id);
  },

  exportFormats: () => {
    return JSON.stringify(get().formats, null, 2);
  },

  importFormats: (json) => {
    try {
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) {
        return { success: false, count: 0, error: 'Invalid format: expected an array' };
      }

      // Validate each format has required fields
      const validFormats = parsed.filter((f): f is LabelFormat => {
        return (
          f &&
          typeof f.id === 'string' &&
          typeof f.name === 'string' &&
          (f.type === 'thermal' || f.type === 'sheet') &&
          typeof f.width === 'number' &&
          typeof f.height === 'number'
        );
      });

      set((state) => {
        // Merge imported formats, replacing any with same ID
        const existingIds = new Set(state.formats.map((f) => f.id));
        const newFormats = validFormats.filter((f) => !existingIds.has(f.id));
        const updatedFormats = state.formats.map((f) => {
          const imported = validFormats.find((imp) => imp.id === f.id);
          return imported || f;
        });

        return {
          formats: [...updatedFormats, ...newFormats],
        };
      });

      return { success: true, count: validFormats.length };
    } catch (err) {
      return {
        success: false,
        count: 0,
        error: err instanceof Error ? err.message : 'Invalid JSON',
      };
    }
  },
}));