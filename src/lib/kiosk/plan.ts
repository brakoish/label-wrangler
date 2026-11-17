/**
 * Kiosk mode's own rules, with no browser or database in them so they can be
 * tested on their own. The kiosk prints through the same office printer path
 * as New run and the run page (POST /api/office/jobs, one saved key per send);
 * nothing here changes what the server checks or what the printer receives.
 */
import type { FieldMapping, LabelFormat, LabelTemplate } from '../types';
import { MANIFEST_FIELDS } from '../manifestFields';
import { codeFieldTypes } from '../runCodeColumns';
import { checkRunData, dynamicFieldNames } from '../runDataCheck';
import { friendlyFieldName } from '../fieldLabels';
import { jobNeedsCheck, officeSendParts, type OfficeSpan } from '../officeRange';
import { checkRunBarcodes } from '../barcodeCheck';
import { findBestHeaderForField } from './fieldMatch';

/** Labels in the test print staff check before the rest prints. */
export const KIOSK_TEST_LABELS = 12;
/** The most labels one run holds (the existing run limit in src/lib/validation.ts). Not a kiosk cap. */
export const KIOSK_RUN_LIMIT = 100_000;
/** The reason saved with a reprint started at the kiosk (the server keeps it with the send). */
export const KIOSK_REPRINT_REASON = 'Reprint from the kiosk';

// --- How many -----------------------------------------------------------------

/** What staff typed in the "How many labels?" box: a whole number, 1 or more. */
export function parseQuantity(text: string): { value: number | null; error: string } {
  const clean = String(text ?? '').replace(/[\s,]/g, '');
  if (!clean) return { value: null, error: 'Type how many labels you need.' };
  if (!/^\d+$/.test(clean)) return { value: null, error: 'Type a whole number, like 24.' };
  const value = Number(clean);
  if (!Number.isSafeInteger(value) || value < 1) return { value: null, error: 'Type a number of 1 or more.' };
  if (value > KIOSK_RUN_LIMIT) return { value: null, error: `One print can hold up to ${KIOSK_RUN_LIMIT.toLocaleString('en-US')} labels. Print the rest as a second print.` };
  return { value, error: '' };
}

/**
 * Labels in the test print: the first 12, or all of them when there are 12 or
 * fewer. On a roll with several labels across it rounds up to a whole row, so
 * the rest never starts halfway along a row and leaves blank labels.
 */
export function kioskTestCount(total: number, across = 1): number {
  const lanes = Math.max(1, Math.floor(across) || 1);
  const count = Math.max(0, Math.floor(total) || 0);
  return Math.min(count, Math.ceil(KIOSK_TEST_LABELS / lanes) * lanes);
}

/**
 * The test print (labels 1..t) and the rest (t+1..total) in sends the office
 * printer takes (`cap` labels at most, whole rows only). No rest when the test
 * is the whole print.
 */
export function kioskSplit(total: number, cap: number, across = 1): { test: OfficeSpan; rest: OfficeSpan[] } {
  const t = kioskTestCount(total, across);
  return { test: { from: 1, to: t }, rest: t < total ? officeSendParts(t + 1, total, cap, across) : [] };
}

// --- Categories -----------------------------------------------------------------

/** The plain product categories the owner puts designs in. */
export const KIOSK_CATEGORIES = ['Flower', 'Pre-roll', 'Edible', 'Vape', 'Concentrate', 'Shake/Trim', 'Other'] as const;
export type KioskCategory = (typeof KIOSK_CATEGORIES)[number];

/**
 * A Metrc product category name ("Infused Liquid Edible - Each") as one plain
 * category. Infused flower is Flower, liquid edibles are Edible; anything not
 * known is Other.
 */
export function plainCategory(name: string | null | undefined): KioskCategory {
  const n = String(name ?? '').toLowerCase();
  if (!n.trim()) return 'Other';
  if (/pre-?\s?roll/.test(n)) return 'Pre-roll';
  if (/shake|trim/.test(n)) return 'Shake/Trim';
  if (/vape|cartridge/.test(n)) return 'Vape';
  if (/non-?\s?edible/.test(n)) return 'Other';
  if (/edible|beverage/.test(n)) return 'Edible';
  if (/concentrate|extract|kief|hash|rosin/.test(n)) return 'Concentrate';
  if (/flower|\bbuds?\b/.test(n)) return 'Flower';
  return 'Other';
}

