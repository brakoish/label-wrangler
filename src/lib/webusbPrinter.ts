/**
 * WebUSB driver for Zebra thermal printers.
 *
 * Sends raw ZPL directly to a USB-connected Zebra printer from the browser.
 * No drivers, no installs, no middleware — just the WebUSB API.
 *
 * Platform notes:
 * - Chrome/Edge/Opera only (navigator.usb). No Safari/Firefox/iOS.
 * - HTTPS only (Vercel satisfies this). localhost also works for dev.
 * - Windows: on first connect the printer's driver may need to be switched
 *   from `usbprint.sys` to `winusb.sys` (via Zadig). This disables OS-level
 *   printing (Word, etc.) for that device \u2014 tradeoff for browser direct.
 * - macOS: typically works without fuss.
 * - Linux: needs a udev rule for the Zebra vendor id.
 *
 * Permissions persist per-origin once granted \u2014 navigator.usb.getDevices()
 * returns previously-authorized devices without re-prompting.
 */

// Zebra Technologies USB vendor id. Covers the full Zebra line (ZD/ZT/GX/etc.).
export const ZEBRA_VENDOR_ID = 0x0a5f;

export type ConnectedPrinter = {
  device: USBDevice;
  productName: string;
  endpointOut: number;
};

/** Check whether the current browser supports WebUSB at all. */
export function isWebUsbSupported(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
}

/** List previously-authorized Zebra printers without prompting the user. */
export async function getAuthorizedPrinters(): Promise<USBDevice[]> {
  if (!isWebUsbSupported()) return [];
  const devices = await navigator.usb.getDevices();
  return devices.filter((d) => d.vendorId === ZEBRA_VENDOR_ID);
}

/**
 * Show the browser's USB device picker and let the user authorize a Zebra printer.
 * Throws if the user cancels or no compatible device is attached.
 */
export async function requestPrinter(): Promise<USBDevice> {
  if (!isWebUsbSupported()) {
    throw new Error('WebUSB is not supported in this browser. Use Chrome, Edge, or Opera.');
  }
  // Filter to Zebra vendor id so the picker is clean.
  const device = await navigator.usb.requestDevice({
    filters: [{ vendorId: ZEBRA_VENDOR_ID }],
  });
  return device;
}

/**
 * Open a Zebra printer device and claim its interface. Finds the bulk OUT
 * endpoint automatically (interface 0, but endpoint number varies by model).
 */
export async function openPrinter(device: USBDevice): Promise<ConnectedPrinter> {
  if (!device.opened) {
    await device.open();
  }
  if (device.configuration === null) {
    await device.selectConfiguration(1);
  }

  // Claim interface 0 (standard for Zebra printers).
  const iface = device.configuration?.interfaces[0];
  if (!iface) {
    throw new Error('Printer has no usable interface.');
  }

  if (!iface.claimed) {
    await device.claimInterface(iface.interfaceNumber);
  }

  // Find the bulk OUT endpoint. Fallback to endpoint 1 if detection fails.
  const alt = iface.alternates[0];
  const bulkOut = alt?.endpoints.find(
    (e) => e.direction === 'out' && e.type === 'bulk',
  );
  const endpointOut = bulkOut?.endpointNumber ?? 1;

  return {
    device,
    productName: device.productName || 'Zebra Printer',
    endpointOut,
  };
}

/** Send a raw ZPL string to an opened printer. */
export async function printZpl(
  printer: ConnectedPrinter,
  zpl: string,
): Promise<void> {
  const data = new TextEncoder().encode(zpl);
  const result = await printer.device.transferOut(printer.endpointOut, data);
  if (result.status !== 'ok') {
    throw new Error(`Transfer failed: ${result.status}`);
  }
}

/** Release and close the printer device. Safe to call on already-closed devices. */
export async function closePrinter(printer: ConnectedPrinter): Promise<void> {
  try {
    const iface = printer.device.configuration?.interfaces[0];
    if (iface?.claimed && iface) {
      await printer.device.releaseInterface(iface.interfaceNumber);
    }
    if (printer.device.opened) {
      await printer.device.close();
    }
  } catch {
    // Ignore close errors \u2014 device may already be gone.
  }
}

/**
 * Generate a calibration label for a given format (width/height in inches, dpi).
 * Renders corner crosshairs, a ruler grid, and the dimensions so the user can
 * verify media alignment and rollers before running production labels.
 */
export function calibrationZpl(widthIn: number, heightIn: number, dpi = 203): string {
  const w = Math.round(widthIn * dpi);
  const h = Math.round(heightIn * dpi);
  const cross = Math.min(w, h) * 0.1; // 10% of smallest dim

  const lines: string[] = ['^XA', `^PW${w}`, `^LL${h}`];

  // Corner crosshairs (4 per corner, thickness 3 dots)
  const corners = [
    { x: 0, y: 0 },
    { x: w - cross, y: 0 },
    { x: 0, y: h - cross },
    { x: w - cross, y: h - cross },
  ];
  for (const c of corners) {
    // Horizontal bar
    lines.push(`^FO${Math.round(c.x)},${Math.round(c.y + cross / 2 - 1)}^GB${Math.round(cross)},3,3^FS`);
    // Vertical bar
    lines.push(`^FO${Math.round(c.x + cross / 2 - 1)},${Math.round(c.y)}^GB3,${Math.round(cross)},3^FS`);
  }

  // Center crosshair
  lines.push(`^FO${Math.round(w / 2 - cross / 2)},${Math.round(h / 2 - 1)}^GB${Math.round(cross)},3,3^FS`);
  lines.push(`^FO${Math.round(w / 2 - 1)},${Math.round(h / 2 - cross / 2)}^GB3,${Math.round(cross)},3^FS`);

  // Dimensions label (top-center)
  const fh = Math.max(20, Math.round(dpi / 10));
  lines.push(`^FO${Math.round(w / 2 - 80)},${Math.round(h / 2 + cross)}^A0N,${fh},${Math.round(fh * 0.6)}^FD${widthIn}" x ${heightIn}"^FS`);

  // Ruler ticks along top edge (every 0.25")
  const tickSpacing = Math.round(dpi * 0.25);
  for (let x = tickSpacing; x < w; x += tickSpacing) {
    const isInch = x % dpi === 0;
    lines.push(`^FO${x},0^GB2,${isInch ? 20 : 10},2^FS`);
  }
  // Ruler ticks along left edge
  for (let y = tickSpacing; y < h; y += tickSpacing) {
    const isInch = y % dpi === 0;
    lines.push(`^FO0,${y}^GB${isInch ? 20 : 10},2,2^FS`);
  }

  lines.push('^XZ');
  return lines.join('\n');
}
