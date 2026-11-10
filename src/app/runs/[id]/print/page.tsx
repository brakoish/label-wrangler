'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRunStore } from '@/lib/runStore';
import { buildSheetPrintHtml } from '@/lib/sheetPrint';
import { restyleSheetPrintToolbar } from '@/lib/sheetPrintChrome';
import { PageTitle } from '@/components/PageTitle';
import { blankCheckAllowsPrinting, checkRunData, describeBlankSummary, hasBlankChoice, rememberBlankChoice, type RunDataCheck } from '@/lib/runDataCheck';
import { BlankValueCheck } from '@/components/runs/BlankValueCheck';
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
  // Blank values this device hasn't confirmed yet. The choice is stored per
  // device, so this page offers the same "leave blank" confirm as the run page.
  const [blankCheck, setBlankCheck] = useState<RunDataCheck | null>(null);
  const [leaveBlank, setLeaveBlank] = useState(false);
  const [confirmedSignature, setConfirmedSignature] = useState<string | null>(null);

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
      setError('We couldn’t find this run’s design or label size.');
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
    if (check.issues.length && !remembered && confirmedSignature !== check.signature) {
      if (check.canLeaveBlank) { setBlankCheck(check); return; }
      setError(`${describeBlankSummary(check)}. Go back to the run to fix them before printing.`);
      return;
    }
    setBlankCheck(null);

    wroteDocument.current = true;
    void buildSheetPrintHtml(run, template, format, range)
      .then((html) => {
        document.open();
        document.write(restyleSheetPrintToolbar(html, run.id));
        document.close();
      })
      .catch((err) => {
        wroteDocument.current = false;
        setError(friendlyError(err, 'The print page couldn’t be prepared.'));
      });
  }, [confirmedSignature, format, hydrated, range, run, template]);

  const confirmBlanks = () => {
    if (!blankCheck || !blankCheckAllowsPrinting(blankCheck, leaveBlank)) return;
    try { rememberBlankChoice(window.localStorage, id, blankCheck.signature); } catch { /* the choice still applies to this page */ }
    setConfirmedSignature(blankCheck.signature);
  };

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
        <div role="alert" className="max-w-md space-y-3 text-center">
          <h1 className="text-lg font-semibold">Can&apos;t print yet</h1>
          <p className="text-sm text-zinc-400">{error}</p>
          <a href={`/runs/${encodeURIComponent(id)}`} className="btn btn-secondary">Back to the run</a>
        </div>
      </main>
    );
  }

  if (blankCheck) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 grid place-items-center p-6">
        <div className="w-full max-w-md space-y-3">
          <h1 className="text-lg font-semibold">Check blank values before printing</h1>
          <BlankValueCheck check={blankCheck} leaveBlank={leaveBlank} onLeaveBlankChange={setLeaveBlank} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={confirmBlanks} disabled={!blankCheckAllowsPrinting(blankCheck, leaveBlank)} className="btn btn-primary">Continue to print</button>
            <a href={`/runs/${encodeURIComponent(id)}`} className="btn btn-secondary">Back to the run</a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 grid place-items-center p-6">
      <PageTitle title="Print sheet labels" />
      <div role="status" className="grid gap-2 text-center text-sm">
        <Loader2 className="w-5 h-5 animate-spin justify-self-center text-zinc-400" aria-hidden="true" />
        <h1 className="font-medium text-zinc-100">Preparing the print page…</h1>
        <div className="text-zinc-400">{run?.name || 'Loading run'}</div>
      </div>
    </main>
  );
}
