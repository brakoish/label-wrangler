'use client';
import { ChevronRight } from 'lucide-react';

/** What the server said, word for word, folded away behind "Details" (for support). The chevron shows it opens. */
export function RawDetails({ text }: { text: string }) {
  return (
    <details className="group text-sm text-zinc-400">
      <summary className="press inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-zinc-300 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 ease-out group-open:rotate-90 motion-safe:transition-transform motion-safe:duration-200" aria-hidden="true" />
        Details
      </summary>
      <p className="break-words">{text}</p>
    </details>
  );
}
