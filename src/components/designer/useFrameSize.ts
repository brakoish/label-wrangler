'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * The content size of the box the label is fitted into. Measured as soon as
 * the box is laid out, then again whenever it changes size, once web fonts
 * have loaded and on the next frames after mount: on a busy computer the
 * first layout can come before the page has its final size, and a label
 * fitted to that would stay tiny.
 */
export function useFrameSize(ref: RefObject<HTMLElement | null>, initial = { width: 600, height: 400 }) {
  const [size, setSize] = useState(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const width = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const height = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      // A hidden box (display: none) measures 0 × 0: keep the last size.
      if (width <= 0 && height <= 0) return;
      setSize((prev) => (Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5 ? prev : { width, height }));
    };
    measure();
    let frames = 0;
    let raf = requestAnimationFrame(function again() { measure(); if (++frames < 10) raf = requestAnimationFrame(again); });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    let live = true;
    void document.fonts?.ready.then(() => { if (live) measure(); });
    window.addEventListener('resize', measure);
    return () => { live = false; cancelAnimationFrame(raf); observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [ref]);
  return size;
}
