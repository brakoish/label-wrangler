/**
 * The app's own progress bar (in place of the browser's <progress>, which
 * looks different on every device). Thin and rounded, amber on the zinc
 * track; `inline` draws a short bar that sits beside its words, so a check's
 * progress never reads as a second copy of the run's progress bar.
 */
export function ProgressBar({ value, max, label, inline = false, className = '' }: { value: number; max: number; label: string; inline?: boolean; className?: string }) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(100, Math.round((value / safeMax) * 100)));
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={Math.min(value, safeMax)}
      className={`${inline ? 'inline-block w-20 shrink-0' : 'block w-full'} h-1 overflow-hidden rounded-full bg-zinc-800 ${className}`}
    >
      <span className="block h-full rounded-full bg-amber-400 transition-[width] duration-200 ease-out" style={{ width: `${pct}%` }} />
    </span>
  );
}
