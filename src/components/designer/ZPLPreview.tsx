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
      const res = await fetch('/api/zpl-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zpl,
          width: format.width,
          height: format.height,
          dpi: format.dpi || 203,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Preview failed');
      }

      const data = await res.json();
      setPreviewUrl(data.image);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setLoading(false);
    }
  }, [zpl, format]);

  // Auto-fetch on mount and when ZPL changes (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPreview();
    }, 800); // Debounce 800ms

    return () => clearTimeout(timer);
  }, [fetchPreview]);

  if (format.type !== 'thermal') return null;

  return (
    <div className="border-t border-zinc-800/50 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <Printer className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">ZPL Preview</span>
        <span className="text-[10px] text-zinc-600">Actual thermal output</span>

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
