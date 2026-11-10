'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Printer, RefreshCw, Code2, ZoomIn, ZoomOut, Maximize2, SquareDashed, ChevronDown } from 'lucide-react';
import { LabelFormat, LabelTemplate } from '@/lib/types';
import { getBitmapProof } from '@/lib/thermal/client';
import { generateZPLWithImages } from '@/lib/zplGenerator';
import { plainRenderWarning } from '@/lib/designerLayout';
import { renderZplToDataUrl } from '@/lib/zplRenderClient';
import { PrintControls } from './PrintControls';
import { OfficePreviewPrint } from './OfficePreviewPrint';
import { LabelOutlineOverlay } from '../LabelOutlineOverlay';
import { friendlyError, friendlyRenderError } from '@/lib/userMessages';

interface ZPLPreviewProps {
  format: LabelFormat;
  template: LabelTemplate;
  testData?: Record<string, string>;
  /** The raw printer commands, for admins who set up printers. */
  showPrinterCode?: boolean;
}

export function ZPLPreview({ format, template, testData, showPrinterCode = false }: ZPLPreviewProps) {
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
      setZpl(nextZpl); setPreviewUrl(url); setRenderedSignature(signature);
    } catch (err) {
      if (token !== revision.current) return;
      setError(plainRenderWarning(friendlyError(err, 'The preview could not be drawn.'), (m) => friendlyRenderError(m, template.elements, format.labelsAcross || 1, testData, format)));
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
    <div className="flex flex-col shrink-0">
      <div className="flex items-center gap-2 px-4 py-2 flex-wrap sm:px-6">
        <Printer className="w-4 h-4 text-zinc-500 max-sm:hidden" aria-hidden="true" />
        <button
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md text-left min-h-control-sm"
        >
          <span className="text-sm text-zinc-100 font-medium">Print preview</span>
          <span className="text-xs text-zinc-400 max-sm:hidden">Exactly what the printer makes</span>
          <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
        </button>


        {/* WebUSB test print controls — connect, print current template, calibration. */}
        {expanded && <OfficePreviewPrint key={template.id} format={format} template={template} testData={testData} />}
        {expanded && <PrintControls format={format} template={template} testData={testData} proofReady={proofReady} />}

        {expanded && <div className="ml-auto flex items-center">
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
          {(format.labelsAcross || 1) > 1 && <button
            onClick={() => setShowOutlines((s) => !s)}
            title={showOutlines ? 'Hide label edges' : 'Show label edges'}
            aria-label="Show label edges"
            aria-pressed={showOutlines}
            className={`btn btn-ghost btn-icon btn-sm ${showOutlines ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'}`}
          >
            <SquareDashed className="w-4 h-4" />
          </button>}
        </div>}
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1 flex flex-col sm:px-6" style={{ minHeight: '320px', maxHeight: '65vh' }}>
          {error && previewUrl && <p role="status" className="text-sm text-amber-400 mb-2">Fix this before printing: {error}</p>}
          {/* The print image opens large enough to inspect alignment. Zoomed
              output can scroll without shrinking the design canvas above. */}
          <div className="flex-1 flex items-center justify-center min-h-0 overflow-auto">
        {loading && !previewUrl ? (
          <div className="flex items-center justify-center text-zinc-500 text-sm">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            Drawing the preview…
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
              alt={error ? 'Print preview, with problems to fix' : 'Print preview'}
              className="rounded-md"
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
          <div className="flex items-center justify-center text-zinc-500 text-sm">
            No preview yet
          </div>
        )}
          </div>
          {/* The raw printer commands, for admins who set up printers. */}
          {showPrinterCode && <button type="button" onClick={() => setShowZPL(!showZPL)} aria-expanded={showZPL} className="mt-2 inline-flex min-h-control-sm items-center gap-1.5 self-start text-xs text-zinc-400 hover:text-zinc-100">
            <Code2 className="size-3.5" aria-hidden="true" />{showZPL ? 'Hide the printer commands' : 'Printer setup (admins): show the commands sent to the printer'}
          </button>}
          {showPrinterCode && showZPL && (
            <div className="mt-2 max-h-[200px] overflow-auto rounded-lg bg-zinc-950 p-3">
              <pre className="text-xs text-zinc-300 font-mono whitespace-pre-wrap break-all">{zpl}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// LabelOutlineOverlay is defined in @/components/LabelOutlineOverlay
// so the Runs detail page can share the exact same visual treatment.
