// Label Wrangler — Core Types

export type LabelType = 'thermal' | 'sheet';

// Base label format — defines the physical media
export interface LabelFormat {
  id: string;
  name: string;
  description?: string;
  type: LabelType;

  // Label dimensions (inches)
  width: number;
  height: number;

  // For thermal labels
  dpi?: number;               // 203 or 300 (default: 203)
  labelsAcross?: number;      // For multi-across rolls (default: 1)
  linerWidth?: number;        // Total roll/liner width (inches)
  horizontalGapThermal?: number; // Gap between labels across (inches)
  sideMarginThermal?: number; // Margin from liner edge to first label (inches)
  labelGap?: number;          // Vertical gap between labels on roll (inches)

  // For sheet labels
  sheetWidth?: number;        // e.g., 8.5
  sheetHeight?: number;       // e.g., 11
  columns?: number;
  rows?: number;
  labelsPerSheet?: number;    // auto: columns * rows
  topMargin?: number;         // inches from top of sheet
  sideMargin?: number;        // inches from left of sheet
  horizontalGap?: number;     // gap between columns
  verticalGap?: number;       // gap between rows

  createdAt: string;
  updatedAt: string;
}

// Parsed result from PDF template analysis
export interface ParsedLabelSpec {
  type: LabelType;
  width: number;
  height: number;
  sheetWidth?: number;
  sheetHeight?: number;
  columns?: number;
  rows?: number;
  topMargin?: number;
  sideMargin?: number;
  horizontalGap?: number;
  verticalGap?: number;
  confidence: 'high' | 'medium' | 'low';
}

// Common label presets
export const COMMON_THERMAL_SIZES = [
  { name: '2" × 1"', width: 2, height: 1 },
  { name: '4" × 6"', width: 4, height: 6 },
  { name: '2.25" × 1.25"', width: 2.25, height: 1.25 },
  { name: '3" × 2"', width: 3, height: 2 },
  { name: '1" × 0.5"', width: 1, height: 0.5 },
  { name: '0.5" × 0.5"', width: 0.5, height: 0.5 },
] as const;

export const COMMON_SHEET_SIZES = [
  { name: 'Letter (8.5" × 11")', width: 8.5, height: 11 },
  { name: 'A4 (210mm × 297mm)', width: 8.27, height: 11.69 },
] as const;

export const COMMON_DPI_VALUES = [203, 300] as const;

// Helper to calculate labels per sheet
export function calculateLabelsPerSheet(format: Omit<LabelFormat, 'labelsPerSheet'>): number {
  if (format.type === 'thermal') return 1;
  return (format.columns || 1) * (format.rows || 1);
}

// Helper to format dimensions for display
export function formatDimensions(width: number, height: number): string {
  return `${width}" × ${height}"`;
}

// Helper to generate a slug/ID from name
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Template element types
export type ElementType = "text" | "qr" | "barcode" | "line" | "rectangle" | "image";

// Barcode formats available
export type BarcodeFormat = "CODE128" | "CODE39" | "UPC" | "EAN13" | "EAN8" | "ITF14";

// Text alignment
export type TextAlign = "left" | "center" | "right";

// Base element that all element types share
export interface TemplateElementBase {
  id: string;
  type: ElementType;
  x: number;           // position in current units (dots for thermal, inches for sheet)
  y: number;
  width: number;
  height: number;
  rotation: number;     // degrees
  zIndex: number;
  isStatic: boolean;    // true = fixed value, false = dynamic placeholder
  fieldName?: string;   // for dynamic elements — the key used in label filler
  defaultValue?: string; // preview/placeholder value for dynamic fields
  prefix?: string;       // text before dynamic value (e.g. "SKU: ")
  suffix?: string;       // text after dynamic value (e.g. " oz")
}

