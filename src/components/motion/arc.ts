/**
 * Move an SVG item (or any element) from where it was to where it is now
 * along a gentle arc instead of a straight line: the path bows upward,
 * timed with an ease-in-out. `dx`/`dy` are how far it moved, in the
 * element's own units (SVG user units for canvas items). Off under reduced
 * motion.
 */
export function arcMove(el: Element | null, dx: number, dy: number, duration = 420) {
  if (!el || typeof window === 'undefined' || !('animate' in el)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) {
    el.animate([{ opacity: 0, scale: '0.92' }, { opacity: 1, scale: '1' }], { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    return;
  }
  // A quadratic curve from the old spot (dx, dy) to (0, 0); its control point
  // sits off the straight line, on the upper side.
  let nx = -dy / dist;
  let ny = dx / dist;
  if (ny > 0) { nx = -nx; ny = -ny; }
  const bow = Math.min(dist * 0.3, 80);
  const cx = dx / 2 + nx * bow;
  const cy = dy / 2 + ny * bow;
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const frames: Keyframe[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = ease(i / 16);
    const x = (1 - t) * (1 - t) * dx + 2 * (1 - t) * t * cx;
    const y = (1 - t) * (1 - t) * dy + 2 * (1 - t) * t * cy;
    frames.push({ translate: `${x.toFixed(2)}px ${y.toFixed(2)}px` });
  }
  el.animate(frames, { duration, easing: 'linear' });
}
