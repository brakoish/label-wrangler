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
 * Options for the calibration label generator.
 */
export interface CalibrationOptions {
  /** How many consecutive labels to print. Helps detect feed/registration
   *  drift between labels. Default 1. */
  count?: number;
  /** Style of calibration print:
   *  - 'crosshair': 4 corner + center crosshairs + 4-edge ruler (default, best
   *    for verifying label bounds and print offset).
   *  - 'grid': full dot grid every 0.25" + ruler labels at each inch
   *    (best for measuring exact offset in mm). */
  style?: 'crosshair' | 'grid';
}

/**
 * Generate a calibration label for a given format (width/height in inches, dpi).
 * Renders alignment marks and a ruler so the user can verify media alignment,
 * print offset, and feed consistency before running production labels.
 *
 * Supports printing multiple consecutive copies (^PQ) to detect drift.
 */
export function calibrationZpl(
  widthIn: number,
  heightIn: number,
  dpi = 203,
  options: CalibrationOptions = {},
): string {
  const { count = 1, style = 'crosshair' } = options;
  const w = Math.round(widthIn * dpi);
  const h = Math.round(heightIn * dpi);

  const lines: string[] = ['^XA', `^PW${w}`, `^LL${h}`];

  if (style === 'grid') {
    appendGridCalibration(lines, w, h, dpi, widthIn, heightIn);
  } else {
    appendCrosshairCalibration(lines, w, h, dpi, widthIn, heightIn);
  }

  // ^PQ sets print quantity: n, 0, 0, N, N (n copies, no pause, no replicate).
  // Using ^PQ keeps it efficient — the printer handles feeding between labels.
  if (count > 1) {
    lines.push(`^PQ${count},0,0,N,N`);
  }
  lines.push('^XZ');
  return lines.join('\n');
}

/** Crosshairs at 4 corners + center + 4-edge ruler ticks. */
function appendCrosshairCalibration(
  lines: string[],
  w: number,
  h: number,
  dpi: number,
  widthIn: number,
  heightIn: number,
): void {
  // Slightly smaller crosses so they don't get clipped at label edges.
  const cross = Math.min(w, h) * 0.08;
  const thick = Math.max(2, Math.round(dpi / 60));

  // Corner crosshairs: inset 4 dots from the edge so they fully print even
  // with small feed misalignment.
  const inset = 4;
  const corners = [
    { x: inset, y: inset },
    { x: w - cross - inset, y: inset },
    { x: inset, y: h - cross - inset },
    { x: w - cross - inset, y: h - cross - inset },
  ];
  for (const c of corners) {
    // Horizontal bar
    lines.push(`^FO${Math.round(c.x)},${Math.round(c.y + cross / 2 - thick / 2)}^GB${Math.round(cross)},${thick},${thick}^FS`);
    // Vertical bar
    lines.push(`^FO${Math.round(c.x + cross / 2 - thick / 2)},${Math.round(c.y)}^GB${thick},${Math.round(cross)},${thick}^FS`);
  }

  // Center crosshair
  lines.push(`^FO${Math.round(w / 2 - cross / 2)},${Math.round(h / 2 - thick / 2)}^GB${Math.round(cross)},${thick},${thick}^FS`);
  lines.push(`^FO${Math.round(w / 2 - thick / 2)},${Math.round(h / 2 - cross / 2)}^GB${thick},${Math.round(cross)},${thick}^FS`);

  // Dimensions label below center cross
  const fh = Math.max(20, Math.round(dpi / 10));
  const dimText = `${widthIn}" x ${heightIn}"`;
  const dimW = dimText.length * fh * 0.6;
  lines.push(`^FO${Math.round(w / 2 - dimW / 2)},${Math.round(h / 2 + cross)}^A0N,${fh},${Math.round(fh * 0.6)}^FD${dimText}^FS`);

  // Ruler ticks on all 4 edges, every 0.25".
  // Ticks are inset 2 dots from the edge to avoid clipping.
  const tickSpacing = Math.round(dpi * 0.25);
  const tickShort = Math.max(8, Math.round(dpi / 25));
  const tickLong = Math.max(16, Math.round(dpi / 12));
  const tickThick = Math.max(2, Math.round(dpi / 100));
  const edge = 2;

  for (let x = tickSpacing; x < w; x += tickSpacing) {
    const isInch = Math.abs(x - Math.round(x / dpi) * dpi) < 2;
    const len = isInch ? tickLong : tickShort;
    // Top edge
    lines.push(`^FO${x},${edge}^GB${tickThick},${len},${tickThick}^FS`);
    // Bottom edge
    lines.push(`^FO${x},${h - edge - len}^GB${tickThick},${len},${tickThick}^FS`);
  }
  for (let y = tickSpacing; y < h; y += tickSpacing) {
    const isInch = Math.abs(y - Math.round(y / dpi) * dpi) < 2;
    const len = isInch ? tickLong : tickShort;
    // Left edge
    lines.push(`^FO${edge},${y}^GB${len},${tickThick},${tickThick}^FS`);
    // Right edge
    lines.push(`^FO${w - edge - len},${y}^GB${len},${tickThick},${tickThick}^FS`);
  }

  // Inch labels at 1", 2", etc. along the top edge
  const labelFh = Math.max(14, Math.round(dpi / 18));
  for (let i = 1; i < Math.floor(widthIn); i++) {
    const x = i * dpi;
    lines.push(`^FO${x - labelFh},${tickLong + 4}^A0N,${labelFh},${Math.round(labelFh * 0.6)}^FD${i}"^FS`);
  }
}

/** Full 0.25" grid of dots + inch labels. Great for measuring exact offsets. */
function appendGridCalibration(
  lines: string[],
  w: number,
  h: number,
  dpi: number,
  widthIn: number,
  heightIn: number,
): void {
  const step = Math.round(dpi * 0.25);
  const dotSize = Math.max(3, Math.round(dpi / 60));

  for (let x = 0; x <= w; x += step) {
    for (let y = 0; y <= h; y += step) {
      const isInchX = Math.abs(x - Math.round(x / dpi) * dpi) < 2;
      const isInchY = Math.abs(y - Math.round(y / dpi) * dpi) < 2;
      const isMajor = isInchX && isInchY;
      const size = isMajor ? dotSize * 2 : dotSize;
      const cx = Math.max(0, x - Math.floor(size / 2));
      const cy = Math.max(0, y - Math.floor(size / 2));
      lines.push(`^FO${cx},${cy}^GB${size},${size},${size}^FS`);
    }
  }

  // Dimensions label center-bottom
  const fh = Math.max(18, Math.round(dpi / 12));
  const dimText = `${widthIn}" x ${heightIn}" GRID 0.25"`;
  const dimW = dimText.length * fh * 0.6;
  const bandH = Math.round(fh * 1.5);
  // White background band so text is readable over grid
  lines.push(`^FO${Math.round(w / 2 - dimW / 2 - 8)},${h - bandH - 4}^GB${Math.round(dimW + 16)},${bandH},${bandH},W^FS`);
  lines.push(`^FO${Math.round(w / 2 - dimW / 2)},${h - bandH + 2}^A0N,${fh},${Math.round(fh * 0.6)}^FD${dimText}^FS`);
}
