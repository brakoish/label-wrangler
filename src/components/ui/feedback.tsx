'use client';

import { useSyncExternalStore } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { Dialog } from './Dialog';

/**
 * In-app replacements for window.alert / window.confirm.
 * `confirmDialog()` resolves true/false from a real, labelled dialog;
 * `toast()` shows a short polite status message. <FeedbackHost/> is mounted
 * once in the root layout.
 */
export interface ConfirmOptions {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
  /** Hide Cancel: the dialog becomes an acknowledgement (alert). */
  acknowledgeOnly?: boolean;
  /**
   * A second, quieter choice in place of Cancel (choiceDialog only). Closing
   * the dialog picks neither, so the primary button can be the safe choice.
   */
  altLabel?: string;
  /** A third choice (choiceDialog only), shown as a quiet text button. */
  extraLabel?: string;
  /** Keep a Cancel button beside the alt choice (choiceDialog only). */
  cancelAlso?: boolean;
  /**
   * Start with Cancel focused, for a dialog that can open in the middle of
   * typing or scanning (a scanner's trailing Enter must not confirm it).
   */
  focusCancel?: boolean;
}
type Outcome = 'confirm' | 'alt' | 'extra' | 'dismiss';
type Toast = { id: number; message: string; tone: 'success' | 'error' | 'info'; closing?: boolean };
type State = { confirm: (ConfirmOptions & { resolve: (outcome: Outcome) => void }) | null; toasts: Toast[] };

let state: State = { confirm: null, toasts: [] };
const listeners = new Set<() => void>();
const emit = (next: State) => { state = next; listeners.forEach((listener) => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getSnapshot = () => state;
const getServerSnapshot = () => state;
let nextToastId = 1;

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    state.confirm?.resolve('dismiss');
    emit({ ...state, confirm: { ...options, altLabel: undefined, extraLabel: undefined, cancelAlso: false, resolve: (outcome) => resolve(outcome === 'confirm') } });
  });
}

/**
 * Two real choices, with the safe one as the primary button. Resolves
 * 'confirm' (primary), 'alt' (the quieter choice), 'extra' (an optional
 * third choice) or null when closed.
 */
export function choiceDialog(options: ConfirmOptions & { altLabel: string }): Promise<'confirm' | 'alt' | 'extra' | null> {
  return new Promise((resolve) => {
    state.confirm?.resolve('dismiss');
    emit({ ...state, confirm: { ...options, resolve: (outcome) => resolve(outcome === 'dismiss' ? null : outcome) } });
  });
}

/** An in-app acknowledgement, used where the app previously called alert(). */
export function alertDialog(title: string, body?: React.ReactNode): Promise<void> {
  return confirmDialog({ title, body, confirmLabel: 'OK', acknowledgeOnly: true }).then(() => undefined);
}

/** Toast exit is ~20% shorter than its 200ms entrance. */
const TOAST_EXIT_MS = 160;
function dismissToast(id: number) {
  if (!state.toasts.some((item) => item.id === id && !item.closing)) return;
  emit({ ...state, toasts: state.toasts.map((item) => (item.id === id ? { ...item, closing: true } : item)) });
  setTimeout(() => emit({ ...state, toasts: state.toasts.filter((item) => item.id !== id) }), TOAST_EXIT_MS);
}

export function toast(message: string, tone: Toast['tone'] = 'success') {
  const id = nextToastId++;
  const visible = state.toasts.filter((item) => !item.closing);
  // Keep at most three; the oldest slides out rather than vanishing.
  if (visible.length >= 3) dismissToast(visible[0].id);
  emit({ ...state, toasts: [...state.toasts, { id, message, tone }] });
  setTimeout(() => dismissToast(id), tone === 'error' ? 7000 : 4000);
}

function settle(outcome: Outcome) {
  const current = state.confirm;
  if (!current) return;
  emit({ ...state, confirm: null });
  current.resolve(outcome);
}

export function FeedbackHost() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const confirm = current.confirm;
  return <>
    <Dialog
      open={!!confirm}
      onClose={() => settle('dismiss')}
      title={confirm?.title ?? ''}
      role="alertdialog"
      hideClose
    >
      {confirm?.body && <div className="text-sm text-zinc-300 leading-relaxed">{confirm.body}</div>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        {confirm?.altLabel && confirm.cancelAlso && (
          <button type="button" data-autofocus={confirm.focusCancel ? true : undefined} onClick={() => settle('dismiss')} className="btn btn-ghost sm:mr-auto">
            {confirm.cancelLabel ?? 'Cancel'}
          </button>
        )}
        {confirm?.altLabel && confirm.extraLabel && (
          <button type="button" onClick={() => settle('extra')} className="btn btn-secondary">
            {confirm.extraLabel}
          </button>
        )}
        {confirm?.altLabel ? (
          <button type="button" onClick={() => settle('alt')} className="btn btn-secondary">
            {confirm.altLabel}
          </button>
        ) : !confirm?.acknowledgeOnly && (
          <button type="button" data-autofocus={confirm?.focusCancel ? true : undefined} onClick={() => settle('dismiss')} className="btn btn-secondary">
            {confirm?.cancelLabel ?? 'Cancel'}
          </button>
        )}
        <button
          type="button"
          data-autofocus={confirm?.danger || (confirm?.focusCancel && !confirm?.acknowledgeOnly) ? undefined : true}
          onClick={() => settle('confirm')}
          className={`btn ${confirm?.danger ? 'btn-danger' : 'btn-primary'}`}
        >
          {confirm?.confirmLabel ?? 'OK'}
        </button>
      </div>
    </Dialog>
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[110] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
      {current.toasts.map((item) => (
        <div key={item.id} data-state={item.closing ? 'closed' : 'open'} className="toast-layer pointer-events-auto flex max-w-md items-center gap-2.5 rounded-xl bg-zinc-800 py-1.5 pl-4 pr-1.5 text-sm text-zinc-100 shadow-xl shadow-black/40 ring-1 ring-zinc-700">
          {item.tone === 'success' ? <CheckCircle2 className="h-4 w-4 shrink-0 rounded-full text-emerald-400 animate-success" /> : item.tone === 'error' ? <AlertCircle className="h-4 w-4 shrink-0 text-red-400" /> : <Info className="h-4 w-4 shrink-0 text-zinc-400" />}
          <span>{item.message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(item.id)} className="btn btn-ghost btn-icon btn-sm text-zinc-400"><X className="h-3.5 w-3.5" /></button>
        </div>
      ))}
    </div>
  </>;
}
