'use client';

import { useState } from 'react';
import { Type, QrCode, Barcode, Minus, Square, Image, X } from 'lucide-react';
import { ElementType } from '@/lib/types';

interface AddElementMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onAddElement: (type: ElementType) => void;
}

export function AddElementMenu({ isOpen, onClose, onAddElement }: AddElementMenuProps) {
  if (!isOpen) return null;

  const elementTypes: Array<{ type: ElementType; icon: typeof Type; label: string; description: string }> = [
    {
      type: 'text',
      icon: Type,
      label: 'Text',
      description: 'Add text labels, descriptions, or dynamic fields',
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass rounded-2xl p-6 max-w-2xl w-full border border-zinc-800">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold text-zinc-100 gradient-text">Add Element</h3>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {elementTypes.map(({ type, icon: Icon, label, description }) => (
            <button
              key={type}
              onClick={() => {
                onAddElement(type);
                onClose();
              }}
              className="flex items-start gap-4 p-4 rounded-xl bg-zinc-800/50 border border-zinc-700 hover:bg-zinc-800 hover:border-amber-600/50 transition-all text-left group"
            >
              <div className="p-2.5 rounded-lg bg-zinc-900/50 border border-zinc-700 group-hover:border-amber-600/50 group-hover:bg-amber-600/10 transition-all">
                <Icon className="w-5 h-5 text-zinc-400 group-hover:text-amber-500 transition-colors" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-zinc-100 mb-1 group-hover:text-amber-500 transition-colors">
                  {label}
                </div>
                <div className="text-xs text-zinc-500">{description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
