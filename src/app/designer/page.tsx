'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useTemplateStore } from '@/lib/templateStore';
import { useFormatStore } from '@/lib/store';
import { ElementType, TemplateElement } from '@/lib/types';
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

  // If no template is selected, show template list
  if (!currentTemplate || !currentFormat) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950">
        {/* Header */}
        <header className="glass border-b border-zinc-800 sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-4">
              <div className="w-14 h-14 relative group">
                <svg viewBox="0 0 200 200" className="w-full h-full group-hover:animate-[buck_0.5s_ease-in-out]">
                  <rect x="20" y="60" width="160" height="100" rx="8" fill="none" stroke="currentColor" strokeWidth="6" className="text-amber-600" />
                  <rect x="30" y="70" width="140" height="30" rx="4" fill="currentColor" className="text-amber-600/20" />
                  <path d="M 80 120 Q 100 110 120 120" stroke="currentColor" strokeWidth="4" fill="none" className="text-amber-600" strokeLinecap="round" />
                  <circle cx="70" cy="100" r="3" fill="currentColor" className="text-amber-600" />
                  <circle cx="130" cy="100" r="3" fill="currentColor" className="text-amber-600" />
                  <path d="M 60 50 L 70 35 L 75 50 M 125 50 L 130 35 L 140 50" stroke="currentColor" strokeWidth="3" fill="none" className="text-amber-600" strokeLinecap="round" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold gradient-text">Label Wrangler</h1>
            </Link>

            <nav className="flex items-center gap-4">
              <Link
                href="/"
                className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
              >
                Formats
              </Link>
              <span className="px-4 py-2 text-sm text-amber-500 font-medium">
                Designer
              </span>
            </nav>
          </div>
        </header>

        {/* Template List */}
        <TemplateList
          templates={templates}
          onSelectTemplate={(id) => {
            selectTemplate(id);
            router.push(`/designer?id=${id}`);
          }}
          onDeleteTemplate={deleteTemplate}
          onNewTemplate={() => setShowNewTemplateDialog(true)}
        />

        {/* New Template Dialog */}
        <NewTemplateDialog
          isOpen={showNewTemplateDialog}
          onClose={() => setShowNewTemplateDialog(false)}
          onCreate={(name, description, formatId) => {
            const newTemplate = addTemplate({
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
      </div>
    );
  }

  // Template editor view
  const selectedElement = selectedElementId
    ? currentTemplate.elements.find((e) => e.id === selectedElementId) || null
    : null;

  const handleAddElement = (type: ElementType) => {
    // Calculate default position and size based on format
    const defaultWidth = currentFormat.type === 'thermal' ? 100 : 1;
    const defaultHeight = currentFormat.type === 'thermal' ? 50 : 0.5;

    // Create base element data
    const baseElement = {
      x: 10,
      y: 10,
      width: defaultWidth,
      height: defaultHeight,
      rotation: 0,
      isStatic: true,
    };

    // Type-specific defaults - using any to bypass strict type checking in switch
    let elementData: any;

    switch (type) {
      case 'text':
        elementData = {
          ...baseElement,
          type: 'text',
          content: 'Text',
          fontSize: 12,
          fontFamily: 'Arial',
          fontWeight: 'normal',
          textAlign: 'left',
          color: '#000000',
        };
        break;
      case 'qr':
        elementData = {
          ...baseElement,
          type: 'qr',
          content: 'https://example.com',
          errorCorrection: 'M',
          width: defaultWidth * 2,
          height: defaultHeight * 2,
        };
        break;
      case 'barcode':
        elementData = {
          ...baseElement,
          type: 'barcode',
          content: '123456789',
          barcodeFormat: 'CODE128',
          showText: true,
          width: defaultWidth * 2,
          height: defaultHeight * 1.5,
        };
        break;
      case 'line':
        elementData = {
          ...baseElement,
          type: 'line',
          strokeWidth: 2,
          color: '#000000',
          height: 0,
        };
        break;
      case 'rectangle':
        elementData = {
          ...baseElement,
          type: 'rectangle',
          strokeWidth: 2,
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
    <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950 flex flex-col">
      {/* Header */}
      <header className="glass border-b border-zinc-800 sticky top-0 z-10">
        <div className="px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/designer"
              className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors"
              title="Back to templates"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="w-10 h-10 relative">
              <svg viewBox="0 0 200 200" className="w-full h-full">
                <rect x="20" y="60" width="160" height="100" rx="8" fill="none" stroke="currentColor" strokeWidth="6" className="text-amber-600" />
                <rect x="30" y="70" width="140" height="30" rx="4" fill="currentColor" className="text-amber-600/20" />
                <path d="M 80 120 Q 100 110 120 120" stroke="currentColor" strokeWidth="4" fill="none" className="text-amber-600" strokeLinecap="round" />
                <circle cx="70" cy="100" r="3" fill="currentColor" className="text-amber-600" />
                <circle cx="130" cy="100" r="3" fill="currentColor" className="text-amber-600" />
                <path d="M 60 50 L 70 35 L 75 50 M 125 50 L 130 35 L 140 50" stroke="currentColor" strokeWidth="3" fill="none" className="text-amber-600" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold gradient-text">{currentTemplate.name}</h1>
              <p className="text-xs text-zinc-500">{currentFormat.name}</p>
            </div>
          </div>

          <nav className="flex items-center gap-4">
            <Link
              href="/"
              className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              Formats
            </Link>
            <Link
              href="/designer"
              className="px-4 py-2 text-sm text-amber-500 font-medium"
            >
              Designer
            </Link>
          </nav>
        </div>
      </header>

      {/* Main Editor Layout */}
      <div className="flex-1 flex overflow-hidden">
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
          <LabelPreview
            format={currentFormat}
            elements={currentTemplate.elements}
            selectedElementId={selectedElementId}
            onSelectElement={setSelectedElementId}
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
    </div>
  );
}

export default function DesignerPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950 flex items-center justify-center">
        <div className="text-zinc-400">Loading...</div>
      </div>
    }>
      <DesignerContent />
    </Suspense>
  );
}
