'use client';

import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

interface SelectOption {
  value: string;
  label: string;
  sublabel?: string;
  icon?: React.ReactNode;
}

interface CustomSelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  compact?: boolean; // For property panel (smaller)
}

export function CustomSelect({ value, options, onChange, placeholder = 'Select...', className = '', compact = false }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Portal-positioned menu coords so the dropdown escapes parent stacking
  // contexts (our .glass cards use backdrop-filter which clips absolute children).
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const selected = options.find((o) => o.value === value);

  // Recalculate menu position when opening + on scroll/resize.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setMenuRect(null);
      return;
    }
    const update = () => {
      if (!triggerRef.current) return;
      const r = triggerRef.current.getBoundingClientRect();
      setMenuRect({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  // Close on click outside (allow clicks inside the portaled menu too).
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Render the dropdown menu into document.body so it isn't clipped by
  // parent stacking contexts (e.g. our .glass cards that use backdrop-filter).
  const renderPortalMenu = (content: React.ReactNode, minWidth?: number) => {
    if (!open || !menuRect || typeof window === 'undefined') return null;
    return createPortal(
      <div
        ref={menuRef}
        style={{
          position: 'fixed',
          top: menuRect.top,
          left: menuRect.left,
          width: menuRect.width,
          minWidth,
          zIndex: 1000,
        }}
      >
        {content}
      </div>,
      document.body,
    );
  };

  if (compact) {
    const menu = (
      <div className="py-1 bg-zinc-900 border border-zinc-700/50 rounded-xl shadow-xl shadow-black/40 backdrop-blur-xl overflow-hidden">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => { onChange(option.value); setOpen(false); }}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs transition-colors ${
              option.value === value
                ? 'bg-amber-500/10 text-amber-400'
                : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
            }`}
          >
            <span className="truncate flex-1 text-left">{option.label}</span>
            {option.value === value && <Check className="w-3 h-3 text-amber-400 flex-shrink-0" />}
          </button>
        ))}
      </div>
    );
    return (
      <div ref={ref} className={`relative ${className}`}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between bg-zinc-900/60 border border-zinc-800/50 rounded-lg text-xs text-zinc-100 px-2 h-7 hover:border-zinc-700 focus:outline-none focus:border-amber-500/30 transition-all"
        >
          <span className="truncate">{selected?.label || placeholder}</span>
          <ChevronDown className={`w-3 h-3 text-zinc-500 flex-shrink-0 ml-1 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {renderPortalMenu(menu, 140)}
      </div>
    );
  }

  const fullMenu = (
    <div className="py-1.5 bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl shadow-black/50 backdrop-blur-xl overflow-hidden max-h-[280px] overflow-y-auto">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => { onChange(option.value); setOpen(false); }}
          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
            option.value === value
              ? 'bg-amber-500/10 text-amber-400'
              : 'text-zinc-300 hover:bg-zinc-800/80 hover:text-zinc-100'
          }`}
        >
          {option.icon && <span className="flex-shrink-0">{option.icon}</span>}
          <div className="flex-1 text-left truncate">
            <span className="truncate">{option.label}</span>
            {option.sublabel && (
              <span className="block text-xs text-zinc-500">{option.sublabel}</span>
            )}
          </div>
          {option.value === value && <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />}
        </button>
      ))}
    </div>
  );

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between bg-zinc-900/50 border border-zinc-800 rounded-xl text-sm text-zinc-100 px-4 py-3 hover:border-zinc-700 focus:outline-none focus:border-amber-500/50 transition-all"
      >
        <div className="flex items-center gap-3 truncate">
          {selected?.icon}
          <div className="text-left truncate">
            <span className="truncate">{selected?.label || <span className="text-zinc-500">{placeholder}</span>}</span>
            {selected?.sublabel && (
              <span className="block text-xs text-zinc-500 truncate">{selected.sublabel}</span>
            )}
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-zinc-500 flex-shrink-0 ml-2 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {renderPortalMenu(fullMenu)}
    </div>
  );
}
