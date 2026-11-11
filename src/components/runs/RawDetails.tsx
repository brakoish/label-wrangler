'use client';

/** What the server said, word for word, folded away behind "Details" (for support). */
export function RawDetails({ text }: { text: string }) {
  return (
    <details className="text-sm text-zinc-400">
      <summary className="press inline-flex min-h-11 cursor-pointer items-center text-zinc-300">Details</summary>
      <p className="break-words">{text}</p>
    </details>
  );
}
