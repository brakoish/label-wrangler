'use client';

/**
 * Crossfades between icons: the old one blurs and fades out while the new one
 * sharpens in, in the same spot. Every icon stays mounted so the change can
 * reverse mid-way. `active` picks which one shows.
 */
export function IconSwap<K extends string>({ active, icons, className = '' }: { active: K; icons: Record<K, React.ReactNode>; className?: string }) {
  return (
    <span aria-hidden="true" className={`icon-swap ${className}`}>
      {(Object.keys(icons) as K[]).map((key) => (
        <span key={key} data-active={key === active ? '' : undefined}>{icons[key]}</span>
      ))}
    </span>
  );
}
