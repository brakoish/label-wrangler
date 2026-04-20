'use client';

import { useState, useEffect, useCallback } from 'react';
import { Printer, RefreshCw, Code2 } from 'lucide-react';
import { LabelFormat, LabelTemplate } from '@/lib/types';
import { generateZPL } from '@/lib/zplGenerator';

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
      // dpmm: 203 DPI ≈ 8 dots/mm (203 / 25.4); 300 DPI ≈ 11.8.
      const widthMm = format.width * 25.4;
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
      <div className="flex items-center gap-2 mb-3">
        <Printer className="w-4 h-4 text-amber-400" />
        <span className="text-xs text-zinc-400 uppercase tracking-wider font-semibold">ZPL Preview</span>
        <span className="text-xs text-zinc-500">Local render — actual thermal output</span>

        <div className="ml-auto flex items-center gap-1">
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

      {/* Preview image — fill available space, center, constrain by both dimensions */}
      <div className="flex-1 flex items-center justify-center min-h-0">
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
          <div className="relative max-w-full max-h-full">
            <img
              src={previewUrl}
              alt="ZPL Preview"
              className="max-w-full max-h-full rounded-lg border border-zinc-700/50 bg-white"
              style={{
                imageRendering: 'pixelated',
                objectFit: 'contain',
                maxHeight: '100%',
                // Boost apparent size: display at 2x natural pixel dimensions so
                // a 203-DPI label renders at roughly 0.5x real-world size instead
                // of the tiny native PNG.
                minHeight: '200px',
              }}
            />
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
