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
        } catch {
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
              {loadError.status !== 404 && <button type="button" onClick={() => void useRunStore.getState().fetchRun(id)} className="btn btn-primary" data-x="text-black">Try again</button>}
              <Link href="/runs" className="btn btn-secondary">Back to runs</Link>
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
      <div className={`flex-1 flex flex-col items-center justify-start sm:justify-center p-4 sm:p-8 transition-colors duration-300 ${
        flash === 'ok' ? 'bg-emerald-500/10' : flash === 'error' ? 'bg-red-500/10' : ''
      }`}>
        <div className="w-full max-w-xl">
          <div className="flex items-center justify-between gap-3 mb-5">
            <Link
              href={`/runs/${run.id}`}
              className="btn btn-ghost btn-sm -ml-3 shrink-0"
            >
              <ArrowLeft className="size-4" aria-hidden="true" /> Back to run
            </Link>
            <div className="min-w-0 text-xs text-zinc-400 truncate">
              {run.name} · {template.name} · {format.name}
            </div>
          </div>

          {/* Transport status strip */}
          <section className="card mb-5 p-3 sm:p-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <ScanBarcode className={`w-5 h-5 shrink-0 ${canPrint ? 'text-emerald-400' : 'text-zinc-500'}`} aria-hidden="true" />
            <div className="min-w-0 flex-1 text-sm">
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
                    className="btn btn-secondary btn-sm"
                  >
                    <Plug className="size-4" aria-hidden="true" /> Connect USB printer
                  </button>
                )
              )}
              {!transport && <span className="text-red-400">{transportError || 'No printer available'}</span>}
            </div>
            {targetField && (
              <span className="text-sm text-zinc-400">
                Each scan fills <span className="font-medium text-zinc-100">{targetField}</span>
              </span>
            )}
          </section>

          {/* The big input. Autofocus + keep-focused. Submit on Enter. */}
          <form
            onSubmit={(e) => { e.preventDefault(); void handleSubmit(value); }}
            className="mb-4"
          >
            {blankCheck && blankCheck.issues.length > 0 && <div className="mb-3"><BlankValueCheck check={blankCheck} leaveBlank={leaveBlank} onLeaveBlankChange={setLeaveBlank} showWhenOk={false} compact remedy={`Each scan only fills ${targetField}. To scan with this design, open it and set the other field${blankCheck.issues.length === 1 ? '' : 's'} to "Same on every label", or print this run from the run page instead.`} /></div>}
            <label htmlFor="scan-input" className="field-label mb-1.5">
              Scan or type, then press Enter
            </label>
            <div className={`relative rounded-xl border-2 transition-colors duration-200 ${
              flash === 'ok'
                ? 'border-emerald-500'
                : flash === 'error'
                  ? 'border-red-500'
                  : 'border-zinc-700 focus-within:border-amber-500'
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
                className="w-full bg-zinc-950 rounded-[10px] text-xl sm:text-2xl font-mono text-zinc-100 px-4 py-4 sm:px-5 sm:py-5 pr-14 placeholder:font-sans placeholder:text-zinc-500 focus-visible:outline-0 disabled:opacity-50"
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 sm:right-5">
                <span key={busy ? 'busy' : flash ?? 'idle'} className={`block ${flash === 'ok' && !busy ? 'animate-success' : 'animate-icon'}`}>
                {busy ? (
                  <Loader2 className="w-6 h-6 text-zinc-400 animate-spin" />
                ) : flash === 'ok' ? (
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                ) : flash === 'error' ? (
                  <AlertCircle className="w-6 h-6 text-red-400" />
                ) : (
                  <ScanBarcode className="w-6 h-6 text-zinc-500" />
                )}
                </span>
              </div>
            </div>
            {!targetField && (
              <p className="mt-2 text-sm text-red-400 flex items-start gap-1.5">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                Nothing on this design changes per label, so there&apos;s nowhere for a scan to go. Open the design and set one part to &ldquo;Changes per label&rdquo;.
              </p>
            )}
          </form>

          {/* History \u2014 newest first, 10 entries. */}
          {history.length > 0 && (
            <section className="mt-6 space-y-1 stagger">
              <h3 className="section-title mb-2">Recent scans</h3>
              {history.map((h) => (
                <div
                  key={h.id}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${
                    h.status === 'ok'
                      ? 'bg-zinc-900 text-zinc-200'
                      : 'bg-red-500/10 text-red-300'
                  }`}
                >
                  {h.status === 'ok'
                    ? <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                    : <AlertCircle className="size-4 text-red-400 shrink-0" />}
                  <span className="flex-1 truncate font-mono text-xs">{h.value}</span>
                  {h.message && <span className="text-xs text-red-400 truncate max-w-[180px]">{h.message}</span>}
                  <span className="text-xs text-zinc-500 tabular-nums shrink-0">
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
