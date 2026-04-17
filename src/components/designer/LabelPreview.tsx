'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { LabelFormat, TemplateElement, TextElement, QRElement, BarcodeElement, LineElement, RectangleElement, ImageElement } from '@/lib/types';

interface LabelPreviewProps {
  format: LabelFormat;
  elements: TemplateElement[];
  selectedElementId: string | null;
  onSelectElement: (id: string) => void;
}

export function LabelPreview({ format, elements, selectedElementId, onSelectElement }: LabelPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 600, height: 400 });

  // Observe container size changes
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

  // Padding around the label in viewBox units
  const padFraction = 0.1;
  const padX = viewBoxWidth * padFraction;
  const padY = viewBoxHeight * padFraction;
  const totalW = viewBoxWidth + padX * 2;
  const totalH = viewBoxHeight + padY * 2;

  // Calculate SVG pixel size to fill container while maintaining aspect ratio
  const margin = 48; // px breathing room
  const availW = containerSize.width - margin * 2;
  const availH = containerSize.height - margin * 2;
  const aspect = totalW / totalH;
  let svgW: number;
  let svgH: number;

  if (availW / availH > aspect) {
    // Container is wider than label — height-constrained
    svgH = Math.max(availH, 200);
    svgW = svgH * aspect;
  } else {
    // Container is taller than label — width-constrained
    svgW = Math.max(availW, 200);
    svgH = svgW / aspect;
  }

  return (
    <div ref={containerRef} className="flex-1 flex items-center justify-center p-6 overflow-hidden">
      <svg
        width={svgW}
        height={svgH}
        viewBox={`${-padX} ${-padY} ${totalW} ${totalH}`}
        className="rounded-2xl"
        style={{
          filter: 'drop-shadow(0 8px 30px rgba(0,0,0,0.3))',
        }}
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
              onClick={() => onSelectElement(element.id)}
              style={{ cursor: 'pointer' }}
            >
              {renderElement(element, format)}
              {selectedElementId === element.id && (
                <rect
                  x={element.x - viewBoxWidth * 0.005}
                  y={element.y - viewBoxWidth * 0.005}
                  width={element.width + viewBoxWidth * 0.01}
                  height={element.height + viewBoxWidth * 0.01}
                  fill="none"
                  stroke="#d97706"
                  strokeWidth={Math.min(viewBoxWidth, viewBoxHeight) * 0.008}
                  strokeDasharray={`${viewBoxWidth * 0.015} ${viewBoxWidth * 0.01}`}
                  rx={viewBoxWidth * 0.005}
                  pointerEvents="none"
                />
              )}
            </g>
          ))}
        </g>
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

    QRCode.toCanvas(canvas, element.content || 'QR', {
      errorCorrectionLevel: element.errorCorrection,
      width: element.width,
      margin: 0,
    }).then(() => {
      setDataUrl(canvas.toDataURL());
    }).catch(() => {});
  }, [element.content, element.errorCorrection, element.width]);

  return (
    <>
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      {dataUrl && (
        <image
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          href={dataUrl}
          transform={transform}
        />
      )}
    </>
  );
}

function BarcodeElementRenderer({ element, transform }: { element: BarcodeElement; transform?: string }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    try {
      JsBarcode(svg, element.content || '123456789', {
        format: element.barcodeFormat,
        width: 2,
        height: element.height * 0.7,
        displayValue: element.showText,
        margin: 0,
      });
    } catch (err) {}
  }, [element.content, element.barcodeFormat, element.showText, element.height]);

  return (
    <g transform={`translate(${element.x}, ${element.y}) ${transform || ''}`}>
      <svg ref={svgRef} width={element.width} height={element.height} />
    </g>
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
