'use client';
import { ChevronDown } from 'lucide-react';

/**
 * A section that folds open and shut. It stays mounted, so closing animates
 * too (and can be interrupted part-way), and its content is inert while shut.
 * Timing lives in globals.css (.fold): ease-out in, ~20% shorter ease-in out,
 * off for reduced motion.
 */
export function Fold({ open, id, children, className = '' }: { open: boolean; id?: string; children: React.ReactNode; className?: string }) {
  return (
    <div id={id} className={`fold ${className}`} data-open={open ? 'true' : 'false'} inert={!open} aria-hidden={!open}>
      <div className="fold-inner">{children}</div>
    </div>
  );
}

/** The button that opens a Fold: text plus a chevron that turns. */
export function FoldToggle({ open, onToggle, controls, children, className = '' }: { open: boolean; onToggle: () => void; controls?: string; children: React.ReactNode; className?: string }) {
  return (
    <button type="button" aria-expanded={open} aria-controls={controls} onClick={onToggle} className={`press flex min-h-control items-center gap-1.5 text-left text-sm text-zinc-400 hover:text-zinc-100 ${className}`}>
      <span className="min-w-0">{children}</span>
      <ChevronDown aria-hidden="true" className="fold-chevron size-4 shrink-0" data-open={open ? 'true' : 'false'} />
    </button>
  );
}
