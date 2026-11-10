'use client';

import { useState, useMemo } from 'react';
import { useFormatStore } from '@/lib/store';
import type { ApiError } from '@/lib/apiClient';
import { FormatCard } from '@/components/FormatCard';
import { FormatDetail } from '@/components/FormatDetail';
import { AddFormatModal } from '@/components/AddFormatModal';
import { AppShell } from '@/components/AppShell';
import { PageTitle } from '@/components/PageTitle';
import { PlusIcon } from '../icons';
import { alertDialog, confirmDialog } from '@/components/ui/feedback';
import { friendlyError } from '@/lib/userMessages';
import { SegmentedIndicator } from '@/components/ui/Segmented';

export default function Home() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'thermal' | 'sheet'>('all');

  const formats = useFormatStore((s) => s.formats);
  const selectedFormatId = useFormatStore((s) => s.selectedFormatId);
  const selectFormat = useFormatStore((s) => s.selectFormat);
  const deleteFormat = useFormatStore((s) => s.deleteFormat);
  const updateFormat = useFormatStore((s) => s.updateFormat);
  const hydrated = useFormatStore((s) => s.hydrated);
  const loading = useFormatStore((s) => s.loading);
  const loadError = useFormatStore((s) => s.error);

  const selectedFormat = useMemo(() => {
    return formats.find((f) => f.id === selectedFormatId);
  }, [formats, selectedFormatId]);

  const filteredFormats = useMemo(() => {
    let result = formats;

    if (activeTab !== 'all') {
      result = result.filter((f) => f.type === activeTab);
    }

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

  return (
    <AppShell>
      <PageTitle title="Label sizes" />
      {/* Main content */}
      <div className="flex-1 flex flex-col xl:flex-row overflow-auto xl:overflow-hidden max-w-[1600px] mx-auto w-full">
        {/* Left sidebar */}
        <div className="w-full xl:w-[400px] xl:shrink-0 flex flex-col border-b xl:border-b-0 xl:border-r border-zinc-800 max-h-[48vh] xl:max-h-none">
          {/* Search & filters */}
          <div className="p-4 space-y-4">
            {/* New Format button */}
            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className="btn btn-primary w-full"
            >
              <PlusIcon className="w-4 h-4" />
              New label size
            </button>

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
                aria-label="Search label sizes"
                placeholder="Search label sizes…"
                className="field w-full pl-10 pr-4"
              />
            </div>

            {/* Tabs */}
            <div className="segmented" role="group" aria-label="Filter by type">
              <SegmentedIndicator index={['all', 'thermal', 'sheet'].indexOf(activeTab)} count={3} />
              <button
                onClick={() => setActiveTab('all')}
                aria-pressed={activeTab === 'all'}
              >
                All ({formats.length})
              </button>
              <button
                onClick={() => setActiveTab('thermal')}
                aria-pressed={activeTab === 'thermal'}
              >
                Thermal ({thermalCount})
              </button>
              <button
                onClick={() => setActiveTab('sheet')}
                aria-pressed={activeTab === 'sheet'}
              >
                Sheet ({sheetCount})
              </button>
            </div>
          </div>

          {/* Format list */}
          <div className="flex-1 overflow-auto px-4 pb-4 space-y-1 stagger">
            {!hydrated && formats.length === 0 ? (
              <div role="status" aria-label="Loading label sizes" className="space-y-2">
                {[0, 1, 2, 3].map((i) => <div key={i} className="h-14 rounded-lg bg-zinc-900 animate-pulse" />)}
                <span className="sr-only">Loading label sizes…</span>
              </div>
            ) : loadError && formats.length === 0 ? (
              <div role="alert" className="text-center py-12 space-y-3">
                <p className="text-zinc-200 text-sm font-medium">We couldn&apos;t load your label sizes</p>
                <p className="text-zinc-500 text-xs">{friendlyError(loadError, 'Something went wrong.')}</p>
                <button type="button" disabled={loading} onClick={() => void useFormatStore.getState().fetchFormats()} className="btn btn-primary">{loading ? 'Trying again…' : 'Try again'}</button>
              </div>
            ) : filteredFormats.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-zinc-200 text-sm font-medium">
                  {searchQuery || activeTab !== 'all'
                    ? 'No label sizes match'
                    : 'No label sizes yet'}
                </p>
                <p className="text-zinc-400 text-sm mt-1">
                  {searchQuery || activeTab !== 'all'
                    ? 'Try adjusting your search or filter'
                    : 'Add the size of the labels you print on to get started'}
                </p>
                {!searchQuery && activeTab === 'all' && (
                  <button
                    onClick={() => setIsAddModalOpen(true)}
                    className="btn btn-secondary mt-4"
                  >
                    Add your first label size
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
        <div className="flex-1 min-w-0 overflow-auto">
          {selectedFormat ? (
            <FormatDetail
              format={selectedFormat}
              onDelete={async () => {
                const ok = await confirmDialog({ title: `Delete “${selectedFormat.name}”?`, body: 'This can’t be undone. A label size that a design or run still uses can’t be deleted.', confirmLabel: 'Delete', danger: true });
                if (!ok) return;
                void deleteFormat(selectedFormat.id).catch(error=>{ if ((error as ApiError).status === 409) void alertDialog('This label size is still in use', friendlyError(error)); else useFormatStore.setState({error:friendlyError(error)}); });
              }}
              onUpdate={updateFormat}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-sm">
                <h3 className="text-zinc-200 font-semibold text-lg">Pick a label size</h3>
                <p className="text-zinc-400 text-sm mt-1">
                  Choose one from the list to see its measurements and a preview.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Format Modal */}
      <AddFormatModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} />
    </AppShell>
  );
}
