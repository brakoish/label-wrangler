'use client';

import { useState, useMemo } from 'react';
import { useFormatStore } from '@/lib/store';
import { FormatCard } from '@/components/FormatCard';
import { FormatDetail } from '@/components/FormatDetail';
import { AddFormatModal } from '@/components/AddFormatModal';
import { PlusIcon, UploadIcon, DownloadIcon, Sparkles, FileIcon } from './icons';
import { PDFImportModal } from '@/components/PDFImportModal';

export default function Home() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isPDFModalOpen, setIsPDFModalOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'thermal' | 'sheet'>('all');

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
    let result = formats;

    // Filter by tab
    if (activeTab !== 'all') {
      result = result.filter((f) => f.type === activeTab);
    }

    // Filter by search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.name.toLowerCase().includes(query) ||
          f.description?.toLowerCase().includes(query)
      );
    }

    return result;
  }, [formats, searchQuery, activeTab]);

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
    <div className="h-screen flex flex-col bg-[#0c0c0e]">
      {/* Modern Header */}
      <header className="glass sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">
                <span className="gradient-text">Label</span>
                <span className="text-white">Wrangler</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPDFModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white transition-colors rounded-lg hover:bg-white/5"
            >
              <FileIcon className="w-4 h-4" />
              Parse PDF
            </button>
            <button
              onClick={handleImport}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white transition-colors rounded-lg hover:bg-white/5"
            >
              <UploadIcon className="w-4 h-4" />
              Import
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white transition-colors rounded-lg hover:bg-white/5"
            >
              <DownloadIcon className="w-4 h-4" />
              Export
            </button>
            <div className="w-px h-6 bg-zinc-800 mx-1" />
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white text-black text-sm font-semibold rounded-lg hover:bg-zinc-200 transition-colors shadow-lg shadow-white/10"
            >
              <PlusIcon className="w-4 h-4" />
              New Format
            </button>
          </div>
        </div>
      </header>

      {/* Import error toast */}
      {importError && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-red-500/90 backdrop-blur text-white text-sm rounded-lg shadow-xl">
          {importError}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden max-w-[1600px] mx-auto w-full">
        {/* Left sidebar */}
        <div className="w-[400px] flex flex-col border-r border-zinc-800/50">
          {/* Search & filters */}
          <div className="p-4 space-y-4">
            {/* Search */}
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search formats..."
                className="w-full pl-10 pr-4 py-2.5 bg-zinc-900/50 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500/50 focus:bg-zinc-900 transition-all"
              />
            </div>

            {/* Tabs */}
            <div className="flex gap-1 p-1 bg-zinc-900/50 rounded-xl border border-zinc-800/50">
              <button
                onClick={() => setActiveTab('all')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all ${
                  activeTab === 'all'
                    ? 'bg-zinc-800 text-white shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                All ({formats.length})
              </button>
              <button
                onClick={() => setActiveTab('thermal')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all ${
                  activeTab === 'thermal'
                    ? 'bg-orange-500/20 text-orange-400 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Thermal ({thermalCount})
              </button>
              <button
                onClick={() => setActiveTab('sheet')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all ${
                  activeTab === 'sheet'
                    ? 'bg-blue-500/20 text-blue-400 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Sheet ({sheetCount})
              </button>
            </div>
          </div>

          {/* Format list */}
          <div className="flex-1 overflow-auto px-4 pb-4 space-y-2">
            {filteredFormats.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-zinc-900 flex items-center justify-center">
                  <span className="text-3xl">📐</span>
                </div>
                <p className="text-zinc-500 text-sm">
                  {searchQuery || activeTab !== 'all'
                    ? 'No formats match your filters'
                    : 'Your library is empty'}
                </p>
                {!searchQuery && activeTab === 'all' && (
                  <button
                    onClick={() => setIsAddModalOpen(true)}
                    className="mt-3 text-indigo-400 hover:text-indigo-300 text-sm font-medium"
                  >
                    Create your first format
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
        <div className="flex-1 overflow-auto">
          {selectedFormat ? (
            <FormatDetail
              format={selectedFormat}
              onDelete={() => {
                if (confirm(`Delete "${selectedFormat.name}"?`)) {
                  deleteFormat(selectedFormat.id);
                }
              }}
              onEdit={() => {
                alert('Edit coming soon!');
              }}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-sm">
                <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center border border-zinc-800">
                  <svg
                    className="w-10 h-10 text-zinc-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
                    />
                  </svg>
                </div>
                <h3 className="text-zinc-300 font-semibold text-lg">Select a format</h3>
                <p className="text-zinc-500 text-sm mt-2">
                  Choose a label format from the list to view its specifications and preview
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Format Modal */}
      <AddFormatModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} />

      {/* PDF Import Modal */}
      <PDFImportModal isOpen={isPDFModalOpen} onClose={() => setIsPDFModalOpen(false)} />
    </div>
  );
}