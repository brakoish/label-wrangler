import type { RunPrintEvent, RunPrintOutput, RunStatus, TemplateElement } from './types';

/**
 * Plain-language wrappers for messages that come from frozen or low-level code
 * (render server, office API, fetch). Nothing here changes what prints; it
 * only changes what a person reads.
 */

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Package search returned in time but some rows are missing extra details
 * (lab results, retail IDs) because Manifest or Metrc was slow. */
export const SEARCH_DETAILS_INCOMPLETE = 'Some details are still loading. Search again in a moment to fill them in.';

export const OFFLINE_MESSAGE = "Couldn't reach Label Wrangler — check your internet connection and try again.";

export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'TypeError' && /fetch|network|load failed/i.test(error.message)
    || /^(Failed to fetch\s*$|NetworkError|Load failed)/i.test(error.message);
}

/** Server-side trouble (database down, 5xx), in words a person can act on. */
export const SERVER_TROUBLE_MESSAGE = 'Can’t reach the label database right now. Try again in a minute.';
export const SAVE_TROUBLE_MESSAGE = 'Label Wrangler couldn’t save that just now. Try again in a minute.';

/** Remove internal IDs and tidy leftover punctuation. */
export function stripInternalIds(message: string): string {
  return message
    .replace(/\s*\(?(?:request|id|job)\s+[0-9a-f]{8}\)?/gi, '')
    .replace(UUID, '')
    .replace(/,\s*:/g, ':')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,:])/g, '$1')
    .replace(/\.{2,}/g, '.')
    .trim();
}

/** A message safe to show a person, for any thrown value. */
export function friendlyError(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (isNetworkError(error)) return OFFLINE_MESSAGE;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!message) return fallback;
  if (/^Office printing request failed/i.test(message) || /^Internal Server Error$/i.test(message)) return 'Label Wrangler is having trouble right now. Try again in a minute.';
  if (/database (unavailable|error)|simulated 5\d\d|service unavailable|bad gateway|gateway time-?out|^Failed to (fetch|load) \w/i.test(message)) return SERVER_TROUBLE_MESSAGE;
  if (/^Failed to (update|create|delete|archive|save) \w/i.test(message)) return SAVE_TROUBLE_MESSAGE;
  return stripInternalIds(message) || fallback;
}

const STATUS_LABELS: Record<RunStatus, string> = {
  draft: 'Draft',
  queued: 'Ready to print',
  printing: 'Printing',
  paused: 'Paused',
  completed: 'Done',
  cancelled: 'Cancelled',
};
export function runStatusLabel(status: RunStatus | string): string {
  return STATUS_LABELS[status as RunStatus] ?? (status ? status[0].toUpperCase() + status.slice(1) : '');
}

const OUTPUT_LABELS: Record<RunPrintOutput, string> = {
  'roll-zpl': 'thermal printer',
  'roll-pdf': 'PDF',
  'sheet-pdf': 'sheet printer / PDF',
  scan: 'scan mode',
  'office-pi': 'office printer',
};
export function printOutputLabel(output: RunPrintOutput | string): string {
  return OUTPUT_LABELS[output as RunPrintOutput] ?? 'printer';
}

function elementNoun(element: TemplateElement): string {
  if (element.type === 'image') return 'The picture box';
  if (element.type === 'qr') return element.fieldName ? `The QR code "${element.fieldName}"` : 'The QR code';
  if (element.type === 'barcode') return element.fieldName ? `The barcode "${element.fieldName}"` : 'The barcode';
  if (element.type === 'text') return element.fieldName ? `The text "${element.fieldName}"` : 'A text box';
  if (element.type === 'line') return 'A line';
  return 'A box';
}

const RENDER_PHRASES: Array<[RegExp, (element?: TemplateElement) => string]> = [
  [/^Image is missing$/i, () => 'has no picture yet — choose a file or delete the box.'],
  [/^Missing QR\/barcode value$/i, (el) => el && !el.isStatic ? 'has no value — type one under "Sample text (preview only)", or fill it from your data.' : 'has no value — type one in the properties panel.'],
  [/^Text overflows its box/i, () => 'doesn\'t fit its box — make the box bigger, use a smaller size, or turn on Auto-fit.'],
  [/^Artwork is entirely outside the label$/i, () => 'is outside the label — drag it back onto the label.'],
  [/^Barcode box is too small/i, () => 'is too small to scan — make its box bigger.'],
];

/**
 * Turn "Lane 1, 087b8c70-…: Image is missing" (render server wording) into
 * "The picture box has no picture yet — choose a file or delete the box."
 */
export function friendlyRenderError(message: string, elements: TemplateElement[] = [], labelsAcross = 1): string {
  return message.replace(/Lane (\d+), ([^:]+): ([^\n]+)/g, (_match, lane: string, ref: string, detail: string) => {
    const element = elements.find((el) => el.id === ref.trim()) ?? elements.find((el) => el.fieldName === ref.trim());
    const subject = element ? elementNoun(element) : UUID.test(ref) ? 'One item' : `"${ref.trim()}"`;
    UUID.lastIndex = 0;
    const phrase = RENDER_PHRASES.find(([re]) => re.test(detail.trim()));
    const where = labelsAcross > 1 ? ` (label position ${lane})` : '';
    return phrase ? `${subject}${where} ${phrase[1](element)}` : `${subject}${where}: ${detail}`;
  }).replace(UUID, '').trim();
}

/** Plain-words history line, e.g. "Printed labels 1–20 on the thermal printer". */
export function printEventLabel(event: Pick<RunPrintEvent, 'eventType' | 'output' | 'rangeFrom' | 'rangeTo' | 'message'>) {
  const range = event.rangeFrom === event.rangeTo ? `label ${event.rangeFrom}` : `labels ${event.rangeFrom}–${event.rangeTo}`;
  const where = printOutputLabel(event.output);
  const reprint = /^Reprint/i.test(event.message || '');
  if (event.eventType === 'opened') return reprint ? `Opened a reprint of ${range} for the ${where}` : `Opened ${range} for the ${where}`;
  if (event.eventType === 'confirmed') return `Printed ${range} on the ${where}`;
  if (event.eventType === 'failed') return reprint ? `Reprint of ${range} failed on the ${where}` : `Printing ${range} failed on the ${where}`;
  if (event.eventType === 'cancelled') return `Stopped ${range} on the ${where}`;
  if (/^Exported PDF/i.test(event.message || '')) return `Saved ${range} as a PDF`;
  if (/^Exported ZPL/i.test(event.message || '')) return `Saved ${range} as a printer file`;
  if (reprint) return `Reprinted ${range} on the ${where}`;
  return `Sent ${range} to the ${where}`;
}
