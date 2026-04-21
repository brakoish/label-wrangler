'use client';

import { useEffect } from 'react';

/**
 * Sets document.title from inside a client component. Next.js metadata can't
 * be exported from 'use client' pages, so this is how we get per-page tab
 * titles without converting every page to a server component.
 *
 * Renders nothing.
 */
export function PageTitle({ title }: { title: string }) {
  useEffect(() => {
    const full = title ? `${title} — Label Wrangler` : 'Label Wrangler';
    document.title = full;
  }, [title]);
  return null;
}
