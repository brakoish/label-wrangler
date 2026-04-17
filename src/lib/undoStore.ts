import { create } from 'zustand';
import { TemplateElement } from './types';

interface HistoryEntry {
  templateId: string;
  elements: TemplateElement[];
}

interface UndoStore {
  past: HistoryEntry[];
  future: HistoryEntry[];
  maxHistory: number;

  // Push current state before a change
  push: (templateId: string, elements: TemplateElement[]) => void;

  // Undo: returns the previous elements state, or null if nothing to undo
  undo: () => HistoryEntry | null;

  // Redo: returns the next elements state, or null if nothing to redo
  redo: () => HistoryEntry | null;

  // Store current state for redo when undoing
  setCurrent: (templateId: string, elements: TemplateElement[]) => void;

  canUndo: () => boolean;
  canRedo: () => boolean;

  // Clear history (e.g. when switching templates)
  clear: () => void;
}

export const useUndoStore = create<UndoStore>()((set, get) => ({
  past: [],
  future: [],
  maxHistory: 50,

  push: (templateId, elements) => {
    set((state) => ({
      past: [...state.past.slice(-(state.maxHistory - 1)), { templateId, elements: JSON.parse(JSON.stringify(elements)) }],
      future: [], // New action clears redo stack
    }));
  },

  undo: () => {
    const { past } = get();
    if (past.length === 0) return null;

    const previous = past[past.length - 1];
    set((state) => ({
      past: state.past.slice(0, -1),
    }));

    return { templateId: previous.templateId, elements: JSON.parse(JSON.stringify(previous.elements)) };
  },

  redo: () => {
    const { future } = get();
    if (future.length === 0) return null;

    const next = future[future.length - 1];
    set((state) => ({
      future: state.future.slice(0, -1),
    }));

    return { templateId: next.templateId, elements: JSON.parse(JSON.stringify(next.elements)) };
  },

  setCurrent: (templateId, elements) => {
    set((state) => ({
      future: [...state.future, { templateId, elements: JSON.parse(JSON.stringify(elements)) }],
    }));
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  clear: () => set({ past: [], future: [] }),
}));
