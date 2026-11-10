'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertCircle, CheckCircle2, Loader2, Plug, ScanBarcode } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { PageTitle } from '@/components/PageTitle';
import { useRunStore } from '@/lib/runStore';
import { BlankValueCheck } from '@/components/runs/BlankValueCheck';
import { blankCheckAllowsPrinting, checkRunData } from '@/lib/runDataCheck';
import { friendlyError, friendlyRenderError } from '@/lib/userMessages';
import { generateZPLWithImages } from '@/lib/zplGenerator';
import { dynamicFieldsForTemplate } from '@/lib/runBuilder';
import {
  isWebUsbSupported,
  getAuthorizedPrinters,
  openPrinter,
  requestPrinter,
  printZpl,
  type ConnectedPrinter,
} from '@/lib/webusbPrinter';
import {
  isDazzleRunning,
  listDazzlePrinters,
  printViaDazzle,
  type DazzlePrinter,
} from '@/lib/dazzlePrinter';

type Transport = 'dazzle' | 'webusb';
type ScanStatus = 'ok' | 'error';
interface ScanEntry {
  id: string;
  value: string;
  at: number;
  status: ScanStatus;
  message?: string;
}

/**
 * Scan-to-print mode for a single run.
 *
 * The intended workflow is a cashier / packer with a USB/Bluetooth barcode
 * scanner that types its payload and then presses Enter. We keep the input
 * focused at all times so the operator can just scan repeatedly without
 * touching the screen; each scan resolves -> generates ZPL -> sends to the
 * printer -> clears the input. A short history list gives confidence.
 *
 * This mode prints ONE label per scan and uses the run's existing
 * `staticValues` + `fieldMappings` for context. The scanned value fills
 * whichever field the user picks (defaulting to the first dynamic field
 * mapped to a column, or the mappedField from legacy paste-mode runs).
 *
 * Printer setup is reused from RunPrinter \u2014 Dazzle preferred, WebUSB fallback.
 * We don't persist scanned values to `run.sourceData` in this mode; this is
 * a live register flow, not a batch. A future enhancement could log scans
 * to the run so they show up in the history list.
 */
