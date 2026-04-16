'use client';

import { LabelFormat, formatDimensions } from '@/lib/types';

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
      className={`
        w-full text-left p-4 rounded-xl border transition-all duration-200 card-hover
        ${isSelected
          ? 'bg-zinc-800/80 border-indigo-500/50 shadow-lg shadow-indigo-500/10'
          : 'bg-zinc-900/40 border-zinc-800/50 hover:border-zinc-700 hover:bg-zinc-900/60'
        }
      `}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`
          w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0
          ${isThermal
            ? 'bg-gradient-to-br from-orange-500/20 to-orange-600/10'
            : 'bg-gradient-to-br from-blue-500/20 to-blue-600/10'
          }
        `}>
          {isThermal ? (
            <svg className="w-5 h-5 text-orange-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="4" y="6" width="16" height="12" rx="2" />
              <circle cx="12" cy="12" r="3" />
              <path d="M8 6V4M16 6V4" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="4" y="3" width="16" height="18" rx="2" />
              <path d="M4 9h16M4 15h16M12 3v18" />
            </svg>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Name & badge */}
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-zinc-100 truncate text-sm">{format.name}</h3>
          </div>

          {format.description && (
            <p className="text-xs text-zinc-500 mt-0.5 truncate">{format.description}</p>
          )}

          {/* Specs row */}
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs font-medium text-zinc-300">
              {formatDimensions(format.width, format.height)}
            </span>
            <span className="w-1 h-1 rounded-full bg-zinc-700" />
            {isThermal ? (
              <span className="text-xs text-zinc-500">{format.dpi || 203} DPI</span>
            ) : (
              <span className="text-xs text-zinc-500">{format.labelsPerSheet} labels</span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}