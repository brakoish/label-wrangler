'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import { pageHasOwnTitle } from '@/components/PageTitle';
import { canLeaveLocalPrint } from '@/lib/printNavigation';
import { useRegisterShell, useShellBanners } from '@/components/ui/shellSlot';
import { NewVersionNotice } from '@/components/NewVersionNotice';

type NavBox = { left: number; width: number };
/**
 * Where the nav's highlight was on the last page. Each page mounts its own
 * shell, so the highlight starts here and slides to the new page's link.
 */
let lastNavIndicator: NavBox | null = null;
/**
 * A slide that started on the click, before the next page was ready. The next
 * page's shell picks it up where it has got to, so the move never jumps.
 */
let navFlight: { from: NavBox; to: NavBox; at: number } | null = null;
/** Matches .nav-indicator in globals.css. */
const NAV_SLIDE_MS = 240;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

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
  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<NavBox | null>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  // A slide for the highlight to play as soon as it is drawn (from, time, easing).
  const pendingSlide = useRef<{ from: NavBox; ms: number; easing: string } | null>(null);
  // Start the slide on the click itself, not once the next page has loaded.
  const moveIndicatorTo = (href: string) => {
    const link = Array.from(navRef.current?.querySelectorAll<HTMLElement>(':scope > a[href]') ?? []).find((a) => a.getAttribute('href') === href);
    if (!link) return;
    const to = { left: link.offsetLeft, width: link.offsetWidth };
    const from = indicator ?? lastNavIndicator;
    if (from) {
      navFlight = { from, to, at: performance.now() };
      pendingSlide.current = { from, ms: NAV_SLIDE_MS, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' };
    }
    setIndicator(to);
  };
  useLayoutEffect(() => {
    const nav = navRef.current;
    const measure = () => {
      const link = nav?.querySelector<HTMLElement>('a[aria-current="page"]');
      return link ? { left: link.offsetLeft, width: link.offsetWidth } : null;
    };
    const next = measure();
    const flight = navFlight;
    navFlight = null;
    const from = lastNavIndicator;
    lastNavIndicator = next;
    pendingSlide.current = null;
    if (next && flight && flight.to.left === next.left && flight.to.width === next.width) {
      // The slide began on the click: carry on from where it has got to.
      const t = (performance.now() - flight.at) / NAV_SLIDE_MS;
      if (t < 1) {
        const e = easeInOut(Math.max(0, t));
        pendingSlide.current = {
          from: { left: flight.from.left + (next.left - flight.from.left) * e, width: flight.from.width + (next.width - flight.from.width) * e },
          ms: Math.max(80, Math.round(NAV_SLIDE_MS * (1 - t))),
          easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
        };
      }
    } else if (next && from && (from.left !== next.left || from.width !== next.width)) {
      pendingSlide.current = { from, ms: NAV_SLIDE_MS, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' };
    }
    setIndicator(next);
    const onResize = () => { const now = measure(); lastNavIndicator = now; setIndicator(now); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pathname]);
  // Play the pending slide on the first frame the highlight is drawn: no
  // waiting a frame or two for a CSS transition to have something to start from.
  useLayoutEffect(() => {
    const slide = pendingSlide.current;
    const el = indicatorRef.current;
    if (!slide || !el || !indicator) return;
    pendingSlide.current = null;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof el.animate !== 'function') return;
    el.animate([
      { width: `${slide.from.width}px`, transform: `translate(${slide.from.left}px, -50%)` },
      { width: `${indicator.width}px`, transform: `translate(${indicator.left}px, -50%)` },
    ], { duration: slide.ms, easing: slide.easing });
  }, [indicator]);

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
    const fallback = activeLabel ? `${activeLabel} — Label Wrangler` : 'Label Wrangler';
    const apply = () => { if (!pageHasOwnTitle() && document.title !== fallback) document.title = fallback; };
    apply();
    // Streamed metadata can rewrite <title> after hydration; keep the fallback.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
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
        const href = link.getAttribute('href')!;
        const go = () => { moveIndicatorTo(href); router.push(href); };
        if (!canLeaveLocalPrint(go)) return;
        if (!beforeLeave) { go(); return; }
        void beforeLeave().then(ready => { if (ready) go(); });
      }}>
        <div className="max-w-[1600px] mx-auto h-14 px-2 sm:px-6 flex items-center gap-1 sm:gap-6">
          {/* On the narrowest phones the nav needs the room; Runs is the home link there. */}
          <Link href="/runs" aria-label="Label Wrangler, go to Runs" className="shrink-0 flex items-center gap-2.5 rounded-lg p-1.5 max-[399px]:hidden sm:p-0">
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

          <nav ref={navRef} aria-label="Main" className="relative flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto sm:gap-1 [scrollbar-width:none]">
            {/* One highlight that slides between links (shared layout), drawn under them.
                The nav scrolls sideways on the narrowest phones, which clips anything
                outside it, so the links draw their focus ring inside their own edge. */}
            {indicator && <span ref={indicatorRef} aria-hidden="true" className="nav-indicator pointer-events-none absolute left-0 top-1/2 h-control-sm rounded-lg bg-zinc-800" style={{ width: indicator.width, transform: `translate(${indicator.left}px, -50%)` }} />}
            {navItems.map(item => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.active ? 'page' : undefined}
                className={`press relative shrink-0 inline-flex h-control-sm items-center rounded-lg focus-inset px-2 max-[339px]:px-1.5 min-[400px]:px-2.5 sm:px-3 text-sm font-medium whitespace-nowrap ${
                  item.active
                    ? `${indicator ? '' : 'bg-zinc-800 '}text-zinc-100`
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
      <NewVersionNotice />
      {/* Page content */}
      <main ref={mainRef} id="main" tabIndex={-1} className="flex-1 flex flex-col overflow-hidden outline-none">
        {needsHeading && <h1 data-fallback-heading className="sr-only">{activeLabel || 'Label Wrangler'}</h1>}
        {children}
      </main>
    </div>
  );
}
