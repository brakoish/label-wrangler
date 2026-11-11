'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { MoreHorizontal } from 'lucide-react';
import { usePresence } from './usePresence';
import { onDialogOpen } from './dialogStack';

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  /** Navigate here when chosen. */
  href?: string;
  onSelect?: () => void;
  /** Destructive action: red text, separated from the rest by space. */
  danger?: boolean;
  disabled?: boolean;
}

/**
 * A quiet overflow menu ("More"). The trigger is a quiet grey ghost button
 * (a menu, not an action, so not amber); the menu
 * grows out of it and shrinks back into it, and closing mid-way reverses.
 * Keyboard: Enter/Space/ArrowDown open it, arrows move, Escape closes and
 * returns focus to the trigger. On a phone it is a sheet at the bottom of the
 * screen (always fully on screen, drag down to close); elsewhere it is kept
 * inside the window.
 */
export function Menu({ items, label = 'More', showLabel = true, className = '', align = 'end', closeKey, triggerTabIndex }: {
  items: MenuItem[]; label?: string; showLabel?: boolean; className?: string; align?: 'start' | 'end';
  /** When this changes, an open menu closes (for example, a notice appeared that it would cover). */
  closeKey?: string;
  /**
   * -1 takes the trigger out of the Tab order, for a list that opens each
   * row's menu from the row itself (Shift+F10) so a row is one Tab stop.
   */
  triggerTabIndex?: number;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number; up: boolean; sheet?: boolean } | null>(null);
  // Drag distance of the phone sheet (down closes it; up stretches a little, then stops).
  const [drag, setDrag] = useState<number | null>(null);
  const dragStart = useRef<number | null>(null);
  // The last few pointer positions while dragging, for the speed at release.
  const dragTrail = useRef<Array<{ y: number; t: number }>>([]);
  // Let go mid-drag: how long the sheet takes to slide the rest of the way out.
  const [flingMs, setFlingMs] = useState<number | null>(null);
  // The phone sheet leaves in 190ms (or its fling time); the popover in 130ms.
  const { present, state } = usePresence(open, pos?.sheet ? (flingMs ?? 190) : 130);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  // A new closeKey closes the menu (focus stays where it is).
  const [seenCloseKey, setSeenCloseKey] = useState(closeKey);
  if (closeKey !== seenCloseKey) { setSeenCloseKey(closeKey); if (open) setOpen(false); }
  const enabled = items.map((item, index) => (item.disabled ? -1 : index)).filter((index) => index >= 0);

  useLayoutEffect(() => {
    if (!present || !triggerRef.current) return;
    const place = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      if (window.matchMedia('(max-width: 639px)').matches) { setPos({ top: 0, up: false, sheet: true }); return; }
      const up = window.innerHeight - r.bottom < 260 && r.top > 260;
      setPos({ top: up ? r.top - 4 : r.bottom + 4, up, ...(align === 'end' ? { right: Math.max(12, window.innerWidth - r.right) } : { left: Math.max(12, r.left) }) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [present, align]);

  // Never past the window's edge: a menu wider than the room beside its trigger moves in.
  useLayoutEffect(() => {
    if (!pos || pos.sheet || !menuRef.current) return;
    const box = menuRef.current.getBoundingClientRect();
    if (box.left < 12) setPos((p) => (p && !p.sheet ? { ...p, left: 12, right: undefined } : p));
    else if (box.right > window.innerWidth - 12) setPos((p) => (p && !p.sheet ? { ...p, left: undefined, right: 12 } : p));
  }, [pos]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: Event) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    const stop = onDialogOpen(() => setOpen(false));
    return () => { document.removeEventListener('pointerdown', onDown, true); stop(); };
  }, [open]);

  // Opened by a tap or click: focus the menu itself, so no item shows a focus
  // ring the person didn't ask for. Arrow keys still move to the items.
  const byPointer = useRef(false);
  useEffect(() => {
    if (!open || !menuRef.current) return;
    if (byPointer.current) { byPointer.current = false; menuRef.current.focus({ preventScroll: true }); return; }
    menuRef.current.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus();
  }, [open, active, pos]);

  const close = (focusTrigger = true) => { setOpen(false); if (focusTrigger) triggerRef.current?.focus(); };
  const openMenu = () => { setActive(enabled[0] ?? 0); setFlingMs(null); setOpen(true); };
  const move = (step: number) => {
    if (!enabled.length) return;
    const at = enabled.indexOf(active);
    setActive(enabled[(at + step + enabled.length) % enabled.length]);
  };
  const choose = (item: MenuItem) => {
    if (item.disabled) return;
    close(!item.href);
    item.onSelect?.();
  };
  const onMenuKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (event.key === 'Home') { event.preventDefault(); setActive(enabled[0] ?? 0); }
    else if (event.key === 'End') { event.preventDefault(); setActive(enabled[enabled.length - 1] ?? 0); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'Tab') close(false);
  };

  // Rubber band: past the top the sheet follows a fraction of the finger, never far.
  const sheetOffset = drag === null ? 0 : drag >= 0 ? drag : -Math.min(16, Math.sqrt(-drag) * 2);
  const onSheetDown = (event: React.PointerEvent) => {
    dragStart.current = event.clientY; setDrag(0);
    dragTrail.current = [{ y: event.clientY, t: event.timeStamp }];
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };
  const onSheetMove = (event: React.PointerEvent) => {
    if (dragStart.current === null) return;
    setDrag(event.clientY - dragStart.current);
    dragTrail.current = [...dragTrail.current.filter((p) => event.timeStamp - p.t < 100), { y: event.clientY, t: event.timeStamp }];
  };
  const onSheetUp = () => {
    const moved = drag ?? 0;
    const trail = dragTrail.current;
    const first = trail[0], last = trail[trail.length - 1];
    // Speed over the last 100ms, in px per ms (positive is downwards).
    const speed = first && last && last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
    dragStart.current = null; dragTrail.current = []; setDrag(null);
    // A long drag or a quick flick down closes it. It carries on from where
    // the finger let go at about the finger's speed, instead of stopping.
    if (moved > 72 || (moved > 16 && speed > 0.5)) {
      const left = Math.max(0, (menuRef.current?.offsetHeight ?? 320) - moved);
      setFlingMs(Math.round(Math.min(240, Math.max(120, left / Math.max(speed, 1.2)))));
      close();
    }
  };

  const itemClass = (item: MenuItem) => `press flex w-full min-h-control items-center gap-2.5 rounded-md px-3 text-left text-sm outline-none focus-visible:bg-zinc-800 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-500 ${item.danger ? 'text-red-400' : 'text-zinc-300 hover:text-zinc-100'}`;
  const firstDanger = items.findIndex((item) => item.danger);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        tabIndex={triggerTabIndex}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={showLabel ? undefined : label}
        title={showLabel ? undefined : label}
        onPointerDown={() => { byPointer.current = true; }}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => { byPointer.current = false; if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); openMenu(); } }}
        className={`btn btn-ghost btn-quiet btn-sm ${showLabel ? '' : 'btn-icon'} ${className}`}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        {showLabel && label}
      </button>
      {present && pos?.sheet && typeof document !== 'undefined' && createPortal(
        <div aria-hidden="true" data-state={state} className="menu-sheet-scrim" style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => close()} />,
        document.body,
      )}
      {present && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          data-state={state}
          data-dragging={drag !== null ? '' : undefined}
          data-flung={flingMs !== null ? '' : undefined}
          onKeyDown={onMenuKey}
          style={pos.sheet ? {
            position: 'fixed', zIndex: 1000, left: 0, right: 0, bottom: 0,
            ['--sheet-y' as string]: `${sheetOffset}px`,
            ...(flingMs !== null ? { ['--fling-ms' as string]: `${flingMs}ms` } : {}),
          } : {
            position: 'fixed',
            zIndex: 1000,
            top: pos.up ? undefined : pos.top,
            bottom: pos.up ? window.innerHeight - pos.top : undefined,
            left: pos.left,
            right: pos.right,
            ['--origin' as string]: `${pos.up ? 'bottom' : 'top'} ${align === 'end' ? 'right' : 'left'}`,
          }}
          className={pos.sheet
            ? 'menu-sheet outline-none rounded-t-2xl bg-zinc-900 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-xl shadow-black/50'
            : 'pop-layer outline-none min-w-[220px] max-w-[calc(100vw-1.5rem)] rounded-lg bg-zinc-900 p-1 shadow-xl shadow-black/50'}
        >
          {pos.sheet && <div className="flex h-6 touch-none cursor-grab items-center justify-center" onPointerDown={onSheetDown} onPointerMove={onSheetMove} onPointerUp={onSheetUp} onPointerCancel={onSheetUp}>
            <span aria-hidden="true" className="h-1 w-10 rounded-full bg-zinc-700" />
          </div>}
          {items.map((item, index) => {
            const common = {
              role: 'menuitem',
              tabIndex: index === active ? 0 : -1,
              'data-index': index,
              onMouseEnter: () => !item.disabled && setActive(index),
              className: `${itemClass(item)} ${index === firstDanger && index > 0 ? 'mt-1' : ''}`,
            } as const;
            return item.href && !item.disabled ? (
              <Link key={item.label} href={item.href} {...common} onClick={() => choose(item)}>
                {item.icon}<span>{item.label}</span>
              </Link>
            ) : (
              <button key={item.label} type="button" disabled={item.disabled} {...common} onClick={() => choose(item)}>
                {item.icon}<span>{item.label}</span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
