'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { LabelFormat, LabelTemplate } from '@/lib/types';
import { getBitmapProof } from '@/lib/thermal/client';
import { generateZPLWithImages } from '@/lib/zplGenerator';
import { plainRenderWarning } from '@/lib/designerLayout';
import { renderZplToDataUrl } from '@/lib/zplRenderClient';
import { PrintControls } from './PrintControls';
import { OfficePreviewPrint } from './OfficePreviewPrint';
import { LabelOutlineOverlay } from '../LabelOutlineOverlay';
import { friendlyRenderError, friendlyRenderFailure } from '@/lib/userMessages';

interface ZPLPreviewProps {
  format: LabelFormat;
  template: LabelTemplate;
  testData?: Record<string, string>;
  /** Draw only while this view is showing (the designer's "Exact print"). */
  active?: boolean;
  /** The designer already names the problems above the preview: don't say them twice. */
  problemsShown?: boolean;
}

export function ZPLPreview({ format, template, testData, active = true, problemsShown = false }: ZPLPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const signature = JSON.stringify([template, format, testData]);
  const [renderedSignature, setRenderedSignature] = useState('');
  const proofReady = template.thermalRenderMode !== 'bitmap-v1' || (signature === renderedSignature && !loading && !error);
  // Zoom level as multiplier of "fit" size. 1 = fit to container, 2 = double.
  const [zoom, setZoom] = useState<number>(1);
  // Label edges are off by default: this is exactly what the printer makes.
  // On rolls with 2+ across they can be turned on to see where each label is.
  // Default on when labelsAcross > 1 (where it actually helps), off otherwise.
  const [showOutlines, setShowOutlines] = useState(false);

  const fetchPreview = useCallback(async () => {
    if (format.type !== 'thermal') return;

    const token = ++revision.current;
    setLoading(true);
    setError(null);

    try {
      // Bitmap decodes its authoritative packed pixels; native ZPL uses local WASM.
      const nextZpl = await generateZPLWithImages(template, format, testData);
      const url = await renderZplToDataUrl(nextZpl, format);
      if (token !== revision.current) return;
      setPreviewUrl(url); setRenderedSignature(signature);
    } catch (err) {
      if (token !== revision.current) return;
      setError(plainRenderWarning(friendlyRenderFailure(err, 'The preview could not be drawn.', template.elements, format.labelsAcross || 1, testData, format), (m) => friendlyRenderError(m, template.elements, format.labelsAcross || 1, testData, format)));
      setPreviewUrl(null);
      if (template.thermalRenderMode === 'bitmap-v1') {
        try {
          const draft = await getBitmapProof(template, format, testData, true);
          if (token === revision.current) setPreviewUrl(draft.proof);
        } catch { /* The original error remains visible; never use stale print bytes. */ }
      }
    } finally {
      if (token === revision.current) setLoading(false);
    }
  }, [template, format, testData, signature]);

  // Render only while the exact print view shows. Local WASM uses a tight
  // debounce because there is no network or rate limit.
  useEffect(() => {
    if (!active) return;

    const timer = setTimeout(() => {
      fetchPreview();
    }, 200);

    // Invalidate async work, not a DOM ref. Older results may never replace new artwork.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { clearTimeout(timer); revision.current++; };
  }, [active, fetchPreview]);

  if (format.type !== 'thermal') return null;

  const basePreviewWidth = Math.min(900, Math.max(520, format.width * (format.dpi || 203) * 1.25));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 sm:px-6">
        {/* Test prints: the office printer, and a printer plugged into this computer. */}
        <OfficePreviewPrint key={template.id} format={format} template={template} testData={testData} />
        <PrintControls format={format} template={template} testData={testData} proofReady={proofReady} />

        <div className="ml-auto flex items-center">
          {(format.labelsAcross || 1) > 1 && <button
            onClick={() => setShowOutlines((s) => !s)}
            aria-pressed={showOutlines}
            className="btn btn-ghost btn-sm"
          >
            {showOutlines ? 'Hide label edges' : 'Show label edges'}
          </button>}
          <button
            onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
            title="Zoom out"
            aria-label="Zoom out"
            className="btn btn-ghost btn-icon btn-sm text-zinc-400"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-zinc-400 w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(8, +(z + 0.25).toFixed(2)))}
            title="Zoom in"
            aria-label="Zoom in"
            className="btn btn-ghost btn-icon btn-sm text-zinc-400"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => setZoom(1)}
            title="Fit to view"
            aria-label="Fit to view"
            className="btn btn-ghost btn-icon btn-sm text-zinc-400"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex min-h-[320px] flex-1 flex-col px-4 pb-4 pt-1 sm:px-6">
        {error && previewUrl && !problemsShown && <p role="status" className="mb-2 text-sm text-amber-300">Fix this before printing: {error}</p>}
        {/* Zoomed output scrolls inside this frame. */}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
          {loading && !previewUrl ? (
            <div className="flex items-center justify-center text-sm text-zinc-400">
              <RefreshCw className="mr-2 w-5 h-5 animate-spin" aria-hidden="true" />
              Drawing the label…
            </div>
          ) : error && !previewUrl ? (
            <div className="flex items-center justify-center text-sm text-red-400">
              {error}
            </div>
          ) : previewUrl ? (
            <div
              className="relative shrink-0"
              style={{ padding: '4px', width: `${basePreviewWidth * zoom}px`, maxWidth: zoom === 1 ? '100%' : 'none' }}
            >
              <img
                src={previewUrl}
                alt={error ? 'Exact print, with problems to fix' : 'Exact print'}
                className="rounded-md"
                style={{ imageRendering: 'pixelated', display: 'block', maxWidth: '100%', width: '100%', height: 'auto' }}
              />
              {showOutlines && <LabelOutlineOverlay format={format} />}
              {(loading || (!proofReady && !error)) && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/30">
                  <RefreshCw className="w-5 h-5 animate-spin text-zinc-100" aria-hidden="true" />
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center text-sm text-zinc-400">Drawing the label…</div>
          )}
        </div>
      </div>
    </div>
  );
}

// LabelOutlineOverlay is defined in @/components/LabelOutlineOverlay
// so the Runs detail page can share the exact same visual treatment.
