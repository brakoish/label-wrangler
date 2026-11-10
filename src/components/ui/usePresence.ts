'use client';

import { useEffect, useState } from 'react';

/**
 * Keeps a layer mounted while it animates out. The layer's CSS transitions
 * from its current state, so closing and reopening mid-animation reverses
 * smoothly instead of restarting from zero. `exitMs` is a fallback in case
 * no transitionend arrives (reduced motion, hidden tab).
 */
export function usePresence(open: boolean, exitMs: number): { present: boolean; state: 'open' | 'closed'; onExited: () => void } {
  const [present, setPresent] = useState(open);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setPresent(true);
  }
  useEffect(() => {
    if (open || !present) return;
    const timer = setTimeout(() => setPresent(false), exitMs + 40);
    return () => clearTimeout(timer);
  }, [open, present, exitMs]);
  return { present, state: open ? 'open' : 'closed', onExited: () => { if (!open) setPresent(false); } };
}

/**
 * transform-origin, in the panel's own coordinates, that points at the
 * element which opened it, so the panel grows out of its trigger.
 */
export function originFromTrigger(trigger: Element | null, panel: Element | null): string | undefined {
  if (!trigger || !panel) return undefined;
  const t = trigger.getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  if (!t.width && !t.height) return undefined;
  const x = Math.round(t.left + t.width / 2 - p.left);
  const y = Math.round(t.top + t.height / 2 - p.top);
  return `${x}px ${y}px`;
}
