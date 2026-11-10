import type { ReactNode } from 'react';

/**
 * Empty, error and not-found states, drawn one way everywhere: centred, the
 * same distance below the page header, a heading (no period), one plain
 * sentence, then the actions centred under it.
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