/** The product's plain category, or null when Manifest didn't say (then nothing is filtered). */
export function productCategory(row: Record<string, string> | null | undefined): KioskCategory | null {
  const raw = String(row?.category ?? '').trim();
  return raw ? plainCategory(raw) : null;
}

/** Only known categories, each once, in the list's order. */
export function cleanCategories(input: unknown): KioskCategory[] {
  if (!Array.isArray(input)) return [];
  const wanted = new Set(input.filter((c): c is string => typeof c === 'string'));
  return KIOSK_CATEGORIES.filter((c) => wanted.has(c));
}

/** A brand name as compared: case, spacing and accents don't matter. */
export function brandKey(name: string | null | undefined): string {
  return String(name ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Brand names as saved: trimmed, each once (by brandKey), at most 20, each at most 100 characters. */
export function cleanBrands(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, 100);
    const key = brandKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push(name);
    if (out.length >= 20) break;
  }
  return out;
}

/** What the kiosk knows about each design: its product kinds and, optionally, the only brands it is for. */
export interface KioskRules {
  categories: Readonly<Record<string, ReadonlyArray<string>>>;
  brands: Readonly<Record<string, ReadonlyArray<string>>>;
}

/**
 * May this design print for a product of this kind and brand? Strict: the
 * design must be set for the kind (a design with no kind is for no product
 * on the kiosk), and a design limited to brands only fits those brands.
 * The kiosk screen and the server use this same rule.
 */
export function kioskDesignFits(id: string, rules: KioskRules, category: KioskCategory | null, brand: string | null | undefined): boolean {
  if (!category || !rules.categories[id]?.includes(category)) return false;
  const limit = rules.brands[id] ?? [];
  return !limit.length || limit.some((b) => brandKey(b) === brandKey(brand));
}

/** Why a kiosk product has no labels: the kind is unknown, nothing is set for the kind, or nothing for the brand. */
export type KioskMatchGap = 'no-category' | 'none-for-category' | 'none-for-brand' | null;

/**
 * The kiosk's labels for a product, strictly: only designs set for its kind
 * (and brand, where a design is limited to brands). Brand-specific labels come
 * first, then the one used last for this product. Nothing else is ever shown,
 * so staff can't pick a label meant for another kind of product.
 * `untyped`: kiosk designs with no kind yet (offered to no product).
 */
export function kioskDesignsFor<T extends { id: string }>(designs: ReadonlyArray<T>, rules: KioskRules, category: KioskCategory | null, brand: string | null | undefined, lastUsedId?: string | null): { shown: T[]; gap: KioskMatchGap; untyped: T[] } {
  const untyped = designs.filter((d) => !rules.categories[d.id]?.length);
  if (!category) return { shown: [], gap: 'no-category', untyped };
  const forKind = designs.filter((d) => rules.categories[d.id]?.includes(category));
  if (!forKind.length) return { shown: [], gap: 'none-for-category', untyped };
  const fit = forKind.filter((d) => kioskDesignFits(d.id, rules, category, brand));
  if (!fit.length) return { shown: [], gap: 'none-for-brand', untyped };
  const rank = (d: T) => (d.id === lastUsedId ? 0 : 2) + ((rules.brands[d.id]?.length ?? 0) > 0 ? 0 : 1);
  const shown = fit.map((d, i) => ({ d, i })).sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i).map(({ d }) => d);
  return { shown, gap: null, untyped };
}

/** For a manager: how many kiosk labels each kind of product has, and the kiosk labels with no kind. */
export function kioskCoverage(ids: ReadonlyArray<string>, rules: KioskRules): { counts: Record<KioskCategory, number>; untyped: string[] } {
  const counts = Object.fromEntries(KIOSK_CATEGORIES.map((c) => [c, 0])) as Record<KioskCategory, number>;
  const untyped: string[] = [];
  for (const id of ids) {
    const kinds = cleanCategories(rules.categories[id] ?? []);
    if (!kinds.length) untyped.push(id);
    for (const kind of kinds) counts[kind] += 1;
  }
  return { counts, untyped };
}

/**
 * New run's design list for a product: designs put in its category first,
 * the rest after. `matching` is empty when no design is in that category.
 */
