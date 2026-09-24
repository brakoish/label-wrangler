'use client';

import { useEffect, useRef, useState, useCallback, useId, useMemo } from 'react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { LabelFormat, TemplateElement, TextElement, QRElement, BarcodeElement, LineElement, RectangleElement, ImageElement } from '@/lib/types';
import { getBitmapProof, type EditorLayer } from '@/lib/thermal/client';
import { nearestSnap, resizeArtwork, artworkBounds } from '@/lib/thermal/editorGeometry';
import { generateZPL, snapZplQrSize } from '@/lib/zplGenerator';
import { renderZplToDataUrl, thermalRenderGeometry } from '@/lib/zplRenderClient';
import { layoutThermalText, wrapThermalText } from '@/lib/thermalTextLayout';

interface LabelPreviewProps {
  format: LabelFormat;
  elements: TemplateElement[];
  selectedElementIds: Set<string>;
  editorOrientation?: 'printer' | 'upright';
  onSelectElement: (id: string | null, addToSelection?: boolean) => void;
  onUpdateElement?: (id: string, updates: Partial<TemplateElement>) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  testData?: Record<string, string>;
  thermalRenderMode?: 'native-v1' | 'bitmap-v1';
  onSelectElements?: (ids: string[]) => void;
  onDuplicateSelection?: (ids: Set<string>) => TemplateElement[];
  onGestureCancel?: () => void;
}

