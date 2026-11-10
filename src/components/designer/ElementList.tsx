'use client';

import { Type, QrCode, Barcode, Minus, Square, Image, Trash2, Plus, ArrowLeft, Copy, Globe, Save, Lock, Unlock, ChevronRight } from 'lucide-react';
import { moveLayers, type LayerDirection } from '@/lib/designerLayers';
import { TemplateElement } from '@/lib/types';
import { elementTypeName, friendlyFieldName } from '@/lib/fieldLabels';
import { Menu } from '@/components/ui/Menu';

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

  // Layer actions apply to the whole selection when the row is part of it.
  const targets = (id: string) => (selectedElementIds.has(id) ? selectedElementIds : new Set([id]));

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Back to templates */}
      {onBackToTemplates && (
        <button
          onClick={onBackToTemplates}
          className="btn btn-ghost justify-start rounded-none"
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
          Add an item
        </button>
        <details className="group text-sm text-zinc-400"><summary className="flex min-h-control-sm cursor-pointer list-none items-center gap-1.5 rounded-md hover:text-zinc-100 [&::-webkit-details-marker]:hidden"><ChevronRight className="size-4 transition-transform duration-200 ease-out group-open:rotate-90" aria-hidden="true" />Saved items</summary>
        <div className="space-y-2 pt-1">
        {onInsertGlobal && (
          <button
            onClick={onInsertGlobal}
            className="btn btn-secondary btn-sm w-full"
          >
            <Globe className="w-4 h-4" />
            Add a saved item
          </button>
        )}
        {onSaveAsGlobal && elements.length > 0 && (
          <button
            onClick={onSaveAsGlobal}
            disabled={selectedElementIds.size === 0}
            className="btn btn-secondary btn-sm w-full"
          >
            <Save className="w-4 h-4" />
            Save selected for reuse
          </button>
        )}
        </div>
        </details>
      </div>

      {/* Element list */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-px">
        {sortedElements.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-zinc-100 text-sm font-medium">Nothing on this label yet</p>
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
              onToggleLock={() => onLockElements(targets(element.id), !element.locked)}
              onMove={(direction) => onMoveElement(element.id, direction)}
              canMove={(direction) => moveLayers(elements, targets(element.id), direction) !== elements}
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
  onMove,
  canMove,
}: {
  element: TemplateElement;
  isSelected: boolean;
  onSelect: (additive: boolean) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onToggleLock: () => void;
  onMove: (direction: LayerDirection) => void;
  canMove: (direction: LayerDirection) => boolean;
}) {
  const icon = getElementIcon(element.type, `w-4 h-4 ${isSelected ? 'text-amber-400' : 'text-zinc-400'}`);
  const label = getElementLabel(element);
  const typeLabel = elementTypeName(element.type);

  return (
    <div
      data-layer-id={element.id}
      onClick={(e) => onSelect(e.shiftKey || e.ctrlKey || e.metaKey)}
      role="group"
      aria-label={`${typeLabel} layer ${label}`}
      className={`group/layer flex min-h-control items-center gap-2 rounded-lg px-1.5 py-1 cursor-pointer transition-colors ${
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
        {(label !== typeLabel || !element.isStatic) && <p className="truncate text-xs text-zinc-500">{label !== typeLabel ? typeLabel : ''}{!element.isStatic ? `${label !== typeLabel ? ', c' : 'C'}hanges per label` : ''}</p>}
      </div>
      {element.locked && <button onClick={e => { e.stopPropagation(); onToggleLock(); }} aria-label={`${element.locked ? 'Unlock' : 'Lock'} layer ${label}`} title={element.locked ? 'Unlock layer' : 'Lock layer'} className="btn btn-ghost btn-icon btn-sm">{element.locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}</button>}

      {/* Actions: one quiet menu per layer, shown on the selected row and on hover. */}
      <div onClick={(e) => e.stopPropagation()} className={isSelected ? 'flex items-center' : 'flex items-center opacity-0 transition-opacity duration-150 group-hover/layer:opacity-100 focus-within:opacity-100 max-lg:opacity-100'}>
        <Menu
          label={`Actions for ${label}`}
          showLabel={false}
          items={[
            { label: 'Duplicate', icon: <Copy className="size-4" aria-hidden="true" />, onSelect: onDuplicate },
            { label: 'Bring to front', onSelect: () => onMove('top'), disabled: !canMove('top') },
            { label: 'Move forward', onSelect: () => onMove('up'), disabled: !canMove('up') },
            { label: 'Move backward', onSelect: () => onMove('down'), disabled: !canMove('down') },
            { label: 'Send to back', onSelect: () => onMove('back'), disabled: !canMove('back') },
            { label: element.locked ? 'Unlock' : 'Lock in place', icon: element.locked ? <Unlock className="size-4" aria-hidden="true" /> : <Lock className="size-4" aria-hidden="true" />, onSelect: onToggleLock },
            { label: element.locked ? 'Unlock to delete' : 'Delete', icon: <Trash2 className="size-4" aria-hidden="true" />, onSelect: onDelete, danger: true, disabled: element.locked },
          ]}
        />
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
  if (element.fieldName && !element.isStatic) return friendlyFieldName(element.fieldName);
  if (element.type === 'text' && element.content?.trim()) return element.content.trim();
  return elementTypeName(element.type);
}
