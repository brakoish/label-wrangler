'use client';
import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { generateZPLWithImages } from '@/lib/zplGenerator';
import { renderZplToDataUrl } from '@/lib/zplRenderClient';
import { prepareRunPreview, type RunPreviewState } from '@/lib/runPreview';
import type { LabelFormat, LabelTemplate } from '@/lib/types';

/**
 * A real picture of a label filled with the product's details, drawn the way
 * New run draws its preview (the same printer code, rendered on this device).
 * `lanes`: one set of values per label across the roll.
 */
export function KioskPreview({ template, format, lanes, alt, className = '' }: { template: LabelTemplate; format: LabelFormat; lanes: Array<Record<string, string>>; alt: string; className?: string }) {
  const [result, setResult] = useState<{ key: string; state: RunPreviewState } | null>(null);
  const key = JSON.stringify([template.id, template.updatedAt, format.id, lanes]);
  useEffect(() => prepareRunPreview(
    () => generateZPLWithImages(template, format, lanes.length > 1 ? lanes : lanes[0] ?? {}),
    (zpl) => renderZplToDataUrl(zpl, format),
    (state) => setResult({ key, state }),
    // key stands for template, format and lanes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [key]);
  const state: RunPreviewState = result?.key === key ? result.state : { status: 'loading' };
  const ratio = `${Math.max(0.1, format.width * Math.max(1, format.labelsAcross || 1))} / ${Math.max(0.1, format.height)}`;
  return (
    <div className={`relative flex w-full items-center justify-center overflow-hidden rounded-lg bg-zinc-100 ${className}`} style={{ aspectRatio: ratio }}>
      {state.status === 'ready' && (
        // A data URL drawn on this device.
        <img src={state.url} alt={alt} className="h-full w-full object-contain" draggable={false} />
      )}
      {state.status === 'loading' && <span className="absolute inset-0 animate-pulse bg-zinc-200" aria-label="Drawing the label…" role="img" />}
      {(state.status === 'error' || state.status === 'empty') && (
        <span className="flex flex-col items-center gap-1 p-3 text-center text-sm text-zinc-600">
          <ImageOff className="size-6" aria-hidden="true" />
          Can’t show a picture of this label
        </span>
      )}
    </div>
  );
}
