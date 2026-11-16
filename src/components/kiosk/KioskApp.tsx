'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Check, ChevronRight, History, LogOut, Package, Printer as PrinterIcon, RotateCcw, Search, Tag } from 'lucide-react';
import { PageTitle } from '@/components/PageTitle';
import { Dialog } from '@/components/ui/Dialog';
import { confirmDialog } from '@/components/ui/feedback';
import { officeStatusLine, type OfficeReviewHold } from '@/lib/officeSendOutcome';
import { friendlyError } from '@/lib/userMessages';
import type { LabelFormat, LabelTemplate } from '@/lib/types';
import type { KioskDesignsAnswer, KioskRunListItem } from '@/lib/kiosk/types';
import {
  KIOSK_TEST_LABELS, designsForCategory, kioskDesignCheck, kioskDesignProblem, kioskLabelValues, kioskTestCount,
  packageKey, parseQuantity, plainCategory, productCategory, type KioskCategory, type KioskDesignCheck,
} from '@/lib/kiosk/plan';
import { KioskPreview } from './KioskPreview';
import { KioskPrinter, type KioskPrintJob } from './KioskPrinter';
import { signOutEverywhere, useKioskStatus } from './useKioskStatus';

/**
 * The kiosk: one shared screen where staff pick a product, pick one of the
 * labels the owner put on the kiosk, say how many, and print (a test of 12
 * first, then the rest). Big buttons, plain words, works by touch or mouse.
 */

interface Product { key: string; rows: Record<string, string>[]; name: string; category: KioskCategory | null; rawCategory: string }
interface KioskDesign { template: LabelTemplate; format: LabelFormat }
type Step = 'start' | 'design' | 'quantity' | 'print';

const labels = (n: number) => (n === 1 ? '1 label' : `${n.toLocaleString('en-US')} labels`);
const nameOf = (row: Record<string, string> | undefined) => (row?.itemName || row?.productName || '').trim() || 'Unnamed product';
function when(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return d >= today ? `Today ${time}` : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}
/** Where a past print stands, in a few words. */
function runWords(run: KioskRunListItem): { text: string; tone: 'ok' | 'warn' | 'bad' | 'plain' } {
  const { office, totalLabels, kiosk } = run;
  if (office.failedLabels > 0) return { text: 'Needs a check', tone: 'bad' };
  if (kiosk?.stage === 'stopped') return { text: 'Stopped after the test', tone: 'bad' };
  if (office.onTheWay > 0) return { text: 'Printing', tone: 'warn' };
  if (kiosk?.stage === 'test' && office.sent > 0) return { text: 'Waiting for its check', tone: 'warn' };
  if (office.sent >= totalLabels) return { text: 'Printed', tone: 'ok' };
  if (office.sent > 0) return { text: `${office.sent.toLocaleString('en-US')} of ${totalLabels.toLocaleString('en-US')} printed`, tone: 'warn' };
  return { text: 'Not printed yet', tone: 'plain' };
}
const toneText = { ok: 'text-emerald-300', warn: 'text-amber-200', bad: 'text-red-300', plain: 'text-zinc-400' } as const;
const dot = { ok: 'bg-emerald-400', warn: 'bg-amber-300', bad: 'bg-red-400' } as const;

