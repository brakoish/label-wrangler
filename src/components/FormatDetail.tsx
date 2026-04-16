'use client';

import { LabelFormat, formatDimensions } from '@/lib/types';
import { TrashIcon, EditIcon } from '@/app/icons';

interface FormatDetailProps {
  format: LabelFormat;
  onDelete?: () => void;
  onEdit?: () => void;
}

export function FormatDetail({ format, onDelete, onEdit }: FormatDetailProps) {
  const isThermal = format.type === 'thermal';

  return (
    <div className="h-full">
      {/* Hero header */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-transparent" />
        <div className="relative px-8 py-8">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className={`
                w-14 h-14 rounded-2xl flex items-center justify-center
                ${isThermal
                  ? 'bg-gradient-to-br from-orange-500 to-orange-600 shadow-lg shadow-orange-500/20'
                  : 'bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/20'
                }
              `}>
                {isThermal ? (
                  <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="4" y="6" width="16" height="12" rx="2" />
                    <circle cx="12" cy="12" r="3" />
                    <path d="M8 6V4M16 6V4" />
                  </svg>
                ) : (
                  <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="4" y="3" width="16" height="18" rx="2" />
                    <path d="M4 9h16M4 15h16M12 3v18" />
                  </svg>
                )}
              </div>

              <div>
                <h2 className="text-2xl font-bold text-white">{format.name}</h2>
                {format.description && (
                  <p className="text-zinc-400 mt-1">{format.description}</p>
                )}
                <div className="flex items-center gap-2 mt-3">
                  <span className={`
                    text-xs px-2.5 py-1 rounded-full font-medium
                    ${isThermal
                      ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                      : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                    }
                  `}>
                    {isThermal ? 'Thermal Roll' : 'Sheet Labels'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={onEdit}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-300 bg-zinc-800/80 hover:bg-zinc-700 rounded-xl transition-colors border border-zinc-700"
              >
                <EditIcon className="w-4 h-4" />
                Edit
              </button>
              <button
                onClick={onDelete}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-xl transition-colors border border-red-500/20"
              >
                <TrashIcon className="w-4 h-4" />
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-8 pb-8">
        {/* Primary specs */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="p-5 rounded-2xl bg-zinc-900/50 border border-zinc-800/50">
            <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Label Size</div>
            <div className="text-2xl font-bold text-white">{formatDimensions(format.width, format.height)}</div>
          </div>

          {isThermal ? (
            <>
              <div className="p-5 rounded-2xl bg-zinc-900/50 border border-zinc-800/50">
                <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Resolution</div>
                <div className="text-2xl font-bold text-white">{format.dpi || 203} <span className="text-lg text-zinc-400">DPI</span></div>
              </div>
              <div className="p-5 rounded-2xl bg-zinc-900/50 border border-zinc-800/50">
                <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Across</div>
                <div className="text-2xl font-bold text-white">{format.labelsAcross || 1} <span className="text-lg text-zinc-400">labels</span></div>
              </div>
            </>
          ) : (
            <>
              <div className="p-5 rounded-2xl bg-zinc-900/50 border border-zinc-800/50">
                <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Per Sheet</div>
                <div className="text-2xl font-bold text-white">{format.labelsPerSheet} <span className="text-lg text-zinc-400">labels</span></div>
              </div>
              <div className="p-5 rounded-2xl bg-zinc-900/50 border border-zinc-800/50">
                <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Grid</div>
                <div className="text-2xl font-bold text-white">{format.columns} × {format.rows}</div>
              </div>
            </>
          )}
        </div>

        {/* Sheet-specific details */}
        {!isThermal && (
          <div className="grid grid-cols-2 gap-6">
            {/* Sheet dimensions */}
            <div className="p-6 rounded-2xl bg-zinc-900/30 border border-zinc-800/50">
              <h3 className="text-sm font-semibold text-zinc-300 mb-4">Sheet Dimensions</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-zinc-800/50">
                  <span className="text-zinc-500">Sheet size</span>
                  <span className="text-zinc-200 font-medium">{format.sheetWidth}" × {format.sheetHeight}"</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-zinc-800/50">
                  <span className="text-zinc-500">Top margin</span>
                  <span className="text-zinc-200 font-medium">{format.topMargin}"</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-zinc-800/50">
                  <span className="text-zinc-500">Side margin</span>
                  <span className="text-zinc-200 font-medium">{format.sideMargin}"</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-zinc-800/50">
                  <span className="text-zinc-500">Horizontal gap</span>
                  <span className="text-zinc-200 font-medium">{format.horizontalGap}"</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-zinc-500">Vertical gap</span>
                  <span className="text-zinc-200 font-medium">{format.verticalGap}"</span>
                </div>
              </div>
            </div>

            {/* Visual preview */}
            <div className="p-6 rounded-2xl bg-zinc-900/30 border border-zinc-800/50">
              <h3 className="text-sm font-semibold text-zinc-300 mb-4">Layout Preview</h3>
              <SheetPreview format={format} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// SVG-based sheet layout preview
function SheetPreview({ format }: { format: LabelFormat }) {
  if (format.type !== 'sheet') return null;

  const cols = format.columns || 1;
  const rows = format.rows || 1;
  const maxPreviewSize = 280;

  const sheetAspect = (format.sheetWidth || 8.5) / (format.sheetHeight || 11);
  const previewWidth = sheetAspect > 1 ? maxPreviewSize : maxPreviewSize * sheetAspect;
  const previewHeight = sheetAspect > 1 ? maxPreviewSize / sheetAspect : maxPreviewSize;

  const scaleX = previewWidth / (format.sheetWidth || 8.5);
  const scaleY = previewHeight / (format.sheetHeight || 11);

  const labelW = format.width * scaleX;
  const labelH = format.height * scaleY;
  const startX = (format.sideMargin || 0) * scaleX;
  const startY = (format.topMargin || 0) * scaleY;
  const gapX = (format.horizontalGap || 0) * scaleX;
  const gapY = (format.verticalGap || 0) * scaleY;

  const labels = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = startX + col * (labelW + gapX);
      const y = startY + row * (labelH + gapY);
      labels.push(
        <rect
          key={`${row}-${col}`}
          x={x}
          y={y}
          width={labelW}
          height={labelH}
          fill="none"
          stroke="url(#gradient)"
          strokeWidth="1.5"
          rx="3"
        />
      );
    }
  }

  return (
    <div className="flex justify-center py-4">
      <svg
        width={previewWidth}
        height={previewHeight}
        viewBox={`0 0 ${previewWidth} ${previewHeight}`}
        className="rounded-xl"
      >
        <defs>
          <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#c084fc" />
          </linearGradient>
        </defs>
        <rect
          width={previewWidth}
          height={previewHeight}
          fill="#0c0c0e"
          rx="8"
          stroke="#27272f"
          strokeWidth="1"
        />
        {labels}
      </svg>
    </div>
  );
}
