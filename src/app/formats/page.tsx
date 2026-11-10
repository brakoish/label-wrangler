'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { ChevronLeft } from 'lucide-react';
import { CountLabel, PageHeader, SearchField } from '@/components/ui/PageHeader';
import { useFormatStore } from '@/lib/store';
import type { ApiError } from '@/lib/apiClient';
import { FormatCard } from '@/components/FormatCard';
import { FormatDetail } from '@/components/FormatDetail';
import { AddFormatModal } from '@/components/AddFormatModal';
import { AppShell } from '@/components/AppShell';
import { PageTitle } from '@/components/PageTitle';
import { EmptyState, ErrorState, StateActions } from '@/components/EmptyState';
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

  return (
    <AppShell>
      <PageTitle title="Label sizes" />
      <div className="page-container flex-1 flex flex-col min-h-0 pb-0 sm:pb-0 lg:pb-0">
        <PageHeader
          className={`pb-6 ${phoneView === 'detail' && selectedFormat ? 'max-xl:hidden' : ''}`}
          title="Label sizes"
          subtitle="The labels and rolls you print on."
          // With none yet, the one "New label size" button is the empty state's;
          // while the list failed to load, there is only Try again.
          action={!((hydrated || loadError) && formats.length === 0) ? <button type="button" onClick={() => setIsAddModalOpen(true)} className="btn btn-primary">
            <PlusIcon className="w-4 h-4" />
            New label size
          </button> : undefined}
        />
        <div className="flex-1 min-h-0 flex flex-col xl:flex-row xl:gap-8 overflow-auto xl:overflow-hidden">
        {/* List */}
        <div className={`${phoneView === 'detail' && selectedFormat ? 'max-xl:hidden' : 'flex'} xl:flex w-full ${(hydrated || loadError) && formats.length === 0 ? '' : 'xl:w-[360px]'} xl:shrink-0 flex-col min-h-0`}>
          {hasFormats && (
            <div className="pb-3 space-y-3">
              <SearchField label="Search label sizes" value={searchQuery} onChange={setSearchQuery} />
              {thermalCount > 0 && sheetCount > 0 && (
                <div className="segmented" role="group" aria-label="Filter by type">
                  <SegmentedIndicator index={['all', 'thermal', 'sheet'].indexOf(activeTab)} count={3} />
                  <button onClick={() => setActiveTab('all')} aria-pressed={activeTab === 'all'}><CountLabel text="All" count={formats.length} /></button>
                  <button onClick={() => setActiveTab('thermal')} aria-pressed={activeTab === 'thermal'}><CountLabel text="Rolls" count={thermalCount} /></button>
                  <button onClick={() => setActiveTab('sheet')} aria-pressed={activeTab === 'sheet'}><CountLabel text="Sheets" count={sheetCount} /></button>
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
              <ErrorState
                title="We couldn’t load your label sizes"
                body={friendlyError(loadError, 'Something went wrong.')}
                actions={<StateActions retrying={loading} onRetry={() => void useFormatStore.getState().fetchFormats()} />}
              />
            ) : filteredFormats.length === 0 ? (
              hasFormats
                ? <EmptyState
                    title="No label sizes match"
                    body="Try another name, or show all types."
                    actions={<button type="button" onClick={() => { setSearchQuery(''); setActiveTab('all'); }} className="btn btn-secondary">Show all label sizes</button>}
                  />
                : <EmptyState
                    title="No label sizes yet"
                    body="Add the size of label you print on."
                    actions={<button type="button" onClick={() => setIsAddModalOpen(true)} className="btn btn-primary"><PlusIcon className="w-4 h-4" />New label size</button>}
                  />
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