export function KioskApp() {
  const status = useKioskStatus();
  if (status === undefined) return <Frame><Center title="Opening the kiosk…" /></Frame>;
  if (status === null) {
    return <Frame><Center tone="bad" title="Couldn’t reach Label Wrangler" body="Check the internet connection, then try again."
      action={<button type="button" className="btn btn-primary kiosk-btn" onClick={() => window.location.reload()}><RotateCcw className="size-5" aria-hidden="true" />Try again</button>} /></Frame>;
  }
  if (!status.ready) {
    return <Frame signOut={status.kiosk}><Center tone="bad" title="Kiosk mode isn’t set up yet" body={status.kiosk ? 'Ask a manager.' : 'It needs a one-time setup before staff can use it.'}
      action={!status.kiosk ? <Link href="/runs" className="btn btn-secondary">Back to Runs</Link> : undefined} /></Frame>;
  }
  if (!status.kiosk) {
    return <Frame><Center title="This screen is for the kiosk computer" body="Sign in there with the shared kiosk account. To choose which labels show on the kiosk, turn on “Use on kiosk” for a design in Designs."
      action={<div className="flex flex-wrap gap-3"><Link href="/designer" className="btn btn-primary">Go to Designs</Link><Link href="/runs" className="btn btn-secondary">Back to Runs</Link></div>} /></Frame>;
  }
  return <KioskMain />;
}

