"use client";
import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useShallow } from 'zustand/react/shallow';
import { useFormatStore } from '@/lib/store';
import { useTemplateStore } from '@/lib/templateStore';
import { useRunStore } from '@/lib/runStore';
import { useGlobalElementStore } from '@/lib/globalStore';
import { confirmDialog } from '@/components/ui/feedback';
import { setShellBanners, useShellMounted } from '@/components/ui/shellSlot';
import { friendlyError } from '@/lib/userMessages';
import { plainServerError } from '@/lib/runErrors';
import { flushOfflineQueue, pendingPatchCount, progressSyncError, QUEUE_EVENT, deadLetteredOps, exportDeadLetters, discardDeadLetters, type DeadLetter } from '@/lib/offlineQueue';

function exportSetAside() {
  const url = URL.createObjectURL(new Blob([exportDeadLetters()], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `label-wrangler-set-aside-updates-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const signedOut = (message: string) => /sign in|signed in|unauthori[sz]ed|401|session/i.test(message);

export function StoreHydrator({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Only what the banners and loaders read, so per-label progress updates in
  // the run store don't re-render this component (and the app shell).
  const formats = useFormatStore(useShallow(s => ({ error: s.error, hasMore: s.hasMore, loading: s.loading, hydrated: s.hydrated, count: s.formats.length, load: s.fetchFormats })));
  const templates = useTemplateStore(useShallow(s => ({ error: s.error, hasMore: s.hasMore, loading: s.loading, hydrated: s.hydrated, count: s.templates.length, load: s.fetchTemplates })));
  const runs = useRunStore(useShallow(s => ({ error: s.error, hasMore: s.hasMore, loading: s.loading, hydrated: s.hydrated, count: s.runs.length, load: s.loadAll })));
  const globals = useGlobalElementStore(useShallow(s => ({ error: s.error, hasMore: s.hasMore, loading: s.loading, hydrated: s.hydrated, count: 1, load: s.fetchGlobals })));
  const [sync, setSync] = useState<{count:number;error:string;dead:DeadLetter[]}>({ count:0, error:'', dead:[] });
  const library = pathname === '/designer' || pathname === '/runs' || pathname === '/runs/new' || pathname === '/';
  const needsRuns = pathname === '/runs' || pathname === '/runs/new' || pathname === '/';
  const fetchFormats = formats.load; const fetchTemplates = templates.load; const loadAll = runs.load; const fetchGlobals = globals.load;
  useEffect(() => {
    if (pathname === '/login') return;
    if ((library || pathname === '/formats') && !useFormatStore.getState().hydrated) void fetchFormats();
    if (library && !useTemplateStore.getState().hydrated) void fetchTemplates();
    if (needsRuns && !useRunStore.getState().hydrated) void loadAll();
    if (pathname === '/designer' && !useGlobalElementStore.getState().hydrated) void fetchGlobals();
  }, [pathname,library,needsRuns,fetchFormats,fetchTemplates,loadAll,fetchGlobals]);
  // Fill remaining metadata pages progressively so search and dashboard totals
  // cover the whole library without one unbounded response or blocking first paint.
  useEffect(() => {
    if (needsRuns && runs.hydrated && runs.hasMore && !runs.loading && !runs.error) void loadAll(true);
    if (library && templates.hydrated && templates.hasMore && !templates.loading && !templates.error) void fetchTemplates(true);
    if ((library || pathname==='/formats') && formats.hydrated && formats.hasMore && !formats.loading && !formats.error) void fetchFormats(true);
    if (pathname==='/designer' && globals.hydrated && globals.hasMore && !globals.loading && !globals.error) void fetchGlobals(true);
  }, [needsRuns,library,pathname,runs.hydrated,runs.hasMore,runs.loading,runs.error,templates.hydrated,templates.hasMore,templates.loading,templates.error,formats.hydrated,formats.hasMore,formats.loading,formats.error,globals.hydrated,globals.hasMore,globals.loading,globals.error,loadAll,fetchTemplates,fetchFormats,fetchGlobals]);
  useEffect(() => {
    if (pathname === '/login') return;
    // Keep the same object when nothing changed: the outbox announces after
    // every progress update while printing.
    const refresh = () => {
      const next = {count:pendingPatchCount(),error:progressSyncError(),dead:deadLetteredOps()};
      setSync(prev => prev.count === next.count && prev.error === next.error && prev.dead.length === next.dead.length && prev.dead.every((item, i) => item.id === next.dead[i].id) ? prev : next);
    };
    const flush = () => { void flushOfflineQueue().then(refresh); };
    refresh(); flush();
    const onSynced = (event: Event) => { const run=(event as CustomEvent).detail; useRunStore.setState(state=>({runs:state.runs.map(old=>old.id===run.id?{...old,...run}:old)})); };
    const onEventSynced = (event: Event) => { const saved=(event as CustomEvent).detail; useRunStore.setState(state=>({printEvents:[saved,...state.printEvents.filter(old=>old.id!==saved.id)]})); };
    window.addEventListener('lw:event-synced',onEventSynced);
    window.addEventListener('lw:run-synced',onSynced);
    window.addEventListener(QUEUE_EVENT,refresh);
    window.addEventListener('storage',refresh);
    window.addEventListener('online',flush);
    const timer=setInterval(flush,30000);
    return () => { window.removeEventListener('lw:event-synced',onEventSynced); window.removeEventListener('lw:run-synced',onSynced); clearInterval(timer); window.removeEventListener(QUEUE_EVENT,refresh); window.removeEventListener('storage',refresh); window.removeEventListener('online',flush); };
  }, [pathname]);
  const shellMounted = useShellMounted();
  const banners = useMemo(() => {
    if (pathname === '/login') return null;
    // A list page that is empty shows its own load error with "Try again";
    // skip the duplicate banner there.
    // A run's own page (and its scan and print pages) loads that run by itself
    // and shows its own load error, so the runs list failing is not news there.
    // New run shows its own error when it has no designs or label sizes to pick from.
    const runPage = /^\/runs\/[^/]+(?:\/(?:scan|print))?$/.test(pathname) && !pathname.startsWith('/runs/new');
    // New run copying a run (Re-run, Use a QR code instead) says itself when that run can't be opened.
    const copyingRun = pathname === '/runs/new' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('duplicateFrom');
    const ownsEmptyList = (name: string, count: number) => (name === 'Runs' && (runPage || copyingRun)) || (count === 0 && ((name === 'Label sizes' && (pathname === '/formats' || pathname === '/runs/new')) || (name === 'Designs' && (pathname === '/designer' || pathname === '/runs/new')) || (name === 'Runs' && (pathname === '/runs' || pathname === '/'))));
    const collections = [
      ...(library || pathname==='/formats' ? [{name:'Label sizes',store:formats,load:formats.load,count:formats.count}] : []),
      ...(library ? [{name:'Designs',store:templates,load:templates.load,count:templates.count}] : []),
      ...(pathname.startsWith('/runs') || needsRuns ? [{name:'Runs',store:runs,load:runs.load,count:runs.count}] : []),
      ...(pathname==='/designer' ? [{name:'Reusable elements',store:globals,load:globals.load,count:globals.count}] : []),
    ];
    // One banner for every collection that failed, with one Try again that
    // retries them all. When the page shows its own load error, it owns the
    // message and this banner stays out of the way.
    const failed = collections.filter(({store}) => store.error);
    const pageOwnsError = failed.some(({name,count}) => ownsEmptyList(name, count));
    const listNames = failed.map(({name}) => name.toLowerCase());
    const named = listNames.length <= 1 ? listNames[0] ?? '' : `${listNames.slice(0, -1).join(', ')} and ${listNames[listNames.length - 1]}`;
    const anySignedOut = failed.some(({store}) => signedOut(store.error ?? ''));
    const loadingMore = collections.filter(({store}) => !store.error && store.hasMore);
    const rewinds = sync.dead.filter((item) => item.kind === 'rewind-dropped');
    const setAside = sync.dead.filter((item) => item.kind !== 'rewind-dropped');
    return <div className="text-sm text-amber-200 [&>*]:bg-amber-500/10" aria-live="polite">
        {failed.length > 0 && !pageOwnsError && <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
          <span>{anySignedOut ? `You’re signed out, so your ${named} couldn’t load.` : `Couldn’t load your ${named}. ${plainServerError(failed[0].store.error ?? '', 'Something went wrong on our side. Try again in a minute.').text}`}</span>
          {anySignedOut
            ? <a className="inline-flex min-h-11 items-center font-medium underline underline-offset-2" href="/login">Sign in</a>
            : <button type="button" className="btn btn-secondary btn-sm max-sm:min-h-11" onClick={()=>{ for (const {load} of failed) void load(); }}>Try again</button>}
        </div>}
        {loadingMore.map(({name,store,load}) => <button type="button" key={name} className="block w-full px-4 py-1 text-left underline underline-offset-2" disabled={store.loading} onClick={()=>void load(true)}>{store.loading ? `Loading the rest of your ${name.toLowerCase()}…` : `Load more ${name.toLowerCase()}`}</button>)}
        {(sync.count > 0 || sync.error) && <div role="alert" className="px-4 py-2">{sync.error ? friendlyError(sync.error) : `${sync.count === 1 ? '1 print update hasn\u2019t' : `${sync.count} print updates haven\u2019t`} reached the server yet. They\u2019ll send when you\u2019re back online — don\u2019t clear this browser\u2019s data.`} <button type="button" className="font-medium underline underline-offset-2" onClick={()=>void flushOfflineQueue()}>Send now</button></div>}
        {/* A late "go back" that was dropped: a plain notice, nothing to recover. */}
        {rewinds.length > 0 && <div role="status" className="px-4 py-2">
          {rewinds[rewinds.length - 1].message}
          {' '}<button type="button" className="font-medium underline underline-offset-2" onClick={()=>discardDeadLetters(rewinds.map(item=>item.id))}>OK</button>
        </div>}
        {setAside.length > 0 && <div role="alert" className="px-4 py-2">
          {setAside.length === 1 ? '1 print update' : `${setAside.length} print updates`} couldn’t be saved to the server and {setAside.length === 1 ? 'was' : 'were'} set aside, so printing is not blocked. {setAside[setAside.length - 1].message}
          {' '}<button type="button" className="underline" onClick={exportSetAside}>Export</button>
          {' '}<button type="button" className="underline ml-2" onClick={()=>{ void confirmDialog({ title: 'Discard the set-aside print updates?', body: 'They are removed from this device. Export them first if you need a record.', confirmLabel: 'Discard', danger: true }).then(ok => { if (ok) discardDeadLetters(setAside.map(item=>item.id)); }); }}>Discard</button>
        </div>}
      </div>;
  }, [pathname, library, needsRuns, formats, templates, runs, globals, sync]);
  // Inside the layout (under the header) when the page uses AppShell.
  useEffect(() => { setShellBanners(banners); }, [banners]);
  useEffect(() => () => setShellBanners(null), []);
  return <>
    {!shellMounted && banners}
    {children}
  </>;
}
