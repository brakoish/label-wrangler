import type { LabelTemplate } from './types';
import { runLayoutId } from './runLayout';

/**
 * A run's own copy of a design ("Adjust for this run"), kept in this browser
 * tab's sessionStorage while the new run is being set up. One copy per saved
 * design, so switching designs and back still finds it; it is never used for
 * another design. Cleared when the run is made, on "Start fresh" and on
 * "Undo adjustments". Nothing here is ever sent to /api/templates.
 *
 * `template` is the copy as the designer edits it: its id is
 * runLayoutId(templateId), and its updatedAt is the saved design's updatedAt
 * when the copy was taken (or last kept), so a newer saved design shows up.
 */
export interface RunLayoutDraft {
  templateId: string;
  template: LabelTemplate;
  savedAt: number;
}

const PREFIX = 'lw:run-layout:';
/** Copies older than this are dropped, like the unfinished run itself. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

function storage(): Store | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}

export const RUN_LAYOUT_STORAGE_FULL = 'Your browser couldn’t keep this run’s layout (its storage is full or turned off). Close other Label Wrangler tabs and try again.';

export function readRunLayout(templateId: string, store: Store | null = storage(), now = Date.now()): RunLayoutDraft | null {
  if (!templateId) return null;
  try {
    const raw = store?.getItem(PREFIX + templateId);
    if (!raw) return null;
    const draft = JSON.parse(raw) as RunLayoutDraft;
    if (!draft || typeof draft !== 'object' || draft.templateId !== templateId || now - (draft.savedAt || 0) > MAX_AGE_MS) return null;
    const t = draft.template;
    if (!t || t.id !== runLayoutId(templateId) || !Array.isArray(t.elements) || typeof t.formatId !== 'string') return null;
    return draft;
  } catch {
    return null;
  }
}

/** Keeps the copy; throws (plain words) when the browser can't. */
export function saveRunLayout(template: LabelTemplate, templateId: string, store: Store | null = storage(), now = Date.now()): RunLayoutDraft {
  if (template.id !== runLayoutId(templateId)) throw new Error('This layout belongs to another design.');
  const draft: RunLayoutDraft = { templateId, template, savedAt: now };
  try {
    if (!store) throw new Error('no storage');
    store.setItem(PREFIX + templateId, JSON.stringify(draft));
  } catch {
    throw new Error(RUN_LAYOUT_STORAGE_FULL);
  }
  return draft;
}

/** The copy for this design: the one already kept, else a new one of the saved design. */
export function startRunLayout(saved: LabelTemplate, store: Store | null = storage(), now = Date.now()): RunLayoutDraft {
  const kept = readRunLayout(saved.id, store, now);
  if (kept) return kept;
  const copy: LabelTemplate = { ...saved, id: runLayoutId(saved.id), elements: structuredClone(saved.elements) };
  delete copy.summaryOnly; delete copy.elementCount; delete copy.dynamicCount;
  return saveRunLayout(copy, saved.id, store, now);
}

export function clearRunLayout(templateId: string, store: Store | null = storage()) {
  try { store?.removeItem(PREFIX + templateId); } catch { /* nothing to clear */ }
}

export function clearAllRunLayouts(store: Store | null = storage()) {
  try {
    if (!store) return;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) { const key = store.key(i); if (key?.startsWith(PREFIX)) keys.push(key); }
    for (const key of keys) store.removeItem(key);
  } catch { /* nothing to clear */ }
}

/** Whether the copy's items differ from the saved design's (an untouched copy is no adjustment). */
export function runLayoutDiffers(draft: RunLayoutDraft, saved: Pick<LabelTemplate, 'elements'>): boolean {
  return JSON.stringify(draft.template.elements) !== JSON.stringify(saved.elements);
}
