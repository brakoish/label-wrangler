/**
 * The sliding highlight for a `.segmented` control. Put it as the first child
 * of the control; segments are equal width, so the highlight only needs the
 * active index and the number of segments. Hidden when nothing is active.
 */
export function SegmentedIndicator({ index, count }: { index: number; count: number }) {
  if (index < 0 || count < 1) return null;
  return (
    <span
      aria-hidden="true"
      className="segmented-indicator"
      style={{ width: `calc((100% - 6px) / ${count})`, transform: `translateX(${index * 100}%)` }}
    />
  );
}
