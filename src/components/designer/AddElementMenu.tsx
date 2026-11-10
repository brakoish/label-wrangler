'use client';

import { Type, QrCode, Barcode, Minus, Square, Image, Globe } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { ElementType } from '@/lib/types';

interface AddElementMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onAddElement: (type: ElementType) => void;
  onInsertGlobal: () => void;
}

export function AddElementMenu({ isOpen, onClose, onAddElement, onInsertGlobal }: AddElementMenuProps) {
  if (!isOpen) return null;

  const elementTypes: Array<{ type: ElementType; icon: typeof Type; label: string; description: string }> = [
    { type: 'text', icon: Type, label: 'Text', description: 'Words or numbers' },
    { type: 'barcode', icon: Barcode, label: 'Barcode', description: 'Bars a scanner reads' },
    { type: 'qr', icon: QrCode, label: 'QR code', description: 'A web link or ID' },
    { type: 'image', icon: Image, label: 'Picture', description: 'A logo or symbol' },
    { type: 'line', icon: Minus, label: 'Line', description: 'A divider' },
    { type: 'rectangle', icon: Square, label: 'Box', description: 'A border or block' },
  ];

  return (
    <Dialog open={isOpen} onClose={onClose} title="Add to your label" className="max-w-xl">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 stagger">
        {elementTypes.map(({ type, icon: Icon, label, description }, i) => (
          <button
            key={type}
            type="button"
            data-autofocus={i === 0 ? true : undefined}
            onClick={() => {
              onAddElement(type);
              onClose();
            }}
            className="flex min-h-control flex-col items-start gap-2 rounded-lg bg-zinc-800 p-3 text-left transition-colors hover:bg-zinc-700 active:scale-[0.98] group"
          >
            <Icon className="size-5 text-zinc-300 group-hover:text-zinc-100" aria-hidden="true" />
            <span>
              <span className="block font-medium text-zinc-100">{label}</span>
              <span className="block text-sm text-zinc-400">{description}</span>
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => { onClose(); onInsertGlobal(); }}
        className="btn btn-ghost btn-sm mt-3 -ml-2"
      >
        <Globe className="size-4" aria-hidden="true" />
        Add a saved item
      </button>
    </Dialog>
  );
}
