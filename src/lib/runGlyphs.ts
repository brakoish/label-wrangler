import { friendlyFieldName, spreadsheetRow } from './fieldLabels';
import { barcodeValueProblem } from './barcodeValue';
import type { BarcodeFormat } from './types';

/**
 * Which characters the exact (bitmap) renderer can draw: the bundled
 * Liberation fonts in assets/thermal-fonts, read with the same cmap rule as
 * the server's renderer (it refuses a character its font has no glyph for).
 * Generated from the font files; scripts/production/test-run-b15.cjs checks
 * every table against them, so a font change can't leave this behind.
 * Ranges: "start-length" in base 36, space separated.
 */
const TABLES: string[] = [
  'w-2m 4g-ba fs-8n ok-1 oq-4 p0-6 p8 pa-j pv-17 r4-8z 10a-3 13l-1i 15c-q 168-4 5q8-5m 5xa-4d 61q 61s-2h 64g-l 654-5 65c-11 66g-5 66o-7 66x 66z 671 673-u 680-1g 69i-e 69y-d 6ae-5 6al-i 6b6-2 6ba-8 6br 6bw-4 6c2-3 6c7-b 6cm 6cq-4 6cw 6cy-2 6d5-1 6d8 6da 6dg 6e6 6ei-5 6es-5 6f3-a 6fk-4 6g0-l 6gv 6i8 6it 6j7 6ja-1 6jm 6jq 6jy 6kt-1 6kz-1 6l7-3 6mc 6mo-5 6nc 6ok 6pu 6py 6q7 6q9-1 6qd 6qh-1 6qm-1 6qx 6qz 6rs 6sg-2 6sk-1 6wy 6xc 6xs-1 7b4 7b6 7bg 7bk 7bo 7bs 7bw 7c4 7cc 7ck 7cs 7dc-s 7eo 7es 7ew 7f0 7f4-3 7fk-1 7fu-2 7g2 7ga 7gc 7gk 7gq-2 7gv-a 7hi 7ju-2 7k0 7k2 7kw 7kz 7l1-1 7l5-3 7lb 8rk-d 8s1-6 93r x07-a x3c-4 1dkx-1 1dlp-p 1dmg-4 1dmm 1dmo-1 1dmr-1 1dmu-9 1e74-3',
  'w-2m 4g-jz ok-1 oq-4 p0-6 p8 pa-j pv-17 r4-8z 10a-3 13l-1i 15c-q 168-4 5q8-5m 5xa-4d 61q 61s-2h 64g-l 654-5 65c-11 66g-5 66o-7 66x 66z 671 673-u 680-1g 69i-e 69y-d 6ae-5 6al-i 6b6-2 6ba-8 6bk-g 6c2-g 6cm 6cq-6 6cy-2 6d5-1 6d8 6da 6dg 6e6 6ei-5 6es-5 6f3-a 6fk-4 6g0-l 6gv 6i8 6it 6j7 6ja-1 6jm 6jq 6jy 6kt-1 6kz-1 6l7-3 6mc 6mo-5 6nc 6ok 6pu 6py 6q7 6q9-1 6qd 6qh-1 6qm-1 6qx 6qz 6rs 6sg-2 6sk-1 6wy 6xc 6xs-1 7b4 7b6 7bg 7bk 7bo 7bs 7bw 7c4 7cc 7ck 7cs 7dc-s 7eo 7es 7ew 7f0 7f4-3 7fk-1 7fu-2 7g2 7ga 7gc 7gk 7gq-2 7gv-a 7hi 7ju-2 7jz-8 7kw 7kz 7l1-1 7l5-3 7lb 8rk-d 8s1-6 93r x07-a x3c-4 1dkx-1 1dlp-p 1dmg-4 1dmm 1dmo-1 1dmr-1 1dmu-9 1e74-3 1ekc',
  'w-2m 4g-jz ok-1 oq-4 p0-6 p8 pa-j pv-17 r4-8z 10a-3 13l-1i 15c-q 168-4 5q8-5m 5xa-4d 61q 61s-2h 64g-l 654-5 65c-11 66g-5 66o-7 66x 66z 671 673-u 680-1g 69i-e 69y-d 6ae-5 6al-i 6b6-2 6ba-8 6bk-g 6c2-g 6cm 6cq-6 6cy-2 6d5-1 6d8 6da 6dg 6e6 6ei-5 6es-5 6f3-a 6fk-4 6g0-l 6gv 6i8 6it 6j7 6ja-1 6jm 6jq 6jy 6kt-1 6kz-1 6l7-3 6mc 6mo-5 6nc 6ok 6pu 6py 6q7 6q9-1 6qd 6qh-1 6qm-1 6qx 6qz 6rs 6sg-2 6sk-1 6wy 6xc 6xs-1 7b4 7b6 7bg 7bk 7bo 7bs 7bw 7c4 7cc 7ck 7cs 7dc-s 7eo 7es 7ew 7f0 7f4-3 7fk-1 7fu-2 7g2 7ga 7gc 7gk 7gq-2 7gv-a 7hi 7ju-2 7k0 7k2 7kw 7kz 7l1-1 7l5-3 7lb 8rk-d 8s1-6 93r x07-a x3c-4 1bes 1dkx-1 1dlp-p 1dmg-4 1dmm 1dmo-1 1dmr-1 1dmu-9 1e74-3 1ekc',
  'w-2m 4g-jz ok-1 oq-4 p0-6 p8 pa-j pv-17 r4-8z 10a-3 13l-1i 15c-q 168-4 5q8-5m 5xa-4d 61q 61s-2h 64g-l 654-5 65c-11 66g-5 66o-7 66x 66z 671 673-u 680-1g 69i-e 69y-d 6ae-5 6al-i 6b6-2 6ba-8 6bk-g 6c2-g 6cm 6cq-6 6cy-2 6d5-1 6d8 6da 6dg 6e6 6ei-5 6es-5 6f3-a 6fk-4 6g0-l 6gv 6i8 6it 6j7 6ja-1 6jm 6jq 6jy 6kt-1 6kz-1 6l7-3 6mc 6mo-5 6nc 6ok 6pu 6py 6q7 6q9-1 6qd 6qh-1 6qm-1 6qx 6qz 6rs 6sg-2 6sk-1 6wy 6xc 6xs-1 7b4 7b6 7bg 7bk 7bo 7bs 7bw 7c4 7cc 7ck 7cs 7dc-s 7eo 7es 7ew 7f0 7f4-3 7fk-1 7fu-2 7g2 7ga 7gc 7gk 7gq-2 7gv-a 7hi 7ju-2 7k0 7k2 7kw 7kz 7l1-1 7l5-3 7lb 8rk-d 8s1-6 93r x07-a x3c-4 1bes-1 1dkx-1 1dlp-p 1dmg-4 1dmm 1dmo-1 1dmr-1 1dmu-9 1e74-3 1ekc',
  'w-2m 4g-jz ok-1 oq-4 p0-6 p8 pa-j pv-17 r4-8z 10a-3 13l-1i 15c-q 168-4 5q8-5m 5xa-4d 61q 61s-2h 64g-l 654-5 65c-11 66g-5 66o-7 66x 66z 671 673-u 680-1g 69i-e 69y-d 6ae-5 6al-i 6b6-2 6ba-8 6bk-g 6c2-g 6cm 6cq-6 6cy-2 6d5-1 6d8 6da 6dg 6e6 6ei-5 6es-5 6f3-a 6fk-4 6g0-l 6gv 6i8 6it 6j7 6ja-1 6jm 6jq 6jy 6kt-1 6kz-1 6l7-3 6mc 6mo-5 6nc 6ok 6pu 6py 6q7 6q9-1 6qd 6qh-1 6qm-1 6qx 6qz 6rs 6sg-2 6sk-1 6wy 6xc 6xs-1 7b4 7b6 7bg 7bk 7bo 7bs 7bw 7c4 7cc 7ck 7cs 7dc-s 7eo 7es 7ew 7f0 7f4-3 7fk-1 7fu-2 7g2 7ga 7gc 7gk 7gq-2 7gv-a 7hi 7ju-2 7k0 7k2 7kw 7kz 7l1-1 7l5-3 7lb 8rk-d 8s1-6 93r x07-a x3c-4 1bep-1 1bes-1 1bey-4 1dkx-1 1dlp-p 1dmg-4 1dmm 1dmo-1 1dmr-1 1dmu-9 1e74-3 1ekc',
];
const FONT_TABLE: Record<string, number> = {"Mono-Bold":0,"Mono-BoldItalic":0,"Mono-Italic":0,"Mono-Regular":0,"Sans-Bold":1,"Sans-BoldItalic":1,"Sans-Italic":1,"Sans-Regular":1,"Serif-Bold":2,"Serif-BoldItalic":3,"Serif-Italic":4,"Serif-Regular":2};
const decoded = new Map<number, Array<[number, number]>>();
function ranges(index: number): Array<[number, number]> {
  let out = decoded.get(index);
  if (!out) {
    out = TABLES[index].split(' ').map((part) => {
      const [a, len] = part.split('-');
      const start = parseInt(a, 36);
      return [start, start + (len ? parseInt(len, 36) : 0)] as [number, number];
    });
    decoded.set(index, out);
  }
  return out;
}

