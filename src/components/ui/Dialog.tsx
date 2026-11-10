'use client';

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Visible title; also used as the dialog's accessible name. */
  title: React.ReactNode;
  /** Optional one-line description read after the title. */
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Extra classes for the panel (width etc.). */
  className?: string;
  /** Hide the built-in close button (the dialog still closes on Escape). */
  hideClose?: boolean;
  /** Block Escape / backdrop close while something is saving. */
  dismissible?: boolean;
  /** Element to focus first; defaults to the first focusable control. */
  initialFocus?: React.RefObject<HTMLElement | null>;
  role?: 'dialog' | 'alertdialog';
}

/**
 * One accessible modal: role=dialog, aria-modal, labelled by its title,
 * Escape closes, Tab is trapped inside, and focus returns to whatever
 * opened it. Keep the existing panel look so later restyling has one place.
 */
export function Dialog({ open, onClose, title, description, children, className = 'max-w-md', hideClose = false, dismissible = true, initialFocus, role = 'dialog' }: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  useEffect(() => { onCloseRef.current = onClose; dismissibleRef.current = dismissible; });

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusFirst = () => {
      const target = initialFocus?.current ?? panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
      target?.focus();
    };
    const frame = requestAnimationFrame(focusFirst);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!panelRef.current) return;
      if (event.key === 'Escape') {
        if (!dismissibleRef.current) return;
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) { event.preventDefault(); panelRef.current.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panelRef.current.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || !panelRef.current.contains(active))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown, true);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [open, initialFocus]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onMouseDown={(event) => { if (event.target === event.currentTarget && dismissible) onClose(); }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`w-full ${className} max-h-[calc(100vh-2rem)] overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl p-6 space-y-5 `}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-zinc-100">{title}</h2>
            {description && <p id={descriptionId} className="mt-1 text-sm text-zinc-400">{description}</p>}
          </div>
          {!hideClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 -mt-2 h-10 w-10 shrink-0 grid place-items-center rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
