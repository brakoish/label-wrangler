'use client';

import { useEffect } from 'react';

/**
 * Sets document.title from inside a client component. Next.js metadata can't
 * be exported from 'use client' pages, so this is how we get per-page tab
 * titles without converting every page to a server component.
 *
 * Renders nothing.
 */
let mounted = 0;
/** True while a page has set its own title (AppShell falls back otherwise). */
export function pageHasOwnTitle() { return mounted > 0; }

export function PageTitle({ title }: { title: string }) {
  useEffect(() => {
    mounted += 1;
    return () => { mounted -= 1; };
  }, []);
  useEffect(() => {
    const full = title ? `${title} — Label Wrangler` : 'Label Wrangler';
    document.title = full;
    // Streamed metadata (for example on the 404 page) can rewrite <title>
    // after this runs; put the page's own title back while it is shown.
    const observer = new MutationObserver(() => { if (document.title !== full) document.title = full; });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
  return null;
}
