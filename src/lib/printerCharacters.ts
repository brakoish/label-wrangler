import type { FieldMapping, LabelFormat, LabelTemplate, TemplateElement } from './types';
import { friendlyFieldName, spreadsheetRow } from './fieldLabels';

/**
 * Characters a thermal printer can't print on a native (Zebra font) label.
 *
 * Native labels are sent as plain printer text with no character-set
 * command, so the printer only knows plain letters, numbers and keyboard
 * symbols. Anything else ("·", "é", "°", emoji) prints as junk. The
 * generator already swaps long dashes and non-breaking spaces for plain
 * ones, so those are fine. Nothing here changes what is sent to the printer.
 */

const CONVERTED = /[‐‑‒–—− ]/;

export function isPrintableOnThermal(ch: string): boolean {
  if (ch === '\n' || ch === '\r') return true;
  if (CONVERTED.test(ch)) return true;
  const code = ch.codePointAt(0) ?? 0;
  return code >= 32 && code <= 126;
}

/** Distinct characters in `text` the printer can't print, in order. */
export function unprintableCharacters(text: string): string[] {
  const bad: string[] = [];
  for (const ch of text) if (!isPrintableOnThermal(ch) && !bad.includes(ch)) bad.push(ch);
  return bad;
}

const REPLACEMENTS: Record<string, string> = {
  '·': '-', '•': '-', '∙': '-',
  '“': '"', '”': '"', '„': '"', '″': '"', '«': '"', '»': '"',
  '‘': "'", '’': "'", '‚': "'", '′': "'",
  '…': '...', '×': 'x', '÷': '/', '½': '1/2', '¼': '1/4', '¾': '3/4',
  '°': ' deg', '™': 'TM', '®': '(R)', '©': '(C)', 'µ': 'u', 'μ': 'u',
  'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'ø': 'o', 'Ø': 'O', 'œ': 'oe', 'Œ': 'OE', 'ł': 'l', 'Ł': 'L',
  '\t': ' ', '€': 'EUR', '£': 'GBP', '¢': 'c', '≤': '<=', '≥': '>=', '±': '+/-',
};

/** A plain stand-in the printer can print ("" when there is none, e.g. emoji). */
export function plainReplacement(ch: string): string {
  if (REPLACEMENTS[ch] !== undefined) return REPLACEMENTS[ch];
  const stripped = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return stripped !== ch && unprintableCharacters(stripped).length === 0 ? stripped : '';
}

/** `text` with every character the printer can't print swapped for a plain one. */
export function plainPrinterText(text: string): string {
  let out = '';
  for (const ch of text) out += isPrintableOnThermal(ch) ? ch : plainReplacement(ch);
  return out.replace(/ {2,}/g, ' ');
}

function shown(ch: string): string {
  if (ch === '\t') return 'a tab';
  if (/\p{Extended_Pictographic}/u.test(ch)) return `the emoji ${ch}`;
  return ch;
}

function replacementWords(ch: string): string {
  const plain = plainReplacement(ch);
  if (plain === '-') return 'a plain dash';
  if (plain === ' ') return 'a space';
  if (plain === '"') return 'plain quotes (")';
  if (plain === "'") return "a plain apostrophe (')";
  if (!plain) return '';
  return plain.trim();
}

/**
 * "The printer can't print · — use a plain dash." Several characters are
 * named together: "The printer can't print · or é — use a plain dash and e."
 */
export function describeUnprintable(chars: string[]): string {
  const list = chars.slice(0, 4);
  const names = list.map(shown);
  const named = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0];
  const fixes = list.map(replacementWords).filter(Boolean);
  const unique = [...new Set(fixes)];
  const fix = unique.length === 0 ? 'take it out' : unique.length === 1 ? `use ${unique[0]}` : `use ${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
  return `The printer can't print ${named}${chars.length > 4 ? ' and some other characters' : ''} — ${fix}.`;
}

/** Whether a design's text goes to the printer as plain printer text. */
export function usesPrinterFont(format: Pick<LabelFormat, 'type'> | null | undefined, template: Pick<LabelTemplate, 'thermalRenderMode'> | null | undefined): boolean {
  return format?.type === 'thermal' && template?.thermalRenderMode !== 'bitmap-v1';
}

/** Text an item sends to the printer for `values` (prefix and suffix included). */
function printedText(el: TemplateElement, values: Record<string, string>): string {
  if (el.isStatic) return 'content' in el ? el.content || '' : '';
  const value = (el.fieldName && values[el.fieldName]) || el.defaultValue || '';
  return `${el.prefix || ''}${value}${el.suffix || ''}`;
}

/** Characters the printer can't print on one item, for the designer (sample values). */
export function elementUnprintable(el: TemplateElement, values: Record<string, string>): string[] {
  if (el.type !== 'text') return [];
  const fixed = el.isStatic ? '' : `${el.prefix || ''}${el.suffix || ''}`;
  return unprintableCharacters(`${printedText(el, values)}${fixed}`);
}

