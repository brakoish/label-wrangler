'use client';

import { SegmentedIndicator } from '@/components/ui/Segmented';
import { useState, useEffect, useCallback, useId, useMemo, useRef } from 'react';
import { PopLayer, useDismiss } from '@/components/ui/PopLayer';
import { Printer, PrinterCheck, Plug, Target, Loader2, Download, ChevronDown } from 'lucide-react';
import type { LabelFormat, LabelTemplate } from '@/lib/types';
import { generateZPL, generateZPLWithImages, prepareZplImages } from '@/lib/zplGenerator';
import {
  isWebUsbSupported,
  getAuthorizedPrinters,
  requestPrinter,
  openPrinter,
  printZpl as printZplWebUsb,
  calibrationZpl,
  printerAdjustmentsZpl,
  autoCalibrateZpl,
  type ConnectedPrinter,
} from '@/lib/webusbPrinter';
import {
  isDazzleRunning,
  listDazzlePrinters,
  printViaDazzle,
  printAllViaDazzle,
  DAZZLE_DOWNLOAD_URL,
  type DazzlePrinter,
} from '@/lib/dazzlePrinter';

interface PrintControlsProps {
  format: LabelFormat;
  template: LabelTemplate;
  testData?: Record<string, string>;
  proofReady?: boolean;
}

type Transport = 'webusb' | 'dazzle';

/**
 * Unified test-print controls that support two transports:
 *  1. WebUSB (Chrome/Edge only, no installs, but fails on Windows because
 *     the OS claims the printer via usbprint.sys).
 *  2. Dazzle (tiny local desktop app, works on all OSes without driver hacks).
 *
 * We auto-detect Dazzle on mount; if present, prefer it. Users can still
 * toggle transports manually.
 */
