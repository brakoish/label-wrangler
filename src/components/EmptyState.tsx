import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Recovery } from '@/components/ui/Recovery';

/**
 * Empty, error and not-found states, drawn one way everywhere: the shared
 * recovery block (components/ui/Recovery.tsx), on the left edge of the page's
 * content column, just under the page's title or filters. An icon and the
 * title (no period), one plain sentence, then the buttons in one row: the fix
 * first (Try again, as the main button), then the way back.
 *
 *   [!] We couldn’t load your designs
 *       Can’t reach the label database right now. Try again in a minute.
 *       [Try again]  ← Back to runs
 *
 * An error is announced (role="alert") and drawn in the warning tone; an
 * empty list is not announced and uses the quiet tone.
 */
export function EmptyState({ title, body, actions, children, tone = 'empty', as = 'h2', className = '' }: {
  title: string;
  body?: ReactNode;
  actions?: ReactNode;
  /** Anything else that belongs to the state (an admin fold), under the buttons. */
  children?: ReactNode;
  /** An error is announced (role="alert"); an empty list is not. */
  tone?: 'empty' | 'error';
  as?: 'h1' | 'h2';
  className?: string;
}) {
  const error = tone === 'error';
  return (
    <Recovery
      tone={error ? 'warning' : 'info'}
      role={error ? 'alert' : null}
      titleAs={as}
      title={title}
      actions={actions}
      className={`max-w-xl py-2 ${className}`}
    >
      {body && <p>{body}</p>}
      {children && <div className="pt-2">{children}</div>}
    </Recovery>
  );
}

/** The same state for something that went wrong: announced, same place, same look. */
export function ErrorState(props: Omit<Parameters<typeof EmptyState>[0], 'tone'>) {
  return <EmptyState {...props} tone="error" />;
}

/**
 * The buttons of a state, always in one order: the fix first (Try again, as
 * the main button), then the way back. With nothing to retry, the way back
 * is the main button. Use it in `actions` so every state reads the same.
 */
export function StateActions({ onRetry, retrying = false, retryLabel = 'Try again', back }: {
  onRetry?: () => void;
  retrying?: boolean;
  retryLabel?: string;
  back?: { href: string; label: string };
}) {
  return (
    <>
      {onRetry && <button type="button" disabled={retrying} onClick={onRetry} className="btn btn-primary">{retrying ? 'Trying again…' : retryLabel}</button>}
      {back && (onRetry
        ? <Link href={back.href} className="btn btn-ghost"><ArrowLeft className="size-4" aria-hidden="true" />{back.label}</Link>
        : <Link href={back.href} className="btn btn-primary">{back.label}</Link>)}
    </>
  );
}

/**
 * A page that is only a state (not found, couldn't load): the page's title
 * where every page puts its title, then the same state block under it. Put
 * it where the page's content goes, inside the app shell.
 *
 *   <PageState heading="Run" tone="error" title="We couldn’t load this run" body={message}
 *     actions={<StateActions onRetry={retry} back={{ href: '/runs', label: 'Back to runs' }} />} />
 */
export function PageState({ heading, ...props }: Omit<Parameters<typeof EmptyState>[0], 'as'> & {
  /** The page's own title (its h1), as in its tab and nav. Without one the state's title is the h1. */
  heading?: string;
}) {
  return (
    <div className="flex-1 overflow-auto">
      <div className="page-container">
        {heading
          ? <><h1 className="text-2xl font-semibold text-zinc-100">{heading}</h1><EmptyState {...props} as="h2" className="mt-6" /></>
          : <EmptyState {...props} as="h1" />}
      </div>
    </div>
  );
}
