'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { LabelFormat, TemplateElement, TextElement, QRElement, BarcodeElement, LineElement, RectangleElement, ImageElement } from '@/lib/types';

interface LabelPreviewProps {
  format: LabelFormat;
  elements: TemplateElement[];
  selectedElementId: string | null;
  onSelectElement: (id: string) => void;
  onUpdateElement?: (id: string, updates: Partial<TemplateElement>) => void;
}

export function LabelPreview({ format, elements, selectedElementId, onSelectElement, onUpdateElement }: LabelPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 600, height: 400 });
  const [dragging, setDragging] = useState<{ elementId: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });

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

  const sortedElements = [...elements].sort((a, b) => a.zIndex - b.zIndex);

  // Padding
  const padFraction = 0.1;
  const padX = viewBoxWidth * padFraction;
  const padY = viewBoxHeight * padFraction;
  const totalW = viewBoxWidth + padX * 2;
  const totalH = viewBoxHeight + padY * 2;

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
    return {
      dx: (screenDx / svgW) * totalW,
      dy: (screenDy / svgH) * totalH,
    };
  }, [svgW, svgH, totalW, totalH]);

  // Drag handlers
  const handlePointerDown = useCallback((e: React.PointerEvent, elementId: string) => {
    if (!onUpdateElement) return;
    e.stopPropagation();
    e.preventDefault();

    const element = elements.find((el) => el.id === elementId);
    if (!element) return;

    onSelectElement(elementId);
    setDragging({
      elementId,
      startX: e.clientX,
      startY: e.clientY,
      origX: element.x,
      origY: element.y,
    });

    (e.target as Element).setPointerCapture(e.pointerId);
  }, [elements, onSelectElement, onUpdateElement]);

  // Resize via window-level listeners (pointer capture on child rects doesn't bubble to SVG)
  const handleResizeDown = useCallback((e: React.PointerEvent, elementId: string, handle: string) => {
    if (!onUpdateElement) return;
    e.stopPropagation();
    e.preventDefault();

    const element = elements.find((el) => el.id === elementId);
    if (!element) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const origX = element.x;
    const origY = element.y;
    const origW = element.width;
    const origH = element.height;
    const isQR = element.type === 'qr';

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const { dx: svgDx, dy: svgDy } = screenToSvg(dx, dy);

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
        const size = Math.max(nW, nH);
        if (handle.includes('w')) nX = origX + origW - size;
        if (handle.includes('n')) nY = origY + origH - size;
        nW = size;
        nH = size;
      }

      onUpdateElement(elementId, { x: nX, y: nY, width: nW, height: nH });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [elements, onUpdateElement, screenToSvg]);

  // Snap threshold in viewBox units (~2% of smallest dimension)
  const snapThreshold = Math.min(viewBoxWidth, viewBoxHeight) * 0.02;

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !onUpdateElement) return;

    const dx = e.clientX - dragging.startX;
    const dy = e.clientY - dragging.startY;
    const { dx: svgDx, dy: svgDy } = screenToSvg(dx, dy);

    const draggedEl = elements.find((el) => el.id === dragging.elementId);
    if (!draggedEl) return;

    let rawX = dragging.origX + svgDx;
    let rawY = dragging.origY + svgDy;

    // Build snap targets from label edges, center, and other elements
    const xTargets: number[] = [0, viewBoxWidth / 2, viewBoxWidth]; // left, center, right of label
    const yTargets: number[] = [0, viewBoxHeight / 2, viewBoxHeight]; // top, center, bottom of label

    for (const el of elements) {
      if (el.id === dragging.elementId) continue;
      // Other element edges and centers
      xTargets.push(el.x, el.x + el.width / 2, el.x + el.width);
      yTargets.push(el.y, el.y + el.height / 2, el.y + el.height);
    }

    // Snap points for the dragged element: left edge, center, right edge
    const elEdgesX = [rawX, rawX + draggedEl.width / 2, rawX + draggedEl.width];
    const elEdgesY = [rawY, rawY + draggedEl.height / 2, rawY + draggedEl.height];

    const activeGuideX: number[] = [];
    const activeGuideY: number[] = [];

    // Check X snaps
    let snappedX = false;
    for (const edgeX of elEdgesX) {
      for (const target of xTargets) {
        if (Math.abs(edgeX - target) < snapThreshold) {
          rawX += target - edgeX;
          activeGuideX.push(target);
          snappedX = true;
          break;
        }
      }
      if (snappedX) break;
    }

    // Check Y snaps
    let snappedY = false;
    for (const edgeY of elEdgesY) {
      for (const target of yTargets) {
        if (Math.abs(edgeY - target) < snapThreshold) {
          rawY += target - edgeY;
          activeGuideY.push(target);
          snappedY = true;
          break;
        }
      }
      if (snappedY) break;
    }

    setGuides({ x: activeGuideX, y: activeGuideY });

    // No grid rounding — smooth movement, only snap to alignment targets
    onUpdateElement(dragging.elementId, { x: rawX, y: rawY });
  }, [dragging, onUpdateElement, screenToSvg, elements, viewBoxWidth, viewBoxHeight, snapThreshold]);

  const handlePointerUp = useCallback(() => {
    setDragging(null);
    setGuides({ x: [], y: [] });
  }, []);

  return (
    <div ref={containerRef} className="flex-1 flex items-center justify-center p-6 overflow-hidden">
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
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* Dark surround */}
        <rect
          x={-padX}
          y={-padY}
          width={totalW}
          height={totalH}
          fill="#1e1e23"
          rx={Math.min(padX, padY) * 0.4}
        />

        {/* Label surface */}
        <rect
          x={0}
          y={0}
          width={viewBoxWidth}
          height={viewBoxHeight}
          fill={format.type === 'thermal' ? '#ffffff' : '#fafafa'}
          stroke="#52525b"
          strokeWidth={Math.min(viewBoxWidth, viewBoxHeight) * 0.004}
          rx={Math.min(viewBoxWidth, viewBoxHeight) * 0.008}
        />

        {/* Elements */}
        <g>
          {sortedElements.map((element) => (
            <g
              key={element.id}
              onPointerDown={(e) => handlePointerDown(e, element.id)}
              onClick={(e) => { e.stopPropagation(); onSelectElement(element.id); }}
              style={{ cursor: dragging?.elementId === element.id ? 'grabbing' : 'grab' }}
            >
              {renderElement(element, format)}
              {/* Hit area — invisible rect that ensures small/thin elements are still draggable */}
              <rect
                x={element.x}
                y={element.y}
                width={Math.max(element.width, viewBoxWidth * 0.02)}
                height={Math.max(element.height, viewBoxHeight * 0.02)}
                fill="transparent"
              />
              {selectedElementId === element.id && (
                <>
                  {/* Selection border */}
                  <rect
                    x={element.x - viewBoxWidth * 0.005}
                    y={element.y - viewBoxWidth * 0.005}
                    width={element.width + viewBoxWidth * 0.01}
                    height={element.height + viewBoxWidth * 0.01}
                    fill="none"
                    stroke="#d97706"
                    strokeWidth={Math.min(viewBoxWidth, viewBoxHeight) * 0.005}
                    pointerEvents="none"
                  />
                  {/* Resize handles */}
                  {(() => {
                    const hs = Math.min(viewBoxWidth, viewBoxHeight) * 0.025; // handle size
                    const half = hs / 2;
                    const ex = element.x;
                    const ey = element.y;
                    const ew = element.width;
                    const eh = element.height;
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
                        x={h.cx - half}
                        y={h.cy - half}
                        width={hs}
                        height={hs}
                        fill="#ffffff"
                        stroke="#d97706"
                        strokeWidth={Math.min(viewBoxWidth, viewBoxHeight) * 0.003}
                        style={{ cursor: h.cursor }}
                        onPointerDown={(e) => handleResizeDown(e, element.id, h.id)}
                      />
                    ));
                  })()}
                </>
              )}
            </g>
          ))}
        </g>

        {/* Smart guides */}
        {guides.x.map((gx, i) => (
          <line
            key={`gx-${i}`}
            x1={gx}
            y1={-padY}
            x2={gx}
            y2={viewBoxHeight + padY}
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
            x1={-padX}
            y1={gy}
            x2={viewBoxWidth + padX}
            y2={gy}
            stroke="#f59e0b"
            strokeWidth={Math.min(viewBoxWidth, viewBoxHeight) * 0.003}
            strokeDasharray={`${viewBoxWidth * 0.01} ${viewBoxWidth * 0.006}`}
            pointerEvents="none"
            opacity={0.7}
          />
        ))}
      </svg>
    </div>
  );
}

