'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { RunPrinter } from '@/components/runs/RunPrinter';

export default function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <AppShell
      headerAction={
        <Link href="/runs" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Runs
        </Link>
      }
    >
      <RunPrinter runId={id} />
    </AppShell>
  );
}
