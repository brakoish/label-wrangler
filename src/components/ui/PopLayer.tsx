'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode, type Ref, type RefObject } from 'react';
import { usePresence } from './usePresence';
import { onDialogOpen } from './dialogStack';

/**
 * A popover panel that grows out of its trigger and shrinks back into it,
 * like the shared menus and selects: CSS transitions (`.pop-layer`), so
 * closing part-way and reopening turns around from where it is. It stays
 * mounted while it leaves, inert so nothing in it can be pressed. Set the
 * origin with `[--origin:top_right]` (or similar) in `className`. Reduced
 * motion turns the movement off (globals.css).
 */
export function PopLayer({ open, as = 'div', id, className = '', style, ref, children }: {
  open: boolean;
  as?: 'div' | 'ul';
  id?: string;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  // Exits are about 20% shorter than entrances (160ms in, 130ms out).
  const { present, state } = usePresence(open, 130);
  if (!present) return null;
  const Tag = as;
  return (
    <Tag ref={ref as Ref<never>} id={id} data-state={state} inert={state === 'closed'} style={style} className={`pop-layer ${className}`}>
      {children}
    </Tag>
  );
}

/**
 * Closes an open popover the way the shared menus close: Escape (focus goes
 * back to the trigger, the last ref), a press outside every given element,
 * or a dialog opening on top.
 */
export function useDismiss(open: boolean, close: () => void, inside: ReadonlyArray<RefObject<HTMLElement | null>>) {
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  const insideRef = useRef(inside);
  useEffect(() => { insideRef.current = inside; });
  useEffect(() => {
    if (!open) return;
    const within = (target: EventTarget | null) => target instanceof Node && insideRef.current.some((ref) => ref.current?.contains(target));
    const onDown = (event: Event) => { if (!within(event.target)) closeRef.current(); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Only when focus is in the popover or its trigger (or nowhere), so an
      // Escape meant for something else on the page isn't taken.
      const active = document.activeElement;
      if (active && active !== document.body && !within(active)) return;
      event.preventDefault();
      closeRef.current();
      const refs = insideRef.current;
      refs[refs.length - 1]?.current?.focus();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    const stop = onDialogOpen(() => closeRef.current());
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey); stop(); };
  }, [open]);
}
