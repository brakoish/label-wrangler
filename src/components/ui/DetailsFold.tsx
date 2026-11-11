import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

/**
 * A small <details> fold with a chevron that turns as it opens, so it reads
 * as something to press. The shared look for every "Details" fold.
 */
export function DetailsFold({ summary, children, className = '' }: { summary: ReactNode; children: ReactNode; className?: string }) {
  return (
    <details className={`group text-sm text-zinc-400 ${className}`}>
      <summary className="press inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-zinc-300 hover:text-zinc-100 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 transition-transform duration-200 ease-out group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
        {summary}
      </summary>
      <div className="pl-5">{children}</div>
    </details>
  );
}

/** What the server said, word for word, folded away behind "Details" (for support). */
export function ServerDetails({ text }: { text: string }) {
  return <DetailsFold summary="Details"><p className="break-words">{text}</p></DetailsFold>;
}
