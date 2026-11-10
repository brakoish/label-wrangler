import type { BarcodeFormat, FieldMapping, LabelTemplate, TemplateElement } from './types';
import { friendlyFieldName, spreadsheetRow } from './fieldLabels';

/**
 * Whole-run check that every barcode value is one the barcode type can hold.
 * The printer (and the bitmap renderer) fail on such values part-way through
 * a run, so the wizard checks every label before it starts.
 *
 * Value resolution mirrors runBuilder.valuesForLabel (and runDataCheck): the
 * typed value, then the row's column value, then prefix/suffix around it.
 */

const CODE39 = /^[0-9A-Z \-.$/+%]*$/;

function checkDigitOk(digits: string): boolean {
  // GS1 mod-10 over everything but the last digit.
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const n = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? n * 3 : n;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

function unsupportedCharacters(value: string, allowed: (ch: string) => boolean): string[] {
  const bad: string[] = [];
  for (const ch of value) if (!allowed(ch) && !bad.includes(ch)) bad.push(ch);
  return bad;
}

function listCharacters(chars: string[]): string {
  const shown = chars.slice(0, 4).map((ch) => (ch === ' ' ? 'space' : ch));
  return shown.join(', ') + (chars.length > 4 ? ' and others' : '');
}

/**
 * Why a barcode can't print `value`, in plain words, or null when it can.
 * `noun` names the field ("the SKU").
 */
export function barcodeValueProblem(format: BarcodeFormat | undefined, value: string): string | null {
  if (!value) return null;
  switch (format ?? 'CODE128') {
    case 'CODE128': {
      const bad = unsupportedCharacters(value, (ch) => {
        const code = ch.codePointAt(0) ?? 0;
        return code >= 32 && code <= 126;
      });
      return bad.length ? `has characters a barcode can't hold (${listCharacters(bad)})` : null;
    }
    case 'CODE39': {
      if (CODE39.test(value)) return null;
      const bad = unsupportedCharacters(value, (ch) => CODE39.test(ch));
      return `has characters this barcode type can't hold (${listCharacters(bad)}). It takes capital letters, numbers, spaces and - . $ / + %`;
    }
    case 'UPC':
      return digitsProblem(value, [11, 12], 'A UPC barcode needs 12 digits');
    case 'EAN13':
      return digitsProblem(value, [12, 13], 'An EAN-13 barcode needs 13 digits');
    case 'EAN8':
      return digitsProblem(value, [7, 8], 'An EAN-8 barcode needs 8 digits');
    case 'ITF14':
      return /^\d+$/.test(value) ? null : 'can only hold numbers in this barcode type';
    default:
      return null;
  }
}

function digitsProblem(value: string, lengths: [number, number], rule: string): string | null {
  if (!/^\d+$/.test(value)) return `can only hold numbers. ${rule}`;
  if (!lengths.includes(value.length)) return `has ${value.length} digits. ${rule}`;
  if (value.length === lengths[1] && !checkDigitOk(value)) return 'has a wrong last digit (check digit). Check the number';
  return null;
}

export interface BarcodeIssue {
  field: string;
  /** 1-based label number. */
  label: number;
  value: string;
  problem: string;
}

export interface BarcodeCheck {
  issues: BarcodeIssue[];
  /** Labels with at least one bad value (counted in full). */
  badLabels: number;
}

interface RunData {
  sourceData: ReadonlyArray<string | Record<string, string>>;
  fieldMappings?: Record<string, FieldMapping> | null;
  staticValues?: Record<string, string> | null;
  mappedField?: string | null;
}

function valuesFor(run: RunData, index: number): Record<string, string> {
  const values: Record<string, string> = { ...(run.staticValues || {}) };
  const row = run.sourceData[index];
  const mappings = run.fieldMappings || {};
  if (row && typeof row === 'object') {
    for (const [field, mapping] of Object.entries(mappings)) {
      if (mapping.mode === 'column' && mapping.csvColumn) values[field] = (row as Record<string, string>)[mapping.csvColumn] ?? '';
    }
  } else if (typeof row === 'string') {
    const legacy = run.mappedField ?? Object.entries(mappings).find(([, m]) => m.mode === 'column')?.[0];
    if (legacy) values[legacy] = row;
  }
  return values;
}

function printedValue(el: TemplateElement, values: Record<string, string>): string {
  if (el.isStatic) return 'content' in el ? el.content || '' : '';
  const value = (el.fieldName && values[el.fieldName]) || el.defaultValue || '';
  return `${el.prefix || ''}${value}${el.suffix || ''}`;
}

const MAX_ISSUES = 50;

export function checkRunBarcodes(template: Pick<LabelTemplate, 'elements'>, run: RunData): BarcodeCheck {
  const barcodes = template.elements.filter((el) => el.type === 'barcode');
  const issues: BarcodeIssue[] = [];
  let badLabels = 0;
  if (!barcodes.length) return { issues, badLabels };
  const total = Math.max(1, run.sourceData.length);
  // A fixed barcode is the same on every label: check it once.
  for (const el of barcodes.filter((b) => b.isStatic)) {
    const value = printedValue(el, {});
    const problem = el.type === 'barcode' ? barcodeValueProblem(el.barcodeFormat, value) : null;
    if (problem) {
      issues.push({ field: '', label: 0, value, problem });
      badLabels = total;
    }
  }
  const dynamic = barcodes.filter((b) => !b.isStatic);
  for (let index = 0; index < total && dynamic.length; index++) {
    const values = valuesFor(run, index);
    let bad = false;
    for (const el of dynamic) {
      if (el.type !== 'barcode') continue;
      const value = printedValue(el, values);
      const problem = barcodeValueProblem(el.barcodeFormat, value);
      if (!problem) continue;
      bad = true;
      if (issues.length < MAX_ISSUES && !issues.some((i) => i.label === index + 1 && i.field === el.fieldName)) {
        issues.push({ field: el.fieldName || '', label: index + 1, value, problem });
      }
    }
    if (bad) badLabels++;
  }
  return { issues, badLabels };
}

function shorten(value: string, max = 24): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * "Label 10: the SKU 'ABC-…ÄÖ' has characters a barcode can't hold (Ä, Ö).
 * Fix row 11 of your spreadsheet." `fromSpreadsheet` adds the row hint.
 */
export function describeBarcodeIssue(issue: BarcodeIssue, fromSpreadsheet: boolean): string {
  if (!issue.label) return `The fixed barcode "${shorten(issue.value)}" ${issue.problem}. Change it in the design.`;
  const name = friendlyFieldName(issue.field);
  const fix = fromSpreadsheet ? ` Fix row ${spreadsheetRow(issue.label)} of your spreadsheet.` : '';
  return `Label ${issue.label.toLocaleString()}: the ${name} "${shorten(issue.value)}" ${issue.problem}.${fix}`;
}
