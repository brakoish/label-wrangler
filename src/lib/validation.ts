import { validateRunImages, type RunImageSelections } from './runImages';
import type { LabelTemplate, LabelFormat, Run, RunPreset, GlobalElement } from './types';
import { body, OfficeError } from './office/http';
export { OfficeError };
type Data = Record<string, unknown>;
function invalid(field: string): never { throw new OfficeError(`Invalid ${field}`, 400); }
function object(value: unknown, field: string): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
  return value as Data;
}
function text(value: unknown, field: string, max = 10000) {
  if (typeof value !== 'string' || value.length > max) invalid(field);
}
function number(value: unknown, field: string, min: number, max: number, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) invalid(field);
}
function strings(value: unknown, field: string) {
  const record = object(value, field);
  if (Object.keys(record).length > 500) invalid(field);
  for (const [k,v] of Object.entries(record)) { text(k, field, 200); text(v, field, 20000); }
}
/**
 * Style choices with a fixed list. Old rows can hold other values (early
 * imports, '' from older designers). Refusing them made those designs
 * impossible to save, so an unknown value is replaced with what the printers
 * already do with it, and the printed label stays the same:
 * - textAlign: ZPL prints anything else as left (^FB ...,L), the sheet as start.
 * - objectFit: ZPL and the sheet both draw anything else as contain.
 * - barcodeFormat: ZPL prints anything else as CODE128 (^BC).
 * - verticalAlign, fontStyle: only the bitmap renderer reads them, and it
 *   treats a missing value as top / normal.
 * These values are escaped wherever they are rendered, so this is about
 * saving, not safety.
 */
const COERCED: Record<string, { allowed: readonly string[]; fallback: string }> = {
  fontStyle: { allowed: ['normal','italic'], fallback: 'normal' },
  textAlign: { allowed: ['left','center','right'], fallback: 'left' },
  verticalAlign: { allowed: ['top','middle','bottom'], fallback: 'top' },
  objectFit: { allowed: ['contain','cover','fill'], fallback: 'contain' },
  barcodeFormat: { allowed: ['CODE128','CODE39','UPC','EAN13','EAN8','ITF14'], fallback: 'CODE128' },
};
/** fontWeight: ZPL ignores it and the sheet passes any CSS weight through as
 * written, so valid CSS weights are kept. Anything else is ignored by the
 * browser (prints normal) and is stored as 'normal'. */
function cssFontWeight(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 1 && value <= 1000;
  if (typeof value !== 'string') return false;
  if (['normal','bold','bolder','lighter'].includes(value)) return true;
  return /^\d{1,4}(\.\d+)?$/.test(value) && Number(value) >= 1 && Number(value) <= 1000;
}
/** QR error correction is written into the ZPL ^BQ command as is, and ZPL is
 * not escaped, so command and parameter separators are refused. Empty prints
 * as M. Any other value is kept so the printed bytes don't change. */