function renderElement(element: TemplateElement, format: LabelFormat): React.ReactNode {
  const transform = element.rotation !== 0
    ? `rotate(${element.rotation} ${element.x + element.width / 2} ${element.y + element.height / 2})`
    : undefined;

  switch (element.type) {
    case 'text':
      return <TextElementRenderer key={element.id} element={element as TextElement} transform={transform} format={format} />;
    case 'qr':
      return <QRElementRenderer key={element.id} element={element as QRElement} transform={transform} />;
    case 'barcode':
      return <BarcodeElementRenderer key={element.id} element={element as BarcodeElement} transform={transform} />;
    case 'line':
      return <LineElementRenderer key={element.id} element={element as LineElement} transform={transform} />;
    case 'rectangle':
      return <RectangleElementRenderer key={element.id} element={element as RectangleElement} transform={transform} />;
    case 'image':
      return <ImageElementRenderer key={element.id} element={element as ImageElement} transform={transform} />;
    default:
      return null;
  }
}

function TextElementRenderer({ element, transform, format }: { element: TextElement; transform?: string; format: LabelFormat }) {
  const displayContent = element.isStatic
    ? element.content
    : (element.defaultValue || `{{${element.fieldName || 'field'}}}`);

  let textAnchor: 'start' | 'middle' | 'end' = 'start';
  if (element.textAlign === 'center') textAnchor = 'middle';
  else if (element.textAlign === 'right') textAnchor = 'end';

  let x = element.x;
  if (element.textAlign === 'center') x += element.width / 2;
  else if (element.textAlign === 'right') x += element.width;

  const color = format.type === 'thermal' ? '#000000' : element.color;

  return (
    <text
      x={x}
      y={element.y + element.fontSize}
      fontSize={element.fontSize}
      fontFamily={element.fontFamily}
      fontWeight={element.fontWeight}
      textAnchor={textAnchor}
      fill={color}
      transform={transform}
    >
      {displayContent}
    </text>
  );
}

