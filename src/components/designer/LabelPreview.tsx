'use client';

import { useEffect, useRef, useState, useCallback, useId, useMemo, type ReactNode } from 'react';
import { LabelFormat, TemplateElement, TextElement, QRElement, ImageElement } from '@/lib/types';
import { getBitmapProof, type EditorLayer } from '@/lib/thermal/client';
import { nearestSnap, resizeArtwork, artworkBounds } from '@/lib/thermal/editorGeometry';
import { generateZPL, snapZplQrSize } from '@/lib/zplGenerator';
import { renderZplToDataUrl, thermalRenderGeometry } from '@/lib/zplRenderClient';
import { renderSheetLabelSvg } from '@/lib/sheetPrint';
import { friendlyRenderError, friendlyRenderFailure } from '@/lib/userMessages';
import { friendlyFieldName } from '@/lib/fieldLabels';
import { plainRenderWarning, type Box, type LayoutProblem } from '@/lib/designerLayout';

interface LabelPreviewProps {
  format: LabelFormat;
  elements: TemplateElement[];
  selectedElementIds: Set<string>;
  editorOrientation?: 'printer' | 'upright';
  /** Which way "Readable" turns the label: counter-clockwise for text printed at 90°, clockwise for 270°. */
  uprightTurn?: 'ccw' | 'cw';
  /** Printed ink of each item, measured from the print renderer (relative to the item's position). */
  onInkChange?: (inks: Record<string, InkOffset>) => void;
  onSelectElement: (id: string | null, addToSelection?: boolean) => void;
  onUpdateElement?: (id: string, updates: Partial<TemplateElement>) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  testData?: Record<string, string>;
  thermalRenderMode?: 'native-v1' | 'bitmap-v1';
  onSelectElements?: (ids: string[]) => void;
  onDuplicateSelection?: (ids: Set<string>) => TemplateElement[];
  onGestureCancel?: () => void;
  /** Items that overlap or run off the label (native thermal): outlined in red and listed. */
  layoutProblems?: LayoutProblem[];
  /** A button that fixes the first problem (Make an exact-print copy), shown right under it. */
  noticeAction?: ReactNode;
}

/** An item's printed ink relative to its x/y, in label units. */
export interface InkOffset { dx: number; dy: number; width: number; height: number }

