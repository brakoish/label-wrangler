/**
 * Dazzle local print bridge.
 *
 * Dazzle (https://github.com/StirlingMarketingGroup/dazzle) is a tiny open-source
 * desktop app that runs a localhost HTTP server (default :29100) and forwards
 * ZPL to any OS-installed printer via the platform's raw-spool API. Unlike WebUSB,
 * this keeps the printer usable by other Windows apps \u2014 no driver swap needed.
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

/** Public download/install URL for the user. */
export const DAZZLE_DOWNLOAD_URL = 'https://github.com/StirlingMarketingGroup/dazzle/releases';
