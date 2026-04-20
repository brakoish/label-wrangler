'use client';

import { Type, QrCode, Barcode, Minus, Square, Image, Trash2, ChevronUp, ChevronDown, Plus, ArrowLeft, Copy } from 'lucide-react';
import { TemplateElement } from '@/lib/types';

interface ElementListProps {
  elements: TemplateElement[];
  selectedElementId: string | null;
  onSelectElement: (id: string) => void;
  onDeleteElement: (id: string) => void;
  onDuplicateElement: (id: string) => void;
  onMoveElement: (id: string, direction: 'up' | 'down') => void;
  onAddElement: () => void;
  onBackToTemplates?: () => void;
}

export function ElementList({
  elements,
  selectedElementId,
  onSelectElement,
  onDeleteElement,
  onDuplicateElement,
  onMoveElement,
  onAddElement,
  onBackToTemplates,
}: ElementListProps) {
  const sortedElements = [...elements].sort((a, b) => b.zIndex - a.zIndex);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Back to templates */}
      {onBackToTemplates && (
        <button
          onClick={onBackToTemplates}
          className="flex items-center gap-2 px-4 py-2.5 text-zinc-400 hover:text-zinc-200 text-sm border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
          All Templates
        </button>
      )}

      {/* Add Element button */}
      <div className="p-4 space-y-4">
        <button
          onClick={onAddElement}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 text-black text-sm font-semibold rounded-xl hover:from-amber-400 hover:to-amber-500 transition-all shadow-lg shadow-amber-500/20"
        >
          <Plus className="w-4 h-4" />
          Add Element
        </button>
      </div>

      {/* Element list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {sortedElements.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-zinc-900 flex items-center justify-center border border-zinc-800/50">
              <Square className="w-8 h-8 text-zinc-600" />
            </div>
            <p className="text-zinc-400 text-sm font-medium">No elements yet</p>
            <p className="text-zinc-600 text-xs mt-1">Add elements to build your template</p>
          </div>
        ) : (
          sortedElements.map((element) => (
            <ElementItem
              key={element.id}
              element={element}
              isSelected={selectedElementId === element.id}
              onSelect={() => onSelectElement(element.id)}
              onDelete={() => onDeleteElement(element.id)}
              onDuplicate={() => onDuplicateElement(element.id)}
              onMoveUp={() => onMoveElement(element.id, 'up')}
              onMoveDown={() => onMoveElement(element.id, 'down')}
              canMoveUp={element.zIndex < Math.max(...elements.map((e) => e.zIndex))}
              canMoveDown={element.zIndex > Math.min(...elements.map((e) => e.zIndex))}
            />
          ))
        )}
      </div>

    </div>
  );
}

function ElementItem({
  element,
  isSelected,
  onSelect,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  element: TemplateElement;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const Icon = getElementIcon(element.type);
  const label = getElementLabel(element);
  const typeLabel = element.type.charAt(0).toUpperCase() + element.type.slice(1);

  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all card-hover ${
        isSelected
          ? 'bg-amber-500/10 border border-amber-500/30 shadow-sm shadow-amber-500/10'
          : 'bg-zinc-900/50 border border-zinc-800/50 hover:border-zinc-700'
      }`}
    >
      {/* Type icon */}
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
        isSelected
          ? 'bg-amber-500/20'
          : 'bg-zinc-800/80'
      }`}>
        <Icon className={`w-4 h-4 ${isSelected ? 'text-amber-400' : 'text-zinc-400'}`} />
      </div>

      {/* Label */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-zinc-200 font-medium truncate">{label}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs text-zinc-500">{typeLabel}</span>
          {!element.isStatic && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
              Dynamic
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5">
        <div className="flex flex-col">
          <button
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            disabled={!canMoveUp}
            className={`p-0.5 rounded-md transition-colors ${
              canMoveUp ? 'hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200' : 'text-zinc-800 cursor-not-allowed'
            }`}
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            disabled={!canMoveDown}
            className={`p-0.5 rounded-md transition-colors ${
              canMoveDown ? 'hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200' : 'text-zinc-800 cursor-not-allowed'
            }`}
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
          className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200 transition-colors"
          title="Duplicate"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1.5 rounded-lg hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-colors"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function getElementIcon(type: string) {
  switch (type) {
    case 'text': return Type;
    case 'qr': return QrCode;
    case 'barcode': return Barcode;
    case 'line': return Minus;
    case 'rectangle': return Square;
    case 'image': return Image;
    default: return Square;
  }
}

function getElementLabel(element: TemplateElement): string {
  if (element.fieldName && !element.isStatic) return element.fieldName;
  switch (element.type) {
    case 'text': return (element as any).content || 'Text';
    case 'qr': return 'QR Code';
    case 'barcode': return 'Barcode';
    case 'line': return 'Line';
    case 'rectangle': return 'Rectangle';
    case 'image': return 'Image';
    default: return 'Element';
  }
}
