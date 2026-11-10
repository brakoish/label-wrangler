import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * Empty, error and not-found states, drawn one way everywhere: centred, the
 * same distance below the page header, a heading (no period), one plain
 * sentence, then the actions centred under it (the main one first).
 */
export function EmptyState({ title, body, actions, children, tone = 'empty', as: Heading = 'h2' }: {
  title: string;
  body?: ReactNode;
  actions?: ReactNode;
  /** Anything else that belongs to the state (an admin fold), centred too. */
  children?: ReactNode;
  /** An error is announced (role="alert"); an empty list is not. */
  tone?: 'empty' | 'error';
  as?: 'h1' | 'h2';
}) {
  return (
    <div role={tone === 'error' ? 'alert' : undefined} className="mx-auto max-w-md py-16 text-center sm:py-20">
      <Heading className="text-lg font-semibold text-zinc-100">{title}</Heading>
      {body && <p className="mt-1.5 text-sm text-zinc-400">{body}</p>}
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
      {children && <div className="mt-4 flex flex-col items-center">{children}</div>}
    </div>
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
      {back && <Link href={back.href} className={onRetry ? 'btn btn-secondary' : 'btn btn-primary'}>{back.label}</Link>}
    </>
  );
}

/**
 * A page that is only a state (not found, couldn't load): the same spot and
 * look as a list's state under its header, with the heading as the page's h1.
 * Put it where the page's content goes, inside the app shell.
 *
 *   <PageState tone="error" title="We couldn’t load this run" body={message}
 *     actions={<StateActions onRetry={retry} back={{ href: '/runs', label: 'Go to Runs' }} />} />
 */
export function PageState(props: Omit<Parameters<typeof EmptyState>[0], 'as'>) {
  return (
    <div className="flex-1 overflow-auto">
      <div className="page-container">
        <EmptyState {...props} as="h1" />
      </div>
    </div>
  );
}
