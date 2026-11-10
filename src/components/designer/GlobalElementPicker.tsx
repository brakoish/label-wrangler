'use client';

import { useState } from 'react';
import { Globe, Plus, Trash2, Search } from 'lucide-react';
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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search reusable elements"
              placeholder="Search reusable elements…"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 pl-9 pr-3 py-2 focus:border-amber-500/30 placeholder:text-zinc-500"
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-center py-10">
              <Globe className="w-10 h-10 text-zinc-500 mx-auto mb-3" />
              <p className="text-zinc-400 text-sm">
                {search ? 'Nothing matches your search' : 'No reusable elements yet'}
              </p>
              {!search && (
                <p className="text-zinc-500 text-xs mt-1">
                  Select objects on a design, then choose “Save selection for reuse” under Layers.
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filtered.map((g) => (
                <div
                  key={g.id}
                  className="flex items-start gap-3 p-4 rounded-xl bg-zinc-800/50 border border-zinc-700 hover:border-amber-500/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-zinc-100 text-sm mb-0.5">{g.name}</div>
                    {g.description && (
                      <div className="text-xs text-zinc-500 mb-2">{g.description}</div>
                    )}
                    <div className="text-xs text-zinc-500">
                      {g.elements.length} object{g.elements.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => { onInsert(g.elements); onClose(); }}
                      className="inline-flex min-h-10 items-center gap-1 px-2.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/10 text-amber-400 text-xs font-medium transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />Insert
                    </button>
                    {onDelete && (
                      <button
                        type="button"
                        onClick={async () => { if (await confirmDialog({ title: `Delete “${g.name}”?`, body: 'Designs that already use it keep their copy. It just won’t be offered here any more.', confirmLabel: 'Delete', danger: true })) onDelete(g.id); }}
                        className="grid min-h-10 min-w-10 place-items-center rounded-lg hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-colors"
                        aria-label={`Delete reusable element ${g.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
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
