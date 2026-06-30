'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { BarcodeElement, LabelFormat, QRElement, TemplateElement, TextElement } from '@/lib/types';
import { generateZPL } from '@/lib/zplGenerator';
import { renderZplToDataUrl } from '@/lib/zplRenderClient';

interface LayoutPreviewProps {
  format: LabelFormat;
  elements: TemplateElement[];
  testData?: Record<string, string>;
  testDataByLabel?: Array<Record<string, string> | undefined>;
  selectedLabelOffset?: number;
}

export function LayoutPreview({ format, elements, testData, testDataByLabel, selectedLabelOffset }: LayoutPreviewProps) {
  if (format.type === 'sheet') {
    return (
      <SheetLayout
        format={format}
        elements={elements}
        testData={testData}
        testDataByLabel={testDataByLabel}
        selectedLabelOffset={selectedLabelOffset}
      />
    );
  }
  return <RollLayout format={format} elements={elements} testData={testData} />;
}

// Get the viewBox dimensions for the label content (matches LabelPreview)
function getLabelViewBox(format: LabelFormat) {
  const isThermal = format.type === 'thermal';
  const dpi = format.dpi || 203;
  return {
    vbW: isThermal ? format.width * dpi : format.width,
    vbH: isThermal ? format.height * dpi : format.height,
  };
}

// Renders a simplified version of the label content (for tiling)
function resolveElementContent(element: TemplateElement, testData?: Record<string, string>): string {
  if (element.isStatic) {
    if ('content' in element) return element.content || '';
    return '';
  }

  const value = (element.fieldName && testData?.[element.fieldName])
    || element.defaultValue
    || `{{${element.fieldName || 'field'}}}`;

  return `${element.prefix || ''}${value}${element.suffix || ''}`;
}

function MiniElements({ elements, vbW, format, testData }: { elements: TemplateElement[]; vbW: number; vbH: number; format: LabelFormat; testData?: Record<string, string> }) {
  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  const isThermal = format.type === 'thermal';
  const dpi = format.dpi || 203;
  return (
    <>
      {sorted.map((el) => {
        switch (el.type) {
          case 'text': {
            const te = el as TextElement;
            const fs = isThermal ? te.fontSize * (dpi / 72) : te.fontSize / 72;
            const lh = fs * (te.lineHeight || 1.2);
            const fullText = resolveElementContent(te, testData);

            // Word wrap (same logic as LabelPreview)
            const charW = fs * 0.5;
            const maxCpl = Math.max(1, Math.floor(el.width / charW)) || 999;
            const lines: string[] = [];
            if (maxCpl >= fullText.length) {
              lines.push(fullText);
            } else {
              const words = fullText.split(' ');
              let cur = '';
              for (const w of words) {
                const t = cur ? `${cur} ${w}` : w;
                if (t.length <= maxCpl) { cur = t; } else { if (cur) lines.push(cur); cur = w; }
              }
              if (cur) lines.push(cur);
            }

            let anchor: 'start' | 'middle' | 'end' = 'start';
            let baseX = el.x;
            if (te.textAlign === 'center') { anchor = 'middle'; baseX = el.x + el.width / 2; }
            else if (te.textAlign === 'right') { anchor = 'end'; baseX = el.x + el.width; }

            return (
              <text key={el.id} fontSize={fs} fontFamily={te.fontFamily} fontWeight={te.fontWeight} textAnchor={anchor} fill={isThermal ? '#000000' : '#374151'} opacity={0.9}>
                {lines.map((line, i) => (
                  <tspan key={i} x={baseX} y={el.y + fs * 0.85 + i * lh}>{line}</tspan>
                ))}
              </text>
            );
          }
          case 'qr':
            return <MiniQr key={el.id} element={el as QRElement} format={format} testData={testData} vbW={vbW} />;
          case 'barcode':
            return <MiniBarcode key={el.id} element={el as BarcodeElement} testData={testData} vbW={vbW} />;
          case 'rectangle':
            return <rect key={el.id} x={el.x} y={el.y} width={el.width} height={el.height} fill="none" stroke="#9ca3af" strokeWidth={vbW * 0.003} />;
          case 'line':
            return <line key={el.id} x1={el.x} y1={el.y} x2={el.x + el.width} y2={el.y + el.height} stroke="#9ca3af" strokeWidth={vbW * 0.003} />;
          default:
            return null;
        }
      })}
    </>
  );
}

