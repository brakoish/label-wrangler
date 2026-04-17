import { create } from 'zustand';
import { LabelTemplate, TemplateElement } from './types';

interface TemplateStore {
  templates: LabelTemplate[];
  selectedTemplateId: string | null;
  hydrated: boolean;

  // Template actions
  fetchTemplates: () => Promise<void>;
  addTemplate: (data: Omit<LabelTemplate, 'id' | 'createdAt' | 'updatedAt'>) => Promise<LabelTemplate>;
  updateTemplate: (id: string, updates: Partial<LabelTemplate>) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  selectTemplate: (id: string | null) => void;
  getTemplateById: (id: string) => LabelTemplate | undefined;

  // Element actions
  addElement: (templateId: string, element: Omit<TemplateElement, 'id' | 'zIndex'>) => Promise<void>;
  updateElement: (templateId: string, elementId: string, updates: Partial<TemplateElement>) => Promise<void>;
  removeElement: (templateId: string, elementId: string) => Promise<void>;
  reorderElement: (templateId: string, elementId: string, newZIndex: number) => Promise<void>;
  duplicateElement: (templateId: string, elementId: string) => Promise<void>;
}

export const useTemplateStore = create<TemplateStore>()((set, get) => ({
  templates: [],
  selectedTemplateId: null,
  hydrated: false,

  fetchTemplates: async () => {
    try {
      const res = await fetch('/api/templates');
      if (res.ok) {
        const templates = await res.json();
        set({ templates, hydrated: true });
      }
    } catch (error) {
      console.error('Error fetching templates:', error);
      set({ hydrated: true });
    }
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
    const res = await fetch(`/api/templates/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });

    if (!res.ok) throw new Error('Failed to update template');

    const updated = await res.json();
    set((state) => ({
      templates: state.templates.map((t) => (t.id === id ? updated : t)),
    }));
  },

  deleteTemplate: async (id) => {
    const res = await fetch(`/api/templates/${id}`, {
      method: 'DELETE',
    });

    if (!res.ok) throw new Error('Failed to delete template');

    set((state) => ({
      templates: state.templates.filter((t) => t.id !== id),
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

    const res = await fetch(`/api/templates/${templateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elements: updatedElements }),
    });

    if (!res.ok) throw new Error('Failed to add element');

    const updated = await res.json();
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

    const res = await fetch(`/api/templates/${templateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elements: updatedElements }),
    });

    if (!res.ok) throw new Error('Failed to update element');

    const updated = await res.json();
    set((state) => ({
      templates: state.templates.map((t) => (t.id === templateId ? updated : t)),
    }));
  },

  removeElement: async (templateId, elementId) => {
    const template = get().templates.find((t) => t.id === templateId);
    if (!template) throw new Error('Template not found');

    const updatedElements = template.elements.filter((e) => e.id !== elementId);

    const res = await fetch(`/api/templates/${templateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elements: updatedElements }),
    });

    if (!res.ok) throw new Error('Failed to remove element');

    const updated = await res.json();
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

    const res = await fetch(`/api/templates/${templateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elements: reorderedElements }),
    });

    if (!res.ok) throw new Error('Failed to reorder element');

    const updated = await res.json();
    set((state) => ({
      templates: state.templates.map((t) => (t.id === templateId ? updated : t)),
    }));
  },

  duplicateElement: async (templateId, elementId) => {
    const template = get().templates.find((t) => t.id === templateId);
    if (!template) throw new Error('Template not found');

    const element = template.elements.find((e) => e.id === elementId);
    if (!element) throw new Error('Element not found');

    // Clone element with offset position
    const maxZIndex = Math.max(0, ...template.elements.map((e) => e.zIndex));
    const duplicated: TemplateElement = {
      ...element,
      id: `element-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      x: element.x + 10, // Offset by 10 units
      y: element.y + 10,
      zIndex: maxZIndex + 1,
      // If it has a fieldName, append "-copy" to make it unique
      fieldName: element.fieldName ? `${element.fieldName}-copy` : undefined,
    } as TemplateElement;

    const updatedElements = [...template.elements, duplicated];

    const res = await fetch(`/api/templates/${templateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elements: updatedElements }),
    });

    if (!res.ok) throw new Error('Failed to duplicate element');

    const updated = await res.json();
    set((state) => ({
      templates: state.templates.map((t) => (t.id === templateId ? updated : t)),
    }));
  },
}));
