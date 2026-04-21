'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Printer, Clock, Trash2, Copy, Play } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { useRunStore } from '@/lib/runStore';
import { useTemplateStore } from '@/lib/templateStore';
import { useFormatStore } from '@/lib/store';
import { generateZPL } from '@/lib/zplGenerator';
import { previewLabelValues } from '@/lib/runBuilder';
import type { Run, RunPreset, RunStatus, LabelFormat, LabelTemplate } from '@/lib/types';

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
  const { runs, presets, deleteRun, deletePreset } = useRunStore();
  const { templates } = useTemplateStore();
  const { formats } = useFormatStore();

  const templateName = (id: string) => templates.find((t) => t.id === id)?.name ?? 'Deleted template';
  const formatName = (templateId: string) => {
    const t = templates.find((x) => x.id === templateId);
    if (!t) return '';
    return formats.find((f) => f.id === t.formatId)?.name ?? '';
  };

  return (
    <AppShell
      headerAction={
        <Link
          href="/runs/new"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:from-amber-400 hover:to-amber-500 transition-all shadow-lg shadow-amber-500/20"
        >
          <Plus className="w-3.5 h-3.5" /> New Run
        </Link>
      }
    >
      <div className="flex-1 overflow-auto">
        <div className="max-w-[1600px] mx-auto w-full p-8 space-y-8">
          {/* Presets section */}
          <section>
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="text-lg font-semibold text-zinc-100">Saved Presets</h2>
              <span className="text-xs text-zinc-500">Reusable recipes for recurring batches</span>
            </div>
            {presets.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center">
                <p className="text-sm text-zinc-500">No presets yet. Save one from a run to reuse its template and static values.</p>
              </div>
            ) : (
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
            )}
          </section>

          {/* Recent runs */}
          <section>
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="text-lg font-semibold text-zinc-100">Recent Runs</h2>
              <span className="text-xs text-zinc-500">
                {runs.length === 0 ? 'None yet' : `${runs.length} total`}
              </span>
            </div>
            {runs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-800 p-12 text-center">
                <Printer className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
                <h3 className="text-zinc-300 font-semibold">Start your first run</h3>
                <p className="text-sm text-zinc-500 mt-1 mb-4">
                  Pick a template, fill in batch info, paste your METRC URLs, and print.
                </p>
                <Link
                  href="/runs/new"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:from-amber-400 hover:to-amber-500 transition-all"
                >
                  <Plus className="w-4 h-4" /> New Run
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {runs.map((r) => {
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
                      onDelete={() => {
                        if (confirm(`Delete run "${r.name}"?`)) void deleteRun(r.id);
                      }}
                    />
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </AppShell>
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
          <p className="text-xs text-zinc-500 mt-0.5 truncate">{templateName} {formatName && <span className="text-zinc-600">\u00b7 {formatName}</span>}</p>
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
        {preset.useCount > 0 && <span>Used {preset.useCount}\u00d7</span>}
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
}: {
  run: Run;
  template: LabelTemplate | null;
  format: LabelFormat | null;
  templateName: string;
  formatName: string;
  onDelete: () => void;
}) {
  const pct = run.totalLabels > 0 ? Math.round((run.printedCount / run.totalLabels) * 100) : 0;
  const resumable = run.status === 'paused' || run.status === 'draft' || (run.status === 'error' as RunStatus);
  // Mapped columns \u2014 useful at a glance to tell "Metrc QR run" from "batch dates".
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
      {/* Thumbnail \u2014 first label, lazy WASM render. */}
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
              \u2192 {mappedCols.slice(0, 2).join(', ')}{mappedCols.length > 2 && `, +${mappedCols.length - 2}`}
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
      {/* Suppress unused Copy import warning \u2014 Copy is reserved for a v2 duplicate-run action. */}
      <Copy className="w-0 h-0" />
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
