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
 *   printing (Word, etc.) for that device — tradeoff for browser direct.
 * - macOS: typically works without fuss.
 * - Linux: needs a udev rule for the Zebra vendor id.
 *
 * Permissions persist per-origin once granted — navigator.usb.getDevices()
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
    // Ignore close errors — device may already be gone.
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
  /** ZPL ^LT: label top offset in dots, -120…120. Positive = shift down,
   *  negative = shift up. Use to correct printed content sitting too high/low. */
  topOffset?: number;
  /** ZPL ^LS: label left shift in dots, -9999…9999. Positive = shift right. */
  leftShift?: number;
  /** ZPL ~SD: darkness 0–30. Higher = darker/blacker print. */
  darkness?: number;
  /** ZPL ^PR: print speed in inches per second (1–14 depending on printer). */
  speed?: number;
  /** If true, append ^JUS to persist the settings across printer reboots. */
  persist?: boolean;
}

/**
 * Send printer-level calibration adjustments without printing a label.
 * Useful to dial in settings (darkness, offset, shift, speed) and optionally
 * persist them across reboots.
 */
export function printerAdjustmentsZpl(opts: {
  topOffset?: number;
  leftShift?: number;
  darkness?: number;
  speed?: number;
  persist?: boolean;
}): string {
  const lines: string[] = ['^XA'];
  if (typeof opts.topOffset === 'number') lines.push(`^LT${Math.round(opts.topOffset)}`);
  if (typeof opts.leftShift === 'number') lines.push(`^LS${Math.round(opts.leftShift)}`);
  if (typeof opts.darkness === 'number') lines.push(`~SD${Math.round(Math.max(0, Math.min(30, opts.darkness)))}`);
  if (typeof opts.speed === 'number') lines.push(`^PR${Math.round(Math.max(1, Math.min(14, opts.speed)))}`);
  if (opts.persist) lines.push('^JUS');
  lines.push('^XZ');
  return lines.join('\n');
}

/** Send a ~JC command to trigger the printer's auto-calibration (media length sense). */
export function autoCalibrateZpl(): string {
  return '~JC';
}

/**
 * Generate a calibration label for a given format. Renders alignment marks
 * and a ruler so the user can verify media alignment, print offset, and
 * feed consistency before running production labels.
 *
 * Multi-across aware: if `across > 1`, the print width covers the full
 * liner width and calibration marks are drawn on every lane, so you can
 * see whether lane 0 and lane 2 are both aligned — not just the middle.
 *
 * Supports printing multiple consecutive copies (^PQ) to detect drift.
 *
 * Signature note: we also accept the legacy positional signature
 * `calibrationZpl(width, height, dpi, options)` for backward compatibility.
 */
export interface CalibrationFormat {
  width: number;
  height: number;
  dpi?: number;
  labelsAcross?: number;
  horizontalGapThermal?: number;
  sideMarginThermal?: number;
  linerWidth?: number;
}

export function calibrationZpl(
  formatOrWidth: CalibrationFormat | number,
  heightOrOptions?: number | CalibrationOptions,
  dpiArg?: number,
  optionsArg?: CalibrationOptions,
): string {
  // Normalize the two call shapes into a CalibrationFormat + options object.
  let fmt: CalibrationFormat;
  let options: CalibrationOptions;
  if (typeof formatOrWidth === 'number') {
    fmt = {
      width: formatOrWidth,
      height: (heightOrOptions as number) ?? formatOrWidth,
      dpi: dpiArg ?? 203,
    };
    options = optionsArg ?? {};
  } else {
    fmt = formatOrWidth;
    options = (heightOrOptions as CalibrationOptions) ?? {};
  }

  const { count = 1, style = 'crosshair', topOffset, leftShift, darkness, speed, persist } = options;
  const dpi = fmt.dpi || 203;
  const labelW = Math.round(fmt.width * dpi);
  const h = Math.round(fmt.height * dpi);
  const across = Math.max(1, fmt.labelsAcross || 1);
  const gap = Math.round((fmt.horizontalGapThermal || 0) * dpi);
  const sideM = Math.round((fmt.sideMarginThermal || 0) * dpi);
  const computedLiner = sideM * 2 + across * labelW + (across - 1) * gap;
  const linerW = fmt.linerWidth ? Math.round(fmt.linerWidth * dpi) : computedLiner;
  const effectiveSideM = (fmt.sideMarginThermal && fmt.sideMarginThermal > 0)
    ? sideM
    : Math.max(0, Math.round((linerW - (across * labelW + (across - 1) * gap)) / 2));

  const lines: string[] = ['^XA', `^PW${linerW}`, `^LL${h}`];

  // Pre-label printer adjustments so the calibration print uses them.
  if (typeof topOffset === 'number') lines.push(`^LT${Math.round(topOffset)}`);
  if (typeof leftShift === 'number') lines.push(`^LS${Math.round(leftShift)}`);
  if (typeof darkness === 'number') lines.push(`~SD${Math.round(Math.max(0, Math.min(30, darkness)))}`);
  if (typeof speed === 'number') lines.push(`^PR${Math.round(Math.max(1, Math.min(14, speed)))}`);
  if (persist) lines.push('^JUS');

  // Draw calibration marks once per across-lane so we can see alignment
  // across the entire liner width, not just the middle lane.
  for (let lane = 0; lane < across; lane++) {
    const laneX = effectiveSideM + lane * (labelW + gap);
    if (style === 'grid') {
      appendGridCalibration(lines, laneX, labelW, h, dpi, fmt.width, fmt.height);
    } else {
      appendCrosshairCalibration(lines, laneX, labelW, h, dpi, fmt.width, fmt.height);
    }
  }

  // ^PQ sets print quantity: n, 0, 0, N, N (n copies, no pause, no replicate).
  // Using ^PQ keeps it efficient — the printer handles feeding between labels.
  if (count > 1) {
    lines.push(`^PQ${count},0,0,N,N`);
  }
  lines.push('^XZ');
  return lines.join('\n');
}

