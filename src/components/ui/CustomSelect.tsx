'use client';

import { useState, useRef, useEffect } from 'react';
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

  const selected = options.find((o) => o.value === value);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  if (compact) {
    return (
      <div ref={ref} className={`relative ${className}`}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between bg-zinc-900/60 border border-zinc-800/50 rounded-lg text-xs text-zinc-100 px-2 h-7 hover:border-zinc-700 focus:outline-none focus:border-amber-500/30 transition-all"
        >
          <span className="truncate">{selected?.label || placeholder}</span>
          <ChevronDown className={`w-3 h-3 text-zinc-500 flex-shrink-0 ml-1 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="absolute z-50 mt-1 w-full min-w-[140px] py-1 bg-zinc-900 border border-zinc-700/50 rounded-xl shadow-xl shadow-black/40 backdrop-blur-xl overflow-hidden">
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
        )}
      </div>
    );
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
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
      {open && (
        <div className="absolute z-50 mt-2 w-full py-1.5 bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl shadow-black/50 backdrop-blur-xl overflow-hidden max-h-[280px] overflow-y-auto">
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
      )}
    </div>
  );
}