export default function ScanModePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const run = useRunStore((s) => s.runs.find((r) => r.id === id));
  const loadError = useRunStore((s) => s.runLoadErrors[id]);

  const template = run?.designSnapshot?.template ?? null;
  const format = run?.designSnapshot?.format ?? null;

  useEffect(() => { void useRunStore.getState().fetchRun(id); }, [id]);

  // Which dynamic field gets the scanned value. Default to the first
  // column-mapped field, or the legacy mappedField, or the first dynamic
  // field on the template.
  const targetField = useMemo(() => {
    if (!run || !template) return null;
    const allFields = dynamicFieldsForTemplate(template);
    const mapped = Object.entries(run.fieldMappings || {})
      .find(([, m]) => m.mode === 'column')?.[0];
    return mapped ?? run.mappedField ?? allFields[0] ?? null;
  }, [run, template]);

  // Each scan fills one field; every other field that changes per label must
  // already have a value, or the label would print the design's sample.
  const [leaveBlank, setLeaveBlank] = useState(false);
  const blankCheck = useMemo(() => {
    if (!run || !template || !targetField) return null;
    return checkRunData(template, {
      sourceData: [{ __scan__: 'scanned' }],
      fieldMappings: { [targetField]: { mode: 'column', csvColumn: '__scan__' } },
      staticValues: run.staticValues,
    });
  }, [run, template, targetField]);
  const blanksOk = !blankCheck || blankCheckAllowsPrinting(blankCheck, leaveBlank);

  // Transport wiring (mirrors RunPrinter).
  const [transport, setTransport] = useState<Transport | null>(null);
  const [usbPrinter, setUsbPrinter] = useState<ConnectedPrinter | null>(null);
  const [dazzlePrinters, setDazzlePrinters] = useState<DazzlePrinter[]>([]);
  const [dazzleSelected, setDazzleSelected] = useState<string | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);
  const webUsbSupported = typeof window !== 'undefined' && isWebUsbSupported();

  useEffect(() => {
    (async () => {
      const dz = await isDazzleRunning();
      if (dz) {
        setTransport('dazzle');
        try {
          const ps = await listDazzlePrinters();
          setDazzlePrinters(ps);
          const saved = typeof window !== 'undefined' ? localStorage.getItem('lw:dazzle-printer') : null;
          const match = saved ? ps.find((p) => p.name === saved) : undefined;
          setDazzleSelected(match?.name ?? ps.find((p) => p.is_default)?.name ?? ps[0]?.name ?? null);
        } catch (err) {
          setTransportError('Couldn\u2019t get the printer list from the Dazzle app. Check it\u2019s open, then reload this page.');
        }
      } else if (webUsbSupported) {
        setTransport('webusb');
        try {
          const authorized = await getAuthorizedPrinters();
          if (authorized.length > 0) {
            const opened = await openPrinter(authorized[0]);
            setUsbPrinter(opened);
          }
        } catch { /* soft fail */ }
      } else {
        setTransportError('No printer found. Open the Dazzle app on this computer, or use Chrome or Edge to connect a USB printer.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Input + history state.
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<'ok' | 'error' | null>(null);
  const [history, setHistory] = useState<ScanEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the input focused at all times. If the user clicks away, any
  // keydown on the page refocuses it so the scanner's next volley lands
  // correctly.
  useEffect(() => {
    const refocus = () => inputRef.current?.focus();
    refocus();
    window.addEventListener('keydown', refocus);
    window.addEventListener('click', refocus);
    return () => {
      window.removeEventListener('keydown', refocus);
      window.removeEventListener('click', refocus);
    };
  }, []);

  const sendLabel = useCallback(async (zpl: string) => {
    if (new TextEncoder().encode(zpl).length > 2 * 1024 * 1024) throw new Error('This feed exceeds the 2 MiB printer limit. Reduce the label/image size.');
    if (transport === 'dazzle') {
      await printViaDazzle(zpl, dazzleSelected ?? undefined);
    } else if (transport === 'webusb' && usbPrinter) {
      await printZpl(usbPrinter, zpl);
    } else {
      throw new Error('No printer connected');
    }
  }, [transport, dazzleSelected, usbPrinter]);

  const handleSubmit = useCallback(async (raw: string) => {
    const v = raw.trim();
    if (!v || !run || !template || !format || !targetField) return;
    setBusy(true);
    const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const values: Record<string, string> = { ...(run.staticValues || {}), [targetField]: v };
      const zpl = await generateZPLWithImages(template, format, values);
      await sendLabel(zpl);
      setHistory((h) => [{ id: entryId, value: v, at: Date.now(), status: 'ok' as ScanStatus }, ...h].slice(0, 10));
      setFlash('ok');
      setTimeout(() => setFlash(null), 600);
    } catch (err) {
      setHistory((h) => [{
        id: entryId,
        value: v,
        at: Date.now(),
        status: 'error' as ScanStatus,
        message: friendlyRenderError(friendlyError(err, 'Printing failed.'), template.elements, format.labelsAcross || 1),
      }, ...h].slice(0, 10));
      setFlash('error');
      setTimeout(() => setFlash(null), 1200);
    } finally {
      setBusy(false);
      setValue('');
      // Re-focus happens automatically via the refocus listener but be explicit.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [run, template, format, targetField, sendLabel]);

  // Guard: run / template / format missing.
  if (!run && loadError) {
    return (
      <AppShell>
        <PageTitle title="Scan mode" />
        <div className="flex-1 flex items-center justify-center p-6">
          <div role="alert" className="max-w-sm text-center space-y-3">
            <h1 className="text-lg font-semibold text-zinc-100">{loadError.status === 404 ? 'We couldn\u2019t find that run' : 'We couldn\u2019t load that run'}</h1>
            <p className="text-sm text-zinc-400">{loadError.status === 404 ? 'It may have been deleted.' : friendlyError(loadError.message)}</p>
            <div className="flex justify-center gap-2">
              {loadError.status !== 404 && <button type="button" onClick={() => void useRunStore.getState().fetchRun(id)} className="min-h-10 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-black">Try again</button>}
              <Link href="/runs" className="min-h-10 inline-flex items-center rounded-lg border border-zinc-700 px-4 text-sm text-zinc-200">Back to runs</Link>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }
  if (run && (!template || !format)) {
    return (
      <AppShell>
        <PageTitle title="Scan mode" />
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div className="max-w-sm space-y-3"><p className="text-sm text-zinc-300">This run has no saved design, so it can&apos;t print from scans.</p><Link href={`/runs/${run.id}`} className="underline text-amber-400">Back to run</Link></div>
        </div>
      </AppShell>
    );
  }
  if (!run || !template || !format) {
    return (
      <AppShell>
        <PageTitle title="Scan mode" />
        <div className="flex-1 flex items-center justify-center text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading run…
        </div>
      </AppShell>
    );
  }

  const canPrint = !!targetField && blanksOk && (
    (transport === 'dazzle' && !!dazzleSelected) ||
    (transport === 'webusb' && !!usbPrinter)
  );

  return (
    <AppShell>
      <PageTitle title={`Scan \u00b7 ${run.name}`} />
      <div className={`flex-1 flex flex-col items-center justify-center p-8 transition-colors ${
        flash === 'ok' ? 'bg-emerald-500/5' : flash === 'error' ? 'bg-red-500/10' : ''
      }`}>
        <div className="w-full max-w-xl">
          <div className="flex items-center justify-between mb-6">
            <Link
              href={`/runs/${run.id}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to run
            </Link>
            <div className="text-xs text-zinc-500 truncate">
              {run.name} · {template.name} · {format.name}
            </div>
          </div>

          {/* Transport status strip */}
          <section className="mb-6 p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800 flex items-center gap-3">
            <ScanBarcode className={`w-5 h-5 ${canPrint ? 'text-amber-400' : 'text-zinc-600'}`} />
            <div className="flex-1 text-xs">
              {transport === 'dazzle' && dazzlePrinters.length > 0 && (
                <span className="text-zinc-400">Printing on this computer (Dazzle app) → <span className="text-zinc-200">{dazzleSelected}</span></span>
              )}
              {transport === 'dazzle' && dazzlePrinters.length === 0 && (
                <span className="text-zinc-500">The Dazzle app is running but shows no printers. Turn the printer on and check it&apos;s set up in Dazzle.</span>
              )}
              {transport === 'webusb' && (
                usbPrinter ? (
                  <span className="text-zinc-400">Printing on USB printer → <span className="text-zinc-200">{usbPrinter.productName}</span></span>
                ) : (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const d = await requestPrinter();
                        const o = await openPrinter(d);
                        setUsbPrinter(o);
                      } catch (err) {
                        if ((err as Error).name !== 'NotFoundError') setTransportError('Couldn\u2019t connect to the USB printer. Check the cable, then try again.');
                      }
                    }}
                    className="flex min-h-10 items-center gap-1.5 text-amber-400 hover:text-amber-300"
                  >
                    <Plug className="w-3.5 h-3.5" /> Connect USB printer
                  </button>
                )
              )}
              {!transport && <span className="text-red-400">{transportError || 'No printer available'}</span>}
            </div>
            {targetField && (
              <span className="text-[11px] text-zinc-500">
                Each scan fills: <span className="text-amber-400 font-mono">{targetField}</span>
              </span>
            )}
          </section>

          {/* The big input. Autofocus + keep-focused. Submit on Enter. */}
          <form
            onSubmit={(e) => { e.preventDefault(); void handleSubmit(value); }}
            className="mb-4"
          >
            {blankCheck && blankCheck.issues.length > 0 && <div className="mb-3"><BlankValueCheck check={blankCheck} leaveBlank={leaveBlank} onLeaveBlankChange={setLeaveBlank} showWhenOk={false} compact /></div>}
            <label htmlFor="scan-input" className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-2 block">
              Scan or type, then press Enter
            </label>
            <div className={`relative rounded-2xl border-2 transition-colors ${
              flash === 'ok'
                ? 'border-emerald-500/40'
                : flash === 'error'
                  ? 'border-red-500/40'
                  : 'border-amber-500/30'
            }`}>
              <input
                ref={inputRef}
                id="scan-input"
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={canPrint ? 'Waiting for a scan…' : !blanksOk ? 'Fill the missing values first' : 'Connect a printer first'}
                autoFocus
                disabled={!canPrint || busy}
                className="w-full bg-zinc-950 rounded-2xl text-2xl font-mono text-zinc-100 px-5 py-5 pr-16 focus:outline-none disabled:opacity-40"
              />
              <div className="absolute right-5 top-1/2 -translate-y-1/2">
                {busy ? (
                  <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
                ) : flash === 'ok' ? (
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                ) : flash === 'error' ? (
                  <AlertCircle className="w-6 h-6 text-red-400" />
                ) : (
                  <ScanBarcode className="w-6 h-6 text-zinc-600" />
                )}
              </div>
            </div>
            {!targetField && (
              <p className="mt-2 text-xs text-red-400 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" />
                Nothing on this design changes per label, so there&apos;s nowhere for a scan to go. Open the design and set one part to &ldquo;Changes per label&rdquo;.
              </p>
            )}
          </form>

          {/* History \u2014 newest first, 10 entries. */}
          {history.length > 0 && (
            <section className="mt-6 space-y-1.5">
              <h3 className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-2">Recent scans</h3>
              {history.map((h) => (
                <div
                  key={h.id}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-mono ${
                    h.status === 'ok'
                      ? 'bg-emerald-500/5 border border-emerald-500/15 text-zinc-300'
                      : 'bg-red-500/5 border border-red-500/20 text-red-300'
                  }`}
                >
                  {h.status === 'ok'
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    : <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                  <span className="flex-1 truncate">{h.value}</span>
                  {h.message && <span className="text-[10px] text-red-400 truncate max-w-[180px]">{h.message}</span>}
                  <span className="text-[10px] text-zinc-500 tabular-nums shrink-0">
                    {new Date(h.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </AppShell>
  );
}