const FAMILIES: Record<string, string> = { 'Liberation Sans': 'Sans', 'Liberation Serif': 'Serif', 'Liberation Mono': 'Mono' };

/** The bundled font file a text item is drawn with (as the renderer picks it), or null for a font it doesn't bundle. */
export function bitmapFontKey(el: { fontFamily?: string; fontWeight?: string; fontStyle?: string }): string | null {
  const family = FAMILIES[el.fontFamily ?? ''];
  if (!family) return null;
  const style = `${el.fontWeight === 'bold' ? 'Bold' : ''}${el.fontStyle === 'italic' ? 'Italic' : ''}` || 'Regular';
  return `${family}-${style}`;
}

/** True when the bundled font `key` has a glyph for this character. */
export function fontHasGlyph(key: string, ch: string): boolean {
  const index = FONT_TABLE[key];
  if (index === undefined) return true;
  const cp = ch.codePointAt(0) ?? 0;
  let lo = 0, hi = ranges(index).length - 1;
  const list = ranges(index);
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < list[mid][0]) hi = mid - 1; else if (cp > list[mid][1]) lo = mid + 1; else return true;
  }
  return false;
}

/** Characters of `text` (spaces aside) that the item's bundled font can't draw, each once. */
export function missingGlyphs(el: { fontFamily?: string; fontWeight?: string; fontStyle?: string }, text: string): string[] {
  const key = bitmapFontKey(el);
  if (!key) return [];
  const out: string[] = [];
  for (const ch of text) if (!/\s/.test(ch) && !fontHasGlyph(key, ch) && !out.includes(ch)) out.push(ch);
  return out;
}

