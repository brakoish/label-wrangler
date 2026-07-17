'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { useFormatStore } from '@/lib/store';
import { useRunStore } from '@/lib/runStore';
import { buildSheetPrintHtml } from '@/lib/sheetPrint';
import { useTemplateStore } from '@/lib/templateStore';

export default function SheetRunPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id } = use(params);
  const query = use(searchParams);
  const wroteDocument = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const { runs, fetchRun, hydrated: runsHydrated } = useRunStore();
  const { templates, hydrated: templatesHydrated } = useTemplateStore();
  const { formats, hydrated: formatsHydrated } = useFormatStore();

  const run = runs.find((r) => r.id === id) ?? null;
  const template = run ? templates.find((t) => t.id === run.templateId) ?? null : null;
  const format = template ? formats.find((f) => f.id === template.formatId) ?? null : null;
  const hydrated = runsHydrated && templatesHydrated && formatsHydrated;

  const range = useMemo(() => ({
    from: Math.max(1, parseInt(query.from || '1', 10) || 1),
    to: Math.max(1, parseInt(query.to || String(run?.totalLabels || 1), 10) || run?.totalLabels || 1),
  }), [query.from, query.to, run?.totalLabels]);

  useEffect(() => {
    if (!run || (run.totalLabels > 0 && run.sourceData.length === 0)) {
      void fetchRun(id);
    }
  }, [fetchRun, id, run]);

  useEffect(() => {
    if (!hydrated || wroteDocument.current) return;
    if (!run || (run.totalLabels > 0 && run.sourceData.length === 0)) return;

    if (!run || !template || !format) {
      setError('Could not find this run, template, or label format.');
      return;
    }

    if (format.type !== 'sheet') {
      setError('Print / PDF output is only available for sheet label runs.');
      return;
    }

    wroteDocument.current = true;
    void buildSheetPrintHtml(run, template, format, range)
      .then((html) => {
        document.open();
        document.write(html);
        document.close();
      })
      .catch((err) => {
        wroteDocument.current = false;
        setError((err as Error)?.message || 'Could not build sheet print output.');
      });
  }, [format, hydrated, range, run, template]);

  if (error) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 grid place-items-center p-6">
        <div className="max-w-md rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-300">
            <AlertCircle className="w-4 h-4" />
            Print output failed
          </div>
          <p className="mt-2 text-sm text-red-100/80">{error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 grid place-items-center p-6">
      <div className="grid gap-2 text-center text-sm">
        <Loader2 className="w-5 h-5 animate-spin justify-self-center text-amber-500" />
        <div className="font-semibold text-amber-400">Preparing print page...</div>
        <div className="text-zinc-500">{run?.name || 'Loading run'}</div>
      </div>
    </main>
  );
}