/** Crosshairs at 4 corners + center + 4-edge ruler ticks for one lane.
 *  All X coords are offset by `originX` so the caller can place the entire
 *  calibration block anywhere on the liner (used for multi-across rolls). */
function appendCrosshairCalibration(
  lines: string[],
  originX: number,
  w: number,
  h: number,
  dpi: number,
  widthIn: number,
  heightIn: number,
): void {
  const ox = (x: number) => originX + x;
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
    lines.push(`^FO${Math.round(ox(c.x))},${Math.round(c.y + cross / 2 - thick / 2)}^GB${Math.round(cross)},${thick},${thick}^FS`);
    // Vertical bar
    lines.push(`^FO${Math.round(ox(c.x + cross / 2 - thick / 2))},${Math.round(c.y)}^GB${thick},${Math.round(cross)},${thick}^FS`);
  }

  // Center crosshair
  lines.push(`^FO${Math.round(ox(w / 2 - cross / 2))},${Math.round(h / 2 - thick / 2)}^GB${Math.round(cross)},${thick},${thick}^FS`);
  lines.push(`^FO${Math.round(ox(w / 2 - thick / 2))},${Math.round(h / 2 - cross / 2)}^GB${thick},${Math.round(cross)},${thick}^FS`);

  // Dimensions label below center cross
  const fh = Math.max(20, Math.round(dpi / 10));
  const dimText = `${widthIn}" x ${heightIn}"`;
  const dimW = dimText.length * fh * 0.6;
  lines.push(`^FO${Math.round(ox(w / 2 - dimW / 2))},${Math.round(h / 2 + cross)}^A0N,${fh},${Math.round(fh * 0.6)}^FD${dimText}^FS`);

  // Ruler ticks on all 4 edges, every 0.25". Inset 2 dots from the edge.
  const tickSpacing = Math.round(dpi * 0.25);
  const tickShort = Math.max(8, Math.round(dpi / 25));
  const tickLong = Math.max(16, Math.round(dpi / 12));
  const tickThick = Math.max(2, Math.round(dpi / 100));
  const edge = 2;

  for (let x = tickSpacing; x < w; x += tickSpacing) {
    const isInch = Math.abs(x - Math.round(x / dpi) * dpi) < 2;
    const len = isInch ? tickLong : tickShort;
    lines.push(`^FO${Math.round(ox(x))},${edge}^GB${tickThick},${len},${tickThick}^FS`);
    lines.push(`^FO${Math.round(ox(x))},${h - edge - len}^GB${tickThick},${len},${tickThick}^FS`);
  }
  for (let y = tickSpacing; y < h; y += tickSpacing) {
    const isInch = Math.abs(y - Math.round(y / dpi) * dpi) < 2;
    const len = isInch ? tickLong : tickShort;
    lines.push(`^FO${Math.round(ox(edge))},${y}^GB${len},${tickThick},${tickThick}^FS`);
    lines.push(`^FO${Math.round(ox(w - edge - len))},${y}^GB${len},${tickThick},${tickThick}^FS`);
  }

  // Inch labels along the top edge (for labels > 1" wide).
  const labelFh = Math.max(14, Math.round(dpi / 18));
  for (let i = 1; i < Math.floor(widthIn); i++) {
    const x = i * dpi;
    lines.push(`^FO${Math.round(ox(x - labelFh))},${tickLong + 4}^A0N,${labelFh},${Math.round(labelFh * 0.6)}^FD${i}"^FS`);
  }
}

/** Full 0.25" grid of dots + inch labels for one lane. */
function appendGridCalibration(
  lines: string[],
  originX: number,
  w: number,
  h: number,
  dpi: number,
  widthIn: number,
  heightIn: number,
): void {
  const ox = (x: number) => originX + x;
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
      lines.push(`^FO${Math.round(ox(cx))},${cy}^GB${size},${size},${size}^FS`);
    }
  }

  // Dimensions label center-bottom with a white background band.
  const fh = Math.max(18, Math.round(dpi / 12));
  const dimText = `${widthIn}" x ${heightIn}" GRID 0.25"`;
  const dimW = dimText.length * fh * 0.6;
  const bandH = Math.round(fh * 1.5);
  lines.push(`^FO${Math.round(ox(w / 2 - dimW / 2 - 8))},${h - bandH - 4}^GB${Math.round(dimW + 16)},${bandH},${bandH},W^FS`);
  lines.push(`^FO${Math.round(ox(w / 2 - dimW / 2))},${h - bandH + 2}^A0N,${fh},${Math.round(fh * 0.6)}^FD${dimText}^FS`);
}
