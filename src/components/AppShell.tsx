'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

interface AppShellProps {
  children: React.ReactNode;
  /** Optional action button in header right side (e.g. "New Format", "New Template") */
  headerAction?: React.ReactNode;
}

export function AppShell({ children, headerAction }: AppShellProps) {
  const pathname = usePathname();
  // Runs is the new home. Formats moved from '/' to '/formats'. Designer
  // stays at /designer. Nav order reflects day-to-day usage.
  const isRuns = pathname === '/' || pathname === '/runs' || pathname.startsWith('/runs');
  const isDesigner = pathname === '/designer' || pathname.startsWith('/designer');
  const isFormats = pathname === '/formats' || pathname.startsWith('/formats');

  return (
    <div className="h-screen flex flex-col bg-[#0c0c0e]">
      {/* Shared Header */}
      <header className="glass sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/runs">
              <img
                src="/logo.png"
                alt="Label Wrangler"
                className="w-14 h-14 transition-transform duration-300 hover:animate-buck cursor-pointer"
                style={{ filter: 'brightness(0) invert(1)' }}
              />
            </Link>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                <span className="gradient-text">Label</span>
                <span className="text-white">Wrangler</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Nav tabs — Runs is the primary surface. */}
            <nav className="flex items-center gap-1 px-1 py-1 bg-zinc-900/50 rounded-xl border border-zinc-800/50">
              <Link
                href="/runs"
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isRuns
                    ? 'bg-zinc-800 text-white shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Runs
              </Link>
              <Link
                href="/designer"
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isDesigner
                    ? 'bg-zinc-800 text-white shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Designer
              </Link>
              <Link
                href="/formats"
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isFormats
                    ? 'bg-zinc-800 text-white shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Formats
              </Link>
            </nav>

            {/* Page-specific action button */}
            {headerAction}
          </div>
        </div>
      </header>

      {/* Page content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {children}
      </div>

      {/* Footer */}
      <div className="h-8 flex items-center justify-center border-t border-zinc-800/30">
        <p className="text-xs text-zinc-600">Label Wrangler v1.0</p>
      </div>
    </div>
  );
}