export function designsInCategoryFirst<T extends { id: string }>(designs: ReadonlyArray<T>, categories: Readonly<Record<string, ReadonlyArray<string>>>, category: KioskCategory | null): { matching: T[]; rest: T[] } {
  if (!category) return { matching: [], rest: [...designs] };
  const matching = designs.filter((d) => categories[d.id]?.includes(category));
  const ids = new Set(matching.map((d) => d.id));
  return { matching, rest: designs.filter((d) => !ids.has(d.id)) };
}

// --- Filling a design from a product ------------------------------------------

const HEADERS: string[] = [...MANIFEST_FIELDS];
/** Details that are different on every unit of a package (Metrc retail IDs). */
const PER_UNIT_COLUMNS = new Set(['retailId', 'unitIndex']);

/** A Manifest package's identity, as New run groups its rows. */
export function packageKey(row: Record<string, string> | null | undefined): string {
  if (!row) return '';
  return row.packageTag || row.tag || row.id || `${row.itemName ?? ''}-${row.batch ?? ''}`;
}

/** Each part of the design matched to a Manifest detail, the way New run matches them automatically. */
export function kioskMappings(template: Pick<LabelTemplate, 'elements'>, rows: Record<string, string>[]): Record<string, FieldMapping> {
  const types = codeFieldTypes(template);
  const out: Record<string, FieldMapping> = {};
  for (const field of dynamicFieldNames(template)) {
    const column = findBestHeaderForField(field, HEADERS, rows, types[field]);
    out[field] = column ? { mode: 'column', csvColumn: column } : { mode: 'static' };
  }
  return out;
}

function mappedColumns(mappings: Record<string, FieldMapping>): string[] {
  return Array.from(new Set(Object.values(mappings).filter((m) => m.mode === 'column' && m.csvColumn).map((m) => m.csvColumn as string)));
}
function compact(row: Record<string, string>, columns: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of columns) out[c] = typeof row?.[c] === 'string' ? row[c] : '';
  return out;
}

/** Mapped details that change from unit to unit: then each label needs its own unit. */
export function perUnitColumns(mappings: Record<string, FieldMapping>, rows: Record<string, string>[]): string[] {
  return mappedColumns(mappings).filter((c) => PER_UNIT_COLUMNS.has(c) || rows.some((r) => (r?.[c] ?? '') !== (rows[0]?.[c] ?? '')));
}

export interface KioskDesignCheck {
  /** False: this design can't print for this product (see `missing` and `barcodeProblem`). */
  usable: boolean;
  /** A barcode on the design can't hold this product's details (New run would stop for a fix too). */
  barcodeProblem: boolean;
  /** Parts with no value that would print the design's sample or can't print empty (barcodes, QR codes). */
  missing: string[];
  /** Parts with no value that simply print empty. */
  leftBlank: string[];
  /** Each label needs its own unit (a code that's different on every unit). */
  perUnit: boolean;
  /** Units in the package (Manifest sends one row per unit). */
  units: number;
  mappings: Record<string, FieldMapping>;
}

type KioskTemplate = Pick<LabelTemplate, 'elements'> & Partial<Pick<LabelTemplate, 'thermalRenderMode'>>;
type KioskFormat = Pick<LabelFormat, 'type'> & Partial<LabelFormat>;

/**
 * Whether a kiosk design can print for this product, checked like New run
 * checks a run: blank values, and (with the label size) every barcode's value.
 */
export function kioskDesignCheck(template: KioskTemplate, rows: Record<string, string>[], format?: KioskFormat | null): KioskDesignCheck {
  const mappings = kioskMappings(template, rows);
  const perUnit = rows.length > 0 && perUnitColumns(mappings, rows).length > 0;
  const columns = mappedColumns(mappings);
  const sample = (perUnit ? rows : rows.slice(0, 1)).map((r) => compact(r, columns));
  const runData = { sourceData: sample.length ? sample : [{}], fieldMappings: mappings, staticValues: {} };
  const check = checkRunData(template, runData);
  const names = check.issues.map((issue) => friendlyFieldName(issue.field));
  const barcodeProblem = rows.length > 0 && !!format && checkRunBarcodes(template, runData, format as LabelFormat).issues.length > 0;
  const blanksOk = check.issues.length === 0 || check.canLeaveBlank;
  const usable = rows.length > 0 && blanksOk && !barcodeProblem;
  return { usable, barcodeProblem, missing: blanksOk ? [] : names, leftBlank: blanksOk ? names : [], perUnit, units: rows.length, mappings };
}

