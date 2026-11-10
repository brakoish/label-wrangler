'use client';

import { useState } from 'react';
import { LabelGlyph } from '@/components/LabelGlyph';
import { LabelFormat, formatDimensions } from '@/lib/types';
import { TrashIcon, EditIcon } from '@/app/icons';
import { Check, X } from 'lucide-react';
import { SegmentedIndicator } from '@/components/ui/Segmented';

interface FormatDetailProps {
  format: LabelFormat;
  onDelete?: () => void;
  onEdit?: () => void;
  onUpdate?: (id: string, updates: Partial<LabelFormat>) => Promise<void>;
}

export function FormatDetail({ format, onDelete, onUpdate }: FormatDetailProps) {
  const isThermal = format.type === 'thermal';
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
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

  const saveEdit = async () => {
    setSaving(true); setSaveError('');
    try {
      if (onUpdate && Object.keys(draft).length > 0) {
        const { id: _id, createdAt: _created, updatedAt: _updated, ...changes } = draft;
        await onUpdate(format.id, changes);
      }
      setEditing(false); setDraft({});
    } catch(error) { setSaveError((error as Error).message); }
    finally { setSaving(false); }
  };

  const d = (key: keyof LabelFormat) => (editing ? (draft[key] ?? format[key]) : format[key]);
  const setD = <K extends keyof LabelFormat>(key: K, value: LabelFormat[K]) => setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="h-full">
      {saveError && <p role="alert" className="p-4 text-red-400">{saveError}</p>}
      <div className="px-4 pt-2 pb-6 sm:px-8 xl:px-0">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <span className="flex h-10 w-14 shrink-0 items-center justify-center" aria-hidden="true">
                <LabelGlyph format={format} />
              </span>
              <div>
                {editing ? (
                  <input
                    value={d('name') as string}
                    onChange={(e) => setD('name', e.target.value)}
                    aria-label="Name"
                    className="field text-lg font-semibold"
                  />
                ) : (
                  <h2 className="text-xl font-semibold text-zinc-100">{format.name}</h2>
                )}
                {editing ? (
                  <input
                    value={(d('description') as string) || ''}
                    onChange={(e) => setD('description', e.target.value)}
                    placeholder="Description (optional)"
                    aria-label="Description"
                    className="field mt-2 w-full"
                  />
                ) : (
                  format.description && <p className="text-zinc-400 mt-1">{format.description}</p>
                )}
                <p className="mt-1 text-sm text-zinc-400">{isThermal ? 'Thermal roll' : 'Sheet labels'}</p>
              </div>
            </div>

            <div className="flex shrink-0 gap-2">
              {editing ? (
                <>
                  <button
                    onClick={cancelEdit}
                    className="btn btn-secondary"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                  <button
                    onClick={()=>void saveEdit()} disabled={saving}
                    className="btn btn-primary"
                  >
                    <Check className="w-4 h-4" />
                    Save
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={startEdit}
                    className="btn btn-secondary"
                  >
                    <EditIcon className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    onClick={onDelete}
                    className="btn btn-danger-ghost"
                  >
                    <TrashIcon className="w-4 h-4" />
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-8 sm:px-8 xl:px-0">
        {/* Primary specs */}
        <div className="grid grid-cols-1 gap-6 mb-8 sm:grid-cols-3">
          <SpecCard label="Label size" editing={editing}>
            {editing ? (
              <div className="flex items-center gap-1">
                <input type="number" value={d('width') as number} onChange={(e) => setD('width', parseFloat(e.target.value))} step="0.01" className="field field-sm w-16 text-lg font-semibold" />
                <span className="text-base font-normal text-zinc-400">×</span>
                <input type="number" value={d('height') as number} onChange={(e) => setD('height', parseFloat(e.target.value))} step="0.01" className="field field-sm w-16 text-lg font-semibold" />
                <span className="text-base font-normal text-zinc-400">&quot;</span>
              </div>
            ) : (
              <div className="text-2xl font-semibold text-zinc-100 tabular-nums">{formatDimensions(format.width, format.height)}</div>
            )}
          </SpecCard>

          {isThermal ? (
            <>
              <SpecCard label="Dots per inch" hint="On the printer’s sticker, usually 203" editing={editing}>
                {editing ? (
                  <div className="segmented segmented-xs w-40" role="radiogroup" aria-label="Dots per inch">
                    <SegmentedIndicator index={(d('dpi') as number || 203) === 300 ? 1 : 0} count={2} />
                    {[203, 300].map((dpi) => (
                      <button key={dpi} type="button" role="radio" aria-checked={(d('dpi') as number || 203) === dpi} onClick={() => setD('dpi', dpi)}>{dpi}</button>
                    ))}
                  </div>
                ) : (
                  <div className="text-2xl font-semibold text-zinc-100 tabular-nums">{format.dpi || 203}</div>
                )}
              </SpecCard>
              <SpecCard label="Labels across the roll" editing={editing}>
                {editing ? (
                  <div className="flex items-center gap-1">
                    <input type="number" value={d('labelsAcross') as number || 1} onChange={(e) => setD('labelsAcross', parseInt(e.target.value))} min="1" className="field field-sm w-16 text-lg font-semibold" />
                    <span className="text-base font-normal text-zinc-400">labels</span>
                  </div>
                ) : (
                  <div className="text-2xl font-semibold text-zinc-100 tabular-nums">{format.labelsAcross || 1} <span className="text-base font-normal text-zinc-400">{(format.labelsAcross || 1) === 1 ? 'label' : 'labels'}</span></div>
                )}
              </SpecCard>
            </>
          ) : (
            <>
              <SpecCard label="Per sheet" editing={editing}>
                {editing ? (
                  <div className="flex items-center gap-1">
                    <input type="number" value={(d('columns') as number || 1) * (d('rows') as number || 1)} disabled className="field field-sm w-16 text-lg font-semibold" />
                    <span className="text-base font-normal text-zinc-400">labels</span>
                  </div>
                ) : (
                  <div className="text-2xl font-semibold text-zinc-100 tabular-nums">{format.labelsPerSheet} <span className="text-base font-normal text-zinc-400">{format.labelsPerSheet === 1 ? 'label' : 'labels'}</span></div>
                )}
              </SpecCard>
              <SpecCard label="Grid" editing={editing}>
                {editing ? (
                  <div className="flex items-center gap-1">
                    <input type="number" value={d('columns') as number || 1} onChange={(e) => setD('columns', parseInt(e.target.value))} min="1" className="field field-sm w-12 text-lg font-semibold" />
                    <span className="text-base font-normal text-zinc-400">×</span>
                    <input type="number" value={d('rows') as number || 1} onChange={(e) => setD('rows', parseInt(e.target.value))} min="1" className="field field-sm w-12 text-lg font-semibold" />
                  </div>
                ) : (
                  <div className="text-2xl font-semibold text-zinc-100 tabular-nums">{format.columns} × {format.rows}</div>
                )}
              </SpecCard>
            </>
          )}
        </div>

        {/* Thermal-specific details */}
        {isThermal && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="card p-4 sm:p-5">
              <h3 className="section-title mb-3">Roll spacing</h3>
              <div className="space-y-3">
                <DetailRow label="Label gap" hint="Space between labels on the roll" editing={editing}>
                  {editing ? (
                    <EditNum value={d('labelGap') as number || 0} onChange={(v) => setD('labelGap', v)} />
                  ) : (
                    <span className="text-zinc-100 font-medium">{format.labelGap || 0}&quot;</span>
                  )}
                </DetailRow>
                {(d('labelsAcross') as number || 1) > 1 && (
                  <>
                    <DetailRow label="Gap across" hint="Space between labels side by side" editing={editing}>
                      {editing ? (
                        <EditNum value={d('horizontalGapThermal') as number || 0} onChange={(v) => setD('horizontalGapThermal', v)} />
                      ) : (
                        <span className="text-zinc-100 font-medium">{format.horizontalGapThermal || 0}&quot;</span>
                      )}
                    </DetailRow>
                    <DetailRow label="Side margin" hint="Backing paper left of the first label" editing={editing}>
                      {editing ? (
                        <EditNum value={d('sideMarginThermal') as number || 0} onChange={(v) => setD('sideMarginThermal', v)} />
                      ) : (
                        <span className="text-zinc-100 font-medium">{format.sideMarginThermal || 0}&quot;</span>
                      )}
                    </DetailRow>
                  </>
                )}
                <DetailRow label="Backing width" hint="Width of the paper the labels sit on. Auto works for most rolls." editing={editing}>
                  {editing ? (
                    <EditNum value={d('linerWidth') as number || 0} onChange={(v) => setD('linerWidth', v)} />
                  ) : (
                    <span className="text-zinc-100 font-medium">{format.linerWidth ? `${format.linerWidth}"` : 'Auto'}</span>
                  )}
                </DetailRow>
              </div>
            </div>

            <div className="card p-4 sm:p-5">
              <h3 className="section-title mb-3">Roll preview</h3>
              <RollPreview format={editing ? { ...format, ...draft } as LabelFormat : format} />
            </div>
          </div>
        )}

        {/* Sheet-specific details */}
        {!isThermal && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Sheet dimensions */}
            <div className="card p-4 sm:p-5">
              <h3 className="section-title mb-3">Sheet dimensions</h3>
              <div className="space-y-3">
                <DetailRow label="Sheet size" editing={editing}>
                  {editing ? (
                    <div className="flex items-center gap-1">
                      <input type="number" value={d('sheetWidth') as number} onChange={(e) => setD('sheetWidth', parseFloat(e.target.value))} step="0.01" className="field field-sm w-14" />
                      <span className="text-zinc-500">×</span>
                      <input type="number" value={d('sheetHeight') as number} onChange={(e) => setD('sheetHeight', parseFloat(e.target.value))} step="0.01" className="field field-sm w-14" />
                      <span className="text-zinc-500">&quot;</span>
                    </div>
                  ) : (
                    <span className="text-zinc-100 font-medium">{format.sheetWidth}&quot; × {format.sheetHeight}&quot;</span>
                  )}
                </DetailRow>
                <DetailRow label="Top margin" editing={editing}>
                  {editing ? (
                    <EditNum value={d('topMargin') as number} onChange={(v) => setD('topMargin', v)} />
                  ) : (
                    <span className="text-zinc-100 font-medium">{format.topMargin}&quot;</span>
                  )}
                </DetailRow>
                <DetailRow label="Side margin" editing={editing}>
                  {editing ? (
                    <EditNum value={d('sideMargin') as number} onChange={(v) => setD('sideMargin', v)} />
                  ) : (
                    <span className="text-zinc-100 font-medium">{format.sideMargin}&quot;</span>
                  )}
                </DetailRow>
                <DetailRow label="Gap across" editing={editing}>
                  {editing ? (
                    <EditNum value={d('horizontalGap') as number} onChange={(v) => setD('horizontalGap', v)} />
                  ) : (
                    <span className="text-zinc-100 font-medium">{format.horizontalGap}&quot;</span>
                  )}
                </DetailRow>
                <DetailRow label="Gap down" editing={editing}>
                  {editing ? (
                    <EditNum value={d('verticalGap') as number} onChange={(v) => setD('verticalGap', v)} />
                  ) : (
                    <span className="text-zinc-100 font-medium">{format.verticalGap}&quot;</span>
                  )}
                </DetailRow>
              </div>
            </div>

            {/* Visual preview */}
            <div className="card p-4 sm:p-5">
              <h3 className="section-title mb-3">Layout preview</h3>
              <SheetPreview format={editing ? { ...format, ...draft } as LabelFormat : format} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Helper components

/** One headline measurement: a label and a big number, no box around it. */
function SpecCard({ label, hint, children }: { label: string; hint?: string; editing: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm text-zinc-400 mb-1">{label}</div>
      {children}
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

function DetailRow({ label, hint, editing, children }: { label: string; hint?: string; editing: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex justify-between items-center gap-3 ${editing ? 'py-1' : 'py-1.5'}`}>
      <span className="min-w-0">
        <span className="block text-zinc-400">{label}</span>
        {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
      </span>
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
        className="field field-sm w-20 text-right"
      />
      <span className="text-zinc-500">&quot;</span>
    </div>
  );
}

// SVG roll preview — shows labels across the roll width with 2 rows for vertical gap
function RollPreview({ format }: { format: LabelFormat }) {
  if (format.type !== 'thermal') return null;

  const across = format.labelsAcross || 1;
  const labelW = format.width;
  const labelH = format.height;
  const gapH = format.horizontalGapThermal || 0;
  const sideM = format.sideMarginThermal || 0;
  const labelGap = format.labelGap || 0;

  // Calculate liner width: explicit or auto from labels + gaps + margins
  const linerW = format.linerWidth || (sideM * 2 + across * labelW + (across - 1) * gapH);

  // Center labels on liner when user didn't set a side margin explicitly.
  const labelsTotalW = across * labelW + (across - 1) * gapH;
  const centeredSideM = Math.max(0, (linerW - labelsTotalW) / 2);
  const effectiveSideM = sideM > 0 ? sideM : centeredSideM;

  // Show 2 rows to visualize vertical gap
  const rowCount = 2;
  const totalH = rowCount * labelH + (rowCount - 1) * labelGap;

  const pad = linerW * 0.06;
  const viewW = linerW + pad * 2;
  const viewH = totalH + pad * 2;

  // Keep it reasonably sized
  const maxW = 300;
  const scale = maxW / viewW;
  const displayW = maxW;
  const displayH = viewH * scale;

  const labels = [];
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < across; col++) {
      const x = pad + effectiveSideM + col * (labelW + gapH);
      const y = pad + row * (labelH + labelGap);
      labels.push(
        <rect
          key={`${row}-${col}`}
          x={x}
          y={y}
          width={labelW}
          height={labelH}
          fill="rgba(245, 158, 11, 0.08)"
          stroke="#d97706"
          strokeWidth={linerW * 0.004}
          rx={linerW * 0.005}
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
        <rect width={viewW} height={viewH} fill="#0a0a0c" rx={viewW * 0.02} />
        {/* Liner backing */}
        <rect
          x={pad}
          y={0}
          width={linerW}
          height={viewH}
          fill="#1a1a1f"
          stroke="#3f3f46"
          strokeWidth={linerW * 0.005}
        />
        {/* Labels */}
        {labels}
        {/* Dimension annotation — liner width */}
        <text
          x={pad + linerW / 2}
          y={viewH - pad * 0.3}
          textAnchor="middle"
          fill="#71717a"
          fontSize={linerW * 0.04}
          fontFamily="Arial"
        >
          {linerW.toFixed(2)}&quot; liner
        </text>
      </svg>
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
