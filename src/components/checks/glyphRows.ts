import type { LabelFormat, TemplateElement } from '@/lib/types';
import { checkRunBitmapGlyphs, missingGlyphs, type BitmapGlyphCheck } from '@/lib/runGlyphs';
import { resolveThermalContent } from '@/lib/thermal/bitmap';
import { barcodeValueProblem } from '@/lib/barcodeValue';
import { friendlyFieldName, spreadsheetRow } from '@/lib/fieldLabels';

/**
 * Characters a picture (bitmap) design can't draw, for the new-run Review:
 * the same check the run page uses (runGlyphs), plus the number printed
 * under a barcode, which the renderer draws in Liberation Sans and refuses
 * the same way. A value the barcode itself can't hold is left to the
 * barcode check, so a label is never named twice for one value.
 */
interface GlyphData {
  sourceData: ReadonlyArray<string | Record<string, string>>;
  fieldMappings?: Record<string, { mode: string; csvColumn?: string }> | null;
  staticValues?: Record<string, string> | null;
  mappedField?: string | null;
}

export const NO_GLYPH_PROBLEMS: BitmapGlyphCheck = { labels: [], chars: [], issues: [] };

const HUMAN_READABLE_FONT = { fontFamily: 'Liberation Sans', fontWeight: 'normal', fontStyle: 'normal' };

function rowValues(run: GlyphData, index: number): Record<string, string> {
  const values: Record<string, string> = { ...(run.staticValues || {}) };
  const row = run.sourceData[index];
  const mappings = run.fieldMappings || {};
  if (row && typeof row === 'object') {
    for (const [field, mapping] of Object.entries(mappings)) if (mapping.mode === 'column' && mapping.csvColumn) values[field] = row[mapping.csvColumn] ?? '';
  } else if (typeof row === 'string') {
    const legacy = run.mappedField ?? Object.entries(mappings).find(([, m]) => m.mode === 'column')?.[0];
    if (legacy) values[legacy] = row;
  }
  return values;
}

export function wizardGlyphCheck(
  template: { elements: ReadonlyArray<TemplateElement>; thermalRenderMode?: string | null },
  format: (Pick<LabelFormat, 'type' | 'width' | 'height'> & Partial<LabelFormat>) | null | undefined,
  run: GlyphData,
): BitmapGlyphCheck {
  if (format?.type !== 'thermal' || template.thermalRenderMode !== 'bitmap-v1') return NO_GLYPH_PROBLEMS;
  const base = checkRunBitmapGlyphs(template, format, run);
  if (base.labels.includes(0)) return base;
  const barcodes = template.elements.filter((el): el is Extract<TemplateElement, { type: 'barcode' }> => el.type === 'barcode' && !!el.showText);
  if (!barcodes.length) return base;
  const chars = new Set(base.chars);
  const labels = new Set(base.labels);
  const issues = [...base.issues];
  const missingFor = (el: Extract<TemplateElement, { type: 'barcode' }>, value: string) => {
    if (!value.trim()) return [];
    // Same rule as the run page (runGlyphs): a value the barcode can't hold is the barcode check's.
    if (barcodeValueProblem(el.barcodeFormat, value)) return [];
    return missingGlyphs(HUMAN_READABLE_FONT, value);
  };
  // A fixed barcode number: every label stops.
  const fixed: Array<{ label: number; field: string; chars: string[] }> = [];
  for (const el of barcodes.filter((b) => b.isStatic)) {
    const bad = missingFor(el, resolveThermalContent(el));
    if (bad.length) { bad.forEach((c) => chars.add(c)); fixed.push({ label: 0, field: '', chars: bad }); }
  }
  if (fixed.length) return { labels: [0], chars: [...chars], issues: fixed };
  const dynamic = barcodes.filter((b) => !b.isStatic);
  const total = Math.max(1, run.sourceData.length);
  for (let index = 0; index < total && dynamic.length; index++) {
    const values = rowValues(run, index);
    for (const el of dynamic) {
      const bad = missingFor(el, resolveThermalContent(el, values));
      if (!bad.length) continue;
      bad.forEach((c) => chars.add(c));
      labels.add(index + 1);
      if (issues.length < 50 && !issues.some((i) => i.label === index + 1 && i.field === (el.fieldName || ''))) issues.push({ label: index + 1, field: el.fieldName || '', chars: bad });
    }
  }
  return { labels: [...labels].sort((a, b) => a - b), chars: [...chars], issues: issues.sort((a, b) => a.label - b.label) };
}

function charList(chars: ReadonlyArray<string>): string {
  const names = chars.slice(0, 3).map((ch) => `“${ch}”`);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '';
  return `${list}${chars.length > 3 ? ' and others' : ''}`;
}

/** One line per label for the Review list: "Label 4 (row 5 in your file): Product Name has “龍”". */
export function glyphProblemItems(check: BitmapGlyphCheck, fromSheet: (field: string) => boolean, max = 5): { items: string[]; more: number } {
  if (check.labels.includes(0)) {
    const chars = [...new Set(check.issues.flatMap((i) => i.chars))];
    return { items: [`A fixed text on the label has ${charList(chars)}. Change it in the design.`], more: 0 };
  }
  const n = (x: number) => x.toLocaleString('en-US');
  const byLabel = new Map<number, Array<{ field: string; chars: string[] }>>();
  for (const issue of check.issues) byLabel.set(issue.label, [...(byLabel.get(issue.label) ?? []), issue]);
  const items = [...byLabel.entries()].slice(0, max).map(([label, list]) => {
    const sheet = list.some((i) => i.field && fromSheet(i.field));
    const parts = list.map((i) => `${i.field ? friendlyFieldName(i.field) : 'Text'} has ${charList(i.chars)}`).join('; ');
    return `Label ${n(label)}${sheet ? ` (row ${n(spreadsheetRow(label))} in your file)` : ''}: ${parts}`;
  });
  return { items, more: Math.max(0, check.labels.length - items.length) };
}
