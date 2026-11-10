'use client';

import { useState, useRef, useEffect, useLayoutEffect, useId } from 'react';
import { onDialogOpen } from './dialogStack';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { usePresence } from './usePresence';

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
  /** id for the trigger, so a <label htmlFor> can name it. */
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  disabled?: boolean;
}

export function CustomSelect({ value, options, onChange, placeholder = 'Choose…', className = '', compact = false, id, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy, disabled = false }: CustomSelectProps) {
  const [open, setOpenState] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const optionId = (index: number) => `${listId}-opt-${index}`;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    if (next) setActive(Math.max(0, options.findIndex((o) => o.value === value)));
  };
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Portal-positioned menu coords so the dropdown escapes parent stacking
  // contexts and overflow-hidden panels.
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  const selected = options.find((o) => o.value === value);
  // Stays mounted for a short exit; reopening mid-exit turns it around.
  const { present, state: menuState } = usePresence(open, 130);

  // Recalculate menu position when opening + on scroll/resize.
  useLayoutEffect(() => {
    if (!present || !triggerRef.current) {
      setMenuRect(null);
      return;
    }
    const update = () => {
      if (!triggerRef.current) return;
      const r = triggerRef.current.getBoundingClientRect();
      setMenuRect({
        top: r.bottom + 4,
        left: r.left,
        width: r.width,
        maxHeight: Math.max(120, Math.min(320, window.innerHeight - r.bottom - 12)),
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [present]);

  // Close on click outside (allow clicks inside the portaled menu too).
  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpenState(false);
    };
    // Pointer down (mouse, touch or pen) outside closes it before any click
    // runs, and a dialog opening by any route closes it too.
    document.addEventListener('pointerdown', handler, true);
    const stop = onDialogOpen(() => setOpenState(false));
    return () => { document.removeEventListener('pointerdown', handler, true); stop(); };
  }, [open]);

  // Keep the active option scrolled into view while moving with the keyboard.
  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpenState(false);
    triggerRef.current?.focus();
  };

  // Keyboard model of a select-only combobox: focus stays on the trigger and
  // aria-activedescendant points at the highlighted option.
  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const last = options.length - 1;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) setOpen(true); else setActive((i) => Math.min(last, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) setOpen(true); else setActive((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        if (open) { e.preventDefault(); setActive(0); }
        break;
      case 'End':
        if (open) { e.preventDefault(); setActive(last); }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (open && active >= 0) choose(active); else setOpen(true);
        break;
      case 'Escape':
        if (open) { e.preventDefault(); e.stopPropagation(); setOpenState(false); }
        break;
      case 'Tab':
        if (open) setOpenState(false);
        break;
    }
  };

  const triggerA11y = {
    id,
    role: 'combobox' as const,
    'aria-haspopup': 'listbox' as const,
    'aria-expanded': open,
    'aria-controls': listId,
    'aria-activedescendant': open && active >= 0 ? optionId(active) : undefined,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    disabled,
    onKeyDown: onTriggerKeyDown,
  };

  // Render the dropdown menu into document.body so it isn't clipped by
  // parent stacking contexts and overflow-hidden panels.
  const renderPortalMenu = (content: React.ReactNode, minWidth?: number) => {
    if (!present || !menuRect || typeof window === 'undefined') return null;
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
        <div style={{ maxHeight: menuRect.maxHeight }} data-state={menuState} className="pop-layer overflow-y-auto rounded-lg">
          {content}
        </div>
      </div>,
      document.body,
    );
  };

  if (compact) {
    const menu = (
      <div id={listId} role="listbox" aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} className="py-1 bg-zinc-900 rounded-lg shadow-xl shadow-black/50 overflow-hidden">
        {options.map((option, index) => (
          <div
            key={option.value}
            id={optionId(index)}
            role="option"
            aria-selected={option.value === value}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(index)}
            className={`w-full flex cursor-pointer items-center gap-2 px-2.5 min-h-control-sm text-xs ${
              option.value === value
                ? 'text-amber-300'
                : 'text-zinc-300'
            } ${index === active ? 'bg-zinc-800 text-zinc-100' : ''}`}
          >
            <span className="truncate flex-1 text-left">{option.label}</span>
            {option.value === value && <Check className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />}
          </div>
        ))}
      </div>
    );
    return (
      <div ref={ref} className={`relative ${className}`}>
        <button
          ref={triggerRef}
          type="button"
          {...triggerA11y}
          onClick={() => setOpen(!open)}
          className="field field-sm flex items-center justify-between text-left text-xs"
        >
          <span className="truncate">{selected?.label || placeholder}</span>
          <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 flex-shrink-0 ml-1 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
        {renderPortalMenu(menu, 140)}
      </div>
    );
  }

  const fullMenu = (
    <div id={listId} role="listbox" aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} className="py-1 bg-zinc-900 rounded-lg shadow-xl shadow-black/50 overflow-hidden">
      {options.map((option, index) => (
        <div
          key={option.value}
          id={optionId(index)}
          role="option"
          aria-selected={option.value === value}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setActive(index)}
          onClick={() => choose(index)}
          className={`w-full flex cursor-pointer items-center gap-3 px-3 py-2 min-h-control text-sm ${
            option.value === value
              ? 'text-amber-300'
              : 'text-zinc-300'
          } ${index === active ? 'bg-zinc-800 text-zinc-100' : ''}`}
        >
          {option.icon && <span className="flex-shrink-0">{option.icon}</span>}
          <div className="flex-1 text-left truncate">
            <span className="truncate">{option.label}</span>
            {option.sublabel && (
              <span className="block text-xs text-zinc-500">{option.sublabel}</span>
            )}
          </div>
          {option.value === value && <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />}
        </div>
      ))}
    </div>
  );

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        {...triggerA11y}
        onClick={() => setOpen(!open)}
        className="field flex items-center justify-between py-1.5 text-left"
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
        <ChevronDown className={`w-4 h-4 text-zinc-400 flex-shrink-0 ml-2 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {renderPortalMenu(fullMenu)}
    </div>
  );
}
