'use client';

import { useState } from 'react';
import { LabelFormat, formatDimensions } from '@/lib/types';
import { TrashIcon, EditIcon } from '@/app/icons';
import { Check, X } from 'lucide-react';

interface FormatDetailProps {
  format: LabelFormat;
  onDelete?: () => void;
  onEdit?: () => void;
  onUpdate?: (id: string, updates: Partial<LabelFormat>) => void;
}

export function FormatDetail({ format, onDelete, onUpdate }: FormatDetailProps) {
  const isThermal = format.type === 'thermal';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<LabelFormat>>({});

  const startEdit = () => {
    setDraft({ ...format });
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft({});
    setEditing(false);
  };

  const saveEdit = () => {
    if (onUpdate && Object.keys(draft).length > 0) {
      onUpdate(format.id, draft);
    }
    setEditing(false);
    setDraft({});
  };

  const d = (key: keyof LabelFormat) => (editing ? (draft[key] ?? format[key]) : format[key]);
  const setD = (key: keyof LabelFormat, value: any) => setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="h-full">
      {/* Hero header */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent" />
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
                {editing ? (
                  <input
                    value={d('name') as string}
                    onChange={(e) => setD('name', e.target.value)}
                    className="text-2xl font-bold text-white bg-zinc-900/50 border border-zinc-700 rounded-lg px-3 py-1 focus:outline-none focus:border-amber-500/50"
                  />
                ) : (
                  <h2 className="text-2xl font-bold text-white">{format.name}</h2>
                )}
                {editing ? (
                  <input
                    value={(d('description') as string) || ''}
                    onChange={(e) => setD('description', e.target.value)}
                    placeholder="Description (optional)"
                    className="text-zinc-400 mt-1 bg-zinc-900/50 border border-zinc-700 rounded-lg px-3 py-1 text-sm w-full focus:outline-none focus:border-amber-500/50"
                  />
                ) : (
                  format.description && <p className="text-zinc-400 mt-1">{format.description}</p>
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
              {editing ? (
                <>
                  <button
                    onClick={cancelEdit}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-300 bg-zinc-800/80 hover:bg-zinc-700 rounded-xl transition-colors border border-zinc-700/50"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                  <button
                    onClick={saveEdit}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-black bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 rounded-xl transition-colors shadow-lg shadow-amber-500/20"
                  >
                    <Check className="w-4 h-4" />
                    Save
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={startEdit}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-300 bg-zinc-800/80 hover:bg-zinc-700 rounded-xl transition-colors border border-zinc-700/50"
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
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-8 pb-8">
        {/* Primary specs */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <SpecCard label="Label Size" editing={editing}>
            {editing ? (
              <div className="flex items-center gap-1">
                <input type="number" value={d('width') as number} onChange={(e) => setD('width', parseFloat(e.target.value))} step="0.01" className="w-16 text-xl font-bold text-white bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 focus:outline-none focus:border-amber-500/50" />
                <span className="text-lg text-zinc-400">×</span>
                <input type="number" value={d('height') as number} onChange={(e) => setD('height', parseFloat(e.target.value))} step="0.01" className="w-16 text-xl font-bold text-white bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 focus:outline-none focus:border-amber-500/50" />
                <span className="text-lg text-zinc-400">&quot;</span>
              </div>
            ) : (
              <div className="text-2xl font-bold text-white">{formatDimensions(format.width, format.height)}</div>
            )}
          </SpecCard>

          {isThermal ? (
            <>
              <SpecCard label="Resolution" editing={editing}>
                {editing ? (
                  <div className="flex items-center gap-1">
                    <select value={d('dpi') as number || 203} onChange={(e) => setD('dpi', parseInt(e.target.value))} className="text-xl font-bold text-white bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 focus:outline-none focus:border-amber-500/50">
                      <option value="203">203</option>
                      <option value="300">300</option>
                    </select>
                    <span className="text-lg text-zinc-400">DPI</span>
                  </div>
                ) : (
                  <div className="text-2xl font-bold text-white">{format.dpi || 203} <span className="text-lg text-zinc-400">DPI</span></div>
                )}
              </SpecCard>
              <SpecCard label="Across" editing={editing}>
                {editing ? (
                  <div className="flex items-center gap-1">
                    <input type="number" value={d('labelsAcross') as number || 1} onChange={(e) => setD('labelsAcross', parseInt(e.target.value))} min="1" className="w-16 text-xl font-bold text-white bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 focus:outline-none focus:border-amber-500/50" />
                    <span className="text-lg text-zinc-400">labels</span>
                  </div>
                ) : (
                  <div className="text-2xl font-bold text-white">{format.labelsAcross || 1} <span className="text-lg text-zinc-400">labels</span></div>
                )}
              </SpecCard>
            </>
          ) : (
            <>
              <SpecCard label="Per Sheet" editing={editing}>
                {editing ? (
                  <div className="flex items-center gap-1">
                    <input type="number" value={(d('columns') as number || 1) * (d('rows') as number || 1)} disabled className="w-16 text-xl font-bold text-zinc-400 bg-zinc-800/50 border border-zinc-800 rounded-lg px-2 py-1 cursor-not-allowed" />
                    <span className="text-lg text-zinc-400">labels</span>
                  </div>
                ) : (
                  <div className="text-2xl font-bold text-white">{format.labelsPerSheet} <span className="text-lg text-zinc-400">labels</span></div>
                )}
              </SpecCard>
              <SpecCard label="Grid" editing={editing}>
                {editing ? (
                  <div className="flex items-center gap-1">
                    <input type="number" value={d('columns') as number || 1} onChange={(e) => setD('columns', parseInt(e.target.value))} min="1" className="w-12 text-xl font-bold text-white bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 focus:outline-none focus:border-amber-500/50" />
                    <span className="text-lg text-zinc-400">×</span>
                    <input type="number" value={d('rows') as number || 1} onChange={(e) => setD('rows', parseInt(e.target.value))} min="1" className="w-12 text-xl font-bold text-white bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 focus:outline-none focus:border-amber-500/50" />
                  </div>
                ) : (
                  <div className="text-2xl font-bold text-white">{format.columns} × {format.rows}</div>
                )}
              </SpecCard>
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
                <DetailRow label="Sheet size" editing={editing}>
                  {editing ? (
                    <div className="flex items-center gap-1">
                      <input type="number" value={d('sheetWidth') as number} onChange={(e) => setD('sheetWidth', parseFloat(e.target.value))} step="0.01" className="w-14 text-sm text-white bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 focus:outline-none focus:border-amber-500/50" />
                      <span className="text-zinc-500">×</span>
                      <input type="number" value={d('sheetHeight') as number} onChange={(e) => setD('sheetHeight', parseFloat(e.target.value))} step="0.01" className="w-14 text-sm text-white bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 focus:outline-none focus:border-amber-500/50" />
                      <span className="text-zinc-500">&quot;</span>
                    </div>
                  ) : (
                    <span className="text-zinc-200 font-medium">{format.sheetWidth}&quot; × {format.sheetHeight}&quot;</span>
                  )}
                </DetailRow>
                <DetailRow label="Top margin" editing={editing}>
                  {editing ? (
                    <EditNum value={d('topMargin') as number} onChange={(v) => setD('topMargin', v)} />
                  ) : (
                    <span className="text-zinc-200 font-medium">{format.topMargin}&quot;</span>
                  )}
                </DetailRow>
                <DetailRow label="Side margin" editing={editing}>
                  {editing ? (
                    <EditNum value={d('sideMargin') as number} onChange={(v) => setD('sideMargin', v)} />
                  ) : (
                    <span className="text-zinc-200 font-medium">{format.sideMargin}&quot;</span>
                  )}
                </DetailRow>
                <DetailRow label="H gap" editing={editing}>
                  {editing ? (
                    <EditNum value={d('horizontalGap') as number} onChange={(v) => setD('horizontalGap', v)} />
                  ) : (
                    <span className="text-zinc-200 font-medium">{format.horizontalGap}&quot;</span>
                  )}
                </DetailRow>
                <DetailRow label="V gap" editing={editing}>
                  {editing ? (
                    <EditNum value={d('verticalGap') as number} onChange={(v) => setD('verticalGap', v)} />
                  ) : (
                    <span className="text-zinc-200 font-medium">{format.verticalGap}&quot;</span>
                  )}
                </DetailRow>
              </div>
            </div>

            {/* Visual preview */}
            <div className="p-6 rounded-2xl bg-zinc-900/30 border border-zinc-800/50">
              <h3 className="text-sm font-semibold text-zinc-300 mb-4">Layout Preview</h3>
              <SheetPreview format={editing ? { ...format, ...draft } as LabelFormat : format} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Helper components

function SpecCard({ label, editing, children }: { label: string; editing: boolean; children: React.ReactNode }) {
  return (
    <div className={`p-5 rounded-2xl border ${editing ? 'bg-zinc-900/70 border-amber-500/20' : 'bg-zinc-900/50 border-zinc-800/50'}`}>
      <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">{label}</div>
      {children}
    </div>
  );
}

function DetailRow({ label, editing, children }: { label: string; editing: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex justify-between items-center py-2 ${editing ? '' : 'border-b border-zinc-800/50 last:border-0'}`}>
      <span className="text-zinc-500">{label}</span>
      {children}
    </div>
  );
}

function EditNum({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        step="0.001"
        className="w-20 text-sm text-white bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 focus:outline-none focus:border-amber-500/50 text-right"
      />
      <span className="text-zinc-500">&quot;</span>
    </div>
  );
}

// SVG-based sheet layout preview
function SheetPreview({ format }: { format: LabelFormat }) {
  if (format.type !== 'sheet') return null;

  const cols = format.columns || 1;
  const rows = format.rows || 1;
  const sheetW = format.sheetWidth || 8.5;
  const sheetH = format.sheetHeight || 11;
  const labelW = format.width;
  const labelH = format.height;
  const sideM = format.sideMargin || 0;
  const topM = format.topMargin || 0;
  const gapX = format.horizontalGap || 0;
  const gapY = format.verticalGap || 0;

  const pad = 0.15;
  const viewW = sheetW + pad * 2;
  const viewH = sheetH + pad * 2;
  const maxSize = 320;
  const displayW = maxSize * (viewW / viewH);
  const displayH = maxSize;

  const labels = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = pad + sideM + col * (labelW + gapX);
      const y = pad + topM + row * (labelH + gapY);
      if (x + labelW > pad + sheetW + 0.01 || y + labelH > pad + sheetH + 0.01) continue;
      labels.push(
        <rect
          key={`${row}-${col}`}
          x={x}
          y={y}
          width={labelW}
          height={labelH}
          fill="rgba(245, 158, 11, 0.08)"
          stroke="#d97706"
          strokeWidth={0.012}
          rx={0.02}
        />
      );
    }
  }

  return (
    <div className="flex justify-center py-4">
      <svg
        width={displayW}
        height={displayH}
        viewBox={`0 0 ${viewW} ${viewH}`}
        className="rounded-xl"
      >
        <rect width={viewW} height={viewH} fill="#0a0a0c" rx={0.08} />
        <rect
          x={pad}
          y={pad}
          width={sheetW}
          height={sheetH}
          fill="#1a1a1f"
          stroke="#3f3f46"
          strokeWidth={0.02}
          rx={0.04}
        />
        {labels}
      </svg>
    </div>
  );
}