export function PrintControls({ format, template, testData, proofReady = true }: PrintControlsProps) {
  // Detection / transport state
  const [dazzleAvailable, setDazzleAvailable] = useState<boolean>(false);
  const [transport, setTransport] = useState<Transport>('webusb');
  const [transportInitialized, setTransportInitialized] = useState(false);

  // WebUSB state
  const [usbPrinter, setUsbPrinter] = useState<ConnectedPrinter | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Dazzle state
  const [dazzlePrinters, setDazzlePrinters] = useState<DazzlePrinter[]>([]);
  const [selectedDazzlePrinter, setSelectedDazzlePrinter] = useState<string | null>(null);
  const [dazzlePickerOpen, setDazzlePickerOpen] = useState(false);

  // Shared state
  const [printing, setPrinting] = useState<null | 'label' | 'calibration'>(null);
  const [error, setError] = useState<string | null>(null);
  const [labelQty, setLabelQty] = useState<number>(1);
  // Calibration print options — persisted for convenience.
  const [calibCount, setCalibCount] = useState<number>(1);
  const [calibMenuOpen, setCalibMenuOpen] = useState(false);
  // Both popovers close on Escape, a press outside, or a dialog opening.
  const dazzlePickerRef = useRef<HTMLDivElement>(null), dazzleTriggerRef = useRef<HTMLButtonElement>(null);
  const calibMenuRef = useRef<HTMLDivElement>(null), calibTriggerRef = useRef<HTMLButtonElement>(null);
  useDismiss(dazzlePickerOpen, () => setDazzlePickerOpen(false), [dazzlePickerRef, dazzleTriggerRef]);
  useDismiss(calibMenuOpen, () => setCalibMenuOpen(false), [calibMenuRef, calibTriggerRef]);
  // Printer adjustment knobs (sent as ZPL control commands with every
  // calibration print, and individually via the Apply button). Persisted in
  // localStorage so user doesn't lose their dialed-in settings.
  const [topOffset, setTopOffset] = useState<number>(0);
  const [leftShift, setLeftShift] = useState<number>(0);
  const [darkness, setDarkness] = useState<number>(10);
  const [speed, setSpeed] = useState<number>(4);

  const webUsbSupported = typeof window !== 'undefined' && isWebUsbSupported();

  // On mount: detect Dazzle, pick best default transport, restore saved choice.
  useEffect(() => {
    (async () => {
      const dz = await isDazzleRunning();
      setDazzleAvailable(dz);

      // Restore saved transport preference
      const saved = typeof window !== 'undefined' ? localStorage.getItem('lw:transport') : null;
      const preferred: Transport =
        saved === 'webusb' || saved === 'dazzle'
          ? (saved as Transport)
          : dz
          ? 'dazzle'
          : 'webusb';
      setTransport(preferred);
      setTransportInitialized(true);

      // If starting on Dazzle, preload printer list + restore saved printer
      if (preferred === 'dazzle' && dz) {
        try {
          const ps = await listDazzlePrinters();
          setDazzlePrinters(ps);
          const savedPrinter = localStorage.getItem('lw:dazzle-printer');
          const match = savedPrinter ? ps.find((p) => p.name === savedPrinter) : undefined;
          setSelectedDazzlePrinter(match?.name ?? ps.find((p) => p.is_default)?.name ?? ps[0]?.name ?? null);
        } catch (err) {
          console.warn('Failed to list Dazzle printers', err);
        }
      }
    })();
  }, []);

  // Persist transport choice.
  useEffect(() => {
    if (transportInitialized && typeof window !== 'undefined') {
      localStorage.setItem('lw:transport', transport);
    }
  }, [transport, transportInitialized]);

  // Persist Dazzle printer choice.
  useEffect(() => {
    if (selectedDazzlePrinter && typeof window !== 'undefined') {
      localStorage.setItem('lw:dazzle-printer', selectedDazzlePrinter);
    }
  }, [selectedDazzlePrinter]);

  // Restore printer adjustment knobs on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem('lw:printer-adjust');
    if (!raw) return;
    try {
      const v = JSON.parse(raw);
      if (typeof v.topOffset === 'number') setTopOffset(v.topOffset);
      if (typeof v.leftShift === 'number') setLeftShift(v.leftShift);
      if (typeof v.darkness === 'number') setDarkness(v.darkness);
      if (typeof v.speed === 'number') setSpeed(v.speed);
    } catch {}
  }, []);

  // Persist printer adjustments.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('lw:printer-adjust', JSON.stringify({ topOffset, leftShift, darkness, speed }));
  }, [topOffset, leftShift, darkness, speed]);

  // When switching to Dazzle, refresh printer list.
  useEffect(() => {
    if (transport !== 'dazzle' || !dazzleAvailable) return;
    (async () => {
      try {
        const ps = await listDazzlePrinters();
        setDazzlePrinters(ps);
        if (!selectedDazzlePrinter && ps.length > 0) {
          setSelectedDazzlePrinter(ps.find((p) => p.is_default)?.name ?? ps[0].name);
        }
      } catch (err) {
        console.warn('Failed to refresh Dazzle printers', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport, dazzleAvailable]);

  // WebUSB: auto-reconnect previously-authorized printer.
  useEffect(() => {
    if (transport !== 'webusb' || !webUsbSupported) return;
    (async () => {
      try {
        const authorized = await getAuthorizedPrinters();
        if (authorized.length > 0) {
          const opened = await openPrinter(authorized[0]);
          setUsbPrinter(opened);
        }
      } catch {
        // Soft-fail — could be access-denied on Windows; user will see it when they try.
      }
    })();
  }, [transport, webUsbSupported]);

  // WebUSB: handle disconnect events.
  useEffect(() => {
    if (transport !== 'webusb' || !webUsbSupported) return;
    const onDisconnect = (ev: USBConnectionEvent) => {
      if (usbPrinter && ev.device === usbPrinter.device) {
        setUsbPrinter(null);
      }
    };
    navigator.usb.addEventListener('disconnect', onDisconnect);
    return () => navigator.usb.removeEventListener('disconnect', onDisconnect);
  }, [transport, webUsbSupported, usbPrinter]);

  const handleConnectUsb = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      const device = await requestPrinter();
      const opened = await openPrinter(device);
      setUsbPrinter(opened);
    } catch (err) {
      const e = err as Error;
      if (e?.name === 'NotFoundError') {
        // User cancelled — not really an error.
      } else if (e?.message?.includes('Access denied') || e?.name === 'SecurityError') {
        setError('Windows is using this printer. Install the desktop printer app to print to it from here.');
      } else {
        setError(e?.message || 'Failed to connect');
      }
    } finally {
      setConnecting(false);
    }
  }, []);

  const doPrint = useCallback(
    async (zpl: string | string[], kind: 'label' | 'calibration') => {
      setError(null);
      setPrinting(kind);
      try {
        if (template.thermalRenderMode === 'bitmap-v1') {
          for (const feed of Array.isArray(zpl) ? zpl : [zpl]) {
            if (new TextEncoder().encode(feed).length > 2 * 1024 * 1024) throw new Error('One feed exceeds the 2 MiB printer limit');
          }
          for (const feed of Array.isArray(zpl) ? zpl : [zpl]) {
            if (transport === 'dazzle') await printViaDazzle(feed, selectedDazzlePrinter ?? undefined);
            else { if (!usbPrinter) throw new Error('No printer connected'); await printZplWebUsb(usbPrinter, feed); }
          }
        } else if (transport === 'dazzle') {
          if (Array.isArray(zpl)) {
            await printAllViaDazzle(zpl, selectedDazzlePrinter ?? undefined);
          } else {
            await printViaDazzle(zpl, selectedDazzlePrinter ?? undefined);
          }
        } else {
          if (!usbPrinter) throw new Error('No printer connected');
          await printZplWebUsb(usbPrinter, Array.isArray(zpl) ? zpl.join('\n') : zpl);
        }
      } catch (err) {
        setError((err as Error)?.message || 'Print failed');
      } finally {
        setPrinting(null);
      }
    },
    [transport, selectedDazzlePrinter, usbPrinter, template.thermalRenderMode],
  );

  const buildLabelZpl = useCallback(async () => {
    const qty = Math.max(1, Math.min(9999, Math.floor(labelQty) || 1));
    const across = Math.max(1, format.labelsAcross || 1);
    if (template.thermalRenderMode === 'bitmap-v1') {
      if (!proofReady) throw new Error('Wait for the current bitmap proof before printing');
      const feeds: string[] = []; let bytes = 0;
      for (let first = 0; first < qty; first += across) {
        const feed = await generateZPLWithImages(template, format, Array.from({ length: across }, (_, lane) => first + lane < qty ? testData ?? {} : undefined));
        bytes += feed.length;
        if (bytes > 32 * 1024 * 1024) throw new Error('Test print exceeds 32 MiB. Reduce quantity.');
        feeds.push(feed);
      }
      return feeds;
    }
    const imageGraphics = await prepareZplImages(template, format);

    if (across <= 1) {
      return generateZPL(template, format, testData, { imageGraphics }).replace(/\^XZ\s*$/, `^PQ${qty},0,0,N,N\n^XZ`);
    }

    const labels: string[] = [];
    for (let printed = 0; printed < qty; printed += across) {
      const lanes = Array.from({ length: across }, (_, lane) => (
        printed + lane < qty ? testData : undefined
      ));
      labels.push(generateZPL(template, format, lanes, { imageGraphics }));
    }
    return labels;
  }, [format, labelQty, template, testData, proofReady]);

  const handlePrintLabel = useCallback(() => {
    return buildLabelZpl().then((zpl) => doPrint(zpl, 'label')).catch(err => setError(err instanceof Error ? err.message : 'Print failed'));
  }, [buildLabelZpl, doPrint]);

  const handlePrintCalibration = useCallback(() => {
    // Pass the full format so calibration lays out across every lane on
    // multi-across rolls (not just the middle).
    const zpl = calibrationZpl(format, {
      count: calibCount,
      style: 'crosshair',
      topOffset,
      leftShift,
      darkness,
      speed,
    });
    return doPrint(zpl, 'calibration');
  }, [doPrint, format, calibCount, topOffset, leftShift, darkness, speed]);

  const handleApplyAdjustments = useCallback(async (persist: boolean) => {
    setError(null);
    setPrinting('calibration');
    try {
      const zpl = printerAdjustmentsZpl({ topOffset, leftShift, darkness, speed, persist });
      if (transport === 'dazzle') {
        await printViaDazzle(zpl, selectedDazzlePrinter ?? undefined);
      } else if (usbPrinter) {
        await printZplWebUsb(usbPrinter, zpl);
      } else {
        throw new Error('No printer connected');
      }
    } catch (err) {
      setError((err as Error)?.message || 'Apply failed');
    } finally {
      setPrinting(null);
    }
  }, [transport, selectedDazzlePrinter, usbPrinter, topOffset, leftShift, darkness, speed]);

  const handleAutoCalibrate = useCallback(async () => {
    setError(null);
    setPrinting('calibration');
    try {
      const zpl = autoCalibrateZpl();
      if (transport === 'dazzle') {
        await printViaDazzle(zpl, selectedDazzlePrinter ?? undefined);
      } else if (usbPrinter) {
        await printZplWebUsb(usbPrinter, zpl);
      } else {
        throw new Error('No printer connected');
      }
    } catch (err) {
      setError((err as Error)?.message || 'Auto-calibrate failed');
    } finally {
      setPrinting(null);
    }
  }, [transport, selectedDazzlePrinter, usbPrinter]);

  const canPrint = proofReady && (transport === 'dazzle' ? !!selectedDazzlePrinter : !!usbPrinter);
  const connectedLabel = useMemo(() => {
    if (transport === 'dazzle') return selectedDazzlePrinter ?? 'No printer selected';
    return usbPrinter?.productName ?? '';
  }, [transport, selectedDazzlePrinter, usbPrinter]);

  // No way to print from this browser: say nothing here; the office printer
  // and the run page still work.
  if (!webUsbSupported && !dazzleAvailable) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Transport toggle — only show if both are available */}
      {webUsbSupported && dazzleAvailable && (
        <div className="segmented segmented-xs" role="group" aria-label="How to reach the printer">
          <SegmentedIndicator index={transport === 'webusb' ? 1 : 0} count={2} />
          <button
            onClick={() => setTransport('dazzle')}
            title="Print through the desktop printer app on this computer"
            aria-pressed={transport === 'dazzle'}
          >
            Printer app
          </button>
          <button
            onClick={() => setTransport('webusb')}
            title="Print straight to a USB printer from this browser, no app needed"
            aria-pressed={transport === 'webusb'}
          >
            WebUSB
          </button>
        </div>
      )}

      {/* Transport-specific connect / selection UI */}
      {transport === 'dazzle' ? (
        dazzleAvailable ? (
          dazzlePrinters.length > 0 ? (
            // Dazzle: printer dropdown
            <div className="relative">
              <button
                ref={dazzleTriggerRef}
                onClick={() => setDazzlePickerOpen((v) => !v)}
                aria-expanded={dazzlePickerOpen}
                className="btn btn-secondary btn-sm"
                title="Click to choose a printer"
              >
                <PrinterCheck className="size-4 text-emerald-400" aria-hidden="true" />
                <span className="max-w-[160px] truncate">{selectedDazzlePrinter ?? 'Select printer'}</span>
                <ChevronDown className="w-3 h-3" />
              </button>
              <PopLayer ref={dazzlePickerRef} open={dazzlePickerOpen} className="absolute top-full left-0 mt-1 min-w-[200px] rounded-lg bg-zinc-900 shadow-xl shadow-black/50 z-50 p-1 [--origin:top_left]">
                  {dazzlePrinters.map((p) => (
                    <button
                      key={p.name}
                      onClick={() => {
                        setSelectedDazzlePrinter(p.name);
                        setDazzlePickerOpen(false);
                      }}
                      className={`flex w-full min-h-control-sm items-center rounded-md text-left px-2.5 text-sm hover:bg-zinc-800 transition-colors ${selectedDazzlePrinter === p.name ? 'text-amber-300' : 'text-zinc-100'}`}
                    >
                      {p.name} {p.is_default && <span className="text-zinc-400">(default)</span>}
                    </button>
                  ))}
              </PopLayer>
            </div>
          ) : (
            <span className="text-xs text-zinc-400">No printers found</span>
          )
        ) : (
          <a
            href={DAZZLE_DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary btn-sm"
            title="Download the free desktop printer app"
          >
            <Download className="w-3.5 h-3.5" />
            Get the printer app
          </a>
        )
      ) : !webUsbSupported ? (
        <span className="text-xs text-zinc-400">This browser can’t print over USB</span>
      ) : !usbPrinter ? (
        <button
          onClick={handleConnectUsb}
          disabled={connecting}
          title="Connect a Zebra printer via USB"
          className="btn btn-secondary btn-sm"
        >
          {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />}
          {connecting ? 'Connecting…' : 'Connect printer'}
        </button>
      ) : (
        <div className="flex items-center gap-1.5 text-sm text-zinc-300">
          <PrinterCheck className="size-4 text-emerald-400" aria-hidden="true" />
          <span className="max-w-[140px] truncate" title={connectedLabel}>{connectedLabel}</span>
        </div>
      )}

      {/* Print + Calibrate buttons — only shown when we have a usable printer */}
      {canPrint && (
        <>
          <label className="flex items-center gap-1.5 text-sm text-zinc-400">
            Qty
            <input
              type="number"
              min={1}
              max={9999}
              step={1}
              value={labelQty}
              onChange={(e) => {
                const next = parseInt(e.target.value, 10);
                setLabelQty(Number.isFinite(next) ? Math.max(1, Math.min(9999, next)) : 1);
              }}
              className="field field-sm w-16 text-center"
            />
          </label>
          <button
            onClick={handlePrintLabel}
            disabled={!!printing}
            title={`Send ${labelQty} label${labelQty === 1 ? '' : 's'} to the printer`}
            className="btn btn-primary btn-sm"
          >
            {printing === 'label' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
            Print{labelQty > 1 && <span className="tabular-nums">×{labelQty}</span>}
          </button>
          {/* Calibrate button with adjacent options menu (style + copies). */}
          <div className="relative flex items-center gap-px">
            <button
              onClick={handlePrintCalibration}
              disabled={!!printing}
              title={`Print ${calibCount} calibration label${calibCount > 1 ? 's' : ''}`}
              className="btn btn-secondary btn-sm rounded-r-none"
            >
              {printing === 'calibration' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Target className="w-3.5 h-3.5" />}
              Calibrate {calibCount > 1 && <span className="text-zinc-400">×{calibCount}</span>}
            </button>
            <button
              ref={calibTriggerRef}
              onClick={() => setCalibMenuOpen((v) => !v)}
              aria-expanded={calibMenuOpen}
              aria-label="Calibration options"
              title="Calibration options"
              className="btn btn-secondary btn-sm btn-icon rounded-l-none text-zinc-300"
            >
              <ChevronDown className="size-4" />
            </button>
            {/* Anchored to the right edge of the trigger so it opens
                leftward and stays inside the window on narrow screens. */}
            <PopLayer ref={calibMenuRef} open={calibMenuOpen} className="absolute top-full mt-1 right-0 w-[300px] max-w-[calc(100vw-2rem)] rounded-lg bg-zinc-900 shadow-xl shadow-black/50 z-50 p-3 space-y-4 [--origin:top_right]">
                <div>
                  <div className="section-title mb-1.5">Copies</div>
                  <div className="segmented segmented-xs" role="group" aria-label="Calibration copies">
                    <SegmentedIndicator index={[1, 3, 5, 10].indexOf(calibCount)} count={4} />
                    {[1, 3, 5, 10].map((n) => (
                      <button
                        key={n}
                        onClick={() => setCalibCount(n)}
                        aria-pressed={calibCount === n}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-zinc-400 mt-1.5">Print 3 or more to see if labels creep</p>
                </div>

                {/* Printer adjustments */}
                <div className="space-y-2">
                  <div className="section-title">Printer adjustments</div>

                  <NumberRow
                    label="Top offset"
                    value={topOffset}
                    onChange={setTopOffset}
                    min={-120} max={120} step={1}
                    unit="dots"
                    hint="+ moves it down"
                  />
                  <NumberRow
                    label="Left shift"
                    value={leftShift}
                    onChange={setLeftShift}
                    min={-200} max={200} step={1}
                    unit="dots"
                    hint="+ moves it right"
                  />
                  <NumberRow
                    label="Darkness"
                    value={darkness}
                    onChange={setDarkness}
                    min={0} max={30} step={1}
                    unit="of 30"
                  />
                  <NumberRow
                    label="Speed"
                    value={speed}
                    onChange={setSpeed}
                    min={1} max={14} step={1}
                    unit="in/s"
                  />

                  <div className="flex gap-1 pt-1">
                    <button
                      onClick={() => handleApplyAdjustments(false)}
                      disabled={!canPrint || !!printing}
                      className="btn btn-secondary btn-sm flex-1"
                      title="Sends these values now, until the printer is turned off"
                    >
                      Apply
                    </button>
                    <button
                      onClick={() => handleApplyAdjustments(true)}
                      disabled={!canPrint || !!printing}
                      className="btn btn-primary btn-sm flex-1"
                      title="Sends these values and keeps them after the printer is turned off"
                    >
                      Apply and keep
                    </button>
                  </div>
                  <button
                    onClick={handleAutoCalibrate}
                    disabled={!canPrint || !!printing}
                    className="btn btn-secondary btn-sm w-full"
                    title="The printer feeds a few labels to find the gaps between them"
                  >
                    Measure the label roll again
                  </button>
                </div>
            </PopLayer>
          </div>
        </>
      )}

      {error && (
        <span className="text-xs text-red-400 max-w-[320px] truncate" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}

/** Compact number input row for printer adjustments. */
function NumberRow({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      {/* The hint sits under its label, so it never wraps into a narrow column. */}
      <label htmlFor={id} className="w-24 shrink-0 text-sm text-zinc-400">{label}{hint && <span className="block text-xs text-zinc-500">{hint}</span>}</label>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          aria-label={`Less ${label.toLowerCase()}`}
          onClick={() => onChange(Math.max(min ?? -Infinity, value - (step ?? 1)))}
          className="btn btn-secondary btn-icon btn-sm"
        >
          −
        </button>
        <input
          id={id}
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(v);
          }}
          className="field field-sm w-14 text-center"
        />
        <button
          type="button"
          aria-label={`More ${label.toLowerCase()}`}
          onClick={() => onChange(Math.min(max ?? Infinity, value + (step ?? 1)))}
          className="btn btn-secondary btn-icon btn-sm"
        >
          +
        </button>
      </div>
      {unit && <span className="text-xs text-zinc-400">{unit}</span>}
    </div>
  );
}
