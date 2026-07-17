/**
 * Dazzle local print bridge.
 *
 * Dazzle (https://github.com/StirlingMarketingGroup/dazzle) is a tiny open-source
 * desktop app that runs a localhost HTTP server (default :29100) and forwards
 * ZPL to any OS-installed printer via the platform's raw-spool API. Unlike WebUSB,
 * this keeps the printer usable by other Windows apps — no driver swap needed.
 *
 * We use it as the Windows-friendly path; macOS/Linux users can still use
 * WebUSB for zero-install, but Dazzle works everywhere and is generally simpler.
 */

import { Dazzle } from 'dazzle-zpl';

export type DazzlePrinter = { name: string; is_default: boolean };

const client = new Dazzle();

/** Is the Dazzle desktop app running on localhost? */
export async function isDazzleRunning(): Promise<boolean> {
  try {
    return await client.isRunning();
  } catch {
    return false;
  }
}

/** List printers known to Dazzle (OS printers on the user's machine). */
export async function listDazzlePrinters(): Promise<DazzlePrinter[]> {
  return await client.printers();
}

/** Send raw ZPL to a specific (or default) printer through Dazzle. */
export async function printViaDazzle(zpl: string, printerName?: string): Promise<void> {
  await client.print(zpl, printerName ? { printer: printerName } : undefined);
}

/** Send multiple ZPL labels as separate ordered jobs through Dazzle. */
export async function printAllViaDazzle(zpls: string[], printerName?: string): Promise<void> {
  if (zpls.length === 0) return;
  if (zpls.length === 1) {
    await printViaDazzle(zpls[0], printerName);
    return;
  }
  await client.printAll(zpls, printerName ? { printer: printerName } : undefined);
}

/** Public download/install URL for the user. */
export const DAZZLE_DOWNLOAD_URL = 'https://github.com/StirlingMarketingGroup/dazzle/releases';
