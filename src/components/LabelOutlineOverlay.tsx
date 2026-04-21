import type { LabelFormat } from '@/lib/types';

/**
 * Transparent SVG overlay that draws each label's boundary on top of a
 * rendered ZPL preview image. Must be placed inside a `relative` parent that
 * contains the <img>; the SVG sits absolutely and matches the img's box.
 *
 * Uses the same sideMargin + lane*(labelW+gap) math as `generateZPL`, so
 * outlines land exactly over each printed label regardless of container
 * zoom or DPI. Preview-only — does not affect ZPL sent to the printer.
 *
 * Shared by the designer's ZPLPreview and the Runs detail page so the
 * visual treatment stays consistent.
 */
export function LabelOutlineOverlay({ format }: { format: LabelFormat }) {
  const across = Math.max(1, format.labelsAcross || 1);
  const labelW = format.width;
  const labelH = format.height;
  const gap = format.horizontalGapThermal || 0;
  const sideM = format.sideMarginThermal || 0;
  const computedLiner = sideM * 2 + across * labelW + (across - 1) * gap;
  const linerW = format.linerWidth || computedLiner;
  // Matches ZPLPreview + generateZPL behavior: if no explicit side margin was
  // set but a liner width was, center the label group on the liner.
  const effectiveSideM = sideM > 0
    ? sideM
    : Math.max(0, (linerW - (across * labelW + (across - 1) * gap)) / 2);
  // Stroke scales with label size so it reads on both tiny 0.5" and 4x6" labels.
  const stroke = Math.max(0.005, Math.min(labelW, labelH) * 0.015);
  const labelPillRadius = Math.min(labelW, labelH) * 0.08;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      viewBox={`0 0 ${linerW} ${labelH}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: '100%', padding: '4px' }}
    >
      {/* One dashed rectangle per across-lane, positioned at
          sideMargin + lane*(labelW+gap), same math as generateZPL. */}
      {Array.from({ length: across }).map((_, lane) => {
        const x = effectiveSideM + lane * (labelW + gap);
        return (
          <g key={lane}>
            <rect
              x={x}
              y={0}
              width={labelW}
              height={labelH}
              fill="none"
              stroke="#d97706"
              strokeOpacity={0.8}
              strokeWidth={stroke}
              strokeDasharray={`${stroke * 4} ${stroke * 2}`}
              rx={labelPillRadius}
              ry={labelPillRadius}
            />
            {across > 1 && (
              <text
                x={x + labelW / 2}
                y={stroke * 4}
                fontSize={labelH * 0.12}
                fill="#d97706"
                fillOpacity={0.7}
                textAnchor="middle"
                dominantBaseline="hanging"
                style={{ fontFamily: 'ui-sans-serif, system-ui' }}
              >
                L{lane + 1}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
