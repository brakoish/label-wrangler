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
    const zpl = calibrationZpl(format.width, format.height, format.dpi || 203);
    return doPrint(zpl, 'calibration');
  }, [doPrint, format]);

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
          <button
            onClick={handlePrintCalibration}
            disabled={!!printing}
            title="Print an alignment/calibration label"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-zinc-300 hover:text-amber-400 hover:bg-amber-500/5 border border-zinc-800 hover:border-amber-500/30 transition-colors disabled:opacity-50"
          >
            {printing === 'calibration' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Target className="w-3.5 h-3.5" />}
            Calibrate
          </button>
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