function MiniQr({ element, format, testData, vbW }: { element: QRElement; format: LabelFormat; testData?: Record<string, string>; vbW: number }) {
  const [dataUrl, setDataUrl] = useState('');
  const content = resolveElementContent(element, testData) || 'QR';

  useEffect(() => {
    let active = true;

    const renderBrowserQr = () => QRCode.toDataURL(content, {
      errorCorrectionLevel: element.errorCorrection,
      width: 128,
      margin: 0,
      color: { dark: '#111827', light: '#ffffff' },
    });

    if (format.type !== 'thermal') {
      renderBrowserQr()
        .then((url: string) => { if (active) setDataUrl(url); })
        .catch(() => { if (active) setDataUrl(''); });
      return () => { active = false; };
    }

    const dpi = format.dpi || 203;
    const widthDots = Math.max(1, Math.round(element.width));
    const heightDots = Math.max(1, Math.round(element.height));
    const zplFormat = {
      ...format,
      width: widthDots / dpi,
      height: heightDots / dpi,
      labelsAcross: 1,
      linerWidth: undefined,
      horizontalGapThermal: 0,
      sideMarginThermal: 0,
    };
    const zpl = generateZPL(
      {
        id: `${element.id}-mini-qr-preview`,
        name: 'Mini QR Preview',
        formatId: format.id,
        elements: [{
          ...element,
          x: 0,
          y: 0,
          width: widthDots,
          height: heightDots,
          isStatic: true,
          content,
        }],
        createdAt: '',
        updatedAt: '',
      },
      zplFormat,
    );

    renderZplToDataUrl(zpl, zplFormat)
      .then((url) => { if (active) setDataUrl(url); })
      .catch(() => renderBrowserQr().then((url: string) => {
        if (active) setDataUrl(url);
      }).catch(() => {
        if (active) setDataUrl('');
      }));

    return () => { active = false; };
  }, [content, element, format]);

  if (!dataUrl) {
    return <rect x={element.x} y={element.y} width={element.width} height={element.height} fill="#9ca3af" rx={vbW * 0.003} />;
  }

  return (
    <image
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      href={dataUrl}
      preserveAspectRatio="xMidYMid meet"
    />
  );
}

function MiniBarcode({ element, testData, vbW }: { element: BarcodeElement; testData?: Record<string, string>; vbW: number }) {
  const [barcodeData, setBarcodeData] = useState<{ svg: string; viewBox: string } | null>(null);
  const content = resolveElementContent(element, testData) || '123456789';

  useEffect(() => {
    try {
      const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      JsBarcode(tempSvg, content, {
        format: element.barcodeFormat,
        width: 2,
        height: 80,
        displayValue: element.showText,
        margin: 0,
        fontSize: 14,
      });
      const w = tempSvg.getAttribute('width') || '200';
      const h = tempSvg.getAttribute('height') || '100';
      setBarcodeData({ svg: tempSvg.innerHTML, viewBox: `0 0 ${w} ${h}` });
    } catch {
      setBarcodeData(null);
    }
  }, [content, element.barcodeFormat, element.showText]);

  if (!barcodeData) {
    return <rect x={element.x} y={element.y} width={element.width} height={element.height} fill="#d1d5db" stroke="#9ca3af" strokeWidth={vbW * 0.002} />;
  }

  return (
    <svg
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      viewBox={barcodeData.viewBox}
      preserveAspectRatio="xMidYMid meet"
    >
      <g dangerouslySetInnerHTML={{ __html: barcodeData.svg }} />
    </svg>
  );
}