export function LabelPreview({ format, elements, selectedElementIds, editorOrientation = 'printer', onSelectElement, onUpdateElement, onDragStart, onDragEnd, testData, thermalRenderMode, onSelectElements, onDuplicateSelection, onGestureCancel }: LabelPreviewProps) {
  const bitmap = format.type === 'thermal' && thermalRenderMode === 'bitmap-v1';
  const [bitmapProof, setBitmapProof] = useState<{ key: string; url: string; elements: TemplateElement[]; layers: EditorLayer[]; qrInkBounds: Record<string, { x: number; y: number; width: number; height: number }>; qrBounds: Record<string, { x: number; y: number; width: number; height: number }>; warnings: Array<{ elementId: string; message: string }> } | null>(null);
  // Keep editor artwork attached to the current gesture, not a delayed HTTP result.
  const liveBounds = useCallback((id: string, bounds: { x: number; y: number; width: number; height: number } | undefined) => {
    const old = bitmapProof?.elements.find(e => e.id === id), current = elements.find(e => e.id === id);
    if (!bounds || !old || !current) return bounds;
    const sx = current.width / old.width, sy = current.height / old.height;
    return { x: current.x + (bounds.x - old.x) * sx, y: current.y + (bounds.y - old.y) * sy, width: bounds.width * sx, height: bounds.height * sy };
  }, [bitmapProof, elements]);
  const [bitmapError, setBitmapError] = useState('');
  const bitmapKey = JSON.stringify([elements, format, testData]);
  const [editing, setEditing] = useState<{ id: string; value: string; bound: boolean; field: string; left: number; top: number; width: number; height: number } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; endX: number; endY: number; initial: string[] } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    if (!bitmap) return;
    let active = true; setBitmapError('');
    const timer = setTimeout(() => {
      getBitmapProof({ id: 'editor', name: '', formatId: format.id, elements, thermalRenderMode: 'bitmap-v1', createdAt: '', updatedAt: '' }, format, testData ?? {}, true)
        .then(result => { if (active) setBitmapProof({ key: bitmapKey, url: result.proof, elements, layers: result.editorLayers || [], warnings: result.warnings || [], qrBounds: result.qrBounds || {}, qrInkBounds: result.qrInkBounds || {} }); })
        .catch(error => { if (active) setBitmapError(error.message); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [bitmap, bitmapKey, elements, format, testData]);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 600, height: 400 });
  const [dragging, setDragging] = useState<{
    elementId: string;
    startX: number;
    startY: number;
    origPositions: Map<string, { x: number; y: number }>;
  } | null>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const [measuredTextBounds, setTextBounds] = useState<Record<string, { w: number; h: number }>>({});

  const textBounds = useMemo(() => bitmap ? {} : measuredTextBounds, [bitmap, measuredTextBounds]);

  const handleTextMeasure = useCallback((id: string, w: number, h: number) => {
    setTextBounds((prev) => {
      if (prev[id]?.w === w && prev[id]?.h === h) return prev;
      return { ...prev, [id]: { w, h } };
    });
  }, []);

  // Observe container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerSize({ width, height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const viewBoxWidth = format.type === 'thermal' && format.dpi
    ? format.width * format.dpi
    : format.width;

  const viewBoxHeight = format.type === 'thermal' && format.dpi
    ? format.height * format.dpi
    : format.height;
  const useUprightThermalEditor = editorOrientation === 'upright' && format.type === 'thermal' && viewBoxWidth > viewBoxHeight;
  const editorViewBoxWidth = useUprightThermalEditor ? viewBoxHeight : viewBoxWidth;
  const editorViewBoxHeight = useUprightThermalEditor ? viewBoxWidth : viewBoxHeight;
  const editorContentTransform = useUprightThermalEditor
    ? `translate(0 ${viewBoxWidth}) rotate(-90)`
    : undefined;

  const sortedElements = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  // Padding
  const padFraction = 0.1;
  const padX = editorViewBoxWidth * padFraction;
  const padY = editorViewBoxHeight * padFraction;
  const totalW = editorViewBoxWidth + padX * 2;
  const totalH = editorViewBoxHeight + padY * 2;
  const labelPadX = viewBoxWidth * padFraction;
  const labelPadY = viewBoxHeight * padFraction;

  // SVG pixel size
  const margin = 48;
  const availW = containerSize.width - margin * 2;
  const availH = containerSize.height - margin * 2;
  const aspect = totalW / totalH;
  let svgW: number;
  let svgH: number;

  if (availW / availH > aspect) {
    svgH = Math.max(availH, 200);
    svgW = svgH * aspect;
  } else {
    svgW = Math.max(availW, 200);
    svgH = svgW / aspect;
  }

  // Convert screen pixels to SVG viewBox units
  const screenToSvg = useCallback((screenDx: number, screenDy: number) => {
    const displayDx = (screenDx / svgW) * totalW;
    const displayDy = (screenDy / svgH) * totalH;

    if (useUprightThermalEditor) {
      return {
        dx: -displayDy,
        dy: displayDx,
      };
    }

    return { dx: displayDx, dy: displayDy };
  }, [svgW, svgH, totalW, totalH, useUprightThermalEditor]);

  const beginText = useCallback((id: string) => {
    const element = elements.find((e): e is TextElement => e.id === id && e.type === 'text');
    if (!element || format.type !== 'thermal' || !svgRef.current) return;
    const node = svgRef.current.querySelector(`[data-element-id="${CSS.escape(id)}"]`);
    const rect = node?.getBoundingClientRect();
    if (!rect) return;
    onDragStart?.();
    setEditing({ id, value: element.isStatic ? element.content : element.defaultValue || '', bound: !element.isStatic, field: element.fieldName || 'field', left: rect.left, top: rect.top, width: Math.max(180, rect.width), height: Math.max(90, rect.height) });
  }, [elements, format.type, onDragStart]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (e.key === 'Enter' && selectedElementIds.size === 1) { e.preventDefault(); beginText([...selectedElementIds][0]); }
      if (e.key === 'Escape') { setDragging(null); setMarquee(null); setGuides({ x: [], y: [] }); onGestureCancel?.(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [selectedElementIds, beginText, onGestureCancel]);
  const pointInLabel = (clientX: number, clientY: number) => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return useUprightThermalEditor ? { x: viewBoxWidth - point.y, y: point.x } : { x: point.x, y: point.y };
  };
  const startMarquee = (e: React.PointerEvent) => {
    if (format.type !== 'thermal' || !onSelectElements) return;
    e.preventDefault(); suppressClick.current = true;
    const p = pointInLabel(e.clientX, e.clientY);
    setMarquee({ x: p.x, y: p.y, endX: p.x, endY: p.y, initial: e.shiftKey ? [...selectedElementIds] : [] });
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  // Drag handlers
  const handlePointerDown = useCallback((e: React.PointerEvent, elementId: string) => {
    if (!onUpdateElement) return;
    e.stopPropagation();
    e.preventDefault();

    let element = elements.find((el) => el.id === elementId);
    if (!element) return;

    // Shift-click: toggle selection, don't drag
    if (e.shiftKey) {
      onSelectElement(elementId, true);
      return;
    }

    // If clicking an already-selected element in a group, keep the group
    // If clicking an unselected element, single-select it
    if (!selectedElementIds.has(elementId)) {
      onSelectElement(elementId, false);
    }

    onDragStart?.();

    // Snapshot original positions of ALL elements being dragged
    let dragIds = selectedElementIds.has(elementId) ? selectedElementIds : new Set([elementId]);
    let dragElements = elements;
    if (e.altKey && onDuplicateSelection && format.type === 'thermal') {
      const originals = elements.filter(el => dragIds.has(el.id));
      const copies = onDuplicateSelection(dragIds);
      const index = originals.findIndex(el => el.id === elementId);
      element = copies[index]; elementId = element.id;
      dragIds = new Set(copies.map(el => el.id)); dragElements = copies;
    }
    const origPositions = new Map<string, { x: number; y: number }>();
    for (const id of dragIds) {
      const el = dragElements.find((e) => e.id === id);
      if (el) origPositions.set(id, { x: el.x, y: el.y });
    }

    setDragging({
      elementId,
      startX: e.clientX,
      startY: e.clientY,
      origPositions,
    });

    (e.target as Element).setPointerCapture(e.pointerId);
  }, [elements, onSelectElement, onUpdateElement, onDragStart, selectedElementIds, onDuplicateSelection, format.type]);

  // Resize via window-level listeners (pointer capture on child rects doesn't bubble to SVG)
  const handleResizeDown = useCallback((e: React.PointerEvent, elementId: string, handle: string) => {
    if (!onUpdateElement) return;
    e.stopPropagation();
    e.preventDefault();

    const element = elements.find((el) => el.id === elementId);
    if (!element) return;

    onDragStart?.();

    const startX = e.clientX;
    const startY = e.clientY;
    const origX = element.x;
    const origY = element.y;
    const origW = element.width;
    const origH = element.height;
    const isQR = element.type === 'qr';
    const isText = element.type === 'text';
    const origFontSize = isText ? (element as TextElement).fontSize : 0;
    const isThermal = format.type === 'thermal';
    const dpi = format.dpi || 203;

    // Multi-select resize: snapshot all selected elements for group scaling.
    // For text elements, use rendered textBounds (if measured) so the group
    // bbox reflects what the user actually sees.
    const isMultiResize = selectedElementIds.size > 1 && selectedElementIds.has(elementId);
    const getEffectiveBounds = (el: TemplateElement) => elementInteractionBounds(el, textBounds);
    const selectedSnapshots = isMultiResize ? new Map(
      elements
        .filter((el) => selectedElementIds.has(el.id))
        .map((el) => {
          const bounds = getEffectiveBounds(el);
          return [el.id, {
            x: el.x, y: el.y, width: el.width, height: el.height,
            bounds,
            fontSize: el.type === 'text' ? el.fontSize : 0,
            type: el.type,
          }] as const;
        })
    ) : null;

    // Compute group bounding box from EFFECTIVE (rendered) bounds for anchor point
    let groupBBox: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
    if (selectedSnapshots) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const snap of selectedSnapshots.values()) {
        minX = Math.min(minX, snap.bounds.x);
        minY = Math.min(minY, snap.bounds.y);
        maxX = Math.max(maxX, snap.bounds.x + snap.bounds.width);
        maxY = Math.max(maxY, snap.bounds.y + snap.bounds.height);
      }
      groupBBox = { minX, minY, maxX, maxY };
    }

    // Determine grabbed corner and anchor corner (opposite of the handle).
    // For multi-select, use the GROUP bounding box. For single, use the element itself.
    const gbX = groupBBox?.minX ?? origX;
    const gbY = groupBBox?.minY ?? origY;
    const gbRight = groupBBox?.maxX ?? (origX + origW);
    const gbBottom = groupBBox?.maxY ?? (origY + origH);
    const grabbedCornerX = handle.includes('w') ? gbX : gbRight;
    const grabbedCornerY = handle.includes('n') ? gbY : gbBottom;
    const anchorX = handle.includes('e') ? gbX
                  : handle.includes('w') ? gbRight
                  : gbX;
    const anchorY = handle.includes('s') ? gbY
                  : handle.includes('n') ? gbBottom
                  : gbY;
    // Distance from anchor to the grabbed handle at start (in viewBox units).
    // We use this to translate pointer motion into a group scale factor
    // that is independent of the primary element's own width/height.
    const grabDistX = Math.abs(grabbedCornerX - anchorX) || 1;
    const grabDistY = Math.abs(grabbedCornerY - anchorY) || 1;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const { dx: svgDx, dy: svgDy } = screenToSvg(dx, dy);

      if (isThermal && !isMultiResize) {
        const ink = bitmap && element.type === 'qr' ? liveBounds(element.id, bitmapProof?.qrInkBounds[element.id]) : undefined;
        if (ink) {
          const resized = resizeArtwork({ ...element, ...ink, rotation: 0 }, handle, svgDx, svgDy, false);
          const scale = (resized.width ?? ink.width) / ink.width;
          onUpdateElement(elementId, { x: (resized.x ?? ink.x) + (element.x - ink.x) * scale, y: (resized.y ?? ink.y) + (element.y - ink.y) * scale, width: element.width * scale, height: element.height * scale });
        } else onUpdateElement(elementId, resizeArtwork(element, handle, svgDx, svgDy, ev.shiftKey));
        return;
      }

      let nX = origX;
      let nY = origY;
      let nW = origW;
      let nH = origH;

      if (handle.includes('e')) nW = Math.max(0.01, origW + svgDx);
      if (handle.includes('w')) { nW = Math.max(0.01, origW - svgDx); nX = origX + (origW - nW); }
      if (handle.includes('s')) nH = Math.max(0.01, origH + svgDy);
      if (handle.includes('n')) { nH = Math.max(0.01, origH - svgDy); nY = origY + (origH - nH); }

      // QR: keep square on corner handles
      if (isQR && handle.length === 2) {
        const qr = element as QRElement;
        const requestedSize = Math.max(nW, nH);
        const content = resolveElementContent(qr, testData) || 'QR';
        const size = format.type === 'thermal' && !bitmap
          ? snapZplQrSize(content, qr.errorCorrection || 'M', requestedSize)
          : requestedSize;
        if (handle.includes('w')) nX = origX + origW - size;
        if (handle.includes('n')) nY = origY + origH - size;
        nW = size;
        nH = size;
      }

      // Multi-select group resize: scale by pointer distance from the anchor,
      // not by the primary element's own dimensions (those can be misleading
      // for text whose rendered size ≠ stored width).
      if (isMultiResize && selectedSnapshots) {
        // Current pointer position in viewBox coords relative to anchor.
        const pointerX = grabbedCornerX + svgDx;
        const pointerY = grabbedCornerY + svgDy;
        const newDistX = Math.abs(pointerX - anchorX);
        const newDistY = Math.abs(pointerY - anchorY);
        const groupScaleX = newDistX / grabDistX;
        const groupScaleY = newDistY / grabDistY;
        // Uniform scale (min keeps everything inside the drag envelope;
        // using min avoids runaway growth when one axis is tiny).
        const uniform = Math.max(0.1, handle.length === 2 ? Math.min(groupScaleX, groupScaleY) : /[ew]/.test(handle) ? groupScaleX : groupScaleY);

        for (const [id, snap] of selectedSnapshots) {
          // Scale position relative to anchor
          const relX = snap.x - anchorX;
          const relY = snap.y - anchorY;
          const newElX = anchorX + relX * uniform;
          const newElY = anchorY + relY * uniform;
          const newElW = snap.width * uniform;
          const newElH = snap.height * uniform;

          if (snap.type === 'text') {
            const newFs = Math.max(4, Math.round(snap.fontSize * uniform * 10) / 10);
            const svgFs = isThermal ? newFs * (dpi / 72) : newFs / 72;
            onUpdateElement(id, { x: newElX, y: newElY, width: newElW, height: isThermal ? newElH : svgFs * 1.2, fontSize: isThermal && !ev.shiftKey ? snap.fontSize : newFs });
          } else if (snap.type === 'qr') {
            const qr = elements.find((el): el is QRElement => el.id === id && el.type === 'qr');
            const requestedSize = Math.max(newElW, newElH);
            const qrSize = format.type === 'thermal' && !bitmap && qr
              ? snapZplQrSize(resolveElementContent(qr, testData) || 'QR', qr.errorCorrection || 'M', requestedSize)
              : requestedSize;
            onUpdateElement(id, { x: newElX, y: newElY, width: qrSize, height: qrSize });
          } else {
            onUpdateElement(id, { x: newElX, y: newElY, width: newElW, height: newElH });
          }
        }
        return;
      }

      // Single element text resize: corner handles scale font size proportionally
      if (isText && handle.length === 2 && (!isThermal || ev.shiftKey)) {
        const scale = Math.max(nW / origW, nH / origH);
        const newFontSize = Math.max(4, Math.round(origFontSize * scale * 10) / 10);
        // Convert fontSize to viewBox units for height calc
        const svgFs = isThermal ? newFontSize * (dpi / 72) : newFontSize / 72;
        nH = isThermal ? Math.max(1, origH * scale) : svgFs * 1.2;
        onUpdateElement(elementId, { x: nX, y: nY, width: nW, height: nH, fontSize: newFontSize });
        return;
      }

      onUpdateElement(elementId, { x: nX, y: nY, width: nW, height: nH });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      onDragEnd?.();
    };

    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('keydown', onKey); onGestureCancel?.(); } };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [elements, onUpdateElement, screenToSvg, selectedElementIds, onDragStart, onDragEnd, format, textBounds, testData, bitmap, bitmapProof, liveBounds, onGestureCancel]);

  // Snap threshold in viewBox units (~2% of smallest dimension)
  const snapThreshold = format.type === 'thermal' ? 6 * totalW / svgW : Math.min(viewBoxWidth, viewBoxHeight) * 0.02;

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !onUpdateElement) return;

    const dx = e.clientX - dragging.startX;
    const dy = e.clientY - dragging.startY;
    let { dx: svgDx, dy: svgDy } = screenToSvg(dx, dy);
    if (e.shiftKey && format.type === 'thermal') { if (Math.abs(svgDx) > Math.abs(svgDy)) svgDy = 0; else svgDx = 0; }

    const primaryOrig = dragging.origPositions.get(dragging.elementId);
    if (!primaryOrig) return;
    const draggedEl = elements.find((el) => el.id === dragging.elementId);
    if (!draggedEl) return;

    let rawX = primaryOrig.x + svgDx;
    let rawY = primaryOrig.y + svgDy;

    // Build snap targets from label edges, center, and other elements
    const xTargets: number[] = [0, viewBoxWidth / 2, viewBoxWidth]; // left, center, right of label
    const yTargets: number[] = [0, viewBoxHeight / 2, viewBoxHeight]; // top, center, bottom of label

    for (const el of elements) {
      if (dragging.origPositions.has(el.id)) continue;
      // Other element edges and centers
      const b = artworkBounds(el);
      xTargets.push(b.x, b.x + b.width / 2, b.x + b.width);
      yTargets.push(b.y, b.y + b.height / 2, b.y + b.height);
    }

    // Snap points for the dragged element: left edge, center, right edge
    const b = artworkBounds({ ...draggedEl, x: rawX, y: rawY });
    const elEdgesX = [b.x, b.x + b.width / 2, b.x + b.width];
    const elEdgesY = [b.y, b.y + b.height / 2, b.y + b.height];

    const activeGuideX: number[] = [];
    const activeGuideY: number[] = [];

    if (!e.ctrlKey && !e.metaKey) {
      const x = nearestSnap(elEdgesX, xTargets, snapThreshold), y = nearestSnap(elEdgesY, yTargets, snapThreshold);
      if (x.guide !== undefined && !(e.shiftKey && svgDx === 0)) { rawX += x.delta; activeGuideX.push(x.guide); }
      if (y.guide !== undefined && !(e.shiftKey && svgDy === 0)) { rawY += y.delta; activeGuideY.push(y.guide); }
    }

    setGuides({ x: activeGuideX, y: activeGuideY });

    // Move all dragged elements by the same delta
    // The primary element gets snap-adjusted position, others follow the raw delta
    const snapDx = rawX - primaryOrig.x;
    const snapDy = rawY - primaryOrig.y;
    for (const [id, orig] of dragging.origPositions) {
      onUpdateElement(id, { x: orig.x + snapDx, y: orig.y + snapDy });
    }
  }, [dragging, onUpdateElement, screenToSvg, elements, viewBoxWidth, viewBoxHeight, snapThreshold, format.type]);

  const handlePointerUp = useCallback(() => {
    if (dragging) {
      onDragEnd?.();
    }
    setDragging(null);
    setGuides({ x: [], y: [] });
  }, [dragging, onDragEnd]);

  const badQr = bitmapProof?.key === bitmapKey ? elements.find(e => e.type === 'qr' && bitmapProof.warnings.some(w => w.elementId === e.id) && bitmapProof.qrBounds[e.id]) : undefined;
  const badQrBounds = badQr && bitmapProof?.qrBounds[badQr.id];
  const canFitQr = badQrBounds && badQrBounds.width <= viewBoxWidth && badQrBounds.height <= viewBoxHeight;
  return (
    <div ref={containerRef} className="relative flex items-center justify-center p-6 overflow-hidden" style={{ minHeight: '420px', height: '65vh', maxHeight: '720px' }}>
      {bitmap && <p role="status" className={`absolute top-1 left-3 right-3 text-xs ${bitmapError ? 'text-red-400' : 'text-zinc-400'}`}>{bitmapError ? `Editing approximation — printing blocked: ${bitmapError}` : (bitmapProof?.key === bitmapKey ? bitmapProof.warnings.length ? `Fix highlighted objects before printing: ${bitmapProof.warnings[0].message}` : 'Exact bitmap artwork · double-click text to edit' : 'Live editing preview · updating print proof…')}</p>}
      {badQr && badQrBounds && canFitQr && onUpdateElement && <button className="absolute top-8 left-3 z-10 rounded bg-amber-500 px-2 py-1 text-xs text-black" onClick={() => {
        onDragStart?.();
        onUpdateElement(badQr.id, { x: badQr.x + Math.max(0, Math.min(viewBoxWidth - badQrBounds.width, badQrBounds.x)) - badQrBounds.x, y: badQr.y + Math.max(0, Math.min(viewBoxHeight - badQrBounds.height, badQrBounds.y)) - badQrBounds.y });
        onDragEnd?.();
      }}>Fit QR inside label</button>}
      {editing && <div className="fixed z-40 bg-zinc-950 border border-amber-400 rounded p-2" style={{ left: Math.max(0, Math.min(editing.left, window.innerWidth - editing.width - 20)), top: Math.max(0, Math.min(editing.top, window.innerHeight - editing.height - 70)), width: editing.width + 16 }}>
        <p className="text-xs text-amber-400 mb-1">{editing.bound ? `Default for ${editing.field} (binding preserved)` : 'Edit text'} · Ctrl/⌘ Enter saves · Esc cancels</p>
        <textarea aria-label="Inline label text" autoFocus value={editing.value} style={{ width: '100%', height: editing.height }} className="bg-white text-black p-1 resize-none" onChange={e => { const value = e.target.value; setEditing({ ...editing, value }); onUpdateElement?.(editing.id, editing.bound ? { defaultValue: value } : { content: value }); }} onBlur={() => { onDragEnd?.(); setEditing(null); }} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); onGestureCancel?.(); setEditing(null); } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onDragEnd?.(); setEditing(null); } }} />
      </div>}
      <svg
        ref={svgRef}
        width={svgW}
        height={svgH}
        viewBox={`${-padX} ${-padY} ${totalW} ${totalH}`}
        className="rounded-2xl"
        style={{
          filter: 'drop-shadow(0 8px 30px rgba(0,0,0,0.3))',
          userSelect: 'none',
        }}
        onPointerMove={e => {
          if (marquee) { const p = pointInLabel(e.clientX, e.clientY); setMarquee({ ...marquee, endX: p.x, endY: p.y }); }
          else handlePointerMove(e);
        }}
        onPointerUp={() => {
          if (marquee) {
            const x = Math.min(marquee.x, marquee.endX), y = Math.min(marquee.y, marquee.endY), w = Math.abs(marquee.x - marquee.endX), h = Math.abs(marquee.y - marquee.endY);
            const hit = w + h < 2 ? [] : elements.filter(el => { const b = elementInteractionBounds(el, textBounds); return b.x < x + w && b.x + b.width > x && b.y < y + h && b.y + b.height > y; }).map(el => el.id);
            onSelectElements?.([...new Set([...marquee.initial, ...hit])]); setMarquee(null);
          }
          handlePointerUp();
        }}
      >
        {/* Dark surround — click to deselect */}
        <rect
          x={-padX}
          y={-padY}
          width={totalW}
          height={totalH}
          fill="#1e1e23"
          rx={Math.min(padX, padY) * 0.4}
          onPointerDown={startMarquee}
          onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onSelectElement(null); }}
        />

        {/* Label surface — click to deselect */}
        <g transform={editorContentTransform}>
          <rect
            x={0}
            y={0}
            width={viewBoxWidth}
            height={viewBoxHeight}
            fill={format.type === 'thermal' ? '#ffffff' : '#fafafa'}
            stroke="#52525b"
            strokeWidth={Math.min(viewBoxWidth, viewBoxHeight) * 0.004}
            rx={Math.min(viewBoxWidth, viewBoxHeight) * 0.008}
            onPointerDown={startMarquee}
          onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onSelectElement(null); }}
          />

          {bitmap && bitmapProof && !bitmapError && <svg x={0} y={0} width={viewBoxWidth} height={viewBoxHeight} viewBox={`${thermalRenderGeometry(format).effectiveSideMDots} 0 ${viewBoxWidth} ${viewBoxHeight}`} pointerEvents="none" >
            {bitmapProof.key !== bitmapKey && bitmapProof.layers.length > 0 ? <g transform={`translate(${thermalRenderGeometry(format).effectiveSideMDots} 0)`}>
              {bitmapProof.layers.map(layer => {
                if (!elements.some(e => e.id === layer.elementId)) return null;
                const b = liveBounds(layer.elementId, layer)!;
                return <image data-live-layer={layer.elementId} key={layer.elementId} href={layer.url} x={b.x} y={b.y} width={b.width} height={b.height} preserveAspectRatio="none" style={{ imageRendering: 'pixelated' }} />;
              })}
            </g> : <image href={bitmapProof.url} width={thermalRenderGeometry(format).linerDots} height={thermalRenderGeometry(format).heightDots} style={{ imageRendering: 'pixelated' }} />}
          </svg>}
          {/* Elements */}
          <g>
            {sortedElements.map((element) => (
              <g
                key={element.id}
                data-element-id={element.id}
                onDoubleClick={e => { e.stopPropagation(); beginText(element.id); }}
                onPointerDown={(e) => handlePointerDown(e, element.id)}
                style={{ cursor: dragging?.elementId === element.id ? 'grabbing' : 'grab' }}
              >
                <g pointerEvents="none">
                  {(!bitmap || !!bitmapError) && renderElement(element, format, elements, handleTextMeasure, testData)}
                </g>
                {/* Hit area — invisible rect that ensures small/thin elements are still draggable */}
                {(() => {
                  const bounds = liveBounds(element.id, bitmapProof?.qrInkBounds[element.id]) ?? elementInteractionBounds(element, textBounds);
                  return (
                    <rect
                      x={bounds.x}
                      y={bounds.y}
                      width={Math.max(bounds.width, viewBoxWidth * 0.02)}
                      height={Math.max(bounds.height, viewBoxHeight * 0.02)}
                      fill="transparent"
                      stroke={bitmapProof?.warnings.some(w => w.elementId === element.id) ? '#ef4444' : undefined}
                      strokeWidth={1}
                      strokeDasharray="3 2"
                    />
                  );
                })()}
                {selectedElementIds.has(element.id) && selectedElementIds.size === 1 && (
                  <>
                    {/* Selection border — use measured bounds for text */}
                    {(() => {
                      const bounds = (bitmap ? liveBounds(element.id, bitmapProof?.qrInkBounds[element.id]) : undefined) ?? elementInteractionBounds(element, textBounds);
                      const pad = viewBoxWidth * 0.005;
                      return (
                        <rect
                          x={bounds.x - pad}
                          y={bounds.y - pad}
                          width={bounds.width + pad * 2}
                          height={bounds.height + pad * 2}
                          fill="none"
                          stroke="#d97706"
                          strokeWidth={Math.min(viewBoxWidth, viewBoxHeight) * 0.005}
                          pointerEvents="none"
                        />
                      );
                    })()}
                    {/* Resize handles */}
                    {(() => {
                      const hs = Math.min(viewBoxWidth, viewBoxHeight) * 0.025; // handle size
                      const half = hs / 2;
                      const bounds = (bitmap ? liveBounds(element.id, bitmapProof?.qrInkBounds[element.id]) : undefined) ?? elementInteractionBounds(element, textBounds);
                      const ex = bounds.x;
                      const ey = bounds.y;
                      const ew = bounds.width;
                      const eh = bounds.height;
                      const handles = [
                        { id: 'nw', cx: ex, cy: ey, cursor: 'nwse-resize' },
                        { id: 'n',  cx: ex + ew / 2, cy: ey, cursor: 'ns-resize' },
                        { id: 'ne', cx: ex + ew, cy: ey, cursor: 'nesw-resize' },
                        { id: 'e',  cx: ex + ew, cy: ey + eh / 2, cursor: 'ew-resize' },
                        { id: 'se', cx: ex + ew, cy: ey + eh, cursor: 'nwse-resize' },
                        { id: 's',  cx: ex + ew / 2, cy: ey + eh, cursor: 'ns-resize' },
                        { id: 'sw', cx: ex, cy: ey + eh, cursor: 'nesw-resize' },
                        { id: 'w',  cx: ex, cy: ey + eh / 2, cursor: 'ew-resize' },
                      ];
                      return handles.map((h) => (
                        <rect
                          key={h.id}
                          data-resize-handle={h.id}
                          x={h.cx - half}
                          y={h.cy - half}
                          width={hs}
                          height={hs}
                          fill="#ffffff"
                          stroke="#d97706"
                          strokeWidth={Math.min(viewBoxWidth, viewBoxHeight) * 0.003}
                          style={{ cursor: resizeCursor(h.id, useUprightThermalEditor) }}
                          onPointerDown={(e) => handleResizeDown(e, element.id, h.id)}
                        />
                      ));
                    })()}
                  </>
                )}
                {/* Multi-select: subtle dashed outline on each member element */}
                {selectedElementIds.has(element.id) && selectedElementIds.size > 1 && (() => {
                  const bounds = (bitmap ? liveBounds(element.id, bitmapProof?.qrInkBounds[element.id]) : undefined) ?? elementInteractionBounds(element, textBounds);
                  return (
                    <rect
                      x={bounds.x}
                      y={bounds.y}
                      width={bounds.width}
                      height={bounds.height}
                      fill="none"
                      stroke="#d97706"
                      strokeWidth={Math.min(viewBoxWidth, viewBoxHeight) * 0.002}
                      strokeDasharray={`${Math.min(viewBoxWidth, viewBoxHeight) * 0.008} ${Math.min(viewBoxWidth, viewBoxHeight) * 0.006}`}
                      opacity={0.5}
                      pointerEvents="none"
                    />
                  );
                })()}
              </g>
            ))}
          </g>

          {marquee && <rect x={Math.min(marquee.x, marquee.endX)} y={Math.min(marquee.y, marquee.endY)} width={Math.abs(marquee.x - marquee.endX)} height={Math.abs(marquee.y - marquee.endY)} fill="#f59e0b22" stroke="#f59e0b" strokeWidth={totalW / svgW} pointerEvents="none" />}
          {/* Group selection bounding box + handles (shown when multi-selected) */}
          {selectedElementIds.size > 1 && (() => {
          const ids = Array.from(selectedElementIds);
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const id of ids) {
            const el = elements.find((e) => e.id === id);
            if (!el) continue;
            const bounds = elementInteractionBounds(el, textBounds);
            minX = Math.min(minX, bounds.x);
            minY = Math.min(minY, bounds.y);
            maxX = Math.max(maxX, bounds.x + bounds.width);
            maxY = Math.max(maxY, bounds.y + bounds.height);
          }
          if (!isFinite(minX)) return null;
          const pad = viewBoxWidth * 0.005;
          const gX = minX - pad;
          const gY = minY - pad;
          const gW = (maxX - minX) + pad * 2;
          const gH = (maxY - minY) + pad * 2;
          const hs = Math.min(viewBoxWidth, viewBoxHeight) * 0.025;
          const half = hs / 2;
          const handles = [
            { id: 'nw', cx: gX, cy: gY, cursor: 'nwse-resize' },
            { id: 'n',  cx: gX + gW / 2, cy: gY, cursor: 'ns-resize' },
            { id: 'ne', cx: gX + gW, cy: gY, cursor: 'nesw-resize' },
            { id: 'e',  cx: gX + gW, cy: gY + gH / 2, cursor: 'ew-resize' },
            { id: 'se', cx: gX + gW, cy: gY + gH, cursor: 'nwse-resize' },
            { id: 's',  cx: gX + gW / 2, cy: gY + gH, cursor: 'ns-resize' },
            { id: 'sw', cx: gX, cy: gY + gH, cursor: 'nesw-resize' },
            { id: 'w',  cx: gX, cy: gY + gH / 2, cursor: 'ew-resize' },
          ];
          // Pick a representative element id to pass to the resize handler;
          // the handler detects multi-select and uses the snapshot path.
          const primaryId = ids[0];
          return (
            <g>
              <rect
                x={gX}
                y={gY}
                width={gW}
                height={gH}
                fill="none"
                stroke="#d97706"
                strokeWidth={Math.min(viewBoxWidth, viewBoxHeight) * 0.005}
                pointerEvents="none"
              />
              {handles.map((h) => (
                <rect
                  key={h.id}
                  x={h.cx - half}
                  y={h.cy - half}
                  width={hs}
                  height={hs}
                  fill="#ffffff"
                  stroke="#d97706"
                  strokeWidth={Math.min(viewBoxWidth, viewBoxHeight) * 0.003}
                  style={{ cursor: resizeCursor(h.id, useUprightThermalEditor) }}
                  onPointerDown={(e) => handleResizeDown(e, primaryId, h.id)}
                />
              ))}
            </g>
          );
          })()}

          {/* Smart guides */}
          {guides.x.map((gx, i) => (
            <line
              key={`gx-${i}`}
              x1={gx}
              y1={-labelPadY}
              x2={gx}
              y2={viewBoxHeight + labelPadY}
              stroke="#f59e0b"
              strokeWidth={Math.min(viewBoxWidth, viewBoxHeight) * 0.003}
              strokeDasharray={`${viewBoxWidth * 0.01} ${viewBoxWidth * 0.006}`}
              pointerEvents="none"
              opacity={0.7}
            />
          ))}
          {guides.y.map((gy, i) => (
            <line
              key={`gy-${i}`}
              x1={-labelPadX}
              y1={gy}
              x2={viewBoxWidth + labelPadX}
              y2={gy}
              stroke="#f59e0b"
              strokeWidth={Math.min(viewBoxWidth, viewBoxHeight) * 0.003}
              strokeDasharray={`${viewBoxWidth * 0.01} ${viewBoxWidth * 0.006}`}
              pointerEvents="none"
              opacity={0.7}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

function renderElement(element: TemplateElement, format: LabelFormat, elements: TemplateElement[], onTextMeasure?: (id: string, w: number, h: number) => void, testData?: Record<string, string>): React.ReactNode {
  const transform = element.rotation !== 0
    ? `rotate(${element.rotation} ${element.x + element.width / 2} ${element.y + element.height / 2})`
    : undefined;

  switch (element.type) {
    case 'text':
      // Text handles its own rotation to match ZPL's field-origin rotation.
      return <TextElementRenderer key={element.id} element={element as TextElement} format={format} onMeasure={onTextMeasure} testData={testData} />;
    case 'qr':
      return <QRElementRenderer key={element.id} element={element as QRElement} format={format} transform={transform} testData={testData} />;
    case 'barcode':
      return <BarcodeElementRenderer key={element.id} element={element as BarcodeElement} transform={transform} testData={testData} />;
    case 'line':
      return <LineElementRenderer key={element.id} element={element as LineElement} transform={transform} format={format} />;
    case 'rectangle':
      return <RectangleElementRenderer key={element.id} element={element as RectangleElement} transform={transform} format={format} />;
    case 'image':
      return <ImageElementRenderer key={element.id} element={element as ImageElement} transform={transform} />;
    default:
      return null;
  }
}

function normalizedRightAngle(rotation: number | undefined): 0 | 90 | 180 | 270 {
  const normalized = (((Math.round(rotation || 0) % 360) + 360) % 360);
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized;
  return 0;
}

function resizeCursor(handle: string, uprightEditor: boolean): string {
  const printerOrientation: Record<string, string> = {
    nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
    se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
  };
  const uprightOrientation: Record<string, string> = {
    nw: 'nesw-resize', n: 'ew-resize', ne: 'nwse-resize', e: 'ns-resize',
    se: 'nesw-resize', s: 'ew-resize', sw: 'nwse-resize', w: 'ns-resize',
  };

  return (uprightEditor ? uprightOrientation : printerOrientation)[handle] || 'default';
}

function elementInteractionBounds(
  element: TemplateElement,
  textBounds: Record<string, { w: number; h: number }>,
): { x: number; y: number; width: number; height: number } {
  return elementVisualBounds(element, textBounds);
}

function elementVisualBounds(
  element: TemplateElement,
  textBounds: Record<string, { w: number; h: number }>,
): { x: number; y: number; width: number; height: number } {
  const measured = element.type === 'text' ? textBounds[element.id] : null;
  const width = measured?.w ?? element.width;
  const height = measured?.h ?? element.height;
  const rotation = normalizedRightAngle(element.rotation);

  if (rotation === 0) {
    return { x: element.x, y: element.y, width, height };
  }

  if (element.type === 'text') {
    if (rotation === 90) return { x: element.x - height, y: element.y, width: height, height: width };
    if (rotation === 180) return { x: element.x - width, y: element.y - height, width, height };
    return { x: element.x, y: element.y - width, width: height, height: width };
  }

  if (rotation === 90 || rotation === 270) {
    return {
      x: element.x + width / 2 - height / 2,
      y: element.y + height / 2 - width / 2,
      width: height,
      height: width,
    };
  }

  return { x: element.x, y: element.y, width, height };
}

function resolveElementContent(element: TemplateElement, testData?: Record<string, string>): string {
  if (element.isStatic) {
    if ('content' in element) return element.content || '';
    return '';
  }

  const testValue = element.fieldName && testData?.[element.fieldName];
  const rawContent = testValue || element.defaultValue || ('content' in element ? element.content : '');
  return `${element.prefix || ''}${rawContent}${element.suffix || ''}`;
}

function TextElementRenderer({ element, format, onMeasure, testData }: { element: TextElement; format: LabelFormat; onMeasure?: (id: string, w: number, h: number) => void; testData?: Record<string, string> }) {
  const textRef = useRef<SVGTextElement>(null);

  // Resolve display content: test data > default value > field placeholder
  let rawContent: string;
  if (element.isStatic) {
    rawContent = element.content;
  } else {
    const testValue = element.fieldName && testData?.[element.fieldName];
    rawContent = testValue || element.defaultValue || `{{${element.fieldName || 'field'}}}`;
  }
  const prefix = (!element.isStatic && element.prefix) ? element.prefix : '';
  const suffix = (!element.isStatic && element.suffix) ? element.suffix : '';
  const displayContent = `${prefix}${rawContent}${suffix}`;

  const color = format.type === 'thermal' ? '#000000' : element.color;

  const isThermal = format.type === 'thermal';
  const dpi = format.dpi || 203;
  const thermalLayout = isThermal && element.autoFit === true
    ? layoutThermalText({
        content: displayContent,
        width: element.width,
        height: element.height,
        fontSize: element.fontSize,
        dpi,
        lineHeight: element.lineHeight,
        charWidth: element.charWidth,
        autoFit: element.autoFit,
        minFontSize: element.minFontSize,
      })
    : null;
  // Raw dots-per-point height (ZPL's fontH equivalent).
  const rawFontHDots = thermalLayout?.fontHeight ?? element.fontSize * (dpi / 72);

  // Calibration to match Zebra Font 0's visual footprint in the SVG preview.
  // IBM Plex Mono (our new thermal default) renders somewhat closer to Zebra
  // Font 0 than Arial did — 0.8 is a good starting point; tune if needed.
  const zebraHeightCalibration = isThermal ? 0.8 : 1.0;

  const svgFontSize = isThermal
    ? rawFontHDots * zebraHeightCalibration
    : element.fontSize / 72;

  // Line height: ZPL Font 0 fits cleanly at 1.0× fontH between lines (no extra
  // leading). Browsers/Arial need a little more. We use element.lineHeight as
  // a multiplier on the RAW fontH (not the scaled svgFontSize) so spacing
  // between lines matches ZPL exactly.
  const lineHeight = thermalLayout
    ? thermalLayout.lineAdvance
    : isThermal
      ? rawFontHDots * (element.lineHeight || 1.0)
    : svgFontSize * (element.lineHeight || 1.2);

  // Word-wrap character width estimate.
  // For thermal with default font (IBM Plex Mono), we use svgFontSize * 0.6.
  // Plex Mono is a monospace font with ~0.6 em-width per glyph, and svgFontSize
  // already bakes in the 0.8 zebraHeightCalibration — so the effective char width
  // in SVG/dot units is rawFontHDots × 0.8 × 0.6 = rawFontHDots × 0.48.
  // Using rawFontHDots × 0.5 (old) caused the wrap to fire ~4% too early, which
  // at the boundary (e.g. 12–13 chars) produced an unwanted extra line break.
  // For user-picked fonts with textLength compression the ZPL ratio is still used.
  // For sheet labels Arial averages ~0.5 × em.
  const textCharWidthRatio = element.charWidth ?? 0.5;
  const isDefaultFontForWrap = !element.fontFamily || element.fontFamily === 'Arial' || element.fontFamily === 'Helvetica' || element.fontFamily === 'IBM Plex Mono';
  const charWidthThermal = isThermal && isDefaultFontForWrap
    ? svgFontSize * 0.6
    : rawFontHDots * textCharWidthRatio;
  const charWidth = isThermal ? charWidthThermal : svgFontSize * 0.5;
  const maxCharsPerLine = Math.max(1, Math.floor(element.width / Math.max(charWidth, 0.001)));
  const lines = thermalLayout?.lines ?? wrapThermalText(displayContent, maxCharsPerLine);

  // Thermal ZPL uses ^FB with a fixed maximum line count. Keep the editable
  // preview inside that same field capacity; the print preview remains the
  // source of truth for exact Zebra glyph metrics.
  const maxLines = thermalLayout?.maxLines ?? (isThermal
    ? Math.max(1, Math.floor(element.height / (rawFontHDots * (element.lineHeight || 1.2))))
    : Number.POSITIVE_INFINITY);
  const visibleLines = (lines.length > 0 ? lines : [displayContent]).slice(0, maxLines);

  let textAnchor: 'start' | 'middle' | 'end' = 'start';
  if (element.textAlign === 'center') textAnchor = 'middle';
  else if (element.textAlign === 'right') textAnchor = 'end';

  let baseX = element.x;
  if (element.textAlign === 'center') baseX = element.x + element.width / 2;
  else if (element.textAlign === 'right') baseX = element.x + element.width;

  // Measure and report
  useEffect(() => {
    if (textRef.current && onMeasure) {
      try {
        const bbox = textRef.current.getBBox();
        if (bbox.width > 0) {
          onMeasure(element.id, Math.max(bbox.width, element.width), Math.max(bbox.height, element.height));
        }
      } catch {}
    }
  }, [displayContent, element.fontSize, element.fontFamily, element.fontWeight, element.width, element.height, element.autoFit, element.minFontSize, element.id, onMeasure]);

  // Thermal text uses IBM Plex Mono to approximate Zebra Font 0's clean blocky
  // monospace look — a much closer visual match than Arial/Helvetica and doesn't
  // need horizontal compression tricks (monospace is already uniform-width).
  // User-picked fonts win (so you can still override to Arial etc. if you want).
  const thermalDefaultFont = 'var(--font-plex-mono), ui-monospace, "Menlo", "Courier New", monospace';
  const isPlexMono = !element.fontFamily || element.fontFamily === 'Arial' || element.fontFamily === 'Helvetica' || element.fontFamily === 'IBM Plex Mono';
  const effectiveFontFamily = isThermal && isPlexMono ? thermalDefaultFont : element.fontFamily;

  // For non-default (user override) thermal fonts, still apply the textLength
  // compression so Arial etc. match ZPL's character spacing. For Plex Mono
  // we skip it since monospace is naturally close to Font 0's character grid.
  const applyTextLengthCompression = isThermal && !isPlexMono;

  // Rotation handling: ZPL rotates around the field origin (^FO point, top-left
  // of the text box). SVG's rotate-around-center doesn't match. We use a <g>
  // transform: translate to the origin, then rotate, then render text at (0,0).
  // This makes the preview match what ZPL prints.
  const rotation = element.rotation || 0;
  const needsRotation = rotation !== 0;

  // ZPL positions the TOP of the character box at ^FO. SVG positions text by
  // its baseline. The baseline is roughly 0.8× fontH below the top of the box.
  // For the preview to match ZPL, we offset text by this amount so the top
  // of the text aligns with the field origin.
  const baselineOffset = isThermal ? rawFontHDots * 0.8 : svgFontSize * 0.85;

  const localBaseX = element.textAlign === 'center'
    ? element.width / 2
    : element.textAlign === 'right'
      ? element.width
      : 0;

  const textContent = (
    <text
      ref={textRef}
      fontSize={svgFontSize}
      fontFamily={effectiveFontFamily}
      fontWeight={element.fontWeight}
      textAnchor={textAnchor}
      fill={color}
    >
      {visibleLines.map((line, i) => {
        const widthRatio = element.charWidth ?? 0.5;
        const forcedLen = applyTextLengthCompression
          ? line.length * rawFontHDots * widthRatio
          : undefined;
        const lineOffset = i * lineHeight;
        return (
          <tspan
            key={i}
            x={needsRotation ? localBaseX : baseX}
            y={needsRotation ? (baselineOffset + lineOffset) : (element.y + baselineOffset + lineOffset)}
            textLength={forcedLen}
            lengthAdjust={forcedLen ? 'spacingAndGlyphs' : undefined}
          >
            {line}
          </tspan>
        );
      })}
    </text>
  );

  if (!needsRotation) {
    return textContent;
  }

  // Wrap in a group that translates to the element's origin then rotates.
  // This matches ZPL's ^FO + ^A0R behavior: rotate around the field origin.
  return (
    <g transform={`translate(${element.x}, ${element.y}) rotate(${rotation})`}>
      {textContent}
    </g>
  );
}

function QRElementRenderer({ element, format, transform, testData }: { element: QRElement; format: LabelFormat; transform?: string; testData?: Record<string, string> }) {
  const [dataUrl, setDataUrl] = useState<string>('');
  const clipId = useId().replace(/:/g, '');
  const content = resolveElementContent(element, testData) || 'QR';
  const thermalGeometry = format.type === 'thermal' ? thermalRenderGeometry(format) : null;

  useEffect(() => {
    let active = true;
    setDataUrl('');

    const renderBrowserQr = () => QRCode.toDataURL(content, {
      errorCorrectionLevel: element.errorCorrection,
      width: 256,
      margin: 0,
      color: { dark: '#000000', light: '#ffffff' },
    });

    if (format.type !== 'thermal') {
      renderBrowserQr()
        .then((url: string) => { if (active) setDataUrl(url); })
        .catch(() => { if (active) setDataUrl(''); });
      return () => { active = false; };
    }

    const zpl = generateZPL(
      {
        id: `${element.id}-thermal-preview`,
        name: 'Thermal Preview',
        formatId: format.id,
        elements: [element],
        createdAt: '',
        updatedAt: '',
      },
      format,
      testData,
    );

    renderZplToDataUrl(zpl, format)
      .then((url) => { if (active) setDataUrl(url); })
      .catch(() => {
        if (active) setDataUrl('');
      });

    return () => { active = false; };
  }, [content, element, format, testData]);

  if (dataUrl && thermalGeometry) {
    return (
      <>
        <clipPath id={clipId}>
          <rect
            x={element.x}
            y={element.y}
            width={element.width}
            height={element.height}
          />
        </clipPath>
        <image
          x={-thermalGeometry.effectiveSideMDots}
          y={0}
          width={thermalGeometry.linerDots}
          height={thermalGeometry.heightDots}
          href={dataUrl}
          clipPath={`url(#${clipId})`}
          preserveAspectRatio="none"
          style={{ mixBlendMode: 'multiply' }}
        />
      </>
    );
  }

  return (
    <>
      {dataUrl ? (
        <image
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          href={dataUrl}
          transform={transform}
          preserveAspectRatio="xMidYMid meet"
        />
      ) : (
        // Placeholder while QR generates
        <rect
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          fill="#f4f4f5"
          stroke="#a1a1aa"
          strokeWidth={element.width * 0.02}
          strokeDasharray={`${element.width * 0.05} ${element.width * 0.03}`}
          transform={transform}
        />
      )}
    </>
  );
}

function BarcodeElementRenderer({ element, transform, testData }: { element: BarcodeElement; transform?: string; testData?: Record<string, string> }) {
  const [barcodeData, setBarcodeData] = useState<{ svg: string; viewBox: string } | null>(null);
  const content = resolveElementContent(element, testData) || '123456789';

  useEffect(() => {
    try {
      const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      document.body.appendChild(tempSvg);

      JsBarcode(tempSvg, content, {
        format: element.barcodeFormat,
        width: 2,
        height: 80,
        displayValue: element.showText,
        margin: 0,
        fontSize: 14,
      });

      // Get the rendered dimensions from JsBarcode's width/height attributes
      const w = tempSvg.getAttribute('width') || '200';
      const h = tempSvg.getAttribute('height') || '100';
      const viewBox = `0 0 ${w} ${h}`;
      const svgContent = tempSvg.innerHTML;

      document.body.removeChild(tempSvg);
      setBarcodeData({ svg: svgContent, viewBox });
    } catch {
      setBarcodeData(null);
    }
  }, [content, element.barcodeFormat, element.showText]);

  if (!barcodeData) {
    return (
      <rect
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        fill="#f4f4f5"
        stroke="#a1a1aa"
        strokeWidth={element.width * 0.01}
        transform={transform}
      />
    );
  }

  return (
    <svg
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      viewBox={barcodeData.viewBox}
      preserveAspectRatio="xMidYMid meet"
      transform={transform}
    >
      <g dangerouslySetInnerHTML={{ __html: barcodeData.svg }} />
    </svg>
  );
}

function LineElementRenderer({ element, transform, format }: { element: LineElement; transform?: string; format: LabelFormat }) {
  // Convert strokeWidth from points to viewBox units
  const isThermal = format.type === 'thermal';
  const dpi = format.dpi || 203;
  const sw = isThermal ? element.strokeWidth * (dpi / 72) : element.strokeWidth / 72;

  return (
    <line
      x1={element.x}
      y1={element.y}
      x2={element.x + element.width}
      y2={element.y + element.height}
      stroke={isThermal ? '#000000' : element.color}
      strokeWidth={sw}
      transform={transform}
    />
  );
}

function RectangleElementRenderer({ element, transform, format }: { element: RectangleElement; transform?: string; format: LabelFormat }) {
  const isThermal = format.type === 'thermal';
  const dpi = format.dpi || 203;
  const sw = isThermal ? element.strokeWidth * (dpi / 72) : element.strokeWidth / 72;
  const br = isThermal ? element.borderRadius * (dpi / 72) : element.borderRadius / 72;

  return (
    <rect
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rx={br}
      stroke={isThermal ? '#000000' : element.strokeColor}
      strokeWidth={sw}
      fill={element.fillColor || 'none'}
      transform={transform}
    />
  );
}

function ImageElementRenderer({ element, transform }: { element: ImageElement; transform?: string }) {
  return (
    <image
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      href={element.src}
      preserveAspectRatio={
        element.objectFit === 'contain' ? 'xMidYMid meet' :
        element.objectFit === 'cover' ? 'xMidYMid slice' :
        'none'
      }
      transform={transform}
    />
  );
}