export function LabelPreview({ format, elements, selectedElementIds, editorOrientation = 'printer', uprightTurn = 'ccw', onInkChange, onSelectElement, onUpdateElement, onDragStart, onDragEnd, testData, thermalRenderMode, onSelectElements, onDuplicateSelection, onGestureCancel, layoutProblems = [], noticeAction }: LabelPreviewProps) {
  const problemIdSet = useMemo(() => new Set(layoutProblems.flatMap(p => p.ids)), [layoutProblems]);
  const bitmap = format.type === 'thermal' && thermalRenderMode === 'bitmap-v1';
  const [bitmapProof, setBitmapProof] = useState<{ advisories: Array<{ elementId: string; message: string }>; key: string; url: string; elements: TemplateElement[]; layers: EditorLayer[]; qrInkBounds: Record<string, { x: number; y: number; width: number; height: number }>; qrBounds: Record<string, { x: number; y: number; width: number; height: number }>; warnings: Array<{ elementId: string; message: string }> } | null>(null);
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
        .then(result => { if (active) setBitmapProof({ advisories: result.advisories || [], key: bitmapKey, url: result.proof, elements, layers: result.editorLayers || [], warnings: result.warnings || [], qrBounds: result.qrBounds || {}, qrInkBounds: result.qrInkBounds || {} }); })
        .catch(error => { if (active) setBitmapError(friendlyRenderFailure(error, 'The preview could not be drawn.', elements, 1, testData, format)); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [bitmap, bitmapKey, elements, format, testData]);
  const hatchId = useId().replace(/:/g, '');
  const containerRef = useRef<HTMLDivElement>(null);
  const [showAllProblems, setShowAllProblems] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 600, height: 400 });
  const [dragging, setDragging] = useState<{
    elementId: string;
    startX: number;
    startY: number;
    origPositions: Map<string, { x: number; y: number }>;
  } | null>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  // Printed ink per item, measured from the same renderer as the print
  // preview, so selection, problem outlines and the drawn item agree.
  const [inks, setInks] = useState<Record<string, InkOffset | undefined>>({});
  const handleInk = useCallback((id: string, ink: InkOffset | null) => {
    setInks((prev) => {
      const old = prev[id];
      if (!ink ? !old : old && old.dx === ink.dx && old.dy === ink.dy && old.width === ink.width && old.height === ink.height) return prev;
      const next = { ...prev };
      if (ink) next[id] = ink; else delete next[id];
      return next;
    });
  }, []);
  const nativeThermal = format.type === 'thermal' && !bitmap;
  useEffect(() => { onInkChange?.(inks as Record<string, InkOffset>); }, [inks, onInkChange]);

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
  // "Readable" turns the view so text printed sideways reads left to right.
  const useUprightThermalEditor = editorOrientation === 'upright' && format.type === 'thermal';
  const clockwise = uprightTurn === 'cw';
  const editorViewBoxWidth = useUprightThermalEditor ? viewBoxHeight : viewBoxWidth;
  const editorViewBoxHeight = useUprightThermalEditor ? viewBoxWidth : viewBoxHeight;
  const editorContentTransform = useUprightThermalEditor
    ? clockwise ? `translate(${viewBoxHeight} 0) rotate(90)` : `translate(0 ${viewBoxWidth}) rotate(-90)`
    : undefined;

  // One box per item for hit area, selection, handles and problem outline:
  // the printed ink, stopped at the label edge (text keeps its whole box,
  // which sets where it wraps).
  const liveInk = useCallback((el: TemplateElement): Box | null => {
    const ink = nativeThermal ? inks[el.id] : undefined;
    return ink ? { x: el.x + ink.dx, y: el.y + ink.dy, width: ink.width, height: ink.height } : null;
  }, [inks, nativeThermal]);
  const boundsOf = useCallback((el: TemplateElement): Box => {
    const box = elementVisualBounds(el);
    const ink = liveInk(el);
    if (!ink) return box;
    const clipped = clipBox(ink, viewBoxWidth, viewBoxHeight) ?? ink;
    return el.type === 'text' ? unionBox(box, clipped) : clipped;
  }, [liveInk, viewBoxWidth, viewBoxHeight]);

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
  // On a phone the label fills the width and the canvas grows to fit it,
  // instead of a small label floating in a tall empty box.
  const phone = containerSize.width < 600;
  const margin = phone ? 4 : 48;
  const availW = containerSize.width - margin * 2;
  const availH = phone ? Infinity : containerSize.height - margin * 2;
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
      return clockwise ? { dx: displayDy, dy: -displayDx } : { dx: -displayDy, dy: displayDx };
    }

    return { dx: displayDx, dy: displayDy };
  }, [svgW, svgH, totalW, totalH, useUprightThermalEditor, clockwise]);

  const beginText = useCallback((id: string) => {
    const element = elements.find((e): e is TextElement => e.id === id && e.type === 'text');
    if (!element || element.locked || format.type !== 'thermal' || !svgRef.current) return;
    const node = svgRef.current.querySelector(`[data-element-id="${CSS.escape(id)}"] [data-hit]`) ?? svgRef.current.querySelector(`[data-element-id="${CSS.escape(id)}"]`);
    const rect = node?.getBoundingClientRect();
    if (!rect) return;
    onDragStart?.();
    setEditing({ id, value: element.isStatic ? element.content : element.defaultValue || '', bound: !element.isStatic, field: element.fieldName || 'field', left: rect.left, top: rect.top, width: Math.max(180, rect.width), height: Math.max(90, rect.height) });
  }, [elements, format.type, onDragStart]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select,button,a,summary,[role="button"],[role="combobox"],[contenteditable="true"]')) return;
      if (e.key === 'Enter' && selectedElementIds.size === 1) { e.preventDefault(); beginText([...selectedElementIds][0]); }
      if (e.key === 'Escape') { setDragging(null); setMarquee(null); setGuides({ x: [], y: [] }); onGestureCancel?.(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [selectedElementIds, beginText, onGestureCancel]);
  const pointInLabel = (clientX: number, clientY: number) => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    if (!useUprightThermalEditor) return { x: point.x, y: point.y };
    return clockwise ? { x: point.y, y: viewBoxHeight - point.x } : { x: viewBoxWidth - point.y, y: point.x };
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
    if (!element || element.locked) return;

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
    let dragIds = new Set(elements.filter(el => !el.locked && (selectedElementIds.has(elementId) ? selectedElementIds.has(el.id) : el.id === elementId)).map(el => el.id));
    let dragElements = elements;
    if (e.altKey && onDuplicateSelection && format.type === 'thermal') {
      const originals = elements.filter(el => dragIds.has(el.id)).sort((a, b) => a.zIndex - b.zIndex);
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
    if (!element || element.locked) return;

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
    const getEffectiveBounds = (el: TemplateElement) => boundsOf(el);
    const selectedSnapshots = isMultiResize ? new Map(
      elements
        .filter((el) => selectedElementIds.has(el.id) && !el.locked)
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
  }, [elements, onUpdateElement, screenToSvg, selectedElementIds, onDragStart, onDragEnd, format, boundsOf, testData, bitmap, bitmapProof, liveBounds, onGestureCancel]);

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

  const badQr = bitmapProof?.key === bitmapKey ? elements.find(e => e.type === 'qr' && [...bitmapProof.warnings, ...bitmapProof.advisories].some(w => w.elementId === e.id) && bitmapProof.qrBounds[e.id]) : undefined;
  const badQrBounds = badQr && bitmapProof?.qrBounds[badQr.id];
  const canFitQr = badQrBounds && badQrBounds.width <= viewBoxWidth && badQrBounds.height <= viewBoxHeight;
  // Problems that stop printing first; each says what to change.
  const shownProblems = [...layoutProblems].sort((a, b) => Number(!!b.blocking) - Number(!!a.blocking));
  const problemText = (problem: LayoutProblem) => `${problem.message}${problem.fix ? ` ${problem.fix.replace(/\.$/, '')}.` : ''}`;
  return (
    <div data-designer-canvas className="relative flex-1 shrink-0 flex flex-col overflow-hidden min-h-[340px] h-[calc(100dvh-270px)] max-h-[800px] max-sm:h-auto max-sm:min-h-0 max-sm:flex-none">
      {/* Notices sit above the label, in the page flow, so the canvas never
          covers them (the space is kept so the label doesn't jump). */}
      <div className="shrink-0 space-y-1 px-3 pt-2 min-h-12 sm:min-h-16 sm:px-6">
      {bitmap && <p role="status" className={`text-sm ${bitmapError ? 'text-red-400' : 'text-zinc-400'}`}>{bitmapError ? `Showing the last good preview. ${bitmapError}` : (bitmapProof?.key === bitmapKey ? bitmapProof.warnings.length ? `Fix the item outlined in red before printing: ${plainRenderWarning(bitmapProof.warnings[0].message, (m) => friendlyRenderError(m, elements, 1, testData, format))}` : bitmapProof.advisories.length ? plainRenderWarning(bitmapProof.advisories[0].message, (m) => friendlyRenderError(m, elements, 1, testData, format)) : 'This is exactly how it will print. Double-click text to edit it.' : 'Updating the print preview…')}</p>}
      {!bitmap && shownProblems.length > 0 && (
        <div role="status" className={`text-sm ${shownProblems[0].blocking ? 'text-red-400' : 'text-amber-300'}`}>
          <p>
            {problemText(shownProblems[0])}
            {shownProblems.length > 1 && <> <button type="button" aria-expanded={showAllProblems} onClick={() => setShowAllProblems((v) => !v)} className="font-medium underline underline-offset-2">{showAllProblems ? 'Show less' : `and ${shownProblems.length - 1} more`}</button></>}
          </p>
          {showAllProblems && <ul className="fold-reveal mt-1 list-disc space-y-1 pl-5">{shownProblems.slice(1).map((problem) => <li key={problem.ids.join(',') + problem.kind} className={problem.blocking ? 'text-red-400' : 'text-amber-300'}>{problemText(problem)}</li>)}</ul>}
          {noticeAction && <div className="pt-1.5">{noticeAction}</div>}
        </div>
      )}
      {badQr && !badQr.locked && badQrBounds && canFitQr && onUpdateElement && <button type="button" className="btn btn-secondary btn-sm" onClick={() => {
        onDragStart?.();
        onUpdateElement(badQr.id, { x: badQr.x + Math.max(0, Math.min(viewBoxWidth - badQrBounds.width, badQrBounds.x)) - badQrBounds.x, y: badQr.y + Math.max(0, Math.min(viewBoxHeight - badQrBounds.height, badQrBounds.y)) - badQrBounds.y });
        onDragEnd?.();
      }}>Fit QR inside label</button>}
      </div>
      {editing && <div className="fixed z-40 bg-zinc-950 border border-amber-400 rounded p-2" style={{ left: Math.max(0, Math.min(editing.left, window.innerWidth - editing.width - 20)), top: Math.max(0, Math.min(editing.top, window.innerHeight - editing.height - 70)), width: editing.width + 16 }}>
        <p className="text-xs text-amber-400 mb-1">{editing.bound ? `Sample for ${friendlyFieldName(editing.field)} (the spreadsheet fills it when printing)` : 'Edit text'}. Ctrl or ⌘ + Enter saves, Esc cancels.</p>
        <textarea aria-label="Inline label text" autoFocus value={editing.value} style={{ width: '100%', height: editing.height }} className="bg-white text-black p-1 resize-none" onChange={e => { const value = e.target.value; setEditing({ ...editing, value }); onUpdateElement?.(editing.id, editing.bound ? { defaultValue: value } : { content: value }); }} onBlur={() => { onDragEnd?.(); setEditing(null); }} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); onGestureCancel?.(); setEditing(null); } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onDragEnd?.(); setEditing(null); } }} />
      </div>}
      <div ref={containerRef} className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 pt-2 sm:px-6 sm:pb-6">
      <svg
        ref={svgRef}
        tabIndex={0}
        role="group"
        aria-label="Label. Arrow keys move the selected item; hold Shift for bigger steps."
        width={svgW}
        height={svgH}
        viewBox={`${-padX} ${-padY} ${totalW} ${totalH}`}
        className="rounded-xl"
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
            const hit = w + h < 2 ? [] : elements.filter(el => { if (el.locked) return false; const b = boundsOf(el); return b.x < x + w && b.x + b.width > x && b.y < y + h && b.y + b.height > y; }).map(el => el.id);
            onSelectElements?.([...new Set([...marquee.initial, ...hit])]); setMarquee(null);
          }
          handlePointerUp();
        }}
      >
        <defs>
          <pattern id={hatchId} patternUnits="userSpaceOnUse" width={Math.max(4, viewBoxWidth * 0.02)} height={Math.max(4, viewBoxWidth * 0.02)} patternTransform="rotate(45)">
            <rect width={Math.max(4, viewBoxWidth * 0.02)} height={Math.max(4, viewBoxWidth * 0.02)} fill="#ef444433" />
            <line x1={0} y1={0} x2={0} y2={Math.max(4, viewBoxWidth * 0.02)} stroke="#ef4444" strokeWidth={Math.max(1, viewBoxWidth * 0.006)} />
          </pattern>
        </defs>
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

          {bitmap && bitmapProof && <svg x={0} y={0} width={viewBoxWidth} height={viewBoxHeight} viewBox={`${thermalRenderGeometry(format).effectiveSideMDots} 0 ${viewBoxWidth} ${viewBoxHeight}`} pointerEvents="none" >
            {bitmapProof.key !== bitmapKey && bitmapProof.layers.length > 0 ? <g transform={`translate(${thermalRenderGeometry(format).effectiveSideMDots} 0)`}>
              {[...bitmapProof.layers].sort((a, b) => (elements.find(e => e.id === a.elementId)?.zIndex ?? 0) - (elements.find(e => e.id === b.elementId)?.zIndex ?? 0)).map(layer => {
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
                pointerEvents={element.locked ? "none" : undefined}
                onDoubleClick={e => { e.stopPropagation(); beginText(element.id); }}
                onPointerDown={(e) => handlePointerDown(e, element.id)}
                style={{ cursor: dragging?.elementId === element.id ? 'grabbing' : 'grab' }}
              >
                <g pointerEvents="none">
                  {nativeThermal && (element.type === 'image'
                    ? <ImageElementRenderer element={element as ImageElement} transform={element.rotation ? `rotate(${element.rotation} ${element.x + element.width / 2} ${element.y + element.height / 2})` : undefined} />
                    : <ThermalItem element={element} format={format} values={testData} onInk={handleInk} />)}
                  {format.type === 'sheet' && <SheetItem element={element} format={format} values={testData} />}
                </g>
                {/* Hit area — invisible rect that ensures small/thin elements are still draggable */}
                {(() => {
                  const bounds = liveBounds(element.id, bitmapProof?.qrInkBounds[element.id]) ?? boundsOf(element);
                  const problem = problemIdSet.has(element.id);
                  const ink = liveInk(element);
                  const pad = viewBoxWidth * 0.005;
                  return (
                    <>
                      <rect
                        data-hit
                        x={bounds.x}
                        y={bounds.y}
                        width={Math.max(bounds.width, viewBoxWidth * 0.02)}
                        height={Math.max(bounds.height, viewBoxHeight * 0.02)}
                        fill="transparent"
                        stroke={bitmapProof?.warnings.some(w => w.elementId === element.id) ? '#ef4444' : undefined}
                        strokeWidth={1}
                        strokeDasharray="3 2"
                      />
                      {problem && <rect data-layout-problem={element.id} x={bounds.x - pad} y={bounds.y - pad} width={bounds.width + pad * 2} height={bounds.height + pad * 2} fill="none" stroke="#ef4444" strokeWidth={Math.max(1.5, Math.min(viewBoxWidth, viewBoxHeight) * 0.006)} pointerEvents="none" />}
                      {/* The part the printer cuts off: hatched, outside the label edge. */}
                      {ink && outsideParts(ink, viewBoxWidth, viewBoxHeight, labelPadX, labelPadY).map((part, index) => (
                        <rect key={index} data-off-label={element.id} x={part.x} y={part.y} width={part.width} height={part.height} fill={`url(#${hatchId})`} stroke="#ef4444" strokeWidth={Math.max(1, Math.min(viewBoxWidth, viewBoxHeight) * 0.003)} pointerEvents="none" />
                      ))}
                    </>
                  );
                })()}
                {selectedElementIds.has(element.id) && !element.locked && selectedElementIds.size === 1 && (
                  <>
                    {/* Selection border — use measured bounds for text */}
                    {(() => {
                      const bounds = (bitmap ? liveBounds(element.id, bitmapProof?.qrInkBounds[element.id]) : undefined) ?? boundsOf(element);
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
                      const bounds = (bitmap ? liveBounds(element.id, bitmapProof?.qrInkBounds[element.id]) : undefined) ?? boundsOf(element);
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
                  const bounds = (bitmap ? liveBounds(element.id, bitmapProof?.qrInkBounds[element.id]) : undefined) ?? boundsOf(element);
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
          const ids = elements.filter(el => selectedElementIds.has(el.id) && !el.locked).map(el => el.id);
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const id of ids) {
            const el = elements.find((e) => e.id === id);
            if (!el) continue;
            const bounds = boundsOf(el);
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
    </div>
  );
}

function unionBox(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
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

function elementVisualBounds(element: TemplateElement): Box {
  const { width, height } = element;
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

function clipBox(box: Box, width: number, height: number): Box | null {
  const x = Math.max(0, box.x), y = Math.max(0, box.y);
  const right = Math.min(width, box.x + box.width), bottom = Math.min(height, box.y + box.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** The pieces of `box` outside the label, kept inside the canvas margin. */
function outsideParts(box: Box, width: number, height: number, padX: number, padY: number): Box[] {
  const parts: Box[] = [];
  const top = Math.max(box.y, -padY), bottom = Math.min(box.y + box.height, height + padY);
  const left = Math.max(box.x, -padX), right = Math.min(box.x + box.width, width + padX);
  if (bottom <= top || right <= left) return parts;
  if (right > width) parts.push({ x: Math.max(width, left), y: top, width: right - Math.max(width, left), height: bottom - top });
  if (left < 0) parts.push({ x: left, y: top, width: Math.min(0, right) - left, height: bottom - top });
  const innerL = Math.max(0, left), innerR = Math.min(width, right);
  if (innerR > innerL && bottom > height) parts.push({ x: innerL, y: Math.max(height, top), width: innerR - innerL, height: bottom - Math.max(height, top) });
  if (innerR > innerL && top < 0) parts.push({ x: innerL, y: top, width: innerR - innerL, height: Math.min(0, bottom) - top });
  return parts.filter((part) => part.width > 0.5 && part.height > 0.5);
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

type SoloRaster = { key: string; url: string; ox: number; oy: number; padX: number; padY: number; w: number; h: number; ink: InkOffset | null; failed?: boolean };

/**
 * One item drawn alone by the same ZPL generator and renderer as the print
 * preview, on a label with a margin around it so a part that runs off the
 * edge can still be measured. Preview only: the printed bytes come from
 * generateZPL with the real format, untouched.
 */
function soloRasterInput(element: TemplateElement, format: LabelFormat, values: Record<string, string> | undefined) {
  const dpi = format.dpi || 203;
  const labelW = Math.round(format.width * dpi), labelH = Math.round(format.height * dpi);
  const padX = Math.ceil(labelW * 0.15), padY = Math.ceil(labelH * 0.15);
  const w = labelW + padX * 2, h = labelH + padY * 2;
  const solo: LabelFormat = { ...format, labelsAcross: 1, linerWidth: undefined, sideMarginThermal: 0, horizontalGapThermal: 0 };
  const shifted = { ...element, x: element.x + padX, y: element.y + padY } as TemplateElement;
  const zpl = generateZPL({ id: 'canvas', name: 'Canvas', formatId: format.id, elements: [shifted], createdAt: '', updatedAt: '' }, solo, values)
    .replace(/\^PW\d+/, `^PW${w}`).replace(/\^LL\d+/, `^LL${h}`);
  return { zpl, padX, padY, w, h, renderFormat: { width: w / dpi, height: h / dpi, dpi, labelsAcross: 1, sideMarginThermal: 0, horizontalGapThermal: 0 } };
}

/** Bounding box of the dark pixels of a rendered PNG, in label dots. */
async function inkOf(url: string, w: number, h: number): Promise<Box | null> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context || !canvas.width || !canvas.height) return null;
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < canvas.height; y++) {
    const row = y * canvas.width * 4;
    for (let x = 0; x < canvas.width; x++) {
      if (data[row + x * 4] < 128 && data[row + x * 4 + 3] > 0) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const sx = w / canvas.width, sy = h / canvas.height;
  return { x: minX * sx, y: minY * sy, width: (maxX - minX + 1) * sx, height: (maxY - minY + 1) * sy };
}

function ThermalItem({ element, format, values, onInk }: { element: TemplateElement; format: LabelFormat; values?: Record<string, string>; onInk: (id: string, ink: InkOffset | null) => void }) {
  const clipId = useId().replace(/:/g, '');
  const [raster, setRaster] = useState<SoloRaster | null>(null);
  // Moving an item doesn't change how it prints, only where.
  const key = JSON.stringify([{ ...element, x: Math.round(element.x) - element.x, y: Math.round(element.y) - element.y, zIndex: 0, locked: false }, values, format]);
  const current = useRef(element);
  useEffect(() => { current.current = element; });
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      const el = current.current;
      const input = soloRasterInput(el, format, values);
      const base = { key, ox: Math.round(el.x), oy: Math.round(el.y), padX: input.padX, padY: input.padY, w: input.w, h: input.h };
      if (!/\^FO/.test(input.zpl)) { setRaster({ ...base, url: '', ink: null }); return; }
      renderZplToDataUrl(input.zpl, input.renderFormat)
        .then(async (url) => {
          const ink = await inkOf(url, input.w, input.h);
          if (active) setRaster({ ...base, url, ink: ink && { dx: ink.x - input.padX - base.ox, dy: ink.y - input.padY - base.oy, width: ink.width, height: ink.height } });
        })
        .catch(() => { if (active) setRaster({ ...base, url: '', ink: null, failed: true }); });
    }, 40);
    return () => { active = false; clearTimeout(timer); };
  }, [key, format, values]);
  useEffect(() => { onInk(element.id, raster?.ink ?? null); }, [raster, element.id, onInk]);
  useEffect(() => () => onInk(element.id, null), [element.id, onInk]);

  const dpi = format.dpi || 203;
  if (!raster || !raster.url) {
    if (!raster?.failed) return null;
    return <rect x={element.x} y={element.y} width={element.width} height={element.height} fill="#f4f4f5" stroke="#a1a1aa" strokeWidth={1} strokeDasharray="4 3" />;
  }
  return (
    <>
      <clipPath id={clipId}>
        <rect x={0} y={0} width={Math.round(format.width * dpi)} height={Math.round(format.height * dpi)} />
      </clipPath>
      {/* The clip sits on the image itself: a clipped group would isolate
          the multiply blend and paint white over the items below. */}
      <image
        x={element.x - raster.ox - raster.padX}
        y={element.y - raster.oy - raster.padY}
        width={raster.w}
        height={raster.h}
        href={raster.url}
        clipPath={`url(#${clipId})`}
        preserveAspectRatio="none"
        style={{ mixBlendMode: 'multiply', imageRendering: 'pixelated' }}
      />
    </>
  );
}

function extractSvgBody(svg: string): string {
  const start = svg.indexOf('>');
  const end = svg.lastIndexOf('</svg>');
  return start === -1 || end <= start ? '' : svg.slice(start + 1, end);
}

/** One sheet item drawn by the same code that prints the sheet. */
function SheetItem({ element, format, values }: { element: TemplateElement; format: LabelFormat; values?: Record<string, string> }) {
  const [drawn, setDrawn] = useState<{ body: string; ox: number; oy: number } | null>(null);
  const key = JSON.stringify([{ ...element, x: 0, y: 0, zIndex: 0, locked: false }, values, format]);
  const current = useRef(element);
  useEffect(() => { current.current = element; });
  useEffect(() => {
    let active = true;
    const el = current.current;
    renderSheetLabelSvg([el], format, values || {})
      .then((svg) => { if (active) setDrawn({ body: extractSvgBody(svg), ox: el.x, oy: el.y }); })
      .catch(() => { if (active) setDrawn({ body: '', ox: el.x, oy: el.y }); });
    return () => { active = false; };
  }, [key, format, values]);
  if (!drawn) return null;
  if (!drawn.body) return <rect x={element.x} y={element.y} width={element.width} height={element.height} fill="#f4f4f5" stroke="#a1a1aa" strokeWidth={0.01} />;
  return <g transform={`translate(${element.x - drawn.ox} ${element.y - drawn.oy})`} dangerouslySetInnerHTML={{ __html: drawn.body }} />;
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
