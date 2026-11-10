import type { RunPrintEvent, RunPrintOutput, RunStatus, TemplateElement } from './types';
import { friendlyFieldName } from './fieldLabels';
import { barcodeValueProblem } from './barcodeValue';
import { barcodeFit, barcodeFitFix, barcodeFitProblem } from './barcodeFit';

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
  // The label renderer names a lane and an item ("Lane 1, SKU: Artwork failed").
  if (/Lane \d+, [^:]+: /.test(message)) return friendlyRenderError(message);
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
  const field = !element.isStatic && element.fieldName ? friendlyFieldName(element.fieldName) : '';
  if (element.type === 'qr') return field ? `The ${field} QR code` : 'The QR code';
  if (element.type === 'barcode') return field ? `The ${field} barcode` : 'The barcode';
  if (element.type === 'text') return field ? `The ${field} text` : 'A text box';
  if (element.type === 'line') return 'A line';
  return 'A box';
}

/** The value the renderer drew: fixed text for "Same on every label", else the field's value, with prefix and suffix. */
function barcodeValue(element: TemplateElement | undefined, values?: Record<string, string>): string {
  if (!element) return '';
  const content = 'content' in element ? element.content || '' : '';
  if (element.isStatic) return content;
  const fromValues = element.fieldName ? values?.[element.fieldName] : undefined;
  return `${element.prefix || ''}${fromValues || element.defaultValue || content}${element.suffix || ''}`;
}

type RenderFormat = Parameters<typeof barcodeFit>[2];
const RENDER_PHRASES: Array<[RegExp, (element?: TemplateElement, values?: Record<string, string>, format?: RenderFormat) => string]> = [
  // The artwork renderer throws a bare "Artwork failed" (or the barcode
  // library's own words) when a value doesn't suit the barcode type.
  [/^(Artwork failed|Invalid barcode content.*|.*is not a valid input for.*)$/i, (el, values) => {
    if (el?.type === 'barcode') {
      const problem = barcodeValueProblem(el.barcodeFormat, barcodeValue(el, values));
      if (problem) return `${problem}.`.replace(/\.\.$/, '.');
      return 'can’t be drawn with this value. Check the value suits the barcode type.';
    }
    if (el?.type === 'qr') return 'can’t be drawn with this value. Make the QR code box bigger.';
    if (!el) return 'can’t be drawn with its value. Check the value suits the item, for example numbers only for a UPC barcode.';
    return 'couldn’t be drawn. Check its value, or delete it and add it again.';
  }],
  [/^Image is missing$/i, () => 'has no picture yet — choose a file or delete the box.'],
  [/^Missing QR\/barcode value$/i, (el) => el && !el.isStatic ? 'has no value — type a sample under "Sample for the preview", or fill it from your data.' : 'has no value — type one in the properties panel.'],
  [/^Text overflows its box/i, () => 'doesn\'t fit its box — make the box bigger, use a smaller size, or turn on Auto-fit.'],
  [/^Artwork is entirely outside the label$/i, () => 'is outside the label — drag it back onto the label.'],
  [/^Barcode box is too small/i, (el, values, format) => {
    // The exact renderer's own limit, from the shared verdict: how wide the box must be.
    if (el?.type === 'barcode' && format) {
      const value = barcodeValue(el, values);
      const fit = barcodeFit(el, value, format, true);
      if (fit.level === 'blocked' && fit.reason !== 'characters') return `${barcodeFitProblem(fit, value)}. ${barcodeFitFix(fit)}.`;
    }
    return 'is too small to scan — make its box wider.';
  }],
  [/clipped outside the label/i, () => 'runs off the label edge, so it won’t scan — move it fully onto the label.'],
];

/**
 * The exact renderer refuses a box under 1 dot or over 12,000 dots with a
 * bare "Invalid element width": name the item and say what to do ("Barcode
 * 1 has no width. Open the design and set its width.").
 */
function namedSizeError(message: string, elements: TemplateElement[], format?: RenderFormat): string | null {
  const match = /^\s*Invalid element (width|height)\.?\s*$/i.exec(message);
  if (!match) return null;
  const dim = match[1].toLowerCase() as 'width' | 'height';
  const bad = elements.find((el) => !(Number.isFinite(el[dim]) && el[dim] >= 1 && el[dim] <= 12000));
  if (!bad) return `One item has a ${dim} that can’t be used. Open the design and check each item’s ${dim}.`;
  const owner = !bad.isStatic && bad.fieldName ? friendlyFieldName(bad.fieldName) : elementTypeLabel(bad.type);
  const dpi = format?.dpi || 203;
  if (!Number.isFinite(bad[dim]) || bad[dim] < 1) return `${owner} has no ${dim}. Open the design and set its ${dim}.`;
  return `${owner}’s ${dim} (${Math.round((bad[dim] / dpi) * 100) / 100}") is far bigger than the label. Open the design and set its ${dim}.`;
}

/**
 * A design that wouldn't save because one item's number was refused ("Invalid
 * width"): name that item. `fallback` is used for anything else.
 */
