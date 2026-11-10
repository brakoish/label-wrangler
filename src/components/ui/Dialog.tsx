'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { isTopDialogLayer, pushDialogLayer, removeDialogLayer } from './dialogStack';
import { originFromTrigger, usePresence } from './usePresence';

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
/**
 * Where the last press happened (pointer, or the focused element on Enter or
 * Space), kept briefly so a dialog opened from a menu item that has already
 * closed still grows out of the spot that opened it.
 */
let lastPress: { x: number; y: number; at: number } | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (event) => { lastPress = { x: event.clientX, y: event.clientY, at: Date.now() }; }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target instanceof Element ? event.target.getBoundingClientRect() : null;
    if (target && (target.width || target.height)) lastPress = { x: target.left + target.width / 2, y: target.top + target.height / 2, at: Date.now() };
  }, true);
}
function originFromLastPress(panel: Element | null): string | undefined {
  if (!panel || !lastPress || Date.now() - lastPress.at > 1500) return undefined;
  const p = panel.getBoundingClientRect();
  return `${Math.round(lastPress.x - p.left)}px ${Math.round(lastPress.y - p.top)}px`;
}

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
    const layer = pushDialogLayer();
    const onKeyDown = (event: KeyboardEvent) => {
      // A dialog opened on top of this one handles the keys.
      if (!panelRef.current || !isTopDialogLayer(layer)) return;
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
      removeDialogLayer(layer);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [open, initialFocus]);

  // Keep the panel mounted for its short exit, showing what it showed while
  // open (callers often clear the data that fills it on close). Reopening
  // during the exit turns the transition around instead of restarting it.
  const { present, state } = usePresence(open, 160);
  const [shown, setShown] = useState({ title, description, children });
  if (open && (shown.title !== title || shown.description !== description || shown.children !== children)) {
    setShown({ title, description, children });
  }
  // Grow out of (and shrink back into) whatever opened the dialog.
  // Runs before focus moves into the panel, so activeElement is the opener.
  const [origin, setOrigin] = useState<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    const trigger = active && active !== document.body && !panelRef.current?.contains(active) ? active : null;
    // A menu item that opened the dialog is gone by now: grow from where it was pressed.
    setOrigin(originFromTrigger(trigger, panelRef.current) ?? originFromLastPress(panelRef.current));
  }, [open]);

  if (!present || typeof document === 'undefined') return null;
  const view = open ? { title, description, children } : shown;
  return createPortal(
    <div
      className="dialog-backdrop fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/70"
      data-state={state}
      onMouseDown={(event) => { if (event.target === event.currentTarget && dismissible && open) onClose(); }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={view.description ? descriptionId : undefined}
        tabIndex={-1}
        style={origin ? { ['--origin' as string]: origin } : undefined}
        className={`dialog-panel w-full ${className} max-h-[calc(100dvh-1.5rem)] overflow-y-auto bg-zinc-900 rounded-xl shadow-2xl shadow-black/50 ring-1 ring-zinc-800 p-5 sm:p-6 space-y-5`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-zinc-100">{view.title}</h2>
            {view.description && <p id={descriptionId} className="mt-1 text-sm text-zinc-400">{view.description}</p>}
          </div>
          {!hideClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="btn btn-ghost btn-icon -mr-2 -mt-2 shrink-0 text-zinc-400"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {view.children}
      </div>
    </div>,
    document.body,
  );
}
