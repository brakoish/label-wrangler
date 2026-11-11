'use client';

import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

/** Zoom steps, as a multiple of the size that fits the frame (1 = fit). */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 8;
const step = (zoom: number, by: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(zoom + by).toFixed(2)));

/**
 * One zoom control for the designer's label, the same in Edit and in Print
 * preview: smaller, the size in per cent, bigger, and back to fit.
 */
export function ZoomControl({ zoom, onZoom, className = '' }: { zoom: number; onZoom: (zoom: number) => void; className?: string }) {
  return (
    <div role="group" aria-label="Zoom" className={`flex items-center ${className}`}>
      <button type="button" onClick={() => onZoom(step(zoom, -0.25))} disabled={zoom <= ZOOM_MIN} title="Zoom out" aria-label="Zoom out" className="btn btn-ghost btn-icon btn-sm">
        <ZoomOut className="size-4" aria-hidden="true" />
      </button>
      <span aria-live="polite" className="w-10 text-center text-xs tabular-nums text-zinc-400">{Math.round(zoom * 100)}%</span>
      <button type="button" onClick={() => onZoom(step(zoom, 0.25))} disabled={zoom >= ZOOM_MAX} title="Zoom in" aria-label="Zoom in" className="btn btn-ghost btn-icon btn-sm">
        <ZoomIn className="size-4" aria-hidden="true" />
      </button>
      <button type="button" onClick={() => onZoom(1)} disabled={zoom === 1} title="Fit to view" aria-label="Fit to view" className="btn btn-ghost btn-icon btn-sm">
        <Maximize2 className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
