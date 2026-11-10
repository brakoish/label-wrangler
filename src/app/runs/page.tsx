'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Printer, Trash2, Copy, Play, Search, LayoutGrid, List, Pin, PinOff, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { SegmentedIndicator } from '@/components/ui/Segmented';
import { AppShell } from '@/components/AppShell';
import { LabelGlyph } from '@/components/LabelGlyph';
import { PageTitle } from '@/components/PageTitle';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { useRunStore } from '@/lib/runStore';
import { useTemplateStore } from '@/lib/templateStore';
import { useFormatStore } from '@/lib/store';
import { generateZPLWithImages } from '@/lib/zplGenerator';
import { previewLabelValues } from '@/lib/runBuilder';
import { renderSheetLabelSvg } from '@/lib/sheetPrint';
import type { Run, RunPreset, RunStatus, LabelFormat, LabelTemplate } from '@/lib/types';
import { alertDialog, confirmDialog, toast } from '@/components/ui/feedback';
import { friendlyError, runStatusLabel } from '@/lib/userMessages';

type ViewMode = 'list' | 'grid';
type StatusFilter = 'all' | 'active' | RunStatus;

const RUN_SCROLL_THRESHOLD = 15;
const ACTIVE_STATUSES: RunStatus[] = ['draft', 'queued', 'printing', 'paused'];

/** Status is a coloured dot plus plain words — no pills. */
const STATUS_DOT: Record<RunStatus, string> = {
  draft: 'bg-zinc-500',
  queued: 'bg-zinc-400',
  printing: 'bg-amber-400',
  paused: 'bg-transparent ring-2 ring-inset ring-amber-300',
  completed: 'bg-emerald-400',
  cancelled: 'bg-red-400',
};

function RunStatusText({ status }: { status: RunStatus }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-zinc-300">
      <span aria-hidden="true" className={`size-2 rounded-full ${STATUS_DOT[status] || STATUS_DOT.draft}`} />
      {runStatusLabel(status)}
    </span>
  );
}

