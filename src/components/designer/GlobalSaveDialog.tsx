'use client';

import { useState } from 'react';
import { X, Globe } from 'lucide-react';
import { TemplateElement } from '@/lib/types';

interface GlobalSaveDialogProps {
  isOpen: boolean;
  elements: TemplateElement[]; // elements to save as a global block
  onClose: () => void;
  onSave: (name: string, description: string) => void;
}

export function GlobalSaveDialog({ isOpen, elements, onClose, onSave }: GlobalSaveDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass rounded-2xl p-6 max-w-md w-full border border-zinc-800">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-amber-400" />
            <h3 className="text-lg font-semibold text-zinc-100">Save as Global Element</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-zinc-400 text-sm mb-4">
          Saving {elements.length} element{elements.length !== 1 ? 's' : ''} as a reusable design block.
          It will be available in the Add Element menu for all templates.
        </p>

        <div className="space-y-3 mb-5">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Compliance Header, Footer Block"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 px-3 py-2 focus:outline-none focus:border-amber-500/40 placeholder:text-zinc-600"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional note about what this contains"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 px-3 py-2 focus:outline-none focus:border-amber-500/40 placeholder:text-zinc-600"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (name.trim()) {
                onSave(name.trim(), description.trim());
                setName('');
                setDescription('');
              }
            }}
            disabled={!name.trim()}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Save Global
          </button>
        </div>
      </div>
    </div>
  );
}
