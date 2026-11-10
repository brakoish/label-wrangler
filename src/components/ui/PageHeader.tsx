import type { ReactNode } from 'react';
import { Search } from 'lucide-react';

/**
 * The top of a list page, the same on Runs, Designs, Label sizes and Nabis:
 * the title, one short line under it, and the page's main action lined up
 * with the bottom of the two on wider screens.
 */
export function PageHeader({ title, subtitle, action, className = '' }: { title: string; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-4 md:flex-row md:items-end md:justify-between ${className}`}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-zinc-100">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

/** One search field everywhere: the icon inside, plain words, no "…". */
export function SearchField({ label, value, onChange, className = '' }: { label: string; value: string; onChange: (value: string) => void; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} placeholder={label} className="field w-full pl-9" />
    </div>
  );
}

/** "Active 6": a count beside its word, the way Runs shows "Pinned 1". */
export function CountLabel({ text, count }: { text: string; count: number }) {
  return <>{text}{count > 0 && <span className="tabular-nums text-zinc-400">{count.toLocaleString()}</span>}</>;
}
