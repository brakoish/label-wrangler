'use client';

import { useState, useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import { loadTemplatePreview } from '@/lib/templatePreviewLoader';
import Link from 'next/link';
import { Plus, Archive, RotateCcw, Copy, Pencil } from 'lucide-react';
import type { LabelFormat, LabelTemplate } from '@/lib/types';
import { useFormatStore } from '@/lib/store';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { generateZPLWithImages } from '@/lib/zplGenerator';
import { renderZplToDataUrl } from '@/lib/zplRenderClient';
import { getBitmapProof } from '@/lib/thermal/client';
import { renderSheetLabelSvg } from '@/lib/sheetPrint';
import { designSampleValues } from '@/lib/sampleValues';
import { Dialog } from '@/components/ui/Dialog';
import { SegmentedIndicator } from '@/components/ui/Segmented';
import { confirmDialog } from '@/components/ui/feedback';
import { useTemplateStore } from '@/lib/templateStore';
import { Menu } from '@/components/ui/Menu';
import { friendlyError, friendlyRenderFailure } from '@/lib/userMessages';

interface TemplateListProps {
  templates: LabelTemplate[];
  onSelectTemplate: (id: string) => void;
  onDeleteTemplate: (id: string) => Promise<void>;
  onRestoreTemplate: (id: string) => Promise<void>;
  onDuplicateTemplate?: (template: LabelTemplate) => void;
  onRenameTemplate?: (template: LabelTemplate) => void;
  onNewTemplate: () => void;
  /** Shown above the list, e.g. when a design link couldn't open. */
  notice?: ReactNode;
  /** When the whole list failed while a design link was opening: one error, one Try again for both. */
  openingName?: string;
  onRetryOpen?: () => void;
}

export function TemplateList({
  templates,
  onSelectTemplate,
  onDeleteTemplate,
  onRestoreTemplate,
  onDuplicateTemplate,
  onRenameTemplate,
  onNewTemplate,
  notice,
  openingName,
  onRetryOpen,
}: TemplateListProps) {
  const { formats } = useFormatStore();
  const listHydrated = useTemplateStore((state) => state.hydrated);
  const listLoading = useTemplateStore((state) => state.loading);
  const listError = useTemplateStore((state) => state.error);
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState('');
  const [error, setError] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const visibleTemplates = templates.filter((t) => Boolean(t.archivedAt) === showArchived
    && (!formatFilter || t.formatId === formatFilter)
    && t.name.toLowerCase().includes(query.trim().toLowerCase()));
  const isFiltered = !!query.trim() || !!formatFilter;
  const changeArchive = async (template: LabelTemplate) => {
    setError('');
    setPendingId(template.id);
    try {
      await (template.archivedAt ? onRestoreTemplate(template.id) : onDeleteTemplate(template.id));
    } catch (error) {
      setError(friendlyError(error, 'That design could not be updated. Try again.'));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="page-container">
      {!(listError && templates.length === 0) && notice}
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-zinc-100">Designs</h1>
        <button type="button" onClick={onNewTemplate} className={`btn ${listError && templates.length === 0 ? 'btn-secondary' : 'btn-primary'}`}>
          <Plus className="size-4" aria-hidden="true" /> New design
        </button>
      </div>
      {templates.length > 0 && <div className="mb-5 flex flex-wrap items-center gap-2">
      <div className="segmented w-full sm:w-auto" role="group" aria-label="Show">
        <SegmentedIndicator index={showArchived ? 1 : 0} count={2} />
        <button type="button" onClick={() => setShowArchived(false)} aria-pressed={!showArchived}>Active ({templates.filter((t) => !t.archivedAt).length})</button>
        <button type="button" onClick={() => setShowArchived(true)} aria-pressed={showArchived}>Archived ({templates.filter((t) => t.archivedAt).length})</button>
      </div>
        <input type="search" aria-label="Search designs" placeholder="Search designs…" value={query} onChange={e => setQuery(e.target.value)} className="field min-w-0 flex-1 sm:max-w-xs" />
        <div className="w-full sm:w-64">
          <CustomSelect
            aria-label="Filter by label size"
            value={formatFilter}
            onChange={setFormatFilter}
            options={[{ value: '', label: 'All label sizes' }, ...formats.map(f => ({ value: f.id, label: f.name, sublabel: `${f.width}" × ${f.height}"` }))]}
          />
        </div>
        {isFiltered && <button onClick={() => { setQuery(''); setFormatFilter(''); }} className="btn btn-ghost">Clear filters</button>}
      </div>}
      {error && <p role="alert" className="text-red-400 mb-4">{error}</p>}
      {!listHydrated && templates.length === 0 ? (
        <div role="status" aria-label="Loading designs" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[0, 1, 2].map((i) => <div key={i} className="min-h-[220px] rounded-xl bg-zinc-900 animate-pulse" />)}
          <span className="sr-only">Loading designs…</span>
        </div>
      ) : listError && templates.length === 0 ? (
        <div role="alert" className="py-16 text-center space-y-3">
          <h2 className="text-zinc-100 font-semibold text-lg">{openingName ? `We couldn’t open ${openingName}` : 'We couldn’t load your designs'}</h2>
          <p className="text-zinc-400 text-sm">{friendlyError(listError, 'Something went wrong.')}</p>
          <button type="button" disabled={listLoading} onClick={() => { void useTemplateStore.getState().fetchTemplates(); onRetryOpen?.(); }} className="btn btn-primary">{listLoading ? 'Trying again…' : 'Try again'}</button>
        </div>
      ) : visibleTemplates.length === 0 ? (
        <div className="flex items-center justify-center py-24">
          <div className="text-center max-w-sm">
            <h2 className="text-zinc-100 font-semibold text-lg">{isFiltered ? 'No matching designs' : showArchived ? 'No archived designs' : templates.length ? 'No active designs' : 'No designs yet'}</h2>
            <p className="text-zinc-400 text-sm mt-1">
              {isFiltered ? 'Try another name or label size, or clear the filters.' : showArchived ? 'Archived designs show up here. Saved runs keep working.' : templates.length ? 'Make a new design or restore one from Archived.' : 'Make your first label design to get started.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 stagger">

          {visibleTemplates.map((template) => {
            const format = formats.find((f) => f.id === template.formatId);
            return (
              <TemplateCard
                key={template.id}
                template={template}
                format={format}
                onSelect={() => onSelectTemplate(template.id)}
                onDelete={() => void changeArchive(template)}
                pending={pendingId !== null}
                onDuplicate={onDuplicateTemplate ? () => onDuplicateTemplate(template) : undefined}
                onRename={onRenameTemplate ? () => onRenameTemplate(template) : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function labelViewBox(format: LabelFormat) {
  const dpi = format.dpi || 203;
  return {
    vbW: format.type === 'thermal' ? format.width * dpi : format.width,
    vbH: format.type === 'thermal' ? format.height * dpi : format.height,
  };
}

// Only visible cards fetch full detail; background responses never touch the store.
function CardPreview({ template, format }: { template: LabelTemplate; format?: LabelFormat }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState<LabelTemplate | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !template.summaryOnly) return;
    let active = true;
    setError('');
    loadTemplatePreview(template).then(value => { if (active) setLoaded(value); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load preview'); });
    return () => { active = false; };
  }, [visible, template, attempt]);
  const full = template.summaryOnly ? loaded : template;
  return <div ref={ref} className="w-full h-full flex items-center justify-center">
    {visible && full ? (full.elements.length ? <MiniPreview template={full} format={format} /> : <span className="text-zinc-500 text-xs">Empty template</span>)
      : error ? <div className="text-xs text-zinc-400 text-center"><p role="status">{error}</p><button className="btn btn-secondary btn-sm mt-2" onClick={event => { event.stopPropagation(); setError(''); setAttempt(value => value + 1); }}>Retry preview</button></div>
      : <span role="status" className="text-zinc-500 text-xs">{visible ? 'Loading preview…' : 'Preview loads when visible'}</span>}
  </div>;
}

// Mini label preview: the label drawn by the same code that prints it, with
// the design's sample values (never field keys).
function MiniPreview({ template, format }: { template: LabelTemplate; format?: LabelFormat }) {
  const [thermalUrl, setThermalUrl] = useState<string | null>(null);
  const [sheetSvg, setSheetSvg] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [draftWarning, setDraftWarning] = useState('');
  const [attempt, setAttempt] = useState(0);
  const sampleData = useMemo(() => designSampleValues(template.elements), [template]);

  useEffect(() => {
    let active = true;
    setThermalUrl(null); setSheetSvg(null); setPreviewError(''); setDraftWarning('');
    if (!format) return () => { active = false; };
    if (format.type !== 'thermal') {
      renderSheetLabelSvg(template.elements, format, sampleData)
        .then((svg) => { if (active) setSheetSvg(svg); })
        .catch(() => { if (active) setPreviewError('The preview could not be drawn.'); });
      return () => { active = false; };
    }

    const preview = template.thermalRenderMode === 'bitmap-v1'
      ? getBitmapProof(template, format, sampleData, true).then(result => {
          if (active) setDraftWarning(result.warnings?.[0]?.message || '');
          return result.proof;
        })
      : generateZPLWithImages(template, format, sampleData).then(zpl => renderZplToDataUrl(zpl, format));
    preview
      .then((url) => { if (active) setThermalUrl(url); })
      // A box the renderer refuses is named ("Barcode 1 has no width…").
      .catch((error) => { if (active) setPreviewError(friendlyRenderFailure(error, 'The preview could not be drawn.', template.elements, format.labelsAcross || 1, sampleData, format)); });

    return () => { active = false; };
  }, [format, sampleData, template, attempt]);

  if (!format) return <div className="w-full h-full bg-zinc-900 rounded-lg" />;

  if (format.type === 'thermal' && thermalUrl) {
    return (
      <div className="relative w-full h-full flex items-center justify-center">
        <img
          src={thermalUrl}
          alt={`${template.name} preview`}
          className="max-w-full max-h-full object-contain"
          style={{ imageRendering: 'pixelated' }}
        />
        {draftWarning && <span title={draftWarning} className="absolute bottom-1 left-1 rounded bg-zinc-950 px-1 text-xs text-amber-300">Needs a fix</span>}
      </div>
    );
  }

  if (previewError) return <div className="text-xs text-zinc-400 p-3"><p role="status">{previewError}</p><button className="btn btn-secondary btn-sm mt-2" onClick={event => { event.stopPropagation(); setAttempt(value => value + 1); }}>Try again</button></div>;
  if (format.type !== 'thermal' && sheetSvg) {
    const { vbW, vbH } = labelViewBox(format);
    return (
      <svg viewBox={`0 0 ${vbW} ${vbH}`} className="max-h-full max-w-full" style={{ aspectRatio: `${vbW} / ${vbH}` }} role="img" aria-label={`${template.name} preview`}>
        <rect x={0} y={0} width={vbW} height={vbH} fill="#ffffff" />
        <g dangerouslySetInnerHTML={{ __html: sheetBody(sheetSvg) }} />
      </svg>
    );
  }
  return <p role="status" className="text-xs text-zinc-500 p-3">Loading preview…</p>;
}

function sheetBody(svg: string): string {
  const start = svg.indexOf('>', svg.indexOf('<svg'));
  const end = svg.lastIndexOf('</svg>');
  return start === -1 || end <= start ? svg : svg.slice(start + 1, end);
}

function TemplateCard({
  template,
  format,
  onSelect,
  onDelete,
  pending,
  onDuplicate,
  onRename,
}: {
  template: LabelTemplate;
  format?: LabelFormat;
  onSelect: () => void;
  onDelete: () => void;
  pending: boolean;
  onDuplicate?: () => void;
  onRename?: () => void;
}) {
  const dynamicCount = template.dynamicCount ?? template.elements.filter((e) => !e.isStatic).length;
  const formatName = format?.name || 'Unknown label size';
  const partCount = template.elementCount ?? template.elements.length;

  return (
    <div
      onClick={onSelect}
      className="card cursor-pointer overflow-hidden transition-colors hover:border-zinc-700"
    >
      {/* Preview area */}
      <div className="h-[140px] bg-zinc-950 p-3">
        <CardPreview key={`${template.id}:${template.updatedAt}`} template={template} format={format} />
      </div>

      {/* Info area */}
      <div className="p-3 pl-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 text-sm font-semibold text-zinc-100">
            <button type="button" onClick={(e) => { e.stopPropagation(); onSelect(); }} title={template.name} className="min-h-control-sm max-w-full rounded-sm py-1.5 text-left break-words line-clamp-2">
              {template.name}
            </button>
          </h3>
          {/* One menu instead of three icon buttons on every card. */}
          <div className="-mr-1 flex-shrink-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <Menu
              label={`More for ${template.name}`}
              showLabel={false}
              items={[
                ...(onRename ? [{ label: 'Rename', icon: <Pencil className="size-4" aria-hidden="true" />, onSelect: onRename }] : []),
                ...(onDuplicate ? [{ label: 'Duplicate', icon: <Copy className="size-4" aria-hidden="true" />, onSelect: onDuplicate }] : []),
                template.archivedAt
                  ? { label: 'Restore', icon: <RotateCcw className="size-4" aria-hidden="true" />, onSelect: onDelete, disabled: pending }
                  : { label: 'Archive', icon: <Archive className="size-4" aria-hidden="true" />, disabled: pending, onSelect: () => { void confirmDialog({ title: `Archive “${template.name}”?`, body: 'It leaves the active list. Runs that used it keep working, and you can restore it from Archived.', confirmLabel: 'Archive' }).then((ok) => { if (ok) onDelete(); }); } },
              ]}
            />
          </div>
        </div>

        <p className="truncate text-xs text-zinc-400">
          {format && !formatName.includes(`${format.width}"`) ? `${formatName} · ${format.width}" × ${format.height}"` : formatName}
        </p>
        <p className="mt-0.5 truncate text-xs text-zinc-500">
          {partCount} {partCount === 1 ? 'item' : 'items'}
          {dynamicCount > 0 && <> · {dynamicCount === partCount ? (dynamicCount === 1 ? 'changes per label' : 'all change per label') : `${dynamicCount} of them change per label`}</>}
          {' · '}{new Date(template.updatedAt).toLocaleDateString()}
        </p>
      </div>
    </div>
  );
}

interface RenameTemplateDialogProps {
  isOpen: boolean;
  source: LabelTemplate | null;
  onClose: () => void;
  onSave: (name: string, description: string) => void;
}

export function RenameTemplateDialog({ isOpen, source, onClose, onSave }: RenameTemplateDialogProps) {
  const [name, setName] = useState('');
  const fieldId = useId();
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (isOpen && source) {
      setName(source.name);
      setDescription(source.description ?? '');
    }
  }, [isOpen, source]);

  if (!isOpen || !source) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(name.trim(), description.trim());
  };

  return (
    <Dialog open onClose={onClose} title="Rename design">
      <div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor={`${fieldId}-name`} className="field-label mb-1.5">Design name</label>
            <input
              id={`${fieldId}-name`}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Product Label"
              className="field w-full"
              data-autofocus
            />
          </div>

          <div>
            <label htmlFor={`${fieldId}-description`} className="field-label mb-1.5">Description (optional)</label>
            <textarea
              id={`${fieldId}-description`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this design for?"
              rows={3}
              className="field w-full resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary flex-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="btn btn-primary flex-1"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}

interface NewTemplateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string, formatId: string, thermalRenderMode: 'native-v1' | 'bitmap-v1') => void;
}

export function NewTemplateDialog({ isOpen, onClose, onCreate }: NewTemplateDialogProps) {
  const [name, setName] = useState('');
  const fieldId = useId();
  const [description, setDescription] = useState('');
  const [formatId, setFormatId] = useState('');
  const [renderMode, setRenderMode] = useState<'native-v1' | 'bitmap-v1'>('bitmap-v1');
  const { formats } = useFormatStore();

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !formatId) return;
    onCreate(name, description, formatId, formats.find(f => f.id === formatId)?.type === 'thermal' ? renderMode : 'native-v1');
    setName('');
    setDescription('');
    setFormatId('');
  };

  return (
    <Dialog open onClose={onClose} title="New design">
      <div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor={`${fieldId}-name`} className="field-label mb-1.5">Design name</label>
            <input
              id={`${fieldId}-name`}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Product Label"
              className="field w-full"
              data-autofocus
            />
          </div>

          <div>
            <label htmlFor={`${fieldId}-description`} className="field-label mb-1.5">Description (optional)</label>
            <textarea
              id={`${fieldId}-description`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this design for?"
              rows={3}
              className="field w-full resize-none"
            />
          </div>

          <div>
            <label id={`${fieldId}-size`} className="field-label mb-1.5">Label size</label>
            {formats.length === 0 ? (
              <p className="text-sm text-zinc-500 py-2">
                No label sizes yet — <Link href="/formats" className="text-amber-300 underline underline-offset-2">add a label size</Link>{' '}first
              </p>
            ) : (
              <CustomSelect
                value={formatId}
                onChange={setFormatId}
                aria-labelledby={`${fieldId}-size`}
                placeholder="Choose a label size…"
                options={formats.map((format) => ({
                  value: format.id,
                  label: format.name,
                  sublabel: `${format.width}" × ${format.height}" — ${format.type}`,
                }))}
              />
            )}
          </div>

          {formats.find(f => f.id === formatId)?.type === 'thermal' && <div>
            <span id={`${fieldId}-mode`} className="field-label">How it prints</span>
            <div className="mt-1.5">
              <CustomSelect
                aria-labelledby={`${fieldId}-mode`}
                value={renderMode}
                onChange={(v) => setRenderMode(v as 'native-v1' | 'bitmap-v1')}
                options={[
                  { value: 'bitmap-v1', label: 'Exact picture (recommended)', sublabel: 'Any font. Needs internet to print.' },
                  { value: 'native-v1', label: 'Printer font', sublabel: 'The printer’s built-in font, as older designs use' },
                ]}
              />
            </div>
          </div>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary flex-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || !formatId}
              className="btn btn-primary flex-1"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}

interface DuplicateTemplateDialogProps {
  isOpen: boolean;
  source: LabelTemplate | null;
  onClose: () => void;
  onCreate: (name: string, formatId: string, scale: boolean) => void;
}

/**
 * Modal for duplicating a template to a (possibly different) format.
 * Lets the user choose whether to scale elements proportionally or keep them
 * at their exact positions.
 */
export function DuplicateTemplateDialog({ isOpen, source, onClose, onCreate }: DuplicateTemplateDialogProps) {
  const [name, setName] = useState('');
  const fieldId = useId();
  const [formatId, setFormatId] = useState('');
  const [scale, setScale] = useState(true);
  const { formats } = useFormatStore();

  // Reset form when opening for a new source template.
  useEffect(() => {
    if (isOpen && source) {
      setName(`Copy of ${source.name}`);
      setFormatId(source.formatId);
      setScale(true);
    }
  }, [isOpen, source]);

  if (!isOpen || !source) return null;

  const sourceFormat = formats.find((f) => f.id === source.formatId);
  const targetFormat = formats.find((f) => f.id === formatId);
  const isDifferentFormat = formatId !== source.formatId;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !formatId) return;
    onCreate(name, formatId, scale);
  };

  return (
    <Dialog open onClose={onClose} title="Duplicate design">
      <div>
        <p className="text-sm text-zinc-400 mb-4">
          Creating a copy of <span className="text-zinc-300">{source.name}</span>
          {sourceFormat && <span> ({sourceFormat.width}&quot; × {sourceFormat.height}&quot;)</span>}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor={`${fieldId}-name`} className="field-label mb-1.5">Name for the copy</label>
            <input
              id={`${fieldId}-name`}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="field w-full"
              data-autofocus
            />
          </div>

          <div>
            <label id={`${fieldId}-size`} className="field-label mb-1.5">Label size for the copy</label>
            {formats.length === 0 ? (
              <p className="text-sm text-zinc-500 py-2">No label sizes yet.</p>
            ) : (
              <CustomSelect
                value={formatId}
                onChange={setFormatId}
                aria-labelledby={`${fieldId}-size`}
                placeholder="Choose a label size…"
                options={formats.map((format) => ({
                  value: format.id,
                  label: format.name,
                  sublabel: `${format.width}" × ${format.height}" — ${format.type}`,
                }))}
              />
            )}
          </div>

          {isDifferentFormat && targetFormat && (
            <label className="flex items-start gap-3 rounded-lg border border-zinc-800 p-3 cursor-pointer transition-colors hover:border-zinc-700">
              <input
                type="checkbox"
                checked={scale}
                onChange={(e) => setScale(e.target.checked)}
                className="mt-0.5 accent-amber-500"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-zinc-100">Resize everything to fit the new size</div>
                <div className="text-sm text-zinc-400 mt-0.5">
                  Text, positions and QR codes are resized to the new label. Untick to keep everything exactly where it is.
                </div>
              </div>
            </label>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary flex-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || !formatId}
              className="btn btn-primary flex-1"
            >
              Duplicate
            </button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