function SheetLayout({ format, elements, testData, testDataByLabel, selectedLabelOffset }: LayoutPreviewProps) {
  const { vbW: contentW, vbH: contentH } = getLabelViewBox(format);
  const cols = format.columns || 1;
  const rows = format.rows || 1;
  const sheetW = format.sheetWidth || 8.5;
  const sheetH = format.sheetHeight || 11;
  const labelW = format.width;
  const labelH = format.height;
  const sideM = format.sideMargin || 0;
  const topM = format.topMargin || 0;
  const gapX = format.horizontalGap || 0;
  const gapY = format.verticalGap || 0;

  const pad = 0.2;
  const viewW = sheetW + pad * 2;
  const viewH = sheetH + pad * 2;

  return (
    <div className="border-t border-zinc-800/50 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Sheet Layout</span>
        <span className="text-[10px] text-zinc-600">{cols}×{rows} = {cols * rows} labels</span>
      </div>
      <div className="flex justify-center">
        <svg
          viewBox={`0 0 ${viewW} ${viewH}`}
          className="w-full rounded-lg"
          style={{ background: '#0a0a0c' }}
        >
          {/* Sheet */}
          <rect x={pad} y={pad} width={sheetW} height={sheetH} fill="#f9fafb" stroke="#d1d5db" strokeWidth={0.02} rx={0.04} />
          {/* Labels */}
          {Array.from({ length: rows }).map((_, row) =>
            Array.from({ length: cols }).map((_, col) => {
              const cellIndex = row * cols + col;
              const x = pad + sideM + col * (labelW + gapX);
              const y = pad + topM + row * (labelH + gapY);
              if (x + labelW > pad + sheetW + 0.01 || y + labelH > pad + sheetH + 0.01) return null;
              const cellData = testDataByLabel ? testDataByLabel[cellIndex] : testData;
              const isSelected = selectedLabelOffset === cellIndex;
              return (
                <g key={`${row}-${col}`}>
                  <rect
                    x={x}
                    y={y}
                    width={labelW}
                    height={labelH}
                    fill="#ffffff"
                    stroke={isSelected ? '#d97706' : '#e5e7eb'}
                    strokeWidth={isSelected ? 0.025 : 0.01}
                  />
                  <svg x={x} y={y} width={labelW} height={labelH} viewBox={`0 0 ${contentW} ${contentH}`} preserveAspectRatio="xMidYMid meet">
                    <MiniElements elements={elements} vbW={contentW} vbH={contentH} format={format} testData={cellData} />
                  </svg>
                </g>
              );
            })
          )}
        </svg>
      </div>
    </div>
  );
}

function RollLayout({ format, elements, testData }: LayoutPreviewProps) {
  const { vbW: contentW, vbH: contentH } = getLabelViewBox(format);
  const across = format.labelsAcross || 1;
  const labelW = format.width;
  const labelH = format.height;
  const gapH = format.horizontalGapThermal || 0;
  const sideM = format.sideMarginThermal || 0;
  const labelGap = format.labelGap || 0;
  const autoLinerW = sideM * 2 + across * labelW + (across - 1) * gapH;
  const linerW = format.linerWidth || autoLinerW;

  // Center the labels on the liner. If the user explicitly set a side margin,
  // honor it; otherwise compute the symmetric offset from liner edge.
  const labelsTotalW = across * labelW + (across - 1) * gapH;
  const centeredSideM = Math.max(0, (linerW - labelsTotalW) / 2);
  const effectiveSideM = sideM > 0 ? sideM : centeredSideM;

  const rowCount = 3;
  const totalH = rowCount * labelH + (rowCount - 1) * labelGap;

  const pad = linerW * 0.06;
  const viewW = linerW + pad * 2;
  const viewH = totalH + pad * 2;

  return (
    <div className="border-t border-zinc-800/50 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Roll Layout</span>
        <span className="text-[10px] text-zinc-600">{across} across, {linerW.toFixed(2)}&quot; liner</span>
      </div>
      <div className="flex justify-center">
        <svg
          viewBox={`0 0 ${viewW} ${viewH}`}
          className="w-full rounded-lg"
          style={{ background: '#0a0a0c' }}
        >
          {/* Liner */}
          <rect x={pad} y={0} width={linerW} height={viewH} fill="#e5e7eb" stroke="#d1d5db" strokeWidth={linerW * 0.005} />
          {/* Labels */}
          {Array.from({ length: rowCount }).map((_, row) =>
            Array.from({ length: across }).map((_, col) => {
              const x = pad + effectiveSideM + col * (labelW + gapH);
              const y = pad + row * (labelH + labelGap);
              return (
                <g key={`${row}-${col}`}>
                  <rect x={x} y={y} width={labelW} height={labelH} fill="#ffffff" stroke="#d1d5db" strokeWidth={linerW * 0.003} />
                  <svg x={x} y={y} width={labelW} height={labelH} viewBox={`0 0 ${contentW} ${contentH}`} preserveAspectRatio="xMidYMid meet">
                    <MiniElements elements={elements} vbW={contentW} vbH={contentH} format={format} testData={testData} />
                  </svg>
                </g>
              );
            })
          )}
        </svg>
      </div>
    </div>
  );
}