interface GlyphRunData {
  sourceData: ReadonlyArray<string | Record<string, string>>;
  fieldMappings?: Record<string, { mode: string; csvColumn?: string }> | null;
  staticValues?: Record<string, string> | null;
  mappedField?: string | null;
}
type GlyphElement = { id: string; type: string; showText?: boolean; barcodeFormat?: BarcodeFormat; isStatic?: boolean; fieldName?: string; defaultValue?: string; prefix?: string; suffix?: string; content?: string; fontFamily?: string; fontWeight?: string; fontStyle?: string };

function valuesFor(run: GlyphRunData, index: number): Record<string, string> {
  const values: Record<string, string> = { ...(run.staticValues || {}) };
  const row = run.sourceData[index];
  const mappings = run.fieldMappings || {};
  if (row && typeof row === 'object') {
    for (const [field, mapping] of Object.entries(mappings)) if (mapping.mode === 'column' && mapping.csvColumn) values[field] = (row as Record<string, string>)[mapping.csvColumn] ?? '';
  } else if (typeof row === 'string') {
    const legacy = run.mappedField ?? Object.entries(mappings).find(([, m]) => m.mode === 'column')?.[0];
    if (legacy) values[legacy] = row;
  }
  return values;
}

export interface BitmapGlyphCheck {
  /** Labels (1-based) the renderer refuses; [0] when a fixed text stops every label. */
  labels: number[];
  /** Every character it can't draw, each once. */
  chars: string[];
  /** The first 50 problems: label (0 for a fixed text), field and characters. */
  issues: Array<{ label: number; field: string; chars: string[] }>;
}

/**
 * Text on a picture (bitmap) design that the renderer refuses to draw (its
 * bundled font has no glyph for a character). Every label is checked: the
 * server refuses these, so they stop a send before the tap instead of failing
 * after it. Native ZPL designs are never stopped (the printer prints a box).
 */
