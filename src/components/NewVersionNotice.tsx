'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { canLeaveLocalPrint } from '@/lib/printNavigation';
import { buildChanged, builtInBuild, versionRouteGone } from '@/lib/buildCheck';

/**
 * This page's build, built in by next.config, so a deploy that lands before
 * the first check is still announced. A build that couldn't tell (local
 * builds) learns it from the first answer instead.
 */
let pageBuild: string | null | undefined = builtInBuild(process.env.LW_BUILD_STAMP);

/**
 * After a deploy, a page that stayed open keeps running the old code. It
 * checks the server's build now and then (and when the tab comes back) and
 * asks for a reload in one line. Nothing reloads on its own: a print in
 * progress is never cut off.
 */
export function NewVersionNotice() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    // This tab's build has /api/version. A 404 later means the server was
    // rolled back to a build without it, so it is out of date too.
    let knewRoute = pageBuild !== undefined;
    let gone404 = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const response = await fetch('/api/version', { cache: 'no-store' });
        if (!response.ok) {
          // Two 404s in a row, a moment apart, so one stray answer during a
          // deploy doesn't ask anyone to reload. Never for a network error or
          // a 5xx: those are trouble, not a new version.
          if (versionRouteGone(response.status, knewRoute)) {
            gone404 += 1;
            if (gone404 >= 2) { if (active) setReady(true); }
            else retry = setTimeout(() => { void check(); }, 15_000);
          } else gone404 = 0;
          return;
        }
        knewRoute = true;
        gone404 = 0;
        const data = await response.json() as { build?: unknown };
        const build = typeof data?.build === 'string' ? data.build : null;
        if (pageBuild === undefined) { pageBuild = build; return; }
        if (active && buildChanged(pageBuild, build)) setReady(true);
      } catch { /* offline: try again later */ }
    };
    void check();
    const timer = setInterval(check, 5 * 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; clearInterval(timer); clearTimeout(retry); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  if (!ready) return null;
  return (
    <div role="status" className="animate-enter flex flex-wrap items-center gap-x-3 gap-y-1 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
      <span>Label Wrangler was updated. Reload to keep working.</span>
      <button type="button" className="inline-flex items-center gap-1.5 font-medium underline underline-offset-2" onClick={() => { if (canLeaveLocalPrint()) window.location.reload(); }}>
        <RefreshCw className="size-3.5" aria-hidden="true" /> Reload
      </button>
    </div>
  );
}
