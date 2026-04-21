'use client';

import { use } from 'react';
import { AppShell } from '@/components/AppShell';
import { RunPrinter } from '@/components/runs/RunPrinter';

export default function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // No per-page header action — the main AppShell nav already has a 'Runs' tab
  // that acts as the back link.
  return (
    <AppShell>
      <RunPrinter runId={id} />
    </AppShell>
  );
}
