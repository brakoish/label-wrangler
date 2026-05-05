'use client';

import { useState } from 'react';
import { Globe, Plus, X, Trash2, Search } from 'lucide-react';
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

  if (!isOpen) return null;

  const filtered = globals.filter(
    (g) =>
      !search ||
      g.name.toLowerCase().includes(search.toLowerCase()) ||
      (g.description ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass rounded-2xl p-6 max-w-2xl w-full border border-zinc-800 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-amber-400" />
            <h3 className="text-xl font-semibold text-zinc-100">Insert Global Element</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {globals.length > 4 && (
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search globals…"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 pl-9 pr-3 py-2 focus:outline-none focus:border-amber-500/40 placeholder:text-zinc-600"
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-center py-10">
              <Globe className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
              <p className="text-zinc-400 text-sm">
                {search ? 'No globals match your search' : 'No global elements yet'}
              </p>
              {!search && (
                <p className="text-zinc-600 text-xs mt-1">
                  Select elements in the designer, then click Save as Global
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filtered.map((g) => (
                <div
                  key={g.id}
                  className="flex items-start gap-3 p-4 rounded-xl bg-zinc-800/50 border border-zinc-700 hover:border-amber-600/50 transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-zinc-100 text-sm mb-0.5">{g.name}</div>
                    {g.description && (
                      <div className="text-xs text-zinc-500 mb-2">{g.description}</div>
                    )}
                    <div className="text-xs text-zinc-600">
                      {g.elements.length} element{g.elements.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => { onInsert(g.elements); onClose(); }}
                      className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 transition-colors"
                      title="Insert into template"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    {onDelete && (
                      <button
                        onClick={() => onDelete(g.id)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-colors"
                        title="Delete global"
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
    </div>
  );
}
