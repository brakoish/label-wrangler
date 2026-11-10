import type { BarcodeElement, TemplateElement } from './types';
import { friendlyFieldName } from './fieldLabels';

/**
 * The sample each per-label field shows while designing, resolved one way
 * everywhere (canvas, exact print preview, sheet overview, design cards):
 * the Test data value, then the design's sample, then the text typed on the
 * item, then the field's plain name. Prefix and suffix are never part of
 * the sample, so they can't show twice ("Packaged Packaged").
 *
 * Preview only: printing resolves values from the run's data as before.
 */

const BARCODE_PLACEHOLDER: Record<BarcodeElement['barcodeFormat'], string> = {
  CODE128: '123456789',
  CODE39: '123456789',
  UPC: '012345678905',
  EAN13: '5901234123457',
  EAN8: '96385074',
  ITF14: '00012345600012',
};

/** Values a new design's barcode or QR code starts with: printing one on every label is a mistake. */
export const EXAMPLE_CODE_VALUES: ReadonlyArray<string> = [...new Set([...Object.values(BARCODE_PLACEHOLDER), 'https://example.com', 'https://example.com/'])];

function withoutAffixes(text: string, prefix = '', suffix = ''): string {
  let value = text;
  if (prefix && value.startsWith(prefix)) value = value.slice(prefix.length);
  else if (prefix.trim() && value.startsWith(prefix.trim())) value = value.slice(prefix.trim().length).trimStart();
  if (suffix && value.endsWith(suffix)) value = value.slice(0, value.length - suffix.length);
  else if (suffix.trim() && value.endsWith(suffix.trim())) value = value.slice(0, value.length - suffix.trim().length).trimEnd();
  return value;
}

/** The sample for one per-label item, without prefix or suffix. */
export function elementSample(el: TemplateElement, testData?: Record<string, string>): string {
  const typed = el.fieldName ? testData?.[el.fieldName] : undefined;
  if (typed && typed.trim()) return typed;
  if (el.defaultValue && el.defaultValue.trim()) return el.defaultValue;
  const content = 'content' in el ? withoutAffixes(el.content || '', el.prefix, el.suffix) : '';
  if (content.trim()) return content;
  if (el.type === 'barcode') return BARCODE_PLACEHOLDER[el.barcodeFormat] ?? '123456789';
  return friendlyFieldName(el.fieldName);
}

/**
 * Values for every per-label field of a design, for previews. The first item
 * with a sample wins when two items share a field.
 */
export function designSampleValues(elements: ReadonlyArray<TemplateElement>, testData?: Record<string, string>): Record<string, string> {
  const values: Record<string, string> = {};
  const dynamic = elements.filter((el) => !el.isStatic && el.fieldName);
  for (const el of dynamic) {
    const field = el.fieldName!;
    if (values[field]) continue;
    const explicit = (testData?.[field] ?? '').trim() || (el.defaultValue ?? '').trim();
    if (explicit) values[field] = elementSample(el, testData);
  }
  for (const el of dynamic) {
    const field = el.fieldName!;
    if (!values[field]) values[field] = elementSample(el, testData);
  }
  return values;
}
