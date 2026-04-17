import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { LabelTemplate, TemplateElement } from './types';

// Storage key
const STORAGE_KEY = 'label-wrangler-templates';

// Default templates - empty to start fresh
function getDefaultTemplates(): LabelTemplate[] {
  return [];
}

interface TemplateStore {
  templates: LabelTemplate[];
  selectedTemplateId: string | null;

  // Template actions
  addTemplate: (data: Omit<LabelTemplate, 'id' | 'createdAt' | 'updatedAt'>) => LabelTemplate;
  updateTemplate: (id: string, updates: Partial<LabelTemplate>) => void;
  deleteTemplate: (id: string) => void;
  selectTemplate: (id: string | null) => void;
  getTemplateById: (id: string) => LabelTemplate | undefined;

  // Element actions
  addElement: (templateId: string, element: Omit<TemplateElement, 'id' | 'zIndex'>) => void;
  updateElement: (templateId: string, elementId: string, updates: Partial<TemplateElement>) => void;
  removeElement: (templateId: string, elementId: string) => void;
  reorderElement: (templateId: string, elementId: string, newZIndex: number) => void;
  duplicateElement: (templateId: string, elementId: string) => void;
}

export const useTemplateStore = create<TemplateStore>()(
  persist(
    (set, get) => ({
      templates: getDefaultTemplates(),
      selectedTemplateId: null,

      addTemplate: (templateData) => {
        const now = new Date().toISOString();
        const newTemplate: LabelTemplate = {
          ...templateData,
          id: `template-${Date.now()}`,
          createdAt: now,
          updatedAt: now,
        };

        set((state) => ({
          templates: [...state.templates, newTemplate],
        }));

        return newTemplate;
      },

      updateTemplate: (id, updates) => {
        set((state) => ({
          templates: state.templates.map((t) =>
            t.id === id
              ? { ...t, ...updates, updatedAt: new Date().toISOString() }
              : t
          ),
        }));
      },

      deleteTemplate: (id) => {
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

      addElement: (templateId, elementData) => {
        set((state) => ({
          templates: state.templates.map((t) => {
            if (t.id !== templateId) return t;

            // Generate new element ID and assign next zIndex
            const maxZIndex = Math.max(0, ...t.elements.map((e) => e.zIndex));
            const newElement: TemplateElement = {
              ...elementData,
              id: `element-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              zIndex: maxZIndex + 1,
            } as TemplateElement;

            return {
              ...t,
              elements: [...t.elements, newElement],
              updatedAt: new Date().toISOString(),
            };
          }),
        }));
      },

      updateElement: (templateId, elementId, updates) => {
        set((state) => ({
          templates: state.templates.map((t) => {
            if (t.id !== templateId) return t;

            return {
              ...t,
              elements: t.elements.map((e) =>
                e.id === elementId ? ({ ...e, ...updates } as TemplateElement) : e
              ),
              updatedAt: new Date().toISOString(),
            };
          }),
        }));
      },

      removeElement: (templateId, elementId) => {
        set((state) => ({
          templates: state.templates.map((t) => {
            if (t.id !== templateId) return t;

            return {
              ...t,
              elements: t.elements.filter((e) => e.id !== elementId),
              updatedAt: new Date().toISOString(),
            };
          }),
        }));
      },

      reorderElement: (templateId, elementId, newZIndex) => {
        set((state) => ({
          templates: state.templates.map((t) => {
            if (t.id !== templateId) return t;

            const element = t.elements.find((e) => e.id === elementId);
            if (!element) return t;

            const oldZIndex = element.zIndex;

            // Reorder: shift other elements' zIndex values
            const reorderedElements = t.elements.map((e) => {
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

            return {
              ...t,
              elements: reorderedElements,
              updatedAt: new Date().toISOString(),
            };
          }),
        }));
      },

      duplicateElement: (templateId, elementId) => {
        set((state) => ({
          templates: state.templates.map((t) => {
            if (t.id !== templateId) return t;

            const element = t.elements.find((e) => e.id === elementId);
            if (!element) return t;

            // Clone element with offset position
            const maxZIndex = Math.max(0, ...t.elements.map((e) => e.zIndex));
            const duplicated: TemplateElement = {
              ...element,
              id: `element-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              x: element.x + 10, // Offset by 10 units
              y: element.y + 10,
              zIndex: maxZIndex + 1,
              // If it has a fieldName, append "-copy" to make it unique
              fieldName: element.fieldName ? `${element.fieldName}-copy` : undefined,
            } as TemplateElement;

            return {
              ...t,
              elements: [...t.elements, duplicated],
              updatedAt: new Date().toISOString(),
            };
          }),
        }));
      },
    }),
    {
      name: STORAGE_KEY,
    }
  )
);
