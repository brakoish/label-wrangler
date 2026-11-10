import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { PageTitle } from '@/components/PageTitle';

export default function NotFound() {
  return (
    <AppShell>
      <PageTitle title="Page not found" />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 text-center sm:px-8 sm:py-24">
          <h1 className="text-2xl font-semibold text-zinc-50">This page doesn&apos;t exist</h1>
          <p className="mt-2 text-sm text-zinc-400">The link may be old, or the page was moved.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link href="/runs" className="btn btn-primary">Go to print runs</Link>
            <Link href="/designer" className="btn btn-secondary">Designs</Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
