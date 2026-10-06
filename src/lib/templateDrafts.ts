import type { LabelTemplate } from './types';
export type TemplateDraft = { template: LabelTemplate; baseUpdatedAt: string; savedAt: string };
const prefix = 'lw:template-draft:';
// Independent tab drafts cannot overwrite each other's recovery copy.
let tabId: string | undefined;
function owner() { return tabId ??= crypto.randomUUID(); }
export function storeDraft(template: LabelTemplate, baseUpdatedAt: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(prefix + template.id + ':' + owner(), JSON.stringify({ template, baseUpdatedAt, savedAt: new Date().toISOString() }));
}
export function clearDraft(id: string) {
  if (typeof window !== 'undefined' && tabId) window.localStorage.removeItem(prefix + id + ':' + tabId);
}
export function readDrafts(id: string): Array<TemplateDraft & { key: string }> {
  if (typeof window === 'undefined') return [];
  const results = [];
  for (let i=0;i<window.localStorage.length;i++) {
    const key=window.localStorage.key(i);
    if (!key?.startsWith(prefix+id+':')) continue;
    try { const value=JSON.parse(window.localStorage.getItem(key)!); if(value.template?.id===id) results.push({...value,key}); } catch { /* Leave unreadable entries intact for recovery. */ }
  }
  return results.sort((a,b)=>b.savedAt.localeCompare(a.savedAt));
}
