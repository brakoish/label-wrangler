"use client";
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useFormatStore } from '@/lib/store';
import { useTemplateStore } from '@/lib/templateStore';
import { useRunStore } from '@/lib/runStore';
import { useGlobalElementStore } from '@/lib/globalStore';
import { flushOfflineQueue, pendingPatchCount, progressSyncError, QUEUE_EVENT } from '@/lib/offlineQueue';

export function StoreHydrator({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const formats = useFormatStore();
  const templates = useTemplateStore();
  const runs = useRunStore();
  const globals = useGlobalElementStore();
  const [sync, setSync] = useState({ count:0, error:'' });
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
    const refresh = () => setSync({count:pendingPatchCount(),error:progressSyncError()});
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
  const collections = [
    ...(library || pathname==='/formats' ? [{name:'Formats',store:formats,load:formats.fetchFormats}] : []),
    ...(library ? [{name:'Templates',store:templates,load:templates.fetchTemplates}] : []),
    ...(pathname.startsWith('/runs') || needsRuns ? [{name:'Runs',store:runs,load:runs.loadAll}] : []),
    ...(pathname==='/designer' ? [{name:'Saved blocks',store:globals,load:globals.fetchGlobals}] : []),
  ];
  return <>
    {pathname !== '/login' && <div className="text-xs bg-zinc-950 text-amber-200" aria-live="polite">
      {collections.map(({name,store,load}) => store.error ? <div role="alert" className="px-4 py-2" key={name}>{name}: {store.error} <button className="underline" onClick={()=>void load()}>Retry</button> <a className="underline ml-2" href="/login">Sign in</a></div> : store.hasMore ? <button key={name} className="px-4 py-1 underline" disabled={store.loading} onClick={()=>void load(true)}>{store.loading ? `Loading remaining ${name.toLowerCase()}…` : `Load more ${name.toLowerCase()}`}</button> : null)}
      {(sync.count > 0 || sync.error) && <div role="alert" className="px-4 py-2">{sync.error || `${sync.count} print updates awaiting sync. Keep this browser data.`} <button className="underline" onClick={()=>void flushOfflineQueue()}>Retry sync</button></div>}
    </div>}
    {children}
  </>;
}
