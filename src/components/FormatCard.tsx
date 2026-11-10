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
      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
        isSelected
          ? 'border-zinc-700 bg-zinc-800'
          : 'border-transparent hover:bg-zinc-900'
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
            ? `${format.dpi || 203} DPI`
            : `${format.labelsPerSheet} ${format.labelsPerSheet === 1 ? 'label' : 'labels'}`}
        </span>
        {format.description && (
          <span className="mt-0.5 block truncate text-xs text-zinc-500">{format.description}</span>
        )}
      </span>
    </button>
  );
}
