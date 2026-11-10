'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2, Copy, Play, Search, Pin, PinOff, FileSpreadsheet } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Menu } from '@/components/ui/Menu';
import { PageTitle } from '@/components/PageTitle';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { useRunStore } from '@/lib/runStore';
import { useTemplateStore } from '@/lib/templateStore';
import { useFormatStore } from '@/lib/store';
import type { Run, RunPreset, RunStatus } from '@/lib/types';
import { alertDialog, confirmDialog, toast } from '@/components/ui/feedback';
import { friendlyError, runStatusLabel } from '@/lib/userMessages';

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
      return <p className="py-2 text-sm text-zinc-400">{emptyMsg}</p>;
    }
    const scrollProps = collection.length > RUN_SCROLL_THRESHOLD
      ? {
          className: 'min-h-0 overflow-y-auto overscroll-contain pr-2 -mr-2',
          style: { maxHeight: 'min(720px, calc(100vh - 18rem))' },
        }
      : { className: undefined, style: undefined };
    return (
      <div {...scrollProps}>
        <ul className="stagger space-y-2">
          {collection.map((r) => (
            <li key={r.id}>
              <RunRow
                run={r}
                templateName={templateName(r.templateId)}
                formatName={r.designSnapshot?.format?.name ?? formatName(r.templateId)}
                onDelete={() => void requestDeleteRun(r)}
                onTogglePin={() => void togglePin(r.id)}
              />
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <AppShell>
      <PageTitle title="Runs" />
      <div className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto w-full px-4 py-4 sm:px-8 sm:py-6 lg:py-8 space-y-6 sm:space-y-8">
          <section>
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold text-zinc-50">Print runs</h1>
                <p className="mt-1 text-sm text-zinc-400">Start a run, or pick up where you left off.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <QuickAction
                  href="/runs/new"
                  icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                  label="New run"
                  primary
                />
                <QuickAction
                  href="/runs/new?source=manifest"
                  icon={<Search className="h-4 w-4" aria-hidden="true" />}
                  label="From Manifest"
                  secondary
                />
                <QuickAction
                  href="/runs/new?source=csv"
                  icon={<FileSpreadsheet className="h-4 w-4" aria-hidden="true" />}
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
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search runs"
                  placeholder="Search runs"
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
            </section>
          )}

          {!runsHydrated && runs.length === 0 && (
            <div role="status" aria-label="Loading runs" className="space-y-2">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-[72px] rounded-xl bg-zinc-900 animate-pulse" />)}
              <span className="sr-only">Loading runs…</span>
            </div>
          )}
          {runsHydrated && runsError && runs.length === 0 && (
            <div role="alert" className="py-10 text-center space-y-3">
              <h2 className="text-base font-semibold text-zinc-100">We couldn&apos;t load your runs</h2>
              <p className="text-sm text-zinc-400">{friendlyError(runsError, 'Check your connection, then try again.')}</p>
              <button type="button" disabled={runsLoading} onClick={() => {
                void useRunStore.getState().loadAll();
                if (useTemplateStore.getState().error) void useTemplateStore.getState().fetchTemplates();
                if (useFormatStore.getState().error) void useFormatStore.getState().fetchFormats();
              }} className="btn btn-primary">{runsLoading ? 'Trying again…' : 'Try again'}</button>
            </div>
          )}
          {/* Empty state: only once loading has finished and there really are no runs. */}
          {runsHydrated && !runsError && runs.length === 0 && (
            <RunsEmptyState hasTemplates={templates.length > 0} />
          )}

          {/* Pinned runs */}
          {filteredRuns.pinned.length > 0 && (
            <section>
              <div className="flex items-baseline gap-3 mb-3">
                <h2 className="section-title">Pinned</h2>
                <span className="text-sm text-zinc-400 tabular-nums">
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
                <h2 className="section-title">Not finished</h2>
                <span className="text-sm text-zinc-400 tabular-nums">
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
                <h2 className="section-title">Saved presets</h2>
                <span className="text-sm text-zinc-400">Tap one to start a run</span>
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
                <h2 className="section-title">Saved presets</h2>
                <span className="text-sm text-zinc-400">Tap one to start a run</span>
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
                <h2 className="section-title">Finished and cancelled</h2>
                <span className="text-sm text-zinc-400 tabular-nums">
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

/** One sentence, one action: design a label first, or start the first run. */
function RunsEmptyState({ hasTemplates }: { hasTemplates: boolean }) {
  return (
    <div className="py-12 text-center">
      <h2 className="text-lg font-semibold text-zinc-100">Nothing printed yet</h2>
      <p className="mt-1 text-sm text-zinc-400">
        {hasTemplates ? 'Start a run to print your first batch of labels.' : 'Design a label first, then start a run to print it.'}
      </p>
      <Link href={hasTemplates ? '/runs/new' : '/designer'} className="btn btn-primary mt-5">
        <Plus className="h-4 w-4" aria-hidden="true" /> {hasTemplates ? 'New run' : 'Design a label'}
      </Link>
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
        className="flex min-h-control items-center gap-2.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 transition-[background-color,transform] active:scale-[0.98]"
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
        className="ml-1 btn btn-ghost btn-icon btn-sm text-zinc-400 hover:text-red-400"
        title="Delete preset"
        aria-label={`Delete preset ${preset.name}`}
      >
        <Trash2 className="w-4 h-4" aria-hidden="true" />
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
    <div className="bg-zinc-900 rounded-xl p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-zinc-100 truncate">{preset.name}</h3>
          <p className="text-xs text-zinc-400 mt-0.5 truncate">{templateName} {formatName && <span>· {formatName}</span>}</p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="btn btn-ghost btn-icon btn-sm text-zinc-400 hover:text-red-400"
          title="Delete preset"
          aria-label={`Delete preset ${preset.name}`}
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex items-center gap-3 text-xs text-zinc-400 mt-3">
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
  templateName,
  formatName,
  onDelete,
  onTogglePin,
}: {
  run: Run;
  templateName: string;
  formatName: string;
  onDelete: () => void;
  onTogglePin?: () => void;
}) {
  const printed = Math.min(run.printedCount || 0, run.totalLabels);
  const finished = run.totalLabels > 0 && printed >= run.totalLabels;
  const pct = run.totalLabels > 0 ? Math.round((printed / run.totalLabels) * 100) : 0;
  const unfinished = !finished && run.status !== 'cancelled';
  const pinned = !!run.pinnedAt;

  return (
    <div className="flex items-center gap-2 rounded-xl bg-zinc-900 p-3 transition-colors hover:bg-zinc-800 sm:gap-4 sm:px-4">
      <Link href={`/runs/${run.id}`} className="flex min-w-0 flex-1 flex-col gap-2 rounded-lg sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h3 className="truncate text-sm font-semibold text-zinc-100">{run.name}</h3>
            <RunStatusText status={run.status} />
          </div>
          <p className="mt-0.5 truncate text-xs text-zinc-400">
            {templateName}{formatName ? ` · ${formatName}` : ''} · <span className="whitespace-nowrap">{formatDate(run.createdAt)}</span>
          </p>
        </div>
        <div className="w-full shrink-0 sm:w-36 sm:text-right">
          <p className="text-sm tabular-nums text-zinc-400">
            {finished
              ? <span className="font-medium text-emerald-400">All {run.totalLabels.toLocaleString()} printed</span>
              : <><span className="font-medium text-zinc-100">{printed.toLocaleString()}</span> of {run.totalLabels.toLocaleString()} printed</>}
          </p>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-800" aria-hidden="true">
            <div className={`h-full rounded-full ${finished ? 'bg-emerald-400' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
        {unfinished && (
          <span className="btn btn-secondary btn-sm max-sm:self-start sm:w-32">
            <Play className="h-4 w-4 text-amber-400" aria-hidden="true" /> {printed > 0 ? 'Continue' : 'Print'}
          </span>
        )}
      </Link>
      <Menu
        label={`More for ${run.name}`}
        showLabel={false}
        className="max-sm:self-start"
        items={[
          ...(onTogglePin ? [{ label: pinned ? 'Unpin' : 'Pin to top', icon: pinned ? <PinOff className="h-4 w-4 text-zinc-400" aria-hidden="true" /> : <Pin className="h-4 w-4 text-zinc-400" aria-hidden="true" />, onSelect: onTogglePin }] : []),
          { label: 'Re-run with the same data', icon: <Copy className="h-4 w-4 text-zinc-400" aria-hidden="true" />, href: `/runs/new?duplicateFrom=${run.id}` },
          { label: 'Delete run', icon: <Trash2 className="h-4 w-4" aria-hidden="true" />, danger: true, onSelect: onDelete },
        ]}
      />
    </div>
  );
}
