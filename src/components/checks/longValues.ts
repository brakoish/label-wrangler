import type { BarcodeElement, LabelFormat, LabelTemplate, TemplateElement } from '@/lib/types';
import { barcodeFit } from '@/lib/barcodeFit';
import { valuesFor } from '@/lib/barcodeCheck';
import { friendlyFieldName } from '@/lib/fieldLabels';

/**
 * A spreadsheet value too long for its barcode on some labels only: the
 * design is fine for the other rows, so the problem is in those rows' data.
 * The new run page leaves those labels out (like blank cells) instead of
 * holding back the whole run with "fix the design". A value too long on
 * every label is a design problem and is not listed here.
 *
 * Reads the same fit verdict the barcode check uses (barcodeFit), so it never
 * disagrees with it; it changes nothing that prints.
 */

/** Fit problems that depend on how long the value is (not on where the box sits). */
const LENGTH_REASONS = new Set(['box-too-small', 'off-label', 'into-next-label']);

type FitFormat = Parameters<typeof barcodeFit>[2];

interface RunData {
  sourceData: ReadonlyArray<Record<string, string> | string>;
  fieldMappings?: Record<string, { mode: 'static' | 'column'; csvColumn?: string }> | null;
  staticValues?: Record<string, string> | null;
  mappedField?: string | null;
}

export interface LongValueField {
  field: string;
  /** Labels (0-based, over the rows given) whose value is too long. */
  indexes: number[];
  /** The longest value on those labels, in characters. */
  longest: number;
  /** The longest value that fits, on the other labels (0 when none has a value). */
  othersLongest: number;
  /** The exact renderer refuses it: those labels can't print as they are. */
  stops: boolean;
}

export interface LongValueRows {
  /** Every label (0-based) with a value too long, over all fields. */
  indexes: number[];
  fields: LongValueField[];
  /** Any of them can't print at all (rather than printing cut off). */
  stops: boolean;
}

const NONE: LongValueRows = { indexes: [], fields: [], stops: false };

function isBarcode(el: TemplateElement): el is BarcodeElement {
  return el.type === 'barcode';
}

export function longValueRows(
  template: Pick<LabelTemplate, 'elements'> & Partial<Pick<LabelTemplate, 'thermalRenderMode'>>,
  format: FitFormat | Pick<LabelFormat, 'type'> | null | undefined,
  run: RunData,
  fromSheet: (field: string) => boolean,
): LongValueRows {
  const total = run.sourceData.length;
  if (total < 2) return NONE;
  const bitmap = template.thermalRenderMode === 'bitmap-v1';
  const thermal = format?.type === 'thermal';
  const elements = template.elements.filter((el): el is BarcodeElement => isBarcode(el) && !el.isStatic && !!el.fieldName && fromSheet(el.fieldName));
  if (!elements.length) return NONE;
  const byField = new Map<string, { bad: Set<number>; longest: number; othersLongest: number; stops: boolean }>();
  for (let index = 0; index < total; index++) {
    const values = valuesFor(run, index);
    for (const el of elements) {
      const field = el.fieldName as string;
      const raw = values[field] || el.defaultValue || '';
      const printed = `${el.prefix || ''}${raw}${el.suffix || ''}`;
      const fit = barcodeFit(el, printed, format as FitFormat, bitmap);
      let entry = byField.get(field);
      if (!entry) { entry = { bad: new Set(), longest: 0, othersLongest: 0, stops: false }; byField.set(field, entry); }
      if (fit.level === 'blocked' && LENGTH_REASONS.has(fit.reason)) {
        entry.bad.add(index);
        entry.longest = Math.max(entry.longest, raw.length);
        if (thermal && fit.bitmap && !fit.printable) entry.stops = true;
      }
    }
  }
  // "The others have 12 or fewer": the longest value on the labels that fit.
  for (let index = 0; index < total; index++) {
    const values = valuesFor(run, index);
    for (const [field, entry] of byField) {
      if (!entry.bad.size || entry.bad.has(index)) continue;
      const el = elements.find((e) => e.fieldName === field);
      const raw = values[field] || el?.defaultValue || '';
      entry.othersLongest = Math.max(entry.othersLongest, raw.length);
    }
  }
  const fields: LongValueField[] = [];
  for (const [field, entry] of byField) {
    // Too long on every label: the barcode's space is too small, not the data.
    if (!entry.bad.size || entry.bad.size >= total) continue;
    fields.push({ field, indexes: Array.from(entry.bad).sort((a, b) => a - b), longest: entry.longest, othersLongest: entry.othersLongest, stops: entry.stops });
  }
  if (!fields.length) return NONE;
  const indexes = Array.from(new Set(fields.flatMap((f) => f.indexes))).sort((a, b) => a - b);
  return { indexes, fields, stops: fields.some((f) => f.stops) };
}