function QRElementRenderer({ element, transform }: { element: QRElement; transform?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Always render at a fixed high-res pixel size — the SVG <image> handles scaling
    QRCode.toCanvas(canvas, element.content || 'QR', {
      errorCorrectionLevel: element.errorCorrection,
      width: 256,
      margin: 0,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(() => {
      setDataUrl(canvas.toDataURL());
    }).catch(() => {});
  }, [element.content, element.errorCorrection]);

  return (
    <>
      <canvas ref={canvasRef} style={{ display: 'none' }} />
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

function BarcodeElementRenderer({ element, transform }: { element: BarcodeElement; transform?: string }) {
  const [barcodeData, setBarcodeData] = useState<{ svg: string; viewBox: string } | null>(null);

  useEffect(() => {
    try {
      const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      document.body.appendChild(tempSvg);

      JsBarcode(tempSvg, element.content || '123456789', {
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
    } catch (err) {
      setBarcodeData(null);
    }
  }, [element.content, element.barcodeFormat, element.showText]);

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

function LineElementRenderer({ element, transform }: { element: LineElement; transform?: string }) {
  return (
    <line
      x1={element.x}
      y1={element.y}
      x2={element.x + element.width}
      y2={element.y + element.height}
      stroke={element.color}
      strokeWidth={element.strokeWidth}
      transform={transform}
    />
  );
}

function RectangleElementRenderer({ element, transform }: { element: RectangleElement; transform?: string }) {
  return (
    <rect
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rx={element.borderRadius}
      stroke={element.strokeColor}
      strokeWidth={element.strokeWidth}
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
