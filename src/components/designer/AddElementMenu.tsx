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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {elementTypes.map(({ type, icon: Icon, label, description }) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                onAddElement(type);
                onClose();
              }}
              className="flex items-start gap-4 p-4 rounded-xl bg-zinc-800/50 border border-zinc-700 hover:bg-zinc-800 hover:border-amber-500/30 transition-colors text-left group"
            >
              <div className="p-2.5 rounded-lg bg-zinc-900/50 border border-zinc-700 group-hover:border-amber-500/30 group-hover:bg-amber-500/10 transition-colors">
                <Icon className="w-5 h-5 text-zinc-400 group-hover:text-amber-400 transition-colors" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-zinc-100 mb-1 group-hover:text-amber-400 transition-colors">
                  {label}
                </div>
                <div className="text-xs text-zinc-500">{description}</div>
              </div>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => { onClose(); onInsertGlobal(); }}
          className="w-full mt-3 flex items-center justify-center gap-2 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/10 hover:border-amber-500/30 transition-colors text-left group"
        >
          <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <Globe className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <div className="font-medium text-amber-400 text-sm">Insert a reusable element</div>
            <div className="text-xs text-amber-400">Pieces you saved to use on any design</div>
          </div>
        </button>
      </div>
    </Dialog>
  );
}
