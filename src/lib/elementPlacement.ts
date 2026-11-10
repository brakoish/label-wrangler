/**
 * Where to put a newly added element so it doesn't land exactly on top of
 * one that is already there: step down and right until the spot is free,
 * wrapping back to the start if it would run off the label.
 */
export function staggeredPosition(
  existing: ReadonlyArray<{ x: number; y: number }>,
  start: { x: number; y: number },
  step: number,
  label: { width: number; height: number },
  size: { width: number; height: number },
): { x: number; y: number } {
  const round = (v: number) => Math.round(v * 100) / 100;
  const taken = (x: number, y: number) => existing.some((el) => Math.abs(el.x - x) < step / 2 && Math.abs(el.y - y) < step / 2);
  const maxX = Math.max(start.x, label.width - size.width);
  const maxY = Math.max(start.y, label.height - size.height);
  let x = start.x;
  let y = start.y;
  for (let i = 0; i < 50 && taken(x, y); i++) {
    x += step;
    y += step;
    if (x > maxX || y > maxY) {
      // Wrap to a new diagonal, shifted right by half a step each time.
      x = start.x + ((i + 1) % 4) * (step / 2);
      y = start.y;
    }
  }
  return { x: round(x), y: round(y) };
}
