import { Printer } from 'lucide-react';
import type { LabelFormat } from '@/lib/types';

/**
 * A to-scale silhouette of a label size (up to four across for multi-up
 * rolls). Purely decorative: it fills its box, so size it with the parent.
 */
export function LabelGlyph({ format }: { format: LabelFormat | null }) {
  if (!format || !(format.width > 0) || !(format.height > 0)) return <Printer className="w-4 h-4 text-zinc-500" aria-hidden="true" />;
  const across = format.type === 'thermal' ? Math.max(1, Math.min(4, format.labelsAcross || 1)) : 1;
  const gap = across > 1 ? format.width * 0.12 : 0;
  const totalW = format.width * across + gap * (across - 1);
  const box = Math.max(totalW / 1.6, format.height);
  const pad = box * 0.08;
  return (
    <svg viewBox={`${-pad} ${-pad} ${box * 1.6 + pad * 2} ${box + pad * 2}`} className="h-full w-full" aria-hidden="true">
      {Array.from({ length: across }).map((_, i) => (
        <rect
          key={i}
          x={(box * 1.6 - totalW) / 2 + i * (format.width + gap)}
          y={(box - format.height) / 2}
          width={format.width}
          height={format.height}
          rx={Math.min(format.width, format.height) * 0.08}
          fill="#e4e4e7"
        />
      ))}
    </svg>
  );
}
