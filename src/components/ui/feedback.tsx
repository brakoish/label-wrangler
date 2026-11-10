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
}
type Toast = { id: number; message: string; tone: 'success' | 'error' | 'info' };
type State = { confirm: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null; toasts: Toast[] };

let state: State = { confirm: null, toasts: [] };
const listeners = new Set<() => void>();
const emit = (next: State) => { state = next; listeners.forEach((listener) => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getSnapshot = () => state;
const getServerSnapshot = () => state;
let nextToastId = 1;

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    state.confirm?.resolve(false);
    emit({ ...state, confirm: { ...options, resolve } });
  });
}

/** An in-app acknowledgement, used where the app previously called alert(). */
export function alertDialog(title: string, body?: React.ReactNode): Promise<void> {
  return confirmDialog({ title, body, confirmLabel: 'OK', acknowledgeOnly: true }).then(() => undefined);
}

export function toast(message: string, tone: Toast['tone'] = 'success') {
  const id = nextToastId++;
  emit({ ...state, toasts: [...state.toasts, { id, message, tone }].slice(-3) });
  setTimeout(() => emit({ ...state, toasts: state.toasts.filter((item) => item.id !== id) }), tone === 'error' ? 7000 : 4000);
}

function settle(ok: boolean) {
  const current = state.confirm;
  if (!current) return;
  emit({ ...state, confirm: null });
  current.resolve(ok);
}

export function FeedbackHost() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const confirm = current.confirm;
  return <>
    <Dialog
      open={!!confirm}
      onClose={() => settle(false)}
      title={confirm?.title ?? ''}
      role="alertdialog"
      hideClose
    >
      {confirm?.body && <div className="text-sm text-zinc-300 leading-relaxed">{confirm.body}</div>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {!confirm?.acknowledgeOnly && (
          <button type="button" onClick={() => settle(false)} className="btn btn-secondary">
            {confirm?.cancelLabel ?? 'Cancel'}
          </button>
        )}
        <button
          type="button"
          data-autofocus={confirm?.danger ? undefined : true}
          onClick={() => settle(true)}
          className={`btn ${confirm?.danger ? 'btn-danger' : 'btn-primary'}`}
        >
          {confirm?.confirmLabel ?? 'OK'}
        </button>
      </div>
    </Dialog>
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[110] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
      {current.toasts.map((item) => (
        <div key={item.id} className="pointer-events-auto flex max-w-md items-center gap-2.5 rounded-xl border border-zinc-700 bg-zinc-800 py-1.5 pl-4 pr-1.5 text-sm text-zinc-100 shadow-xl shadow-black/40 animate-enter">
          {item.tone === 'success' ? <CheckCircle2 className="h-4 w-4 shrink-0 rounded-full text-emerald-400 animate-success" /> : item.tone === 'error' ? <AlertCircle className="h-4 w-4 shrink-0 text-red-400" /> : <Info className="h-4 w-4 shrink-0 text-zinc-400" />}
          <span>{item.message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => emit({ ...state, toasts: state.toasts.filter((t) => t.id !== item.id) })} className="btn btn-ghost btn-icon btn-sm text-zinc-400"><X className="h-3.5 w-3.5" /></button>
        </div>
      ))}
    </div>
  </>;
}
