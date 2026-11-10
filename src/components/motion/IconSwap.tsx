import type { ReactNode } from 'react';
import { IconSwap as Swap } from '@/components/ui/IconSwap';

/**
 * Two icons in one spot that crossfade with a blur when `on` flips, instead
 * of snapping. A thin wrapper over the shared IconSwap, so both use one set
 * of styles. Reduced motion swaps them at once.
 */
export function IconSwap({ on, onIcon, offIcon, className = '' }: { on: boolean; onIcon: ReactNode; offIcon: ReactNode; className?: string }) {
  return <Swap active={on ? 'on' : 'off'} icons={{ on: onIcon, off: offIcon }} className={`shrink-0 ${className}`} />;
}