// Text element
export interface TextElement extends TemplateElementBase {
  type: "text";
  content: string;       // static text or default for dynamic
  fontSize: number;      // in points
  fontFamily: string;
  fontWeight: "normal" | "bold";
  textAlign: TextAlign;
  color: string;         // hex color (only used for sheet, ignored for thermal)
  lineHeight: number;    // multiplier (e.g. 1.2 = 120%)
  /** Horizontal character-width multiplier (thermal/ZPL). 1.0 = Zebra default
   *  (tall narrow), 1.2 = roomier, 1.5 = very wide. Also applied as a
   *  proportional SVG letter-spacing in the designer so the preview matches. */
  charWidth?: number;
  /** Extra dot spacing between characters (ZPL ^A and ^CI don't expose this
   *  directly; we implement it in SVG via letterSpacing only). Optional. */
  letterSpacing?: number;
}

// QR Code element
export interface QRElement extends TemplateElementBase {
  type: "qr";
  content: string;       // data to encode
  errorCorrection: "L" | "M" | "Q" | "H";
}

// Barcode element
export interface BarcodeElement extends TemplateElementBase {
  type: "barcode";
  content: string;       // data to encode
  barcodeFormat: BarcodeFormat;
  showText: boolean;     // show human-readable text below barcode
}

// Line element
export interface LineElement extends TemplateElementBase {
  type: "line";
  strokeWidth: number;
  color: string;
}

// Rectangle element
export interface RectangleElement extends TemplateElementBase {
  type: "rectangle";
  strokeWidth: number;
  strokeColor: string;
  fillColor: string;     // empty string = no fill
  borderRadius: number;
}

// Image element (static logos only)
export interface ImageElement extends TemplateElementBase {
  type: "image";
  src: string;           // data URL of uploaded image
  objectFit: "contain" | "cover" | "fill";
}

// Union type for all elements
export type TemplateElement = TextElement | QRElement | BarcodeElement | LineElement | RectangleElement | ImageElement;

// Label template — ties a format to a set of elements
export interface LabelTemplate {
  id: string;
  name: string;
  description?: string;
  formatId: string;      // references a LabelFormat.id
  elements: TemplateElement[];
  createdAt: string;
  updatedAt: string;
}
// ---------------------------------------------------------------------------
// Runs & Presets
// ---------------------------------------------------------------------------

/** Maps a template dynamic field to its source for a run/preset.
 *  - 'static': value is the string in staticValues/staticDefaults keyed by field name.
 *  - 'column': value is pulled from the CSV column named by `csvColumn` for each row.
 */
export interface FieldMapping {
  mode: 'static' | 'column';
  csvColumn?: string;
}

/** Reusable recipe for a repeating batch print job.
 *  Captures the template + static field defaults + per-field CSV column
 *  mapping so the user can spin up a new Run without re-entering everything. */
export interface RunPreset {
  id: string;
  name: string;
  templateId: string;
  staticDefaults: Record<string, string>;
  /** Per-field mapping: which fields are variable and which CSV column they pull from. */
  fieldMappings: Record<string, FieldMapping>;
  /** Legacy single-field mapping kept for presets created before multi-field support. */
  mappedField: string | null;
  csvColumn: string | null;
  lastUsedAt: string | null;
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

export type RunStatus = 'draft' | 'queued' | 'printing' | 'paused' | 'completed' | 'cancelled';
export type RunDataSource = 'paste' | 'csv' | 'manual';

/** One execution of a print run. */
export interface Run {
  id: string;
  name: string;
  templateId: string;
  presetId: string | null;
  /** Static field values applied to every label. */
  staticValues: Record<string, string>;
  /** Per-field mapping. Fields not in this map (or with mode='static') use staticValues. */
  fieldMappings: Record<string, FieldMapping>;
  dataSource: RunDataSource;
  /** Legacy single-column mapping for runs created before multi-field support. */
  mappedField: string | null;
  /** For multi-field CSV runs, this is an array of row objects (one per label)
   *  keyed by CSV column name. For legacy paste-mode runs, this can be a flat
   *  string array; we normalize when reading. */
  sourceData: string[] | Record<string, string>[];
  status: RunStatus;
  totalLabels: number;
  printedCount: number;
  notes: string | null;
  /** ISO timestamp when the run was pinned. null = not pinned. Pinned runs
   *  surface to the top of the Runs dashboard regardless of status. */
  pinnedAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
