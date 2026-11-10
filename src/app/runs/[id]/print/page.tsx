'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useRunStore } from '@/lib/runStore';
import { buildSheetPrintHtml } from '@/lib/sheetPrint';
import { checkRunData, describeBlankSummary, hasBlankChoice } from '@/lib/runDataCheck';
import { friendlyError } from '@/lib/userMessages';

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

  const { runs, fetchRun } = useRunStore();
  const loadError = useRunStore((s) => s.runLoadErrors[id]);

  const run = runs.find((r) => r.id === id) ?? null;
  const template = run?.designSnapshot?.template ?? null;
  const format = run?.designSnapshot?.format ?? null;
  const hydrated = !!run?.designSnapshot;

  const range = useMemo(() => ({
    from: Math.max(1, parseInt(query.from || '1', 10) || 1),
    to: Math.max(1, parseInt(query.to || String(run?.totalLabels || 1), 10) || run?.totalLabels || 1),
  }), [query.from, query.to, run?.totalLabels]);

  useEffect(() => {
    if (!run || !run.designSnapshot || (run.totalLabels > 0 && run.sourceData.length === 0)) {
      void fetchRun(id);
    }
  }, [fetchRun, id, run]);

  useEffect(() => {
    if (!hydrated || wroteDocument.current) return;
    if (!run || !run.designSnapshot || (run.totalLabels > 0 && run.sourceData.length === 0)) return;

    if (!run || !template || !format) {
      setError('Could not find this run, template, or label format.');
      return;
    }

    if (format.type !== 'sheet') {
      setError('Print / PDF is only for runs on sheet labels. Go back to the run to print on a thermal printer.');
      return;
    }

    // Same whole-run check as the run page: a blank value would print the
    // design's sample. Opening this page directly must not skip it.
    const check = checkRunData(template, run);
    let remembered = false;
    try { remembered = hasBlankChoice(window.localStorage, run.id, check); } catch { remembered = false; }
    if (check.issues.length && !remembered) {
      setError(`${describeBlankSummary(check)}. Go back to the run to fix them before printing.`);
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
        setError(friendlyError(err, 'The print page could not be prepared.'));
      });
  }, [format, hydrated, range, run, template]);

  if (!run && loadError) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 grid place-items-center p-6">
        <div role="alert" className="max-w-md text-center space-y-3">
          <h1 className="text-lg font-semibold">{loadError.status === 404 ? 'We couldn\u2019t find that run' : 'We couldn\u2019t load that run'}</h1>
          <p className="text-sm text-zinc-400">{loadError.status === 404 ? 'It may have been deleted.' : friendlyError(loadError.message)}</p>
          <Link href="/runs" className="btn btn-secondary">Back to runs</Link>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 grid place-items-center p-6">
        <div className="max-w-md rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-400">
            <AlertCircle className="w-4 h-4" />
            Can&apos;t print yet
          </div>
          <p className="mt-2 text-sm text-zinc-300">{error}</p>
          <a href={`/runs/${encodeURIComponent(id)}`} className="btn btn-secondary mt-3">Back to the run</a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 grid place-items-center p-6">
      <div className="grid gap-2 text-center text-sm">
        <Loader2 className="w-5 h-5 animate-spin justify-self-center text-zinc-400" aria-hidden="true" />
        <div className="font-medium text-zinc-100">Preparing the print page…</div>
        <div className="text-zinc-400">{run?.name || 'Loading run'}</div>
      </div>
    </main>
  );
}
