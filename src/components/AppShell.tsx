'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import { pageHasOwnTitle } from '@/components/PageTitle';
import { canLeaveLocalPrint } from '@/lib/printNavigation';
import { useRegisterShell, useShellBanners } from '@/components/ui/shellSlot';

interface AppShellProps {
  children: React.ReactNode;
  /** Optional action button in header right side (e.g. "New Format", "New Template") */
  headerAction?: React.ReactNode;
  beforeLeave?: () => Promise<boolean>;
}

export function AppShell({ children, headerAction, beforeLeave }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  // Runs is the new home. Formats moved from '/' to '/formats'. Designer
  // stays at /designer. Nav order reflects day-to-day usage.
  const isRuns = pathname === '/' || pathname === '/runs' || pathname.startsWith('/runs');
  const isNabis = pathname === '/nabis' || pathname.startsWith('/nabis');
  const isDesigner = pathname === '/designer' || pathname.startsWith('/designer');
  const isFormats = pathname === '/formats' || pathname.startsWith('/formats');
  useRegisterShell();
  const banners = useShellBanners();

  const navItems: Array<{ href: string; label: string; active: boolean }> = [
    { href: '/runs', label: 'Runs', active: isRuns },
    { href: '/nabis', label: 'Nabis', active: isNabis },
    { href: '/designer', label: 'Designs', active: isDesigner },
    { href: '/formats', label: 'Label sizes', active: isFormats },
  ];

  const activeLabel = navItems.find(item => item.active)?.label ?? '';

  // Every page gets a tab title: pages set their own with <PageTitle>, and
  // the section name fills in for any that don't.
  useEffect(() => {
    if (!pageHasOwnTitle()) document.title = activeLabel ? `${activeLabel} — Label Wrangler` : 'Label Wrangler';
  }, [pathname, activeLabel]);

  // Exactly one h1 per page: when the page content has none, a visually
  // hidden one names the section for screen readers.
  const mainRef = useRef<HTMLElement>(null);
  const [needsHeading, setNeedsHeading] = useState(false);
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const check = () => setNeedsHeading(!main.querySelector('h1:not([data-fallback-heading])'));
    check();
    const observer = new MutationObserver(check);
    observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="h-dvh flex flex-col bg-zinc-950">
      <a href="#main" className="skip-link btn btn-primary btn-sm">Skip to content</a>
      {/* One 56px bar on every screen size: logo, nav, sign out. */}
      <header className="sticky top-0 z-40 bg-zinc-950" onClickCapture={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = (event.target as HTMLElement).closest('a[href]');
        if (!link || link.getAttribute('href')?.startsWith('#')) return;
        event.preventDefault();
        event.stopPropagation();
        if (!canLeaveLocalPrint()) return;
        const href = link.getAttribute('href')!;
        void (beforeLeave ? beforeLeave() : Promise.resolve(true)).then(ready => { if (ready) router.push(href); });
      }}>
        <div className="max-w-[1600px] mx-auto h-14 px-2 sm:px-6 flex items-center gap-1 sm:gap-6">
          <Link href="/runs" aria-label="Label Wrangler, go to print runs" className="shrink-0 flex items-center gap-2.5 rounded-lg p-1.5 sm:p-0">
            <img
              src="/logo.png"
              alt=""
              aria-hidden="true"
              className="w-8 h-8 sm:w-9 sm:h-9"
              style={{ filter: 'brightness(0) invert(1)' }}
            />
            {/* Wordmark from sm up; on phones the logo alone leaves room for the nav. */}
            <span className="hidden sm:block text-base font-semibold text-zinc-100 whitespace-nowrap">Label Wrangler</span>
          </Link>

          <nav aria-label="Main" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto sm:gap-1 [scrollbar-width:none]">
            {navItems.map(item => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.active ? 'page' : undefined}
                className={`shrink-0 inline-flex h-control-sm items-center rounded-lg px-2.5 sm:px-3 text-sm font-medium whitespace-nowrap transition-colors ${
                  item.active
                    ? 'bg-zinc-800 text-zinc-50'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <button type="button" className="btn btn-ghost btn-sm shrink-0 max-sm:size-control-sm max-sm:px-0" onClick={async()=>{
            if (!canLeaveLocalPrint()) return;
            if (beforeLeave && !await beforeLeave()) return;
            const result=await fetch('/api/office/session',{method:'DELETE'});
            if(result.ok)window.location.assign('/login');
          }}><LogOut className="w-4 h-4 sm:hidden" aria-hidden="true" /><span className="max-sm:sr-only">Sign out</span></button>
          {/* Page-specific action button */}
          {headerAction && <div className="shrink-0">{headerAction}</div>}
        </div>
      </header>

      {banners}
      {/* Page content */}
      <main ref={mainRef} id="main" tabIndex={-1} className="flex-1 flex flex-col overflow-hidden outline-none">
        {needsHeading && <h1 data-fallback-heading className="sr-only">{activeLabel || 'Label Wrangler'}</h1>}
        {children}
      </main>
    </div>
  );
}
