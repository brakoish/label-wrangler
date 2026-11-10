import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

/**
 * One way to show something that needs the person (a send that may not have
 * arrived, a refusal, an out-of-labels part) and its way out, laid out the
 * same everywhere:
 *
 *   [icon] Title in the tone colour
 *          Body in plain words
 *          [Primary] [Quiet second]
 *
 * The body and the buttons line up with the title's text, never with the
 * icon. Buttons sit in one row, primary first, and wrap on a narrow phone.
 * Pass the buttons as `actions` (a primary `.btn` first, then a ghost or
 * secondary one); `RecoveryActions` gives the same row for markup that
 * builds its own block.
 *
 *   <Recovery tone="warning" title="We’re not sure the office got labels 41–60"
 *     actions={<><button className="btn btn-primary">Check the queue</button>
 *               <button className="btn btn-ghost">Send again…</button></>}>
 *     The last try didn’t get an answer.
 *   </Recovery>
 */
export type RecoveryTone = 'danger' | 'warning' | 'info' | 'success';

const TONE: Record<RecoveryTone, string> = {
  danger: 'text-red-400',
  warning: 'text-amber-300',
  info: 'text-zinc-100',
  success: 'text-emerald-400',
};

function ToneIcon({ tone }: { tone: RecoveryTone }) {
  const className = 'mt-0.5 size-4 shrink-0';
  if (tone === 'success') return <CheckCircle2 className={`${className} rounded-full animate-success`} aria-hidden="true" />;
  if (tone === 'info') return <Info className={`${className} text-zinc-400`} aria-hidden="true" />;
  return <AlertCircle className={className} aria-hidden="true" />;
}

export function Recovery({ tone = 'warning', title, children, actions, role = 'status', icon, className = '' }: {
  tone?: RecoveryTone;
  title: ReactNode;
  /** The plain words under the title (what happened, what the buttons do). */
  children?: ReactNode;
  /** The way out: a primary button first, then a quiet one. */
  actions?: ReactNode;
  /** 'alert' for something that just went wrong; 'status' otherwise. */
  role?: 'alert' | 'status';
  /** Replaces the tone's icon (a spinner while checking, say). */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div role={role} className={`recovery text-sm ${className}`}>
      <p className={`flex items-start gap-2 font-medium ${TONE[tone]}`}>
        {icon ?? <ToneIcon tone={tone} />}
        <span className="min-w-0">{title}</span>
      </p>
      {children && <div className="recovery-body">{children}</div>}
      {actions && <RecoveryActions>{actions}</RecoveryActions>}
    </div>
  );
}

/** The row of buttons under a recovery message, lined up with its text. */
export function RecoveryActions({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`recovery-actions ${className}`}>{children}</div>;
}