const ZPL_SEPARATORS = /[\^~,\r\n]/;
function elements(value: unknown) {
  if (!Array.isArray(value) || value.length > 500) invalid('elements');
  const ids = new Set();
  for (const raw of value) {
    const e = object(raw, 'element');
    text(e.id, 'element id', 200); if (ids.has(e.id)) invalid('duplicate element id'); ids.add(e.id);
    if (!['text','qr','barcode','line','rectangle','image'].includes(String(e.type))) invalid('element type');
    for (const k of ['x','y','rotation','zIndex']) number(e[k], k, -100000, 100000);
    for (const k of ['width','height']) number(e[k], k, 0, 100000);
    if (typeof e.isStatic !== 'boolean') invalid('isStatic');
    for (const k of ['fontSize','minFontSize','lineHeight','charWidth']) if (e[k] !== undefined) number(e[k],k,0.01,10000);
    for (const k of ['strokeWidth','borderRadius']) if (e[k] !== undefined) number(e[k],k,0,10000);
    if (e.lineStyle !== undefined && !['solid','dotted','dashed'].includes(String(e.lineStyle))) invalid('line style');
    // Unknown style values in old rows are coerced (see COERCED), not refused.
    // Colors and font names are escaped by every renderer (sheet SVG/HTML,
    // React previews) and the bitmap renderer checks its own, so any string
    // is stored as written.
    for (const [k, { allowed, fallback }] of Object.entries(COERCED)) if (e[k] !== undefined && e[k] !== null && !allowed.includes(String(e[k]))) e[k] = fallback;
    if (e.fontWeight !== undefined && e.fontWeight !== null && !cssFontWeight(e.fontWeight)) e.fontWeight = 'normal';
    if (e.errorCorrection === '') e.errorCorrection = 'M';
    else if (e.errorCorrection !== undefined && e.errorCorrection !== null && ZPL_SEPARATORS.test(String(e.errorCorrection))) invalid('errorCorrection');
    for (const [k,v] of Object.entries(e)) {
      if (typeof v === 'number' && !Number.isFinite(v)) invalid(k);
      if (typeof v === 'string') text(v,k,k==='src'?3_000_000:20000);
      if (v !== null && typeof v === 'object') invalid(k);
    }
    if (e.runSelectable !== undefined && (e.type !== 'image' || typeof e.runSelectable !== 'boolean')) invalid('run-selectable image');
    if (e.type === 'image' && (typeof e.src !== 'string' || !/^data:image\/(png|jpeg|webp|gif|svg\+xml);/i.test(e.src))) invalid('image source');
  }
}
const fields = {
  template: ['name','description','formatId','elements','thermalRenderMode','archivedAt','expectedUpdatedAt'],
  format: ['name','description','type','width','height','dpi','labelsAcross','linerWidth','horizontalGapThermal','sideMarginThermal','labelGap','sheetWidth','sheetHeight','columns','rows','labelsPerSheet','topMargin','sideMargin','horizontalGap','verticalGap'],
  run: ['imageSelections','name','templateId','presetId','staticValues','fieldMappings','dataSource','sourceData','mappedField','status','totalLabels','printedCount','notes','completedAt','pinnedAt','pinned','progressOnly','resetProgress'],
  preset: ['name','templateId','staticDefaults','fieldMappings','mappedField','csvColumn','touch'],
  global: ['name','description','elements'],
} as const;
export type Entity = keyof typeof fields;
type Shapes = { template: LabelTemplate & { expectedUpdatedAt?: string }; format: LabelFormat; run: Run & { imageSelections?: RunImageSelections; pinned?: boolean; progressOnly?: boolean; resetProgress?: boolean }; preset: RunPreset & { touch?: boolean }; global: GlobalElement };
export async function validatedBody<E extends Entity>(req: Request, entity: E, create = false): Promise<Shapes[E]> {
  return validate(await body(req, 4_000_000), entity, create) as unknown as Shapes[E];
}
export function validate(data: Data, entity: Entity, create = false): Data {
  const allowed: readonly string[] = fields[entity];
  for (const k of Object.keys(data)) if (!allowed.includes(k)) invalid(`field ${k}`);
  if (create) {
    if (!data.name || typeof data.name !== 'string' || !data.name.trim()) invalid('name');
    if (entity === 'template' && !data.formatId) invalid('format');
    if (['run','preset'].includes(entity) && !data.templateId) invalid('template');
    if (entity === 'format' && (!data.type || !data.width || !data.height)) invalid('format dimensions');
  }
  for (const k of ['name','description','formatId','templateId','presetId','mappedField','csvColumn','notes','expectedUpdatedAt','completedAt','pinnedAt','archivedAt']) {
    if (data[k] !== undefined && data[k] !== null) text(data[k],k,k==='notes'?20000:1000);
  }
  for (const k of ['formatId','templateId','expectedUpdatedAt']) if(data[k] !== undefined && (typeof data[k] !== 'string' || !data[k])) invalid(k);
  for (const k of ['expectedUpdatedAt','completedAt','pinnedAt','archivedAt']) if(data[k]!=null && !Number.isFinite(Date.parse(String(data[k])))) invalid(k);
  if (data.name !== undefined && (typeof data.name !== 'string' || !data.name.trim())) invalid('name');
  if (data.thermalRenderMode !== undefined && !['native-v1','bitmap-v1'].includes(String(data.thermalRenderMode))) invalid('thermal render mode');
  if (data.imageSelections !== undefined) {
    if (!create) invalid('image selections: saved run designs are immutable');
    validateRunImages(data.imageSelections);
  }
  if (data.elements !== undefined) elements(data.elements);
  for (const k of ['staticValues','staticDefaults']) if (data[k] !== undefined) strings(data[k],k);
  if (data.fieldMappings !== undefined) for (const m of Object.values(object(data.fieldMappings,'field mappings'))) {
    const mapping = object(m,'field mapping');
    if (!['static','column'].includes(String(mapping.mode))) invalid('mapping mode');
    if (mapping.mode==='column') text(mapping.csvColumn,'CSV column',200);
  }
  if (data.sourceData !== undefined) {
    if (!Array.isArray(data.sourceData) || data.sourceData.length > 100000) invalid('source rows');
    for (const row of data.sourceData) { if(typeof row==='string') text(row,'row',20000); else strings(row,'row'); }
  }
  for (const k of ['totalLabels','printedCount']) if (data[k] !== undefined) number(data[k],k,0,100000,true);
  if (data.status !== undefined && !['draft','queued','printing','paused','completed','cancelled'].includes(String(data.status))) invalid('run status');
  if (data.dataSource !== undefined && !['paste','csv','manual','manifest'].includes(String(data.dataSource))) invalid('data source');
  for (const k of ['pinned','touch','progressOnly','resetProgress']) if (data[k] !== undefined && typeof data[k] !== 'boolean') invalid(k);
  if (entity==='format') {
    if (data.type !== undefined && !['sheet','thermal'].includes(String(data.type))) invalid('format type');
    for (const k of ['width','height','sheetWidth','sheetHeight','linerWidth']) if (data[k]!==undefined && (data[k]!==null || k==='width' || k==='height')) number(data[k],k,0.01,100);
    for (const k of ['horizontalGapThermal','sideMarginThermal','labelGap','topMargin','sideMargin','horizontalGap','verticalGap']) if(data[k]!=null) number(data[k],k,0,100);
    for (const k of ['labelsAcross','columns','rows','labelsPerSheet']) if(data[k]!=null) number(data[k],k,1,10000,true);
    if (data.dpi!=null && ![152,203,300,600].includes(Number(data.dpi))) invalid('DPI');
  }
  return data;
}
