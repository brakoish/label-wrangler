"use client";
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useFormatStore } from '@/lib/store';
import { useTemplateStore } from '@/lib/templateStore';
import { useRunStore } from '@/lib/runStore';
import { useGlobalElementStore } from '@/lib/globalStore';
import { confirmDialog } from '@/components/ui/feedback';
import { setShellBanners, useShellMounted } from '@/components/ui/shellSlot';
import { friendlyError } from '@/lib/userMessages';
import { flushOfflineQueue, pendingPatchCount, progressSyncError, QUEUE_EVENT, deadLetteredOps, exportDeadLetters, discardDeadLetters, type DeadLetter } from '@/lib/offlineQueue';

export function StoreHydrator({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const formats = useFormatStore();
  const templates = useTemplateStore();
  const runs = useRunStore();
  const globals = useGlobalElementStore();
  const [sync, setSync] = useState<{count:number;error:string;dead:DeadLetter[]}>({ count:0, error:'', dead:[] });
  const library = pathname === '/designer' || pathname === '/runs' || pathname === '/runs/new' || pathname === '/';
  const needsRuns = pathname === '/runs' || pathname === '/runs/new' || pathname === '/';
  const {fetchFormats}=formats; const {fetchTemplates}=templates; const {loadAll}=runs; const {fetchGlobals}=globals;
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
    const refresh = () => setSync({count:pendingPatchCount(),error:progressSyncError(),dead:deadLetteredOps()});
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
  // A list page that is empty shows its own load error with "Try again";
  // skip the duplicate banner there.
  const ownsEmptyList = (name: string, count: number) => count === 0 && ((name === 'Label sizes' && pathname === '/formats') || (name === 'Designs' && pathname === '/designer') || (name === 'Runs' && (pathname === '/runs' || pathname === '/')));
  const collections = [
    ...(library || pathname==='/formats' ? [{name:'Label sizes',store:formats,load:formats.fetchFormats,count:formats.formats.length}] : []),
    ...(library ? [{name:'Designs',store:templates,load:templates.fetchTemplates,count:templates.templates.length}] : []),
    ...(pathname.startsWith('/runs') || needsRuns ? [{name:'Runs',store:runs,load:runs.loadAll,count:runs.runs.length}] : []),
    ...(pathname==='/designer' ? [{name:'Reusable elements',store:globals,load:globals.fetchGlobals,count:1}] : []),
  ];
  const shellMounted = useShellMounted();
  const exportSetAside = () => {
    const url = URL.createObjectURL(new Blob([exportDeadLetters()], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `label-wrangler-set-aside-updates-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const signedOut = (message: string) => /sign in|signed in|unauthori[sz]ed|401|session/i.test(message);
  const banners = pathname !== '/login' ? <div className="text-sm text-amber-200 [&>div]:border-b [&>div]:border-amber-500/30 [&>div]:bg-amber-500/10" aria-live="polite">
      {collections.map(({name,store,load,count}) => store.error ? (ownsEmptyList(name, count) ? null : <div role="alert" className="px-4 py-2" key={name}>Couldn&apos;t load {name.toLowerCase()}: {friendlyError(store.error)} <button type="button" className="underline" onClick={()=>void load()}>Try again</button>{signedOut(store.error) && <a className="underline ml-2" href="/login">Sign in</a>}</div>) : store.hasMore ? <button type="button" key={name} className="px-4 py-1 underline" disabled={store.loading} onClick={()=>void load(true)}>{store.loading ? `Loading the rest of your ${name.toLowerCase()}…` : `Load more ${name.toLowerCase()}`}</button> : null)}
      {(sync.count > 0 || sync.error) && <div role="alert" className="px-4 py-2">{sync.error ? friendlyError(sync.error) : `${sync.count === 1 ? '1 print update hasn\u2019t' : `${sync.count} print updates haven\u2019t`} reached the server yet. They\u2019ll send when you\u2019re back online — don\u2019t clear this browser\u2019s data.`} <button type="button" className="underline" onClick={()=>void flushOfflineQueue()}>Send now</button></div>}
      {sync.dead.length > 0 && <div role="alert" className="px-4 py-2">
        {sync.dead.length === 1 ? '1 print update' : `${sync.dead.length} print updates`} could not be saved to the server and {sync.dead.length === 1 ? 'was' : 'were'} set aside, so printing is not blocked. {sync.dead[sync.dead.length - 1].message}
        {' '}<button type="button" className="underline" onClick={exportSetAside}>Export</button>
        {' '}<button type="button" className="underline ml-2" onClick={()=>{ void confirmDialog({ title: 'Discard the set-aside print updates?', body: 'They are removed from this device. Export them first if you need a record.', confirmLabel: 'Discard', danger: true }).then(ok => { if (ok) discardDeadLetters(sync.dead.map(item=>item.id)); }); }}>Discard</button>
      </div>}
    </div> : null;
  // Inside the layout (under the header) when the page uses AppShell.
  useEffect(() => { setShellBanners(banners); });
  useEffect(() => () => setShellBanners(null), []);
  return <>
    {!shellMounted && banners}
    {children}
  </>;
}
