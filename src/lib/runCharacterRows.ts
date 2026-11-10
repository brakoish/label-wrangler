import type { FieldMapping, LabelFormat, LabelTemplate, TemplateElement } from './types';
import { barcodeFit } from './barcodeFit';
import { unprintableCharacters, usesPrinterFont } from './printerCharacters';

/**
 * Odd characters in the spreadsheet (é, an emoji, a hidden tab) on the new
 * run page. Two helpers, neither of which changes what the printers do with
 * a value:
 * - cleanHiddenCharacters: a tab or an invisible character (zero-width
 *   space, byte-order mark, control character) in a mapped cell is never
 *   meant to print. It is taken out (a tab becomes a space) and the cell
 *   trimmed, and each change is reported so the page can say so. Cells
 *   without one are left exactly as they are.
 * - labelsWithBadCharacters: the labels (0-based) whose spreadsheet values
 *   can't print (a barcode value its type can't hold, or text the printer's
 *   own font can't print), so they can be left out like blank rows.
 */

// Tab, other control characters (not line breaks), soft hyphen, zero-width
// and direction marks, word joiners and the byte-order mark.
const HIDDEN = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F­​-‏‪-‮⁠-⁤﻿]/;
const HIDDEN_ALL = new RegExp(HIDDEN.source, 'g');

export function hasHiddenCharacters(value: string): boolean {
  return HIDDEN.test(value);
}

/** The value without tabs and invisible characters (a tab becomes a space), trimmed. */
export function withoutHiddenCharacters(value: string): string {
  return value.replace(HIDDEN_ALL, (ch) => (ch === '\t' ? ' ' : '')).replace(/ {2,}/g, ' ').trim();
}

export interface HiddenCharacterFix { label: number; field: string; tab: boolean }

export function cleanHiddenCharacters(rows: ReadonlyArray<Record<string, string>>, mappings: Record<string, FieldMapping>): { rows: Record<string, string>[]; fixes: HiddenCharacterFix[] } {
  const columns = new Map<string, string>();
  for (const [field, mapping] of Object.entries(mappings)) {
    if (mapping.mode === 'column' && mapping.csvColumn && !columns.has(mapping.csvColumn)) columns.set(mapping.csvColumn, field);
  }
  const fixes: HiddenCharacterFix[] = [];
  if (!columns.size) return { rows: rows as Record<string, string>[], fixes };
  let changed = false;
  const out = rows.map((row, index) => {
    let copy: Record<string, string> | null = null;
    for (const [column, field] of columns) {
      const value = row?.[column];
      if (typeof value !== 'string' || !HIDDEN.test(value)) continue;
      copy ??= { ...row };
      copy[column] = withoutHiddenCharacters(value);
      fixes.push({ label: index + 1, field, tab: value.includes('\t') });
    }
    if (copy) { changed = true; return copy; }
    return row;
  });
  return { rows: changed ? out : (rows as Record<string, string>[]), fixes };
}

interface RunData {
  sourceData: ReadonlyArray<Record<string, string> | string>;
  fieldMappings?: Record<string, FieldMapping> | null;
  staticValues?: Record<string, string> | null;
}

function valueFor(el: TemplateElement, run: RunData, index: number): string {
  const row = run.sourceData[index];
  const mapping = el.fieldName ? run.fieldMappings?.[el.fieldName] : undefined;
  const raw = mapping?.mode === 'column' && mapping.csvColumn && row && typeof row === 'object' ? row[mapping.csvColumn] ?? '' : (el.fieldName && run.staticValues?.[el.fieldName]) || '';
  const value = raw || el.defaultValue || '';
  return `${el.prefix || ''}${value}${el.suffix || ''}`;
}

export function labelsWithBadCharacters(
  template: Pick<LabelTemplate, 'elements' | 'thermalRenderMode'>,
  format: (Pick<LabelFormat, 'type'> & Partial<LabelFormat>) | null | undefined,
  run: RunData,
  fromSheet: (field: string) => boolean,
): number[] {
  const bitmap = template.thermalRenderMode === 'bitmap-v1';
  const printerFont = usesPrinterFont(format, template);
  const items = template.elements.filter((el) => !el.isStatic && !!el.fieldName && fromSheet(el.fieldName) && (el.type === 'barcode' || (printerFont && el.type === 'text')));
  if (!items.length) return [];
  const out: number[] = [];
  for (let index = 0; index < run.sourceData.length; index++) {
    const bad = items.some((el) => {
      const value = valueFor(el, run, index);
      if (el.type === 'text') return unprintableCharacters(value).length > 0;
      const fit = barcodeFit(el as Parameters<typeof barcodeFit>[0], value, format as Parameters<typeof barcodeFit>[2], bitmap);
      return fit.level !== 'ok' && fit.reason === 'characters';
    });
    if (bad) out.push(index);
  }
  return out;
}
