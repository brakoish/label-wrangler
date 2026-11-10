'use client';

import { useLayoutEffect, useRef } from 'react';

/** Buttons (or links) that are segments of one control: its direct children. */
const segmentsOf = (control: HTMLElement) =>
  Array.from(control.querySelectorAll<HTMLElement>(':scope > button, :scope > a'));

const isOn = (segment: HTMLElement) =>
  segment.getAttribute('aria-checked') === 'true'
  || segment.getAttribute('aria-selected') === 'true'
  || segment.getAttribute('aria-current') === 'page';

const usable = (segment: HTMLElement) =>
  !(segment as HTMLButtonElement).disabled && segment.getAttribute('aria-disabled') !== 'true';

/**
 * Keyboard and roles for one `.segmented` control, so it works like a set of
 * radio buttons (or tabs): one tab stop, and the arrow keys, Home and End move
 * to another segment and choose it.
 *
 * - A group of `aria-pressed` buttons becomes a radiogroup of radios
 *   (`aria-checked` mirrors the pressed state).
 * - A tablist of tabs, or a radiogroup of radios, keeps its roles.
 * - A control that already manages its own tab stops (a segment carries
 *   `tabIndex` from React) is left alone.
 *
 * Runs after every render of the control, so it follows React's changes.
 */
function enhance(control: HTMLElement, fallbackIndex: number) {
  const segments = segmentsOf(control);
  if (!segments.length) return;
  if (!control.hasAttribute('data-seg-keys')) {
    if (segments.some((segment) => segment.hasAttribute('tabindex'))) return;
    control.setAttribute('data-seg-keys', '');
  }
  const asTabs = control.getAttribute('role') === 'tablist';
  if (!asTabs) {
    if (control.getAttribute('role') !== 'radiogroup') control.setAttribute('role', 'radiogroup');
    for (const segment of segments) {
      if (segment.getAttribute('role') !== 'radio') segment.setAttribute('role', 'radio');
      // React writes aria-pressed only when its value changes: mirror it as
      // aria-checked, then drop it (a radio can't also be pressed).
      const pressed = segment.getAttribute('aria-pressed');
      if (pressed !== null) {
        segment.setAttribute('aria-checked', pressed === 'true' ? 'true' : 'false');
        segment.removeAttribute('aria-pressed');
      } else if (!segment.hasAttribute('aria-checked')) {
        segment.setAttribute('aria-checked', segment.getAttribute('data-active') === 'true' ? 'true' : 'false');
      }
    }
  }
  let current = segments.findIndex(isOn);
  if (current < 0 && fallbackIndex >= 0 && fallbackIndex < segments.length) current = fallbackIndex;
  if (current < 0 || !usable(segments[current])) current = segments.findIndex(usable);
  segments.forEach((segment, index) => segment.setAttribute('tabindex', index === current ? '0' : '-1'));
}

function onSegmentKey(event: KeyboardEvent) {
  const control = event.currentTarget as HTMLElement;
  if (!control.hasAttribute('data-seg-keys') || event.altKey || event.ctrlKey || event.metaKey) return;
  const segments = segmentsOf(control);
  const from = segments.indexOf(event.target as HTMLElement);
  if (from < 0) return;
  const enabled = segments.filter(usable);
  if (!enabled.length) return;
  const at = enabled.indexOf(segments[from]);
  let next: HTMLElement | undefined;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = enabled[(at + 1) % enabled.length];
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = enabled[(at - 1 + enabled.length) % enabled.length];
  else if (event.key === 'Home') next = enabled[0];
  else if (event.key === 'End') next = enabled[enabled.length - 1];
  if (!next) return;
  event.preventDefault();
  if (next === segments[from]) return;
  next.focus();
  // As with radio buttons and tabs here, moving to a segment chooses it.
  next.click();
}

/**
 * The sliding highlight for a `.segmented` control. Put it as the first child
 * of the control; segments are equal width, so the highlight only needs the
 * active index and the number of segments. Hidden when nothing is active.
 *
 * It also gives its control radio-button keys and roles (see `enhance`), so
 * every segmented control in the app gets one tab stop, arrow keys, Home and
 * End without each page wiring them up.
 */
export function SegmentedIndicator({ index, count }: { index: number; count: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const control = ref.current?.parentElement;
    if (control) enhance(control, index);
  });
  useLayoutEffect(() => {
    const control = ref.current?.parentElement;
    if (!control) return;
    control.addEventListener('keydown', onSegmentKey);
    return () => control.removeEventListener('keydown', onSegmentKey);
  }, []);
  const hidden = index < 0 || count < 1;
  return (
    <span
      ref={ref}
      aria-hidden="true"
      hidden={hidden}
      className="segmented-indicator"
      style={hidden ? undefined : { width: `calc((100% - 6px) / ${count})`, transform: `translateX(${index * 100}%)` }}
    />
  );
}