/** Why a design can't print for this product, in plain words (empty when it can). */
export function kioskDesignProblem(check: Pick<KioskDesignCheck, 'usable' | 'barcodeProblem' | 'missing' | 'units'>): string {
  if (check.usable) return '';
  if (!check.units) return 'This product has no details to print. Search for it again.';
  if (check.missing.length) return `This product is missing ${check.missing.join(', ')}, so this label can’t print. Ask a manager.`;
  if (check.barcodeProblem) return 'A barcode on this label can’t hold this product’s details. Ask a manager.';
  return 'This label can’t print for this product. Ask a manager.';
}

/** One label's values (what the printer fills in), from the run's mappings and a row. */
export function kioskLabelValues(mappings: Record<string, FieldMapping>, staticValues: Record<string, string>, row: Record<string, string> | undefined): Record<string, string> {
  const values: Record<string, string> = { ...staticValues };
  for (const [field, mapping] of Object.entries(mappings)) {
    if (mapping.mode === 'column' && mapping.csvColumn) values[field] = row?.[mapping.csvColumn] ?? '';
  }
  return values;
}

export type KioskRunData =
  | { ok: true; sourceData: Record<string, string>[]; fieldMappings: Record<string, FieldMapping>; staticValues: Record<string, string>; perUnit: boolean }
  | { ok: false; message: string };

/**
 * The run's rows for `quantity` labels of this product: the product's details
 * on every label, or, for a design with a code that's different on every unit,
 * one unit per label (so no unit's code is printed twice).
 */
export function kioskRunData(template: KioskTemplate, rows: Record<string, string>[], quantity: number, format?: KioskFormat | null): KioskRunData {
  if (!rows.length) return { ok: false, message: 'This product has no details to print. Search for it again.' };
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > KIOSK_RUN_LIMIT) return { ok: false, message: 'Choose how many labels: a whole number of 1 or more.' };
  const check = kioskDesignCheck(template, rows, format);
  if (!check.usable) return { ok: false, message: kioskDesignProblem(check) };
  const columns = mappedColumns(check.mappings);
  if (check.perUnit && quantity > rows.length) {
    return { ok: false, message: `This label has a code that’s different on every unit, and this product has ${rows.length.toLocaleString('en-US')} unit${rows.length === 1 ? '' : 's'}. Print up to ${rows.length.toLocaleString('en-US')}.` };
  }
  const sourceData = check.perUnit ? rows.slice(0, quantity).map((r) => compact(r, columns)) : Array.from({ length: quantity }, () => compact(rows[0], columns));
  return { ok: true, sourceData, fieldMappings: check.mappings, staticValues: {}, perUnit: check.perUnit };
}

/** "Blue Dream 3.5g - 11/16/26 (kiosk)", like New run's automatic name. */
export function kioskRunName(productName: string, date = new Date()): string {
  const name = String(productName ?? '').trim().slice(0, 200) || 'Kiosk print';
  return `${name} - ${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(-2)} (kiosk)`;
}

// --- Where a kiosk print is ------------------------------------------------------

export interface KioskJob { requestId?: string; from: number; to: number; state: string; review?: boolean; reason?: string | null; count?: number }
export interface KioskFlowState {
  total: number;
  testTo: number;
  /** Office sends made for the test print, and for the rest. */
  testIds: ReadonlyArray<string>;
  restIds: ReadonlyArray<string>;
  /** The sends the rest goes in, in order (none when the test is the whole print). */
  restPlan: ReadonlyArray<OfficeSpan>;
  approved: boolean;
  stopped: boolean;
}
export type KioskPhase = 'send-test' | 'test-waiting' | 'test-printing' | 'review' | 'send-rest' | 'rest-waiting' | 'rest-printing' | 'done' | 'stopped' | 'needs-check' | 'cancelled';
type GroupState = 'none' | 'waiting' | 'printing' | 'done' | 'needs-check' | 'cancelled';

