'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { ChevronLeft, Search } from 'lucide-react';
import { useFormatStore } from '@/lib/store';
import type { ApiError } from '@/lib/apiClient';
import { FormatCard } from '@/components/FormatCard';
import { FormatDetail } from '@/components/FormatDetail';
import { AddFormatModal } from '@/components/AddFormatModal';
import { AppShell } from '@/components/AppShell';
import { PageTitle } from '@/components/PageTitle';
import { EmptyState } from '@/components/EmptyState';
import { useRubberBand } from '@/components/motion/rubberBand';
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

  // Below the wide layout the list and the detail are separate views.
  const [phoneView, setPhoneView] = useState<'list' | 'detail'>('list');
  // The list's entrance plays once: coming back from a size's detail on a phone shouldn't replay it.
  const [listShown, setListShown] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  useRubberBand(listRef);
  const openFormat = (id: string) => { selectFormat(id); setPhoneView('detail'); setListShown(true); };

  // On a wide screen, show the first size instead of an empty "pick one" pane.
  useEffect(() => {
    if (selectedFormat || !filteredFormats.length) return;
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches) selectFormat(filteredFormats[0].id);
  }, [selectedFormat, filteredFormats, selectFormat]);

  const hasFormats = formats.length > 0;
  const tabLabel = (text: string, n: number) => (n > 0 ? `${text} (${n})` : text);

  return (
    <AppShell>
      <PageTitle title="Label sizes" />
      <div className="page-container flex-1 flex flex-col min-h-0 pb-0 sm:pb-0 lg:pb-0">
        <div className={`flex items-center justify-between gap-3 pb-4 ${phoneView === 'detail' && selectedFormat ? 'max-xl:hidden' : ''}`}>
          <h1 className="text-2xl font-semibold text-zinc-100">Label sizes</h1>
          <button type="button" onClick={() => setIsAddModalOpen(true)} className="btn btn-primary">
            <PlusIcon className="w-4 h-4" />
            New label size
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col xl:flex-row xl:gap-8 overflow-auto xl:overflow-hidden">
        {/* List */}
        <div className={`${phoneView === 'detail' && selectedFormat ? 'max-xl:hidden' : 'flex'} xl:flex w-full ${hydrated && formats.length === 0 ? '' : 'xl:w-[360px]'} xl:shrink-0 flex-col min-h-0`}>
          {hasFormats && (
            <div className="pb-3 space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" aria-hidden="true" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search label sizes"
                  placeholder="Search label sizes…"
                  className="field w-full pl-10 pr-4"
                />
              </div>
              {thermalCount > 0 && sheetCount > 0 && (
                <div className="segmented" role="group" aria-label="Filter by type">
                  <SegmentedIndicator index={['all', 'thermal', 'sheet'].indexOf(activeTab)} count={3} />
                  <button onClick={() => setActiveTab('all')} aria-pressed={activeTab === 'all'}>{tabLabel('All', formats.length)}</button>
                  <button onClick={() => setActiveTab('thermal')} aria-pressed={activeTab === 'thermal'}>{tabLabel('Rolls', thermalCount)}</button>
                  <button onClick={() => setActiveTab('sheet')} aria-pressed={activeTab === 'sheet'}>{tabLabel('Sheets', sheetCount)}</button>
                </div>
              )}
            </div>
          )}

          <div ref={listRef} className={`flex-1 xl:overflow-auto pb-6 space-y-1 ${listShown ? '' : 'stagger'}`}>
            {!hydrated && formats.length === 0 ? (
              <div role="status" aria-label="Loading label sizes" className="space-y-2">
                {[0, 1, 2, 3].map((i) => <div key={i} className="h-14 rounded-lg bg-zinc-900 animate-pulse" />)}
                <span className="sr-only">Loading label sizes…</span>
              </div>
            ) : loadError && formats.length === 0 ? (
              <EmptyState
                tone="error"
                title="We couldn’t load your label sizes"
                body={friendlyError(loadError, 'Something went wrong.')}
                actions={<button type="button" disabled={loading} onClick={() => void useFormatStore.getState().fetchFormats()} className="btn btn-secondary">{loading ? 'Trying again…' : 'Try again'}</button>}
              />
            ) : filteredFormats.length === 0 ? (
              hasFormats
                ? <div className="py-12"><h2 className="text-sm font-medium text-zinc-100">No label sizes match</h2><p className="mt-1 text-sm text-zinc-400">Try another name, or show all types.</p></div>
                : <EmptyState title="No label sizes yet" body="Add the size of label you print on." />
            ) : (
              filteredFormats.map((format) => (
                <FormatCard
                  key={format.id}
                  format={format}
                  isSelected={selectedFormatId === format.id}
                  onClick={() => openFormat(format.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Detail */}
        <div className={`${phoneView === 'detail' && selectedFormat ? 'block' : 'max-xl:hidden'} flex-1 min-w-0 xl:overflow-auto`}>
          {selectedFormat ? (
            <>
              <button type="button" onClick={() => setPhoneView('list')} className="xl:hidden btn btn-ghost btn-sm -ml-3">
                <ChevronLeft className="size-4" aria-hidden="true" /> All label sizes
              </button>
              <FormatDetail
                format={selectedFormat}
                onDelete={async () => {
                  const ok = await confirmDialog({ title: `Delete “${selectedFormat.name}”?`, body: 'This can’t be undone. A label size that a design or run still uses can’t be deleted.', confirmLabel: 'Delete', danger: true });
                  if (!ok) return;
                  setPhoneView('list');
                  void deleteFormat(selectedFormat.id).catch(error=>{ if ((error as ApiError).status === 409) void alertDialog('This label size is still in use', friendlyError(error)); else useFormatStore.setState({error:friendlyError(error)}); });
                }}
                onUpdate={updateFormat}
              />
            </>
          ) : null}
        </div>
        </div>
      </div>

      {/* Add Format Modal */}
      <AddFormatModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} />
    </AppShell>
  );
}
