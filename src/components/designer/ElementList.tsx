'use client';

import { Type, QrCode, Barcode, Minus, Square, Image, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { TemplateElement } from '@/lib/types';

interface ElementListProps {
  elements: TemplateElement[];
  selectedElementId: string | null;
  onSelectElement: (id: string) => void;
  onDeleteElement: (id: string) => void;
  onMoveElement: (id: string, direction: 'up' | 'down') => void;
  onAddElement: () => void;
}

export function ElementList({
  elements,
  selectedElementId,
  onSelectElement,
  onDeleteElement,
  onMoveElement,
  onAddElement,
}: ElementListProps) {
  // Sort elements by zIndex for display
  const sortedElements = [...elements].sort((a, b) => b.zIndex - a.zIndex); // Descending (top to bottom)

  return (
    <div className="w-70 glass border-r border-zinc-800 flex flex-col">
      <div className="p-4 border-b border-zinc-800">
        <h3 className="text-lg font-semibold text-zinc-100 gradient-text">Elements</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {sortedElements.length === 0 ? (
          <p className="text-sm text-zinc-500 text-center py-8">No elements yet</p>
        ) : (
          sortedElements.map((element) => (
            <ElementItem
              key={element.id}
              element={element}
              isSelected={selectedElementId === element.id}
              onSelect={() => onSelectElement(element.id)}
              onDelete={() => onDeleteElement(element.id)}
              onMoveUp={() => onMoveElement(element.id, 'up')}
              onMoveDown={() => onMoveElement(element.id, 'down')}
              canMoveUp={element.zIndex < Math.max(...elements.map((e) => e.zIndex))}
              canMoveDown={element.zIndex > Math.min(...elements.map((e) => e.zIndex))}
            />
          ))
        )}
      </div>

      <div className="p-3 border-t border-zinc-800">
        <button
          onClick={onAddElement}
          className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 text-white text-sm font-medium hover:from-amber-700 hover:to-orange-700 transition-all"
        >
          Add Element
        </button>
      </div>
    </div>
  );
}

function ElementItem({
  element,
  isSelected,
  onSelect,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  element: TemplateElement;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const Icon = getElementIcon(element.type);
  const label = getElementLabel(element);

  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-2 p-2.5 rounded-lg cursor-pointer transition-colors ${
        isSelected
          ? 'bg-amber-600/20 border border-amber-600/50'
          : 'bg-zinc-800/50 border border-zinc-700 hover:bg-zinc-800 hover:border-zinc-600'
      }`}
    >
      <Icon className="w-4 h-4 text-zinc-400 flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="text-sm text-zinc-200 truncate">{label}</div>
        {!element.isStatic && element.fieldName && (
          <div className="text-xs text-amber-500 truncate">{`{${element.fieldName}}`}</div>
        )}
      </div>

      <div className="flex items-center gap-1">
        {!element.isStatic && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-600/20 text-amber-400 border border-amber-600/30">
            D
          </span>
        )}

        <div className="flex flex-col">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMoveUp();
            }}
            disabled={!canMoveUp}
            className={`p-0.5 rounded transition-colors ${
              canMoveUp
                ? 'hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200'
                : 'text-zinc-700 cursor-not-allowed'
            }`}
            title="Move up (increase z-index)"
          >
            <ChevronUp className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMoveDown();
            }}
            disabled={!canMoveDown}
            className={`p-0.5 rounded transition-colors ${
              canMoveDown
                ? 'hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200'
                : 'text-zinc-700 cursor-not-allowed'
            }`}
            title="Move down (decrease z-index)"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1 rounded hover:bg-red-600/20 text-zinc-400 hover:text-red-400 transition-colors"
          title="Delete element"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function getElementIcon(type: string) {
  switch (type) {
    case 'text':
      return Type;
    case 'qr':
      return QrCode;
    case 'barcode':
      return Barcode;
    case 'line':
      return Minus;
    case 'rectangle':
      return Square;
    case 'image':
      return Image;
    default:
      return Square;
  }
}

function getElementLabel(element: TemplateElement): string {
  if (element.fieldName && !element.isStatic) {
    return element.fieldName;
  }

  switch (element.type) {
    case 'text':
      return (element as any).content || 'Text';
    case 'qr':
      return 'QR Code';
    case 'barcode':
      return 'Barcode';
    case 'line':
      return 'Line';
    case 'rectangle':
      return 'Rectangle';
    case 'image':
      return 'Image';
    default:
      return 'Element';
  }
}
