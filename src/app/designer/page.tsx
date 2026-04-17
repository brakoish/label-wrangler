'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useTemplateStore } from '@/lib/templateStore';
import { useFormatStore } from '@/lib/store';
import { ElementType, TemplateElement } from '@/lib/types';
import { AppShell } from '@/components/AppShell';
import { LabelPreview } from '@/components/designer/LabelPreview';
import { PropertyPanel } from '@/components/designer/PropertyPanel';
import { ElementList } from '@/components/designer/ElementList';
import { TemplateList, NewTemplateDialog } from '@/components/designer/TemplateList';
import { AddElementMenu } from '@/components/designer/AddElementMenu';

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
    removeElement,
    reorderElement,
  } = useTemplateStore();

  const { getFormatById } = useFormatStore();

  const [showNewTemplateDialog, setShowNewTemplateDialog] = useState(false);
  const [showAddElementMenu, setShowAddElementMenu] = useState(false);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);

  // Load template from URL if present
  useEffect(() => {
    if (templateId && templateId !== selectedTemplateId) {
      selectTemplate(templateId);
    }
  }, [templateId, selectedTemplateId, selectTemplate]);

  const currentTemplate = selectedTemplateId ? getTemplateById(selectedTemplateId) : null;
  const currentFormat = currentTemplate ? getFormatById(currentTemplate.formatId) : null;

  // If no template is selected, show template list view
  if (!currentTemplate || !currentFormat) {
    return (
      <AppShell
        headerAction={
          <button
            onClick={() => setShowNewTemplateDialog(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 text-black text-sm font-semibold rounded-lg hover:from-amber-400 hover:to-amber-500 transition-all shadow-lg shadow-amber-500/20"
          >
            <Plus className="w-4 h-4" />
            New Template
          </button>
        }
      >
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
    const defaultFontSize = isThermal
      ? Math.max(8, Math.round(unit * 0.06))
      : Math.max(6, Math.round(unit * 30)); // ~30pt per inch for readability

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
          height: isThermal ? defaultFontSize * 1.5 : defaultFontSize / 72, // convert pt to inches roughly
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
    updateElement(currentTemplate.id, selectedElementId, updates);
  };

  const handleMoveElement = (elementId: string, direction: 'up' | 'down') => {
    const element = currentTemplate.elements.find((e) => e.id === elementId);
    if (!element) return;

    const newZIndex = direction === 'up' ? element.zIndex + 1 : element.zIndex - 1;
    reorderElement(currentTemplate.id, elementId, newZIndex);
  };

  return (
    <AppShell>
      {/* Editor layout fills the content area */}
      <div className="flex-1 flex overflow-hidden max-w-[1600px] mx-auto w-full">
        {/* Left Panel - Element List */}
        <ElementList
          elements={currentTemplate.elements}
          selectedElementId={selectedElementId}
          onSelectElement={setSelectedElementId}
          onDeleteElement={(id) => {
            removeElement(currentTemplate.id, id);
            if (selectedElementId === id) setSelectedElementId(null);
          }}
          onMoveElement={handleMoveElement}
          onAddElement={() => setShowAddElementMenu(true)}
        />

        {/* Center Panel - Preview */}
        <div className="flex-1 flex flex-col">
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
          </div>

          <LabelPreview
            format={currentFormat}
            elements={currentTemplate.elements}
            selectedElementId={selectedElementId}
            onSelectElement={setSelectedElementId}
            onUpdateElement={(id, updates) => updateElement(currentTemplate.id, id, updates)}
          />
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
