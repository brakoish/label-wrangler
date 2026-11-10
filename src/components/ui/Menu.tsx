'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { MoreHorizontal } from 'lucide-react';
import { usePresence } from './usePresence';

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
 * A quiet overflow menu ("More"). The trigger is a ghost button; the menu
 * grows out of it and shrinks back into it, and closing mid-way reverses.
 * Keyboard: Enter/Space/ArrowDown open it, arrows move, Escape closes and
 * returns focus to the trigger.
 */
export function Menu({ items, label = 'More', showLabel = true, className = '', align = 'end' }: { items: MenuItem[]; label?: string; showLabel?: boolean; className?: string; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { present, state } = usePresence(open, 130);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number; up: boolean } | null>(null);
  const enabled = items.map((item, index) => (item.disabled ? -1 : index)).filter((index) => index >= 0);

  useLayoutEffect(() => {
    if (!present || !triggerRef.current) return;
    const place = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      const up = window.innerHeight - r.bottom < 260 && r.top > 260;
      setPos({ top: up ? r.top - 4 : r.bottom + 4, up, ...(align === 'end' ? { right: window.innerWidth - r.right } : { left: r.left }) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [present, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus();
  }, [open, active, pos]);

  const close = (focusTrigger = true) => { setOpen(false); if (focusTrigger) triggerRef.current?.focus(); };
  const openMenu = () => { setActive(enabled[0] ?? 0); setOpen(true); };
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

  const itemClass = (item: MenuItem) => `press flex w-full min-h-control items-center gap-2.5 rounded-md px-3 text-left text-sm outline-none focus-visible:bg-zinc-800 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-500 ${item.danger ? 'text-red-400' : 'text-zinc-300 hover:text-zinc-100'}`;
  const firstDanger = items.findIndex((item) => item.danger);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={showLabel ? undefined : label}
        title={showLabel ? undefined : label}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => { if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); openMenu(); } }}
        className={`btn btn-ghost btn-sm ${showLabel ? '' : 'btn-icon'} text-zinc-300 ${className}`}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        {showLabel && label}
      </button>
      {present && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          data-state={state}
          onKeyDown={onMenuKey}
          style={{
            position: 'fixed',
            zIndex: 1000,
            top: pos.up ? undefined : pos.top,
            bottom: pos.up ? window.innerHeight - pos.top : undefined,
            left: pos.left,
            right: pos.right,
            ['--origin' as string]: `${pos.up ? 'bottom' : 'top'} ${align === 'end' ? 'right' : 'left'}`,
          }}
          className="pop-layer min-w-[220px] max-w-[calc(100vw-1.5rem)] rounded-lg bg-zinc-900 p-1 shadow-xl shadow-black/50 ring-1 ring-zinc-700"
        >
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
