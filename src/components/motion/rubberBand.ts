'use client';

import { useEffect, useRef, type RefObject } from 'react';

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Rubber banding at the ends of a scrolling panel: a wheel or trackpad push
 * past the top or bottom stretches the content a little (with resistance,
 * at most 24px) and lets it settle back with an ease-out, instead of a hard
 * stop. Touch screens keep their own native overscroll. Off under reduced
 * motion.
 */
export function useRubberBand(ref: RefObject<HTMLElement | null>) {
  // The panel element can change between renders (a panel with several
  // layouts): attach to whichever element the ref holds now.
  const attached = useRef<{ el: HTMLElement; detach: () => void } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (attached.current?.el === el) return;
    attached.current?.detach();
    attached.current = null;
    if (!el || reduced()) return;
    let pull = 0;
    let settle = 0;
    const apply = () => {
      for (const child of Array.from(el.children) as HTMLElement[]) {
        child.style.translate = pull ? `0 ${pull.toFixed(1)}px` : '';
        child.style.transition = pull ? 'none' : 'translate 320ms var(--ease-out)';
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || el.scrollHeight <= el.clientHeight) return;
      const atTop = el.scrollTop <= 0 && event.deltaY < 0;
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1 && event.deltaY > 0;
      if (!atTop && !atEnd) return;
      // Resistance grows as it stretches: each push moves it less.
      const room = 24 - Math.abs(pull);
      pull += Math.sign(-event.deltaY) * Math.min(Math.abs(event.deltaY), 40) * (room / 24) * 0.25;
      pull = Math.max(-24, Math.min(24, pull));
      apply();
      window.clearTimeout(settle);
      settle = window.setTimeout(() => { pull = 0; apply(); }, 90);
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    attached.current = { el, detach: () => { el.removeEventListener('wheel', onWheel); window.clearTimeout(settle); pull = 0; apply(); } };
  });
  useEffect(() => () => { attached.current?.detach(); attached.current = null; }, []);
}