/** Whether a barcode issue is one of these (a value too long on some labels of that field). */
export function isLongValueIssue(issue: { kind?: string; field: string; label: number; fit?: { reason?: string } }, rows: LongValueRows): boolean {
  return issue.kind === 'too-long' && issue.label > 0 && LENGTH_REASONS.has(issue.fit?.reason ?? '') && rows.fields.some((f) => f.field === issue.field);
}

/** "label 2,600", "labels 3, 12 and 17", "labels 4–9", "labels 3, 12, 17, 40 and 9 more". */
export function longLabelWords(labels: ReadonlyArray<number>, total: number): string {
  const n = (x: number) => x.toLocaleString();
  if (labels.length >= total && total > 1) return `all ${n(total)} labels`;
  if (labels.length === 1) return `label ${n(labels[0])}`;
  const consecutive = labels.every((x, i) => i === 0 || x === labels[i - 1] + 1);
  if (consecutive) return `labels ${n(labels[0])}–${n(labels[labels.length - 1])}`;
  const shown = labels.slice(0, 4).map(n);
  return labels.length > shown.length
    ? `labels ${shown.join(', ')} and ${n(labels.length - shown.length)} more`
    : `labels ${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

function capital(text: string): string {
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}

/** "Label 12’s SKU (spreadsheet row 13) is too long for its barcode: 40 characters, where the other labels have 12 or fewer." */
export function longValueSentence(field: LongValueField, total: number, sheetRow?: (index: number) => number): string {
  const n = field.indexes.length;
  const name = friendlyFieldName(field.field);
  const labels = longLabelWords(field.indexes.map((i) => i + 1), total);
  const others = field.othersLongest > 0;
  if (n === 1) {
    const row = sheetRow ? ` (spreadsheet row ${sheetRow(field.indexes[0]).toLocaleString()})` : '';
    return others
      ? `${capital(labels)}’s ${name}${row} is too long for its barcode: ${field.longest} characters, where the other labels have ${field.othersLongest} or fewer.`
      : `${capital(labels)}’s ${name}${row} is too long for its barcode (${field.longest} characters).`;
  }
  return others
    ? `${capital(labels)} have a ${name} too long for its barcode (up to ${field.longest} characters, where the others have ${field.othersLongest} or fewer).`
    : `${capital(labels)} have a ${name} too long for its barcode (up to ${field.longest} characters).`;
}

/** The footer's short reason: what to do, in one line. */
export function longValueReason(fields: ReadonlyArray<LongValueField>, labels: number, total: number, stops: boolean): string {
  const one = labels === 1;
  const first = fields[0];
  const what = fields.length === 1 && one && first
    ? `${capital(longLabelWords([first.indexes[0] + 1], total))}’s ${friendlyFieldName(first.field)} is too long for its barcode.`
    : `${labels.toLocaleString()} label${one ? ' has a value' : 's have values'} too long for ${one ? 'its barcode' : 'their barcodes'}.`;
  const tick = one ? 'Print it anyway, cut off' : `Print those ${labels.toLocaleString()} anyway, cut off`;
  return `${what} Leave ${one ? 'that label' : 'those labels'} out${stops ? ' or' : ','} fix ${one ? 'that row' : 'those rows'}${stops ? '' : `, or tick “${tick}”`}.`;
}
