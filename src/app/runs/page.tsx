'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Printer, Clock, Trash2, Copy, Play, Search, LayoutGrid, List, Pin, PinOff, CheckCircle2, Pause, Loader2, TrendingUp } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { PageTitle } from '@/components/PageTitle';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { useRunStore } from '@/lib/runStore';
import { useTemplateStore } from '@/lib/templateStore';
import { useFormatStore } from '@/lib/store';
import { generateZPL } from '@/lib/zplGenerator';
import { previewLabelValues } from '@/lib/runBuilder';
import type { Run, RunPreset, RunStatus, LabelFormat, LabelTemplate } from '@/lib/types';

type ViewMode = 'list' | 'grid';
type StatusFilter = 'all' | 'active' | RunStatus;

const STATUS_STYLES: Record<RunStatus, string> = {
  draft: 'bg-zinc-800/60 text-zinc-400 border-zinc-700/50',
  queued: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  printing: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  paused: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  cancelled: 'bg-red-500/10 text-red-400 border-red-500/20',
};

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

  const templateName = (id: string) => templates.find((t) => t.id === id)?.name ?? 'Deleted template';
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
    const activeStatuses: RunStatus[] = ['draft', 'queued', 'printing', 'paused'];
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
      if (r.status === 'completed' && r.completedAt) {
        try {
          if (new Date(r.completedAt) >= monthStart) completedThisMonth++;
        } catch { /* ignore */ }
      }
      if (r.pinnedAt) pinned.push(r);
      else if (activeStatuses.includes(r.status)) active.push(r);
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
    const opts: Array<{ value: string; label: string }> = [{ value: 'all', label: 'All templates' }];
    for (const r of runs) {
      if (seen.has(r.templateId)) continue;
      seen.add(r.templateId);
      opts.push({ value: r.templateId, label: templateName(r.templateId) });
    }
    return opts;
    // templateName is stable enough (depends only on templates)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, templates]);

  // Apply search + filters to the history section (active/pinned show
  // everything regardless so the user always sees work-in-progress).
  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase();
    return history.filter((r) => {
      if (statusFilter !== 'all' && statusFilter !== 'active' && r.status !== statusFilter) return false;
      if (templateFilter !== 'all' && r.templateId !== templateFilter) return false;
      if (q) {
        const hay = `${r.name} ${templateName(r.templateId)} ${formatName(r.templateId)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, search, statusFilter, templateFilter, templates, formats]);

  const renderRunCollection = (collection: Run[], emptyMsg: string) => {
    if (collection.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-zinc-800/70 p-6 text-center">
          <p className="text-xs text-zinc-500">{emptyMsg}</p>
        </div>
      );
    }
    if (viewMode === 'grid') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {collection.map((r) => {
            const t = templates.find((x) => x.id === r.templateId) ?? null;
            const f = t ? formats.find((x) => x.id === t.formatId) ?? null : null;
            return (
              <RunCard
                key={r.id}
                run={r}
                template={t}
                format={f}
                templateName={templateName(r.templateId)}
                formatName={formatName(r.templateId)}
                onDelete={() => { if (confirm(`Delete run "${r.name}"?`)) void deleteRun(r.id); }}
                onTogglePin={() => void togglePin(r.id)}
              />
            );
          })}
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {collection.map((r) => {
          const t = templates.find((x) => x.id === r.templateId) ?? null;
          const f = t ? formats.find((x) => x.id === t.formatId) ?? null : null;
          return (
            <RunRow
              key={r.id}
              run={r}
              template={t}
              format={f}
              templateName={templateName(r.templateId)}
              formatName={formatName(r.templateId)}
              onDelete={() => { if (confirm(`Delete run "${r.name}"?`)) void deleteRun(r.id); }}
              onTogglePin={() => void togglePin(r.id)}
            />
          );
        })}
      </div>
    );
  };

  return (
    <AppShell>
      <PageTitle title="Runs" />
      <div className="flex-1 overflow-auto">
        <div className="max-w-[1600px] mx-auto w-full p-4 sm:p-8 space-y-6 sm:space-y-8">
          {/* Stats strip — one glance summary at the top. Hidden when empty.
              Stacks to single column on phone, then a 3-wide grid. */}
          {runs.length > 0 && (
            <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <StatCard
                icon={<Loader2 className="w-4 h-4" />}
                label="Active"
                value={String(stats.active)}
                accent={stats.active > 0 ? 'amber' : 'zinc'}
                hint={stats.active > 0 ? 'Runs in progress' : 'Nothing running'}
              />
              <StatCard
                icon={<CheckCircle2 className="w-4 h-4" />}
                label="Completed this month"
                value={String(stats.completedThisMonth)}
                accent="emerald"
              />
              <StatCard
                icon={<TrendingUp className="w-4 h-4" />}
                label="Labels printed"
                value={stats.totalLabelsPrinted.toLocaleString()}
                accent="zinc"
              />
            </section>
          )}

          {/* Toolbar: primary New Run button + search + filters + view toggle */}
          {runs.length > 0 && (
            <section className="flex items-center gap-3 flex-wrap">
              <Link
                href="/runs/new"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:from-amber-400 hover:to-amber-500 transition-all shadow-lg shadow-amber-500/20"
              >
                <Plus className="w-3.5 h-3.5" /> New Run
              </Link>
              <div className="flex-1 min-w-[200px] max-w-md relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search runs by name, template, format…"
                  className="w-full bg-zinc-900/60 border border-zinc-800 rounded-lg text-xs text-zinc-100 pl-8 pr-3 py-2 focus:outline-none focus:border-amber-500/40"
                />
              </div>
              <div className="w-36">
                <CustomSelect
                  value={statusFilter}
                  onChange={(v) => setStatusFilter(v as StatusFilter)}
                  options={[
                    { value: 'all', label: 'All statuses' },
                    { value: 'completed', label: 'Completed' },
                    { value: 'printing', label: 'Printing' },
                    { value: 'paused', label: 'Paused' },
                    { value: 'queued', label: 'Queued' },
                    { value: 'draft', label: 'Draft' },
                    { value: 'cancelled', label: 'Cancelled' },
                  ]}
                />
              </div>
              <div className="w-44">
                <CustomSelect
                  value={templateFilter}
                  onChange={setTemplateFilter}
                  options={templateOptions}
                />
              </div>
              <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-zinc-900 border border-zinc-800">
                <button
                  onClick={() => setViewMode('list')}
                  title="List view"
                  className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-zinc-800 text-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  <List className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  title="Grid view"
                  className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-zinc-800 text-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
              </div>
            </section>
          )}

          {/* Empty state: only show when we have nothing at all. */}
          {runs.length === 0 && (
            <RunsEmptyState
              hasFormats={formats.length > 0}
              hasTemplates={templates.length > 0}
            />
          )}

          {/* Pinned runs — stay visible across filters. */}
          {pinned.length > 0 && (
            <section>
              <div className="flex items-baseline gap-3 mb-3">
                <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                  <Pin className="w-3.5 h-3.5 text-amber-400" /> Pinned
                </h2>
                <span className="text-xs text-zinc-500">{pinned.length}</span>
              </div>
              {renderRunCollection(pinned, 'No pinned runs.')}
            </section>
          )}

          {/* Active runs — stay visible across filters. Only show if there's
              actually something in progress, to avoid a big empty box. */}
          {active.length > 0 && (
            <section>
              <div className="flex items-baseline gap-3 mb-3">
                <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" /> Active
                </h2>
                <span className="text-xs text-zinc-500">{active.length}</span>
              </div>
              {renderRunCollection(active, 'No runs in progress.')}
            </section>
          )}

          {/* Presets section. If the user has only a few we keep them as a
              compact horizontal chip strip (always visible, one click to run).
              Once they have many, fall back to the grid cards so names aren't
              squished. Threshold is arbitrary but feels right. */}
          {presets.length > 0 && presets.length <= 6 && (
            <section>
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-sm font-semibold text-zinc-200">Saved Presets</h2>
                <span className="text-xs text-zinc-500">Click to start a run</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {presets.map((p) => (
                  <PresetChip
                    key={p.id}
                    preset={p}
                    templateName={templateName(p.templateId)}
                    formatName={formatName(p.templateId)}
                    onDelete={() => {
                      if (confirm(`Delete preset "${p.name}"?`)) void deletePreset(p.id);
                    }}
                  />
                ))}
              </div>
            </section>
          )}
          {presets.length > 6 && (
            <section>
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-sm font-semibold text-zinc-200">Saved Presets</h2>
                <span className="text-xs text-zinc-500">Reusable recipes</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {presets.map((p) => (
                  <PresetCard
                    key={p.id}
                    preset={p}
                    templateName={templateName(p.templateId)}
                    formatName={formatName(p.templateId)}
                    onDelete={() => {
                      if (confirm(`Delete preset "${p.name}"?`)) void deletePreset(p.id);
                    }}
                  />
                ))}
              </div>
            </section>
          )}

          {/* History / filterable list */}
          {runs.length > 0 && (
            <section>
              <div className="flex items-baseline gap-3 mb-3">
                <h2 className="text-sm font-semibold text-zinc-200">History</h2>
                <span className="text-xs text-zinc-500">
                  {filteredHistory.length}{filteredHistory.length !== history.length ? ` of ${history.length}` : ''}
                </span>
              </div>
              {renderRunCollection(
                filteredHistory,
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

/** A compact stat tile for the dashboard strip. */
function StatCard({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  accent: 'amber' | 'emerald' | 'zinc';
}) {
  const accentClass = accent === 'amber'
    ? 'text-amber-400 bg-amber-500/10'
    : accent === 'emerald'
      ? 'text-emerald-400 bg-emerald-500/10'
      : 'text-zinc-400 bg-zinc-800/60';
  return (
    <div className="glass rounded-2xl p-5 border border-zinc-800">
      <div className="flex items-center gap-2 text-xs text-zinc-500 mb-2">
        <span className={`w-6 h-6 rounded-md inline-flex items-center justify-center ${accentClass}`}>
          {icon}
        </span>
        {label}
      </div>
      <div className="text-2xl font-bold text-zinc-100 tabular-nums">{value}</div>
      {hint && <p className="text-[11px] text-zinc-500 mt-1">{hint}</p>}
    </div>
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
    <div className="rounded-2xl border border-dashed border-zinc-800 p-10">
      <div className="text-center mb-6">
        <Printer className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
        <h3 className="text-zinc-200 font-semibold text-lg">Nothing printed yet</h3>
        <p className="text-sm text-zinc-500 mt-1">
          Label Wrangler needs a format and a template before it can run a batch.
        </p>
      </div>
      <ol className="space-y-3 max-w-xl mx-auto">
        {steps.map((step, i) => {
          const isCurrent = i === nextIndex;
          return (
            <li key={step.label} className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
              step.done
                ? 'border-emerald-500/20 bg-emerald-500/5'
                : isCurrent
                  ? 'border-amber-500/40 bg-amber-500/5'
                  : 'border-zinc-800/70 bg-zinc-900/30'
            }`}>
              <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                step.done ? 'bg-emerald-500/30 text-emerald-300' : isCurrent ? 'bg-amber-500/30 text-amber-300' : 'bg-zinc-800 text-zinc-500'
              }`}>
                {step.done ? '✓' : i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-zinc-200">{step.label}</div>
                <p className="text-xs text-zinc-500 mt-0.5">{step.detail}</p>
              </div>
              <Link
                href={step.href}
                className={`shrink-0 self-center px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  isCurrent
                    ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:from-amber-400 hover:to-amber-500 shadow-sm shadow-amber-500/20'
                    : step.done
                      ? 'text-emerald-400 hover:text-emerald-300'
                      : 'text-zinc-500 hover:text-zinc-300'
                }`}
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
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800 hover:border-amber-500/30 hover:bg-amber-500/5 transition-all"
        title={`${templateName}${formatName ? ' · ' + formatName : ''}`}
      >
        <Play className="w-3 h-3 text-amber-400" />
        <div className="flex flex-col leading-tight">
          <span className="text-xs font-semibold text-zinc-200 group-hover:text-amber-400 transition-colors">
            {preset.name}
          </span>
          <span className="text-[10px] text-zinc-500 truncate max-w-[200px]">
            {templateName}{formatName && <> · {formatName}</>}
          </span>
        </div>
      </Link>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
        className="ml-1 opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition"
        title="Delete preset"
      >
        <Trash2 className="w-3 h-3" />
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
    <div className="glass rounded-2xl p-5 border border-zinc-800 hover:border-amber-500/30 transition-all group">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-zinc-100 truncate group-hover:text-amber-400 transition-colors">{preset.name}</h3>
          <p className="text-xs text-zinc-500 mt-0.5 truncate">{templateName} {formatName && <span className="text-zinc-600">· {formatName}</span>}</p>
        </div>
        <button
          onClick={onDelete}
          className="p-1 rounded-md text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Delete preset"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-3 text-[10px] text-zinc-500 mt-3">
        {preset.useCount > 0 && <span>Used {preset.useCount}×</span>}
        {preset.lastUsedAt && <span>Last used {formatDate(preset.lastUsedAt)}</span>}
      </div>
      <Link
        href={`/runs/new?presetId=${preset.id}`}
        className="mt-4 flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors"
      >
        <Play className="w-3.5 h-3.5" /> Use preset
      </Link>
    </div>
  );
}

function RunRow({
  run,
  template,
  format,
  templateName,
  formatName,
  onDelete,
  onTogglePin,
}: {
  run: Run;
  template: LabelTemplate | null;
  format: LabelFormat | null;
  templateName: string;
  formatName: string;
  onDelete: () => void;
  onTogglePin?: () => void;
}) {
  const pct = run.totalLabels > 0 ? Math.round((run.printedCount / run.totalLabels) * 100) : 0;
  const resumable = run.status === 'paused' || run.status === 'draft' || (run.status === 'error' as RunStatus);
  const pinned = !!run.pinnedAt;
  // Mapped columns — useful at a glance to tell "Metrc QR run" from "batch dates".
  const mappedCols = useMemo(() => {
    const cols: string[] = [];
    for (const m of Object.values(run.fieldMappings || {})) {
      if (m.mode === 'column' && m.csvColumn && m.csvColumn !== '__paste__') cols.push(m.csvColumn);
    }
    return cols;
  }, [run.fieldMappings]);

  return (
    <Link
      href={`/runs/${run.id}`}
      className="flex items-center gap-4 p-3 rounded-xl bg-zinc-900/40 border border-zinc-800/50 hover:border-amber-500/30 hover:bg-zinc-900/60 transition-all group"
    >
      {/* Thumbnail — first label, lazy WASM render. */}
      <div className="shrink-0 w-20 h-14 rounded-md bg-zinc-950 border border-zinc-800 overflow-hidden flex items-center justify-center">
        {template && format ? (
          <RunThumbnail run={run} template={template} format={format} />
        ) : (
          <Printer className="w-4 h-4 text-zinc-700" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-semibold text-zinc-100 truncate group-hover:text-amber-400 transition-colors">{run.name}</h3>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${STATUS_STYLES[run.status] || STATUS_STYLES.draft}`}>
            {run.status}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
          <span className="truncate">{templateName}</span>
          {formatName && <span className="text-zinc-600 truncate">{formatName}</span>}
          <span className="flex items-center gap-1 whitespace-nowrap">
            <Clock className="w-3 h-3" /> {formatDate(run.createdAt)}
          </span>
          {mappedCols.length > 0 && (
            <span className="hidden md:flex items-center gap-1 text-amber-500/70 truncate" title={mappedCols.join(', ')}>
              → {mappedCols.slice(0, 2).join(', ')}{mappedCols.length > 2 && `, +${mappedCols.length - 2}`}
            </span>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        <div className="text-sm font-semibold text-zinc-200 tabular-nums">
          {run.printedCount} / {run.totalLabels}
        </div>
        <div className="w-24 h-1 rounded-full bg-zinc-800 mt-1 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-500 to-amber-400"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="flex items-center gap-1">
        {resumable && (
          <span
            className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-amber-500/15 text-amber-400 group-hover:bg-amber-500/25 transition-colors"
            title="Continue this run"
          >
            <Play className="w-3 h-3" /> Continue
          </span>
        )}
        {onTogglePin && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onTogglePin();
            }}
            className={`p-1.5 rounded-md transition-colors ${
              pinned
                ? 'text-amber-400 hover:bg-amber-500/20'
                : 'text-zinc-600 hover:text-amber-400 hover:bg-amber-500/10'
            }`}
            title={pinned ? 'Unpin run' : 'Pin run to top'}
          >
            {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
          </button>
        )}
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete();
          }}
          className="p-1.5 rounded-md text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Delete run"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* Suppress unused Copy import warning — Copy is reserved for a v2 duplicate-run action. */}
      <Copy className="w-0 h-0" />
    </Link>
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
  templateName,
  formatName,
  onDelete,
  onTogglePin,
}: {
  run: Run;
  template: LabelTemplate | null;
  format: LabelFormat | null;
  templateName: string;
  formatName: string;
  onDelete: () => void;
  onTogglePin?: () => void;
}) {
  const pct = run.totalLabels > 0 ? Math.round((run.printedCount / run.totalLabels) * 100) : 0;
  const resumable = run.status === 'paused' || run.status === 'draft' || (run.status === 'error' as RunStatus);
  const pinned = !!run.pinnedAt;
  return (
    <Link
      href={`/runs/${run.id}`}
      className="glass rounded-2xl p-4 border border-zinc-800 hover:border-amber-500/30 transition-all group relative flex flex-col"
    >
      {/* Thumbnail band */}
      <div className="w-full h-28 rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden flex items-center justify-center mb-3">
        {template && format ? (
          <RunThumbnail run={run} template={template} format={format} />
        ) : (
          <Printer className="w-5 h-5 text-zinc-700" />
        )}
      </div>
      {/* Pin button floats top-right */}
      {onTogglePin && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTogglePin(); }}
          className={`absolute top-2 right-2 p-1.5 rounded-md transition-colors ${
            pinned
              ? 'text-amber-400 bg-amber-500/10 hover:bg-amber-500/20'
              : 'text-zinc-600 hover:text-amber-400 hover:bg-amber-500/10 bg-zinc-950/40 backdrop-blur'
          }`}
          title={pinned ? 'Unpin run' : 'Pin run to top'}
        >
          {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
        </button>
      )}
      <div className="flex items-center gap-2 mb-1">
        <h3 className="flex-1 min-w-0 text-sm font-semibold text-zinc-100 truncate group-hover:text-amber-400 transition-colors">
          {run.name}
        </h3>
        <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium border ${STATUS_STYLES[run.status] || STATUS_STYLES.draft}`}>
          {run.status}
        </span>
      </div>
      <div className="text-[11px] text-zinc-500 truncate mb-3">
        {templateName}{formatName ? ` · ${formatName}` : ''}
      </div>
      <div className="mt-auto">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-zinc-500">
            <Clock className="w-3 h-3 inline mr-1" />{formatDate(run.createdAt)}
          </span>
          <span className="text-xs font-semibold text-zinc-200 tabular-nums">
            {run.printedCount} / {run.totalLabels}
          </span>
        </div>
        <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-amber-500 to-amber-400" style={{ width: `${pct}%` }} />
        </div>
        {resumable && (
          <div className="mt-3 flex items-center justify-center gap-1 py-1.5 rounded-md text-[10px] font-semibold bg-amber-500/15 text-amber-400 group-hover:bg-amber-500/25 transition-colors">
            <Play className="w-3 h-3" /> Continue
          </div>
        )}
      </div>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
        className="absolute bottom-2 right-2 p-1.5 rounded-md text-zinc-700 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition"
        title="Delete run"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </Link>
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
    // Sheet formats can't render via the ZPL WASM engine. Skip the fetch
    // and let the caller render a sheet-style placeholder instead.
    if (format.type !== 'thermal') {
      setErr(true);
      return;
    }
    (async () => {
      try {
        const values = previewLabelValues(run, 0);
        const zpl = generateZPL(template, format, values);
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

  // Sheet formats: draw a tiny SVG grid thumbnail so the user still sees
  // "this is a sheet with N labels" instead of a generic printer icon.
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

  if (err || !url) return <Printer className="w-4 h-4 text-zinc-700" />;
  return (
    <img
      src={url}
      alt=""
      className="max-w-full max-h-full"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
