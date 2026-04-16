'use client';

import { LabelFormat, formatDimensions } from '@/lib/types';
import { ThermalIcon, SheetIcon, TrashIcon, EditIcon } from './icons';

interface FormatDetailProps {
  format: LabelFormat;
  onDelete?: () => void;
  onEdit?: () => void;
}

export function FormatDetail({ format, onDelete, onEdit }: FormatDetailProps) {
  const isThermal = format.type === 'thermal';

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-zinc-800">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-zinc-950">
            {isThermal ? (
              <ThermalIcon className="w-8 h-8 text-orange-400" />
            ) : (
              <SheetIcon className="w-8 h-8 text-blue-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-semibold text-zinc-100">{format.name}</h2>
            {format.description && (
              <p className="text-zinc-400 mt-1">{format.description}</p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <span className={`
                text-xs px-2 py-1 rounded-full font-medium
                ${isThermal ? 'bg-orange-400/10 text-orange-400' : 'bg-blue-400/10 text-blue-400'}
              `}>
                {isThermal ? 'Thermal Roll' : 'Sheet Labels'}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={onEdit}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
          >
            <EditIcon className="w-4 h-4" />
            Edit
          </button>
          <button
            onClick={onDelete}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-red-400 bg-red-400/10 hover:bg-red-400/20 rounded-lg transition-colors"
          >
            <TrashIcon className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>

      {/* Specs */}
      <div className="flex-1 overflow-auto p-6">
        <h3 className="text-sm font-medium text-zinc-500 uppercase tracking-wider mb-4">
          Specifications
        </h3>

        <div className="space-y-4">
          {/* Label Dimensions */}
          <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
            <div className="text-sm text-zinc-500 mb-1">Label Size</div>
            <div className="text-lg font-medium text-zinc-100">
              {formatDimensions(format.width, format.height)}
            </div>
          </div>

          {isThermal ? (
            // Thermal specs
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
                <div className="text-sm text-zinc-500 mb-1">Print Resolution</div>
                <div className="text-lg font-medium text-zinc-100">{format.dpi || 203} DPI</div>
              </div>
              <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
                <div className="text-sm text-zinc-500 mb-1">Labels Across</div>
                <div className="text-lg font-medium text-zinc-100">{format.labelsAcross || 1}</div>
              </div>
            </div>
          ) : (
            // Sheet specs
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
                  <div className="text-sm text-zinc-500 mb-1">Sheet Size</div>
                  <div className="text-lg font-medium text-zinc-100">
                    {format.sheetWidth}" × {format.sheetHeight}"
                  </div>
                </div>
                <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
                  <div className="text-sm text-zinc-500 mb-1">Labels Per Sheet</div>
                  <div className="text-lg font-medium text-zinc-100">{format.labelsPerSheet}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
                  <div className="text-sm text-zinc-500 mb-1">Grid Layout</div>
                  <div className="text-lg font-medium text-zinc-100">
                    {format.columns} × {format.rows}
                  </div>
                </div>
                <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
                  <div className="text-sm text-zinc-500 mb-1">Total Labels</div>
                  <div className="text-lg font-medium text-zinc-100">
                    {(format.columns || 1) * (format.rows || 1)}
                  </div>
                </div>
              </div>

              <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
                <div className="text-sm text-zinc-500 mb-3">Margins & Gaps</div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Top margin</span>
                    <span className="text-zinc-200">{format.topMargin}"</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Side margin</span>
                    <span className="text-zinc-200">{format.sideMargin}"</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Horizontal gap</span>
                    <span className="text-zinc-200">{format.horizontalGap}"</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Vertical gap</span>
                    <span className="text-zinc-200">{format.verticalGap}"</span>
                  </div>
                </div>
              </div>

              {/* Visual Preview */}
              <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
                <div className="text-sm text-zinc-500 mb-3">Layout Preview</div>
                <SheetPreview format={format} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// SVG-based sheet layout preview
function SheetPreview({ format }: { format: LabelFormat }) {
  if (format.type !== 'sheet') return null;

  const cols = format.columns || 1;
  const rows = format.rows || 1;
  const maxPreviewSize = 200;

  // Calculate aspect ratio
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
          stroke="#6366f1"
          strokeWidth="1"
          rx="2"
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
        className="bg-zinc-950 rounded"
      >
        {/* Sheet background */}
        <rect
          width={previewWidth}
          height={previewHeight}
          fill="#18181b"
          rx="4"
        />
        {/* Labels */}
        {labels}
      </svg>
    </div>
  );
}