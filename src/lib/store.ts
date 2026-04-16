import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { LabelFormat, calculateLabelsPerSheet } from './types';

// Storage key
const STORAGE_KEY = 'label-wrangler-formats';

// Default formats - empty to start fresh
function getDefaultFormats(): LabelFormat[] {
  return [];
}

interface FormatStore {
  formats: LabelFormat[];
  selectedFormatId: string | null;

  // Actions
  addFormat: (format: Omit<LabelFormat, 'id' | 'createdAt' | 'updatedAt'>) => LabelFormat;
  updateFormat: (id: string, updates: Partial<LabelFormat>) => void;
  deleteFormat: (id: string) => void;
  selectFormat: (id: string | null) => void;
  getFormatById: (id: string) => LabelFormat | undefined;

  // Import/Export
  exportFormats: () => string;
  importFormats: (json: string) => { success: boolean; count: number; error?: string };
}

export const useFormatStore = create<FormatStore>()(
  persist(
    (set, get) => ({
      formats: getDefaultFormats(),
      selectedFormatId: null,

      addFormat: (formatData) => {
        const now = new Date().toISOString();
        const newFormat: LabelFormat = {
          ...formatData,
          id: `format-${Date.now()}`,
          createdAt: now,
          updatedAt: now,
        };

        // Auto-calculate labels per sheet for sheet types
        if (newFormat.type === 'sheet') {
          newFormat.labelsPerSheet = calculateLabelsPerSheet(newFormat);
        }

        set((state) => ({
          formats: [...state.formats, newFormat],
        }));

        return newFormat;
      },

      updateFormat: (id, updates) => {
        set((state) => ({
          formats: state.formats.map((f) => {
            if (f.id !== id) return f;

            const updated = { ...f, ...updates, updatedAt: new Date().toISOString() };

            // Recalculate labels per sheet if sheet dimensions changed
            if (updated.type === 'sheet' && (updates.columns || updates.rows)) {
              updated.labelsPerSheet = calculateLabelsPerSheet(updated);
            }

            return updated;
          }),
        }));
      },

      deleteFormat: (id) => {
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
    }),
    {
      name: STORAGE_KEY,
    }
  )
);