export function friendlySaveError(message: string, elements: TemplateElement[], fallback: string): string {
  const match = /^\s*Invalid (width|height|x|y|fontSize|minFontSize|lineHeight|strokeWidth|borderRadius)\.?\s*$/i.exec(message);
  if (match) {
    const key = match[1] as 'width' | 'height' | 'x' | 'y' | 'fontSize' | 'minFontSize' | 'lineHeight' | 'strokeWidth' | 'borderRadius';
    const words: Record<string, string> = { width: 'width', height: 'height', x: 'distance from the left', y: 'distance from the top', fontSize: 'text size', minFontSize: 'smallest text size', lineHeight: 'line spacing', strokeWidth: 'thickness', borderRadius: 'corners' };
    const limits: Record<string, [number, number]> = { width: [0, 100000], height: [0, 100000], x: [-100000, 100000], y: [-100000, 100000], fontSize: [0.01, 10000], minFontSize: [0.01, 10000], lineHeight: [0.01, 10000], strokeWidth: [0, 10000], borderRadius: [0, 10000] };
    const [min, max] = limits[key];
    const bad = elements.find((el) => { const v = (el as unknown as Record<string, unknown>)[key]; return v !== undefined && !(typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max); });
    if (bad) {
      const owner = !bad.isStatic && bad.fieldName ? friendlyFieldName(bad.fieldName) : elementTypeLabel(bad.type);
      return `${owner}’s ${words[key]} can’t be used, so your changes weren’t saved. Select it and type a new ${words[key]}.`;
    }
  }
  return friendlyError(message, fallback);
}

function elementTypeLabel(type: string): string {
  return ({ text: 'A text box', qr: 'The QR code', barcode: 'The barcode', line: 'A line', rectangle: 'A box', image: 'A picture' } as Record<string, string>)[type] ?? 'One item';
}

/**
 * Turn "Lane 1, 087b8c70-…: Image is missing" (render server wording) into
 * "The picture box has no picture yet — choose a file or delete the box."
 */
export function friendlyRenderError(message: string, elements: TemplateElement[] = [], labelsAcross = 1, values?: Record<string, string>, format?: RenderFormat): string {
  const size = namedSizeError(message, elements, format);
  if (size) return size;
  return message.replace(/Lane (\d+), ([^:]+): ([^\n]+)/g, (_match, lane: string, ref: string, detail: string) => {
    const element = elements.find((el) => el.id === ref.trim()) ?? elements.find((el) => el.fieldName === ref.trim());
    const subject = element ? elementNoun(element) : UUID.test(ref) ? 'One item' : `The ${friendlyFieldName(ref.trim())} item`;
    UUID.lastIndex = 0;
    const phrase = RENDER_PHRASES.find(([re]) => re.test(detail.trim()));
    const where = labelsAcross > 1 ? ` (label position ${lane})` : '';
    return phrase ? `${subject}${where} ${phrase[1](element, values, format)}` : `${subject}${where}: ${detail}`;
  }).replace(UUID, '').trim();
}

/** Plain-words history line, e.g. "Printed labels 1–20 on the thermal printer". */
export function printEventLabel(event: Pick<RunPrintEvent, 'eventType' | 'output' | 'rangeFrom' | 'rangeTo' | 'message'>) {
  const range = event.rangeFrom === event.rangeTo ? `label ${event.rangeFrom}` : `labels ${event.rangeFrom}–${event.rangeTo}`;
  const where = printOutputLabel(event.output);
  const reprint = /^Reprint/i.test(event.message || '');
  if (event.output === 'scan' && event.eventType === 'sent') return /again/i.test(event.message || '') ? `Printed ${range} again by scanning` : `Printed ${range} by scanning`;
  if (event.eventType === 'opened') return reprint ? `Opened a reprint of ${range} for the ${where}` : `Opened ${range} for the ${where}`;
  if (event.eventType === 'confirmed') return `Printed ${range} on the ${where}`;
  if (event.eventType === 'failed') return reprint ? `Reprint of ${range} failed on the ${where}` : `Printing ${range} failed on the ${where}`;
  if (event.eventType === 'cancelled') return `Stopped ${range} on the ${where}`;
  if (/^Exported PDF/i.test(event.message || '')) return `Saved ${range} as a PDF`;
  if (/^Exported ZPL/i.test(event.message || '')) return `Saved ${range} as a printer file`;
  if (reprint) return `Reprinted ${range} on the ${where}`;
  return `Sent ${range} to the ${where}`;
}

/**
 * A failed artwork render in plain words, naming the item from the design
 * (friendlyError alone can't see the design, so it says "The SKU item").
 */
export function friendlyRenderFailure(error: unknown, fallback: string, elements: TemplateElement[], labelsAcross = 1, values?: Record<string, string>, format?: RenderFormat): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const size = namedSizeError(raw, elements, format);
  if (size) return size;
  if (/Lane \d+, [^:]+: /.test(raw)) return friendlyRenderError(raw, elements, labelsAcross, values, format);
  return friendlyError(error, fallback);
}
