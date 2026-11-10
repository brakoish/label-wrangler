'use client';

import { useId, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
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
  const nameId = useId();
  const descriptionId = useId();

  return (
    <Dialog open={isOpen} onClose={onClose} title="Save as a reusable element">
      <div>

        <p className="text-zinc-400 text-sm mb-4">
          Saves {elements.length === 1 ? 'the selected object' : `the ${elements.length} selected objects`} so you can add {elements.length === 1 ? 'it' : 'them'} to any design from &ldquo;Add to your label&rdquo;.
        </p>

        <div className="space-y-3 mb-5">
          <div>
            <label htmlFor={nameId} className="block text-xs font-medium text-zinc-400 mb-1.5">Name (required)</label>
            <input
              type="text"
              id={nameId}
              data-autofocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Compliance Header, Footer Block"
              className="field w-full placeholder:text-zinc-500"
            />
          </div>
          <div>
            <label htmlFor={descriptionId} className="block text-xs font-medium text-zinc-400 mb-1.5">Note (optional)</label>
            <input
              type="text"
              id={descriptionId}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional note about what this contains"
              className="field w-full placeholder:text-zinc-500"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (name.trim()) {
                onSave(name.trim(), description.trim());
                setName('');
                setDescription('');
              }
            }}
            disabled={!name.trim()}
            className="btn btn-primary flex-1"
          >
            Save for reuse
          </button>
        </div>
      </div>
    </Dialog>
  );
}
