import { apiJson } from './apiClient';
import { storeDraft, clearDraft } from './templateDrafts';
import { create } from 'zustand';
import { useFormatStore } from './store';
import { LabelTemplate, LabelFormat, TemplateElement } from './types';

type NewTemplateElement = TemplateElement extends infer T
  ? T extends TemplateElement
    ? Omit<T, 'id' | 'zIndex'>
    : never
  : never;

interface TemplateStore {
  templates: LabelTemplate[];
  selectedTemplateId: string | null;
  hydrated: boolean;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  offset: number;

  // Template actions
  fetchTemplates: (more?: boolean) => Promise<void>;
  fetchTemplate: (id: string) => Promise<void>;
  addTemplate: (data: Omit<LabelTemplate, 'id' | 'createdAt' | 'updatedAt'>) => Promise<LabelTemplate>;
  updateTemplate: (id: string, updates: Partial<LabelTemplate>) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  selectTemplate: (id: string | null) => void;
  getTemplateById: (id: string) => LabelTemplate | undefined;

  // Element actions
  addElement: (templateId: string, element: NewTemplateElement) => Promise<void>;
  updateElement: (templateId: string, elementId: string, updates: Partial<TemplateElement>) => Promise<void>;
  updateElementLocal: (templateId: string, elementId: string, updates: Partial<TemplateElement>) => void;
  saveTemplate: (templateId: string) => Promise<void>;
  removeElement: (templateId: string, elementId: string) => Promise<void>;
  reorderElement: (templateId: string, elementId: string, newZIndex: number) => Promise<void>;
  duplicateElement: (templateId: string, elementId: string) => Promise<void>;
}

const draftTimers = new Map<string, ReturnType<typeof setTimeout>>();
const saveQueues = new Map<string, Promise<void>>();

async function persistTemplate(id: string, changes: Partial<LabelTemplate>): Promise<LabelTemplate> {
  let result!: LabelTemplate;
  const previous = saveQueues.get(id) ?? Promise.resolve();
  const save = previous.catch(() => {}).then(async () => {
    const base = useTemplateStore.getState().templates.find(t => t.id === id);
    if (!base) throw new Error('Template not found');
    result = await apiJson<LabelTemplate>(`/api/templates/${id}`, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...changes, expectedUpdatedAt:base.updatedAt}),
    });
    useTemplateStore.setState(state => ({ templates:state.templates.map(t => t.id === id ? {...t, updatedAt:result.updatedAt} : t) }));
  });
  saveQueues.set(id, save);
  try { await save; return result; } finally { if(saveQueues.get(id)===save) saveQueues.delete(id); }
}

