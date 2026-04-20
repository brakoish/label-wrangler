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
    <div className="border-t border-zinc-800/50 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <Printer className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">ZPL Preview</span>
        <span className="text-[10px] text-zinc-600">Local render — actual thermal output</span>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setShowZPL(!showZPL)}
            title="View ZPL code"
            className={`p-1 rounded-md transition-colors ${showZPL ? 'text-amber-400 bg-amber-500/10' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            <Code2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={fetchPreview}
            disabled={loading}
            title="Refresh preview"
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ZPL Code view */}
      {showZPL && (
        <div className="mb-3 p-3 bg-zinc-950 rounded-lg border border-zinc-800/50 max-h-[200px] overflow-auto">
          <pre className="text-[10px] text-green-400 font-mono whitespace-pre-wrap break-all">{zpl}</pre>
        </div>
      )}

      {/* Preview image */}
      <div className="flex justify-center">
        {loading && !previewUrl ? (
          <div className="h-[100px] flex items-center justify-center text-zinc-500 text-xs">
            <RefreshCw className="w-4 h-4 animate-spin mr-2" />
            Rendering...
          </div>
        ) : error ? (
          <div className="h-[100px] flex items-center justify-center text-red-400 text-xs">
            {error}
          </div>
        ) : previewUrl ? (
          <div className="relative">
            <img
              src={previewUrl}
              alt="ZPL Preview"
              className="w-full rounded-lg border border-zinc-700/50"
              style={{ imageRendering: 'pixelated' }}
            />
            {loading && (
              <div className="absolute inset-0 bg-black/30 rounded-lg flex items-center justify-center">
                <RefreshCw className="w-4 h-4 animate-spin text-white" />
              </div>
            )}
          </div>
        ) : (
          <div className="h-[100px] flex items-center justify-center text-zinc-600 text-xs">
            No preview available
          </div>
        )}
      </div>
    </div>
  );
}
