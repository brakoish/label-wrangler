import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { LabelFormat, calculateLabelsPerSheet } from './types';

// Storage key
const STORAGE_KEY = 'label-wrangler-formats';

// Default formats to seed the library
function getDefaultFormats(): LabelFormat[] {
  const now = new Date().toISOString();

  return [
    // Thermal rolls
    {
      id: 'thermal-2x1',
      name: '2" × 1" Thermal Roll',
      description: 'Standard product label',
      type: 'thermal',
      width: 2,
      height: 1,
      dpi: 203,
      labelsAcross: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'thermal-4x6',
      name: '4" × 6" Shipping Label',
      description: 'Standard shipping label',
      type: 'thermal',
      width: 4,
      height: 6,
      dpi: 203,
      labelsAcross: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'thermal-1x0.5',
      name: '1" × 0.5" Small Label',
      description: 'Small item label',
      type: 'thermal',
      width: 1,
      height: 0.5,
      dpi: 203,
      labelsAcross: 1,
      createdAt: now,
      updatedAt: now,
    },

    // Sheet labels (Avery compatible)
    {
      id: 'avery-5160',
      name: 'Avery 5160',
      description: 'Address labels — 30 per sheet',
      type: 'sheet',
      width: 2.625,
      height: 1,
      sheetWidth: 8.5,
      sheetHeight: 11,
      columns: 3,
      rows: 10,
      labelsPerSheet: 30,
      topMargin: 0.5,
      sideMargin: 0.1875,
      horizontalGap: 0.125,
      verticalGap: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'avery-5163',
      name: 'Avery 5163',
      description: 'Shipping labels — 10 per sheet',
      type: 'sheet',
      width: 4,
      height: 2,
      sheetWidth: 8.5,
      sheetHeight: 11,
      columns: 2,
      rows: 5,
      labelsPerSheet: 10,
      topMargin: 0.5,
      sideMargin: 0.15625,
      horizontalGap: 0.1875,
      verticalGap: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'avery-5167',
      name: 'Avery 5167',
      description: 'Return address — 80 per sheet',
      type: 'sheet',
      width: 1.75,
      height: 0.5,
      sheetWidth: 8.5,
      sheetHeight: 11,
      columns: 4,
      rows: 20,
      labelsPerSheet: 80,
      topMargin: 0.5,
      sideMargin: 0.28125,
      horizontalGap: 0.3125,
      verticalGap: 0,
      createdAt: now,
      updatedAt: now,
    },
  ];
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