'use client';

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { LabelFormat, LabelTemplate } from '@/lib/types';
import { getBitmapProof } from '@/lib/thermal/client';
import { generateZPLWithImages } from '@/lib/zplGenerator';
import { plainRenderWarning } from '@/lib/designerLayout';
import { renderZplToDataUrl, thermalRenderGeometry } from '@/lib/zplRenderClient';
import { PrintControls } from './PrintControls';
import { OfficePreviewPrint } from './OfficePreviewPrint';
import { LabelOutlineOverlay } from '../LabelOutlineOverlay';
import { ZoomControl } from './ZoomControl';
import { useFrameSize } from './useFrameSize';
import { friendlyRenderError, friendlyRenderFailure } from '@/lib/userMessages';

interface ZPLPreviewProps {
  format: LabelFormat;
  template: LabelTemplate;
  testData?: Record<string, string>;
  /** Draw only while this view is showing (the designer's "Print preview"). */
  active?: boolean;
  /** The designer already names the problems above the preview: don't say them twice. */
  problemsShown?: boolean;
  /** The design's problems, shown where the Edit view shows them. */
  notice?: ReactNode;
  /** Zoom shared with the Edit view, so switching views keeps the size. */
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
}

export function ZPLPreview({ format, template, testData, active = true, problemsShown = false, notice, zoom: sharedZoom, onZoomChange }: ZPLPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const signature = JSON.stringify([template, format, testData]);
  const [renderedSignature, setRenderedSignature] = useState('');
  const proofReady = template.thermalRenderMode !== 'bitmap-v1' || (signature === renderedSignature && !loading && !error);
  // Zoom level as multiplier of "fit" size. 1 = fit to container, 2 = double.
  const [ownZoom, setOwnZoom] = useState<number>(1);
  const zoom = sharedZoom ?? ownZoom;
  const setZoom = onZoomChange ?? setOwnZoom;
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

  // Render only while the print preview shows. Local WASM uses a tight
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

  // The label sits in the same frame, at the same size and place, as in the
  // Edit view (LabelPreview): switching views compares, it doesn't jump.
  const frameRef = useRef<HTMLDivElement>(null);
  const frameSize = useFrameSize(frameRef);

  if (format.type !== 'thermal') return null;

  // The same fit as the Edit canvas: the label plus a 10% surround, fitted
  // with a 48px margin (none on a phone, where the frame follows the width
  // and sits on the page's 16px gutter).
  const { linerDots, heightDots } = thermalRenderGeometry(format);
  const labelDots = Math.round(format.width * (format.dpi || 203));
  const padX = labelDots * 0.1, padY = heightDots * 0.1;
  const totalW = linerDots + padX * 2, totalH = heightDots + padY * 2;
  const phone = frameSize.width < 600;
  const margin = phone ? 0 : 48;
  const availW = frameSize.width - margin * 2;
  const availH = phone ? Infinity : frameSize.height - margin * 2;
  const fitW = availW / availH > totalW / totalH ? Math.max(availH, 200) * (totalW / totalH) : Math.max(availW, 200);
  const frameW = fitW * zoom;
  const frameH = frameW * (totalH / totalW);
  const pxPerDot = frameW / totalW;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Desktop: problems and the test print row above the label, in the
          space the Edit view keeps for its notices. Phone: the row goes
          under the label, so the label sits where it does in Edit. */}
      <div className="shrink-0 sm:space-y-1 px-4 pt-2 min-h-12 sm:min-h-16 sm:px-6 max-sm:contents">
        <div className="space-y-1 sm:empty:hidden max-sm:order-1 max-sm:min-h-12 max-sm:px-4 max-sm:pt-2">
          {notice}
          {error && previewUrl && !problemsShown && <p role="status" className="text-sm text-amber-300">Fix this before printing: {error}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 max-sm:order-3 max-sm:px-4 max-sm:pb-4">
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
            <ZoomControl zoom={zoom} onZoom={setZoom} />
          </div>
        </div>
      </div>

      {/* The same box as the Edit canvas; zoomed output scrolls inside it. */}
      <div className="relative flex-1 shrink-0 flex flex-col overflow-hidden max-sm:order-2 min-h-[340px] h-[calc(100dvh-270px)] max-h-[800px] max-sm:h-auto max-sm:min-h-0 max-sm:flex-none">
        <div ref={frameRef} className={`relative flex min-h-0 flex-1 px-4 pb-4 pt-2 sm:px-6 sm:pb-6 ${zoom > 1 ? 'overflow-auto' : 'items-center justify-center'}`}>
          <div
            className="relative m-auto shrink-0 rounded-xl"
            style={{ width: `${frameW}px`, height: `${frameH}px`, background: '#1e1e23', filter: 'drop-shadow(0 8px 30px rgba(0,0,0,0.3))' }}
          >
            {loading && !previewUrl ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">
                <RefreshCw className="mr-2 w-5 h-5 animate-spin" aria-hidden="true" />
                Drawing the label…
              </div>
            ) : error && !previewUrl ? (
              <div role="alert" className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-red-400">
                {error}
              </div>
            ) : previewUrl ? (
              <div className="absolute" style={{ left: `${padX * pxPerDot}px`, top: `${padY * pxPerDot}px`, width: `${linerDots * pxPerDot}px`, height: `${heightDots * pxPerDot}px` }}>
                <img
                  src={previewUrl}
                  alt={error ? 'Print preview, with problems to fix' : 'Print preview'}
                  className="bg-white"
                  style={{ imageRendering: 'pixelated', display: 'block', width: '100%', height: '100%', outline: '1px solid #52525b' }}
                />
                {showOutlines && <LabelOutlineOverlay format={format} />}
                {(loading || (!proofReady && !error)) && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <RefreshCw className="w-5 h-5 animate-spin text-zinc-100" aria-hidden="true" />
                  </div>
                )}
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">Drawing the label…</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// LabelOutlineOverlay is defined in @/components/LabelOutlineOverlay
// so the Runs detail page can share the exact same visual treatment.