export interface PrinterCharacterIssue {
  field: string;
  /** 1-based label number; 0 for a fixed text on every label. */
  label: number;
  chars: string[];
  /** The text on the item, for naming a fixed item. */
  text: string;
}

export interface PrinterCharacterCheck {
  issues: PrinterCharacterIssue[];
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

const MAX_ISSUES = 50;

/** Every label of a run, checked for text the printer can't print. */
export function checkRunPrinterCharacters(template: Pick<LabelTemplate, 'elements' | 'thermalRenderMode'>, format: Pick<LabelFormat, 'type'> | null | undefined, run: RunData): PrinterCharacterCheck {
  const issues: PrinterCharacterIssue[] = [];
  if (!usesPrinterFont(format, template)) return { issues, badLabels: 0 };
  const texts = template.elements.filter((el) => el.type === 'text');
  const total = Math.max(1, run.sourceData.length);
  let badLabels = 0;
  for (const el of texts.filter((t) => t.isStatic)) {
    const chars = unprintableCharacters(printedText(el, {}));
    if (chars.length) { issues.push({ field: '', label: 0, chars, text: printedText(el, {}) }); badLabels = total; }
  }
  const dynamic = texts.filter((t) => !t.isStatic);
  if (!dynamic.length) return { issues, badLabels };
  let rowBad = 0;
  for (let index = 0; index < total; index++) {
    const values = valuesFor(run, index);
    let bad = false;
    for (const el of dynamic) {
      const chars = unprintableCharacters(printedText(el, values));
      if (!chars.length) continue;
      bad = true;
      if (issues.length < MAX_ISSUES && !issues.some((i) => i.label === index + 1 && i.field === el.fieldName)) issues.push({ field: el.fieldName || '', label: index + 1, chars, text: '' });
    }
    if (bad) rowBad++;
  }
  return { issues, badLabels: Math.max(badLabels, rowBad) };
}

/**
 * "Label 5 (row 6), Strain: the printer can't print é — use e." A fixed text
 * is named by its words and fixed in the design.
 */
export function describePrinterCharacterIssue(issue: PrinterCharacterIssue, fromSpreadsheet: boolean): string {
  const advice = describeUnprintable(issue.chars);
  const sentence = advice.charAt(0).toLowerCase() + advice.slice(1);
  if (!issue.label) {
    const words = issue.text.trim();
    return `The text “${words.length > 24 ? `${words.slice(0, 23)}…` : words}” on every label: ${sentence} Change it in the design.`;
  }
  const where = fromSpreadsheet ? `Label ${issue.label.toLocaleString()} (row ${spreadsheetRow(issue.label).toLocaleString()})` : `Label ${issue.label.toLocaleString()}`;
  return `${where}, ${friendlyFieldName(issue.field)}: ${sentence}`;
}

/** "1–6", "3, 5, 9–12", "3, 5, 9 and 4 more": label numbers as short ranges. */
function numberRanges(numbers: number[], shown = 3): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  for (const n of sorted) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n; else runs.push([n, n]);
  }
  const words = runs.map(([a, b]) => (a === b ? a.toLocaleString() : `${a.toLocaleString()}–${b.toLocaleString()}`));
  const rest = runs.slice(shown).reduce((sum, [a, b]) => sum + (b - a + 1), 0);
  return rest > 0 ? `${words.slice(0, shown).join(', ')} and ${rest.toLocaleString()} more` : words.join(', ');
}

/**
 * The same problems said once per part and character, not once per label:
 * "Labels 1–6 (rows 2–7), Item: the printer can't print × — use x." A
 * problem on one label, or a fixed text, reads as describePrinterCharacterIssue.
 * `more` counts the lines left out after `shown`.
 */
export function summarizePrinterCharacterIssues(issues: ReadonlyArray<PrinterCharacterIssue>, fromSpreadsheet: (field: string) => boolean, shown = 5): { items: string[]; more: number } {
  const groups = new Map<string, PrinterCharacterIssue[]>();
  issues.forEach((issue, index) => {
    const key = issue.label ? `${issue.field}\n${issue.chars.join('')}` : `fixed\n${index}`;
    groups.set(key, [...(groups.get(key) ?? []), issue]);
  });
  const lines = [...groups.values()].map((group) => {
    const first = group[0];
    const sheet = fromSpreadsheet(first.field);
    if (group.length === 1) return describePrinterCharacterIssue(first, sheet);
    const labels = group.map((issue) => issue.label);
    const advice = describeUnprintable(first.chars);
    const sentence = advice.charAt(0).toLowerCase() + advice.slice(1);
    const rows = sheet ? ` (rows ${numberRanges(labels.map(spreadsheetRow))})` : '';
    return `Labels ${numberRanges(labels)}${rows}, ${friendlyFieldName(first.field)}: ${sentence}`;
  });
  return { items: lines.slice(0, shown), more: Math.max(0, lines.length - shown) };
}
