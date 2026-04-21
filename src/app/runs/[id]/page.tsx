'use client';

import { use } from 'react';
import { AppShell } from '@/components/AppShell';
import { PageTitle } from '@/components/PageTitle';
import { RunPrinter } from '@/components/runs/RunPrinter';
import { useRunStore } from '@/lib/runStore';

export default function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const run = useRunStore((s) => s.runs.find((r) => r.id === id));
  // No per-page header action — the main AppShell nav already has a 'Runs' tab
  // that acts as the back link.
  return (
    <AppShell>
      <PageTitle title={run ? `Run · ${run.name}` : 'Run'} />
      <RunPrinter runId={id} />
    </AppShell>
  );
}
