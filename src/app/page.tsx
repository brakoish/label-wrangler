'use client';

import { useState, useMemo } from 'react';
import { useFormatStore } from '@/lib/store';
import { FormatCard } from '@/components/FormatCard';
import { FormatDetail } from '@/components/FormatDetail';
import { AddFormatModal } from '@/components/AddFormatModal';
import { PlusIcon, SearchIcon, UploadIcon, DownloadIcon } from '@/components/icons';

export default function Home() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const formats = useFormatStore((s) => s.formats);
  const selectedFormatId = useFormatStore((s) => s.selectedFormatId);
  const selectFormat = useFormatStore((s) => s.selectFormat);
  const deleteFormat = useFormatStore((s) => s.deleteFormat);
  const exportFormats = useFormatStore((s) => s.exportFormats);
  const importFormats = useFormatStore((s) => s.importFormats);

  const selectedFormat = useMemo(() => {
    return formats.find((f) => f.id === selectedFormatId);
  }, [formats, selectedFormatId]);

  const filteredFormats = useMemo(() => {
    if (!searchQuery.trim()) return formats;
    const query = searchQuery.toLowerCase();
    return formats.filter(
      (f) =>
        f.name.toLowerCase().includes(query) ||
        f.description?.toLowerCase().includes(query)
    );
  }, [formats, searchQuery]);

  const thermalCount = formats.filter((f) => f.type === 'thermal').length;
  const sheetCount = formats.filter((f) => f.type === 'sheet').length;

  const handleExport = () => {
    const data = exportFormats();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `label-wrangler-formats-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        const result = importFormats(content);
        if (!result.success) {
          setImportError(result.error || 'Import failed');
          setTimeout(() => setImportError(null), 3000);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <div className="h-screen flex flex-col bg-zinc-950">
      {/* Header */}
      <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-6 bg-zinc-900/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">LW</span>
          </div>
          <h1 className="text-lg font-semibold text-zinc-100">Label Wrangler</h1>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={handleImport}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <UploadIcon className="w-4 h-4" />
            Import
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <DownloadIcon className="w-4 h-4" />
            Export
          </button>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <PlusIcon className="w-4 h-4" />
            Add Format
          </button>
        </div>
      </header>

      {/* Import error toast */}
      {importError && (
        <div className="px-6 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-sm">
          {importError}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar - Format list */}
        <div className="w-96 flex flex-col border-r border-zinc-800 bg-zinc-900/30">
          {/* Stats */}
          <div className="px-4 py-3 border-b border-zinc-800">
            <div className="flex gap-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-orange-400" />
                <span className="text-zinc-400">{thermalCount} thermal</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                <span className="text-zinc-400">{sheetCount} sheet</span>
              </div>
            </div>
          </div>

          {/* Search */}
          <div className="px-4 py-3 border-b border-zinc-800">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search formats..."
                className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
          </div>

          {/* Format list */}
          <div className="flex-1 overflow-auto p-4 space-y-2">
            {filteredFormats.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-zinc-500 text-sm">
                  {searchQuery ? 'No formats match your search' : 'No formats yet'}
                </p>
                {!searchQuery && (
                  <button
                    onClick={() => setIsAddModalOpen(true)}
                    className="mt-2 text-indigo-400 hover:text-indigo-300 text-sm"
                  >
                    Add your first format
                  </button>
                )}
              </div>
            ) : (
              filteredFormats.map((format) => (
                <FormatCard
                  key={format.id}
                  format={format}
                  isSelected={selectedFormatId === format.id}
                  onClick={() => selectFormat(format.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right panel - Format detail */}
        <div className="flex-1 bg-zinc-950">
          {selectedFormat ? (
            <FormatDetail
              format={selectedFormat}
              onDelete={() => {
                if (confirm(`Delete "${selectedFormat.name}"?`)) {
                  deleteFormat(selectedFormat.id);
                }
              }}
              onEdit={() => {
                // TODO: Edit modal
                alert('Edit coming soon!');
              }}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-zinc-900 flex items-center justify-center">
                  <span className="text-2xl">📐</span>
                </div>
                <h3 className="text-zinc-300 font-medium">Select a format</h3>
                <p className="text-zinc-500 text-sm mt-1">
                  Choose a label format from the list to view details
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Format Modal */}
      <AddFormatModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} />
    </div>
  );
}