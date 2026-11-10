'use client';

import { LabelFormat, formatDimensions } from '@/lib/types';
import { LabelGlyph } from '@/components/LabelGlyph';

interface FormatCardProps {
  format: LabelFormat;
  isSelected?: boolean;
  onClick?: () => void;
}

export function FormatCard({ format, isSelected, onClick }: FormatCardProps) {
  const isThermal = format.type === 'thermal';

  return (
    <button
      onClick={onClick}
      aria-current={isSelected ? 'true' : undefined}
      className={`flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors ${
        isSelected
          ? 'bg-zinc-800 shadow-[inset_2px_0_0_var(--color-amber-500)]'
          : 'hover:bg-zinc-900'
      }`}
    >
      <span className="flex h-9 w-12 shrink-0 items-center justify-center">
        <LabelGlyph format={format} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-zinc-100">{format.name}</span>
        <span className="mt-0.5 block truncate text-xs text-zinc-400">
          {formatDimensions(format.width, format.height)}
          {' · '}
          {isThermal
            ? ((format.labelsAcross || 1) > 1 ? `Roll, ${format.labelsAcross} across` : 'Roll')
            : `Sheet of ${format.labelsPerSheet}`}
        </span>
        {format.description && (
          <span className="mt-0.5 block truncate text-xs text-zinc-500">{format.description}</span>
        )}
      </span>
    </button>
  );
}
