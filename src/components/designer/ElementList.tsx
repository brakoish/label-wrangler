'use client';

import { Type, QrCode, Barcode, Minus, Square, Image, Trash2, Plus, ArrowLeft, Copy, Globe, Save, Lock, Unlock } from 'lucide-react';
import { moveLayers, type LayerDirection } from '@/lib/designerLayers';
import { TemplateElement } from '@/lib/types';

interface ElementListProps {
  elements: TemplateElement[];
  selectedElementIds: Set<string>;
  onSelectElement: (id: string, additive?: boolean) => void;
  onDeleteElement: (id: string) => void;
  onDuplicateElement: (id: string) => void;
  onMoveElement: (id: string, direction: LayerDirection) => void;
  onLockElements: (ids: Set<string>, locked: boolean) => void;
  onAddElement: () => void;
  onBackToTemplates?: () => void;
  onInsertGlobal?: () => void;
  onSaveAsGlobal?: () => void;
}

export function ElementList({
  elements,
  selectedElementIds,
  onSelectElement,
  onDeleteElement,
  onDuplicateElement,
  onMoveElement,
  onAddElement,
  onLockElements,
  onBackToTemplates,
  onInsertGlobal,
  onSaveAsGlobal,
}: ElementListProps) {
  const sortedElements = [...elements].sort((a, b) => b.zIndex - a.zIndex);

  const selected = sortedElements.filter(e => selectedElementIds.has(e.id));
  const primary = selected[0];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Back to templates */}
      {onBackToTemplates && (
        <button
          onClick={onBackToTemplates}
          className="btn btn-ghost justify-start rounded-none border-b border-zinc-800"
        >
          <ArrowLeft className="w-4 h-4" />
          All designs
        </button>
      )}

      {/* Add Element button */}
      <div className="p-3 space-y-2">
        <button
          onClick={onAddElement}
          className="btn btn-primary w-full"
        >
          <Plus className="w-4 h-4" />
          Add element
        </button>
        <details className="group text-sm text-zinc-400"><summary className="flex min-h-control-sm cursor-pointer items-center rounded-md hover:text-zinc-100">Reusable elements</summary>
        <div className="space-y-2 pt-1">
        {onInsertGlobal && (
          <button
            onClick={onInsertGlobal}
            className="btn btn-secondary btn-sm w-full"
          >
            <Globe className="w-4 h-4" />
            Insert reusable element
          </button>
        )}
        {onSaveAsGlobal && elements.length > 0 && (
          <button
            onClick={onSaveAsGlobal}
            disabled={selectedElementIds.size === 0}
            className="btn btn-secondary btn-sm w-full"
          >
            <Save className="w-4 h-4" />
            Save selection for reuse
          </button>
        )}
        </div>
        </details>
      </div>

      <p className="px-3 pb-2 text-xs text-zinc-500 max-lg:hidden">Shift or Ctrl-click to select several.</p>
      {primary && <div className="mx-3 mb-2 space-y-1.5 rounded-lg bg-zinc-900 p-2" aria-label="Selected layer actions">
        <p className="text-xs text-zinc-400">{selected.length} selected{selected.some(e => e.locked) ? ' · locked layers stay protected' : ''}</p>
        <div className="grid grid-cols-2 gap-0.5">
          {([['top', 'Move to top'], ['back', 'Move to back'], ['up', 'Move up'], ['down', 'Move down']] as const).map(([direction, label]) => (
            <button key={direction} onClick={() => onMoveElement(primary.id, direction)} disabled={moveLayers(elements, selectedElementIds, direction) === elements} className="btn btn-ghost btn-sm justify-start px-2 text-xs">{label}</button>
          ))}
          <button onClick={() => onLockElements(selectedElementIds, true)} disabled={selected.every(e => e.locked)} className="btn btn-ghost btn-sm justify-start px-2 text-xs">Lock selected</button>
          <button onClick={() => onLockElements(selectedElementIds, false)} disabled={selected.every(e => !e.locked)} className="btn btn-ghost btn-sm justify-start px-2 text-xs">Unlock selected</button>
        </div>
      </div>}
      {/* Element list */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-px">
        {sortedElements.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-zinc-200 text-sm font-medium">Nothing on this label yet</p>
            <p className="text-zinc-400 text-sm mt-1">Add text, a barcode or a picture to start.</p>
          </div>
        ) : (
          sortedElements.map((element) => (
            <ElementItem
              key={element.id}
              element={element}
              isSelected={selectedElementIds.has(element.id)}
              onSelect={(additive) => onSelectElement(element.id, additive)}
              onDelete={() => onDeleteElement(element.id)}
              onDuplicate={() => onDuplicateElement(element.id)}
                            onToggleLock={() => onLockElements(new Set([element.id]), !element.locked)}
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
  onToggleLock,
}: {
  element: TemplateElement;
  isSelected: boolean;
  onSelect: (additive: boolean) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onToggleLock: () => void;
}) {
  const icon = getElementIcon(element.type, `w-4 h-4 ${isSelected ? 'text-amber-400' : 'text-zinc-400'}`);
  const label = getElementLabel(element);
  const typeLabel = element.type.charAt(0).toUpperCase() + element.type.slice(1);

  return (
    <div
      data-layer-id={element.id}
      onClick={(e) => onSelect(e.shiftKey || e.ctrlKey || e.metaKey)}
      role="group"
      aria-label={`${typeLabel} layer ${label}`}
      className={`flex min-h-control items-center gap-2 rounded-lg px-1.5 py-1 cursor-pointer transition-colors ${
        isSelected
          ? 'bg-zinc-800 shadow-[inset_2px_0_0_var(--color-amber-500)]'
          : 'hover:bg-zinc-900'
      }`}
    >
      {/* Type icon */}
      <div className={`size-7 flex items-center justify-center flex-shrink-0 ${isSelected ? 'text-zinc-100' : 'text-zinc-500'}`}>
        {icon}
      </div>

      {/* Label */}
      <div className="flex-1 min-w-0">
        <button aria-pressed={isSelected} aria-label={`Select layer ${label}`} className="block w-full text-left text-sm text-zinc-100 font-medium truncate min-h-6 rounded-sm" onClick={e => { e.stopPropagation(); onSelect(e.shiftKey || e.ctrlKey || e.metaKey); }}>{label}</button>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-500">{typeLabel}</span>
          {!element.isStatic && (
            <span className="text-xs text-amber-300">
              · Changes per label
            </span>
          )}
        </div>
      </div>
      {(isSelected || element.locked) && <button onClick={e => { e.stopPropagation(); onToggleLock(); }} aria-label={`${element.locked ? 'Unlock' : 'Lock'} layer ${label}`} title={element.locked ? 'Unlock layer' : 'Lock layer'} className="btn btn-ghost btn-icon btn-sm">{element.locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}</button>}

      {/* Actions */}
      <div className={isSelected ? "flex items-center" : "hidden"}>
        <button
          onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
          className="btn btn-ghost btn-icon btn-sm"
          title="Duplicate"
          aria-label={`Duplicate layer ${label}`}
        >
          <Copy className="size-4" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="btn btn-danger-ghost btn-icon btn-sm"
          disabled={element.locked}
          title={element.locked ? "Unlock layer to delete" : "Delete"}
          aria-label={`Delete layer ${label}`}
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </div>
  );
}

function getElementIcon(type: string, className: string) {
  switch (type) {
    case 'text': return <Type className={className} />;
    case 'qr': return <QrCode className={className} />;
    case 'barcode': return <Barcode className={className} />;
    case 'line': return <Minus className={className} />;
    case 'rectangle': return <Square className={className} />;
    case 'image': return <Image className={className} />;
    default: return <Square className={className} />;
  }
}

function getElementLabel(element: TemplateElement): string {
  if (element.fieldName && !element.isStatic) return element.fieldName;
  switch (element.type) {
    case 'text': return element.content || 'Text';
    case 'qr': return 'QR Code';
    case 'barcode': return 'Barcode';
    case 'line': return 'Line';
    case 'rectangle': return 'Rectangle';
    case 'image': return 'Image';
    default: return 'Element';
  }
}
