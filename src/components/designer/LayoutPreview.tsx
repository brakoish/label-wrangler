'use client';

import { LabelFormat, TemplateElement, TextElement } from '@/lib/types';

interface LayoutPreviewProps {
  format: LabelFormat;
  elements: TemplateElement[];
}

export function LayoutPreview({ format, elements }: LayoutPreviewProps) {
  if (format.type === 'sheet') {
    return <SheetLayout format={format} elements={elements} />;
  }
  return <RollLayout format={format} elements={elements} />;
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
function MiniElements({ elements, vbW, vbH, format }: { elements: TemplateElement[]; vbW: number; vbH: number; format: LabelFormat }) {
  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  const isThermal = format.type === 'thermal';
  const dpi = format.dpi || 203;
  return (
    <>
      {sorted.map((el) => {
        switch (el.type) {
          case 'text': {
            const te = el as TextElement;
            // Convert font size to viewBox units (same as LabelPreview)
            const fs = isThermal ? te.fontSize * (dpi / 72) : te.fontSize / 72;
            const prefix = (!te.isStatic && te.prefix) ? te.prefix : '';
            const suffix = (!te.isStatic && te.suffix) ? te.suffix : '';
            const content = te.isStatic ? te.content : (te.defaultValue || te.fieldName || '...');
            return (
              <text key={el.id} x={el.x} y={el.y + fs * 0.85} fontSize={fs} fontFamily={te.fontFamily} fill={isThermal ? '#000000' : '#374151'} opacity={0.9}>
                {`${prefix}${content}${suffix}`}
              </text>
            );
          }
          case 'qr':
            return <rect key={el.id} x={el.x} y={el.y} width={el.width} height={el.height} fill="#9ca3af" rx={vbW * 0.003} />;
          case 'barcode':
            return <rect key={el.id} x={el.x} y={el.y} width={el.width} height={el.height} fill="#d1d5db" stroke="#9ca3af" strokeWidth={vbW * 0.002} />;
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

function SheetLayout({ format, elements }: LayoutPreviewProps) {
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
              const x = pad + sideM + col * (labelW + gapX);
              const y = pad + topM + row * (labelH + gapY);
              if (x + labelW > pad + sheetW + 0.01 || y + labelH > pad + sheetH + 0.01) return null;
              return (
                <g key={`${row}-${col}`}>
                  <rect x={x} y={y} width={labelW} height={labelH} fill="#ffffff" stroke="#e5e7eb" strokeWidth={0.01} />
                  <svg x={x} y={y} width={labelW} height={labelH} viewBox={`0 0 ${contentW} ${contentH}`} preserveAspectRatio="xMidYMid meet">
                    <MiniElements elements={elements} vbW={contentW} vbH={contentH} format={format} />
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

function RollLayout({ format, elements }: LayoutPreviewProps) {
  const { vbW: contentW, vbH: contentH } = getLabelViewBox(format);
  const across = format.labelsAcross || 1;
  const labelW = format.width;
  const labelH = format.height;
  const gapH = format.horizontalGapThermal || 0;
  const sideM = format.sideMarginThermal || 0;
  const labelGap = format.labelGap || 0;
  const linerW = format.linerWidth || (sideM * 2 + across * labelW + (across - 1) * gapH);

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
              const x = pad + sideM + col * (labelW + gapH);
              const y = pad + row * (labelH + labelGap);
              return (
                <g key={`${row}-${col}`}>
                  <rect x={x} y={y} width={labelW} height={labelH} fill="#ffffff" stroke="#d1d5db" strokeWidth={linerW * 0.003} />
                  <svg x={x} y={y} width={labelW} height={labelH} viewBox={`0 0 ${contentW} ${contentH}`} preserveAspectRatio="xMidYMid meet">
                    <MiniElements elements={elements} vbW={contentW} vbH={contentH} format={format} />
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
