'use client';

import { useId, useState } from 'react';
import { formatSize, parseSizeInput, sizeProblem } from '@/lib/sizeInput';

/**
 * A size box that reads what people type ("1 1/2", "1,5", "1.5in") and never
 * keeps a value it can't use: while typing it passes on only good values,
 * and on leaving the box a bad one goes back to the last good value with a
 * plain message naming the box ("Width must be between 0.1" and 20".").
 */
export function SizeInput({ value, onChange, min, max, what, emptyLabel, className = 'field w-20', 'aria-label': ariaLabel }: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Names the box in messages: "Width", "The top margin". */
  what: string;
  /** Allows an empty box (saved as 0), shown as this placeholder, e.g. "Auto". */
  emptyLabel?: string;
  className?: string;
  'aria-label'?: string;
}) {
  const shown = emptyLabel && !value ? '' : Number.isFinite(value) ? formatSize(value) : '';
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const errorId = useId();
  const check = (raw: string) => {
    if (emptyLabel && !raw.trim()) return { value: 0, problem: null };
    const parsed = parseSizeInput(raw);
    const problem = sizeProblem(raw, parsed, { min, max, unit: '"', what });
    return { value: parsed.ok ? parsed.value : NaN, problem };
  };
  return (
    <span className="inline-flex flex-col">
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel ?? what}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? errorId : undefined}
        value={text ?? shown}
        placeholder={emptyLabel}
        onChange={(e) => {
          setText(e.target.value);
          setError('');
          const next = check(e.target.value);
          if (!next.problem) onChange(next.value);
        }}
        onBlur={() => {
          if (text === null) return;
          const next = check(text);
          setError(next.problem ?? '');
          setText(null);
        }}
        className={className}
      />
      {error && <span id={errorId} role="alert" className="mt-1 max-w-56 text-xs font-normal text-red-400">{error}</span>}
    </span>
  );
}
