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
  /** Plain digits of formatted Excel numbers, aligned with csvRows (optional). */
  csvPlainRows?: Record<string, string>[] | null;
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

const SOURCE_KEY = 'lw:new-run-source';
type RunSource = RunDraft['inputMode'];
const SOURCES: ReadonlyArray<RunSource> = ['manual', 'paste', 'csv', 'manifest'];

function localStore(): Store | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

/**
 * Where a new run's values come from when nothing else says: the choice the
 * person used for their last run, else a spreadsheet (what most runs use).
 */
export function lastRunSource(store: Store | null = localStore()): RunSource {
  try {
    const saved = store?.getItem(SOURCE_KEY);
    return SOURCES.includes(saved as RunSource) ? saved as RunSource : 'csv';
  } catch {
    return 'csv';
  }
}

/** Remember the source of a run that was started, for the next new run. */
export function rememberRunSource(source: RunSource, store: Store | null = localStore()) {
  try { store?.setItem(SOURCE_KEY, source); } catch { /* blocked: the next run starts on a spreadsheet */ }
}
