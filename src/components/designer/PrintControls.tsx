'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Printer, PrinterCheck, Plug, Target, Loader2, AlertCircle, Download, ChevronDown } from 'lucide-react';
import type { LabelFormat, LabelTemplate } from '@/lib/types';
import { generateZPL } from '@/lib/zplGenerator';
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
  DAZZLE_DOWNLOAD_URL,
  type DazzlePrinter,
} from '@/lib/dazzlePrinter';

interface PrintControlsProps {
  format: LabelFormat;
  template: LabelTemplate;
  testData?: Record<string, string>;
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
export function PrintControls({ format, template, testData }: PrintControlsProps) {
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
  // Calibration print options — persisted for convenience.
  const [calibCount, setCalibCount] = useState<number>(1);
  const [calibMenuOpen, setCalibMenuOpen] = useState(false);
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
      } catch (err) {
        // Soft-fail \u2014 could be access-denied on Windows; user will see it when they try.
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
        // User cancelled \u2014 not really an error.
      } else if (e?.message?.includes('Access denied') || e?.name === 'SecurityError') {
        setError('Windows has the printer claimed. Install Dazzle to print without a driver swap.');
      } else {
        setError(e?.message || 'Failed to connect');
      }
    } finally {
      setConnecting(false);
    }
  }, []);

  const doPrint = useCallback(
    async (zpl: string, kind: 'label' | 'calibration') => {
      setError(null);
      setPrinting(kind);
      try {
        if (transport === 'dazzle') {
          await printViaDazzle(zpl, selectedDazzlePrinter ?? undefined);
        } else {
          if (!usbPrinter) throw new Error('No printer connected');
          await printZplWebUsb(usbPrinter, zpl);
        }
      } catch (err) {
        setError((err as Error)?.message || 'Print failed');
      } finally {
        setPrinting(null);
      }
    },
    [transport, selectedDazzlePrinter, usbPrinter],
  );

  const handlePrintLabel = useCallback(() => {
    const zpl = generateZPL(template, format, testData);
    return doPrint(zpl, 'label');
  }, [doPrint, template, format, testData]);

  const handlePrintCalibration = useCallback(() => {
    const zpl = calibrationZpl(format.width, format.height, format.dpi || 203, {
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

  const canPrint = transport === 'dazzle' ? !!selectedDazzlePrinter : !!usbPrinter;
  const connectedLabel = useMemo(() => {
    if (transport === 'dazzle') return selectedDazzlePrinter ?? 'No printer selected';
    return usbPrinter?.productName ?? '';
  }, [transport, selectedDazzlePrinter, usbPrinter]);

  if (!webUsbSupported && !dazzleAvailable) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-zinc-500" title="Need Chromium browser or Dazzle desktop app">
        <AlertCircle className="w-3.5 h-3.5" />
        <span>Printing needs Chrome/Edge or Dazzle</span>
        <a href={DAZZLE_DOWNLOAD_URL} target="_blank" rel="noreferrer" className="text-amber-400 hover:underline inline-flex items-center gap-1">
          <Download className="w-3 h-3" /> Dazzle
        </a>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Transport toggle \u2014 only show if both are available */}
      {webUsbSupported && dazzleAvailable && (
        <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-zinc-900 border border-zinc-800">
          <button
            onClick={() => setTransport('dazzle')}
            title="Use Dazzle (local desktop app) \u2014 works even when Windows owns the printer"
            className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${transport === 'dazzle' ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Dazzle
          </button>
          <button
            onClick={() => setTransport('webusb')}
            title="Use WebUSB (direct browser\u2192USB, no app needed, fails on Windows without driver swap)"
            className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${transport === 'webusb' ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}
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
                onClick={() => setDazzlePickerOpen((v) => !v)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/15 transition-colors"
                title="Click to choose a printer"
              >
                <PrinterCheck className="w-3.5 h-3.5" />
                <span className="max-w-[160px] truncate">{selectedDazzlePrinter ?? 'Select printer'}</span>
                <ChevronDown className="w-3 h-3" />
              </button>
              {dazzlePickerOpen && (
                <div className="absolute top-full left-0 mt-1 min-w-[200px] rounded-md bg-zinc-900 border border-zinc-800 shadow-xl z-50 py-1">
                  {dazzlePrinters.map((p) => (
                    <button
                      key={p.name}
                      onClick={() => {
                        setSelectedDazzlePrinter(p.name);
                        setDazzlePickerOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-800 transition-colors ${selectedDazzlePrinter === p.name ? 'text-amber-400' : 'text-zinc-300'}`}
                    >
                      {p.name} {p.is_default && <span className="text-zinc-600">(default)</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span className="text-xs text-zinc-500">No printers found in Dazzle</span>
          )
        ) : (
          <a
            href={DAZZLE_DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-amber-400 hover:text-amber-300 border border-amber-500/30 bg-amber-500/5 transition-colors"
            title="Download and install the Dazzle desktop app"
          >
            <Download className="w-3.5 h-3.5" />
            Install Dazzle
          </a>
        )
      ) : !webUsbSupported ? (
        <span className="text-xs text-zinc-500">WebUSB not supported</span>
      ) : !usbPrinter ? (
        <button
          onClick={handleConnectUsb}
          disabled={connecting}
          title="Connect a Zebra printer via USB"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-zinc-400 hover:text-amber-400 hover:bg-amber-500/5 border border-zinc-800 hover:border-amber-500/30 transition-colors disabled:opacity-50"
        >
          {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />}
          {connecting ? 'Connecting\u2026' : 'Connect printer'}
        </button>
      ) : (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
          <PrinterCheck className="w-3.5 h-3.5" />
          <span className="max-w-[140px] truncate" title={connectedLabel}>{connectedLabel}</span>
        </div>
      )}

      {/* Print + Calibrate buttons \u2014 only shown when we have a usable printer */}
      {canPrint && (
        <>
          <button
            onClick={handlePrintLabel}
            disabled={!!printing}
            title="Send current template to the printer"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-white bg-amber-600 hover:bg-amber-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {printing === 'label' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
            Print
          </button>
          {/* Calibrate button with adjacent options menu (style + copies). */}
          <div className="relative flex items-center rounded-md border border-zinc-800">
            <button
              onClick={handlePrintCalibration}
              disabled={!!printing}
              title={`Print ${calibCount} calibration label${calibCount > 1 ? 's' : ''}`}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:text-amber-400 hover:bg-amber-500/5 transition-colors disabled:opacity-50"
            >
              {printing === 'calibration' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Target className="w-3.5 h-3.5" />}
              Calibrate {calibCount > 1 && <span className="text-zinc-500">×{calibCount}</span>}
            </button>
            <button
              onClick={() => setCalibMenuOpen((v) => !v)}
              title="Calibration options"
              className="px-1 py-1.5 text-xs text-zinc-500 hover:text-amber-400 hover:bg-amber-500/5 transition-colors border-l border-zinc-800"
            >
              <ChevronDown className="w-3 h-3" />
            </button>
            {calibMenuOpen && (
              <div className="absolute top-full mt-1 right-auto min-w-[280px] rounded-md bg-zinc-900 border border-zinc-800 shadow-xl z-50 p-3 space-y-3">
                <div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1.5">Copies</div>
                  <div className="flex gap-0.5">
                    {[1, 3, 5, 10].map((n) => (
                      <button
                        key={n}
                        onClick={() => setCalibCount(n)}
                        className={`flex-1 py-1.5 rounded text-[11px] font-medium transition-colors ${calibCount === n ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800/50 text-zinc-400 hover:text-zinc-200'}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-1.5">3+ copies help detect feed drift between labels</p>
                </div>

                {/* Printer adjustments */}
                <div className="border-t border-zinc-800 pt-3 space-y-2">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Printer Adjustments</div>

                  <NumberRow
                    label="Top offset"
                    value={topOffset}
                    onChange={setTopOffset}
                    min={-120} max={120} step={1}
                    unit="dots"
                    hint="+ down / − up"
                  />
                  <NumberRow
                    label="Left shift"
                    value={leftShift}
                    onChange={setLeftShift}
                    min={-200} max={200} step={1}
                    unit="dots"
                    hint="+ right / − left"
                  />
                  <NumberRow
                    label="Darkness"
                    value={darkness}
                    onChange={setDarkness}
                    min={0} max={30} step={1}
                    unit=""
                    hint="0–30"
                  />
                  <NumberRow
                    label="Speed"
                    value={speed}
                    onChange={setSpeed}
                    min={1} max={14} step={1}
                    unit="ips"
                    hint="in/sec"
                  />

                  <div className="flex gap-1 pt-1">
                    <button
                      onClick={() => handleApplyAdjustments(false)}
                      disabled={!canPrint || !!printing}
                      className="flex-1 py-1.5 rounded text-[11px] font-medium bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-40"
                      title="Send current values to the printer now (temporary, resets on power cycle)"
                    >
                      Apply
                    </button>
                    <button
                      onClick={() => handleApplyAdjustments(true)}
                      disabled={!canPrint || !!printing}
                      className="flex-1 py-1.5 rounded text-[11px] font-medium bg-amber-600 text-white hover:bg-amber-500 transition-colors disabled:opacity-40"
                      title="Send values + save persistently (~^JUS stores in printer memory)"
                    >
                      Apply & Save
                    </button>
                  </div>
                  <button
                    onClick={handleAutoCalibrate}
                    disabled={!canPrint || !!printing}
                    className="w-full py-1.5 rounded text-[11px] font-medium bg-zinc-800/60 text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-40"
                    title="Send ~JC to have the printer re-sense media gaps/length"
                  >
                    Auto-calibrate media (~JC)
                  </button>
                </div>
              </div>
            )}
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
  return (
    <div className="flex items-center gap-2">
      <label className="text-[11px] text-zinc-400 w-20 shrink-0">{label}</label>
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => onChange(Math.max(min ?? -Infinity, value - (step ?? 1)))}
          className="w-6 h-6 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs flex items-center justify-center"
        >
          −
        </button>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(v);
          }}
          className="w-14 h-6 rounded bg-zinc-950 border border-zinc-800 text-zinc-100 text-[11px] text-center focus:outline-none focus:border-amber-500/40"
        />
        <button
          onClick={() => onChange(Math.min(max ?? Infinity, value + (step ?? 1)))}
          className="w-6 h-6 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs flex items-center justify-center"
        >
          +
        </button>
      </div>
      {unit && <span className="text-[10px] text-zinc-500">{unit}</span>}
      {hint && <span className="text-[10px] text-zinc-600 ml-auto">{hint}</span>}
    </div>
  );
}
