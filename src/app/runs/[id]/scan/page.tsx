'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertCircle, CheckCircle2, Loader2, Plug, ScanBarcode } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { PageTitle } from '@/components/PageTitle';
import { useRunStore } from '@/lib/runStore';
import { BlankSummary } from '@/components/checks/RunChecks';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { blankCheckAllowsPrinting, checkRunData } from '@/lib/runDataCheck';
import { friendlyFieldName } from '@/lib/fieldLabels';
import { defaultScanField, scanCanLookUpRow, scanCheckData, scanLabelValues } from '@/lib/runFieldSetup';
import { barcodeValueProblem } from '@/lib/barcodeCheck';
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
  /** Label number in the run, when the scan found its row. */
  label?: number | null;
  /** A few words naming the label, e.g. the product. */
  what?: string;
  /** How many times this label has now been printed by scanning. */
  times?: number;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
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
 * This mode prints ONE label per scan. The person picks which field a scan
 * fills (default: the barcode or tag field). When that field comes from a
 * spreadsheet column, the scan is looked up in the run's rows and the
 * matching row fills every other per-label field. Only "Same on every label"
 * values are ever reused; another row's per-label values never are.
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

  useEffect(() => { void useRunStore.getState().fetchRun(id); void useRunStore.getState().fetchPrintEvents(id); }, [id]);
  // The run page remembers the printer last used; the office printer can't
  // take scans, so say so plainly instead of leaving a disabled box.
  const [usesOfficePrinter, setUsesOfficePrinter] = useState(false);
  useEffect(() => {
    try { setUsesOfficePrinter(localStorage.getItem('lw:last-transport') === 'office'); } catch { /* unknown: assume a local printer */ }
  }, []);

  // Which field each scan fills: the person picks it (remembered per run),
  // defaulting to the barcode or tag field.
  const fields = useMemo(() => (template ? dynamicFieldsForTemplate(template) : []), [template]);
  const [pickedField, setPickedField] = useState<string | null>(null);
  useEffect(() => {
    try { setPickedField(localStorage.getItem(`lw:scan-field:${id}`)); } catch { /* storage unavailable: use the default */ }
  }, [id]);
  const targetField = useMemo(() => {
    if (!run || !template || !fields.length) return null;
    if (pickedField && fields.includes(pickedField)) return pickedField;
    return defaultScanField(run, template, fields);
  }, [run, template, fields, pickedField]);
  const chooseField = (field: string) => {
    setPickedField(field);
    try { localStorage.setItem(`lw:scan-field:${id}`, field); } catch { /* not remembered */ }
  };
  const lookUp = !!run && scanCanLookUpRow(run, targetField);

  // Every other field must have a value without the scan: a "Same on every
  // label" value, or the matching row when a scan can look one up. Values
  // from other rows never count.
  const [leaveBlank, setLeaveBlank] = useState(false);
  const blankCheck = useMemo(() => {
    if (!run || !template || !targetField) return null;
    return checkRunData(template, scanCheckData(run, fields, targetField));
  }, [run, template, targetField, fields]);
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
          setTransportError('Couldn\u2019t get the printer list from the label printer app on this computer. Check it\u2019s open, then reload this page.');
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
        setTransportError('No printer on this computer. Open your desktop label printer app, or use Chrome or Edge to connect a USB printer.');
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

  const connectUsb = async () => {
    try {
      const device = await requestPrinter();
      setUsbPrinter(await openPrinter(device));
      setTransport('webusb');
    } catch (err) {
      if ((err as Error).name !== 'NotFoundError') setTransportError('Couldn’t connect to the USB printer. Check the cable, then try again.');
    }
  };

  const handleSubmit = useCallback(async (raw: string) => {
    const v = raw.trim();
    if (!v || !run || !template || !format || !targetField) return;
    setBusy(true);
    const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const label = scanLabelValues(run, fields, targetField, v);
      if (lookUp && label.matchedLabel === null) {
        throw new Error(`No label in this run has the ${friendlyFieldName(targetField)} ${v}. Nothing was printed.`);
      }
      if (label.unfilled.length) {
        throw new Error(`${label.unfilled.map(friendlyFieldName).join(', ')} ${label.unfilled.length === 1 ? 'is' : 'are'} empty for this label. Nothing was printed.`);
      }
      for (const el of template.elements) {
        if (el.type !== 'barcode' || el.isStatic || !el.fieldName) continue;
        const problem = barcodeValueProblem(el.barcodeFormat, `${el.prefix || ''}${label.values[el.fieldName] || ''}${el.suffix || ''}`);
        if (problem) throw new Error(`The ${friendlyFieldName(el.fieldName)} ${problem}. Nothing was printed.`);
      }
      const zpl = await generateZPLWithImages(template, format, label.values);
      await sendLabel(zpl);
      // Name the label ("Label 6 · Purple Punch 3.5g") and count repeats.
      const nameField = template.elements
        .filter((el) => el.type === 'text' && !el.isStatic && el.fieldName && el.fieldName !== targetField && (label.values[el.fieldName] ?? '').trim())
        .sort((a, b) => a.y - b.y || a.x - b.x)[0]?.fieldName;
      const what = nameField ? label.values[nameField] : '';
      const labelNumber = label.matchedLabel;
      const earlier = labelNumber
        ? useRunStore.getState().printEvents.filter((e) => e.runId === run.id && e.output === 'scan' && e.rangeFrom === labelNumber).length
        : history.filter((entry) => entry.status === 'ok' && entry.value === v).length;
      setHistory((h) => [{ id: entryId, value: v, at: Date.now(), status: 'ok' as ScanStatus, label: labelNumber, what, times: earlier + 1 }, ...h].slice(0, 20));
      // Leave a record in the run's print history.
      if (labelNumber) {
        const printerName = transport === 'dazzle' ? dazzleSelected : usbPrinter?.productName ?? null;
        void useRunStore.getState().createPrintEvent(run.id, { eventType: 'sent', output: 'scan', rangeFrom: labelNumber, rangeTo: labelNumber, labelCount: 1, printedCountAfter: null, printerName: printerName ?? null, message: earlier ? `Scan (printed again, ${ordinal(earlier + 1)} time)` : 'Scan' }).catch(() => {});
      }
      setFlash('ok');
      setTimeout(() => setFlash(null), 600);
    } catch (err) {
      setHistory((h) => [{
        id: entryId,
        value: v,
        at: Date.now(),
        status: 'error' as ScanStatus,
        message: friendlyRenderError(friendlyError(err, 'Printing failed.'), template.elements, format.labelsAcross || 1),
      }, ...h].slice(0, 20));
      setFlash('error');
      setTimeout(() => setFlash(null), 1200);
    } finally {
      setBusy(false);
      setValue('');
      // Re-focus happens automatically via the refocus listener but be explicit.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [run, template, format, targetField, sendLabel, fields, lookUp, history, transport, dazzleSelected, usbPrinter]);

  // Guard: run / template / format missing.
  if (!run && loadError) {
    return (
      <AppShell>
        <PageTitle title="Scan to print" />
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
        <PageTitle title="Scan to print" />
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div className="max-w-sm space-y-3"><p className="text-sm text-zinc-300">This run has no saved design, so it can&apos;t print from scans.</p><Link href={`/runs/${run.id}`} className="underline text-amber-400">Back to run</Link></div>
        </div>
      </AppShell>
    );
  }
  if (!run || !template || !format) {
    return (
      <AppShell>
        <PageTitle title="Scan to print" />
        <div className="flex-1 flex items-center justify-center text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading run…
        </div>
      </AppShell>
    );
  }

  // A finished or cancelled run has nothing left to scan.
  if (run.status === 'completed' || run.status === 'cancelled') {
    return (
      <AppShell>
        <PageTitle title={`Scan to print · ${run.name}`} />
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-sm space-y-3 text-center">
            <h1 className="text-lg font-semibold text-zinc-100">{run.status === 'completed' ? 'This run is done' : 'This run was cancelled'}</h1>
            <p className="text-sm text-zinc-400">Scan mode is only for runs that still have labels to print. To print labels again, use the run page.</p>
            <Link href={`/runs/${run.id}`} className="btn btn-primary">Back to the run</Link>
          </div>
        </main>
      </AppShell>
    );
  }

  const printerReady = (transport === 'dazzle' && !!dazzleSelected) || (transport === 'webusb' && !!usbPrinter);
  const officeOnly = usesOfficePrinter && !printerReady;
  const canPrint = !!targetField && blanksOk && printerReady;
  const waitingFor = !targetField
    ? 'Nothing on this design changes per label'
    : !blanksOk
      ? 'Some fields have no value. See above.'
      : !printerReady
        ? 'Connect a printer first'
        : 'Waiting for a scan…';

  return (
    <AppShell>
      <PageTitle title={`Scan to print · ${run.name}`} />
      <div className={`flex-1 overflow-auto transition-colors duration-200 ${
        flash === 'ok' ? 'bg-emerald-500/10' : flash === 'error' ? 'bg-red-500/10' : ''
      }`}>
        <div className="page-container"><div className="max-w-xl space-y-5">
          <div className="space-y-1">
            <Link href={`/runs/${run.id}`} className="btn btn-ghost btn-sm -ml-3">
              <ArrowLeft className="size-4" aria-hidden="true" /> Back to run
            </Link>
            <h1 className="text-2xl font-semibold text-zinc-100">Scan to print</h1>
            <p className="truncate text-sm text-zinc-400">{run.name} · {template.name}</p>
          </div>

          {officeOnly && (
            <section role="status" className="space-y-3" aria-label="Office printer">
              <p className="text-sm text-zinc-300">The office printer can’t print from scans. Scans print one label at a time on a printer plugged into this computer.</p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/runs/${run.id}`} className="btn btn-primary">Print on the office printer</Link>
                {transport === 'webusb' && (
                  <button type="button" onClick={() => void connectUsb()} className="btn btn-secondary">
                    <Plug className="size-4" aria-hidden="true" /> Use a USB printer here
                  </button>
                )}
              </div>
            </section>
          )}

          {/* Printer */}
          {!officeOnly && <section className="space-y-2" aria-label="Printer">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <ScanBarcode className={`size-5 shrink-0 ${printerReady ? 'text-emerald-400' : 'text-zinc-500'}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                {transport === 'dazzle' && dazzlePrinters.length > 0 && (
                  <span className="text-zinc-300">Prints on <span className="text-zinc-100">{dazzleSelected}</span> (through the printer app on this computer)</span>
                )}
                {transport === 'dazzle' && dazzlePrinters.length === 0 && (
                  <span className="text-zinc-300">The printer app on this computer shows no printers. Turn the printer on and check it’s set up there.</span>
                )}
                {transport === 'webusb' && usbPrinter && (
                  <span className="text-zinc-300">Prints on <span className="text-zinc-100">{usbPrinter.productName}</span> (USB)</span>
                )}
                {transport === 'webusb' && !usbPrinter && <span className="text-zinc-300">No printer connected to this computer yet.</span>}
                {!transport && <span className="text-zinc-300">{transportError || 'Looking for a printer…'}</span>}
              </div>
              {transport === 'webusb' && !usbPrinter && (
                <button
                  type="button"
                  onClick={() => void connectUsb()}
                  className="btn btn-secondary btn-sm"
                >
                  <Plug className="size-4" aria-hidden="true" /> Connect USB printer
                </button>
              )}
            </div>
            {!printerReady && (
              <p className="text-sm text-zinc-400">
                Plug a label printer into this computer, or <Link href={`/runs/${run.id}`} className="text-amber-400 hover:underline">use the office printer</Link> from the run page.
              </p>
            )}
            {transportError && transport && <p role="alert" className="text-sm text-red-400">{transportError}</p>}
          </section>}

          {/* What a scan fills */}
          {targetField && (
            <section className="space-y-1.5" aria-label="What each scan fills">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span id="scan-field-label" className="field-label">Each scan fills</span>
                <div className="min-w-48 flex-1">
                  <CustomSelect
                    aria-labelledby="scan-field-label"
                    value={targetField}
                    onChange={chooseField}
                    options={fields.map((field) => ({ value: field, label: friendlyFieldName(field) }))}
                  />
                </div>
              </div>
              <p className="text-sm text-zinc-400">
                {lookUp
                  ? `Each scan finds the label in this run with that ${friendlyFieldName(targetField)} and prints it.`
                  : 'The other fields print the value set for every label.'}
              </p>
            </section>
          )}

          {blankCheck && blankCheck.issues.length > 0 && (
            <BlankSummary
              check={blankCheck}
              mode="scan"
              leaveBlank={leaveBlank}
              onLeaveBlankChange={setLeaveBlank}
              showWhenOk={false}
              extra={`Pick a field from your spreadsheet above so a scan can find its label, or print this run from the run page.`}
            />
          )}

          {/* The big input. Autofocus + keep-focused. Submit on Enter. */}
          {!officeOnly && <form onSubmit={(e) => { e.preventDefault(); void handleSubmit(value); }}>
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
                placeholder={waitingFor}
                autoFocus
                disabled={!canPrint || busy}
                className="w-full bg-zinc-950 rounded-[10px] text-xl sm:text-2xl tabular-nums text-zinc-100 px-4 py-4 sm:px-5 sm:py-5 pr-14 placeholder:text-base placeholder:text-zinc-500 focus-visible:outline-0 disabled:opacity-60"
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 sm:right-5">
                <span key={busy ? 'busy' : flash ?? 'idle'} className={`block ${flash === 'ok' && !busy ? 'animate-success' : 'animate-icon'}`}>
                {busy ? (
                  <Loader2 className="size-6 text-zinc-400 animate-spin" aria-hidden="true" />
                ) : flash === 'ok' ? (
                  <CheckCircle2 className="size-6 text-emerald-400" aria-hidden="true" />
                ) : flash === 'error' ? (
                  <AlertCircle className="size-6 text-red-400" aria-hidden="true" />
                ) : (
                  <ScanBarcode className="size-6 text-zinc-500" aria-hidden="true" />
                )}
                </span>
              </div>
            </div>
            {!targetField && (
              <p className="mt-2 text-sm text-red-400 flex items-start gap-1.5">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                Nothing on this design changes per label, so there&apos;s nowhere for a scan to go. Open the design and set one part to &ldquo;Changes per label&rdquo;.
              </p>
            )}
          </form>}

          {/* History, newest first, 10 entries. */}
          {history.length > 0 && (
            <section className="space-y-1 stagger" aria-label="Recent scans">
              <h2 className="section-title mb-2">Recent scans</h2>
              {history.map((h) => (
                <div
                  key={h.id}
                  className={`flex items-start gap-3 px-3 py-2 rounded-lg text-sm ${
                    h.status === 'ok' ? 'bg-zinc-900 text-zinc-100' : 'bg-red-500/10 text-red-400'
                  }`}
                >
                  {h.status === 'ok'
                    ? <CheckCircle2 className="mt-0.5 size-4 text-emerald-400 shrink-0" aria-hidden="true" />
                    : <AlertCircle className="mt-0.5 size-4 text-red-400 shrink-0" aria-hidden="true" />}
                  <span className="min-w-0 flex-1">
                    {h.status === 'ok' && (h.label || h.what) ? (
                      <span className="block truncate text-zinc-100">{[h.label ? `Label ${h.label.toLocaleString()}` : '', h.what].filter(Boolean).join(' · ')}</span>
                    ) : null}
                    <span className={`block truncate tabular-nums ${h.status === 'ok' && (h.label || h.what) ? 'text-zinc-400' : ''}`}>{h.value}</span>
                    {h.status === 'ok' && (h.times ?? 1) > 1 && <span className="block text-amber-300">Printed again ({ordinal(h.times ?? 2)} time)</span>}
                    {h.message && <span className="block text-red-400">{h.message}</span>}
                  </span>
                  <span className="text-zinc-400 tabular-nums shrink-0">
                    {new Date(h.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
              ))}
            </section>
          )}
        </div></div>
      </div>
    </AppShell>
  );
}
