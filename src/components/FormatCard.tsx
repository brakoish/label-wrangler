'use client';

import { LabelFormat, formatDimensions } from '@/lib/types';
import { ThermalIcon, SheetIcon } from './icons';

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
        w-full text-left rounded-lg border p-4 transition-all
        ${isSelected
          ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500'
          : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900'
        }
      `}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {isThermal ? (
            <ThermalIcon className="w-5 h-5 text-orange-400" />
          ) : (
            <SheetIcon className="w-5 h-5 text-blue-400" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-zinc-100 truncate">{format.name}</h3>
            <span className={`
              text-xs px-1.5 py-0.5 rounded-full font-medium
              ${isThermal ? 'bg-orange-400/10 text-orange-400' : 'bg-blue-400/10 text-blue-400'}
            `}>
              {isThermal ? 'Thermal' : 'Sheet'}
            </span>
          </div>

          {format.description && (
            <p className="text-sm text-zinc-500 mt-0.5 truncate">{format.description}</p>
          )}

          <div className="flex items-center gap-4 mt-2 text-sm">
            <span className="text-zinc-400">
              {formatDimensions(format.width, format.height)}
            </span>

            {isThermal ? (
              <span className="text-zinc-500">{format.dpi || 203} DPI</span>
            ) : (
              <span className="text-zinc-500">
                {format.labelsPerSheet} per sheet
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}