export function checkRunBitmapGlyphs(template: { elements: ReadonlyArray<GlyphElement>; thermalRenderMode?: string | null }, format: { type?: string } | null | undefined, run: GlyphRunData): BitmapGlyphCheck {
  const result: BitmapGlyphCheck = { labels: [], chars: [], issues: [] };
  if (format?.type !== 'thermal' || template.thermalRenderMode !== 'bitmap-v1') return result;
  // A barcode's human-readable line is drawn too, always in Liberation Sans
  // Regular (as the renderer draws it), so it is checked like a text.
  const BARCODE_TEXT_FONT = { fontFamily: 'Liberation Sans', fontWeight: 'normal', fontStyle: 'normal' };
  const texts = template.elements.flatMap((el) => el.type === 'text' ? [el] : el.type === 'barcode' && el.showText ? [{ ...el, ...BARCODE_TEXT_FONT }] : []);
  // A value the barcode itself can't hold is the barcode check's to name, so
  // one value is never named twice (and the barcode check's own wording wins).
  const barcodeOwns = (el: GlyphElement, value: string) => el.type === 'barcode' && !!barcodeValueProblem(el.barcodeFormat, value);
  const chars = new Set<string>();
  for (const el of texts.filter((t) => t.isStatic)) {
    const content = el.content ?? '';
    const bad = content.trim() && !barcodeOwns(el, content) ? missingGlyphs(el, content) : [];
    if (bad.length) { bad.forEach((c) => chars.add(c)); result.issues.push({ label: 0, field: '', chars: bad }); }
  }
  if (result.issues.length) return { ...result, labels: [0], chars: [...chars] };
  const dynamic = texts.filter((t) => !t.isStatic);
  const total = Math.max(1, run.sourceData.length);
  for (let index = 0; index < total && dynamic.length; index++) {
    const values = valuesFor(run, index);
    let bad = false;
    for (const el of dynamic) {
      const value = `${el.prefix || ''}${(el.fieldName && values[el.fieldName]) || el.defaultValue || ''}${el.suffix || ''}`;
      if (!value.trim() || barcodeOwns(el, value)) continue;
      const missing = missingGlyphs(el, value);
      if (!missing.length) continue;
      bad = true;
      missing.forEach((c) => chars.add(c));
      if (result.issues.length < 50) result.issues.push({ label: index + 1, field: el.fieldName || '', chars: missing });
    }
    if (bad) result.labels.push(index + 1);
  }
  return { ...result, chars: [...chars] };
}

function charWords(chars: ReadonlyArray<string>): string {
  const names = chars.slice(0, 3).map((ch) => `“${ch}”`);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '';
  return `${list}${chars.length > 3 ? ' and others' : ''}`;
}

/**
 * The stop said plainly, for the labels of one send: "Label 12 (row 13 in
 * your file) has “✓” in Strain, which can’t be drawn, so it can’t print."
 * The row is named beside the label, so nobody wonders why they differ (the
 * file's first row is its column names). `labels` is the part of
 * check.labels in the send.
 */
export function glyphStopWords(check: BitmapGlyphCheck, labels: ReadonlyArray<number>, fromSheet: (field: string) => boolean): string {
  if (!labels.length) return '';
  const n = (x: number) => x.toLocaleString('en-US');
  if (labels.includes(0)) {
    const chars = check.issues.flatMap((i) => i.chars);
    return `A fixed text on the label has ${charWords([...new Set(chars)])}, which can’t be drawn, so nothing can print. Change it in the design.`;
  }
  if (labels.length === 1) {
    const issue = check.issues.find((i) => i.label === labels[0]);
    if (issue) {
      const row = issue.field && fromSheet(issue.field) ? ` (row ${n(spreadsheetRow(issue.label))} in your file)` : '';
      return `Label ${n(issue.label)}${row} has ${charWords(issue.chars)} in ${issue.field ? friendlyFieldName(issue.field) : 'its text'}, which can’t be drawn, so it can’t print.`;
    }
  }
  const shown = check.issues.filter((i) => labels.includes(i.label));
  const chars = shown.length ? [...new Set(shown.flatMap((i) => i.chars))] : check.chars;
  const which = labels.length === 1 ? `Label ${n(labels[0])}` : `Labels ${labels.slice(0, 3).map(n).join(', ')}${labels.length > 3 ? ` and ${n(labels.length - 3)} more` : ''}`;
  return `${which} ${labels.length === 1 ? 'has' : 'have'} ${charWords(chars)}, which can’t be drawn, so ${labels.length === 1 ? 'it' : 'they'} can’t print.`;
}
