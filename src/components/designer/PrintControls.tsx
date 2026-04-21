'use client';

import { useState, useEffect, useCallback } from 'react';
import { Printer, PrinterCheck, Plug, Target, Loader2, AlertCircle } from 'lucide-react';
import type { LabelFormat, LabelTemplate } from '@/lib/types';
import { generateZPL } from '@/lib/zplGenerator';
import {
  isWebUsbSupported,
  getAuthorizedPrinters,
  requestPrinter,
  openPrinter,
  printZpl,
  calibrationZpl,
  type ConnectedPrinter,
} from '@/lib/webusbPrinter';

interface PrintControlsProps {
  format: LabelFormat;
  template: LabelTemplate;
  testData?: Record<string, string>;
}

/**
 * WebUSB-based test print controls for thermal labels.
 * Renders as a compact button row; shows connect prompt when no printer is
 * authorized, printer name + actions when one is connected.
 */
export function PrintControls({ format, template, testData }: PrintControlsProps) {
  const [printer, setPrinter] = useState<ConnectedPrinter | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [printing, setPrinting] = useState<null | 'label' | 'calibration'>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = typeof window !== 'undefined' && isWebUsbSupported();

  // On mount: try to auto-reconnect to a previously-authorized printer.
  // Browser remembers USB permissions per-origin so this is silent.
  useEffect(() => {
    if (!supported) return;
    (async () => {
      try {
        const authorized = await getAuthorizedPrinters();
        if (authorized.length > 0) {
          const opened = await openPrinter(authorized[0]);
          setPrinter(opened);
        }
      } catch (err) {
        // Not a hard error \u2014 user may need to re-authorize.
        console.warn('Auto-connect failed', err);
      }
    })();
  }, [supported]);

  // Listen for disconnect events so the UI updates if the printer is unplugged.
  useEffect(() => {
    if (!supported) return;
    const onDisconnect = (ev: USBConnectionEvent) => {
      if (printer && ev.device === printer.device) {
        setPrinter(null);
      }
    };
    navigator.usb.addEventListener('disconnect', onDisconnect);
    return () => navigator.usb.removeEventListener('disconnect', onDisconnect);
  }, [supported, printer]);

  const handleConnect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      const device = await requestPrinter();
      const opened = await openPrinter(device);
      setPrinter(opened);
    } catch (err) {
      if ((err as Error)?.name === 'NotFoundError') {
        // User cancelled the picker \u2014 not really an error.
      } else {
        setError((err as Error)?.message || 'Failed to connect');
      }
    } finally {
      setConnecting(false);
    }
  }, []);

  const handlePrintLabel = useCallback(async () => {
    if (!printer) return;
    setError(null);
    setPrinting('label');
    try {
      const zpl = generateZPL(template, format, testData);
      await printZpl(printer, zpl);
    } catch (err) {
      setError((err as Error)?.message || 'Print failed');
    } finally {
      setPrinting(null);
    }
  }, [printer, template, format, testData]);

  const handlePrintCalibration = useCallback(async () => {
    if (!printer) return;
    setError(null);
    setPrinting('calibration');
    try {
      const zpl = calibrationZpl(format.width, format.height, format.dpi || 203);
      await printZpl(printer, zpl);
    } catch (err) {
      setError((err as Error)?.message || 'Print failed');
    } finally {
      setPrinting(null);
    }
  }, [printer, format]);

  if (!supported) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-zinc-500" title="WebUSB requires Chrome, Edge, or Opera">
        <AlertCircle className="w-3.5 h-3.5" />
        Printing requires Chromium browser
      </div>
    );
  }

  if (!printer) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={handleConnect}
          disabled={connecting}
          title="Connect a Zebra printer via USB"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-zinc-400 hover:text-amber-400 hover:bg-amber-500/5 border border-zinc-800 hover:border-amber-500/30 transition-colors disabled:opacity-50"
        >
          {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />}
          {connecting ? 'Connecting\u2026' : 'Connect printer'}
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
        <PrinterCheck className="w-3.5 h-3.5" />
        <span className="max-w-[140px] truncate" title={printer.productName}>{printer.productName}</span>
      </div>
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
      {error && <span className="text-xs text-red-400 max-w-[200px] truncate" title={error}>{error}</span>}
    </div>
  );
}
