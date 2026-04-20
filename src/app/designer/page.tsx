'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Undo2, Redo2 } from 'lucide-react';
import { useTemplateStore } from '@/lib/templateStore';
import { useFormatStore } from '@/lib/store';
import { useUndoStore } from '@/lib/undoStore';
import { ElementType, TemplateElement } from '@/lib/types';
import { AppShell } from '@/components/AppShell';
import { LabelPreview } from '@/components/designer/LabelPreview';
import { PropertyPanel } from '@/components/designer/PropertyPanel';
import { ElementList } from '@/components/designer/ElementList';
import { TemplateList, NewTemplateDialog } from '@/components/designer/TemplateList';
import { AddElementMenu } from '@/components/designer/AddElementMenu';
import { LayoutPreview } from '@/components/designer/LayoutPreview';
import { TestDataPanel } from '@/components/designer/TestDataPanel';

function DesignerContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateId = searchParams.get('id');

  const {
    templates,
    selectedTemplateId,
    addTemplate,
    deleteTemplate,
    selectTemplate,
    getTemplateById,
    addElement,
    updateElement,
    updateElementLocal,
    saveTemplate,
    removeElement,
    reorderElement,
    duplicateElement,
  } = useTemplateStore();

  const { getFormatById } = useFormatStore();
  const { push: pushUndo, undo, redo, setCurrent: setUndoCurrent, canUndo, canRedo, clear: clearUndo } = useUndoStore();

  const [showNewTemplateDialog, setShowNewTemplateDialog] = useState(false);
  const [showAddElementMenu, setShowAddElementMenu] = useState(false);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [testData, setTestData] = useState<Record<string, string>>({});

  // Sync template selection with URL
  useEffect(() => {
    if (templateId && templateId !== selectedTemplateId) {
      selectTemplate(templateId);
    } else if (!templateId && selectedTemplateId) {
      // URL cleared but store still has selection — clear it
      selectTemplate(null);
    }
  }, [templateId, selectedTemplateId, selectTemplate]);

  const currentTemplate = selectedTemplateId ? getTemplateById(selectedTemplateId) : null;
  const currentFormat = currentTemplate ? getFormatById(currentTemplate.formatId) : null;

  // Push undo state before making changes
  const pushUndoState = useCallback(() => {
    if (currentTemplate) {
      pushUndo(currentTemplate.id, currentTemplate.elements);
    }
  }, [currentTemplate, pushUndo]);

  // Undo handler
  const handleUndo = useCallback(() => {
    if (!currentTemplate || !canUndo()) return;
    const prev = undo();
    if (prev) {
      // Save current state for redo
      setUndoCurrent(currentTemplate.id, currentTemplate.elements);
      // Apply previous state
      const updatedElements = prev.elements;
      fetch(`/api/templates/${currentTemplate.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elements: updatedElements }),
      });
      // Update local store
      useTemplateStore.setState((state) => ({
        templates: state.templates.map((t) =>
          t.id === currentTemplate.id ? { ...t, elements: updatedElements } : t
        ),
      }));
    }
  }, [currentTemplate, undo, setUndoCurrent, canUndo]);

  // Redo handler
  const handleRedo = useCallback(() => {
    if (!currentTemplate || !canRedo()) return;
    const next = redo();
    if (next) {
      pushUndo(currentTemplate.id, currentTemplate.elements);
      const updatedElements = next.elements;
      fetch(`/api/templates/${currentTemplate.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elements: updatedElements }),
      });
      useTemplateStore.setState((state) => ({
        templates: state.templates.map((t) =>
          t.id === currentTemplate.id ? { ...t, elements: updatedElements } : t
        ),
      }));
    }
  }, [currentTemplate, redo, pushUndo, canRedo]);

  // Keyboard shortcuts: Ctrl+Z / Ctrl+Shift+Z (or Cmd on Mac)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo]);

  // Clear undo history when switching templates
  useEffect(() => {
    clearUndo();
  }, [selectedTemplateId, clearUndo]);

  // If no template is selected, show template list view
  if (!currentTemplate || !currentFormat) {
    return (
      <AppShell>
        {/* Template List */}
        <div className="flex-1 overflow-auto">
          <TemplateList
            templates={templates}
            onSelectTemplate={(id) => {
              selectTemplate(id);
              router.push(`/designer?id=${id}`);
            }}
            onDeleteTemplate={deleteTemplate}
            onNewTemplate={() => setShowNewTemplateDialog(true)}
          />
        </div>

        {/* New Template Dialog */}
        <NewTemplateDialog
          isOpen={showNewTemplateDialog}
          onClose={() => setShowNewTemplateDialog(false)}
          onCreate={async (name, description, formatId) => {
            const newTemplate = await addTemplate({
              name,
              description,
              formatId,
              elements: [],
            });
            selectTemplate(newTemplate.id);
            router.push(`/designer?id=${newTemplate.id}`);
            setShowNewTemplateDialog(false);
          }}
        />
      </AppShell>
    );
  }

  // Template editor view
  const selectedElement = selectedElementId
    ? currentTemplate.elements.find((e) => e.id === selectedElementId) || null
    : null;

  const handleAddElement = (type: ElementType) => {
    pushUndoState();
    // Calculate dimensions in the label's native units
    const isThermal = currentFormat.type === 'thermal';
    const dpi = currentFormat.dpi || 203;

    // Label dimensions in working units (dots for thermal, inches for sheet)
    const labelW = isThermal ? currentFormat.width * dpi : currentFormat.width;
    const labelH = isThermal ? currentFormat.height * dpi : currentFormat.height;

    // Default element size: ~30% of the smaller label dimension
    const unit = Math.min(labelW, labelH);
    const defaultW = Math.round((unit * 0.4) * 100) / 100;
    const defaultH = Math.round((unit * 0.2) * 100) / 100;

    // Position: 5% from top-left
    const defaultX = Math.round((labelW * 0.05) * 100) / 100;
    const defaultY = Math.round((labelH * 0.05) * 100) / 100;

    // Font size proportional to label
    // Sheet: ~10-14pt for readability. Thermal: proportional to dots.
    const defaultFontSize = isThermal
      ? Math.max(8, Math.round(unit * 0.06))
      : Math.max(6, Math.min(14, Math.round(unit * 12))); // cap at 14pt for sheet labels

    // Stroke width proportional
    const defaultStroke = isThermal ? Math.max(1, Math.round(unit * 0.005)) : Math.round(unit * 0.01 * 100) / 100;

    const baseElement = {
      x: defaultX,
      y: defaultY,
      width: defaultW,
      height: defaultH,
      rotation: 0,
      isStatic: true,
    };

    let elementData: any;

    switch (type) {
      case 'text':
        elementData = {
          ...baseElement,
          type: 'text',
          content: 'Text',
          fontSize: defaultFontSize,
          fontFamily: 'Arial',
          fontWeight: 'normal',
          textAlign: 'left',
          color: '#000000',
          lineHeight: 1.2,
          // Height: enough for 2 lines of text
          height: isThermal ? defaultFontSize * 3 : (defaultFontSize / 72) * 2.5,
          // Width: at least 60% of label width for text
          width: Math.round((labelW * 0.6) * 100) / 100,
        };
        break;
      case 'qr': {
        // QR should be square, ~40% of the smaller label dimension
        const qrSize = Math.round((unit * 0.4) * 100) / 100;
        elementData = {
          ...baseElement,
          type: 'qr',
          content: 'https://example.com',
          errorCorrection: 'M',
          width: qrSize,
          height: qrSize,
        };
        break;
      }
      case 'barcode':
        elementData = {
          ...baseElement,
          type: 'barcode',
          content: '123456789',
          barcodeFormat: 'CODE128',
          showText: true,
          width: Math.round((labelW * 0.6) * 100) / 100,
          height: Math.round((labelH * 0.25) * 100) / 100,
        };
        break;
      case 'line':
        elementData = {
          ...baseElement,
          type: 'line',
          strokeWidth: defaultStroke,
          color: '#000000',
          width: Math.round((labelW * 0.8) * 100) / 100,
          height: 0,
        };
        break;
      case 'rectangle':
        elementData = {
          ...baseElement,
          type: 'rectangle',
          strokeWidth: defaultStroke,
          strokeColor: '#000000',
          fillColor: '',
          borderRadius: 0,
        };
        break;
      case 'image':
        elementData = {
          ...baseElement,
          type: 'image',
          src: '',
          objectFit: 'contain',
        };
        break;
      default:
        return;
    }

    addElement(currentTemplate.id, elementData as Omit<TemplateElement, 'id' | 'zIndex'>);
  };

  const handleUpdateElement = (updates: Partial<TemplateElement>) => {
    if (!selectedElementId) return;
    pushUndoState();
    updateElement(currentTemplate.id, selectedElementId, updates);
  };

  const handleMoveElement = (elementId: string, direction: 'up' | 'down') => {
    pushUndoState();
    const element = currentTemplate.elements.find((e) => e.id === elementId);
    if (!element) return;

    const newZIndex = direction === 'up' ? element.zIndex + 1 : element.zIndex - 1;
    reorderElement(currentTemplate.id, elementId, newZIndex);
  };

  return (
    <AppShell>
      {/* Editor layout fills the content area */}
      <div className="flex-1 flex overflow-hidden max-w-[1600px] mx-auto w-full">
        {/* Left Panel - Element List + Test Data */}
        <div className="w-[280px] flex flex-col border-r border-zinc-800/50">
          <ElementList
            elements={currentTemplate.elements}
            selectedElementId={selectedElementId}
            onSelectElement={setSelectedElementId}
            onDeleteElement={(id) => {
              pushUndoState();
              removeElement(currentTemplate.id, id);
              if (selectedElementId === id) setSelectedElementId(null);
            }}
            onDuplicateElement={(id) => {
              pushUndoState();
              duplicateElement(currentTemplate.id, id);
            }}
            onMoveElement={handleMoveElement}
            onAddElement={() => setShowAddElementMenu(true)}
            onBackToTemplates={() => {
              selectTemplate(null);
              router.push('/designer');
            }}
          />
          <TestDataPanel
            elements={currentTemplate.elements}
            testData={testData}
            onTestDataChange={(field, value) => setTestData((prev) => ({ ...prev, [field]: value }))}
          />
        </div>

        {/* Center Panel - Preview */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {/* Breadcrumb bar */}
          <div className="px-6 py-3 border-b border-zinc-800/50 flex items-center gap-2 text-sm">
            <button
              onClick={() => {
                selectTemplate(null);
                router.push('/designer');
              }}
              className="text-zinc-500 hover:text-amber-400 transition-colors"
            >
              Templates
            </button>
            <span className="text-zinc-700">/</span>
            <span className="text-zinc-100 font-semibold">{currentTemplate.name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ml-2 ${
              currentFormat.type === 'thermal'
                ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
            }`}>
              {currentFormat.name}
            </span>

            {/* Undo/Redo */}
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={handleUndo}
                disabled={!canUndo()}
                title="Undo (Ctrl+Z)"
                className={`p-1.5 rounded-lg transition-colors ${canUndo() ? 'text-zinc-400 hover:text-amber-400 hover:bg-amber-500/5' : 'text-zinc-700 cursor-not-allowed'}`}
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                onClick={handleRedo}
                disabled={!canRedo()}
                title="Redo (Ctrl+Shift+Z)"
                className={`p-1.5 rounded-lg transition-colors ${canRedo() ? 'text-zinc-400 hover:text-amber-400 hover:bg-amber-500/5' : 'text-zinc-700 cursor-not-allowed'}`}
              >
                <Redo2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <LabelPreview
            format={currentFormat}
            elements={currentTemplate.elements}
            selectedElementId={selectedElementId}
            onSelectElement={setSelectedElementId}
            onUpdateElement={(id, updates) => updateElementLocal(currentTemplate.id, id, updates)}
            onDragStart={pushUndoState}
            onDragEnd={() => saveTemplate(currentTemplate.id)}
            testData={testData}
          />
          <LayoutPreview format={currentFormat} elements={currentTemplate.elements} />
        </div>

        {/* Right Panel - Properties */}
        <PropertyPanel
          element={selectedElement}
          format={currentFormat}
          onUpdate={handleUpdateElement}
        />
      </div>

      {/* Add Element Menu */}
      <AddElementMenu
        isOpen={showAddElementMenu}
        onClose={() => setShowAddElementMenu(false)}
        onAddElement={handleAddElement}
      />

      {/* New Template Dialog (accessible from editor too) */}
      <NewTemplateDialog
        isOpen={showNewTemplateDialog}
        onClose={() => setShowNewTemplateDialog(false)}
        onCreate={async (name, description, formatId) => {
          const newTemplate = await addTemplate({
            name,
            description,
            formatId,
            elements: [],
          });
          selectTemplate(newTemplate.id);
          router.push(`/designer?id=${newTemplate.id}`);
          setShowNewTemplateDialog(false);
        }}
      />
    </AppShell>
  );
}

export default function DesignerPage() {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center bg-[#0c0c0e]">
        <div className="text-zinc-400">Loading...</div>
      </div>
    }>
      <DesignerContent />
    </Suspense>
  );
}
