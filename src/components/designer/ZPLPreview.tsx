'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Printer, RefreshCw, Code2, ZoomIn, ZoomOut, Maximize2, SquareDashed, ChevronDown } from 'lucide-react';
import { LabelFormat, LabelTemplate } from '@/lib/types';
import { getBitmapProof } from '@/lib/thermal/client';
import { generateZPLWithImages } from '@/lib/zplGenerator';
import { renderZplToDataUrl } from '@/lib/zplRenderClient';
import { PrintControls } from './PrintControls';
import { OfficePreviewPrint } from './OfficePreviewPrint';
import { LabelOutlineOverlay } from '../LabelOutlineOverlay';

interface ZPLPreviewProps {
  format: LabelFormat;
  template: LabelTemplate;
  testData?: Record<string, string>;
}

export function ZPLPreview({ format, template, testData }: ZPLPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [zpl, setZpl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showZPL, setShowZPL] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const revision = useRef(0);
  const signature = JSON.stringify([template, format, testData]);
  const [renderedSignature, setRenderedSignature] = useState('');
  const proofReady = template.thermalRenderMode !== 'bitmap-v1' || (signature === renderedSignature && !loading && !error);
  // Zoom level as multiplier of "fit" size. 1 = fit to container, 2 = double.
  const [zoom, setZoom] = useState<number>(1);
  // Overlay label outlines so the user can see lane boundaries on multi-across rolls.
  // Default on when labelsAcross > 1 (where it actually helps), off otherwise.
  const [showOutlines, setShowOutlines] = useState<boolean>((format.labelsAcross || 1) > 1);

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
      setZpl(nextZpl); setPreviewUrl(url); setRenderedSignature(signature);
    } catch (err) {
      if (token !== revision.current) return;
      setError(err instanceof Error ? err.message : 'Preview failed');
      setPreviewUrl(null); setZpl('');
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

  // Render only while the secondary print preview is open. Local WASM uses a
  // tight debounce because there is no network or rate limit.
  useEffect(() => {
    if (!expanded) return;

    const timer = setTimeout(() => {
      fetchPreview();
    }, 200);

    // Invalidate async work, not a DOM ref. Older results may never replace new artwork.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { clearTimeout(timer); revision.current++; };
  }, [expanded, fetchPreview]);

  if (format.type !== 'thermal') return null;

  const basePreviewWidth = Math.min(900, Math.max(520, format.width * (format.dpi || 203) * 1.25));

  return (
    <div className="border-t border-zinc-800/50 flex flex-col">
      <div className={`flex items-center gap-2 px-6 py-3 flex-wrap ${expanded ? 'border-b border-zinc-800/50' : ''}`}>
        <Printer className="w-4 h-4 text-amber-400" />
        <button
          onClick={() => setExpanded((value) => !value)}
          className="flex items-center gap-2 text-left"
          aria-expanded={expanded}
        >
          <span className="text-xs text-zinc-400 uppercase tracking-wider font-semibold">Print Preview</span>
          <span className="text-xs text-zinc-500">{template.thermalRenderMode === 'bitmap-v1' ? 'Exact bitmap proof — bundled fonts' : 'Actual ZPL output — open to check alignment'}</span>
          <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>

        {expanded && <div className="w-px h-4 bg-zinc-800 mx-2" />}

        {/* WebUSB test print controls — connect, print current template, calibration. */}
        {expanded && <OfficePreviewPrint key={template.id} format={format} template={template} testData={testData} />}
        {expanded && <PrintControls format={format} template={template} testData={testData} proofReady={proofReady} />}

        {expanded && <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
            title="Zoom out"
            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-zinc-400 w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(8, +(z + 0.25).toFixed(2)))}
            title="Zoom in"
            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => setZoom(1)}
            title="Fit to view"
            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowOutlines((s) => !s)}
            title={showOutlines ? 'Hide label outlines' : 'Show label outlines'}
            className={`p-1.5 rounded-md transition-colors ${showOutlines ? 'text-amber-400 bg-amber-500/10' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            <SquareDashed className="w-4 h-4" />
          </button>
          <div className="w-px h-4 bg-zinc-800 mx-1" />
          <button
            onClick={() => setShowZPL(!showZPL)}
            title="View ZPL code"
            className={`p-1.5 rounded-md transition-colors ${showZPL ? 'text-amber-400 bg-amber-500/10' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            <Code2 className="w-4 h-4" />
          </button>
          <button
            onClick={fetchPreview}
            disabled={loading}
            title="Refresh preview"
            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>}
      </div>

      {expanded && (
        <div className="px-6 py-4 flex flex-col" style={{ minHeight: '60vh', maxHeight: '720px' }}>
          {error && previewUrl && <p role="status" className="text-sm text-amber-400 mb-2">Editing preview — fix before printing: {error}</p>}
          {/* ZPL Code view */}
          {showZPL && (
            <div className="mb-3 p-3 bg-zinc-950 rounded-lg border border-zinc-800/50 max-h-[200px] overflow-auto">
              <pre className="text-[10px] text-green-400 font-mono whitespace-pre-wrap break-all">{zpl}</pre>
            </div>
          )}

          {/* The print image opens large enough to inspect alignment. Zoomed
              output can scroll without shrinking the design canvas above. */}
          <div className="flex-1 flex items-center justify-center min-h-0 overflow-auto">
        {loading && !previewUrl ? (
          <div className="flex items-center justify-center text-zinc-500 text-sm">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            Rendering…
          </div>
        ) : error && !previewUrl ? (
          <div className="flex items-center justify-center text-red-400 text-sm">
            {error}
          </div>
        ) : previewUrl ? (
          <div
            className="relative shrink-0"
            style={{ padding: '4px', width: `${basePreviewWidth * zoom}px`, maxWidth: zoom === 1 ? '100%' : 'none' }}
          >
            {/* At zoom=1 the image fits its container (max-w/h 100%).
                At zoom>1 it grows past container bounds and parent scrolls. */}
            <img
              src={previewUrl}
              alt={error ? 'Editing preview with warnings' : 'ZPL Preview'}
              className="rounded-lg border border-zinc-700/50"
              style={{
                // Native-DPI render — keep pixelated for sharp bitmap-font edges;
                // zoom handles bigger size when user wants to inspect details.
                imageRendering: 'pixelated',
                display: 'block',
                maxWidth: '100%',
                width: '100%',
                height: 'auto',
              }}
            />
            {showOutlines && <LabelOutlineOverlay format={format} />}
            {(loading || (!proofReady && !error)) && (
              <div className="absolute inset-0 bg-black/30 rounded-lg flex items-center justify-center">
                <RefreshCw className="w-5 h-5 animate-spin text-white" />
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center text-zinc-600 text-sm">
            No preview available
          </div>
        )}
          </div>
        </div>
      )}
    </div>
  );
}

// LabelOutlineOverlay is defined in @/components/LabelOutlineOverlay
// so the Runs detail page can share the exact same visual treatment.
