'use client';

import { useState, useEffect, useCallback } from 'react';
import { Printer, RefreshCw, Code2, ZoomIn, ZoomOut, Maximize2, SquareDashed } from 'lucide-react';
import { LabelFormat, LabelTemplate } from '@/lib/types';
import { generateZPL } from '@/lib/zplGenerator';
import { PrintControls } from './PrintControls';

interface ZPLPreviewProps {
  format: LabelFormat;
  template: LabelTemplate;
  testData?: Record<string, string>;
}

// Module-level cache for the WASM ZPL renderer API.
// Lazy-loaded on first ZPLPreview mount to avoid ~8MB bundle cost on page load.
let zplApiPromise: Promise<{ zplToBase64Async: (zpl: string, widthMm?: number, heightMm?: number, dpmm?: number) => Promise<string> }> | null = null;
async function getLocalZplApi() {
  if (!zplApiPromise) {
    zplApiPromise = import('zpl-renderer-js').then(async (m) => {
      const { api } = await m.ready;
      return api;
    });
  }
  return zplApiPromise;
}

export function ZPLPreview({ format, template, testData }: ZPLPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showZPL, setShowZPL] = useState(false);
  // Zoom level as multiplier of "fit" size. 1 = fit to container, 2 = double.
  const [zoom, setZoom] = useState<number>(1);
  // Overlay label outlines so the user can see lane boundaries on multi-across rolls.
  // Default on when labelsAcross > 1 (where it actually helps), off otherwise.
  const [showOutlines, setShowOutlines] = useState<boolean>((format.labelsAcross || 1) > 1);

  const zpl = generateZPL(template, format, testData);

  const fetchPreview = useCallback(async () => {
    if (format.type !== 'thermal') return;

    setLoading(true);
    setError(null);

    try {
      // Render ZPL → PNG entirely in the browser via zpl-renderer-js (Zebrash WASM).
      // No network, no rate limits. 8MB WASM is lazy-loaded once and cached.
      const api = await getLocalZplApi();
      // Our format stores width/height in inches. Convert to mm (1 inch = 25.4 mm).
      // For multi-across rolls we render the full liner width so all N labels
      // appear side-by-side exactly as they'll come off the roll.
      const across = Math.max(1, format.labelsAcross || 1);
      const gapIn = format.horizontalGapThermal || 0;
      const sideIn = format.sideMarginThermal || 0;
      const computedLinerIn = sideIn * 2 + across * format.width + (across - 1) * gapIn;
      const linerIn = format.linerWidth || computedLinerIn;
      const widthMm = linerIn * 25.4;
      const heightMm = format.height * 25.4;
      const dpmm = Math.round((format.dpi || 203) / 25.4);
      const base64 = await api.zplToBase64Async(zpl, widthMm, heightMm, dpmm);
      setPreviewUrl(`data:image/png;base64,${base64}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setLoading(false);
    }
  }, [zpl, format]);

  // Auto-fetch on mount and when ZPL changes. Local WASM — tighter 200ms debounce
  // is fine since there's no network or rate limit.
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPreview();
    }, 200);

    return () => clearTimeout(timer);
  }, [fetchPreview]);

  if (format.type !== 'thermal') return null;

  return (
    <div className="border-t border-zinc-800/50 px-6 py-4 flex flex-col" style={{ minHeight: '40vh' }}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Printer className="w-4 h-4 text-amber-400" />
        <span className="text-xs text-zinc-400 uppercase tracking-wider font-semibold">ZPL Preview</span>
        <span className="text-xs text-zinc-500">Local render — actual thermal output</span>

        <div className="w-px h-4 bg-zinc-800 mx-2" />

        {/* WebUSB test print controls — connect, print current template, calibration. */}
        <PrintControls format={format} template={template} testData={testData} />

        <div className="ml-auto flex items-center gap-1">
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
        </div>
      </div>

      {/* ZPL Code view */}
      {showZPL && (
        <div className="mb-3 p-3 bg-zinc-950 rounded-lg border border-zinc-800/50 max-h-[200px] overflow-auto">
          <pre className="text-[10px] text-green-400 font-mono whitespace-pre-wrap break-all">{zpl}</pre>
        </div>
      )}

      {/* Preview image — fill available space, center, constrain by both dimensions.
          overflow-auto so when zoomed beyond fit the user can pan horizontally/vertically. */}
      <div className="flex-1 flex items-center justify-center min-h-0 overflow-auto">
        {loading && !previewUrl ? (
          <div className="flex items-center justify-center text-zinc-500 text-sm">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            Rendering…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center text-red-400 text-sm">
            {error}
          </div>
        ) : previewUrl ? (
          <div className="relative inline-block" style={{ padding: '4px' }}>
            {/* At zoom=1 the image fits its container (max-w/h 100%).
                At zoom>1 it grows past container bounds and parent scrolls. */}
            <img
              src={previewUrl}
              alt="ZPL Preview"
              className="rounded-lg border border-zinc-700/50"
              style={{
                // Native-DPI render — keep pixelated for sharp bitmap-font edges;
                // zoom handles bigger size when user wants to inspect details.
                imageRendering: 'pixelated',
                display: 'block',
                maxWidth: zoom === 1 ? '100%' : 'none',
                maxHeight: zoom === 1 ? '100%' : 'none',
                width: zoom === 1 ? 'auto' : `${zoom * 100}%`,
                height: 'auto',
              }}
            />
            {showOutlines && <LabelOutlineOverlay format={format} />}
            {loading && (
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
  );
}

/**
 * Transparent SVG overlay that draws each label's boundary on top of the
 * rendered ZPL preview. Sits absolutely positioned over the <img> and uses
 * the liner dimensions as its viewBox, so label outlines land exactly over
 * each printed label regardless of zoom.
 *
 * Preview-only — does not affect the ZPL sent to the printer.
 */
function LabelOutlineOverlay({ format }: { format: LabelFormat }) {
  const across = Math.max(1, format.labelsAcross || 1);
  const labelW = format.width;
  const labelH = format.height;
  const gap = format.horizontalGapThermal || 0;
  const sideM = format.sideMarginThermal || 0;
  const computedLiner = sideM * 2 + across * labelW + (across - 1) * gap;
  const linerW = format.linerWidth || computedLiner;
  const effectiveSideM = sideM > 0
    ? sideM
    : Math.max(0, (linerW - (across * labelW + (across - 1) * gap)) / 2);
  // Stroke scales with label size so it reads on both tiny 0.5" and big 4x6" labels.
  const stroke = Math.max(0.005, Math.min(labelW, labelH) * 0.015);
  const labelPillRadius = Math.min(labelW, labelH) * 0.08;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      viewBox={`0 0 ${linerW} ${labelH}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: '100%', padding: '4px' }}
    >
      {/* One dashed rectangle per across-lane, positioned at the same
          sideMargin + lane*(labelW+gap) origin used by generateZPL. */}
      {Array.from({ length: across }).map((_, lane) => {
        const x = effectiveSideM + lane * (labelW + gap);
        return (
          <g key={lane}>
            <rect
              x={x}
              y={0}
              width={labelW}
              height={labelH}
              fill="none"
              stroke="#d97706"
              strokeOpacity={0.8}
              strokeWidth={stroke}
              strokeDasharray={`${stroke * 4} ${stroke * 2}`}
              rx={labelPillRadius}
              ry={labelPillRadius}
            />
            {across > 1 && (
              <text
                x={x + labelW / 2}
                y={stroke * 4}
                fontSize={labelH * 0.12}
                fill="#d97706"
                fillOpacity={0.7}
                textAnchor="middle"
                dominantBaseline="hanging"
                style={{ fontFamily: 'ui-sans-serif, system-ui' }}
              >
                L{lane + 1}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
