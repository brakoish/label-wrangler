'use client';

import { useState } from 'react';
import { Plus, Trash2, Search } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { confirmDialog } from '@/components/ui/feedback';
import type { GlobalElement, TemplateElement } from '@/lib/types';

interface GlobalElementPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (elements: TemplateElement[]) => void;
  onDelete?: (id: string) => void;
  globals: GlobalElement[];
}

export function GlobalElementPicker({ isOpen, onClose, onInsert, onDelete, globals }: GlobalElementPickerProps) {
  const [search, setSearch] = useState('');

  const filtered = globals.filter(
    (g) =>
      !search ||
      g.name.toLowerCase().includes(search.toLowerCase()) ||
      (g.description ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Dialog open={isOpen} onClose={onClose} title="Insert a reusable element" className="max-w-2xl">
      <div className="flex flex-col">

        {globals.length > 4 && (
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search reusable elements"
              placeholder="Search reusable elements…"
              className="field w-full pl-9 pr-3 placeholder:text-zinc-400"
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-center py-10">
              
              <p className="text-zinc-100 text-sm font-medium">
                {search ? 'Nothing matches your search' : 'No reusable elements yet'}
              </p>
              {!search && (
                <p className="text-zinc-400 text-sm mt-1">
                  Pick items on a design, then choose “Save selected for reuse” in the items list.
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filtered.map((g) => (
                <div
                  key={g.id}
                  className="flex items-start gap-3 rounded-lg bg-zinc-950 p-3 transition-colors hover:bg-zinc-800"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-zinc-100 text-sm mb-0.5">{g.name}</div>
                    {g.description && (
                      <div className="text-sm text-zinc-400 mb-1">{g.description}</div>
                    )}
                    <div className="text-xs text-zinc-400">
                      {g.elements.length} object{g.elements.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => { onInsert(g.elements); onClose(); }}
                      className="btn btn-primary btn-sm"
                    >
                      <Plus className="size-4" aria-hidden="true" />Insert
                    </button>
                    {onDelete && (
                      <button
                        type="button"
                        onClick={async () => { if (await confirmDialog({ title: `Delete “${g.name}”?`, body: 'Designs that already use it keep their copy. It just won’t be offered here any more.', confirmLabel: 'Delete', danger: true })) onDelete(g.id); }}
                        className="btn btn-danger-ghost btn-icon btn-sm"
                        aria-label={`Delete reusable element ${g.name}`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