function groupState(ids: ReadonlyArray<string>, jobs: ReadonlyArray<KioskJob>): GroupState {
  if (!ids.length) return 'none';
  const mine = jobs.filter((j) => j.requestId && ids.includes(j.requestId));
  if (mine.some(jobNeedsCheck)) return 'needs-check';
  if (mine.some((j) => j.state === 'cancelled' || j.state === 'resolved')) return 'cancelled';
  // A send not listed yet (the list is read every few seconds) is still on its way.
  if (ids.some((id) => !mine.some((j) => j.requestId === id))) return 'waiting';
  if (mine.every((j) => j.state === 'sent_to_printer')) return 'done';
  if (mine.some((j) => j.state === 'claimed' || j.state === 'submitted' || j.state === 'sent_to_printer')) return 'printing';
  return 'waiting';
}

/** Labels of this print the office reported sent to the printer. */
export function kioskLabelsSent(flow: Pick<KioskFlowState, 'testIds' | 'restIds'>, jobs: ReadonlyArray<KioskJob>): number {
  const ids = [...flow.testIds, ...flow.restIds];
  return jobs.filter((j) => j.requestId && ids.includes(j.requestId) && j.state === 'sent_to_printer' && !j.review).reduce((n, j) => n + (j.count ?? j.to - j.from + 1), 0);
}

/** Where the print is, from what this kiosk sent and what the office says about it. */
export function kioskPhase(flow: KioskFlowState, jobs: ReadonlyArray<KioskJob>): KioskPhase {
  if (flow.stopped) return 'stopped';
  const test = groupState(flow.testIds, jobs);
  if (test === 'none') return 'send-test';
  if (test === 'needs-check' || test === 'cancelled') return test;
  if (!flow.approved) return test === 'done' ? 'review' : test === 'printing' ? 'test-printing' : 'test-waiting';
  const rest = groupState(flow.restIds, jobs);
  if (rest === 'needs-check' || rest === 'cancelled') return rest;
  if (flow.restIds.length < flow.restPlan.length) return 'send-rest';
  if (flow.restPlan.length === 0) return test === 'done' ? 'done' : test === 'printing' ? 'test-printing' : 'test-waiting';
  if (rest === 'done' && test === 'done') return 'done';
  return rest === 'printing' || rest === 'done' ? 'rest-printing' : 'rest-waiting';
}

/**
 * A first kiosk print's progress rebuilt from the office's own records, for a
 * kiosk that lost what it saved (another browser, cleared data). Sends of
 * labels 1..testTo are the test; later sends are the rest, and whatever after
 * them was never sent is split into new sends.
 */
export function rebuildKioskFlow(input: { total: number; testTo: number; stage: 'test' | 'approved' | 'stopped'; requests: ReadonlyArray<{ id: string; range_from: number; range_to: number; reprint_of?: string | null }>; cap: number; across?: number }): KioskFlowState {
  const own = input.requests.filter((r) => !r.reprint_of).slice().sort((a, b) => a.range_from - b.range_from);
  const test = own.filter((r) => r.range_from >= 1 && r.range_to <= input.testTo);
  const rest = own.filter((r) => r.range_from > input.testTo);
  const nextFrom = Math.max(input.testTo, ...rest.map((r) => r.range_to)) + 1;
  const remaining = nextFrom <= input.total ? officeSendParts(nextFrom, input.total, input.cap, input.across ?? 1) : [];
  return {
    total: input.total, testTo: input.testTo,
    testIds: test.map((r) => r.id), restIds: rest.map((r) => r.id),
    restPlan: input.stage === 'test' && !rest.length ? [] : [...rest.map((r) => ({ from: r.range_from, to: r.range_to })), ...remaining],
    approved: input.stage === 'approved', stopped: input.stage === 'stopped',
  };
}

/** What a bitmap design's send is checked against: each label's own picture digest, in order (as the run page sends it). */
export function bitmapDigestSource(feeds: ReadonlyArray<string>): string {
  return feeds.map((z) => z.match(/\^FXLWBITMAP1:[a-f0-9]{64}:([a-f0-9]{64})\^FS/)?.[1]).join('\n');
}

// --- Setup --------------------------------------------------------------------

/** The kiosk tables aren't there yet (scripts/kiosk/schema.sql hasn't been applied). */
export function isMissingTable(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  return !!e && (e.code === '42P01' || (typeof e.message === 'string' && /relation "?(kiosk_[a-z_]+|template_categories)"? does not exist/i.test(e.message)));
}
