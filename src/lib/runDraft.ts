import type { FieldMapping } from './types';

/**
 * The unfinished new-run wizard, kept in sessionStorage so a refresh or the
 * browser's Back button doesn't throw away a half-built run. Only this tab
 * sees it, and it is cleared once the run is created or the person starts
 * fresh.
 */
export interface RunDraft {
  name: string;
  templateId: string;
  inputMode: 'manual' | 'paste' | 'csv' | 'manifest';
  staticValues: Record<string, string>;
  fieldMappings: Record<string, FieldMapping>;
  hiddenRunFields: string[];
  pasteText: string;
  pasteField: string | null;
  csvHeaders: string[];
  csvRows: Record<string, string>[];
  csvFileName: string;
  manualQty: number;
  savedAt: number;
}

const KEY = 'lw:new-run-draft';
/** Drafts older than this are dropped rather than offered. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): Store | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}

export function saveRunDraft(draft: RunDraft, store: Store | null = storage()) {
  try { store?.setItem(KEY, JSON.stringify(draft)); } catch { /* full or blocked: the leave prompt still protects the work */ }
}

export function readRunDraft(store: Store | null = storage(), now = Date.now()): RunDraft | null {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as RunDraft;
    if (!draft || typeof draft !== 'object' || now - (draft.savedAt || 0) > MAX_AGE_MS) return null;
    const hasWork = !!(draft.name?.trim() || draft.templateId || draft.csvRows?.length || draft.pasteText?.trim());
    return hasWork ? draft : null;
  } catch {
    return null;
  }
}

export function clearRunDraft(store: Store | null = storage()) {
  try { store?.removeItem(KEY); } catch { /* nothing to clear */ }
}