function Frame({ children, signOut = false, printer }: { children: React.ReactNode; signOut?: boolean; printer?: React.ReactNode }) {
  const [leaving, setLeaving] = useState(false);
  const leave = async () => {
    if (!await confirmDialog({ title: 'Sign out of the kiosk?', body: 'A manager will need the kiosk password to sign back in.', confirmLabel: 'Sign out' })) return;
    setLeaving(true);
    if (await signOutEverywhere().catch(() => false)) window.location.assign('/login');
    else setLeaving(false);
  };
  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <PageTitle title="Kiosk" />
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <span className="flex items-center gap-2 text-lg font-semibold"><Tag className="size-6 text-amber-400" aria-hidden="true" />Label Wrangler <span className="font-normal text-zinc-400">Kiosk</span></span>
          <div className="ml-auto flex items-center gap-3">
            {printer}
            {signOut && <button type="button" className="btn btn-ghost" onClick={() => void leave()} disabled={leaving}><LogOut className="size-5" aria-hidden="true" />Sign out</button>}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

function Center({ title, body, action, tone }: { title: string; body?: string; action?: React.ReactNode; tone?: 'bad' }) {
  return (
    <div className="mx-auto mt-10 max-w-xl card space-y-4 p-6" role={tone === 'bad' ? 'alert' : 'status'}>
      <h1 className="flex items-start gap-3 text-2xl font-semibold">{tone === 'bad' && <AlertTriangle className="mt-1 size-7 shrink-0 text-red-400" aria-hidden="true" />}{title}</h1>
      {body && <p className="text-lg text-zinc-300">{body}</p>}
      {action}
    </div>
  );
}

/** The office printer's state, for the header (read-only GET /api/office/stations every 15 s). */
function usePrinterLine() {
  const [line, setLine] = useState<ReturnType<typeof officeStatusLine> | null>(null);
  useEffect(() => {
    let active = true;
    const read = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const response = await fetch('/api/office/stations', { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (active && response.ok) setLine(officeStatusLine((data.printers as Array<{ online: boolean; available?: boolean; dispatch_enabled: boolean; paired_at?: string | null; needs_review: boolean; dispatch_hold_reason?: string | null; review_holds?: OfficeReviewHold[] }> | undefined)?.[0]));
      } catch { /* the last answer stays */ }
    };
    void read();
    const timer = setInterval(() => void read(), 15_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return line;
}

function KioskMain() {
  const printerLine = usePrinterLine();
  const [step, setStep] = useState<Step>('start');
  const [product, setProduct] = useState<Product | null>(null);
  const [design, setDesign] = useState<KioskDesign | null>(null);
  const [job, setJob] = useState<KioskPrintJob | null>(null);
  const [reprint, setReprint] = useState<KioskRunListItem | null>(null);
  const [todayKey, setTodayKey] = useState(0);
  const top = useRef<HTMLDivElement>(null);

  const go = (next: Step) => { setStep(next); requestAnimationFrame(() => top.current?.scrollIntoView({ block: 'start' })); };
  const restart = () => { setJob(null); setDesign(null); setProduct(null); setTodayKey((k) => k + 1); go('start'); };
  const openRun = (run: KioskRunListItem) => {
    if (run.kiosk && run.kiosk.stage !== 'stopped' && run.office.sent < run.totalLabels && run.office.failedLabels === 0) {
      setJob({ runId: run.id, mode: 'first', count: run.totalLabels, stage: run.kiosk.stage, title: run.kiosk.productName || run.name, designName: run.designName });
      go('print');
    } else setReprint(run);
  };

  const printer = printerLine && (
    <span className={`hidden items-center gap-2 text-sm sm:flex ${printerLine.tone === 'ok' ? 'text-zinc-300' : toneText[printerLine.tone === 'bad' ? 'bad' : 'warn']}`} role="status">
      <span className={`size-2.5 rounded-full ${dot[printerLine.tone]}`} aria-hidden="true" />
      Printer: {printerLine.text}
    </span>
  );

  return (
    <Frame signOut printer={printer}>
      <div ref={top} className="scroll-mt-24" />
      {printerLine && printerLine.tone !== 'ok' && (
        <p className={`mb-4 card flex items-center gap-3 p-4 text-base sm:hidden ${toneText[printerLine.tone === 'bad' ? 'bad' : 'warn']}`} role="status">
          <span className={`size-2.5 shrink-0 rounded-full ${dot[printerLine.tone]}`} aria-hidden="true" />Printer: {printerLine.text}
        </p>
      )}
      {step === 'start' && <StartStep onPick={(p) => { setProduct(p); setDesign(null); go('design'); }} onOpenRun={openRun} refreshKey={todayKey} />}
      {step === 'design' && product && <DesignStep product={product} onBack={() => go('start')} onPick={(d) => { setDesign(d); go('quantity'); }} onOpenRun={openRun} />}
      {step === 'quantity' && product && design && (
        <QuantityStep product={product} design={design} onBack={() => go('design')}
          onStarted={(started) => { setJob(started); go('print'); }} />
      )}
      {step === 'print' && job && <KioskPrinter key={`${job.mode}:${job.runId}`} job={job} onFinished={restart} />}
      <ReprintDialog run={reprint} onClose={() => setReprint(null)} onStart={(started) => { setReprint(null); setJob(started); go('print'); }} />
    </Frame>
  );
}

// --- 1. Product ----------------------------------------------------------------

function StartStep({ onPick, onOpenRun, refreshKey }: { onPick: (product: Product) => void; onOpenRun: (run: KioskRunListItem) => void; refreshKey: number }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState('');
  const [error, setError] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const search = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const q = query.trim();
    if (q.length < 2) { setError('Type at least 2 letters of the product name.'); return; }
    setSearching(true); setError('');
    try {
      const response = await fetch(`/api/nabis/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'search');
      const rows: Record<string, string>[] = Array.isArray(data.packages) ? data.packages : [];
      const groups = new Map<string, Record<string, string>[]>();
      for (const row of rows) { const key = packageKey(row); if (!key) continue; groups.set(key, [...(groups.get(key) ?? []), row]); }
      setProducts(Array.from(groups, ([key, list]) => ({ key, rows: list, name: nameOf(list[0]), category: productCategory(list[0]), rawCategory: String(list[0].category ?? '') })));
      setSearched(q);
      if (data.error) setError('Manifest didn’t answer fully just now. If your product isn’t here, search again in a moment.');
    } catch (e) {
      setProducts([]); setSearched('');
      setError(friendlyError(e, 'Couldn’t search just now. Try again in a minute.').replace(/^search$/, 'Couldn’t search just now. Try again in a minute.'));
    } finally { setSearching(false); }
  };
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold">Print labels</h1>
        <form onSubmit={search} className="flex flex-col gap-3 sm:flex-row" role="search">
          <label htmlFor="kiosk-search" className="sr-only">Product name, batch or package tag</label>
          <input id="kiosk-search" className="field h-14 flex-1 text-xl" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a product name, batch or tag" autoComplete="off" enterKeyHint="search" autoFocus />
          <button type="submit" className="btn btn-primary kiosk-btn" disabled={searching}><Search className="size-6" aria-hidden="true" />{searching ? 'Searching…' : 'Search'}</button>
        </form>
        {error && <p role="alert" className="text-lg text-red-300">{error}</p>}
        {searched && !searching && !products.length && !error && <p role="status" className="text-lg text-zinc-300">Nothing found for “{searched}”. Check the spelling, or try part of the name.</p>}
        {products.length > 0 && (
          <ul className="grid gap-3 md:grid-cols-2" aria-label="Products found">
            {products.map((p) => {
              const row = p.rows[0];
              const facts = [row.brandName, row.batchNumber || row.batch ? `Batch ${row.batchNumber || row.batch}` : '', p.rawCategory ? plainCategory(p.rawCategory) : '', p.rows.length > 1 ? `${p.rows.length.toLocaleString('en-US')} units` : ''].filter(Boolean);
              return (
                <li key={p.key}>
                  <button type="button" onClick={() => onPick(p)} className="card flex w-full items-center gap-4 p-4 text-left transition-colors hover:border-amber-500/60 focus-visible:border-amber-500">
                    <Package className="size-8 shrink-0 text-amber-400" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xl font-medium text-zinc-100">{p.name}</span>
                      {facts.length > 0 && <span className="mt-0.5 block text-base text-zinc-400">{facts.join(' · ')}</span>}
                      {(row.packageTag || row.tag) && <span className="mt-0.5 block truncate text-sm text-zinc-500">Tag {row.packageTag || row.tag}</span>}
                    </span>
                    <ChevronRight className="size-7 shrink-0 text-zinc-500" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <RunList title="Today’s prints" empty="Nothing printed at the kiosk today yet." query={`since=${encodeURIComponent(startOfToday())}`} refreshKey={refreshKey} onOpenRun={onOpenRun} />
    </div>
  );
}
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); }

/** A list of past prints (today's, or a product's), each with Continue or Print again. */
function RunList({ title, empty, query, refreshKey = 0, onOpenRun }: { title: string; empty: string; query: string; refreshKey?: number; onOpenRun: (run: KioskRunListItem) => void }) {
  const [runs, setRuns] = useState<KioskRunListItem[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/kiosk/runs?${query}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Couldn’t load past prints.');
      setRuns(Array.isArray(data.runs) ? data.runs : []); setError('');
    } catch (e) { setError(friendlyError(e, 'Couldn’t load past prints.')); }
  }, [query]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, 20_000);
    return () => clearInterval(timer);
  }, [load, refreshKey]);
  return (
    <section className="space-y-3" aria-label={title}>
      <h2 className="flex items-center gap-2 text-xl font-semibold"><History className="size-6 text-zinc-400" aria-hidden="true" />{title}</h2>
      {error && <p role="alert" className="text-base text-red-300">{error}</p>}
      {runs === null && !error && <p className="text-base text-zinc-400">Loading…</p>}
      {runs && !runs.length && <p className="text-base text-zinc-400">{empty}</p>}
      {runs && runs.length > 0 && (
        <ul className="card divide-y divide-zinc-800">
          {runs.map((run) => {
            const words = runWords(run);
            const resume = !!run.kiosk && run.kiosk.stage !== 'stopped' && run.office.sent < run.totalLabels && run.office.failedLabels === 0;
            return (
              <li key={run.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-medium text-zinc-100">{run.kiosk?.productName || run.name}</p>
                  <p className="text-base text-zinc-400">{[run.designName, labels(run.totalLabels), when(run.createdAt)].filter(Boolean).join(' · ')}</p>
                  <p className={`text-base ${toneText[words.tone]}`}>{words.text}</p>
                </div>
                {run.thermal
                  ? <button type="button" className="btn btn-secondary kiosk-btn" onClick={() => onOpenRun(run)}>
                      {resume ? <><ChevronRight className="size-5" aria-hidden="true" />Continue</> : <><RotateCcw className="size-5" aria-hidden="true" />Print again</>}
                    </button>
                  : <span className="text-sm text-zinc-500">Not for this printer</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// --- 2. Label ------------------------------------------------------------------

function useKioskDesignList() {
  const [answer, setAnswer] = useState<KioskDesignsAnswer | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetch('/api/kiosk/designs', { cache: 'no-store' })
      .then(async (r) => { const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Couldn’t load the labels.'); return data as KioskDesignsAnswer; })
      .then((data) => { if (active) setAnswer(data); })
      .catch((e) => { if (active) setError(friendlyError(e, 'Couldn’t load the labels. Try again.')); });
    return () => { active = false; };
  }, []);
  return { answer, error };
}

/** The first `across` labels' values, for the picture. */
function laneValues(check: KioskDesignCheck, rows: Record<string, string>[], across: number) {
  return Array.from({ length: Math.max(1, across) }, (_, i) => kioskLabelValues(check.mappings, {}, check.perUnit ? rows[i] : rows[0])).slice(0, check.perUnit ? Math.max(1, Math.min(across, rows.length)) : across);
}

function ProductBar({ product, onBack, backLabel }: { product: Product; onBack: () => void; backLabel: string }) {
  const row = product.rows[0];
  return (
    <div className="card flex flex-wrap items-center gap-4 p-4">
      <Package className="size-8 shrink-0 text-amber-400" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-zinc-400">Product</p>
        <p className="text-xl font-medium">{product.name}</p>
        <p className="text-base text-zinc-400">{[row.brandName, row.batchNumber || row.batch ? `Batch ${row.batchNumber || row.batch}` : '', product.category ?? ''].filter(Boolean).join(' · ')}</p>
      </div>
      <button type="button" className="btn btn-secondary kiosk-btn" onClick={onBack}><ArrowLeft className="size-5" aria-hidden="true" />{backLabel}</button>
    </div>
  );
}

function DesignStep({ product, onBack, onPick, onOpenRun }: { product: Product; onBack: () => void; onPick: (design: KioskDesign) => void; onOpenRun: (run: KioskRunListItem) => void }) {
  const { answer, error } = useKioskDesignList();
  const designs = useMemo(() => answer?.designs ?? [], [answer]);
  const filtered = useMemo(() => designsForCategory(designs.map((d) => ({ ...d, id: d.template.id })), answer?.categories ?? {}, product.category), [designs, answer, product.category]);
  const checks = useMemo(() => new Map(filtered.shown.map((d) => [d.id, kioskDesignCheck(d.template, product.rows, d.format)])), [filtered, product.rows]);
  const name = product.rows[0]?.itemName || product.name;
  return (
    <div className="space-y-6">
      <ProductBar product={product} onBack={onBack} backLabel="Change product" />
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold">Pick a label</h1>
        {error && <p role="alert" className="text-lg text-red-300">{error}</p>}
        {!answer && !error && <p className="text-lg text-zinc-400">Loading labels…</p>}
        {answer && !designs.length && <p role="status" className="card p-5 text-lg text-zinc-300">No labels are on the kiosk yet. Ask a manager to turn on “Use on kiosk” for a label design.</p>}
        {answer && designs.length > 0 && !filtered.matched && product.category && (
          <p role="status" className="text-lg text-amber-200">No labels are set for {product.category} yet, so here are all the kiosk labels.</p>
        )}
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Labels">
          {filtered.shown.map((d) => {
            const check = checks.get(d.id)!;
            const problem = kioskDesignProblem(check);
            const across = Math.max(1, d.format.labelsAcross || 1);
            return (
              <li key={d.id}>
                <button type="button" disabled={!check.usable} onClick={() => onPick(d)} aria-describedby={problem ? `${d.id}-problem` : undefined}
                  className="card flex h-full w-full flex-col gap-3 p-4 text-left transition-colors enabled:hover:border-amber-500/60 focus-visible:border-amber-500 disabled:cursor-not-allowed">
                  <KioskPreview template={d.template} format={d.format} lanes={laneValues(check, product.rows, across)} alt={`Picture of the ${d.template.name} label for ${product.name}`} className={check.usable ? '' : 'opacity-50'} />
                  <span className="text-xl font-medium text-zinc-100">{d.template.name}</span>
                  <span className="text-base text-zinc-400">{d.format.name}</span>
                  {problem
                    ? <span id={`${d.id}-problem`} className="text-base text-red-300">{problem}</span>
                    : check.leftBlank.length > 0 && <span className="text-sm text-zinc-400">Prints without {check.leftBlank.join(', ')} (this product doesn’t have {check.leftBlank.length === 1 ? 'it' : 'them'}).</span>}
                  {check.usable && <span className="btn btn-primary kiosk-btn mt-auto w-full">Use this label</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <RunList title="What’s been run for this product" empty="Nothing printed for this product yet." query={`product=${encodeURIComponent(product.key)}&name=${encodeURIComponent(name)}`} onOpenRun={onOpenRun} />
    </div>
  );
}

// --- 3. How many ------------------------------------------------------------------

function QuantityStep({ product, design, onBack, onStarted }: { product: Product; design: KioskDesign; onBack: () => void; onStarted: (job: KioskPrintJob) => void }) {
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const check = useMemo(() => kioskDesignCheck(design.template, product.rows, design.format), [design, product.rows]);
  const across = Math.max(1, design.format.labelsAcross || 1);
  const parsed = parseQuantity(text);
  const overUnits = check.perUnit && parsed.value !== null && parsed.value > check.units;
  const problem = parsed.error || (overUnits ? `This label has a code that’s different on every unit. This product has ${check.units.toLocaleString('en-US')} unit${check.units === 1 ? '' : 's'}, so print up to ${check.units.toLocaleString('en-US')}.` : '');
  const quantity = problem ? null : parsed.value;
  const test = quantity ? kioskTestCount(quantity, across) : Math.min(KIOSK_TEST_LABELS, check.perUnit ? check.units : KIOSK_TEST_LABELS);
  const picks = [12, 24, 48, 100].filter((n) => !check.perUnit || n <= check.units);
  const start = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setTouched(true);
    if (!quantity || starting) return;
    setStarting(true); setError('');
    try {
      const response = await fetch('/api/kiosk/runs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: design.template.id, quantity, rows: product.rows, packageKey: product.key, productName: product.name, category: product.category ?? '' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Couldn’t start the print. Try again.');
      onStarted({ runId: data.run.id, mode: 'first', count: data.run.totalLabels, stage: 'test', title: product.name, designName: design.template.name });
    } catch (e) {
      setError(friendlyError(e, 'Couldn’t start the print. Try again.'));
      setStarting(false);
    }
  };
  return (
    <div className="space-y-6">
      <ProductBar product={product} onBack={onBack} backLabel="Change label" />
      <form onSubmit={start} className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="card space-y-3 p-4">
          <KioskPreview template={design.template} format={design.format} lanes={laneValues(check, product.rows, across)} alt={`Picture of the ${design.template.name} label for ${product.name}`} />
          <p className="text-xl font-medium">{design.template.name}</p>
          <p className="text-base text-zinc-400">{design.format.name}</p>
        </div>
        <div className="space-y-4">
          <label htmlFor="kiosk-qty" className="block text-3xl font-semibold">How many labels?</label>
          <input id="kiosk-qty" className="field h-16 text-3xl tabular-nums" inputMode="numeric" pattern="[0-9,]*" autoComplete="off" enterKeyHint="go" autoFocus
            value={text} onChange={(e) => setText(e.target.value)} onBlur={() => setTouched(true)} aria-invalid={touched && !!problem} aria-describedby="kiosk-qty-help" />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick picks">
            {picks.map((n) => (
              <button key={n} type="button" className={`btn ${parsed.value === n ? 'btn-primary' : 'btn-secondary'} kiosk-btn min-w-20`} aria-pressed={parsed.value === n} onClick={() => { setText(String(n)); setTouched(true); }}>
                {parsed.value === n && <Check className="size-5" aria-hidden="true" />}{n}
              </button>
            ))}
            {check.perUnit && check.units > 0 && (
              <button type="button" className={`btn ${parsed.value === check.units ? 'btn-primary' : 'btn-secondary'} kiosk-btn`} aria-pressed={parsed.value === check.units} onClick={() => { setText(String(check.units)); setTouched(true); }}>All {check.units.toLocaleString('en-US')} units</button>
            )}
          </div>
          <p id="kiosk-qty-help" className={`text-lg ${touched && problem ? 'text-red-300' : 'text-zinc-400'}`} role={touched && problem ? 'alert' : undefined}>
            {touched && problem ? problem : quantity && quantity <= test
              ? `The printer makes ${quantity === 1 ? 'it' : `all ${quantity}`}, then you check ${quantity === 1 ? 'it' : 'them'}.`
              : `First the printer makes ${test} for you to check. If they look right, it prints the rest.`}
          </p>
          {error && <p role="alert" className="text-lg text-red-300">{error}</p>}
          <button type="submit" className="btn btn-primary kiosk-btn w-full" disabled={starting || (touched && !quantity)}>
            <PrinterIcon className="size-6" aria-hidden="true" />
            {starting ? 'Starting…' : quantity && quantity > test ? `Print a test of ${test}` : quantity ? `Print ${labels(quantity)}` : 'Print'}
          </button>
        </div>
      </form>
    </div>
  );
}

// --- Print again ---------------------------------------------------------------

function ReprintDialog({ run, onClose, onStart }: { run: KioskRunListItem | null; onClose: () => void; onStart: (job: KioskPrintJob) => void }) {
  const [text, setText] = useState('');
  const [shown, setShown] = useState<string | null>(null);
  if (run && shown !== run.id) { setShown(run.id); setText(String(run.totalLabels)); }
  const parsed = parseQuantity(text);
  const tooMany = !!run && parsed.value !== null && parsed.value > run.totalLabels;
  const problem = parsed.error || (tooMany && run ? `That print had ${labels(run.totalLabels)}. Print up to ${run.totalLabels.toLocaleString('en-US')}.` : '');
  return (
    <Dialog open={!!run} onClose={onClose} title={run ? `Print “${run.kiosk?.productName || run.name}” again?` : ''} description={run ? `${run.designName} · first printed ${when(run.createdAt)}` : undefined} className="max-w-lg">
      {run && (
        <form className="space-y-4" onSubmit={(e) => {
          e.preventDefault();
          if (problem || !parsed.value) return;
          onStart({ runId: run.id, mode: 'reprint', count: parsed.value, title: run.kiosk?.productName || run.name, designName: run.designName });
        }}>
          <label htmlFor="kiosk-again" className="block text-lg font-medium">How many labels?</label>
          <input id="kiosk-again" className="field h-14 text-2xl tabular-nums" inputMode="numeric" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!problem} aria-describedby="kiosk-again-help" />
          <p id="kiosk-again-help" className={`text-base ${problem ? 'text-red-300' : 'text-zinc-400'}`}>{problem || 'The same labels as before, from the first one. A test prints first for you to check.'}</p>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" className="btn btn-secondary kiosk-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary kiosk-btn" disabled={!!problem}><PrinterIcon className="size-5" aria-hidden="true" />Print again</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