/** A to-scale outline of the label size, used where a real preview isn't available. */
function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export default function RunsPage() {
  const { runs, presets, deleteRun, deletePreset, togglePin } = useRunStore();
  const { templates } = useTemplateStore();
  const { formats } = useFormatStore();

  // Dashboard filter/view state. All kept in local component state for now
  // — if we want to remember it across sessions later, move to localStorage.
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [templateFilter, setTemplateFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const runsHydrated = useRunStore((state) => state.hydrated);
  const runsLoading = useRunStore((state) => state.loading);
  const runsError = useRunStore((state) => state.error);
  const requestDeleteRun = async (run: Run) => {
    const ok = await confirmDialog({ title: `Delete “${run.name}”?`, body: 'A run with print history is kept for your records and can’t be deleted. A run with no print history is removed for good.', confirmLabel: 'Delete run', danger: true });
    if (!ok) return;
    const refused = await deleteRun(run.id);
    if (refused) void alertDialog('This run is kept for your records', refused);
    else toast('Run deleted');
  };
  const requestDeletePreset = async (preset: RunPreset) => {
    const ok = await confirmDialog({ title: `Delete the preset “${preset.name}”?`, body: 'A preset that runs were made from is kept for your records and can’t be deleted. A preset no run used is removed for good.', confirmLabel: 'Delete preset', danger: true });
    if (!ok) return;
    const refused = await deletePreset(preset.id);
    if (refused) void alertDialog('This preset is kept for your records', refused);
  };
  const templateName = (id: string) => templates.find((t) => t.id === id)?.name ?? 'Deleted design';
  const formatName = (templateId: string) => {
    const t = templates.find((x) => x.id === templateId);
    if (!t) return '';
    return formats.find((f) => f.id === t.formatId)?.name ?? '';
  };
  const formatOf = (templateId: string) => {
    const t = templates.find((x) => x.id === templateId);
    return (t && formats.find((f) => f.id === t.formatId)) || null;
  };

  // Split runs into three buckets: active (printing/paused/queued/draft/error),
  // pinned (anything explicitly pinned by the user), and the rest (history).
  // Pinned wins over active — an active run that's ALSO pinned appears in
  // the pinned section, not duplicated.
  const { active, pinned, history, stats } = useMemo(() => {
    const pinned: Run[] = [];
    const active: Run[] = [];
    const history: Run[] = [];
    // Stats: completed this month, total labels ever printed, active count.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let completedThisMonth = 0;
    let totalLabelsPrinted = 0;
    for (const r of runs) {
      totalLabelsPrinted += r.printedCount || 0;
      if (r.status === 'completed' && (r.printedCount || 0) >= r.totalLabels && r.completedAt) {
        try {
          if (new Date(r.completedAt) >= monthStart) completedThisMonth++;
        } catch { /* ignore */ }
      }
      if (r.pinnedAt) pinned.push(r);
      else if (r.status === 'completed' && (r.printedCount || 0) < r.totalLabels) active.push({...r,status:'paused'});
      else if (ACTIVE_STATUSES.includes(r.status)) active.push(r);
      else history.push(r);
    }
    // Sort pinned by pinnedAt DESC (most recently pinned on top).
    pinned.sort((a, b) => (b.pinnedAt || '').localeCompare(a.pinnedAt || ''));
    // Active sorted by recency.
    active.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    // History already comes in createdAt DESC from the API.
    return {
      active,
      pinned,
      history,
      stats: { active: active.length, completedThisMonth, totalLabelsPrinted },
    };
  }, [runs]);

  // Build unique template list for the filter dropdown.
  const templateOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: Array<{ value: string; label: string }> = [{ value: 'all', label: 'All designs' }];
    for (const r of runs) {
      if (seen.has(r.templateId)) continue;
      seen.add(r.templateId);
      opts.push({ value: r.templateId, label: templateName(r.templateId) });
    }
    return opts;
    // templateName is stable enough (depends only on templates)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, templates]);

  // Apply search + filters to every run bucket. Search has to include active
  // and pinned work too; otherwise the box feels broken when the matching run
  // is above History.
  const filteredRuns = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (r: Run) => {
      if (statusFilter === 'active' && !ACTIVE_STATUSES.includes(r.status)) return false;
      if (statusFilter !== 'all' && statusFilter !== 'active' && r.status !== statusFilter) return false;
      if (templateFilter !== 'all' && r.templateId !== templateFilter) return false;
      if (q) {
        const hay = [
          r.name,
          r.status,
          r.dataSource,
          r.notes ?? '',
          templateName(r.templateId),
          formatName(r.templateId),
          JSON.stringify(r.staticValues ?? {}),
          JSON.stringify(r.sourceData ?? []),
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    };
    return {
      active: active.filter(matches),
      pinned: pinned.filter(matches),
      history: history.filter(matches),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pinned, history, search, statusFilter, templateFilter, templates, formats]);

  const renderRunCollection = (collection: Run[], emptyMsg: string) => {
    if (collection.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-zinc-800 p-6 text-center">
          <p className="text-sm text-zinc-400">{emptyMsg}</p>
        </div>
      );
    }
    const scrollProps = collection.length > RUN_SCROLL_THRESHOLD
      ? {
          className: 'min-h-0 overflow-y-auto overscroll-contain pr-2 -mr-2',
          style: { maxHeight: 'min(720px, calc(100vh - 18rem))' },
        }
      : { className: undefined, style: undefined };
    if (viewMode === 'grid') {
      return (
        <div {...scrollProps}>
          <div className="stagger grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {collection.map((r) => {
              const t = r.designSnapshot?.template ?? null;
              const f = r.designSnapshot?.format ?? null;
              return (
                <RunCard
                  key={r.id}
                  run={r}
                  template={t}
                  format={f}
                  sizeFormat={f ?? formatOf(r.templateId)}
                  templateName={templateName(r.templateId)}
                  formatName={formatName(r.templateId)}
                  onDelete={() => void requestDeleteRun(r)}
                  onTogglePin={() => void togglePin(r.id)}
                />
              );
            })}
          </div>
        </div>
      );
    }
    return (
      <div {...scrollProps}>
        <div className="stagger space-y-2">
          {collection.map((r) => {
            const t = r.designSnapshot?.template ?? null;
            const f = r.designSnapshot?.format ?? null;
            return (
              <RunRow
                key={r.id}
                run={r}
                template={t}
                format={f}
                sizeFormat={f ?? formatOf(r.templateId)}
                templateName={templateName(r.templateId)}
                formatName={formatName(r.templateId)}
                onDelete={() => void requestDeleteRun(r)}
                onTogglePin={() => void togglePin(r.id)}
              />
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <AppShell>
      <PageTitle title="Runs" />
      <div className="flex-1 overflow-auto">
        <div className="max-w-[1600px] mx-auto w-full p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
          <section>
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold text-zinc-50">Print runs</h1>
                <p className="mt-1 text-sm text-zinc-400">Start a new run, or pick up where you left off.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <QuickAction
                  href="/runs/new"
                  icon={<Plus className="h-4 w-4" />}
                  label="New run"
                  primary
                />
                <QuickAction
                  href="/runs/new?source=manifest"
                  icon={<Search className="h-4 w-4" />}
                  label="From Manifest"
                  secondary
                />
                <QuickAction
                  href="/runs/new?source=csv"
                  icon={<FileSpreadsheet className="h-4 w-4" />}
                  label="From a spreadsheet"
                  secondary
                />
              </div>
            </div>
          </section>

          {/* Stats strip — one glance summary at the top. Hidden when empty.
              Stacks to single column on phone, then a 3-wide grid. */}
          {runs.length > 0 && (
            <p className="hidden sm:flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-400">
              <span><span className="font-semibold text-zinc-100 tabular-nums">{stats.active}</span> not finished</span>
              <span><span className="font-semibold text-zinc-100 tabular-nums">{stats.completedThisMonth}</span> completed this month</span>
              <span><span className="font-semibold text-zinc-100 tabular-nums">{stats.totalLabelsPrinted.toLocaleString()}</span> labels printed</span>
            </p>
          )}

          {/* Toolbar: primary New Run button + search + filters + view toggle */}
          {runs.length > 0 && (
            <section className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px] max-w-md relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search runs"
                  placeholder="Search runs by name, design or label size…"
                  className="field pl-9"
                />
              </div>
              <div className="w-[calc(50%-0.25rem)] sm:w-40">
                <CustomSelect
                  value={statusFilter}
                  onChange={(v) => setStatusFilter(v as StatusFilter)}
                  aria-label="Filter by status"
                  options={[
                    { value: 'all', label: 'All statuses' },
                    ...(['completed', 'printing', 'paused', 'queued', 'draft', 'cancelled'] as RunStatus[]).map((status) => ({ value: status, label: runStatusLabel(status) })),
                  ]}
                />
              </div>
              <div className="w-[calc(50%-0.25rem)] sm:w-48">
                <CustomSelect
                  value={templateFilter}
                  onChange={setTemplateFilter}
                  aria-label="Filter by design"
                  options={templateOptions}
                />
              </div>
              <div className="segmented hidden sm:grid">
                <SegmentedIndicator index={viewMode === 'list' ? 0 : 1} count={2} />
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  aria-pressed={viewMode === 'list'}
                  aria-label="Show as a list"
                  title="List view"
                  className="px-2.5"
                >
                  <List className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  aria-pressed={viewMode === 'grid'}
                  aria-label="Show as a grid"
                  title="Grid view"
                  className="px-2.5"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
              </div>
            </section>
          )}

          {!runsHydrated && runs.length === 0 && (
            <div role="status" aria-label="Loading runs" className="space-y-2">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-[72px] rounded-xl bg-zinc-900 animate-pulse" />)}
              <span className="sr-only">Loading runs…</span>
            </div>
          )}
          {runsHydrated && runsError && runs.length === 0 && (
            <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center space-y-3">
              <h2 className="text-base font-semibold text-zinc-100">We couldn&apos;t load your runs</h2>
              <p className="text-sm text-zinc-400">{friendlyError(runsError, 'Something went wrong.')}</p>
              <button type="button" disabled={runsLoading} onClick={() => void useRunStore.getState().loadAll()} className="btn btn-primary">{runsLoading ? 'Trying again…' : 'Try again'}</button>
            </div>
          )}
          {/* Empty state: only once loading has finished and there really are no runs. */}
          {runsHydrated && !runsError && runs.length === 0 && (
            <RunsEmptyState
              hasFormats={formats.length > 0}
              hasTemplates={templates.length > 0}
            />
          )}

          {/* Pinned runs */}
          {filteredRuns.pinned.length > 0 && (
            <section>
              <div className="flex items-baseline gap-3 mb-3">
                <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                  <Pin className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" /> Pinned
                </h2>
                <span className="text-xs text-zinc-500">
                  {filteredRuns.pinned.length}{filteredRuns.pinned.length !== pinned.length ? ` of ${pinned.length}` : ''}
                </span>
              </div>
              {renderRunCollection(filteredRuns.pinned, 'No pinned runs match your filters.')}
            </section>
          )}

          {/* Active runs */}
          {filteredRuns.active.length > 0 && (
            <section>
              <div className="flex items-baseline gap-3 mb-3">
                <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                  Not finished
                </h2>
                <span className="text-xs text-zinc-500">
                  {filteredRuns.active.length}{filteredRuns.active.length !== active.length ? ` of ${active.length}` : ''}
                </span>
              </div>
              {renderRunCollection(filteredRuns.active, 'No unfinished runs match your filters.')}
            </section>
          )}

          {/* Presets section. If the user has only a few we keep them as a
              compact horizontal chip strip (always visible, one click to run).
              Once they have many, fall back to the grid cards so names aren't
              squished. Threshold is arbitrary but feels right. */}
          {presets.length > 0 && presets.length <= 6 && (
            <section>
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-sm font-semibold text-zinc-200">Saved presets</h2>
                <span className="text-xs text-zinc-500">Tap one to start a run</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {presets.map((p) => (
                  <PresetChip
                    key={p.id}
                    preset={p}
                    templateName={templateName(p.templateId)}
                    formatName={formatName(p.templateId)}
                    onDelete={() => void requestDeletePreset(p)}
                  />
                ))}
              </div>
            </section>
          )}
          {presets.length > 6 && (
            <section>
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-sm font-semibold text-zinc-200">Saved presets</h2>
                <span className="text-xs text-zinc-500">Tap one to start a run</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {presets.map((p) => (
                  <PresetCard
                    key={p.id}
                    preset={p}
                    templateName={templateName(p.templateId)}
                    formatName={formatName(p.templateId)}
                    onDelete={() => void requestDeletePreset(p)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* History / filterable list */}
          {runs.length > 0 && (
            <section>
              <div className="flex items-baseline gap-3 mb-3">
                <h2 className="text-sm font-semibold text-zinc-200">Finished and cancelled</h2>
                <span className="text-xs text-zinc-500">
                  {filteredRuns.history.length}{filteredRuns.history.length !== history.length ? ` of ${history.length}` : ''}
                </span>
              </div>
              {renderRunCollection(
                filteredRuns.history,
                history.length === 0
                  ? 'No completed runs yet.'
                  : 'No runs match your filters.',
              )}
            </section>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function QuickAction({
  href,
  icon,
  label,
  primary = false,
  secondary = false,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
  /** Hidden on phones so the run list is visible without scrolling. */
  secondary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`${secondary ? 'hidden sm:inline-flex' : 'max-sm:w-full'} btn ${primary ? 'btn-primary' : 'btn-secondary'}`}
    >
      {icon}
      {label}
    </Link>
  );
}

/**
 * Onboarding-aware empty state for the Runs page. Detects whether the user
 * has formats + templates yet; walks them through whichever step is missing
 * before inviting them to create a run. Keeps them oriented instead of
 * dropping them at a dead-end "you have no runs" screen.
 */
function RunsEmptyState({ hasFormats, hasTemplates }: { hasFormats: boolean; hasTemplates: boolean }) {
  const steps = [
    {
      label: 'Create a label format',
      detail: 'Describe the physical media (thermal roll size, sheet layout, DPI, etc.).',
      href: '/formats',
      done: hasFormats,
    },
    {
      label: 'Design a template',
      detail: 'Add QR codes, text, barcodes that turn into a printed label.',
      href: '/designer',
      done: hasTemplates,
    },
    {
      label: 'Start a run',
      detail: 'Pick your template, drop in a Metrc CSV, and print the batch.',
      href: '/runs/new',
      done: false,
    },
  ];
  const nextIndex = steps.findIndex((s) => !s.done);

  return (
    <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-10 sm:p-10">
      <div className="text-center mb-6">
        <Printer className="w-8 h-8 text-zinc-500 mx-auto mb-3" aria-hidden="true" />
        <h3 className="text-zinc-100 font-semibold text-lg">Nothing printed yet</h3>
        <p className="text-sm text-zinc-400 mt-1">
          Label Wrangler needs a format and a template before it can run a batch.
        </p>
      </div>
      <ol className="space-y-3 max-w-xl mx-auto">
        {steps.map((step, i) => {
          const isCurrent = i === nextIndex;
          return (
            <li key={step.label} className={`flex items-center gap-3 p-3 rounded-xl ${isCurrent ? 'bg-zinc-900 border border-zinc-800' : ''}`}>
              <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                step.done ? 'bg-emerald-500/10 text-emerald-400' : isCurrent ? 'bg-amber-500 text-black' : 'bg-zinc-800 text-zinc-400'
              }`}>
                {step.done ? <CheckCircle2 className="w-3.5 h-3.5" aria-label="Done" /> : i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-zinc-100">{step.label}</div>
                <p className="text-xs text-zinc-400 mt-0.5">{step.detail}</p>
              </div>
              <Link
                href={step.href}
                className={`shrink-0 btn btn-sm ${isCurrent ? 'btn-primary' : 'btn-ghost'}`}
              >
                {step.done ? 'Manage' : isCurrent ? 'Start' : 'Step ' + (i + 1)}
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Compact chip-sized preset — used when the user has a small number of
 *  presets and we can afford to show them all inline as quick-launch pills
 *  without eating vertical space. Click runs. Hover exposes delete. */
function PresetChip({
  preset,
  templateName,
  formatName,
  onDelete,
}: {
  preset: RunPreset;
  templateName: string;
  formatName: string;
  onDelete: () => void;
}) {
  return (
    <div className="group relative flex items-stretch">
      <Link
        href={`/runs/new?presetId=${preset.id}`}
        className="flex min-h-control items-center gap-2.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors active:scale-[0.98] transition-[border-color,transform]"
        title={`${templateName}${formatName ? ' · ' + formatName : ''}`}
      >
        <Play className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-medium text-zinc-100">
            {preset.name}
          </span>
          <span className="text-xs text-zinc-400 truncate max-w-[200px]">
            {templateName}{formatName && <> · {formatName}</>}
          </span>
        </div>
      </Link>
      <button
        type="button"
        onClick={onDelete}
        className="ml-1 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 btn btn-ghost btn-icon btn-sm text-zinc-500 hover:text-red-400"
        title="Delete preset"
        aria-label={`Delete preset ${preset.name}`}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function PresetCard({
  preset,
  templateName,
  formatName,
  onDelete,
}: {
  preset: RunPreset;
  templateName: string;
  formatName: string;
  onDelete: () => void;
}) {
  return (
    <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 hover:border-zinc-700 transition-colors group">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-zinc-100 truncate">{preset.name}</h3>
          <p className="text-xs text-zinc-400 mt-0.5 truncate">{templateName} {formatName && <span>· {formatName}</span>}</p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="btn btn-ghost btn-icon btn-sm text-zinc-500 hover:text-red-400"
          title="Delete preset"
          aria-label={`Delete preset ${preset.name}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-3 text-xs text-zinc-500 mt-3">
        {preset.useCount > 0 && <span>Used {preset.useCount}×</span>}
        {preset.lastUsedAt && <span>Last used {formatDate(preset.lastUsedAt)}</span>}
      </div>
      <Link
        href={`/runs/new?presetId=${preset.id}`}
        className="mt-4 btn btn-secondary btn-sm w-full"
      >
        <Play className="w-3.5 h-3.5" aria-hidden="true" /> Use preset
      </Link>
    </div>
  );
}

function RunRow({
  run,
  template,
  format,
  sizeFormat,
  templateName,
  formatName,
  onDelete,
  onTogglePin,
}: {
  run: Run;
  template: LabelTemplate | null;
  format: LabelFormat | null;
  sizeFormat: LabelFormat | null;
  templateName: string;
  formatName: string;
  onDelete: () => void;
  onTogglePin?: () => void;
}) {
  const router = useRouter();
  const pct = run.totalLabels > 0 ? Math.round((run.printedCount / run.totalLabels) * 100) : 0;
  const resumable = run.status === 'paused' || run.status === 'draft' || (run.status === 'error' as RunStatus);
  const pinned = !!run.pinnedAt;

  const actionClass = 'btn btn-ghost btn-icon btn-sm text-zinc-400';
  return (
    <div className="flex flex-col gap-1 p-3 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors group sm:flex-row sm:items-center sm:gap-4">
      <Link href={`/runs/${run.id}`} className="flex min-w-0 flex-1 flex-col gap-3 rounded-lg sm:flex-row sm:items-center sm:gap-4">
      {/* Thumbnail — first label when the run carries its design, otherwise the label size. */}
      <div className="hidden sm:flex shrink-0 w-20 h-14 rounded-lg bg-zinc-950 overflow-hidden items-center justify-center p-1.5">
        {template && format ? (
          <RunThumbnail run={run} template={template} format={format} />
        ) : (
          <LabelGlyph format={sizeFormat} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-0.5">
          <h3 className="text-sm font-semibold text-zinc-100 truncate">{run.name}</h3>
          <RunStatusText status={run.status} />
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-400 min-w-0 sm:flex-nowrap">
          <span className="sm:truncate">{templateName}</span>
          {formatName && <><span aria-hidden="true">·</span><span className="sm:truncate">{formatName}</span></>}
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap">{formatDate(run.createdAt)}</span>
        </div>
      </div>
      <div className="w-full flex-shrink-0 text-left sm:w-32 sm:text-right">
        <div className="text-sm font-medium text-zinc-200 tabular-nums">
          {run.printedCount.toLocaleString()} <span className="text-zinc-400 font-normal">of {run.totalLabels.toLocaleString()} printed</span>
        </div>
        <div className="h-1 w-full rounded-full bg-zinc-800 mt-1.5 overflow-hidden" aria-hidden="true">
          <div
            className="h-full bg-amber-500 rounded-full origin-left"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      {resumable && (
        <span className="btn btn-secondary btn-sm max-sm:hidden">
          <Play className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" /> Continue
        </span>
      )}
      </Link>
      <div className="flex w-full items-center gap-1 sm:w-auto">
        {resumable && (
          <Link href={`/runs/${run.id}`} tabIndex={-1} aria-hidden="true" className="btn btn-secondary btn-sm mr-auto sm:hidden">
            <Play className="w-3.5 h-3.5 text-amber-400" /> Continue
          </Link>
        )}
        <span className="ml-auto sm:hidden" />
        {onTogglePin && (
          <button
            type="button"
            onClick={onTogglePin}
            className={`${actionClass} ${pinned ? 'text-amber-400' : 'hover:text-amber-400'}`}
            title={pinned ? 'Unpin run' : 'Pin run to top'}
            aria-label={`${pinned ? 'Unpin' : 'Pin'} ${run.name}`}
          >
            {pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
          </button>
        )}
        <button
          type="button"
          onClick={() => router.push(`/runs/new?duplicateFrom=${run.id}`)}
          className={actionClass}
          title="Start a new run like this one"
          aria-label={`Duplicate ${run.name}`}
        >
          <Copy className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className={`${actionClass} hover:text-red-400`}
          title="Delete run"
          aria-label={`Delete ${run.name}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * Grid-view card for a run. Same underlying data as RunRow but laid out
 * vertically with a big thumbnail on top, for when users want to scan
 * their runs visually (many runs, recognizing by label shape).
 */
function RunCard({
  run,
  template,
  format,
  sizeFormat,
  templateName,
  formatName,
  onDelete,
  onTogglePin,
}: {
  run: Run;
  template: LabelTemplate | null;
  format: LabelFormat | null;
  sizeFormat: LabelFormat | null;
  templateName: string;
  formatName: string;
  onDelete: () => void;
  onTogglePin?: () => void;
}) {
  const router = useRouter();
  const pct = run.totalLabels > 0 ? Math.round((run.printedCount / run.totalLabels) * 100) : 0;
  const resumable = run.status === 'paused' || run.status === 'draft' || (run.status === 'error' as RunStatus);
  const pinned = !!run.pinnedAt;
  const iconAction = 'btn btn-ghost btn-icon btn-sm text-zinc-400';
  return (
    <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800 hover:border-zinc-700 transition-colors group relative flex flex-col">
      <Link href={`/runs/${run.id}`} className="flex flex-1 flex-col rounded-lg">
      {/* Thumbnail band */}
      <div className="w-full h-28 rounded-lg bg-zinc-950 flex items-center justify-center mb-3 p-3">
        {template && format ? (
          <RunThumbnail run={run} template={template} format={format} />
        ) : (
          <div className="h-16 w-28"><LabelGlyph format={sizeFormat} /></div>
        )}
      </div>
      <div className="flex items-center gap-3 mb-0.5 px-1">
        <h3 className="flex-1 min-w-0 text-sm font-semibold text-zinc-100 truncate">
          {run.name}
        </h3>
        <RunStatusText status={run.status} />
      </div>
      <div className="text-xs text-zinc-400 truncate mb-3 px-1">
        {templateName}{formatName ? ` · ${formatName}` : ''}
      </div>
      <div className="mt-auto px-1">
        <div className="flex items-center justify-between mb-1.5 text-xs">
          <span className="text-zinc-400">{formatDate(run.createdAt)}</span>
          <span className="font-medium text-zinc-200 tabular-nums">
            {run.printedCount.toLocaleString()} <span className="text-zinc-400 font-normal">of {run.totalLabels.toLocaleString()}</span>
          </span>
        </div>
        <div className="h-1 rounded-full bg-zinc-800 overflow-hidden" aria-hidden="true">
          <div className="h-full bg-amber-500 rounded-full" style={{ width: `${pct}%` }} />
        </div>
      </div>
      </Link>
      <div className="mt-2 flex items-center gap-1">
        {resumable && (
          <Link href={`/runs/${run.id}`} tabIndex={-1} aria-hidden="true" className="btn btn-secondary btn-sm mr-auto">
            <Play className="w-3.5 h-3.5 text-amber-400" /> Continue
          </Link>
        )}
        <span className="ml-auto" />
        {onTogglePin && (
          <button
            type="button"
            onClick={onTogglePin}
            className={`${iconAction} ${pinned ? 'text-amber-400' : 'hover:text-amber-400'}`}
            title={pinned ? 'Unpin run' : 'Pin run to top'}
            aria-label={`${pinned ? 'Unpin' : 'Pin'} ${run.name}`}
          >
            {pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
          </button>
        )}
        <button
          type="button"
          onClick={() => router.push(`/runs/new?duplicateFrom=${run.id}`)}
          className={iconAction}
          title="Start a new run like this one"
          aria-label={`Duplicate ${run.name}`}
        >
          <Copy className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className={`${iconAction} hover:text-red-400`}
          title="Delete run"
          aria-label={`Delete ${run.name}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// Thumbnail of the first label in a run. Renders on-demand via the WASM ZPL
// renderer. Falls back to a tiny icon on error. Module cache in the renderer
// means N thumbnails share one WASM instance.
function RunThumbnail({ run, template, format }: { run: Run; template: LabelTemplate; format: LabelFormat }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const values = previewLabelValues(run, 0);
        if (format.type === 'sheet') {
          const svg = await renderSheetLabelSvg(template.elements, format, values);
          if (!cancelled) setUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
          return;
        }

        const zpl = await generateZPLWithImages(template, format, values);
        const mod = await import('zpl-renderer-js');
        const { api } = await mod.ready;
        const across = Math.max(1, format.labelsAcross || 1);
        const gapIn = format.horizontalGapThermal || 0;
        const sideIn = format.sideMarginThermal || 0;
        const computedLinerIn = sideIn * 2 + across * format.width + (across - 1) * gapIn;
        const linerIn = format.linerWidth || computedLinerIn;
        const widthMm = linerIn * 25.4;
        const heightMm = format.height * 25.4;
        const dpmm = Math.round((format.dpi || 203) / 25.4);
        const b64 = await api.zplToBase64Async(zpl, widthMm, heightMm, dpmm);
        if (!cancelled) setUrl(`data:image/png;base64,${b64}`);
      } catch {
        if (!cancelled) setErr(true);
      }
    })();
    return () => { cancelled = true; };
  }, [run, template, format]);

  if (format.type === 'sheet' && url) {
    return <img src={url} alt="" className="max-w-full max-h-full object-contain" />;
  }

  // Fallback for sheet formats while the real SVG thumbnail is rendering or
  // if the browser cannot prepare a QR/barcode preview.
  if (format.type === 'sheet') {
    const cols = format.columns || 1;
    const rows = format.rows || 1;
    return (
      <svg viewBox={`0 0 ${cols} ${rows}`} className="w-full h-full p-1" preserveAspectRatio="xMidYMid meet">
        <rect x={0} y={0} width={cols} height={rows} fill="#f9fafb" />
        {Array.from({ length: rows }).map((_, r) =>
          Array.from({ length: cols }).map((_, c) => (
            <rect key={`${r}-${c}`} x={c + 0.1} y={r + 0.1} width={0.8} height={0.8} fill="#d97706" opacity={0.85} />
          )),
        )}
      </svg>
    );
  }

  if (err || !url) return <LabelGlyph format={format} />;
  return (
    <img
      src={url}
      alt=""
      className="max-w-full max-h-full object-contain"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