export const useTemplateStore = create<TemplateStore>()((set, get) => ({
  templates: [],
  selectedTemplateId: null,
  hydrated: false, loading: false, error: null, hasMore: false, offset: 0,

  fetchTemplates: async (more = false) => {
    if (get().loading) return;
    const offset = more ? get().offset : 0;
    set({ loading: true, error: null });
    try {
      const rows = await apiJson<LabelTemplate[]>(`/api/templates?offset=${offset}`);
      if (!Array.isArray(rows)) throw new Error('Invalid templates response');
      set(state => ({ templates: [...state.templates.filter(old => !rows.some(row => row.id === old.id)), ...rows.map(row => state.templates.find(old=>old.id===row.id && !old.summaryOnly) ?? row)], hydrated: true, loading: false, offset: offset + rows.length, hasMore: rows.length === 50 }));
    } catch(error) { set({ loading: false, hydrated: true, error: (error as Error).message }); }

  },

  fetchTemplate: async (id) => {
    try {
      const cached = get().templates.find(t=>t.id===id && !t.summaryOnly);
      const template = cached ?? await apiJson<LabelTemplate>(`/api/templates/${id}`);
      set(state=>({templates:[...state.templates.filter(t=>t.id!==id),template]}));
      if (!useFormatStore.getState().formats.some(f=>f.id===template.formatId)) {
        const format=await apiJson<LabelFormat>(`/api/formats/${template.formatId}`);
        useFormatStore.setState(state=>({formats:[...state.formats.filter(f=>f.id!==format.id),format]}));
      }
    } catch(error) { set({error:(error as Error).message}); }
  },

  addTemplate: async (templateData) => {
    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(templateData),
    });

    if (!res.ok) throw new Error('Failed to create template');

    const created = await res.json();
    set((state) => ({
      templates: [...state.templates, created],
    }));

    return created;
  },

  updateTemplate: async (id, updates) => {
    const updated = await persistTemplate(id, updates);
    set((state) => ({
      templates: state.templates.map((t) => (t.id === id ? updated : t)),
    }));
  },

  deleteTemplate: async (id) => {
    const res = await fetch(`/api/templates/${id}`, {
      method: 'DELETE',
    });

    if (!res.ok) throw new Error('Failed to archive template. Please try again.');

    const archived = await res.json();

    set((state) => ({
      templates: state.templates.map((t) => t.id === id ? archived : t),
      selectedTemplateId: state.selectedTemplateId === id ? null : state.selectedTemplateId,
    }));
  },

  selectTemplate: (id) => {
    set({ selectedTemplateId: id });
  },

  getTemplateById: (id) => {
    return get().templates.find((t) => t.id === id);
  },

  addElement: async (templateId, elementData) => {
    const template = get().templates.find((t) => t.id === templateId);
    if (!template) throw new Error('Template not found');

    // Generate new element ID and assign next zIndex
    const maxZIndex = Math.max(0, ...template.elements.map((e) => e.zIndex));
    const newElement: TemplateElement = {
      ...elementData,
      id: `element-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      zIndex: maxZIndex + 1,
    } as TemplateElement;

    const updatedElements = [...template.elements, newElement];

    const updated = await persistTemplate(templateId, { elements: updatedElements });
    set((state) => ({
      templates: state.templates.map((t) => (t.id === templateId ? updated : t)),
    }));
  },

  updateElement: async (templateId, elementId, updates) => {
    const template = get().templates.find((t) => t.id === templateId);
    if (!template) throw new Error('Template not found');

    const updatedElements = template.elements.map((e) =>
      e.id === elementId ? ({ ...e, ...updates } as TemplateElement) : e
    );

    // Update local state immediately
    set((state) => ({
      templates: state.templates.map((t) =>
        t.id === templateId ? { ...t, elements: updatedElements } : t
      ),
    }));

    // Save to DB
    await persistTemplate(templateId, { elements: updatedElements });
  },

  // Local-only update (no API call) — used during drag/resize for performance
  updateElementLocal: (templateId, elementId, updates) => {
    set((state) => ({
      templates: state.templates.map((t) => {
        if (t.id !== templateId) return t;
        return {
          ...t,
          elements: t.elements.map((e) =>
            e.id === elementId ? ({ ...e, ...updates } as TemplateElement) : e
          ),
        };
      }),
    }));
    if (!draftTimers.has(templateId)) draftTimers.set(templateId, setTimeout(() => {
      draftTimers.delete(templateId);
      const template = get().templates.find(t=>t.id===templateId);
      if (template) try { storeDraft(template,template.updatedAt); } catch { set({error:'Draft recovery storage is full. Keep this tab open until your edits save.'}); }
    },250));

  },

  // Save current template state to DB — call after drag/resize ends
  saveTemplate: async (templateId) => {
    const template = get().templates.find((t) => t.id === templateId);
    if (!template) return;

    const timer=draftTimers.get(templateId); if(timer) { clearTimeout(timer); draftTimers.delete(templateId); }
    storeDraft(template, template.updatedAt);
    await persistTemplate(templateId, { elements: template.elements, formatId: template.formatId });
    const current = get().templates.find(t => t.id === templateId);
    if (current && current.elements === template.elements && current.formatId === template.formatId) clearDraft(templateId);

  },

  removeElement: async (templateId, elementId) => {
    const template = get().templates.find((t) => t.id === templateId);
    if (!template) throw new Error('Template not found');

    const updatedElements = template.elements.filter((e) => e.id !== elementId);

    const updated = await persistTemplate(templateId, { elements: updatedElements });
    set((state) => ({
      templates: state.templates.map((t) => (t.id === templateId ? updated : t)),
    }));
  },

  reorderElement: async (templateId, elementId, newZIndex) => {
    const template = get().templates.find((t) => t.id === templateId);
    if (!template) throw new Error('Template not found');

    const element = template.elements.find((e) => e.id === elementId);
    if (!element) throw new Error('Element not found');

    const oldZIndex = element.zIndex;

    // Reorder: shift other elements' zIndex values
    const reorderedElements = template.elements.map((e) => {
      if (e.id === elementId) {
        return { ...e, zIndex: newZIndex };
      }

      // Shift elements between old and new positions
      if (oldZIndex < newZIndex) {
        // Moving up: shift down elements in between
        if (e.zIndex > oldZIndex && e.zIndex <= newZIndex) {
          return { ...e, zIndex: e.zIndex - 1 };
        }
      } else if (oldZIndex > newZIndex) {
        // Moving down: shift up elements in between
        if (e.zIndex >= newZIndex && e.zIndex < oldZIndex) {
          return { ...e, zIndex: e.zIndex + 1 };
        }
      }

      return e;
    });

    const updated = await persistTemplate(templateId, { elements: reorderedElements });
    set((state) => ({
      templates: state.templates.map((t) => (t.id === templateId ? updated : t)),
    }));
  },

  duplicateElement: async (templateId, elementId) => {
    const template = get().templates.find((t) => t.id === templateId);
    if (!template) throw new Error('Template not found');

    const element = template.elements.find((e) => e.id === elementId);
    if (!element) throw new Error('Element not found');

    // Clone element with a proportional offset so the copy stays visible
    // regardless of unit system (dots for thermal, inches for sheet).
    // +10 was hardcoded before and threw sheet-label copies 10" off-canvas.
    const offsetX = element.width * 0.12;
    const offsetY = element.height * 0.12;
    const maxZIndex = Math.max(0, ...template.elements.map((e) => e.zIndex));
    const duplicated: TemplateElement = {
      ...element,
      id: `element-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      x: element.x + offsetX,
      y: element.y + offsetY,
      zIndex: maxZIndex + 1,
      // If it has a fieldName, append "-copy" to make it unique
      fieldName: element.fieldName,
    } as TemplateElement;

    const updatedElements = [...template.elements, duplicated];

    const updated = await persistTemplate(templateId, { elements: updatedElements });
    set((state) => ({
      templates: state.templates.map((t) => (t.id === templateId ? updated : t)),
    }));
  },
}));
