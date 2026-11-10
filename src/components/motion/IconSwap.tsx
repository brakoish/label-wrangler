import type { ReactNode } from 'react';

/**
 * Two icons in one spot that crossfade with a blur when `on` flips, instead
 * of snapping (the old one fades out as the new one fades in). Reduced motion
 * swaps them at once.
 */
export function IconSwap({ on, onIcon, offIcon, className = '' }: { on: boolean; onIcon: ReactNode; offIcon: ReactNode; className?: string }) {
  return (
    <span className={`icon-swap shrink-0 ${className}`} aria-hidden="true">
      <span data-shown={on} className="inline-flex">{onIcon}</span>
      <span data-shown={!on} className="inline-flex">{offIcon}</span>
    </span>
  );
}
