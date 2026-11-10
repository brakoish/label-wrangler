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
    {
      type: 'text',
      icon: Type,
      label: 'Text',
      description: 'Words, descriptions, or text that changes per label',
    },
    {
      type: 'qr',
      icon: QrCode,
      label: 'QR Code',
      description: 'Add scannable QR codes for URLs, IDs, or data',
    },
    {
      type: 'barcode',
      icon: Barcode,
      label: 'Barcode',
      description: 'Add 1D barcodes (CODE128, UPC, EAN, etc.)',
    },
    {
      type: 'line',
      icon: Minus,
      label: 'Line',
      description: 'Add decorative or dividing lines',
    },
    {
      type: 'rectangle',
      icon: Square,
      label: 'Rectangle',
      description: 'Add boxes, borders, or backgrounds',
    },
    {
      type: 'image',
      icon: Image,
      label: 'Image',
      description: 'Add logos or static images',
    },
  ];

  return (
    <Dialog open={isOpen} onClose={onClose} title="Add to your label" className="max-w-2xl">
      <div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 stagger">
          {elementTypes.map(({ type, icon: Icon, label, description }) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                onAddElement(type);
                onClose();
              }}
              className="flex items-start gap-3 rounded-lg border border-zinc-800 p-3 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800 active:scale-[0.99] group"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-300 group-hover:bg-zinc-700 group-hover:text-zinc-50 transition-colors">
                <Icon className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-zinc-100">
                  {label}
                </div>
                <div className="mt-0.5 text-sm text-zinc-400">{description}</div>
              </div>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => { onClose(); onInsertGlobal(); }}
          className="mt-3 flex w-full items-center gap-3 rounded-lg border border-dashed border-zinc-700 p-3 text-left transition-colors hover:border-zinc-600 hover:bg-zinc-800 group"
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-300">
            <Globe className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <div className="font-medium text-zinc-100">Insert a reusable element</div>
            <div className="mt-0.5 text-sm text-zinc-400">Pieces you saved to use on any design</div>
          </div>
        </button>
      </div>
    </Dialog>
  );
}
